import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCurtainClip } from '../../src/view/hub/HubHut';

describe('hub hut curtain clip (home_001_ctrl)', () => {
  const doc = JSON.parse(readFileSync(new URL('../../public/assets/stages/3d_stage_000/hut/clips.json', import.meta.url), 'utf8'));
  it('is the 1.4583 s non-looping `curtain` clip with rotation/position/scale tracks on the Curtain bones', () => {
    const c = buildCurtainClip(doc)!;
    expect(c.duration).toBeCloseTo(1.4583, 3);
    expect(c.tracks.some((t) => t.name === 'Curtain_Mid_02_Bn.quaternion')).toBe(true);
    expect(c.tracks.length).toBeGreaterThan(20);
  });
});
