// tests/engine/math-rng.test.ts
// Determinism + Unity-parity tests for engine/math and engine/rng.
// RNG golden vectors are UNITY-VERIFIED values (published parity testing of
// real Unity 4.7–2020.1 with InitState(1234), sequential draws) — they pin the
// implementation to the console's exact integer stream. Float paths are
// near-parity (±1ulp class), tolerance-checked.

import { describe, expect, it } from 'vitest';

import { Mathf, Quaternion, Vector2, Vector3 } from '../../src/engine/math';
import { UnityRandom } from '../../src/engine/rng/UnityRandom';

const f = Math.fround;

describe('Mathf fp32 discipline', () => {
  it('lerp clamps and interpolates', () => {
    expect(Mathf.Lerp(0, 10, 0.25)).toBeCloseTo(2.5, 6);
    expect(Mathf.Lerp(0, 10, 2)).toBe(10); // clamped
    expect(Mathf.Lerp(0, 10, -1)).toBe(0);
  });

  it("RoundToInt is banker's rounding (C# Math.Round ToEven)", () => {
    expect(Mathf.RoundToInt(0.5)).toBe(0);
    expect(Mathf.RoundToInt(1.5)).toBe(2);
    expect(Mathf.RoundToInt(2.5)).toBe(2);
    expect(Mathf.RoundToInt(3.5)).toBe(4);
    expect(Mathf.RoundToInt(-0.5)).toBe(0);
    expect(Mathf.RoundToInt(-1.5)).toBe(-2);
    expect(Mathf.RoundToInt(-2.5)).toBe(-2);
    // wave-interest example: 400 coins × 1.05 → 420 (no midpoint)
    expect(Mathf.RoundToInt(f(400 * 1.05))).toBe(420);
  });

  it('FloorToInt/CeilToInt truncate toward -inf/+inf', () => {
    expect(Mathf.FloorToInt(-0.2)).toBe(-1);
    expect(Mathf.CeilToInt(-0.8)).toBe(0);
  });

  it('DeltaAngle wraps to [-180,180]', () => {
    expect(Mathf.DeltaAngle(0, 350)).toBeCloseTo(-10, 4);
    expect(Mathf.DeltaAngle(180, -180)).toBeCloseTo(0, 4);
    expect(Mathf.DeltaAngle(179, -179)).toBeCloseTo(2, 4);
  });

  it('MoveTowardsAngle takes the short way around', () => {
    expect(Mathf.MoveTowardsAngle(179, -179, 5)).toBeCloseTo(-179, 4);
    expect(Mathf.MoveTowardsAngle(0, 180, 45)).toBeCloseTo(45, 4);
    expect(Mathf.MoveTowardsAngle(0, 180, 1000)).toBe(180);
  });

  it('MoveTowards / Clamp / Repeat', () => {
    expect(Mathf.MoveTowards(0, 10, 3)).toBe(3);
    expect(Mathf.MoveTowards(0, 10, 20)).toBe(10);
    expect(Mathf.Clamp(5, 0, 3)).toBe(3);
    expect(Mathf.Repeat(370, 360)).toBeCloseTo(10, 4);
    expect(Mathf.Repeat(-10, 360)).toBeCloseTo(350, 4);
  });

  it("Approximately follows Unity's relative-epsilon formula", () => {
    expect(Mathf.Approximately(1.0, f(1.0 + 1e-7))).toBeTruthy();
    expect(Mathf.Approximately(1.0, 1.001)).toBeFalsy();
  });
});

describe('Vector2/Vector3', () => {
  it('components are fround-ed on construction', () => {
    const v = new Vector3(0.1, 0.2, 0.3);
    expect(v.x).toBe(f(0.1));
    expect(v.y).toBe(f(0.2));
    expect(v.z).toBe(f(0.3));
  });

  it('add/sub/mulScalar are elementwise fp32', () => {
    const a = new Vector3(0.1, 0.2, 0.3);
    const b = new Vector3(0.4, 0.5, 0.6);
    const s = a.add(b);
    expect(s.x).toBe(f(f(0.1) + f(0.4)));
    expect(s.y).toBe(f(f(0.2) + f(0.5)));
    expect(s.z).toBe(f(f(0.3) + f(0.6)));
  });

  it('magnitude/normalized on the 3-4-5 triangle', () => {
    const v = new Vector3(3, 4, 0);
    expect(v.magnitude).toBe(5);
    const n = v.normalized;
    expect(n.x).toBeCloseTo(0.6, 6);
    expect(n.y).toBeCloseTo(0.8, 6);
    // Unity normalize threshold: tiny vectors → zero
    expect(new Vector3(1e-7, 0, 0).normalized.equals(Vector3.zero)).toBe(true);
  });

  it('Dot/Cross/Angle/Distance basics', () => {
    expect(Vector3.Dot(Vector3.right, Vector3.up)).toBe(0);
    // (1,0,0)×(0,1,0) = (0,0,1) = forward
    expect(Vector3.Cross(Vector3.right, Vector3.up).equals(Vector3.forward)).toBe(true);
    expect(Vector3.Angle(Vector3.forward, Vector3.right)).toBeCloseTo(90, 3);
    expect(Vector3.Distance(new Vector3(0, 0, 0), new Vector3(3, 4, 0))).toBe(5);
  });

  it('Reflect mirrors over the normal', () => {
    const r = Vector3.Reflect(new Vector3(1, -1, 0), Vector3.up);
    expect(r.x).toBeCloseTo(1, 6);
    expect(r.y).toBeCloseTo(1, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('Vector2 basics', () => {
    const v = new Vector2(3, 4);
    expect(v.magnitude).toBe(5);
    expect(v.add(new Vector2(1, 1)).equals(new Vector2(4, 5))).toBe(true);
  });
});

describe('Quaternion', () => {
  it('MultiplyVector by identity is a no-op', () => {
    const v = new Vector3(1, 2, 3);
    expect(Quaternion.MultiplyVector(Quaternion.identity, v).equals(v)).toBe(true);
  });

  it('AngleAxis(90, up) rotates forward → right', () => {
    const q = Quaternion.AngleAxis(90, Vector3.up);
    const r = Quaternion.MultiplyVector(q, Vector3.forward);
    expect(r.x).toBeCloseTo(1, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
  });

  it('LookRotation(forward) ≈ identity; LookRotation(+x) maps z→x', () => {
    const q0 = Quaternion.LookRotation(Vector3.forward);
    expect(Math.abs(q0.w)).toBeCloseTo(1, 5);
    const q1 = Quaternion.LookRotation(Vector3.right);
    const r = Quaternion.MultiplyVector(q1, Vector3.forward);
    expect(r.x).toBeCloseTo(1, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
  });

  it('euler→eulerAngles round-trips over the sim-used ranges (ZXY, non-gimbal)', () => {
    for (let x = -40; x <= 40; x += 10) {
      for (let y = 0; y < 360; y += 30) {
        const e = Quaternion.Euler(x, y, 0).eulerAngles;
        const ex = ((x % 360) + 360) % 360;
        expect(Math.min(Math.abs(e.x - ex), 360 - Math.abs(e.x - ex))).toBeLessThan(0.01);
        expect(Math.min(Math.abs(e.y - y), 360 - Math.abs(e.y - y))).toBeLessThan(0.01);
        // z input is 0 → extracted z may sit at ±epsilon (or 360−epsilon)
        expect(Math.min(Math.abs(e.z), 360 - Math.abs(e.z))).toBeLessThan(0.01);
      }
    }
  });

  it('euler composition order is ZXY (q = Ry*Rx*Rz)', () => {
    const composed = Quaternion.Multiply(
      Quaternion.Multiply(
        Quaternion.AngleAxis(30, Vector3.up),
        Quaternion.AngleAxis(20, Vector3.right),
      ),
      Quaternion.AngleAxis(10, Vector3.forward),
    );
    const direct = Quaternion.Euler(20, 30, 10);
    expect(Math.abs(Quaternion.Dot(composed, direct))).toBeCloseTo(1, 5);
  });

  it('Slerp endpoints and midpoint', () => {
    const a = Quaternion.identity;
    const b = Quaternion.AngleAxis(90, Vector3.up);
    expect(Math.abs(Quaternion.Dot(Quaternion.Slerp(a, b, 0), a))).toBeCloseTo(1, 5);
    expect(Math.abs(Quaternion.Dot(Quaternion.Slerp(a, b, 1), b))).toBeCloseTo(1, 5);
    const mid = Quaternion.Slerp(a, b, 0.5);
    const v = Quaternion.MultiplyVector(mid, Vector3.forward);
    const expected = Quaternion.MultiplyVector(Quaternion.AngleAxis(45, Vector3.up), Vector3.forward);
    expect(v.x).toBeCloseTo(expected.x, 5);
    expect(v.z).toBeCloseTo(expected.z, 5);
  });

  it('Inverse undoes rotation', () => {
    const q = Quaternion.Euler(15, 40, 0);
    const qi = Quaternion.Inverse(q);
    const r = Quaternion.Multiply(q, qi);
    expect(Math.abs(r.w)).toBeCloseTo(1, 5);
  });
});

describe('UnityRandom (Xorshift128 + MT19937 seed scramble)', () => {
  // ---- GOLDEN VECTORS: verified against real Unity (InitState(1234),
  // sequential draws without reseeding; published parity testing covering
  // Unity 4.7–2020.1, which includes the original's 5.6.5p1). ----

  it('GOLDEN: InitState(1234) scrambles the state MT19937-style', () => {
    const r = new UnityRandom();
    r.InitState(1234);
    expect(r.state).toEqual({ x: 1234, y: 3159640283, z: 3392860520, w: 3460949513 });
  });

  it('GOLDEN: full 20-draw int sequence across 4 span orientations', () => {
    const r = new UnityRandom();
    r.InitState(1234);
    const seq0Max = [1315917191, 1348720129, 1305464022, 1278673611, 2021684663];
    const seq0Min = [-916287344, -92775442, -1901252403, -176433514, -1472147877];
    const seqMinMax = [1872799860, -2006136348, 587759354, -1919663833, 1738386409];
    const seqMaxMin = [-164658456, 372294278, -1191040031, -1278602700, -1174866336];
    const got: number[] = [];
    for (let i = 0; i < 5; i++) got.push(r.RangeInt(0, 2147483647));
    expect(got).toEqual(seq0Max);
    got.length = 0;
    for (let i = 0; i < 5; i++) got.push(r.RangeInt(0, -2147483648));
    expect(got).toEqual(seq0Min);
    got.length = 0;
    for (let i = 0; i < 5; i++) got.push(r.RangeInt(-2147483648, 2147483647));
    expect(got).toEqual(seqMinMax);
    got.length = 0;
    for (let i = 0; i < 5; i++) got.push(r.RangeInt(2147483647, -2147483648));
    expect(got).toEqual(seqMaxMin);
  });

  it('GOLDEN: RangeInt(min,min) returns min WITHOUT consuming state', () => {
    const r = new UnityRandom();
    r.InitState(1234);
    for (let i = 0; i < 5; i++) expect(r.RangeInt(-2147483648, -2147483648)).toBe(-2147483648);
    // state untouched → next draw equals the FIRST golden value
    expect(r.RangeInt(0, 2147483647)).toBe(1315917191);
  });

  it('GOLDEN: Random.value sequence (near-parity, ±2e-6)', () => {
    const r = new UnityRandom();
    r.InitState(1234);
    // skip the 20 integer draws of the golden sequence first
    for (let i = 0; i < 5; i++) r.RangeInt(0, 2147483647);
    for (let i = 0; i < 5; i++) r.RangeInt(0, -2147483648);
    for (let i = 0; i < 5; i++) r.RangeInt(-2147483648, 2147483647);
    for (let i = 0; i < 5; i++) r.RangeInt(2147483647, -2147483648);
    const expected = [0.4043221, 0.551855, 0.9868958, 0.593608, 0.426595];
    for (const e of expected) {
      expect(Math.abs(r.value - e)).toBeLessThan(2e-6);
    }
  });

  it('GOLDEN: Range(0f, 100f) sequence (near-parity, relative 1e-5)', () => {
    const r = new UnityRandom();
    r.InitState(1234);
    for (let i = 0; i < 5; i++) r.RangeInt(0, 2147483647);
    for (let i = 0; i < 5; i++) r.RangeInt(0, -2147483648);
    for (let i = 0; i < 5; i++) r.RangeInt(-2147483648, 2147483647);
    for (let i = 0; i < 5; i++) r.RangeInt(2147483647, -2147483648);
    for (let i = 0; i < 5; i++) void r.value;
    const expected = [73.35463, 69.16753, 91.95337, 7.068896, 2.080286];
    for (const e of expected) {
      const v = r.Range(0, 100);
      expect(Math.abs(v - e) / e).toBeLessThan(1e-5);
    }
  });

  // ---- behavioral tests ----

  it('is deterministic per seed', () => {
    const a = new UnityRandom();
    const b = new UnityRandom();
    a.InitState(42);
    b.InitState(42);
    for (let i = 0; i < 20; i++) expect(a.Next()).toBe(b.Next());
  });

  it('value stays in [0,1] and averages ~0.5', () => {
    const r = new UnityRandom();
    r.InitState(12345);
    let sum = 0;
    const N = 100000;
    for (let i = 0; i < N; i++) {
      const v = r.value;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
    }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.01);
  });

  it('RangeInt covers [min,max) over many draws', () => {
    const r = new UnityRandom();
    r.InitState(777);
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const v = r.RangeInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it('Range(float) respects bounds', () => {
    const r = new UnityRandom();
    r.InitState(999);
    for (let i = 0; i < 10000; i++) {
      const v = r.Range(-2.5, 2.5);
      expect(v).toBeGreaterThanOrEqual(-2.5000001);
      expect(v).toBeLessThanOrEqual(2.5000001);
    }
  });

  it('state save/restore replays the same stream (SpawnFruitCommand pattern)', () => {
    const r = new UnityRandom();
    r.InitState(2024);
    r.Next();
    const saved = r.state;
    const s1 = [r.Next(), r.Next(), r.Next()];
    r.state = saved;
    const s2 = [r.Next(), r.Next(), r.Next()];
    expect(s2).toEqual(s1);
  });

  it('InsideUnitSphere/OnUnitSphere geometry', () => {
    const r = new UnityRandom();
    r.InitState(31337);
    for (let i = 0; i < 1000; i++) {
      const p = r.InsideUnitSphere;
      expect(p.sqrMagnitude).toBeLessThanOrEqual(1.000001);
      const q = r.OnUnitSphere;
      expect(Math.abs(q.magnitude - 1)).toBeLessThan(1e-4);
    }
  });
});
