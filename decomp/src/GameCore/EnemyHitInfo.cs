// GameCore/EnemyHitInfo.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Payload describing a single hit on an enemy: who dealt it, how much, and how
// "strong" the damage/reaction is against this enemy's attributes.
// Field offsets from global-metadata.dat; logic from Ghidra decompilation.
// The named .ctor @0x945160 is a thin wrapper; the real body is FUN_00945140.

namespace GameCore
{
    public struct EnemyHitInfo
    {
        public GameCoreObject damageSource;      // 0x0
        public GameCoreEnemy toEnemy;            // 0x8
        public float damage;                     // 0x10
        public bool strongToDamage;              // 0x14
        public float distanceToCenterRate;       // 0x18
        public float reactionRate;               // 0x1C
        public bool strongReaction;              // 0x20

        // .ctor @0x945160 (body FUN_00945140)
        public EnemyHitInfo(GameCoreObject by, GameCoreEnemy to, float aDmg, bool aStrong,
            float aDis, float aRct, bool aStrongReaction)
        {
            damageSource = by;
            toEnemy = to;
            damage = aDmg;
            strongToDamage = aStrong;
            distanceToCenterRate = aDis;
            reactionRate = aRct;
            strongReaction = aStrongReaction;
        }
    }
}