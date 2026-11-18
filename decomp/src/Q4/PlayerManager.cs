// Q4/PlayerManager.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Spawns/owns the Q4.Player views for joining players and destroys them when the
// sim removes the corresponding GameCorePlayer. Field offsets from skeleton/Q4.cs
// (TypeDefIndex 2758).

using System.Collections.Generic;
using GameCore;
using GameCore.Event;
using UnityEngine;

namespace Q4
{
    public class PlayerManager : MonoBehaviour
    {
        private static PlayerManager m_instance;    // 0x0 (static)

        public static PlayerManager Instance
        {
            get                                     // get_Instance @0x3EEB10
            {
                if (m_instance == null)
                {
                    m_instance = Object.FindObjectOfType<PlayerManager>();
                    if (m_instance == null)
                    {
                        // Untitled GameObject + component (generic artifacts in the
                        // decompiler: <TitleScreenController>/<GestureInputModule>;
                        // the field type forces <PlayerManager>).
                        GameObject go = new GameObject();
                        m_instance = go.AddComponent<PlayerManager>();
                    }
                }
                return m_instance;
            }
        }

        // Awake @0x3EECB0
        private void Awake()
        {
            m_instance = this;
        }

        // OnDestroy @0x3EED10
        private void OnDestroy()
        {
            m_instance = null;
        }

        // OnEnable @0x3EED70
        private void OnEnable()
        {
            // Events.playerRemovedEvent (statics +0x138), deferred to LateUpdate.
            Events.playerRemovedEvent.AddListener(OnCorePlayerRemoved, EventTime.PostUnityUpdate);
        }

        // OnDisable @0x3EEE40
        private void OnDisable()
        {
            Events.playerRemovedEvent.RemoveListener(OnCorePlayerRemoved);
        }

        // JoinPlayers @0x3EEF00
        public void JoinPlayers(List<PlayerInfo> infos)
        {
            if (infos == null)
                return;
            for (int i = 0; i < infos.Count; i++)
            {
                PlayerInfo info = infos[i];
                Vector3 location;
                Quaternion rotation;
                PlayerSpawnPoint.GetSpawnLocation(info.id, infos.Count, out location, out rotation);
                JoinPlayer(info, location, rotation);
            }
        }

        // JoinPlayer @0x3EF0E0
        public Player JoinPlayer(PlayerInfo info, Vector3 location, Quaternion rotation)
        {
            // The shipped binary reads Player.players.Count and (in network
            // matches) NetworkMatch.Instance.PlayerList.Count but performs no
            // visible comparison — INFERRED: a max-player capacity guard whose
            // branch was optimized/stripped. TODO: confirm intent.
            int existing = Player.players.Count;
            if (Q4.Networking.NetworkMatch.IsNetworkMatch)
            {
                int capacity = Q4.Networking.NetworkMatch.Instance.PlayerList.Count;
            }

            return CreatePlayer(GlobalResources.DebugPlayerPrefab, info, location, rotation);
        }

        // CreatePlayer @0x3EF270
        private Player CreatePlayer(Player playerPrefab, PlayerInfo info, Vector3 position, Quaternion rotation)
        {
            Debug.Log(string.Format("CreatePlayer called for id={0}", info.id));

            Player player = null;
            if (playerPrefab != null)
            {
                player = Object.Instantiate<Player>(playerPrefab);
                if (player != null)
                {
                    player.SetInfo(GetPlayerNameForID(info.id), info);

                    // GetTransform() @0x3E6910 returns m_transform (0x218);
                    // the binary inlines it to a direct field read.
                    Transform avatar = player.GetTransform();
                    if (avatar != null)
                    {
                        // Parent the avatar under the PlayerManager, then place it.
                        avatar.SetParent(transform, false);
                        avatar.position = position;
                        avatar.rotation = rotation;
                        Rigidbody rb = avatar.GetComponent<Rigidbody>();
                        rb.position = avatar.position;
                    }

                    if (player.IsLocal())                               // m_isLocal 0x236, inlined in binary
                        SetupCamera(player);

                    Debug.Log(string.Format("CreatePlayer for playerId={0} completed!", player.playerID));
                }
            }
            return player;
        }

        // GetPlayerNameForID @0x3EF590
        private string GetPlayerNameForID(int playerID)
        {
            if (Q4.Networking.NetworkMatch.IsNetworkMatch)
            {
                // Online member name (NetworkMatch out of scope; field at +0x18
                // of the match member is the display name).
                var member = Q4.Networking.NetworkMatch.Instance.FindMatchMember(playerID);
                if (member != null)
                    return member.name; // TODO: confirm member type/field (online code skipped)
            }
            return "Player id: " + playerID.ToString();
        }

        // SetupCamera @0x3EF6B0
        private void SetupCamera(Player player)
        {
            if (CameraManager.Instance != null && player != null)
                CameraManager.Instance.SetupCameras(player.gameObject);
        }

        // OnCorePlayerRemoved @0x3EF7B0
        // Core event callback: the sim removed a GameCorePlayer -> destroy its view.
        private void OnCorePlayerRemoved(GameCorePlayer corePlayer)
        {
            // Generic artifact <Structure> in the decompiler; the view is a Player
            // (GetUnityObject<Player> is a confirmed instantiation family).
            Player view = corePlayer.GetUnityObject<Player>();
            if (view != null)
                Object.Destroy(view.gameObject);
        }

        // Terminate @0x3EF870 — empty in the shipped build.
        public void Terminate()
        {
        }

        // .cctor @0x3EF880 — empty.
    }
}