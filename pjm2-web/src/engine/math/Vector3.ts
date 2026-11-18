/**
 * Vector3 — Unity 5.6 `UnityEngine.Vector3` clone, fp32-exact.
 *
 * DESIGN (documented per port spec): MUTABLE struct-like class. Every write —
 * constructor, `set`, property assignment, in-place ops — funnels through
 * Math.fround, so x/y/z are always IEEE-754 float32 values. Static "constants"
 * (zero/one/up/...) are getters returning fresh instances, mirroring C# struct
 * copy semantics (mutating one cannot corrupt shared state).
 *
 * Formulas follow the managed Unity C# reference source (Vector3.cs):
 * operators, Dot, Cross, magnitude, normalized (`mag > 1e-5 ? v/mag : zero`),
 * Distance, Lerp, MoveTowards (squared early-out variant), Reflect (factor
 * form), Project/ProjectOnPlane (Mathf.Epsilon guards), Angle (sqrt(sqr*a sqr*b)
 * denominator with kEpsilonNormalSqrt=1e-15 guard, clamped acos), SignedAngle.
 */

import { Mathf } from './Mathf';

const f = Math.fround;

/** Vector3.kEpsilon (managed source). */
const kEpsilon = f(0.00001);
/** kEpsilon * kEpsilon, computed in fp32 like the managed `==` operator. */
const kEpsilonSq = f(kEpsilon * kEpsilon);
/** kEpsilonNormalSqrt used by Vector3.Angle (managed source / Unity.Physics mirror). */
const kEpsilonNormalSqrt = f(1e-15);

export class Vector3 {
  private _x: number;
  private _y: number;
  private _z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this._x = f(x);
    this._y = f(y);
    this._z = f(z);
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

  set(x: number, y: number, z: number): this {
    this._x = f(x);
    this._y = f(y);
    this._z = f(z);
    return this;
  }

  clone(): Vector3 {
    return new Vector3(this._x, this._y, this._z);
  }

  // ---- constants (fresh instances, like C# struct copies) ----

  static get zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }
  static get one(): Vector3 {
    return new Vector3(1, 1, 1);
  }
  static get up(): Vector3 {
    return new Vector3(0, 1, 0);
  }
  static get down(): Vector3 {
    return new Vector3(0, -1, 0);
  }
  static get left(): Vector3 {
    return new Vector3(-1, 0, 0);
  }
  static get right(): Vector3 {
    return new Vector3(1, 0, 0);
  }
  static get forward(): Vector3 {
    return new Vector3(0, 0, 1);
  }
  static get back(): Vector3 {
    return new Vector3(0, 0, -1);
  }
  static get positiveInfinity(): Vector3 {
    return new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  }
  static get negativeInfinity(): Vector3 {
    return new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  }

  // ---- instance operators (return new vectors, like C# operators) ----

  add(v: Vector3): Vector3 {
    return new Vector3(f(this._x + v.x), f(this._y + v.y), f(this._z + v.z));
  }

  sub(v: Vector3): Vector3 {
    return new Vector3(f(this._x - v.x), f(this._y - v.y), f(this._z - v.z));
  }

  /** C# `operator *(Vector3 a, float d)` — component * scalar. */
  mulScalar(d: number): Vector3 {
    const fd = f(d);
    return new Vector3(f(this._x * fd), f(this._y * fd), f(this._z * fd));
  }

  divScalar(d: number): Vector3 {
    const fd = f(d);
    return new Vector3(f(this._x / fd), f(this._y / fd), f(this._z / fd));
  }

  neg(): Vector3 {
    return new Vector3(f(-this._x), f(-this._y), f(-this._z));
  }

  /** Unity instance `Scale`: multiplies components in place. */
  scale(v: Vector3): this {
    this._x = f(this._x * v.x);
    this._y = f(this._y * v.y);
    this._z = f(this._z * v.z);
    return this;
  }

  // ---- magnitudes ----

  /** ((x*x + y*y) + z*z), left-associative like the managed source. */
  get sqrMagnitude(): number {
    return f(f(f(this._x * this._x) + f(this._y * this._y)) + f(this._z * this._z));
  }

  get magnitude(): number {
    return Mathf.Sqrt(this.sqrMagnitude);
  }

  /**
   * Unity managed: `mag > kEpsilon ? v / mag : zero` — division by magnitude
   * (not reciprocal multiply); returns the ZERO vector when mag <= 1e-5.
   */
  get normalized(): Vector3 {
    return Vector3.Normalize(this);
  }

  /** In-place normalize, like Unity's instance method. */
  Normalize(): void {
    const mag = this.magnitude;
    if (mag > kEpsilon) {
      this._x = f(this._x / mag);
      this._y = f(this._y / mag);
      this._z = f(this._z / mag);
    } else {
      this._x = 0;
      this._y = 0;
      this._z = 0;
    }
  }

  // ---- statics ----

  static Normalize(value: Vector3): Vector3 {
    const mag = value.magnitude;
    if (mag > kEpsilon) {
      return new Vector3(f(value.x / mag), f(value.y / mag), f(value.z / mag));
    }
    return Vector3.zero;
  }

  /** ((x*x + y*y) + z*z) — managed grouping. */
  static Dot(lhs: Vector3, rhs: Vector3): number {
    return f(f(f(lhs.x * rhs.x) + f(lhs.y * rhs.y)) + f(lhs.z * rhs.z));
  }

  static Cross(lhs: Vector3, rhs: Vector3): Vector3 {
    return new Vector3(
      f(f(lhs.y * rhs.z) - f(lhs.z * rhs.y)),
      f(f(lhs.z * rhs.x) - f(lhs.x * rhs.z)),
      f(f(lhs.x * rhs.y) - f(lhs.y * rhs.x)),
    );
  }

  static Distance(a: Vector3, b: Vector3): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    const dz = f(a.z - b.z);
    return Mathf.Sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)));
  }

  static SqrDistance(a: Vector3, b: Vector3): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    const dz = f(a.z - b.z);
    return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
  }

  static Lerp(a: Vector3, b: Vector3, t: number): Vector3 {
    return Vector3.LerpUnclamped(a, b, Mathf.Clamp01(t));
  }

  /** `a + (b - a) * t` per component (managed grouping). */
  static LerpUnclamped(a: Vector3, b: Vector3, t: number): Vector3 {
    const ft = f(t);
    return new Vector3(
      f(a.x + f(f(b.x - a.x) * ft)),
      f(a.y + f(f(b.y - a.y) * ft)),
      f(a.z + f(f(b.z - a.z) * ft)),
    );
  }

  /** Managed MoveTowards: squared early-out, then `current + to/dist*delta`. */
  static MoveTowards(current: Vector3, target: Vector3, maxDistanceDelta: number): Vector3 {
    const toX = f(target.x - current.x);
    const toY = f(target.y - current.y);
    const toZ = f(target.z - current.z);
    const sqdist = f(f(f(toX * toX) + f(toY * toY)) + f(toZ * toZ));
    const md = f(maxDistanceDelta);
    if (sqdist === 0 || sqdist <= f(md * md)) return target.clone();
    const dist = f(Math.sqrt(sqdist));
    return new Vector3(
      f(current.x + f(f(toX / dist) * md)),
      f(current.y + f(f(toY / dist) * md)),
      f(current.z + f(f(toZ / dist) * md)),
    );
  }

  static Scale(a: Vector3, b: Vector3): Vector3 {
    return new Vector3(f(a.x * b.x), f(a.y * b.y), f(a.z * b.z));
  }

  static Min(lhs: Vector3, rhs: Vector3): Vector3 {
    return new Vector3(Mathf.Min(lhs.x, rhs.x), Mathf.Min(lhs.y, rhs.y), Mathf.Min(lhs.z, rhs.z));
  }

  static Max(lhs: Vector3, rhs: Vector3): Vector3 {
    return new Vector3(Mathf.Max(lhs.x, rhs.x), Mathf.Max(lhs.y, rhs.y), Mathf.Max(lhs.z, rhs.z));
  }

  /** Managed: `factor = -2F * Dot(inNormal, inDirection); factor*n + d`. */
  static Reflect(inDirection: Vector3, inNormal: Vector3): Vector3 {
    const factor = f(f(-2) * Vector3.Dot(inNormal, inDirection));
    return new Vector3(
      f(f(factor * inNormal.x) + inDirection.x),
      f(f(factor * inNormal.y) + inDirection.y),
      f(f(factor * inNormal.z) + inDirection.z),
    );
  }

  /** Managed Project: `sqrMag < Mathf.Epsilon -> zero`, then `n*dot/sqrMag`. */
  static Project(vector: Vector3, onNormal: Vector3): Vector3 {
    const sqrMag = Vector3.Dot(onNormal, onNormal);
    if (sqrMag < Mathf.Epsilon) return Vector3.zero;
    const dot = Vector3.Dot(vector, onNormal);
    return new Vector3(
      f(f(onNormal.x * dot) / sqrMag),
      f(f(onNormal.y * dot) / sqrMag),
      f(f(onNormal.z * dot) / sqrMag),
    );
  }

  static ProjectOnPlane(vector: Vector3, planeNormal: Vector3): Vector3 {
    const sqrMag = Vector3.Dot(planeNormal, planeNormal);
    if (sqrMag < Mathf.Epsilon) return vector.clone();
    const dot = Vector3.Dot(vector, planeNormal);
    return new Vector3(
      f(vector.x - f(f(planeNormal.x * dot) / sqrMag)),
      f(vector.y - f(f(planeNormal.y * dot) / sqrMag)),
      f(vector.z - f(f(planeNormal.z * dot) / sqrMag)),
    );
  }

  /**
   * Managed Angle:
   *   denominator = sqrt(from.sqrMagnitude * to.sqrMagnitude)
   *   if (denominator < 1e-15) return 0
   *   dot = Clamp(Dot(from,to)/denominator, -1, 1)
   *   return (float)Math.Acos(dot) * Rad2Deg
   */
  static Angle(from: Vector3, to: Vector3): number {
    const denominator = f(Math.sqrt(f(from.sqrMagnitude * to.sqrMagnitude)));
    if (denominator < kEpsilonNormalSqrt) return 0;
    const dot = Mathf.Clamp(f(Vector3.Dot(from, to) / denominator), -1, 1);
    return f(Mathf.Acos(dot) * Mathf.Rad2Deg);
  }

  /** Managed: `Angle(from,to) * Sign(Dot(Cross(from,to), axis))`. */
  static SignedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
    const unsignedAngle = Vector3.Angle(from, to);
    const sign = Mathf.Sign(Vector3.Dot(Vector3.Cross(from, to), axis));
    return f(unsignedAngle * sign);
  }

  /** Unity managed `operator ==`: squared distance below kEpsilon^2 (false with NaN). */
  static equal(lhs: Vector3, rhs: Vector3): boolean {
    const dx = f(lhs.x - rhs.x);
    const dy = f(lhs.y - rhs.y);
    const dz = f(lhs.z - rhs.z);
    return f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)) < kEpsilonSq;
  }

  /** Exact component-wise equality (bit-level, for tests/debugging). */
  equals(other: Vector3): boolean {
    return this._x === other.x && this._y === other.y && this._z === other.z;
  }

  equalsApprox(other: Vector3): boolean {
    return Vector3.equal(this, other);
  }

  toString(): string {
    return `(${this._x}, ${this._y}, ${this._z})`;
  }
}
