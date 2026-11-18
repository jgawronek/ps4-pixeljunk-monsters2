// src/core/GameCorePickupManager.ts
// TypeScript port of decomp/src/GameCore/GameCorePickupManager.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x4C0BA0..0x4C1280 — ctor
// verified: the base GameCoreObject ctor does all the work).
//
// Sim-side manager for timed hidden-fruit drops from fruit trees. The scene's
// Q4.PickupManager view holds the drop schedule (hiddenFruitData) and the tree
// handle list; this core object walks the schedule and asks the view to spawn
// the actual fruit. Currency drops from enemy deaths etc. are coordinated by
// the Q4 view (out of sim scope).
//
// TS ADAPTATIONS: view lookups → PickupManagerContract via the viewer
// resolver; Object.FindObjectOfType → findPickupManagerView() hook;
// StageHub.GetCurrentStage().pickupManager.CreateFruit → contract call
// (FAITHFUL unconditional dereferences kept as non-null assertions).

import {
  findPickupManagerView,
  getStageHubCurrentStage,
  type NatureTreeViewContract,
  type PickupManagerContract,
} from '../view/q4-contracts';
import { GameCore } from './GameCore';
import { GameCoreFruit } from './GameCoreFruit';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCoreTree } from './GameCoreTree';

const f = Math.fround;

export class GameCorePickupManager extends GameCoreObject {
  private fruitElapsedTime = f(0); // 0x60
  private fruitTreeHandleList: GameCoreHandle[] | null = null; // 0x68
  private fruitCurIndex = 0; // 0x70

  // .ctor @0x4C0BA0
  // The viewer parameter is not stored: the base GameCoreObject ctor creates
  // the handle/collision and registers with the current frame; the view is
  // linked via GameCoreBridge by the scene bootstrap and looked up dynamically.
  constructor(_a_pickupManager: PickupManagerContract | null) {
    super();
  }

  // RecreateViewer @0x4C0BB0 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let view = this.getUnityObjectAs<PickupManagerContract>();
    if (view === null) view = findPickupManagerView();
    if (view === null) return null;
    return view.gameObject ?? null;
  }

  // Tick @0x4C0CA0 (virtual slot 7)
  override tick(): void {
    this.updateFruitDrops();
  }

  // UpdateFruitDrops @0x4C0CB0
  // While fewer than maximumFruitsOnGround fruits exist, advance the drop
  // timer; when the next scheduled drop time is reached, pick a random
  // remaining fruit tree and spawn its hidden fruit there.
  private updateFruitDrops(): void {
    const view = this.getUnityObjectAs<PickupManagerContract>();
    if (view === null) return;

    if (this.fruitTreeHandleList === null) {
      // C#: new List<GameCoreHandle>(view.fruitTreeHandleList)
      this.fruitTreeHandleList = [...view.fruitTreeHandleList!];
    }

    const dropData = view.hiddenFruitData!; // view +0x30

    let fruitCount = 0;
    for (const _fruit of GameCore.instance!.allObjects<GameCoreFruit>(GameCoreFruit)) {
      fruitCount++;
    }

    if (fruitCount < view.maximumFruitsOnGround!) {
      // view +0x2C
      this.fruitElapsedTime = f(this.fruitElapsedTime + GameCore.tickDeltaTime);

      // FAITHFUL: binary throws NullReferenceException if dropData is null
      // here (unconditional array access in the original source).
      if (this.fruitCurIndex >= dropData.length) return;
      const data = dropData[this.fruitCurIndex];
      if (this.fruitElapsedTime < data.time) return; // data +0x1C (int seconds)

      this.fruitElapsedTime = f(this.fruitElapsedTime - data.time);
      this.fruitCurIndex++;

      // Pick a random tree still in the list; skip stale handles.
      let tree: GameCoreTree | null;
      let treeHandle: GameCoreHandle;
      do {
        if (this.fruitTreeHandleList.length < 1) return;
        const index = GameCoreObject.randomRangeI(
          0,
          this.fruitTreeHandleList.length,
          this.handle,
        );
        treeHandle = this.fruitTreeHandleList[index];
        this.fruitTreeHandleList.splice(index, 1); // RemoveAt(index)
        tree = treeHandle.getMostRecentObjectVersion<GameCoreTree>();
      } while (tree === null);

      // C#: GameCoreBridge.Instance.GetUnityObject<Q4.NatureTree>(treeHandle)
      const treeView = treeHandle.getUnityObject() as NatureTreeViewContract | null;
      // FAITHFUL: unconditional dereferences (NRE if the view/stage is missing).
      const movement = treeView!.getComponentPickupMovement();
      getStageHubCurrentStage()!.pickupManager.createFruit!(data, tree.position, movement);
    } else {
      this.fruitElapsedTime = f(0.0);
    }
  }
}
