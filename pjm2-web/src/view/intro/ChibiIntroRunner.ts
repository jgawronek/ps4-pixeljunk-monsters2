// src/view/intro/ChibiIntroRunner.ts
// Headless port of Q4.ChibiIntro / ChibiIntro.PathRunner (the chibis that run in along authored
// paths while the intro cameras play).  Verified against raw x86-64 disassembly:
//   PathRunner.Update @00744090  (asm @7440e1..744375), Sample @00744630, ChibiIntro.Awake @00743150,
//   CreateChibis @00743450.  rodata: b7fe44=4.0 b7fe48=1.0 b7fe4c=-0.1 b7fe50=0.25 b7fe54=1.5
//   b7fe20=0.075 b7fe24=0.15 b7fe28=2.5 b7fe2c=3.0.
//
// ORIGINAL SPLIT: PathRunner only writes Chibi.DestPos / DestRot (and enables the panic-jump
// fields); Q4.Chibi.UpdatePosition @007421b0 then chases DestPos with AccMin/AccMax, snaps to the
// ground and drives the run/idle/jump Animator parameters.  That half is now the faithful
// ChibiMotor (src/view/characters/ChibiMotor.ts) running the real chibi_ctrl Animator: each IntroChibi
// is a thin adapter over one motor, so PathRunner writes land on the same fields the original writes.

import { quatAngleAxisY, quatRotate, type Q4, type RigChibiIntro, type V3 } from './IntroRig';
import { ChibiMotor, type GroundLinecast } from '../characters/ChibiMotor';
import { CHIBI_VIEW_DATA } from '../characters/chibiViewData.generated';

/** Deterministic PRNG (the original uses UnityEngine.Random - cosmetic only). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CHIBI_INTRO_CONST = {
  /** PathRunner.Update: slow-down factor scale, Clamp01((last - pathTime) * 4.0)  (b7fe44). */
  SLOWDOWN_SCALE: 4.0,
  /** PathRunner.Update: DestRot is set to AngleAxis(EndFacingAngle) while the slow-down factor < 1.0 (b7fe48). */
  FACE_END_BELOW: 1.0,
  /** Jump-delay countdown starts at pathTime >= last - 0.1  (b7fe4c = -0.1). */
  JUMP_EPSILON: -0.1,
  /** Chibi m_jumpDelay = Random.Range(0.25, 1.5) when panic jumping is enabled (b7fe50/54). */
  JUMP_INTERVAL: [0.25, 1.5] as const,
  /** ChibiIntro.Awake: runDelay += Random.Range(0.075, 0.15) per extra chibi (b7fe20/24). */
  RUN_DELAY_STEP: [0.075, 0.15] as const,
  /** CreateChibis: chibi AccMin = Random.Range(2.5, 3.0) (b7fe28/2c), AccMax = 5.0 (0x40a00000). */
  ACC_MIN: [2.5, 3.0] as const,
  ACC_MAX: 5.0,
} as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The chibi side of the contract: PathRunner writes destPos/destRot, enables panic jumps (Chibi +0xce/+0x94/+0x88/+0x8c). */
export class IntroChibi {
  constructor(readonly motor: ChibiMotor) {}
  get pos(): V3 { return this.motor.pos; }
  set pos(v: V3) { this.motor.pos = { ...v }; }
  get yawDeg(): number { return this.motor.yawDeg; }
  get destPos(): V3 { return this.motor.destPos; }
  set destPos(v: V3) { this.motor.destPos = { ...v }; }
  get destYawDeg(): number { return this.motor.destYawDeg; }
  set destYawDeg(v: number) { this.motor.destYawDeg = v; }
  get accMin(): number { return this.motor.accMin; }
  /** Chibi +0xce (m_IsEnemyClose) written as a raw field by PathRunner (no property side effects). */
  get panicEnabled(): boolean { return this.motor.isEnemyClose; }
  set panicEnabled(v: boolean) { this.motor.setEnemyCloseRaw(v); }
  /** Chibi +0x94 (m_jumpDelay). */
  set jumpTimer(v: number) { this.motor.setJumpDelay(v); }
  get panicMinVel(): number { return this.motor.panicJumpMinVel; }
  set panicMinVel(v: number) { this.motor.panicJumpMinVel = v; }
  get panicMaxVel(): number { return this.motor.panicJumpMaxVel; }
  set panicMaxVel(v: number) { this.motor.panicJumpMaxVel = v; }
}

export class PathRunner {
  isWaiting = true;
  pathTime = 0;
  constructor(
    readonly chibi: IntroChibi,
    readonly path: readonly V3[],
    readonly startPos: V3,
    public runDelay: number,
    public jumpDelay: number,
    readonly moveSpeed: number,
    readonly panicMinVel: number,
    readonly panicMaxVel: number,
    readonly endAngle: number,
    private readonly rand: () => number,
  ) {
    // ctor: DestPos = Sample(0) (ground projected by the view)
    const s = this.sample(0);
    chibi.destPos = s;
    chibi.pos = { ...s };
  }

  /** Sample @00744630: startRot (identity - ChibiIntro.Awake stores Quaternion.identity) * Lerp(p[i], p[i+1]) + startPos. */
  sample(t: number): V3 {
    const i = Math.floor(t);
    const a = this.path[i];
    const b = this.path[Math.min(i + 1, this.path.length - 1)];
    const f = t - i;
    return {
      x: this.startPos.x + lerp(a.x, b.x, f),
      y: this.startPos.y + lerp(a.y, b.y, f),
      z: this.startPos.z + lerp(a.z, b.z, f),
    };
  }

  /** PathRunner.Update @00744090 */
  update(dt: number): void {
    this.isWaiting = false; // SceneLoader.IsLoading is false in the web port
    const last = this.path.length - 1;
    this.runDelay -= dt;
    if (!(0 < this.runDelay) && this.pathTime < last) {
      const i = Math.floor(this.pathTime);
      const a = this.path[i];
      const b = this.path[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const f = clamp01((last - this.pathTime) * CHIBI_INTRO_CONST.SLOWDOWN_SCALE);
      const speed = lerp(0, this.moveSpeed, f);
      this.pathTime = (speed / segLen) * dt + this.pathTime;
      if (this.pathTime < last) {
        this.chibi.destPos = this.sample(this.pathTime);
        if (CHIBI_INTRO_CONST.FACE_END_BELOW > f) this.chibi.destYawDeg = this.endAngle;
      }
    }
    if (this.jumpDelay > 0 && this.pathTime >= last + CHIBI_INTRO_CONST.JUMP_EPSILON) {
      this.jumpDelay -= dt;
      if (!(0 < this.jumpDelay)) {
        if (!this.chibi.panicEnabled) {
          const [lo, hi] = CHIBI_INTRO_CONST.JUMP_INTERVAL;
          this.chibi.jumpTimer = lo + this.rand() * (hi - lo);
        }
        this.chibi.panicEnabled = true;
        this.chibi.panicMinVel = this.panicMinVel;
        this.chibi.panicMaxVel = this.panicMaxVel;
      }
    }
  }
}

/** Yaw (deg, Unity: rotation about +Y, 0 = +Z) of a unity-space quaternion. */
export function yawOf(q: Q4): number {
  const f = quatRotate(q, { x: 0, y: 0, z: 1 });
  return (Math.atan2(f.x, f.z) * 180) / Math.PI;
}

export class ChibiIntroRunner {
  readonly chibis: IntroChibi[] = [];
  readonly runners: PathRunner[] = [];
  private readonly rand: () => number;

  /**
   * @param ground  terrain height under (x, z) (Unity space), used when no `linecast` is given
   * @param linecast Physics.Linecast(a, b, TerrainMask) -> hit y | null (preferred: exactly what Chibi.ProjectToGround casts)
   */
  constructor(
    rig: RigChibiIntro,
    seed = 1,
    ground: ((x: number, z: number, fallbackY: number) => number) | null = null,
    linecast: GroundLinecast | null = null,
  ) {
    this.rand = mulberry32(seed);
    const start = rig.world.pos;
    const startPos: V3 = { x: start[0], y: start[1], z: start[2] };
    // ChibiIntro.CreateChibis: rotation = transform.rotation * AngleAxis(Random(-range, +range), up)
    const baseYaw = yawOf({ x: rig.world.rot[0], y: rig.world.rot[1], z: rig.world.rot[2], w: rig.world.rot[3] });
    // Terrain probe: the real linecast when given, else a plane from `ground` (or flat at the chibi's own height).
    let flatY = startPos.y;
    const probe: GroundLinecast = linecast ?? ((a, b) => {
      const y = ground !== null ? ground(b.x, b.z, flatY) : flatY;
      return y >= b.y && y <= a.y ? y : null;
    });
    // ChibiIntro.Awake: runDelay chain
    let runDelay = rig.runDelay;
    for (const pts of rig.paths) {
      const path: V3[] = pts.map((p) => ({ x: p[0], y: p[1], z: p[2] }));
      const yaw = baseYaw + (rig.faceAngleRange > 0 ? (this.rand() * 2 - 1) * rig.faceAngleRange : 0);
      const accMin = lerp(CHIBI_INTRO_CONST.ACC_MIN[0], CHIBI_INTRO_CONST.ACC_MIN[1], this.rand());
      const spawn = ChibiMotor.projectPosToGround(startPos, probe);
      flatY = spawn.y;
      const motor = new ChibiMotor(
        {
          clipLength: (n) => (CHIBI_VIEW_DATA.clips as Record<string, { length: number | null }>)[n]?.length ?? 0,
          linecast: probe,
          rand: this.rand,
        },
        spawn, yaw,
      );
      motor.accMin = accMin;
      motor.accMax = CHIBI_INTRO_CONST.ACC_MAX;
      motor.enableRunSound = true; // Chibi +0x70 = 1
      const c = new IntroChibi(motor);
      this.chibis.push(c);
      this.runners.push(new PathRunner(
        c, path, startPos, runDelay, rig.jumpDelay, rig.moveSpeed, rig.panicJumpMinVel, rig.panicJumpMaxVel,
        rig.endFacingAngle, this.rand,
      ));
      // The runner ctor placed the chibi on Sample(0) (authored offsets); snap it onto the terrain like Chibi spawns do.
      motor.pos = ChibiMotor.projectPosToGround(motor.pos, probe);
      motor.lastPos = { ...motor.pos };
      const [lo, hi] = CHIBI_INTRO_CONST.RUN_DELAY_STEP;
      runDelay += lo + this.rand() * (hi - lo);
    }
  }

  /** ChibiIntro.Update -> UpdateMovement(dt): every PathRunner.Update, then every Chibi.Update. */
  update(dt: number): void {
    for (const r of this.runners) r.update(dt);
    for (const c of this.chibis) c.motor.update(dt);
  }

  /** Final facing the runners rotate to (EndFacingAngle) - exposed for tests. */
  static endQuat(rig: RigChibiIntro): Q4 {
    return quatAngleAxisY(rig.endFacingAngle);
  }
}
