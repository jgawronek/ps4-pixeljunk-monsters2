import { describe, expect, it } from 'vitest';
import { maskPose } from '../../src/view/ui/TitleFeature';

describe('title mask (LogoMonster clip)', () => {
  it('rests at x = 447 (pivot right edge), not the prefab static 410', () => {
    const p = maskPose(0);
    expect(p.left).toBe(447 - 74);
    expect(p.top).toBe(235 - 50);
    expect([p.rot, p.sx, p.sy]).toEqual([0, 1, 1]);
    expect(maskPose(5).left).toBe(447 - 74);
  });
  it('pops out at 10 s: +43 px, -20 deg, squashed, then returns at 15.2 s; loops every 60.2 s', () => {
    const o = maskPose(10.1667);
    expect(o.left).toBeCloseTo(490 - 74, 1);
    expect(o.rot).toBeCloseTo(-20, 1);
    expect(o.sx).toBeCloseTo(0.5, 2);
    expect(maskPose(15.2).left).toBe(447 - 74);
    expect(maskPose(60.2 + 10.1667).left).toBeCloseTo(490 - 74, 1);
  });
});
