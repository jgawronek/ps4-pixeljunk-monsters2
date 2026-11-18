// GameCore/TowerState.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Base class of the tower FSM states (Idle/Attack/Build/UpgradeAround/ChangeMag/
// Broken/Degenerate). On Enter it announces the state change to the view layer
// via Events.towerChangeStateEvent (payload: tower + the new state — the Q4
// TowerAnimator/TowerBase views key their visuals off the concrete state type).
// Logic from Ghidra decompilation (RVA 0x4E0CD0..0x4E0F10).

namespace GameCore
{
    public class TowerState : State<TowerStateMachine> // TypeDefIndex: 3072
    {
        // .ctor @0x4E0CD0
        public TowerState(float aDuration)
            : base(aDuration)
        {
        }

        // GetTower @0x4E0D20
        // Resolves the owner machine's tower handle (inlined in the binary —
        // identical to owner.GetTower(); null when owner or tower is gone).
        protected GameCoreTower GetTower(TowerStateMachine owner)
        {
            if (owner == null)
                return null;
            return owner.GetTower();
        }

        // Tick @0x4E0DC0 (virtual slot 5) — base default reports "done".
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            return true;
        }

        // Enter @0x4E0DD0 (virtual slot 4)
        public override void Enter(TowerStateMachine owner)
        {
            Events.towerChangeStateEvent.Invoke(GetTower(owner), this);   // Events statics +0xD0
            base.Enter(owner);
        }

        // Exit @0x4E0EC0 (virtual slot 6) — base call only.
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);
        }
    }
}
