// tests/core/events.test.ts
// Smoke + semantics tests for the static Events hub port.

import { beforeEach, describe, expect, it } from 'vitest';

import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { CoreEventBase, EventTime } from '../../src/core/event/CoreEvent';
import { GameCoreHandle } from '../../src/core/GameCoreHandle';
import type { GameCorePlayer } from '../../src/core/GameCorePlayer';
import type { GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import type { GameCoreInventory } from '../../src/core/GameCoreInventory';
import { EInventoryType } from '../../src/core/GameCoreInventory';

beforeEach(() => {
  resetAllEventsForTests();
});

describe('Events hub', () => {
  it('instantiates all 58 events (no nulls)', () => {
    const fields = Object.entries(Events).filter(([, v]) => v !== undefined);
    // static readonly fields land on the prototype-less class object; count them
    const eventFields = Object.getOwnPropertyNames(Events).filter(
      (k) =>
        k !== 'prototype' &&
        typeof (Events as unknown as Record<string, unknown>)[k] === 'object',
    );
    expect(eventFields.length).toBe(58);
    for (const k of eventFields) {
      expect((Events as unknown as Record<string, unknown>)[k], k).not.toBeNull();
    }
    expect(fields.length).toBeGreaterThanOrEqual(0);
  });

  it('waveEndedEvent dispatches Immediate listeners with (manager, waveIndex)', () => {
    const seen: Array<[unknown, number]> = [];
    const cb = (m: unknown, i: number) => seen.push([m, i]);
    Events.waveEndedEvent.addListener(cb, EventTime.Immediate);
    const fakeManager = { tag: 'wm' } as unknown as GameCoreWaveManager;
    Events.waveEndedEvent.invoke(fakeManager, 3);
    expect(seen).toEqual([[fakeManager, 3]]);
    Events.waveEndedEvent.removeListener(cb);
  });

  it('gameOverEvent (no payload) reaches PostGameCoreTick listeners via the flush', () => {
    let hits = 0;
    const cb = () => hits++;
    Events.gameOverEvent.addListener(cb, EventTime.PostGameCoreTick);
    Events.gameOverEvent.invoke();
    expect(hits).toBe(0);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(hits).toBe(1);
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(hits).toBe(1); // counter cleared
    Events.gameOverEvent.removeListener(cb);
  });

  it('signEvent carries (handle, category, icon)', () => {
    const h = GameCoreHandle.createHandle(123);
    const seen: Array<[number, number, number]> = [];
    const cb = (hh: GameCoreHandle, c: number, i: number) => seen.push([hh.m_handle, c, i]);
    Events.signEvent.addListener(cb, EventTime.Immediate);
    Events.signEvent.invoke(h, 2, 7);
    expect(seen).toEqual([[123, 2, 7]]);
    Events.signEvent.removeListener(cb);
  });

  it('onAddInventory carries the 4-payload shape (player, inventory, type, amount)', () => {
    const seen: unknown[][] = [];
    const cb = (...args: unknown[]) => seen.push(args);
    Events.onAddInventory.addListener(cb, EventTime.Immediate);
    Events.onAddInventory.invoke(
      { p: 1 } as unknown as GameCorePlayer,
      { inv: 2 } as unknown as GameCoreInventory,
      EInventoryType.Coin,
      50,
    );
    expect(seen[0]).toEqual([{ p: 1 }, { inv: 2 }, 0, 50]);
    Events.onAddInventory.removeListener(cb);
  });
});
