// tests/core/pickups.test.ts
// Semantics tests for the Pickup family port: ctor prefab/viewer wiring (incl.
// the meshless FAITHFUL quirk), launch RNG determinism, lifespan/below-world
// expiry, water kill (AISettings + audio), bounce physics against the fake
// Rapier seam (reflect/damping/rest + bounceTime quirks), detection-delay
// gate, suck-to-player collection (coin credit vs gem NOT-credited quirk),
// game-over deactivation, and the PickupManager fruit-drop schedule (RNG tree
// choice, stale-handle skip, max-fruits timer reset).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EInventoryType } from '../../src/core/GameCoreInventory';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreFruit } from '../../src/core/GameCoreFruit';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreInventory } from '../../src/core/GameCoreInventory';
import { GameCorePickupCurrency } from '../../src/core/GameCorePickupCurrency';
import { GameCorePickupManager } from '../../src/core/GameCorePickupManager';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import { GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import { COIN_PREFAB, GEM_PREFAB } from '../../src/data/pickupPrefabs';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  registerUnityObject,
  setAISettingsProvider,
  setCurrentStageProvider,
  setDifficultySettingsProvider,
  setMonstersAudioProvider,
  setPickupManagerViewFinder,
  setPickupViewerFactory,
  setStageHubProvider,
  type NatureTreeViewContract,
  type PickupManagerContract,
  type PickupMovementContract,
  type PickupPrefabContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- fixtures ----------------------------------------------------------------

class TestCurrency extends GameCorePickupCurrency {
  get velocity(): Vector3 {
    return this.m_currentVelocity;
  }
  setVelocity(v: Vector3): void {
    this.m_currentVelocity = v;
  }
  get active(): boolean {
    return this.m_active;
  }
  get delay(): number {
    return this.m_detectionDelay;
  }
  get bounceTime(): number {
    return this.m_bounceTime;
  }
  setBounceTime(v: number): void {
    this.m_bounceTime = f(v);
  }
}

const MESH_BOUNDS = {
  size: { x: 0.4, y: 0.3, z: 0.4 },
  extents: { x: 0.2, y: 0.15, z: 0.2 },
};

function movement(overrides: Partial<PickupMovementContract> = {}): PickupMovementContract {
  return {
    appearForceMin: 2,
    appearForceMax: 2, // fixed force → deterministic launch magnitude
    appearRangeAngle: 0, // no tilt → velocity exactly up × force
    acceleration: 10,
    bouncingRate: 0.5,
    bounceTime: -1, // unlimited
    attractOffset: { x: 0, y: 0.5, z: 0 },
    ...overrides,
  };
}

function coinPrefab(overrides: Partial<PickupPrefabContract> = {}): PickupPrefabContract {
  return {
    name: 'coin_001',
    detectRange: 0.5,
    detectDelay: 0.5,
    value: 5,
    lifespan: 10,
    meshBounds: MESH_BOUNDS,
    movement: movement(),
    ...overrides,
  };
}

let core: GameCore;
const physicsFake: SimPhysics & { waterHits: boolean; sphereHit: RaycastHit | null } = {
  waterHits: false,
  sphereHit: null,
  linecast: () => null,
  raycast: () => null,
  sphereCast: () => physicsFake.sphereHit,
  checkSphere: () => physicsFake.waterHits,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60); // TickDeltaTime for direct .tick() calls below
  setViewerResolver((h) => getRegisteredUnityObject(h));
  physicsFake.waterHits = false;
  physicsFake.sphereHit = null;
  setSimPhysics(physicsFake);
  setAISettingsProvider(() => ({
    pickupWaterKillTime: 3,
    overtakeSlowerEnemies: true,
    enableEnemyBlocking: true,
  }));
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setAISettingsProvider(null);
  setDifficultySettingsProvider(null);
  setPickupViewerFactory(null);
  resetUnityObjectRegistryForTests();
  setCurrentStageProvider(() => null);
  setStageHubProvider(null);
  setPickupManagerViewFinder(null);
  setMonstersAudioProvider(() => null);
});

const POS = new Vector3(40, 0, 40);

function makePlayer(id: number, pos: Vector3 = POS): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = pos;
  return p;
}

function makeCurrency(
  prefab: PickupPrefabContract | null = coinPrefab(),
  type: EInventoryType = EInventoryType.Coin,
  value = -1,
  pos: Vector3 = POS,
): TestCurrency {
  const c = new TestCurrency(prefab, pos, type, value);
  return c;
}

/** Minimal adopted-component fruit for PickupManager count tests. */
function makeCountFruit(): GameCoreFruit {
  return new GameCoreFruit(
    {
      name: 'count_fruit',
      detectDelay: 0,
      cooldownTime: 0,
      enemyDetectRange: 1,
      playerDetectRange: 1,
      playerJumpDetectRange: 1,
      isNonInteractable: false,
      scaleGround: 0.3,
      usage: 1,
      destroyWhenUsedUp: false,
      textKey: 'TEST',
      getComponentPickupMovement: () => null,
      getComponentInChildrenMeshFilter: () => null,
      getComponentsBuffSetting: () => [],
      gameObject: { activeSelf: true, setActive: () => {} },
    },
    false,
    POS,
    null,
  );
}

// ---- ctor ----------------------------------------------------------------------

describe('GameCorePickup ctor', () => {
  it('wires viewer registry, position, lifespan, bounds-collision, detection values and events', () => {
    const c = makeCurrency(coinPrefab({ detectRange: 1.25, detectDelay: 0.25 }), EInventoryType.Gem);
    expect(getRegisteredUnityObject(c.handle.m_handle)).not.toBeNull();
    expect(c.position).toBe(POS);
    expect(c.remainingLifespan).toBe(10);
    expect(c.collision.height).toBeCloseTo(0.3, 6); // fromBounds: size.y
    expect(c.collision.radius).toBeCloseTo(0.2, 6); // Lerp(min,max extents, 0.2)
    expect(c.inventoryType).toBe(EInventoryType.Gem);
    expect(c.detectionRange).toBeCloseTo(1.25, 6);
    expect(c.delay).toBeCloseTo(0.25, 6);
    // launch: angle 0, force 2 → exactly up × 2
    expect(c.velocity.x).toBe(0);
    expect(c.velocity.y).toBe(2);
    expect(c.velocity.z).toBe(0);
    // gameOverEvent subscription (mesh branch ran):
    Events.gameOverEvent.invoke();
    expect(c.active).toBe(false);
    c.tick();
    expect(c.remainingLifespan).toBe(10); // inactive → frozen
  });

  it('FAITHFUL QUIRK: meshless viewer skips collision/type/events entirely', () => {
    const c = makeCurrency(
      coinPrefab({ meshBounds: null, detectRange: 3 }),
      EInventoryType.Gem,
    );
    expect(c.inventoryType).toBe(EInventoryType.Coin); // type NOT copied (default 0)
    expect(c.detectionRange).toBeCloseTo(0.5, 6); // prefab value NOT copied
    expect(c.collision.radius).toBeCloseTo(0.5, 6); // default volume kept
    Events.gameOverEvent.invoke(); // not subscribed → still active
    expect(c.active).toBe(true);
    c.tick();
    expect(c.remainingLifespan).toBeLessThan(10); // lifespan still ticks
  });

  it('null prefab → inert object that expires on the first tick (faithful degenerate path)', () => {
    const lost: unknown[] = [];
    const cb = (p: unknown) => lost.push(p);
    Events.pickupLostEvent.addListener(cb, EventTime.Immediate);
    const c = makeCurrency(null);
    expect(getRegisteredUnityObject(c.handle.m_handle)).toBeNull();
    expect(c.remainingLifespan).toBe(0);
    c.tick(); // lifespan 0 → Max(0−dt,0)=0 → lost + destroyed
    expect(c.isDestroyed()).toBe(true);
    expect(lost).toEqual([c]);
    Events.pickupLostEvent.removeListener(cb);
  });

  it('no movement component → zero launch velocity; lifespan still read', () => {
    const c = makeCurrency(coinPrefab({ movement: null }));
    expect(c.velocity.x).toBe(0);
    expect(c.velocity.y).toBe(0);
    expect(c.velocity.z).toBe(0);
    expect(c.remainingLifespan).toBe(10);
  });

  it('launch RNG draw order is deterministic (force, axis.x, axis.z) and rotation preserves magnitude', () => {
    const prefab = coinPrefab({ movement: movement({ appearRangeAngle: 30 }) });
    unityRandom.InitState(1234);
    const c1 = makeCurrency(prefab);
    const v1 = { x: c1.velocity.x, y: c1.velocity.y, z: c1.velocity.z };
    unityRandom.InitState(1234);
    const c2 = makeCurrency(prefab);
    expect({ x: c2.velocity.x, y: c2.velocity.y, z: c2.velocity.z }).toEqual(v1);
    expect(c1.velocity.magnitude).toBeCloseTo(2, 5); // AngleAxis is a rotation
  });
});

describe('GameCorePickupCurrency ctor value logic', () => {
  it('value falls back to the prefab when the argument < 1; explicit values win', () => {
    expect(makeCurrency(coinPrefab(), EInventoryType.Coin, -1).value).toBe(5);
    expect(makeCurrency(coinPrefab(), EInventoryType.Coin, 7).value).toBe(7);
  });

  it('difficulty scaling applies to coins AND gems (faithful)', () => {
    setDifficultySettingsProvider(() => ({
      valueCoinByDifficulty: (v: number) => Math.max(1, Math.trunc(f(v * 1.25))),
      enemyHPByDifficulty: (v: number) => Math.max(1, Math.trunc(f(v * 1.25))),
      towerBuildTimeByDifficulty: (v: number) => v,
      enemyToSpawnByDifficulty: (n: number) => Math.max(1, n),
    }));
    expect(makeCurrency(coinPrefab(), EInventoryType.Coin).value).toBe(6); // trunc(6.25)
    expect(makeCurrency(coinPrefab(), EInventoryType.Gem).value).toBe(6);
  });

  it('non-currency prefab (no value field) early-outs: value stays 1', () => {
    const plain: PickupPrefabContract = {
      name: 'plain',
      detectRange: 0.5,
      detectDelay: 0,
      lifespan: 5,
      meshBounds: MESH_BOUNDS,
    };
    const c = makeCurrency(plain);
    expect(c.value).toBe(1);
  });

  it('attractOffset shifts the suck target above the player (+0x38)', () => {
    const p = makePlayer(1); // at POS
    const c = makeCurrency(
      coinPrefab({
        detectDelay: 0,
        movement: movement({ acceleration: 10, attractOffset: { x: 0, y: 0.6, z: 0 } }),
      }),
      EInventoryType.Coin,
      -1,
      POS, // exactly at the player — only the offset gives a direction
    );
    c.pickup(p);
    c.tick();
    // toTarget = player.pos + (0, 0.6, 0) − pos → moves UP toward the offset
    expect(c.position.y).toBeGreaterThan(0);
  });
});

// ---- lifespan / water ------------------------------------------------------------

describe('lifespan and water', () => {
  it('counts down and raises pickupLostEvent + DestroySelf at exactly 0', () => {
    const lost: unknown[] = [];
    const cb = (p: unknown) => lost.push(p);
    Events.pickupLostEvent.addListener(cb, EventTime.Immediate);
    const c = makeCurrency(coinPrefab({ lifespan: 0.05, detectDelay: 0 }));
    c.tick();
    c.tick();
    expect(c.isDestroyed()).toBe(false);
    c.tick(); // 0.05 − 3×(1/60) < 0 → clamped 0 → lost
    expect(c.isDestroyed()).toBe(true);
    expect(lost).toEqual([c]);
    expect(c.remainingLifespan).toBe(0);
    Events.pickupLostEvent.removeListener(cb);
  });

  it('negative lifespan = immortal', () => {
    const c = makeCurrency(coinPrefab({ lifespan: -1 }));
    for (let i = 0; i < 100; i++) c.tick();
    expect(c.isDestroyed()).toBe(false);
    expect(c.remainingLifespan).toBe(-1);
  });

  it('FAITHFUL QUIRK: below world (y < −20) resets the field to 0.1 each tick but counts down a fresh local — only dt ≥ 0.1 frames expire it', () => {
    const c = makeCurrency(coinPrefab({ lifespan: 100 }));
    c.position = new Vector3(40, -25, 40);
    for (let i = 0; i < 10; i++) c.tick();
    expect(c.isDestroyed()).toBe(false); // 0.1 − 1/60 never reaches 0
    expect(c.remainingLifespan).toBeCloseTo(f(0.1 - f(1 / 60)), 6);
    // A slow frame (TickDeltaTime ≥ 0.1) kills it instantly:
    core.tick(0.15);
    expect(c.isDestroyed()).toBe(true);
  });

  it('water entry clamps lifespan to AISettings.PickupWaterKillTime and plays the SFX', () => {
    const plays: unknown[] = [];
    setMonstersAudioProvider(() => ({
      playSFXMonitored: () => null,
      stopSFX: () => {},
      playSFX: (clip: unknown) => plays.push(clip),
    }));
    const c = makeCurrency(coinPrefab({ lifespan: 10 }));
    c.setVelocity(new Vector3(0, -1, 0));
    physicsFake.waterHits = true;
    c.tick();
    expect(c.isInWater).toBe(true);
    // Min(10, killTime 3) = 3, then TickLifeSpan decrements within the same tick
    expect(c.remainingLifespan).toBeLessThanOrEqual(3);
    expect(c.remainingLifespan).toBeGreaterThan(2.9);
    expect(plays).toEqual(['ItemLostInWater']);
    // leaving water resets the flag (faithful unconditional assignment)
    physicsFake.waterHits = false;
    c.setVelocity(new Vector3(0, -1, 0));
    c.tick();
    expect(c.isInWater).toBe(false);
  });

  it('rising pickups never water-check; dying in water plays ItemDieInWater', () => {
    const plays: unknown[] = [];
    setMonstersAudioProvider(() => ({
      playSFXMonitored: () => null,
      stopSFX: () => {},
      playSFX: (clip: unknown) => plays.push(clip),
    }));
    const c = makeCurrency();
    c.setVelocity(new Vector3(0, 2, 0)); // rising
    physicsFake.waterHits = true;
    c.tick();
    expect(c.isInWater).toBe(false); // no check while vy ≥ 0
    // now sink into water and destroy
    c.setVelocity(new Vector3(0, -1, 0));
    c.tick();
    expect(c.isInWater).toBe(true);
    c.destroySelf();
    expect(plays).toEqual(['ItemLostInWater', 'ItemDieInWater']);
  });

  it('AISettings default = verified extraction (pickupWaterKillTime 5.0, globalsettings AISettings.asset)', () => {
    setAISettingsProvider(null); // fall back to the data-verified default
    const c = makeCurrency(coinPrefab({ lifespan: 10 }));
    c.setVelocity(new Vector3(0, -1, 0));
    physicsFake.waterHits = true;
    c.tick();
    expect(c.isInWater).toBe(true);
    expect(c.remainingLifespan).toBeLessThanOrEqual(5); // Min(10, 5.0)
    expect(c.remainingLifespan).toBeGreaterThan(4.9); // minus one dt
  });
});

// ---- bounce physics ----------------------------------------------------------------

describe('bounce physics (fake Rapier seam)', () => {
  const hit: RaycastHit = {
    point: [40, 0, 40],
    normal: [0, 1, 0],
    distance: 0.01,
    colliderName: 'terrain_001',
    layer: 29,
    layerName: 'Art_Terrain',
    isTrigger: false,
  };

  it('free flight: gravity integrates and position advances', () => {
    const c = makeCurrency();
    c.setVelocity(new Vector3(0, 2, 0));
    const y0 = c.position.y;
    c.tick();
    const dt = f(1 / 60);
    expect(c.velocity.y).toBeCloseTo(f(2 + f(-9.81 * dt)), 5);
    expect(c.position.y).toBeGreaterThan(y0);
  });

  it('surface hit: stops at the surface, reflects with factor×bounceRate; bounceTime −1 stays unlimited', () => {
    const c = makeCurrency();
    c.setVelocity(new Vector3(0, -2, 0));
    physicsFake.sphereHit = hit;
    c.tick();
    // gravity → vy ≈ −2.1635; Dot(up, down) = −1 → factor 2; ×(2×0.5)=1 → vy ≈ +2.1635
    expect(c.velocity.y).toBeGreaterThan(2);
    expect(c.bounceTime).toBe(-1); // FAITHFUL: −1 never decrements
  });

  it('bounceTime counts down per bounce (2 → 1)', () => {
    const c = makeCurrency();
    c.setBounceTime(2);
    c.setVelocity(new Vector3(0, -2, 0));
    physicsFake.sphereHit = hit;
    c.tick();
    expect(c.bounceTime).toBe(1);
    expect(c.velocity.y).toBeGreaterThan(0); // bouncingRate 0.5 applied
  });

  it('FAITHFUL QUIRK: bounceTime 0 → zero bounce rate (rest) but counter wraps to −1', () => {
    const c = makeCurrency();
    c.setBounceTime(0);
    c.setVelocity(new Vector3(0, -2, 0));
    physicsFake.sphereHit = hit;
    c.tick();
    expect(c.velocity.magnitude).toBe(0); // rate 0 killed the reflection
    const restPos = c.position;
    c.tick();
    expect(c.position).toBe(restPos); // magnitude < 0.5 → at rest → frozen
    expect(c.bounceTime).toBe(-1); // (0 != -1) → decremented anyway
  });

  it('at rest: no further movement or gravity', () => {
    const c = makeCurrency();
    c.setBounceTime(0);
    c.setVelocity(new Vector3(0, -2, 0));
    physicsFake.sphereHit = hit;
    c.tick(); // → atRest
    const pos = c.position;
    const vel = c.velocity;
    c.tick();
    expect(c.position).toBe(pos); // unchanged reference & value
    expect(c.velocity).toBe(vel);
  });
});

// ---- collection ---------------------------------------------------------------------

describe('detection gate + suck-to-player collection', () => {
  it('Pickup() only attaches once detectionDelay has elapsed', () => {
    const p = makePlayer(1, new Vector3(40, 0, 41));
    const c = makeCurrency(); // delay 0.5
    c.pickup(p);
    expect(c.pickupPlayer).toBeNull();
    for (let i = 0; i < 30; i++) c.tick(); // delay → 0
    expect(c.delay).toBe(0);
    c.pickup(p);
    expect(c.pickupPlayer).toBe(p);
    expect(c.remainingLifespan).toBe(-1); // immortal while carried
    // velocity points at the player
    expect(c.velocity.z).toBeGreaterThan(0);
  });

  it('arrival: pickupAcquiredEvent + coin credit + DestroySelf', () => {
    setCurrentStageProvider(() => ({ initCoin: 0, initGem: 0, initWaveCoinRate: 1, initWaveTimeRate: 1.75 }));
    const p = makePlayer(1);
    const c = makeCurrency(
      coinPrefab({ detectDelay: 0, movement: movement({ acceleration: 1000 }) }),
      EInventoryType.Coin,
      -1,
      new Vector3(40, 0, 40.1),
    );
    const acquired: Array<[GameCorePlayer, unknown]> = [];
    const cb = (pl: GameCorePlayer, pk: unknown) => acquired.push([pl, pk]);
    Events.pickupAcquiredEvent.addListener(cb, EventTime.Immediate);

    c.pickup(p);
    expect(c.pickupPlayer).toBe(p);
    c.tick(); // accelerates toward player.position + attractOffset
    expect(c.isDestroyed()).toBe(false);
    c.tick(); // step overshoots the remaining distance → collect
    expect(acquired).toEqual([[p, c]]);
    expect(c.isDestroyed()).toBe(true);
    const inv = GameCoreInventory.getInventoryObject()!;
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(5);
    Events.pickupAcquiredEvent.removeListener(cb);
  });

  it('FAITHFUL QUIRK: gems are NOT credited by the sim (view handles them)', () => {
    setCurrentStageProvider(() => ({ initCoin: 0, initGem: 0, initWaveCoinRate: 1, initWaveTimeRate: 1.75 }));
    const p = makePlayer(1);
    const c = makeCurrency(
      coinPrefab({ detectDelay: 0, movement: movement({ acceleration: 1000 }) }),
      EInventoryType.Gem,
      -1,
      new Vector3(40, 0, 40.1),
    );
    c.pickup(p);
    c.tick();
    c.tick();
    expect(c.isDestroyed()).toBe(true);
    const inv = GameCoreInventory.getInventoryObject()!;
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Gem)).toBe(0);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(0);
  });

  it('zero acceleration: carried pickup never arrives and stays immortal', () => {
    const p = makePlayer(1, new Vector3(40, 0, 42));
    const c = makeCurrency(
      coinPrefab({ detectDelay: 0, movement: movement({ acceleration: 0 }) }),
    );
    c.pickup(p);
    for (let i = 0; i < 100; i++) c.tick();
    expect(c.isDestroyed()).toBe(false);
    expect(c.remainingLifespan).toBe(-1);
  });

  it('FAITHFUL: a destroyed player makes SuckToPlayer throw (no null guard in the binary)', () => {
    const p = makePlayer(1, new Vector3(40, 0, 42));
    const c = makeCurrency(coinPrefab({ detectDelay: 0 }));
    c.pickup(p);
    p.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    expect(() => c.tick()).toThrow();
  });

  it('game over deactivates; stage cleared is a no-op; destroy detaches listeners', () => {
    const c = makeCurrency();
    const wm = new GameCoreWaveManager();
    Events.stageClearedEvent.invoke(wm); // no-op, must not throw
    Events.gameOverEvent.invoke();
    expect(c.active).toBe(false);
    c.destroySelf();
    Events.gameOverEvent.invoke(); // listener removed → safe
    Events.stageClearedEvent.invoke(wm);
  });
});

// ---- verified stage-1 prefab data ------------------------------------------------------

describe('verified stage-1 prefab records (data lane)', () => {
  it('COIN_PREFAB drives the sim ctor: value 20, range 1.8, delay 1.5, lifespan 42.9, serialized-AABB cylinder', () => {
    const c = makeCurrency(COIN_PREFAB);
    expect(c.value).toBe(20);
    expect(c.detectionRange).toBeCloseTo(1.8, 6);
    expect(c.delay).toBeCloseTo(1.5, 6);
    expect(c.remainingLifespan).toBeCloseTo(42.9, 4);
    expect(c.collision.height).toBeCloseTo(0.34158504, 6); // 2 × serialized extent.y
    expect(c.collision.radius).toBeCloseTo(0.0654666, 6); // Lerp(min,max extents, 0.2)
  });

  it('GEM_PREFAB: value 1, range 2.4, lifespan 57.2, gem type flows through', () => {
    const c = makeCurrency(GEM_PREFAB, EInventoryType.Gem);
    expect(c.value).toBe(1);
    expect(c.detectionRange).toBeCloseTo(2.4, 6);
    expect(c.remainingLifespan).toBeCloseTo(57.2, 4);
    expect(c.collision.height).toBeCloseTo(0.39733788, 6);
    expect(c.inventoryType).toBe(EInventoryType.Gem);
  });
});

// ---- PickupManager ---------------------------------------------------------------------

describe('GameCorePickupManager fruit-drop schedule', () => {
  function setupManager(opts: {
    treeHandles: GameCoreHandle[];
    maxFruits: number;
    schedule: Array<{ time: number }>;
  }): { manager: GameCorePickupManager; drops: Array<{ data: unknown; pos: unknown; mv: unknown }>; view: PickupManagerContract } {
    const manager = new GameCorePickupManager(null);
    const drops: Array<{ data: unknown; pos: unknown; mv: unknown }> = [];
    const view: PickupManagerContract = {
      hiddenPickupData: [],
      createPickup: () => null,
      hiddenFruitData: opts.schedule,
      maximumFruitsOnGround: opts.maxFruits,
      fruitTreeHandleList: opts.treeHandles,
      createFruit: (data, pos, mv) => {
        drops.push({ data, pos, mv });
        return null;
      },
      gameObject: { tag: 'pickupManager' },
    };
    // Scene bootstrap links the view via the bridge:
    registerUnityObject(manager.handle.m_handle, view);
    setStageHubProvider(() => ({ pickupManager: view }));
    return { manager, drops, view };
  }

  function makeTreeWithViewer(x: number): { tree: GameCoreTree; mv: PickupMovementContract } {
    const tree = new GameCoreTree(new Vector3(x, 0, 40));
    const mv = movement();
    const treeView: NatureTreeViewContract = {
      playerDetectionRange: 2,
      towerDirection: { x: 0, y: 0, z: 1 },
      getComponentPickupMovement: () => mv,
      getHiddenTreePickup: () => null,
      transform: { position: { x, y: 0, z: 40 } },
      gameObject: { activeSelf: true, setActive: () => {} },
    };
    registerUnityObject(tree.handle.m_handle, treeView);
    return { tree, mv };
  }

  it('drops at the scheduled time on a random live tree, then exhausts the schedule', () => {
    const { tree, mv } = makeTreeWithViewer(41);
    const { manager, drops, view } = setupManager({
      treeHandles: [tree.handle],
      maxFruits: 2,
      schedule: [{ time: 0.5 }],
    });
    unityRandom.InitState(7);
    for (let i = 0; i < 20; i++) manager.tick(); // ≈0.33s < 0.5
    expect(drops.length).toBe(0);
    for (let i = 0; i < 20; i++) manager.tick(); // ≈0.67s ≥ 0.5 → drop
    expect(drops.length).toBe(1);
    expect(drops[0].data).toBe(view.hiddenFruitData![0]);
    expect(drops[0].pos).toBe(tree.position);
    expect(drops[0].mv).toBe(mv);
    for (let i = 0; i < 60; i++) manager.tick(); // schedule exhausted
    expect(drops.length).toBe(1);
  });

  it('at maximumFruitsOnGround the timer resets; drops resume when a fruit is gone', () => {
    const { tree } = makeTreeWithViewer(41);
    const { manager, drops } = setupManager({
      treeHandles: [tree.handle],
      maxFruits: 2,
      schedule: [{ time: 0.5 }],
    });
    const fruit1 = makeCountFruit();
    const fruit2 = makeCountFruit();
    fruit1.position = POS;
    fruit2.position = POS;
    unityRandom.InitState(7);
    for (let i = 0; i < 40; i++) manager.tick(); // saturated → timer held at 0
    expect(drops.length).toBe(0);
    fruit1.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    for (let i = 0; i < 40; i++) manager.tick(); // 1 < 2 → timer runs → drop
    expect(drops.length).toBe(1);
  });

  it('skips stale tree handles (do/while) and still drops on a live tree', () => {
    const { tree } = makeTreeWithViewer(41);
    const stale = new GameCoreTree(new Vector3(42, 0, 40));
    stale.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    const { manager, drops } = setupManager({
      treeHandles: [stale.handle, tree.handle],
      maxFruits: 2,
      schedule: [{ time: 0.5 }],
    });
    unityRandom.InitState(7);
    for (let i = 0; i < 40; i++) manager.tick();
    expect(drops.length).toBe(1);
    expect(drops[0].pos).toBe(tree.position);
  });

  it('empty tree list → quiet return (no hang, no drop)', () => {
    const { manager, drops } = setupManager({
      treeHandles: [],
      maxFruits: 2,
      schedule: [{ time: 0.5 }],
    });
    for (let i = 0; i < 40; i++) manager.tick();
    expect(drops.length).toBe(0);
  });

  it('no linked view → tick is a no-op; RecreateViewer falls back to FindObjectOfType', () => {
    const manager = new GameCorePickupManager(null);
    expect(() => manager.tick()).not.toThrow();
    expect(manager.recreateViewer()).toBeNull();
    const { view } = setupManager({ treeHandles: [], maxFruits: 1, schedule: [] });
    // manager (unregistered) now finds the view through the finder hook:
    setPickupManagerViewFinder(() => view);
    expect(manager.recreateViewer()).toBe(view.gameObject);
  });
});
