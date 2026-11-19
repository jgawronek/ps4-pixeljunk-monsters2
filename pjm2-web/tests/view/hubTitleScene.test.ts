import { describe, expect, it } from 'vitest';
import { HUB_CHIBIS, HUB_TREES } from '../../src/data/hubTrees.generated';
import { RAINBOW, rainbowAlpha } from '../../src/view/hub/TitleRainbow';

describe('hub title scene data (decoded from 3d_stage_000)', () => {
  it('has the 65 active nature-tree PrefabLoader nodes over 6 species and the 10 NPC chibis', () => {
    expect(HUB_TREES.length).toBe(65);
    const sp = new Set(HUB_TREES.map((t) => t.species));
    expect([...sp].sort()).toEqual(['tree_001', 'tree_002', 'tree_006', 'tree_007', 'tree_008', 'tree_010']);
    expect(HUB_CHIBIS.length).toBe(10);
  });
  it('rainbow emitter: alpha 0 -> 1 (0.3..0.6) -> 0 over the 0.5 s lifetime; 40 x 20 billboard with pivot lift', () => {
    expect(rainbowAlpha(0)).toBe(0);
    expect(rainbowAlpha(0.3)).toBeCloseTo(1, 6);
    expect(rainbowAlpha(0.45)).toBeCloseTo(1, 6);
    expect(rainbowAlpha(1)).toBe(0);
    expect(rainbowAlpha(0.15)).toBeCloseTo(0.5, 6);
    expect(RAINBOW.width).toBe(40); // size3D 8 x 4, hierarchy scale 5
    expect(RAINBOW.height).toBe(20);
    expect(RAINBOW.pivotY).toBe(0.76);
    expect(RAINBOW.startAlpha).toBeCloseTo(0.251, 3);
    expect(RAINBOW.startDelay).toBe(2.5);
  });
});
