// src/core/BuffFlare.ts
// TypeScript port of decomp/src/GameCore/BuffFlare.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93E350..0x93E420).
// Flare is a pure timed marker in the simulation: ExecuteBuff is empty and the
// constructor ignores its setting. The actual flare behaviour (aggro/attention
// redirect + presentation) lives in Q4.BuffSettingFlare.OnFlareTriggered and
// the flareEvent hub; the sim only tracks the duration.

import type { BuffSettingFlareContract } from '../view/q4-contracts';
import { Buff } from './Buff';
import type { GameCoreObject } from './GameCoreObject';

export class BuffFlare extends Buff {
  // .ctor @0x93E350 — 'setting' is not read by the binary.
  constructor(setting: BuffSettingFlareContract, duration: number) {
    super(duration);
  }

  // ExecuteBuff @0x93E400 (virtual slot 10) — no-op (confirmed empty body).
  override executeBuff(_target: GameCoreObject): void {}

  // OnExitBuff @0x93E410 (virtual slot 11) — base behaviour only.
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
  }
}
