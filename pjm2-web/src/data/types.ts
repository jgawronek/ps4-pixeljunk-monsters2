// src/data/types.ts
// TypeScript port of decomp/src/GameData/GameDataTypes.cs.
// Plain-data definitions for PixelJunk Monsters 2 (PS4, CUSA11967).
// Field names are the ORIGINAL serialized names recovered from the game's own
// AssetBundle MonoBehaviours (UnityPy type-trees) and IL2CPP metadata.
//
// PROVENANCE / SCOPE: NUMERIC GAMEPLAY PARAMETERS only (stats, costs, wave
// tables, difficulty multipliers). No art/audio/mesh/level binaries. Values are
// loaded from decomp/data/*.json extracted from the user's own copy.

import {
  EEnemyClassTypeDef,
  EEnemyMoveTypeDef,
  EEnemyStrengthTypeDef,
  ESpawnMode,
  ETowerAttackDef,
} from './enums';

/** Mirrors Q4.EnemyBase serialized fields (decomp/data/enemies_EnemyBase.json). */
export interface EnemyDefinition {
  name: string; // prefab name, e.g. "kuri_00_001"
  enemyMoveType: EEnemyMoveTypeDef;
  spawnMode: ESpawnMode;
  expValue: number;
  maxLife: number;
  speed: number;
  fireSpeed: number;
  balloonSpeed: number;
  maxShockSpeed: number;
  additionShockRate: number;
  collisionScaleH: number;
  collisionScaleV: number;
  animMoveSpeed: number;
  attributes: EnemyAttributes[];
}

/** Mirrors Q4.EnemyAttributesSettings — the strength/class damage pipeline
 *  consumed by GameCore.DamageHelper. */
export interface EnemyAttributes {
  effectScale: number;
  strengthDamageInfos: StrengthDamageInfo[];
  classDamageInfos: ClassDamageInfo[];
}

/** Damage reaction vs. a tower's EEnemyStrengthTypeDef. */
export interface StrengthDamageInfo {
  strength: EEnemyStrengthTypeDef;
  damageTime: number;
  reactionTime: number;
}

/** Damage reaction vs. a tower's EEnemyClassTypeDef. */
export interface ClassDamageInfo {
  classType: EEnemyClassTypeDef;
  damageTime: number;
  reactionTime: number;
}

/** Mirrors Q4.TowerBase serialized fields (decomp/data/structures_TowerBase.json). */
export interface TowerDefinition {
  gameObjectName: string; // prefab name, e.g. "tower_004"
  structureUID: number;
  towerName: string | null; // localization key, e.g. "tl_tower_name_004"
  attackType: ETowerAttackDef;
  strengthType: EEnemyStrengthTypeDef;
  classType: EEnemyClassTypeDef;
  enemyDetectionRange: number;
  playerDetectionRange: number;
  attackPower: number;
  attackSpeed: number; // shots per second (see blueprint §3.3)
  attackRangeInner: number;
  attackRangeOuter: number;
  attackSpread: number;
  balloonAimable: boolean;
  oneShotOneBalloon: boolean;
  fullRangeFire: boolean;
  costCoin: number;
  costGem: number;
  refundCoin: number;
  refundGem: number;
  buildTime: number;
  buildRange: number;
  magazineCapacity: number;
  burstCount: number;
  burstInterval: number;
  nextTargetToAttackIndex: number;
  fortAngleMax: number;
  fortAngleMin: number;
  rotateSpeedX: number;
  rotateSpeedY: number;
  dlcLock: boolean;
  attackAttenuations: AttackAttenuation[];
  upgrades: TowerUpgradeLevel[];
}

export interface AttackAttenuation {
  rate: number; // 0..1 of range
  attenuation: number; // damage multiplier at that rate
  snap: boolean;
}

/** Mirrors Q4.TowerUpgradeSettingGeneric.upgrades[]. */
export interface TowerUpgradeLevel {
  level: number; // 2..5
  reachExp: number;
  costCoin: number;
  costGem: number;
  refundCoin: number;
  refundGem: number;
  attackPower: number;
  attackSpeed: number;
  attackRangeInner: number;
  attackRangeScale: number;
  affectRangeRate: number;
  attackSpread: number;
  burstCount: number;
  burstInterval: number;
}

/** Mirrors WaveResource waveList[].perDifficulyLists[].spawnDataList[]
 *  (decomp/data/stage_waves_resolved.json — enemy PPtrs resolved to names). */
export interface WaveSpawn {
  enemy: string | null; // EnemyDefinition.name
  enemySpawnNum: number;
  enemySpawnInterval: number;
  delay: number;
  enemyTrackerEnable: boolean;
  pathStartTime: number;
  pathName: string | null; // e.g. "ground_up_l_path"
  activateIndex: number;
  pathList: Vector3Data[]; // world-space path
  segTypeList: number[];
  // sine-drift / offset shaping (ground walkers weaving)
  offsetStartAngle: number;
  offsetFreq: number;
  offsetDist: number;
  walkDriftFreq: number;
  walkDriftDist: number;
}

/** One difficulty's spawn list for a single wave. Index 0..3 = easy..(hard+). */
export interface WaveDifficulty {
  spawns: WaveSpawn[];
  waveParams: Record<string, unknown>;
}

/** A single wave: per-difficulty spawn lists. */
export interface Wave {
  perDifficulty: WaveDifficulty[];
}

/** Mirrors Q4.StageMain + resolved WaveResource. */
export interface StageDefinition {
  index: number;
  stageName: string | null; // e.g. "tl_stage_001"
  areaName: string | null; // e.g. "tl_area_002"
  initCoin: number;
  initGem: number;
  waveCoinRate: number;
  waveTimeRate: number;
  waves: Wave[];
}

/** Mirrors Q4.DifficultySettings.difficultySettings[] (4 tiers). */
export interface DifficultyMultipliers {
  coinValueRate: number;
  danceEXPRate: number;
  towerBuildTimeRate: number;
  enemyHPRate: number;
  bossHPRate: number;
  enemyAmountRate: number;
}

/** Mirrors Q4.AreaStageInfoMap (decomp/data/globalsettings_AreaStageInfoMap.json). */
export interface StageInfo {
  initialLocked: boolean;
  stageSceneName: string | null; // e.g. "3d_stage_001"
  stageLabel: string | null; // e.g. "tl_stage_001"
  stageUnlockName: string | null;
  areaIDOverride: number;
}

export interface AreaInfo {
  areaLabel: string | null; // e.g. "tl_area_001"
  stageInfos: StageInfo[];
}

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}
