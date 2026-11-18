#!/usr/bin/env python3
"""
validate_outputs.py — reload and sanity-check extractor outputs.

  * GLB  -> trimesh: vertex/face counts, presence of skin attributes, joint count,
            inverse-bind-matrix sanity, bind-pose vertex range
  * PNG  -> Pillow: dimensions, mode, non-degenerate pixel statistics
  * JSON -> clips.json / components.json / manifest.json parse + structural checks,
            animation value plausibility (quaternion norms, position ranges)

Usage: PYTHONPATH=tools/assets/pylibs python tools/assets/validate_outputs.py <kuri_output_dir>
Writes <output_dir>/../validation.txt (i.e. .work/asset-spike/validation.txt) and prints.
"""
import glob
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import numpy as np  # noqa: E402

out_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
if not out_dir:
    print('usage: validate_outputs.py <output_dir>'); sys.exit(1)
report_path = os.path.join(os.path.dirname(out_dir), 'validation.txt')
lines = []


def say(msg=''):
    print(msg)
    lines.append(str(msg))


def section(t):
    say(''); say(f'=== {t} ===')


# ------------------------------------------------------------------ GLB ----
section('GLB reload (trimesh)')
import trimesh  # noqa: E402

glbs = sorted(glob.glob(os.path.join(out_dir, '*.glb')))
for gp in glbs:
    say(f'file: {os.path.basename(gp)} ({os.path.getsize(gp)} bytes)')
    scene = trimesh.load(gp)
    geoms = list(scene.geometry.values())
    say(f'  scene geoms: {len(geoms)}; nodes: {len(scene.graph.nodes_geometry)}')
    for name, g in scene.geometry.items():
        say(f'  geom {name!r}: vertices={len(g.vertices)} faces={len(g.faces)} '
            f'bounds_min={np.round(g.bounds[0], 4).tolist()} bounds_max={np.round(g.bounds[1], 4).tolist()}')
    # raw glTF JSON for skin/attribute checks (trimesh drops skinning info)
    with open(gp, 'rb') as f:
        raw = f.read()
    json_len = int.from_bytes(raw[12:16], 'little')
    gj = json.loads(raw[20:20 + json_len])
    say(f'  glTF asset: version={gj["asset"]["version"]} generator={gj["asset"].get("generator", "")[:60]}')
    skins = gj.get('skins', [])
    say(f'  skins: {len(skins)}')
    for s in skins:
        say(f'    skin {s.get("name")!r}: joints={len(s["joints"])} skeletonNode={s.get("skeleton")} '
            f'IBMacc={s.get("inverseBindMatrices")}')
    # IBM sanity: rigid transforms (det≈1, orthonormal rotation part)
    if skins:
        acc = gj['accessors'][skins[0]['inverseBindMatrices']]
        bv = gj['bufferViews'][acc['bufferView']]
        bin_off = 20 + json_len + 8
        bin_off += bv.get('byteOffset', 0)
        ibm = np.frombuffer(raw, dtype='<f4', count=acc['count'] * 16, offset=bin_off).reshape(-1, 4, 4)
        # glTF stores column-major -> transpose to get row-major math matrices
        m = ibm.transpose(0, 2, 1)
        dets = np.linalg.det(m[:, :3, :3])
        say(f'    IBM rotation-part dets: min={dets.min():.4f} max={dets.max():.4f} (expect ~1)')
        ortho_err = max(np.abs(mat[:3, :3].T @ mat[:3, :3] - np.eye(3)).max() for mat in m)
        say(f'    IBM orthonormality max err: {ortho_err:.2e}')
    # primitive attributes
    prims = gj['meshes'][0]['primitives']
    attrs = sorted(prims[0]['attributes'].keys())
    say(f'  primitives: {len(prims)}; attributes: {attrs}')
    for a in ('POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'):
        acc = gj['accessors'][prims[0]['attributes'][a]] if a in prims[0]['attributes'] else None
        if acc:
            say(f'    {a}: count={acc["count"]} type={acc["type"]} compType={acc["componentType"]}'
                + (f' min={np.round(acc["min"], 4).tolist()} max={np.round(acc["max"], 4).tolist()}' if 'min' in acc else ''))
    # weights sum check
    wacc = gj['accessors'][prims[0]['attributes']['WEIGHTS_0']]
    wbv = gj['bufferViews'][wacc['bufferView']]
    woff = 20 + json_len + 8 + wbv.get('byteOffset', 0)
    w = np.frombuffer(raw, dtype='<f4', count=wacc['count'] * 4, offset=woff).reshape(-1, 4)
    ws = w.sum(axis=1)
    say(f'  WEIGHTS_0 sums: min={ws.min():.5f} max={ws.max():.5f} (expect 1.0)')
    jacc = gj['accessors'][prims[0]['attributes']['JOINTS_0']]
    jbv = gj['bufferViews'][jacc['bufferView']]
    joff = 20 + json_len + 8 + jbv.get('byteOffset', 0)
    j = np.frombuffer(raw, dtype='<u2', count=jacc['count'] * 4, offset=joff).reshape(-1, 4)
    say(f'  JOINTS_0 range: {j.min()}..{j.max()} (joints={len(skins[0]["joints"])})')
    say(f'  nodes total: {len(gj["nodes"])}')
    # index sanity
    iacc = gj['accessors'][prims[0]['indices']]
    say(f'  indices: count={iacc["count"]} compType={iacc["componentType"]}')

# ------------------------------------------------------------------ PNG ----
section('PNG reload (Pillow)')
from PIL import Image, ImageStat  # noqa: E402

for p in sorted(glob.glob(os.path.join(out_dir, 'textures', '*.png'))):
    im = Image.open(p)
    im.load()
    stat = ImageStat.Stat(im.convert('RGB'))
    a = np.asarray(im.convert('RGBA'), dtype=np.uint8)
    uniq = len(np.unique(a.reshape(-1, 4), axis=0))
    say(f'{os.path.basename(p)}: size={im.size} mode={im.mode} bytes={os.path.getsize(p)} '
        f'meanRGB={[round(x, 1) for x in stat.mean]} distinctColors={uniq}')

# ----------------------------------------------------------------- JSON ----
section('clips.json')
with open(os.path.join(out_dir, 'clips.json')) as f:
    cd = json.load(f)
say(f'clips: {len(cd["clips"])}; animator: {cd["animator"]}')
say(f'clipNames: {cd["clipNames"]}')
bad = 0
for c in cd['clips']:
    if 'error' in c:
        say(f'  ERROR clip {c["clipName"]}: {c["error"]}'); bad += 1; continue
    nb = len(c.get('bindings', []))
    nk = sum(len(b['times']) for b in c.get('bindings', []))
    # plausibility
    for bnd in c.get('bindings', []):
        assert len(bnd['times']) == len(bnd['values']), f'len mismatch {c["clipName"]} {bnd["path"]}'
        if bnd['property'].startswith('m_LocalRotation'):
            v = np.abs(bnd['values'])
            if v.max() > 1.0001:
                say(f'  WARN quaternion comp >1: {c["clipName"]} {bnd["path"]} {bnd["property"]} max={v.max()}')
                bad += 1
        if bnd['property'].startswith('m_LocalPosition'):
            v = np.abs(bnd['values'])
            if v.max() > 100:
                say(f'  WARN position >100: {c["clipName"]} {bnd["path"]} {bnd["property"]} max={v.max()}')
                bad += 1
    st = c.get('stats', {})
    say(f'  {c["clipName"]:<26} bindings={nb:>3} keys={nk:>6} dur={c.get("stopTime", "?"):.3f}s '
        f'loop={c.get("loopTime")} stream/dense/const={st.get("streamedCurves")}/{st.get("denseCurves")}/{st.get("constantCurves")} '
        f'unresolved={len(st.get("unresolvedChannels", []))}')
# quaternion norm check across x/y/z/w groups
for c in cd['clips']:
    if 'error' in c:
        continue
    groups = {}
    for bnd in c.get('bindings', []):
        if bnd['property'].startswith('m_LocalRotation.'):
            key = (bnd['path'], bnd['property'][-1])
            groups.setdefault(bnd['path'], {})[bnd['property'][-1]] = (bnd['times'], bnd['values'])
    for path, comps in groups.items():
        if set(comps) == {'x', 'y', 'z', 'w'} and len(set(len(comps[k][1]) for k in comps)) == 1:
            arr = np.array([comps[k][1] for k in 'xyzw'])
            norms = np.linalg.norm(arr, axis=0)
            dev = np.abs(norms - 1).max()
            if dev > 0.05:
                say(f'  WARN quat norm dev {dev:.3f} for {c["clipName"]} {path} (mixed keyframe times expected)')
say(f'clips.json structural errors/warnings: {bad}')

section('components.json')
with open(os.path.join(out_dir, 'components.json')) as f:
    inv = json.load(f)
say(f'logic nodes: {inv["logicPrefab"]["nodeCount"]}; visual nodes: {inv["visualPrefab"]["nodeCount"]}')
say(f'enemyBaseCrossRef present: {"enemyBaseCrossRef" in inv and isinstance(inv["enemyBaseCrossRef"], dict)}')
if isinstance(inv.get('enemyBaseCrossRef'), dict):
    eb = inv['enemyBaseCrossRef']
    say(f'  maxLife={eb.get("maxLife")} speed={eb.get("speed")} expValue={eb.get("expValue")}')

section('manifest.json')
with open(os.path.join(out_dir, 'manifest.json')) as f:
    mf = json.load(f)
import hashlib
ok = True
for fe in mf['files']:
    p = os.path.join(out_dir, fe['path'])
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    sz = os.path.getsize(p)
    match = (h == fe['sha256'] and sz == fe['bytes'])
    ok &= match
    say(f'  {fe["path"]:<28} {fe["bytes"]:>9} B  sha256={"OK" if match else "MISMATCH"}')
say(f'manifest integrity: {"ALL OK" if ok else "FAILURES"}')
say('')
say('VALIDATION COMPLETE')

with open(report_path, 'w') as f:
    f.write('\n'.join(lines) + '\n')
print(f'\n(wrote {report_path})')
