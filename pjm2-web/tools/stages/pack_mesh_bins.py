#!/usr/bin/env python3
"""pack_mesh_bins.py — pack a stage's raw mesh bins into ONE blob + sidecar index.

Load-time work (iter load-perf): the stage loader fetched every mesh channel
as its own request (52+ requests for stage 1, sequentially per mesh). On the
vite dev server request count — not bandwidth — dominates. This tool packs
all bins referenced by scene.json into:

  meshes.pack.bin   — concatenation of the raw bins, each entry 4-byte aligned
                      (Float32Array/Uint32Array views need 4-byte alignment;
                      the loader slices zero-copy typed-array views over it).
  meshes-pack.json  — sidecar index: {version, file, totalBytes,
                      entries: {<file-as-in-scene.json>: {offset, length}}}

The loader fetches the sidecar + blob (2 requests) and falls back to the
per-file path automatically when either is absent or fails validation, so
this pack is purely additive — never required.

Deterministic: entries are laid out in scene.json mesh order, channels in
each mesh's `channels` order. Idempotent: re-running rewrites both outputs.
Pure stdlib — no UnityPy needed (operates on the extracted bins only).

Usage: python3 pack_mesh_bins.py [<stage_dir>...]
  default stage_dir: public/assets/stages/3d_stage_001
"""
import json
import os
import sys

CHANNEL_BYTES = {'pos': 12, 'nrm': 12, 'uv0': 8, 'tan': 16, 'idx': 4, 'col0': 4}
ALIGN = 4


def expected_bytes(mesh, channel):
    if channel == 'idx':
        return mesh['indexCount'] * 4
    return mesh['vertexCount'] * CHANNEL_BYTES[channel]


def process_stage(stage_dir):
    scene_path = os.path.join(stage_dir, 'scene.json')
    if not os.path.exists(scene_path):
        scene_path = os.path.join(stage_dir, 'scene-webp.json')
    if not os.path.exists(scene_path):
        print(f'{stage_dir}: no scene json, skipped')
        return
    doc = json.load(open(scene_path))

    entries = {}
    chunks = []
    offset = 0
    raw_total = 0
    for mesh_id, mesh in doc['meshes'].items():
        for ch in mesh['channels']:
            rel = mesh['files'][ch]
            path = os.path.join(stage_dir, rel)
            data = open(path, 'rb').read()
            want = expected_bytes(mesh, ch)
            if len(data) != want:
                raise SystemExit(
                    f'{stage_dir}: {rel} is {len(data)} bytes, expected {want} '
                    f'(vertexCount={mesh["vertexCount"]} indexCount={mesh["indexCount"]})')
            if rel in entries:
                # Two meshes sharing one bin file: reuse the first entry.
                if entries[rel]['length'] != len(data):
                    raise SystemExit(f'{stage_dir}: shared file {rel} size mismatch')
                continue
            pad = (-len(data)) % ALIGN
            entries[rel] = {'offset': offset, 'length': len(data)}
            chunks.append(data)
            if pad:
                chunks.append(b'\0' * pad)
            offset += len(data) + pad
            raw_total += len(data)

    blob = b''.join(chunks)
    index = {
        'version': 1,
        'file': 'meshes.pack.bin',
        'totalBytes': len(blob),
        'entries': entries,
    }
    with open(os.path.join(stage_dir, 'meshes.pack.bin'), 'wb') as f:
        f.write(blob)
    with open(os.path.join(stage_dir, 'meshes-pack.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
        f.write('\n')
    print(f'{stage_dir}: {len(entries)} bins, {raw_total / 1e6:.1f}MB raw → '
          f'{len(blob) / 1e6:.1f}MB pack (+{len(blob) - raw_total}B alignment padding)')


def main():
    dirs = sys.argv[1:] or ['public/assets/stages/3d_stage_001']
    for d in dirs:
        process_stage(d)


if __name__ == '__main__':
    main()