// src/core/network/EnterLeaveTowerCommand.ts
// TypeScript port of decomp/src/GameCore/Network/EnterLeaveTowerCommand.cs
// (TypeDefIndex 3008, RVA 0x4D9840..0x4D99C0). Player enters or leaves a
// tower's manual-aim seat. Guarded both ways: cannot leave an empty seat,
// cannot enter an occupied one. Writes the tower's m_playerInside slot.

import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { NetworkCommand } from './NetworkCommand';

export class EnterLeaveTowerCommand extends NetworkCommand {
  private isEntering: boolean; // 0x10
  private player: GameCoreHandle; // 0x18 (32-byte struct)
  private tower: GameCoreHandle; // 0x38 (32-byte struct)

  // .ctor @0x4D9840
  constructor(aPlayer: GameCoreHandle, aTower: GameCoreHandle, enter: boolean) {
    super();
    this.isEntering = enter;
    this.player = aPlayer;
    this.tower = aTower;
  }

  // ExecuteCommand @0x4D9880 (virtual slot 4)
  // NOTE: uses the command's stored player handle, NOT the executing player
  // argument (the binary ignores it entirely).
  executeCommand(_executingPlayerObject: GameCorePlayer | null): void {
    const t = this.tower.getMostRecentObjectVersion<GameCoreTower>();
    if (t === null) return;

    if (!this.isEntering) {
      if (!t.hasPlayerInTower()) return; // nobody inside — nothing to leave
      t.playerExitTower();
    } else {
      if (t.hasPlayerInTower()) return; // seat occupied — cannot enter
      t.playerEnterTower(this.player);
    }
  }
}
