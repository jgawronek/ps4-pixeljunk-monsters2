// src/core/GameCoreProjectileTrajectory.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileTrajectory.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3065,
// RVA 0x4CBE90..0x4CD8A0). Gravity ballistic projectile: flies along
// m_moveVector, optionally home-tracks the target's per-tick displacement,
// detonates on terrain (Linecast) or the first valid damageable overlap;
// direct + radial splash damage, buffs on directly-hit players.
//
// Rodata CONFIRMED: DAT_00b7c440 = 2.5 (no-target fallback fire distance),
// DAT_00b7c444 = 0.5 (linecast half-height extension).

import { Vector3 } from '../engine/math/Vector3';
import {
  instantiateProjectileViewer,
  registerUnityObject,
  type BuffSettingContract,
  type ProjectileViewContract,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { DamageHelper } from './DamageHelper';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { asDamageable, type IDamageable } from './interfaces';
import { getSimPhysics, Q4Layers } from './physics-seam';
import { TowerHelper } from './TowerHelper';

const f = Math.fround;

export class GameCoreProjectileTrajectory extends GameCoreProjectile {
  private m_moveVector: Vector3 = Vector3.zero; // 0xB0
  private m_traceTarget = true; // 0xBC (field initializer)
  private m_gravity = f(0); // 0xC0
  private m_hitEffectScale = f(0); // 0xC4 (public get / private set)
  private m_targetHandle: GameCoreHandle = GameCoreHandle.nullHandle; // 0xC8

  // get_hitEffectScale
  get hitEffectScale(): number {
    return this.m_hitEffectScale;
  }

  // .ctor @0x4CBE90
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage: boolean) {
    super(tower, enemies, dealsDamage);
    const currentTarget = tower.getCurrentTarget();
    if (currentTarget !== null) {
      this.m_targetHandle = currentTarget.handle;
    } else if (this.m_targetHandles !== null && this.m_targetHandles.length >= 1) {
      this.m_targetHandle = this.m_targetHandles[0];
    } else {
      this.m_targetHandle = GameCoreHandle.nullHandle;
    }

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    const normFort = tower.fortDirection.normalized;
    this.m_hitEffectScale = tower.hitEffectScale; // float @0x148

    const targetObj = this.m_targetHandle.getMostRecentObjectVersion<GameCoreObject>();
    // No live target → fired 2.5 ahead along fort (DAT_00b7c440 CONFIRMED).
    const targetPos =
      targetObj === null ? tower.position.add(normFort.mulScalar(f(2.5))) : targetObj.position;
    const hitPos = TowerHelper.getProjectileGameCoreHitPoisition(tower, targetPos);

    if (viewer !== null) {
      const firePoint = viewer.getFirePointByRemainingMag(tower.magazineCapacity);
      const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle, firePoint);
      if (view !== null) {
        registerUnityObject(this.handle.m_handle, view);

        // FAITHFUL: renderer dereferenced without a null check.
        this.collision = Cylinder.fromBounds(view.getComponentInChildrenRenderer!()!.bounds);

        const fd = view.getFireDirection(
          { x: this.position.x, y: this.position.y, z: this.position.z },
          { x: hitPos.x, y: hitPos.y, z: hitPos.z },
          { x: 0, y: 0, z: 0 },
        );
        this.m_moveVector = new Vector3(fd.x, fd.y, fd.z);

        this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0);
        this.m_traceTarget = view.traceTarget ?? true;
        this.m_gravity = f(view.gravity ?? 0);

        if (enemies === null || enemies.length < 1) {
          view.setupEstimateTime?.(this);
        } else {
          const predicted = enemies[0].predictPositionAndDirection(0.0);
          view.setupEstimateTime?.(this, {
            x: predicted.pos.x,
            y: predicted.pos.y,
            z: predicted.pos.z,
          });
        }
      }
    }
  }

  // Tick @0x4CC610 — integrate, home-track, probe impacts; base lifetime inlined.
  override tick(): void {
    const dt = GameCore.tickDeltaTime;

    // Gravity is a scalar applied to y only.
    this.m_moveVector = this.m_moveVector.add(new Vector3(0, f(this.m_gravity * dt), 0));
    this.position = this.position.add(this.m_moveVector.mulScalar(dt));

    if (this.m_traceTarget) {
      const targetObj = this.m_targetHandle.getMostRecentObjectVersion<GameCoreObject>();
      if (targetObj !== null) {
        // Shift by whatever the target moved this tick.
        this.position = this.position.add(targetObj.position.sub(targetObj.previousTickPosition));
      }
    }

    const speed = this.m_moveVector.magnitude;
    // Probe ahead so fast projectiles don't tunnel (DAT_00b7c444 = 0.5).
    const lineEnd = this.position.add(
      this.m_moveVector.normalized.mulScalar(f(f(this.collision.height * 0.5) + f(speed * dt))),
    );

    const terrainHit = getSimPhysics().linecast(
      this.position.x, this.position.y, this.position.z,
      lineEnd.x, lineEnd.y, lineEnd.z,
      Q4Layers.terrainMask,
    );
    if (terrainHit !== null) {
      this.onHit(null);
      this.destroySelf();
    } else {
      const queryPos = this.position.add(Vector3.down.mulScalar(f(this.collision.height * 0.5)));
      let candidate: IDamageable | null = null;
      for (const obj of GameCore.instance!.allObjectsIn<GameCoreObject>(GameCoreObject, queryPos, this.collision)) {
        const d = asDamageable(obj);
        candidate = d !== null && d.valid() ? d : null;
        break; // FAITHFUL: first overlap's verdict only
      }
      if (candidate !== null) {
        this.onHit(candidate);
        this.destroySelf();
      }
    }

    // base.Tick inlined:
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();
  }

  // OnHit @0x4CCCE0 — direct hit + splash + player buffs + always the event.
  private onHit(hitEnemy: IDamageable | null): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();

    if (this.m_dealDamage && tower !== null) {
      // ---- Direct hit ----
      if (hitEnemy !== null) {
        if (TowerHelper.isTarget(hitEnemy.moveType(), tower.attackType) && hitEnemy.isAimableTarget(tower)) {
          const obj = hitEnemy.handle.getMostRecentObjectVersion<GameCoreObject>();
          const damage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, obj, this.m_attackPowerMax);
          hitEnemy.dealDamage(this, damage, f(0), null, true);
        }
      }

      // ---- Splash ----
      const buffSettings = this.getBuffSettings();
      const splashPos = this.position.add(Vector3.down.mulScalar(this.m_attackSpread));

      for (const obj of GameCore.instance!.allObjectsIn<GameCoreObject>(
        GameCoreObject,
        splashPos,
        new Cylinder(this.m_attackSpread, f(this.m_attackSpread + this.m_attackSpread)),
      )) {
        const d = asDamageable(obj);
        if (d === null || d === hitEnemy || !d.valid()) continue;
        if (!TowerHelper.isTarget(d.moveType(), tower.attackType) || !d.isAimableTarget(tower)) continue;

        const dist = Vector3.Distance(d.position, this.position);
        if (dist > this.m_attackSpread) continue;

        const dmg = this.getAttackDamage(dist);
        const targetObj = d.handle.getMostRecentObjectVersion<GameCoreObject>();
        const finalDamage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, targetObj, dmg);
        d.dealDamage(this, finalDamage, f(dist / this.m_attackSpread), null, true);

        // Buffs apply to directly-hit players (support projectiles).
        if (buffSettings !== null && targetObj instanceof GameCorePlayer && buffSettings.length > 0) {
          for (const setting of buffSettings) {
            setting.addBuff(this, targetObj, tower.upgradeBuffOverride);
          }
        }
      }
    }

    // Always broadcast, even with no damage / dead tower.
    Events.projectileHitEvent.invoke(this, hitEnemy);
  }

  // GetBuffSettings @0x4CD8A0 — BuffSetting components on this projectile's viewer.
  getBuffSettings(): BuffSettingContract[] | null {
    const viewer = this.getUnityObject() as ProjectileViewContract | null;
    if (viewer === null) return null;
    return viewer.getComponentsBuffSetting?.() ?? null;
  }
}
