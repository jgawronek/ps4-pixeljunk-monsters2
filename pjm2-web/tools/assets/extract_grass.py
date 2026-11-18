#!/usr/bin/env python3
"""extract_grass.py -- Q4 GrassInstanceRenderer data (stages 1-6).

Reads, from the shipped `nature` + `stages` bundles (UnityPy, read-only):
  * the grass prefabs (grass_001_pa for stages 1-3, the stage 4-6 prefab): LODGroup screenRelativeHeight
    thresholds, the three GrassProc_LODn meshes (pos/normal/uv/color) and the Nature/Grass/ProceduralGrass
    material (_GrassColor1/2, wind floats, _FakeAO*),
  * the per-stage grass placements: Transform nodes named grass_* under Small_Props_Grass in
    public/assets/stages/<scene>/scene.json (the renderers are stripped from those nodes; the
    GrassInstanceRenderer draws them instanced).
Writes public/assets/grass/grass.json. See docs/RENDER_EXTRAS_ANALYSIS.md.

  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_grass.py
"""
import json, os, struct
import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.abspath(os.path.join(ROOT, '..'))
NATURE = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/nature')
OUT = os.path.join(ROOT, 'public/assets/grass/grass.json')

PREFABS = {'grass_001': -8348190409370940867, 'grass_002': 2470561285268476497}


def r(x):
    return float(f'{x:.6g}')


def mesh_record(mo):
    mesh = mo.read()
    m = MeshHandler(mesh)
    m.process()
    n = m.m_VertexCount
    flat = lambda a: [r(x) for v in a for x in v] if a is not None and len(a) and hasattr(a[0], '__len__') else ([r(x) for x in a] if a is not None else [])
    pos, nrm, uv, col = flat(m.m_Vertices), flat(m.m_Normals), flat(m.m_UV0), flat(m.m_Colors)
    idx = [int(i) for sub in m.get_triangles() for tri in sub for i in tri]
    return {'name': mesh.m_Name, 'vertexCount': n, 'positions': pos, 'normals': nrm, 'uv0': uv, 'colors': col, 'indices': idx,
            'uvStride': (len(uv) // n) if n and uv else 0, 'colorStride': (len(col) // n) if n and col else 0}


def main():
    nb = UnityPy.load(NATURE).files[NATURE]
    f = next(v for k, v in nb.files.items() if hasattr(v, 'objects') and -8348190409370940867 in v.objects)
    out = {'source': 'nature bundle ' + f.name, 'prefabs': {}, 'stages': {}}
    for name, pid in PREFABS.items():
        go = f.objects.get(pid)
        if go is None:
            print('missing prefab', name); continue
        t = go.read_typetree()
        rec = {'prefab': t['m_Name'], 'lods': []}
        lg = None
        mesh_by_renderer = {}
        for c in t['m_Component']:
            co = f.objects[c['component']['m_PathID']]
            if co.type.name == 'LODGroup':
                lg = co.read_typetree()
        rec['lodSize'] = r(lg['m_Size']); rec['lodRef'] = [r(lg['m_LocalReferencePoint'][k]) for k in 'xyz']
        for lod in lg['m_LODs']:
            ro = f.objects[lod['renderers'][0]['renderer']['m_PathID']]
            rt = ro.read_typetree()
            rgo = f.objects[rt['m_GameObject']['m_PathID']].read_typetree()
            mesh = None
            for c in rgo['m_Component']:
                co = f.objects[c['component']['m_PathID']]
                if co.type.name == 'MeshFilter':
                    mesh = mesh_record(f.objects[co.read_typetree()['m_Mesh']['m_PathID']])
            mt = f.objects[rt['m_Materials'][0]['m_PathID']].read_typetree()
            sp = mt['m_SavedProperties']
            fl = {k: r(v) for k, v in sp['m_Floats']}
            cl = {k: [r(v[c]) for c in 'rgba'] for k, v in sp['m_Colors']}
            rec['lods'].append({'screenRelativeHeight': r(lod['screenRelativeHeight']), 'mesh': mesh, 'material': mt['m_Name'], 'floats': fl, 'colors': cl})
        out['prefabs'][name] = rec
    for s in range(1, 7):
        d = json.load(open(os.path.join(ROOT, f'public/assets/stages/3d_stage_{s:03d}/scene.json')))
        N = {n['i']: n for n in d['nodes']}
        par = next((n['i'] for n in d['nodes'] if n['name'] == 'Small_Props_Grass'), None)
        inst = []
        for n in d['nodes']:
            if n['name'].startswith('grass_') and not n['name'].endswith('_Settings') and n['parent'] == par:
                inst.append({'prefab': n['name'], 'pos': [r(v) for v in n['pos']], 'rot': [r(v) for v in n['rot']], 'scale': [r(v) for v in n['scale']], 'active': n['activeInHierarchy']})
        out['stages'][f'3d_stage_{s:03d}'] = inst
        print(s, len(inst))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT))


if __name__ == '__main__':
    main()
