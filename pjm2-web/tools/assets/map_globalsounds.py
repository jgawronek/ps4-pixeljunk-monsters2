#!/usr/bin/env python3
"""
map_globalsounds.py — Q4.GlobalSounds static properties -> decoded clip names.

Strategy (best-effort, evidence recorded per property):
  1. Parse decomp/skeleton/Q4.cs GlobalSounds class: serialized `private AudioClip`
     fields + `public static AudioClip` properties (the sim uses the properties).
  2. Locate the GlobalSounds MonoBehaviour in the Unity bundles (globalsettings
     first, then main_assets) via its MonoScript m_ClassName, read its typetree,
     and resolve each serialized PPtr<AudioClip> to the clip's m_Name.
  3. Cross-reference with audio-out/manifest.json for the output file.

Confidence: 'high'   = serialized PPtr resolved to a decoded clip in the manifest
            'medium' = PPtr resolved to a clip name but clip not in manifest
            'low'    = name-based guess only (no serialized reference found)
            null clip + note when the field is unassigned (PPtr path_id == 0)

Usage: /srv/opencode/venv-unity/bin/python map_globalsounds.py
Output: audio-out/globalsounds_map.json
"""
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
sys.path.insert(0, SCRIPT_DIR)

import UnityPy  # noqa: E402

BASE = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(SCRIPT_DIR, 'audio-out')
SKELETON = os.path.join(ROOT, 'decomp/skeleton/Q4.cs')


def parse_skeleton():
    src = open(SKELETON, encoding='utf-8', errors='replace').read()
    m = re.search(r'public class GlobalSounds\b.*?\n\}', src, re.S)
    if not m:
        raise RuntimeError('GlobalSounds class not found in skeleton')
    body = m.group(0)
    fields = re.findall(r'private AudioClip (\w+); // 0x([0-9A-Fa-f]+)', body)
    props = re.findall(r'public static AudioClip (\w+) \{ get; \}', body)
    return fields, props


def field_for_prop(prop, fields):
    flds = {f for f, _ in fields}
    cand = prop[0].lower() + prop[1:]
    if cand in flds:
        return cand
    if prop.startswith('BGM'):  # BGMResultsScreen -> bgmResultsScreen
        cand = 'bgm' + prop[3:]
        if cand in flds:
            return cand
    return None


def find_globalsounds_mb(bname):
    env = UnityPy.load(os.path.join(BASE, bname))
    idx = {o.path_id: o for o in env.objects}
    script_pids = set()
    for o in env.objects:
        if o.type.name == 'MonoScript':
            try:
                d = o.read()
                if getattr(d, 'm_ClassName', None) == 'GlobalSounds':
                    script_pids.add(o.path_id)
            except Exception:
                pass
    found = []
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            d = o.read()
            if d.m_Script.path_id in script_pids:
                found.append(o)
        except Exception:
            pass
    return env, idx, found


def main():
    fields, props = parse_skeleton()
    print(f'skeleton: {len(fields)} serialized fields, {len(props)} static properties')
    manifest = json.load(open(os.path.join(OUT, 'manifest.json')))
    by_name = {}
    for c in manifest['clips']:
        if c['status'] == 'ok':
            by_name.setdefault(c['name'], c)

    env = idx = None
    mbs = []
    used_bundle = None
    for bname in ('globalsettings', 'main_assets', 'stages', 'loading_ui'):
        env, idx, mbs = find_globalsounds_mb(bname)
        if mbs:
            used_bundle = bname
            break
    tt = None
    if mbs:
        tt = mbs[0].read_typetree()
        print(f'GlobalSounds MonoBehaviour found in {used_bundle} '
              f'(path_id={mbs[0].path_id}, instances={len(mbs)})')
    else:
        print('WARNING: no GlobalSounds MonoBehaviour found; falling back to name guesses')

    # external-file resolution: CAB/archive basename -> bundle that contains it
    inv = json.load(open(os.path.join(OUT, 'inventory.json')))
    base_to_bundle = {}
    for src in inv['banks']:
        if src and src != 'inline':
            base = src.rsplit('/', 1)[-1].lower()
            if base.endswith('.resource'):
                base = base[:-len('.resource')]
            base_to_bundle[base] = \
                next(b for b, bd in inv['bundles'].items()
                     if any(c['source'] == src for c in bd['clips']))
    ext_cache = {}

    def resolve_pptr(p):
        """typetree PPtr dict -> (clip_name, note) or (None, note)."""
        if not isinstance(p, dict):
            return None, f'unexpected PPtr type {type(p).__name__}'
        pid = p.get('m_PathID', 0)
        fid = p.get('m_FileID', 0)
        if pid == 0:
            return None, 'serialized reference unassigned (m_PathID=0)'
        target_idx, target_name = idx, used_bundle
        if fid != 0:
            exts = getattr(mbs[0].assets_file, 'externals', None) or []
            if fid > len(exts):
                return None, f'm_FileID={fid} out of range ({len(exts)} externals)'
            epath = getattr(exts[fid - 1], 'path', '') or ''
            ebase = epath.rsplit('/', 1)[-1].lower()
            tb = base_to_bundle.get(ebase)
            if tb is None:
                return None, (f'external ref m_FileID={fid} ({epath}) '
                              'not matched to any known bundle')
            if tb not in ext_cache:
                e2 = UnityPy.load(os.path.join(BASE, tb))
                ext_cache[tb] = {o.path_id: o for o in e2.objects}
            target_idx, target_name = ext_cache[tb], tb
        o = target_idx.get(pid)
        if o is None:
            return None, f'path_id {pid} not present in {target_name}'
        try:
            return o.read().m_Name, f'PPtr -> {target_name} path_id={pid}'
        except Exception as e:
            return None, f'path_id {pid} read failed: {e}'

    result = {}
    stats = {'high': 0, 'medium': 0, 'low': 0, 'null': 0}
    for prop in props:
        fld = field_for_prop(prop, fields)
        entry = {'clip': None, 'file': None, 'confidence': None, 'field': fld, 'evidence': ''}
        clip_name = None
        if tt is not None and fld and fld in tt:
            clip_name, note = resolve_pptr(tt[fld])
            entry['evidence'] = f'{used_bundle} GlobalSounds.{fld}: {note}'
        elif tt is not None:
            entry['evidence'] = f'field {fld!r} missing from typetree'
        else:
            entry['evidence'] = 'no serialized GlobalSounds instance found'
        if clip_name:
            entry['clip'] = clip_name
            mc = by_name.get(clip_name)
            if mc:
                entry['file'] = mc['file']
                entry['confidence'] = 'high'
            else:
                entry['confidence'] = 'medium'
                entry['evidence'] += '; clip not in decoded manifest'
        else:
            # best-effort name guess: sfx_<snake_case(prop)>
            guess = 'sfx_' + re.sub(r'(?<!^)(?=[A-Z])', '_', prop).lower()
            if guess in by_name:
                entry.update(clip=guess, file=by_name[guess]['file'], confidence='low',
                             evidence=entry['evidence'] + f'; name guess {guess} matched manifest')
            else:
                entry['confidence'] = None
        stats[entry['confidence'] or 'null'] += 1
        result[prop] = entry

    out = {
        'source': 'Q4.GlobalSounds (decomp/skeleton/Q4.cs) + serialized MonoBehaviour in '
                  + (used_bundle or 'none'),
        'propertyCount': len(props),
        'stats': stats,
        'properties': result,
    }
    with open(os.path.join(OUT, 'globalsounds_map.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print('stats:', stats)
    print('wrote', os.path.join(OUT, 'globalsounds_map.json'))


if __name__ == '__main__':
    main()
