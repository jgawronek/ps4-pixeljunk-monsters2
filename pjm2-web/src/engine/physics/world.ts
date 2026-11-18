/**
 * PhysicsWorld — static-collider query world for the pjm2-web port.
 *
 * The ported simulation (source of truth: decomp/src/GameCore/*.cs) uses ONLY
 * scene queries against STATIC colliders:
 *   Physics.Linecast / Physics.Raycast / Physics.SphereCast / Physics.CheckSphere
 * There is NO rigidbody dynamics — Rapier is used purely as a static-collider
 * query engine. world.step() is called exactly once after loading so the query
 * pipeline (QBVH) sees the freshly created colliders; it is never stepped for
 * simulation (gravity is zeroed, there are no rigid bodies).
 *
 * DETERMINISM: pinned to @dimforge/rapier3d-compat **0.14.0** (see
 * package.json). The WASM binary ships inside the JS package; for identical
 * inputs the query results are deterministic and platform-independent.
 *
 * COORDINATES: Unity LEFT-HANDED Y-up, kept exactly as extracted (the parity
 * ground truth — enemy m_pathList points — is in the same frame). Right-handed
 * conversion, if ever needed, belongs to the renderer only. Because we keep the
 * numbers untouched and Unity's vector/quaternion algebra is formula-identical
 * to standard algebra, rotations/normals come out correct with no conversion.
 *
 * COLLISION GROUPS / LAYER MASKS: Unity supports 32 layers; Rapier's
 * InteractionGroups membership half is only 16 bits, so a faithful 1:1
 * layer→group mapping is impossible. CHOSEN SCHEME (documented per task):
 * every static collider is created with groups = 0xFFFFFFFF (interacts with
 * everything) and queries carry a Unity-style 32-bit layerMask that is applied
 * via Rapier's `filterPredicate` callback in JS. The predicate is evaluated
 * per candidate INSIDE the query traversal, so "closest hit that passes the
 * mask" semantics are preserved exactly (unlike a naive post-filter of a
 * single closest hit). This is acceptable because the sim's masks are coarse
 * and the static collider count per stage is small (stage 001: ~590).
 *
 * TRIGGER PARITY: colliders flagged isTrigger in the extraction ARE loaded
 * (marked in userData) but every query skips them by default
 * (QueryTriggerInteraction.Ignore parity — the GameCore call sites either pass
 * Ignore explicitly or use the default, and the shipped game never sets
 * Physics.queriesHitTriggers = false; the few QueryTriggerInteraction.Collide
 * sites in GameCoreFruit can opt in per query).
 *
 * MESH SCALING: Rapier trimesh colliders do NOT support per-collider scale, so
 * this loader PRE-MULTIPLIES mesh vertices by the collider's world scale
 * before creating the trimesh, and uses pos/rot for the Isometry. (Extracted
 * stage-001 scales are uniform per collider; a scaled mesh is cached per
 * (meshRef, scale) so shared meshes with different scales do not alias.)
 */

import RAPIER from '@dimforge/rapier3d-compat';

import { qmul, qrotate, qAxisAngle } from './mathx.js';
import type { Quat, Vec3 } from './mathx.js';

// ---------------------------------------------------------------- JSON schema
// Mirrors the output of tools/colliders/extract_stage_colliders.py.

export type ExtractedColliderKind =
  | 'mesh' | 'box' | 'sphere' | 'capsule'
  | 'terrain' | 'edge' | 'wheel' | 'character';

export interface ExtractedTransform {
  /** World position (Unity left-handed Y-up, as-is). */
  pos: Vec3;
  /** World rotation quaternion, Unity [x, y, z, w] order. */
  rot: Quat;
  /** World lossy scale (decomposed; extractor verified no shear). */
  scale: Vec3;
}

export interface ExtractedCollider {
  kind: ExtractedColliderKind;
  name: string;
  layer: number;
  layerName: string;
  enabled: boolean;
  isTrigger: boolean;
  activeInHierarchy: boolean;
  hasRigidbody: boolean;
  /** terrain/edge/wheel/character records are report-only (no shape data). */
  reportedOnly?: boolean;
  transform?: ExtractedTransform;
  center?: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  /** Unity CapsuleCollider direction: 0=X, 1=Y, 2=Z. */
  direction?: number;
  convex?: boolean;
  meshRef?: string | null;
}

export interface ExtractedMeshMeta {
  name: string;
  sourceFile: string;
  pathId: number;
  vertexCount: number;
  triangleCount: number;
  /** Paths relative to the JSON file's directory. */
  vertsFile: string;
  idxFile: string;
}

export interface Q4LayersData {
  note: string;
  indices: Record<string, number>;
  /** Signed int32 values, exactly like Unity LayerMask.value. */
  masks: Record<string, number>;
  masksUnsigned: Record<string, number>;
}

export interface StageCollidersJson {
  meta: Record<string, string>;
  q4Layers: Q4LayersData;
  unityLayers: string[];
  layers: Record<string, number>;
  colliders: ExtractedCollider[];
  meshes: Record<string, ExtractedMeshMeta>;
}

/** Metadata attached to every created Rapier collider (also its `userData`). */
export interface StaticColliderInfo {
  name: string;
  layer: number;
  layerName: string;
  isTrigger: boolean;
  kind: ExtractedColliderKind;
}

// ---------------------------------------------------------------- world class

const ALL_GROUPS = 0xffffffff;

export class PhysicsWorld {
  readonly rapier: typeof RAPIER;
  readonly world: RAPIER.World;
  readonly q4Layers: Q4LayersData;
  readonly unityLayers: string[];
  readonly colliderInfo = new Map<number, StaticColliderInfo>();

  private meshBufferCache = new Map<string, { verts: Float32Array; idx: Uint32Array }>();
  private scaledMeshCache = new Map<string, { verts: Float32Array; idx: Uint32Array }>();

  private constructor(rapier: typeof RAPIER, json: StageCollidersJson) {
    this.rapier = rapier;
    // Gravity is never used (no dynamics, no simulation stepping) — zero it so
    // the single pipeline-update step() cannot move anything by construction.
    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    this.q4Layers = json.q4Layers;
    this.unityLayers = json.unityLayers;
  }

  /** Convenience: TerrainMask as reconstructed from the Q4.Layers singleton. */
  get terrainMask(): number {
    return this.q4Layers.masks['TerrainMask'] | 0;
  }

  /** Convenience: WaterMask as reconstructed from the Q4.Layers singleton. */
  get waterMask(): number {
    return this.q4Layers.masks['WaterMask'] | 0;
  }

  /** Initialize the Rapier WASM backend (idempotent). */
  static async init(): Promise<void> {
    await RAPIER.init();
  }

  /**
   * Load a stage extraction: `jsonPath` is the `{stage}_colliders.json` produced
   * by tools/colliders/extract_stage_colliders.py. Mesh binaries resolve
   * relative to the JSON's directory.
   */
  static async load(
    jsonPath: string,
    opts: { loader?: FileLoader } = {},
  ): Promise<PhysicsWorld> {
    const base = dirname(jsonPath);
    const loader = opts.loader ?? defaultFileLoader(base);
    const jsonBuf = await loader(base === '.' ? jsonPath : jsonPath.slice(base.length + 1));
    const json = JSON.parse(new TextDecoder().decode(jsonBuf)) as StageCollidersJson;
    return PhysicsWorld.fromJson(json, loader);
  }

  /** Build a world from an already-parsed extraction JSON. */
  static async fromJson(
    json: StageCollidersJson,
    loadBinary: FileLoader,
  ): Promise<PhysicsWorld> {
    await RAPIER.init();
    const pw = new PhysicsWorld(RAPIER, json);

    // Pre-load every referenced mesh buffer once (validating sizes).
    for (const [id, meta] of Object.entries(json.meshes)) {
      const [vb, ib] = await Promise.all([
        loadBinary(meta.vertsFile),
        loadBinary(meta.idxFile),
      ]);
      if (vb.byteLength % 4 !== 0 || ib.byteLength % 4 !== 0) {
        throw new Error(`mesh ${id}: binary buffer size not a multiple of 4 bytes`);
      }
      const verts = new Float32Array(vb);
      const idx = new Uint32Array(ib);
      if (verts.length !== meta.vertexCount * 3) {
        throw new Error(`mesh ${id}: expected ${meta.vertexCount * 3} floats, got ${verts.length}`);
      }
      if (idx.length !== meta.triangleCount * 3) {
        throw new Error(`mesh ${id}: expected ${meta.triangleCount * 3} indices, got ${idx.length}`);
      }
      pw.meshBufferCache.set(id, { verts, idx });
    }

    for (const c of json.colliders) {
      pw.addCollider(c);
    }

    // REQUIRED: queries only see colliders after the query pipeline updates.
    // world.step() with zero gravity, zero rigid bodies and all-static
    // colliders is a pure broadphase/query-pipeline refresh (verified
    // empirically: queries return null before the first step).
    pw.world.step();
    return pw;
  }

  private addCollider(c: ExtractedCollider): void {
    if (c.reportedOnly) return; // terrain/edge/wheel/character: reported, not simulated
    if (!c.enabled) return;
    if (!c.activeInHierarchy) return;
    // Colliders owned by a Rigidbody are dynamic props in the original game
    // (guide/shop/stone); the sim only queries STATIC scene colliders.
    if (c.hasRigidbody) return;
    const t = c.transform;
    if (!t) return;

    let desc: RAPIER.ColliderDesc | null = null;

    if (c.kind === 'mesh' && c.meshRef) {
      const buffers = this.getScaledMesh(c.meshRef, t.scale);
      if (!buffers) return;
      // Rapier trimesh ignores per-collider scale → vertices pre-multiplied by
      // world scale (see getScaledMesh); the isometry carries pos/rot only.
      desc = RAPIER.ColliderDesc.trimesh(buffers.verts, buffers.idx)
        .setTranslation(t.pos[0], t.pos[1], t.pos[2])
        .setRotation(toRapierRot(t.rot));
    } else if (c.kind === 'box' && c.center && c.size) {
      const s = t.scale;
      const hx = Math.abs(c.size[0] * s[0]) / 2;
      const hy = Math.abs(c.size[1] * s[1]) / 2;
      const hz = Math.abs(c.size[2] * s[2]) / 2;
      if (hx <= 0 || hy <= 0 || hz <= 0) return;
      const world = worldPoint(t, c.center);
      desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(world[0], world[1], world[2])
        .setRotation(toRapierRot(t.rot));
    } else if (c.kind === 'sphere' && c.center !== undefined && c.radius !== undefined) {
      const s = t.scale;
      // Unity scales SphereCollider.radius by the largest lossyScale component.
      const r = c.radius * Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
      if (r <= 0) return;
      const world = worldPoint(t, c.center);
      desc = RAPIER.ColliderDesc.ball(r)
        .setTranslation(world[0], world[1], world[2])
        .setRotation(toRapierRot(t.rot));
    } else if (
      c.kind === 'capsule' && c.center !== undefined &&
      c.radius !== undefined && c.height !== undefined
    ) {
      const dir = c.direction ?? 1;
      const s = t.scale;
      const along = Math.abs(s[dir]);
      const perp = Math.max(Math.abs(s[(dir + 1) % 3]), Math.abs(s[(dir + 2) % 3]));
      const radius = c.radius * perp;
      // Unity capsule `height` is the TOTAL height including both caps.
      const halfHeight = Math.max((c.height * along) / 2 - radius, 1e-6);
      if (radius <= 0) return;
      const world = worldPoint(t, c.center);
      // Rapier capsules are Y-aligned. Compose the world rotation with a fix-up
      // that maps Rapier's local +Y onto Unity's capsule axis:
      //   X → rotate -90° about Z   ( (0,1,0) → (1,0,0) )
      //   Z → rotate +90° about X   ( (0,1,0) → (0,0,1) )
      // Quaternion algebra is identical in both engines (numbers kept as-is).
      let rot: Quat = t.rot;
      if (dir === 0) rot = qmul(t.rot, qAxisAngle([0, 0, 1], -90));
      else if (dir === 2) rot = qmul(t.rot, qAxisAngle([1, 0, 0], 90));
      desc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setTranslation(world[0], world[1], world[2])
        .setRotation(toRapierRot(rot));
    }

    if (!desc) return;
    desc = desc.setCollisionGroups(ALL_GROUPS); // see COLLISION GROUPS note above
    const collider = this.world.createCollider(desc);
    const info: StaticColliderInfo = {
      name: c.name,
      layer: c.layer,
      layerName: c.layerName,
      isTrigger: c.isTrigger,
      kind: c.kind,
    };
    // NOTE: rapier 0.14 typings omit Collider.userData (it exists at runtime);
    // we keep our own handle→info map instead — type-safe and lookup is O(1).
    this.colliderInfo.set(collider.handle, info);
  }

  /** Mesh buffers with world scale pre-multiplied into the vertices. */
  private getScaledMesh(
    meshRef: string,
    scale: Vec3,
  ): { verts: Float32Array; idx: Uint32Array } | null {
    const base = this.meshBufferCache.get(meshRef);
    if (!base) return null;
    const unit =
      Math.abs(scale[0] - 1) < 1e-9 &&
      Math.abs(scale[1] - 1) < 1e-9 &&
      Math.abs(scale[2] - 1) < 1e-9;
    if (unit) return base;
    const key = `${meshRef}|${scale[0]},${scale[1]},${scale[2]}`;
    let scaled = this.scaledMeshCache.get(key);
    if (!scaled) {
      const v = new Float32Array(base.verts.length);
      for (let i = 0; i < v.length; i += 3) {
        v[i] = base.verts[i] * scale[0];
        v[i + 1] = base.verts[i + 1] * scale[1];
        v[i + 2] = base.verts[i + 2] * scale[2];
      }
      scaled = { verts: v, idx: base.idx };
      this.scaledMeshCache.set(key, scaled);
    }
    return scaled;
  }

  /** Number of colliders currently in the Rapier world. */
  colliderCount(): number {
    return this.world.colliders.len();
  }

  free(): void {
    this.world.free();
    this.colliderInfo.clear();
    this.meshBufferCache.clear();
    this.scaledMeshCache.clear();
  }
}

// ------------------------------------------------------------------- helpers

/** Local point (e.g. collider center) → world, honoring scale then rotation. */
function worldPoint(t: ExtractedTransform, local: Vec3): Vec3 {
  const scaled: Vec3 = [local[0] * t.scale[0], local[1] * t.scale[1], local[2] * t.scale[2]];
  const r = qrotate(t.rot, scaled);
  return [t.pos[0] + r[0], t.pos[1] + r[1], t.pos[2] + r[2]];
}

function toRapierRot(q: Quat): RAPIER.Rotation {
  return { x: q[0], y: q[1], z: q[2], w: q[3] };
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '.' : p.slice(0, i);
}

/** Loads a file (relative to the stage JSON's directory) as an ArrayBuffer. */
export type FileLoader = (relPath: string) => Promise<ArrayBuffer>;

/**
 * Default FileLoader: Node fs when running under Node (tests, tools), fetch
 * otherwise (browser, paths resolved relative to the page). NOTE for the web
 * build: the extraction output must be published under a servable directory;
 * callers can always inject a custom loader.
 */
export function defaultFileLoader(baseDir: string): FileLoader {
  const join = (rel: string): string => `${baseDir}/${rel}`;
  const isNode =
    typeof process !== 'undefined' &&
    !!(process as { versions?: { node?: string } }).versions?.node;
  if (isNode) {
    return async (rel: string): Promise<ArrayBuffer> => {
      const { readFile } = await import('node:fs/promises');
      const buf = await readFile(join(rel));
      // Copy into a standalone ArrayBuffer (Buffer may be a pooled view).
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      return ab;
    };
  }
  return async (rel: string): Promise<ArrayBuffer> => {
    const res = await fetch(join(rel));
    if (!res.ok) throw new Error(`failed to fetch ${join(rel)}: ${res.status}`);
    return res.arrayBuffer();
  };
}

/**
 * One-shot convenience: init WASM, load the stage JSON from `jsonPath`.
 * Mesh binaries resolve relative to the JSON's directory.
 */
export async function loadStageWorld(
  jsonPath: string,
  opts: { loader?: FileLoader } = {},
): Promise<PhysicsWorld> {
  return PhysicsWorld.load(jsonPath, opts);
}
