// src/core/TowerState.ts
// TypeScript port of decomp/src/GameCore/TowerState.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3072).
// Base tower state: Enter announces towerChangeStateEvent; Tick default true.

import { Events } from './Events';
import { State } from './StateMachine';
import type { GameCoreTower } from './GameCoreTower';
import type { TowerStateMachine } from './TowerStateMachine';

export class TowerState extends State<TowerStateMachine> {
  constructor(aDuration: number) {
    super(aDuration);
  }

  protected getTower(owner: TowerStateMachine | null): GameCoreTower | null {
    if (owner === null) return null;
    return owner.getTower();
  }

  override tick(_owner: TowerStateMachine, _dt: number): boolean {
    return true;
  }

  override enter(owner: TowerStateMachine): void {
    Events.towerChangeStateEvent.invoke(this.getTower(owner), this); // Events statics +0xD0
    super.enter(owner);
  }

  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
  }
}
