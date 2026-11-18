// GameCore/GameCoreEnemyAttackPoint.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// A discrete damageable point on an enemy (e.g. a boss's weak spot / balloon anchor).
// Damage dealt to a point is forwarded to the host enemy, tagged with this point so the
// enemy can accumulate "vulnerable" damage. Points follow the host's orientation.
// Field offsets from global-metadata.dat; logic from Ghidra (RVA 0x4AE3E0..0x4B5580).

using UnityEngine;
using Q4; // AttackPointSetting, GameCoreBridge, EEnemyMoveTypeDef

namespace GameCore
{
    public class GameCoreEnemyAttackPoint : GameCoreObject, IDamageable
    {
        private GameCoreHandle m_host;          // 0x60
        private bool m_afterAirPoints;          // 0x8C
        private EEnemyMoveTypeDef m_enemyMoveType; // 0x90
        private bool m_isEnabled;               // 0x94

        // <localPosition>k__BackingField @0x80 (auto-property)
        public Vector3 localPosition { get; protected set; }

        // .ctor @0x4AE3E0
        public GameCoreEnemyAttackPoint(GameCoreEnemy hostEnemy, float radius, GameObject pointView,
            Vector3 localPos, AttackPointSetting setting)
            : base()
        {
            m_enemyMoveType = EEnemyMoveTypeDef.ground;
            m_isEnabled = true;

            m_host = (hostEnemy != null) ? hostEnemy.handle : GameCoreHandle.nullHandle;
            collision = new Cylinder(radius, radius + radius);
            localPosition = localPos;

            // Move type: explicit override if set, otherwise inherit the host's.
            if (setting != null && setting.moveTypeOverride != EEnemyMoveTypeDef.unknown)
                m_enemyMoveType = setting.moveTypeOverride;
            else
                m_enemyMoveType = hostEnemy.enemyMoveType;

            m_afterAirPoints = (setting != null) && setting.afterAirPoints;

            if (pointView != null)
                Q4.GameCoreBridge.Instance.SetUnityObject(handle, pointView);
        }

        // GetHostEnemy @0x4B4DE0
        public GameCoreEnemy GetHostEnemy()
        {
            return m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
        }

        // PredictPositionAndDirection @0x4B4E30 (IDamageable slot)
        public void PredictPositionAndDirection(out Vector3 dPos, out Vector3 dDirection, float aTime)
        {
            GameCoreEnemy host = m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
            if (host == null)
            {
                dPos = localPosition;
                dDirection = Vector3.forward;
                return;
            }
            Vector3 pos, vel;
            // NOTE: original reads the host's m_sideOffset (0x164) directly; exposed here via
            // an internal accessor (INFERRED access mechanism for the cross-class field read).
            if (!host.PathMove.Sample(aTime * host.SpeedCur + host.PathDistance, host.SideOffset, out pos, out vel))
            {
                pos = host.position;
                vel = host.MoveVec;
            }
            dPos = pos + Quaternion.LookRotation(vel) * localPosition;
            dDirection = vel;
        }

        // Host @0x4B5000 (IDamageable slot)
        public GameCoreEnemy Host()
        {
            return m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
        }

        // SetAttackPointEnabled @0x4AF530
        public void SetAttackPointEnabled(bool enable)
        {
            m_isEnabled = enable;
        }

        // Valid @0x4B5050 (IDamageable slot)
        public bool Valid()
        {
            return m_isEnabled && !m_host.isNull;
        }

        // Tick @0x4B50E0 — no-op; points are positioned by the host's TickAttackPoints.
        public override void Tick()
        {
        }

        // DealDamage @0x4B50F0 (IDamageable slot, untyped) — forward to host, tagging this point.
        public void DealDamage(GameCoreObject damageSource, float damageToDeal,
            float distanceToCenterRate, GameCoreObject attackPoint, bool immediateDestroy = true)
        {
            GameCoreEnemy host = m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
            if (host == null)
                return;
            host.DealDamage(damageSource, damageToDeal, distanceToCenterRate, this, immediateDestroy);
        }

        // DealDamage @0x4B5180 (IDamageable slot, typed) — forward to host, tagging this point.
        public void DealDamage(EEnemyStrengthTypeDef strengthType, EEnemyClassTypeDef classType,
            float damageToDeal, float distanceToCenterRate, GameCoreObject damageSource,
            GameCoreObject attackPoint, bool immediateDestroy = true)
        {
            GameCoreEnemy host = m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
            if (host != null)
                host.DealDamage(strengthType, classType, damageToDeal, distanceToCenterRate, damageSource, this, immediateDestroy);
        }

        // IsAimableTarget @0x4B5220 (IDamageable slot)
        public bool IsAimableTarget(GameCoreTower tower)
        {
            if (!m_isEnabled)
                return false;
            bool aimable = !m_host.isNull;
            if (tower != null && !m_host.isNull)
            {
                GameCoreEnemy host = m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (host != null && host.IsBalloon)
                    aimable = tower.balloonAimable;

                // A ground point that sits "after air points" is shielded while any air
                // point on the host is still enabled.
                if (aimable && m_afterAirPoints && m_enemyMoveType == EEnemyMoveTypeDef.ground)
                {
                    foreach (GameCoreHandle apHandle in host.AttackPoints)
                    {
                        GameCoreEnemyAttackPoint ap = apHandle.GetMostRecentObjectVersion<GameCoreEnemyAttackPoint>();
                        if (ap != null && ap.m_enemyMoveType == EEnemyMoveTypeDef.air &&
                            ap.m_isEnabled && !ap.m_host.isNull)
                        {
                            aimable = false;
                            break;
                        }
                    }
                }
            }
            return aimable;
        }

        // ValidateTarget @0x4B54C0 (IDamageable slot)
        public bool ValidateTarget()
        {
            GameCoreEnemy host = m_host.GetMostRecentObjectVersion<GameCoreEnemy>();
            if (host == null || host.PathMove == null)
                return false;
            return host.PathMove.curveLengthBeforeActivation < host.PathDistance;
        }

        // Collision @0x4B5540 (IDamageable slot)
        public Cylinder Collision()
        {
            return collision;
        }

        // Position @0x4B5550 (IDamageable slot)
        public Vector3 Position()
        {
            return position;
        }

        // Handle @0x4B5560 (IDamageable slot)
        public GameCoreHandle Handle()
        {
            return handle;
        }

        // UnityObject @0x4B5570 (IDamageable slot)
        public GameObject UnityObject()
        {
            return handle.GetUnityObject();
        }

        // MoveType @0x4B21A0 (IDamageable slot)
        public EEnemyMoveTypeDef MoveType()
        {
            return m_enemyMoveType;
        }

        // RecreateViewer @0x4B5580 — returns the cached view (points are not re-instantiated).
        public override GameObject RecreateViewer()
        {
            return handle.GetUnityObject();
        }
    }
}