import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { patchUnityStandardFragment, installUnityStandardMaps } from '../../src/view/stage/UnityStandardMaps';

const frag = THREE.ShaderLib.standard.fragmentShader
  .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
  .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment)
  .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment);

describe('Unity Standard map semantics', () => {
  it('patches the REAL unresolved shader source (#include directives), as onBeforeCompile sees it', () => {
    const raw = THREE.ShaderLib.standard.fragmentShader;
    expect(raw).toContain('#include <roughnessmap_fragment>');
    const out = patchUnityStandardFragment(raw, { hasNormalMap: true, hasMetalGlossMap: true, glossMapScale: 1 });
    expect(out).toContain('dxt5nm.wy * 2.0 - 1.0');
    expect(out).toContain('texelRoughness.a');
    expect(out).toContain('texelMetalness.r');
    expect(out).not.toContain('texelRoughness.g');
  });
  it('replaces the DXT5nm normal unpack (x=A, y=G, z reconstructed)', () => {
    const out = patchUnityStandardFragment(frag, { hasNormalMap: true, hasMetalGlossMap: false, glossMapScale: 1 });
    expect(out).toContain('dxt5nm.wy * 2.0 - 1.0');
    expect(out).toContain('sqrt( max( 1.0 - dot( mapN.xy, mapN.xy ), 0.0 ) )');
    expect(out).not.toContain('vec3 mapN = texture2D');
  });
  it('maps smoothness=A*_GlossMapScale and metallic=R', () => {
    const out = patchUnityStandardFragment(frag, { hasNormalMap: false, hasMetalGlossMap: true, glossMapScale: 0.5 });
    expect(out).toContain('roughnessFactor *= ( 1.0 - texelRoughness.a * 0.500000 )');
    expect(out).toContain('metalnessFactor *= texelMetalness.r;');
    expect(out).not.toContain('texelRoughness.g');
  });
  it('installs a distinct program cache key and patches via onBeforeCompile', () => {
    const m = new THREE.MeshStandardMaterial();
    installUnityStandardMaps(m, { hasNormalMap: true, hasMetalGlossMap: true, glossMapScale: 1 });
    expect(m.customProgramCacheKey()).toContain('nm');
    const shader = { fragmentShader: frag } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('dxt5nm');
  });
});
