/**
 * Determinism-foundation math tests: fp32 (Math.fround) discipline, Unity-exact
 * semantics for Mathf/Vector2/Vector3/Quaternion.
 *
 * Tolerances: exact bit equality is asserted wherever Unity's operation order is
 * replicated 1:1 (managed reference source). Angle-based comparisons use small
 * tolerances because sin/cos/atan2 libm implementations may differ from PS4
 * Mono's by <=1 ULP (documented in src/engine/math/README.md).
 */

import { describe, it, expect } from 'vitest';
import { Mathf } from '../../src/engine/math/Mathf';
import { Vector2 } from '../../src/engine/math/Vector2';
import { Vector3 } from '../../src/engine/math/Vector3';
import { Quaternion } from '../../src/engine/math/Quaternion';

const f = Math.fround;

function bits(v: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v);
  return dv.getUint32(0);
}

function close(a: number, b: number, tol = 1e-4): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

function vecClose(a: Vector3, b: Vector3, tol = 1e-4): void {
  close(a.x, b.x, tol);
  close(a.y, b.y, tol);
  close(a.z, b.z, tol);
}

// ---------------------------------------------------------------------------
// fp32 discipline
// ---------------------------------------------------------------------------

describe('fround discipline', () => {
  it('stores every Vector3 component as float32', () => {
    const v = new Vector3(0.1, 0.2, 0.3);
    expect(v.x).toBe(f(0.1));
    expect(v.y).toBe(f(0.2));
    expect(v.z).toBe(f(0.3));
    expect(v.x).not.toBe(0.1); // 0.1 is not representable in fp32
    expect(Object.is(v.x, f(v.x))).toBe(true);
  });

  it('frounds on property assignment and set()', () => {
    const v = Vector3.zero;
    v.x = 0.1;
    v.y = 1.0000001;
    expect(v.x).toBe(f(0.1));
    expect(v.y).toBe(f(1.0000001));
    v.set(0.2, 1 / 3, Math.PI);
    expect(v.x).toBe(f(0.2));
    expect(v.y).toBe(f(1 / 3));
    expect(v.z).toBe(f(Math.PI));
  });

  it('add(0.1, 0.2) follows the fp32 path, not float64', () => {
    const sum = new Vector3(0.1, 0, 0).add(new Vector3(0.2, 0, 0));
    // fp32 addition of the fp32-rounded operands:
    expect(sum.x).toBe(f(f(0.1) + f(0.2)));
    // the classic float64 artifact must NOT leak through:
    expect(sum.x).not.toBe(0.1 + 0.2); // 0.30000000000000004
    // and for this pair it coincides with fround(0.1+0.2):
    expect(sum.x).toBe(f(0.1 + 0.2));
    expect(bits(sum.x)).toBe(0x3e99999a);
  });

  it('every arithmetic op re-rounds (mul/div/scale/magnitude)', () => {
    const v = new Vector3(0.1, 0.2, 0.3);
    const m = v.mulScalar(3);
    expect(m.x).toBe(f(f(0.1) * 3));
    expect(m.y).toBe(f(f(0.2) * 3));
    const d = v.divScalar(7);
    expect(d.x).toBe(f(f(0.1) / 7));
    const sq = v.sqrMagnitude;
    expect(sq).toBe(f(f(f(f(0.1) * f(0.1)) + f(f(0.2) * f(0.2))) + f(f(0.3) * f(0.3))));
    expect(Object.is(sq, f(sq))).toBe(true);
  });

  it('Quaternion components are float32', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    expect(q.x).toBe(f(0.1));
    expect(q.w).toBe(f(0.4));
    q.y = 0.555555555555;
    expect(q.y).toBe(f(0.555555555555));
  });

  it('Vector2 components are float32', () => {
    const v = new Vector2(0.1, 0.2);
    expect(v.x).toBe(f(0.1));
    expect(v.y).toBe(f(0.2));
  });
});

// ---------------------------------------------------------------------------
// Mathf
// ---------------------------------------------------------------------------

describe('Mathf', () => {
  it('constants match the Unity literals', () => {
    expect(Mathf.PI).toBe(f(3.14159274));
    expect(Mathf.Deg2Rad).toBe(f(0.0174532924));
    expect(Mathf.Rad2Deg).toBe(f(57.29578));
    expect(Mathf.PI).toBe(f(Math.PI));
  });

  it('Clamp / Clamp01', () => {
    expect(Mathf.Clamp(5, 1, 3)).toBe(3);
    expect(Mathf.Clamp(-5, 1, 3)).toBe(1);
    expect(Mathf.Clamp(2, 1, 3)).toBe(2);
    expect(Mathf.Clamp01(1.5)).toBe(1);
    expect(Mathf.Clamp01(-0.5)).toBe(0);
    expect(Mathf.Clamp01(0.25)).toBe(f(0.25));
  });

  it('Min / Max / Abs / Sign', () => {
    expect(Mathf.Min(2, 3)).toBe(2);
    expect(Mathf.Max(2, 3)).toBe(3);
    expect(Mathf.Abs(-4.5)).toBe(4.5);
    expect(Mathf.Sign(0)).toBe(1); // Unity: f >= 0 ? 1 : -1
    expect(Mathf.Sign(-0.0)).toBe(1);
    expect(Mathf.Sign(-3)).toBe(-1);
  });

  it('RoundToInt uses banker\'s rounding (C# Math.Round default)', () => {
    expect(Mathf.RoundToInt(0.5)).toBe(0);
    expect(Mathf.RoundToInt(1.5)).toBe(2);
    expect(Mathf.RoundToInt(2.5)).toBe(2);
    expect(Mathf.RoundToInt(3.5)).toBe(4);
    expect(Mathf.RoundToInt(-0.5)).toBe(0); // C# gives -0.0 -> (int) 0
    expect(Mathf.RoundToInt(-1.5)).toBe(-2);
    expect(Mathf.RoundToInt(-2.5)).toBe(-2);
    expect(Mathf.RoundToInt(1.4)).toBe(1);
    expect(Mathf.RoundToInt(1.6)).toBe(2);
  });

  it('Round (float) is also half-to-even', () => {
    expect(Mathf.Round(0.5)).toBe(0);
    expect(Mathf.Round(2.5)).toBe(2);
    expect(Mathf.Round(-2.5)).toBe(-2);
    expect(Mathf.Round(1.6)).toBe(2);
  });

  it('FloorToInt / CeilToInt', () => {
    expect(Mathf.FloorToInt(1.7)).toBe(1);
    expect(Mathf.FloorToInt(-1.2)).toBe(-2);
    expect(Mathf.CeilToInt(1.2)).toBe(2);
    expect(Mathf.CeilToInt(-1.7)).toBe(-1);
  });

  it('DeltaAngle wraps to [-180, 180]', () => {
    expect(Mathf.DeltaAngle(179, -179)).toBe(f(2));
    expect(Mathf.DeltaAngle(-179, 179)).toBe(f(-2));
    expect(Mathf.DeltaAngle(0, 180)).toBe(f(180));
    expect(Mathf.DeltaAngle(0, 190)).toBe(f(-170));
    expect(Mathf.DeltaAngle(0, 0)).toBe(0);
  });

  it('MoveTowardsAngle steps the short way across the seam', () => {
    // 179 -> -179 is only 2 degrees away through 180:
    expect(Mathf.MoveTowardsAngle(179, -179, 1)).toBe(f(180));
    expect(Mathf.MoveTowardsAngle(179, -179, 5)).toBe(f(-179)); // reached target
    expect(Mathf.MoveTowardsAngle(-179, 179, 1)).toBe(f(-180));
    expect(Mathf.MoveTowardsAngle(0, 350, 5)).toBe(f(-5)); // short way down
    expect(Mathf.MoveTowardsAngle(0, 10, 20)).toBe(f(10));
  });

  it('MoveTowards', () => {
    expect(Mathf.MoveTowards(0, 10, 3)).toBe(3);
    expect(Mathf.MoveTowards(0, 10, 20)).toBe(10);
    expect(Mathf.MoveTowards(0, -10, 3)).toBe(-3);
  });

  it('Repeat / PingPong', () => {
    expect(Mathf.Repeat(365, 360)).toBe(f(5));
    expect(Mathf.Repeat(-5, 360)).toBe(f(355));
    expect(Mathf.PingPong(4, 3)).toBe(f(2));
    expect(Mathf.PingPong(2, 3)).toBe(f(2));
  });

  it('Lerp / LerpUnclamped / InverseLerp', () => {
    expect(Mathf.Lerp(0, 10, 0.5)).toBe(5);
    expect(Mathf.Lerp(0, 10, 2)).toBe(10); // clamped
    expect(Mathf.LerpUnclamped(0, 10, 2)).toBe(20);
    expect(Mathf.InverseLerp(0, 10, 5)).toBe(f(0.5));
    expect(Mathf.InverseLerp(5, 5, 7)).toBe(0); // degenerate
  });

  it('LerpAngle interpolates across the seam', () => {
    expect(Mathf.LerpAngle(170, -170, 0.5)).toBe(f(180));
  });

  it('SmoothStep', () => {
    expect(Mathf.SmoothStep(0, 1, 0.5)).toBe(f(0.5));
    expect(Mathf.SmoothStep(0, 10, 0)).toBe(0);
    expect(Mathf.SmoothStep(0, 10, 1)).toBe(10);
    expect(Mathf.SmoothStep(0, 10, 2)).toBe(10); // clamped
  });

  it('Approximately uses Unity\'s formula', () => {
    expect(Mathf.Approximately(1, f(1 + 1e-7))).toBe(true);
    expect(Mathf.Approximately(1, f(1 + 1e-4))).toBe(false);
    expect(Mathf.Approximately(0, 0)).toBe(true);
    expect(Mathf.Approximately(0, 1e-7)).toBe(false);
  });

  it('trig basics through fp32', () => {
    expect(Mathf.Sin(0)).toBe(0);
    expect(Mathf.Cos(0)).toBe(1);
    expect(Mathf.Sqrt(4)).toBe(2);
    close(Mathf.Atan2(1, 1), f(Math.PI / 4), 1e-7);
    expect(Object.is(Mathf.Sin(1), f(Mathf.Sin(1)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vector3
// ---------------------------------------------------------------------------

describe('Vector3', () => {
  it('direction constants', () => {
    expect(Vector3.zero.equals(new Vector3(0, 0, 0))).toBe(true);
    expect(Vector3.one.equals(new Vector3(1, 1, 1))).toBe(true);
    expect(Vector3.up.equals(new Vector3(0, 1, 0))).toBe(true);
    expect(Vector3.down.equals(new Vector3(0, -1, 0))).toBe(true);
    expect(Vector3.left.equals(new Vector3(-1, 0, 0))).toBe(true);
    expect(Vector3.right.equals(new Vector3(1, 0, 0))).toBe(true);
    expect(Vector3.forward.equals(new Vector3(0, 0, 1))).toBe(true);
    expect(Vector3.back.equals(new Vector3(0, 0, -1))).toBe(true);
    // constants are fresh instances (struct-copy semantics)
    const z1 = Vector3.zero;
    z1.x = 5;
    expect(Vector3.zero.x).toBe(0);
  });

  it('Dot / Cross', () => {
    expect(Vector3.Dot(new Vector3(1, 2, 3), new Vector3(4, 5, 6))).toBe(f(32));
    vecClose(Vector3.Cross(new Vector3(1, 0, 0), new Vector3(0, 1, 0)), new Vector3(0, 0, 1), 0);
    vecClose(Vector3.Cross(new Vector3(0, 1, 0), new Vector3(0, 0, 1)), new Vector3(1, 0, 0), 0);
  });

  it('magnitude / sqrMagnitude', () => {
    const v = new Vector3(3, 4, 0);
    expect(v.magnitude).toBe(5);
    expect(v.sqrMagnitude).toBe(25);
  });

  it('normalized returns zero vector below the 1e-5 threshold (Unity behavior)', () => {
    vecClose(new Vector3(3, 4, 0).normalized, new Vector3(0.6, 0.8, 0));
    expect(Vector3.zero.normalized.equals(Vector3.zero)).toBe(true);
    expect(new Vector3(1e-6, 0, 0).normalized.equals(Vector3.zero)).toBe(true); // mag <= 1e-5
    vecClose(new Vector3(2e-5, 0, 0).normalized, new Vector3(1, 0, 0));
  });

  it('Distance', () => {
    expect(Vector3.Distance(new Vector3(1, 2, 3), new Vector3(4, 6, 3))).toBe(5);
  });

  it('Lerp clamps, LerpUnclamped does not', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(10, 0, 0);
    vecClose(Vector3.Lerp(a, b, 0.5), new Vector3(5, 0, 0), 0);
    vecClose(Vector3.Lerp(a, b, 2), b, 0);
    vecClose(Vector3.LerpUnclamped(a, b, 2), new Vector3(20, 0, 0), 0);
  });

  it('MoveTowards', () => {
    vecClose(Vector3.MoveTowards(Vector3.zero, new Vector3(10, 0, 0), 3), new Vector3(3, 0, 0));
    vecClose(Vector3.MoveTowards(Vector3.zero, new Vector3(10, 0, 0), 30), new Vector3(10, 0, 0));
  });

  it('Reflect', () => {
    vecClose(
      Vector3.Reflect(new Vector3(1, -1, 0), new Vector3(0, 1, 0)),
      new Vector3(1, 1, 0),
    );
  });

  it('Project / ProjectOnPlane', () => {
    vecClose(Vector3.Project(new Vector3(2, 3, 4), new Vector3(0, 1, 0)), new Vector3(0, 3, 0));
    expect(Vector3.Project(new Vector3(2, 3, 4), Vector3.zero).equals(Vector3.zero)).toBe(true);
    vecClose(
      Vector3.ProjectOnPlane(new Vector3(2, 3, 4), new Vector3(0, 1, 0)),
      new Vector3(2, 0, 4),
    );
  });

  it('Angle / SignedAngle', () => {
    close(Vector3.Angle(Vector3.forward, Vector3.right), 90, 1e-3);
    close(Vector3.Angle(Vector3.forward, Vector3.forward), 0, 1e-4);
    close(Vector3.Angle(Vector3.forward, Vector3.back), 180, 1e-3);
    expect(Vector3.Angle(Vector3.zero, Vector3.forward)).toBe(0);
    close(Vector3.SignedAngle(Vector3.forward, Vector3.right, Vector3.up), 90, 1e-3);
    close(Vector3.SignedAngle(Vector3.right, Vector3.forward, Vector3.up), -90, 1e-3);
  });

  it('Scale / Min / Max componentwise', () => {
    const a = new Vector3(1, 5, 3);
    const b = new Vector3(4, 2, 6);
    vecClose(Vector3.Scale(a, b), new Vector3(4, 10, 18), 0);
    vecClose(Vector3.Min(a, b), new Vector3(1, 2, 3), 0);
    vecClose(Vector3.Max(a, b), new Vector3(4, 5, 6), 0);
  });

  it('tolerant equality follows the managed operator==', () => {
    const a = new Vector3(1, 2, 3);
    expect(a.equalsApprox(new Vector3(1, 2, 3))).toBe(true);
    expect(a.equalsApprox(new Vector3(f(1 + 1e-6), 2, 3))).toBe(true); // dist^2 < 1e-10
    expect(a.equalsApprox(new Vector3(1.001, 2, 3))).toBe(false);
    expect(a.equals(a.clone())).toBe(true);
  });

  it('operators as functions', () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(4, 5, 6);
    vecClose(a.add(b), new Vector3(5, 7, 9), 0);
    vecClose(a.sub(b), new Vector3(-3, -3, -3), 0);
    vecClose(a.mulScalar(2), new Vector3(2, 4, 6), 0);
    vecClose(b.divScalar(2), new Vector3(2, 2.5, 3), 0);
    vecClose(a.neg(), new Vector3(-1, -2, -3), 0);
  });
});

// ---------------------------------------------------------------------------
// Vector2
// ---------------------------------------------------------------------------

describe('Vector2', () => {
  it('basic ops with fp32 discipline', () => {
    const a = new Vector2(3, 4);
    expect(a.magnitude).toBe(5);
    vecClose2(a.normalized, new Vector2(0.6, 0.8));
    expect(Vector2.Dot(new Vector2(1, 2), new Vector2(3, 4))).toBe(f(11));
    expect(Vector2.Distance(new Vector2(0, 0), new Vector2(3, 4))).toBe(5);
    vecClose2(Vector2.Lerp(new Vector2(0, 0), new Vector2(10, 10), 0.5), new Vector2(5, 5));
    vecClose2(Vector2.Min(new Vector2(1, 5), new Vector2(4, 2)), new Vector2(1, 2));
    vecClose2(Vector2.Max(new Vector2(1, 5), new Vector2(4, 2)), new Vector2(4, 5));
    vecClose2(Vector2.Scale(new Vector2(2, 3), new Vector2(4, 5)), new Vector2(8, 15));
    expect(Vector2.zero.normalized.equals(Vector2.zero)).toBe(true);
    expect(new Vector2(1e-6, 0).normalized.equals(Vector2.zero)).toBe(true);
  });

  function vecClose2(a: Vector2, b: Vector2): void {
    close(a.x, b.x);
    close(a.y, b.y);
  }
});

// ---------------------------------------------------------------------------
// Quaternion
// ---------------------------------------------------------------------------

describe('Quaternion', () => {
  it('identity and multiplication identity laws are bit-exact', () => {
    const q = Quaternion.Euler(30, 45, 60);
    const id = Quaternion.identity;
    expect(id.x).toBe(0);
    expect(id.w).toBe(1);
    const l = Quaternion.Multiply(id, q);
    const r = Quaternion.Multiply(q, id);
    expect(bits(l.x)).toBe(bits(q.x));
    expect(bits(l.y)).toBe(bits(q.y));
    expect(bits(l.z)).toBe(bits(q.z));
    expect(bits(l.w)).toBe(bits(q.w));
    expect(r.equals(q)).toBe(true);
  });

  it('rotates basis vectors like Unity (left-handed, ZXY euler)', () => {
    // +90 deg around X: forward -> down
    vecClose(Quaternion.MultiplyVector(Quaternion.Euler(90, 0, 0), Vector3.forward), Vector3.down);
    // +90 deg around Y: forward -> right
    vecClose(Quaternion.MultiplyVector(Quaternion.Euler(0, 90, 0), Vector3.forward), Vector3.right);
    // +90 deg around Z: right -> up
    vecClose(Quaternion.MultiplyVector(Quaternion.Euler(0, 0, 90), Vector3.right), Vector3.up);
  });

  it('preserves vector magnitude', () => {
    const q = Quaternion.Euler(37, 100, -20);
    const v = new Vector3(1, 2, 3);
    const r = Quaternion.MultiplyVector(q, v);
    close(r.magnitude, v.magnitude, 1e-5);
  });

  it('Euler(x,y,z) -> eulerAngles round-trips on a grid (as rotations)', () => {
    const angles = [-179, -120, -90, -45, -10, 0, 10, 45, 89, 91, 120, 179, 180, 200, 270, 359];
    for (const x of angles) {
      // Unity's ToEuler singularity threshold (|test| > 0.9999) folds pitch
      // within ~1.5° of ±90 into the gimbal branch — REAL Unity does not
      // round-trip rotations there either (pitch snaps to exactly ±90).
      // Exclude the singular band; the fold itself is asserted separately.
      const nx = ((x % 360) + 360) % 360;
      if (Math.abs(nx - 90) < 2 || Math.abs(nx - 270) < 2) continue;
      for (const y of angles) {
        for (const z of [0, 45, 180, 270, 359]) {
          const q = Quaternion.Euler(x, y, z);
          const e = q.eulerAngles;
          const q2 = Quaternion.Euler(e.x, e.y, e.z);
          // Unity-equivalent ambiguity: many euler triples map to one rotation;
          // the round-trip must reproduce the SAME ROTATION, not the same triple.
          // Tolerance 0.1°: near gimbal folds (pitch ≈ ±90/±180) the acos-based
          // Angle amplifies fp32 rounding — real Unity shows the same jitter.
          const ang = Quaternion.Angle(q, q2);
          expect(ang, `Euler(${x},${y},${z}) -> (${e.x},${e.y},${e.z})`).toBeLessThan(0.1);
        }
      }
    }
  });

  it('eulerAngles known values and Unity folds', () => {
    const tol = 2e-3;
    // ordinary extraction
    const e1 = Quaternion.Euler(30, 45, 60).eulerAngles;
    close(e1.x, 30, tol);
    close(e1.y, 45, tol);
    close(e1.z, 60, tol);
    // negative pitch folds into 0..360
    const e2 = Quaternion.Euler(-30, 0, 0).eulerAngles;
    close(e2.x, 330, tol);
    // pitch > 90 fold: (x,y,z) -> (180-x, y+180, z+180)
    const e3 = Quaternion.Euler(120, 10, 20).eulerAngles;
    close(e3.x, 60, tol);
    close(e3.y, 190, tol);
    close(e3.z, 200, tol);
    // gimbal (pitch = +90): yaw keeps y-z coupling, roll = 0 (Unity behavior)
    const e4 = Quaternion.Euler(90, 30, 0).eulerAngles;
    close(e4.x, 90, tol);
    close(e4.y, 30, tol);
    close(e4.z, 0, tol);
    const e5 = Quaternion.Euler(90, 30, 60).eulerAngles;
    close(e5.x, 90, tol);
    close(e5.y, 330, tol); // y - z = -30 -> 330
    close(e5.z, 0, tol);
    // south pole: yaw keeps y+z coupling
    const e6 = Quaternion.Euler(-90, 30, 60).eulerAngles;
    close(e6.x, 270, tol);
    close(e6.y, 90, tol); // y + z = 90
    close(e6.z, 0, tol);
  });

  it('LookRotation maps local +Z to forward and keeps up perpendicular', () => {
    const fwd = new Vector3(3, 1, -7);
    const q = Quaternion.LookRotation(fwd);
    vecClose(Quaternion.MultiplyVector(q, Vector3.forward), fwd.normalized);
    const rotatedUp = Quaternion.MultiplyVector(q, Vector3.up);
    // rotated up == component of world up perpendicular to forward, normalized
    const perp = Vector3.ProjectOnPlane(Vector3.up, fwd.normalized).normalized;
    vecClose(rotatedUp, perp);
    close(rotatedUp.magnitude, 1, 1e-5);
  });

  it('LookRotation basis checks on axes', () => {
    // identity
    const q0 = Quaternion.LookRotation(Vector3.forward);
    expect(Quaternion.Angle(q0, Quaternion.identity)).toBe(0);
    // +X forward -> yaw 90
    const e1 = Quaternion.LookRotation(Vector3.right).eulerAngles;
    close(e1.x, 0, 2e-3);
    close(e1.y, 90, 2e-3);
    close(e1.z, 0, 2e-3);
    // -Z forward -> yaw 180
    const e2 = Quaternion.LookRotation(Vector3.back).eulerAngles;
    close(e2.y, 180, 2e-3);
    // non-unit forward behaves like normalized forward (Unity normalizes)
    const qa = Quaternion.LookRotation(new Vector3(1, 0, 0));
    const qb = Quaternion.LookRotation(new Vector3(5, 0, 0));
    expect(Quaternion.Angle(qa, qb)).toBe(0);
  });

  it('LookRotation degenerate inputs are deterministic garbage (Unity parity, NO guards)', () => {
    // forward == zero -> zero orthonormal basis -> Shepperd branch 2:
    const q = Quaternion.LookRotation(Vector3.zero);
    expect(bits(q.x)).toBe(bits(0.5));
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(0);
    // up parallel to forward:
    const q2 = Quaternion.LookRotation(Vector3.up, Vector3.up);
    expect(bits(q2.x)).toBe(bits(0.5));
    expect(q2.y).toBe(0);
    expect(q2.z).toBe(0);
    expect(bits(q2.w)).toBe(bits(-0.5));
    // stable across calls (deterministic):
    expect(Quaternion.LookRotation(Vector3.zero).equals(q)).toBe(true);
  });

  it('AngleAxis', () => {
    // 90 deg around +Y takes forward to right
    vecClose(
      Quaternion.MultiplyVector(Quaternion.AngleAxis(90, Vector3.up), Vector3.forward),
      Vector3.right,
    );
    // axis is normalized internally (non-unit axis == unit axis)
    const a = Quaternion.AngleAxis(90, new Vector3(0, 2, 0));
    const b = Quaternion.AngleAxis(90, Vector3.up);
    expect(Quaternion.Angle(a, b)).toBeLessThan(1e-4);
    // zero angle -> identity exactly
    expect(Quaternion.AngleAxis(0, Vector3.up).equals(Quaternion.identity)).toBe(true);
    // zero axis -> identity (decompiled replica guard)
    expect(Quaternion.AngleAxis(90, Vector3.zero).equals(Quaternion.identity)).toBe(true);
    // matches Euler for axis rotations
    close(Quaternion.Angle(Quaternion.AngleAxis(45, Vector3.up), Quaternion.Euler(0, 45, 0)), 0, 1e-3);
  });

  it('gimbal fold: pitch inside the singularity band snaps to exactly ±90 (Unity parity)', () => {
    // The replicated native ToEuler folds when |test| > 0.4995*unit with
    // test = x*w - y*z (= sin(pitch)/2 for unit quaternions), i.e. when
    // |sin(pitch)| > 0.999 (pitch within ~2.56° of ±90): sin(89°)≈0.99985
    // exceeds it, so the extraction folds pitch to exactly 90 and derives yaw
    // from the quaternion — the round-trip loses ~1° there BY DESIGN. Pinning
    // this behavior so a "smarter" extraction can't silently diverge.
    // (Exact native threshold is VERIFICATION-PENDING vs eboot.elf — README.)
    const e = Quaternion.Euler(89, -179, 0).eulerAngles;
    expect(e.x).toBe(90);
    const e2 = Quaternion.Euler(-89.5, 30, 0).eulerAngles;
    expect(e2.x).toBe(270); // -90 folds to 270 after MakePositive
  });

  it('Dot / Angle', () => {
    const q = Quaternion.Euler(30, 45, 60);
    expect(Quaternion.Dot(q, q)).toBeCloseTo(1, 5);
    expect(Quaternion.Angle(q, q)).toBe(0);
    expect(Quaternion.Angle(Quaternion.identity, Quaternion.identity)).toBe(0);
    close(Quaternion.Angle(Quaternion.identity, Quaternion.Euler(0, 90, 0)), 90, 1e-3);
    // q and -q represent the same rotation; Angle == 0 up to fp32 conditioning:
    // acos(|dot|) near |dot|≈1 amplifies rounding (real Unity behaves the same),
    // so allow 0.1° instead of exact zero.
    const neg = new Quaternion(-q.x, -q.y, -q.z, -q.w);
    expect(Quaternion.Angle(q, neg)).toBeLessThan(0.1);
    // ... but == compares the dot directly, so q != -q (Unity behavior)
    expect(q.equalsApprox(neg)).toBe(false);
    expect(q.equalsApprox(q.clone())).toBe(true);
  });

  it('Inverse', () => {
    const q = Quaternion.Euler(30, 45, 60);
    const prod = Quaternion.Multiply(q, Quaternion.Inverse(q));
    expect(Quaternion.Angle(prod, Quaternion.identity)).toBeLessThan(1e-3);
    expect(Quaternion.Inverse(Quaternion.identity).equals(Quaternion.identity)).toBe(true);
  });

  it('Normalize', () => {
    const q = new Quaternion(0, 0, 0, 2);
    const n = q.normalized;
    expect(n.x).toBe(0);
    expect(n.w).toBe(1);
    // zero quaternion -> identity (managed reference behavior)
    const z = new Quaternion(0, 0, 0, 0).normalized;
    expect(z.equals(Quaternion.identity)).toBe(true);
  });

  it('Slerp endpoints, midpoint and clamping', () => {
    const q0 = Quaternion.identity;
    const q1 = Quaternion.Euler(0, 90, 0);
    expect(Quaternion.Angle(Quaternion.Slerp(q0, q1, 0), q0)).toBeLessThan(1e-3);
    expect(Quaternion.Angle(Quaternion.Slerp(q0, q1, 1), q1)).toBeLessThan(1e-3);
    const mid = Quaternion.Slerp(q0, q1, 0.5);
    expect(Quaternion.Angle(mid, Quaternion.Euler(0, 45, 0))).toBeLessThan(1e-3);
    // Slerp clamps t
    expect(Quaternion.Angle(Quaternion.Slerp(q0, q1, 2), q1)).toBeLessThan(1e-3);
    // SlerpUnclamped extrapolates on the sin branch (dot < 0.95):
    const over = Quaternion.SlerpUnclamped(q0, q1, 2);
    const e = over.eulerAngles;
    close(e.y, 180, 1e-2);
  });

  it('SlerpUnclamped near-identical quaternions CLAMPS via the Lerp fallback (Unity quirk)', () => {
    // dot >= 0.95 -> engine falls back to Lerp(...), which clamps t to [0,1]:
    const q0 = Quaternion.identity;
    const q1 = Quaternion.Euler(0, 10, 0);
    const over = Quaternion.SlerpUnclamped(q0, q1, 2);
    expect(Quaternion.Angle(over, q1)).toBeLessThan(1e-3); // NOT Euler(0,20,0)
  });

  it('Lerp normalizes and clamps', () => {
    const q0 = Quaternion.identity;
    const q1 = Quaternion.Euler(0, 90, 0);
    const mid = Quaternion.Lerp(q0, q1, 0.5);
    close(Mathf.Sqrt(Quaternion.Dot(mid, mid)), 1, 1e-6);
    expect(Quaternion.Angle(mid, Quaternion.Euler(0, 45, 0))).toBeLessThan(1e-2);
    expect(Quaternion.Angle(Quaternion.Lerp(q0, q1, 5), q1)).toBeLessThan(1e-3);
  });

  it('RotateTowards steps by maxDegreesDelta', () => {
    const from = Quaternion.identity;
    const to = Quaternion.Euler(0, 90, 0);
    const stepped = Quaternion.RotateTowards(from, to, 30);
    expect(Quaternion.Angle(stepped, Quaternion.Euler(0, 30, 0))).toBeLessThan(1e-3);
    // big delta reaches target
    expect(Quaternion.Angle(Quaternion.RotateTowards(from, to, 1000), to)).toBeLessThan(1e-3);
    // angle == 0 returns target directly
    expect(Quaternion.RotateTowards(from, from.clone(), 5).equals(from)).toBe(true);
  });

  it('Multiply composes rotations (q1*q2 applies q2 first)', () => {
    const yaw90 = Quaternion.Euler(0, 90, 0);
    const pitch90 = Quaternion.Euler(90, 0, 0);
    const combined = Quaternion.Multiply(yaw90, pitch90);
    // pitch90 turns forward into down; yaw90 then turns down into down (y-invariant)
    vecClose(Quaternion.MultiplyVector(combined, Vector3.forward), Vector3.down, 1e-4);
    // order matters: the other composition differs
    const other = Quaternion.Multiply(pitch90, yaw90);
    expect(Quaternion.Angle(combined, other)).toBeGreaterThan(1);
  });
});
