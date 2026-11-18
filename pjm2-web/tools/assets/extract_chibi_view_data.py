#!/usr/bin/env python3
"""
extract_chibi_view_data.py — Q4.Chibi VIEW data: the `chibi_ctrl` AnimatorController (state machine, params,
blend trees), the serialized Chibi MonoBehaviour fields and the AnimationEvents baked in the chibi clips,
written as src/view/characters/chibiViewData.generated.ts. Source: `stages` AssetBundle
(3d_stage_004_env.sharedAssets). Controller JSON code is shared in shape with extract_enemy_view_data.py.

Usage (from pjm2-web/):  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_chibi_view_data.py
"""
import json
import os
import sys

import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
AB = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'src', 'view', 'characters', 'chibiViewData.generated.ts')
PARAM_TYPE = {1: 'float', 3: 'int', 4: 'bool', 9: 'trigger'}
BLEND_NAMES = {0: '1d', 1: '2dSimpleDirectional', 2: '2dFreeformDirectional', 3: '2dFreeformCartesian', 4: 'direct'}


def U(x):
    return x['data'] if isinstance(x, dict) and list(x.keys()) == ['data'] else x


def main():
    env = UnityPy.load(os.path.join(AB, 'stages'))
    objs = {}
    for o in env.objects:
        if o.assets_file.name.endswith('3d_stage_004_env.sharedAssets'):
            objs[o.path_id] = o
    tt = {}

    def T(pid):
        if pid not in tt:
            tt[pid] = objs[pid].read_typetree()
        return tt[pid]

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


    ctrl_pid = [p for p, o in objs.items() if o.type.name == 'AnimatorController' and T(p)['m_Name'] == 'chibi_ctrl'][0]
    controller = controller_json(ctrl_pid)
    cb = T(2479)
    fields = {k: v for k, v in cb.items() if not isinstance(v, dict)}
    clips = {}
    for pid, o in objs.items():
        if o.type.name == 'AnimationClip':
            ct = T(pid)
            evs = [[round(e['time'], 4), e['functionName'], e['data']] for e in (ct.get('m_Events') or [])]
            clips[ct['m_Name']] = {'length': ct['m_MuscleClip']['m_StopTime'] if 'm_MuscleClip' in ct else None,
                                   'events': sorted(evs, key=lambda e: e[0])}
    data = {'controller': controller, 'chibi': fields, 'clips': clips}
    with open(OUT, 'w') as fh:
        fh.write('// GENERATED by tools/assets/extract_chibi_view_data.py — DO NOT EDIT.\n')
        fh.write('// Source: stages AssetBundle (3d_stage_004_env.sharedAssets: chibi_ctrl + Chibi MB).\n')
        fh.write('export const CHIBI_VIEW_DATA = ' + json.dumps(data, indent=1) + ' as const;\n')
    print('wrote', os.path.normpath(OUT), len(controller['layers']), 'layers', len(clips), 'clips')


if __name__ == '__main__':
    sys.exit(main())
