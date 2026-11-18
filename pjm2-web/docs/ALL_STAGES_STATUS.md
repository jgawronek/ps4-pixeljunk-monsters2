# All 15 stages: status, per-stage environment, gaps

## 1. Per-stage status
Browser column = `.work/probe-stage-env.cjs N` (`?stage=N&lite&notitle&nointro`, 640x360, software GL, `focusCamera(0,0)` screenshot in
`.work/stage-multi/browser-stageN.png`): 0 page errors, HUD attached, ticks >= 3, trees > 0. Headless = `npm run sim:stage1 -- N`
(pinned in tests/data/headless-stages.test.ts; TIME CAP = naive bot neither wins nor loses within the tick budget).

| # | scene | extracted | validate | headless (pinned) | browser | env source | look (screenshot) |
|---|---|---|---|---|---|---|---|
| 1 | 3d_stage_001 | yes | pass | CLEARED 0x61889fae2ea828f1 | OK | own | green forest (reference) |
| 2 | 002 | yes | pass | GAME OVER 0xf5dec45809d65bcb | OK | = stage 1 (own row, identical) | like stage 1 |
| 3 | 003 | yes | pass | CLEARED 0x049939b21ebc36d6 | OK | = stage 1 | like stage 1 |
| 4 | 004 | yes | pass | GAME OVER 0xacc118c9d7e8277a | OK | area-2 row | tan canyon, blue clear colour |
| 5 | 005 | yes | pass | CLEARED 0x0201d49b499cc085 | OK | = stage 4 | canyon |
| 6 | 006 | NEW | pass | CLEARED 0x02de9a8500558bce | OK | = stage 4 | canyon |
| 7 | 007 | NEW | pass | GAME OVER 0x37ad11da0709c500 | OK | area-3 row (own pp) | dark volcanic, red rim lights, grey clear |
| 8 | 008 | NEW | pass | GAME OVER 0x89012f26018ccd5f | OK | = stage 7 | volcanic |
| 9 | 009 | NEW | pass | GAME OVER 0xabff20fd9d057bf5 | OK | = stage 7 | volcanic |
| 10 | 010 | NEW | pass | TIME CAP 0x2253727cdb44d207 | OK | area-4 row (own pp) | snow, cold blue light |
| 11 | 011 | NEW | pass | TIME CAP 0x573f58a385d26eac | OK | = stage 10 | snow |
| 12 | 012 | NEW | pass | CLEARED 0xcd0b1a3e78985f4a | OK | = stage 10 | snow |
| 13 | 013 | NEW | pass | TIME CAP 0x3e9deca749391dc6 | OK | area-5 row (own pp) | bright green-blue |
| 14 | 014 | NEW | pass | TIME CAP 0x4fd60d844a13e20b | OK | = stage 13 | |
| 15 | 015 | NEW | pass | TIME CAP 0x8695fe6a30ad0924 | OK | = stage 13 | |

(All 15 stages load with 0 page errors.)

## 2. What differs per stage (read from the stages bundle, `tools/data/export_stage_environment.py`)
Area = 3 stages. Post-processing profile ("<n>_topdown_pp", resolved through the camera's PostProcessingBehaviour PPtr, cross-file):
stages 1-3 = 001 profile, 4-6 = 004, 7-9 = 007, 10-12 = 010, 13-15 = 013.

| value | areas |
|---|---|
| RenderSettings ambient SH probe | stages 1-3 and 13-15 identical (sh[0]=.856); 4-9 (sh[0]=.429); 10-12 (sh[0]=.238) |
| m_AmbientIntensity | stages 1-3 **0.5**, all others **1.0** |
| skybox cubemap (specular env) | 1-3 and 13-15 sky_test_003; 4-9 sky_test_001; 10-12 sky_test_002 (water `_SkyMap` is always sky_test_003) |
| camera clear colour (visible background) | 1-3 #81b5d4; 4-6 #43b3f6; 7-9 #3e3e42; 10-12 #8ea6b4; 13-15 #5da5d0 |
| grade: postExposure / temp / tint / hue / contrast | 1-3: .6/10/13/-1/1.07; 4-9, 13-15: .4/0/0/0/1.0; 10-12: .6/10/13/0/1.0 |
| grade: channel-mixer red.x | 4-9, 13-15: 1.35 (others 1.0); curve master slopes 4+ : 1.2469/.7048 (stage 1: 1.5331/.0335) |
| grade: log offset | 10-12: (.506,.591,1.0) instead of (.656,.718,1.0) |
| vignette | same .47/.25 everywhere (13-15 roundness .95) |
| bloom | disabled 1-3; **enabled 4-15** (intensity .75/.73/.75/.5, threshold 1.1/.94/1.1/1.1) -- NOT ported |
| lights | in scene.json already per stage: main "Directional Light" colour/intensity differ (1.5; stage 7-9 1.3 and 4-6 (.79,.75,.63); area 4 (.83,.92,1.0)), rim "(Lim)" lights red (7-9), blue (10-12), yellow else |
| shadows | identical in all stages (soft, strength .8, bias .05, normalBias .4, near .2; only "Directional Light" casts) |
| fog | off in all 15 |
| water material (scene.json) | per stage: `_Color1`, `_FlowSpeed` (.3 / .8 stage 7-9), `_SpecStrength`, `_RefractScale`, FlowMap present only in areas 1,3 |
| camera rig | fov 22.5, pitch 45, distance 30, follow params identical; stage 11's rig POSITION is on +X but its rotation equals the others (yaw 0 used; unverified) |
| music | `stageMusic.generated.ts` (ex_easy for 7, 12, 15; boss_2 for 7, 13-15). WAVs bgm_ex_easy, bgm_boss_2 now copied to public/assets/audio/bgm |
| home / player start / respawn | from the scene nodes (home_001, RespawnPoint) -> already per stage |

## 3. What was generalized / fixed
* `src/view/stage/StageEnvironment.ts` (+ generated `src/data/stageEnvironment.generated.ts`): typed per-stage config consumed by `stageSession.ts`
  (WaterPass grade profile + clear colour, StageAmbient SH + intensity, StageCamera fov/pitch/yaw, SkyAtmosphere env texture). Stage 1 reproduces the
  old constants (tests/view/stageEnvironment.test.ts compares SH, grade profile, baked LUT, clear colour).
* **Bug**: `StageSceneView` matched the terrain/river materials by the literal id `terrain_001_m` / `terrain_001_river_m`; stages 4-15 name them
  `terrain_004/007/010/013_*`, so the splat terrain and the Nature/Water river were built as plain Standard materials (white ground, no water
  shader). Now resolved by shader name (`resolveSpecialMaterials`). Affects stages 4-15 (and the old stage 4/5 claims).
* `tools/stages/install_stage_sky.py` (called by build_stage.sh): water cube faces + `<cube>_env.webp` PMREM environment for stages whose skybox
  is sky_test_001/002 (`extract_sky_cube.py` takes name/out dir; also writes the env face).
* `validate_stage_scene.py`: stage-1-only terrain parity numbers.
* pack_assets: EXTRA_STAGES = 2..15 (packs not rebuilt: `npm run build:packs` is the owner's step).

## 4. Missing / unverified
* **Bloom** (profiles 4-15; threshold ~1.1 on an LDR (HDR=false) camera => subtle glow of near-white pixels only), **AO** (all stages), FXAA->MSAA.
* `StageWeatherPlayer` (stages 4-6 and 10-12: random weather effect prefab every 10-60 s), `GrassInstanceRenderer` (stages 1-6; instanced grass), `ParticleGroupEvent` (1-3), BirdEmitter counts differ.
* Stages 7-9: `Fruit` + `BuffSettingFastPlayer` + `PickupMovement` (speed-fruit pickup) not wired in sim/view.
* `?` 1 script (unresolved MonoBehaviour) in stages 5-15; `InteractionObject` (1-3 per stage), `HiddenTreePickup` counts 4-14: relies on the existing generic handling, not verified per stage.
* Skybox `_Rotation` (248 in areas 1,5, 0 elsewhere) only matters for the PMREM; not applied.
* Colour/mood vs the original is only judged by the data (no reference screenshots for stages 4-15).
* Headless bot concurrently being changed by another agent (smart bot, balloons): pins 6-15 were taken with the default mode of that file at the time.


## 5. Browser log
`.work/stage-multi/probe-all.log`.
