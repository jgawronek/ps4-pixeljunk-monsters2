// src/core/GameCoreEnemy.ts
// TypeScript port of decomp/src/GameCore/GameCoreEnemy.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; ~1500-line C# reconstruction,
// RVA 0x4ACDC0..0x4B4DB0). PORTED IN CHUNKS across iterations:
//   iter 12/14/15/16: IsOnFire, CanAttack, IsBoss, Attack, PredictPositionAndDirection
//   iter 17: FULL field block, default ctor @0x4ACDC0 + spawn ctor
//     @0x4AD0E0, all properties/simple getters, attack-point management
//     (InitAttackPoints @0x4AE700 / TickAttackPoints @0x4AEAD0 / ConfigAttackPoints
//     @0x4AF290 / RemoveAllAttackPoints @0x4AF3F0), DestroySelf @0x4AF540,
//     OnGameOver @0x4AF700, OnSpawnGroupStarted @0x4B4D80, RecreateViewer @0x4B2960,
//     IDamageable targeting slots (IsAimableTarget @0x4B1000 / ValidateTarget
//     @0x4B0F70 / Valid @0x4B1060).
//   iter 18 (chunk 2): Tick @0x4AF7F0 + UdpateDrift [sic] @0x4AFE80 + StateWalk
//     @0x4AFF20 + RaycastGroundSlope @0x4B0680 + UpdateGroundOffset @0x4AFC20 +
//     StateAttacking @0x4B0750 + UpdateBlockingEnemies @0x4B2BA0 +
//     LandedOnDeathPath @0x4B4500 + CheckIfDestroy @0x4B0FB0 + BossAI @0x4B0960 +
//     BossAITerrainDetection @0x4B4BD0 + PopBalloons @0x4B0D00 + DrownDetection
//     @0x4B0E50 + Drown @0x4B10C0 + DealDamage @0x4B1200/0x4B13E0 +
//     DealPlayerDamage @0x4B21B0 + KillOtherEnemiesOnBossDeath + TriggerJumpReaction.
//   The enemy module is now COMPLETE except upstream gaps (Projectile
//   Lightning/Insect full bodies are skeletons; their instanceof dispatch works).
//
// TS ADAPTATIONS: EnemyBase prefab/viewer → contracts + factory hook (headless
// default null → the ctor's faithful early-out); DifficultySettings.EnemyHPByDifficulty
// → getEnemyHPByDifficulty (data-verified SP default Max(1, trunc(0.9×v)));
// C# struct m_orientationInterpolator default → null + zero TerrainInfo getter;
// protected backing fields where tests need the post-spawn state (documented).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import {
  getAISettings,
  getDebugCanvas,
  getEnemyHPByDifficulty,
  getMonstersAudio,
  instantiateEnemyViewer,
  notifyChibiAvoidanceZone,
  registerUnityObject,
  type AttackPointSettingContract,
  type CatmullCurveContract,
  type EnemyAttributesSettingsContract,
  type EnemyBaseContract,
  type EnemyViewerContract,
  type EnemyViewContract,
} from '../view/q4-contracts';
import { AIHelper, TerrainOrientationInterpolator, TerrainInfo, type BlockingInfo } from './AIHelper';
import { BuffContainer } from './BuffContainer';
import { BuffFastPlayer } from './BuffFastPlayer';
import { CorePathMove } from './CorePathMove';
import { Cylinder } from './Cylinder';
import { DamageHelper } from './DamageHelper';
import { EBossType, EEnemyClassTypeDef, EEnemyMoveTypeDef, EEnemyStrengthTypeDef, EPathSegType, ESpawnMode } from './enums';
import { EnemyHitInfo } from './EnemyHitInfo';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreEnemyAttackPoint } from './GameCoreEnemyAttackPoint';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCoreProjectile } from './GameCoreProjectile';
import { GameCoreProjectileInsect } from './GameCoreProjectileInsect';
import { GameCoreProjectileLightning } from './GameCoreProjectileLightning';
import type { ChibiData, GameCoreHome } from './GameCoreHome';
import type { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreTower } from './GameCoreTower';
import type { IBuffs, IDamageable, ISpeedScale } from './interfaces';
import { getSimPhysics, Q4Layers } from './physics-seam';

const f = Math.fround;

function toV3(v: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export class GameCoreEnemy extends GameCoreObject implements IBuffs, IDamageable, ISpeedScale {
  private static readonly secondsBetweenAvoidanceUpdates = f(0.5);

  enemyMoveType: EEnemyMoveTypeDef; // 0x60 (public field)
  private m_prefabName: string | null = null; // 0x68
  private m_life = f(0); // 0x70
  private m_maxLife = f(0); // 0x74
  private m_vulnerableDamageTaken = f(0); // 0x78
  pathMove: CorePathMove | null = null; // 0x80 (C# private; harness-settable)
  /** C#: List<PathEdit.EPathSegType> — enum values; PathEdit port pending. */
  private m_segTypeInfos: number[] | null = null; // 0x88
  private m_pathName: string | null = null; // 0x90
  protected m_isBoss = false; // 0x98
  private m_isJumpingBoss = false; // 0x99
  private m_bossType: EBossType = EBossType.None; // 0x9C
  protected m_canAttack = false; // 0xA0
  protected m_attackDelay = f(0); // 0xA4
  protected m_attackFreq = f(0); // 0xA8
  private BossAttackDur = f(0); // 0xAC [C# casing]
  private BossAttackDist = f(0); // 0xB0
  private BossAttackHeightForward = f(0); // 0xB4
  private BossAttackHeightBack = f(0); // 0xB8
  protected m_isAttacking = false; // 0xBC
  private m_tookDamageThisFrame = false; // 0xBD
  protected m_distance = f(0); // 0xC0
  private m_coinValue = 0; // 0xC4
  private m_gemValue = 0; // 0xC8
  private m_groundOffsetY = f(0); // 0xCC
  private m_groundOffsetDestY = f(0); // 0xD0
  private m_groundOffsetModeHeight = f(0); // 0xD4
  private m_groundOffsetVelY = f(0); // 0xD8
  private m_groundOffsetAccScaleY = f(0); // 0xDC
  private m_groundOffsetVelDamping = f(0); // 0xE0
  private m_groundOffsetBalloonDeltaY = f(0); // 0xE4
  protected m_waveIndex = 0; // 0xE8
  protected m_waveSubIndex = 0; // 0xEC
  protected m_waveSpawnIndex = 0; // 0xF0
  private m_waveDistance = f(0); // 0xF4
  protected m_enemyBlockingMe: GameCoreHandle = GameCoreHandle.nullHandle; // 0xF8
  private m_enemiesBlockedByMe: GameCoreHandle[] = []; // 0x118
  private m_enemyToOvertake: GameCoreHandle = GameCoreHandle.nullHandle; // 0x120
  protected m_moveVector: Vector3 = Vector3.zero; // 0x140
  private m_spawnMinionWaitDur = f(0); // 0x14C
  private m_waitTime = f(0); // 0x150
  private m_speed = f(0); // 0x154
  private m_fireSpeed = f(0); // 0x158
  private m_balloonSpeed = f(0); // 0x15C
  protected m_speedCur = f(0); // 0x160
  protected m_sideOffset = f(0); // 0x164
  private m_sideOffsetCenter = f(0); // 0x168
  private m_detectionTime = f(0); // 0x16C
  private m_driftOffset = f(0); // 0x170
  private m_driftTime = f(0); // 0x174
  private m_driftFreq = f(0); // 0x178
  private m_driftDist = f(0); // 0x17C
  private m_isHeavyEnemy = false; // 0x180
  protected m_isBalloon = false; // 0x181
  private m_startedBalloon = false; // 0x182
  private m_numBalloons = 0; // 0x184
  private m_balloonHP = f(0); // 0x188
  private m_balloonPopHPInterval = f(0); // 0x18C
  private m_isOnFire = false; // 0x190
  private m_isFalling = false; // 0x191
  private m_speedScale = f(0); // 0x194
  private m_lowHpThreshold = f(0); // 0x198
  private m_lowHpSpeed = f(0); // 0x19C
  private m_damagedHpThreshold = f(0); // 0x1A0
  protected m_buffs: BuffContainer | null = null; // 0x1A8
  protected m_attackPoints: GameCoreHandle[] | null = null; // 0x1B0
  private m_blockingInfo: BlockingInfo | null = null; // 0x1B8
  private m_sounds: unknown = null; // 0x1C0 (AudioEventHandler.Sounds)
  /** C# struct field (default = zeroed struct); TS: null until the spawn ctor. */
  private m_orientationInterpolator: TerrainOrientationInterpolator | null = null; // 0x1C8
  private m_restDur = f(0); // 0x250
  private m_jumpDur = f(0); // 0x254
  private m_restTime = f(0); // 0x258
  private m_jumpTime = f(0); // 0x25C
  private m_drownDepth = f(0); // 0x260
  protected m_ChibiAvoidRadius = f(0); // 0x264
  protected m_ChibiAvoidDur = f(0); // 0x268
  private m_enemyTrackerEnable = false; // 0x26C (auto-property, private set)
  private m_isMinion = false; // 0x26D (auto-property, protected set)
  m_IsGameOver = false; // 0x26E (public field, C# casing)
  private m_attackHomeHandle: GameCoreHandle = GameCoreHandle.nullHandle; // 0x270
  private m_attackChibi: ChibiData | null = null; // 0x290
  private m_bossAttackEffectTriggered = false; // 0x298
  protected m_bossAttacking = false; // 0x299
  private m_bossAttackTime = f(0); // 0x29C

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onGameOverListener = (): void => this.onGameOver();
  private readonly m_onSpawnGroupStartedListener = (
    a_id: number,
    a_enemy: GameCoreEnemy,
    a_pos: Vector3,
    a_isMinion: boolean,
  ): void => this.onSpawnGroupStarted(a_id, a_enemy, a_pos, a_isMinion);

  // .ctor @0x4ACDC0 (pool default) + .ctor @0x4AD0E0 (spawn) — TS: one
  // implementation with optional spawn params; C# chains spawn → default.
  constructor(
    enemyPrefab?: EnemyBaseContract | null,
    pathCurve?: CatmullCurveContract | null,
    segTypeInfos?: number[] | null,
    pathStartTime?: number,
    pathName?: string,
    speedRatio?: number,
    hpRatio?: number,
    money?: number,
    gem?: number,
    waveIndex?: number,
    waveSubIndex?: number,
    waveSpawnIndex?: number,
    spawnInterval?: number,
    sideCenterOffset?: number,
    driftDist?: number,
    driftFreq?: number,
    isMinion?: boolean,
    isEnemyTrackEnableOnMe?: boolean,
  ) {
    super();
    // ---- default ctor body @0x4ACDC0 (always runs) ----
    this.enemyMoveType = EEnemyMoveTypeDef.ground;
    this.m_canAttack = true;
    this.m_attackFreq = f(4.0);
    this.BossAttackDur = f(1.0);
    this.BossAttackDist = f(1.5);
    this.BossAttackHeightForward = f(1.5);
    this.BossAttackHeightBack = f(0.5);
    this.m_groundOffsetAccScaleY = f(1.0);
    this.m_groundOffsetVelDamping = f(1.0);
    this.m_waveIndex = -1;
    this.m_waveSubIndex = -1;
    this.m_waveSpawnIndex = -1;
    this.m_waveDistance = f(1.0);
    this.m_enemyBlockingMe = GameCoreHandle.nullHandle;
    this.m_enemiesBlockedByMe = [];
    this.m_enemyToOvertake = GameCoreHandle.nullHandle;
    this.m_moveVector = Vector3.forward;
    this.m_speed = f(1.0);
    this.m_fireSpeed = f(1.0);
    this.m_balloonSpeed = f(1.0);
    this.m_speedScale = f(1.0);
    this.m_restDur = f(1.0);
    this.m_jumpDur = f(0.5);
    this.m_restTime = f(1.0);
    this.m_jumpTime = f(0.5);
    this.m_attackHomeHandle = GameCoreHandle.nullHandle;

    if (enemyPrefab === undefined) return; // pool-default path

    // ---- spawn ctor body @0x4AD0E0 ----
    this.m_enemyTrackerEnable = isEnemyTrackEnableOnMe!;
    this.m_isMinion = isMinion!;
    this.m_sideOffsetCenter = f(sideCenterOffset!);
    this.m_sideOffset = f(sideCenterOffset!);
    this.m_segTypeInfos = segTypeInfos ?? null;

    if (pathCurve == null) return; // reconstruction: early-out on null path

    this.m_distance = f(pathCurve.nodeTimeToDistance(pathStartTime!));
    this.position = toV3(pathCurve.sampleLinearDistance(this.m_distance));
    if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);

    if (enemyPrefab == null) return;

    this.m_prefabName = enemyPrefab.name;
    // C#: Object.Instantiate(enemyPrefab, position, Quaternion.identity) + SetUnityObject
    const view = instantiateEnemyViewer(enemyPrefab, this.handle.m_handle, this.position);
    registerUnityObject(this.handle.m_handle, view);
    if (view === null) return;

    // Collision cylinder from the rendered bounds of the "Character"-tagged model.
    const charTransform = view.findTransformWithTag('Character'); // Tags.Character
    if (charTransform === null) return;
    const modelRenderer = charTransform.gameObject.getComponentInChildrenRenderer();
    if (modelRenderer === null) return;

    this.collision = Cylinder.fromBounds(modelRenderer.bounds);
    if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
    this.m_isHeavyEnemy = this.collision.height >= 0.99;
    this.collision = new Cylinder(
      f(this.collision.radius * enemyPrefab.collisionScaleH),
      f(this.collision.height * enemyPrefab.collisionScaleV),
    );
    if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);

    // Initial facing from the path tangent.
    const t = pathCurve.distanceToTime(this.m_distance, f(-1.0));
    const vel = toV3(pathCurve.sampleVelDirect(t));
    this.m_moveVector = Vector3.Normalize(new Vector3(vel.x, 0.0, vel.z));
    const rot = Quaternion.LookRotation(this.m_moveVector, Vector3.up);
    view.transform.rotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

    this.pathMove = new CorePathMove(pathCurve);
    this.m_pathName = pathName!;
    this.m_speed = f(speedRatio! * enemyPrefab.speed);
    this.m_fireSpeed = f(speedRatio! * enemyPrefab.fireSpeed);
    this.m_balloonSpeed = f(speedRatio! * enemyPrefab.balloonSpeed);
    if (!this.m_isBalloon) {
      this.m_speedCur = f((this.m_isOnFire ? this.m_fireSpeed : this.m_speed) * this.m_speedScale);
    }
    this.m_speedScale = f(1.0);

    this.m_lowHpThreshold = f(getEnemyHPByDifficulty(f(enemyPrefab.lowHPThreshold * hpRatio!)));
    this.m_lowHpSpeed = f(enemyPrefab.lowHPSpeed);
    this.m_damagedHpThreshold = f(getEnemyHPByDifficulty(f(enemyPrefab.damagedHpThreshold * hpRatio!)));
    this.m_maxLife = f(getEnemyHPByDifficulty(f(hpRatio! * enemyPrefab.maxLife)));
    this.m_life = this.m_maxLife;
    this.m_vulnerableDamageTaken = f(0.0);
    this.m_coinValue = money! | 0;
    this.m_gemValue = gem! | 0;

    const spawnMode = enemyPrefab.spawnMode;
    this.m_isOnFire = spawnMode === ESpawnMode.Fire;
    this.m_isBalloon = spawnMode === ESpawnMode.Balloon;
    this.m_startedBalloon = spawnMode === ESpawnMode.Balloon;
    this.m_groundOffsetAccScaleY = f(enemyPrefab.balloonAccScale);
    this.m_groundOffsetVelDamping = f(enemyPrefab.balloonDamping);
    this.m_groundOffsetModeHeight = f(enemyPrefab.balloonHeight);
    if (this.m_isBalloon) {
      this.enemyMoveType = EEnemyMoveTypeDef.air;
      this.m_groundOffsetDestY = f(enemyPrefab.balloonHeight);
      this.m_groundOffsetY = f(enemyPrefab.balloonSpawnHeight);
      const balloon = view.getComponentInChildrenBalloon();
      if (balloon !== null) {
        this.m_numBalloons = balloon.balloonsRemaining | 0;
        this.m_balloonHP = f(balloon.hp);
        if (this.m_numBalloons < 1) {
          this.m_balloonPopHPInterval = f(0.0);
          this.m_groundOffsetBalloonDeltaY = f(0.0);
        } else {
          this.m_balloonPopHPInterval = f(this.m_balloonHP / this.m_numBalloons);
          this.m_groundOffsetBalloonDeltaY =
            this.m_numBalloons !== 1 ? f(this.m_groundOffsetDestY / (this.m_numBalloons + 1)) : f(0.0);
        }
      }
    } else {
      this.enemyMoveType = enemyPrefab.enemyMoveType;
      this.m_groundOffsetY = f(enemyPrefab.groundOffsetY);
      this.m_groundOffsetDestY = f(enemyPrefab.groundOffsetY);
    }

    this.position = this.position.add(Vector3.up.mulScalar(this.m_groundOffsetY));
    if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
    view.transform.position = this.position;

    this.m_waveIndex = waveIndex! | 0;
    this.m_waveSubIndex = waveSubIndex! | 0;
    this.m_waveSpawnIndex = waveSpawnIndex! | 0;
    const spd = this.m_isBalloon
      ? this.m_balloonSpeed
      : f((this.m_isOnFire ? this.m_fireSpeed : this.m_speed) * this.m_speedScale);
    this.m_waveDistance = f(spd * spawnInterval!);

    this.m_buffs = new BuffContainer();
    this.m_drownDepth = f(enemyPrefab.drownDepth);
    this.m_driftDist = f(driftDist!);
    this.m_driftFreq = f(driftFreq! * Mathf.Deg2Rad);
    this.m_isBoss = enemyPrefab.isBoss;
    this.m_isJumpingBoss = enemyPrefab.isJumpingBoss;
    this.m_bossType = enemyPrefab.bossType;
    this.m_restDur = f(enemyPrefab.bossRestDur);
    this.m_jumpDur = f(enemyPrefab.bossJumpDur);
    this.m_restTime = this.m_restDur;
    this.m_jumpTime = f(0.0);
    this.m_attackFreq = f(enemyPrefab.attackFreq);
    this.BossAttackDur = f(enemyPrefab.bossAttackDur);
    this.BossAttackDist = f(enemyPrefab.bossAttackDist);
    this.BossAttackHeightForward = f(enemyPrefab.bossAttackHeightForward);
    this.BossAttackHeightBack = f(enemyPrefab.bossAttackHeightBack);
    this.m_spawnMinionWaitDur = f(enemyPrefab.bossSpawnWaitDur);

    this.m_orientationInterpolator = new TerrainOrientationInterpolator(this);

    if (!this.m_isBalloon) {
      this.initAttackPoints(view);
    } else {
      this.m_attackPoints = []; // C#: new List(1)
      const balloon = view.getComponentInChildrenBalloon();
      const localPos = Vector3.up.mulScalar(enemyPrefab.balloonTargetHeight);
      // FAITHFUL: balloon dereferenced without a null check here.
      const ap = new GameCoreEnemyAttackPoint(this, 0.25, balloon!.gameObject, localPos, null);
      this.m_attackPoints.push(ap.handle);
    }
    this.tickAttackPoints(0.0);

    Events.gameOverEvent.addListener(
      this.m_onGameOverListener,
      EventTime.PostGameCoreTick,
      this.handle.m_handle,
    );
    if (this.m_isBoss) {
      Events.spawnGroupStartedEvent.addListener(
        this.m_onSpawnGroupStartedListener,
        EventTime.PostGameCoreTick,
        this.handle.m_handle,
      );
    }
    this.m_attackDelay = f(1.0);
    this.m_canAttack = false;
    this.m_sounds = enemyPrefab.sounds;
    this.m_ChibiAvoidRadius = f(enemyPrefab.chibiAvoidRadius);
    // FAITHFUL QUIRK (verified in reconstruction): the decompilation reads
    // ChibiAvoidRadius (0x12C) for BOTH fields here.
    this.m_ChibiAvoidDur = f(enemyPrefab.chibiAvoidRadius);
  }

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  // get_CanAttack @0x4AEC90 — first access announces the chibi-avoidance zone.
  get canAttack(): boolean {
    if (!this.m_canAttack) {
      notifyChibiAvoidanceZone(
        { x: this.position.x, y: this.position.y, z: this.position.z },
        this.m_ChibiAvoidRadius,
        this.m_ChibiAvoidDur,
      );
      this.m_canAttack = true;
    }
    return this.m_attackDelay <= 0.0;
  }

  // get_CanAttackInternal @0x4AED50 (private)
  private get canAttackInternal(): boolean {
    return this.m_attackDelay <= 0.0;
  }

  // get_IsBoss @0x4AEE60
  get isBoss(): boolean {
    return this.m_isBoss;
  }
  // C# cross-class field reads (same assembly): WaveManager reads these
  // directly — TS exposes them as read-only getters. No C# property exists.
  get life(): number {
    return this.m_life; // 0x70
  }
  get distance(): number {
    return this.m_distance; // 0xC0
  }
  get waveIndex(): number {
    return this.m_waveIndex; // 0xE8
  }
  // get_IsSlowMode @0x4AEE70
  get isSlowMode(): boolean {
    return this.m_lowHpThreshold <= this.m_vulnerableDamageTaken;
  }
  // get_IsDamagedMode @0x4AEE90
  get isDamagedMode(): boolean {
    return this.m_damagedHpThreshold <= this.m_vulnerableDamageTaken;
  }
  // get_Speed @0x4AE3A0
  get speed(): number {
    if (this.m_isBalloon) return this.m_balloonSpeed;
    return f((this.m_isOnFire ? this.m_fireSpeed : this.m_speed) * this.m_speedScale);
  }
  // get_SpeedCur @0x4AEEB0
  get speedCur(): number {
    return this.m_speedCur;
  }
  // get_terrainOrientation @0x4AEEC0 — C# struct default → zeroed TerrainInfo.
  get terrainOrientation(): TerrainInfo {
    return this.m_orientationInterpolator !== null
      ? this.m_orientationInterpolator.interpolatedSample
      : new TerrainInfo();
  }
  // get_MoveVec @0x4AEEF0
  get moveVec(): Vector3 {
    return this.m_moveVector;
  }
  // get_IsBalloon @0x4AEF10
  get isBalloon(): boolean {
    return this.m_isBalloon;
  }
  // get_IsOnFire @0x4AEF20 / set_IsOnFire @0x4AEF30
  get isOnFire(): boolean {
    return this.m_isOnFire;
  }
  set isOnFire(value: boolean) {
    // FAITHFUL: extinguishing (true → false) notifies the view.
    if (this.m_isOnFire && !value) {
      Events.onFireExtinguished.invoke(this); // Events statics +0x170
    }
    this.m_isOnFire = value;
  }
  // get_IsAntiMagic @0x4AEFD0 / get_IsAntiPhysics @0x4AF050
  get isAntiMagic(): boolean {
    return DamageHelper.weakDamageClassTypes(this.getUnityObject() as EnemyViewContract).includes(
      EEnemyClassTypeDef.Magic,
    );
  }
  get isAntiPhysics(): boolean {
    return DamageHelper.weakDamageClassTypes(this.getUnityObject() as EnemyViewContract).includes(
      EEnemyClassTypeDef.Physic,
    );
  }
  // get_WaveID @0x4AF0D0
  get waveID(): number {
    return this.m_waveIndex;
  }
  // get_WaveGroupID @0x4AF0E0
  get waveGroupID(): number {
    return (this.m_waveIndex * 10000 + this.m_waveSubIndex) | 0;
  }
  // get_WaveSpawnIndex @0x4AF100
  get waveSpawnIndex(): number {
    return this.m_waveSpawnIndex;
  }
  // get_EnemyBlockingMe @0x4AF110 / get_EnemyBlockedByMe @0x4AF120
  get enemyBlockingMe(): GameCoreHandle {
    return this.m_enemyBlockingMe;
  }
  get enemyBlockedByMe(): GameCoreHandle[] {
    return this.m_enemiesBlockedByMe;
  }
  // get_Buffs @0x4AF130 (IBuffs)
  get buffs(): BuffContainer {
    return this.m_buffs!; // C#: null until spawned
  }
  // get_AttackPoints @0x4AF140
  get attackPoints(): GameCoreHandle[] | null {
    return this.m_attackPoints;
  }
  // get_PathDistance @0x4AF150
  get pathDistance(): number {
    return this.m_distance;
  }
  // get_GroundOffsetY @0x4AF160
  get groundOffsetY(): number {
    return this.m_groundOffsetY;
  }
  // get_SideOffsetCenter @0x4AF170 (private)
  private get sideOffsetCenter(): number {
    return f(this.m_sideOffsetCenter + this.m_driftOffset);
  }
  // internal SideOffset accessor (INFERRED cross-class read by AttackPoint)
  get sideOffset(): number {
    return this.m_sideOffset;
  }
  // get_IsBlocked @0x4AF190
  get isBlocked(): boolean {
    return !this.m_enemyBlockingMe.isNull;
  }
  // get_PathMove @0x4AF260 / get_PathName @0x4AF270 / get_IsHeavyEnemy @0x4AF280
  get pathName(): string | null {
    return this.m_pathName;
  }
  get isHeavyEnemy(): boolean {
    return this.m_isHeavyEnemy;
  }
  get enemyTrackerEnable(): boolean {
    return this.m_enemyTrackerEnable;
  }
  get isMinion(): boolean {
    return this.m_isMinion;
  }

  // ---------------------------------------------------------------------------
  // Simple getters / setters
  // ---------------------------------------------------------------------------

  // IsSameEnemyWaveGroup @0x4AF220
  isSameEnemyWaveGroup(a_other: GameCoreEnemy): boolean {
    return this.waveGroupID === a_other.waveGroupID;
  }
  // Host @0x4AF760 (IDamageable) — an enemy is its own host.
  host(): GameCoreEnemy {
    return this;
  }
  // GetCoinValue @0x4AF770 / GetGemValue @0x4AF780 / GetWaveIndex @0x4AF790
  getCoinValue(): number {
    return this.m_coinValue;
  }
  getGemValue(): number {
    return this.m_gemValue;
  }
  getWaveIndex(): number {
    return this.m_waveIndex;
  }
  // GetLife @0x4AF7A0 / GetVulnerableDamageTaken @0x4AF7B0 / GetMaxLife @0x4AF7C0
  getLife(): number {
    return this.m_life;
  }
  getVulnerableDamageTaken(): number {
    return this.m_vulnerableDamageTaken;
  }
  getMaxLife(): number {
    return this.m_maxLife;
  }
  // GetSpeedScale @0x4AF7D0 / SetSpeedScale @0x4AF7E0 (ISpeedScale)
  getSpeedScale(): number {
    return this.m_speedScale;
  }
  setSpeedScale(scale: number): void {
    this.m_speedScale = f(scale);
  }
  // IDamageable slots 4/5/7 (Collision/Position/Handle) → inherited properties.
  // UnityObject @0x4B4DA0 (slot 8)
  unityObject(): unknown | null {
    return this.getUnityObject();
  }
  // MoveType @0x4B4DB0 (slot 9)
  moveType(): EEnemyMoveTypeDef {
    return this.enemyMoveType;
  }

  // ---------------------------------------------------------------------------
  // Attack points
  // ---------------------------------------------------------------------------

  // InitAttackPoints @0x4AE700
  private initAttackPoints(enemyViewer: EnemyViewerContract): void {
    const pointViews = enemyViewer.attackPoints();
    if (pointViews !== null) {
      this.m_attackPoints = [];
      for (const pointView of pointViews) {
        // C#: GetComponent<Collider>() → (SphereCollider)col.radius; default 0.5.
        const radius = pointView.getComponentSphereColliderRadius() ?? f(0.5);
        const lp = pointView.transform.localPosition;
        const localPos = new Vector3(lp.x, lp.y, lp.z);
        const setting: AttackPointSettingContract | null = pointView.getComponentAttackPointSetting();
        const ap = new GameCoreEnemyAttackPoint(this, radius, pointView, localPos, setting);
        this.m_attackPoints.push(ap.handle);
      }
    }
    // Kao / Fat bosses enable only the attack points matching their move type.
    if (this.m_isBoss && (this.m_bossType === EBossType.Kao || this.m_bossType === EBossType.Fat)) {
      if (this.enemyMoveType === EEnemyMoveTypeDef.air) {
        this.configAttackPoints(EEnemyMoveTypeDef.ground, false);
        this.configAttackPoints(EEnemyMoveTypeDef.air, true);
      } else if (this.enemyMoveType === EEnemyMoveTypeDef.ground) {
        this.configAttackPoints(EEnemyMoveTypeDef.ground, true);
        this.configAttackPoints(EEnemyMoveTypeDef.air, false);
      }
    }
  }

  // TickAttackPoints @0x4AEAD0 — keep points glued to the host (dt unused).
  private tickAttackPoints(_dt: number): void {
    if (this.m_attackPoints === null) return;
    for (let i = 0; i < this.m_attackPoints.length; i++) {
      const ap = this.m_attackPoints[i].getMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
      if (ap !== null) {
        ap.position = this.position.add(
          Quaternion.LookRotation(this.m_moveVector).multiplyVector(ap.localPosition),
        );
        if (!ap.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(ap);
      }
    }
  }

  // ConfigAttackPoints @0x4AF290
  private configAttackPoints(a_type: EEnemyMoveTypeDef, a_enable: boolean): void {
    if (this.m_attackPoints === null) return;
    for (const apHandle of this.m_attackPoints) {
      const ap = apHandle.getMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
      if (ap !== null && ap.moveType() === a_type) ap.setAttackPointEnabled(a_enable);
    }
  }

  // RemoveAllAttackPoints @0x4AF3F0
  private removeAllAttackPoints(): void {
    if (this.m_attackPoints === null) return;
    for (const apHandle of this.m_attackPoints) {
      const ap = apHandle.getMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
      if (ap !== null) ap.setAttackPointEnabled(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  // DestroySelf @0x4AF540
  override destroySelf(): void {
    this.removeAllAttackPoints();
    Events.gameOverEvent.removeListener(this.m_onGameOverListener, this.handle.m_handle);
    if (this.m_isBoss) {
      Events.spawnGroupStartedEvent.removeListener(
        this.m_onSpawnGroupStartedListener,
        this.handle.m_handle,
      );
    }
    if (this.m_buffs !== null) this.m_buffs.terminate(this);
    super.destroySelf(); // base cleanup (destroyed flag + de-grid)
  }

  // OnGameOver @0x4AF700 — flag the most recent version of this enemy.
  onGameOver(): void {
    const enemy = this.handle.getMostRecentObjectVersion<GameCoreEnemy>();
    if (enemy !== null) enemy.m_IsGameOver = true;
  }

  // OnSpawnGroupStarted @0x4B4D80 — boss waits before spawning its minion group.
  private onSpawnGroupStarted(
    _a_id: number,
    _a_enemy: GameCoreEnemy,
    _a_pos: Vector3,
    _a_isMinion: boolean,
  ): void {
    this.m_waitTime = this.m_spawnMinionWaitDur;
  }

  // RecreateViewer @0x4B2960
  override recreateViewer(): unknown | null {
    let view = this.getUnityObjectAs<EnemyViewerContract>();
    if (view === null) {
      view = GameCoreObject.createViewerFromPrefabName(this.m_prefabName!) as EnemyViewerContract | null;
    }
    // FAITHFUL: NRE when both lookups fail (return view.gameObject).
    return (view as EnemyViewerContract).gameObject;
  }

  // ---------------------------------------------------------------------------
  // Targeting (IDamageable)
  // ---------------------------------------------------------------------------

  // IsAimableTarget @0x4B1000 — the body is aimable only when it has no attack points.
  isAimableTarget(_tower: GameCoreObject): boolean {
    return this.m_attackPoints === null || this.m_attackPoints.length === 0;
  }

  // ValidateTarget @0x4B0F70 — targetable once past the pre-activation path length.
  validateTarget(): boolean {
    if (this.pathMove === null) return false;
    return this.pathMove.curveLengthBeforeActivation < this.m_distance;
  }

  // Valid @0x4B1060
  valid(): boolean {
    if (this.isDestroyed()) return false;
    return this.m_attackPoints === null || this.m_attackPoints.length === 0;
  }

  // PredictPositionAndDirection @0x4AED70 (IDamageable slot 6)
  // FAITHFUL: pathMove dereferenced without a null check.
  predictPositionAndDirection(aTime: number): { pos: Vector3; direction: Vector3 } {
    const sample = this.pathMove!.sampleWithVel(
      f(f(aTime * this.m_speedCur) + this.m_distance),
      this.m_sideOffset,
    );
    if (!sample.ok) {
      return { pos: this.position, direction: this.m_moveVector };
    }
    return { pos: sample.pos, direction: sample.vel };
  }

  // Attack @0x4B4A20 — called when the enemy reaches the home / a chibi.
  attack(a_home: GameCoreHome, a_chibi: ChibiData): boolean {
    this.m_attackHomeHandle = a_home.handle;
    this.m_attackChibi = a_chibi;
    this.m_canAttack = true;
    if (this.m_attackDelay <= 0.0) {
      Events.enemyAttackedHomeEvent.invoke(this, a_home, a_chibi); // +0x48
      Events.enemyAttackEvent.invoke(this, a_home, a_chibi); // +0x60
      if (this.m_isBoss) {
        this.m_attackDelay = this.m_attackFreq;
        this.m_bossAttacking = true;
        this.m_bossAttackTime = f(0.0);
        this.m_bossAttackEffectTriggered = false;
      }
      this.m_isAttacking = true;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Tick / movement (chunk 2, iter 18)
  // ---------------------------------------------------------------------------

  // Tick @0x4AF7F0 — main per-frame simulation step.
  override tick(): void {
    this.m_tookDamageThisFrame = false;
    if (this.m_IsGameOver) return;

    const dt = GameCore.tickDeltaTime;
    // NOTE: reads the m_canAttack FIELD (not the CanAttack property — no
    // announcement side effect here).
    if (this.m_canAttack) this.m_attackDelay = f(this.m_attackDelay - dt);
    if (this.m_buffs !== null) this.m_buffs.tick(this); // TickBuffs inlined
    this.tickAttackPoints(dt);
    this.updateGroundOffset(dt);

    if (!this.m_isAttacking) {
      this.m_waitTime = Mathf.Max(f(0.0), f(this.m_waitTime - dt));
      if (this.m_waitTime > 0.0 || this.m_canAttack) {
        // Holding position (spawn wait / ready to attack): stay on the path.
        // FAITHFUL: the binary discards Sample's bool result here.
        const s = this.pathMove!.sampleWithVel(this.m_distance, this.m_sideOffset);
        let pos = s.pos;
        if (this.enemyMoveType === EEnemyMoveTypeDef.ground) pos = this.raycastGroundSlope(pos);
        this.position = pos.add(Vector3.up.mulScalar(this.m_groundOffsetY));
        if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
      } else {
        this.udpateDrift(dt);
        this.stateWalk(dt);
      }
    } else {
      this.stateAttacking(dt);
    }

    // C# struct field always ticks; TS null (pool-default) → skip (documented).
    this.m_orientationInterpolator?.tick();
    this.bossAI(dt);

    if (this.m_isBalloon && f(this.pathMove!.pathLength - this.m_distance) < 10.0) {
      this.popBalloons(100000000); // pop all before reaching the home
    }

    this.drownDetection();
    this.checkIfDestroy();
  }

  // CheckIfDestroy @0x4B0FB0
  checkIfDestroy(): void {
    if (this.m_life <= 0.0 && !this.isDestroyed()) this.destroySelf();
  }

  // UdpateDrift @0x4AFE80 [sic — original typo preserved] — sinusoidal lateral drift.
  private udpateDrift(dt: number): void {
    this.m_driftTime = f(this.m_driftTime + f(dt * this.m_driftFreq));
    this.m_driftOffset = f(Mathf.Sin(this.m_driftTime) * this.m_driftDist);
  }

  // StateWalk @0x4AFF20 — avoidance, slope scaling, advance along the path.
  private stateWalk(dt: number): void {
    this.m_detectionTime = f(this.m_detectionTime - dt);
    // NOTE: the C# call-site reconstruction lists (2.5f, Speed, this) — a
    // Ghidra register-order artifact; the metadata signature is
    // (a_me, a_lookAheadDist, a_speed), used here.
    if (this.m_blockingInfo === null) {
      this.m_detectionTime = GameCoreObject.randomRangeF(
        0.0,
        GameCoreEnemy.secondsBetweenAvoidanceUpdates,
        this.handle,
      );
      this.m_blockingInfo = AIHelper.getAvoidanceEnemy(this, 2.5, this.speed);
    } else if (this.m_detectionTime <= 0.0) {
      this.m_detectionTime = GameCoreEnemy.secondsBetweenAvoidanceUpdates;
      this.m_blockingInfo = AIHelper.getAvoidanceEnemy(this, 2.5, this.speed);
    }

    const desired = this.updateBlockingEnemies(this.m_blockingInfo);
    let desiredSpeed = desired.speed;
    const desiredSideDist = desired.sideDist;

    // Slope movement scaling (ground enemies only).
    const view = this.getUnityObjectAs<EnemyViewerContract>();
    if (view !== null && view.isSlopeMovement && this.enemyMoveType === EEnemyMoveTypeDef.ground) {
      let slopeAngle = this.m_orientationInterpolator!.interpolatedSample.facingSlopeAngle;
      let speedScale: number;
      let angle: number;
      if (slopeAngle <= 0.0) {
        speedScale = view.slopeDownSpeedScale;
        angle = view.slopeDownAngle;
        slopeAngle = f(-slopeAngle);
      } else {
        speedScale = view.slopeUpSpeedScale;
        angle = view.slopeUpAngle;
      }
      const blend = Mathf.Clamp01(f(slopeAngle / angle));
      desiredSpeed = f(desiredSpeed * Mathf.Lerp(1.0, speedScale, blend));
    }

    // Ease lateral offset toward the desired side distance, and speed toward desired.
    this.m_sideOffset = Mathf.MoveTowards(
      this.m_sideOffset,
      desiredSideDist,
      f(f(this.m_sideOffsetCenter * 0.5) * dt),
    );
    const accel = desiredSideDist < 0.01 ? 15.0 : 4.0;
    this.m_speedCur = Mathf.MoveTowards(this.m_speedCur, desiredSpeed, f(accel * dt));

    // Advance distance (jumping bosses alternate rest / jump).
    if (!this.m_isBoss || !this.m_isJumpingBoss || this.enemyMoveType !== EEnemyMoveTypeDef.ground) {
      this.m_distance = f(this.m_distance + f(this.m_speedCur * dt));
    } else if (this.m_restTime <= 0.0) {
      this.m_jumpTime = f(this.m_jumpTime - dt);
      if (this.m_jumpTime > 0.0) this.m_distance = f(this.m_distance + f(this.m_speedCur * dt));
      else this.m_restTime = this.m_restDur;
    } else {
      this.m_restTime = f(this.m_restTime - dt);
      if (this.m_restTime <= 0.0) {
        this.m_jumpTime = this.m_jumpDur;
        Events.bossJumpEvent.invoke(this, this.m_jumpDur);
      }
    }

    const s = this.pathMove!.sampleWithVel(this.m_distance, this.m_sideOffset);
    if (!s.ok) {
      this.destroySelf(); // reached the end of the path
    } else {
      let pos = s.pos;
      if (this.enemyMoveType === EEnemyMoveTypeDef.ground) pos = this.raycastGroundSlope(pos);
      if (!this.landedOnDeathPath()) {
        this.position = pos.add(Vector3.up.mulScalar(this.m_groundOffsetY));
        if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
        this.m_moveVector = Vector3.Normalize(new Vector3(s.vel.x, 0.0, s.vel.z));
      }
    }
  }

  // RaycastGroundSlope @0x4B0680 — snap to terrain height, or detect landing.
  private raycastGroundSlope(a_pos: Vector3): Vector3 {
    const terrain = this.m_orientationInterpolator!.interpolatedSample;
    if (!this.m_isFalling) {
      return new Vector3(a_pos.x, terrain.terrainHeight, a_pos.z); // C# mutates y
    }
    if (this.position.y <= terrain.terrainHeight) {
      this.m_isFalling = false;
      this.m_groundOffsetY = f(0.0);
      this.m_groundOffsetVelY = f(0.0);
    }
    return a_pos;
  }

  // UpdateGroundOffset @0x4AFC20 — spring the vertical offset toward its target
  // (balloon rise/fall), gravity while falling, landing thud.
  private updateGroundOffset(dt: number): void {
    const sign = Mathf.Sign(f(this.m_groundOffsetY - this.m_groundOffsetDestY));
    if (!this.m_isFalling) {
      if (this.m_groundOffsetY < this.m_groundOffsetDestY) {
        this.m_groundOffsetVelY = f(this.m_groundOffsetVelY + f(f(this.m_groundOffsetAccScaleY * 9.8) * dt));
      } else if (this.m_groundOffsetY > this.m_groundOffsetDestY) {
        this.m_groundOffsetVelY = f(this.m_groundOffsetVelY + f(f(this.m_groundOffsetAccScaleY * -9.8) * dt));
      }
    } else {
      this.m_groundOffsetVelY = f(this.m_groundOffsetVelY + f(f(this.m_groundOffsetAccScaleY * -9.8) * dt));
    }

    this.m_groundOffsetVelY = f(this.m_groundOffsetVelY * 0.999);
    this.m_groundOffsetY = f(this.m_groundOffsetY + f(this.m_groundOffsetVelY * dt));

    if (!this.m_isFalling) {
      if (this.m_groundOffsetY >= 0.0) {
        if (sign !== Mathf.Sign(f(this.m_groundOffsetY - this.m_groundOffsetDestY))) {
          this.m_groundOffsetVelY = f(this.m_groundOffsetVelY * this.m_groundOffsetVelDamping);
        }
      } else {
        this.m_groundOffsetY = f(0.0);
        this.m_groundOffsetVelY = f(0.0);
        if (this.m_sounds !== null) {
          // C#: MonstersAudio.Instance.PlaySFX(m_sounds.Land, true) — 2-arg overload.
          getMonstersAudio()?.playSFX((this.m_sounds as { Land?: unknown }).Land, true);
        }
      }
    }
  }

  // StateAttacking @0x4B0750 — non-boss attackers die at the home; bosses hold.
  private stateAttacking(_dt: number): void {
    if (!this.m_isBoss) {
      // Resolve the attacked home (result unused in the original), then self-destruct.
      this.m_attackHomeHandle.getMostRecentObjectVersion<GameCoreHome>();
      this.destroySelf();
    } else {
      const s = this.pathMove!.sampleWithVel(this.m_distance, this.m_sideOffset);
      if (s.ok) {
        let pos = s.pos;
        if (this.enemyMoveType === EEnemyMoveTypeDef.ground) pos = this.raycastGroundSlope(pos);
        this.position = pos.add(Vector3.up.mulScalar(this.m_groundOffsetY));
        if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
      }
    }
  }

  // FindBlockingEnemies @0x4B2AF0
  private findBlockingEnemies(): BlockingInfo {
    return AIHelper.getAvoidanceEnemy(this, 2.5, this.speed);
  }

  // UpdateBlockingEnemies @0x4B2BA0 — blocking info → desired speed + side
  // distance. C# out-params → result object. Debug DrawLine calls omitted.
  private updateBlockingEnemies(blockingInfo: BlockingInfo): { speed: number; sideDist: number } {
    const pos = this.position;
    const moveVec = this.m_moveVector;
    const speed = this.speed;
    let sideCenter = this.sideOffsetCenter;
    let desiredSpeed = speed;
    let sameGroupDist = Infinity;

    // Refresh the three candidate blockers, dropping any that no longer exist.
    // FAITHFUL QUIRK: ALL THREE branches write distanceSameGroup (the DP/SP
    // branches included) — reproduced exactly as in the reconstruction.
    let enemySG: GameCoreEnemy | null = null;
    if (!blockingInfo.enemySameGroup.isNull) {
      enemySG = blockingInfo.enemySameGroup.getMostRecentObjectVersion<GameCoreEnemy>();
      if (enemySG === null) blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
      else blockingInfo.distanceSameGroup = Vector3.Dot(moveVec, enemySG.position.sub(pos));
    }
    let enemyDP: GameCoreEnemy | null = null;
    if (!blockingInfo.enemyDiffPath.isNull) {
      enemyDP = blockingInfo.enemyDiffPath.getMostRecentObjectVersion<GameCoreEnemy>();
      if (enemyDP === null) blockingInfo.enemyDiffPath = GameCoreHandle.nullHandle;
      else {
        blockingInfo.distanceSameGroup = f(
          Vector3.Dot(moveVec, enemyDP.position.sub(pos)) - enemyDP.collision.radius,
        );
        this.m_detectionTime = Mathf.Min(this.m_detectionTime, 0.1);
      }
    }
    let enemySP: GameCoreEnemy | null = null;
    if (!blockingInfo.enemySamePath.isNull) {
      enemySP = blockingInfo.enemySamePath.getMostRecentObjectVersion<GameCoreEnemy>();
      if (enemySP === null) blockingInfo.enemySamePath = GameCoreHandle.nullHandle;
      else {
        blockingInfo.distanceSameGroup = f(
          Vector3.Dot(moveVec, enemySP.position.sub(pos)) - enemySP.collision.radius,
        );
      }
    }

    // --- Same-wave-group blocker ---
    if (enemySG !== null) {
      const pathDistDiff = f(enemySG.m_distance - this.m_distance);
      let sgDist = pathDistDiff; // becomes +inf in the slow-down branch below
      const combinedRadius = f(this.collision.radius + enemySG.collision.radius + 0.05);
      let gap = combinedRadius;
      if (enemySG.m_enemyBlockingMe.isNull) gap = this.m_waveDistance;

      if (!this.m_isOnFire || enemySG.m_isOnFire) {
        if (this.m_waveSpawnIndex < enemySG.m_waveSpawnIndex) {
          // I spawned earlier: I have priority, ignore this blocker.
          blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
          sameGroupDist = Infinity;
        } else {
          if (pathDistDiff <= combinedRadius) {
            // Too close: stop behind it.
            this.m_enemyBlockingMe = enemySG.handle;
            this.m_detectionTime = f(0.1);
            desiredSpeed = f(0.0);
          } else {
            const distGap = f(pathDistDiff - gap);
            if (distGap >= 0.25 || !enemySG.m_enemyBlockingMe.isNull) {
              if (distGap < 0.25) {
                this.m_enemyBlockingMe = enemySG.handle;
                this.m_detectionTime = f(0.1);
                desiredSpeed = f(0.0);
              } else if (!enemySG.m_buffs!.contains(BuffFastPlayer)) {
                const blend = Mathf.Clamp01(f(distGap / 0.15));
                desiredSpeed = Mathf.Lerp(speed, f(speed * 1.5), f(1.0 - f(f(1.0 - blend) * f(1.0 - blend))));
              }
            } else {
              const blend = Mathf.Clamp01(f(distGap / -0.15));
              desiredSpeed = Mathf.Lerp(speed, f(speed * 0.5), f(1.0 - f(f(1.0 - blend) * f(1.0 - blend))));
              sgDist = Infinity;
              this.m_enemyBlockingMe = enemySG.handle;
            }
          }
          sideCenter = this.sideOffsetCenter;
          sameGroupDist = sgDist;
        }
      } else {
        // I'm on fire and it isn't: try to overtake.
        this.m_enemyToOvertake = enemySG.handle;
      }
    }

    // --- Different-path blocker ---
    if (enemyDP !== null) {
      if (
        blockingInfo.distanceDiffPath < sameGroupDist &&
        blockingInfo.distanceDiffPath < f(this.collision.radius + enemyDP.collision.radius + 1.0)
      ) {
        if (enemyDP.m_enemyBlockingMe.isNull) this.m_enemyBlockingMe = enemyDP.handle;
      }
    }

    // --- Same-path (different group) blocker ---
    if (enemySP !== null) {
      if (blockingInfo.speedSamePath <= 0.0) {
        if (enemySP.m_enemyBlockingMe.isNull) {
          desiredSpeed =
            blockingInfo.distanceSamePath < f(0.5 + this.collision.radius) ? f(0.0) : f(0.5 * speed);
          this.m_enemyBlockingMe = enemySP.handle;
        }
      } else if (blockingInfo.distanceSamePath < f(this.collision.radius + 0.25)) {
        this.m_enemyToOvertake = enemySP.handle;
      }
    }

    // --- Follow whoever is blocking me ---
    if (!this.m_enemyBlockingMe.isNull) {
      const blocker = this.m_enemyBlockingMe.getMostRecentObjectVersion<GameCoreEnemy>();
      if (blocker === null) {
        this.m_enemyBlockingMe = GameCoreHandle.nullHandle;
      } else if (this.waveGroupID === blocker.waveGroupID || getAISettings().enableEnemyBlocking) {
        const blockerFuturePos = blocker.position.add(blocker.m_moveVector.mulScalar(blocker.m_speedCur));
        let pathDiff = 0;
        let computeSpeed = true;
        if (this.waveGroupID === blocker.waveGroupID) {
          pathDiff = f(blocker.m_distance - this.m_distance);
          if (pathDiff < 0.0 && this.m_waveSpawnIndex < blocker.m_waveSpawnIndex) {
            // FAITHFUL QUIRK: spawn indices are SWAPPED between the two enemies.
            const tmp = this.m_waveSpawnIndex;
            this.m_waveSpawnIndex = blocker.m_waveSpawnIndex;
            blocker.m_waveSpawnIndex = tmp;
            this.m_enemyBlockingMe = GameCoreHandle.nullHandle;
            computeSpeed = false;
          } else {
            const combinedR = f(blocker.collision.radius + this.collision.radius);
            this.m_enemyToOvertake = GameCoreHandle.nullHandle;
            if (this.m_waveDistance <= pathDiff) computeSpeed = false;
            else pathDiff = f(pathDiff - f(combinedR + 0.25));
          }
        } else {
          const combinedR = f(blocker.collision.radius + this.collision.radius + 0.25);
          const diff = blockerFuturePos.sub(this.position);
          if (f(combinedR * combinedR) <= diff.sqrMagnitude) computeSpeed = false;
          else pathDiff = f(diff.magnitude - combinedR);
        }
        if (computeSpeed) {
          const blend = Mathf.Clamp01(f(pathDiff * 8.0));
          desiredSpeed = f(blend * speed);
        }
      }
    }

    // --- Complete an overtake once the slower enemy is behind ---
    if (!this.m_enemyToOvertake.isNull && getAISettings().overtakeSlowerEnemies) {
      const overtake = this.m_enemyToOvertake.getMostRecentObjectVersion<GameCoreEnemy>();
      if (overtake !== null) {
        const sideOffset = f(
          f(this.collision.radius + overtake.collision.radius) *
            0.9 *
            Mathf.Sign(this.sideOffsetCenter),
        );
        const dotForward = Vector3.Dot(this.m_moveVector, overtake.position.sub(this.position));
        if (-Mathf.Abs(sideOffset) >= dotForward) {
          if (this.waveGroupID === overtake.waveGroupID) {
            const tmp = this.m_waveSpawnIndex;
            this.m_waveSpawnIndex = overtake.m_waveSpawnIndex;
            overtake.m_waveSpawnIndex = tmp;
            blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
          }
          this.m_enemyToOvertake = GameCoreHandle.nullHandle;
        }
      }
    }

    return { speed: desiredSpeed, sideDist: sideCenter };
  }

  // LandedOnDeathPath @0x4B4500 — a popped-balloon enemy landing on a Death
  // segment dies.
  private landedOnDeathPath(): boolean {
    if (this.m_startedBalloon && !this.m_isBalloon && !this.m_isFalling && this.m_groundOffsetY <= 0.0) {
      const segIndex = Mathf.FloorToInt(this.pathMove!.distanceToTime(this.m_distance));
      if (
        segIndex >= 0 &&
        this.m_segTypeInfos !== null &&
        segIndex < this.m_segTypeInfos.length &&
        this.m_segTypeInfos[segIndex] === EPathSegType.Death
      ) {
        const hitInfo = new EnemyHitInfo(null, this, 0.0, false, 0.0, 0.0, false);
        if (this.m_isBoss) this.killOtherEnemiesOnBossDeath(null);
        Events.enemyDestroyedEvent.invoke(null, this, hitInfo);
        this.destroySelf();
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Boss AI
  // ---------------------------------------------------------------------------

  // BossAI @0x4B0960
  private bossAI(dt: number): void {
    if (!this.m_isBoss) return;

    switch (this.m_bossType) {
      case EBossType.Bero:
      case EBossType.Kao:
        if (this.m_bossAttacking) {
          this.m_bossAttackTime = f(
            this.m_bossAttackTime + f(f(f(1.0 / this.BossAttackDur) * this.m_speedScale) * dt),
          );
          let blend: number;
          let height: number;
          if (this.m_bossAttackTime >= this.BossAttackDur) {
            this.m_bossAttacking = false;
            this.m_bossAttackTime = f(0.0);
            blend = 0.0;
            height = this.BossAttackHeightForward;
          } else if (this.m_bossAttackTime < 0.33) {
            blend = f(this.m_bossAttackTime / 0.33);
            height = this.BossAttackHeightForward;
          } else if (this.m_bossAttackTime >= 0.66) {
            blend = f(f(1.0 - this.m_bossAttackTime) / 0.33);
            height = this.BossAttackHeightBack;
          } else {
            height = 0.0;
            blend = 1.0;
            if (!this.m_bossAttackEffectTriggered) {
              Events.bossAttackEffectEvent.invoke();
              this.m_bossAttackEffectTriggered = true;
            }
          }
          blend = Mathf.Clamp01(blend);
          const upAmount = f(Mathf.Sin(f(blend * Mathf.PI)) * height);
          this.position = this.position
            .add(this.m_moveVector.mulScalar(f(blend * this.BossAttackDist)))
            .add(Vector3.up.mulScalar(upAmount));
          if (!this.isDestroyed()) GameCore.instance!.collisionManager.updateCoreObject(this);
        }
        break;

      case EBossType.Fat:
        // Fly until near the home or sufficiently damaged, then land.
        if (
          this.enemyMoveType === EEnemyMoveTypeDef.air &&
          !(f(this.pathMove!.pathLength - this.m_distance) >= 7.0 && this.m_vulnerableDamageTaken < this.m_lowHpThreshold)
        ) {
          this.configAttackPoints(EEnemyMoveTypeDef.air, false);
          this.configAttackPoints(EEnemyMoveTypeDef.ground, true);
          this.enemyMoveType = EEnemyMoveTypeDef.ground;
          this.m_groundOffsetDestY = f(0.0);
          this.m_groundOffsetAccScaleY = f(1.0);
          this.m_speed = this.m_lowHpSpeed;
          this.m_isFalling = true;
        }
        break;

      case EBossType.Tall:
        if (this.m_vulnerableDamageTaken >= this.m_lowHpThreshold) this.m_speed = this.m_lowHpSpeed;
        break;
    }

    if (this.m_bossType === EBossType.Kao) this.bossAITerrainDetection();
  }

  // BossAITerrainDetection @0x4B4BD0 — Kao switches ground/air by segment type.
  private bossAITerrainDetection(): void {
    if (this.m_isFalling) return;
    const segIndex = Mathf.FloorToInt(this.pathMove!.distanceToTime(this.m_distance));
    if (segIndex < 0 || this.m_segTypeInfos === null || segIndex >= this.m_segTypeInfos.length) return;

    const segType = this.m_segTypeInfos[segIndex];
    if (segType === EPathSegType.BossGround && this.enemyMoveType === EEnemyMoveTypeDef.air) {
      this.enemyMoveType = EEnemyMoveTypeDef.ground;
      this.m_groundOffsetDestY = f(0.0);
      this.m_groundOffsetAccScaleY = f(1.0);
      this.m_speed = this.m_lowHpSpeed;
      this.m_isFalling = true;
      this.configAttackPoints(EEnemyMoveTypeDef.ground, true);
      this.configAttackPoints(EEnemyMoveTypeDef.air, false);
    } else if (segType === EPathSegType.BossAir && this.enemyMoveType === EEnemyMoveTypeDef.ground) {
      this.enemyMoveType = EEnemyMoveTypeDef.air;
      this.m_groundOffsetDestY = this.m_groundOffsetModeHeight;
      this.configAttackPoints(EEnemyMoveTypeDef.ground, false);
      this.configAttackPoints(EEnemyMoveTypeDef.air, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Balloons / drowning
  // ---------------------------------------------------------------------------

  // PopBalloons @0x4B0D00
  popBalloons(a_numBalloonToPop: number): void {
    if (this.m_numBalloons < 1) return;
    this.m_numBalloons = (this.m_numBalloons - a_numBalloonToPop) | 0;
    if (this.m_numBalloons < 1) {
      // All balloons gone: become a falling ground enemy.
      this.enemyMoveType = EEnemyMoveTypeDef.ground;
      this.m_groundOffsetDestY = f(0.0);
      this.m_groundOffsetAccScaleY = f(1.0);
      this.m_isBalloon = false;
      this.m_isFalling = true;
      this.removeAllAttackPoints();
      const view = this.getUnityObjectAs<EnemyViewerContract>();
      if (view !== null) this.initAttackPoints(view);
    } else {
      this.m_groundOffsetDestY = f(this.m_groundOffsetDestY - this.m_groundOffsetBalloonDeltaY);
    }
    Events.popBalloonsEvent.invoke(this, a_numBalloonToPop);
  }

  // DrownDetection @0x4B0E50
  private drownDetection(): void {
    if (this.m_startedBalloon && !this.m_isBalloon) {
      const checkPos = this.position.add(
        Vector3.up.mulScalar(f(this.collision.radius + this.m_drownDepth)),
      );
      if (
        getSimPhysics().checkSphere(
          checkPos.x, checkPos.y, checkPos.z,
          this.collision.radius,
          Q4Layers.waterMask,
          'Ignore',
        )
      ) {
        this.drown();
      }
    }
  }

  // Drown @0x4B10C0
  drown(): void {
    if (this.m_isOnFire) Events.onFireExtinguished.invoke(this);
    this.m_isOnFire = false;
    // INFERRED (reconstruction): the popped-count immediate is misresolved in
    // the decompilation; a large value pops all remaining balloons.
    Events.popBalloonsEvent.invoke(this, 100000000);
    Events.enemyDrownEvent.invoke(this);
    this.destroySelf();
  }

  // ---------------------------------------------------------------------------
  // Attack / damage (chunk 2)
  // ---------------------------------------------------------------------------

  // DealDamage @0x4B1200 (IDamageable, untyped) — resolve the source tower's attributes.
  dealDamage(
    damageSource: GameCoreObject | null,
    damageToDeal: number,
    distanceToCenterRate: number,
    attackPoint: GameCoreObject | null,
    immediateDestroy = true,
  ): void {
    let towerHandle = GameCoreHandle.nullHandle;
    if (damageSource instanceof GameCoreProjectile) towerHandle = damageSource.sourceTower;

    let strength = EEnemyStrengthTypeDef.Normal;
    let classType = EEnemyClassTypeDef.Normal;
    if (!towerHandle.isNull) {
      const tower = towerHandle.getMostRecentObjectVersion<GameCoreTower>();
      if (tower !== null) {
        strength = tower.strengthType;
        classType = tower.classType;
      }
    }
    this.dealDamageTyped(strength, classType, damageToDeal, distanceToCenterRate, damageSource, attackPoint, immediateDestroy);
  }

  // DealDamage @0x4B13E0 (IDamageable, typed) — the core damage routine.
  dealDamageTyped(
    strengthType: EEnemyStrengthTypeDef,
    classType: EEnemyClassTypeDef,
    damageToDeal: number,
    distanceToCenterRate: number,
    damageSource: GameCoreObject | null,
    attackPoint: GameCoreObject | null,
    immediateDestroy = true,
  ): void {
    const debug = getDebugCanvas();
    if (debug !== null) damageToDeal = f(damageToDeal * debug.damageRate);

    const dealt = Mathf.Min(damageToDeal, this.m_life);
    // FAITHFUL: balloon enemies do NOT lose life while balloons remain.
    if (this.m_numBalloons < 1) this.m_life = f(this.m_life - dealt);

    // Boss weak-point (vulnerable) damage accumulation.
    if (
      attackPoint !== null &&
      this.m_isBoss &&
      attackPoint instanceof GameCoreEnemyAttackPoint &&
      (this.m_bossType === EBossType.Fat ||
        (this.m_bossType === EBossType.Tall && attackPoint.moveType() === EEnemyMoveTypeDef.ground))
    ) {
      this.m_vulnerableDamageTaken = f(this.m_vulnerableDamageTaken + dealt);
    }

    // Lightning / insect projectiles always hit "strong" with a fixed reaction.
    let specialProjectile = false;
    let sourceTower: GameCoreTower | null = null;
    if (damageSource instanceof GameCoreProjectile) {
      specialProjectile =
        damageSource instanceof GameCoreProjectileLightning ||
        damageSource instanceof GameCoreProjectileInsect;
      sourceTower = damageSource.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    }

    // Use the hit attack point's own attributes if present, else the enemy body's.
    const view = this.getUnityObjectAs<EnemyViewerContract>();
    let apAttrs: EnemyAttributesSettingsContract | null = null;
    if (attackPoint !== null && view !== null && this.m_attackPoints !== null) {
      const index = this.m_attackPoints.findIndex((h) => h.equals(attackPoint.handle));
      const pointViews = view.attackPoints();
      if (index !== -1 && pointViews !== null && index < pointViews.length) {
        const apView = pointViews[index];
        if (apView != null) apAttrs = apView.getComponentEnemyAttributesSettings();
      }
    }

    let strongToDamage: boolean;
    let strongReaction: boolean;
    let reactionRate: number;
    if (specialProjectile) {
      strongToDamage = false;
      strongReaction = false;
      reactionRate = f(1.0);
    } else if (apAttrs === null) {
      strongToDamage = DamageHelper.damageStrongToEnemy(strengthType, classType, this);
      strongReaction = DamageHelper.reactionStrongToEnemy(strengthType, classType, this);
      reactionRate = DamageHelper.reactionRateByAttributes(strengthType, classType, this);
    } else {
      strongToDamage = DamageHelper.damageStrongToEnemy(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
      strongReaction = DamageHelper.reactionStrongToEnemy(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
      reactionRate = DamageHelper.reactionRateByAttributes(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
    }

    const hitInfo = new EnemyHitInfo(damageSource, this, dealt, strongToDamage, distanceToCenterRate, reactionRate, strongReaction);

    if (this.m_life > 0.0) {
      if (!this.m_isBalloon) {
        if (!this.m_tookDamageThisFrame) {
          if (attackPoint instanceof GameCoreEnemyAttackPoint) this.m_tookDamageThisFrame = true;
          Events.enemyHitEvent.invoke(hitInfo);
        }
      } else if (sourceTower === null || !sourceTower.oneShotOneBalloon) {
        const oldHP = this.m_balloonHP;
        this.m_balloonHP = f(this.m_balloonHP - dealt);
        const before = Mathf.CeilToInt(f(oldHP / this.m_balloonPopHPInterval));
        const after = Mathf.CeilToInt(f(this.m_balloonHP / this.m_balloonPopHPInterval));
        if (before <= after) Events.popBalloonsEvent.invoke(this, 0);
        else this.popBalloons(before - after);
        console.log(`attack received on balloon: dmg ${dealt}, remain hp ${this.m_balloonHP}`);
      } else {
        this.popBalloons(1);
      }
    } else {
      this.m_life = f(0.0);
      if (this.m_isBoss) this.killOtherEnemiesOnBossDeath(null);
      Events.enemyDestroyedEvent.invoke(sourceTower, this, hitInfo);
      if (immediateDestroy) this.destroySelf();
    }
  }

  // DealPlayerDamage @0x4B21B0 — damage from a player kick.
  dealPlayerDamage(
    a_executingPlayer: GameCorePlayer,
    damageToDeal: number,
    distanceToCenterRate: number,
    oneKickOneBalloon: boolean,
  ): void {
    const debug = getDebugCanvas();
    if (debug !== null) damageToDeal = f(damageToDeal * debug.damageRate);

    const dealt = Mathf.Min(damageToDeal, this.m_life);
    this.m_life = f(this.m_life - dealt);
    const hitInfo = new EnemyHitInfo(a_executingPlayer, this, dealt, false, distanceToCenterRate, 1.0, false);

    if (this.m_life > 0.0) {
      if (!this.m_isBalloon) {
        Events.enemyHitEvent.invoke(hitInfo);
      } else if (!oneKickOneBalloon) {
        const oldHP = this.m_balloonHP;
        this.m_balloonHP = f(this.m_balloonHP - dealt);
        const before = Mathf.CeilToInt(f(oldHP / this.m_balloonPopHPInterval));
        const after = Mathf.CeilToInt(f(this.m_balloonHP / this.m_balloonPopHPInterval));
        if (before <= after) Events.popBalloonsEvent.invoke(this, 0);
        else this.popBalloons(before - after);
      } else {
        this.popBalloons(1);
      }
    } else {
      this.m_life = f(0.0);
      if (this.m_isBoss) this.killOtherEnemiesOnBossDeath(a_executingPlayer);
      Events.enemyDestroyedEvent.invoke(null, this, hitInfo);
      this.destroySelf();
    }
  }

  // Shared boss-death side effect (INFERRED helper name; the decompilation
  // inlines this loop at each death site): killing a boss deals lethal damage
  // to every other enemy.
  private killOtherEnemiesOnBossDeath(damageSource: GameCoreObject | null): void {
    for (const enemy of GameCore.instance!.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
      if (!enemy.handle.equals(this.handle)) {
        enemy.dealDamage(damageSource, f(enemy.m_life + 1.0), 0.0, null, true);
      }
    }
  }

  // TriggerJumpReaction @0x4B28C0
  triggerJumpReaction(a_weight: number): void {
    Events.jumpReactionEvent.invoke(this, a_weight);
  }
}
