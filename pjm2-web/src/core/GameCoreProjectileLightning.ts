// src/core/GameCoreProjectileLightning.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileLightning.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3062,
// RVA 0x4CAFB0..0x4CBC10). Lightning strike: snapshots every aimable
// damageable (deduped by host enemy) with a random per-target strike delay;
// Tick fires due bolts; lives until the target list is exhausted — the base
// lifetime (duration/m_maxTimeAlive) is NEVER touched (faithful oddity).
// Field initializers CONFIRMED: m_initialDelay 1.0, m_randomFactorMax 0.5.

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

/** C#: LightningTargetInfo (private serializable struct, TypeDefIndex 3063). */
class LightningTargetInfo {
  delayTime: number; // 0x0
  target: GameCoreHandle; // 0x8
  constructor(time: number, targetHandle: GameCoreHandle) {
    this.delayTime = f(time);
    this.target = targetHandle;
  }
}

export class GameCoreProjectileLightning extends GameCoreProjectile {
  private m_attackTimer = f(0); // 0xB0
  private m_initialDelay = f(1.0); // 0xB4 (view initialAttackDelay @0x6C; never read by sim — faithful)
  private m_randomFactorMin = f(0); // 0xB8 (view randomAttackTimeMin @0x70)
  private m_randomFactorMax = f(0.5); // 0xBC (view randomAttackTimeMax @0x74)
  private m_lightningAttackTargets: LightningTargetInfo[] | null = null; // 0xC0

  // .ctor @0x4CAFB0 — view spawned at the TOWER position (not the muzzle).
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super(tower, enemies, dealsDamage);
    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer !== null) {
      const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle, {
        x: tower.position.x,
        y: tower.position.y,
        z: tower.position.z,
      });
      if (view !== null) {
        registerUnityObject(this.handle.m_handle, view);
        this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0);
        this.m_initialDelay = f(view.initialAttackDelay ?? 1.0);
        this.m_randomFactorMin = f(view.randomAttackTimeMin ?? 0);
        this.m_randomFactorMax = f(view.randomAttackTimeMax ?? 0.5);
      }
    }
    this.initAttackTargets(tower);
  }

  // InitAttackTargets @0x4CB1D0 — global snapshot, host-deduped, random delays.
  private initAttackTargets(tower: GameCoreTower): void {
    this.m_lightningAttackTargets = [];
    const visitedHosts: Array<GameCoreObject | null> = [];

    for (const obj of GameCore.instance!.allObjects<GameCoreObject>(GameCoreObject)) {
      const d = asDamageable(obj);
      if (d === null) continue;

      const host = d.host();
      if (visitedHosts.includes(host)) continue;
      if (obj.isDestroyed()) continue;
      if (!d.isAimableTarget(tower)) continue;

      visitedHosts.push(host);

      const targetHandle = d.handle;
      // INFERRED (reconstruction): RandomRange keyed by the projectile handle.
      const delayTime = GameCoreObject.randomRangeF(this.m_randomFactorMin, this.m_randomFactorMax, this.handle);
      this.m_lightningAttackTargets.push(new LightningTargetInfo(delayTime, targetHandle));
    }
  }

  // Tick @0x4CB850 — FAITHFUL: base lifetime never touched.
  override tick(): void {
    this.m_attackTimer = f(this.m_attackTimer + GameCore.tickDeltaTime);
    this.tickHitSchedule();
    this.tickLife();
  }

  // TickHitSchedule @0x4CB910 — strike due targets; no-advance removal (faithful).
  private tickHitSchedule(): void {
    if (this.m_lightningAttackTargets === null || this.m_lightningAttackTargets.length < 1) return;

    let i = 0;
    while (i < this.m_lightningAttackTargets.length) {
      const info = this.m_lightningAttackTargets[i];
      if (this.m_attackTimer < info.delayTime) {
        i++;
        continue;
      }
      const obj = info.target.getMostRecentObjectVersion<GameCoreObject>();
      const d = asDamageable(obj);
      if (d !== null && d.valid()) {
        this.onHit(d);
        this.m_lightningAttackTargets.splice(i, 1);
        continue; // re-test the shifted entry
      }
      i++;
    }
  }

  // TickLife @0x4CBBA0 — done when the list is empty (dt unused, faithful).
  private tickLife(): void {
    if (this.m_lightningAttackTargets !== null && this.m_lightningAttackTargets.length !== 0) return;
    this.destroySelf();
  }

  // OnHit @0x4CBC10 — full unattenuated attribute-scaled damage + event.
  private onHit(enemy: IDamageable | null): void {
    if (enemy === null) return;
    const obj = enemy.handle.getMostRecentObjectVersion<GameCoreObject>();
    const damage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, obj, this.m_attackPowerMax);
    enemy.dealDamage(this, damage, f(0), null, true);
    Events.projectileHitEvent.invoke(this, enemy);
  }
}
