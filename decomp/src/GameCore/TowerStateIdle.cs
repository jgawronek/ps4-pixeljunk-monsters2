// GameCore/TowerStateIdle.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The tower's default state. Two behaviors run in parallel:
//   1. AIMING — with a current target, rotate the fort toward the projectile's
//      fire direction (DesiredDirection); without one, run the "caution" scan
//      cycle (pick a random direction near the pre-caution facing, rotate to it
//      at cautionRotateSpeed, watch for cautionIdleTime, repeat).
//   2. FIRING — UpdateAttackCooldown transitions to TowerStateAttack when the
//      target is in fire range (normal towers), on a cooldown-gated swarm
//      budget (hive/ProjectileInsect towers), or unconditionally as a forced
//      shot (gem/ProjectileGem towers).
// Logic from Ghidra decompilation (RVA 0x4E1310..0x4E3850).
// Float constants CONFIRMED from ELF .rodata: DAT_00b7c4b8/bc = 10000.0 (state
// duration), DAT_00b7c4cc = 0.01 (direction magnitude epsilon),
// DAT_00b7c4d0 = 10000.0 (attack state duration).

using UnityEngine;

namespace GameCore
{
    public class TowerStateIdle : TowerState // TypeDefIndex: 3078
    {
        private bool m_shootOnSight;                       // 0x20
        private Vector3 m_desiredDirection;                // 0x24
        private int m_currentBurst;                        // 0x30
        private CautionMode m_currentMode;                 // 0x34
        private Vector3 m_cautionDireciton;                // 0x38 (sic — original spelling)
        private Vector3 m_fortDirectionBeforeCaution;      // 0x44
        private float m_cautionWatchTimer;                 // 0x50

        // TypeDefIndex: 3079 (private in metadata)
        private enum CautionMode
        {
            EReset = 0,
            ERotating = 1,
            EWatching = 2,
            EUnknown = 3,
        }

        private const float IdleStateDuration = 10000.0f;     // DAT_00b7c4b8 / DAT_00b7c4bc
        private const float AttackStateDuration = 10000.0f;   // DAT_00b7c4d0
        private const float DirectionEpsilon = 0.01f;         // DAT_00b7c4cc

        // .ctor @0x4E1310
        public TowerStateIdle(bool shootOnSight)
            : base(IdleStateDuration)
        {
            m_fortDirectionBeforeCaution = Vector3.zero;
            m_shootOnSight = shootOnSight;
            m_currentBurst = 0;
        }

        // .ctor @0x4E1640 — carries burst progress across Attack→Idle→Attack.
        public TowerStateIdle(bool shootOnSight, int burstCount)
            : base(IdleStateDuration)
        {
            m_fortDirectionBeforeCaution = Vector3.zero;
            m_shootOnSight = shootOnSight;
            m_currentBurst = burstCount;
        }

        // get_ShootOnSight @0x4E26B0
        public bool ShootOnSight
        {
            get { return m_shootOnSight; }
        }

        // Tick @0x4E26C0 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            if (owner == null)
                return true;
            GameCoreTower tower = GetTower(owner);
            if (tower == null)
                return true;

            // Latch the pre-caution facing the first time it is unset.
            if (m_fortDirectionBeforeCaution == Vector3.zero)
                m_fortDirectionBeforeCaution = tower.fortDirection;

            // Faithful to the binary: even non-shoot-on-sight idles start
            // scanning/aiming once stateTime reaches tower.attackSpeed.
            if (m_shootOnSight || tower.attackSpeed <= stateTime)
            {
                if (tower.GetCurrentTarget() == null)
                    UpdateCaution(dt, tower);
                else
                    UpdateRotation(dt, tower);
            }

            UpdateAttackCooldown(tower);
            return true;
        }

        // UpdateCautionInit @0x4E27D0
        // (Re)latches the pre-caution fort direction when unset.
        private void UpdateCautionInit(GameCoreTower tower)
        {
            if (m_fortDirectionBeforeCaution == Vector3.zero)
                m_fortDirectionBeforeCaution = tower.fortDirection;
        }

        // UpdateRotation @0x4E2850
        // Tracks the current target: rotates the fort toward the projectile's
        // aim solution at the tower's current per-axis rotation speeds and
        // keeps m_fortDirectionBeforeCaution in sync (caution resumes from
        // wherever the turret ended up). Resets the caution cycle.
        private void UpdateRotation(float dt, GameCoreTower tower)
        {
            m_desiredDirection = DesiredDirection(tower);

            if (m_desiredDirection.magnitude > DirectionEpsilon)
            {
                Vector3 desiredEuler = Quaternion.LookRotation(m_desiredDirection).eulerAngles;
                Vector3 currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;

                float newX = Mathf.MoveTowardsAngle(currentEuler.x, desiredEuler.x,
                                                    tower.currentRotateSpeedX * dt);
                float newY = Mathf.MoveTowardsAngle(currentEuler.y, desiredEuler.y,
                                                    dt * tower.currentRotateSpeedY);

                Vector3 newDir = Quaternion.Euler(newX, newY, currentEuler.z) * Vector3.forward;
                tower.fortDirection = newDir;
                m_fortDirectionBeforeCaution = newDir;
            }
            m_currentMode = CautionMode.EReset;
        }

        // UpdateCaution @0x4E2A50
        // Idle scan cycle: EReset → pick a random caution direction (around the
        // pre-caution facing, via TowerHelper) → ERotating → rotate at
        // tower.cautionRotateSpeed until aligned → EWatching → hold for
        // tower.cautionIdleTime seconds → EReset.
        private void UpdateCaution(float dt, GameCoreTower tower)
        {
            // Binary computes (mode < 3 ? mode + 3 : 0) & 7 and switches on 3/4/5,
            // i.e. EReset→pick, ERotating→rotate, EWatching→watch.
            switch (m_currentMode)
            {
                case CautionMode.EReset:
                {
                    Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
                    m_cautionDireciton = TowerHelper.RandomCautionDirection(
                        tower, viewer, m_fortDirectionBeforeCaution);
                    m_currentMode = CautionMode.ERotating;
                    break;
                }
                case CautionMode.ERotating:
                {
                    Vector3 currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;
                    Vector3 cautionEuler = Quaternion.LookRotation(m_cautionDireciton).eulerAngles;

                    float newX = Mathf.MoveTowardsAngle(currentEuler.x, cautionEuler.x,
                                                        tower.cautionRotateSpeed * dt);
                    float newY = Mathf.MoveTowardsAngle(currentEuler.y, cautionEuler.y,
                                                        dt * tower.cautionRotateSpeed);

                    tower.fortDirection = Quaternion.Euler(newX, newY, currentEuler.z) * Vector3.forward;

                    if (newX == cautionEuler.x && newY == cautionEuler.y)
                        m_currentMode = CautionMode.EWatching;
                    break;
                }
                case CautionMode.EWatching:
                {
                    m_cautionWatchTimer = Mathf.Min(m_cautionWatchTimer + dt, tower.cautionIdleTime);
                    if (m_cautionWatchTimer == tower.cautionIdleTime)
                    {
                        m_currentMode = CautionMode.EReset;
                        m_cautionWatchTimer = 0f;
                    }
                    break;
                }
            }
        }

        // UpdateAttackCooldown @0x4E2DE0
        // Decides when to leave Idle for TowerStateAttack:
        //  - hive towers (Q4.ProjectileInsect prefab): once stateTime reaches
        //    tower.attackSpeed, count live GameCoreProjectileInsect instances;
        //    if below tower.hiveTowerInsectMaxAmount, force-fire one shot.
        //  - gem towers (Q4.ProjectileGem prefab): force-fire every time.
        //  - normal towers: when shoot-on-sight (or the attackSpeed gate) and
        //    TowerHelper says the current target is in fire range → attack with
        //    the full burst interval charged, carrying m_currentBurst.
        private void UpdateAttackCooldown(GameCoreTower tower)
        {
            if (tower == null)
                return;   // binary: exception path
            if (tower.isPostStageClear)
                return;
            if (tower.handle.GetUnityObject() == null)
                return;   // viewer gone — tower is being removed

            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            Q4.Projectile projectileView = viewer != null ? viewer.projectile : null;

            Q4.ProjectileInsect insectProjectile = projectileView as Q4.ProjectileInsect;
            if (insectProjectile != null)
            {
                if (stateTime < tower.attackSpeed)
                    return;
                int liveInsects = 0;
                foreach (GameCoreProjectileInsect insect in
                         GameCore.Instance.AllObjects<GameCoreProjectileInsect>())
                {
                    liveInsects++;
                }
                if (tower.hiveTowerInsectMaxAmount <= liveInsects)
                    return;
                tower.SetTowerState(
                    new TowerStateAttack(tower.burstInterval, m_currentBurst, true));
                return;
            }

            Q4.ProjectileGem gemProjectile = projectileView as Q4.ProjectileGem;
            if (gemProjectile != null)
            {
                tower.SetTowerState(
                    new TowerStateAttack(tower.burstInterval, m_currentBurst, true));
                return;
            }

            if (m_shootOnSight || tower.attackSpeed <= stateTime)
            {
                IDamageable target = tower.GetCurrentTarget();
                if (TowerHelper.IsTargetInFireRange(tower, target))
                {
                    tower.SetTowerState(
                        new TowerStateAttack(tower.burstInterval, m_currentBurst, false));
                }
            }
        }

        // DesiredDirection @0x4E33D0
        // Muzzle→target aim solved by the projectile prefab's GetFireDirection
        // (virtual slot 10 — ballistic leading per projectile type); falls back
        // to the current fortDirection. Result normalized.
        private Vector3 DesiredDirection(GameCoreTower tower)
        {
            Vector3 dir = Vector3.zero;
            if (tower == null)
                return dir;

            dir = tower.fortDirection;

            IDamageable target = tower.GetCurrentTarget();
            if (target != null)
            {
                Q4.TowerBase viewer = Q4.GameCoreBridge.Instance != null
                    ? Q4.GameCoreBridge.Instance.GetUnityObject<Q4.TowerBase>(tower.handle)
                    : null;
                if (viewer != null)
                {
                    Vector3 muzzle = tower.position + Vector3.up * tower.height;
                    Vector3 targetPos = target.Position();          // IDamageable slot 5
                    Q4.Projectile projectileView = viewer.projectile;   // @0xC0
                    // Binary: null projectile falls into the exception path.
                    dir = projectileView.GetFireDirection(muzzle, targetPos, Vector3.zero);
                }
            }
            return dir.normalized;
        }

        // UpdateTarget @0x4E3650
        // Drops the current target when it leaves the detection volume and
        // pulls the next one from the tower's target queue. (Present in
        // metadata; Idle's Tick drives targeting through UpdateAttackCooldown
        // + GameCoreTower.TickTargetQueue instead.)
        private void UpdateTarget(GameCoreTower tower)
        {
            if (tower == null)
                return;

            IDamageable target = tower.GetCurrentTarget();
            if (target != null && tower.enemyDetector != null)
            {
                Vector3 detectorPos = tower.position + tower.enemyDetector.GetOffset();
                GameCoreObject targetObj = target as GameCoreObject;
                if (!tower.enemyDetector.InDetection(detectorPos, targetObj))
                {
                    // Inlined SetCurrentTarget(null) in the binary.
                    tower.SetCurrentTarget(null);
                }
            }

            if (tower.GetCurrentTarget() == null)
            {
                // INFERRED index argument (decompiler dropped the args):
                // the tower's authored nextTargetToAttackIndex.
                IDamageable next = TowerHelper.GetNextTargetFromTowerTargetQueue(
                    tower, tower.nextTargetToAttackIndex);
                tower.SetCurrentTarget(next);
            }
        }

        // Enter @0x4E3370 (virtual slot 4) — base announces the state change.
        public override void Enter(TowerStateMachine owner)
        {
            base.Enter(owner);
        }

        // Exit @0x4E3380 (virtual slot 6) — plain State<T>.Exit (no-op).
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);
        }
    }
}
