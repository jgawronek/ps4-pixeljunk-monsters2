// src/view/ui/UiAssets.ts
// Loader + bitmap-font text renderer for the ORIGINAL in-game UI art
// (tools/assets/extract_ui_sprites.py -> public/assets/ui/{sprites,fonts}).
//
// DECOMP EVIDENCE (docs/GAME_UI_ANALYSIS.md section 2):
//  * Text in the Q4 UI is Q4.LocText (Unity UI Text subclass) whose serialized
//    `fontName` selects a CustomFont MonoBehaviour in main_assets:
//      Font_01 = "FOT-Baby Pop Std EB" white outlined body font (alpha-mask
//                atlas, tinted by LocText.textColor, outlined with
//                outlineColor black),
//      Font_02 = "FOT-Yuruka Std UB" blue-wooden display font (RGBA atlas used
//                as-is, shaderType 1) — the "WAVE START" / countdown numerals,
//      Font_00 = small number font.
//    Glyph rects are the Unity Font.m_CharacterRects (uv y-up, vert quad
//    relative to the line centre, advance), kerning from CustomFont.m_kerningList.
//  * The canvas is a CanvasScaler 1920x1080 ("ScaleWithScreenSize"), so all
//    layout numbers in this module family are in that reference space.
//
// Everything browser-only (Image/canvas) is lazy; the pure layout helpers
// (BitmapFont.layout/measure, spriteUrl) run under Node for the unit tests.

import { packImageUrl, packImageUrlAsync } from '../pack/bootPacks';

export interface GlyphDef {
  /** normalised atlas rect [x, y, w, h], origin bottom-left (Unity). */
  uv: [number, number, number, number];
  /** quad relative to the line centre: [x, top, w, -h]. */
  vert: [number, number, number, number];
  advance: number;
}

export interface FontData {
  atlas: [number, number];
  ascent: number;
  lineHeight: number;
  bearing: number;
  size: number;
  sourceFont: string;
  kerning: [string, string, number][];
  glyphs: Record<string, GlyphDef>;
}

export interface SpriteMeta {
  w: number;
  h: number;
  ppu: number;
  pivot: [number, number];
  border: [number, number, number, number];
}

/** LocText.tracking units -> pixels. The serialized values (-6 .. -15) are in
 *  the shader's tracking units; 0.33 reproduces the measured width of the
 *  reference screenshot ("WAVE START" ~1440px at 1920). APPROXIMATION. */
export const TRACKING_PX_PER_UNIT = 0.33;

export interface TextStyle {
  /** uniform scale applied to the atlas pixel metrics (rect scale * font scale). */
  scale?: number;
  /** LocText.tracking. */
  tracking?: number;
  /** Tint (CSS colour) for alpha-mask fonts; null keeps the atlas colours. */
  tint?: string | null;
  /** Outline colour + width in px (LocText.outlineColor); null = none. */
  outline?: { color: string; width: number } | null;
  align?: 'left' | 'center' | 'right';
}

export interface LaidGlyph {
  ch: string;
  x: number;
  def: GlyphDef;
}

export class BitmapFont {
  private readonly kern = new Map<string, number>();
  constructor(
    readonly data: FontData,
    public image: CanvasImageSource | null = null,
  ) {
    for (const [l, r, v] of data.kerning) this.kern.set(l + r, v);
  }

  glyph(ch: string): GlyphDef | undefined {
    return this.data.glyphs[String(ch.codePointAt(0))] ?? this.data.glyphs[String('?'.codePointAt(0))];
  }

  /** Pen layout of one line (unscaled atlas pixels). */
  layout(text: string, tracking = 0): { glyphs: LaidGlyph[]; width: number } {
    const trackPx = tracking * TRACKING_PX_PER_UNIT;
    const out: LaidGlyph[] = [];
    let pen = 0;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      const def = this.glyph(chars[i]);
      if (def === undefined) continue;
      out.push({ ch: chars[i], x: pen, def });
      pen += def.advance + trackPx + (i + 1 < chars.length ? (this.kern.get(chars[i] + chars[i + 1]) ?? 0) : 0);
    }
    return { glyphs: out, width: pen };
  }

  measure(text: string, tracking = 0): number {
    let w = 0;
    for (const line of text.split('\n')) w = Math.max(w, this.layout(line, tracking).width);
    return w;
  }
}

// ---- text -> canvas -------------------------------------------------------------

const textCache = new Map<string, HTMLCanvasElement>();

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Render `text` (may contain '\n') with `font` into a canvas. The canvas'
 *  logical anchor for alignment is returned via dataset-free metrics: the
 *  returned object carries the canvas and the offset of the pen origin. */
export function renderText(
  font: BitmapFont,
  text: string,
  style: TextStyle = {},
): { canvas: HTMLCanvasElement; padX: number; padY: number; width: number; height: number } {
  const scale = style.scale ?? 1;
  const tracking = style.tracking ?? 0;
  const outlineW = style.outline?.width ?? 0;
  const pad = Math.ceil(outlineW) + 2;
  const lines = text.split('\n');
  const lineH = font.data.lineHeight * scale;
  const laid = lines.map((l) => font.layout(l, tracking));
  const maxW = Math.max(...laid.map((l) => l.width)) * scale;
  const W = maxW + pad * 2;
  const H = lineH * lines.length + pad * 2;

  const key = `${font.data.sourceFont}|${text}|${scale}|${tracking}|${style.tint}|${outlineW}|${style.outline?.color}|${style.align}`;
  const hit = textCache.get(key);
  if (hit !== undefined) return { canvas: hit, padX: pad, padY: pad, width: maxW, height: lineH * lines.length };

  const ink = mk(W, H);
  const ictx = ink.getContext('2d')!;
  const img = font.image;
  const [aw, ah] = font.data.atlas;
  if (img !== null) {
    for (let li = 0; li < lines.length; li++) {
      const lw = laid[li].width * scale;
      const ox = style.align === 'center' ? (maxW - lw) / 2 : style.align === 'right' ? maxW - lw : 0;
      const cy = pad + li * lineH + lineH / 2;
      for (const g of laid[li].glyphs) {
        const { uv, vert } = g.def;
        const sw = uv[2] * aw;
        const sh = uv[3] * ah;
        if (sw < 1 || sh < 1) continue;
        ictx.drawImage(
          img,
          uv[0] * aw, (1 - uv[1] - uv[3]) * ah, sw, sh,
          pad + ox + (g.x + vert[0]) * scale, cy - vert[1] * scale, vert[2] * scale, -vert[3] * scale,
        );
      }
    }
  }
  const tintLayer = (color: string): HTMLCanvasElement => {
    const c = mk(W, H);
    const x = c.getContext('2d')!;
    x.drawImage(ink, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  };
  const out = mk(W, H);
  const octx = out.getContext('2d')!;
  if (style.outline && outlineW > 0) {
    const sil = tintLayer(style.outline.color);
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      octx.drawImage(sil, Math.cos(a) * outlineW, Math.sin(a) * outlineW);
    }
  }
  octx.drawImage(style.tint ? tintLayer(style.tint) : ink, 0, 0);
  textCache.set(key, out);
  if (textCache.size > 400) textCache.delete(textCache.keys().next().value as string);
  return { canvas: out, padX: pad, padY: pad, width: maxW, height: lineH * lines.length };
}

// ---- asset bundle -----------------------------------------------------------------

export interface UiAssets {
  base: string;
  fonts: { Font_00: BitmapFont | null; Font_01: BitmapFont | null; Font_02: BitmapFont | null };
  sprites: Record<string, SpriteMeta>;
  /** tower prefab name -> sprite name (TowerBase.towerIcon). */
  towerIcons: Record<string, string>;
  spriteUrl(name: string): string;
  hasSprite(name: string): boolean;
}

export function emptyUiAssets(base = '/assets/ui/'): UiAssets {
  return {
    base,
    fonts: { Font_00: null, Font_01: null, Font_02: null },
    sprites: {},
    towerIcons: {},
    // packed sprites -> blob: URL once the sprite pack is in memory, else the loose file
    spriteUrl: (n) => packImageUrl(`${base}sprites/${n}.png`),
    hasSprite: () => false,
  };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const src = await packImageUrlAsync(url); // packed (lossless WebP) bytes when available
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`image ${url}`));
    im.src = src;
  });
}

/** Cosmetic: any failure leaves that part null/empty — never throws. */
export async function loadUiAssets(base = '/assets/ui/'): Promise<UiAssets> {
  const a = emptyUiAssets(base);
  try {
    const r = await fetch(`${base}sprites.json`);
    if (r.ok) a.sprites = (await r.json()) as Record<string, SpriteMeta>;
  } catch { /* fallback: no sprites */ }
  try {
    const r = await fetch(`${base}tower-icons.json`);
    if (r.ok) a.towerIcons = (await r.json()) as Record<string, string>;
  } catch { /* none */ }
  a.hasSprite = (n) => n in a.sprites;
  await Promise.all(
    (['Font_00', 'Font_01', 'Font_02'] as const).map(async (name) => {
      try {
        const [jr, img] = await Promise.all([fetch(`${base}fonts/${name}.json`), loadImage(`${base}fonts/${name}.png`)]);
        if (jr.ok) a.fonts[name] = new BitmapFont((await jr.json()) as FontData, img);
      } catch { /* null font -> DOM fallback text */ }
    }),
  );
  return a;
}
