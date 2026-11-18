// src/core/network/PickupFruitCommand.ts
// TypeScript port of decomp/src/GameCore/Network/PickupFruitCommand.cs
// (TypeDefIndex 3012, RVA 0x4DDE70..0x4DE140). Player picks up a fruit.
// Unowned fruit → fruitPickedUpEvent (the sim-side grab wiring listens).
// Fruit owned by ANOTHER player, or a fruit handle that no longer resolves →
// the requesting player's VIEW is force-reset (motor drops its carried fruit
// prop and the tikiman FSM is forced to Idle) so the presentation can never
// desync into a "carrying" pose without a sim fruit.

import { Events } from '../Events';
import { GameCoreFruit } from '../GameCoreFruit';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import type { PlayerFruitViewContract } from '../../view/q4-contracts';
import { NetworkCommand } from './NetworkCommand';

export class PickupFruitCommand extends NetworkCommand {
  private m_fruitHandle: GameCoreHandle; // 0x10 (32-byte struct)

  // .ctor @0x4DDE70 — takes the live sim fruit; stores its handle.
  // FAITHFUL: binary NREs on null fruit (natural throw).
  constructor(a_fruit: GameCoreFruit) {
    super();
    this.m_fruitHandle = a_fruit.handle;
  }

  // ExecuteCommand @0x4DDEA0 (virtual slot 4)
  executeCommand(a_executingPlayer: GameCorePlayer | null): void {
    const fruit = this.m_fruitHandle.getMostRecentObjectVersion<GameCoreFruit>();
    if (fruit === null) {
      // Fruit vanished mid-request: reset the view's carry state.
      PickupFruitCommand.forcePlayerViewDropFruit(a_executingPlayer);
      return;
    }

    const owner = fruit.playerOwner;
    if (owner === null) {
      // Free fruit — the real pickup: sim listeners (GameCoreFruit /
      // GameCorePlayer) hook this event and do the grab bookkeeping.
      Events.fruitPickedUpEvent.invoke(a_executingPlayer as GameCorePlayer, fruit); // +0x100 (C# passes possibly-null through)
      return;
    }

    // Owned fruit: only actionable when the requester is NOT the last owner;
    // otherwise force-reset the requesting view (cannot steal).
    if (
      a_executingPlayer !== null &&
      fruit.lastPlayerOwner.m_handle !== a_executingPlayer.handle.m_handle
    ) {
      PickupFruitCommand.forcePlayerViewDropFruit(a_executingPlayer);
    }
  }

  // Shared view-reset path (inlined twice in the binary): resolve the
  // Q4.Player view (the decompiler's GetUnityObject<Structure> label is a
  // shared-generic artifact — the confirmed instantiation is Q4.Player),
  // drop the motor's fruit prop and force the tikiman FSM to Idle.
  private static forcePlayerViewDropFruit(player: GameCorePlayer | null): void {
    if (player === null) return;
    const view = player.getUnityObjectAs<PlayerFruitViewContract>();
    if (view === null) return; // binary: exception path
    if (view.motor === null) return; // binary: exception path
    view.motor.dropFruit();
    const stateMachine = view.motor.stateMachine;
    // C#: Q4.TikimanStateIdle idle = new Q4.TikimanStateIdle();
    // TS ADAPTATION: the view FSM class lands with Phase 3; the marker below
    // is what the (view-side) state machine receives as the forced state.
    const idle: unknown = { __typeName: 'TikimanStateIdle' };
    if (stateMachine === null) return; // binary: exception path
    stateMachine.forceCurrentCommand(idle, null);
  }
}
