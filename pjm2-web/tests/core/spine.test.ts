// tests/core/spine.test.ts
// Integration tests for the Phase-1 core spine: GameCore root + GameCoreFrame +
// GameCoreObject + GameCoreHandle resolution + collision grid.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { Cylinder } from '../../src/core/Cylinder';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { GameCoreFrame } from '../../src/core/GameCoreFrame';
import { GameCoreHandle, setFrameResolver } from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { CoreEventBase, CoreEvent1, EventTime } from '../../src/core/event/CoreEvent';

// ---- fixtures ----------------------------------------------------------------

class TestObj extends GameCoreObject {
  tickCount = 0;
  override tick(): void {
    this.tickCount++;
  }
}

class SubObj extends TestObj {
  subTicks = 0;
  override tick(): void {
    super.tick();
    this.subTicks++;
  }
}

let core: GameCore;

function bootCore(boundsSize = 64): GameCore {
  setBoundsProvider(
    () => new Bounds(new Vector3(boundsSize / 2, 0, boundsSize / 2), new Vector3(boundsSize, 10, boundsSize)),
  );
  const gc = new GameCore();
  setInstanceProvider(() => gc);
  gc.installFrame(gc.currentFrame); // triggers collision init with provider bounds
  return gc;
}

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  CoreObjectPool.resetInstanceForTests();
  core = bootCore();
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setBoundsProvider(null);
});

// ---- object lifecycle ----------------------------------------------------------

describe('GameCoreObject + frame registration', () => {
  it('ctor registers with the live frame, assigns a handle, default collision', () => {
    const o = new TestObj();
    expect(o.handle.isNull).toBe(false);
    expect(o.collision.radius).toBe(0.5);
    expect(o.collision.height).toBe(0.5);
    expect(core.currentFrame.objectCount).toBe(1);
    expect(core.currentFrame.getObject<TestObj>(o.handle)).toBe(o);
  });

  it('no GameCore instance → object stays unregistered and handle-less', () => {
    setInstanceProvider(null);
    const o = new TestObj();
    expect(o.handle.isNull).toBe(true);
  });

  it('position setter re-buckets into the collision grid', () => {
    const o = new TestObj();
    o.position = new Vector3(10, 0, 10);
    const found = [...core.allObjectsIn(GameCoreObject, new Vector3(10, 0, 10), new Cylinder(1, 1))];
    expect(found).toContain(o);
  });

  it('destroySelf de-grids; frame purge happens on next prepareNextFrame', () => {
    const a = new TestObj();
    const b = new TestObj();
    a.destroySelf();
    expect(a.isDestroyed()).toBe(true);
    // still in the frame list until the sweep
    expect(core.currentFrame.objectCount).toBe(2);
    core.prepareNextFrame();
    expect(core.currentFrame.objectCount).toBe(1);
    expect(core.currentFrame.getObject<TestObj>(a.handle)).toBeNull();
    expect(b.isDestroyed()).toBe(false);
  });

  it('previousTickPosition snapshots on prepare', () => {
    const o = new TestObj();
    o.position = new Vector3(1, 2, 3);
    core.prepareNextFrame();
    expect(o.previousTickPosition.equals(new Vector3(1, 2, 3))).toBe(true);
    o.position = new Vector3(4, 5, 6);
    expect(o.previousTickPosition.equals(new Vector3(1, 2, 3))).toBe(true);
    core.prepareNextFrame();
    expect(o.previousTickPosition.equals(new Vector3(4, 5, 6))).toBe(true);
  });

  it('handle resolution returns null for destroyed objects', () => {
    const o = new TestObj();
    const h = o.handle;
    expect(h.getMostRecentObjectVersion<TestObj>()).toBe(o);
    o.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    expect(h.getMostRecentObjectVersion<TestObj>()).toBeNull();
  });

  it('toString/equals parity', () => {
    const o = new TestObj();
    expect(o.toString()).toBe(`TestObj (${o.handle.m_handle})`);
    const other = new TestObj();
    expect(o.equals(other)).toBe(false);
    expect(o.equals(o)).toBe(true);
  });
});

// ---- frame semantics -------------------------------------------------------------

describe('GameCoreFrame', () => {
  it('ticks in list order; objects added during tick wait for next frame', () => {
    const order: string[] = [];
    class A extends GameCoreObject {
      override tick(): void {
        order.push('a');
      }
    }
    class B extends GameCoreObject {
      override tick(): void {
        order.push('b');
        if (order.length === 2) new C(); // added during the tick
      }
    }
    class C extends GameCoreObject {
      override tick(): void {
        order.push('c');
      }
    }
    new A();
    new B();
    core.prepareNextFrame();
    core.tick(1 / 60);
    expect(order).toEqual(['a', 'b']); // C NOT ticked this frame
    order.length = 0;
    core.prepareNextFrame();
    core.tick(1 / 60);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('typed queries index the whole hierarchy (subclass under base type)', () => {
    const t = new TestObj();
    const s = new SubObj();
    const tests = [...core.allObjects<TestObj>(TestObj)];
    expect(tests).toContain(t);
    expect(tests).toContain(s); // SubObj indexed under TestObj too
    const subs = [...core.allObjects<SubObj>(SubObj)];
    expect(subs).toEqual([s]);
    expect(core.firstObject<TestObj>(TestObj)).toBe(t);
    expect(core.firstObject<SubObj>(SubObj)).toBe(s);
  });

  it('tickDeltaTime clamps to 0.5 (original Min(Time.deltaTime, 0.5))', () => {
    core.tick(2.0);
    expect(GameCore.tickDeltaTime).toBe(0.5);
    core.tick(1 / 60);
    expect(GameCore.tickDeltaTime).toBeCloseTo(1 / 60, 6);
  });

  it('prepareNextFrame advances lastUpdateTime by tickDeltaTime', () => {
    core.tick(0.25); // sets TickDeltaTime = 0.25
    core.prepareNextFrame();
    expect(core.currentFrame.m_frameTime).toBeCloseTo(0.25, 6);
    core.prepareNextFrame();
    expect(core.currentFrame.m_frameTime).toBeCloseTo(0.5, 6);
  });

  it('allocateFrame uses the pool and sets frame time', () => {
    const fr = GameCoreFrame.allocateFrame(1.5);
    expect(fr).toBeInstanceOf(GameCoreFrame);
    expect(fr.m_frameTime).toBe(1.5);
  });
});

// ---- collision grid ----------------------------------------------------------------

describe('GameCoreCollisionManager grid', () => {
  it('finds objects within radius (XZ) and height overlap', () => {
    const near = new TestObj();
    near.position = new Vector3(20, 0, 20);
    const far = new TestObj();
    far.position = new Vector3(40, 0, 40);

    const hits = [...core.allObjectsIn(GameCoreObject, new Vector3(20.5, 0, 20), new Cylinder(2, 2))];
    expect(hits).toContain(near);
    expect(hits).not.toContain(far);
  });

  it('vertical separation excludes (height matters in narrow phase)', () => {
    const o = new TestObj();
    o.position = new Vector3(20, 5, 20); // its cylinder spans y 5..5.5 (h=0.5)
    // query cylinder at ground: pos.y + halfHeight(0.5) → spans ~0..1
    const hits = [...core.allObjectsIn(GameCoreObject, new Vector3(20, 0, 20), new Cylinder(2, 1))];
    expect(hits).not.toContain(o);
  });

  it('object spanning multiple cells is returned once (dedup set)', () => {
    const big = new TestObj();
    big.collision = new Cylinder(6, 1); // spans several 4-unit cells
    big.position = new Vector3(32, 0, 32);
    const hits = [...core.allObjectsIn(GameCoreObject, new Vector3(32, 0, 32), new Cylinder(6, 1))];
    expect(hits.filter((h) => h === big).length).toBe(1);
  });

  it('moving re-buckets: old cell no longer returns the object', () => {
    const o = new TestObj();
    o.position = new Vector3(12, 0, 12);
    expect([...core.allObjectsIn(GameCoreObject, new Vector3(12, 0, 12), new Cylinder(1, 1))]).toContain(o);
    o.position = new Vector3(50, 0, 50);
    expect([...core.allObjectsIn(GameCoreObject, new Vector3(12, 0, 12), new Cylinder(1, 1))]).not.toContain(o);
    expect([...core.allObjectsIn(GameCoreObject, new Vector3(50, 0, 50), new Cylinder(1, 1))]).toContain(o);
  });

  it('destroyed objects leave the grid immediately', () => {
    const o = new TestObj();
    o.position = new Vector3(12, 0, 12);
    o.destroySelf();
    expect([...core.allObjectsIn(GameCoreObject, new Vector3(12, 0, 12), new Cylinder(1, 1))]).not.toContain(o);
  });
});

// ---- tick + event seam ---------------------------------------------------------------

describe('tick seam wiring', () => {
  it('post-tick events flush inside tick() (PostGameCoreTick)', () => {
    const e = new CoreEvent1<string>();
    const seen: string[] = [];
    e.addListener((s) => seen.push(s), EventTime.PostGameCoreTick);
    e.invoke('during-frame');
    expect(seen).toEqual([]);
    core.tick(1 / 60); // Tick() flushes post-tick events
    expect(seen).toEqual(['during-frame']);
  });

  it('post-update events flush via invokePendingPostUnityUpdateEvents', () => {
    const e = new CoreEvent1<number>();
    let hits = 0;
    e.addListener((n) => (hits += n), EventTime.PostUnityUpdate);
    e.invoke(2);
    e.invoke(3);
    core.tick(1 / 60);
    expect(hits).toBe(0);
    core.invokePendingPostUnityUpdateEvents();
    expect(hits).toBe(5);
  });
});
