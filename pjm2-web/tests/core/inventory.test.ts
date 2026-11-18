// tests/core/inventory.test.ts
// Semantics tests for the GameCoreInventory port: lazy singleton creation with
// StageMain seeding, the single-player shared bag under client key 0, spent
// stats (incl. the any-non-Coin→SpentGems quirk), banker's-rounded wave
// interest with HashSet dedup, end-of-game statistics, and listener teardown.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Mathf, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CoreEventBase, EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver } from '../../src/core/GameCoreHandle';
import { GameCoreInventory, EInventoryType } from '../../src/core/GameCoreInventory';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import { setCurrentStageProvider } from '../../src/view/q4-contracts';

const f = Math.fround;

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
  setBoundsProvider(null);
  setCurrentStageProvider(() => null);
});

function makePlayer(id: number): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = new Vector3(40, 0, 40);
  return p;
}

function stage(initCoin: number, initGem: number, rate: number) {
  setCurrentStageProvider(() => ({ initCoin, initGem, initWaveCoinRate: rate, initWaveTimeRate: 1.75 }));
}

describe('GameCoreInventory singleton + seeding', () => {
  it('lazily creates from StageMain and returns the same object afterwards', () => {
    stage(450, 2, 1.1);
    const p1 = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    expect(inv).not.toBeNull();
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(450);
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Gem)).toBe(2);
    const again = GameCoreInventory.getInventoryObject()!;
    expect(again.handle.m_handle).toBe(inv.handle.m_handle);
  });

  it('lazily seeds bags for players joining after creation', () => {
    stage(77, 1, 1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const late = makePlayer(5);
    expect(inv.getAvailableInventory(late.handle, EInventoryType.Coin)).toBe(77);
    expect(inv.getAvailableInventory(late.handle, EInventoryType.Gem)).toBe(1);
  });

  it('SP: all players share the bag stored under client key 0', () => {
    stage(100, 0, 1);
    const p1 = makePlayer(1);
    const p2 = makePlayer(2);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(p1.handle, EInventoryType.Coin, 50);
    expect(inv.getAvailableInventory(p2.handle, EInventoryType.Coin)).toBe(150);
  });
});

describe('GameCoreInventory add/remove', () => {
  it('clamps at 0; spent defaults true; spent=false skips the stats', () => {
    stage(0, 0, 1);
    const p = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(p.handle, EInventoryType.Coin, 100);
    inv.removeInventory(p.handle, EInventoryType.Coin, 30);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(70);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentCoins)).toBe(30);
    inv.removeInventory(p.handle, EInventoryType.Coin, 20, false);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(50);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentCoins)).toBe(30); // unchanged
    inv.removeInventory(p.handle, EInventoryType.Coin, 999); // clamps at 0
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(0);
    // FAITHFUL: spent accumulates the FULL requested amount, not the clamped delta
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentCoins)).toBe(1029);
  });

  it('FAITHFUL QUIRK: any non-Coin removal accumulates into SpentGems', () => {
    stage(0, 0, 1);
    const p = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(p.handle, EInventoryType.Gem, 10);
    inv.removeInventory(p.handle, EInventoryType.Gem, 4);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentGems)).toBe(4);
    // C#: 4 - (type == Coin ? 1 : 0) → InterestCoins removal also lands in SpentGems
    inv.addInventory(p.handle, EInventoryType.InterestCoins, 6);
    inv.removeInventory(p.handle, EInventoryType.InterestCoins, 6);
    expect(inv.getAvailableInventory(p.handle, EInventoryType.SpentGems)).toBe(10);
  });

  it('hasInventory threshold; unresolvable player handles are safe no-ops', () => {
    stage(0, 0, 1);
    const p = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(p.handle, EInventoryType.Coin, 100);
    expect(inv.hasInventory(p.handle, EInventoryType.Coin, 100)).toBe(true);
    expect(inv.hasInventory(p.handle, EInventoryType.Coin, 101)).toBe(false);

    const ghost = makePlayer(7);
    const ghostHandle = ghost.handle;
    ghost.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    expect(inv.getAvailableInventory(ghostHandle, EInventoryType.Coin)).toBe(0);
    expect(inv.hasInventory(ghostHandle, EInventoryType.Coin, 1)).toBe(false);
    inv.addInventory(ghostHandle, EInventoryType.Coin, 5); // no-op, must not throw
    inv.removeInventory(ghostHandle, EInventoryType.Coin, 5); // no-op
    expect(inv.getAvailableInventory(p.handle, EInventoryType.Coin)).toBe(100);
  });

  it('raises onAddInventory/onRemoveInventory with (player, inventory, type, amount)', () => {
    stage(0, 0, 1);
    const p = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const adds: unknown[][] = [];
    const rems: unknown[][] = [];
    const cbA = (...args: unknown[]) => adds.push(args);
    const cbR = (...args: unknown[]) => rems.push(args);
    Events.onAddInventory.addListener(cbA, EventTime.Immediate);
    Events.onRemoveInventory.addListener(cbR, EventTime.Immediate);
    inv.addInventory(p.handle, EInventoryType.Coin, 25);
    inv.removeInventory(p.handle, EInventoryType.Coin, 5);
    expect(adds[0]).toEqual([p, inv, EInventoryType.Coin, 25]);
    expect(rems[0]).toEqual([p, inv, EInventoryType.Coin, 5]);
    Events.onAddInventory.removeListener(cbA);
    Events.onRemoveInventory.removeListener(cbR);
  });
});

describe('GameCoreInventory wave interest', () => {
  it("engine canary: banker's rounding through the f32 chain used by OnWaveEnded", () => {
    // fp32(1.025) is slightly below; ×100 rounds back to exactly 102.5 in f32;
    // banker's rounding takes it to 102 (MidpointRounding.ToEven).
    expect(Mathf.RoundToInt(f(f(100) * f(1.025)))).toBe(102);
    expect(Mathf.RoundToInt(f(f(100) * f(1.005)))).toBe(100); // → zero interest
  });

  it('grants interest once per shared bag on the PostGameCoreTick replay', () => {
    stage(100, 0, 1.025);
    const p1 = makePlayer(1);
    const p2 = makePlayer(2);
    const inv = GameCoreInventory.getInventoryObject()!;
    const wm = new GameCoreWaveManager();

    Events.waveEndedEvent.invoke(wm, 1);
    // Not applied before the post-tick flush (EventTime.PostGameCoreTick).
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(100);
    CoreEventBase.invokePendingPostGameCoreTickEvents();

    // interest = 102 - 100 = 2 → Coin and InterestCoins each +2
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(102);
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.InterestCoins)).toBe(2);
    // Shared bag dedup: p2 sees the SAME single grant (not doubled).
    expect(inv.getAvailableInventory(p2.handle, EInventoryType.Coin)).toBe(102);
  });

  it('zero interest (banker midpoint → same value) grants nothing', () => {
    stage(100, 0, 1.005);
    const p1 = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const wm = new GameCoreWaveManager();
    Events.waveEndedEvent.invoke(wm, 1);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(100);
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.InterestCoins)).toBe(0);
  });

  it('rate < 1 (negative interest) grants nothing (coins <= newCoins guard)', () => {
    stage(100, 0, 0.5);
    const p1 = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const wm = new GameCoreWaveManager();
    Events.waveEndedEvent.invoke(wm, 1);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(100);
  });
});

describe('GameCoreInventory end-of-game statistics', () => {
  it('totals = Coin − Interest + SpentCoins / Gem + SpentGems (both overloads)', () => {
    stage(100, 5, 1.1);
    const p1 = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(p1.handle, EInventoryType.Coin, 50); // → 150
    inv.removeInventory(p1.handle, EInventoryType.Coin, 30); // → 120, SpentCoins 30
    inv.removeInventory(p1.handle, EInventoryType.Gem, 2); // → 3, SpentGems 2

    // Wave interest: f(120 × f(1.1)) = exactly 132 in f32 → interest 12.
    const wm = new GameCoreWaveManager();
    Events.waveEndedEvent.invoke(wm, 1);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(inv.getAvailableInventory(p1.handle, EInventoryType.Coin)).toBe(132);

    const totals = inv.getEndOfGameStatistics();
    expect(totals.totalCoinsAcquired).toBe(132 - 12 + 30); // 150
    expect(totals.totalGemsAcquired).toBe(3 + 2); // 5
    expect(totals.totalInterestCoinsAcquired).toBe(12);

    const perPlayer = inv.getEndOfGameStatistics(1);
    expect(perPlayer).toEqual({
      totalCoinsAcquired: 150,
      totalGemsAcquired: 5,
      totalInterestCoinsAcquired: 12,
    });
  });
});

describe('GameCoreInventory.DestroySelf', () => {
  it('removes the waveEnded listener (post-tick flush stays safe)', () => {
    stage(100, 0, 1.1);
    makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    const wm = new GameCoreWaveManager();
    Events.waveEndedEvent.invoke(wm, 1);
    // With the listener still attached, OnWaveEnded would resolve the destroyed
    // handle to null and throw; removal makes the flush a no-op.
    expect(() => CoreEventBase.invokePendingPostGameCoreTickEvents()).not.toThrow();
  });
});
