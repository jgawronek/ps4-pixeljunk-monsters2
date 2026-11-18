// src/main/simReset.ts
// Reset path for the sim's process-wide (module/static) state, so a second stage in the same
// process/page behaves exactly like a fresh load. GameCore/Events/GameCoreHandle/CoreObjectPool/the
// Unity-object registry are module-level singletons in the port (the original relies on a scene reload).
//
// Used by: StageSession.dispose() (browser), tests/main/multistage-sim.test.ts + headless runner
// (`runHeadlessStage`), the disposal-audit probe. `simGlobalCounters()` is the audit's source of truth.

import { Events } from '../core/Events';
import { CoreEventBase } from '../core/event/CoreEvent';
import { unityRandom } from '../engine/rng/UnityRandom';
import { CoreObjectPool } from '../core/CoreObjectPool';
import { GameCore, setInstanceProvider } from '../core/GameCore';
import { setBoundsProvider } from '../core/GameCoreCollisionManager';
import { setHomeQueryHeight } from '../core/GameCoreHome';
import { GameCoreHandle, setViewerResolver } from '../core/GameCoreHandle';
import { setSimPhysics } from '../core/physics-seam';
import {
  resetUnityObjectRegistryForTests,
  setCurrentStageProvider,
  setEnemyViewerFactory,
  setGamePreferencesProvider,
  setProjectileViewerFactory,
  setTowerDatabaseProvider,
  setTowerViewerFactory,
  unityObjectCount,
} from '../view/q4-contracts';
import { resetAllEventsForTests } from '../core/Events';

/** Clear every sim-global: event listeners/replay buffers, handle allocator, object pools, registered
 *  view objects, tick delta, and the provider hooks (so closures over a dead stage are released). */
export function resetSimGlobals(): void {
  resetAllEventsForTests(); // all Events.* listeners + CoreEventBase pending sets
  GameCoreHandle.resetStaticsForTests();
  CoreObjectPool.resetInstanceForTests();
  resetUnityObjectRegistryForTests();
  GameCore.setTickDeltaTime(0.16);
  // Unity's global RNG: a fresh process starts at InitState(0); the home's chibi layout (SpawnChibi/SpreadOut)
  // draws from it at construction, BEFORE the first tick re-seeds it — so a stale state changes the stage.
  unityRandom.InitState(0);
  // Providers: drop closures (they capture the dead stage's world/contracts).
  setInstanceProvider(null);
  setViewerResolver(null);
  setBoundsProvider(null as never);
  setHomeQueryHeight(0); // faithful default (see GameCoreHome)
  setSimPhysics(null as never);
  setCurrentStageProvider((() => null) as never);
  setGamePreferencesProvider((() => ({ difficultySetting: 1 })) as never);
  setEnemyViewerFactory(null as never);
  setTowerViewerFactory(null as never);
  setProjectileViewerFactory(null as never);
  setTowerDatabaseProvider(null);
}

export interface SimGlobalCounters {
  /** Sum of registered listeners over every Events.* static. */
  eventListeners: number;
  /** Objects in the Unity-object (view) registry. */
  unityObjects: number;
}

export function simGlobalCounters(): SimGlobalCounters {
  let n = 0;
  for (const key of Object.getOwnPropertyNames(Events)) {
    const v = (Events as unknown as Record<string, unknown>)[key];
    if (v instanceof CoreEventBase) n += v.listenerCount();
  }
  return { eventListeners: n, unityObjects: unityObjectCount() };
}
