// tests/core/event.test.ts
// Semantics tests for the ported CoreEvent machinery (deferred replay counts,
// cursor behavior, queued listener changes, deterministic ordering).

import { describe, expect, it } from 'vitest';

import {
  CoreEvent,
  CoreEvent1,
  CoreEvent2,
  CoreEventBase,
  EventTime,
} from '../../src/core/event/CoreEvent';

describe('CoreEvent (no payload)', () => {
  it('fires Immediate listeners synchronously', () => {
    const e = new CoreEvent();
    let hits = 0;
    e.addListener(() => hits++, EventTime.Immediate);
    e.invoke();
    expect(hits).toBe(1);
  });

  it('replays PostGameCoreTick listeners once per invoke since last flush', () => {
    const e = new CoreEvent();
    let hits = 0;
    e.addListener(() => hits++, EventTime.PostGameCoreTick);
    e.invoke();
    e.invoke();
    expect(hits).toBe(0); // not yet flushed
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(hits).toBe(2); // both invokes replayed
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(hits).toBe(2); // counter reset — nothing new
  });

  it('replays PostUnityUpdate listeners for all invokes, then clears', () => {
    const e = new CoreEvent();
    let hits = 0;
    e.addListener(() => hits++, EventTime.PostUnityUpdate);
    e.invoke();
    e.invoke();
    e.invoke();
    CoreEventBase.invokePendingPostUnityUpdateEvents();
    expect(hits).toBe(3);
    CoreEventBase.invokePendingPostUnityUpdateEvents();
    expect(hits).toBe(3);
  });
});

describe('CoreEvent1<T1> payload events', () => {
  it('delivers payload to Immediate listeners', () => {
    const e = new CoreEvent1<number>();
    const seen: number[] = [];
    e.addListener((v) => seen.push(v), EventTime.Immediate);
    e.invoke(7);
    expect(seen).toEqual([7]);
  });

  it('PostGameCoreTick replays ONLY new data since last flush (cursor)', () => {
    const e = new CoreEvent1<string>();
    const seen: string[] = [];
    e.addListener((v) => seen.push(v), EventTime.PostGameCoreTick);
    e.invoke('a');
    e.invoke('b');
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(seen).toEqual(['a', 'b']);
    e.invoke('c');
    CoreEventBase.invokePendingPostGameCoreTickEvents();
    expect(seen).toEqual(['a', 'b', 'c']); // only 'c' replayed the second time
  });

  it('PostUnityUpdate replays ALL data then clears the buffer', () => {
    const e = new CoreEvent1<string>();
    const seen: string[] = [];
    e.addListener((v) => seen.push(v), EventTime.PostUnityUpdate);
    e.invoke('x');
    e.invoke('y');
    CoreEventBase.invokePendingPostUnityUpdateEvents();
    expect(seen).toEqual(['x', 'y']);
    e.invoke('z');
    CoreEventBase.invokePendingPostUnityUpdateEvents();
    expect(seen).toEqual(['x', 'y', 'z']); // buffer was cleared after first flush
  });
});

describe('CoreEvent2<T1,T2>', () => {
  it('delivers both payload values', () => {
    const e = new CoreEvent2<string, number>();
    const seen: Array<[string, number]> = [];
    e.addListener((s, n) => seen.push([s, n]), EventTime.Immediate);
    e.invoke('coin', 5);
    expect(seen).toEqual([['coin', 5]]);
  });
});

describe('listener bookkeeping', () => {
  it('queues add/remove during dispatch and applies afterwards', () => {
    const e = new CoreEvent1<number>();
    const seen: string[] = [];
    const late = (v: number) => seen.push(`late${v}`);
    e.addListener((v) => {
      seen.push(`first${v}`);
      // Mutating during dispatch must not affect the current pass.
      e.addListener(late, EventTime.Immediate);
    }, EventTime.Immediate);
    e.invoke(1);
    expect(seen).toEqual(['first1']); // 'late' not called during dispatch
    e.invoke(2);
    expect(seen).toEqual(['first1', 'first2', 'late2']); // applied after flush
    e.removeListener(late);
    e.invoke(3);
    expect(seen).toEqual(['first1', 'first2', 'late2', 'first3']);
  });

  it('orders sim-object listeners by handle id before plain listeners', () => {
    const e = new CoreEvent();
    const order: string[] = [];
    e.addListener(() => order.push('plainA'), EventTime.Immediate);
    e.addListener(() => order.push('sim42'), EventTime.Immediate, 42);
    e.addListener(() => order.push('plainB'), EventTime.Immediate);
    e.addListener(() => order.push('sim7'), EventTime.Immediate, 7);
    e.invoke();
    expect(order).toEqual(['sim7', 'sim42', 'plainA', 'plainB']);
  });

  it('removes by handle id (stored-delegate parity)', () => {
    const e = new CoreEvent1<number>();
    let hits = 0;
    const cb = (v: number) => {
      hits += v;
    };
    e.addListener(cb, EventTime.Immediate, 9);
    e.invoke(1);
    e.removeListener(cb, 9);
    e.invoke(10);
    expect(hits).toBe(1);
  });
});
