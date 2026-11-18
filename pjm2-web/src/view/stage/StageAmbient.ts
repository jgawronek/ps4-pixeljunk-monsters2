// src/view/stage/StageAmbient.ts
// The stage's real ambient light: RenderSettings.m_AmbientProbe (SH L2) of
// `BuildPlayer-3d_stage_001_env` (stages bundle, RenderSettings pid 6919),
// m_AmbientMode 0 (Skybox), m_AmbientIntensity 0.5.
// See docs/LIGHTING_SATURATION_ANALYSIS.md.
//
// The port used to light the stage with an invented HemisphereLight
// (sky 0xbdd3e8 / ground 0x5a6b4a) plus the PMREM of ONE clamped cubemap face;
// neither exists in the original. Unity's Standard shader adds
// `ShadeSH9(normal) * albedo` (indirect diffuse = baked SH irradiance), so the
// faithful port is a THREE.LightProbe fed with the serialized coefficients, and
// the PMREM's diffuse term is switched off (it stays as the specular source).

import * as THREE from 'three';

/** m_AmbientProbe `sh[0..26]` = `sh[rgb*9 + coef]`, Unity layout, verbatim. */
export const STAGE1_AMBIENT_SH: readonly number[] = [
  0.8559970855712891, 0.7393820285797119, 0.2774817645549774, -0.591809093952179, -0.9418457746505737,
  0.44583961367607117, -0.1304762363433838, -0.40536248683929443, -0.017665239050984383,
  0.6895037293434143, 0.5839086174964905, 0.18663707375526428, -0.48264238238334656, -0.728358268737793,
  0.3272991180419922, -0.10042764246463776, -0.2869722843170166, -0.003965471871197224,
  0.5245572328567505, 0.4558422267436981, 0.09762892127037048, -0.41226091980934143, -0.5406513810157776,
  0.20817360281944275, -0.07278161495923996, -0.1657678633928299, 0.004569893702864647,
];

/** RenderSettings.m_AmbientIntensity (Skybox ambient mode scales the probe). */
export const STAGE1_AMBIENT_INTENSITY = 0.5;

/** SH basis normalisation constants (l=0, l=1 x3, l=2 x5). Unity stores
 *  coefficients pre-multiplied by them (`m_IndirectSpecularColor` = DC term =
 *  mean sky radiance, matches `sh[0], sh[9], sh[18]`). */
const BASIS = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274];

/** Sign per coefficient converting Unity world axes into three's frame. The port mirrors ONLY x (x -> -x), so the
 *  x-odd real-SH terms flip: x, xy, xz. Order y z x | xy yz (3z2-1) xz (x2-y2).
 *  Earlier revisions also flipped z ("Unity is left-handed") -- wrong: UnityCG evaluates
 *  `dot(unity_SHAr, (n.x, n.y, n.z, 1))`-style with the world normal as is (sh[3], sh[1], sh[2] = x, y, z coefficients),
 *  and projecting the HDR baked reflection probe (decoded by tools/stages/bc6h_hdr.py, cube layout validated by edge
 *  continuity) onto the real-SH basis in Unity world axes reproduces ALL 9 baked coefficient signs with z unflipped
 *  (ratio 3.0-3.3 on every coefficient; z-linked terms z, yz, xz would be negated by the old table). */
const SIGN_FOR_THREE = [1, 1, 1, -1, -1, 1, 1, -1, 1];

/** Unity probe -> three SH3 radiance coefficients (x mirrored, z flipped). */
export function unityProbeToThree(sh: readonly number[], intensity = 1): THREE.SphericalHarmonics3 {
  const out = new THREE.SphericalHarmonics3();
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 9; k++) {
      const v = sh[c * 9 + k] / BASIS[k] * SIGN_FOR_THREE[k] * intensity;
      const target = out.coefficients[k];
      if (c === 0) target.x = v; else if (c === 1) target.y = v; else target.z = v;
    }
  }
  return out;
}
/** Irradiance/pi in three's frame for a unit normal (what a white Lambert
 *  surface reflects of the ambient; the same maths as three's shader). */
export function probeIrradianceOver(sh: THREE.SphericalHarmonics3, normal: THREE.Vector3): THREE.Vector3 {
  const e = new THREE.Vector3();
  sh.getIrradianceAt(normal, e);
  return e.multiplyScalar(1 / Math.PI);
}

export interface StageAmbient {
  probe: THREE.LightProbe;
  dispose(): void;
}

let chunkPatched = false;
/** Switch the PMREM environment's DIFFUSE contribution off globally (the SH
 *  probe replaces it; reflections keep using the environment map). */
export function disableEnvDiffuse(): void {
  if (chunkPatched) return;
  const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
  const patched = chunk.replace('return PI * envMapColor.rgb * envMapIntensity;', 'return vec3( 0.0 );');
  if (patched === chunk) throw new Error('StageAmbient: three getIBLIrradiance signature changed');
  THREE.ShaderChunk.envmap_physical_pars_fragment = patched;
  chunkPatched = true;
}

export function addStageAmbient(
  scene: THREE.Scene, intensity = STAGE1_AMBIENT_INTENSITY, sh: readonly number[] = STAGE1_AMBIENT_SH,
): StageAmbient {
  disableEnvDiffuse();
  const probe = new THREE.LightProbe(unityProbeToThree(sh, 1), intensity);
  probe.name = 'StageAmbientSH';
  scene.add(probe);
  return { probe, dispose: () => { scene.remove(probe); } };
}
