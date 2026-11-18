// tests/view/weapons.test.ts
// Regression tests for the weapons/orientation/animation cluster:
//   - tower fort aim under the Unity→three x-mirror (muzzle-world-direction
//     assertions incl. the GLB bind-pose bug and the ClampDirection pitch limits;
//     the pure math is in towerFort.test.ts),
//   - enemy quat mirror + path facing,
//   - ProjectileView orientation/pooling,
//   - tower attack clip-name resolution against recorded manifest names.
// No GLBs are loaded — synthetic rigs/clips only (same policy as
// tests/view/characters.test.ts). Recorded clip lists come from
// public/assets/characters/manifest.json; fort joint names from
// decomp/data/structures_TowerBase.json (DATA, cited in the sources).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TowerStageView,
  towerAttackClipName,
  type TowerAnimState,
} from '../../src/view/characters/TowerStageView';
import { EnemyStageView, mirrorQuat } from '../../src/view/characters/EnemyStageView';
import { ProjectileView, orientAlong } from '../../src/view/characters/ProjectileView';
import type { CharacterRig } from '../../src/view/characters/CharacterLibrary';
import type { TowerBaseContract } from '../../src/view/q4-contracts';

const S = Math.SQRT1_2;

function makeClip(name: string, duration = 0.2): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('Bone.position', [0, duration], [0, 0, 0, 0, 0, 0]),
  ]);
}

function makeRig(clips: THREE.AnimationClip[], defName = 'test'): CharacterRig {
  const root = new THREE.Group();
  root.name = `char:${defName}`;
  const bone = new THREE.Object3D();
  bone.name = 'Bone';
  root.add(bone);
  return {
    root,
    clips,
    modelBounds: new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.4), new THREE.Vector3(0.5, 1.2, 0.4)),
    defName,
  };
}

/** Tower rig with a measurable muzzle. `swapped` builds the tower_006
 *  hierarchy (pitch joint is the PARENT of the yaw joint). `rootBind` /
 *  `yawBind` reproduce tower_001's scrambled GLB bind pose: Root carries a
 *  ~112° rotation cancelled by tower_rot_y's local bind rotation. */
function towerRig(opts: {
  clips?: THREE.AnimationClip[];
  swapped?: boolean;
  rootBind?: THREE.Quaternion;
  yawBind?: THREE.Quaternion;
  muzzles?: string[];
} = {}): { rig: CharacterRig; muzzle: THREE.Object3D; yaw: THREE.Object3D; pitch: THREE.Object3D } {
  const rig = makeRig(opts.clips ?? [makeClip('tower_001_comp/fire')], 'tower_001');
  const rootJoint = new THREE.Object3D();
  rootJoint.name = 'Root';
  if (opts.rootBind) rootJoint.quaternion.copy(opts.rootBind);
  const yaw = new THREE.Object3D();
  yaw.name = 'tower_rot_y';
  if (opts.yawBind) yaw.quaternion.copy(opts.yawBind);
  const pitch = new THREE.Object3D();
  pitch.name = 'tower_rot_x';
  const muzzle = new THREE.Object3D();
  muzzle.name = opts.muzzles?.[0] ?? 'cannonball_default_pos';
  muzzle.position.set(0, 0, 0.86);
  if (opts.swapped) {
    yaw.add(muzzle); // tower_006: Root → tower_rot_x → tower_rot_y → muzzle
    pitch.add(yaw);
    rootJoint.add(pitch);
  } else {
    pitch.add(muzzle); // tower_001: Root → tower_rot_y → tower_rot_x → muzzle
    yaw.add(pitch);
    rootJoint.add(yaw);
  }
  rig.root.add(rootJoint);
  return { rig, muzzle, yaw, pitch };
}

function fakeTowerPrefab(overrides: Partial<TowerBaseContract> = {}): TowerBaseContract {
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
    firePointNames: ['cannonball_default_pos'],
    projectile: null,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null,
    getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
    ...overrides,
  };
}

/** World-space +Z direction of a node (its "forward"). */
function worldForward(node: THREE.Object3D): THREE.Vector3 {
  node.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion();
  node.getWorldQuaternion(q);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(q);
}

function expectVec(v: THREE.Vector3, x: number, y: number, z: number): void {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
}

// ---- 2. tower fort aim regression ---------------------------------------------

describe('TowerStageView fort aim (UpdateFortViewRotation port)', () => {
  it('aims the muzzle at the mirrored direction in all four quadrants', () => {
    const { rig, muzzle } = towerRig();
    const view = new TowerStageView(fakeTowerPrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const cases: Array<[{ x: number; y: number; z: number }, number, number, number]> = [
      [{ x: 1, y: 0, z: 0 }, -1, 0, 0], // unity +x → three −x
      [{ x: -1, y: 0, z: 0 }, 1, 0, 0],
      [{ x: 0, y: 0, z: 1 }, 0, 0, 1],
      [{ x: 0, y: 0, z: -1 }, 0, 0, -1],
      [{ x: 1, y: 0, z: 1 }, -S, 0, S],
      [{ x: -1, y: 0, z: -1 }, S, 0, -S],
    ];
    for (const [dir, ex, ey, ez] of cases) {
      view.setFortDirection(dir);
      expectVec(worldForward(muzzle), ex, ey, ez);
    }
  });

  it('pitch raises the muzzle with the correct three sign and ClampDirection limits it', () => {
    // tower_001 data: fortAngleMin -45 / fortAngleMax 0 → up to 45° UP, never below the horizon.
    const { rig, muzzle, pitch } = towerRig();
    const view = new TowerStageView(fakeTowerPrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    view.setFortDirection({ x: 0, y: 1, z: 1 }); // unity up-forward, exactly 45° (limit)
    expectVec(worldForward(muzzle), 0, S, S);
    expect(pitch.rotation.x).toBeLessThan(0); // three +X rotation tilts +Z DOWN
    view.setFortDirection({ x: 0, y: -1, z: 1 }); // aiming 45° DOWN → clamped to the horizon
    expectVec(worldForward(muzzle), 0, 0, 1);
    // Straight up: flat = Normalize((0,0,0)) = 0 → ClampDirection returns the ZERO vector
    // (AngleAxis(·, zero axis) * zero) → the vertical joint is NOT reassigned: it holds.
    view.setFortDirection({ x: 0, y: 1, z: 0 });
    expectVec(worldForward(muzzle), 0, 0, 1);
  });

  it('preserves scrambled GLB bind rotations (tower_001 Root compensation)', () => {
    // Real tower_001 bind data: Root R ≈ (−0.435,−0.445,0.547,0.560),
    // tower_rot_y local bind = its conjugate → bind WORLD rotation identity.
    const rootBind = new THREE.Quaternion(-0.43484965, -0.44509584, 0.54704958, 0.55993956);
    const yawBind = new THREE.Quaternion(0.43484965, 0.44509584, -0.54704958, 0.55993956);
    const { rig, muzzle, yaw } = towerRig({ rootBind, yawBind });
    const view = new TowerStageView(fakeTowerPrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    // Neutral aim (unity +z) must hold the bind pose: muzzle faces +Z.
    view.setFortDirection({ x: 0, y: 0, z: 1 });
    expectVec(worldForward(muzzle), 0, 0, 1);
    // The yaw joint's LOCAL rotation must still contain the bind compensation
    // (a bare rotation.y assignment would have destroyed it).
    expect(yaw.quaternion.dot(yawBind)).toBeCloseTo(1, 4);
    // And aiming unity +x still faces three −x exactly.
    view.setFortDirection({ x: 1, y: 0, z: 0 });
    expectVec(worldForward(muzzle), -1, 0, 0);
    view.setFortDirection({ x: 1, y: 1, z: 1 });
    expectVec(worldForward(muzzle), -1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3));
  });

  it('assigns joints BY DATA SLOT (tower_006: horizontal=tower_rot_x, vertical=tower_rot_y)', () => {
    // structures_TowerBase.json tower_006 has the names swapped; the original assigns
    // the flat yaw to the horizontal SLOT and the clamped full aim to the vertical SLOT.
    // fortAngleMin/Max = ∓25, so a 35.26° elevation clamps to 25°.
    const { rig, muzzle } = towerRig({ swapped: true });
    const view = new TowerStageView(
      fakeTowerPrefab({ name: 'tower_006' }), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    );
    view.setFortDirection({ x: 1, y: 1, z: 1 });
    const e = (25 * Math.PI) / 180;
    const flat = Math.cos(e) / Math.SQRT2;
    expectVec(worldForward(muzzle), -flat, Math.sin(e), flat);
    view.setFortDirection({ x: 0, y: 0, z: 1 });
    expectVec(worldForward(muzzle), 0, 0, 1);
  });

  it('does not code-aim towers whose data names no fort joints (tower_002)', () => {
    // structures_TowerBase.json: tower_002 fortJointName* are EMPTY — the
    // original InitFort finds nothing; fort motion is baked into the clips.
    const { rig, yaw } = towerRig();
    const view = new TowerStageView(
      fakeTowerPrefab({ name: 'tower_002' }), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
    );
    view.setFortDirection({ x: 1, y: 0, z: 0 });
    expect(yaw.quaternion.x).toBe(0);
    expect(yaw.quaternion.y).toBe(0);
    expect(yaw.quaternion.z).toBe(0);
    expect(yaw.quaternion.w).toBe(1);
  });

  it('zero direction is a no-op (original magnitude epsilon guard)', () => {
    const { rig, muzzle } = towerRig();
    const view = new TowerStageView(fakeTowerPrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    view.setFortDirection({ x: 1, y: 0, z: 0 });
    view.setFortDirection({ x: 0, y: 0, z: 0 });
    expectVec(worldForward(muzzle), -1, 0, 0); // holds the last aim
  });
});

// ---- 3. enemy orientation ------------------------------------------------------

describe('EnemyStageView orientation', () => {
  it('mirrors sim quats (x,−y,−z,w): unity yaw +90° → three yaw −90°', () => {
    const view = new EnemyStageView(makeRig([makeClip('kuri_walk')]));
    view.transform.rotation = { x: 0, y: S, z: 0, w: S }; // unity yaw +90°
    expect(view.root.quaternion.y).toBeCloseTo(-S);
    expect(view.root.quaternion.w).toBeCloseTo(S);
    const e = new THREE.Euler().setFromQuaternion(view.root.quaternion, 'YXZ');
    expect(e.y).toBeCloseTo(-Math.PI / 2);
    // read-back returns the unity quat unchanged (self-inverse mirror)
    expect(view.transform.rotation).toEqual({ x: 0, y: S, z: 0, w: S });
    expect(mirrorQuat(mirrorQuat({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 }))).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
  });

  it('faces along the mirrored path direction (+Z-forward rigs)', () => {
    const view = new EnemyStageView(makeRig([makeClip('kuri_walk')]));
    view.bindSimSource(() => ({
      position: { x: 2, y: 0.5, z: 4 },
      moveVector: { x: 1, y: 0, z: 0 }, // unity +x travel
      m_life: 10,
    }));
    view.update(1 / 60);
    const e = new THREE.Euler().setFromQuaternion(view.root.quaternion, 'YXZ');
    expect(e.y).toBeCloseTo(-Math.PI / 2); // three −x facing
    expectVec(worldForward(view.root), -1, 0, 0);
  });

  it('facing stays correct under a transformed parent (world-space lookAt)', () => {
    const parent = new THREE.Group();
    parent.position.set(10, 0, 5);
    parent.rotation.y = Math.PI / 2;
    const view = new EnemyStageView(makeRig([makeClip('kuri_walk')]));
    parent.add(view.root);
    view.bindSimSource(() => ({
      position: { x: 2, y: 0.5, z: 4 },
      moveVector: { x: 0, y: 0, z: -1 }, // unity −z travel → three −z
      m_life: 10,
    }));
    view.update(1 / 60);
    expectVec(worldForward(view.root), 0, 0, -1);
  });
});

// ---- 4. projectile orientation + pooling ---------------------------------------

describe('orientAlong', () => {
  const up = new THREE.Vector3(0, 1, 0);
  it('maps the arrow +Y axis onto each three axis', () => {
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 0, y: 0, z: 1 })), 0, 0, 1);
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 0, y: 0, z: -1 })), 0, 0, -1);
    expectVec(up.clone().applyQuaternion(orientAlong({ x: -1, y: 0, z: 0 })), -1, 0, 0);
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 1, y: 0, z: 0 })), 1, 0, 0);
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 0, y: -1, z: 0 })), 0, -1, 0);
    // dir +Z is Rx(+90°)
    const qz = orientAlong({ x: 0, y: 0, z: 1 });
    expect(qz.x).toBeCloseTo(S);
    expect(qz.w).toBeCloseTo(S);
  });
  it('normalizes non-unit input and falls back to identity for zero dir', () => {
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 0, y: 0, z: 7 })), 0, 0, 1);
    const q0 = orientAlong({ x: 0, y: 0, z: 0 });
    expect(q0.equals(new THREE.Quaternion())).toBe(true);
    expectVec(up.clone().applyQuaternion(orientAlong({ x: 1e-9, y: 0, z: 0 })), 0, 1, 0);
  });
});

describe('ProjectileView', () => {
  const rec = (id: number, position: { x: number; y: number; z: number }, extra: object = {}) => ({
    handle: { m_handle: id },
    position,
    ...extra,
  });

  it('mirrors position and orients along mirrored velocity', () => {
    const scene = new THREE.Group();
    const view = new ProjectileView(scene);
    view.sync([rec(1, { x: 3, y: 1, z: -2 }, { velocity: { x: 1, y: 0, z: 0 } })], 1 / 60);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBe(-3);
    expect(mesh.position.y).toBe(1);
    expect(mesh.position.z).toBe(-2);
    // unity velocity +x → three −x: arrow +Y axis points −x
    expectVec(new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion), -1, 0, 0);
    view.dispose();
  });

  it('falls back to the position delta when no velocity/rotation (original path)', () => {
    const scene = new THREE.Group();
    const view = new ProjectileView(scene);
    view.sync([rec(1, { x: 0, y: 0, z: 0 })], 1 / 60); // spawn: identity
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.quaternion.equals(new THREE.Quaternion())).toBe(true);
    view.sync([rec(1, { x: 0, y: 0.5, z: 1 })], 1 / 60); // unity delta (0,.5,1), normalized
    expectVec(new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion), 0, 1 / Math.sqrt(5), 2 / Math.sqrt(5));
    view.dispose();
  });

  it('prefers a sim rotation, mirrored (x,−y,−z,w), over velocity', () => {
    const scene = new THREE.Group();
    const view = new ProjectileView(scene);
    view.sync([rec(1, { x: 0, y: 0, z: 0 }, {
      rotation: { x: 0, y: S, z: 0, w: S }, // unity yaw +90°
      velocity: { x: 0, y: 0, z: 1 },
    })], 1 / 60);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.quaternion.y).toBeCloseTo(-S); // three yaw −90°
    expect(mesh.quaternion.w).toBeCloseTo(S);
    view.dispose();
  });

  it('pools by handle: add, remove when gone, re-add, dispose', () => {
    const scene = new THREE.Group();
    const view = new ProjectileView(scene);
    view.sync([rec(1, { x: 0, y: 0, z: 0 }), rec(2, { x: 1, y: 0, z: 0 })], 1 / 60);
    expect(view.count).toBe(2);
    expect(scene.children.length).toBe(2);
    view.sync([rec(2, { x: 2, y: 0, z: 0 })], 1 / 60); // handle 1 destroyed
    expect(view.count).toBe(1);
    expect(scene.children.length).toBe(1);
    expect((scene.children[0] as THREE.Mesh).position.x).toBe(-2);
    view.sync([], 1 / 60);
    expect(view.count).toBe(0);
    expect(scene.children.length).toBe(0);
    view.sync([rec(1, { x: 5, y: 0, z: 0 })], 1 / 60); // handle reuse → fresh mesh
    expect(view.count).toBe(1);
    expect((scene.children[0] as THREE.Mesh).position.x).toBe(-5);
    view.dispose();
    expect(scene.children.length).toBe(0);
    expect(view.count).toBe(0);
  });
});

// ---- 5. attack clip resolution --------------------------------------------------

describe('towerAttackClipName (manifest-recorded resolution)', () => {
  // Recorded from public/assets/characters/manifest.json (animator clips only).
  const TOWER_010_CLIPS = [
    'tower_010_comp/ready_to_fire_01', 'tower_010_comp/fire_01',
    'tower_010_comp/cool_down_01', 'tower_010_comp/reload_01',
    'tower_010_comp/ready_to_fire_02', 'tower_010_comp/fire_02',
    'tower_010_comp/cool_down_02', 'tower_010_comp/reload_02',
    'tower_010_comp/ready_to_fire_03', 'tower_010_comp/fire_03',
    'tower_010_comp/cool_down_03', 'tower_010_comp/reload_03',
  ];
  const TOWER_011_CLIPS = [
    'tower_011_comp/ready_to_fire', 'tower_011_comp/fire',
    'tower_011_comp/cool_down', 'tower_011_comp/reload',
    'tower_011_comp/coll_down_idle', // FAITHFUL QUIRK: original typo
  ];

  it('resolves standard fire/cool_down/reload names (never "attack")', () => {
    expect(towerAttackClipName('tower_001', 'fire')).toBe('tower_001_comp/fire');
    expect(towerAttackClipName('tower_001', 'cool_down')).toBe('tower_001_comp/cool_down');
    expect(towerAttackClipName('tower_001', 'reload')).toBe('tower_001_comp/reload');
    expect(towerAttackClipName('tower_001', 'fire', ['tower_001_comp/fire'])).toBe('tower_001_comp/fire');
  });

  it('resolves tower_011 coll_down_idle typo and tower_010 numbered variants', () => {
    expect(towerAttackClipName('tower_011', 'cool_down_idle')).toBe('tower_011_comp/coll_down_idle');
    expect(towerAttackClipName('tower_011', 'cool_down_idle', TOWER_011_CLIPS)).toBe('tower_011_comp/coll_down_idle');
    expect(towerAttackClipName('tower_010', 'fire')).toBe('tower_010_comp/fire_01');
    expect(towerAttackClipName('tower_010', 'fire', TOWER_010_CLIPS)).toBe('tower_010_comp/fire_01');
    expect(towerAttackClipName('tower_010', 'ready_to_fire', TOWER_010_CLIPS)).toBe('tower_010_comp/ready_to_fire_01');
    // generic variant scan for unrecorded defs
    expect(towerAttackClipName('tower_x', 'fire', ['tower_x_comp/fire_03'])).toBe('tower_x_comp/fire_03');
  });

  it('returns null for states a tower does not bake', () => {
    expect(towerAttackClipName('tower_008', 'reload')).toBeNull(); // only fire + cool_down_idle
    expect(towerAttackClipName('tower_008', 'fire')).toBe('tower_008_comp/fire');
    expect(towerAttackClipName('tower_012', 'close_idle')).toBeNull(); // muzzle_* unmapped
    expect(towerAttackClipName('tower_005', 'fire')).toBeNull(); // only "Take 001"
    expect(towerAttackClipName('tower_001', 'reload', ['tower_001_comp/fire'])).toBeNull();
    // unknown def assumes standard naming
    expect(towerAttackClipName('tower_999', 'fire')).toBe('tower_999_comp/fire');
  });

  it('TowerStageView.setAnimState plays the resolved clips', () => {
    const rig10 = towerRig({ clips: TOWER_010_CLIPS.map((n) => makeClip(n)) }).rig;
    const view10 = new TowerStageView(fakeTowerPrefab({ name: 'tower_010' }), rig10, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    view10.setAnimState('fire');
    expect(view10.animState).toBe('fire'); // old suffix logic never matched fire_01
    view10.update(0.1);
    const rig11 = towerRig({ clips: TOWER_011_CLIPS.map((n) => makeClip(n)) }).rig;
    const view11 = new TowerStageView(fakeTowerPrefab({ name: 'tower_011' }), rig11, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    view11.setAnimState('cool_down_idle');
    expect(view11.animState).toBe('cool_down_idle'); // old logic missed coll_down_idle
    view11.setAnimState('reload');
    expect(view11.animState).toBe('reload');
    // a state the tower does not bake leaves the current state untouched
    view11.setAnimState('close_idle' as TowerAnimState);
    expect(view11.animState).toBe('reload');
  });
});

// ---- 6. fire point selection -----------------------------------------------------

describe('getFirePointByRemainingMag (verified @00548640)', () => {
  it('cycles muzzles by spent rounds: (capacity − mag) % count', () => {
    const { rig } = towerRig({ muzzles: ['bullet3'] });
    // add two more muzzles in DATA order (tower_010: bullet3, bullet1, bullet2)
    const rootJoint = rig.root.children.find((c) => c.name === 'Root')!;
    const b1 = new THREE.Object3D();
    b1.name = 'bullet1';
    b1.position.set(0.2, 0, 0.86);
    const b2 = new THREE.Object3D();
    b2.name = 'bullet2';
    b2.position.set(0.3, 0, 0.86);
    rootJoint.add(b1, b2);
    const prefab = fakeTowerPrefab({
      name: 'tower_010',
      magazineCapacity: 3,
      firePointNames: ['bullet3', 'bullet1', 'bullet2'],
    });
    const view = new TowerStageView(prefab, rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    // bullet3 local x=0 (muzzle default), bullet1 x=0.2, bullet2 x=0.3;
    // unity read-back mirrors x.
    expect(view.getFirePointByRemainingMag(3).x).toBeCloseTo(0); // spent 0 → bullet3
    expect(view.getFirePointByRemainingMag(2).x).toBeCloseTo(-0.2); // spent 1 → bullet1
    expect(view.getFirePointByRemainingMag(1).x).toBeCloseTo(-0.3); // spent 2 → bullet2
    expect(view.getFirePointByRemainingMag(0).x).toBeCloseTo(0); // spent 3 % 3 → bullet3
  });
});
