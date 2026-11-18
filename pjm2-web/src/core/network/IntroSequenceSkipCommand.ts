// src/core/network/IntroSequenceSkipCommand.ts
// TypeScript port of decomp/src/GameCore/Network/IntroSequenceSkipCommand.cs
// (TypeDefIndex 3010, RVA 0x4DD780..0x4DD7F0). Skips the stage intro: raises
// introSequenceFinishedEvent with the skipping player, which releases the
// wave manager's start delay exactly like the natural sequence end.

import { Events } from '../Events';
import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class IntroSequenceSkipCommand extends NetworkCommand {
  // ExecuteCommand @0x4DD790 (virtual slot 4)
  executeCommand(executingPlayerObject: GameCorePlayer | null): void {
    // TS ADAPTATION: payload type is GameCorePlayer | null (the C# signature
    // takes the player non-null; the event alias already tolerates null).
    Events.introSequenceFinishedEvent.invoke(executingPlayerObject as GameCorePlayer); // +0x0 (C# passes possibly-null through)
  }
}
