// src/core/TowerStateUpgradeAround.ts
// TypeScript port of decomp/src/GameCore/TowerStateUpgradeAround.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3080).
// Gem-tower upgrade aura: grants EXP to towers in the affect volume on each
// upgradeInterval tick, sinks (gemTowerSinkEvent progress), pops gems after
// gemDropDelay, and transitions to Broken when the upgrade duration elapses.
//
// Constants CONFIRMED: BrokenStateDuration 10000.0 (DAT_00b7c4dc),
// GemAlreadyDropped −1.0 (DAT_00b7c4d8).

import { Vector3 } from '../engine/math';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreTower } from './GameCoreTower';
import type { IEnemyDetector } from './interfaces';
import { TowerState } from './TowerState';
import { TowerStateBroken } from './TowerStateBroken';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

export class TowerStateUpgradeAround extends TowerState {
  private m_expBoostPerSecond: number; // 0x20
  private m_destroyDropGem: number; // 0x24
  private m_upgradeDurationMax: number; // 0x28
  private m_upgradeDuration: number; // 0x2C
  private m_upgradeInterval: number; // 0x30
  private m_upgradeTick = f(0); // 0x34
  private m_sinkTimePerFrag: number; // 0x38
  private m_gemCreationDelayTime: number; // 0x3C
  private m_enemyDetector: IEnemyDetector | null = null; // 0x40
  private m_isGemDropped = false; // 0x48

  private static readonly brokenStateDuration = f(10000.0); // DAT_00b7c4dc
  private static readonly gemAlreadyDropped = f(-1.0); // DAT_00b7c4d8

  constructor(
    aDuration: number,
    expBoostPerSecond: number,
    destroyDropGem: number,
    upgradeInterval: number,
    sinkTimePerFrag: number,
    upgradeDuration: number,
    gemDropDelay: number,
  ) {
    super(aDuration);
    this.m_expBoostPerSecond = f(expBoostPerSecond);
    this.m_destroyDropGem = destroyDropGem | 0;
    this.m_upgradeDuration = f(upgradeDuration);
    this.m_upgradeDurationMax = f(upgradeDuration);
    this.m_upgradeInterval = f(upgradeInterval);
    this.m_sinkTimePerFrag = f(sinkTimePerFrag);
    this.m_gemCreationDelayTime = f(gemDropDelay);
  }

  override enter(owner: TowerStateMachine): void {
    super.enter(owner); // towerChangeStateEvent
    const tower = this.getTower(owner);
    // FAITHFUL: tower dereferenced without a null check.
    this.m_enemyDetector = tower!.enemyDetector; // tower field @0x108
  }

  override tick(owner: TowerStateMachine, dt: number): boolean {
    const tower = this.getTower(owner);
    this.tickUpgradeDuration(dt, tower);
    return true;
  }

  private tickUpgradeDuration(dt: number, tower: GameCoreTower | null): void {
    this.m_upgradeDuration = f(this.m_upgradeDuration - dt);
    this.m_gemCreationDelayTime = f(this.m_gemCreationDelayTime - dt);
    this.m_upgradeTick = f(this.m_upgradeTick - dt);

    if (this.m_gemCreationDelayTime <= 0.0 && !this.m_isGemDropped) {
      Events.onGemTowerPopGem.invoke(tower, this.m_destroyDropGem); // +0x178
      this.m_isGemDropped = true;
    }

    if (this.m_upgradeTick <= 0.0 && this.m_upgradeDuration >= 0.0) {
      // FAITHFUL (raw @0x4E3CC1 goto loop): CATCH-UP while loop — multiple
      // grants per tick when behind (the C# reconstruction had a single if).
      while (this.m_upgradeTick <= 0.0 && this.m_upgradeDuration >= 0.0) {
        this.tickTowersInRangeForEXP(f(this.m_upgradeInterval * this.m_expBoostPerSecond), tower);
        // 4th payload = m_sinkTimePerFrag (raw arg order scrambled by Ghidra;
        // field 0x38 is consumed HERE — verified against the raw Invoke).
        Events.gemTowerSinkEvent.invoke(
          // +0x1B0
          tower!.handle,
          f(1.0 - f(this.m_upgradeDuration / this.m_upgradeDurationMax)),
          f(1.0 - f(f(this.m_upgradeDuration - this.m_upgradeInterval) / this.m_upgradeDurationMax)),
          this.m_sinkTimePerFrag,
        );
        this.m_upgradeTick = f(this.m_upgradeTick + this.m_upgradeInterval);
      }
    }

    if (this.m_upgradeDuration <= 0.0) {
      const gemDelay = this.m_isGemDropped
        ? TowerStateUpgradeAround.gemAlreadyDropped
        : this.m_gemCreationDelayTime;
      Events.onGemTowerDestroy.invoke(tower); // +0x180
      tower!.setTowerState(
        new TowerStateBroken(TowerStateUpgradeAround.brokenStateDuration, gemDelay, this.m_destroyDropGem),
      );
    }
  }

  private tickTowersInRangeForEXP(expAmount: number, coreTower: GameCoreTower | null): void {
    const detector = this.m_enemyDetector!;
    const affectVolume = detector.getAffectCylinder(); // slot 7
    const detectorPos = coreTower!.position.add(detector.getOffset()); // slot 0
    for (const other of GameCore.instance!.allObjectsIn<GameCoreTower>(
      GameCoreTower,
      coreTower!.position,
      affectVolume,
    )) {
      if (detector.inAttack(detectorPos, other)) {
        other.grantEXP(expAmount, null);
      }
    }
  }

  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
  }
}
