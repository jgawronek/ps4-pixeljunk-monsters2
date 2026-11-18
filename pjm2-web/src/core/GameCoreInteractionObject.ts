// src/core/GameCoreInteractionObject.cs → .ts
// *** SKELETON PORT *** (TypeDefIndex 3093; full field block in
// skeleton/GameCore.cs: m_isActive 0x60, m_isTriggered 0x61, m_time 0x64,
// path movement/bounce/damage fields through 0xB8). The C# reconstruction is
// an upstream gap (decomp/src/GameCore has no GameCoreInteractionObject.cs).
// Exists now so GameCoreFruit.TickHitInteractableObject's typed query works.
// The FULL port (path motion, bounce, hit damage) lands when reconstructed.

import { GameCoreObject } from './GameCoreObject';

export class GameCoreInteractionObject extends GameCoreObject {
  private m_isActive = false; // 0x60
  private m_isTriggered = false; // 0x61

  // get_IsTriggered
  get isTriggered(): boolean {
    return this.m_isTriggered;
  }
}
