// src/view/stage/StageSceneView.ts
// Phase-3 stage-scene loader for `3d_stage_001` (and any scene exported by
// tools/stages/extract_stage_scene.py). Implements the consumption contract in
// tools/stages/STAGE_SCENE_REPORT.md §8:
//
//   - scene.json holds nodes + mesh/material/texture refs; mesh vertex data is
//     raw little-endian f32/u32 bins with NO headers (counts live in scene.json).
//   - Coordinates: Unity LEFT-HANDED Y-up kept AS-IS in the data; the VIEW layer
//     applies the established LH→RH mirror (x→−x, quat (x,−y,−z,w), winding flip)
//     at load time. UVs are NOT flipped (UnityPy already flipped the PNGs;
//     three.js flipY semantics complete the round trip — see report §4).
//   - Static batching (report §3): render entries with worldSpace=true are baked
//     in WORLD space — draw at IDENTITY, slice submeshes[subMesh.first], and do
//     NOT apply the authored node transform. All 198 renderable renderers in
//     stage 1 are world-space slices (verified in .work scan), so the batched
//     meshes hang off a root-level group, not the node hierarchy.
//   - LOD policy (report §5): render only lodLevel==0 or null.
//   - Color space (report §4): texture.colorSpace 1=sRGB, 0=linear; PNGs hold raw
//     values — set three.js colorSpace accordingly, never re-encode.
//
// Progressive loading: scene.json → mesh bins → geometry/materials (scene becomes
// visible untextured) → textures streamed with a concurrency pool and applied to
// materials as they arrive. 229MB total; 199MB of that is PNG textures.
//
// Load-time optimizations (iter load-perf):
//   - Mesh bins ship as ONE packed blob (tools/stages/pack_mesh_bins.py →
//     meshes.pack.bin + meshes-pack.json sidecar). The loader fetches the
//     sidecar + blob (2 requests instead of 52+) and slices zero-copy typed
//     array views. Absent/invalid pack → automatic per-file fallback.
//   - The per-file fallback fetches meshes with bounded concurrency
//     (meshConcurrency, default 6) instead of one mesh at a time.
//   - Texture streaming is priority-ordered: terrain splat albedo first (the
//     ground reads early), then river, then home/guide, then deco; albedo
//     slots before normal/data maps within each material. Decoded textures
//     are wired into materials incrementally (recompile only when a
//     material's resolved texture set actually changes).
//   - KTX2/BasisU GPU-compressed textures are the documented endgame for the
//     77MB WebP decode cost (transcoder toolchain absent this iteration).
//
// KNOWN Phase-3 gaps (per report §7, intentionally NOT attempted here):
//   - Shader Forge "Splatt_Normal_Gloss" terrain splat → 4-layer vertex-color
//     blend, albedo only (SplatTerrainMaterial.ts, NEAR fidelity).
//   - "Nature/Water" river → flow-map water (RiverWaterMaterial.ts, NEAR
//     fidelity: dual-phase flow normals + fresnel tint + sky sheen; animate
//     via tickWater(dt)).
//   - Lightmaps/GI not exported → caller adds fill lighting.
//   - Animations (stone_001, 192 animators) → static pose.

import { TextureUploadQueue } from './TextureUploadQueue';
import { installUnityStandardMaps } from './UnityStandardMaps';
import * as THREE from 'three';
import { invertMeshPack, MESH_PACK_TRANSFORM } from './meshPackTransform';
import { installSplatTerrainShader, setSplatLayerTextures, setSplatLayerUvScales, ensureSplatAttributes } from './SplatTerrainMaterial';
import { fetchCompressed, fetchJsonCompressed } from './compressedFetch';
import { createRiverWaterMaterial, loadSkyCube, setRiverTextures, tickRiverWater } from './RiverWaterMaterial';
import { createBrowserAssetCache, type AssetCache } from '../cache/AssetCache';

// ---------------------------------------------------------------------------
// scene.json schema (subset the loader reads — see extract_stage_scene.py)
// ---------------------------------------------------------------------------

interface SceneSubmesh {
  firstIndex: number;
  indexCount: number;
  topology: number;
}

interface SceneMesh {
  name: string;
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  submeshes: SceneSubmesh[];
  files: Partial<Record<'pos' | 'nrm' | 'uv0' | 'tan' | 'idx' | 'col0', string>>;
  channels: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  combined: boolean;
  bakedWorldSpace: boolean;
  colliderOnly: boolean;
}

interface SceneTextureRef {
  texture: string;
  scale: [number, number];
  offset: [number, number];
}

interface SceneMaterial {
  name: string;
  shader: { name: string };
  textures: Record<string, SceneTextureRef>;
  floats: Record<string, number>;
  colors: Record<string, number[]>;
}

interface SceneTexture {
  name: string;
  width: number;
  height: number;
  colorSpace: number; // 1 = sRGB, 0 = linear (report §4)
  file: string;
  bytes: number;
}

interface SceneRender {
  mesh: string;
  materials: string[];
  enabled: boolean;
  lodLevel: number | null;
  worldSpace: boolean;
  subMesh: { first: number; count: number } | null;
  castShadows: number;
  receiveShadows: number;
}

interface SceneNode {
  i: number;
  name: string;
  parent: number;
  activeSelf: boolean;
  activeInHierarchy: boolean;
  layerName: string;
  pos: [number, number, number];
  rot: [number, number, number, number];
  scale: [number, number, number];
  animator: boolean;
  render: SceneRender | null;
}

interface SceneLight {
  name: string;
  node: number;
  type: number; // Unity LightType: 0=spot 1=directional 2=point
  enabled: boolean;
  color: [number, number, number];
  intensity: number;
  range: number;
}

interface SceneFile {
  meta: { stage: string };
  nodes: SceneNode[];
  meshes: Record<string, SceneMesh>;
  materials: Record<string, SceneMaterial>;
  textures: Record<string, SceneTexture>;
  lights: SceneLight[];
}

/** Sidecar index for meshes.pack.bin (tools/stages/pack_mesh_bins.py).
 *  Entries are keyed by the SAME file strings as SceneMesh.files. */
interface MeshPackIndex {
  version: number;
  file: string;
  totalBytes: number;
  /** Set when entries are stored shuffled (see meshPackTransform.ts). */
  transform?: string;
  entries: Record<string, { offset: number; length: number }>;
}

/** Raw channel views for one mesh (over per-file ArrayBuffers or pack slices). */
interface RawMeshChannels {
  pos: Float32Array;
  nrm?: Float32Array;
  uv0?: Float32Array;
  tan?: Float32Array;
  idx: Uint32Array;
  col0?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StageSceneProgress {
  phase: 'scene' | 'meshes' | 'geometry' | 'textures' | 'done';
  /** Human-readable current item, e.g. "meshes/Combined_Mesh_root_scene_6.pos.f32.bin". */
  detail: string;
  loadedBytes: number;
  totalBytes: number;
  itemsLoaded: number;
  itemsTotal: number;
}

export interface StageSceneStats {
  nodesTotal: number;
  renderersBuilt: number;
  renderersSkipped: number;
  combinedMeshesLoaded: number;
  mergedDrawMeshes: number;
  materialsBuilt: number;
  texturesLoaded: number;
  vertices: number;
  triangles: number;
  bytesLoaded: number;
  lights: number;
  loadSeconds: number;
}

export interface StageSceneViewOptions {
  /** Base URL of the extracted stage dir (must end with '/'). */
  baseUrl?: string;
  /**
   * Merge all world-space slices that share a material into one draw mesh
   * (≤1 draw call per material — the stage is fully static, so per-renderer
   * culling buys nothing). Default true.
   */
  mergeByMaterial?: boolean;
  /** Concurrent texture decodes. Default 4. */
  textureConcurrency?: number;
  /** load() resolves once every texture job with priority below this has
   *  decoded; the rest keep streaming (see `texturesDone`). Default: all. */
  blockingPriorityBelow?: number;
  /** Texture jobs that are NOT blocking (priority >= blockingPriorityBelow) start
   *  only after the blocking ones finished AND this promise resolved, so props
   *  textures never compete with critical bytes for bandwidth. */
  deferNonBlockingUntil?: Promise<void>;
  /** Concurrent mesh fetches in the per-file fallback path (the packed-blob
   *  path needs only one request). Default 6. */
  meshConcurrency?: number;
  /** Scene descriptor file to load from baseUrl (default 'scene.json').
   *  Use 'scene-webp.json' for the repacked-texture variant; falls back to
   *  'scene.json' automatically when the variant is missing. */
  sceneFile?: string;
  /** Renderer used to pick anisotropy for ground textures. Optional. */
  renderer?: THREE.WebGLRenderer;
  /** Shared browser asset cache (Cache API) for scene.json, the mesh pack and
   *  texture blobs — repeat loads skip the network entirely. Defaults to
   *  createBrowserAssetCache() (passthrough when the Cache API is absent,
   *  e.g. headless Node runs). Pass ONE shared instance from boot so every
   *  loader shares the same bucket. */
  assetCache?: AssetCache;
  onProgress?: (p: StageSceneProgress) => void;
}

const CHANNEL_BYTES: Record<string, number> = { pos: 12, nrm: 12, uv0: 8, tan: 16, idx: 4, col0: 4 };

/** Exact bin byte size of a mesh (counts live in scene.json — no headers). */
function meshBinBytes(m: SceneMesh): number {
  return m.channels.reduce((acc, ch) =>
    acc + (ch === 'idx' ? m.indexCount * 4 : m.vertexCount * (CHANNEL_BYTES[ch] ?? 0)), 0);
}

/** Texture streaming priority: terrain splat albedo first so the ground reads
 *  early, then river, then home/guide, then deco. Within a material, albedo
 *  slots before normal/flow maps before data maps (gloss/AO/metal). */
function texturePriority(matName: string, slotName: string): number {
  const matRank = isSplatMaterial(matName) ? 0
    : matName === RIVER_MATERIAL ? 1
      : (matName === 'home_001_m' || matName === 'guide_001_m') ? 2 : 3;
  const slotRank = /Color$|_MainTex$/.test(slotName) ? 0
    : /Normal$|BumpMap$|FlowMap$/.test(slotName) ? 1 : 2;
  return matRank * 4 + slotRank;
}

/** Custom-shader materials that get a documented NEAR patch (report §7.1). */
// PER-STAGE: the material ids are 'terrain_001_m'/'terrain_001_river_m' in areas 1 (stages 1-3) but 'terrain_004_m',
// 'terrain_007_m', 'terrain_010_m', 'terrain_013_m' (+ '_river_m') in the later areas -> resolved by SHADER name when a
// scene loads (resolveSpecialMaterials). Defaults = stage 1.
let SPLAT_TERRAIN_MATERIAL = 'terrain_001_m';
/** Every splat-terrain material id of the loaded scene (the hub 3d_stage_000 has FIVE: terrain_000_m, _2_.._5_m; stages have one). */
let SPLAT_TERRAIN_IDS = new Set<string>([SPLAT_TERRAIN_MATERIAL]);
const isSplatMaterial = (id: string): boolean => id === SPLAT_TERRAIN_MATERIAL || SPLAT_TERRAIN_IDS.has(id);
let RIVER_MATERIAL = 'terrain_001_river_m';
/** Pick the splat-terrain / Nature/Water materials of a scene by shader name (id fallback unchanged). */
export function resolveSpecialMaterials(materials: Record<string, { shader: { name: string } }>): { terrain: string; river: string } {
  let terrain = 'terrain_001_m', river = 'terrain_001_river_m';
  for (const [id, m] of Object.entries(materials)) {
    if (m.shader?.name === 'Shader Forge/Splatt_Normal_Gloss') terrain = id;
    else if (m.shader?.name === 'Nature/Water') river = id;
  }
  return { terrain, river };
}

export class StageSceneView {
  /** Root of everything this loader created. Add to your THREE.Scene. */
  readonly group = new THREE.Group();
  /** Node hierarchy (semantics/logic only — batched draws do NOT live here). */
  readonly hierarchy = new THREE.Group();
  /** Authored world matrix of a node (Unity LH TRS chain) conjugated by the x-mirror, i.e. in the port's right-handed space. */
  private mirroredNodeWorld(scene: SceneFile, nodeIndex: number): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const chain: SceneNode[] = [];
    for (let i = nodeIndex; i >= 0; i = scene.nodes[i].parent) chain.push(scene.nodes[i]);
    for (let k = chain.length - 1; k >= 0; k--) {
      const n = chain[k];
      p.set(-n.pos[0], n.pos[1], n.pos[2]);
      q.set(n.rot[0], -n.rot[1], -n.rot[2], n.rot[3]);
      sc.set(n.scale[0], n.scale[1], n.scale[2]);
      m.multiply(local.compose(p, q, sc));
    }
    return m;
  }

  /** Root-level group holding the world-space-batched draw meshes. */
  readonly draws = new THREE.Group();
  /** Terrain chunk meshes for GroundPicker raycasts (three-space, mirrored). */
  readonly terrainPickMeshes: THREE.Mesh[] = [];
  /** River draw meshes (the Nature/Water ShaderMaterial; rendered by WaterPass). */
  readonly riverMeshes: THREE.Mesh[] = [];
  readonly lights: THREE.Light[] = [];
  /** Resolves when ALL textures (incl. background-streamed ones) are applied. */
  texturesDone: Promise<void> = Promise.resolve();
  readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  readonly stats: StageSceneStats = {
    nodesTotal: 0, renderersBuilt: 0, renderersSkipped: 0,
    combinedMeshesLoaded: 0, mergedDrawMeshes: 0, materialsBuilt: 0,
    texturesLoaded: 0, vertices: 0, triangles: 0, bytesLoaded: 0,
    lights: 0, loadSeconds: 0,
  };

  private scene: SceneFile | null = null;
  private readonly texturesById = new Map<string, THREE.Texture>();
  /** Per-material signature of the last applied (resolved) texture set —
   *  applyTextures only rewires/recompiles when it actually changes. */
  private readonly appliedTextureKeys = new Map<string, string>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  /** Set by dispose(): background texture streaming stops and late textures are freed instead of kept. */
  private disposed = false;
  private releaseBlockingRef: (() => void) | null = null;
  private readonly assetCache: AssetCache;
  /** Frame-budgeted GPU uploads (null without a renderer, e.g. headless tests). */
  private readonly uploads: TextureUploadQueue | null;

  constructor(private readonly options: StageSceneViewOptions = {}) {
    this.group.name = 'stage-scene';
    this.hierarchy.name = 'stage-hierarchy';
    this.draws.name = 'stage-draws';
    this.group.add(this.hierarchy, this.draws);
    this.assetCache = options.assetCache ?? createBrowserAssetCache();
    this.uploads = options.renderer ? new TextureUploadQueue(options.renderer) : null;
  }

  async load(): Promise<this> {
    const t0 = performance.now();
    const baseUrl = this.options.baseUrl ?? '/assets/stages/3d_stage_001/';
    const onProgress = this.options.onProgress ?? (() => {});
    const merge = this.options.mergeByMaterial ?? true;

    // ---- totals (exact: mesh bin sizes derive from scene.json counts) ----
    const progress: StageSceneProgress = {
      phase: 'scene', detail: 'scene.json',
      loadedBytes: 0, totalBytes: 0, itemsLoaded: 0, itemsTotal: 0,
    };
    const report = (detail: string) => { progress.detail = detail; onProgress({ ...progress }); };

    const wanted = this.options.sceneFile ?? 'scene.json';
    let scene: SceneFile;
    try {
      // Prefer a pre-compressed .gz sibling (1.1MB→108KB on slow links).
      scene = await fetchJsonCompressed<SceneFile>(`${baseUrl}${wanted}`, this.assetCache);
    } catch {
      // repacked variant absent (e.g. fresh checkout) → original PNG scene
      scene = await fetchJsonCompressed<SceneFile>(`${baseUrl}scene.json`, this.assetCache);
    }
    this.scene = scene;
    ({ terrain: SPLAT_TERRAIN_MATERIAL, river: RIVER_MATERIAL } = resolveSpecialMaterials(scene.materials));
    SPLAT_TERRAIN_IDS = new Set(Object.entries(scene.materials).filter(([, m]) => m.shader?.name === 'Shader Forge/Splatt_Normal_Gloss').map(([id]) => id));
    SPLAT_TERRAIN_IDS.add(SPLAT_TERRAIN_MATERIAL);
    progress.loadedBytes += JSON.stringify(scene).length;

    // Renderable set per report §5/§8: active + enabled + LOD0/null.
    interface RenderJob { node: SceneNode; render: SceneRender }
    const jobs: RenderJob[] = [];
    for (const node of scene.nodes) {
      const r = node.render;
      if (!r) continue;
      if (!node.activeInHierarchy || !r.enabled || (r.lodLevel !== 0 && r.lodLevel !== null)) {
        this.stats.renderersSkipped++;
        continue;
      }
      jobs.push({ node, render: r });
    }
    this.stats.nodesTotal = scene.nodes.length;

    const meshIds = [...new Set(jobs.map((j) => j.render.mesh))];
    const texIds = new Set<string>();
    for (const j of jobs) for (const matId of j.render.materials) {
      const mat = scene.materials[matId];
      for (const slot of Object.values(mat.textures)) texIds.add(slot.texture);
    }
    const texBytes = [...texIds].reduce((a, id) => a + (scene.textures[id]?.bytes ?? 0), 0);
    progress.totalBytes = progress.loadedBytes +
      meshIds.reduce((a, id) => a + meshBinBytes(scene.meshes[id]), 0) + texBytes;
    progress.itemsTotal = meshIds.length + texIds.size;
    report('scene.json');

    // ---- mesh bins (only the meshes renderable renderers reference) ----
    // Pack first (1 blob request, zero-copy slices); per-file fallback with
    // bounded concurrency when the pack is absent or fails validation.
    progress.phase = 'meshes';
    let rawMeshes = await this.loadMeshPack(baseUrl, scene, meshIds, progress, report);
    if (!rawMeshes) {
      rawMeshes = await this.loadMeshFiles(baseUrl, scene, meshIds, progress, report);
    }

    // ---- geometry: slice submeshes, mirror LH→RH, flip winding ----
    // Mirror = x→−x on pos/nrm/tan, w→−w on tan (reflection flips the bitangent
    // sign), triangle winding reversed. Applied at slice build time so all draw
    // geometry lives natively in three.js right-handed space.
    progress.phase = 'geometry';
    report('building geometry');
    interface Slice { meshId: string; submeshIndex: number; materialId: string; node: SceneNode; worldSpace: boolean; castShadows: boolean; receiveShadows: boolean }
    const slices: Slice[] = jobs.map(({ node, render }) => ({
      meshId: render.mesh,
      submeshIndex: render.worldSpace && render.subMesh ? render.subMesh.first : 0,
      materialId: render.materials[0],
      node,
      worldSpace: render.worldSpace,
      castShadows: render.castShadows === 1,
      receiveShadows: render.receiveShadows === 1,
    }));

    const buildSliceGeometry = (s: Slice): THREE.BufferGeometry => {
      const meta = scene.meshes[s.meshId];
      const raw = rawMeshes.get(s.meshId)!;
      const sub = meta.submeshes[s.submeshIndex];
      const remap = new Map<number, number>();
      const order: number[] = [];
      for (let k = 0; k < sub.indexCount; k++) {
        const vi = raw.idx[sub.firstIndex + k];
        if (!remap.has(vi)) { remap.set(vi, order.length); order.push(vi); }
      }
      const n = order.length;
      const pos = new Float32Array(n * 3);
      const nrm = raw.nrm ? new Float32Array(n * 3) : undefined;
      const uv0 = raw.uv0 ? new Float32Array(n * 2) : undefined;
      const tan = raw.tan ? new Float32Array(n * 4) : undefined;
      const splat = raw.col0 ? new Float32Array(n * 4) : undefined;
      for (let ni = 0; ni < n; ni++) {
        const vi = order[ni];
        pos[ni * 3] = -raw.pos[vi * 3]; // mirror x
        pos[ni * 3 + 1] = raw.pos[vi * 3 + 1];
        pos[ni * 3 + 2] = raw.pos[vi * 3 + 2];
        if (nrm && raw.nrm) {
          nrm[ni * 3] = -raw.nrm[vi * 3];
          nrm[ni * 3 + 1] = raw.nrm[vi * 3 + 1];
          nrm[ni * 3 + 2] = raw.nrm[vi * 3 + 2];
        }
        if (uv0 && raw.uv0) {
          uv0[ni * 2] = raw.uv0[vi * 2];
          uv0[ni * 2 + 1] = raw.uv0[vi * 2 + 1];
        }
        if (tan && raw.tan) {
          tan[ni * 4] = -raw.tan[vi * 4];
          tan[ni * 4 + 1] = raw.tan[vi * 4 + 1];
          tan[ni * 4 + 2] = raw.tan[vi * 4 + 2];
          tan[ni * 4 + 3] = -raw.tan[vi * 4 + 3]; // bitangent sign flips under mirror
        }
        if (splat && raw.col0) {
          splat[ni * 4] = raw.col0[vi * 4] / 255;
          splat[ni * 4 + 1] = raw.col0[vi * 4 + 1] / 255;
          splat[ni * 4 + 2] = raw.col0[vi * 4 + 2] / 255;
          splat[ni * 4 + 3] = raw.col0[vi * 4 + 3] / 255;
        }
      }
      const idx = new Uint32Array(sub.indexCount);
      for (let k = 0; k < sub.indexCount; k += 3) {
        // winding flip for the x-mirror
        idx[k] = remap.get(raw.idx[sub.firstIndex + k])!;
        idx[k + 1] = remap.get(raw.idx[sub.firstIndex + k + 2])!;
        idx[k + 2] = remap.get(raw.idx[sub.firstIndex + k + 1])!;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (nrm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      if (uv0) g.setAttribute('uv', new THREE.BufferAttribute(uv0, 2));
      if (tan) g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
      if (splat) g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      this.stats.vertices += n;
      this.stats.triangles += sub.indexCount / 3;
      return g;
    };

    // Materials are built up front (untextured) so the scene renders while the
    // 199MB of PNGs stream in; texture slots get patched in as they decode.
    for (const matId of new Set(slices.map((s) => s.materialId))) {
      this.materials.set(matId, this.buildMaterial(scene.materials[matId]));
    }
    this.stats.materialsBuilt = this.materials.size;

    if (merge) {
      // One merged draw mesh per material (≤18 draw calls for the whole stage).
      const byMaterial = new Map<string, Slice[]>();
      for (const s of slices) {
        const list = byMaterial.get(s.materialId) ?? [];
        list.push(s);
        byMaterial.set(s.materialId, list);
      }
      for (const [matId, list] of byMaterial) {
        const geoms = list.map(buildSliceGeometry);
        ensureSplatAttributes(geoms); // merge needs identical attribute sets
        const merged = mergeGeometries(geoms);
        geoms.forEach((g) => g.dispose());
        const mesh = new THREE.Mesh(merged, this.materials.get(matId)!);
        mesh.name = `merged:${matId}`;
        mesh.castShadow = list.some((s) => s.castShadows);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; // world-space baked → identity forever
        this.draws.add(mesh);
        this.disposables.push(merged);
        this.stats.mergedDrawMeshes++;
        this.stats.renderersBuilt += list.length;
        if (isSplatMaterial(matId)) this.terrainPickMeshes.push(mesh);
        if (matId === RIVER_MATERIAL) this.riverMeshes.push(mesh);
      }
    } else {
      for (const s of slices) {
        const g = buildSliceGeometry(s);
        const mesh = new THREE.Mesh(g, this.materials.get(s.materialId)!);
        mesh.name = s.node.name;
        mesh.castShadow = s.castShadows;
        mesh.receiveShadow = s.receiveShadows;
        mesh.matrixAutoUpdate = false;
        // Renderers that are NOT static-batched (worldSpace=false; 118 in the hub scene: decos, ranking board, rainbow arches, ...) keep their
        // mesh in local space and are placed by the node's world TRS. (Stages bake everything, so this never triggered there.)
        if (!s.worldSpace) { mesh.matrix.copy(this.mirroredNodeWorld(scene, s.node.i)); mesh.matrixWorldNeedsUpdate = true; }
        mesh.userData.nodeIndex = s.node.i;
        this.draws.add(mesh);
        this.disposables.push(g);
        this.stats.renderersBuilt++;
        if (isSplatMaterial(s.materialId)) this.terrainPickMeshes.push(mesh);
        if (s.materialId === RIVER_MATERIAL) this.riverMeshes.push(mesh);
      }
    }
    report('geometry done');
    await new Promise((r) => setTimeout(r)); // let the loader paint before textures

    // ---- node hierarchy (semantics only; nothing drawable attached) ----
    this.buildHierarchy(scene);

    // Water sky cubemap (6 faces; non-blocking — water falls back to no sky).
    loadSkyCube(baseUrl).then((cube) => {
      const rm = this.materials.get(RIVER_MATERIAL);
      if (rm) setRiverTextures(rm as unknown as THREE.ShaderMaterial, { sky: cube });
    }).catch((err) => console.warn('StageSceneView: water sky cube unavailable', err));

    // ---- lights (node transforms, mirrored) ----
    this.buildLights(scene);
    this.stats.lights = this.lights.length;

    // ---- textures (progressive, pooled, priority-ordered) ----
    progress.phase = 'textures';
    const textureJobs: Array<{ id: string; slot: SceneTextureRef; colorSpace: number; priority: number }> = [];
    const seen = new Set<string>();
    for (const matId of this.materials.keys()) {
      const mat = scene.materials[matId];
      for (const [slotName, slot] of Object.entries(mat.textures)) {
        const key = `${slot.texture}|${slot.scale}|${slot.offset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        textureJobs.push({
          id: slot.texture, slot,
          colorSpace: scene.textures[slot.texture]?.colorSpace ?? 1,
          priority: texturePriority(matId, slotName),
        });
      }
    }
    // Stable sort → terrain albedo decodes first; ties keep material order.
    textureJobs.sort((a, b) => a.priority - b.priority);
    const concurrency = Math.max(1, this.options.textureConcurrency ?? 4);
    const blockBelow = this.options.blockingPriorityBelow ?? Infinity;
    const blockingTotal = textureJobs.filter((j) => j.priority < blockBelow).length;
    let blockingDone = 0;
    let releaseBlocking!: () => void;
    const blockingReady = new Promise<void>((r) => { releaseBlocking = r; });
    if (blockingTotal === 0) releaseBlocking();
    this.releaseBlockingRef = releaseBlocking;
    let cursor = 0;
    const worker = async () => {
      while (cursor < textureJobs.length && !this.disposed) {
        const job = textureJobs[cursor++];
        if (job.priority >= blockBelow) {
          await blockingReady;
          await (this.options.deferNonBlockingUntil ?? Promise.resolve()).catch(() => {});
          if (this.disposed) return;
        }
        report(`textures/${job.id}.png`);
        try {
          await this.loadTexture(baseUrl, job.id, job.slot, job.colorSpace);
          // Wire the fresh texture in immediately so the ground (and every
          // other material) reads progressively, not only at the very end.
          this.applyTextures();
        } catch (err) {
          console.warn(`StageSceneView: texture ${job.id} failed`, err);
        }
        progress.loadedBytes += scene.textures[job.id]?.bytes ?? 0;
        progress.itemsLoaded++;
        this.stats.texturesLoaded++;
        if (job.priority < blockBelow && ++blockingDone === blockingTotal) releaseBlocking();
      }
    };
    const allWorkers = Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
      this.applyTextures();
      progress.loadedBytes = progress.totalBytes;
      this.stats.bytesLoaded = progress.loadedBytes;
      this.stats.loadSeconds = (performance.now() - t0) / 1000;
    });
    this.texturesDone = allWorkers;
    await blockingReady;
    if (blockBelow === Infinity) await allWorkers;
    else allWorkers.catch(() => {});

    progress.phase = 'done';
    report('done');
    this.stats.loadSeconds = (performance.now() - t0) / 1000;
    return this;
  }

  /** Advance the river flow animation by dt seconds (game loop calls this
   *  once per frame; no-op until the river material exists). */
  tickWater(dt: number): void {
    const m = this.materials.get(RIVER_MATERIAL);
    if (m) tickRiverWater(m as unknown as THREE.ShaderMaterial, dt);
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /** Fetch meshes.pack.bin + sidecar and slice zero-copy channel views.
   *  Returns null (→ per-file fallback) when the pack is absent, fails to
   *  fetch, or any referenced channel is missing/misaligned/size-mismatched.
   *  Progress accounting on success matches the per-file path exactly:
   *  loadedBytes counts only the channels the renderable meshes use. */
  private async loadMeshPack(
    baseUrl: string, scene: SceneFile, meshIds: string[],
    progress: StageSceneProgress, report: (detail: string) => void,
  ): Promise<Map<string, RawMeshChannels> | null> {
    let index: MeshPackIndex;
    let buf: ArrayBuffer;
    // The pack is one big blob (~39MB raw, ~15MB gzipped). fetchCompressed
    // prefers the .gz sibling (DecompressionStream) and streams progress in
    // DECOMPRESSED bytes, which map directly to the referenced-mesh budget —
    // fixes both the slow-link transfer size and the old "frozen bar" symptom.
    const meshBytesTotal = meshIds.reduce((a, id) => a + meshBinBytes(scene.meshes[id]), 0);
    const baseLoaded = progress.loadedBytes;
    try {
      report('meshes-pack.json');
      const indexRes = await fetch(`${baseUrl}meshes-pack.json`);
      if (!indexRes.ok) return null;
      index = (await indexRes.json()) as MeshPackIndex;
      if (index.version !== 1 || !index.entries) return null;
      report(index.file);
      let lastReportMB = -1;
      // Cache hit → no streamed progress callbacks; the byte total is
      // reconciled right after the await either way.
      buf = await fetchCompressed(`${baseUrl}${index.file}`, (received) => {
        progress.loadedBytes = baseLoaded + Math.min(meshBytesTotal, received);
        const mb = Math.floor(received / 1e6);
        if (mb !== lastReportMB) { // throttle DOM writes to ~1MB steps
          lastReportMB = mb;
          report(`${index.file} — ${mb}/${(meshBytesTotal / 1e6).toFixed(0)} MB`);
        }
      }, this.assetCache);
      if (index.transform === MESH_PACK_TRANSFORM) buf = invertMeshPack(buf, index.entries);
      else if (index.transform) return null; // unknown transform → per-file fallback
      progress.loadedBytes = baseLoaded + meshBytesTotal;
    } catch {
      progress.loadedBytes = baseLoaded;
      return null; // pack absent/unreachable → per-file fallback
    }
    // Validate EVERY referenced channel before slicing anything — a partial
    // pack must fall back wholesale, never mix pack views with stale files.
    for (const meshId of meshIds) {
      const meta = scene.meshes[meshId];
      for (const ch of meta.channels) {
        const file = meta.files[ch as keyof SceneMesh['files']];
        const want = ch === 'idx' ? meta.indexCount * 4 : meta.vertexCount * (CHANNEL_BYTES[ch] ?? 0);
        const e = file ? index.entries[file] : undefined;
        if (!e || e.length !== want || e.offset % 4 !== 0 || e.offset + e.length > buf.byteLength) {
          console.warn(`StageSceneView: mesh pack invalid for ${meshId}/${ch} — per-file fallback`);
          progress.loadedBytes = baseLoaded; // undo streamed accounting; fallback re-counts
          return null;
        }
      }
    }
    const raw = new Map<string, RawMeshChannels>();
    for (const meshId of meshIds) {
      const meta = scene.meshes[meshId];
      const view = (ch: string): ArrayBufferView | undefined => {
        const file = meta.files[ch as keyof SceneMesh['files']];
        if (!file) return undefined;
        const e = index.entries[file];
        if (ch === 'idx') return new Uint32Array(buf, e.offset, e.length / 4);
        if (ch === 'col0') return new Uint8Array(buf, e.offset, e.length);
        return new Float32Array(buf, e.offset, e.length / 4);
      };
      const pos = view('pos') as Float32Array | undefined;
      const idx = view('idx') as Uint32Array | undefined;
      if (!pos || !idx) throw new Error(`stage mesh ${meshId}: missing pos/idx bins`);
      raw.set(meshId, {
        pos, idx,
        nrm: view('nrm') as Float32Array | undefined,
        uv0: view('uv0') as Float32Array | undefined,
        tan: view('tan') as Float32Array | undefined,
        // RGBA bytes — splat-layer weights (Shader Forge Splatt_Normal_Gloss).
        col0: view('col0') as Uint8Array | undefined,
      });
      // Bytes already accounted by the streamed download above; only count
      // items here (the per-file fallback path adds bytes itself).
      progress.itemsLoaded++;
      report(meshId);
      this.stats.combinedMeshesLoaded++;
    }
    return raw;
  }

  /** Per-file mesh fetch fallback: bounded worker pool over meshes (each
   *  mesh's channels still fetch in parallel). Results are keyed by mesh id,
   *  so geometry output is independent of fetch completion order. */
  private async loadMeshFiles(
    baseUrl: string, scene: SceneFile, meshIds: string[],
    progress: StageSceneProgress, report: (detail: string) => void,
  ): Promise<Map<string, RawMeshChannels>> {
    const raw = new Map<string, RawMeshChannels>();
    const concurrency = Math.max(1, this.options.meshConcurrency ?? 6);
    let cursor = 0;
    const worker = async () => {
      while (cursor < meshIds.length) {
        const meshId = meshIds[cursor++];
        const meta = scene.meshes[meshId];
        const fetchF32 = async (ch: 'pos' | 'nrm' | 'uv0' | 'tan') => {
          const file = meta.files[ch];
          if (!file) return undefined;
          report(file);
          return new Float32Array(await (await fetch(`${baseUrl}${file}`)).arrayBuffer());
        };
        const fetchIdx = async () => {
          const file = meta.files.idx;
          if (!file) return undefined;
          report(file);
          return new Uint32Array(await (await fetch(`${baseUrl}${file}`)).arrayBuffer());
        };
        // RGBA bytes — splat-layer weights (Shader Forge Splatt_Normal_Gloss).
        const fetchCol0 = async () => {
          const file = meta.files.col0;
          if (!file) return undefined;
          report(file);
          return new Uint8Array(await (await fetch(`${baseUrl}${file}`)).arrayBuffer());
        };
        const [pos, nrm, uv0, tan, idx, col0] = await Promise.all([
          fetchF32('pos'), fetchF32('nrm'), fetchF32('uv0'), fetchF32('tan'), fetchIdx(), fetchCol0(),
        ]);
        if (!pos || !idx) throw new Error(`stage mesh ${meshId}: missing pos/idx bins`);
        raw.set(meshId, { pos, nrm, uv0, tan, idx, col0 });
        progress.loadedBytes += meshBinBytes(meta);
        progress.itemsLoaded++;
        report(meshId);
        this.stats.combinedMeshesLoaded++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, meshIds.length) }, worker));
    return raw;
  }

  /** Unity Standard → MeshStandardMaterial (report §8.4). */
  private buildMaterial(mat: SceneMaterial): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ name: mat.name });
    const f = mat.floats;
    const color = mat.colors['_Color'] ?? [1, 1, 1, 1];
    m.color.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);

    // Unity: smoothness = 1 − roughness. With a gloss map, _GlossMapScale scales it.
    const hasGlossMap = !!mat.textures['_MetallicGlossMap'];
    m.metalness = f['_Metallic'] ?? 0;
    m.roughness = hasGlossMap ? 1 : 1 - (f['_Glossiness'] ?? 0.5);
    const emissive = mat.colors['_EmissionColor'];
    if (emissive && (emissive[0] > 0 || emissive[1] > 0 || emissive[2] > 0)) {
      m.emissive.setRGB(emissive[0], emissive[1], emissive[2], THREE.SRGBColorSpace);
    }
    if ((f['_Mode'] ?? 0) === 1) { // cutout
      m.alphaTest = f['_Cutoff'] ?? 0.5;
    } else if ((f['_Mode'] ?? 0) >= 2) { // fade/transparent
      m.transparent = true;
      m.opacity = color[3] ?? 1;
    }

    // Unity Standard channel semantics (DXT5nm normals, metal R / smooth A,
    // _GlossMapScale) — see UnityStandardMaps.ts for the bundle evidence.
    if (hasGlossMap) m.metalness = 1; // metalnessMap.r multiplies it (Unity ignores _Metallic with a map)
    m.normalScale.set(f['_BumpScale'] ?? 1, f['_BumpScale'] ?? 1);
    m.aoMapIntensity = f['_OcclusionStrength'] ?? 1;
    installUnityStandardMaps(m, {
      hasNormalMap: !!mat.textures['_BumpMap'],
      hasMetalGlossMap: hasGlossMap,
      glossMapScale: f['_GlossMapScale'] ?? 1,
    });

    // Custom-shader materials (report §7.1):
    if (isSplatMaterial(mat.name)) {
      // Shader Forge 4-way splat, blended by vertex colors (col0 → `splat`
      // attribute; backfilled by tools/stages/add_col0_channel.py). NEAR
      // fidelity: albedo layers only (see SplatTerrainMaterial.ts header).
      // Layers tile DIFFERENTLY (base/B×56, R×64, G×48) — per-layer UV scale
      // ratios are wired in applyTextures via setSplatLayerUvScales.
      installSplatTerrainShader(m);
      m.roughness = 0.95;
      m.metalness = 0;
    } else if (mat.name === RIVER_MATERIAL) {
      // Nature/Water — faithful port of the original compiled shader (see
      // RiverWaterMaterial.ts). A ShaderMaterial kept in the same map; callers
      // only touch it through the river helpers.
      const c1 = mat.colors['_Color1'] ?? [0.286, 0.542, 0.794, 1];
      const nrm = mat.textures['_NormalMap'];
      m.dispose();
      return createRiverWaterMaterial({
        flowSpeed: f['_FlowSpeed'] ?? 0.3,
        color1: new THREE.Color().setRGB(c1[0], c1[1], c1[2], THREE.SRGBColorSpace),
        f0: f['_F0'], scatteringHeight: f['_ScatteringHeight'],
        specStrength: f['_SpecStrength'], refractScale: f['_RefractScale'],
        normalScale: nrm?.scale, normalOffset: nrm?.offset,
      }) as unknown as THREE.MeshStandardMaterial;
    }
    return m;
  }

  /** Decode one texture (bytes tracked by caller) and cache the THREE.Texture.
   *  The blob BYTES go through the AssetCache (Cache API) keyed by file URL —
   *  repeat loads decode from local bytes with zero network round-trips. */
  private async loadTexture(
    baseUrl: string, id: string, slot: SceneTextureRef, colorSpace: number,
  ): Promise<void> {
    const rec = this.scene!.textures[id];
    if (!rec) return;
    const url = `${baseUrl}${rec.file}`;
    const buf = await this.assetCache.getOrFetch(url, async () => {
      const res = await fetch(url);
      // Never cache error bodies — a 404 must stay a miss, not poison the key.
      if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
      return res.arrayBuffer();
    });
    const blob = new Blob([buf]);
    // imageOrientation:'flipY' reproduces "three.js default flipY=true" exactly
    // (report §4: UnityPy-upright PNG + flipY + Unity UVs = correct; do not flip again).
    if (this.disposed) return;
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    if (this.disposed) { bitmap.close(); return; }
    const tex = new THREE.Texture(bitmap);
    tex.flipY = false; // already flipped above
    tex.colorSpace = colorSpace === 1 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(slot.scale[0], slot.scale[1]);
    tex.offset.set(slot.offset[0], slot.offset[1]);
    if (this.options.renderer) {
      tex.anisotropy = Math.min(8, this.options.renderer.capabilities.getMaxAnisotropy());
    }
    tex.needsUpdate = true;
    // Upload to the GPU a few MB per frame instead of all-at-once inside the next render.
    if (this.uploads !== null) await this.uploads.enqueue(tex, bitmap.width, bitmap.height);
    if (this.disposed) { tex.dispose(); bitmap.close(); return; } // stage left while this texture was in flight
    this.texturesById.set(`${id}|${slot.scale}|${slot.offset}`, tex);
    this.disposables.push(tex);
  }

  /** Wire decoded textures into material slots (report §8.4 mapping).
   *  Called after EVERY decoded texture (progressive) and once at the end;
   *  a material is only rewired when its resolved texture set changed, so
   *  each material recompiles at most once per newly-arrived slot. */
  private applyTextures(): void {
    if (!this.scene || this.disposed) return;
    const keyOf = (ref?: SceneTextureRef) =>
      ref ? `${ref.texture}|${ref.scale}|${ref.offset}` : '';
    const get = (ref?: SceneTextureRef) =>
      ref ? this.texturesById.get(keyOf(ref)) ?? null : null;
    for (const [matId, m] of this.materials) {
      const mat = this.scene.materials[matId];
      const sig = Object.values(mat.textures).map((r) => (get(r) ? keyOf(r) : '')).join(',');
      if (this.appliedTextureKeys.get(matId) === sig) continue;
      this.appliedTextureKeys.set(matId, sig);
      if (isSplatMaterial(matId)) {
        m.map = get(mat.textures['_Base_Color']);
        // Base DXT5nm normal rides on material.normalMap (defines USE_NORMALMAP +
        // vNormalMapUv); the R/G/B normals and all four gloss maps are splat
        // samplers (shader ISA: SplatTerrainMaterial.ts header).
        m.normalMap = get(mat.textures['_Base_Normal']);
        setSplatLayerTextures(m, {
          r: get(mat.textures['_R_Color']),
          g: get(mat.textures['_G_Color']),
          b: get(mat.textures['_B_Color']),
          nr: get(mat.textures['_R_Normal']),
          ng: get(mat.textures['_G_Normal']),
          nb: get(mat.textures['_B_Normal']),
          gBase: get(mat.textures['_Base_Gloss']),
          gr: get(mat.textures['_R_Gloss']),
          gg: get(mat.textures['_G_Gloss']),
          gb: get(mat.textures['_B_Gloss']),
        });
        // Per-layer tiling differs from base (R×64, G×48 vs base/B×56): give
        // each layer its UV scale ratio (layerScale/baseScale) so the lerp
        // chains align (StageSceneView no longer asserts equal tiling).
        const base = mat.textures['_Base_Color'];
        const ratio = (slot?: { scale: [number, number] }): [number, number] => [
          base && slot ? slot.scale[0] / base.scale[0] : 1,
          base && slot ? slot.scale[1] / base.scale[1] : 1,
        ];
        setSplatLayerUvScales(m, {
          r: ratio(mat.textures['_R_Color']),
          g: ratio(mat.textures['_G_Color']),
          b: ratio(mat.textures['_B_Color']),
        });
      } else if (matId === RIVER_MATERIAL) {
        // Custom uniforms patched live (no recompile). The sky is a CUBEMAP
        // (loadSkyCube in load()), not the exported 2D `_SkyMap` face.
        setRiverTextures(m as unknown as THREE.ShaderMaterial, {
          flow: get(mat.textures['_FlowMap']),
          normal: get(mat.textures['_NormalMap']),
        });
        continue;
      } else {
        m.map = get(mat.textures['_MainTex']);
        m.normalMap = get(mat.textures['_BumpMap']);
        const gloss = get(mat.textures['_MetallicGlossMap']);
        if (gloss) { m.metalnessMap = gloss; m.roughnessMap = gloss; }
        const ao = get(mat.textures['_OcclusionMap']);
        // Unity _UVSec=0 → AO samples UV0. three's aoMap defaults to channel 1
        // (attribute `uv1`), which sliced stage geometry does not carry — left
        // at the default it samples a constant (0,0) texel (white on every
        // stage-1 AO map) and the baked occlusion on hut/logs/deco is lost.
        if (ao) ao.channel = 0;
        m.aoMap = ao;
        m.emissiveMap = get(mat.textures['_EmissionMap']);
      }
      m.needsUpdate = true;
    }
  }

  /** Full GameObject hierarchy with mirrored transforms (report §8.1). */
  private buildHierarchy(scene: SceneFile): void {
    const objects = scene.nodes.map((node) => {
      const o = new THREE.Object3D();
      o.name = node.name;
      o.position.set(-node.pos[0], node.pos[1], node.pos[2]); // x→−x
      o.quaternion.set(node.rot[0], -node.rot[1], -node.rot[2], node.rot[3]); // (x,−y,−z,w)
      o.scale.set(node.scale[0], node.scale[1], node.scale[2]);
      o.visible = node.activeInHierarchy;
      o.userData.nodeIndex = node.i;
      o.userData.layerName = node.layerName;
      if (node.animator) o.userData.animator = true; // Phase-3 animation hook
      return o;
    });
    scene.nodes.forEach((node, i) => {
      if (node.parent >= 0) objects[node.parent].add(objects[i]);
      else this.hierarchy.add(objects[i]);
    });
  }

  private buildLights(scene: SceneFile): void {
    const worldPos = (nodeIndex: number): THREE.Vector3 => {
      // Compose authored world transform down the parent chain (LH), then mirror.
      const p = new THREE.Vector3();
      let i = nodeIndex;
      const chain: SceneNode[] = [];
      while (i >= 0) { chain.unshift(scene.nodes[i]); i = scene.nodes[i].parent; }
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const scl = new THREE.Vector3(1, 1, 1);
      for (const n of chain) {
        const lp = new THREE.Vector3(n.pos[0] * scl.x, n.pos[1] * scl.y, n.pos[2] * scl.z);
        lp.applyQuaternion(rot);
        pos.add(lp);
        rot.multiply(new THREE.Quaternion(n.rot[0], n.rot[1], n.rot[2], n.rot[3]));
        scl.multiply(new THREE.Vector3(n.scale[0], n.scale[1], n.scale[2]));
      }
      p.set(-pos.x, pos.y, pos.z); // mirror
      return p;
    };
    const worldQuat = (nodeIndex: number): THREE.Quaternion => {
      let i = nodeIndex;
      const chain: SceneNode[] = [];
      while (i >= 0) { chain.unshift(scene.nodes[i]); i = scene.nodes[i].parent; }
      const rot = new THREE.Quaternion();
      for (const n of chain) {
        rot.multiply(new THREE.Quaternion(n.rot[0], n.rot[1], n.rot[2], n.rot[3]));
      }
      // mirror a Unity quat: (x, −y, −z, w)
      return new THREE.Quaternion(rot.x, -rot.y, -rot.z, rot.w);
    };

    // Shadow policy — probed from the shipped `stages` bundle (UnityPy,
    // Light.m_Shadows on BuildPlayer-3d_stage_001_env): ONLY the main
    // "Directional Light" casts shadows (m_Type=2 Soft, m_Strength=0.8,
    // m_Bias=0.05, m_NormalBias=0.4, m_NearPlane=0.2). Both "Directional
    // Light(Lim)" fills and Pointlight_Lim are m_Type=0 (shadows OFF).
    // scene.json exports no per-light shadow flags, so select the caster by
    // the original's name; other scenes fall back to the brightest directional.
    const directionals = scene.lights.filter((L) => L.enabled && L.type === 1);
    const shadowCaster = directionals.find((L) => L.name === 'Directional Light')
      ?? (directionals.length
        ? directionals.reduce((a, b) => (b.intensity > a.intensity ? b : a))
        : null);
    const bounds = this.stageBounds(scene);

    for (const L of scene.lights) {
      if (!L.enabled) continue;
      const color = new THREE.Color().setRGB(L.color[0], L.color[1], L.color[2], THREE.SRGBColorSpace);
      if (L.type === 1) {
        // Unity's Standard BRDF omits the 1/PI of Lambert (light colour is
        // implicitly PI-scaled); three's physical lights keep it -> x PI to
        // match (docs/GRADING_AND_SURFACE_ANALYSIS.md, "Lighting units").
        const light = new THREE.DirectionalLight(color, L.intensity * Math.PI);
        light.name = L.name;
        // Unity directional: shines along node +Z (LH). Mirror the direction.
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat(L.node)).normalize();
        const pos = worldPos(L.node);
        light.target.position.copy(pos);
        if (L === shadowCaster) {
          light.castShadow = true;
          light.shadow.mapSize.set(2048, 2048);
          light.shadow.intensity = 0.8;  // Unity m_Shadows.m_Strength
          // Tuning aid (original shadows read darker than ours): ?shadow=0..1 overrides the strength live.
          try { const q = Number(new URLSearchParams(location.search).get('shadow')); if (q > 0 && q <= 1) light.shadow.intensity = q; } catch { /* non-browser */ }
          light.shadow.normalBias = 0.4; // Unity m_Shadows.m_NormalBias (world units)
          // TS ADAPTATION: Unity m_Bias=0.05 → three normalized-depth bias.
          // Small negative offset; the world-unit normalBias carries acne
          // suppression (exact depth-bias mapping needs visual confirmation).
          light.shadow.bias = -0.0005;
          this.fitShadowCamera(light, fwd, pos, bounds);
        } else {
          // Fill/rim light: direction only, no shadow map (original m_Type=0).
          light.position.copy(fwd.clone().multiplyScalar(-50).add(pos));
        }
        this.draws.add(light.target);
        this.lights.push(light);
      } else if (L.type === 2) {
        const light = new THREE.PointLight(color, L.intensity, L.range);
        light.name = L.name;
        light.position.copy(worldPos(L.node));
        this.lights.push(light);
      }
      // type 0 (spot): none in this scene.
    }
    for (const light of this.lights) this.draws.add(light);
  }

  /** Mirrored world-space AABB of the renderable baked meshes — the shadow
   *  frustum fit target. Same renderable filter as load(). Null when nothing
   *  is baked (caller keeps the legacy fixed frustum). */
  private stageBounds(scene: SceneFile): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    let any = false;
    for (const node of scene.nodes) {
      const r = node.render;
      if (!r || !node.activeInHierarchy || !r.enabled || (r.lodLevel !== 0 && r.lodLevel !== null)) continue;
      const mesh = scene.meshes[r.mesh];
      if (!mesh || !mesh.bakedWorldSpace) continue;
      any = true;
      // mirror x: viewMin = -dataMax, viewMax = -dataMin
      min.x = Math.min(min.x, -mesh.bounds.max[0]);
      max.x = Math.max(max.x, -mesh.bounds.min[0]);
      min.y = Math.min(min.y, mesh.bounds.min[1]);
      max.y = Math.max(max.y, mesh.bounds.max[1]);
      min.z = Math.min(min.z, mesh.bounds.min[2]);
      max.z = Math.max(max.z, mesh.bounds.max[2]);
    }
    return any ? { min, max } : null;
  }

  /** Fit the shadow ortho camera to the stage's mirrored world bounds. The
   *  old fixed ±80 frustum clipped the stage (light-space extents reach ±95;
   *  the river's upper bank sits at X≈−81 → land near the water got NO
   *  shadows), and near=1 with the light only 50 units out left light-side
   *  geometry behind the near plane (depth −6.7). Pull the light back along
   *  its own axis until the whole stage is in front of near — directional
   *  illumination is unchanged by translation along the light axis. */
  private fitShadowCamera(
    light: THREE.DirectionalLight, fwd: THREE.Vector3, anchor: THREE.Vector3,
    bounds: { min: THREE.Vector3; max: THREE.Vector3 } | null,
  ): void {
    const cam = light.shadow.camera;
    if (!bounds) {
      cam.left = -80; cam.right = 80; cam.top = 80; cam.bottom = -80;
      cam.near = 1; cam.far = 220;
      light.position.copy(fwd.clone().multiplyScalar(-50).add(anchor));
      return;
    }
    // Light-space basis (three lookAt convention: camera looks down -Z).
    const z = fwd.clone().negate();
    const up = Math.abs(z.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const x = up.cross(z).normalize();
    const y = z.clone().cross(x);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    let dMin = Infinity, dMax = -Infinity;
    const rel = new THREE.Vector3();
    for (let ci = 0; ci < 8; ci++) {
      rel.set(
        (ci & 1 ? bounds.max : bounds.min).x,
        (ci & 2 ? bounds.max : bounds.min).y,
        (ci & 4 ? bounds.max : bounds.min).z,
      ).sub(anchor);
      xMin = Math.min(xMin, rel.dot(x)); xMax = Math.max(xMax, rel.dot(x));
      yMin = Math.min(yMin, rel.dot(y)); yMax = Math.max(yMax, rel.dot(y));
      const depth = rel.dot(fwd);
      dMin = Math.min(dMin, depth); dMax = Math.max(dMax, depth);
    }
    const pad = 2; // world-unit margin so edge texels never clip
    const backoff = Math.max(0, -dMin) + 10;
    cam.left = xMin - pad; cam.right = xMax + pad;
    cam.bottom = yMin - pad; cam.top = yMax + pad;
    cam.near = 1; cam.far = dMax + backoff + 10;
    light.position.copy(fwd.clone().multiplyScalar(-backoff).add(anchor));
  }

  dispose(): void {
    this.disposed = true;
    this.uploads?.cancel();
    this.releaseBlockingRef?.();
    for (const d of this.disposables) d.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.group.removeFromParent();
  }
}

/** Concatenate same-layout geometries (pos/nrm/uv/tan + index). */
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const attrNames = ['position', 'normal', 'uv', 'tangent', 'splat'] as const;
  const present = attrNames.filter((a) => geoms.every((g) => g.getAttribute(a)));
  const merged = new THREE.BufferGeometry();
  let vertOffset = 0;
  let indexTotal = 0;
  for (const g of geoms) indexTotal += g.getIndex()!.count;
  const index = new Uint32Array(indexTotal);
  let indexOffset = 0;
  const slices = geoms.map((g) => {
    const count = g.getAttribute('position').count;
    const s = { g, vertOffset, count };
    const gi = g.getIndex()!;
    for (let k = 0; k < gi.count; k++) index[indexOffset + k] = gi.getX(k) + vertOffset;
    indexOffset += gi.count;
    vertOffset += count;
    return s;
  });
  for (const name of present) {
    const itemSize = geoms[0].getAttribute(name).itemSize;
    const out = new Float32Array(vertOffset * itemSize);
    for (const s of slices) {
      const src = s.g.getAttribute(name) as THREE.BufferAttribute;
      out.set(src.array as Float32Array, s.vertOffset * itemSize);
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}
