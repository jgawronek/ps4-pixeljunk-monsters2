// src/view/ui/UiDom.ts
// DOM helpers shared by the original-art UI modules: the 1920x1080 reference
// root (Unity CanvasScaler, ReferenceResolution 1920x1080 on every UI prefab —
// start_call_01/Hud_02/Hud_TowerRing/... all carry the same CanvasScaler) and
// sprite / bitmap-text element factories.
//
// Browser-only except the pure helpers (uiScale / screenToRef) which the tests use.

import { renderText, type TextStyle, type UiAssets } from './UiAssets';

export const REF_W = 1920;
export const REF_H = 1080;

/** The original's CanvasScaler: ScaleWithScreenSize, reference 1920x1080, ScreenMatchMode MatchWidthOrHeight, match 0 (= WIDTH):
 *  one canvas unit is always vw / 1920 px, whatever the window aspect. Only the canvas HEIGHT varies (vh / s). */
export function uiScale(vw: number, _vh: number): number {
  return vw / REF_W;
}

/** The 1920x1080 stage is centred vertically; `y` is its top edge in screen px (negative when the window is shorter than 16:9). */
export function refOffset(vw: number, vh: number): { x: number; y: number; s: number } {
  const s = uiScale(vw, vh);
  return { x: 0, y: (vh - REF_H * s) / 2, s };
}

/** Extra canvas rows above / below the 1080 stage (reference px). Positive on windows taller than 16:9, negative on wider ones.
 *  Top-anchored UI shifts by -inset, bottom-anchored by +inset so each hugs its real screen edge. */
export function edgeInset(vw: number, vh: number): number {
  const o = refOffset(vw, vh);
  return o.y / o.s;
}

export function screenToRef(sx: number, sy: number, vw: number, vh: number): { x: number; y: number } {
  const o = refOffset(vw, vh);
  return { x: (sx - o.x) / o.s, y: (sy - o.y) / o.s };
}

export function css(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/** Text palette from the prefabs (LocText.textColor / outlineColor). */
export const TEXT = {
  /** Mess default body text: (0.88,0.88,0.88), black outline. */
  body: { tint: '#e0e0e0', outline: { color: '#000', width: 3 } },
  /** Value counters (coin/gem/chibi): (1,0.85,0.35) with (0.18,0.13,0.08) outline. */
  gold: { tint: '#ffd959', outline: { color: '#2e2114', width: 3 } },
  /** Tower name in ring (Tower Name: (1,0.73,0.14)). */
  tower: { tint: '#ffba24', outline: { color: '#2e2114', width: 3 } },
  /** Blue sub-title (pause/game over (0.15,0.73,1)). */
  blue: { tint: '#26baff', outline: { color: '#000', width: 3 } },
  /** Unselected menu entry (0.68). */
  dim: { tint: '#adadad', outline: { color: '#000', width: 3 } },
  /** Bonus label (0.06,0.69,0.88). */
  cyan: { tint: '#0fb0e0', outline: { color: '#000', width: 3 } },
} as const;

export class UiRoot {
  readonly el: HTMLDivElement;
  private readonly onResize = (): void => this.layout();
  constructor(zIndex = 16) {
    this.el = document.createElement('div');
    css(this.el, {
      position: 'fixed', left: '0', top: '0', width: `${REF_W}px`, height: `${REF_H}px`,
      transformOrigin: '0 0', pointerEvents: 'none', zIndex: String(zIndex), overflow: 'visible',
      userSelect: 'none',
    });
    const band = (name: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.dataset.band = name;
      css(d, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '1' });
      this.el.appendChild(d);
      return d;
    };
    this.top = band('top');
    this.bottom = band('bottom');
  }
  attach(container: HTMLElement = document.body): void {
    container.appendChild(this.el);
    window.addEventListener('resize', this.onResize);
    this.layout();
  }
  /** Remove the element + the window resize listener added by attach(). Idempotent. */
  detach(): void {
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }
  /** Letterbox bands (reference px) above/below the 16:9 stage when the window is taller than 16:9. Top-anchored HUD
   *  (Unity UI anchors the wave bar to the top edge of the canvas) shifts up by `insetTop`. */
  insetTop = 0;
  /** Bands inside the stage: `top` hugs the top screen edge, `bottom` the bottom edge (children use the 1920x1080 reference
   *  coordinates of the ORIGINAL prefab, measured from the stage's top-left). The stage itself (`el`) is the middle band. */
  readonly top: HTMLDivElement;
  readonly bottom: HTMLDivElement;
  private readonly layoutListeners: (() => void)[] = [];
  onLayout(cb: () => void): void { this.layoutListeners.push(cb); cb(); }
  /** Visible reference rows: y in [yMin, yMax] (x is always [0, 1920] — match-width scaling). */
  visible(): { yMin: number; yMax: number; width: number; height: number } {
    const inset = this.insetTop;
    return { yMin: -inset, yMax: REF_H + inset, width: REF_W, height: REF_H + 2 * inset };
  }
  layout(): void {
    const o = refOffset(window.innerWidth, window.innerHeight);
    this.el.style.transform = `translate(${o.x}px, ${o.y}px) scale(${o.s})`;
    this.insetTop = o.y / o.s;
    this.top.style.transform = `translateY(${-this.insetTop}px)`;
    this.bottom.style.transform = `translateY(${this.insetTop}px)`;
    for (const cb of this.layoutListeners) cb();
  }
  /** Viewport px -> reference px. */
  toRef(sx: number, sy: number): { x: number; y: number } {
    return screenToRef(sx, sy, window.innerWidth, window.innerHeight);
  }
}

export interface PlaceOpts {
  /** CSS translate for anchoring (default centre). */
  anchor?: 'center' | 'left' | 'right';
  opacity?: number;
  scale?: number;
  z?: number;
}

export function place(el: HTMLElement, x: number, y: number, o: PlaceOpts = {}): void {
  const a = o.anchor ?? 'center';
  const tx = a === 'center' ? '-50%' : a === 'left' ? '0' : '-100%';
  css(el, {
    position: 'absolute', left: `${x}px`, top: `${y}px`,
    transform: `translate(${tx}, -50%) scale(${o.scale ?? 1})`,
    transformOrigin: a === 'center' ? '50% 50%' : a === 'left' ? '0 50%' : '100% 50%',
    pointerEvents: 'none',
  });
  if (o.opacity !== undefined) el.style.opacity = String(o.opacity);
  if (o.z !== undefined) el.style.zIndex = String(o.z);
}

/** Sprite <img> at native size (or `w`x`h`). */
export function spriteEl(assets: UiAssets, name: string, w?: number, h?: number): HTMLImageElement {
  const im = document.createElement('img');
  im.src = assets.spriteUrl(name);
  im.draggable = false;
  const m = assets.sprites[name];
  css(im, {
    width: `${w ?? m?.w ?? 64}px`, height: `${h ?? m?.h ?? 64}px`, display: 'block',
    pointerEvents: 'none', imageRendering: 'auto',
  });
  return im;
}

/** Bitmap-font text as a <canvas> (falls back to a styled <span> without the atlas). */
export function textEl(
  assets: UiAssets,
  fontName: 'Font_00' | 'Font_01' | 'Font_02',
  text: string,
  style: TextStyle & { px?: number } = {},
): HTMLElement {
  const font = assets.fonts[fontName];
  if (font === null || typeof document === 'undefined') {
    const sp = document.createElement('span');
    sp.textContent = text;
    css(sp, {
      font: `800 ${Math.round((style.px ?? 42) * (style.scale ?? 1))}px/1.1 "Trebuchet MS", system-ui, sans-serif`,
      color: style.tint ?? '#fff', whiteSpace: 'pre', textAlign: style.align ?? 'center',
      textShadow: '0 0 3px #000, 0 0 3px #000, 0 0 3px #000',
    });
    return sp;
  }
  const r = renderText(font, text, style);
  const c = document.createElement('canvas');
  c.width = r.canvas.width;
  c.height = r.canvas.height;
  c.getContext('2d')!.drawImage(r.canvas, 0, 0);
  css(c, { width: `${c.width}px`, height: `${c.height}px`, display: 'block', pointerEvents: 'none' });
  return c;
}

/** Sprite recoloured like UIColorChanger(tintImages): multiplies the (white) sprite by `color`. */
export function tintedSpriteEl(assets: UiAssets, name: string, color: string): HTMLCanvasElement {
  const m = assets.sprites[name];
  const c = document.createElement('canvas');
  c.width = m?.w ?? 64;
  c.height = m?.h ?? 64;
  css(c, { width: `${c.width}px`, height: `${c.height}px`, display: 'block', pointerEvents: 'none' });
  const im = new Image();
  im.onload = () => {
    const x = c.getContext('2d')!;
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(im, 0, 0);
  };
  im.src = assets.spriteUrl(name);
  return c;
}
