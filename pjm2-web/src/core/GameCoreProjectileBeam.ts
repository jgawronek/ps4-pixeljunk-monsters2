// src/core/GameCoreProjectileBeam.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileBeam.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3055,
// RVA 0x4C3B60..0x4C4DF0). Continuous laser: flies straight, sweeping a
// capsule of radius m_radius along the frame segment; zaps each touched
// damageable once (distanceToCenter 0). Terrain impact latches spread mode:
// everything still-valid within m_attackSpread of the impact gets one more zap.
// Rodata CONFIRMED: DAT_00b7c40c = 0.0 (perpendicular-distance² comparison).

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
import { getSimPhysics, Q4Layers } from './physics-seam';

const f = Math.fround;

export class GameCoreProjectileBeam extends GameCoreProjectile {
  private m_directiveTarget: GameCoreHandle = GameCoreHandle.nullHandle; // 0xB0
  private m_speed = f(0); // 0xD0
  private m_startPoint: Vector3 = Vector3.zero; // 0xD4
  private m_direction: Vector3 = Vector3.zero; // 0xE0
  private m_beamFlyLength = f(0); // 0xEC
  private m_radius = f(0); // 0xF0
  private m_triggerSpread = false; // 0xF4
  private m_lastFrameDistance = f(0); // 0xF8
  private m_attackTargets: GameCoreHandle[] = []; // 0x100

  // .ctor @0x4C3B60 — FAITHFUL NREs: null tower / dead directive target.
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super(tower, enemies, dealsDamage);
    const currentTarget = tower.getCurrentTarget();

    if (this.m_targetHandles !== null && this.m_targetHandles.length > 0) {
      this.m_targetHandles.sort((a, b) => this.compareEnemyByDistance(a, b));
      this.m_directiveTarget =
        currentTarget !== null ? currentTarget.handle : this.m_targetHandles[0];
    }

    this.m_startPoint = this.position;

    const targetObj = this.m_directiveTarget.getMostRecentObjectVersion<GameCoreObject>();
    if (targetObj === null) {
      throw new Error('NullReferenceException (faithful): beam directive target is dead');
    }

    this.m_direction = targetObj.position.sub(this.m_startPoint).normalized;

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer !== null) {
      const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle);
      if (view !== null) {
        registerUnityObject(this.handle.m_handle, view);
        this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0);
        this.m_beamFlyLength = f(view.beamFlyLength ?? 0);
        this.m_speed = f(view.speed ?? 0);
        this.m_radius = f(view.radius ?? 0);
        if (this.m_targetHandles !== null && this.m_targetHandles.length > 0) {
          view.initBeam?.(viewer, this.m_targetHandles[0]);
        }
      }
    }

    this.m_attackTargets = [];
  }

  // Tick @0x4C4100 — base lifetime inlined; fly + (until spread latched) probes.
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();

    this.tickBeamFly(dt);

    if (!this.m_triggerSpread) {
      this.tickRayCastGround();
      this.tickLineCastEnemies();
      this.tickHitEnemiesSpread();
    }
  }

  // TickBeamFly @0x4C41E0
  private tickBeamFly(dt: number): void {
    if (this.isDestroyed()) return;
    this.m_lastFrameDistance = f(dt * this.m_speed);
    this.position = this.position.add(this.m_direction.mulScalar(this.m_lastFrameDistance));
  }

  // TickRayCastGround @0x4C4290
  private tickRayCastGround(): void {
    const lineEnd = this.position.add(this.m_direction.mulScalar(this.m_lastFrameDistance));
    const hit = getSimPhysics().linecast(
      this.position.x, this.position.y, this.position.z,
      lineEnd.x, lineEnd.y, lineEnd.z,
      Q4Layers.terrainMask,
    );
    if (hit !== null) {
      this.m_beamFlyLength = Vector3.Distance(
        this.m_startPoint,
        new Vector3(hit.point[0], hit.point[1], hit.point[2]),
      );
      this.m_triggerSpread = true;
    }
  }

  // TickLineCastEnemies @0x4C4420 — swept-capsule test over ALL core objects.
  private tickLineCastEnemies(): void {
    for (const obj of GameCore.instance!.allObjects<GameCoreObject>(GameCoreObject)) {
      const combinedRadius = f(obj.collision.radius + this.m_radius);
      const delta = obj.position.sub(this.position);
      const along = Vector3.Dot(this.m_direction, delta);
      if (along < 0.0) continue;

      const distance = delta.magnitude;
      if (distance > f(this.m_lastFrameDistance + this.m_radius)) continue;

      // Perpendicular distance² = |delta|² − along²; strictly inside (DAT_00b7c40c = 0).
      if (f(f(combinedRadius * combinedRadius) - f(f(distance * distance) - f(along * along))) <= 0.0) {
        continue;
      }

      if (this.m_attackTargets.some((h) => h.equals(obj.handle))) continue;
      this.m_attackTargets.push(obj.handle);

      const d = asDamageable(obj);
      if (d !== null && d.valid()) this.onHit(d, f(0));
    }
  }

  // TickHitEnemiesSpread @0x4C4910 — one-shot spread on the terrain-impact tick.
  private tickHitEnemiesSpread(): void {
    if (!this.m_triggerSpread) return;

    const impactPoint = this.m_startPoint.add(this.m_direction.mulScalar(this.m_beamFlyLength));

    for (const obj of GameCore.instance!.allObjects<GameCoreObject>(GameCoreObject)) {
      const d = asDamageable(obj);
      if (d === null || !d.valid()) continue;
      if (this.m_attackTargets.some((h) => h.equals(d.handle))) continue;

      const dist = Vector3.Distance(obj.position, impactPoint);
      if (dist <= this.m_attackSpread) {
        this.onHit(d, f(0)); // distanceToCenter 0 in the decompilation
      }
    }
  }

  // OnHit @0x4C4DF0 — full attribute-scaled damage (no curve), then the event.
  private onHit(enemy: IDamageable | null, distanceToCenter = f(0)): void {
    if (enemy === null) return;
    const obj = enemy as unknown as GameCoreObject;
    const damage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, obj, this.m_attackPowerMax);
    enemy.dealDamage(this, damage, distanceToCenter, null, true);
    Events.projectileHitEvent.invoke(this, enemy);
  }
}
