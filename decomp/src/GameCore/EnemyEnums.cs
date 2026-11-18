// GameCore/EnemyEnums.cs
// Reconstructed from IL2CPP metadata v23 (Il2CppUserAssemblies.elf).
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// Enemy data-definition enums. NOTE: these types belong to the Q4 namespace in the
// original assembly (they are shared between the Q4 presentation/database layer and the
// GameCore simulation). They are placed in this folder because the enemy/AI/damage
// subsystem reconstruction is scoped to decomp/src/GameCore/; the namespace below is kept
// faithful to the metadata. Values transcribed verbatim from the skeleton / dump.cs.

namespace Q4
{
    // TypeDefIndex 2729 — presentation-side enemy state.
    public enum EEnemyMode
    {
        Move = 0,
        Attack = 1,
        Dead = 2,
        Drown = 3
    }

    // TypeDefIndex 2730 (internal)
    internal enum EAttackType
    {
        GroundAttack = 0,
        JumpAttack = 1
    }

    // TypeDefIndex 2731 — how an enemy spawns (normal / on fire / riding balloons).
    public enum ESpawnMode
    {
        Normal = 0,
        Fire = 1,
        Balloon = 2
    }

    // TypeDefIndex 2732
    public enum EBossType
    {
        None = 0,
        Bero = 1,
        Fat = 2,
        Tall = 3,
        Kao = 4
    }

    // TypeDefIndex 2811 — damage "class" (magic / physical / normal).
    public enum EEnemyClassTypeDef
    {
        unknown = 0,
        Normal = 1,
        Magic = 2,
        Physic = 3
    }

    // TypeDefIndex 2812 — enemy prefab/database ids.
    public enum EEnemyDef
    {
        unknown = 0,
        kuri_00_001 = 1,
        kuri_01_001 = 2,
        kuri_02_001 = 3,
        kuri_03_001 = 4,
        kuri_04_001 = 5,
        kuri_05_001 = 6,
        giant_00_001 = 7,
        giant_01_001 = 8,
        giant_02_001 = 9,
        giant_03_001 = 10,
        giant_04_001 = 11,
        giant_05_001 = 12,
        spider_00_001 = 13,
        spider_01_001 = 14,
        spider_02_001 = 15,
        spider_03_001 = 16,
        spider_04_001 = 17,
        spider_05_001 = 18,
        cisors_00_001 = 19,
        cisors_01_001 = 20,
        cisors_02_001 = 21,
        cisors_03_001 = 22,
        cisors_04_001 = 23,
        cisors_05_001 = 24,
        kurukuru_00_001 = 25,
        kurukuru_01_001 = 26,
        kurukuru_02_001 = 27,
        kurukuru_03_001 = 28,
        kurukuru_04_001 = 29,
        kurukuru_05_001 = 30,
        bee_00_001 = 31,
        bee_01_001 = 32,
        bee_02_001 = 33,
        bee_03_001 = 34,
        bee_04_001 = 35,
        bee_05_001 = 36,
        bat_00_001 = 37,
        bat_01_001 = 38,
        bat_02_001 = 39,
        bat_03_001 = 40,
        bat_04_001 = 41,
        bat_05_001 = 42,
        boss_00_001 = 43,
        boss_00_002 = 44,
        boss_00_003 = 45,
        boss_00_004 = 46,
        boss_00_005 = 47,
        boss_00_006 = 48
    }

    // TypeDefIndex 2813 — ground vs air movement.
    public enum EEnemyMoveTypeDef
    {
        unknown = 0,
        ground = 1,
        air = 2
    }

    // TypeDefIndex 2814 — damage "strength" (normal / soft / hard).
    public enum EEnemyStrengthTypeDef
    {
        unknown = 0,
        Normal = 1,
        Soft = 2,
        Hard = 3
    }
}