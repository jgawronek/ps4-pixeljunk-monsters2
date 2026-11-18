#!/usr/bin/env python3
"""extract_stage_select_assets.py -- stage-select sprites + stage thumbnails -> public/assets/ui/.

Complements extract_ui_sprites.py (whose SKIP regex drops stage_*_bg / guide_* / stage_photo_* art).
Source: globalsettings bundle (user's own copy, never redistributed).

 * Sprites used by the `stage_select_01` prefab (Q4.StageSelectController; hierarchy dump in
   docs/STAGE_SELECT_AND_MULTISTAGE.md): stage_sel_title_bg (883x112 area banner), stage_casual_bg /
   stage_normal_bg / stage_expert_bg (395x366/496/626 score panels, one per unlocked difficulty tier),
   guide_photo_bg (627x402 preview frame). Written to sprites/<name>.png and merged into sprites.json.
 * Stage thumbnails: AreaStageInfoMap.StageInfo.stageSprite PPtr (globalsettings fileID 0) of every shipped
   stage -> ui/stages/<scene>.webp (<=640px wide). Used in the preview frame (UIImageSwitch).
Usage: /srv/opencode/venv-unity/bin/python -I tools/assets/extract_stage_select_assets.py
"""
import json, os
import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.abspath(os.path.join(ROOT, '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/globalsettings')
OUT = os.path.join(ROOT, 'public/assets/ui')
os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'stages'), exist_ok=True)
WANT = {'stage_sel_title_bg', 'stage_casual_bg', 'stage_normal_bg', 'stage_expert_bg', 'guide_photo_bg'}

amap = json.load(open(os.path.join(REPO, 'decomp/data/globalsettings_AreaStageInfoMap.json')))[0]
thumb_ids = {}  # path_id -> scene
for a in amap['areaInfos']:
    for s in a['stageInfos']:
        if s['stageSprite']['m_PathID'] != 0:
            thumb_ids[s['stageSprite']['m_PathID']] = s['stageSceneName']

meta = json.load(open(os.path.join(OUT, 'sprites.json')))
env = UnityPy.load(AB)
for o in env.objects:
    if o.type.name != 'Sprite':
        continue
    d = o.read()
    if d.m_Name in WANT:
        img = d.image
        img.save(os.path.join(OUT, 'sprites', d.m_Name + '.png'))
        meta[d.m_Name] = {'w': img.size[0], 'h': img.size[1], 'ppu': d.m_PixelsToUnits,
                          'pivot': [d.m_Pivot.x, d.m_Pivot.y],
                          'border': [d.m_Border.x, d.m_Border.y, d.m_Border.z, d.m_Border.w]}
        print('sprite', d.m_Name, img.size)
    if o.path_id in thumb_ids:
        img = d.image
        if img.size[0] > 640:
            img = img.resize((640, round(img.size[1] * 640 / img.size[0])))
        scene = thumb_ids[o.path_id]
        img.convert('RGB').save(os.path.join(OUT, 'stages', scene + '.webp'), quality=82)
        print('thumb', scene, d.m_Name, img.size)
json.dump(meta, open(os.path.join(OUT, 'sprites.json'), 'w'), indent=1, sort_keys=True)
