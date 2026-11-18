// src/core/GameCore.ts
// TypeScript port of decomp/src/GameCore/GameCore.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2972,
// RVA 0x4AA2B0..0x4AB020). The simulation root: owns the collision manager and
// the current GameCoreFrame and drives the tick.
//
// C#: GameCore.Instance reads Q4.GameCoreBridge.Instance.m_gameCore.
// TS ADAPTATION: an instance provider hook (setInstanceProvider) — the browser
// bridge port registers `() => bridge.m_gameCore` exactly reproducing the
// indirection; the headless harness registers its own root. Null provider →
// null instance → GameCoreObject ctors skip registration (faithful to the
// original's bridge==null path).
//
// C# Tick() reads UnityEngine.Time.deltaTime; TS ADAPTATION: tick(deltaTime)
// takes the wall delta from the driver (browser: RAF delta; headless: fixed
// step). The clamp Min(dt, 0.5) is the original's.

import { Mathf } from '../engine/math';
import { CoreEventBase } from './event/CoreEvent';
import { CoreObjectPool } from './CoreObjectPool';
import { Cylinder } from './Cylinder';
import { GameCoreCollisionManager } from './GameCoreCollisionManager';
import { GameCoreFrame } from './GameCoreFrame';
import { GameCoreHandle, setFrameResolver } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import type { Vector3 } from '../engine/math/Vector3';

const f = Math.fround;

export type GameCoreInstanceProvider = () => GameCore | null;
let instanceProvider: GameCoreInstanceProvider | null = null;

/** Browser bridge / headless harness register the root here. */
export function setInstanceProvider(p: GameCoreInstanceProvider | null): void {
  instanceProvider = p;
}

export class GameCore {
  static readonly ticksPerSecond = 60; // const, confirmed

  // Static TickDeltaTime (statics +0x0). SP: rewritten every tick to
  // Min(Time.deltaTime, 0.5); network matches force 1/60 (out of scope).
  private static s_tickDeltaTime = f(0.16); // literal 0x3E23D70A initial value
  static get tickDeltaTime(): number {
    return GameCore.s_tickDeltaTime;
  }
  static setTickDeltaTime(v: number): void {
    GameCore.s_tickDeltaTime = f(v);
  }

  private m_collisionManager: GameCoreCollisionManager; // 0x10
  private lastUpdateTime = 0; // 0x18
  private m_extremeDesyncTesting = false; // 0x1C
  private m_currentFrame: GameCoreFrame; // 0x20

  // get_Instance @0x4AA810 — via the registered provider (see header).
  static get instance(): GameCore | null {
    return instanceProvider ? instanceProvider() : null;
  }

  // .ctor @0x4AA2B0
  constructor() {
    this.m_collisionManager = new GameCoreCollisionManager();
    GameCoreHandle.resetNextHandleIndex();
    GameCore.s_tickDeltaTime = f(0.16); // Tick() overwrites it each frame
    this.m_currentFrame = CoreObjectPool.allocate(
      GameCoreFrame as unknown as new () => GameCoreFrame,
    );
    this.m_currentFrame.m_frameTime = 0;

    // Handle resolution (GameCoreHandle port uses a resolver hook; C# reads
    // GameCore.Instance.currentFrame directly).
    setFrameResolver((handleId: number) => {
      const core = GameCore.instance;
      if (core === null) return null;
      return core.m_currentFrame.getObjectById(handleId);
    });

    // "-desynctesting" command-line flag (literal confirmed). Node only;
    // browsers have no command line → stays false.
    try {
      const argv =
        typeof process !== 'undefined' && process.argv ? (process.argv as string[]) : null;
      if (argv !== null) {
        for (const arg of argv) {
          if (arg.toLowerCase() === '-desynctesting') this.m_extremeDesyncTesting = true;
        }
      }
    } catch {
      /* no process in browser */
    }
  }

  get currentFrame(): GameCoreFrame {
    return this.m_currentFrame;
  }

  // get_collisionManager @0x4AA7F0
  get collisionManager(): GameCoreCollisionManager {
    return this.m_collisionManager;
  }

  get extremeDesyncTesting(): boolean {
    return this.m_extremeDesyncTesting;
  }

  // PrepareNextFrame @0x4AA8C0
  // Advances the frame clock and runs the in-place pre-tick pass. The return of
  // createFrameCopyForUpdate is discarded (it returns the same frame mutated).
  prepareNextFrame(): void {
    this.lastUpdateTime = f(this.lastUpdateTime + GameCore.s_tickDeltaTime);
    this.m_currentFrame.createFrameCopyForUpdate(this.lastUpdateTime);
  }

  // Tick @0x4AAB30
  // SP: clamp the step to the wall delta (max 0.5 s), tick all objects, then
  // fire post-tick events. (Online 1/60 fixed step + NetworkLog.EndLogFrame
  // are out of scope.)
  tick(deltaTime: number): void {
    GameCore.s_tickDeltaTime = Mathf.Min(f(deltaTime), 0.5);

    this.m_currentFrame.tickAllObjects(this.m_extremeDesyncTesting);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
  }

  /** View-layer pass (driver calls after rendering): PostUnityUpdate replays. */
  invokePendingPostUnityUpdateEvents(): void {
    CoreEventBase.invokePendingPostUnityUpdateEvents();
  }

  // InstallFrame @0x4AB020
  installFrame(frame: GameCoreFrame): void {
    this.m_currentFrame = frame;
    GameCoreHandle.invalidateAllCachedData();
    this.m_collisionManager.init();
  }

  // FirstObject<T> @0x2C5DC0 (TS: ctor passed explicitly)
  firstObject<T extends GameCoreObject>(type: Function): T | null {
    return this.m_currentFrame.firstObject<T>(type);
  }

  // AllObjects<T> (wrapper MoveNext @0x76F590)
  *allObjects<T extends GameCoreObject>(type: Function): IterableIterator<T> {
    yield* this.m_currentFrame.allObjects<T>(type);
  }

  // AllObjects<T>(Vector3, Cylinder) @0x76FAD0 — spatial query via the grid.
  *allObjectsIn<T extends GameCoreObject>(
    type: Function,
    a_pos: Vector3,
    a_cylinder: Cylinder,
  ): IterableIterator<T> {
    if (this.m_collisionManager === null) return;
    yield* this.m_collisionManager.intersectingObjects<T>(
      type,
      a_pos,
      a_cylinder.radius,
      a_cylinder.height,
    );
  }
}

/** Marker so GameCoreObject can be referenced without a value cycle in docs. */
export type { GameCoreObject };
