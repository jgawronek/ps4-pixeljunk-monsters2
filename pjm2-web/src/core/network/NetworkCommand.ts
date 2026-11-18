// src/core/network/NetworkCommand.ts
// TypeScript port of decomp/src/GameCore/Network/NetworkCommand.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3011, .ctor @0x4D55F0).
// Abstract base of the sim command pattern. EVERY gameplay action — even in
// single-player — flows through a NetworkCommand queued via
// GameCoreNetworkBridge.addPlayerCommand and executed between
// prepareNextFrame and tick (the verified GameCoreBridge pipeline).
// Views never mutate sim state directly.
// Virtual slot 4 = ExecuteCommand (confirmed via dump.cs).

import type { GameCorePlayer } from '../GameCorePlayer';

export abstract class NetworkCommand {
  // ExecuteCommand (virtual slot 4) — applies the command to the sim,
  // executed on behalf of `executingPlayerObject`.
  abstract executeCommand(executingPlayerObject: GameCorePlayer | null): void;
}
