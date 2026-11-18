// src/view/intro/StageIntroController.ts
// three.js / DOM glue of the stage intro.  All logic lives in the headless IntroTimeline /
// ChibiIntroRunner; this class only (a) feeds them dt + the sim state, (b) applies the camera pose,
// the fade overlay, the stage card, the 3-2-1 / WAVE START / HUD calls through caller-supplied
// hooks (reusing GameUiFeature / WaveCalls - nothing is drawn twice) and (c) forwards the confirm
// input as the REAL sim command (IntroSequenceSkipCommand).
//
// Flow (src/main/flow.ts): `bindFlow(flow)` claims the 'intro' state; entering it calls begin(); the
// state completes (-> 'playing') once the follow camera took over and the fade-in finished.
// Without flow (legacy START button) game.ts calls begin() directly.
//
// Skippable "exactly like the original": confirm = Enter / Space / click / tap after the 1.0 s
// lock-out; the first accepted confirm queues IntroSequenceSkipCommand (sim introSequenceFinishedEvent,
// which releases the wave manager's 4.75 s start delay), the sim-side flag then drives the card
// hide + camera hand-off.  The input-to-command path is the only thing the player controls.

import * as THREE from 'three';
import type { Flow } from '../../main/flow';
import type { CharacterRig } from '../characters/CharacterLibrary';
import { ChibiIntroRunner } from './ChibiIntroRunner';
import type { GroundLinecast } from '../characters/ChibiMotor';
import { IntroCardUi, type IntroCardText } from './IntroCardUi';
import { IntroChibiView } from './IntroChibiView';
import { cameraWorldPose, type StageIntroRig } from './IntroRig';
import { StageIntroTimeline } from './IntroTimeline';

export interface StageIntroHooks {
  /** GameCoreWaveManager.introSequenceFinished */
  simIntroFinished(): boolean;
  /** AddPlayerCommand(primary local player, new IntroSequenceSkipCommand()) */
  queueSkipCommand(): void;
  /** StartCountdownController digit 3/2/1 (0 = hidden) -> WaveCallsUi.setCountdown */
  setCountdownDigit(digit: number): void;
  /** Countdown step 0..3 sfx (LobbyCountDown / LobbyCountDownLast) */
  playCountdownSound(step: number): void;
  /** StartCallMenuController.Show(first wave): "WAVE START / Here they come!" */
  showStartCall(): void;
  /** GameInfoController hidden (slide 0) .. shown (slide 1) */
  setHudSlide(slide: number): void;
  /** Handoff swap: snap the follow camera onto the player, reveal home chibis, etc. */
  onHandoff(): void;
  /** Stage card text + hint */
  cardText(): IntroCardText;
  /** chibi_00 rig factory for the runners (null = no chibi model) */
  makeChibiRig(): CharacterRig | null;
  decorateChibi?(root: THREE.Object3D): void;
  /** Hide/show the home chibis that arrive with the intro (Home.OnCameraSwitch). */
  setLateHomeChibisHidden?(hidden: boolean): void;
  /** Terrain height under a Unity (x,z) (Chibi.ProjectToGround); null -> authored path y. */
  groundY?(x: number, z: number, fallbackY: number): number;
  /** Physics.Linecast(a, b, TerrainMask) -> hit y (Unity space) | null — exactly what Chibi.ProjectToGround casts. */
  linecast?: GroundLinecast | null;
}

export interface StageIntroOptions {
  rig: StageIntroRig;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Object3D;
  card: IntroCardUi | null;
  hooks: StageIntroHooks;
  /** DOM element for the fade overlay + input (the renderer canvas parent). */
  overlayParent?: HTMLElement;
  /** Number of home chibis held back until the hand-off (ChibiIntro paths = IntroNumHomeChibi delta). */
  seed?: number;
}

export class StageIntroController {
  readonly timeline: StageIntroTimeline;
  private readonly overlay: HTMLDivElement | null;
  private chibis: IntroChibiView | null = null;
  private readonly savedFov: number;
  private begun = false;
  private flow: Flow | null = null;
  private flowRelease: (() => void) | null = null;
  private flowOff: (() => void) | null = null;
  private flowCompleted = false;
  private inputBound = false;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') this.tryConfirm();
  };
  private readonly onPointer = (): void => { this.tryConfirm(); };

  constructor(private readonly o: StageIntroOptions) {
    this.savedFov = o.camera.fov;
    this.timeline = new StageIntroTimeline(o.rig, {
      onHandoffSwap: () => this.handoffSwap(),
      onCountdownStep: (i) => o.hooks.playCountdownSound(i),
      onStartCall: () => o.hooks.showStartCall(),
      onHudShow: () => undefined,
    });
    if (typeof document !== 'undefined') {
      this.overlay = document.createElement('div');
      Object.assign(this.overlay.style, {
        position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', background: '#000',
        opacity: '1', pointerEvents: 'none', zIndex: '8',
      });
      (o.overlayParent ?? document.body).appendChild(this.overlay);
    } else {
      this.overlay = null;
    }
  }

  /** Subscribe to the shared flow: claims 'intro', begins on enter, completes after the hand-off. */
  bindFlow(flow: Flow): void {
    this.flow = flow;
    this.flowRelease = flow.claim('intro');
    this.flowOff?.();
    this.flowOff = flow.onEnter('intro', () => this.begin());
    if (flow.state === 'intro') this.begin();
  }

  /** True while the intro owns the player (camera + input): movement/pause are frozen. */
  get active(): boolean {
    return this.begun && this.timeline.introActive;
  }

  /** The intro also owns the first-wave "WAVE START" call and the 3-2-1 (suppress sim-driven duplicates). */
  get ownsCalls(): boolean {
    return this.begun && !this.timeline.finished && this.timeline.stage !== 'done';
  }

  begin(): void {
    if (this.begun) return;
    this.begun = true;
    const { hooks, card, scene } = this.o;
    hooks.setHudSlide(0);
    hooks.setLateHomeChibisHidden?.(true);
    const rig = this.o.rig;
    if (rig.chibiIntro !== null) {
      const runner = new ChibiIntroRunner(rig.chibiIntro, this.o.seed ?? 1, hooks.groundY ?? null, hooks.linecast ?? null,
        rig.cameras.length > 0 ? cameraWorldPose(rig, rig.cameras[0], 0).pos : null);
      this.chibis = new IntroChibiView(runner, () => hooks.makeChibiRig(), hooks.decorateChibi);
      scene.add(this.chibis.root);
    }
    if (card !== null) { card.show(hooks.cardText()); card.setAlpha(1); card.setHintReady(false); }
    this.bindInput();
    this.applyCamera();
  }

  private bindInput(): void {
    if (this.inputBound || typeof window === 'undefined') return;
    this.inputBound = true;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onPointer);
  }

  private unbindInput(): void {
    if (!this.inputBound || typeof window === 'undefined') return;
    this.inputBound = false;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onPointer);
  }

  /** StartOutlineController.OnConfirm */
  tryConfirm(): boolean {
    if (!this.begun || !this.timeline.confirm()) return false;
    this.o.hooks.queueSkipCommand();
    return true;
  }

  private handoffSwap(): void {
    this.chibis?.dispose();
    this.chibis = null;
    this.o.hooks.setLateHomeChibisHidden?.(false);
    this.o.camera.fov = this.savedFov;
    this.o.camera.updateProjectionMatrix();
    this.o.hooks.onHandoff();
  }

  /** Per-frame: advance (dt seconds) BEFORE rendering; call applyCamera() after the follow camera update. */
  update(dt: number): void {
    if (!this.begun || this.timeline.finished) return;
    const tl = this.timeline;
    const { hooks, card } = this.o;
    tl.update(dt, hooks.simIntroFinished());
    this.chibis?.update(dt);
    if (card !== null) { card.setAlpha(tl.cardAlpha); card.setHintReady(tl.lockout === 0 && !tl.confirmed); }
    hooks.setCountdownDigit(tl.countdownDigit);
    hooks.setHudSlide(tl.hudSlide);
    if (this.overlay !== null) this.overlay.style.opacity = String(tl.blackAlpha);
    if (tl.followActive && !this.flowCompleted && tl.blackAlpha <= 0.001) {
      this.flowCompleted = true;
      if (this.flow !== null && this.flow.state === 'intro') this.flow.complete('intro');
    }
    if (tl.finished) this.dispose();
  }

  /** Override the three.js camera with the active intro cut (no-op after the hand-off). */
  applyCamera(): void {
    if (!this.begun) return;
    const pose = this.timeline.cameraPose();
    if (pose === null) return;
    const cam = this.o.camera;
    // Unity (x,y,z)->three (-x,y,z); quaternion (x,-y,-z,w); three cameras look down -Z so add a 180deg yaw.
    cam.position.set(-pose.pos.x, pose.pos.y, pose.pos.z);
    cam.quaternion.set(pose.rot.x, -pose.rot.y, -pose.rot.z, pose.rot.w).multiply(Y180);
    if (cam.fov !== pose.fov) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
  }

  dispose(): void {
    this.unbindInput();
    this.chibis?.dispose();
    this.chibis = null;
    this.overlay?.remove();
    this.o.card?.hide();
    this.flowRelease?.();
    this.flowRelease = null;
    this.flowOff?.();
    this.flowOff = null;
  }
}

const Y180 = new THREE.Quaternion(0, 1, 0, 0);
