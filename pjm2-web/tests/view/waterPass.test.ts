import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WaterPass, WATER_LAYER } from '../../src/view/stage/WaterPass';

describe('WaterPass', () => {
  const make = () =>
    new WaterPass({} as THREE.WebGLRenderer, new THREE.Scene(), 0x81b5d4);

  it('copy pass keeps the depth test ON (always-pass) so depth is written for occlusion', () => {
    const mat = (make() as unknown as { copyMat: THREE.ShaderMaterial }).copyMat;
    // depthTest=false would silently disable depth writes in GL and let the
    // water draw over the bridge/player.
    expect(mat.depthTest).toBe(true);
    expect(mat.depthFunc).toBe(THREE.AlwaysDepth);
    expect(mat.depthWrite).toBe(true);
  });

  it('moves river meshes to the water-only layer', () => {
    const wp = make();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial());
    wp.setWater([mesh], new THREE.ShaderMaterial());
    expect(mesh.layers.isEnabled(WATER_LAYER)).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(false);
    expect(wp.active).toBe(true);
  });
});
