// GameCore/Network/AddLocalPlayerCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Adds a local player to the running stage (stage start, and "join" in local
// co-op): computes the next free player id (max existing + 1), asks the Q4
// PlayerManager view to spawn the avatar at the origin, which in turn creates
// the sim-side GameCorePlayer through the IPlaceableViewObject bootstrap, and
// finally re-applies any carried-over customization (StageTransferInfo) when
// arriving from another scene.
// Logic from Ghidra decompilation (RVA 0x4D56B0..0x4D5AA0).

using UnityEngine;

namespace GameCore.Network
{
    internal class AddLocalPlayerCommand : NetworkCommand // TypeDefIndex: 2996
    {
        // .ctor @0x4D56B0 — no payload.
        public AddLocalPlayerCommand() { }

        // ExecuteCommand @0x4D56C0 (virtual slot 4)
        // NOTE: the executing-player argument is unused (the command CREATES
        // the player).
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            // Next free id: max of all live players (0 when none) + 1.
            int maxId = 0;
            foreach (GameCorePlayer existing in GameCore.Instance.AllObjects<GameCorePlayer>())
            {
                maxId = Mathf.Max(maxId, existing.playerId);
            }

            Q4.PlayerManager manager = Q4.PlayerManager.Instance;
            if (manager == null)
                return;   // binary: exception path

            Q4.PlayerInfo info = new Q4.PlayerInfo(maxId + 1, true);
            Q4.Player view = manager.JoinPlayer(info, Vector3.zero, Quaternion.identity);
            if (view == null)
                return;

            // The view bootstrap creates the sim player (CreateGameCoreObject
            // on the IPlaceableViewObject interface; the IsInst check in the
            // binary confirms GameCorePlayer).
            GameCorePlayer player = view.CreateGameCoreObject() as GameCorePlayer;

            // Scene-transfer customization (mask/carapace chosen in the hub):
            // when StageTransferInfo is present, the saved parts for this
            // player id are read and applied to the freshly spawned view.
            Q4.StageTransferInfo transfer = Q4.StageTransferInfo.transferInfo;
            if (transfer != null && player != null)
            {
                // INFERRED detail: the binary calls view.GetCustomizedParts
                // into two strings, indexes transferInfo+0x30 by view.playerID
                // and writes the stored mask/carapace names back. The Q4
                // StageTransferInfo view class is not yet reconstructed —
                // TODO: wire exact accessors when it lands.
                string maskName;
                string carapaceName;
                view.GetCustomizedParts(out maskName, out carapaceName);
                if (transfer.TryGetParts(view.playerID, out maskName, out carapaceName))
                {
                    view.SetCustomizedParts(maskName, carapaceName);
                }
            }
        }
    }
}
