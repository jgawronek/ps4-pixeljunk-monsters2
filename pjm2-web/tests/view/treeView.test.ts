// tests/view/treeView.test.ts
// Contract-surface tests for TreeView. No GLBs are loaded in Node —
// templates are synthetic THREE.Object3D trees (exactly what GLTFLoader
// hands back: a scene Group with mesh-bearing children), plus null-asset
// fallback checks. Motion constants verified against decomp evidence cited
// in the TreeView header (Q4.NatureTree.OnTowerBuild @0x64A680 +
// <TreeFall>c__Iterator0 @0x64B270: fallHeight/fallDuration 0.5, fallAngle
// 75°, fallScale 0.25, delay Random.Range(0,0.25); OnTreeRevive @0x64A490 +
// <TreeRise>c__Iterator1 @0x64B770: 0.1s linear regrow; variant choice
// Q4.PrefabLoader @0x7470F0/@0x747220 prefabRandomList). Species selection
// (tree_001 vs tree_002 scene anchors), the SolidTree vertex-program port
// (ISA golden values, onBeforeCompile patch, per-tree shake uniforms,
// contact bumps) and the shipped GLBs' UV0 diversity + _WINDWEIGHT
// attribute are covered below.

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  TreeView, stableVariant, applyTreeWind, createTreeWindState, treeWindDisplacement,
  TREE_WIND_PARAMS, TREE_WIND_UNIFORMS, TREE_IDLE_SHAKE_START,
  type TreeViewAssets, type TreeWindParams, type TreeShake, type TreeShakeUniform,
} from '../../src/view/stage/TreeView';

const f = Math.fround;

/** Fake GLB scene: root + LOD0 mesh + LOD1 stub (must be hidden by prepare). */
function makeTemplate(name: string): THREE.Group {
  const scene = new THREE.Group();
  scene.name = `${name}_pa`;
  const comp = new THREE.Group();
  comp.name = name;
  const lod0 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.7), new THREE.MeshStandardMaterial());
  lod0.name = `${name}_LOD0`;
  const lod1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.7), new THREE.MeshStandardMaterial());
  lod1.name = `${name}_LOD1`;
  comp.add(lod0, lod1);
  scene.add(comp);
  return scene;
}

function makeView(assets: TreeViewAssets | null = {
  variants: [makeTemplate('v0'), makeTemplate('v1'), makeTemplate('v2')],
}) {
  const root = new THREE.Group();
  const view = new TreeView(root, assets);
  return { root, view };
}

/** The wrapper group TreeView adds for a handle. */
function wrapper(root: THREE.Group, id: number): THREE.Object3D {
  const node = root.getObjectByName(`tree:${id}`);
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

/** Minimal stand-in for the compiled-program object three hands to
 *  onBeforeCompile (same shape as splatTerrain.test.ts). */
function fakeShader() {
  return {
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: 'void main() {}',
    uniforms: {} as Record<string, { value: unknown }>,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

function lod0Material(template: THREE.Group, name: string): THREE.MeshStandardMaterial {
  return (template.getObjectByName(`${name}_LOD0`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
}

describe('TreeView mirror math + pooling', () => {
  it('addTree mirrors unity position x→−x, keeps y/z', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 3, y: 1.2, z: -2 });
    const p = wrapper(root, 1).position;
    expect(p.x).toBe(-3);
    expect(p.y).toBe(f(1.2)); // fp32-discipline write (Math.fround)
    expect(p.z).toBe(-2);
    view.dispose();
  });

  it('pools by id: addTree is idempotent, removeTree removes, re-add is fresh', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 0, y: 0, z: 0 });
    const first = wrapper(root, 1);
    view.addTree(1, { x: 9, y: 9, z: 9 }); // same handle → no duplicate
    expect(root.children.length).toBe(1);
    expect(wrapper(root, 1)).toBe(first);
    expect(first.position.x).toBe(-0); // original placement kept (mirror of 0)
    view.removeTree(1);
    expect(root.children.length).toBe(0);
    expect(root.getObjectByName('tree:1')).toBeUndefined();
    view.addTree(1, { x: 5, y: 0, z: 0 });
    expect(wrapper(root, 1)).not.toBe(first);
    expect(wrapper(root, 1).position.x).toBe(-5);
    view.removeTree(999); // unknown id → no-op
    view.dispose();
  });
});

describe('TreeView deterministic variant selection (Q4.PrefabLoader)', () => {
  it('explicit variantIndex picks index % count (wraps, handles negatives)', () => {
    const { root, view } = makeView();
    const picks: [number, number][] = [[10, 0], [11, 1], [12, 2], [13, 3], [14, -1]];
    for (const [id, vi] of picks) view.addTree(id, { x: 0, y: 0, z: 0 }, vi);
    expect(innerMesh(wrapper(root, 10)).name).toBe('v0_LOD0');
    expect(innerMesh(wrapper(root, 11)).name).toBe('v1_LOD0');
    expect(innerMesh(wrapper(root, 12)).name).toBe('v2_LOD0');
    expect(innerMesh(wrapper(root, 13)).name).toBe('v0_LOD0'); // 3 % 3
    expect(innerMesh(wrapper(root, 14)).name).toBe('v2_LOD0'); // −1 mod 3
    view.dispose();
  });

  it('same index → same variant across views; default pick is the id hash', () => {
    const a = makeView();
    const b = makeView();
    a.view.addTree(42, { x: 0, y: 0, z: 0 }, 1);
    b.view.addTree(42, { x: 0, y: 0, z: 0 }, 1);
    expect(innerMesh(wrapper(a.root, 42)).name).toBe(innerMesh(wrapper(b.root, 42)).name);
    // default (no index): stableVariant hash, deterministic across views
    a.view.addTree(7, { x: 0, y: 0, z: 0 });
    b.view.addTree(7, { x: 0, y: 0, z: 0 });
    const expected = `v${stableVariant(7, 3)}_LOD0`;
    expect(innerMesh(wrapper(a.root, 7)).name).toBe(expected);
    expect(innerMesh(wrapper(b.root, 7)).name).toBe(expected);
    for (let id = 0; id < 100; id++) {
      const v = stableVariant(id, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
    expect(stableVariant(42, 3)).toBe(stableVariant(42, 3));
    expect(stableVariant(0, 0)).toBe(0); // empty variant list guard
    a.view.dispose();
    b.view.dispose();
  });

  it('clones share geometry/materials with the template and hide LOD1+ stubs', () => {
    const t0 = makeTemplate('v0');
    const templateMesh = t0.getObjectByName('v0_LOD0') as THREE.Mesh;
    const { root, view } = makeView({ variants: [t0] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.addTree(2, { x: 1, y: 0, z: 0 }, 0);
    const m1 = innerMesh(wrapper(root, 1));
    const m2 = innerMesh(wrapper(root, 2));
    expect(m1.geometry).toBe(templateMesh.geometry);
    expect(m1.material).toBe(templateMesh.material);
    expect(m2.geometry).toBe(templateMesh.geometry);
    expect(wrapper(root, 1).getObjectByName('v0_LOD1')?.visible).toBe(false);
    view.dispose();
  });
});

describe('TreeView species selection (tree_001 vs tree_002 anchors)', () => {
  const bothSpecies = (): TreeViewAssets => ({
    variants: [makeTemplate('tree_001_1'), makeTemplate('tree_001_2')],
    variants002: [makeTemplate('tree_002_1'), makeTemplate('tree_002_2'), makeTemplate('tree_002_3')],
  });

  it('species tree_002 picks tree_002 templates; default species is tree_001', () => {
    const { root, view } = makeView(bothSpecies());
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0); // default species
    view.addTree(2, { x: 1, y: 0, z: 0 }, 0, 'tree_001');
    view.addTree(3, { x: 2, y: 0, z: 0 }, 0, 'tree_002');
    view.addTree(4, { x: 3, y: 0, z: 0 }, 2, 'tree_002');
    expect(innerMesh(wrapper(root, 1)).name).toBe('tree_001_1_LOD0');
    expect(innerMesh(wrapper(root, 2)).name).toBe('tree_001_1_LOD0');
    expect(innerMesh(wrapper(root, 3)).name).toBe('tree_002_1_LOD0');
    expect(innerMesh(wrapper(root, 4)).name).toBe('tree_002_3_LOD0');
    view.dispose();
  });

  it('variantIndex wraps within the SPECIES list; default pick hashes within its count', () => {
    const { root, view } = makeView(bothSpecies());
    view.addTree(10, { x: 0, y: 0, z: 0 }, 5, 'tree_002'); // 5 % 3 = 2
    view.addTree(11, { x: 0, y: 0, z: 0 }, -1, 'tree_002'); // −1 mod 3 = 2
    view.addTree(12, { x: 0, y: 0, z: 0 }, 3, 'tree_001'); // 3 % 2 = 1
    expect(innerMesh(wrapper(root, 10)).name).toBe('tree_002_3_LOD0');
    expect(innerMesh(wrapper(root, 11)).name).toBe('tree_002_3_LOD0');
    expect(innerMesh(wrapper(root, 12)).name).toBe('tree_001_2_LOD0');
    // no index → stableVariant over the species' own count (3 for tree_002)
    const a = makeView(bothSpecies());
    const b = makeView(bothSpecies());
    a.view.addTree(7, { x: 0, y: 0, z: 0 }, undefined, 'tree_002');
    b.view.addTree(7, { x: 0, y: 0, z: 0 }, undefined, 'tree_002');
    const expected = `tree_002_${stableVariant(7, 3) + 1}_LOD0`;
    expect(innerMesh(wrapper(a.root, 7)).name).toBe(expected);
    expect(innerMesh(wrapper(b.root, 7)).name).toBe(expected);
    a.view.dispose();
    b.view.dispose();
    view.dispose();
  });

  it('tree_002 with no templates falls back to tree_001 templates (not procedural)', () => {
    const { root, view } = makeView({ variants: [makeTemplate('tree_001_1')] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 4, 'tree_002'); // 4 % 1 = 0
    expect(innerMesh(wrapper(root, 1)).name).toBe('tree_001_1_LOD0');
    view.dispose();
  });

  it('both species empty → procedural fallback regardless of species', () => {
    const { root, view } = makeView({ variants: [], variants002: [] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0, 'tree_002');
    const meshes: THREE.Mesh[] = [];
    wrapper(root, 1).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.map((m) => m.geometry.type).sort()).toEqual(['ConeGeometry', 'CylinderGeometry']);
    view.dispose();
  });
});

describe('TreeView fallback (assets null / empty)', () => {
  it('renders a procedural cone+cylinder tree, still mirrored', () => {
    for (const assets of [null, { variants: [] } as TreeViewAssets]) {
      const { root, view } = makeView(assets);
      view.addTree(1, { x: 4, y: 0.5, z: -1 });
      const node = wrapper(root, 1);
      expect(node.position.x).toBe(-4);
      const meshes: THREE.Mesh[] = [];
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      expect(meshes.length).toBe(2);
      const types = meshes.map((m) => m.geometry.type).sort();
      expect(types).toEqual(['ConeGeometry', 'CylinderGeometry']);
      const colors = meshes.map((m) => (m.material as THREE.MeshStandardMaterial).color.getHex()).sort();
      expect(colors).toEqual([0x3e7a33, 0x6b4a2f].sort()); // foliage green + trunk brown
      view.dispose();
    }
  });

  it('single-variant assets: every index resolves to the only variant', () => {
    // load() drops failed files, so the variants array can shrink to one;
    // the modulo pick must still resolve (fallback is all-or-nothing).
    const { root, view } = makeView({ variants: [makeTemplate('only')] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 5);
    expect(innerMesh(wrapper(root, 1)).name).toBe('only_LOD0');
    view.dispose();
  });
});

describe('TreeView TreeFall (OnTowerBuild @0x64A680 + iterator @0x64B270)', () => {
  it('sinks/rotates/shrinks after the delay, then hides and restores origin TRS', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 2, y: 0.3, z: 1 }, 0);
    const node = wrapper(root, 1);
    const originPos = node.position.clone();
    const originQuat = node.quaternion.clone();
    view.onTowerBuilt(1);
    // delay ∈ [0, 0.25): after 0.26s the fall is guaranteed underway
    view.update(0.26);
    expect(node.visible).toBe(true);
    expect(node.position.y).toBeLessThan(originPos.y);      // sinking
    expect(node.position.x).toBe(originPos.x);              // x/z untouched
    expect(node.scale.x).toBeLessThan(1);                   // shrinking toward 0.25
    expect(node.scale.x).toBeGreaterThanOrEqual(0.25);
    expect(node.quaternion.equals(originQuat)).toBe(false); // rotating (75° cap)
    // past delay + fallDuration (0.25 + 0.5): hidden + origin TRS restored
    view.update(0.5);
    expect(node.visible).toBe(false);
    expect(node.position.equals(originPos)).toBe(true);
    expect(node.quaternion.equals(originQuat)).toBe(true);
    expect(node.scale.x).toBe(1);
    view.update(0.1); // hidden: nothing advances
    expect(node.visible).toBe(false);
    view.dispose();
  });

  it('fall delay is deterministic per handle (hash replaces Random.Range)', () => {
    const a = makeView();
    const b = makeView();
    a.view.addTree(5, { x: 0, y: 0, z: 0 }, 0);
    b.view.addTree(5, { x: 0, y: 0, z: 0 }, 0);
    a.view.onTowerBuilt(5);
    b.view.onTowerBuilt(5);
    a.view.update(f(0.2));
    b.view.update(f(0.2));
    expect(Object.is(wrapper(a.root, 5).position.y, wrapper(b.root, 5).position.y)).toBe(true);
    expect(Object.is(wrapper(a.root, 5).scale.x, wrapper(b.root, 5).scale.x)).toBe(true);
    a.view.dispose();
    b.view.dispose();
  });

  it('onTowerBuilt is a no-op for unknown ids and non-alive trees', () => {
    const { root, view } = makeView();
    view.onTowerBuilt(999); // unknown → no throw, nothing added
    expect(root.children.length).toBe(0);
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.onTowerBuilt(1);
    view.update(1); // fully fallen → hidden
    const node = wrapper(root, 1);
    expect(node.visible).toBe(false);
    view.onTowerBuilt(1); // already hidden → no re-fall
    view.update(1);
    expect(node.visible).toBe(false);
    expect(node.scale.x).toBe(1); // origin TRS still restored
    view.dispose();
  });

  it('trees fall AWAY from the tower: axis = Cross(flat(treePos − towerPos), up) (OnTowerBuild @0x64A680)', () => {
    // Tower at unity origin; trees on +x, −x, +z, −z. AngleAxis(−angle, axis)
    // tips the crown away from the tower: tree on +x leans toward +x unity
    // (three −x after the mirror), etc. Check via the rotated up vector.
    const { root, view } = makeView();
    const towerPos = { x: 0, y: 0, z: 0 };
    const spots: [number, number, number][] = [[1, 2, 0], [2, -1.5, 0], [3, 0, 1.2], [4, 0, -1.2]];
    for (const [id, x, z] of spots) view.addTree(id, { x, y: 0, z }, 0);
    for (const [id] of spots) view.onTowerBuilt(id, towerPos);
    view.update(f(0.45));
    for (const [id, x, z] of spots) {
      const q = wrapper(root, id).quaternion;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q); // three space
      const len = Math.hypot(x, z);
      // unity direction → three: x mirrored
      expect(up.x * (-x / len) + up.z * (z / len)).toBeGreaterThan(0.4); // leans away
    }
    view.dispose();
  });

  it('a tree AT the tower position (the clicked one): delay 0 + half-circle direction', () => {
    const { root, view } = makeView();
    view.addTree(7, { x: 5, y: 0, z: 5 }, 0);
    view.onTowerBuilt(7, { x: 5, y: 0, z: 5 });
    view.update(f(0.01)); // delay would be > 0.01 for most hashes; here it is 0
    const node = wrapper(root, 7);
    expect(node.position.y).toBeLessThan(0);
    expect(node.quaternion.equals(new THREE.Quaternion())).toBe(false);
    // dir=(cosθ,0,sinθ), θ∈[0,π) → unity axis (−sinθ,0,cosθ): x ≤ 0 → quat.x ≥ 0
    expect(node.quaternion.x).toBeGreaterThanOrEqual(0);
    view.dispose();
  });

  it('non-zero offset keeps the Random.Range(0,0.25) delay (still upright at t=0)', () => {
    const { root, view } = makeView();
    view.addTree(8, { x: 1, y: 0, z: 0 }, 0);
    view.onTowerBuilt(8, { x: 0, y: 0, z: 0 });
    view.update(0);
    expect(wrapper(root, 8).position.y).toBe(0);
    view.dispose();
  });

  it('y offset is ignored (flattened): same direction as flat offset', () => {
    const a = makeView();
    const b = makeView();
    a.view.addTree(1, { x: 2, y: 0, z: 1 }, 0);
    b.view.addTree(1, { x: 2, y: 0, z: 1 }, 0);
    a.view.onTowerBuilt(1, { x: 0, y: 0, z: 0 });
    b.view.onTowerBuilt(1, { x: 0, y: 9, z: 0 });
    a.view.update(f(0.3));
    b.view.update(f(0.3));
    expect(wrapper(a.root, 1).quaternion.equals(wrapper(b.root, 1).quaternion)).toBe(true);
    a.view.dispose();
    b.view.dispose();
  });
});

describe('TreeView TreeRise (OnTreeRevive @0x64A490 + iterator @0x64B770)', () => {
  it('regrows from scale 0 to the saved scale over 0.1s, then lives again', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.onTowerBuilt(1);
    view.update(1); // fall complete → hidden
    const node = wrapper(root, 1);
    view.onTowerRemoved(1);
    expect(node.visible).toBe(true);
    expect(node.scale.x).toBe(0); // localScale = zero at rise start
    view.update(0.05);
    expect(node.scale.x).toBeCloseTo(0.5, 5); // linear over 0.1s
    view.update(0.05);
    expect(node.scale.x).toBe(1); // exact restore (faithful)
    view.update(0.016); // alive again: wind advances, scale untouched
    expect(node.scale.x).toBe(1);
    expect(node.visible).toBe(true);
    view.dispose();
  });

  it('revive index staggers the regrow: WaitForSeconds(index*0.05) at scale 0', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.onTowerBuilt(1);
    view.update(1);
    const node = wrapper(root, 1);
    view.onTreeRevive(1, 3); // wait 0.15s
    expect(node.visible).toBe(true);
    view.update(0.1);
    expect(node.scale.x).toBe(0);
    view.update(0.1); // 0.05 past the wait → half grown (0.05/0.1)
    expect(node.scale.x).toBeCloseTo(0.5, 4);
    view.update(0.1);
    expect(node.scale.x).toBe(1);
    view.dispose();
  });

  it('onTowerRemoved is a no-op unless hidden', () => {
    const { root, view } = makeView();
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.onTowerRemoved(1); // alive → not a regrow candidate
    expect(wrapper(root, 1).scale.x).toBe(1);
    view.onTowerRemoved(999); // unknown → no throw
    view.dispose();
  });
});

describe('TreeView SolidTree wind: ISA golden values (docs/TREE_SWAY_ANALYSIS.md)', () => {
  interface Golden {
    params: TreeWindParams; shake: TreeShake; timeY: number;
    objToWorld: number[][]; objPos: number[]; weight: number; isaWorldOut: number[];
  }
  const golden = JSON.parse(readFileSync(join(
    dirname(fileURLToPath(import.meta.url)), 'fixtures/treeWindIsaGolden.json'), 'utf8')).cases as Golden[];

  it('fixture was produced by executing the real vertex program (48 cases)', () => {
    expect(golden.length).toBe(48);
  });

  it('treeWindDisplacement == ISA interpreter output (world + displacement), fp32 tolerance', () => {
    let worst = 0;
    for (const c of golden) {
      const M = c.objToWorld; const p = c.objPos;
      const world = {
        x: M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2] + M[0][3],
        y: M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2] + M[1][3],
        z: M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] + M[2][3],
      };
      const d = treeWindDisplacement(c.params, c.timeY, world, p[1], c.weight, c.shake);
      const out = [world.x + d.x, world.y + d.y, world.z + d.z];
      for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(out[i] - c.isaWorldOut[i]));
    }
    // fp32 ISA vs fp64 reference at |coords| <= ~35 and t <= 300
    expect(worst).toBeLessThan(2e-4);
  });

  it('golden set exercises active shakes, idle shakes and the height clamp', () => {
    const active = golden.filter((c) => c.timeY - c.shake.start < c.params.shakeDuration).length;
    const idle = golden.filter((c) => c.timeY - c.shake.start >= c.params.shakeDuration).length;
    expect(active).toBeGreaterThan(5);
    expect(idle).toBeGreaterThan(5);
    expect(golden.some((c) => c.objPos[1] > 3)).toBe(true);
  });

  it('weight: trunk (color.r = 0) is rigid; height factor saturates at y = 3', () => {
    const p = TREE_WIND_PARAMS.tree_001;
    const idle: TreeShake = { dirX: 0.7071, dirZ: 0.7071, start: TREE_IDLE_SHAKE_START };
    const w = { x: 3.3, y: 1, z: -2.2 };
    expect(treeWindDisplacement(p, 5, w, 1.5, 0, idle)).toEqual({ x: 0, y: 0, z: 0 });
    expect(treeWindDisplacement(p, 5, w, 0, 1, idle)).toEqual({ x: 0, y: 0, z: 0 });
    const a = treeWindDisplacement(p, 5, w, 3, 1, idle);
    const b = treeWindDisplacement(p, 5, w, 9, 1, idle);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
    const half = treeWindDisplacement(p, 5, w, 1.5, 1, idle);
    expect(Math.abs(half.x)).toBeLessThan(Math.abs(a.x));
    expect(a.y).toBe(0); // wind never moves vertices vertically
  });

  it('idle _ShakeStartTime = -100 contributes nothing; a fresh bump is pushed along -dir', () => {
    const p = TREE_WIND_PARAMS.tree_002;
    const w = { x: 0, y: 1, z: 0 };
    const idle = treeWindDisplacement(p, 50, w, 3, 1, { dirX: 1, dirZ: 0, start: TREE_IDLE_SHAKE_START });
    const t = 50;
    // numShakes=10, k small: sin(pi*10*k) > 0 → displacement along -dir (x < base wind)
    const bumped = treeWindDisplacement(p, t, w, 3, 1, { dirX: 1, dirZ: 0, start: t - 0.03 });
    expect(bumped.x).toBeLessThan(idle.x);
    expect(bumped.z).toBeCloseTo(idle.z, 12);
    // fully decayed after _ShakeDuration (3 s)
    const done = treeWindDisplacement(p, t, w, 3, 1, { dirX: 1, dirZ: 0, start: t - 3.0 });
    expect(done.x).toBeCloseTo(idle.x, 12);
  });

  it('serialized material floats (tree_001_m / tree_002_m) are wired per species', () => {
    expect(TREE_WIND_PARAMS.tree_001).toEqual({
      mainFrequency: f(1.6), mainSpeed: f(1.2), mainStrength: f(0.3),
      noiseFrequency: f(10), noiseSpeed: f(1), noiseStrength: f(0.2),
      shakeStrength: f(0.3), shakeDuration: f(3), numShakes: f(10),
    });
    expect(TREE_WIND_PARAMS.tree_002).toEqual({
      mainFrequency: f(1.8), mainSpeed: f(1.2), mainStrength: f(0.45),
      noiseFrequency: f(9.5), noiseSpeed: f(1), noiseStrength: f(0.4),
      shakeStrength: f(0.3), shakeDuration: f(3), numShakes: f(10),
    });
  });

  it('world-space displacement maps back to object space under rotation + uniform scale (fall/yaw)', () => {
    // GLSL: transformed += transpose(mat3(M)) * dW / dot(M[0].xyz, M[0].xyz)
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(4, 1, -2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, -0.3)),
      new THREE.Vector3(0.6, 0.6, 0.6));
    const dW = new THREE.Vector3(0.1, -0.05, 0.2);
    const e = m.elements;
    const s2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    const viaGlsl = new THREE.Vector3(
      (e[0] * dW.x + e[1] * dW.y + e[2] * dW.z) / s2,
      (e[4] * dW.x + e[5] * dW.y + e[6] * dW.z) / s2,
      (e[8] * dW.x + e[9] * dW.y + e[10] * dW.z) / s2);
    const exact = dW.clone().transformDirection(new THREE.Matrix4().copy(m).invert());
    const viaInv = dW.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(m).invert()));
    expect(viaGlsl.distanceTo(viaInv)).toBeLessThan(1e-6);
    expect(exact.length()).toBeCloseTo(1, 6); // (sanity: transformDirection normalizes)
    // and the round trip reproduces the world displacement
    const back = viaGlsl.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(m));
    expect(back.distanceTo(dW)).toBeLessThan(1e-6);
  });
});

describe('TreeView SolidTree wind: material patch + per-tree uniforms', () => {
  /** Template whose LOD0 carries the _WINDWEIGHT attribute (as the real GLBs). */
  function makeWindTemplate(name: string): THREE.Group {
    const t = makeTemplate(name);
    const lod0 = t.getObjectByName(`${name}_LOD0`) as THREE.Mesh;
    const n = lod0.geometry.getAttribute('position').count;
    lod0.geometry.setAttribute('_windweight', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    return t;
  }
  const meshOf = (root: THREE.Group, id: number) => innerMesh(wrapper(root, id));

  it('applyTreeWind injects uniforms + the SolidTree chunk once, after begin_vertex', () => {
    const m = new THREE.MeshStandardMaterial();
    const clock = { value: 0 };
    const state = createTreeWindState(TREE_WIND_PARAMS.tree_001, clock);
    const shake: TreeShakeUniform = { value: new THREE.Vector3(0.7, 0.7, -100) };
    applyTreeWind(m, state, shake);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[TREE_WIND_UNIFORMS.time]).toBe(clock);           // live _Time.y
    expect(sh.uniforms[TREE_WIND_UNIFORMS.shake]).toBe(shake);          // per-tree MPB
    expect((sh.uniforms[TREE_WIND_UNIFORMS.main] as { value: THREE.Vector3 }).value.toArray())
      .toEqual([f(1.6), f(1.2), f(0.3)]);
    expect((sh.uniforms[TREE_WIND_UNIFORMS.noise] as { value: THREE.Vector3 }).value.toArray())
      .toEqual([f(10), f(1), f(0.2)]);
    expect((sh.uniforms[TREE_WIND_UNIFORMS.shakeParams] as { value: THREE.Vector3 }).value.toArray())
      .toEqual([f(0.3), f(3), f(10)]);
    const v = sh.vertexShader;
    expect(v).toContain('attribute float _windweight;');
    // ISA literals: 1/3 height divisor, 45° (0.7071), 1.15/0.7/0.42, 1.05, 0.3π, 0.5*0.7071
    for (const lit of ['0.33333334', '0.70710677', '1.15', '0.7 *', '0.42', '1.05', '0.9424778', '0.35355338']) {
      expect(v).toContain(lit);
    }
    expect(v).toContain('modelMatrix * vec4( transformed, 1.0 )'); // WORLD-space phase
    expect(v).toContain('vec3( -twW.x, twW.y, twW.z )');            // LH→RH mirror to unity space
    expect(v).toContain('2.0 * uTreeTime');                          // _Time.z
    expect(v).toContain('transformed +=');
    expect(v.indexOf('#include <begin_vertex>')).toBeLessThan(v.indexOf('transformed +='));
    m.onBeforeCompile(sh, null as never); // second pass must not double-inject
    expect(sh.vertexShader.split('transformed +=').length - 1).toBe(1);
    expect(m.customProgramCacheKey()).toContain('pjm2-tree-wind-solidtree');
  });

  it('patch applies to the REAL three ShaderLib vertex sources (include directive replaced, not chunk text)', () => {
    for (const lib of ['physical', 'depth', 'distanceRGBA'] as const) {
      const src = THREE.ShaderLib[lib].vertexShader;
      expect(src).toContain('#include <begin_vertex>');
      const m = new THREE.MeshStandardMaterial();
      applyTreeWind(m, createTreeWindState(TREE_WIND_PARAMS.tree_001, { value: 0 }),
                    { value: new THREE.Vector3() });
      const sh = { vertexShader: src, fragmentShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(sh, null as never);
      expect(sh.vertexShader.length).toBeGreaterThan(src.length + 500);
      expect(sh.vertexShader).toContain('transformed += ( transpose( mat3( modelMatrix ) )');
      // the unresolved directive is still there (three resolves it later), injected code follows it
      expect(sh.vertexShader.indexOf('#include <begin_vertex>')).toBeLessThan(sh.vertexShader.indexOf('float tw ='));
    }
  });

  it('applyTreeWind chains the template material handler + cache key (other agents patch too)', () => {
    const tmpl = new THREE.MeshStandardMaterial();
    const seen: string[] = [];
    tmpl.onBeforeCompile = () => { seen.push('template'); };
    tmpl.customProgramCacheKey = () => 'grade-x';
    const own = tmpl.clone();
    applyTreeWind(own, createTreeWindState(TREE_WIND_PARAMS.tree_001, { value: 0 }),
                  { value: new THREE.Vector3() }, tmpl);
    own.onBeforeCompile(fakeShader(), null as never);
    expect(seen).toEqual(['template']);
    expect(own.customProgramCacheKey()).toBe('grade-x|pjm2-tree-wind-solidtree');
  });

  it('every tree gets its OWN material + depth material (shadow pass sways too); textures/geometry shared', () => {
    const t = makeWindTemplate('tree_001_1');
    const tm = lod0Material(t, 'tree_001_1');
    tm.map = new THREE.Texture();
    const { root, view } = makeView({ variants: [t] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.addTree(2, { x: 3, y: 0, z: 0 }, 0);
    const a = meshOf(root, 1); const b = meshOf(root, 2);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).not.toBe(b.material);
    expect(a.material).not.toBe(tm);
    expect((a.material as THREE.MeshStandardMaterial).map).toBe(tm.map);
    expect(a.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(a.customDepthMaterial).not.toBe(b.customDepthMaterial);
    // main + depth material of ONE tree share that tree's shake uniform
    const s1 = fakeShader(); const s2 = fakeShader(); const s3 = fakeShader();
    (a.material as THREE.Material).onBeforeCompile(s1, null as never);
    a.customDepthMaterial!.onBeforeCompile(s2, null as never);
    (b.material as THREE.Material).onBeforeCompile(s3, null as never);
    expect(s1.uniforms[TREE_WIND_UNIFORMS.shake]).toBe(s2.uniforms[TREE_WIND_UNIFORMS.shake]);
    expect(s1.uniforms[TREE_WIND_UNIFORMS.shake]).not.toBe(s3.uniforms[TREE_WIND_UNIFORMS.shake]);
    // same program for all trees (identical cache key), shared clock + species params
    expect((a.material as THREE.Material).customProgramCacheKey())
      .toBe((b.material as THREE.Material).customProgramCacheKey());
    expect(s1.uniforms[TREE_WIND_UNIFORMS.time]).toBe(s3.uniforms[TREE_WIND_UNIFORMS.time]);
    // removal frees the per-tree materials, not the template's
    const spyOwn = vi.spyOn(a.material as THREE.Material, 'dispose');
    const spyTmpl = vi.spyOn(tm, 'dispose');
    view.removeTree(1);
    expect(spyOwn).toHaveBeenCalledTimes(1);
    expect(spyTmpl).not.toHaveBeenCalled();
    view.dispose();
  });

  it('meshes without _windweight (trunk, synthetic boxes) stay on the shared template material', () => {
    const t = makeTemplate('v0'); // no attribute
    const { root, view } = makeView({ variants: [t] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    expect(meshOf(root, 1).material).toBe(lod0Material(t, 'v0'));
    expect(meshOf(root, 1).customDepthMaterial).toBeUndefined();
    view.dispose();
  });

  it('tree_002 trees use the tree_002 species wind params', () => {
    const { root, view } = makeView({
      variants: [makeWindTemplate('tree_001_1')], variants002: [makeWindTemplate('tree_002_1')],
    });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0, 'tree_001');
    view.addTree(2, { x: 1, y: 0, z: 0 }, 0, 'tree_002');
    const s1 = fakeShader(); const s2 = fakeShader();
    (meshOf(root, 1).material as THREE.Material).onBeforeCompile(s1, null as never);
    (meshOf(root, 2).material as THREE.Material).onBeforeCompile(s2, null as never);
    const main = (s: typeof s1) => (s.uniforms[TREE_WIND_UNIFORMS.main] as { value: THREE.Vector3 }).value.toArray();
    expect(main(s1)).toEqual([f(1.6), f(1.2), f(0.3)]);
    expect(main(s2)).toEqual([f(1.8), f(1.2), f(0.45)]);
    view.dispose();
  });

  it('update(dt) advances the shared _Time.y live; runs in ALL states', () => {
    const t = makeWindTemplate('tree_001_1');
    const { root, view } = makeView({ variants: [t] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    const sh = fakeShader();
    (meshOf(root, 1).material as THREE.Material).onBeforeCompile(sh, null as never);
    const clock = sh.uniforms[TREE_WIND_UNIFORMS.time] as { value: number };
    expect(clock.value).toBe(0);
    view.onTowerBuilt(1);
    view.update(0.25); // falling
    expect(clock.value).toBeCloseTo(0.25, 12);
    view.update(1);    // hidden
    expect(clock.value).toBeCloseTo(1.25, 12);
    expect(view.windTime).toBeCloseTo(1.25, 12);
    expect(wrapper(root, 1).visible).toBe(false);
    view.dispose();
    view.update(1); // disposed: frozen
    expect(clock.value).toBeCloseTo(1.25, 12);
  });

  it('idle trees keep their base yaw — sway is vertex-side, not a transform tilt', () => {
    const { root, view } = makeView();
    view.addTree(11, { x: 1, y: 0, z: 2 }, 0);
    const n = wrapper(root, 11);
    const yaw = n.rotation.y;
    for (let i = 0; i < 10; i++) view.update(f(1 / 60));
    expect([n.rotation.x, n.rotation.z, n.scale.x]).toEqual([0, 0, 1]);
    expect(n.rotation.y).toBe(yaw);
    view.dispose();
  });

  it('fallback foliage carries the wind (height-fraction weight); the trunk stays rigid', () => {
    const { root, view } = makeView(null);
    view.addTree(1, { x: 0, y: 0, z: 0 });
    const meshes: THREE.Mesh[] = [];
    wrapper(root, 1).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const foliage = meshes.find((m) => m.geometry.type === 'ConeGeometry')!;
    const trunk = meshes.find((m) => m.geometry.type === 'CylinderGeometry')!;
    const w = foliage.geometry.getAttribute('_windweight');
    expect(w.count).toBe(foliage.geometry.getAttribute('position').count);
    expect(Math.min(...(w.array as Float32Array))).toBeCloseTo(0, 6);
    expect(Math.max(...(w.array as Float32Array))).toBeCloseTo(1, 6);
    expect(foliage.customDepthMaterial).toBeDefined();
    expect(trunk.customDepthMaterial).toBeUndefined();
    const sh = fakeShader();
    (foliage.material as THREE.Material).onBeforeCompile(sh, null as never);
    expect(sh.vertexShader).toContain('transformed +=');
    view.dispose();
  });
});

describe('TreeView contact shake (Q4.NatureTree.SetBumpShaderParameters / OnPlayerEnter)', () => {
  function windView() {
    const t = makeTemplate('tree_001_1');
    const lod0 = t.getObjectByName('tree_001_1_LOD0') as THREE.Mesh;
    lod0.geometry.setAttribute('_windweight',
      new THREE.BufferAttribute(new Float32Array(lod0.geometry.getAttribute('position').count).fill(1), 1));
    return makeView({ variants: [t] });
  }

  it('Awake seed: _ShakeDirection = normalize(1,0,1), _ShakeStartTime = -100', () => {
    const { view } = windView();
    view.addTree(1, { x: 5, y: 0, z: 5 }, 0);
    const s = view.getShake(1)!;
    expect(s.dirX).toBeCloseTo(Math.SQRT1_2, 6);
    expect(s.dirZ).toBeCloseTo(Math.SQRT1_2, 6);
    expect(s.start).toBe(-100);
    expect(view.getShake(99)).toBeNull();
    view.dispose();
  });

  it('OnPlayerEnter: dir = flat(player − tree) normalized, start = clock; 1 s throttle (lastBump starts 0)', () => {
    const { view } = windView();
    view.addTree(1, { x: 10, y: 0, z: 10 }, 0);
    // Time.time (= clock) is 0 → `0 − 0 > 1` is false: no bump yet (faithful)
    expect(view.onPlayerEnter(1, { x: 13, y: 7, z: 14 })).toBe(false);
    expect(view.getShake(1)!.start).toBe(-100);
    view.update(1.5);
    expect(view.onPlayerEnter(1, { x: 13, y: 7, z: 14 })).toBe(true);
    const s = view.getShake(1)!;
    expect(s.dirX).toBeCloseTo(0.6, 6);     // (3,4)/5, y ignored
    expect(s.dirZ).toBeCloseTo(0.8, 6);
    expect(s.start).toBeCloseTo(1.5, 12);
    view.update(0.5);                         // 0.5 s later: throttled
    expect(view.onPlayerEnter(1, { x: 10, y: 0, z: 5 })).toBe(false);
    expect(view.getShake(1)!.dirX).toBeCloseTo(0.6, 6);
    view.update(0.6);                         // 1.1 s after the last bump
    expect(view.onPlayerEnter(1, { x: 10, y: 0, z: 5 })).toBe(true);
    expect(view.getShake(1)!.dirZ).toBeCloseTo(-1, 6);
    expect(view.getShake(1)!.start).toBeCloseTo(2.6, 12);
    // zero offset → Vector3.Normalize(0) = 0
    view.update(2);
    expect(view.onPlayerEnter(1, { x: 10, y: 3, z: 10 })).toBe(true);
    expect(view.getShake(1)!.dirX).toBe(0);
    expect(view.getShake(1)!.dirZ).toBe(0);
    view.dispose();
  });

  it('trackPlayers fires on the ENTER edge of the r=2 sphere trigger, only for alive trees', () => {
    const { view } = windView();
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.addTree(2, { x: 50, y: 0, z: 0 }, 0);
    view.update(2);
    view.trackPlayers([{ x: 2.5, y: 0, z: 0 }]);   // outside r = 2
    expect(view.getShake(1)!.start).toBe(-100);
    view.trackPlayers([{ x: 1.9, y: 0, z: 0 }]);   // enter
    expect(view.getShake(1)!.start).toBeCloseTo(2, 12);
    expect(view.getShake(1)!.dirX).toBeCloseTo(1, 6);
    expect(view.getShake(2)!.start).toBe(-100);
    view.update(1.5);
    view.trackPlayers([{ x: 1.0, y: 0, z: 0 }]);   // still inside → no new enter
    expect(view.getShake(1)!.start).toBeCloseTo(2, 12);
    view.trackPlayers([{ x: 9, y: 0, z: 0 }]);     // exit
    view.update(0.1);
    view.trackPlayers([{ x: 0, y: 0, z: 1.5 }]);   // re-enter after 1.6 s → bump from +z
    expect(view.getShake(1)!.start).toBeCloseTo(3.6, 12);
    expect(view.getShake(1)!.dirZ).toBeCloseTo(1, 6);
    // fallen (hidden) tree has its trigger deactivated
    view.onTowerBuilt(2);
    view.update(1);
    view.trackPlayers([{ x: 50, y: 0, z: 0 }]);
    expect(view.getShake(2)!.start).toBe(-100);
    view.dispose();
  });

  it('TreeRise end bumps in a deterministic random flat direction (same 1 s throttle)', () => {
    const run = () => {
      const { view } = windView();
      view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
      view.update(5);
      view.onTowerBuilt(1);
      view.update(1);          // hidden
      view.onTreeRevive(1, 0);
      view.update(0.2);        // regrow done → alive + bump
      return { s: view.getShake(1)!, t: view.windTime, v: view };
    };
    const a = run(); const b = run();
    expect(a.s.start).toBeCloseTo(a.t - 0, 0);          // bump happened at the end of the rise
    expect(a.s.start).toBeGreaterThan(5);
    expect(Math.hypot(a.s.dirX, a.s.dirZ)).toBeCloseTo(1, 6);
    expect(a.s).toEqual(b.s);                           // deterministic (no Math.random)
    a.v.dispose(); b.v.dispose();
  });

  it('fall and rise compose with the sway: only the wrapper transform changes', () => {
    const { root, view } = windView();
    view.addTree(1, { x: 4, y: 1, z: 2 }, 0);
    const node = wrapper(root, 1);
    const mesh = innerMesh(node);
    const matBefore = mesh.material;
    view.onTowerBuilt(1, { x: 0, y: 1, z: 0 });
    view.update(0.4);
    expect(node.scale.x).toBeLessThan(1);              // shader reads this modelMatrix
    expect(mesh.material).toBe(matBefore);              // same per-tree material throughout
    view.dispose();
  });
});

describe('TreeView update: mixer hook', () => {
  it('advances an AnimationMixer when the template carries clips (none ship)', () => {
    const template = makeTemplate('clip');
    const sway = new THREE.Group();
    sway.name = 'sway';
    template.add(sway);
    const track = new THREE.NumberKeyframeTrack('sway.position[x]', [0, 1], [0, 2]);
    template.userData.animations = [new THREE.AnimationClip('swayclip', 1, [track])];
    const { root, view } = makeView({ variants: [template] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    const swayNode = wrapper(root, 1).getObjectByName('sway')!;
    expect(swayNode.position.x).toBe(0);
    view.update(0.5);
    expect(swayNode.position.x).toBeCloseTo(1, 5); // linear track at t=0.5
    view.update(0.25);
    expect(swayNode.position.x).toBeCloseTo(1.5, 5); // t=0.75 (loop wraps at 1.0)
    view.dispose();
    // without clips: update is a safe no-op on the same node
    const plain = makeView({ variants: [makeTemplate('plain')] });
    plain.view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    plain.view.update(0.5);
    expect(plain.root.children.length).toBe(1);
    plain.view.dispose();
  });
});

describe('TreeView shipped assets: per-variant UV0 diversity (extractor audit)', () => {
  // Reads the COMMITTED GLBs (public/assets/trees) — no GLTFLoader needed,
  // just the raw accessor bytes. Skipped only when the assets were never
  // extracted on this checkout.
  const TREES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public/assets/trees');
  const haveAssets = existsSync(join(TREES_DIR, 'tree_001_1.glb'));

  /** Raw bytes of a GLB accessor (first mesh/primitive), stride-resolved. */
  function accessorBytes(file: string, attr: 'TEXCOORD_0' | 'POSITION'): Buffer {
    const data = readFileSync(join(TREES_DIR, file));
    let off = 12;
    let js: { meshes: { primitives: { attributes: Record<string, number> }[] }[];
              accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[];
              bufferViews: { byteOffset?: number; byteStride?: number }[] } | null = null;
    let bin: Buffer | null = null;
    while (off < data.length) {
      const clen = data.readUInt32LE(off);
      const ctype = data.readUInt32LE(off + 4);
      const body = data.subarray(off + 8, off + 8 + clen);
      if (ctype === 0x4e4f534a) js = JSON.parse(body.toString('utf8'));
      else if (ctype === 0x004e4942) bin = body;
      off += 8 + clen;
    }
    const a = js!.accessors[js!.meshes[0].primitives[0].attributes[attr]];
    const bv = js!.bufferViews[a.bufferView];
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const ncomp = a.type === 'VEC3' ? 3 : 2;
    const stride = bv.byteStride ?? 4 * ncomp;
    const rows: Buffer[] = [];
    for (let i = 0; i < a.count; i++) {
      rows.push(bin!.subarray(base + i * stride, base + i * stride + 4 * ncomp));
    }
    return Buffer.concat(rows);
  }

  (haveAssets ? it : it.skip)('tree_001 variants share positions but have DISTINCT UV0 (atlas quadrants)', () => {
    const files = ['tree_001_1.glb', 'tree_001_2.glb', 'tree_001_3.glb', 'tree_001_4.glb'];
    const uvs = files.map((fl) => accessorBytes(fl, 'TEXCOORD_0'));
    const poss = files.map((fl) => accessorBytes(fl, 'POSITION'));
    for (let i = 0; i < uvs.length; i++) {
      expect(poss[i].equals(poss[0])).toBe(true); // shared geometry (849 verts)
      for (let j = i + 1; j < uvs.length; j++) {
        expect(uvs[i].equals(uvs[j])).toBe(false); // distinct atlas region
      }
    }
  });

  (haveAssets ? it : it.skip)('tree_002 variants have DISTINCT UV0', () => {
    const files = ['tree_002_1.glb', 'tree_002_2.glb', 'tree_002_3.glb', 'tree_002_4.glb'];
    const uvs = files.map((fl) => accessorBytes(fl, 'TEXCOORD_0'));
    for (let i = 0; i < uvs.length; i++) {
      for (let j = i + 1; j < uvs.length; j++) {
        expect(uvs[i].equals(uvs[j])).toBe(false);
      }
    }
  });

  (haveAssets ? it : it.skip)('every GLB carries _WINDWEIGHT (= Unity vertex color.r) per vertex', () => {
    for (const sp of ['tree_001', 'tree_002']) {
      for (let v = 1; v <= 4; v++) {
        const data = readFileSync(join(TREES_DIR, `${sp}_${v}.glb`));
        const jlen = data.readUInt32LE(12);
        const js = JSON.parse(data.subarray(20, 20 + jlen).toString('utf8'));
        const binOff = 20 + jlen + 8;
        const attrs = js.meshes[0].primitives[0].attributes as Record<string, number>;
        expect(attrs.COLOR_0).toBeUndefined(); // would tint albedo via vertexColors
        const a = js.accessors[attrs._WINDWEIGHT];
        expect(a.type).toBe('SCALAR');
        expect(a.componentType).toBe(5126);
        expect(a.count).toBe(js.accessors[attrs.POSITION].count);
        const bv = js.bufferViews[a.bufferView];
        let lo = Infinity; let hi = -Infinity; let nz = 0;
        for (let i = 0; i < a.count; i++) {
          const x = data.readFloatLE(binOff + (bv.byteOffset ?? 0) + i * 4);
          lo = Math.min(lo, x); hi = Math.max(hi, x); if (x > 0) nz++;
        }
        expect(lo).toBe(0);          // trunk base rigid
        expect(hi).toBe(1);          // crown fully weighted
        expect(nz).toBeGreaterThan(a.count * 0.2);
      }
    }
    const manifest = JSON.parse(readFileSync(join(TREES_DIR, 'manifest.json'), 'utf8'));
    for (const e of manifest.variants) expect(e.windWeight.attribute).toBe('_WINDWEIGHT');
  });

  (haveAssets ? it : it.skip)('manifest groups both species and records the UV0 audit', () => {
    const manifest = JSON.parse(readFileSync(join(TREES_DIR, 'manifest.json'), 'utf8'));
    const bySpecies = new Map<string, number>();
    for (const v of manifest.variants) bySpecies.set(v.species, (bySpecies.get(v.species) ?? 0) + 1);
    expect(bySpecies.get('tree_001')).toBe(4);
    expect(bySpecies.get('tree_002')).toBe(4);
    for (const s of ['tree_001', 'tree_002']) {
      const audit = manifest.species[s].variantChoice.uv0Audit;
      expect(audit.uv0Distinct).toBe(true);
      const hashes = (Object.values(audit.perVariant) as { glbUv0Sha256: string }[])
        .map((r) => r.glbUv0Sha256);
      expect(new Set(hashes).size).toBe(4);
      expect(manifest.species[s].wind._MainWindStrength).toBeGreaterThan(0);
    }
    // tree_002's zero towerDirection quirk is documented in the manifest
    expect(manifest.species.tree_002.natureTree.towerDirection).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('TreeView dispose', () => {
  it('removes all wrappers, frees fallback resources, ignores later calls', () => {
    const { root, view } = makeView(null);
    view.addTree(1, { x: 0, y: 0, z: 0 });
    view.addTree(2, { x: 1, y: 0, z: 0 });
    expect(root.children.length).toBe(2);
    // Fallback clones SHARE the view-owned geometries/materials — spy on
    // them through the instance meshes (no private-field access needed).
    const meshes: THREE.Mesh[] = [];
    wrapper(root, 1).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const resources = meshes.flatMap((m) => [m.geometry, m.material as THREE.Material]);
    const spies = resources.map((r) => vi.spyOn(r, 'dispose'));
    view.dispose();
    expect(root.children.length).toBe(0);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    view.addTree(3, { x: 0, y: 0, z: 0 }); // dead view: no-op
    view.update(0.016);
    view.onTowerBuilt(1);
    view.onTowerRemoved(1);
    expect(root.children.length).toBe(0);
    view.dispose(); // idempotent
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it('does NOT dispose caller-owned template resources', () => {
    const t0 = makeTemplate('v0');
    const mesh = t0.getObjectByName('v0_LOD0') as THREE.Mesh;
    const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    const { view } = makeView({ variants: [t0] });
    view.addTree(1, { x: 0, y: 0, z: 0 }, 0);
    view.removeTree(1);
    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
    view.addTree(2, { x: 0, y: 0, z: 0 }, 0);
    view.dispose(); // templates are caller-owned — still not disposed
    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
  });
});
