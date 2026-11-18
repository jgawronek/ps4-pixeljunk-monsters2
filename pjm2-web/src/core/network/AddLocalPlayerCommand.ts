// src/core/network/AddLocalPlayerCommand.ts
// TypeScript port of decomp/src/GameCore/Network/AddLocalPlayerCommand.cs
// (TypeDefIndex 2996, RVA 0x4D56B0..0x4D5AA0). Adds a local player to the
// running stage: computes the next free player id (max existing + 1), asks
// the Q4 PlayerManager view to spawn the avatar at the origin, which in turn
// creates the sim-side GameCorePlayer through the IPlaceableViewObject
// bootstrap, and finally re-applies any carried-over customization
// (StageTransferInfo) when arriving from another scene.

import { Mathf } from '../../engine/math/Mathf';
import { Quaternion } from '../../engine/math/Quaternion';
import { Vector3 } from '../../engine/math/Vector3';
import { GameCore } from '../GameCore';
import { GameCorePlayer } from '../GameCorePlayer';
import {
  getPlayerManager,
  getStageTransferInfo,
  type PlayerInfoData,
} from '../../view/q4-contracts';
import { NetworkCommand } from './NetworkCommand';

export class AddLocalPlayerCommand extends NetworkCommand {
  // ExecuteCommand @0x4D56C0 (virtual slot 4)
  // NOTE: the executing-player argument is unused (the command CREATES the player).
  executeCommand(_executingPlayerObject: GameCorePlayer | null): void {
    // Next free id: max of all live players (0 when none) + 1.
    let maxId = 0;
    for (const existing of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      maxId = Mathf.Max(maxId, existing.playerId);
    }

    const manager = getPlayerManager();
    if (manager === null) return; // binary: exception path

    const info: PlayerInfoData = {
      id: maxId + 1,
      localPlayer: true,
      maskName: '',
      carapaceName: '',
    };
    const view = manager.joinPlayer(info, Vector3.zero, Quaternion.identity);
    if (view === null) return;

    // The view bootstrap creates the sim player (createGameCoreObject on the
    // IPlaceableViewObject interface).
    const player = view.createGameCoreObject() as GameCorePlayer | null;

    // Scene-transfer customization (mask/carapace chosen in the hub): when
    // StageTransferInfo is present, the saved parts for this player id are
    // read and applied to the freshly spawned view.
    const transfer = getStageTransferInfo();
    if (transfer !== null && player !== null) {
      // C# reads the current parts into (out) strings, then TryGetParts
      // overwrites them from the transfer record keyed by view.playerID.
      const parts = transfer.tryGetParts(view.playerID);
      if (parts !== null) {
        view.setCustomizedParts(parts.maskName, parts.carapaceName);
      }
    }
  }
}
