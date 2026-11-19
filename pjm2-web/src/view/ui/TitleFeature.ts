// src/view/ui/TitleFeature.ts
// Title screen view (prefab title_screen_01 in level3, Q4.TitleScreenController) over the TitleModel.
//
// Layout (1920x1080 reference, derived from the level3 RectTransforms; Screen_Loc is a full-screen
// stretch so (0,-y) top-left anchors are plain pixel offsets, centre-anchored ones add (960,540)):
//   Loc_Title container TL = (0,-136):  title_m2_logo centre (930,443) 1430x512
//        title_m2_mask (skull)  ap (410,-235) pivot (1,.5) | title_m2_cover ap (469.5,-238.5)  (relative to logo TL)
//        title_number ("2") (1643,591) 329x434 | title_pixeljunk_logo_02 (957.5,75) 911x225
//   Loc_Develop title_copy (960,1013) 512x64 | Version_Loc "ver." (96,60)
//   GameStart_Loc "Press any button" (960,832) | MainScreen_Loc menu x=960, y=753 + 84*k
// Animation timings = Animator clip lengths (TitleModel); curve shapes (the clip curves live in the
// compressed muscle data) are approximated with ease-out/overshoot.

import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, TEXT, UiRoot } from './UiDom';
import { f1 } from './TitleUiKit';
import { TITLE_MASK_CLIP } from './titleMaskClip.generated';
import { TITLE_CLIPS } from './titleClips.generated';
import { TITLE_ENTRIES, TITLE_TIMES, type TitleModel } from './TitleModel';
import type { StringLookup } from './WaveCalls';

export const TITLE_LAYOUT = {
  logo: { x: 930, y: 443, w: 1430, h: 512 },
  /** relative to the logo's top-left */
  /** resting position from the LogoMonster clip at t=0 (the prefab's static 410 is overridden by the animator) */
  skull: { x: 447, y: 235 },
  cover: { x: 469.5, y: 238.5 },
  number: { x: 1643.2, y: 591.2 },
  pixeljunk: { x: 957.5, y: 75 },
  copy: { x: 960, y: 1013, w: 512, h: 64 },
  version: { x: 96, y: 60 },
  pressAny: { x: 960, y: 832 },
  menu: { x: 960, y: 753, spacing: 84 },
} as const;

/** Linear sample of a [time, value] keyframe track (clamped at both ends). */
function sampleTrack(track: readonly (readonly [number, number])[], t: number): number {
  if (track.length === 0) return 0;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t <= b[0]) return b[0] > a[0] ? a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0])) : b[1];
  }
  return track[track.length - 1][1];
}

/** Q4 title animator clip `LogoMonster` (60.2 s loop) animates ONLY title_m2_mask: anchoredPosition (x rests at 447, NOT the
 *  prefab's static 410), localEuler z, localScale x/y — pivot (1, 0.5), 74x100, relative to the logo's top-left. */
export function maskPose(clock: number): { left: number; top: number; rot: number; sx: number; sy: number } {
  const T = TITLE_MASK_CLIP;
  const t = T.loop ? clock % T.length : Math.min(clock, T.length);
  const tr = T.tracks as unknown as Record<string, readonly (readonly [number, number])[]>;
  const ax = sampleTrack(tr.x, t);
  const ay = sampleTrack(tr.y, t); // canvas y is up (negative = below the logo's top edge)
  return { left: ax - 74, top: -ay - 50, rot: sampleTrack(tr.rotZ, t), sx: sampleTrack(tr.scaleX, t), sy: sampleTrack(tr.scaleY, t) };
}

/** Exact Unity cubic segment evaluation of a decoded clip channel ([t,c0,c1,c2,c3] keys). */
export function clipValue(clip: string, node: string, prop: string, t: number): number | null {
  const keys = TITLE_CLIPS[clip]?.nodes[node]?.[prop];
  if (!keys || keys.length === 0) return null;
  const c = TITLE_CLIPS[clip];
  const tt = c.loop && c.length > 0 ? t % c.length : Math.min(Math.max(t, 0), c.length);
  let k = keys[0];
  for (const key of keys) { if (key[0] <= tt) k = key; else break; }
  const dt = tt - k[0];
  return ((k[1] * dt + k[2]) * dt + k[3]) * dt + k[4];
}

const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const backOut = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = Math.min(1, Math.max(0, x)) - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
};

export class TitleFeature {
  readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  private readonly logoWrap: HTMLDivElement;
  private readonly pj: HTMLElement;
  private readonly num: HTMLElement;
  private readonly skull: HTMLElement;
  private readonly press: HTMLElement;
  private readonly menuWrap: HTMLDivElement;
  private readonly entryOn: HTMLElement[] = [];
  private readonly entryOff: HTMLElement[] = [];
  private readonly footer: HTMLDivElement;
  private readonly footerBottom: HTMLDivElement;
  private clock = 0;
  private shownSel = -1;

  constructor(
    private readonly assets: UiAssets,
    private readonly t: StringLookup,
    private readonly model: TitleModel,
    private readonly cb: { onPointerAny(): void; onClickEntry(i: number): void; onHoverEntry(i: number): void },
    root?: UiRoot,
  ) {
    const L = TITLE_LAYOUT;
    this.root = root ?? new UiRoot(22);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'auto', overflow: 'hidden' });
    this.layer.addEventListener('pointerdown', () => cb.onPointerAny());
    this.root.el.appendChild(this.layer);

    this.logoWrap = document.createElement('div');
    css(this.logoWrap, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'none' });
    this.layer.appendChild(this.logoWrap);

    // title_m2_logo + skull peeking from the "O" (mask) + cover (front of the "O" ring).
    const logoBox = document.createElement('div');
    css(logoBox, { position: 'absolute', left: `${L.logo.x - L.logo.w / 2}px`, top: `${L.logo.y - L.logo.h / 2}px`, width: `${L.logo.w}px`, height: `${L.logo.h}px` });
    const logo = spriteEl(this.assets, 'title_m2_logo');
    css(logo, { position: 'absolute', left: '0', top: '0' });
    logoBox.appendChild(logo);
    this.skull = spriteEl(this.assets, 'title_m2_logo_mask');
    const sk = this.assets.sprites.title_m2_logo_mask;
    css(this.skull, { position: 'absolute', left: `${L.skull.x - (sk?.w ?? 74)}px`, top: `${L.skull.y - (sk?.h ?? 100) / 2}px`, transformOrigin: '100% 50%' });
    logoBox.appendChild(this.skull);
    const cover = spriteEl(this.assets, 'title_m2_logo_cover');
    const cv = this.assets.sprites.title_m2_logo_cover;
    css(cover, { position: 'absolute', left: `${L.cover.x - (cv?.w ?? 201) / 2}px`, top: `${L.cover.y - (cv?.h ?? 279) / 2}px` });
    logoBox.appendChild(cover);
    this.logoWrap.appendChild(logoBox);
    this.logoBox = logoBox;

    this.pj = spriteEl(this.assets, 'title_pixeljunk_logo_02');
    place(this.pj, L.pixeljunk.x, L.pixeljunk.y);
    this.logoWrap.appendChild(this.pj);
    this.num = spriteEl(this.assets, 'title_number');
    place(this.num, L.number.x, L.number.y);
    this.logoWrap.appendChild(this.num);

    this.footer = document.createElement('div');
    css(this.footer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'none' });
    const copy = spriteEl(this.assets, 'title_copy', L.copy.w, L.copy.h);
    place(copy, L.copy.x, L.copy.y);
    // copyright plank hugs the BOTTOM edge, the version tag the TOP edge (UiRoot bands), on any window aspect
    this.footerBottom = document.createElement('div');
    css(this.footerBottom, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none' });
    this.footerBottom.appendChild(copy);
    this.root.bottom.appendChild(this.footerBottom);
    const ver = f1(this.assets, `${t('tl_title_010', 'ver.')} 01.04`, L.version.x, L.version.y, { scale: 0.45, align: 'left', tint: TEXT.dim.tint });
    this.footer.appendChild(ver);
    this.root.top.appendChild(this.footer);

    this.press = f1(this.assets, t('tl_title_004', 'Press any button'), L.pressAny.x, L.pressAny.y, { scale: 1.05 });
    this.layer.appendChild(this.press);

    this.menuWrap = document.createElement('div');
    css(this.menuWrap, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', pointerEvents: 'none' });
    TITLE_ENTRIES.forEach((en, i) => {
      const y = L.menu.y + i * L.menu.spacing;
      const label = t(en.label, en.id);
      const off = f1(this.assets, label, L.menu.x, y, { scale: 1, tint: TEXT.dim.tint });
      const on = f1(this.assets, label, L.menu.x, y, { scale: 1.12, tint: '#ffffff' });
      for (const el of [off, on]) {
        css(el, { pointerEvents: 'auto', cursor: 'pointer' });
        el.addEventListener('pointerenter', () => this.cb.onHoverEntry(i));
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.cb.onClickEntry(i); });
      }
      this.entryOff.push(off);
      this.entryOn.push(on);
      this.menuWrap.appendChild(off);
      this.menuWrap.appendChild(on);
    });
    this.layer.appendChild(this.menuWrap);
    this.render();
  }

  private readonly logoBox: HTMLDivElement;

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  setVisible(v: boolean): void {
    this.root.el.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.root.el.remove();
  }

  update(dt: number): void {
    this.clock += dt;
    this.render();
  }

  /** Pure-ish: derive every element's transform/opacity from model.phase + progress. */
  render(): void {
    const m = this.model;
    const ph = m.phase;
    const ci = m.t; // seconds in phase
    // ---- logo group
    let logoA = 1;
    let logoDy = 0;
    let pjA = 1;
    let numS = 1;
    let numA = 1;
    let numDy = 0;
    let numRot = 0;
    if (ph === 'gate') { logoA = 0; pjA = 0; numA = 0; }
    else if (ph === 'intro') {
      // InStart clip (2.5 s): title_m2_logo y 696 -> -579 (overshoot spring), title_number y 548 -> -727 + z wobble,
      // pixeljunk logo alpha 0 -> 1 over 1.2..1.533 s (exact cubic keys, canvas y is up)
      const lg = clipValue('InStart', 'title_m2_logo', 'm_AnchoredPosition.y', ci) ?? -579;
      logoDy = -(lg + 579); logoA = 1;
      const nm = clipValue('InStart', 'title_number', 'm_AnchoredPosition.y', ci) ?? -727;
      numDy = -(nm + 727);
      numRot = clipValue('InStart', 'title_number', 'localEulerAnglesRaw.z', ci) ?? 0;
      pjA = clipValue('InStart', 'title_pixeljunk_logo', 'attr2278600012', ci) ?? 1;
      numA = 1;
    } else if (ph === 'hiding') {
      const k = easeOut(m.progress);
      logoA = 1 - k; pjA = 1 - k; numA = 1 - k;
      logoDy = -120 * k;
    } else if (ph === 'away') { logoA = 0; pjA = 0; numA = 0; }
    else if (ph === 'returning') {
      const k = easeOut(m.progress);
      logoA = k; pjA = k; numA = k; logoDy = -120 * (1 - k);
    }
    // (no idle bob: the LogoMonster clip animates only the mask, the logo itself stays put)
    this.logoBox.style.opacity = String(logoA);
    this.logoBox.style.transform = `translateY(${logoDy}px)`;
    this.pj.style.opacity = String(pjA);
    this.num.style.opacity = String(numA);
    if (ph === 'pressStart' || ph === 'startOut') {
      // StartIdle (4 s loop) / StartOut: the "2" keeps swaying
      const cl = ph === 'pressStart' ? 'StartIdle' : 'StartOut';
      const tt = ph === 'pressStart' ? this.clock : ci;
      numDy = -((clipValue(cl, 'title_number', 'm_AnchoredPosition.y', tt) ?? -727) + 727);
      numRot = clipValue(cl, 'title_number', 'localEulerAnglesRaw.z', tt) ?? 0;
    }
    this.num.style.transform = `translate(-50%, -50%) translateY(${numDy}px) rotate(${-numRot}deg) scale(${numS})`;
    // the mask pops out of the "O" at 10 s / 27 s / 53 s of the 60.2 s LogoMonster loop (exact clip tracks)
    const mp = maskPose(this.clock);
    css(this.skull, { left: `${mp.left}px`, top: `${mp.top}px`, transform: `rotate(${-mp.rot}deg) scale(${mp.sx}, ${mp.sy})` });
    // ---- footer (copyright/version) visible with the logo
    const footerA = String(ph === 'gate' ? 0 : ph === 'intro' ? easeOut((ci - 1.0) / 0.6) : ph === 'away' ? 0 : ph === 'hiding' ? 1 - easeOut(m.progress) : ph === 'returning' ? easeOut(m.progress) : 1);
    this.footer.style.opacity = footerA;
    this.footerBottom.style.opacity = footerA;
    // ---- "Press any button" blink (StartIdle)
    const showPress = ph === 'pressStart' || (ph === 'gate');
    const blink = 0.55 + 0.45 * Math.sin(this.clock * 4);
    const pressA = ph === 'gate' ? blink : ph === 'pressStart' ? blink : ph === 'startOut' ? Math.max(0, 1 - ci / 0.4) : ph === 'intro' ? 0 : 0;
    this.press.style.opacity = String(showPress || ph === 'startOut' ? pressA : 0);
    // ---- menu
    let menuA = 0;
    if (ph === 'startOut') menuA = Math.max(0, Math.min(1, (ci - 0.35) / TITLE_TIMES.out));
    else if (ph === 'menu') menuA = 1;
    else if (ph === 'hiding') menuA = 1 - easeOut(m.progress);
    else if (ph === 'returning') menuA = easeOut(m.progress);
    this.menuWrap.style.opacity = String(menuA);
    if (this.shownSel !== m.selected) {
      this.shownSel = m.selected;
    }
    this.entryOn.forEach((el, i) => { el.style.display = i === m.selected ? 'block' : 'none'; });
    this.entryOff.forEach((el, i) => { el.style.display = i === m.selected ? 'none' : 'block'; });
    this.menuWrap.style.pointerEvents = 'none';
  }
}
