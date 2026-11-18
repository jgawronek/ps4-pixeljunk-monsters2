// src/view/stage/StageEnvironment.ts
// Typed per-stage environment, derived from the generated table (src/data/stageEnvironment.generated.ts, built by
// tools/data/export_stage_environment.py from the shipped stages bundle). It replaces the "stage 1 constants for every
// stage" wiring: ambient SH probe + intensity, PostProcessing grade profile, camera clear colour / fov / yaw / pitch,
// light shadow parameters, fog, skybox/water cube, music. Stage 1 resolves to the values that used to be hard-coded
// (StageAmbient.STAGE1_*, PostGrade.STAGE1_GRADE_PROFILE, SkyAtmosphere.SKY_CLEAR_COLOR) -- see tests/view/stageEnvironment.test.ts.
//
// Pure data mapping (no THREE / DOM): Node-testable. game.ts consumes it via stageEnvironmentFor(STAGE_CFG.entry.scene).

import { STAGE_ENV_DATA, type StageEnvData } from '../../data/stageEnvironment.generated';
import type { GradeProfile, HermiteKey } from './PostGrade';

export interface BloomSettings { enabled: boolean; intensity: number; threshold: number; softKnee: number; radius: number; antiFlicker: boolean }

export interface StageEnvironment {
  scene: string;
  /** RenderSettings.m_AmbientProbe (27 SH, Unity layout) x m_AmbientIntensity. */
  ambient: { sh: readonly number[]; intensity: number };
  /** Gameplay camera background (sRGB hex) -- the visible "sky" outside the terrain and the water pass' far colour. */
  clearHex: number;
  clearColor: readonly [number, number, number];
  camera: {
    fov: number; near: number; far: number;
    pitchDeg: number;
    /** Boom azimuth in the port's three-space (StageCamera.yawDeg convention); derived from the serialized rotation. */
    yawDeg: number;
    minDistance: number; maxDistance: number;
  };
  /** PostProcessing Stack v1 profile of the gameplay camera (grade applied by WaterPass/PostGrade). */
  grade: GradeProfile;
  bloom: BloomSettings;
  ambientOcclusion: { enabled: boolean; intensity: number; radius: number };
  postProfile: string;
  fog: StageEnvData['fog'];
  skybox: StageEnvData['skybox'];
  /** Water `_SkyMap` cube name (all shipped stages use sky_test_003 in the Nature/Water material). */
  waterSkyCube: string;
  /** Shadow parameters of the shadow-casting directional light (Light.m_Shadows). null = no shadow caster. */
  shadow: { strength: number; bias: number; normalBias: number; nearPlane: number; casterName: string } | null;
  music: { stage: string | null; boss: string | null };
  initCoin: number;
  initGem: number;
  /** True when the table was found (false = fallback to stage 1). */
  known: boolean;
}

const toKeys = (k: readonly { time: number; value: number; inSlope: number; outSlope: number }[]): HermiteKey[] =>
  k.map((x) => ({ time: x.time, value: x.value, inSlope: x.inSlope, outSlope: x.outSlope }));
const t3 = (a: readonly number[]): [number, number, number] => [a[0], a[1], a[2]];

/** Map the generated row to a GradeProfile (the shape PostGrade.bakeGradeLut/makeGradeUniforms consume). */
export function gradeProfileFromEnv(d: StageEnvData): GradeProfile {
  const g = d.post.grade;
  return {
    postExposure: g.postExposure, temperature: g.temperature, tint: g.tint, hueShift: g.hueShift,
    saturation: g.saturation, contrast: g.contrast,
    channelMixer: { red: t3(g.channelMixer.red), green: t3(g.channelMixer.green), blue: t3(g.channelMixer.blue) },
    logWheels: { slope: t3(g.logWheels.slope), power: t3(g.logWheels.power), offset: t3(g.logWheels.offset) },
    curves: { master: toKeys(g.curves.master), red: toKeys(g.curves.red), green: toKeys(g.curves.green), blue: toKeys(g.curves.blue) },
    vignette: {
      intensity: g.vignette.intensity, smoothness: g.vignette.smoothness, roundness: g.vignette.roundness,
      rounded: g.vignette.rounded !== 0, color: t3(g.vignette.color), center: [g.vignette.center[0], g.vignette.center[1]],
    },
  };
}

export function stageEnvironmentFromData(d: StageEnvData, known = true): StageEnvironment {
  const casters = d.lights.filter((l) => l.type === 1 && l.shadowType !== 0);
  // The original's only shadow caster is the main "Directional Light" (m_Type 2 Soft); pick the strongest otherwise.
  const c = casters.find((l) => l.name === 'Directional Light') ?? casters[0] ?? null;
  const td = d.camera.topDown;
  return {
    scene: d.scene,
    ambient: { sh: d.ambient.sh, intensity: d.ambient.intensity },
    clearHex: d.camera.clearHex,
    clearColor: t3(d.camera.clearColor),
    camera: {
      fov: d.camera.fov, near: d.camera.near, far: d.camera.far, pitchDeg: d.camera.pitchDeg, yawDeg: d.camera.yawDeg,
      minDistance: Number(td.minDistance), maxDistance: Number(td.maxDistance),
    },
    grade: gradeProfileFromEnv(d),
    bloom: {
      enabled: d.post.enabled.bloom === 1, intensity: d.post.bloom.intensity, threshold: d.post.bloom.threshold,
      softKnee: d.post.bloom.softKnee, radius: d.post.bloom.radius, antiFlicker: d.post.bloom.antiFlicker !== 0,
    },
    ambientOcclusion: { enabled: d.post.enabled.ambientOcclusion === 1, intensity: d.post.ambientOcclusion.intensity, radius: d.post.ambientOcclusion.radius },
    postProfile: d.post.profile,
    fog: d.fog,
    skybox: d.skybox,
    waterSkyCube: 'sky_test_003',
    shadow: c ? { strength: c.shadowStrength, bias: c.shadowBias, normalBias: c.shadowNormalBias, nearPlane: c.shadowNear, casterName: c.name } : null,
    music: d.music,
    initCoin: d.stageMain.m_initCoin,
    initGem: d.stageMain.m_initGem,
    known,
  };
}

const cache = new Map<string, StageEnvironment>();

/** Environment of a stage scene key ('3d_stage_004'); unknown scene -> stage 1's values (known = false). */
export function stageEnvironmentFor(scene: string): StageEnvironment {
  const hit = cache.get(scene);
  if (hit) return hit;
  const row = STAGE_ENV_DATA[scene];
  const env = row ? stageEnvironmentFromData(row) : stageEnvironmentFromData(STAGE_ENV_DATA['3d_stage_001'], false);
  cache.set(scene, env);
  return env;
}

export const ALL_STAGE_SCENES: readonly string[] = Object.keys(STAGE_ENV_DATA);

/** PMREM specular-environment texture for a stage: undefined = SkyAtmosphere's default (stage 1's sky_test_003 face);
 *  stages whose RenderSettings skybox is sky_test_001/002 ship `<stage>/sky/<cube>_env.webp`
 *  (tools/stages/install_stage_sky.py). */
export function skyEnvTextureUrl(env: StageEnvironment, sceneBaseUrl: string): string | undefined {
  const cube = env.skybox.cubemap;
  if (!cube || cube === 'sky_test_003') return undefined;
  return `${sceneBaseUrl}sky/${cube}_env.webp`;
}
