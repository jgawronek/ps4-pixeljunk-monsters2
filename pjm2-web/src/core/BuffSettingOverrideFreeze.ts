// src/core/BuffSettingOverrideFreeze.ts
// TypeScript port of decomp/src/GameCore/BuffSettingOverrideFreeze.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3417,
// .ctor @0x93ECE0 — plain Object..ctor, fields stay 0).
// Data class used by tower upgrades (GameCoreTower.upgradeBuffOverride) to
// tune freeze strength/duration; consumed by Q4.BuffSettingFreeze.InternalAddBuff.

/** Marker interface for buff-setting overrides (metadata: empty interface,
 *  TypeDefIndex 3416). */
export interface IBuffSettingOverride {}

export class BuffSettingOverrideFreeze implements IBuffSettingOverride {
  speedScale = 0; // 0x10
  duration = 0; // 0x14

  // .ctor @0x93ECE0 — default constructor, fields left at 0.
  constructor() {}
}
