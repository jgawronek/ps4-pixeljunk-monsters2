// src/core/network/SignCommand.ts
// TypeScript port of decomp/src/GameCore/Network/SignCommand.cs
// (TypeDefIndex 3015, RVA 0x4DECD0..0x4DED60). Player plants a map sign/ping:
// pure event relay — signEvent carries (player handle, category, icon); the
// HUD view listens and renders the sign.

import { Events } from '../Events';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class SignCommand extends NetworkCommand {
  private m_categoryID: number; // 0x10
  private m_iconID: number; // 0x14

  // .ctor @0x4DECD0
  constructor(cat: number, icon: number) {
    super();
    this.m_categoryID = cat | 0;
    this.m_iconID = icon | 0;
  }

  // ExecuteCommand @0x4DED00 (virtual slot 4)
  // FAITHFUL: no null guard on the player (C# dereferences .handle → NRE).
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    Events.signEvent.invoke(executingPlayerObject!.handle, this.m_categoryID, this.m_iconID); // +0x168
  }
}
