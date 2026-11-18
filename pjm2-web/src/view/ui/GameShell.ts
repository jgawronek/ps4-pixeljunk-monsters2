// src/view/ui/GameShell.ts
// Phase 4 game-shell overlays: pause menu + stage-results screen, DOM-based.
// Visual style matches game.html's HUD/banner (dark translucent panels,
// rgba(0,0,0,.55), 8px radius, monospace, white text with #ffd34d accents).
// All styling is INLINE so the module needs no stylesheet and the Node test
// shim stays tiny (createElement + appendChild + textContent + style +
// addEventListener + remove — no innerHTML, no querySelector).
//
// TESTABILITY (AudioManager pattern): nothing touches document/window at
// construction; attach() builds the whole tree and is the only DOM-required
// entry point (throws a clear error under Node). Tests stub
// globalThis.document/.window with a minimal fake. Cosmetic never-throw:
// show/hide calls before attach() are silent no-ops, never exceptions.
//
// INTEGRATION (game.ts owns the sim loop): while `shell.paused` is true the
// integrator must skip driver.step()/tickPlayerMovement — the shell only
// blocks POINTER input via the backdrop. Feed showResults() from
// Events.stageClearedEvent / Events.gameOverEvent. Button semantics:
//   Resume  → hidePause() + onResume()
//   Restart → hidePause() + hideResults() + onRestart()
//   Mute    → onToggleMute() once; label updated from its return value
//   Quit    → hidePause() + onQuitToTitle() (button only exists if given)

export interface ShellCallbacks {
  onResume: () => void;
  onRestart: () => void;
  /** Returns the NEW muted state (the shell's label follows it). */
  onToggleMute: () => boolean;
  /** Optional; the Quit button is omitted when absent. */
  onQuitToTitle?: () => void;
  /** Optional original-art skin (OriginalScreens): when present it draws the
   *  pause/results screens and the shell's own DOM overlays stay hidden; the
   *  shell keeps the paused/results state machine and the Esc key. */
  skin?: ShellSkin;
}

export interface ShellSkin {
  showPause(): void;
  hidePause(): void;
  showResults(data: ResultsData): void;
  hideResults(): void;
}

/** StageResultMenuController score block (ComputeScore + best record; see ResultScore.ts). */
export interface ResultScoreData {
  score: number;
  /** SaveData.GetStageRecord after UpdateStageRecord. */
  bestScore: number;
  /** GetEndOfGameStatistics interest coins ("Bonus" row, tl_result_004). */
  interestCoins: number;
  /** ScoreSettings.clearBonus ("Clear Bonus" row, tl_result_006). */
  clearBonus: number;
  /** UpdateStageRecord returned true -> "New!" + NewRecord SFX at the end of the count-up. */
  newRecord: boolean;
}

export interface ResultsData {
  /** Present on a CLEAR when the host computed the original score block (count-up screen). */
  score?: ResultScoreData;
  won: boolean;
  perfect: boolean;
  wavesCleared: number;
  totalWaves: number;
  kills: number;
  coinsEarned: number;
  gemsEarned: number;
  chibisSaved: number;
  chibisTotal: number;
  timeSeconds: number;
}

/** m:ss (minutes uncapped, seconds zero-padded; negative clamps to 0:00).
 *  UI-only value — plain JS numbers, no fp32 discipline needed. */
function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Inline-style helper (Object.assign hits the CSS accessors in browsers
 *  and plain objects in the Node shim alike). */
function css(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

const MUTE_ON = '🔊 Sound';
const MUTE_OFF = '🔇 Muted';
const PERFECT_BADGE = '★ PERFECT ★';
const BUTTON_BG = '#5db85d'; // game.html #start
const BUTTON_BG_HOVER = '#6fd86f';

export class GameShell {
  private readonly callbacks: ShellCallbacks;
  private attached = false;
  private pausedFlag = false;
  private resultsFlag = false;
  private mutedFlag = false;

  private pauseOverlay: HTMLDivElement | null = null;
  private resultsOverlay: HTMLDivElement | null = null;
  private muteButton: HTMLButtonElement | null = null;
  private resultsHeader: HTMLSpanElement | null = null;
  private perfectBadge: HTMLSpanElement | null = null;
  /** stat label → value <span> (filled by showResults). */
  private readonly statValues = new Map<string, HTMLSpanElement>();

  constructor(callbacks: ShellCallbacks) {
    this.callbacks = callbacks; // DOM-free: safe under Node
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Builds both overlays (hidden) and appends them to document.body.
   *  Idempotent. Throws only when there is no DOM at all (Node). */
  attach(): void {
    if (typeof document === 'undefined') {
      throw new Error(
        'GameShell.attach(): document is undefined — browser DOM required ' +
          '(under Node, stub globalThis.document/window before attach)',
      );
    }
    if (this.attached) return;
    this.pauseOverlay = this.buildPauseOverlay();
    this.resultsOverlay = this.buildResultsOverlay();
    document.body.appendChild(this.pauseOverlay);
    document.body.appendChild(this.resultsOverlay);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
    this.attached = true;
  }

  /** Removes the overlays + key listener and resets pause/results state.
   *  Safe to call when not attached. Mute state survives re-attach. */
  detach(): void {
    if (!this.attached) return;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.pauseOverlay?.remove();
    this.resultsOverlay?.remove();
    this.pauseOverlay = null;
    this.resultsOverlay = null;
    this.muteButton = null;
    this.resultsHeader = null;
    this.perfectBadge = null;
    this.statValues.clear();
    this.attached = false;
    this.pausedFlag = false;
    this.resultsFlag = false;
  }

  // ---- pause ---------------------------------------------------------------

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** No-op before attach or while results are visible (results own the screen). */
  showPause(): void {
    if (!this.attached || this.resultsFlag || this.pausedFlag || this.pauseOverlay === null) return;
    this.pausedFlag = true;
    if (this.callbacks.skin !== undefined) this.callbacks.skin.showPause();
    else this.showOverlay(this.pauseOverlay);
  }

  hidePause(): void {
    if (!this.pausedFlag || this.pauseOverlay === null) return;
    this.pausedFlag = false;
    if (this.callbacks.skin !== undefined) this.callbacks.skin.hidePause();
    else this.hideOverlay(this.pauseOverlay);
  }

  togglePause(): void {
    if (this.pausedFlag) this.hidePause();
    else this.showPause();
  }

  // ---- results -------------------------------------------------------------

  get resultsVisible(): boolean {
    return this.resultsFlag;
  }

  /** Fills + shows the results screen; an open pause menu is hidden first. */
  showResults(data: ResultsData): void {
    if (!this.attached || this.resultsOverlay === null) return;
    if (this.pausedFlag) this.hidePause();
    this.resultsFlag = true;
    this.resultsHeader!.textContent = data.won ? 'STAGE CLEAR!' : 'GAME OVER';
    this.perfectBadge!.style.display = data.perfect ? 'block' : 'none';
    this.setStat('waves', `${data.wavesCleared}/${data.totalWaves}`);
    this.setStat('kills', `${data.kills}`);
    this.setStat('coins', `${data.coinsEarned}`);
    this.setStat('gems', `${data.gemsEarned}`);
    this.setStat('chibis saved', `${data.chibisSaved}/${data.chibisTotal}`);
    this.setStat('time', formatTime(data.timeSeconds));
    if (this.callbacks.skin !== undefined) this.callbacks.skin.showResults(data);
    else this.showOverlay(this.resultsOverlay);
  }

  hideResults(): void {
    if (!this.resultsFlag || this.resultsOverlay === null) return;
    this.resultsFlag = false;
    if (this.callbacks.skin !== undefined) this.callbacks.skin.hideResults();
    else this.hideOverlay(this.resultsOverlay);
  }

  // ---- mute ----------------------------------------------------------------

  /** Updates the mute button label (and remembers the state across
   *  detach/attach). Does NOT invoke onToggleMute. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.muteButton !== null) this.muteButton.textContent = muted ? MUTE_OFF : MUTE_ON;
  }

  // ---- internals -----------------------------------------------------------

  /** Esc toggles pause only while attached and results are not visible.
   *  Arrow-field so add/removeEventListener share one reference. */
  private readonly onKeyDown = (e: Event): void => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    if (!this.attached || this.resultsFlag) return;
    this.togglePause();
  };

  private setStat(label: string, value: string): void {
    const el = this.statValues.get(label);
    if (el !== undefined) el.textContent = value;
  }

  /** Full-screen translucent backdrop (game.html #banner style). Hidden =
   *  display:none + pointer-events:none so the canvas keeps receiving input.
   *  The opacity transition is the CSS fade; display switches immediately
   *  (no timers — keeps the Node shim minimal; cosmetic best-effort). */
  private makeOverlay(): HTMLDivElement {
    const o = document.createElement('div');
    css(o, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      font: '14px/1.5 monospace',
      zIndex: '25', // above #banner (20), below #loading (30)
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0.15s ease',
    });
    return o;
  }

  private showOverlay(o: HTMLDivElement): void {
    o.style.display = 'flex';
    o.style.opacity = '1';
    o.style.pointerEvents = 'auto'; // backdrop blocks canvas input
  }

  private hideOverlay(o: HTMLDivElement): void {
    o.style.opacity = '0';
    o.style.display = 'none';
    o.style.pointerEvents = 'none';
  }

  /** Centered dark panel (game.html .panel style, interactive variant). */
  private makePanel(): HTMLDivElement {
    const p = document.createElement('div');
    css(p, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      background: 'rgba(0,0,0,0.55)',
      borderRadius: '8px',
      padding: '24px 32px',
      minWidth: '280px',
      textAlign: 'center',
    });
    return p;
  }

  private makeTitle(text: string, sizePx: number): HTMLSpanElement {
    const t = document.createElement('span');
    t.textContent = text;
    css(t, {
      font: `700 ${sizePx}px/1.3 monospace`,
      textShadow: '0 2px 12px #000',
    });
    return t;
  }

  /** game.html #start style. Clicks stopPropagation (never reach the canvas)
   *  and invoke the action exactly once. */
  private makeButton(label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    css(b, {
      padding: '10px 26px',
      font: '700 16px monospace',
      background: BUTTON_BG,
      color: '#04120a',
      border: '0',
      borderRadius: '8px',
      cursor: 'pointer',
      minWidth: '220px',
    });
    b.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      action();
    });
    b.addEventListener('mouseenter', () => { b.style.background = BUTTON_BG_HOVER; });
    b.addEventListener('mouseleave', () => { b.style.background = BUTTON_BG; });
    return b;
  }

  private buildPauseOverlay(): HTMLDivElement {
    const overlay = this.makeOverlay();
    const panel = this.makePanel();
    panel.appendChild(this.makeTitle('PAUSED', 32));
    panel.appendChild(this.makeButton('Resume', () => {
      this.hidePause();
      this.callbacks.onResume();
    }));
    panel.appendChild(this.makeButton('Restart', () => {
      this.hidePause();
      this.hideResults();
      this.callbacks.onRestart();
    }));
    this.muteButton = this.makeButton(this.mutedFlag ? MUTE_OFF : MUTE_ON, () => {
      this.setMuted(this.callbacks.onToggleMute());
    });
    panel.appendChild(this.muteButton);
    const quit = this.callbacks.onQuitToTitle;
    if (quit !== undefined) {
      panel.appendChild(this.makeButton('Quit', () => {
        this.hidePause();
        quit();
      }));
    }
    overlay.appendChild(panel);
    return overlay;
  }

  private buildResultsOverlay(): HTMLDivElement {
    const overlay = this.makeOverlay();
    const panel = this.makePanel();
    this.resultsHeader = this.makeTitle('', 42); // banner-sized header
    panel.appendChild(this.resultsHeader);
    this.perfectBadge = document.createElement('span');
    this.perfectBadge.textContent = PERFECT_BADGE;
    css(this.perfectBadge, {
      display: 'none',
      color: '#ffd34d',
      font: '700 18px/1.4 monospace',
      textShadow: '0 2px 12px #000',
    });
    panel.appendChild(this.perfectBadge);
    for (const label of ['waves', 'kills', 'coins', 'gems', 'chibis saved', 'time']) {
      this.addStatRow(panel, label);
    }
    // Results screen: Restart only (no Resume — the stage is over).
    panel.appendChild(this.makeButton('Restart', () => {
      this.hidePause();
      this.hideResults();
      this.callbacks.onRestart();
    }));
    overlay.appendChild(panel);
    return overlay;
  }

  private addStatRow(panel: HTMLDivElement, label: string): void {
    const row = document.createElement('div');
    css(row, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '24px',
      width: '100%',
      font: '14px/1.8 monospace',
    });
    const l = document.createElement('span');
    l.textContent = label;
    css(l, { color: '#cde' }); // banner-sub tone
    const v = document.createElement('span');
    css(v, { color: '#ffd34d', fontWeight: '700' }); // hud accent
    row.appendChild(l);
    row.appendChild(v);
    panel.appendChild(row);
    this.statValues.set(label, v);
  }
}
