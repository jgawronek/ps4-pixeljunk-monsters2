import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { invertMeshPack } from '../../src/view/stage/meshPackTransform';

const dir = 'public/assets/stages/3d_stage_001/';

describe('invertMeshPack', () => {
  it('inverts shuffle + idx zigzag-delta (hand-built entries)', () => {
    const f = new Float32Array([1.5, -2.25, 3e5]);
    const idx = new Uint32Array([5, 3, 4000000000, 7]);
    const buf = new ArrayBuffer(28);
    const sh = (u: Uint8Array, o: number, n: number) => {
      const out = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) out[j * n + i] = u[i * 4 + j];
      new Uint8Array(buf).set(out, o);
    };
    sh(new Uint8Array(f.buffer), 0, 3);
    const zz = new Uint32Array(4);
    let p = 0;
    idx.forEach((x, i) => { const d = (x - p) | 0; p = x; zz[i] = ((d << 1) ^ (d >> 31)) >>> 0; });
    // idx entry sits at offset 12, length 16
    sh(new Uint8Array(zz.buffer), 12, 4);
    const out = invertMeshPack(buf, {
      'm.pos.f32.bin': { offset: 0, length: 12 },
      'm.idx.u32.bin': { offset: 12, length: 16 },
    });
    expect(Array.from(new Float32Array(out, 0, 3))).toEqual(Array.from(f));
    expect(Array.from(new Uint32Array(out, 12, 4))).toEqual(Array.from(idx));
  });

  it.skipIf(!existsSync(dir + 'meshes.pack.sh.bin'))('matches the untransformed pack byte-for-byte', () => {
    const index = JSON.parse(readFileSync(dir + 'meshes-pack.json', 'utf8'));
    const sh = readFileSync(dir + 'meshes.pack.sh.bin');
    const raw = readFileSync(dir + 'meshes.pack.bin');
    const ab = sh.buffer.slice(sh.byteOffset, sh.byteOffset + sh.byteLength) as ArrayBuffer;
    const out = Buffer.from(invertMeshPack(ab, index.entries));
    expect(out.equals(raw)).toBe(true);
  });
});
