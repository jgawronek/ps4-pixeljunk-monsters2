// GameCore/TowerStateMachine.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The tower FSM owner. Like all StateMachine<TOwner> subclasses it owns itself
// (TOwner = TowerStateMachine) and resolves its GameCoreTower from a stored
// handle (m_towerHandle @0x38, 32 bytes) so the machine stays valid across
// frame-object swaps. Default state: TowerStateIdle(shootOnSight: true) with a
// 10000 s (effectively unbounded) duration.
// Logic from Ghidra decompilation (RVA 0x4CE920..0x4E3900).

namespace GameCore
{
    public class TowerStateMachine : StateMachine<TowerStateMachine> // TypeDefIndex: 3081
    {
        private GameCoreHandle m_towerHandle;   // 0x38 (32-byte struct)

        // .ctor @0x4CE920
        // The binary inlines `new TowerStateIdle(true)` (duration 10000 baked
        // into TowerStateIdle's own ctor, m_shootOnSight = 1 @0x20,
        // m_currentBurst = 0 @0x30, m_fortDirectionBeforeCaution = Vector3.zero
        // @0x44) as the default state.
        public TowerStateMachine(GameCoreHandle towerHandle)
            : base(new TowerStateIdle(true))
        {
            m_towerHandle = towerHandle;
        }

        // GetTower @0x4E0D70 — resolves the handle to the live tower instance
        // (GetMostRecentObjectVersion; null once the tower is gone).
        public GameCoreTower GetTower()
        {
            return m_towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
        }

        // Initialize @0x4CE9F0 — empty in the binary.
        public void Initialize() { }

        // Terminate @0x4CEB10 — empty in the binary.
        public void Terminate() { }

        // StatePostExit @0x4E38F0 — empty in the binary.
        public override void StatePostExit(State<TowerStateMachine> state) { }

        // StatePreEnter @0x4E3900 — empty in the binary.
        public override void StatePreEnter(State<TowerStateMachine> state) { }
    }
}
