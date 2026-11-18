// TreeSurfaceMaps: manifest -> bump/metal texture selection (pure part).
import { describe, it, expect } from 'vitest';
import { pickSurfaceTextures } from '../../src/view/stage/TreeSurfaceMaps';

const variants = [
  { species: 'tree_001', textures: [
    { textureName: 'tree_001_Normal', file: 'a.png', webpFile: 'a.webp', slots: ['_BumpMap'] },
    { textureName: 'tree_001_Color', file: 'c.png', slots: ['_MainTex'] },
    { textureName: 'tree_001_Metal', file: 'm.png', webpFile: 'm.webp', slots: ['_MetallicGlossMap'] },
  ] },
  { species: 'tree_002', textures: [
    { textureName: 'tree_002_Normal', file: 'b.png', slots: ['_BumpMap'] },
  ] },
];

describe('pickSurfaceTextures', () => {
  it('finds the DXT5nm bump and metal/smoothness records per species', () => {
    const a = pickSurfaceTextures(variants, 'tree_001');
    expect(a.normal?.textureName).toBe('tree_001_Normal');
    expect(a.metal?.textureName).toBe('tree_001_Metal');
    const b = pickSurfaceTextures(variants, 'tree_002');
    expect(b.normal?.textureName).toBe('tree_002_Normal');
    expect(b.metal).toBeNull();
  });
  it('legacy manifests (no species) are tree_001; unknown species -> nulls', () => {
    expect(pickSurfaceTextures([{ textures: variants[0].textures }], 'tree_001').normal).not.toBeNull();
    expect(pickSurfaceTextures(variants, 'tree_009')).toEqual({ normal: null, metal: null });
  });
});
