// GameCore/Network/BuildTowerCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player builds a tower on a tree: validates the tree is unclaimed, looks the
// tower prefab up by name in the Q4 tower database, enforces singleton towers,
// checks coin+gem affordability against the player's inventory bag, converts
// the tree (TowerHelper.FromTreeToTower), broadcasts the build event and
// charges the costs.
// Logic from Ghidra decompilation (RVA 0x4D5CF0..0x4D6160).

using UnityEngine;

namespace GameCore.Network
{
    internal class BuildTowerCommand : NetworkCommand // TypeDefIndex: 2997
    {
        private GameCoreHandle treeHandle;   // 0x10 (32-byte struct)
        private string towerType;            // 0x30 (prefab name — network-safe)

        // .ctor @0x4D5CF0
        public BuildTowerCommand(GameCoreHandle treeHandle, Q4.TowerBase towerPrefab)
        {
            this.treeHandle = treeHandle;
            towerType = towerPrefab.name;   // binary NREs on null prefab
        }

        // ExecuteCommand @0x4D5D30 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTree tree = treeHandle.GetMostRecentObjectVersion<GameCoreTree>();
            // Tree gone or already claimed (referenceCount != 0 = !IsTreeValid).
            if (tree == null || !tree.IsTreeValid())
                return;

            Q4.TowerBase prefab = Q4.DatabaseManager.TowerDatabase.GetData(towerType);
            if (prefab == null)
            {
                Debug.LogError("No tower found of type " + towerType);
                return;
            }

            // Singleton towers (e.g. the gate keeper) may exist only once per scene.
            if (prefab.singletonInScene && GameObject.Find(prefab.name) != null)
                return;

            GameCoreInventory inventory = GameCoreInventory.GetInventoryObject();
            if (executingPlayerObject == null)
                return;   // binary: exception path
            if (inventory == null)
                return;   // binary: exception path

            // Affordability: the binary reads the player's bag coins (0x20) and
            // gems (0x24) directly; HasInventory is the landed equivalent guard.
            GameCoreHandle playerHandle = executingPlayerObject.handle;
            if (!inventory.HasInventory(playerHandle, GameCoreInventory.EInventoryType.Coin, prefab.costCoin))
                return;
            if (!inventory.HasInventory(playerHandle, GameCoreInventory.EInventoryType.Gem, prefab.costGem))
                return;

            GameCoreTower tower = TowerHelper.FromTreeToTower(tree, prefab);

            Events.towerBuildEvent.Invoke(tower, tree, executingPlayerObject);   // Events statics +0xB0

            inventory.RemoveInventory(playerHandle, GameCoreInventory.EInventoryType.Coin, prefab.costCoin, true);
            inventory.RemoveInventory(playerHandle, GameCoreInventory.EInventoryType.Gem, prefab.costGem, true);
        }
    }
}
