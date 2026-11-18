// GameCore/IDamageable.cs
// Reconstructed from IL2CPP metadata v23 (Il2CppUserAssemblies.elf).
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Anything a tower/projectile can aim at and deal damage to: the enemy body
// itself (GameCoreEnemy) and its individual attack points (GameCoreEnemyAttackPoint).
// Interface slot numbers from the skeleton; no bodies (interface).

using UnityEngine;
using Q4; // enemy type enums (EEnemyStrengthTypeDef / EEnemyClassTypeDef / EEnemyMoveTypeDef)

namespace GameCore
{
    public interface IDamageable
    {
        bool IsAimableTarget(GameCoreTower tower);                       // Slot 0
        bool ValidateTarget();                                           // Slot 1
        void DealDamage(GameCoreObject damageSource, float damageToDeal,
            float distanceToCenterRate, GameCoreObject attackPoint,
            bool immediateDestroy = true);                               // Slot 2
        void DealDamage(EEnemyStrengthTypeDef strengthType, EEnemyClassTypeDef classType,
            float damageToDeal, float distanceToCenterRate, GameCoreObject damageSource,
            GameCoreObject attackPoint, bool immediateDestroy = true);   // Slot 3
        Cylinder Collision();                                            // Slot 4
        Vector3 Position();                                              // Slot 5
        void PredictPositionAndDirection(out Vector3 pos, out Vector3 direction, float aTime); // Slot 6
        GameCoreHandle Handle();                                         // Slot 7
        GameObject UnityObject();                                        // Slot 8
        EEnemyMoveTypeDef MoveType();                                    // Slot 9
        GameCoreEnemy Host();                                            // Slot 10
        bool Valid();                                                    // Slot 11
    }
}