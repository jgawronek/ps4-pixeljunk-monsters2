// GameCore/Network/NetworkCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Abstract base of the sim command pattern. EVERY gameplay action — even in
// single-player — flows through a NetworkCommand queued via
// GameCoreNetworkBridge.AddPlayerCommand and executed in
// Q4.GameCoreBridge.OnGameCoreTicked (between PrepareNextFrame and Tick).
// Views never mutate sim state directly.
// Logic from Ghidra decompilation (RVA 0x4D55F0).
// Virtual slot 4 = ExecuteCommand (confirmed via dump.cs).

using UnityEngine;

namespace GameCore.Network
{
    public abstract class NetworkCommand // TypeDefIndex: 3011
    {
        // .ctor @0x4D55F0
        protected NetworkCommand() { }

        // ExecuteCommand (virtual slot 4) — applies the command to the sim,
        // executed on behalf of `executingPlayerObject`.
        public abstract void ExecuteCommand(GameCorePlayer executingPlayerObject);
    }
}
