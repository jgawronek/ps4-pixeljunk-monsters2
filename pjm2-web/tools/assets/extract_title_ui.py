#!/usr/bin/env python3
"""
extract_title_ui.py - title screen / option menu / credits layout + art -> public/assets/ui/.

SOURCES (user's own copy):
  Media/level3 + sharedassets3.assets  : the TITLE scene (RectTransforms, Image/LocText/UIButton
        MonoBehaviours; scene MonoBehaviours have no typetree so they are decoded from raw bytes
        with the documented layouts: MonoBehaviour header = GameObject PPtr(12) enabled(4)
        Script PPtr(12) name(string); Image.m_Sprite PPtr at +164; LocText strings = [m_Text,
        textLabel, fontName] at the tail; UIButton onClick method-name string),
        sprites title_m2_logo/_cover/_mask/title_number/title_pixeljunk_logo_02/title_copy,
        AnimationClips (In 0.667s, InStart 2.5s, StartOut 2.0s ... LogoMonster 60.2s) and
        the AudioClip sfx_stage_titlejingle.
  AssetBundles/globalsettings           : prefabs option_01 (Q4.OptionMenuController) and
        credits_01 (Q4.StaffCreditsController) - full typetrees, same technique as
        .work/ui/dump_prefab.py (see docs/GAME_UI_ANALYSIS.md).
OUTPUT
  public/assets/ui/title-ui.json   { title:{nodes,clips}, options:{...}, credits:{pages} }
  public/assets/ui/sprites/title_*.png (+ entries merged into sprites.json)
  public/assets/audio/sfx/sfx_stage_titlejingle.wav
Usage: /srv/opencode/venv-unity/bin/python -I tools/assets/extract_title_ui.py
"""
import json, os, struct, sys
import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MEDIA = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media'
AB = MEDIA + '/StreamingAssets/AssetBundles'
OUT = os.path.join(ROOT, 'public', 'assets', 'ui')
os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)


def r1(v):
    return round(float(v), 2)


# ---------------------------------------------------------------- title scene (level3)
def title_scene():
    os.chdir(MEDIA)
    env = UnityPy.load('level3', 'sharedassets3.assets', 'globalgamemanagers.assets', 'sharedassets0.assets')
    F = env.files
    lv = F['level3']
    ext = {1: F['globalgamemanagers.assets'], 3: F['sharedassets0.assets'], 4: F['sharedassets3.assets']}
    objs = lv.objects

    def getobj(fid, pid):
        f = lv if fid == 0 else ext.get(fid)
        return None if f is None else f.objects.get(pid)

    def nm(o):
        try:
            d = o.read()
            return d.m_ClassName if o.type.name == 'MonoScript' else getattr(d, 'm_Name', '')
        except Exception:
            return ''

    # MonoBehaviours per GameObject
    mbs = {}
    for pid, o in objs.items():
        if o.type.name != 'MonoBehaviour':
            continue
        raw = o.get_raw_data()
        gopid = struct.unpack_from('<iq', raw, 0)[1]
        sfid, spid = struct.unpack_from('<iq', raw, 16)
        so = getobj(sfid, spid)
        script = nm(so) if so else '?'
        nl = struct.unpack_from('<i', raw, 28)[0]
        off = 32 + ((nl + 3) // 4 * 4)
        body = raw[off:]
        info = {'script': script}
        strs = []
        for i in range(0, len(body) - 4, 4):
            l = struct.unpack_from('<i', body, i)[0]
            if 1 <= l <= 80 and i + 4 + l <= len(body):
                s = body[i + 4:i + 4 + l]
                try:
                    t = s.decode('utf8')
                except Exception:
                    continue
                if t.isprintable() and len(t) >= 3:
                    strs.append(t)
        if script == 'Image':
            fid, p = struct.unpack_from('<iq', body, 164)
            so2 = getobj(fid, p) if p else None
            if so2 is not None and so2.type.name == 'Sprite':
                info['sprite'] = nm(so2)
        elif script == 'LocText':
            info['strs'] = strs
            info['label'] = next((s for s in strs if s.startswith('tl_')), strs[0] if strs else '')
        elif script == 'UIButton':
            info['onClick'] = next((s for s in strs if s.startswith('On')), None)
        elif script == 'TitleScreenController':
            info['strs'] = strs
        mbs.setdefault(gopid, []).append(info)

    def node(tpid):
        t = objs[tpid].read_typetree()
        g = objs[t['m_GameObject']['m_PathID']].read_typetree()
        n = {'name': g['m_Name'], 'active': bool(g['m_IsActive'])}
        if 'm_AnchorMin' in t:
            n['ap'] = [r1(t['m_AnchoredPosition']['x']), r1(t['m_AnchoredPosition']['y'])]
            n['size'] = [r1(t['m_SizeDelta']['x']), r1(t['m_SizeDelta']['y'])]
            n['pivot'] = [r1(t['m_Pivot']['x']), r1(t['m_Pivot']['y'])]
            n['anchor'] = [r1(t['m_AnchorMin']['x']), r1(t['m_AnchorMin']['y'])]
        n['scale'] = [r1(t['m_LocalScale']['x']), r1(t['m_LocalScale']['y'])]
        gp = t['m_GameObject']['m_PathID']
        comps = [{k: v for k, v in m.items() if k != 'strs'} for m in mbs.get(gp, [])
                 if m['script'] in ('Image', 'LocText', 'UIButton', 'VerticalLayoutGroup')]
        if comps:
            n['comps'] = comps
        n['children'] = [node(c['m_PathID']) for c in t['m_Children']]
        return n

    roots = []
    for o in objs.values():
        if o.type.name in ('Transform', 'RectTransform'):
            t = o.read_typetree()
            if t['m_Father']['m_PathID'] == 0:
                g = objs[t['m_GameObject']['m_PathID']].read_typetree()
                if g['m_Name'] == 'title_screen_01':
                    root = node(o.path_id)
    # sprites + clips + audio from sharedassets3
    sa = ext[4]
    clips = {}
    meta = {}
    for o in sa.objects.values():
        d = o.read()
        if o.type.name == 'Sprite':
            img = d.image
            img.save(os.path.join(OUT, 'sprites', d.m_Name + '.png'))
            meta[d.m_Name] = {'w': img.size[0], 'h': img.size[1], 'ppu': d.m_PixelsToUnits,
                              'pivot': [d.m_Pivot.x, d.m_Pivot.y], 'border': [0, 0, 0, 0]}
        elif o.type.name == 'AnimationClip':
            mc = d.m_MuscleClip
            clips.setdefault(d.m_Name, []).append(r1(mc.m_StopTime - mc.m_StartTime))
        elif o.type.name == 'AudioClip':
            for name, data in d.samples.items():
                dst = os.path.join(ROOT, 'public', 'assets', 'audio', 'sfx', 'sfx_stage_titlejingle.wav')
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, 'wb').write(data)
    sj = os.path.join(OUT, 'sprites.json')
    sprites = json.load(open(sj))
    sprites.update(meta)
    json.dump(sprites, open(sj, 'w'), indent=1)
    return root, clips


# ---------------------------------------------------------------- globalsettings prefabs
def prefabs():
    env = UnityPy.load(os.path.join(AB, 'globalsettings'))
    objs = {o.path_id: o for o in env.objects}
    cache = {}

    def tt(pid):
        if pid not in cache:
            cache[pid] = objs[pid].read_typetree()
        return cache[pid]

    def script(t):
        try:
            return objs[t['m_Script']['m_PathID']].read().m_ClassName
        except Exception:
            return '?'

    def name_of(pid):
        o = objs.get(pid)
        if o is None:
            return None
        try:
            return o.read().m_Name
        except Exception:
            return None

    def node(tpid, depth=0):
        t = tt(tpid)
        g = tt(t['m_GameObject']['m_PathID'])
        n = {'name': g['m_Name'], 'active': bool(g['m_IsActive'])}
        if 'm_AnchoredPosition' in t:
            n['ap'] = [r1(t['m_AnchoredPosition']['x']), r1(t['m_AnchoredPosition']['y'])]
            n['size'] = [r1(t['m_SizeDelta']['x']), r1(t['m_SizeDelta']['y'])]
        comps = []
        for c in g['m_Component']:
            cp = c['component']['m_PathID']
            o = objs.get(cp)
            if o is None or o.type.name != 'MonoBehaviour':
                continue
            d = tt(cp)
            s = script(d)
            if s == 'LocText':
                col = d['textColor']
                comps.append({'script': s, 'label': d['textLabel'], 'font': d['fontName'],
                              'align': d['m_FontData']['m_Alignment'],
                              'color': [r1(col['r']), r1(col['g']), r1(col['b'])],
                              'tracking': r1(d['tracking'])})
            elif s == 'UISelect':
                comps.append({'script': s, 'min': d['min'], 'max': d['max'], 'useText': d['useText'],
                              'values': [[v['text'], v['value']] for v in d['textValueList']]})
            elif s in ('UIButton',):
                comps.append({'script': s})
            elif s == 'Image' or s == 'ControlImage':
                comps.append({'script': s, 'sprite': name_of(d['m_Sprite']['m_PathID'])})
        if comps:
            n['comps'] = comps
        n['children'] = [node(c['m_PathID'], depth + 1) for c in t['m_Children']]
        return n

    roots = {}
    for o in env.objects:
        if o.type.name in ('Transform', 'RectTransform'):
            t = tt(o.path_id)
            if t['m_Father']['m_PathID'] == 0:
                roots[tt(t['m_GameObject']['m_PathID'])['m_Name']] = o.path_id
    return node(roots['option_01']), node(roots['credits_01'])


def main():
    opt, cred = prefabs()
    title, clips = title_scene()
    json.dump({'title': {'root': title, 'clips': clips}, 'options': opt, 'credits': cred},
              open(os.path.join(OUT, 'title-ui.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('ok')


if __name__ == '__main__':
    main()
