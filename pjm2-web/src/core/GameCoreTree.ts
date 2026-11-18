// src/core/GameCoreTree.ts
// TypeScript port of decomp/src/GameCore/GameCoreTree.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3082,
// RVA 0x4C2E60..0x4D1A50).
// Sim-side proxy for a Q4.NatureTree (fruit tree). Trees are where fruit
// pickups hang from: each plucked fruit "breaks down" the tree
// (referenceCount++) and a regrown/revived fruit decrements it; at 0 the tree
// is valid again and the view is re-activated. Also carries the hidden-pickup
// index used by the hidden-fruit system (DirectlySetPickupDataIndex = 2000
// marks pickup data set directly rather than by index).
//
// Float constants CONFIRMED from ELF .rodata (per the C# reconstruction):
//   DAT_00b7c46c = 0.15 (collision radius)   DAT_00b7c470 = 2.0 (collision height)
//   DAT_00b7c474 = 1.0  (viewer position-match threshold)

import { Vector3 } from '../engine/math/Vector3';
import {
  getAllTreesInScene,
  type NatureTreeViewContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { Events } from './Events';
import { GameCoreObject } from './GameCoreObject';
import type { GameCorePlayer } from './GameCorePlayer';

const f = Math.fround;

export class GameCoreTree extends GameCoreObject {
  /** Sentinel for hiddenPickupIndex meaning "pickup data was set directly".
   *  C#: public const int DirectlySetPickupDataIndex = 2000. */
  static readonly directlySetPickupDataIndex = 2000;

  protected m_hiddenPickupIndex = -1; // 0x60 (C#: 0xffffffff field init)
  /** Outstanding breakdowns (0 = healthy). C#: protected int referenceCount. */
  referenceCount = 0; // 0x64

  // ---- constants (CONFIRMED from ELF .rodata) ----
  private static readonly collisionRadius = f(0.15); // DAT_00b7c46c
  private static readonly collisionHeight = f(2.0); // DAT_00b7c470
  private static readonly viewerMatchThreshold = f(1.0); // DAT_00b7c474

  // get/set_hiddenPickupIndex @0x4C2E60 / @0x4C2E70
  get hiddenPickupIndex(): number {
    return this.m_hiddenPickupIndex;
  }
  set hiddenPickupIndex(value: number) {
    this.m_hiddenPickupIndex = value | 0;
  }

  // .ctor @0x4D1640
  constructor(a_pos: Vector3) {
    super(); // base registers the object + assigns the handle
    this.position = a_pos; // landed position setter re-buckets the grid
    this.collision = new Cylinder(
      GameCoreTree.collisionRadius,
      GameCoreTree.collisionHeight,
    );
  }

  // Tick @0x4D1720 (virtual slot 7) — empty in the binary.
  override tick(): void {}

  // RecreateViewer @0x4D1730 (virtual slot 5)
  // Re-links the matching scene tree after a load/resync: prefers the mapped
  // viewer, otherwise scans Q4.NatureTree.allTreesInScene for the first tree
  // within ViewerMatchThreshold of the sim position. Then syncs the
  // GameObject's active flag to the breakdown state (referenceCount == 0 →
  // active) and returns the viewer GameObject.
  // TS ADAPTATION: Q4.Structure/NatureTree → NatureTreeViewContract;
  // Object.FindObjectsOfType scan → getAllTreesInScene() provider hook.
  override recreateViewer(): unknown | null {
    let viewer = this.getUnityObjectAs<NatureTreeViewContract>();

    let i = 0;
    while (viewer === null) {
      const trees = getAllTreesInScene();
      if (trees === null || trees.length <= i) break;
      let candidate: NatureTreeViewContract | null = trees[i];
      const tp = candidate.transform.position;
      const delta = new Vector3(tp.x, tp.y, tp.z).sub(this.position);
      if (delta.magnitude > GameCoreTree.viewerMatchThreshold) {
        candidate = null; // too far — reject
      } else {
        viewer = candidate;
        break;
      }
      i++;
    }

    if (viewer !== null) {
      const shouldBeActive = this.referenceCount === 0; // IsTreeValid
      if (viewer.gameObject.activeSelf !== shouldBeActive) {
        viewer.gameObject.setActive(shouldBeActive);
      }
      return viewer.gameObject;
    }
    return null; // binary: falls into the exception path; kept non-throwing
  }

  // ---- breakdown / revive ----

  // IsTreeValid @0x4D1960 — healthy while no breakdown is outstanding.
  isTreeValid(): boolean {
    return this.referenceCount === 0;
  }

  // Breakdown @0x4D1970
  // A fruit was taken: notify the view (structureBreakEvent) and deepen the
  // breakdown count. Payload type per Events.cs is CoreEvent<GameCoreObject>.
  breakdown(): void {
    Events.structureBreakEvent.invoke(this); // Events statics +0xB8
    this.referenceCount++;
  }

  // Revive @0x4D1A00
  // A fruit regrew / was returned: shallow the breakdown count; when the tree
  // becomes healthy again notify the view (treeReviveEvent).
  revive(player: GameCorePlayer, reviveIndex: number): void {
    this.referenceCount--;
    if (this.referenceCount !== 0) return;
    Events.treeReviveEvent.invoke(this, player, reviveIndex); // Events statics +0xD8
  }
}
