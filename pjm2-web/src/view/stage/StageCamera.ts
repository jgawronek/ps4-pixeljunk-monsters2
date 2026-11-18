// src/view/stage/StageCamera.ts
// PJM2 gameplay camera rig (view layer): fixed-yaw, fixed-pitch perspective
// boom over the playfield, SmoothDamp player follow, wheel zoom, dev panning.
//
// DEFAULTS ARE EVIDENCE-BASED (serialized stage camera WINS over decompiled
// ctor defaults). Source: public/assets/stages/3d_stage_001/scene-webp.json
// node 889 "GameCameraTopDown(Real)" (GameObject pathId 176, transformPathId
// 2581, parent 888 "CameraRoot" identity), read from the shipped `stages`
// bundle file BuildPlayer-3d_stage_001_env:
//   - transform rot quat (≈0, 0.92388, −0.38268, ≈0) = Unity Euler
//     (pitch 45°, yaw 180°, 0) → forward (0, −√2/2, −√2/2). Under the port's
//     LH→RH x-mirror (StageSceneView.ts) forward x=0 is unchanged, so the
//     boom sits on the target's +Z side: pitchDeg 45, yawDeg 0 below.
//     Serialized pos (0, 22, 30.59) is editor placement; runtime distance is
//     min/maxDistance-driven (30), direction is transform.forward
//     (InitParameters @004463b0 → m_centerDirection 0x100).
//   - Camera component pathId 4810: fieldOfView 22.5, near 0.3, far 1000.
//   - GameCameraTopDown MonoBehaviour pathId 8192: minDistance 30,
//     maxDistance 30 (FIXED boom — the original stage has no distance zoom),
//     cameraFollowSmoothTime 0.2, zoomSmoothTime 0.2, zoomSpeed 2,
//     rotateType ParallelMove, parallelMoveRange (7.8, 5).
// See CameraFollow.ts for the follow/zoom/parallel port and full citations.
//
// DELTA vs the previous hand-tuned rig (evidence wins):
//   fov 45→22.5, pitch 55→45, yaw 140→0, distance 40→30, min 14→30, max 75→30,
//   near 0.5→0.3, far 400→1000, edgeMargin 24→0, keyboardPan true→false.
//   The old 55° pitch / 140° yaw were guesses from the sun direction; the
//   serialized camera proves an axis-aligned 45° top-down view.
//
// FOLLOW: call follow(playerPos, vel, dt) each frame (Unity SmoothDamp,
// smoothTime = max(zoomRate, 0.1) * 0.2). The decomp shows NO velocity
// look-ahead and NO deadzone — do not add any. vel only gates the original
// parallel-pan re-center (PlayerMotor.IsInputMoving proxy). The legacy
// external-lerp path (mutate .target, then update(dt)) still works.
//
// PAN: the original pans ONLY via gamepad right stick (CameraController.
// ReceiveCameraRotateInput @00739890 → Rotate → parallel-move state machine,
// ±7.8 x / ±5 z world offset around the player). There is NO pointer-edge or
// keyboard pan in the original, so edgeMargin/keyboardPan default OFF; the
// dev stage-viewer opts in:
//   new StageCamera({ keyboardPan: true, edgeMargin: 24,
//                     minDistance: 14, maxDistance: 75 })
// panBounds clamps only that dev manual pan — follow() is never clamped
// (the original top-down camera has no stage-bounds clamp; CameraHelper.c
// is behind-camera occlusion/angle utilities only).
//
// FOLLOW-UPS (documented, not implemented):
//   - Intro sweep: GameCameraIntro01/02 (scene nodes 1904/1906, pathIds
//     847/989, fov 60/20) are ANIMATOR-driven clips; GameCameraIntro.Update
//     @004434f0 only waits for normalizedTime ≥ 1.0 (DAT_00b7b6a4 CONFIRMED)
//     then SwitchCameraTo the next sibling. Needs the animation clips.
//   - Game-over framing: node 896 (pathId 1314) pos (7.94, −1.537, 14.72),
//     fov 50, Animator-driven; GameCameraGameOver.c is singleton plumbing
//     only. Kill-cam: GameCameraGameOverKill nodes 898/899 + Mono 8191
//     (fade 0.15s, focus 2s, moveSpeed 10; kill variant 0.1/3/50).
//   - Behind view: node 891 (pathId 1010) fov 50, pitch 45° facing +Z,
//     Mono 8446: distance fixed 1.75, view limits ±15°, follow smooth
//     H 0.15 / V 0.3, occlusion + auto-DOF (Q4.GameCameraBehind.c, 2300 lines).
//   - Shake: GameCameraTopDown.<Shake>c__Iterator0 @00448f80 — vertical bob
//     of lookAt.y, amplitude |shakeHeight| * remaining/total cycles,
//     MoveTowards at speed decay*shakeSpeed, direction sign(shakeHeight).
//   - CameraScaler.LateUpdate @0073ed90 swaps its GameObject localScale
//     between two serialized Vector3s when the active camera is
//     GameCameraBehind (character-scale trick, ctor scales (1,1,1)); not a
//     distance-vs-speed rule and not applicable to the top-down rig.
//
// All math here is plain view-layer three.js — no sim data flows through
// this (the ported Unity fp32 formulas live in CameraFollow.ts).

import * as THREE from 'three';
import { CameraFollow, type CameraFollowParams } from './CameraFollow';

/** Map screen-space input (ix = right+, iz = up/into-screen+) to a normalized
 *  UNITY-space ground direction for a camera at `yawDeg`. Camera ground basis
 *  in THREE space (see updatePose): right = (cos y, −sin y), forward =
 *  (−sin y, −cos y) in (x,z); three→unity mirrors x. Pure + Node-testable so
 *  WASD/joystick always match the view orientation at any yaw. */
export function screenInputToUnity(ix: number, iz: number, yawDeg: number): { x: number; z: number } {
  const len = Math.hypot(ix, iz);
  if (len === 0) return { x: 0, z: 0 };
  const nx = ix / len, nz = iz / len;
  const y = (yawDeg * Math.PI) / 180;
  const sin = Math.sin(y), cos = Math.cos(y);
  const tx = nx * cos + nz * -sin; // three x
  const tz = nx * -sin + nz * -cos; // three z
  return { x: -tx, z: tz }; // mirror x → unity
}

export interface StageCameraOptions {
  /** Vertical fov. Default 22.5 — Camera component pathId 4810. */
  fov?: number;
  /** Camera pitch above the ground plane, degrees. Default 45 — node 889 quat. */
  pitchDeg?: number;
  /** Boom azimuth in three-space, degrees (camera pos = target +
   *  (sin yaw, ·, cos yaw) * horizontal). Default 0 — Unity yaw 180° mirrored. */
  yawDeg?: number;
  /** Initial boom distance. Default 30 — Mono pathId 8192 minDistance. */
  distance?: number;
  /** Zoom limits. Default 30/30 (FIXED boom, faithful). The dev viewer can
   *  pass a range (e.g. 14/75) to make wheel zoom change distance. */
  minDistance?: number;
  maxDistance?: number;
  /** Pan clamp (three.js RH space — i.e. already mirrored). Applies to the
   *  dev manual pan ONLY; follow() is unclamped like the original. */
  panBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Dev manual pan speed in world units/sec at distance=30 (scales with
   *  zoom). UNVERIFIED against the original — it has no manual pan. */
  panSpeed?: number;
  /** Screen-edge pan margin in px (0 disables edge pan). Default 0 — the
   *  original has no edge pan (right-stick parallel move only). */
  edgeMargin?: number;
  /** WASD/arrow keyboard panning. Default false — the original has none. */
  keyboardPan?: boolean;
  /** Follow/zoom/parallel tuning overrides (see CameraFollowParams). */
  follow?: CameraFollowParams;
}

export class StageCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Ground-plane focus point the camera orbits (the look-at target). */
  readonly target = new THREE.Vector3(0, 0, 0);
  /** Ported GameCameraTopDown follow/zoom/parallel state (tests/devtools). */
  readonly follower: CameraFollow;

  private readonly pitchDeg: number;
  private readonly yawDeg: number;
  private readonly panBounds: Required<NonNullable<StageCameraOptions['panBounds']>>;
  private readonly panSpeed: number;
  private readonly edgeMargin: number;
  private readonly keyboardPan: boolean;

  private readonly keys = new Set<string>();
  private pointerX = -1;
  private pointerY = -1;
  private dom: HTMLElement | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); };
  private readonly onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly onPointerMove = (e: PointerEvent) => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // TS ADAPTATION: wheel notch → destZoomRate step (original zoom is
    // hold-button rate input, ZoomIn/ZoomOut @00448df0/@00448ea0). With the
    // faithful min == max == 30 this changes follow smoothing/focus scaling
    // but NOT distance — exactly like the original stage.
    this.follower.setDestZoomRate(this.follower.m_destZoomRate + e.deltaY * 0.001);
  };

  constructor(options: StageCameraOptions = {}) {
    this.pitchDeg = options.pitchDeg ?? 45;   // node 889 quat (was 55, hand-tuned)
    this.yawDeg = options.yawDeg ?? 0;        // Unity yaw 180° + x-mirror (was 140)
    const minDistance = options.minDistance ?? 30; // Mono 8192 (was 14)
    const maxDistance = options.maxDistance ?? 30; // Mono 8192 (was 75)
    const distance = options.distance ?? 30;       // Mono 8192 (was 40)
    // Stage baked world bounds after mirror: x −64..66, z −69..68 (see
    // .work/stage-viewer-checks.md); inset a small margin. Dev pan only.
    this.panBounds = options.panBounds ?? { minX: -60, maxX: 62, minZ: -64, maxZ: 64 };
    this.panSpeed = options.panSpeed ?? 28;
    this.edgeMargin = options.edgeMargin ?? 0;      // was 24; original: none
    this.keyboardPan = options.keyboardPan ?? false; // was true; original: none

    this.follower = new CameraFollow(this.target, {
      ...options.follow,
      minDistance: options.follow?.minDistance ?? minDistance,
      maxDistance: options.follow?.maxDistance ?? maxDistance,
    });
    // TS ADAPTATION: derive the initial zoomRate from the distance option
    // (the ctor always starts at rate 1 = maxDistance). rate ∈ [0,1].
    const rate = maxDistance > minDistance
      ? THREE.MathUtils.clamp((distance - minDistance) / (maxDistance - minDistance), 0, 1)
      : 1;
    this.follower.m_destZoomRate = rate;
    this.follower.m_currentZoomRate = rate;

    // Camera pathId 4810: fov 22.5, near 0.3, far 1000 (was 45 / 0.5 / 400).
    this.camera = new THREE.PerspectiveCamera(options.fov ?? 22.5, 1, 0.3, 1000);
    this.updatePose();
  }

  /** Attach input listeners. Edge pan uses pointer position over the window. */
  attach(dom: HTMLElement): void {
    this.dom = dom;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.dom?.removeEventListener('wheel', this.onWheel);
    this.dom = null;
    this.keys.clear();
  }

  /**
   * Faithful gameplay follow (GetDesiredLookatTarget @004469b0 +
   * UpdateTargetLookAt @00447c00): SmoothDamp the look-at toward the player
   * (+ parallel-pan offset), smoothTime = max(zoomRate, 0.1) * 0.2.
   * pos/vel are three-space; vel is NOT look-ahead (the original has none) —
   * pass the player velocity only to gate the parallel-pan re-center, or
   * null. Unclamped by panBounds, like the original. Call update(dt) after.
   */
  follow(pos: { x: number; y: number; z: number }, vel: { x: number; z: number } | null, dt: number): void {
    this.follower.follow(pos, vel, dt);
  }

  /** Right-stick-equivalent parallel pan input (Rotate @00448870), −1..1.
   *  Pans ±7.8 x / ±5 z around the player while held; releasing the stick
   *  while the player runs re-centers (return 3.5/5); idle release holds. */
  setParallelInput(x: number, y: number): void {
    this.follower.rotate(x, y);
  }

  /** Hold-button zoom (ZoomIn @00448df0). rate is input magnitude, dt seconds. */
  zoomIn(rate: number, dt: number): void { this.follower.zoomIn(rate, dt); }
  /** Hold-button zoom (ZoomOut @00448ea0). */
  zoomOut(rate: number, dt: number): void { this.follower.zoomOut(rate, dt); }

  /** Snap @00446760 — clear parallel/smoothing state; with pos, jump the
   *  look-at there instantly (spawn/teleport/reset-camera button). */
  snap(pos?: { x: number; y: number; z: number }): void {
    this.follower.snap(pos);
    this.updatePose();
  }

  /** Screen input → unity ground direction at this camera's current yaw. */
  mapInput(ix: number, iz: number): { x: number; z: number } {
    return screenInputToUnity(ix, iz, this.yawDeg);
  }

  /** Dev manual pan in world units, clamped to panBounds (not used by the
   *  original gameplay camera — exposed for the viewer and tests). */
  panWorld(mx: number, mz: number): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x + mx, this.panBounds.minX, this.panBounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z + mz, this.panBounds.minZ, this.panBounds.maxZ);
  }

  /** Per-frame update from the RAF loop (dt in seconds): zoom smoothing,
   *  parallel-move state machine, dev manual pan, pose. When follow() is
   *  used it owns the target; this never re-smooths it. */
  update(dt: number): void {
    this.follower.updateZoom(dt);
    this.follower.updateParallel(dt);

    let right = 0; // screen-right pan intent
    let fwd = 0;   // screen-up (away from camera) pan intent
    if (this.keyboardPan) {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    }

    if (this.edgeMargin > 0 && this.pointerX >= 0) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const m = this.edgeMargin;
      if (this.pointerX < m) right -= (m - this.pointerX) / m;
      else if (this.pointerX > w - m) right += (this.pointerX - (w - m)) / m;
      if (this.pointerY < m) fwd += (m - this.pointerY) / m;
      else if (this.pointerY > h - m) fwd -= (this.pointerY - (h - m)) / m;
    }

    if (right !== 0 || fwd !== 0) {
      const len = Math.hypot(right, fwd) || 1;
      // Pan speed scales with zoom so far-out views still traverse quickly.
      const speed = (this.panSpeed * (this.follower.getCurrentDistance() / 30) * dt) / len;
      const yaw = THREE.MathUtils.degToRad(this.yawDeg);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Camera ground-plane basis: right = (cos y, −sin y), forward = (−sin y, −cos y).
      this.panWorld((right * cos - fwd * sin) * speed, (-right * sin - fwd * cos) * speed);
    }
    this.updatePose();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private updatePose(): void {
    const pitch = THREE.MathUtils.degToRad(this.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    // Boom: behind/above the target along the fixed yaw, pitched down at it.
    // position = lookAt − centerDirection * GetCurrentDistance()
    // (UpdateCameraTransform @00447eb0; direction from node 889's transform).
    const distance = this.follower.getCurrentDistance();
    const horizontal = Math.cos(pitch) * distance;
    const vertical = Math.sin(pitch) * distance;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * horizontal,
      this.target.y + vertical,
      this.target.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }
}
