// src/view/ui/OriginalHud.ts
// Gameplay HUD built from the ORIGINAL art + prefab numbers (prefab Hud_02 =
// Q4.GameInfoController, globalsettings bundle). Replaces the unicode-icon
// HudLayout on screen (HudLayout stays as the data/test seam).
//
// Layout (1920x1080 reference, origin top-left, y down; from Hud_02 RectTransform
// chains, tools: .work/ui/dump_prefab.py + abs.py; sprite = native pixel size):
//   Coin_Count_GRP (146,902): plank player_coin_r centre (206,902); value text
//       right-aligned at x=246, y=902, text scale 0.70, Font_01 gold.
//   Jem_Count_GRP  (154,984): plank player_gem_r centre (199,978); value right @ (249,984).
//   Chibi_Count_GRP(1722,984): plank player_chibi centre (1704,988); value group
//       (HorizontalLayoutGroup, MiddleRight) right edge 1841: "<saved>" + "/<total>"
//       (Q4.GameInfoController.DecrementChibiCounterOnKill: chibiText + String.Format("/{0}")).
//   Wave_Meter_GRP (900,142): frame wave_bar centre (900,76); window cream
//       wave_meter_bg centre (595,77) holding the current wave sprite wave_number_NN
//       (tinted (0.56,0.04,0) by Meter_Num_GRP.UIColorChanger); "WAVE" plank
//       wave_bar_sign centre (525,61); track groove sprite-x 290..730 -> x 727..1167
//       (progressbar_bg 439 wide); one Q4.WaveBarMonsterIcon per wave starts at
//       x = 1177 and walks left toward the home tree at the bar's left end
//       (Loc_Monster_01 anchored x = 437 from Monster_Offset(-160,45)).
//   Coin_Count_Bonus_GRP (146,818): "WAVE Clear!" label (tl_wave_call_22, cyan
//       scale 0.8) + a coin plank with the wave bonus; GameInfoController.json
//       bonusCoinShowDelay 2.5 / animationDelay 1.5 / postAnimationDelay 1.0.
//   Bubble_Enemy (Q4.UI.WaveTracker, prefab nodes background=enemy_alert,
//       arrow=enemy_alert_point, text tl_hud_005 "Incoming!").
// Value counters animate with UICounter (updatesPerSecond 60/30, 1s curve); the
// DOM port snaps the plate text (cosmetic) but keeps the count-up for coins.
//
// FIDELITY NOTES: the wave-icon Animator "PosBar" curve and the per-wave bead
// sprites (bar_01..03) are not decoded; icons use a linear progress model;
// stage-1 boss icon sprite is the bundle's only boss icon (boss_kao_02_001).

import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, TEXT, textEl, tintedSpriteEl, UiRoot } from './UiDom';

export interface WaveIconState {
  /** wave has begun spawning (Q4.WaveBarMonsterIcon animator started). */
  started: boolean;
  /** reached the screen (waveProgress.activated) -> icon leaves the bar. */
  arrived: boolean;
  /** 0..1 progress along the track (start -> home). */
  progress: number;
  boss: boolean;
  /** Q4.EnemyBase.m_waveBarSprite of the wave's first enemy (sprite name in sprites.json); null = unknown. */
  sprite?: string | null;
  /** EnemyBase.spawnMode == 2 -> Animator WithBalloon (ImageBalloonZako + ImageBalloon). */
  balloon?: boolean;
}

import type { BarSlotView, IconView } from './WaveBarModel';
import { WAVE_BAR } from './WaveBarModel';

export interface OriginalHudState {
  /** Original wave-bar animation state (WaveBarModel): icon poses + pooled bar fills. Absent = legacy linear icons. */
  waveBar?: { icons: readonly IconView[]; bars: readonly BarSlotView[] };
  coins: number;
  gems: number;
  chibisSaved: number;
  chibisTotal: number;
  /** 1-based current wave. */
  wave: number;
  waves: WaveIconState[];
  /** wave-clear bonus plank (null = hidden). */
  bonus: number | null;
}

export const HUD = {
  coin: { plank: [206, 902], valueRight: [246, 902] },
  gem: { plank: [199, 978], valueRight: [249, 984] },
  chibi: { plank: [1704, 988], valueRightEdge: 1841, valueY: 984 },
  waveBar: [900, 76],
  waveWindow: [595, 77],
  waveSign: [525, 61],
  /** groove in absolute reference x: sprite-x 290..730 + bar left (900-925/2). */
  trackLeft: 727,
  trackRight: 1167,
  /** Loc_Monster_01 start x (Monster_Offset (-160,45) + 437 from Wave_Meter_GRP x 900). */
  iconStartX: 1177,
  iconEndX: 740,
  iconY: 60,
  bonus: { label: [93, 770], plank: [256, 822], valueRight: [296, 822] },
  valueScale: 0.7,
} as const;

/** Linear icon x for a wave (see header). */
export function iconX(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return HUD.iconStartX + (HUD.iconEndX - HUD.iconStartX) * p;
}

export class OriginalHud {
  readonly root: UiRoot;
  private attached = false;
  private coinEl: HTMLElement | null = null;
  private gemEl: HTMLElement | null = null;
  private chibiEl: HTMLElement | null = null;
  private bonusGrp: HTMLElement | null = null;
  private bonusVal: HTMLElement | null = null;
  private waveWin: HTMLElement | null = null;
  private topLayer: HTMLElement | null = null;
  private icons: HTMLElement[] = [];
  private readonly bars: HTMLElement[] = [];
  private iconLayer: HTMLElement | null = null;
  private alert: { root: HTMLElement; arrow: HTMLElement; text: HTMLElement } | null = null;
  private last = { coins: NaN, gems: NaN, chibis: '', wave: -1, bonus: NaN as number | null, iconsSig: '' };
  private shownCoins = 0;
  private coinTarget = 0;

  constructor(private readonly assets: UiAssets, private readonly label: { waveClear: string; incoming: string }, root?: UiRoot) {
    this.root = root ?? new UiRoot(15);
  }

  attach(container: HTMLElement = document.body): void {
    if (this.attached) return;
    this.attached = true;
    if (!this.root.el.isConnected) this.root.attach(container);
    const a = this.assets;
    const R = this.root.el;

    const add = (el: HTMLElement, x: number, y: number, z = 0): HTMLElement => {
      place(el, x, y, { z });
      R.appendChild(el);
      return el;
    };
    // Bottom-left / bottom-right counters live in the UiRoot BOTTOM band: they hug the bottom screen edge on any window aspect.
    const addBottom = (el: HTMLElement, x: number, y: number, z = 0): HTMLElement => {
      place(el, x, y, { z });
      this.root.bottom.appendChild(el);
      return el;
    };
    addBottom(spriteEl(a, 'player_coin_r'), ...HUD.coin.plank);
    addBottom(spriteEl(a, 'player_gem_r'), ...HUD.gem.plank);
    addBottom(spriteEl(a, 'player_chibi'), ...HUD.chibi.plank);
    // Wave bar group: anchored to the TOP of the viewport (Wave_Meter_GRP is a top-anchored UI group), so in a window taller
    // than 16:9 it moves up with the screen edge instead of floating in the letterboxed centre.
    const top = this.root.top; // UiRoot top band: hugs the top screen edge on any window aspect (match-width canvas)
    this.topLayer = top;
    const addTop = (el: HTMLElement, x: number, y: number, z = 0): HTMLElement => {
      place(el, x, y, { z });
      top.appendChild(el);
      return el;
    };
    addTop(spriteEl(a, 'wave_bar'), ...HUD.waveBar, 1);
    addTop(spriteEl(a, 'wave_meter_bg'), ...HUD.waveWindow, 2);
    addTop(spriteEl(a, 'progressbar_bg'), (HUD.trackLeft + HUD.trackRight) / 2, 67, 2);
    addTop(spriteEl(a, 'wave_bar_sign'), ...HUD.waveSign, 3);

    // Pooled bar fills (Meter_Bar_GRP: bar_01..03, 9-sliced 20/15, sizeDelta.x = 444 * PosBar, right edge fixed) sit under the icons.
    for (let i = 0; i < WAVE_BAR.slots; i++) {
      const bar = document.createElement('div');
      const url = a.spriteUrl(`bar_0${i + 1}`);
      css(bar, {
        position: 'absolute', display: 'none', height: '30px', zIndex: '3', pointerEvents: 'none',
        borderStyle: 'solid', borderWidth: '0 15px 0 20px', borderImage: `url(${url}) 0 15 0 20 fill stretch`,
        boxSizing: 'border-box',
      } as Partial<CSSStyleDeclaration>);
      top.appendChild(bar);
      this.bars.push(bar);
    }
    this.iconLayer = document.createElement('div');
    css(this.iconLayer, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '4', pointerEvents: 'none' });
    top.appendChild(this.iconLayer);

    // Bonus group (hidden until a wave ends).
    this.bonusGrp = document.createElement('div');
    css(this.bonusGrp, { position: 'absolute', left: '0', top: '0', opacity: '0', transition: 'opacity .3s', pointerEvents: 'none' });
    const lab = textEl(a, 'Font_01', this.label.waveClear, { scale: 0.8, tint: TEXT.cyan.tint, outline: TEXT.cyan.outline, tracking: -6, px: 40 });
    place(lab, ...HUD.bonus.label, { anchor: 'left' });
    this.bonusGrp.appendChild(lab);
    const bp = spriteEl(a, 'player_coin_r');
    place(bp, ...HUD.bonus.plank);
    this.bonusGrp.appendChild(bp);
    this.root.bottom.appendChild(this.bonusGrp); // 'WAVE Clear!' bonus plank: bottom-left group

    // Enemy-incoming bubble (WaveTracker).
    const ar = document.createElement('div');
    css(ar, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', display: 'none', zIndex: '6', pointerEvents: 'none' });
    const bg = spriteEl(a, 'enemy_alert', 140, 140);
    place(bg, 0, 0);
    const arrow = document.createElement('div');
    css(arrow, { position: 'absolute', left: '0', top: '0', width: '0', height: '0' });
    const ap = spriteEl(a, 'enemy_alert_point', 40, 46);
    place(ap, 0, -88);
    arrow.appendChild(ap);
    const txt = textEl(a, 'Font_01', this.label.incoming, { scale: 0.6, tint: TEXT.gold.tint, outline: TEXT.gold.outline, tracking: -6, px: 34 });
    place(txt, 0, 92);
    ar.append(bg, arrow, txt);
    R.appendChild(ar);
    this.alert = { root: ar, arrow, text: txt };
  }

  private plate(prev: HTMLElement | null, text: string, right: readonly [number, number] | { x: number; y: number }): HTMLElement {
    prev?.remove();
    const x = Array.isArray(right) ? right[0] : (right as { x: number }).x;
    const y = Array.isArray(right) ? right[1] : (right as { y: number }).y;
    const el = textEl(this.assets, 'Font_01', text, {
      scale: HUD.valueScale, tint: TEXT.gold.tint, outline: TEXT.gold.outline, tracking: -6, px: 40, align: 'right',
    });
    place(el, x, y, { anchor: 'right', z: 5 });
    this.root.bottom.appendChild(el); // counters are bottom-anchored
    return el;
  }

  update(s: OriginalHudState, dt = 1 / 60): void {
    if (!this.attached) return;
    // UICounter: coins count up/down toward the target (1 s curve).
    this.coinTarget = s.coins;
    if (this.shownCoins !== this.coinTarget) {
      const step = Math.max(1, Math.ceil(Math.abs(this.coinTarget - this.shownCoins) * Math.min(1, dt * 6)));
      this.shownCoins += Math.sign(this.coinTarget - this.shownCoins) * Math.min(step, Math.abs(this.coinTarget - this.shownCoins));
    }
    if (this.shownCoins !== this.last.coins) {
      this.coinEl = this.plate(this.coinEl, String(this.shownCoins), HUD.coin.valueRight);
      this.last.coins = this.shownCoins;
    }
    if (s.gems !== this.last.gems) {
      this.gemEl = this.plate(this.gemEl, String(s.gems), HUD.gem.valueRight);
      this.last.gems = s.gems;
    }
    const chibiSig = `${s.chibisSaved}/${s.chibisTotal}`;
    if (chibiSig !== this.last.chibis) {
      this.chibiEl?.remove();
      this.chibiEl = this.plate(null, `${s.chibisSaved}/${s.chibisTotal}`, { x: HUD.chibi.valueRightEdge, y: HUD.chibi.valueY });
      this.last.chibis = chibiSig;
    }
    if (s.wave !== this.last.wave) {
      this.waveWin?.remove();
      const name = `wave_number_${String(Math.max(0, Math.min(20, s.wave))).padStart(2, '0')}`;
      // Meter_Num_GRP UIColorChanger tint (0.56,0.04,0) on the white digit sprite.
      const el = tintedSpriteEl(this.assets, name, '#8f0a00');
      place(el, HUD.waveWindow[0], HUD.waveWindow[1], { scale: 1.0, z: 3 });
      (this.topLayer ?? this.root.el).appendChild(el);
      this.waveWin = el;
      this.last.wave = s.wave;
    }
    if (s.bonus !== this.last.bonus) {
      this.bonusVal?.remove();
      if (s.bonus !== null && this.bonusGrp !== null) {
        this.bonusVal = textEl(this.assets, 'Font_01', `+${s.bonus}`, {
          scale: HUD.valueScale, tint: TEXT.gold.tint, outline: TEXT.gold.outline, tracking: -6, px: 40, align: 'right',
        });
        place(this.bonusVal, ...HUD.bonus.valueRight, { anchor: 'right' });
        this.bonusGrp.appendChild(this.bonusVal);
      }
      if (this.bonusGrp !== null) this.bonusGrp.style.opacity = s.bonus === null ? '0' : '1';
      this.last.bonus = s.bonus;
    }
    this.updateIcons(s.waves, s.waveBar);
  }

  /** Q4.WaveBarMonsterIcon prefab (Loc_Monster_01): ImageZako 108x76 @(0,0); ImageBalloonZako 108x76 @(0,-25) + ImageBalloon
   *  113x86 @(0,60) when Animator WithBalloon; ImageBoss 142x159 @(0,-20) scale 0.75 when IsBoss. All Images get the wave
   *  enemy's m_waveBarSprite (Init @0x9006B0). Unity UI y is up. */
  private makeIcon(w: WaveIconState): HTMLElement {
    const box = document.createElement('div');
    css(box, { position: 'absolute', width: '0', height: '0' });
    const fit = (name: string, wpx: number, hpx: number, dx: number, dy: number, scale = 1): void => {
      const im = spriteEl(this.assets, name, wpx, hpx);
      css(im, { objectFit: 'contain' });
      place(im, dx, -dy, { scale });
      box.appendChild(im);
    };
    const spr = w.sprite ?? (w.boss ? 'boss_kao_02_001' : 'giant_00');
    if (w.boss) fit(spr, 142, 159, 0, -20, 0.75);
    else if (w.balloon === true) { fit(spr, 108, 76, 0, -25); fit('balloon', 113, 86, 0, 60); }
    else fit(spr, 108, 76, 0, 0);
    return box;
  }

  private updateIcons(waves: WaveIconState[], wb?: OriginalHudState['waveBar']): void {
    if (this.iconLayer === null) return;
    if (wb !== undefined) {
      while (this.icons.length < waves.length) {
        const el = this.makeIcon(waves[this.icons.length]);
        place(el, HUD.iconStartX, HUD.iconY, { anchor: 'left' });
        el.style.transform = '';
        el.style.display = 'none';
        this.iconLayer.appendChild(el);
        this.icons.push(el);
      }
      // icon origin = Monster_Offset: x = homeX (740) + anchoredPosition.x, y up
      for (let i = 0; i < waves.length && i < wb.icons.length; i++) {
        const v = wb.icons[i];
        const el = this.icons[i];
        el.style.display = v.visible ? 'block' : 'none';
        if (!v.visible) continue;
        el.style.left = `${HUD.iconEndX + v.x}px`;
        el.style.top = `${HUD.iconY - v.y}px`;
        el.style.opacity = String(v.alpha);
        el.style.transform = `scale(${v.scale})`;
      }
      for (let i = 0; i < this.bars.length; i++) {
        const b = wb.bars[i];
        const el = this.bars[i];
        if (b === undefined || !b.visible || b.posBar <= 0) { el.style.display = 'none'; continue; }
        const w = Math.max(35, WAVE_BAR.barWidth * b.posBar); // 20 + 15 px caps minimum
        // Loc_Meter_Bar (-119, +25) vs Monster_Offset (-160, +45): right edge = icon origin + 41 + 438, centre y = icon y + 20
        el.style.display = 'block';
        el.style.width = `${w}px`;
        el.style.left = `${HUD.iconEndX + 41 + 438 - w}px`;
        el.style.top = `${HUD.iconY + 20 - 15}px`;
        el.style.opacity = String(b.alpha);
      }
      return;
    }
    while (this.icons.length < waves.length) {
      const w = waves[this.icons.length];
      const el = this.makeIcon(w);
      place(el, HUD.iconStartX, HUD.iconY, { anchor: 'left' }); // container is a 0x0 anchor; children are placed around it
      el.style.transform = '';
      this.iconLayer.appendChild(el);
      this.icons.push(el);
    }
    // WaveBarMonsterIcon.UpdateMonsterBarIcons: only started-but-not-arrived icons move;
    // arrived waves go idle (hidden here); unstarted queue at the start.
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const el = this.icons[i];
      if (w.arrived) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      const x = w.started ? iconX(w.progress) : HUD.iconStartX + 0;
      el.style.left = `${x}px`;
      el.style.opacity = w.started ? '1' : String(Math.max(0, 0.9 - 0.12 * (i - waves.findIndex((q) => !q.arrived))));
    }
  }

  /** WaveTracker bubble: screen-edge-clamped position (reference px) + pointing angle (deg, clockwise from up). */
  setAlert(v: { x: number; y: number; angle: number; showText: boolean } | null): void {
    if (this.alert === null) return;
    if (v === null) { this.alert.root.style.display = 'none'; return; }
    css(this.alert.root, { display: 'block', left: `${v.x}px`, top: `${v.y}px` });
    this.alert.arrow.style.transform = `rotate(${v.angle}deg)`;
    this.alert.text.style.display = v.showText ? 'block' : 'none';
  }
}
