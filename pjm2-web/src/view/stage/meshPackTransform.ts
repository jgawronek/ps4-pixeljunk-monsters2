/** Inverse of tools/stages/shuffle_mesh_pack.py (transform 'shuf4-zzdelta-idx').
 *  Entries keep their offset/length; returns a NEW buffer so a cached copy of
 *  the transformed bytes is never mutated. */
export const MESH_PACK_TRANSFORM = 'shuf4-zzdelta-idx';

export function invertMeshPack(
  src: ArrayBuffer,
  entries: Record<string, { offset: number; length: number }>,
): ArrayBuffer {
  const out = new ArrayBuffer(src.byteLength);
  const s = new Uint8Array(src);
  const d = new Uint8Array(out);
  d.set(s); // padding + untouched channels (col0)
  for (const [rel, e] of Object.entries(entries)) {
    const ch = rel.split('.').slice(-3)[0];
    if (ch === 'col0') continue;
    const n = e.length >> 2;
    const o = e.offset;
    if (ch === 'idx') {
      const v = new Uint32Array(out, o, n);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const z = s[o + i] | (s[o + n + i] << 8) | (s[o + 2 * n + i] << 16) | (s[o + 3 * n + i] << 24);
        prev = (prev + ((z >>> 1) ^ -(z & 1))) >>> 0;
        v[i] = prev;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const j = o + (i << 2);
        d[j] = s[o + i]; d[j + 1] = s[o + n + i]; d[j + 2] = s[o + 2 * n + i]; d[j + 3] = s[o + 3 * n + i];
      }
    }
  }
  return out;
}
