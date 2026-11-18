// src/view/ui/TitleUiKit.ts
// Shared DOM helpers + the Yes/No dialog (Q4.DialogMenuController, prefab common_dialogue_01) used by
// the title / options / credits screens. Reference space: 1920x1080 (UiDom).
//
// common_dialogue_01 (globalsettings): Loc_Dialogue_BG @ (960,396) 116x116 sliced `dialogue_bg`
// (border 54), text Mess centred on it; Loc_Dialogue_Sel_01 Yes @ (810,466), _02 No @ (1110,466),
// _03 "Got it!" @ (960,466): each 280x210 `dialogue_sel` bubble, label Font_01 colour (0.078) dark.

import type { UiAssets } from './UiAssets';
import { bleed, css, place, spriteEl, TEXT, textEl } from './UiDom';
import type { StringLookup } from './WaveCalls';

export type Align = 'left' | 'center' | 'right';

export interface F1Opts {
  scale?: number;
  tint?: string;
  outline?: { color: string; width: number } | null;
  align?: Align;
  tracking?: number;
}

/** Font_01 body text placed at (x,y) (centre-line), reference px. */
export function f1(assets: UiAssets, text: string, x: number, y: number, o: F1Opts = {}): HTMLElement {
  const a = o.align ?? 'center';
  const sc = o.scale ?? 1;
  const el = textEl(assets, 'Font_01', text, {
    scale: sc, tint: o.tint ?? TEXT.body.tint, outline: o.outline === null ? undefined : (o.outline ?? TEXT.body.outline),
    tracking: o.tracking ?? -6, px: 46 * sc, align: a,
  });
  place(el, x, y, { anchor: a });
  return el;
}

/** Font_02 (blue wooden display letters). */
export function f2(assets: UiAssets, text: string, x: number, y: number, scale = 1): HTMLElement {
  const el = textEl(assets, 'Font_02', text, { scale, tracking: -15, px: 130 * scale });
  place(el, x, y);
  return el;
}

/** Full-screen colour wash of prefab common_bg_01 (Image_Loc_BG colour (0.145,0.263,0.380) alpha 0.502):
 *  Q4.BgMenuController dims the 3D scene behind full-screen menus (UIController.showBGMenu). */
export function bgWash(): HTMLDivElement {
  const d = document.createElement('div');
  css(d, { background: 'rgba(37,67,97,0.502)', pointerEvents: 'none' });
  bleed(d); // covers the whole window, not just the 16:9 stage
  return d;
}

/** Model sfx names -> clips. Menu sounds are the real GlobalSounds clips (tools/assets/audio-out/globalsounds_map.json):
 *  menuMove=sfx_menu_selectitem, menuConfirm=sfx_menu_confirm, menuCancel=sfx_menu_cancel,
 *  menuSettingChange=sfx_menu_settingchange (UISelect.OnLeft/OnRight), menuOpen=sfx_menu_openmenu. */
export const SFX_FOR: Record<string, string> = {
  titlejingle: 'sfx/sfx_stage_titlejingle',
  select: 'sfx/sfx_menu_selectitem',
  change: 'sfx/sfx_menu_settingchange',
  confirm: 'sfx/sfx_menu_confirm',
  cancel: 'sfx/sfx_menu_cancel',
};

/** GlobalSounds.bgmCreditsScreen = sfx_tiki_creditdance (played as BGM by StaffCreditsController.Show). */
export const CREDITS_BGM = 'sfx/sfx_tiki_creditdance';
/** Title music (bgm_title; ASSUMED to play on the title: the clip exists, its AudioSource lives in the home scene). */
export const TITLE_BGM = 'bgm/bgm_title';

export interface DialogSpec {
  text: string;
  /** 'yesno' (Yes/No) or 'ok' (Got it!). */
  kind: 'yesno' | 'ok';
  yes?: boolean;
}

/** Renders the dialog (original art) into `layer`; pointer handlers call `onAnswer`. */
export function drawDialog(
  assets: UiAssets,
  t: StringLookup,
  layer: HTMLElement,
  spec: DialogSpec,
  onAnswer: (yes: boolean) => void,
  onFocus?: (yes: boolean) => void,
): void {
  const lines = spec.text.split('\n');
  const n = lines.length;
  const lineEls = lines.map((ln) => f1(assets, ln, 0, 0, { scale: 0.9, tint: '#141414', outline: null, tracking: -6 }));
  const textW = Math.max(300, ...lineEls.map((e) => (e instanceof HTMLCanvasElement ? e.width : 600)));
  const bgW = textW + 220;
  const bgH = 116 + (n - 1) * 52;
  const cy = 396 + (n - 1) * 26; // bg centre (prefab 396 for a single line)
  const bg = document.createElement('div');
  const m = assets.sprites.dialogue_bg;
  css(bg, {
    position: 'absolute', left: `${960 - bgW / 2}px`, top: `${cy - bgH / 2}px`, width: `${bgW}px`, height: `${bgH}px`,
    boxSizing: 'border-box', borderStyle: 'solid', borderWidth: '54px', borderColor: 'transparent', pointerEvents: 'none',
    borderImage: `url(${assets.spriteUrl('dialogue_bg')}) 54 fill / 54px stretch`,
  });
  if (m === undefined) css(bg, { background: '#fff6dd', borderRadius: '40px', border: '6px solid #b8742f' });
  layer.appendChild(bg);
  lineEls.forEach((el, i) => {
    place(el, 960, cy + (i - (n - 1) / 2) * 52);
    layer.appendChild(el);
  });
  const by = cy + bgH / 2 + 110;
  const btn = (key: string, fb: string, x: number, yes: boolean, on: boolean): void => {
    const wrap = document.createElement('div');
    css(wrap, { position: 'absolute', left: `${x - 140}px`, top: `${by - 105}px`, width: '280px', height: '210px', pointerEvents: 'auto', cursor: 'pointer' });
    const img = spriteEl(assets, 'dialogue_sel', 280, 210);
    css(img, { position: 'absolute', left: '0', top: '0', opacity: on ? '1' : '0.72', filter: on ? 'none' : 'saturate(0.6) brightness(0.9)' });
    wrap.appendChild(img);
    const label = f1(assets, t(key, fb), 140, 105, { scale: on ? 1 : 0.9, tint: '#141414', outline: null });
    wrap.appendChild(label);
    wrap.addEventListener('pointerenter', () => onFocus?.(yes));
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); onAnswer(yes); });
    layer.appendChild(wrap);
  };
  if (spec.kind === 'ok') btn('tl_dialog_003', 'Got it!', 960, true, true);
  else {
    btn('tl_dialog_001', 'Yes', 810, true, spec.yes !== false);
    btn('tl_dialog_002', 'No', 1110, false, spec.yes === false);
  }
}
