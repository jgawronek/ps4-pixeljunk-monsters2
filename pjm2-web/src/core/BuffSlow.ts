// src/core/BuffSlow.ts
// TypeScript port of decomp/src/GameCore/BuffSlow.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93ECF0..0x93F140).
// The single RemoveBuffs call uses generic method-info slot 0x10D4BC8 =
// RemoveBuffs<BuffSlow> (resolved via script.json; same slot used by
// BuffFreeze's first call).
// Slow: reduces the target's speed scale (enemy/player value chosen from the
// setting at construction). Only applies while it is at least as strong as the
// target's current scale; replaces other slows on application.

import type { BuffSettingSlowContract } from '../view/q4-contracts';
import { Buff } from './Buff';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import { asBuffs, asSpeedScale } from './interfaces';

const f = Math.fround;

export class BuffSlow extends Buff {
  private m_speedScale = f(0); // 0x90

  // .ctor @0x93ECF0
  constructor(duration: number, setting: BuffSettingSlowContract, target: GameCoreObject) {
    super(duration);
    const isPlayer = target instanceof GameCorePlayer;
    // Binary null-checks 'setting' (NullReferenceException if null) — TS:
    // property access on null throws the same way.
    this.m_speedScale = f(isPlayer ? setting.playerSpeedScale : setting.enemySpeedScale);
  }

  // ExecuteBuff @0x93EE40 (virtual slot 10)
  override executeBuff(target: GameCoreObject): void {
    // TS ADAPTATION: C# `target as ISpeedScale/IBuffs` → duck-typed helpers.
    const speedScale = asSpeedScale(target);
    if (speedScale !== null && !target.isDestroyed()) {
      if (this.m_speedScale <= speedScale.getSpeedScale()) {
        const buffs = asBuffs(target);
        if (buffs !== null) {
          const container = buffs.buffs;
          if (container !== null) {
            container.removeBuffs(target, this, BuffSlow);
          }
        }
        speedScale.setSpeedScale(this.m_speedScale);
      }
    }
  }

  // OnExitBuff @0x93F040 (virtual slot 11)
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
    const speedScale = asSpeedScale(target);
    if (speedScale !== null && !target.isDestroyed()) {
      speedScale.setSpeedScale(f(1.0));
    }
  }
}
