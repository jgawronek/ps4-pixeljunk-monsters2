import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleRange, sheetFrame } from '../../src/view/particles/SheetParticles';

const file = JSON.parse(readFileSync(new URL('../../public/assets/particles/particles.json', import.meta.url), 'utf8'));
const ice = file.emitters.find((e: { name: string }) => e.name === 'ps_tower_ice_flow');

describe('texture-sheet particles (ice spray)', () => {
  it('extracted ice flow carries the 8x8 sheet + velocity module', () => {
    expect(ice.textureSheet.tilesX).toBe(8);
    expect(ice.textureSheet.tilesY).toBe(8);
    expect(ice.velocityOverLifetime.inWorldSpace).toBe(true);
    expect(ice.texture.name).toBe('vfx_fireball_anim');
  });
  it('plays the whole sheet over the particle lifetime (frame 0 -> 63)', () => {
    expect(sheetFrame(ice.textureSheet, 0)).toBe(0);
    expect(sheetFrame(ice.textureSheet, 0.5)).toBeGreaterThan(25);
    expect(sheetFrame(ice.textureSheet, 0.5)).toBeLessThan(36);
    expect(sheetFrame(ice.textureSheet, 1)).toBe(63);
  });
  it('twoCurves velocity lerps between the min and max curve per particle', () => {
    const x = ice.velocityOverLifetime.x;
    expect(sampleRange(x, 1, 0)).toBeCloseTo(-1, 3);
    expect(sampleRange(x, 1, 1)).toBeCloseTo(1, 3);
    expect(sampleRange(x, 0, 0.5)).toBeCloseTo((-0.065361 + 0.052284) / 2, 3);
  });
});
