/**
 * PlayerMover — faithful port of the original tikiman locomotion + collision
 * (Q4.PlayerMotor driving a Unity 5.6 CharacterController).
 *
 * The full evidence trail (function addresses, serialized fields, layer ids,
 * collision-matrix row) is in docs/PLAYER_BOUNDS_ANALYSIS.md. In short:
 *
 *  - The player is NOT constrained by any custom bounds code. Q4.PlayerMotor
 *    calls CharacterController.Move(vel*dt + external) every fixed 1/60 s step
 *    (UpdateMovementInternal @0x3F6230). The CC is a capsule (radius 0.15,
 *    height 0.75, center y 0.4, slopeLimit 52.2, stepOffset 0.4, skin 0.02,
 *    serialized on prefab tikiman_01 in the globalsettings bundle), layer 8
 *    "Players".
 *  - What it can touch is decided by the Unity layer-collision matrix
 *    (globalgamemanagers PhysicsManager.m_LayerCollisionMatrix[8] =
 *    0xE7C914C8): Art_PlayerArea(26, the invisible `terrain_001_player_col`
 *    wall mesh = map edge), Art_Terrain(29: terrain, deco meshes, 112 boxes,
 *    home sphere), Art_LargeProps(30), Art_SmallProps(31),
 *    AutoAvoidAbstacle(16: the 457 tree/prop "collision" capsules) and a few
 *    unused layers. NOT water (layer 4 — rivers are triggers, the player may
 *    wade in; at depth >= 0.6 he drowns and respawns), NOT enemies, NOT towers
 *    (tower prefabs carry no colliders).
 *
 * Unity's CharacterController (PhysX CCT) is reproduced with Rapier shape
 * casts against the static stage colliders: up pass (stepOffset) -> sideways
 * collide-and-slide -> down pass, with the slopeLimit "walk experiment".
 * Headless-testable: depends only on PhysicsWorld.
 */

import type RAPIER from '@dimforge/rapier3d-compat';

import type { PhysicsWorld } from '../../engine/physics/world';
import { PhysicsQueries } from '../../engine/physics/queries';

// ---- serialized data (tikiman_01 prefab, globalsettings bundle) ----------------

/** CharacterController on tikiman_01 (CharacterController path 3649893383731521726). */
export const PLAYER_CC = {
  radius: 0.15000000596046448,
  height: 0.75,
  centerY: 0.4000000059604645,
  slopeLimitDeg: 52.20000076293945,
  stepOffset: 0.4000000059604645,
  skinWidth: 0.019999999552965164,
  minMoveDistance: 0,
} as const;

/** Q4.Player serialized fields used by locomotion (MonoBehaviour 2514285418080110840). */
export const PLAYER_SETTINGS = {
  walkSpeed: 3.5343000888824463,
  runSpeed: 4.417874813079834,
  acceleration: 12,
  deceleration: 16,
  holdingFruitSpeedScale: 0.75,
  jumpGravity: 25,
  slopeUpAngle: 45,
  slopeUpSpeedScale: 0.75,
  slopeDownAngle: 25,
  slopeDownSpeedScale: 1.25,
  enableDrowning: true,
  drownDepth: 0.6000000238418579,
  drownRespawnDelay: 5,
  respawnDuration: 1,
  /** m_SpeedPotion = 1 on the prefab (run speed available to the run input). */
  speedPotion: true,
} as const;

/** PhysicsManager.m_LayerCollisionMatrix[8] (layer "Players"), signed int32. */
export const PLAYERS_LAYER = 8;
export const PLAYER_COLLISION_MASK = 0xe7c914c8 | 0;
/** Q4.Layers.WaterMask = 1 << 4. */
const WATER_MASK = 1 << 4;

// ---- decomp constants (verified from raw x86-64 rodata reads, see doc) -------------

const FIXED_STEP = 0.01666666753590107; // DAT_00b7a6dc / b7a71c
const FIXED_THRESHOLD = 0.016500001773238182; // DAT_00b7a6d8 / b7a718
const INPUT_SQR_THRESHOLD = 0.004999999888241291; // DAT_00b7a794
const GROUNDED_MIN_VY = -1.0; // DAT_00b7a790 (ApplyGravity grounded clamp)
const GROUND_PROBE_HALF = 0.800000011920929; // DAT_00b7a728 (+/- vertical linecast span)
const GROUND_PROBE_OFFSET = 0.3374999761581421; // DAT_00b7a72c (/ b7a730 = -0.3375)
const WATER_PROBE_HALF = 10; // DAT_00b7a78c
const NEW_COLLISION_GROUND_NORMAL_Y = 0.20000000298023224; // DAT_00b7a764
const NEW_COLLISION_GROUND_RADIUS_SCALE = 0.5; // DAT_00b7a768
/** Player-owned 'Collision' trigger-probe capsule (child "Collision", layer 13). */
const WATER_CAPSULE = { radius: 0.25, height: 0.7, centerY: 0.55 } as const;

type V3 = [number, number, number];

export interface PlayerInput {
  /** Unity-space world move direction (already camera-mapped), |v| <= 1. */
  x: number;
  z: number;
}

export interface MoverOptions {
  /** Run input held (original: separate button; only effective with m_SpeedPotion). */
  run?: boolean;
  /** GameCorePlayer.GetSpeedScale() (buffs). Default 1. */
  speedScale?: number;
  /** GameCorePlayer.IsHoldingFruit -> x holdingFruitSpeedScale. */
  holdingFruit?: boolean;
  /** Motor CanMove() false (animator states / slide) -> zero target velocity. */
  canMove?: boolean;
}

export interface MoveResult {
  /** CollisionFlags.Below equivalent (Unity cc.isGrounded). */
  below: boolean;
  /** Any side contact happened. */
  sides: boolean;
  above: boolean;
}

interface SweepHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  px: number;
  py: number;
  pz: number;
  handle: number;
}

/** Unity AnimationCurve key (Hermite). */
interface Key { time: number; value: number; inSlope: number; outSlope: number }

/** m_RespawnMovementTime / m_RespawnMovementHeight (Player serialized curves). */
const RESPAWN_MOVEMENT_TIME: Key[] = [
  { time: 0, value: 0, inSlope: 2.330434560775757, outSlope: 2.330434560775757 },
  { time: 0.6026291847229004, value: 0.7312421798706055, inSlope: 0.7132585048675537, outSlope: 0.7132585048675537 },
  { time: 1, value: 1, inSlope: 0.9019255042076111, outSlope: 0.9019255042076111 },
];
const RESPAWN_MOVEMENT_HEIGHT: Key[] = [
  { time: 0, value: 0.009192675352096558, inSlope: 13.320569038391113, outSlope: 13.320569038391113 },
  { time: 0.5, value: 2.9999992847442627, inSlope: -0.08098499476909637, outSlope: -0.08098499476909637 },
  { time: 1.00390625, value: 0.009192675352096558, inSlope: -16.191532135009766, outSlope: -16.191532135009766 },
];

/** Unity AnimationCurve.Evaluate for Hermite keys (clamped outside the range). */
export function evalCurve(keys: readonly Key[], t: number): number {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first.time) return first.value;
  if (t >= last.time) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= a.time && t <= b.time) {
      const dt = b.time - a.time;
      const s = (t - a.time) / dt;
      const s2 = s * s;
      const s3 = s2 * s;
      return (
        (2 * s3 - 3 * s2 + 1) * a.value +
        (s3 - 2 * s2 + s) * a.outSlope * dt +
        (-2 * s3 + 3 * s2) * b.value +
        (s3 - s2) * b.inSlope * dt
      );
    }
  }
  return last.value;
}

export type PlayerMode = 'normal' | 'drowning' | 'respawning';

export class PlayerMover {
  /** Transform position (feet), Unity space. */
  x = 0;
  y = 0;
  z = 0;
  /** m_currentVelocity (0x40). */
  vx = 0;
  vy = 0;
  vz = 0;
  /** cc.isGrounded after the last Move (CollisionFlags.Below). */
  groundedCC = false;
  /** Q4 "new collisions" grounded (OnControllerColliderHit classification). */
  grounded = false;
  /** m_facingSlopeAngle (deg, + = uphill along facing). */
  facingSlopeAngle = 0;
  /** Water surface minus feet y while overlapping a Water trigger, else 0. */
  waterDepth = 0;
  mode: PlayerMode = 'normal';
  /** m_LastKnownGroundPos. */
  lastGround: V3 = [0, 0, 0];
  /** Facing (unit, horizontal) — last non-zero input direction. */
  fx = 0;
  fz = 1;
  /** Number of completed drown->respawn cycles (probe/test hook). */
  respawnCount = 0;

  private readonly R: typeof RAPIER;
  private readonly capsule: RAPIER.Capsule;
  private readonly waterCapsule: RAPIER.Capsule;
  private readonly queries: PhysicsQueries;
  private acc = 0;
  private modeTime = 0;
  private respawnFrom: V3 = [0, 0, 0];
  private respawnTo: V3 = [0, 0, 0];
  private readonly cosSlope = Math.cos((PLAYER_CC.slopeLimitDeg * Math.PI) / 180);

  constructor(
    private readonly pw: PhysicsWorld,
    /** World positions of the scene's PlayerRespawnPoint objects. */
    private readonly respawnPoints: readonly V3[] = [],
  ) {
    this.R = pw.rapier;
    // Swept with the nominal radius; the skinWidth (PhysX contact offset) is kept
    // as a resting gap by backing every stop off along the motion (see advance()).
    this.capsule = new this.R.Capsule(PLAYER_CC.height / 2 - PLAYER_CC.radius, PLAYER_CC.radius);
    this.waterCapsule = new this.R.Capsule(
      WATER_CAPSULE.height / 2 - WATER_CAPSULE.radius, WATER_CAPSULE.radius,
    );
    this.queries = new PhysicsQueries(pw);
  }

  /** transform.position = ... (teleport; resets velocity). */
  teleport(x: number, y: number, z: number): void {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.lastGround = [x, y, z];
    this.mode = 'normal';
    this.acc = 0;
  }

  /** Teleport onto the terrain surface below (x,z) (spawn / external moves). */
  teleportToGround(x: number, z: number): void {
    const hit = this.queries.linecast(x, 40, z, x, -40, z, this.pw.terrainMask);
    this.teleport(x, (hit === null ? 0 : hit.point[1]) + 0.05, z);
  }

  /** True when the capsule at the current position overlaps a blocking collider. */
  overlapsNow(): boolean {
    let hit = false;
    this.pw.world.intersectionsWithShape(
      { x: this.x, y: this.y + PLAYER_CC.centerY, z: this.z },
      { x: 0, y: 0, z: 0, w: 1 },
      this.capsule,
      () => { hit = true; return false; },
      undefined, undefined, undefined, undefined,
      this.pred,
    );
    return hit;
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Q4.PlayerMotor.UpdateMotor with EnableFixedTimeStepMovement = 1:
   * accumulate frame time and run UpdateMovementInternal in 1/60 s steps
   * (threshold 0.0165), then ground detection + bookkeeping.
   */
  update(dt: number, input: PlayerInput, opts: MoverOptions = {}): void {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= FIXED_THRESHOLD) {
      this.step(FIXED_STEP, input, opts);
      this.acc -= FIXED_STEP;
    }
  }

  private step(h: number, input: PlayerInput, opts: MoverOptions): void {
    if (this.mode === 'drowning') { this.stepDrowning(h); return; }
    if (this.mode === 'respawning') { this.stepRespawning(h); return; }

    const s = PLAYER_SETTINGS;
    const len2 = input.x * input.x + input.z * input.z;
    const moving = len2 > INPUT_SQR_THRESHOLD;
    const canMove = opts.canMove ?? true;
    let accel = moving ? s.acceleration : s.deceleration;
    let tx = 0, tz = 0;
    if (moving && canMove) {
      let speed = opts.run === true && s.speedPotion ? s.runSpeed : s.walkSpeed;
      speed *= opts.speedScale ?? 1;
      if (opts.holdingFruit === true) speed *= s.holdingFruitSpeedScale;
      // slope speed scale from m_facingSlopeAngle (UpdateMovementInternal)
      const a = this.facingSlopeAngle;
      let t: number;
      let end: number;
      if (a <= 0) { t = clamp01(-a / s.slopeDownAngle); end = s.slopeDownSpeedScale; }
      else { t = clamp01(a / s.slopeUpAngle); end = s.slopeUpSpeedScale; }
      speed *= 1 + (end - 1) * t;
      tx = input.x * speed;
      tz = input.z * speed;
      const il = Math.sqrt(len2);
      this.fx = input.x / il;
      this.fz = input.z / il;
    } else {
      accel = s.deceleration; // CanMove()==false path uses 0x30 as well
    }
    // Vector3.MoveTowards(current, target(y kept), accel*dt) — only xz changes.
    const dx = tx - this.vx, dz = tz - this.vz;
    const dl = Math.sqrt(dx * dx + dz * dz);
    const maxD = accel * h;
    if (dl <= maxD || dl < 1e-9) { this.vx = tx; this.vz = tz; }
    else { this.vx += (dx / dl) * maxD; this.vz += (dz / dl) * maxD; }

    // ApplyGravity (@0x3F60B0): grounded -> vy = max(vy, -1); else vy -= jumpGravity*dt
    if (this.groundedCC) this.vy = Math.max(this.vy, GROUNDED_MIN_VY);
    else this.vy -= s.jumpGravity * h;

    // Port deviation (documented): a character that was standing keeps glued to the
    // ground while descending slopes/steps (down pass reaches stepOffset further);
    // plain PhysX CCT flickers airborne on slopes steeper than ~skin per step.
    const res = this.move(this.vx * h, this.vy * h, this.vz * h, this.groundedCC && this.vy <= 0 ? PLAYER_CC.stepOffset : 0);
    this.groundedCC = res.below;

    this.updateGroundDetection();
    if (this.grounded && this.mode === 'normal') this.lastGround = [this.x, this.y, this.z];
    this.checkWater();
  }

  // ------------------------------------------------------- UpdateGroundDetection

  /** Terrain linecasts (@0x3F0DB0): slope along facing for the speed scale. */
  private updateGroundDetection(): void {
    const mask = this.pw.terrainMask;
    const q = this.queries;
    const probe = (ox: number, oz: number): RaycastLite | null => {
      const x = this.x + ox, z = this.z + oz;
      const hit = q.linecast(x, this.y + GROUND_PROBE_HALF, z, x, this.y - GROUND_PROBE_HALF, z, mask);
      return hit === null ? null : { px: hit.point[0], py: hit.point[1], pz: hit.point[2], ny: hit.normal[1] };
    };
    const c = probe(0, 0);
    const f = probe(this.fx * GROUND_PROBE_OFFSET, this.fz * GROUND_PROBE_OFFSET);
    const b = probe(-this.fx * GROUND_PROBE_OFFSET, -this.fz * GROUND_PROBE_OFFSET);
    // 'right' = transform.right of a facing (fx,fz): in Unity (fz, -fx)
    const rx = this.fz, rz = -this.fx;
    const rr = probe(rx * GROUND_PROBE_OFFSET, rz * GROUND_PROBE_OFFSET);
    const ll = probe(-rx * GROUND_PROBE_OFFSET, -rz * GROUND_PROBE_OFFSET);
    // missing probes fall back to the centre sample (index 0 in the original)
    const F = f ?? c, B = b ?? c, Rr = rr ?? c, L = ll ?? c;
    if (F !== null && B !== null && Rr !== null && L !== null && F !== B && L !== Rr) {
      const ax = F.px - B.px, ay = F.py - B.py, az = F.pz - B.pz;
      const hl = Math.sqrt(ax * ax + az * az);
      // sign(a.y) * Angle(a, horizontal(a))
      this.facingSlopeAngle = hl < 1e-9 ? 0 : (Math.atan2(ay, hl) * 180) / Math.PI;
    } else {
      this.facingSlopeAngle = 0;
    }
  }

  // --------------------------------------------------------------------- water

  /**
   * OnTriggerStay water branch (@0x3F4xxx): while the 'Collision' capsule
   * overlaps a Water trigger, linecast pos+10 -> pos-10 against WaterMask
   * (QueryTriggerInteraction.Collide); depth = surface.y - pos.y; depth >=
   * m_DrownDepth -> TikimanStateDrown.
   */
  private checkWater(): void {
    this.waterDepth = 0;
    if (!PLAYER_SETTINGS.enableDrowning) return;
    let overlapping = false;
    this.pw.world.intersectionsWithShape(
      { x: this.x, y: this.y + WATER_CAPSULE.centerY, z: this.z },
      { x: 0, y: 0, z: 0, w: 1 },
      this.waterCapsule,
      () => { overlapping = true; return false; },
      undefined, undefined, undefined, undefined,
      (c: RAPIER.Collider) => {
        const info = this.pw.colliderInfo.get(c.handle);
        return info !== undefined && (WATER_MASK & (1 << info.layer)) !== 0;
      },
    );
    if (!overlapping) return;
    const hit = this.queries.linecast(
      this.x, this.y + WATER_PROBE_HALF, this.z,
      this.x, this.y - WATER_PROBE_HALF, this.z,
      WATER_MASK, 'Collide',
    );
    if (hit === null) return;
    this.waterDepth = hit.point[1] - this.y;
    if (this.waterDepth >= PLAYER_SETTINGS.drownDepth) this.enterDrown();
  }

  private enterDrown(): void {
    this.mode = 'drowning';
    this.modeTime = PLAYER_SETTINGS.drownRespawnDelay;
    // Enter: CurVelocity *= DAT_00b7cf24 (damping); the body floats in place.
    this.vx = this.vz = 0;
  }

  private stepDrowning(h: number): void {
    this.modeTime -= h;
    if (this.modeTime > 0) return;
    // closest PlayerRespawnPoint to LastKnownGroundPos (@0x744B40)
    let best: V3 | null = null;
    let bd = Infinity;
    for (const p of this.respawnPoints) {
      const dx = p[0] - this.lastGround[0], dy = p[1] - this.lastGround[1], dz = p[2] - this.lastGround[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bd) { bd = d; best = p; }
    }
    this.respawnFrom = [this.x, this.y, this.z];
    this.respawnTo = best ?? this.lastGround;
    this.mode = 'respawning';
    this.modeTime = 0;
  }

  private stepRespawning(h: number): void {
    this.modeTime = clamp01(this.modeTime + h / PLAYER_SETTINGS.respawnDuration);
    const t = evalCurve(RESPAWN_MOVEMENT_TIME, this.modeTime);
    const hgt = evalCurve(RESPAWN_MOVEMENT_HEIGHT, this.modeTime);
    this.x = this.respawnFrom[0] + (this.respawnTo[0] - this.respawnFrom[0]) * t;
    this.y = this.respawnFrom[1] + (this.respawnTo[1] - this.respawnFrom[1]) * t + hgt;
    this.z = this.respawnFrom[2] + (this.respawnTo[2] - this.respawnFrom[2]) * t;
    this.vx = this.vy = this.vz = 0;
    if (this.modeTime >= 1) {
      this.x = this.respawnTo[0]; this.y = this.respawnTo[1]; this.z = this.respawnTo[2];
      this.mode = 'normal';
      this.groundedCC = false;
      this.respawnCount++;
    }
  }

  // ------------------------------------------------- CharacterController.Move

  /**
   * UnityEngine.CharacterController.Move(motion) on the static stage colliders
   * (PhysX CCT semantics): up pass (stepOffset lift) -> sideways collide &
   * slide -> down pass; slopeLimit "walk experiment" falls back to a plain
   * slide when the stepped move would land on a non-walkable slope higher than
   * the start.
   */
  move(dx: number, dy: number, dz: number, stick = 0): MoveResult {
    const sx = this.x, sy = this.y, sz = this.z;
    const horiz = Math.hypot(dx, dz);
    const doStep = horiz > 1e-7 && dy <= 0;
    const res: MoveResult = { below: false, sides: false, above: false };

    // ---- attempt A: with step offset
    const a = this.moveAttempt(sx, sy, sz, dx, dy, dz, doStep, res, stick);
    if (doStep && a.downHit !== null && a.downHit.ny < this.cosSlope && a.y > sy + 1e-3) {
      // non-walkable landing above the start -> climbing refused (PREVENT_CLIMBING)
      const r2: MoveResult = { below: false, sides: false, above: false };
      const b = this.moveAttempt(sx, sy, sz, dx, dy, dz, false, r2, stick);
      this.x = b.x; this.y = b.y; this.z = b.z;
      this.noteGround(b.downHit);
      return r2;
    }
    this.x = a.x; this.y = a.y; this.z = a.z;
    this.noteGround(a.downHit);
    return res;
  }

  private noteGround(hit: SweepHit | null): void {
    this.grounded =
      hit !== null &&
      hit.ny > NEW_COLLISION_GROUND_NORMAL_Y &&
      hit.py - this.y < PLAYER_CC.radius * NEW_COLLISION_GROUND_RADIUS_SCALE;
  }

  private moveAttempt(
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    useStep: boolean,
    res: MoveResult,
    stick: number,
  ): { x: number; y: number; z: number; downHit: SweepHit | null } {
    let x = sx, y = sy, z = sz;
    let lift = 0;
    // ---- up pass: user's upward motion + stepOffset lift
    let up = Math.max(dy, 0) + (useStep ? PLAYER_CC.stepOffset : 0);
    if (up > 1e-7) {
      const hit = this.sweep(x, y, z, 0, 1, 0, up);
      const d = hit === null ? up : this.advance(hit, 0, 1, 0);
      if (hit !== null && d < Math.max(dy, 0)) res.above = true;
      y += d;
      lift = d;
    }
    // ---- side pass (horizontal collide & slide)
    if (Math.hypot(dx, dz) > 1e-7) {
      const p = this.slideHorizontal(x, y, z, dx, dz, res);
      x = p[0]; z = p[1];
    }
    // ---- down pass: undo the lift (+ user's downward motion)
    const downDist = lift - Math.max(dy, 0) + Math.max(-dy, 0);
    let downHit: SweepHit | null = null;
    if (downDist > 1e-7) {
      // sweep reaches `skinWidth` further so a character resting at skin distance
      // is reported as touching (PhysX contact offset), instead of flickering
      // between grounded / not grounded every step.
      const hit = this.sweep(x, y, z, 0, -1, 0, downDist + PLAYER_CC.skinWidth + stick);
      if (hit === null) {
        y -= downDist;
      } else {
        const d = this.advance(hit, 0, -1, 0);
        y -= d;
        downHit = hit;
        res.below = true;
        const rem = downDist - hit.toi;
        if (hit.ny < this.cosSlope && rem > 1e-6) {
          // steep surface: continue the remaining fall sliding along the plane
          let vx = 0, vy = -rem, vz = 0;
          const dot = vx * hit.nx + vy * hit.ny + vz * hit.nz;
          vx -= hit.nx * dot; vy -= hit.ny * dot; vz -= hit.nz * dot;
          const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (l > 1e-7) {
            const h2 = this.sweep(x, y, z, vx / l, vy / l, vz / l, l);
            const m = h2 === null ? l : this.advance(h2, vx / l, vy / l, vz / l);
            x += (vx / l) * m; y += (vy / l) * m; z += (vz / l) * m;
          }
        }
      }
    } else if (downDist < -1e-7) {
      // pure upward user motion with no lift consumption — nothing to undo
    }
    return { x, y, z, downHit };
  }

  /** Horizontal sweep with iterative sliding along (horizontalised) contact normals. */
  private slideHorizontal(
    x: number, y: number, z: number, mx: number, mz: number, res: MoveResult,
  ): [number, number] {
    const ox = mx, oz = mz;
    let rx = mx, rz = mz;
    const planes: [number, number][] = [];
    for (let iter = 0; iter < 8; iter++) {
      const len = Math.hypot(rx, rz);
      if (len < 1e-7) break;
      const dx = rx / len, dz = rz / len;
      const hit = this.sweep(x, y, z, dx, 0, dz, len);
      if (hit === null) { x += rx; z += rz; break; }
      const move = this.advance(hit, dx, 0, dz);
      x += dx * move; z += dz * move;
      res.sides = true;
      let nx = hit.nx, nz = hit.nz;
      const nl = Math.hypot(nx, nz);
      if (nl < 0.05) break; // floor/ceiling-like contact — nothing to slide against
      nx /= nl; nz /= nl;
      let remain = len - move;
      let tx = dx * remain, tz = dz * remain;
      const into = tx * nx + tz * nz;
      if (into < 0) { tx -= nx * into; tz -= nz * into; }
      // second plane opposing the slide -> corner, stop (2-D crease)
      let blocked = false;
      for (const pl of planes) {
        if (tx * pl[0] + tz * pl[1] < -1e-6) blocked = true;
      }
      planes.push([nx, nz]);
      if (blocked) break;
      // never reverse against the original motion
      if (tx * ox + tz * oz <= 0) break;
      rx = tx; rz = tz;
      remain = Math.hypot(rx, rz);
      if (remain < 1e-6) break;
    }
    return [x, z];
  }

  // ------------------------------------------------------------- capsule sweep

  /**
   * Distance to travel for a hit so the capsule rests `skinWidth` away from the
   * surface (PhysX contact offset): back off along the motion by skin/cos(angle).
   */
  private advance(hit: SweepHit, dx: number, dy: number, dz: number): number {
    const c = Math.max(0.1, -(dx * hit.nx + dy * hit.ny + dz * hit.nz));
    return Math.max(0, hit.toi - PLAYER_CC.skinWidth / c);
  }

  /**
   * Sweep the player capsule from feet position (x,y,z) along the unit
   * direction against the static colliders the Players layer collides with.
   * A cast that starts already touching and is not moving INTO the surface
   * (separating / grazing) is reported as no hit.
   */
  private sweep(
    x: number, y: number, z: number, dx: number, dy: number, dz: number, dist: number,
  ): SweepHit | null {
    // Colliders already touching and not being moved into are skipped and the
    // cast repeated, so a grazing small collider (tree capsule) can never hide
    // a real obstacle behind it. (The single big terrain/wall trimeshes are
    // never skipped — that would skip the whole ground.)
    const skip: number[] = [];
    const pred = (c: RAPIER.Collider): boolean => this.pred(c) && !skip.includes(c.handle);
    for (let i = 0; i < 6; i++) {
      const hit = this.pw.world.castShape(
        { x, y: y + PLAYER_CC.centerY, z },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: dx, y: dy, z: dz },
        this.capsule,
        0,
        dist,
        true,
        undefined, undefined, undefined, undefined,
        pred,
      );
      if (hit === null) return null;
      const n = hit.normal1;
      const toi = hit.time_of_impact;
      const into = dx * n.x + dy * n.y + dz * n.z;
      if (toi <= 1e-6 && into > -1e-4) {
        if (this.pw.colliderInfo.get(hit.collider.handle)?.kind === 'mesh') return null;
        skip.push(hit.collider.handle);
        continue;
      }
      return {
        toi, nx: n.x, ny: n.y, nz: n.z,
        px: hit.witness1.x, py: hit.witness1.y, pz: hit.witness1.z,
        handle: hit.collider.handle,
      };
    }
    return null;
  }

  /** Query predicate: non-trigger colliders on layers the Players layer collides with. */
  private readonly pred = (c: RAPIER.Collider): boolean => {
    const info = this.pw.colliderInfo.get(c.handle);
    if (info === undefined || info.isTrigger) return false;
    return (PLAYER_COLLISION_MASK & (1 << info.layer)) !== 0;
  };
}

interface RaycastLite { px: number; py: number; pz: number; ny: number }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
