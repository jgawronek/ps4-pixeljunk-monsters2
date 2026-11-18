// src/view/characters/EnemyHealthBarOverlay.ts
// Canvas-2D renderer for EnemyHealthBars (Q4.NewHealthBar.OnPopulateMesh @003d8020).
// A full-screen, pointer-transparent canvas stacked over the game canvas. Geometry is in
// the reference canvas (CanvasScaler ScaleWithScreenSize, match 0 => width 1920) with y UP and the origin at the SCREEN CENTRE,
// like the Unity UI mesh; px = canvas units * (screenWidth / 1920).
//
// Draw order (as in OnPopulateMesh): background sprite (stretched over the bar rect),
// damage trail (red, white<->flickerColor lerp), HP fill, then the cover frame
// (tight sprite mesh drawn at the head position, offset by its trim from the pivot).

import type { HealthBarConfig } from './enemyViewTypes';
import type { HealthBarDrawItem } from './EnemyHealthBar';

export interface BarAnchor {
  /** Screen position in canvas reference units (x right, y UP, origin screen centre). */
  x: number;
  y: number;
}

export class EnemyHealthBarOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(
    private readonly cfg: HealthBarConfig,
    private readonly spriteUrl: (name: string) => string,
    parent: HTMLElement,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const names = [cfg.background, cfg.hp, cfg.damage, ...cfg.sprites.map((s) => s.sprite)];
    for (const n of names) {
      const im = new Image();
      im.src = this.spriteUrl(n);
      this.images.set(n, im);
    }
  }

  setVisible(v: boolean): void {
    this.canvas.style.display = v ? '' : 'none';
  }

  /** Draw all bars. `anchor` returns the head position (canvas units, y up from screen
   *  centre) or null when off-screen/behind the camera. */
  render<V>(items: HealthBarDrawItem<V>[], anchor: (v: V) => BarAnchor | null): void {
    const c = this.canvas;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    if (c.width !== Math.round(w) || c.height !== Math.round(h)) {
      c.width = Math.round(w);
      c.height = Math.round(h);
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    const k = c.width / 1920;
    for (const it of items) {
      const a = anchor(it.data.viewer);
      if (a === null || it.scale <= 0) continue;
      const cover = this.cfg.sprites.find((s) => s.barSize === it.data.barSize) ?? this.cfg.sprites[0];
      const [rx, ry, rw, rh] = cover.barDimensions;
      const s = it.scale;
      // canvas units (y up) -> device px (y down from top-left)
      // CanvasScaler ScaleWithScreenSize, match 0 (width): 1 canvas unit = width/1920 px for ANY aspect, and the canvas origin is the
      // real screen centre (h / 2) — not 540 units. (Hard-coding 540 shifted every bar upward on windows taller than 16:9.)
      const px = (cx: number) => c.width / 2 + cx * k;
      const py = (cy: number) => c.height / 2 - cy * k;
      const bx = a.x + rx * s;
      const byTop = a.y + (ry + rh) * s; // y-up top edge
      const bw = rw * s;
      const bh = rh * s;
      const img = (n: string) => this.images.get(n);
      const stretch = (n: string, widthFactor: number, alpha = 1, tint: number | null = null) => {
        const im = img(n);
        if (!im || !im.complete || im.naturalWidth === 0 || widthFactor <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(im, px(bx), py(byTop), bw * widthFactor * k, bh * k);
        if (tint !== null) {
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = `rgba(${Math.round(this.cfg.degenFlickerColor[0] * 255)},${Math.round(this.cfg.degenFlickerColor[1] * 255)},${Math.round(this.cfg.degenFlickerColor[2] * 255)},${tint})`;
          ctx.fillRect(px(bx), py(byTop), bw * widthFactor * k, bh * k);
        }
        ctx.restore();
      };
      stretch(this.cfg.background, 1);
      if (it.trail !== null) {
        // Color.Lerp(white, degenFlickerColor, f): vertex colour multiplies the sprite;
        // the flicker colour is white with alpha 0.502, so only alpha changes.
        const alpha = 1 + (this.cfg.degenFlickerColor[3] - 1) * it.flicker;
        stretch(this.cfg.damage, Math.min(1, it.trail), alpha);
      }
      stretch(this.cfg.hp, Math.max(0, Math.min(1, it.life / it.maxLife)));
      const im = img(cover.sprite);
      if (im && im.complete && im.naturalWidth > 0) {
        const g = cover.geom;
        // tight mesh rect relative to the pivot (px, y up): left = trim.x - pivot.x*rect.w
        const left = g.trimOffset[0] - g.pivot[0] * g.rect[0];
        const bottom = g.trimOffset[1] - g.pivot[1] * g.rect[1];
        const x0 = a.x + left * s;
        const yTop = a.y + (bottom + g.tight[1]) * s;
        ctx.drawImage(im, px(x0), py(yTop), g.tight[0] * s * k, g.tight[1] * s * k);
      }
    }
  }
}
