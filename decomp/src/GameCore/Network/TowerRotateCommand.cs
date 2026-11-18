// GameCore/Network/TowerRotateCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Manual turret aiming: snaps the tower's fort direction to the given Euler
// angles (the player drags the aim reticle; the view samples it into this
// command every frame while aiming).
// Logic from Ghidra decompilation (RVA 0x4DF710..0x4DF830).

using UnityEngine;

namespace GameCore.Network
{
    public class TowerRotateCommand : NetworkCommand // TypeDefIndex: 3004
    {
        private GameCoreHandle m_towerHandle;   // 0x10 (32-byte struct)
        private float m_rotateX;                // 0x30
        private float m_rotateY;                // 0x34

        // .ctor @0x4DF710
        public TowerRotateCommand(GameCoreHandle towerHandle, Vector2 rotateEuler)
        {
            m_towerHandle = towerHandle;
            m_rotateX = rotateEuler.x;
            m_rotateY = rotateEuler.y;
        }

        // ExecuteCommand @0x4DF750 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower tower = m_towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower != null)
                tower.fortDirection = Quaternion.Euler(m_rotateX, m_rotateY, 0f) * Vector3.forward;
        }
    }
}
