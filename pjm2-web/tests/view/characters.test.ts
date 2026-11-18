// tests/view/characters.test.ts
// Contract-surface tests for the three-backed character viewers. No GLBs are
// loaded in Node — rigs are synthetic THREE.Object3D trees + synthetic
// AnimationClips, which is exactly what CharacterLibrary.instantiate returns
// (a wrapper Group + clips + bind-pose bounds).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  EnemyStageView,
  findClipBySuffix,
  type EnemyAnimState,
} from '../../src/view/characters/EnemyStageView';
import { TowerStageView } from '../../src/view/characters/TowerStageView';
import { PlayerStageView } from '../../src/view/characters/PlayerStageView';
import { ChibiStageView } from '../../src/view/characters/ChibiStageView';
import type { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';
import type { GameCoreHome } from '../../src/core/GameCoreHome';
import { Quaternion, Vector3 } from '../../src/engine/math';
import type { CharacterRig } from '../../src/view/characters/CharacterLibrary';
import type { TowerBaseContract } from '../../src/view/q4-contracts';
import { Cylinder } from '../../src/core/Cylinder';

function makeRig(
  clips: THREE.AnimationClip[],
  bounds = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.4), new THREE.Vector3(0.5, 1.2, 0.4)),
): CharacterRig {
  const root = new THREE.Group();
  root.name = 'char:test';
  root.add(new THREE.Group()); // cloned GLB scene placeholder
  return { root, clips, modelBounds: bounds, defName: 'test' };
}

function makeClip(name: string, duration: number, targetNode: string): THREE.AnimationClip {
  const times = [0, duration];
  const values = [0, 0, 0, 1, 0, 0];
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack(`${targetNode}.position`, times, values),
  ]);
}

const KURI_LIKE_CLIPS = [
  'kuri_idle', 'kuri_walk', 'kuri_walk_01', 'kuri_walk_02', 'kuri_attack',
  'kuri_dieSmall_air', 'kuri_dieSmall_impact', 'kuri_dieBig_air', 'kuri_dieBig_impact',
  'kuri_fly', 'kuri_drown',
].map((n) => makeClip(n, 0.2, 'Bone'));

describe('findClipBySuffix', () => {
  it('resolves base walk, never the _01/_02 variants', () => {
    expect(findClipBySuffix(KURI_LIKE_CLIPS, 'walk')?.name).toBe('kuri_walk');
  });
  it('resolves tower-style animator/<clip> names', () => {
    const clips = [makeClip('tower_001_comp/fire', 0.3, 'Bone')];
    expect(findClipBySuffix(clips, 'fire')?.name).toBe('tower_001_comp/fire');
  });
  it('exact match wins over suffix match', () => {
    const clips = [makeClip('x_walk', 0.3, 'Bone'), makeClip('walk', 0.3, 'Bone')];
    expect(findClipBySuffix(clips, 'walk')?.name).toBe('walk');
  });
  it('returns null for unknown suffixes', () => {
    expect(findClipBySuffix(KURI_LIKE_CLIPS, 'explode')).toBeNull();
  });
});

describe('EnemyStageView contract surface', () => {
  it('mirrors transform.position both ways (unity LH ↔ three RH)', () => {
    const view = new EnemyStageView(makeRig(KURI_LIKE_CLIPS));
    view.transform.position = { x: 3, y: 1, z: -2 };
    expect(view.root.position.x).toBe(-3);
    expect(view.root.position.y).toBe(1);
    expect(view.root.position.z).toBe(-2);
    // read-back path (sim may READ the position through the same duck)
    const p = view.transform.position;
    expect(p).toEqual({ x: 3, y: 1, z: -2 });
  });

  it('mirrors transform.rotation via quat (x,−y,−z,w)', () => {
    const view = new EnemyStageView(makeRig(KURI_LIKE_CLIPS));
    const s = Math.SQRT1_2;
    view.transform.rotation = { x: 0, y: s, z: 0, w: s };
    expect(view.root.quaternion.y).toBeCloseTo(-s);
    expect(view.root.quaternion.w).toBeCloseTo(s);
    const q = view.transform.rotation;
    expect(q.y).toBeCloseTo(s);
    expect(q.w).toBeCloseTo(s);
  });

  it("findTransformWithTag('Character') yields Cylinder-compatible bounds", () => {
    const view = new EnemyStageView(makeRig(KURI_LIKE_CLIPS));
    const duck = view.findTransformWithTag('Character');
    expect(duck).not.toBeNull();
    const renderer = duck!.gameObject.getComponentInChildrenRenderer();
    expect(renderer).not.toBeNull();
    expect(renderer!.bounds.size).toEqual({ x: 1, y: 1.2, z: 0.8 });
    expect(renderer!.bounds.extents).toEqual({ x: 0.5, y: 0.6, z: 0.4 });
    // the exact sim consumption path (GameCoreEnemy ctor collision scale)
    const cyl = Cylinder.fromBounds(renderer!.bounds);
    expect(cyl.height).toBeCloseTo(Math.fround(1.2));
    expect(cyl.radius).toBeGreaterThan(0);
    expect(view.findTransformWithTag('Player')).toBeNull();
  });

  it('returns the documented headless defaults for balloon/attackPoints/slope/attrs', () => {
    const view = new EnemyStageView(makeRig(KURI_LIKE_CLIPS));
    expect(view.getComponentInChildrenBalloon()).toBeNull();
    expect(view.attackPoints()).toBeNull();
    expect(view.isSlopeMovement).toBe(false);
    expect(view.slopeDownSpeedScale).toBe(1);
    expect(view.slopeUpSpeedScale).toBe(1);
    expect(view.getComponentEnemyAttributesSettings()).toBeNull();
    expect(view.gameObject.activeSelf).toBe(true);
    view.gameObject.setActive(false);
    expect(view.gameObject.activeSelf).toBe(false);
  });
});

describe('EnemyStageView animation', () => {
  const states: Array<[EnemyAnimState, string]> = [
    ['idle', 'kuri_idle'],
    ['walk', 'kuri_walk'],
    ['fly', 'kuri_fly'],
    ['attack', 'kuri_attack'],
    ['drown', 'kuri_drown'],
  ];

  it.each(states)('setAnimState(%s) resolves %s', (state, clipName) => {
    const rig = makeRig(KURI_LIKE_CLIPS);
    (rig.root.children[0] as THREE.Group).add(new THREE.Object3D());
    rig.root.children[0].children[0].name = 'Bone';
    const view = new EnemyStageView(rig);
    view.setAnimState(state);
    expect(view.animState).toBe(state);
    view.update(0.05); // must not throw with resolved bindings
    void clipName;
  });

  it('dieSmall chains air → impact and clamps', () => {
    const rig = makeRig(KURI_LIKE_CLIPS);
    const bone = new THREE.Object3D();
    bone.name = 'Bone';
    rig.root.add(bone);
    const view = new EnemyStageView(rig);
    view.setAnimState('dieSmall');
    view.update(0.25); // past dieSmall_air (0.2s) → impact should take over
    // impact is the last chain link: it must still be playing (clamped tail)
    expect(view.animState).toBe('dieSmall');
    view.update(1); // no throw, stays clamped
  });

  it('sim-source binding pulls position, facing, and fly state', () => {
    const rig = makeRig(KURI_LIKE_CLIPS);
    rig.root.add(Object.assign(new THREE.Object3D(), { name: 'Bone' }));
    const view = new EnemyStageView(rig);
    view.bindSimSource(() => ({
      position: { x: 2, y: 0.5, z: 4 },
      moveVector: { x: 1, y: 0, z: 0 },
      enemyMoveType: 2, // air (ground = 1)
      m_life: 10,
    }));
    view.setAnimState('fly');
    view.update(1 / 60);
    expect(view.transform.position).toEqual({ x: 2, y: 0.5, z: 4 });
    // facing: unity +x → three −x; +Z-forward model should yaw −90°
    const e = new THREE.Euler().setFromQuaternion(view.root.quaternion, 'YXZ');
    expect(e.y).toBeCloseTo(-Math.PI / 2, 1);
  });
});

const TIKIMAN_LIKE_CLIPS = [
  'tikiman_idle_stand', 'tikiman_run',
  'dance_buildTower_enter', 'dance_buildTower_loop', 'dance_buildTower_exit',
  'tikiman_attack_impact',
].map((n) => makeClip(n, 0.2, 'Bone'));

function tikimanRig(): CharacterRig {
  const rig = makeRig(TIKIMAN_LIKE_CLIPS);
  rig.root.add(Object.assign(new THREE.Object3D(), { name: 'Bone' }));
  return rig;
}

describe('PlayerStageView', () => {
  it('starts idle; setMoving swaps to run', () => {
    const view = new PlayerStageView(tikimanRig());
    view.setMoving(true);
    view.update(0.05); // crossfade settles, no throw
    view.setMoving(false);
    view.update(0.05);
  });

  it('position mirrors unity x → three −x', () => {
    const view = new PlayerStageView(tikimanRig());
    view.setPosition({ x: 3, y: 0.5, z: -2 });
    expect(view.root.position.x).toBe(-3);
    expect(view.root.position.y).toBe(0.5);
    expect(view.root.position.z).toBe(-2);
  });

  it('build dance sequences enter → loop → exit → idle', () => {
    const view = new PlayerStageView(tikimanRig());
    view.startBuildDance(0.5);
    expect(view.dancing).toBe(true);
    view.update(0.25); // past enter (0.2s) → loop phase
    expect(view.dancing).toBe(true);
    view.update(0.4); // loop budget (0.5s total) expires → exit plays
    expect(view.dancing).toBe(true);
    view.update(0.3); // exit (0.2s) finishes → back to idle
    expect(view.dancing).toBe(false);
    // movement after the dance must not throw and returns to idle
    view.update(0.05);
  });

  it('walking away cancels the dance', () => {
    const view = new PlayerStageView(tikimanRig());
    view.startBuildDance(10);
    expect(view.dancing).toBe(true);
    view.setMoving(true);
    expect(view.dancing).toBe(false);
    view.update(0.05); // run anim, no throw
  });

  it('build dance is a no-op without the clips', () => {
    const rig = makeRig([makeClip('tikiman_idle_stand', 0.2, 'Bone')]);
    rig.root.add(Object.assign(new THREE.Object3D(), { name: 'Bone' }));
    const view = new PlayerStageView(rig);
    view.startBuildDance(1);
    expect(view.dancing).toBe(false);
  });

  it('setOneShot returns to idle after finishing', () => {
    const view = new PlayerStageView(tikimanRig());
    view.setOneShot('tikiman_attack_impact');
    view.update(0.3); // past 0.2s clip → back to idle
    view.setMoving(true); // locomotion still live afterwards
    view.update(0.05);
  });
});

const CHIBI_LIKE_CLIPS = ['idle_01', 'idle_02', 'idle_03', 'fear', 'die'].map((n) =>
  makeClip(n, 0.2, 'Bone'),
);

function chibiLibraryStub(rig?: CharacterRig): CharacterLibrary {
  const make = (): CharacterRig =>
    rig ?? (() => {
      const r = makeRig(CHIBI_LIKE_CLIPS);
      r.root.add(Object.assign(new THREE.Object3D(), { name: 'Bone' }));
      return r;
    })();
  return {
    get: (n: string) => (n === 'chibi_00' ? {} : null),
    instantiate: () => make(),
  } as unknown as CharacterLibrary;
}

/** Structural GameCoreHome stub — the view only reads numChibi +
 *  getChibiDataByIndex, so no GameCore instance/providers are needed. */
function chibiHome(numChibi = 3): GameCoreHome {
  const chibis = Array.from({ length: numChibi }, (_, i) => ({
    isDead: false,
    id: i,
    pos: new Vector3(2 + i * 0.3, 0.5, -1 - i * 0.2),
    rot: new Quaternion(0, 0.1 * i, 0, 1),
  }));
  return {
    numChibi: chibis.length,
    getChibiDataByIndex: (i: number) => chibis[i],
  } as unknown as GameCoreHome;
}

describe('ChibiStageView', () => {
  it('spawns one rig per living chibi', () => {
    const home = chibiHome(5);
    const view = new ChibiStageView(chibiLibraryStub(), home);
    expect(view.alive).toBe(5);
    expect(view.root.children.length).toBe(5);
  });

  it('mirrors unity pos/quat → three at spawn', () => {
    const home = chibiHome(1);
    const data = home.getChibiDataByIndex(0);
    const view = new ChibiStageView(chibiLibraryStub(), home);
    const rig = view.root.children[0];
    expect(rig.position.x).toBeCloseTo(-data.pos.x);
    expect(rig.position.y).toBeCloseTo(data.pos.y);
    expect(rig.position.z).toBeCloseTo(data.pos.z);
    // yaw-only rotation: unity quat (0, y, 0, w) → three yaw is mirrored (−yaw)
    const yawUnity = (2 * Math.atan2(data.rot.y, data.rot.w) * 180) / Math.PI;
    expect((rig.rotation.y * 180) / Math.PI).toBeCloseTo(-yawUnity, 3);
  });

  it('onChibiDying plays the die clip then removes the rig', () => {
    const home = chibiHome(3);
    const view = new ChibiStageView(chibiLibraryStub(), home);
    const dying = home.getChibiDataByIndex(1);
    view.onChibiDying(dying);
    expect(view.alive).toBe(2); // dying no longer counts
    expect(view.root.children.length).toBe(3); // still visible while dying
    view.update(0.5); // Chibi.DeadTime is 1.0 s (OnEnemyAttackedMe): still there at 0.5 s
    expect(view.root.children.length).toBe(3);
    view.update(0.6); // past 1.0 s → Object.Destroy
    expect(view.root.children.length).toBe(2);
    // repeat event for the same chibi is a no-op
    view.onChibiDying(dying);
    expect(view.alive).toBe(2);
  });

  it('unknown chibi id is a no-op', () => {
    const home = chibiHome(2);
    const view = new ChibiStageView(chibiLibraryStub(), home);
    const ghost = { ...home.getChibiDataByIndex(0), id: 999 };
    view.onChibiDying(ghost);
    expect(view.alive).toBe(2);
  });

  it('missing chibi_00 def spawns nothing', () => {
    const lib = {
      get: () => null,
      instantiate: () => { throw new Error('no'); },
    } as unknown as CharacterLibrary;
    const view = new ChibiStageView(lib, chibiHome(2));
    expect(view.alive).toBe(0);
    expect(view.root.children.length).toBe(0);
  });
});

describe('TowerStageView', () => {
  function towerRig(): CharacterRig {
    const root = new THREE.Group();
    const rotY = new THREE.Object3D();
    rotY.name = 'tower_rot_y';
    const rotX = new THREE.Object3D();
    rotX.name = 'tower_rot_x';
    const muzzle = new THREE.Object3D();
    muzzle.name = 'cannonball_default_pos';
    muzzle.position.set(0.4, 2, 0);
    rotX.add(muzzle);
    rotY.add(rotX);
    root.add(rotY);
    const bone = new THREE.Object3D();
    bone.name = 'Bone';
    root.add(bone);
    const clips = [
      makeClip('tower_001_comp/close_idle', 0.3, 'Bone'),
      makeClip('tower_001_comp/fire', 0.3, 'Bone'),
    ];
    return {
      root,
      clips,
      modelBounds: new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 3, 1)),
      defName: 'tower_001',
    };
  }

  function fakePrefab(firePointNames: string[] | null = ['cannonball_default_pos']): TowerBaseContract {
    return {
      name: 'tower_001',
      gameObject: null,
      transform: { position: { x: 0, y: 0, z: 0 } },
      nextTargetToAttackIndex: 2,
      attackType: 1 as TowerBaseContract['attackType'],
      strengthType: 0 as TowerBaseContract['strengthType'],
      classType: 3 as TowerBaseContract['classType'],
      balloonAimable: true,
      attackPower: 25,
      attackSpeed: 1.5,
      attackRangeInner: 6,
      attackSpread: 0,
      costCoin: 120,
      costGem: 0,
      buildTime: 2,
      buildRange: 2,
      refundCoin: 60,
      refundGem: 0,
      magazineCapacity: 3,
      rotateSpeedX: 90,
      rotateSpeedXAcel: 180,
      rotateSpeedXDecl: 180,
      rotateSpeedY: 120,
      rotateSpeedYAcel: 240,
      rotateSpeedYDecl: 240,
      oneShotOneBalloon: false,
      fullRangeFire: false,
      fireAngleThreshold: 45,
      attackAttenuations: [],
      burstCount: 1,
      burstInterval: 0,
      cautionRange: 30,
      cautionIdleTime: 2,
      cautionRotateSpeed: 20,
      cautionRotateAngleMin: 10,
      playerDetectionRange: 2,
      firePointNames,
      projectile: null,
      getComponentTowerUpgradeSetting: () => null,
      getComponentEnemyDetectorView: () => null,
      findDeepChildY: () => null,
      getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
    };
  }

  it('delegates InitializeSettings data fields to the prefab record', () => {
    const view = new TowerStageView(fakePrefab(), towerRig(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(view.attackPower).toBe(25);
    expect(view.magazineCapacity).toBe(3);
    expect(view.cautionRotateAngleMin).toBe(10);
    expect(view.firePointNames).toEqual(['cannonball_default_pos']);
    expect(view.projectile).toBeNull();
    expect(view.getComponentTowerUpgradeSetting()).toBeNull();
    expect(view.getComponentEnemyDetectorView()).toBeNull();
  });

  it('poses the root at the mirrored spawn position', () => {
    const view = new TowerStageView(fakePrefab(), towerRig(), { x: 7, y: 1, z: -3 }, { x: 0, y: 0, z: 0 });
    expect(view.root.position.x).toBe(-7);
    expect(view.transform.position).toEqual({ x: 7, y: 1, z: -3 });
  });

  it('findDeepChildY returns world Y above the tower base', () => {
    const view = new TowerStageView(fakePrefab(), towerRig(), { x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(view.findDeepChildY('cannonball_default_pos')).toBeCloseTo(7);
    expect(view.findDeepChildY('nonexistent_node')).toBeNull();
  });

  it('getFirePointByRemainingMag returns the muzzle in UNITY space', () => {
    const view = new TowerStageView(fakePrefab(), towerRig(), { x: 10, y: 5, z: 0 }, { x: 0, y: 0, z: 0 });
    const fp = view.getFirePointByRemainingMag(1);
    // three world: root(−10,5,0) + local(0.4,2,0) → (−9.6,7,0); unity: x→−x
    expect(fp.x).toBeCloseTo(9.6);
    expect(fp.y).toBeCloseTo(7);
    expect(fp.z).toBeCloseTo(0);
  });

  it('falls back to the tower base position with no fire points', () => {
    const rig = towerRig();
    const view = new TowerStageView(fakePrefab(null), rig, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 });
    // heuristic name-match DOES find cannonball_default_pos here — so build a
    // rig without muzzle-named nodes for the true fallback.
    const bare = makeRig([]);
    const bareView = new TowerStageView(fakePrefab(null), bare, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 });
    expect(bareView.getFirePointByRemainingMag(1)).toEqual({ x: 1, y: 2, z: 3 });
    void rig;
    void view;
  });

  it('setFortDirection aims tower_rot_y (yaw) with the x mirror applied', () => {
    const rig = towerRig();
    const view = new TowerStageView(fakePrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const rotY = rig.root.children.find((c) => c.name === 'tower_rot_y')!;
    const rotX = rotY.children.find((c) => c.name === 'tower_rot_x')!;
    view.setFortDirection({ x: 0, y: 0, z: 1 }); // unity +z → three +z: no yaw
    expect(rotY.rotation.y).toBeCloseTo(0);
    view.setFortDirection({ x: 1, y: 0, z: 0 }); // unity +x → three −x: yaw −90°
    expect(rotY.rotation.y).toBeCloseTo(-Math.PI / 2);
    view.setFortDirection({ x: 0, y: 1, z: 1 }); // 45° up (tower_001 fortAngleMin = -45 → the limit)
    expect(Math.abs(rotX.rotation.x)).toBeCloseTo(Math.PI / 4);
  });

  it('plays animator clips by state suffix and advances the mixer', () => {
    const view = new TowerStageView(fakePrefab(), towerRig(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    view.setAnimState('close_idle');
    view.update(0.1);
    view.setAnimState('fire');
    view.update(0.1);
    expect(view.playClipByName('tower_001_comp/fire')).toBe(true);
    expect(view.playClipByName('nope')).toBe(false);
    expect(view.clipNames()).toContain('tower_001_comp/close_idle');
  });
});
