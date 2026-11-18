// src/core/network/SpawnFruitCommand.ts
// TypeScript port of decomp/src/GameCore/Network/SpawnFruitCommand.cs
// (TypeDefIndex 3016, RVA 0x4DEDD0..0x4DF5A0). Spawns a fruit at a spawner
// object (tree or the shop). The fruit definition (prefab + coin/gem cost)
// comes from the ClothingUnlockData global settings container by index. Cost
// is paid on demand (unless the ctor already paid it while the sim was
// paused — see ctor). The actual instantiation goes through the Q4
// PickupManager view (createFruit), wrapped in unityRandom.state
// save/restore so view-side randomness cannot perturb the sim RNG stream.
// When the spawner is the SHOP, the fruit is instantly handed to the buyer
// (fruitPickedUpEvent) and the shop UI refreshes for the local player.

import { unityRandom, type RandomState } from '../../engine/rng/UnityRandom';
import { Vector3 } from '../../engine/math/Vector3';
import { Events } from '../Events';
import type { GameCoreFruit } from '../GameCoreFruit';
import type { GameCoreHandle } from '../GameCoreHandle';
import { EInventoryType, GameCoreInventory } from '../GameCoreInventory';
import type { GameCoreObject } from '../GameCoreObject';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreShop } from '../GameCoreShop';
import {
  getFruitDefinitions,
  getShopMainController,
  getStageHubCurrentStage,
  getGameCoreTickEnabled,
  type FruitDefinitionContract,
  type HiddenFruitData,
  type PickupMovementContract,
} from '../../view/q4-contracts';
import { NetworkCommand } from './NetworkCommand';

/** C#: the spawner's view Component — the shared-generic artifact in the
 *  decompilation is the tree/shop GameObject; only its PickupMovement is
 *  read (spawnerView.gameObject.GetComponent<Q4.PickupMovement>()). */
interface FruitSpawnerViewContract {
  getComponentPickupMovement(): PickupMovementContract | null;
}

export class SpawnFruitCommand extends NetworkCommand {
  private spawningObjectHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private fruitIndex: number; // 0x30
  private positionOffset: Vector3; // 0x34
  private hasPaidCost: boolean; // 0x40

  // .ctor @0x4DEDD0
  // When the bridge's sim tick is not running yet (pre-game queues), the
  // cost is settled immediately in the ctor instead of at execute time.
  constructor(
    player: GameCorePlayer | null,
    spawningObjectHandle: GameCoreHandle,
    fruitIndex: number,
    posOffset: Vector3,
  ) {
    super();
    this.spawningObjectHandle = spawningObjectHandle;
    this.fruitIndex = fruitIndex | 0;
    this.positionOffset = posOffset;
    this.hasPaidCost = false;

    // C#: GameCoreBridge.Instance != null && !Instance.gameCoreTickEnabled.
    // TS ADAPTATION: the provider defaults to `true` (ticking) headless, so
    // the ctor never pays unless the driver says the tick is paused — the
    // Instance-null branch folds into that default.
    if (!getGameCoreTickEnabled()) {
      this.payFruitCost(player);
    }
  }

  // PayFruitCost @0x4DEF70
  // Charges the definition's coin+gem cost from the player's bag when
  // affordable. A vanished spawner makes the fruit free (hasPaidCost is
  // forced true). Returns false (and leaves hasPaidCost false) when the
  // player cannot pay.
  private payFruitCost(player: GameCorePlayer | null): boolean {
    // INFERRED element type: the spawner is a GameCoreTree or the
    // GameCoreShop; resolved through the base type (the binary's
    // shared-instantiation token does not name the concrete type).
    const spawner = this.spawningObjectHandle.getMostRecentObjectVersion<GameCoreObject>();
    if (spawner === null) {
      this.hasPaidCost = true;
      return true;
    }

    // FAITHFUL: null provider → natural TypeError (C# NRE on the missing
    // globalsettings singleton).
    const def = getFruitDefinitions()!.getDefinition(this.fruitIndex);

    const inventory = GameCoreInventory.getInventoryObject();
    if (player === null || inventory === null) return false; // binary: exception path

    if (def.costCoin <= inventory.getAvailableInventory(player.handle, EInventoryType.Coin)) {
      if (def.costGem <= inventory.getAvailableInventory(player.handle, EInventoryType.Gem)) {
        inventory.removeInventory(player.handle, EInventoryType.Coin, def.costCoin, true);
        inventory.removeInventory(player.handle, EInventoryType.Gem, def.costGem, true);
        this.hasPaidCost = true;
        return true;
      }
    }
    return false;
  }

  // ExecuteCommand @0x4DF1E0 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    const spawner = this.spawningObjectHandle.getMostRecentObjectVersion<GameCoreObject>();
    if (spawner === null) return;

    // The spawner's view (tree/shop GameObject).
    const spawnerView = spawner.getUnityObjectAs<FruitSpawnerViewContract>();

    const def: FruitDefinitionContract = getFruitDefinitions()!.getDefinition(this.fruitIndex);

    if (!this.hasPaidCost) {
      if (!this.payFruitCost(executingPlayerObject)) return; // cannot afford — silently ignored sim-side
    }

    // HiddenFruitData is reused as the CreateFruit parameter bundle:
    // fruitPrefab from the definition, amount = 1, time = 1.
    const prefabObject = def.fruitPrefab;
    if (prefabObject === null) return; // binary: exception path

    // C#: fruitData.fruitPrefab = prefabObject.GetComponent<Q4.Fruit>() —
    // the definition provider hands over the Fruit component directly.
    const fruitData: HiddenFruitData = { fruitPrefab: prefabObject, amount: 1, time: 1 };

    let movement: PickupMovementContract | null = null;
    if (spawnerView !== null) movement = spawnerView.getComponentPickupMovement();

    // Save the sim RNG state across the view-side creation (faithful —
    // CreateFruit consumes UnityEngine.Random and must not shift the
    // deterministic stream).
    const rngState: RandomState = unityRandom.state;

    const spawnPos = spawner.position.add(this.positionOffset); // C#: spawner.position + positionOffset
    const stage = getStageHubCurrentStage();
    if (stage === null || stage.pickupManager === null || stage.pickupManager.createFruit === undefined) {
      return; // binary: exception path
    }

    const fruit = stage.pickupManager.createFruit(fruitData, spawnPos, movement) as GameCoreFruit;

    unityRandom.state = rngState;

    // Shop purchases are handed to the buyer immediately.
    if (spawner instanceof GameCoreShop) {
      Events.fruitPickedUpEvent.invoke(executingPlayerObject as GameCorePlayer, fruit); // +0x100 (C# passes possibly-null through)

      if (executingPlayerObject !== null && executingPlayerObject.isLocalPlayer()) {
        const shop = getShopMainController();
        if (shop === null) return; // binary: exception path
        if (shop.isShowing) {
          const uiRngState: RandomState = unityRandom.state;
          shop.refreshShopBoards();
          unityRandom.state = uiRngState;
        }
      }
    }
  }
}
