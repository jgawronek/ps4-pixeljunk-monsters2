// tests/view/splatTerrain.test.ts
// Splat-terrain shader patch: chunk injection, uniform wiring (pre- and
// post-compile), merge-group attribute fill. Node-only — a fake shader
// object stands in for the WebGLProgramParametersWithUniforms three hands
// to onBeforeCompile.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  installSplatTerrainShader,
  setSplatLayerTextures,
  setSplatLayerUvScales,
  ensureSplatAttributes,
  SPLAT_UNIFORMS,
} from '../../src/view/stage/SplatTerrainMaterial';

const VERT = 'void main() {\n#include <uv_vertex>\n}\n';
const FRAG = 'void main() {\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}\n';

function fakeShader() {
  return {
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {} as Record<string, { value: unknown }>,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

function tex(): THREE.Texture {
  return new THREE.Texture();
}

describe('installSplatTerrainShader', () => {
  it('injects the splat attribute/varying and the 4-layer blend', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.vertexShader).toContain('attribute vec4 splat;');
    expect(sh.vertexShader).toContain('vSplat = splat;');
    expect(sh.fragmentShader).toContain('varying vec4 vSplat;');
    expect(sh.fragmentShader).toContain('sampler2D splatMapR');
    expect(sh.fragmentShader).toContain('mix( mix( mix( splatBase, splatCR, vSplat.r )');
    expect(sh.fragmentShader).not.toContain('#include <map_fragment>'); // replaced
    expect(m.customProgramCacheKey()).toBe('pjm2-splat-terrain-nrm-gloss');
  });

  it('installs uniforms with null layers → use-flags 0 (base fallback)', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[SPLAT_UNIFORMS.mapR].value).toBe(null);
    expect(sh.uniforms[SPLAT_UNIFORMS.useR].value).toBe(0);
    expect(sh.uniforms[SPLAT_UNIFORMS.useG].value).toBe(0);
    expect(sh.uniforms[SPLAT_UNIFORMS.useB].value).toBe(0);
  });
});

describe('setSplatLayerTextures', () => {
  it('before compile: stashes layers, picked up by onBeforeCompile', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const [r, g, b] = [tex(), tex(), tex()];
    setSplatLayerTextures(m, { r, g, b });
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[SPLAT_UNIFORMS.mapR].value).toBe(r);
    expect(sh.uniforms[SPLAT_UNIFORMS.mapG].value).toBe(g);
    expect(sh.uniforms[SPLAT_UNIFORMS.mapB].value).toBe(b);
    expect(sh.uniforms[SPLAT_UNIFORMS.useR].value).toBe(1);
  });

  it('after compile: patches live uniforms (progressive texture streaming)', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never); // compiled with no layers
    const g = tex();
    setSplatLayerTextures(m, { r: null, g, b: null });
    expect(sh.uniforms[SPLAT_UNIFORMS.mapG].value).toBe(g);
    expect(sh.uniforms[SPLAT_UNIFORMS.useG].value).toBe(1);
    expect(sh.uniforms[SPLAT_UNIFORMS.useR].value).toBe(0); // still absent
  });

  it('throws without install (guard against call-order bugs)', () => {
    const m = new THREE.MeshStandardMaterial();
    expect(() => setSplatLayerTextures(m, { r: null, g: null, b: null })).toThrow();
  });
});

describe('ensureSplatAttributes', () => {
  function geom(withSplat: boolean, verts = 3): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    if (withSplat) {
      g.setAttribute('splat', new THREE.BufferAttribute(new Float32Array(verts * 4).fill(1), 4));
    }
    return g;
  }

  it('fills zero weights for geometries missing splat when any has it', () => {
    const a = geom(true);
    const b = geom(false, 5);
    ensureSplatAttributes([a, b]);
    const s = b.getAttribute('splat') as THREE.BufferAttribute;
    expect(s).toBeDefined();
    expect(s.count).toBe(5);
    expect(s.itemSize).toBe(4);
    expect([...s.array]).toEqual(new Array(20).fill(0)); // → base layer
  });

  it('no-op when no geometry has splat', () => {
    const a = geom(false);
    ensureSplatAttributes([a]);
    expect(a.getAttribute('splat')).toBeUndefined();
  });

  it('merges cleanly after the fill (mergeGeometries accepts the set)', async () => {
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const a = geom(true);
    a.setIndex([0, 1, 2]);
    const b = geom(false);
    b.setIndex([0, 1, 2]);
    ensureSplatAttributes([a, b]);
    const merged = mergeGeometries([a, b]);
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute('splat').count).toBe(6);
  });
});

describe('setSplatLayerUvScales (per-layer tiling: R×64, G×48 vs base×56)', () => {
  it('throws without install (guard against call-order bugs)', () => {
    const m = new THREE.MeshStandardMaterial();
    expect(() => setSplatLayerUvScales(m, { r: [1, 1], g: [1, 1], b: [1, 1] })).toThrow();
  });

  it('before compile: identity default, picked up by onBeforeCompile', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = { vertexShader: VERT, fragmentShader: FRAG, uniforms: {} } as never;
    m.onBeforeCompile(sh, null as never);
    const u = (sh as unknown as { uniforms: Record<string, { value: THREE.Vector2 }> }).uniforms;
    expect(u[SPLAT_UNIFORMS.uvR].value.toArray()).toEqual([1, 1]);
  });

  it('after compile: live-patches the per-layer vec2 ratios', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = { vertexShader: VERT, fragmentShader: FRAG, uniforms: {} } as never;
    m.onBeforeCompile(sh, null as never);
    const u = (sh as unknown as { uniforms: Record<string, { value: THREE.Vector2 }> }).uniforms;
    setSplatLayerUvScales(m, {
      r: [64 / 56, 64 / 56],
      g: [48 / 56, 48 / 56],
      b: [1, 1],
    });
    expect(u[SPLAT_UNIFORMS.uvR].value.x).toBeCloseTo(64 / 56, 5);
    expect(u[SPLAT_UNIFORMS.uvG].value.y).toBeCloseTo(48 / 56, 5);
    expect(u[SPLAT_UNIFORMS.uvB].value.toArray()).toEqual([1, 1]);
  });

  it('pre-compile set + late compile uses the stored ratios', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    setSplatLayerUvScales(m, { r: [2, 2], g: [0.5, 0.5], b: [1, 1] });
    const sh = { vertexShader: VERT, fragmentShader: FRAG, uniforms: {} } as never;
    m.onBeforeCompile(sh, null as never);
    const u = (sh as unknown as { uniforms: Record<string, { value: THREE.Vector2 }> }).uniforms;
    expect(u[SPLAT_UNIFORMS.uvR].value.x).toBe(2);
    expect(u[SPLAT_UNIFORMS.uvG].value.x).toBeCloseTo(0.5, 5);
  });
});

describe('splat normals + gloss (shader ISA: DXT5nm x4 blended with the colour weights)', () => {
  it('replaces normal_fragment_maps with the 4-layer DXT5nm blend (no normalScale)', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    const f = sh.fragmentShader;
    expect(f).toContain('vec3 splatUnpackNm( vec4 s )');
    expect(f).toContain('s.wy * 2.0 - 1.0'); // x = alpha, y = green
    expect(f).toContain('mix( mix( mix( splatNb, splatNr, vSplat.r ), splatNg, vSplat.g ), splatNbl, vSplat.b )');
    expect(f).not.toContain('mapN.xy *= normalScale'); // _BumpScale is not used by the shader
    expect(f).not.toContain('#include <normal_fragment_maps>');
  });
  it('roughness = 1 - gloss lerp chain over the four gloss maps', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.fragmentShader).toContain('roughnessFactor = 1.0 - mix( mix( mix( splatGB, splatGR, vSplat.r )');
    expect(sh.fragmentShader).not.toContain('#include <roughnessmap_fragment>');
  });
  it('normal/gloss layers are live uniforms; gloss needs all four', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[SPLAT_UNIFORMS.useNrmR].value).toBe(0);
    expect(sh.uniforms[SPLAT_UNIFORMS.useGloss].value).toBe(0);
    const [nr, ng, nb, g0, g1, g2, g3] = [tex(), tex(), tex(), tex(), tex(), tex(), tex()];
    setSplatLayerTextures(m, { r: null, g: null, b: null, nr, ng, nb, gBase: g0, gr: g1, gg: g2 });
    expect(sh.uniforms[SPLAT_UNIFORMS.nrmR].value).toBe(nr);
    expect(sh.uniforms[SPLAT_UNIFORMS.useNrmB].value).toBe(1);
    expect(sh.uniforms[SPLAT_UNIFORMS.useGloss].value).toBe(0); // gb missing
    setSplatLayerTextures(m, { r: null, g: null, b: null, nr, ng, nb, gBase: g0, gr: g1, gg: g2, gb: g3 });
    expect(sh.uniforms[SPLAT_UNIFORMS.useGloss].value).toBe(1);
  });
});

describe('patch targets exist in the REAL three shader source (no silent no-op replaces)', () => {
  const frag = THREE.ShaderLib.physical.fragmentShader;
  const vert = THREE.ShaderLib.physical.vertexShader;
  it('splat hooks match meshphysical', () => {
    expect(vert).toContain('#include <uv_vertex>');
    for (const inc of ['map_fragment', 'roughnessmap_fragment', 'normal_fragment_maps']) {
      expect(frag).toContain(`#include <${inc}>`);
    }
    // chunk-internal text we replace (resolved from ShaderChunk, not the raw source)
    expect(THREE.ShaderChunk.normal_fragment_maps).toContain(
      'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy *= normalScale;');
  });
  it('end-to-end: patched real shader has the splat normal blend and no stock mapN read', () => {
    const m = new THREE.MeshStandardMaterial();
    installSplatTerrainShader(m);
    const sh = { vertexShader: vert, fragmentShader: frag, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as never);
    expect(sh.fragmentShader).toContain('splatUnpackNm( texture2D( normalMap');
    expect(sh.fragmentShader).not.toContain('texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy');
    expect(sh.fragmentShader).toContain('roughnessFactor = 1.0 - mix(');
    expect(sh.vertexShader).toContain('vSplat = splat;');
  });
  it('toon hooks match', () => {
    expect(frag).toContain('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;');
    expect(THREE.ShaderChunk.lights_physical_pars_fragment.length).toBeGreaterThan(0);
    expect(frag).toContain('#include <lights_physical_pars_fragment>');
    expect(THREE.ShaderLib.basic.vertexShader).toContain('#include <begin_vertex>');
  });
});
