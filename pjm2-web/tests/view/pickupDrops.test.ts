// tests/view/pickupDrops.test.ts
// Q4.PickupManager drop logic (src/view/pickups/PickupDrops.ts): CreateCurrency splitting,
// enemy-death drops with the serialized per-enemy PickupMovement (all 57 enemy prefabs),
// tower-sell refund pickups, player-bump and gem-tower drops, and the gem credit through the
// CurrencyFlyer -> AddInventoryCommand seam. Evidence: docs/ENEMY_DROPS_ANALYSIS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CurrencyValueInfo } from '../../src/core/CurrencyValueInfo';
import { EInventoryType, GameCoreInventory } from '../../src/core/GameCoreInventory';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCorePickupCurrency } from '../../src/core/GameCorePickupCurrency';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import type { NetworkCommand } from '../../src/core/network/NetworkCommand';
import { ENEMY_PICKUP_MOVEMENT, PLAYER_PICKUP_MOVEMENT, STAGE_PICKUP_MANAGERS, TOWER_PICKUP_MOVEMENT } from '../../src/data/dropData.generated';
import { COIN_PREFAB, GEM_PREFAB } from '../../src/data/pickupPrefabs';
import { ENEMY_DROP_LIFT, PickupDropManager } from '../../src/view/pickups/PickupDrops';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  setCurrentStageProvider,
  setPickupViewerFactory,
} from '../../src/view/q4-contracts';

const f = Math.fround;
const POS = new Vector3(40, 1, 40);

let core: GameCore;
const physicsFake: SimPhysics = {
  linecast: () => null,
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};
let issued: Array<{ cmd: NetworkCommand; player: GameCorePlayer }> = [];
let mgr: PickupDropManager;

function newManager(override = 20): PickupDropManager {
  const m = new PickupDropManager({
    globalCoinPerValueOverride: override,
    issueCommand: (cmd, player) => issued.push({ cmd, player }),
  });
  m.install();
  return m;
}

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 40, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics(physicsFake);
  setCurrentStageProvider(() => ({ initCoin: 0, initGem: 0, initWaveCoinRate: 1, initWaveTimeRate: 1.75 }));
  issued = [];
  mgr = newManager(20);
});

afterEach(() => {
  mgr.dispose();
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setPickupViewerFactory(null);
  resetUnityObjectRegistryForTests();
  setCurrentStageProvider(() => null);
});

function pickups(): GameCorePickupCurrency[] {
  return [...core.allObjects<GameCorePickupCurrency>(GameCorePickupCurrency)];
}
const values = (t: EInventoryType): number[] =>
  pickups().filter((p) => p.inventoryType === t).map((p) => p.value).sort((a, b) => b - a);

interface FakeEnemy { position: Vector3; m_prefabName: string; getCoinValue(): number; getGemValue(): number }
function fakeEnemy(name: string, coin: number, gem: number): FakeEnemy {
  return { position: POS.clone(), m_prefabName: name, getCoinValue: () => coin, getGemValue: () => gem };
}
function kill(e: FakeEnemy): void {
  Events.enemyDestroyedEvent.invoke(null, e as never, null as never);
}
/** Launch velocity of a freshly constructed pickup (before any tick). */
function launch(p: GameCorePickupCurrency): { speed: number; angleDeg: number } {
  const v = (p as unknown as { m_currentVelocity: Vector3 }).m_currentVelocity;
  const speed = v.magnitude;
  return { speed, angleDeg: (Math.acos(Math.min(1, v.y / speed)) * 180) / Math.PI };
}

describe('Q4.PickupManager.CreateCurrency @0x3E3F50 splitting', () => {
  it('coin override 20: 250 coins -> 12 x 20 + 1 x 10', () => {
    mgr.createCurrency(POS, EInventoryType.Coin, 250, null);
    expect(values(EInventoryType.Coin)).toEqual([...Array(12).fill(20), 10]);
  });
  it('amount below the per-coin value -> a single smaller pickup; zero -> none', () => {
    mgr.createCurrency(POS, EInventoryType.Coin, 14, null);
    expect(values(EInventoryType.Coin)).toEqual([14]);
    mgr.createCurrency(POS, EInventoryType.Coin, 0, null);
    mgr.createCurrency(POS, EInventoryType.Gem, 0, null);
    expect(pickups().length).toBe(1);
  });
  it('gems are always split by the gem prefab value (1), ignoring the coin override', () => {
    mgr.createCurrency(POS, EInventoryType.Gem, 3, null);
    expect(values(EInventoryType.Gem)).toEqual([1, 1, 1]);
  });
  it('override unset (0): the coin prefab value 20 applies; valuePerPickup param used only then', () => {
    mgr.dispose();
    mgr = newManager(0);
    mgr.createCurrency(POS, EInventoryType.Coin, 45, null);
    expect(values(EInventoryType.Coin)).toEqual([20, 20, 5]);
    mgr.createCurrency(POS, EInventoryType.Coin, 12, null, 5); // CurrencyValueInfo.perValue = 5
    expect(values(EInventoryType.Coin).filter((v) => v === 5).length).toBe(1 + 2); // [5 rest] + 2x5 + 2 rest
    expect(values(EInventoryType.Coin)).toContain(2);
  });
  it('override beats the per-value param for coins (OnPlayerBumped on stage 1)', () => {
    mgr.createCurrency(POS, EInventoryType.Coin, 45, null, 5);
    expect(values(EInventoryType.Coin)).toEqual([20, 20, 5]);
  });
});

describe('enemy death (Q4.PickupManager.OnEnemyDestroyed @0x3E3E20)', () => {
  it('drops coins then gems 0.2 above the enemy with its prefab PickupMovement', () => {
    kill(fakeEnemy('kuri_00_001', 50, 2));
    expect(values(EInventoryType.Coin)).toEqual([20, 20, 10]);
    expect(values(EInventoryType.Gem)).toEqual([1, 1]);
    for (const p of pickups()) {
      expect(p.position.x).toBeCloseTo(40, 5);
      expect(p.position.y).toBeCloseTo(1 + ENEMY_DROP_LIFT, 5);
    }
    expect(mgr.spawnedCoins).toBe(3);
    expect(mgr.spawnedGems).toBe(2);
  });
  it('zero coin + zero gem drops nothing (36 of the 86 stage-1 kills)', () => {
    kill(fakeEnemy('bee_00_001', 0, 0));
    expect(pickups().length).toBe(0);
  });
  it('every one of the 57 enemy prefabs has a PickupMovement and launches inside its cone/force', () => {
    const roster = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../decomp/data/enemy_roster.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(ENEMY_PICKUP_MOVEMENT).sort()).toEqual(Object.keys(roster).sort());
    expect(Object.keys(roster).length).toBe(57);
    for (const name of Object.keys(roster)) {
      const mv = ENEMY_PICKUP_MOVEMENT[name];
      const before = pickups().length;
      kill(fakeEnemy(name, 20, 0));
      const made = pickups().slice(before);
      expect(made.length, name).toBe(1);
      const { speed, angleDeg } = launch(made[0]);
      expect(speed, name).toBeGreaterThanOrEqual(f(mv.appearForceMin) - 1e-3);
      expect(speed, name).toBeLessThanOrEqual(f(mv.appearForceMax) + 1e-3);
      // Quaternion.AngleAxis(appearRangeAngle, horizontal axis) tilts the up vector by exactly that angle.
      expect(angleDeg, name).toBeCloseTo(mv.appearRangeAngle, 2);
      // acceleration (suck) comes from the override too
      expect((made[0] as unknown as { m_acceleration: number }).m_acceleration, name).toBe(f(mv.acceleration));
    }
  });
  it('unknown prefab -> pickup prefab default movement (coin: force 4..5.5, 17.8 deg)', () => {
    kill(fakeEnemy('no_such_enemy', 20, 0));
    const { speed, angleDeg } = launch(pickups()[0]);
    expect(speed).toBeGreaterThanOrEqual(COIN_PREFAB.movement!.appearForceMin - 1e-3);
    expect(speed).toBeLessThanOrEqual(COIN_PREFAB.movement!.appearForceMax + 1e-3);
    expect(angleDeg).toBeCloseTo(COIN_PREFAB.movement!.appearRangeAngle, 2);
  });
  it('real prefab data drives lifespan / detection', () => {
    kill(fakeEnemy('kuri_00_001', 20, 1));
    const coin = pickups().find((p) => p.inventoryType === EInventoryType.Coin)!;
    const gem = pickups().find((p) => p.inventoryType === EInventoryType.Gem)!;
    expect(coin.remainingLifespan).toBeCloseTo(COIN_PREFAB.lifespan!, 4);
    expect(gem.remainingLifespan).toBeCloseTo(GEM_PREFAB.lifespan!, 4);
    expect(coin.detectionRange).toBeCloseTo(COIN_PREFAB.detectRange, 5);
    expect(gem.detectionRange).toBeCloseTo(GEM_PREFAB.detectRange, 5);
  });
});

describe('other drop sources', () => {
  function makePlayer(): GameCorePlayer {
    const p = new GameCorePlayer();
    p.playerId = 1;
    p.position = POS.clone();
    return p;
  }

  it('tower sold: refund spawns as pickups (not credited) and reduces the SpentCoins stat', () => {
    const player = makePlayer();
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(player.handle, EInventoryType.SpentCoins, 300);
    inv.addInventory(player.handle, EInventoryType.SpentGems, 4);
    const coinsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    const tower = { position: new Vector3(10, 2, 10), prefabName: 'tower_001' };
    Events.towerSellEvent.invoke(tower as never, player, 90, 2);
    expect(values(EInventoryType.Coin)).toEqual([20, 20, 20, 20, 10]);
    expect(values(EInventoryType.Gem)).toEqual([1, 1]);
    expect(pickups()[0].position.y).toBeCloseTo(2, 5); // no +0.2 lift for sells
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.SpentCoins)).toBe(210);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.SpentGems)).toBe(2);
  });

  it('player bumped: loose coins/gems use the tikiman_01 movement (accel 100, 30.5 deg)', () => {
    const player = makePlayer();
    Events.playerBumpedEvent.invoke(player, new CurrencyValueInfo(30, 5), new CurrencyValueInfo(2, 1));
    expect(values(EInventoryType.Coin)).toEqual([20, 10]); // stage override 20 beats perValue 5
    expect(values(EInventoryType.Gem)).toEqual([1, 1]);
    const mv = PLAYER_PICKUP_MOVEMENT['tikiman_01'];
    for (const p of pickups()) {
      expect(launch(p).angleDeg).toBeCloseTo(mv.appearRangeAngle, 2);
      expect((p as unknown as { m_acceleration: number }).m_acceleration).toBe(100);
    }
  });

  it('gem tower break: gems at the tower; tower_005 has its own PickupMovement, others default', () => {
    Events.onGemTowerPopGem.invoke({ position: new Vector3(1, 1, 1), prefabName: 'tower_005' } as never, 3);
    expect(values(EInventoryType.Gem)).toEqual([1, 1, 1]);
    const mv = TOWER_PICKUP_MOVEMENT['tower_005'];
    for (const p of pickups()) expect(launch(p).angleDeg).toBeCloseTo(mv.appearRangeAngle === 0 ? 0 : mv.appearRangeAngle, 2);
    expect(Object.keys(TOWER_PICKUP_MOVEMENT)).toEqual(['tower_005']);
  });

  it('gem acquire -> AddInventoryCommand(Gem, value) via the CurrencyFlyer seam; coins are sim-credited', () => {
    const player = makePlayer();
    const gem = new GameCorePickupCurrency(GEM_PREFAB, new Vector3(40, 1, 40.1), EInventoryType.Gem, 1, {
      ...GEM_PREFAB.movement!, acceleration: 1000,
    });
    (gem as unknown as { m_detectionDelay: number }).m_detectionDelay = 0;
    gem.pickup(player);
    gem.tick();
    gem.tick();
    expect(gem.isDestroyed()).toBe(true);
    expect(issued.length).toBe(1);
    const cmd = issued[0].cmd as unknown as { m_pickupType: EInventoryType; m_value: number };
    expect(cmd.m_pickupType).toBe(EInventoryType.Gem);
    expect(cmd.m_value).toBe(1);
    // executing the queued command credits the bag
    issued[0].cmd.executeCommand(player);
    expect(GameCoreInventory.getInventoryObject()!.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(1);

    const coin = new GameCorePickupCurrency(COIN_PREFAB, new Vector3(40, 1, 40.1), EInventoryType.Coin, 20, {
      ...COIN_PREFAB.movement!, acceleration: 1000,
    });
    (coin as unknown as { m_detectionDelay: number }).m_detectionDelay = 0;
    coin.pickup(player);
    coin.tick();
    coin.tick();
    expect(issued.length).toBe(1); // no flyer command for coins
    expect(GameCoreInventory.getInventoryObject()!.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(20);
  });
});

describe('serialized drop data', () => {
  it('stage 1 PickupManager override is 20, every other stage unset', () => {
    expect(STAGE_PICKUP_MANAGERS['BuildPlayer-3d_stage_001_env'].globalCoinPerValueOverride).toBe(20);
    expect(STAGE_PICKUP_MANAGERS['BuildPlayer-3d_stage_002_env'].globalCoinPerValueOverride).toBe(0);
  });
});
