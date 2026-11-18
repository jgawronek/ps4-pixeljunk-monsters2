// GameCore/BuffBurn.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffBurn methods @0x93D520..0x93D8C0 (pseudocode cross-checked
// against raw disassembly for the damage formula and DealDamage arguments).
//
// Burn DoT: every m_timerFrequency seconds deals powerPerSecond*frequency damage
// (i.e. power-per-second integrated over the tick interval). Damage is typed by
// the source tower (resolved via the source projectile); while the enemy is
// already on fire the tick deals 0 damage.

namespace GameCore
{
    public class BuffBurn : Buff
    {
        private float m_powerPerSecond;   // 0x90
        private float m_timer;            // 0x94
        private float m_timerFrequency;   // 0x98

        // .ctor @0x93D520
        public BuffBurn(float duration, float powerPerSec, GameCoreHandle sourceHandle, float frequency)
            : base(duration)
        {
            m_sourceProjectile = sourceHandle;
            m_powerPerSecond = powerPerSec;
            m_timerFrequency = frequency;
            m_timer = 0.0f;
        }

        // ExecuteBuff @0x93D610 (virtual slot 10)
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
            // Resolve the source tower for damage typing:
            //   projectile = m_sourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>()
            //   towerHandle = projectile != null ? projectile.sourceTower : nullHandle
            //   tower = towerHandle != nullHandle ? towerHandle.GetMostRecentObjectVersion<GameCoreTower>() : null
            // (generic contexts confirmed via script.json: 0x10D4B50 / 0x10D4B58)
            GameCoreProjectile projectile =
                m_sourceProjectile.GetMostRecentObjectVersion<GameCoreProjectile>();
            GameCoreHandle towerHandle = projectile != null
                ? projectile.sourceTower
                : GameCoreHandle.nullHandle;
            GameCoreTower tower = towerHandle != GameCoreHandle.nullHandle
                ? towerHandle.GetMostRecentObjectVersion<GameCoreTower>()
                : null;

            m_timer -= GameCore.TickDeltaTime;
            if (m_timer <= 0.0f)
            {
                GameCoreEnemy enemy = target as GameCoreEnemy;
                if (enemy != null && !enemy.IsDestroyed())
                {
                    // Already-on-fire enemies take no additional burn tick damage.
                    float damage = enemy.IsOnFire ? 0.0f : m_powerPerSecond;
                    damage *= m_timerFrequency;

                    // No source tower → both damage types default to Normal (1).
                    Q4.EEnemyStrengthTypeDef strength = tower != null
                        ? tower.strengthType : Q4.EEnemyStrengthTypeDef.Normal;
                    Q4.EEnemyClassTypeDef cls = tower != null
                        ? tower.classType : Q4.EEnemyClassTypeDef.Normal;

                    damage = DamageHelper.DamageRateByClass(cls, enemy)
                           * (DamageHelper.DamageRateByStrength(strength, enemy) * damage);

                    enemy.DealDamage(strength, cls, damage, 0.0f,
                                     this, null, immediateDestroy: false);
                }
                m_timer = m_timerFrequency;
            }
        }

        // OnExitBuff @0x93D8C0 (virtual slot 11) — base behaviour only.
        // (IsOnFire is cleared by BuffFreeze, not here.)
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);
        }
    }
}
