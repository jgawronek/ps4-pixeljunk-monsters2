#!/usr/bin/env python3
"""Extract full game data tables from PixelJunk Monsters 2 AssetBundles.
Reads prefab MonoBehaviours (EnemyBase, EnemyAttributesSettings, tower/stage
components) and writes JSON tables to decomp/data/. Source: user's own copy.
"""
import UnityPy, collections, json, os, sys

BASE = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles'
OUT = '/srv/opencode/ps3-pixeljunk-monsters2/decomp/data'
os.makedirs(OUT, exist_ok=True)

def scripts_of(env):
    s = {}
    for o in env.objects:
        if o.type.name == 'MonoScript':
            d = o.read()
            s[o.path_id] = getattr(d, 'm_ClassName', None)
    return s

def go_name(env, mb_tree):
    """Resolve the GameObject name a MonoBehaviour is attached to."""
    ref = mb_tree.get('m_GameObject')
    if ref is None:
        return None
    pid = ref.get('path_id') if isinstance(ref, dict) else None
    if pid is None:
        return None
    try:
        go = env.objects[pid].read() if pid in env.objects else None
        return getattr(go, 'm_Name', None)
    except Exception:
        return None

def dump_bundle(bundle, wanted):
    path = os.path.join(BASE, bundle)
    if not os.path.isfile(path):
        print(f'MISSING bundle {bundle}'); return {}
    env = UnityPy.load(path)
    scripts = scripts_of(env)
    out = collections.defaultdict(list)
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            d = o.read()
            pid = d.m_Script.path_id if hasattr(d.m_Script, 'path_id') else None
            cls = scripts.get(pid, '?')
            if wanted and cls not in wanted:
                continue
            tree = o.read_typetree()
            tree.pop('m_GameObject', None); tree.pop('m_Script', None); tree.pop('m_Enabled', None)
            name = tree.pop('m_Name', None) or go_name(env, o.read_typetree())
            rec = {'__class': cls, '__gameObject': name, '__path_id': o.path_id}
            rec.update(tree)
            out[cls].append(rec)
        except Exception as e:
            print(f'  err {o.path_id}: {e}')
    return out

# ---- enemies bundle: full roster ----
data = dump_bundle('enemies', {'EnemyBase', 'EnemyAttributesSettings', 'AttackPointSetting', 'Balloon', 'EnemyDatabase'})
for cls, recs in data.items():
    fn = os.path.join(OUT, f'enemies_{cls}.json')
    json.dump(recs, open(fn, 'w'), indent=1, default=str)
    print(f'{cls}: {len(recs)} records -> {fn}')

# ---- structures bundle: tower/fruit prefabs (discover classes first) ----
env = UnityPy.load(os.path.join(BASE, 'structures'))
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
print('\nstructures bundle MonoBehaviour classes:')
for c, n in cls_count.most_common(30):
    print(f'  {c}: {n}')
