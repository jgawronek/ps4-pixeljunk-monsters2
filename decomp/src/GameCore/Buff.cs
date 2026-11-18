// GameCore/Buff.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Base class for all timed buffs applied to a GameCoreObject (enemy/player).
// Field offsets from global-metadata.dat; logic from Ghidra decompilation of
// GameCore.Buff methods (RVA 0x93CE50..0x93D120).

namespace GameCore
{
    public abstract class Buff : GameCoreObject
    {
        // INFERRED accessibility: metadata says 'private', but BuffContainer.Tick
        // reads/writes this field directly (confirmed @0x93DE87/0x93DEF2..0x93DEFE),
        // so the original source must have allowed same-assembly access (internal).
        internal float m_timeRemain;                // 0x60
        protected UnityEngine.AudioSource m_sound;  // 0x68
        protected GameCoreHandle m_sourceProjectile;// 0x70

        public GameCoreHandle SourceProjectile
        {
            get { return m_sourceProjectile; }      // get_SourceProjectile @0x93CF10
        }

        // .ctor @0x93CE50
        public Buff(float duration)
            : base()
        {
            m_sourceProjectile = GameCoreHandle.nullHandle;
            m_timeRemain = duration;
        }

        // ResetTimer @0x93CF00
        public void ResetTimer(float duration)
        {
            m_timeRemain = duration;
        }

        // UpdateBuff @0x93CF20
        // While the buff is still valid, run its effect on the target, then
        // count down the remaining time by dt.
        public void UpdateBuff(GameCoreObject target, float dt)
        {
            if (m_timeRemain >= 0.0f)
            {
                ExecuteBuff(target);                // virtual slot 10
            }
            m_timeRemain -= dt;
        }

        // UpdateTime @0x93CF90
        private void UpdateTime(float dt)
        {
            m_timeRemain -= dt;
        }

        // Valid @0x93CF70
        public bool Valid()
        {
            return m_timeRemain >= 0.0f;
        }

        // OnEnterBuff @0x93CFA0 (virtual slot 9) — base is a no-op.
        public virtual void OnEnterBuff(GameCoreObject target)
        {
        }

        // ExecuteBuff (abstract slot 10) — implemented by each concrete buff.
        // INFERRED accessibility: metadata says 'protected', but BuffContainer.Tick
        // invokes it directly through the vtable (slot 10 @0x93DEEC), which requires
        // same-assembly access in the original source (protected internal).
        protected internal abstract void ExecuteBuff(GameCoreObject target);

        // OnExitBuff @0x93CFB0 (virtual slot 11)
        // Raises the buff-exit event to the presentation layer, then stops SFX.
        // Confirmed: Events statics +0x158 = removeBuffEvent
        // (Events.RemoveBuffEvent : CoreEvent<GameCoreObject, System.Type>).
        public virtual void OnExitBuff(GameCoreObject target)
        {
            Events.removeBuffEvent.Invoke(target, this.GetType());
            StopSFX();
        }

        // StopSFX @0x93D060
        protected void StopSFX()
        {
            if (m_sound != null)
            {
                Q4.MonstersAudio.Instance.StopSFX(m_sound);
                m_sound = null;
            }
        }

        // PlaySFX @0x93D120
        // Confirmed from decompilation: if a sound is already playing, only move
        // it to the new position; otherwise start a monitored SFX and keep the
        // returned AudioSource.
        protected void PlaySFX(UnityEngine.AudioClip a_clip, UnityEngine.Vector3 a_pos)
        {
            if (a_clip == null)
                return;
            if (m_sound != null)
            {
                m_sound.transform.position = a_pos;
            }
            else
            {
                m_sound = Q4.MonstersAudio.Instance.PlaySFXMonitored(a_clip, a_pos, m_sound);
            }
        }
    }
}