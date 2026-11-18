// GameCore/GameCoreProjectileLightning.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Lightning-strike projectile: on creation it snapshots every aimable enemy in
// the world (deduplicated by host enemy), each with its own random strike
// delay. Tick accumulates m_attackTimer; whenever it passes a target's
// delayTime the bolt strikes that target (full attribute-scaled damage) and the
// entry is removed. The projectile lives until its target list is exhausted —
// m_maxTimeAlive is never decremented (faithful).
// Logic from GameCore.GameCoreProjectileLightning methods (RVA 0x4CAFB0..0x4CBC10).
//
// Rodata/field initializers (CONFIRMED from the ctor prologue):
//   m_initialDelay   = 1.0f  (0x3F800000)
//   m_randomFactorMax = 0.5f (0x3F000000)

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileLightning : GameCoreProjectile // TypeDefIndex: 3062
    {
        // ---- Fields ----
        private float m_attackTimer;                       // 0xB0
        private float m_initialDelay = 1.0f;               // 0xB4 (field initializer; view initialAttackDelay @0x6C)
        private float m_randomFactorMin;                   // 0xB8 (view randomAttackTimeMin @0x70)
        private float m_randomFactorMax = 0.5f;            // 0xBC (field initializer; view randomAttackTimeMax @0x74)
        private List<LightningTargetInfo> m_lightningAttackTargets;   // 0xC0

        // NOTE: m_initialDelay is snapshotted from the view but never read by
        // the shipped simulation code (only m_randomFactorMin/Max feed the
        // per-target delay) — TODO verify whether a build used it.

        // [Serializable] private struct — TypeDefIndex: 3063
        private struct LightningTargetInfo
        {
            public float delayTime;          // 0x0
            public GameCoreHandle target;    // 0x8

            // .ctor @0x4CBE70
            public LightningTargetInfo(float time, GameCoreHandle targetHandle)
            {
                delayTime = time;
                target = targetHandle;
            }
        }

        // .ctor @0x4CAFB0 — spawn the view at the tower's position (not the
        // muzzle fire point), copy the strike timing settings from the view,
        // then snapshot the attack targets.
        // NOTE: the original NREs when tower or its viewer is null; a missing
        // spawned view is tolerated (InitAttackTargets still runs).
        public GameCoreProjectileLightning(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage = true)
            : base(tower, enemies, dealsDamage)
        {
            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            if (viewer != null)
            {
                Q4.ProjectileLightning view = Object.Instantiate<Q4.ProjectileLightning>(
                    viewer.projectile,   // TowerBase 0xC0
                    tower.position,
                    Quaternion.identity);

                if (view != null)
                {
                    Q4.GameCoreBridge.Instance.SetUnityObject(this, view);
                    m_maxTimeAlive = view.maxLifeDuration;
                    m_initialDelay = view.initialAttackDelay;
                    m_randomFactorMin = view.randomAttackTimeMin;
                    m_randomFactorMax = view.randomAttackTimeMax;
                }
            }

            InitAttackTargets(tower);
        }

        // InitAttackTargets @0x4CB1D0 — snapshot every aimable damageable in
        // the world (global AllObjects<GameCoreObject> enumeration), deduped by
        // Host() so an enemy with several attack points is struck once, each
        // with a random per-target delay in [m_randomFactorMin,
        // m_randomFactorMax].
        private void InitAttackTargets(GameCoreTower tower)
        {
            m_lightningAttackTargets = new List<LightningTargetInfo>();
            List<GameCoreEnemy> visitedHosts = new List<GameCoreEnemy>(32);

            foreach (GameCoreObject obj in GameCore.Instance.AllObjects<GameCoreObject>())
            {
                IDamageable d = obj as IDamageable;
                if (d == null)
                {
                    continue;
                }

                GameCoreEnemy host = d.Host();   // IDamageable slot 10
                if (visitedHosts.Contains(host))
                {
                    continue;
                }

                if (obj.IsDestroyed())   // bool destroyed @0x18
                {
                    continue;
                }

                if (!d.IsAimableTarget(tower))   // IDamageable slot 0
                {
                    continue;
                }

                visitedHosts.Add(host);

                GameCoreHandle targetHandle = d.Handle();
                // INFERRED: the decompilation drops RandomRange's third
                // (handle) argument and feeds the result straight into the
                // struct ctor; the projectile's own handle is the natural key.
                float delayTime = GameCoreObject.RandomRange(m_randomFactorMin, m_randomFactorMax, handle);
                m_lightningAttackTargets.Add(new LightningTargetInfo(delayTime, targetHandle));
            }

            visitedHosts.Clear();
        }

        // Tick @0x4CB850 (Slot 7) — advance the strike clock, fire due bolts,
        // then destroy the projectile once every target has been struck.
        // FAITHFUL ODDITY: duration/m_maxTimeAlive (the base lifetime) are
        // never touched — the target list alone governs the lifetime.
        public override void Tick()
        {
            m_attackTimer += GameCore.TickDeltaTime;

            TickHitSchedule(GameCore.TickDeltaTime);

            // TickLife inlined by the compiler:
            TickLife(GameCore.TickDeltaTime);
        }

        // TickHitSchedule @0x4CB910 — strike every target whose delayTime has
        // elapsed and which is still valid.
        // NOTE: the loop re-reads Count each iteration and RemoveAt(i) does
        // not advance i, so the shifted element at the same index is re-tested
        // next pass (faithful to the shipped code).
        private void TickHitSchedule(float dt)
        {
            if (m_lightningAttackTargets == null || m_lightningAttackTargets.Count < 1)
            {
                return;
            }

            int i = 0;
            while (i < m_lightningAttackTargets.Count)
            {
                LightningTargetInfo info = m_lightningAttackTargets[i];

                if (m_attackTimer < info.delayTime)
                {
                    i++;
                    continue;
                }

                GameCoreObject obj = info.target.GetMostRecentObjectVersion<GameCoreObject>();
                IDamageable d = obj as IDamageable;

                if (d != null && d.Valid())   // IDamageable slot 11
                {
                    OnHit(d);
                    m_lightningAttackTargets.RemoveAt(i);
                    continue;   // do not advance: re-test the shifted entry
                }

                i++;
            }
        }

        // TickLife @0x4CBBa0 — the projectile is done when its target list is
        // empty (or was never filled). The dt parameter is unused by the
        // shipped body.
        private void TickLife(float dt)
        {
            if (m_lightningAttackTargets != null && m_lightningAttackTargets.Count != 0)
            {
                return;
            }
            DestroySelf();   // vtable slot 6
        }

        // OnHit @0x4CBC10 — full (unattenuated) attribute-scaled damage to a
        // single struck target, then broadcast projectileHitEvent. Does
        // nothing when enemy is null (faithful).
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
