// GameCore/Network/TowerAttackComamnd.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Manual fire: forces one immediate attack shot on the tower (burst timer 0,
// burst count 0, forceAttack = true). NOTE: the class name keeps the original
// "Comamnd" typo (metadata TypeDefIndex 3005).
// Logic from Ghidra decompilation (RVA 0x4DF5A0..0x4DF6A0).
// State duration literal DAT_00b7c49c = 10000.0f is baked into TowerStateAttack.

using UnityEngine;

namespace GameCore.Network
{
    public class TowerAttackComamnd : NetworkCommand // TypeDefIndex: 3005 [sic]
    {
        private GameCoreHandle m_towerHandle;   // 0x10 (32-byte struct)

        // .ctor @0x4DF5A0
        public TowerAttackComamnd(GameCoreHandle towerHandle)
        {
            m_towerHandle = towerHandle;
        }

        // ExecuteCommand @0x4DF5D0 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower tower = m_towerHandle.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower == null)
                return;
            // vtable entry 26 = slot 9 = SetTowerState; forced single shot.
            tower.SetTowerState(new TowerStateAttack(0f, 0, true));
        }
    }
}
