// GameCore/ISpeedScale.cs
// Reconstructed from IL2CPP metadata v23 (Il2CppUserAssemblies.elf).
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Objects whose movement speed can be scaled (e.g. by Slow/Freeze/FastPlayer
// buffs). Implemented by GameCoreEnemy and GameCorePlayer.

namespace GameCore
{
    public interface ISpeedScale
    {
        float GetSpeedScale();          // Slot 0
        void SetSpeedScale(float speed); // Slot 1
    }
}