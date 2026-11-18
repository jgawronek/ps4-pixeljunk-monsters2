#!/usr/bin/env python3
"""extract_weather.py -- Q4.StageWeatherPlayer effects (stages 4-6 sand cloud, 11 snow).

StageWeatherPlayer (serialized per stage env): weatherEffectPrefab (ParticleGroup) + playbackIntervalMin/Max.
Stage 4/5/6: prefab ef_env_sand_cloud_pv (10..60 s); stage 11: ef_env_snow_area_pv (20..60 s); stages 10 and 12
serialize a NULL prefab (no weather). Records are produced with extract_particles.extract_record (same schema as
particles.json) and written to public/assets/particles/weather.json together with the player settings.

  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_weather.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'pylibs'))
import UnityPy
import extract_particles as xp

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AB = xp.DEFAULT_BUNDLE_DIR
WANT = {'ps_env_sand_cloud': 'BuildPlayer-3d_stage_004_env.sharedAssets', 'ps_env_snow_area': 'BuildPlayer-3d_stage_011_env.sharedAssets'}


def main():
    path = os.path.join(AB, 'stages')
    bun = UnityPy.load(path).files[path]
    out = {'source': 'stages bundle StageWeatherPlayer', 'players': {}, 'emitters': []}
    for sf_name, sf in bun.files.items():
        if not (hasattr(sf, 'objects') and sf_name.startswith('BuildPlayer-3d_stage_') and sf_name.endswith('_env')):
            continue
        for o in sf.objects.values():
            if o.type.name != 'MonoBehaviour':
                continue
            try:
                tt = o.read_typetree()
                cls = o.read().m_Script.read().m_ClassName
            except Exception:
                continue
            if cls != 'StageWeatherPlayer':
                continue
            wp = tt['weatherEffectPrefab']
            out['players'].setdefault(sf_name[len('BuildPlayer-'):-4], []).append({
                'prefabFileID': wp['m_FileID'], 'prefabPathID': wp['m_PathID'],
                'intervalMin': xp.r6(tt['playbackIntervalMin']), 'intervalMax': xp.r6(tt['playbackIntervalMax'])})
    tex = {}
    for want, sf_name in WANT.items():
        sf = bun.files[sf_name]
        idx = {o.path_id: o for o in sf.objects.values()}
        for o in sf.objects.values():
            if o.type.name == 'ParticleSystem':
                tt = o.read_typetree()
                go = idx[xp.ref_pid(tt['m_GameObject'])].read_typetree()
                if go['m_Name'] == want:
                    rec = xp.extract_record(idx, o, 'stages', tex)
                    tf = idx[xp.ref_pid(go['m_Component'][0]['component'])].read_typetree()
                    rec['prefabLocal'] = {'pos': [xp.r6(tf['m_LocalPosition'][k]) for k in 'xyz'], 'rot': [xp.r6(tf['m_LocalRotation'][k]) for k in 'xyzw']}
                    out['emitters'].append(rec)
    # Prefab resolution (w3-style PPtr walk, see docs/RENDER_EXTRAS_ANALYSIS.md): stage 4/5/6 -> stages 004 sharedAssets
    # pid 2676 = ef_env_sand_cloud_pv; stage 11 -> external file 6 pid 14 = ef_env_snow_area_pv; stage 10/12: null prefab.
    out['stageEmitter'] = {f'3d_stage_{n:03d}': 'ps_env_sand_cloud' for n in (4, 5, 6)}
    out['stageEmitter']['3d_stage_011'] = 'ps_env_snow_area'
    p = os.path.join(ROOT, 'public/assets/particles/weather.json')
    json.dump(out, open(p, 'w'), indent=1)
    print('wrote', p, [e['name'] for e in out['emitters']], {k: len(v) for k, v in out['players'].items()})


if __name__ == '__main__':
    main()
