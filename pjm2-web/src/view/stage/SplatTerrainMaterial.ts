// src/view/stage/SplatTerrainMaterial.ts
// Shader Forge "Splatt_Normal_Gloss" (terrain_001_m) → MeshStandardMaterial
// patch. The original is a 4-way splat: _Base/_R/_G/_B color layers (each
// tiled ×56), blended by VERTEX COLORS (the material has no splat-map texture
// slot; the source meshes carry RGBA byte colors — exported as col0.u8.bin,
// loaded onto geometry as the `splat` vec4 attribute by StageSceneView).
//
// Blend chain (standard Shader Forge splat):
//   lerp(lerp(lerp(base, R, vSplat.r), G, vSplat.g), B, vSplat.b)
// Stage-1 data check: terrain verts are G-dominant (moss) with R soil paths
// over the gravel base — matching the original's look.
//
// NORMAL + GLOSS (decoded from the shipped compiled shader, deferred pass,
// variant UNITY_HDR_ON, GCN ISA via tools/shaders; docs/GRADING_AND_SURFACE_
// ANALYSIS.md): the shader samples FOUR DXT5nm normals (x = alpha, y = green,
// z = sqrt(1 - min(1, |xy|^2)), NO _BumpScale), one per layer with the layer's
// own ST, blends x, y and z linearly with the SAME vertex weights as the
// albedo (lerp(lerp(lerp(base,R,w.r),G,w.g),B,w.b)), builds the world normal
// as T*x + B*y + N*z and normalises it. Gloss = the same lerp chain over the
// four *_Gloss.r channels; smoothness = gloss (Standard BRDF, metal 0,
// specular 0.04, no occlusion). Roughness = 1 - gloss.
//
// Textures stream in AFTER materials build (progressive loading), so layer
// samplers are custom uniforms patched live; a missing layer falls back to
// the base color (seamless during streaming).

import * as THREE from 'three';

export interface SplatLayerTextures {
  r: THREE.Texture | null;
  g: THREE.Texture | null;
  b: THREE.Texture | null;
  /** DXT5nm normal layers R/G/B (the BASE normal is material.normalMap). */
  nr?: THREE.Texture | null;
  ng?: THREE.Texture | null;
  nb?: THREE.Texture | null;
  /** Gloss layers (.r = smoothness); base/R/G/B. */
  gBase?: THREE.Texture | null;
  gr?: THREE.Texture | null;
  gg?: THREE.Texture | null;
  gb?: THREE.Texture | null;
}

interface SplatState {
  layers: SplatLayerTextures;
  /** Per-layer UV scale RELATIVE to the base map tiling (layerScale/baseScale).
   *  The source layers tile differently (base/B 56, R 64, G 48); vMapUv carries
   *  the base transform, so each layer multiplies by its ratio. */
  uvScales: { r: [number, number]; g: [number, number]; b: [number, number] };
  shader: THREE.WebGLProgramParametersWithUniforms | null;
}

/** Uniform names kept exported for tests/probes. */
export const SPLAT_UNIFORMS = {
  mapR: 'splatMapR', mapG: 'splatMapG', mapB: 'splatMapB',
  useR: 'useSplatR', useG: 'useSplatG', useB: 'useSplatB',
  uvR: 'splatUvScaleR', uvG: 'splatUvScaleG', uvB: 'splatUvScaleB',
  nrmR: 'splatNormR', nrmG: 'splatNormG', nrmB: 'splatNormB',
  useNrmR: 'useSplatNormR', useNrmG: 'useSplatNormG', useNrmB: 'useSplatNormB',
  glossBase: 'splatGlossBase', glossR: 'splatGlossR', glossG: 'splatGlossG', glossB: 'splatGlossB',
  useGloss: 'useSplatGloss',
} as const;

/** [uniform name, SplatLayerTextures key] for every optional layer sampler. */
const OPTIONAL_LAYERS = [
  [SPLAT_UNIFORMS.nrmR, 'nr', SPLAT_UNIFORMS.useNrmR],
  [SPLAT_UNIFORMS.nrmG, 'ng', SPLAT_UNIFORMS.useNrmG],
  [SPLAT_UNIFORMS.nrmB, 'nb', SPLAT_UNIFORMS.useNrmB],
] as const;
const GLOSS_LAYERS = [
  [SPLAT_UNIFORMS.glossBase, 'gBase'],
  [SPLAT_UNIFORMS.glossR, 'gr'],
  [SPLAT_UNIFORMS.glossG, 'gg'],
  [SPLAT_UNIFORMS.glossB, 'gb'],
] as const;

const VERTEX_HEADER = 'attribute vec4 splat;\nvarying vec4 vSplat;\n';
const VERTEX_HOOK = '#include <uv_vertex>';
const VERTEX_INJECT = '#include <uv_vertex>\n\tvSplat = splat;';

const FRAGMENT_HEADER = [
  'varying vec4 vSplat;',
  'uniform sampler2D splatMapR;',
  'uniform sampler2D splatMapG;',
  'uniform sampler2D splatMapB;',
  'uniform float useSplatR;',
  'uniform float useSplatG;',
  'uniform float useSplatB;',
  'uniform vec2 splatUvScaleR;',
  'uniform vec2 splatUvScaleG;',
  'uniform vec2 splatUvScaleB;',
  'uniform sampler2D splatNormR;',
  'uniform sampler2D splatNormG;',
  'uniform sampler2D splatNormB;',
  'uniform float useSplatNormR;',
  'uniform float useSplatNormG;',
  'uniform float useSplatNormB;',
  'uniform sampler2D splatGlossBase;',
  'uniform sampler2D splatGlossR;',
  'uniform sampler2D splatGlossG;',
  'uniform sampler2D splatGlossB;',
  'uniform float useSplatGloss;',
  '',
  '// Unity UnpackNormalDXT5nm: xy = (a, g)*2-1, z = sqrt(1 - min(1,|xy|^2)) (shader ISA).',
  'vec3 splatUnpackNm( vec4 s ) {',
  '\tvec2 xy = s.wy * 2.0 - 1.0;',
  '\treturn vec3( xy, sqrt( 1.0 - min( 1.0, dot( xy, xy ) ) ) );',
  '}',
  '',
].join('\n');

// Normal: replaces the two stock lines in normal_fragment_maps (resolved chunk).
const NORMAL_OLD = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy *= normalScale;';
const NORMAL_NEW = `vec3 splatNb = splatUnpackNm( texture2D( normalMap, vNormalMapUv ) );
	vec3 splatNr = useSplatNormR > 0.5 ? splatUnpackNm( texture2D( splatNormR, vNormalMapUv * splatUvScaleR ) ) : splatNb;
	vec3 splatNg = useSplatNormG > 0.5 ? splatUnpackNm( texture2D( splatNormG, vNormalMapUv * splatUvScaleG ) ) : splatNb;
	vec3 splatNbl = useSplatNormB > 0.5 ? splatUnpackNm( texture2D( splatNormB, vNormalMapUv * splatUvScaleB ) ) : splatNb;
	vec3 mapN = mix( mix( mix( splatNb, splatNr, vSplat.r ), splatNg, vSplat.g ), splatNbl, vSplat.b );`;

// Roughness = 1 - gloss lerp chain (smoothness = gloss.r, Unity Standard BRDF).
const ROUGH_HOOK = '#include <roughnessmap_fragment>';
const ROUGH_NEW = `float roughnessFactor = roughness;
#ifdef USE_MAP
	if ( useSplatGloss > 0.5 ) {
		float splatGB = texture2D( splatGlossBase, vMapUv ).r;
		float splatGR = useSplatR > 0.5 ? texture2D( splatGlossR, vMapUv * splatUvScaleR ).r : splatGB;
		float splatGG = useSplatG > 0.5 ? texture2D( splatGlossG, vMapUv * splatUvScaleG ).r : splatGB;
		float splatGBl = useSplatB > 0.5 ? texture2D( splatGlossB, vMapUv * splatUvScaleB ).r : splatGB;
		roughnessFactor = 1.0 - mix( mix( mix( splatGB, splatGR, vSplat.r ), splatGG, vSplat.g ), splatGBl, vSplat.b );
	}
#endif`;

// Replaces the stock map_fragment chunk (three 0.169: samples `map` into
// sampledDiffuseColor then multiplies diffuseColor). vMapUv carries the BASE
// map transform (×56); each layer tiles differently (R×64, G×48, B×56) so it
// multiplies vMapUv by its per-layer scale ratio (splatUvScale*).
const FRAGMENT_HOOK = '#include <map_fragment>';
const FRAGMENT_INJECT = `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	vec4 splatBase = sampledDiffuseColor;
	vec4 splatCR = useSplatR > 0.5 ? texture2D( splatMapR, vMapUv * splatUvScaleR ) : splatBase;
	vec4 splatCG = useSplatG > 0.5 ? texture2D( splatMapG, vMapUv * splatUvScaleG ) : splatBase;
	vec4 splatCB = useSplatB > 0.5 ? texture2D( splatMapB, vMapUv * splatUvScaleB ) : splatBase;
	sampledDiffuseColor = mix( mix( mix( splatBase, splatCR, vSplat.r ), splatCG, vSplat.g ), splatCB, vSplat.b );
	diffuseColor *= sampledDiffuseColor;
#endif`;

/** Install the splat patch on a MeshStandardMaterial (base map still assigned
 *  via material.map as usual). Idempotent per material. */
export function installSplatTerrainShader(m: THREE.MeshStandardMaterial): void {
  const state: SplatState = {
    layers: { r: null, g: null, b: null },
    uvScales: { r: [1, 1], g: [1, 1], b: [1, 1] },
    shader: null,
  };
  m.userData.splat = state;
  m.onBeforeCompile = (shader) => {
    state.shader = shader;
    shader.uniforms[SPLAT_UNIFORMS.mapR] = { value: state.layers.r };
    shader.uniforms[SPLAT_UNIFORMS.mapG] = { value: state.layers.g };
    shader.uniforms[SPLAT_UNIFORMS.mapB] = { value: state.layers.b };
    shader.uniforms[SPLAT_UNIFORMS.useR] = { value: state.layers.r !== null ? 1 : 0 };
    shader.uniforms[SPLAT_UNIFORMS.useG] = { value: state.layers.g !== null ? 1 : 0 };
    shader.uniforms[SPLAT_UNIFORMS.useB] = { value: state.layers.b !== null ? 1 : 0 };
    shader.uniforms[SPLAT_UNIFORMS.uvR] = { value: new THREE.Vector2(...state.uvScales.r) };
    shader.uniforms[SPLAT_UNIFORMS.uvG] = { value: new THREE.Vector2(...state.uvScales.g) };
    shader.uniforms[SPLAT_UNIFORMS.uvB] = { value: new THREE.Vector2(...state.uvScales.b) };
    syncOptionalUniforms(shader.uniforms, state.layers);
    if (!shader.vertexShader.includes('vSplat')) {
      shader.vertexShader = VERTEX_HEADER +
        shader.vertexShader.replace(VERTEX_HOOK, VERTEX_INJECT);
    }
    if (!shader.fragmentShader.includes('splatMapR')) {
      shader.fragmentShader = FRAGMENT_HEADER +
        shader.fragmentShader
          .replace(FRAGMENT_HOOK, FRAGMENT_INJECT)
          .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(NORMAL_OLD, NORMAL_NEW))
          .replace(ROUGH_HOOK, ROUGH_NEW);
    }
  };
  m.customProgramCacheKey = () => 'pjm2-splat-terrain-nrm-gloss';
}

type UniformMap = Record<string, { value: unknown }>;

/** Normal/gloss layer samplers + use-flags (live-patchable, any compile state). */
function syncOptionalUniforms(u: UniformMap, layers: SplatLayerTextures): void {
  for (const [name, key, flag] of OPTIONAL_LAYERS) {
    const t = layers[key] ?? null;
    (u[name] ??= { value: null }).value = t;
    (u[flag] ??= { value: 0 }).value = t !== null ? 1 : 0;
  }
  let allGloss = true;
  for (const [name, key] of GLOSS_LAYERS) {
    const t = layers[key] ?? null;
    (u[name] ??= { value: null }).value = t;
    if (t === null) allGloss = false;
  }
  (u[SPLAT_UNIFORMS.useGloss] ??= { value: 0 }).value = allGloss ? 1 : 0;
}

/** Set per-layer UV scale ratios (layerScale / baseScale) — live-patchable.
 *  The source terrain tiles R×64, G×48, base/B×56; pass {r:[64/56,64/56],
 *  g:[48/56,48/56], b:[1,1]}. Defaults to identity (all layers = base tiling). */
export function setSplatLayerUvScales(
  m: THREE.MeshStandardMaterial,
  scales: { r: [number, number]; g: [number, number]; b: [number, number] },
): void {
  const state = m.userData.splat as SplatState | undefined;
  if (!state) throw new Error('setSplatLayerUvScales: installSplatTerrainShader first');
  state.uvScales = scales;
  if (state.shader) {
    const u = state.shader.uniforms;
    (u[SPLAT_UNIFORMS.uvR].value as THREE.Vector2).set(...scales.r);
    (u[SPLAT_UNIFORMS.uvG].value as THREE.Vector2).set(...scales.g);
    (u[SPLAT_UNIFORMS.uvB].value as THREE.Vector2).set(...scales.b);
  }
}

/** Push decoded layer textures into the material — before OR after its
 *  program compiled (progressive streaming). Triggers a recompile so the
 *  USE_MAP/base state stays consistent. */
export function setSplatLayerTextures(
  m: THREE.MeshStandardMaterial, layers: SplatLayerTextures,
): void {
  const state = m.userData.splat as SplatState | undefined;
  if (!state) throw new Error('setSplatLayerTextures: installSplatTerrainShader first');
  state.layers = layers;
  if (state.shader) {
    const u = state.shader.uniforms;
    u[SPLAT_UNIFORMS.mapR].value = layers.r;
    u[SPLAT_UNIFORMS.mapG].value = layers.g;
    u[SPLAT_UNIFORMS.mapB].value = layers.b;
    u[SPLAT_UNIFORMS.useR].value = layers.r !== null ? 1 : 0;
    u[SPLAT_UNIFORMS.useG].value = layers.g !== null ? 1 : 0;
    u[SPLAT_UNIFORMS.useB].value = layers.b !== null ? 1 : 0;
    syncOptionalUniforms(u as unknown as UniformMap, layers);
  }
  m.needsUpdate = true;
}

/** Ensure every geometry in a merge group has a `splat` attribute when any
 *  does (mergeGeometries requires identical attribute sets). Missing →
 *  zero-filled weights, which blend to the base layer. */
export function ensureSplatAttributes(geoms: THREE.BufferGeometry[]): void {
  const any = geoms.some((g) => g.getAttribute('splat') !== undefined);
  if (!any) return;
  for (const g of geoms) {
    if (g.getAttribute('splat') !== undefined) continue;
    const n = (g.getAttribute('position') as THREE.BufferAttribute).count;
    g.setAttribute('splat', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  }
}
