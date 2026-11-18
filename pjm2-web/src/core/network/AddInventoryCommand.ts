// src/core/network/AddInventoryCommand.ts
// TypeScript port of decomp/src/GameCore/Network/AddInventoryCommand.cs
// (TypeDefIndex 2995, RVA 0x4D55B0..0x4D5660). Credits currency to a player's
// inventory bag (used by the view layer for gem pickups/refunds — coins are
// credited by the sim pickup path itself). Guarded on the target player
// still existing.

import type { GameCoreHandle } from '../GameCoreHandle';
import { GameCoreInventory, EInventoryType } from '../GameCoreInventory';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class AddInventoryCommand extends NetworkCommand {
  private m_pickupType: EInventoryType; // 0x10
  private m_playerHandle: GameCoreHandle; // 0x18 (32-byte struct)
  private m_value: number; // 0x38

  // .ctor @0x4D55B0
  constructor(aPlayer: GameCoreHandle, value: number, pickupType: EInventoryType) {
    super();
    this.m_pickupType = pickupType;
    this.m_playerHandle = aPlayer;
    this.m_value = value | 0;
  }

  // ExecuteCommand @0x4D5600 (virtual slot 4)
  executeCommand(_executingPlayerObject: GameCorePlayer | null): void {
    const player = this.m_playerHandle.getMostRecentObjectVersion<GameCorePlayer>();
    if (player === null) return;
    const inventory = GameCoreInventory.getInventoryObject();
    if (inventory === null) return; // binary: exception path
    inventory.addInventory(this.m_playerHandle, this.m_pickupType, this.m_value);
  }
}
