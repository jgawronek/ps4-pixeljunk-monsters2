// GameCore/GameCoreProjectileBeam.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Continuous beam projectile (laser): flies straight from the muzzle toward the
// directive target, sweeping a capsule of radius m_radius along the segment it
// travelled this frame. While flying it zaps every damageable the swept volume
// touches (once each, distanceToCenter = 0). When terrain stops the beam it
// latches the impact distance and switches to spread mode: in the same tick
// everything still-valid within m_attackSpread of the impact point is zapped
// once more. Damage is full attribute-scaled power (no attenuation curve).
// Logic from GameCore.GameCoreProjectileBeam methods (RVA 0x4C3B60..0x4C4DF0).
//
// Rodata (CONFIRMED from the ELF):
//   DAT_00b7c40c = 0.0f  (perpendicular-distance² comparison in the sweep test)

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileBeam : GameCoreProjectile // TypeDefIndex: 3055
    {
        // ---- Fields ----
        private GameCoreHandle m_directiveTarget;      // 0xB0
        private float m_speed;                         // 0xD0 (view Q4.ProjectileBeam.speed @0x50)
        private Vector3 m_startPoint;                  // 0xD4
        private Vector3 m_direction;                   // 0xE0
        private float m_beamFlyLength;                 // 0xEC (view beamFlyLength @0x48; terrain-clamped)
        private float m_radius;                        // 0xF0 (view radius @0x54)
        private bool m_triggerSpread;                  // 0xF4
        private float m_lastFrameDistance;             // 0xF8
        private List<GameCoreHandle> m_attackTargets;  // 0x100

        // .ctor @0x4C3B60 — sort the constructor targets nearest-first, pick
        // the directive target (tower's current target wins), aim the beam and
        // spawn the view.
        // NOTE: the original NREs when tower is null, the target list is
        // empty, or the directive target handle is dead.
        public GameCoreProjectileBeam(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage = true)
            : base(tower, enemies, dealsDamage)
        {
            IDamageable currentTarget = tower.GetCurrentTarget();

            if (m_targetHandles != null && m_targetHandles.Count > 0)
            {
                m_targetHandles.Sort(CompareEnemyByDistance);
                m_directiveTarget = currentTarget != null
                    ? currentTarget.Handle()
                    : m_targetHandles[0];
            }

            m_startPoint = position;

            GameCoreObject targetObj = m_directiveTarget.GetMostRecentObjectVersion<GameCoreObject>();
            if (targetObj == null)
            {
                throw new System.NullReferenceException();   // faithful: original NREs
            }

            // FUN_0098d750 = Vector3 normalized.
            m_direction = (targetObj.position - m_startPoint).normalized;

            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            if (viewer != null)
            {
                Q4.ProjectileBeam view = Object.Instantiate<Q4.ProjectileBeam>(viewer.projectile);
                if (view != null)
                {
                    Q4.GameCoreBridge.Instance.SetUnityObject(this, view);

                    m_maxTimeAlive = view.maxLifeDuration;
                    m_beamFlyLength = view.beamFlyLength;
                    m_speed = view.speed;
                    m_radius = view.radius;

                    if (m_targetHandles != null && m_targetHandles.Count > 0)
                    {
                        view.InitBeam(viewer, m_targetHandles[0]);
                    }
                }
            }

            m_attackTargets = new List<GameCoreHandle>();
        }

        // Tick @0x4C4100 (Slot 7) — base lifetime inlined by the compiler;
        // then fly the beam and, until terrain has stopped it, run the ground
        // raycast, the sweep hit test and the spread hit test (which only
        // fires on the very tick the raycast latched m_triggerSpread).
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

            TickBeamFly(dt);

            if (!m_triggerSpread)
            {
                TickRayCastGround();
                TickLineCastEnemies();
                TickHitEnemiesSpread();
            }
        }

        // TickBeamFly @0x4C41E0 — advance the beam head along m_direction by
        // speed*dt (skipped once destroyed; the position setter updates the
        // collision grid).
        private void TickBeamFly(float dt)
        {
            if (IsDestroyed())
            {
                return;
            }

            m_lastFrameDistance = dt * m_speed;
            position += m_direction * m_lastFrameDistance;
        }

        // TickRayCastGround @0x4C4290 — probe the segment travelled this
        // frame against terrain; on a hit clamp m_beamFlyLength to the impact
        // distance from the start point and latch spread mode.
        private void TickRayCastGround()
        {
            Vector3 lineEnd = position + m_direction * m_lastFrameDistance;

            RaycastHit hit;
            if (Physics.Linecast(position, lineEnd, out hit, Q4.Layers.Instance.TerrainMask))
            {
                m_beamFlyLength = Vector3.Distance(m_startPoint, hit.point);
                m_triggerSpread = true;
            }
        }

        // TickLineCastEnemies @0x4C4420 — sweep test over every game-core
        // object (global enumeration): an object is touched when it lies
        // ahead of the beam head (Dot >= 0), within this frame's travelled
        // segment (+ beam radius) and its perpendicular distance from the
        // beam axis is below its own collision radius + m_radius. Each object
        // is recorded once in m_attackTargets; valid damageables among them
        // take a hit with distanceToCenter = 0.
        private void TickLineCastEnemies()
        {
            foreach (GameCoreObject obj in GameCore.Instance.AllObjects<GameCoreObject>())
            {
                float combinedRadius = obj.collision.radius + m_radius;
                Vector3 delta = obj.position - position;
                float along = Vector3.Dot(m_direction, delta);

                if (along < 0.0f)
                {
                    continue;
                }

                // FUN_0098c8c0 = Vector3 magnitude.
                float distance = delta.magnitude;
                if (distance > m_lastFrameDistance + m_radius)
                {
                    continue;
                }

                // Perpendicular distance² = |delta|² - along²; require it to
                // be strictly inside the inflated radius (DAT_00b7c40c = 0.0f).
                if (combinedRadius * combinedRadius - (distance * distance - along * along) <= 0.0f)
                {
                    continue;
                }

                if (m_attackTargets.Contains(obj.handle))
                {
                    continue;
                }
                m_attackTargets.Add(obj.handle);

                IDamageable d = obj as IDamageable;
                if (d != null && d.Valid())   // IDamageable slot 11
                {
                    OnHit(d, 0.0f);
                }
            }
        }

        // TickHitEnemiesSpread @0x4C4910 — only active once terrain stopped
        // the beam (m_triggerSpread, checked by the caller and again here):
        // every still-valid damageable not already zapped, within
        // m_attackSpread of the impact point, takes a spread hit.
        private void TickHitEnemiesSpread()
        {
            if (!m_triggerSpread)
            {
                return;
            }

            Vector3 impactPoint = m_startPoint + m_direction * m_beamFlyLength;

            foreach (GameCoreObject obj in GameCore.Instance.AllObjects<GameCoreObject>())
            {
                IDamageable d = obj as IDamageable;
                if (d == null || !d.Valid())
                {
                    continue;
                }

                if (m_attackTargets.Contains(d.Handle()))
                {
                    continue;
                }

                float dist = Vector3.Distance(obj.position, impactPoint);
                if (dist <= m_attackSpread)
                {
                    // distanceToCenter passed as 0 in the decompilation.
                    OnHit(d, 0.0f);
                }
            }
        }

        // OnHit @0x4C4DF0 — attribute-scaled damage (no attenuation curve) to
        // a single target, then broadcast projectileHitEvent. Does nothing
        // when enemy is null (faithful).
        private void OnHit(IDamageable enemy, float distanceToCenter = 0.0f)
        {
            if (enemy == null)
            {
                return;
            }

            GameCoreObject obj = enemy as GameCoreObject;
            float damage = DamageHelper.DamageByAttributes(
                m_towerStrength, m_towerClass, obj, m_attackPowerMax);
            enemy.DealDamage(this, damage, distanceToCenter, null, true);

            Events.projectileHitEvent.Invoke(this, enemy);
        }
    }
}
