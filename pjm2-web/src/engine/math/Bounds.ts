// src/engine/math/Bounds.ts
// UnityEngine.Bounds clone (center/extents storage like Unity), fp32-exact.
// Needed by the sim's collision grid (GameCoreCollisionManager).
// Adapted to the engine/math Vector3 API (instance add/sub/mulScalar).

import { Vector3 } from './Vector3';

const f = Math.fround;

export class Bounds {
  private m_center: Vector3;
  private m_extents: Vector3;

  constructor(center: Vector3, size: Vector3) {
    this.m_center = center.clone();
    this.m_extents = size.mulScalar(0.5);
  }

  get center(): Vector3 {
    return this.m_center;
  }
  set center(v: Vector3) {
    this.m_center = v.clone();
  }
  get extents(): Vector3 {
    return this.m_extents;
  }
  set extents(v: Vector3) {
    this.m_extents = v.clone();
  }
  get size(): Vector3 {
    return this.m_extents.mulScalar(2);
  }
  set size(v: Vector3) {
    this.m_extents = v.mulScalar(0.5);
  }
  get min(): Vector3 {
    return this.m_center.sub(this.m_extents);
  }
  get max(): Vector3 {
    return this.m_center.add(this.m_extents);
  }

  encapsulatePoint(point: Vector3): void {
    const mn = Vector3.Min(this.min, point);
    const mx = Vector3.Max(this.max, point);
    this.m_center = mn.add(mx).mulScalar(0.5);
    this.m_extents = mx.sub(mn).mulScalar(0.5);
  }

  encapsulateBounds(b: Bounds): void {
    this.encapsulatePoint(b.min);
    this.encapsulatePoint(b.max);
  }

  contains(p: Vector3): boolean {
    const mn = this.min;
    const mx = this.max;
    return p.x >= mn.x && p.x <= mx.x && p.y >= mn.y && p.y <= mx.y && p.z >= mn.z && p.z <= mx.z;
  }

  toString(): string {
    return `Bounds(c=${this.m_center}, ext=${this.m_extents})`;
  }
}

export { f as fround };
