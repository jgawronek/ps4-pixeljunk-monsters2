// tests/core/gaseous-insect.test.ts
// GameCoreProjectileGaseous (flame tower_004 / ice tower_006) and GameCoreProjectileInsect (hive tower_008): ported from
// the Ghidra pseudo-C (no C# upstream) — behaviour checked against the serialized prefab tuning in the real sim.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import { BuffContainer } from '../../src/core/BuffContainer';
import { BuffBurn } from '../../src/core/BuffBurn';
import { BuffFreeze } from '../../src/core/BuffFreeze';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { EEnemyMoveTypeDef, ETowerAttackDef } from '../../src/core/enums';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { EventTime } from '../../src/core/event/CoreEvent';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreProjectileGaseous } from '../../src/core/GameCoreProjectileGaseous';
import { GameCoreProjectileInsect } from '../../src/core/GameCoreProjectileInsect';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { setSimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  type CatmullCurveContract,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';
import { projectileContractForTower } from '../../src/view/projectiles/projectileContracts';
import { isEnemyOfBuffType } from '../../src/view/projectiles/buffSettings';

const f = Math.fround;

class LineCurve implements CatmullCurveContract {
  id = 1; curveLength = 100; curveLengthB4Activation = 2;
  sampleLinearDistance(d: number) { return { x: d, y: 0, z: 0 }; }
  distanceToTime(d: number) { return d / 100; }
  sampleDirect(t: number, s: number) { return { x: t * 100, y: 0, z: s }; }
  sampleVelDirect() { return { x: 1, y: 0, z: 0 }; }
  nodeTimeToDistance(t: number) { return t * 100; }
}
class Target extends GameCoreEnemy {
  damageTaken = 0;
  setup(pos: Vector3, mt = EEnemyMoveTypeDef.ground): void {
    this.position = pos;
    this.pathMove = new CorePathMove(new LineCurve());
    this.m_distance = f(5);
    this.enemyMoveType = mt;
    this.m_buffs = new BuffContainer();
  }
  override tick(): void { this.buffs.tick(this); }
  override dealDamage(_s: unknown, dmg: number): void { this.damageTaken += dmg; }
  override dealDamageTyped(_a: unknown, _b: unknown, dmg: number): void { this.damageTaken += dmg; }
}

function towerFor(name: string, power: number, spread: number): GameCoreTower {
  const raw = {
    name, gameObject: { tag: name }, transform: { position: { x: 40, y: 0, z: 40 } },
    nextTargetToAttackIndex: 0, attackType: ETowerAttackDef.all, strengthType: 1, classType: 1,
    balloonAimable: false, attackPower: power, attackSpeed: 0.5, attackRangeInner: 0, attackSpread: spread,
    costCoin: 50, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 25, refundGem: 0,
    magazineCapacity: -1, rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180, oneShotOneBalloon: false,
    fullRangeFire: true, fireAngleThreshold: 360, attackAttenuations: [], burstCount: 1, burstInterval: 0,
    cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30, cautionRotateAngleMin: 10,
    playerDetectionRange: 2, firePointNames: null,
    projectile: projectileContractForTower(name),
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => ({
      createGameCoreDetector: () => ({
        getCollisionCylinder: () => ({ radius: 5, height: 15 }),
        getOffset: () => Vector3.zero, upgrade: () => {}, inDetection: () => true, inAttack: () => true,
      }),
    }),
    findDeepChildY: () => null, getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
  } as unknown as TowerBaseContract;
  const tower = new GameCoreTower(name, []);
  tower.position = new Vector3(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, raw);
  tower.initialize();
  return tower;
}

let core: GameCore;
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
  // floor at y = 0 (terrain): a segment that crosses y=0 hits at the crossing point
  setSimPhysics({
    linecast: (ax, ay, az, bx, by, bz) => {
      if (ay > 0 && by <= 0) {
        const t = ay / (ay - by);
        return { point: [ax + (bx - ax) * t, 0, az + (bz - az) * t], normal: [0, 1, 0], distance: 0, colliderName: 'floor', layer: 0, layerName: '', isTrigger: false };
      }
      return null;
    },
    raycast: () => null, sphereCast: () => null, checkSphere: () => false,
  });
  unityRandom.InitState(7);
});
afterEach(() => {
  setInstanceProvider(null); setFrameResolver(null); setViewerResolver(null); setBoundsProvider(null); setSimPhysics(null);
  resetUnityObjectRegistryForTests();
});

describe('contracts resolve the ported sim classes', () => {
  it('flame/ice -> GameCoreProjectileGaseous with BuffSettings; hive -> GameCoreProjectileInsect with an insect budget', () => {
    expect(projectileContractForTower('tower_004')!.getGameCoreType()).toBe(GameCoreProjectileGaseous);
    expect(projectileContractForTower('tower_006')!.getGameCoreType()).toBe(GameCoreProjectileGaseous);
    expect(projectileContractForTower('tower_008')!.getGameCoreType()).toBe(GameCoreProjectileInsect);
    expect(projectileContractForTower('tower_008')!.insectAmountMax).toBe(5);
    expect(projectileContractForTower('tower_004')!.getComponentsBuffSetting()).toHaveLength(1);
    expect(projectileContractForTower('tower_006')!.getComponentsBuffSetting()).toHaveLength(1);
  });
});

describe('GameCoreProjectileGaseous (tower_004 flame)', () => {
  it('flies, grounds at the terrain hit, then burns every enemy inside the (distance-shrunk) radius for the ground-fire duration', () => {
    const tower = towerFor('tower_004', 110, 3.0);
    const near = new Target(); near.setup(new Vector3(40, 0, 43.2)); // inside the ground-fire radius
    const far = new Target(); far.setup(new Vector3(40, 0, 52)); // outside
    tower.setCurrentTarget(near);
    const proj = new GameCoreProjectileGaseous(tower, [near], true);
    expect(proj.attackDamagePerSecond).toBe(110);
    let groundedAt = -1;
    Events.projectileHitTerrain.addListener(() => { if (groundedAt < 0) groundedAt = tick; }, EventTime.Immediate);
    let tick = 0, burnSeen = false;
    for (; tick < 60 * 14 && !proj.isDestroyed(); tick++) {
      proj.tick();
      near.tick(); far.tick();
      if (near.buffs.getAllBuffs().some((b) => b instanceof BuffBurn)) burnSeen = true;
    }
    expect(groundedAt).toBeGreaterThan(5);
    expect(burnSeen).toBe(true);
    expect(near.damageTaken).toBeGreaterThan(110); // > 1 s of burn (110 dps in 0.067 s pulses)
    expect(far.damageTaken).toBe(0);
    // lifetime: grounded at t, lives affectDuration (11.3 s) more, then is destroyed
    expect(proj.isDestroyed()).toBe(true);
    expect(tick / 60 - groundedAt / 60).toBeGreaterThan(10);
    expect(tick / 60 - groundedAt / 60).toBeLessThan(12.5);
  });

  it('flowLengthMax ends a flow that never hits anything; destroyed with the tower', () => {
    setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
    const tower = towerFor('tower_004', 110, 3.0);
    const proj = new GameCoreProjectileGaseous(tower, null, true); // no target: fired 2.5 ahead of the fort
    let n = 0;
    while (!proj.isDestroyed() && n < 600) { proj.tick(); n++; }
    expect(proj.isDestroyed()).toBe(true);
    expect(n / 60).toBeLessThanOrEqual(3.2); // maxLifeDuration 3
    const tower2 = towerFor('tower_004', 110, 3.0);
    const p2 = new GameCoreProjectileGaseous(tower2, null, true);
    tower2.destroySelf();
    p2.tick();
    expect(p2.isDestroyed()).toBe(true);
  });
});

describe('GameCoreProjectileGaseous (tower_006 ice)', () => {
  it('freezes (BuffFreeze 0.5x speed) enemies in the cloud and restores the speed when it leaves', () => {
    const tower = towerFor('tower_006', 0, 0.6);
    const t = new Target(); t.setup(new Vector3(40, 0, 42));
    tower.setCurrentTarget(t);
    const proj = new GameCoreProjectileGaseous(tower, [t], true);
    let froze = false;
    for (let i = 0; i < 60 * 4 && !proj.isDestroyed(); i++) {
      t.pretickUpdatePreviousTickPosition(); proj.tick(); t.tick();
      if (t.buffs.getAllBuffs().some((b) => b instanceof BuffFreeze)) froze = true;
      if (froze && t.getSpeedScale() < 1) break;
    }
    expect(froze).toBe(true);
    expect(t.getSpeedScale()).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 60 * 8; i++) { t.pretickUpdatePreviousTickPosition(); if (!proj.isDestroyed()) proj.tick(); t.tick(); }
    expect(t.getSpeedScale()).toBe(1); // buff expired -> OnExitBuff restores
  });
});

describe('Q4.BuffSetting.IsEnemyOfBuffType', () => {
  it('shipped masks (-2 flame, -1 ice) let every ground/air enemy through; masking out the ground bit rejects ground', () => {
    const g = new Target(); g.setup(new Vector3(1, 0, 1));
    const a = new Target(); a.setup(new Vector3(2, 0, 2), EEnemyMoveTypeDef.air);
    expect(isEnemyOfBuffType(g, -2)).toBe(true);
    expect(isEnemyOfBuffType(a, -1)).toBe(true);
    expect(isEnemyOfBuffType(g, 4)).toBe(false);
    expect(isEnemyOfBuffType(a, 2)).toBe(false);
  });
});

describe('GameCoreProjectileInsect (tower_008 hive bee)', () => {
  it('hovers over the tower, spots an enemy in range, stands by, dives and deals the tower power once', () => {
    setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
    const tower = towerFor('tower_008', 175, 0.1);
    tower.height = f(2);
    const player = new GameCorePlayer();
    player.playerId = 1;
    player.position = new Vector3(46, 0, 40); // bees patrol tower -> player(+2 up) -> tower
    const enemy = new Target(); enemy.setup(new Vector3(43, 1, 41.5));
    const spotted: number[] = [];
    Events.beeSpotATargetEvent.addListener(() => { spotted.push(tick); }, EventTime.Immediate);
    let hits = 0;
    Events.projectileHitEvent.addListener((_p, d) => { if (d !== null) hits++; }, EventTime.Immediate);
    const bee = new GameCoreProjectileInsect(tower, [enemy], true);
    let tick = 0;
    for (; tick < 60 * 12 && !bee.isDestroyed(); tick++) bee.tick();
    expect(spotted.length).toBe(1);
    expect(hits).toBe(1);
    expect(enemy.damageTaken).toBeGreaterThan(0);
    expect(bee.isDestroyed()).toBe(true);
    // standby 0.7 s between spotting and impact, then 25 u/s dive
    expect(tick - spotted[0]).toBeGreaterThanOrEqual(42);
  });

  it('with no player at all the bee is consumed on its first tick (hover destination == spawn point; faithful)', () => {
    setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
    const tower = towerFor('tower_008', 175, 0.1);
    tower.height = f(2);
    const bee = new GameCoreProjectileInsect(tower, null, true);
    bee.tick();
    expect(bee.isDestroyed()).toBe(true);
  });

  it('with nobody to attack the bee returns to the tower and vanishes; it also visits a nearby player first', () => {
    setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
    const tower = towerFor('tower_008', 175, 0.1);
    tower.height = f(2);
    const player = new GameCorePlayer();
    player.playerId = 1;
    player.position = new Vector3(44, 0, 40);
    const bee = new GameCoreProjectileInsect(tower, null, true);
    let n = 0, closest = 1e9;
    while (!bee.isDestroyed() && n < 60 * 40) {
      bee.tick(); n++;
      closest = Math.min(closest, Vector3.Distance(bee.position, player.position.add(Vector3.up.mulScalar(2))));
    }
    expect(closest).toBeLessThan(0.5); // reached the player's hover point
    expect(bee.isDestroyed()).toBe(true); // then home to the tower
    expect(n).toBeGreaterThan(60);
  });
});
