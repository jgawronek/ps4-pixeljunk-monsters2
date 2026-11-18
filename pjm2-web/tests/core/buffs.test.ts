// tests/core/buffs.test.ts
// Semantics tests for the Buff/BuffContainer foundation port, including the
// faithful quirks: increment-before-execute traversal, exact-type RemoveBuffs,
// null entries kept by getAllBuffs, expired-buff exit + drop.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { Buff } from '../../src/core/Buff';
import { BuffContainer } from '../../src/core/BuffContainer';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { GameCoreHandle, setFrameResolver } from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { EventTime } from '../../src/core/event/CoreEvent';

// ---- fixtures ----------------------------------------------------------------

class TestTarget extends GameCoreObject {}

class CountingBuff extends Buff {
  executions = 0;
  enters = 0;
  exits = 0;
  override onEnterBuff(_t: GameCoreObject): void {
    this.enters++;
  }
  override executeBuff(_t: GameCoreObject): void {
    this.executions++;
  }
  override onExitBuff(t: GameCoreObject): void {
    this.exits++;
    super.onExitBuff(t);
  }
}

class OtherBuff extends CountingBuff {}
class SubOtherBuff extends OtherBuff {}

let core: GameCore;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(
    () => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)),
  );
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setBoundsProvider(null);
});

// ---- tests ---------------------------------------------------------------------

describe('Buff', () => {
  it('ctor sets duration and null source projectile', () => {
    const b = new CountingBuff(3.5);
    expect(b.m_timeRemain).toBe(Math.fround(3.5));
    expect(b.sourceProjectile.isNull).toBe(true);
    expect(b.valid()).toBe(true);
  });

  it('updateBuff executes while valid and counts down', () => {
    const b = new CountingBuff(0.1);
    const t = new TestTarget();
    b.updateBuff(t, 0.05);
    expect(b.executions).toBe(1);
    expect(b.m_timeRemain).toBeCloseTo(0.05, 6);
    b.updateBuff(t, 0.1);
    expect(b.executions).toBe(2); // still >= 0 when executed
    expect(b.valid()).toBe(false); // now negative
    b.updateBuff(t, 0.1);
    expect(b.executions).toBe(2); // invalid → no execution
  });

  it('onExitBuff raises removeBuffEvent with the constructor (TS Type stand-in)', () => {
    const seen: Array<[unknown, unknown]> = [];
    const cb = (target: unknown, type: unknown) => seen.push([target, type]);
    Events.removeBuffEvent.addListener(cb, EventTime.Immediate);
    const b = new CountingBuff(1);
    const t = new TestTarget();
    b.onExitBuff(t);
    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe(t);
    expect(seen[0][1]).toBe(CountingBuff);
    Events.removeBuffEvent.removeListener(cb);
  });
});

describe('BuffContainer', () => {
  it('addBuff enters the buff and stores its handle', () => {
    const c = new BuffContainer();
    const b = new CountingBuff(5);
    const t = new TestTarget();
    c.addBuff(b, t);
    expect(b.enters).toBe(1);
    expect(c.getAllBuffs()).toEqual([b]);
  });

  it('tick executes live buffs and counts down by GameCore.tickDeltaTime', () => {
    core.tick(1 / 60); // sets TickDeltaTime
    const c = new BuffContainer();
    const b = new CountingBuff(1.0);
    const t = new TestTarget();
    c.addBuff(b, t);
    c.tick(t);
    expect(b.executions).toBe(1);
    expect(b.m_timeRemain).toBeCloseTo(1.0 - 1 / 60, 5);
  });

  it('tick exits + drops expired buffs (m_timeRemain < 0)', () => {
    const c = new BuffContainer();
    const b = new CountingBuff(0.0);
    const t = new TestTarget();
    c.addBuff(b, t);
    // drive timeRemain negative the way the container itself does
    c.tick(t); // executes (0 >= 0) then decrements below 0
    expect(b.executions).toBe(1);
    c.tick(t); // now expired → exit + drop, no execution
    expect(b.executions).toBe(1);
    expect(b.exits).toBe(1);
    expect(c.getAllBuffs()).toEqual([]);
  });

  it('tick drops unresolved handles', () => {
    const c = new BuffContainer();
    const b = new CountingBuff(5);
    const t = new TestTarget();
    c.addBuff(b, t);
    b.destroySelf(); // handle now resolves to null
    GameCoreHandle.invalidateAllCachedData();
    c.tick(t);
    expect(c.getAllBuffs()).toEqual([]);
  });

  it('removeBuffs removes EXACT type only, skipping the exception buff', () => {
    const c = new BuffContainer();
    const t = new TestTarget();
    const keeper = new OtherBuff(5); // the "exception" (this-buff)
    const victim1 = new OtherBuff(5);
    const victim2 = new SubOtherBuff(5); // subclass — must SURVIVE (exact type match)
    c.addBuff(keeper, t);
    c.addBuff(victim1, t);
    c.addBuff(victim2, t);
    c.removeBuffs(t, keeper, OtherBuff);
    expect(victim1.exits).toBe(1);
    expect(keeper.exits).toBe(0);
    expect(victim2.exits).toBe(0);
    const remaining = c.getAllBuffs();
    expect(remaining).toContain(keeper);
    expect(remaining).toContain(victim2);
    expect(remaining).not.toContain(victim1);
  });

  it('contains<T> uses instanceof', () => {
    const c = new BuffContainer();
    const t = new TestTarget();
    const b = new SubOtherBuff(5);
    c.addBuff(b, t);
    expect(c.contains(SubOtherBuff)).toBe(true);
    expect(c.contains(OtherBuff)).toBe(true); // instanceof includes bases
    expect(c.contains(CountingBuff)).toBe(true);
  });

  it('terminate exits all buffs and clears', () => {
    const c = new BuffContainer();
    const t = new TestTarget();
    const b1 = new CountingBuff(5);
    const b2 = new CountingBuff(5);
    c.addBuff(b1, t);
    c.addBuff(b2, t);
    c.terminate(t);
    expect(b1.exits).toBe(1);
    expect(b2.exits).toBe(1);
    expect(c.getAllBuffs()).toEqual([]);
  });

  it('FAITHFUL QUIRK: increment-before-execute — a buff removing others mid-tick keeps traversal', () => {
    // Reproduces the RemoveBuffs-during-ExecuteBuff pattern (freeze superseding
    // slow): the removing buff triggers container.removeBuffs from inside
    // executeBuff; the container must not skip or double-execute survivors.
    const c = new BuffContainer();
    const t = new TestTarget();

    class RemoverBuff extends Buff {
      removed = false;
      constructor(private victim: Buff, private ctor: new (...a: never[]) => Buff) {
        super(5);
      }
      override executeBuff(target: GameCoreObject): void {
        if (!this.removed) {
          this.removed = true;
          c.removeBuffs(target, this, this.ctor);
        }
      }
    }
    class SlowLike extends CountingBuff {}

    const victim = new SlowLike(5);
    const remover = new RemoverBuff(victim, SlowLike as unknown as new (...a: never[]) => Buff);
    c.addBuff(victim, t);
    c.addBuff(remover, t);
    c.tick(t);
    // victim executed once (index advanced past it), then removed by remover
    expect(victim.executions).toBe(1);
    expect(victim.exits).toBe(1);
    expect(c.getAllBuffs()).toEqual([remover]);
  });
});
