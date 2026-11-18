// src/view/intro/IntroChibiView.ts
// three.js view of the ChibiIntro runners: one chibi_00 rig per authored path. Movement is the faithful ChibiMotor
// (Q4.Chibi.UpdatePosition) driven by the headless ChibiIntroRunner (PathRunner writes DestPos/DestRot); the pose comes
// from the real chibi_ctrl Animator state machine via ControllerPlayer. Unity (x,y,z) -> three (-x,y,z); yaw negated.

import * as THREE from 'three';
import type { CharacterRig } from '../characters/CharacterLibrary';
import { ControllerPlayer } from '../characters/controllerPlayer';
import { ChibiIntroRunner } from './ChibiIntroRunner';

export class IntroChibiView {
  readonly root = new THREE.Group();
  private readonly rigs: { rig: CharacterRig; player: ControllerPlayer; index: number }[] = [];

  constructor(
    readonly runner: ChibiIntroRunner,
    makeRig: () => CharacterRig | null,
    decorate?: (root: THREE.Object3D) => void,
  ) {
    this.root.name = 'intro-chibis';
    for (let i = 0; i < runner.chibis.length; i++) {
      const rig = makeRig();
      if (rig === null) continue;
      const player = new ControllerPlayer(rig.root, rig.clips, runner.chibis[i].motor.animator, {}, () => {});
      this.rigs.push({ rig, player, index: i });
      this.root.add(rig.root);
      decorate?.(rig.root);
    }
    this.sync();
  }

  update(dt: number): void {
    this.runner.update(dt);
    this.sync();
  }

  private sync(): void {
    for (const r of this.rigs) {
      const m = this.runner.chibis[r.index].motor;
      r.rig.root.position.set(-m.pos.x, m.pos.y, m.pos.z);
      r.rig.root.rotation.set(0, (-m.yawDeg * Math.PI) / 180, 0);
      r.player.apply();
    }
  }

  dispose(): void {
    for (const r of this.rigs) { r.player.dispose(); r.rig.root.removeFromParent(); }
    this.rigs.length = 0;
    this.root.removeFromParent();
  }
}
