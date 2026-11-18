// src/core/BuffFreeze.ts
// TypeScript port of decomp/src/GameCore/BuffFreeze.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93E420..0x93ECF0 —
// Ghidra pseudocode cross-checked against raw disassembly: the damage call
// uses the *untyped* DealDamage overload with the source projectile as
// damageSource, and the two RemoveBuffs calls are <BuffSlow> then <BuffFreeze>
// — generic method-info slots 0x10D4BC8 / 0x10D4BD0 via script.json).
// Freeze: slows the target (separate scales for enemies/players), extinguishes
// fire on enemies, and deals frost damage once per second while active. On exit
// it deals a final partial tick and restores speed scale to 1.

import { Mathf } from '../engine/math';
import { Buff } from './Buff';
import { BuffSlow } from './BuffSlow';
import { DamageHelper } from './DamageHelper';
import { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import type { GameCoreObject } from './GameCoreObject';
import type { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { asBuffs, asSpeedScale } from './interfaces';

const f = Math.fround;

export class BuffFreeze extends Buff {
  private m_powerPerSecond = f(0); // 0x90
  private m_speedScaleToEnemy = f(0.5); // 0x94 (pre-base initializer)
  private m_speedScaleToPlayer = f(0.5); // 0x98 (pre-base initializer)
  private m_timer = f(0); // 0x9C

  // .ctor @0x93E420
  constructor(
    duration: number,
    powerPerSec: number,
    speedScaleEnm: number,
    speedScalePlayer: number,
    sourceHandle: GameCoreHandle,
  ) {
    super(duration);
    this.m_speedScaleToEnemy = f(speedScaleEnm);
    this.m_speedScaleToPlayer = f(speedScalePlayer);
    this.m_powerPerSecond = f(powerPerSec);
    this.m_sourceProjectile = sourceHandle;
    this.m_timer = f(0.0);
  }

  // ExecuteBuff @0x93E530 (virtual slot 10)
  // Re-applies the slow and the frost damage tick every 1 second.
  override executeBuff(target: GameCoreObject): void {
    this.m_timer = f(this.m_timer - GameCore.tickDeltaTime);
    if (this.m_timer > 0.0) return;

    const speedScale = asSpeedScale(target);
    const buffs = asBuffs(target);

    let scale: number;
    const enemy = target instanceof GameCoreEnemy ? target : null;
    if (enemy !== null) {
      if (!enemy.isDestroyed()) {
        enemy.isOnFire = false; // freeze extinguishes burn (setter raises
        //                         onFireExtinguished when it was burning)
        if (this.m_powerPerSecond > 0.0) {
          // Damage typing from the source tower (via projectile).
          let towerHandle = GameCoreHandle.nullHandle;
          if (!this.m_sourceProjectile.equals(GameCoreHandle.nullHandle)) {
            const proj =
              this.m_sourceProjectile.getMostRecentObjectVersion<GameCoreProjectile>();
            if (proj !== null) towerHandle = proj.sourceTower;
          }
          let strength = EEnemyStrengthTypeDef.Normal;
          let cls = EEnemyClassTypeDef.Normal;
          if (!towerHandle.isNull) {
            const tower = towerHandle.getMostRecentObjectVersion<GameCoreTower>();
            if (tower !== null) {
              strength = tower.strengthType; // tower +0x64
              cls = tower.classType; // tower +0x68
            }
          }

          const damage = f(
            DamageHelper.damageRateByClass(cls, enemy) *
              f(
                DamageHelper.damageRateByStrength(strength, enemy) *
                  this.m_powerPerSecond,
              ),
          );

          // damageSource is the projectile itself (untyped overload).
          let source: GameCoreObject | null = null;
          if (!this.m_sourceProjectile.equals(GameCoreHandle.nullHandle)) {
            source = this.m_sourceProjectile.getMostRecentObjectVersion<GameCoreProjectile>();
          }
          enemy.dealDamage(source, damage, f(0.0), null, false);
        }
      }
      scale = this.m_speedScaleToEnemy;
    } else {
      scale = this.m_speedScaleToPlayer;
    }

    if (speedScale !== null) {
      // Only apply if this freeze is at least as strong as the current scale.
      if (scale <= speedScale.getSpeedScale()) {
        // Freeze supersedes both slows and other freezes (except itself).
        // FAITHFUL: binary dereferences 'buffs' without a null check here
        // (NullReferenceException if the target has no IBuffs).
        const container = buffs!.buffs;
        if (container !== null) {
          container.removeBuffs(target, this, BuffSlow);
          container.removeBuffs(target, this, BuffFreeze);
        }
        speedScale.setSpeedScale(scale);
      }
    }

    this.m_timer = f(1.0);
  }

  // OnExitBuff @0x93EA70 (virtual slot 11)
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);

    // Final partial damage tick for the fraction of the 1s interval elapsed.
    const enemy = target instanceof GameCoreEnemy ? target : null;
    if (enemy !== null && !enemy.isDestroyed()) {
      const fraction = Mathf.Clamp01(f(1.0 - this.m_timer));
      if (fraction > 0.0 && this.m_powerPerSecond > 0.0) {
        let source: GameCoreObject | null = null;
        if (!this.m_sourceProjectile.equals(GameCoreHandle.nullHandle)) {
          source = this.m_sourceProjectile.getMostRecentObjectVersion<GameCoreProjectile>();
        }
        enemy.dealDamage(source, f(fraction * this.m_powerPerSecond), f(0.0), null, false);
      }
    }

    // Restore normal speed.
    const speedScale = asSpeedScale(target);
    if (speedScale !== null && !target.isDestroyed()) {
      speedScale.setSpeedScale(f(1.0));
    }
  }
}
