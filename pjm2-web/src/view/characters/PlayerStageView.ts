// src/view/characters/PlayerStageView.ts
// Tikiman player view: the real tikiman_01 rig (extracted from the
// globalsettings bundle — Player logic prefab → tikiman_01_pa visual, 65
// baked clips) with idle/run locomotion plus the PJM2 build-dance
// (dance_buildTower_enter/loop/exit, wired to Events.towerBuildEvent in
// game.ts). Follows the EnemyStageView conventions: three-native GLB space,
// unity↔three mirror at the boundary (x negated), +Z-forward facing via
// lookAt.
//
// DEMO SCOPE: idle_stand / run / build-dance (other baked clips — attack,
// damage, podium, menu… — are reachable via setOneShot for future wiring).

import * as THREE from 'three';
import type { CharacterRig } from './CharacterLibrary';
import { PlayerAvatarDecorator } from './PlayerAvatarDecorator';

const IDLE_CLIP = 'tikiman_idle_stand';
const RUN_CLIP = 'tikiman_run';
const DANCE_ENTER = 'dance_buildTower_enter';
const DANCE_LOOP = 'dance_buildTower_loop';
const DANCE_EXIT = 'dance_buildTower_exit';
const CROSSFADE_S = 0.15;

/** Build-dance sequencer phases. */
type DancePhase = 'enter' | 'loop' | 'exit';

export class PlayerStageView {
  readonly root: THREE.Group;
  private readonly rig: CharacterRig;
  private readonly mixer: THREE.AnimationMixer;
  private currentAction: THREE.AnimationAction | null = null;
  private moving = false;
  private dance: { remaining: number; phase: DancePhase } | null = null;

  /** Mask + shell (carapace) cosmetics (Q4.PlayerAvatarDecorator). */
  readonly decorator: PlayerAvatarDecorator;

  /** @param parts optional default-loadout cosmetic rigs (mask_00, carapace_00).
   *  The tikiman body mesh has neither the face mask nor the back shell. */
  constructor(rig: CharacterRig, parts: { mask?: CharacterRig; carapace?: CharacterRig } = {}) {
    this.rig = rig;
    this.root = rig.root;
    this.decorator = new PlayerAvatarDecorator(this.root);
    if (parts.mask) this.decorator.set('mask', parts.mask);
    if (parts.carapace) this.decorator.set('carapace', parts.carapace);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    this.play(IDLE_CLIP);
  }

  /** Unity-space position (mirror applied internally). */
  setPosition(p: { x: number; y: number; z: number }): void {
    this.root.position.set(-p.x, p.y, p.z);
  }

  /** Unity-space horizontal move/facing direction (+Z forward in three). */
  face(d: { x: number; z: number }): void {
    if (d.x === 0 && d.z === 0) return;
    const target = new THREE.Vector3(
      this.root.position.x - d.x,
      this.root.position.y,
      this.root.position.z + d.z,
    );
    this.root.lookAt(target);
  }

  setMoving(moving: boolean): void {
    if (moving === this.moving) return;
    this.moving = moving;
    if (moving && this.dance !== null) {
      // Walking away cancels the dance (matches the original: the tikiman
      // must stand next to the tower to keep dancing).
      this.dance = null;
    }
    if (this.dance !== null) return; // dance owns the mixer until it ends
    this.play(moving ? RUN_CLIP : IDLE_CLIP);
  }

  /** PJM2 build-dance: the tikiman dances next to a tower while it builds.
   *  enter → loop (held for `durationS` total) → exit, then control returns
   *  to idle/run. No-op when the rig lacks the build-dance clips or a dance
   *  is already running. */
  startBuildDance(durationS: number): void {
    if (this.dance !== null) return;
    const enter = this.rig.clips.find((c) => c.name === DANCE_ENTER);
    const loop = this.rig.clips.find((c) => c.name === DANCE_LOOP);
    if (!enter || !loop) return;
    this.dance = { remaining: durationS, phase: 'enter' };
    this.playOnce(DANCE_ENTER);
    const onEnterDone = (e: { action: THREE.AnimationAction }) => {
      if (this.dance === null || this.dance.phase !== 'enter') return;
      if (e.action !== this.currentAction) return;
      this.mixer.removeEventListener('finished', onEnterDone);
      this.dance.phase = 'loop';
      this.play(DANCE_LOOP);
    };
    this.mixer.addEventListener('finished', onEnterDone);
  }

  /** Tower-EXP dance (Q4.Player m_DanceState == 2, TowerDanceExp): keep the
   *  dance alive while charging; call every frame while dancing. When calls
   *  stop the loop expires after `holdS` and the exit clip plays. */
  keepDancing(holdS = 0.3): void {
    if (this.dance === null) {
      this.startBuildDance(holdS);
    } else if (this.dance.phase === 'loop') {
      this.dance.remaining = Math.max(this.dance.remaining, holdS);
    } else if (this.dance.phase === 'enter') {
      this.dance.remaining = Math.max(this.dance.remaining, holdS);
    }
  }

  /** True while the build dance owns the mixer (locomotion anims suppressed). */
  get dancing(): boolean {
    return this.dance !== null;
  }

  /** One-shot clip (attack/damage/podium…); returns to idle/run after. */
  setOneShot(clipName: string): void {
    const clip = this.rig.clips.find((c) => c.name === clipName);
    if (!clip) return;
    this.dance = null;
    this.playOnce(clipName);
    const action = this.currentAction;
    const onDone = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return;
      this.mixer.removeEventListener('finished', onDone);
      this.resumeLocomotion();
    };
    this.mixer.addEventListener('finished', onDone);
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.decorator.updateTransforms(); // LateUpdate: parts follow the posed body
    if (this.dance !== null) {
      this.dance.remaining -= dt;
      if (this.dance.phase === 'loop' && this.dance.remaining <= 0) {
        const hasExit = this.rig.clips.some((c) => c.name === DANCE_EXIT);
        if (hasExit) {
          this.dance.phase = 'exit';
          this.playOnce(DANCE_EXIT);
          const exitAction = this.currentAction;
          const onExitDone = (e: { action: THREE.AnimationAction }) => {
            if (e.action !== exitAction) return;
            this.mixer.removeEventListener('finished', onExitDone);
            this.dance = null;
            this.resumeLocomotion();
          };
          this.mixer.addEventListener('finished', onExitDone);
        } else {
          this.dance = null;
          this.resumeLocomotion();
        }
      }
    }
  }

  /** Remove from the scene. Geometry/materials are shared with the library
   *  template — they are freed by CharacterLibrary.dispose(), not here. */
  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }

  /** Back to idle/run after a one-shot or the dance. */
  private resumeLocomotion(): void {
    this.play(this.moving ? RUN_CLIP : IDLE_CLIP);
  }

  private play(name: string): void {
    const clip = this.rig.clips.find((c) => c.name === name);
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    if (this.currentAction !== null && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, CROSSFADE_S, false);
    }
    action.play();
    this.currentAction = action;
  }

  private playOnce(name: string): void {
    const clip = this.rig.clips.find((c) => c.name === name);
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; // hold the last frame until the listener fires
    if (this.currentAction !== null && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, CROSSFADE_S, false);
    }
    action.play();
    this.currentAction = action;
  }
}
