// src/view/loading/LoadingScreenUi.ts
// DOM view of the original loading screen (prefab `LoadingMenu`, loading_ui bundle). Layout = prefab numbers (1920x1080 reference):
//   Loc_BG       part01 1920x1024 @ (0,0) TL; part02 56x1024 + part03 56x896 rotated 90deg CCW under it (strip y 1024..1080, x 0..1024 / 1024..1920)
//   Loc_BG_Cover 1920x1080 rgba(9,41,89,0.302)
//   Mess_Loc_Title  (960,100) scale 1.2, Font_01, (0.878 grey) — tip title
//   Text_Area       1920x299 mask @ top y=661, text block centred at (960, 661+145), left-aligned lines, Font_01 scale .995
//   Scroll_GRP      arrows at (962, 643) / (962, 982), scale .5 (only when the text overflows the mask)
//   Mess_Loc_Loading (1812,997) scale .75 blue "LOADING" (prefab-inactive in the original; kept as the port's progress label)
// Anchoring: everything is canvas-relative (UiRoot, match-width scaler); the picture is cover-scaled to the window.

import type { UiAssets } from '../ui/UiAssets';
import { bleed, css, REF_H, REF_W, TEXT, textEl, UiRoot } from '../ui/UiDom';
import { LOADING_TIPS } from './loadingScreen.generated';
import { LoadingScreenModel, type LoadingView } from './LoadingScreenModel';

const BG_BASE = '/assets/ui/loading/';
const TEXT_ICONS: Record<string, string> = { c_l_stick: 'WASD', jump: 'Space', interact: 'E', c_r_stick: 'Mouse' };

/** Q4.LocText inline icons ({jump}, {c_l_stick}, ...) have no icon font here: the keyboard equivalent / nothing. */
export function tipText(raw: string): string {
  return raw.replace(/\{([a-z_0-9]+)\}/g, (_m, k: string) => TEXT_ICONS[k] ?? '').replace(/[ \t]{2,}/g, ' ').replace(/ ([.,!?])/g, '$1');
}

export class LoadingScreenUi {
  readonly root = new UiRoot(40);
  private readonly stage = document.createElement('div');
  private readonly bgA = document.createElement('div');
  private readonly bgB = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly arrowUp = new Image();
  private readonly arrowDown = new Image();
  private readonly label = document.createElement('div');
  private model: LoadingScreenModel | null = null;
  private raf = 0;
  private last = 0;
  private shown: LoadingView['tip'] | undefined;
  private scrollY = 0;
  private maxScroll = 0;
  onFinished: (() => void) | null = null;

  constructor(private readonly assets: UiAssets, private readonly t: (key: string, fallback: string) => string) {
    const r = this.root.el;
    css(r, { pointerEvents: 'auto', display: 'none' });
    const back = document.createElement('div');
    bleed(back);
    css(back, { background: '#06142b' });
    r.appendChild(back);
    css(this.stage, { position: 'absolute', left: '0', top: '0', width: `${REF_W}px`, height: `${REF_H}px`, overflow: 'visible' });
    r.appendChild(this.stage);
    for (const el of [this.bgA, this.bgB]) {
      css(el, { position: 'absolute', left: '0', top: '0', width: `${REF_W}px`, height: `${REF_H}px` });
      this.stage.appendChild(el);
    }
    const cover = document.createElement('div');
    css(cover, { position: 'absolute', left: '0', top: '0', width: `${REF_W}px`, height: `${REF_H}px`, background: 'rgba(9,41,89,0.302)' });
    this.stage.appendChild(cover);
    css(this.title, { position: 'absolute', left: '960px', top: '100px', transform: 'translate(-50%,-50%) scale(1.2)', opacity: '0' });
    this.stage.appendChild(this.title);
    const area = document.createElement('div');
    css(area, { position: 'absolute', left: '0', top: '661px', width: `${REF_W}px`, height: '299px', overflow: 'hidden' });
    css(this.body, { position: 'absolute', left: '960px', top: '145px', transform: 'translate(-50%,-50%)', opacity: '0' });
    area.appendChild(this.body);
    this.stage.appendChild(area);
    this.arrowUp.src = `${BG_BASE}scroll_up.png`;
    this.arrowDown.src = `${BG_BASE}scroll_down.png`;
    for (const [im, y] of [[this.arrowUp, 643], [this.arrowDown, 982]] as const) {
      css(im, { position: 'absolute', left: '962px', top: `${y}px`, width: '158px', height: '90px', transform: 'translate(-50%,-50%) scale(0.5)', display: 'none' });
      this.stage.appendChild(im);
    }
    css(this.label, { position: 'absolute', left: '1812px', top: '997px', transform: 'translate(-50%,-50%) scale(0.75)' });
    this.stage.appendChild(this.label);
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
  }

  private onWheel(e: WheelEvent): void {
    if (this.model === null || this.maxScroll <= 0) return;
    this.scrollY = Math.min(this.maxScroll, Math.max(0, this.scrollY + Math.sign(e.deltaY) * 40));
    this.body.style.top = `${145 - this.scrollY}px`;
    this.syncArrows();
  }

  private syncArrows(): void {
    this.arrowUp.style.display = this.maxScroll > 0 && this.scrollY > 0 ? 'block' : 'none';
    this.arrowDown.style.display = this.maxScroll > 0 && this.scrollY < this.maxScroll ? 'block' : 'none';
  }

  private paintBg(el: HTMLElement, name: string | null): void {
    el.replaceChildren();
    if (name === null) return;
    const url = `${BG_BASE}${name}.webp`;
    const part = (w: number, h: number, sx: number, sy: number, sh: number, rot: boolean, ox: number, oy: number): void => {
      const d = document.createElement('div');
      css(d, {
        position: 'absolute', left: `${ox}px`, top: `${oy}px`, width: `${w}px`, height: `${h}px`,
        backgroundImage: `url(${url})`, backgroundSize: '2048px 1024px', backgroundPosition: `${-sx}px ${-(1024 - sy - sh)}px`,
        transformOrigin: rot ? '100% 0%' : '0 0', transform: rot ? 'rotate(-90deg)' : '',
      });
      el.appendChild(d);
    };
    // Unity texture y is bottom-up: sprite rects (1927,0,56x1024) / (1992,128,56x896) are measured from the bottom.
    part(1920, 1024, 0, 0, 1024, false, 0, 0);
    part(56, 1024, 1927, 0, 1024, true, -56, 1024); // pivot (1,1) at (0,1024): rotated strip covers x 0..1024, y 1024..1080
    part(56, 896, 1992, 128, 896, true, 1024 - 56, 1024);
  }

  show(): void {
    this.model = new LoadingScreenModel(LOADING_TIPS, (n) => Math.floor(Math.random() * n));
    this.shown = undefined;
    this.scrollY = 0;
    this.root.el.style.display = 'block';
    if (!this.root.el.isConnected) this.root.attach(document.body);
    this.label.replaceChildren(textEl(this.assets, 'Font_01', this.t('tl_title_003', 'LOADING'), { scale: 1, tracking: -6, tint: '#26baff', outline: { color: '#000', width: 3 }, px: 52 }));
    const v = this.model.view();
    this.paintBg(this.bgA, v.bg);
    this.bgB.replaceChildren();
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const tick = (now: number): void => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
    this.frame(0);
  }

  /** LoadingScreen.Hide: fades out (>= 1 s after the last tip change, then the Out clip) and reports `onFinished`. */
  hide(): void { this.model?.hide(); }

  get active(): boolean { return this.model !== null; }
  get hiding(): boolean { return this.model?.hiding ?? false; }

  private bgKeyA: string | null = null;
  private bgKeyB: string | null = null;

  private frame(dt: number): void {
    const m = this.model;
    if (m === null) return;
    m.update(dt);
    const v = m.view();
    this.root.el.style.opacity = String(v.rootAlpha);
    // background: bgPrev underneath at full alpha, bg fading in on top
    if (v.bgPrev !== null) { if (this.bgKeyB !== v.bgPrev) { this.paintBg(this.bgB, v.bgPrev); this.bgKeyB = v.bgPrev; } }
    if (v.bg !== this.bgKeyA) { this.paintBg(this.bgA, v.bg); this.bgKeyA = v.bg; }
    this.bgB.style.display = v.bgPrev !== null ? 'block' : 'none';
    this.bgA.style.opacity = String(v.bgPrev !== null ? v.bgAlpha : 1);
    this.bgA.style.zIndex = '1';
    if (v.tip !== this.shown) {
      this.shown = v.tip;
      this.title.replaceChildren();
      this.body.replaceChildren();
      if (v.tip !== null) {
        const ti = this.t(v.tip.title, '');
        const tx = tipText(this.t(v.tip.tip, ''));
        if (ti !== '') this.title.appendChild(textEl(this.assets, 'Font_01', ti, { scale: 1, tracking: -6, tint: TEXT.body.tint, outline: TEXT.body.outline, px: 52 }));
        this.body.appendChild(textEl(this.assets, 'Font_01', tx, { scale: 0.995, tracking: -6, tint: TEXT.body.tint, outline: TEXT.body.outline, align: 'left', px: 52 }));
        this.scrollY = 0;
        this.body.style.top = '145px';
        requestAnimationFrame(() => { // Q4.UI.ScrollView.NeedScroll: text taller than the 299 px mask
          const h = (this.body.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
          this.maxScroll = Math.max(0, Math.ceil(h - 299 + 20));
          this.syncArrows();
        });
      }
    }
    this.title.style.opacity = String(v.tipAlpha);
    this.body.style.opacity = String(v.tipAlpha);
    if (m.finished) {
      cancelAnimationFrame(this.raf);
      this.model = null;
      this.root.el.style.display = 'none';
      this.bgKeyA = this.bgKeyB = null;
      this.onFinished?.();
    }
  }
}
