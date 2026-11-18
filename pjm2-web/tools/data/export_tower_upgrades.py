#!/usr/bin/env python3
"""export_tower_upgrades.py - decomp/data/structures_TowerUpgradeSettingGeneric.json
-> public/assets/data/tower-upgrades.json  ({ tower_NNN: [TowerUpgrade rows] }).
Rows are the serialized Q4.TowerUpgrade records (level 2..5), unmodified apart
from dropping the flagPrefab PPtr file/path ids down to flagPathId."""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
src = json.load(open(os.path.join(ROOT, 'decomp/data/structures_TowerUpgradeSettingGeneric.json')))
out = {}
for rec in src:
    rows = []
    for u in rec['upgrades']:
        r = dict(u)
        r['flagPathId'] = str(r.pop('flagPrefab')['m_PathID'])
        rows.append(r)
    out[rec['__gameObject']] = rows
dst = os.path.join(ROOT, 'pjm2-web/public/assets/data/tower-upgrades.json')
json.dump(out, open(dst, 'w'), indent=1)
print('wrote', dst, {k: len(v) for k, v in out.items()})
