// tests/core/ai-helper.test.ts
// Semantics tests for AIHelper: blocking/avoidance categorisation (same-group
// spawn-order rule, same-path slower-unblocked rule, diff-path crossing rule,
// balloon layer filter), FindClosestObject, DetectGroundOrientation (hit /
// no-hit degenerate fallback / slope projection), and the
// TerrainOrientationInterpolator 15-tick sampling + blend cadence.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { AIDebugHelper } from '../../src/core/AIDebugHelper';
import {
  AIHelper,
  BlockingInfo,
  TerrainOrientationInterpolator,
} from '../../src/core/AIHelper';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { Cylinder } from '../../src/core/Cylinder';
import { resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver } from '../../src/core/GameCoreHandle';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import type { CatmullCurveContract } from '../../src/view/q4-contracts';

const f = Math.fround;
const P = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---- fixtures ----------------------------------------------------------------

class AIEnemy extends GameCoreEnemy {
  configure(opts: {
    pos?: Vector3;
    moveVec?: Vector3;
    speedCur?: number;
    radius?: number;
    waveIndex?: number;
    waveSubIndex?: number;
    spawnIndex?: number;
    balloon?: boolean;
    pathMove?: CorePathMove | null;
    blocked?: boolean;
    distance?: number;
  }): void {
    if (opts.pos !== undefined) this.position = opts.pos;
    if (opts.moveVec !== undefined) this.m_moveVector = opts.moveVec;
    if (opts.speedCur !== undefined) this.m_speedCur = f(opts.speedCur);
    if (opts.radius !== undefined) this.collision = new Cylinder(opts.radius, 1);
    if (opts.waveIndex !== undefined) this.m_waveIndex = opts.waveIndex;
    if (opts.waveSubIndex !== undefined) this.m_waveSubIndex = opts.waveSubIndex;
    if (opts.spawnIndex !== undefined) this.m_waveSpawnIndex = opts.spawnIndex;
    if (opts.balloon !== undefined) this.m_isBalloon = opts.balloon;
    if (opts.pathMove !== undefined) this.pathMove = opts.pathMove;
    if (opts.distance !== undefined) this.m_distance = f(opts.distance);
    if (opts.blocked !== undefined) {
      this.m_enemyBlockingMe = opts.blocked
        ? GameCoreHandle.createHandle(9999)
        : GameCoreHandle.nullHandle;
    }
  }
}

class FakeCurve implements CatmullCurveContract {
  id = 7;
  curveLength = 10;
  curveLengthB4Activation = 2;
  sampleLinearDistance(distance: number) {
    return { x: distance, y: 0, z: 0 };
  }
  distanceToTime(distance: number, _lastTime: number): number {
    return distance / 10;
  }
  sampleDirect(time: number, sideOffset: number) {
    return { x: time * 10, y: sideOffset, z: 0 };
  }
  sampleVelDirect(_time: number) {
    return { x: 0, y: 0, z: 1 };
  }
  nodeTimeToDistance(time: number): number {
    return time * 10;
  }
}

function curve(id: number): CorePathMove {
  const c = new FakeCurve();
  c.id = id;
  return new CorePathMove(c);
}

function makeHit(y: number, normal: [number, number, number]): RaycastHit {
  return {
    point: [40, y, 40],
    normal,
    distance: 1,
    colliderName: 'terrain_001',
    layer: 29,
    layerName: 'Art_Terrain',
    isTrigger: false,
  };
}

let core: GameCore;
const physicsFake: SimPhysics & { nextHit: RaycastHit | null; calls: number } = {
  nextHit: null,
  calls: 0,
  linecast: () => {
    physicsFake.calls++;
    return physicsFake.nextHit;
  },
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  physicsFake.nextHit = null;
  physicsFake.calls = 0;
  setSimPhysics(physicsFake);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
});

function makeMe(): AIEnemy {
  const me = new AIEnemy();
  me.configure({
    pos: P(40, 0, 40),
    moveVec: P(0, 0, 1),
    speedCur: 2,
    radius: 0.5,
    waveIndex: 1,
    waveSubIndex: 0,
    spawnIndex: 5,
    pathMove: curve(7),
  });
  return me;
}

// ---- GetBlockingEnemy -----------------------------------------------------------

describe('AIHelper.getBlockingEnemy', () => {
  it('nearest enemy AHEAD wins; mirrored into all three categories', () => {
    const me = makeMe();
    const ahead = new AIEnemy();
    ahead.configure({ pos: P(40, 0, 42), radius: 0.5, speedCur: 1.5 });
    const behind = new AIEnemy();
    behind.configure({ pos: P(40, 0, 38), radius: 0.5, speedCur: 1 });
    const farAhead = new AIEnemy();
    farAhead.configure({ pos: P(40, 0, 44), radius: 0.5, speedCur: 1 });

    const info = AIHelper.getBlockingEnemy(me, 5, 2);
    for (const [h, d, s] of [
      [info.enemySameGroup, info.distanceSameGroup, info.speedSameGroup],
      [info.enemySamePath, info.distanceSamePath, info.speedSamePath],
      [info.enemyDiffPath, info.distanceDiffPath, info.speedDiffPath],
    ] as Array<[GameCoreHandle, number, number]>) {
      expect(h.equals(ahead.handle)).toBe(true);
      expect(d).toBeCloseTo(1.5, 6); // dist 2 − radius 0.5
      expect(s).toBe(1.5);
    }
    expect(behind.isDestroyed()).toBe(false); // untouched, just filtered
  });

  it('null me → null handles, +Infinity distances, caller speed', () => {
    const info = AIHelper.getBlockingEnemy(null, 5, 2);
    expect(info.enemySameGroup.isNull).toBe(true);
    expect(info.distanceSameGroup).toBe(Infinity);
    expect(info.speedSameGroup).toBe(2);
  });
});

// ---- GetAvoidanceEnemy ------------------------------------------------------------

describe('AIHelper.getAvoidanceEnemy', () => {
  it('same wave group: only EARLIER-spawned enemies ahead are yielded to', () => {
    const me = makeMe(); // group 10000, spawnIndex 5
    const earlier = new AIEnemy();
    earlier.configure({ pos: P(40, 0, 42), radius: 0.5, speedCur: 1.2, waveIndex: 1, waveSubIndex: 0, spawnIndex: 3 });
    const later = new AIEnemy();
    later.configure({ pos: P(40, 0, 41.5), radius: 0.5, speedCur: 1, waveIndex: 1, waveSubIndex: 0, spawnIndex: 7 });

    const info = AIHelper.getAvoidanceEnemy(me, 5, 2);
    expect(info.enemySameGroup.equals(earlier.handle)).toBe(true);
    expect(info.distanceSameGroup).toBeCloseTo(2, 6); // dotForward, no radius subtract
    expect(info.speedSameGroup).toBeCloseTo(1.2, 6); // f32(1.2)
    expect(info.enemySamePath.isNull).toBe(true);
    expect(info.enemyDiffPath.isNull).toBe(true);
  });

  it('same path (different group): slower + unblocked + ahead; blocked/faster ignored', () => {
    const me = makeMe();
    const slower = new AIEnemy();
    slower.configure({ pos: P(40, 0, 43), radius: 0.5, speedCur: 1.0, waveIndex: 2, pathMove: curve(7) });
    const blocked = new AIEnemy();
    blocked.configure({ pos: P(40, 0, 42.5), radius: 0.5, speedCur: 0.5, waveIndex: 2, pathMove: curve(7), blocked: true });
    const faster = new AIEnemy();
    faster.configure({ pos: P(40, 0, 42.2), radius: 0.5, speedCur: 1.95, waveIndex: 2, pathMove: curve(7) });

    const info = AIHelper.getAvoidanceEnemy(me, 5, 2);
    expect(info.enemySamePath.equals(slower.handle)).toBe(true);
    expect(info.distanceSamePath).toBeCloseTo(2.5, 6); // 3 − 0.5
    expect(info.speedSamePath).toBe(1.0);
  });

  it('different path: crossing (non-parallel), laterally close, ahead → speed 0', () => {
    const me = makeMe();
    const crosser = new AIEnemy();
    crosser.configure({
      pos: P(40.5, 0, 42), radius: 0.5, speedCur: 2, waveIndex: 2,
      pathMove: curve(8), moveVec: P(1, 0, 0),
    });
    const parallel = new AIEnemy();
    parallel.configure({
      pos: P(40.4, 0, 41.8), radius: 0.5, speedCur: 2, waveIndex: 2,
      pathMove: curve(8), moveVec: P(0, 0, 1),
    });

    const info = AIHelper.getAvoidanceEnemy(me, 5, 2);
    expect(info.enemyDiffPath.equals(crosser.handle)).toBe(true);
    expect(info.distanceDiffPath).toBeCloseTo(1.5, 6); // 2 − 0.5
    expect(info.speedDiffPath).toBe(0);
    expect(parallel.isDestroyed()).toBe(false);
  });

  it('balloon layer filter: air enemies are never avoided by ground enemies', () => {
    const me = makeMe(); // ground
    const balloon = new AIEnemy();
    balloon.configure({
      pos: P(40, 0, 42), radius: 0.5, speedCur: 1, waveIndex: 1, spawnIndex: 1, balloon: true,
    });
    const info = AIHelper.getAvoidanceEnemy(me, 5, 2);
    expect(info.enemySameGroup.isNull).toBe(true);
  });
});

// ---- FindClosestObject ---------------------------------------------------------------

describe('AIHelper.findClosestObject', () => {
  it('returns the nearest by sqrMagnitude within the cylinder; null when empty', () => {
    const near = new AIEnemy();
    near.configure({ pos: P(41, 0, 40) });
    const far = new AIEnemy();
    far.configure({ pos: P(43, 0, 40) });
    const found = AIHelper.findClosestObject<AIEnemy>(AIEnemy, P(40, 0, 40), 5, 2);
    expect(found).toBe(near);
    expect(AIHelper.findClosestObject<AIEnemy>(AIEnemy, P(60, 0, 60), 1, 2)).toBeNull();
  });
});

// ---- DetectGroundOrientation -------------------------------------------------------------

describe('AIHelper.detectGroundOrientation', () => {
  it('no hit → degenerate fallback: up normal, query height, vertical-only forward scale, slope 0', () => {
    physicsFake.nextHit = null;
    const t = AIHelper.detectGroundOrientation(P(40, 2, 40), P(1, 0, 1));
    expect(t.normal.y).toBe(1);
    expect(t.terrainHeight).toBe(2);
    // FAITHFUL QUIRK: Scale(forward, (0,1,0)) zeroes x/z → normalize(zero) = zero
    expect(t.forward.magnitude).toBe(0);
    expect(t.facingSlopeAngle).toBe(0);
  });

  it('flat hit: forward unchanged, height from hit point, slope 0', () => {
    physicsFake.nextHit = makeHit(0, [0, 1, 0]);
    const t = AIHelper.detectGroundOrientation(P(40, 2, 40), P(0, 0, 1));
    expect(t.forward.z).toBeCloseTo(1, 5);
    expect(t.forward.y).toBeCloseTo(0, 5);
    expect(t.terrainHeight).toBe(0);
    expect(t.facingSlopeAngle).toBeCloseTo(0, 4);
  });

  it('45° slope: forward projected onto the plane, slope angle −45°', () => {
    const n = f(Math.SQRT1_2);
    physicsFake.nextHit = makeHit(0.5, [0, n, n]);
    const t = AIHelper.detectGroundOrientation(P(40, 2, 40), P(0, 0, 1));
    // projection of (0,0,1) onto plane with normal (0,√½,√½) → (0,−0.5,0.5)
    expect(t.forward.y).toBeCloseTo(-0.5, 4);
    expect(t.forward.z).toBeCloseTo(0.5, 4);
    expect(t.terrainHeight).toBe(0.5);
    expect(t.facingSlopeAngle).toBeCloseTo(-45, 2);
  });
});

// ---- TerrainOrientationInterpolator ----------------------------------------------------------

describe('TerrainOrientationInterpolator', () => {
  function makeWalker(): AIEnemy {
    const e = new AIEnemy();
    e.configure({ pos: P(40, 0, 40), moveVec: P(0, 0, 1), pathMove: curve(7), speedCur: 0, distance: 0 });
    return e;
  }

  it('samples in ctor, resamples on tick 1 then every 15 ticks, blending between samples', () => {
    physicsFake.nextHit = makeHit(0, [0, 1, 0]);
    const e = makeWalker();
    const interp = new TerrainOrientationInterpolator(e);
    expect(physicsFake.calls).toBe(1); // ctor sample
    expect(interp.interpolatedSample.terrainHeight).toBe(0);

    physicsFake.nextHit = makeHit(10, [0, 1, 0]);
    interp.tick(); // counter 0 → −1 < 1 → +15 = 14; resample
    expect(physicsFake.calls).toBe(2);
    // t = 1 − 14/15 → height = 10/15
    expect(interp.interpolatedSample.terrainHeight).toBeCloseTo(10 / 15, 5);

    for (let i = 0; i < 13; i++) interp.tick(); // ticks 2..14 → counter 13..1
    expect(physicsFake.calls).toBe(2); // no resample inside the interval
    expect(interp.interpolatedSample.terrainHeight).toBeCloseTo(10 * (14 / 15), 5);

    interp.tick(); // tick 15: counter 0 < 1 → +15 = 15; resample; t = 0
    expect(physicsFake.calls).toBe(3);
    expect(interp.interpolatedSample.terrainHeight).toBeCloseTo(10, 5);
  });

  it('destroyed enemy: sampling stops, interpolation stays stable (no throw)', () => {
    physicsFake.nextHit = makeHit(3, [0, 1, 0]);
    const e = makeWalker();
    const interp = new TerrainOrientationInterpolator(e);
    e.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    const callsBefore = physicsFake.calls;
    for (let i = 0; i < 20; i++) interp.tick();
    expect(physicsFake.calls).toBe(callsBefore); // no further samples
    expect(interp.interpolatedSample.terrainHeight).toBeCloseTo(3, 5);
  });
});

// ---- misc ------------------------------------------------------------------------------------

describe('BlockingInfo / AIDebugHelper', () => {
  it('BlockingInfo stores null handles for missing enemies', () => {
    const bi = new BlockingInfo(null, Infinity, 2, null, Infinity, 2, null, Infinity, 2);
    expect(bi.enemySameGroup.isNull).toBe(true);
    expect(bi.enemySamePath.isNull).toBe(true);
    expect(bi.enemyDiffPath.isNull).toBe(true);
    expect(bi.distanceSameGroup).toBe(Infinity);
  });

  it('AIDebugHelper gizmos are compiled-out no-ops (both overloads)', () => {
    const e = new AIEnemy();
    expect(() => AIDebugHelper.drawCollisionGizmo(e)).not.toThrow();
    expect(() => AIDebugHelper.drawCollisionGizmo(P(0, 0, 0), 1, 2, null)).not.toThrow();
  });
});
