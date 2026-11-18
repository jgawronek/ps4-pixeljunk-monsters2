// src/view/intro/IntroCardUi.ts
// The stage card shown while the intro cameras play (Q4.StartOutlineController, prefab
// start_outline_01): area name, stage name (Font_02 0.76 @ (960,488), docs/GAME_UI_ANALYSIS.md 4.5),
// difficulty label.  Best score / perfect icons need the save data and are not shown.
// Layout of the area / difficulty lines and the hint line are APPROXIMATE (prefab positions not
// decoded); the hint line is a web-port addition (the original shows a help bar with the confirm button).

import type { UiAssets } from '../ui/UiAssets';
import { css, place, REF_H, TEXT, textEl, UiRoot } from '../ui/UiDom';

export interface IntroCardText {
  area: string;
  stage: string;
  difficulty: string;
  hint: string;
}

export class IntroCardUi {
  readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  private hint: HTMLElement | null = null;

  constructor(private readonly assets: UiAssets, root?: UiRoot) {
    this.root = root ?? new UiRoot(17);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: `${REF_H}px`, pointerEvents: 'none' });
    this.root.el.appendChild(this.layer);
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  show(t: IntroCardText): void {
    this.layer.replaceChildren();
    const area = textEl(this.assets, 'Font_01', t.area, { scale: 1, tracking: -6, tint: TEXT.blue.tint, outline: TEXT.blue.outline, px: 52 });
    place(area, 968, 372);
    const stage = textEl(this.assets, 'Font_02', t.stage, { scale: 0.76, tracking: -15, px: 150 * 0.76 });
    place(stage, 960, 488);
    const diff = textEl(this.assets, 'Font_01', t.difficulty, { scale: 1, tracking: -6, tint: TEXT.body.tint, outline: TEXT.body.outline, px: 52 });
    place(diff, 968, 610);
    this.hint = textEl(this.assets, 'Font_01', t.hint, { scale: 0.7, tracking: -6, tint: TEXT.dim.tint, outline: TEXT.dim.outline, px: 52 * 0.7 });
    place(this.hint, 960, 960);
    for (const el of [area, stage, diff]) this.layer.appendChild(el);
    this.hint.remove?.();
    this.root.bottom.appendChild(this.hint); // "Press Enter / click to start" hugs the bottom edge
  }

  setAlpha(a: number): void {
    this.layer.style.opacity = String(Math.max(0, Math.min(1, a)));
    this.layer.style.display = a <= 0 ? 'none' : 'block';
    this.bandAlpha = Math.max(0, Math.min(1, a));
    if (this.hint !== null) this.hint.style.display = a <= 0 ? 'none' : '';
  }
  private bandAlpha = 1;

  /** Hint pulses only while the confirm lock-out has elapsed. */
  setHintReady(ready: boolean): void {
    if (this.hint !== null) this.hint.style.opacity = String((ready ? 1 : 0.25) * this.bandAlpha);
  }

  hide(): void {
    this.layer.replaceChildren();
    this.hint?.remove(); // the hint lives in the UiRoot bottom band
    this.hint = null;
  }
}
