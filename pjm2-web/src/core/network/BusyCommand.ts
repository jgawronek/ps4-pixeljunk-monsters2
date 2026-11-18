// src/core/network/BusyCommand.ts
// TypeScript port of decomp/src/GameCore/Network/BusyCommand.cs
// (TypeDefIndex 2998, RVA 0x4D6780..0x4D6800). Sets/clears the player's "busy"
// flag broadcast (UI/menus use it to lock input). Pure event: the sim stores
// nothing — busyEvent carries (player handle, isBusy).

import { Events } from '../Events';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class BusyCommand extends NetworkCommand {
  private m_isBusy: boolean; // 0x10

  // .ctor @0x4D6780
  constructor(isBusy: boolean) {
    super();
    this.m_isBusy = isBusy;
  }

  // ExecuteCommand @0x4D67A0 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    if (executingPlayerObject === null) return; // binary: exception path
    Events.busyEvent.invoke(executingPlayerObject.handle, this.m_isBusy); // Events statics +0x1A8
  }
}
