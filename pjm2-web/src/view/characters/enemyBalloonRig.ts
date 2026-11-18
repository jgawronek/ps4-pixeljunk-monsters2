// src/view/characters/enemyBalloonRig.ts
// Q4.Balloon view (decomp/decompiled/Q4.Balloon.c, Q4.EnemyBase.c InitAnimation @007fa210 / LateUpdate @007fe1a0 /
// PopBalloons @007ffa70): the skinned balloon rig (3 balloons on twines; clips 3balloon / 3to2 / 2balloon / 2to1 /
// 1balloon from `balloon_*_ctrl`, trigger `PopBalloon`) is glued to the enemy's raised hand:
//   balloonRoot.SetPositionAndRotation(handBone.position, enemy.rotation);
//   balloonRoot.position = hand + (hand - knotBone.position)         // knot bone lands on the hand bone
// Q4.Balloon.PopBalloons(n): for each popped balloon (index remaining-1 downwards) the balloon bone and its twine
// root bone are scaled to 0 and `popBalloonEffect` is instantiated at the balloon; when none remain the balloon
// GameObject is destroyed, otherwise Animator.SetTrigger(PopBalloon).

import * as THREE from 'three';
import type { CharacterRig } from './CharacterLibrary';
import type { EnemyController, EnemyViewRecord } from './enemyViewTypes';
import { ControllerPlayer } from './controllerPlayer';
import { EnemyAnimator } from './EnemyAnimatorLogic';

export type BalloonConfig = NonNullable<EnemyViewRecord['balloon']>;

const _hw = new THREE.Vector3();
const _kw = new THREE.Vector3();

export class EnemyBalloonRig {
  readonly animator: EnemyAnimator;
  private readonly player: ControllerPlayer;
  private remaining: number;
  private readonly popped: THREE.Object3D[] = [];
  private destroyed = false;

  constructor(
    readonly rig: CharacterRig,
    private readonly cfg: BalloonConfig,
    controller: EnemyController,
    /** Q4.Balloon.popBalloonEffect at the balloon bone. */
    private readonly onPopEffect: (bone: THREE.Object3D) => void,
  ) {
    this.remaining = cfg.balloons.length;
    this.animator = new EnemyAnimator(controller, {
      clipLength: (n) => this.player.clipByName(n)?.duration ?? 0,
    });
    this.player = new ControllerPlayer(rig.root, rig.clips, this.animator, {}, () => {});
    this.player.apply();
  }

  get balloonsRemaining(): number { return this.remaining; }
  get isDestroyed(): boolean { return this.destroyed; }

  /** Q4.Balloon.PopBalloons(count) with `before` balloons currently flying. */
  pop(before: number, count: number): void {
    if (this.destroyed) return;
    for (let k = 0; k < count && this.remaining > 0; k++) {
      const idx = this.remaining - 1;
      this.remaining--;
      const b = this.cfg.balloons[idx];
      const bone = this.rig.root.getObjectByName(b.bone);
      const twine = this.rig.root.getObjectByName(b.string);
      if (bone) { this.onPopEffect(bone); this.popped.push(bone); }
      if (twine) this.popped.push(twine);
    }
    void before;
    if (this.remaining <= 0) {
      this.destroyed = true;
      this.rig.root.removeFromParent();
      this.player.dispose();
    } else {
      this.animator.setTrigger('PopBalloon');
    }
  }

  /** Per frame: advance the balloon Animator, then glue to the hand (EnemyBase.LateUpdate). */
  update(dt: number, enemyRoot: THREE.Object3D, hand: THREE.Object3D): void {
    if (this.destroyed) return;
    this.animator.update(dt);
    this.player.apply();
    for (const o of this.popped) o.scale.set(0, 0, 0); // after the Animator: the clips would restore the scale
    if (this.rig.root.parent !== enemyRoot) enemyRoot.add(this.rig.root);
    // SetPositionAndRotation(hand.position, enemy.rotation) -> local: rotation identity under the enemy root
    enemyRoot.updateWorldMatrix(true, true);
    hand.getWorldPosition(_hw);
    const handLocal = enemyRoot.worldToLocal(_hw.clone());
    this.rig.root.quaternion.identity();
    this.rig.root.position.copy(handLocal);
    this.rig.root.updateWorldMatrix(false, true);
    const knot = this.rig.root.getObjectByName(this.cfg.attachBone);
    if (knot) {
      knot.getWorldPosition(_kw);
      const knotLocal = enemyRoot.worldToLocal(_kw.clone());
      this.rig.root.position.add(handLocal.sub(knotLocal)); // position = hand + (hand - knot)
    }
  }
}
