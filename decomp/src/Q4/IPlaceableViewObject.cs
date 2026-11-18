// Q4/IPlaceableViewObject.cs
// Reconstructed from IL2CPP metadata v23 (dump.cs line 174600, TypeDefIndex 2994).
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// NOTE ON NAMESPACE/LOCATION: the task scope calls this "Q4.IPlaceableViewObject",
// but the metadata places it in the GameCore namespace (internal interface).
// It is filed here with the Q4 seam sources for convenience; the namespace below
// is the confirmed one. No method body exists (interface, RVA -1, Slot 0).
//
// This is the level-bootstrap contract: GameCoreBridge.CreateGameCoreFromCurrentUnityScene
// (@0x44A2D0) scans the scene for MonoBehaviours implementing this interface and
// calls CreateGameCoreObject() on each to populate the initial simulation frame.
//
// Confirmed implementors (skeleton/Q4.cs, explicit interface implementations):
//   Q4.WaveManager      -> GameCoreWaveManager   (CreateGameCoreObject @0x9024A0)
//   Q4.Player           -> GameCorePlayer        (@0x3EA730)
//   Q4.Home             -> GameCoreHome          (@0x462650)
//   Q4.PickupManager    -> GameCorePickupManager (@0x3E5700)
//   Q4.Shop             -> GameCoreShop          (@0x75E900)
//   Q4.TowerBase        -> GameCoreTower         (@0x54BB00, via Structure)
//   Q4.NatureTree       -> GameCoreTree          (@0x64A310, via Structure)
//   Q4.InteractionObject-> GameCoreInteractionObject (@0x464CB0)
//   Q4.Fruit            -> GameCoreFruit         (@0x439510)

namespace GameCore
{
    internal interface IPlaceableViewObject
    {
        // Slot: 0 — creates the sim-side object for this placed Unity view.
        // Implementations typically also register the view with the bridge via
        // GameCoreBridge.SetUnityObject(handle, this) themselves.
        GameCoreObject CreateGameCoreObject();
    }
}