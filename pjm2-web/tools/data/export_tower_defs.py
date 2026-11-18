#!/usr/bin/env python3
"""
export_tower_defs.py — all shipping TowerBase records -> public/assets/data/towers.json.

Source: decomp/data/structures_TowerBase.json (UnityPy dump of the `structures`
AssetBundle MonoBehaviours from the user's own copy; same record shape the
stage-1 bundle embeds for tower_001). The `tower_test_*` prefabs are dev
duplicates (Q4.TowerDatabase.GetTowerPrefabByIDString matches the name SUFFIX
"001".."012" — Q4.UI.TowerRingIconHook.ResetTowerID pads towerID with "D3" —
so only tower_001..tower_012 are reachable from the build ring).
Also records which prefabs carry a Q4.Lockable component (structures bundle:
tower_002/004/006/009) — Q4.TowerBase.IsLocked => Lockable.IsLocked() =>
!SaveData.unlockedItems.Contains(prefabName).
Usage: python3 tools/data/export_tower_defs.py
"""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, '..', 'decomp', 'data', 'structures_TowerBase.json')
LOCKABLE = {'tower_002', 'tower_004', 'tower_006', 'tower_009'}
recs = {}
for r in json.load(open(SRC)):
    n = r['__gameObject']
    if n.startswith('tower_0') and not n.startswith('tower_test'):
        r = dict(r)
        r['lockable'] = n in LOCKABLE
        recs[n] = r
out = [recs[k] for k in sorted(recs)]
os.makedirs(os.path.join(ROOT, 'public', 'assets', 'data'), exist_ok=True)
json.dump(out, open(os.path.join(ROOT, 'public', 'assets', 'data', 'towers.json'), 'w'), separators=(',', ':'))
print(len(out), [r['__gameObject'] for r in out])
