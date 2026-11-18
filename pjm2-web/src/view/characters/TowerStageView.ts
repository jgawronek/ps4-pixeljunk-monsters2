// src/view/characters/TowerStageView.ts
// Three.js-backed view of ONE built tower — the port of the Q4.TowerBase +
// Q4.TowerAnimator + Q4.StructureVibration MonoBehaviours that live on the
// original tower prefab. Full evidence in docs/TOWER_CONSTRUCTION_ANALYSIS.md.
//
// HOW THE ORIGINAL BUILDS A TOWER (presentation side)
//   * There is NO separate "construction model": TowerHelper.FromTreeToTower
//     Instantiates the finished prefab (PrefabLoader adds tower_NNN_pa) at
//     towerPos + down*height with Euler(bodyDirection), and the sim's
//     TowerStateBuild raises it back to the ground over buildTime.
//   * Q4.TowerBase.Start @00548f90 (first frame): InitFort (caches the fort
//     joints' bind WORLD rotations + the vertical joint's local origin),
//     destroys the children of the flag placeholder, then
//     transform.rotation = LookRotation(tower.bodyDirection).
//   * Q4.TowerBase.Update @00549e70 (every frame, raw-verified):
//       state is Build or Idle -> transform.position = tower.position (so the
//       rise is the sim's MoveTowards, nothing is animated in the view);
//       state is Build -> (once) AddComponent<StructureVibration>, and (once)
//         Instantiate(towerBuildEffect, towerFinalPosition, identity); while no
//         build sound source exists: PlaySFXMonitored(GlobalSounds.TowerBuild)
//         (a LOOPING 3D source at the tower);
//       first non-Build frame -> StopSFX(build loop) + PlaySFX(TowerComplete),
//         then destroy the vibration and StopLoopingThenDestroy the effect.
//   * LateUpdate -> UpdateFortView -> UpdateFortViewRotation @0054aeb0: the
//     fort joints are assigned WORLD rotations every frame (see towerFort.ts).
//   * Recoil @0054b390 (projectileLaunchEvent for this tower): vertical joint
//     localPosition -= localRotation*forward*recoil; recovers at 1 unit/s.
//   * Q4.TowerAnimator drives the prefab's Animator (OnFire/UpdateFiring) —
//     TowerAnimatorLogic + AnimatorRuntime (serialized controllers).
//   * OnSell @0054b800: scrap effect + ShrinkAndDestroy (Y scale -7.5/s).
//
// PORT STRUCTURE
//   The sim (GameCoreTower + TowerState FSM) is untouched; this class reads a
//   per-frame TowerSimSnapshot (position, directions, state kind) through
//   bindSim() — the same one-way data flow as the original (view reads sim).
//   Effects/audio go through the TowerViewEffects sink so the class is
//   testable without WebAudio/particles.
//
// Mirror rule: unity (x,y,z) <-> three (-x,y,z); unity quat (x,y,z,w) ->
// three (x,-y,-z,w).

import * as THREE from 'three';
import { Quaternion as UQuat, Vector3 as UVec } from '../../engine/math';
import type {
  EnemyDetectorViewContract,
  ProjectileViewContract,
  TowerBaseContract,
  TowerUpgradeSettingContract,
  Vector3Like,
} from '../q4-contracts';
import type { ETowerAttackDef, EEnemyClassTypeDef, EEnemyStrengthTypeDef } from '../../core/enums';
import type { CharacterLibrary, CharacterRig } from './CharacterLibrary';
import { TowerFlag } from './TowerFlag';
import { findClipBySuffix, mirrorQuat } from './EnemyStageView';
import { AnimatorRuntime } from './AnimatorRuntime';
import { StructureVibration } from './StructureVibration';
import { TowerAnimatorLogic } from './TowerAnimatorLogic';
import { bodyRotation, fortAim } from './towerFort';
import { TOWER_VIEW_DATA } from './towerViewData.generated';
import type { TowerViewRecord } from './towerViewTypes';

/** Tower animator clip states (suffix after `<tower>_comp/`; empty clips —
 *  several towers bake 0-track fire clips — still resolve and simply hold
 *  the bind pose, which matches the original's code-driven channels). Used by
 *  the dev lab (setAnimState); in-game the AnimatorRuntime owns playback. */
export type TowerAnimState =
  | 'ready_to_fire' | 'fire' | 'cool_down' | 'cool_down_idle' | 'reload'
  | 'close_idle' | 'close_pc_out' | 'close_pc_in'
  | 'open_idle_pc_out' | 'open_idle_pc_in' | 'open_pc_in' | 'open_pc_out';

// ---- sim → view contracts ------------------------------------------------------

/** What the view reads from the sim each frame (UNITY space throughout). */
export interface TowerSimSnapshot {
  /** GameCoreTower.position (GameCoreObject +0x1C). */
  position: Vector3Like;
  /** GameCoreTower.bodyDirection (+0x110). */
  bodyDirection: Vector3Like;
  /** GameCoreTower.fortDirection (+0x11C). */
  fortDirection: Vector3Like;
  /** GameCoreTower.attackSpeed (+0x74). */
  attackSpeed: number;
  state: {
    kind: 'build' | 'idle' | 'other';
    /** State.stateTime (+0x10). */
    stateTime: number;
    /** TowerStateIdle.ShootOnSight (+0x20) — idle only. */
    shootOnSight: boolean;
    /** TowerStateBuild.towerFinalPosition (+0x20) — build only. */
    finalPosition: Vector3Like | null;
  };
}

export interface LoopingHandle {
  stop(): void;
}

/** Audio / particle sinks (all optional — view-only cosmetics). Positions are UNITY space. */
export interface TowerViewEffects {
  /** Instantiate(towerBuildEffect, finalPosition, identity): the looping build ParticleGroup. */
  startBuildEffect?(prefab: string, position: Vector3Like): LoopingHandle | null;
  /** MonstersAudio.PlaySFXMonitored — a looping 3D source. */
  startLoopSfx?(clip: string, position: Vector3Like): LoopingHandle | null;
  /** MonstersAudio.PlaySFX(clip, position, true). */
  playSfx?(clip: string, position: Vector3Like): void;
  /** Instantiate(towerDestroyEffect, position, rotation) — one-shot ParticleGroup. */
  burstEffect?(prefab: string, position: Vector3Like): void;
  /** Active camera's world right vector in THREE space (StructureVibration axis); null = Vector3.right. */
  cameraRight?(): Vector3Like | null;
}

// ---- recorded clip tables (dev lab / legacy setAnimState) -----------------------

const TOWER_CLIP_SUFFIX_OVERRIDES: Record<string, Partial<Record<TowerAnimState, string>>> = {
  tower_011: { cool_down_idle: 'coll_down_idle' },
};

const STANDARD_TOWER_STATES: readonly string[] = [
  'ready_to_fire', 'fire', 'cool_down', 'reload', 'cool_down_idle',
  'close_idle', 'close_pc_out', 'open_idle_pc_out', 'close_pc_in',
  'open_idle_pc_in', 'open_pc_in',
];

/** Baked `<tower>_comp/` clip suffixes per tower — recorded from
 *  public/assets/characters/manifest.json (tools/assets extraction output). */
const RECORDED_TOWER_CLIPS: Record<string, readonly string[]> = {
  tower_001: STANDARD_TOWER_STATES,
  tower_002: STANDARD_TOWER_STATES,
  tower_003: [...STANDARD_TOWER_STATES, 'open_pc_out'],
  tower_004: STANDARD_TOWER_STATES,
  tower_005: [], // only "Take 001" — no comp states baked
  tower_006: STANDARD_TOWER_STATES,
  tower_007: [...STANDARD_TOWER_STATES.filter((s) => s !== 'cool_down_idle'), 'open_pc_out'],
  tower_008: ['cool_down_idle', 'fire'],
  tower_009: ['cool_down', 'cool_down_idle', 'fire', 'ready_to_fire', 'reload'],
  tower_010: [
    'ready_to_fire_01', 'fire_01', 'cool_down_01', 'reload_01',
    'ready_to_fire_02', 'fire_02', 'cool_down_02', 'reload_02',
    'ready_to_fire_03', 'fire_03', 'cool_down_03', 'reload_03',
  ],
  tower_011: ['ready_to_fire', 'fire', 'cool_down', 'reload', 'coll_down_idle'],
  tower_012: ['ready_to_fire', 'fire', 'cool_down_idle', 'cool_down', 'reload', 'muzzle_up_idle', 'muzzle_down_idle'],
};

/** Resolve the GLB clip name for a tower animator state (dev lab). Returns the
 *  full clip name (`<tower>_comp/<suffix>`), or null when the tower does not
 *  bake that state. */
export function towerAttackClipName(
  towerName: string,
  state: TowerAnimState,
  clipNames?: readonly string[],
): string | null {
  const suffix = TOWER_CLIP_SUFFIX_OVERRIDES[towerName]?.[state] ?? state;
  const candidate = `${towerName}_comp/${suffix}`;
  const variant01 = `${candidate}_01`;
  if (clipNames !== undefined) {
    if (clipNames.includes(candidate)) return candidate;
    if (clipNames.includes(variant01)) return variant01;
    const prefix = `${candidate}_`;
    for (const n of clipNames) {
      if (n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length))) return n;
    }
    return null;
  }
  const recorded = RECORDED_TOWER_CLIPS[towerName];
  if (recorded === undefined) return candidate; // unknown def: standard naming
  if (recorded.includes(suffix)) return candidate;
  if (recorded.includes(`${suffix}_01`)) return variant01;
  return null;
}

// ---- constants (all from the decomp, see header) -------------------------------

/** ShrinkAndDestroy @0054da80: shrinkSpeed = 0x40F00000. */
export const SELL_SHRINK_SPEED = 7.5;
/** Vertical recoil joint returns to its origin at 1 unit/s (MoveTowards maxDelta = dt). */
const RECOIL_RECOVER_SPEED = 1.0;
/** TS ADAPTATION: Vector3.Angle(lastForward, forward) != 0 uses exact float
 *  compare in the original; a rest tower would flicker on rounding noise. */
const ROTATING_EPSILON_DEG = 0.05;
const BUILD_SFX = 'sfx_tower_buildtower'; // GlobalSounds.TowerBuild  (globalsounds_map.json)
const COMPLETE_SFX = 'sfx_tower_buildcomplete'; // GlobalSounds.TowerComplete

// ---- scratch ---------------------------------------------------------------------

const _desiredWorldQ = new THREE.Quaternion();
const _parentWorldQ = new THREE.Quaternion();
const _localQ = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, 1);

export class TowerStageView implements TowerBaseContract {
  /** Wrapper group — parented by the factory. */
  readonly root: THREE.Group;
  readonly transform: { position: Vector3Like };
  readonly gameObject: { activeSelf: boolean; setActive(value: boolean): void };

  private readonly rig: CharacterRig;
  private readonly mixer: THREE.AnimationMixer;
  private readonly data: TowerViewRecord | null;
  private readonly fortHorizontal: THREE.Object3D | null; // TowerBase.m_fortJointHorizontal (0x180)
  private readonly fortVertical: THREE.Object3D | null; // TowerBase.m_fortJointVertical (0x188)
  private readonly firePointNodes: THREE.Object3D[];
  private readonly fortAngleMin: number;
  private readonly fortAngleMax: number;
  private readonly recoil: number;

  private effects: TowerViewEffects = {};
  private simProvider: (() => TowerSimSnapshot | null) | null = null;
  private fortProvider: (() => Vector3Like | null) | null = null;

  // InitFort state
  private fortBindCaptured = false;
  private bindH = new THREE.Quaternion(); // 0x1b0
  private bindV = new THREE.Quaternion(); // 0x1c0
  private originV = new THREE.Vector3(); // 0x198 (vertical joint local position)
  private lastRotateForward = new THREE.Vector3(0, 0, 1); // 0x1e0

  // Start / Update state
  private started = false;
  private vibration: StructureVibration | null = null; // m_vibration (0x1a8)
  private buildEffect: LoopingHandle | null = null; // towerBuildEffectInstance (0x160)
  private buildSfx: LoopingHandle | null = null; // m_audioSourceBuild (0x1d0)
  private rotateSfx: LoopingHandle | null = null; // m_audiosourceRotate (0x1d8)

  // Animator
  private animator: AnimatorRuntime | null = null;
  private animatorLogic: TowerAnimatorLogic | null = null;
  private readonly layerActions: Array<THREE.AnimationAction | null> = [];

  // Legacy lab playback
  private currentAction: THREE.AnimationAction | null = null;
  private currentState: TowerAnimState | 'custom' | null = null;

  // Sell
  private sellScaleY: number | null = null;
  private finishedFlag = false;
  /** Level flag on the `flag_pos` node (TowerBase.CoroutineDecorateFlag); created on the first upgrade. */
  private flag: TowerFlag | null = null;

  constructor(
    private readonly prefab: TowerBaseContract,
    rig: CharacterRig,
    position: Vector3Like,
    rotationEuler: Vector3Like,
    /** Optional explicit fort joint names override (tests / lab). */
    fortJoints: { horizontal?: string; vertical?: string } = {},
  ) {
    this.rig = rig;
    this.root = rig.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.data = TOWER_VIEW_DATA[prefab.name] ?? null;

    this.transform = {
      get position(): Vector3Like {
        return { x: -rig.root.position.x, y: rig.root.position.y, z: rig.root.position.z };
      },
      set position(v: Vector3Like) {
        rig.root.position.set(-v.x, v.y, v.z);
      },
    };
    this.gameObject = {
      get activeSelf(): boolean {
        return rig.root.visible;
      },
      setActive(value: boolean): void {
        rig.root.visible = value;
      },
    };
    this.transform.position = position;
    // Object.Instantiate(prefab, pos, Quaternion.Euler(bodyDirection)): Unity
    // Euler (Z,X,Y order == three 'YXZ') → unity quat → mirrored.
    const d2r = THREE.MathUtils.degToRad;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(d2r(rotationEuler.x), d2r(rotationEuler.y), d2r(rotationEuler.z), 'YXZ'),
    );
    const m = mirrorQuat(q);
    this.root.quaternion.set(m.x, m.y, m.z, m.w);

    const joints = this.resolveFortJoints(fortJoints);
    this.fortHorizontal = joints.horizontal;
    this.fortVertical = joints.vertical;
    this.fortAngleMin = this.data?.fortAngleMin ?? -90;
    this.fortAngleMax = this.data?.fortAngleMax ?? 90;
    this.recoil = this.data?.recoil ?? 0;

    this.firePointNodes = [];
    if (prefab.firePointNames !== null) {
      for (const name of prefab.firePointNames) {
        const n = this.findNode(name);
        if (n !== null) this.firePointNodes.push(n);
      }
    }
    if (this.firePointNodes.length === 0) {
      // Heuristic fallback: muzzle-looking nodes, excluding the flag pole.
      this.root.traverse((o) => {
        if (/(_pos)$/.test(o.name) && !/flag_pos/.test(o.name)) this.firePointNodes.push(o);
      });
      this.firePointNodes.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  // ---- data-field delegation (InitializeSettings reads these verbatim) ----
  get name(): string { return this.prefab.name; }
  get nextTargetToAttackIndex(): number { return this.prefab.nextTargetToAttackIndex; }
  get attackType(): ETowerAttackDef { return this.prefab.attackType; }
  get strengthType(): EEnemyStrengthTypeDef { return this.prefab.strengthType; }
  get classType(): EEnemyClassTypeDef { return this.prefab.classType; }
  get balloonAimable(): boolean { return this.prefab.balloonAimable; }
  get attackPower(): number { return this.prefab.attackPower; }
  get attackSpeed(): number { return this.prefab.attackSpeed; }
  get attackRangeInner(): number { return this.prefab.attackRangeInner; }
  get attackSpread(): number { return this.prefab.attackSpread; }
  get costCoin(): number { return this.prefab.costCoin; }
  get costGem(): number { return this.prefab.costGem; }
  get buildTime(): number { return this.prefab.buildTime; }
  get buildRange(): number { return this.prefab.buildRange; }
  get refundCoin(): number { return this.prefab.refundCoin; }
  get refundGem(): number { return this.prefab.refundGem; }
  get magazineCapacity(): number { return this.prefab.magazineCapacity; }
  get rotateSpeedX(): number { return this.prefab.rotateSpeedX; }
  get rotateSpeedXAcel(): number { return this.prefab.rotateSpeedXAcel; }
  get rotateSpeedXDecl(): number { return this.prefab.rotateSpeedXDecl; }
  get rotateSpeedY(): number { return this.prefab.rotateSpeedY; }
  get rotateSpeedYAcel(): number { return this.prefab.rotateSpeedYAcel; }
  get rotateSpeedYDecl(): number { return this.prefab.rotateSpeedYDecl; }
  get oneShotOneBalloon(): boolean { return this.prefab.oneShotOneBalloon; }
  get fullRangeFire(): boolean { return this.prefab.fullRangeFire; }
  get fireAngleThreshold(): number { return this.prefab.fireAngleThreshold; }
  get attackAttenuations(): unknown[] { return this.prefab.attackAttenuations; }
  get burstCount(): number { return this.prefab.burstCount; }
  get burstInterval(): number { return this.prefab.burstInterval; }
  get cautionRange(): number { return this.prefab.cautionRange; }
  get cautionIdleTime(): number { return this.prefab.cautionIdleTime; }
  get cautionRotateSpeed(): number { return this.prefab.cautionRotateSpeed; }
  get cautionRotateAngleMin(): number { return this.prefab.cautionRotateAngleMin; }
  get playerDetectionRange(): number { return this.prefab.playerDetectionRange; }
  get firePointNames(): string[] | null { return this.prefab.firePointNames; }
  get projectile(): ProjectileViewContract | null { return this.prefab.projectile; }
  get singletonInScene(): boolean | undefined { return this.prefab.singletonInScene; }

  getComponentTowerUpgradeSetting(): TowerUpgradeSettingContract | null {
    return this.prefab.getComponentTowerUpgradeSetting();
  }
  getComponentEnemyDetectorView(): EnemyDetectorViewContract | null {
    return this.prefab.getComponentEnemyDetectorView();
  }
  changeMagDuration(): number {
    return this.prefab.changeMagDuration ? this.prefab.changeMagDuration() : 0;
  }

  // ---- view-side contract methods ----

  /** C#: GameObjectHelper.FindDeep(gameObject, name).transform.position.y.
   *  World-space Y is mirror-invariant, so the three world Y is returned as-is. */
  findDeepChildY(name: string): number | null {
    const node = this.findNode(name);
    if (node === null) return null;
    this.root.updateWorldMatrix(true, true);
    return node.getWorldPosition(new THREE.Vector3()).y;
  }

  /** C#: TowerBase.GetFirePointByRemainingMag(magazineCapacity) — muzzle
   *  world position (UNITY space; x mirrored back out of three space).
   *  Index VERIFIED @00548640: spent = capacity − mag (capacity < 1 → 0),
   *  index = spent % firePointCount. Empty list → base position fallback
   *  (TS ADAPTATION: the original throws). */
  getFirePointByRemainingMag(mag: number): Vector3Like {
    const n = this.firePointNodes.length;
    if (n === 0) return this.transform.position;
    const capacity = this.prefab.magazineCapacity | 0;
    const spent = capacity < 1 ? 0 : (capacity - (mag | 0)) % n;
    const idx = spent < 0 ? 0 : spent;
    this.root.updateWorldMatrix(true, true);
    const p = this.firePointNodes[idx].getWorldPosition(new THREE.Vector3());
    return { x: -p.x, y: p.y, z: p.z };
  }

  /** C#: Q4.TowerBase.GetFireEffectLocation @0054a8b0 — FIRST fire point's world
   *  position + rotation (UNITY space), used by Projectile.Start for the muzzle
   *  effect. Null when the tower has no fire point. */
  getFireEffectLocation(): { pos: Vector3Like; rot: { x: number; y: number; z: number; w: number } } | null {
    if (this.firePointNodes.length === 0) return null;
    this.root.updateWorldMatrix(true, true);
    const n = this.firePointNodes[0];
    const p = n.getWorldPosition(new THREE.Vector3());
    const q = n.getWorldQuaternion(new THREE.Quaternion());
    return { pos: { x: -p.x, y: p.y, z: p.z }, rot: { x: q.x, y: -q.y, z: -q.z, w: q.w } };
  }

  // ---- wiring ----

  /** Per-frame sim pull (position / directions / state kind). */
  bindSim(provider: (() => TowerSimSnapshot | null) | null): void {
    this.simProvider = provider;
  }

  /** Audio / particle sinks. */
  bindEffects(effects: TowerViewEffects): void {
    this.effects = effects;
  }

  /** Legacy: fort direction only (lab / tests). bindSim supersedes it. */
  bindFortDirection(provider: (() => Vector3Like | null) | null): void {
    this.fortProvider = provider;
  }

  /** True once a sold tower finished shrinking (ShrinkAndDestroy done). */
  get finished(): boolean {
    return this.finishedFlag;
  }

  /** Active build-time diagnostics (tests / probes). */
  get building(): { vibrating: boolean; effect: boolean; sfx: boolean } {
    return { vibrating: this.vibration !== null, effect: this.buildEffect !== null, sfx: this.buildSfx !== null };
  }

  // ---- Q4.TowerBase.Start ----

  /** First-frame setup (Start). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    // InitFort runs BEFORE the LookRotation(bodyDirection) assignment, so the
    // bind rotations are captured with the Instantiate rotation.
    this.captureFortBind();
    const snap = this.simProvider?.() ?? null;
    if (snap !== null) {
      const q = bodyRotation(new UVec(snap.bodyDirection.x, snap.bodyDirection.y, snap.bodyDirection.z));
      const m = mirrorQuat(q);
      this.root.quaternion.set(m.x, m.y, m.z, m.w);
    }
    // GameObjectHelper.DestroyChilds(FindDeep(flagPlaceholderName)).
    const flagName = this.data?.flagPlaceholder;
    if (flagName) {
      const flag = this.findNode(flagName);
      if (flag !== null) for (const c of [...flag.children]) flag.remove(c);
    }
  }

  /** InitFort @005493b0: bind WORLD rotations + vertical joint origin. */
  private captureFortBind(): void {
    if (this.fortBindCaptured) return;
    this.fortBindCaptured = true;
    this.root.updateWorldMatrix(true, true);
    if (this.fortHorizontal !== null) {
      this.fortHorizontal.getWorldQuaternion(this.bindH);
      this.lastRotateForward.copy(FORWARD).applyQuaternion(this.bindH);
    }
    if (this.fortVertical !== null) {
      this.fortVertical.getWorldQuaternion(this.bindV);
      this.originV.copy(this.fortVertical.position);
    }
  }

  // ---- animator ----

  private resolveClip(clip: string | null): THREE.AnimationClip | null {
    if (clip === null) return null;
    const full = `${this.prefab.name}_comp/${clip}`;
    return this.rig.clips.find((c) => c.name === full)
      ?? this.rig.clips.find((c) => c.name === clip) // towers 005/010 bake unprefixed names
      ?? this.rig.clips.find((c) => c.name.endsWith(`/${clip}`)) ?? null;
  }

  private animatorCreated = false;

  /** The Animator exists from the prefab's first frame in the original; here it
   *  is created with the first sim-driven update so the dev lab's manual
   *  setAnimState (no sim bound) never fights the controller. */
  private createAnimator(): void {
    if (this.animatorCreated) return;
    this.animatorCreated = true;
    const ctl = this.data?.controller ?? null;
    if (ctl === null) return;
    this.layerActions.length = ctl.layers.length;
    this.layerActions.fill(null);
    const host = {
      clipLength: (clip: string): number => this.resolveClip(clip)?.duration ?? 0,
      onEnter: (layer: number, state: number, prev: number | null, blend: number, offset: number): void => {
        const st = ctl.layers[layer].states[state];
        const clip = this.resolveClip(st.clip);
        const prevAction = this.layerActions[layer];
        if (clip === null) {
          prevAction?.stop();
          this.layerActions[layer] = null;
          return;
        }
        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(st.loop ? THREE.LoopRepeat : THREE.LoopOnce, st.loop ? Infinity : 1);
        action.clampWhenFinished = !st.loop;
        action.timeScale = st.speed;
        action.time = offset;
        if (prev !== null && prevAction !== null && prevAction !== action) {
          if (blend > 0) prevAction.crossFadeTo(action, blend, false);
          else prevAction.stop();
        }
        action.play();
        this.layerActions[layer] = action;
      },
    };
    this.animator = new AnimatorRuntime(ctl, host);
    this.animatorLogic = new TowerAnimatorLogic(this.animator, {
      fireAnimationDuration: this.data?.fireAnimationDuration ?? 1.0,
      reloadClipLength: this.resolveClip('reload')?.duration ?? 0,
    });
  }

  /** projectileLaunchEvent for THIS tower: Q4.TowerBase.Recoil + Q4.TowerAnimator.OnFire. */
  onFire(): void {
    // Recoil @0054b390: vertical joint localPosition -= localRotation * forward * recoil.
    const v = this.fortVertical;
    if (v !== null && this.recoil !== 0) {
      _fwd.copy(FORWARD).applyQuaternion(v.quaternion).multiplyScalar(this.recoil);
      v.position.sub(_fwd);
    }
    this.animatorLogic?.onFire();
  }

  // ---- frame update ----

  /** Frame update in Unity's order: TowerBase.Update → TowerAnimator.Update →
   *  Animator evaluation → StructureVibration.Update → TowerBase.LateUpdate. */
  update(dt: number): void {
    this.start();
    const snap = this.simProvider?.() ?? null;
    if (snap !== null) this.updateFromSim(snap, dt);
    this.mixer.update(dt);
    this.flag?.update(dt);
    if (snap !== null && this.vibration !== null) this.stepVibration(dt);
    if (this.sellScaleY === null) {
      // LateUpdate → UpdateFortView(dt)
      const dir = snap?.fortDirection ?? this.fortProvider?.() ?? null;
      if (dir !== null) this.applyFort(dir, dt, snap?.state.kind === 'build');
    }
    this.updateSell(dt);
  }

  private updateFromSim(snap: TowerSimSnapshot, dt: number): void {
    this.createAnimator();
    const kind = snap.state.kind;
    // TowerBase.Update — position follows the sim only in Build and Idle.
    if (this.sellScaleY === null && (kind === 'build' || kind === 'idle')) {
      this.root.position.set(-snap.position.x, snap.position.y, snap.position.z);
    }
    if (this.sellScaleY !== null) return;
    if (kind === 'build') {
      if (this.vibration === null) {
        this.vibration = new StructureVibration();
        const fin = snap.state.finalPosition ?? snap.position;
        const prefabName = this.data?.buildEffect ?? null;
        if (prefabName !== null && this.buildEffect === null) {
          this.buildEffect = this.effects.startBuildEffect?.(prefabName, fin) ?? null;
        }
      }
      if (this.buildSfx === null) {
        this.buildSfx = this.effects.startLoopSfx?.(BUILD_SFX, this.transform.position) ?? null;
      }
    } else {
      if (this.buildSfx !== null) {
        this.buildSfx.stop();
        this.buildSfx = null;
        this.effects.playSfx?.(COMPLETE_SFX, this.transform.position);
      }
      if (this.vibration !== null) {
        this.vibration = null; // Destroy(m_vibration) (m_ongoingSink == 0)
        this.buildEffect?.stop(); // ParticleGroup.StopLoopingThenDestroy
        this.buildEffect = null;
      }
    }
    // TowerAnimator.Update (before the Animator evaluates).
    const idle = kind === 'idle' ? { stateTime: snap.state.stateTime, shootOnSight: snap.state.shootOnSight } : null;
    this.animatorLogic?.update(dt, idle, snap.attackSpeed);
    this.animator?.update(dt);
  }

  private stepVibration(dt: number): void {
    const cam = this.effects.cameraRight?.() ?? null;
    const dir = StructureVibration.direction(cam);
    const off = this.vibration!.step(dt, dir.x, dir.y, dir.z);
    // position += shake. The camera right vector is already THREE space, so no mirror.
    this.root.position.x += off.x;
    this.root.position.y += off.y;
    this.root.position.z += off.z;
  }

  // ---- fort aim (Q4.TowerBase.UpdateFortViewRotation / UpdateFortView) ----

  /** Aim the fort at a UNITY-space direction (e.g. tower.fortDirection). Public
   *  for the dev lab / tests; in-game it is called from update(). `dt` drives the
   *  recoil recovery (0 = none). */
  setFortDirection(dir: Vector3Like, dt = 0): void {
    this.applyFort(dir, dt, false);
  }

  private applyFort(dir: Vector3Like, dt: number, building: boolean): void {
    if (this.fortHorizontal === null && this.fortVertical === null) return;
    this.captureFortBind();
    const aim = fortAim(new UVec(dir.x, dir.y, dir.z), this.fortAngleMin, this.fortAngleMax);
    this.root.updateWorldMatrix(true, true);
    if (this.fortHorizontal !== null && aim.horizontal !== null) {
      this.poseWorld(this.fortHorizontal, aim.horizontal, this.bindH);
    }
    if (this.fortVertical !== null) {
      if (aim.vertical !== null) this.poseWorld(this.fortVertical, aim.vertical, this.bindV);
      // MoveTowards(localPosition, origin, dt) — recoil recovery.
      const p = this.fortVertical.position;
      const dx = this.originV.x - p.x, dy = this.originV.y - p.y, dz = this.originV.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      const maxDelta = dt * RECOIL_RECOVER_SPEED;
      if (dist <= maxDelta || dist === 0) p.copy(this.originV);
      else p.set(p.x + (dx / dist) * maxDelta, p.y + (dy / dist) * maxDelta, p.z + (dz / dist) * maxDelta);
    }
    this.root.updateWorldMatrix(false, true); // joints posed → refresh bone matrices for skin readers
    this.updateRotateSound(building);
  }

  /** joint.rotation = LookRotation(dir) * bindWorld — a WORLD-space assignment:
   *  local = parentWorld⁻¹ · (mirror(LookRotation) · bindWorld). */
  private poseWorld(node: THREE.Object3D, unityLook: UQuat, bindWorld: THREE.Quaternion): void {
    const m = mirrorQuat({ x: unityLook.x, y: unityLook.y, z: unityLook.z, w: unityLook.w });
    _desiredWorldQ.set(m.x, m.y, m.z, m.w).multiply(bindWorld);
    if (node.parent !== null) {
      node.parent.updateWorldMatrix(true, false);
      node.parent.getWorldQuaternion(_parentWorldQ);
    } else {
      _parentWorldQ.identity();
    }
    _localQ.copy(_parentWorldQ).invert().multiply(_desiredWorldQ);
    node.quaternion.copy(_localQ);
  }

  /** TowerBase.rotateSound (0x78) loop: plays while the horizontal joint's
   *  forward changes (not during Build), stops when it settles. */
  private updateRotateSound(building: boolean): void {
    if (this.data?.rotateSound == null || this.fortHorizontal === null) return;
    this.fortHorizontal.updateWorldMatrix(true, false);
    this.fortHorizontal.getWorldQuaternion(_localQ);
    _fwd.copy(FORWARD).applyQuaternion(_localQ);
    if (!building) {
      const angle = THREE.MathUtils.radToDeg(this.lastRotateForward.angleTo(_fwd));
      if (angle > ROTATING_EPSILON_DEG) {
        if (this.rotateSfx === null) {
          this.rotateSfx = this.effects.startLoopSfx?.(this.data.rotateSound, this.transform.position) ?? null;
        }
      } else if (this.rotateSfx !== null) {
        this.rotateSfx.stop();
        this.rotateSfx = null;
      }
    }
    this.lastRotateForward.copy(_fwd);
  }

  /** towerUpgradeEvent for THIS tower — Q4.TowerBase.OnUpgrade @0054b520: plays
   *  GlobalSounds.TowerUpgrade, or TowerFinalUpgrade when GetNextUpgrade() is null.
   *  (Not ported: TowerLevelUpEffect UI popup and the flag-swap coroutine — see
   *  docs/TOWER_CONSTRUCTION_ANALYSIS.md "Not implemented".) */
  onUpgrade(hasNextUpgrade: boolean, newLevel?: number): void {
    this.effects.playSfx?.(hasNextUpgrade ? 'sfx_tower_levelup' : 'sfx_tower_levelcomplete', this.transform.position);
    // CoroutineDecorateFlag(newFlagPrefab): swap the banner on flag_pos (levels 2..5) and play TowerFlagUp when it rises.
    if (newLevel === undefined) return;
    if (this.flag === null) {
      const name = this.data?.flagPlaceholder;
      const mount = name ? this.findNode(name) : null;
      if (mount === null) return;
      this.flag = new TowerFlag(mount, () => { this.effects.playSfx?.('sfx_tower_flagup', this.transform.position); });
    }
    this.flag.setLevel(newLevel);
  }

  // ---- sell (Q4.TowerBase.OnSell + ShrinkAndDestroy) ----

  /** The tower was sold/destroyed: scrap effect, then squash Y to 0. */
  beginSell(): void {
    if (this.sellScaleY !== null) return;
    this.sellScaleY = this.root.scale.y;
    this.cleanupLoops();
    const prefabName = this.data?.destroyEffect ?? null;
    if (prefabName !== null) this.effects.burstEffect?.(prefabName, this.transform.position);
  }

  private updateSell(dt: number): void {
    if (this.sellScaleY === null || this.finishedFlag) return;
    if (this.sellScaleY > 0) {
      this.sellScaleY = Math.max(this.sellScaleY - dt * SELL_SHRINK_SPEED, 0);
      this.root.scale.set(1, this.sellScaleY, 1); // Vector3(1, y, 1) — rodata 0xb7d00c = 1.0
    } else {
      this.root.scale.set(0, 0, 0);
      this.finishedFlag = true;
      this.root.visible = false;
    }
  }

  // ---- lab / legacy animation API ----

  setAnimState(state: TowerAnimState): void {
    if (this.currentState === state) return;
    const names = this.rig.clips.map((c) => c.name);
    const clipName = towerAttackClipName(this.prefab.name, state, names);
    let clip = clipName !== null ? this.rig.clips.find((c) => c.name === clipName) ?? null : null;
    if (clip === null && !(this.prefab.name in RECORDED_TOWER_CLIPS)) {
      clip = findClipBySuffix(this.rig.clips, state);
    }
    if (clip === null) return;
    this.currentState = state;
    const action = this.mixer.clipAction(clip);
    action.reset();
    const oneShot = state === 'fire' || state === 'reload' || state.startsWith('open_') || state.startsWith('close_p');
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    action.clampWhenFinished = oneShot;
    if (this.currentAction !== null && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, 0.1, false);
    }
    action.play();
    this.currentAction = action;
  }

  /** Direct clip playback by exact GLB clip name (dev/lab harness). */
  playClipByName(name: string): boolean {
    const clip = this.rig.clips.find((c) => c.name === name);
    if (!clip) return false;
    this.currentState = 'custom';
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (this.currentAction !== null && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, 0.1, false);
    }
    action.play();
    this.currentAction = action;
    return true;
  }

  clipNames(): string[] {
    return this.rig.clips.map((c) => c.name);
  }

  get animState(): string | null {
    return this.currentState;
  }

  /** Current layer-0 state path of the controller runtime (e.g. "BaseLayer.fire"). */
  get animatorPath(): string | null {
    return this.animator?.currentPath(0) ?? null;
  }

  // ---- teardown ----

  private cleanupLoops(): void {
    this.buildEffect?.stop();
    this.buildEffect = null;
    this.buildSfx?.stop();
    this.buildSfx = null;
    this.rotateSfx?.stop();
    this.rotateSfx = null;
    this.vibration = null;
  }

  /** Q4.TowerBase.OnDestroy: stop sounds + effects, remove from the scene.
   *  Shared geometry/materials die with the library. */
  dispose(): void {
    this.flag?.dispose();
    this.flag = null;
    this.cleanupLoops();
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }

  // ---- node lookup ----

  /** Fort joint resolution: explicit override → serialized TowerBase data →
   *  GLB name-match fallback (unknown defs). Slots are positional: HORIZONTAL
   *  gets the flat yaw aim, VERTICAL the clamped full aim (tower_006's data has
   *  the names swapped; the original assigns by slot, so do we). */
  private resolveFortJoints(override: { horizontal?: string; vertical?: string }): {
    horizontal: THREE.Object3D | null;
    vertical: THREE.Object3D | null;
  } {
    const horizontal = override.horizontal ?? this.data?.jointHorizontal;
    const vertical = override.vertical ?? this.data?.jointVertical;
    if (horizontal !== undefined || vertical !== undefined) {
      return {
        horizontal: horizontal ? this.findNode(horizontal) : null,
        vertical: vertical ? this.findNode(vertical) : null,
      };
    }
    // Unknown def: legacy GLB name-match (door_rot_y / Rot_X_Code excluded).
    return {
      horizontal: this.findNode(/^(tower_)?rot_y$/i),
      vertical: this.findNode(/^(tower_)?rot_x$/i),
    };
  }

  private findNode(nameOrPattern: string | RegExp): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    this.root.traverse((o) => {
      if (found !== null) return;
      if (typeof nameOrPattern === 'string' ? o.name === nameOrPattern : nameOrPattern.test(o.name)) {
        found = o;
      }
    });
    return found;
  }
}

/** q4-contracts `setTowerViewerFactory` implementation. The library must be
 *  preloaded; unknown defs fall back to the data record itself (the
 *  contract's documented headless default: "the data record doubles as its
 *  own viewer"). The sim registers the returned view with
 *  registerUnityObject itself (TowerHelper). */
export function createTowerViewerFactory(
  library: CharacterLibrary,
  parent: THREE.Object3D,
): (
  prefab: TowerBaseContract,
  handleId: number,
  position: Vector3Like,
  rotationEuler: Vector3Like,
) => TowerBaseContract {
  return (prefab, _handleId, position, rotationEuler) => {
    if (library.get(prefab.name) === null) {
      console.warn(`[TowerStageView] no GLB cached for '${prefab.name}' — data-record view`);
      return prefab;
    }
    const view = new TowerStageView(prefab, library.instantiate(prefab.name), position, rotationEuler);
    parent.add(view.root);
    return view;
  };
}
