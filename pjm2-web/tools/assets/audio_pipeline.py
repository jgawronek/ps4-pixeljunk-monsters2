#!/usr/bin/env python3
"""
audio_pipeline.py — full audio extraction for PJM2 PS4 (CUSA11967) Unity bundles.

Extends the feasibility spike (probe_audio.py / SPIKE_REPORT.md §3.5):
  * inventory: every AudioClip in every bundle. Each clip's sample data is its
    OWN FSB5 stream (numSamples=1) at m_Resource.m_Offset inside a shared
    .resource archive; archives are the "banks" grouping. FSB5 headers parsed
    directly; raw data sha256'd for cross-bundle dedup.
  * decode:    UnityPy extract_audioclip_samples -> fmod_toolkit.raw_to_wav
    (FMOD ADPCM + Vorbis decode, proven in the spike) -> WAV under
    audio-out/<category>/<name>.wav  (no ffmpeg on this host; WAV fallback).
    Identical clips duplicated across bundles are decoded once.
  * manifest:  audio-out/manifest.json + name_mapping.json + inventory.json.

Usage:
  /srv/opencode/venv-unity/bin/python audio_pipeline.py inventory
  /srv/opencode/venv-unity/bin/python audio_pipeline.py decode [--budget BYTES] [--only sfx,bgm]
  /srv/opencode/venv-unity/bin/python audio_pipeline.py all

Categories from clip-name prefixes (bgm*/voice*/sfx*, else other).
Filesystem-unsafe chars -> '_' deterministically; same-name-different-content
collisions get a __<path_id> suffix. Original names preserved in manifest.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import struct
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import UnityPy  # noqa: E402
from UnityPy.helpers.ResourceReader import get_resource_data  # noqa: E402

BASE = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles'
MEDIA = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media'
OUT = os.path.join(SCRIPT_DIR, 'audio-out')
BUNDLES = ['PS4', 'enemies', 'globalsettings', 'loading_ui', 'main_assets',
           'nature', 'props', 'stages', 'structures']
# loose Unity assets files outside AssetBundles (scanned for completeness;
# only sharedassets3.assets carries an AudioClip: sfx_stage_titlejingle)
LOOSE = ['level0', 'level1', 'level2', 'level3', 'sharedassets0.assets',
         'sharedassets1.assets', 'sharedassets2.assets', 'sharedassets3.assets',
         'resources.assets', 'globalgamemanagers', 'globalgamemanagers.assets']


def bundle_path(bname):
    if bname.startswith('Media/'):
        return os.path.join(MEDIA, bname[len('Media/'):])
    return os.path.join(BASE, bname)
CODEC_NAMES = {0: 'PCM', 1: 'Vorbis', 2: 'ADPCM', 3: 'MP3', 4: 'VAG', 5: 'HEVAG',
               6: 'XMA', 7: 'AAC', 8: 'GCADPCM', 9: 'ATRAC9'}
DEFAULT_BUDGET = 2_000_000_000  # ~2 GB WAV output cap per task constraint


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def category_of(name):
    n = name.lower()
    if n.startswith('bgm') or n.startswith('music'):
        return 'bgm'
    if n.startswith('voice') or n.startswith('vo_') or n.startswith('cv_'):
        return 'voice'
    if n.startswith('sfx') or n.startswith('se_'):
        return 'sfx'
    return 'other'


def sanitize(name):
    s = re.sub(r'[^A-Za-z0-9._-]', '_', name)
    return s.strip('._') or 'unnamed'


def parse_fsb5_header(data):
    """Best-effort FSB5 header parse (each Unity clip = one single-sample FSB5)."""
    if len(data) < 60 or data[:4] != b'FSB5':
        return None
    version, num, sh_size, nt_size, data_size, mode = struct.unpack_from('<6I', data, 4)
    return {'version': version, 'numSamples': num, 'sampleHeadersSize': sh_size,
            'nameTableSize': nt_size, 'dataSize': data_size, 'mode': hex(mode)}


def raw_clip_data(o, m):
    if m['inline']:
        t = o.read_typetree()
        return bytes(t.get('m_AudioData') or b'')
    return bytes(get_resource_data(m['source'], o.assets_file, m['offset'], m['dataBytes']))


def clip_meta(o):
    t = o.read_typetree()
    res = t.get('m_Resource') or {}
    data = t.get('m_AudioData') or b''
    size = len(data) if data else int(res.get('m_Size') or 0)
    length = float(t.get('m_Length') or 0)
    rate = int(t.get('m_Frequency') or 0)
    chans = int(t.get('m_Channels') or 0)
    return {
        'name': t.get('m_Name') or f'clip_{o.path_id}',
        'pathId': o.path_id,
        'codec': CODEC_NAMES.get(t.get('m_CompressionFormat'), str(t.get('m_CompressionFormat'))),
        'codecId': t.get('m_CompressionFormat'),
        'sampleRate': rate,
        'channels': chans,
        'durationSec': round(length, 4),
        'dataBytes': size,
        'inline': bool(data),
        'source': res.get('m_Source') or ('inline' if data else None),
        'offset': int(res.get('m_Offset') or 0),
        'estWavBytes': int(length * rate * chans * 2) + 44,
    }


def do_inventory():
    os.makedirs(OUT, exist_ok=True)
    inv = {'bundles': {}, 'banks': {}, 'totals': {}}
    tot_clips = tot_bytes = tot_wav = 0
    cats = collections.Counter()
    codecs = collections.Counter()
    for bname in BUNDLES + ['Media/' + x for x in LOOSE]:
        path = bundle_path(bname)
        if not os.path.isfile(path):
            log(f'{bname}: MISSING'); continue
        t0 = time.time()
        env = UnityPy.load(path)
        clips = []
        for o in env.objects:
            if o.type.name != 'AudioClip':
                continue
            try:
                m = clip_meta(o)
                raw = raw_clip_data(o, m)
                m['sha256'] = hashlib.sha256(raw).hexdigest()
                m['fsb5'] = parse_fsb5_header(raw[:64])
                if m['fsb5'] is None:
                    m['fsb5'] = {'error': 'no FSB5 magic', 'magic': raw[:4].hex()}
            except Exception as e:
                log(f'{bname}: clip {o.path_id} meta FAILED: {e}')
                continue
            m['bundle'] = bname
            m['category'] = category_of(m['name'])
            clips.append(m)
            cats[m['category']] += 1
            codecs[m['codec']] += 1
            src = m['source'] or 'inline'
            bank = inv['banks'].setdefault(src, {'archive': src, 'clips': [], 'dataBytes': 0})
            bank['clips'].append({'name': m['name'], 'bundle': bname, 'pathId': m['pathId'],
                                  'codec': m['codec'], 'sampleRate': m['sampleRate'],
                                  'channels': m['channels'], 'durationSec': m['durationSec'],
                                  'dataBytes': m['dataBytes'], 'sha256': m['sha256']})
            bank['dataBytes'] += m['dataBytes']
        inv['bundles'][bname] = {
            'clips': clips,
            'count': len(clips),
            'dataBytes': sum(c['dataBytes'] for c in clips),
            'estWavBytes': sum(c['estWavBytes'] for c in clips),
            'loadSec': round(time.time() - t0, 1),
        }
        tot_clips += len(clips)
        tot_bytes += inv['bundles'][bname]['dataBytes']
        tot_wav += inv['bundles'][bname]['estWavBytes']
        log(f'{bname}: {len(clips)} clips, {inv["bundles"][bname]["dataBytes"]/1e6:.1f} MB compressed, '
            f'est WAV {inv["bundles"][bname]["estWavBytes"]/1e6:.1f} MB ({time.time()-t0:.1f}s)')
    uniq = {c['sha256'] for b in inv['bundles'].values() for c in b['clips']}
    inv['totals'] = {'clips': tot_clips, 'uniqueByContent': len(uniq),
                     'compressedBytes': tot_bytes, 'estWavBytes': tot_wav,
                     'categories': dict(cats), 'codecs': dict(codecs)}
    with open(os.path.join(OUT, 'inventory.json'), 'w') as f:
        json.dump(inv, f, indent=1)
    log(f'INVENTORY: {tot_clips} clip occurrences, {len(uniq)} unique by content, '
        f'{tot_bytes/1e6:.1f} MB compressed, est WAV {tot_wav/1e9:.2f} GB; '
        f'categories={dict(cats)} codecs={dict(codecs)}')
    return inv


def wav_duration(blob):
    """Parse RIFF/WAVE header -> (durationSec, sampleRate, channels)."""
    try:
        if blob[:4] != b'RIFF' or blob[8:12] != b'WAVE':
            return None
        pos = 12
        fmt = None
        while pos + 8 <= len(blob):
            cid = blob[pos:pos + 4]
            csz = struct.unpack_from('<I', blob, pos + 4)[0]
            if cid == b'fmt ':
                _, ch, rate, _, _, bits = struct.unpack_from('<HHIIHH', blob, pos + 8)
                fmt = (ch, rate, bits)
            elif cid == b'data' and fmt:
                ch, rate, bits = fmt
                return round(csz / (rate * ch * bits / 8), 4), rate, ch
            pos += 8 + csz + (csz & 1)
    except Exception:
        pass
    return None


def do_decode(budget=DEFAULT_BUDGET, only=None):
    inv_path = os.path.join(OUT, 'inventory.json')
    if not os.path.isfile(inv_path):
        do_inventory()
    with open(inv_path) as f:
        inv = json.load(f)
    all_clips = [c for b in inv['bundles'].values() for c in b['clips']]
    # group identical content (cross-bundle duplicates share path_id + bytes)
    groups = collections.OrderedDict()
    for c in all_clips:
        groups.setdefault(c['sha256'], []).append(c)
    total_est = sum(g[0]['estWavBytes'] for g in groups.values())
    pending = set()
    if total_est > budget:
        log(f'est WAV {total_est/1e9:.2f} GB > budget {budget/1e9:.2f} GB -> prioritizing SFX + stage-1 BGM')
        for sha, g in groups.items():
            c = g[0]
            keep = c['category'] == 'sfx' or (
                c['category'] == 'bgm' and re.search(r'stage[_-]?0?1(?![0-9])', c['name'], re.I))
            if not keep:
                pending.add(sha)
    if only:
        allowed = set(only.split(','))
        for sha, g in groups.items():
            if g[0]['category'] not in allowed:
                pending.add(sha)

    from UnityPy.export.AudioClipConverter import extract_audioclip_samples
    manifest = []
    mapping = {}
    used_files = set()
    ok = fail = pend = 0
    out_bytes = 0
    env_cache = {}
    for sha, g in groups.items():
        c = g[0]
        entry = {k: c[k] for k in ('name', 'codec', 'sampleRate', 'channels',
                                   'durationSec', 'category')}
        entry['sourceBank'] = c['source']
        entry['sha256'] = sha
        entry['occurrences'] = [{'bundle': x['bundle'], 'pathId': x['pathId'],
                                 'sourceBank': x['source']} for x in g]
        if sha in pending:
            entry.update(status='pending', file=None,
                         note='deferred: WAV budget exceeded (SFX + stage-1 BGM prioritized)')
            manifest.append(entry); pend += 1
            continue
        bname = c['bundle']
        try:
            if bname not in env_cache:
                env_cache[bname] = {o.path_id: o for o in UnityPy.load(bundle_path(bname)).objects
                                    if o.type.name == 'AudioClip'}
            o = env_cache[bname].get(c['pathId'])
            if o is None:
                raise RuntimeError('clip object not found on reload')
            samples = extract_audioclip_samples(o.read())
            if not samples:
                raise RuntimeError('converter returned no samples')
            for si, (fn, blob) in enumerate(sorted(samples.items())):
                base = sanitize(c['name']) + (f'-{si}' if si else '')
                rel = os.path.join(c['category'], base + '.wav')
                if rel in used_files:  # same name, different content
                    base = f'{base}__{c["pathId"]}'
                    rel = os.path.join(c['category'], base + '.wav')
                used_files.add(rel)
                dest = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, 'wb') as f:
                    f.write(blob)
                dur = wav_duration(blob)
                e = dict(entry)
                e.update(status='ok', file=rel, bytes=len(blob),
                         decodedDurationSec=dur[0] if dur else None)
                if dur and abs(dur[0] - c['durationSec']) > max(0.05, c['durationSec'] * 0.02):
                    e['note'] = f'duration mismatch: meta {c["durationSec"]} vs wav {dur[0]}'
                if si:
                    e['name'] = f'{c["name"]}-{si}'
                manifest.append(e)
                mapping[e['name']] = base
                out_bytes += len(blob)
            ok += 1
        except Exception as ex:
            entry.update(status='failed', file=None, error=f'{type(ex).__name__}: {ex}')
            manifest.append(entry); fail += 1
            log(f'FAIL {bname}/{c["name"]}: {ex}')
        if (ok + fail) % 50 == 0:
            log(f'progress: {ok + fail}/{len(groups)} unique clips ({out_bytes/1e6:.0f} MB)')
    summary = {'clipOccurrences': len(all_clips), 'uniqueClips': len(groups),
               'decoded': ok, 'failed': fail, 'pending': pend,
               'outputBytes': out_bytes, 'format': 'wav (16-bit PCM; no ffmpeg on host)',
               'budgetBytes': budget, 'estWavBytesUnique': total_est}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({'summary': summary, 'clips': manifest}, f, indent=1)
    changed = {k: v for k, v in mapping.items() if k != v}
    with open(os.path.join(OUT, 'name_mapping.json'), 'w') as f:
        json.dump({'note': 'original clip name -> sanitized file stem (only changed names listed)',
                   'changed': changed}, f, indent=1)
    log(f'DECODE: ok={ok} failed={fail} pending={pend} output={out_bytes/1e6:.1f} MB')
    return summary


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=['inventory', 'decode', 'all'])
    ap.add_argument('--budget', type=int, default=DEFAULT_BUDGET)
    ap.add_argument('--only', help='comma-separated categories to decode (sfx,bgm,voice,other)')
    args = ap.parse_args()
    if args.stage in ('inventory', 'all'):
        do_inventory()
    if args.stage in ('decode', 'all'):
        do_decode(args.budget, args.only)
