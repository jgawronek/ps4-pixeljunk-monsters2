// src/core/EnemyDetectorCone.ts
// TypeScript port of decomp/src/GameCore/EnemyDetectorCone.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x9446D0..0x944DC0).
// Conical (frustum) enemy detection/attack volume hanging DOWNWARD from an
// anchor point: radius `upperRadius` at the top (pos) tapering to `lowerRadius`
// at pos − up*height. Detection scales radii by m_radiusScale; attack by
// affectRate.
//
// TS ADAPTATION: object/position overloads → union param + instanceof dispatch.
// The position-overload InDetection/InAttack radii were INFERRED in the
// reconstruction (Ghidra dropped the forwarded args) — they mirror the object
// overloads; noted here for the eventual disasm re-check.

import { Mathf, Vector3 } from '../engine/math';
import { Cylinder } from './Cylinder';
import { GameCoreObject } from './GameCoreObject';
import type { IEnemyDetector } from './interfaces';

const f = Math.fround;

export class EnemyDetectorCone implements IEnemyDetector {
  private static readonly k_anchor = f(1.0);
  private upperRadius: number; // 0x1C
  private lowerRadius: number; // 0x20
  private affectRate: number; // 0x28
  private m_radiusScale = f(1.0); // 0x2C
  offset: Vector3; // 0x10 (auto-property)
  height: number; // 0x24 (auto-property)

  // .ctor @0x9446D0
  constructor(
    aOffset: Vector3,
    aUpper: number,
    aLower: number,
    aHeight: number,
    affect: number,
  ) {
    this.offset = aOffset;
    this.upperRadius = f(aUpper);
    this.lowerRadius = f(aLower);
    this.height = f(aHeight);
    this.affectRate = f(affect);
    this.m_radiusScale = f(1.0);
  }

  // get_UpperRadius @0x944790 / get_LowerRadius @0x9447A0
  get upper(): number {
    return f(this.upperRadius * this.m_radiusScale);
  }
  get lower(): number {
    return f(this.lowerRadius * this.m_radiusScale);
  }
  // get_AffectUpperRadius @0x9447B0 / get_AffectLowerRadius @0x9447C0
  get affectUpper(): number {
    return f(this.upperRadius * this.affectRate);
  }
  get affectLower(): number {
    return f(this.lowerRadius * this.affectRate);
  }

  // GetCollisionCylinder @0x9447D0 — bounding cylinder (max radius, full height).
  getCollisionCylinder(): Cylinder {
    return new Cylinder(
      Mathf.Max(f(this.upperRadius * this.m_radiusScale), f(this.lowerRadius * this.m_radiusScale)),
      this.height,
    );
  }

  // GetAffectCylinder @0x944860
  getAffectCylinder(): Cylinder {
    return new Cylinder(
      Mathf.Max(f(this.upperRadius * this.affectRate), f(this.lowerRadius * this.affectRate)),
      this.height,
    );
  }

  // InDetection @0x9448F0 (object) / @0x944BA0 (position, INFERRED radii)
  inDetection(pos: Vector3, other: GameCoreObject | Vector3): boolean {
    const upper = f(this.upperRadius * this.m_radiusScale);
    const lower = f(this.lowerRadius * this.m_radiusScale);
    return other instanceof GameCoreObject
      ? this.intersectWithObject(pos, other, upper, lower, this.height)
      : this.intersectWithPos(pos, other, upper, lower, this.height);
  }

  // InAttack @0x944D50 (object) / @0x944D70 (position, INFERRED radii)
  inAttack(pos: Vector3, other: GameCoreObject | Vector3): boolean {
    const upper = f(this.upperRadius * this.affectRate);
    const lower = f(this.lowerRadius * this.affectRate);
    return other instanceof GameCoreObject
      ? this.intersectWithObject(pos, other, upper, lower, this.height)
      : this.intersectWithPos(pos, other, upper, lower, this.height);
  }

  // IntersectWithObject @0x944910
  // Tests the other object's collision cylinder against the downward frustum.
  intersectWithObject(
    pos: Vector3,
    other: GameCoreObject,
    upper: number,
    lower: number,
    aHeight: number,
  ): boolean {
    const bottom = pos.add(Vector3.down.mulScalar(aHeight));
    const otherPos = other.position;
    const col = other.collision;
    const otherTop = otherPos.add(Vector3.up.mulScalar(col.height));

    // Vertical overlap between [otherPos.y, otherTop.y] and [bottom.y, pos.y].
    if (otherPos.y > pos.y) return false;
    if (otherTop.y < bottom.y) return false;

    // Horizontal distance from the cone axis, minus the other's radius.
    const diff = new Vector3(f(otherPos.x - pos.x), 0.0, f(otherPos.z - pos.z));
    const dist = diff.magnitude;
    if (f(dist - col.radius) > Mathf.Max(upper, lower)) return false;

    // Cone radius at the other's top and bottom heights; take the wider.
    const coneRadius = Mathf.Max(
      f(upper - f(f(lower - upper) * f(f(otherTop.y - pos.y) / aHeight))),
      f(upper - f(f(lower - upper) * f(f(otherPos.y - pos.y) / aHeight))),
    );
    return f(dist - col.radius) <= coneRadius;
  }

  // IntersectWithPos @0x944BC0 — point version (no other radius).
  intersectWithPos(
    pos: Vector3,
    otherPos: Vector3,
    upper: number,
    lower: number,
    aHeight: number,
  ): boolean {
    const bottom = pos.add(Vector3.down.mulScalar(aHeight));
    if (otherPos.y > pos.y) return false;
    if (otherPos.y < bottom.y) return false;

    const diff = new Vector3(f(otherPos.x - pos.x), 0.0, f(otherPos.z - pos.z));
    const dist = diff.magnitude;
    if (dist > Mathf.Max(upper, lower)) return false;

    return dist <= f(upper - f(f(lower - upper) * f(f(otherPos.y - pos.y) / aHeight)));
  }

  // GetAnchorV @0x944D90
  getAnchorV(): number {
    return EnemyDetectorCone.k_anchor;
  }

  // GetOffset @0x944DA0
  getOffset(): Vector3 {
    return this.offset;
  }

  // Upgrade @0x944DB0
  upgrade(scale: number, affectScale: number): void {
    this.m_radiusScale = f(scale);
    this.affectRate = f(affectScale);
  }

  // GetRadiusScale @0x944DC0
  getRadiusScale(): number {
    return this.m_radiusScale;
  }
}
