# AUDIO PIPELINE REPORT — PixelJunk Monsters 2 (PS4, CUSA11967) → WebAudio

**Status: COMPLETE.** All audio in the decrypted copy inventoried and decoded:
**443 AudioClip occurrences → 269 unique clips (by content sha256), 269/269 decoded, 0 failures, 0 pending.**
Output: **404.3 MB of 16-bit PCM WAV** (38.2 min total audio), under `tools/assets/audio-out/`.
Builds on the feasibility spike (`SPIKE_REPORT.md` §3.5): FSB5 containers, FMOD decode via
`fmod_toolkit` in `/srv/opencode/venv-unity`. Game files read-only; all writes inside project root.

---

## 1. Coverage

| Source | Occurrences | Notes |
|---|---|---|
| `AssetBundles/enemies` | 81 | enemy SFX (ADPCM) |
| `AssetBundles/globalsettings` | 259 | UI/player/tower SFX + all 13 BGM (ADPCM + Vorbis) |
| `AssetBundles/props` | 41 | fruit/item/pickup SFX |
| `AssetBundles/stages` | 39 | stage ambience + BGM duplicates of globalsettings |
| `AssetBundles/structures` | 21 | tower SFX duplicates |
| `AssetBundles/nature` | 1 | `sfx_stage_fish` |
| `Media/sharedassets3.assets` | 1 | `sfx_stage_titlejingle` (FSB5 in `Media/sharedassets3.resource`) |
| `AssetBundles/{PS4,loading_ui,main_assets}` | 0 | no AudioClips |
| `Media/{level0-3,sharedassets0-2,resources.assets,globalgamemanagers*}` | 0 | scanned, no AudioClips |
| **Total** | **443** | **269 unique by content** (174 cross-bundle duplicates share path_id + bytes) |

Unique clips by category: **sfx 256, bgm 13, voice 0, other 0** (no dedicated voice banks;
character voices are SFX, e.g. `sfx_kuri_voice`, `sfx_chibi_jumpvoice`).
Codecs: **ADPCM 248, Vorbis 21** (Unity `m_CompressionFormat` 2/1). All stereo;
267 clips @ 44.1 kHz, 2 @ 48 kHz (`sfx_menu_bestscore` 1.64 s variant, `sfx_menu_changeoutfit`).
SFX durations 0.05–30.5 s; BGM 43–212 s.

### Bank structure (inventory.json → `banks`)
Unity on PS4 stores **one single-sample FSB5 stream per AudioClip** (`numSamples=1`,
FSB5 v1) at `m_Resource.m_Offset` inside a shared `.resource` archive. **14 archives**
act as the bank grouping (9× `CAB-*.resource` incl. props/enemies/globalsettings/structures,
4× `BuildPlayer-*_env.resource` stage ambience, 1× `Media/sharedassets3.resource`).
`inventory.json` lists every archive → member clips (name, bundle, pathId, codec, rate,
channels, duration, bytes, sha256) plus per-clip FSB5 header fields (version/mode/dataSize).
FSB5 name tables are empty (`nameTableSize=0`); Unity `m_Name` is the authoritative sample name.

### Not covered (out of scope, documented)
- `Media/StreamingAssets/Videos/`: **54 .mp4** guide/stage videos (142 MB) with embedded
  audio tracks — movie audio, not FSB5 clips; needs ffmpeg demux if ever wanted.
- No ATRAC9/AT9 anywhere (consistent with the spike).

## 2. Format decision

- **ffmpeg: NOT available** (`which ffmpeg` empty; no oggenc/sox/avconv either; nothing in
  the venv or `pylibs/bin`). Per task fallback: **kept .wav** — 16-bit PCM, original rate
  (44.1/48 kHz), stereo, as produced by `fmod_toolkit.raw_to_wav` (FMOD decode).
- Estimated full WAV output 0.65 GB < 2 GB budget → **everything decoded, nothing deferred**.
  (Budget logic exists in the script: if exceeded, SFX + stage-1 BGM first, rest `pending`.)
- WebAudio plays WAV natively (`decodeAudioData`). When ffmpeg becomes available, transcode:
  `ffmpeg -i in.wav -c:a libvorbis -q:a 5 out.ogg` (BGM Vorbis sources could also be remuxed
  losslessly FSB5→.ogg with vgmstream-cli; not installed). Update `manifest.json` `file`
  fields accordingly if you do.

## 3. Outputs (`pjm2-web/tools/assets/audio-out/`)

| File | Content |
|---|---|
| `sfx/*.wav` (256), `bgm/*.wav` (13) | decoded audio, original clip names |
| `manifest.json` | per unique clip: `name, file, sourceBank, codec, sampleRate, channels, durationSec, category, status, bytes, decodedDurationSec, sha256, occurrences[{bundle,pathId,sourceBank}]` + summary |
| `inventory.json` | full census: every occurrence per bundle + bank(archive)→samples grouping + FSB5 headers |
| `name_mapping.json` | original→sanitized name changes (see below) |
| `globalsounds_map.json` | Q4.GlobalSounds property → clip/file + confidence + evidence |

**Naming:** all 269 names were already filesystem-safe except one collision: two
*different-content* clips named `sfx_menu_bestscore` in globalsettings (1.637 s @48 kHz and
3.819 s @44.1 kHz). First occurrence keeps `sfx/sfx_menu_bestscore.wav`; the second is
`sfx/sfx_menu_bestscore__1632969056192644965.wav` (deterministic `__<path_id>` suffix).
Sanitizer rule: `[^A-Za-z0-9._-]` → `_`. Cross-bundle duplicates decode once; all 443
occurrences are listed in each clip's `occurrences` array.

**Validation (all passed):** every manifest file exists; every WAV re-parsed with `wave`
(16-bit, channel count matches, duration within 2% of Unity `m_Length` — 0 mismatches);
12-clip random RMS spot-check: all non-silent. GlobalSounds files all exist.

## 4. Q4.GlobalSounds mapping — 113/113 properties, all HIGH confidence

Method (`map_globalsounds.py`): parsed the 113 serialized `private AudioClip` fields +
113 `public static AudioClip` properties from `decomp/skeleton/Q4.cs`, located the single
**GlobalSounds MonoBehaviour in `globalsettings`** (path_id `7621347385149222649`, found via
MonoScript `m_ClassName`), read its typetree, and resolved every `PPtr<AudioClip>` to the
clip's `m_Name`, then joined to the decoded manifest. 10 properties (fruit/item/hidden-pickup
sounds) referenced an external file (`m_FileID=1` → `cab-90733f…` = **props** bundle); resolved
via the assets-file external list. No name-guessing was needed. Examples:

| Property | Clip |
|---|---|
| `ItemDieInWater` | `sfx_item_disintegrate` |
| `ItemLostInWater` | `sfx_item_splash` |
| `EnemyProtectedByMagic` | `sfx_allenemies_magic` |
| `EnemyProtectedByForceField` | `sfx_allenemies_physics` |
| `TowerBuild` | `sfx_tower_buildtower` |
| `BGMResultsScreen` | `bgm_results` |

Each entry carries `confidence: "high"` + an evidence string (bundle, field, path_id).
Note: BGM is difficulty-based (`bgm_stage_easy/medium/hard`, `bgm_boss_1/2`, `bgm_ex_*`,
`bgm_danganronpa_*`, `bgm_title`, `bgm_results`) — no per-stage numbered BGM exists.

## 5. Re-run commands

```bash
cd /srv/opencode/ps3-pixeljunk-monsters2
PY=/srv/opencode/venv-unity/bin/python

# full pipeline (inventory + decode + manifest; ~35 s, idempotent):
$PY pjm2-web/tools/assets/audio_pipeline.py all
# stages separately:
$PY pjm2-web/tools/assets/audio_pipeline.py inventory
$PY pjm2-web/tools/assets/audio_pipeline.py decode            # [--budget N] [--only sfx,bgm]
# GlobalSounds map (requires inventory.json + manifest.json):
$PY pjm2-web/tools/assets/map_globalsounds.py
```

No PYTHONPATH needed (scripts self-insert `tools/assets/pylibs`). Dependencies already in
`/srv/opencode/venv-unity`: UnityPy 1.25.4, fmod_toolkit 0.1.3, pyfmodex 0.7.2 (+ bundled FMOD lib).

## 6. Blockers / notes for the sim session

- **None blocking.** WAV is larger than OGG (~404 MB vs est. ~40–60 MB OGG); if size matters,
  install ffmpeg and transcode (command in §2), or decode WAV at load time in the browser.
- Look up clips by `name` in `manifest.json`; duplicates across bundles are already merged.
- The two `sfx_menu_bestscore` variants are genuinely different clips — pick by duration/rate.
- Movie audio (54 mp4s) untouched; see §1.
