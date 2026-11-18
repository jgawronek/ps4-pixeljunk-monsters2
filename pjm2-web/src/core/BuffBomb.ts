// src/core/BuffBomb.ts
// TypeScript port of decomp/src/GameCore/BuffBomb.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93D260..0x93D510 —
// Ghidra pseudocode cross-checked against raw disassembly for the DealDamage
// argument setup).
// Explosion buff: applied to enemies in a bomb's blast radius. The effect is
// immediate damage scaled by distance-to-center and by strength/class damage
// tables. Duration is effectively zero (executes once, then expires).

import type { BuffSettingBombContract } from '../view/q4-contracts';
import { Buff } from './Buff';
import { DamageHelper } from './DamageHelper';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import { GameCoreEnemy } from './GameCoreEnemy';
import type { GameCoreObject } from './GameCoreObject';

const f = Math.fround;

export class BuffBomb extends Buff {
  private m_power = f(1.0); // 0x90 (initializer runs before base ctor)
  private m_distanceToCenter = f(0); // 0x94
  private m_strengthType: EEnemyStrengthTypeDef = 0; // 0x98
  private m_classType: EEnemyClassTypeDef = 0; // 0x9C

  // .ctor @0x93D260
  constructor(
    duration: number,
    setting: BuffSettingBombContract | null,
    distanceToCenter: number,
  ) {
    super(duration);
    this.m_distanceToCenter = f(distanceToCenter);
    // C#: UnityEngine.Object implicit-bool (fake-null) check.
    if (setting !== null) {
      this.m_power = f(setting.attackPower); // setting +0x3C
      this.m_strengthType = setting.strengthType; // setting +0x40
      this.m_classType = setting.classType; // setting +0x44
    }
  }

  // ExecuteBuff @0x93D3B0 (virtual slot 10)
  // Confirmed damage formula and argument order from disassembly:
  //   m_power = DamageRateByClass * (DamageRateByStrength * m_power)
  //   enemy.DealDamage(strength, class, m_power, distanceToCenter, this, null, false)
  // FAITHFUL QUIRK: the scaled power is written back into m_power.
  override executeBuff(target: GameCoreObject): void {
    const enemy = target instanceof GameCoreEnemy ? target : null;
    if (enemy !== null && !enemy.isDestroyed()) {
      const rate = f(
        DamageHelper.damageRateByStrength(this.m_strengthType, enemy) * this.m_power,
      );
      this.m_power = f(DamageHelper.damageRateByClass(this.m_classType, enemy) * rate);
      enemy.dealDamageTyped(
        this.m_strengthType,
        this.m_classType,
        this.m_power,
        this.m_distanceToCenter,
        this,
        null,
        false,
      );
    }
  }

  // OnExitBuff @0x93D510 (virtual slot 11) — just the base behaviour
  // (removeBuffEvent + StopSFX).
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
  }
}
