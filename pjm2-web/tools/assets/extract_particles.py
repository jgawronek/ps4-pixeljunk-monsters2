#!/usr/bin/env python3
"""
extract_particles.py — PixelJunk Monsters 2 (PS4, Unity 5.6.5p1) ParticleSystem extractor.

Pulls REAL Unity ParticleSystem settings out of the user's own decrypted game
bundles so the web port's effects stop being hand-tuned. Scans the `structures`
bundle (tower idle / build / scrap / chibi-death prefabs) and the `props` bundle
(projectile fire / hit / explosion prefabs — the tower_001 arrow-hit lives here),
selects up to --cap tower/combat-relevant emitters, and writes:

  public/assets/particles/particles.json     per-emitter settings records
  public/assets/particles/textures/*.png     resolved ParticleSystemRenderer _MainTex

Usage:
  /srv/opencode/venv-unity/bin/python tools/assets/extract_particles.py \
      [--cap 30] [--bundles structures props] [--out public/assets/particles]

Run from the pjm2-web project root (paths below are resolved relative to it).

--------------------------------------------------------------------------
UNITY 5.6 FIELD SEMANTICS (verified against the bundles + Unity 5.6 docs)
--------------------------------------------------------------------------
MinMaxCurve.minMaxState uses ParticleSystemCurveMode, which is NOT the naive
"0=const,1=curve,2=two-constants,3=two-curves" ordering. The real enum is:
    0 = Constant        -> value = scalar
    1 = Curve           -> value = maxCurve(t)
    2 = TwoCurves       -> random between minCurve(t) and maxCurve(t)
    3 = TwoConstants    -> random between minScalar and scalar   <-- curves EMPTY
In these bundles the start modules are almost always mode 0 or mode 3 with
EMPTY curves and populated scalar/minScalar. Mode 3 is therefore read as the
two-constant range [minScalar, scalar] (normalized so min<=max, which matters
for negative startSpeed implosions). Modes 1/2 are sampled at 8 points (cubic
Hermite using the keyframe in/outSlope, Unity's AnimationCurve.Evaluate) and the
sample min/max is recorded — a documented approximation.

MinMaxGradient.minMaxState uses ParticleSystemGradientMode:
    0 = Color           -> constant color = maxColor
    1 = Gradient        -> maxGradient
    2 = TwoColors       -> random between minColor and maxColor
    3 = TwoGradients    -> random between minGradient and maxGradient
startColor is exported as the representative rgba (maxColor for modes 0/2) plus
a randomBetween flag and the minColor when random-between.

ShapeModule.type uses the Unity 5.6 ParticleSystemShapeType enum:
    0 Sphere, 1 SphereShell, 2 Hemisphere, 3 HemisphereShell, 4 Cone, 5 Box,
    6 Mesh, 7 ConeShell, 8 ConeVolume, 9 ConeVolumeShell, 10 Circle,
    11 CircleEdge, 12 SingleSidedEdge, 13 MeshRenderer, 14 SkinnedMeshRenderer,
    15 BoxShell, 16 BoxEdge.
(Cone=4 / ConeVolume=8 / ConeVolumeShell=9 confirmed by the flame/jet/spark
prefabs carrying small angle+radius; Box=5 confirmed by non-default boxX/Y/Z.)

EmissionModule.m_Bursts entries are {time,minCount,maxCount,cycleCount,
repeatInterval} in 5.6 (newer Unity uses a count MinMaxCurve). Each burst is
exported with a representative integer count = round((minCount+maxCount)/2).

COORDINATE SPACE: values are RAW Unity (left-handed, Y-up). The web view mirrors
X at load (toThree); sizes/speeds/lifetimes are unit-agnostic and used as-is.
Gravity is gravityModifier * -9.81 (Unity Physics.gravity.y) at 1:1 world scale.

FIDELITY CAVEATS (documented, intentional):
  * curve-mode start values & size-over-lifetime are 8-point samples, not the
    exact Hermite curve evaluated per-particle.
  * color-over-lifetime is exported as gradient keys for fidelity but the static
    BurstOpts mapping only derives a fade fraction from it (additive effects fade
    via color->black, smoke via alpha->0).
  * size-over-lifetime is recorded but NOT applied to the static burst size.
  * startColor alpha is recorded but BurstOpts.color is RGB-only.
  * textures: only _MainTex that resolves to a Texture2D in-bundle is exported;
    path_id 0 (solid-color additive quads) or external refs record name + skip.
"""
import argparse
import json
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import UnityPy  # noqa: E402

DEFAULT_BUNDLE_DIR = ('/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/'
                      'CUSA11967/Media/StreamingAssets/AssetBundles')

# Unity 5.6 ParticleSystemCurveMode (see header — 2/3 are NOT the naive order).
CURVE_MODE = {0: 'constant', 1: 'curve', 2: 'twoCurves', 3: 'twoConstants'}
# Unity 5.6 ParticleSystemGradientMode.
GRADIENT_MODE = {0: 'color', 1: 'gradient', 2: 'twoColors', 3: 'twoGradients'}
# Unity 5.6 ParticleSystemShapeType.
SHAPE_TYPE = {
    0: 'sphere', 1: 'sphereShell', 2: 'hemisphere', 3: 'hemisphereShell',
    4: 'cone', 5: 'box', 6: 'mesh', 7: 'coneShell', 8: 'coneVolume',
    9: 'coneVolumeShell', 10: 'circle', 11: 'circleEdge', 12: 'singleSidedEdge',
    13: 'meshRenderer', 14: 'skinnedMeshRenderer', 15: 'boxShell', 16: 'boxEdge',
}
CURVE_SAMPLES = 8


def log(msg):
    print(f'- [{time.strftime("%H:%M:%S")}] {msg}')


def ref_pid(c):
    """PPtr dict (typetree) or PPtr object -> path_id."""
    if c is None:
        return 0
    if isinstance(c, dict):
        return c.get('path_id') or c.get('m_PathID') or 0
    return getattr(c, 'path_id', 0) or 0


def r6(x):
    return round(float(x), 6)


# --------------------------------------------------------------- curves -----

def eval_curve(keys, t):
    """Unity AnimationCurve.Evaluate: cubic Hermite between keyframes using
    outSlope/inSlope. Clamped outside the key range (m_Pre/PostInfinity=2)."""
    if not keys:
        return 0.0
    if t <= keys[0]['time']:
        return keys[0]['value']
    if t >= keys[-1]['time']:
        return keys[-1]['value']
    for i in range(len(keys) - 1):
        k0, k1 = keys[i], keys[i + 1]
        if k0['time'] <= t <= k1['time']:
            dt = k1['time'] - k0['time']
            if dt <= 0:
                return k1['value']
            u = (t - k0['time']) / dt
            m0 = k0.get('outSlope', 0.0) * dt
            m1 = k1.get('inSlope', 0.0) * dt
            u2, u3 = u * u, u * u * u
            return ((2 * u3 - 3 * u2 + 1) * k0['value']
                    + (u3 - 2 * u2 + u) * m0
                    + (-2 * u3 + 3 * u2) * k1['value']
                    + (u3 - u2) * m1)
    return keys[-1]['value']


def sample_curve(curve, n=CURVE_SAMPLES):
    keys = sorted((curve or {}).get('m_Curve') or [], key=lambda k: k['time'])
    return [r6(eval_curve(keys, i / (n - 1))) for i in range(n)]


def minmax_curve(mc):
    """MinMaxCurve -> {min,max,mode,minMaxState[,samples]}. Handles 0/3 exactly;
    samples curve modes 1/2 at 8 points (documented approximation)."""
    state = mc.get('minMaxState', 0)
    scalar = mc.get('scalar', 0.0)
    min_scalar = mc.get('minScalar', 0.0)
    mode = CURVE_MODE.get(state, f'unknown{state}')
    if state == 0:                                   # Constant
        return {'min': r6(scalar), 'max': r6(scalar), 'mode': mode, 'minMaxState': state}
    if state == 3:                                   # TwoConstants (curves empty)
        lo, hi = sorted([min_scalar, scalar])        # normalize (negative speeds)
        return {'min': r6(lo), 'max': r6(hi), 'mode': mode, 'minMaxState': state}
    if state == 1:                                   # Curve
        smax = sample_curve(mc.get('maxCurve'))
        return {'min': min(smax), 'max': max(smax), 'mode': mode,
                'minMaxState': state, 'samples': {'max': smax}}
    if state == 2:                                   # TwoCurves
        smax = sample_curve(mc.get('maxCurve'))
        smin = sample_curve(mc.get('minCurve'))
        return {'min': min(smin), 'max': max(smax), 'mode': mode,
                'minMaxState': state, 'samples': {'min': smin, 'max': smax}}
    # Unknown state: fall back to the constant so we never emit garbage.
    return {'min': r6(scalar), 'max': r6(scalar), 'mode': mode, 'minMaxState': state}


# -------------------------------------------------------------- gradients ---

def gradient_keys(g):
    """Unity gradient packing: first m_NumColorKeys keys' rgb at ctime/65535,
    first m_NumAlphaKeys keys' a at atime/65535."""
    nc = g.get('m_NumColorKeys', 0)
    na = g.get('m_NumAlphaKeys', 0)
    color = [{'time': r6(g[f'ctime{i}'] / 65535.0),
              'r': r6(g[f'key{i}']['r']), 'g': r6(g[f'key{i}']['g']),
              'b': r6(g[f'key{i}']['b'])} for i in range(nc)]
    alpha = [{'time': r6(g[f'atime{i}'] / 65535.0),
              'a': r6(g[f'key{i}']['a'])} for i in range(na)]
    return {'color': color, 'alpha': alpha}


def rgba(c):
    return {'r': r6(c['r']), 'g': r6(c['g']), 'b': r6(c['b']), 'a': r6(c['a'])}


def start_color(sc):
    """MinMaxGradient -> representative rgba + randomBetween flag (+minColor)."""
    state = sc.get('minMaxState', 0)
    mode = GRADIENT_MODE.get(state, f'unknown{state}')
    out = dict(rgba(sc['maxColor']))
    out['mode'] = mode
    out['minMaxState'] = state
    out['randomBetween'] = state in (2, 3)
    if state in (2, 3):
        out['minColor'] = rgba(sc['minColor'])
    if state in (1, 3):
        # Gradient start-color is rare; represent by the gradient's first key.
        out['note'] = 'start color is a gradient; rgba = maxGradient.key0'
        out.update({k: rgba(sc['maxGradient']['key0'])[k] for k in 'rgba'})
    return out


# ---------------------------------------------------------------- records ---

def shape_record(sm):
    tid = sm.get('type', 0)
    rec = {'type': SHAPE_TYPE.get(tid, f'unknown{tid}'), 'typeId': tid,
           'enabled': bool(sm.get('enabled', False)),
           'radius': r6(sm.get('radius', {}).get('value', 0.0)),
           'angle': r6(sm.get('angle', 0.0))}
    if tid in (5, 15, 16):                           # box family
        rec['box'] = {'x': r6(sm.get('boxX', 1)), 'y': r6(sm.get('boxY', 1)),
                      'z': r6(sm.get('boxZ', 1))}
    return rec


def emission_record(em):
    bursts = []
    for b in em.get('m_Bursts') or []:
        mn, mx = int(b.get('minCount', 0)), int(b.get('maxCount', 0))
        bursts.append({'time': r6(b.get('time', 0.0)),
                       'count': int(round((mn + mx) / 2)),
                       'minCount': mn, 'maxCount': mx,
                       'cycleCount': int(b.get('cycleCount', 1)),
                       'repeatInterval': r6(b.get('repeatInterval', 0.0))})
    return {'rate': minmax_curve(em.get('rateOverTime', {})), 'bursts': bursts}


def color_over_lifetime(cm):
    if not cm.get('enabled', False):
        return None
    g = cm.get('gradient', {})
    state = g.get('minMaxState', 1)
    return {'enabled': True, 'mode': GRADIENT_MODE.get(state, f'unknown{state}'),
            'minMaxState': state, 'gradient': gradient_keys(g.get('maxGradient', {}))}


def size_over_lifetime(sm):
    if not sm.get('enabled', False):
        return None
    curve = sm.get('curve', {})
    scalar = curve.get('scalar', 1.0)
    state = curve.get('minMaxState', 1)
    smax = [r6(v * scalar) for v in sample_curve(curve.get('maxCurve'))]
    rec = {'enabled': True, 'scalar': r6(scalar),
           'mode': CURVE_MODE.get(state, f'unknown{state}'), 'minMaxState': state,
           'samples': smax, 'min': min(smax), 'max': max(smax)}
    if state == 2:
        smin = [r6(v * scalar) for v in sample_curve(curve.get('minCurve'))]
        rec['samplesMin'] = smin
        rec['min'] = min(smin)
    return rec


def main_texture(idx, go_pid):
    """Resolve ParticleSystemRenderer material _MainTex on the GameObject.
    Returns (texture_reader|None, name|None, note)."""
    if go_pid not in idx:
        return None, None, 'gameobject not found'
    go_tt = idx[go_pid].read_typetree()
    rend_pid = None
    for c in go_tt.get('m_Component', []):
        pid = ref_pid(c.get('component'))
        if pid in idx and idx[pid].type.name == 'ParticleSystemRenderer':
            rend_pid = pid
            break
    if rend_pid is None:
        return None, None, 'no ParticleSystemRenderer'
    rt = idx[rend_pid].read_typetree()
    for m in rt.get('m_Materials') or []:
        mp = ref_pid(m)
        if mp not in idx:
            continue
        mt = idx[mp].read_typetree()
        for te in mt.get('m_SavedProperties', {}).get('m_TexEnvs', []):
            slot, props = te[0], te[1]
            if slot != '_MainTex':
                continue
            tp = ref_pid(props.get('m_Texture'))
            if tp == 0:
                return None, None, 'no _MainTex (solid-color quad)'
            if tp in idx and idx[tp].type.name == 'Texture2D':
                return idx[tp], idx[tp].read().m_Name, None
            return None, None, f'_MainTex external/unresolved (path_id {tp})'
    return None, None, 'material has no _MainTex slot'


def material_info(idx, go_pid):
    """ParticleSystemRenderer material: shader name (blend mode) + _TintColor / _Color (additive
    shaders multiply vertex colour by 2 * _TintColor). Returns None when unresolved."""
    if go_pid not in idx:
        return None
    for c in idx[go_pid].read_typetree().get('m_Component', []):
        pid = ref_pid(c.get('component'))
        if pid in idx and idx[pid].type.name == 'ParticleSystemRenderer':
            rt = idx[pid].read_typetree()
            for m in rt.get('m_Materials') or []:
                mp = ref_pid(m)
                if mp not in idx:
                    continue
                mt = idx[mp].read_typetree()
                sh = ref_pid(mt.get('m_Shader'))
                shader = None
                if sh in idx:
                    try:
                        shader = idx[sh].read_typetree().get('m_ParsedForm', {}).get('m_Name') or None
                    except Exception:
                        shader = None
                cols = {k: v for k, v in [(x[0], x[1]) for x in mt.get('m_SavedProperties', {}).get('m_Colors', [])]}
                tint = cols.get('_TintColor')
                return {'material': mt.get('m_Name'), 'shader': shader,
                        'tint': [r6(tint[k]) for k in 'rgba'] if tint else None}
    return None


def texture_sheet(um):
    """TextureSheetAnimationModule (UVModule): tiles + frame-over-time curve (value 0..1 over the lifetime, x scalar)."""
    if not um.get('enabled', False):
        return None
    fo = um.get('frameOverTime', {})
    sc = fo.get('scalar', 1.0)
    return {'enabled': True, 'tilesX': int(um.get('tilesX', 1)), 'tilesY': int(um.get('tilesY', 1)),
            'animationType': int(um.get('animationType', 0)), 'rowIndex': int(um.get('rowIndex', 0)),
            'cycles': r6(um.get('cycles', 1)), 'randomRow': bool(um.get('randomRow', False)),
            'frameOverTime': minmax_curve(fo), 'frameScalar': r6(sc),
            'startFrame': minmax_curve(um.get('startFrame', {}))}


def velocity_over_lifetime(vm):
    """VelocityModule: per-axis MinMaxCurve (8 samples), local/world space flag."""
    if not vm.get('enabled', False):
        return None
    out = {'enabled': True, 'inWorldSpace': bool(vm.get('inWorldSpace', False))}
    for ax in 'xyz':
        mc = vm.get(ax, {})
        rec = minmax_curve(mc)
        rec['scalar'] = r6(mc.get('scalar', 1.0))
        out[ax] = rec
    return out


def extract_record(idx, ps_reader, bundle_name, texture_files):
    tt = ps_reader.read_typetree()
    go_pid = ref_pid(tt.get('m_GameObject'))
    # ParticleSystem components carry no m_Name; the prefab name is on the GameObject.
    name = idx[go_pid].read().m_Name if go_pid in idx else None
    im = tt.get('InitialModule', {})
    rec = {
        'name': name,
        'bundle': bundle_name,
        'duration': r6(tt.get('lengthInSec', 0.0)),
        'looping': bool(tt.get('looping', False)),
        'maxParticles': int(im.get('maxNumParticles', 0)),
        'startLifetime': minmax_curve(im.get('startLifetime', {})),
        'startSpeed': minmax_curve(im.get('startSpeed', {})),
        'startSize': minmax_curve(im.get('startSize', {})),
        'startColor': start_color(im.get('startColor', {})),
        'gravityModifier': minmax_curve(im.get('gravityModifier', {})),
        'emission': emission_record(tt.get('EmissionModule', {})),
        'shape': shape_record(tt.get('ShapeModule', {})),
        'colorOverLifetime': color_over_lifetime(tt.get('ColorModule', {})),
        'sizeOverLifetime': size_over_lifetime(tt.get('SizeModule', {})),
        'textureSheet': texture_sheet(tt.get('UVModule', {})),
        'velocityOverLifetime': velocity_over_lifetime(tt.get('VelocityModule', {})),
    }
    rec['render'] = material_info(idx, go_pid)
    tex_reader, tex_name, note = main_texture(idx, go_pid)
    if tex_reader is not None:
        fn = f'{tex_name}.png'
        rec['texture'] = {'name': tex_name, 'file': f'textures/{fn}'}
        texture_files[tex_name] = tex_reader
    else:
        rec['texture'] = {'name': tex_name, 'file': None, 'note': note}
    return rec


# -------------------------------------------------------------- selection ---

def rank(name):
    """Priority for the ~30-emitter cap: tower_001 arrow-hit first, then build,
    chibi death, tower scrap, pickup sparkle, other combat, everything else."""
    n = name or ''
    if n.startswith('ps_tower_arrow_hit'):
        return 0
    if n.startswith('ps_tower_common_build'):
        return 1
    if n.startswith('ps_npc_chibi_die'):
        return 2
    if n.startswith('ps_tower_common_scrap'):
        return 3
    if 'pickup' in n or 'vanish_spark' in n:
        return 4
    if any(k in n for k in ('_hit', '_fire', '_explode', '_flame')):
        return 5
    return 6


def collect(bundle_dir, bundle_names):
    """Return (candidates, unity_version). candidates = [(rank,name,bundle,idx,reader)]."""
    candidates = []
    unity_version = None
    for bn in bundle_names:
        path = os.path.join(bundle_dir, bn)
        if not os.path.exists(path):
            log(f'  WARN: bundle not found: {path}')
            continue
        env = UnityPy.load(path)
        idx = {o.path_id: o for o in env.objects}
        if unity_version is None:
            for o in env.objects:
                af = getattr(o, 'assets_file', None)
                v = getattr(af, 'unity_version', None)
                if v:
                    unity_version = str(v)
                    break
        gos = {}
        for o in env.objects:
            if o.type.name == 'GameObject':
                try:
                    gos[o.path_id] = o.read().m_Name
                except Exception:
                    pass
        count = 0
        for o in env.objects:
            if o.type.name != 'ParticleSystem':
                continue
            try:
                tt = o.read_typetree()
                go_pid = ref_pid(tt.get('m_GameObject'))
                name = gos.get(go_pid) or o.read().m_Name
            except Exception as e:
                log(f'  WARN: skip unreadable ParticleSystem in {bn}: {e}')
                continue
            candidates.append((rank(name), name or '', bn, idx, o))
            count += 1
        log(f'  {bn}: {count} ParticleSystem components')
    return candidates, unity_version


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cap', type=int, default=300)  # 300 = all (projectile fire/hit effects need the ps_tower_* set)
    ap.add_argument('--bundles', nargs='+', default=['structures', 'props'])
    ap.add_argument('--bundle-dir', default=DEFAULT_BUNDLE_DIR)
    ap.add_argument('--out', default=os.path.join(PROJECT_ROOT, 'public', 'assets', 'particles'))
    args = ap.parse_args()

    t0 = time.time()
    out_dir = os.path.abspath(args.out)
    tex_dir = os.path.join(out_dir, 'textures')
    os.makedirs(tex_dir, exist_ok=True)
    log(f'extract_particles.py START bundles={args.bundles} cap={args.cap} out={out_dir}')

    candidates, unity_version = collect(args.bundle_dir, args.bundles)
    # Dedupe by name (keep first), then priority-sort and cap.
    seen = set()
    unique = []
    for c in sorted(candidates, key=lambda c: (c[0], c[1], c[2])):
        if c[1] in seen:
            continue
        seen.add(c[1])
        unique.append(c)
    selected = unique[:args.cap]
    log(f'  {len(candidates)} total, {len(unique)} unique names, selected {len(selected)}')

    texture_files = {}
    records = []
    for _, name, bn, idx, reader in selected:
        try:
            records.append(extract_record(idx, reader, bn, texture_files))
        except Exception as e:
            log(f'  WARN: failed to extract {name}: {type(e).__name__}: {e}')
    log(f'  extracted {len(records)} emitter records')

    # Export unique resolved textures.
    exported_tex = []
    for tex_name, reader in sorted(texture_files.items()):
        fn = os.path.join(tex_dir, f'{tex_name}.png')
        try:
            reader.read().image.save(fn)
            exported_tex.append(tex_name)
            # alpha-weighted mean colour of the sprite (the soft-dot renderer tints by it)
            from PIL import Image
            px = list(Image.open(fn).convert('RGBA').resize((16, 16)).getdata())
            sa = sum(q[3] for q in px) or 1
            avg = [round(sum(q[c] * q[3] for q in px) / sa / 255, 4) for c in range(3)]
            for rec in records:
                if rec['texture'].get('name') == tex_name:
                    rec['texture']['avg'] = avg
        except Exception as e:
            log(f'  WARN: texture {tex_name} export failed: {type(e).__name__}: {e}')
            for rec in records:
                if rec['texture'].get('name') == tex_name:
                    rec['texture'] = {'name': tex_name, 'file': None,
                                      'note': f'export failed: {type(e).__name__}'}
    log(f'  exported {len(exported_tex)} textures: {exported_tex}')

    doc = {
        'version': 1,
        'generatedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': {'unityVersion': unity_version, 'bundles': args.bundles,
                   'bundleDir': args.bundle_dir},
        'conventions': {
            'space': 'RAW Unity (left-handed, Y-up); web view mirrors X at load',
            'curveMode': 'ParticleSystemCurveMode: 0=constant,1=curve,2=twoCurves,3=twoConstants',
            'gradientMode': 'ParticleSystemGradientMode: 0=color,1=gradient,2=twoColors,3=twoGradients',
            'startColor': 'representative rgba = maxColor (modes 0/2); randomBetween flag + minColor',
            'curves': 'curve-mode values sampled at 8 points (cubic Hermite); min/max from samples',
            'bursts': 'count = round((minCount+maxCount)/2); minCount/maxCount preserved',
            'gravity': 'gravityModifier * -9.81 at 1:1 world scale (applied in ExtractedEmitter.ts)',
            'approximations': 'sizeOverLifetime recorded but not applied; colorOverLifetime -> fade only; startColor alpha recorded but RGB-only in BurstOpts',
        },
        'emitters': records,
    }
    json_path = os.path.join(out_dir, 'particles.json')
    with open(json_path, 'w') as f:
        json.dump(doc, f, indent=1)
    log(f'  wrote {json_path} ({os.path.getsize(json_path)} bytes)')
    log('  selected emitters:')
    for rec in records:
        tex = rec['texture'].get('file') or rec['texture'].get('note')
        log(f'    [{rec["bundle"]}] {rec["name"]}  tex={tex}')
    log(f'extract_particles.py DONE in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
