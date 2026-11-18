// src/core/TowerStateAttack.ts
// TypeScript port of decomp/src/GameCore/TowerStateAttack.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3073,
// RVA 0x4DF6A0, 0x4E0F10..0x4E1D00). Firing state: burst timer, reflection-
// created sim projectiles, magazine consumption at burst end, mid-burst
// tracking, return to Idle. m_forceAttack fires once with an empty target list.
//
// Constants CONFIRMED: state durations 10000.0 (DAT_00b7c4a0/b0).
// TS ADAPTATION: Activator.CreateInstance(GetGameCoreType(), [tower, targets,
// true]) → new (view.getGameCoreType())(tower, targets, true).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import type { TowerBaseContract } from '../view/q4-contracts';
import { Events } from './Events';
import type { GameCoreTower } from './GameCoreTower';
import type { IDamageable } from './interfaces';
import { TowerHelper } from './TowerHelper';
import { TowerState } from './TowerState';
import { TowerStateIdle } from './TowerStateIdle';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

export class TowerStateAttack extends TowerState {
  private m_burstTimer: number; // 0x20 — starts CHARGED (first shot immediate)
  private m_burstCount: number; // 0x24
  private m_desiredDirection: Vector3 = Vector3.zero; // 0x28
  private m_forceAttack: boolean; // 0x34

  private static readonly attackStateDuration = f(10000.0); // DAT_00b7c4a0

  // .ctor @0x4DF6A0
  constructor(burstInterval: number, burstCount: number, forceAttack = false) {
    super(TowerStateAttack.attackStateDuration);
    this.m_burstTimer = f(burstInterval);
    this.m_burstCount = burstCount | 0;
    this.m_forceAttack = forceAttack;
  }

  // Tick @0x4E0F10
  override tick(owner: TowerStateMachine | null, dt: number): boolean {
    if (owner === null) return true;
    const tower = this.getTower(owner);
    if (tower === null) return true;

    if (tower.isPostStageClear) {
      // Stage won: stand down. FAITHFUL: no return — the rest still runs once.
      owner.setCurrentCommand(new TowerStateIdle(false), null);
    }

    if (!this.m_forceAttack) {
      this.m_burstTimer = Mathf.Min(f(this.m_burstTimer + dt), tower.burstInterval);

      // Ammo gate: -1 unlimited, >0 rounds left.
      if (tower.magazineCapacity === -1 || tower.magazineCapacity > 0) {
        if (this.m_burstTimer === tower.burstInterval) {
          const targets: IDamageable[] = [];
          // INFERRED overload (reconstruction): 3 visible args bind to the
          // 3-arg overload (ignoreInnerRange = true) in C#.
          TowerHelper.getNearestTargets(tower, targets, true);
          if (targets.length < 1) {
            // Nothing to shoot: shooting idle, carrying burst progress.
            owner.setCurrentCommand(new TowerStateIdle(true, this.m_burstCount), null);
          } else {
            this.onAttack(tower, targets);
          }
        }
      }

      if (this.m_burstCount < tower.burstCount) {
        this.updateRotation(tower, dt); // keep tracking mid-burst
        return true;
      }
    } else {
      // Forced attack: fire once with an empty target list.
      this.onAttack(tower, []);
    }

    // Burst complete (or forced shot done): non-shooting idle.
    owner.setCurrentCommand(new TowerStateIdle(false), null);
    return true;
  }

  // OnAttack @0x4E1380
  private onAttack(tower: GameCoreTower | null, targets: IDamageable[]): void {
    if (tower === null) return;

    this.m_burstCount = Mathf.Min(this.m_burstCount + 1, tower.burstCount) | 0;

    // Ammo spent when the burst finishes; never for unlimited (-1) magazines.
    if (tower.burstCount <= this.m_burstCount && tower.magazineCapacity > 0) {
      tower.magazineCapacity = Mathf.Max(tower.magazineCapacity - 1, 0) | 0;
    }

    this.m_burstTimer = f(0);

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) return;
    const projectileView = viewer.projectile; // TowerBase @0xC0
    if (projectileView === null) return;

    const CoreType = projectileView.getGameCoreType(); // virtual slot 4
    new CoreType(tower, targets, true); // Activator.CreateInstance adaptation

    Events.projectileLaunchEvent.invoke(tower); // Events statics +0x88
  }

  // UpdateRotation @0x4E16C0
  private updateRotation(tower: GameCoreTower, dt: number): void {
    this.m_desiredDirection = this.desiredDirection(tower);

    const desiredEuler = Quaternion.LookRotation(this.m_desiredDirection, Vector3.up).eulerAngles;
    const currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;

    const newX = Mathf.MoveTowardsAngle(currentEuler.x, desiredEuler.x, f(tower.currentRotateSpeedX * dt));
    const newY = Mathf.MoveTowardsAngle(currentEuler.y, desiredEuler.y, f(dt * tower.currentRotateSpeedY));

    tower.fortDirection = Quaternion.Euler(newX, newY, currentEuler.z).multiplyVector(Vector3.forward);
  }

  // DesiredDirection @0x4E18B0
  private desiredDirection(tower: GameCoreTower | null): Vector3 {
    let dir = Vector3.zero;
    if (tower === null) return dir;

    dir = tower.fortDirection;
    const target = tower.getCurrentTarget();
    const viewer = tower.getUnityObjectAs<TowerBaseContract>();

    if (target !== null && viewer !== null) {
      const muzzle = tower.position.add(Vector3.up.mulScalar(tower.height));
      const targetPos = target.position;
      const projectileView = viewer.projectile;
      if (projectileView !== null) {
        const fd = projectileView.getFireDirection(
          { x: muzzle.x, y: muzzle.y, z: muzzle.z },
          { x: targetPos.x, y: targetPos.y, z: targetPos.z },
          { x: 0, y: 0, z: 0 },
        );
        dir = new Vector3(fd.x, fd.y, fd.z);
      }
    }
    return dir.normalized;
  }

  // UpdateTarget @0x4E1B30 — retained private (no caller in this state's Tick).
  private updateTarget(tower: GameCoreTower | null, _dt: number): void {
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
}
