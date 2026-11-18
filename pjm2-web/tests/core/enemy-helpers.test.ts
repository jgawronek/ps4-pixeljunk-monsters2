// tests/core/enemy-helpers.test.ts
// Semantics tests for the enemy helper modules: CorePathMove (curve sampling,
// incremental DistanceToTime cache, boundaries), EnemyDetectorSphere (incl.
// the FAITHFUL InAttack position-overload quirk), EnemyDetectorCone (downward
// frustum math), and GameCoreEnemyAttackPoint (damage forwarding with this-tag,
// aimability rules: balloon/afterAirPoints shielding, validate/predict).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { EEnemyMoveTypeDef } from '../../src/core/enums';
import { resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from '../../src/core/GameCoreEnemyAttackPoint';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { EnemyDetectorCone } from '../../src/core/EnemyDetectorCone';
import { EnemyDetectorSphere } from '../../src/core/EnemyDetectorSphere';
import {
  getRegisteredUnityObject,
  resetUnityObjectRegistryForTests,
  type CatmullCurveContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;

// ---- fixtures ----------------------------------------------------------------

class FakeCurve implements CatmullCurveContract {
  id = 7;
  curveLength = 10;
  curveLengthB4Activation = 2;
  lastTimeArg: number | null = null;
  sampleLinearDistance(distance: number) {
    return { x: distance, y: 0, z: 0 };
  }
  distanceToTime(distance: number, lastTime: number): number {
    this.lastTimeArg = lastTime;
    return distance / 10;
  }
  sampleDirect(time: number, sideOffset: number) {
    return { x: time * 10, y: sideOffset, z: 0 };
  }
  sampleVelDirect(_time: number) {
    return { x: 1, y: 0, z: 0 };
  }
  nodeTimeToDistance(time: number): number {
    return time * 10;
  }
}

class PathEnemy extends GameCoreEnemy {
  hits: Array<{ kind: 'typed' | 'untyped'; attackPoint: GameCoreObject | null; args: unknown[] }> = [];
  setPathState(opts: {
    pathMove?: CorePathMove | null;
    distance?: number;
    speedCur?: number;
    sideOffset?: number;
    moveVec?: Vector3;
    balloon?: boolean;
  }): void {
    if (opts.pathMove !== undefined) this.pathMove = opts.pathMove;
    if (opts.distance !== undefined) this.m_distance = f(opts.distance);
    if (opts.speedCur !== undefined) this.m_speedCur = f(opts.speedCur);
    if (opts.sideOffset !== undefined) this.m_sideOffset = f(opts.sideOffset);
    if (opts.moveVec !== undefined) this.m_moveVector = opts.moveVec;
    if (opts.balloon !== undefined) this.m_isBalloon = opts.balloon;
  }
  addAttackPoint(h: GameCoreHandle): void {
    if (this.m_attackPoints === null) this.m_attackPoints = [];
    this.m_attackPoints.push(h);
  }
  override dealDamage(
    source: GameCoreObject | null,
    damage: number,
    dist: number,
    attackPoint: GameCoreObject | null,
    immediate = true,
  ): void {
    this.hits.push({ kind: 'untyped', attackPoint, args: [source, damage, dist, immediate] });
  }
  override dealDamageTyped(
    strength: unknown,
    cls: unknown,
    damage: number,
    dist: number,
    source: GameCoreObject | null,
    attackPoint: GameCoreObject | null,
    immediate = true,
  ): void {
    this.hits.push({ kind: 'typed', attackPoint, args: [strength, cls, damage, dist, source, immediate] });
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
  resetUnityObjectRegistryForTests();
});

function makeEnemy(): PathEnemy {
  const e = new PathEnemy();
  e.position = new Vector3(40, 0, 40);
  return e;
}

// ---- CorePathMove ----------------------------------------------------------------

describe('CorePathMove', () => {
  it('exposes curve lengths and compares curves by id', () => {
    const c1 = new FakeCurve();
    const c2 = new FakeCurve();
    const p1 = new CorePathMove(c1);
    const p2 = new CorePathMove(c2);
    expect(p1.pathLength).toBe(10);
    expect(p1.curveLengthBeforeActivation).toBe(2);
    expect(p1.isSameCurve(p2)).toBe(true);
    c2.id = 8;
    expect(p1.isSameCurve(p2)).toBe(false);
  });

  it('sample: linear-distance position; ok=false + zero at/after curve end', () => {
    const p = new CorePathMove(new FakeCurve());
    const s = p.sample(5);
    expect(s.ok).toBe(true);
    expect(s.pos.x).toBe(5);
    expect(p.sample(10).ok).toBe(false); // boundary: curveLength <= distance
    expect(p.sample(10).pos.x).toBe(0);
    expect(p.sample(11).ok).toBe(false);
  });

  it('sampleWithVel caches lastCurveTime for incremental searches', () => {
    const curve = new FakeCurve();
    const p = new CorePathMove(curve);
    const s1 = p.sampleWithVel(5, 0.3);
    expect(curve.lastTimeArg).toBe(-1); // first search is fresh
    expect(s1.ok).toBe(true);
    expect(s1.pos.x).toBeCloseTo(5, 6);
    expect(s1.pos.y).toBeCloseTo(0.3, 6);
    expect(s1.vel.x).toBe(1);
    p.sampleWithVel(6, 0.3);
    expect(curve.lastTimeArg).toBeCloseTo(0.5, 6); // cached from previous sample
    // boundary miss does NOT touch the cache
    const before = curve.lastTimeArg;
    expect(p.sampleWithVel(10, 0).ok).toBe(false);
    expect(curve.lastTimeArg).toBe(before);
  });

  it('distanceToTime always searches fresh (-1); nodeTimeToDistance passes through', () => {
    const curve = new FakeCurve();
    const p = new CorePathMove(curve);
    p.sampleWithVel(5, 0); // cache 0.5
    p.distanceToTime(7);
    expect(curve.lastTimeArg).toBe(-1);
    expect(p.nodeTimeToDistance(0.5)).toBe(5);
  });
});

// ---- EnemyDetectorSphere ------------------------------------------------------------

describe('EnemyDetectorSphere', () => {
  const origin = new Vector3(40, 0, 40);

  it('radii, bounding cylinders (r, 2r), anchor 0.5, upgrade', () => {
    const s = new EnemyDetectorSphere(new Vector3(0, 1, 0), 2, 1.5);
    expect(s.radius).toBe(2);
    expect(s.affectRadius).toBe(3);
    const col = s.getCollisionCylinder();
    expect(col.radius).toBe(2);
    expect(col.height).toBe(4);
    const aff = s.getAffectCylinder();
    expect(aff.radius).toBe(3);
    expect(aff.height).toBe(6);
    expect(s.getAnchorV()).toBe(0.5);
    expect(s.getOffset().y).toBe(1);
    s.upgrade(2, 3);
    expect(s.radius).toBe(4);
    expect(s.affectRadius).toBe(6);
    expect(s.getRadiusScale()).toBe(2);
  });

  it('inDetection boundary is inclusive (<=)', () => {
    const s = new EnemyDetectorSphere(Vector3.zero, 2, 1.5);
    expect(s.inDetection(origin, new Vector3(42, 0, 40))).toBe(true); // dist == radius
    expect(s.inDetection(origin, new Vector3(42.1, 0, 40))).toBe(false);
    const obj = new GameCoreObject();
    obj.position = new Vector3(41.9, 0, 40);
    expect(s.inDetection(origin, obj)).toBe(true);
  });

  it('FAITHFUL QUIRK: inAttack object overload uses affect; POSITION overload uses detection scale', () => {
    const s = new EnemyDetectorSphere(Vector3.zero, 2, 1.5); // detection 2, affect 3
    const obj = new GameCoreObject();
    obj.position = new Vector3(42.5, 0, 40); // dist 2.5
    expect(s.inAttack(origin, obj)).toBe(true); // 2.5 <= 3
    expect(s.inAttack(origin, new Vector3(42.5, 0, 40))).toBe(false); // 2.5 <= 2 — quirk
  });

  it('intersectWithObject/Pos use the explicit radius argument', () => {
    const s = new EnemyDetectorSphere(Vector3.zero, 2, 1.5);
    expect(s.intersectWithPos(origin, new Vector3(41, 0, 40), 1)).toBe(true);
    expect(s.intersectWithPos(origin, new Vector3(41.5, 0, 40), 1)).toBe(false);
    const obj = new GameCoreObject();
    obj.position = new Vector3(41, 0, 40);
    expect(s.intersectWithObject(origin, obj, 1)).toBe(true);
  });
});

// ---- EnemyDetectorCone ----------------------------------------------------------------

describe('EnemyDetectorCone', () => {
  const top = new Vector3(40, 4, 40); // frustum hangs down to y=0

  it('radii getters, bounding cylinders, anchor 1.0', () => {
    const c = new EnemyDetectorCone(Vector3.zero, 2, 1, 4, 1.5);
    expect(c.upper).toBe(2);
    expect(c.lower).toBe(1);
    expect(c.affectUpper).toBe(3);
    expect(c.affectLower).toBe(1.5);
    expect(c.getCollisionCylinder().radius).toBe(2);
    expect(c.getCollisionCylinder().height).toBe(4);
    expect(c.getAffectCylinder().radius).toBe(3);
    expect(c.getAnchorV()).toBe(1);
    c.upgrade(2, 2);
    expect(c.upper).toBe(4);
    expect(c.affectUpper).toBe(4);
  });

  it('point frustum: vertical bounds + radius interpolation with depth', () => {
    const c = new EnemyDetectorCone(Vector3.zero, 2, 1, 4, 1.5);
    // mid-depth y=2 → radius 1.5
    expect(c.intersectWithPos(top, new Vector3(41.4, 2, 40), 2, 1, 4)).toBe(true);
    expect(c.intersectWithPos(top, new Vector3(41.6, 2, 40), 2, 1, 4)).toBe(false);
    // bottom y=0 → radius = lower = 1
    expect(c.intersectWithPos(top, new Vector3(40.9, 0, 40), 2, 1, 4)).toBe(true);
    expect(c.intersectWithPos(top, new Vector3(41.1, 0, 40), 2, 1, 4)).toBe(false);
    // above the anchor / below the bottom → out
    expect(c.intersectWithPos(top, new Vector3(40, 5, 40), 2, 1, 4)).toBe(false);
    expect(c.intersectWithPos(top, new Vector3(40, -1, 40), 2, 1, 4)).toBe(false);
    // beyond max radius early-out
    expect(c.intersectWithPos(top, new Vector3(43, 2, 40), 2, 1, 4)).toBe(false);
  });

  it('object frustum subtracts the target collision radius and spans its height', () => {
    const c = new EnemyDetectorCone(Vector3.zero, 2, 1, 4, 1.5);
    const e = makeEnemy(); // collision (0.5, 0.5)
    e.position = new Vector3(41.2, 2, 40); // dist 1.2 − 0.5 = 0.7 ≤ cone radius
    expect(c.intersectWithObject(top, e, 2, 1, 4)).toBe(true);
    e.position = new Vector3(42.8, 2, 40); // 2.8 − 0.5 = 2.3 > max 2 → early-out
    expect(c.intersectWithObject(top, e, 2, 1, 4)).toBe(false);
  });

  it('inDetection vs inAttack use detection/affect radii respectively', () => {
    const c = new EnemyDetectorCone(Vector3.zero, 2, 1, 4, 1.5);
    const p = new Vector3(42.5, 4, 40); // at the top: detection r2, affect r3
    expect(c.inDetection(top, p)).toBe(false);
    expect(c.inAttack(top, p)).toBe(true);
  });
});

// ---- GameCoreEnemyAttackPoint -------------------------------------------------------------

describe('GameCoreEnemyAttackPoint', () => {
  const localPos = new Vector3(0, 1, 0);

  function makePoint(
    host: PathEnemy | null,
    setting: { moveTypeOverride: EEnemyMoveTypeDef; afterAirPoints: boolean } | null = null,
    view: unknown | null = null,
  ): GameCoreEnemyAttackPoint {
    return new GameCoreEnemyAttackPoint(host, 0.3, view, localPos, setting);
  }

  it('ctor: host handle, cylinder (r, 2r), localPosition, moveType inherit/override, view registry', () => {
    const host = makeEnemy();
    host.enemyMoveType = EEnemyMoveTypeDef.air;
    const view = { tag: 'pointView' };
    const p = makePoint(host, null, view);
    expect(p.getHostEnemy()).toBe(host);
    expect(p.host()).toBe(host);
    expect(p.collision.radius).toBeCloseTo(0.3, 6);
    expect(p.collision.height).toBeCloseTo(0.6, 6);
    expect(p.localPosition).toBe(localPos);
    expect(p.moveType()).toBe(EEnemyMoveTypeDef.air); // inherited
    expect(p.unityObject()).toBe(view);
    expect(p.recreateViewer()).toBe(view);
    const p2 = makePoint(host, { moveTypeOverride: EEnemyMoveTypeDef.ground, afterAirPoints: false });
    expect(p2.moveType()).toBe(EEnemyMoveTypeDef.ground); // overridden
    expect(p.valid()).toBe(true);
    p.setAttackPointEnabled(false);
    expect(p.valid()).toBe(false);
  });

  it('FAITHFUL: null host without a moveType override throws (NRE path)', () => {
    expect(() => makePoint(null, null)).toThrow();
    // with an override the null host is tolerated (handle stays null)
    const p = makePoint(null, { moveTypeOverride: EEnemyMoveTypeDef.ground, afterAirPoints: false });
    expect(p.valid()).toBe(false);
    expect(p.getHostEnemy()).toBeNull();
  });

  it('damage forwards to the host tagged with THIS point (both overloads)', () => {
    const host = makeEnemy();
    const p = makePoint(host);
    const source = new GameCoreObject();
    p.dealDamage(source, 5, 0.2, null, false);
    expect(host.hits.length).toBe(1);
    expect(host.hits[0].kind).toBe('untyped');
    expect(host.hits[0].attackPoint).toBe(p);
    expect(host.hits[0].args).toEqual([source, 5, 0.2, false]);
    p.dealDamageTyped(1, 2, 7, 0.1, source, null, true);
    expect(host.hits[1].kind).toBe('typed');
    expect(host.hits[1].attackPoint).toBe(p);
    // destroyed host → no forwarding, no throw
    host.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    p.dealDamage(source, 5, 0, null);
    p.dealDamageTyped(1, 2, 5, 0, source, null);
    expect(host.hits.length).toBe(2);
  });

  it('isAimableTarget: disabled → false; balloon hosts defer to tower.balloonAimable', () => {
    const host = makeEnemy();
    const p = makePoint(host);
    const tower = new GameCoreTower('test_tower', []);
    expect(p.isAimableTarget(tower)).toBe(true);
    p.setAttackPointEnabled(false);
    expect(p.isAimableTarget(tower)).toBe(false);
    p.setAttackPointEnabled(true);
    host.setPathState({ balloon: true });
    tower.balloonAimable = false;
    expect(p.isAimableTarget(tower)).toBe(false);
    tower.balloonAimable = true;
    expect(p.isAimableTarget(tower)).toBe(true);
  });

  it('afterAirPoints ground points are shielded while an air point is enabled', () => {
    const host = makeEnemy();
    const air = makePoint(host, { moveTypeOverride: EEnemyMoveTypeDef.air, afterAirPoints: false });
    const ground = makePoint(host, { moveTypeOverride: EEnemyMoveTypeDef.ground, afterAirPoints: true });
    host.addAttackPoint(air.handle);
    host.addAttackPoint(ground.handle);
    const tower = new GameCoreTower('test_tower', []);
    expect(ground.isAimableTarget(tower)).toBe(false); // shielded
    air.setAttackPointEnabled(false);
    expect(ground.isAimableTarget(tower)).toBe(true); // shield lifted
  });

  it('validateTarget: needs a pathMove and pathDistance past curveLengthB4Activation', () => {
    const host = makeEnemy();
    const p = makePoint(host);
    expect(p.validateTarget()).toBe(false); // no pathMove
    host.setPathState({ pathMove: new CorePathMove(new FakeCurve()), distance: 1 });
    expect(p.validateTarget()).toBe(false); // 2 < 1 false
    host.setPathState({ distance: 3 });
    expect(p.validateTarget()).toBe(true);
  });

  it('predictPositionAndDirection: host gone → localPosition/forward; else path sample rotated by velocity', () => {
    const host = makeEnemy();
    const p = makePoint(host);
    host.setPathState({
      pathMove: new CorePathMove(new FakeCurve()),
      distance: 1,
      speedCur: 2,
      sideOffset: 0.3,
    });
    // aTime 0.5 → distance 0.5×2+1 = 2 → t 0.2 → pos (2, 0.3, 0), vel (1,0,0)
    const r = p.predictPositionAndDirection(0.5);
    expect(r.pos.x).toBeCloseTo(2, 5);
    expect(r.pos.y).toBeCloseTo(1.3, 5); // + LookRotation(+x)·(0,1,0) = (0,1,0)
    expect(r.direction.x).toBe(1);
    // sample miss (distance ≥ curveLength) → host position + moveVec
    host.setPathState({ distance: 15, moveVec: new Vector3(0, 0, 1) });
    const r2 = p.predictPositionAndDirection(0.5);
    expect(r2.pos.x).toBeCloseTo(40, 5);
    expect(r2.pos.y).toBeCloseTo(1, 5);
    expect(r2.direction.z).toBe(1);
    // host destroyed → localPosition + forward
    host.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    const r3 = p.predictPositionAndDirection(0.5);
    expect(r3.pos).toBe(localPos);
    expect(r3.direction.z).toBe(1);
    expect(r3.direction.x).toBe(0);
  });
});
