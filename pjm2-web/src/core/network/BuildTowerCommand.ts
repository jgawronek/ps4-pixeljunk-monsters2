// src/core/network/BuildTowerCommand.ts
// TypeScript port of decomp/src/GameCore/Network/BuildTowerCommand.cs
// (TypeDefIndex 2997, RVA 0x4D5CF0..0x4D6160). Player builds a tower on a
// tree: validates the tree is unclaimed, looks the tower prefab up by name in
// the Q4 tower database, enforces singleton towers, checks coin+gem
// affordability against the player's inventory bag, converts the tree
// (TowerHelper.fromTreeToTower), broadcasts the build event and charges the
// costs.

import { Events } from '../Events';
import type { GameCoreHandle } from '../GameCoreHandle';
import { EInventoryType, GameCoreInventory } from '../GameCoreInventory';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTree } from '../GameCoreTree';
import { GameCoreTower } from '../GameCoreTower';
import { TowerHelper } from '../TowerHelper';
import {
  findViewObjectByName,
  getTowerPrefabByName,
  type TowerBaseContract,
} from '../../view/q4-contracts';
import { NetworkCommand } from './NetworkCommand';

export class BuildTowerCommand extends NetworkCommand {
  private treeHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private towerType: string; // 0x30 (prefab name — network-safe)

  // .ctor @0x4D5CF0
  // FAITHFUL: binary NREs on null prefab (the .name read throws naturally).
  constructor(treeHandle: GameCoreHandle, towerPrefab: TowerBaseContract) {
    super();
    this.treeHandle = treeHandle;
    this.towerType = towerPrefab.name;
  }

  // ExecuteCommand @0x4D5D30 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    const tree = this.treeHandle.getMostRecentObjectVersion<GameCoreTree>();
    // Tree gone or already claimed (referenceCount != 0 = !isTreeValid).
    if (tree === null || !tree.isTreeValid()) return;

    const prefab = getTowerPrefabByName(this.towerType);
    if (prefab === null) {
      console.error('No tower found of type ' + this.towerType); // C#: Debug.LogError
      return;
    }

    // Singleton towers (e.g. the gate keeper) may exist only once per scene.
    if (prefab.singletonInScene === true && findViewObjectByName(prefab.name) !== null) return;

    const inventory = GameCoreInventory.getInventoryObject();
    if (executingPlayerObject === null) return; // binary: exception path
    if (inventory === null) return; // binary: exception path

    // Affordability: the binary reads the player's bag coins (0x20) and gems
    // (0x24) directly; hasInventory is the landed equivalent guard.
    const playerHandle = executingPlayerObject.handle;
    if (!inventory.hasInventory(playerHandle, EInventoryType.Coin, prefab.costCoin)) return;
    if (!inventory.hasInventory(playerHandle, EInventoryType.Gem, prefab.costGem)) return;

    const tower = TowerHelper.fromTreeToTower(tree, prefab);

    // FAITHFUL: the event fires with the helper's result even when the
    // conversion found no valid build site (C# does not null-check here).
    Events.towerBuildEvent.invoke(tower as GameCoreTower, tree, executingPlayerObject); // +0xB0

    inventory.removeInventory(playerHandle, EInventoryType.Coin, prefab.costCoin, true);
    inventory.removeInventory(playerHandle, EInventoryType.Gem, prefab.costGem, true);
  }
}
