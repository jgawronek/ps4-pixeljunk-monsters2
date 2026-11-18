// GameCore/BuffContainer.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.BuffContainer methods @0x93D8D0..0x93DF60 plus the generic
// shared bodies RemoveBuffs<T> @0x33F390 and Contains<T> @0x354580.
// Generic instantiations confirmed from metadata: Contains<BuffFastPlayer>,
// RemoveBuffs<BuffSlow>, RemoveBuffs<BuffFreeze>.
//
// Stores buffs as GameCoreHandles (buffs are pooled GameCoreObjects that survive
// frame copies). Owned by GameCoreEnemy/GameCorePlayer via IBuffs; ticked from
// their Tick().

using System;
using System.Collections.Generic;

namespace GameCore
{
    public class BuffContainer
    {
        private List<GameCoreHandle> m_buffs;   // 0x10

        // .ctor @0x93D8D0
        public BuffContainer()
        {
            m_buffs = new List<GameCoreHandle>();
        }

        // Initialize @0x93D930 — confirmed empty body.
        public void Initialize()
        {
        }

        // Terminate @0x93D940
        // Exits every buff on the target, then clears the list.
        public void Terminate(GameCoreObject target)
        {
            if (m_buffs != null)
            {
                foreach (GameCoreHandle handle in m_buffs)
                {
                    Buff buff = handle.GetMostRecentObjectVersion<Buff>();
                    if (buff != null)
                    {
                        buff.OnExitBuff(target);
                    }
                }
                m_buffs.Clear();
            }
        }

        // RemoveAllbuffs @0x93D950 — identical body to Terminate (confirmed:
        // both methods iterate + OnExitBuff + Clear).
        public void RemoveAllbuffs(GameCoreObject target)
        {
            if (m_buffs != null)
            {
                foreach (GameCoreHandle handle in m_buffs)
                {
                    Buff buff = handle.GetMostRecentObjectVersion<Buff>();
                    if (buff != null)
                    {
                        buff.OnExitBuff(target);
                    }
                }
                m_buffs.Clear();
            }
        }

        // AddBuff @0x93DB20
        public void AddBuff(Buff buff, GameCoreObject target)
        {
            // Binary null-checks buff and m_buffs (NullReferenceException).
            buff.OnEnterBuff(target);          // virtual slot 9
            m_buffs.Add(buff.handle);
        }

        // GetAllBuffs @0x93DBE0
        // Resolves every handle against the current frame; null entries (buffs
        // already gone) are kept in the result, faithful to the binary.
        public List<Buff> GetAllBuffs()
        {
            List<Buff> result = new List<Buff>(m_buffs.Count);
            foreach (GameCoreHandle handle in m_buffs)
            {
                result.Add(handle.GetMostRecentObjectVersion<Buff>());
            }
            return result;
        }

        // Contains<T> @0x354580 (generic shared; instantiated for BuffFastPlayer)
        public bool Contains<T>()
        {
            foreach (Buff buff in GetAllBuffs())
            {
                if (buff is T)
                    return true;
            }
            return false;
        }

        // RemoveBuffs<T> @0x33F390 (generic shared; instantiated for BuffSlow/BuffFreeze)
        // Removes all buffs of exactly type T (GetType comparison, not 'is'),
        // calling OnExitBuff on each, except the given exception buff.
        public void RemoveBuffs<T>(GameCoreObject target, Buff exception)
        {
            int i = 0;
            while (i < m_buffs.Count)
            {
                // Skip the exception buff (binary dereferences exception.handle
                // without a null check — callers always pass 'this').
                if (m_buffs[i] == exception.handle)
                {
                    i++;
                    continue;
                }
                Buff buff = m_buffs[i].GetMostRecentObjectVersion<Buff>();
                if (buff.GetType() == typeof(T))
                {
                    buff.OnExitBuff(target);   // virtual slot 11
                    m_buffs.RemoveAt(i);       // do not advance: list shifted
                }
                else
                {
                    i++;
                }
            }
        }

        // Tick @0x93DD90
        // Drives all buffs on the target for one sim tick:
        //  - unresolved handle → drop it
        //  - expired (m_timeRemain < 0) → OnExitBuff + drop
        //  - otherwise → ExecuteBuff, then count down m_timeRemain by dt
        // NOTE: the binary reads/writes Buff.m_timeRemain and calls the protected
        // ExecuteBuff directly (vtable slot 10 @0x93DEEC); see the accessibility
        // notes in Buff.cs. The index is incremented BEFORE ExecuteBuff, which
        // matters because ExecuteBuff may remove other buffs from this list.
        public void Tick(GameCoreObject target)
        {
            float dt = GameCore.TickDeltaTime;
            if (m_buffs == null || m_buffs.Count < 1)
                return;

            int i = 0;
            while (i < m_buffs.Count)
            {
                Buff buff = m_buffs[i].GetMostRecentObjectVersion<Buff>();
                if (buff == null)
                {
                    m_buffs.RemoveAt(i);
                    continue;
                }
                if (buff.m_timeRemain < 0.0f)
                {
                    buff.OnExitBuff(target);
                    m_buffs.RemoveAt(i);
                    continue;
                }
                i++;
                buff.ExecuteBuff(target);
                buff.m_timeRemain -= dt;
            }
        }
    }
}
