#!/usr/bin/env python3
"""Compare renderer-bearing nodes in each visual prefab (components.json) with the
mesh nodes actually exported into each GLB. Reports dropped non-LOD(>0) renderers.
Run: python3 audit_dropped_renderers.py   (stdlib only)"""
import json, os, struct, glob, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W = os.path.join(ROOT, '.work/asset-scale'); O = os.path.join(ROOT, 'public/assets/characters')
bad = 0; n = 0
for cj in sorted(glob.glob(W + '/*/components.json')):
    d = os.path.basename(os.path.dirname(cj))
    g = os.path.join(O, d, d + '.glb')
    if not os.path.exists(g): continue
    comp = json.load(open(cj))
    nodes = comp['visualPrefab']['nodes']
    want = [x['name'] for x in nodes
            if any(c['type'] in ('SkinnedMeshRenderer', 'MeshRenderer') for c in x['components'])
            and not re.search(r'_LOD[1-9]\d*$', x['name'])]
    # bones that exist in the player skeleton but have no mesh are not renderers; ignore
    b = open(g, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + l])
    have = [x['name'] for x in j['nodes'] if 'mesh' in x]
    n += 1
    missing = [w for w in want if w not in have and not any(h.startswith(w) for h in have)]
    if missing or len(have) < len(want):
        bad += 1; print('DROPPED', d, 'prefab renderers', want, 'glb mesh nodes', have)
print(f'{n} characters audited, {bad} with dropped renderers')
