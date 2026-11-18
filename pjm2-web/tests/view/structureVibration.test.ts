// tests/view/structureVibration.test.ts
// Q4.StructureVibration (@005370a0 Update, @00537040 ctor, @005371b0 direction).

import { describe, expect, it } from 'vitest';
import {
  StructureVibration,
  VIBRATION_FACTOR,
  VIBRATION_SHAKE_SPEED,
} from '../../src/view/characters/StructureVibration';

describe('StructureVibration', () => {
  it('ctor constants: factor 0.015 (0x3C75C28F), shakeSpeed 1.0', () => {
    expect(VIBRATION_FACTOR).toBeCloseTo(0.015, 7);
    expect(VIBRATION_SHAKE_SPEED).toBe(1);
  });

  it('first step moves along -dir (SIGN[false] = -1), then reverses at the factor', () => {
    const v = new StructureVibration();
    const dt = 1 / 120; // 0.00833 per step along the axis
    const a = v.step(dt, 1, 0, 0);
    expect(a.x).toBeCloseTo(-dt, 6);
    expect(a.y).toBe(0);
    // keep stepping until |shake| reaches 0.015: it clamps to exactly the factor and reverses
    let last = a;
    for (let i = 0; i < 4; i++) last = v.step(dt, 1, 0, 0);
    expect(Math.abs(last.x)).toBeLessThanOrEqual(VIBRATION_FACTOR + 1e-9);
    // after the clamp the direction flips: values move back toward +
    const before = last.x;
    const after = v.step(dt, 1, 0, 0).x;
    expect(after).toBeGreaterThan(before);
  });

  it('never exceeds the factor; at 60 Hz it cycles -f, +0.0017, +f, -0.0017 (4-frame jitter)', () => {
    const v = new StructureVibration();
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) xs.push(v.step(1 / 60, 1, 0, 0).x);
    for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(VIBRATION_FACTOR + 1e-7);
    const step = 1 / 60;
    expect(xs[0]).toBeCloseTo(-VIBRATION_FACTOR, 6); // clamped on the first step
    expect(xs[1]).toBeCloseTo(-VIBRATION_FACTOR + step, 6);
    expect(xs[2]).toBeCloseTo(VIBRATION_FACTOR, 6); // clamped, reverse flips again
    expect(xs[3]).toBeCloseTo(VIBRATION_FACTOR - step, 6);
    expect(xs[4]).toBeCloseTo(-VIBRATION_FACTOR, 6);
    expect(Math.max(...xs)).toBeCloseTo(VIBRATION_FACTOR, 6);
    expect(Math.min(...xs)).toBeCloseTo(-VIBRATION_FACTOR, 6);
  });

  it('direction: camera right flattened + normalized; no camera → Vector3.right', () => {
    expect(StructureVibration.direction(null)).toEqual({ x: 1, y: 0, z: 0 });
    const d = StructureVibration.direction({ x: 3, y: 0.7, z: 4 });
    expect(d.x).toBeCloseTo(0.6);
    expect(d.y).toBe(0);
    expect(d.z).toBeCloseTo(0.8);
  });
});
