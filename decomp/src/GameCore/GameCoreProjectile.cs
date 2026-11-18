// GameCore/GameCoreProjectile.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Abstract base of every simulation-side projectile. Spawned reflectively by
// TowerStateAttack.OnAttack with (tower, targets, dealsDamage). Captures the
// firing tower's handle/attribute/damage settings, converts the target list to
// handles, and ages itself out via m_maxTimeAlive (set by subclasses from
// Q4.Projectile.maxLifeDuration). Subclasses implement Tick-time behaviour
// (flight, hit scheduling) and call OnHit -> DamageHelper / IDamageable
// .DealDamage for the actual damage application.
// Logic from GameCore.GameCoreProjectile methods (RVA 0x4C3230..0x4C3AC0).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public abstract class GameCoreProjectile : GameCoreObject // TypeDefIndex: 3064
    {
        // ---- Fields ----
        public GameCoreHandle sourceTower;                    // 0x60 (32-byte struct)
        protected EEnemyClassTypeDef m_towerClass;            // 0x80
        protected EEnemyStrengthTypeDef m_towerStrength;      // 0x84
        public float duration;                                // 0x88
        protected float m_attackPowerMax;                     // 0x8C
        protected float m_attackSpread;                       // 0x90
        protected List<AttenuationInfo> m_attackAttenuations; // 0x98
        protected bool m_dealDamage = true;                   // 0xA0 (field initializer)
        protected float m_maxTimeAlive;                       // 0xA4
        protected List<GameCoreHandle> m_targetHandles;       // 0xA8

        // .ctor @0x4C3230 — snapshot the tower's combat attributes, convert the
        // target list into handles and spawn at the tower's muzzle position
        // (position + up*height).
        // NOTE: the original NREs when tower is null.
        public GameCoreProjectile(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage = true)
        {
            sourceTower = tower.handle;
            m_towerClass = tower.classType;
            m_towerStrength = tower.strengthType;
            m_dealDamage = dealsDamage;
            duration = 0.0f;

            if (enemies != null && enemies.Count > 0)
            {
                m_targetHandles = new List<GameCoreHandle>();
                foreach (IDamageable enemy in enemies)
                {
                    if (enemy != null)
                    {
                        m_targetHandles.Add(enemy.Handle());
                    }
                }
            }

            m_attackPowerMax = tower.attackPower;
            m_attackSpread = tower.attackSpread;
            m_attackAttenuations = tower.attackAttenuationInfos;

            position = tower.position + Vector3.up * tower.height;   // setter updates collision
        }

        // Tick @0x4C3580 (Slot 7) — age the projectile; destroy it once
        // m_maxTimeAlive elapses (subclasses assign it from the view
        // projectile's maxLifeDuration).
        public override void Tick()
        {
            float dt = GameCore.TickDeltaTime;
            duration += dt;
            m_maxTimeAlive -= dt;
            if (m_maxTimeAlive <= 0.0f)
            {
                DestroySelf();   // vtable slot 6
            }
        }

        // GetTargets @0x4C3610
        public List<GameCoreHandle> GetTargets()
        {
            return m_targetHandles;
        }

        // GetAttackDamage @0x4C3620 — distance-attenuated damage: the
        // attenuation curve is sampled at distance/attackSpread and scaled by
        // the tower's attack power.
        protected float GetAttackDamage(float distance)
        {
            return Q4.AttenuationCurve.Sample(m_attackAttenuations, distance / m_attackSpread)
                * m_attackPowerMax;
        }

        // DamageToEnemyInfo @0x4C3650 — debug/telemetry string ("From <viewer
        // name> to <enemy name>\n"). Returns an empty string when there is no
        // source tower or its viewer is gone.
        public string DamageToEnemyInfo(Q4.EnemyBase enemy, float damage, float damageRate)
        {
            string result = string.Empty;

            if (enemy == null)
            {
                return result;
            }

            // The damage/damageRate parameters are unused by the shipped body.
            if (sourceTower.isNull)
            {
                return result;
            }

            GameObject viewer = sourceTower.GetUnityObject();
            if (viewer == null)
            {
                return result + "\n" + "------------------------------";
            }

            result += string.Format("From {0} to {1}", viewer.name, enemy.name) + "\n";
            return result + "\n" + "------------------------------";
        }

        // CompareEnemyByDistance @0x4C38E0 — list-sort comparer: orders target
        // handles by their live object's distance to the source tower's muzzle
        // (tower position + up*height). 0 when either handle is dead or there
        // is no source tower (faithful: the original NREs on the tower).
        public int CompareEnemyByDistance(GameCoreHandle left, GameCoreHandle right)
        {
            GameCoreObject leftObj = left.GetMostRecentObjectVersion<GameCoreObject>();
            GameCoreObject rightObj = right.GetMostRecentObjectVersion<GameCoreObject>();
            if (leftObj == null || rightObj == null)
            {
                return 0;
            }

            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();
            Vector3 towerMuzzle = tower.position + Vector3.up * tower.height;

            float leftDist = Vector3.Distance(leftObj.position, towerMuzzle);
            float rightDist = Vector3.Distance(rightObj.position, towerMuzzle);
            return leftDist.CompareTo(rightDist);
        }

        // RecreateViewer @0x4C3AC0 (Slot 5) — reuse the existing view's
        // GameObject when present, otherwise null (the caller respawns from
        // the prefab name). INFERRED: Ghidra labels the shared GetUnityObject
        // body <Structure>; a projectile's viewer is its Q4.Projectile
        // component (only .gameObject is used).
        public override GameObject RecreateViewer()
        {
            Q4.Projectile viewer = GetUnityObject<Q4.Projectile>();
            if (viewer == null)
            {
                return null;
            }
            return viewer.gameObject;
        }
    }
}
