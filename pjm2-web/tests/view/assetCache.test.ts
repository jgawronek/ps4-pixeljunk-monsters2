// tests/view/assetCache.test.ts
// Cache-API asset cache (repeat loads → zero network round-trips). Node has
// NO Cache API, so the structural seams are exercised with a Map-backed fake
// CacheStorageLike returning real Node 22 Response objects. Integration tests
// cover the wired fetch paths: fetchCompressed (decompressed bytes cached
// under the raw url), CharacterLibrary GLBs, StageSceneView texture blobs.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  AssetCache, createBrowserAssetCache, ASSET_CACHE_VERSION,
  type CacheLike, type CacheStorageLike,
} from '../../src/view/cache/AssetCache';
import { fetchCompressed, fetchJsonCompressed } from '../../src/view/stage/compressedFetch';
import { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';
import { StageSceneView } from '../../src/view/stage/StageSceneView';

// ---------------------------------------------------------------------------
// fake CacheStorage (Map-backed; emulates Cache API snapshot-on-put and a
// fresh Response per match — real match() never returns a consumed body)
// ---------------------------------------------------------------------------

class FakeCache implements CacheLike {
  readonly entries = new Map<string, ArrayBuffer>();
  failPut = false;
  failMatch = false;

  async match(req: string): Promise<Response | undefined> {
    if (this.failMatch) throw new Error('cache match failed');
    const buf = this.entries.get(req);
    return buf ? new Response(buf.slice(0)) : undefined;
  }

  async put(req: string, resp: Response): Promise<void> {
    if (this.failPut) throw new Error('QuotaExceededError');
    this.entries.set(req, await resp.arrayBuffer()); // snapshot at put time
  }
}

class FakeStorage implements CacheStorageLike {
  readonly buckets = new Map<string, FakeCache>();
  failOpen = false;

  async open(name: string): Promise<CacheLike> {
    if (this.failOpen) throw new Error('SecurityError (private mode)');
    let c = this.buckets.get(name);
    if (!c) { c = new FakeCache(); this.buckets.set(name, c); }
    return c;
  }

  async delete(name: string): Promise<boolean> {
    return this.buckets.delete(name);
  }

  bucket(): FakeCache {
    const c = this.buckets.get('pjm2-assets');
    if (!c) throw new Error('bucket not opened');
    return c;
  }
}

const ORIGINAL = new TextEncoder().encode('{"hello":"world","n":42}');
const URL_A = 'http://x/asset.bin';
const bytesOf = (buf: ArrayBuffer) => new Uint8Array(buf);
const copyOf = (a: Uint8Array) => a.slice().buffer as ArrayBuffer;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AssetCache core
// ---------------------------------------------------------------------------

describe('AssetCache.getOrFetch', () => {
  it('stores bytes on miss under the versioned key and returns them', async () => {
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const buf = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(buf)).toEqual(ORIGINAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.bucket().entries.has(`${ASSET_CACHE_VERSION}:${URL_A}`)).toBe(true);
  });

  it('serves a hit without calling the fetcher again', async () => {
    const cache = new AssetCache(new FakeStorage());
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const first = await cache.getOrFetch(URL_A, fetcher);
    const second = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(first)).toEqual(ORIGINAL);
    expect(bytesOf(second)).toEqual(ORIGINAL);
    expect(fetcher).toHaveBeenCalledTimes(1); // zero network on repeat
  });

  it('isolates versions: a bumped version misses entries stored under the old one', async () => {
    const storage = new FakeStorage();
    const v1 = new AssetCache(storage, 'pjm2-v1');
    const v2 = new AssetCache(storage, 'pjm2-v2');
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    await v1.getOrFetch(URL_A, fetcher);
    await v2.getOrFetch(URL_A, fetcher); // different key → miss
    expect(fetcher).toHaveBeenCalledTimes(2);
    await v1.getOrFetch(URL_A, fetcher); // old key still hits
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(storage.bucket().entries.has('pjm2-v1:' + URL_A)).toBe(true);
    expect(storage.bucket().entries.has('pjm2-v2:' + URL_A)).toBe(true);
  });

  it('null storage is a pure passthrough (no caching, fetcher every call)', async () => {
    const cache = new AssetCache(null);
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    await cache.getOrFetch(URL_A, fetcher);
    await cache.getOrFetch(URL_A, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('swallows cache.put failures (quota) and still returns the fetched bytes', async () => {
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    await cache.getOrFetch(URL_A, async () => copyOf(ORIGINAL)); // opens bucket
    storage.bucket().failPut = true;
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const buf = await cache.getOrFetch('http://x/other.bin', fetcher);
    expect(bytesOf(buf)).toEqual(ORIGINAL);
    expect(storage.bucket().entries.size).toBe(1); // nothing new stored
    // next call re-fetches (the failed put left no entry)
    await cache.getOrFetch('http://x/other.bin', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('swallows cache.open failures (private mode) and falls back to the fetcher', async () => {
    const storage = new FakeStorage();
    storage.failOpen = true;
    const cache = new AssetCache(storage);
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const buf = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(buf)).toEqual(ORIGINAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('swallows cache.match failures and falls back to the fetcher', async () => {
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    await cache.getOrFetch(URL_A, async () => copyOf(ORIGINAL));
    storage.bucket().failMatch = true;
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const buf = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(buf)).toEqual(ORIGINAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates fetcher errors and never caches them', async () => {
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    const fetcher = vi.fn(async () => { throw new Error('network down'); });
    await expect(cache.getOrFetch(URL_A, fetcher)).rejects.toThrow('network down');
    expect(storage.buckets.get('pjm2-assets')?.entries.size ?? 0).toBe(0);
  });

  it('returns buffers isolated from caller mutation (snapshot semantics)', async () => {
    const cache = new AssetCache(new FakeStorage());
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    const first = await cache.getOrFetch(URL_A, fetcher);
    bytesOf(first)[0] = 0xff; // caller owns its buffer (pack slicing etc.)
    const second = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(second)).toEqual(ORIGINAL); // stored copy unaffected
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('clear() empties the bucket; clear() on null storage is a no-op', async () => {
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    await cache.getOrFetch(URL_A, fetcher);
    await cache.clear();
    expect(storage.buckets.size).toBe(0);
    await cache.getOrFetch(URL_A, fetcher); // miss again after clear
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(new AssetCache(null).clear()).resolves.toBeUndefined();
  });
});

describe('createBrowserAssetCache', () => {
  it('guards the absent Cache API (Node) → passthrough cache', async () => {
    expect(typeof caches).toBe('undefined'); // Node 22 has no Cache API
    const cache = createBrowserAssetCache();
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    await cache.getOrFetch(URL_A, fetcher);
    await cache.getOrFetch(URL_A, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses window.caches when present', async () => {
    const storage = new FakeStorage();
    vi.stubGlobal('caches', storage);
    const cache = createBrowserAssetCache();
    const fetcher = vi.fn(async () => copyOf(ORIGINAL));
    await cache.getOrFetch(URL_A, fetcher);
    const buf = await cache.getOrFetch(URL_A, fetcher);
    expect(bytesOf(buf)).toEqual(ORIGINAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.bucket().entries.has(`${ASSET_CACHE_VERSION}:${URL_A}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration: fetchCompressed caches the DECOMPRESSED bytes under the raw url
// ---------------------------------------------------------------------------

function stubFetch(routes: Record<string, { body: Uint8Array; ok?: boolean }>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const hit = routes[u];
    if (!hit) return new Response(null, { status: 404 });
    return new Response(copyOf(hit.body), { status: hit.ok === false ? 500 : 200 });
  }) as unknown as typeof fetch;
}

describe('fetchCompressed + AssetCache', () => {
  it('caches decompressed bytes; the second call issues zero fetches', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(ORIGINAL)));
    stubFetch({ 'http://x/data.bin.gz': { body: gz }, 'http://x/data.bin': { body: ORIGINAL } });
    const storage = new FakeStorage();
    const cache = new AssetCache(storage);
    const first = await fetchCompressed('http://x/data.bin', undefined, cache);
    expect(bytesOf(first)).toEqual(ORIGINAL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // .gz only
    // stored under the RAW url (not the .gz transfer url), decompressed
    expect(storage.bucket().entries.has(`${ASSET_CACHE_VERSION}:http://x/data.bin`)).toBe(true);
    const callsAfterFirst = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await fetchCompressed('http://x/data.bin', undefined, cache);
    expect(bytesOf(second)).toEqual(ORIGINAL);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('without a cache param keeps the original passthrough behavior', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(ORIGINAL)));
    stubFetch({ 'http://x/data.bin.gz': { body: gz } });
    await fetchCompressed('http://x/data.bin');
    await fetchCompressed('http://x/data.bin');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // re-fetched every call
  });

  it('fetchJsonCompressed forwards the cache (second parse, zero fetches)', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(ORIGINAL)));
    stubFetch({ 'http://x/scene.json.gz': { body: gz } });
    const cache = new AssetCache(new FakeStorage());
    const a = await fetchJsonCompressed<{ hello: string; n: number }>('http://x/scene.json', cache);
    const b = await fetchJsonCompressed<{ hello: string; n: number }>('http://x/scene.json', cache);
    expect(a).toEqual({ hello: 'world', n: 42 });
    expect(b).toEqual(a);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// integration: CharacterLibrary GLB bytes cached across library instances
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

describe('CharacterLibrary + AssetCache', () => {
  it('caches GLB bytes: a second library instance loads with zero GLB fetches', async () => {
    // Node lacks createImageBitmap; stub it for the texture-handler path
    // (the mesh-less GLB never decodes an image anyway).
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
    const glb = minimalGlb();
    let glbFetches = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('.glb')) {
        glbFetches++;
        return Promise.resolve(new Response(glb.slice(0)));
      }
      return Promise.resolve(new Response(null, { status: 404 })); // _ok sentinel etc.
    });
    const cache = new AssetCache(new FakeStorage());
    const lib1 = new CharacterLibrary('http://char.test/assets/characters/', cache);
    await lib1.load('a');
    const lib2 = new CharacterLibrary('http://char.test/assets/characters/', cache);
    await lib2.load('a');
    expect(glbFetches).toBe(1);
    expect(lib1.get('a')).not.toBeNull();
    expect(lib2.get('a')).not.toBeNull();
    lib1.dispose();
    lib2.dispose();
  });
});

// ---------------------------------------------------------------------------
// integration: StageSceneView texture blobs + scene.json cached across loads
// ---------------------------------------------------------------------------

describe('StageSceneView + AssetCache', () => {
  it('caches texture blob bytes and scene.json: second load re-fetches neither', async () => {
    const BASE = 'http://stage.test/assets/stages/cache_stage/';
    const scene = {
      meta: { stage: 'cache_stage' },
      nodes: [{
        i: 0, name: 'n0', parent: -1, activeSelf: true, activeInHierarchy: true,
        layerName: 'Default', pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
        animator: false,
        render: {
          mesh: 'm0', materials: ['mat0'], enabled: true, lodLevel: 0,
          worldSpace: true, subMesh: null, castShadows: 0, receiveShadows: 0,
        },
      }],
      meshes: {
        m0: {
          name: 'm0', vertexCount: 3, indexCount: 3, triangleCount: 1,
          submeshes: [{ firstIndex: 0, indexCount: 3, topology: 0 }],
          files: { pos: 'meshes/m0.pos.f32.bin', idx: 'meshes/m0.idx.u32.bin' },
          channels: ['pos', 'idx'],
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          combined: true, bakedWorldSpace: true, colliderOnly: false,
        },
      },
      materials: {
        mat0: {
          name: 'mat0', shader: { name: 'Standard' },
          textures: { _MainTex: { texture: 't0', scale: [1, 1], offset: [0, 0] } },
          floats: {}, colors: { _Color: [1, 1, 1, 1] },
        },
      },
      textures: {
        t0: { name: 't0', width: 2, height: 2, colorSpace: 1, file: 'textures_webp/t0.webp', bytes: 4 },
      },
      lights: [],
    };
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const idx = new Uint32Array([0, 1, 2]);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('.gz')) return new Response(null, { status: 404 });
      if (url.endsWith('scene.json')) return new Response(JSON.stringify(scene));
      if (url.endsWith('meshes-pack.json')) return new Response(null, { status: 404 }); // per-file fallback
      if (url.endsWith('m0.pos.f32.bin')) return new Response(pos.slice());
      if (url.endsWith('m0.idx.u32.bin')) return new Response(idx.slice());
      if (url.endsWith('t0.webp')) return new Response(new Uint8Array([1, 2, 3, 4]));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
    const cache = new AssetCache(new FakeStorage());
    const first = new StageSceneView({ baseUrl: BASE, assetCache: cache });
    await first.load();
    const second = new StageSceneView({ baseUrl: BASE, assetCache: cache });
    await second.load();
    expect(first.stats.renderersBuilt).toBe(1);
    expect(second.stats.renderersBuilt).toBe(1);
    expect(second.materials.get('mat0')!.map).not.toBeNull();
    // texture blob + scene.json fetched exactly once across BOTH loads
    expect(calls.filter((u) => u.endsWith('t0.webp')).length).toBe(1);
    expect(calls.filter((u) => u.endsWith('scene.json')).length).toBe(1);
    expect(calls.filter((u) => u.endsWith('scene.json.gz')).length).toBe(1);
    first.dispose();
    second.dispose();
  });
});
