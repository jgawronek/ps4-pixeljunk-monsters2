// src/view/stage/PostGrade.ts
// Unity Post-Processing Stack v1 grade of the stage-1 gameplay camera, ported
// from the SHIPPED compiled shaders (resources.assets: "Hidden/Post FX/Lut
// Generator" variant TONEMAPPING_FILMIC, GCN ISA disassembled with
// tools/shaders; and "Hidden/Post FX/Uber Shader" variant COLOR_GRADING +
// VIGNETTE_CLASSIC) and the serialized profile "3d_stage_001_topdown_pp"
// (BuildPlayer stages bundle, MonoBehaviour pid 172). See
// docs/GRADING_AND_SURFACE_ANALYSIS.md for the evidence.
//
// Pipeline (all in linear Rec.709 working space, HDR input):
//   uber:  c = scene * autoExposure(=1) * 2^postExposure
//          c *= lerp(vignetteColor, 1, vignetteFactor)            (classic vignette)
//          lc = LogC(c); lut = 32x32x32 strip (1024x32) sampled with the
//          shader's own manual slice lerp (lutSample()) -> display-linear
//   lut:   baked ONCE on the CPU by bakeGradeLut() = the Lut Generator pass:
//          LogC decode -> sRGB->AP0 -> ACEScc -> slope/offset/power ->
//          hue/sat/lum curves + saturation -> contrast about 0.4135884 ->
//          ACES -> AP1 -> white balance in LMS -> lift/gamma/gain -> hue shift
//          (+hue-vs-hue) -> channel mixer -> AP1->AP0 -> ACES RRT (glow, red
//          modifier, 0.96 desat, Unity's RRT+ODT rational fit) -> ODT (dim
//          surround 0.9811, 0.93 desat, D60->D65, XYZ->Rec709) -> master and
//          per-channel R/G/B curves (128x2 curve texture, bilinear).
// The output is LINEAR display colour; the three colour-space chunk applies
// the sRGB OETF (the original wrote it to an sRGB back buffer the same way).
//
// Disabled in this profile (so deliberately NOT implemented): bloom
// (m_Enabled 0), SSR, DoF, motion blur, eye adaptation, chromatic aberration,
// grain, dithering, user LUT. Fog is profile-enabled but gated by
// RenderSettings.fog = false. FXAA (preset 2) is replaced by MSAA. Ambient
// occlusion (enabled, ambientOnly, intensity 1.3, radius 0.3) needs the
// original deferred G-buffer ambient term; it is NOT ported (documented gap).

import * as THREE from 'three';

// ---- serialized profile (3d_stage_001_topdown_pp, stages bundle pid 172) ------

export interface HermiteKey { time: number; value: number; inSlope: number; outSlope: number }

export interface GradeProfile {
  postExposure: number; // EV, basic.postExposure
  temperature: number;
  tint: number;
  hueShift: number; // degrees
  saturation: number;
  contrast: number;
  channelMixer: { red: [number, number, number]; green: [number, number, number]; blue: [number, number, number] };
  /** colorWheels.mode 1 = Log: slope/power/offset (RGBA, a = 0 here). */
  logWheels: { slope: [number, number, number]; power: [number, number, number]; offset: [number, number, number] };
  curves: { master: HermiteKey[]; red: HermiteKey[]; green: HermiteKey[]; blue: HermiteKey[] };
  vignette: { intensity: number; smoothness: number; roundness: number; rounded: boolean; color: [number, number, number]; center: [number, number] };
}

export const STAGE1_GRADE_PROFILE: GradeProfile = {
  postExposure: 0.6000000238418579,
  temperature: 10,
  tint: 13,
  hueShift: -1,
  saturation: 1,
  contrast: 1.0700000524520874,
  channelMixer: { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1] },
  logWheels: {
    slope: [1.0, 0.9714181423187256, 0.8602806925773621],
    power: [0.8284944295883179, 1.0, 0.9729524254798889],
    offset: [0.6561611294746399, 0.7180211544036865, 1.0],
  },
  curves: {
    master: [
      { time: 0, value: 0, inSlope: 1.533100962638855, outSlope: 1.533100962638855 },
      { time: 1, value: 1, inSlope: 0.0335238054394722, outSlope: 0.0335238054394722 },
    ],
    red: [
      { time: 0, value: 0, inSlope: 1.115872859954834, outSlope: 1.115872859954834 },
      { time: 1, value: 1, inSlope: 0.29372072219848633, outSlope: 0.29372072219848633 },
    ],
    green: [
      { time: 0, value: 0, inSlope: 1.0255131721496582, outSlope: 1.0255131721496582 },
      { time: 1, value: 1, inSlope: 0.18304330110549927, outSlope: 0.18304330110549927 },
    ],
    blue: [
      { time: 0, value: 0, inSlope: 0.8420000076293945, outSlope: 0.8420000076293945 },
      { time: 1, value: 1, inSlope: 0, outSlope: 0 },
    ],
  },
  vignette: { intensity: 0.47, smoothness: 0.25, roundness: 1, rounded: false, color: [0, 0, 0], center: [0.5, 0.5] },
};

export const LUT_SIZE = 32;
export const LUT_WIDTH = LUT_SIZE * LUT_SIZE; // 1024
export const CURVE_TEX_WIDTH = 128;

// ---- Unity curve + PPSv1 CPU-side parameter math ---------------------------------

/** UnityEngine.AnimationCurve.Evaluate for Hermite keys (clamped). */
export function evalCurve(keys: readonly HermiteKey[], t: number, zero = 0): number {
  if (keys.length === 0) return zero;
  if (t <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.value;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].time) i++;
  const a = keys[i], b = keys[i + 1];
  const dt = b.time - a.time;
  const s = (t - a.time) / dt;
  const s2 = s * s, s3 = s2 * s;
  const m0 = a.outSlope * dt, m1 = b.inSlope * dt;
  return (2 * s3 - 3 * s2 + 1) * a.value + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b.value + (s3 - s2) * m1;
}

/** PPSv1 ColorGradingComponent.CalculateColorBalance -> LMS gain (_Balance). */
export function calculateColorBalance(temperature: number, tint: number): [number, number, number] {
  const t1 = temperature / 55;
  const t2 = tint / 55;
  const x = 0.31271 - t1 * (t1 < 0 ? 0.1 : 0.05);
  const stdY = 2.87 * x - 3 * x * x - 0.27509507;
  const y = stdY + t2 * 0.05;
  const Y = 1, X = (Y * x) / y, Z = (Y * (1 - x - y)) / y;
  const L = 0.7328 * X + 0.4296 * Y - 0.1624 * Z;
  const M = -0.7036 * X + 1.6975 * Y + 0.0061 * Z;
  const S = 0.003 * X + 0.0136 * Y + 0.9834 * Z;
  return [0.949237 / L, 1.03542 / M, 1.08728 / S];
}

function normalizeWheel(c: readonly [number, number, number]): [number, number, number] {
  const sum = (c[0] + c[1] + c[2]) / 3;
  if (Math.abs(sum) < 1e-6) return [1, 1, 1];
  return [c[0] / sum, c[1] / sum, c[2] / sum];
}
const clampV = (v: number[], lo: number, hi: number): [number, number, number] =>
  [Math.min(hi, Math.max(lo, v[0])), Math.min(hi, Math.max(lo, v[1])), Math.min(hi, Math.max(lo, v[2]))];

/** PPSv1 Log-mode wheel values -> (_Slope, _Power(inverse), _Offset). */
export function slopePowerOffset(w: GradeProfile['logWheels']): {
  slope: [number, number, number]; power: [number, number, number]; offset: [number, number, number];
} {
  const ns = normalizeWheel(w.slope), avgS = (ns[0] + ns[1] + ns[2]) / 3;
  const np = normalizeWheel(w.power), avgP = (np[0] + np[1] + np[2]) / 3;
  const no = normalizeWheel(w.offset), avgO = (no[0] + no[1] + no[2]) / 3;
  const slope = clampV(ns.map((v) => (v - avgS) * 0.1 + 1), 0, 2);
  const powRaw = np.map((v) => (v - avgP) * 0.1 + 1);
  const power = clampV(powRaw.map((v) => 1 / Math.max(0.01, v)), 0.5, 2.5);
  const offset = clampV(no.map((v) => (v - avgO) * 0.05), -0.8, 0.8);
  return { slope, power, offset };
}

// ---- ACES / ACEScc math (Unity ACES.hlsl, constants verified against the ISA) -----

type V3 = [number, number, number];
const mul3 = (m: readonly number[], v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

const SRGB_2_AP0 = [0.439701, 0.382978, 0.177335, 0.0897923, 0.813423, 0.0967616, 0.017544, 0.111544, 0.870704];
const AP0_2_AP1 = [1.45144, -0.236511, -0.214929, -0.0765538, 1.17623, -0.0996759, 0.00831615, -0.00603245, 0.997716];
const AP1_2_AP0 = [0.695452, 0.140679, 0.163869, 0.0447946, 0.859671, 0.0955343, -0.00552588, 0.00402521, 1.0015];
const AP1_2_LMS = [0.390405, 0.549941, 0.00892632, 0.0708416, 0.963172, 0.00135775, 0.0231082, 0.128021, 0.936245];
const LMS_2_AP1 = [2.85847, -1.62879, -0.024891, -0.210182, 1.1582, 0.000324281, -0.041812, -0.118169, 1.06867];
const AP1_2_XYZ = [0.662454, 0.134004, 0.156188, 0.272229, 0.674082, 0.0536895, -0.00557465, 0.00406073, 1.01034];
const XYZ_2_AP1 = [1.64102, -0.324803, -0.236425, -0.663663, 1.61533, 0.0167563, 0.0117219, -0.00828444, 0.988395];
const D60_2_D65 = [0.987224, -0.00611327, 0.0159533, -0.00759836, 1.00186, 0.0053302, 0.00307257, -0.00509595, 1.08168];
const XYZ_2_REC709 = [3.24097, -1.53738, -0.498611, -0.969244, 1.87597, 0.0415551, 0.0556301, -0.203977, 1.05697];
const AP1_LUMA: V3 = [0.272229, 0.674082, 0.0536895];

const HALF_MAX = 65504;
const ACEScc_MIDGRAY = 0.4135884;

export function acesToAcescc(x: number): number {
  const c = Math.min(HALF_MAX, Math.max(0, x));
  return c < 0.00003051757 ? (Math.log2(0.00001525878 + c * 0.5) + 9.72) / 17.52 : (Math.log2(c) + 9.72) / 17.52;
}
export function acescc_to_aces(x: number): number {
  if (x < (9.72 - 15) / 17.52) return (2 ** (x * 17.52 - 9.72) - 2 ** -16) * 2;
  if (x < (Math.log2(HALF_MAX) + 9.72) / 17.52) return 2 ** (x * 17.52 - 9.72);
  return HALF_MAX;
}

/** Sam Hocevar rgb->hsv exactly as PPSv1 (epsilon 1e-4); hue in [0,1). */
function rgbToHsv(r: number, g: number, b: number): V3 {
  // p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)), K = (0,-1/3,2/3,-1)
  const p = g >= b ? [g, b, 0, -1 / 3] : [b, g, -1, 2 / 3];
  // q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r))
  const q = r >= p[0] ? [r, p[1], p[2], p[0]] : [p[0], p[1], p[3], r];
  const d = q[0] - Math.min(q[3], q[1]);
  const e = 1e-4;
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]];
}

function hsvToRgb(h: number, s: number, v: number): V3 {
  const fract = (x: number) => x - Math.floor(x);
  const sat = (x: number) => Math.min(1, Math.max(0, x));
  const ch = (off: number) => v * (1 + s * (sat(Math.abs(fract(h + off) * 6 - 3) - 1) - 1));
  return [ch(1), ch(2 / 3), ch(1 / 3)];
}

const rgb2sat = (c: V3): number => {
  const mn = Math.min(c[0], c[1], c[2]), mx = Math.max(c[0], c[1], c[2]);
  return (Math.max(mx, 1e-10) - Math.max(mn, 1e-10)) / Math.max(mx, 0.01);
};
const rgb2yc = (c: V3): number => {
  const chroma = Math.sqrt(c[2] * (c[2] - c[1]) + c[1] * (c[1] - c[0]) + c[0] * (c[0] - c[2]));
  return (c[2] + c[1] + c[0] + 1.75 * chroma) / 3;
};
const sigmoidShaper = (x: number): number => {
  const t = Math.max(1 - Math.abs(x / 2), 0);
  const y = 1 + Math.sign(x) * (1 - t * t);
  return y / 2;
};
const glowFwd = (ycIn: number, glowGainIn: number, glowMid: number): number => {
  if (ycIn <= (2 / 3) * glowMid) return glowGainIn;
  if (ycIn >= 2 * glowMid) return 0;
  return glowGainIn * (glowMid / ycIn - 0.5);
};
const rgb2hue = (c: V3): number => {
  if (c[0] === c[1] && c[1] === c[2]) return 0;
  let hue = (180 / Math.PI) * Math.atan2(Math.sqrt(3) * (c[1] - c[2]), 2 * c[0] - c[1] - c[2]);
  if (hue < 0) hue += 360;
  return hue;
};
const centerHue = (hue: number, centerH: number): number => {
  let h = hue - centerH;
  if (h < -180) h += 360; else if (h > 180) h -= 360;
  return h;
};
const smoothstep01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Unity RRT (glow + red modifier + AP1 conversion + 0.96 desat) followed by the
 *  RRT+ODT fit and ODT (dim surround, 0.93 desat, D60->D65, XYZ->Rec709). */
export function acesRrtOdt(aces: V3): V3 {
  // --- glow ---
  const saturation = rgb2sat(aces);
  const ycIn = rgb2yc(aces);
  const s = sigmoidShaper((saturation - 0.4) / 0.2);
  const addedGlow = 1 + glowFwd(ycIn, 0.05 * s, 0.08);
  let c: V3 = [aces[0] * addedGlow, aces[1] * addedGlow, aces[2] * addedGlow];
  // --- red modifier ---
  const hue = rgb2hue(c);
  const centered = centerHue(hue, 0);
  const hueWeight = smoothstep01(1 - Math.abs((2 * centered) / 135)) ** 2;
  c[0] += hueWeight * saturation * (0.03 - c[0]) * (1 - 0.82);
  // --- to AP1, clamp, global desat 0.96 ---
  let cg = mul3(AP0_2_AP1, c).map((v) => Math.max(0, v)) as V3;
  const y1 = cg[0] * AP1_LUMA[0] + cg[1] * AP1_LUMA[1] + cg[2] * AP1_LUMA[2];
  cg = cg.map((v) => y1 + (v - y1) * 0.96) as V3;
  // --- RRT+ODT rational fit per channel ---
  const fit = (x: number) => (x * (278.509 * x + 10.7772)) / (x * (293.604 * x + 88.7122) + 80.6889);
  const post: V3 = [fit(cg[0]), fit(cg[1]), fit(cg[2])];
  // --- ODT: dim surround, desat, CAT, display primaries ---
  const XYZ = mul3(AP1_2_XYZ, post);
  const sum = Math.max(1e-4, XYZ[0] + XYZ[1] + XYZ[2]);
  let Y = Math.min(HALF_MAX, Math.max(0, XYZ[1]));
  const xc = XYZ[0] / sum;
  const yc = Math.max(1e-4, XYZ[1] / sum);
  Y = Y ** 0.9811;
  const X2 = (xc * Y) / yc, Z2 = ((1 - xc - yc) * Y) / yc;
  let lin = mul3(XYZ_2_AP1, [X2, Y, Z2]);
  const y2 = lin[0] * AP1_LUMA[0] + lin[1] * AP1_LUMA[1] + lin[2] * AP1_LUMA[2];
  lin = lin.map((v) => y2 + (v - y2) * 0.93) as V3;
  const xyz2 = mul3(AP1_2_XYZ, lin);
  return mul3(XYZ_2_REC709, mul3(D60_2_D65, xyz2));
}

// ---- LUT bake (the Lut Generator pass, CPU) --------------------------------------

/** 128x2 curve table exactly like the shader samples it:
 *  row 0 = (hueVsHue, hueVsSat, satVsSat, lumVsSat) [empty -> 0.5],
 *  row 1 = (red, green, blue, master). Texel i holds the curve at i/127. */
export function bakeCurveTable(p: GradeProfile): Float32Array {
  const out = new Float32Array(CURVE_TEX_WIDTH * 2 * 4);
  for (let i = 0; i < CURVE_TEX_WIDTH; i++) {
    const t = i / (CURVE_TEX_WIDTH - 1);
    const o0 = i * 4, o1 = (CURVE_TEX_WIDTH + i) * 4;
    out[o0] = 0.5; out[o0 + 1] = 0.5; out[o0 + 2] = 0.5; out[o0 + 3] = 0.5;
    out[o1] = evalCurve(p.curves.red, t);
    out[o1 + 1] = evalCurve(p.curves.green, t);
    out[o1 + 2] = evalCurve(p.curves.blue, t);
    out[o1 + 3] = evalCurve(p.curves.master, t);
  }
  return out;
}

/** Bilinear lookup of the curve table at u (the shader uses u = x + 1/256). */
function sampleCurve(table: Float32Array, row: number, u: number, ch: number): number {
  const px = Math.min(CURVE_TEX_WIDTH - 1, Math.max(0, u * CURVE_TEX_WIDTH - 0.5));
  const i0 = Math.floor(px), i1 = Math.min(CURVE_TEX_WIDTH - 1, i0 + 1), f = px - i0;
  const a = table[(row * CURVE_TEX_WIDTH + i0) * 4 + ch], b = table[(row * CURVE_TEX_WIDTH + i1) * 4 + ch];
  return a + (b - a) * f;
}

const sat01 = (x: number) => Math.min(1, Math.max(0, x));

/** One LUT voxel: Lut Generator fragment for linear input (r,g,b) in [0,~]. */
export function gradeVoxel(rgb: V3, p: GradeProfile, ctx: GradeContext): V3 {
  const { curves, balance, spo } = ctx;
  // sRGB -> AP0 -> ACEScc
  const aces = mul3(SRGB_2_AP0, rgb);
  let cc: V3 = [acesToAcescc(aces[0]), acesToAcescc(aces[1]), acesToAcescc(aces[2])];
  // slope / offset / power in ACEScc (power is already inverted by the CPU side)
  cc = cc.map((v, i) => {
    const t = spo.slope[i] * v + spo.offset[i];
    return t > 0 ? t ** spo.power[i] : t;
  }) as V3;
  // hue / sat / lum curves + saturation
  const hsv = rgbToHsv(cc[0], cc[1], cc[2]);
  const luma = cc[0] * 0.2126 + cc[1] * 0.7152 + cc[2] * 0.0722;
  const hvs = sat01(sampleCurve(curves, 0, hsv[0], 1)); // hueVsSat (.g)
  const svs = sat01(sampleCurve(curves, 0, hsv[1], 2)); // satVsSat (.b)
  const lvs = sat01(sampleCurve(curves, 0, luma, 3)); // lumVsSat (.a)
  const satMul = 8 * p.saturation * hvs * svs * lvs;
  cc = cc.map((v) => luma + (v - luma) * satMul) as V3;
  // contrast about ACEScc mid grey
  cc = cc.map((v) => (v - ACEScc_MIDGRAY) * p.contrast + ACEScc_MIDGRAY) as V3;
  // ACEScc -> ACES -> ACEScg
  let cg = mul3(AP0_2_AP1, [acescc_to_aces(cc[0]), acescc_to_aces(cc[1]), acescc_to_aces(cc[2])]);
  // white balance in LMS
  const lms = mul3(AP1_2_LMS, cg);
  cg = mul3(LMS_2_AP1, [lms[0] * balance[0], lms[1] * balance[1], lms[2] * balance[2]]);
  // lift / gamma / gain (neutral in Log mode: lift 0, invGamma 1, gain 1)
  // hue shift + hue-vs-hue
  const hsv2 = rgbToHsv(cg[0], cg[1], cg[2]);
  const hueSh = p.hueShift / 360 + hsv2[0];
  const hvh = sat01(sampleCurve(curves, 0, hueSh, 0));
  let h = hueSh + hvh - 0.5;
  if (h < 0) h += 1; else if (h > 1) h -= 1;
  cg = hsvToRgb(h, hsv2[1], hsv2[2]);
  // channel mixer
  const m = p.channelMixer;
  cg = [
    m.red[0] * cg[0] + m.red[1] * cg[1] + m.red[2] * cg[2],
    m.green[0] * cg[0] + m.green[1] * cg[1] + m.green[2] * cg[2],
    m.blue[0] * cg[0] + m.blue[1] * cg[1] + m.blue[2] * cg[2],
  ];
  // ACES RRT + ODT
  const out = acesRrtOdt(mul3(AP1_2_AP0, cg));
  // master then per-channel curves (sampled at x + 1/256 like the shader)
  const m0 = sat01(sampleCurve(curves, 1, out[0] + 0.00390625, 3));
  const m1 = sat01(sampleCurve(curves, 1, out[1] + 0.00390625, 3));
  const m2 = sat01(sampleCurve(curves, 1, out[2] + 0.00390625, 3));
  return [
    sat01(sampleCurve(curves, 1, m0 + 0.00390625, 0)),
    sat01(sampleCurve(curves, 1, m1 + 0.00390625, 1)),
    sat01(sampleCurve(curves, 1, m2 + 0.00390625, 2)),
  ];
}

export interface GradeContext {
  curves: Float32Array;
  balance: V3;
  spo: ReturnType<typeof slopePowerOffset>;
}

export function makeGradeContext(p: GradeProfile): GradeContext {
  return {
    curves: bakeCurveTable(p),
    balance: calculateColorBalance(p.temperature, p.tint),
    spo: slopePowerOffset(p.logWheels),
  };
}

/** LogC (Arri EI800-ish) encode / decode used around the LUT. */
export const linearToLogC = (x: number): number =>
  sat01(0.0734998 * Math.log2(5.55556 * Math.max(0, x) + 0.047996) + 0.386036);
export const logCToLinear = (x: number): number => 0.18 * 2 ** (13.6055 * x - 5.25221) - 0.00863928;

/** The 1024x32 strip, RGBA float (A = 1). x = slice(blue)*32 + red, y = green. */
export function bakeGradeLut(p: GradeProfile = STAGE1_GRADE_PROFILE): Float32Array {
  const ctx = makeGradeContext(p);
  const data = new Float32Array(LUT_WIDTH * LUT_SIZE * 4);
  for (let j = 0; j < LUT_SIZE; j++) {
    for (let i = 0; i < LUT_WIDTH; i++) {
      const slice = Math.floor(i / LUT_SIZE), ri = i % LUT_SIZE;
      const rgb: V3 = [
        logCToLinear(ri / (LUT_SIZE - 1)),
        logCToLinear(j / (LUT_SIZE - 1)),
        logCToLinear(slice / (LUT_SIZE - 1)),
      ];
      const o = gradeVoxel(rgb, p, ctx);
      const k = (j * LUT_WIDTH + i) * 4;
      data[k] = o[0]; data[k + 1] = o[1]; data[k + 2] = o[2]; data[k + 3] = 1;
    }
  }
  return data;
}

/** CPU mirror of the uber shader (for tests / probes): HDR linear -> display linear. */
export function applyGradeCpu(
  rgb: V3, lut: Float32Array, p: GradeProfile = STAGE1_GRADE_PROFILE, uv: [number, number] = [0.5, 0.5],
  aspect = 16 / 9,
): V3 {
  const ev = 2 ** p.postExposure;
  const vg = vignetteFactor(uv, p, aspect);
  const out: number[] = [];
  const lc: number[] = [];
  for (let c = 0; c < 3; c++) {
    const mix = (1 - p.vignette.color[c]) * vg + p.vignette.color[c];
    lc.push(linearToLogC(rgb[c] * ev * mix));
  }
  const b = lc[2] * (LUT_SIZE - 1);
  const slice = Math.floor(b), f = b - slice;
  const texel = (u: number, v: number, ch: number): number => {
    const px = Math.min(LUT_WIDTH - 1, Math.max(0, u * LUT_WIDTH - 0.5));
    const py = Math.min(LUT_SIZE - 1, Math.max(0, v * LUT_SIZE - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(LUT_WIDTH - 1, x0 + 1), y1 = Math.min(LUT_SIZE - 1, y0 + 1);
    const fx = px - x0, fy = py - y0;
    const g = (x: number, y: number) => lut[(y * LUT_WIDTH + x) * 4 + ch];
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  const u0 = slice / LUT_SIZE + (lc[0] * (LUT_SIZE - 1) + 0.5) / LUT_WIDTH;
  const v = (lc[1] * (LUT_SIZE - 1) + 0.5) / LUT_SIZE;
  for (let ch = 0; ch < 3; ch++) {
    const a = texel(u0, v, ch), bb = texel(u0 + 1 / LUT_SIZE, v, ch);
    out.push(sat01(a + f * (bb - a)));
  }
  return out as V3;
}

/** PPSv1 VignetteComponent: classic mode factor (1 = untouched centre). */
export function vignetteFactor(uv: [number, number], p: GradeProfile, aspect: number): number {
  const v = p.vignette;
  const intensity = v.intensity * 3;
  const smooth = v.smoothness * 5;
  const round = (1 - v.roundness) * 6 + v.roundness;
  const dx = Math.abs(uv[0] - v.center[0]) * intensity * (1 + (v.rounded ? aspect - 1 : 0));
  const dy = Math.abs(uv[1] - v.center[1]) * intensity;
  const d2 = dx ** (2 * round) + dy ** (2 * round);
  return sat01(1 - d2) ** smooth;
}

// ---- GLSL (uber pass) -----------------------------------------------------------

/** Uniform block + `vec3 postGrade(vec3 linearHdr, vec2 screenUv)`. Prepend to any
 *  fragment shader that wants to end with the stage grade; the result is
 *  display-LINEAR (apply the sRGB OETF after, e.g. #include <colorspace_fragment>). */
export const POST_GRADE_GLSL = /* glsl */ `
uniform sampler2D uGradeLut;
uniform vec4 uGradeA; // x: 2^postExposure, y: vignette intensity*3, z: smoothness*5, w: roundness'
uniform vec4 uGradeB; // xy: vignette centre, z: aspect-blend (rounded ? 1 : 0), w: aspect (w/h)
uniform vec3 uGradeVigColor;

vec3 postGrade( vec3 c, vec2 uv ) {
	vec2 d = abs( uv - uGradeB.xy ) * uGradeA.y;
	d.x *= mix( 1.0, uGradeB.w, uGradeB.z );
	d = pow( d, vec2( uGradeA.w ) );
	float vf = pow( clamp( 1.0 - dot( d, d ), 0.0, 1.0 ), uGradeA.z );
	c *= uGradeA.x * mix( uGradeVigColor, vec3( 1.0 ), vf );
	vec3 lc = clamp( 0.0734998 * log2( 5.55556 * max( c, vec3( 0.0 ) ) + 0.047996 ) + 0.386036, 0.0, 1.0 );
	float b = lc.b * 31.0;
	float slice = floor( b );
	vec2 uv0 = vec2( slice / 32.0 + ( lc.r * 31.0 + 0.5 ) / 1024.0, ( lc.g * 31.0 + 0.5 ) / 32.0 );
	vec3 a = texture2D( uGradeLut, uv0 ).rgb;
	vec3 n = texture2D( uGradeLut, uv0 + vec2( 1.0 / 32.0, 0.0 ) ).rgb;
	return clamp( mix( a, n, b - slice ), 0.0, 1.0 );
}
`;

export interface GradeUniforms {
  uGradeLut: { value: THREE.Texture | null };
  uGradeA: { value: THREE.Vector4 };
  uGradeB: { value: THREE.Vector4 };
  uGradeVigColor: { value: THREE.Vector3 };
}

export function makeGradeUniforms(p: GradeProfile = STAGE1_GRADE_PROFILE): GradeUniforms {
  const v = p.vignette;
  return {
    uGradeLut: { value: null },
    uGradeA: { value: new THREE.Vector4(2 ** p.postExposure, v.intensity * 3, v.smoothness * 5, (1 - v.roundness) * 6 + v.roundness) },
    uGradeB: { value: new THREE.Vector4(v.center[0], v.center[1], v.rounded ? 1 : 0, 16 / 9) },
    uGradeVigColor: { value: new THREE.Vector3(...v.color) },
  };
}

/** Upload the baked LUT as a half-float texture (linear filter, clamp, no mips). */
export function makeGradeLutTexture(data: Float32Array = bakeGradeLut()): THREE.DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, LUT_WIDTH, LUT_SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
