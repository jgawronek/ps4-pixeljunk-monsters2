// src/core/event/EventTime.ts
// Port of decomp/src/GameCore/Event/EventTime.cs (metadata TypeDefIndex 2894).
// When a CoreEvent listener is notified relative to the simulation tick.

export enum EventTime {
  Immediate = 0, // invoked synchronously inside CoreEvent.Invoke()
  PostGameCoreTick = 1, // replayed after GameCore.Tick() finishes (same frame)
  PostUnityUpdate = 2, // replayed after the view/Unity Update pass
}
