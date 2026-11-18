// src/core/network/GameCoreNetworkBridge.ts
// Minimal verified single-player seam for GameCore/GameCoreNetworkBridge.
// The C# GameCoreNetworkBridge is a 1726-line MonoBehaviour covering network
// sync, frame serialization, desync recovery and blob replay — all out of
// scope for SP. The VERIFIED SP-relevant behavior (decomp/src/Q4/
// GameCoreBridge.cs lines 9-58, OnGameCoreTicked @0x4DC7D0) is:
//   * AddPlayerCommand(command, player) queues a command;
//   * onGameCoreTicked() — called BETWEEN GameCore.prepareNextFrame() and
//     GameCore.tick() — executes every queued command via
//     command.ExecuteCommand(corePlayer) (vtable call at +0x150);
//   * SP uses the NullNetworkLayer loopback: queued local commands execute on
//     the very next tick, in FIFO order.
//   * GameCoreMustWait() SP: true while Player.players.Count == 0 (the driver
//     consults it; the bridge itself does not gate execution).
// The view-pose sampling half of OnGameCoreTicked (NetworkDataBlobPlayerSample)
// is a view concern and lands with Phase 3 input.

import type { GameCorePlayer } from '../GameCorePlayer';
import type { NetworkCommand } from './NetworkCommand';

interface QueuedCommand {
  command: NetworkCommand;
  player: GameCorePlayer | null;
}

export class GameCoreNetworkBridge {
  private m_commandQueue: QueuedCommand[] = [];

  // AddPlayerCommand — called from view/input code at any time; the command
  // runs on the next sim tick (SP loopback).
  addPlayerCommand(command: NetworkCommand, player: GameCorePlayer | null): void {
    this.m_commandQueue.push({ command, player });
  }

  get pendingCommandCount(): number {
    return this.m_commandQueue.length;
  }

  // OnGameCoreTicked @0x4DC7D0 (SP half) — drains the queue FIFO, executing
  // each command on behalf of its owning player.
  onGameCoreTicked(): void {
    const queue = this.m_commandQueue;
    this.m_commandQueue = [];
    for (const { command, player } of queue) {
      command.executeCommand(player);
    }
  }
}
