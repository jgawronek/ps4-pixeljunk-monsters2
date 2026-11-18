// GameCore/BuffSlow.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffSlow methods @0x93ECF0..0x93F140. The single RemoveBuffs
// call uses generic method-info slot 0x10D4BC8 = RemoveBuffs<BuffSlow>
// (resolved via script.json; same slot used by BuffFreeze's first call).
//
// Slow: reduces the target's speed scale (enemy/player value chosen from the
// setting at construction). Only applies while it is at least as strong as the
// target's current scale; replaces other slows on application.

namespace GameCore
{
    public class BuffSlow : Buff
    {
        private float m_speedScale;   // 0x90

        // .ctor @0x93ECF0
        public BuffSlow(float duration, Q4.BuffSettingSlow setting, GameCoreObject target)
            : base(duration)
        {
            bool isPlayer = target is GameCorePlayer;
            // Binary null-checks 'setting' (NullReferenceException if null).
            m_speedScale = isPlayer
                ? setting.playerSpeedScale   // setting +0x38
                : setting.enemySpeedScale;   // setting +0x34
        }

        // ExecuteBuff @0x93EE40 (virtual slot 10)
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
            ISpeedScale speedScale = target as ISpeedScale;
            if (speedScale != null && !target.IsDestroyed())
            {
                if (m_speedScale <= speedScale.GetSpeedScale())
                {
                    IBuffs buffs = target as IBuffs;
                    if (buffs != null)
                    {
                        BuffContainer container = buffs.Buffs;
                        if (container != null)
                        {
                            container.RemoveBuffs<BuffSlow>(target, this);
                        }
                    }
                    speedScale.SetSpeedScale(m_speedScale);
                }
            }
        }

        // OnExitBuff @0x93F040 (virtual slot 11)
        public override void OnExitBuff(GameCoreObject target)
        {
            base.OnExitBuff(target);
            ISpeedScale speedScale = target as ISpeedScale;
            if (speedScale != null && !target.IsDestroyed())
            {
                speedScale.SetSpeedScale(1.0f);
            }
        }
    }
}
