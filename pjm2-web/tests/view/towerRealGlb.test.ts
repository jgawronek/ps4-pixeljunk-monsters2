// tests/view/towerRealGlb.test.ts
// The shipped tower_001.glb driven through the faithful lifecycle: controller
// clips resolve against the baked GLB names, the animator starts in
// BaseLayer.ready_to_fire, the body faces LookRotation(bodyDirection) while the
// cannon aims along fortDirection (world-space joint assignment keeps the bind).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';
import { TowerStageView, type TowerSimSnapshot } from '../../src/view/characters/TowerStageView';
import type { TowerBaseContract } from '../../src/view/q4-contracts';

const GLB_PATH = new URL('../../public/assets/characters/tower_001/tower_001.glb', import.meta.url);

function stubFetch(glb: ArrayBuffer): void {
  vi.stubGlobal('ProgressEvent', class {
    type: string; lengthComputable = false; loaded = 0; total = 0;
    constructor(type: string) { this.type = type; }
  });
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('_ok')) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.endsWith('.glb')) return Promise.resolve(new Response(glb.slice(0)));
    if (/\.(png|webp)$/i.test(url)) return Promise.resolve(new Response(new Uint8Array([0])));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function prefab(): TowerBaseContract {
  return {
    name: 'tower_001', gameObject: null, transform: { position: { x: 0, y: 0, z: 0 } },
    nextTargetToAttackIndex: 0, attackType: 1 as TowerBaseContract['attackType'],
    strengthType: 0 as TowerBaseContract['strengthType'], classType: 3 as TowerBaseContract['classType'],
    balloonAimable: true, attackPower: 25, attackSpeed: 3, attackRangeInner: 6, attackSpread: 0,
    costCoin: 120, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 60, refundGem: 0, magazineCapacity: 3,
    rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 120, rotateSpeedYAcel: 240, rotateSpeedYDecl: 240,
    oneShotOneBalloon: false, fullRangeFire: false, fireAngleThreshold: 45, attackAttenuations: [],
    burstCount: 1, burstInterval: 0, cautionRange: 30, cautionIdleTime: 2, cautionRotateSpeed: 20,
    cautionRotateAngleMin: 10, playerDetectionRange: 2, firePointNames: ['cannonball_default_pos'],
    projectile: null, getComponentTowerUpgradeSetting: () => null, getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null, getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('tower_001 real GLB through the faithful TowerStageView lifecycle', () => {
  it('animator starts in ready_to_fire; body faces bodyDirection; muzzle follows fortDirection', async () => {
    stubFetch(readFileSync(GLB_PATH).buffer as ArrayBuffer);
    const library = new CharacterLibrary('http://char.test/assets/characters/');
    await library.load('tower_001');
    const rig = library.instantiate('tower_001');
    const view = new TowerStageView(prefab(), rig, { x: 40, y: -2, z: 40 }, { x: -0.41066, y: 0, z: -0.91179 });
    let fort = { x: 1, y: 0, z: 0 };
    const snap = (): TowerSimSnapshot => ({
      position: { x: 40, y: 0, z: 40 },
      bodyDirection: { x: -0.41066065430641174, y: 0, z: -0.911788284778595 },
      fortDirection: fort,
      attackSpeed: 3,
      state: { kind: 'idle', stateTime: 0, shootOnSight: false, finalPosition: null },
    });
    view.bindSim(snap);
    view.update(1 / 60);
    view.update(1 / 60);
    expect(view.animatorPath).toBe('BaseLayer.ready_to_fire');
    // body: unity (−0.41, 0, −0.91) → three x mirrored
    const body = new THREE.Vector3(0, 0, 1).applyQuaternion(view.root.quaternion);
    expect(body.x).toBeCloseTo(0.41066, 3);
    expect(body.z).toBeCloseTo(-0.91179, 3);
    // cannon: muzzle forward = fortDirection mirrored (unity +x → three −x)
    const muzzle = view.root.getObjectByName('cannonball_default_pos')!;
    muzzle.updateWorldMatrix(true, false);
    const q = new THREE.Quaternion();
    muzzle.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    // The fort bind pose is captured under the Instantiate rotation Quaternion.Euler(bodyDirection)
    // (≈ −0.41°/−0.91° — the direction vector is fed to Euler AS DEGREES, faithfully), so the
    // muzzle is within ~0.5° of the exact direction, not bit-exact.
    expect(fwd.x).toBeCloseTo(-1, 3);
    expect(Math.abs(fwd.y)).toBeLessThan(0.02);
    // aim 30° up toward unity +z: within tower_001's [-45, 0] limits → exact
    fort = { x: 0, y: Math.tan(Math.PI / 6), z: 1 };
    view.update(1 / 60);
    muzzle.updateWorldMatrix(true, false);
    muzzle.getWorldQuaternion(q);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(Math.abs(up.y - 0.5)).toBeLessThan(0.02);
    // aiming BELOW the horizon is clamped to level (fortAngleMax = 0)
    fort = { x: 0, y: -1, z: 1 };
    view.update(1 / 60);
    muzzle.updateWorldMatrix(true, false);
    muzzle.getWorldQuaternion(q);
    expect(Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(q).y)).toBeLessThan(0.02);
    view.dispose();
  });
});
