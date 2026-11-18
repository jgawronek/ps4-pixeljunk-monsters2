#!/usr/bin/env python3
"""
extract_enemy_view_data.py — Q4.EnemyBase VIEW data + enemy Animator controllers, written as a
generated TS module (src/view/characters/enemyViewData.generated.ts) plus the NewHealthBar
configuration (globalsettings bundle).

Source of truth: `enemies` AssetBundle (EnemyBase MonoBehaviours on each enemy logic prefab,
AnimatorController of the visual prefab named by PrefabLoader.prefabList) and the
`globalsettings` bundle (Q4.NewHealthBar prefab). Nothing is guessed.

Usage (from pjm2-web/):  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_enemy_view_data.py
"""
import json
import os
import sys

import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
AB = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'src', 'view', 'characters', 'enemyViewData.generated.ts')
PARAM_TYPE = {1: 'float', 3: 'int', 4: 'bool', 9: 'trigger'}
BLEND_NAMES = {0: '1d', 1: '2dSimpleDirectional', 2: '2dFreeformDirectional', 3: '2dFreeformCartesian', 4: 'direct'}

ENEMY_FIELDS = [
    'enemyMoveType', 'maxLife', 'speed', 'enableAnimMoveSpeedScaling', 'animMoveSpeed',
    'randomWalkAnimIntervalMin', 'randomWalkAnimIntervalMax', 'm_freezeAnimEnable', 'm_freezeAnimInterval',
    'm_freezeAnimSpeed', 'offsetHpGauge', 'groundOffsetY', 'DestroyDelay', 'StrongDeathSpeedH',
    'StrongDeathSpeedV', 'WeakDeathSpeedH', 'WeakDeathSpeedV', 'StrongDeathBounce', 'StrongDeathFriction',
    'IsCrumbleDeath', 'DrownDepth', 'AttackType', 'AttackDestroySelfDur', 'm_bossType',
    'm_healthBarSettings', 'm_topDownLifeGaugeOffset', 'm_behindLifeGaugeOffset', 'm_isIgnoreCriticalIcon',
    # hit-shock spring (UpdateHitShock @007fbe30 / OnEnemyHit @007fe710)
    'maxShockSpeed', 'additionShockRate', 'shockCurveInfos', 'shockScale', 'shockSpring', 'shockDamping',
    'm_TrampolineSpeed',
    # attack choreography (OnEnemyAttack @007ffdc0, StateJump/GroundAttack)
    'AttackRange', 'AttackDstHeightOffset', 'AttackDelay', 'spawnMode', 'targetOffset', 'collisionScaleV',
    # balloons
    'BalloonSpawnHeight', 'BalloonHeight', 'BalloonAccScale', 'BalloonDamping', 'BalloonTargetHeight',
    # boss
    'm_bossSinkSpeed', 'm_bossSinkShake', 'm_isJumpingBoss', 'm_bossJumpDur', 'm_bossRestDur', 'm_bossJumpUpSpeed',
    'm_attackFreq', 'm_bossAttackDur', 'm_bossAttackDist', 'm_bossAttackHeightForward', 'm_bossAttackHeightBack',
    'm_lowHpThreshold', 'm_lowHpSpeed', 'm_damagedHpThreshold', 'm_bossStrongDamageAnimDownDur',
    'm_bossStrongDamageAnimUpDur', 'm_bossSpawnWaitDur', 'BombAttenuationCenter', 'BombAttenuationOutside',
]


def U(x):
    return x['data'] if isinstance(x, dict) and list(x.keys()) == ['data'] else x


def main():
    env = UnityPy.load(os.path.join(AB, 'enemies'))
    objs = {o.path_id: o for o in env.objects}
    tt = {}

    def T(pid):
        if pid not in tt:
            tt[pid] = objs[pid].read_typetree()
        return tt[pid]

    go_name = {p: T(p)['m_Name'] for p, o in objs.items() if o.type.name == 'GameObject'}

    def comps(g):
        return [(objs[c['component']['m_PathID']].type.name, c['component']['m_PathID']) for c in T(g)['m_Component']]

    def script_class(m):
        s = T(m)['m_Script']['m_PathID']
        return T(s).get('m_ClassName') if s in objs else None

    def walk(tr, out):
        t = T(tr)
        out.append(t['m_GameObject']['m_PathID'])
        for ch in t['m_Children']:
            walk(ch['m_PathID'], out)

    def controller_json(cpid):
        t = T(cpid)
        tos = {h: n for h, n in t['m_TOS']}
        ctl = t['m_Controller']
        clips = [T(c['m_PathID'])['m_Name'] for c in t['m_AnimationClips']]
        vals = U(ctl['m_Values'])['m_ValueArray']
        defaults = U(ctl['m_DefaultValues'])
        params = [{'name': tos.get(U(v)['m_ID']), 'type': PARAM_TYPE[U(v)['m_Type']]} for v in vals]

        def trans_json(tc):
            tc = U(tc)
            return {
                # >= 30000: index (dest-30000) into the layer's `selectors` (sub-state-machine entry/exit nodes).
                'dest': tc['m_DestinationState'],
                'conds': [{'param': tos.get(U(cc)['m_EventID']), 'mode': U(cc)['m_ConditionMode'],
                           'threshold': U(cc)['m_EventThreshold']} for cc in tc['m_ConditionConstantArray']],
                'exit': bool(tc['m_HasExitTime']), 'exitTime': tc['m_ExitTime'],
                'duration': tc['m_TransitionDuration'], 'offset': tc['m_TransitionOffset'],
                'fixed': bool(tc['m_HasFixedDuration']), 'canSelf': bool(tc['m_CanTransitionToSelf']),
                'interrupt': tc['m_InterruptionSource'], 'ordered': bool(tc['m_OrderedInterruption']),
            }

        def tree_json(bt):
            nodes = [U(n) for n in U(bt)['m_NodeArray']]

            def node(i):
                n = nodes[i]
                r = {'type': BLEND_NAMES.get(n['m_BlendType'], n['m_BlendType'])}
                if n['m_ClipID'] is not None and not n['m_ChildIndices']:
                    r['clip'] = clips[n['m_ClipID']] if n['m_ClipID'] < len(clips) else None
                    r['cycleOffset'] = n['m_CycleOffset']
                else:
                    r['param'] = tos.get(n['m_BlendEventID']) if n['m_BlendEventID'] != 4294967295 else None
                    th = U(n['m_Blend1dData'])['m_ChildThresholdArray']
                    r['children'] = [{'threshold': (th[k] if k < len(th) else None), 'node': node(c)}
                                     for k, c in enumerate(n['m_ChildIndices'])]
                return r
            return node(0)

        layers = []
        for layer in map(U, ctl['m_LayerArray']):
            sm = U(ctl['m_StateMachineArray'][layer['m_StateMachineIndex']])
            states = []
            for s in map(U, sm['m_StateConstantArray']):
                bts = s['m_BlendTreeConstantArray']
                motion = tree_json(bts[0]) if bts else None
                states.append({
                    'name': tos.get(s['m_NameID']), 'tag': tos.get(s['m_TagID']) or None,
                    'speed': s['m_Speed'], 'loop': bool(s['m_Loop']),
                    'speedParam': tos.get(s['m_SpeedParamID']) or None,
                    'cycleOffset': s['m_CycleOffset'], 'cycleOffsetParam': tos.get(s['m_CycleOffsetParamID']) or None,
                    'motion': motion,
                    'transitions': [trans_json(x) for x in s['m_TransitionConstantArray']],
                })
            layers.append({
                'stateMachine': layer['m_StateMachineIndex'],
                'defaultState': sm['m_DefaultState'],
                'blendMode': layer['(int&)m_LayerBlendingMode'],
                'defaultWeight': layer['m_DefaultWeight'],
                'syncedMotionSet': layer['m_StateMachineMotionSetIndex'],
                'anyState': [trans_json(x) for x in sm['m_AnyStateTransitionConstantArray']],
                'selectors': [{
                    'entry': bool(U(sel)['m_IsEntry']),
                    'transitions': [{'dest': U(x)['m_Destination'],
                                     'conds': [{'param': tos.get(U(cc)['m_EventID']), 'mode': U(cc)['m_ConditionMode'],
                                                'threshold': U(cc)['m_EventThreshold']}
                                               for cc in U(x)['m_ConditionConstantArray']]}
                                    for x in U(sel)['m_TransitionConstantArray']]}
                    for sel in sm['m_SelectorStateConstantArray']],
                'states': states,
            })
        return {'params': params, 'layers': layers}

    effects = {}
    # AnimationEvents baked in the clips: TriggerEffect(label) -> Q4.ParticleGroupEventHandler.TriggerEffect,
    # Die / FootPlant / WingFlap -> Q4.AudioEventHandler. Keyed by the controller's clip name.
    clip_events = {}
    for pid, o in objs.items():
        if o.type.name == 'AnimationClip':
            ct = T(pid)
            evs = [[round(e['time'], 4), e['functionName'], e['data']] for e in (ct.get('m_Events') or [])]
            if evs:
                clip_events[ct['m_Name']] = sorted(evs, key=lambda e: e[0])

    def effect_node(g):
        tt = T(g)
        cs = comps(g)
        tr = [pid for cn, pid in cs if cn == 'Transform'][0]
        trt = T(tr)
        lp, lr, ls = trt['m_LocalPosition'], trt['m_LocalRotation'], trt['m_LocalScale']
        return {
            'name': tt['m_Name'],
            'pos': [lp['x'], lp['y'], lp['z']], 'rot': [lr['x'], lr['y'], lr['z'], lr['w']],
            'scale': [ls['x'], ls['y'], ls['z']],
            'components': [('MB:' + (script_class(pid) or '?')) if cn == 'MonoBehaviour' else cn for cn, pid in cs
                           if cn != 'Transform'],
            'children': [effect_node(T(ch['m_PathID'])['m_GameObject']['m_PathID']) for ch in trt['m_Children']],
        }

    def vfx_mappings(vis):
        # Q4.ParticleGroupEvent on the visual prefab: triggerLabel -> (bone, ParticleGroup effect prefab)
        out = []
        gos = []
        walk([q for (c2, q) in comps(vis) if c2 == 'Transform'][0], gos)
        for g in gos:
            for c2, q in comps(g):
                if c2 == 'MonoBehaviour' and script_class(q) == 'ParticleGroupEvent':
                    for m in T(q)['particleGroupMappingList']:
                        ep = m['effect']['m_PathID']
                        if ep == 0 or ep not in objs:
                            continue
                        go = T(ep)['m_GameObject']['m_PathID']
                        node = effect_node(go)
                        effects[node['name']] = node
                        out.append({'label': m['triggerLabel'], 'bone': m['boneName'], 'effect': node['name']})
        return out

    controllers = {}
    enemies = {}
    for p, n in go_name.items():
        cs = comps(p)
        eb = [pid for cn, pid in cs if cn == 'MonoBehaviour' and script_class(pid) == 'EnemyBase']
        if not eb:
            continue
        tr = [pid for cn, pid in cs if cn == 'Transform'][0]
        if T(tr)['m_Father']['m_PathID'] != 0:
            continue
        t = T(eb[0])
        rec = {k: t.get(k) for k in ENEMY_FIELDS}
        ctrl_name = None
        fx = []
        for cn, pid in cs:
            if cn == 'MonoBehaviour' and script_class(pid) == 'PrefabLoader':
                for ref in T(pid)['prefabList']:
                    vis = ref['m_PathID']
                    if vis in objs and objs[vis].type.name == 'GameObject':
                        fx = vfx_mappings(vis)
                        gos = []
                        walk([q for (c2, q) in comps(vis) if c2 == 'Transform'][0], gos)
                        for g in gos:
                            for c2, q in comps(g):
                                if c2 == 'Animator':
                                    cp = T(q)['m_Controller']['m_PathID']
                                    if cp:
                                        ctrl_name = T(cp)['m_Name']
                                        if ctrl_name not in controllers:
                                            controllers[ctrl_name] = controller_json(cp)
        rec['controller'] = ctrl_name
        # Q4.Balloon child (spawnMode Balloon): visual rig + its Animator controller + attach bones + pop effect
        balloon = None
        for ch in T(tr)['m_Children']:
            g = T(ch['m_PathID'])['m_GameObject']['m_PathID']
            cs2 = comps(g)
            bm = [pid for cn, pid in cs2 if cn == 'MonoBehaviour' and script_class(pid) == 'Balloon']
            if not bm:
                continue
            bt = T(bm[0])
            bvis = None
            for cn, pid in cs2:
                if cn == 'MonoBehaviour' and script_class(pid) == 'PrefabLoader' and T(pid)['prefabList']:
                    bvis = T(pid)['prefabList'][0]['m_PathID']
            bctrl = None
            if bvis in objs:
                bgos = []
                walk([q for (c2, q) in comps(bvis) if c2 == 'Transform'][0], bgos)
                for bg in bgos:
                    for c2, q in comps(bg):
                        if c2 == 'Animator' and T(q)['m_Controller']['m_PathID']:
                            cp = T(q)['m_Controller']['m_PathID']
                            bctrl = T(cp)['m_Name']
                            if bctrl not in controllers:
                                controllers[bctrl] = controller_json(cp)
            pop = None
            pe = bt['popBalloonEffect']['m_PathID']
            if pe in objs:
                node = effect_node(T(pe)['m_GameObject']['m_PathID'])
                effects[node['name']] = node
                pop = node['name']
            balloon = {
                'prefab': T(bvis)['m_Name'][:-3] if bvis in objs and T(bvis)['m_Name'].endswith('_pa') else None,
                'controller': bctrl, 'hp': bt['hp'], 'attachBone': bt['BalloonAttachBone'],
                'enemyAttachBone': bt['EnemyAttachBone'], 'popEffect': pop,
                'balloons': [{'string': b['StringRootBone'], 'bone': b['BalloonBone']} for b in bt['Balloons']],
                'localPos': [T([pid for cn, pid in cs2 if cn == 'Transform'][0])['m_LocalPosition'][k] for k in 'xyz'],
            }
        rec['balloon'] = balloon
        rec['fx'] = fx
        enemies[n] = rec

    # NewHealthBar prefab (globalsettings)
    genv = UnityPy.load(os.path.join(AB, 'globalsettings'))
    gobjs = {o.path_id: o for o in genv.objects}
    hb = None
    for o in genv.objects:
        if o.type.name == 'MonoBehaviour':
            try:
                t = o.read_typetree()
            except Exception:
                continue
            if 'healthBarHPSprite' in t:
                hb = t
    def sp(pp):
        t = gobjs[pp['m_PathID']].read_typetree()
        return t['m_Name']
    def geom(pp):
        # Sprite full rect (pivot = centre) and the tight mesh rect inside it (px, y up).
        t = gobjs[pp['m_PathID']].read_typetree()
        rd = t['m_RD']
        return {'rect': [t['m_Rect']['width'], t['m_Rect']['height']],
                'pivot': [t['m_Pivot']['x'], t['m_Pivot']['y']], 'ppu': t['m_PixelsToUnits'],
                'trimOffset': [rd['textureRectOffset']['x'], rd['textureRectOffset']['y']],
                'tight': [rd['textureRect']['width'], rd['textureRect']['height']]}

    def curve(c):
        return [[k['time'], k['value'], k['inSlope'], k['outSlope']] for k in c['m_Curve']]
    healthbar = {
        'showDuration': hb['showDuration'], 'showCurve': curve(hb['showCurve']),
        'hideDuration': hb['hideDuration'], 'hideCurve': curve(hb['hideCurve']),
        'criticalHitShowDelay': hb['criticalHitShowDelay'],
        'barDegenDurationInSeconds': hb['barDegenDurationInSeconds'],
        'degenDisplayDelay': hb['degenDisplayDelay'],
        'deadEnemyHideDelayAfterDegen': hb['deadEnemyHideDelayAfterDegen'],
        'degenFlickerCountPerSecond': hb['degenFlickerCountPerSecond'],
        'degenFlickerCount': hb['degenFlickerCount'],
        'degenFlickerColor': [hb['degenFlickerColor'][c] for c in 'rgba'],
        'spriteScale': hb['spriteScale'],
        'background': sp(hb['healthBarBackgroundSprite']), 'hp': sp(hb['healthBarHPSprite']),
        'damage': sp(hb['healthBarDamageSprite']),
        'sprites': [{'barSize': e['barSize'], 'sprite': sp(e['sprite']), 'geom': geom(e['sprite']),
                     'barDimensions': [e['barDimensions'][k] for k in ('x', 'y', 'width', 'height')]}
                    for e in hb['healthBarSprites']],
    }

    lines = [
        '// GENERATED by tools/assets/extract_enemy_view_data.py — DO NOT EDIT.',
        '// Source: enemies AssetBundle (EnemyBase + AnimatorControllers), globalsettings (NewHealthBar).',
        "import type { EnemyViewData } from './enemyViewTypes';",
        '',
        'export const ENEMY_VIEW_DATA: EnemyViewData = ' + json.dumps(
            {'controllers': controllers, 'enemies': enemies, 'healthBar': healthbar, 'effects': effects,
             'clipEvents': clip_events}, indent=1) + ';',
        '',
    ]
    with open(OUT, 'w') as fh:
        fh.write('\n'.join(lines))
    print('wrote', os.path.normpath(OUT), len(controllers), 'controllers', len(enemies), 'enemies')


if __name__ == '__main__':
    sys.exit(main())
