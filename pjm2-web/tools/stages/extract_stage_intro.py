#!/usr/bin/env python3
"""Extract the STAGE INTRO RIG of a stage scene (GameCameraIntro cuts + their Animator
clips, ChibiIntro run paths) from the shipped `stages` AssetBundle (user's own copy).

Output: public/assets/data/intro/<scene>.json (Unity left-handed coordinates, unchanged).

    /srv/opencode/venv-unity/bin/python -I extract_stage_intro.py [scene=3d_stage_001_env] [--out FILE]

Evidence: see docs/STAGE_INTRO_ANALYSIS.md.  MonoBehaviours are classified through the
MonoScript tables of the bundle's *.sharedAssets files (scripts are external refs).
Camera animation: the Animator controller state's AnimationClip is a Mecanim generic clip;
its curves live in m_MuscleClip.m_Clip (StreamedClip = cubic polynomial per key frame,
ConstantClip = constants).  Only the root `position` binding is animated.
"""
import json, math, os, struct, sys
import UnityPy

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
scene = 'BuildPlayer-' + (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '3d_stage_001_env')
out = os.path.join(REPO, 'pjm2-web/public/assets/data/intro', scene.replace('BuildPlayer-', '') + '.json')
if '--out' in sys.argv:
    out = sys.argv[sys.argv.index('--out') + 1]

env = UnityPy.load(os.path.join(AB, 'stages'))
bundle = env.files[os.path.join(AB, 'stages')]
low = {n.lower(): n for n in bundle.files}
scripts = {}
for n, sf in bundle.files.items():
    if not hasattr(sf, 'objects'):
        continue
    for o in sf.objects.values():
        if o.type.name == 'MonoScript':
            scripts[(n, o.path_id)] = o.read().m_ClassName
sf = bundle.files[scene]
objs = {o.path_id: o for o in sf.objects.values()}


def ext_file(ptr):
    if ptr['m_FileID'] == 0:
        return scene
    return low.get(sf.externals[ptr['m_FileID'] - 1].path.split('/')[-1].lower())


def cls(o):
    s = o.read_typetree()['m_Script']
    return scripts.get((ext_file(s), s['m_PathID']))


def switch_params(gpid):
    """GameCameraSwitchBlackInOut serialized fade timings of a camera GameObject."""
    for cc in go[gpid]['m_Component']:
        oo = objs.get(cc['component']['m_PathID'])
        if oo is not None and oo.type.name == 'MonoBehaviour':
            try:
                if cls(oo) == 'GameCameraSwitchBlackInOut':
                    t = oo.read_typetree()
                    return {k: t[k] for k in ('switchInTime', 'switchOutTime', 'fadeInTime', 'fadeOutTime', 'fovChange', 'fovZoomSpeed')}
            except Exception:
                pass
    return None


go = {p: o.read_typetree() for p, o in objs.items() if o.type.name == 'GameObject'}
tf = {p: o.read_typetree() for p, o in objs.items() if o.type.name == 'Transform'}
go2tf = {t['m_GameObject']['m_PathID']: p for p, t in tf.items()}


def v(d, *k):
    return [d[x] for x in k]


def mat_trs(t):
    px, py, pz = v(t['m_LocalPosition'], 'x', 'y', 'z')
    qx, qy, qz, qw = v(t['m_LocalRotation'], 'x', 'y', 'z', 'w')
    sx, sy, sz = v(t['m_LocalScale'], 'x', 'y', 'z')
    r = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ]
    return [[r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, px],
            [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, py],
            [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, pz],
            [0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def world(pid):
    m = mat_trs(tf[pid])
    f = tf[pid]['m_Father']['m_PathID']
    return mul(world(f), m) if f else m


def decompose(m):
    sx = math.sqrt(sum(m[i][0] ** 2 for i in range(3)))
    sy = math.sqrt(sum(m[i][1] ** 2 for i in range(3)))
    sz = math.sqrt(sum(m[i][2] ** 2 for i in range(3)))
    r = [[m[i][j] / (sx, sy, sz)[j] for j in range(3)] for i in range(3)]
    tr = r[0][0] + r[1][1] + r[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1) * 2
        q = [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, s / 4]
    elif r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1 + r[0][0] - r[1][1] - r[2][2]) * 2
        q = [s / 4, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    elif r[1][1] > r[2][2]:
        s = math.sqrt(1 + r[1][1] - r[0][0] - r[2][2]) * 2
        q = [(r[0][1] + r[1][0]) / s, s / 4, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    else:
        s = math.sqrt(1 + r[2][2] - r[0][0] - r[1][1]) * 2
        q = [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, s / 4, (r[1][0] - r[0][1]) / s]
    return {'pos': [m[0][3], m[1][3], m[2][3]], 'rot': q, 'scale': [sx, sy, sz]}


def trs(t):
    return {'pos': v(t['m_LocalPosition'], 'x', 'y', 'z'), 'rot': v(t['m_LocalRotation'], 'x', 'y', 'z', 'w'),
            'scale': v(t['m_LocalScale'], 'x', 'y', 'z')}


def f32(u):
    return struct.unpack('<f', struct.pack('<I', u))[0]


def decode_clip(ct):
    """Mecanim generic clip -> per-curve cubic key frames (value = ((a*dt+b)*dt+c)*dt+d)."""
    c = ct['m_MuscleClip']['m_Clip']['data']
    sd = c['m_StreamedClip']['data']
    nstream = c['m_StreamedClip']['curveCount']
    ndense = c['m_DenseClip']['m_CurveCount']
    const = c['m_ConstantClip']['data']
    curves = {}
    i = 0
    while i < len(sd):
        tm = f32(sd[i]); n = sd[i + 1]; i += 2
        for _ in range(n):
            idx = sd[i]; co = [f32(x) for x in sd[i + 1:i + 5]]; i += 5
            curves.setdefault(idx, []).append({'t': None if tm < -1e30 else tm, 'a': co[0], 'b': co[1], 'c': co[2], 'd': co[3]})
    for k in curves:
        # frame 0 sentinel (-FLT_MAX) holds the initial constant value
        for key in curves[k]:
            if key['t'] is None:
                key['t'] = -1.0
    mc = ct['m_MuscleClip']
    return {
        'name': ct['m_Name'], 'sampleRate': ct['m_SampleRate'],
        'start': mc['m_StartTime'], 'stop': mc['m_StopTime'], 'loop': bool(mc['m_LoopTime']),
        'bindings': ct['m_ClipBindingConstant']['genericBindings'],
        'curveCounts': {'streamed': nstream, 'dense': ndense, 'constant': len(const)},
        'streamed': {str(k): v for k, v in sorted(curves.items())},
        'constant': const,
    }


result = {'scene': scene, 'cameras': [], 'chibiIntro': None, 'note': 'Unity LH coordinates; positions of cameras/chibiIntro are LOCAL to introRoot'}
cams = []
chibis = []
for pid, o in objs.items():
    if o.type.name != 'MonoBehaviour':
        continue
    try:
        c = cls(o)
    except Exception:
        continue
    if c not in ('GameCameraIntro', 'ChibiIntro'):
        continue
    t = o.read_typetree()
    gpid = t['m_GameObject']['m_PathID']
    (cams if c == 'GameCameraIntro' else chibis).append((gpid, t))

if not cams:
    print('no GameCameraIntro in', scene, '- nothing written')
    sys.exit(0)
root_tf = tf[go2tf[cams[0][0]]]['m_Father']['m_PathID']
result['introRoot'] = {'name': go[tf[root_tf]['m_GameObject']['m_PathID']]['m_Name'], 'world': decompose(world(root_tf)),
                       'childOrder': [go[tf[ch['m_PathID']]['m_GameObject']['m_PathID']]['m_Name'] for ch in tf[root_tf]['m_Children']]}
ctrl_file = None
for gpid, t in cams:
    g = go[gpid]
    tpid = go2tf[gpid]
    cam = anim = None
    for cc in g['m_Component']:
        p = cc['component']['m_PathID']
        oo = objs.get(p)
        if oo is None:
            continue
        if oo.type.name == 'Camera':
            cam = oo.read_typetree()
        if oo.type.name == 'Animator':
            anim = oo.read_typetree()
    ptr = anim['m_Controller']
    cf = bundle.files[ext_file(ptr)]
    cobjs = {x.path_id: x for x in cf.objects.values()}
    ctl = cobjs[ptr['m_PathID']].read_typetree()
    clip = decode_clip(cobjs[ctl['m_AnimationClips'][0]['m_PathID']].read_typetree())
    result['cameras'].append({
        'name': g['m_Name'], 'siblingIndex': [i for i, ch in enumerate(tf[root_tf]['m_Children']) if ch['m_PathID'] == tpid][0],
        'local': trs(tf[tpid]), 'fov': cam['field of view'], 'near': cam['near clip plane'], 'far': cam['far clip plane'],
        'startDelay': t['startDelay'], 'switch': switch_params(gpid), 'controller': ctl['m_Name'], 'clip': clip,
    })
result['cameras'].sort(key=lambda c: c['siblingIndex'])
for gpid, t in chibis:
    tpid = go2tf[gpid]
    result['chibiIntro'] = {
        'name': go[gpid]['m_Name'], 'local': trs(tf[tpid]), 'world': decompose(world(tpid)),
        'runDelay': t['m_chibiRunDelay'], 'jumpDelay': t['m_chibiJumpDelay'], 'faceAngleRange': t['m_chibiFaceAngleRange'],
        'panicJumpMinVel': t['PanicJumpMinVel'], 'panicJumpMaxVel': t['PanicJumpMaxVel'], 'moveSpeed': t['MoveSpeed'],
        'endFacingAngle': t['EndFacingAngle'],
        'paths': [[[p['x'], p['y'], p['z']] for p in pa['pathPoints']] for pa in t['paths']],
    }
# the follow camera the intro hands over to (CameraManager.SwitchCameraTo<GameCameraTopDown>)
for pid2, o in objs.items():
    if o.type.name == 'MonoBehaviour':
        try:
            if cls(o) == 'GameCameraTopDown':
                g2 = o.read_typetree()['m_GameObject']['m_PathID']
                result['handoffCamera'] = {'name': go[g2]['m_Name'], 'switch': switch_params(g2)}
        except Exception:
            pass
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(result, open(out, 'w'), indent=1)
print('wrote', out, [c['name'] for c in result['cameras']], result['introRoot'])
