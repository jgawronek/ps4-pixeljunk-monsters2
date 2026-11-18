/**
 * Quaternion — Unity 5.6 `UnityEngine.Quaternion` clone, fp32-exact.
 *
 * DESIGN: MUTABLE struct-like class (same discipline as Vector3): every write
 * goes through Math.fround; statics like `identity` return fresh instances.
 *
 * SOURCES (see ../math/README.md for full citations & confidence levels):
 *  - Multiply(q,q), MultiplyVector(q,v), Dot, Angle, RotateTowards, Normalize,
 *    eulerAngles post-processing (MakePositive): managed Unity C# reference
 *    source (UnityCsReference, Quaternion.cs, 5.x) — these are the SHIPPED
 *    managed implementations, replicated operation-for-operation.
 *  - Euler construction: ZXY order q = qY*qX*qZ, expanded form verified
 *    against Unity by the community (SO 12088610 / Kender formula), identical
 *    term-for-term to Unity.Mathematics quaternion.EulerZXY.
 *  - eulerAngles extraction (ToEulerRad): the widely-replicated native form
 *    (test = x*w - y*z, 0.4995*unit gimbal threshold, component swizzle),
 *    cross-checked against Unity.Physics Math.toEuler ZXY branch.
 *  - Slerp/SlerpUnclamped: native engine C++ posted by a Unity developer
 *    (dot < 0 negate, dot < 0.95 sin-blend, else Lerp fallback — note the
 *    fallback CLAMPS t, a genuine Unity quirk).
 *  - LookRotation: orthonormalize (normalize forward; right = normalize(cross
 *    (up, forward)); up2 = cross(forward, right)) then Shepperd matrix->quat
 *    branch form from the decompiled UnityEngine implementation. Degenerate
 *    inputs (zero forward, up parallel to forward) produce deterministic
 *    garbage exactly like Unity — NO guards (documented in README).
 *
 * Transcendentals (sin/cos/acos/asin/atan2/sqrt) are fround(Math.<fn>(fp32
 * args)) — identical to managed Mathf's `(float)Math.Sin(f)` on Mono/IL2CPP,
 * modulo <=1 ULP libm differences between Mono's PS4 libm and V8 (see README).
 */

import { Mathf } from './Mathf';
import { Vector3 } from './Vector3';

const f = Math.fround;

/** Quaternion.kEpsilon (managed source) — equality tolerance on Dot. */
const kEpsilon = f(0.000001);
/** 1.0f - kEpsilon, as computed by managed IsEqualUsingDot callers. */
const DOT_EQUAL_THRESHOLD = f(1.0 - kEpsilon);

export class Quaternion {
  private _x: number;
  private _y: number;
  private _z: number;
  private _w: number;

  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this._x = f(x);
    this._y = f(y);
    this._z = f(z);
    this._w = f(w);
  }

  get x(): number {
    return this._x;
  }
  set x(v: number) {
    this._x = f(v);
  }

  get y(): number {
    return this._y;
  }
  set y(v: number) {
    this._y = f(v);
  }

  get z(): number {
    return this._z;
  }
  set z(v: number) {
    this._z = f(v);
  }

  get w(): number {
    return this._w;
  }
  set w(v: number) {
    this._w = f(v);
  }

  set(x: number, y: number, z: number, w: number): this {
    this._x = f(x);
    this._y = f(y);
    this._z = f(z);
    this._w = f(w);
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this._x, this._y, this._z, this._w);
  }

  static get identity(): Quaternion {
    return new Quaternion(0, 0, 0, 1);
  }

  // ==================================================================
  // Multiplication — exact managed reference source code
  // ==================================================================

  /** Managed `operator *(Quaternion lhs, Quaternion rhs)`, operation for operation. */
  static Multiply(lhs: Quaternion, rhs: Quaternion): Quaternion {
    return new Quaternion(
      f(
        f(f(f(lhs.w * rhs.x) + f(lhs.x * rhs.w)) + f(lhs.y * rhs.z)) - f(lhs.z * rhs.y),
      ),
      f(
        f(f(f(lhs.w * rhs.y) + f(lhs.y * rhs.w)) + f(lhs.z * rhs.x)) - f(lhs.x * rhs.z),
      ),
      f(
        f(f(f(lhs.w * rhs.z) + f(lhs.z * rhs.w)) + f(lhs.x * rhs.y)) - f(lhs.y * rhs.x),
      ),
      f(
        f(f(f(lhs.w * rhs.w) - f(lhs.x * rhs.x)) - f(lhs.y * rhs.y)) - f(lhs.z * rhs.z),
      ),
    );
  }

  /** Managed `operator *(Quaternion rotation, Vector3 point)`, operation for operation. */
  static MultiplyVector(rotation: Quaternion, point: Vector3): Vector3 {
    const x = f(rotation.x * 2);
    const y = f(rotation.y * 2);
    const z = f(rotation.z * 2);
    const xx = f(rotation.x * x);
    const yy = f(rotation.y * y);
    const zz = f(rotation.z * z);
    const xy = f(rotation.x * y);
    const xz = f(rotation.x * z);
    const yz = f(rotation.y * z);
    const wx = f(rotation.w * x);
    const wy = f(rotation.w * y);
    const wz = f(rotation.w * z);

    return new Vector3(
      f(
        f(f(f(1 - f(yy + zz)) * point.x) + f(f(xy - wz) * point.y)) +
          f(f(xz + wy) * point.z),
      ),
      f(
        f(f(f(xy + wz) * point.x) + f(f(1 - f(xx + zz)) * point.y)) +
          f(f(yz - wx) * point.z),
      ),
      f(
        f(f(f(xz - wy) * point.x) + f(f(yz + wx) * point.y)) +
          f(f(1 - f(xx + yy)) * point.z),
      ),
    );
  }

  /** Instance alias: this * other. */
  multiply(other: Quaternion): Quaternion {
    return Quaternion.Multiply(this, other);
  }

  /** Instance alias: this * v (rotate vector). */
  multiplyVector(v: Vector3): Vector3 {
    return Quaternion.MultiplyVector(this, v);
  }

  // ==================================================================
  // Dot / Angle / equality
  // ==================================================================

  /** Managed: `a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w` (left-assoc). */
  static Dot(a: Quaternion, b: Quaternion): number {
    return f(f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z)) + f(a.w * b.w));
  }

  /**
   * Managed:
   *   dot = Dot(a,b);
   *   return dot > 1-kEpsilon ? 0 : Acos(Min(Abs(dot),1)) * 2 * Rad2Deg;
   */
  static Angle(a: Quaternion, b: Quaternion): number {
    const dot = Quaternion.Dot(a, b);
    if (dot > DOT_EQUAL_THRESHOLD) return 0;
    const clamped = Mathf.Min(Mathf.Abs(dot), 1);
    return f(f(Mathf.Acos(clamped) * 2) * Mathf.Rad2Deg);
  }

  /** Managed `operator ==`: `Dot(lhs, rhs) > 1.0f - kEpsilon`. */
  static equal(lhs: Quaternion, rhs: Quaternion): boolean {
    return Quaternion.Dot(lhs, rhs) > DOT_EQUAL_THRESHOLD;
  }

  /** Exact component-wise equality (bit-level, for tests/debugging). */
  equals(other: Quaternion): boolean {
    return (
      this._x === other.x && this._y === other.y && this._z === other.z && this._w === other.w
    );
  }

  equalsApprox(other: Quaternion): boolean {
    return Quaternion.equal(this, other);
  }

  // ==================================================================
  // Normalize / Inverse
  // ==================================================================

  /**
   * Managed Normalize:
   *   mag = Sqrt(Dot(q,q)); if (mag < Mathf.Epsilon) return identity;
   *   return (q.x/mag, q.y/mag, q.z/mag, q.w/mag);
   */
  static Normalize(q: Quaternion): Quaternion {
    const mag = Mathf.Sqrt(Quaternion.Dot(q, q));
    if (mag < Mathf.Epsilon) return Quaternion.identity;
    return new Quaternion(f(q.x / mag), f(q.y / mag), f(q.z / mag), f(q.w / mag));
  }

  get normalized(): Quaternion {
    return Quaternion.Normalize(this);
  }

  /** In-place normalize (Unity instance method). */
  Normalize(): void {
    const n = Quaternion.Normalize(this);
    this._x = n.x;
    this._y = n.y;
    this._z = n.z;
    this._w = n.w;
  }

  /**
   * Inverse, per the decompiled UnityEngine implementation:
   *   lengthSq = Dot(q,q); if (lengthSq != 0) { i = 1/lengthSq;
   *   return (x*-i, y*-i, z*-i, w*i); } return q;
   */
  static Inverse(rotation: Quaternion): Quaternion {
    const lengthSq = Quaternion.Dot(rotation, rotation);
    if (lengthSq !== 0) {
      const i = f(1.0 / lengthSq);
      const ni = f(-i);
      return new Quaternion(
        f(rotation.x * ni),
        f(rotation.y * ni),
        f(rotation.z * ni),
        f(rotation.w * i),
      );
    }
    return rotation.clone();
  }

  // ==================================================================
  // Euler (ZXY: q = qY * qX * qZ)
  // ==================================================================

  /**
   * Unity `Quaternion.Euler(float x, float y, float z)` (degrees).
   * Managed binding: Internal_FromEulerRad(new Vector3(x,y,z) * Deg2Rad).
   * Construction terms = expansion of qY*qX*qZ verified against Unity
   * (SO 12088610 / Kender; identical to Unity.Mathematics EulerZXY).
   */
  static Euler(x: number, y: number, z: number): Quaternion {
    // managed: Vector3 * Mathf.Deg2Rad (componentwise fp32 multiply)
    const rx = f(f(x) * Mathf.Deg2Rad);
    const ry = f(f(y) * Mathf.Deg2Rad);
    const rz = f(f(z) * Mathf.Deg2Rad);
    return Quaternion.FromEulerRad(new Vector3(rx, ry, rz));
  }

  static EulerV(euler: Vector3): Quaternion {
    return Quaternion.Euler(euler.x, euler.y, euler.z);
  }

  /** Internal_FromEulerRad equivalent (input in radians). */
  static FromEulerRad(euler: Vector3): Quaternion {
    const halfX = f(euler.x * 0.5);
    const halfY = f(euler.y * 0.5);
    const halfZ = f(euler.z * 0.5);
    const sx = Mathf.Sin(halfX);
    const cx = Mathf.Cos(halfX);
    const sy = Mathf.Sin(halfY);
    const cy = Mathf.Cos(halfY);
    const sz = Mathf.Sin(halfZ);
    const cz = Mathf.Cos(halfZ);

    return new Quaternion(
      // x: cy*sx*cz + sy*cx*sz
      f(f(f(cy * sx) * cz) + f(f(sy * cx) * sz)),
      // y: sy*cx*cz - cy*sx*sz
      f(f(f(sy * cx) * cz) - f(f(cy * sx) * sz)),
      // z: cy*cx*sz - sy*sx*cz
      f(f(f(cy * cx) * sz) - f(f(sy * sx) * cz)),
      // w: cy*cx*cz + sy*sx*sz
      f(f(f(cy * cx) * cz) + f(f(sy * sx) * sz)),
    );
  }

  // ==================================================================
  // AngleAxis
  // ==================================================================

  /**
   * Unity `Quaternion.AngleAxis(float degrees, Vector3 axis)`.
   * Decompiled replica: zero axis -> identity; axis is normalized; the result
   * quaternion is NOT renormalized (matches native AxisAngle behavior).
   */
  static AngleAxis(degrees: number, axis: Vector3): Quaternion {
    if (axis.sqrMagnitude === 0) return Quaternion.identity;
    let radians = f(f(degrees) * Mathf.Deg2Rad);
    radians = f(radians * 0.5);
    const n = axis.normalized;
    const s = Mathf.Sin(radians);
    const c = Mathf.Cos(radians);
    return new Quaternion(f(n.x * s), f(n.y * s), f(n.z * s), c);
  }

  // ==================================================================
  // LookRotation
  // ==================================================================

  /**
   * Unity `Quaternion.LookRotation(Vector3 forward, Vector3 upwards = Vector3.up)`.
   *
   * Orthonormalization (decompiled UnityEngine path):
   *   z = Normalize(forward)            (zero vector if |forward| <= 1e-5)
   *   right = Normalize(Cross(up, z))   (zero vector if degenerate)
   *   up2 = Cross(z, right)
   * then matrix->quaternion via the classic Shepperd branch form (rows:
   * m0*=right, m1*=up2, m2*=z).
   *
   * DEGENERATE INPUTS: zero forward or up parallel to forward produce Unity's
   * deterministic garbage (e.g. LookRotation(zero) = (0.5, 0, 0, 0)); there is
   * deliberately NO guard here — parity first. See README.
   */
  static LookRotation(forward: Vector3, upwards: Vector3 = Vector3.up): Quaternion {
    const zAxis = forward.normalized;
    const right = Vector3.Cross(upwards, zAxis).normalized;
    const up2 = Vector3.Cross(zAxis, right);

    const m00 = right.x;
    const m01 = right.y;
    const m02 = right.z;
    const m10 = up2.x;
    const m11 = up2.y;
    const m12 = up2.z;
    const m20 = zAxis.x;
    const m21 = zAxis.y;
    const m22 = zAxis.z;

    const num8 = f(f(m00 + m11) + m22);
    if (num8 > 0) {
      let num = f(Math.sqrt(f(num8 + 1)));
      const w = f(num * 0.5);
      num = f(0.5 / num);
      return new Quaternion(
        f(f(m12 - m21) * num),
        f(f(m20 - m02) * num),
        f(f(m01 - m10) * num),
        w,
      );
    }
    if (m00 >= m11 && m00 >= m22) {
      const num7 = f(Math.sqrt(f(f(f(1 + m00) - m11) - m22)));
      const num4 = f(0.5 / num7);
      return new Quaternion(
        f(0.5 * num7),
        f(f(m01 + m10) * num4),
        f(f(m02 + m20) * num4),
        f(f(m12 - m21) * num4),
      );
    }
    if (m11 > m22) {
      const num6 = f(Math.sqrt(f(f(f(1 + m11) - m00) - m22)));
      const num3 = f(0.5 / num6);
      return new Quaternion(
        f(f(m10 + m01) * num3),
        f(0.5 * num6),
        f(f(m21 + m12) * num3),
        f(f(m20 - m02) * num3),
      );
    }
    const num5 = f(Math.sqrt(f(f(f(1 + m22) - m00) - m11)));
    const num2 = f(0.5 / num5);
    return new Quaternion(
      f(f(m20 + m02) * num2),
      f(f(m21 + m12) * num2),
      f(0.5 * num5),
      f(f(m01 - m10) * num2),
    );
  }

  // ==================================================================
  // eulerAngles (ZXY extraction, 0..360-ish with Unity's flip hack)
  // ==================================================================

  /**
   * Native ToEulerRad replica (returns radians; components ordered x=pitch,
   * y=yaw, z=roll). Community-replicated native form, cross-checked against
   * Unity.Physics Math.toEuler(ZXY):
   *
   *   unit = x*x + y*y + z*z + w*w
   *   test = x*w - y*z                      (== sin(pitch)/2 for unit q)
   *   if test >  0.4995*unit: (pitch, yaw, roll) = (+PI/2, +2*atan2(y,x), 0)
   *   if test < -0.4995*unit: (pitch, yaw, roll) = (-PI/2, -2*atan2(y,x), 0)
   *   else with q3 = (w, z, x, y) swizzle:
   *     yaw   = atan2(2*q3.x*q3.w + 2*q3.y*q3.z, 1 - 2*(q3.z^2 + q3.w^2))
   *     pitch = asin(2*(q3.x*q3.z - q3.w*q3.y))
   *     roll  = atan2(2*q3.x*q3.y + 2*q3.z*q3.w, 1 - 2*(q3.y^2 + q3.z^2))
   *
   * NOTE (documented uncertainty): the 0.4995 gimbal threshold folds pitches
   * within ~2.5 deg of +-90 into the singular branch. See README.
   */
  private static ToEulerRad(q: Quaternion): Vector3 {
    const sqw = f(q.w * q.w);
    const sqx = f(q.x * q.x);
    const sqy = f(q.y * q.y);
    const sqz = f(q.z * q.z);
    const unit = f(f(f(sqx + sqy) + sqz) + sqw);
    const test = f(f(q.x * q.w) - f(q.y * q.z));
    const limit = f(f(0.4995) * unit);

    if (test > limit) {
      // singularity at north pole
      return new Vector3(
        f(Mathf.PI / 2),
        f(2 * Mathf.Atan2(q.y, q.x)),
        0,
      );
    }
    if (test < f(-limit)) {
      // singularity at south pole
      return new Vector3(
        f(f(-Mathf.PI) / 2),
        f(f(-2) * Mathf.Atan2(q.y, q.x)),
        0,
      );
    }

    // swizzle q3 = (x=w, y=z, z=x, w=y)
    const q3x = q.w;
    const q3y = q.z;
    const q3z = q.x;
    const q3w = q.y;

    const yaw = Mathf.Atan2(
      f(f(f(2 * q3x) * q3w) + f(f(2 * q3y) * q3z)),
      f(1 - f(f(2) * f(f(q3z * q3z) + f(q3w * q3w)))),
    );
    const pitch = Mathf.Asin(f(f(2) * f(f(q3x * q3z) - f(q3w * q3y))));
    const roll = Mathf.Atan2(
      f(f(f(2 * q3x) * q3y) + f(f(2 * q3z) * q3w)),
      f(1 - f(f(2) * f(f(q3y * q3y) + f(q3z * q3z)))),
    );
    return new Vector3(pitch, yaw, roll);
  }

  /**
   * Managed 5.x eulerAngles getter, exactly:
   *   Internal_MakePositive(Internal_ToEulerRad(this) * Mathf.Rad2Deg)
   * MakePositive uses the documented "-0.0001 hacked to support old behaviour
   * of QuaternionToEuler": values in [-0.00573 deg, 0) stay NEGATIVE and values
   * in (359.99427, 360] stay >= 360 — genuine Unity quirks we replicate.
   */
  get eulerAngles(): Vector3 {
    const rad = Quaternion.ToEulerRad(this);
    const deg = new Vector3(
      f(rad.x * Mathf.Rad2Deg),
      f(rad.y * Mathf.Rad2Deg),
      f(rad.z * Mathf.Rad2Deg),
    );
    return Quaternion.MakePositive(deg);
  }

  private static MakePositive(euler: Vector3): Vector3 {
    const negativeFlip = f(f(-0.0001) * Mathf.Rad2Deg);
    const positiveFlip = f(360.0 + negativeFlip);

    let x = euler.x;
    let y = euler.y;
    let z = euler.z;
    if (x < negativeFlip) x = f(x + 360.0);
    else if (x > positiveFlip) x = f(x - 360.0);
    if (y < negativeFlip) y = f(y + 360.0);
    else if (y > positiveFlip) y = f(y - 360.0);
    if (z < negativeFlip) z = f(z + 360.0);
    else if (z > positiveFlip) z = f(z - 360.0);
    return new Vector3(x, y, z);
  }

  // ==================================================================
  // Slerp / Lerp / RotateTowards
  // ==================================================================

  /**
   * Native Quaternionf Slerp (engine C++, posted by a Unity developer):
   *   dot < 0      -> negate q2, dot = -dot
   *   dot < 0.95   -> sin-blend: (q1*sin(a(1-t)) + q2'*sin(a t)) / sin(a)
   *   otherwise    -> Lerp(q1, q2', t)   (NB: native Lerp CLAMPS t — a real
   *                   Unity quirk that also applies inside SlerpUnclamped)
   */
  static SlerpUnclamped(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
    const ft = f(t);
    let dot = Quaternion.Dot(q1, q2);
    let tmp: Quaternion;
    if (dot < 0) {
      dot = f(-dot);
      tmp = new Quaternion(f(-q2.x), f(-q2.y), f(-q2.z), f(-q2.w));
    } else {
      tmp = q2;
    }

    if (dot < 0.95) {
      const angle = Mathf.Acos(dot);
      const sinadiv = f(1.0 / Mathf.Sin(angle));
      const sinat = Mathf.Sin(f(angle * ft));
      const sinaomt = Mathf.Sin(f(angle * f(1.0 - ft)));
      return new Quaternion(
        f(f(f(q1.x * sinaomt) + f(tmp.x * sinat)) * sinadiv),
        f(f(f(q1.y * sinaomt) + f(tmp.y * sinat)) * sinadiv),
        f(f(f(q1.z * sinaomt) + f(tmp.z * sinat)) * sinadiv),
        f(f(f(q1.w * sinaomt) + f(tmp.w * sinat)) * sinadiv),
      );
    }
    // small-angle fallback (clamps t via Lerp, like the engine)
    return Quaternion.Lerp(q1, tmp, ft);
  }

  static Slerp(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
    return Quaternion.SlerpUnclamped(q1, q2, Mathf.Clamp01(t));
  }

  /** Raw (unnormalized) component lerp: `w*a + t*b` with w = 1-t. */
  private static LerpRaw(a: Quaternion, b: Quaternion, t: number): Quaternion {
    const ft = f(t);
    const w = f(1.0 - ft);
    return new Quaternion(
      f(f(w * a.x) + f(ft * b.x)),
      f(f(w * a.y) + f(ft * b.y)),
      f(f(w * a.z) + f(ft * b.z)),
      f(f(w * a.w) + f(ft * b.w)),
    );
  }

  /** Unity Quaternion.Lerp: normalized lerp with clamped t. */
  static Lerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
    return Quaternion.Normalize(Quaternion.LerpRaw(a, b, Mathf.Clamp01(t)));
  }

  /** Unity Quaternion.LerpUnclamped: normalized lerp, t not clamped. */
  static LerpUnclamped(a: Quaternion, b: Quaternion, t: number): Quaternion {
    return Quaternion.Normalize(Quaternion.LerpRaw(a, b, t));
  }

  /** Managed RotateTowards, exactly: angle==0 -> to; SlerpUnclamped(from, to, Min(1, delta/angle)). */
  static RotateTowards(from: Quaternion, to: Quaternion, maxDegreesDelta: number): Quaternion {
    const angle = Quaternion.Angle(from, to);
    if (angle === 0.0) return to.clone();
    return Quaternion.SlerpUnclamped(from, to, Mathf.Min(1.0, f(f(maxDegreesDelta) / angle)));
  }

  toString(): string {
    return `(${this._x}, ${this._y}, ${this._z}, ${this._w})`;
  }
}
