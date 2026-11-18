// tests/view/towerConstruction.test.ts
// End-to-end tower CONSTRUCTION presentation, driven by the REAL sim
// (TowerHelper.FromTreeToTower → TowerStateBuild → Idle) and the real
// TowerStageView (synthetic rig). Asserts the original's observable sequence
// (Q4.TowerBase.Start/Update/LateUpdate, see docs/TOWER_CONSTRUCTION_ANALYSIS.md):
//   instantiate underground → Start: LookRotation(bodyDirection) → Build:
//   position follows the sim's rise, vibration, ONE looping build effect at the
//   final position, ONE looping build sfx → first non-Build frame: sfx stops,
//   TowerComplete plays, effect StopLoopingThenDestroy, vibration removed →
//   projectile launch recoils the cannon → sell shrinks Y at 7.5/s.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { ETowerAttackDef } from '../../src/core/enums';
import { EnemyDetectorSphere } from '../../src/core/EnemyDetectorSphere';
import { resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import { setSimPhysics, type SimPhysics } from '../../src/core/physics-seam';
import { TowerHelper } from '../../src/core/TowerHelper';
import { TowerStateBuild } from '../../src/core/TowerStateBuild';
import { TowerStateIdle } from '../../src/core/TowerStateIdle';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setDebugCanvasProvider,
  setTowerViewerFactory,
  type NatureTreeViewContract,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';
import type { CharacterRig } from '../../src/view/characters/CharacterLibrary';
import {
  SELL_SHRINK_SPEED,
  TowerStageView,
  type TowerViewEffects,
} from '../../src/view/characters/TowerStageView';
import { towerSimSnapshot } from '../../src/view/characters/towerSimSource';
import { VIBRATION_FACTOR } from '../../src/view/characters/StructureVibration';

const DT = 1 / 60;
const TREE_DIR = { x: -0.41066065430641174, y: 0, z: -0.911788284778595 }; // tree_001 serialized

function makeClip(name: string, duration = 1): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('Bone.position', [0, duration], [0, 0, 0, 0, 0, 0]),
  ]);
}

/** tower_001-shaped rig: Root → tower_rot_y → tower_rot_x → cannonball_default_pos (3 u up). */
function makeRig(): CharacterRig {
  const root = new THREE.Group();
  root.name = 'char:tower_001';
  const bone = new THREE.Object3D();
  bone.name = 'Bone';
  const rootJoint = new THREE.Object3D();
  rootJoint.name = 'Root';
  const yaw = new THREE.Object3D();
  yaw.name = 'tower_rot_y';
  yaw.position.set(0, 2, 0);
  const pitch = new THREE.Object3D();
  pitch.name = 'tower_rot_x';
  const muzzle = new THREE.Object3D();
  muzzle.name = 'cannonball_default_pos';
  muzzle.position.set(0, 1, 0.86);
  pitch.add(muzzle);
  yaw.add(pitch);
  rootJoint.add(yaw);
  root.add(bone, rootJoint);
  const names = ['ready_to_fire', 'fire', 'cool_down', 'reload', 'cool_down_idle', 'close_idle'];
  return {
    root,
    clips: names.map((n) => makeClip(`tower_001_comp/${n}`)),
    modelBounds: new THREE.Box3(),
    defName: 'tower_001',
  };
}

function prefab(): TowerBaseContract {
  return {
    name: 'tower_001',
    gameObject: {},
    transform: { position: { x: 0, y: 0, z: 0 } },
    nextTargetToAttackIndex: 0,
    attackType: ETowerAttackDef.all,
    strengthType: 1, classType: 1, balloonAimable: false,
    attackPower: 10, attackSpeed: 3, attackRangeInner: 1, attackSpread: 0,
    costCoin: 50, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 25, refundGem: 0,
    magazineCapacity: 3,
    rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180,
    oneShotOneBalloon: false, fullRangeFire: true, fireAngleThreshold: 30,
    attackAttenuations: [], burstCount: 1, burstInterval: 0,
    cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30, cautionRotateAngleMin: 10,
    playerDetectionRange: 2,
    firePointNames: ['cannonball_default_pos'],
    projectile: null,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => ({
      createGameCoreDetector: () => new EnemyDetectorSphere(new Vector3(0, 1, 0), 5, 1),
    }),
    findDeepChildY: () => null,
    getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
  };
}

const physicsFake: SimPhysics = {
  linecast: (): RaycastHit | null => null,
  raycast: () => null,
  sphereCast: () => null,
  checkSphere: () => false,
};

function treeViewer(): NatureTreeViewContract {
  return {
    playerDetectionRange: 2,
    towerDirection: { ...TREE_DIR },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: 40, y: 0, z: 40 } },
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

interface Spy {
  buildEffects: Array<{ prefab: string; pos: { x: number; y: number; z: number }; stopped: number }>;
  loops: Array<{ clip: string; stopped: number }>;
  plays: string[];
  bursts: string[];
  effects: TowerViewEffects;
}

function spy(): Spy {
  const s: Spy = {
    buildEffects: [], loops: [], plays: [], bursts: [],
    effects: {},
  };
  s.effects = {
    startBuildEffect: (p, pos) => {
      const rec = { prefab: p, pos: { ...pos }, stopped: 0 };
      s.buildEffects.push(rec);
      return { stop: () => { rec.stopped++; } };
    },
    startLoopSfx: (clip) => {
      const rec = { clip, stopped: 0 };
      s.loops.push(rec);
      return { stop: () => { rec.stopped++; } };
    },
    playSfx: (clip) => { s.plays.push(clip); },
    burstEffect: (p) => { s.bursts.push(p); },
    cameraRight: () => ({ x: 1, y: 0, z: 0 }),
  };
  return s;
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
  setSimPhysics(physicsFake);
});

afterEach(() => {
  setTowerViewerFactory(null);
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setDebugCanvasProvider(() => null);
  resetUnityObjectRegistryForTests();
});

function buildTower(): { tower: GameCoreTower; view: TowerStageView; s: Spy; rig: CharacterRig } {
  const rig = makeRig();
  const spawn: Array<{ pos: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number } }> = [];
  setTowerViewerFactory((p, _h, position, rotationEuler) => {
    spawn.push({ pos: position, rot: rotationEuler });
    return new TowerStageView(p, rig, position, rotationEuler);
  });
  const tree = new GameCoreTree(new Vector3(40, 0, 40));
  registerUnityObject(tree.handle.m_handle, treeViewer());
  const tower = TowerHelper.fromTreeToTower(tree, prefab())!;
  expect(tower).not.toBeNull();
  const view = getRegisteredUnityObject(tower.handle.m_handle) as TowerStageView;
  expect(view).toBeInstanceOf(TowerStageView);
  const s = spy();
  view.bindSim(() => towerSimSnapshot(tower));
  view.bindEffects(s.effects);
  void spawn;
  return { tower, view, s, rig };
}

describe('TowerHelper → viewer factory arguments', () => {
  it('passes Euler ANGLES (= bodyDirection components), not quaternion components', () => {
    const rig = makeRig();
    let got: { x: number; y: number; z: number } | null = null;
    setTowerViewerFactory((p, _h, position, rotationEuler) => {
      got = rotationEuler;
      return new TowerStageView(p, rig, position, rotationEuler);
    });
    const tree = new GameCoreTree(new Vector3(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    TowerHelper.fromTreeToTower(tree, prefab());
    expect(got).toEqual(TREE_DIR); // Quaternion.Euler(bodyDirection) input
  });
});

describe('tower construction presentation (real sim + TowerStageView)', () => {
  it('instantiates underground (pos + down*height), then Start orients to LookRotation(bodyDirection)', () => {
    const { tower, view } = buildTower();
    expect(tower.getTowerState()).toBeInstanceOf(TowerStateBuild);
    // Instantiate(prefab, position + down*height) is evaluated BEFORE tower.Initialize, so it
    // uses the constructor-default height 2.0; Build.Enter then lowers the sim tower by the
    // real fire-point height (3.0057 here) and the first Update pulls the view to it.
    expect(view.transform.position.y).toBeCloseTo(-2, 5);
    expect(tower.position.y).toBeCloseTo(-tower.height, 5);
    expect(tower.height).toBeGreaterThan(3);
    view.update(DT); // first frame → Start + Build position sync
    expect(view.transform.position.y).toBeCloseTo(-tower.height, 2);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(view.root.quaternion);
    // unity facing (−0.41, 0, −0.91) → three x mirrored
    expect(fwd.x).toBeCloseTo(0.41066, 4);
    expect(fwd.z).toBeCloseTo(-0.91179, 4);
    expect(fwd.y).toBeCloseTo(0, 5);
  });

  it('Build: view position follows the sim rise; vibration + ONE effect + ONE loop sfx', () => {
    const { tower, view, s } = buildTower();
    const h = tower.height;
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) { // 1 s of the 2 s build
      tower.tick();
      view.update(DT);
      ys.push(view.root.position.y);
    }
    expect(view.building).toEqual({ vibrating: true, effect: true, sfx: true });
    // rising monotonically from −height toward 0 (sim MoveTowards), roughly halfway at 1 s
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-6);
    expect(ys[ys.length - 1]).toBeGreaterThan(-h);
    expect(ys[ys.length - 1]).toBeLessThan(-0.5);
    expect(ys[ys.length - 1]).toBeCloseTo(-h / 2, 1);
    // x shakes within the vibration factor around the tower's mirrored x (−40)
    expect(Math.abs(view.root.position.x + 40)).toBeLessThanOrEqual(VIBRATION_FACTOR + 1e-6);
    // exactly one build effect at the FINAL (ground) unity position, one looping sfx
    expect(s.buildEffects.length).toBe(1);
    expect(s.buildEffects[0].prefab).toBe('ef_tower_common_build_pv');
    expect(s.buildEffects[0].pos.x).toBeCloseTo(40, 4);
    expect(s.buildEffects[0].pos.y).toBeCloseTo(0, 4);
    expect(s.buildEffects[0].pos.z).toBeCloseTo(40, 4);
    expect(s.loops.map((l) => l.clip)).toEqual(['sfx_tower_buildtower']);
    expect(s.plays).toEqual([]); // no completion sting yet
  });

  it('first non-Build frame: loop sfx stops, TowerComplete plays once, effect stops once, vibration gone', () => {
    const { tower, view, s } = buildTower();
    for (let i = 0; i < 200; i++) { tower.tick(); view.update(DT); }
    expect(tower.getTowerState()).not.toBeInstanceOf(TowerStateBuild);
    expect(view.building).toEqual({ vibrating: false, effect: false, sfx: false });
    expect(s.loops[0].stopped).toBe(1);
    expect(s.buildEffects[0].stopped).toBe(1);
    expect(s.plays).toEqual(['sfx_tower_buildcomplete']);
    // snapped exactly to the final position (no residual shake)
    expect(view.root.position.x).toBeCloseTo(-40, 5);
    expect(view.root.position.y).toBeCloseTo(0, 5);
    expect(view.root.position.z).toBeCloseTo(40, 5);
    // more frames never re-trigger
    for (let i = 0; i < 30; i++) { tower.tick(); view.update(DT); }
    expect(s.plays.length).toBe(1);
    expect(s.buildEffects.length).toBe(1);
  });

  it('fort aims along fortDirection after build and projectileLaunch recoils the cannon (recoil 0.25 @1 u/s)', () => {
    const { tower, view, rig } = buildTower();
    for (let i = 0; i < 200; i++) { tower.tick(); view.update(DT); }
    const pitch = rig.root.getObjectByName('tower_rot_x')!;
    const rest = pitch.position.clone();
    view.onFire();
    // pulled back 0.25 along its local forward
    expect(pitch.position.distanceTo(rest)).toBeCloseTo(0.25, 5);
    view.update(0.1);
    expect(pitch.position.distanceTo(rest)).toBeCloseTo(0.15, 4); // recovers at 1 unit/s
    view.update(0.2);
    expect(pitch.position.distanceTo(rest)).toBeCloseTo(0, 5);
  });

  it('OnFire drives the tower Animator: ready_to_fire → fire', () => {
    const { tower, view } = buildTower();
    for (let i = 0; i < 200; i++) { tower.tick(); view.update(DT); }
    // A fresh Idle(true) is shoot-on-sight → TowerAnimator.UpdateFiring would clear OnReady every
    // frame; a real shot comes from the Attack state. Park in Idle(false) with a fresh timer.
    tower.setTowerState(new TowerStateIdle(false));
    tower.tick();
    view.update(DT);
    expect(view.animatorPath).toBe('BaseLayer.ready_to_fire');
    view.onFire();
    view.update(DT);
    view.update(DT);
    expect(view.animatorPath).toBe('BaseLayer.fire');
  });

  it('upgrade: TowerUpgrade sting, or TowerFinalUpgrade when there is no next level (OnUpgrade @0054b520)', () => {
    const { view, s } = buildTower();
    view.onUpgrade(true);
    view.onUpgrade(false);
    expect(s.plays).toEqual(['sfx_tower_levelup', 'sfx_tower_levelcomplete']);
  });

  it('sell: scrap effect once, then Y squash at 7.5/s until finished', () => {
    const { tower, view, s } = buildTower();
    for (let i = 0; i < 200; i++) { tower.tick(); view.update(DT); }
    tower.destroySelf();
    view.beginSell();
    view.beginSell(); // idempotent
    expect(s.bursts).toEqual(['ef_tower_common_scrap_pv']);
    view.update(0.05);
    expect(view.root.scale.y).toBeCloseTo(1 - 0.05 * SELL_SHRINK_SPEED, 5);
    expect(view.root.scale.x).toBe(1);
    expect(view.root.scale.z).toBe(1);
    expect(view.finished).toBe(false);
    for (let i = 0; i < 20; i++) view.update(0.02);
    expect(view.finished).toBe(true);
    expect(view.root.visible).toBe(false);
  });
});
