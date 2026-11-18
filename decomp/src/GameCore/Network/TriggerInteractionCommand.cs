// GameCore/Network/TriggerInteractionCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player triggers an interaction object (signs, gates, switches): pure event
// relay — triggerInterationEvent (original spelling) carries the player and
// the target object's handle; GameCoreInteractionObject listens and reacts.
// Logic from Ghidra decompilation (RVA 0x4DF8D0..0x4DF970).

using UnityEngine;

namespace GameCore.Network
{
    internal class TriggerInteractionCommand : NetworkCommand // TypeDefIndex: 3018
    {
        private GameCoreHandle m_gco;   // 0x10 (32-byte struct)

        // .ctor @0x4DF8D0
        public TriggerInteractionCommand(GameCoreHandle a_gco)
        {
            m_gco = a_gco;
        }

        // ExecuteCommand @0x4DF900 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            Events.triggerInterationEvent.Invoke(executingPlayerObject, m_gco);   // Events statics +0x120
        }
    }
}
