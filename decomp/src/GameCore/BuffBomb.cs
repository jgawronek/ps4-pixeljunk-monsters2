// GameCore/BuffBomb.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Logic: GameCore.BuffBomb methods @0x93D260..0x93D510 (Ghidra pseudocode
// cross-checked against raw disassembly for the DealDamage argument setup).
//
// Explosion buff: applied to enemies in a bomb's blast radius. The effect is
// immediate damage scaled by distance-to-center and by strength/class damage
// tables. Duration is effectively zero (executes once, then expires).

namespace GameCore
{
    public class BuffBomb : Buff
    {
        private float m_power = 1.0f;                   // 0x90 (initializer runs before base ctor)
        private float m_distanceToCenter;               // 0x94
        private Q4.EEnemyStrengthTypeDef m_strengthType;   // 0x98
        private Q4.EEnemyClassTypeDef m_classType;         // 0x9C

        // .ctor @0x93D260
        public BuffBomb(float duration, Q4.BuffSettingBomb setting, float distanceToCenter)
            : base(duration)
        {
            m_distanceToCenter = distanceToCenter;
            if (setting != null)   // UnityEngine.Object implicit-bool (fake-null) check
            {
                m_power = setting.attackPower;          // setting +0x3C
                m_strengthType = setting.strengthType;  // setting +0x40
                m_classType = setting.classType;        // setting +0x44
            }
        }

        // ExecuteBuff @0x93D3B0 (virtual slot 10)
        // Confirmed damage formula and argument order from disassembly:
        //   m_power = DamageRateByClass * (DamageRateByStrength * m_power)
        //   enemy.DealDamage(strength, class, m_power, distanceToCenter, this, null, false)
        // Note: the scaled power is written back into m_power (faithful to binary).
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
            GameCoreEnemy enemy = target as GameCoreEnemy;
            if (enemy != null && !enemy.IsDestroyed())
            {
                float rate = DamageHelper.DamageRateByStrength(m_strengthType, enemy) * m_power;
                m_power = DamageHelper.DamageRateByClass(m_classType, enemy) * rate;
                enemy.DealDamage(m_strengthType, m_classType, m_power, m_distanceToCenter,
                                 this, null, immediateDestroy: false);
            }
        }

        // OnExitBuff @0x93D510 (virtual slot 11) — just the base behaviour
        // (removeBuffEvent + StopSFX).
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);
        }
    }
}
