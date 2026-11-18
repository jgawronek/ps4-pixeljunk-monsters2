#!/usr/bin/env python3
"""
extract_projectiles.py — PixelJunk Monsters 2 (PS4) tower PROJECTILE extractor.

Everything the web port needs to draw/move/sound every tower's projectile, read
from the user's own `props` + `structures` bundles (nothing guessed):

  public/assets/projectiles/<model>.glb + textures/   LOD0 static meshes of the
        three visible projectile models:  bullet_001 (tower_001), bullet_002
        (tower_002), tower_010_bullet_comp (tower_010 missile)
  public/assets/projectiles/manifest.json             mesh bounds + file info
  src/view/projectiles/projectileData.generated.ts    every Projectile* prefab
        (class, serialized fields, sounds/effects by NAME, PrefabLoader visuals,
        BuffSetting* components), every referenced effect prefab's child
        composition (emitter name + local TRS), and the tower -> projectile map.
  tools/assets/audio-out/sfx/* needed names are listed in the generated data
        (copy step: `--copy-sfx` copies them to public/assets/audio/sfx).

Tower -> projectile: structures TowerBase.projectile PPtr has m_FileID = 1, i.e.
the first EXTERNAL of the structures serialized file = the `props` bundle (its
dependency list: enemies, props). The MonoBehaviour pid resolves inside props.

Usage (from pjm2-web/):
  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_projectiles.py [--copy-sfx]
"""
import argparse
import json
import os
import shutil
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import UnityPy  # noqa: E402
import extract_character as ec  # noqa: E402
import extract_all_characters as eac  # noqa: E402
import extract_pickups as ep  # noqa: E402

ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
PROJECT = os.path.join(ROOT, 'pjm2-web')
BUNDLES = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(PROJECT, 'public/assets/projectiles')
TS_OUT = os.path.join(PROJECT, 'src/view/projectiles/projectileData.generated.ts')
SFX_SRC = os.path.join(SCRIPT_DIR, 'audio-out/sfx')
SFX_DST = os.path.join(PROJECT, 'public/assets/audio/sfx')
WORK = os.path.join(PROJECT, '.work/projectiles')

# visual prefab (PrefabLoader.prefabList entry) -> exported model name
MODEL_PREFABS = ['bullet_001_pa', 'bullet_002_pa', 'bullet_010_pa']
TOWERS = [f'tower_{i:03d}' for i in range(1, 13)]
SKIP_FIELDS = {'m_GameObject', 'm_Script', 'm_ObjectHideFlags', 'm_PrefabInstance', 'm_PrefabAsset',
               'm_CorrespondingSourceObject', 'm_Name', 'm_EditorHideFlags', 'm_EditorClassIdentifier',
               'm_Enabled'}


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--copy-sfx', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(os.path.dirname(TS_OUT), exist_ok=True)

    b = ec.Bundle(os.path.join(BUNDLES, 'props'))
    idx = b.idx

    def T(pid):
        return b.tt(pid)

    def cls_of(mb_pid):
        s = ec.ref_pid(T(mb_pid)['m_Script'])
        return T(s).get('m_ClassName') if s in idx else None

    def go_name(pid):
        return T(pid)['m_Name']

    def transform_of(go_pid):
        for c in T(go_pid)['m_Component']:
            cp = ec.ref_pid(c['component'])
            if idx[cp].type.name == 'Transform':
                return cp
        raise RuntimeError('no transform')

    def resolve(v):
        """PPtr -> 'Type:name' string; recurse containers."""
        if isinstance(v, dict) and set(v) == {'m_FileID', 'm_PathID'}:
            pid = v['m_PathID']
            if pid == 0:
                return None
            if pid not in idx:
                return f'ext:{v["m_FileID"]}:{pid}'
            t = idx[pid].type.name
            tt = T(pid)
            if t in ('GameObject', 'AudioClip', 'Mesh', 'Material', 'Texture2D'):
                return tt['m_Name']
            if t == 'MonoBehaviour':
                return go_name(ec.ref_pid(tt['m_GameObject']))
            return t
        if isinstance(v, dict):
            return {k: resolve(x) for k, x in v.items()}
        if isinstance(v, list):
            return [resolve(x) for x in v]
        return v

    def clean(d):
        return {k: resolve(v) for k, v in d.items() if k not in SKIP_FIELDS}

    # ---------------- projectile prefabs (root GameObjects with Projectile*) ----------------
    prefabs = {}
    effect_names = set()
    for pid, r in idx.items():
        if r.type.name != 'GameObject':
            continue
        g = T(pid)
        comps = [(cls_of(ec.ref_pid(c['component'])), ec.ref_pid(c['component']))
                 for c in g['m_Component'] if idx[ec.ref_pid(c['component'])].type.name == 'MonoBehaviour']
        proj = [(c, p) for c, p in comps if c and c.startswith('Projectile')]
        if not proj:
            continue
        tr = T(transform_of(pid))
        if ec.ref_pid(tr['m_Father']) != 0:
            continue
        cname, cpid = proj[0]
        fields = clean(T(cpid))
        extras = []
        for c, p in comps:
            if p == cpid:
                continue
            extras.append({'class': c, 'fields': clean(T(p))})
        loader = next((e for e in extras if e['class'] == 'PrefabLoader'), None)
        entry = {
            'name': g['m_Name'], 'pathId': cpid, 'class': cname,
            'fields': fields,
            'prefabList': (loader['fields']['prefabList'] if loader else []),
            'components': [e for e in extras if e['class'] != 'PrefabLoader'],
        }
        prefabs[g['m_Name']] = entry
        for k in ('fireEffect', 'hitEffect', 'flowEffect', 'affectEffect', 'beeEffect', 'groundHitEffect'):
            if fields.get(k):
                effect_names.add(fields[k])
        for e in entry['components']:
            if e['fields'].get('effect'):
                effect_names.add(e['fields']['effect'])
        for n in entry['prefabList']:
            effect_names.add(n)  # visual prefabs that are effect groups resolved below

    # ---------------- effect / visual prefab hierarchies ----------------
    by_name = {}
    for pid, r in idx.items():
        if r.type.name != 'GameObject':
            continue
        n = go_name(pid)
        tr = T(transform_of(pid))
        if ec.ref_pid(tr['m_Father']) == 0:
            by_name.setdefault(n, pid)

    def walk(pid, depth=0):
        g = T(pid)
        tr = T(transform_of(pid))
        kinds = []
        for c in g['m_Component']:
            cp = ec.ref_pid(c['component'])
            ty = idx[cp].type.name
            if ty == 'MonoBehaviour':
                kinds.append(cls_of(cp))
            elif ty != 'Transform':
                kinds.append(ty)
        node = {
            'name': g['m_Name'],
            'pos': [round(tr['m_LocalPosition'][k], 6) for k in 'xyz'],
            'rot': [round(tr['m_LocalRotation'][k], 6) for k in 'xyzw'],
            'scale': [round(tr['m_LocalScale'][k], 6) for k in 'xyz'],
            'components': kinds,
            'children': [walk(ec.ref_pid(T(ec.ref_pid(ch))['m_GameObject']), depth + 1)
                         for ch in tr['m_Children']],
        }
        return node

    effects = {}
    for n in sorted(effect_names):
        pid = by_name.get(n)
        if pid is None:
            continue
        node = walk(pid)
        if 'ParticleGroup' in node['components']:
            effects[n] = node
    log(f'{len(prefabs)} projectile prefabs, {len(effects)} effect prefabs')

    # ---------------- tower -> projectile ----------------
    sb = ec.Bundle(os.path.join(BUNDLES, 'structures'))
    tower_map = {}
    for pid, r in sb.idx.items():
        if r.type.name != 'MonoBehaviour':
            continue
        if sb.comp_class(r) != 'TowerBase':
            continue
        tt = r.read_typetree()
        gname = sb.name_of(ec.ref_pid(tt['m_GameObject']))
        if gname not in TOWERS:
            continue
        ppid = ec.ref_pid(tt['projectile'])
        if ppid == 0:
            continue
        if ppid not in idx:
            raise RuntimeError(f'{gname}: projectile pid {ppid} not in props')
        proj_go = go_name(ec.ref_pid(T(ppid)['m_GameObject']))
        # EnemyDetectorViewCone component of the tower prefab (the sim's detection volume).
        det = None
        for c in sb.tt(ec.ref_pid(tt['m_GameObject']))['m_Component']:
            cp = ec.ref_pid(c['component'])
            if sb.idx[cp].type.name == 'MonoBehaviour' and sb.comp_class(sb.idx[cp]) == 'EnemyDetectorViewCone':
                d = sb.tt(cp)
                det = {'upperRadius': d['upperRadius'], 'lowerRadius': d['lowerRadius'], 'height': d['height'],
                       'offset': [d['offset']['x'], d['offset']['y'], d['offset']['z']],
                       'affectRangeRate': d['affectRangeRate']}
        tower_map[gname] = {
            'projectile': proj_go,
            'projectilePathId': ppid,
            'attackType': tt['attackType'],
            'attackSpread': tt['attackSpread'],
            'burstCount': tt['burstCount'],
            'firePointNames': tt['firePointNames'],
            'magazineCapacity': tt['magazineCapacity'],
            'detector': det,
        }
    log(f'tower map: {json.dumps({k: v["projectile"] for k, v in sorted(tower_map.items())})}')

    # ---------------- GLBs ----------------
    # props prefabs reference meshes/materials/textures that live in the dependency
    # bundle `structures` (tower_002_m, tower_010_bullet_comp_LOD0, ...): merged view.
    import copy
    mb = copy.copy(b)
    mb.idx = {**sb.idx, **b.idx}
    texstore = None
    ep.OUT = OUT
    ep.WORK = WORK
    class SlimStore(ep.PickupTextureStore):
        """Only the slots the glTF binds (baseColor/occlusion/emission); the 4 MB
        metal/normal maps are manifest-only in the character pipeline anyway."""
        def export(self, bb, bundle_name, tpid, slot, mat_name):
            if slot not in ('_MainTex', '_OcclusionMap', '_EmissionMap'):
                return {'error': 'slot not bound (character pipeline policy)'}
            return super().export(bb, bundle_name, tpid, slot, mat_name)
    texstore = SlimStore()
    models = {}
    for vname in MODEL_PREFABS:
        vpid = by_name[vname]
        inv = ec.component_inventory(mb, vpid, 'visual')
        nodes = inv['nodes']
        rend = []
        want_lod0 = any('LOD0' in n['name'] for n in nodes)
        for n in nodes:
            if want_lod0 and 'LOD0' not in n['name']:
                continue
            mf = next((c for c in n['components'] if c['type'] == 'MeshFilter'), None)
            mr = next((c for c in n['components'] if c['type'] == 'MeshRenderer'), None)
            if mf and mr:
                rend.append({'kind': 'static', 'pid': mf['path_id'], 'node': n['name'],
                             'rendererPid': mr['path_id']})
                break
        if not rend:
            raise RuntimeError(f'{vname}: no static mesh')
        mat_pids = []
        for m in mb.tt(rend[0]['rendererPid']).get('m_Materials', []):
            mp = ec.ref_pid(m)
            if mp and mp not in mat_pids:
                mat_pids.append(mp)
        w = eac.WebWriter()
        # Materials may live in a dependency bundle (tower_002_m is in `structures`).
        mat_index = {}
        for mp in mat_pids:
            mat_index.update(ep.build_pickup_materials(mb, 'props+structures', [mp], texstore, w))
        stats, _ = eac.export_character_glb(mb, 'props', nodes, rend, mat_index, w,
                                            generator='pjm2-web extract_projectiles.py')
        data, _j = w.finish([0], generator='pjm2-web extract_projectiles.py')
        mname = rend[0]['node'].replace('_LOD0', '')
        glb = os.path.join(OUT, f'{vname[:-3]}.glb')
        with open(glb, 'wb') as f:
            f.write(data)
        mesh_pid = ec.ref_pid(mb.tt(rend[0]['pid']).get('m_Mesh'))
        bounds = ep.mesh_bounds(mb, mesh_pid)
        models[vname] = {'file': f'{vname[:-3]}.glb', 'node': rend[0]['node'], 'bounds': bounds,
                         'vertexCount': bounds['vertexCount'], 'glbBytes': os.path.getsize(glb)}
        log(f'  {vname}: {models[vname]["glbBytes"]} bytes, size={bounds["size"]}')
    texstore.write_sentinel()
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({'generatedBy': 'tools/assets/extract_projectiles.py',
                   'coordinateConvention': 'glTF outputs mirrored Unity->glTF (X negated); same as pickups',
                   'models': models}, f, indent=1)

    # ---------------- generated TS ----------------
    sfx = set()
    for p in prefabs.values():
        for k in ('fireSound', 'hitSound', 'flyingSound', 'hitGroundSound', 'beeSpotTargetSound', 'beeFlyingSound'):
            v = p['fields'].get(k)
            if isinstance(v, str) and not v.startswith('ext:'):
                sfx.add(v)
    doc = {'projectiles': prefabs, 'effects': effects, 'towers': tower_map, 'models': models,
           'sfx': sorted(sfx)}
    with open(TS_OUT, 'w') as f:
        f.write('// GENERATED by tools/assets/extract_projectiles.py — DO NOT EDIT.\n'
                '// Source: `props` bundle (Projectile* prefabs, effect prefabs) + `structures` TowerBase.projectile.\n'
                '// See docs/PROJECTILE_ANALYSIS.md.\n\n'
                "import type { ProjectileData } from './projectileTypes';\n\n"
                'export const PROJECTILE_DATA: ProjectileData = ')
        json.dump(doc, f, indent=1)
        f.write(' as unknown as ProjectileData;\n')
    log(f'wrote {TS_OUT}')

    if args.copy_sfx:
        os.makedirs(SFX_DST, exist_ok=True)
        for n in sorted(sfx):
            src = os.path.join(SFX_SRC, n + '.wav')
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(SFX_DST, n + '.wav'))
            else:
                log(f'  WARN sfx missing: {n}')
        log(f'copied {len(sfx)} sfx')


if __name__ == '__main__':
    main()
