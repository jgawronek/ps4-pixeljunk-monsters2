// src/view/ui/StageSelectScreen.ts
// Stage-select screen drawn with the original `stage_select_01` prefab art/layout
// (Q4.StageSelectController; hierarchy dump + evidence in docs/STAGE_SELECT_AND_MULTISTAGE.md).
// 1920x1080 reference space, y down. Positions below are the prefab's RectTransform anchored positions
// (top-left anchored; y negated):
//   Loc_Area_GRP        (960, 93)   stage_sel_title_bg 883x112 + area name (Font_01)
//   Loc_Stage_GRP       (48, 168)   panel bg = stage_casual_bg(395x366) | stage_normal_bg(496) | stage_expert_bg(626)
//                                   chosen by GetHighestAvailableDifficulty+1 (Animator int "Difficulty");
//                                   stage name (193,58); per-difficulty groups at y 237 / 367 / 497 (label + score
//                                   at +71); mini rainbows (perfect per difficulty) at (152,136) x offsets 0/36/71
//   Loc_Rainbow_GRP     (1776, 877) perfect_big_img 218x224 + rainbow-fragment count
//   Loc_Count_GRP       (-918,-875) coin/gem bank (inactive by default in the prefab; medal bank shown instead)
//   Stage_Guide_GRP     (960, 480)  guide_photo_bg 627x402 preview frame (original plays a stage video; the
//                                   web port shows the stage thumbnail = AreaStageInfo.stageSprite)
// Show/Hide: ShowAnimationCouroutine yields one frame then UpdateAreaPanel/UpdateStagePortal and starts the
// Animator "OnInIdle" in-animation; the clip lengths live in animator controllers (not extracted) so the
// slide/fade durations below (0.35 s) are APPROXIMATE (documented).
// Input (web mapping of the original pad scheme): arrows/WASD move the cursor, Z/X (or PageUp/PageDown, Q/E)
// change difficulty (tl_help_016), Enter/Space proceed (tl_help_015 "Start"), Esc/Backspace back (tl_help_002).

import { STAGE_CATALOG, type StageCatalogEntry } from '../../data/stageCatalog';
import type { SaveData } from '../save/SaveData';
import { DIFFICULTY_LABEL_KEYS, stageSelectRow } from '../save/StageProgress';
import type { UiAssets } from './UiAssets';
import { css, place, spriteEl, TEXT, textEl, UiRoot } from './UiDom';
import { StageSelectModel, type NavDir, type PickResult } from './StageSelectModel';
import type { StringLookup } from './WaveCalls';

export interface StageSelectCallbacks {
  onPick(result: PickResult): void;
  onBack(): void;
  /** Optional UI SFX hook (sfx_ringmenu_select / confirm / accessdenied). */
  onSfx?(name: 'select' | 'confirm' | 'denied' | 'cancel'): void;
}

const ANIM_SECONDS = 0.35;

export class StageSelectScreen {
  private readonly root: UiRoot;
  private readonly layer: HTMLDivElement;
  readonly model: StageSelectModel;
  private shown = false;
  /** Transient mini-dialog line (tl_mini_dialog_text_015 on an AreaLock opening). */
  private notice: string | null = null;
  /** Walkable-hub mode (src/main/hubSession.ts): no grid/backdrop/preview; the panel follows the portal the tikiman stands on
   *  (OnEnterStagePortal -> UpdateStagePortal) and the banner the WorldMapArea he is in (OnEnterArea -> UpdateAreaPanel). */
  private hubMode = false;
  private hubStage: number | null = null;
  private hubAreaKey: string | null = null;
  private anim = 0; // 0 hidden .. 1 shown
  private animDir = 0;
  private raf = 0;
  private last = 0;

  constructor(
    private readonly assets: UiAssets,
    private readonly t: StringLookup,
    private readonly save: SaveData,
    private readonly cb: StageSelectCallbacks,
    root?: UiRoot,
    start?: number,
  ) {
    this.model = new StageSelectModel(save, start);
    this.root = root ?? new UiRoot(22);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', display: 'none', pointerEvents: 'auto' });
    this.root.el.appendChild(this.layer);
    window.addEventListener('keydown', this.onKey, true);
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.root.el.isConnected) this.root.attach(container);
  }

  get visible(): boolean {
    return this.shown;
  }

  get isHubMode(): boolean {
    return this.hubMode;
  }

  /** Switch between the grid cursor (fallback / accessibility) and the walkable-hub panel. */
  setHubMode(on: boolean): void {
    this.hubMode = on;
    if (this.shown) this.draw();
  }

  /** Hub state: stage number of the portal underfoot (null = none) and the area-name string key (null = none). */
  setHubTarget(stage: number | null, areaKey: string | null, notice?: string | null): void {
    this.hubStage = stage;
    this.hubAreaKey = areaKey;
    if (stage !== null) { this.model.cursor = stage; this.model.clampDifficulty(); }
    if (notice !== undefined) this.notice = notice;
    if (this.shown) this.draw();
  }

  /** Hub: confirm on the portal underfoot (StagePortalSelectController.OnConfirm). */
  confirmHub(): void {
    if (this.hubMode && this.hubStage !== null) this.proceed();
  }

  show(): void {
    this.shown = true;
    this.layer.style.display = 'block';
    this.animDir = 1;
    this.draw();
    this.startAnim();
  }

  hide(): void {
    this.animDir = -1;
    this.shown = false;
    this.startAnim();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    cancelAnimationFrame(this.raf);
    this.root.el.remove();
  }

  // ---- input -----------------------------------------------------------------------------

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.shown || e.repeat) return;
    if (this.hubMode) { this.onHubKey(e); return; }
    const dirs: Record<string, NavDir> = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    };
    const d = dirs[e.code];
    if (d !== undefined) { this.notice = null; this.model.move(d); this.cb.onSfx?.('select'); this.draw(); }
    else if (e.code === 'KeyZ' || e.code === 'PageUp' || e.code === 'KeyQ') { this.model.cycleDifficulty(-1); this.cb.onSfx?.('select'); this.draw(); }
    else if (e.code === 'KeyX' || e.code === 'PageDown' || e.code === 'KeyE') { this.model.cycleDifficulty(1); this.cb.onSfx?.('select'); this.draw(); }
    else if (e.code === 'Enter' || e.code === 'Space') this.proceed();
    else if (e.code === 'Escape' || e.code === 'Backspace') { this.cb.onSfx?.('cancel'); this.cb.onBack(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** Hub keys: movement belongs to the hub (not consumed); Z/X difficulty, Enter/Space proceed on a portal, Esc back. */
  private onHubKey(e: KeyboardEvent): void {
    if (e.code === 'Enter' || e.code === 'Space') {
      if (this.hubStage === null) return; // not on a portal: the hub handles AreaLock interaction
      this.proceed();
    } else if (this.hubStage !== null && (e.code === 'KeyZ' || e.code === 'PageUp' || e.code === 'KeyQ')) { this.model.cycleDifficulty(-1); this.cb.onSfx?.('select'); this.draw(); }
    else if (this.hubStage !== null && (e.code === 'KeyX' || e.code === 'PageDown' || e.code === 'KeyE')) { this.model.cycleDifficulty(1); this.cb.onSfx?.('select'); this.draw(); }
    else if (e.code === 'Escape' || e.code === 'Backspace') { this.cb.onSfx?.('cancel'); this.cb.onBack(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private proceed(): void {
    const r = this.model.pick();
    if (r.reason === 'area-opened') { this.cb.onSfx?.('confirm'); this.notice = this.t('tl_mini_dialog_text_015', 'A new stage has appeared!'); this.draw(); return; }
    if (!r.ok) { this.cb.onSfx?.('denied'); this.notice = null; this.draw(); return; }
    this.cb.onSfx?.('confirm');
    this.cb.onPick(r);
  }

  // ---- animation ---------------------------------------------------------------------------

  private startAnim(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const step = (now: number): void => {
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.anim = Math.min(1, Math.max(0, this.anim + this.animDir * (dt / ANIM_SECONDS)));
      const e = this.anim * this.anim * (3 - 2 * this.anim);
      this.layer.style.opacity = String(e);
      this.layer.style.transform = `translateY(${(1 - e) * 24}px)`;
      if ((this.animDir > 0 && this.anim < 1) || (this.animDir < 0 && this.anim > 0)) this.raf = requestAnimationFrame(step);
      else if (this.animDir < 0) this.layer.style.display = 'none';
    };
    this.raf = requestAnimationFrame(step);
  }

  // ---- drawing -----------------------------------------------------------------------------

  private f1(text: string, x: number, y: number, o: { scale?: number; tint?: string; align?: 'left' | 'right' | 'center'; outline?: { color: string; width: number } } = {}): HTMLElement {
    const a = o.align ?? 'center';
    const el = textEl(this.assets, 'Font_01', text, {
      scale: o.scale ?? 1, tint: o.tint ?? TEXT.body.tint, outline: o.outline ?? TEXT.body.outline, tracking: -6, px: 46 * (o.scale ?? 1), align: a,
    });
    place(el, x, y, { anchor: a === 'center' ? 'center' : a });
    return el;
  }

  private draw(): void {
    const L = this.layer;
    L.textContent = '';
    const A = this.assets;
    const T = this.t;
    const m = this.model;
    const row = m.row;
    const e = m.entry;

    const hub = this.hubMode;
    // backdrop (the original shows the 3D world map; the grid fallback uses a dim tinted field, the hub shows the 3D scene)
    if (!hub) {
      const bg = document.createElement('div');
      css(bg, { position: 'absolute', inset: '0', background: 'radial-gradient(ellipse at 50% 40%, #2f6b4a 0%, #173826 60%, #0b1c14 100%)' });
      L.appendChild(bg);
    }

    // area banner (hub: only while inside a WorldMapArea trigger)
    if (!hub || this.hubAreaKey !== null) {
      const banner = spriteEl(A, 'stage_sel_title_bg');
      place(banner, 960, 93);
      L.appendChild(banner);
      L.appendChild(this.f1(hub ? T(this.hubAreaKey ?? '', '') : T(e.areaName, e.areaName), 960, 96, { scale: 1.1 }));
    }

    // stage grid: one row per area, 3 cards (web replacement of the walkable world map)
    const CW = 200, CH = 135, GX = 215, GY = 160, X0 = 860, Y0 = 270;
    const areas = hub ? 0 : Math.ceil(STAGE_CATALOG.length / 3);
    for (let a = 0; a < areas; a++) {
      for (let c = 0; c < 3; c++) {
        const s = STAGE_CATALOG[a * 3 + c];
        if (s === undefined) continue;
        L.appendChild(this.card(s, X0 + (c - 1) * GX, Y0 + a * GY, CW, CH));
      }
    }

    // left info panel (Loc_Stage_GRP); hub: only while standing on a portal
    if (!hub || this.hubStage !== null) this.drawStagePanel(L, A, T, m, row, e);
    if (this.notice !== null) L.appendChild(this.f1(this.notice, 960, 1000, { scale: 0.85, tint: TEXT.gold.tint, outline: TEXT.gold.outline }));

    // preview frame (Stage_Guide_GRP, guide_photo_bg 627x402 scaled to fit) with the stage thumbnail
    if (!hub || this.hubStage !== null) this.drawPreview(L, A, e, row);
    this.drawFooter(L, A, T);
  }

  private drawStagePanel(L: HTMLElement, A: UiAssets, T: StringLookup, m: StageSelectModel, row: ReturnType<typeof stageSelectRow>, e: StageCatalogEntry): void {
    const tier = row.highestDifficulty + 1;
    const panelBg = ['stage_casual_bg', 'stage_normal_bg', 'stage_expert_bg'][tier - 1];
    const px = 48, py = 168;
    const panel = spriteEl(A, panelBg);
    place(panel, px + 197, py + A.sprites[panelBg].h / 2);
    L.appendChild(panel);
    L.appendChild(this.f1(T(e.stageName, e.stageName), px + 193, py + 58, { scale: 1.1 }));
    // mini rainbows (Loc_Mini_Rainbow_GRP) -- active = perfect on that difficulty
    ['icon_result_rainbow_01', 'icon_result_rainbow_02', 'icon_result_rainbow_03'].forEach((spr, i) => {
      if (!row.perfect[i]) return;
      const im = spriteEl(A, spr, 64, 64);
      place(im, px + 152 + [0, 36, 71][i] + 32, py + 136 + [4, -11, 4][i] + 4);
      L.appendChild(im);
    });
    for (let d = 0; d <= row.highestDifficulty; d++) {
      const gy = py + 237 + d * 130;
      const sel = d === m.difficulty;
      L.appendChild(this.f1(T(DIFFICULTY_LABEL_KEYS[d], ['Fun', 'Tricky', 'Mayhem'][d]), px + 193, gy, {
        scale: sel ? 1.0 : 0.85, tint: sel ? '#ffffff' : TEXT.dim.tint,
      }));
      L.appendChild(this.f1(row.score[d] > 0 ? String(row.score[d]) : '-', px + 194, gy + 71, { scale: 0.95, tint: row.score[d] > 0 ? TEXT.gold.tint : TEXT.dim.tint, outline: TEXT.gold.outline }));
      if (sel) {
        // web-port selection frame (the prefab has none): wraps label (centre gy, ~52 px) and score (centre gy+71, ~50 px) with 8 px padding
        const mark = document.createElement('div');
        css(mark, { position: 'absolute', left: `${px + 16}px`, top: `${gy - 34}px`, width: `${355}px`, height: '136px', border: '4px solid #ffd959', borderRadius: '18px', pointerEvents: 'none', boxSizing: 'border-box' });
        L.appendChild(mark);
      }
    }
    if (!row.unlocked) {
      const miss = m.rainbowsMissing;
      const msg = miss > 0
        ? T('tl_mini_dialog_text_011', 'You need\n{replace_01} Rainbow\nFragments!').replace('{replace_01}', String(miss)).replace(/\{c_rainbow_01\}/g, '')
        : T('tl_mini_dialog_text_009', 'Locked').replace(/\{c_rainbow_01\}/g, '');
      msg.split('\n').forEach((line, i, a) => L.appendChild(this.f1(line, px + 193, py + 190 + (i - (a.length - 1) / 2) * 44, { scale: 0.6, tint: '#ff9a7a' })));
    }
  }

  private drawPreview(L: HTMLElement, A: UiAssets, e: StageCatalogEntry, row: ReturnType<typeof stageSelectRow>): void {
    // preview frame (Stage_Guide_GRP, guide_photo_bg 627x402 scaled to fit) with the stage thumbnail
    const frame = spriteEl(A, 'guide_photo_bg', 564, 362);
    place(frame, 1580, 540);
    const thumb = document.createElement('img');
    thumb.src = `/assets/ui/stages/${e.scene}.webp`;
    css(thumb, { width: '446px', height: '246px', objectFit: 'cover', filter: row.unlocked ? 'none' : 'brightness(0.35) grayscale(0.6)' });
    thumb.onerror = () => { thumb.style.display = 'none'; };
    place(thumb, 1580, 540);
    L.appendChild(frame);
    L.appendChild(thumb);
  }

  private drawFooter(L: HTMLElement, A: UiAssets, T: StringLookup): void {
    // rainbow-fragment count (Loc_Rainbow_GRP) + medal bank
    const pf = spriteEl(A, 'perfect_big_img', 109, 112);
    place(pf, 1700, 960);
    L.appendChild(pf);
    L.appendChild(this.f1(`x ${this.save.getTotalPerfectCount()}`, 1790, 960, { align: 'left', tint: TEXT.gold.tint, outline: TEXT.gold.outline }));
    if (A.hasSprite('icon_shop_medal')) {
      const md = spriteEl(A, 'icon_shop_medal', 60, 60);
      place(md, 1130, 990);
      L.appendChild(md);
      L.appendChild(this.f1(String(this.save.medalsInTheBank), 1175, 990, { align: 'left', tint: TEXT.gold.tint, outline: TEXT.gold.outline, scale: 0.85 }));
    }

    // help bar
    const help = this.hubMode
      ? `${T('tl_help_001', 'Select')}: WASD / arrows (Shift = run)    ${T('tl_help_016', 'Difficulty')}: Z / X    ${T('tl_help_015', 'Start')}: Enter    ${T('tl_help_002', 'Back')}: Esc`
      : `${T('tl_help_001', 'Select')}: arrows    ${T('tl_help_016', 'Difficulty')}: Z / X    ${T('tl_help_015', 'Start')}: Enter    ${T('tl_help_002', 'Back')}: Esc`;
    L.appendChild(this.f1(help, 960, 1050, { scale: 0.62 }));
  }

  private card(s: StageCatalogEntry, cx: number, cy: number, w: number, h: number): HTMLElement {
    const m = this.model;
    const row = stageSelectRow(this.save, s);
    const sel = s.stage === m.cursor;
    const el = document.createElement('div');
    css(el, {
      position: 'absolute', left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`,
      borderRadius: '18px', overflow: 'hidden', boxSizing: 'border-box', pointerEvents: 'auto', cursor: 'pointer',
      border: sel ? '8px solid #ffd959' : '5px solid #6b4a22',
      transform: sel ? 'scale(1.08)' : 'none', transition: 'transform .12s',
      boxShadow: sel ? '0 0 30px rgba(255,217,89,.7)' : '0 4px 10px rgba(0,0,0,.5)',
      background: '#102018',
    });
    const img = document.createElement('img');
    img.src = `/assets/ui/stages/${s.scene}.webp`;
    css(img, { width: '100%', height: '100%', objectFit: 'cover', filter: row.unlocked ? 'none' : 'brightness(0.3) grayscale(0.7)' });
    img.onerror = () => { img.style.display = 'none'; };
    el.appendChild(img);
    const lab = this.f1(`${s.stage}`, 26, 24, { scale: 0.7 });
    el.appendChild(lab);
    if (!row.unlocked && this.assets.hasSprite('ring_cursor_lock')) {
      const lk = spriteEl(this.assets, 'ring_cursor_lock', 56, 56);
      place(lk, w / 2, h / 2);
      el.appendChild(lk);
    }
    // perfect rainbows along the bottom edge
    row.perfect.forEach((p, i) => {
      if (!p) return;
      const r = spriteEl(this.assets, `icon_result_rainbow_0${i + 1}`, 34, 34);
      place(r, w - 90 + i * 30, h - 22);
      el.appendChild(r);
    });
    el.addEventListener('pointerenter', () => { if (m.cursor !== s.stage) { m.cursor = s.stage; m.clampDifficulty(); this.cb.onSfx?.('select'); this.draw(); } });
    el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); m.cursor = s.stage; m.clampDifficulty(); this.proceed(); });
    return el;
  }
}
