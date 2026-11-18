// src/core/BuffTrampoline.ts
// TypeScript port of decomp/src/GameCore/BuffTrampoline.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93F140..0x93F210).
// Like BuffFlare, the trampoline buff is a timed marker in the simulation:
// ExecuteBuff is empty and the constructor ignores its setting. The launch
// effect is driven by the Q4 layer (CommandTrampoline / BuffSettingTrampoline);
// the sim only tracks the duration.

import type { BuffSettingTrampolineContract } from '../view/q4-contracts';
import { Buff } from './Buff';
import type { GameCoreObject } from './GameCoreObject';

export class BuffTrampoline extends Buff {
  // .ctor @0x93F140 — 'setting' is not read by the binary.
  constructor(duration: number, setting: BuffSettingTrampolineContract) {
    super(duration);
  }

  // ExecuteBuff @0x93F1F0 (virtual slot 10) — no-op (confirmed empty body).
  override executeBuff(_target: GameCoreObject): void {}

  // OnExitBuff @0x93F200 (virtual slot 11) — base behaviour only.
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
  }
}
