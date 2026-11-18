// tests/view/loadPerf.test.ts
// Load-path performance contract (iter load-perf): synthetic scene + fake
// fetch, Node-only (createImageBitmap stubbed — decode output is irrelevant
// to the scheduling/slicing logic under test).
//
// Covers:
//   - per-file mesh fallback: bounded mesh concurrency, full coverage
//   - packed blob: 1 request, zero-copy slice correctness (mirror/winding/
//     splat values), fallback when sidecar/blob missing or index corrupt
//   - progress monotonicity + exact totals
//   - geometry determinism independent of fetch completion order
//   - texture priority ordering (terrain albedo first) + incremental wiring
//   - CharacterLibrary.loadMany bounded concurrency; clones never re-fetch

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { StageSceneView, type StageSceneProgress } from '../../src/view/stage/StageSceneView';
import { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';

const BASE = 'http://stage.test/assets/stages/test_stage/';
const CHAR_BASE = 'http://char.test/assets/characters/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// synthetic scene + deterministic channel data (no Math.random)
// ---------------------------------------------------------------------------

const CHANNEL_BYTES: Record<string, number> = { pos: 12, nrm: 12, uv0: 8, tan: 16, idx: 4, col0: 4 };

function channelArray(meshId: string, ch: string, vertexCount: number, indexCount: number): ArrayBufferView {
  const seed = meshId.length + ch.charCodeAt(0);
  if (ch === 'idx') {
    // two triangles over 4 verts, valid for any mesh
    return new Uint32Array([0, 1, 2, 0, 2, 3].slice(0, indexCount));
  }
  if (ch === 'col0') {
    const a = new Uint8Array(vertexCount * 4);
    for (let i = 0; i < a.length; i++) a[i] = (seed + i * 7) % 256;
    return a;
  }
  const n = vertexCount * (CHANNEL_BYTES[ch] / 4);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.fround(seed * 0.25 + i * 0.5);
  return a;
}

interface SynthOptions {
  meshCount?: number;
  /** material layout: 'plain' = 2 deco materials; 'terrain' = deco + splat terrain */
  materials?: 'plain' | 'terrain';
}

function synthScene(opts: SynthOptions = {}) {
  const meshCount = opts.meshCount ?? 3;
  // Material ids EQUAL their names — exactly like the real scene JSON (the
  // loader's splat/river special-casing compares the material KEY).
  const matIds = ['deco_000_m', opts.materials === 'terrain' ? 'terrain_001_m' : 'deco_001_m'];
  const meshes: Record<string, unknown> = {};
  const nodes: unknown[] = [];
  const filesByMesh = new Map<string, Record<string, string>>();
  for (let k = 0; k < meshCount; k++) {
    const id = `m${k}`;
    const channels = ['pos', 'nrm', 'uv0', 'tan', 'idx', ...(k % 2 === 0 ? ['col0'] : [])];
    const files: Record<string, string> = {};
    for (const ch of channels) {
      files[ch] = `meshes/${id}.${ch}.${ch === 'idx' ? 'u32' : ch === 'col0' ? 'u8' : 'f32'}.bin`;
    }
    filesByMesh.set(id, files);
    meshes[id] = {
      name: id, vertexCount: 4, indexCount: 6, triangleCount: 2,
      submeshes: [{ firstIndex: 0, indexCount: 6, topology: 0 }],
      files, channels,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      combined: true, bakedWorldSpace: true, colliderOnly: false,
    };
    nodes.push({
      i: k, name: `node${k}`, parent: -1, activeSelf: true, activeInHierarchy: true,
      layerName: 'Default', pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
      animator: false,
      render: {
        mesh: id, materials: [matIds[k % 2]], enabled: true, lodLevel: 0,
        worldSpace: true, subMesh: null, castShadows: 1, receiveShadows: 1,
      },
    });
  }
  const tex = (id: string) => ({
    name: id, width: 2, height: 2, colorSpace: 1,
    file: `textures_webp/${id}.webp`, bytes: 100,
  });
  const slot = (id: string) => ({ texture: id, scale: [1, 1], offset: [0, 0] });
  const materials: Record<string, unknown> = {
    deco_000_m: {
      name: 'deco_000_m', shader: { name: 'Standard' },
      textures: { _MainTex: slot('tA'), _BumpMap: slot('tB') },
      floats: {}, colors: { _Color: [1, 1, 1, 1] },
    },
    [matIds[1]]: opts.materials === 'terrain' ? {
      name: 'terrain_001_m', shader: { name: 'Shader Forge' },
      textures: {
        _Base_Color: slot('tC'), _R_Color: slot('tD'), _G_Color: slot('tE'), _B_Color: slot('tF'),
        _Base_Normal: slot('tG'), _Base_Gloss: slot('tH'),
      },
      floats: {}, colors: { _Color: [1, 1, 1, 1] },
    } : {
      name: 'deco_001_m', shader: { name: 'Standard' },
      textures: { _MainTex: slot('tC'), _BumpMap: slot('tD') },
      floats: {}, colors: { _Color: [1, 1, 1, 1] },
    },
  };
  const textureIds = opts.materials === 'terrain'
    ? ['tA', 'tB', 'tC', 'tD', 'tE', 'tF', 'tG', 'tH']
    : ['tA', 'tB', 'tC', 'tD'];
  const textures: Record<string, unknown> = {};
  for (const id of textureIds) textures[id] = tex(id);
  return {
    scene: { meta: { stage: 'test_stage' }, nodes, meshes, materials, textures, lights: [] },
    filesByMesh,
  };
}

/** Build the pack blob + sidecar exactly like tools/stages/pack_mesh_bins.py. */
function buildPack(scene: ReturnType<typeof synthScene>['scene']) {
  const entries: Record<string, { offset: number; length: number }> = {};
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const [meshId, mesh] of Object.entries(scene.meshes) as Array<[string, { channels: string[]; files: Record<string, string>; vertexCount: number; indexCount: number }]>) {
    for (const ch of mesh.channels) {
      const rel = mesh.files[ch];
      if (entries[rel]) continue;
      const data = channelArray(meshId, ch, mesh.vertexCount, mesh.indexCount);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const pad = (-bytes.length) % 4;
      entries[rel] = { offset, length: bytes.length };
      chunks.push(bytes);
      if (pad) chunks.push(new Uint8Array(pad));
      offset += bytes.length + pad;
    }
  }
  const blob = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) { blob.set(c, at); at += c.length; }
  return { index: { version: 1, file: 'meshes.pack.bin', totalBytes: offset, entries }, blob: blob.buffer };
}

// ---------------------------------------------------------------------------
// fake fetch harness
// ---------------------------------------------------------------------------

interface HarnessOptions {
  scene: ReturnType<typeof synthScene>['scene'];
  filesByMesh: Map<string, Record<string, string>>;
  pack?: { index: unknown; blob: ArrayBuffer } | null; // null → sidecar 404
  packBlobMissing?: boolean;
  corruptPack?: boolean;
  binDelay?: (url: string) => number;
}

function makeHarness(opts: HarnessOptions) {
  const calls: string[] = [];
  const textureOrder: string[] = [];
  // in-flight MESHES (a mesh is in flight while any of its channel requests is)
  const pendingByMesh = new Map<string, number>();
  let maxActiveMeshes = 0;
  const binRe = /\/meshes\/([^/]+)\.bin$/;
  const fileToData = new Map<string, ArrayBufferView>();
  for (const [meshId, files] of opts.filesByMesh) {
    const meta = opts.scene.meshes[meshId] as { vertexCount: number; indexCount: number };
    for (const [ch, rel] of Object.entries(files)) {
      fileToData.set(rel, channelArray(meshId, ch, meta.vertexCount, meta.indexCount));
    }
  }
  const pack = opts.pack === undefined ? buildPack(opts.scene) : opts.pack;
  if (opts.corruptPack && pack) {
    const first = Object.values((pack.index as { entries: Record<string, { length: number }> }).entries)[0];
    first.length += 4; // size mismatch → loader must fall back
  }
  const fetchImpl = async (input: unknown): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const m = binRe.exec(url);
    if (m) {
      const meshId = m[1].split('.')[0];
      const n = (pendingByMesh.get(meshId) ?? 0) + 1;
      pendingByMesh.set(meshId, n);
      maxActiveMeshes = Math.max(maxActiveMeshes, pendingByMesh.size);
    }
    try {
      if (opts.binDelay && m) await sleep(opts.binDelay(url));
      if (url.endsWith('scene.json') || url.endsWith('scene-webp.json')) {
        return new Response(JSON.stringify(opts.scene));
      }
      if (url.endsWith('meshes-pack.json')) {
        return pack
          ? new Response(JSON.stringify(pack.index))
          : new Response(null, { status: 404 });
      }
      if (url.endsWith('meshes.pack.bin')) {
        return pack && !opts.packBlobMissing
          ? new Response(pack.blob.slice(0))
          : new Response(null, { status: 404 });
      }
      if (m) {
        const rel = url.slice(BASE.length);
        const data = fileToData.get(rel);
        if (!data) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
      }
      if (url.includes('/textures_webp/')) {
        textureOrder.push(url.slice(url.lastIndexOf('/') + 1));
        return new Response(new Uint8Array([1, 2, 3, 4]));
      }
      return new Response(null, { status: 404 });
    } finally {
      if (m) {
        const meshId = m[1].split('.')[0];
        const n = (pendingByMesh.get(meshId) ?? 1) - 1;
        if (n <= 0) pendingByMesh.delete(meshId);
        else pendingByMesh.set(meshId, n);
      }
    }
  };
  return { fetchImpl, calls, textureOrder, getMaxActiveMeshes: () => maxActiveMeshes };
}

function stubBitmap() {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
}

function snapshotDraws(view: StageSceneView) {
  return view.draws.children.map((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.geometry as THREE.BufferGeometry;
    const attrs: Record<string, number[]> = {};
    for (const [name, attr] of Object.entries(g.attributes)) {
      attrs[name] = Array.from((attr as THREE.BufferAttribute).array as ArrayLike<number>);
    }
    return { name: mesh.name, attrs, index: Array.from(g.getIndex()!.array as ArrayLike<number>) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// mesh loading
// ---------------------------------------------------------------------------

describe('StageSceneView mesh loading', () => {
  it('per-file fallback keeps mesh concurrency bounded and loads every channel', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 8 });
    const h = makeHarness({ scene, filesByMesh, pack: null, binDelay: () => 5 });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const view = new StageSceneView({ baseUrl: BASE, meshConcurrency: 3, textureConcurrency: 2 });
    await view.load();
    expect(h.getMaxActiveMeshes()).toBeLessThanOrEqual(3);
    expect(h.getMaxActiveMeshes()).toBe(3); // limit actually reached (delays overlap)
    const binCalls = h.calls.filter((u) => /\/meshes\/[^/]+\.bin$/.test(u));
    const expectedFiles = [...filesByMesh.values()].reduce((a, f) => a + Object.keys(f).length, 0);
    expect(binCalls.length).toBe(expectedFiles);
    expect(view.stats.combinedMeshesLoaded).toBe(8);
    expect(view.stats.renderersBuilt).toBe(8);
    view.dispose();
  });

  it('packed blob replaces all per-file bin requests with one fetch', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 6 });
    const h = makeHarness({ scene, filesByMesh });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const view = new StageSceneView({ baseUrl: BASE });
    await view.load();
    expect(h.calls.filter((u) => u.endsWith('meshes.pack.bin')).length).toBe(1);
    expect(h.calls.filter((u) => u.endsWith('meshes-pack.json')).length).toBe(1);
    expect(h.calls.filter((u) => /\/meshes\/[^/]+\.bin$/.test(u)).length).toBe(0);
    expect(view.stats.combinedMeshesLoaded).toBe(6);
    // pack-sliced geometry must equal the per-file path byte-for-byte
    const hf = makeHarness({ scene, filesByMesh, pack: null });
    vi.stubGlobal('fetch', hf.fetchImpl);
    const fallback = new StageSceneView({ baseUrl: BASE, mergeByMaterial: false });
    await fallback.load();
    const packed = new StageSceneView({ baseUrl: BASE, mergeByMaterial: false });
    vi.stubGlobal('fetch', h.fetchImpl);
    await packed.load();
    expect(snapshotDraws(packed)).toEqual(snapshotDraws(fallback));
    fallback.dispose();
    packed.dispose();
    view.dispose();
  });

  it('pack slices produce the exact mirrored/winding-flipped geometry', async () => {
    // One mesh, hand-known channel values → assert every attribute.
    const { scene, filesByMesh } = synthScene({ meshCount: 1 });
    const pos = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const uv0 = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const tan = new Float32Array([1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0, -1]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const col0 = new Uint8Array([255, 128, 64, 32, 16, 8, 4, 2, 1, 2, 3, 4, 5, 6, 7, 8]);
    const known: Record<string, ArrayBufferView> = { pos, nrm, uv0, tan, idx, col0 };
    // rebuild pack with the known values
    const entries: Record<string, { offset: number; length: number }> = {};
    const parts: Uint8Array[] = [];
    let offset = 0;
    const meta = scene.meshes.m0 as { channels: string[]; files: Record<string, string> };
    for (const ch of meta.channels) {
      const data = known[ch];
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      entries[meta.files[ch]] = { offset, length: bytes.length };
      parts.push(bytes);
      offset += bytes.length; // all lengths already 4-aligned
    }
    const blob = new Uint8Array(offset);
    let at = 0;
    for (const p of parts) { blob.set(p, at); at += p.length; }
    const pack = { index: { version: 1, file: 'meshes.pack.bin', totalBytes: offset, entries }, blob: blob.buffer };
    const h = makeHarness({ scene, filesByMesh, pack });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const view = new StageSceneView({ baseUrl: BASE, mergeByMaterial: false });
    await view.load();
    const g = (view.draws.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
    expect(Array.from((g.getAttribute('position') as THREE.BufferAttribute).array)).toEqual(
      [-1, 2, 3, -4, 5, 6, -7, 8, 9, -10, 11, 12]); // x mirrored
    expect(Array.from((g.getAttribute('normal') as THREE.BufferAttribute).array)).toEqual(
      [-0, 1, 0, -0, 1, 0, -0, 1, 0, -0, 1, 0]); // x mirror: -0 is faithful (GPU-identical)
    expect(Array.from((g.getAttribute('uv') as THREE.BufferAttribute).array)).toEqual(Array.from(uv0));
    expect(Array.from((g.getAttribute('tangent') as THREE.BufferAttribute).array)).toEqual(
      [-1, 0, 0, -1, -1, 0, 0, 1, -1, 0, 0, -1, -1, 0, 0, 1]); // x and w mirrored
    expect(Array.from((g.getAttribute('splat') as THREE.BufferAttribute).array)).toEqual(
      Array.from(col0).map((v) => Math.fround(v / 255))); // Float32Array storage
    expect(Array.from(g.getIndex()!.array)).toEqual([0, 2, 1, 0, 3, 2]); // winding flipped
    view.dispose();
  });

  it('falls back to per-file bins when the pack sidecar is missing', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 3 });
    const h = makeHarness({ scene, filesByMesh, pack: null });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const view = new StageSceneView({ baseUrl: BASE });
    await view.load();
    const expectedFiles = [...filesByMesh.values()].reduce((a, f) => a + Object.keys(f).length, 0);
    expect(h.calls.filter((u) => /\/meshes\/[^/]+\.bin$/.test(u)).length).toBe(expectedFiles);
    expect(view.stats.combinedMeshesLoaded).toBe(3);
    view.dispose();
  });

  it('falls back when the sidecar exists but the blob is missing', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 3 });
    const h = makeHarness({ scene, filesByMesh, packBlobMissing: true });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const view = new StageSceneView({ baseUrl: BASE });
    await view.load();
    expect(h.calls.filter((u) => u.endsWith('meshes.pack.bin')).length).toBe(1);
    const expectedFiles = [...filesByMesh.values()].reduce((a, f) => a + Object.keys(f).length, 0);
    expect(h.calls.filter((u) => /\/meshes\/[^/]+\.bin$/.test(u)).length).toBe(expectedFiles);
    expect(view.stats.combinedMeshesLoaded).toBe(3);
    view.dispose();
  });

  it('falls back when the pack index fails length validation', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 3 });
    const h = makeHarness({ scene, filesByMesh, corruptPack: true });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = new StageSceneView({ baseUrl: BASE });
    await view.load();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mesh pack invalid'));
    const expectedFiles = [...filesByMesh.values()].reduce((a, f) => a + Object.keys(f).length, 0);
    expect(h.calls.filter((u) => /\/meshes\/[^/]+\.bin$/.test(u)).length).toBe(expectedFiles);
    expect(view.stats.combinedMeshesLoaded).toBe(3);
    warn.mockRestore();
    view.dispose();
  });

  it('geometry is identical regardless of fetch completion order', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 5 });
    const run = async (binDelay: (url: string) => number) => {
      const h = makeHarness({ scene, filesByMesh, pack: null, binDelay });
      vi.stubGlobal('fetch', h.fetchImpl);
      stubBitmap();
      const view = new StageSceneView({ baseUrl: BASE, meshConcurrency: 4, mergeByMaterial: false });
      await view.load();
      const snap = snapshotDraws(view);
      const stats = { ...view.stats, loadSeconds: 0 };
      view.dispose();
      return { snap, stats };
    };
    const a = await run((url) => (url.endsWith('pos.f32.bin') ? 12 : 2));
    const b = await run((url) => (url.endsWith('pos.f32.bin') ? 2 : 12));
    expect(a.snap).toEqual(b.snap);
    expect(a.stats).toEqual(b.stats);
  });
});

// ---------------------------------------------------------------------------
// progress + textures
// ---------------------------------------------------------------------------

describe('StageSceneView progress and texture streaming', () => {
  it('progress is monotonic and totals reconcile (pack path)', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 4 });
    const h = makeHarness({ scene, filesByMesh });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    const snaps: StageSceneProgress[] = [];
    const view = new StageSceneView({ baseUrl: BASE, onProgress: (p) => snaps.push(p) });
    await view.load();
    expect(snaps.length).toBeGreaterThan(0);
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i].loadedBytes).toBeGreaterThanOrEqual(snaps[i - 1].loadedBytes);
      expect(snaps[i].itemsLoaded).toBeGreaterThanOrEqual(snaps[i - 1].itemsLoaded);
    }
    const phases = snaps.map((p) => p.phase);
    expect(phases[0]).toBe('scene');
    expect(phases[phases.length - 1]).toBe('done');
    // phase order never goes backwards
    const order = ['scene', 'meshes', 'geometry', 'textures', 'done'];
    let rank = 0;
    for (const ph of phases) {
      const r = order.indexOf(ph);
      expect(r).toBeGreaterThanOrEqual(rank);
      rank = r;
    }
    const last = snaps[snaps.length - 1];
    expect(last.loadedBytes).toBe(last.totalBytes);
    expect(last.itemsLoaded).toBe(last.itemsTotal);
    expect(last.itemsTotal).toBe(4 + 4); // 4 meshes + 4 unique textures
    view.dispose();
  });

  it('streams terrain albedo first and wires materials incrementally', async () => {
    const { scene, filesByMesh } = synthScene({ meshCount: 2, materials: 'terrain' });
    const h = makeHarness({ scene, filesByMesh });
    vi.stubGlobal('fetch', h.fetchImpl);
    stubBitmap();
    let mapSetAtSecondTerrainJob = false;
    const view = new StageSceneView({
      baseUrl: BASE, textureConcurrency: 1,
      onProgress: (p) => {
        // tD is the SECOND terrain job; by its start report tC must already
        // be wired into the terrain material (progressive, not end-only).
        if (p.detail === 'textures/tD.png') {
          mapSetAtSecondTerrainJob = view.materials.get('terrain_001_m')!.map !== null;
        }
      },
    });
    await view.load();
    // node0 uses deco mat0, node1 terrain — insertion order is deco-first,
    // priority sort must still put terrain albedo ahead of everything.
    expect(h.textureOrder).toEqual([
      'tC.webp', 'tD.webp', 'tE.webp', 'tF.webp', // terrain albedo layers
      'tG.webp', 'tH.webp',                        // terrain normal/gloss
      'tA.webp', 'tB.webp',                        // deco albedo + bump
    ]);
    expect(mapSetAtSecondTerrainJob).toBe(true);
    const terrain = view.materials.get('terrain_001_m')!;
    const splat = terrain.userData.splat as { layers: Record<string, THREE.Texture | null> };
    expect(terrain.map).not.toBeNull();
    expect(splat.layers.r).not.toBeNull();
    expect(splat.layers.g).not.toBeNull();
    expect(splat.layers.b).not.toBeNull();
    expect(view.stats.texturesLoaded).toBe(8);
    view.dispose();
  });
});

// ---------------------------------------------------------------------------
// CharacterLibrary
// ---------------------------------------------------------------------------

/** Minimal valid mesh-less GLB (JSON chunk only) — real GLTFLoader parses it. */
function minimalGlb(): ArrayBuffer {
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'root' }],
  });
  const jsonBytes = new TextEncoder().encode(json);
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const padded = new Uint8Array(jsonBytes.length + pad);
  padded.set(jsonBytes);
  padded.fill(0x20, jsonBytes.length);
  const total = 12 + 8 + padded.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, padded.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  new Uint8Array(buf, 20).set(padded);
  return buf;
}

describe('CharacterLibrary.loadMany', () => {
  it('bounds GLB concurrency, reports monotonic progress, and clones never re-fetch', async () => {
    // three's FileLoader streams via ProgressEvent — absent in Node
    vi.stubGlobal('ProgressEvent', class {
      type: string;
      lengthComputable = false;
      loaded = 0;
      total = 0;
      constructor(type: string, init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
        this.type = type;
        Object.assign(this, init);
      }
    });
    const glb = minimalGlb();
    const gates: Array<(r: Response) => void> = [];
    const urls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      // three's FileLoader fetches a Request object, not a bare URL string
      const url = input instanceof Request ? input.url : String(input);
      urls.push(url);
      if (url.endsWith('_ok')) return Promise.resolve(new Response(null, { status: 404 }));
      if (url.endsWith('.glb')) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<Response>((resolve) => {
          gates.push((r) => { inFlight--; resolve(r); });
        });
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const library = new CharacterLibrary(CHAR_BASE);
    const defs = ['a', 'b', 'c', 'd', 'e', 'f'];
    const progress: number[] = [];
    const done = library.loadMany(defs, (p) => progress.push(p.loaded), 2);
    // release waves of 2 until all six are loaded
    for (let wave = 0; wave < 3; wave++) {
      await vi.waitFor(() => expect(gates.length).toBe(2), { timeout: 5000 });
      const batch = gates.splice(0, gates.length);
      for (const g of batch) g(new Response(glb.slice(0)));
    }
    await done;
    expect(maxInFlight).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    for (const d of defs) expect(library.get(d)).not.toBeNull();
    // clones share geometry/materials/textures — zero additional requests
    const before = urls.length;
    const rig1 = library.instantiate('a');
    const rig2 = library.instantiate('a');
    expect(rig1.root.name).toBe('char:a');
    expect(rig2.root.name).toBe('char:a');
    expect(urls.length).toBe(before);
    library.dispose();
  });
});