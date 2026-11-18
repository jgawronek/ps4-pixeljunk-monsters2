// src/core/GameCoreEnemyAttackPoint.ts
// TypeScript port of decomp/src/GameCore/GameCoreEnemyAttackPoint.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x4AE3E0..0x4B5580).
// A discrete damageable point on an enemy (e.g. a boss's weak spot / balloon
// anchor). Damage dealt to a point is forwarded to the host enemy, tagged with
// this point so the enemy can accumulate "vulnerable" damage. Points follow
// the host's orientation.
//
// TS ADAPTATIONS: IDamageable Collision()/Position()/Handle() slots map to the
// inherited properties (see interfaces.ts); DealDamage overloads →
// dealDamage/dealDamageTyped; Q4.AttackPointSetting → AttackPointSettingContract;
// GameCoreBridge.SetUnityObject → registerUnityObject registry.

import { Quaternion, Vector3 } from '../engine/math';
import {
  registerUnityObject,
  type AttackPointSettingContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { EEnemyMoveTypeDef } from './enums';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from './enums';
import type { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import type { GameCoreTower } from './GameCoreTower';
import type { IDamageable } from './interfaces';

const f = Math.fround;

export class GameCoreEnemyAttackPoint extends GameCoreObject implements IDamageable {
  private m_host: GameCoreHandle; // 0x60
  private m_afterAirPoints = false; // 0x8C
  private m_enemyMoveType: EEnemyMoveTypeDef; // 0x90
  private m_isEnabled = true; // 0x94
  private m_localPosition: Vector3 = Vector3.zero; // 0x80 (auto-property backing)

  // <localPosition>k__BackingField @0x80 (public get / protected set)
  get localPosition(): Vector3 {
    return this.m_localPosition;
  }

  // .ctor @0x4AE3E0
  constructor(
    hostEnemy: GameCoreEnemy | null,
    radius: number,
    pointView: unknown | null,
    localPos: Vector3,
    setting: AttackPointSettingContract | null,
  ) {
    super();
    this.m_enemyMoveType = EEnemyMoveTypeDef.ground;
    this.m_isEnabled = true;

    this.m_host = hostEnemy !== null ? hostEnemy.handle : GameCoreHandle.nullHandle;
    this.collision = new Cylinder(radius, f(radius + radius));
    this.m_localPosition = localPos;

    // Move type: explicit override if set, otherwise inherit the host's.
    if (setting !== null && setting.moveTypeOverride !== EEnemyMoveTypeDef.unknown) {
      this.m_enemyMoveType = setting.moveTypeOverride;
    } else {
      // FAITHFUL: C# dereferences hostEnemy here (NRE when null without override).
      this.m_enemyMoveType = hostEnemy!.enemyMoveType;
    }

    this.m_afterAirPoints = setting !== null && setting.afterAirPoints;

    if (pointView !== null) {
      registerUnityObject(this.handle.m_handle, pointView); // bridge SetUnityObject
    }
  }

  // GetHostEnemy @0x4B4DE0
  getHostEnemy(): GameCoreEnemy | null {
    return this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
  }

  // PredictPositionAndDirection @0x4B4E30 (IDamageable slot 6)
  predictPositionAndDirection(aTime: number): { pos: Vector3; direction: Vector3 } {
    const host = this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
    if (host === null) {
      return { pos: this.m_localPosition, direction: Vector3.forward };
    }
    // NOTE: original reads the host's m_sideOffset (0x164) directly.
    // FAITHFUL: host.PathMove dereferenced without a null check.
    const sample = host.pathMove!.sampleWithVel(
      f(f(aTime * host.speedCur) + host.pathDistance),
      host.sideOffset,
    );
    let pos: Vector3;
    let vel: Vector3;
    if (!sample.ok) {
      pos = host.position;
      vel = host.moveVec;
    } else {
      pos = sample.pos;
      vel = sample.vel;
    }
    return {
      pos: pos.add(Quaternion.LookRotation(vel).multiplyVector(this.m_localPosition)),
      direction: vel,
    };
  }

  // Host @0x4B5000 (IDamageable slot 10)
  host(): GameCoreEnemy | null {
    return this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
  }

  // SetAttackPointEnabled @0x4AF530
  setAttackPointEnabled(enable: boolean): void {
    this.m_isEnabled = enable;
  }

  // Valid @0x4B5050 (IDamageable slot 11)
  valid(): boolean {
    return this.m_isEnabled && !this.m_host.isNull;
  }

  // Tick @0x4B50E0 — no-op; points are positioned by the host's TickAttackPoints.
  override tick(): void {}

  // DealDamage @0x4B50F0 (IDamageable slot 2, untyped) — forward to host,
  // tagging THIS point (the incoming attackPoint arg is replaced).
  dealDamage(
    damageSource: GameCoreObject | null,
    damageToDeal: number,
    distanceToCenterRate: number,
    _attackPoint: GameCoreObject | null,
    immediateDestroy = true,
  ): void {
    const host = this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
    if (host === null) return;
    host.dealDamage(damageSource, damageToDeal, distanceToCenterRate, this, immediateDestroy);
  }

  // DealDamage @0x4B5180 (IDamageable slot 3, typed) — forward to host, tagging this.
  dealDamageTyped(
    strengthType: EEnemyStrengthTypeDef,
    classType: EEnemyClassTypeDef,
    damageToDeal: number,
    distanceToCenterRate: number,
    damageSource: GameCoreObject | null,
    _attackPoint: GameCoreObject | null,
    immediateDestroy = true,
  ): void {
    const host = this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
    if (host !== null) {
      host.dealDamageTyped(
        strengthType,
        classType,
        damageToDeal,
        distanceToCenterRate,
        damageSource,
        this,
        immediateDestroy,
      );
    }
  }

  // IsAimableTarget @0x4B5220 (IDamageable slot 0)
  isAimableTarget(tower: GameCoreObject): boolean {
    if (!this.m_isEnabled) return false;
    let aimable = !this.m_host.isNull;
    if (tower !== null && !this.m_host.isNull) {
      const host = this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
      if (host !== null && host.isBalloon) {
        aimable = (tower as GameCoreTower).balloonAimable;
      }

      // A ground point that sits "after air points" is shielded while any air
      // point on the host is still enabled.
      if (aimable && this.m_afterAirPoints && this.m_enemyMoveType === EEnemyMoveTypeDef.ground) {
        // FAITHFUL: host dereferenced without a null check in this branch.
        for (const apHandle of host!.attackPoints!) {
          const ap = apHandle.getMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
          if (
            ap !== null &&
            ap.m_enemyMoveType === EEnemyMoveTypeDef.air &&
            ap.m_isEnabled &&
            !ap.m_host.isNull
          ) {
            aimable = false;
            break;
          }
        }
      }
    }
    return aimable;
  }

  // ValidateTarget @0x4B54C0 (IDamageable slot 1)
  validateTarget(): boolean {
    const host = this.m_host.getMostRecentObjectVersion<GameCoreEnemy>();
    if (host === null || host.pathMove === null) return false;
    return host.pathMove.curveLengthBeforeActivation < host.pathDistance;
  }

  // IDamageable slots 4/5/7 (Collision/Position/Handle) → inherited properties.

  // UnityObject @0x4B5570 (IDamageable slot 8)
  unityObject(): unknown | null {
    return this.getUnityObject();
  }

  // MoveType @0x4B21A0 (IDamageable slot 9)
  moveType(): EEnemyMoveTypeDef {
    return this.m_enemyMoveType;
  }

  // RecreateViewer @0x4B5580 — returns the cached view (points are not re-instantiated).
  override recreateViewer(): unknown | null {
    return this.getUnityObject();
  }
}
