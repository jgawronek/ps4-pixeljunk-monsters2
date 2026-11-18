// tests/core/pool-handle.test.ts
// Semantics tests for the CoreObjectPool and GameCoreHandle ports.

import { beforeEach, describe, expect, it } from 'vitest';

import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import {
  GameCoreHandle,
  setFrameResolver,
  setViewerResolver,
  type SimObjectLike,
} from '../../src/core/GameCoreHandle';

// ---- fixtures ---------------------------------------------------------------

class Pooled {
  a = 1;
  b = 2;
}

class WithDeepFields {
  list: number[][] = [[1], [2]];
  shared: Pooled = new Pooled();
  static readonly deepCopyFields = ['list'] as const;
}

class FakeObject implements SimObjectLike {
  destroyed = false;
  constructor(readonly typeName: string) {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ---- CoreObjectPool ----------------------------------------------------------

describe('CoreObjectPool', () => {
  beforeEach(() => CoreObjectPool.resetInstanceForTests());

  it('allocates new instances and recycles returned ones (identity preserved)', () => {
    const first = CoreObjectPool.allocate(Pooled);
    expect(first).toBeInstanceOf(Pooled);
    expect(first.a).toBe(1);
    CoreObjectPool.returnObject(first);
    const second = CoreObjectPool.allocate(Pooled);
    expect(second).toBe(first); // same instance — behaviorally significant
  });

  it('pools are per-constructor', () => {
    class Other {
      x = 0;
    }
    const p = CoreObjectPool.allocate(Pooled);
    CoreObjectPool.returnObject(p);
    const o = CoreObjectPool.allocate(Other);
    expect(o).toBeInstanceOf(Other);
    expect(CoreObjectPool.allocate(Pooled)).toBe(p);
  });

  it('returnObject(null) is a no-op', () => {
    expect(() => CoreObjectPool.returnObject(null)).not.toThrow();
  });

  it('doNotCallConstructorIfNew skips field initializers (GetUninitializedObject parity)', () => {
    const raw = CoreObjectPool.allocateByType(Pooled, true) as Pooled;
    expect(raw).toBeInstanceOf(Pooled);
    expect(raw.a).toBeUndefined(); // ctor never ran
  });

  it('deepCopy: listed fields are copied recursively, others shallow-assigned', () => {
    const src = new WithDeepFields();
    const copy = CoreObjectPool.allocateDeepCopy(src)!;
    expect(copy).not.toBe(src);
    // deep field: distinct containers with equal content
    expect(copy.list).not.toBe(src.list);
    expect(copy.list[0]).not.toBe(src.list[0]);
    expect(copy.list).toEqual(src.list);
    // non-listed field: shared reference (shallow)
    expect(copy.shared).toBe(src.shared);
  });

  it('allocateDeepCopy(null) returns null', () => {
    expect(CoreObjectPool.allocateDeepCopy(null)).toBeNull();
  });
});

// ---- GameCoreHandle -----------------------------------------------------------

describe('GameCoreHandle', () => {
  beforeEach(() => {
    GameCoreHandle.resetStaticsForTests();
    setFrameResolver(null);
    setViewerResolver(null);
  });

  it('createHandle allocates increasing ids; explicit ids honored', () => {
    const h1 = GameCoreHandle.createHandle();
    const h2 = GameCoreHandle.createHandle();
    expect(h2.m_handle).toBe(h1.m_handle + 1);
    expect(GameCoreHandle.createHandle(77).m_handle).toBe(77);
  });

  it('nullHandle is null (negative id); created handles are not', () => {
    expect(GameCoreHandle.nullHandle.isNull).toBe(true);
    expect(GameCoreHandle.createHandle().isNull).toBe(false);
  });

  it('equality compares the int id only', () => {
    const a = GameCoreHandle.createHandle(5);
    const b = GameCoreHandle.createHandle(5);
    expect(a.equals(b)).toBe(true);
    expect(a.notEquals(GameCoreHandle.createHandle(6))).toBe(true);
    expect(a.equals(null)).toBe(false);
  });

  it('resolves through the frame resolver and caches until tag invalidation', () => {
    const obj = new FakeObject('GameCoreEnemy');
    let calls = 0;
    setFrameResolver((id) => {
      calls++;
      return id === 42 ? obj : null;
    });
    const h = GameCoreHandle.createHandle(42);
    expect(h.getMostRecentObjectVersion<FakeObject>()).toBe(obj);
    expect(h.getMostRecentObjectVersion<FakeObject>()).toBe(obj);
    expect(calls).toBe(1); // cached
    GameCoreHandle.invalidateAllCachedData();
    expect(h.getMostRecentObjectVersion<FakeObject>()).toBe(obj);
    expect(calls).toBe(2); // re-resolved after tag bump
  });

  it('destroyed or unknown objects resolve to null', () => {
    const obj = new FakeObject('GameCoreTower');
    setFrameResolver(() => obj);
    const h = GameCoreHandle.createHandle(1);
    expect(h.getMostRecentObjectVersion()).toBe(obj);
    obj.destroyed = true;
    expect(h.getMostRecentObjectVersion()).toBeNull();
    setFrameResolver(() => null);
    GameCoreHandle.invalidateAllCachedData();
    expect(GameCoreHandle.createHandle(2).getMostRecentObjectVersion()).toBeNull();
  });

  it('viewer cache is tag-gated and only primes after object resolution (faithful quirk)', () => {
    const obj = new FakeObject('GameCoreEnemy');
    setFrameResolver((id) => (id === 7 ? obj : null));
    const viewer = { name: 'kuri_view' };
    let calls = 0;
    setViewerResolver((id) => {
      calls++;
      return id === 7 ? viewer : null;
    });
    const h = GameCoreHandle.createHandle(7);
    // FAITHFUL QUIRK: getUnityObject caches the viewer but NEVER bumps
    // m_cacheTag (only getMostRecentObjectVersion does). A fresh handle has
    // m_cacheTag=0 vs s_cacheTag=100, so the viewer cache cannot hit until an
    // object resolution primes the tag — the bridge is re-asked until then.
    expect(h.getUnityObject()).toBe(viewer);
    expect(h.getUnityObject()).toBe(viewer);
    expect(calls).toBe(2);
    // Prime the tag via object resolution → the already-cached viewer now
    // passes the tag gate, so subsequent calls hit the cache (no re-resolve).
    h.getMostRecentObjectVersion();
    expect(h.getUnityObject()).toBe(viewer);
    expect(h.getUnityObject()).toBe(viewer);
    expect(calls).toBe(2);
    // Tag bump invalidates the viewer cache again → one more resolve.
    GameCoreHandle.invalidateAllCachedData();
    expect(h.getUnityObject()).toBe(viewer);
    expect(calls).toBe(3);
  });

  it('no viewer resolver → null (headless parity with bridge==null)', () => {
    expect(GameCoreHandle.createHandle().getUnityObject()).toBeNull();
  });

  it('ensureNextHandleIsGreaterThan prevents id reuse after load', () => {
    GameCoreHandle.ensureNextHandleIsGreaterThan(GameCoreHandle.createHandle(500));
    expect(GameCoreHandle.createHandle().m_handle).toBe(501);
  });

  it('resetNextHandleIndex wraps past 100000 (long-session guard)', () => {
    const h = GameCoreHandle.createHandle(100001);
    GameCoreHandle.ensureNextHandleIsGreaterThan(h);
    GameCoreHandle.resetNextHandleIndex();
    const next = GameCoreHandle.createHandle();
    expect(next.m_handle).toBeLessThan(0); // wrapped negative → reads as null
    expect(next.isNull).toBe(true);
  });

  it('toString matches the original format', () => {
    const obj = new FakeObject('GameCoreHome');
    setFrameResolver(() => obj);
    const h = GameCoreHandle.createHandle(9);
    expect(h.toString()).toBe('GameCoreHandle(9), GameCoreHome');
    obj.destroyed = true;
    GameCoreHandle.invalidateAllCachedData();
    expect(h.toString()).toBe('GameCoreHandle(9), GameCoreHome Destroyed');
  });
});
