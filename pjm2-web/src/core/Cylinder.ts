// src/core/Cylinder.ts
// TypeScript port of decomp/src/GameCore/Cylinder.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2980,
// ctors @0x942270 / @0x942370, shared body FUN_00942280).
// Collision volume of a sim object: vertical cylinder (radius in XZ, height
// along Y). Used by the GameCoreCollisionManager broad/narrow phase.
//
// TS NOTE: fields are fround'd to preserve the fp32 semantics of the original
// struct. The Bounds ctor is written against a structural BoundsLike shape so
// this module has no dependency on engine/math yet; when engine/math lands,
// the inline min/max/lerp below should switch to Mathf (identical formulas:
// Unity Lerp(a,b,t) = a + (b-a)*Clamp01(t), t = 0.2 here — the literal at
// 0x00BA4480, confirmed by float read).

/** Structural subset of UnityEngine.Bounds used by the fromBounds ctor. */
export interface BoundsLike {
  size: { x: number; y: number; z: number };
  extents: { x: number; y: number; z: number };
}

export class Cylinder {
  radius: number; // 0x0
  height: number; // 0x4

  // .ctor @0x942270
  constructor(a_radius: number, a_height: number) {
    this.radius = Math.fround(a_radius);
    this.height = Math.fround(a_height);
  }

  // .ctor @0x942370 (shared body FUN_00942280)
  // Builds a cylinder that encloses a Bounds: height = bounds.size.y;
  // radius = Lerp(min(extents.x, extents.z), max(extents.x, extents.z), 0.2).
  static fromBounds(a_bounds: BoundsLike): Cylinder {
    const height = Math.fround(a_bounds.size.y);
    const min = Math.fround(Math.min(a_bounds.extents.x, a_bounds.extents.z));
    const max = Math.fround(Math.max(a_bounds.extents.x, a_bounds.extents.z));
    const t = 0.2;
    const radius = Math.fround(min + Math.fround(Math.fround(max - min) * Math.fround(t)));
    return new Cylinder(radius, height);
  }
}
