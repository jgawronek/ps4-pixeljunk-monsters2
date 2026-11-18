// tests/view/compressedFetch.test.ts
// Transfer-size helper: .gz preference + DecompressionStream inflate + raw
// fallback. Node 22 provides fetch/Response/ReadableStream/DecompressionStream;
// we stub global fetch and gzip real bytes with node:zlib.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fetchCompressed, fetchJsonCompressed } from '../../src/view/stage/compressedFetch';

const ORIGINAL = new TextEncoder().encode('{"hello":"world","n":42}');
const GZ = gzipSync(Buffer.from(ORIGINAL));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function stubFetch(routes: Record<string, { body: Uint8Array; ok?: boolean }>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const hit = routes[u];
    if (!hit) return new Response(null, { status: 404 });
    // Copy into a fresh ArrayBuffer-backed view (Response body needs a BlobPart).
    const ab = hit.body.buffer.slice(hit.body.byteOffset, hit.body.byteOffset + hit.body.byteLength) as ArrayBuffer;
    return new Response(ab, { status: hit.ok === false ? 500 : 200 });
  }) as unknown as typeof fetch;
}

describe('fetchCompressed', () => {
  it('prefers the .gz sibling and inflates to the original bytes', async () => {
    stubFetch({
      'http://x/data.bin.gz': { body: new Uint8Array(GZ) },
      'http://x/data.bin': { body: ORIGINAL },
    });
    const buf = await fetchCompressed('http://x/data.bin');
    expect(new Uint8Array(buf)).toEqual(ORIGINAL);
    expect(globalThis.fetch).toHaveBeenCalledWith('http://x/data.bin.gz');
  });

  it('falls back to raw when .gz is absent (404)', async () => {
    stubFetch({ 'http://x/data.bin': { body: ORIGINAL } });
    const buf = await fetchCompressed('http://x/data.bin');
    expect(new Uint8Array(buf)).toEqual(ORIGINAL);
  });

  it('falls back to raw when .gz fetch errors', async () => {
    stubFetch({
      'http://x/data.bin.gz': { body: new Uint8Array(GZ), ok: false },
      'http://x/data.bin': { body: ORIGINAL },
    });
    const buf = await fetchCompressed('http://x/data.bin');
    expect(new Uint8Array(buf)).toEqual(ORIGINAL);
  });

  it('reports monotonic decompressed byte progress', async () => {
    const big = new Uint8Array(200000).fill(7);
    stubFetch({ 'http://x/big.bin.gz': { body: new Uint8Array(gzipSync(Buffer.from(big))) } });
    const seen: number[] = [];
    const buf = await fetchCompressed('http://x/big.bin', (n) => seen.push(n));
    expect(new Uint8Array(buf)).toEqual(big);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(big.length);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('throws only when both .gz and raw fail', async () => {
    stubFetch({}); // everything 404
    await expect(fetchCompressed('http://x/missing.bin')).rejects.toThrow();
  });

  it('handles a server that already inflated the .gz (Content-Encoding: gzip)', async () => {
    // vite dev serves .gz with Content-Encoding: gzip → browser body is PLAIN.
    // The magic peek must detect this and NOT double-inflate.
    stubFetch({ 'http://x/data.bin.gz': { body: ORIGINAL } }); // plain, not gzip
    const buf = await fetchCompressed('http://x/data.bin');
    expect(new Uint8Array(buf)).toEqual(ORIGINAL);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no raw re-download
  });

  it('fetchJsonCompressed parses inflated JSON', async () => {
    stubFetch({ 'http://x/scene.json.gz': { body: new Uint8Array(GZ) } });
    const obj = await fetchJsonCompressed<{ hello: string; n: number }>('http://x/scene.json');
    expect(obj.hello).toBe('world');
    expect(obj.n).toBe(42);
  });
});
