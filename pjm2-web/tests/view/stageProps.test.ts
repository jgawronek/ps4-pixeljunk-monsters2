// tests/view/stageProps.test.ts
// Stage-prop rendering + shadow fidelity contract (iter stage-props).
// Node-only: synthetic scene + fake fetch (createImageBitmap stubbed), in the
// style of loadPerf.test.ts. Evidence anchors (all DATA, probed read-only):
//
//   - stages bundle Light.m_Shadows (UnityPy, BuildPlayer-3d_stage_001_env):
//     main "Directional Light" = Soft shadows, strength 0.8, bias 0.05,
//     normalBias 0.4; both "Directional Light(Lim)" fills + Pointlight_Lim
//     = m_Type 0 (shadows OFF).
//   - scene-webp.json: stage AABB (baked meshes) spans x[-66.6,64.0],
//     z[-68.9,68.3]; in main-light space the extents reach ±95 and the
//     river's upper bank sits at X≈−81 → the old fixed ±80 shadow frustum
//     clipped exactly the land near the water (user-reported gap).
//   - home_001_m / deco_*_m are Standard with _MainTex/_BumpMap/
//     _MetallicGlossMap/_OcclusionMap; Unity _UVSec=0 → AO reads UV0, but
//     three's aoMap defaults to channel 1 (`uv1`, absent on sliced geometry).
//   - hut node 1956 (home_001_LOD0): identity transform chain, baked
//     world-space submesh 153 — mirror + winding flip must keep face normals
//     consistent with the stored (mirrored) vertex normals.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { StageSceneView } from '../../src/view/stage/StageSceneView';

const BASE = 'http://stage.test/assets/stages/prop_stage/';

// Real stage-1 bounds (scene-webp.json, Combined_Mesh_root_scene_6/7) and
// light node transforms (nodes 874/875/876) — the shadow fit must cover them.
const STAGE_MIN: [number, number, number] = [-66.56227111816406, -6.806394577026367, -68.86244201660156];
const STAGE_MAX: [number, number, number] = [64.04500579833984, 4.0880126953125, 68.32396697998047];

// ---------------------------------------------------------------------------
// synthetic scene (deterministic channel data — no Math.random)
// ---------------------------------------------------------------------------

function genericChannels(vertexCount: number, indexCount: number, seed: number) {
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Float32Array(vertexCount * 3);
  const uv0 = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    pos.set([Math.fround(seed + i), Math.fround(i * 0.5), Math.fround(seed - i)], i * 3);
    nrm.set([0, 1, 0], i * 3);
    uv0.set([Math.fround(i * 0.1), Math.fround(i * 0.2)], i * 2);
  }
  const idx = new Uint32Array([0, 1, 2, 0, 2, 3].slice(0, indexCount));
  const col0 = new Uint8Array(vertexCount * 4);
  for (let i = 0; i < col0.length; i++) col0[i] = (seed + i * 7) % 256;
  return { pos, nrm, uv0, idx, col0 };
}

function synthScene() {
  // Home prop: hand-known single triangle. Raw LH winding (0,2,1) with +Y
  // normals → after x-mirror + winding flip the RH face normal must equal
  // the mirrored stored normal (+Y).
  const home = {
    pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    nrm: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uv0: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    idx: new Uint32Array([0, 2, 1]),
  };
  const terrain = genericChannels(4, 6, 11);
  const deco = genericChannels(4, 6, 29);
  const meshDef = (
    id: string, vertexCount: number, indexCount: number,
    channels: string[], bounds: { min: number[]; max: number[] },
  ) => {
    const files: Record<string, string> = {};
    for (const ch of channels) {
      files[ch] = `meshes/${id}.${ch}.${ch === 'idx' ? 'u32' : ch === 'col0' ? 'u8' : 'f32'}.bin`;
    }
    return {
      name: id, vertexCount, indexCount, triangleCount: indexCount / 3,
      submeshes: [{ firstIndex: 0, indexCount, topology: 0 }],
      files, channels, bounds,
      combined: true, bakedWorldSpace: true, colliderOnly: false,
    };
  };
  const meshes: Record<string, unknown> = {
    terrain: meshDef('terrain', 4, 6, ['pos', 'nrm', 'uv0', 'idx', 'col0'],
      { min: [...STAGE_MIN], max: [...STAGE_MAX] }),
    home: meshDef('home', 3, 3, ['pos', 'nrm', 'uv0', 'idx'],
      { min: [-1.72, -0.01, -1.53], max: [1.72, 1.76, 1.53] }),
    deco: meshDef('deco', 4, 6, ['pos', 'nrm', 'uv0', 'idx'],
      { min: [10, 0, 10], max: [12, 3, 12] }),
  };
  const render = (mesh: string, mat: string) => ({
    mesh, materials: [mat], enabled: true, lodLevel: 0,
    worldSpace: true, subMesh: null, castShadows: 1, receiveShadows: 1,
  });
  const node = (i: number, name: string, extra: Record<string, unknown> = {}) => ({
    i, name, parent: -1, activeSelf: true, activeInHierarchy: true,
    layerName: 'Art_Terrain', pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
    animator: false, render: null, ...extra,
  });
  const nodes = [
    node(0, 'terrain_001', { render: render('terrain', 'terrain_001_m') }),
    node(1, 'home_001_LOD0', { render: render('home', 'home_001_m') }),
    node(2, 'deco_003_01_LOD0', { render: render('deco', 'deco_003_m') }),
    node(3, 'Directional Light', { pos: [0, 3, 0], rot: [0.470, 0.248, -0.061, 0.845] }),
    node(4, 'Directional Light(Lim)', { pos: [11.34, 1.3, 7.66], rot: [0.633, -0.742, -0.012, 0.220] }),
    node(5, 'Directional Light(Lim) (2)', { pos: [-0.96, 1.98, 5.74], rot: [0.595, -0.576, 0.513, -0.227] }),
    node(6, 'Pointlight_Lim', { pos: [0, 2, 0] }),
  ];
  const slot = (id: string) => ({ texture: id, scale: [1, 1], offset: [0, 0] });
  const standard = (name: string, prefix: string) => ({
    name, shader: { name: 'Standard' },
    textures: {
      _MainTex: slot(`${prefix}_Color`), _BumpMap: slot(`${prefix}_Normal`),
      _MetallicGlossMap: slot(`${prefix}_Metal`), _OcclusionMap: slot(`${prefix}_AO`),
    },
    floats: { _Metallic: 0, _Glossiness: 0.5, _Mode: 0, _Cutoff: 0.5, _GlossMapScale: 1 },
    colors: { _Color: [1, 1, 1, 1], _EmissionColor: [0, 0, 0, 1] },
  });
  const materials: Record<string, unknown> = {
    terrain_001_m: {
      name: 'terrain_001_m', shader: { name: 'Shader Forge/Splatt_Normal_Gloss' },
      textures: {
        _Base_Color: slot('tBase'), _R_Color: slot('tR'), _G_Color: slot('tG'), _B_Color: slot('tB'),
      },
      floats: {}, colors: { _Color: [1, 1, 1, 1] },
    },
    home_001_m: standard('home_001_m', 'home_001'),
    deco_003_m: standard('deco_003_m', 'deco_003'),
  };
  const tex = (id: string, colorSpace: number) => ({
    name: id, width: 2, height: 2, colorSpace,
    file: `textures_webp/${id}.webp`, bytes: 100,
  });
  const textures: Record<string, unknown> = {};
  for (const p of ['home_001', 'deco_003']) {
    textures[`${p}_Color`] = tex(`${p}_Color`, 1);
    textures[`${p}_Normal`] = tex(`${p}_Normal`, 0);
    textures[`${p}_Metal`] = tex(`${p}_Metal`, 1);
    textures[`${p}_AO`] = tex(`${p}_AO`, 1);
  }
  for (const id of ['tBase', 'tR', 'tG', 'tB']) textures[id] = tex(id, 1);
  const light = (name: string, nodeIdx: number, type: number, intensity: number) => ({
    name, node: nodeIdx, type, enabled: true, color: [1, 1, 1], intensity, range: 10,
  });
  const lights = [
    light('Directional Light', 3, 1, 1.5),
    light('Directional Light(Lim)', 4, 1, 0.5),
    light('Directional Light(Lim) (2)', 5, 1, 0.5),
    light('Pointlight_Lim', 6, 2, 1),
  ];
  const scene = { meta: { stage: 'prop_stage' }, nodes, meshes, materials, textures, lights };
  // channel bytes keyed by the file strings in meshes[].files
  const fileToData = new Map<string, ArrayBufferView>();
  const dataFor: Record<string, Record<string, ArrayBufferView>> = { terrain, home, deco };
  for (const [id, meta] of Object.entries(meshes) as Array<[string, { files: Record<string, string> }]>) {
    for (const [ch, rel] of Object.entries(meta.files)) fileToData.set(rel, dataFor[id][ch]);
  }
  return { scene, fileToData };
}

function makeHarness(scene: ReturnType<typeof synthScene>['scene'], fileToData: Map<string, ArrayBufferView>) {
  const fetchImpl = async (input: unknown): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('.gz')) return new Response(null, { status: 404 });
    if (url.endsWith('scene.json') || url.endsWith('scene-webp.json')) {
      return new Response(JSON.stringify(scene));
    }
    if (url.endsWith('meshes-pack.json')) return new Response(null, { status: 404 }); // per-file path
    if (url.includes('/meshes/')) {
      const rel = url.slice(BASE.length);
      const data = fileToData.get(rel);
      if (!data) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
    }
    if (url.includes('/textures_webp/')) return new Response(new Uint8Array([1, 2, 3, 4]));
    return new Response(null, { status: 404 });
  };
  return fetchImpl;
}

async function loadView(opts: { merge?: boolean } = {}) {
  const { scene, fileToData } = synthScene();
  vi.stubGlobal('fetch', makeHarness(scene, fileToData));
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
  const view = new StageSceneView({
    baseUrl: BASE, textureConcurrency: 2,
    ...(opts.merge === undefined ? {} : { mergeByMaterial: opts.merge }),
  });
  await view.load();
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// shadows
// ---------------------------------------------------------------------------

describe('stage shadows', () => {
  it('terrain receives shadows in both merge paths (splat ground is a receiver)', async () => {
    const merged = await loadView();
    const terrain = merged.draws.children.find((c) => c.name === 'merged:terrain_001_m') as THREE.Mesh;
    expect(terrain).toBeDefined();
    expect(terrain.receiveShadow).toBe(true);
    expect(terrain.castShadow).toBe(true); // render data castShadows=1
    expect(merged.terrainPickMeshes).toContain(terrain);
    merged.dispose();

    const split = await loadView({ merge: false });
    const terrainSplit = split.draws.children.find((c) => c.name === 'terrain_001') as THREE.Mesh;
    expect(terrainSplit.receiveShadow).toBe(true);
    expect(terrainSplit.castShadow).toBe(true);
    split.dispose();
  });

  it('only the main sun casts shadows, with the original strength/bias (Lim fills OFF)', async () => {
    const view = await loadView();
    const casters = view.lights.filter((l) => l.castShadow);
    expect(casters.length).toBe(1);
    const sun = casters[0] as THREE.DirectionalLight;
    expect(sun.name).toBe('Directional Light');
    expect(sun.shadow.intensity).toBe(0.8);   // Unity m_Shadows.m_Strength
    expect(sun.shadow.normalBias).toBe(0.4);  // Unity m_Shadows.m_NormalBias
    expect(sun.shadow.bias).toBeLessThan(0);  // acne offset (TS adaptation)
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.mapSize.y).toBe(2048);
    const fills = view.lights.filter(
      (l) => l instanceof THREE.DirectionalLight && l.name.startsWith('Directional Light(Lim)'),
    );
    expect(fills.length).toBe(2);
    for (const f of fills) expect(f.castShadow).toBe(false);
    expect(view.lights.some((l) => l instanceof THREE.PointLight && l.name === 'Pointlight_Lim')).toBe(true);
    view.dispose();
  });

  it('shadow frustum covers the whole stage — river banks included — with nothing behind near', async () => {
    const view = await loadView();
    const sun = view.lights.find((l) => l.castShadow) as THREE.DirectionalLight;
    const cam = sun.shadow.camera;
    // Reproduce what WebGLShadowMap does each frame (updateMatrices).
    cam.position.copy(sun.position);
    cam.lookAt(sun.target.position);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    // Mirrored stage AABB (x → −x), all 8 corners in shadow-camera space.
    const min = new THREE.Vector3(-STAGE_MAX[0], STAGE_MIN[1], STAGE_MIN[2]);
    const max = new THREE.Vector3(-STAGE_MIN[0], STAGE_MAX[1], STAGE_MAX[2]);
    let maxAbsX = 0;
    const p = new THREE.Vector3();
    for (let ci = 0; ci < 8; ci++) {
      p.set(ci & 1 ? max.x : min.x, ci & 2 ? max.y : min.y, ci & 4 ? max.z : min.z);
      p.applyMatrix4(cam.matrixWorldInverse);
      maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
      expect(p.x).toBeGreaterThanOrEqual(cam.left - 1e-6);
      expect(p.x).toBeLessThanOrEqual(cam.right + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(cam.bottom - 1e-6);
      expect(p.y).toBeLessThanOrEqual(cam.top + 1e-6);
      expect(p.z).toBeLessThanOrEqual(-cam.near + 1e-6); // in front of near
      expect(p.z).toBeGreaterThanOrEqual(-cam.far - 1e-6); // inside far
    }
    // The fit was actually needed: the stage exceeds the legacy ±80 frustum.
    expect(maxAbsX).toBeGreaterThan(80);
    expect(cam.right).toBeGreaterThan(80);
    view.dispose();
  });
});

// ---------------------------------------------------------------------------
// hut / deco material + texture binding
// ---------------------------------------------------------------------------

describe('stage prop materials', () => {
  it('wires all Standard slots; AO reads UV0; Unity metallic-gloss R/A patch applies', async () => {
    const view = await loadView({ merge: false });
    for (const matId of ['home_001_m', 'deco_003_m']) {
      const m = view.materials.get(matId)!;
      expect(m.map, `${matId} _MainTex`).not.toBeNull();
      expect(m.normalMap, `${matId} _BumpMap`).not.toBeNull();
      expect(m.metalnessMap, `${matId} _MetallicGlossMap`).not.toBeNull();
      expect(m.roughnessMap).toBe(m.metalnessMap); // one gloss texture, two slots
      expect(m.aoMap, `${matId} _OcclusionMap`).not.toBeNull();
      // Unity _UVSec=0 → AO on UV0 (three default channel 1 = absent `uv1`).
      expect(m.aoMap!.channel).toBe(0);
      expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(m.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
      // Gloss-map mode: factors come from the map (metallic=R, smoothness=A).
      expect(m.metalness).toBe(1);
      const shader = {
        vertexShader: '',
        fragmentShader: 'roughnessFactor *= texelRoughness.g;\nmetalnessFactor *= texelMetalness.b;',
        uniforms: {},
      };
      m.onBeforeCompile(shader as never, null as never);
      expect(shader.fragmentShader).toContain('roughnessFactor *= ( 1.0 - texelRoughness.a * 1.000000 );');
      expect(shader.fragmentShader).toContain('metalnessFactor *= texelMetalness.r;');
      expect(shader.fragmentShader).not.toContain('texelRoughness.g');
      expect(shader.fragmentShader).not.toContain('texelMetalness.b');
    }
    view.dispose();
  });

  it('terrain splat layers still wire after the AO change (no regression)', async () => {
    const view = await loadView();
    const terrain = view.materials.get('terrain_001_m')!;
    expect(terrain.map).not.toBeNull();
    const splat = terrain.userData.splat as { layers: Record<string, THREE.Texture | null> };
    expect(splat.layers.r).not.toBeNull();
    expect(splat.layers.g).not.toBeNull();
    expect(splat.layers.b).not.toBeNull();
    view.dispose();
  });
});

// ---------------------------------------------------------------------------
// mirror / winding on a sample prop (hut-shaped triangle)
// ---------------------------------------------------------------------------

describe('stage prop mirror/winding', () => {
  it('mirrors x, flips winding, and keeps face normals consistent with stored normals', async () => {
    const view = await loadView({ merge: false });
    const hut = view.draws.children.find((c) => c.name === 'home_001_LOD0') as THREE.Mesh;
    expect(hut).toBeDefined();
    expect(hut.castShadow).toBe(true);
    expect(hut.receiveShadow).toBe(true);
    expect(hut.matrixAutoUpdate).toBe(false); // world-space baked → identity
    const g = hut.geometry as THREE.BufferGeometry;
    // Vertices are remapped into first-use order of the raw index stream
    // (raw idx 0,2,1 → output verts v0,v2,v1), then x is mirrored.
    expect(Array.from((g.getAttribute('position') as THREE.BufferAttribute).array)).toEqual(
      [-0, 0, 0, -0, 0, 1, -1, 0, 0]); // -0 from mirroring x=0 (GPU-identical)
    expect(Array.from((g.getAttribute('normal') as THREE.BufferAttribute).array)).toEqual(
      [-0, 1, 0, -0, 1, 0, -0, 1, 0]); // -0 faithful (GPU-identical)
    expect(Array.from((g.getAttribute('uv') as THREE.BufferAttribute).array)).toEqual(
      [0.1, 0.2, 0.5, 0.6, 0.3, 0.4].map(Math.fround)); // UVs untouched, same remap
    // Winding flip: raw LH triangle (v0,v2,v1) → output (v0,v1,v2) in raw
    // vertex labels; with the first-use remap that reads [0,2,1].
    expect(Array.from(g.getIndex()!.array)).toEqual([0, 2, 1]);
    // RH face normal of the flipped triangle == mirrored stored normal (+Y):
    // the prop is NOT inside-out after the LH→RH conversion.
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const idx = g.getIndex()!;
    const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
    const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
    const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
    const face = b.sub(a).cross(c.sub(a)).normalize();
    const stored = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal') as THREE.BufferAttribute, 0);
    expect(face.dot(stored)).toBeGreaterThan(0.99);
    view.dispose();
  });
});
