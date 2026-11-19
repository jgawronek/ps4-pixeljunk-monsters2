// tests/view/rangeIndicator.test.ts
// RangeIndicator: ground range ring for the tree-select/build preview.
// Node-only — three math/scenegraph, no renderer (same approach as
// riverWater.test.ts). Values checked against the decomp evidence cited in
// the module header: unit geometry + radius scale (SetRadius @0x536c70),
// Unity-yellow default (SetupEffect @0x5369e0), 0.5 preview opacity
// (tower_001 detectColorPreview.a), x→−x mirror (StageSceneView convention).

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  RangeIndicator,
  ringGeometryParams,
  type RangeIndicatorOptions,
} from '../../src/view/stage/RangeIndicator';

/** tower_001 detect radius: attackRangeInner 2.0 + attackSpread 3.3
 *  (game.ts tower001Contract EnemyDetectorSphere stand-in). */
const TOWER_001_RADIUS = 5.3;
/** tower_001 buildRange — the cost-tree radius, usable as a footprint ring. */
const TOWER_001_BUILD_RANGE = 1.8;

function setup(opts?: RangeIndicatorOptions) {
  const root = new THREE.Group();
  const indicator = new RangeIndicator(root, opts);
  return { root, indicator };
}

function groupOf(root: THREE.Group): THREE.Group {
  return root.children[0] as THREE.Group;
}

function meshesOf(root: THREE.Group): { disc: THREE.Mesh; ring: THREE.Mesh } {
  const g = groupOf(root);
  return { disc: g.children[0] as THREE.Mesh, ring: g.children[1] as THREE.Mesh };
}

function matOf(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  return mesh.material as THREE.MeshBasicMaterial;
}

describe('ringGeometryParams', () => {
  it('returns inner = 0.96·r, outer = r and scales linearly', () => {
    for (const r of [TOWER_001_RADIUS, TOWER_001_BUILD_RANGE, 1, 12.5]) {
      const p = ringGeometryParams(r);
      expect(p.outer).toBe(r);
      expect(p.inner).toBeCloseTo(r * 0.96, 12);
      expect(p.inner).toBeLessThan(p.outer);
    }
    expect(ringGeometryParams(2).inner).toBeCloseTo(2 * ringGeometryParams(1).inner, 12);
  });
});

describe('RangeIndicator show/hide', () => {
  it('starts hidden but attached to the root', () => {
    const { root, indicator } = setup();
    expect(indicator.visible).toBe(false);
    expect(root.children.length).toBe(1);
    expect(groupOf(root).visible).toBe(false);
  });

  it('show mirrors unity x → −x, keeps z, lifts y by 0.02', () => {
    const { root, indicator } = setup();
    indicator.show({ x: 3, y: 0.5, z: -4 }, TOWER_001_RADIUS);
    const p = groupOf(root).position;
    expect(indicator.visible).toBe(true);
    expect(p.x).toBe(-3);
    expect(p.y).toBeCloseTo(0.52, 12);
    expect(p.z).toBe(-4);
  });

  it('show applies the radius as scale on unit ring/disc geometry', () => {
    const { root, indicator } = setup();
    indicator.show({ x: 0, y: 0, z: 0 }, TOWER_001_RADIUS);
    const g = groupOf(root);
    expect(g.scale.x).toBe(TOWER_001_RADIUS);
    expect(g.scale.y).toBe(TOWER_001_RADIUS);
    expect(g.scale.z).toBe(TOWER_001_RADIUS);
    // Unit-authored meshes (SetRadius @0x536c70 scales a unit effect mesh).
    const { disc, ring } = meshesOf(root);
    const rp = (ring.geometry as THREE.RingGeometry).parameters;
    expect(rp.innerRadius).toBeCloseTo(0.96, 12);
    expect(rp.outerRadius).toBe(1);
    expect((disc.geometry as THREE.CircleGeometry).parameters.radius).toBe(1);
    // World-space edge radii match the pure helper.
    const params = ringGeometryParams(TOWER_001_RADIUS);
    expect(g.scale.x * rp.outerRadius).toBeCloseTo(params.outer, 12);
    expect(g.scale.x * rp.innerRadius).toBeCloseTo(params.inner, 12);
  });

  it('hide clears visible; a later show re-enables at the new spot', () => {
    const { root, indicator } = setup();
    indicator.show({ x: 1, y: 0, z: 1 }, 2);
    indicator.hide();
    expect(indicator.visible).toBe(false);
    expect(groupOf(root).visible).toBe(false);
    indicator.show({ x: -2, y: 0, z: 3 }, TOWER_001_BUILD_RANGE);
    expect(indicator.visible).toBe(true);
    expect(groupOf(root).position.x).toBe(2);
    expect(groupOf(root).scale.x).toBe(TOWER_001_BUILD_RANGE);
  });

  it('non-positive or NaN radius hides instead of showing', () => {
    const { indicator } = setup();
    indicator.show({ x: 0, y: 0, z: 0 }, 3);
    for (const bad of [0, -1, NaN]) {
      indicator.show({ x: 0, y: 0, z: 0 }, bad);
      expect(indicator.visible).toBe(false);
    }
  });
});

describe('RangeIndicator pulse', () => {
  it('advances scale/opacity with dt when enabled (sin, quarter period peak)', () => {
    const { root, indicator } = setup({ pulse: true });
    indicator.show({ x: 0, y: 0, z: 0 }, TOWER_001_RADIUS);
    const g = groupOf(root);
    const { ring } = meshesOf(root);
    expect(g.scale.x).toBe(TOWER_001_RADIUS); // t=0 → sin 0 → base values
    expect(matOf(ring).opacity).toBeCloseTo(0.5, 12);
    indicator.update(0.5); // period 2s → sin(π/2) = 1 → peak
    expect(g.scale.x).toBeCloseTo(TOWER_001_RADIUS * 1.03, 10);
    expect(matOf(ring).opacity).toBeCloseTo(0.5 * 1.15, 10);
    indicator.update(0.5); // t=1 → sin(π) ≈ 0 → back to base
    expect(g.scale.x).toBeCloseTo(TOWER_001_RADIUS, 8);
    expect(matOf(ring).opacity).toBeCloseTo(0.5, 8);
  });

  it('is deterministic (time-based, no RNG) and resets phase on show', () => {
    const a = setup({ pulse: true });
    const b = setup({ pulse: true });
    const steps = [0.1, 0.23, 0.47, 0.05, 0.9];
    for (const s of [a, b]) {
      s.indicator.show({ x: 1, y: 0, z: 2 }, 3);
      for (const dt of steps) s.indicator.update(dt);
    }
    const ga = groupOf(a.root), gb = groupOf(b.root);
    expect(ga.scale.x).toBe(gb.scale.x);
    expect(matOf(meshesOf(a.root).ring).opacity).toBe(matOf(meshesOf(b.root).ring).opacity);
    // Re-show resets the phase to the exact base radius.
    a.indicator.show({ x: 1, y: 0, z: 2 }, 3);
    expect(ga.scale.x).toBe(3);
  });

  it('does nothing when pulse is disabled, hidden, or dt ≤ 0', () => {
    const plain = setup(); // pulse defaults off (base class has no pulse)
    plain.indicator.show({ x: 0, y: 0, z: 0 }, 4);
    plain.indicator.update(1.3);
    expect(groupOf(plain.root).scale.x).toBe(4);
    expect(matOf(meshesOf(plain.root).ring).opacity).toBeCloseTo(0.5, 12);

    const pulsed = setup({ pulse: true });
    pulsed.indicator.update(0.5); // hidden → no-op
    expect(pulsed.indicator.visible).toBe(false);
    pulsed.indicator.show({ x: 0, y: 0, z: 0 }, 4);
    pulsed.indicator.update(0);
    pulsed.indicator.update(-0.1);
    expect(groupOf(pulsed.root).scale.x).toBe(4);
  });
});

describe('RangeIndicator materials and options', () => {
  it('defaults to Unity yellow edge @ 0.5 with a fainter fill, flat on XZ', () => {
    const { root, indicator } = setup();
    indicator.show({ x: 0, y: 0, z: 0 }, 2);
    const { disc, ring } = meshesOf(root);
    const unityYellow = new THREE.Color().setRGB(
      1.0, 0.9215686321258545, 0.01568627543747425, THREE.SRGBColorSpace,
    );
    expect(matOf(ring).color.equals(unityYellow)).toBe(true);
    expect(matOf(ring).opacity).toBeCloseTo(0.5, 12);
    expect(matOf(disc).opacity).toBeCloseTo(0.125, 12); // fill = edge × 0.25
    for (const m of [disc, ring]) {
      const mat = matOf(m);
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
      // Geometry baked onto the ground plane: every vertex y ≈ 0.
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getY(i))).toBeLessThan(1e-12);
    }
  });

  it('honors custom color/opacity (e.g. tower_001 detectColorPreview orange)', () => {
    const previewOrange = new THREE.Color().setRGB(1, 0.5, 0.25, THREE.SRGBColorSpace);
    const { root, indicator } = setup({ color: previewOrange, opacity: 0.8 });
    indicator.show({ x: 0, y: 0, z: 0 }, 2);
    const { disc, ring } = meshesOf(root);
    expect(matOf(ring).color.equals(previewOrange)).toBe(true);
    expect(matOf(disc).color.equals(previewOrange)).toBe(true);
    expect(matOf(ring).opacity).toBeCloseTo(0.8, 12);
    expect(matOf(disc).opacity).toBeCloseTo(0.2, 12);
    // Hex representation works too.
    const hex = setup({ color: 0xff0000 });
    hex.indicator.show({ x: 0, y: 0, z: 0 }, 1);
    expect(matOf(meshesOf(hex.root).ring).color.equals(new THREE.Color(0xff0000))).toBe(true);
  });
});

describe('RangeIndicator dispose', () => {
  it('frees geometries/materials, detaches, and ignores later calls', () => {
    const { root, indicator } = setup({ pulse: true });
    indicator.show({ x: 0, y: 0, z: 0 }, 3);
    const { disc, ring } = meshesOf(root);
    const spies = [
      vi.spyOn(disc.geometry, 'dispose'),
      vi.spyOn(ring.geometry, 'dispose'),
      vi.spyOn(matOf(disc), 'dispose'),
      vi.spyOn(matOf(ring), 'dispose'),
    ];
    indicator.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(root.children.length).toBe(0);
    expect(indicator.visible).toBe(false);
    // Post-dispose calls are safe no-ops.
    indicator.show({ x: 0, y: 0, z: 0 }, 5);
    indicator.update(0.5);
    indicator.hide();
    indicator.dispose();
    expect(indicator.visible).toBe(false);
    expect(root.children.length).toBe(0);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });
});
// ---- terrain-conformed (projected) mode ----
import {
  conformedRingPositions, conformedDiscPositions, ringIndices, discIndices,
} from '../../src/view/stage/RangeIndicator';

describe('conformed ring (projected onto terrain)', () => {
  const slope = (x: number, z: number) => 0.5 * x + 0.25 * z; // tilted plane
  const c = { x: 3, y: 1.5 + 0.25 * 4, z: 4 };

  it('ring vertices follow the terrain height at their own (x,z), relative to the centre', () => {
    const pos = conformedRingPositions(c, 2, 0.96, 16, slope);
    for (let i = 0; i < 32; i++) {
      const lx = pos[i * 3], ly = pos[i * 3 + 1], lz = pos[i * 3 + 2];
      const wx = c.x - lx; // mirrored x
      const wz = c.z + lz;
      expect(ly + c.y).toBeCloseTo(slope(wx, wz), 5);
    }
  });

  it('ring radii are inner=0.96·r and outer=r around the centre', () => {
    const pos = conformedRingPositions(c, 5, 0.96, 8, () => 0);
    expect(Math.hypot(pos[0], pos[2])).toBeCloseTo(4.8, 6);
    expect(Math.hypot(pos[8 * 3], pos[8 * 3 + 2])).toBeCloseTo(5, 6);
  });

  it('disc has centre + radial rings, indices stay in range', () => {
    const pos = conformedDiscPositions(c, 3, 16, 4, slope);
    expect(pos.length / 3).toBe(1 + 4 * 16);
    const idx = discIndices(16, 4);
    expect(Math.max(...idx)).toBe(pos.length / 3 - 1);
    expect(Math.max(...ringIndices(16))).toBe(31);
  });

  it('indicator with a height provider builds terrain-following geometry at scale 1', () => {
    const { root, indicator } = (() => {
      const r = new THREE.Group();
      return { root: r, indicator: new RangeIndicator(r) };
    })();
    indicator.setHeightProvider(slope);
    indicator.show({ x: 3, y: slope(3, 4), z: 4 }, 2);
    const g = root.children[0] as THREE.Group;
    expect(g.scale.x).toBe(1);
    expect(g.position.x).toBe(-3);
    const ring = g.children[1] as THREE.Mesh;
    const p = ring.geometry.getAttribute('position');
    const ys = Array.from({ length: p.count }, (_, i) => p.getY(i));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5); // not flat
    indicator.setHeightProvider(null);
    indicator.show({ x: 3, y: 0, z: 4 }, 2);
    expect(g.scale.x).toBe(2); // back to flat unit geometry
  });
});

describe('RangeIndicator decal sink (depth-projected ring)', () => {
  it('publishes a mirrored world-space decal instead of showing meshes, and removes it on hide/dispose', () => {
    const scene = new THREE.Scene();
    const ri = new RangeIndicator(scene, { opacity: 0.5 });
    const calls: unknown[] = [];
    ri.setDecalSink({ setRangeDecal: (id, d) => calls.push([id, d]) });
    ri.show({ x: 3, y: 1, z: -2 }, 5.3);
    const d = (calls[0] as [string, { x: number; y: number; z: number; radius: number; alpha: number }])[1];
    expect(d).toMatchObject({ x: -3, y: 1, z: -2, radius: 5.3, alpha: 0.5 });
    expect(ri.visible).toBe(true);
    expect(scene.getObjectByName('RangeIndicator')?.visible).toBe(false); // no mesh drawn
    ri.hide();
    expect((calls[1] as [string, unknown])[1]).toBeNull();
    expect(ri.visible).toBe(false);
  });
});
