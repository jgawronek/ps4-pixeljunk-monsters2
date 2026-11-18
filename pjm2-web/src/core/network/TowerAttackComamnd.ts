// src/core/network/TowerAttackComamnd.ts
// TypeScript port of decomp/src/GameCore/Network/TowerAttackComamnd.cs
// (TypeDefIndex 3005 [sic], RVA 0x4DF5A0..0x4DF6A0). Manual fire: forces one
// immediate attack shot on the tower (burst timer 0, burst count 0,
// forceAttack = true). NOTE: the class name keeps the original "Comamnd"
// typo. State duration literal DAT_00b7c49c = 10000.0f is baked into
// TowerStateAttack.

import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { TowerStateAttack } from '../TowerStateAttack';
import { NetworkCommand } from './NetworkCommand';

export class TowerAttackComamnd extends NetworkCommand {
  private m_towerHandle: GameCoreHandle; // 0x10 (32-byte struct)

  // .ctor @0x4DF5A0
  constructor(towerHandle: GameCoreHandle) {
    super();
    this.m_towerHandle = towerHandle;
  }

  // ExecuteCommand @0x4DF5D0 (virtual slot 4)
  executeCommand(_executingPlayerObject: GameCorePlayer | null): void {
    const tower = this.m_towerHandle.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null) return;
    // vtable entry 26 = slot 9 = setTowerState; forced single shot.
    tower.setTowerState(new TowerStateAttack(0, 0, true));
  }
}
