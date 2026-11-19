#!/usr/bin/env python3
"""
extract_title_rainbow.py — the title screen rainbow: `ef_ui_bg_rainbow_pv` (child of GameCameraTitle, local (0,-10.5,23.66), scale 5) ->
ParticleSystem `ps_env_rainbow` (stages bundle, 3d_stage_000 editor.sharedAssets pid 1238) with material vfx_stageselect_rainbow_m
(Particles/Alpha Blended, _TintColor 0.502) and texture vfx_stageselect_rainbow (1024x512 arc, transparent background).
Writes public/assets/stages/3d_stage_000/title/rainbow.png. The emitter numbers are in src/view/hub/TitleRainbow.ts (decoded: startDelay 2.5,
duration 0.1 looping, 1 burst/loop, lifetime 0.5, startSize 8, startColor a 0.1765, colour-over-lifetime alpha 0,1,1,0 at t 0,.3,.6,1).
Usage (from pjm2-web/):  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_title_rainbow.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'pylibs'))
import UnityPy  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
B = os.path.join(ROOT, '..', 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages')
OUT = os.path.join(ROOT, 'public/assets/stages/3d_stage_000/title')


def main():
    env = UnityPy.load(B)
    os.makedirs(OUT, exist_ok=True)
    for o in env.objects:
        if o.type.name == 'Texture2D' and o.path_id == 100 and 'editor' in o.assets_file.name:
            d = o.read()
            d.image.save(os.path.join(OUT, 'rainbow.png'))
            print('wrote rainbow.png', d.m_Width, d.m_Height)
            return
    raise SystemExit('vfx_stageselect_rainbow not found')


if __name__ == '__main__':
    main()
