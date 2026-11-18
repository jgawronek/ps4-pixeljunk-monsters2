// tests/view/towerTurret.test.ts
// Turret-base fidelity regression for tower_001 (the stage-1 arrow tower).
//
// USER FEEDBACK under test: "the cannons in the original are on turrets" —
// i.e. the cannon/fort must sit ON its turret base, not float without it.
//
// Unlike weapons.test.ts (synthetic rigs), THIS file loads the REAL shipped
// GLB (public/assets/characters/tower_001/tower_001.glb) through the exact
// game path — CharacterLibrary.load → GLTFLoader → SkeletonUtils.clone →
// TowerStageView — and CPU-skins representative vertices to prove where the
// base vs the cannon actually land in world space. Node-only: fetch /
// createImageBitmap / ProgressEvent are stubbed (texture decode is irrelevant
// to the skinning math under test), same policy as loadPerf.test.ts.
//
// DATA cited (never instructions):
//   - prefab tree: .work/asset-scale/tower_001/components.json (visual prefab
//     tower_001_pa → tower_001_comp{Animator,LODGroup} → Root{~112° bind rot}
//     → [door_rot_y, tower_rot_y → tower_rot_x → cannonball_default_pos],
//     plus tower_001_comp_LOD0..4 SkinnedMeshRenderers and flag_pos).
//   - the base/turret body is NOT a separate node: it is part of the single
//     LOD0 skinned mesh, rigid-bound to the Root bone. Verified against the
//     source Unity mesh (structures bundle, mesh pathId -3994325659149967372):
//     4544 verts / 7869 tris, per-bone rigid counts Root=3212 (Y −0.099..2.012),
//     tower_rot_y=233 (Y 1.899..2.462), tower_rot_x=772 (Y 2.117..2.726),
//     door_rot_y=327. Only tower_008/009 have a separate `base` node.
//   - fort joints: decomp/data/structures_TowerBase.json tower_001
//     fortJointNameHorizontal=tower_rot_y / Vertical=tower_rot_x.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';
import { TowerStageView } from '../../src/view/characters/TowerStageView';
import type { TowerBaseContract } from '../../src/view/q4-contracts';

const CHAR_BASE = 'http://char.test/assets/characters/';
const GLB_PATH = new URL('../../public/assets/characters/tower_001/tower_001.glb', import.meta.url);

// Skin joint order in the shipped GLB (skins[0].joints): Root, tower_rot_y,
// tower_rot_x, door_rot_y — matches the SMR m_Bones order in components.json.
const JOINT_ROOT = 0;
const JOINT_YAW = 1;
const JOINT_PITCH = 2;

function stubGlbFetch(glb: ArrayBuffer): void {
  // three's FileLoader streams via ProgressEvent — absent in Node.
  vi.stubGlobal('ProgressEvent', class {
    type: string;
    lengthComputable = false;
    loaded = 0;
    total = 0;
    constructor(type: string, init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
      this.type = type;
      Object.assign(this, init);
    }
  });
  // GLTFLoader.loadImageSource reads `self.URL` — absent in Node.
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('_ok')) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.endsWith('.glb')) return Promise.resolve(new Response(glb.slice(0)));
    // external textures: bytes are irrelevant (createImageBitmap is stubbed)
    if (/\.(png|webp)$/i.test(url)) return Promise.resolve(new Response(new Uint8Array([0])));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function towerPrefab(): TowerBaseContract {
  return {
    name: 'tower_001',
    gameObject: null,
    transform: { position: { x: 0, y: 0, z: 0 } },
    nextTargetToAttackIndex: 0,
    attackType: 1 as TowerBaseContract['attackType'],
    strengthType: 0 as TowerBaseContract['strengthType'],
    classType: 3 as TowerBaseContract['classType'],
    balloonAimable: true,
    attackPower: 25, attackSpeed: 1.5, attackRangeInner: 6, attackSpread: 0,
    costCoin: 120, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 60, refundGem: 0,
    magazineCapacity: 3,
    rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 120, rotateSpeedYAcel: 240, rotateSpeedYDecl: 240,
    oneShotOneBalloon: false, fullRangeFire: false, fireAngleThreshold: 45,
    attackAttenuations: [], burstCount: 1, burstInterval: 0,
    cautionRange: 30, cautionIdleTime: 2, cautionRotateSpeed: 20, cautionRotateAngleMin: 10,
    playerDetectionRange: 2,
    firePointNames: ['cannonball_default_pos'],
    projectile: null,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null,
    getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
  };
}

/** CPU-skin one rigid vertex (weight 1 on `joint`) into world space, using the
 *  same formula three.js uploads to the GPU:
 *    world = mesh.matrixWorld · bindMatrixInverse · (bone.matrixWorld · IBM) · bindMatrix · pos */
function skinnedWorld(mesh: THREE.SkinnedMesh, joint: number, bindPos: THREE.Vector3): THREE.Vector3 {
  mesh.updateWorldMatrix(true, false);
  mesh.skeleton.update();
  const boneMat = new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices, joint * 16);
  const v = bindPos.clone();
  v.applyMatrix4(mesh.bindMatrix);
  v.applyMatrix4(boneMat);
  v.applyMatrix4(mesh.bindMatrixInverse);
  v.applyMatrix4(mesh.matrixWorld);
  return v;
}

/** First vertex whose rigid (slot-0) joint equals `joint`; returns its bind pos. */
function findVertex(mesh: THREE.SkinnedMesh, joint: number): THREE.Vector3 {
  const g = mesh.geometry;
  // GLTFLoader maps glTF POSITION→'position', JOINTS_0→'skinIndex'.
  const pos = g.getAttribute('position');
  const joints = g.getAttribute('skinIndex');
  for (let i = 0; i < pos.count; i++) {
    if (joints.getX(i) === joint) return new THREE.Vector3().fromBufferAttribute(pos, i);
  }
  throw new Error(`no vertex bound to joint ${joint}`);
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (found === null && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  if (found === null) throw new Error('no SkinnedMesh in tower rig');
  return found;
}

async function loadTowerView(): Promise<{ view: TowerStageView; mesh: THREE.SkinnedMesh }> {
  stubGlbFetch(readFileSync(GLB_PATH).buffer as ArrayBuffer);
  const library = new CharacterLibrary(CHAR_BASE);
  await library.load('tower_001');
  const rig = library.instantiate('tower_001');
  const view = new TowerStageView(towerPrefab(), rig, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  return { view, mesh: findSkinnedMesh(view.root) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tower_001 turret base (real GLB, game load path)', () => {
  it('ships a visible LOD0 skinned mesh with the 4-bone fort skeleton', async () => {
    const { view, mesh } = await loadTowerView();
    expect(mesh.name).toBe('tower_001_comp_LOD0');
    expect(mesh.visible).toBe(true);
    // LOD1+ stubs are hidden by CharacterLibrary policy (LOD0 only).
    const lods: Record<string, boolean> = {};
    view.root.traverse((o) => { if (/_LOD\d+$/.test(o.name)) lods[o.name] = o.visible; });
    expect(lods['tower_001_comp_LOD0']).toBe(true);
    expect(lods['tower_001_comp_LOD1']).toBe(false);
    // skeleton = Root, tower_rot_y, tower_rot_x, door_rot_y (SMR m_Bones order)
    expect(mesh.skeleton.bones.map((b) => b.name)).toEqual([
      'Root', 'tower_rot_y', 'tower_rot_x', 'door_rot_y',
    ]);
    view.dispose();
  });

  it('base (Root-bound) skins BELOW the cannon (tower_rot_x-bound) at bind pose', async () => {
    const { view, mesh } = await loadTowerView();
    const baseBind = findVertex(mesh, JOINT_ROOT);
    const cannonBind = findVertex(mesh, JOINT_PITCH);
    const base = skinnedWorld(mesh, JOINT_ROOT, baseBind);
    const cannon = skinnedWorld(mesh, JOINT_PITCH, cannonBind);
    // The turret body must be present and below the cannon — not collapsed to
    // the origin or flown off-axis (the "cannon without a turret" failure).
    expect(base.y).toBeLessThan(cannon.y);
    expect(cannon.y - base.y).toBeGreaterThan(1.0); // ~2.4u tower in the DATA
    // base stays near the tower root height; cannon sits ~2+ units above it.
    expect(base.y).toBeLessThan(1.0);
    expect(cannon.y).toBeGreaterThan(1.5);
    view.dispose();
  });

  it('fort aim rotates the cannon but leaves the turret base fixed', async () => {
    const { view, mesh } = await loadTowerView();
    const baseBind = findVertex(mesh, JOINT_ROOT);
    const cannonBind = findVertex(mesh, JOINT_PITCH);
    const baseBefore = skinnedWorld(mesh, JOINT_ROOT, baseBind);
    const cannonBefore = skinnedWorld(mesh, JOINT_PITCH, cannonBind);
    view.setFortDirection({ x: 1, y: 0, z: 0 }); // unity +x → three −x yaw
    const baseAfter = skinnedWorld(mesh, JOINT_ROOT, baseBind);
    const cannonAfter = skinnedWorld(mesh, JOINT_PITCH, cannonBind);
    // Root is not a fort joint: the base must not move when aiming.
    expect(baseAfter.distanceTo(baseBefore)).toBeLessThan(1e-4);
    // The cannon (yaw+pitch bound) must swing around the turret pivot.
    expect(cannonAfter.distanceTo(cannonBefore)).toBeGreaterThan(0.1);
    // …and it stays attached at the same height band (no vertical detach).
    expect(Math.abs(cannonAfter.y - cannonBefore.y)).toBeLessThan(0.5);
    view.dispose();
  });

  it('fort joints pivot at the turret top (yaw) and within the cannon (pitch)', async () => {
    const { view, mesh } = await loadTowerView();
    view.root.updateWorldMatrix(true, true);
    const yaw = mesh.skeleton.bones[JOINT_YAW];
    const pitch = mesh.skeleton.bones[JOINT_PITCH];
    const yawPos = yaw.getWorldPosition(new THREE.Vector3());
    const pitchPos = pitch.getWorldPosition(new THREE.Vector3());
    // DATA (GLB inverse-bind): yaw pivot ≈ y1.97 (base top ≈2.0), pitch ≈ y2.42.
    expect(yawPos.y).toBeGreaterThan(1.5);
    expect(yawPos.y).toBeLessThan(2.3);
    expect(pitchPos.y).toBeGreaterThan(yawPos.y);
    expect(pitchPos.y).toBeLessThan(2.8);
    view.dispose();
  });
});
