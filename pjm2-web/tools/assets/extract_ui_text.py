#!/usr/bin/env python3
"""
extract_ui_text.py — Q4.TextDatabase UI string tables -> public/assets/ui/strings.json.

WHERE THE STRINGS LIVE (verified):
  The original loads localized UI text via Q4.TextDatabaseManager.LoadTextdataBase
  (decomp/decompiled/Q4.TextDatabaseManager.c @00538380): it scans available asset
  bundles for names containing "ui_mess" + <language> + ".asset". In THIS PS4 build
  (CUSA11967) those tables are packed inside the `main_assets` bundle as
  TextDatabase ScriptableObjects named e.g. `common_en`, `dialog_en`, `guide_en`,
  `loading_en` (asset paths Assets/Art_Assets/UI/Mess/<Category>/<name>.asset —
  see main_assets.manifest). Each TextDatabase serializes a `labelList` of
  TextData rows {label, fontList, text} (Q4.TextDatabase.c: List<TextData> @0x18,
  labelTable Dictionary<string,TextData> @0x20; Q4.LocText resolves its
  serialized `textLabel` through TextDatabaseManager.GetText @0052bdc0).

  This script reads those typetrees directly with UnityPy — no CSV involved
  (TextDatabase.LoadLable @00537a00 is a dev-only CSV import path).

LANGUAGE: English only. Plain `_en` tables are used; `_en_gb` regional overrides
  were inspected and differ only in font-atlas/title/sign entries (no gameplay
  wording), so they are skipped. Non-English tables are ignored.

FILTER (stage-1 gameplay HUD relevance — the full tables are ~900 rows):
  common_en : keep prefixes tl_title_, tl_pause_, tl_result_, tl_gameover_,
              tl_in_game_, tl_wave_call_, tl_hud_, tl_area_, tl_stage_,
              tl_difficulty_, tl_stage_start_, tl_ring_tower_, tl_controls_
              (subset 003/004/006/007/008/010), tl_tower_name_ (001–012 only;
              013–016 are untranslated Japanese placeholders 'タワー013'…),
              plus explicit keys tl_help_001/002/003/004/015/016,
              tl_dialog_001/002/003, tl_option_001/002/004/005/018/019,
              tl_reward_000/001, tl_multiplay_011 ('All' difficulty label).
  dialog_en : keep tl_mini_dialog_text_* (in-stage tutorial popups) EXCEPT
              013/014 (DLC-specific: Encore Peak / Monokuma), plus explicit
              tl_dialog_text_005/006/013/015/016/033/034/036/046 (stage-start
              confirm, all-clear, boss warning, last-chibi warning, retry/quit
              confirms, manual prompt, skip-to-result).
  guide_en  : keep tl_guide_cat_* (category names), the "What's This Game
              About?" tutorial (title/detail_01_*), "Tower Basics"
              (title/detail_09_*), and the Tikiman movement intro
              (title/detail_02_01).
  loading_en: keep all tl_loading_tips_* (loading-screen help text).
  Everywhere: drop empty text and ideographic-space-only text (sign names),
              drop ft_test_* / tl_global_* font-atlas rows.
  Skipped tables: shop/credit/trophy/test/reward medal details/dlc_01/dlc_02
              (customization, credits, trophies, font tests, DLC — not HUD).

OUTPUT:
  public/assets/ui/strings.json      flat {key: text} (English, newline-preserving)
  public/assets/ui/strings.meta.json provenance: bundle, per-table asset path +
                                     path_id + row counts, per-key source table,
                                     filter description, decomp cross-references.

Usage: /srv/opencode/venv-unity/bin/python tools/assets/extract_ui_text.py
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))

import UnityPy  # noqa: E402

BASE = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'pjm2-web', 'public', 'assets', 'ui')

# Merge order = lookup priority (keys are unique across these tables in practice).
TABLES = ('common_en', 'dialog_en', 'guide_en', 'loading_en', 'credit_en')
ASSET_PATH = {
    'common_en': 'Assets/Art_Assets/UI/Mess/Common/common_en.asset',
    'dialog_en': 'Assets/Art_Assets/UI/Mess/Dialog/dialog_en.asset',
    'guide_en': 'Assets/Art_Assets/UI/Mess/Guide/guide_en.asset',
    'loading_en': 'Assets/Art_Assets/UI/Mess/Loading/loading_en.asset',
    'credit_en': 'Assets/Art_Assets/UI/Mess/Credit/credit_en.asset',
}

COMMON_PREFIXES = (
    'tl_title_', 'tl_pause_', 'tl_result_', 'tl_gameover_', 'tl_in_game_',
    'tl_wave_call_', 'tl_hud_', 'tl_area_', 'tl_stage_', 'tl_difficulty_',
    'tl_stage_start_', 'tl_ring_tower_',
    # build ring menu (Q4.UI.RingStateBuildCategory/TowerIcon): category + tower captions
    'tl_ring_building_cat_', 'tl_ring_',
    # title / option menu / controls / help bar (Q4.TitleScreenController, OptionMenuController)
    'tl_option_', 'tl_help_', 'tl_controls_',
)
COMMON_EXPLICIT = {
    'tl_help_001', 'tl_help_002', 'tl_help_003', 'tl_help_004',
    'tl_help_015', 'tl_help_016',
    'tl_dialog_001', 'tl_dialog_002', 'tl_dialog_003',
    'tl_option_001', 'tl_option_002', 'tl_option_004', 'tl_option_005',
    'tl_option_018', 'tl_option_019',
    'tl_reward_000', 'tl_reward_001',
    'tl_multiplay_011',
    'tl_controls_003', 'tl_controls_004', 'tl_controls_006',
    'tl_controls_007', 'tl_controls_008', 'tl_controls_010',
    # pause menu extra row (pause_01 Mess_Loc_Sel_02) + in-game build/menu prompts
    'tl_option_021', 'tl_controls_001', 'tl_controls_002', 'tl_controls_005', 'tl_controls_009',
}
DIALOG_EXPLICIT = {
    'tl_dialog_text_005', 'tl_dialog_text_006', 'tl_dialog_text_013',
    'tl_dialog_text_015', 'tl_dialog_text_016', 'tl_dialog_text_033',
    'tl_dialog_text_034', 'tl_dialog_text_036', 'tl_dialog_text_046',
    # option menu save/reset confirms, first-play manual prompt + follow-up
    'tl_dialog_text_001', 'tl_dialog_text_002', 'tl_dialog_text_038',
}
DIALOG_MINI_EXCLUDE = {'tl_mini_dialog_text_013', 'tl_mini_dialog_text_014'}
GUIDE_KEEP_SERIES = ('01', '09')  # game basics + tower basics (title+detail)


def keep(table, key):
    if table == 'common_en':
        if key.startswith(COMMON_PREFIXES):
            return True
        if key.startswith('tl_tower_name_'):
            # 001–012 are real English names; 013–016 are JP placeholders.
            return key <= 'tl_tower_name_012'
        return key in COMMON_EXPLICIT
    if table == 'dialog_en':
        if key.startswith('tl_mini_dialog_text_'):
            return key not in DIALOG_MINI_EXCLUDE
        return key in DIALOG_EXPLICIT
    if table == 'guide_en':
        if key.startswith('tl_guide_cat_'):
            return True
        if key in ('tl_guide_title_02_01', 'tl_guide_detail_02_01'):
            return True
        for s in GUIDE_KEEP_SERIES:
            if key.startswith(f'tl_guide_title_{s}_') or key.startswith(f'tl_guide_detail_{s}_'):
                return True
        return False
    if table == 'loading_en':
        return key.startswith('tl_loading_tips_')
    if table == 'credit_en':
        return key.startswith(('tl_credit_title_', 'tl_credit_name_'))
    return False


def usable(text):
    # Empty rows and ideographic-space-only rows (tl_sign_name_*) carry no UI text.
    return isinstance(text, str) and text.strip() not in ('', '\u3000')


def main():
    env = UnityPy.load(os.path.join(BASE, 'main_assets'))
    script_pid = None
    for o in env.objects:
        if o.type.name == 'MonoScript':
            try:
                d = o.read()
                if getattr(d, 'm_ClassName', '') == 'TextDatabase':
                    script_pid = o.path_id
            except Exception:
                pass
    if script_pid is None:
        raise RuntimeError('TextDatabase MonoScript not found in main_assets')

    tables = {}
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            d = o.read()
            if getattr(getattr(d, 'm_Script', None), 'path_id', None) != script_pid:
                continue
            name = getattr(d, 'm_Name', '')
            if name not in TABLES:
                continue
            tt = o.read_typetree()
            rows = tt.get('labelList', [])
            tables[name] = {
                'path_id': o.path_id,
                'rows': len(rows),
                'entries': {e['label']: e['text'] for e in rows},
            }
        except Exception as e:
            print(f'WARNING: skipping object: {e}')
    missing = [t for t in TABLES if t not in tables]
    if missing:
        raise RuntimeError(f'TextDatabase tables missing from main_assets: {missing}')

    strings = {}
    key_source = {}
    dropped = {'filtered': 0, 'empty': 0, 'duplicate': 0}
    for name in TABLES:
        for key, text in tables[name]['entries'].items():
            if not keep(name, key):
                dropped['filtered'] += 1
                continue
            if not usable(text):
                dropped['empty'] += 1
                continue
            if key in strings:
                dropped['duplicate'] += 1
                continue
            strings[key] = text
            key_source[key] = name

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'strings.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(strings.items())), f, ensure_ascii=False, indent=1)
        f.write('\n')

    meta = {
        'source': 'Q4.TextDatabase ScriptableObjects (labelList rows) in the '
                  'main_assets Unity bundle, CUSA11967 PS4 build',
        'bundle': 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/main_assets',
        'language': 'en (plain _en tables; _en_gb overrides inspected — no gameplay wording differences)',
        'tables': {
            name: {
                'asset': ASSET_PATH[name],
                'path_id': tables[name]['path_id'],
                'totalRows': tables[name]['rows'],
                'exportedRows': sum(1 for v in key_source.values() if v == name),
            } for name in TABLES
        },
        'keyCount': len(strings),
        'dropped': dropped,
        'filter': __doc__.split('FILTER (')[1].split('OUTPUT:')[0].strip(),
        'keySource': dict(sorted(key_source.items())),
        'decompReferences': {
            'TextDatabase.GetTextdata': 'Q4.TextDatabase.c @00537e60 (labelTable lookup)',
            'TextDatabaseManager.GetText': 'Q4.TextDatabaseManager.c @0052bdc0 (returns "" on missing key)',
            'TextDatabaseManager.LoadTextdataBase': 'Q4.TextDatabaseManager.c @00538380 (ui_mess*<lang>*.asset scan)',
            'LocText.textLabel': 'Q4.LocText.c @00470c90 region (serialized key -> GetText; {icon} tokens -> TextIconMap sprites)',
            'waveTextPrefix=tl_wave_call_': 'globalsettings StartCallMenuController MonoBehaviour (serialized) + Show @00528340 (prefix + wave.ToString("D2"))',
            'waveClear accent': 'StartCallMenuController.ShowWaveClear @005276b0 uses tl_wave_call_accent_04',
            'difficulty labels': 'Q4.DifficultySettings.c ctor @007f5de0 (0x30/0x38/0x40 = tl_difficulty_001/002/003) + GetDifficultyLabel @007f6470',
            'stage/area labels': 'decomp/data/stage_scene_attribution.json (3d_stage_001 -> tl_stage_001 / tl_area_001) + AreaStageInfoMap',
            'chibi counter format': 'Q4.GameInfoController.DecrementChibiCounterOnKill @0044c6f0 (chibiText=N, totalChibiText="/{0}")',
        },
        'notes': [
            'All exported values are VERIFIED from serialized game data (no best-effort strings).',
            'Newlines are preserved as in the original tables (multi-line banners/guide text).',
            '{jump}/{button_08}/{c_rainbow_01}/{replace_NN} tokens are original icon/param '
            'placeholders (LocText renders them as inline sprites); the web port strips or '
            'substitutes them (see src/view/ui/UiText.ts).',
            'Difficulty names are Fun/Tricky/Mayhem — NOT Easy/Medium/Hard.',
        ],
    }
    with open(os.path.join(OUT, 'strings.meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'exported {len(strings)} keys -> {os.path.join(OUT, "strings.json")}')
    for name in TABLES:
        n = sum(1 for v in key_source.values() if v == name)
        print(f'  {name}: {n} keys (of {tables[name]["rows"]} rows, path_id={tables[name]["path_id"]})')
    print('dropped:', dropped)


if __name__ == '__main__':
    main()
