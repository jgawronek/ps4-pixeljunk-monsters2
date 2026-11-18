// GameCore/GameCoreLocalMultiplayerInfo.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: methods @0x4BEAF0..0x4BEBE0, recovered from raw disassembly (no Ghidra
// .c file exists for this class). Data structure only — local 2P marker object;
// no online logic is involved.
//
// A marker GameCoreObject added to the frame when a second local player joins.
// did2PEnterTheGame simply tests whether the marker exists in the current frame.
// The base GameCoreObject ctor registers new instances with the frame.

namespace GameCore
{
    public class GameCoreLocalMultiplayerInfo : GameCoreObject
    {
        // .ctor @0x4BEAF0 — tail-jumps to GameCoreObject..ctor (no extra state).
        public GameCoreLocalMultiplayerInfo()
            : base()
        {
        }

        // get_did2PEnterTheGame @0x4BEB00
        public static bool did2PEnterTheGame
        {
            get { return GameCore.Instance.FirstObject<GameCoreLocalMultiplayerInfo>() != null; }
        }

        // AddLocalMultiplayerMarkerToGameCore @0x4BEB50
        public static void AddLocalMultiplayerMarkerToGameCore()
        {
            if (GameCore.Instance.FirstObject<GameCoreLocalMultiplayerInfo>() != null)
                return;
            // Base ctor registers the marker with the current frame.
            new GameCoreLocalMultiplayerInfo();
        }
    }
}
