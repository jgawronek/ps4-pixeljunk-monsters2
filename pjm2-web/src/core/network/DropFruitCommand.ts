// src/core/network/DropFruitCommand.ts
// TypeScript port of decomp/src/GameCore/Network/DropFruitCommand.cs
// (TypeDefIndex 3007, RVA 0x4D96E0..0x4D9830). Player throws/drops the
// carried fruit with a force vector. Only executes when the fruit is actually
// the one the player is carrying (handle identity check against the player's
// held-fruit slot), then broadcasts fruitDroppedEvent — GameCoreFruit's
// listener applies the throw.

import type { Vector3 } from '../../engine/math/Vector3';
import { Events } from '../Events';
import type { GameCoreFruit } from '../GameCoreFruit';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class DropFruitCommand extends NetworkCommand {
  private m_fruitHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private m_force: Vector3; // 0x30

  // .ctor @0x4D96E0 — FAITHFUL: binary NREs on null fruit (natural throw).
  constructor(a_fruit: GameCoreFruit, a_force: Vector3) {
    super();
    this.m_fruitHandle = a_fruit.handle;
    this.m_force = a_force;
  }

  // ExecuteCommand @0x4D9740 (virtual slot 4)
  executeCommand(a_executingPlayer: GameCorePlayer | null): void {
    const fruit = this.m_fruitHandle.getMostRecentObjectVersion<GameCoreFruit>();
    if (fruit === null) return;
    if (a_executingPlayer === null) return; // binary: exception path

    // Must still be the fruit this player is carrying.
    if (a_executingPlayer.heldFruit !== fruit) return;

    Events.fruitDroppedEvent.invoke(a_executingPlayer, fruit, this.m_force); // Events statics +0x118
  }
}
