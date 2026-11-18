import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bloomDerive, bloomPrefilterWeight, gammaToLinear } from '../../src/view/stage/PostBloom';
import { patchAoChunks, linearEyeDepth, obscuranceTerm, obscuranceToFactor, AO_PARS_GLSL } from '../../src/view/stage/StageAO';
import { renderExtrasFor } from '../../src/view/stage/renderExtras';
import { stageEnvironmentFor } from '../../src/view/stage/StageEnvironment';

describe('bloom parameters (PPSv1 BloomComponent)', () => {
  const p = { intensity: 0.75, threshold: 1.1, softKnee: 0.85, radius: 2, antiFlicker: false };
  it('iteration count / sample scale follow log2(h/2)+radius-8', () => {
    const d = bloomDerive(p, 1080);
    expect(d.levels).toBe(3);
    expect(d.sampleScale).toBeCloseTo(0.5 + (Math.log2(540) + 2 - 8 - 3), 6);
    expect(bloomDerive(p, 360).levels).toBe(1);
  });
  it('soft knee curve', () => {
    const d = bloomDerive(p, 720);
    const t = gammaToLinear(1.1);
    expect(d.curve[0]).toBeCloseTo(t - (t * 0.85 + 1e-5), 6);
    expect(bloomPrefilterWeight(0.1, d)).toBe(0);
    const w = bloomPrefilterWeight(1, d); // LDR white
    expect(w).toBeGreaterThan(0.1); expect(w).toBeLessThan(0.25);
  });
});

describe('AO', () => {
  it('chunk patch applies to the real three ShaderChunk text', () => {
    const C = THREE.ShaderChunk as unknown as Record<string, string>;
    const before = C.lights_fragment_end;
    patchAoChunks();
    expect(C.lights_fragment_end).toContain('reflectedLight.indirectDiffuse *= pjmAo');
    expect(C.lights_fragment_end.startsWith(before)).toBe(true);
    expect(C.lights_pars_begin.startsWith(AO_PARS_GLSL)).toBe(true);
    patchAoChunks(); // idempotent
    expect(C.lights_pars_begin.split('uniform sampler2D tPjmAo').length).toBe(2);
    // expanded meshphysical fragment still includes the patched chunks
    expect(THREE.ShaderLib.physical.fragmentShader).toContain('#include <lights_fragment_end>');
  });
  it('depth linearisation matches the projection matrix', () => {
    const cam = new THREE.PerspectiveCamera(22.5, 16 / 9, 0.3, 1000);
    const e = cam.projectionMatrix.elements;
    for (const d of [1, 10, 40, 500]) {
      const clipZ = e[10] * -d + e[14];
      const z01 = (clipZ / d) * 0.5 + 0.5;
      expect(linearEyeDepth(z01, e[10], e[14])).toBeCloseTo(d, 3);
    }
  });
  it('obscurance: occluder in front of the normal darkens, flat ground does not', () => {
    expect(obscuranceTerm([0, 0, 0.2], [0, 0, 1], 10)).toBeGreaterThan(1);
    expect(obscuranceTerm([0.2, 0, 0], [0, 0, 1], 10)).toBe(0);
    expect(obscuranceToFactor(0, { intensity: 1.3, radius: 0.3, sampleCount: 3 })).toBe(1);
    expect(obscuranceToFactor(50, { intensity: 1.3, radius: 0.3, sampleCount: 3 })).toBeLessThan(0.5);
  });
});

describe('renderExtrasFor', () => {
  it('stage 1: AO only; stage 4: both; flags disable', () => {
    const q = (...k: string[]) => ({ has: (x: string) => k.includes(x) });
    const s1 = renderExtrasFor(stageEnvironmentFor('3d_stage_001'), q());
    expect(s1.bloom).toBeNull(); expect(s1.ao?.intensity).toBeCloseTo(1.3);
    const s4 = renderExtrasFor(stageEnvironmentFor('3d_stage_004'), q());
    expect(s4.bloom?.intensity).toBeCloseTo(0.75); expect(s4.ao).not.toBeNull();
    const off = renderExtrasFor(stageEnvironmentFor('3d_stage_004'), q('nobloom', 'noao'));
    expect(off.bloom).toBeNull(); expect(off.ao).toBeNull();
  });
});

import { lodIndexForHeight, screenRelativeHeight, grassColorT, buildGrassGeometry, createGrassMaterial, type GrassFile } from '../../src/view/stage/GrassView';
import { readFileSync } from 'node:fs';

describe('grass (GrassInstanceRenderer port)', () => {
  const file = JSON.parse(readFileSync('public/assets/grass/grass.json', 'utf8')) as GrassFile;
  it('extracted data: 3 LODs, 74 / 48 instances', () => {
    const p = file.prefabs.grass_001;
    expect(p.lods.map((l) => l.mesh.vertexCount)).toEqual([180, 100, 60]);
    expect(p.lods.map((l) => l.screenRelativeHeight)).toEqual([0.147432, 0.0961037, 0.0232759]);
    expect(file.stages['3d_stage_001']).toHaveLength(74);
    expect(file.stages['3d_stage_005']).toHaveLength(48);
    expect(file.stages['3d_stage_007']).toBeUndefined();
  });
  it('LOD rule + hash', () => {
    const th = [0.147, 0.096, 0.023];
    expect(lodIndexForHeight(0.2, th)).toBe(0);
    expect(lodIndexForHeight(0.1, th)).toBe(1);
    expect(lodIndexForHeight(0.05, th)).toBe(2);
    expect(lodIndexForHeight(0.01, th)).toBe(-1);
    expect(screenRelativeHeight(0.774, 25, 22.5)).toBeCloseTo(0.0779, 3);
    const t = grassColorT(2.4162, 12.8952);
    expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThan(1);
  });
  it('geometry mirrors X, keeps counts; material shader patch applies to the real MeshStandard source', () => {
    const lod = file.prefabs.grass_001.lods[0];
    const g = buildGrassGeometry(lod.mesh);
    expect(g.getAttribute('position').count).toBe(180);
    expect(g.index!.count).toBe(540);
    const m = createGrassMaterial(lod, { value: 0 });
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain('vGrassT = fract');
    expect(shader.fragmentShader).toContain('mix( uGrassColor1, uGrassColor2, vGrassT )');
  });
});

import { alphaAt, weatherViewFor, type WeatherFile } from '../../src/view/stage/WeatherView';

describe('weather (StageWeatherPlayer port)', () => {
  const wf = JSON.parse(readFileSync('public/assets/particles/weather.json', 'utf8')) as WeatherFile;
  it('stage mapping: 4-6 sand, 11 snow, 10/12 none (null prefab)', () => {
    expect(wf.stageEmitter['3d_stage_004']).toBe('ps_env_sand_cloud');
    expect(wf.stageEmitter['3d_stage_011']).toBe('ps_env_snow_area');
    expect(weatherViewFor('3d_stage_010', wf)).toBeNull();
    expect(weatherViewFor('3d_stage_012', wf)).toBeNull();
    expect(weatherViewFor('3d_stage_001', wf)).toBeNull();
    expect(wf.players['3d_stage_004'][0]).toMatchObject({ intervalMin: 10, intervalMax: 60 });
    expect(wf.players['3d_stage_011'][0]).toMatchObject({ intervalMin: 20, intervalMax: 60 });
  });
  it('plays, emits for the duration and ages out', () => {
    const v = weatherViewFor('3d_stage_004', wf)!;
    v.play(new THREE.Vector3(0, 0, 0));
    const tgt = new THREE.Vector3();
    for (let i = 0; i < 70; i++) v.update(1 / 60, tgt);
    expect(v.alive).toBeGreaterThan(20);
    for (let i = 0; i < 60 * 20; i++) v.update(1 / 60, tgt);
    expect(v.alive).toBe(0);
  });
  it('alpha gradient', () => {
    const k = [{ time: 0, a: 0 }, { time: 0.2, a: 0.125 }, { time: 0.8, a: 0 }];
    expect(alphaAt(k, 0.1)).toBeCloseTo(0.0625); expect(alphaAt(k, 0.5)).toBeCloseTo(0.0625); expect(alphaAt(k, 1)).toBe(0);
  });
});
