import { describe, it, expect } from 'vitest';
import { buildPack, parsePack, PackError } from '../../src/view/pack/packFormat';
import { PackRegistry, installPackFetch, type PackManifest } from '../../src/view/pack/PackLoader';
import { TextureUploadQueue } from '../../src/view/stage/TextureUploadQueue';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('packFormat', () => {
  const inputs = [
    { path: '/assets/a.json', data: enc('{"a":1}'), mime: 'application/json' },
    { path: '/assets/b.bin', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { path: '/assets/empty', data: new Uint8Array(0) },
  ];
  it('round trips and keeps every entry 4-byte aligned', () => {
    const pack = buildPack(inputs);
    const p = parsePack(pack);
    expect(dec(p.view('/assets/a.json')!)).toBe('{"a":1}');
    expect([...p.view('/assets/b.bin')!]).toEqual([1, 2, 3, 4, 5]);
    expect(p.view('/assets/empty')!.length).toBe(0);
    expect(p.view('/nope')).toBeNull();
    for (const e of p.entries.values()) expect(e.offset % 4).toBe(0);
    expect(p.entries.get('/assets/a.json')!.mime).toBe('application/json');
  });
  it('is deterministic', () => {
    expect(buildPack(inputs)).toEqual(buildPack(inputs));
  });
  it('rejects duplicates, bad magic, truncation, index corruption', () => {
    expect(() => buildPack([inputs[0], inputs[0]])).toThrow(PackError);
    const pack = buildPack(inputs);
    const bad = pack.slice(); bad[0] = 0;
    expect(() => parsePack(bad)).toThrow(/magic/);
    expect(() => parsePack(pack.subarray(0, pack.length - 4))).toThrow(PackError);
    const idx = pack.slice(); idx[20] ^= 0xff;
    expect(() => parsePack(idx)).toThrow(/crc/);
    expect(() => parsePack(new Uint8Array(3))).toThrow(PackError);
  });
});

function setup(packBytes: Uint8Array | null, opts: { packFails?: boolean } = {}) {
  const manifest: PackManifest = {
    v: 1,
    packs: { p1: { file: 'p1.pack', hash: 'h1', bytes: packBytes?.length ?? 0, priority: 'high' } },
    files: { '/assets/x/a.json': 'p1', '/assets/x/b.glb': 'p1' },
  };
  const calls: string[] = [];
  const rawFetch = async (url: string): Promise<Response> => {
    calls.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    if (url.endsWith('p1.pack.gz')) return new Response(null, { status: 404 });
    if (url.endsWith('p1.pack')) {
      if (opts.packFails || !packBytes) return new Response(null, { status: 404 });
      return new Response(packBytes as unknown as BodyInit);
    }
    return new Response('LOOSE:' + url);
  };
  return { reg: new PackRegistry({ rawFetch }), calls, rawFetch };
}

describe('PackRegistry', () => {
  const pack = buildPack([
    { path: '/assets/x/a.json', data: enc('{"k":2}') },
    { path: '/assets/x/b.glb', data: new Uint8Array([9, 9]) },
  ]);
  it('serves entries with ONE pack request', async () => {
    const { reg, calls } = setup(pack);
    expect(dec((await reg.get('/assets/x/a.json'))!)).toBe('{"k":2}');
    expect([...(await reg.get('/assets/x/b.glb'))!]).toEqual([9, 9]);
    expect(calls.filter((c) => c.includes('.pack')).length).toBe(2); // .gz miss + raw, once for both entries
    const res = (await reg.serve('/assets/x/a.json'))!;
    expect(await res.json()).toEqual({ k: 2 });
  });
  it('falls back (null) for unlisted paths and when the pack is missing or corrupt', async () => {
    const a = setup(pack);
    expect(await a.reg.serve('/assets/other.png')).toBeNull();
    const b = setup(null);
    expect(await b.reg.serve('/assets/x/a.json')).toBeNull();
    const corrupt = pack.slice(); corrupt[corrupt.length - 1] ^= 1; corrupt[8] = 0xff; // index length garbage
    const c = setup(corrupt);
    expect(await c.reg.serve('/assets/x/a.json')).toBeNull();
    expect(c.reg.stats.packsFailed).toBe(1);
  });
  it('patched fetch serves packs and falls through on miss/corruption', async () => {
    const good = setup(pack);
    const target = { fetch: (async (u: string) => good.rawFetch(u)) as unknown as typeof fetch, location: { origin: 'http://h' } };
    installPackFetch(good.reg, target);
    const r = await target.fetch('/assets/x/a.json');
    expect(await r.text()).toBe('{"k":2}');
    expect(await (await target.fetch('/assets/zzz.txt')).text()).toBe('LOOSE:/assets/zzz.txt');
    const bad = setup(null);
    const t2 = { fetch: (async (u: string) => bad.rawFetch(u)) as unknown as typeof fetch, location: { origin: 'http://h' } };
    installPackFetch(bad.reg, t2);
    expect(await (await t2.fetch('/assets/x/a.json')).text()).toBe('LOOSE:/assets/x/a.json');
  });
  it('prefetchLoose hands bytes to exactly one later fetch', async () => {
    const { reg } = setup(pack);
    reg.prefetchLoose(['/assets/audio/s.wav']);
    const first = await reg.serve('/assets/audio/s.wav');
    expect(first).not.toBeNull();
    expect(await reg.serve('/assets/audio/s.wav')).toBeNull();
  });
});

describe('TextureUploadQueue', () => {
  it('uploads within a per-frame byte budget but always makes progress', async () => {
    const uploaded: number[] = [];
    const frames: (() => void)[] = [];
    const q = new TextureUploadQueue({ initTexture: (t) => uploaded.push(t as number) }, 100, (cb) => { frames.push(cb); });
    const ps = [1, 2, 3].map((n) => q.enqueue(n, 5, 5)); // 100 bytes each
    frames.shift()!();
    expect(uploaded).toEqual([1]);
    frames.shift()!();
    frames.shift()!();
    await Promise.all(ps);
    expect(uploaded).toEqual([1, 2, 3]);
  });
});
