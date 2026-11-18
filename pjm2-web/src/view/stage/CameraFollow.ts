// src/view/stage/CameraFollow.ts
// Port of the Q4.GameCameraTopDown follow / zoom / parallel-move subsystem
// (the gameplay camera logic), operating on the rig's shared look-at target.
//
// EVIDENCE (serialized values WIN over decompiled ctor defaults):
//   public/assets/stages/3d_stage_001/scene-webp.json node 889
//   "GameCameraTopDown(Real)" (GameObject pathId 176, transformPathId 2581,
//   parent 888 "CameraRoot" at identity). From the shipped `stages` bundle
//   (BuildPlayer-3d_stage_001_env, read with UnityPy):
//     - Camera component pathId 4810: fieldOfView 22.5, near 0.3, far 1000.
//     - GameCameraTopDown MonoBehaviour pathId 8192 (script pathId 381):
//         rotateType 2 (ParallelMove), followInAir false,
//         globalOffset (0,0,0), localOffset (0,0.5,0),
//         minDistance 30, maxDistance 30  → boom distance FIXED at 30,
//         maxCameraAngle 0, cameraRotateSmoothTime 0.2,
//         zoomSpeed 2, zoomSmoothTime 0.2, cameraFollowSmoothTime 0.2,
//         parallelMoveRange (7.8, 5), parallelMoveChaseAccer 1000,
//         parallelMoveChaseSpeed 10, parallelMoveReturnAccer 3.5,
//         parallelMoveReturnSpeed 5, postParallelMoveWaitTime 0.17,
//         parallelMoveResetWhenPlayerMove true.
//   Decompiled ctor defaults (Q4.GameCameraTopDown.c $.ctor @004461e0,
//   rodata DAT_00b7ba00 = 5/15/30/0.5, DAT_00b7ba10 = 6/12/3/6, confirmed
//   from Media/Modules/Il2CppUserAssemblies.elf) are overridden by the above.
//
// BEHAVIOR SOURCES (decomp/decompiled/, treated as data):
//   Q4.GameCameraTopDown.c:
//     GetDesiredLookatTarget @004469b0 — desired = (focusPos + globalOffset)
//       * m_currentZoomRate; focusPos = playerPos + CameraTarget.m_forcedOffset
//       (Q4.CameraTarget.c FixedUpdate @0073f290 drives the focus rigidbody to
//       traceTarget.position + m_forcedOffset each fixed step; ParallelMove
//       forces m_forcedOffset = m_currentParallelDelta via ForceOffset
//       @0073f420). NO velocity look-ahead, NO deadzone, NO world-bounds clamp.
//       localOffset is only used in the no-focus-target fallback branch
//       (player.TransformPoint(localOffset*rate) + globalOffset*rate) — it is
//       NOT applied on the normal gameplay path.
//     UpdateTargetLookAt @00447c00 — lookAt = Vector3.SmoothDamp(lookAt,
//       desired, ref vel, smoothTime = Max(m_currentZoomRate, 0.1) *
//       cameraFollowSmoothTime). DAT_00b7b6d0 = 0.1 (CONFIRMED from ELF).
//     Update @004479e0 / UpdateZoom @00447b50 — zoomRate = Mathf.SmoothDamp(
//       zoomRate, destZoomRate, zoomSmoothTime).
//     UpdateCameraTransform @00447eb0 (rotateType 2 branch) — parallel-move
//       state machine (ported in updateParallel below) and
//       position = lookAt − centerDirection * GetCurrentDistance().
//     GetCurrentDistance @004473b0 — min + (max − min) * zoomRate.
//     ZoomIn @00448df0 / ZoomOut @00448ea0 — destZoomRate ∓ dt*rate*zoomSpeed,
//       clamped to [0, 1] (DAT_00b7b6d8 = 1.0 CONFIRMED).
//     Rotate @00448870 — destRotateAxis = input * sensitivity[pref] where the
//       table DAT_00b7bb80 = [1, −1] (CONFIRMED) is indexed by the invert-cam
//       preference; default pref 0 → ×1. Invert option not ported.
//     Snap @00446760 / CheckSnapWhileParallelMoving @00448b40 — zero parallel
//       state + smooth velocities, snap look-at to desired.
//   Q4.CameraController.c ReceiveCameraRotateInput @00739890 — right-stick
//     Vector2 → camera.Rotate((x, y, 0)); the only pan input in the original
//     (no pointer-edge / keyboard pan exists).
//   Unity Vector3.SmoothDamp / Mathf.SmoothDamp / Mathf.MoveTowards formulas
//   ported 1:1 (UnityCsReference), fp32 via Math.fround at every step.
//
// TS ADAPTATION: the original focus point is a physics-driven GameObject
// (CameraTarget) lagging ≤1 fixed step behind playerPos+offset; here the
// offset is applied directly to the supplied position (no physics seam in
// the view layer). The airborne gate in UpdateTargetLookAt (followInAir=0,
// CharacterController.isGrounded) is ambiguous in the decomp and needs sim
// state the view seam does not expose — follow() always smooths. UNVERIFIED.
//
// All math here is view-layer (camera never feeds the sim). fp32 is kept for
// the ported Unity formulas so follow/zoom trajectories match the original.

import * as THREE from 'three';

const f32 = Math.fround;

/** Serialized tuning of GameCameraTopDown (MonoBehaviour pathId 8192). */
export interface CameraFollowParams {
  /** 0x60 — serialized 30 (ctor default 5, DAT_00b7ba00). */
  minDistance?: number;
  /** 0x64 — serialized 30 (ctor default 15). min == max → fixed boom. */
  maxDistance?: number;
  /** 0x78 — serialized 0.2 (ctor default 0.5). */
  cameraFollowSmoothTime?: number;
  /** 0x70 — serialized 2. */
  zoomSpeed?: number;
  /** 0x74 — serialized 0.2. */
  zoomSmoothTime?: number;
  /** 0x48 — serialized (0,0,0). Added to the focus position pre-scaling. */
  globalOffset?: { x: number; y: number; z: number };
  /** 0x7C — serialized (7.8, 5); ctor default (5,5) via DAT_00b7b6b8=5. */
  parallelMoveRange?: { x: number; y: number };
  /** 0x84 — serialized 1000 (ctor 6). Pan-while-idle acceleration. */
  parallelMoveChaseAccer?: number;
  /** 0x88 — serialized 10 (ctor 12). Pan-while-idle max speed. */
  parallelMoveChaseSpeed?: number;
  /** 0x8C — serialized 3.5 (ctor 3). Re-center-while-running acceleration. */
  parallelMoveReturnAccer?: number;
  /** 0x90 — serialized 5 (ctor 6). Re-center-while-running max speed. */
  parallelMoveReturnSpeed?: number;
  /** 0x94 — serialized 0.17 (ctor 1). Hold pan this long after input ends. */
  postParallelMoveWaitTime?: number;
  /** 0x98 — serialized true. Re-center the pan while the player moves. */
  parallelMoveResetWhenPlayerMove?: boolean;
}

/** Mathf.MoveTowards (fp32). */
function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = f32(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return f32(current + f32(Math.sign(d) * maxDelta));
}

/**
 * Q4.GameCameraTopDown follow/zoom/parallel state, bound to the rig's target
 * vector (mutated in place by follow()/snap()). Field names keep the C#
 * m_ names + offsets (dump.cs TypeDefIndex 2702) for three-way grepping.
 */
export class CameraFollow {
  /** Serialized params (see CameraFollowParams citations). */
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly cameraFollowSmoothTime: number;
  readonly zoomSpeed: number;
  readonly zoomSmoothTime: number;
  readonly globalOffset: { x: number; y: number; z: number };
  readonly parallelMoveRange: { x: number; y: number };
  readonly parallelMoveChaseAccer: number;
  readonly parallelMoveChaseSpeed: number;
  readonly parallelMoveReturnAccer: number;
  readonly parallelMoveReturnSpeed: number;
  readonly postParallelMoveWaitTime: number;
  readonly parallelMoveResetWhenPlayerMove: boolean;

  /** 0xB0 — ctor 1 (zoom fully "out"; distance = maxDistance). */
  m_destZoomRate = 1;
  /** 0xB4 — ctor 1. */
  m_currentZoomRate = 1;
  /** 0xB8 */
  m_zoomRateSmoothVel = 0;
  /** 0x124 — Vector3.SmoothDamp velocity of the look-at point. */
  readonly m_lookAtPosSmoothVel = new THREE.Vector3();
  /** 0xBC — rotate/parallel input axis (z unused; Rotate @00448870). */
  readonly m_destRotateAxis = { x: 0, y: 0 };
  /** 0xC8 */
  readonly m_previousRotateAxis = { x: 0, y: 0 };
  /**
   * 0xF4 — parallel pan offset. FAITHFUL QUIRK: the vertical pan lives in
   * the .z slot (y stays 0) and the input y is sign-flipped — UpdateCamera-
   * Transform @00447eb0 builds (input.x*range.x, 0, −input.y*range.y)
   * (XOR 0x80000000, DAT_00b7ba24 CONFIRMED) and MoveTowards writes 0xF4/0xFC.
   * Applied as a WORLD-space offset via CameraTarget.ForceOffset @0073f420.
   */
  readonly m_currentParallelDelta = { x: 0, z: 0 };
  /** 0xEC */
  m_currentParallelSpeedX = 0;
  /** 0xF0 */
  m_currentParallelSpeedY = 0;
  /** 0x138 */
  m_parallelMoveWaitTimer = 0;
  /** 0x13C — ctor 1. Synced to "stick released while player moving" each frame. */
  m_isParallelReturning = true;
  /**
   * TS ADAPTATION: PlayerMotor.IsInputMoving proxy, fed by follow()'s vel
   * argument (null / zero → not moving). Only gates the parallel re-center.
   */
  m_playerIsInputMoving = false;

  constructor(private readonly target: THREE.Vector3, params: CameraFollowParams = {}) {
    this.minDistance = params.minDistance ?? 30;
    this.maxDistance = params.maxDistance ?? 30;
    this.cameraFollowSmoothTime = params.cameraFollowSmoothTime ?? 0.2;
    this.zoomSpeed = params.zoomSpeed ?? 2;
    this.zoomSmoothTime = params.zoomSmoothTime ?? 0.2;
    this.globalOffset = params.globalOffset ?? { x: 0, y: 0, z: 0 };
    this.parallelMoveRange = params.parallelMoveRange ?? { x: 7.8, y: 5 };
    this.parallelMoveChaseAccer = params.parallelMoveChaseAccer ?? 1000;
    this.parallelMoveChaseSpeed = params.parallelMoveChaseSpeed ?? 10;
    this.parallelMoveReturnAccer = params.parallelMoveReturnAccer ?? 3.5;
    this.parallelMoveReturnSpeed = params.parallelMoveReturnSpeed ?? 5;
    this.postParallelMoveWaitTime = params.postParallelMoveWaitTime ?? 0.17;
    this.parallelMoveResetWhenPlayerMove = params.parallelMoveResetWhenPlayerMove ?? true;
  }

  /** GetCurrentDistance @004473b0 — min + (max − min) * zoomRate. */
  getCurrentDistance(): number {
    return f32(this.minDistance + f32(f32(this.maxDistance - this.minDistance) * this.m_currentZoomRate));
  }

  /**
   * Rotate @00448870 — right-stick pan input (CameraController.Receive-
   * CameraRotateInput @00739890). Sensitivity pref 0 → ×1; invert not ported.
   * The original also blocks this while a UI ring is open — the caller owns
   * that gate (no UI state in the view seam).
   */
  rotate(x: number, y: number): void {
    this.m_destRotateAxis.x = x;
    this.m_destRotateAxis.y = y;
  }

  /** ZoomIn @00448df0 — destZoomRate -= dt*rate*zoomSpeed, floor 0. */
  zoomIn(rate: number, dt: number): void {
    const v = f32(this.m_destZoomRate - f32(f32(dt * rate) * this.zoomSpeed));
    this.m_destZoomRate = f32(Math.max(0, v));
  }

  /** ZoomOut @00448ea0 — destZoomRate += dt*rate*zoomSpeed, cap 1. */
  zoomOut(rate: number, dt: number): void {
    const v = f32(this.m_destZoomRate + f32(f32(dt * rate) * this.zoomSpeed));
    this.m_destZoomRate = f32(Math.min(1, v));
  }

  /** TS ADAPTATION: impulsive wheel zoom → destZoomRate step, clamped [0,1].
   *  The original zoom is hold-button rate input (zoomIn/zoomOut above). */
  setDestZoomRate(rate: number): void {
    this.m_destZoomRate = f32(THREE.MathUtils.clamp(rate, 0, 1));
  }

  /** UpdateZoom @00447b50 — Mathf.SmoothDamp(zoomRate, dest, zoomSmoothTime). */
  updateZoom(dt: number): void {
    if (dt <= 0) return;
    const st = f32(Math.max(0.0001, this.zoomSmoothTime));
    const omega = f32(2 / st);
    const x = f32(omega * dt);
    const exp = f32(1 / f32(f32(f32(1 + x) + f32(f32(0.48 * x) * x)) + f32(f32(f32(0.235 * x) * x) * x)));
    const originalTo = this.m_destZoomRate;
    const current = this.m_currentZoomRate;
    const change = f32(current - originalTo); // maxSpeed ∞ → clamp is a no-op
    const target = f32(current - change);
    const temp = f32(f32(this.m_zoomRateSmoothVel + f32(omega * change)) * dt);
    this.m_zoomRateSmoothVel = f32(f32(this.m_zoomRateSmoothVel - f32(omega * temp)) * exp);
    let out = f32(target + f32(f32(change + temp) * exp));
    if ((originalTo - current > 0) === (out > originalTo)) {
      out = originalTo;
      this.m_zoomRateSmoothVel = 0; // (out − originalTo) / dt
    }
    this.m_currentZoomRate = out;
  }

  /**
   * UpdateCameraTransform @00447eb0, rotateType=ParallelMove block: the
   * pan state machine. Semantics (confirmed against the pseudocode; the
   * vcmpss imm8=0 at 0x4484xx is an EQ test, so the reset gate is
   * "NO pan input && player moving"):
   *  - stick released WHILE the player runs → delta eases back to 0
   *    (return accer 3.5 / speed 5) after the 0.17s grace window;
   *  - stick held (player idle OR running) → delta chases current +
   *    input*range, clamped ±range (chase accer 1000 / speed 10);
   *  - stick released, player idle → delta HOLDS (idle re-center only via
   *    the reset button → snap(), ReceiveResetCameraParallel @00739c40 →
   *    CheckSnapWhileParallelMoving @00448b40).
   * NOTE: the decomp shows MoveTowards(speedX, speed, 0) for the X axis —
   * a lost-register artifact; the symmetric Y call uses accer*dt, so both
   * axes use accer*dt here. During the grace window the previous input
   * axis is kept and both speeds are zeroed each frame (faithful).
   */
  updateParallel(dt: number): void {
    if (dt <= 0) return;
    const ax = this.m_destRotateAxis.x;
    const ay = this.m_destRotateAxis.y;
    const hasInput = ax !== 0 || ay !== 0;
    let axisX = ax;
    let axisY = ay;
    if (!hasInput) {
      this.m_parallelMoveWaitTimer = f32(Math.max(f32(this.m_parallelMoveWaitTimer - dt), 0));
      if (this.m_parallelMoveWaitTimer !== 0) {
        axisX = this.m_previousRotateAxis.x;
        axisY = this.m_previousRotateAxis.y;
        this.m_currentParallelSpeedX = 0;
        this.m_currentParallelSpeedY = 0;
      } else {
        this.m_previousRotateAxis.x = ax;
        this.m_previousRotateAxis.y = ay;
        this.m_isParallelReturning = true;
      }
    } else {
      this.m_previousRotateAxis.x = ax;
      this.m_previousRotateAxis.y = ay;
      this.m_parallelMoveWaitTimer = this.postParallelMoveWaitTime;
      this.m_isParallelReturning = false;
    }
    // bVar8 = (destRotateAxis == 0) && IsInputMoving (when the reset flag is
    // set) — i.e. re-center only once the stick is released mid-run.
    let resetting = !hasInput;
    if (this.parallelMoveResetWhenPlayerMove) resetting = resetting && this.m_playerIsInputMoving;
    if (this.m_isParallelReturning !== resetting) {
      this.m_currentParallelSpeedX = 0;
      this.m_currentParallelSpeedY = 0;
      this.m_isParallelReturning = resetting;
    }
    let desX = 0;
    let desZ = 0;
    if (!resetting) {
      desX = f32(this.m_currentParallelDelta.x + f32(axisX * this.parallelMoveRange.x));
      desZ = f32(this.m_currentParallelDelta.z - f32(axisY * this.parallelMoveRange.y));
    }
    desX = THREE.MathUtils.clamp(desX, -this.parallelMoveRange.x, this.parallelMoveRange.x);
    desZ = THREE.MathUtils.clamp(desZ, -this.parallelMoveRange.y, this.parallelMoveRange.y);
    const accer = this.m_isParallelReturning ? this.parallelMoveReturnAccer : this.parallelMoveChaseAccer;
    const speed = this.m_isParallelReturning ? this.parallelMoveReturnSpeed : this.parallelMoveChaseSpeed;
    this.m_currentParallelSpeedX = moveTowards(this.m_currentParallelSpeedX, speed, f32(accer * dt));
    this.m_currentParallelSpeedY = moveTowards(this.m_currentParallelSpeedY, speed, f32(accer * dt));
    this.m_currentParallelDelta.x = moveTowards(this.m_currentParallelDelta.x, desX, f32(dt * this.m_currentParallelSpeedX));
    this.m_currentParallelDelta.z = moveTowards(this.m_currentParallelDelta.z, desZ, f32(dt * this.m_currentParallelSpeedY));
  }

  /**
   * GetDesiredLookatTarget @004469b0 + UpdateTargetLookAt @00447c00.
   * pos/vel are three-space (mirrored). vel is NOT a look-ahead (the original
   * has none) — it only feeds the IsInputMoving proxy for the parallel gate.
   * No panBounds clamp: the original top-down camera never clamps the target
   * to stage bounds (CameraHelper is behind-cam occlusion/angle utils only).
   */
  follow(pos: { x: number; y: number; z: number }, vel: { x: number; z: number } | null, dt: number): void {
    this.m_playerIsInputMoving = vel !== null && (vel.x !== 0 || vel.z !== 0);
    if (dt <= 0) return;
    const rate = this.m_currentZoomRate;
    const go = this.globalOffset;
    // desired = (playerPos + forcedOffset + globalOffset) * zoomRate.
    // FAITHFUL QUIRK: the whole world position is scaled by zoomRate (pulls
    // the focus toward the world origin when zooming "in"); with the
    // serialized min == max == 30 this is the ONLY effect of zoom besides
    // the follow-smoothTime scaling below.
    const dx = f32(f32(f32(pos.x + this.m_currentParallelDelta.x) + go.x) * rate);
    const dy = f32(f32(pos.y + go.y) * rate);
    const dz = f32(f32(f32(pos.z + this.m_currentParallelDelta.z) + go.z) * rate);
    // smoothTime = Max(zoomRate, 0.1) * cameraFollowSmoothTime (DAT_00b7b6d0=0.1)
    const st = f32(f32(Math.max(rate, 0.1)) * this.cameraFollowSmoothTime);
    this.smoothDampTo(dx, dy, dz, st, dt);
  }

  /**
   * Snap @00446760 / CheckSnapWhileParallelMoving @00448b40 — zero parallel
   * state + smooth velocities and snap the look-at to the desired point.
   * With pos omitted, only the state is cleared (target kept).
   */
  snap(pos?: { x: number; y: number; z: number }): void {
    this.m_currentParallelDelta.x = 0;
    this.m_currentParallelDelta.z = 0;
    this.m_currentParallelSpeedX = 0;
    this.m_currentParallelSpeedY = 0;
    this.m_parallelMoveWaitTimer = 0;
    this.m_destRotateAxis.x = 0;
    this.m_destRotateAxis.y = 0;
    this.m_previousRotateAxis.x = 0;
    this.m_previousRotateAxis.y = 0;
    this.m_lookAtPosSmoothVel.set(0, 0, 0);
    if (pos !== undefined) {
      const rate = this.m_currentZoomRate;
      this.target.set(f32(pos.x * rate), f32(pos.y * rate), f32(pos.z * rate));
    }
  }

  /**
   * Unity Vector3.SmoothDamp (UnityCsReference, Game Programming Gems 4
   * ch. 1.10), fp32. maxSpeed = Infinity and deltaTime = dt — the decomp
   * passes the defaults (0 args). Mutates target + m_lookAtPosSmoothVel.
   */
  private smoothDampTo(tx: number, ty: number, tz: number, smoothTime: number, dt: number): void {
    const cur = this.target;
    const vel = this.m_lookAtPosSmoothVel;
    const st = f32(Math.max(0.0001, smoothTime));
    const omega = f32(2 / st);
    const x = f32(omega * dt);
    const exp = f32(1 / f32(f32(f32(1 + x) + f32(f32(0.48 * x) * x)) + f32(f32(f32(0.235 * x) * x) * x)));
    // change = current − target; ClampMagnitude(maxSpeed*smoothTime) is a
    // no-op at maxSpeed = Infinity.
    const cx = f32(cur.x - tx);
    const cy = f32(cur.y - ty);
    const cz = f32(cur.z - tz);
    const gx = f32(cur.x - cx);
    const gy = f32(cur.y - cy);
    const gz = f32(cur.z - cz);
    const tempx = f32(f32(vel.x + f32(omega * cx)) * dt);
    const tempy = f32(f32(vel.y + f32(omega * cy)) * dt);
    const tempz = f32(f32(vel.z + f32(omega * cz)) * dt);
    vel.x = f32(f32(vel.x - f32(omega * tempx)) * exp);
    vel.y = f32(f32(vel.y - f32(omega * tempy)) * exp);
    vel.z = f32(f32(vel.z - f32(omega * tempz)) * exp);
    let ox = f32(gx + f32(f32(cx + tempx) * exp));
    let oy = f32(gy + f32(f32(cy + tempy) * exp));
    let oz = f32(gz + f32(f32(cz + tempz) * exp));
    // Prevent overshooting: dot(originalTo − current, output − originalTo) > 0
    const dpx = f32(tx - cur.x);
    const dpy = f32(ty - cur.y);
    const dpz = f32(tz - cur.z);
    const dot = f32(f32(f32(dpx * f32(ox - tx)) + f32(dpy * f32(oy - ty))) + f32(dpz * f32(oz - tz)));
    if (dot > 0) {
      ox = tx;
      oy = ty;
      oz = tz;
      vel.set(0, 0, 0); // (output − originalTo) / deltaTime
    }
    cur.set(ox, oy, oz);
  }
}
