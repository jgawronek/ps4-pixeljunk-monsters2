#!/usr/bin/env python3
"""extract_sky_cube.py — export the Nature/Water `_SkyMap` as 6 cube faces.

`sky_test_003` is a real Cubemap object (6 x BC6H 1024², 11 mips) in the
`stages` bundle; the generic texture exporter only emitted one face as a 2D
image. The original water shader samples it with samplerCUBE (GCN cube
instructions). Faces are in Unity order +X,-X,+Y,-Y,+Z,-Z. BC6H HDR is
clamped to LDR 8-bit by texture2ddecoder (NEAR: sky is scaled by
_SpecStrength 0.15 so the clamp is low-impact). Downsampled to 512².

Run with the unity venv:
  /srv/opencode/venv-unity/bin/python -I tools/stages/extract_sky_cube.py
Writes public/assets/stages/3d_stage_001/sky/sky_test_003_{0..5}.webp
"""
import os
import sys
import UnityPy
import texture2ddecoder as t2d
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, 'pjm2-web/public/assets/stages/3d_stage_001/sky')
NAME = sys.argv[1] if len(sys.argv) > 1 else 'sky_test_003'
# usage: extract_sky_cube.py [name] [out_dir] ; also writes <name>_env.webp = face 0 flipped (the 2D view the generic
# exporter makes of a cubemap, used by SkyAtmosphere as the PMREM specular environment for stages whose skybox != sky_test_003)

os.makedirs(OUT, exist_ok=True)
env = UnityPy.load(AB)
for o in env.objects:
    if o.type.name != 'Cubemap':
        continue
    d = o.read()
    if d.m_Name != NAME:
        continue
    w = d.m_Width
    per = d.m_CompleteImageSize
    raw = bytes(d.image_data)
    for f in range(6):
        face = raw[f * per: f * per + w * w]  # mip 0 of BC6H = 1 byte/px
        bgra = t2d.decode_bc6(face, w, w)
        im = Image.frombytes('RGBA', (w, w), bgra, 'raw', 'BGRA').convert('RGB')
        im = im.resize((512, 512), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{NAME}_{f}.webp'), 'WEBP', quality=92, method=6)
    f0 = bytes(d.image_data)[0:w * w]
    env0 = Image.frombytes('RGBA', (w, w), t2d.decode_bc6(f0, w, w), 'raw', 'BGRA').convert('RGB').transpose(Image.FLIP_TOP_BOTTOM)
    env0.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'{NAME}_env.webp'), 'WEBP', quality=88, method=6)
    print(f'wrote 6 faces to {OUT}')
    break
else:
    sys.exit(f'cubemap {NAME} not found')
