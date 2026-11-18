// tests/core/player.test.ts
// Semantics tests for the GameCorePlayer port: forward derivation, the
// CheckForPickups range² quirk, hidden tree pickup reveal (indexed + directly
// set + guard paths), delayed loose-coin drops with the wave multiplier, fruit
// carry/drop via the event hub, statics, and the viewer re-link.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { BuffContainer } from '../../src/core/BuffContainer';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CurrencyValueInfo } from '../../src/core/CurrencyValueInfo';
import { CoreEventBase, EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreFruit } from '../../src/core/GameCoreFruit';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreInventory, EInventoryType } from '../../src/core/GameCoreInventory';
import { GameCorePickup } from '../../src/core/GameCorePickup';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import { GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import {
  setAllTreesInSceneProvider,
  setCurrentStageProvider,
  setNetworkMatchInstanceProvider,
  setPlayerViewsFinder,
  setStageHubProvider,
  type HiddenPickupData,
  type NatureTreeViewContract,
  type PlayerViewContract,
} from '../../src/view/q4-contracts';

// ---- fixtures ----------------------------------------------------------------

class TestPickup extends GameCorePickup {
  pickedBy: GameCorePlayer[] = [];
  constructor() {
    // prefab=null → the faithful inert path (no viewer, no events, defaults).
    super(null, Vector3.zero, EInventoryType.Coin);
  }
  override pickup(player: GameCorePlayer): void {
    this.pickedBy.push(player);
  }
  override onStageCleared(): void {}
  override onGameOver(): void {}
  setRange(r: number): void {
    this.m_detectionRange = Math.fround(r);
  }
}

class TestFruit extends GameCoreFruit {
  drops: Array<{ player: GameCorePlayer; force: Vector3 }> = [];
  constructor() {
    // Adopted scene component (isPrefab=false → no appear-pop physics).
    super(
      {
        name: 'test_fruit',
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
        getComponentPickupMovement: () => null, // lifespan fallback −1 (immortal)
        getComponentInChildrenMeshFilter: () => null,
        getComponentsBuffSetting: () => [],
        gameObject: { activeSelf: true, setActive: () => {} },
      },
      false,
      Vector3.zero,
      null,
    );
  }
  override onDrop(player: GameCorePlayer, force: Vector3): void {
    this.drops.push({ player, force });
  }
}

let core: GameCore;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setCurrentStageProvider(() => null);
  setStageHubProvider(null);
  setPlayerViewsFinder(null);
  setAllTreesInSceneProvider(null);
  setNetworkMatchInstanceProvider(null);
});

const ORIGIN = new Vector3(40, 0, 40);

function makePlayer(id: number, pos: Vector3 = ORIGIN): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = pos;
  return p;
}

function makeTreeView(overrides: Partial<NatureTreeViewContract> = {}): NatureTreeViewContract {
  return {
    playerDetectionRange: 2,
    towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: 41, y: 0, z: 40 } },
    gameObject: { activeSelf: true, setActive: () => {} },
    ...overrides,
  };
}

// ---- tests ---------------------------------------------------------------------

describe('GameCorePlayer ctor', () => {
  it('early-outs without a GameCore instance (no buffs, no handle, defaults kept)', () => {
    setInstanceProvider(null);
    const p = new GameCorePlayer();
    expect(p.towerDanceHandle).toBe(-1);
    expect(p.getSpeedScale()).toBe(1);
    expect(p.buffs).toBeNull(); // C#: m_buffs stays null on the early-out path
    expect(p.isHoldingFruit).toBe(false);
    expect(p.handle.isNull).toBe(true);
  });

  it('wires buffs, collision cylinder (0.15, 0.75) and speed scale with a live core', () => {
    const p = makePlayer(1);
    expect(p.buffs).toBeInstanceOf(BuffContainer);
    expect(p.collision.radius).toBeCloseTo(0.15, 6);
    expect(p.collision.height).toBeCloseTo(0.75, 6);
    p.setSpeedScale(0.5);
    expect(p.getSpeedScale()).toBe(0.5);
  });
});

describe('GameCorePlayer.tick forward derivation', () => {
  it('derives forward from movement; sub-0.001 deltas keep the previous forward', () => {
    const p = makePlayer(1);
    p.tick(); // lastPosition (0,0,0) → (40,0,40): forward = normalize(40,0,40)
    expect(p.forward.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(p.forward.y).toBe(0);
    expect(p.forward.z).toBeCloseTo(Math.SQRT1_2, 5);

    p.position = new Vector3(40.0005, 0, 40);
    p.tick();
    expect(p.forward.x).toBeCloseTo(Math.SQRT1_2, 5); // magnitude < 0.001 → unchanged

    p.position = new Vector3(40.0005, 0, 42);
    p.tick();
    expect(p.forward.x).toBeCloseTo(0, 5);
    expect(p.forward.z).toBeCloseTo(1, 5);
  });
});

describe('GameCorePlayer.CheckForPickups', () => {
  it('FAITHFUL QUIRK: compares distance (not squared) against detectionRange²', () => {
    const p = makePlayer(1);
    const near = new TestPickup();
    near.position = new Vector3(40.2, 0, 40);
    near.setRange(0.5); // dist 0.2 < range² 0.25 → picked
    const mid = new TestPickup();
    mid.position = new Vector3(40.3, 0, 40);
    mid.setRange(0.5); // dist 0.3 < range 0.5 BUT ≥ range² 0.25 → NOT picked
    const far = new TestPickup();
    far.position = new Vector3(43, 0, 40);
    far.setRange(2.0); // dist 3 > range 2 BUT < range² 4 → picked
    p.tick();
    expect(near.pickedBy).toEqual([p]);
    expect(mid.pickedBy).toEqual([]);
    expect(far.pickedBy).toEqual([p]);
  });
});

describe('GameCorePlayer.CheckForHiddenTreePickups', () => {
  function setupStageHub(data: HiddenPickupData[]): unknown[] {
    const created: unknown[] = [];
    setStageHubProvider(() => ({
      pickupManager: {
        hiddenPickupData: data,
        createPickup: (d, pos, movement) => {
          created.push({ data: d, pos, movement });
          return null;
        },
      },
    }));
    return created;
  }

  it('reveals indexed hidden pickups within playerDetectionRange² and resets the index', () => {
    const data: HiddenPickupData = { type: EInventoryType.Coin, amount: 50 };
    const movement = {
      tag: 'movement',
      appearForceMin: 1,
      appearForceMax: 2,
      appearRangeAngle: 10,
      acceleration: 5,
      bouncingRate: 0.5,
      bounceTime: -1,
      attractOffset: { x: 0, y: 0, z: 0 },
    };
    const created = setupStageHub([data]) as Array<{ data: HiddenPickupData; movement: unknown }>;
    const p = makePlayer(1);
    const tree = new GameCoreTree(new Vector3(41, 0, 40)); // distance 1
    tree.hiddenPickupIndex = 0;
    setViewerResolver(
      (h) =>
        (h === tree.handle.m_handle
          ? makeTreeView({ getComponentPickupMovement: () => movement })
          : null),
    );
    const found: Array<[GameCorePlayer, EInventoryType, number]> = [];
    const cb = (pl: GameCorePlayer, t: EInventoryType, a: number) => found.push([pl, t, a]);
    Events.hiddenPickupFoundEvent.addListener(cb, EventTime.Immediate);

    p.tick();
    expect(created.length).toBe(1);
    expect(created[0].data).toBe(data);
    expect(created[0].movement).toBe(movement);
    expect(found).toEqual([[p, EInventoryType.Coin, 50]]);
    expect(tree.hiddenPickupIndex).toBe(-1);

    p.tick(); // index cleared → no duplicate reveal
    expect(created.length).toBe(1);
    Events.hiddenPickupFoundEvent.removeListener(cb);
  });

  it('DirectlySetPickupDataIndex (2000) reads data from the HiddenTreePickup component', () => {
    const data: HiddenPickupData = { type: EInventoryType.Gem, amount: 3 };
    const created = setupStageHub([]) as Array<{ data: HiddenPickupData }>; // table NOT used
    const p = makePlayer(1);
    const tree = new GameCoreTree(new Vector3(41, 0, 40));
    tree.hiddenPickupIndex = GameCoreTree.directlySetPickupDataIndex;
    setViewerResolver(
      (h) =>
        (h === tree.handle.m_handle
          ? makeTreeView({ getHiddenTreePickup: () => ({ hiddenPickupData: data }) })
          : null),
    );
    p.tick();
    expect(created.length).toBe(1);
    expect(created[0].data).toBe(data);
    expect(tree.hiddenPickupIndex).toBe(-1);
  });

  it('null hidden data → no pickup created, but the index still resets (faithful)', () => {
    const created = setupStageHub([]);
    const p = makePlayer(1);
    const tree = new GameCoreTree(new Vector3(41, 0, 40));
    tree.hiddenPickupIndex = GameCoreTree.directlySetPickupDataIndex;
    setViewerResolver((h) => (h === tree.handle.m_handle ? makeTreeView() : null));
    p.tick();
    expect(created.length).toBe(0);
    expect(tree.hiddenPickupIndex).toBe(-1);
  });

  it('no reveal beyond playerDetectionRange² (index untouched)', () => {
    const created = setupStageHub([{ type: EInventoryType.Coin, amount: 50 }]);
    const p = makePlayer(1);
    const tree = new GameCoreTree(new Vector3(41, 0, 40)); // distance 1
    tree.hiddenPickupIndex = 0;
    // range 0.5 → range² 0.25 ≤ distance 1 → no reveal
    setViewerResolver(
      (h) => (h === tree.handle.m_handle ? makeTreeView({ playerDetectionRange: 0.5 }) : null),
    );
    p.tick();
    expect(created.length).toBe(0);
    expect(tree.hiddenPickupIndex).toBe(0);
  });

  it('no StageHub stage → early-out even with a tree in range', () => {
    setStageHubProvider(() => null);
    const p = makePlayer(1);
    const tree = new GameCoreTree(new Vector3(41, 0, 40));
    tree.hiddenPickupIndex = 0;
    setViewerResolver((h) => (h === tree.handle.m_handle ? makeTreeView() : null));
    p.tick();
    expect(tree.hiddenPickupIndex).toBe(0);
  });
});

describe('GameCorePlayer loose-coin drops (DropPickup/ProcessDropPickup)', () => {
  it('fires after `delay` ticks with the wave multiplier, clamps, and skips spent stats', () => {
    setCurrentStageProvider(() => ({ initCoin: 100, initGem: 5, initWaveCoinRate: 0.1, initWaveTimeRate: 1.75 }));
    const p = makePlayer(1);
    const wm = new GameCoreWaveManager();
    wm.currentWaveIndex = 2; // multiplier = 3
    const inv = GameCoreInventory.getInventoryObject()!;

    const bumped: Array<[GameCorePlayer, CurrencyValueInfo, CurrencyValueInfo]> = [];
    const cb = (
      pl: GameCorePlayer,
      c: CurrencyValueInfo,
      g: CurrencyValueInfo,
    ) => bumped.push([pl, c, g]);
    Events.playerBumpedEvent.addListener(cb, EventTime.Immediate);

    p.dropPickup(2, 5, 4, 1, 1, 7, 9);
    p.tick(); // delay 2 → 1: nothing yet
    expect(bumped.length).toBe(0);
    p.tick(); // delay 1 → 0: process
    // lossCoins = min(100, 5×3) = 15 → 85 left; lossGems = min(5, 1) = 1 → 4 left
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(85);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Gem)).toBe(4);
    // FAITHFUL: removed as NOT spent
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentCoins)).toBe(0);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentGems)).toBe(0);
    // dropCoins = min(85, 4×3) = 12; dropGems = min(4, 1) = 1
    expect(bumped.length).toBe(1);
    expect(bumped[0][0]).toBe(p);
    expect(bumped[0][1].total).toBe(12);
    expect(bumped[0][1].perValue).toBe(7);
    expect(bumped[0][2].total).toBe(1);
    expect(bumped[0][2].perValue).toBe(9);

    p.tick(); // no longer pending → no repeat
    expect(bumped.length).toBe(1);
    Events.playerBumpedEvent.removeListener(cb);
  });

  it('does nothing while no inventory or wave manager exists (fields still clear)', () => {
    const p = makePlayer(1);
    p.dropPickup(1, 5, 4, 0, 0);
    p.tick(); // delay → 0, but inventory/waveManager missing → no event
    p.dropPickup(1, 5, 4, 0, 0);
    p.tick();
    // No throw; second schedule still processed quietly.
    expect(p.isDestroyed()).toBe(false);
  });
});

describe('GameCorePlayer fruit carry flow', () => {
  it('fruitPickedUpEvent sets the held handle + owner fields; second fruit ignored', () => {
    const p = makePlayer(1);
    const fruit = new TestFruit();
    Events.fruitPickedUpEvent.invoke(p, fruit);
    expect(p.isHoldingFruit).toBe(true);
    expect(p.heldFruit).toBe(fruit);
    expect(fruit.m_playerOwner.equals(p.handle)).toBe(true);
    expect(fruit.lastPlayerOwner.equals(p.handle)).toBe(true);

    const fruit2 = new TestFruit();
    Events.fruitPickedUpEvent.invoke(p, fruit2); // already holding → ignored
    expect(p.heldFruit).toBe(fruit);
    expect(fruit2.m_playerOwner.isNull).toBe(true);
  });

  it('fruitDroppedEvent calls OnDrop with the force and clears the held handle', () => {
    const p = makePlayer(1);
    const fruit = new TestFruit();
    Events.fruitPickedUpEvent.invoke(p, fruit);
    const force = new Vector3(1, 2, 3);
    Events.fruitDroppedEvent.invoke(p, fruit, force);
    expect(fruit.drops.length).toBe(1);
    expect(fruit.drops[0].player).toBe(p);
    expect(fruit.drops[0].force).toBe(force);
    expect(p.isHoldingFruit).toBe(false);

    const fruit2 = new TestFruit();
    Events.fruitDroppedEvent.invoke(p, fruit2, force); // not held → no OnDrop
    expect(fruit2.drops.length).toBe(0);
  });

  it('isHeldFruitError reports a dangling handle once and clears it', () => {
    const p = makePlayer(1);
    const fruit = new TestFruit();
    Events.fruitPickedUpEvent.invoke(p, fruit);
    expect(p.isHeldFruitError).toBe(false);
    fruit.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    expect(p.isHeldFruitError).toBe(true); // dangling → true + cleared
    expect(p.isHeldFruitError).toBe(false); // handle now null
    expect(p.isHoldingFruit).toBe(false);
  });
});

describe('GameCorePlayer statics', () => {
  it('GetPlayerCount/GetPlayer/GetLocalPlayer over the frame roster', () => {
    const p1 = makePlayer(1);
    const p2 = makePlayer(2);
    expect(GameCorePlayer.getPlayerCount()).toBe(2);
    expect(GameCorePlayer.getPlayer(2)).toBe(p2);
    expect(GameCorePlayer.getPlayer(99)).toBeNull();
    // SP: NetworkMatch.IsNetworkMatch is false → every player is "local";
    // GetLocalPlayer returns the first in iteration order.
    expect(p1.isLocalPlayer()).toBe(true);
    expect(GameCorePlayer.getLocalPlayer()).toBe(p1);
  });
});

describe('GameCorePlayer.DestroySelf', () => {
  it('raises playerRemovedEvent and detaches the fruit listeners', () => {
    const p = makePlayer(1);
    const removed: GameCorePlayer[] = [];
    const cb = (pl: GameCorePlayer) => removed.push(pl);
    Events.playerRemovedEvent.addListener(cb, EventTime.Immediate);
    p.destroySelf();
    expect(removed).toEqual([p]);
    expect(p.isDestroyed()).toBe(true);
    // Listeners removed: fruit events no longer reach this player.
    const fruit = new TestFruit();
    Events.fruitPickedUpEvent.invoke(p, fruit);
    expect(p.isHoldingFruit).toBe(false);
    Events.playerRemovedEvent.removeListener(cb);
  });
});

describe('GameCorePlayer.RecreateViewer', () => {
  it('links the Q4.Player view matching playerID and syncs its position', () => {
    const p = makePlayer(3);
    const decoy: PlayerViewContract = {
      playerID: 9,
      transform: { position: { x: 0, y: 0, z: 0 } },
      gameObject: { tag: 'decoy' },
    };
    const view: PlayerViewContract = {
      playerID: 3,
      transform: { position: { x: 0, y: 0, z: 0 } },
      gameObject: { tag: 'go' },
    };
    setPlayerViewsFinder(() => [decoy, view]);
    expect(p.recreateViewer()).toBe(view.gameObject);
    expect(view.transform.position).toBe(p.position);
  });

  it('without a matching view: logs the original error, then throws (faithful NRE)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = makePlayer(4);
    setPlayerViewsFinder(() => []);
    expect(() => p.recreateViewer()).toThrow();
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
