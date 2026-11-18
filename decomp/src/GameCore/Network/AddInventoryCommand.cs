// GameCore/Network/AddInventoryCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Credits currency to a player's inventory bag (used by the view layer for
// gem pickups/refunds — coins are credited by the sim pickup path itself).
// Guarded on the target player still existing.
// Logic from Ghidra decompilation (RVA 0x4D55B0..0x4D5660).

using UnityEngine;

namespace GameCore.Network
{
    public class AddInventoryCommand : NetworkCommand // TypeDefIndex: 2995
    {
        private GameCoreInventory.EInventoryType m_pickupType;   // 0x10
        private GameCoreHandle m_playerHandle;                   // 0x18 (32-byte struct)
        private int m_value;                                     // 0x38

        // .ctor @0x4D55B0
        public AddInventoryCommand(GameCoreHandle aPlayer, int value,
                                   GameCoreInventory.EInventoryType pickupType)
        {
            m_pickupType = pickupType;
            m_playerHandle = aPlayer;
            m_value = value;
        }

        // ExecuteCommand @0x4D5600 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCorePlayer player = m_playerHandle.GetMostRecentObjectVersion<GameCorePlayer>();
            if (player == null)
                return;
            GameCoreInventory inventory = GameCoreInventory.GetInventoryObject();
            if (inventory == null)
                return;   // binary: exception path
            inventory.AddInventory(m_playerHandle, m_pickupType, m_value);
        }
    }
}
