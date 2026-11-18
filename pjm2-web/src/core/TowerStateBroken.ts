// src/core/TowerStateBroken.ts
// TypeScript port of decomp/src/GameCore/TowerStateBroken.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3074).
// Broken (gem) tower: pops its gems once after gemDropDelay; Exit RE-ENTERS
// a fresh Broken state (faithful reentry quirk — the tower stays broken).

import { Mathf } from '../engine/math';
import { Events } from './Events';
import { TowerState } from './TowerState';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

export class TowerStateBroken extends TowerState {
  private m_gemDropDelay: number; // 0x20 — counts down; -1 once popped
  private m_destroyDropGem: number; // 0x24

  private static readonly reentryDuration = f(10000.0);
  private static readonly gemAlreadyDropped = f(-1.0); // 0xbf800000

  constructor(aDuration: number, gemDropDelay: number, gemToDrop: number) {
    super(aDuration);
    this.m_gemDropDelay = f(gemDropDelay);
    this.m_destroyDropGem = gemToDrop | 0;
  }

  override exit(owner: TowerStateMachine): void {
    // FAITHFUL QUIRK: exiting Broken immediately queues another Broken.
    owner.setCurrentCommand(
      new TowerStateBroken(TowerStateBroken.reentryDuration, this.m_gemDropDelay, this.m_destroyDropGem),
      null,
    );
  }

  override tick(owner: TowerStateMachine, dt: number): boolean {
    if (this.m_gemDropDelay > 0.0) {
      this.m_gemDropDelay = Mathf.Max(f(this.m_gemDropDelay - dt), f(0));
      if (this.m_gemDropDelay === 0.0) {
        Events.onGemTowerPopGem.invoke(this.getTower(owner), this.m_destroyDropGem); // +0x178
        this.m_gemDropDelay = TowerStateBroken.gemAlreadyDropped; // never pop twice
      }
    }
    return true;
  }
}
