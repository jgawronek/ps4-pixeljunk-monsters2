// src/view/stage/CameraSwitch.ts
// The player-driven camera toggle (CameraManager.SwitchCamera @0073c8d0, input axis `camera_switch`, Unity InputManager positive button "q") between
// GameCameraTopDown(Real) and GameCameraBehind, with the per-camera GameCameraSwitchBlackInOut transition (serialized values below, identical in the
// stage-1 scene for both cameras except the transform/FOV flags).  PURE timeline: the caller animates the outgoing camera while phase == 'out'
// (Behind: BehindCamera.switchOutStep; TopDown: FOV shrink), swaps the active camera when `swapped` fires and draws a black overlay with `fade`.
//
// What is decoded: the serialized times / flags, the outgoing animation (UpdateSwitching @004455e0), the swap at switchOutTime
// (InvokeOnSwitch + the switch callback), and that CameraManager ignores the input while a switch runs or in 2P mode.
// APPROXIMATED: the black overlay curve (the shipped screenMaterial / OnRenderImage was not decompiled): ramp 0 -> 1 over the last `fadeOutTime` of
// the out phase and 1 -> 0 over `fadeInTime` (0 in the data -> we use IN_FADE_FALLBACK so the cut is not a hard pop).

export interface SwitchConfig {
  switchInTime: number;
  switchOutTime: number;
  fadeInTime: number;
  fadeOutTime: number;
  /** TopDown: shrink the FOV at fovZoomSpeed deg/s while switching out (clamped at DAT_00b7b6b0 = 1 deg). */
  fovChange: boolean;
  fovZoomSpeed: number;
  /** Behind: the swing-up / pull-back animation (rotateOutSpeedScale / zoomOutSpeedScale / offsetUpSpeedScale). */
  camTransformChange: boolean;
  rotateOutSpeedScale: number;
  zoomOutSpeedScale: number;
  offsetUpSpeedScale: number;
}

export const SWITCH_TOPDOWN: SwitchConfig = {
  switchInTime: 0.4, switchOutTime: 0.3, fadeInTime: 0, fadeOutTime: 0.15, fovChange: true, fovZoomSpeed: 30,
  camTransformChange: false, rotateOutSpeedScale: 1, zoomOutSpeedScale: 1, offsetUpSpeedScale: 1,
};
export const SWITCH_BEHIND: SwitchConfig = {
  switchInTime: 0.4, switchOutTime: 0.3, fadeInTime: 0, fadeOutTime: 0.15, fovChange: false, fovZoomSpeed: -20,
  camTransformChange: true, rotateOutSpeedScale: 2, zoomOutSpeedScale: 5, offsetUpSpeedScale: 0,
};

export const MIN_FOV = 1; // DAT_00b7b6b0
export const IN_FADE_FALLBACK = 0.15;

export type CamMode = 'top' | 'behind';
export type SwitchPhase = 'idle' | 'out' | 'in';

export interface SwitchState {
  /** The camera whose pose is shown this frame (flips at the swap). */
  mode: CamMode;
  phase: SwitchPhase;
  /** Seconds into the current phase. */
  t: number;
  /** Black overlay alpha 0..1. */
  fade: number;
  /** True on the single frame the active camera changed. */
  swapped: boolean;
}

export class CameraSwitch {
  mode: CamMode;
  private phase: SwitchPhase = 'idle';
  private t = 0;
  private fade = 0;
  private from: CamMode;

  constructor(start: CamMode = 'top', private readonly cfg: Record<CamMode, SwitchConfig> = { top: SWITCH_TOPDOWN, behind: SWITCH_BEHIND }) {
    this.mode = start;
    this.from = start;
  }

  get switching(): boolean { return this.phase !== 'idle'; }
  get currentPhase(): SwitchPhase { return this.phase; }
  /** True while the OUT animation of `mode` is running (the camera on screen is still the old one). */
  get inOutPhase(): boolean { return this.phase === 'out'; }
  /** Config of the camera being animated away (the outgoing one). */
  get outgoing(): SwitchConfig { return this.cfg[this.from]; }

  /** `camera_switch` pressed. Ignored while a switch is running (CameraManager.SwitchCamera early-out). */
  request(): boolean {
    if (this.phase !== 'idle') return false;
    this.from = this.mode;
    this.phase = 'out';
    this.t = 0;
    this.fade = 0;
    return true;
  }

  update(dt: number): SwitchState {
    let swapped = false;
    if (this.phase === 'out') {
      const c = this.cfg[this.from];
      this.t += dt;
      const ramp = c.fadeOutTime > 0 ? Math.min(1, Math.max(0, (this.t - (c.switchOutTime - c.fadeOutTime)) / c.fadeOutTime)) : (this.t >= c.switchOutTime ? 1 : 0);
      this.fade = ramp;
      if (this.t >= c.switchOutTime) {
        this.mode = this.from === 'top' ? 'behind' : 'top';
        swapped = true;
        this.phase = 'in';
        this.t = 0;
        this.fade = 1;
      }
    } else if (this.phase === 'in') {
      const c = this.cfg[this.mode];
      const dur = c.fadeInTime > 0 ? c.fadeInTime : IN_FADE_FALLBACK;
      this.t += dt;
      this.fade = Math.max(0, 1 - this.t / dur);
      if (this.fade <= 0) { this.phase = 'idle'; this.t = 0; }
    }
    return { mode: this.mode, phase: this.phase, t: this.t, fade: this.fade, swapped };
  }
}

/** TopDown switch-out: Mathf.Max(MIN_FOV, MoveTowards(fov, 0, dt * fovZoomSpeed)). */
export function topDownSwitchOutFov(fov: number, cfg: SwitchConfig, dt: number): number {
  if (!cfg.fovChange) return fov;
  return Math.max(MIN_FOV, Math.max(0, fov - dt * cfg.fovZoomSpeed));
}
