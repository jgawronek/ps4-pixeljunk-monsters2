// src/core/AIDebugHelper.ts
// TypeScript port of decomp/src/GameCore/AIDebugHelper.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x93B530 / @0x93B540).
// Debug gizmo drawing for AI/collision volumes. Both overloads decompile to
// EMPTY bodies — the gizmo code is compiled out in the shipped build
// (debug-only). Reproduced as no-ops.

import type { Vector3 } from '../engine/math/Vector3';
import type { GameCoreObject } from './GameCoreObject';

export class AIDebugHelper {
  private constructor() {}

  // DrawCollisionGizmo @0x93B530 — empty in shipped build.
  static drawCollisionGizmo(a_coreObject: GameCoreObject): void;
  // DrawCollisionGizmo @0x93B540 — empty in shipped build.
  static drawCollisionGizmo(pos: Vector3, radius: number, height: number, color: unknown): void;
  static drawCollisionGizmo(..._args: unknown[]): void {
    // INFERRED: debug-only; compiled out in the shipped build.
  }
}
