// tests/core/buff-subclasses.test.ts
// Semantics tests for the seven concrete buff ports: Bomb (rate scaling +
// m_power write-back quirk), Burn (timer cadence, tower typing via projectile,
// on-fire 0-damage quirk), Slow (supersede traversal — the FIRST slow eats a
// later one, faithful to the container order), FastPlayer (fastest wins, exit
// restores 1.0), Freeze (1s cadence, fire extinguish + event, typed/untyped
// damage paths, partial exit tick, slow/freeze supersede), Flare/Trampoline
// (pure timed markers).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { BuffContainer } from '../../src/core/BuffContainer';
import { BuffBomb } from '../../src/core/BuffBomb';
import { BuffBurn } from '../../src/core/BuffBurn';
import { BuffFastPlayer } from '../../src/core/BuffFastPlayer';
import { BuffFlare } from '../../src/core/BuffFlare';
import { BuffFreeze } from '../../src/core/BuffFreeze';
import { BuffSlow } from '../../src/core/BuffSlow';
import { BuffTrampoline } from '../../src/core/BuffTrampoline';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EEnemyClassTypeDef, EEnemyStrengthTypeDef } from '../../src/core/enums';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import {
  GameCoreHandle,
  setFrameResolver,
  setViewerResolver,
} from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreProjectile } from '../../src/core/GameCoreProjectile';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import type {
  ClassDamageInfo,
  EnemyViewContract,
  StrengthDamageInfo,
} from '../../src/view/q4-contracts';

const f = Math.fround;
const S = EEnemyStrengthTypeDef;
const C = EEnemyClassTypeDef;

// ---- fixtures ----------------------------------------------------------------

type Hit = {
  kind: 'typed' | 'untyped';
  strength?: EEnemyStrengthTypeDef;
  cls?: EEnemyClassTypeDef;
  damage: number;
  dist: number;
  source: GameCoreObject | null;
  attackPoint: GameCoreObject | null;
  immediate: boolean;
};

class TestEnemy extends GameCoreEnemy {
  hits: Hit[] = [];
  constructor() {
    super();
    // Emulate the post-spawn state (spawn ctor creates the BuffContainer).
    this.m_buffs = new BuffContainer();
  }
  override dealDamage(
    source: GameCoreObject | null,
    damage: number,
    dist: number,
    attackPoint: GameCoreObject | null,
    immediate = true,
  ): void {
    this.hits.push({ kind: 'untyped', damage, dist, source, attackPoint, immediate });
  }
  override dealDamageTyped(
    strength: EEnemyStrengthTypeDef,
    cls: EEnemyClassTypeDef,
    damage: number,
    dist: number,
    source: GameCoreObject | null,
    attackPoint: GameCoreObject | null,
    immediate = true,
  ): void {
    this.hits.push({ kind: 'typed', strength, cls, damage, dist, source, attackPoint, immediate });
  }
}

/** NOTE: spies must NOT subclass BuffSlow — removeBuffs matches the EXACT
 *  constructor (faithful quirk), so a subclass would survive removal. Use
 *  vi.spyOn on the instance's onExitBuff instead (call-through kept). */
function spyExits(buff: BuffSlow): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(buff, 'onExitBuff');
}

const sInfo = (
  strength: EEnemyStrengthTypeDef,
  damageTime: number,
  reactionTime = 1,
): StrengthDamageInfo => ({ strength, damageTime, reactionTime });
const cInfo = (
  classType: EEnemyClassTypeDef,
  damageTime: number,
  reactionTime = 1,
): ClassDamageInfo => ({ classType, damageTime, reactionTime });

function makeView(
  strengthDamageInfos: StrengthDamageInfo[],
  classDamageInfos: ClassDamageInfo[],
): EnemyViewContract {
  return {
    getComponentEnemyAttributesSettings: () => ({
      strengthDamageInfos,
      classDamageInfos,
      hasShieldEffect: () => false,
    }),
  };
}

let core: GameCore;
let views: Map<number, unknown>;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60); // sets TickDeltaTime for timer-driven buffs
  views = new Map();
  setViewerResolver((h) => views.get(h) ?? null);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
});

function makePlayer(id: number): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = new Vector3(40, 0, 40);
  return p;
}

function makeEnemy(): TestEnemy {
  const e = new TestEnemy();
  e.position = new Vector3(40, 0, 40);
  return e;
}

/** tower(Hard, Physic) → projectile → handle chain used by Burn/Freeze typing. */
function makeSourceChain(): { proj: GameCoreProjectile; tower: GameCoreTower } {
  const tower = new GameCoreTower('test_tower', []);
  tower.strengthType = S.Hard;
  tower.classType = C.Physic;
  tower.position = new Vector3(40, 0, 40);
  const proj = new (class extends GameCoreProjectile {})(tower, null);
  proj.sourceTower = tower.handle;
  proj.position = new Vector3(40, 0, 40);
  return { proj, tower };
}

function pokeTimer(buff: unknown, value: number): void {
  (buff as { m_timer: number }).m_timer = f(value);
}

// ---- BuffBomb ------------------------------------------------------------------

describe('BuffBomb', () => {
  it('scales power by strength then class rates and deals typed damage', () => {
    const enemy = makeEnemy();
    views.set(enemy.handle.m_handle, makeView([sInfo(S.Soft, 2)], [cInfo(C.Magic, 3)]));
    const bomb = new BuffBomb(0, { attackPower: 10, strengthType: S.Soft, classType: C.Magic }, 0.25);
    bomb.executeBuff(enemy);
    expect(enemy.hits.length).toBe(1);
    const h = enemy.hits[0];
    // rate = 2×10 = 20; power = 3×20 = 60
    expect(h).toMatchObject({
      kind: 'typed',
      strength: S.Soft,
      cls: C.Magic,
      damage: 60,
      dist: f(0.25),
      attackPoint: null,
      immediate: false,
    });
    expect(h.source).toBe(bomb);
  });

  it('FAITHFUL QUIRK: scaled power is written back into m_power (re-execute compounds)', () => {
    const enemy = makeEnemy();
    views.set(enemy.handle.m_handle, makeView([sInfo(S.Soft, 2)], [cInfo(C.Magic, 3)]));
    const bomb = new BuffBomb(0, { attackPower: 10, strengthType: S.Soft, classType: C.Magic }, 0);
    bomb.executeBuff(enemy);
    bomb.executeBuff(enemy); // second execute rescales the ALREADY-scaled power
    expect(enemy.hits[0].damage).toBe(60);
    expect(enemy.hits[1].damage).toBe(360); // 3×(2×60)
  });

  it('null setting keeps power 1.0; non-enemy or destroyed targets are no-ops', () => {
    const enemy = makeEnemy(); // no view → rates default 1.0
    const bomb = new BuffBomb(0, null, 0);
    bomb.executeBuff(enemy);
    expect(enemy.hits[0].damage).toBe(1);

    const player = makePlayer(1);
    bomb.executeBuff(player); // not an enemy → ignored
    expect(enemy.hits.length).toBe(1);

    const dead = makeEnemy();
    dead.destroySelf();
    bomb.executeBuff(dead);
    expect(dead.hits.length).toBe(0);
  });
});

// ---- BuffBurn ------------------------------------------------------------------

describe('BuffBurn', () => {
  it('fires when the timer elapses: damage = class×(strength×(power×frequency)), typed by the source tower', () => {
    const enemy = makeEnemy();
    views.set(enemy.handle.m_handle, makeView([sInfo(S.Hard, 2)], [cInfo(C.Physic, 3)]));
    const { proj } = makeSourceChain();
    const burn = new BuffBurn(5, 12, proj.handle, 0.5);

    burn.executeBuff(enemy); // timer 0 − dt ≤ 0 → fires: 3×(2×(12×0.5)) = 36
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0]).toMatchObject({
      kind: 'typed',
      strength: S.Hard,
      cls: C.Physic,
      damage: 36,
      dist: 0,
      attackPoint: null,
      immediate: false,
    });
    expect(enemy.hits[0].source).toBe(burn);

    burn.executeBuff(enemy); // timer 0.5 − 1/60 > 0 → silent
    expect(enemy.hits.length).toBe(1);

    pokeTimer(burn, 0.01); // next execute crosses zero again
    burn.executeBuff(enemy);
    expect(enemy.hits.length).toBe(2);
  });

  it('without a source tower: Normal/Normal typing, default rates', () => {
    const enemy = makeEnemy(); // no view → rates 1.0
    const burn = new BuffBurn(5, 12, GameCoreHandle.nullHandle, 0.5);
    burn.executeBuff(enemy);
    expect(enemy.hits[0]).toMatchObject({
      kind: 'typed',
      strength: S.Normal,
      cls: C.Normal,
      damage: 6, // 12 × 0.5
    });
  });

  it('FAITHFUL QUIRK: an already-burning enemy takes a 0-damage tick (call still made)', () => {
    const enemy = makeEnemy();
    enemy.isOnFire = true; // false→true raises no event
    const burn = new BuffBurn(5, 12, GameCoreHandle.nullHandle, 0.5);
    burn.executeBuff(enemy);
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0].damage).toBe(0);
  });
});

// ---- BuffSlow ------------------------------------------------------------------

describe('BuffSlow', () => {
  const setting = { playerSpeedScale: 0.6, enemySpeedScale: 0.4 };

  it('applies the player scale from the setting while scale ≤ current', () => {
    const p = makePlayer(1);
    const slow = new BuffSlow(5, setting, p);
    p.buffs.addBuff(slow, p);
    p.buffs.tick(p);
    expect(p.getSpeedScale()).toBeCloseTo(0.6, 6);
  });

  it('uses enemySpeedScale for enemy targets', () => {
    const e = makeEnemy();
    const slow = new BuffSlow(5, setting, e);
    e.buffs.addBuff(slow, e);
    e.buffs.tick(e);
    expect(e.getSpeedScale()).toBeCloseTo(0.4, 6);
  });

  it('FAITHFUL QUIRK: on re-execution the FIRST slow removes later slows (container order wins)', () => {
    const p = makePlayer(1);
    const slow1 = new BuffSlow(5, setting, p);
    const slow2 = new BuffSlow(5, { playerSpeedScale: 0.3, enemySpeedScale: 0.4 }, p);
    const slow2Exits = spyExits(slow2);
    p.buffs.addBuff(slow1, p);
    p.buffs.tick(p); // slow1 → 0.6
    p.buffs.addBuff(slow2, p);
    p.buffs.tick(p);
    // Traversal: slow1 executes first (0.6 ≤ 0.6) → RemoveBuffs<BuffSlow>(except
    // slow1) drops slow2 (its exit restores 1.0), then slow1 re-applies 0.6.
    expect(slow2Exits).toHaveBeenCalledTimes(1);
    expect(p.getSpeedScale()).toBeCloseTo(0.6, 6);
    expect(p.buffs.getAllBuffs()).toEqual([slow1]);
  });

  it('FAITHFUL QUIRK: a later slow never lands — the first slow’s re-execution removes it', () => {
    const p = makePlayer(1);
    const slow1 = new BuffSlow(5, { playerSpeedScale: 0.3, enemySpeedScale: 0.4 }, p);
    p.buffs.addBuff(slow1, p);
    p.buffs.tick(p); // 0.3
    const slow2 = new BuffSlow(5, setting, p); // scale 0.6 — would be inert anyway
    const slow1Exits = spyExits(slow1);
    const slow2Exits = spyExits(slow2);
    p.buffs.addBuff(slow2, p);
    p.buffs.tick(p);
    // Traversal: slow1 executes first — guard 0.3 ≤ 0.3 passes → its
    // RemoveBuffs<BuffSlow>(except slow1) drops slow2 before it ever executes
    // (slow2's exit restores 1.0, then slow1 re-applies 0.3).
    expect(p.getSpeedScale()).toBeCloseTo(0.3, 6);
    expect(slow1Exits).toHaveBeenCalledTimes(0);
    expect(slow2Exits).toHaveBeenCalledTimes(1);
    expect(p.buffs.getAllBuffs()).toEqual([slow1]);
  });

  it('exit restores speed scale 1.0', () => {
    const p = makePlayer(1);
    const slow = new BuffSlow(5, setting, p);
    p.buffs.addBuff(slow, p);
    p.buffs.tick(p);
    slow.onExitBuff(p);
    expect(p.getSpeedScale()).toBe(1);
  });
});

// ---- BuffFastPlayer --------------------------------------------------------------

describe('BuffFastPlayer', () => {
  const setting = { playerSpeedScale: 1.5, enemySpeedScale: 2.0, isContinuous: false };

  it('raises the scale only while current ≤ boost (fastest effect wins)', () => {
    const p = makePlayer(1);
    const fast = new BuffFastPlayer(2, setting, p);
    fast.executeBuff(p);
    expect(p.getSpeedScale()).toBeCloseTo(1.5, 6);
    p.setSpeedScale(2.0); // something faster already active
    fast.executeBuff(p);
    expect(p.getSpeedScale()).toBe(2.0); // untouched
  });

  it('enemy targets use enemySpeedScale; exit restores 1.0 unconditionally', () => {
    const e = makeEnemy();
    const fast = new BuffFastPlayer(2, setting, e);
    fast.executeBuff(e);
    expect(e.getSpeedScale()).toBeCloseTo(2.0, 6);
    fast.onExitBuff(e);
    expect(e.getSpeedScale()).toBe(1);
  });
});

// ---- BuffFreeze ------------------------------------------------------------------

describe('BuffFreeze', () => {
  it('enemy path: extinguishes fire (raising the event) and deals tower-typed damage via the UNTYPED overload', () => {
    const enemy = makeEnemy();
    views.set(enemy.handle.m_handle, makeView([sInfo(S.Hard, 2)], [cInfo(C.Physic, 3)]));
    const { proj } = makeSourceChain(); // Hard/Physic
    const extinguished: GameCoreObject[] = [];
    const cb = (o: GameCoreObject) => extinguished.push(o);
    Events.onFireExtinguished.addListener(cb, EventTime.Immediate);

    enemy.isOnFire = true;
    const freeze = new BuffFreeze(5, 10, 0.5, 0.7, proj.handle);
    freeze.executeBuff(enemy);

    expect(enemy.isOnFire).toBe(false);
    expect(extinguished).toEqual([enemy]);
    // damage = 3 × (2 × 10) = 60, untyped overload with the PROJECTILE as source
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0]).toMatchObject({
      kind: 'untyped',
      damage: 60,
      dist: 0,
      attackPoint: null,
      immediate: false,
    });
    expect(enemy.hits[0].source).toBe(proj);
    // slow applied to the enemy scale
    expect(enemy.getSpeedScale()).toBeCloseTo(0.5, 6);
    Events.onFireExtinguished.removeListener(cb);
  });

  it('1-second cadence: the next execute within the interval is a pure no-op', () => {
    const enemy = makeEnemy();
    const freeze = new BuffFreeze(5, 10, 0.5, 0.7, GameCoreHandle.nullHandle);
    freeze.executeBuff(enemy); // fires (timer 0 − dt ≤ 0); rates default 1 → 10
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0].damage).toBe(10);
    expect(enemy.hits[0].source).toBeNull(); // null handle → no source object
    freeze.executeBuff(enemy); // timer 1 − 1/60 > 0 → early-out
    expect(enemy.hits.length).toBe(1);
    expect(enemy.getSpeedScale()).toBeCloseTo(0.5, 6); // unchanged
  });

  it('player path: applies speedScaleToPlayer, never damages', () => {
    const p = makePlayer(1);
    const freeze = new BuffFreeze(5, 10, 0.5, 0.7, GameCoreHandle.nullHandle);
    freeze.executeBuff(p);
    expect(p.getSpeedScale()).toBeCloseTo(0.7, 6);
  });

  it('powerPerSecond = 0 → no damage on tick or exit, speed still applied/restored', () => {
    const enemy = makeEnemy();
    const freeze = new BuffFreeze(5, 0, 0.5, 0.7, GameCoreHandle.nullHandle);
    freeze.executeBuff(enemy);
    expect(enemy.hits.length).toBe(0);
    expect(enemy.getSpeedScale()).toBeCloseTo(0.5, 6);
    freeze.onExitBuff(enemy);
    expect(enemy.hits.length).toBe(0);
    expect(enemy.getSpeedScale()).toBe(1);
  });

  it('exit deals the final partial tick: Clamp01(1 − timer) × powerPerSecond', () => {
    const enemy = makeEnemy(); // no view → rates 1
    const { proj } = makeSourceChain();
    const freeze = new BuffFreeze(5, 10, 0.5, 0.7, proj.handle);
    freeze.executeBuff(enemy); // timer → 1.0, one full hit (typed via Hard/Physic: 60)
    expect(enemy.hits.length).toBe(1);
    pokeTimer(freeze, 0.25); // pretend 0.75 s of the interval elapsed
    freeze.onExitBuff(enemy);
    expect(enemy.hits.length).toBe(2);
    const exit = enemy.hits[1];
    expect(exit.kind).toBe('untyped');
    expect(exit.damage).toBeCloseTo(7.5, 6); // Clamp01(0.75) × 10
    expect(exit.source).toBe(proj);
    expect(enemy.getSpeedScale()).toBe(1); // restored
  });

  it('supersedes slows and other freezes in the container (freeze-after-slow traversal)', () => {
    const enemy = makeEnemy();
    const slow = new BuffSlow(5, { playerSpeedScale: 0.6, enemySpeedScale: 0.6 }, enemy);
    const slowExits = spyExits(slow);
    enemy.buffs.addBuff(slow, enemy);
    enemy.buffs.tick(enemy); // slow → 0.6
    expect(enemy.getSpeedScale()).toBeCloseTo(0.6, 6);

    const freeze = new BuffFreeze(5, 0, 0.5, 0.7, GameCoreHandle.nullHandle);
    enemy.buffs.addBuff(freeze, enemy);
    enemy.buffs.tick(enemy);
    // slow executes first (0.6 ≤ 0.6 → re-applies, RemoveBuffs<BuffSlow> keeps
    // itself), then freeze (0.5 ≤ 0.6) removes the slow and applies 0.5.
    expect(slowExits).toHaveBeenCalledTimes(1);
    expect(enemy.getSpeedScale()).toBeCloseTo(0.5, 6);
    expect(enemy.buffs.getAllBuffs()).toEqual([freeze]);
  });

  it('a slow cannot override an active stronger freeze (0.6 ≤ 0.5 is false)', () => {
    const enemy = makeEnemy();
    const freeze = new BuffFreeze(5, 0, 0.5, 0.7, GameCoreHandle.nullHandle);
    enemy.buffs.addBuff(freeze, enemy);
    enemy.buffs.tick(enemy); // freeze → 0.5
    const slow = new BuffSlow(5, { playerSpeedScale: 0.6, enemySpeedScale: 0.6 }, enemy);
    const slowExits = spyExits(slow);
    enemy.buffs.addBuff(slow, enemy);
    enemy.buffs.tick(enemy);
    // freeze re-executes first: timer 1 − dt > 0 → early-out; slow: 0.6 ≤ 0.5
    // false → inert. Freeze stays dominant and both buffs remain.
    expect(enemy.getSpeedScale()).toBeCloseTo(0.5, 6);
    expect(slowExits).toHaveBeenCalledTimes(0);
    expect(enemy.buffs.getAllBuffs()).toEqual([freeze, slow]);
  });
});

// ---- BuffFlare / BuffTrampoline ---------------------------------------------------

describe('BuffFlare / BuffTrampoline (pure timed markers)', () => {
  it('no-op execute; container expiry raises removeBuffEvent with the ctor', () => {
    const p = makePlayer(1);
    const container = p.buffs;
    const flare = new BuffFlare(null, 0.0); // setting ignored; duration 0
    container.addBuff(flare, p);

    const removed: Array<[GameCoreObject, unknown]> = [];
    const cb = (t: GameCoreObject, type: unknown) => removed.push([t, type]);
    Events.removeBuffEvent.addListener(cb, EventTime.Immediate);

    container.tick(p); // timeRemain 0 ≥ 0 → executes (no-op), then goes negative
    expect(removed.length).toBe(0);
    container.tick(p); // expired → exit
    expect(removed).toEqual([[p, BuffFlare]]);
    expect(container.getAllBuffs()).toEqual([]);
    Events.removeBuffEvent.removeListener(cb);
  });

  it('trampoline keeps the (duration, setting) ctor order and no-ops', () => {
    const p = makePlayer(1);
    const tramp = new BuffTrampoline(0.0, null);
    p.buffs.addBuff(tramp, p);
    p.buffs.tick(p);
    p.buffs.tick(p);
    expect(p.buffs.getAllBuffs()).toEqual([]);
    expect(p.getSpeedScale()).toBe(1); // untouched
  });
});
