// src/view/stage/compressedFetch.ts
// Transfer-size optimization for slow links. The dev server hosts ~116MB of
// stage assets; on a remote/slow connection the raw 39MB mesh pack alone took
// >1min (localhost fetches it in 0.06s — the bottleneck is the link, not the
// loader). Pre-compressed `.gz` siblings (tools/stages/compress_assets.py)
// cut the mesh pack 39→15MB and the scene JSON 1.1MB→108KB.
//
// This fetches `url + '.gz'` first and inflates it client-side via
// DecompressionStream (Chrome 80+), falling back to the raw `url` when the
// .gz is absent or the API is unavailable. No server config/restart needed —
// the .gz is served as a static octet-stream and decoded in the browser.
//
// onReceived reports DECOMPRESSED bytes (for the mesh pack these map directly
// to the mesh byte budget; for the raw fallback decompressed == transfer).
//
// Repeat loads: pass an AssetCache (src/view/cache/AssetCache.ts) to cache the
// FINAL decompressed bytes keyed by the raw url — both the .gz and raw paths
// benefit, and a cache hit skips the network entirely (onReceived is not
// called on hits; callers reconcile byte totals after the await). Omit the
// cache for the original passthrough behavior.

import type { AssetCache } from '../cache/AssetCache';

export type ReceivedCallback = (receivedBytes: number) => void;

async function readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onReceived?: ReceivedCallback,
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onReceived?.(received);
    }
  }
  const all = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return all.buffer;
}

/** Re-emit a primer chunk followed by the rest of a reader as one stream. */
function streamWithPrimer(
  primer: Uint8Array | undefined,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (primer && primer.length) controller.enqueue(primer);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      if (value) controller.enqueue(value);
    },
  });
}

/** Fetch `url`, preferring a pre-compressed `url + '.gz'` sibling. Returns
 *  the decompressed bytes. Throws only when BOTH the .gz and raw fail.
 *
 *  With `cache`, the whole fetch (gz peek + inflate + raw fallback) runs
 *  inside AssetCache.getOrFetch keyed by the RAW url: repeat loads return
 *  the stored decompressed bytes with zero network round-trips.
 *
 *  Servers differ: some (vite dev) serve .gz with `Content-Encoding: gzip`,
 *  so the browser ALREADY inflates the body; others serve the raw gzip bytes.
 *  We peek the first chunk's magic (0x1f 0x8b) and only run DecompressionStream
 *  when the body is still compressed — avoiding a double-inflate failure that
 *  would otherwise trigger a wasteful raw re-download. */
export async function fetchCompressed(
  url: string,
  onReceived?: ReceivedCallback,
  cache?: AssetCache,
): Promise<ArrayBuffer> {
  if (cache) return cache.getOrFetch(url, () => fetchCompressedUncached(url, onReceived));
  return fetchCompressedUncached(url, onReceived);
}

async function fetchCompressedUncached(
  url: string,
  onReceived?: ReceivedCallback,
): Promise<ArrayBuffer> {
  try {
    const gz = await fetch(`${url}.gz`);
    if (gz.ok && gz.body) {
      const reader = gz.body.getReader();
      const first = await reader.read();
      const head = first.done ? undefined : first.value;
      const stillGzip = !!head && head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
      let stream = streamWithPrimer(head, reader);
      if (stillGzip && typeof DecompressionStream !== 'undefined') {
        // Cast: TS lib dom types DecompressionStream.writable as BufferSource,
        // which doesn't unify with the Uint8Array stream generic at runtime.
        const ds = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
        stream = stream.pipeThrough(ds);
      }
      return await readStream(stream.getReader(), onReceived);
    }
  } catch {
    /* .gz absent/corrupt or inflate failed → raw fallback below */
  }
  const raw = await fetch(url);
  if (!raw.ok) throw new Error(`fetch ${url}: ${raw.status}`);
  if (raw.body) return await readStream(raw.body.getReader(), onReceived);
  return await raw.arrayBuffer();
}

/** fetchCompressed + UTF-8 decode + JSON.parse. Optional cache is forwarded
 *  to fetchCompressed (decompressed bytes cached under the raw url). */
export async function fetchJsonCompressed<T = unknown>(url: string, cache?: AssetCache): Promise<T> {
  const buf = await fetchCompressed(url, undefined, cache);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}
