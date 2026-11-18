// tests/view/projectiles.test.ts
// Q4.Projectile* view port: ballistic aim math, orientation, per-tower prefab
// data (distinct models/classes), and the REAL sim firing a cannon vs a crossbow.
// Evidence: docs/PROJECTILE_ANALYSIS.md.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { unityRandom } from '../../src/engine/rng/UnityRandom';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CorePathMove } from '../../src/core/CorePathMove';
import { EEnemyMoveTypeDef, ETowerAttackDef } from '../../src/core/enums';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { EventTime } from '../../src/core/event/CoreEvent';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreProjectile } from '../../src/core/GameCoreProjectile';
import { GameCoreProjectileInstant } from '../../src/core/GameCoreProjectileInstant';
import { GameCoreProjectileTrajectory } from '../../src/core/GameCoreProjectileTrajectory';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { setSimPhysics } from '../../src/core/physics-seam';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setProjectileViewerFactory,
  type CatmullCurveContract,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';
import { PROJECTILE_DATA } from '../../src/view/projectiles/projectileData.generated';
import { projectileContract, projectileContractForTower } from '../../src/view/projectiles/projectileContracts';
import {
  ballisticFireDirection,
  estimateImpactTime,
  integrateStep,
  isVisibleAt,
  lookRotationForwardZ,
  mirrorQuat4,
  viewStep,
} from '../../src/view/projectiles/projectileMath';
import { ProjectileViewerSystem } from '../../src/view/projectiles/ProjectileViewer';
import { flattenEffect, emissionAxisThree } from '../../src/view/projectiles/projectileEffects';

const f = Math.fround;
const ZERO = { x: 0, y: 0, z: 0 };

describe('ballisticFireDirection (Q4.ProjectileTrajectory.GetFireDirection @0074dfd0)', () => {
  const cannon = { fixedImpactTime: false, impactTime: 2, speedHorizontal: 2.3, gravity: -20 };

  it('horizontal speed = speedHorizontal; vy solves d.y = vy t + g t^2 / 2', () => {
    const from = { x: 0, y: 3, z: 0 };
    const to = { x: 0, y: 1, z: 6 };
    const v = ballisticFireDirection(from, to, ZERO, cannon);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(2.3, 4);
    const t = 6 / 2.3;
    expect(v.y).toBeCloseTo((-2 + 0.5 * 20 * t * t) / t, 3);
    // analytic landing
    expect(3 + v.y * t - 0.5 * 20 * t * t).toBeCloseTo(1, 3);
  });

  it('fixedImpactTime: flight time is exactly impactTime regardless of distance', () => {
    const mortar = { fixedImpactTime: true, impactTime: 1.133, speedHorizontal: 6.29, gravity: -80 };
    for (const dz of [2, 5, 9]) {
      const v = ballisticFireDirection({ x: 0, y: 3, z: 0 }, { x: 0, y: 1, z: dz }, ZERO, mortar);
      expect(dz / v.z).toBeCloseTo(1.133, 3); // horizontal time
      expect(3 + v.y * 1.133 - 40 * 1.133 * 1.133).toBeCloseTo(1, 2);
    }
  });

  it('degenerate (target straight above) never yields NaN', () => {
    const v = ballisticFireDirection({ x: 1, y: 1, z: 1 }, { x: 1, y: 5, z: 1 }, ZERO, { ...cannon });
    expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });

  it('sim integration (v += g dt; p += v dt @60Hz) forms an arc landing near the target', () => {
    let pos = { x: 0, y: 3, z: 0 };
    let vel = ballisticFireDirection(pos, { x: 0, y: 1, z: 6 }, ZERO, cannon);
    let apex = -Infinity;
    const dt = f(1 / 60);
    let steps = 0;
    while (pos.z < 6 && steps < 1000) {
      const s = integrateStep(pos, vel, -20, dt);
      pos = s.pos; vel = s.vel; steps++;
      apex = Math.max(apex, pos.y);
    }
    expect(apex).toBeGreaterThan(3 + 8); // a high lob, not a straight line
    expect(Math.abs(pos.y - 1)).toBeLessThan(1.0); // semi-implicit Euler drift ~ g t dt / 2 (+ last-step overshoot) only
  });
});

describe('view blend + orientation (UpdateViewPosition @0074d8d0)', () => {
  it('estimate: fixed -> impactTime; free -> horizontal distance / speedHorizontal', () => {
    expect(estimateImpactTime(ZERO, { x: 0, y: 9, z: 6 }, { fixedImpactTime: false, impactTime: 2, speedHorizontal: 2, gravity: -20 })).toBeCloseTo(3);
    expect(estimateImpactTime(ZERO, { x: 9, y: 0, z: 9 }, { fixedImpactTime: true, impactTime: 3, speedHorizontal: 2, gravity: -20 })).toBe(3);
  });

  it('invisible window: enabled before start and after end only', () => {
    expect(isVisibleAt(0.1, 1, 0.5, 0.9)).toBe(true);
    expect(isVisibleAt(0.7, 1, 0.5, 0.9)).toBe(false);
    expect(isVisibleAt(0.95, 1, 0.5, 0.9)).toBe(true);
    expect(isVisibleAt(0.5, 1, 0, 0)).toBe(true);
  });

  it('weight = clamp01(elapsed): partial blend then snap to sim at >= 1 s', () => {
    const sim = { x: 10, y: 4, z: 0 };
    const half = viewStep({ pos: { x: 0, y: 0, z: 0 }, elapsed: 0.5 }, sim);
    expect(half.pos.x).toBeCloseTo(5, 5);
    expect(half.pos.y).toBeCloseTo(2, 5);
    const full = viewStep({ pos: { x: 0, y: 0, z: 0 }, elapsed: 1.5 }, sim);
    expect(full.pos).toEqual(sim);
  });

  it('|sim - view| <= 0.001 keeps the previous rotation', () => {
    const r = viewStep({ pos: { x: 1, y: 1, z: 1 }, elapsed: 2 }, { x: 1.0005, y: 1, z: 1 });
    expect(r.rot).toBeNull();
  });

  it('LookRotation(forward, delta): local +Y follows the XY component of the motion, +Z stays world +Z', () => {
    const rot = (dir: { x: number; y: number; z: number }) => {
      const q = viewStep({ pos: { x: 0, y: 0, z: 0 }, elapsed: 2 }, dir).rot!;
      const Q = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      return { y: new THREE.Vector3(0, 1, 0).applyQuaternion(Q), z: new THREE.Vector3(0, 0, 1).applyQuaternion(Q) };
    };
    const up = rot({ x: 0, y: 5, z: 0 });
    expect(up.y.y).toBeCloseTo(1); // flying up: identity
    const right = rot({ x: 5, y: 0, z: 3 });
    expect(right.y.x).toBeCloseTo(1); // +Y -> +X (z component ignored)
    expect(right.z.z).toBeCloseTo(1);
    const diag = rot({ x: -2, y: 2, z: 7 });
    expect(diag.y.x).toBeCloseTo(-Math.SQRT1_2);
    expect(diag.y.y).toBeCloseTo(Math.SQRT1_2);
    expect(lookRotationForwardZ({ x: 0, y: 0, z: 1 })).toBeNull(); // parallel to forward: undefined
    // mirror to three space: (x,-y,-z,w)
    expect(mirrorQuat4({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 })).toEqual({ x: 0.1, y: -0.2, z: -0.3, w: 0.9 });
  });
});

describe('per-tower projectile prefab data (props bundle)', () => {
  it('every production tower resolves a prefab; cannon/mortar/missile have distinct models', () => {
    const names: Record<string, string | null> = {};
    for (let i = 1; i <= 12; i++) {
      const t = `tower_${String(i).padStart(3, '0')}`;
      const c = projectileContractForTower(t);
      expect(c, t).not.toBeNull();
      names[t] = c!.modelName;
    }
    expect(names.tower_001).toBe('bullet_001_pa');
    expect(names.tower_002).toBe('bullet_002_pa');
    expect(names.tower_010).toBe('bullet_010_pa');
    expect(names.tower_007).toBeNull(); // crossbow arrow: hitscan, no mesh
    expect(names.tower_011).toBeNull();
    const models = new Set([names.tower_001, names.tower_002, names.tower_010]);
    expect(models.size).toBe(3);
    for (const m of models) expect(PROJECTILE_DATA.models[m!]).toBeDefined();
  });

  it('classes -> sim types, serialized tuning', () => {
    const cannon = projectileContractForTower('tower_001')!;
    const arrow = projectileContractForTower('tower_007')!;
    expect(cannon.getGameCoreType()).toBe(GameCoreProjectileTrajectory);
    expect(arrow.getGameCoreType()).toBe(GameCoreProjectileInstant);
    expect(cannon.gravity).toBe(-20);
    expect(cannon.speedHorizontal).toBeCloseTo(2.3, 5);
    expect(cannon.traceTarget).toBe(false);
    expect(arrow.bulletSpeed).toBe(18);
    expect(projectileContract('bullet_002')!.fixedImpactTime).toBe(true);
    expect(projectileContract('missile_bullet')!.traceTarget).toBe(true);
    expect(projectileContract('missile_bullet')!.gravity).toBe(-15);
    // sim collision cylinder comes from the real mesh bounds
    expect(cannon.getComponentInChildrenRenderer().bounds.size.y).toBeCloseTo(0.2697, 3);
  });

  it('effect prefabs: cannon muzzle flash is authored along the barrel (+Z) and replays from the fire-point rotation', () => {
    const node = PROJECTILE_DATA.effects['ef_tower_cannon_fire_pv'];
    const poses = flattenEffect(node, { x: 10, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
    const flash = poses.find((p) => p.emitter === 'ps_tower_cannon_fire_flash')!;
    expect(flash.pos.z).toBeCloseTo(3 + 0.7, 5);
    // fire point yawed 90 deg about Y: the +Z offset moves to +X (Unity LH), emission axis likewise
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const yawed = flattenEffect(node, { x: 0, y: 0, z: 0 }, { x: q.x, y: q.y, z: q.z, w: q.w });
    const f2 = yawed.find((p) => p.emitter === 'ps_tower_cannon_fire_flash')!;
    expect(f2.pos.x).toBeCloseTo(0.7, 4);
    const axis = emissionAxisThree(f2.rot);
    expect(axis.x).toBeCloseTo(-1, 4); // unity +X -> three -X
  });
});

// ---- REAL SIM: cannon vs crossbow ----------------------------------------------------

class LineCurve implements CatmullCurveContract {
  id = 1;
  curveLength = 100;
  curveLengthB4Activation = 2;
  sampleLinearDistance(d: number) { return { x: d, y: 0, z: 0 }; }
  distanceToTime(d: number) { return d / 100; }
  sampleDirect(t: number, s: number) { return { x: t * 100, y: 0, z: s }; }
  sampleVelDirect() { return { x: 1, y: 0, z: 0 }; }
  nodeTimeToDistance(t: number) { return t * 100; }
}
class Target extends GameCoreEnemy {
  hits = 0;
  setup(pos: Vector3): void {
    this.position = pos;
    this.pathMove = new CorePathMove(new LineCurve());
    this.m_distance = f(5);
    this.enemyMoveType = EEnemyMoveTypeDef.ground;
  }
  override tick(): void { /* stationary fixture */ }
  override dealDamage(): void { this.hits++; }
  override dealDamageTyped(): void { this.hits++; }
}

function towerFor(name: string): { tower: GameCoreTower; view: TowerBaseContract } {
  const raw = {
    name, gameObject: { tag: name }, transform: { position: { x: 40, y: 0, z: 40 } },
    nextTargetToAttackIndex: 0, attackType: ETowerAttackDef.all, strengthType: 1, classType: 1,
    balloonAimable: false, attackPower: 10, attackSpeed: 0.5, attackRangeInner: 0, attackSpread: 3,
    costCoin: 50, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 25, refundGem: 0,
    magazineCapacity: -1, rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180, oneShotOneBalloon: false,
    fullRangeFire: true, fireAngleThreshold: 360, attackAttenuations: [], burstCount: 1, burstInterval: 0,
    cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30, cautionRotateAngleMin: 10,
    playerDetectionRange: 2, firePointNames: null,
    projectile: projectileContractForTower(name),
    getComponentTowerUpgradeSetting: () => null, getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null, getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
  } as unknown as TowerBaseContract;
  const tower = new GameCoreTower(name, []);
  tower.position = new Vector3(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, raw);
  tower.initialize();
  return { tower, view: raw };
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
  setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
  unityRandom.InitState(7);
});
afterEach(() => {
  setProjectileViewerFactory(null);
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  resetUnityObjectRegistryForTests();
});

describe('real sim: cannon (tower_001) vs crossbow (tower_007)', () => {
  function fire(towerName: string): { path: { x: number; y: number; z: number }[]; proj: GameCoreProjectile; target: Target; hitTick: number } {
    const target = new Target();
    target.setup(new Vector3(40, 1.9, 45));
    const { tower } = towerFor(towerName);
    tower.setCurrentTarget(target);
    const Type = projectileContractForTower(towerName)!.getGameCoreType();
    const proj = new Type(tower, [target], true);
    let hitTick = -1;
    const cb = () => { if (hitTick < 0) hitTick = path.length; };
    Events.projectileHitEvent.addListener(cb, EventTime.Immediate);
    const path: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 600 && !proj.isDestroyed(); i++) {
      proj.tick();
      path.push({ x: proj.position.x, y: proj.position.y, z: proj.position.z });
    }
    Events.projectileHitEvent.removeListener(cb);
    return { path, proj, target, hitTick };
  }

  it('cannon: ballistic lob (apex far above both endpoints), lands on the target and damages it', () => {
    const { path, target } = fire('tower_001');
    const muzzleY = path[0].y;
    const apex = Math.max(...path.map((p) => p.y));
    expect(apex - muzzleY).toBeGreaterThan(5); // arc, not a line
    // y rises then falls
    const iApex = path.findIndex((p) => p.y === apex);
    expect(iApex).toBeGreaterThan(10);
    expect(iApex).toBeLessThan(path.length - 10);
    // horizontal speed is the serialized speedHorizontal (2.3 u/s), constant
    const dz = path[10].z - path[9].z;
    expect(dz * 60).toBeCloseTo(2.3, 1);
    expect(target.hits).toBeGreaterThanOrEqual(1);
    expect(path[path.length - 1].z).toBeCloseTo(45, 0);
  });

  it('crossbow: hitscan Instant, never leaves the muzzle, hits after bullet-travel time', () => {
    const { path, target, hitTick, proj } = fire('tower_007');
    expect(proj).toBeInstanceOf(GameCoreProjectileInstant);
    for (const p of path) expect(p.y).toBeCloseTo(path[0].y, 5); // no arc, no motion
    expect(target.hits).toBeGreaterThanOrEqual(1);
    // distance ~5 / bulletSpeed 18 = ~0.28 s -> ~16-17 ticks
    expect(hitTick).toBeGreaterThan(12);
    expect(hitTick).toBeLessThan(22);
  });

  it('viewer system gives them different views: model+arc vs model-less hit effect', () => {
    const sys = new ProjectileViewerSystem({
      parent: new THREE.Group(),
      models: new Map([['bullet_001_pa', new THREE.Mesh(new THREE.SphereGeometry(0.14))]]),
      effects: null,
      audio: null,
    });
    setProjectileViewerFactory(sys.factory);
    const a = fire('tower_001');
    const b = fire('tower_007');
    expect(a.proj).toBeInstanceOf(GameCoreProjectileTrajectory);
    expect(b.proj).toBeInstanceOf(GameCoreProjectileInstant);
    const va = getRegisteredUnityObject(a.proj.handle.m_handle) as { object3d: THREE.Object3D | null; className: string };
    const vb = getRegisteredUnityObject(b.proj.handle.m_handle) as { object3d: THREE.Object3D | null; className: string };
    expect(va.className).toBe('ProjectileTrajectory');
    expect(vb.className).toBe('ProjectileInstant');
    expect(va.object3d).not.toBeNull();
    expect(vb.object3d).toBeNull();
  });
});

describe('tower detection volumes (root cause of "crossbow doesn\'t shoot")', () => {
  it('every production tower has its EnemyDetectorViewCone; tower_007 reaches 5+ units where the old sphere stand-in (2.1) did not', () => {
    for (let i = 1; i <= 12; i++) {
      const d = PROJECTILE_DATA.towers[`tower_${String(i).padStart(3, '0')}`].detector;
      expect(d).not.toBeNull();
    }
    const d = PROJECTILE_DATA.towers['tower_007'].detector!;
    expect([d.upperRadius, d.lowerRadius, d.height]).toEqual([4, 5.599999904632568, 17]);
    const t = PROJECTILE_DATA.towers['tower_007'];
    const oldSphere = t.attackSpread + 2.0; // attackRangeInner(2.0) + attackSpread
    expect(oldSphere).toBeLessThan(2.2);
    expect(Math.max(d.upperRadius, d.lowerRadius)).toBeGreaterThan(5);
  });
});

describe('real sim: tower_007 with its real detector cone acquires, aims and fires', () => {
  it('fires projectileLaunchEvent at an enemy 4.5 units away (outside the old 2.1 sphere) and damages it', async () => {
    const { EnemyDetectorCone } = await import('../../src/core/EnemyDetectorCone');
    const { TowerStateIdle } = await import('../../src/core/TowerStateIdle');
    const target = new Target();
    target.setup(new Vector3(40, 0, 44.5));
    const { tower, view } = towerFor('tower_007');
    const d = PROJECTILE_DATA.towers['tower_007'].detector!;
    (view as unknown as { getComponentEnemyDetectorView: () => unknown }).getComponentEnemyDetectorView = () => ({
      createGameCoreDetector: () => new EnemyDetectorCone(new Vector3(d.offset[0], d.offset[1], d.offset[2]), d.upperRadius, d.lowerRadius, d.height, d.affectRangeRate),
    });
    tower.initialize();
    (view as unknown as { attackSpeed: number }).attackSpeed = 0.5;
    let launches = 0;
    Events.projectileLaunchEvent.addListener(() => { launches++; }, EventTime.Immediate);
    tower.setTowerState(new TowerStateIdle(true));
    for (let i = 0; i < 60 * 8; i++) core.tick(1 / 60);
    expect(launches).toBeGreaterThan(0);
    expect(target.hits).toBeGreaterThan(0);
  });
});
