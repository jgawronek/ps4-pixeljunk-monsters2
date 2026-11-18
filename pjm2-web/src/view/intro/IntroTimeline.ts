// src/view/intro/IntroTimeline.ts
// Headless port of the ORIGINAL stage-intro sequence logic (no three.js, no DOM).
//
// ORIGINAL CALL GRAPH (decomp/decompiled; addresses in docs/STAGE_INTRO_ANALYSIS.md):
//   Q4.StageMain.<MainSequence> @00528730  (coroutine, runs after GameCoreBridge.CreateInstance):
//     [outline]   Q4.StartOutlineController.Show @00528ec0: stage card + CameraManager activates the
//                 GameCameraIntro camera chain; wait while the card isShowing.
//     [countdown] Q4.StartCountdownController.Show; wait while showing (timer 3.5 s).
//     [call]      Q4.StartCallMenuController.Show(1) => "WAVE START / Here they come!" (4.0 s).
//     [hud]       Q4.GameInfoController.Show => HUD slides in.  IsIntroSequence=false (pause allowed)
//                 when the call is shown.
//   Q4.GameCameraIntro.Update @004434f0: animator normalizedTime >= 1.0 and sim intro NOT finished
//     => CameraManager.SwitchCameraTo(nextCut) (fade-switch, GameCameraSwitchBlackInOut).  The cuts
//     (siblings under IntroRoot) therefore LOOP until the player confirms.
//   Q4.StartOutlineController.OnConfirm @00535020: after a 1.0 s lock-out, the confirm button
//     ("menu_skipcallscreen") queues GameCore.Network.IntroSequenceSkipCommand => sim
//     introSequenceFinishedEvent (wave manager: stageStartDelay = 4.75 s).
//   Q4.StartOutlineController.Update @00534c70: card isShowing && sim introSequenceFinished =>
//     UIController.Hide(HideFinished); HideFinished @00535230 => SwitchCameraTo<top-down follow cam>.
//   Q4.GameCameraSwitchBlackInOut.OnRenderImage @00445d10: the fade (out-phase of the OLD camera,
//     in-phase of the NEW one) - formulas reproduced in `outAlpha` / `inAlpha` below.
//
// Time unit: seconds (Unity Time.deltaTime).  The caller feeds `simIntroFinished`
// (GameCoreWaveManager.introSequenceFinished, the sim's own state - this class never touches the sim).

import { cameraWorldPose, clipLength, type Q4, type RigCamera, type RigSwitch, type StageIntroRig, type V3 } from './IntroRig';

/** Constants with evidence (see docs/STAGE_INTRO_ANALYSIS.md section 6). */
export const INTRO_CONST = {
  /** StartOutlineController.ctor @00534970: +0xe0 = 0x3f800000 (1.0): OnConfirm is refused until it decays to 0. */
  CONFIRM_LOCKOUT: 1.0,
  /** Card hide time = AnimationClip `HideStageStart_01` (globalsettings bundle) 1.0 s.  The clip<->prefab link
   *  was not traced, hence APPROXIMATE (it also makes the countdown end ~ at the sim's 4.75 s wave start). */
  CARD_HIDE_SECONDS: 1.0,
  /** StartCountdownController.ctor @005342a0: m_timeRemain (+0x94) = 0x40600000 = 3.5. */
  COUNTDOWN_SECONDS: 3.5,
  /** StartCountdownController.Update @00534470: hides when timeRemain <= DAT_00b7cee8 = -0.1. */
  COUNTDOWN_HIDE_AT: -0.1,
  /** StartCallMenuController prefab showDurationInSeconds (docs/GAME_UI_ANALYSIS.md 4.1). */
  START_CALL_SECONDS: 4.0,
  /** GameInfoController.Show slide-in; the clip length was not decoded - APPROXIMATE. */
  HUD_SLIDE_SECONDS: 0.5,
  /** GameCameraIntro.Update: switch when animator normalizedTime >= DAT_00b7b6a4 (1.0). */
  CUT_NORMALIZED_TIME: 1.0,
} as const;

export type SequenceStage = 'outline' | 'hiding' | 'countdown' | 'call' | 'hud' | 'done';

export interface IntroEvents {
  /** The camera swap to the follow camera happened (ChibiIntro.OnCameraSwitch destroys the runners,
   *  Home.OnCameraSwitch reveals the home chibis, the follow camera takes over). */
  onHandoffSwap?(): void;
  /** Countdown index changed: 0=Three 1=Two 2=One 3=Zero (sfx LobbyCountDown for <3, LobbyCountDownLast for 3). */
  onCountdownStep?(index: number): void;
  /** StartCallMenuController.Show: IsIntroSequence cleared, WAVE START call shown. */
  onStartCall?(): void;
  /** GameInfoController.Show: HUD slide-in begins. */
  onHudShow?(): void;
  /** A cut swap happened (index of the camera now active). */
  onCutSwap?(cutIndex: number): void;
}

type CamMode = 'in' | 'steady' | 'out';

/** OnRenderImage in-phase alpha (visibility 0..1) of a camera that was just switched TO.
 *  f = Min(f + dt/switchInTime, 1);  alpha = f < fadeIn/switchIn ? (switchIn==0 ? 1 : 0)
 *  : Clamp01(1 - (switchIn - f)/(switchIn - fadeIn))   (asm @445e1c..446008; note the original
 *  mixes the NORMALISED f with seconds - reproduced verbatim). */
export function inAlpha(sw: RigSwitch, tSeconds: number): number {
  if (!(sw.switchInTime > 0)) return 1;
  const f = Math.min(tSeconds / sw.switchInTime, 1);
  if (f < sw.fadeInTime / sw.switchInTime) return 0;
  const d = sw.switchInTime - sw.fadeInTime;
  return clamp01(1 - (sw.switchInTime - f) / d);
}

/** OnRenderImage out-phase alpha of the camera being switched AWAY from (t = seconds since SwitchOut).
 *  factor = 1 until t >= fadeOutTime, then (switchOut - t)/(switchOut - fadeOut) (asm @445d9f..445de2). */
export function outAlpha(sw: RigSwitch, tSeconds: number): number {
  if (!(sw.switchOutTime > 0)) return 1;
  let factor = 1;
  if (tSeconds >= sw.fadeOutTime) factor = (sw.switchOutTime - tSeconds) / (sw.switchOutTime - sw.fadeOutTime);
  return clamp01(factor);
}

/** StartCountdownController.UpdateCountdown @00534630: index = Clamp(3 - (int)(timeRemain + 1.0), 0, 3). */
export function countdownIndex(timeRemain: number): number {
  const i = 3 - Math.trunc(timeRemain + 1.0);
  return Math.max(0, Math.min(3, i));
}

/** Visible digit for a countdown index: Three/Two/One => 3/2/1, Zero => nothing. */
export function countdownDigitForIndex(index: number): number {
  return index >= 0 && index < 3 ? 3 - index : 0;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class StageIntroTimeline {
  // --- camera state (CameraManager / GameCameraIntro / GameCameraSwitchBlackInOut) ---
  cutIndex = 0; // index into rig.cameras (sibling order)
  animTime = 0; // Animator state time of the active cut
  private camMode: CamMode = 'in';
  private camModeT = 0; // seconds in the current in/out phase
  private switchTarget: 'next' | 'handoff' | null = null;
  private pendingHandoff = false;
  /** Follow camera active (after the handoff swap). */
  followActive = false;
  private handoffInT = 0;

  // --- sequence state (StageMain.MainSequence / StartOutlineController) ---
  stage: SequenceStage = 'outline';
  lockout: number = INTRO_CONST.CONFIRM_LOCKOUT;
  confirmed = false;
  cardT = 0;
  countdownRemain: number = INTRO_CONST.COUNTDOWN_SECONDS;
  private lastCountdownIndex = -1;
  callT = 0;
  hudT = 0;
  elapsed = 0;

  constructor(
    readonly rig: StageIntroRig,
    private readonly ev: IntroEvents = {},
  ) {
    if (rig.cameras.length === 0) throw new Error('intro rig has no cameras');
  }

  get camera(): RigCamera {
    return this.rig.cameras[this.cutIndex];
  }

  /** GameCameraIntro.Start: next sibling that carries a GameCameraIntro, wrapping. */
  nextCutIndex(): number {
    return (this.cutIndex + 1) % this.rig.cameras.length;
  }

  /** The intro (card + intro cameras + runner chibis) is still in control. */
  get introActive(): boolean {
    return !this.followActive;
  }

  /** IsIntroSequence (pause/menu gating) - true until the start call is shown. */
  get isIntroSequence(): boolean {
    return this.stage === 'outline' || this.stage === 'hiding' || this.stage === 'countdown';
  }

  get finished(): boolean {
    return this.stage === 'done';
  }

  /** Confirm button (StartOutlineController.OnConfirm). Returns true when accepted: the caller must then
   *  queue GameCore.Network.IntroSequenceSkipCommand for the primary local player. */
  confirm(): boolean {
    if (this.confirmed || this.lockout !== 0 || this.stage !== 'outline') return false;
    this.confirmed = true;
    return true;
  }

  /** Black overlay opacity (0 = fully visible). Applies to the 3D view only (the HUD is not inside the camera). */
  get blackAlpha(): number {
    let a: number;
    if (this.followActive) {
      const sw = this.rig.handoffCamera?.switch;
      a = sw === undefined ? 1 : inAlpha(sw, this.handoffInT);
    } else if (this.camMode === 'out') {
      a = outAlpha(this.camera.switch, this.camModeT);
    } else if (this.camMode === 'in') {
      a = inAlpha(this.camera.switch, this.camModeT);
    } else {
      a = 1;
    }
    return 1 - a;
  }

  /** Card opacity (hides linearly over CARD_HIDE_SECONDS; approximation of the HideStageStart_01 curve). */
  get cardAlpha(): number {
    if (this.stage === 'outline') return 1;
    if (this.stage === 'hiding') return clamp01(1 - this.cardT / INTRO_CONST.CARD_HIDE_SECONDS);
    return 0;
  }

  /** Current countdown index 0..3 or -1 while the countdown is not running. */
  get countdownStep(): number {
    return this.stage === 'countdown' ? countdownIndex(this.countdownRemain) : -1;
  }

  /** Visible 3/2/1 digit or 0. */
  get countdownDigit(): number {
    return this.stage === 'countdown' ? countdownDigitForIndex(countdownIndex(this.countdownRemain)) : 0;
  }

  /** 0..1 HUD slide-in progress (1 before/after? -> 0 until Show, 1 when done). */
  get hudSlide(): number {
    if (this.stage === 'hud') return clamp01(this.hudT / INTRO_CONST.HUD_SLIDE_SECONDS);
    return this.stage === 'done' ? 1 : 0;
  }

  /** World pose of the active INTRO camera (Unity space); null once the follow camera is active. */
  cameraPose(): { pos: V3; rot: Q4; fov: number } | null {
    if (this.followActive) return null;
    return cameraWorldPose(this.rig, this.camera, this.animTime);
  }

  private startOut(target: 'next' | 'handoff'): void {
    this.camMode = 'out';
    this.camModeT = 0;
    this.switchTarget = target;
  }

  /**
   * Advance by dt seconds.  `simIntroFinished` = GameCoreWaveManager.introSequenceFinished (sim state).
   */
  update(dt: number, simIntroFinished: boolean): void {
    if (this.stage === 'done') return;
    this.elapsed += dt;
    this.lockout = Math.max(this.lockout - dt, 0); // StartOutlineController.Update: Mathf.Max(x - dt, 0)

    // ---- camera chain (CameraManager + GameCameraIntro.Update) -----------------------
    if (this.followActive) {
      this.handoffInT += dt;
    } else {
      const cam = this.camera;
      if (this.camMode === 'out') {
        this.camModeT += dt;
        if (this.camModeT >= cam.switch.switchOutTime) this.swapCamera();
      } else {
        this.camModeT += dt;
        if (this.camMode === 'in' && this.camModeT >= (cam.switch.switchInTime > 0 ? cam.switch.switchInTime : 0)) {
          this.camMode = 'steady';
        }
        // Animator advances with Time.deltaTime (cuts with startDelay > 0 stay on frame 0 meanwhile).
        this.animTime += dt;
        const len = clipLength(cam.clip);
        if (
          len > 0 && this.animTime / len >= INTRO_CONST.CUT_NORMALIZED_TIME &&
          !simIntroFinished && !this.pendingHandoff
        ) {
          this.startOut('next');
        }
      }
    }

    // ---- MainSequence ------------------------------------------------------------------
    switch (this.stage) {
      case 'outline':
        // StartOutlineController.Update: card showing && introSequenceFinished => Hide
        if (this.confirmed && simIntroFinished) { this.stage = 'hiding'; this.cardT = 0; }
        break;
      case 'hiding':
        this.cardT += dt;
        if (this.cardT >= INTRO_CONST.CARD_HIDE_SECONDS) {
          // coroutine callback HideFinished => SwitchCameraTo<follow>; MainSequence resumes => countdown
          if (this.camMode === 'out') this.pendingHandoff = true;
          else this.startOut('handoff');
          this.stage = 'countdown';
          this.countdownRemain = INTRO_CONST.COUNTDOWN_SECONDS;
          this.lastCountdownIndex = -1;
        }
        break;
      case 'countdown': {
        this.countdownRemain -= dt;
        const idx = countdownIndex(this.countdownRemain);
        if (idx !== this.lastCountdownIndex) { this.lastCountdownIndex = idx; this.ev.onCountdownStep?.(idx); }
        if (this.countdownRemain <= INTRO_CONST.COUNTDOWN_HIDE_AT) {
          this.stage = 'call';
          this.callT = 0;
          this.ev.onStartCall?.();
        }
        break;
      }
      case 'call':
        this.callT += dt;
        if (this.callT >= INTRO_CONST.START_CALL_SECONDS) { this.stage = 'hud'; this.hudT = 0; this.ev.onHudShow?.(); }
        break;
      case 'hud':
        this.hudT += dt;
        if (this.hudT >= INTRO_CONST.HUD_SLIDE_SECONDS) this.stage = 'done';
        break;
      default:
        break;
    }
  }

  /** CameraManager.OnSwitchCamera at the end of the out-phase. */
  private swapCamera(): void {
    if (this.switchTarget === 'handoff') {
      this.followActive = true;
      this.handoffInT = 0;
      this.camMode = 'steady';
      this.switchTarget = null;
      this.ev.onHandoffSwap?.();
      return;
    }
    this.cutIndex = this.nextCutIndex();
    this.animTime = 0; // GameObject re-activated => Animator restarts at the default state
    this.camMode = 'in';
    this.camModeT = 0;
    this.switchTarget = null;
    this.ev.onCutSwap?.(this.cutIndex);
    if (this.pendingHandoff) { // CameraManager pending switch (m_pendingSwitchCamera) runs right after
      this.pendingHandoff = false;
      this.startOut('handoff');
    }
  }
}
