// src/view/characters/TowerAnimatorLogic.ts
// Port of the Q4.TowerAnimator MonoBehaviour (decomp: Q4.TowerAnimator.c).
// It is the ONLY thing that drives a standard tower's Animator parameters:
//
//   Start @00546bf0     hashes "BaseLayer.cool_down/reload/fire"; resolves the
//                       parameters OnReady (0x50), OnFireFinish (0x54),
//                       OnDoorOpenOut (0x58), OnDoorOpenIn (0x5C) — 0 when the
//                       controller lacks them; InitCooldownClipTime: the length
//                       of the controller clip NAMED exactly "reload" (0x6C,
//                       default 1.0 when absent); subscribes OnFire to
//                       Events+0x88 = projectileLaunchEvent.
//   OnFire @00547470    timer(0x70) = fireAnimationDuration(0x18);
//                       if event.tower == this tower && OnReady exists:
//                       animator.SetBool(OnReady, TRUE)        (arms ready_to_fire -> fire)
//   Update @005471b0    every frame: state = tower.GetTowerState(); UpdateFiring.
//   UpdateFiring @00547270 (layer 0):
//       info = GetCurrentAnimatorStateInfo(0)
//       if info.fullPathHash == hash("BaseLayer.fire"):
//           if info.loop (offset 0x20): timer -= dt; if timer < 0 && OnFireFinish exists:
//                                       SetTrigger(OnFireFinish)
//       else if state is TowerStateIdle:
//           if (idle.stateTime < tower.attackSpeed(0x74) - reloadLen) && !idle.ShootOnSight: skip
//           else if OnReady exists: SetBool(OnReady, FALSE)     (start the reload clip so it
//                                                                finishes when the next shot is due)
//   OnReady()/OnFireFinish()/OnDoorOpenOut/In/OnDoorClose @0054744x..: plain
//   SetBool/SetTrigger wrappers (no caller in the decomp; wired by serialized events).
//
// Verified against raw disassembly: AnimatorStateInfo.loop = byte at +0x20
// (8f1f40: cmp [rdi+0x20],0), fullPathHash = FUN_008f1da0.

import { AnimatorRuntime } from './AnimatorRuntime';

export interface TowerIdleInfo {
  /** TowerStateIdle.stateTime (State+0x10). */
  stateTime: number;
  /** TowerStateIdle.ShootOnSight (0x20). */
  shootOnSight: boolean;
}

export interface TowerAnimatorOptions {
  /** TowerAnimator.fireAnimationDuration (0x18). */
  fireAnimationDuration: number;
  /** Length of the controller clip named exactly "reload" (0 = absent → 1.0). */
  reloadClipLength: number;
}

export class TowerAnimatorLogic {
  private readonly paramReady: boolean;
  private readonly paramFireFinish: boolean;
  private readonly reloadLen: number;
  private readonly fireDuration: number;
  /** m_fireDurationTimer (0x70). */
  private fireTimer = 0;

  constructor(
    private readonly animator: AnimatorRuntime,
    opts: TowerAnimatorOptions,
  ) {
    this.paramReady = animator.hasParameter('OnReady');
    this.paramFireFinish = animator.hasParameter('OnFireFinish');
    this.reloadLen = opts.reloadClipLength > 0 ? opts.reloadClipLength : 1.0; // 0x6C default
    this.fireDuration = opts.fireAnimationDuration;
  }

  /** projectileLaunchEvent for THIS tower. */
  onFire(): void {
    this.fireTimer = this.fireDuration;
    if (this.paramReady) this.animator.setBool('OnReady', true);
  }

  /** TowerAnimator.Update: `idle` is null unless the tower's current state is
   *  TowerStateIdle (the original's `is TowerStateIdle` test). */
  update(dt: number, idle: TowerIdleInfo | null, attackSpeed: number): void {
    if (this.animator.currentPath(0) === 'BaseLayer.fire') {
      if (this.animator.currentLoop(0)) {
        this.fireTimer -= dt;
        if (this.fireTimer < 0 && this.paramFireFinish) this.animator.setTrigger('OnFireFinish');
      }
      return;
    }
    if (idle === null) return;
    if (idle.stateTime < attackSpeed - this.reloadLen && !idle.shootOnSight) return;
    if (this.paramReady) this.animator.setBool('OnReady', false);
  }
}
