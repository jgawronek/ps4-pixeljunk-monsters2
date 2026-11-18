// GameCore/TowerStateBuild.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Tower construction state: on Enter the final position is recorded and the
// tower is dropped one `height` below ground; each Tick it rises at a constant
// speed (height / duration) via Vector3.MoveTowards, and Exit snaps it exactly
// onto the recorded final position. The rising body double-tasks as the build
// animation (the Q4 view follows core.position).
// Logic from Ghidra decompilation (RVA 0x4E0A40..0x4E22E0).

using UnityEngine;

namespace GameCore
{
    public class TowerStateBuild : TowerState // TypeDefIndex: 3075
    {
        private Vector3 m_towerPosition;   // 0x20 — recorded final position
        private float m_buildSpeed;        // 0x2C — height / duration, set on Enter

        // .ctor @0x4E0AB0
        public TowerStateBuild(float aDuration)
            : base(aDuration)
        {
            m_towerPosition = Vector3.zero;
        }

        // get_towerFinalPosition @0x4E2050
        public Vector3 towerFinalPosition
        {
            get { return m_towerPosition; }
        }

        // GetBuildStartPosition @0x4E0A40 (static)
        public static Vector3 GetBuildStartPosition(GameCoreTower tower)
        {
            return tower.position + Vector3.down * tower.height;
        }

        // Enter @0x4E2130 (virtual slot 4)
        public override void Enter(TowerStateMachine owner)
        {
            base.Enter(owner);   // TowerState.Enter → towerChangeStateEvent

            GameCoreTower tower = GetTower(owner);
            if (tower != null)
            {
                m_towerPosition = tower.position;
                // Start fully buried; rise exactly over the state duration.
                // (position setter re-buckets the collision grid — the binary
                //  inlines UpdateCoreObject here.)
                tower.position = tower.position + Vector3.down * tower.height;
                m_buildSpeed = tower.height / duration;
            }
        }

        // Tick @0x4E2060 (virtual slot 5)
        public override bool Tick(TowerStateMachine owner, float dt)
        {
            GameCoreTower tower = GetTower(owner);
            if (tower != null)
            {
                tower.position = Vector3.MoveTowards(
                    tower.position, m_towerPosition, dt * m_buildSpeed);
            }
            return true;
        }

        // Exit @0x4E2240 (virtual slot 6)
        public override void Exit(TowerStateMachine owner)
        {
            base.Exit(owner);

            GameCoreTower tower = GetTower(owner);
            if (tower != null)
            {
                tower.position = m_towerPosition;   // exact snap onto the build spot
            }
        }
    }
}
