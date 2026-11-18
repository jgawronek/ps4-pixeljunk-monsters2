// src/view/ui/BuildMenuUi.ts
// DOM renderer for the tower build ring (prefab Hud_TowerRing). Pure view: the
// BuildMenuModel owns state, BuildMenuFeature feeds this a RingRenderInput.
//
// Geometry (Hud_TowerRing, 1920x1080 reference):
//   * tower slots Ring_Build_Tower_01..08 at radius ~207, 45 deg steps clockwise
//     from up (e.g. 01 (0,206), 03 (208,0), 05 (0,-208), 07 (-206,0));
//     slot sprite 200x200 (ring_icon_tower_NNN is 192x192), cursor sprite
//     ring_cursor_01 240x240, padlock ring_cursor_lock 240x240 (OnRock);
//   * per-slot text group: tower name (Mess_Loc_Ring_Build_Tower) 74 above the
//     slot, Value row (Image_Coin/Numb_Coin/Image_Jem/Numb_Jem, 60x60 icons)
//     50 below the slot; hidden unless that slot is the selected one;
//   * category icons 200x200 (ring_icon_category_0N), cursor 240x240, label
//     Mess_Loc_Ring_Build_Cat 80 above (Animator bool ShowInfo in
//     RingStateBuildCategory); the Upgrade/Dismantle sibling ring uses +-150.
//   * Animator bools (RingStateBuildTowerIcon.UpdateIconDecorations @005ae800):
//     OnDisable (icon greyed: !Buildable), OnRock (padlock: IsLocked),
//     OnDisableCoin / OnDisableJem (cost number marked when HasInventory fails),
//     HideCoin/HideJem when the cost is < 1.
// The Animator transition curves (pop/scale) were not decoded: tower icons use
// 0.7 scale (so 8 x 200px icons on r=207 do not overlap: chord = 158px),
// selection 0.95; documented approximation.

import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, TEXT, textEl } from './UiDom';

export interface RingSlotView {
  slot: number;
  /** sprite name (TowerBase.towerIcon). */
  icon: string;
  /** localized tower name. */
  name: string;
  costCoin: number;
  costGem: number;
  /** !Buildable (greyed). */
  greyed: boolean;
  locked: boolean;
  coinOk: boolean;
  gemOk: boolean;
  selected: boolean;
}

export interface RingCategoryView {
  index: number;
  icon: string;
  label: string;
  selected: boolean;
}

export interface RingRenderInput {
  phase: 'closed' | 'category' | 'icon';
  /** ring centre in reference px. */
  cx: number;
  cy: number;
  categories: RingCategoryView[];
  slots: RingSlotView[];
  centerIcon: string;
  /** horizontal shake offset in px (reject feedback). */
  shake: number;
  hint: { confirm: string; cancel: string };
}

export interface RingCallbacks {
  hoverCategory(i: number): void;
  hoverSlot(slot: number): void;
  /** click/tap: category index or slot. */
  pickCategory(i: number): void;
  pickSlot(slot: number): void;
  /** click outside the ring. */
  cancel(): void;
}

export const RING = {
  slotRadius: 207,
  categoryRadius: 150,
  tower: { iconScale: 0.7, selectedScale: 0.95, cursor: 240 },
  nameDy: -74,
  valueDy: 50,
} as const;

export function slotOffset(slot: number): { x: number; y: number } {
  const a = ((slot - 1) * 45 * Math.PI) / 180; // clockwise from up
  return { x: Math.sin(a) * RING.slotRadius, y: -Math.cos(a) * RING.slotRadius };
}

export function categoryOffset(index: number): { x: number; y: number } {
  const a = (index * 90 * Math.PI) / 180;
  return { x: Math.sin(a) * RING.categoryRadius, y: -Math.cos(a) * RING.categoryRadius };
}

export class BuildMenuUi {
  private readonly backdrop: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private sig = '';
  private cb: RingCallbacks | null = null;

  constructor(private readonly assets: UiAssets, private readonly host: HTMLElement) {
    this.backdrop = document.createElement('div');
    css(this.backdrop, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', display: 'none', pointerEvents: 'auto' });
    this.backdrop.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.cb?.cancel(); });
    this.ring = document.createElement('div');
    css(this.ring, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', display: 'none', pointerEvents: 'none' });
    this.host.append(this.backdrop, this.ring);
    // Warm the decode cache: the ring rebuilds its <img> children on every selection change, and a
    // cold image would flash empty for a frame or more on a slow device.
    const warm = ['ring_cursor_01', 'ring_cursor_lock', 'icon_result_coin', 'icon_result_jem', 'ring_sign_01',
      ...[1, 2, 3, 4].map((i) => `ring_icon_category_0${i}`), ...Object.values(assets.towerIcons)];
    this.warm = warm.filter((n) => assets.hasSprite(n)).map((n) => { const im = new Image(); im.src = assets.spriteUrl(n); return im; });
  }
  private warm: HTMLImageElement[] = [];

  setCallbacks(cb: RingCallbacks): void {
    this.cb = cb;
  }

  private icon(name: string, scale: number, greyed: boolean): HTMLImageElement {
    const im = spriteEl(this.assets, name, 192 * scale, 192 * scale);
    if (greyed) css(im, { filter: 'grayscale(1) brightness(0.62)', opacity: '0.85' });
    return im;
  }

  render(v: RingRenderInput): void {
    if (v.phase === 'closed') {
      this.backdrop.style.display = 'none';
      this.ring.style.display = 'none';
      this.sig = '';
      return;
    }
    this.backdrop.style.display = 'block';
    this.ring.style.display = 'block';
    css(this.ring, { left: `${v.cx + v.shake}px`, top: `${v.cy}px` });
    const sig = JSON.stringify({ p: v.phase, c: v.categories, s: v.slots, ci: v.centerIcon });
    if (sig === this.sig) return;
    this.sig = sig;
    this.ring.textContent = '';
    const A = this.assets;
    const pick = (el: HTMLElement, hover: () => void, click: () => void): void => {
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.addEventListener('pointerenter', hover);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); click(); });
    };

    if (v.phase === 'category') {
      for (const c of v.categories) {
        const o = categoryOffset(c.index);
        const wrap = document.createElement('div');
        css(wrap, { position: 'absolute', left: '0', top: '0' });
        const sc = c.selected ? 1.0 : 0.72;
        const ic = this.icon(c.icon, sc, false);
        if (!c.selected) css(ic, { opacity: '0.75' });
        place(ic, o.x, o.y);
        wrap.appendChild(ic);
        if (c.selected && A.hasSprite('ring_cursor_01')) {
          const cur = spriteEl(A, 'ring_cursor_01', 240, 250);
          place(cur, o.x, o.y);
          wrap.appendChild(cur);
          const lab = textEl(A, 'Font_01', c.label, { scale: 0.8, tint: TEXT.body.tint, outline: TEXT.body.outline, tracking: -6, px: 36 });
          place(lab, o.x, o.y - 128);
          wrap.appendChild(lab);
        }
        pick(ic, () => this.cb?.hoverCategory(c.index), () => this.cb?.pickCategory(c.index));
        this.ring.appendChild(wrap);
      }
    } else {
      // centre: the chosen category icon (Ring_Icon_Build_Cat at the ring centre)
      const ci = this.icon(v.centerIcon, 0.62, false);
      place(ci, 0, 0);
      css(ci, { opacity: '0.9' });
      this.ring.appendChild(ci);
      for (const s of v.slots) {
        const o = slotOffset(s.slot);
        const sc = s.selected ? RING.tower.selectedScale : RING.tower.iconScale;
        const ic = this.icon(s.icon, sc, s.greyed);
        place(ic, o.x, o.y, { z: s.selected ? 3 : 1 });
        this.ring.appendChild(ic);
        if (s.locked && A.hasSprite('ring_cursor_lock')) {
          const lk = spriteEl(A, 'ring_cursor_lock', 123 * 0.55, 155 * 0.55);
          place(lk, o.x, o.y, { z: 4 });
          this.ring.appendChild(lk);
        }
        if (s.selected) {
          if (A.hasSprite('ring_cursor_01')) {
            const cur = spriteEl(A, 'ring_cursor_01', RING.tower.cursor, RING.tower.cursor + 10);
            place(cur, o.x, o.y, { z: 2 });
            this.ring.appendChild(cur);
          }
          // Name + Value row (prefab: Mess_Loc_Ring_Build_Tower 74 above / Value 50 below the slot,
          // Image_Coin/Numb_Coin/Image_Jem/Numb_Jem; hidden when the cost is < 1). With the 0.7
          // icon scale the per-slot text would overlap neighbouring icons, so the caption is set
          // as one plate under the ring (port adaptation).
          const cap = document.createElement('div');
          css(cap, { display: 'flex', alignItems: 'center', gap: '18px', whiteSpace: 'nowrap' });
          cap.appendChild(textEl(A, 'Font_01', s.name, { scale: 0.95, tint: s.greyed ? '#9a9a9a' : TEXT.tower.tint, outline: TEXT.tower.outline, tracking: -6, px: 42 }));
          const addCost = (icon: string, amount: number, ok: boolean): void => {
            if (amount < 1) return;
            cap.append(
              spriteEl(A, icon, 48, 46),
              textEl(A, 'Font_01', String(amount), {
                scale: 0.85, tracking: -6, px: 38, tint: ok ? TEXT.gold.tint : '#ff5a3c', outline: TEXT.gold.outline,
              }),
            );
          };
          addCost('icon_result_coin', s.costCoin, s.coinOk);
          addCost('icon_result_jem', s.costGem, s.gemOk);
          place(cap, 0, 292, { z: 5 });
          this.ring.appendChild(cap);
        }
        pick(ic, () => this.cb?.hoverSlot(s.slot), () => this.cb?.pickSlot(s.slot));
      }
    }

    // key hints under the ring
    const hint = document.createElement('div');
    css(hint, { display: 'flex', gap: '28px', alignItems: 'center', color: '#fff', font: '700 26px "Trebuchet MS", sans-serif', textShadow: '0 0 4px #000, 0 0 4px #000' });
    hint.append(this.keycap(v.hint.confirm), this.keycap(v.hint.cancel));
    place(hint, 0, v.phase === 'icon' ? 372 : 250, { z: 6 });
    this.ring.appendChild(hint);
  }

  private keycap(label: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = label;
    css(el, {
      padding: '4px 16px', borderRadius: '24px', background: 'linear-gradient(#c88a4a,#8a5524)',
      border: '3px solid #4b2a10', boxShadow: '0 3px 0 #2a1608', color: '#fff6dc',
      font: '800 26px "Trebuchet MS", sans-serif', textShadow: '0 2px 0 #4b2a10',
    });
    return el;
  }
}
