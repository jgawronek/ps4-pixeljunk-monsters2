// GameCore/TowerStateAttack.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The tower's firing state: charges the burst timer to tower.burstInterval,
// fires via reflection-created sim projectiles (type from the Q4.Projectile
// view prefab's GetGameCoreType()), counts the burst, consumes magazine ammo
// when the burst completes, tracks rotation toward the desired aim direction
// mid-burst, and returns to TowerStateIdle when the burst finishes or no
// targets remain. m_forceAttack fires once immediately with an empty target
// list (used by scripted/detonation attacks).
// Logic from Ghidra decompilation (RVA 0x4DF6A0, 0x4E0F10..0x4E1D00).
// Float constants CONFIRMED from ELF .rodata: DAT_00b7c4a0 = 10000.0 (state
// duration — transitions are command-driven), DAT_00b7c4b0 = 10000.0 (idle).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class TowerStateAttack : TowerState // TypeDefIndex: 3073
    {
        private float m_burstTimer;          // 0x20 — charges up to tower.burstInterval
        private int m_burstCount;            // 0x24 — shots fired in the current burst
        private Vector3 m_desiredDirection;  // 0x28
        private bool m_forceAttack;          // 0x34

        private const float AttackStateDuration = 10000.0f;   // DAT_00b7c4a0
        private const float IdleStateDuration = 10000.0f;     // DAT_00b7c4b0

        // .ctor @0x4DF6A0
        public TowerStateAttack(float burstInterval, int burstCount, bool forceAttack = false)
            : base(AttackStateDuration)
        {
            m_burstTimer = burstInterval;   // starts charged — first shot can fire immediately
            m_burstCount = burstCount;
            m_forceAttack = forceAttack;
        }

        // Tick @0x4E0F10 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            if (owner == null)
                return true;
            GameCoreTower tower = GetTower(owner);
            if (tower == null)
                return true;

            if (tower.isPostStageClear)
            {
                // Stage already won: stand down (non-shooting idle). The binary
                // does NOT return here — the rest of the tick still runs once.
                owner.SetCurrentCommand(new TowerStateIdle(false), null);
            }

            if (!m_forceAttack)
            {
                m_burstTimer = Mathf.Min(m_burstTimer + dt, tower.burstInterval);

                // Ammo gate: -1 = unlimited, >0 = rounds left.
                if (tower.magazineCapacity == -1 || tower.magazineCapacity > 0)
                {
                    if (m_burstTimer == tower.burstInterval)
                    {
                        List<IDamageable> targets = new List<IDamageable>();
                        // INFERRED overload: attack wants targets inside FIRE
                        // range (filterInFireRange = true); the decompiler lost
                        // the arguments at this call site.
                        TowerHelper.GetNearestTargets(tower, targets, true);
                        if (targets.Count < 1)
                        {
                            // Nothing to shoot: back to a shooting idle,
                            // carrying the current burst progress.
                            owner.SetCurrentCommand(
                                new TowerStateIdle(true, m_burstCount), null);
                        }
                        else
                        {
                            OnAttack(tower, targets);
                        }
                    }
                }

                if (m_burstCount < tower.burstCount)
                {
                    UpdateRotation(tower, dt);   // keep tracking mid-burst
                    return true;
                }
            }
            else
            {
                // Forced attack: fire once with an empty target list (the
                // projectile ctor receives whatever targeting it does itself).
                OnAttack(tower, new List<IDamageable>());
            }

            // Burst complete (or forced shot done): non-shooting idle.
            owner.SetCurrentCommand(new TowerStateIdle(false), null);
            return true;
        }

        // OnAttack @0x4E1380
        // Counts the shot, consumes ammo when the burst's last shot lands the
        // magazine logic, then instantiates the sim projectile declared by the
        // view prefab: Activator.CreateInstance(projectile.GetGameCoreType(),
        // new object[] { tower, targets, true }).
        private void OnAttack(GameCoreTower tower, List<IDamageable> targets)
        {
            if (tower == null)
                return;

            m_burstCount = Mathf.Min(m_burstCount + 1, tower.burstCount);

            // Ammo is spent when the burst finishes (magazine model), never for
            // unlimited (-1) magazines.
            if (tower.burstCount <= m_burstCount && tower.magazineCapacity > 0)
            {
                tower.magazineCapacity = Mathf.Max(tower.magazineCapacity - 1, 0);
            }

            m_burstTimer = 0f;

            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            if (viewer == null)
                return;
            Q4.Projectile projectileView = viewer.projectile;   // TowerBase @0xC0
            if (projectileView == null)
                return;

            System.Type coreType = projectileView.GetGameCoreType();   // virtual slot 4
            System.Activator.CreateInstance(coreType, new object[] { tower, targets, true });

            Events.projectileLaunchEvent.Invoke(tower);   // Events statics +0x88
        }

        // UpdateRotation @0x4E16C0
        // Rotates the fort (turret) toward DesiredDirection using the tower's
        // current per-axis rotation speeds, via Euler-angle MoveTowardsAngle.
        private void UpdateRotation(GameCoreTower tower, float dt)
        {
            m_desiredDirection = DesiredDirection(tower);

            Vector3 desiredEuler = Quaternion.LookRotation(m_desiredDirection, Vector3.up).eulerAngles;
            Vector3 currentEuler = Quaternion.LookRotation(tower.fortDirection).eulerAngles;

            float newX = Mathf.MoveTowardsAngle(currentEuler.x, desiredEuler.x,
                                                tower.currentRotateSpeedX * dt);
            float newY = Mathf.MoveTowardsAngle(currentEuler.y, desiredEuler.y,
                                                dt * tower.currentRotateSpeedY);

            tower.fortDirection = Quaternion.Euler(newX, newY, currentEuler.z) * Vector3.forward;
        }

        // DesiredDirection @0x4E18B0
        // Aim direction: from the muzzle (position + up*height) toward the
        // current target, deflected by the projectile prefab's own
        // GetFireDirection (virtual slot 10 — ballistic/leading aim per
        // projectile type). Falls back to the current fortDirection; result
        // is normalized.
        private Vector3 DesiredDirection(GameCoreTower tower)
        {
            Vector3 dir = Vector3.zero;
            if (tower == null)
                return dir;

            dir = tower.fortDirection;

            IDamageable target = tower.GetCurrentTarget();
            Q4.TowerBase viewer = Q4.GameCoreBridge.Instance != null
                ? Q4.GameCoreBridge.Instance.GetUnityObject<Q4.TowerBase>(tower.handle)
                : null;

            if (target != null && viewer != null)
            {
                Vector3 muzzle = tower.position + Vector3.up * tower.height;
                Vector3 targetPos = target.Position();          // IDamageable slot 5
                Q4.Projectile projectileView = viewer.projectile;   // @0xC0
                if (projectileView != null)
                {
                    dir = projectileView.GetFireDirection(muzzle, targetPos, Vector3.zero);
                }
            }
            return dir.normalized;
        }

        // UpdateTarget @0x4E1B30
        // Drops the current target when it leaves the detection volume and
        // pulls the next one from the tower's target queue. NOTE: no caller
        // inside this state's Tick in the binary (retained private method per
        // metadata; TowerStateIdle runs its own variant).
        private void UpdateTarget(GameCoreTower tower, float dt)
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
                    // Inlined SetCurrentTarget(null) in the binary: clear the
                    // target, zero both rotation speeds, notify the view.
                    tower.SetCurrentTarget(null);
                }
            }

            if (tower.GetCurrentTarget() == null)
            {
                // INFERRED index argument: the tower's authored queue index
                // (nextTargetToAttackIndex) — the decompiler dropped the args.
                IDamageable next = TowerHelper.GetNextTargetFromTowerTargetQueue(
                    tower, tower.nextTargetToAttackIndex);
                tower.SetCurrentTarget(next);
            }
        }
    }
}
