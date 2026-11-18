// src/main/sim-driver.ts
// The verified SP driver seam — TypeScript port of the single-player half of
// Q4.GameCoreBridge.Update (decomp/src/Q4/GameCoreBridge.cs, lines 9-58):
//
//   CheckForNextUpdateFrame(t):
//     while updateCount < target:                  (target = updateCount+1 in SP)
//       if networkBridge.GameCoreMustWait() -> stop   (SP: no players)
//       Random.InitState((int)updateCount)            (determinism aid)
//       m_gameCore.PrepareNextFrame()                 @0x4AA8C0
//       m_networkBridge.OnGameCoreTicked()            @0x4DC7D0  (commands run here)
//       m_gameCore.Tick()                             @0x4AAB30
//       updateCount++
//
// Verified corrections baked in:
//   * SP ticks ONCE per frame — not fixed 60 Hz; GameCore.tick clamps
//     dt = min(wallDt, 0.5) internally (cap @0x00B7C248).
//   * Commands execute BETWEEN prepareNextFrame() and tick().
//   * The view-pose sampling half of OnGameCoreTicked is a Phase 3 concern;
//     headless sims have no views to sample.
//
// Used by every harness: the headless stage-1 sim (headless-stage1.ts), the
// browser game loop, and tests.

import { unityRandom } from '../engine/rng/UnityRandom';
import { GameCore, setInstanceProvider } from '../core/GameCore';
import { GameCorePlayer } from '../core/GameCorePlayer';
import { GameCoreNetworkBridge } from '../core/network/GameCoreNetworkBridge';
import type { NetworkCommand } from '../core/network/NetworkCommand';
import { setGameCoreTickEnabledProvider } from '../view/q4-contracts';

export class SimDriver {
  readonly core: GameCore;
  readonly bridge: GameCoreNetworkBridge;
  /** C#: GameCoreBridge.updateCount — the sim tick counter that seeds RNG. */
  updateCount = 0;
  /** C#: GameCoreBridge.m_enableGameCoreTick. */
  gameCoreTickEnabled = true;

  constructor() {
    this.core = new GameCore();
    this.bridge = new GameCoreNetworkBridge();
    setInstanceProvider(() => this.core);
    // SpawnFruitCommand's ctor reads this to decide whether to pay the fruit
    // cost immediately (pre-game queues).
    setGameCoreTickEnabledProvider(() => this.gameCoreTickEnabled);
  }

  /** Queue a gameplay command (SP loopback — executes on the next step). */
  addPlayerCommand(command: NetworkCommand, player: GameCorePlayer | null): void {
    this.bridge.addPlayerCommand(command, player);
  }

  /** C#: networkBridge.GameCoreMustWait() — SP: waits while there are no
   *  players (Player.players.Count == 0). */
  gameCoreMustWait(): boolean {
    for (const _p of this.core.allObjects<GameCorePlayer>(GameCorePlayer)) return false;
    return true;
  }

  /** One SP frame: the full verified pipeline. `wallDeltaTime` is seconds.
   *  Returns false when the tick was skipped (must-wait or tick disabled). */
  step(wallDeltaTime: number): boolean {
    if (!this.gameCoreTickEnabled) return false; // C#: m_enableGameCoreTick gate

    // SP: target = updateCount + 1 — exactly one tick per call; the must-wait
    // check is the loop's only stop condition.
    if (this.gameCoreMustWait()) return false;

    unityRandom.InitState(this.updateCount | 0); // Random.InitState((int)updateCount)
    this.core.prepareNextFrame();
    this.bridge.onGameCoreTicked();
    this.core.tick(wallDeltaTime); // dt = min(wallDt, 0.5) applied inside
    this.updateCount++;
    return true;
  }

  /** C#: LateUpdate — post-Unity-update event replays. Call once per frame
   *  after step() (browser: after rendering). */
  lateUpdate(): void {
    this.core.invokePendingPostUnityUpdateEvents();
  }

  /** Advance N frames at a fixed wall delta (headless harnesses). Skipped
   *  ticks (must-wait) still consume loop iterations, as in the real game. */
  runFrames(frames: number, wallDeltaTime: number): void {
    for (let i = 0; i < frames; i++) {
      this.step(wallDeltaTime);
      this.lateUpdate();
    }
  }
}
