// tests/core/projectiles.test.ts
// Semantics tests for the projectile family: AttenuationCurve sampling
// (snap/lerp/fallback), Trajectory (flight + terrain detonation + direct &
// splash damage), Instant (no-target death, virtual bullet arrival), Gem
// (aura handoff), Beam (swept capsule, once-per-target), Electric (bolt-front
// nearest-first sweep), Lightning (host dedup, random delays, list-governed
// lifetime with base lifetime untouched).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { AttenuationCurve } from '../../src/core/AttenuationCurve';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { EEnemyMoveTypeDef, ETowerAttackDef } from '../../src/core/enums';
import { resetAllEventsForTests, Events } from '../../src/core/Events';
import { EventTime } from '../../src/core/event/CoreEvent';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreEnemyAttackPoint } from '../../src/core/GameCoreEnemyAttackPoint';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreProjectileBeam } from '../../src/core/GameCoreProjectileBeam';
import { GameCoreProjectileElectric } from '../../src/core/GameCoreProjectileElectric';
import { GameCoreProjectileGem } from '../../src/core/GameCoreProjectileGem';
import { GameCoreProjectileInstant } from '../../src/core/GameCoreProjectileInstant';
import { GameCoreProjectileLightning } from '../../src/core/GameCoreProjectileLightning';
import { GameCoreProjectileTrajectory } from '../../src/core/GameCoreProjectileTrajectory';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import type { IDamageable } from '../../src/core/interfaces';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import { TowerStateUpgradeAround } from '../../src/core/TowerStateUpgradeAround';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  type CatmullCurveContract,
  type ProjectileViewContract,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';

const f = Math.fround;
const P = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---- fixtures ----------------------------------------------------------------

class LineCurve implements CatmullCurveContract {
  id = 1;
  curveLength = 100;
  curveLengthB4Activation = 2;
  sampleLinearDistance(d: number) {
    return { x: d, y: 0, z: 0 };
  }
  distanceToTime(d: number, _l: number) {
    return d / 100;
  }
  sampleDirect(t: number, s: number) {
    return { x: t * 100, y: 0, z: s };
  }
  sampleVelDirect(_t: number) {
    return { x: 1, y: 0, z: 0 };
  }
  nodeTimeToDistance(t: number) {
    return t * 100;
  }
}

class HitEnemy extends GameCoreEnemy {
  hits: Array<{ damage: number; dist: number }> = [];
  setup(pos: Vector3): void {
    this.position = pos;
    this.pathMove = new CorePathMove(new LineCurve());
    this.m_distance = f(5);
    this.enemyMoveType = EEnemyMoveTypeDef.ground;
  }
  override dealDamage(_s: unknown, damage: number, dist: number, _ap: unknown, _imm = true): void {
    this.hits.push({ damage, dist });
  }
  override dealDamageTyped(_st: unknown, _c: unknown, damage: number, dist: number, _s: unknown, _ap: unknown, _imm = true): void {
    this.hits.push({ damage, dist });
  }
  attackPointsPush(h: GameCoreHandle): void {
    if (this.m_attackPoints === null) this.m_attackPoints = [];
    this.m_attackPoints.push(h);
  }
}

const BOUNDS = {
  size: { x: 0.6, y: 0.6, z: 0.6 },
  extents: { x: 0.3, y: 0.3, z: 0.3 },
};

function projView(overrides: Partial<ProjectileViewContract> = {}): ProjectileViewContract {
  return {
    getFireDirection: (_from, to, _e) => ({ x: to.x - _from.x, y: to.y - _from.y, z: to.z - _from.z }),
    getGameCoreType: () => GameCoreProjectileTrajectory,
    gameObject: { tag: 'projView' },
    maxLifeDuration: 10,
    getComponentInChildrenRenderer: () => ({ bounds: BOUNDS }),
    ...overrides,
  };
}

function towerView(projectile: ProjectileViewContract): TowerBaseContract {
  return {
    name: 'tower_001',
    gameObject: { tag: 'towerView' },
    transform: { position: { x: 40, y: 0, z: 40 } },
    nextTargetToAttackIndex: 0,
    attackType: ETowerAttackDef.all,
    strengthType: 1,
    classType: 1,
    balloonAimable: false,
    attackPower: 10,
    attackSpeed: 0.5,
    attackRangeInner: 0,
    attackSpread: 3,
    costCoin: 50,
    costGem: 0,
    buildTime: 2,
    buildRange: 2,
    refundCoin: 25,
    refundGem: 0,
    magazineCapacity: -1,
    rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180,
    oneShotOneBalloon: false,
    fullRangeFire: true,
    fireAngleThreshold: 360,
    attackAttenuations: [],
    burstCount: 1,
    burstInterval: 0,
    cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30, cautionRotateAngleMin: 10,
    playerDetectionRange: 2,
    firePointNames: null,
    projectile,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null,
    getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
  };
}

let core: GameCore;
const physicsFake: SimPhysics & { terrain: RaycastHit | null } = {
  terrain: null,
  linecast: () => physicsFake.terrain,
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 80, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  physicsFake.terrain = null;
  setSimPhysics(physicsFake);
  unityRandom.InitState(7);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  resetUnityObjectRegistryForTests();
});

function makeTower(view: TowerBaseContract): GameCoreTower {
  const tower = new GameCoreTower(view.name, []);
  tower.position = P(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, view);
  tower.initialize();
  return tower;
}

// ---- AttenuationCurve -----------------------------------------------------------

describe('AttenuationCurve', () => {
  it('null/empty → 1.0; snap → step; first segment lerps from 1.0', () => {
    expect(AttenuationCurve.sample(null, 0.5)).toBe(1);
    expect(AttenuationCurve.sample([], 0.5)).toBe(1);
    const snap = [{ rate: 0.5, attenuation: 0.5, snap: true }];
    expect(AttenuationCurve.sample(snap, 0.3)).toBe(0.5);
    expect(AttenuationCurve.sample(snap, 0.7)).toBe(0.5); // no match → index 0
    const lerp = [{ rate: 1, attenuation: 0.5, snap: false }];
    expect(AttenuationCurve.sample(lerp, 0.5)).toBeCloseTo(0.75, 6); // (0.5−1)×0.5+1
    expect(AttenuationCurve.sample(lerp, 0)).toBeCloseTo(1, 6);
  });

  it('later segments lerp between neighboring entries', () => {
    const curve = [
      { rate: 0.5, attenuation: 1, snap: false },
      { rate: 1, attenuation: 0.5, snap: false },
    ];
    expect(AttenuationCurve.sample(curve, 0.75)).toBeCloseTo(0.75, 6);
  });
});

// ---- Trajectory -------------------------------------------------------------------

describe('GameCoreProjectileTrajectory', () => {
  it('terrain linecast detonates: projectileHitEvent(null) + destroy', () => {
    const tower = makeTower(towerView(projView({ gravity: 0, traceTarget: false, getFireDirection: () => ({ x: 0, y: 0, z: 0 }) })));
    physicsFake.terrain = { point: [40, 3, 40], normal: [0, 1, 0], distance: 0, colliderName: 't', layer: 29, layerName: 'Art_Terrain', isTrigger: false };
    const hits: unknown[][] = [];
    const cb = (...args: unknown[]) => hits.push(args);
    Events.projectileHitEvent.addListener(cb, EventTime.Immediate);
    const proj = new GameCoreProjectileTrajectory(tower, [], true);
    proj.tick();
    expect(hits.length).toBe(1);
    expect(hits[0][1]).toBeNull();
    expect(proj.isDestroyed()).toBe(true);
    Events.projectileHitEvent.removeListener(cb);
  });

  it('enemy overlap: direct damage + splash to nearby enemies', () => {
    // enemy BEFORE tower so it is the first overlap in the grid cell
    const enemy = new HitEnemy();
    enemy.setup(P(40, 1.9, 40));
    const enemy2 = new HitEnemy();
    enemy2.setup(P(40, 1.9, 41));
    const tower = makeTower(towerView(projView({ gravity: 0, traceTarget: false, getFireDirection: () => ({ x: 0, y: 0, z: 0 }) })));
    const proj = new GameCoreProjectileTrajectory(tower, [enemy], true);
    proj.tick(); // stationary at muzzle (40,3,40); enemy inside collision
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0].damage).toBe(10); // power 10, no attenuation
    expect(enemy2.hits.length).toBe(1); // splash within spread 3
    expect(enemy2.hits[0].dist).toBeCloseTo(Math.sqrt(1.01) / 3, 5); // 3D dist incl. 0.1 y offset
    expect(proj.isDestroyed()).toBe(true);
  });
});

// ---- Instant ------------------------------------------------------------------------

describe('GameCoreProjectileInstant', () => {
  it('no current target → destroyed in ctor', () => {
    const tower = makeTower(towerView(projView({ bulletSpeed: 1000 })));
    const proj = new GameCoreProjectileInstant(tower, [], true);
    expect(proj.isDestroyed()).toBe(true);
  });

  it('virtual bullet arrives → direct damage + event + destroy', () => {
    const enemy = new HitEnemy();
    enemy.setup(P(40, 3, 41));
    const tower = makeTower(towerView(projView({ bulletSpeed: 1000 })));
    tower.setCurrentTarget(enemy);
    const proj = new GameCoreProjectileInstant(tower, [enemy], true);
    proj.tick(); // distance 1 < 1000×dt
    expect(enemy.hits.length).toBeGreaterThanOrEqual(1);
    expect(proj.isDestroyed()).toBe(true);
  });
});

// ---- Gem ------------------------------------------------------------------------------

describe('GameCoreProjectileGem', () => {
  it('hands the tower the UpgradeAround aura and destroys itself', () => {
    const tower = makeTower(
      towerView(projView({
        isGemProjectile: true,
        expBoostPerSecond: 5,
        destroyDropGem: 2,
        towerSinkTimePerFragment: 0.1,
        upgradeInterval: 1,
        gemDropDelay: 0.5,
        maxLifeDuration: 8,
      })),
    );
    const gem = new GameCoreProjectileGem(tower, [], true);
    gem.tick();
    expect(tower.getTowerState()).toBeInstanceOf(TowerStateUpgradeAround);
    expect(gem.isDestroyed()).toBe(true);
  });
});

// ---- Beam --------------------------------------------------------------------------------

describe('GameCoreProjectileBeam', () => {
  it('swept capsule zaps each target once', () => {
    const enemy = new HitEnemy();
    enemy.setup(P(40, 2, 40.5));
    const tower = makeTower(towerView(projView({ speed: 10, beamFlyLength: 100, radius: 0.5 })));
    tower.setCurrentTarget(enemy);
    const beam = new GameCoreProjectileBeam(tower, [enemy], true);
    beam.tick(); // head advances 0.1667 → enemy within segment+radius
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0].damage).toBe(10);
    beam.tick();
    expect(enemy.hits.length).toBe(1); // deduped
  });
});

// ---- Electric --------------------------------------------------------------------------------

describe('GameCoreProjectileElectric', () => {
  it('bolt front zaps nearest-first as it expands', () => {
    const near = new HitEnemy();
    near.setup(P(40, 3, 41)); // dist 1
    const far = new HitEnemy();
    far.setup(P(40, 3, 42)); // dist 2
    const tower = makeTower(towerView(projView({ bulletSpeed: 60 })));
    const elec = new GameCoreProjectileElectric(tower, [far, near], true);
    expect(elec.validTargetsCount()).toBe(2);
    elec.tick(); // front 1: 1 > 1 false → none
    expect(near.hits.length).toBe(0);
    elec.tick(); // front 2 > 1 → near zapped
    expect(near.hits.length).toBe(1);
    expect(elec.validTargetsCount()).toBe(1);
    elec.tick(); // front 3 > 2 → far zapped → list empty
    expect(far.hits.length).toBe(1);
    elec.tick(); // empty list → destroy (next tick, faithful)
    expect(elec.isDestroyed()).toBe(true);
  });
});

// ---- Lightning ----------------------------------------------------------------------------------

describe('GameCoreProjectileLightning', () => {
  it('host-deduped snapshot, random delays, list-governed lifetime', () => {
    const e1 = new HitEnemy();
    e1.setup(P(40, 3, 41));
    const e2 = new HitEnemy();
    e2.setup(P(40, 3, 42));
    const tower = makeTower(towerView(projView({ randomAttackTimeMin: 0, randomAttackTimeMax: 0.5 })));
    // attack point on e1 → deduped by host
    const ap = new GameCoreEnemyAttackPoint(e1, 0.3, null, P(0, 1, 0), null);
    e1.attackPointsPush(ap.handle);
    const lightning = new GameCoreProjectileLightning(tower, [], true);
    for (let i = 0; i < 35; i++) {
      if (lightning.isDestroyed()) break;
      lightning.tick(); // timer passes max delay 0.5 → all struck
    }
    expect(e1.hits.length).toBe(1); // struck once (point deduped)
    expect(e2.hits.length).toBe(1);
    expect(lightning.isDestroyed()).toBe(true);
    expect(lightning.duration).toBe(0); // FAITHFUL: base lifetime never touched
  });
});
