import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Regression: the hut GLB's mesh node must reference its skin, otherwise three.js loads a plain Mesh and the curtain clip deforms nothing.
describe('hub hut GLB (home_001_comp)', () => {
  const buf = readFileSync('public/assets/stages/3d_stage_000/hut/home_001_comp.glb');
  const j = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name: string; mesh?: number; skin?: number }[]; skins: { joints: number[] }[];
  };
  it('binds the mesh node to the skin (12 joints)', () => {
    const meshNodes = j.nodes.filter((n) => n.mesh !== undefined);
    expect(meshNodes.length).toBe(1);
    expect(meshNodes[0].skin).toBe(0);
    expect(j.skins[0].joints.length).toBe(12);
  });
});
