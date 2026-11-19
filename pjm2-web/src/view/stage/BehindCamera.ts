// src/view/stage/BehindCamera.ts
// Port of Q4.GameCameraBehind (the third-person "behind" camera the player toggles to with CameraManager's `camera_switch` input) and its
// DepthOfField focus animation. PURE logic in UNITY space (left-handed, y up, no three.js): the caller mirrors x when it drives a camera.
// See docs/CAMERA_ANALYSIS.md for the function-by-function mapping. Source addresses are RVAs of Il2CppUserAssemblies.elf.
//
//   Update @0043ede0:  UpdatePosition (UpdateRotateVector @0043f470, UpdateTargetLookAtPosition @0043f860, UpdateZoom, occlusion, UpdateCameraPosition @004401e0-)
//                      -> UpdateRotation @0043eff0 (UpdateManualRotation, UpdatePlayerIdle, UpdateAutoRotation @004402e0) -> UpdateDepthOfField @0043f0d0
//   Camera position  = smoothLookAt + Quaternion.Euler(-pitch, -yaw, 0) * (0, 0, -distance);  rotation = LookRotation(lookAt - position)
//   (m_currentEuler @0x148: .x = yaw, .y = pitch.)
//
// Serialized values (stage scene GameCameraBehind MonoBehaviour, identical in every stage checked): BEHIND_PARAMS below.
// NOT ported: camera occlusion (GetOccludeDistance / ClampTracing / CameraTarget.occluding / hideBlockingTrees) -- the port has no per-frame
// camera-vs-world linecast; the boom is the fixed 1.75 m (distanceMin == distanceMax == defaultDistance in the shipped data, so zoom is inert too).

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export interface V3 { x: number; y: number; z: number }

/** GameCameraBehind serialized fields (offsets in comments are the IL2CPP field offsets). */
export interface BehindParams {
  offset: V3; // 0x50 TransformPoint(offset) of the player
  followInAir: boolean; // 0x5c
  autoDepthOfField: boolean; // 0x5d
  autoDOFDistanceMin: number; // 0x60
  autoDOFDistanceMax: number; // 0x64
  autoDOFFocusMin: number; // 0x68
  autoDOFFocusMax: number; // 0x6c  (-1 = DoF untouched, DAT_00b7b658)
  dofFocusForwardDelta: number; // 0x84
  dofFocusForwardSpeed: number; // 0x88
  dofFocusForwardFOVDelta: number; // 0x8c
  dofFocusForwardFOVSpeed: number; // 0x90
  cameraRotateAcceleration: number; // 0x94
  cameraRotateSpeedH: number; // 0x98
  cameraRotateSpeedV: number; // 0x9c
  overRotateLimit: number; // 0xa0
  overRotateBackSpeed: number; // 0xa4
  allowZoom: boolean; // 0xa8
  distanceMin: number; // 0xac
  distanceMax: number; // 0xb0
  defaultDistance: number; // 0xb4
  viewLimitMin: number; // 0xbc
  viewLimitMax: number; // 0xc0
  defaultViewAngle: number; // 0xc4
  cameraFollowSmoothTimeH: number; // 0xc8
  cameraFollowSmoothTimeV: number; // 0xcc
  zoomSpeed: number; // 0xd0
  autoCorrectRotation: boolean; // 0xd4
  autoRotateThreshold: number; // 0xd8
  autoRotateSpeed: number; // 0xdc
  autoRotateAcceleration: number; // 0xe0
  autoRotateSpeedNoInput: number; // 0xe4
  autoRotateAccelerationNoInput: number; // 0xe8
  autoRotateSinceIdleTime: number; // 0xec
  baseFOV: number; // 0x188 (Camera.fieldOfView of the GameCameraBehind node)
}

/** Decoded from `BuildPlayer-fps_check_3d_stage_001_env` (MonoBehaviour pid 8052, camera fov 50). */
export const BEHIND_PARAMS: BehindParams = {
  offset: { x: 0, y: 0.800000011920929, z: 0 },
  followInAir: true,
  autoDepthOfField: true,
  autoDOFDistanceMin: 2, autoDOFDistanceMax: 5, autoDOFFocusMin: 2, autoDOFFocusMax: 5,
  dofFocusForwardDelta: 20, dofFocusForwardSpeed: 80, dofFocusForwardFOVDelta: -5, dofFocusForwardFOVSpeed: 20,
  cameraRotateAcceleration: 3.5, cameraRotateSpeedH: 120, cameraRotateSpeedV: 90,
  overRotateLimit: 25, overRotateBackSpeed: 30,
  allowZoom: true, distanceMin: 1.75, distanceMax: 1.75, defaultDistance: 1.75,
  viewLimitMin: -15, viewLimitMax: 15, defaultViewAngle: 0,
  cameraFollowSmoothTimeH: 0.15000000596046448, cameraFollowSmoothTimeV: 0.30000001192092896, zoomSpeed: 5,
  autoCorrectRotation: true, autoRotateThreshold: 45, autoRotateSpeed: 50, autoRotateAcceleration: 4,
  autoRotateSpeedNoInput: 5, autoRotateAccelerationNoInput: 1, autoRotateSinceIdleTime: 3,
  baseFOV: 50,
};

/** Hard-coded constants read from the native code (rodata @0xb7b650..0xb7b698). */
export const BEHIND_CONST = {
  /** UpdateRotateVector clamps the pitch to [-90, 90] regardless of the serialized limits (DAT_00b7b66c/b670). */
  absPitchLimit: 90,
  /** UpdateAutoRotation: angle folding pivot (90) / mirror (180); signed angle clamp +-75 (DAT_00b7b684/b688). */
  autoAngleFold: 90, autoAngleMirror: 180, autoAngleClamp: 75,
  /** HorizontallySnapToPlayer turn speed deg/s (DAT_00b7b654). */
  snapTurnSpeed: 90,
} as const;

// ---- Unity math ---------------------------------------------------------------------------------------------------------------------------

export function moveTowards(cur: number, target: number, maxDelta: number): number {
  if (Math.abs(target - cur) <= maxDelta) return target;
  return cur + Math.sign(target - cur) * maxDelta;
}

/** Mathf.DeltaAngle */
export function deltaAngle(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360; else if (d < -180) d += 360;
  return d;
}

/** Mathf.MoveTowardsAngle */
export function moveTowardsAngle(cur: number, target: number, maxDelta: number): number {
  const d = deltaAngle(cur, target);
  if (-maxDelta < d && d < maxDelta) return target;
  return moveTowards(cur, cur + d, maxDelta);
}

/** Q4.CameraHelper.ClampAngle: wrap to [-180,180] then clamp. */
export function clampAngle(angle: number, min: number, max: number): number {
  let a = angle % 360;
  if (a > 180) a -= 360; else if (a < -180) a += 360;
  return Math.min(max, Math.max(min, a));
}

/** Unity Mathf.SmoothDamp (maxSpeed = infinity). `vel` is a one-element holder so callers keep the state. */
export function smoothDamp(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * e;
  let out = target + (change + temp) * e;
  if (target - current > 0 === out > target) { out = target; vel.v = dt > 0 ? (out - target) / dt : 0; }
  return out;
}

/** Unity Vector3.SmoothDamp (maxSpeed = infinity), vector-level overshoot test like the engine. */
export function smoothDampV3(current: V3, target: V3, vel: V3, smoothTime: number, dt: number): V3 {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = current.x - target.x, cy = current.y - target.y, cz = current.z - target.z;
  const tx = (vel.x + omega * cx) * dt, ty = (vel.y + omega * cy) * dt, tz = (vel.z + omega * cz) * dt;
  vel.x = (vel.x - omega * tx) * e; vel.y = (vel.y - omega * ty) * e; vel.z = (vel.z - omega * tz) * e;
  const out = { x: target.x + (cx + tx) * e, y: target.y + (cy + ty) * e, z: target.z + (cz + tz) * e };
  const ox = target.x - current.x, oy = target.y - current.y, oz = target.z - current.z;
  if (ox * (out.x - target.x) + oy * (out.y - target.y) + oz * (out.z - target.z) > 0) {
    out.x = target.x; out.y = target.y; out.z = target.z;
    if (dt > 0) { vel.x = 0; vel.y = 0; vel.z = 0; }
  }
  return out;
}

// ---- DoF focus (UpdateDepthOfField @0043f0d0) ---------------------------------------------------------------------------------------------

export interface DofFocusState {
  /** 0x184 m_dofFocusForward: metres added to the focus distance, 0..dofFocusForwardDelta. */
  focusForward: number;
  /** 0x190 m_dofFocusForwardFOV: degrees added to the base FOV, between 0 and dofFocusForwardFOVDelta. */
  fovOffset: number;
  /** 0x180 / 0x18c: the FocusForward input factor (2 * (axis - 0.5), i.e. -1..1; DAT_00b7b698 = -0.5). */
  factor: number;
}

/**
 * One UpdateDepthOfField step. Returns the PostProcessing `focusDistance` (and the new FOV) the original writes into the
 * DepthOfFieldModel settings / Camera.fieldOfView. Returns null when `autoDOFFocusMax == -1` (the original leaves DoF untouched then).
 *   focusForward = clamp(focusForward + speed * factor * dt, 0, delta)
 *   fovOffset    = clamp(fovOffset + sin(pi/2 * t) * fovSpeed * sign * factor * dt, min(fovDelta,0), max(fovDelta,0))
 *                  t = |(fovDelta - fovOffset)/fovDelta| (factor >= 0), else 1 - t;  sign = fovDelta > 0 ? +1 : -1
 *   k            = clamp((currentDistance - distMin) / (distMax - distMin), 0, 1)
 *   focus        = (autoDepthOfField ? focusMin + k * (focusMax - focusMin) : focusMax) + focusForward
 */
export function updateDofFocus(p: BehindParams, st: DofFocusState, currentDistance: number, dt: number): { focusDistance: number; fov: number } | null {
  if (p.autoDOFFocusMax === -1) return null;
  st.focusForward = Math.min(p.dofFocusForwardDelta, Math.max(0, st.focusForward + p.dofFocusForwardSpeed * st.factor * dt));
  const d = p.dofFocusForwardFOVDelta;
  const lo = Math.min(d, 0), hi = Math.max(d, 0);
  const sign = d > 0 ? 1 : -1;
  let t = d === 0 ? 0 : Math.abs((d - st.fovOffset) / d);
  if (!(st.factor >= 0)) t = 1 - t;
  const step = Math.sin(t * (Math.PI / 2)) * p.dofFocusForwardFOVSpeed * sign * st.factor * dt;
  st.fovOffset = Math.min(hi, Math.max(lo, st.fovOffset + step));
  const range = p.autoDOFDistanceMax - p.autoDOFDistanceMin;
  const k = Math.min(1, Math.max(0, range === 0 ? 0 : (currentDistance - p.autoDOFDistanceMin) / range));
  const base = p.autoDepthOfField ? p.autoDOFFocusMin + k * (p.autoDOFFocusMax - p.autoDOFFocusMin) : p.autoDOFFocusMax;
  return { focusDistance: base + st.focusForward, fov: p.baseFOV + st.fovOffset };
}

// ---- the camera ---------------------------------------------------------------------------------------------------------------------------

/** What the camera needs to know about the player each frame (Unity space). */
export interface BehindTarget {
  pos: V3;
  /** Flat unit facing (Transform.forward with y dropped). */
  forward: { x: number; z: number };
  /** PlayerMotor.IsInputMoving */
  inputMoving: boolean;
  /** Flat world direction of the stick this frame (zero when idle): TransformDirection(CurrentInputVector). */
  inputDir: { x: number; z: number };
  grounded: boolean;
}

export interface BehindPose {
  position: V3;
  lookAt: V3;
  fov: number;
  /** DepthOfFieldModel focusDistance for this frame (null = leave the profile alone). */
  focusDistance: number | null;
  /** Camera yaw in degrees as a Unity forward angle: forward = (sin a, cos a); input mapping uses it. */
  forwardYawRad: number;
}

export class BehindCamera {
  readonly params: BehindParams;
  /** m_currentEuler: x = yaw, y = pitch (degrees). */
  yaw = 0;
  pitch = 0;
  distance: number; // 0x174 m_preOccludeDistance (== 0x178 current distance: no occlusion port)
  readonly dof: DofFocusState = { focusForward: 0, fovOffset: 0, factor: 0 };
  private readonly rotateTarget = { x: 0, y: 0 }; // m_rotateVector (0x13c)
  private readonly rotateCur = { x: 0, y: 0 }; // m_currentRotateVector (0x130)
  private lookAt: V3 = { x: 0, y: 0, z: 0 }; // 0x154
  private readonly lookVel: V3 = { x: 0, y: 0, z: 0 }; // 0x160
  private readonly lookVelV = { v: 0 }; // 0x16c
  private lastGround: V3 = { x: 0, y: 0, z: 0 }; // 0x19c
  private idleTimer = 0; // 0x1a8
  private autoSpeed = 0; // 0x198
  private zoomFactor = 0; // 0x17c
  private fovNow: number;
  private lastDofFocus: number | null = null;
  /** CurrentInputVector memory: the original reads the player's current input vector, which keeps its last direction while idle. APPROXIMATION. */
  private lastInput = { x: 0, z: 0 };

  constructor(params: BehindParams = BEHIND_PARAMS) {
    this.params = { ...params, offset: { ...params.offset } };
    this.distance = params.defaultDistance;
    this.pitch = params.defaultViewAngle;
    this.fovNow = params.baseFOV;
  }

  /** CameraController.ReceiveCameraRotateInput -> Rotate @00440f50: stick (x right+, y up+), -1..1. */
  setRotateInput(x: number, y: number): void { this.rotateTarget.x = x; this.rotateTarget.y = y; }
  /** FocusForward @00441010: axis 0..1 -> factor = 2 * (axis - 0.5). */
  focusForward(axis01: number): void { this.dof.factor = 2 * (axis01 - 0.5); }
  /** ZoomIn/ZoomOut @00440fd0: only when allowZoom (inert with the shipped distanceMin == distanceMax). */
  zoom(amount: number): void { if (this.params.allowZoom) this.zoomFactor = amount; }

  /** Snap @0043e810: place the look-at on the target instantly (and re-arm smoothing). */
  snap(t: BehindTarget): void {
    this.lookAt = this.targetPoint(t);
    this.lookVel.x = this.lookVel.y = this.lookVel.z = 0;
    this.lookVelV.v = 0;
    this.lastGround = { ...this.lookAt };
  }

  /** SetupCamera @0043e960: the pitch starts at defaultViewAngle. */
  resetAngles(): void { this.pitch = this.params.defaultViewAngle; this.rotateCur.x = this.rotateCur.y = 0; this.autoSpeed = 0; this.idleTimer = 0; }

  /** ForceToPlayerBack @0043e660 (InheritCamera when not occluded): turn the boom so the camera looks along the player's facing. */
  forceToPlayerBack(t: BehindTarget): void {
    this.yaw += signedAngleDeg(this.flatForward(), t.forward);
  }

  private flatForward(): { x: number; z: number } {
    const a = -this.yaw * RAD;
    return { x: Math.sin(a), z: Math.cos(a) };
  }

  private targetPoint(t: BehindTarget): V3 {
    // Transform.TransformPoint(offset): the offset is (0, 0.8, 0) so the player's yaw does not matter.
    return { x: t.pos.x + this.params.offset.x, y: t.pos.y + this.params.offset.y, z: t.pos.z + this.params.offset.z };
  }

  /**
   * Update @0043ede0. dt seconds. Returns the pose to render this frame.
   * `distanceMaxOverride` / `viewLimitMinOverride` serve the BlackInOut switch-out animation (it rewrites those fields on the camera).
   */
  update(dt: number, t: BehindTarget): BehindPose {
    const p = this.params;
    // -- UpdatePosition: UpdateRotateVector @0043f470
    const target = { x: this.rotateTarget.x, y: this.rotateTarget.y };
    const curMag = Math.hypot(this.rotateCur.x, this.rotateCur.y);
    {
      const dx = target.x - this.rotateCur.x, dy = target.y - this.rotateCur.y;
      const dist = Math.hypot(dx, dy);
      const maxD = dt * p.cameraRotateAcceleration;
      if (dist <= maxD || dist === 0) { this.rotateCur.x = target.x; this.rotateCur.y = target.y; }
      else { this.rotateCur.x += (dx / dist) * maxD; this.rotateCur.y += (dy / dist) * maxD; }
      this.rotateCur.y = target.y; // 0x134 = 0x140: the vertical component follows the input immediately
    }
    const over = p.overRotateLimit;
    this.yaw += this.rotateCur.x * p.cameraRotateSpeedH * dt;
    {
      const lo = p.viewLimitMin, hi = p.viewLimitMax;
      const tt = (this.pitch - (lo - over)) / (over + over + (hi - lo));
      const shape = Math.sin((this.rotateCur.y < 0 ? tt : 1 - tt) * (Math.PI / 2));
      this.pitch += shape * this.rotateCur.y * p.cameraRotateSpeedV * dt;
      if (target.y === 0 && (this.pitch > hi || this.pitch < lo)) {
        // over-rotate return (approximation of the Nullable<float> branch: ease back to the nearest limit)
        const limit = this.pitch > hi ? hi : lo;
        const back = Math.sin((Math.abs(this.pitch - limit) / over) * (Math.PI / 2)) * dt * p.overRotateBackSpeed;
        this.pitch += this.pitch > hi ? -back : back;
      }
      this.pitch = clampAngle(this.pitch, Math.max(lo - over, -BEHIND_CONST.absPitchLimit), Math.min(hi + over, BEHIND_CONST.absPitchLimit));
    }
    // -- UpdateTargetLookAtPosition @0043f860
    const live = this.targetPoint(t);
    if (t.grounded) this.lastGround = { ...live };
    const goal: V3 = p.followInAir ? live : { x: live.x, y: this.lastGround.y, z: live.z };
    this.lookAt = smoothDampV3(this.lookAt, goal, this.lookVel, p.cameraFollowSmoothTimeH, dt);
    if (p.followInAir) this.lookAt.y = smoothDamp(this.lookAt.y, goal.y, this.lookVelV, p.cameraFollowSmoothTimeV, dt);
    // -- UpdateZoom / UpdatePosition: distance = clamp(distance + zoomFactor * dt * zoomSpeed, min, max)
    this.distance = Math.min(p.distanceMax, Math.max(p.distanceMin, this.distance + this.zoomFactor * dt * p.zoomSpeed));
    this.zoomFactor = 0;
    // -- UpdateCameraPosition: lookAt + Euler(-pitch, -yaw, 0) * (0, 0, -distance)
    const pr = -this.pitch * RAD, yr = -this.yaw * RAD;
    const fwd = { x: Math.sin(yr) * Math.cos(pr), y: -Math.sin(pr), z: Math.cos(yr) * Math.cos(pr) };
    const position: V3 = { x: this.lookAt.x - fwd.x * this.distance, y: this.lookAt.y - fwd.y * this.distance, z: this.lookAt.z - fwd.z * this.distance };
    const forwardYawRad = yr;

    // -- UpdateRotation @0043eff0: manual rotation = LookRotation(lookAt - position) (caller), then the idle timer + auto rotation
    if (p.autoCorrectRotation) {
      this.updatePlayerIdle(dt, t, curMag);
      if (curMag <= 0) this.updateAutoRotation(dt, t);
    }
    // -- UpdateDepthOfField @0043f0d0
    const dof = updateDofFocus(p, this.dof, this.distance, dt);
    if (dof !== null) { this.fovNow = dof.fov; this.lastDofFocus = dof.focusDistance; }
    return { position, lookAt: { ...this.lookAt }, fov: this.fovNow, focusDistance: this.lastDofFocus, forwardYawRad };
  }

  private saved: { viewLimitMin: number; distanceMax: number; pitch: number; distance: number; offset: V3 } | null = null;

  /**
   * GameCameraSwitchBlackInOut.SwitchOut @00445... (camTransformChange): remember viewLimitMin / distanceMax / pitch / distance / offset
   * (m_previous* fields) because the switch-out animation rewrites them and the end of the switch restores them.
   */
  beginSwitchOut(): void {
    const p = this.params;
    this.saved = { viewLimitMin: p.viewLimitMin, distanceMax: p.distanceMax, pitch: this.pitch, distance: this.distance, offset: { ...p.offset } };
  }

  /**
   * UpdateSwitching @004455e0 (outgoing Behind camera, camTransformChange): each frame viewLimitMin = -90 (0xc2b40000), distanceMax = 100
   * (0x42c80000), a rotate input (0, -rotateOutSpeedScale) (the camera swings up over the player), ZoomOut(zoomOutSpeedScale) and
   * offset.y += dt * offsetUpSpeedScale.
   */
  switchOutStep(dt: number, rotateScale: number, zoomScale: number, offsetUpScale: number): void {
    const p = this.params;
    p.viewLimitMin = -90;
    p.distanceMax = 100;
    this.setRotateInput(0, -rotateScale);
    this.zoomFactor = zoomScale; // ZoomOut bypasses nothing: allowZoom is true in the shipped data
    p.offset.y += dt * offsetUpScale;
  }

  /** End of the switch (@00445.. restore block): the saved values go back so the next switch to Behind starts from them. */
  endSwitchOut(): void {
    if (this.saved === null) return;
    const p = this.params;
    p.viewLimitMin = this.saved.viewLimitMin;
    p.distanceMax = this.saved.distanceMax;
    p.offset = this.saved.offset;
    this.pitch = this.saved.pitch;
    this.distance = this.saved.distance;
    this.saved = null;
    this.setRotateInput(0, 0);
    this.rotateCur.x = this.rotateCur.y = 0;
    this.zoomFactor = 0;
  }

  /** UpdatePlayerIdle @004401e0: the timer runs while the player is not moving and no manual rotation is active. */
  private updatePlayerIdle(dt: number, t: BehindTarget, curMag: number): void {
    if (!t.inputMoving && curMag === 0) this.idleTimer += dt; else this.idleTimer = 0;
  }

  /** UpdateAutoRotation @004402e0 (see CAMERA_ANALYSIS.md): swing the camera behind the player when walking sideways / after idling. */
  private updateAutoRotation(dt: number, t: BehindTarget): void {
    const p = this.params;
    const manualZero = this.rotateTarget.x === 0 && this.rotateTarget.y === 0;
    const proceed = manualZero ? (this.idleTimer > p.autoRotateSinceIdleTime || t.inputMoving) : this.idleTimer > p.autoRotateSinceIdleTime;
    if (!proceed) { this.autoSpeed = 0; return; }
    const cam = this.flatForward();
    if (Math.hypot(t.inputDir.x, t.inputDir.z) > 0) this.lastInput = { x: t.inputDir.x, z: t.inputDir.z };
    const inLen = Math.hypot(this.lastInput.x, this.lastInput.z);
    let rotating = false;
    if (inLen > 0) {
      let ang = angleBetween(cam, this.lastInput);
      if (ang > BEHIND_CONST.autoAngleFold) ang = BEHIND_CONST.autoAngleMirror - ang;
      rotating = p.autoRotateThreshold < ang;
    }
    const raw = signedAngleDeg(cam, t.forward);
    const clamped = Math.min(BEHIND_CONST.autoAngleClamp, Math.max(-BEHIND_CONST.autoAngleClamp, raw));
    const idle = this.idleTimer > p.autoRotateSinceIdleTime;
    const speed = idle ? p.autoRotateSpeedNoInput : p.autoRotateSpeed;
    const accel = idle ? p.autoRotateAccelerationNoInput : p.autoRotateAcceleration;
    const goal = rotating ? (clamped / BEHIND_CONST.autoAngleClamp) * speed * dt : 0;
    this.autoSpeed = moveTowards(this.autoSpeed, goal, accel * dt);
    if (dt > 0) this.yaw += this.autoSpeed;
  }
}

/** Angle in degrees between two flat vectors (Vector3.Angle). */
export function angleBetween(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const la = Math.hypot(a.x, a.z), lb = Math.hypot(b.x, b.z);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, (a.x * b.x + a.z * b.z) / (la * lb)));
  return Math.acos(c) * DEG;
}

/**
 * The signed step used by ForceToPlayerBack / UpdateAutoRotation: Angle(cam, player) * (cross(cam, player).y < 0 ? +1 : -1) -- table
 * DAT_00b7bb58 / b7bb68 = {-1, +1}. Added to yaw (m_currentEuler.x) it swings the camera's forward onto the player's forward.
 */
export function signedAngleDeg(cam: { x: number; z: number }, player: { x: number; z: number }): number {
  const ang = angleBetween(cam, player);
  const crossY = cam.z * player.x - cam.x * player.z; // (cam x player).y for flat vectors (Unity LH cross, y component)
  return ang * (crossY < 0 ? 1 : -1);
}
