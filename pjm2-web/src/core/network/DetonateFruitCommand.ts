// src/core/network/DetonateFruitCommand.ts
// TypeScript port of decomp/src/GameCore/Network/DetonateFruitCommand.cs
// (TypeDefIndex 3006, RVA 0x4D96C0..0x4D96D0).
// FAITHFUL FINDING: the shipped binary has an EMPTY ctor and an EMPTY
// ExecuteCommand — the command is a vestigial placeholder (bomb-fruit
// detonation is driven elsewhere: the Q4 view / BuffBomb path). Reproduced
// empty on purpose.

import type { GameCorePlayer } from '../GameCorePlayer';
import { NetworkCommand } from './NetworkCommand';

export class DetonateFruitCommand extends NetworkCommand {
  // ExecuteCommand @0x4D96D0 (virtual slot 4) — empty in the binary.
  executeCommand(_a_executingPlayer: GameCorePlayer | null): void {}
}
