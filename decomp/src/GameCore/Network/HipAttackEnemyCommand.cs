// GameCore/Network/HipAttackEnemyCommand.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The player's hip-attack (butt-stomp) on an enemy: damage is typed by the
// PLAYER VIEW's strength/class (Q4.Player.strengthType/classType) through
// DamageHelper.DamageByAttributes, applied via enemy.DealPlayerDamage. Then —
// regardless of whether damage landed — the player's loose-coin drop is
// armed (the hip-attack knocks coins/gems out of the player: DropPickup with
// delay 1, loss == drop for both currencies). This is the sim half of the
// "money spills when you stomp" mechanic; ProcessDropPickup spawns them.
// Logic from Ghidra decompilation (RVA 0x4DD600..0x4DD790).

using UnityEngine;

namespace GameCore.Network
{
    internal class HipAttackEnemyCommand : NetworkCommand // TypeDefIndex: 3009
    {
        private GameCoreHandle m_enemyHandle;   // 0x10 (32-byte struct)
        private float m_power;                  // 0x30
        private int m_numCoinsToDrop;           // 0x34
        private int m_numGemsToDrop;            // 0x38
        private int m_valuePerCoin;             // 0x3C
        private int m_valuePerGem;              // 0x40

        // .ctor @0x4DD600
        public HipAttackEnemyCommand(GameCoreHandle a_enemyHandle, float a_power,
                                     int a_numCoinsToDrop, int a_numGemsToDrop,
                                     int a_valuePerCoin, int a_valuePerGem)
        {
            m_enemyHandle = a_enemyHandle;
            m_power = a_power;
            m_numCoinsToDrop = a_numCoinsToDrop;
            m_numGemsToDrop = a_numGemsToDrop;
            m_valuePerCoin = a_valuePerCoin;
            m_valuePerGem = a_valuePerGem;
        }

        // ExecuteCommand @0x4DD660 (virtual slot 4)
        public override void ExecuteCommand(GameCorePlayer a_executingPlayer)
        {
            if (m_power > 0f)
            {
                GameCoreEnemy enemy = m_enemyHandle.GetMostRecentObjectVersion<GameCoreEnemy>();
                if (enemy != null)
                {
                    if (a_executingPlayer == null)
                        return;   // binary: exception path
                    // Player attack typing lives on the VIEW prefab (the
                    // decompiler shows the raw field offsets 0x1C/0x20/0x18).
                    Q4.Player view = a_executingPlayer.handle.GetUnityObject<Q4.Player>();
                    if (view == null)
                        return;   // binary: exception path
                    float damage = DamageHelper.DamageByAttributes(
                        view.strengthType, view.classType, enemy, m_power);
                    enemy.DealPlayerDamage(a_executingPlayer, damage, 0f, view.oneKickOneBalloon);
                }
            }

            // Always arm the loose-currency spill (binary writes the player's
            // 0x80..0x9C block directly — identical to DropPickup with delay 1
            // and loss == drop counts).
            if (a_executingPlayer != null)
            {
                a_executingPlayer.DropPickup(1,
                    m_numCoinsToDrop, m_numCoinsToDrop,
                    m_numGemsToDrop, m_numGemsToDrop,
                    m_valuePerCoin, m_valuePerGem);
            }
        }
    }
}
