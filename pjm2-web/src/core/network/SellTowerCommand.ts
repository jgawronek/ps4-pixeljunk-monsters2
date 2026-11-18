// src/core/network/SellTowerCommand.ts
// TypeScript port of decomp/src/GameCore/Network/SellTowerCommand.cs
// (TypeDefIndex 3014, RVA 0x4DE9A0..0x4DEDA0). Player sells a tower: destroys
// the sim tower, broadcasts the sell event (the view layer pays out the
// refund), and releases every tree the tower was built from
// (referenceCount--, reviving trees that hit 0).

import { Events } from '../Events';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { GameCoreTree } from '../GameCoreTree';
import { NetworkCommand } from './NetworkCommand';

export class SellTowerCommand extends NetworkCommand {
  private m_towerhandle: GameCoreHandle; // 0x10 (32-byte struct)
  private m_refundCoin: number; // 0x30
  private m_refundGem: number; // 0x34

  // .ctor @0x4DE9A0
  constructor(towerHandle: GameCoreHandle, refundCoin: number, refundGem: number) {
    super();
    this.m_towerhandle = towerHandle;
    this.m_refundCoin = refundCoin | 0;
    this.m_refundGem = refundGem | 0;
  }

  // ExecuteCommand @0x4DE9E0 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    const tower = this.m_towerhandle.getMostRecentObjectVersion<GameCoreTower>();
    if (tower === null) return;

    tower.destroySelf(); // vtable slot 6

    // The view layer listens and credits the refund.
    // +0xC8 (C# passes the possibly-null player through to the event payload)
    Events.towerSellEvent.invoke(tower, executingPlayerObject as GameCorePlayer, this.m_refundCoin, this.m_refundGem);

    if (tower.retainedTrees !== null) {
      let reviveIndex = 0;
      for (const h of tower.retainedTrees) {
        const tree = h.getMostRecentObjectVersion<GameCoreTree>();
        if (tree !== null) {
          // Binary inlines: tree.referenceCount--; when it hits 0
          // treeReviveEvent fires — identical to GameCoreTree.revive.
          // FAITHFUL: C# passes executingPlayerObject (possibly null) through
          // to the event payload.
          tree.revive(executingPlayerObject as GameCorePlayer, reviveIndex);
          reviveIndex++;
        }
      }
    }
  }
}
