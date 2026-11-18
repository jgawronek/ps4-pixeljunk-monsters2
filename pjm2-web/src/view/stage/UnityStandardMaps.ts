// src/view/stage/UnityStandardMaps.ts
// Unity 5.6 "Standard" texture-channel semantics on three's MeshStandardMaterial.
//
// EVIDENCE (stages/props/structures bundles, all 19 stage-1 materials are
// shader "Standard", _Mode 0, keywords _METALLICGLOSSMAP _NORMALMAP):
//   * every *_Normal texture is BC3/DXT5 with colorSpace 0. Decoded PNGs have
//     R==G==B (corr 0.997+) and an INDEPENDENT alpha; B mean is ~127, not 255.
//     That is the DXT5nm layout: x in ALPHA, y in GREEN, z reconstructed
//     (Unity UnpackNormalDXT5nm / UnpackScaleNormal). three's normalMap reads
//     rgb as xyz, i.e. x=y=z=v: every prop normal was garbage.
//     (x^2+y^2 <= 1 for >=98.7% of texels on every map when read as (A,G).)
//   * *_Metal textures: R = metallic (0 on all props), A = smoothness
//     (_SmoothnessTextureChannel 0 = metallic-map alpha), scaled by
//     _GlossMapScale. three's roughnessMap reads G and metalnessMap reads B.
//   * Occlusion: Unity samples .g; baked AO is gray (R==G==B) so three's .r is
//     identical; strength via _OcclusionStrength (aoMapIntensity).

import * as THREE from 'three';

export interface UnityStandardMapOptions {
  hasNormalMap: boolean;
  hasMetalGlossMap: boolean;
  glossMapScale: number;
}

/** Fragment patch (pure string transform; unit-tested against real chunks). */
export function patchUnityStandardFragment(src: string, o: UnityStandardMapOptions): string {
  // ROOT CAUSE of the "dark speckled hut": inside onBeforeCompile the fragment
  // source still contains `#include <chunk>` directives (three resolves them
  // AFTER the hook), so the literal-text replaces below never matched and every
  // prop kept three's defaults: roughness = map.G (=0 -> mirror finish, sky
  // reflections) and raw-rgb normals. Expand the three chunks we patch first.
  let out = src;
  for (const chunk of ['normal_fragment_maps', 'roughnessmap_fragment', 'metalnessmap_fragment'] as const) {
    out = out.replace(`#include <${chunk}>`, THREE.ShaderChunk[chunk]);
  }
  if (o.hasNormalMap) {
    out = out.replace(
      'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy *= normalScale;',
      // Unity UnpackScaleNormalDXT5nm: xy = (a, g) * 2 - 1, scaled; z = sqrt(1 - |xy|^2).
      'vec4 dxt5nm = texture2D( normalMap, vNormalMapUv );\n' +
      '\tvec3 mapN;\n' +
      '\tmapN.xy = ( dxt5nm.wy * 2.0 - 1.0 ) * normalScale;\n' +
      '\tmapN.z = sqrt( max( 1.0 - dot( mapN.xy, mapN.xy ), 0.0 ) );',
    );
  }
  if (o.hasMetalGlossMap) {
    const s = o.glossMapScale.toFixed(6);
    out = out
      .replace('roughnessFactor *= texelRoughness.g;', `roughnessFactor *= ( 1.0 - texelRoughness.a * ${s} );`)
      .replace('metalnessFactor *= texelMetalness.b;', 'metalnessFactor *= texelMetalness.r;');
  }
  return out;
}

export function installUnityStandardMaps(m: THREE.MeshStandardMaterial, o: UnityStandardMapOptions): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchUnityStandardFragment(shader.fragmentShader, o);
  };
  m.customProgramCacheKey = () =>
    `unity-standard-maps-${o.hasNormalMap ? 'n' : '-'}${o.hasMetalGlossMap ? 'm' : '-'}${o.glossMapScale}`;
}
