// PostGrade: Unity PPSv1 stage-1 grade (LUT generator + uber), CPU port.
// Evidence: tools/shaders GCN disassembly of "Hidden/Post FX/Lut Generator"
// (TONEMAPPING_FILMIC) + "Uber Shader" (COLOR_GRADING,VIGNETTE_CLASSIC) and the
// serialized profile 3d_stage_001_topdown_pp (docs/GRADING_AND_SURFACE_ANALYSIS.md).
import { describe, it, expect } from 'vitest';
import {
  STAGE1_GRADE_PROFILE, bakeGradeLut, applyGradeCpu, evalCurve, calculateColorBalance,
  slopePowerOffset, linearToLogC, logCToLinear, acesRrtOdt, vignetteFactor,
  LUT_WIDTH, LUT_SIZE, POST_GRADE_GLSL,
} from '../../src/view/stage/PostGrade';

const lut = bakeGradeLut();
const grade = (r: number, g: number, b: number) => applyGradeCpu([r, g, b], lut);
const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

describe('PostGrade profile math', () => {
  it('Unity hermite curves hit their keys and slopes', () => {
    const c = STAGE1_GRADE_PROFILE.curves.master;
    expect(evalCurve(c, 0)).toBe(0);
    expect(evalCurve(c, 1)).toBe(1);
    // h(0.5) = 0.5 + 0.125 * (m0 - m1)
    expect(evalCurve(c, 0.5)).toBeCloseTo(0.5 + 0.125 * (1.5331 - 0.033524), 4);
    expect(evalCurve([], 0.3, 0.5)).toBe(0.5);
  });
  it('log encode/decode roundtrip (uber LogC vs LUT-generator decode)', () => {
    for (const x of [0, 0.01, 0.18, 0.5, 1, 4]) {
      expect(logCToLinear(linearToLogC(x))).toBeCloseTo(x, 3);
    }
  });
  it('white balance temp+10 / tint+13 gives a warm LMS gain', () => {
    const b = calculateColorBalance(10, 13);
    expect(b[0]).toBeGreaterThan(b[2]); // long-wave gain > short-wave
    const n = calculateColorBalance(0, 0);
    expect(n[0]).toBeCloseTo(1, 1); expect(n[2]).toBeCloseTo(1, 1);
  });
  it('log wheels are small, mean-normalised adjustments', () => {
    const s = slopePowerOffset(STAGE1_GRADE_PROFILE.logWheels);
    expect(s.slope[0]).toBeCloseTo(1.0059, 3);
    expect(s.offset[2]).toBeGreaterThan(0.01); // blue lifted shadows
    expect(s.power[0]).toBeGreaterThan(1);
  });
  it('ACES RRT+ODT: black->0, monotone, 18% grey ~ 0.105 linear', () => {
    expect(acesRrtOdt([0, 0, 0]).every((v) => Math.abs(v) < 1e-3)).toBe(true);
    const g = acesRrtOdt([0.18, 0.18, 0.18]);
    expect(g[1]).toBeGreaterThan(0.095); expect(g[1]).toBeLessThan(0.12); // Hill-class fit: 0.18 -> ~0.105
    expect(acesRrtOdt([1, 1, 1])[1]).toBeGreaterThan(g[1]);
  });
});

describe('PostGrade LUT + uber', () => {
  it('LUT strip layout', () => {
    expect(lut.length).toBe(LUT_WIDTH * LUT_SIZE * 4);
    expect(LUT_WIDTH).toBe(1024);
  });
  it('is monotone along grey and lifts shadows vs plain ACES (master curve)', () => {
    const a = grade(0.02, 0.02, 0.02)[1], b = grade(0.1, 0.1, 0.1)[1], c = grade(0.5, 0.5, 0.5)[1];
    expect(a).toBeLessThan(b); expect(b).toBeLessThan(c);
    const plain = acesRrtOdt([0.1 * 1.5157, 0.1 * 1.5157, 0.1 * 1.5157]);
    expect(b).toBeGreaterThan(plain[1] * 1.05);
  });
  it('neutral grey picks up the log-wheel offset (blue shadows) and lifts overall', () => {
    const o = grade(0.18, 0.18, 0.18);
    expect(o[2]).toBeGreaterThan(o[0]);
    expect(srgb(o[1])).toBeGreaterThan(0.5); // plain ACES would give ~0.36
  });
  it('white saturates at or below 1 and never NaN', () => {
    for (const v of [grade(1, 1, 1), grade(40, 40, 40), grade(0, 0, 0), grade(0.5, 0.01, 0.9)]) {
      for (const x of v) { expect(Number.isFinite(x)).toBe(true); expect(x).toBeLessThanOrEqual(1); expect(x).toBeGreaterThanOrEqual(0); }
    }
  });
  it('vignette: 1 at centre, darker at corners, black colour', () => {
    expect(vignetteFactor([0.5, 0.5], STAGE1_GRADE_PROFILE, 16 / 9)).toBe(1);
    expect(vignetteFactor([0, 0], STAGE1_GRADE_PROFILE, 16 / 9)).toBeLessThan(0.7);
    const centre = applyGradeCpu([0.3, 0.3, 0.3], lut, STAGE1_GRADE_PROFILE, [0.5, 0.5]);
    const corner = applyGradeCpu([0.3, 0.3, 0.3], lut, STAGE1_GRADE_PROFILE, [0.02, 0.02]);
    expect(corner[1]).toBeLessThan(centre[1]);
  });
  it('mid-green grass maps to a lifted, less saturated sRGB value', () => {
    // sanity probe used in the analysis doc (linear grass-ish input)
    const o = grade(0.05, 0.20, 0.01).map(srgb);
    expect(o[1]).toBeGreaterThan(0.45);
  });
  it('GLSL exposes postGrade()', () => {
    expect(POST_GRADE_GLSL).toContain('vec3 postGrade');
    expect(POST_GRADE_GLSL).toContain('0.0734998');
  });
});

import * as THREE from 'three';
import { makeGradeLutTexture, makeGradeUniforms } from '../../src/view/stage/PostGrade';
describe('PostGrade GPU resources', () => {
  it('LUT texture is a 1024x32 half-float linear-filtered strip', () => {
    const t = makeGradeLutTexture(lut);
    expect(t.image.width).toBe(1024); expect(t.image.height).toBe(32);
    expect(t.type).toBe(THREE.HalfFloatType);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    const u = makeGradeUniforms();
    expect(u.uGradeA.value.x).toBeCloseTo(2 ** 0.6, 6);
    expect(u.uGradeA.value.y).toBeCloseTo(0.47 * 3, 6);
    expect(u.uGradeA.value.z).toBeCloseTo(0.25 * 5, 6);
  });
});
