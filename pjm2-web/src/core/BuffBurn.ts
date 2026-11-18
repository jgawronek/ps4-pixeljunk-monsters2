// src/core/BuffBurn.ts
// TypeScript port of decomp/src/GameCore/BuffBurn.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93D520..0x93D8C0 —
// pseudocode cross-checked against raw disassembly for the damage formula and
// DealDamage arguments; generic contexts via script.json 0x10D4B50/0x10D4B58).
// Burn DoT: every m_timerFrequency seconds deals powerPerSecond*frequency
// damage (power-per-second integrated over the tick interval). Damage is typed
// by the source tower (resolved via the source projectile); while the enemy is
// already on fire the tick deals 0 damage.

import { Buff } from './Buff';
import { DamageHelper } from './DamageHelper';
import { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import type { GameCoreObject } from './GameCoreObject';
import type { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';

const f = Math.fround;

export class BuffBurn extends Buff {
  private m_powerPerSecond = f(0); // 0x90
  private m_timer = f(0); // 0x94
  private m_timerFrequency = f(0); // 0x98

  // .ctor @0x93D520
  constructor(
    duration: number,
    powerPerSec: number,
    sourceHandle: GameCoreHandle,
    frequency: number,
  ) {
    super(duration);
    this.m_sourceProjectile = sourceHandle;
    this.m_powerPerSecond = f(powerPerSec);
    this.m_timerFrequency = f(frequency);
    this.m_timer = f(0.0);
  }

  // ExecuteBuff @0x93D610 (virtual slot 10)
  override executeBuff(target: GameCoreObject): void {
    // Resolve the source tower for damage typing (faithful order: resolved on
    // EVERY execute, before the timer check).
    const projectile =
      this.m_sourceProjectile.getMostRecentObjectVersion<GameCoreProjectile>();
    const towerHandle =
      projectile !== null ? projectile.sourceTower : GameCoreHandle.nullHandle;
    const tower = !towerHandle.equals(GameCoreHandle.nullHandle)
      ? towerHandle.getMostRecentObjectVersion<GameCoreTower>()
      : null;

    this.m_timer = f(this.m_timer - GameCore.tickDeltaTime);
    if (this.m_timer <= 0.0) {
      const enemy = target instanceof GameCoreEnemy ? target : null;
      if (enemy !== null && !enemy.isDestroyed()) {
        // FAITHFUL QUIRK: already-on-fire enemies take a 0-damage tick (the
        // DealDamage call still happens).
        let damage = enemy.isOnFire ? f(0.0) : this.m_powerPerSecond;
        damage = f(damage * this.m_timerFrequency);
        // No source tower → both damage types default to Normal (1).
        const strength =
          tower !== null ? tower.strengthType : EEnemyStrengthTypeDef.Normal;
        const cls = tower !== null ? tower.classType : EEnemyClassTypeDef.Normal;
        damage = f(
          DamageHelper.damageRateByClass(cls, enemy) *
            f(DamageHelper.damageRateByStrength(strength, enemy) * damage),
        );
        enemy.dealDamageTyped(strength, cls, damage, f(0.0), this, null, false);
      }
      this.m_timer = this.m_timerFrequency;
    }
  }

  // OnExitBuff @0x93D8C0 (virtual slot 11) — base behaviour only.
  // (IsOnFire is cleared by BuffFreeze, not here.)
  override onExitBuff(target: GameCoreObject): void {
    super.onExitBuff(target);
  }
}
