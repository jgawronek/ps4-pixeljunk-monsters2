// src/view/characters/ToonMaterial.ts
// Cel/toon character shading — the original's flat-banded look instead of the
// GLB extraction's plain PBR (MeshStandardMaterial).
//
// DECOMP / BUNDLE PROVENANCE (treated as data; what the artifacts ACTUALLY say):
//   - Character material params (.work/asset-spike/kuri/textures/textures.json,
//     `__materialParams: kuri_00_m`): the shader NAME is empty — the m_Shader
//     PPtr crosses into the `main_assets` bundle and is unresolved. The saved
//     float set is EXACTLY Unity Standard's (_Glossiness=0.5, _Metallic=0,
//     _BumpScale=1, _Mode=0, _SrcBlend=1/_DstBlend=0/_ZWrite=1,
//     _SpecularHighlights=1, _GlossyReflections=1); colors are only _Color
//     (white) + _EmissionColor (black). NO toon-specific properties (_Ramp,
//     _ShadowColor, _RimColor, …) are present.
//   - tools/assets/SPIKE_REPORT.md §4.2/§4.6: "Shader name unresolved (PPtr
//     crosses into main_assets bundle) — material params strongly indicate
//     Standard shader." CHARACTER_PIPELINE_REPORT.md §3.4: the GLBs carry
//     Standard-derived factors (_Metallic, 1-_Glossiness); the data maps are
//     shipped "for a custom shader if wanted".
//   - decomp/decompiled/Q4.NatureTreeMaterialHelper.c @0x64bb20: the only
//     character-adjacent material helper just switches Standard-style blend
//     modes (RenderType tag, _DstBlend/_ZWrite/_ALPHAPREMULTIPLY_ON,
//     renderQueue 3000/-1) — no shading parameters.
//   - No Q4.*Toon* / *CharacterShader* classes exist in the decomp, and no
//     runtime code sets character shading properties (the SetColor/SetFloat
//     hits are UI/grass/outline/effect classes; the only Shader.Find names are
//     Nature/Grass/* in Q4.GrassInstanceRenderer.c:687-688). The decompiled
//     outline system (Q4.ObjectOutlineRenderer / OutlineFade /
//     SkinnedMeshOutlineSetting) is the SELECTION outline — already ported in
//     ToonOutline.ts, whose header documents that the permanent character rim
//     lives in the compiled Unity shader assets, not in the decomp.
//
// So the shipped shader's band count / shadow tint / rim constants are NOT
// recoverable from this tree (compiled Unity 5.6 shader bytecode in an
// unresolved bundle). FIDELITY: NEAR — the defaults below approximate the
// shipped PJM2 look (flat cel bands, cool painted shadows, faint warm rim);
// screenshot-compared, not shader-decompiled. The Standard-compatible param
// set makes MeshStandardMaterial's direct-light term the right patch seam.
//
// TECHNIQUE (three 0.169, onBeforeCompile — SplatTerrainMaterial pattern):
//   - Fragment-only patch; the vertex shader (and every skinning chunk) is
//     untouched, so SkinnedMesh rigs keep working as-is.
//   - A wrapper RE_Direct_Toon multiplies the incident light color by a
//     band factor computed from saturate(dot(N,L)) BEFORE RE_Direct runs, so
//     both the direct diffuse AND the GGX specular irradiance are quantized
//     (the original's _SpecularHighlights=1 keeps specular; banding it reads
//     cel, not PBR). The redirect is a preprocessor macro swap injected right
//     after <lights_physical_pars_fragment> (where RE_Direct is #defined):
//     the wrapper body's own RE_Direct call expands to the physical function
//     (definition in force at that source position — no recursion), then
//     #undef/#define reroutes every call site inside <lights_fragment_begin>
//     (point/spot/directional loops, shadow-map factors already applied).
//     Rect-area lights (RE_Direct_RectArea) are not used on characters.
//   - Bands: N levels over saturate(NdotL) with a soft smoothstep terminator
//     (half-width uToonSoftness in band units, centered between levels).
//     Level 0 multiplies by uToonShadowTint (cool shadow), level 1 by white.
//   - Rim: fresnel pow(1-dot(N,V), 3) * uToonRimStrength * uToonRimColor added
//     to outgoingLight (view-space geometryNormal/geometryViewDir from
//     lights_fragment_begin; ortho-safe).
//   - ALL options are live uniforms (no defines) → one shared program cache
//     key for every toon variant; option changes never force a recompile.
//
// SHARED-MATERIAL SAFETY: CharacterLibrary.instantiate clones share materials
// with the templates (SkeletonUtils.clone). applyToonToCharacter therefore
// CLONES each standard material before patching (once per unique source, so
// meshes sharing a template mat keep sharing one patched clone) and dispose()
// restores the original references — templates are never mutated. Outline
// hulls (ToonOutline, MeshBasicMaterial, userData.isOutline) are skipped.

import * as THREE from 'three';

export interface ToonOptions {
  /** Light bands (cel levels). Clamped to [2, 8], floored. Default 3. */
  bands?: number;
  /** Multiplier for the darkest band (cool painted shadow). Default 0xb4bccc. */
  shadowTint?: THREE.ColorRepresentation;
  /** Fresnel rim color. Default 0xfff3dc (warm paper white). */
  rimColor?: THREE.ColorRepresentation;
  /** Rim intensity, clamped to [0, 1]. Default 0.25 (faint). */
  rimStrength?: number;
}

export interface ToonHandle {
  /** Restore the original (shared template) materials on every touched mesh
   *  and dispose ONLY the patched clones. Idempotent. */
  dispose(): void;
}

/** Uniform names kept exported for tests/probes (SplatTerrain pattern). */
export const TOON_UNIFORMS = {
  bands: 'uToonBands',
  shadowTint: 'uToonShadowTint',
  rimColor: 'uToonRimColor',
  rimStrength: 'uToonRimStrength',
  softness: 'uToonSoftness',
} as const;

// NEAR defaults (see header — the shipped constants are unrecoverable):
// 3 bands = lit / mid / shadow, the flat cel read of PJM2 characters.
export const TOON_DEFAULT_BANDS = 3;
export const TOON_MIN_BANDS = 2;
export const TOON_MAX_BANDS = 8;
// sRGB 0xb4bccc → linear ≈ (0.46, 0.50, 0.60): shadows stay ~half brightness
// with a cool shift (painted, not black). THREE.Color decodes sRGB → linear,
// and the tint multiplies in linear light before tone mapping.
export const TOON_DEFAULT_SHADOW_TINT = 0xb4bccc;
export const TOON_DEFAULT_RIM_COLOR = 0xfff3dc;
export const TOON_DEFAULT_RIM_STRENGTH = 0.25;
// Terminator half-width in band units (smoothstep edge softness).
export const TOON_TERMINATOR_SOFTNESS = 0.12;

interface ToonState {
  bands: number;
  shadowTint: THREE.Color;
  rimColor: THREE.Color;
  rimStrength: number;
  shader: THREE.WebGLProgramParametersWithUniforms | null;
}

function clampBands(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return TOON_DEFAULT_BANDS;
  return Math.min(TOON_MAX_BANDS, Math.max(TOON_MIN_BANDS, Math.floor(n)));
}

function clampRimStrength(s: number | undefined): number {
  if (s === undefined || !Number.isFinite(s)) return TOON_DEFAULT_RIM_STRENGTH;
  return Math.min(1, Math.max(0, s));
}

// Prepended header: uniforms + helpers using ONLY GLSL built-ins (clamp/floor/
// smoothstep/mix/pow/dot) — safe ahead of <common>, which defines saturate().
const FRAGMENT_HEADER = [
  'uniform float uToonBands;',
  'uniform vec3 uToonShadowTint;',
  'uniform vec3 uToonRimColor;',
  'uniform float uToonRimStrength;',
  'uniform float uToonSoftness;',
  // Quantize t ∈ [0,1] (saturated NdotL) into N levels; soft smoothstep
  // terminator centered halfway between adjacent levels.
  'float pjm2ToonLevel( float t ) {',
  '\tfloat n = uToonBands;',
  '\tfloat x = clamp( t, 0.0, 1.0 ) * ( n - 1.0 );',
  '\tfloat i = floor( x );',
  '\tfloat f = x - i;',
  '\tfloat s = smoothstep( 0.5 - uToonSoftness, 0.5 + uToonSoftness, f );',
  '\treturn ( i + s ) / ( n - 1.0 );',
  '}',
  // Level 0 → shadow tint, level 1 → full light (multiplier on the light).
  'vec3 pjm2ToonShade( float dotNL ) {',
  '\treturn mix( uToonShadowTint, vec3( 1.0 ), pjm2ToonLevel( dotNL ) );',
  '}',
  // Fresnel rim; power 3 is a fixed NEAR constant (not recoverable, header).
  'vec3 pjm2ToonRim( vec3 n, vec3 v ) {',
  '\tfloat fres = pow( 1.0 - clamp( dot( n, v ), 0.0, 1.0 ), 3.0 );',
  '\treturn uToonRimColor * ( fres * uToonRimStrength );',
  '}',
  '',
].join('\n');

// Injected right after <lights_physical_pars_fragment> (top level, after the
// IncidentLight/PhysicalMaterial/ReflectedLight structs and RE_Direct exist).
// The wrapper's inner RE_Direct call expands to RE_Direct_Physical (macro in
// force HERE); the #undef/#define then reroutes the lights_fragment_begin
// call sites to the wrapper. No chunk text is duplicated → shadow-map and
// unrolled-loop code stays stock.
const PARS_HOOK = '#include <lights_physical_pars_fragment>';
const PARS_INJECT = `${PARS_HOOK}
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
\tIncidentLight toonLight;
\ttoonLight.color = directLight.color * pjm2ToonShade( clamp( dot( geometryNormal, directLight.direction ), 0.0, 1.0 ) );
\ttoonLight.direction = directLight.direction;
\ttoonLight.visible = directLight.visible;
\tRE_Direct( toonLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Toon
`;

// meshphysical.glsl.js (three 0.169): geometryNormal/geometryViewDir are in
// scope here (locals of main from lights_fragment_begin).
const RIM_HOOK = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
const RIM_INJECT = `${RIM_HOOK}
\toutgoingLight += pjm2ToonRim( geometryNormal, geometryViewDir );`;

function writeUniforms(state: ToonState, u: Record<string, { value: unknown }>): void {
  u[TOON_UNIFORMS.bands] = { value: state.bands };
  u[TOON_UNIFORMS.shadowTint] = { value: state.shadowTint };
  u[TOON_UNIFORMS.rimColor] = { value: state.rimColor };
  u[TOON_UNIFORMS.rimStrength] = { value: state.rimStrength };
  u[TOON_UNIFORMS.softness] = { value: TOON_TERMINATOR_SOFTNESS };
}

/** Patch live uniforms after an option change (no recompile — all options are
 *  uniforms, never defines). */
function pushLiveUniforms(state: ToonState): void {
  if (!state.shader) return;
  const u = state.shader.uniforms;
  u[TOON_UNIFORMS.bands].value = state.bands;
  u[TOON_UNIFORMS.shadowTint].value = state.shadowTint;
  u[TOON_UNIFORMS.rimColor].value = state.rimColor;
  u[TOON_UNIFORMS.rimStrength].value = state.rimStrength;
}

/** Convert a MeshStandardMaterial (or create from a base map) into a
 *  toon-shaded material via onBeforeCompile: quantize the diffuse lighting
 *  into N bands, tint shadows, add a fresnel rim. Keeps the base map/color.
 *  Returns the same material (mutated) with a customProgramCacheKey.
 *  Idempotent: a second call updates the provided options live. */
export function applyToonShading(
  m: THREE.MeshStandardMaterial, opts: ToonOptions = {},
): THREE.MeshStandardMaterial {
  const existing = m.userData.toon as ToonState | undefined;
  if (existing) {
    if (opts.bands !== undefined) existing.bands = clampBands(opts.bands);
    if (opts.shadowTint !== undefined) existing.shadowTint.set(opts.shadowTint);
    if (opts.rimColor !== undefined) existing.rimColor.set(opts.rimColor);
    if (opts.rimStrength !== undefined) existing.rimStrength = clampRimStrength(opts.rimStrength);
    pushLiveUniforms(existing);
    return m;
  }
  const state: ToonState = {
    bands: clampBands(opts.bands),
    shadowTint: new THREE.Color(opts.shadowTint ?? TOON_DEFAULT_SHADOW_TINT),
    rimColor: new THREE.Color(opts.rimColor ?? TOON_DEFAULT_RIM_COLOR),
    rimStrength: clampRimStrength(opts.rimStrength),
    shader: null,
  };
  m.userData.toon = state;
  m.onBeforeCompile = (shader) => {
    state.shader = shader;
    writeUniforms(state, shader.uniforms);
    if (!shader.fragmentShader.includes('uToonBands')) {
      shader.fragmentShader = FRAGMENT_HEADER + shader.fragmentShader
        .replace(PARS_HOOK, PARS_INJECT)
        .replace(RIM_HOOK, RIM_INJECT);
    }
  };
  // One program for every toon variant (options are uniforms, not defines).
  m.customProgramCacheKey = () => 'pjm2-toon-character';
  return m;
}

/** Apply to every mesh material under a root (clones materials so shared
 *  template mats aren't corrupted). Returns handles to restore. Idempotent
 *  per root: a second call returns the SAME handle (first call's options
 *  win). Non-standard materials (e.g. outline hulls' MeshBasicMaterial) and
 *  userData.isOutline nodes are skipped; multi-material meshes patch only
 *  their standard slots. */
export function applyToonToCharacter(root: THREE.Object3D, opts: ToonOptions = {}): ToonHandle {
  const existing = root.userData.toonShading as ToonHandle | undefined;
  if (existing) return existing;

  const entries: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  // One patched clone per unique source material — meshes sharing a template
  // mat keep sharing (the CharacterLibrary clone economy).
  const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();

  const patchOne = (m: THREE.Material): THREE.Material => {
    const std = m as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return m;
    const hit = clones.get(m);
    if (hit) return hit;
    const clone = std.clone();
    // Material.copy JSON-roundtrips userData (three Material.js:505) — drop
    // any inherited toon state so the clone gets a fresh, live-object state.
    delete clone.userData.toon;
    applyToonShading(clone, opts);
    clones.set(m, clone);
    return clone;
  };

  root.traverse((o) => {
    if (o.userData.isOutline) return; // never toon an outline hull
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material;
    if (Array.isArray(original)) {
      if (!original.some((m) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial)) return;
      mesh.material = original.map(patchOne);
      entries.push({ mesh, original });
    } else {
      if (!(original as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      mesh.material = patchOne(original);
      entries.push({ mesh, original });
    }
  });

  let disposed = false;
  const handle: ToonHandle = {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const { mesh, original } of entries) mesh.material = original;
      // ONLY the patched clones — textures/geometry stay shared, and the
      // template materials are restored untouched (still used by other
      // instances and by CharacterLibrary.dispose).
      for (const clone of clones.values()) clone.dispose();
      clones.clear();
      entries.length = 0;
      delete root.userData.toonShading;
    },
  };
  root.userData.toonShading = handle;
  return handle;
}
