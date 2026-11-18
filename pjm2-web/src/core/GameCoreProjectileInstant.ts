// src/core/GameCoreProjectileInstant.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileInstant.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3061,
// RVA 0x4C9D90..0x4CAD40). Hitscan bullet: virtual flight at bulletSpeed;
// when the muzzle→target distance drops below bulletSpeed*duration the bullet
// arrives → direct + splash damage. No current target at ctor → instant death.

import { Vector3 } from '../engine/math/Vector3';
import {
  instantiateProjectileViewer,
  registerUnityObject,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { DamageHelper } from './DamageHelper';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { asDamageable, type IDamageable } from './interfaces';
import { TowerHelper } from './TowerHelper';

const f = Math.fround;

export class GameCoreProjectileInstant extends GameCoreProjectile {
  private m_bulletSpeed = f(0); // 0xB0 (view bulletSpeed @0x48)
  private m_target: GameCoreHandle = GameCoreHandle.nullHandle; // 0xB8

  // .ctor @0x4C9D90
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealDamage: boolean) {
    super(tower, enemies, dealDamage);
    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer !== null) {
      const firePoint = viewer.getFirePointByRemainingMag(tower.magazineCapacity);
      const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle, firePoint);
      if (view !== null) {
        registerUnityObject(this.handle.m_handle, view);
        this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0);
        this.m_bulletSpeed = f(view.bulletSpeed ?? 0);
      }
    }

    const currentTarget = tower.getCurrentTarget();
    if (currentTarget === null) {
      this.destroySelf(); // faithful: no target → immediate death
    } else {
      this.m_target = currentTarget.handle;
    }
  }

  // Tick @0x4CA0D0 — base lifetime inlined, then hit schedule (runs on death tick).
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();

    this.tickHitSchedule();
  }

  // TickHitSchedule @0x4CA160
  private tickHitSchedule(): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const targetObj = this.m_target.getMostRecentObjectVersion<GameCoreObject>();

    if (tower === null || targetObj === null) {
      this.destroySelf();
      Events.projectileHitEvent.invoke(this, null);
      return;
    }

    const muzzle = tower.position.add(Vector3.up.mulScalar(tower.height));
    const distance = Vector3.Distance(targetObj.position, muzzle);

    if (distance < f(this.m_bulletSpeed * this.duration)) {
      const enemy = asDamageable(targetObj);
      if (enemy !== null && enemy.valid()) {
        this.onHit(enemy);
        this.destroySelf();
      }
    }
  }

  // OnHit @0x4CA3C0 — direct + splash (no buffs; no event on null enemy/tower).
  private onHit(enemy: IDamageable): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    if (enemy === null || tower === null) return;

    // Direct hit (live tower attributes, not the ctor snapshot).
    const obj = enemy.handle.getMostRecentObjectVersion<GameCoreObject>();
    const damage = DamageHelper.damageByAttributes(tower.strengthType, tower.classType, obj, this.m_attackPowerMax);
    enemy.dealDamage(this, damage, f(0), null, true);

    Events.projectileHitEvent.invoke(this, enemy);

    // Splash around the enemy's position.
    const enemyPos = enemy.position;
    const splashPos = enemyPos.add(Vector3.down.mulScalar(this.m_attackSpread));

    for (const other of GameCore.instance!.allObjectsIn<GameCoreObject>(
      GameCoreObject,
      splashPos,
      new Cylinder(this.m_attackSpread, f(this.m_attackSpread + this.m_attackSpread)),
    )) {
      const d = asDamageable(other);
      if (d === null || d === enemy) continue;
      // NOTE: Instant splash does NOT check Valid() (unlike Trajectory) — faithful.
      if (!TowerHelper.isTarget(d.moveType(), tower.attackType) || !d.isAimableTarget(tower)) continue;

      const dist = Vector3.Distance(d.position, enemyPos);
      if (dist > this.m_attackSpread) continue;

      const dmg = this.getAttackDamage(dist);
      const finalDamage = DamageHelper.damageByAttributes(tower.strengthType, tower.classType, other, dmg);
      d.dealDamage(this, finalDamage, f(dist / this.m_attackSpread), null, true);
    }
  }

  // CompareEnemyByDistance @0x4CAD40 (IDamageable overload)
  compareDamageableByDistance(left: IDamageable | null, right: IDamageable): number {
    if (left === null) return 0;
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null) return 0;
    const muzzle = tower.position.add(Vector3.up.mulScalar(tower.height));
    const leftDist = Vector3.Distance(left.position, muzzle);
    const rightDist = Vector3.Distance(right.position, muzzle); // FAITHFUL: NRE on null right
    return leftDist < rightDist ? -1 : leftDist > rightDist ? 1 : 0;
  }
}
