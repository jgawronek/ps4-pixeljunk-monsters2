// GameCore/GameCoreProjectileElectric.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Tesla-coil style projectile: a stationary discharge anchored at the tower's
// muzzle. The constructor snapshot sorts every target by distance from the
// muzzle; each tick a virtual bolt front (m_bulletSpeed * duration) sweeps
// outward and zaps each still-valid target it has reached (in nearest-first
// order), removing it from the pending list. No splash, no buffs.
// Logic from GameCore.GameCoreProjectileElectric methods (RVA 0x4C4F70..0x4C5640).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileElectric : GameCoreProjectile // TypeDefIndex: 3056
    {
        // ---- Fields ----
        private float m_bulletSpeed;                  // 0xB0 (view Q4.ProjectileElectric.bulletSpeed @0x50)
        private List<GameCoreHandle> m_validTargets;  // 0xB8

        // .ctor @0x4C4F70 — sort the constructor targets nearest-first (base
        // CompareEnemyByDistance as a Comparison<GameCoreHandle>), snapshot
        // them into m_validTargets, then spawn the view at the tower and let
        // it build its lightning bolt list.
        // NOTE: the original NREs when tower, its viewer or the spawned view
        // is null (an electric projectile cannot exist without a view).
        public GameCoreProjectileElectric(GameCoreTower tower, List<IDamageable> enemies, bool dealDamage)
            : base(tower, enemies, dealDamage)
        {
            if (m_targetHandles != null)
            {
                m_targetHandles.Sort(CompareEnemyByDistance);
                m_validTargets = new List<GameCoreHandle>(m_targetHandles.ToArray());
            }

            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            if (viewer == null)
            {
                throw new System.NullReferenceException();   // faithful: original NREs
            }

            Q4.ProjectileElectric view = Object.Instantiate<Q4.ProjectileElectric>(viewer.projectile);
            if (view == null)
            {
                throw new System.NullReferenceException();   // faithful: original NREs
            }

            Q4.GameCoreBridge.Instance.SetUnityObject(this, view);

            m_maxTimeAlive = view.maxLifeDuration;
            m_bulletSpeed = view.bulletSpeed;

            // Re-anchored at the tower muzzle (the base ctor set this already;
            // the shipped code assigns it again after the view exists).
            position = tower.position + Vector3.up * tower.height;

            view.InitializeLightnings(this);
        }

        // ValidTargetsCount @0x4C5250 — how many targets the bolt still has to
        // zap (polled by the view to drive its lightning visuals).
        public int ValidTargetsCount()
        {
            if (m_validTargets == null)
            {
                return 0;
            }
            return m_validTargets.Count;
        }

        // Tick @0x4C52B0 (Slot 7) — base lifetime logic inlined by the
        // compiler, then the hit schedule (still runs on the death tick).
        public override void Tick()
        {
            float dt = GameCore.TickDeltaTime;

            // base.Tick() inlined:
            duration += dt;
            m_maxTimeAlive -= dt;
            if (m_maxTimeAlive <= 0.0f)
            {
                DestroySelf();
            }

            TickHitSchedule();
        }

        // TickHitSchedule @0x4C5340 — sweep the bolt front outward: every
        // pending target whose distance from the muzzle is now inside
        // bulletSpeed*duration gets zapped and removed from the list. A dead
        // tower or an exhausted target list destroys the projectile silently
        // (no event on this path, faithful).
        // NOTE: the loop re-reads Count each iteration and RemoveAt(i) does
        // not advance i, so the shifted element at the same index is re-tested
        // next pass (faithful to the shipped code).
        private void TickHitSchedule()
        {
            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();

            if (tower == null || m_validTargets == null || m_validTargets.Count < 1)
            {
                DestroySelf();
                return;
            }

            int i = 0;
            while (i < m_validTargets.Count)
            {
                GameCoreObject obj = m_validTargets[i].GetMostRecentObjectVersion<GameCoreObject>();
                IDamageable d = obj as IDamageable;

                if (d != null && d.Valid())   // IDamageable slot 11
                {
                    Vector3 muzzle = tower.position + Vector3.up * tower.height;
                    float distance = Vector3.Distance(obj.position, muzzle);

                    if (duration * m_bulletSpeed > distance)
                    {
                        OnHit(d);
                        m_validTargets.RemoveAt(i);
                        continue;   // do not advance: test the shifted entry
                    }
                }

                i++;
            }
        }

        // OnHit @0x4C5640 — full (unattenuated) attribute-scaled damage to a
        // single target, then broadcast projectileHitEvent. Does nothing when
        // enemy is null (faithful).
        private void OnHit(IDamageable enemy)
        {
            if (enemy == null)
            {
                return;
            }

            GameCoreObject obj = enemy.Handle().GetMostRecentObjectVersion<GameCoreObject>();
            float damage = DamageHelper.DamageByAttributes(
                m_towerStrength, m_towerClass, obj, m_attackPowerMax);
            enemy.DealDamage(this, damage, 0.0f, null, true);

            Events.projectileHitEvent.Invoke(this, enemy);
        }
    }
}
