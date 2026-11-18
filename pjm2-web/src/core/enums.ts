// src/core/enums.ts
// TypeScript port of decomp/src/GameCore/EnemyEnums.cs — the SIM-side enums.
// In C# these live in the Q4 namespace (faithful to metadata) but are consumed
// by GameCore; in TS they live here and are imported directly (documented
// mapping: Q4.EEnemyMoveTypeDef → core/enums EEnemyMoveTypeDef).
// Values are EXACT from global-metadata.dat and verified identical to the
// GameData-layer copies (src/data/enums.ts) by the cross-check in PROGRESS.md.

/** TypeDefIndex 2812 — canonical enemy roster (48 entries). */
export enum EEnemyDef {
  unknown = 0,
  kuri_00_001 = 1, kuri_01_001 = 2, kuri_02_001 = 3,
  kuri_03_001 = 4, kuri_04_001 = 5, kuri_05_001 = 6,
  giant_00_001 = 7, giant_01_001 = 8, giant_02_001 = 9,
  giant_03_001 = 10, giant_04_001 = 11, giant_05_001 = 12,
  spider_00_001 = 13, spider_01_001 = 14, spider_02_001 = 15,
  spider_03_001 = 16, spider_04_001 = 17, spider_05_001 = 18,
  cisors_00_001 = 19, cisors_01_001 = 20, cisors_02_001 = 21,
  cisors_03_001 = 22, cisors_04_001 = 23, cisors_05_001 = 24,
  kurukuru_00_001 = 25, kurukuru_01_001 = 26, kurukuru_02_001 = 27,
  kurukuru_03_001 = 28, kurukuru_04_001 = 29, kurukuru_05_001 = 30,
  bee_00_001 = 31, bee_01_001 = 32, bee_02_001 = 33,
  bee_03_001 = 34, bee_04_001 = 35, bee_05_001 = 36,
  bat_00_001 = 37, bat_01_001 = 38, bat_02_001 = 39,
  bat_03_001 = 40, bat_04_001 = 41, bat_05_001 = 42,
  boss_00_001 = 43, boss_00_002 = 44, boss_00_003 = 45,
  boss_00_004 = 46, boss_00_005 = 47, boss_00_006 = 48,
}

/** TypeDefIndex 2824 — canonical tower roster (moter [sic] = motor tower). */
export enum ETowerDef {
  unknown = 0,
  tower_test_004 = 1,
  tower_test_005 = 2,
  tower_test_006 = 3,
  ice = 4,
  fire = 5,
  tesla_coil = 6,
  laser = 7,
  hive = 8,
  moter = 9,
  lightning = 10,
}

/** TypeDefIndex 2811 — damage class. */
export enum EEnemyClassTypeDef {
  unknown = 0,
  Normal = 1,
  Magic = 2,
  Physic = 3,
}

/** TypeDefIndex 2813 — movement domain. */
export enum EEnemyMoveTypeDef {
  unknown = 0,
  ground = 1,
  air = 2,
}

/** TypeDefIndex 2814 — armor strength. */
export enum EEnemyStrengthTypeDef {
  unknown = 0,
  Normal = 1,
  Soft = 2,
  Hard = 3,
}

/** TypeDefIndex 2823 — what a tower can target. */
export enum ETowerAttackDef {
  unknown = 0,
  ground = 1,
  air = 2,
  all = 3,
}

/** TypeDefIndex 2729 — enemy AI state machine states. */
export enum EEnemyMode {
  Move = 0,
  Attack = 1,
  Dead = 2,
  Drown = 3,
}

/** TypeDefIndex 2730 (internal). */
export enum EAttackType {
  GroundAttack = 0,
  JumpAttack = 1,
}

/** TypeDefIndex 2731 — how an enemy enters the field. */
export enum ESpawnMode {
  Normal = 0,
  Fire = 1,
  Balloon = 2,
}

/** TypeDefIndex 2732. */
export enum EBossType {
  None = 0,
  Bero = 1,
  Fat = 2,
  Tall = 3,
  Kao = 4,
}

/** C#: Q4.PathEdit.EPathSegType (dump.cs: Normal/Death/BossGround/BossAir,
 *  sequential values). Consumed by enemy movement (death-path landing, Kao
 *  boss ground/air switching); the PathEdit view class itself is Phase 3. */
export enum EPathSegType {
  Normal = 0,
  Death = 1,
  BossGround = 2,
  BossAir = 3,
}

/** C#: Q4.EBuffTriggerTarget (TypeDefIndex 2667) — [Flags] bit values. */
export enum EBuffTriggerTarget {
  Enemy = 1,
  Player = 2,
  PlayerJump = 4,
}
