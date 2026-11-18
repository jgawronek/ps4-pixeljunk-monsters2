import { describe, expect, it } from 'vitest';
import { DOF_PROFILES, dofBlurRadiusPx, dofCoC, dofFocalLength, dofMaxCoCRadius, dofParams, dofUrlEnabled } from '../../src/view/stage/DepthOfField';

describe('PPSv1 depth of field maths', () => {
  it('focal length: serialized mm unless useCameraFov (24 mm film height)', () => {
    expect(dofFocalLength(DOF_PROFILES.title, 50)).toBeCloseTo(0.047, 9);
    expect(dofFocalLength({ ...DOF_PROFILES.title, useCameraFov: true }, 50)).toBeCloseTo(0.012 / Math.tan((25 * Math.PI) / 180), 9);
  });
  it('max CoC radius = min(5 %, (4*kernel + 6) / height)', () => {
    expect(dofMaxCoCRadius(1, 1080)).toBeCloseTo(10 / 1080, 9);
    expect(dofMaxCoCRadius(3, 100)).toBe(0.05);
  });
  it('stage behind profile (focus 2 m, f/3.5, 35 mm): in focus at 2 m, far field grows and saturates', () => {
    const p = dofParams(DOF_PROFILES.stageBehind, 60, 1080);
    expect(p.lensCoeff).toBeCloseTo(0.035 ** 2 / (3.5 * (2 - 0.035) * 0.048), 9);
    expect(dofCoC(2, p)).toBeCloseTo(0, 9);
    expect(dofCoC(30, p)).toBeGreaterThan(0);
    expect(dofCoC(30, p)).toBeLessThan(p.maxCoC);
    expect(dofCoC(1, p)).toBeLessThan(0); // near field is negative
    expect(dofCoC(1e6, p)).toBeCloseTo(p.lensCoeff, 6); // far limit = lensCoeff (3.7 px of 1080 here)
    expect(dofCoC(1e6, { ...p, maxCoC: 0.001 })).toBe(0.001); // clamped
    expect(dofBlurRadiusPx(dofCoC(30, p), 1080)).toBeGreaterThan(3);
  });
  it('?dof=0 disables', () => {
    expect(dofUrlEnabled('')).toBe(true);
    expect(dofUrlEnabled('?dof=0')).toBe(false);
    expect(dofUrlEnabled('?x=1&dof=off')).toBe(false);
  });
});
