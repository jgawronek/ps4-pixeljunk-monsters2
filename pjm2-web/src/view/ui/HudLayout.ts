// src/view/ui/HudLayout.ts
// Gameplay HUD layout — DOM reproduction of the original's "gameInfoHUD"
// screen furniture (Q4.GameInfoController), plus the stage-identity header
// and a contextual prompt line. Structure/icons/positioning only; all
// user-facing labels come from an injected HudStrings record (the UiText
// string table is owned by another module — defaults here are dev fallbacks).
//
// DECOMP EVIDENCE (decomp/decompiled + decomp/il2cpp/dump.cs — data, not code
// we execute; RVAs cited per PORTING_CONVENTIONS §5):
//  * Q4.GameInfoController IS the gameplay HUD: get_Instance @0044bd30
//    instantiates MenuDatabase.gameInfoHUD. dump.cs fields: chibiText,
//    totalChibiText, coinCounter, gemCounter, bonusCoinCounter,
//    waveIndexImages, allWaveIndexImages, waveIndexAnimator, waveBarAnimators,
//    monsterIcons, monsterIconTemplate, enemyBarTime, gameInfoAnimator.
//  * LateUpdate @0044cd20: coinCounter.Value = GetAvailableInventory(type 0)
//    minus the bonus-coin accumulator; gemCounter.Value =
//    GetAvailableInventory(type 1). → exactly TWO currency counters in the
//    gameplay HUD: coins + gems. (Medals exist only on the world map:
//    Q4.UI.StageSelectInventoryController.medalCounter/newMedalCounter.)
//  * DecrementChibiCounterOnKill @0044c6f0: chibiText = remaining chibi count,
//    totalChibiText = String.Format("/{0}", total) — literal "/{0}" at
//    string_literals.txt line 1968. → chibi counter is TWO text fields:
//    value + "/total". We mirror that split (chibiValue + chibiTotal spans).
//  * Update @0044c340 + UpdateMonsterBarIcons @0044c880: one
//    Q4.WaveBarMonsterIcon per waveProgressList entry (monster/balloon/boss
//    icon variants); started-but-not-arrived waves drive animator float
//    "PosBar" = per-wave progress; arrived waves go idle. Error string:
//    "You have more waves than icons, some waves will not show".
//    → wave progress is a per-wave icon bar. We approximate it with one
//    aggregate fill bar (HudState carries no per-wave progress).
//  * UpdateWaveIndexImages @0044cf40 + OnWaveActivated @0044ce00 ("NextNum"
//    trigger, one-frame-delayed number change): wave NUMBER shown as digit
//    sprites indexed currentWaveIndex-1+i. Q4.StartCallMenuController.Show
//    @00528340 formats the callout as waveTextPrefix + waveIndex.ToString("D2")
//    → zero-padded 2-digit wave numbers. We render text "NN/NN" (D2).
//  * Q4.UI.UICounter (ctor @005ce930, UpdateText @005ceb20): animated
//    count-up (m_changeCurve, 1s duration), m_showSign/m_hideIfZero options.
//    TS ADAPTATION: values snap immediately — no per-frame animator in DOM;
//    the count-up tween is cosmetic and can be layered on later.
//  * Stage identity: Q4.StartOutlineController fields areaNameText,
//    stageNameText, difficultyText, difficulty1/2/3Image — the original shows
//    stage name + difficulty at the stage INTRO, not as a persistent header;
//    difficulty labels come from Q4.DifficultySettings.GetDifficultyLabel
//    (easyLabel/mediumLabel/hardLabel). The task maps it to a top-left header.
//  * Contextual prompts: Q4.UIHelpBar (helpItemPrefab/helpItems, driven by
//    UIController.helpBarCanvasPrefab) and Q4.Toast.StageMainHidden (tutorial
//    toast sequence of walk/menu_confirm/menu_cancel commands) → bottom
//    prompt line via setPrompt().
//  * NOT screen HUD (world-space indicators, deliberately omitted):
//    Q4.UI.WaveTracker (arrow tracking the front enemy of the active wave,
//    "ShowEnemyComing" countdown), Q4.UI.HUDHipAttackIcon (per-enemy
//    "ShieldAttack" icon, Show @0048da60 — an indicator, not a meter),
//    Q4.FruitHud/FruitHudController/FruitNameHud (held-fruit remaining-uses
//    sprite + name label floating over towers).
//
// LAYOUT MAPPING (demo style from game.html .panel: rgba(0,0,0,.55), 8px
// radius, monospace, #ffd34d values, #cde labels):
//   top-left panel  → stage name + difficulty header, coin/gem counters
//                     (unicode icons ◉/◆), chibi value+"/total" (♥), kills.
//   top-right panel → "wave NN/NN" + small progress bar (width %).
//   bottom-center   → contextual prompt pill (setPrompt), hidden when null.
// FIDELITY CAVEATS: icons are unicode approximations of the original sprites;
// exact original screen positions are unknown without footage (the prefab
// layout is not recoverable from code alone); the per-wave monster-icon bar
// is collapsed into one aggregate bar; the bonus-coin popup panel
// (OnInventoryAdd @0044d390, "ShowCoinBonus") is not reproduced.
//
// TESTABILITY (GameShell pattern): nothing touches document at construction;
// attach(container) builds the whole tree and is the only DOM-required entry
// point (throws a clear error under Node). update() writes ONLY textContent
// and style.width on pre-built leaves — never innerHTML, never rebuilds.
// Cosmetic never-throw: update()/setPrompt() before attach() are silent
// no-ops (the prompt text is remembered and applied on attach).
//
// INTEGRATION (game.ts owns the sim loop): replace the #hud/#wave innerHTML
// writes in updateHud() with one HudLayout attached to #app:
//   const hud = new HudLayout(uiTextStrings); hud.attach(appEl);
//   hud.update({ coins, gems, chibisSaved: w.home.numChibi,
//     chibisTotal: w.home.numStartingChibi, kills,
//     wave: Math.min(w.waveManager.currentWaveIndex + 1, w.waveCount),
//     totalWaves: w.waveCount, stageName: 'tl_stage_001',
//     difficulty: 'Medium' });
// and route flash()/tutorial lines through hud.setPrompt().

export interface HudState {
  coins: number;
  gems: number;
  chibisSaved: number;
  chibisTotal: number;
  kills: number;
  /** 1-based current wave number (game.ts: min(currentWaveIndex+1, waveCount)). */
  wave: number;
  totalWaves: number;
  stageName: string;
  difficulty: string;
}

/** Label overrides — structurally compatible with the UiText strings record
 *  (another agent owns the table). Undefined fields fall back to dev defaults.
 *  `stage`/`difficulty` are optional PREFIX labels; the values themselves come
 *  from HudState. The "/total" separator is punctuation, not a string key
 *  (faithful to the original's hardcoded "/{0}" format). */
export interface HudStrings {
  coin?: string;
  gem?: string;
  wave?: string;
  chibis?: string;
  kills?: string;
  stage?: string;
  difficulty?: string;
}

/** Inline-style helper (Object.assign hits the CSS accessors in browsers
 *  and plain objects in the Node shim alike — GameShell.css pattern). */
function css(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

/** D2 zero-pad — Q4.StartCallMenuController.Show @00528340 uses
 *  waveIndex.ToString("D2"). UI-only value, plain JS numbers. */
function pad2(n: number): string {
  return Math.max(0, n | 0).toString().padStart(2, '0');
}

const COIN_ICON = '◉'; // approximates the original coin sprite
const GEM_ICON = '◆'; // approximates the original gem sprite
const CHIBI_ICON = '♥'; // heart stand-in for the chibi face icon
const VALUE_COLOR = '#ffd34d'; // game.html #hud b
const LABEL_COLOR = '#cde'; // game.html #banner small
const BAR_TRACK = '#1d2833'; // game.html #loading-track
const BAR_FILL = '#5db85d'; // game.html #loading-bar

export class HudLayout {
  private readonly labels: Required<HudStrings>;
  private attached = false;
  /** Remembered across attach/detach (GameShell.setMuted pattern). */
  private promptText: string | null = null;

  private stagePanel: HTMLDivElement | null = null;
  private wavePanel: HTMLDivElement | null = null;
  private promptPanel: HTMLDivElement | null = null;

  private stageNameEl: HTMLSpanElement | null = null;
  private difficultyEl: HTMLSpanElement | null = null;
  private coinValueEl: HTMLSpanElement | null = null;
  private gemValueEl: HTMLSpanElement | null = null;
  private chibiValueEl: HTMLSpanElement | null = null;
  private chibiTotalEl: HTMLSpanElement | null = null;
  private killsValueEl: HTMLSpanElement | null = null;
  private waveValueEl: HTMLSpanElement | null = null;
  private waveFillEl: HTMLDivElement | null = null;

  constructor(strings?: HudStrings) {
    // DOM-free: safe under Node.
    this.labels = {
      coin: strings?.coin ?? 'coins',
      gem: strings?.gem ?? 'gems',
      wave: strings?.wave ?? 'wave',
      chibis: strings?.chibis ?? 'chibis',
      kills: strings?.kills ?? 'kills',
      stage: strings?.stage ?? '',
      difficulty: strings?.difficulty ?? '',
    };
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Builds the three panels and appends them to `container` (e.g. #app).
   *  Idempotent. Throws only when there is no DOM at all (Node). */
  attach(container: HTMLElement): void {
    if (typeof document === 'undefined') {
      throw new Error(
        'HudLayout.attach(): document is undefined — browser DOM required ' +
          '(under Node, stub globalThis.document before attach)',
      );
    }
    if (this.attached) return;
    this.stagePanel = this.buildStagePanel();
    this.wavePanel = this.buildWavePanel();
    this.promptPanel = this.buildPromptPanel();
    container.appendChild(this.stagePanel);
    container.appendChild(this.wavePanel);
    container.appendChild(this.promptPanel);
    this.attached = true;
    this.applyPrompt(); // pre-attach setPrompt() survives attach
  }

  /** Removes all panels. Safe to call when not attached. The prompt text
   *  survives re-attach. */
  detach(): void {
    if (!this.attached) return;
    this.stagePanel?.remove();
    this.wavePanel?.remove();
    this.promptPanel?.remove();
    this.stagePanel = null;
    this.wavePanel = null;
    this.promptPanel = null;
    this.stageNameEl = null;
    this.difficultyEl = null;
    this.coinValueEl = null;
    this.gemValueEl = null;
    this.chibiValueEl = null;
    this.chibiTotalEl = null;
    this.killsValueEl = null;
    this.waveValueEl = null;
    this.waveFillEl = null;
    this.attached = false;
  }

  // ---- refresh -------------------------------------------------------------

  /** Refreshes counters. Writes ONLY textContent + style.width on pre-built
   *  leaves (no innerHTML, no DOM rebuilds). No-op before attach. */
  update(state: HudState): void {
    if (!this.attached) return;
    this.stageNameEl!.textContent = state.stageName;
    this.difficultyEl!.textContent = state.difficulty;
    this.coinValueEl!.textContent = `${state.coins}`;
    this.gemValueEl!.textContent = `${state.gems}`;
    // Faithful two-field chibi counter: chibiText + totalChibiText "/{0}"
    // (Q4.GameInfoController.DecrementChibiCounterOnKill @0044c6f0).
    this.chibiValueEl!.textContent = `${state.chibisSaved}`;
    this.chibiTotalEl!.textContent = `/${state.chibisTotal}`;
    this.killsValueEl!.textContent = `${state.kills}`;
    const wave = Math.max(0, state.wave | 0);
    const total = Math.max(0, state.totalWaves | 0);
    this.waveValueEl!.textContent = `${pad2(wave)}/${pad2(total)}`;
    // Aggregate stand-in for the per-wave WaveBarMonsterIcon "PosBar" fills.
    // Integer-first math + 2-decimal rounding keeps widths deterministic.
    const pct = total > 0 ? Math.min(100, (wave * 100) / total) : 0;
    this.waveFillEl!.style.width = `${Math.round(pct * 100) / 100}%`;
  }

  /** Contextual tutorial/banner line (UIHelpBar / StageMainHidden toast role).
   *  null or '' hides the line. Remembered when not attached. */
  setPrompt(text: string | null): void {
    this.promptText = text;
    if (this.attached) this.applyPrompt();
  }

  // ---- internals -----------------------------------------------------------

  private applyPrompt(): void {
    if (this.promptPanel === null) return;
    const text = this.promptText;
    const show = text !== null && text !== '';
    this.promptPanel.textContent = show ? text : '';
    this.promptPanel.style.display = show ? 'block' : 'none';
  }

  /** game.html .panel style, non-interactive (canvas keeps all input). */
  private makePanel(): HTMLDivElement {
    const p = document.createElement('div');
    css(p, {
      position: 'fixed',
      color: '#eee',
      font: '13px/1.5 monospace',
      background: 'rgba(0,0,0,0.55)',
      padding: '8px 12px',
      borderRadius: '8px',
      pointerEvents: 'none',
      zIndex: '15', // above canvas, below #banner (20) and GameShell (25)
    });
    return p;
  }

  private makeSpan(text: string, styles: Partial<CSSStyleDeclaration>): HTMLSpanElement {
    const s = document.createElement('span');
    s.textContent = text;
    css(s, styles);
    return s;
  }

  private makeRow(gap: string): HTMLDivElement {
    const r = document.createElement('div');
    css(r, { display: 'flex', alignItems: 'baseline', gap });
    return r;
  }

  /** Top-left: stage header + coin/gem + chibi + kills. */
  private buildStagePanel(): HTMLDivElement {
    const panel = this.makePanel();
    css(panel, { top: '10px', left: '10px' });

    // Stage identity header (StartOutlineController stageNameText/difficultyText
    // role, relocated to a persistent header per the port layout).
    const header = this.makeRow('8px');
    header.appendChild(this.makeSpan(this.labels.stage, { color: LABEL_COLOR }));
    this.stageNameEl = this.makeSpan('', { font: '700 15px/1.4 monospace', color: '#fff' });
    header.appendChild(this.stageNameEl);
    header.appendChild(this.makeSpan(this.labels.difficulty, { color: LABEL_COLOR, fontSize: '12px' }));
    this.difficultyEl = this.makeSpan('', { color: LABEL_COLOR, fontSize: '12px' });
    header.appendChild(this.difficultyEl);
    panel.appendChild(header);

    // Currency counters (GameInfoController.LateUpdate @0044cd20: coinCounter
    // + gemCounter, each a UICounter text beside an icon image in the prefab).
    const currencies = this.makeRow('12px');
    css(currencies, { marginTop: '4px' });
    const coinGroup = this.makeRow('4px');
    coinGroup.appendChild(this.makeSpan(COIN_ICON, { color: VALUE_COLOR }));
    this.coinValueEl = this.makeSpan('0', { color: VALUE_COLOR, fontWeight: '700' });
    coinGroup.appendChild(this.coinValueEl);
    coinGroup.appendChild(this.makeSpan(this.labels.coin, { color: LABEL_COLOR }));
    const gemGroup = this.makeRow('4px');
    gemGroup.appendChild(this.makeSpan(GEM_ICON, { color: '#8fd3ff' })); // gem tint approximated
    this.gemValueEl = this.makeSpan('0', { color: VALUE_COLOR, fontWeight: '700' });
    gemGroup.appendChild(this.gemValueEl);
    gemGroup.appendChild(this.makeSpan(this.labels.gem, { color: LABEL_COLOR }));
    currencies.appendChild(coinGroup);
    currencies.appendChild(gemGroup);
    panel.appendChild(currencies);

    // Chibi rescue counter: value + "/total" as separate spans (chibiText /
    // totalChibiText). Demo addition: kills (original shows kills only in the
    // results menu, but the demo HUD tracks them live).
    const chibiRow = this.makeRow('4px');
    chibiRow.appendChild(this.makeSpan(CHIBI_ICON, { color: '#ff8fa8' }));
    this.chibiValueEl = this.makeSpan('0', { color: VALUE_COLOR, fontWeight: '700' });
    this.chibiTotalEl = this.makeSpan('/0', { color: LABEL_COLOR });
    chibiRow.appendChild(this.chibiValueEl);
    chibiRow.appendChild(this.chibiTotalEl);
    chibiRow.appendChild(this.makeSpan(this.labels.chibis, { color: LABEL_COLOR }));
    panel.appendChild(chibiRow);

    const killsRow = this.makeRow('4px');
    killsRow.appendChild(this.makeSpan(this.labels.kills, { color: LABEL_COLOR }));
    this.killsValueEl = this.makeSpan('0', { color: VALUE_COLOR, fontWeight: '700' });
    killsRow.appendChild(this.killsValueEl);
    panel.appendChild(killsRow);

    return panel;
  }

  /** Top-right: wave number (D2) + aggregate progress bar. */
  private buildWavePanel(): HTMLDivElement {
    const panel = this.makePanel();
    css(panel, { top: '10px', right: '10px', textAlign: 'right' });

    const row = this.makeRow('6px');
    css(row, { justifyContent: 'flex-end' });
    row.appendChild(this.makeSpan(this.labels.wave, { color: LABEL_COLOR }));
    this.waveValueEl = this.makeSpan('00/00', { color: VALUE_COLOR, fontWeight: '700' });
    row.appendChild(this.waveValueEl);
    panel.appendChild(row);

    // Track/fill colors follow game.html #loading-track/#loading-bar.
    const track = document.createElement('div');
    css(track, {
      width: '140px',
      height: '6px',
      background: BAR_TRACK,
      borderRadius: '3px',
      overflow: 'hidden',
      marginTop: '4px',
      marginLeft: 'auto',
    });
    this.waveFillEl = document.createElement('div');
    css(this.waveFillEl, {
      width: '0%',
      height: '100%',
      background: BAR_FILL,
      transition: 'width 0.15s ease-out',
    });
    track.appendChild(this.waveFillEl);
    panel.appendChild(track);

    return panel;
  }

  /** Bottom-center contextual prompt (game.html #msg placement). */
  private buildPromptPanel(): HTMLDivElement {
    const panel = this.makePanel();
    css(panel, {
      bottom: '12%',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      color: VALUE_COLOR,
      font: '15px/1.5 monospace',
      textAlign: 'center',
      maxWidth: '80%',
    });
    return panel;
  }
}
