// src/core/TowerStateBuild.ts
// TypeScript port of decomp/src/GameCore/TowerStateBuild.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3075).
// The tower rises from below ground over `duration`; Exit snaps exactly.

import { Vector3 } from '../engine/math';
import type { GameCoreTower } from './GameCoreTower';
import { TowerState } from './TowerState';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

export class TowerStateBuild extends TowerState {
  private m_towerPosition: Vector3 = Vector3.zero; // 0x20 — final position
  private m_buildSpeed = f(0); // 0x2C — height / duration, set on Enter

  constructor(aDuration: number) {
    super(aDuration);
    this.m_towerPosition = Vector3.zero;
  }

  get towerFinalPosition(): Vector3 {
    return this.m_towerPosition;
  }

  static getBuildStartPosition(tower: GameCoreTower): Vector3 {
    return tower.position.add(Vector3.down.mulScalar(tower.height));
  }

  override enter(owner: TowerStateMachine): void {
    super.enter(owner); // TowerState.Enter → towerChangeStateEvent
    const tower = this.getTower(owner);
    if (tower !== null) {
      this.m_towerPosition = tower.position;
      tower.position = tower.position.add(Vector3.down.mulScalar(tower.height));
      this.m_buildSpeed = f(tower.height / this.duration);
    }
  }

  override tick(owner: TowerStateMachine, dt: number): boolean {
    const tower = this.getTower(owner);
    if (tower !== null) {
      tower.position = Vector3.MoveTowards(tower.position, this.m_towerPosition, f(dt * this.m_buildSpeed));
    }
    return true;
  }

  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
    const tower = this.getTower(owner);
    if (tower !== null) tower.position = this.m_towerPosition; // exact snap
  }
}
