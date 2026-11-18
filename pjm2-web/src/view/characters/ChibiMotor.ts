// src/view/characters/ChibiMotor.ts
// Faithful port of the movement / animation half of Q4.Chibi (the "view" side of a home villager):
//   Update            @0x741D50   per-frame: UpdatePosition (or flee/dead timers), MoveSpeed/Scared/idle-variation
//                                 animator parameters derived from the REAL frame-to-frame movement
//   UpdatePosition    @0x7421B0   jump logic (panic / happy / land), acceleration chase of DestPos with ease-out,
//                                 gravity -20, ground projection, turn toward the player / travel direction
//   ProjectToGround   @0x7428A0   Physics.Linecast(LastPos + up, pos + down*0.01, TerrainMask)
//   NotifyBeingAttacked @0x742CE0, OnEnemyAttackedMe @0x742DE0, OnStageClearedScreen @0x741BA0, BlowUp @0x742880
// Reconstruction source: decomp/src/Q4/Chibi.cs (constants read from the ELF constant pool).
// The pose is NOT chosen here: an EnemyAnimator (generic serialized-AnimatorController evaluator) runs the real
// `chibi_ctrl` state machine (chibiViewData.generated.ts) from the same Animator parameters the original sets
// (MoveSpeed, Scared, PanicJump, Land, IdleVariation, Die, StageCleared*, IdleMirror, IdleSpeed).
//
// Coordinates: Unity space (LH, +Z forward, yaw about +Y in degrees, 0 = +Z). The three.js mirror (x -> -x, yaw -> -yaw)
// is applied by the host. Rotation is yaw-only: every writer of Chibi.rotation/DestRot in the original uses
// LookRotation(flat dir, up) or AngleAxis(angle, up).

import { EnemyAnimator } from './EnemyAnimatorLogic';
import type { EnemyController } from './enemyViewTypes';
import { CHIBI_VIEW_DATA } from './chibiViewData.generated';

export interface V3 { x: number; y: number; z: number }

/** Physics.Linecast(a, b, TerrainMask): terrain hit height, or null. */
export type GroundLinecast = (a: V3, b: V3) => number | null;

export interface ChibiMotorHost {
  /** Length (seconds) of the baked clip for an AnimatorController clip name (0 when unknown). */
  clipLength(clip: string): number;
  /** Terrain linecast (Layers.Instance.TerrainMask). Null = flat world at the spawn height. */
  linecast: GroundLinecast | null;
  /** MonstersAudio hooks (optional; the web port has no chibi SFX extracted yet). */
  playSfx?(kind: 'death' | 'jump', pos: V3): void;
  setRunSound?(on: boolean, pos: V3): void;
  /** Uniform [0,1) source (UnityEngine.Random is cosmetic here; injectable for tests). */
  rand?: () => number;
}

/** Quaternion.RotateTowards on yaw-only rotations: max `step` degrees along the shortest arc. */
export function rotateYawTowards(cur: number, target: number, step: number): number {
  const d = ((((target - cur) % 360) + 540) % 360) - 180;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

/** Yaw (deg) of Quaternion.LookRotation(dir flattened to XZ): atan2(x, z). */
export function lookYaw(dx: number, dz: number): number {
  return (Math.atan2(dx, dz) * 180) / Math.PI;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

export const CHIBI_CONST = {
  GRAVITY: -20.0, // @0x00B7FDF4
  EASE_RANGE: 0.19, // (dist - 0.01) / 0.19  @0x00B7FDE8/EC
  EASE_SPEED: 2.5, // @0x00B7FDF0
  TURN_DEG_PER_SEC: 180.0, // @0x00B7FDFC
  FACE_SQR_SPEED: 0.1, // @0x00B7FDF8
  SCARED_SPEED_CAP: 0.75, // @0x00B7FDC0
  SPEED_DEADZONE: 0.01, // @0x00B7FDC4
  SPEED_DT_MIN: 0.001, // @0x00B7FDC8
  RUN_SOUND_MIN_SPEED: 0.1, // @0x00B7FDCC
  PANIC_JUMP_DELAY: [0.5, 1.5] as const, // @0x00B7FDE0/E4
  HAPPY_JUMP_VEL: [3.0, 5.0] as const, // @0x00B7FDD0/D4
  HAPPY_JUMP_DELAY: [0.25, 1.0] as const, // @0x00B7FDD8/DC
  PLAYER_CLOSE_DELAY: [0.1, 1.0] as const, // @0x00B7FDA8/AC
  ENEMY_CLOSE_DELAY: [0.25, 1.5] as const, // @0x00B7FDB0/B4
  IDLE_SPEED_RANGE: [0.8, 1.2] as const, // @0x00B7FDB8/BC
  DEAD_TIME: 1.0,
  START_PANIC_VEL: [3.0, 5.0] as const,
  STAGE_CLEAR_DELAY_RANGE: [0.25, 1.5] as const, // @0x00B7FE18/1C
  RAY_UP: 1.0, // @0x00B7FE04
  RAY_DOWN_STEP: 0.01, // @0x00B7FE08
  RAY_DOWN_FORCE: 10.0, // @0x00B7FE0C
} as const;

export class ChibiMotor {
  readonly animator: EnemyAnimator;
  /** Chibi.ChibiId = GameCoreHome.ChibiData.id. */
  chibiId = 0;

  // --- Transform ---
  pos: V3;
  yawDeg: number;

  // --- serialized / public fields (Chibi.cs) ---
  destPos: V3;
  destYawDeg: number;
  /** Stage-intro chibis only: once they stop (speed below the facing threshold) they turn to DestRot (PathRunner's EndFacingAngle) at the
   *  same 180 deg/s - what the original intro shows (stop, rotate, then hop). The decompiled Chibi.UpdatePosition never reads DestRot. */
  followDestRot = false;
  lastPos: V3;
  enableRunSound = true;
  isScared = false;
  accMin = CHIBI_VIEW_DATA.chibi.AccMin as number;
  accMax = CHIBI_VIEW_DATA.chibi.AccMax as number;
  playerPos: V3 = { x: 0, y: 0, z: 0 };
  panicJumpMinVel: number = CHIBI_CONST.START_PANIC_VEL[0];
  panicJumpMaxVel: number = CHIBI_CONST.START_PANIC_VEL[1];
  readonly randomIdleMin = CHIBI_VIEW_DATA.chibi.randomIdleAnimIntervalMin as number;
  readonly randomIdleMax = CHIBI_VIEW_DATA.chibi.randomIdleAnimIntervalMax as number;

  // --- private state ---
  private isOnGround = false;
  private jumpDelay = 0;
  private isFirstRun = true;
  vel: V3 = { x: 0, y: 0, z: 0 };
  private isBeingAttacked = false;
  private attackedDestPos: V3 = { x: 0, y: 0, z: 0 };
  private dead = false;
  private deadTime = 0;
  private blownUp = false;
  private playerClose = false;
  private enemyClose = false;
  private disableJump = false;
  private randomIdleTime = 0;
  private runSoundOn = false;
  private readonly timers: { t: number; fn: () => void }[] = [];
  private readonly rand: () => number;

  /** Set when the 1 s death timer expires (Object.Destroy): the host removes the rig. */
  destroyed = false;

  constructor(
    private readonly host: ChibiMotorHost,
    spawnPos: V3,
    spawnYawDeg: number,
  ) {
    this.rand = host.rand ?? Math.random;
    this.pos = { ...spawnPos };
    this.yawDeg = spawnYawDeg;
    this.destPos = { ...spawnPos };
    this.destYawDeg = spawnYawDeg;
    this.lastPos = { ...spawnPos };
    // Awake @0x741750
    this.randomIdleTime = this.range(this.randomIdleMin, this.randomIdleMax);
    const controller = CHIBI_VIEW_DATA.controller as unknown as EnemyController;
    this.animator = new EnemyAnimator(controller, {
      clipLength: (n) => host.clipLength(n),
      onEnter: (state) => {
        // QGames random behaviour on the IdleVariation state: the blend tree param `Random` (thresholds 0,1,2)
        // picks idle_01/02/03.
        if (controller.layers[0].states[state].name === 'IdleVariation') {
          this.animator?.setFloat('Random', Math.floor(this.rand() * 3));
        }
      },
    });
    this.animator.random = this.rand;
    // Start @0x7417C0
    this.animator.setBool('IdleMirror', Math.floor(this.rand() * 2) !== 0);
    this.animator.setFloat('IdleSpeed', this.range(CHIBI_CONST.IDLE_SPEED_RANGE[0], CHIBI_CONST.IDLE_SPEED_RANGE[1]));
  }

  private range(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  // ---- properties with side effects (@0x741640 / @0x7416A0) ----
  get isPlayerClose(): boolean { return this.playerClose; }
  set isPlayerClose(v: boolean) {
    if (!this.playerClose && v) this.jumpDelay = this.range(CHIBI_CONST.PLAYER_CLOSE_DELAY[0], CHIBI_CONST.PLAYER_CLOSE_DELAY[1]);
    this.playerClose = v;
  }
  get isEnemyClose(): boolean { return this.enemyClose; }
  set isEnemyClose(v: boolean) {
    if (!this.enemyClose && v) this.jumpDelay = this.range(CHIBI_CONST.ENEMY_CLOSE_DELAY[0], CHIBI_CONST.ENEMY_CLOSE_DELAY[1]);
    this.enemyClose = v;
  }
  /** ChibiIntro.PathRunner sets `m_jumpDelay` directly when it enables panic jumping (+0x94). */
  setJumpDelay(v: number): void { this.jumpDelay = v; }
  /** Raw write of m_IsEnemyClose (+0xce) without the property's jump-delay roll (ChibiIntro.PathRunner). */
  setEnemyCloseRaw(v: boolean): void { this.enemyClose = v; }
  get isDead(): boolean { return this.dead; }
  get onGround(): boolean { return this.isOnGround; }

  // ---- events ----
  /** OnEnemyAttackedMe @0x742DE0 (UnityEvents.chibiKilledEvent for THIS chibi). */
  onKilled(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadTime = CHIBI_CONST.DEAD_TIME;
    this.animator.setTrigger('Die');
    this.host.playSfx?.('death', this.pos);
  }

  /** NotifyBeingAttacked @0x742CE0: flee one unit away from the attacker until the kill lands. */
  notifyBeingAttacked(attackerPos: V3): void {
    this.isBeingAttacked = true;
    let ax = this.pos.x - attackerPos.x, ay = this.pos.y - attackerPos.y, az = this.pos.z - attackerPos.z;
    const l = Math.hypot(ax, ay, az);
    if (l > 1e-5) { ax /= l; ay /= l; az /= l; } else { ax = ay = az = 0; }
    this.attackedDestPos = { x: this.pos.x + ax, y: this.pos.y + ay, z: this.pos.z + az };
  }

  /** BlowUp @0x742880 (bomb). */
  blowUp(vel: V3): void {
    this.blownUp = true;
    this.vel = { ...vel };
  }

  /** OnStageClearedScreen @0x741BA0 (UnityEvents.stageClearedScreenEvent). */
  onStageClearedScreen(step: number, isPerfect: boolean): void {
    if (!isPerfect) {
      if (step !== 0) return;
      this.playAnimDelayed(0, 'StageClearedNormal');
    } else {
      if (step !== 1) return;
      this.playAnimDelayed(1, 'StageClearedPerfect');
    }
  }

  /** PlayAnimDelayed @0x741CC0: disables jumping, waits delay + Random(0.25, 1.5), then fires the trigger. */
  private playAnimDelayed(delay: number, trigger: string): void {
    this.disableJump = true;
    const w = delay + this.range(CHIBI_CONST.STAGE_CLEAR_DELAY_RANGE[0], CHIBI_CONST.STAGE_CLEAR_DELAY_RANGE[1]);
    this.timers.push({ t: w, fn: () => this.animator.setTrigger(trigger) });
  }

  // ---- Update @0x741D50 ----
  update(dt: number): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].t -= dt;
      if (this.timers[i].t <= 0) { this.timers[i].fn(); this.timers.splice(i, 1); }
    }
    if (this.isFirstRun) {
      this.lastPos = { ...this.pos };
      this.isFirstRun = false;
    }
    if (!this.dead) {
      if (!this.isBeingAttacked) this.updatePosition(dt);
      else this.destPos = { ...this.attackedDestPos };
    } else {
      this.deadTime -= dt;
      if (this.deadTime <= 0) { this.destroyed = true; this.setRun(false); return; }
    }

    // MoveSpeed is PLANAR: raw disassembly @0x745ee1..745f01 squares only x (xmm0) and z (xmm1) of
    // (position - LastPos) before vsqrtss — Ghidra's SQRT(a*a + b*b) is not a dropped y lane. So a chibi
    // hopping on the spot reports MoveSpeed 0 (the controller's Idle -> PanicJump route needs MoveSpeed > 0.05).
    const mx = this.pos.x - this.lastPos.x, mz = this.pos.z - this.lastPos.z;
    let speed = Math.hypot(mx, mz);
    if (this.isScared) speed = Math.min(speed, CHIBI_CONST.SCARED_SPEED_CAP);
    if (speed <= CHIBI_CONST.SPEED_DEADZONE) speed = 0;
    if (dt > CHIBI_CONST.SPEED_DT_MIN) speed /= dt;

    const a = this.animator;
    a.setFloat('MoveSpeed', speed);
    this.lastPos = { ...this.pos };
    a.setBool('Scared', this.isScared);
    if (!this.isScared && speed <= 0) {
      this.randomIdleTime -= dt;
      if (this.randomIdleTime <= 0) {
        this.randomIdleTime = this.range(this.randomIdleMin, this.randomIdleMax);
        a.setTrigger('IdleVariation');
      }
    }
    this.setRun(!(speed <= CHIBI_CONST.RUN_SOUND_MIN_SPEED || !this.enableRunSound));
    a.update(dt);
  }

  private setRun(on: boolean): void {
    if (on !== this.runSoundOn) { this.runSoundOn = on; this.host.setRunSound?.(on, this.pos); }
  }

  // ---- UpdatePosition @0x7421B0 ----
  private updatePosition(dt: number): void {
    const C = CHIBI_CONST;
    if (!this.blownUp) {
      if (!this.disableJump) {
        this.jumpDelay = Math.max(0, this.jumpDelay - dt);
        if (this.isOnGround) {
          if (this.jumpDelay <= 0) {
            if (!this.playerClose) {
              if (this.enemyClose || this.isScared) {
                this.animator.setTrigger('PanicJump');
                this.vel.y = this.range(this.panicJumpMinVel, this.panicJumpMaxVel);
                this.jumpDelay = this.range(C.PANIC_JUMP_DELAY[0], C.PANIC_JUMP_DELAY[1]);
                this.host.playSfx?.('jump', this.pos);
              }
            } else {
              this.vel.y = this.range(C.HAPPY_JUMP_VEL[0], C.HAPPY_JUMP_VEL[1]);
              this.jumpDelay = this.range(C.HAPPY_JUMP_DELAY[0], C.HAPPY_JUMP_DELAY[1]);
              this.host.playSfx?.('jump', this.pos);
            }
          } else {
            this.animator.setTrigger('Land');
          }
        }
      }
    } else if (this.isOnGround && this.vel.y < 0) {
      this.blownUp = false;
    }

    const tx = this.destPos.x - this.pos.x, tz = this.destPos.z - this.pos.z;
    const dist = Math.hypot(tx, tz);
    if (!this.isOnGround || dist > 0.01 || this.playerClose || this.enemyClose) {
      const t = clamp01((dist - 0.01) / C.EASE_RANGE);
      const speedFactor = t * C.EASE_SPEED;
      const acc = lerp(this.accMax, this.accMin, t);
      const newVelY = this.vel.y + dt * C.GRAVITY;
      const dx = dist > 1e-6 ? (tx / dist) * speedFactor : 0;
      const dz = dist > 1e-6 ? (tz / dist) * speedFactor : 0;
      // Vector3.MoveTowards(m_Vel, desiredVel(y = 0), dt * acc)
      const vx = dx - this.vel.x, vy = 0 - this.vel.y, vz = dz - this.vel.z;
      const vlen = Math.hypot(vx, vy, vz);
      const maxD = dt * acc;
      if (vlen <= maxD || vlen < 1e-9) { this.vel = { x: dx, y: 0, z: dz }; }
      else {
        this.vel = { x: this.vel.x + (vx / vlen) * maxD, y: this.vel.y + (vy / vlen) * maxD, z: this.vel.z + (vz / vlen) * maxD };
      }
      this.vel.y = newVelY;
      this.pos = { x: this.pos.x + this.vel.x * dt, y: this.pos.y + this.vel.y * dt, z: this.pos.z + this.vel.z * dt };
      this.pos = this.projectToGround(this.pos, false);
    }

    const sqr = this.vel.x * this.vel.x + this.vel.z * this.vel.z;
    if (this.playerClose || sqr > C.FACE_SQR_SPEED) {
      const target = this.playerClose
        ? lookYaw(this.playerPos.x - this.pos.x, this.playerPos.z - this.pos.z)
        : lookYaw(this.vel.x, this.vel.z);
      this.yawDeg = rotateYawTowards(this.yawDeg, target, dt * C.TURN_DEG_PER_SEC);
    } else if (this.followDestRot) {
      this.yawDeg = rotateYawTowards(this.yawDeg, this.destYawDeg, dt * C.TURN_DEG_PER_SEC);
    }
  }

  // ---- ProjectToGround @0x7428A0 ----
  projectToGround(pos: V3, force: boolean): V3 {
    const C = CHIBI_CONST;
    let a: V3, b: V3;
    if (!force) {
      if (this.vel.y >= 0) { this.isOnGround = false; return pos; }
      a = { x: this.lastPos.x, y: this.lastPos.y + C.RAY_UP, z: this.lastPos.z };
      b = { x: pos.x, y: pos.y - C.RAY_DOWN_STEP, z: pos.z };
    } else {
      a = { x: pos.x, y: pos.y + C.RAY_UP, z: pos.z };
      b = { x: pos.x, y: pos.y - C.RAY_DOWN_FORCE, z: pos.z };
    }
    const hy = this.host.linecast !== null ? this.host.linecast(a, b) : null;
    const grounded = hy !== null;
    const out = { ...pos };
    if (hy !== null) { out.y = hy; this.vel.y = 0; }
    this.isOnGround = grounded;
    return out;
  }

  /** Chibi.ProjectPosToGround @0x742B10 (static): snap a spawn position onto the terrain. */
  static projectPosToGround(pos: V3, linecast: GroundLinecast | null): V3 {
    if (linecast === null) return { ...pos };
    const hy = linecast({ x: pos.x, y: pos.y + 1, z: pos.z }, { x: pos.x, y: pos.y - 10, z: pos.z });
    return hy === null ? { ...pos } : { x: pos.x, y: hy, z: pos.z };
  }
}
