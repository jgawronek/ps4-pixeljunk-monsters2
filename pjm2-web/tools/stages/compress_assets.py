#!/usr/bin/env python3
"""compress_assets.py — pre-compress large stage assets to .gz siblings.

The dev server hosts ~116MB of stage assets; on a slow/remote link the raw
39MB mesh pack alone took >1min (localhost: 0.06s). The loader
(src/view/stage/compressedFetch.ts) fetches `url + '.gz'` first and inflates
client-side via DecompressionStream, falling back to the raw file. This script
writes those .gz siblings (gzip -6): mesh pack 39→15MB, scene JSON 1.1→0.1MB.

Idempotent: skips a .gz that is newer than its source. WebP textures are
already compressed and are intentionally NOT gzipped (no gain).

Usage: python compress_assets.py <stage_dir> [<stage_dir>...]
"""
import gzip
import os
import sys

# Large, compressible payloads (binary float mesh data + JSON). Skip webp/png.
TARGETS = ['meshes.pack.sh.bin', 'meshes.pack.bin', 'scene-webp.json', 'scene.json']


def compress_file(path):
    gz = path + '.gz'
    if os.path.exists(gz) and os.path.getmtime(gz) >= os.path.getmtime(path):
        return None  # up to date
    with open(path, 'rb') as f_in, gzip.open(gz, 'wb', compresslevel=6) as f_out:
        while True:
            chunk = f_in.read(1 << 20)
            if not chunk:
                break
            f_out.write(chunk)
    return os.path.getsize(path), os.path.getsize(gz)


def main():
    for stage_dir in sys.argv[1:]:
        for name in TARGETS:
            path = os.path.join(stage_dir, name)
            if not os.path.exists(path):
                continue
            res = compress_file(path)
            if res is None:
                print(f'{path}.gz: up to date')
            else:
                raw, gz = res
                print(f'{path}: {raw/1e6:.1f}MB -> {gz/1e6:.1f}MB ({gz/raw*100:.0f}%)')


if __name__ == '__main__':
    main()
