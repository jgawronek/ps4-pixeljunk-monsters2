// Q4/PlayerInfo.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Small value type describing a player joining a game (id, locality, cosmetics).
// Carried by SceneLoader.LoadStage / PlayerManager.JoinPlayers.
// Field offsets from skeleton/Q4.cs (TypeDefIndex 2757). The ctor pseudocode
// writes at +0x10/+0x14/+0x18/+0x20 because IL2CPP passes structs with an object
// header; the true field offsets are 0x0/0x4/0x8/0x10 as listed below.

namespace Q4
{
    public struct PlayerInfo
    {
        public int id;              // 0x0
        public bool localPlayer;    // 0x4
        public string maskName;     // 0x8
        public string carapaceName; // 0x10

        // .ctor @0x3EE690
        public PlayerInfo(int aID, bool aLocal)
        {
            id = aID;
            localPlayer = aLocal;
            maskName = string.Empty;
            carapaceName = string.Empty;
        }

        // .ctor @0x3EE720
        public PlayerInfo(int aID, bool aLocal, string aMaskName, string aCarapaceName)
        {
            id = aID;
            localPlayer = aLocal;
            maskName = aMaskName;
            carapaceName = aCarapaceName;
        }
    }
}