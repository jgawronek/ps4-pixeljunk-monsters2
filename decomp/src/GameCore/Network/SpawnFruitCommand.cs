// GameCore/Network/SpawnFruitCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Spawns a fruit at a spawner object (tree or the shop). The fruit definition
// (prefab + coin/gem cost) comes from the ClothingUnlockData global settings
// container by index. Cost is paid on demand (unless the ctor already paid it
// while the sim was paused — see ctor). The actual instantiation goes through
// the Q4 PickupManager view (CreateFruit), wrapped in Random.state
// save/restore so view-side randomness cannot perturb the sim RNG stream.
// When the spawner is the SHOP, the fruit is instantly handed to the buyer
// (fruitPickedUpEvent) and the shop UI refreshes for the local player.
// Logic from Ghidra decompilation (RVA 0x4DEDD0..0x4DF5A0).

using UnityEngine;

namespace GameCore.Network
{
    internal class SpawnFruitCommand : NetworkCommand // TypeDefIndex: 3016
    {
        private GameCoreHandle spawningObjectHandle;   // 0x10 (32-byte struct)
        private int fruitIndex;                        // 0x30
        private Vector3 positionOffset;                // 0x34
        private bool hasPaidCost;                      // 0x40

        // .ctor @0x4DEDD0
        // When the bridge's sim tick is not running yet (pre-game queues), the
        // cost is settled immediately in the ctor instead of at execute time.
        public SpawnFruitCommand(GameCorePlayer player, GameCoreHandle spawningObjectHandle,
                                 int fruitIndex, Vector3 posOffset)
        {
            this.spawningObjectHandle = spawningObjectHandle;
            this.fruitIndex = fruitIndex;
            positionOffset = posOffset;
            hasPaidCost = false;

            if (Q4.GameCoreBridge.Instance != null && !Q4.GameCoreBridge.Instance.gameCoreTickEnabled)
            {
                PayFruitCost(player);
            }
        }

        // PayFruitCost @0x4DEF70
        // Charges the definition's coin+gem cost from the player's bag when
        // affordable. A vanished spawner makes the fruit free (hasPaidCost is
        // forced true). Returns false (and leaves hasPaidCost false) when the
        // player cannot pay.
        private bool PayFruitCost(GameCorePlayer player)
        {
            // INFERRED element type: the spawner is a GameCoreTree or the
            // GameCoreShop; resolved through the base type (the binary's
            // shared-instantiation token does not name the concrete type).
            GameCoreObject spawner = spawningObjectHandle.GetMostRecentObjectVersion<GameCoreObject>();
            if (spawner == null)
            {
                hasPaidCost = true;
                return true;
            }

            Q4.ClothingUnlockDefinitions defs =
                Q4.GlobalSettingsContainer<Q4.ClothingUnlockData>.Instance.fruitDefinitions;
            Q4.ClothingUnlockDefinitions.FruitDefinition def = defs.GetDefinition(fruitIndex);

            GameCoreInventory inventory = GameCoreInventory.GetInventoryObject();
            if (player == null || inventory == null)
                return false;   // binary: exception path

            if (def.costCoin <= inventory.GetAvailableInventory(player.handle, GameCoreInventory.EInventoryType.Coin))
            {
                if (def.costGem <= inventory.GetAvailableInventory(player.handle, GameCoreInventory.EInventoryType.Gem))
                {
                    inventory.RemoveInventory(player.handle, GameCoreInventory.EInventoryType.Coin, def.costCoin, true);
                    inventory.RemoveInventory(player.handle, GameCoreInventory.EInventoryType.Gem, def.costGem, true);
                    hasPaidCost = true;
                    return true;
                }
            }
            return false;
        }

        // ExecuteCommand @0x4DF1E0 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreObject spawner = spawningObjectHandle.GetMostRecentObjectVersion<GameCoreObject>();
            if (spawner == null)
                return;

            // The spawner's view (tree/shop GameObject) — the decompiler's
            // GetUnityObject<Structure> label is a shared-generic artifact.
            Component spawnerView = spawner.GetUnityObject<Component>();

            Q4.ClothingUnlockDefinitions defs =
                Q4.GlobalSettingsContainer<Q4.ClothingUnlockData>.Instance.fruitDefinitions;
            Q4.ClothingUnlockDefinitions.FruitDefinition def = defs.GetDefinition(fruitIndex);

            if (!hasPaidCost)
            {
                if (!PayFruitCost(executingPlayerObject))
                    return;   // cannot afford — silently ignored sim-side
            }

            // HiddenFruitData is reused as the CreateFruit parameter bundle:
            // fruitPrefab from the definition, amount = 1, time = 1.
            Q4.PickupManager.HiddenFruitData fruitData = new Q4.PickupManager.HiddenFruitData();
            GameObject prefabObject = def.prefab;   // definition's fruit prefab GameObject
            if (prefabObject == null)
                return;   // binary: exception path

            // GetComponent labels in the decompilation are shared-generic
            // artifacts: the stored component is the Fruit behaviour and the
            // CreateFruit argument is the spawner's PickupMovement.
            fruitData.fruitPrefab = prefabObject.GetComponent<Q4.Fruit>();
            fruitData.amount = 1;
            fruitData.time = 1;

            Q4.PickupMovement movement = null;
            if (spawnerView != null)
                movement = spawnerView.gameObject.GetComponent<Q4.PickupMovement>();

            // Save the sim RNG state across the view-side creation (faithful —
            // CreateFruit consumes UnityEngine.Random and must not shift the
            // deterministic stream).
            Random.State rngState = Random.state;

            Vector3 spawnPos = spawner.position + positionOffset;
            Q4.StageHub stage = Q4.StageHub.GetCurrentStage();
            if (stage == null || stage.pickupManager == null)
                return;   // binary: exception path

            GameCoreFruit fruit = stage.pickupManager.CreateFruit(fruitData, spawnPos, movement);

            Random.state = rngState;

            // Shop purchases are handed to the buyer immediately.
            if (spawner is GameCoreShop)
            {
                Events.fruitPickedUpEvent.Invoke(executingPlayerObject, fruit);   // Events statics +0x100

                if (executingPlayerObject != null && executingPlayerObject.IsLocalPlayer())
                {
                    Q4.UI.ShopMainController shop = Q4.UI.ShopMainController.Instance;
                    if (shop == null)
                        return;   // binary: exception path
                    if (shop.isShowing)
                    {
                        Random.State uiRngState = Random.state;
                        shop.RefreshShopBoards();
                        Random.state = uiRngState;
                    }
                }
            }
        }
    }
}
