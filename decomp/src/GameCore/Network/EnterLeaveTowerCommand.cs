// GameCore/Network/EnterLeaveTowerCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player enters or leaves a tower's manual-aim seat. Guarded both ways:
// cannot leave an empty seat, cannot enter an occupied one. Writes the
// tower's m_playerInside slot (via the tower's PlayerEnter/PlayerExitTower
// methods — the binary writes the private field directly).
// Logic from Ghidra decompilation (RVA 0x4D9840..0x4D99C0).

using UnityEngine;

namespace GameCore.Network
{
    public class EnterLeaveTowerCommand : NetworkCommand // TypeDefIndex: 3008
    {
        private bool isEntering;              // 0x10
        private GameCoreHandle player;        // 0x18 (32-byte struct)
        private GameCoreHandle tower;         // 0x38 (32-byte struct)

        // .ctor @0x4D9840
        public EnterLeaveTowerCommand(GameCoreHandle aPlayer, GameCoreHandle aTower, bool enter)
        {
            isEntering = enter;
            player = aPlayer;
            tower = aTower;
        }

        // ExecuteCommand @0x4D9880 (virtual slot 4)
        // NOTE: uses the command's stored player handle, NOT the executing
        // player argument (the binary ignores it entirely).
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower t = tower.GetMostRecentObjectVersion<GameCoreTower>();
            if (t == null)
                return;

            if (!isEntering)
            {
                if (!t.HasPlayerInTower())
                    return;   // nobody inside — nothing to leave
                t.PlayerExitTower();
            }
            else
            {
                if (t.HasPlayerInTower())
                    return;   // seat occupied — cannot enter
                t.PlayerEnterTower(player);
            }
        }
    }
}
