// GameCore/Network/DropFruitCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player throws/drops the carried fruit with a force vector. Only executes
// when the fruit is actually the one the player is carrying (handle identity
// check against the player's held-fruit slot), then broadcasts
// fruitDroppedEvent — GameCoreFruit's listener applies the throw.
// Logic from Ghidra decompilation (RVA 0x4D96E0..0x4D9830).

using UnityEngine;

namespace GameCore.Network
{
    internal class DropFruitCommand : NetworkCommand // TypeDefIndex: 3007
    {
        private GameCoreHandle m_fruitHandle;   // 0x10 (32-byte struct)
        private Vector3 m_force;                // 0x30

        // .ctor @0x4D96E0
        public DropFruitCommand(GameCoreFruit a_fruit, Vector3 a_force)
        {
            m_fruitHandle = a_fruit.handle;   // binary NREs on null fruit
            m_force = a_force;
        }

        // ExecuteCommand @0x4D9740 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer a_executingPlayer)
        {
            GameCoreFruit fruit = m_fruitHandle.GetMostRecentObjectVersion<GameCoreFruit>();
            if (fruit == null)
                return;
            if (a_executingPlayer == null)
                return;   // binary: exception path

            // Must still be the fruit this player is carrying.
            if (a_executingPlayer.HeldFruit != fruit)
                return;

            Events.fruitDroppedEvent.Invoke(a_executingPlayer, fruit, m_force);   // Events statics +0x118
        }
    }
}
