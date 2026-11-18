// GameCore/Network/SignCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player plants a map sign/ping (multiplayer communication feature that also
// works solo): pure event relay — signEvent carries (player handle, category,
// icon); the HUD view listens and renders the sign.
// Logic from Ghidra decompilation (RVA 0x4DECD0..0x4DED60).

using UnityEngine;

namespace GameCore.Network
{
    public class SignCommand : NetworkCommand // TypeDefIndex: 3015
    {
        private int m_categoryID;   // 0x10
        private int m_iconID;       // 0x14

        // .ctor @0x4DECD0
        public SignCommand(int cat, int icon)
        {
            m_categoryID = cat;
            m_iconID = icon;
        }

        // ExecuteCommand @0x4DED00 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            Events.signEvent.Invoke(executingPlayerObject.handle, m_categoryID, m_iconID);
        }
    }
}
