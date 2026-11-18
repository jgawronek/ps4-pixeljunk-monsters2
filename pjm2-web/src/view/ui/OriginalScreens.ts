// src/view/ui/OriginalScreens.ts
// Pause menu, stage-result and game-over screens drawn with the original art
// (prefabs pause_01 / result_01 / game_over_01 = Q4.PauseMenuController /
// Q4.StageResultMenuController / Q4.GameOverMenuController). Plugs into
// GameShell through its optional `skin` (the shell keeps the pause/results state
// machine + Esc handling; this class only draws).
//
// Layout numbers (1920x1080 reference, y down; docs/GAME_UI_ANALYSIS.md section 5):
//  pause_01  : "PAUSE" Font_02 scale 0.76 @ (960,283); "Pause" Font_01 blue
//              (0.15,0.73,1) scale 0.93 @ (960,195); Pause_Menu_GRP = vertical
//              list, spacing 82, first entry y=436, 7 entries in the prefab:
//              Resume(tl_pause_003) Retry(004) EndLocalMulti(tl_option_021, 2P only)
//              StageSelect(005) Options(006) TitleScreen(007) HowToPlay(008);
//              stage card pause_stage_bg (434x234) @ (286,176): area (283,113),
//              stage (284,167), difficulty (284,230), Font_01 scale 0.8/0.8/0.85.
//              Unselected entries tint (0.68); selected = white (UIButton/Animator pause_sel_ctrl).
//  game_over_01: "GAME OVER" Font_02 @ (960,358); tl_gameover_002 (blank in en) @ (960,243)
//              blue; menu: Retry(004) / StageSelect(005) / TitleScreen(007), spacing 84, y=555.
//  result_01 : result_bg 1686x306 @ (960,696); header area @ (968,215), stage Font_02 0.76 @
//              (960,311), difficulty @ (968,406); separator result_line @ (960,624);
//              left column labels x=144 / values right-aligned x=881 at y 577/669/737/805
//              (Score, Coins, Gems, Waves Cleared); right column labels x=1041 / values
//              right x=1778 (Best Score, Bonus, Clear Bonus, Chibis Saved);
//              "New!" @ (889,553) orange (0.88,0.24,0); perfect_big_img @ (1533,311) + "Perfect!".
// PORT SUBSET: title screen / local multiplayer entries do not exist in the web shell and are omitted.
// STAGE RESULT SCORE BLOCK (Score / Best Score / Bonus / Clear Bonus + 3 s count-up, skip on confirm, "New!",
// Perfect badge at the end) is ported from Q4.StageResultMenuController (see ResultScore.ts); it is drawn when
// the host supplies ResultsData.score. After the count-up: Stage Select (default, = OnConfirm ->
// WorldMap.LoadWorldMap), Next stage, Retry.

import type { ResultsData } from './GameShell';
import { CountUp, type CountUpFrame } from './ResultScore';
import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, TEXT, textEl, UiRoot } from './UiDom';
import type { StringLookup } from './WaveCalls';

export interface ScreensCallbacks {
  onResume(): void;
  onRetry(): void;
  /** Options entry: returns the new muted state (port: sound toggle). */
  onToggleMute(): boolean;
  /** Result screen -> stage select (StageResultMenuController.OnConfirm -> WorldMap.LoadWorldMap). */
  onStageSelect?(): void;
  /** Result screen -> next stage in AreaStageInfoMap order (undefined = entry hidden). */
  onNextStage?(): void;
  /** Count-up SFX hooks (GlobalSounds.ScoreCountUp each frame, GameClearRainbow, NewRecord). */
  onResultSfx?(kind: 'scoreCountUp' | 'rainbow' | 'newRecord'): void;
}

export interface StageIdentity {
  area: string;
  stage: string;
  difficulty: string;
}

export interface MenuEntry {
  key: string;
  label: string;
  action: () => void;
}

export class OriginalScreens {
  private readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  private mode: 'none' | 'pause' | 'results' | 'gameover' = 'none';
  private entries: MenuEntry[] = [];
  private sel = 0;
  private help = false;
  private identity: StageIdentity = { area: '', stage: '', difficulty: '' };
  private muted = false;
  private data: ResultsData | null = null;
  // count-up state (StageResultMenuController.Update)
  private countUp: CountUp | null = null;
  private frame: CountUpFrame | null = null;
  private raf = 0;
  private lastT = 0;

  constructor(
    private readonly assets: UiAssets,
    private readonly t: StringLookup,
    private readonly cb: ScreensCallbacks,
    root?: UiRoot,
  ) {
    this.root = root ?? new UiRoot(24);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', display: 'none', pointerEvents: 'auto' });
    this.root.el.appendChild(this.layer);
    window.addEventListener('keydown', this.onKey, true);
  }

  /** Stage teardown: remove the root element + its resize listener. */
  dispose(): void {
    this.root.detach();
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  setIdentity(i: StageIdentity): void {
    this.identity = i;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  get visible(): boolean {
    return this.mode !== 'none';
  }

  // ---- shell skin API ---------------------------------------------------------------

  showPause(): void {
    this.mode = 'pause';
    this.help = false;
    this.sel = 0;
    this.entries = [
      { key: 'tl_pause_003', label: this.t('tl_pause_003', 'Resume'), action: () => this.cb.onResume() },
      { key: 'tl_pause_004', label: this.t('tl_pause_004', 'Retry'), action: () => this.cb.onRetry() },
      { key: 'tl_pause_006', label: this.t('tl_pause_006', 'Options'), action: () => { this.muted = this.cb.onToggleMute(); this.draw(); } },
      { key: 'tl_pause_008', label: this.t('tl_pause_008', 'How To Play'), action: () => { this.help = !this.help; this.draw(); } },
    ];
    this.draw();
  }

  hidePause(): void {
    if (this.mode === 'pause') this.hide();
  }

  showResults(d: ResultsData): void {
    this.data = d;
    this.mode = d.won ? 'results' : 'gameover';
    this.sel = 0;
    this.entries = [{ key: 'tl_pause_004', label: this.t('tl_pause_004', 'Retry'), action: () => this.cb.onRetry() }];
    this.stopCountUp();
    if (d.won && d.score !== undefined) this.startCountUp(d);
    this.draw();
  }

  // ---- StageResultMenuController count-up (Update @0052f960, OnConfirm @00530060) -----------------

  private startCountUp(d: ResultsData): void {
    const s = d.score!;
    this.countUp = new CountUp({
      score: s.score, coins: d.coinsEarned, gems: d.gemsEarned, wavesCleared: d.wavesCleared,
      interest: s.interestCoins, clearBonus: s.clearBonus, chibisRemaining: d.chibisSaved,
    });
    this.frame = null;
    this.lastT = performance.now();
    const step = (now: number): void => {
      const cu = this.countUp;
      if (cu === null) return;
      const f = cu.tick(Math.min(0.1, (now - this.lastT) / 1000));
      this.lastT = now;
      this.frame = f;
      if (f.playCountSfx) this.cb.onResultSfx?.('scoreCountUp');
      if (f.finishedNow) {
        if (this.data?.perfect) this.cb.onResultSfx?.('rainbow');
        if (s.newRecord) this.cb.onResultSfx?.('newRecord');
      }
      this.draw();
      if (!f.done) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private stopCountUp(): void {
    cancelAnimationFrame(this.raf);
    this.countUp = null;
    this.frame = null;
  }

  /** True while the numbers are still counting (a confirm press skips instead of activating an entry). */
  private get counting(): boolean {
    return this.countUp !== null && !(this.frame?.done ?? false);
  }

  hideResults(): void {
    if (this.mode === 'results' || this.mode === 'gameover') this.hide();
  }

  private hide(): void {
    this.stopCountUp();
    this.mode = 'none';
    this.layer.style.display = 'none';
    this.layer.textContent = '';
  }

  // ---- input -------------------------------------------------------------------------

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.mode === 'none') return;
    const code = e.code;
    if (code === 'ArrowUp' || code === 'KeyW') this.move(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.move(1);
    else if (code === 'Enter' || code === 'Space' || code === 'KeyE') {
      if (this.mode === 'results' && this.counting) { this.countUp!.confirm(); } // OnConfirm: alpha<1 -> jump to 0.99
      else this.entries[this.sel]?.action();
    }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  private move(d: number): void {
    if (this.entries.length === 0) return;
    this.sel = (this.sel + d + this.entries.length) % this.entries.length;
    this.draw();
  }

  // ---- drawing ------------------------------------------------------------------------

  private f1(text: string, x: number, y: number, o: { scale?: number; tint?: string; outline?: { color: string; width: number }; align?: 'left' | 'right' | 'center' } = {}): HTMLElement {
    const a = o.align ?? 'center';
    const el = textEl(this.assets, 'Font_01', text, {
      scale: o.scale ?? 1, tint: o.tint ?? TEXT.body.tint, outline: o.outline ?? TEXT.body.outline, tracking: -6, px: 46 * (o.scale ?? 1), align: a,
    });
    place(el, x, y, { anchor: a === 'center' ? 'center' : a });
    return el;
  }

  private f2(text: string, x: number, y: number, scale = 1): HTMLElement {
    const el = textEl(this.assets, 'Font_02', text, { scale, tracking: -15, px: 130 * scale });
    place(el, x, y);
    return el;
  }

  private draw(): void {
    const L = this.layer;
    L.textContent = '';
    L.style.display = 'block';
    css(L, { background: this.mode === 'pause' ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.5)' });
    const A = this.assets;
    const id = this.identity;

    const menu = (y0: number, spacing: number): void => {
      this.entries.forEach((en, i) => {
        const on = i === this.sel;
        const el = this.f1(en.label, 960, y0 + i * spacing, {
          scale: on ? 1.12 : 1, tint: on ? '#ffffff' : TEXT.dim.tint,
        });
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.draw(); } });
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); en.action(); });
        L.appendChild(el);
      });
    };

    if (this.mode === 'pause') {
      L.appendChild(this.f2(this.t('tl_pause_001', 'PAUSE'), 960, 283, 0.76));
      L.appendChild(this.f1(this.t('tl_pause_002', 'Pause'), 960, 195, { scale: 0.93, tint: TEXT.blue.tint, outline: TEXT.blue.outline }));
      const card = spriteEl(A, 'pause_stage_bg');
      place(card, 286, 176);
      L.appendChild(card);
      L.appendChild(this.f1(id.area, 283, 113, { scale: 0.8 }));
      L.appendChild(this.f1(id.stage, 284, 167, { scale: 0.8 }));
      L.appendChild(this.f1(id.difficulty, 284, 230, { scale: 0.85 }));
      menu(436, 82);
      if (this.muted) {
        L.appendChild(this.f1('♪ off', 1180, 436 + 2 * 82, { scale: 0.7, tint: '#ff9a7a' }));
      }
      if (this.help) L.appendChild(this.helpPanel());
    } else if (this.mode === 'gameover') {
      L.appendChild(this.f2(this.t('tl_gameover_001', 'GAME OVER'), 960, 358));
      const sub = this.t('tl_gameover_002', '');
      if (sub !== '') L.appendChild(this.f1(sub, 960, 243, { scale: 0.93, tint: TEXT.blue.tint, outline: TEXT.blue.outline }));
      menu(555, 84);
    } else if (this.mode === 'results' && this.data !== null) {
      this.drawResults(this.data);
    }
  }

  private helpPanel(): HTMLElement {
    const p = document.createElement('div');
    css(p, {
      position: 'absolute', left: '1230px', top: '330px', width: '560px', padding: '24px 30px', borderRadius: '22px',
      background: 'rgba(30,20,10,0.78)', border: '4px solid #8a5524', color: '#ffe9c2',
      font: '700 27px/1.55 "Trebuchet MS", sans-serif', whiteSpace: 'pre-line', pointerEvents: 'none',
    });
    const T = this.t;
    p.textContent = [
      `${T('tl_controls_010', 'Move')}:  W A S D / arrows`,
      `${T('tl_controls_006', 'Interact')}:  E / Enter  (tap the bubble)`,
      `Build menu:  W A S D to aim, E build, Q back`,
      `${T('tl_controls_003', 'Pause')}:  Esc`,
    ].join('\n');
    return p;
  }

  private drawResults(d: ResultsData): void {
    const L = this.layer;
    const A = this.assets;
    const id = this.identity;
    const card = document.createElement('div');
    css(card, {
      position: 'absolute', left: `${960 - 843}px`, top: `${696 - 153}px`, width: '1686px', height: '306px', borderRadius: '34px',
      background: 'linear-gradient(#3aa4e0,#2b86c0)', border: '10px solid #b8742f', boxSizing: 'border-box',
      boxShadow: '0 8px 0 rgba(60,30,10,.6), 0 0 40px rgba(0,0,0,.4)',
    });
    L.appendChild(card);
    L.appendChild(this.f1(id.area, 968, 215));
    L.appendChild(this.f2(id.stage, 960, 311, 0.76));
    L.appendChild(this.f1(id.difficulty, 968, 406));
    const line = document.createElement('div');
    css(line, { position: 'absolute', left: `${960 - 822}px`, top: '617px', width: '1644px', height: '14px', borderRadius: '7px', background: '#f6d9a8' });
    L.appendChild(line);
    const T = this.t;
    const sc = d.score;
    const fr = this.frame; // null before the first count-up frame / when the host gave no score block
    const v = fr?.values;
    const done = sc === undefined || (fr?.done ?? false);
    const row = (label: string, value: string, lx: number, vx: number, y: number, icon?: string): void => {
      L.appendChild(this.f1(label, lx, y, { scale: 0.85, align: 'left' }));
      if (icon !== undefined && A.hasSprite(icon)) {
        const ic = spriteEl(A, icon, undefined, undefined);
        place(ic, vx - (lx > 1000 ? 235 : 170), y);
        L.appendChild(ic);
      }
      L.appendChild(this.f1(value, vx, y, { scale: 0.85, align: 'right' }));
    };
    if (sc !== undefined) {
      // Score / Best Score row (y 577) -- the headline numbers of Q4.StageResultMenuController.
      row(T('tl_result_001', 'Score'), String(v?.score ?? 0), 144, 881, 577);
      row(T('tl_result_002', 'Best Score'), String(sc.bestScore), 1041, 1778, 577);
      if (done && sc.newRecord) L.appendChild(this.f1(T('tl_result_009', 'New!'), 945, 570, { scale: 0.8, tint: '#e03d00' }));
      row(T('tl_result_004', 'Bonus'), String(v?.interest ?? 0), 1041, 1778, 669);
      row(T('tl_result_006', 'Clear Bonus'), String(v?.clearBonus ?? 0), 1041, 1778, 737);
    }
    row(T('tl_result_003', 'Coins'), String(v?.coins ?? d.coinsEarned), 144, 881, 669, 'icon_result_coin');
    row(T('tl_result_005', 'Gems'), String(v?.gems ?? d.gemsEarned), 144, 881, 737, 'icon_result_jem');
    row(T('tl_result_007', 'Waves Cleared'), `${v?.wavesCleared ?? d.wavesCleared}`, 144, 881, 805);
    row(T('tl_result_008', 'Chibis Saved'), `${v?.chibisRemaining ?? d.chibisSaved}/${d.chibisTotal}`, 1041, 1778, 805, 'icon_result_chibi');
    if (d.perfect && done && A.hasSprite('perfect_big_img')) {
      const pf = spriteEl(A, 'perfect_big_img');
      place(pf, 1533, 311);
      L.appendChild(pf);
      L.appendChild(this.f1(T('tl_result_010', 'Perfect!'), 1533, 311));
    }
    // After the count-up: Stage Select (OnConfirm default) / Next Stage / Retry. Before it, Enter skips.
    const entries: MenuEntry[] = [];
    if (this.cb.onStageSelect !== undefined) entries.push({ key: 'tl_pause_005', label: T('tl_pause_005', 'Stage Select'), action: () => this.cb.onStageSelect!() });
    if (this.cb.onNextStage !== undefined) entries.push({ key: 'tl_help_004', label: T('tl_help_004', 'Next'), action: () => this.cb.onNextStage!() });
    entries.push({ key: 'tl_pause_004', label: T('tl_pause_004', 'Retry'), action: () => this.cb.onRetry() });
    this.entries = entries;
    if (this.sel >= entries.length) this.sel = 0;
    if (!done) return; // menu appears when the numbers have finished counting
    entries.forEach((en, i) => {
      const on = i === this.sel;
      const el = this.f1(en.label, 960 + (i - (entries.length - 1) / 2) * 420, 940, { scale: on ? 1.12 : 1, tint: on ? '#ffffff' : TEXT.dim.tint });
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.draw(); } });
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); en.action(); });
      L.appendChild(el);
    });
  }
}
