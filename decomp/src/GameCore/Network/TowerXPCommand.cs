// GameCore/Network/TowerXPCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Grants EXP to a tower on behalf of a player (the dance/tikiman EXP funnel:
// the view detects a dancing player and feeds the nearby tower).
// Logic from Ghidra decompilation (RVA 0x4DF840..0x4DF8D0).

using UnityEngine;

namespace GameCore.Network
{
    internal class TowerXPCommand : NetworkCommand // TypeDefIndex: 3017
    {
        private GameCoreHandle m_TowerHandle;   // 0x10 (32-byte struct)
        private float a_XP;                     // 0x30

        // .ctor @0x4DF840
        public TowerXPCommand(GameCoreHandle a_towerHandle, float a_xp)
        {
            m_TowerHandle = a_towerHandle;
            a_XP = a_xp;
        }

        // ExecuteCommand @0x4DF870 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower tower = m_TowerHandle.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower == null)
                return;
            tower.GrantEXP(a_XP, executingPlayerObject);
        }
    }
}
