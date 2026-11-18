#!/usr/bin/env python3
"""
extract_particle_meshes.py — ParticleSystemRenderer in MESH mode (RenderMode 4): rock chunks, gears, leaves, water-splash
shells. The billboard extractor (extract_particles.py) cannot represent them, so the web port drew nothing / a dot.

For every ParticleSystemRenderer with m_RenderMode == 4 (structures, enemies, props, globalsettings bundles) it records
  emitter (GameObject) name -> { mesh, material, shader, color (_Color), alignment }
and exports each distinct mesh as JSON {name, positions[], normals[], uvs[], indices[]} (RAW Unity space).

OUTPUT  public/assets/particles/mesh-render.json
        public/assets/particles/meshes/<mesh>.json
Usage (from pjm2-web/): /srv/opencode/venv-unity/bin/python -I tools/assets/extract_particle_meshes.py
"""
import json
import os

import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
AB = os.path.join(ROOT, '..', 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'public', 'assets', 'particles')


def r4(x):
    return round(float(x), 5)


def export_mesh(reader):
    m = reader.read()
    obj = m.export()  # Wavefront OBJ text
    pos, nor, uv, faces = [], [], [], []
    for line in obj.splitlines():
        t = line.split()
        if not t:
            continue
        if t[0] == 'v':
            pos.append([float(t[1]), float(t[2]), float(t[3])])
        elif t[0] == 'vn':
            nor.append([float(t[1]), float(t[2]), float(t[3])])
        elif t[0] == 'vt':
            uv.append([float(t[1]), float(t[2])])
        elif t[0] == 'f':
            faces.append([[int(x) - 1 if x else -1 for x in (c.split('/') + ['', ''])[:3]] for c in t[1:]])
    # de-index to unique (v, vt, vn) triples
    keys, P, N, U, I = {}, [], [], [], []
    for f in faces:
        for tri in range(1, len(f) - 1):
            for c in (f[0], f[tri], f[tri + 1]):
                k = tuple(c)
                if k not in keys:
                    keys[k] = len(P) // 3
                    P.extend(map(r4, pos[c[0]]))
                    N.extend(map(r4, nor[c[2]] if c[2] >= 0 and c[2] < len(nor) else (0, 1, 0)))
                    U.extend(map(r4, uv[c[1]] if c[1] >= 0 and c[1] < len(uv) else (0, 0)))
                I.append(keys[k])
    return {'name': m.m_Name, 'positions': P, 'normals': N, 'uvs': U, 'indices': I}


def main():
    os.makedirs(os.path.join(OUT, 'meshes'), exist_ok=True)
    render = {}
    meshes = {}
    for b in ['structures', 'enemies', 'props', 'globalsettings']:
        env = UnityPy.load(os.path.join(AB, b))
        objs = {o.path_id: o for o in env.objects}
        for pid, o in objs.items():
            if o.type.name != 'ParticleSystemRenderer':
                continue
            r = o.read_typetree()
            if r['m_RenderMode'] != 4:
                continue
            mp = r['m_Mesh']['m_PathID']
            if mp not in objs or objs[mp].type.name != 'Mesh':
                continue
            mname = objs[mp].read_typetree()['m_Name']
            go = objs[r['m_GameObject']['m_PathID']].read_typetree()['m_Name']
            mat = None
            for m in r['m_Materials']:
                if m['m_PathID'] in objs:
                    mt = objs[m['m_PathID']].read_typetree()
                    cols = {k: v for k, v in mt['m_SavedProperties']['m_Colors']}
                    fl = {k: v for k, v in mt['m_SavedProperties']['m_Floats']}
                    c = cols.get('_Color') or cols.get('_TintColor')
                    em = cols.get('_EmissionColor')
                    sh = mt['m_Shader']['m_PathID']
                    shader = objs[sh].read_typetree()['m_ParsedForm']['m_Name'] if sh in objs and objs[sh].type.name == 'Shader' else None
                    mat = {'material': mt['m_Name'], 'shader': shader,
                           'color': [r4(c[k]) for k in 'rgba'] if c else [1, 1, 1, 1],
                           # Standard shader: _Mode 0 opaque / 1 cutout / 2 fade / 3 transparent
                           'mode': int(fl.get('_Mode', 0)), 'glossiness': r4(fl.get('_Glossiness', 0.5)),
                           'metallic': r4(fl.get('_Metallic', 0.0)),
                           'emission': [r4(em[k]) for k in 'rgb'] if em else [0, 0, 0]}
                    break
            render[go] = {'mesh': mname, 'alignment': r['m_RenderAlignment'], **(mat or {})}
            if mname not in meshes:
                meshes[mname] = export_mesh(objs[mp])
    for n, mdata in meshes.items():
        with open(os.path.join(OUT, 'meshes', n + '.json'), 'w') as fh:
            json.dump(mdata, fh, separators=(',', ':'))
    with open(os.path.join(OUT, 'mesh-render.json'), 'w') as fh:
        json.dump({'version': 1, 'emitters': render}, fh, indent=1, sort_keys=True)
    print('emitters', len(render), 'meshes', {n: (len(m['positions']) // 3, len(m['indices']) // 3) for n, m in meshes.items()})


if __name__ == '__main__':
    main()
