#!/usr/bin/env python3
"""shuffle_mesh_pack.py — lossless transform of meshes.pack.bin for smaller gzip.

Reads meshes.pack.bin + meshes-pack.json (as written by pack_mesh_bins.py) and
writes meshes.pack.sh.bin with every entry transformed IN PLACE (same offset,
same length, so loader validation is unchanged):

  - f32/u32 channels: 4-byte byte-plane shuffle (all byte0s, then byte1s, …)
  - idx: zigzag delta of consecutive u32 first, then the same shuffle
  - col0 (RGBA8): untouched

gzip -6 of the pack drops 15.2MB → ~9.9MB. The sidecar gets
`file: meshes.pack.sh.bin` + `transform: "shuf4-zzdelta-idx"`; the loader
inverts it after inflate (src/view/stage/meshPackTransform.ts).
Run compress_assets.py afterwards to write the .gz sibling.

Usage: python3 shuffle_mesh_pack.py [<stage_dir>...]
"""
import array
import json
import os
import sys

TRANSFORM = 'shuf4-zzdelta-idx'


def shuffle4(b):
    return b''.join(b[j::4] for j in range(4))


def zz_delta(b):
    v = array.array('I')
    v.frombytes(b)
    out = array.array('I', bytes(len(b)))
    prev = 0
    for i, x in enumerate(v):
        d = (x - prev) & 0xFFFFFFFF
        prev = x
        sd = d - (1 << 32) if d & 0x80000000 else d
        out[i] = ((sd << 1) ^ (sd >> 31)) & 0xFFFFFFFF
    return out.tobytes()


def process(stage_dir):
    idx_path = os.path.join(stage_dir, 'meshes-pack.json')
    index = json.load(open(idx_path))
    if index.get('transform'):
        print(f'{stage_dir}: already transformed, rerun pack_mesh_bins.py first')
        return
    blob = bytearray(open(os.path.join(stage_dir, index['file']), 'rb').read())
    for rel, e in index['entries'].items():
        ch = rel.split('.')[-3]
        if ch == 'col0':
            continue
        o, n = e['offset'], e['length']
        data = bytes(blob[o:o + n])
        if ch == 'idx':
            data = zz_delta(data)
        blob[o:o + n] = shuffle4(data)
    out = 'meshes.pack.sh.bin'
    open(os.path.join(stage_dir, out), 'wb').write(blob)
    index['file'] = out
    index['transform'] = TRANSFORM
    with open(idx_path, 'w') as f:
        json.dump(index, f, separators=(',', ':'))
        f.write('\n')
    print(f'{stage_dir}: wrote {out} ({len(blob) / 1e6:.1f}MB)')


if __name__ == '__main__':
    for d in sys.argv[1:] or ['public/assets/stages/3d_stage_001']:
        process(d)
