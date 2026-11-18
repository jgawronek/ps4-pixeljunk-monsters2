// src/core/event/CoreEvent.ts
// TypeScript port of decomp/src/GameCore/Event/{CoreEventBase,CoreEventShim,CoreEvent}.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; reconstructed from RVA
// 0x8D0170..0x945CF0 shared generic bodies).
//
// The static event hub machinery: every gameplay notification the simulation
// raises is one of these events. Semantics ported 1:1:
//  - Invoke(): Immediate listeners fire synchronously; the payload is appended
//    to eventData; NotifyInvoked() queues the event for deferred replay.
//  - PostGameCoreTick replay: fires ONLY data appended since the last post-tick
//    pass (postGameCoreUpdatePostedDataCount cursor).
//  - PostUnityUpdate replay: fires ALL accumulated data, then clears the buffer.
//  - No-payload CoreEvent uses invoke counters instead (replays N times).
//  - Listener add/remove during dispatch is queued and applied afterwards.
//  - Deterministic listener order (ListenerSorter): listeners registered with a
//    sim-object handle come first ordered by handle id; the rest come after.
//    TS ADAPTATION (documented divergence): C# ordered non-sim delegates by
//    delegate hash code; JS functions have no stable hash, so we order them by
//    registration sequence — deterministic and stable across runs/browsers,
//    which is what the sim requires. Sim-object ordering is identical.

import { EventTime } from './EventTime';

/** Any listener callback (arity varies per event). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Callback = (...args: any[]) => void;

interface ListenerEntry {
  cb: Callback;
  time: EventTime;
  /** Handle id of the GameCoreObject this listener belongs to (sim listener),
   *  or undefined for plain (view/other) listeners. Mirrors the C# sorter's
   *  delegate.Target-as-GameCoreObject test. */
  handleId?: number;
  /** Registration sequence — deterministic tiebreak (replaces C# delegate hash). */
  seq: number;
}

let nextListenerId = 1;
const listenerIds = new WeakMap<Callback, number>();
function listenerIdOf(cb: Callback): number {
  let id = listenerIds.get(cb);
  if (id === undefined) {
    id = nextListenerId++;
    listenerIds.set(cb, id);
  }
  return id;
}

function entryKey(e: { cb: Callback; handleId?: number }): string {
  // C# dictionary equality for delegates = same method + same target.
  // JS equivalent: same function reference + same handleId binding.
  return `${e.handleId ?? 'x'}#${listenerIdOf(e.cb)}`;
}

/** Deterministic ordering — port of CoreEventShim<..>.ListenerSorter. */
function compareEntries(a: ListenerEntry, b: ListenerEntry): number {
  const ta = a.handleId !== undefined;
  const tb = b.handleId !== undefined;
  if (ta && tb) {
    if (a.handleId === b.handleId) return a.seq - b.seq; // stable within one object
    return a.handleId! > b.handleId! ? 1 : -1;
  }
  if (!ta && !tb) return a.seq - b.seq; // registration order (TS adaptation)
  return ta ? -1 : 1; // sim-object listeners first
}

/** Port of CoreEventShim<CallbackType, EventDataType> listener bookkeeping. */
abstract class CoreEventShim {
  /** handleId → entry (mirrors coreObjectListeners). */
  private coreObjectListeners = new Map<number, ListenerEntry>();
  protected listeners: ListenerEntry[] = [];
  protected processingEvents = false;
  private pendingAdded: ListenerEntry[] = [];
  private pendingRemoved: Callback[] = [];
  private seqCounter = 0;

  /** C#: AddListener(callback, callbackTime). `handleId` replaces the C#
   *  delegate.Target-as-GameCoreObject lookup. */
  addListener(cb: Callback, time: EventTime, handleId?: number): void {
    if (this.processingEvents) {
      this.pendingAdded.push({ cb, time, handleId, seq: this.seqCounter++ });
      return;
    }
    const entry: ListenerEntry = { cb, time, handleId, seq: this.seqCounter++ };
    // Dictionary semantics: same key replaces.
    const key = entryKey(entry);
    const existingIdx = this.listeners.findIndex((l) => entryKey(l) === key);
    if (existingIdx >= 0) this.listeners.splice(existingIdx, 1);
    this.listeners.push(entry);
    this.listeners.sort(compareEntries);
    if (handleId !== undefined) this.coreObjectListeners.set(handleId, entry);
  }

  removeListener(cb: Callback, handleId?: number): void {
    if (this.processingEvents) {
      this.pendingRemoved.push(cb);
      return;
    }
    let target = cb;
    if (handleId !== undefined) {
      const stored = this.coreObjectListeners.get(handleId);
      if (stored) {
        this.coreObjectListeners.delete(handleId);
        target = stored.cb; // remove the exact stored delegate (C# parity)
      }
    } else {
      for (const [hid, e] of this.coreObjectListeners) {
        if (e.cb === cb) {
          this.coreObjectListeners.delete(hid);
          break;
        }
      }
    }
    const idx = this.listeners.findIndex((l) => l.cb === target);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /** Port of ApplyPendingListenerChanges — runs after processing clears. */
  private applyPendingListenerChanges(): void {
    if (this.pendingAdded.length < 1 && this.pendingRemoved.length < 1) return;
    for (const e of this.pendingAdded) this.addListener(e.cb, e.time, e.handleId);
    for (const cb of this.pendingRemoved) this.removeListener(cb);
    this.pendingAdded = [];
    this.pendingRemoved = [];
  }

  protected runProcessing(doWork: () => void): void {
    this.processingEvents = true;
    doWork();
    this.processingEvents = false;
    this.applyPendingListenerChanges();
  }

  /** TEST-ONLY: drop all listeners + pending add/remove queues. Needed
   *  because handle ids are reused after GameCoreHandle.resetStaticsForTests(),
   *  which would let stale sim-object listeners match fresh objects. */
  /** Registered listener count (disposal audit / probes). */
  listenerCount(): number {
    return this.listeners.length + this.pendingAdded.length;
  }

  clearListenersForTests(): void {
    this.coreObjectListeners.clear();
    this.listeners.length = 0;
    this.pendingAdded = [];
    this.pendingRemoved = [];
  }

  protected abstract doPendingPostGameCoreTickEvents(): void;
  protected abstract doPendingPostUnityUpdateEvents(): void;

  // CoreEventBase slot 4/5 wrappers.
  doPendingPostGameCoreTickEventsWrapper(): void {
    this.runProcessing(() => this.doPendingPostGameCoreTickEvents());
  }
  doPendingPostUnityUpdateEventsWrapper(): void {
    this.runProcessing(() => this.doPendingPostUnityUpdateEvents());
  }
}

/** Port of CoreEventBase statics: the frame-replay registry. */
const pendingInvokedEvents = new Set<CoreEventShim>();
const pendingUnityEvents = new Set<CoreEventShim>();
let processingInvokedEvents = new Set<CoreEventShim>();

export abstract class CoreEventBase extends CoreEventShim {
  /** Called by Invoke after dispatching Immediate listeners. */
  protected notifyInvoked(): void {
    pendingInvokedEvents.add(this);
    pendingUnityEvents.add(this);
  }

  /** InvokePendingPostGameCoreTickEvents @0x9458E0 — drains with set-swap so
   *  events raised during processing are handled on the next loop iteration. */
  static invokePendingPostGameCoreTickEvents(): void {
    while (pendingInvokedEvents.size > 0) {
      for (const e of pendingInvokedEvents) processingInvokedEvents.add(e);
      pendingInvokedEvents.clear();
      for (const e of processingInvokedEvents) e.doPendingPostGameCoreTickEventsWrapper();
      processingInvokedEvents = new Set<CoreEventShim>();
    }
  }

  /** InvokePendingPostUnityUpdateEvents @0x945B40 — replays all, then clears. */
  static invokePendingPostUnityUpdateEvents(): void {
    for (const e of pendingUnityEvents) e.doPendingPostUnityUpdateEventsWrapper();
    pendingUnityEvents.clear();
  }

  /** TEST-ONLY: reset the static replay registries. */
  static resetStaticsForTests(): void {
    pendingInvokedEvents.clear();
    pendingUnityEvents.clear();
    processingInvokedEvents = new Set();
  }

  /** TEST-ONLY: clear listeners + buffered payloads/counters on this event. */
  abstract resetForTests(): void;
}

// ---- no-payload event (port of CoreEvent) ----------------------------------

export class CoreEvent extends CoreEventBase {
  private unityInvokeCount = 0;
  private coreInvokeCount = 0;

  invoke(): void {
    this.unityInvokeCount++;
    this.coreInvokeCount++;
    for (const l of [...this.listeners]) {
      if (l.time === EventTime.Immediate) l.cb();
    }
    this.notifyInvoked();
  }

  protected override doPendingPostGameCoreTickEvents(): void {
    for (const l of this.listeners) {
      if (l.time === EventTime.PostGameCoreTick && this.coreInvokeCount > 0) {
        for (let i = 0; i < this.coreInvokeCount; i++) l.cb();
      }
    }
    this.coreInvokeCount = 0;
  }

  protected override doPendingPostUnityUpdateEvents(): void {
    for (const l of this.listeners) {
      if (l.time === EventTime.PostUnityUpdate && this.unityInvokeCount > 0) {
        for (let i = 0; i < this.unityInvokeCount; i++) l.cb();
      }
    }
    this.unityInvokeCount = 0;
  }

  resetForTests(): void {
    this.unityInvokeCount = 0;
    this.coreInvokeCount = 0;
    this.clearListenersForTests();
  }
}

// ---- payload events (ports of CoreEvent<T1..T4>) -----------------------------

abstract class PayloadEvent<TArgs extends unknown[]> extends CoreEventBase {
  protected eventData: TArgs[] = [];
  protected postedCount = 0;

  protected invokeImpl(args: TArgs): void {
    this.eventData.push(args);
    for (const l of [...this.listeners]) {
      if (l.time === EventTime.Immediate) l.cb(...args);
    }
    this.notifyInvoked();
  }

  /** Replays only data appended since the last post-tick pass. */
  protected override doPendingPostGameCoreTickEvents(): void {
    for (const l of this.listeners) {
      if (l.time === EventTime.PostGameCoreTick) {
        for (let i = this.postedCount; i < this.eventData.length; i++) {
          l.cb(...this.eventData[i]);
        }
      }
    }
    this.postedCount = this.eventData.length;
  }

  /** Replays ALL accumulated data, then clears the buffer. */
  protected override doPendingPostUnityUpdateEvents(): void {
    for (const l of this.listeners) {
      if (l.time === EventTime.PostUnityUpdate) {
        for (const d of this.eventData) l.cb(...d);
      }
    }
    this.eventData = [];
    this.postedCount = 0;
  }

  resetForTests(): void {
    this.eventData = [];
    this.postedCount = 0;
    this.clearListenersForTests();
  }
}

export class CoreEvent1<T1> extends PayloadEvent<[T1]> {
  invoke(value1: T1): void {
    this.invokeImpl([value1]);
  }
}

export class CoreEvent2<T1, T2> extends PayloadEvent<[T1, T2]> {
  invoke(value1: T1, value2: T2): void {
    this.invokeImpl([value1, value2]);
  }
}

export class CoreEvent3<T1, T2, T3> extends PayloadEvent<[T1, T2, T3]> {
  invoke(value1: T1, value2: T2, value3: T3): void {
    this.invokeImpl([value1, value2, value3]);
  }
}

export class CoreEvent4<T1, T2, T3, T4> extends PayloadEvent<[T1, T2, T3, T4]> {
  invoke(value1: T1, value2: T2, value3: T3, value4: T4): void {
    this.invokeImpl([value1, value2, value3, value4]);
  }
}

export { EventTime };
