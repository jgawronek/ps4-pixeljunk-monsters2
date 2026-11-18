// src/core/network/TowerXPCommand.ts
// TypeScript port of decomp/src/GameCore/Network/TowerXPCommand.cs
// (TypeDefIndex 3017, RVA 0x4DF840..0x4DF8D0). Grants EXP to a tower on behalf
// of a player (the dance/tikiman EXP funnel: the view detects a dancing
// player and feeds the nearby tower).

import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { NetworkCommand } from './NetworkCommand';

export class TowerXPCommand extends NetworkCommand {
  private m_TowerHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private a_XP: number; // 0x30

  // .ctor @0x4DF840
  constructor(a_towerHandle: GameCoreHandle, a_xp: number) {
    super();
    this.m_TowerHandle = a_towerHandle;
    this.a_XP = a_xp;
  }

  // ExecuteCommand @0x4DF870 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    const tower = this.m_TowerHandle.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null) return;
    tower.grantEXP(this.a_XP, executingPlayerObject);
  }
}
