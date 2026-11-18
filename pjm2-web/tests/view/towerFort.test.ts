// tests/view/towerFort.test.ts
// Q4.TowerBase.ClampDirection @0054ad00 / UpdateFortViewRotation @0054aeb0 math
// (raw-disassembly-verified formulas, see towerFort.ts header).

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../src/engine/math';
import { bodyRotation, clampFortDirection, fortAim } from '../../src/view/characters/towerFort';

const deg = (rad: number): number => (rad * 180) / Math.PI;
const elevation = (v: Vector3): number => deg(Math.atan2(v.y, Math.hypot(v.x, v.z)));

describe('clampFortDirection (ClampDirection @0054ad00)', () => {
  it('passes a flat direction through unchanged', () => {
    const r = clampFortDirection(new Vector3(1, 0, 0), -45, 0);
    expect(r.x).toBeCloseTo(1);
    expect(r.y).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(0);
  });

  it('keeps elevations inside [-fortAngleMin... 0] for tower_001 (min -45, max 0): up to 45° UP', () => {
    // signed angle is NEGATIVE when aiming up (table {+1,-1} indexed by dot(n,up) > 0).
    expect(elevation(clampFortDirection(new Vector3(0, 1, 1), -45, 0))).toBeCloseTo(45, 3);
    expect(elevation(clampFortDirection(new Vector3(0, 0.5, 1), -45, 0))).toBeCloseTo(Math.atan(0.5) * (180 / Math.PI), 3);
  });

  it('clamps steeper-than-limit elevations to the limit', () => {
    expect(elevation(clampFortDirection(new Vector3(0, 5, 1), -45, 0))).toBeCloseTo(45, 3);
    expect(elevation(clampFortDirection(new Vector3(0, 5, 1), -25, 25))).toBeCloseTo(25, 3); // tower_006
  });

  it('forbids aiming below the horizon when fortAngleMax = 0, allows it when positive', () => {
    expect(elevation(clampFortDirection(new Vector3(0, -1, 1), -45, 0))).toBeCloseTo(0, 3);
    expect(elevation(clampFortDirection(new Vector3(0, -1, 1), -25, 25))).toBeCloseTo(-25, 3);
    expect(elevation(clampFortDirection(new Vector3(0, -0.2, 1), -25, 25))).toBeCloseTo(-Math.atan(0.2) * (180 / Math.PI), 3);
  });

  it('preserves the yaw (flat heading)', () => {
    const r = clampFortDirection(new Vector3(3, 2, 4), -45, 0);
    expect(Math.atan2(r.x, r.z)).toBeCloseTo(Math.atan2(3, 4), 5);
  });

  it('degenerate inputs return the zero vector (straight up/down, zero)', () => {
    expect(clampFortDirection(new Vector3(0, 1, 0), -45, 0).sqrMagnitude).toBe(0);
    expect(clampFortDirection(new Vector3(0, 0, 0), -45, 0).sqrMagnitude).toBe(0);
  });
});

describe('fortAim (UpdateFortViewRotation)', () => {
  it('horizontal = flat yaw look; vertical = clamped full look', () => {
    const a = fortAim(new Vector3(0, 1, 1), -45, 0);
    expect(a.horizontal).not.toBeNull();
    expect(a.vertical).not.toBeNull();
    const hf = Quaternion.MultiplyVector(a.horizontal!, Vector3.forward);
    expect(hf.y).toBeCloseTo(0); // horizontal joint never pitches
    expect(hf.z).toBeCloseTo(1);
    const vf = Quaternion.MultiplyVector(a.vertical!, Vector3.forward);
    expect(vf.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('zero direction assigns neither joint (holds)', () => {
    const a = fortAim(new Vector3(0, 0, 0), -45, 0);
    expect(a.horizontal).toBeNull();
    expect(a.vertical).toBeNull();
  });

  it('straight up: horizontal not assigned (flat magnitude 0 ≤ 0.001), vertical zero → both hold', () => {
    const a = fortAim(new Vector3(0, 1, 0), -45, 0);
    expect(a.horizontal).toBeNull();
    expect(a.vertical).toBeNull();
  });
});

describe('bodyRotation (TowerBase.Start LookRotation(bodyDirection))', () => {
  it('faces the tree-species tower direction', () => {
    const d = new Vector3(-0.41066065430641174, 0, -0.911788284778595); // tree_001 serialized value
    const f = Quaternion.MultiplyVector(bodyRotation(d), Vector3.forward);
    expect(f.x).toBeCloseTo(d.x, 5);
    expect(f.z).toBeCloseTo(d.z, 5);
  });
  it('zero direction → identity (documented adaptation of the degenerate LookRotation)', () => {
    const q = bodyRotation(new Vector3(0, 0, 0));
    expect(q.w).toBe(1);
    expect(q.x).toBe(0);
  });
});
