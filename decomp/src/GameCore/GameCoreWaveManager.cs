// GameCore/GameCoreWaveManager.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Simulation-side wave director: converts the stage's Q4.WaveResource (WaveData per
// difficulty) into WaveProgress/SpawnProgress bookkeeping, spawns GameCoreEnemy
// instances on schedule, tracks kills, shortens the next wave on early clears,
// drives boss-minion waves and detects stage clear.
// Logic from Ghidra decompilation of GameCore.GameCoreWaveManager methods
// (RVA 0x4D1AB0..0x4D5590). Field offsets from global-metadata.dat.

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreWaveManager : GameCoreObject // TypeDefIndex: 2991
    {
        private Q4.WaveManager viewer;                                    // 0x60
        [CoreObjectPool.DeepCopyAttribute]
        private List<WaveProgress> waveProgress;                          // 0x68
        [CoreObjectPool.DeepCopyAttribute]
        private List<WaveProgress> waveBossMinionProgress;                // 0x70
        private bool m_DestroySelf;                                       // 0x78
        private bool m_hasClearedStage;                                   // 0x79
        private Q4.DifficultySettings.Difficulty m_difficultyLevel;       // 0x7C
        private int currentWaveIndex;                                     // 0x80
        private float waveClearTimeBonusRate;                             // 0x84
        private float remainingStageClearDelay;                           // 0x88
        private GameCoreHandle m_bossHandle;                              // 0x90 (32-byte struct)
        private int currentBossWaveIndex;                                 // 0xB0
        private bool m_introSequenceFinished;                               // 0xB4 (auto-property backing field)
        private float stageStartDelay;                                    // 0xB8

        // CONFIRMED from ELF rodata (see _RODATA_CONSTANTS_NOTES.md):
        // DAT_00b7c47c = 0.0f — compared against GameCoreEnemy.m_life in
        // UpdateStageClear ("no living enemy remains").
        private const float StageClearLifeEpsilon = 0.0f;                 // DAT_00b7c47c

        // CONFIRMED from ELF rodata: DAT_00b7c480 = 1.0f, DAT_00b7c488 = 0.0f.
        private const float SpawnStartEpsilon = 1.0f;                     // DAT_00b7c480
        private const float SpawnDelayEpsilon = 0.0f;                     // DAT_00b7c488

        // CONFIRMED from ELF rodata: DAT_00b7c484 = 0.01745329238f =
        // Mathf.Deg2Rad — offsetStartAngle is stored in degrees and converted
        // to radians before Mathf.Round derives the path start time / spawn
        // group sample offset.
        private const float OffsetAngleScale = 0.01745329f;               // DAT_00b7c484 (Mathf.Deg2Rad)

        // Delay between the intro sequence finishing and the first wave tick.
        // Confirmed literal 0x40980000 in OnIntroSequenceFinished @0x4D5540.
        private const float StageStartDelayAfterIntro = 4.75f;

        // Sentinel written into remainingSpawnStartDelay to force a
        // boss-minion group to spawn immediately (0xC47A0000 @0x4D2C4F).
        private const float MinionSpawnNow = -1000.0f;

        // ---- properties ---------------------------------------------------

        // get_hasClearedStage @0x4D2370
        public bool hasClearedStage
        {
            get { return m_hasClearedStage; }
        }

        // get_waveCurrentIndex @0x4C2AF0
        public int waveCurrentIndex
        {
            get { return currentWaveIndex; }
        }

        // get_waveProgressList @0x4D2380
        public List<WaveProgress> waveProgressList
        {
            get { return waveProgress; }
        }

        // get_bossHasAppeared @0x4D2390
        public bool bossHasAppeared
        {
            get { return m_bossHandle.m_handle > -1; }
        }

        // Auto-property (get @0x4D23A0 / set @0x4D23B0); setter is private in
        // metadata but RecreateViewer-era code only sets it through the event
        // handlers below, both inside this class.
        public bool introSequenceFinished
        {
            get { return m_introSequenceFinished; }
            private set { m_introSequenceFinished = value; }
        }

        // get_Instance @0x4D23C0
        // INFERRED: the generic token in the decompiled FirstObject<T> call is
        // mislabeled by Ghidra; the TypeRef (DAT_010d53b8) is GameCoreWaveManager.
        public static GameCoreWaveManager Instance
        {
            get { return GameCore.Instance.FirstObject<GameCoreWaveManager>(); }
        }

        // .ctor @0x4D1AB0 (parameterless; used by the object pool / deserialization)
        public GameCoreWaveManager()
            : base()
        {
            waveProgress = new List<WaveProgress>();
            waveBossMinionProgress = new List<WaveProgress>();
            m_difficultyLevel = (Q4.DifficultySettings.Difficulty)1;      // INFERRED: Medium default
            waveClearTimeBonusRate = 1.0f;
            m_bossHandle = GameCoreHandle.nullHandle;
        }

        // .ctor @0x4D1C00
        public GameCoreWaveManager(Q4.WaveManager viewer)
            : this()
        {
            this.viewer = viewer;
            SetupWaveData(Q4.GamePreferences.Instance.difficultySetting);

            Events.gameOverEvent.AddListener(OnGameOver, Event.EventTime.Immediate);
            Events.enemyDestroyedEvent.AddListener(OnEnemyDestroyed, Event.EventTime.Immediate);
            Events.enemyAttackedHomeEvent.AddListener(OnEnemyAttacked, Event.EventTime.Immediate);
            Events.introSequenceFinishedEvent.AddListener(OnIntroSequenceFinished, Event.EventTime.Immediate);
            Events.postResyncEvent.AddListener(OnResync, Event.EventTime.Immediate);
        }

        // DestroySelf @0x4D2410 (virtual slot 6)
        // Flags the object dead, drops it from the collision manager and
        // unsubscribes every listener registered in the ctor.
        public override void DestroySelf()
        {
            m_DestroySelf = true;                                         // GameCoreObject @0x18
            if (GameCore.Instance != null)
            {
                GameCore.Instance.collisionManager.RemoveCoreObject(this);
                Events.gameOverEvent.RemoveListener(OnGameOver);
                Events.enemyDestroyedEvent.RemoveListener(OnEnemyDestroyed);
                Events.enemyAttackedHomeEvent.RemoveListener(OnEnemyAttacked);
                Events.introSequenceFinishedEvent.RemoveListener(OnIntroSequenceFinished);
                Events.postResyncEvent.RemoveListener(OnResync);
            }
        }

        // OnResync @0x4D2670
        // After a network resync the (freshly restored) manager must consider
        // the intro done so wave spawning resumes immediately.
        private void OnResync()
        {
            GameCoreWaveManager latest = GameCore.Instance.FirstObject<GameCoreWaveManager>();
            latest.introSequenceFinished = true;
        }

        // GetEnemyPrefabForWave @0x4D26D0
        // Returns the EnemyBase prefab of the first spawn group of a wave.
        public Q4.EnemyBase GetEnemyPrefabForWave(int waveIndex)
        {
            if (waveProgress.Count <= waveIndex)
                return null;
            List<SpawnProgress> spawners = waveProgress[waveIndex].spawnerProgress;
            if (spawners.Count < 1)
                return null;
            return spawners[0].spawnData.enemyObject.GetComponent<Q4.EnemyBase>();
        }

        // GetTimeUntilWaveActivates @0x4D27B0
        // Sum of (start delay + activate delay + wave time) of every wave
        // before the given one, plus the given wave's own start and activate
        // delays; never negative.
        public float GetTimeUntilWaveActivates(int waveIndex)
        {
            if (waveProgress.Count <= waveIndex)
                return 0.0f;                                              // INFERRED: 0 when out of range
            float total = 0.0f;
            for (int i = 0; i < waveIndex; i++)
            {
                WaveProgress p = waveProgress[i];
                total += p.remainingSpawnStartDelay + p.remainingWaveActivateDelay + p.remainingWaveTime;
            }
            WaveProgress current = waveProgress[waveIndex];
            return Mathf.Max(total + current.remainingSpawnStartDelay + current.remainingWaveActivateDelay, 0.0f);
        }

        // IsStartedWave @0x4D2970
        // INFERRED: bounds-checks against currentWaveIndex but indexes with
        // 'index' (confirmed in decompilation — kept faithful).
        public bool IsStartedWave(int index)
        {
            if (waveProgress.Count <= currentWaveIndex)
                return false;
            return waveProgress[index].started;
        }

        // Tick @0x4D2A00 (virtual slot 7)
        public override void Tick()
        {
            if (m_DestroySelf)
            {
                DestroySelf();                                            // virtual call @vtable+0x170
            }
            else
            {
                UpdateWaveSpawning();
            }
        }

        // UpdateWaveSpawning @0x4D2A20
        // Main per-frame driver: counts down the post-intro stage start delay,
        // advances the regular wave list, then the boss-minion list once the
        // boss has spawned (minion groups are released as the boss walks its
        // path, keyed by DistanceToTime of the boss travel distance).
        public void UpdateWaveSpawning()
        {
            if (Q4.Jarvis.Instance.walkthroughMode || !introSequenceFinished)
                return;

            stageStartDelay -= GameCore.TickDeltaTime;
            if (stageStartDelay > 0.0f)
                return;

            UpdateStageClear();

            if (currentWaveIndex < waveProgress.Count)
            {
                if (UpdateWaveProgress(waveProgress[currentWaveIndex], currentWaveIndex, false))
                    currentWaveIndex++;
            }

            if (m_bossHandle.m_handle > -1 && currentBossWaveIndex < waveBossMinionProgress.Count)
            {
                GameCoreEnemy boss = m_bossHandle.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (boss != null)
                {
                    if (boss.pathMove != null)                            // GameCoreEnemy @0x80
                    {
                        // Time the boss needs to reach its current distance on the path.
                        float bossTime = boss.pathMove.DistanceToTime(boss.m_distance); // @0xC0
                        WaveProgress minion = waveBossMinionProgress[currentBossWaveIndex];
                        if (minion.remainingSpawnStartDelay <= bossTime)
                            minion.remainingSpawnStartDelay = MinionSpawnNow;
                        if (minion.remainingSpawnStartDelay < 0.0f)
                        {
                            if (UpdateWaveProgress(minion, currentBossWaveIndex, true))
                                currentBossWaveIndex++;
                        }
                    }
                }
                else
                {
                    m_bossHandle = GameCoreHandle.nullHandle;             // boss died/vanished
                }
            }
        }

        // UpdateStageClear @0x4D2D30
        // Once every wave has been reached: wait until no enemy is alive, then
        // count down Q4.GameInfoController.stageClearDelay and fire
        // stageClearedEvent exactly once.
        public void UpdateStageClear()
        {
            if (currentWaveIndex < waveProgress.Count || m_hasClearedStage)
                return;

            if (remainingStageClearDelay == 0.0f)
            {
                // Start the countdown only when the field is empty.
                bool anyAlive = false;
                foreach (GameCoreEnemy enemy in GameCore.Instance.AllObjects<GameCoreEnemy>())
                {
                    if (enemy.m_life > StageClearLifeEpsilon)             // GameCoreEnemy @0x70
                    {
                        anyAlive = true;
                        break;
                    }
                }
                if (anyAlive)
                    return;
                remainingStageClearDelay = Q4.GameInfoController.Instance.stageClearDelay;
            }
            else
            {
                remainingStageClearDelay -= GameCore.TickDeltaTime;
                if (remainingStageClearDelay <= 0.0f)
                {
                    Events.stageClearedEvent.Invoke(this);
                    m_hasClearedStage = true;
                }
            }
        }

        // UpdateWaveProgress @0x4D3140
        // Advances one wave (regular or boss-minion). Returns true when the
        // wave is fully spawned and activated, signalling "advance the index".
        // Group ids for spawnGroupStarted/Ended events are waveIndex*1000 +
        // spawner index (confirmed @0x4D323C / 0x4D3EA2).
        private bool UpdateWaveProgress(WaveProgress a_currentWave, int a_currentWaveIndex, bool isMinnion)
        {
            // Pass 1: fire spawnGroupStartedEvent for every spawner whose
            // (wave start delay + own delay) has expired, sampling the spawn
            // position from the path curve for the presentation layer.
            int groupId = a_currentWaveIndex * 1000;
            foreach (SpawnProgress sp in a_currentWave.spawnerProgress)
            {
                if (!sp.hasTriggeredStartEvent &&
                    a_currentWave.remainingSpawnStartDelay + sp.remainingSpawnDelay <= SpawnStartEpsilon)
                {
                    Q4.SpawnData spawnData = sp.spawnData;
                    float sideOffset = Mathf.Round(spawnData.offsetStartAngle * OffsetAngleScale) * spawnData.offsetDist;
                    Vector3 pos = spawnData.pathCurve.SampleDirect(spawnData.pathStartTime, sideOffset);
                    // NOTE: the binary contains a second, result-discarded
                    // SampleDirect(pathStartTime, 0) call here (dead code?). TODO.

                    Q4.EnemyBase prefab = spawnData.enemyObject.GetComponent<Q4.EnemyBase>();
                    if (prefab != null)
                    {
                        if (prefab.spawnMode == Q4.ESpawnMode.Balloon)
                            pos += Vector3.up * prefab.BalloonSpawnHeight;
                        else if (prefab.enemyMoveType == Q4.EEnemyMoveTypeDef.air)
                            pos += Vector3.up * prefab.groundOffsetY;
                    }

                    Events.spawnGroupStartedEvent.Invoke(groupId, null, pos, isMinnion);
                    sp.hasTriggeredStartEvent = true;
                }
                groupId++;
            }

            float dt = GameCore.TickDeltaTime;

            // The wave has not begun yet: just burn down its start delay.
            if (a_currentWave.remainingSpawnStartDelay > 0.0f)
            {
                a_currentWave.remainingSpawnStartDelay = Mathf.Max(a_currentWave.remainingSpawnStartDelay - dt, 0.0f);
                return false;
            }

            if (!a_currentWave.started)
            {
                a_currentWave.started = true;
                Events.waveStartedEvent.Invoke(this, a_currentWaveIndex);
            }

            if (a_currentWave.remainingWaveActivateDelay > 0.0f)
            {
                a_currentWave.remainingWaveActivateDelay = Mathf.Max(a_currentWave.remainingWaveActivateDelay - dt, 0.0f);
                if (a_currentWave.remainingWaveActivateDelay <= 0.0f && !isMinnion)
                    Events.waveActivateEvent.Invoke(this, a_currentWaveIndex);
            }

            a_currentWave.remainingWaveTime = Mathf.Max(a_currentWave.remainingWaveTime - dt, 0.0f);

            // Pass 2: actual spawning.
            bool waveComplete = a_currentWave.remainingWaveActivateDelay <= 0.0f;
            int spawnerIndex = -1;
            foreach (SpawnProgress sp in a_currentWave.spawnerProgress)
            {
                spawnerIndex++;
                if (sp.remainingSpawnDelay > SpawnDelayEpsilon)
                {
                    sp.remainingSpawnDelay -= dt;
                    waveComplete = false;
                    continue;
                }
                if (sp.numSpawned >= sp.numToSpawn)
                    continue;                                             // keeps 'waveComplete' as-is (confirmed)

                Q4.SpawnData spawnData = sp.spawnData;
                float pathStartTime =
                    Mathf.Round(spawnData.offsetStartAngle * OffsetAngleScale + a_currentWave.waveTime * spawnData.enemySpawnInterval)
                    * spawnData.offsetDist;                               // INFERRED: offsetDist scaling of the rounded time

                GameCoreEnemy enemy = new GameCoreEnemy(
                    spawnData.enemyObject.GetComponent<Q4.EnemyBase>(),
                    spawnData.pathCurve,
                    spawnData.pathSegTypeInfos,
                    pathStartTime,
                    spawnData.pathName,
                    a_currentWave.speedRatio,
                    a_currentWave.hpRatio,
                    a_currentWave.moneyArray[a_currentWave.totalNumSpawned],
                    a_currentWave.gemArray[a_currentWave.totalNumSpawned],
                    a_currentWaveIndex,
                    spawnerIndex,
                    sp.numSpawned,
                    spawnData.enemySpawnInterval,
                    spawnData.offsetStartAngle,
                    spawnData.walkDriftDist,
                    spawnData.walkDriftFreq,
                    isMinnion,
                    spawnData.enemyTrackerEnable);

                GameObjectHelper.SetParent(enemy.GetUnityObject<GameObject>(), viewer.GetEnemyRoot());

                Events.enemySpawnEvent.Invoke(enemy);

                if (enemy.m_isBoss)                                       // GameCoreEnemy @0x98
                    m_bossHandle = enemy.handle;

                if (sp.numSpawned == sp.numToSpawn - 1)
                    Events.spawnGroupEndedEvent.Invoke(a_currentWaveIndex * 1000 + spawnerIndex);

                a_currentWave.totalNumSpawned++;
                sp.numSpawned++;
                if (sp.numSpawned < sp.numToSpawn)
                {
                    sp.remainingSpawnDelay = spawnData.enemySpawnInterval;
                    waveComplete = false;
                }
            }

            a_currentWave.waveTime += dt;
            return waveComplete;
        }

        // SkipToWave @0x4D4150 (debug/walkthrough helper)
        public void SkipToWave(int waveIndex)
        {
            SetupWaveData(m_difficultyLevel);
            currentWaveIndex = Mathf.Clamp(waveIndex, 0, waveProgress.Count - 1);
            waveProgress[currentWaveIndex].remainingSpawnStartDelay = 0.0f;
        }

        // SetupWaveData @0x4D1F80
        // (Re)builds waveProgress from the stage's WaveResource for a given
        // difficulty. A negative delay marks the end of the playable wave list
        // for that difficulty. Boss-minion waves come from the per-difficulty
        // BossMinionSpawnData lists; their remainingSpawnStartDelay is the
        // boss-path time at which the group is released.
        public void SetupWaveData(Q4.DifficultySettings.Difficulty a_difficulty)
        {
            m_difficultyLevel = a_difficulty;
            waveClearTimeBonusRate = Q4.StageMain.CurrentStage.initWaveTimeRate;

            waveProgress.Clear();
            waveBossMinionProgress.Clear();

            foreach (Q4.WaveData waveData in viewer.GetWaveResource().WaveDataList)
            {
                if (waveData.delay[(int)m_difficultyLevel] < 0.0f)
                    break;
                waveProgress.Add(CreateWaveProgress(waveData));
            }

            List<Q4.BossMinionSpawnData> bossList = viewer.GetWaveResource().WaveDataBossListMedium;
            if (m_difficultyLevel == Q4.DifficultySettings.Difficulty.Hard)
                bossList = viewer.GetWaveResource().WaveDataBossListHard;
            else if (m_difficultyLevel == Q4.DifficultySettings.Difficulty.Easy)
                bossList = viewer.GetWaveResource().WaveDataBossListEasy;

            if (bossList != null)
            {
                foreach (Q4.BossMinionSpawnData minionData in bossList)
                {
                    WaveProgress progress = CreateWaveProgress(minionData.waveData);
                    progress.remainingSpawnStartDelay = minionData.time;
                    waveBossMinionProgress.Add(progress);
                }
            }
        }

        // CreateWaveProgress @0x4D4220
        // Builds the runtime progress record for one WaveData: per-difficulty
        // delay/speed/hp ratios, the mini-dialog settings, the wave activate
        // delay (time for the fastest spawner's enemies to reach the activate
        // node), per-spawner SpawnProgress entries, total wave time and the
        // per-enemy money/gem distribution arrays.
        public WaveProgress CreateWaveProgress(Q4.WaveData waveData)
        {
            WaveProgress progress = new WaveProgress();
            int diff = (int)m_difficultyLevel;

            progress.remainingSpawnStartDelay = waveData.delay[diff];
            progress.speedRatio = waveData.speedRatio[diff];
            progress.hpRatio = waveData.hpRatio[diff];
            progress.totalNumSpawned = 0;
            progress.dialogStageSettings =
                new MiniDialogController.MiniDialogStageSettings(waveData.dialogLabel[diff], waveData.dialogIcon[diff]);
            progress.remainingWaveActivateDelay = float.MaxValue;

            // Activate delay: minimum over spawners of
            // curveLengthB4Activation / (speedRatio * enemy speed), where the
            // enemy speed depends on its spawn mode (balloon/fire override).
            List<Q4.SpawnData> spawnList = waveData.perDifficulyLists[diff].spawnDataList;
            int numSpawners = spawnList.Count;
            int spawnerIndex = 0;
            while (spawnerIndex < numSpawners)
            {
                Q4.SpawnData spawnData = spawnList[spawnerIndex];
                Q4.EnemyBase prefab = spawnData.enemyObject.GetComponent<Q4.EnemyBase>();
                float speed = prefab.AverageSpeed;
                if (prefab.spawnMode == Q4.ESpawnMode.Balloon)
                    speed = prefab.balloonSpeed;
                else if (prefab.spawnMode == Q4.ESpawnMode.Fire)
                    speed = prefab.fireSpeed;

                float activateTime = spawnData.pathCurve.curveLengthB4Activation / (waveData.speedRatio[diff] * speed);
                if (activateTime < progress.remainingWaveActivateDelay)
                    progress.remainingWaveActivateDelay = activateTime;
                spawnerIndex++;
            }

            // Per-spawner progress.
            int totalNumEnemy = 0;
            foreach (Q4.SpawnData spawnData in spawnList)
            {
                SpawnProgress sp = new SpawnProgress();
                sp.remainingSpawnDelay = spawnData.delay;
                sp.numToSpawn = Q4.DifficultySettings.Instance.EnemyToSpawnByDifficulty(spawnData.enemySpawnNum);
                sp.spawnData = spawnData;
                progress.spawnerProgress.Add(sp);
                totalNumEnemy += sp.numToSpawn;
            }
            progress.totalNumEnemy = totalNumEnemy;
            progress.totalNumEnemyDead = 0;

            // Total wave time: last spawner's start delay plus its spawn train.
            SpawnProgress lastSpawner = progress.spawnerProgress[numSpawners - 1];
            progress.remainingWaveTime += lastSpawner.remainingSpawnDelay;
            if (lastSpawner.numToSpawn > 1)
                progress.remainingWaveTime += (lastSpawner.numToSpawn - 1) * lastSpawner.spawnData.enemySpawnInterval;

            DistributeCurrency(waveData.totalMoney[diff], waveData.money[diff], totalNumEnemy, out progress.moneyArray);
            DistributeCurrency(waveData.totalGem[diff], waveData.gem[diff], totalNumEnemy, out progress.gemArray);
            CheckWaveMoney(waveData.totalMoney[diff], progress.moneyArray);
            CheckWaveGem(waveData.totalGem[diff], progress.gemArray);
            return progress;
        }

        // Money and gem distribution share one inlined algorithm in the binary
        // (CreateWaveProgress @0x4D44D0..0x4D4B00 for money, @0x4D4B00..0x4D4DE0
        // for gems); factored out here. 'baseValue' is the guaranteed per-enemy
        // amount (max of the flat per-wave value and total/numEnemies); the
        // remainder is sprinkled over randomly chosen entries that still hold
        // exactly baseValue, using the deterministic GameCoreObject RNG.
        // INFERRED factoring — the two inlined copies are identical in shape.
        private void DistributeCurrency(int total, int baseValueSetting, int totalNumEnemy, out int[] array)
        {
            int baseValue = Mathf.Max(total / totalNumEnemy, baseValueSetting);
            array = System.Linq.Enumerable.Repeat(baseValue, totalNumEnemy).ToArray();

            int numLeftoverEnemies = 0;
            if (baseValue > 0)
                numLeftoverEnemies = totalNumEnemy - total / baseValue;

            if (numLeftoverEnemies >= 0 && baseValue == baseValueSetting)
            {
                // The flat setting already covers everyone. Entries not part of
                // the even split (total / baseValue of them keep 'baseValue')
                // get zeroed; when the division is uneven the very last picked
                // entry receives the remainder (total % baseValue) instead.
                int remainder = baseValue < 1 ? 0 : total % baseValue;
                while (numLeftoverEnemies > 0)
                {
                    int idx;
                    do { idx = GameCoreObject.RandomRange(0, array.Length, handle); }
                    while (array[idx] != baseValue);
                    numLeftoverEnemies--;
                    array[idx] = (numLeftoverEnemies == 0 && remainder > 0) ? remainder : 0;
                }
            }
            else
            {
                // Uneven split: distribute (total % totalNumEnemy) as +1 bonuses.
                int leftoverCurrency = total % totalNumEnemy;
                while (leftoverCurrency > 0)
                {
                    int idx;
                    do { idx = GameCoreObject.RandomRange(0, array.Length, handle); }
                    while (array[idx] != baseValue);
                    array[idx] = baseValue + 1;
                    leftoverCurrency--;
                }
            }
        }

        // CheckWaveMoney @0x4D4E00 — [Conditional] debug verify; compiled to a
        // null-check only in this build (no-op).
        [System.Diagnostics.Conditional("UNITY_ASSERTIONS")]               // INFERRED condition symbol
        private void CheckWaveMoney(int totalMoney, int[] moneyArray)
        {
        }

        // CheckWaveGem @0x4D4E20 — [Conditional] debug verify; no-op in this build.
        [System.Diagnostics.Conditional("UNITY_ASSERTIONS")]               // INFERRED condition symbol
        private void CheckWaveGem(int totalGem, int[] gemArray)
        {
        }

        // RecreateViewer @0x4D4E40 (virtual slot 5)
        // Re-links the (non-serializable) SpawnData references after a load:
        // finds the scene WaveManager again and re-points every SpawnProgress
        // at the matching entry of the wave resource lists.
        public override GameObject RecreateViewer()
        {
            viewer = Object.FindObjectOfType<Q4.WaveManager>();
            if (viewer != null)
            {
                int diff = (int)m_difficultyLevel;
                for (int i = 0; i < waveProgress.Count; i++)
                {
                    Q4.WaveData waveData = viewer.GetWaveResource().WaveDataList[i];
                    List<Q4.SpawnData> spawnList = waveData.perDifficulyLists[diff].spawnDataList;
                    List<SpawnProgress> spawners = waveProgress[i].spawnerProgress;
                    for (int j = 0; j < spawners.Count; j++)
                        spawners[j].spawnData = spawnList[j];
                }

                List<Q4.BossMinionSpawnData> bossList = viewer.GetWaveResource().WaveDataBossListMedium;
                if (m_difficultyLevel == Q4.DifficultySettings.Difficulty.Hard)
                    bossList = viewer.GetWaveResource().WaveDataBossListHard;
                else if (m_difficultyLevel == Q4.DifficultySettings.Difficulty.Easy)
                    bossList = viewer.GetWaveResource().WaveDataBossListEasy;

                for (int i = 0; i < waveBossMinionProgress.Count; i++)
                {
                    Q4.WaveData waveData = bossList[i].waveData;
                    List<Q4.SpawnData> spawnList = waveData.perDifficulyLists[diff].spawnDataList;
                    List<SpawnProgress> spawners = waveBossMinionProgress[i].spawnerProgress;
                    for (int j = 0; j < spawners.Count; j++)
                        spawners[j].spawnData = spawnList[j];
                }
            }
            return viewer != null ? viewer.gameObject : null;
        }

        // ---- event handlers -------------------------------------------------

        // OnGameOver @0x4D52A0
        public void OnGameOver()
        {
            m_DestroySelf = true;
        }

        // OnEnemyDestroyed @0x4D52B0
        public void OnEnemyDestroyed(GameCoreTower tower, GameCoreEnemy enemy, EnemyHitInfo a_hitInfo)
        {
            OnDeadEnemy(enemy);
        }

        // OnDeadEnemy @0x4D52C0
        // Counts the kill against its wave. When the wave is wiped out:
        // zero the dead wave's timers on the LATEST manager version, shorten
        // the next wave's start delay by waveClearTimeBonusRate, then raise
        // waveEndedEvent.
        private void OnDeadEnemy(GameCoreEnemy enemy)
        {
            if (enemy == null)
                return;
            int waveIndex = enemy.m_waveIndex;                            // GameCoreEnemy @0xE8
            if (waveIndex < 0 || waveProgress.Count <= waveIndex)
                return;

            WaveProgress progress = waveProgress[waveIndex];
            progress.totalNumEnemyDead++;
            if (progress.totalNumEnemy != progress.totalNumEnemyDead)
                return;

            if (waveIndex + 1 < waveProgress.Count)
            {
                GameCoreWaveManager latest = handle.GetMostRecentObjectVersion<GameCoreWaveManager>();
                WaveProgress deadWave = latest.waveProgress[waveIndex];
                deadWave.remainingWaveTime = 0.0f;
                deadWave.remainingSpawnStartDelay = 0.0f;
                deadWave.remainingWaveActivateDelay = 0.0f;

                WaveProgress next = latest.waveProgress[waveIndex + 1];
                float startDelay = next.remainingSpawnStartDelay;
                next.remainingSpawnStartDelay =
                    Mathf.Max(startDelay - (startDelay * waveClearTimeBonusRate - startDelay), 0.0f);
            }

            Events.waveEndedEvent.Invoke(this, waveIndex);
        }

        // OnEnemyAttacked @0x4D5520
        // An enemy that reached the home counts as dead for wave bookkeeping
        // (bosses excepted — they must actually die).
        public void OnEnemyAttacked(GameCoreEnemy enemy, GameCoreHome home, GameCoreHome.ChibiData chibi)
        {
            if (!enemy.m_isBoss)                                          // GameCoreEnemy @0x98
                OnDeadEnemy(enemy);
        }

        // OnIntroSequenceFinished @0x4D5540
        public void OnIntroSequenceFinished(GameCorePlayer finishedPlayer)
        {
            GameCoreWaveManager latest = handle.GetMostRecentObjectVersion<GameCoreWaveManager>();
            latest.introSequenceFinished = true;
            latest.stageStartDelay = StageStartDelayAfterIntro;           // 4.75f (0x40980000)
        }

        // ---- nested types ---------------------------------------------------

        // GameCoreWaveManager.SpawnProgress (TypeDefIndex: 2992)
        // Runtime state of one spawn group (one SpawnData entry of a wave).
        [System.Serializable]
        public class SpawnProgress
        {
            public Q4.SpawnData spawnData;                                // 0x10
            public float remainingSpawnDelay;                             // 0x18
            public int numToSpawn;                                        // 0x1C
            public int numSpawned;                                        // 0x20
            public bool hasTriggeredStartEvent;                           // 0x24

            // .ctor @0x4D4DF0 (trivial)
            public SpawnProgress()
            {
            }
        }

        // GameCoreWaveManager.WaveProgress (TypeDefIndex: 2993)
        // Runtime state of one wave.
        [System.Serializable]
        public class WaveProgress
        {
            [CoreObjectPool.DeepCopyAttribute]
            public List<SpawnProgress> spawnerProgress;                   // 0x10
            public float remainingSpawnStartDelay;                        // 0x18
            public float remainingWaveActivateDelay;                      // 0x1C
            public float remainingWaveTime;                               // 0x20
            public float waveTime;                                        // 0x24
            public float speedRatio;                                      // 0x28
            public float hpRatio;                                         // 0x2C
            public bool started;                                          // 0x30
            public int totalNumEnemy;                                     // 0x34
            public int totalNumEnemyDead;                                 // 0x38
            public int totalNumSpawned;                                   // 0x3C
            public MiniDialogController.MiniDialogStageSettings dialogStageSettings; // 0x40 (12-byte struct)
            public int[] moneyArray;                                      // 0x50
            public int[] gemArray;                                        // 0x58

            // .ctor @0x4D4D00
            public WaveProgress()
            {
                spawnerProgress = new List<SpawnProgress>();
                speedRatio = 1.0f;
                hpRatio = 1.0f;
                dialogStageSettings = default(MiniDialogController.MiniDialogStageSettings);
            }

            // get_activated @0x4D4090
            public bool activated
            {
                get { return remainingWaveActivateDelay <= 0.0f; }
            }
        }
    }
}
