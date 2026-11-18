// GameCore/GameCoreTower.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The sim-side tower (fruit-tree cannon). Owns the targeting queue, rotation
// speeds, EXP/upgrade progression, magazine ammo and the tower FSM
// (TowerStateMachine: Idle/Attack/Build/UpgradeAround/ChangeMag/Broken/
// Degenerate states). All balance stats are copied from the Q4.TowerBase view
// prefab at Initialize (data-driven; see decomp/data/structures_TowerBase.json).
//
// Logic from Ghidra decompilation (RVA 0x4C3FE0..0x4D1A50). Field offsets from
// global-metadata.dat (skeleton/GameCore.cs, TypeDefIndex 3070).
// Float constants CONFIRMED from ELF .rodata (file offset = vaddr + 0x4000):
//   DAT_00b7c44c = 1.0 (collision radius)    DAT_00b7c450 = 2.0 (collision height)
//   DAT_00b7c454 = 5.0 (ChangeMag duration)  DAT_00b7c45c = 360.0 (full-range fire angle)
//   DAT_00b7c460 = 2.0 (fire-point height fallback)   literal 0x3e800000 = 0.25 (target-queue period)
//   literal 0x40000000 = 2.0 (default height)         literal 0x3f800000 = 1.0 (k_gatheringTime / hitEffectScale)

using System.Collections.Generic;
using UnityEngine;
using Q4; // TowerBase, TowerUpgradeSetting, TowerUpgrade, AttenuationInfo, EnemyDetectorView, GameObjectHelper
using Q4.UI.Debug; // DebugMenuCanvas (towerEXPRate debug multiplier)

namespace GameCore
{
    public class GameCoreTower : GameCoreObject // TypeDefIndex: 3070
    {
        // ---- settings copied from the Q4.TowerBase viewer (InitializeSettings) ----
        public ETowerAttackDef attackType;                    // 0x60
        public EEnemyStrengthTypeDef strengthType;            // 0x64
        public EEnemyClassTypeDef classType;                  // 0x68
        public bool balloonAimable;                           // 0x6C
        public float attackPower;                             // 0x70
        public float attackSpeed;                             // 0x74
        public float attackRangeInner;                        // 0x78
        public float attackSpread;                            // 0x7C
        public int costCoin;                                  // 0x80
        public int costGem;                                   // 0x84
        public int buildTime;                                 // 0x88
        public int burstCount;                                // 0x8C
        public float burstInterval;                           // 0x90
        public int refundCoin;                                // 0x94
        public int refundGem;                                 // 0x98
        // NOTE: metadata name is "magazineCapacity" but at runtime this field is
        // the CURRENT ammo count (initialized from TowerBase.magazineCapacity,
        // decremented per shot, topped up by RechargeBullet; -1 = unlimited).
        public int magazineCapacity;                          // 0x9C
        public List<AttenuationInfo> attackAttenuationInfos;  // 0xA0
        public List<GameCoreHandle> retainedTrees;            // 0xA8 (trees paid to build; refunded on sell)
        public List<GameCoreHandle> targetQueue;              // 0xB0
        public int nextTargetToAttackIndex;                   // 0xB8
        public float rotateSpeedX;                            // 0xBC
        public float rotateSpeedXAcel;                        // 0xC0
        public float rotateSpeedXDecl;                        // 0xC4
        public float rotateSpeedY;                            // 0xC8
        public float rotateSpeedYAcel;                        // 0xCC
        public float rotateSpeedYDecl;                        // 0xD0
        public float rotateSpeed;                             // 0xD4
        public float rotateAcceleration;                      // 0xD8
        public float rotateDeceleration;                      // 0xDC
        public float fireAngleThreshold;                      // 0xE0
        public float cautionAngleRange;                       // 0xE4 (= TowerBase.cautionRange)
        public float cautionIdleTime;                         // 0xE8
        public float cautionRotateSpeed;                      // 0xEC
        public float height;                                  // 0xF0 (highest fire point above base)

        private TowerStateMachine m_stateMachine;             // 0xF8
        private IDamageable m_currentTarget;                  // 0x100
        public IEnemyDetector enemyDetector;                  // 0x108
        public Vector3 bodyDirection;                         // 0x110
        public Vector3 fortDirection;                         // 0x11C
        private int m_currentLevel;                           // 0x128
        private float m_currentEXP;                           // 0x12C
        private string prefabName;                            // 0x130
        public float playerDetectionRange;                    // 0x138
        public float currentRotateSpeedX;                     // 0x13C
        public float currentRotateSpeedY;                     // 0x140
        public int hiveTowerInsectMaxAmount;                  // 0x144 (-1 unless projectile is ProjectileInsect)
        public float hitEffectScale;                          // 0x148
        public bool oneShotOneBalloon;                        // 0x14C
        public bool isPostStageClear;                         // 0x14D
        public IBuffSettingOverride upgradeBuffOverride;      // 0x150
        private static float k_gatheringTime;                 // statics +0x0 = 1.0f (.cctor @0x4D12C0)
        private List<PlayerAroundInfo> m_expSourcePlayers;    // 0x158
        private GameCoreHandle m_playerInside;                // 0x160 (32-byte struct)
        private float timeToNextUpdate;                       // 0x180
        private List<IDamageable> targetsInRangeStorage;      // 0x188
        private List<GameCoreHandle> newTargetHandlesStorage; // 0x190

        // ---- constants (CONFIRMED from ELF .rodata) -------------------------

        private const float CollisionRadius = 1.0f;           // DAT_00b7c44c
        private const float CollisionHeight = 2.0f;           // DAT_00b7c450
        private const float ChangeMagDuration = 5.0f;         // DAT_00b7c454
        private const float FullRangeFireAngle = 360.0f;      // DAT_00b7c45c
        private const float FirePointHeightFallback = 2.0f;   // DAT_00b7c460
        private const float DefaultHeight = 2.0f;             // literal 0x40000000 in .ctor
        private const float TargetQueueUpdateInterval = 0.25f;// literal 0x3e800000 in TickTargetQueue

        // ---- nested type ----------------------------------------------------

        // TypeDefIndex: 3071. Registers a player who recently fed EXP to this
        // tower (the "dance"/gathering attribution window).
        private struct PlayerAroundInfo
        {
            public GameCoreHandle player;   // 0x0 (32 bytes)
            public float time;              // 0x20

            // .ctor @0x4D1490
            public PlayerAroundInfo(GameCoreHandle aPlayer)
            {
                player = aPlayer;
                time = k_gatheringTime;
            }

            // Tick @0x4D1530
            public void Tick(float dt)
            {
                time = Mathf.Max(0f, time - dt);
            }

            // Reset @0x4D15C0
            public void Reset()
            {
                time = k_gatheringTime;
            }
        }

        // ---- properties ------------------------------------------------------

        // get_currentLevel @0x4CDEA0
        public int currentLevel
        {
            get { return m_currentLevel; }
        }

        // get_currentEXP @0x4CDEB0
        public float currentEXP
        {
            get { return m_currentEXP; }
        }

        // ---- lifecycle -------------------------------------------------------

        // .cctor @0x4D12C0
        static GameCoreTower()
        {
            k_gatheringTime = 1.0f;   // literal 0x3f800000
        }

        // .ctor @0x4CDAD0
        // prefabName  : Q4.TowerBase prefab name (viewer recreated from it on resync)
        // costTrees   : tree handles consumed to build this tower (returned on sell)
        public GameCoreTower(string prefabName, List<GameCoreHandle> costTrees)
        {
            retainedTrees = new List<GameCoreHandle>(1);   // field init; replaced by costTrees below
            targetQueue = new List<GameCoreHandle>(1);
            height = DefaultHeight;
            m_currentLevel = 1;
            hitEffectScale = 1.0f;
            m_playerInside = GameCoreHandle.nullHandle;    // m_handle = -1
            targetsInRangeStorage = new List<IDamageable>();
            newTargetHandlesStorage = new List<GameCoreHandle>();
            // (base GameCoreObject() registers the object + assigns the handle)
            this.prefabName = prefabName;

            // Binary passes EventTime 1 = PostGameCoreTick for all three.
            Events.enemyDestroyedEvent.AddListener(OnEnemyDestroy, Event.EventTime.PostGameCoreTick);   // Events statics +0x40
            Events.waveEndedEvent.AddListener(OnWaveEnded, Event.EventTime.PostGameCoreTick);           // Events statics +0x18
            Events.stageClearedEvent.AddListener(OnStageClear, Event.EventTime.PostGameCoreTick);       // Events statics +0x30

            retainedTrees = costTrees;
            m_expSourcePlayers = new List<PlayerAroundInfo>(4);
            collision = new Cylinder(CollisionRadius, CollisionHeight);   // setter re-buckets the grid
        }

        // Finalize @0x4CDEC0 (virtual slot 1)
        protected override void Finalize()
        {
            Events.stageClearedEvent.RemoveListener(OnStageClear);
            Events.enemyDestroyedEvent.RemoveListener(OnEnemyDestroy);
            Events.waveEndedEvent.RemoveListener(OnWaveEnded);
            m_stateMachine = null;
            base.Finalize();
        }

        // Terminate @0x4CE0D0 — drops the FSM (dev/resync teardown; the binary
        // only clears the machine reference).
        public void Terminate()
        {
            m_stateMachine = null;
        }

        // Initialize @0x4CE2C0
        // Pulls all stats from the viewer prefab and boots the FSM in the
        // shoot-on-sight idle state (TowerStateMachine ctor default state =
        // TowerStateIdle(true), duration 10000s = effectively unbounded).
        public void Initialize()
        {
            InitializeSettings();
            m_stateMachine = new TowerStateMachine(handle);
        }

        // InitializeSettings @0x4CE400
        // Copies the Q4.TowerBase prefab stats into the sim fields. Offsets
        // verified against dump.cs TowerBase layout (0x3C..0xFC).
        private void InitializeSettings()
        {
            TowerBase viewer = GetUnityObject<TowerBase>();
            if (viewer == null)
                return;   // binary: op_Implicit false → skip everything

            isPostStageClear = false;
            nextTargetToAttackIndex = viewer.nextTargetToAttackIndex;   // 0x80
            attackType = viewer.attackType;                             // 0x3C
            strengthType = viewer.strengthType;                         // 0x40
            classType = viewer.classType;                               // 0x44
            balloonAimable = viewer.balloonAimable;                     // 0x48
            attackPower = viewer.attackPower;                           // 0x4C
            attackSpeed = viewer.attackSpeed;                           // 0x50
            attackRangeInner = viewer.attackRangeInner;                 // 0x54
            attackSpread = viewer.attackSpread;                         // 0x58
            costCoin = viewer.costCoin;                                 // 0x5C
            costGem = viewer.costGem;                                   // 0x60
            buildTime = viewer.buildTime;                               // 0x64
            refundCoin = viewer.refundCoin;                             // 0x68
            refundGem = viewer.refundGem;                               // 0x6C
            magazineCapacity = viewer.magazineCapacity;                 // 0x98 (current ammo := capacity)
            rotateSpeedX = viewer.rotateSpeedX;                         // 0xCC
            rotateSpeedXAcel = viewer.rotateSpeedXAcel;                 // 0xD0
            rotateSpeedXDecl = viewer.rotateSpeedXDecl;                 // 0xD4
            rotateSpeedY = viewer.rotateSpeedY;                         // 0xD8
            rotateSpeedYAcel = viewer.rotateSpeedYAcel;                 // 0xDC
            rotateSpeedYDecl = viewer.rotateSpeedYDecl;                 // 0xE0
            oneShotOneBalloon = viewer.oneShotOneBalloon;               // 0x70
            // fullRangeFire (0xE4) → fixed 360° threshold; else the authored angle.
            fireAngleThreshold = viewer.fullRangeFire ? FullRangeFireAngle
                                                      : viewer.fireAngleThreshold;   // 0xE8
            attackAttenuationInfos = viewer.attackAttenuations;         // 0x90
            burstCount = viewer.burstCount;                             // 0xEC
            burstInterval = viewer.burstInterval;                       // 0xF0
            cautionAngleRange = viewer.cautionRange;                    // 0xF4
            cautionIdleTime = viewer.cautionIdleTime;                   // 0xF8
            cautionRotateSpeed = viewer.cautionRotateSpeed;             // 0xFC
            playerDetectionRange = viewer.playerDetectionRange;         // Structure 0x20

            // height := highest named fire point above the tower base (used for
            // projectile launch origin). Missing points fall back to 2.0.
            height = DefaultHeight;
            List<string> firePointNames = viewer.firePointNames;        // 0xB0
            if (firePointNames != null && firePointNames.Count > 0)
            {
                foreach (string firePointName in firePointNames)
                {
                    float dy = FirePointHeightFallback;
                    GameObject firePoint = GameObjectHelper.FindDeep(viewer.gameObject, firePointName);
                    if (firePoint != null)
                        dy = firePoint.transform.position.y - viewer.transform.position.y;
                    height = Mathf.Max(dy, height);
                }
            }

            // Sim-side enemy detector built by the view component (virtual
            // CreateGameCoreDetector on Q4.EnemyDetectorView — the decompiler's
            // GetComponent<DelegateUpdates> label is a shared-generic artifact).
            EnemyDetectorView detectorView = viewer.GetComponent<EnemyDetectorView>();
            if (detectorView != null)
                enemyDetector = detectorView.CreateGameCoreDetector();

            // Hive tower: insect swarm capacity comes from the projectile prefab.
            ProjectileInsect insectProjectile = viewer.projectile as ProjectileInsect;   // TowerBase.projectile @0xC0
            hiveTowerInsectMaxAmount = insectProjectile != null ? insectProjectile.insectAmountMax : -1;
        }

        // ---- tick --------------------------------------------------------------

        // Tick @0x4CEB20 (virtual slot 7)
        public override void Tick()
        {
            // Refresh the cached current target to its most recent version
            // (handles stay stable across frames; object instances may not).
            if (m_currentTarget != null)
            {
                GameCoreObject obj = m_currentTarget.Handle()
                                        .GetMostRecentObjectVersion<GameCoreObject>();
                if (obj != null && !obj.IsDestroyed())
                    m_currentTarget = (IDamageable)obj;
            }

            TickRotateSpeed(GameCore.TickDeltaTime);
            TickEXPSources();
            TickTargetQueue();
            TickState();
        }

        // TickRotateSpeed @0x4CECB0
        // Accelerates both rotation axes toward their max speed (clamped ≥ 0).
        // Deceleration fields are consumed by the FSM states' UpdateRotation.
        private void TickRotateSpeed(float dt)
        {
            currentRotateSpeedX = Mathf.Clamp(currentRotateSpeedX + dt * rotateSpeedXAcel,
                                              0f, rotateSpeedX);
            currentRotateSpeedY = Mathf.Clamp(currentRotateSpeedY + dt * rotateSpeedYAcel,
                                              0f, rotateSpeedY);
        }

        // TickEXPSources @0x4CEDF0
        // Ages the EXP-attribution window; removes (at most one per tick —
        // faithful to the binary's early break) expired entries.
        private void TickEXPSources()
        {
            if (m_expSourcePlayers == null)
                return;
            float dt = GameCore.TickDeltaTime;
            for (int i = m_expSourcePlayers.Count - 1; i >= 0; i--)
            {
                PlayerAroundInfo info = m_expSourcePlayers[i];
                info.Tick(dt);
                if (info.time == 0f)
                {
                    m_expSourcePlayers.RemoveAt(i);
                    break;
                }
                m_expSourcePlayers[i] = info;
            }
        }

        // TickTargetQueue @0x4CF070
        // Every 0.25 s: re-query nearby targets (TowerHelper), prune the queue
        // of handles no longer in range, append newly acquired ones (nearest
        // order from the helper), and promote queue[0] to current target.
        private void TickTargetQueue()
        {
            timeToNextUpdate -= GameCore.TickDeltaTime;
            if (timeToNextUpdate > 0f)
                return;
            timeToNextUpdate = TargetQueueUpdateInterval;

            targetsInRangeStorage.Clear();
            newTargetHandlesStorage.Clear();

            GameCoreTower self = handle.GetMostRecentObjectVersion<GameCoreTower>();
            // INFERRED overload/defaults: (tower, result, ignoreInnerRange = true).
            TowerHelper.GetNearestTargets(self, targetsInRangeStorage);

            for (int i = 0; i < targetsInRangeStorage.Count; i++)
                newTargetHandlesStorage.Add(targetsInRangeStorage[i].Handle());

            // <TickTargetQueue>m__0 @0x4D1300 — drop queued targets out of range.
            targetQueue.RemoveAll(h => !newTargetHandlesStorage.Contains(h));
            // <TickTargetQueue>m__1 @0x4D13A0 — keep only genuinely new handles.
            newTargetHandlesStorage.RemoveAll(h => targetQueue.Contains(h));

            for (int i = 0; i < newTargetHandlesStorage.Count; i++)
                targetQueue.Add(newTargetHandlesStorage[i]);

            IDamageable target = null;
            if (targetQueue.Count >= 1)
            {
                GameCoreObject first = targetQueue[0]
                                          .GetMostRecentObjectVersion<GameCoreObject>();
                target = first as IDamageable;
            }
            SetCurrentTarget(target);
        }

        // TickState @0x4D0780 (virtual slot 10)
        protected virtual void TickState()
        {
            if (m_stateMachine == null)
                return;
            m_stateMachine.TickState(GameCore.TickDeltaTime);
        }

        // ---- targeting ----------------------------------------------------------

        // GetCurrentTarget @0x4C3FE0
        // Resolves the cached target's handle fresh; null once the object is gone.
        public IDamageable GetCurrentTarget()
        {
            if (m_currentTarget == null)
                return null;
            GameCoreObject obj = m_currentTarget.Handle()
                                    .GetMostRecentObjectVersion<GameCoreObject>();
            return obj != null ? obj as IDamageable : null;
        }

        // SetCurrentTarget @0x4D03E0
        // Only acts on an actual change (compares handle ids); zeroes both
        // rotation speeds so the turret re-accelerates toward the new facing,
        // and notifies the view (reticle / aim anims).
        public void SetCurrentTarget(IDamageable enemy)
        {
            IDamageable cur = m_currentTarget;
            bool changed = (enemy == null) != (cur == null);
            if (!changed && enemy != null)
                changed = cur.Handle().m_handle != enemy.Handle().m_handle;
            if (!changed)
                return;

            m_currentTarget = enemy;
            currentRotateSpeedX = 0f;
            currentRotateSpeedY = 0f;   // single 8-byte zero store @0x13C in the binary
            Events.towerTargetChangeEvent.Invoke(this);   // Events statics +0x90
        }

        // ---- FSM ------------------------------------------------------------------

        // SetTowerState @0x4D0690 (virtual slot 9)
        public virtual void SetTowerState(TowerState state)
        {
            if (m_stateMachine == null)
                return;
            m_stateMachine.SetCurrentCommand(state, null);
        }

        // GetTowerState @0x4D06F0
        public TowerState GetTowerState()
        {
            if (m_stateMachine == null)
                return null;
            return m_stateMachine.GetCurrentState() as TowerState;
        }

        // ---- ammo / wave hooks ------------------------------------------------------

        // HasEnoughBullet @0x4CE0E0 — -1 is the unlimited magazine.
        public bool HasEnoughBullet()
        {
            return magazineCapacity > 0 || magazineCapacity == -1;
        }

        // OnWaveEnded @0x4CE100 — waveEndedEvent listener (args unused).
        public void OnWaveEnded(GameCoreWaveManager manager, int waveIndex)
        {
            RechargeBullet();
        }

        // RechargeBullet @0x4CE110
        // Between waves, refill toward the prefab capacity via the ChangeMag
        // FSM state (the view plays the reload anim for 5 s).
        public void RechargeBullet()
        {
            TowerBase viewer = GetUnityObject<TowerBase>();
            if (viewer == null || magazineCapacity < 0)
                return;   // unlimited magazines never reload
            int maxMag = viewer.magazineCapacity;
            if (maxMag <= magazineCapacity)
                return;   // already full
            // Binary inlines SetTowerState here (same null-guarded
            // SetCurrentCommand call).
            SetTowerState(new TowerStateChangeMag(ChangeMagDuration, magazineCapacity, maxMag));
        }

        // OnStageClear @0x4CE240 — stageClearedEvent listener (arg unused).
        public void OnStageClear(GameCoreWaveManager manager)
        {
            isPostStageClear = true;
        }

        // ---- EXP / upgrades -----------------------------------------------------------

        // OnEnemyDestroy @0x4D07F0 — enemyDestroyedEvent listener.
        // When THIS tower landed the killing blow, bank the enemy's expValue.
        public void OnEnemyDestroy(GameCoreTower attackingTower, GameCoreEnemy enemy, EnemyHitInfo a_hitInfo)
        {
            if (enemy == null || attackingTower == null)
                return;
            if (attackingTower.handle.m_handle != handle.m_handle)
                return;

            GameCoreTower tower = handle.GetMostRecentObjectVersion<GameCoreTower>();
            // Generic label in the decompiler says Structure; the confirmed
            // instantiation for this call site is EnemyBase (expValue @0x28).
            EnemyBase enemyView = enemy.GetUnityObject<EnemyBase>();
            if (tower != null && enemyView != null)
                tower.GrantEXP((float)enemyView.expValue, null);
        }

        // GrantEXP @0x4D0900
        // Banks EXP (debug-multiplied), registers/refreshes the granting player
        // in the gathering window, auto-upgrades at the next level's reachExp
        // and notifies the view (exp flyover).
        public void GrantEXP(float amount, GameCorePlayer from)
        {
            TowerUpgrade next = GetNextUpgrade();
            if (next == null || next.level == 0)
                return;   // max level (level 0 = sentinel "no upgrade")

            DebugMenuCanvas debug = DebugMenuCanvas.canvasInstance;
            if (debug != null)
                amount *= debug.towerEXPRate;   // field @0x28

            if (from != null && m_expSourcePlayers != null)
            {
                bool found = false;
                for (int i = 0; i < m_expSourcePlayers.Count; i++)
                {
                    if (m_expSourcePlayers[i].player.m_handle == from.handle.m_handle)
                    {
                        PlayerAroundInfo info = m_expSourcePlayers[i];
                        info.Reset();
                        m_expSourcePlayers[i] = info;
                        found = true;
                        break;
                    }
                }
                if (!found)
                    m_expSourcePlayers.Add(new PlayerAroundInfo(from.handle));
            }

            m_currentEXP += amount;
            if (m_currentEXP >= (float)next.reachExp)
                UpgradeTower();
            Events.expGrantEvent.Invoke(this, amount);   // Events statics +0xA8
        }

        // GetCurrentUpgrade @0x4D0FE0
        public TowerUpgrade GetCurrentUpgrade()
        {
            TowerUpgradeSetting setting = GetUpgradeSetting();
            if (setting == null)
                return null;
            return setting.GetCurrentUpgrade(this);   // virtual slot 5
        }

        // GetNextUpgrade @0x4D0D70
        public TowerUpgrade GetNextUpgrade()
        {
            TowerUpgradeSetting setting = GetUpgradeSetting();
            if (setting == null)
                return null;
            return setting.GetNextUpgrade(this);      // virtual slot 6
        }

        // UpgradeTower @0x4D0E70
        // Applies the next upgrade level (stats + level counter are written by
        // the Q4 setting object) and notifies the view (flag/banner + buff fx).
        private void UpgradeTower()
        {
            TowerUpgradeSetting setting = GetUpgradeSetting();
            if (setting == null)
                return;
            TowerUpgrade next = setting.GetNextUpgrade(this);
            setting.UpgradeTower(this, ref m_currentLevel);   // virtual slot 7
            Events.towerUpgradeEvent.Invoke(this, next);      // Events statics +0xC0
        }

        // GetCurrentExpRate @0x4D10E0 — 0..1 progress from the current level's
        // reachExp toward the next (for the upgrade progress ring in the view).
        public float GetCurrentExpRate()
        {
            TowerUpgrade cur = GetCurrentUpgrade();
            TowerUpgrade next = GetNextUpgrade();
            int baseExp = cur != null ? cur.reachExp : 0;
            if (next != null && next.reachExp != 0)
                return (m_currentEXP - baseExp) / (float)(next.reachExp - baseExp);
            return 0f;
        }

        // Shared viewer→component lookup for the upgrade table (the
        // decompiler's GetComponent<DelegateUpdates> label is a shared-generic
        // artifact; the invoked slots 5/6/7 are TowerUpgradeSetting's).
        private TowerUpgradeSetting GetUpgradeSetting()
        {
            TowerBase viewer = GetUnityObject<TowerBase>();
            if (viewer == null)
                return null;
            return viewer.GetComponent<TowerUpgradeSetting>();
        }

        // ---- player occupancy -------------------------------------------------------

        // PlayerEnterTower @0x4D1140
        public void PlayerEnterTower(GameCoreHandle player)
        {
            m_playerInside = player;
        }

        // PlayerExitTower @0x4D1150
        public void PlayerExitTower()
        {
            m_playerInside = GameCoreHandle.nullHandle;
        }

        // HasPlayerInTower @0x4D1240
        public bool HasPlayerInTower()
        {
            return m_playerInside.m_handle > -1;
        }

        // PlayerInTowerID @0x4D1250 — -1 when empty or the player is gone.
        public int PlayerInTowerID()
        {
            if (m_playerInside.m_handle > -1)
            {
                GameCorePlayer player = m_playerInside.GetMostRecentObjectVersion<GameCorePlayer>();
                if (player != null)
                    return player.playerId;   // GameCorePlayer @0x60
            }
            return -1;
        }

        // ---- viewer -------------------------------------------------------------------

        // RecreateViewer @0x4D05E0 (virtual slot 5)
        public override GameObject RecreateViewer()
        {
            TowerBase viewer = GetUnityObject<TowerBase>();
            if (viewer == null)
                viewer = CreateViewerFromPrefabName<TowerBase>(prefabName);
            return viewer.gameObject;   // binary: exception path if still null
        }
    }
}
