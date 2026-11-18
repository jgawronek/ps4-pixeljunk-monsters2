#!/usr/bin/env python3
"""install_stage_sky.py <3d_stage_NNN> -- sky assets of one stage:
  sky/sky_test_003_{0..5}.webp   water `_SkyMap` cube (every shipped Nature/Water material uses sky_test_003)
  sky/<skybox cubemap>_env.webp  PMREM specular environment for stages whose RenderSettings skybox is sky_test_001/002
Names come from src/data/stageEnvironment.generated.ts (tools/data/export_stage_environment.py). Idempotent.
Needs the unity venv for the one-off cube extraction (.work/stage-multi/sky_<name>/)."""
import os, re, shutil, subprocess, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
scene = sys.argv[1]
txt = open(os.path.join(ROOT, 'src/data/stageEnvironment.generated.ts')).read()
m = re.search(r"'%s': \{.*?\"cubemap\":\"(sky_test_\d+)\"" % re.escape(scene), txt, re.S)
cube = m.group(1) if m else 'sky_test_003'
out = os.path.join(ROOT, 'public/assets/stages', scene, 'sky')
os.makedirs(out, exist_ok=True)
src1 = os.path.join(ROOT, 'public/assets/stages/3d_stage_001/sky')
for i in range(6):
    f = f'sky_test_003_{i}.webp'
    if not os.path.exists(os.path.join(out, f)):
        shutil.copy(os.path.join(src1, f), os.path.join(out, f))
if cube != 'sky_test_003':
    cache = os.path.join(ROOT, '.work/stage-multi', 'sky_' + cube[-3:])
    if not os.path.exists(os.path.join(cache, cube + '_env.webp')):
        subprocess.check_call(['/srv/opencode/venv-unity/bin/python', '-I', os.path.join(ROOT, 'tools/stages/extract_sky_cube.py'), cube, cache])
    shutil.copy(os.path.join(cache, cube + '_env.webp'), os.path.join(out, cube + '_env.webp'))
print(scene, 'sky ok', cube)
