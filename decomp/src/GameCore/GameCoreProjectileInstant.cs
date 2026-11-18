// GameCore/GameCoreProjectileInstant.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Hitscan-style projectile (bullet): has no flight simulation. Each tick it
// checks whether the (virtual) bullet — travelling at m_bulletSpeed since
// launch — has reached the tracked target's current position; when it has and
// the target is still valid it applies direct damage plus radial splash damage
// around the target and destroys itself.
// Logic from GameCore.GameCoreProjectileInstant methods (RVA 0x4C9D90..0x4CAD40).

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileInstant : GameCoreProjectile // TypeDefIndex: 3061
    {
        // ---- Fields ----
        private float m_bulletSpeed;    // 0xB0 (view Q4.ProjectileInstant.bulletSpeed @0x48)
        private GameCoreHandle m_target = GameCoreHandle.nullHandle;   // 0xB8

        // .ctor @0x4C9D90 — spawn the view at the tower's muzzle fire point and
        // track the tower's current target. Without a current target the
        // projectile destroys itself immediately (faithful).
        // NOTE: the original NREs when tower is null.
        public GameCoreProjectileInstant(GameCoreTower tower, List<IDamageable> enemies, bool dealDamage)
            : base(tower, enemies, dealDamage)
        {
            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            if (viewer != null)
            {
                Vector3 firePoint = viewer.GetFirePointByRemainingMag(tower.magazineCapacity);

                Q4.ProjectileInstant view = Object.Instantiate<Q4.ProjectileInstant>(
                    viewer.projectile,   // TowerBase 0xC0
                    firePoint,
                    Quaternion.identity);

                if (view != null)
                {
                    Q4.GameCoreBridge.Instance.SetUnityObject(this, view);
                    m_maxTimeAlive = view.maxLifeDuration;
                    m_bulletSpeed = view.bulletSpeed;
                }
            }

            IDamageable currentTarget = tower.GetCurrentTarget();
            if (currentTarget == null)
            {
                DestroySelf();   // vtable slot 6
            }
            else
            {
                m_target = currentTarget.Handle();
            }
        }

        // Tick @0x4CA0D0 (Slot 7) — base lifetime logic inlined by the compiler,
        // then the hit schedule check (which still runs on the death tick).
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

        // TickHitSchedule @0x4CA160 — virtual bullet flight: when the distance
        // from the tower muzzle to the target drops below bulletSpeed*duration
        // the bullet has "arrived". A dead tower or dead target ends the
        // projectile with a projectileHitEvent(this, null) broadcast.
        private void TickHitSchedule()
        {
            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();
            GameCoreObject targetObj = m_target.GetMostRecentObjectVersion<GameCoreObject>();

            if (tower == null || targetObj == null)
            {
                DestroySelf();
                Events.projectileHitEvent.Invoke(this, null);
                return;
            }

            Vector3 muzzle = tower.position + Vector3.up * tower.height;   // float @0xF0
            float distance = Vector3.Distance(targetObj.position, muzzle);

            if (distance < m_bulletSpeed * duration)
            {
                IDamageable enemy = targetObj as IDamageable;
                if (enemy != null && enemy.Valid())   // IDamageable slot 11
                {
                    OnHit(enemy);
                    DestroySelf();
                }
            }
        }

        // OnHit @0x4CA3C0 — direct damage to the struck enemy, then splash to
        // every *other* valid damageable within m_attackSpread of the enemy's
        // position (query centered m_attackSpread below it, cylinder
        // radius=spread height=2*spread) with curve-attenuated damage.
        // NOTE: unlike Trajectory, no event is fired when enemy/tower is null,
        // and there is no buff application.
        private void OnHit(IDamageable enemy)
        {
            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();
            if (enemy == null || tower == null)
            {
                return;
            }

            // ---- Direct hit ----
            GameCoreObject obj = enemy.Handle().GetMostRecentObjectVersion<GameCoreObject>();
            float damage = DamageHelper.DamageByAttributes(
                tower.strengthType, tower.classType, obj, m_attackPowerMax);
            enemy.DealDamage(this, damage, 0.0f, null, true);

            Events.projectileHitEvent.Invoke(this, enemy);

            // ---- Splash around the enemy's position ----
            Vector3 enemyPos = enemy.Position();
            Vector3 splashPos = enemyPos + Vector3.down * m_attackSpread;

            foreach (GameCoreObject other in GameCore.Instance.AllObjects<GameCoreObject>(
                splashPos, new Cylinder(m_attackSpread, m_attackSpread + m_attackSpread)))
            {
                IDamageable d = other as IDamageable;
                if (d == null || d == enemy)
                {
                    continue;
                }

                // IsTarget inlined by the compiler (same key arithmetic as
                // TowerHelper.IsTarget).
                if (!TowerHelper.IsTarget(d.MoveType(), tower.attackType)
                    || !d.IsAimableTarget(tower))
                {
                    continue;
                }

                float dist = Vector3.Distance(d.Position(), enemyPos);
                if (dist > m_attackSpread)
                {
                    continue;
                }

                float dmg = GetAttackDamage(dist);
                float finalDamage = DamageHelper.DamageByAttributes(
                    tower.strengthType, tower.classType, other, dmg);
                d.DealDamage(this, finalDamage, dist / m_attackSpread, null, true);
            }
        }

        // CompareEnemyByDistance @0x4CAD40 — IDamageable overload: orders
        // targets by distance from the source tower's muzzle. 0 when the left
        // entry is null or the tower is dead; NREs on a null right entry
        // (faithful — the original dereferences it).
        public int CompareEnemyByDistance(IDamageable left, IDamageable right)
        {
            if (left == null)
            {
                return 0;
            }

            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower == null)
            {
                return 0;
            }

            Vector3 muzzle = tower.position + Vector3.up * tower.height;
            float leftDist = Vector3.Distance(left.Position(), muzzle);
            float rightDist = Vector3.Distance(right.Position(), muzzle);
            return leftDist.CompareTo(rightDist);
        }
    }
}
