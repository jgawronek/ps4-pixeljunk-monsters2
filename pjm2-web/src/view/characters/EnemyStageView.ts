// src/view/characters/EnemyStageView.ts
// Three.js-backed EnemyViewerContract (src/view/q4-contracts.ts §Q4.EnemyBase):
// one spawned enemy, cloned from a CharacterLibrary GLB template.
//
// Coordinate policy (manifest.json coordinateConvention): the GLB is already
// in three.js native RH space, so the only conversion this view performs is at
// the CONTRACT boundary — the sim reads/writes Unity LH space:
//     unity position (x,y,z)  ↔  three position (−x, y, z)
//     unity quat (x,y,z,w)    ↔  three quat (x, −y, −z, w)
// Both directions are implemented (the spawn ctor WRITES position/rotation;
// other sim paths may READ position back through the same duck). The quat
// mirror is exported as mirrorQuat (self-inverse) and shared with
// TowerStageView / ProjectileView. Path facing (update()): the rig's +Z is
// aimed along the MIRRORED travel direction via world-space lookAt —
// verified: unity moveVector +x → three yaw −90° (regression-tested in
// tests/view/weapons.test.ts).
//
// Documented contract defaults (headless-equivalent; NOT contract edits):
//   - getComponentInChildrenBalloon() → null. Balloon rigs (Balloon_Be joint
//     exists in kuri) are a later integration-lane item; returning null is the
//     exact "no Balloon component" path the sim handles.
//   - attackPoints() → null. kuri/spider/giant have no weak-point children
//     (AttackPointSetting data is boss-only). null = "not an attack-point
//     enemy" — the ctor skips initAttackPoints, faithful.
//   - isSlopeMovement = false, slope scales = 1 / angles = 30 (StateWalk's
//     slope branch is inert when isSlopeMovement is false; values match the
//     headless test fixture).
//   - getComponentEnemyAttributesSettings() → null. Damage tables belong to
//     the data lane; null takes DamageHelper's body-default path.
//
// Animation mapping (baked 30fps clips; names verified per-GLB — see
// .work/character-viewer-checks.md): the sim has no animator port yet, so the
// view picks clips from a small semantic state set driven either explicitly
// (setAnimState) or by an optional sim-binding pull (bindSimSource):
// NOTE: the game uses attachAnimator() (controller-driven, EnemyBaseView); the
// semantic setAnimState set below remains for the lab/dev harness + legacy tests.
//     idle → *_idle        walk → *_walk       fly → *_fly (air/balloon)
//     attack → *_attack    damageSmall → *_damage_small (etc.)
//     dieSmall → *_dieSmall_air → *_dieSmall_impact (chained one-shots)
//     dieBig   → *_dieBig_air   → *_dieBig_impact
//     drown → *_drown      land → *_land_air → *_land_impact
// Clip lookup is suffix-based (`<prefix>_walk`, exact tail match) so the same
// code covers every enemy def without a per-def table; walk_01/_02 variants
// are NOT auto-picked (base clip only — variant randomization is an
// integration-lane polish item).

import * as THREE from 'three';
import type {
  BalloonContract,
  CharacterTransformContract,
  EnemyAttackPointViewContract,
  EnemyAttributesSettingsContract,
  EnemyBaseContract,
  EnemyViewerContract,
  Vector3Like,
} from '../q4-contracts';
import type { CharacterLibrary, CharacterRig } from './CharacterLibrary';
import type { EnemyController, EnemyViewRecord } from './enemyViewTypes';
import { balloonAttributes, enemyAttackPointsFor, enemyAttributesFor } from '../../data/enemyAttributes';
import { BALLOON_ENEMIES } from '../../data/enemyBalloons';
import { ControllerPlayer } from './controllerPlayer';
import { EnemyAnimator } from './EnemyAnimatorLogic';
import { EnemyBaseView, type EnemyFrameInput } from './EnemyBaseView';
import { ENEMY_VIEW_DATA } from './enemyViewData.generated';
import type { EnemyEffects, EnemyFxHandle } from './enemyEffects';
import { EnemyBalloonRig } from './enemyBalloonRig';

/** Semantic animation states the view can resolve to GLB clips. */
export type EnemyAnimState =
  | 'idle' | 'walk' | 'fly' | 'attack'
  | 'damageSmall' | 'damageStrong' | 'damageHips'
  | 'dieSmall' | 'dieBig' | 'drown' | 'land';

/** Optional duck-typed sim pull-source (kept structural so the view layer
 *  does not depend on core class identities — view↔core stays one-directional
 *  via the q4-contracts registry). Positions are UNITY space. */
export interface EnemySimSource {
  position: Vector3Like;
  /** Facing direction (Unity space, horizontal). Zero = keep current. */
  moveVector?: Vector3Like;
  /** EEnemyMoveTypeDef value (0 unknown, 1 ground, 2 air); only the legacy
   *  (controller-less) path uses it — 2 (air) selects the fly clip. */
  enemyMoveType?: number;
  /** Previous-tick/frame position (Unity space) — animator MoveSpeedScale + heading. */
  previousPosition?: Vector3Like;
  /** GameCoreEnemy.SpeedCur (turn-rate scale). */
  speedCur?: number;
  /** 0 or negative life selects the death sequence (once). */
  m_life?: number;
  /** false = the sim object is gone (EnemyBase `core == null`: attack / dead / drown choreography runs alone). */
  alive?: boolean;
  /** GameCoreEnemy.GroundOffsetY / IsSlowMode / IsDamagedMode / IsBalloon (boss + balloon animator parameters). */
  groundOffsetY?: number;
  slowMode?: boolean;
  damagedMode?: boolean;
  isBalloon?: boolean;
}

/** Approximation of the giants' crumble (debris not ported): the body shrinks away in this long. */
const CRUMBLE_DISSOLVE_SECONDS = 0.35;
const _enemyWorldPos = new THREE.Vector3();
const _enemyLookTarget = new THREE.Vector3();

const SUFFIXES: Record<EnemyAnimState, string[]> = {
  idle: ['idle'],
  walk: ['walk'],
  fly: ['fly'],
  attack: ['attack'],
  damageSmall: ['damage_small'],
  damageStrong: ['damage_strong'],
  damageHips: ['damage_hips'],
  dieSmall: ['dieSmall_air', 'dieSmall_impact'],
  dieBig: ['dieBig_air', 'dieBig_impact'],
  drown: ['drown'],
  land: ['land_air', 'land_impact'],
};

/** Unity LH ↔ three RH quaternion mirror: (x,y,z,w) → (x,−y,−z,w).
 *  SELF-INVERSE — the same map converts both directions. Derivation: the
 *  position mirror M = diag(−1,1,1) conjugates a rotation into M·R·M, the
 *  same-angle rotation about the x-negated axis, whose quaternion is exactly
 *  (qx,−qy,−qz,qw). Confirmed by manifest.json coordinateConvention ("quat
 *  (x,-y,-z,w)"). Consequence for yaw: unity +90° about Y → three −90°. */
export function mirrorQuat(q: { x: number; y: number; z: number; w: number }): {
  x: number; y: number; z: number; w: number;
} {
  return { x: q.x, y: -q.y, z: -q.z, w: q.w };
}

/** First clip whose name is exactly `suffix` or ends with `_suffix` /
 *  `/suffix` (exact tail — 'walk' never matches 'walk_01'). */
export function findClipBySuffix(
  clips: THREE.AnimationClip[],
  suffix: string,
): THREE.AnimationClip | null {
  for (const c of clips) {
    if (c.name === suffix) return c;
  }
  for (const c of clips) {
    if (c.name.endsWith(`_${suffix}`) || c.name.endsWith(`/${suffix}`)) return c;
  }
  return null;
}

/** Effect labels that run until the owner frees them (status / sink / drown loops). Everything else is a momentary trigger. */
const CONTINUOUS_FX_LABELS: ReadonlySet<string> = new Set(['Fire', 'Ice', 'Drowning', 'Sink']);

export class EnemyStageView implements EnemyViewerContract {
  /** Wrapper group — add to (or remove from) your THREE.Scene via the factory. */
  readonly root: THREE.Group;
  readonly transform: {
    position: Vector3Like;
    rotation: { x: number; y: number; z: number; w: number };
  };
  readonly gameObject: { activeSelf: boolean; setActive(value: boolean): void };

  readonly isSlopeMovement = false; // view.IsSlopeMovement — see header notes
  readonly slopeDownSpeedScale = 1;
  readonly slopeDownAngle = 30;
  readonly slopeUpSpeedScale = 1;
  readonly slopeUpAngle = 30;

  private readonly mixer: THREE.AnimationMixer;
  private readonly rig: CharacterRig;
  private readonly characterDuck: CharacterTransformContract;
  private simSource: (() => EnemySimSource | null) | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentState: EnemyAnimState | 'custom' | null = null;
  /** Remaining one-shot chain (death/land sequences). */
  private chain: THREE.AnimationClip[] = [];
  private deathPlayed = false;
  /** Controller-driven mode (attachAnimator): Q4.EnemyBase port + Animator state machine. */
  base: EnemyBaseView | null = null;
  animator: EnemyAnimator | null = null;

  /** Q4.EnemyBase.expValue @0x28 (EXP banked by the killing tower). */
  expValue = 10;

  constructor(rig: CharacterRig) {
    this.rig = rig;
    this.root = rig.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.mixer.addEventListener('finished', () => this.playChainNext());

    const root = this.root;
    this.transform = {
      get position(): Vector3Like {
        // three RH → unity LH (mirror x back)
        return { x: -root.position.x, y: root.position.y, z: root.position.z };
      },
      set position(v: Vector3Like) {
        root.position.set(-v.x, v.y, v.z);
      },
      get rotation() {
        return mirrorQuat(root.quaternion);
      },
      set rotation(q: { x: number; y: number; z: number; w: number }) {
        const m = mirrorQuat(q);
        root.quaternion.set(m.x, m.y, m.z, m.w);
      },
    };
    this.gameObject = {
      get activeSelf(): boolean {
        return root.visible;
      },
      setActive(value: boolean): void {
        root.visible = value;
      },
    };

    // "Character"-tagged model duck: the sim only reads
    // gameObject.GetComponentInChildren<Renderer>().bounds (size/extents) for
    // the spawn-time Cylinder.fromBounds collision-scale computation.
    const size = new THREE.Vector3();
    rig.modelBounds.getSize(size);
    const bounds = {
      size: { x: size.x, y: size.y, z: size.z },
      extents: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
    };
    this.characterDuck = {
      gameObject: { getComponentInChildrenRenderer: () => ({ bounds }) },
    };
  }

  // ---- contract component lookups (documented defaults, see header) ----

  /** Q4.Balloon: BalloonsRemaining = Balloons.Length (3), hp 225 on all 12 balloon prefabs
   *  (decomp/data/enemies_Balloon.json; Q4.Balloon @…c:57). Only balloon-spawn enemies carry one. */
  getComponentInChildrenBalloon(): BalloonContract | null {
    if (!(this.rig.defName in BALLOON_ENEMIES)) return null;
    // The balloon GameObject is the enemy's attack point while it floats: it carries its OWN EnemyAttributesSettings.
    const balloonGo = { ...this.gameObject, getComponentEnemyAttributesSettings: () => balloonAttributes() };
    return { balloonsRemaining: 3, hp: 225, gameObject: balloonGo };
  }

  findTransformWithTag(tag: string): CharacterTransformContract | null {
    // TS ADAPTATION of GameObjectHelper.FindTransformWithTag(go, Tags.Character):
    // only the 'Character' tag exists in this reconstruction.
    return tag === 'Character' ? this.characterDuck : null;
  }

  /** Boss weak points: the prefab's "AttackPoint" children (src/data/enemyAttributes.ts enemyAttackPointsFor). */
  attackPoints(): EnemyAttackPointViewContract[] | null {
    return enemyAttackPointsFor(this.rig.defName);
  }

  /** Serialized Q4.EnemyAttributesSettings (strength/class damage tables) of this prefab
   *  (src/data/enemyAttributes.ts; docs/STAGE_GAMEPLAY_AUDIT.md). */
  getComponentEnemyAttributesSettings(): EnemyAttributesSettingsContract | null {
    return enemyAttributesFor(this.rig.defName);
  }

  // ---- animation + per-frame update (view-side; no sim contract) ----

  /** Optional pull-source the integration lane binds after the sim object
   *  exists (the spawn ctor runs BEFORE the GameCoreEnemy is fully wired). */
  bindSimSource(provider: (() => EnemySimSource | null) | null): void {
    this.simSource = provider;
  }

  /** Play a semantic state (walk/idle/fly/death…). Unknown clips no-op with a
   *  console note (missing baked channel → documented fallback to idle). */
  setAnimState(state: EnemyAnimState): void {
    if (this.currentState === state && state !== 'attack') return;
    const clips = SUFFIXES[state]
      .map((s) => findClipBySuffix(this.rig.clips, s))
      .filter((c): c is THREE.AnimationClip => c !== null);
    if (clips.length === 0) {
      if (state !== 'idle') this.setAnimState('idle');
      return;
    }
    this.currentState = state;
    this.playClip(clips[0], clips.length > 1);
    this.chain = clips.slice(1);
  }

  /** Switch to the original's controller-driven animation: the serialized
   *  AnimatorController of this enemy's prefab (enemyViewData.generated.ts) drives
   *  the clips; EnemyBaseView feeds it the Q4.EnemyBase parameters. The animator's
   *  cross-fade mix (EnemyAnimator.poses()) is applied to the mixer every frame. */
  attachAnimator(
    controller: EnemyController,
    record: EnemyViewRecord,
    groundY?: (x: number, y: number, z: number) => number | null,
    waterY?: (x: number, y: number, z: number) => number | null,
    balloonRig?: CharacterRig | null,
  ): void {
    this.mixer.stopAllAction();
    this.currentAction = null;
    this.currentState = 'custom';
    this.record = record;
    const host = { clipLength: (name: string): number => this.clipByControllerName(name)?.duration ?? 0 };
    const animator = new EnemyAnimator(controller, host);
    this.animator = animator;
    this.player = new ControllerPlayer(this.root, this.rig.clips, animator, ENEMY_VIEW_DATA.clipEvents, (fn, data) => {
      if (fn === 'TriggerEffect') this.base?.animationEffect(data); // Die / FootPlant / WingFlap = sounds (not ported)
    });
    this.base = new EnemyBaseView({
      root: this.root, animator, record, groundY, waterY,
      fx: { trigger: (label) => this.fxTrigger(label) },
      balloonCount: this.rig.defName in BALLOON_ENEMIES ? 3 : 0,
    });
    const bal = record.balloon;
    const bctl = bal?.controller ? ENEMY_VIEW_DATA.controllers[bal.controller] : undefined;
    if (bal && bctl && balloonRig) {
      this.balloon = new EnemyBalloonRig(balloonRig, bal, bctl, (bone) => {
        const fx = enemyEffects;
        if (fx === null || bal.popEffect === null) return;
        bone.updateWorldMatrix(true, false);
        fx.spawn(bal.popEffect, { worldPosition: (o) => bone.getWorldPosition(o), worldQuaternion: (o) => bone.getWorldQuaternion(o) });
      });
      this.root.add(balloonRig.root);
      this.base.onBalloonsPopped = (before, count) => this.balloon?.pop(before, count);
    }
    this.applyPoses();
  }

  /** Q4.Balloon rig riding on the raised hand (balloon-spawn enemies). */
  balloon: EnemyBalloonRig | null = null;

  private clipByControllerName(name: string): THREE.AnimationClip | null {
    const n = name.replace(/ \[data\]$/, '');
    return this.rig.clips.find((c) => c.name === n) ?? null;
  }

  private player: ControllerPlayer | null = null;
  private applyPoses(): void { this.player?.apply(); }

  // ---- Q4.ParticleGroupEvent.TriggerEffect + clip AnimationEvents ----

  private record: EnemyViewRecord | null = null;
  private readonly boneCache = new Map<string, THREE.Object3D>();

  private bone(name: string): THREE.Object3D {
    let b = this.boneCache.get(name);
    if (b === undefined) { b = this.root.getObjectByName(name) ?? this.root; this.boneCache.set(name, b); }
    return b;
  }

  /** ParticleGroupEvent.TriggerEffect(label): the prefab mapped to `label`, attached to the mapped bone. */
  fxTrigger(label: string): EnemyFxHandle | null {
    const fx = enemyEffects;
    const m = this.record?.fx.find((x) => x.label === label);
    if (fx === null || m === undefined) return null;
    const b = this.bone(m.bone);
    b.updateWorldMatrix(true, false);
    return fx.spawn(m.effect, {
      worldPosition: (o) => b.getWorldPosition(o),
      worldQuaternion: (o) => b.getWorldQuaternion(o),
    }, 1, !CONTINUOUS_FX_LABELS.has(label));
  }

  /** Direct clip playback by exact GLB clip name (dev/lab harness). */
  playClipByName(name: string): boolean {
    const clip = this.rig.clips.find((c) => c.name === name);
    if (!clip) return false;
    this.currentState = 'custom';
    this.chain = [];
    this.playClip(clip, false);
    return true;
  }

  /** GLB def / prefab name (e.g. kuri_00_001). */
  get defName(): string {
    return this.rig.defName;
  }

  clipNames(): string[] {
    return this.rig.clips.map((c) => c.name);
  }

  get animState(): string | null {
    if (this.animator !== null) return this.animator.currentName;
    return this.currentState;
  }

  /** Advance the mixer + pull from the bound sim source. Call once per frame. */
  update(dt: number): void {
    if (this.base !== null) {
      const src = this.simSource?.() ?? null;
      let frame: EnemyFrameInput | null = null;
      if (src !== null && src.alive !== false) {
        frame = {
          position: src.position, previousPosition: src.previousPosition ?? src.position, speedCur: src.speedCur ?? 1,
          groundOffsetY: src.groundOffsetY, slowMode: src.slowMode, damagedMode: src.damagedMode,
          air: src.enemyMoveType === 2, isBalloon: src.isBalloon,
        };
      }
      this.base.update(dt, frame);
      this.applyPoses();
      if (this.balloon !== null && this.record?.balloon) {
        this.balloon.update(dt, this.root, this.bone(this.record.balloon.enemyAttachBone));
        if (this.balloon.isDestroyed) this.balloon = null;
      }
      // IsCrumbleDeath (giants): QGames.CrumbleAnimator breaks the body into debris parts; not ported - the body
      // is dissolved behind the Die poof instead (approximation, docs/ENEMY_BOSS_VIEW_ANALYSIS.md).
      const ct = this.base.crumbleT;
      if (ct >= 0) { const k = Math.max(0, 1 - ct / CRUMBLE_DISSOLVE_SECONDS); this.root.scale.setScalar(k * k); }
      return;
    }
    this.mixer.update(dt);
    const src = this.simSource?.() ?? null;
    if (src === null) return;
    this.transform.position = src.position;
    if (src.moveVector && (src.moveVector.x !== 0 || src.moveVector.z !== 0)) {
      // Face the (mirrored) three-space travel direction; rigs are +Z-forward
      // (Unity LookRotation(moveVector) facing, mirrored — GameCoreEnemy
      // .ctor @004ad0e0: rotation = LookRotation(m_moveVector, up)). lookAt
      // takes a WORLD-space target, so build it from the world position —
      // the parent chain may carry a transform. Horizontal only: y is kept
      // level (the original faces along the ground path, not up slopes).
      const d = src.moveVector;
      this.root.getWorldPosition(_enemyWorldPos);
      _enemyLookTarget.set(_enemyWorldPos.x - d.x, _enemyWorldPos.y, _enemyWorldPos.z + d.z);
      this.root.lookAt(_enemyLookTarget);
    }
    if (src.m_life !== undefined && src.m_life <= 0 && !this.deathPlayed) {
      this.deathPlayed = true;
      this.setAnimState('dieSmall');
    } else if (src.m_life === undefined || src.m_life > 0) {
      // air move type (EEnemyMoveTypeDef.air = 2; ground = 1 — the old `=== 1` test
      // made every GROUND enemy play the fly clip = "arm in the air" bug) → fly; else keep walk/idle.
      const want: EnemyAnimState = src.enemyMoveType === 2 ? 'fly' : 'walk';
      if (this.currentState === null || this.currentState === 'custom') {
        this.setAnimState(want);
      }
    }
  }

  /** Remove from the scene. Geometry/materials are shared with the library
   *  template — they are freed by CharacterLibrary.dispose(), not here. */
  dispose(): void {
    this.base?.freeEffects();
    this.mixer.stopAllAction();
    this.player?.dispose();
    this.root.removeFromParent();
  }

  private playClip(clip: THREE.AnimationClip, clamp: boolean): void {
    const action = this.mixer.clipAction(clip);
    action.reset();
    if (clamp) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    if (this.currentAction !== null && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, 0.15, false);
    }
    action.play();
    this.currentAction = action;
  }

  private playChainNext(): void {
    const next = this.chain.shift();
    if (!next) return;
    this.playClip(next, true); // every chain link is a one-shot; tail clamps
  }
}

let enemyEffects: EnemyEffects | null = null;
/** Effect player used by every enemy view (Q4.ParticleGroupEvent). Null = no particles. */
export function setEnemyEffects(e: EnemyEffects | null): void { enemyEffects = e; }

let enemyWaterProbe: ((x: number, y: number, z: number) => number | null) | null = null;
/** Water surface height (three space) under a point (StateDrown raycasts WaterMask). */
export function setEnemyWaterProbe(fn: ((x: number, y: number, z: number) => number | null) | null): void {
  enemyWaterProbe = fn;
}

let enemyGroundProbe: ((x: number, y: number, z: number) => number | null) | null = null;
/** Ground height (three space) under a point, used by the corpse physics
 *  (StateDead raycasts down on LargeTerrainMask). Optional. */
export function setEnemyGroundProbe(fn: ((x: number, y: number, z: number) => number | null) | null): void {
  enemyGroundProbe = fn;
}

/** q4-contracts `setEnemyViewerFactory` implementation. The library must be
 *  preloaded (loadMany) — the contract factory is synchronous. Returns null
 *  for unknown defs, which is the sim's faithful "no view" early-out path.
 *  Note: the sim ctor itself calls registerUnityObject (GameCoreEnemy ctor);
 *  this factory only builds + parents the view. */
export function createEnemyViewerFactory(
  library: CharacterLibrary,
  parent: THREE.Object3D,
): (prefab: EnemyBaseContract, handleId: number, position: Vector3Like) => EnemyViewerContract | null {
  return (prefab, _handleId, position) => {
    if (library.get(prefab.name) === null) {
      console.warn(`[EnemyStageView] no GLB cached for '${prefab.name}' — headless view`);
      return null;
    }
    const view = new EnemyStageView(library.instantiate(prefab.name));
    view.expValue = prefab.expValue; // GameCoreTower.OnEnemyDestroy reads EnemyBase.expValue via the viewer (was undefined -> NaN EXP)
    const rec = ENEMY_VIEW_DATA.enemies[prefab.name];
    const ctl = rec?.controller ? ENEMY_VIEW_DATA.controllers[rec.controller] : undefined;
    const brig = rec?.balloon?.prefab && library.get(rec.balloon.prefab) !== null ? library.instantiate(rec.balloon.prefab) : null;
    if (rec && ctl) view.attachAnimator(ctl, rec, (x, y, z) => enemyGroundProbe?.(x, y, z) ?? null, (x, y, z) => enemyWaterProbe?.(x, y, z) ?? null, brig);
    view.transform.position = position;
    parent.add(view.root);
    return view;
  };
}
