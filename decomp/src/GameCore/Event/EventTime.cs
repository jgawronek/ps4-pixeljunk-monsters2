// GameCore/Event/EventTime.cs
// Reconstructed from metadata v23 (TypeDefIndex 2894) — enum values confirmed.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// When a CoreEvent listener is notified relative to the simulation tick.

namespace GameCore.Event
{
    public enum EventTime
    {
        Immediate = 0,         // invoked synchronously inside CoreEvent.Invoke()
        PostGameCoreTick = 1,  // replayed after GameCore.Tick() finishes (same frame)
        PostUnityUpdate = 2,   // replayed after the Q4/Unity Update pass
    }
}
