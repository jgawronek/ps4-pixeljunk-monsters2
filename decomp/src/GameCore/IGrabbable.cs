// GameCore/IGrabbable.cs
// Reconstructed from IL2CPP metadata v23 (TypeDefIndex 3047). Interface-only
// type (RVA -1); implemented by GameCoreFruit (throwable consumable items).
// Signatures confirmed from skeleton/GameCore.cs; usage confirmed from
// GameCorePlayer.OnFruitDropped (calls fruit.OnDrop(player, force) @0x4C2Dxx).

namespace GameCore
{
    /// <summary>
    /// A sim object the player can pick up, carry and throw (fruit items).
    /// </summary>
    public interface IGrabbable
    {
        void OnGrab(GameCorePlayer player);                     // slot 0
        void OnDrop(GameCorePlayer player, UnityEngine.Vector3 a_force); // slot 1
        void ThrowWithForce(GameCorePlayer player, UnityEngine.Vector3 force); // slot 2
    }
}
