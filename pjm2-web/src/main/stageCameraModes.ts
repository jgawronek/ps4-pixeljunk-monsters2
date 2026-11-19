// src/main/stageCameraModes.ts
// Session-side driver for the original's player camera controls (docs/CAMERA_ANALYSIS.md):
//   * `camera_rotate` (right stick) -> on the TOP-DOWN camera the shipped rotateType is 2 (ParallelMove): the stick PANS the view around the player
//     (±7.8 x / ±5 z, CameraFollow.rotate); on the BEHIND camera the same stick ROTATES the boom (BehindCamera.setRotateInput).
//   * `camera_switch` (InputManager positive button "q") toggles TopDown <-> Behind with the BlackInOut transition (CameraSwitch).
//   * `camera_focus_forward` -> BehindCamera.focusForward (DoF focus pushes out by up to 20 m, FOV -5 deg).
//   * `camera_reset_parallel` -> CameraFollow snap (CheckSnapWhileParallelMoving).
// Keyboard bindings (web port; the original reads a gamepad through GestureManager): Q or C = switch camera, J/L = stick X, I/K = stick Y,
// F (hold) = focus forward, V = recentre the top-down pan.  Arrow keys / WASD stay movement.

import * as THREE from 'three';
import { BehindCamera, type BehindTarget } from '../view/stage/BehindCamera';
import { CameraSwitch, SWITCH_TOPDOWN, topDownSwitchOutFov, type CamMode } from '../view/stage/CameraSwitch';
import type { StageCamera } from '../view/stage/StageCamera';
import { DOF_PROFILES } from '../view/stage/DepthOfField';
import type { DofSettings } from '../view/stage/DepthOfField';

export interface CameraModeDeps {
  stageCamera: StageCamera;
  /** Currently held KeyboardEvent.code values (the session's moveKeys set). */
  keys: ReadonlySet<string>;
  /** True while something else owns the camera / input (intro, ring menu, pause, results). */
  blocked: () => boolean;
  /** Unity-space player position + facing, as the session knows them. */
  player: () => { x: number; y: number; z: number };
  parent?: HTMLElement;
}

/** Key bindings (KeyboardEvent.code). */
export const CAMERA_KEYS = {
  switch: ['KeyQ', 'KeyC'],
  rotateLeft: 'KeyJ', rotateRight: 'KeyL', rotateUp: 'KeyI', rotateDown: 'KeyK',
  focusForward: 'KeyF',
  resetPan: 'KeyV',
} as const;

export function stickFromKeys(keys: ReadonlySet<string>): { x: number; y: number } {
  const x = (keys.has(CAMERA_KEYS.rotateRight) ? 1 : 0) - (keys.has(CAMERA_KEYS.rotateLeft) ? 1 : 0);
  const y = (keys.has(CAMERA_KEYS.rotateUp) ? 1 : 0) - (keys.has(CAMERA_KEYS.rotateDown) ? 1 : 0);
  return { x, y };
}

/** Behind-camera relative stick -> Unity ground direction: forward = (sin a, cos a), right = (cos a, -sin a). */
export function behindInputToUnity(ix: number, iz: number, forwardYawRad: number): { x: number; z: number } {
  const s = Math.sin(forwardYawRad), c = Math.cos(forwardYawRad);
  return { x: ix * c + iz * s, z: -ix * s + iz * c };
}

export class StageCameraModes {
  readonly behind = new BehindCamera();
  readonly sw = new CameraSwitch('top');
  private readonly overlay: HTMLDivElement | null;
  private facing = { x: 0, z: 1 };
  private moveDir = { x: 0, z: 0 };
  private yawRad = 0;
  private readonly topFov0: number;
  private topFov: number;
  private focus: number | null = null;
  private resetLatch = false;

  constructor(private readonly d: CameraModeDeps) {
    this.topFov0 = this.topFov = d.stageCamera.camera.fov;
    if (typeof document !== 'undefined') {
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:6;display:none';
      (d.parent ?? document.body).appendChild(o);
      this.overlay = o;
    } else this.overlay = null;
  }

  /** The Behind camera is the one on screen (its own switch-out animation included). */
  get behindShown(): boolean { return this.sw.mode === 'behind'; }
  get mode(): CamMode { return this.sw.mode; }

  /** Keydown hook for the session. Returns true when the key was consumed. */
  onKeyDown(code: string, repeat: boolean): boolean {
    if (repeat || this.d.blocked()) return false;
    if ((CAMERA_KEYS.switch as readonly string[]).includes(code)) {
      const was = this.sw.mode;
      if (this.sw.request() && was === 'behind') this.behind.beginSwitchOut(); // remember the boom values the switch-out animation rewrites
      return true;
    }
    if (code === CAMERA_KEYS.resetPan && this.sw.mode === 'top') { this.resetLatch = true; return true; }
    return false;
  }

  /** Unity ground direction for WASD while the Behind camera is on screen (null = use the top-down mapping). */
  mapInput(ix: number, iz: number): { x: number; z: number } | null {
    return this.sw.mode === 'behind' ? behindInputToUnity(ix, iz, this.yawRad) : null;
  }

  /** The session reports this frame's walking direction (Unity, flat; zero = standing). */
  setPlayerMove(x: number, z: number): void {
    this.moveDir = { x, z };
    const l = Math.hypot(x, z);
    if (l > 0) this.facing = { x: x / l, z: z / l };
  }

  /** DoF for this frame: the Behind camera uses 3d_stage_NNN_behind_pp with the animated focusDistance; null = DoF off (top-down profile). */
  dofSettings(): DofSettings | null {
    if (this.sw.mode !== 'behind' || this.focus === null) return null;
    return { ...DOF_PROFILES.stageBehind, focusDistance: this.focus };
  }

  /** Per-frame, AFTER stageCamera.update(dt) (and the intro override): applies the active camera's pose. */
  update(dt: number): void {
    const cam = this.d.stageCamera;
    const blocked = this.d.blocked();
    const stick = blocked ? { x: 0, y: 0 } : stickFromKeys(this.d.keys);
    const pl = this.d.player();
    const target: BehindTarget = {
      pos: pl, forward: this.facing, inputMoving: this.moveDir.x !== 0 || this.moveDir.z !== 0, inputDir: this.moveDir, grounded: true,
    };

    // the outgoing camera animates while the out phase runs (UpdateSwitching @004455e0)
    const outBehind = this.sw.inOutPhase && this.sw.mode === 'behind';
    const outTop = this.sw.inOutPhase && this.sw.mode === 'top';
    if (outBehind) this.behind.switchOutStep(dt, this.sw.outgoing.rotateOutSpeedScale, this.sw.outgoing.zoomOutSpeedScale, this.sw.outgoing.offsetUpSpeedScale);
    else if (outTop) this.topFov = topDownSwitchOutFov(this.topFov, this.sw.outgoing, dt);

    const st = this.sw.update(dt);
    if (st.swapped) {
      if (st.mode === 'behind') { // CameraManager.OnSwitchCamera -> GameCameraBehind.InheritCamera @0043e342: behind the player, default pitch
        this.behind.resetAngles();
        this.behind.snap(target);
        this.behind.forceToPlayerBack(target);
      } else { // back to TopDown: Behind restores the saved boom values, TopDown the FOV
        this.behind.endSwitchOut();
        this.topFov = this.topFov0;
        cam.camera.fov = this.topFov0;
        cam.camera.updateProjectionMatrix();
        this.focus = null;
      }
    }

    if (st.mode === 'behind') {
      const manual = outBehind;
      if (!manual) this.behind.setRotateInput(stick.x, stick.y);
      this.behind.focusForward(!blocked && this.d.keys.has(CAMERA_KEYS.focusForward) ? 1 : 0);
      const pose = this.behind.update(dt, target);
      this.yawRad = pose.forwardYawRad;
      this.focus = pose.focusDistance;
      cam.camera.position.set(-pose.position.x, pose.position.y, pose.position.z);
      cam.camera.lookAt(-pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      if (cam.camera.fov !== pose.fov) { cam.camera.fov = pose.fov; cam.camera.updateProjectionMatrix(); }
    } else {
      cam.setParallelInput(stick.x, stick.y); // top-down: the stick pans (rotateType 2)
      if (this.resetLatch) { this.resetLatch = false; cam.snap(new THREE.Vector3(-pl.x, pl.y, pl.z)); }
      if (outTop && cam.camera.fov !== this.topFov) { cam.camera.fov = this.topFov; cam.camera.updateProjectionMatrix(); }
    }
    if (this.overlay !== null) {
      this.overlay.style.display = st.fade > 0.001 ? 'block' : 'none';
      this.overlay.style.opacity = String(st.fade);
    }
  }

  dispose(): void { this.overlay?.remove(); }
}
