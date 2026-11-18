#!/usr/bin/env python3
"""Resolve WaveResource enemy PPtrs -> enemy names -> EnemyBase stats.
Output: decomp/data/stage_waves_resolved.json (full playable wave tables)
        decomp/data/enemy_roster.json (name -> stats, from EnemyBase)
"""
import UnityPy, json, os, collections

ROOT = '/srv/opencode/ps3-pixeljunk-monsters2'
BASE = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'decomp/data')

# ---- enemies bundle: GameObject path_id -> name, and name -> EnemyBase stats ----
envE = UnityPy.load(os.path.join(BASE, 'enemies'))
go_name = {}
for o in envE.objects:
    if o.type.name == 'GameObject':
        try: go_name[o.path_id] = o.read().m_Name
        except Exception: pass

scripts = {}
for o in envE.objects:
    if o.type.name == 'MonoScript':
        scripts[o.path_id] = getattr(o.read(), 'm_ClassName', None)

def go_of_mb(d):
    try: return d.m_GameObject.read().m_Name
    except Exception: return None

roster = {}       # enemy prefab name -> merged stats
eb_by_name = {}
attr_by_name = {}
for o in envE.objects:
    if o.type.name != 'MonoBehaviour': continue
    try:
        d = o.read()
        pid = d.m_Script.path_id if hasattr(d.m_Script, 'path_id') else None
        cls = scripts.get(pid)
        go = go_of_mb(d)
        if cls == 'EnemyBase' and go:
            t = o.read_typetree()
            for k in ('m_GameObject','m_Script','m_Enabled','m_Name'): t.pop(k, None)
            eb_by_name[go] = t
        elif cls == 'EnemyAttributesSettings' and go:
            t = o.read_typetree()
            for k in ('m_GameObject','m_Script','m_Enabled','m_Name'): t.pop(k, None)
            attr_by_name.setdefault(go, []).append(t)
    except Exception:
        pass

for name, eb in eb_by_name.items():
    rec = {'name': name}
    rec.update({k: v for k, v in eb.items()
                if k in ('enemyMoveType','spawnMode','expValue','maxLife','speed',
                         'fireSpeed','balloonSpeed','maxShockSpeed','collisionScaleH',
                         'collisionScaleV','animMoveSpeed','m_freezeAnimEnable')})
    if name in attr_by_name:
        rec['attributes'] = attr_by_name[name]
    roster[name] = rec
json.dump(roster, open(os.path.join(OUT, 'enemy_roster.json'), 'w'), indent=1, default=str)
print(f'enemy roster: {len(roster)} enemies with stats (of {len(eb_by_name)} EnemyBase)')

# ---- stages bundle: WaveResource + StageMain ----
waves = json.load(open(os.path.join(OUT, 'stages_WaveResource.json')))
stages = json.load(open(os.path.join(OUT, 'stages_StageMain.json')))

def ename(ptr):
    if not isinstance(ptr, dict): return None
    pid = ptr.get('path_id') or ptr.get('m_PathID')
    return go_name.get(pid, f'UNRESOLVED_{pid}')

def conv_wave(w):
    diffs = []
    for pd in w.get('perDifficulyLists', []):
        spawns = []
        for sp in pd.get('spawnDataList', []):
            e = {k: v for k, v in sp.items() if k != 'enemyObject'}
            e['enemy'] = ename(sp.get('enemyObject'))
            spawns.append(e)
        other = {k: v for k, v in pd.items() if k != 'spawnDataList'}
        diffs.append({'spawns': spawns, 'waveParams': other})
    return diffs

resolved = []
for i, (wr, sm) in enumerate(zip(waves, stages)):
    rec = {
        'index': i,
        'stageName': sm.get('stageName'),
        'areaName': sm.get('areaName'),
        'initCoin': sm.get('m_initCoin'),
        'initGem': sm.get('m_initGem'),
        'waveCoinRate': sm.get('m_initWaveCoinRate'),
        'waveTimeRate': sm.get('m_initWaveTimeRate'),
        'waveCount': len(wr.get('waveList', [])),
        'waves': [conv_wave(w) for w in wr.get('waveList', [])],
        'bossMinions': {
            'easy':   [conv_wave(x['waveData']) for x in wr.get('waveBossMinionListEasy', [])],
            'medium': [conv_wave(x['waveData']) for x in wr.get('waveBossMinionListMedium', [])],
            'hard':   [conv_wave(x['waveData']) for x in wr.get('waveBossMinionListHard', [])],
        },
    }
    resolved.append(rec)
json.dump(resolved, open(os.path.join(OUT, 'stage_waves_resolved.json'), 'w'), indent=1, default=str)

# coverage check
unres = collections.Counter(); total = 0
for r in resolved:
    for w in r['waves']:
        for d in w:
            for s in d['spawns']:
                total += 1
                if str(s['enemy']).startswith('UNRESOLVED'): unres[s['enemy']] += 1
print(f'\nStages: {len(resolved)}  spawn entries: {total}  unresolved: {sum(unres.values())} ({len(unres)} distinct)')

# ---- readable summary of stage 1 (first level) ----
print('\n=== STAGE 1 (first level) ===')
s1 = resolved[0]
print(f"{s1['stageName']} / {s1['areaName']}  initCoin={s1['initCoin']} waves={s1['waveCount']} "
      f"coinRate={s1['waveCoinRate']} timeRate={s1['waveTimeRate']}")
for wi, w in enumerate(s1['waves']):
    d0 = w[0]  # easy difficulty
    parts = [f"{sp['enemy']}x{sp.get('enemySpawnNum')}" for sp in d0['spawns']]
    wp = d0.get('waveParams', {})
    extra = ' '.join(f'{k}={wp[k]}' for k in wp if k not in ('spawnDataList',))
    print(f"  wave {wi+1:2d}: {', '.join(parts)}   [{extra[:70]}]")
