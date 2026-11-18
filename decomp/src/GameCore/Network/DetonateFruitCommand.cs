// GameCore/Network/DetonateFruitCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Detonates the carried bomb-fruit. FAITHFUL FINDING: the shipped binary has
// an EMPTY ctor and an EMPTY ExecuteCommand — the command is a vestigial
// placeholder (bomb-fruit detonation is driven elsewhere: the Q4 view /
// BuffBomb path). Reproduced empty on purpose.
// Logic from Ghidra decompilation (RVA 0x4D96C0..0x4D96D0).

using UnityEngine;

namespace GameCore.Network
{
    internal class DetonateFruitCommand : NetworkCommand // TypeDefIndex: 3006
    {
        // .ctor @0x4D96C0 — empty in the binary.
        public DetonateFruitCommand() { }

        // ExecuteCommand @0x4D96D0 (virtual slot 4) — empty in the binary.
        public override void ExecuteCommand(GameCorePlayer a_executingPlayer) { }
    }
}
