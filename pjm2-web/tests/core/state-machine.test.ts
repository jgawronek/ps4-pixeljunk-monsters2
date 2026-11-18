// tests/core/state-machine.test.ts
// Semantics tests for the generic StateMachine/State framework (tower FSM
// foundation): duration-driven transitions (Tick return ignored), default
// fallback, next/next-next consumption, blocking/priority deferral,
// force-vs-set commands, hook ordering, mid-tick forced transitions.
// Plus GameCoreShop (viewer scan) and GameCoreCharacterTemplate.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Quaternion, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreCharacterTemplate } from '../../src/core/GameCoreCharacterTemplate';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreShop } from '../../src/core/GameCoreShop';
import { State, StateMachine } from '../../src/core/StateMachine';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  setShopViewerCandidatesProvider,
} from '../../src/view/q4-contracts';

// ---- fixtures ----------------------------------------------------------------

class TestState extends State<TestMachine> {
  enters = 0;
  exits = 0;
  ticks = 0;
  label: string;
  constructor(duration: number, label = 's', blocking = false, priority = 0) {
    super(duration);
    this.label = label;
    this.blocking = blocking;
    this.priority = priority;
  }
  override enter(_owner: TestMachine): void {
    this.enters++;
  }
  override tick(_owner: TestMachine, _dt: number): boolean {
    this.ticks++;
    return false; // return value is IGNORED by the machine (faithful)
  }
  override exit(_owner: TestMachine): void {
    this.exits++;
  }
}

class TestMachine extends StateMachine<TestMachine> {
  preEnters: string[] = [];
  postExits: string[] = [];
  constructor(def: TestState) {
    super(def);
  }
  override statePreEnter(state: State<TestMachine>): void {
    this.preEnters.push((state as TestState).label);
  }
  override statePostExit(state: State<TestMachine>): void {
    this.postExits.push((state as TestState).label);
  }
}

let core: GameCore;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  setViewerResolver((h) => getRegisteredUnityObject(h));
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setShopViewerCandidatesProvider(null);
  resetUnityObjectRegistryForTests();
});

// ---- StateMachine ----------------------------------------------------------------

describe('StateMachine', () => {
  it('first tick enters the default state with a zeroed clock', () => {
    const def = new TestState(1, 'def');
    const m = new TestMachine(def);
    m.tickState(1 / 60);
    expect(m.currentState).toBe(def);
    expect(def.stateTime).toBe(0); // enter resets AFTER the transition
    expect(def.enters).toBe(1);
    expect(m.preEnters).toEqual(['def']);
  });

  it('duration expiry transitions to next; Tick return value is ignored', () => {
    const def = new TestState(0.1, 'def');
    const next = new TestState(1, 'next');
    const m = new TestMachine(def);
    m.tickState(0.05); // enters def, clock 0
    m.setNextCommand(next);
    m.tickState(0.05); // clock 0.05 < 0.1 → stays (tick returned false — ignored)
    expect(m.currentState).toBe(def);
    m.tickState(0.06); // clock 0.11 ≥ 0.1 → transition
    expect(m.currentState).toBe(next);
    expect(next.stateTime).toBe(0);
    expect(def.exits).toBe(1);
    expect(m.postExits).toEqual(['def']);
    expect(m.preEnters).toEqual(['def', 'next']);
  });

  it('expiry with no next falls back to the default (re-enter)', () => {
    const def = new TestState(0.05, 'def');
    const m = new TestMachine(def);
    m.tickState(0.01);
    m.tickState(0.05); // expired → default again
    expect(m.currentState).toBe(def);
    expect(def.enters).toBe(2);
  });

  it('next-next is consumed into next on transition', () => {
    const cur = new TestState(0.05, 'cur', true); // blocking
    const x = new TestState(1, 'x');
    const y = new TestState(1, 'y');
    const m = new TestMachine(cur);
    m.tickState(0.01); // enters cur
    m.setCurrentCommand(x, y); // blocking → deferred: next=x, nextNext=y
    expect(m.currentState).toBe(cur);
    expect(m.nextState).toBe(x);
    m.tickState(0.05); // cur expires → force x; nextNext y → next
    expect(m.currentState).toBe(x);
    expect(m.nextState).toBe(y);
  });

  it('setCurrentCommand: immediate when unblocked and priority >=; deferred otherwise', () => {
    const def = new TestState(10, 'def', false, 5);
    const m = new TestMachine(def);
    m.tickState(0.01);

    const higher = new TestState(10, 'higher', false, 6);
    m.setCurrentCommand(higher, null); // 5 <= 6, unblocked → immediate
    expect(m.currentState).toBe(higher);

    const lower = new TestState(10, 'lower', false, 1);
    m.setCurrentCommand(lower, null); // 6 <= 1 false → deferred
    expect(m.currentState).toBe(higher);
    expect(m.nextState).toBe(lower);

    const blocker = new TestState(10, 'blocker', true, 0);
    m.forceCurrentCommand(blocker, null);
    const urgent = new TestState(10, 'urgent', false, 99);
    m.setCurrentCommand(urgent, null); // blocking → deferred regardless of priority
    expect(m.currentState).toBe(blocker);
    expect(m.nextState).toBe(urgent);
  });

  it('forceCurrentCommand discards the pending next via PostExit hook ONLY (no Exit)', () => {
    const def = new TestState(10, 'def');
    const pending = new TestState(10, 'pending');
    const forced = new TestState(10, 'forced');
    const after = new TestState(10, 'after');
    const m = new TestMachine(def);
    m.tickState(0.01);
    m.setNextCommand(pending);
    m.forceCurrentCommand(forced, after);
    expect(m.currentState).toBe(forced);
    expect(m.nextState).toBe(after);
    expect(m.postExits).toContain('pending');
    expect(pending.exits).toBe(0); // hook only — Exit NOT called on discarded next
    expect(def.exits).toBe(1); // current exits properly
  });

  it('mid-tick forced transition is re-read (no double transition)', () => {
    class ForcingState extends TestState {
      override tick(owner: TestMachine, _dt: number): boolean {
        super.tick(owner, _dt);
        owner.forceCurrentCommand(new TestState(10, 'forced'), null);
        return true;
      }
    }
    const def = new ForcingState(10, 'def');
    const m = new TestMachine(def);
    m.tickState(0.01); // enters def
    m.tickState(0.01); // def.tick forces 'forced'; re-read → clock 0 < 10 → return
    expect((m.currentState as TestState).label).toBe('forced');
    expect(m.currentState!.stateTime).toBe(0);
  });

  it('isStateRunning / isStateRunningOrPending use instanceof', () => {
    class SubState extends TestState {}
    const def = new TestState(10, 'def');
    const sub = new SubState(10, 'sub');
    const m = new TestMachine(def);
    m.tickState(0.01);
    expect(m.isStateRunning(TestState)).toBe(true);
    expect(m.isStateRunning(SubState)).toBe(false);
    m.setNextCommand(sub);
    expect(m.isStateRunningOrPending(SubState)).toBe(true);
    expect(m.isStateRunning(SubState)).toBe(false);
  });
});

// ---- Shop / CharacterTemplate -------------------------------------------------------

describe('GameCoreShop', () => {
  it('collision (0.5, 0.5) at origin; viewer scan matches sqrDistance < 1.0', () => {
    const shop = new GameCoreShop();
    expect(shop.collision.radius).toBeCloseTo(0.5, 6);
    expect(shop.collision.height).toBeCloseTo(0.5, 6);
    expect(shop.position.x).toBe(0);
    expect(shop.recreateViewer()).toBeNull(); // no candidates headless

    const near = { gameObject: { tag: 'near' } };
    const far = { gameObject: { tag: 'far' } };
    setShopViewerCandidatesProvider(() => [
      { position: { x: 2, y: 0, z: 0 }, gameObject: far.gameObject },
      { position: { x: 0, y: 0, z: 0.5 }, gameObject: near.gameObject },
    ]);
    expect(shop.recreateViewer()).toBe(near.gameObject); // 0.25 < 1.0
  });
});

describe('GameCoreCharacterTemplate', () => {
  it('lands position and links the prefab as its unity object; tick no-op', () => {
    const prefab = { tag: 'character' };
    const t = new GameCoreCharacterTemplate(
      new Vector3(40, 0, 40),
      Quaternion.identity,
      prefab,
    );
    expect(t.position.x).toBe(40);
    expect(t.getUnityObject()).toBe(prefab);
    expect(() => t.tick()).not.toThrow();
  });
});
