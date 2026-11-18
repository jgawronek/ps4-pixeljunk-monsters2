// src/view/stage/StageReflectionProbe.ts
// The stage's baked HDR reflection probe + Unity Standard indirect-specular BRDF.
//
// Evidence (docs/REFLECTION_PROBE_ANALYSIS.md): `BuildPlayer-<stage>_env` has a box ReflectionProbe (HDR, importance 1,
// covers the whole stage) whose `m_BakedTexture` is a 128px BC6H cube with 8 GGX-convolved mips. Stage 1 radiance
// peaks at ~3e4 (the sun) and the blurred lobe at the camera's mirror direction is (1.2, 1.0, 0.8) -- the old env was
// ONE clamped LDR face through three's PMREM (~0.2 in that direction). The terrain's compiled deferred pass samples the
// probe with `texCUBElod` and adds `surfaceReduction * probe * FresnelLerp(F0, grazing, nv)` to the G-buffer emission,
// which on dark-albedo channels (grass R/B = 0.02/0.006) is the dominant pink/lilac term the reference carries.
//
// Port: tools/stages/extract_reflection_probe.py resamples the seamless cube mip chain into an equirect RGBA16F mip
// chain (`probe/reflection_probe.f16.bin|json`); this module uploads it as ONE DataTexture (CubeUVReflectionMapping so
// three keeps it as `scene.environment` verbatim and defines ENVMAP_TYPE_CUBE_UV). Three's PMREM lookup is replaced,
// for scenes whose `environmentIntensity` is NEGATIVE (marker = "Unity probe mode", |value| = probe intensity), by
// Unity's own lookup: `mip = pr*(1.7 - 0.7*pr)*6` (UNITY_SPECCUBE_LOD_STEPS 6) at the un-bent reflection vector, and
// RE_IndirectSpecular by Unity's `surfaceReduction * radiance * FresnelLerp` with diffuse x (1 - reflectivity).
// PMREM environments (positive intensity, other stages/viewers) keep three's stock path untouched.
//
// three 0.169 note: onBeforeCompile sees `#include <chunk>` UNRESOLVED; we patch the ShaderChunk strings themselves
// (global, idempotent, inert unless the marker is set) and tests assert against the real ShaderLib/ShaderChunk text.

import * as THREE from 'three';

export interface ProbeMipMeta { width: number; height: number; bytes: number }
export interface ProbeMeta {
  format: string;
  mips: ProbeMipMeta[];
  /** UNITY_SPECCUBE_LOD_STEPS (6 in Unity 5.6). */
  lodSteps: number;
  /** ReflectionProbe.m_IntensityMultiplier (x RenderSettings.m_ReflectionIntensity = 1 for every shipped stage). */
  intensity: number;
}

export const PROBE_FORMAT = 'equirect-rgba16f-mips';

/** Unity (5.6) `Unity_GlossyEnvironment`: roughness remap then LOD. */
export function unityGlossyMip(perceptualRoughness: number, lodSteps = 6): number {
  const pr = Math.min(1, Math.max(0, perceptualRoughness));
  return pr * (1.7 - 0.7 * pr) * lodSteps;
}

/** Equirect lookup used by the shader (Unity world dir): u = atan2(z,x)/2pi + 0.5, v = acos(y)/pi. */
export function equirectUv(ux: number, uy: number, uz: number): [number, number] {
  const n = Math.hypot(ux, uy, uz) || 1;
  return [Math.atan2(uz / n, ux / n) / (2 * Math.PI) + 0.5, Math.acos(Math.max(-1, Math.min(1, uy / n))) / Math.PI];
}

export function stageProbeUrls(sceneBaseUrl: string): { json: string; bin: string } {
  return { json: `${sceneBaseUrl}probe/reflection_probe.json`, bin: `${sceneBaseUrl}probe/reflection_probe.f16.bin` };
}

/** Validate the exporter's JSON. Throws on anything the shader cannot sample correctly. */
export function parseProbeMeta(raw: unknown): ProbeMeta {
  const m = raw as Partial<ProbeMeta> | null;
  if (!m || m.format !== PROBE_FORMAT || !Array.isArray(m.mips) || m.mips.length < 7) throw new Error('reflection probe: bad meta');
  for (const [i, mip] of m.mips.entries()) {
    if (mip.bytes !== mip.width * mip.height * 8) throw new Error(`reflection probe: mip ${i} size mismatch`);
    if (i > 0 && mip.width !== Math.max(1, m.mips[i - 1].width >> 1)) throw new Error(`reflection probe: mip ${i} not halved`);
  }
  return { format: m.format, mips: m.mips, lodSteps: m.lodSteps ?? 6, intensity: m.intensity ?? 1 };
}

/** One RGBA16F DataTexture with the Unity-convolved mip chain (level m of the file = cube mip m). */
export function buildProbeTexture(meta: ProbeMeta, buf: ArrayBuffer): THREE.DataTexture {
  const total = meta.mips.reduce((a, b) => a + b.bytes, 0);
  if (buf.byteLength < total) throw new Error(`reflection probe: ${buf.byteLength} < ${total} bytes`);
  let off = 0;
  const mipmaps = meta.mips.map((m) => {
    const data = new Uint16Array(buf, off, m.bytes / 2);
    off += m.bytes;
    return { data, width: m.width, height: m.height };
  });
  const t = new THREE.DataTexture(mipmaps[0].data, mipmaps[0].width, mipmaps[0].height, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mipmaps = mipmaps;
  t.mapping = THREE.CubeUVReflectionMapping; // kept verbatim as scene.environment (no PMREM conversion)
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.name = 'StageReflectionProbe';
  t.needsUpdate = true;
  return t;
}

// -- shader patches -----------------------------------------------------------------------------------------------

/** GLSL inserted at the top of getIBLRadiance's ENVMAP_TYPE_CUBE_UV branch. */
export const UNITY_RADIANCE_GLSL = `
			if ( envMapIntensity < 0.0 ) {
				// Unity probe mode: un-bent reflection vector, Unity world axes (the port mirrors x), Unity LOD mapping.
				vec3 unityR = inverseTransformDirection( reflect( - viewDir, normal ), viewMatrix );
				vec3 unityDir = vec3( - unityR.x, unityR.y, unityR.z );
				float unityMip = roughness * ( 1.7 - 0.7 * roughness ) * 6.0;
				vec2 unityUv = vec2( atan( unityDir.z, unityDir.x ) * 0.15915494 + 0.5, acos( clamp( unityDir.y, - 1.0, 1.0 ) ) * 0.31830989 );
				return textureLod( envMap, unityUv, unityMip ).rgb * - envMapIntensity;
			}
`;

/** GLSL inserted in RE_IndirectSpecular_Physical after `cosineWeightedIrradiance`. */
export const UNITY_INDIRECT_GLSL = `
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	if ( envMapIntensity < 0.0 ) {
		// Unity UNITY_BRDF_PBS indirect: diffuse = diffColor * gi.diffuse, specular = surfaceReduction * gi.specular * FresnelLerp
		float unityRoughness = material.roughness * material.roughness;
		float surfaceReduction = 1.0 / ( unityRoughness * unityRoughness + 1.0 );
		float reflectivity = max( max( material.specularColor.r, material.specularColor.g ), material.specularColor.b );
		float grazingTerm = saturate( ( 1.0 - material.roughness ) + reflectivity );
		float unityNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 unityF = mix( material.specularColor, vec3( grazingTerm ), pow( 1.0 - unityNV, 5.0 ) );
		reflectedLight.indirectSpecular += radiance * surfaceReduction * unityF;
		reflectedLight.indirectDiffuse += material.diffuseColor * cosineWeightedIrradiance;
		return;
	}
	#endif
`;

const DIFFUSE_LINE = 'material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );';
/** Unity: diffuse = albedo * oneMinusReflectivity (0.96 for dielectrics) for direct AND indirect diffuse. */
export const UNITY_DIFFUSE_GLSL = `${DIFFUSE_LINE}
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	if ( envMapIntensity < 0.0 ) material.diffuseColor *= 1.0 - max( max( material.specularColor.r, material.specularColor.g ), material.specularColor.b );
	#endif`;

let patched = false;
export function patchUnityIndirectChunks(): void {
  if (patched) return;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  // 1. radiance lookup
  const env = C.envmap_physical_pars_fragment;
  const sig = 'vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {';
  const i = env.indexOf(sig);
  const j = i < 0 ? -1 : env.indexOf('#ifdef ENVMAP_TYPE_CUBE_UV', i);
  if (j < 0) throw new Error('StageReflectionProbe: three getIBLRadiance signature changed');
  const k = env.indexOf('\n', j) + 1;
  // 2. indirect BRDF
  const ind = C.lights_physical_pars_fragment;
  const hook = 'vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;';
  if (!ind.includes('void RE_IndirectSpecular_Physical') || !ind.includes(hook)) throw new Error('StageReflectionProbe: three RE_IndirectSpecular_Physical changed');
  // 3. diffuse colour
  const frag = C.lights_physical_fragment;
  if (!frag.includes(DIFFUSE_LINE)) throw new Error('StageReflectionProbe: three diffuseColor line changed');
  C.envmap_physical_pars_fragment = env.slice(0, k) + UNITY_RADIANCE_GLSL + env.slice(k);
  C.lights_physical_pars_fragment = ind.replace(hook, hook + UNITY_INDIRECT_GLSL);
  C.lights_physical_fragment = frag.replace(DIFFUSE_LINE, UNITY_DIFFUSE_GLSL);
  patched = true;
}

/** Make `scene` use the Unity probe: environment = texture, environmentIntensity = -(intensity) (the marker). */
export function installStageReflectionProbe(scene: THREE.Scene, tex: THREE.Texture, intensity = 1): void {
  patchUnityIndirectChunks();
  scene.environment = tex;
  scene.environmentIntensity = -Math.abs(intensity);
}
export function isUnityProbeScene(scene: THREE.Scene): boolean {
  return scene.environmentIntensity < 0 && scene.environment?.name === 'StageReflectionProbe';
}

/** Fetch + build the probe of a stage. Resolves null (stock PMREM path stays) when the stage ships no probe. */
export async function loadStageReflectionProbe(
  sceneBaseUrl: string, fetchFn: typeof fetch = fetch,
): Promise<{ texture: THREE.DataTexture; meta: ProbeMeta } | null> {
  const u = stageProbeUrls(sceneBaseUrl);
  try {
    const [jr, br] = await Promise.all([fetchFn(u.json), fetchFn(u.bin)]);
    if (!jr.ok || !br.ok) return null;
    const meta = parseProbeMeta(await jr.json());
    return { texture: buildProbeTexture(meta, await br.arrayBuffer()), meta };
  } catch {
    return null;
  }
}
