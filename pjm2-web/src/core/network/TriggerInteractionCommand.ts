// src/core/network/TriggerInteractionCommand.ts
// TypeScript port of decomp/src/GameCore/Network/TriggerInteractionCommand.cs
// (TypeDefIndex 3018, RVA 0x4DF8D0..0x4DF970). Player triggers an interaction
// object (signs, gates, switches): pure event relay — triggerInterationEvent
// (original spelling) carries the player and the target object's handle;
// GameCoreInteractionObject listens and reacts.

import { Events } from '../Events';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class TriggerInteractionCommand extends NetworkCommand {
  private m_gco: GameCoreHandle; // 0x10 (32-byte struct)

  // .ctor @0x4DF8D0
  constructor(a_gco: GameCoreHandle) {
    super();
    this.m_gco = a_gco;
  }

  // ExecuteCommand @0x4DF900 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    Events.triggerInterationEvent.invoke(executingPlayerObject, this.m_gco); // Events statics +0x120
  }
}
