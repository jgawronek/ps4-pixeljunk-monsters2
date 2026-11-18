// src/core/GameCoreShop.ts
// TypeScript port of decomp/src/GameCore/GameCoreShop.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3066, internal).
// The shop stand. Constants CONFIRMED from ELF .rodata: collision (0.5, 0.5)
// DAT_00b7c250; viewer match sqrDistance 1.0 DAT_00b7c448.
//
// TS ADAPTATION: Resources.FindObjectsOfTypeAll<Renderer> + scene.isLoaded
// filter → findShopViewerCandidates() provider hook (the view layer supplies
// loaded-scene renderer positions; headless default: none → null).

import { Vector3 } from '../engine/math/Vector3';
import { findShopViewerCandidates } from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { GameCoreObject } from './GameCoreObject';

const f = Math.fround;

export class GameCoreShop extends GameCoreObject {
  private static readonly collisionRadius = f(0.5); // DAT_00b7c250
  private static readonly collisionHeight = f(0.5); // DAT_00b7c250 (same literal)
  private static readonly viewerMatchSqrDistance = f(1.0); // DAT_00b7c448

  // .ctor
  constructor() {
    super();
    this.collision = new Cylinder(GameCoreShop.collisionRadius, GameCoreShop.collisionHeight);
    this.position = Vector3.zero;
  }

  // RecreateViewer — first loaded-scene renderer within sqrDistance 1.0.
  override recreateViewer(): unknown | null {
    const candidates = findShopViewerCandidates();
    for (const candidate of candidates) {
      const delta = new Vector3(
        candidate.position.x - this.position.x,
        candidate.position.y - this.position.y,
        candidate.position.z - this.position.z,
      );
      if (delta.sqrMagnitude < GameCoreShop.viewerMatchSqrDistance) {
        return candidate.gameObject;
      }
    }
    return null;
  }
}
