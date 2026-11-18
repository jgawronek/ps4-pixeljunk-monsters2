// GameCore/TowerStateDegenerate.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Timed marker state: the tower "degenerates" (de-grade/sell transition — the
// Q4 view keys its visuals off the state type via towerChangeStateEvent).
// No sim behavior of its own; expires by duration like every state.
// Logic from Ghidra decompilation (RVA 0x4E25F0..0x4E2660).

namespace GameCore
{
    public class TowerStateDegenerate : TowerState // TypeDefIndex: 3077
    {
        // .ctor @0x4E25F0
        public TowerStateDegenerate(float aDuration)
            : base(aDuration)
        {
        }

        // Tick @0x4E2640 (virtual slot 5) — always reports done; the machine
        // transitions on duration expiry.
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            return true;
        }

        // Enter @0x4E2650 (virtual slot 4) — base announces the state change.
        public override void Enter(TowerStateMachine owner)
        {
            base.Enter(owner);
        }

        // Exit @0x4E2660 (virtual slot 6) — plain State<T>.Exit (no-op).
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);
        }
    }
}
