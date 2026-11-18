// src/core/BuffFastPlayer.ts
// TypeScript port of decomp/src/GameCore/BuffFastPlayer.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93DF60..0x93E350).
// Speed boost: raises the target's speed scale (enemy/player value chosen from
// the setting). Unlike slow/freeze, it only applies while the target's current
// scale is <= the boost (fastest effect wins), and restores 1.0 on exit.

import type { BuffSettingFastPlayerContract } from '../view/q4-contracts';
import { Buff } from './Buff';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import { asSpeedScale } from './interfaces';

const f = Math.fround;

export class BuffFastPlayer extends Buff {
  private m_speedScale = f(1.5); // 0x90 (pre-base initializer)
  private m_duration = f(0.5); // 0x94 (pre-base initializer)
  private m_isContinuous = false; // 0x98

  // .ctor @0x93DF60
  // NOTE (from the C# reconstruction): m_duration/m_isContinuous are stored
  // but never read inside this class — presumably Q4.BuffSettingFastPlayer
  // uses them to re-apply the buff continuously while the player stays in
  // range. Kept for fidelity.
  constructor(
    duration: number,
    setting: BuffSettingFastPlayerContract,
    target: GameCoreObject,
  ) {
    super(duration);
    const isPlayer = target instanceof GameCorePlayer;
    // Binary null-checks 'setting' (NullReferenceException if null) — TS:
    // property access on null throws the same way.
    this.m_speedScale = f(isPlayer ? setting.playerSpeedScale : setting.enemySpeedScale);
    this.m_duration = f(duration);
    this.m_isContinuous = setting.isContinuous;
  }

  // ExecuteBuff @0x93E0D0 (virtual slot 10)
  override executeBuff(target: GameCoreObject): void {
    // TS ADAPTATION: C# `target as ISpeedScale` → duck-typed asSpeedScale.
    const speedScale = asSpeedScale(target);
    if (speedScale !== null && !target.isDestroyed()) {
      if (speedScale.getSpeedScale() <= this.m_speedScale) {
        speedScale.setSpeedScale(this.m_speedScale);
      }
    }
  }

  // OnExitBuff @0x93E250 (virtual slot 11)
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
    const speedScale = asSpeedScale(target);
    if (speedScale !== null && !target.isDestroyed()) {
      speedScale.setSpeedScale(f(1.0));
    }
  }
}
