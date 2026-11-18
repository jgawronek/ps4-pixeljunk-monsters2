// GameCore/BuffFastPlayer.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffFastPlayer methods @0x93DF60..0x93E350.
//
// Speed boost: raises the target's speed scale (enemy/player value chosen from
// the setting). Unlike slow/freeze, it only applies while the target's current
// scale is <= the boost (fastest effect wins), and restores 1.0 on exit.

namespace GameCore
{
    public class BuffFastPlayer : Buff
    {
        private float m_speedScale = 1.5f;   // 0x90 (pre-base initializer)
        private float m_duration = 0.5f;     // 0x94 (pre-base initializer)
        private bool m_isContinuous;         // 0x98

        // .ctor @0x93DF60
        public BuffFastPlayer(float duration, Q4.BuffSettingFastPlayer setting, GameCoreObject target)
            : base(duration)
        {
            bool isPlayer = target is GameCorePlayer;
            // Binary null-checks 'setting' (NullReferenceException if null).
            m_speedScale = isPlayer
                ? setting.playerSpeedScale   // setting +0x38
                : setting.enemySpeedScale;   // setting +0x34
            m_duration = duration;
            m_isContinuous = setting.isContinuous;   // setting +0x3C
            // TODO: confirm where m_duration/m_isContinuous are consumed — they are
            // stored but never read inside this class; presumably Q4.BuffSettingFastPlayer
            // uses them to re-apply the buff continuously while the player stays in range.
        }

        // ExecuteBuff @0x93E0D0 (virtual slot 10)
        protected internal override void ExecuteBuff(GameCoreObject target)
        {
            ISpeedScale speedScale = target as ISpeedScale;
            if (speedScale != null && !target.IsDestroyed())
            {
                if (speedScale.GetSpeedScale() <= m_speedScale)
                {
                    speedScale.SetSpeedScale(m_speedScale);
                }
            }
        }

        // OnExitBuff @0x93E250 (virtual slot 11)
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
