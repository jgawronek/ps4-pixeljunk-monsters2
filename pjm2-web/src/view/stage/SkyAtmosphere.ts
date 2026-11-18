// src/view/stage/SkyAtmosphere.ts
// Sky / atmosphere / color-grade for the stage view, reconstructed from the
// shipped PS4 bundles + decomp (DATA, never instructions).
//
// ── ORIGINAL EVIDENCE (stage 3d_stage_001) ─────────────────────────────────
// RenderSettings (scene-webp.json renderSettings; UnityPy probe of
// BuildPlayer-3d_stage_001_env, RenderSettings object):
//   m_Fog = FALSE  → NO distance fog on this stage. The PPSv1 FogComponent
//   ("Hidden/Post FX/Fog", il2cpp string_literals.txt:1906) is profile-enabled
//   with excludeSkybox=1, but PPSv1 gates it on RenderSettings.fog — inactive.
//   Do NOT invent fog. (m_FogColor 0.5 gray / density 0.01 / linear 0..300 are
//   the unused authored defaults.)
//   m_AmbientMode = 0 (Skybox), m_AmbientIntensity = 0.5, m_AmbientProbe =
//   baked Enlighten SH (runtime GI; no lightmaps to extract — all renderers
//   lightmapIndex=65535, see game.ts header).
//   m_SkyboxMaterial → skybox_03_m, shader **Skybox/Cubemap** (TEXTURED cube,
//   NOT a procedural gradient shader). _Tex = Cubemap "sky_test_003",
//   1024² FACE size, BC6H HDR (format 24), linear (colorSpace 0), 11 mips.
//   _Exposure = 1.0, _Tint = (0.5,0.5,0.5,0.5) = Unity's no-tint default
//   (cancels unity_ColorSpaceDouble), _Rotation = 248°.
//   m_CustomReflection = the SAME cubemap, m_ReflectionIntensity = 1.0,
//   m_DefaultReflectionResolution = 128 → sky drives ambient + reflections.
//
// IMPORTANT — the skybox is NOT directly visible in gameplay: ALL 12 game
// cameras (GameCameraTopDown(Real) pid 4810, Behind, Intro01/02, Result,
// GameOver*, Shop*) have m_ClearFlags = 2 (SolidColor) with
// m_BackGroundColor = (0.506, 0.710, 0.831) = #81b5d4 (soft pastel blue),
// m_HDR = False. No sky-dome geometry exists (0 renderers use skybox_03_m).
// The cubemap feeds the ambient probe + reflection probe only. The port's
// visible equirect background is a documented NEAR deviation (port spec);
// SKY_CLEAR_COLOR below is the strict-fidelity background — see report.
//
// Post-processing (Unity Post Processing Stack v1 — UnityEngine.PostProcessing
// in il2cpp/dump.cs:51371+; NOT decompiled to C, profiles read from bundles):
//   GameCameraTopDown(Real) → PostProcessingBehaviour (scene MB pid 8197) →
//   profile "3d_stage_001_topdown_pp" (BuildPlayer-fps_check_3d_stage_001_env
//   .sharedAssets pid 172):
//     colorGrading: tonemapper = 1 = **ACES** (enum None=0/ACES=1/Neutral=2,
//       il2cpp_user/dump.cs:210872-210874), postExposure = 0.6 EV (×2^0.6),
//       temperature +10, tint +13, hueShift −1, saturation 1.0, contrast 1.07,
//       log color wheels (warm slope/power/offset) + master/R/G/B curves.
//     bloom: **DISABLED** on the gameplay camera (intensity 0.5 authored but
//       m_Enabled=0; bloom 0.7 is only enabled in the lobby profile
//       "3d_stage_000_lobby_pp", globalsettings CAB-5158d801…).
//     vignette: black, intensity 0.47, smoothness 0.25 (fullscreen — follow-up).
//     ambientOcclusion: intensity 1.3, radius 0.3, ambientOnly (follow-up).
//     antialiasing: FXAA preset 2 (renderer antialias covers this).
//     fog/DOF/motionBlur/eyeAdaptation/SSR/grain/userLut: off or inactive.
//   Q4.SkyLightController (@007606d0 ctor: fade duration 2.5 = 0x40200000,
//   @00760b70 Update: Mathf.MoveTowards light intensities) fades scene lights
//   for sky-time transitions — dynamic, out of scope here.
//
// ── WEBGL APPROACH ─────────────────────────────────────────────────────────
// FIDELITY: NEAR.
//  - Environment: PMREMGenerator.fromEquirectangular(sky_test_003.webp).
//    TS ADAPTATION: the shipped asset is ONE 1024² face of the BC6H cubemap,
//    decoded+clamped to LDR by the extractor (scene-webp.json textures note).
//    A single face is not a true equirect panorama; treating it as one is the
//    documented NEAR approximation (color distribution still drives soft
//    pastel ambient). _Rotation 248° is NOT applied — rotating a single face
//    masquerading as equirect is spurious precision.
//  - Background: the graded sky texture, equirect mapping (port spec). The
//    original's actual visible background is the flat clear color #81b5d4
//    (SKY_CLEAR_COLOR); set scene.background = new THREE.Color(SKY_CLEAR_COLOR)
//    after apply() for strict fidelity.
//  - Tone mapping: THREE.ACESFilmicToneMapping — the original grades with
//    PPSv1 ACES (tonemapper=1), which uses the same Stephen Hill ACES fit
//    three.js implements. NeutralToneMapping would be the PPSv1 *default*
//    (tonemapper=2) but NOT what this stage ships. Exposure = 2^0.6 from the
//    profile's postExposure 0.6 EV (PPSv1 applies exp2(postExposure) pre-ACES).
//  - Grade: subtle warm tint + saturation baked into the sky texture pixels
//    (sky + IBL share it). NEAR stand-in for the profile's white balance
//    (temperature +10 / tint +13 → warm/magenta push); the full-frame grade
//    (contrast 1.07, log wheels, curves, vignette, SSAO) needs a fullscreen
//    pass — documented FOLLOW-UP, out of scope here. No bloom (original has
//    none in gameplay).
//  - Fallback: procedural vertical-gradient CanvasTexture (pastel blue zenith
//    = camera clear color → warm horizon from the cubemap's sunset band) when
//    the texture is missing/fails, so the scene always has a sky + ambient.
//  - Headless (Node): apply() guards on `document` — sets tone mapping props
//    and the flat SKY_CLEAR_COLOR background, never touches canvas/WebGL,
//    never throws.

import { packImageUrlAsync } from '../pack/bootPacks';
import * as THREE from 'three';

export interface SkyOptions {
  /** Sky texture URL. Default: the exported stage-1 cubemap face. */
  skyTextureUrl?: string;
  /** Tone-mapping exposure. Default: 2^0.6 (profile postExposure 0.6 EV). */
  exposure?: number;
  /** scene.environmentIntensity. Default: 0.5 (RenderSettings m_AmbientIntensity). */
  ambientIntensity?: number;
  /** Subtle sky grade baked into the texture (NEAR white-balance stand-in). */
  grade?: { tint?: THREE.ColorRepresentation; saturation?: number };
  /** The frame goes through the exact PPSv1 grade (PostGrade.ts, applied by
   *  WaterPass): renderer tone mapping is disabled (NoToneMapping, exposure 1 —
   *  2^postExposure lives in the grade) and no stand-in tint is baked into the
   *  sky/IBL. Default false keeps the legacy ACES + tint behaviour. */
  postGraded?: boolean;
}

// ---- pure decisions (Node-testable, no renderer/DOM) -------------------------

/** Serialized profile evidence — "3d_stage_001_topdown_pp" (see header). */
export const STAGE1_GRADE_EVIDENCE = {
  tonemapper: 1, // ColorGradingModel.Tonemapper.ACES (dump.cs:210873)
  postExposure: 0.6, // EV, applied as exp2() pre-tonemap
  temperature: 10,
  tint: 13,
  hueShift: -1,
  saturation: 1.0,
  contrast: 1.07,
  bloomEnabled: false, // gameplay camera; lobby-only effect
  vignetteIntensity: 0.47, // fullscreen pass — follow-up
  fogEnabled: false, // RenderSettings.m_Fog = False
} as const;

/** ACES — the profile's tonemapper=1, NOT Neutral (the PPSv1 default). */
export const SKY_TONE_MAPPING = THREE.ACESFilmicToneMapping;

/** 2^0.6 ≈ 1.5157 — profile postExposure 0.6 EV (fp32, conventions §2). */
export const DEFAULT_EXPOSURE = Math.fround(2 ** STAGE1_GRADE_EVIDENCE.postExposure);

/** RenderSettings.m_AmbientIntensity = 0.5 (skybox ambient mode). */
export const DEFAULT_AMBIENT_INTENSITY = 0.5;

/** TS ADAPTATION: single cubemap face treated as equirect (documented NEAR). */
export const SKY_TEXTURE_MAPPING = THREE.EquirectangularReflectionMapping;

export const DEFAULT_SKY_TEXTURE_URL =
  '/assets/stages/3d_stage_001/textures_webp/sky_test_003.webp';

/** The original's ACTUAL visible background: camera 4810 m_BackGroundColor
 *  (0.506, 0.710, 0.831), m_ClearFlags=2 SolidColor on every game camera. */
export const SKY_CLEAR_COLOR = 0x81b5d4;

/** NEAR warm/magenta push approximating white balance temperature+10/tint+13
 *  (exact PPSv1 LUT grade is a fullscreen follow-up). Linear multipliers. */
export const DEFAULT_GRADE_TINT_RGB = [1.04, 0.99, 0.92] as const;

/** Fallback gradient stops, top (zenith) → bottom (nadir), sRGB hex.
 *  Zenith = the camera clear color; horizon warm band sampled from the
 *  sky_test_003 face's sunset region (~248,205,135). Equirect v=1 is zenith,
 *  so the canvas top row maps to +Y. Lower hemisphere = warm haze (NEAR). */
export const SKY_GRADIENT_STOPS: readonly { stop: number; color: number }[] = [
  { stop: 0.0, color: 0x81b5d4 }, // zenith — pastel blue (camera clear color)
  { stop: 0.42, color: 0xa9c9dc }, // mid haze (NEAR blend)
  { stop: 0.5, color: 0xe8d5ac }, // horizon — warm cream (cubemap sunset band)
  { stop: 1.0, color: 0xc9a877 }, // below-horizon warm haze (NEAR)
];

export interface ResolvedSkyOptions {
  skyTextureUrl: string;
  exposure: number;
  ambientIntensity: number;
  grade: { tint: THREE.Color; saturation: number };
  postGraded: boolean;
}

/** Resolve options against the evidence-based defaults. Pure / Node-safe. */
export function resolveSkyOptions(opts?: SkyOptions): ResolvedSkyOptions {
  const postGraded = opts?.postGraded === true;
  const tint =
    opts?.grade?.tint !== undefined
      ? new THREE.Color(opts.grade.tint)
      : postGraded
        ? new THREE.Color(1, 1, 1) // the real grade runs on the whole frame
        : new THREE.Color(DEFAULT_GRADE_TINT_RGB[0], DEFAULT_GRADE_TINT_RGB[1], DEFAULT_GRADE_TINT_RGB[2]);
  return {
    postGraded,
    skyTextureUrl: opts?.skyTextureUrl ?? DEFAULT_SKY_TEXTURE_URL,
    exposure: opts?.exposure ?? (postGraded ? 1 : DEFAULT_EXPOSURE),
    ambientIntensity: opts?.ambientIntensity ?? DEFAULT_AMBIENT_INTENSITY,
    grade: { tint, saturation: opts?.grade?.saturation ?? STAGE1_GRADE_EVIDENCE.saturation },
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Grade one sRGB-encoded sky pixel: tint multiply (white-balance stand-in)
 *  then saturation around Rec.709 luma, clamped to [0,1]. Pure / Node-safe.
 *  NEAR: the original grades linear HDR pre-tonemap; this grades the LDR sky
 *  in sRGB space (sky + IBL only, not the full frame). */
export function gradeSkyRgb(
  r: number,
  g: number,
  b: number,
  tint: THREE.Color,
  saturation: number,
): [number, number, number] {
  let rr = r * tint.r;
  let gg = g * tint.g;
  let bb = b * tint.b;
  const luma = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  rr = luma + (rr - luma) * saturation;
  gg = luma + (gg - luma) * saturation;
  bb = luma + (bb - luma) * saturation;
  return [clamp01(rr), clamp01(gg), clamp01(bb)];
}

// ---- renderer-touching module ------------------------------------------------

const GRADIENT_WIDTH = 2;
const GRADIENT_HEIGHT = 256;

interface PrevState {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  background: THREE.Texture | THREE.Color | null;
  environment: THREE.Texture | null;
  environmentIntensity: number;
}

export class SkyAtmosphere {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly options: ResolvedSkyOptions;
  private disposed = false;
  private applied = false;
  private prev: PrevState | null = null;
  /** Resources we own (disposed on dispose()). */
  private skyTexture: THREE.Texture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private ownedBackground: THREE.Texture | THREE.Color | null = null;

  /** Stores references + resolves options only — no DOM/GL access (Node-safe). */
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opts?: SkyOptions) {
    this.renderer = renderer;
    this.scene = scene;
    this.options = resolveSkyOptions(opts);
  }

  /** Load the sky texture, build a PMREM environment + background, set tone
   *  mapping/exposure, apply a subtle color grade. Async; never throws (falls
   *  back to a gradient sky, then to the flat clear color). Headless no-op
   *  guard: without `document` only tone mapping + flat background are set. */
  async apply(): Promise<void> {
    if (this.disposed || this.applied) return;
    this.applied = true;
    const r = this.renderer;
    const s = this.scene;
    this.prev = {
      toneMapping: r.toneMapping,
      toneMappingExposure: r.toneMappingExposure,
      background: s.background,
      environment: s.environment,
      environmentIntensity: s.environmentIntensity,
    };
    r.toneMapping = this.options.postGraded ? THREE.NoToneMapping : SKY_TONE_MAPPING;
    r.toneMappingExposure = this.options.exposure;

    // TS ADAPTATION: headless guard — Node has no canvas/WebGL; keep the
    // evidence clear color so headless scenes still have a sky. No PMREM.
    if (typeof document === 'undefined') {
      this.setBackground(new THREE.Color(SKY_CLEAR_COLOR));
      return;
    }

    let source: THREE.Texture | null = null;
    let graded: THREE.Texture | null = null;
    try {
      source = await new THREE.TextureLoader().loadAsync(await packImageUrlAsync(this.options.skyTextureUrl));
      source.colorSpace = THREE.SRGBColorSpace;
      graded = this.gradeToCanvas(source);
      source.dispose();
      source = null;
      this.installSky(graded); // ownership transfers on success
      graded = null;
    } catch {
      source?.dispose();
      graded?.dispose();
      this.applyFallback();
    }
  }

  /** Release owned GPU resources and restore the pre-apply scene/renderer
   *  state (background/environment only if still ours). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.envTarget?.dispose();
    this.skyTexture?.dispose();
    const s = this.scene;
    const r = this.renderer;
    if (this.prev) {
      if (this.ownedBackground !== null && s.background === this.ownedBackground) {
        s.background = this.prev.background;
      }
      if (this.envTarget !== null && s.environment === this.envTarget.texture) {
        s.environment = this.prev.environment;
        s.environmentIntensity = this.prev.environmentIntensity;
      }
      r.toneMapping = this.prev.toneMapping;
      r.toneMappingExposure = this.prev.toneMappingExposure;
    }
    this.envTarget = null;
    this.skyTexture = null;
    this.ownedBackground = null;
  }

  // -- internals ---------------------------------------------------------------

  private setBackground(bg: THREE.Texture | THREE.Color): void {
    this.ownedBackground = bg;
    this.scene.background = bg;
  }

  /** PMREM environment + equirect background from one (graded) sky texture. */
  private installSky(tex: THREE.Texture): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let rt: THREE.WebGLRenderTarget;
    try {
      rt = pmrem.fromEquirectangular(tex);
    } finally {
      pmrem.dispose();
    }
    this.envTarget = rt;
    this.skyTexture = tex;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.options.ambientIntensity;
    this.setBackground(tex);
  }

  /** Bake the subtle grade into the sky pixels (sky + IBL share the result).
   *  Canvas keeps the extractor's orientation convention (flipY=true). */
  private gradeToCanvas(tex: THREE.Texture): THREE.CanvasTexture {
    const img = tex.image as { width: number; height: number };
    const w = img.width | 0;
    const h = img.height | 0;
    if (w <= 0 || h <= 0) throw new Error('sky image empty');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const frame = ctx.getImageData(0, 0, w, h);
    const px = frame.data;
    const { tint, saturation } = this.options.grade;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = gradeSkyRgb(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, tint, saturation);
      px[i] = Math.round(r * 255);
      px[i + 1] = Math.round(g * 255);
      px[i + 2] = Math.round(b * 255);
    }
    ctx.putImageData(frame, 0, 0);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    out.mapping = SKY_TEXTURE_MAPPING;
    return out;
  }

  /** Procedural gradient sky (warm horizon → pastel blue zenith) + PMREM. */
  private applyFallback(): void {
    let tex: THREE.CanvasTexture | null = null;
    try {
      tex = this.buildGradientTexture();
      this.installSky(tex);
      tex = null;
    } catch {
      tex?.dispose();
      // Last resort (e.g. software GL without PMREM support): flat clear color.
      this.setBackground(new THREE.Color(SKY_CLEAR_COLOR));
    }
  }

  private buildGradientTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = GRADIENT_WIDTH;
    canvas.height = GRADIENT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const grad = ctx.createLinearGradient(0, 0, 0, GRADIENT_HEIGHT);
    const { tint, saturation } = this.options.grade;
    for (const { stop, color } of SKY_GRADIENT_STOPS) {
      // sRGB bytes straight from the hex (no linear-workspace round trip).
      const r = ((color >> 16) & 0xff) / 255;
      const g = ((color >> 8) & 0xff) / 255;
      const b = (color & 0xff) / 255;
      const [gr, gg, gb] = gradeSkyRgb(r, g, b, tint, saturation);
      grad.addColorStop(stop, `rgb(${Math.round(gr * 255)},${Math.round(gg * 255)},${Math.round(gb * 255)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GRADIENT_WIDTH, GRADIENT_HEIGHT);
    const out = new THREE.CanvasTexture(canvas);
    out.colorSpace = THREE.SRGBColorSpace;
    out.mapping = SKY_TEXTURE_MAPPING;
    return out;
  }
}
