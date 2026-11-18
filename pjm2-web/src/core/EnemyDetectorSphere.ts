// src/core/EnemyDetectorSphere.ts
// TypeScript port of decomp/src/GameCore/EnemyDetectorSphere.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x944DD0..0x9450E0).
// Spherical enemy detection/attack volume (used by towers). "Detection" uses
// the radius scaled by m_radiusScale; "attack/affect" uses radius × affect.
//
// TS ADAPTATIONS: C# field `radius` + property `Radius` → m_radius field +
// radius getter; object/position overloads → union param + instanceof dispatch.

import { Vector3 } from '../engine/math/Vector3';
import { Cylinder } from './Cylinder';
import { GameCoreObject } from './GameCoreObject';
import type { IEnemyDetector } from './interfaces';

const f = Math.fround;

export class EnemyDetectorSphere implements IEnemyDetector {
  private static readonly k_anchor = f(0.5);
  private m_radius: number; // 0x10 (C# field `radius`)
  private m_radiusScale = f(1.0); // 0x20
  private affect: number; // 0x24
  offset: Vector3; // 0x14 (auto-property, public get/set)

  // .ctor @0x944DD0
  constructor(aOffset: Vector3, aRadius: number, aAffect: number) {
    this.offset = aOffset;
    this.m_radius = f(aRadius);
    this.affect = f(aAffect);
    this.m_radiusScale = f(1.0);
  }

  // get_Radius @0x944E50
  get radius(): number {
    return f(this.m_radius * this.m_radiusScale);
  }

  // get_AffectRadius @0x944E60
  get affectRadius(): number {
    return f(this.m_radius * this.affect);
  }

  // GetCollisionCylinder @0x944E70
  getCollisionCylinder(): Cylinder {
    const r = f(this.m_radius * this.m_radiusScale);
    return new Cylinder(r, f(r + r));
  }

  // GetAffectCylinder @0x944E90
  getAffectCylinder(): Cylinder {
    const r = f(this.m_radius * this.affect);
    return new Cylinder(r, f(r + r));
  }

  // InDetection @0x944EB0 (object) / @0x944F70 (position)
  inDetection(pos: Vector3, other: GameCoreObject | Vector3): boolean {
    const otherPos = other instanceof GameCoreObject ? other.position : other;
    return Vector3.Distance(otherPos, pos) <= f(this.m_radius * this.m_radiusScale);
  }

  // InAttack @0x945000 (object) — affect radius; @0x945060 (position).
  inAttack(pos: Vector3, other: GameCoreObject | Vector3): boolean {
    if (other instanceof GameCoreObject) {
      return Vector3.Distance(other.position, pos) <= f(this.m_radius * this.affect);
    }
    // FAITHFUL QUIRK (verified in reconstruction): the POSITION overload reads
    // m_radiusScale (0x20), NOT affect (0x24) — it tests the detection radius.
    // Original-code inconsistency vs the object overload; reproduced as-is.
    return Vector3.Distance(other, pos) <= f(this.m_radius * this.m_radiusScale);
  }

  // IntersectWithObject @0x944F10
  intersectWithObject(pos: Vector3, other: GameCoreObject, radius: number): boolean {
    return Vector3.Distance(other.position, pos) <= radius;
  }

  // IntersectWithPos @0x944FC0
  intersectWithPos(pos: Vector3, otherPos: Vector3, radius: number): boolean {
    return Vector3.Distance(otherPos, pos) <= radius;
  }

  // GetAnchorV @0x9450B0
  getAnchorV(): number {
    return EnemyDetectorSphere.k_anchor;
  }

  // GetOffset @0x9450C0
  getOffset(): Vector3 {
    return this.offset;
  }

  // Upgrade @0x9450D0
  upgrade(scale: number, affectScale: number): void {
    this.m_radiusScale = f(scale);
    this.affect = f(affectScale);
  }

  // GetRadiusScale @0x9450E0
  getRadiusScale(): number {
    return this.m_radiusScale;
  }
}
