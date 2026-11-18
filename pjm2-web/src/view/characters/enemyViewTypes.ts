// src/view/characters/enemyViewTypes.ts
// Types for enemyViewData.generated.ts (tools/assets/extract_enemy_view_data.py).
// See docs/ENEMY_ANIMATION_AND_HEALTH_ANALYSIS.md.

import type { AnimCondition } from './towerViewTypes';
import type { EffectNode } from '../projectiles/projectileTypes';

export interface EnemyAnimTransition {
  /** State index, or >= 30000 = selector index (dest - 30000) of the layer. */
  dest: number;
  conds: AnimCondition[];
  exit: boolean;
  exitTime: number;
  duration: number;
  offset: number;
  fixed: boolean;
  canSelf: boolean;
  interrupt: number;
  ordered: boolean;
}

export interface EnemyMotion {
  type: string;
  clip?: string | null;
  cycleOffset?: number;
  param?: string | null;
  children?: { threshold: number | null; node: EnemyMotion }[];
}

export interface EnemyAnimState {
  name: string;
  tag: string | null;
  speed: number;
  loop: boolean;
  speedParam: string | null;
  cycleOffset: number;
  cycleOffsetParam: string | null;
  motion: EnemyMotion | null;
  transitions: EnemyAnimTransition[];
}

export interface EnemySelector {
  entry: boolean;
  transitions: { dest: number; conds: AnimCondition[] }[];
}

export interface EnemyAnimLayer {
  stateMachine: number;
  defaultState: number;
  blendMode: number;
  defaultWeight: number;
  syncedMotionSet: number;
  anyState: EnemyAnimTransition[];
  selectors: EnemySelector[];
  states: EnemyAnimState[];
}

export interface EnemyController {
  params: { name: string | null; type: 'float' | 'int' | 'bool' | 'trigger' }[];
  layers: EnemyAnimLayer[];
}

export interface HealthBarCoverSetting {
  m_minThreshold: number;
  m_maxThreshold: number;
  m_cover: number;
}

export interface EnemyViewRecord {
  enemyMoveType: number;
  maxLife: number;
  speed: number;
  enableAnimMoveSpeedScaling: number;
  animMoveSpeed: number;
  randomWalkAnimIntervalMin: number;
  randomWalkAnimIntervalMax: number;
  m_freezeAnimEnable: number;
  m_freezeAnimInterval: number;
  m_freezeAnimSpeed: number;
  offsetHpGauge: { x: number; y: number; z: number };
  groundOffsetY: number;
  DestroyDelay: number;
  StrongDeathSpeedH: number;
  StrongDeathSpeedV: number;
  WeakDeathSpeedH: number;
  WeakDeathSpeedV: number;
  StrongDeathBounce: number;
  StrongDeathFriction: number;
  IsCrumbleDeath: number;
  DrownDepth: number;
  AttackType: number;
  AttackDestroySelfDur: number;
  m_bossType: number;
  m_healthBarSettings: HealthBarCoverSetting[];
  m_topDownLifeGaugeOffset: { x: number; y: number; z: number };
  m_behindLifeGaugeOffset: { x: number; y: number; z: number };
  m_isIgnoreCriticalIcon: number;
  controller: string | null;
  /** Q4.Balloon child of balloon-spawn enemies (null otherwise). */
  balloon: {
    /** CharacterLibrary def of the balloon rig (balloon_kuri, ...). */
    prefab: string | null;
    controller: string | null;
    hp: number;
    /** Bone of the balloon rig glued to the enemy's `enemyAttachBone` (Q4.EnemyBase.LateUpdate @007fe1a0). */
    attachBone: string;
    enemyAttachBone: string;
    popEffect: string | null;
    /** Balloon[i]: string root bone + balloon bone (scaled to 0 when popped, last index first). */
    balloons: { string: string; bone: string }[];
    localPos: [number, number, number];
  } | null;
  /** Q4.ParticleGroupEvent mappings of the visual prefab (label -> effect prefab name, attach bone). */
  fx: { label: string; bone: string; effect: string }[];
  // ---- hit shock (UpdateHitShock @007fbe30, OnEnemyHit @007fe710) ----
  maxShockSpeed: number;
  additionShockRate: number;
  shockCurveInfos: { rate: number; attenuation: number; snap: number }[];
  shockScale: number;
  shockSpring: number;
  shockDamping: number;
  m_TrampolineSpeed: number;
  // ---- attack choreography ----
  AttackRange: number;
  AttackDstHeightOffset: number;
  AttackDelay: number;
  spawnMode: number;
  targetOffset: { x: number; y: number; z: number };
  collisionScaleV: number;
  // ---- balloons ----
  BalloonSpawnHeight: number;
  BalloonHeight: number;
  BalloonAccScale: number;
  BalloonDamping: number;
  BalloonTargetHeight: number;
  // ---- boss ----
  m_bossSinkSpeed: number;
  m_bossSinkShake: number;
  m_isJumpingBoss: number;
  m_bossJumpDur: number;
  m_bossRestDur: number;
  m_bossJumpUpSpeed: number;
  m_attackFreq: number;
  m_bossAttackDur: number;
  m_bossAttackDist: number;
  m_bossAttackHeightForward: number;
  m_bossAttackHeightBack: number;
  m_lowHpThreshold: number;
  m_lowHpSpeed: number;
  m_damagedHpThreshold: number;
  m_bossStrongDamageAnimDownDur: number;
  m_bossStrongDamageAnimUpDur: number;
  m_bossSpawnWaitDur: number;
  BombAttenuationCenter: number;
  BombAttenuationOutside: number;
}

export interface HealthBarConfig {
  showDuration: number;
  showCurve: number[][];
  hideDuration: number;
  hideCurve: number[][];
  criticalHitShowDelay: number;
  barDegenDurationInSeconds: number;
  degenDisplayDelay: number;
  deadEnemyHideDelayAfterDegen: number;
  degenFlickerCountPerSecond: number;
  degenFlickerCount: number;
  degenFlickerColor: number[];
  spriteScale: number;
  background: string;
  hp: string;
  damage: string;
  sprites: {
    barSize: number;
    sprite: string;
    geom: { rect: number[]; pivot: number[]; ppu: number; trimOffset: number[]; tight: number[] };
    barDimensions: number[];
  }[];
}

export interface EnemyViewData {
  controllers: Record<string, EnemyController>;
  enemies: Record<string, EnemyViewRecord>;
  healthBar: HealthBarConfig;
  /** ParticleGroup effect prefab trees referenced by `EnemyViewRecord.fx` (name -> node tree, RAW Unity TRS). */
  effects: Record<string, EffectNode>;
  /** AnimationEvents per clip name (as in the controllers): [timeSeconds, functionName, data]. */
  clipEvents: Record<string, [number, string, string][]>;
}
