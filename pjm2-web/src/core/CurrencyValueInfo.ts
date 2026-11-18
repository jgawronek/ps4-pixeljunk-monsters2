// src/core/CurrencyValueInfo.ts
// TypeScript port of decomp/src/GameCore/CurrencyValueInfo.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3052,
// ctor @0x942260 — trivial field stores).
// Used by playerBumpedEvent (loose coins/gems dropped when a player is bumped)
// and consumed by the view-layer PickupManager.OnPlayerBumped.

/** A currency amount split into a total value and a per-pickup value:
 *  e.g. total=10, perValue=5 → two coins worth 5 each. */
export class CurrencyValueInfo {
  readonly total: number; // 0x0
  readonly perValue: number; // 0x4

  // .ctor @0x942260
  constructor(aTotal: number, aPerValue: number) {
    this.total = aTotal | 0;
    this.perValue = aPerValue | 0;
  }
}
