// tests/view/toonMaterial.test.ts
// Toon character shading: chunk injection (band quantization, shadow tint,
// fresnel rim), macro redirect ordering against the REAL three 0.169 chunk
// text, uniform wiring (defaults, clamps, live updates), clone/restore
// semantics for shared CharacterLibrary template materials. Node-only — a
// fake shader object stands in for the WebGLProgramParametersWithUniforms
// three hands to onBeforeCompile (splatTerrain/toonOutline pattern), seeded
// with the actual ShaderLib.standard sources (the meshphysical chunk pair)
// so the patch is exercised against the real chunk markers.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  applyToonShading,
  applyToonToCharacter,
  TOON_UNIFORMS,
  TOON_DEFAULT_BANDS,
  TOON_MIN_BANDS,
  TOON_MAX_BANDS,
  TOON_DEFAULT_SHADOW_TINT,
  TOON_DEFAULT_RIM_COLOR,
  TOON_DEFAULT_RIM_STRENGTH,
  TOON_TERMINATOR_SOFTNESS,
} from '../../src/view/characters/ToonMaterial';

// ShaderLib.standard IS the meshphysical vert/frag pair (ShaderLib.js:100-101)
// — the exact source MeshStandardMaterial compiles.
function fakeShader() {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

/** One-pass #include resolution (the chunks we assert on have no nested
 *  includes) — proves the macro redirect lands before the RE_Direct call
 *  sites in the fully expanded source, without a GL compiler. */
function resolveIncludes(src: string): string {
  return src.replace(/#include <([^>]+)>/g, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`unknown ShaderChunk: ${name}`);
    return chunk;
  });
}

function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

function geom(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  return g;
}

interface Rig {
  root: THREE.Group;
  plain: THREE.Mesh;
  skin: THREE.SkinnedMesh;
  multi: THREE.Mesh;
  hull: THREE.Mesh;
  templateMat: THREE.MeshStandardMaterial;
  uniqueMat: THREE.MeshStandardMaterial;
  basicMat: THREE.MeshBasicMaterial;
  multiOriginal: THREE.Material[];
}

/** Fake CharacterLibrary-style rig: plain + skinned mesh SHARING one template
 *  material, a multi-material mesh (standard + basic slots), and a ToonOutline
 *  hull (userData.isOutline, MeshBasicMaterial) that must be skipped. */
function rig(): Rig {
  const root = new THREE.Group();
  root.name = 'char:test';
  const templateMat = new THREE.MeshStandardMaterial({ color: 0x88aa44 });
  const uniqueMat = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
  const basicMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const plain = new THREE.Mesh(geom(), templateMat);
  plain.name = 'body';
  const skin = new THREE.SkinnedMesh(geom(), templateMat);
  skin.name = 'limb';
  const bone = new THREE.Bone();
  skin.add(bone);
  skin.bind(new THREE.Skeleton([bone]));
  const multiOriginal = [uniqueMat, basicMat];
  const multi = new THREE.Mesh(geom(), multiOriginal);
  multi.name = 'gear';
  const hull = new THREE.Mesh(geom(), new THREE.MeshBasicMaterial());
  hull.name = 'body_outline';
  hull.userData.isOutline = true;
  root.add(plain, skin, multi, hull);
  return { root, plain, skin, multi, hull, templateMat, uniqueMat, basicMat, multiOriginal };
}

describe('applyToonShading — shader patch', () => {
  it('injects band quantization + shadow tint + rim + uniforms (defaults)', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x88aa44 });
    const ret = applyToonShading(m);
    expect(ret).toBe(m); // mutated in place
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    // Uniform declarations + helpers (built-ins only, ahead of <common>).
    expect(sh.fragmentShader).toContain('uniform float uToonBands;');
    expect(sh.fragmentShader).toContain('uniform vec3 uToonShadowTint;');
    expect(sh.fragmentShader).toContain('uniform vec3 uToonRimColor;');
    expect(sh.fragmentShader).toContain('uniform float uToonRimStrength;');
    expect(sh.fragmentShader).toContain('smoothstep( 0.5 - uToonSoftness, 0.5 + uToonSoftness, f )');
    expect(sh.fragmentShader).toContain('mix( uToonShadowTint, vec3( 1.0 ), pjm2ToonLevel( dotNL ) )');
    // RE_Direct wrapper + macro redirect; stock chunks stay included.
    expect(sh.fragmentShader).toContain('void RE_Direct_Toon(');
    expect(sh.fragmentShader).toContain('#undef RE_Direct');
    expect(sh.fragmentShader).toContain('#define RE_Direct RE_Direct_Toon');
    expect(sh.fragmentShader).toContain('#include <lights_physical_pars_fragment>');
    expect(sh.fragmentShader).toContain('#include <lights_fragment_begin>');
    // Rim added to outgoingLight.
    expect(sh.fragmentShader).toContain('outgoingLight += pjm2ToonRim( geometryNormal, geometryViewDir );');
    // Default uniform values.
    expect(sh.uniforms[TOON_UNIFORMS.bands].value).toBe(TOON_DEFAULT_BANDS);
    expect(sh.uniforms[TOON_UNIFORMS.softness].value).toBe(TOON_TERMINATOR_SOFTNESS);
    expect(sh.uniforms[TOON_UNIFORMS.rimStrength].value).toBe(TOON_DEFAULT_RIM_STRENGTH);
    const tint = sh.uniforms[TOON_UNIFORMS.shadowTint].value as THREE.Color;
    expect(tint).toBeInstanceOf(THREE.Color);
    expect(tint.getHex()).toBe(TOON_DEFAULT_SHADOW_TINT);
    const rim = sh.uniforms[TOON_UNIFORMS.rimColor].value as THREE.Color;
    expect(rim.getHex()).toBe(TOON_DEFAULT_RIM_COLOR);
    expect(m.customProgramCacheKey()).toBe('pjm2-toon-character');
  });

  it('macro redirect precedes every RE_Direct call site in the resolved source', () => {
    const m = applyToonShading(new THREE.MeshStandardMaterial());
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    const resolved = resolveIncludes(sh.fragmentShader);
    const physIdx = resolved.indexOf('void RE_Direct_Physical(');
    const wrapIdx = resolved.indexOf('void RE_Direct_Toon(');
    const defIdx = resolved.indexOf('#define RE_Direct RE_Direct_Toon');
    const callIdx = resolved.indexOf('RE_Direct( directLight, geometryPosition');
    expect(physIdx).toBeGreaterThan(-1);
    expect(wrapIdx).toBeGreaterThan(physIdx); // wrapper after the structs/RE
    expect(defIdx).toBeGreaterThan(wrapIdx);  // redirect after the wrapper
    expect(callIdx).toBeGreaterThan(defIdx);  // call sites see the new macro
    // point + spot + directional loops all routed (3 stock call sites).
    expect(count(resolved, 'RE_Direct( directLight, geometryPosition')).toBe(3);
    // Rim lands after the outgoingLight accumulation line.
    expect(resolved.indexOf('outgoingLight += pjm2ToonRim'))
      .toBeGreaterThan(resolved.indexOf('vec3 outgoingLight = totalDiffuse'));
  });

  it('honors custom bands/tint/rim options', () => {
    const m = applyToonShading(new THREE.MeshStandardMaterial(), {
      bands: 4, shadowTint: 0x223344, rimColor: 0xff0000, rimStrength: 0.6,
    });
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.uniforms[TOON_UNIFORMS.bands].value).toBe(4);
    expect((sh.uniforms[TOON_UNIFORMS.shadowTint].value as THREE.Color).getHex()).toBe(0x223344);
    expect((sh.uniforms[TOON_UNIFORMS.rimColor].value as THREE.Color).getHex()).toBe(0xff0000);
    expect(sh.uniforms[TOON_UNIFORMS.rimStrength].value).toBe(0.6);
  });

  it('leaves the vertex shader byte-identical (skinning chunks intact)', () => {
    const m = applyToonShading(new THREE.MeshStandardMaterial());
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    expect(sh.vertexShader).toBe(THREE.ShaderLib.standard.vertexShader);
    expect(sh.vertexShader).toContain('#include <skinning_vertex>');
    expect(sh.vertexShader).toContain('#include <begin_vertex>');
  });

  it('double compile does not double-inject (idempotent patch)', () => {
    const m = applyToonShading(new THREE.MeshStandardMaterial());
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    m.onBeforeCompile(sh, null as never);
    expect(count(sh.fragmentShader, 'uniform float uToonBands;')).toBe(1);
    expect(count(sh.fragmentShader, '#define RE_Direct RE_Direct_Toon')).toBe(1);
    expect(count(sh.fragmentShader, 'outgoingLight += pjm2ToonRim')).toBe(1);
  });

  it('re-call updates options live on the compiled shader (no recompile)', () => {
    const m = applyToonShading(new THREE.MeshStandardMaterial());
    const sh = fakeShader();
    m.onBeforeCompile(sh, null as never);
    const stateBefore = m.userData.toon;
    applyToonShading(m, { bands: 5, rimStrength: 0.8, shadowTint: 0x102030 });
    expect(m.userData.toon).toBe(stateBefore); // same state, updated
    expect(sh.uniforms[TOON_UNIFORMS.bands].value).toBe(5);
    expect(sh.uniforms[TOON_UNIFORMS.rimStrength].value).toBe(0.8);
    expect((sh.uniforms[TOON_UNIFORMS.shadowTint].value as THREE.Color).getHex()).toBe(0x102030);
    // A later compile picks up the updated state too.
    const sh2 = fakeShader();
    m.onBeforeCompile(sh2, null as never);
    expect(sh2.uniforms[TOON_UNIFORMS.bands].value).toBe(5);
  });

  it('clamps bands to [2, 8] (floored; non-finite → default)', () => {
    const cases: [number, number][] = [
      [0, TOON_MIN_BANDS], [1, TOON_MIN_BANDS], [-3, TOON_MIN_BANDS],
      [99, TOON_MAX_BANDS], [2.9, 2], [NaN, TOON_DEFAULT_BANDS],
    ];
    for (const [input, expected] of cases) {
      const m = applyToonShading(new THREE.MeshStandardMaterial(), { bands: input });
      const sh = fakeShader();
      m.onBeforeCompile(sh, null as never);
      expect(sh.uniforms[TOON_UNIFORMS.bands].value).toBe(expected);
    }
  });

  it('clamps rimStrength to [0, 1] (non-finite → default)', () => {
    const cases: [number, number][] = [
      [-1, 0], [5, 1], [NaN, TOON_DEFAULT_RIM_STRENGTH],
    ];
    for (const [input, expected] of cases) {
      const m = applyToonShading(new THREE.MeshStandardMaterial(), { rimStrength: input });
      const sh = fakeShader();
      m.onBeforeCompile(sh, null as never);
      expect(sh.uniforms[TOON_UNIFORMS.rimStrength].value).toBe(expected);
    }
  });
});

describe('applyToonToCharacter — clone safety', () => {
  it('clones standard materials; shared templates stay untouched', () => {
    const r = rig();
    applyToonToCharacter(r.root);
    expect(r.plain.material).not.toBe(r.templateMat);
    expect(r.skin.material).not.toBe(r.templateMat);
    // Meshes sharing a template mat share ONE patched clone.
    expect(r.plain.material).toBe(r.skin.material);
    expect(r.templateMat.userData.toon).toBeUndefined();
    expect(r.templateMat.customProgramCacheKey()).not.toBe('pjm2-toon-character');
    expect(r.uniqueMat.userData.toon).toBeUndefined();
    // Multi-material: standard slot cloned, basic slot left as-is.
    const mats = r.multi.material as THREE.Material[];
    expect(mats[0]).not.toBe(r.uniqueMat);
    expect(mats[1]).toBe(r.basicMat);
    // Outline hull skipped entirely.
    expect(r.hull.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((r.hull.material as THREE.Material).userData.toon).toBeUndefined();
  });

  it('patched clones carry the toon shader; skinned rig stays intact', () => {
    const r = rig();
    applyToonToCharacter(r.root);
    const clone = r.skin.material as THREE.MeshStandardMaterial;
    expect(clone).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(clone.customProgramCacheKey()).toBe('pjm2-toon-character');
    expect(clone.color.getHex()).toBe(0x88aa44); // base color preserved
    const sh = fakeShader();
    clone.onBeforeCompile(sh, null as never);
    expect(sh.fragmentShader).toContain('pjm2ToonShade');
    expect(r.skin.isSkinnedMesh).toBe(true);
    expect(r.skin.skeleton.bones).toHaveLength(1);
    expect(r.skin.geometry.getAttribute('position').count).toBe(3);
  });

  it('honors options passed through to the clones', () => {
    const r = rig();
    applyToonToCharacter(r.root, { bands: 2, rimStrength: 0.5 });
    const sh = fakeShader();
    (r.plain.material as THREE.MeshStandardMaterial).onBeforeCompile(sh, null as never);
    expect(sh.uniforms[TOON_UNIFORMS.bands].value).toBe(2);
    expect(sh.uniforms[TOON_UNIFORMS.rimStrength].value).toBe(0.5);
  });
});

describe('applyToonToCharacter — dispose / idempotency', () => {
  it('dispose restores originals and disposes ONLY the clones', () => {
    const r = rig();
    const handle = applyToonToCharacter(r.root);
    const cloneA = r.plain.material as THREE.Material;
    const cloneB = (r.multi.material as THREE.Material[])[0];
    const cloneDispose = vi.fn();
    const srcDispose = vi.fn();
    cloneA.addEventListener('dispose', cloneDispose);
    cloneB.addEventListener('dispose', cloneDispose);
    r.templateMat.addEventListener('dispose', srcDispose);
    r.uniqueMat.addEventListener('dispose', srcDispose);
    r.basicMat.addEventListener('dispose', srcDispose);

    handle.dispose();

    expect(r.plain.material).toBe(r.templateMat);
    expect(r.skin.material).toBe(r.templateMat);
    expect(r.multi.material).toBe(r.multiOriginal); // same array reference
    expect(cloneDispose).toHaveBeenCalledTimes(2); // 2 unique clones
    expect(srcDispose).not.toHaveBeenCalled();
    expect(r.root.userData.toonShading).toBeUndefined();
    handle.dispose(); // idempotent
    expect(cloneDispose).toHaveBeenCalledTimes(2);
  });

  it('other instances sharing the template are unaffected by apply + dispose', () => {
    const a = rig();
    const b = rig();
    // Both rigs' meshes share the SAME template material object.
    (b.plain as THREE.Mesh).material = a.templateMat;
    (b.skin as THREE.Mesh).material = a.templateMat;
    const handle = applyToonToCharacter(a.root);
    expect(b.plain.material).toBe(a.templateMat);
    expect(b.skin.material).toBe(a.templateMat);
    handle.dispose();
    expect(b.plain.material).toBe(a.templateMat);
    expect(a.templateMat.userData.toon).toBeUndefined();
  });

  it('second call returns the same handle; re-apply after dispose is fresh', () => {
    const r = rig();
    const first = applyToonToCharacter(r.root);
    const second = applyToonToCharacter(r.root, { bands: 8 }); // options ignored
    expect(second).toBe(first);
    const clone = r.plain.material;
    first.dispose();
    const third = applyToonToCharacter(r.root);
    expect(third).not.toBe(first);
    expect(r.plain.material).not.toBe(clone); // fresh clone
    expect(r.plain.material).not.toBe(r.templateMat);
    third.dispose();
    expect(r.plain.material).toBe(r.templateMat);
  });
});
