// src/core/TowerStateIdle.ts
// TypeScript port of decomp/src/GameCore/TowerStateIdle.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3078,
// RVA 0x4E1310..0x4E3850). Default tower state: AIMING (target tracking or
// the caution scan cycle) + FIRING gate (UpdateAttackCooldown → Attack).
//
// Constants CONFIRMED: idle/attack duration 10000.0 (DAT_00b7c4b8/bc/d0),
// direction epsilon 0.01 (DAT_00b7c4cc).
//
// TS ADAPTATIONS: C# Vector3 == zero (approximate equality) → sqrMagnitude
// threshold; `as ProjectileInsect/Gem` → structural markers on the view
// contract; the two ctors collapse into (shootOnSight, burstCount = 0).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import type { TowerBaseContract } from '../view/q4-contracts';
import { GameCore } from './GameCore';
import { GameCoreProjectileInsect } from './GameCoreProjectileInsect';
import type { GameCoreTower } from './GameCoreTower';
import type { IDamageable } from './interfaces';
import { TowerHelper } from './TowerHelper';
import { TowerState } from './TowerState';
import { TowerStateAttack } from './TowerStateAttack';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

/** C#: TowerStateIdle.CautionMode (private nested, TypeDefIndex 3079). */
enum CautionMode {
  EReset = 0,
  ERotating = 1,
  EWatching = 2,
  EUnknown = 3,
}

export class TowerStateIdle extends TowerState {
  private m_shootOnSight: boolean; // 0x20
  private m_desiredDirection: Vector3 = Vector3.zero; // 0x24
  private m_currentBurst: number; // 0x30
  private m_currentMode: CautionMode = CautionMode.EReset; // 0x34
  private m_cautionDireciton: Vector3 = Vector3.zero; // 0x38 [sic — original spelling]
  private m_fortDirectionBeforeCaution: Vector3 = Vector3.zero; // 0x44
  private m_cautionWatchTimer = f(0); // 0x50

  private static readonly idleStateDuration = f(10000.0); // DAT_00b7c4b8/bc
  private static readonly directionEpsilon = f(0.01); // DAT_00b7c4cc

  // .ctor @0x4E1310 / @0x4E1640 (burst progress carried across Attack→Idle)
  constructor(shootOnSight: boolean, burstCount = 0) {
    super(TowerStateIdle.idleStateDuration);
    this.m_fortDirectionBeforeCaution = Vector3.zero;
    this.m_shootOnSight = shootOnSight;
    this.m_currentBurst = burstCount | 0;
  }

  // get_ShootOnSight @0x4E26B0
  get shootOnSight(): boolean {
    return this.m_shootOnSight;
  }

  // Tick @0x4E26C0
  override tick(owner: TowerStateMachine | null, dt: number): boolean {
    if (owner === null) return true;
    const tower = this.getTower(owner);
    if (tower === null) return true;

    // Latch the pre-caution facing the first time it is unset.
    // C# Vector3 == zero is approximate (sqrMagnitude < 1e-10).
    if (this.m_fortDirectionBeforeCaution.sqrMagnitude < 1e-10) {
      this.m_fortDirectionBeforeCaution = tower.fortDirection;
    }

    // Faithful: even non-shoot-on-sight idles scan/aim once stateTime ≥ attackSpeed.
    if (this.m_shootOnSight || tower.attackSpeed <= this.stateTime) {
      if (tower.getCurrentTarget() === null) this.updateCaution(dt, tower);
      else this.updateRotation(dt, tower);
    }

    this.updateAttackCooldown(tower);
    return true;
  }

  // UpdateRotation @0x4E2850 — track the target's aim solution.
  private updateRotation(dt: number, tower: GameCoreTower): void {
    this.m_desiredDirection = this.desiredDirection(tower);

    if (this.m_desiredDirection.magnitude > TowerStateIdle.directionEpsilon) {
      const desiredEuler = Quaternion.LookRotation(this.m_desiredDirection).eulerAngles;
      const currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;

      const newX = Mathf.MoveTowardsAngle(currentEuler.x, desiredEuler.x, f(tower.currentRotateSpeedX * dt));
      const newY = Mathf.MoveTowardsAngle(currentEuler.y, desiredEuler.y, f(dt * tower.currentRotateSpeedY));

      const newDir = Quaternion.Euler(newX, newY, currentEuler.z).multiplyVector(Vector3.forward);
      tower.fortDirection = newDir;
      this.m_fortDirectionBeforeCaution = newDir;
    }
    this.m_currentMode = CautionMode.EReset;
  }

  // UpdateCaution @0x4E2A50 — EReset → pick → ERotating → align → EWatching → hold.
  private updateCaution(dt: number, tower: GameCoreTower): void {
    switch (this.m_currentMode) {
      case CautionMode.EReset: {
        const viewer = tower.getUnityObjectAs<TowerBaseContract>();
        // FAITHFUL: RandomCautionDirection NREs on a null viewer.
        this.m_cautionDireciton = TowerHelper.randomCautionDirection(
          tower,
          viewer!,
          this.m_fortDirectionBeforeCaution,
        );
        this.m_currentMode = CautionMode.ERotating;
        break;
      }
      case CautionMode.ERotating: {
        const currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;
        const cautionEuler = Quaternion.LookRotation(this.m_cautionDireciton).eulerAngles;

        const newX = Mathf.MoveTowardsAngle(currentEuler.x, cautionEuler.x, f(tower.cautionRotateSpeed * dt));
        const newY = Mathf.MoveTowardsAngle(currentEuler.y, cautionEuler.y, f(dt * tower.cautionRotateSpeed));

        tower.fortDirection = Quaternion.Euler(newX, newY, currentEuler.z).multiplyVector(Vector3.forward);

        if (newX === cautionEuler.x && newY === cautionEuler.y) {
          this.m_currentMode = CautionMode.EWatching;
        }
        break;
      }
      case CautionMode.EWatching: {
        this.m_cautionWatchTimer = Mathf.Min(f(this.m_cautionWatchTimer + dt), tower.cautionIdleTime);
        if (this.m_cautionWatchTimer === tower.cautionIdleTime) {
          this.m_currentMode = CautionMode.EReset;
          this.m_cautionWatchTimer = f(0);
        }
        break;
      }
    }
  }

  // UpdateAttackCooldown @0x4E2DE0 — Idle → Attack decision (hive budget /
  // gem forced shot / normal fire-range gate).
  private updateAttackCooldown(tower: GameCoreTower | null): void {
    if (tower === null) return;
    if (tower.isPostStageClear) return;
    if (tower.handle.getUnityObject() === null) return; // viewer gone

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    const projectileView = viewer !== null ? viewer.projectile : null;

    // Hive (ProjectileInsect): swarm budget gate.
    if (projectileView !== null && projectileView.insectAmountMax !== undefined) {
      if (this.stateTime < tower.attackSpeed) return;
      let liveInsects = 0;
      for (const _insect of GameCore.instance!.allObjects<GameCoreProjectileInsect>(GameCoreProjectileInsect)) {
        liveInsects++;
      }
      if (tower.hiveTowerInsectMaxAmount <= liveInsects) return;
      tower.setTowerState(new TowerStateAttack(tower.burstInterval, this.m_currentBurst, true));
      return;
    }

    // Gem (ProjectileGem): force-fire every time.
    if (projectileView !== null && projectileView.isGemProjectile === true) {
      tower.setTowerState(new TowerStateAttack(tower.burstInterval, this.m_currentBurst, true));
      return;
    }

    if (this.m_shootOnSight || tower.attackSpeed <= this.stateTime) {
      const target = tower.getCurrentTarget();
      if (TowerHelper.isTargetInFireRange(tower, target)) {
        tower.setTowerState(new TowerStateAttack(tower.burstInterval, this.m_currentBurst, false));
      }
    }
  }

  // DesiredDirection @0x4E33D0 — projectile aim solution, normalized.
  private desiredDirection(tower: GameCoreTower | null): Vector3 {
    let dir = Vector3.zero;
    if (tower === null) return dir;

    dir = tower.fortDirection;
    const target = tower.getCurrentTarget();
    if (target !== null) {
      const viewer = tower.getUnityObjectAs<TowerBaseContract>();
      if (viewer !== null) {
        const muzzle = tower.position.add(Vector3.up.mulScalar(tower.height));
        const targetPos = target.position;
        const projectileView = viewer.projectile;
        // FAITHFUL: null projectile falls into the exception path.
        const fd = projectileView!.getFireDirection(
          { x: muzzle.x, y: muzzle.y, z: muzzle.z },
          { x: targetPos.x, y: targetPos.y, z: targetPos.z },
          { x: 0, y: 0, z: 0 },
        );
        dir = new Vector3(fd.x, fd.y, fd.z);
      }
    }
    return dir.normalized;
  }

  // UpdateTarget @0x4E3650 — retained private method (no caller in the
  // binary's Tick; targeting runs via UpdateAttackCooldown + TickTargetQueue).
  private updateTarget(tower: GameCoreTower | null): void {
    if (tower === null) return;

    const target = tower.getCurrentTarget();
    if (target !== null && tower.enemyDetector !== null) {
      const detectorPos = tower.position.add(tower.enemyDetector.getOffset());
      if (!tower.enemyDetector.inDetection(detectorPos, target as unknown as import('./GameCoreObject').GameCoreObject)) {
        tower.setCurrentTarget(null);
      }
    }

    if (tower.getCurrentTarget() === null) {
      const next = TowerHelper.getNextTargetFromTowerTargetQueue(tower, tower.nextTargetToAttackIndex);
      tower.setCurrentTarget(next);
    }
  }

  // Enter @0x4E3370 / Exit @0x4E3380 — base behaviour.
  override enter(owner: TowerStateMachine): void {
    super.enter(owner);
  }
  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
  }
}
