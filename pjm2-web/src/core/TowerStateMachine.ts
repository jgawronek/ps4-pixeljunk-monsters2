// src/core/TowerStateMachine.ts
// TypeScript port of decomp/src/GameCore/TowerStateMachine.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3081).
// The machine IS its own owner (StateMachine<Self> pattern); default state =
// TowerStateIdle(true) — shoot-on-sight, effectively unbounded duration.

import { GameCoreHandle } from './GameCoreHandle';
import type { GameCoreTower } from './GameCoreTower';
import { StateMachine, type State } from './StateMachine';
import { TowerStateIdle } from './TowerStateIdle';

export class TowerStateMachine extends StateMachine<TowerStateMachine> {
  private m_towerHandle: GameCoreHandle; // 0x38

  constructor(towerHandle: GameCoreHandle) {
    super(new TowerStateIdle(true));
    this.m_towerHandle = towerHandle;
  }

  getTower(): GameCoreTower | null {
    return this.m_towerHandle.getMostRecentObjectVersion<GameCoreTower>();
  }

  initialize(): void {}
  terminate(): void {}
  override statePostExit(_state: State<TowerStateMachine>): void {}
  override statePreEnter(_state: State<TowerStateMachine>): void {}
}
