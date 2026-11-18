// tests/core/tower.test.ts
// Semantics tests for the tower cluster: TowerHelper (IsTarget key fold,
// filter, inner-range hit push, cost trees, FromTreeToTower claiming + Build),
// GameCoreTower (settings copy, target queue, EXP/upgrade, ammo/recharge,
// occupancy, target-change semantics), and FSM states (Attack burst/ammo,
// Build rise/snap, Broken gem pop + reentry).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { EEnemyMoveTypeDef, ETowerAttackDef } from '../../src/core/enums';
import { EnemyDetectorSphere } from '../../src/core/EnemyDetectorSphere';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { GameCoreProjectile } from '../../src/core/GameCoreProjectile';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import type { IDamageable } from '../../src/core/interfaces';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import { TowerHelper } from '../../src/core/TowerHelper';
import { TowerStateAttack } from '../../src/core/TowerStateAttack';
import { TowerStateBroken } from '../../src/core/TowerStateBroken';
import { TowerStateBuild } from '../../src/core/TowerStateBuild';
import { TowerStateChangeMag } from '../../src/core/TowerStateChangeMag';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setDebugCanvasProvider,
  type CatmullCurveContract,
  type NatureTreeViewContract,
  type TowerBaseContract,
  type TowerUpgradeContract,
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

class QueueEnemy extends GameCoreEnemy {
  setup(pos: Vector3): void {
    this.position = pos;
    this.pathMove = new CorePathMove(new LineCurve());
    this.m_distance = f(5); // past curveLengthB4Activation 2 → validateTarget true
    this.enemyMoveType = EEnemyMoveTypeDef.ground;
  }
}

class TestProjectile extends GameCoreProjectile {
  static instances: TestProjectile[] = [];
  constructor(tower: GameCoreTower, targets: IDamageable[], dealsDamage: boolean) {
    super(tower, targets, dealsDamage);
    TestProjectile.instances.push(this);
  }
}

function towerData(overrides: Partial<TowerBaseContract> = {}): TowerBaseContract {
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
    attackRangeInner: 1,
    attackSpread: 0,
    costCoin: 50,
    costGem: 0,
    buildTime: 2,
    buildRange: 2,
    refundCoin: 25,
    refundGem: 0,
    magazineCapacity: 3,
    rotateSpeedX: 90,
    rotateSpeedXAcel: 180,
    rotateSpeedXDecl: 180,
    rotateSpeedY: 90,
    rotateSpeedYAcel: 180,
    rotateSpeedYDecl: 180,
    oneShotOneBalloon: false,
    fullRangeFire: true,
    fireAngleThreshold: 30,
    attackAttenuations: [],
    burstCount: 1,
    burstInterval: 0,
    cautionRange: 45,
    cautionIdleTime: 1,
    cautionRotateSpeed: 30,
    cautionRotateAngleMin: 10,
    playerDetectionRange: 2,
    firePointNames: ['firePoint'],
    projectile: {
      getFireDirection: (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }),
      getGameCoreType: () => TestProjectile,
    },
    getComponentTowerUpgradeSetting: () => ({
      getCurrentUpgrade: (): TowerUpgradeContract => ({ level: 1, reachExp: 0 }),
      getNextUpgrade: (): TowerUpgradeContract => ({ level: 2, reachExp: 100 }),
      upgradeTower: (_t: GameCoreTower) => 2,
    }),
    getComponentEnemyDetectorView: () => ({
      createGameCoreDetector: () => new EnemyDetectorSphere(new Vector3(0, 1, 0), 5, 1),
    }),
    findDeepChildY: (_name: string) => 3,
    getFirePointByRemainingMag: (_mag: number) => ({ x: 40, y: 3, z: 40 }),
    ...overrides,
  };
}

let core: GameCore;
const physicsFake: SimPhysics = {
  linecast: (): RaycastHit | null => null, // clear line of sight
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
  setSimPhysics(physicsFake);
  TestProjectile.instances.length = 0;
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setDebugCanvasProvider(() => null);
  resetUnityObjectRegistryForTests();
});

function makeTower(data: TowerBaseContract = towerData()): GameCoreTower {
  const tower = new GameCoreTower(data.name, []);
  tower.position = P(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, data);
  tower.initialize();
  return tower;
}

function treeViewer(): NatureTreeViewContract {
  return {
    playerDetectionRange: 2,
    towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: 40, y: 0, z: 40 } },
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

// ---- TowerHelper ----------------------------------------------------------------

describe('TowerHelper', () => {
  it('IsTarget key fold: ground→walkers, air→flyers, all→everything, unknown→none', () => {
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.ground, ETowerAttackDef.ground)).toBe(true);
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.air, ETowerAttackDef.ground)).toBe(false);
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.air, ETowerAttackDef.air)).toBe(true);
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.ground, ETowerAttackDef.air)).toBe(false);
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.air, ETowerAttackDef.all)).toBe(true);
    expect(TowerHelper.isTarget(EEnemyMoveTypeDef.ground, ETowerAttackDef.unknown)).toBe(false);
  });

  it('hit position pushed onto the inner-range sphere, keeping relative height', () => {
    const tower = makeTower(); // attackRangeInner 1
    const near = P(40.3, 0.2, 40); // delta mag sqrt(0.13) ≈ 0.36 < 1
    const hit = TowerHelper.getProjectileGameCoreHitPoisition(tower, near);
    const mag = Math.sqrt(0.3 * 0.3 + 0.2 * 0.2);
    expect(hit.x).toBeCloseTo(40 + 0.3 / mag, 5); // pushed to inner range
    expect(hit.y).toBeCloseTo(0.2 / mag + 0.2, 5); // normalized.y + delta.y kept
    const far = P(45, 0, 40);
    expect(TowerHelper.getProjectileGameCoreHitPoisition(tower, far)).toBe(far);
    expect(TowerHelper.getProjectileGameCoreHitPoisition(null, far).x).toBe(0);
  });

  it('GetCostTrees: unclaimed trees within FLAT range only', () => {
    const center = new GameCoreTree(P(40, 0, 40));
    const near = new GameCoreTree(P(41, 5, 40)); // height diff ignored (flat test)
    const far = new GameCoreTree(P(50, 0, 40));
    const claimed = new GameCoreTree(P(40.5, 0, 40));
    claimed.referenceCount = 1;
    const cost: GameCoreTree[] = [];
    TowerHelper.getCostTrees(center, 2, cost);
    expect(cost).toContain(center);
    expect(cost).toContain(near);
    expect(cost).not.toContain(far);
    expect(cost).not.toContain(claimed);
  });

  it('FromTreeToTower: claims trees, seeds directions, boots Build state', () => {
    const tree = new GameCoreTree(P(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    const neighbor = new GameCoreTree(P(41, 0, 40));
    const breaks: GameCoreObject[] = [];
    const cb = (o: GameCoreObject) => breaks.push(o);
    Events.structureBreakEvent.addListener(cb, EventTime.Immediate);

    const tower = TowerHelper.fromTreeToTower(tree, towerData());
    expect(tower).not.toBeNull();
    expect(tree.referenceCount).toBe(1); // claimed
    expect(neighbor.referenceCount).toBe(1);
    expect(breaks.length).toBe(2);
    expect(tower!.retainedTrees.length).toBe(2);
    expect(tower!.fortDirection.z).toBe(1); // treeView.towerDirection
    expect(tower!.getTowerState()).toBeInstanceOf(TowerStateBuild);
    // Build.enter lowered the tower by its height (fire point 3)
    expect(tower!.position.y).toBeCloseTo(-3, 5);
    Events.structureBreakEvent.removeListener(cb);
  });
});

// ---- GameCoreTower ----------------------------------------------------------------

describe('GameCoreTower', () => {
  it('Initialize copies viewer stats; height from fire points; detector built', () => {
    const tower = makeTower();
    expect(tower.attackPower).toBe(10);
    expect(tower.attackRangeInner).toBe(1);
    expect(tower.magazineCapacity).toBe(3);
    expect(tower.fireAngleThreshold).toBe(360); // fullRangeFire
    expect(tower.height).toBe(3); // max(default 2, firePoint 3 − 0)
    expect(tower.enemyDetector).not.toBeNull();
    expect(tower.currentLevel).toBe(1);
  });

  it('target queue acquires enemies in range and prunes the dead', () => {
    const tower = makeTower();
    const enemy = new QueueEnemy();
    enemy.setup(P(40, 0, 41));
    const changes: GameCoreTower[] = [];
    const cb = (t: GameCoreTower) => changes.push(t);
    Events.towerTargetChangeEvent.addListener(cb, EventTime.Immediate);

    for (let i = 0; i < 16; i++) tower.tick(); // > 0.25s → queue update
    expect(tower.targetQueue.length).toBe(1);
    expect(tower.getCurrentTarget()).toBe(enemy);
    expect(changes.length).toBe(1);

    enemy.destroySelf();
    GameCoreHandle.invalidateAllCachedData();
    for (let i = 0; i < 16; i++) tower.tick();
    expect(tower.targetQueue.length).toBe(0);
    expect(tower.getCurrentTarget()).toBeNull();
    Events.towerTargetChangeEvent.removeListener(cb);
  });

  it('GrantEXP banks, auto-upgrades at reachExp, fires events; debug rate applies', () => {
    const tower = makeTower();
    const grants: number[] = [];
    const upgrades: unknown[][] = [];
    const cbG = (_t: GameCoreTower, amt: number) => grants.push(amt);
    const cbU = (...args: unknown[]) => upgrades.push(args);
    Events.expGrantEvent.addListener(cbG, EventTime.Immediate);
    Events.towerUpgradeEvent.addListener(cbU, EventTime.Immediate);

    tower.grantEXP(50, null);
    expect(tower.currentEXP).toBe(50);
    expect(tower.currentLevel).toBe(1); // below reachExp 100
    tower.grantEXP(60, null);
    expect(tower.currentLevel).toBe(2); // upgraded (setting returns 2)
    expect(upgrades.length).toBe(1);
    expect(grants).toEqual([50, 60]);

    setDebugCanvasProvider(() => ({ disableGameOver: false, towerEXPRate: 2, damageRate: 1 }));
    const tower2 = makeTower();
    tower2.grantEXP(10, null);
    expect(tower2.currentEXP).toBe(20); // ×2 debug
    Events.expGrantEvent.removeListener(cbG);
    Events.towerUpgradeEvent.removeListener(cbU);
  });

  it('ammo gates + RechargeBullet via ChangeMag (refill at state start)', () => {
    const tower = makeTower();
    expect(tower.hasEnoughBullet()).toBe(true);
    tower.magazineCapacity = 0;
    expect(tower.hasEnoughBullet()).toBe(false);
    tower.magazineCapacity = -1;
    expect(tower.hasEnoughBullet()).toBe(true); // unlimited
    tower.magazineCapacity = 1;
    const mags: unknown[][] = [];
    const cb = (...args: unknown[]) => mags.push(args);
    Events.missileTowerChangeMag.addListener(cb, EventTime.Immediate);
    tower.rechargeBullet(); // viewer capacity 3 > 1
    expect(tower.getTowerState()).toBeInstanceOf(TowerStateChangeMag);
    expect(tower.magazineCapacity).toBe(3); // refilled on Enter
    expect(mags.length).toBe(1);
    expect(mags[0][1]).toBe(1);
    expect(mags[0][2]).toBe(3);
    Events.missileTowerChangeMag.removeListener(cb);
  });

  it('player occupancy enter/exit/id', () => {
    const tower = makeTower();
    expect(tower.hasPlayerInTower()).toBe(false);
    expect(tower.playerInTowerID()).toBe(-1);
    const h = GameCoreHandle.createHandle(42);
    tower.playerEnterTower(h);
    expect(tower.hasPlayerInTower()).toBe(true);
    tower.playerExitTower();
    expect(tower.hasPlayerInTower()).toBe(false);
  });

  it('SetCurrentTarget only fires on actual handle change; zeroes rotation speeds', () => {
    const tower = makeTower();
    const e1 = new QueueEnemy();
    e1.setup(P(40, 0, 41));
    const changes: number[] = [];
    const cb = () => changes.push(1);
    Events.towerTargetChangeEvent.addListener(cb, EventTime.Immediate);
    tower.currentRotateSpeedX = 50;
    tower.setCurrentTarget(e1);
    expect(changes.length).toBe(1);
    expect(tower.currentRotateSpeedX).toBe(0);
    tower.currentRotateSpeedX = 50;
    tower.setCurrentTarget(e1); // same handle → no change
    expect(changes.length).toBe(1);
    expect(tower.currentRotateSpeedX).toBe(50);
    tower.setCurrentTarget(null);
    expect(changes.length).toBe(2);
    Events.towerTargetChangeEvent.removeListener(cb);
  });
});

// ---- FSM states ---------------------------------------------------------------------

describe('tower FSM states', () => {
  it('Attack: fires sim projectiles, consumes ammo at burst end, returns to Idle', () => {
    const tower = makeTower(towerData({ burstCount: 2, magazineCapacity: 2 }));
    const enemy = new QueueEnemy();
    enemy.setup(P(40, 0, 41));
    tower.setCurrentTarget(enemy);
    tower.fortDirection = P(0, 0, 1);
    const launches: GameCoreTower[] = [];
    const cb = (t: GameCoreTower) => launches.push(t);
    Events.projectileLaunchEvent.addListener(cb, EventTime.Immediate);

    tower.setTowerState(new TowerStateAttack(0, 0, false)); // burstInterval 0 → charged
    tower.tick(); // FSM tick → Attack.tick → shot 1 (burst 1 < 2 → stays)
    expect(TestProjectile.instances.length).toBe(1);
    expect(tower.getTowerState()).toBeInstanceOf(TowerStateAttack);
    tower.tick(); // shot 2 → burst complete → ammo 2→1 → Idle
    expect(TestProjectile.instances.length).toBe(2);
    expect(tower.magazineCapacity).toBe(1);
    expect(launches.length).toBe(2);
    Events.projectileLaunchEvent.removeListener(cb);
  });

  it('Build: rises from below and snaps exactly on exit', () => {
    const tower = makeTower(); // height 3
    const finalPos = tower.position;
    tower.setTowerState(new TowerStateBuild(1));
    expect(tower.position.y).toBeCloseTo(-3, 5); // entered → lowered
    for (let i = 0; i < 30; i++) tower.tick(); // 0.5s → halfway up
    expect(tower.position.y).toBeGreaterThan(-3);
    expect(tower.position.y).toBeLessThan(0);
    for (let i = 0; i < 40; i++) tower.tick(); // duration 1s elapses → exit snaps
    expect(tower.position.y).toBeCloseTo(finalPos.y, 5);
  });

  it('Broken: pops gems once after the delay; exit re-queues Broken', () => {
    const tower = makeTower();
    const pops: Array<[unknown, number]> = [];
    const cb = (t: unknown, n: number) => pops.push([t, n]);
    Events.onGemTowerPopGem.addListener(cb, EventTime.Immediate);
    tower.setTowerState(new TowerStateBroken(10000, 0.1, 5));
    for (let i = 0; i < 10; i++) tower.tick(); // > 0.1s
    expect(pops.length).toBe(1);
    expect(pops[0][1]).toBe(5);
    for (let i = 0; i < 10; i++) tower.tick();
    expect(pops.length).toBe(1); // never twice
    // NOTE: forcing a transition OUT of Broken is not tested — Broken.Exit
    // re-queues Broken via SetCurrentCommand while still current, which
    // recurses (faithful; dead code in practice: duration 10000s, and nothing
    // in play replaces a broken gem tower). Verified vs raw @0x770E50.
    Events.onGemTowerPopGem.removeListener(cb);
  });
});
