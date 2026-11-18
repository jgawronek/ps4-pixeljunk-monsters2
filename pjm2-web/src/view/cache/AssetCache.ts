// src/view/cache/AssetCache.ts
// Repeat-load asset cache on top of the browser Cache API. The dev server
// hosts ~116MB of stage assets (15MB gz mesh pack, 77MB WebP textures,
// character GLBs); Vite's ETag/Last-Modified still costs one 304 revalidation
// round-trip per asset on every load, which dominates on slow/remote links.
// Storing the asset BYTES in CacheStorage makes repeat loads read locally —
// ZERO network round-trips for cached assets.
//
// Design:
//   - Structural seams (CacheLike / CacheStorageLike) so Node tests inject a
//     Map-backed fake; Node has no Cache API. `createBrowserAssetCache()`
//     wires the real `window.caches` when present, else a null-storage
//     passthrough (headless/Node runs fetch exactly as before).
//   - One named bucket (CACHE_NAME) shared by every fetch path; entries are
//     keyed `${version}:${url}`. Bump ASSET_CACHE_VERSION to invalidate all
//     entries at once (old keys simply never match again). Stale-version
//     bytes linger until clear() or browser eviction — call clear() once
//     after a bump if quota is tight.
//   - Values are the FINAL usable bytes (decompressed mesh pack, raw texture
//     blobs, GLB buffers) stored as `new Response(buf)` — the Cache API only
//     stores Responses. Both `.gz` and raw transfer paths benefit because the
//     key is the raw asset URL, not the transfer URL.
//   - Never-throw cosmetics philosophy: any cache error (quota exceeded,
//     private mode, corrupt entry) is swallowed and the fetcher result is
//     returned. Fetch errors themselves still propagate — they are load
//     failures, not cache failures, and must never be cached.
//
// Quota note: ~116MB fits comfortably in CacheStorage on desktop (origins
// typically get a large share of free disk), but eviction is browser-managed
// (best-effort, LRU-ish under storage pressure). A cache miss after eviction
// is harmless — the fetcher re-downloads and re-stores.

/** Structural subset of the Cache API surface this module uses. */
export interface CacheLike {
  match(req: string): Promise<Response | undefined>;
  put(req: string, resp: Response): Promise<void>;
}

/** Structural subset of `window.caches` (CacheStorage). */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
}

/** Bump to invalidate every cached asset (keys are version-prefixed). */
export const ASSET_CACHE_VERSION = 'pjm2-v1';

/** Single shared bucket for all stage/character asset bytes. */
const CACHE_NAME = 'pjm2-assets';

export class AssetCache {
  private readonly version: string;

  constructor(
    private readonly storage: CacheStorageLike | null,
    version: string = ASSET_CACHE_VERSION,
  ) {
    this.version = version;
  }

  /** Get cached bytes for url, or fetch via fetcher() and store. Returns the
   *  bytes. Null storage / Cache-API unavailable → passthrough fetcher (no
   *  caching). Never throws on cache errors; fetcher errors propagate. */
  async getOrFetch(url: string, fetcher: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (!this.storage) return fetcher();
    const key = `${this.version}:${url}`;
    let cache: CacheLike | null = null;
    try {
      cache = await this.storage.open(CACHE_NAME);
      const hit = await cache.match(key);
      if (hit) return await hit.arrayBuffer();
    } catch {
      cache = null; // open/match/read failed → plain fetch below
    }
    const buf = await fetcher();
    if (cache) {
      try {
        // Response copies the bytes; the caller keeps `buf` free to mutate
        // (the stage loader slices typed-array views over the pack buffer).
        await cache.put(key, new Response(buf));
      } catch {
        /* quota/private-mode → keep the fetched bytes, skip storage */
      }
    }
    return buf;
  }

  /** Drop the whole asset bucket (all versions). Best-effort, never throws. */
  async clear(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.delete(CACHE_NAME);
    } catch {
      /* best-effort */
    }
  }
}

/** The shared browser cache: `window.caches` when available, else a
 *  null-storage passthrough (Node/headless, or browsers without Cache API). */
export function createBrowserAssetCache(): AssetCache {
  try {
    if (typeof caches !== 'undefined') return new AssetCache(caches);
  } catch {
    /* some private modes throw on `caches` access → passthrough */
  }
  return new AssetCache(null);
}
