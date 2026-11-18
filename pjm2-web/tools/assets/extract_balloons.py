#!/usr/bin/env python3
"""
extract_balloons.py — the four Q4.Balloon visual prefabs (balloon_kuri / giant / spider / cisors) as character GLBs.

Balloon enemies (spawnMode Balloon) carry a child GameObject `Balloon` with Q4.Balloon + PrefabLoader whose prefabList[0]
is the skinned balloon rig (3 balloons on twines, Knot_Bn / Sucker_Bn attach bone, Animator + clips). EnemyBase.InitAnimation
@007fa210 finds it (GetComponentInChildren<Balloon>) and LateUpdate @007fe1a0 glues its `BalloonAttachBone` to the enemy's
`EnemyAttachBone` (Balloon_Be, the raised hand). Reuses extract_all_characters.process_def with a visualPid def.

Usage (from pjm2-web/):  PJM2_MANIFEST_OUT=.work/char-manifest-out.json /srv/opencode/venv-unity/bin/python -I tools/assets/extract_balloons.py
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
os.environ.setdefault('PJM2_MANIFEST_OUT', os.path.join(SCRIPT_DIR, '..', '..', '.work', 'char-manifest-out.json'))
import argparse  # noqa: E402

import extract_all_characters as eac  # noqa: E402

BALLOONS = {  # defName -> visual prefab path id in the `enemies` bundle (Q4.Balloon PrefabLoader.prefabList[0])
    'balloon_kuri': 404533518697671104,
    'balloon_giant': -6493872010782876090,
    'balloon_spider': -5244988805435991056,
    'balloon_cisors': -4367938191066502749,
}


def main():
    args = argparse.Namespace(web_size=1024, force=True, only=None, role='all', stage1=False)
    cache = eac.BundleCache()
    texstore = eac.TextureStore(args.web_size)
    for name, pid in BALLOONS.items():
        d = {'defName': name, 'role': 'enemy-part', 'bundle': 'enemies', 'baseClass': None, 'basePids': set(),
             'visualPid': pid, 'stage1': False}
        print(eac.process_def(d, cache, texstore, args).get('status'), name)


if __name__ == '__main__':
    main()
