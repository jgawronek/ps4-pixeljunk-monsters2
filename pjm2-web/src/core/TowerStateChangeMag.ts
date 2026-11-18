// src/core/TowerStateChangeMag.ts
// TypeScript port of decomp/src/GameCore/TowerStateChangeMag.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3076).
// Magazine reload: ammo refilled at state START; the view animator supplies
// the actual reload duration; missileTowerChangeMag notifies the view.
//
// TS ADAPTATION: GetUnityObject<TowerAnimatorMissile>().ChangeMagDuration()
// → optional changeMagDuration() on the tower viewer contract.

import { Events } from './Events';
import type { TowerBaseContract } from '../view/q4-contracts';
import { TowerState } from './TowerState';
import { TowerStateIdle } from './TowerStateIdle';
import type { TowerStateMachine } from './TowerStateMachine';

const f = Math.fround;

export class TowerStateChangeMag extends TowerState {
  private m_changingMagDuration = f(0); // 0x20 — from the view animator on Enter
  private m_currentMag: number; // 0x24
  private m_newMag: number; // 0x28

  constructor(aDuration: number, currentMag: number, newMag: number) {
    super(aDuration);
    this.m_currentMag = currentMag | 0;
    this.m_newMag = newMag | 0;
  }

  override tick(owner: TowerStateMachine, dt: number): boolean {
    this.m_changingMagDuration = f(this.m_changingMagDuration - dt);
    if (this.m_changingMagDuration <= 0.0) {
      owner.setCurrentCommand(new TowerStateIdle(false), null);
    }
    return true;
  }

  override enter(owner: TowerStateMachine): void {
    super.enter(owner); // towerChangeStateEvent
    const tower = this.getTower(owner);
    let duration = f(0);
    if (tower !== null) {
      tower.magazineCapacity = this.m_newMag; // refilled at state start (@0x9C)
      const animator = tower.getUnityObjectAs<TowerBaseContract>();
      if (animator !== null && animator.changeMagDuration !== undefined) {
        duration = f(animator.changeMagDuration());
      }
    }
    this.m_changingMagDuration = duration;
    // FAITHFUL: tower.handle dereferenced without a null check.
    Events.missileTowerChangeMag.invoke(tower!.handle, this.m_currentMag, this.m_newMag); // +0x1B8
  }

  override exit(owner: TowerStateMachine): void {
    super.exit(owner);
  }
}
