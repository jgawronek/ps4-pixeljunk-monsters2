# Depth of field (Unity Post-Processing Stack v1) — analysis and port

## Facts (decoded with UnityPy from the `stages` / `globalsettings` bundles)
`PostProcessingProfile.depthOfField` (`m_Enabled`, `m_Settings`: focusDistance, aperture, focalLength mm, useCameraFov, kernelSize):

| profile | enabled | focus m | aperture | f mm | kernel |
|---|---|---|---|---|---|
| `3d_stage_NNN_topdown_pp` (all stages + hub) | **0** | 10 | 1.5 | 75 | 1 |
| `3d_stage_001/004/007/010/013_behind_pp` (other stages reuse 001's) | 1 | 2 | 3.5 | 35 | 1 (medium) |
| `3d_stage_NNN_shop_pp` | 1 | 1.0 | 1.2 | 8 | 1 (013: 1.05/1.4/7) |
| `3d_stage_000_behind_pp` | 1 | 5 | 3.5 | 35 | 1 |
| `3d_stage_000_shop_pp` | 1 | 0.85 | 0.8 | 1 | 1 |
| `3d_stage_title_1_pp`, `3d_stage_credit_moon_pp` | 1 | 3 | 4 | 47 | 1 |
| `3d_stage_000_lobby_pp` (globalsettings) | 1 | 0.1 | 32 | 18 | 3 (very large) |

`useCameraFov` is 0 everywhere. kernelSize enum: 0 small / 1 medium / 2 large / 3 very large.

Camera -> profile (PostProcessingBehaviour.profile on each camera, resolved by PathID):
* stage 1: `GameCameraIntro01`, `GameCameraResult`, `GameCameraGameOver(Kill)`, `GameCameraBehind` -> **behind_pp (DoF on)**; `GameCameraIntro02`, `GameCameraTopDown(Real)` -> topdown_pp (off); `ShopCamera_01/02` -> shop_pp.
* hub (`3d_stage_000`): `GameCameraTitle` -> **title_1_pp (on)**; `GameCameraRainbowNN` -> behind_pp; `GameCameraTopDown(Real)` and `IntroCamera` -> topdown/stage-1 profiles (off for topdown).
So **gameplay (top-down) never has DoF**; it is visible on the stage intro cut 1 (the chibis running in), the title/credits backdrop, result/game-over cameras, shops and rainbow cameras.

Scripts: `Q4.GameCameraBehind.UpdateDepthOfField @0043f0d0` (and `GameCameraDolly`, `autoDOFFocusMax`) animate `focusDistance` of the behind camera's model every frame (auto-focus on the player; dolly zoom FOV) — the third-person camera is not ported, so that animation is not either.

Shader (`resources.assets`, "Hidden/Post FX/Depth Of Field"): passes COC CALCULATION, COC TEMPORAL FILTER, DOWNSAMPLE AND PREFILTER, BOKEH FILTER (SMALL/MEDIUM/LARGE/VERY LARGE), POSTFILTER (+ combine) = the PPSv1 / Kino bokeh implementation. Order in the stack: after AO/fog/motion blur, **before bloom and the uber (grade) pass**.

## Formulas (PPSv1 DepthOfFieldComponent, film height 24 mm)
f = focalLength/1000 (or 0.5·0.024/tan(fov/2)); s1 = max(focus, f); lensCoeff = f² / (aperture·(s1−f)·0.024·2); maxCoC = min(0.05, (4·kernel+6)/height);
CoC(d) = (d − s1)·lensCoeff / max(d,1e-5) (signed, clamped ±maxCoC; fraction of screen height).

## Port
`src/view/stage/DepthOfField.ts` (pure maths + `DepthOfFieldPass`), hooked in `WaterPass.render` between the scene render/AO and bloom/copy (`setDof(settings|null)`). Wiring: `stageSession.ts` enables `DOF_PROFILES.stageBehind` on intro cut 1 only; `hubSession.ts` enables `DOF_PROFILES.title` while the title/credits camera is active. `?dof=0` disables. Tests: `tests/view/depthOfField.test.ts`.

Exact: profile values, camera mapping, CoC/lens maths, pass structure, prefilter, bokeh weighting formulas, postfilter, combine, sample counts 16/22/43/71, pre-bloom ordering.
Approximated: the shipped disc-kernel sample positions (a golden-angle spiral with the same counts is used — the constants are in compiled shader code), no temporal CoC filter (TAA only), the river water is drawn after DoF unblurred, and the shader math was reconstructed from PPSv1 knowledge + the confirmed pass list, not disassembled.
Not ported: shop / result / game-over / behind / rainbow cameras (not implemented in the port) and `UpdateDepthOfField` focus animation.
