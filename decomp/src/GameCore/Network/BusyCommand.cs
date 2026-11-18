// GameCore/Network/BusyCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Sets/clears the player's "busy" flag broadcast (UI/menus use it to lock
// input while dialogs or the shop ring are open). Pure event: the sim stores
// nothing — busyEvent carries (player handle, isBusy).
// Logic from Ghidra decompilation (RVA 0x4D6780..0x4D6800).

using UnityEngine;

namespace GameCore.Network
{
    public class BusyCommand : NetworkCommand // TypeDefIndex: 2998
    {
        private bool m_isBusy;   // 0x10

        // .ctor @0x4D6780
        public BusyCommand(bool isBusy)
        {
            m_isBusy = isBusy;
        }

        // ExecuteCommand @0x4D67A0 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            if (executingPlayerObject == null)
                return;   // binary: exception path
            Events.busyEvent.Invoke(executingPlayerObject.handle, m_isBusy);   // Events statics +0x1A8
        }
    }
}
