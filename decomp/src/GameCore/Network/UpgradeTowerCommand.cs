// GameCore/Network/UpgradeTowerCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player pays to upgrade a tower to the NEXT level: validates the requested
// level matches the next upgrade, tops the tower's EXP up to exactly the
// level's reachExp (GrantEXP performs the actual UpgradeTower), then charges
// the upgrade's coin+gem costs.
// Logic from Ghidra decompilation (RVA 0x4DF9D0..0x4DFB30).

using UnityEngine;

namespace GameCore.Network
{
    public class UpgradeTowerCommand : NetworkCommand // TypeDefIndex: 3019
    {
        private GameCoreHandle m_towerHandle;   // 0x10 (32-byte struct)
        private int m_upgradeLevel;             // 0x30

        // .ctor @0x4DF9D0
        public UpgradeTowerCommand(GameCoreHandle towerHandle, int upgradeLevel)
        {
            m_towerHandle = towerHandle;
            m_upgradeLevel = upgradeLevel;
        }

        // ExecuteCommand @0x4DFA00 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower tower = m_towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower == null)
                return;

            Q4.TowerUpgrade next = tower.GetNextUpgrade();
            if (next == null || m_upgradeLevel == 0 || m_upgradeLevel != next.level)
                return;

            // Top EXP up to exactly the requirement — GrantEXP triggers
            // UpgradeTower when currentEXP reaches next.reachExp.
            tower.GrantEXP((float)next.reachExp - tower.currentEXP, null);

            GameCoreInventory inventory = GameCoreInventory.GetInventoryObject();
            if (executingPlayerObject == null || inventory == null)
                return;   // binary: exception path

            GameCoreHandle playerHandle = executingPlayerObject.handle;
            inventory.RemoveInventory(playerHandle, GameCoreInventory.EInventoryType.Coin, next.costCoin, true);
            inventory = GameCoreInventory.GetInventoryObject();
            if (inventory == null)
                return;   // binary: exception path (re-fetched, faithful)
            inventory.RemoveInventory(playerHandle, GameCoreInventory.EInventoryType.Gem, next.costGem, true);
        }
    }
}
