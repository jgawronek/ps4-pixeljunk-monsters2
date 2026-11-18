/**
 * Vector2 — Unity 5.6 `UnityEngine.Vector2` clone, fp32-exact.
 *
 * DESIGN (documented per port spec): MUTABLE struct-like class. Every write —
 * constructor, `set`, property assignment, in-place ops — funnels through
 * Math.fround, so x/y are always IEEE-754 float32 values. This mirrors Unity's
 * C# struct semantics: `Vector2.up` etc. are getters returning fresh instances
 * (like struct copies), so mutating a "constant" cannot corrupt shared state.
 *
 * Formulas follow the managed Unity C# reference source (Vector2.cs), which is
 * the shipped implementation even in 5.6 (operators and most helpers are
 * managed C#, compiled by Mono/IL2CPP in fp32).
 */

import { Mathf } from './Mathf';

const f = Math.fround;

/** Vector2.kEpsilon (managed source). */
const kEpsilon = f(0.00001);
/** kEpsilon * kEpsilon, computed in fp32 like the managed `==` operator. */
const kEpsilonSq = f(kEpsilon * kEpsilon);

export class Vector2 {
  private _x: number;
  private _y: number;

  constructor(x: number = 0, y: number = 0) {
    this._x = f(x);
    this._y = f(y);
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

  set(x: number, y: number): this {
    this._x = f(x);
    this._y = f(y);
    return this;
  }

  clone(): Vector2 {
    return new Vector2(this._x, this._y);
  }

  // ---- constants (fresh instances, like C# struct copies) ----

  static get zero(): Vector2 {
    return new Vector2(0, 0);
  }
  static get one(): Vector2 {
    return new Vector2(1, 1);
  }
  static get up(): Vector2 {
    return new Vector2(0, 1);
  }
  static get down(): Vector2 {
    return new Vector2(0, -1);
  }
  static get left(): Vector2 {
    return new Vector2(-1, 0);
  }
  static get right(): Vector2 {
    return new Vector2(1, 0);
  }
  static get positiveInfinity(): Vector2 {
    return new Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  }
  static get negativeInfinity(): Vector2 {
    return new Vector2(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  }

  // ---- instance operators (return new vectors, like C# operators) ----

  add(v: Vector2): Vector2 {
    return new Vector2(f(this._x + v.x), f(this._y + v.y));
  }

  sub(v: Vector2): Vector2 {
    return new Vector2(f(this._x - v.x), f(this._y - v.y));
  }

  /** C# `operator *(Vector2 a, float d)` — component / scalar. */
  mulScalar(d: number): Vector2 {
    return new Vector2(f(this._x * f(d)), f(this._y * f(d)));
  }

  divScalar(d: number): Vector2 {
    const fd = f(d);
    return new Vector2(f(this._x / fd), f(this._y / fd));
  }

  neg(): Vector2 {
    return new Vector2(f(-this._x), f(-this._y));
  }

  /** Unity instance `Scale`: multiplies components in place. */
  scale(v: Vector2): this {
    this._x = f(this._x * v.x);
    this._y = f(this._y * v.y);
    return this;
  }

  // ---- magnitudes ----

  get sqrMagnitude(): number {
    return f(f(this._x * this._x) + f(this._y * this._y));
  }

  get magnitude(): number {
    return Mathf.Sqrt(this.sqrMagnitude);
  }

  /**
   * Unity managed: `mag > kEpsilon ? v / mag : zero` (division, not reciprocal
   * multiply; zero vector result for |v| <= 1e-5).
   */
  get normalized(): Vector2 {
    return Vector2.Normalize(this);
  }

  /** In-place normalize, like Unity's instance method. */
  Normalize(): void {
    const mag = this.magnitude;
    if (mag > kEpsilon) {
      this._x = f(this._x / mag);
      this._y = f(this._y / mag);
    } else {
      this._x = 0;
      this._y = 0;
    }
  }

  // ---- statics ----

  static Normalize(value: Vector2): Vector2 {
    const mag = value.magnitude;
    if (mag > kEpsilon) {
      return new Vector2(f(value.x / mag), f(value.y / mag));
    }
    return Vector2.zero;
  }

  static Dot(lhs: Vector2, rhs: Vector2): number {
    return f(f(lhs.x * rhs.x) + f(lhs.y * rhs.y));
  }

  static Distance(a: Vector2, b: Vector2): number {
    const dx = f(a.x - b.x);
    const dy = f(a.y - b.y);
    return Mathf.Sqrt(f(f(dx * dx) + f(dy * dy)));
  }

  static Lerp(a: Vector2, b: Vector2, t: number): Vector2 {
    return Vector2.LerpUnclamped(a, b, Mathf.Clamp01(t));
  }

  static LerpUnclamped(a: Vector2, b: Vector2, t: number): Vector2 {
    const ft = f(t);
    return new Vector2(
      f(a.x + f(f(b.x - a.x) * ft)),
      f(a.y + f(f(b.y - a.y) * ft)),
    );
  }

  static MoveTowards(current: Vector2, target: Vector2, maxDistanceDelta: number): Vector2 {
    const toX = f(target.x - current.x);
    const toY = f(target.y - current.y);
    const sqdist = f(f(toX * toX) + f(toY * toY));
    const md = f(maxDistanceDelta);
    if (sqdist === 0 || sqdist <= f(md * md)) return target.clone();
    const dist = f(Math.sqrt(sqdist));
    return new Vector2(
      f(current.x + f(f(toX / dist) * md)),
      f(current.y + f(f(toY / dist) * md)),
    );
  }

  static Scale(a: Vector2, b: Vector2): Vector2 {
    return new Vector2(f(a.x * b.x), f(a.y * b.y));
  }

  static Min(lhs: Vector2, rhs: Vector2): Vector2 {
    return new Vector2(Mathf.Min(lhs.x, rhs.x), Mathf.Min(lhs.y, rhs.y));
  }

  static Max(lhs: Vector2, rhs: Vector2): Vector2 {
    return new Vector2(Mathf.Max(lhs.x, rhs.x), Mathf.Max(lhs.y, rhs.y));
  }

  static Reflect(inDirection: Vector2, inNormal: Vector2): Vector2 {
    const factor = f(f(-2) * Vector2.Dot(inNormal, inDirection));
    return new Vector2(
      f(f(factor * inNormal.x) + inDirection.x),
      f(f(factor * inNormal.y) + inDirection.y),
    );
  }

  /** Unity managed `operator ==`: squared-distance below kEpsilon^2. */
  static equal(lhs: Vector2, rhs: Vector2): boolean {
    const dx = f(lhs.x - rhs.x);
    const dy = f(lhs.y - rhs.y);
    return f(f(dx * dx) + f(dy * dy)) < kEpsilonSq;
  }

  /** Exact component-wise equality (bit-level, for tests/debugging). */
  equals(other: Vector2): boolean {
    return this._x === other.x && this._y === other.y;
  }

  equalsApprox(other: Vector2): boolean {
    return Vector2.equal(this, other);
  }

  toString(): string {
    return `(${this._x}, ${this._y})`;
  }
}
