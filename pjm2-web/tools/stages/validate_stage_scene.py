#!/usr/bin/env python3
"""Independent reload validation for an extracted stage scene (no UnityPy needed).

Re-reads scene.json + binary mesh bins + PNG textures from disk and checks:
  - every node/mesh/material/texture reference resolves
  - node hierarchy is a valid forest (parent indices, no cycles, all reachable)
  - mesh bin element counts match meta; indices in range; submesh slices in range
  - terrain_001 has the expected vert/tri counts (parity w/ collider spike)
  - every PNG opens at the recorded size; real image content (distinct colors)
  - renderable LOD0 entries reference valid submesh slices
  - manifest counts agree with scene.json

Usage: /srv/opencode/venv-unity/bin/python validate_stage_scene.py [OUT_DIR]
"""
import collections
import json
import os
import struct
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(REPO, 'pjm2-web/public/assets/stages/3d_stage_001')


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    scene = json.load(open(os.path.join(out, 'scene.json')))
    nodes, meshes, mats, texs = scene['nodes'], scene['meshes'], scene['materials'], scene['textures']
    errors, warns = [], []

    # ---- hierarchy ----
    n = len(nodes)
    for i, nd in enumerate(nodes):
        if nd['i'] != i:
            errors.append(f'node index mismatch at {i}')
        p = nd['parent']
        if p != -1 and not (0 <= p < n):
            errors.append(f'node {i} bad parent {p}')
        if p != -1 and p >= i:
            errors.append(f'node {i} parent {p} not earlier (DFS order broken)')
    # reachability + cycle check via parent walk
    for i, nd in enumerate(nodes):
        seen, cur = set(), i
        while cur != -1:
            if cur in seen:
                errors.append(f'cycle at node {i}'); break
            seen.add(cur); cur = nodes[cur]['parent']
    roots = sum(1 for nd in nodes if nd['parent'] == -1)

    # ---- mesh bins ----
    total_verts = total_tris = 0
    for mid, m in meshes.items():
        vc, ic = m['vertexCount'], m['indexCount']
        total_verts += vc; total_tris += m['triangleCount']
        for ch, comps in (('pos', 3), ('nrm', 3), ('uv0', 2), ('tan', 4)):
            if ch in m['files']:
                p = os.path.join(out, m['files'][ch])
                sz = os.path.getsize(p)
                if sz != vc * comps * 4:
                    errors.append(f'{mid}.{ch} size {sz} != {vc}*{comps}*4')
        ip = os.path.join(out, m['files']['idx'])
        isz = os.path.getsize(ip)
        if isz != ic * 4:
            errors.append(f'{mid}.idx size {isz} != {ic}*4')
        idx = struct.unpack(f'<{ic}I', open(ip, 'rb').read())
        if idx and (min(idx) < 0 or max(idx) >= vc):
            errors.append(f'{mid} index out of range (max {max(idx)} vs verts {vc})')
        # submesh slices partition the index buffer
        off = 0
        for sm in m['submeshes']:
            if sm['firstIndex'] != off:
                errors.append(f'{mid} submesh gap at {off} vs {sm["firstIndex"]}')
            off += sm['indexCount']
        if off != ic:
            errors.append(f'{mid} submeshes sum {off} != indexCount {ic}')

    # ---- terrain parity ----
    # The 10960/21785 parity numbers are stage 1's terrain_001 (collider spike); other stages have their own terrain
    # mesh, so there we only require that a terrain mesh exists (collider parity is checked by the collider extractor).
    is_stage1 = os.path.basename(os.path.normpath(out)) == '3d_stage_001'
    terr = next((m for m in meshes.values() if m['name'] == 'terrain_001'), None)
    if is_stage1:
        terr_ok = bool(terr and terr['vertexCount'] == 10960 and terr['triangleCount'] == 21785)
        if not terr_ok:
            errors.append('terrain_001 vert/tri parity failed')
    else:
        terr = next((m for m in meshes.values() if m['name'].startswith('terrain_')), None)
        terr_ok = terr is not None
        if not terr_ok:
            errors.append('no terrain_* mesh')

    # ---- references ----
    for nd in nodes:
        r = nd['render']
        if not r:
            continue
        if r['mesh'] and r['mesh'] not in meshes:
            errors.append(f'node {nd["name"]} mesh ref {r["mesh"]} missing')
        for mm in r['materials']:
            if mm and mm not in mats:
                errors.append(f'node {nd["name"]} material ref {mm} missing')
        if r['subMesh'] and r['mesh'] in meshes:
            m = meshes[r['mesh']]
            if r['subMesh']['first'] + r['subMesh']['count'] > len(m['submeshes']):
                errors.append(f'node {nd["name"]} subMesh slice out of range')
    for mat in mats.values():
        for slot, t in mat['textures'].items():
            if t['texture'] not in texs:
                errors.append(f'material {mat["name"]} tex ref {t["texture"]} missing')

    # ---- textures ----
    from PIL import Image
    fmt_c = collections.Counter()
    tex_bytes = 0
    for tid, t in texs.items():
        fmt_c[t['formatName']] += 1
        if 'file' not in t:
            errors.append(f'texture {tid} has no PNG ({t.get("error")})'); continue
        p = os.path.join(out, t['file'])
        tex_bytes += os.path.getsize(p)
        try:
            im = Image.open(p); im.load()
            if im.size != (t['width'], t['height']):
                errors.append(f'texture {tid} size {im.size} != {(t["width"], t["height"])}')
            # real-content check on a small sample
            sm = im.convert('RGBA').resize((32, 32))
            if len(set(sm.getdata())) < 4:
                warns.append(f'texture {tid} near-constant (may be flat/data map)')
        except Exception as e:
            errors.append(f'texture {tid} open fail: {e}')

    # ---- renderable census ----
    renderable = [nd for nd in nodes if nd['render'] and nd['render']['enabled']
                  and nd['activeInHierarchy'] and nd['render']['lodLevel'] in (0, None)
                  and nd['render']['mesh']]
    rend_tris = 0
    for nd in renderable:
        r = nd['render']; m = meshes[r['mesh']]
        if r['subMesh']:
            sm = m['submeshes'][r['subMesh']['first']]
            rend_tris += sm['indexCount'] // 3
        else:
            rend_tris += m['triangleCount']

    # ---- manifest agreement ----
    man = json.load(open(os.path.join(out, 'manifest.json')))
    if man['counts']['nodes'] != n:
        errors.append('manifest node count mismatch')
    if man['counts']['uniqueMeshes'] != len(meshes):
        errors.append('manifest mesh count mismatch')
    if man['counts']['uniqueTextures'] != len(texs):
        errors.append('manifest texture count mismatch')

    print('===== independent reload validation =====')
    print(f'nodes:            {n}  (roots: {roots})')
    print(f'meshes:           {len(meshes)}  verts {total_verts}  tris {total_tris}')
    print(f'materials:        {len(mats)}')
    print(f'textures:         {len(texs)}  formats {dict(fmt_c)}  pngBytes {tex_bytes/1e6:.1f} MB')
    print(f'terrain:          {"PASS" if terr_ok else "FAIL"} ({terr["vertexCount"] if terr else 0} verts / {terr["triangleCount"] if terr else 0} tris{"; stage-1 parity 10960/21785" if is_stage1 else ""})')
    print(f'renderable:       {len(renderable)} nodes  ~{rend_tris} triangles (LOD0+active+enabled)')
    print(f'errors:           {len(errors)}')
    for e in errors[:30]:
        print('   ERR', e)
    print(f'warnings:         {len(warns)}')
    for w in warns[:10]:
        print('   warn', w)
    print('RESULT:', 'PASS' if not errors else 'FAIL')
    sys.exit(0 if not errors else 1)


if __name__ == '__main__':
    main()
