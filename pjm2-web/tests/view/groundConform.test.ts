// tests/view/groundConform.test.ts
// GroundConform (view-side terrain conform) against a FAKE linecast seam —
// pure logic, no Rapier/DOM/three. Real-world probe parity lives in
// tests/physics/world.test.ts (groundHeight on the extracted stage world).
//
// Contract under test (src/view/stage/GroundConform.ts):
//   - downward linecast (x,+40,z)→(x,−40,z) with Q4.Layers.TerrainMask
//   - null seam / miss → fallback 0
//   - first sample per entity snaps (spawn); |delta|>2 snaps (teleport)
//   - otherwise exponential approach y += Δ*(1−exp(−k*dt)), k=12 default
//   - per-entity cache keys; reset() clears them

import { describe, it, expect } from 'vitest';

import { GroundConform } from '../../src/view/stage/GroundConform';
import { Q4Layers } from '../../src/core/physics-seam';
import type { LinecastQuery } from '../../src/engine/physics/queries';
import type { RaycastHit } from '../../src/engine/physics/queries';

// ---- fake seam ----------------------------------------------------------------

interface FakeCall {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  mask: number;
}

/** heightAt(x,z) → terrain y, or null for a miss. Records every linecast. */
function fakeQueries(
  heightAt: (x: number, z: number) => number | null,
): LinecastQuery & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    linecast(ax, ay, az, bx, by, bz, mask): RaycastHit | null {
      calls.push({ ax, ay, az, bx, by, bz, mask });
      const h = heightAt(ax, az);
      if (h === null) return null;
      return {
        point: [ax, h, az],
        normal: [0, 1, 0],
        distance: Math.abs(ay - h),
        colliderName: 'fake-terrain',
        layer: 29,
        layerName: 'Art_Terrain',
        isTrigger: false,
      };
    },
  };
}

const DT = 1 / 60;

// ---- tests --------------------------------------------------------------------

describe('GroundConform', () => {
  it('null queries → always fallback 0', () => {
    const gc = new GroundConform(null);
    expect(gc.sample(0, 0, DT)).toBe(0);
    expect(gc.sample(3, -4, DT)).toBe(0);
    expect(gc.sample(3, -4, 0.5, 'enemy-7')).toBe(0);
    expect(gc.groundHeight(0, 0)).toBe(0);
  });

  it('first sample snaps to the probed height (spawn), then holds', () => {
    const gc = new GroundConform(fakeQueries(() => 1.76));
    expect(gc.sample(0, 0, DT)).toBe(1.76); // no lerp-up from underground
    expect(gc.sample(0, 0, DT)).toBe(1.76);
    expect(gc.sample(0, 0, DT)).toBe(1.76);
  });

  it('probes straight down with TerrainMask and the default ±40 span', () => {
    const fake = fakeQueries(() => 0);
    const gc = new GroundConform(fake);
    gc.sample(3, -4, DT);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      ax: 3, ay: 40, az: -4,
      bx: 3, by: -40, bz: -4,
      mask: Q4Layers.terrainMask, // 0xE0000000 = -536870912
    });
    expect(Q4Layers.terrainMask).toBe(-536870912);

    const custom = fakeQueries(() => 0);
    new GroundConform(custom, { rayUp: 5, rayDown: -3, mask: 1 << 29 }).sample(1, 2, DT);
    expect(custom.calls[0]).toEqual({
      ax: 1, ay: 5, az: 2,
      bx: 1, by: -3, bz: 2,
      mask: 1 << 29,
    });
  });

  it('converges exponentially to a changed target (k=12)', () => {
    let h = 1.0;
    const gc = new GroundConform(fakeQueries(() => h));
    expect(gc.sample(0, 0, DT)).toBe(1.0); // spawn snap initializes the cache
    h = 1.5; // small delta (≤2) → smooth
    const y1 = gc.sample(0, 0, DT);
    expect(y1).toBeCloseTo(1.0 + 0.5 * (1 - Math.exp(-12 * DT)), 12);
    let y = y1;
    for (let i = 0; i < 120; i++) y = gc.sample(0, 0, DT); // 2 s
    expect(y).toBeCloseTo(1.5, 4);
  });

  it('smoothing is monotone and bounded, up and down', () => {
    let h = 0;
    const gc = new GroundConform(fakeQueries(() => h));
    gc.sample(0, 0, DT); // init at 0
    h = 1;
    let prev = 0;
    for (let i = 0; i < 30; i++) {
      const y = gc.sample(0, 0, DT);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
    h = 0.25; // delta ≤ 2 → smooth back down
    for (let i = 0; i < 30; i++) {
      const y = gc.sample(0, 0, DT);
      expect(y).toBeLessThanOrEqual(prev);
      expect(y).toBeGreaterThanOrEqual(0.25);
      prev = y;
    }
  });

  it('snaps when |delta| > 2 (teleports), smooths at exactly 2', () => {
    let h = 0;
    const gc = new GroundConform(fakeQueries(() => h));
    expect(gc.sample(0, 0, DT)).toBe(0);
    h = 5;
    expect(gc.sample(0, 0, DT)).toBe(5); // one call, no easing
    h = 0;
    expect(gc.sample(0, 0, DT)).toBe(0); // downward teleport snaps too
    h = 2; // boundary: |delta| == 2 is NOT a snap
    const y = gc.sample(0, 0, DT);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(2);
  });

  it('miss → 0 fallback (immediate on spawn, smoothed from a cached height)', () => {
    let h: number | null = 1;
    const gc = new GroundConform(fakeQueries(() => h));
    expect(gc.sample(0, 0, DT)).toBe(1); // spawn snap onto terrain
    h = null; // terrain disappears under the entity → ease toward 0 (Δ=1 ≤ 2)
    const y1 = gc.sample(0, 0, DT);
    expect(y1).toBeGreaterThan(0);
    expect(y1).toBeLessThan(1);
    let y = y1;
    for (let i = 0; i < 120; i++) y = gc.sample(0, 0, DT);
    expect(y).toBeCloseTo(0, 4);
    // miss already at spawn → immediate 0, no cache to smooth from
    const gc2 = new GroundConform(fakeQueries(() => null));
    expect(gc2.sample(5, 5, DT)).toBe(0);
    expect(gc2.sample(5, 5, DT)).toBe(0);
  });

  it('reset() clears the cache — the next sample snaps again', () => {
    let h = 1;
    const gc = new GroundConform(fakeQueries(() => h));
    gc.sample(0, 0, DT); // cache 1
    h = 1.5;
    const mid = gc.sample(0, 0, DT); // partway: 1 < mid < 1.5
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.5);
    gc.reset();
    expect(gc.sample(0, 0, DT)).toBe(1.5); // snap proves the cache was cleared
  });

  it('per-entity keys cache independently; reset clears all of them', () => {
    const heights = new Map<number, number>([[1, 1], [2, 2]]);
    const gc = new GroundConform(fakeQueries((x) => heights.get(x) ?? null));
    expect(gc.sample(1, 0, DT, 'a')).toBe(1);
    expect(gc.sample(2, 0, DT, 'b')).toBe(2);
    heights.set(1, 1.5);
    heights.set(2, 2.25);
    let a = 0, b = 0;
    for (let i = 0; i < 120; i++) {
      a = gc.sample(1, 0, DT, 'a');
      b = gc.sample(2, 0, DT, 'b');
    }
    expect(a).toBeCloseTo(1.5, 4);
    expect(b).toBeCloseTo(2.25, 4);
    gc.reset();
    expect(gc.sample(1, 0, DT, 'a')).toBe(1.5);
    expect(gc.sample(2, 0, DT, 'b')).toBe(2.25);
  });

  it('dt ≤ 0 holds the cached height (teleport snaps still apply)', () => {
    let h = 1;
    const gc = new GroundConform(fakeQueries(() => h));
    gc.sample(0, 0, DT);
    h = 1.5;
    expect(gc.sample(0, 0, 0)).toBe(1);
    expect(gc.sample(0, 0, -1)).toBe(1);
    expect(gc.sample(0, 0, DT)).toBeGreaterThan(1); // resumes smoothing
    h = 9;
    expect(gc.sample(0, 0, 0)).toBe(9); // snap is dt-independent
  });

  it('honors a custom smoothing rate', () => {
    let h = 1;
    const fake = fakeQueries(() => h);
    const frozen = new GroundConform(fake, { smoothing: 0 });
    const fast = new GroundConform(fake, { smoothing: 24 });
    frozen.sample(0, 0, DT);
    fast.sample(0, 0, DT);
    h = 1.5;
    expect(frozen.sample(0, 0, DT)).toBe(1); // k=0 → 1−exp(0) = 0
    expect(fast.sample(0, 0, DT)).toBeCloseTo(1 + 0.5 * (1 - Math.exp(-24 * DT)), 12);
  });
});
