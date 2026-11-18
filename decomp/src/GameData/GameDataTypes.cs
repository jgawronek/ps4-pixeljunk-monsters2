// GameData/GameDataTypes.cs
// Plain-data definitions for PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Field names are the ORIGINAL serialized names recovered from the game's own
// AssetBundle MonoBehaviours (via UnityPy type-trees) and IL2CPP metadata.
//
// PROVENANCE / SCOPE: These are NUMERIC GAMEPLAY PARAMETERS only (stats, costs,
// wave tables, difficulty multipliers). No art, audio, meshes, or level geometry
// is reproduced here. Values are loaded at runtime from decomp/data/*.json,
// which were extracted from the user's own legally-owned copy. This is the
// Phase 3 "data definitions" layer from decomp/GameCore_BLUEPRINT.md.
//
// These types are intentionally dependency-free POCOs so they can back either a
// Unity rebuild or a headless simulation harness.

using System;
using System.Collections.Generic;

namespace GameData
{
    // ---- Enemies -----------------------------------------------------------

    // Mirrors Q4.EnemyBase serialized fields (decomp/data/enemies_EnemyBase.json).
    public class EnemyDefinition
    {
        public string name;                 // prefab name, e.g. "kuri_00_001"
        public EEnemyMoveTypeDef enemyMoveType;
        public ESpawnMode spawnMode;
        public int expValue;
        public float maxLife;
        public float speed;
        public float fireSpeed;
        public float balloonSpeed;
        public float maxShockSpeed;
        public float additionShockRate = 1f;
        public float shockScale = 1f;
        public float shockSpring = 15f;
        public float shockDamping = 10f;
        public float collisionScaleH = 1f;
        public float collisionScaleV = 1f;
        public float animMoveSpeed = 1f;
        public Vector3Data targetOffset;
        public Vector3Data offsetHpGauge;
        public List<EnemyAttributes> attributes = new List<EnemyAttributes>();
    }

    // Mirrors Q4.EnemyAttributesSettings — the strength/class damage pipeline
    // consumed by GameCore.DamageHelper (decomp/data/enemies_EnemyAttributesSettings.json).
    public class EnemyAttributes
    {
        public float effectScale = 1f;
        public List<StrengthDamageInfo> strengthDamageInfos = new List<StrengthDamageInfo>();
        public List<ClassDamageInfo> classDamageInfos = new List<ClassDamageInfo>();
    }

    // Damage reaction vs. a tower's EEnemyStrengthTypeDef.
    public class StrengthDamageInfo
    {
        public EEnemyStrengthTypeDef strength;
        public float damageTime = 1f;       // hit-stun duration
        public float reactionTime = 1f;
    }

    // Damage reaction vs. a tower's EEnemyClassTypeDef.
    public class ClassDamageInfo
    {
        public EEnemyClassTypeDef classType;
        public float damageTime = 1f;
        public float reactionTime = 1f;
    }

    // ---- Towers ------------------------------------------------------------

    // Mirrors Q4.TowerBase serialized fields (decomp/data/structures_TowerBase.json).
    public class TowerDefinition
    {
        public string gameObjectName;       // prefab name, e.g. "tower_004"
        public int structureUID;
        public string towerName;            // localization key, e.g. "tl_tower_name_004"
        public ETowerAttackDef attackType;  // what it can target
        public EEnemyStrengthTypeDef strengthType;
        public EEnemyClassTypeDef classType;
        public float enemyDetectionRange;
        public float playerDetectionRange;
        public float attackPower;
        public float attackSpeed;           // shots per second (see blueprint §3.3)
        public float attackRangeInner;
        public float attackRangeOuter;      // from TowerSetting JSON where present
        public float attackSpread;
        public bool balloonAimable;
        public bool oneShotOneBalloon;
        public bool fullRangeFire;
        public int costCoin;
        public int costGem;
        public int refundCoin;
        public int refundGem;
        public float buildTime;
        public float buildRange;
        public int magazineCapacity = -1;
        public int burstCount = 1;
        public float burstInterval;
        public int nextTargetToAttackIndex;
        public float fortAngleMax;
        public float fortAngleMin;
        public float rotateSpeedX;
        public float rotateSpeedY;
        public bool dlcLock;
        public List<AttackAttenuation> attackAttenuations = new List<AttackAttenuation>();
        public List<TowerUpgradeLevel> upgrades = new List<TowerUpgradeLevel>();
    }

    public class AttackAttenuation
    {
        public float rate;                  // 0..1 of range
        public float attenuation;           // damage multiplier at that rate
        public bool snap;
    }

    // Mirrors Q4.TowerUpgradeSettingGeneric.upgrades[] (structures_TowerUpgradeSettingGeneric.json).
    public class TowerUpgradeLevel
    {
        public int level;                   // 2..5
        public int reachExp;                // exp required to reach this level
        public int costCoin;
        public int costGem;
        public int refundCoin;
        public int refundGem;
        public float attackPower;
        public float attackSpeed;
        public float attackRangeInner;
        public float attackRangeScale;
        public float affectRangeRate;
        public float attackSpread;
        public int burstCount = 1;
        public float burstInterval;
    }

    // ---- Waves / Stages ----------------------------------------------------

    // Mirrors WaveResource waveList[].perDifficulyLists[].spawnDataList[]
    // (decomp/data/stage_waves_resolved.json — enemy PPtrs resolved to names).
    public class WaveSpawn
    {
        public string enemy;                // EnemyDefinition.name
        public int enemySpawnNum;
        public float enemySpawnInterval;
        public float delay;
        public bool enemyTrackerEnable;
        public float pathStartTime;
        public string pathName;             // e.g. "ground_up_l_path"
        public int activateIndex;
        public List<Vector3Data> pathList = new List<Vector3Data>(); // world-space path
        public List<int> segTypeList = new List<int>();
        // sine-drift / offset shaping (ground walkers weaving)
        public float offsetStartAngle;
        public float offsetFreq;
        public float offsetDist;
        public float walkDriftFreq;
        public float walkDriftDist;
    }

    // One difficulty's spawn list for a single wave. Index 0..3 = easy..(hard+).
    public class WaveDifficulty
    {
        public List<WaveSpawn> spawns = new List<WaveSpawn>();
    }

    // A single wave: per-difficulty spawn lists.
    public class Wave
    {
        public List<WaveDifficulty> perDifficulty = new List<WaveDifficulty>();
    }

    // Mirrors Q4.StageMain (decomp/data/stages_StageMain.json).
    public class StageDefinition
    {
        public int index;
        public string stageName;            // e.g. "tl_stage_001"
        public string areaName;             // e.g. "tl_area_002"
        public int initCoin;
        public int initGem;
        public float waveCoinRate;          // coin escalation per wave
        public float waveTimeRate;          // time escalation per wave
        public List<Wave> waves = new List<Wave>();
    }

    // Mirrors Q4.DifficultySettings (decomp/data/stages_DifficultySettings.json).
    public class DifficultyMultipliers
    {
        public float coinValueRate = 1f;
        public float danceEXPRate = 1f;
        public float towerBuildTimeRate = 1f;
        public float enemyHPRate = 1f;
        public float bossHPRate = 1f;
        public float enemyAmountRate = 1f;
    }

    // ---- Progression -------------------------------------------------------

    // Mirrors Q4.AreaStageInfoMap (decomp/data/globalsettings_AreaStageInfoMap.json).
    public class StageInfo
    {
        public bool initialLocked;
        public string stageSceneName;       // e.g. "3d_stage_001"
        public string stageLabel;           // e.g. "tl_stage_001"
        public string stageUnlockName;      // scene unlocked on clear
        public int areaIDOverride = -1;
    }

    public class AreaInfo
    {
        public string areaLabel;            // e.g. "tl_area_001"
        public List<StageInfo> stageInfos = new List<StageInfo>();
    }

    // ---- Shared ------------------------------------------------------------

    [Serializable]
    public struct Vector3Data
    {
        public float x, y, z;
        public Vector3Data(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public override string ToString() { return "(" + x + ", " + y + ", " + z + ")"; }
    }
}
