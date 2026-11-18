// src/core/network/UpgradeTowerCommand.ts
// TypeScript port of decomp/src/GameCore/Network/UpgradeTowerCommand.cs
// (TypeDefIndex 3019, RVA 0x4DF9D0..0x4DFB30). Player pays to upgrade a tower
// to the NEXT level: validates the requested level matches the next upgrade,
// tops the tower's EXP up to exactly the level's reachExp (grantEXP performs
// the actual upgradeTower), then charges the upgrade's coin+gem costs.

import type { GameCoreHandle } from '../GameCoreHandle';
import { EInventoryType, GameCoreInventory } from '../GameCoreInventory';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { NetworkCommand } from './NetworkCommand';

export class UpgradeTowerCommand extends NetworkCommand {
  private m_towerHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private m_upgradeLevel: number; // 0x30

  // .ctor @0x4DF9D0
  constructor(towerHandle: GameCoreHandle, upgradeLevel: number) {
    super();
    this.m_towerHandle = towerHandle;
    this.m_upgradeLevel = upgradeLevel | 0;
  }

  // ExecuteCommand @0x4DFA00 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    const tower = this.m_towerHandle.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null) return;

    const next = tower.getNextUpgrade();
    if (next === null || this.m_upgradeLevel === 0 || this.m_upgradeLevel !== next.level) return;

    // Top EXP up to exactly the requirement — grantEXP triggers upgradeTower
    // when currentEXP reaches next.reachExp.
    tower.grantEXP(next.reachExp - tower.currentEXP, null);

    let inventory = GameCoreInventory.getInventoryObject();
    if (executingPlayerObject === null || inventory === null) return; // binary: exception path

    const playerHandle = executingPlayerObject.handle;
    inventory.removeInventory(playerHandle, EInventoryType.Coin, next.costCoin!, true); // dump.cs +0x24
    inventory = GameCoreInventory.getInventoryObject();
    if (inventory === null) return; // binary: exception path (re-fetched, faithful)
    inventory.removeInventory(playerHandle, EInventoryType.Gem, next.costGem!, true); // dump.cs +0x28
  }
}
