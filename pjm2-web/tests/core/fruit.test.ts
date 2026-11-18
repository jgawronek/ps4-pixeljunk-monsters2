// tests/core/fruit.test.ts
// Semantics tests for the GameCoreFruit full port with the ELF-CONFIRMED
// constants: ctor (appear pop, lifespan-from-acceleration quirk, meshless
// collision), ownership resolution, held pinning (+0.5), lifespan expiry /
// immortality / below-world (−20 → 0.1), water entry (killTime clamp, layer
// check), bounce→rest (0.25 threshold), enemy/player-jump/interaction
// triggers (BuffSetting flags, rumble once, use consumption), gentle/throw
// drops (0.001 threshold, 0.475/0.5 factors, −0.05 clearance), game-over.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EBuffTriggerTarget } from '../../src/core/enums';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreFruit } from '../../src/core/GameCoreFruit';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreInteractionObject } from '../../src/core/GameCoreInteractionObject';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setFruitViewerFactory,
  setMonstersAudioProvider,
  setRumbleNotifier,
  type BuffSettingContract,
  type FruitContract,
  type PickupMovementContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;
const P = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---- fixtures ----------------------------------------------------------------

function movement(overrides: Partial<PickupMovementContract> = {}): PickupMovementContract {
  return {
    appearForceMin: 2,
    appearForceMax: 2,
    appearRangeAngle: 0,
    acceleration: 10, // doubles as the initial lifespan (faithful quirk)
    bouncingRate: 0.5,
    bounceTime: -1,
    attractOffset: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function fruitData(overrides: Partial<FruitContract> = {}): FruitContract {
  return {
    name: 'fruit_bomb',
    detectDelay: 0,
    cooldownTime: 2,
    enemyDetectRange: 1.5,
    playerDetectRange: 1,
    playerJumpDetectRange: 2.5,
    isNonInteractable: false,
    scaleGround: 0.3,
    usage: 1,
    destroyWhenUsedUp: false,
    textKey: 'ITEM_BOMB',
    getComponentPickupMovement: () => movement(),
    getComponentInChildrenMeshFilter: () => null,
    getComponentsBuffSetting: () => [],
    gameObject: { activeSelf: true, setActive: () => {} },
    ...overrides,
  };
}

function makeHit(y: number, layer = 29, distance = 0.5): RaycastHit {
  return {
    point: [40, y, 40],
    normal: [0, 1, 0],
    distance,
    colliderName: 'terrain',
    layer,
    layerName: layer === 4 ? 'Water' : 'Art_Terrain',
    isTrigger: layer === 4,
  };
}

let core: GameCore;
const physicsFake: SimPhysics & { ray: RaycastHit | null; sphere: RaycastHit | null; water: boolean } = {
  ray: null,
  sphere: null,
  water: false,
  linecast: () => null,
  raycast: () => physicsFake.ray,
  sphereCast: () => physicsFake.sphere,
  checkSphere: () => physicsFake.water,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 80, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  physicsFake.ray = null;
  physicsFake.sphere = null;
  physicsFake.water = false;
  setSimPhysics(physicsFake);
  setFruitViewerFactory(null); // headless default: record doubles as viewer
  unityRandom.InitState(7);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setFruitViewerFactory(null);
  setMonstersAudioProvider(() => null);
  setRumbleNotifier(null);
  resetUnityObjectRegistryForTests();
});

function spawnFruit(
  data: FruitContract = fruitData(),
  pos: Vector3 = P(40, 0.5, 40),
  isPrefab = true,
): GameCoreFruit {
  return new GameCoreFruit(data, isPrefab, pos, null);
}

function makePlayer(pos: Vector3): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = 1;
  p.position = pos;
  return p;
}

// ---- ctor ----------------------------------------------------------------------

describe('GameCoreFruit ctor', () => {
  it('appear pop, lifespan-from-acceleration quirk, tuning copy, meshless collision', () => {
    const fr = spawnFruit();
    expect(fr.remainingLifespan).toBe(10); // movement.acceleration (faithful)
    expect(fr.remainingUses).toBe(1);
    expect(fr.textKey).toBe('ITEM_BOMB');
    expect(fr.enemyDetectionRange).toBe(1.5);
    expect(fr.playerDetectionRangeMax).toBe(2.5); // max(1, 2.5)
    expect(fr.isInteractable).toBe(true);
    expect(fr.collision.radius).toBeCloseTo(0.3, 6); // scaleGround
    expect(fr.collision.height).toBeCloseTo(0.6, 6);
  });

  it('missing movement component → immortal fallback (−1)', () => {
    // isPrefab=false: the appear-pop branch faithfully NREs without movement.
    const fr = spawnFruit(fruitData({ getComponentPickupMovement: () => null }), P(40, 0.5, 40), false);
    expect(fr.remainingLifespan).toBe(-1);
  });

  it('mesh bounds × scaleGround + ground snap (ray hit + radius×0.475)', () => {
    physicsFake.ray = makeHit(-0.5);
    const fr = spawnFruit(
      fruitData({
        getComponentInChildrenMeshFilter: () => ({
          sharedMesh: {
            bounds: {
              size: { x: 0.6, y: 0.4, z: 0.6 },
              extents: { x: 0.3, y: 0.2, z: 0.3 },
            },
          },
        }),
      }),
    );
    // bounds radius = Lerp(min(0.3,0.3), max, 0.2) = 0.3; × scaleGround 0.3 = 0.09
    expect(fr.collision.radius).toBeCloseTo(0.09, 6);
    expect(fr.position.y).toBeCloseTo(-0.5 + 0.09 * 0.475, 5);
  });
});

// ---- ownership / held ----------------------------------------------------------------

describe('ownership', () => {
  it('onGrab sets owner on the latest version; stale owner clears', () => {
    const fr = spawnFruit();
    const p = makePlayer(P(40, 0.5, 41));
    fr.onGrab(p);
    expect(fr.isHeld).toBe(true);
    expect(fr.playerOwner).toBe(p);
    expect(fr.lastPlayerOwner.equals(p.handle)).toBe(true);
    expect(fr.isInteractable).toBe(false); // held
    p.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    expect(fr.playerOwner).toBeNull();
    expect(fr.isHeld).toBe(false);
  });

  it('held fruit pins above the owner (+0.5 confirmed)', () => {
    const fr = spawnFruit();
    const p = makePlayer(P(40, 0.5, 41));
    fr.onGrab(p);
    fr.tick();
    expect(fr.position.y).toBeCloseTo(1.0, 5); // 0.5 + 0.5
    expect(fr.position.z).toBeCloseTo(41, 5);
  });
});

// ---- lifespan / water ------------------------------------------------------------------

describe('lifespan + water', () => {
  it('expiry raises fruitVanish and destroys; negative lifespan is immortal', () => {
    const vanished: GameCoreFruit[] = [];
    const cb = (x: GameCoreFruit) => vanished.push(x);
    Events.fruitVanishEvent.addListener(cb, EventTime.Immediate);
    const fr = spawnFruit(fruitData({ getComponentPickupMovement: () => movement({ acceleration: 0.05 }) }));
    fr.tick();
    fr.tick();
    expect(fr.isDestroyed()).toBe(false);
    fr.tick();
    expect(fr.isDestroyed()).toBe(true);
    expect(vanished.length).toBeGreaterThanOrEqual(1);

    const immortal = spawnFruit(fruitData({ getComponentPickupMovement: () => null }), P(40, 0.5, 40), false);
    for (let i = 0; i < 60; i++) immortal.tick();
    expect(immortal.isDestroyed()).toBe(false);
    Events.fruitVanishEvent.removeListener(cb);
  });

  it('below world (y < −20) clamps to 0.1 each tick; expiry only after rising above', () => {
    const fr = spawnFruit();
    fr.position = P(40, -25, 40);
    fr.tick();
    // FAITHFUL QUIRK: reset to 0.1 every tick while below → 0.1 − dt, never 0
    expect(fr.remainingLifespan).toBeCloseTo(0.1 - 1 / 60, 5);
    expect(fr.isDestroyed()).toBe(false);
    fr.position = P(40, 0, 40); // rise above the kill plane
    for (let i = 0; i < 7; i++) {
      if (fr.isDestroyed()) break;
      fr.tick();
    }
    expect(fr.isDestroyed()).toBe(true);
  });

  it('water entry clamps lifespan to killTime (5) and splashes; terrain hit below is NOT water', () => {
    const plays: unknown[] = [];
    setMonstersAudioProvider(() => ({
      playSFXMonitored: () => null,
      stopSFX: () => {},
      playSFX: (clip: unknown) => plays.push(clip),
    }));
    const fr = spawnFruit();
    fr.throwWithForce(makePlayer(P(40, 0.5, 41)), P(0, -1, 0)); // descending
    physicsFake.water = true;
    physicsFake.ray = makeHit(0, 4); // water layer hit
    fr.tick();
    expect(fr.remainingLifespan).toBeLessThanOrEqual(5);
    expect(fr.remainingLifespan).toBeGreaterThan(4.8);
    expect(plays).toContain('FruitWaterSplash');

    const fr2 = spawnFruit();
    fr2.throwWithForce(makePlayer(P(40, 0.5, 41)), P(0, -1, 0));
    physicsFake.ray = makeHit(0, 29); // terrain, not water
    fr2.tick();
    expect(fr2.remainingLifespan).toBeGreaterThan(9); // no clamp
  });
});

// ---- physics / rest -----------------------------------------------------------------------

describe('bounce + rest', () => {
  it('terrain sweep bounce with low speed → atRest; position frozen afterwards', () => {
    const fr = spawnFruit();
    physicsFake.sphere = makeHit(0, 29, 0.01);
    fr.tick(); // gravity vy ≈ −0.1635 → reflect ×(2×0.5)=1 → 0.1635 < 0.25 → rest
    const pos = fr.position;
    fr.tick();
    expect(fr.position).toBe(pos); // atRest → no movement
  });
});

// ---- triggers --------------------------------------------------------------------------------

describe('triggers', () => {
  it('enemy in range: BuffSetting(Enemy) applied, caboom, use consumed, cooldown set', () => {
    const applied: unknown[][] = [];
    const setting: BuffSettingContract = {
      triggerTarget: EBuffTriggerTarget.Enemy,
      addBuff: (...args: unknown[]) => applied.push(args),
    };
    const cabooms: GameCoreFruit[] = [];
    const cb = (x: GameCoreFruit) => cabooms.push(x);
    Events.fruitCaboomEvent.addListener(cb, EventTime.Immediate);

    const enemy = new GameCoreEnemy();
    enemy.position = P(40, 0.5, 41.2); // dist 1.2 − radius 0.5 = 0.7 ≤ 1.5
    const fr = spawnFruit(fruitData({ getComponentsBuffSetting: () => [setting] }));
    fr.tick();
    expect(applied.length).toBe(1);
    expect(applied[0][0]).toBe(fr);
    expect(applied[0][1]).toBe(enemy);
    expect(cabooms).toEqual([fr]);
    expect(fr.remainingUses).toBe(0);
    expect(fr.triggerable()).toBe(false); // cooldown 2
    expect(fr.isDestroyed()).toBe(false); // destroyWhenUsedUp false
    Events.fruitCaboomEvent.removeListener(cb);
  });

  it('player jump case: fruit below player → PlayerJump buff + one-shot rumble', () => {
    const applied: unknown[][] = [];
    const setting: BuffSettingContract = {
      triggerTarget: EBuffTriggerTarget.PlayerJump,
      addBuff: (...args: unknown[]) => applied.push(args),
    };
    const rumbles: Array<[number, string]> = [];
    setRumbleNotifier((id, s) => rumbles.push([id, s]));

    const p = makePlayer(P(40, 2.5, 40)); // deltaY = 0.5 − 2.5 = −2 < −0.11
    registerUnityObject(p.handle.m_handle, { playerID: 7, transform: { position: { x: 0, y: 0, z: 0 } }, gameObject: {} });
    const fr = spawnFruit(fruitData({ getComponentsBuffSetting: () => [setting] }));
    fr.tick();
    expect(applied.length).toBe(1);
    expect(applied[0][1]).toBe(p);
    expect(rumbles).toEqual([[7, 'PlayerTriggerFruit']]);
  });

  it('interaction object: triggerInterationEvent(null, handle), NO use consumed', () => {
    const events: Array<[unknown, GameCoreHandle]> = [];
    const cb = (pl: unknown, h: GameCoreHandle) => events.push([pl, h]);
    Events.triggerInterationEvent.addListener(cb, EventTime.Immediate);
    const obj = new GameCoreInteractionObject();
    obj.position = P(40, 0.2, 40);
    const fr = spawnFruit();
    fr.tick();
    expect(events.length).toBe(1);
    expect(events[0][0]).toBeNull();
    expect(events[0][1].equals(obj.handle)).toBe(true);
    expect(fr.remainingUses).toBe(1); // interaction path does not consume
    Events.triggerInterationEvent.removeListener(cb);
  });

  it('used up + destroyWhenUsedUp → destroyed', () => {
    const setting: BuffSettingContract = {
      triggerTarget: EBuffTriggerTarget.Enemy,
      addBuff: () => {},
    };
    const enemy = new GameCoreEnemy();
    enemy.position = P(40, 0.5, 41.2);
    const fr = spawnFruit(
      fruitData({ destroyWhenUsedUp: true, getComponentsBuffSetting: () => [setting] }),
    );
    fr.tick();
    expect(fr.isDestroyed()).toBe(true);
  });
});

// ---- drops --------------------------------------------------------------------------------------

describe('OnDrop / ThrowWithForce', () => {
  it('gentle drop (|force| ≤ 0.001): terrain snap + rest + owner cleared', () => {
    const fr = spawnFruit();
    const p = makePlayer(P(40, 0.5, 41));
    fr.onGrab(p);
    physicsFake.ray = makeHit(0);
    fr.onDrop(p, Vector3.zero);
    expect(fr.isHeld).toBe(false);
    expect(fr.position.y).toBeCloseTo(0.3 * 0.475, 5); // hit.y + radius×0.475
    const pos = fr.position;
    fr.tick();
    expect(fr.position).toBe(pos); // atRest
  });

  it('throw drop: probe placement (1 − r×0.5 ≤ dist) with −0.05 clearance + force velocity', () => {
    const fr = spawnFruit();
    const p = makePlayer(P(40, 0.5, 41));
    fr.onGrab(p);
    physicsFake.sphere = makeHit(0, 29, 0.9); // 0.9 ≥ 1 − 0.15 = 0.85
    const force = P(1, 2, 3);
    fr.onDrop(p, force);
    // originY = 0.5 + 1 = 1.5; y = 1.5 − (0.9 + (−0.05)) = 0.65
    expect(fr.position.y).toBeCloseTo(0.65, 5);
    expect(fr.isHeld).toBe(false);
    fr.throwWithForce(p, P(0, 5, 0));
    // velocity observable via next-tick movement; just assert no throw + not held
    expect(fr.isHeld).toBe(false);
  });
});

// ---- game over -------------------------------------------------------------------------------------

describe('OnGameOver', () => {
  it('gameOverEvent deactivates the fruit (tick no-op)', () => {
    const fr = spawnFruit();
    Events.gameOverEvent.invoke();
    const life = fr.remainingLifespan;
    fr.tick();
    expect(fr.remainingLifespan).toBe(life); // inactive → frozen
  });
});
