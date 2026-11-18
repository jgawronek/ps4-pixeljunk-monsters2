// src/view/pack/PackLoader.ts
// Runtime side of the asset packs (packFormat.ts). A PackRegistry:
//   - reads packs/manifest.json (path -> pack name, pack hash/size/priority),
//   - fetches each pack ONCE (gz sibling preferred, raw fallback) and serves
//     the entries as bytes / Response / blob URL,
//   - optionally keeps validated packs in IndexedDB (works on plain-http LAN
//     origins where the Cache API does not exist) so repeat loads cost 0 bytes,
//   - NEVER throws into callers: a missing manifest, a missing/corrupt pack or a
//     missing entry makes get()/serve() resolve null and the caller falls back
//     to the original loose-file path.
// installPackFetch() wraps globalThis.fetch so every existing loader
// (GLTFLoader, ImageBitmapLoader, plain fetch) is served from packs with zero
// per-loader changes; non-pack URLs fall straight through to the real fetch.

import { parsePack, mimeFor, type ParsedPack } from './packFormat';

export interface PackManifestPack {
  /** File name relative to the packs dir (the gz sibling is `<file>.gz`). */
  file: string;
  /** Content hash of the (uncompressed) pack: cache-validity key. */
  hash: string;
  bytes: number;
  priority: 'high' | 'low';
}
export interface PackManifest {
  v: 1;
  packs: Record<string, PackManifestPack>;
  /** absolute URL path -> pack name */
  files: Record<string, string>;
}

export interface PackStore {
  get(name: string, hash: string): Promise<ArrayBuffer | null>;
  put(name: string, hash: string, buf: ArrayBuffer): Promise<void>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PackRegistryOptions {
  /** Directory URL holding manifest.json + the packs. */
  baseUrl?: string;
  /** The REAL fetch (never the patched one). */
  rawFetch: FetchLike;
  /** Fetch + inflate one pack; default tries `<url>.gz` (gzip magic sniffed) then `<url>`. */
  fetchPackBytes?: (url: string) => Promise<ArrayBuffer>;
  store?: PackStore | null;
  /** Diagnostics: called when a pack is rejected or unreachable. */
  onFallback?: (what: string, err: unknown) => void;
}

export class PackRegistry {
  readonly baseUrl: string;
  private readonly rawFetch: FetchLike;
  private readonly fetchPackBytes: (url: string) => Promise<ArrayBuffer>;
  private readonly store: PackStore | null;
  private readonly onFallback: (what: string, err: unknown) => void;
  private manifest: PackManifest | null = null;
  private manifestPromise: Promise<PackManifest | null> | null = null;
  private readonly loaded = new Map<string, Promise<ParsedPack | null>>();
  private readonly parsed = new Map<string, ParsedPack>();
  private readonly blobUrls = new Map<string, string>();
  private readonly loose = new Map<string, Promise<ArrayBuffer | null>>();
  /** Diagnostics for probes/tests. */
  readonly stats = { packsLoaded: 0, packsFromStore: 0, packsFailed: 0, served: 0, fellBack: 0 };

  constructor(opts: PackRegistryOptions) {
    this.baseUrl = opts.baseUrl ?? '/assets/packs/';
    this.rawFetch = opts.rawFetch;
    this.fetchPackBytes = opts.fetchPackBytes ?? ((u) => this.defaultFetchPack(u));
    this.store = opts.store ?? null;
    this.onFallback = opts.onFallback ?? (() => {});
  }

  /** Resolves with the manifest, or null when absent/invalid (=> everything falls back). */
  ready(): Promise<PackManifest | null> {
    if (this.manifestPromise === null) {
      this.manifestPromise = (async () => {
        try {
          const res = await this.rawFetch(`${this.baseUrl}manifest.json`);
          if (!res.ok) throw new Error(`manifest ${res.status}`);
          const m = (await res.json()) as PackManifest;
          if (m.v !== 1 || typeof m.packs !== 'object' || typeof m.files !== 'object') throw new Error('bad manifest');
          this.manifest = m;
          return m;
        } catch (err) {
          this.onFallback('manifest', err);
          return null;
        }
      })();
    }
    return this.manifestPromise;
  }

  /** Sync: is the entry listed (only meaningful after ready()). */
  has(path: string): boolean {
    return this.manifest !== null && path in this.manifest.files;
  }

  /** Load a pack once (concurrent callers share the promise). null on any failure. */
  loadPack(name: string): Promise<ParsedPack | null> {
    let p = this.loaded.get(name);
    if (p === undefined) {
      p = this.doLoad(name);
      this.loaded.set(name, p);
    }
    return p;
  }

  private async doLoad(name: string): Promise<ParsedPack | null> {
    const m = await this.ready();
    const meta = m?.packs[name];
    if (!meta) return null;
    try {
      let buf: ArrayBuffer | null = null;
      if (this.store) {
        try { buf = await this.store.get(name, meta.hash); } catch { buf = null; }
        if (buf) {
          try {
            const parsed = parsePack(buf);
            this.parsed.set(name, parsed);
            this.stats.packsFromStore++;
            this.stats.packsLoaded++;
            return parsed;
          } catch { buf = null; /* corrupt store entry -> network */ }
        }
      }
      buf = await this.fetchPackBytes(`${this.baseUrl}${meta.file}`);
      const parsed = parsePack(buf); // throws on corrupt/truncated
      this.parsed.set(name, parsed);
      this.stats.packsLoaded++;
      if (this.store) void this.store.put(name, meta.hash, buf).catch(() => {});
      return parsed;
    } catch (err) {
      this.stats.packsFailed++;
      this.onFallback(`pack ${name}`, err);
      return null;
    }
  }

  /** Entry bytes (zero-copy view), or null => caller falls back to loose file. */
  async get(path: string): Promise<Uint8Array | null> {
    const m = await this.ready();
    const name = m?.files[path];
    if (!name) return null;
    const pack = await this.loadPack(name);
    return pack?.view(path) ?? null;
  }

  /** Synthesised 200 Response for a pack/prefetched entry; null => use the network. */
  async serve(path: string, method = 'GET'): Promise<Response | null> {
    const pre = this.loose.get(path);
    if (pre !== undefined) {
      this.loose.delete(path); // single-use: bytes are handed to the one consumer
      const buf = await pre;
      if (buf) return this.respond(new Uint8Array(buf), path, method);
    }
    const bytes = await this.get(path);
    if (bytes === null) {
      if (this.manifest?.files[path]) this.stats.fellBack++;
      return null;
    }
    return this.respond(bytes, path, method);
  }

  /** MIME recorded at pack time (e.g. a .png URL whose bytes are lossless WebP). */
  private mimeOf(path: string): string {
    const name = this.manifest?.files[path];
    return (name ? this.parsed.get(name)?.entries.get(path)?.mime : undefined) ?? mimeFor(path);
  }

  private respond(bytes: Uint8Array, path: string, method: string): Response {
    this.stats.served++;
    const headers = { 'Content-Type': this.mimeOf(path), 'Content-Length': String(bytes.length) };
    return new Response(method === 'HEAD' ? null : (bytes as unknown as BodyInit), { status: 200, headers });
  }

  /** blob: URL for <img>/Image users (null until the pack is loaded or if absent). Cached. */
  blobUrlSync(path: string): string | null {
    const hit = this.blobUrls.get(path);
    if (hit) return hit;
    const name = this.manifest?.files[path];
    const pack = name ? this.parsed.get(name) : undefined;
    const view = pack?.view(path);
    if (!view || typeof URL === 'undefined' || typeof Blob === 'undefined') return null;
    const url = URL.createObjectURL(new Blob([view as unknown as BlobPart], { type: this.mimeOf(path) }));
    this.blobUrls.set(path, url);
    return url;
  }

  async blobUrl(path: string): Promise<string | null> {
    await this.get(path);
    return this.blobUrlSync(path);
  }

  /** Resolves when all high-priority packs have finished (loaded or failed). Never rejects. */
  async highLoaded(): Promise<void> {
    const m = await this.ready();
    if (!m) return;
    await Promise.all(Object.keys(m.packs).filter((n) => m.packs[n].priority === 'high').map((n) => this.loadPack(n)));
  }

  /** Start fetching packs: high priority first (all together), low priority after the high ones finish. */
  async prefetch(): Promise<void> {
    const m = await this.ready();
    if (!m) return;
    const names = Object.keys(m.packs);
    const high = names.filter((n) => m.packs[n].priority === 'high');
    const low = names.filter((n) => m.packs[n].priority !== 'high');
    await Promise.all(high.map((n) => this.loadPack(n)));
    await Promise.all(low.map((n) => this.loadPack(n)));
  }

  /** Low-priority background fetch of loose files (e.g. audio) whose bytes are
   *  handed to the single later fetch() of the same URL. Errors -> that URL falls back. */
  prefetchLoose(paths: string[], priority: 'low' | 'high' | 'auto' = 'low'): void {
    for (const p of paths) {
      if (this.loose.has(p)) continue;
      this.loose.set(p, this.rawFetch(p, { priority } as RequestInit)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null));
    }
  }

  private async defaultFetchPack(url: string): Promise<ArrayBuffer> {
    // gz sibling first (smaller on plain static hosts); servers that already
    // decode (Content-Encoding: gzip) leave no gzip magic -> use as is.
    try {
      const gz = await this.rawFetch(`${url}.gz`);
      if (gz.ok) {
        const raw = new Uint8Array(await gz.arrayBuffer());
        if (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
          if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
          const ds = new DecompressionStream('gzip');
          const out = new Response(new Blob([raw as unknown as BlobPart]).stream().pipeThrough(ds));
          return await out.arrayBuffer();
        }
        return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      }
    } catch { /* fall through to raw */ }
    const res = await this.rawFetch(url);
    if (!res.ok) throw new Error(`pack ${url}: ${res.status}`);
    return res.arrayBuffer();
  }
}

/** Absolute URL path of a fetch input on the current origin, else null. */
export function pathOfInput(input: unknown, origin: string): string | null {
  try {
    const s = typeof input === 'string' ? input
      : input instanceof URL ? input.href
        : (input as { url?: string }).url ?? null;
    if (s === null) return null;
    const u = new URL(s, origin);
    if (u.origin !== origin) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

/** Wrap `target.fetch` so pack-listed URLs are served from the registry.
 *  Idempotent. Only GET/HEAD without Range under /assets/ (excluding the packs
 *  dir itself) are considered; any registry miss falls through to real fetch. */
export function installPackFetch(
  reg: PackRegistry,
  target: { fetch: typeof fetch; location?: { origin: string } } = globalThis as never,
): void {
  const cur = target.fetch as typeof fetch & { __packPatched?: boolean };
  if (cur.__packPatched) return;
  const orig = cur.bind(target) as typeof fetch;
  const origin = target.location?.origin ?? 'http://localhost';
  const patched = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = pathOfInput(input, origin);
    if ((method !== 'GET' && method !== 'HEAD') || path === null || !path.startsWith('/assets/')
      || path.startsWith(reg.baseUrl)) return orig(input, init);
    const hdrs = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (hdrs.has('range')) return orig(input, init);
    return reg.serve(path, method).then((r) => r ?? orig(input, init), () => orig(input, init));
  }) as typeof fetch & { __packPatched?: boolean };
  patched.__packPatched = true;
  target.fetch = patched;
}

/** IndexedDB-backed PackStore (works on insecure http origins). Best-effort. */
export function createIdbPackStore(idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): PackStore | null {
  if (!idb) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => (dbp ??= new Promise((res, rej) => {
    const rq = idb.open('pjm2-packs', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('packs');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
  return {
    async get(name, hash) {
      const db = await open();
      return new Promise((res) => {
        const rq = db.transaction('packs', 'readonly').objectStore('packs').get(name);
        rq.onsuccess = () => {
          const v = rq.result as { hash: string; buf: ArrayBuffer } | undefined;
          res(v && v.hash === hash ? v.buf : null);
        };
        rq.onerror = () => res(null);
      });
    },
    async put(name, hash, buf) {
      const db = await open();
      await new Promise<void>((res) => {
        const tx = db.transaction('packs', 'readwrite');
        tx.objectStore('packs').put({ hash, buf }, name);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
        tx.onabort = () => res();
      });
    },
  };
}
