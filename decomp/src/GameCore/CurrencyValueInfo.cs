// GameCore/CurrencyValueInfo.cs
// Reconstructed from IL2CPP decompilation + metadata v23 (TypeDefIndex 3052).
// Logic: GameCore.CurrencyValueInfo$$.ctor @0x942260 (trivial field stores).
// Used by playerBumpedEvent (loose coins/gems dropped when a player is bumped)
// and consumed by Q4.PickupManager.OnPlayerBumped.

namespace GameCore
{
    /// <summary>
    /// A currency amount split into a total value and a per-pickup value:
    /// e.g. total=10, perValue=5 → two coins worth 5 each.
    /// </summary>
    public struct CurrencyValueInfo
    {
        public int total;      // 0x0
        public int perValue;   // 0x4

        // .ctor @0x942260
        public CurrencyValueInfo(int aTotal, int aPerValue)
        {
            total = aTotal;
            perValue = aPerValue;
        }
    }
}
