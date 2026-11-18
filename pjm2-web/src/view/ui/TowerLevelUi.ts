// src/view/ui/TowerLevelUi.ts
// DOM overlay for the tower level / upgrade presentation. World-anchored
// elements follow towers through an injected projector (the game owns the
// camera). All styling inline, no innerHTML/querySelector (HudLayout/GameShell
// pattern: attach() is the only DOM entry point; calls before attach are
// silent no-ops), so the Node fake-DOM tests drive it.
//
// What is drawn (original Q4 UI elements in parentheses):
//   * per tower EXP gauge  (Q4.TowerEXPGauge): completed-level pips + a
//     fill bar for frac((level-1)+expRate); hidden at max level.
//   * per tower level label (Q4.UI.TowerLevelText): "Lv.N" after the first
//     upgrade, persistent until the tower is sold or a boss dies.
//   * "Level Up!" popup    (Q4.UI.TowerLevelUpText, tl_hud_001), rises + fades.
//   * interaction prompt   (Q4.UI.InteractionHint / RingStateEvolveButtonShow):
//     a button over the selected tower, tap/click = the interact button.
//   * Upgrade/Dismantle ring (Q4.UI.TowerBuildRingController +
//     RingStateEvolveUpgrade/Sell): two entries, the focused one highlighted;
//     Upgrade shows the next level's gem cost (Numb), greyed out when
//     CanConfirm is false; Dismantle shows the refund (Value + ValueWith).
// FIDELITY: the original draws these from Unity prefabs/animators whose
// sprites are not extracted; layout/colour here is a documented approximation.

import type { GameCoreTower } from '../../core/GameCoreTower';
import { ExpGaugeState, levelLabel, levelStringKey } from '../tower/TowerLevelModel';
import type { RingPhase } from '../tower/TowerInteraction';
import type { UiAssets } from './UiAssets';
import { TEXT, textEl } from './UiDom';

export interface ScreenPoint {
  x: number;
  y: number;
  /** false when behind the camera / off screen. */
  visible: boolean;
}
export type WorldProjector = (unityPos: { x: number; y: number; z: number }, heightOffset: number) => ScreenPoint;

export interface TowerLevelUiStrings {
  levelUp: string; // tl_hud_001
  upgrade: string; // tl_ring_tower_001
  dismantle: string; // tl_ring_tower_002
  interact: string; // tl_controls_006
  levelByKey: (key: string) => string; // tl_hud_level_00N
  max: string;
}

export interface RingView {
  phase: RingPhase;
  tower: GameCoreTower | null;
  upgradeEnabled: boolean;
  nextCostCoin: number;
  nextCostGem: number;
  maxLevel: boolean;
  refundCoin: number;
  refundGem: number;
}

export interface TowerLevelUiCallbacks {
  onInteract: () => void;
  onCursor: (dir: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function css(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

interface Badge {
  root: HTMLElement;
  pips: HTMLElement[];
  fill: HTMLElement;
  /** Original-art clock gauge (Q4.TowerEXPGauge prefab): progress wedge + hand, or null when the sprites are unavailable. */
  clock: { box: HTMLElement; progress: HTMLElement; hand: HTMLElement } | null;
  gauge: HTMLElement;
  level: HTMLElement;
  popup: HTMLElement;
  popupT: number; // seconds left; <=0 hidden
  state: ExpGaugeState;
  levelText: string | null; // null = hidden
  /** label currently rendered with the bitmap font (re-render only on change) */
  levelShown?: string | null;
  tower: GameCoreTower;
}

const POPUP_SECONDS = 1.6;
/** Tower_Gauge_GRP background plate size (canvas px, 1920x1080 reference). */
const CLOCK_W = 146;
const CLOCK_H = 133;
const HEIGHT_GAUGE = 3.4; // world units above the tower base (view adaptation)
const HEIGHT_LEVEL = 4.0;

export class TowerLevelUi {
  private container: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private readonly badges = new Map<number, Badge>();
  private hint: HTMLElement | null = null;
  private spriteUrl: ((name: string) => string) | null = null;
  private assets: UiAssets | null = null;
  private backdrop: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private ringUp: HTMLElement | null = null;
  private ringUpLabel: HTMLElement | null = null;
  private ringUpCost: HTMLElement | null = null;
  private ringDown: HTMLElement | null = null;
  private ringDownLabel: HTMLElement | null = null;
  private ringDownValue: HTMLElement | null = null;
  /** Boss killed: TowerLevelTextPool stops showing level labels (RemoveEvents). */
  private levelTextsEnabled = true;

  constructor(
    private readonly strings: TowerLevelUiStrings,
    private readonly project: WorldProjector,
    private readonly cb: TowerLevelUiCallbacks,
  ) {}

  attach(container: HTMLElement): void {
    if (typeof document === 'undefined') throw new Error('TowerLevelUi.attach requires a DOM (document is undefined)');
    this.container = container;
    const layer = document.createElement('div');
    css(layer, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' });
    container.appendChild(layer);
    this.layer = layer;

    // interaction prompt
    const hint = document.createElement('button');
    css(hint, {
      position: 'absolute', display: 'none', pointerEvents: 'auto', transform: 'translate(-50%,-50%)',
      background: 'rgba(0,0,0,.65)', color: '#ffd34d', border: '2px solid #ffd34d', borderRadius: '999px',
      padding: '6px 14px', font: '700 14px monospace', cursor: 'pointer',
    });
    hint.addEventListener('click', () => this.cb.onInteract());
    layer.appendChild(hint);
    this.hint = hint;

    // click/tap OUTSIDE the ring cancels it (the ring is modal; this keeps mouse/touch players from getting stuck)
    const backdrop = document.createElement('div');
    css(backdrop, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'none', pointerEvents: 'auto' });
    backdrop.addEventListener('pointerdown', (e) => { e.preventDefault(); this.cb.onCancel(); });
    layer.appendChild(backdrop);
    this.backdrop = backdrop;

    // ring
    const ring = document.createElement('div');
    css(ring, { position: 'absolute', display: 'none', transform: 'translate(-50%,-50%)', pointerEvents: 'auto', width: '190px' });
    const mk = (down: boolean): { entry: HTMLElement; label: HTMLElement; value: HTMLElement } => {
      const entry = document.createElement('div');
      css(entry, {
        margin: '6px 0', padding: '8px 12px', borderRadius: '10px', background: 'rgba(0,0,0,.6)',
        border: '2px solid transparent', color: '#fff', font: '700 15px monospace',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
      });
      const label = document.createElement('span');
      const value = document.createElement('span');
      css(value, { color: down ? '#9be58b' : '#ffd34d' });
      entry.appendChild(label);
      entry.appendChild(value);
      entry.addEventListener('click', () => {
        this.cb.onCursor(down ? 1 : -1);
        this.cb.onConfirm();
      });
      ring.appendChild(entry);
      return { entry, label, value };
    };
    const up = mk(false);
    const down = mk(true);
    const cancel = document.createElement('div');
    css(cancel, { textAlign: 'center', color: '#cde', font: '12px monospace', cursor: 'pointer' });
    cancel.textContent = '✕  Q / Esc';
    cancel.addEventListener('click', () => this.cb.onCancel());
    ring.appendChild(cancel);
    layer.appendChild(ring);
    this.ring = ring;
    this.ringUp = up.entry; this.ringUpLabel = up.label; this.ringUpCost = up.value;
    this.ringDown = down.entry; this.ringDownLabel = down.label; this.ringDownValue = down.value;
    up.label.textContent = this.strings.upgrade;
    down.label.textContent = this.strings.dismantle;
  }

  /** Original sprite URLs (guage_tower / guage_tower_progress / guage_tower_clock). Without it the legacy bar is used. */
  setSpriteUrl(fn: ((name: string) => string) | null): void {
    this.spriteUrl = fn;
  }

  /** Original UI assets: sprites for the clock gauge AND the Font_01 bitmap font for the level label (its `#` glyph is the
   *  crown shown at max level: tl_hud_level_005 = 'Lv.5#'). */
  setAssets(assets: UiAssets | null): void {
    this.assets = assets;
    this.spriteUrl = assets === null ? null : (n) => assets.spriteUrl(n);
  }

  /** Q4.TowerEXPGauge prefab (Tower_Gauge_GRP, canvas px): Loc_BG/Image `guage_tower` 146x133 @(0,0); Exp_Gauge_GRP
   *  exp_gauge `guage_tower_progress` 132x132 @(8,1), Image.Type Filled / Radial360 / origin Top / clockwise, fillAmount =
   *  ExpGauge fraction; exp_hand `guage_tower_clock` 132x132 @(8,1) = the clock hand turning with the fill. */
  private makeClock(): Badge['clock'] {
    if (this.spriteUrl === null) return null;
    const mk = (name: string, w: number, h: number, x: number, y: number): HTMLImageElement => {
      const im = document.createElement('img');
      im.src = this.spriteUrl!(name);
      im.draggable = false;
      css(im, { position: 'absolute', width: `${w}px`, height: `${h}px`, left: `${CLOCK_W / 2 + x - w / 2}px`, top: `${CLOCK_H / 2 - y - h / 2}px`, pointerEvents: 'none' });
      return im;
    };
    const box = document.createElement('div');
    css(box, { position: 'relative', width: `${CLOCK_W}px`, height: `${CLOCK_H}px`, display: 'none', margin: '0 auto', transformOrigin: '50% 50%' });
    // The extracted sprites are TIGHT-cropped (progress disc 85x86, hand 98x98, frame 145x130) while the prefab rects (132x132,
    // 146x133) are the FULL rects they sit centred in — stretching them to the rect size made the white disc ~55% too big and hid the frame.
    const nat = (name: string, dw: number, dh: number): [number, number] => {
      const m = this.assets?.sprites[name];
      return [m?.w ?? dw, m?.h ?? dh];
    };
    const [bw, bh] = nat('guage_tower', 145, 130);
    const [pw, ph] = nat('guage_tower_progress', 85, 86);
    const [hw, hh] = nat('guage_tower_clock', 98, 98);
    const bg = mk('guage_tower', bw, bh, 0, 0);
    const progress = mk('guage_tower_progress', pw, ph, 8, 1);
    const hand = mk('guage_tower_clock', hw, hh, 8, 1);
    css(hand, { transformOrigin: '50% 50%' });
    box.append(bg, progress, hand);
    return { box, progress, hand };
  }

  // ---- events fed by the game -------------------------------------------------

  private badge(tower: GameCoreTower): Badge | null {
    if (this.layer === null) return null;
    const id = tower.handle.m_handle;
    let b = this.badges.get(id);
    if (b !== undefined) return b;
    const root = document.createElement('div');
    css(root, { position: 'absolute', display: 'none', transform: 'translate(-50%,-50%)', textAlign: 'center', font: '700 13px monospace', color: '#fff', textShadow: '0 1px 3px #000' });
    const level = document.createElement('div');
    css(level, { display: 'none', color: '#ffd34d', fontSize: '16px' });
    const popup = document.createElement('div');
    css(popup, { display: 'none', color: '#fff36b', fontSize: '18px', marginBottom: '4px' });
    popup.textContent = this.strings.levelUp;
    const gauge = document.createElement('div');
    css(gauge, { display: 'none', width: '64px', margin: '0 auto' });
    const pipRow = document.createElement('div');
    css(pipRow, { display: 'flex', justifyContent: 'center', gap: '3px', marginBottom: '2px' });
    const pips: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('span');
      css(p, { width: '9px', height: '9px', borderRadius: '50%', background: 'rgba(255,255,255,.25)', display: 'inline-block' });
      pipRow.appendChild(p);
      pips.push(p);
    }
    const track = document.createElement('div');
    css(track, { height: '7px', borderRadius: '4px', background: 'rgba(0,0,0,.6)', overflow: 'hidden' });
    const fill = document.createElement('div');
    css(fill, { height: '100%', width: '0%', background: '#7fe36b' });
    track.appendChild(fill);
    gauge.appendChild(pipRow);
    gauge.appendChild(track);
    const clock = this.makeClock();
    if (clock !== null) {
      css(gauge, { display: 'none', width: 'auto' });
      gauge.textContent = '';
      gauge.appendChild(clock.box);
    }
    root.appendChild(popup);
    root.appendChild(level);
    root.appendChild(gauge);
    this.layer.appendChild(root);
    b = { root, pips, fill, clock, gauge, level, popup, popupT: 0, state: new ExpGaugeState(), levelText: null, tower };
    this.badges.set(id, b);
    return b;
  }

  /** Events.expGrantEvent (tower, amount) and range entry -> TowerEXPGauge.OnGrantEXP. */
  onGrantExp(tower: GameCoreTower, amount: number): void {
    this.badge(tower)?.state.onGrant(tower, amount);
  }

  /** Events.towerUpgradeEvent -> TowerLevelUpTextPool + TowerLevelTextPool. */
  onUpgrade(tower: GameCoreTower, newLevel: number): void {
    const b = this.badge(tower);
    if (b === null) return;
    b.popupT = POPUP_SECONDS;
    if (this.levelTextsEnabled) {
      const raw = this.strings.levelByKey(levelStringKey(newLevel));
      // with the bitmap font the trailing '#' is the crown glyph: keep it; plain DOM text cannot draw it
      b.levelText = this.assets !== null ? raw : levelLabel(raw);
    }
  }

  /** TowerSell -> TowerLevelText.Hide / TowerEXPGauge.OnTowerSell. */
  onSell(tower: GameCoreTower): void {
    const id = tower.handle.m_handle;
    const b = this.badges.get(id);
    if (b === undefined) return;
    b.root.remove();
    this.badges.delete(id);
  }

  /** A boss was destroyed: TowerLevelText.OnEnemyDestroyed hides every label and
   *  TowerLevelTextPool stops reacting to upgrades (RemoveEvents). */
  onBossDestroyed(): void {
    this.levelTextsEnabled = false;
    for (const b of this.badges.values()) b.levelText = null;
  }

  // ---- per-frame --------------------------------------------------------------

  update(dt: number, selected: GameCoreTower | null, canInteract: boolean, keyName: string, ring: RingView): void {
    if (this.layer === null) return;
    for (const [id, b] of this.badges) {
      if (b.tower.isDestroyed()) {
        b.root.remove();
        this.badges.delete(id);
        continue;
      }
      b.state.update(dt);
      b.popupT = Math.max(0, b.popupT - dt);
      const hasLevel = b.levelText !== null;
      const showGauge = b.state.active && b.state.visible;
      const showPopup = b.popupT > 0;
      css(b.level, { display: hasLevel ? 'block' : 'none' });
      if (this.assets !== null && hasLevel) {
        // TowerLevelText prefab: LocText Mess scale 0.6, textColor (1, 0.855, 0.345), outline (0.18, 0.13, 0.08), Font_01
        if (b.levelShown !== b.levelText) {
          b.level.textContent = '';
          const el = textEl(this.assets, 'Font_01', b.levelText ?? '', { scale: 0.6, tint: TEXT.gold.tint, outline: TEXT.gold.outline, tracking: -6, px: 42 });
          css(el, { margin: '0 auto' });
          b.level.appendChild(el);
          b.levelShown = b.levelText;
        }
      } else {
        b.level.textContent = b.levelText ?? '';
      }
      const pt = this.project(b.tower.position, hasLevel || showPopup ? HEIGHT_LEVEL : HEIGHT_GAUGE);
      if (!pt.visible || (!hasLevel && !showGauge && !showPopup)) {
        css(b.root, { display: 'none' });
        continue;
      }
      css(b.root, { display: 'block', left: `${pt.x}px`, top: `${pt.y}px` });
      css(b.popup, { display: showPopup ? 'block' : 'none', opacity: String(Math.min(1, b.popupT / 0.5)), transform: `translateY(${-(POPUP_SECONDS - b.popupT) * 14}px)` });
      css(b.gauge, { display: showGauge ? 'block' : 'none' });
      if (showGauge && b.clock !== null) {
        // size relative to the 1080p reference so the gauge keeps its proportion on any window
        const k = Math.max(0.3, Math.min(1.2, window.innerHeight / 1080 * 0.7));
        const f = Math.min(1, Math.max(0, b.state.fill));
        css(b.clock.box, { display: 'block', transform: `scale(${k})`, margin: `${-(CLOCK_H * (1 - k)) / 2}px auto` });
        const deg = f * 360;
        // Image.Type Filled, Radial360, origin Top, clockwise: a conic wedge from 12 o'clock
        const mask = `conic-gradient(#000 ${deg}deg, transparent ${deg}deg)`;
        css(b.clock.progress, { webkitMaskImage: mask, maskImage: mask } as Partial<CSSStyleDeclaration>);
        css(b.clock.hand, { transform: `rotate(${deg}deg)` });
      } else if (showGauge) {
        const done = b.state.completedLevels;
        b.pips.forEach((p, i) => css(p, { background: i < done ? '#ffd34d' : 'rgba(255,255,255,.25)' }));
        css(b.fill, { width: `${(b.state.fill * 100).toFixed(1)}%` });
      }
    }

    // interaction prompt
    if (this.hint !== null) {
      if (selected !== null && canInteract && ring.phase === 'closed') {
        const pt = this.project(selected.position, 2.2);
        css(this.hint, { display: pt.visible ? 'block' : 'none', left: `${pt.x}px`, top: `${pt.y}px` });
        this.hint.textContent = `[${keyName}] ${this.strings.interact}`;
      } else {
        css(this.hint, { display: 'none' });
      }
    }

    // ring
    if (this.ring !== null && this.ringUp !== null && this.ringDown !== null) {
      if (ring.phase === 'closed' || ring.tower === null) {
        css(this.ring, { display: 'none' });
        if (this.backdrop !== null) css(this.backdrop, { display: 'none' });
      } else {
        if (this.backdrop !== null) css(this.backdrop, { display: 'block' });
        const pt = this.project(ring.tower.position, 2.0);
        css(this.ring, { display: pt.visible ? 'block' : 'none', left: `${pt.x}px`, top: `${pt.y - 70}px` });
        css(this.ringUp, {
          borderColor: ring.phase === 'upgrade' ? '#ffd34d' : 'transparent',
          opacity: ring.upgradeEnabled ? '1' : '0.45',
        });
        css(this.ringDown, { borderColor: ring.phase === 'sell' ? '#ffd34d' : 'transparent' });
        if (this.ringUpCost !== null) {
          const parts: string[] = [];
          if (ring.maxLevel) parts.push(this.strings.max);
          else {
            if (ring.nextCostCoin > 0) parts.push(`◉${ring.nextCostCoin}`);
            parts.push(`◆${ring.nextCostGem}`);
          }
          this.ringUpCost.textContent = parts.join(' ');
        }
        if (this.ringDownValue !== null) {
          this.ringDownValue.textContent = `+◉${ring.refundCoin}` + (ring.refundGem > 0 ? ` +◆${ring.refundGem}` : '');
        }
      }
    }
  }

  /** Test/probe introspection. */
  get ringVisible(): boolean {
    return this.ring !== null && this.ring.style.display === 'block';
  }
  get badgeCount(): number {
    return this.badges.size;
  }
  badgeTexts(tower: GameCoreTower): { level: string; popupVisible: boolean; gaugeVisible: boolean } | null {
    const b = this.badges.get(tower.handle.m_handle);
    if (b === undefined) return null;
    return { level: b.level.style.display === 'none' ? '' : b.level.textContent, popupVisible: b.popup.style.display !== 'none', gaugeVisible: b.gauge.style.display !== 'none' };
  }
}
