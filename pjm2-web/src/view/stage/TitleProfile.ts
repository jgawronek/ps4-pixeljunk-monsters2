// src/view/stage/TitleProfile.ts
// Post-processing profile `3d_stage_title_1_pp` (PostProcessingBehaviour of the hub's GameCameraTitle; `3d_stage_credit_moon_pp` is identical).
// Decoded from the `stages` bundle with UnityPy (tools/data/export_stage_environment.py `grade_from_profile`), values verbatim.  Differences from the
// hub's gameplay profile `3d_stage_000_topdown_pp` (which the port uses for the walkable map): NO red channel-mixer boost (1.35 there -> the hub
// looked red/orange), brighter log offset (0.913,0.940,1.0 vs 0.656,0.718,1.0 = the hazy lifted look), postExposure 0.65, temperature 10 / tint 13 /
// hueShift -1, a 3-key master curve, and BLOOM enabled (0.7 / threshold 1.1 / knee 0.46 / radius 7).  DoF is DOF_PROFILES.title.

import type { BloomParams } from './PostBloom';
import type { GradeProfile } from './PostGrade';

export const TITLE_GRADE_PROFILE: GradeProfile = {
  postExposure: 0.6499999761581421,
  temperature: 10,
  tint: 13,
  hueShift: -1,
  saturation: 1,
  contrast: 1,
  channelMixer: { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1] },
  logWheels: {
    slope: [1.0, 0.9714181423187256, 0.8602806925773621],
    power: [0.8284944295883179, 1.0, 0.9729524254798889],
    offset: [0.9134198427200317, 0.9399223923683167, 1.0],
  },
  curves: {
    master: [
      { time: 0, value: 0, inSlope: 1.5474684238433838, outSlope: 1.5474684238433838 },
      { time: 0.5324384570121765, value: 0.6261682510375977, inSlope: 1.2426238059997559, outSlope: 1.2426238059997559 },
      { time: 1, value: 1, inSlope: 0.09170188009738922, outSlope: 0.09170188009738922 },
    ],
    red: [
      { time: 0, value: 0, inSlope: 1.115872859954834, outSlope: 1.115872859954834 },
      { time: 1, value: 1, inSlope: 0.29372072219848633, outSlope: 0.29372072219848633 },
    ],
    green: [
      { time: 0, value: 0, inSlope: 1.0255131721496582, outSlope: 1.0255131721496582 },
      { time: 1, value: 1, inSlope: 0.18304330110549927, outSlope: 0.18304330110549927 },
    ],
    blue: [
      { time: 0, value: 0, inSlope: 0.8420000076293945, outSlope: 0.8420000076293945 },
      { time: 1, value: 1, inSlope: 0, outSlope: 0 },
    ],
  },
  vignette: { intensity: 0.46000000834465027, smoothness: 0.23999999463558197, roundness: 1, rounded: false, color: [0, 0, 0], center: [0.5, 0.5] },
};

export const TITLE_BLOOM: BloomParams = { intensity: 0.699999988079071, threshold: 1.100000023841858, softKnee: 0.46000000834465027, radius: 7, antiFlicker: false };
