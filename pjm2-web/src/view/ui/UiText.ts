// src/view/ui/UiText.ts
// Localized UI text for the browser port, backed by the ORIGINAL game's string
// tables: Q4.TextDatabase ScriptableObjects (`labelList` rows {label, text})
// extracted from the `main_assets` Unity bundle by tools/assets/extract_ui_text.py
// into public/assets/ui/strings.json (English, 214 gameplay-relevant keys).
//
// Original lookup chain (decomp, DATA):
//   Q4.LocText.textLabel (serialized key, 0xE0)
//     -> Q4.TextDatabaseManager.GetText @0052bdc0
//     -> Q4.TextDatabase.GetTextdata @00537e60 (labelTable dictionary)
//   Missing key: the original returns string.Empty.
//
// TESTABILITY: pure functions over a plain Record<string,string>; the fetch is
// injectable (same structural pattern as src/view/audio/AudioManager.ts), so
// Node tests drive fakes — no DOM/network needed. UI text is cosmetic: nothing
// here ever throws; a failed load degrades to {} and t() falls back per key.
//
// VERIFIED vs BEST-EFFORT:
//   - Every key referenced below exists in strings.json with the English text
//     shown in its fallback (fallbacks mirror the verified data so the HUD
//     still reads correctly offline). Key provenance is in strings.meta.json.
//   - Composite layouts marked BEST-EFFORT (waveProgress, banner subs) have no
//     1:1 original text: the original HUD draws coin/gem/chibi counts as
//     icon+number (Q4.GameInfoController: UICounter coinCounter/gemCounter,
//     chibiText + totalChibiText "/{0}" @0044c6f0) and wave progress as an icon
//     bar (waveIndexImages), not sentences. We compose them from verified
//     labels for the text-only dev HUD.

export type StringTable = Record<string, string>;

/** Injectable fetch: resolves the response BODY TEXT (JSON) for a URL. */
export type UiTextFetch = (url: string) => Promise<string>;

const defaultFetch: UiTextFetch = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ui text fetch ${url}: ${res.status}`);
  return res.text();
};

/** Fetch + parse `<baseUrl>strings.json`. Failure (404, bad JSON, network)
 *  resolves {} — never throws, never blocks the game loop. Non-string values
 *  are dropped defensively. */
export async function loadStrings(
  baseUrl = '/assets/ui/',
  fetchImpl: UiTextFetch = defaultFetch,
): Promise<StringTable> {
  try {
    const raw = JSON.parse(await fetchImpl(`${baseUrl}strings.json`)) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: StringTable = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch (err) {
    console.warn('ui text: strings.json failed to load:', err);
    return {};
  }
}

/** Look up a key. Returns the table value when it is a non-empty string;
 *  otherwise `fallback`, or the key itself when no fallback is given.
 *  // TS ADAPTATION: the original GetText @0052bdc0 returns "" for unknown
 *  // keys; we surface the key/fallback instead so a missing string is visible
 *  // in the dev HUD rather than silently blank. */
export function t(table: StringTable, key: string, fallback?: string): string {
  const v = table[key];
  if (typeof v === 'string' && v !== '') return v;
  return fallback !== undefined ? fallback : key;
}

/** Strip original inline-icon/param tokens ({jump}, {button_08},
 *  {c_rainbow_01}, {replace_01}, …).
 *  // TS ADAPTATION: Q4.LocText renders these as inline icon sprites via
 *  // Q4.TextIconMap (UpdateTextIcons @00470c90); the web port has no icon
 *  // font yet, so tokens are removed until icon assets are wired. */
export function stripIcons(text: string): string {
  return text.replace(/\{[a-zA-Z0-9_]+\}/g, '').trim();
}

/** Wave-announcement key for a 1-based wave number.
 *  VERIFIED: StartCallMenuController serializes waveTextPrefix='tl_wave_call_'
 *  (globalsettings bundle) and Show @00528340 appends wave.ToString("D2"):
 *  wave 1 -> tl_wave_call_01 ('WAVE 1'). Wave 0 -> tl_wave_call_00 ('WAVE START',
 *  used by Show when the pre-first-wave call is shown). Numbers >20 have no
 *  table entry (tl_wave_call_21 is empty in the data) — t() falls back. */
export function waveCallKey(waveNumber: number): string {
  const n = waveNumber | 0; // C# int boundary
  return `tl_wave_call_${String(n).padStart(2, '0')}`;
}

/** Difficulty label key. VERIFIED: Q4.DifficultySettings ctor @007f5de0 stores
 *  tl_difficulty_001/002/003 at 0x30/0x38/0x40; GetDifficultyLabel @007f6470
 *  maps 0->Fun, 1->Tricky, 2->Mayhem, -1->tl_multiplay_011 ('All').
 *  NOTE: the original difficulties are Fun/Tricky/Mayhem, NOT Easy/Medium/Hard.
 *  // TS ADAPTATION: out-of-range values return the debug string 'Unknown
 *  // setting' in the original; we fall back to the Fun key instead. */
export function difficultyKey(difficulty: number): string {
  const d = difficulty | 0;
  if (d === -1) return 'tl_multiplay_011';
  if (d === 1) return 'tl_difficulty_002';
  if (d === 2) return 'tl_difficulty_003';
  return 'tl_difficulty_001';
}

/** The HUD fields our dev shell renders (game.ts updateHud / wireOutcome). */
export interface HudState {
  coins: number;
  gems: number;
  /** 1-based current wave (0 = pre-first-wave call). */
  wave: number;
  waveCount: number;
  chibis: number;
  chibiTotal: number;
  /** 0=Fun 1=Tricky 2=Mayhem; defaults to 0 (stage-1 demo default). */
  difficulty?: number;
  /** Stage label key; defaults to tl_stage_001 ('STAGE 1'). VERIFIED for
   *  3d_stage_001 via decomp/data/stage_scene_attribution.json. */
  stageKey?: string;
  /** Area label key; defaults to tl_area_001 ('Pockulu Forest'). VERIFIED. */
  areaKey?: string;
  outcome?: 'playing' | 'cleared' | 'gameover';
  /** All chibis survived -> perfect clear (StageResultMenuController.
   *  ShouldAwardPerfectClear drives the Perfect! result + sting). */
  perfect?: boolean;
}

export interface HudText {
  /** 'STAGE 1' — tl_stage_001 (stage-clear header, StageClearMenuController.Show
   *  @00522980 reads StageMain.stageName 0x40). */
  stage: string;
  /** 'Pockulu Forest' — tl_area_001 (StageMain.areaName 0x48). */
  area: string;
  /** 'Fun' / 'Tricky' / 'Mayhem' — tl_difficulty_00N. */
  difficulty: string;
  /** 'Coins' — tl_result_003 (result-screen label; in-game the original shows
   *  only icon+number via UICounter). */
  coinLabel: string;
  /** 'Gems' — tl_result_005. */
  gemLabel: string;
  /** 'Chibis Saved' — tl_result_008. */
  chibiLabel: string;
  coins: string;
  gems: string;
  /** 'N/20' — VERIFIED format: GameInfoController.DecrementChibiCounterOnKill
   *  @0044c6f0 sets chibiText=N and totalChibiText='/{0}'. */
  chibis: string;
  /** 'WAVE 3' — tl_wave_call_03 (wave-start call banner). */
  wave: string;
  /** BEST-EFFORT composite 'WAVE 3 / 10': the original draws a wave icon bar
   *  (GameInfoController.waveIndexImages), no text equivalent exists. */
  waveProgress: string;
  /** Outcome banner title: 'CLEAR' (tl_in_game_003), 'Perfect!'
   *  (tl_result_010), 'GAME OVER' (tl_gameover_001); null while playing. */
  bannerTitle: string | null;
  /** BEST-EFFORT composite from verified labels; null while playing. */
  bannerSub: string | null;
}

/** Map our HUD fields onto the best-matching original keys. Pure; safe with
 *  an empty table (every lookup carries a fallback mirroring the verified
 *  English text). */
export function hudStrings(table: StringTable, state: HudState): HudText {
  const difficulty = state.difficulty ?? 0;
  const wave = t(table, waveCallKey(state.wave), `WAVE ${state.wave | 0}`);
  const chibis = `${state.chibis | 0}/${state.chibiTotal | 0}`;
  const chibiLabel = t(table, 'tl_result_008', 'Chibis Saved');
  const outcome = state.outcome ?? 'playing';
  let bannerTitle: string | null = null;
  let bannerSub: string | null = null;
  if (outcome === 'cleared') {
    bannerTitle = state.perfect === true
      ? t(table, 'tl_result_010', 'Perfect!')
      : t(table, 'tl_in_game_003', 'CLEAR');
    bannerSub = `${chibiLabel} ${chibis}`;
  } else if (outcome === 'gameover') {
    bannerTitle = t(table, 'tl_gameover_001', 'GAME OVER');
    bannerSub = `${t(table, 'tl_result_007', 'Waves Cleared')} ${Math.max(0, (state.wave | 0) - 1)} / ${state.waveCount | 0}`;
  }
  return {
    stage: t(table, state.stageKey ?? 'tl_stage_001', 'STAGE 1'),
    area: t(table, state.areaKey ?? 'tl_area_001', 'Pockulu Forest'),
    difficulty: t(table, difficultyKey(difficulty), 'Fun'),
    coinLabel: t(table, 'tl_result_003', 'Coins'),
    gemLabel: t(table, 'tl_result_005', 'Gems'),
    chibiLabel,
    coins: String(state.coins | 0),
    gems: String(state.gems | 0),
    chibis,
    wave,
    waveProgress: `${wave} / ${state.waveCount | 0}`,
    bannerTitle,
    bannerSub,
  };
}

/** Pause/options/button labels for the shell (GameShell.ts). All VERIFIED
 *  keys; fallbacks mirror the extracted English. The original has no single
 *  "Mute" button — Options exposes Music / Sound Effects with ON/OFF
 *  (tl_option_004/005/018/019); map the shell's mute toggle onto those. */
export interface MenuText {
  pauseTitle: string;   // tl_pause_001 'PAUSE'
  resume: string;       // tl_pause_003 'Resume'
  retry: string;        // tl_pause_004 'Retry' (our "Restart")
  stageSelect: string;  // tl_pause_005 'Stage Select' (our "Quit")
  options: string;      // tl_pause_006 'Options'
  howToPlay: string;    // tl_pause_008 'How To Play'
  music: string;        // tl_option_004 'Music'
  soundEffects: string; // tl_option_005 'Sound Effects'
  on: string;           // tl_option_018 'ON'
  off: string;          // tl_option_019 'OFF'
  start: string;        // tl_help_015 'Start'
  back: string;         // tl_help_002 'Back'
  cancel: string;       // tl_help_003 'Cancel'
  yes: string;          // tl_dialog_001 'Yes'
  no: string;           // tl_dialog_002 'No'
  gotIt: string;        // tl_dialog_003 'Got it!'
  loading: string;      // tl_title_003 'LOADING'
  pressAnyButton: string; // tl_title_004 'Press any button'
}

export function menuStrings(table: StringTable): MenuText {
  return {
    pauseTitle: t(table, 'tl_pause_001', 'PAUSE'),
    resume: t(table, 'tl_pause_003', 'Resume'),
    retry: t(table, 'tl_pause_004', 'Retry'),
    stageSelect: t(table, 'tl_pause_005', 'Stage Select'),
    options: t(table, 'tl_pause_006', 'Options'),
    howToPlay: t(table, 'tl_pause_008', 'How To Play'),
    music: t(table, 'tl_option_004', 'Music'),
    soundEffects: t(table, 'tl_option_005', 'Sound Effects'),
    on: t(table, 'tl_option_018', 'ON'),
    off: t(table, 'tl_option_019', 'OFF'),
    start: t(table, 'tl_help_015', 'Start'),
    back: t(table, 'tl_help_002', 'Back'),
    cancel: t(table, 'tl_help_003', 'Cancel'),
    yes: t(table, 'tl_dialog_001', 'Yes'),
    no: t(table, 'tl_dialog_002', 'No'),
    gotIt: t(table, 'tl_dialog_003', 'Got it!'),
    loading: t(table, 'tl_title_003', 'LOADING'),
    pressAnyButton: t(table, 'tl_title_004', 'Press any button'),
  };
}

/** Wave-call accent lines (VERIFIED, serialized in StartCallMenuController):
 *  first wave -> accent_01 'Here they come!', mid waves -> accent_02 'More
 *  incoming!', final wave -> accent_03 'Last push!', wave cleared ->
 *  accent_04 'You made it!' (ShowWaveClear @005276b0). */
export function waveAccentKey(kind: 'first' | 'normal' | 'final' | 'cleared'): string {
  switch (kind) {
    case 'first': return 'tl_wave_call_accent_01';
    case 'normal': return 'tl_wave_call_accent_02';
    case 'final': return 'tl_wave_call_accent_03';
    case 'cleared': return 'tl_wave_call_accent_04';
  }
}
