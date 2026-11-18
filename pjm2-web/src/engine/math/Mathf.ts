/**
 * Mathf — Unity 5.6 `UnityEngine.Mathf` clone with strict IEEE-754 float32 semantics.
 *
 * DISCIPLINE: every arithmetic operation and every stored/returned float goes
 * through Math.fround. Unity computes in fp32 (C# `float`); JS numbers are fp64.
 * Without fround on EVERY intermediate operation, results diverge from the
 * original simulation (non-associativity of floating point addition, different
 * rounding of intermediates, etc.), breaking determinism parity.
 *
 * Semantics follow the managed Unity C# reference source (UnityCsReference,
 * Mathf.cs / Vector3.cs / Quaternion.cs — these are pure managed C# even in
 * 5.6, so `(float)Math.Sin(x)` etc. IS the shipped behavior):
 *   - Trig/exp/log are computed as fround(Math.<fn>(double)) — exactly how
 *     managed Mathf does it ((float)Math.Sin(f)). Residual risk: Mono's libm on
 *     PS4 may differ from V8's by <=1 ULP on rare inputs (see README).
 *   - RoundToInt / Round use banker's rounding (C# Math.Round default,
 *     MidpointRounding.ToEven), as required by the port spec.
 *   - float->int conversions saturate like x86-64 cvttss2si/cvttsd2si
 *     (out-of-range and NaN produce int.MinValue), which is what PS4 does.
 */

const f = Math.fround;

/** C# float -> int32 conversion as performed by x86-64 (cvttsd2si): truncate
 *  toward zero; out-of-range / NaN / infinities produce int.MinValue. */
function floatToInt32(x: number): number {
  if (Number.isNaN(x)) return -2147483648;
  if (x >= 2147483648 || x < -2147483648) return -2147483648;
  return x | 0; // truncates toward zero, in-range
}

/** C# Math.Round (MidpointRounding.ToEven) on a float64 value. */
function roundHalfToEven(x: number): number {
  const r = Math.floor(x);
  const frac = x - r;
  if (frac > 0.5) return r + 1;
  if (frac < 0.5) return r;
  // exact .5 tie -> pick the even neighbor
  return r % 2 === 0 ? r : r + 1;
}

export class Mathf {
  /** Unity: `public const float PI = 3.14159274F;` */
  static readonly PI: number = f(3.14159274);
  /** Unity: `public const float Deg2Rad = 0.0174532924F;` */
  static readonly Deg2Rad: number = f(0.0174532924);
  /** Unity: `public const float Rad2Deg = 57.29578F;` */
  static readonly Rad2Deg: number = f(57.29578);
  /** Unity: `public const float Infinity = float.PositiveInfinity;` */
  static readonly Infinity: number = Number.POSITIVE_INFINITY;
  /** Unity: `public const float NegativeInfinity = float.NegativeInfinity;` */
  static readonly NegativeInfinity: number = Number.NEGATIVE_INFINITY;

  /**
   * Unity: `Epsilon = IsFlushToZeroEnabled ? 1e-15f : <smallest denormal>`.
   * On desktop/PS4 (x86-64, FTZ off in the Mono/IL2CPP default) this is
   * Single.Epsilon = 2^-149 = 1.401298E-45. See README (FTZ ambiguity noted).
   */
  static readonly Epsilon: number = f(1.401298464324817e-45);

  /** kEpsilonNormalSqrt used by Vector3.Angle (managed source). */
  static readonly EpsilonNormalSqrt: number = f(1e-15);
  /** Vector3/Vector2 kEpsilon used by `normalized` and `==` (managed source). */
  static readonly VectorKEpsilon: number = f(0.00001);

  // ---- comparison ----

  /** Unity: `value < min ? min : value > max ? max : value` (NaN passes through). */
  static Clamp(value: number, min: number, max: number): number {
    const v = f(value);
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  static Clamp01(value: number): number {
    const v = f(value);
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  /** Unity managed: `a < b ? a : b` — deliberately NOT Math.min (NaN order differs). */
  static Min(a: number, b: number): number {
    return f(a) < f(b) ? f(a) : f(b);
  }

  static Max(a: number, b: number): number {
    return f(a) > f(b) ? f(a) : f(b);
  }

  /** Unity: `Abs(b - a) < Max(1E-06f * Max(Abs(a), Abs(b)), Epsilon * 8)`. */
  static Approximately(a: number, b: number): boolean {
    const fa = f(a);
    const fb = f(b);
    const diff = f(Math.abs(f(fb - fa)));
    const rel = f(f(1e-6) * Mathf.Max(Math.abs(fa), Math.abs(fb)));
    const abs = f(Mathf.Epsilon * 8);
    return diff < Mathf.Max(rel, abs);
  }

  /** Unity: `f >= 0f ? 1f : -1f` (NaN -> -1). */
  static Sign(value: number): number {
    return f(value) >= 0 ? 1 : -1;
  }

  // ---- basic float ops ----

  static Abs(value: number): number {
    return f(Math.abs(f(value)));
  }

  static Sqrt(value: number): number {
    // Managed Mathf: (float)Math.Sqrt(f) — double sqrt then round to fp32.
    return f(Math.sqrt(f(value)));
  }

  static Floor(value: number): number {
    return f(Math.floor(f(value)));
  }

  static Ceil(value: number): number {
    return f(Math.ceil(f(value)));
  }

  /** C# Math.Round: banker's rounding (half-to-even), returns float. */
  static Round(value: number): number {
    return f(roundHalfToEven(f(value)));
  }

  // ---- float -> int ----

  static FloorToInt(value: number): number {
    return floatToInt32(Math.floor(f(value)));
  }

  static CeilToInt(value: number): number {
    return floatToInt32(Math.ceil(f(value)));
  }

  /** Unity: `(int)Math.Round(f)` — round-half-to-EVEN (banker's rounding). */
  static RoundToInt(value: number): number {
    return floatToInt32(roundHalfToEven(f(value)));
  }

  // ---- trigonometry (managed Mathf = (float)Math.<fn>(double)) ----

  static Sin(value: number): number {
    return f(Math.sin(f(value)));
  }

  static Cos(value: number): number {
    return f(Math.cos(f(value)));
  }

  static Tan(value: number): number {
    return f(Math.tan(f(value)));
  }

  static Asin(value: number): number {
    return f(Math.asin(f(value)));
  }

  static Acos(value: number): number {
    return f(Math.acos(f(value)));
  }

  static Atan(value: number): number {
    return f(Math.atan(f(value)));
  }

  static Atan2(y: number, x: number): number {
    return f(Math.atan2(f(y), f(x)));
  }

  // ---- exponentials ----

  /** Managed: (float)Math.Pow(f, p) — computed in double, rounded once. */
  static Pow(value: number, power: number): number {
    return f(Math.pow(f(value), f(power)));
  }

  static Exp(power: number): number {
    return f(Math.exp(f(power)));
  }

  static Log(value: number): number {
    return f(Math.log(f(value)));
  }

  /** Managed: (float)Math.Log(f, p) = (float)(ln(f)/ln(p)) in double. */
  static LogWithBase(value: number, base: number): number {
    return f(Math.log(f(value)) / Math.log(f(base)));
  }

  static Log10(value: number): number {
    return f(Math.log10(f(value)));
  }

  // ---- interpolation ----

  /** Unity: `a + (b - a) * Clamp01(t)`. */
  static Lerp(a: number, b: number, t: number): number {
    return Mathf.LerpUnclamped(a, b, Mathf.Clamp01(t));
  }

  /** Unity: `a + (b - a) * t`. */
  static LerpUnclamped(a: number, b: number, t: number): number {
    const fa = f(a);
    const fb = f(b);
    const ft = f(t);
    return f(fa + f(f(fb - fa) * ft));
  }

  /** Unity: `a != b ? Clamp01((value - a) / (b - a)) : 0`. */
  static InverseLerp(a: number, b: number, value: number): number {
    const fa = f(a);
    const fb = f(b);
    if (fa !== fb) {
      return Mathf.Clamp01(f(f(f(value) - fa) / f(fb - fa)));
    }
    return 0;
  }

  /**
   * Unity managed:
   *   if (Abs(target - current) <= maxDistanceDelta) return target;
   *   return current + Sign(target - current) * maxDistanceDelta;
   */
  static MoveTowards(current: number, target: number, maxDistanceDelta: number): number {
    const fc = f(current);
    const ft = f(target);
    const delta = f(ft - fc);
    if (Mathf.Abs(delta) <= f(maxDistanceDelta)) return ft;
    return f(fc + f(Mathf.Sign(delta) * f(maxDistanceDelta)));
  }

  /**
   * Unity managed:
   *   float deltaAngle = DeltaAngle(current, target);
   *   if (-maxDistanceDelta < deltaAngle && deltaAngle < maxDistanceDelta) return target;
   *   return MoveTowards(current, current + deltaAngle, maxDistanceDelta);
   * Steps the short way around the circle (e.g. 179 -> -179 with delta >= 2).
   */
  static MoveTowardsAngle(current: number, target: number, maxDistanceDelta: number): number {
    const fc = f(current);
    const deltaAngle = Mathf.DeltaAngle(fc, target);
    const md = f(maxDistanceDelta);
    if (f(-md) < deltaAngle && deltaAngle < md) return f(target);
    return Mathf.MoveTowards(fc, f(fc + deltaAngle), md);
  }

  /** Unity: `delta = Repeat(target - current, 360); if (delta > 180) delta -= 360;` */
  static DeltaAngle(current: number, target: number): number {
    let delta = Mathf.Repeat(f(f(target) - f(current)), 360);
    if (delta > 180) delta = f(delta - 360);
    return delta;
  }

  /** Unity: `t - Floor(t / length) * length`. */
  static Repeat(t: number, length: number): number {
    const ft = f(t);
    const fl = f(length);
    return f(ft - f(Math.floor(f(ft / fl)) * fl));
  }

  /** Unity: `t = Repeat(t, length * 2); return length - Abs(t - length);` */
  static PingPong(t: number, length: number): number {
    const fl = f(length);
    const tt = Mathf.Repeat(t, f(fl * 2));
    return f(fl - Mathf.Abs(f(tt - fl)));
  }

  /** Unity: `delta = Repeat(b - a, 360); if (delta > 180) delta -= 360; return a + delta * Clamp01(t);` */
  static LerpAngle(a: number, b: number, t: number): number {
    const fa = f(a);
    const fb = f(b);
    let delta = Mathf.Repeat(f(fb - fa), 360);
    if (delta > 180) delta = f(delta - 360);
    return f(fa + f(delta * Mathf.Clamp01(t)));
  }

  /**
   * Unity managed:
   *   t = Clamp01(t); t = -2f*t*t*t + 3f*t*t; return to*t + from*(1f - t);
   */
  static SmoothStep(from: number, to: number, t: number): number {
    let ft = Mathf.Clamp01(t);
    const t3 = f(f(f(-2 * ft) * ft) * ft); // (-2*t)*t*t, left-assoc like C#
    const t2 = f(f(3 * ft) * ft); // (3*t)*t
    ft = f(t3 + t2);
    return f(f(f(to) * ft) + f(f(from) * f(1 - ft)));
  }

  static DegToRad(degrees: number): number {
    return f(f(degrees) * Mathf.Deg2Rad);
  }

  static RadToDeg(radians: number): number {
    return f(f(radians) * Mathf.Rad2Deg);
  }
}
