#!/usr/bin/env python3
"""
probe_audio.py — audio feasibility probe for PJM2 PS4 bundles (report-focused, timeboxed).

Scans AudioClips in the given bundles, reports:
  * compression format enum distribution (Unity AudioCompressionFormat)
  * sample rate / channels / length / data size totals
  * where sample data lives (inline m_AudioData vs .resource archive)
  * header magic (first 16 bytes) of one representative clip per format
Then attempts ONE decode to WAV per bundle via UnityPy's FMOD-backed
extract_audioclip_samples (fmod_toolkit.raw_to_wav) into <workdir>/audio/.

Usage: PYTHONPATH=tools/assets/pylibs python probe_audio.py <audio_out_dir> [bundle1 bundle2 ...]
"""
import collections
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import UnityPy  # noqa: E402
from UnityPy.enums import AudioCompressionFormat  # noqa: E402
from UnityPy.helpers.ResourceReader import get_resource_data  # noqa: E402

BASE = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles'
REPORT = os.path.join(SCRIPT_DIR, 'SPIKE_REPORT.md')

audio_out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else '.'
bundles = sys.argv[2:] or ['enemies', 'globalsettings']
os.makedirs(audio_out, exist_ok=True)


def log(msg):
    line = f'- [{time.strftime("%H:%M:%S")}] audio-probe: {msg}'
    print(line)
    with open(REPORT, 'a') as f:
        f.write(line + '\n')


def fmt_name(v):
    try:
        return AudioCompressionFormat(v).name
    except Exception:
        return str(v)


summary = {}
for bname in bundles:
    t0 = time.time()
    path = os.path.join(BASE, bname)
    if not os.path.isfile(path):
        log(f'{bname}: MISSING'); continue
    env = UnityPy.load(path)
    clips = [o for o in env.objects if o.type.name == 'AudioClip']
    fmts = collections.Counter()
    rates = collections.Counter()
    chans = collections.Counter()
    total_bytes = 0
    inline = 0
    resourced = 0
    sources = collections.Counter()
    samples = {}
    for c in clips:
        try:
            t = c.read_typetree()
        except Exception as e:
            fmts[f'READ_ERR'] += 1
            continue
        cf = t.get('m_CompressionFormat')
        fmts[cf] += 1
        rates[t.get('m_Frequency')] += 1
        chans[t.get('m_Channels')] += 1
        data = t.get('m_AudioData') or b''
        res = t.get('m_Resource') or {}
        if data:
            inline += 1
            total_bytes += len(data)
            raw = bytes(data[:16])
        elif res and res.get('m_Size'):
            resourced += 1
            total_bytes += res['m_Size']
            sources[res.get('m_Source', '?')] += 1
            raw = None
        else:
            raw = None
        if cf not in samples and raw is None and res:
            samples[cf] = c  # remember one reader per format for magic + decode
        elif cf not in samples:
            samples[cf] = c
    log(f'{bname}: {len(clips)} AudioClips in {time.time()-t0:.1f}s | formats: '
        + ', '.join(f'{fmt_name(k)}({k})x{v}' for k, v in sorted(fmts.items(), key=str))
        + f' | rates={dict(rates)} channels={dict(chans)}')
    log(f'{bname}: data location: inline={inline} resource={resourced} total={total_bytes/1e6:.1f} MB; '
        f'resources: {dict(sources)}')

    # header magic per format
    for cf, c in samples.items():
        try:
            t = c.read_typetree()
            data = t.get('m_AudioData') or b''
            if not data and t.get('m_Resource'):
                r = t['m_Resource']
                data = get_resource_data(r['m_Source'], c.assets_file, r['m_Offset'], min(r['m_Size'], 64))
            magic = bytes(data[:16])
            printable = ''.join(chr(x) if 32 <= x < 127 else '.' for x in magic)
            log(f'{bname}: magic[{fmt_name(cf)}] {t.get("m_Name")!r}: {magic.hex()} "{printable}"')
        except Exception as e:
            log(f'{bname}: magic[{fmt_name(cf)}] FAILED {type(e).__name__}: {e}')

    # decode attempt: one clip per bundle
    if clips:
        t1 = time.time()
        c = next(iter(samples.values()))
        try:
            from UnityPy.export.AudioClipConverter import extract_audioclip_samples
            d = c.read()
            out = extract_audioclip_samples(d)
            if out is None:
                raise RuntimeError('converter returned None (FMOD refused format?)')
            for fn, blob in out.items():
                fn = f'{bname}_{fn}'
                p = os.path.join(audio_out, fn)
                with open(p, 'wb') as f:
                    f.write(blob)
                log(f'{bname}: DECODED {d.m_Name!r} -> {p} ({len(blob)} bytes, {time.time()-t1:.1f}s)')
        except Exception as e:
            log(f'{bname}: decode FAILED for {c.path_id}: {type(e).__name__}: {e}')
    summary[bname] = {'clips': len(clips),
                      'formats': {fmt_name(k): v for k, v in fmts.items()},
                      'totalBytes': total_bytes}
log('probe_audio DONE')

import json
with open(os.path.join(audio_out, 'audio_probe_summary.json'), 'w') as f:
    json.dump(summary, f, indent=1)
print('wrote', os.path.join(audio_out, 'audio_probe_summary.json'))
