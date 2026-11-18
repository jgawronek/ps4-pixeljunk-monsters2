// tests/core/cylinder-currency.test.ts
import { describe, expect, it } from 'vitest';

import { CurrencyValueInfo } from '../../src/core/CurrencyValueInfo';
import { Cylinder } from '../../src/core/Cylinder';

describe('Cylinder', () => {
  it('stores fround-ed radius/height', () => {
    const c = new Cylinder(1.75, 0.925);
    expect(c.radius).toBe(Math.fround(1.75));
    expect(c.height).toBe(Math.fround(0.925));
  });

  it('fromBounds: height = size.y, radius = Lerp(min,max,0.2) of XZ extents', () => {
    // GameCoreHome's viewer-bounds case as a representative example.
    const c = Cylinder.fromBounds({
      size: { x: 2, y: 3, z: 4 },
      extents: { x: 1, y: 1.5, z: 2 },
    });
    expect(c.height).toBe(3);
    // min=1, max=2 → 1 + (2-1)*0.2 = 1.2
    expect(c.radius).toBeCloseTo(1.2, 6);
  });

  it('fromBounds is fp32-exact', () => {
    const c = Cylinder.fromBounds({
      size: { x: 0.1, y: 0.30000001192092896, z: 0.1 },
      extents: { x: 0.05, y: 0.15, z: 0.07 },
    });
    const min = Math.fround(0.05);
    const max = Math.fround(0.07);
    const expected = Math.fround(min + Math.fround(Math.fround(max - min) * Math.fround(0.2)));
    expect(c.radius).toBe(expected);
  });
});

describe('CurrencyValueInfo', () => {
  it('stores int total/perValue', () => {
    const v = new CurrencyValueInfo(10, 5);
    expect(v.total).toBe(10);
    expect(v.perValue).toBe(5);
    const w = new CurrencyValueInfo(0, 0);
    expect(w.total).toBe(0);
  });
});
