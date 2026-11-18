// GameCore/GameCoreEnemy.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// The simulation-side enemy. Pure GameCore logic: it walks a CatmullCurve path, avoids /
// blocks behind other enemies, attacks the home (chibi), takes damage (body or discrete
// attack points), rides balloons, and dies / drowns. Presentation is notified through
// GameCore.Events; the Q4.EnemyBase view is only read for tuning data.
//
// Field offsets from global-metadata.dat; method bodies from Ghidra decompilation
// (RVA 0x4ACDC0..0x4B4DB0). Float constants resolved from the binary .rodata.
// IL2CPP boilerplate (class-init guards, stack canaries, null-throw stubs, hidden
// struct out-pointers) has been removed per RECONSTRUCTION_GUIDE.md.
//
// Enemy lifecycle / AI flow:
//   spawn(.ctor) -> Tick each sim frame:
//     TickBuffs, TickAttackPoints, UpdateGroundOffset
//     if attacking      -> StateAttacking (non-boss dies at the home; boss holds position)
//     else if waiting   -> hold position on the path
//     else              -> UdpateDrift + StateWalk (avoidance, slope, advance distance)
//     orientationInterpolator.Tick, BossAI, balloon pop near path end, DrownDetection,
//     CheckIfDestroy (life<=0 -> DestroySelf)
//   damage -> DealDamage / DealPlayerDamage -> enemyHitEvent / popBalloons / enemyDestroyedEvent
//   death  -> DestroySelf (remove attack points + listeners, terminate buffs, base cleanup)

using System.Collections.Generic;
using UnityEngine;
using Q4; // EnemyBase, CatmullCurve, PathEdit, Layers, AISettings, DifficultySettings,
          // MonstersAudio, UnityEvents, Tags, GameObjectHelper, AudioEventHandler, enums
using Q4.UI.Debug; // DebugMenuCanvas (debug damage multiplier)
using GameCore.Event; // CoreEvent callbacks

namespace GameCore
{
    public class GameCoreEnemy : GameCoreObject, IBuffs, IDamageable, ISpeedScale
    {
        private const float secondsBetweenAvoidanceUpdates = 0.5f;

        public EEnemyMoveTypeDef enemyMoveType;                 // 0x60
        private string m_prefabName;                            // 0x68
        private float m_life;                                   // 0x70
        private float m_maxLife;                                // 0x74
        private float m_vulnerableDamageTaken;                  // 0x78
        private CorePathMove pathMove;                          // 0x80
        private List<PathEdit.EPathSegType> m_segTypeInfos;     // 0x88
        private string m_pathName;                              // 0x90
        private bool m_isBoss;                                  // 0x98
        private bool m_isJumpingBoss;                           // 0x99
        private EBossType m_bossType;                           // 0x9C
        private bool m_canAttack;                               // 0xA0
        private float m_attackDelay;                            // 0xA4
        private float m_attackFreq;                             // 0xA8
        private float BossAttackDur;                            // 0xAC
        private float BossAttackDist;                           // 0xB0
        private float BossAttackHeightForward;                  // 0xB4
        private float BossAttackHeightBack;                     // 0xB8
        private bool m_isAttacking;                             // 0xBC
        private bool m_tookDamageThisFrame;                     // 0xBD
        private float m_distance;                               // 0xC0
        private int m_coinValue;                                // 0xC4
        private int m_gemValue;                                 // 0xC8
        private float m_groundOffsetY;                          // 0xCC
        private float m_groundOffsetDestY;                      // 0xD0
        private float m_groundOffsetModeHeight;                 // 0xD4
        private float m_groundOffsetVelY;                       // 0xD8
        private float m_groundOffsetAccScaleY;                  // 0xDC
        private float m_groundOffsetVelDamping;                 // 0xE0
        private float m_groundOffsetBalloonDeltaY;              // 0xE4
        private int m_waveIndex;                                // 0xE8
        private int m_waveSubIndex;                             // 0xEC
        private int m_waveSpawnIndex;                           // 0xF0
        private float m_waveDistance;                           // 0xF4
        private GameCoreHandle m_enemyBlockingMe;               // 0xF8
        private List<GameCoreHandle> m_enemiesBlockedByMe;      // 0x118
        private GameCoreHandle m_enemyToOvertake;               // 0x120
        private Vector3 m_moveVector;                           // 0x140
        private float m_spawnMinionWaitDur;                     // 0x14C
        private float m_waitTime;                               // 0x150
        private float m_speed;                                  // 0x154
        private float m_fireSpeed;                              // 0x158
        private float m_balloonSpeed;                           // 0x15C
        private float m_speedCur;                               // 0x160
        private float m_sideOffset;                             // 0x164
        private float m_sideOffsetCenter;                       // 0x168
        private float m_detectionTime;                          // 0x16C
        private float m_driftOffset;                            // 0x170
        private float m_driftTime;                              // 0x174
        private float m_driftFreq;                              // 0x178
        private float m_driftDist;                              // 0x17C
        private bool m_isHeavyEnemy;                            // 0x180
        private bool m_isBalloon;                               // 0x181
        private bool m_startedBalloon;                          // 0x182
        private int m_numBalloons;                              // 0x184
        private float m_balloonHP;                              // 0x188
        private float m_balloonPopHPInterval;                   // 0x18C
        private bool m_isOnFire;                                // 0x190
        private bool m_isFalling;                               // 0x191
        private float m_speedScale;                             // 0x194
        private float m_lowHpThreshold;                         // 0x198
        private float m_lowHpSpeed;                             // 0x19C
        private float m_damagedHpThreshold;                     // 0x1A0
        private BuffContainer m_buffs;                          // 0x1A8
        private List<GameCoreHandle> m_attackPoints;            // 0x1B0
        private AIHelper.BlockingInfo m_blockingInfo;           // 0x1B8
        private AudioEventHandler.Sounds m_sounds;              // 0x1C0
        private AIHelper.TerrainOrientationInterpolator m_orientationInterpolator; // 0x1C8
        private float m_restDur;                                // 0x250
        private float m_jumpDur;                                // 0x254
        private float m_restTime;                               // 0x258
        private float m_jumpTime;                               // 0x25C
        private float m_drownDepth;                             // 0x260
        private float m_ChibiAvoidRadius;                       // 0x264
        private float m_ChibiAvoidDur;                          // 0x268
        public bool m_IsGameOver;                               // 0x26E
        private GameCoreHandle m_attackHomeHandle;              // 0x270
        private GameCoreHome.ChibiData m_attackChibi;           // 0x290
        private bool m_bossAttackEffectTriggered;               // 0x298
        private bool m_bossAttacking;                           // 0x299
        private float m_bossAttackTime;                         // 0x29C

        // Auto-properties (<enemyTrackerEnable>k__BackingField @0x26C, <IsMinion>k__BackingField @0x26D)
        public bool enemyTrackerEnable { get; private set; }
        public bool IsMinion { get; protected set; }

        // ---------------------------------------------------------------------------
        // Constructors / spawning
        // ---------------------------------------------------------------------------

        // .ctor @0x4ACDC0 — default values used by the object pool.
        public GameCoreEnemy()
            : base()
        {
            enemyMoveType = EEnemyMoveTypeDef.ground;
            m_canAttack = true;
            m_attackFreq = 4.0f;
            BossAttackDur = 1.0f;
            BossAttackDist = 1.5f;
            BossAttackHeightForward = 1.5f;
            BossAttackHeightBack = 0.5f;
            m_groundOffsetAccScaleY = 1.0f;
            m_groundOffsetVelDamping = 1.0f;
            m_waveIndex = -1;
            m_waveSubIndex = -1;
            m_waveSpawnIndex = -1;
            m_waveDistance = 1.0f;
            m_enemyBlockingMe = GameCoreHandle.nullHandle;
            m_enemiesBlockedByMe = new List<GameCoreHandle>();
            m_enemyToOvertake = GameCoreHandle.nullHandle;
            m_moveVector = Vector3.forward;
            m_speed = 1.0f;
            m_fireSpeed = 1.0f;
            m_balloonSpeed = 1.0f;
            m_speedScale = 1.0f;
            m_restDur = 1.0f;
            m_jumpDur = 0.5f;
            m_restTime = 1.0f;
            m_jumpTime = 0.5f;
            m_attackHomeHandle = GameCoreHandle.nullHandle;
        }

        // .ctor @0x4AD0E0 — spawn an enemy on a path from an EnemyBase prefab.
        public GameCoreEnemy(EnemyBase enemyPrefab, CatmullCurve pathCurve,
            List<PathEdit.EPathSegType> segTypeInfos, float pathStartTime, string pathName,
            float speedRatio, float hpRatio, int money, int gem, int waveIndex, int waveSubIndex,
            int waveSpawnIndex, float spawnInterval, float sideCenterOffset, float driftDist,
            float driftFreq, bool isMinion, bool isEnemyTrackEnableOnMe)
            : this()
        {
            enemyTrackerEnable = isEnemyTrackEnableOnMe;
            IsMinion = isMinion;
            m_sideOffsetCenter = sideCenterOffset;
            m_sideOffset = sideCenterOffset;
            m_segTypeInfos = segTypeInfos;

            if (pathCurve == null)
                return; // original throws NullReferenceException on the null path below

            m_distance = pathCurve.NodeTimeToDistance(pathStartTime);
            position = pathCurve.SampleLinearDistance(m_distance);
            if (!IsDestroyed())
                GameCore.Instance.collisionManager.UpdateCoreObject(this);

            if (enemyPrefab == null)
                return;

            m_prefabName = enemyPrefab.name;
            EnemyBase view = Object.Instantiate(enemyPrefab, position, Quaternion.identity);
            Q4.GameCoreBridge.Instance.SetUnityObject(handle, view);
            if (view == null)
                return;

            // Collision cylinder from the rendered bounds of the "Character"-tagged model.
            Transform charTransform = GameObjectHelper.FindTransformWithTag(view.gameObject, Tags.Character);
            if (charTransform == null)
                return;
            // INFERRED: Ghidra labels the generic GetComponentInChildren<WaveResource>, but a
            // Renderer is required for .bounds; the model renderer is what is actually read.
            Renderer modelRenderer = charTransform.gameObject.GetComponentInChildren<Renderer>();
            if (modelRenderer == null)
                return;

            collision = new Cylinder(modelRenderer.bounds);
            if (!IsDestroyed())
                GameCore.Instance.collisionManager.UpdateCoreObject(this);
            m_isHeavyEnemy = collision.height >= 0.99f;
            collision = new Cylinder(collision.radius * view.collisionScaleH, collision.height * view.collisionScaleV);
            if (!IsDestroyed())
                GameCore.Instance.collisionManager.UpdateCoreObject(this);

            // Initial facing from the path tangent.
            float t = pathCurve.DistanceToTime(m_distance, -1.0f);
            m_moveVector = pathCurve.SampleVelDirect(t);
            m_moveVector.y = 0.0f;
            m_moveVector.Normalize();
            view.Transform.rotation = Quaternion.LookRotation(m_moveVector, Vector3.up);

            pathMove = new CorePathMove(pathCurve);
            m_pathName = pathName;
            m_speed = speedRatio * view.speed;
            m_fireSpeed = speedRatio * view.fireSpeed;
            m_balloonSpeed = speedRatio * view.balloonSpeed;
            if (!m_isBalloon)
                m_speedCur = (m_isOnFire ? m_fireSpeed : m_speed) * m_speedScale;
            m_speedScale = 1.0f;

            m_lowHpThreshold = DifficultySettings.Instance.EnemyHPByDifficulty(view.LowHPThreshold * hpRatio);
            m_lowHpSpeed = view.LowHPSpeed;
            m_damagedHpThreshold = DifficultySettings.Instance.EnemyHPByDifficulty(view.DamagedHpThreshold * hpRatio);
            m_maxLife = DifficultySettings.Instance.EnemyHPByDifficulty(hpRatio * view.maxLife);
            m_life = m_maxLife;
            m_vulnerableDamageTaken = 0.0f;
            m_coinValue = money;
            m_gemValue = gem;

            ESpawnMode spawnMode = enemyPrefab.spawnMode;
            m_isOnFire = spawnMode == ESpawnMode.Fire;
            m_isBalloon = spawnMode == ESpawnMode.Balloon;
            m_startedBalloon = spawnMode == ESpawnMode.Balloon;
            m_groundOffsetAccScaleY = view.BalloonAccScale;
            m_groundOffsetVelDamping = view.BalloonDamping;
            m_groundOffsetModeHeight = view.BalloonHeight;
            if (m_isBalloon)
            {
                enemyMoveType = EEnemyMoveTypeDef.air;
                m_groundOffsetDestY = view.BalloonHeight;
                m_groundOffsetY = view.BalloonSpawnHeight;
                Balloon balloon = view.GetComponentInChildren<Balloon>();
                if (balloon != null)
                {
                    m_numBalloons = balloon.BalloonsRemaining;
                    m_balloonHP = balloon.hp;
                    if (m_numBalloons < 1)
                    {
                        m_balloonPopHPInterval = 0.0f;
                        m_groundOffsetBalloonDeltaY = 0.0f;
                    }
                    else
                    {
                        m_balloonPopHPInterval = m_balloonHP / m_numBalloons;
                        m_groundOffsetBalloonDeltaY = (m_numBalloons != 1) ? m_groundOffsetDestY / (m_numBalloons + 1) : 0.0f;
                    }
                }
            }
            else
            {
                enemyMoveType = enemyPrefab.enemyMoveType;
                m_groundOffsetY = view.groundOffsetY;
                m_groundOffsetDestY = view.groundOffsetY;
            }

            position += Vector3.up * m_groundOffsetY;
            if (!IsDestroyed())
                GameCore.Instance.collisionManager.UpdateCoreObject(this);
            view.Transform.position = position;

            m_waveIndex = waveIndex;
            m_waveSubIndex = waveSubIndex;
            m_waveSpawnIndex = waveSpawnIndex;
            float spd = m_isBalloon ? m_balloonSpeed : (m_isOnFire ? m_fireSpeed : m_speed) * m_speedScale;
            m_waveDistance = spd * spawnInterval;

            m_buffs = new BuffContainer();
            m_drownDepth = view.DrownDepth;
            m_driftDist = driftDist;
            m_driftFreq = driftFreq * Mathf.Deg2Rad;
            m_isBoss = view.IsBoss;
            m_isJumpingBoss = view.isJumpingBoss;
            m_bossType = view.BossType;
            m_restDur = view.BossRestDur;
            m_jumpDur = view.BossJumpDur;
            m_restTime = m_restDur;
            m_jumpTime = 0.0f;
            m_attackFreq = view.AttackFreq;
            BossAttackDur = view.BossAttackDur;
            BossAttackDist = view.BossAttackDist;
            BossAttackHeightForward = view.BossAttackHeightForward;
            BossAttackHeightBack = view.BossAttackHeightBack;
            m_spawnMinionWaitDur = view.BossSpawnWaitDur;

            m_orientationInterpolator = new AIHelper.TerrainOrientationInterpolator(this);

            if (!m_isBalloon)
            {
                InitAttackPoints(view);
            }
            else
            {
                m_attackPoints = new List<GameCoreHandle>(1);
                Balloon balloon = view.GetComponentInChildren<Balloon>();
                Vector3 localPos = Vector3.up * view.BalloonTargetHeight;
                var ap = new GameCoreEnemyAttackPoint(this, 0.25f, balloon.gameObject, localPos, null);
                m_attackPoints.Add(ap.handle);
            }
            TickAttackPoints(0.0f);

            Events.gameOverEvent.AddListener(new CoreEvent.Callback(OnGameOver), EventTime.PostGameCoreTick);
            if (m_isBoss)
            {
                Events.spawnGroupStartedEvent.AddListener(
                    new CoreEvent.Callback<int, GameCoreEnemy, Vector3, bool>(OnSpawnGroupStarted),
                    EventTime.PostGameCoreTick);
            }
            m_attackDelay = 1.0f;
            m_canAttack = false;
            m_sounds = view.Sounds;
            m_ChibiAvoidRadius = view.ChibiAvoidRadius;
            // NOTE: the decompilation reads ChibiAvoidRadius (0x12C) for BOTH fields here;
            // reproduced faithfully (may be an original quirk vs. ChibiAvoidDur at 0x130).
            m_ChibiAvoidDur = view.ChibiAvoidRadius;
        }

        // ---------------------------------------------------------------------------
        // Properties
        // ---------------------------------------------------------------------------

        // get_CanAttack @0x4AEC90 — first access announces the chibi-avoidance zone to the view.
        public bool CanAttack
        {
            get
            {
                if (!m_canAttack)
                {
                    UnityEvents.chibiAvoidanceZoneEvent.Invoke(position, m_ChibiAvoidRadius, m_ChibiAvoidDur);
                    m_canAttack = true;
                }
                return m_attackDelay <= 0.0f;
            }
        }

        // get_CanAttackInternal @0x4AED50
        private bool CanAttackInternal
        {
            get { return m_attackDelay <= 0.0f; }
        }

        // get_IsBoss @0x4AEE60
        public bool IsBoss { get { return m_isBoss; } }

        // get_IsSlowMode @0x4AEE70
        public bool IsSlowMode { get { return m_lowHpThreshold <= m_vulnerableDamageTaken; } }

        // get_IsDamagedMode @0x4AEE90
        public bool IsDamagedMode { get { return m_damagedHpThreshold <= m_vulnerableDamageTaken; } }

        // get_Speed @0x4AE3A0
        public float Speed
        {
            get
            {
                if (m_isBalloon)
                    return m_balloonSpeed;
                return (m_isOnFire ? m_fireSpeed : m_speed) * m_speedScale;
            }
        }

        // get_SpeedCur @0x4AEEB0
        public float SpeedCur { get { return m_speedCur; } }

        // get_terrainOrientation @0x4AEEC0
        public AIHelper.TerrainInfo terrainOrientation
        {
            get { return m_orientationInterpolator.interpolatedSample; }
        }

        // get_MoveVec @0x4AEEF0
        public Vector3 MoveVec { get { return m_moveVector; } }

        // get_IsBalloon @0x4AEF10
        public bool IsBalloon { get { return m_isBalloon; } }

        // get_IsOnFire @0x4AEF20 / set_IsOnFire @0x4AEF30
        public bool IsOnFire
        {
            get { return m_isOnFire; }
            set
            {
                if (m_isOnFire && !value)
                    Events.onFireExtinguished.Invoke(this);
                m_isOnFire = value;
            }
        }

        // get_IsAntiMagic @0x4AEFD0
        public bool IsAntiMagic
        {
            get { return DamageHelper.WeakDamageClassTypes(handle.GetUnityObject()).Contains(EEnemyClassTypeDef.Magic); }
        }

        // get_IsAntiPhysics @0x4AF050
        public bool IsAntiPhysics
        {
            get { return DamageHelper.WeakDamageClassTypes(handle.GetUnityObject()).Contains(EEnemyClassTypeDef.Physic); }
        }

        // get_WaveID @0x4AF0D0
        public int WaveID { get { return m_waveIndex; } }

        // get_WaveGroupID @0x4AF0E0
        public int WaveGroupID { get { return m_waveIndex * 10000 + m_waveSubIndex; } }

        // get_WaveSpawnIndex @0x4AF100
        public int WaveSpawnIndex { get { return m_waveSpawnIndex; } }

        // get_EnemyBlockingMe @0x4AF110
        public GameCoreHandle EnemyBlockingMe { get { return m_enemyBlockingMe; } }

        // get_EnemyBlockedByMe @0x4AF120
        public List<GameCoreHandle> EnemyBlockedByMe { get { return m_enemiesBlockedByMe; } }

        // get_Buffs @0x4AF130 (IBuffs)
        public BuffContainer Buffs { get { return m_buffs; } }

        // get_AttackPoints @0x4AF140
        public List<GameCoreHandle> AttackPoints { get { return m_attackPoints; } }

        // get_PathDistance @0x4AF150
        public float PathDistance { get { return m_distance; } }

        // get_GroundOffsetY @0x4AF160
        public float GroundOffsetY { get { return m_groundOffsetY; } }

        // get_SideOffsetCenter @0x4AF170
        private float SideOffsetCenter { get { return m_sideOffsetCenter + m_driftOffset; } }

        // INFERRED accessor: the decompilation shows GameCoreEnemyAttackPoint reading the
        // private m_sideOffset (0x164) across classes; exposed internally for that read.
        internal float SideOffset { get { return m_sideOffset; } }

        // get_IsBlocked @0x4AF190
        public bool IsBlocked { get { return !m_enemyBlockingMe.isNull; } }

        // get_PathMove @0x4AF260
        public CorePathMove PathMove { get { return pathMove; } }

        // get_PathName @0x4AF270
        public string PathName { get { return m_pathName; } }

        // get_IsHeavyEnemy @0x4AF280
        public bool IsHeavyEnemy { get { return m_isHeavyEnemy; } }

        // ---------------------------------------------------------------------------
        // Simple getters / setters
        // ---------------------------------------------------------------------------

        // IsSameEnemyWaveGroup @0x4AF220
        public bool IsSameEnemyWaveGroup(GameCoreEnemy a_other)
        {
            return WaveGroupID == a_other.WaveGroupID;
        }

        // Host @0x4AF760 (IDamageable) — an enemy is its own host.
        public GameCoreEnemy Host() { return this; }

        // GetCoinValue @0x4AF770
        public int GetCoinValue() { return m_coinValue; }

        // GetGemValue @0x4AF780
        public int GetGemValue() { return m_gemValue; }

        // GetWaveIndex @0x4AF790
        public int GetWaveIndex() { return m_waveIndex; }

        // GetLife @0x4AF7A0
        public float GetLife() { return m_life; }

        // GetVulnerableDamageTaken @0x4AF7B0
        public float GetVulnerableDamageTaken() { return m_vulnerableDamageTaken; }

        // GetMaxLife @0x4AF7C0
        public float GetMaxLife() { return m_maxLife; }

        // GetSpeedScale @0x4AF7D0 (ISpeedScale)
        public float GetSpeedScale() { return m_speedScale; }

        // SetSpeedScale @0x4AF7E0 (ISpeedScale)
        public void SetSpeedScale(float scale) { m_speedScale = scale; }

        // Collision @0x4B4A00 (IDamageable)
        public Cylinder Collision() { return collision; }

        // Position @0x4B4A10 (IDamageable)
        public Vector3 Position() { return position; }

        // Handle @0x4B4D90 (IDamageable)
        public GameCoreHandle Handle() { return handle; }

        // UnityObject @0x4B4DA0 (IDamageable)
        public GameObject UnityObject() { return handle.GetUnityObject(); }

        // MoveType @0x4B4DB0 (IDamageable)
        public EEnemyMoveTypeDef MoveType() { return enemyMoveType; }

        // ---------------------------------------------------------------------------
        // Attack points
        // ---------------------------------------------------------------------------

        // InitAttackPoints @0x4AE700
        private void InitAttackPoints(EnemyBase enemyViewer)
        {
            if (enemyViewer != null)
            {
                List<GameObject> pointViews = enemyViewer.AttackPoints();
                if (pointViews != null)
                {
                    m_attackPoints = new List<GameCoreHandle>(pointViews.Count);
                    foreach (GameObject pointView in pointViews)
                    {
                        Collider col = pointView.GetComponent<Collider>();
                        float radius = 0.5f;
                        if (col != null)
                            radius = ((SphereCollider)col).radius;
                        Vector3 localPos = pointView.transform.localPosition;
                        AttackPointSetting setting = pointView.GetComponent<AttackPointSetting>();
                        var ap = new GameCoreEnemyAttackPoint(this, radius, pointView, localPos, setting);
                        m_attackPoints.Add(ap.handle);
                    }
                }
            }
            // Kao / Fat bosses enable only the attack points matching their current move type.
            if (m_isBoss && (m_bossType == EBossType.Kao || m_bossType == EBossType.Fat))
            {
                if (enemyMoveType == EEnemyMoveTypeDef.air)
                {
                    ConfigAttackPoints(EEnemyMoveTypeDef.ground, false);
                    ConfigAttackPoints(EEnemyMoveTypeDef.air, true);
                }
                else if (enemyMoveType == EEnemyMoveTypeDef.ground)
                {
                    ConfigAttackPoints(EEnemyMoveTypeDef.ground, true);
                    ConfigAttackPoints(EEnemyMoveTypeDef.air, false);
                }
            }
        }

        // TickAttackPoints @0x4AEAD0 — keep points glued to the host's position/orientation.
        // (dt is present in the metadata signature but unused in the body.)
        private void TickAttackPoints(float dt)
        {
            if (m_attackPoints == null)
                return;
            for (int i = 0; i < m_attackPoints.Count; i++)
            {
                GameCoreEnemyAttackPoint ap = m_attackPoints[i].GetMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
                if (ap != null)
                {
                    ap.position = position + Quaternion.LookRotation(m_moveVector) * ap.localPosition;
                    if (!ap.IsDestroyed())
                        GameCore.Instance.collisionManager.UpdateCoreObject(ap);
                }
            }
        }

        // ConfigAttackPoints @0x4AF290
        private void ConfigAttackPoints(EEnemyMoveTypeDef a_type, bool a_enable)
        {
            if (m_attackPoints == null)
                return;
            foreach (GameCoreHandle apHandle in m_attackPoints)
            {
                GameCoreEnemyAttackPoint ap = apHandle.GetMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
                if (ap != null && ap.MoveType() == a_type)
                    ap.SetAttackPointEnabled(a_enable);
            }
        }

        // RemoveAllAttackPoints @0x4AF3F0
        private void RemoveAllAttackPoints()
        {
            if (m_attackPoints == null)
                return;
            foreach (GameCoreHandle apHandle in m_attackPoints)
            {
                GameCoreEnemyAttackPoint ap = apHandle.GetMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
                if (ap != null)
                    ap.SetAttackPointEnabled(false);
            }
        }

        // ---------------------------------------------------------------------------
        // Lifecycle
        // ---------------------------------------------------------------------------

        // DestroySelf @0x4AF540
        public override void DestroySelf()
        {
            RemoveAllAttackPoints();
            Events.gameOverEvent.RemoveListener(new CoreEvent.Callback(OnGameOver));
            if (m_isBoss)
            {
                Events.spawnGroupStartedEvent.RemoveListener(
                    new CoreEvent.Callback<int, GameCoreEnemy, Vector3, bool>(OnSpawnGroupStarted));
            }
            if (m_buffs != null)
                m_buffs.Terminate(this);
            // Base cleanup (destroyed flag + collision-manager removal); the decompilation
            // inlines it here.
            base.DestroySelf();
        }

        // OnGameOver @0x4AF700 — event callback; flag the most recent version of this enemy.
        public void OnGameOver()
        {
            GameCoreEnemy enemy = handle.GetMostRecentObjectVersion<GameCoreEnemy>();
            if (enemy != null)
                enemy.m_IsGameOver = true;
        }

        // OnSpawnGroupStarted @0x4B4D80 — boss waits before spawning its minion group.
        private void OnSpawnGroupStarted(int a_id, GameCoreEnemy a_enemy, Vector3 a_pos, bool a_isMinion)
        {
            m_waitTime = m_spawnMinionWaitDur;
        }

        // RecreateViewer @0x4B2960
        public override GameObject RecreateViewer()
        {
            EnemyBase view = GetUnityObject<EnemyBase>();
            if (view == null)
                view = CreateViewerFromPrefabName<EnemyBase>(m_prefabName);
            return view.gameObject;
        }

        // Tick @0x4AF7F0 — main per-frame simulation step.
        public override void Tick()
        {
            m_tookDamageThisFrame = false;
            if (m_IsGameOver)
                return;

            float dt = GameCore.TickDeltaTime;
            if (m_canAttack)
                m_attackDelay -= dt;
            if (m_buffs != null)
                m_buffs.Tick(this);
            TickAttackPoints(dt);
            UpdateGroundOffset(dt);

            if (!m_isAttacking)
            {
                m_waitTime = Mathf.Max(0.0f, m_waitTime - dt);
                if (m_waitTime > 0.0f || m_canAttack)
                {
                    // Holding position (spawn wait / ready to attack): stay on the path.
                    Vector3 pos, vel;
                    pathMove.Sample(m_distance, m_sideOffset, out pos, out vel);
                    if (enemyMoveType == EEnemyMoveTypeDef.ground)
                        pos = RaycastGroundSlope(pos);
                    position = pos + Vector3.up * m_groundOffsetY;
                    if (!IsDestroyed())
                        GameCore.Instance.collisionManager.UpdateCoreObject(this);
                }
                else
                {
                    UdpateDrift(dt);
                    StateWalk(dt);
                }
            }
            else
            {
                StateAttacking(dt);
            }

            m_orientationInterpolator.Tick();
            BossAI(dt);

            if (m_isBalloon && pathMove.pathLength - m_distance < 10.0f)
                PopBalloons(100000000); // pop all before reaching the home

            DrownDetection();
            // NOTE: decompilation also reads pathMove.curveLengthBeforeActivation here with the
            // result unused (likely an artifact); the effective tail is the destroy check.
            CheckIfDestroy();
        }

        // TickBuffs @0x4AFC00
        private void TickBuffs()
        {
            if (m_buffs != null)
                m_buffs.Tick(this);
        }

        // CheckIfDestroy @0x4B0FB0
        public void CheckIfDestroy()
        {
            if (m_life <= 0.0f && !IsDestroyed())
                DestroySelf();
        }

        // ---------------------------------------------------------------------------
        // Movement / walking
        // ---------------------------------------------------------------------------

        // UdpateDrift @0x4AFE80 (original typo preserved) — sinusoidal lateral drift.
        private void UdpateDrift(float dt)
        {
            m_driftTime += dt * m_driftFreq;
            m_driftOffset = Mathf.Sin(m_driftTime) * m_driftDist;
        }

        // StateWalk @0x4AFF20 — avoidance, slope scaling, advance along the path.
        private void StateWalk(float dt)
        {
            m_detectionTime -= dt;
            if (m_blockingInfo == null)
            {
                m_detectionTime = RandomRange(0.0f, secondsBetweenAvoidanceUpdates, handle);
                m_blockingInfo = AIHelper.GetAvoidanceEnemy(2.5f, Speed, this);
            }
            else if (m_detectionTime <= 0.0f)
            {
                m_detectionTime = secondsBetweenAvoidanceUpdates;
                m_blockingInfo = AIHelper.GetAvoidanceEnemy(2.5f, Speed, this);
            }

            float desiredSpeed, desiredSideDist;
            UpdateBlockingEnemies(m_blockingInfo, out desiredSpeed, out desiredSideDist);

            // Slope movement scaling (ground enemies only).
            EnemyBase view = GetUnityObject<EnemyBase>();
            if (view != null && view.IsSlopeMovement && enemyMoveType == EEnemyMoveTypeDef.ground)
            {
                float slopeAngle = m_orientationInterpolator.interpolatedSample.facingSlopeAngle;
                float speedScale, angle;
                if (slopeAngle <= 0.0f)
                {
                    speedScale = view.SlopeDownSpeedScale;
                    angle = view.SlopeDownAngle;
                    slopeAngle = -slopeAngle;
                }
                else
                {
                    speedScale = view.SlopeUpSpeedScale;
                    angle = view.SlopeUpAngle;
                }
                float blend = Mathf.Clamp01(slopeAngle / angle);
                desiredSpeed *= Mathf.Lerp(1.0f, speedScale, blend);
            }

            // Ease lateral offset toward the desired side distance, and speed toward desired.
            m_sideOffset = Mathf.MoveTowards(m_sideOffset, desiredSideDist, m_sideOffsetCenter * 0.5f * dt);
            float accel = (desiredSideDist < 0.01f) ? 15.0f : 4.0f;
            m_speedCur = Mathf.MoveTowards(m_speedCur, desiredSpeed, accel * dt);

            // Advance distance (jumping bosses alternate rest / jump).
            if (!m_isBoss || !m_isJumpingBoss || enemyMoveType != EEnemyMoveTypeDef.ground)
            {
                m_distance += m_speedCur * dt;
            }
            else if (m_restTime <= 0.0f)
            {
                m_jumpTime -= dt;
                if (m_jumpTime > 0.0f)
                    m_distance += m_speedCur * dt;
                else
                    m_restTime = m_restDur;
            }
            else
            {
                m_restTime -= dt;
                if (m_restTime <= 0.0f)
                {
                    m_jumpTime = m_jumpDur;
                    Events.bossJumpEvent.Invoke(this, m_jumpDur);
                }
            }

            Vector3 pos, vel;
            if (!pathMove.Sample(m_distance, m_sideOffset, out pos, out vel))
            {
                DestroySelf(); // reached the end of the path
            }
            else
            {
                if (enemyMoveType == EEnemyMoveTypeDef.ground)
                    pos = RaycastGroundSlope(pos);
                if (!LandedOnDeathPath())
                {
                    position = pos + Vector3.up * m_groundOffsetY;
                    if (!IsDestroyed())
                        GameCore.Instance.collisionManager.UpdateCoreObject(this);
                    m_moveVector = vel;
                    m_moveVector.y = 0.0f;
                    m_moveVector.Normalize();
                }
            }
        }

        // RaycastGroundSlope @0x4B0680 — snap a sampled position to the terrain height, or
        // detect landing while falling.
        private Vector3 RaycastGroundSlope(Vector3 a_pos)
        {
            AIHelper.TerrainInfo terrain = m_orientationInterpolator.interpolatedSample;
            if (!m_isFalling)
            {
                a_pos.y = terrain.terrainHeight;
            }
            else
            {
                if (position.y <= terrain.terrainHeight)
                {
                    m_isFalling = false;
                    m_groundOffsetY = 0.0f;
                    m_groundOffsetVelY = 0.0f;
                }
            }
            return a_pos;
        }

        // UpdateGroundOffset @0x4AFC20 — spring the vertical ground offset toward its target
        // (balloon rise / fall), with gravity while falling and a landing thud.
        private void UpdateGroundOffset(float dt)
        {
            float sign = Mathf.Sign(m_groundOffsetY - m_groundOffsetDestY);
            if (!m_isFalling)
            {
                if (m_groundOffsetY < m_groundOffsetDestY)
                    m_groundOffsetVelY += m_groundOffsetAccScaleY * 9.8f * dt;
                else if (m_groundOffsetY > m_groundOffsetDestY)
                    m_groundOffsetVelY += m_groundOffsetAccScaleY * -9.8f * dt;
            }
            else
            {
                m_groundOffsetVelY += m_groundOffsetAccScaleY * -9.8f * dt;
            }

            m_groundOffsetVelY *= 0.999f;
            m_groundOffsetY += m_groundOffsetVelY * dt;

            if (!m_isFalling)
            {
                if (m_groundOffsetY >= 0.0f)
                {
                    if (sign != Mathf.Sign(m_groundOffsetY - m_groundOffsetDestY))
                        m_groundOffsetVelY *= m_groundOffsetVelDamping;
                }
                else
                {
                    m_groundOffsetY = 0.0f;
                    m_groundOffsetVelY = 0.0f;
                    if (m_sounds != null)
                        MonstersAudio.Instance.PlaySFX(m_sounds.Land, true);
                }
            }
        }

        // StateAttacking @0x4B0750 — non-boss attackers die at the home; bosses hold position.
        // (dt is present in the metadata signature but unused in the body.)
        private void StateAttacking(float dt)
        {
            if (!m_isBoss)
            {
                // Resolve the attacked home (result unused in the original), then self-destruct.
                m_attackHomeHandle.GetMostRecentObjectVersion<GameCoreHome>();
                DestroySelf();
            }
            else
            {
                Vector3 pos, vel;
                if (pathMove.Sample(m_distance, m_sideOffset, out pos, out vel))
                {
                    if (enemyMoveType == EEnemyMoveTypeDef.ground)
                        pos = RaycastGroundSlope(pos);
                    position = pos + Vector3.up * m_groundOffsetY;
                    if (!IsDestroyed())
                        GameCore.Instance.collisionManager.UpdateCoreObject(this);
                }
            }
        }

        // FindBlockingEnemies @0x4B2AF0
        private AIHelper.BlockingInfo FindBlockingEnemies()
        {
            return AIHelper.GetAvoidanceEnemy(2.5f, Speed, this);
        }

        // UpdateBlockingEnemies @0x4B2BA0 — turn the blocking info into a desired speed and
        // side distance. Debug DrawLine calls in the original are omitted (debug-only).
        private void UpdateBlockingEnemies(AIHelper.BlockingInfo blockingInfo,
            out float a_desiredSpeed, out float a_desiredSideDist)
        {
            Vector3 pos = position;
            Vector3 moveVec = m_moveVector;
            float speed = Speed;
            float sideCenter = SideOffsetCenter;
            float desiredSpeed = speed;
            float sameGroupDist = float.PositiveInfinity;

            // Refresh the three candidate blockers, dropping any that no longer exist.
            GameCoreEnemy enemySG = null;
            if (!blockingInfo.enemySameGroup.isNull)
            {
                enemySG = blockingInfo.enemySameGroup.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (enemySG == null)
                    blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
                else
                    blockingInfo.distanceSameGroup = Vector3.Dot(moveVec, enemySG.position - pos);
            }
            GameCoreEnemy enemyDP = null;
            if (!blockingInfo.enemyDiffPath.isNull)
            {
                enemyDP = blockingInfo.enemyDiffPath.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (enemyDP == null)
                    blockingInfo.enemyDiffPath = GameCoreHandle.nullHandle;
                else
                {
                    blockingInfo.distanceSameGroup = Vector3.Dot(moveVec, enemyDP.position - pos) - enemyDP.collision.radius;
                    m_detectionTime = Mathf.Min(m_detectionTime, 0.1f);
                }
            }
            GameCoreEnemy enemySP = null;
            if (!blockingInfo.enemySamePath.isNull)
            {
                enemySP = blockingInfo.enemySamePath.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (enemySP == null)
                    blockingInfo.enemySamePath = GameCoreHandle.nullHandle;
                else
                    blockingInfo.distanceSameGroup = Vector3.Dot(moveVec, enemySP.position - pos) - enemySP.collision.radius;
            }

            // --- Same-wave-group blocker ---------------------------------------------
            if (enemySG != null)
            {
                float pathDistDiff = enemySG.m_distance - m_distance;
                float sgDist = pathDistDiff; // becomes +inf in the slow-down branch below
                float combinedRadius = collision.radius + enemySG.collision.radius + 0.05f;
                float gap = combinedRadius;
                if (enemySG.m_enemyBlockingMe.isNull)
                    gap = m_waveDistance;

                if (!m_isOnFire || enemySG.m_isOnFire)
                {
                    if (m_waveSpawnIndex < enemySG.m_waveSpawnIndex)
                    {
                        // I spawned earlier: I have priority, ignore this blocker.
                        blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
                        sameGroupDist = float.PositiveInfinity;
                    }
                    else
                    {
                        if (pathDistDiff <= combinedRadius)
                        {
                            // Too close: stop behind it.
                            m_enemyBlockingMe = enemySG.handle;
                            m_detectionTime = 0.1f;
                            desiredSpeed = 0.0f;
                        }
                        else
                        {
                            float distGap = pathDistDiff - gap;
                            if (distGap >= 0.25f || !enemySG.m_enemyBlockingMe.isNull)
                            {
                                if (distGap < 0.25f)
                                {
                                    m_enemyBlockingMe = enemySG.handle;
                                    m_detectionTime = 0.1f;
                                    desiredSpeed = 0.0f;
                                }
                                else if (!enemySG.m_buffs.Contains<BuffFastPlayer>())
                                {
                                    float blend = Mathf.Clamp01(distGap / 0.15f);
                                    desiredSpeed = Mathf.Lerp(speed, speed * 1.5f, 1.0f - (1.0f - blend) * (1.0f - blend));
                                }
                            }
                            else
                            {
                                float blend = Mathf.Clamp01(distGap / -0.15f);
                                desiredSpeed = Mathf.Lerp(speed, speed * 0.5f, 1.0f - (1.0f - blend) * (1.0f - blend));
                                sgDist = float.PositiveInfinity;
                                m_enemyBlockingMe = enemySG.handle;
                            }
                        }
                        sideCenter = SideOffsetCenter;
                        sameGroupDist = sgDist;
                    }
                }
                else
                {
                    // I'm on fire and it isn't: try to overtake.
                    m_enemyToOvertake = enemySG.handle;
                }
            }

            // --- Different-path blocker ----------------------------------------------
            if (enemyDP != null)
            {
                if (blockingInfo.distanceDiffPath < sameGroupDist &&
                    blockingInfo.distanceDiffPath < collision.radius + enemyDP.collision.radius + 1.0f)
                {
                    if (enemyDP.m_enemyBlockingMe.isNull)
                        m_enemyBlockingMe = enemyDP.handle;
                }
            }

            // --- Same-path (different group) blocker ---------------------------------
            if (enemySP != null)
            {
                if (blockingInfo.speedSamePath <= 0.0f)
                {
                    if (enemySP.m_enemyBlockingMe.isNull)
                    {
                        desiredSpeed = (blockingInfo.distanceSamePath < 0.5f + collision.radius) ? 0.0f : 0.5f * speed;
                        m_enemyBlockingMe = enemySP.handle;
                    }
                }
                else if (blockingInfo.distanceSamePath < collision.radius + 0.25f)
                {
                    m_enemyToOvertake = enemySP.handle;
                }
            }

            // --- Follow whoever is blocking me ---------------------------------------
            if (!m_enemyBlockingMe.isNull)
            {
                GameCoreEnemy blocker = m_enemyBlockingMe.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (blocker == null)
                {
                    m_enemyBlockingMe = GameCoreHandle.nullHandle;
                }
                else if (WaveGroupID == blocker.WaveGroupID || AISettings.EnableEnemyBlocking)
                {
                    Vector3 blockerFuturePos = blocker.position + blocker.m_moveVector * blocker.m_speedCur;
                    float pathDiff;
                    bool computeSpeed = true;
                    if (WaveGroupID == blocker.WaveGroupID)
                    {
                        pathDiff = blocker.m_distance - m_distance;
                        if (pathDiff < 0.0f && m_waveSpawnIndex < blocker.m_waveSpawnIndex)
                        {
                            int tmp = m_waveSpawnIndex;
                            m_waveSpawnIndex = blocker.m_waveSpawnIndex;
                            blocker.m_waveSpawnIndex = tmp;
                            m_enemyBlockingMe = GameCoreHandle.nullHandle;
                            computeSpeed = false;
                        }
                        else
                        {
                            float combinedR = blocker.collision.radius + collision.radius;
                            m_enemyToOvertake = GameCoreHandle.nullHandle;
                            if (m_waveDistance <= pathDiff)
                                computeSpeed = false;
                            else
                                pathDiff -= combinedR + 0.25f;
                        }
                    }
                    else
                    {
                        float combinedR = blocker.collision.radius + collision.radius + 0.25f;
                        Vector3 diff = blockerFuturePos - position;
                        if (combinedR * combinedR <= diff.sqrMagnitude)
                            computeSpeed = false;
                        else
                            pathDiff = diff.magnitude - combinedR;
                    }
                    if (computeSpeed)
                    {
                        float blend = Mathf.Clamp01(pathDiff * 8.0f);
                        desiredSpeed = blend * speed;
                    }
                }
            }

            // --- Complete an overtake once the slower enemy is behind ----------------
            if (!m_enemyToOvertake.isNull && AISettings.OvertakeSlowerEnemies)
            {
                GameCoreEnemy overtake = m_enemyToOvertake.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (overtake != null)
                {
                    float sideOffset = (collision.radius + overtake.collision.radius) * 0.9f * Mathf.Sign(SideOffsetCenter);
                    float dotForward = Vector3.Dot(m_moveVector, overtake.position - position);
                    if (-Mathf.Abs(sideOffset) >= dotForward)
                    {
                        if (WaveGroupID == overtake.WaveGroupID)
                        {
                            int tmp = m_waveSpawnIndex;
                            m_waveSpawnIndex = overtake.m_waveSpawnIndex;
                            overtake.m_waveSpawnIndex = tmp;
                            blockingInfo.enemySameGroup = GameCoreHandle.nullHandle;
                        }
                        m_enemyToOvertake = GameCoreHandle.nullHandle;
                    }
                }
            }

            a_desiredSpeed = desiredSpeed;
            a_desiredSideDist = sideCenter;
        }

        // LandedOnDeathPath @0x4B4500 — a popped-balloon enemy that lands on a Death segment dies.
        private bool LandedOnDeathPath()
        {
            if (m_startedBalloon && !m_isBalloon && !m_isFalling && m_groundOffsetY <= 0.0f)
            {
                int segIndex = Mathf.FloorToInt(pathMove.DistanceToTime(m_distance));
                if (segIndex >= 0 && m_segTypeInfos != null && segIndex < m_segTypeInfos.Count &&
                    m_segTypeInfos[segIndex] == PathEdit.EPathSegType.Death)
                {
                    var hitInfo = new EnemyHitInfo(null, this, 0.0f, false, 0.0f, 0.0f, false);
                    if (m_isBoss)
                        KillOtherEnemiesOnBossDeath(null);
                    Events.enemyDestroyedEvent.Invoke(null, this, hitInfo);
                    DestroySelf();
                    return true;
                }
            }
            return false;
        }

        // ---------------------------------------------------------------------------
        // Boss AI
        // ---------------------------------------------------------------------------

        // BossAI @0x4B0960
        private void BossAI(float dt)
        {
            if (!m_isBoss)
                return;

            switch (m_bossType)
            {
                case EBossType.Bero:
                case EBossType.Kao:
                    if (m_bossAttacking)
                    {
                        m_bossAttackTime += (1.0f / BossAttackDur) * m_speedScale * dt;
                        float blend;
                        float height;
                        if (m_bossAttackTime >= BossAttackDur)
                        {
                            m_bossAttacking = false;
                            m_bossAttackTime = 0.0f;
                            blend = 0.0f;
                            height = BossAttackHeightForward;
                        }
                        else if (m_bossAttackTime < 0.33f)
                        {
                            blend = m_bossAttackTime / 0.33f;
                            height = BossAttackHeightForward;
                        }
                        else if (m_bossAttackTime >= 0.66f)
                        {
                            blend = (1.0f - m_bossAttackTime) / 0.33f;
                            height = BossAttackHeightBack;
                        }
                        else
                        {
                            height = 0.0f;
                            blend = 1.0f;
                            if (!m_bossAttackEffectTriggered)
                            {
                                Events.bossAttackEffectEvent.Invoke();
                                m_bossAttackEffectTriggered = true;
                            }
                        }
                        blend = Mathf.Clamp01(blend);
                        float upAmount = Mathf.Sin(blend * Mathf.PI) * height;
                        position = position + m_moveVector * (blend * BossAttackDist) + Vector3.up * upAmount;
                        if (!IsDestroyed())
                            GameCore.Instance.collisionManager.UpdateCoreObject(this);
                    }
                    break;

                case EBossType.Fat:
                    // Fly until near the home or sufficiently damaged, then land.
                    if (enemyMoveType == EEnemyMoveTypeDef.air &&
                        !(pathMove.pathLength - m_distance >= 7.0f && m_vulnerableDamageTaken < m_lowHpThreshold))
                    {
                        ConfigAttackPoints(EEnemyMoveTypeDef.air, false);
                        ConfigAttackPoints(EEnemyMoveTypeDef.ground, true);
                        enemyMoveType = EEnemyMoveTypeDef.ground;
                        m_groundOffsetDestY = 0.0f;
                        m_groundOffsetAccScaleY = 1.0f;
                        m_speed = m_lowHpSpeed;
                        m_isFalling = true;
                    }
                    break;

                case EBossType.Tall:
                    if (m_vulnerableDamageTaken >= m_lowHpThreshold)
                        m_speed = m_lowHpSpeed;
                    break;
            }

            if (m_bossType == EBossType.Kao)
                BossAITerrainDetection();
        }

        // BossAITerrainDetection @0x4B4BD0 — Kao boss switches ground/air by path segment type.
        private void BossAITerrainDetection()
        {
            if (m_isFalling)
                return;
            int segIndex = Mathf.FloorToInt(pathMove.DistanceToTime(m_distance));
            if (segIndex < 0 || m_segTypeInfos == null || segIndex >= m_segTypeInfos.Count)
                return;

            PathEdit.EPathSegType segType = m_segTypeInfos[segIndex];
            if (segType == PathEdit.EPathSegType.BossGround && enemyMoveType == EEnemyMoveTypeDef.air)
            {
                enemyMoveType = EEnemyMoveTypeDef.ground;
                m_groundOffsetDestY = 0.0f;
                m_groundOffsetAccScaleY = 1.0f;
                m_speed = m_lowHpSpeed;
                m_isFalling = true;
                ConfigAttackPoints(EEnemyMoveTypeDef.ground, true);
                ConfigAttackPoints(EEnemyMoveTypeDef.air, false);
            }
            else if (segType == PathEdit.EPathSegType.BossAir && enemyMoveType == EEnemyMoveTypeDef.ground)
            {
                enemyMoveType = EEnemyMoveTypeDef.air;
                m_groundOffsetDestY = m_groundOffsetModeHeight;
                ConfigAttackPoints(EEnemyMoveTypeDef.ground, false);
                ConfigAttackPoints(EEnemyMoveTypeDef.air, true);
            }
        }

        // ---------------------------------------------------------------------------
        // Balloons / drowning
        // ---------------------------------------------------------------------------

        // PopBalloons @0x4B0D00
        public void PopBalloons(int a_numBalloonToPop)
        {
            if (m_numBalloons < 1)
                return;
            m_numBalloons -= a_numBalloonToPop;
            if (m_numBalloons < 1)
            {
                // All balloons gone: become a falling ground enemy.
                enemyMoveType = EEnemyMoveTypeDef.ground;
                m_groundOffsetDestY = 0.0f;
                m_groundOffsetAccScaleY = 1.0f;
                m_isBalloon = false;
                m_isFalling = true;
                RemoveAllAttackPoints();
                EnemyBase view = GetUnityObject<EnemyBase>();
                if (view != null)
                    InitAttackPoints(view);
            }
            else
            {
                m_groundOffsetDestY -= m_groundOffsetBalloonDeltaY;
            }
            Events.popBalloonsEvent.Invoke(this, a_numBalloonToPop);
        }

        // DrownDetection @0x4B0E50
        private void DrownDetection()
        {
            if (m_startedBalloon && !m_isBalloon)
            {
                Vector3 checkPos = position + Vector3.up * (collision.radius + m_drownDepth);
                if (Physics.CheckSphere(checkPos, collision.radius, Layers.Instance.WaterMask, QueryTriggerInteraction.Ignore))
                    Drown();
            }
        }

        // Drown @0x4B10C0
        public void Drown()
        {
            if (m_isOnFire)
                Events.onFireExtinguished.Invoke(this);
            m_isOnFire = false;
            // INFERRED: the popped-count immediate is misresolved in the decompilation; a large
            // value pops all remaining balloons (matches the path-end PopBalloons call).
            Events.popBalloonsEvent.Invoke(this, 100000000);
            Events.enemyDrownEvent.Invoke(this);
            DestroySelf();
        }

        // ---------------------------------------------------------------------------
        // Targeting (IDamageable)
        // ---------------------------------------------------------------------------

        // IsAimableTarget @0x4B1000 — the body is aimable only when it has no attack points.
        public bool IsAimableTarget(GameCoreTower tower)
        {
            return m_attackPoints == null || m_attackPoints.Count == 0;
        }

        // ValidateTarget @0x4B0F70 — only targetable once past the pre-activation path length.
        public bool ValidateTarget()
        {
            if (pathMove == null)
                return false;
            return pathMove.curveLengthBeforeActivation < m_distance;
        }

        // Valid @0x4B1060
        public bool Valid()
        {
            if (IsDestroyed())
                return false;
            return m_attackPoints == null || m_attackPoints.Count == 0;
        }

        // PredictPositionAndDirection @0x4AED70 (IDamageable)
        public void PredictPositionAndDirection(out Vector3 dPos, out Vector3 dDirection, float aTime)
        {
            Vector3 pos, vel;
            if (!pathMove.Sample(aTime * m_speedCur + m_distance, m_sideOffset, out pos, out vel))
            {
                dPos = position;
                dDirection = m_moveVector;
            }
            else
            {
                dPos = pos;
                dDirection = vel;
            }
        }

        // ---------------------------------------------------------------------------
        // Attack / damage
        // ---------------------------------------------------------------------------

        // Attack @0x4B4A20 — called when the enemy reaches the home / a chibi.
        public virtual bool Attack(GameCoreHome a_home, GameCoreHome.ChibiData a_chibi)
        {
            m_attackHomeHandle = a_home.handle;
            m_attackChibi = a_chibi;
            m_canAttack = true;
            if (m_attackDelay <= 0.0f)
            {
                Events.enemyAttackedHomeEvent.Invoke(this, a_home, a_chibi);
                Events.enemyAttackEvent.Invoke(this, a_home, a_chibi);
                if (m_isBoss)
                {
                    m_attackDelay = m_attackFreq;
                    m_bossAttacking = true;
                    m_bossAttackTime = 0.0f;
                    m_bossAttackEffectTriggered = false;
                }
                m_isAttacking = true;
                return true;
            }
            return false;
        }

        // DealDamage @0x4B1200 (IDamageable, untyped) — resolve the source tower's attributes.
        public void DealDamage(GameCoreObject damageSource, float damageToDeal,
            float distanceToCenterRate, GameCoreObject attackPoint, bool immediateDestroy = true)
        {
            GameCoreHandle towerHandle = GameCoreHandle.nullHandle;
            if (damageSource is GameCoreProjectile projectile)
                towerHandle = projectile.sourceTower;

            EEnemyStrengthTypeDef strength = EEnemyStrengthTypeDef.Normal;
            EEnemyClassTypeDef classType = EEnemyClassTypeDef.Normal;
            if (!towerHandle.isNull)
            {
                GameCoreTower tower = towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
                if (tower != null)
                {
                    strength = tower.strengthType;
                    classType = tower.classType;
                }
            }
            DealDamage(strength, classType, damageToDeal, distanceToCenterRate, damageSource, attackPoint, immediateDestroy);
        }

        // DealDamage @0x4B13E0 (IDamageable, typed) — the core damage routine.
        public void DealDamage(EEnemyStrengthTypeDef strengthType, EEnemyClassTypeDef classType,
            float damageToDeal, float distanceToCenterRate, GameCoreObject damageSource,
            GameCoreObject attackPoint, bool immediateDestroy = true)
        {
            if (DebugMenuCanvas.canvasInstance != null)
                damageToDeal *= DebugMenuCanvas.canvasInstance.damageRate;

            float dealt = Mathf.Min(damageToDeal, m_life);
            if (m_numBalloons < 1)
                m_life -= dealt;

            // Boss weak-point (vulnerable) damage accumulation.
            if (attackPoint != null && m_isBoss && attackPoint is GameCoreEnemyAttackPoint ap &&
                (m_bossType == EBossType.Fat || (m_bossType == EBossType.Tall && ap.MoveType() == EEnemyMoveTypeDef.ground)))
            {
                m_vulnerableDamageTaken += dealt;
            }

            // Lightning / insect projectiles always hit "strong" with a fixed reaction.
            bool specialProjectile = false;
            GameCoreTower sourceTower = null;
            if (damageSource is GameCoreProjectile proj)
            {
                specialProjectile = proj is GameCoreProjectileLightning || proj is GameCoreProjectileInsect;
                sourceTower = proj.sourceTower.GetMostRecentObjectVersion<GameCoreTower>();
            }

            // Use the hit attack point's own attributes if present, else the enemy body's.
            EnemyBase view = GetUnityObject<EnemyBase>();
            EnemyAttributesSettings apAttrs = null;
            if (attackPoint != null && view != null && m_attackPoints != null)
            {
                int index = m_attackPoints.IndexOf(attackPoint.handle);
                List<GameObject> pointViews = view.AttackPoints();
                if (index != -1 && pointViews != null && index < pointViews.Count)
                {
                    GameObject apView = pointViews[index];
                    if (apView != null)
                        apAttrs = apView.GetComponent<EnemyAttributesSettings>();
                }
            }

            bool strongToDamage, strongReaction;
            float reactionRate;
            if (specialProjectile)
            {
                strongToDamage = false;
                strongReaction = false;
                reactionRate = 1.0f;
            }
            else if (apAttrs == null)
            {
                strongToDamage = DamageHelper.DamageStrongToEnemy(strengthType, classType, this);
                strongReaction = DamageHelper.ReactionStrongToEnemy(strengthType, classType, this);
                reactionRate = DamageHelper.ReactionRateByAttributes(strengthType, classType, this);
            }
            else
            {
                strongToDamage = DamageHelper.DamageStrongToEnemy(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
                strongReaction = DamageHelper.ReactionStrongToEnemy(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
                reactionRate = DamageHelper.ReactionRateByAttributes(strengthType, classType, apAttrs.strengthDamageInfos, apAttrs.classDamageInfos);
            }

            var hitInfo = new EnemyHitInfo(damageSource, this, dealt, strongToDamage, distanceToCenterRate, reactionRate, strongReaction);

            if (m_life > 0.0f)
            {
                if (!m_isBalloon)
                {
                    if (!m_tookDamageThisFrame)
                    {
                        if (attackPoint is GameCoreEnemyAttackPoint)
                            m_tookDamageThisFrame = true;
                        Events.enemyHitEvent.Invoke(hitInfo);
                    }
                }
                else if (sourceTower == null || !sourceTower.oneShotOneBalloon)
                {
                    float oldHP = m_balloonHP;
                    m_balloonHP -= dealt;
                    int before = Mathf.CeilToInt(oldHP / m_balloonPopHPInterval);
                    int after = Mathf.CeilToInt(m_balloonHP / m_balloonPopHPInterval);
                    if (before <= after)
                        Events.popBalloonsEvent.Invoke(this, 0);
                    else
                        PopBalloons(before - after);
                    Debug.Log(string.Format("attack received on balloon: dmg {0}, remain hp {1}", dealt, m_balloonHP));
                }
                else
                {
                    PopBalloons(1);
                }
            }
            else
            {
                m_life = 0.0f;
                if (m_isBoss)
                    KillOtherEnemiesOnBossDeath(null);
                Events.enemyDestroyedEvent.Invoke(sourceTower, this, hitInfo);
                if (immediateDestroy)
                    DestroySelf();
            }
        }

        // DealPlayerDamage @0x4B21B0 — damage from a player kick.
        public void DealPlayerDamage(GameCorePlayer a_executingPlayer, float damageToDeal,
            float distanceToCenterRate, bool oneKickOneBalloon)
        {
            if (DebugMenuCanvas.canvasInstance != null)
                damageToDeal *= DebugMenuCanvas.canvasInstance.damageRate;

            float dealt = Mathf.Min(damageToDeal, m_life);
            m_life -= dealt;
            var hitInfo = new EnemyHitInfo(a_executingPlayer, this, dealt, false, distanceToCenterRate, 1.0f, false);

            if (m_life > 0.0f)
            {
                if (!m_isBalloon)
                {
                    Events.enemyHitEvent.Invoke(hitInfo);
                }
                else if (!oneKickOneBalloon)
                {
                    float oldHP = m_balloonHP;
                    m_balloonHP -= dealt;
                    int before = Mathf.CeilToInt(oldHP / m_balloonPopHPInterval);
                    int after = Mathf.CeilToInt(m_balloonHP / m_balloonPopHPInterval);
                    if (before <= after)
                        Events.popBalloonsEvent.Invoke(this, 0);
                    else
                        PopBalloons(before - after);
                }
                else
                {
                    PopBalloons(1);
                }
            }
            else
            {
                m_life = 0.0f;
                if (m_isBoss)
                    KillOtherEnemiesOnBossDeath(a_executingPlayer);
                Events.enemyDestroyedEvent.Invoke(null, this, hitInfo);
                DestroySelf();
            }
        }

        // Shared boss-death side effect: killing a boss deals lethal damage to every other
        // enemy (observed in DealDamage / DealPlayerDamage / LandedOnDeathPath death branches).
        // INFERRED helper name; the decompilation inlines this loop at each site.
        private void KillOtherEnemiesOnBossDeath(GameCoreObject damageSource)
        {
            foreach (GameCoreEnemy enemy in GameCore.Instance.AllObjects<GameCoreEnemy>())
            {
                if (enemy.handle != handle)
                    enemy.DealDamage(damageSource, enemy.m_life + 1.0f, 0.0f, null, true);
            }
        }

        // TriggerJumpReaction @0x4B28C0
        public void TriggerJumpReaction(float a_weight)
        {
            Events.jumpReactionEvent.Invoke(this, a_weight);
        }
    }
}