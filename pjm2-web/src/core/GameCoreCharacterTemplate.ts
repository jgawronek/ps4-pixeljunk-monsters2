// src/core/GameCoreCharacterTemplate.ts
// TypeScript port of decomp/src/GameCore/GameCoreCharacterTemplate.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3033).
// A placed character prop (scene bootstrap). C# ctor takes Q4.QuatPos
// (Position + Rotation) and a GameObject prefab; Object.Instantiate +
// bridge SetUnityObject.
//
// TS ADAPTATION: QuatPos split into Vector3 + Quaternion params; the
// Instantiate is the view layer's responsibility — headless adopts the passed
// prefab object as the registered unity object (same link semantics).

import type { Quaternion } from '../engine/math/Quaternion';
import type { Vector3 } from '../engine/math/Vector3';
import { registerUnityObject } from '../view/q4-contracts';
import { GameCoreObject } from './GameCoreObject';

export class GameCoreCharacterTemplate extends GameCoreObject {
  // .ctor
  constructor(a_position: Vector3, _a_rotation: Quaternion, a_prefab: unknown) {
    super();
    this.position = a_position; // setter re-buckets the collision grid
    // C#: Object.Instantiate(a_prefab, position, a_location.Rotation) + SetUnityObject
    registerUnityObject(this.handle.m_handle, a_prefab);
  }

  // Tick — confirmed empty body.
  override tick(): void {}
}
