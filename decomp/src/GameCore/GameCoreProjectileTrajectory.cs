// GameCore/GameCoreProjectileTrajectory.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Gravity-affected ballistic projectile (mortar/arrow style). Flies along
// m_moveVector with constant m_gravity pull, optionally home-tracks the target's
// per-tick displacement (m_traceTarget), and detonates on terrain (Linecast) or
// on the first valid damageable inside its collision cylinder. On hit it deals
// direct damage to the struck enemy (when the attack type matches) plus radial
// splash damage attenuated by distance, and applies the viewer's buff settings
// to a directly-hit GameCorePlayer.
// Logic from GameCore.GameCoreProjectileTrajectory methods (RVA 0x4CBE90..0x4CD8A0).
//
// Rodata (all CONFIRMED from the ELF):
//   DAT_00b7c440 = 2.5f  (no-target fallback fire distance)
//   DAT_00b7c444 = 0.5f  (collision-cylinder half-height linecast extension)

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreProjectileTrajectory : GameCoreProjectile // TypeDefIndex: 3065
    {
        // ---- Fields ----
        private Vector3 m_moveVector;                             // 0xB0
        private bool m_traceTarget = true;                        // 0xBC (field initializer)
        private float m_gravity;                                  // 0xC0
        public float hitEffectScale { get; private set; }         // 0xC4 (backing field)
        private GameCoreHandle m_targetHandle;                    // 0xC8

        // .ctor @0x4CBE90 — resolve the tracked target (tower's current target
        // wins over the constructor's enemy list), spawn the view at the
        // tower's muzzle fire point, and derive the launch vector from the
        // view's ballistic GetFireDirection toward the predicted impact point.
        // NOTE: the original NREs when tower is null.
        public GameCoreProjectileTrajectory(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage)
            : base(tower, enemies, dealsDamage)
        {
            IDamageable currentTarget = tower.GetCurrentTarget();
            if (currentTarget != null)
            {
                m_targetHandle = currentTarget.Handle();
            }
            else if (m_targetHandles != null && m_targetHandles.Count >= 1)
            {
                m_targetHandle = m_targetHandles[0];
            }
            else
            {
                m_targetHandle = GameCoreHandle.nullHandle;
            }

            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();

            // FUN_0098d750 = Vector3 normalized.
            Vector3 normFort = tower.fortDirection.normalized;

            hitEffectScale = tower.hitEffectScale;   // float @0x148

            GameCoreObject targetObj = m_targetHandle.GetMostRecentObjectVersion<GameCoreObject>();

            // With no live target the projectile is fired 2.5f ahead along the
            // fort direction (DAT_00b7c440 CONFIRMED).
            Vector3 targetPos = targetObj == null
                ? tower.position + normFort * 2.5f
                : targetObj.position;

            Vector3 hitPos = TowerHelper.GetProjectileGameCoreHitPoisition(tower, targetPos);

            if (viewer != null)
            {
                Vector3 firePoint = viewer.GetFirePointByRemainingMag(tower.magazineCapacity);

                Q4.ProjectileTrajectory view = Object.Instantiate<Q4.ProjectileTrajectory>(
                    viewer.projectile,   // TowerBase 0xC0
                    firePoint,
                    Quaternion.identity);

                if (view != null)
                {
                    Q4.GameCoreBridge.Instance.SetUnityObject(this, view);

                    collision = new Cylinder(
                        view.gameObject.GetComponentInChildren<Renderer>().bounds);

                    // Ballistic launch direction solved by the view (slot 10).
                    m_moveVector = view.GetFireDirection(position, hitPos, Vector3.zero);

                    m_maxTimeAlive = view.maxLifeDuration;
                    m_traceTarget = view.traceTarget;
                    m_gravity = view.gravity;

                    if (enemies == null || enemies.Count < 1)
                    {
                        view.SetupEstimateTime(this);
                    }
                    else
                    {
                        Vector3 predictedPos;
                        Vector3 predictedDir;
                        enemies[0].PredictPositionAndDirection(out predictedPos, out predictedDir, 0.0f);
                        view.SetupEstimateTime(this, predictedPos);
                    }
                }
            }
        }

        // Tick @0x4CC610 (Slot 7) — integrate gravity + velocity, home-track
        // the target's displacement when tracing, then probe for impacts:
        // terrain first (Linecast along the flight path), then any valid
        // damageable inside the collision cylinder. The base-class lifetime
        // logic is inlined at the end by the compiler.
        public override void Tick()
        {
            float dt = GameCore.TickDeltaTime;

            // Gravity is stored as a scalar and applied to the y component
            // (Vector3 * float with only y set in the decompilation).
            m_moveVector += new Vector3(0.0f, m_gravity, 0.0f) * dt;

            position += m_moveVector * dt;   // setter -> UpdateCoreObject

            if (m_traceTarget)
            {
                GameCoreObject targetObj = m_targetHandle.GetMostRecentObjectVersion<GameCoreObject>();
                if (targetObj != null)
                {
                    // Shift by whatever the target moved this tick.
                    position += targetObj.position - targetObj.previousTickPosition;
                }
            }

            float speed = m_moveVector.magnitude;   // FUN_0098c8c0

            // Probe slightly ahead of the body so fast projectiles tunnel
            // through neither terrain nor enemies (DAT_00b7c444 = 0.5f CONFIRMED).
            Vector3 lineEnd = position
                + m_moveVector.normalized * (collision.height * 0.5f + speed * dt);

            if (Physics.Linecast(position, lineEnd, Q4.Layers.Instance.TerrainMask))
            {
                OnHit(null);
                DestroySelf();
            }
            else
            {
                Vector3 queryPos = position + Vector3.down * (collision.height * 0.5f);

                IDamageable candidate = null;
                foreach (GameCoreObject obj in GameCore.Instance.AllObjects<GameCoreObject>(queryPos, collision))
                {
                    IDamageable d = obj as IDamageable;
                    candidate = (d != null && d.Valid()) ? d : null;
                    // Faithful: the loop body breaks after the first iteration,
                    // keeping the first overlap's verdict (valid or not).
                    break;
                }

                if (candidate != null)
                {
                    OnHit(candidate);
                    DestroySelf();
                }
            }

            // base.Tick() inlined by the compiler:
            duration += dt;
            m_maxTimeAlive -= dt;
            if (m_maxTimeAlive <= 0.0f)
            {
                DestroySelf();
            }
        }

        // OnHit @0x4CCCE0 — detonation handling:
        //  1. direct hit: full damage to the struck enemy when the tower's
        //     attack type matches its movement type and it is aimable;
        //  2. splash: every *other* valid damageable within m_attackSpread of
        //     the impact (queried from a point m_attackSpread below, cylinder
        //     radius=spread height=2*spread) takes curve-attenuated damage;
        //  3. buffs: the viewer's BuffSetting components are applied to a
        //     directly-hit GameCorePlayer (support projectiles);
        //  4. always broadcasts projectileHitEvent.
        private void OnHit(IDamageable hitEnemy)
        {
            GameCoreTower tower = sourceTower.GetMostRecentObjectVersion<GameCoreTower>();

            if (m_dealDamage && tower != null)
            {
                // ---- Direct hit ----
                if (hitEnemy != null)
                {
                    // IsTarget inlined by the compiler (same key arithmetic as
                    // TowerHelper.IsTarget).
                    if (TowerHelper.IsTarget(hitEnemy.MoveType(), tower.attackType)
                        && hitEnemy.IsAimableTarget(tower))
                    {
                        GameCoreObject obj = hitEnemy.Handle().GetMostRecentObjectVersion<GameCoreObject>();
                        float damage = DamageHelper.DamageByAttributes(
                            m_towerStrength, m_towerClass, obj, m_attackPowerMax);
                        hitEnemy.DealDamage(this, damage, 0.0f, null, true);
                    }
                }

                // ---- Splash ----
                BuffSetting[] buffSettings = GetBuffSettings();

                Vector3 splashPos = position + Vector3.down * m_attackSpread;

                foreach (GameCoreObject obj in GameCore.Instance.AllObjects<GameCoreObject>(
                    splashPos, new Cylinder(m_attackSpread, m_attackSpread + m_attackSpread)))
                {
                    IDamageable d = obj as IDamageable;
                    if (d == null || d == hitEnemy || !d.Valid())
                    {
                        continue;
                    }

                    if (!TowerHelper.IsTarget(d.MoveType(), tower.attackType)
                        || !d.IsAimableTarget(tower))
                    {
                        continue;
                    }

                    float dist = Vector3.Distance(d.Position(), position);
                    if (dist > m_attackSpread)
                    {
                        continue;
                    }

                    float dmg = GetAttackDamage(dist);
                    GameCoreObject targetObj = d.Handle().GetMostRecentObjectVersion<GameCoreObject>();
                    float finalDamage = DamageHelper.DamageByAttributes(
                        m_towerStrength, m_towerClass, targetObj, dmg);

                    d.DealDamage(this, finalDamage, dist / m_attackSpread, null, true);

                    // Buff application targets players hit directly (support
                    // towers buff friendly units instead of damaging them).
                    GameCorePlayer player = targetObj as GameCorePlayer;
                    if (buffSettings != null && player != null && buffSettings.Length > 0)
                    {
                        foreach (BuffSetting setting in buffSettings)
                        {
                            setting.AddBuff(this, player, tower.upgradeBuffOverride);
                        }
                    }
                }
            }

            // Always broadcast, even with no damage dealt / dead tower.
            Events.projectileHitEvent.Invoke(this, hitEnemy);
        }

        // GetBuffSettings @0x4CD8A0 — every BuffSetting component on this
        // projectile's own viewer GameObject (null when there is no viewer).
        // (Ghidra labels the shared GetComponents body <ClipSettings>.)
        public BuffSetting[] GetBuffSettings()
        {
            GameObject viewer = handle.GetUnityObject();
            if (viewer == null)
            {
                return null;
            }
            return viewer.GetComponents<BuffSetting>();
        }
    }
}
