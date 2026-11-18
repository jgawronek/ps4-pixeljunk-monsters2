#!/usr/bin/env python3
"""add_col0_channel.py — backfill vertex-color (col0) bins for stage scenes.

Iter-37 terrain splat work established that the source meshes DO carry vertex
colors (UnityPy MeshHandler.m_Colors, RGBA bytes) — the original extractor
simply never wrote them. The Shader Forge "Splatt_Normal_Gloss" terrain
shader has no splat-map texture slot, so vertex colors ARE the layer weights.

This script re-opens the source bundle, matches each mesh recorded in the
scene JSON by (sourceFile, pathId), and writes meshes/<id>.col0.u8.bin
(RGBA bytes, three.js normalized Uint8 BufferAttribute) for every mesh that
has colors, then patches the scene JSON(s): files.col0 + channels.

Idempotent: meshes whose col0 bin already exists are skipped.

Usage: python add_col0_channel.py <bundle> <stage_dir> [<stage_dir>...]
  e.g. python add_col0_channel.py .../AssetBundles/stages public/assets/stages/3d_stage_001
"""
import array
import json
import os
import sys

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


def mesh_colors(bundle_path):
    """Yield ((assets_file_name, path_id), rgba_byte_list) for meshes with colors."""
    env = UnityPy.load(bundle_path)
    for obj in env.objects:
        if obj.type.name != 'Mesh':
            continue
        m = obj.read()
        h = MeshHandler(m)
        try:
            h.process()
        except Exception:
            continue
        cols = getattr(h, 'm_Colors', None)
        if not cols:
            continue
        flat = []
        is_float = isinstance(cols[0][0], float)
        for c in cols:
            if is_float and c[0] <= 1.0:  # float colors in 0..1
                flat.extend(int(round(v * 255)) for v in c)
            else:
                flat.extend(int(v) for v in c)
        yield (m.assets_file.name, obj.path_id), flat


def process_stage(stage_dir, color_index):
    # Prefer scene-webp.json; patch scene.json too when present.
    targets = [f for f in ('scene-webp.json', 'scene.json')
               if os.path.exists(os.path.join(stage_dir, f))]
    if not targets:
        print(f'{stage_dir}: no scene json, skipped')
        return
    doc = json.load(open(os.path.join(stage_dir, targets[0])))
    meshes = doc.get('meshes', {})
    written = skipped = missing = 0
    for mid, meta in meshes.items():
        key = (meta['sourceFile'], meta['pathId'])
        cols = color_index.get(key)
        if cols is None:
            missing += 1
            continue
        rel = f'meshes/{mid}.col0.u8.bin'
        out = os.path.join(stage_dir, rel)
        if not os.path.exists(out):
            arr = array.array('B', cols)
            with open(out, 'wb') as f:
                arr.tofile(f)
            written += 1
        else:
            skipped += 1
        # patch all targets
        for t in targets:
            d = json.load(open(os.path.join(stage_dir, t)))
            mm = d['meshes'][mid]
            mm['files']['col0'] = rel
            if 'col0' not in mm['channels']:
                mm['channels'].append('col0')
            with open(os.path.join(stage_dir, t), 'w') as f:
                json.dump(d, f, separators=(',', ':'))
    print(f'{stage_dir}: col0 written={written} reused={skipped} no-colors={missing}')


def main():
    bundle = sys.argv[1]
    stage_dirs = sys.argv[2:]
    print('indexing bundle colors…')
    color_index = dict(mesh_colors(bundle))
    print(f'{len(color_index)} meshes with vertex colors')
    for d in stage_dirs:
        process_stage(d, color_index)


if __name__ == '__main__':
    main()
