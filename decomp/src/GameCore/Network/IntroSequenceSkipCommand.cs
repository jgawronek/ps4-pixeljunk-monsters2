// GameCore/Network/IntroSequenceSkipCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Skips the stage intro (the "walk to the tower" scripted sequence): raises
// introSequenceFinishedEvent with the skipping player, which releases the
// wave manager's start delay exactly like the natural sequence end.
// Logic from Ghidra decompilation (RVA 0x4DD780..0x4DD7F0).

using UnityEngine;

namespace GameCore.Network
{
    internal class IntroSequenceSkipCommand : NetworkCommand // TypeDefIndex: 3010
    {
        // .ctor @0x4DD780 — empty.
        public IntroSequenceSkipCommand() { }

        // ExecuteCommand @0x4DD790 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            Events.introSequenceFinishedEvent.Invoke(executingPlayerObject);   // Events statics +0x0
        }
    }
}
