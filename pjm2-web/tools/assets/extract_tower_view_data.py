#!/usr/bin/env python3
"""
extract_tower_view_data.py — Q4.TowerBase VIEW data + Animator controllers for the
12 production towers (tower_001..tower_012), written as a generated TS module.

Source of truth: the `structures` AssetBundle (TowerBase MonoBehaviours on the
tower_NNN logic prefabs + the AnimatorController of each tower_NNN_pa visual prefab).
Nothing here is guessed: every field is read from the serialized objects.

  TowerBase fields consumed by the view (offsets from il2cpp dump / decomp):
    fortJointNameHorizontal 0xA0, fortJointNameVertical 0xA8, fortAngleMax 0xB8,
    fortAngleMin 0xBC, recoil 0xC8, rotateSound 0x78 (AudioClip), towerBuildEffect 0x158
    (ParticleGroup prefab), towerDestroyEffect 0x168, flagPlaceholderName 0x170.
  AnimatorController (per tower_NNN_comp Animator): parameters, layers (default
  state, blending, default weight), states (clip, speed, loop) and transitions
  (destination, conditions, exit time, duration, offset).

Usage (from pjm2-web/):
  /srv/opencode/venv-unity/bin/python -I tools/assets/extract_tower_view_data.py
"""
import json
import os
import sys

import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
BUNDLE = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/structures')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'src', 'view', 'characters', 'towerViewData.generated.ts')

PARAM_TYPE = {1: 'float', 3: 'int', 4: 'bool', 9: 'trigger'}
TOWERS = [f'tower_{i:03d}' for i in range(1, 13)]


def U(x):
    """Unity typetrees wrap nested structs in {'data': ...}."""
    return x['data'] if isinstance(x, dict) and list(x.keys()) == ['data'] else x


def main():
    env = UnityPy.load(BUNDLE)
    objs = {o.path_id: o for o in env.objects}
    tt = {}

    def T(pid):
        if pid not in tt:
            tt[pid] = objs[pid].read_typetree()
        return tt[pid]

    go_name = {p: T(p)['m_Name'] for p, o in objs.items() if o.type.name == 'GameObject'}

    def comps(gpid):
        return [(objs[c['component']['m_PathID']].type.name, c['component']['m_PathID'])
                for c in T(gpid)['m_Component']]

    def script_class(mb_pid):
        s = T(mb_pid)['m_Script']['m_PathID']
        return T(s).get('m_ClassName') if s in objs else None

    def walk(tr, out):
        t = T(tr)
        out.append(t['m_GameObject']['m_PathID'])
        for ch in t['m_Children']:
            walk(ch['m_PathID'], out)

    def root_go(name, want_class=None):
        for p, n in go_name.items():
            if n != name:
                continue
            tr = [pid for (cn, pid) in comps(p) if cn == 'Transform'][0]
            if T(tr)['m_Father']['m_PathID'] != 0:
                continue
            if want_class is not None and not any(
                    cn == 'MonoBehaviour' and script_class(pid) == want_class for cn, pid in comps(p)):
                continue
            return p
        raise RuntimeError(name)

    def effect_name(pptr):
        pid = pptr['m_PathID']
        if pid == 0 or pid not in objs:
            return None
        t = T(pid)
        if 'm_GameObject' in t:
            return go_name[t['m_GameObject']['m_PathID']]
        return t.get('m_Name')

    def controller_json(cpid):
        t = T(cpid)
        tos = {h: n for h, n in t['m_TOS']}
        ctl = t['m_Controller']
        clip_names = [T(c['m_PathID'])['m_Name'] for c in t['m_AnimationClips']]
        params = [{'name': tos.get(v['m_ID']), 'type': PARAM_TYPE[v['m_Type']]}
                  for v in U(ctl['m_Values'])['m_ValueArray']]
        layers = []
        for li, layer in enumerate(map(U, ctl['m_LayerArray'])):
            sm = U(ctl['m_StateMachineArray'][layer['m_StateMachineIndex']])
            states_raw = [U(s) for s in sm['m_StateConstantArray']]
            states = []
            for s in states_raw:
                clip = None
                for bt in s['m_BlendTreeConstantArray']:
                    nodes = U(U(bt)['m_NodeArray'])
                    nodes = nodes if isinstance(nodes, list) else [nodes]
                    for n in nodes:
                        cid = U(n).get('m_ClipID')
                        if cid is not None and clip is None:
                            clip = clip_names[cid] if cid < len(clip_names) else f'#clip{cid}'
                trans = []
                for tr in s['m_TransitionConstantArray']:
                    tc = U(tr)
                    trans.append({
                        'dest': tc['m_DestinationState'],
                        'conds': [{'param': tos.get(U(cc)['m_EventID']),
                                   'mode': U(cc)['m_ConditionMode'],
                                   'threshold': U(cc)['m_EventThreshold']}
                                  for cc in tc['m_ConditionConstantArray']],
                        'exit': bool(tc['m_HasExitTime']),
                        'exitTime': tc['m_ExitTime'],
                        'duration': tc['m_TransitionDuration'],
                        'offset': tc['m_TransitionOffset'],
                        'fixed': bool(tc['m_HasFixedDuration']),
                    })
                states.append({'name': tos.get(s['m_NameID']), 'clip': clip, 'speed': s['m_Speed'],
                               'loop': bool(s['m_Loop']), 'transitions': trans})
            layers.append({
                'name': (tos.get(U(sm['m_StateConstantArray'][0])['m_PathID']) or '').split('.')[0],
                'defaultState': sm['m_DefaultState'],
                'blendMode': layer['(int&)m_LayerBlendingMode'],
                'defaultWeight': layer['m_DefaultWeight'],
                'states': states,
            })
        return {'params': params, 'layers': layers}

    records = {}
    for name in TOWERS:
        logic = root_go(name, 'TowerBase')
        tb = None
        for cn, pid in comps(logic):
            if cn == 'MonoBehaviour' and script_class(pid) == 'TowerBase':
                tb = T(pid)
        if tb is None:
            raise RuntimeError(f'{name}: TowerBase missing')
        fire_dur = 1.0  # Q4.TowerAnimator.ctor default @00546b60 (0x18 = 1.0f)
        anim_class = None
        for cn, pid in comps(logic):
            if cn == 'MonoBehaviour' and (script_class(pid) or '').startswith('TowerAnimator'):
                anim_class = script_class(pid)
                fire_dur = T(pid).get('fireAnimationDuration', fire_dur)
        rs = tb['rotateSound']['m_PathID']
        rec = {
            'jointHorizontal': tb['fortJointNameHorizontal'],
            'jointVertical': tb['fortJointNameVertical'],
            'fortAngleMin': tb['fortAngleMin'],
            'fortAngleMax': tb['fortAngleMax'],
            'recoil': tb['recoil'],
            'rotateSound': (T(rs)['m_Name'] if rs in objs else None) if rs else None,
            'buildEffect': effect_name(tb['towerBuildEffect']),
            'destroyEffect': effect_name(tb['towerDestroyEffect']),
            'flagPlaceholder': tb['flagPlaceholderName'],
            'animatorClass': anim_class,
            'fireAnimationDuration': fire_dur,
            'controller': None,
            'flagController': None,
        }
        vis = root_go(f'{name}_pa')
        gos = []
        walk([pid for (cn, pid) in comps(vis) if cn == 'Transform'][0], gos)
        for g in gos:
            for cn, pid in comps(g):
                if cn != 'Animator':
                    continue
                cp = T(pid)['m_Controller']['m_PathID']
                if cp == 0:
                    continue
                key = 'flagController' if go_name[g] == 'flag_pos' else 'controller'
                rec[key] = controller_json(cp)
        records[name] = rec

    lines = [
        '// GENERATED by tools/assets/extract_tower_view_data.py — DO NOT EDIT.',
        '// Source: structures AssetBundle (TowerBase MonoBehaviours + AnimatorControllers).',
        '// Field meanings: see tools/assets/extract_tower_view_data.py header and',
        '// docs/TOWER_CONSTRUCTION_ANALYSIS.md.',
        '',
        "import type { TowerViewRecord } from './towerViewTypes';",
        '',
        'export const TOWER_VIEW_DATA: Record<string, TowerViewRecord> = ' + json.dumps(records, indent=1) + ';',
        '',
    ]
    with open(OUT, 'w') as fh:
        fh.write('\n'.join(lines))
    print('wrote', os.path.normpath(OUT), len(records), 'towers')


if __name__ == '__main__':
    sys.exit(main())
