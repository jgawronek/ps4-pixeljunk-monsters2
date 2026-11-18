// GameCore/BuffFreeze.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffFreeze methods @0x93E420..0x93ECF0. Ghidra pseudocode was
// cross-checked against raw disassembly: the damage call uses the *untyped*
// DealDamage overload with the source projectile as damageSource, and the two
// RemoveBuffs calls are <BuffSlow> then <BuffFreeze> (generic method-info slots
// 0x10D4BC8 / 0x10D4BD0 resolved via script.json).
//
// Freeze: slows the target (separate scales for enemies/players), extinguishes
// fire on enemies, and deals frost damage once per second while active. On exit
// it deals a final partial tick and restores speed scale to 1.

namespace GameCore
{
    public class BuffFreeze : Buff
    {
        private float m_powerPerSecond;      // 0x90
        private float m_speedScaleToEnemy = 0.5f;   // 0x94 (pre-base initializer)
        private float m_speedScaleToPlayer = 0.5f;  // 0x98 (pre-base initializer)
        private float m_timer;               // 0x9C

        // .ctor @0x93E420
        public BuffFreeze(float duration, float powerPerSec, float speedScaleEnm,
                          float speedScalePlayer, GameCoreHandle sourceHandle)
            : base(duration)
        {
            m_speedScaleToEnemy = speedScaleEnm;
            m_speedScaleToPlayer = speedScalePlayer;
            m_powerPerSecond = powerPerSec;
            m_sourceProjectile = sourceHandle;
            m_timer = 0.0f;
        }

        // ExecuteBuff @0x93E530 (virtual slot 10)
        // Re-applies the slow and the frost damage tick every 1 second.
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
            m_timer -= GameCore.TickDeltaTime;
            if (m_timer > 0.0f)
                return;

            ISpeedScale speedScale = target as ISpeedScale;
            IBuffs buffs = target as IBuffs;

            float scale;
            GameCoreEnemy enemy = target as GameCoreEnemy;
            if (enemy != null)
            {
                if (!enemy.IsDestroyed())
                {
                    enemy.IsOnFire = false;   // freeze extinguishes burn
                    if (m_powerPerSecond > 0.0f)
                    {
                        // Damage typing from the source tower (via projectile).
                        GameCoreHandle towerHandle = GameCoreHandle.nullHandle;
                        if (m_sourceProjectile != GameCoreHandle.nullHandle)
                        {
                            GameCoreProjectile proj =
                                m_sourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>();
                            if (proj != null)
                                towerHandle = proj.sourceTower;
                        }
                        Q4.EEnemyStrengthTypeDef strength = Q4.EEnemyStrengthTypeDef.Normal;
                        Q4.EEnemyClassTypeDef cls = Q4.EEnemyClassTypeDef.Normal;
                        if (!towerHandle.isNull)
                        {
                            GameCoreTower tower = towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
                            if (tower != null)
                            {
                                strength = tower.strengthType;   // tower +0x64
                                cls = tower.classType;           // tower +0x68
                            }
                        }

                        float damage = DamageHelper.DamageRateByClass(cls, enemy)
                                     * (DamageHelper.DamageRateByStrength(strength, enemy) * m_powerPerSecond);

                        // damageSource is the projectile itself (untyped overload).
                        GameCoreObject source = null;
                        if (m_sourceProjectile != GameCoreHandle.nullHandle)
                            source = m_sourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>();
                        enemy.DealDamage(source, damage, 0.0f, null, immediateDestroy: false);
                    }
                }
                scale = m_speedScaleToEnemy;
            }
            else
            {
                scale = m_speedScaleToPlayer;
            }

            if (speedScale != null)
            {
                // Only apply if this freeze is at least as strong as the current scale.
                if (scale <= speedScale.GetSpeedScale())
                {
                    // Freeze supersedes both slows and other freezes (except itself).
                    // NOTE: binary dereferences 'buffs' without a null check here
                    // (NullReferenceException if the target has no IBuffs).
                    BuffContainer container = buffs.Buffs;
                    if (container != null)
                    {
                        container.RemoveBuffs<BuffSlow>(target, this);
                        container.RemoveBuffs<BuffFreeze>(target, this);
                    }
                    speedScale.SetSpeedScale(scale);
                }
            }

            m_timer = 1.0f;
        }

        // OnExitBuff @0x93EA70 (virtual slot 11)
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);

            // Final partial damage tick for the fraction of the 1s interval elapsed.
            GameCoreEnemy enemy = target as GameCoreEnemy;
            if (enemy != null && !enemy.IsDestroyed())
            {
                float fraction = UnityEngine.Mathf.Clamp01(1.0f - m_timer);
                if (fraction > 0.0f && m_powerPerSecond > 0.0f)
                {
                    GameCoreObject source = null;
                    if (m_sourceProjectile != GameCoreHandle.nullHandle)
                        source = m_sourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>();
                    enemy.DealDamage(source, fraction * m_powerPerSecond, 0.0f, null,
                                     immediateDestroy: false);
                }
            }

            // Restore normal speed.
            ISpeedScale speedScale = target as ISpeedScale;
            if (speedScale != null && !target.IsDestroyed())
            {
                speedScale.SetSpeedScale(1.0f);
            }
        }
    }
}
