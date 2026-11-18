// src/view/characters/ChibiStageView.ts
// Chibi (home villager) views: one chibi_00 rig per living chibi around the home — the web counterpart of the
// per-chibi `Q4.Chibi` MonoBehaviours that `Q4.Home` spawns (SpawnChibi @0x462280).
//
// Each chibi is a ChibiMotor (faithful port of Q4.Chibi.Update/UpdatePosition: acceleration chase of DestPos,
// gravity, panic/happy hops, terrain projection, turning) driving the REAL `chibi_ctrl` Animator state machine
// (Idle/run/PanicJump/fear/IdleVariation/Die/StageCleared*; extracted by tools/assets/extract_chibi_view_data.py)
// through ControllerPlayer. The sim (GameCoreHome) owns the alive set and the spawn layout; where a chibi WANTS to be
// each frame is the view solver's job (Q4.Home.ChibiCollisions, ported in HomeChibiSolver when attached via
// `setSolver`) — without a solver chibis idle on their spawn spot (DestPos = Start position, as in the original).
//   - death: enemyAttackedHomeEvent carries the dying ChibiData → Die trigger, rig removed 1 s later (Chibi.DeadTime)
//   - stage clear: stageClearedScreenEvent(step, perfect) → delayed StageClearedNormal/Perfect trigger
// Coordinate conventions mirror EnemyStageView/PlayerStageView: unity (x,y,z) → three (−x,y,z), yaw → −yaw.

import * as THREE from 'three';
import type { CharacterRig, CharacterLibrary } from './CharacterLibrary';
import type { GameCoreHome, ChibiData } from '../../core/GameCoreHome';
import { ChibiMotor, type GroundLinecast, type V3 } from './ChibiMotor';
import { ControllerPlayer } from './controllerPlayer';
import { CHIBI_VIEW_DATA } from './chibiViewData.generated';

export interface ChibiViewOptions {
  linecast?: GroundLinecast | null;
  rand?: () => number;
  playSfx?: (kind: 'death' | 'jump', pos: V3) => void;
  setRunSound?: (on: boolean, pos: V3) => void;
}

/** Per-frame hook of the home view solver (Q4.Home.ChibiCollisions). Writes DestPos/DestRot/IsPlayerClose/... on motors. */
export interface ChibiSolverHook {
  update(dt: number, motors: ChibiMotor[]): void;
}

/** Unity yaw of a unity-space quaternion (x,y,z,w): atan2 of the rotated +Z axis. */
export function quatYawDeg(q: { x: number; y: number; z: number; w: number }): number {
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return (Math.atan2(fx, fz) * 180) / Math.PI;
}

export class ChibiRigView {
  readonly root: THREE.Group;
  readonly motor: ChibiMotor;
  private readonly player: ControllerPlayer;

  constructor(rig: CharacterRig, motor: ChibiMotor) {
    this.root = rig.root;
    this.motor = motor;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.player = new ControllerPlayer(this.root, rig.clips, motor.animator, {}, () => {});
    this.sync();
  }

  /** Mirror the motor transform into three space (unity x,yaw negated). */
  sync(): void {
    const p = this.motor.pos;
    this.root.position.set(-p.x, p.y, p.z);
    this.root.rotation.set(0, (-this.motor.yawDeg * Math.PI) / 180, 0);
  }

  update(dt: number): void {
    this.motor.update(dt);
    this.sync();
    this.player.apply();
  }

  dispose(): void {
    this.player.dispose();
    this.root.removeFromParent();
  }
}

/** ChibiMotorHost.clipLength over a rig's baked clips (controller clip names == GLB clip names). */
export function rigClipLength(rig: CharacterRig): (clip: string) => number {
  return (name) => rig.clips.find((c) => c.name === name.replace(/ \[data\]$/, ''))?.duration ?? 0;
}

export class ChibiStageView {
  readonly root = new THREE.Group();
  private readonly instances = new Map<number, ChibiRigView>();
  private readonly library: CharacterLibrary;
  private solver: ChibiSolverHook | null = null;

  constructor(library: CharacterLibrary, home: GameCoreHome, private readonly opts: ChibiViewOptions = {}) {
    this.library = library;
    this.root.name = 'chibis';
    if (library.get('chibi_00') === null) {
      console.warn('chibi_00 def missing — no chibi visuals');
      return;
    }
    for (let i = 0; i < home.numChibi; i++) {
      this.spawn(home.getChibiDataByIndex(i));
    }
  }

  private spawn(data: ChibiData): void {
    const rig = this.library.instantiate('chibi_00');
    // Home.SpawnChibi: the viewer starts at the sim position, rotation = sim rotation.
    const motor = new ChibiMotor(
      {
        clipLength: rigClipLength(rig),
        linecast: this.opts.linecast ?? null,
        rand: this.opts.rand,
        playSfx: this.opts.playSfx,
        setRunSound: this.opts.setRunSound,
      },
      { x: data.pos.x, y: data.pos.y, z: data.pos.z },
      quatYawDeg(data.rot),
    );
    motor.chibiId = data.id;
    const view = new ChibiRigView(rig, motor);
    this.root.add(view.root);
    this.instances.set(data.id, view);
  }

  /** Attach the Q4.Home.ChibiCollisions port (HomeChibiSolver). */
  setSolver(solver: ChibiSolverHook | null): void {
    this.solver = solver;
  }

  /** All motors in spawn order (dying ones stay until destroyed, like Home.m_chibis) — the solver's input. */
  get motors(): ChibiMotor[] {
    return [...this.instances.values()].map((v) => v.motor);
  }

  motorFor(chibiId: number): ChibiMotor | null {
    return this.instances.get(chibiId)?.motor ?? null;
  }

  /** Wire to Events.enemyAttackedHomeEvent: the sim removed this chibi (UnityEvents.chibiKilledEvent). */
  onChibiDying(chibi: ChibiData): void {
    this.instances.get(chibi.id)?.motor.onKilled();
  }

  /** EnemyBase.OnEnemyAttack → Chibi.NotifyBeingAttacked: flee one unit from the attacker until the kill lands. */
  notifyBeingAttacked(chibiId: number, attackerPos: V3): void {
    this.instances.get(chibiId)?.motor.notifyBeingAttacked(attackerPos);
  }

  /** UnityEvents.stageClearedScreenEvent(step, isPerfect). */
  onStageClearedScreen(step: number, isPerfect: boolean): void {
    for (const v of this.instances.values()) v.motor.onStageClearedScreen(step, isPerfect);
  }

  /** Stage intro: hold back the LAST `count` chibi rigs until the camera hand-off (they are the chibis that arrive via
   *  Q4.ChibiIntro paths; Q4.Home.OnCameraSwitch @00460560 activates them when the intro camera is left). */
  setLateHidden(count: number, hidden: boolean): void {
    const all = [...this.instances.values()];
    for (let i = Math.max(0, all.length - count); i < all.length; i++) all[i].root.visible = !hidden;
  }

  /** Living (non-dying) chibi count — mirrors the sim's numChibi. */
  get alive(): number {
    let n = 0;
    for (const v of this.instances.values()) if (!v.motor.isDead) n++;
    return n;
  }

  update(dt: number): void {
    this.solver?.update(dt, this.motors);
    for (const [id, v] of this.instances) {
      v.update(dt);
      if (v.motor.destroyed) { v.dispose(); this.instances.delete(id); }
    }
  }

  /** Clip names the controller needs but the baked GLB lacks (diagnostic for the asset pipeline). */
  static missingClips(rig: CharacterRig): string[] {
    const have = new Set(rig.clips.map((c) => c.name));
    return Object.keys(CHIBI_VIEW_DATA.clips).filter((n) => ['die', 'jump', 'run', 'fear', 'idle_01', 'idle_02', 'idle_03', 'Take 001'].includes(n) && !have.has(n));
  }

  dispose(): void {
    for (const v of this.instances.values()) v.dispose();
    this.instances.clear();
    this.root.removeFromParent();
  }
}
