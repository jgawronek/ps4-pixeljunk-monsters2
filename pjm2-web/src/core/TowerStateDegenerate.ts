// src/core/TowerStateDegenerate.ts
// TypeScript port of decomp/src/GameCore/TowerStateDegenerate.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3077).
// Inert placeholder state (confirmed no-op Tick).

import { TowerState } from './TowerState';
import type { TowerStateMachine } from './TowerStateMachine';

export class TowerStateDegenerate extends TowerState {
  constructor(aDuration: number) {
    super(aDuration);
  }

  override tick(_owner: TowerStateMachine, _dt: number): boolean {
    return true;
  }
  override enter(owner: TowerStateMachine): void {
    super.enter(owner);
  }
  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
  }
}
