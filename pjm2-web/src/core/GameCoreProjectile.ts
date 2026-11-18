// src/core/GameCoreProjectile.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectile.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3064,
// RVA 0x4C3230..0x4C3AC0). Abstract base of every sim projectile — spawned
// reflectively by TowerStateAttack.OnAttack with (tower, targets, dealsDamage).
//
// TS ADAPTATION: AttenuationInfo rows → data-layer AttackAttenuation shape;
// Q4.Projectile viewer → ProjectileViewContract.

import { Vector3 } from '../engine/math/Vector3';
import type { AttackAttenuation } from '../data/types';
import type { ProjectileViewContract } from '../view/q4-contracts';
import { AttenuationCurve } from './AttenuationCurve';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import type { GameCoreTower } from './GameCoreTower';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import type { IDamageable } from './interfaces';

const f = Math.fround;

export abstract class GameCoreProjectile extends GameCoreObject {
  sourceTower: GameCoreHandle = GameCoreHandle.nullHandle; // 0x60
  protected m_towerClass: EEnemyClassTypeDef = 0; // 0x80
  protected m_towerStrength: EEnemyStrengthTypeDef = 0; // 0x84
  duration = f(0); // 0x88 (public)
  protected m_attackPowerMax = f(0); // 0x8C
  protected m_attackSpread = f(0); // 0x90
  protected m_attackAttenuations: AttackAttenuation[] | null = null; // 0x98
  protected m_dealDamage = true; // 0xA0 (field initializer)
  protected m_maxTimeAlive = f(0); // 0xA4
  protected m_targetHandles: GameCoreHandle[] | null = null; // 0xA8

  // .ctor @0x4C3230 — FAITHFUL: NRE on null tower.
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super();
    this.sourceTower = tower.handle;
    this.m_towerClass = tower.classType;
    this.m_towerStrength = tower.strengthType;
    this.m_dealDamage = dealsDamage;
    this.duration = f(0.0);

    if (enemies !== null && enemies.length > 0) {
      this.m_targetHandles = [];
      for (const enemy of enemies) {
        if (enemy !== null) this.m_targetHandles.push(enemy.handle);
      }
    }

    this.m_attackPowerMax = tower.attackPower;
    this.m_attackSpread = tower.attackSpread;
    this.m_attackAttenuations = tower.attackAttenuationInfos as AttackAttenuation[] | null;

    this.position = tower.position.add(Vector3.up.mulScalar(tower.height));
  }

  // Tick @0x4C3580 — age; destroy once m_maxTimeAlive elapses.
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();
  }

  // GetTargets @0x4C3610
  getTargets(): GameCoreHandle[] | null {
    return this.m_targetHandles;
  }

  // GetAttackDamage @0x4C3620 — curve-attenuated, power-scaled damage.
  protected getAttackDamage(distance: number): number {
    return f(
      AttenuationCurve.sample(this.m_attackAttenuations, f(distance / this.m_attackSpread)) *
        this.m_attackPowerMax,
    );
  }

  // DamageToEnemyInfo @0x4C3650 — telemetry string (damage/damageRate unused).
  damageToEnemyInfo(enemy: unknown | null, _damage: number, _damageRate: number): string {
    let result = '';
    if (enemy === null) return result;
    if (this.sourceTower.isNull) return result;

    const viewer = this.sourceTower.getUnityObject() as { name?: string } | null;
    if (viewer === null) return result + '\n' + '------------------------------';

    const enemyName = (enemy as { name?: string }).name ?? '';
    result += `From ${viewer.name ?? ''} to ${enemyName}` + '\n';
    return result + '\n' + '------------------------------';
  }

  // CompareEnemyByDistance @0x4C38E0 — sort comparer by muzzle distance.
  compareEnemyByDistance(left: GameCoreHandle, right: GameCoreHandle): number {
    const leftObj = left.getMostRecentObjectVersion<GameCoreObject>();
    const rightObj = right.getMostRecentObjectVersion<GameCoreObject>();
    if (leftObj === null || rightObj === null) return 0;

    // FAITHFUL: original NREs when the source tower is gone.
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>()!;
    const towerMuzzle = tower.position.add(Vector3.up.mulScalar(tower.height));

    const leftDist = Vector3.Distance(leftObj.position, towerMuzzle);
    const rightDist = Vector3.Distance(rightObj.position, towerMuzzle);
    return leftDist < rightDist ? -1 : leftDist > rightDist ? 1 : 0;
  }

  // RecreateViewer @0x4C3AC0 — reuse the existing view's GameObject or null.
  override recreateViewer(): unknown | null {
    const viewer = this.getUnityObject() as ProjectileViewContract | null;
    if (viewer === null) return null;
    return viewer.gameObject ?? null;
  }
}
