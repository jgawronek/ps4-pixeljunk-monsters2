#!/usr/bin/env python3
"""
extract_hub_hut.py — the TITLE HUT of the hub scene (3d_stage_000: Home_GRP/home_001_title_pa/home_001_comp): a SkinnedMeshRenderer
(home_001_comp_LOD0, bones House_Bn/Curtain_*_Bn) + Animator `home_001_ctrl` (structures bundle: Empty --TitleScreenEnter--> curtain -> Empty).
The stage extractor (tools/stages) skips skinned renderers, so the hut was invisible in the port. This exports the skinned mesh as GLB
(extract_character machinery) and the `curtain` clip (raw Unity channels, same format as clips.json) to public/assets/stages/3d_stage_000/hut/.

Usage (from pjm2-web/):  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_hub_hut.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'pylibs'))
import extract_character as ec  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AB = os.path.join(ROOT, '..', 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'public', 'assets', 'stages', '3d_stage_000', 'hut')
HUT_GO_PID = 1205  # home_001_comp in BuildPlayer-3d_stage_000_env


def main():
    os.makedirs(OUT, exist_ok=True)
    b = ec.Bundle(os.path.join(AB, 'stages'), prefer_file='3d_stage_000_env')
    sb = ec.Bundle(os.path.join(AB, 'structures'))
    for pid, o in sb.idx.items():  # external refs (mesh / material / controller) live in `structures`; ids are 64-bit hashes there
        if pid not in b.idx:
            b.idx[pid] = o
    b.scripts.update({k: v for k, v in sb.scripts.items() if k not in b.scripts})
    inv = ec.component_inventory(b, HUT_GO_PID, 'hut')
    nodes = inv['nodes']
    smr = next(n for n in nodes if 'LOD0' in n['name'] and any(c['type'] == 'SkinnedMeshRenderer' for c in n['components']))
    smr_pid = next(c['path_id'] for c in smr['components'] if c['type'] == 'SkinnedMeshRenderer')
    stats = ec.export_glb(b, nodes, smr_pid, os.path.join(OUT, 'home_001_comp.glb'), generator='pjm2-web extract_hub_hut.py')
    print('glb', stats)
    mat_pids = []
    for c in smr['components']:
        if c['type'] == 'SkinnedMeshRenderer':
            for m in b.tt(c['path_id']).get('m_Materials', []):
                mp = ec.ref_pid(m)
                if mp and mp not in mat_pids:
                    mat_pids.append(mp)
    infos = ec.export_textures(b, mat_pids, os.path.join(OUT, 'textures'))
    print('textures', [(t.get('textureName'), t.get('error')) for t in infos])
    # the curtain clip lives in the structures bundle (home_001_ctrl)
    anim_node = next(n for n in nodes if any(c['type'] == 'Animator' for c in n['components']))
    crc = ec.build_crc_map(b, anim_node['path_id'], nodes)
    clips = []
    for o in sb.env.objects:
        if o.type.name == 'AnimationClip' and o.read().m_Name == 'curtain':
            clips.append(ec.decode_clip(sb, o, crc, nodes))
    json.dump({'animatorGameObject': anim_node['name'], 'controller': 'home_001_ctrl', 'clips': clips}, open(os.path.join(OUT, 'clips.json'), 'w'), indent=1, default=str)
    print('clips', [(c.get('clipName'), len(c.get('bindings', [])), c.get('error')) for c in clips])


if __name__ == '__main__':
    main()
