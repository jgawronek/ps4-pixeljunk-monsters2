// src/core/NetworkLog.ts
// Minimal port of GameCore.Network.NetworkLog (original: the online desync
// frame-hash log; TypeDefIndex in GameCore_Network skeleton). Single-player
// semantics: the sim sprinkles null-safe `NetworkLog.Instance?.Log(...)` /
// `EndLogFrame()` calls; with no network match the instance stays null in the
// shipped game. This port keeps the same null-instance default and offers an
// opt-in collecting instance for determinism debugging (the replay-hash
// harness of Phase 5 can enable it).

export class NetworkLog {
  /** C#: NetworkLog.Instance — null unless a network match (or debug) sets it. */
  static instance: NetworkLog | null = null;

  private frames: Array<Array<{ message: string; checkValue: number }>> = [];
  private current: Array<{ message: string; checkValue: number }> = [];

  // Log(string message, int checkValue, bool includeStack = false)
  log(message: string, checkValue: number, _includeStack = false): void {
    this.current.push({ message, checkValue: checkValue | 0 });
  }

  // EndLogFrame @frame boundary (called from GameCore.Tick in the original).
  endLogFrame(): void {
    this.frames.push(this.current);
    this.current = [];
  }

  /** Debug/replay access to the recorded frame logs. */
  get recordedFrames(): ReadonlyArray<ReadonlyArray<{ message: string; checkValue: number }>> {
    return this.frames;
  }
}
