// tests/core/home.test.ts
// Semantics tests for the GameCoreHome port: chibi spawn (RNG determinism,
// half-arc quirk, ground snap), spread relaxation + attack-pos sorting, the
// VERIFIED IsEnemyClose comparison direction, the home-attack loop through
// Enemy.Attack → enemyAttackedHomeEvent → DealDamage (formation shift, game
// over + debug suppression), game-over straggler cleanup (boss exemption),
// wave-end chibi recording, and the guarded DestroySelf.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { ChibiData, GameCoreHome } from '../../src/core/GameCoreHome';
import { GameCoreWaveManager } from '../../src/core/GameCoreWaveManager';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setChibiAvoidanceZoneNotifier,
  setDebugCanvasProvider,
  setHomeViewsFinder,
  setUnityObjectDestroyer,
  type ChibiHomeZoneContract,
  type HomeViewContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- fixtures ----------------------------------------------------------------

class TestEnemy extends GameCoreEnemy {
  constructor(boss = false) {
    super();
    this.m_isBoss = boss;
    // Emulate the post-spawn state (spawn ctor ends with m_canAttack=false).
    this.m_canAttack = false;
  }
  setAttackDelay(v: number): void {
    this.m_attackDelay = f(v);
  }
  setAttackFreq(v: number): void {
    this.m_attackFreq = f(v);
  }
  get attackDelay(): number {
    return this.m_attackDelay;
  }
  get attacking(): boolean {
    return this.m_isAttacking;
  }
  get bossAttacking(): boolean {
    return this.m_bossAttacking;
  }
}

let core: GameCore;
const physicsFake: SimPhysics & { groundY: number | null } = {
  groundY: null,
  linecast: () =>
    physicsFake.groundY === null
      ? null
      : ({
          point: [0, physicsFake.groundY, 0],
          normal: [0, 1, 0],
          distance: 0.25,
          colliderName: 'terrain',
          layer: 29,
          layerName: 'Art_Terrain',
          isTrigger: false,
        } as RaycastHit),
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  physicsFake.groundY = null;
  setSimPhysics(physicsFake);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setDebugCanvasProvider(() => null);
  setHomeViewsFinder(null);
  setUnityObjectDestroyer(null);
  setChibiAvoidanceZoneNotifier(null);
  resetUnityObjectRegistryForTests();
});

function zone(overrides: Partial<ChibiHomeZoneContract> = {}): ChibiHomeZoneContract {
  return { numChibi: 3, angleCenter: 0, angleSpread: 0, minDist: 2, maxDist: 2, ...overrides };
}

function homeViewer(zones: ChibiHomeZoneContract[]): HomeViewContract {
  return {
    playerDetectionRange: 1.5,
    enemyDetectionRange: 2,
    kidPrefab: { tag: 'kid' },
    chibiHomeZones: zones,
    transform: { forward: { x: 0, y: 0, z: 1 }, position: { x: 40, y: 0, z: 40 } },
    gameObject: { tag: 'home' },
  };
}

/** NOTE: the ctor does NOT land position (bootstrap does afterwards), so
 *  chibis spawn relative to the origin — faithful. Tests move the home after
 *  construction where the Tick query matters. */
function makeHome(zones: ChibiHomeZoneContract[] = [zone()]): GameCoreHome {
  const h = new GameCoreHome(homeViewer(zones));
  h.position = new Vector3(40, 0, 40);
  return h;
}

function makeEnemy(pos: Vector3, boss = false): TestEnemy {
  const e = new TestEnemy(boss);
  e.position = pos;
  return e;
}

// ---- ctor + spawn ----------------------------------------------------------------

describe('GameCoreHome ctor + chibi spawn', () => {
  it('sums zone counts, lands the .rodata collision cylinder, and the PLAYER-range attack-distance quirk', () => {
    const h = makeHome([zone({ numChibi: 3 }), zone({ numChibi: 2 })]);
    expect(h.numStartingChibi).toBe(5);
    expect(h.numChibi).toBe(5);
    expect(h.collision.radius).toBeCloseTo(1.75, 6);
    expect(h.collision.height).toBeCloseTo(0.925, 6);
    // FAITHFUL QUIRK: playerDetectionRange (1.5) + 0.2, NOT enemy range (2)
    expect(h.enemyAttackDistance).toBeCloseTo(1.7, 6);
    expect(h.isEnemyClose).toBe(false);
  });

  it('fixed arc + fixed dist → exact polar placement (angle 0, forward +z, dist 2)', () => {
    const h = makeHome([zone({ numChibi: 1 })]);
    const c = h.getChibiDataByIndex(0);
    expect(c.id).toBe(0);
    expect(c.isDead).toBe(false);
    // ctor-time position is origin → offset (0,0,2)
    expect(c.pos.x).toBeCloseTo(0, 6);
    expect(c.pos.z).toBeCloseTo(2, 6);
  });

  it('samples the SYMMETRIC arc center ± spread/2 (disassembly @0x4bb4a2: RandomRange(-spread, +spread))', () => {
    // Single chibi per home → no spread relaxation drift; sample many seeds.
    let below = 0, above = 0;
    for (let seed = 1; seed <= 60; seed++) {
      unityRandom.InitState(seed);
      const h = makeHome([
        zone({ numChibi: 1, angleCenter: 30, angleSpread: 60, minDist: 1.5, maxDist: 2.5 }),
      ]);
      const c = h.getChibiDataByIndex(0);
      const angleDeg = (Math.atan2(c.pos.x, c.pos.z) * 180) / Math.PI;
      expect(angleDeg).toBeGreaterThanOrEqual(-0.001); // center − spread/2 = 0
      expect(angleDeg).toBeLessThanOrEqual(60.001); // center + spread/2 = 60
      if (angleDeg < 30) below++; else above++;
      const dist = c.pos.magnitude;
      expect(dist).toBeGreaterThanOrEqual(1.5 - 1e-5);
      expect(dist).toBeLessThanOrEqual(2.5 + 1e-5);
    }
    // Both halves populated — the old one-sided reading (max = -0.0) would
    // put every sample in [0, 30].
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
  });

  it('spawn RNG is deterministic for a fixed seed (draw order: angle, dist per chibi)', () => {
    const zones = [zone({ numChibi: 4, angleSpread: 40, minDist: 1.5, maxDist: 2.5 })];
    unityRandom.InitState(99);
    const h1 = makeHome(zones);
    unityRandom.InitState(99);
    const h2 = makeHome(zones);
    for (let i = 0; i < h1.numChibi; i++) {
      const a = h1.getChibiDataByIndex(i);
      const b = h2.getChibiDataByIndex(i);
      expect({ x: b.pos.x, y: b.pos.y, z: b.pos.z }).toEqual({ x: a.pos.x, y: a.pos.y, z: a.pos.z });
      expect(b.id).toBe(a.id);
    }
  });

  it('ground snap takes ONLY the linecast hit y (x/z untouched)', () => {
    physicsFake.groundY = -0.5;
    const h = makeHome([zone({ numChibi: 1 })]);
    const c = h.getChibiDataByIndex(0);
    expect(c.pos.y).toBe(-0.5);
    expect(c.pos.z).toBeCloseTo(2, 6);
  });
});

// ---- spread ------------------------------------------------------------------------

describe('SpreadOutChibi', () => {
  it('sorts ascending by distance to the attack position and relaxes overlaps to 0.4', () => {
    // Two zones, fixed dist 2.0 / 2.1 → spawn 0.1 apart (< 0.16 spacing).
    const h = makeHome([zone({ numChibi: 1, minDist: 2, maxDist: 2 }), zone({ numChibi: 1, minDist: 2.1, maxDist: 2.1 })]);
    expect(h.numChibi).toBe(2);
    // attackPos = origin + forward×2 = (0,0,2): id0 (z2) d=0, id1 (z2.1) d=0.1
    expect(h.getChibiDataByIndex(0).id).toBe(0);
    expect(h.getChibiDataByIndex(1).id).toBe(1);
    // push = (0.4 − 0.1) × 0.5 = 0.15 each way → final separation 0.4
    expect(h.getChibiDataByIndex(0).pos.z).toBeCloseTo(1.85, 5);
    expect(h.getChibiDataByIndex(1).pos.z).toBeCloseTo(2.25, 5);
  });

  it('FAITHFUL degenerate case: perfect overlaps get zero push and never separate', () => {
    const h = makeHome([zone({ numChibi: 2 })]); // both at exactly (0,0,2)
    const a = h.getChibiDataByIndex(0);
    const b = h.getChibiDataByIndex(1);
    expect(a.pos.z).toBeCloseTo(b.pos.z, 6);
    expect(a.pos.x).toBeCloseTo(b.pos.x, 6);
  });
});

// ---- tick / attack loop ----------------------------------------------------------------

describe('GameCoreHome.Tick', () => {
  it('VERIFIED direction: enemy at/beyond reach → IsEnemyClose; strictly inside → attack', () => {
    const h = makeHome([zone({ numChibi: 2 })]);
    // NOTE: the height-0 query only returns objects strictly BELOW home y
    // (verified grid filter) — enemies approach at y = −0.3.
    // reach = enemyDetectionRange 2 + enemy collision radius 0.5 = 2.5
    const far = makeEnemy(new Vector3(40, -0.3, 45)); // dist ≥ 2.5, within query 6
    h.tick();
    expect(h.isEnemyClose).toBe(true);
    expect(h.numChibi).toBe(2); // no attack from outside the ring
    far.destroySelf();
    GameCoreHandle.invalidateAllCachedData();

    const near = makeEnemy(new Vector3(40, -0.3, 41.5)); // dist < 2.5 → attack
    h.tick();
    expect(h.numChibi).toBe(1); // one chibi killed via Attack → event → DealDamage
    expect(near.attacking).toBe(true);
  });

  it('the attack loop raises enemyAttackedHomeEvent + enemyAttackEvent and marks the victim dead', () => {
    const h = makeHome([zone({ numChibi: 1 })]);
    const attacked: unknown[][] = [];
    const attackEvents: unknown[][] = [];
    const cb1 = (...args: unknown[]) => attacked.push(args);
    const cb2 = (...args: unknown[]) => attackEvents.push(args);
    Events.enemyAttackedHomeEvent.addListener(cb1, EventTime.Immediate);
    Events.enemyAttackEvent.addListener(cb2, EventTime.Immediate);
    const victim = h.getChibiDataByIndex(0);
    const e = makeEnemy(new Vector3(40, -0.3, 41));
    h.tick();
    expect(attacked.length).toBe(1);
    expect(attacked[0][1]).toBe(h);
    expect(attacked[0][2]).toBe(victim);
    expect(attackEvents.length).toBe(1);
    expect(victim.isDead).toBe(true);
    expect(h.numChibi).toBe(0);
    Events.enemyAttackedHomeEvent.removeListener(cb1);
    Events.enemyAttackEvent.removeListener(cb2);
  });

  it('attackDelay > 0 gates CanAttack (no chibi loss); first access still announces the avoidance zone once', () => {
    const announcements: unknown[][] = [];
    setChibiAvoidanceZoneNotifier((pos, r, d) => announcements.push([pos, r, d]));
    const h = makeHome([zone({ numChibi: 2 })]);
    const e = makeEnemy(new Vector3(40, -0.3, 41));
    e.setAttackDelay(1);
    h.tick();
    expect(h.numChibi).toBe(2); // gated
    expect(announcements.length).toBe(1); // side effect fires regardless
    h.tick();
    expect(announcements.length).toBe(1); // latched — no repeat
  });

  it('empty home: non-boss stragglers are destroyed (viewer teardown hook); bosses survive', () => {
    const destroyed: unknown[] = [];
    setUnityObjectDestroyer((o) => destroyed.push(o));
    const h = makeHome([zone({ numChibi: 0 })]);
    const grunt = makeEnemy(new Vector3(40, -0.3, 41));
    // Spawned enemies carry viewers; RecreateViewer faithfully NREs without one.
    const gruntView = { gameObject: { tag: 'gruntView' } };
    registerUnityObject(grunt.handle.m_handle, gruntView);
    const boss = makeEnemy(new Vector3(40, -0.3, 41.2), true);
    h.tick();
    expect(grunt.isDestroyed()).toBe(true);
    expect(destroyed).toEqual([gruntView.gameObject]); // Object.Destroy(viewerGo)
    expect(boss.isDestroyed()).toBe(false);
  });

  it('boss Attack sets the attack frequency delay (second attack gated)', () => {
    const h = makeHome([zone({ numChibi: 3 })]);
    const boss = makeEnemy(new Vector3(40, 0, 41), true);
    boss.setAttackFreq(2);
    const chibi = h.getChibiDataByIndex(0);
    expect(boss.attack(h, chibi)).toBe(true);
    expect(boss.attackDelay).toBe(2);
    expect(boss.bossAttacking).toBe(true);
    expect(boss.attack(h, h.getChibiDataByIndex(0))).toBe(false); // delay > 0
  });
});

// ---- DealDamage -------------------------------------------------------------------------

describe('GameCoreHome.DealDamage', () => {
  it('shifts formation poses forward and removes the victim', () => {
    const h = makeHome([zone({ numChibi: 3 })]);
    // distinct poses (spawn degenerate-overlap positions are replaced here)
    h.getChibiDataByIndex(0).pos = new Vector3(0, 0, 10);
    h.getChibiDataByIndex(1).pos = new Vector3(0, 0, 11);
    h.getChibiDataByIndex(2).pos = new Vector3(0, 0, 12);
    const victim = h.getChibiDataById(0)!;
    h.dealDamage(victim);
    expect(h.numChibi).toBe(2);
    expect(h.getChibiDataByIndex(0).id).toBe(1);
    expect(h.getChibiDataByIndex(0).pos.z).toBe(10); // inherited slot
    expect(h.getChibiDataByIndex(1).id).toBe(2);
    expect(h.getChibiDataByIndex(1).pos.z).toBe(11);
    expect(victim.isDead).toBe(true);
  });

  it('emptying the pool raises gameOverEvent; debug disableGameOver suppresses it', () => {
    const overs: number[] = [];
    const cb = () => overs.push(1);
    Events.gameOverEvent.addListener(cb, EventTime.Immediate);

    setDebugCanvasProvider(() => ({ disableGameOver: true, towerEXPRate: 1, damageRate: 1 }));
    const h1 = makeHome([zone({ numChibi: 1 })]);
    h1.dealDamage(h1.getChibiDataByIndex(0));
    expect(h1.numChibi).toBe(0);
    expect(overs.length).toBe(0); // suppressed

    setDebugCanvasProvider(() => null);
    const h2 = makeHome([zone({ numChibi: 1 })]);
    h2.dealDamage(h2.getChibiDataByIndex(0));
    expect(overs.length).toBe(1); // fired
    Events.gameOverEvent.removeListener(cb);
  });

  it('null chibi is a no-op; unknown ids throw (faithful unguarded indexer)', () => {
    const h = makeHome([zone({ numChibi: 2 })]);
    h.dealDamage(null);
    expect(h.numChibi).toBe(2);
    const stranger = new ChibiData(99, Vector3.zero, h.getChibiDataByIndex(0).rot);
    expect(() => h.dealDamage(stranger)).toThrow();
  });

  it('getChibiDataById finds / returns null', () => {
    const h = makeHome([zone({ numChibi: 2 })]);
    expect(h.getChibiDataById(1)).toBe(h.getChibiDataByIndex(1));
    expect(h.getChibiDataById(99)).toBeNull();
  });
});

// ---- wave recording + teardown -------------------------------------------------------------

describe('wave-end recording + DestroySelf', () => {
  it('waveEndedEvent records the surviving count per wave (Immediate)', () => {
    const h = makeHome([zone({ numChibi: 3 })]);
    const wm = new GameCoreWaveManager();
    Events.waveEndedEvent.invoke(wm, 0);
    expect(h.numChibiAtEndOfWave(0)).toBe(3);
    h.dealDamage(h.getChibiDataByIndex(0));
    Events.waveEndedEvent.invoke(wm, 1);
    expect(h.numChibiAtEndOfWave(1)).toBe(2);
    expect(h.numChibiAtEndOfWave(2)).toBe(0); // not recorded
    expect(h.numChibiAtEndOfWave(-1)).toBe(0); // negative guard
  });

  it('DestroySelf is guarded by a live GameCore and detaches both listeners', () => {
    const h = makeHome([zone({ numChibi: 2 })]);
    setInstanceProvider(null);
    h.destroySelf();
    expect(h.isDestroyed()).toBe(false); // guard: no core → no-op (faithful)
    setInstanceProvider(() => core);
    h.destroySelf();
    expect(h.isDestroyed()).toBe(true);
    const chibi = h.getChibiDataByIndex(0);
    Events.enemyAttackedHomeEvent.invoke(makeEnemy(new Vector3(40, 0, 41)), h, chibi);
    expect(h.numChibi).toBe(2); // listener removed
  });

  it('RecreateViewer prefers the registered view, falls back to FindObjectsOfType, else null', () => {
    const h = makeHome([zone({ numChibi: 1 })]);
    expect(h.recreateViewer()).toBeNull(); // nothing registered / found
    const view = homeViewer([zone()]);
    setHomeViewsFinder(() => [view]);
    expect(h.recreateViewer()).toBe(view.gameObject);
    expect(view.transform.position).toBe(h.position); // snapped
    registerUnityObject(h.handle.m_handle, view);
    expect(h.recreateViewer()).toBe(view.gameObject); // registered path
  });
});
