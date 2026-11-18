// tests/core/enemy-tick.test.ts
// Semantics tests for GameCoreEnemy chunk 2: Tick dispatch (hold vs walk),
// StateWalk advance + path-end destroy, same-group blocking stop, balloon
// damage/pop math (life untouched while balloons remain; oneShotOneBalloon),
// body damage + hit/destroyed events + immediateDestroy semantics, boss
// vulnerable accumulation + boss-death cascade, drown detection, death-path
// landing, player-kick damage, debug damageRate, jumping-boss rest/jump cycle.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EBossType, EEnemyMoveTypeDef, EPathSegType, ESpawnMode } from '../../src/core/enums';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from '../../src/core/GameCoreEnemyAttackPoint';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreProjectile } from '../../src/core/GameCoreProjectile';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  setDebugCanvasProvider,
  setEnemyViewerFactory,
  type BalloonContract,
  type CatmullCurveContract,
  type EnemyBaseContract,
  type EnemyViewerContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- fixtures ----------------------------------------------------------------

/** Straight line along +X, tangent +X (consistent position/velocity axes). */
class LineCurve implements CatmullCurveContract {
  id = 1;
  curveLength = 10;
  curveLengthB4Activation = 2;
  sampleLinearDistance(distance: number) {
    return { x: distance, y: 0, z: 0 };
  }
  distanceToTime(distance: number, _lastTime: number): number {
    return distance / 10;
  }
  sampleDirect(time: number, sideOffset: number) {
    return { x: time * 10, y: 0, z: sideOffset };
  }
  sampleVelDirect(_time: number) {
    return { x: 1, y: 0, z: 0 };
  }
  nodeTimeToDistance(time: number): number {
    return time * 10;
  }
}

const MODEL_BOUNDS = {
  size: { x: 0.6, y: 1.0, z: 0.6 },
  extents: { x: 0.3, y: 0.5, z: 0.3 },
};

function enemyPrefab(overrides: Partial<EnemyBaseContract> = {}): EnemyBaseContract {
  return {
    name: 'kuri_00_001',
    speed: 2, fireSpeed: 3, balloonSpeed: 4,
    collisionScaleH: 1, collisionScaleV: 1,
    lowHPThreshold: 10, lowHPSpeed: 1.5, damagedHpThreshold: 20, maxLife: 100,
    spawnMode: ESpawnMode.Normal, enemyMoveType: EEnemyMoveTypeDef.ground,
    balloonAccScale: 1, balloonDamping: 1, balloonHeight: 2, balloonSpawnHeight: 3, balloonTargetHeight: 1.5,
    groundOffsetY: 0.5, drownDepth: 0.3,
    isBoss: false, isJumpingBoss: false, bossType: EBossType.None,
    bossRestDur: 1, bossJumpDur: 0.5, attackFreq: 4,
    bossAttackDur: 1, bossAttackDist: 1.5, bossAttackHeightForward: 1.5, bossAttackHeightBack: 0.5,
    bossSpawnWaitDur: 2,
    sounds: null, chibiAvoidRadius: 1.2, expValue: 10,
    ...overrides,
  };
}

function makeViewer(balloon: BalloonContract | null = null): EnemyViewerContract {
  return {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    gameObject: { tag: 'enemyView' },
    getComponentInChildrenBalloon: () => balloon,
    findTransformWithTag: () => ({
      gameObject: { getComponentInChildrenRenderer: () => ({ bounds: MODEL_BOUNDS }) },
    }),
    attackPoints: () => null,
    isSlopeMovement: false,
    slopeDownSpeedScale: 1, slopeDownAngle: 30,
    slopeUpSpeedScale: 1, slopeUpAngle: 30,
    // Unity GetComponent parity: no EnemyAttributesSettings component → null.
    getComponentEnemyAttributesSettings: () => null,
  };
}

let core: GameCore;
const physicsFake: SimPhysics & { water: boolean } = {
  water: false,
  linecast: (): RaycastHit | null => null,
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => physicsFake.water,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 40, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  physicsFake.water = false;
  setSimPhysics(physicsFake);
  setEnemyViewerFactory(() => makeViewer());
  unityRandom.InitState(7);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setEnemyViewerFactory(null);
  setDebugCanvasProvider(() => null);
  resetUnityObjectRegistryForTests();
});

function spawnEnemy(
  prefab: EnemyBaseContract = enemyPrefab(),
  pathStartTime = 0,
  segTypeInfos: number[] | null = null,
  waveSpawnIndex = 0,
): GameCoreEnemy {
  return new GameCoreEnemy(
    prefab, new LineCurve(), segTypeInfos, pathStartTime, 'path_001',
    1, 1, 20, 1, 0, 0, waveSpawnIndex, 1.5, 0, 0.2, 2, false, true,
  );
}

// ---- Tick / movement -----------------------------------------------------------

describe('GameCoreEnemy.Tick', () => {
  it('hold branch (canAttack latched): stays on the path sample, attackDelay counts down', () => {
    const e = spawnEnemy();
    expect(e.canAttack).toBe(false); // latches m_canAttack=true, delay 1 > 0
    e.tick();
    expect(e.pathDistance).toBe(0); // no advance while holding
    // terrain fallback height 0.5 (ctor sample at y0.5) + groundOffset 0.5
    expect(e.position.y).toBeCloseTo(1.0, 5);
    expect(e.canAttack).toBe(false); // delay 1 − 1/60 still > 0
  });

  it('walk branch: advances distance by speedCur×dt and follows the curve', () => {
    const e = spawnEnemy();
    e.tick();
    expect(e.pathDistance).toBeCloseTo(2 / 60, 5); // speedCur 2
    expect(e.position.x).toBeCloseTo(2 / 60, 5);
    expect(e.moveVec.x).toBeCloseTo(1, 5); // normalized tangent
    expect(e.isDestroyed()).toBe(false);
  });

  it('reaching the path end destroys the enemy', () => {
    const e = spawnEnemy(enemyPrefab(), 0.99); // distance 9.9
    e.tick();
    e.tick();
    expect(e.isDestroyed()).toBe(false);
    e.tick(); // distance ≥ 10 → Sample fails → DestroySelf
    expect(e.isDestroyed()).toBe(true);
  });

  it('same-group blocker ahead within combined radius → stop behind it', () => {
    const blocker = spawnEnemy(enemyPrefab(), 0.05, null, 3); // earlier spawn, distance 0.5
    const me = spawnEnemy(enemyPrefab(), 0, null, 5);
    me.tick();
    expect(me.isBlocked).toBe(true);
    expect(me.enemyBlockingMe.equals(blocker.handle)).toBe(true);
    expect(me.speedCur).toBeLessThan(2); // decelerating toward 0
  });

  it('jumping boss: rest phase freezes distance, then bossJumpEvent fires', () => {
    const jumps: number[] = [];
    const cb = (_e: GameCoreEnemy, dur: number) => jumps.push(dur);
    Events.bossJumpEvent.addListener(cb, EventTime.Immediate);
    const boss = spawnEnemy(enemyPrefab({ isBoss: true, isJumpingBoss: true, bossType: EBossType.Bero }));
    for (let i = 0; i < 61; i++) boss.tick(); // restDur 1s crosses zero at tick 61 (f32 drift)
    expect(boss.pathDistance).toBeCloseTo(0, 5); // frozen during rest (jump starts next tick)
    expect(jumps.length).toBe(1);
    expect(jumps[0]).toBeCloseTo(0.5, 6); // jumpDur
    for (let i = 0; i < 10; i++) boss.tick();
    expect(boss.pathDistance).toBeGreaterThan(0); // jumping advances
    Events.bossJumpEvent.removeListener(cb);
  });
});

// ---- damage ---------------------------------------------------------------------

describe('GameCoreEnemy damage', () => {
  it('body damage: life deduction, enemyHitEvent payload, death + immediateDestroy semantics', () => {
    const hits: unknown[] = [];
    const destroyed: unknown[][] = [];
    const cbH = (info: unknown) => hits.push(info);
    const cbD = (...args: unknown[]) => destroyed.push(args);
    Events.enemyHitEvent.addListener(cbH, EventTime.Immediate);
    Events.enemyDestroyedEvent.addListener(cbD, EventTime.Immediate);

    const e = spawnEnemy(); // life 90
    e.dealDamageTyped(1, 1, 30, 0.1, null, null, false);
    expect(e.getLife()).toBe(60);
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ damage: 30, distanceToCenterRate: f(0.1), toEnemy: e });

    e.dealDamageTyped(1, 1, 100, 0, null, null, false); // dealt clamped to 60
    expect(e.getLife()).toBe(0);
    expect(e.isDestroyed()).toBe(false); // immediateDestroy=false
    expect(destroyed.length).toBe(1);
    expect(destroyed[0][1]).toBe(e);
    e.checkIfDestroy();
    expect(e.isDestroyed()).toBe(true);
    Events.enemyHitEvent.removeListener(cbH);
    Events.enemyDestroyedEvent.removeListener(cbD);
  });

  it('debug damageRate multiplies incoming damage', () => {
    setDebugCanvasProvider(() => ({ disableGameOver: false, towerEXPRate: 1, damageRate: 2 }));
    const e = spawnEnemy();
    e.dealDamageTyped(1, 1, 10, 0, null, null, false);
    expect(e.getLife()).toBe(70); // 10 × 2
  });

  it('balloon damage: HP-interval pops, life untouched until balloons gone', () => {
    const balloon: BalloonContract = { balloonsRemaining: 3, hp: 30, gameObject: {} };
    setEnemyViewerFactory(() => makeViewer(balloon));
    const pops: number[] = [];
    const cb = (_e: GameCoreEnemy, n: number) => pops.push(n);
    Events.popBalloonsEvent.addListener(cb, EventTime.Immediate);

    const e = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Balloon }));
    e.dealDamageTyped(1, 1, 12, 0, null, null, false);
    expect(e.getLife()).toBe(90); // FAITHFUL: no life loss with balloons up
    expect(e.isBalloon).toBe(true);
    expect(pops).toEqual([1]); // ceil(30/10)=3 → ceil(18/10)=2

    e.dealDamageTyped(1, 1, 12, 0, null, null, false); // 18 → 6: pop 1
    expect(pops).toEqual([1, 1]);
    e.dealDamageTyped(1, 1, 12, 0, null, null, false); // 6 → −6: last pop
    expect(e.isBalloon).toBe(false);
    expect(e.enemyMoveType).toBe(EEnemyMoveTypeDef.ground);
    expect(pops).toEqual([1, 1, 1]);
    Events.popBalloonsEvent.removeListener(cb);
  });

  it('oneShotOneBalloon tower pops exactly one per hit', () => {
    const balloon: BalloonContract = { balloonsRemaining: 3, hp: 30, gameObject: {} };
    setEnemyViewerFactory(() => makeViewer(balloon));
    const tower = new GameCoreTower('test_tower', []);
    tower.oneShotOneBalloon = true;
    const proj = new (class extends GameCoreProjectile {})(tower, null);
    proj.sourceTower = tower.handle;
    const e = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Balloon }));
    e.dealDamage(proj, 5, 0, null, false); // untyped → resolves tower
    expect(e.isBalloon).toBe(true); // 3 → 2 balloons
    // verify via a second hit popping another (HP math bypassed)
    e.dealDamage(proj, 5, 0, null, false);
    expect(e.isBalloon).toBe(true); // 2 → 1
    e.dealDamage(proj, 5, 0, null, false);
    expect(e.isBalloon).toBe(false); // 1 → 0
  });

  it('boss vulnerable accumulation (Fat: any point) + boss death kills all others', () => {
    const e = spawnEnemy(enemyPrefab({ isBoss: true, bossType: EBossType.Fat }));
    const other = spawnEnemy();
    // give the boss an attack point via a viewer with a point list
    // (Fat accumulates on any GameCoreEnemyAttackPoint source)
    const ap = new GameCoreEnemyAttackPoint(e, 0.3, null, new Vector3(0, 1, 0), null);
    e.dealDamageTyped(1, 1, 10, 0, null, ap, false);
    expect(e.getVulnerableDamageTaken()).toBe(10);
    e.dealDamageTyped(1, 1, 1000, 0, null, null, true); // lethal
    expect(e.isDestroyed()).toBe(true);
    expect(other.isDestroyed()).toBe(true); // boss-death cascade
  });

  it('DealPlayerDamage: kick damage + lethal destroy', () => {
    const p = new GameCorePlayer();
    p.playerId = 1;
    p.position = new Vector3(40, 0, 40);
    const e = spawnEnemy();
    e.dealPlayerDamage(p, 30, 0, false);
    expect(e.getLife()).toBe(60);
    e.dealPlayerDamage(p, 100, 0, false);
    expect(e.isDestroyed()).toBe(true);
  });
});

// ---- drown / death path -------------------------------------------------------------

describe('drown + death-path landing', () => {
  it('popped balloon over water drowns (events + destroy)', () => {
    const balloon: BalloonContract = { balloonsRemaining: 1, hp: 10, gameObject: {} };
    setEnemyViewerFactory(() => makeViewer(balloon));
    const drowned: GameCoreEnemy[] = [];
    const cb = (e: GameCoreEnemy) => drowned.push(e);
    Events.enemyDrownEvent.addListener(cb, EventTime.Immediate);
    const e = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Balloon }));
    e.popBalloons(100000000); // all popped → falling ground enemy
    expect(e.isBalloon).toBe(false);
    physicsFake.water = true;
    e.tick();
    expect(drowned).toEqual([e]);
    expect(e.isDestroyed()).toBe(true);
    Events.enemyDrownEvent.removeListener(cb);
  });

  it('popped balloon landing on a Death segment dies via enemyDestroyedEvent', () => {
    const balloon: BalloonContract = { balloonsRemaining: 1, hp: 10, gameObject: {} };
    setEnemyViewerFactory(() => makeViewer(balloon));
    const destroyed: unknown[][] = [];
    const cb = (...args: unknown[]) => destroyed.push(args);
    Events.enemyDestroyedEvent.addListener(cb, EventTime.Immediate);
    const e = spawnEnemy(enemyPrefab({ spawnMode: ESpawnMode.Balloon }), 0, [EPathSegType.Death]);
    e.popBalloons(100000000);
    for (let i = 0; i < 60; i++) {
      if (e.isDestroyed()) break;
      e.tick(); // fall → land (offset ≤ terrain) → Death segment check
    }
    expect(e.isDestroyed()).toBe(true);
    expect(destroyed.length).toBe(1);
    expect(destroyed[0][1]).toBe(e);
    Events.enemyDestroyedEvent.removeListener(cb);
  });
});
