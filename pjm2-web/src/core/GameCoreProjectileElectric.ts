// src/core/GameCoreProjectileElectric.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileElectric.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3056,
// RVA 0x4C4F70..0x4C5640). Tesla discharge anchored at the muzzle: targets
// sorted nearest-first; a virtual bolt front (bulletSpeed*duration) zaps each
// still-valid target it reaches, removing it from the pending list.

import { Vector3 } from '../engine/math/Vector3';
import {
  instantiateProjectileViewer,
  registerUnityObject,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { DamageHelper } from './DamageHelper';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { asDamageable, type IDamageable } from './interfaces';

const f = Math.fround;

export class GameCoreProjectileElectric extends GameCoreProjectile {
  private m_bulletSpeed = f(0); // 0xB0 (view bulletSpeed @0x50)
  private m_validTargets: GameCoreHandle[] | null = null; // 0xB8

  // .ctor @0x4C4F70 — FAITHFUL NREs: null tower viewer / spawned view.
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealDamage: boolean) {
    super(tower, enemies, dealDamage);
    if (this.m_targetHandles !== null) {
      this.m_targetHandles.sort((a, b) => this.compareEnemyByDistance(a, b));
      this.m_validTargets = [...this.m_targetHandles];
    }

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) {
      throw new Error('NullReferenceException (faithful): electric projectile requires a tower viewer');
    }
    const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle);
    if (view === null) {
      throw new Error('NullReferenceException (faithful): electric projectile requires a spawned view');
    }

    registerUnityObject(this.handle.m_handle, view);
    this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0);
    this.m_bulletSpeed = f(view.bulletSpeed ?? 0);

    // Re-anchored at the muzzle after the view exists (shipped code assigns twice).
    this.position = tower.position.add(Vector3.up.mulScalar(tower.height));

    view.initializeLightnings?.(this);
  }

  // ValidTargetsCount @0x4C5250
  validTargetsCount(): number {
    if (this.m_validTargets === null) return 0;
    return this.m_validTargets.length;
  }

  // Tick @0x4C52B0 — base lifetime inlined, then hit schedule (runs on death tick).
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();

    this.tickHitSchedule();
  }

  // TickHitSchedule @0x4C5340 — bolt-front sweep; RemoveAt without advancing i
  // (the shifted entry is re-tested — faithful).
  private tickHitSchedule(): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null || this.m_validTargets === null || this.m_validTargets.length < 1) {
      this.destroySelf(); // silent — no event on this path (faithful)
      return;
    }

    let i = 0;
    while (i < this.m_validTargets.length) {
      const obj = this.m_validTargets[i].getMostRecentObjectVersion<GameCoreObject>();
      const d = asDamageable(obj);

      if (d !== null && d.valid()) {
        const muzzle = tower.position.add(Vector3.up.mulScalar(tower.height));
        const distance = Vector3.Distance(obj!.position, muzzle);
        if (f(this.duration * this.m_bulletSpeed) > distance) {
          this.onHit(d);
          this.m_validTargets.splice(i, 1);
          continue; // do not advance: test the shifted entry
        }
      }
      i++;
    }
  }

  // OnHit @0x4C5640 — full unattenuated attribute-scaled damage + event.
  private onHit(enemy: IDamageable | null): void {
    if (enemy === null) return;
    const obj = enemy.handle.getMostRecentObjectVersion<GameCoreObject>();
    const damage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, obj, this.m_attackPowerMax);
    enemy.dealDamage(this, damage, f(0), null, true);
    Events.projectileHitEvent.invoke(this, enemy);
  }
}
