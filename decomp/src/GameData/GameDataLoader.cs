// GameData/GameDataLoader.cs
// Loads the numeric gameplay tables extracted from the user's own copy
// (decomp/data/*.json) into the GameData POCOs. Dependency-light: uses
// System.Text.Json (.NET / Unity com.unity.nuget.newtonsoft alternative can be
// swapped in). No assets are loaded here — parameters only.
//
// Source JSON files (all under decomp/data/), produced by the extraction scripts:
//   enemy_roster.json               -> Dictionary<string, EnemyDefinition>-ish
//   structures_TowerBase.json       -> TowerDefinition[]
//   structures_TowerUpgradeSettingGeneric.json -> upgrades keyed by gameObject name
//   stage_waves_resolved.json       -> StageDefinition[] (enemy PPtrs resolved)
//   stages_DifficultySettings.json  -> DifficultyMultipliers[4]
//   globalsettings_AreaStageInfoMap.json -> AreaInfo[]

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace GameData
{
    public class GameDataLoader
    {
        public readonly Dictionary<string, EnemyDefinition> Enemies =
            new Dictionary<string, EnemyDefinition>(StringComparer.Ordinal);
        public readonly Dictionary<string, TowerDefinition> Towers =
            new Dictionary<string, TowerDefinition>(StringComparer.Ordinal);
        public readonly List<StageDefinition> Stages = new List<StageDefinition>();
        public readonly List<DifficultyMultipliers> Difficulties = new List<DifficultyMultipliers>();
        public readonly List<AreaInfo> Areas = new List<AreaInfo>();

        private readonly string _dir;
        public GameDataLoader(string dataDir) { _dir = dataDir; }

        private JsonDocument Doc(string file)
        {
            string path = Path.Combine(_dir, file);
            if (!File.Exists(path))
                throw new FileNotFoundException("GameData table missing: " + path);
            return JsonDocument.Parse(File.ReadAllText(path));
        }

        private static float F(JsonElement e, string n, float d = 0f)
            => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? (float)v.GetDouble() : d;
        private static int I(JsonElement e, string n, int d = 0)
            => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : d;
        private static string S(JsonElement e, string n)
            => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static bool B(JsonElement e, string n)
            => e.TryGetProperty(n, out var v) && (v.ValueKind == JsonValueKind.Number ? v.GetInt32() != 0
                : v.ValueKind == JsonValueKind.True);

        public void LoadAll()
        {
            LoadEnemies();
            LoadTowers();
            LoadUpgrades();
            LoadStages();
            LoadDifficulties();
            LoadAreas();
        }

        void LoadEnemies()
        {
            using var doc = Doc("enemy_roster.json");
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                var e = prop.Value;
                var def = new EnemyDefinition
                {
                    name = prop.Name,
                    enemyMoveType = (EEnemyMoveTypeDef)I(e, "enemyMoveType"),
                    spawnMode = (ESpawnMode)I(e, "spawnMode"),
                    expValue = I(e, "expValue"),
                    maxLife = F(e, "maxLife"),
                    speed = F(e, "speed"),
                    fireSpeed = F(e, "fireSpeed", 1f),
                    balloonSpeed = F(e, "balloonSpeed", 1f),
                    maxShockSpeed = F(e, "maxShockSpeed", 2f),
                    additionShockRate = F(e, "additionShockRate", 1f),
                    collisionScaleH = F(e, "collisionScaleH", 1f),
                    collisionScaleV = F(e, "collisionScaleV", 1f),
                    animMoveSpeed = F(e, "animMoveSpeed", 1f),
                };
                if (e.TryGetProperty("attributes", out var attrs) && attrs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var a in attrs.EnumerateArray())
                    {
                        var at = new EnemyAttributes { effectScale = F(a, "effectScale", 1f) };
                        if (a.TryGetProperty("strengthDamageInfos", out var si))
                            foreach (var s in si.EnumerateArray())
                                at.strengthDamageInfos.Add(new StrengthDamageInfo
                                {
                                    strength = (EEnemyStrengthTypeDef)I(s, "strength"),
                                    damageTime = F(s, "damageTime", 1f),
                                    reactionTime = F(s, "reactionTime", 1f),
                                });
                        def.attributes.Add(at);
                    }
                }
                Enemies[prop.Name] = def;
            }
        }

        void LoadTowers()
        {
            using var doc = Doc("structures_TowerBase.json");
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                var t = new TowerDefinition
                {
                    gameObjectName = S(e, "__gameObject"),
                    structureUID = I(e, "structureUID"),
                    towerName = S(e, "towerName"),
                    attackType = (ETowerAttackDef)I(e, "attackType"),
                    strengthType = (EEnemyStrengthTypeDef)I(e, "strengthType"),
                    classType = (EEnemyClassTypeDef)I(e, "classType"),
                    enemyDetectionRange = F(e, "enemyDetectionRange"),
                    playerDetectionRange = F(e, "playerDetectionRange"),
                    attackPower = F(e, "attackPower"),
                    attackSpeed = F(e, "attackSpeed"),
                    attackRangeInner = F(e, "attackRangeInner"),
                    attackRangeOuter = F(e, "attackRangeOuter"),
                    attackSpread = F(e, "attackSpread"),
                    balloonAimable = B(e, "balloonAimable"),
                    oneShotOneBalloon = B(e, "oneShotOneBalloon"),
                    fullRangeFire = B(e, "fullRangeFire"),
                    costCoin = I(e, "costCoin"),
                    costGem = I(e, "costGem"),
                    refundCoin = I(e, "refundCoin"),
                    refundGem = I(e, "refundGem"),
                    buildTime = F(e, "buildTime"),
                    buildRange = F(e, "buildRange"),
                    magazineCapacity = I(e, "magazineCapacity", -1),
                    burstCount = I(e, "burstCount", 1),
                    burstInterval = F(e, "burstInterval"),
                    dlcLock = B(e, "dlcLock"),
                };
                if (e.TryGetProperty("attackAttenuations", out var att))
                    foreach (var a in att.EnumerateArray())
                        t.attackAttenuations.Add(new AttackAttenuation
                        { rate = F(a, "rate"), attenuation = F(a, "attenuation", 1f), snap = B(a, "snap") });
                if (t.gameObjectName != null)
                    Towers[t.gameObjectName] = t;
            }
        }

        void LoadUpgrades()
        {
            string file = "structures_TowerUpgradeSettingGeneric.json";
            if (!File.Exists(Path.Combine(_dir, file))) return;
            using var doc = Doc(file);
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                string go = S(e, "__gameObject");
                if (go == null || !Towers.TryGetValue(go, out var t)) continue;
                if (!e.TryGetProperty("upgrades", out var ups)) continue;
                foreach (var u in ups.EnumerateArray())
                    t.upgrades.Add(new TowerUpgradeLevel
                    {
                        level = I(u, "level"),
                        reachExp = I(u, "reachExp"),
                        costCoin = I(u, "costCoin"),
                        costGem = I(u, "costGem"),
                        refundCoin = I(u, "refundCoin"),
                        refundGem = I(u, "refundGem"),
                        attackPower = F(u, "attackPower"),
                        attackSpeed = F(u, "attackSpeed"),
                        attackRangeInner = F(u, "attackRangeInner"),
                        attackRangeScale = F(u, "attackRangeScale", 1f),
                        affectRangeRate = F(u, "affectRangeRate", 1f),
                        attackSpread = F(u, "attackSpread"),
                        burstCount = I(u, "burstCount", 1),
                        burstInterval = F(u, "burstInterval"),
                    });
            }
        }

        void LoadStages()
        {
            using var doc = Doc("stage_waves_resolved.json");
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                var st = new StageDefinition
                {
                    index = I(e, "index"),
                    stageName = S(e, "stageName"),
                    areaName = S(e, "areaName"),
                    initCoin = I(e, "initCoin"),
                    initGem = I(e, "initGem"),
                    waveCoinRate = F(e, "waveCoinRate", 1f),
                    waveTimeRate = F(e, "waveTimeRate", 1f),
                };
                if (e.TryGetProperty("waves", out var waves) && waves.ValueKind == JsonValueKind.Array)
                {
                    foreach (var w in waves.EnumerateArray())
                    {
                        var wave = new Wave();
                        foreach (var d in w.EnumerateArray())
                        {
                            var wd = new WaveDifficulty();
                            if (d.TryGetProperty("spawns", out var sp))
                                foreach (var s in sp.EnumerateArray())
                                    wd.spawns.Add(ReadSpawn(s));
                            wave.perDifficulty.Add(wd);
                        }
                        st.waves.Add(wave);
                    }
                }
                Stages.Add(st);
            }
        }

        WaveSpawn ReadSpawn(JsonElement s)
        {
            var sp = new WaveSpawn
            {
                enemy = S(s, "enemy"),
                enemySpawnNum = I(s, "enemySpawnNum"),
                enemySpawnInterval = F(s, "enemySpawnInterval"),
                delay = F(s, "delay"),
                enemyTrackerEnable = B(s, "enemyTrackerEnable"),
                pathStartTime = F(s, "pathStartTime"),
                pathName = S(s, "m_pathName"),
                activateIndex = I(s, "m_activateIndex"),
                offsetStartAngle = F(s, "offsetStartAngle"),
                offsetFreq = F(s, "offsetFreq"),
                offsetDist = F(s, "offsetDist"),
                walkDriftFreq = F(s, "walkDriftFreq"),
                walkDriftDist = F(s, "walkDriftDist"),
            };
            if (s.TryGetProperty("m_pathList", out var pl))
                foreach (var p in pl.EnumerateArray())
                    sp.pathList.Add(new Vector3Data(F(p, "x"), F(p, "y"), F(p, "z")));
            if (s.TryGetProperty("m_segTypeList", out var sg))
                foreach (var g in sg.EnumerateArray())
                    sp.segTypeList.Add(g.GetInt32());
            return sp;
        }

        void LoadDifficulties()
        {
            using var doc = Doc("stages_DifficultySettings.json");
            var root = doc.RootElement[0];
            if (root.TryGetProperty("difficultySettings", out var ds))
                foreach (var d in ds.EnumerateArray())
                    Difficulties.Add(new DifficultyMultipliers
                    {
                        coinValueRate = F(d, "coinValueRate", 1f),
                        danceEXPRate = F(d, "danceEXPRate", 1f),
                        towerBuildTimeRate = F(d, "towerBuildTimeRate", 1f),
                        enemyHPRate = F(d, "enemyHPRate", 1f),
                        bossHPRate = F(d, "bossHPRate", 1f),
                        enemyAmountRate = F(d, "enemyAmountRate", 1f),
                    });
        }

        void LoadAreas()
        {
            using var doc = Doc("globalsettings_AreaStageInfoMap.json");
            var root = doc.RootElement[0];
            if (!root.TryGetProperty("areaInfos", out var areas)) return;
            foreach (var a in areas.EnumerateArray())
            {
                var ai = new AreaInfo { areaLabel = S(a, "areaLabel") };
                if (a.TryGetProperty("stageInfos", out var sis))
                    foreach (var si in sis.EnumerateArray())
                        ai.stageInfos.Add(new StageInfo
                        {
                            initialLocked = B(si, "initialLocked"),
                            stageSceneName = S(si, "stageSceneName"),
                            stageLabel = S(si, "stageLabel"),
                            stageUnlockName = S(si, "stageUnlockName"),
                            areaIDOverride = I(si, "areaIDOverride", -1),
                        });
                Areas.Add(ai);
            }
        }
    }
}
