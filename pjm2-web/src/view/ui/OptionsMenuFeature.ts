// src/view/ui/OptionsMenuFeature.ts
// Option menu view (prefab option_01 in globalsettings, Q4.OptionMenuController) over OptionsModel.
// Reference coordinates are the prefab's (top-left anchored, y down):
//   "OPTION" Font_02 @ (960,283); caption "Options" Font_01 blue (0.145,0.733,1) @ (960,189)
//   row label x=544 (left aligned, colour 0.678 unselected), value group: arrow_left x=1153,
//   value text centred x=1274 (colour (0.878,0.243,0)), arrow_right x=1395; Controls button icon
//   action_bt_04_win @ (1326,421). Background: common_bg_01 wash over the scene.

import type { UiAssets } from './UiAssets';
import { bleed, css, place, spriteEl, TEXT, UiRoot } from './UiDom';
import { bgWash, drawDialog, f1, f2 } from './TitleUiKit';
import { OPTION_ROWS, type OptionsModel } from './OptionsModel';
import type { StringLookup } from './WaveCalls';

export const OPTION_COLORS = {
  label: '#adadad', // (0.678)
  labelOn: '#ffffff',
  value: '#e03e00', // (0.878, 0.243, 0.0)
  caption: '#26baff', // (0.145, 0.733, 1.0)
} as const;

export const OPTION_X = { label: 544, value: 1274, controlsIcon: 1326 } as const;

export interface OptionHooks {
  click?: (row: number) => void;
  hover?: (row: number) => void;
  arrow?: (row: number, d: number) => void;
  answer?: (yes: boolean) => void;
  focus?: (yes: boolean) => void;
}

export class OptionsMenuFeature {
  readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  private controlsOpen = false;

  constructor(
    private readonly assets: UiAssets,
    private readonly t: StringLookup,
    readonly model: OptionsModel,
    root?: UiRoot,
  ) {
    this.root = root ?? new UiRoot(23);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'auto', overflow: 'visible' });
    this.root.el.appendChild(this.layer);
    this.root.el.style.display = 'none';
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  show(): void {
    this.root.el.style.display = 'block';
    this.controlsOpen = false;
    this.draw();
  }

  hide(): void {
    this.root.el.style.display = 'none';
  }

  get controlsVisible(): boolean {
    return this.controlsOpen;
  }

  get visible(): boolean {
    return this.root.el.style.display !== 'none';
  }

  setControlsOpen(v: boolean): void {
    this.controlsOpen = v;
    this.draw();
  }

  /** Text for a row's current value. */
  valueText(i: number): string {
    const def = OPTION_ROWS[i]!;
    const idx = this.model.index[i]!;
    if (def.kind === 'number') return String(idx);
    if (def.kind === 'text') return this.t(def.texts![idx]!, idx === 1 ? 'ON' : 'OFF');
    return '';
  }

  draw(newHooks?: OptionHooks): void {
    if (newHooks !== undefined) this.hooks = newHooks;
    const hooks = this.hooks;
    const L = this.layer;
    L.textContent = '';
    const A = this.assets;
    const t = this.t;
    L.appendChild(bgWash());
    L.appendChild(f2(A, t('tl_option_001', 'OPTIONS'), 960, 283, 0.76));
    L.appendChild(f1(A, t('tl_option_002', 'Options'), 960, 189, { scale: 0.93, tint: OPTION_COLORS.caption, outline: TEXT.blue.outline }));
    OPTION_ROWS.forEach((def, i) => {
      const on = i === this.model.row && this.model.dialog === null;
      const lab = f1(A, t(def.label, def.id), OPTION_X.label, def.y, { align: 'left', scale: on ? 1.06 : 1, tint: on ? OPTION_COLORS.labelOn : OPTION_COLORS.label });
      L.appendChild(lab);
      const hit = document.createElement('div');
      css(hit, { position: 'absolute', left: '480px', top: `${def.y - 38}px`, width: '1000px', height: '76px', pointerEvents: 'auto', cursor: 'pointer' });
      hit.addEventListener('pointerenter', () => hooks.hover?.(i));
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const r = hit.getBoundingClientRect();
        const rel = (e.clientX - r.left) / Math.max(1, r.width);
        if (def.kind !== 'button') {
          // arrow zones: left third of the value group = decrement, right = increment
          const x = 480 + rel * 1000;
          if (x < OPTION_X.value - 40) hooks.arrow?.(i, -1);
          else if (x > OPTION_X.value + 40) hooks.arrow?.(i, 1);
          else hooks.click?.(i);
        } else hooks.click?.(i);
      });
      L.appendChild(hit);
      if (def.kind === 'button') {
        const ic = spriteEl(A, 'action_bt_04_win');
        place(ic, OPTION_X.controlsIcon, def.y - 2, { scale: 0.68 });
        L.appendChild(ic);
        return;
      }
      const idx = this.model.index[i]!;
      const arrowOpacity = on ? 1 : 0.45;
      const val = f1(A, this.valueText(i), OPTION_X.value, def.y, { tint: OPTION_COLORS.value, scale: on ? 1.06 : 1 });
      // QHorizontalLayoutGroup(spacing 40 numbers / 42 text): arrows sit half the text width + spacing from the centre
      // (prefab Sel_04: text 158 wide, arrows at +-121 = 79 + 42).
      const tw = val instanceof HTMLCanvasElement ? val.width : 120;
      const gap = tw / 2 + (def.kind === 'number' ? 40 : 42);
      const al = spriteEl(A, 'option_arrow_left');
      place(al, OPTION_X.value - gap, def.y, { opacity: idx > 0 ? arrowOpacity : 0.15 });
      L.appendChild(al);
      const ar = spriteEl(A, 'option_arrow_right');
      place(ar, OPTION_X.value + gap, def.y, { opacity: idx < def.max ? arrowOpacity : 0.15 });
      L.appendChild(ar);
      L.appendChild(val);
    });
    // help bar (tl_help_001 Select / tl_help_002 Back / tl_help_006 Reset when HasNonDefault)
    const help = [`${t('tl_help_001', 'Select')}: Enter`, `${t('tl_help_002', 'Back')}: Esc`];
    if (this.model.canReset) help.push(`${t('tl_help_006', 'Reset')}: R`);
    L.appendChild(f1(A, help.join('      '), 960, 1010, { scale: 0.6, tint: TEXT.dim.tint }));
    if (this.controlsOpen) this.drawControls(L);
    if (this.model.dialog !== null) {
      const dim = document.createElement('div');
      css(dim, { background: 'rgba(0,0,0,0.35)', pointerEvents: 'auto' });
      bleed(dim);
      L.appendChild(dim);
      drawDialog(A, t, L, { text: t(this.model.dialog.text, ''), kind: 'yesno', yes: this.model.dialog.yes },
        (y) => hooks.answer?.(y), (y) => hooks.focus?.(y));
    }
  }

  private hooks: OptionHooks = {};

  /** ControlMenuController stand-in: the web key map with the original action names. */
  private drawControls(L: HTMLElement): void {
    const A = this.assets;
    const t = this.t;
    const p = document.createElement('div');
    css(p, { background: 'rgba(0,0,0,0.55)', pointerEvents: 'auto' });
    bleed(p);
    p.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.hooks.click?.(0); });
    L.appendChild(p);
    const rows: Array<[string, string]> = [
      [t('tl_controls_010', 'Move'), 'W A S D / Arrows / Left stick'],
      [t('tl_controls_006', 'Interact'), 'E / Enter / A button'],
      [t('tl_controls_007', 'Jump'), 'Space'],
      [t('tl_controls_008', 'Rotate Camera'), 'Q / Z  (mouse wheel zoom)'],
      [t('tl_controls_004', 'Switch Camera'), 'C'],
      [t('tl_controls_003', 'Pause'), 'Esc / Start'],
    ];
    L.appendChild(f1(A, t('tl_option_003', 'Controls'), 960, 300, { scale: 1.1, tint: OPTION_COLORS.caption }));
    rows.forEach(([a, b], i) => {
      L.appendChild(f1(A, a, 560, 420 + i * 78, { align: 'left', scale: 0.9 }));
      L.appendChild(f1(A, b, 1360, 420 + i * 78, { align: 'right', scale: 0.8, tint: OPTION_COLORS.value }));
    });
  }
}
