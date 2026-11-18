// src/view/particles/ExtractedEmitter.ts
// Contract + mapping for REAL Unity ParticleSystem settings extracted from the
// game bundles by tools/assets/extract_particles.py (public/assets/particles/
// particles.json). Replaces hand-tuned BurstOpts guesses with the original's
// actual emitter parameters.
//
// FIDELITY STATUS: EXTRACTED (settings are the original's; the CPU pool still
// approximates the rendering — see caveats below). View-only; no sim impact.
//
// Unity 5.6 semantics baked into the JSON (see extract_particles.py header):
//   MinMaxCurve.minMaxState = ParticleSystemCurveMode
//     0=constant, 1=curve, 2=twoCurves, 3=twoConstants  (2/3 NOT the naive order)
//   start values are {min,max} ranges; curve modes were sampled at 8 points.
//   startColor representative rgba = maxColor; randomBetween flag for two-colors.
//
// MAPPING CAVEATS (documented adaptations to the static BurstOpts contract):
//   * gravity = mid(gravityModifier) * -9.81 * WORLD_SCALE. The port renders in
//     Unity units 1:1 (toThree mirrors X only), so WORLD_SCALE = 1. Positive
//     gravityModifier -> downward (negative) acceleration, matching Unity.
//   * up-bias: cone-family shapes map angle -> cot(angle) (clamped) so the pool's
//     biased-sphere spread ~ atan(1/up) reproduces the cone half-angle; hemisphere
//     -> 1; everything else -> 0 (isotropic).
//   * count: sum of time-0 burst counts (representative round((min+max)/2)); if no
//     bursts, a rate*duration snapshot; capped at maxParticles.
//   * fade: derived from colorOverLifetime (alpha->0 for smoke, color->black for
//     additive sparks); a fraction-of-life approximation.
//   * sizeOverLifetime is recorded but NOT applied (static burst size = startSize).
//   * startColor alpha is recorded but BurstOpts.color is RGB-only.
//   * prefab transform scale is not captured; sizes/speeds are raw Unity values.

import * as THREE from 'three';
import type { BurstOpts } from './ParticleSystem';

/** Unity's Physics.gravity.y; gravityModifier multiplies this. */
export const UNITY_GRAVITY = -9.81;
/** Port renders Unity units 1:1 (view mirrors X only) — no extra gravity scale. */
export const WORLD_SCALE = 1;
/** Clamp on the cone up-bias so near-zero angles don't diverge (cot -> inf). */
export const CONE_UP_CAP = 4;
/** Fallback fade fraction when no colorOverLifetime fade is detectable. */
export const DEFAULT_FADE = 0.35;

// ------------------------------------------------------------------ types --

/** A MinMaxCurve reduced to a range. Curve modes carry 8-point `samples`. */
export interface MinMaxRange {
  min: number;
  max: number;
  /** ParticleSystemCurveMode name: constant | curve | twoCurves | twoConstants. */
  mode?: string;
  minMaxState?: number;
  samples?: { min?: number[]; max?: number[] };
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** startColor: representative rgba (= maxColor) + random-between metadata. */
export interface StartColor extends RGBA {
  mode?: string;
  minMaxState?: number;
  randomBetween?: boolean;
  minColor?: RGBA;
  note?: string;
}

/** One EmissionModule burst. `count` = round((minCount+maxCount)/2). */
export interface EmitterBurst {
  time: number;
  count: number;
  minCount?: number;
  maxCount?: number;
  cycleCount?: number;
  repeatInterval?: number;
}

export interface Emission {
  rate: MinMaxRange;
  bursts: EmitterBurst[];
}

/** ShapeModule. `typeId` is the Unity 5.6 ParticleSystemShapeType value. */
export interface EmitterShape {
  type: string;
  typeId: number;
  enabled: boolean;
  radius: number;
  angle: number;
  box?: { x: number; y: number; z: number };
}

export interface GradientColorKey {
  time: number;
  r: number;
  g: number;
  b: number;
}

export interface GradientAlphaKey {
  time: number;
  a: number;
}

export interface Gradient {
  color: GradientColorKey[];
  alpha: GradientAlphaKey[];
}

export interface ColorOverLifetime {
  enabled: boolean;
  mode?: string;
  minMaxState?: number;
  gradient: Gradient;
}

export interface SizeOverLifetime {
  enabled: boolean;
  scalar: number;
  mode?: string;
  minMaxState?: number;
  /** maxCurve samples x scalar over normalized lifetime (8 points). */
  samples: number[];
  samplesMin?: number[];
  min: number;
  max: number;
}

export interface TextureRef {
  name: string | null;
  file: string | null;
  note?: string;
}

/** One extracted Unity ParticleSystem (the particles.json per-emitter record). */
export interface EmitterRecord {
  name: string;
  bundle?: string;
  duration: number;
  looping: boolean;
  maxParticles: number;
  startLifetime: MinMaxRange;
  startSpeed: MinMaxRange;
  startSize: MinMaxRange;
  startColor: StartColor;
  gravityModifier: MinMaxRange;
  emission: Emission;
  shape: EmitterShape;
  colorOverLifetime: ColorOverLifetime | null;
  sizeOverLifetime: SizeOverLifetime | null;
  texture?: TextureRef;
}

/** Top-level particles.json wrapper (also accepts a bare EmitterRecord[]). */
export interface EmitterFile {
  version?: number;
  emitters: EmitterRecord[];
  [key: string]: unknown;
}

// -------------------------------------------------------------- validation --

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function asObject(x: unknown, field: string): Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    throw new Error(`particles.json: ${field} must be an object`);
  }
  return x as Record<string, unknown>;
}

function reqRange(x: unknown, field: string): MinMaxRange {
  const o = asObject(x, field);
  if (!isFiniteNum(o.min) || !isFiniteNum(o.max)) {
    throw new Error(`particles.json: ${field}.min/max must be finite numbers`);
  }
  return o as unknown as MinMaxRange;
}

function reqRGBA(x: unknown, field: string): RGBA {
  const o = asObject(x, field);
  for (const k of ['r', 'g', 'b', 'a'] as const) {
    if (!isFiniteNum(o[k])) {
      throw new Error(`particles.json: ${field}.${k} must be a finite number`);
    }
  }
  return o as unknown as RGBA;
}

function validateRecord(x: unknown, index: number): EmitterRecord {
  const o = asObject(x, `emitters[${index}]`);
  const label = typeof o.name === 'string' ? o.name : `emitters[${index}]`;
  const fail = (msg: string): never => {
    throw new Error(`particles.json: ${label}: ${msg}`);
  };

  if (typeof o.name !== 'string' || o.name.length === 0) fail('name must be a non-empty string');
  if (!isFiniteNum(o.duration)) fail('duration must be a finite number');
  if (typeof o.looping !== 'boolean') fail('looping must be a boolean');
  if (!isFiniteNum(o.maxParticles)) fail('maxParticles must be a finite number');

  const startLifetime = reqRange(o.startLifetime, `${label}.startLifetime`);
  const startSpeed = reqRange(o.startSpeed, `${label}.startSpeed`);
  const startSize = reqRange(o.startSize, `${label}.startSize`);
  const gravityModifier = reqRange(o.gravityModifier, `${label}.gravityModifier`);
  const startColor = reqRGBA(o.startColor, `${label}.startColor`) as StartColor;

  const em = asObject(o.emission, `${label}.emission`);
  const rate = reqRange(em.rate, `${label}.emission.rate`);
  if (!Array.isArray(em.bursts)) fail('emission.bursts must be an array');
  const bursts: EmitterBurst[] = (em.bursts as unknown[]).map((b, i) => {
    const bo = asObject(b, `${label}.emission.bursts[${i}]`);
    if (!isFiniteNum(bo.time) || !isFiniteNum(bo.count)) {
      fail(`emission.bursts[${i}].time/count must be finite numbers`);
    }
    return bo as unknown as EmitterBurst;
  });

  const sh = asObject(o.shape, `${label}.shape`);
  if (typeof sh.type !== 'string') fail('shape.type must be a string');
  if (!isFiniteNum(sh.typeId)) fail('shape.typeId must be a finite number');
  if (typeof sh.enabled !== 'boolean') fail('shape.enabled must be a boolean');
  if (!isFiniteNum(sh.radius) || !isFiniteNum(sh.angle)) {
    fail('shape.radius/angle must be finite numbers');
  }

  let colorOverLifetime: ColorOverLifetime | null = null;
  if (o.colorOverLifetime !== null && o.colorOverLifetime !== undefined) {
    const co = asObject(o.colorOverLifetime, `${label}.colorOverLifetime`);
    asObject(co.gradient, `${label}.colorOverLifetime.gradient`);
    colorOverLifetime = co as unknown as ColorOverLifetime;
  }
  let sizeOverLifetime: SizeOverLifetime | null = null;
  if (o.sizeOverLifetime !== null && o.sizeOverLifetime !== undefined) {
    sizeOverLifetime = asObject(o.sizeOverLifetime, `${label}.sizeOverLifetime`) as unknown as SizeOverLifetime;
  }

  return {
    name: o.name as string,
    bundle: typeof o.bundle === 'string' ? o.bundle : undefined,
    duration: o.duration as number,
    looping: o.looping as boolean,
    maxParticles: o.maxParticles as number,
    startLifetime,
    startSpeed,
    startSize,
    startColor,
    gravityModifier,
    emission: { rate, bursts },
    shape: sh as unknown as EmitterShape,
    colorOverLifetime,
    sizeOverLifetime,
    texture: (o.texture as TextureRef | undefined) ?? undefined,
  };
}

/** Parse + validate particles.json (wrapper `{emitters:[...]}` or a bare array).
 *  Throws on any malformed record. */
export function parseEmitterFile(json: unknown): EmitterRecord[] {
  let arr: unknown[];
  if (Array.isArray(json)) {
    arr = json;
  } else if (typeof json === 'object' && json !== null && Array.isArray((json as EmitterFile).emitters)) {
    arr = (json as EmitterFile).emitters;
  } else {
    throw new Error('particles.json: expected an emitter array or an {emitters:[...]} wrapper');
  }
  return arr.map((rec, i) => validateRecord(rec, i));
}

// ----------------------------------------------------------------- mapping --

function mid(r: MinMaxRange): number {
  return (r.min + r.max) / 2;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Cone half-angle (deg) -> up-bias. up = cot(angle) makes the pool's biased-
 *  sphere max spread ~ atan(1/up) = angle; clamped to [0, CONE_UP_CAP]. */
export function coneUpBias(angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  if (a <= 1e-4) return CONE_UP_CAP;
  return Math.min(CONE_UP_CAP, Math.max(0, Math.cos(a) / Math.sin(a)));
}

/** Unity 5.6 shape typeId -> up-bias. Cone family (4/7/8/9) uses the angle;
 *  hemisphere (2/3) biases up; everything else is isotropic. Disabled shape -> 0. */
export function shapeUpBias(shape: EmitterShape): number {
  if (!shape.enabled) return 0;
  switch (shape.typeId) {
    case 4: // Cone
    case 7: // ConeShell
    case 8: // ConeVolume
    case 9: // ConeVolumeShell
      return coneUpBias(shape.angle);
    case 2: // Hemisphere
    case 3: // HemisphereShell
      return 1;
    default:
      return 0;
  }
}

/** Representative spawn count: sum of time-0 bursts, else first burst, else a
 *  rate*duration snapshot; capped at maxParticles. */
export function emitterCount(rec: EmitterRecord): number {
  const bursts = rec.emission.bursts;
  let count: number;
  const atZero = bursts.filter((b) => b.time <= 1e-6);
  if (atZero.length > 0) {
    count = atZero.reduce((s, b) => s + b.count, 0);
  } else if (bursts.length > 0) {
    count = bursts[0].count;
  } else {
    count = Math.round(rec.emission.rate.max * rec.duration);
  }
  return Math.max(0, Math.min(count, rec.maxParticles));
}

function luminance(k: GradientColorKey): number {
  return 0.299 * k.r + 0.587 * k.g + 0.114 * k.b;
}

/** Derive a fade fraction from colorOverLifetime: alpha->0 (smoke) or
 *  color->black (additive sparks). Returns the trailing fraction of life over
 *  which the effect fades; DEFAULT_FADE when no fade is detectable. */
export function deriveFade(col: ColorOverLifetime | null): number {
  if (!col || !col.enabled || !col.gradient) return DEFAULT_FADE;
  const { alpha, color } = col.gradient;
  if (alpha && alpha.length > 0 && alpha[alpha.length - 1].a <= 0.05) {
    const maxA = Math.max(...alpha.map((k) => k.a));
    let tHold = 0;
    for (const k of alpha) if (k.a >= maxA - 1e-3) tHold = k.time;
    return clamp01(1 - tHold);
  }
  if (color && color.length > 0 && luminance(color[color.length - 1]) <= 0.05) {
    const maxL = Math.max(...color.map(luminance));
    let tHold = 0;
    for (const k of color) if (luminance(k) >= maxL - 1e-3) tHold = k.time;
    return clamp01(1 - tHold);
  }
  return DEFAULT_FADE;
}

/** Map an extracted emitter record to the existing BurstOpts contract.
 *  `three` is injectable for tests; defaults to the real three namespace. */
export function emitterToBurstOptions(
  rec: EmitterRecord,
  position: THREE.Vector3,
  three: typeof THREE = THREE,
): BurstOpts {
  return {
    position,
    count: emitterCount(rec),
    life: [rec.startLifetime.min, rec.startLifetime.max] as [number, number],
    speed: [rec.startSpeed.min, rec.startSpeed.max] as [number, number],
    size: [rec.startSize.min, rec.startSize.max] as [number, number],
    up: shapeUpBias(rec.shape),
    gravity: mid(rec.gravityModifier) * UNITY_GRAVITY * WORLD_SCALE,
    color: new three.Color(rec.startColor.r, rec.startColor.g, rec.startColor.b),
    fade: deriveFade(rec.colorOverLifetime),
  };
}
