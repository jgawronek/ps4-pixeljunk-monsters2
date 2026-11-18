// src/core/GameCoreProjectileInsect.ts
// TypeScript port of GameCore.GameCoreProjectileInsect (TypeDefIndex 3059, RVA 0x4C7B00..0x4C9D90): one HIVE BEE
// (tower_008). NO C# reconstruction exists upstream: ported from the Ghidra pseudo-C
// (decomp/decompiled/GameCore.GameCoreProjectileInsect.c + .InsectState.c) — the previous file was a skeleton.
// Rodata floats read from Il2CppUserAssemblies.elf (file offset = vaddr + 0x4000):
//   DAT_00b7c428 = 2.0  (hover height above a passing player), DAT_00b7c42c = 0.0, DAT_00b7c430 = 0.0 (life == 0 tests),
//   DAT_00b7c434 = 1.0  (ground probe half-length), DAT_00b7c438 = 0.1 (offset MoveTowards rate, u/s),
//   DAT_00b7c43c = 0.1  (arrival radius). Ctor field initialisers (written BEFORE the base ctor, then overridden by the
//   Q4.ProjectileInsect view): m_moveSpeed 2.5, m_rotateSpeed 75.0, m_detectionRange 2.0, m_attackStandbyDuration 2.0,
//   m_attackAppreachSpeed 10.0 (0x4296000040200000 / 0x4000000040000000 / 0x41200000).
//
// Behaviour: a bee spawns at the tower muzzle, flies a swirl (initial heading AWAY from the hover destination rotated by
// random yaw/roll angles in ±[flyInitAngleMin,flyInitAngleMax]) and homes (RotateTowards at m_rotateSpeed deg/s, moving
// at flySpeed) onto a hover destination: 2.0 above the next not-yet-visited player, else above the tower. While hovering it
// scans a cylinder (detectRange) for damageables; the closest valid one becomes its target (beeSpotATargetEvent), then it
// waits attackWaitDuration (StateAttackStandBy) and dives at attackFlySpeed (StateAttackAppreach); on arrival it deals the
// tower's full attributed damage (OnHit) and is consumed. Bees that reach their destination with no players left
// (list empty) vanish (DestroySelf + projectileHitEvent(null)). The tower's TowerStateIdle budget (insectAmountMax) counts
// every live insect.
// The delegate-typed state field (InsectState) is a plain function reference here.

import { Mathf } from '../engine/math';
import { Quaternion } from '../engine/math/Quaternion';
import { Vector3 } from '../engine/math/Vector3';
import {
  instantiateProjectileViewer,
  registerUnityObject,
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

const f = Math.fround;

/** Q4.ProjectileInsect view fields read by the ctor (+0x18, +0x4C..+0x64). */
export interface InsectViewContract extends ProjectileViewContract {
  flyInitAngleMin?: number; // 0x4C
  flyInitAngleMax?: number; // 0x50
  flySpeed?: number; // 0x54
  attackFlySpeed?: number; // 0x58
  attackWaitDuration?: number; // 0x5C
  onGroundHeight?: number; // 0x60
  enemyDetectRange?: number; // 0x64
}

type InsectState = (dt: number) => void; // GameCoreProjectileInsect.InsectState (delegate)

export class GameCoreProjectileInsect extends GameCoreProjectile {
  private m_insectState: InsectState | null = null; // 0xB0
  private m_destinationPoint: Vector3 = Vector3.zero; // 0xB8
  private m_moveVector: Vector3 = Vector3.zero; // 0xC4
  private m_currentRotation: Quaternion = Quaternion.identity; // 0xD0
  private m_moveSpeed = f(2.5); // 0xE0
  private m_rotateSpeed = f(75.0); // 0xE4
  private m_playersPassedBy: GameCoreHandle[] | null = null; // 0xE8
  private m_detectionRange = f(2.0); // 0xF0
  private m_attackStandbyDuration = f(2.0); // 0xF4
  private m_attackAppreachSpeed = f(10.0); // 0xF8
  private m_onGroundHeight = f(0); // 0xFC
  private m_onGroundOffset = f(0); // 0x100
  private m_flyInitAngleMin = f(0); // 0x104
  private m_flyInitAngleMax = f(0); // 0x108

  // .ctor @0x4C7B00
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super(tower, enemies, dealsDamage);
    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) throw new Error('NullReferenceException (faithful): GameCoreProjectileInsect without tower viewer');
    const firePoint = viewer.getFirePointByRemainingMag(tower.magazineCapacity);
    const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle, firePoint) as InsectViewContract | null;
    if (view !== null) {
      registerUnityObject(this.handle.m_handle, view);
      this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0); // +0x18
      this.m_moveSpeed = f(view.flySpeed ?? 0); // +0x54
      this.m_onGroundHeight = f(view.onGroundHeight ?? 0); // +0x60
      this.m_flyInitAngleMin = f(view.flyInitAngleMin ?? 0); // +0x4C
      this.m_flyInitAngleMax = f(view.flyInitAngleMax ?? 0); // +0x50
      this.m_detectionRange = f(view.enemyDetectRange ?? 0); // +0x64
      this.m_attackAppreachSpeed = f(view.attackFlySpeed ?? 0); // +0x58
      this.m_attackStandbyDuration = f(view.attackWaitDuration ?? 0); // +0x5C
    }

    this.changeHoverTarget();

    // Heading: AWAY from the destination in the XZ plane, then two random swirl rotations.
    const away = this.position.sub(this.m_destinationPoint);
    this.m_moveVector = new Vector3(away.x, 0, away.z).normalized;
    let rot = Quaternion.LookRotation(this.m_moveVector);
    const yaw = this.randomFromMultipleRange(this.m_flyInitAngleMin, this.m_flyInitAngleMax);
    rot = rot.multiply(Quaternion.AngleAxis(yaw, Vector3.up));
    const roll = this.randomFromMultipleRange(this.m_flyInitAngleMin, this.m_flyInitAngleMax);
    rot = rot.multiply(Quaternion.AngleAxis(roll, this.m_moveVector));
    this.m_currentRotation = rot;
    this.m_moveVector = rot.multiplyVector(Vector3.forward);

    this.setState((dt) => this.stateHover(dt)); // InsectState(StateHover)
  }

  // RandomFromMultipleRange @0x4C86D0 — a draw from [-max,-min] and one from [min,max]; a coin picks which survives
  // (all three draws are always consumed, in this order).
  private randomFromMultipleRange(min: number, max: number): number {
    const negative = GameCoreObject.randomRangeF(f(-max), f(-min));
    const positive = GameCoreObject.randomRangeF(min, max);
    const coin = GameCoreObject.randomRangeI(0, 2);
    return coin === 0 ? negative : positive;
  }

  // SetState @0x4C8770
  private setState(state: InsectState): void {
    if (this.m_insectState !== state) this.m_insectState = state;
  }

  // DestroySelf @0x4C87A0 — plain flag + grid removal (same as the base).
  override destroySelf(): void {
    super.destroySelf();
  }

  // Tick @0x4C87E0 — run the state, then burn life; once life hits 0 the rotate speed grows exponentially (the bee
  // spirals in to its destination and is consumed there).
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    if (this.m_insectState !== null) this.m_insectState(dt);
    this.m_maxTimeAlive = Mathf.Max(0, f(this.m_maxTimeAlive - dt));
    if (this.m_maxTimeAlive === 0.0) {
      this.m_rotateSpeed = f(this.m_rotateSpeed + f(this.m_rotateSpeed * dt));
    }
  }

  // ChangeHoverTarget @0x4C80C0
  private changeHoverTarget(): void {
    if (this.m_playersPassedBy === null) this.m_playersPassedBy = [];
    let found = false;
    for (const p of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      if (this.m_playersPassedBy.some((h) => h.equals(p.handle))) continue;
      if (p.handle.m_handle !== -1) {
        this.m_destinationPoint = p.position.add(Vector3.up.mulScalar(f(2.0))); // DAT_00b7c428
        this.m_playersPassedBy.push(p.handle);
        found = true;
      }
    }
    if (!found) {
      this.m_playersPassedBy.length = 0;
      const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
      if (tower === null) {
        this.destroySelf();
        Events.projectileHitEvent.invoke(this, null);
      } else {
        this.m_destinationPoint = tower.position.add(Vector3.up.mulScalar(tower.height));
      }
    }
  }

  // TickGroundAttaching @0x4C8A00 — probe the terrain 1.0 above/below; drift the vertical offset toward
  // (hit.y + onGroundHeight - y) at 0.1 u/s, or toward 0 when nothing is below.
  private tickGroundAttaching(dt: number): void {
    const a = this.position.add(Vector3.up.mulScalar(f(1.0)));
    const b = this.position.add(Vector3.down.mulScalar(f(1.0)));
    const hit = getSimPhysics().linecast(a.x, a.y, a.z, b.x, b.y, b.z, Q4Layers.terrainMask);
    let target = f(0);
    if (hit !== null) target = f(f(hit.point[1] + this.m_onGroundHeight) - this.position.y);
    this.m_onGroundOffset = Mathf.MoveTowards(this.m_onGroundOffset, target, f(dt * f(0.1)));
  }

  // TickHover @0x4C8C30
  private tickHover(dt: number): void {
    const toDest = this.m_destinationPoint.sub(this.position).normalized;
    this.m_currentRotation = Quaternion.RotateTowards(
      this.m_currentRotation, Quaternion.LookRotation(toDest), f(dt * this.m_rotateSpeed),
    );
    this.m_moveVector = this.m_currentRotation.multiplyVector(Vector3.forward);
    this.position = this.position.add(this.m_moveVector.mulScalar(this.m_moveSpeed).mulScalar(dt));
    // FAITHFUL: the ground offset is applied as a per-tick position delta.
    this.position = this.position.add(Vector3.up.mulScalar(this.m_onGroundOffset));
    if (this.position.sub(this.m_destinationPoint).magnitude <= 0.1) {
      if (this.m_playersPassedBy === null) throw new Error('NullReferenceException (faithful): insect playersPassedBy');
      if (this.m_playersPassedBy.length === 0) {
        this.destroySelf();
        Events.projectileHitEvent.invoke(this, null);
      } else {
        this.changeHoverTarget();
      }
    }
  }

  // TickEnemyDetection @0x4C8F70 — closest valid damageable within the detection range becomes the target.
  private tickEnemyDetection(): void {
    const origin = this.position.add(Vector3.down.mulScalar(this.m_detectionRange));
    let best: IDamageable | null = null;
    let bestDist = f(0);
    for (const obj of GameCore.instance!.allObjectsIn<GameCoreObject>(
      GameCoreObject, origin, new Cylinder(this.m_detectionRange, f(this.m_detectionRange + this.m_detectionRange)),
    )) {
      const d = asDamageable(obj);
      if (d === null || !d.valid()) continue;
      const dist = Vector3.Distance(this.position, d.position);
      if (dist <= this.m_detectionRange && (best === null || dist < bestDist)) {
        best = d;
        bestDist = dist;
      }
    }
    if (best === null) return;
    this.m_targetHandles = [best.handle];
    this.setState((dt) => this.stateAttackStandBy(dt));
    Events.beeSpotATargetEvent.invoke(this, this.m_targetHandles[0]);
  }

  // OnHit @0x4C9660 — full attributed damage (no curve), then projectileHitEvent.
  private onHit(hitEnemy: IDamageable | null): void {
    if (hitEnemy !== null) {
      const obj = hitEnemy.handle.getMostRecentObjectVersion<GameCoreObject>();
      const damage = DamageHelper.damageByAttributes(this.m_towerStrength, this.m_towerClass, obj, this.m_attackPowerMax);
      hitEnemy.dealDamage(this, damage, f(0), null, true);
    }
    Events.projectileHitEvent.invoke(this, hitEnemy);
  }

  // StateHover @0x4C9880
  private stateHover(dt: number): void {
    this.tickHover(dt);
    this.tickGroundAttaching(dt);
    this.tickEnemyDetection();
  }

  // StateAttackStandBy @0x4C98B0
  private stateAttackStandBy(dt: number): void {
    this.m_attackStandbyDuration = f(this.m_attackStandbyDuration - dt);
    if (this.m_attackStandbyDuration <= 0.0) {
      this.m_attackStandbyDuration = f(0);
      this.setState((d) => this.stateAttackAppreach(d)); // [sic] original spelling
    }
  }

  // StateAttackAppreach @0x4C9970 [sic]
  private stateAttackAppreach(dt: number): void {
    if (this.m_targetHandles === null) throw new Error('NullReferenceException (faithful): insect without targets');
    const targetObj = this.m_targetHandles[0].getMostRecentObjectVersion<GameCoreObject>();
    const target = asDamageable(targetObj);
    if (target === null) {
      // Target gone: wait attackWaitDuration again, back to hovering.
      const view = this.getUnityObjectAs<InsectViewContract>();
      if (view !== null) this.m_attackStandbyDuration = f(view.attackWaitDuration ?? 0);
      this.setState((d) => this.stateHover(d));
    } else {
      const dist = Vector3.Distance(target.position, this.position);
      const step = f(dt * this.m_attackAppreachSpeed);
      if (step <= dist) {
        this.position = this.position.add(target.position.sub(this.position).normalized.mulScalar(step));
      } else {
        this.onHit(target);
        this.destroySelf();
      }
    }
  }
}
