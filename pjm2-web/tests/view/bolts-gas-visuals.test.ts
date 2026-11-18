// tests/view/bolts-gas-visuals.test.ts
// View additions for the ported sims: beam line geometry, procedural bolts, Gaseous flow -> ground-fire effect swap.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import { BuffContainer } from '../../src/core/BuffContainer';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { ETowerAttackDef } from '../../src/core/enums';
import { resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreProjectileGaseous } from '../../src/core/GameCoreProjectileGaseous';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { setSimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject, registerUnityObject, resetUnityObjectRegistryForTests, setProjectileViewerFactory,
  type CatmullCurveContract, type TowerBaseContract,
} from '../../src/view/q4-contracts';
import { BeamLine, BoltEffects, jaggedPoints } from '../../src/view/projectiles/BoltEffects';
import { projectileContractForTower } from '../../src/view/projectiles/projectileContracts';
import { ProjectileViewerSystem } from '../../src/view/projectiles/ProjectileViewer';

const f = Math.fround;

describe('BeamLine (ProjectileBeam LineRenderer)', () => {
  it('tail = head - dir * min(beamLength, distance from muzzle); x mirrored to three', () => {
    const g = new THREE.Group();
    const b = new BeamLine(g, 3);
    b.update({ x: 1, y: 2, z: 5 }, { x: 1, y: 2, z: 4 }, { x: 0, y: 0, z: 1 }); // 1 from the muzzle -> 1 long
    const pos = (g.children[1] as THREE.Line).geometry.getAttribute('position') as THREE.BufferAttribute;
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([-1, 2, 5]);
    expect(pos.getZ(1)).toBeCloseTo(4, 5);
    b.update({ x: 1, y: 2, z: 20 }, { x: 1, y: 2, z: 4 }, { x: 0, y: 0, z: 1 }); // far -> capped at beamLength 3
    expect(pos.getZ(1)).toBeCloseTo(17, 5);
    b.dispose();
    expect(g.children.length).toBe(0);
  });
});

describe('BoltEffects', () => {
  it('jagged polyline is pinned at both ends and displaced in between', () => {
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pts = jaggedPoints(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10), 8, 0.5, rnd);
    expect(pts).toHaveLength(9);
    expect(pts[0].length()).toBe(0);
    expect(pts[8].z).toBe(10);
    expect(pts.slice(1, 8).some((p) => Math.hypot(p.x, p.y) > 0.01)).toBe(true);
  });
  it('a spawned bolt lives its life then removes itself', () => {
    const g = new THREE.Group();
    const bolts = new BoltEffects(g);
    bolts.spawn({ x: 0, y: 5, z: 0 }, { x: 1, y: 0, z: 1 }, { color: 0x6ab8ff, life: 0.2 });
    expect(g.children.length).toBe(3);
    bolts.update(0.1);
    expect(bolts.active).toBe(1);
    bolts.update(0.15);
    expect(bolts.active).toBe(0);
    expect(g.children.length).toBe(0);
  });
});

class LineCurve implements CatmullCurveContract {
  id = 1; curveLength = 100; curveLengthB4Activation = 2;
  sampleLinearDistance(d: number) { return { x: d, y: 0, z: 0 }; }
  distanceToTime(d: number) { return d / 100; }
  sampleDirect(t: number, s: number) { return { x: t * 100, y: 0, z: s }; }
  sampleVelDirect() { return { x: 1, y: 0, z: 0 }; }
  nodeTimeToDistance(t: number) { return t * 100; }
}
class Target extends GameCoreEnemy {
  setup(pos: Vector3): void { this.position = pos; this.pathMove = new CorePathMove(new LineCurve()); this.m_distance = f(5); this.m_buffs = new BuffContainer(); }
  override tick(): void { this.buffs.tick(this); }
}

describe('Gaseous view: flow stream -> ground-fire effect', () => {
  let core: GameCore;
  beforeEach(() => {
    GameCoreHandle.resetStaticsForTests(); resetAllEventsForTests(); resetUnityObjectRegistryForTests(); CoreObjectPool.resetInstanceForTests();
    setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 80, 128)));
    core = new GameCore(); setInstanceProvider(() => core); core.installFrame(core.currentFrame); core.tick(1 / 60);
    setViewerResolver((h) => getRegisteredUnityObject(h));
    setSimPhysics({
      linecast: (ax, ay, az, bx, by, bz) => (ay > 0 && by <= 0 ? { point: [ax, 0, az], normal: [0, 1, 0], distance: 0, colliderName: '', layer: 0, layerName: '', isTrigger: false } : null),
      raycast: () => null, sphereCast: () => null, checkSphere: () => false,
    });
    unityRandom.InitState(3);
  });
  afterEach(() => {
    setProjectileViewerFactory(null); setInstanceProvider(null); setFrameResolver(null); setViewerResolver(null); setBoundsProvider(null); setSimPhysics(null);
    resetUnityObjectRegistryForTests();
  });

  it('starts the flow loop while flying, swaps to the affect loop on landing, stops everything when the sim object dies', () => {
    const log: string[] = [];
    const effects = {
      has: () => true,
      play: () => 0,
      startLooping: (name: string) => { log.push(`start:${name}`); return { update: () => {}, stop: () => { log.push(`stop:${name}`); } }; },
    };
    const sys = new ProjectileViewerSystem({ parent: new THREE.Group(), models: new Map(), effects: effects as never, audio: null });
    setProjectileViewerFactory(sys.factory);
    const name = 'tower_004';
    const raw = {
      name, gameObject: {}, transform: { position: { x: 40, y: 0, z: 40 } }, nextTargetToAttackIndex: 0, attackType: ETowerAttackDef.all,
      strengthType: 1, classType: 1, balloonAimable: false, attackPower: 110, attackSpeed: 1, attackRangeInner: 0, attackSpread: 3,
      costCoin: 1, costGem: 0, buildTime: 1, buildRange: 1, refundCoin: 0, refundGem: 0, magazineCapacity: -1, rotateSpeedX: 90, rotateSpeedXAcel: 90,
      rotateSpeedXDecl: 90, rotateSpeedY: 90, rotateSpeedYAcel: 90, rotateSpeedYDecl: 90, oneShotOneBalloon: false, fullRangeFire: true,
      fireAngleThreshold: 360, attackAttenuations: [], burstCount: 1, burstInterval: 0, cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30,
      cautionRotateAngleMin: 10, playerDetectionRange: 2, firePointNames: null, projectile: projectileContractForTower(name),
      getComponentTowerUpgradeSetting: () => null,
      getComponentEnemyDetectorView: () => ({ createGameCoreDetector: () => ({ getCollisionCylinder: () => ({ radius: 5, height: 15 }), getOffset: () => Vector3.zero, upgrade: () => {}, inDetection: () => true, inAttack: () => true }) }),
      findDeepChildY: () => null, getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
    } as unknown as TowerBaseContract;
    const tower = new GameCoreTower(name, []);
    tower.position = new Vector3(40, 0, 40);
    registerUnityObject(tower.handle.m_handle, raw);
    tower.initialize();
    const t = new Target(); t.setup(new Vector3(40, 0, 44));
    tower.setCurrentTarget(t);
    const proj = new GameCoreProjectileGaseous(tower, [t], true);
    let flowStarted = -1, affectStarted = -1;
    for (let i = 0; i < 60 * 15 && !proj.isDestroyed(); i++) {
      proj.tick();
      sys.update(1 / 60, [proj]);
      if (flowStarted < 0 && log.includes('start:ef_tower_fire_flame_pv')) flowStarted = i;
      if (affectStarted < 0 && log.includes('start:ef_tower_fire_flame_ground_pv')) affectStarted = i;
    }
    expect(flowStarted).toBeGreaterThanOrEqual(0);
    expect(affectStarted).toBeGreaterThan(flowStarted);
    const stopFlow = log.indexOf('stop:ef_tower_fire_flame_pv');
    expect(stopFlow).toBeGreaterThanOrEqual(0);
    expect(stopFlow).toBeLessThan(log.indexOf('start:ef_tower_fire_flame_ground_pv'));
    sys.update(1 / 60, []); // sim object gone -> view destroyed -> ground effect stopped
    expect(log).toContain('stop:ef_tower_fire_flame_ground_pv');
    expect(sys.instances.size).toBe(0);
  });
});
