// GameCore/Network/PickupFruitCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player picks up a fruit. Unowned fruit → fruitPickedUpEvent (the sim-side
// grab wiring listens). Fruit owned by ANOTHER player, or a fruit handle that
// no longer resolves → the requesting player's VIEW is force-reset (motor
// drops its carried fruit prop and the tikiman FSM is forced to Idle) so the
// presentation can never desync into a "carrying" pose without a sim fruit.
// Logic from Ghidra decompilation (RVA 0x4DDE70..0x4DE140).

using UnityEngine;

namespace GameCore.Network
{
    internal class PickupFruitCommand : NetworkCommand // TypeDefIndex: 3012
    {
        private GameCoreHandle m_fruitHandle;   // 0x10 (32-byte struct)

        // .ctor @0x4DDE70 — takes the live sim fruit; stores its handle.
        public PickupFruitCommand(GameCoreFruit a_fruit)
        {
            m_fruitHandle = a_fruit.handle;   // binary NREs on null fruit
        }

        // ExecuteCommand @0x4DDEA0 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer a_executingPlayer)
        {
            GameCoreFruit fruit = m_fruitHandle.GetMostRecentObjectVersion<GameCoreFruit>();
            if (fruit == null)
            {
                // Fruit vanished mid-request: reset the view's carry state.
                ForcePlayerViewDropFruit(a_executingPlayer);
                return;
            }

            GameCorePlayer owner = fruit.playerOwner;
            if (owner == null)
            {
                // Free fruit — the real pickup: sim listeners (GameCoreFruit /
                // GameCorePlayer) hook this event and do the grab bookkeeping.
                Events.fruitPickedUpEvent.Invoke(a_executingPlayer, fruit);   // Events statics +0x100
                return;
            }

            // Owned fruit: only actionable when the requester is NOT the last
            // owner; otherwise force-reset the requesting view (cannot steal).
            if (a_executingPlayer != null &&
                fruit.LastPlayerOwner.m_handle != a_executingPlayer.handle.m_handle)
            {
                ForcePlayerViewDropFruit(a_executingPlayer);
            }
        }

        // Shared view-reset path (inlined twice in the binary): resolve the
        // Q4.Player view (the decompiler's GetUnityObject<Structure> label is a
        // shared-generic artifact — the confirmed instantiation is Q4.Player),
        // drop the motor's fruit prop and force the tikiman FSM to Idle.
        private static void ForcePlayerViewDropFruit(GameCorePlayer player)
        {
            if (player == null)
                return;
            Q4.Player view = player.GetUnityObject<Q4.Player>();
            if (view == null)
                return;   // binary: exception path
            if (view.Motor == null)
                return;   // binary: exception path
            view.Motor.DropFruit();
            Q4.TikimanStateMachine stateMachine = view.Motor.StateMachine;
            Q4.TikimanStateIdle idle = new Q4.TikimanStateIdle();
            if (stateMachine == null)
                return;   // binary: exception path
            stateMachine.ForceCurrentCommand(idle, null);
        }
    }
}
