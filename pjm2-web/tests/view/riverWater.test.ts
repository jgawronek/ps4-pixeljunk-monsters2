// tests/view/riverWater.test.ts
// Faithful Nature/Water port: render state, uniform wiring, live time,
// scene-input plumbing, and the constants lifted from the original GCN
// program (docs/WATER_SHADER_ANALYSIS.md). Node-only (no GL context).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createRiverWaterMaterial,
  setRiverTextures,
  setRiverSceneInputs,
  clearRiverSceneInputs,
  tickRiverWater,
  RIVER_UNIFORMS as U,
} from '../../src/view/stage/RiverWaterMaterial';

// Stage-1 source values (scene-webp.json materials['terrain_001_river_m']).
function make() {
  return createRiverWaterMaterial({
    flowSpeed: 0.3,
    color1: new THREE.Color().setRGB(0.286, 0.542, 0.794, THREE.SRGBColorSpace),
    f0: 0.05, scatteringHeight: 0.03, specStrength: 0.15, refractScale: 0.05,
    normalScale: [10, 10], normalOffset: [0, 0],
  });
}

describe('createRiverWaterMaterial', () => {
  it('uses the serialized render state: Blend One Zero, ZWrite off, ZTest on, Cull Off', () => {
    const m = make();
    expect(m.blending).toBe(THREE.NoBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.side).toBe(THREE.DoubleSide);
  });

  it('carries the material floats; _Color1 is linearised, deep _Color is unused', () => {
    const m = make();
    expect(m.uniforms[U.flowSpeed].value).toBeCloseTo(0.3);
    expect(m.uniforms[U.f0].value).toBeCloseTo(0.05);
    expect(m.uniforms[U.scatteringHeight].value).toBeCloseTo(0.03);
    expect(m.uniforms[U.specStrength].value).toBeCloseTo(0.15);
    expect(m.uniforms[U.refractScale].value).toBeCloseTo(0.05);
    expect((m.uniforms[U.normalScale].value as THREE.Vector2).toArray()).toEqual([10, 10]);
    const c = m.uniforms[U.color1].value as THREE.Color;
    expect(c.b).toBeCloseTo(Math.pow((0.794 + 0.055) / 1.055, 2.4), 2); // sRGB → linear
    expect(m.fragmentShader).not.toContain('uColor0');
  });

  it('starts with no scene inputs and no textures (flat-tint fallback)', () => {
    const m = make();
    expect(m.uniforms[U.hasScene].value).toBe(0);
    expect(m.uniforms[U.hasFlow].value).toBe(0);
    expect(m.uniforms[U.hasNormal].value).toBe(0);
    expect(m.uniforms[U.hasSky].value).toBe(0);
  });
});

describe('shader constants lifted from the original ISA', () => {
  const f = make().fragmentShader;
  it('unpacks the DXT5nm normal from (alpha, green) with reconstructed z', () => {
    expect(f).toContain('vec2( a.a, a.g ) * 2.0 - 1.0');
    expect(f).toContain('sqrt( 1.0 - min( 1.0, dot( xa, xa ) ) )');
  });
  it('flow phases: period 3.5 s, half-period offset, triangle weight, raw (un-remapped) flow rg', () => {
    expect(f).toContain('fract( uTime * 0.285714 )');
    expect(f).toContain('fract( uTime * 0.285714 + 0.5 )');
    expect(f).toContain('1.0 - 2.0 * abs( p1 - 0.5 )');
    expect(f).toContain('texture2D( tFlow, vUv ).rg');
    expect(f).not.toContain('tFlow, vUv ).rg * 2.0');
  });
  it('refraction, depth and fresnel constants', () => {
    expect(f).toContain('0.333 * clamp( 3.33333');
    expect(f).toContain('50.0 * ( vWorld.y - yR )');
    expect(f).toContain('6.66667 * depth');
    expect(f).toContain('pow( f1, 5.0 ) * ( 1.0 - uF0 ) + uF0');
    expect(f).toContain('dR < gl_FragCoord.z - 0.0001');
  });
  it('final composite mirrors the original', () => {
    expect(f).toContain('uColor1 * ( depth * depth * depth ) + uRefractScale * bg + fres * uSpecStrength * sky');
    expect(f).toContain('mix( bgS, water, m )');
  });
  it('has no vertex waves (original vertex stage is plain MVP)', () => {
    const v = make().vertexShader;
    expect(v).not.toMatch(/sin\(|cos\(/);
  });
});

describe('setRiverTextures', () => {
  it('flips the has-flags and stores textures', () => {
    const m = make();
    const flow = new THREE.Texture(), normal = new THREE.Texture(), sky = new THREE.CubeTexture();
    setRiverTextures(m, { flow, normal });
    expect(m.uniforms[U.flow].value).toBe(flow);
    expect(m.uniforms[U.hasFlow].value).toBe(1);
    expect(m.uniforms[U.hasNormal].value).toBe(1);
    expect(m.uniforms[U.hasSky].value).toBe(0);
    setRiverTextures(m, { sky });
    expect(m.uniforms[U.hasSky].value).toBe(1);
    expect(m.uniforms[U.hasFlow].value).toBe(1); // untouched by a partial update
    setRiverTextures(m, { flow: null });
    expect(m.uniforms[U.hasFlow].value).toBe(0);
  });
  it('throws on a non-river material', () => {
    expect(() => setRiverTextures(new THREE.ShaderMaterial(), {})).toThrow();
  });
});

describe('tickRiverWater', () => {
  it('accumulates in float32 and patches the uniform', () => {
    const m = make();
    let want = 0;
    for (let i = 0; i < 100; i++) { tickRiverWater(m, 1 / 60); want = Math.fround(want + 1 / 60); }
    expect(m.uniforms[U.time].value).toBe(want);
  });
});

describe('setRiverSceneInputs', () => {
  it('feeds grab/depth/size and the camera matrices', () => {
    const m = make();
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.3, 300);
    cam.position.set(1, 2, 3); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const bg = new THREE.Texture(), depth = new THREE.Texture();
    setRiverSceneInputs(m, { bg, depth, width: 1920, height: 1080, camera: cam });
    expect(m.uniforms[U.hasScene].value).toBe(1);
    expect(m.uniforms[U.bg].value).toBe(bg);
    expect((m.uniforms[U.res].value as THREE.Vector2).toArray()).toEqual([1920, 1080]);
    expect((m.uniforms[U.nearFar].value as THREE.Vector2).toArray()).toEqual([0.3, 300]);
    const p = m.uniforms[U.proj].value as THREE.Vector4;
    expect(p.x).toBeCloseTo(cam.projectionMatrix.elements[0]);
    expect(p.y).toBeCloseTo(cam.projectionMatrix.elements[5]);
    expect(m.uniforms[U.ortho].value).toBe(0);
    expect((m.uniforms[U.camWorld].value as THREE.Matrix4).elements[12]).toBeCloseTo(1);
    clearRiverSceneInputs(m);
    expect(m.uniforms[U.hasScene].value).toBe(0);
  });
  it('flags orthographic cameras', () => {
    const m = make();
    const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    setRiverSceneInputs(m, { bg: new THREE.Texture(), depth: new THREE.Texture(), width: 8, height: 8, camera: cam });
    expect(m.uniforms[U.ortho].value).toBe(1);
  });
});
