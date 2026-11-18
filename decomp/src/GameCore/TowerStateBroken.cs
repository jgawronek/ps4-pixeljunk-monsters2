// GameCore/TowerStateBroken.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Gem-tower "broken/sunk" state. After a delay it pops the tower's gem
// (onGemTowerPopGem → the Q4 view spawns the collectible gem) and re-arms
// itself on Exit so the state can be re-entered cleanly.
// Logic from Ghidra decompilation (RVA 0x4E1DD0..0x4E1F90).
// Float constants CONFIRMED from ELF .rodata: DAT_00b7c4c0 = 10000.0 (re-entry
// duration), DAT_00b7c4c4 = 0.0.

using UnityEngine;

namespace GameCore
{
    public class TowerStateBroken : TowerState // TypeDefIndex: 3074
    {
        private float m_gemDropDelay;     // 0x20 — counts down; -1 once popped
        private int m_destroyDropGem;     // 0x24 — gems to drop on destroy

        // Re-arm duration literal DAT_00b7c4c0 = 10000.0f (ELF .rodata).
        private const float ReentryDuration = 10000.0f;
        private const float GemAlreadyDropped = -1.0f;   // literal 0xbf800000 in Tick

        // .ctor @0x4E1DD0
        public TowerStateBroken(float aDuration, float gemDropDelay, int gemToDrop)
            : base(aDuration)
        {
            m_gemDropDelay = gemDropDelay;
            m_destroyDropGem = gemToDrop;
        }

        // Exit @0x4E1E40 (virtual slot 6)
        // Replaces itself with a fresh Broken state (same delays) as the pending
        // command so repeated breaks re-run the drop timer.
        public override void Exit(TowerStateMachine owner)
        {
            owner.SetCurrentCommand(
                new TowerStateBroken(ReentryDuration, m_gemDropDelay, m_destroyDropGem), null);
        }

        // Tick @0x4E1F00 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            if (m_gemDropDelay > 0f)
            {
                m_gemDropDelay = Mathf.Max(m_gemDropDelay - dt, 0f);
                if (m_gemDropDelay == 0f)
                {
                    // Pop the gem(s): the view listens and spawns the pickup.
                    Events.onGemTowerPopGem.Invoke(GetTower(owner), m_destroyDropGem);   // Events statics +0x178
                    m_gemDropDelay = GemAlreadyDropped;   // never pop twice
                }
            }
            return true;
        }
    }
}
