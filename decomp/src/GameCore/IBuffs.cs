// GameCore/IBuffs.cs
// Reconstructed from IL2CPP metadata v23 (Il2CppUserAssemblies.elf, PixelJunk
// Monsters 2, PS4 CUSA11967, Unity 5.6.5p1). Interface-only type: no method
// bodies exist in the binary (RVA -1); shape confirmed from skeleton/dump.cs
// (TypeDefIndex 3023) and from call sites (BuffFreeze/BuffSlow ExecuteBuff).

namespace GameCore
{
    /// <summary>
    /// Implemented by sim objects that can carry timed buffs
    /// (<see cref="GameCoreEnemy"/> and <see cref="GameCorePlayer"/>).
    /// </summary>
    public interface IBuffs
    {
        BuffContainer Buffs { get; }   // get_Buffs, interface slot 0
    }
}
