// GameCore/BuffSettingOverrideFreeze.cs
// Reconstructed from IL2CPP decompilation + metadata v23 (TypeDefIndex 3417).
// Logic: .ctor @0x93ECE0 is just System.Object..ctor (no field initialization).
// Data class used by tower upgrades (GameCoreTower.upgradeBuffOverride) to tune
// freeze strength/duration; consumed by Q4.BuffSettingFreeze.InternalAddBuff.

namespace GameCore
{
    /// <summary>
    /// Marker interface for buff-setting overrides (metadata: empty interface,
    /// TypeDefIndex 3416). Placed here alongside its only implementation.
    /// </summary>
    public interface IBuffSettingOverride
    {
    }

    [System.Serializable]
    public class BuffSettingOverrideFreeze : IBuffSettingOverride
    {
        public float speedScale;   // 0x10
        public float duration;     // 0x14

        // .ctor @0x93ECE0 — default constructor, fields left at 0.
        public BuffSettingOverrideFreeze()
        {
        }
    }
}
