#!/usr/bin/env python3
"""export_stage_environment.py -- per-stage environment values from the shipped `stages` AssetBundle.

For every 3d_stage_NNN_env (1..15) reads (UnityPy, read-only):
  * RenderSettings: ambient probe (27 SH), intensity/mode, fog, skybox material + its cubemap/texture names
  * the gameplay camera (the Camera whose GameObject carries GameCameraTopDown): fov, clear colour, near/far,
    world position/rotation, GameCameraTopDown params
  * PostProcessingBehaviour profile used by that camera (Unity PostProcessing Stack v1 'topdown_pp'): colorGrading,
    vignette, ambient occlusion, bloom, antialiasing, fog flags (PPtr resolved across *.sharedAssets externals)
  * Light shadow settings (Light.m_Shadows) per light name
Writes .work/stage-multi/stage_env_raw.json and src/data/stageEnvironment.generated.ts.
Usage: /srv/opencode/venv-unity/bin/python -I tools/data/export_stage_environment.py
"""
import json, os, math, re
import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.abspath(os.path.join(ROOT, '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages')
SCRIPT_CACHE = {}


def rnd(v):
    if isinstance(v, float):
        return float(f'{v:.9g}')
    if isinstance(v, list):
        return [rnd(x) for x in v]
    if isinstance(v, dict):
        return {k: rnd(x) for k, x in v.items()}
    return v


def resolve(bun, sf, ref):
    fid, pid = ref['m_FileID'], ref['m_PathID']
    if pid == 0:
        return None, None
    if fid == 0:
        return sf, sf.objects.get(pid)
    base = sf.externals[fid - 1].path.split('/')[-1].lower()
    tgt = next((f for n, f in bun.files.items() if n.lower().endswith(base) and hasattr(f, 'objects')), None)
    return tgt, (tgt.objects.get(pid) if tgt else None)


def script_name(bun, sf, o):
    try:
        tt = o.read_typetree()
        s, so = resolve(bun, sf, tt['m_Script'])
        return so.read().m_ClassName if so else '?', tt
    except Exception:
        return '?', None


def v3(d):
    return [d['x'], d['y'], d['z']]


def col(d):
    return [d['r'], d['g'], d['b']]


def curve(c):
    return [{'time': k['time'], 'value': k['value'], 'inSlope': k['inSlope'], 'outSlope': k['outSlope']} for k in c['curve']['m_Curve']]


def world_tr(trs, go_tr, go_pid):
    """compose world pos/rot (Unity LH) through father chain."""
    chain = []
    pid = go_tr[go_pid]
    while pid:
        t = trs[pid]
        chain.append(t)
        f = t['m_Father']['m_PathID']
        pid = f if f else 0
    chain.reverse()
    pos = [0.0, 0.0, 0.0]; rot = [0.0, 0.0, 0.0, 1.0]; scl = [1.0, 1.0, 1.0]

    def qmul(a, b):
        ax, ay, az, aw = a; bx, by, bz, bw = b
        return [aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz]

    def qrot(q, v):
        x, y, z, w = q
        u = [x, y, z]
        c1 = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        t = [2*c for c in c1]
        c2 = [u[1]*t[2]-u[2]*t[1], u[2]*t[0]-u[0]*t[2], u[0]*t[1]-u[1]*t[0]]
        return [v[i] + w*t[i] + c2[i] for i in range(3)]
    for t in chain:
        lp = t['m_LocalPosition']; lr = t['m_LocalRotation']; ls = t['m_LocalScale']
        p = qrot(rot, [lp['x']*scl[0], lp['y']*scl[1], lp['z']*scl[2]])
        pos = [pos[i] + p[i] for i in range(3)]
        rot = qmul(rot, [lr['x'], lr['y'], lr['z'], lr['w']])
        scl = [scl[0]*ls['x'], scl[1]*ls['y'], scl[2]*ls['z']]
    return pos, rot


def grade_from_profile(tt):
    cg = tt['colorGrading']['m_Settings']
    wh = cg['colorWheels']
    cu = cg['curves']
    return {
        'name': tt['m_Name'],
        'enabled': {k: int(tt[k]['m_Enabled']) for k in ('colorGrading', 'vignette', 'ambientOcclusion', 'bloom', 'antialiasing', 'fog', 'eyeAdaptation', 'depthOfField', 'motionBlur', 'screenSpaceReflection', 'userLut', 'chromaticAberration', 'grain', 'dithering') if k in tt},
        'tonemapper': cg['tonemapping']['tonemapper'],
        'neutral': {k: v for k, v in cg['tonemapping'].items() if k != 'tonemapper'},
        'postExposure': cg['basic']['postExposure'], 'temperature': cg['basic']['temperature'], 'tint': cg['basic']['tint'],
        'hueShift': cg['basic']['hueShift'], 'saturation': cg['basic']['saturation'], 'contrast': cg['basic']['contrast'],
        'channelMixer': {k: v3(cg['channelMixer'][k]) for k in ('red', 'green', 'blue')},
        'wheelMode': wh['mode'],
        'logWheels': {k: col(wh['log'][k]) for k in ('slope', 'power', 'offset')},
        'linearWheels': {k: [wh['linear'][k]['r'], wh['linear'][k]['g'], wh['linear'][k]['b']] for k in ('lift', 'gamma', 'gain')},
        'curves': {k: curve(cu[k]) for k in ('master', 'red', 'green', 'blue')},
        'hueSatCurves': {k: curve(cu[k]) for k in ('hueVShue', 'hueVSsat', 'satVSsat', 'lumVSsat')},
        'vignette': {k: (col(v) if k == 'color' else ([v['x'], v['y']] if k == 'center' else v)) for k, v in tt['vignette']['m_Settings'].items() if k not in ('mask',)},
        'ambientOcclusion': tt['ambientOcclusion']['m_Settings'],
        'bloom': tt['bloom']['m_Settings']['bloom'],
        'fxaaPreset': tt['antialiasing']['m_Settings']['fxaaSettings']['preset'],
    }


def main():
    bun = UnityPy.load(AB).files[AB]
    out = {}
    for n in range(0, 16):  # 0 = the hub / world-map scene 3d_stage_000 (no StageMain, no music)
        scene = f'3d_stage_{n:03d}'
        sf = bun.files.get(f'BuildPlayer-{scene}_env')
        if sf is None:
            continue
        print('scene', scene, flush=True)
        by_type = {}
        for pid, o in sf.objects.items():
            by_type.setdefault(o.type.name, []).append(o)
        trs = {o.path_id: o.read_typetree() for o in by_type.get('Transform', [])}
        go_tr = {t['m_GameObject']['m_PathID']: pid for pid, t in trs.items()}
        gos = {o.path_id: o.read_typetree()['m_Name'] for o in by_type.get('GameObject', [])}
        rs = by_type['RenderSettings'][0].read_typetree()
        probe = [rs['m_AmbientProbe'][f'sh[{i:2d}]'] for i in range(27)]
        env = {'scene': scene, 'stageMain': {'m_initCoin': 0, 'm_initGem': 0, 'm_initWaveCoinRate': 0.0, 'm_initWaveTimeRate': 0.0, 'stageName': '', 'areaName': ''}}
        # skybox material
        sky = {'materialRef': rs['m_SkyboxMaterial'], 'texEnvs': {}, 'shader': None, 'materialName': None}
        msf, mo = resolve(bun, sf, rs['m_SkyboxMaterial'])
        if mo is not None:
            mt = mo.read_typetree()
            sky['materialName'] = mt.get('m_Name')
            for k, v in mt['m_SavedProperties']['m_TexEnvs']:
                _, to = resolve(bun, msf, v['m_Texture'])
                if to is not None:
                    sky['texEnvs'][k] = to.read().m_Name
            sky['colors'] = {k: col(v) for k, v in mt['m_SavedProperties']['m_Colors']}
            sky['floats'] = {k: v for k, v in mt['m_SavedProperties']['m_Floats']}
        env['renderSettings'] = {
            'ambientProbe': probe, 'ambientIntensity': rs['m_AmbientIntensity'], 'ambientMode': rs['m_AmbientMode'],
            'ambientSky': col(rs['m_AmbientSkyColor']), 'ambientEquator': col(rs['m_AmbientEquatorColor']), 'ambientGround': col(rs['m_AmbientGroundColor']),
            'fog': bool(rs['m_Fog']), 'fogColor': col(rs['m_FogColor']), 'fogMode': rs['m_FogMode'], 'fogDensity': rs['m_FogDensity'],
            'fogStart': rs['m_LinearFogStart'], 'fogEnd': rs['m_LinearFogEnd'],
            'reflectionIntensity': rs['m_ReflectionIntensity'], 'defaultReflectionMode': rs['m_DefaultReflectionMode'],
            'indirectSpecular': col(rs['m_IndirectSpecularColor']), 'skybox': sky,
        }
        # gameplay camera = Camera on the GameObject that has GameCameraTopDown
        topdown_go = None; topdown = None; cam_scripts = {}
        pp_by_go = {}
        for o in by_type.get('MonoBehaviour', []):
            cls, tt = script_name(bun, sf, o)
            if tt is None:
                continue
            go = tt['m_GameObject']['m_PathID']
            if cls == 'GameCameraTopDown' and topdown is None:
                topdown_go, topdown = go, tt
            elif cls == 'PostProcessingBehaviour':
                pp_by_go[go] = tt
            elif cls == 'StageMain':
                env['stageMain'] = {k: tt[k] for k in ('m_initCoin', 'm_initGem', 'm_initWaveCoinRate', 'm_initWaveTimeRate', 'stageName', 'areaName')}
        cam = None
        for o in by_type.get('Camera', []):
            c = o.read_typetree()
            if c['m_GameObject']['m_PathID'] == topdown_go:
                cam = c
        pos, rot = world_tr(trs, go_tr, topdown_go)
        env['camera'] = {
            'gameObject': gos.get(topdown_go), 'fov': cam['field of view'], 'near': cam['near clip plane'], 'far': cam['far clip plane'],
            'clearFlags': cam['m_ClearFlags'], 'clearColor': col(cam['m_BackGroundColor']), 'hdr': bool(cam['m_HDR']),
            'renderingPath': cam['m_RenderingPath'], 'pos': pos, 'rot': rot,
            'topDown': {k: (v3(v) if isinstance(v, dict) and 'z' in v else ([v['x'], v['y']] if isinstance(v, dict) else v)) for k, v in topdown.items()
                        if k not in ('m_GameObject', 'm_Enabled', 'm_Script', 'm_Name', 'controller')},
        }
        pp = pp_by_go.get(topdown_go)
        psf, po = resolve(bun, sf, pp['profile'])
        env['postProcess'] = grade_from_profile(po.read_typetree())
        env['postProcess']['profileSource'] = psf.name if hasattr(psf, 'name') else None
        # lights + shadows
        lights = []
        for o in by_type.get('Light', []):
            L = o.read_typetree()
            lights.append({'name': gos.get(L['m_GameObject']['m_PathID']), 'type': L['m_Type'], 'color': col(L['m_Color']), 'intensity': L['m_Intensity'],
                           'range': L['m_Range'], 'shadowType': L['m_Shadows']['m_Type'], 'shadowStrength': L['m_Shadows']['m_Strength'],
                           'shadowBias': L['m_Shadows']['m_Bias'], 'shadowNormalBias': L['m_Shadows']['m_NormalBias'], 'shadowNear': L['m_Shadows']['m_NearPlane'],
                           'enabled': bool(L['m_Enabled']), 'cullingMask': L['m_CullingMask']['m_Bits']})
        env['lights'] = lights
        qs = None
        out[scene] = rnd(env)
    os.makedirs(os.path.join(ROOT, '.work/stage-multi'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, '.work/stage-multi/stage_env_raw.json'), 'w'), indent=1)
    print('wrote raw json')
    write_ts(out)


def derived_camera(c):
    x, y, z, w = c['rot']
    fx = 2 * (x * z + w * y); fy = 2 * (y * z - w * x); fz = 1 - 2 * (x * x + y * y)
    pitch = math.degrees(math.asin(max(-1, min(1, -fy))))
    # three-space boom azimuth (see StageCamera.yawDeg): camera offset = -forward, x mirrored
    yaw = math.degrees(math.atan2(fx, -fz))
    return round(pitch, 4), round(yaw, 4)


def write_ts(out):
    music = {}
    txt = open(os.path.join(ROOT, 'src/data/stageMusic.generated.ts')).read()

    for m in re.finditer(r"'(3d_stage_\d+)': \{ stageMusic: ('[^']*'|null), bossMusic: ('[^']*'|null) \}", txt):
        music[m.group(1)] = tuple(None if g == 'null' else g.strip("'") for g in (m.group(2), m.group(3)))
    rows = []
    for scene, e in out.items():
        r = e['renderSettings']; c = e['camera']; p = e['postProcess']
        pitch, yaw = derived_camera(c)
        hexc = '0x%02x%02x%02x' % tuple(int(round(v * 255)) for v in c['clearColor'])
        td = c['topDown']
        # all sibling arrays are formatted by json.dumps (valid TS literals)
        data = {
            'scene': scene,
            'ambient': {'sh': r['ambientProbe'], 'intensity': r['ambientIntensity'], 'mode': r['ambientMode']},
            'fog': {'enabled': r['fog'], 'color': r['fogColor'], 'mode': r['fogMode'], 'density': r['fogDensity'], 'start': r['fogStart'], 'end': r['fogEnd']},
            'skybox': {'material': r['skybox']['materialName'], 'cubemap': next(iter(r['skybox']['texEnvs'].values()), None), 'rotation': r['skybox'].get('floats', {}).get('_Rotation', 0), 'exposure': r['skybox'].get('floats', {}).get('_Exposure', 1), 'tint': r['skybox'].get('colors', {}).get('_Tint', [0.5, 0.5, 0.5])},
            'camera': {'gameObject': c['gameObject'], 'fov': c['fov'], 'near': c['near'], 'far': c['far'], 'clearColor': c['clearColor'], 'clearHex': 'HEX', 'pitchDeg': pitch, 'yawDeg': yaw, 'topDown': td},
            'post': {
                'profile': p['name'], 'profileSource': p['profileSource'], 'tonemapper': p['tonemapper'], 'enabled': p['enabled'],
                'grade': {k: p[k] for k in ('postExposure', 'temperature', 'tint', 'hueShift', 'saturation', 'contrast', 'channelMixer', 'logWheels', 'curves', 'vignette')},
                'bloom': p['bloom'], 'ambientOcclusion': p['ambientOcclusion'], 'fxaaPreset': p['fxaaPreset'],
            },
            'lights': [{k: l[k] for k in ('name', 'type', 'color', 'intensity', 'range', 'shadowType', 'shadowStrength', 'shadowBias', 'shadowNormalBias', 'shadowNear')} for l in e['lights']],
            'stageMain': e['stageMain'],
            'music': {'stage': music.get(scene, (None, None))[0], 'boss': music.get(scene, (None, None))[1]},
        }
        body = json.dumps(data, separators=(',', ':'))
        body = body.replace('"HEX"', hexc)
        rows.append("  '%s': %s," % (scene, body.replace('\n', '\n  ')))
    open(os.path.join(ROOT, 'src/data/stageEnvironment.generated.ts'), 'w').write(
        '// GENERATED by tools/data/export_stage_environment.py -- do not edit.\n'
        '// Per-stage environment read from the shipped stages bundle (RenderSettings, gameplay Camera + GameCameraTopDown,\n'
        '// the camera\'s PostProcessing profile, Light shadow settings, StageMain). See docs/ALL_STAGES_STATUS.md.\n'
        'export interface StageEnvData {\n'
        '  scene: string;\n'
        '  ambient: { sh: number[]; intensity: number; mode: number };\n'
        '  fog: { enabled: boolean; color: number[]; mode: number; density: number; start: number; end: number };\n'
        '  skybox: { material: string | null; cubemap: string | null; rotation: number; exposure: number; tint: number[] };\n'
        '  camera: { gameObject: string | null; fov: number; near: number; far: number; clearColor: number[]; clearHex: number; pitchDeg: number; yawDeg: number; topDown: Record<string, number | number[]> };\n'
        '  post: {\n'
        '    profile: string; profileSource: string | null; tonemapper: number; enabled: Record<string, number>;\n'
        '    grade: {\n'
        '      postExposure: number; temperature: number; tint: number; hueShift: number; saturation: number; contrast: number;\n'
        '      channelMixer: { red: number[]; green: number[]; blue: number[] };\n'
        '      logWheels: { slope: number[]; power: number[]; offset: number[] };\n'
        '      curves: Record<\'master\' | \'red\' | \'green\' | \'blue\', { time: number; value: number; inSlope: number; outSlope: number }[]>;\n'
        '      vignette: { intensity: number; smoothness: number; roundness: number; rounded: number; color: number[]; center: number[]; mode: number; opacity: number };\n'
        '    };\n'
        '    bloom: { intensity: number; threshold: number; softKnee: number; radius: number; antiFlicker: number };\n'
        '    ambientOcclusion: Record<string, number>;\n'
        '    fxaaPreset: number;\n'
        '  };\n'
        '  lights: { name: string; type: number; color: number[]; intensity: number; range: number; shadowType: number; shadowStrength: number; shadowBias: number; shadowNormalBias: number; shadowNear: number }[];\n'
        '  stageMain: { m_initCoin: number; m_initGem: number; m_initWaveCoinRate: number; m_initWaveTimeRate: number; stageName: string; areaName: string };\n'
        '  music: { stage: string | null; boss: string | null };\n'
        '}\n\n'
        'export const STAGE_ENV_DATA: Readonly<Record<string, StageEnvData>> = {\n' + '\n'.join(rows) + '\n};\n')
    print('wrote stageEnvironment.generated.ts')


if __name__ == '__main__':
    main()
