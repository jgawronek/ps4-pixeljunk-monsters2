// GameCore/Network/SellTowerCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Player sells a tower: destroys the sim tower, broadcasts the sell event
// (the view layer pays out the refund), and releases every tree the tower was
// built from (referenceCount--, reviving trees that hit 0).
// Logic from Ghidra decompilation (RVA 0x4DE9A0..0x4DEDA0).

using UnityEngine;

namespace GameCore.Network
{
    public class SellTowerCommand : NetworkCommand // TypeDefIndex: 3014
    {
        private GameCoreHandle m_towerhandle;   // 0x10 (32-byte struct)
        private int m_refundCoin;               // 0x30
        private int m_refundGem;                // 0x34

        // .ctor @0x4DE9A0
        public SellTowerCommand(GameCoreHandle towerHandle, int refundCoin, int refundGem)
        {
            m_towerhandle = towerHandle;
            m_refundCoin = refundCoin;
            m_refundGem = refundGem;
        }

        // ExecuteCommand @0x4DE9E0 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer executingPlayerObject)
        {
            GameCoreTower tower = m_towerhandle.GetMostRecentObjectVersion<GameCoreTower>();
            if (tower == null)
                return;

            tower.DestroySelf();   // vtable slot 6

            // The view layer listens and credits the refund.
            Events.towerSellEvent.Invoke(tower, executingPlayerObject, m_refundCoin, m_refundGem);   // +0xC8

            if (tower.retainedTrees != null)
            {
                int reviveIndex = 0;
                foreach (GameCoreHandle h in tower.retainedTrees)
                {
                    GameCoreTree tree = h.GetMostRecentObjectVersion<GameCoreTree>();
                    if (tree != null)
                    {
                        // Binary inlines: tree.referenceCount--; when it hits 0
                        // treeReviveEvent fires — identical to GameCoreTree.Revive.
                        tree.Revive(executingPlayerObject, reviveIndex);
                        reviveIndex++;
                    }
                }
            }
        }
    }
}
