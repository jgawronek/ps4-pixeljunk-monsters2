#!/usr/bin/env python3
"""Part 2: extract tower/structures + stage/wave data tables."""
import UnityPy, collections, json, os

BASE = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles'
OUT = '/srv/opencode/ps3-pixeljunk-monsters2/decomp/data'

def scripts_of(env):
    s = {}
    for o in env.objects:
        if o.type.name == 'MonoScript':
            d = o.read()
            s[o.path_id] = getattr(d, 'm_ClassName', None)
    return s

def dump_bundle(bundle, wanted=None, prefix=None):
    env = UnityPy.load(os.path.join(BASE, bundle))
    scripts = scripts_of(env)
    out = collections.defaultdict(list)
    unknown = collections.Counter()
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            d = o.read()
            pid = d.m_Script.path_id if hasattr(d.m_Script, 'path_id') else None
            cls = scripts.get(pid, '?')
            if wanted is not None and cls not in wanted:
                continue
            tree = o.read_typetree()
            tree.pop('m_GameObject', None); tree.pop('m_Script', None); tree.pop('m_Enabled', None)
            name = tree.pop('m_Name', None)
            rec = {'__class': cls, '__gameObject': name, '__path_id': o.path_id}
            rec.update(tree)
            out[cls].append(rec)
        except Exception as e:
            unknown[str(e)[:50]] += 1
    for cls, recs in out.items():
        fn = os.path.join(OUT, f'{prefix or bundle}_{cls}.json')
        json.dump(recs, open(fn, 'w'), indent=1, default=str)
        print(f'{fn}: {len(recs)} records')
    if unknown:
        print('errors:', dict(unknown))
    return out

# structures: towers, upgrades, home
dump_bundle('structures', wanted={
    'TowerBase', 'TowerUpgradeSettingGeneric', 'TowerUpgradeSettingIce',
    'TowerUpgradeSettingMotor', 'Home', 'TowerGateKeeper', 'AttackEffect',
    'TowerRangeEffectSphere', 'TowerRangeEffectCone', 'EnemyDetectorViewCone',
    'TowerEffectPlayerGaseous', 'TowerEffectPlayerTesla',
}, prefix='structures')

# stages: discover MonoBehaviour classes first (wave/spawn data)
print('\n=== stages bundle classes ===')
env = UnityPy.load(os.path.join(BASE, 'stages'))
scripts = scripts_of(env)
cls_count = collections.Counter()
for o in env.objects:
    if o.type.name == 'MonoBehaviour':
        try:
            d = o.read()
            pid = d.m_Script.path_id if hasattr(d.m_Script, 'path_id') else None
            cls_count[scripts.get(pid, '?')] += 1
        except Exception:
            pass
for c, n in cls_count.most_common(40):
    print(f'  {c}: {n}')
