// tests/view/pickupView.test.ts
// Contract-surface tests for PickupView. No GLBs are loaded in Node —
// templates are synthetic THREE.Object3D trees (exactly what GLTFLoader
// hands back: a scene Group with mesh-bearing children), plus null-asset
// fallback checks. Motion constants verified against decomp evidence cited
// in the PickupView header (Q4.PickupCurrency.Update @0x3E2A30 spin,
// Awake @0x3E2950 random yaw, PickupMovement.rotateSpeed = −180 deg/s).

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PickupView, handlePhase, type PickupLike } from '../../src/view/pickups/PickupView';
import { EInventoryType } from '../../src/core/GameCoreInventory';

const f = Math.fround;
/** three-space spin: unity −180°/s mirrored → +π rad/s. */
const SPIN = f(Math.PI);

function pickup(handle: number, type: EInventoryType, x = 0, y = 0, z = 0): PickupLike {
  return { handle: { m_handle: handle }, position: { x, y, z }, inventoryType: type };
}

/** Fake GLB scene: root + LOD0 mesh + LOD1 stub (must be hidden by prepare). */
function makeTemplate(name: string): THREE.Group {
  const scene = new THREE.Group();
  scene.name = `${name}_pa`;
  const comp = new THREE.Group();
  comp.name = `${name}_comp`;
  const lod0 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), new THREE.MeshStandardMaterial());
  lod0.name = `${name}_comp_LOD0`;
  const lod1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), new THREE.MeshStandardMaterial());
  lod1.name = `${name}_comp_LOD1`;
  comp.add(lod0, lod1);
  scene.add(comp);
  return scene;
}

function makeView(coin: THREE.Object3D | null = makeTemplate('coin_001'),
                  gem: THREE.Object3D | null = makeTemplate('gem_001')) {
  const root = new THREE.Group();
  const view = new PickupView(root, { coinScene: coin, gemScene: gem });
  return { root, view };
}

/** The wrapper group PickupView adds for a handle. */
function wrapper(root: THREE.Group, handle: number): THREE.Object3D {
  const node = root.getObjectByName(`pickup:${handle}`);
  expect(node).toBeDefined();
  return node!;
}

/** First mesh inside a wrapper (the cloned/fallback inner). */
function innerMesh(node: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  node.traverse((o) => {
    if (found === null && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  expect(found).not.toBeNull();
  return found!;
}

describe('PickupView pooling by handle', () => {
  it('adds one wrapper per pickup and removes clones when pickups disappear', () => {
    const { root, view } = makeView();
    view.sync([pickup(1, EInventoryType.Coin), pickup(2, EInventoryType.Gem)], 0.016, 0);
    expect(root.children.length).toBe(2);
    // handle 2 collected → its clone is removed; handle 1 stays (same node).
    const before = wrapper(root, 1);
    view.sync([pickup(1, EInventoryType.Coin)], 0.016, 0.016);
    expect(root.children.length).toBe(1);
    expect(wrapper(root, 1)).toBe(before);
    expect(root.getObjectByName('pickup:2')).toBeUndefined();
    // everything gone (e.g. stage teardown of drops)
    view.sync([], 0.016, 0.032);
    expect(root.children.length).toBe(0);
    view.dispose();
  });

  it('re-spawned handle gets a fresh wrapper with the same deterministic phase', () => {
    const { root, view } = makeView();
    view.sync([pickup(7, EInventoryType.Coin)], 0, 0);
    const firstYaw = wrapper(root, 7).rotation.y;
    view.sync([], 0.016, 0.016);
    view.sync([pickup(7, EInventoryType.Coin)], 0, 0.5);
    expect(wrapper(root, 7).rotation.y).toBe(firstYaw); // age reset → Awake yaw again
    view.dispose();
  });
});

describe('PickupView mirror math', () => {
  it('mirrors sim position x→−x, keeps y/z (Unity LH → three RH)', () => {
    const { root, view } = makeView();
    view.sync([pickup(1, EInventoryType.Coin, 3, 1.2, -2)], 0.016, 0);
    const p = wrapper(root, 1).position;
    expect(p.x).toBe(-3);
    expect(p.y).toBe(1.2);
    expect(p.z).toBe(-2);
    view.dispose();
  });

  it('follows the sim position on later syncs (collect flight path)', () => {
    const { root, view } = makeView();
    // Sim SuckToPlayer moves the pickup toward the player; view just follows.
    view.sync([pickup(1, EInventoryType.Coin, 5, 0.3, 5)], 0.016, 0);
    view.sync([pickup(1, EInventoryType.Coin, 2, 0.8, 1)], 0.016, 0.016);
    const p = wrapper(root, 1).position;
    expect(p.x).toBe(-2);
    expect(p.y).toBe(0.8);
    expect(p.z).toBe(1);
    view.dispose();
  });
});

describe('PickupView spin (Q4.PickupCurrency.Update @0x3E2A30)', () => {
  it('advances rotation.y at +π rad/s (unity −180°/s mirrored) with dt', () => {
    const { root, view } = makeView();
    view.sync([pickup(1, EInventoryType.Coin)], 0, 0);
    const yaw0 = wrapper(root, 1).rotation.y;
    view.sync([pickup(1, EInventoryType.Coin)], 1, 1);
    const yaw1 = wrapper(root, 1).rotation.y;
    expect(yaw1 - yaw0).toBeCloseTo(Math.PI, 5);
    view.sync([pickup(1, EInventoryType.Coin)], 0.5, 1.5);
    expect(wrapper(root, 1).rotation.y - yaw1).toBeCloseTo(Math.PI / 2, 5);
    view.dispose();
  });

  it('starts at the handle-hash phase in [0,π) — deterministic, no Math.random', () => {
    const a = makeView();
    const b = makeView();
    a.view.sync([pickup(42, EInventoryType.Coin)], 0, 0);
    b.view.sync([pickup(42, EInventoryType.Coin)], 0, 99); // global clock irrelevant
    const yawA = wrapper(a.root, 42).rotation.y;
    expect(yawA).toBe(wrapper(b.root, 42).rotation.y);
    expect(yawA).toBe(handlePhase(42));
    expect(yawA).toBeGreaterThanOrEqual(0);
    expect(yawA).toBeLessThan(Math.PI);
    // different handles → different phases (hash spread)
    a.view.sync([pickup(43, EInventoryType.Coin)], 0, 0);
    expect(wrapper(a.root, 43).rotation.y).not.toBe(yawA);
    a.view.dispose();
    b.view.dispose();
  });

  it('identical inputs produce bit-identical transforms (fround determinism)', () => {
    const run = () => {
      const { root, view } = makeView();
      const drops = [pickup(11, EInventoryType.Coin, 1, 0, 2), pickup(12, EInventoryType.Gem, -3, 0.5, 4)];
      for (let i = 0; i < 10; i++) view.sync(drops, f(1 / 60), f(i / 60));
      const out = [11, 12].map((h) => {
        const n = wrapper(root, h);
        return [n.position.x, n.position.y, n.position.z, n.rotation.y];
      });
      view.dispose();
      return out;
    };
    const r1 = run();
    const r2 = run();
    for (let i = 0; i < r1.length; i++) {
      for (let j = 0; j < 4; j++) expect(Object.is(r1[i][j], r2[i][j])).toBe(true);
    }
  });
});

describe('PickupView template selection by EInventoryType', () => {
  it('Coin→coin template, Gem→gem template, other types→coin', () => {
    const coin = makeTemplate('coin_001');
    const gem = makeTemplate('gem_001');
    const { root, view } = makeView(coin, gem);
    view.sync([
      pickup(1, EInventoryType.Coin),
      pickup(2, EInventoryType.Gem),
      pickup(3, EInventoryType.InterestCoins),
    ], 0, 0);
    expect(innerMesh(wrapper(root, 1)).name).toBe('coin_001_comp_LOD0');
    expect(innerMesh(wrapper(root, 2)).name).toBe('gem_001_comp_LOD0');
    expect(innerMesh(wrapper(root, 3)).name).toBe('coin_001_comp_LOD0');
    view.dispose();
  });

  it('clones share geometry/materials with the template and hide LOD1+ stubs', () => {
    const coin = makeTemplate('coin_001');
    const templateMesh = coin.getObjectByName('coin_001_comp_LOD0') as THREE.Mesh;
    const { root, view } = makeView(coin, null);
    view.sync([pickup(1, EInventoryType.Coin), pickup(2, EInventoryType.Coin)], 0, 0);
    const m1 = innerMesh(wrapper(root, 1));
    const m2 = innerMesh(wrapper(root, 2));
    expect(m1.geometry).toBe(templateMesh.geometry);
    expect(m1.material).toBe(templateMesh.material);
    expect(m2.geometry).toBe(templateMesh.geometry);
    const stub = wrapper(root, 1).getObjectByName('coin_001_comp_LOD1');
    expect(stub?.visible).toBe(false);
    view.dispose();
  });

  it('removal does NOT dispose shared template resources', () => {
    const coin = makeTemplate('coin_001');
    const templateMesh = coin.getObjectByName('coin_001_comp_LOD0') as THREE.Mesh;
    const geoSpy = vi.spyOn(templateMesh.geometry, 'dispose');
    const matSpy = vi.spyOn(templateMesh.material as THREE.Material, 'dispose');
    const { view } = makeView(coin, null);
    view.sync([pickup(1, EInventoryType.Coin)], 0, 0);
    view.sync([], 0.016, 0.016);
    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
    view.dispose(); // templates are caller-owned — still not disposed
    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
  });
});

describe('PickupView fallback primitives (assets null)', () => {
  it('renders cylinder coin / octahedron gem with gold / teal materials', () => {
    const { root, view } = makeView(null, null);
    view.sync([pickup(1, EInventoryType.Coin), pickup(2, EInventoryType.Gem)], 0, 0);
    const coinMesh = innerMesh(wrapper(root, 1));
    const gemMesh = innerMesh(wrapper(root, 2));
    expect(coinMesh.geometry.type).toBe('CylinderGeometry');
    expect(gemMesh.geometry.type).toBe('OctahedronGeometry');
    expect((coinMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xf4e28a);
    expect((gemMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x8ef2e6);
    // fallback still spins + mirrors like the real assets
    view.sync([pickup(1, EInventoryType.Coin, 4, 0, 0)], 1, 1);
    expect(wrapper(root, 1).position.x).toBe(-4);
    expect(wrapper(root, 1).rotation.y).toBeCloseTo(handlePhase(1) + SPIN, 5);
    view.dispose();
  });

  it('mixed assets: real coin + fallback gem coexist', () => {
    const { root, view } = makeView(makeTemplate('coin_001'), null);
    view.sync([pickup(1, EInventoryType.Coin), pickup(2, EInventoryType.Gem)], 0, 0);
    expect(innerMesh(wrapper(root, 1)).name).toBe('coin_001_comp_LOD0');
    expect(innerMesh(wrapper(root, 2)).geometry.type).toBe('OctahedronGeometry');
    view.dispose();
  });
});

describe('PickupView dispose', () => {
  it('removes all wrappers, frees fallback resources, and ignores later syncs', () => {
    const { root, view } = makeView(null, null);
    view.sync([pickup(1, EInventoryType.Coin), pickup(2, EInventoryType.Gem)], 0.016, 0);
    expect(root.children.length).toBe(2);
    view.dispose();
    expect(root.children.length).toBe(0);
    view.sync([pickup(3, EInventoryType.Coin)], 0.016, 0.032); // dead view: no-op
    expect(root.children.length).toBe(0);
    view.dispose(); // idempotent
  });
});
