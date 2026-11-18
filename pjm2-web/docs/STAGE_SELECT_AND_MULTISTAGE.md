# Stage select + multi-stage support

Evidence-first notes for the stage-select / multi-stage work. Decompiled sources are in
`decomp/decompiled/*.c` (Ghidra addresses quoted), serialized data was read with UnityPy from the user's own
AssetBundles. Items that could not be verified are listed explicitly in section 7.

## 1. How the original works

### 1.1 Stage select is a walkable world map
* `Q4.WorldMap` (+`WorldMapArea`, `StagePortal`, `AreaLock`, `StageRainbowIndicator`) is a 3D map scene. The
  player (Tikiman) walks onto a `StagePortal` trigger (`OnTriggerEnter`); `StageSelectController.OnEnterStagePortal`
  stores `currentStagePortal` and `UpdateStagePortal @00531330` fills the stage panel. "Proceed to Stage"
  (`OnProceedToStage`) loads the stage (`StageHub.LoadStage(sceneName, players, cb)`; scene = `<name>_env`).
* `StageSelectController` fields (dump.cs): `stageNameText`, `casualScoreText`, `normalScoreText`,
  `expertScoreText`, `casualPerfectRainbow`/`normalPerfectRainbow`/`expertPerfectRainbow`, `noRecordLabel`,
  `areaNameText`, animators (`stagePanelAnimator`, `areaNameAnimator`, `stageGuideAnimator`), `filmProjector` (stage
  preview video).
* `UpdateStagePortal` (L542-700): for the portal's stage key it reads
  `SaveData.HasClearedStage(name,d)`, `GetStageRecord(name,d)`, `GetStagePerfect(name,d)` for d = 0,1,2 and
  `GetHighestAvailableDifficulty(name)`. Animator int `Difficulty` = highest+1 (selects the casual/normal/expert
  panel background). Score text = record if `record > 0 && cleared`, else the `noRecordLabel` string. Perfect
  rainbow GameObjects are toggled per difficulty.
* Show/Hide (`ShowAnimationCouroutine`, `HideAnimationCouroutine`): yield one frame, then `UpdateAreaPanel` +
  `UpdateStagePortal`, Animator bool `OnInIdle`; hide waits for Animator state `OutIdle`. Clip lengths live in the
  animator controllers (not extracted).
* `StageSelectInventoryController` (coin/gem/medal counters, `hasMedalsOnTheWorldMap`) and
  `StageSelectRainbowController` (rainbow-fragment count, `rainbowPanelCount`) are the corner widgets.
* Prefab `stage_select_01` (globalsettings): hierarchy dump in `.work/stage-multi/ss_prefab.txt`. Layout used by
  `StageSelectScreen.ts`: area banner `stage_sel_title_bg` 883x112 @(960,93); stage panel @(48,168) with bg
  `stage_casual_bg` 392x366 / `stage_normal_bg` 395x496 / `stage_expert_bg` 395x626; stage name (193,58); difficulty
  groups at y 237/367/497 (label + score at +71); mini rainbows at (152,136); rainbow count group @(1776,877)
  (`perfect_big_img` 218x224); preview `guide_photo_bg` 627x402 @(960,480) with the video `Image`.

### 1.2 Progression (SaveData)
* Stage key = **scene name without `_env`** (`StageMain.GetStageNameFromCurrentScene @00525c30`), e.g.
  `3d_stage_002`. `tl_stage_00N` labels repeat per area, so they are NOT keys.
* Unlock (`AreaStageInfoMap.IsStageUnlocked @0072e380`): `!initialLocked || SaveData.unlockedStages.Contains(scene)`
  (+ DLC checks for 3d_stage_016/019 and an `areaIDOverride` recursion; the override only points at the same
  area's first stage for stages 8/9, so it adds no constraint for the 15 shipped stages -- UNVERIFIED reading of the
  recursion's area-id base).
* Clear (`StageResultMenuController.OnCameraSwitch`, L261-808): `AddUnlockedStage(stageInfo.stageUnlockName)` when
  non-empty and absent; `UpdateStageRecord(scene, difficulty, score, perfect)` (returns `oldScore < newScore` =
  the "New!" flag); `HasUnlockedHard` flips true once EVERY available stage has a perfect record
  (`SaveData.UpdateStageRecord` tail L2090-2123).
* `GetHighestAvailableDifficulty @0075a810`: `HasUnlockedHard ? 2 : HasCleared(stage,1) ? 2 : HasCleared(stage,0)`
  = Fun only -> clear Fun -> Tricky -> clear Tricky -> Mayhem. Difficulty names `tl_difficulty_001..003` =
  Fun / Tricky / Mayhem (Easy=0, Medium=1, Hard=2).
* Area gates (`AreaLock.canUnlock @0072b810`): `SaveData.GetTotalPerfectCount() >= requiredRainbows` and every
  `requiredStages` portal cleared (any difficulty); `SetStagesUnlock` adds `unlockStages` to `unlockedStages`
  (rainbow-fragment toll; tl_mini_dialog_text_009/011). The serialized per-area values live in the world-map scene
  (see section 7).
* `numStagesAvailable = 15`; areas 6/7 (`3d_stage_016..021`) are DLC with no scene in the bundle.

### 1.3 Result screen (`Q4.StageResultMenuController`)
* Score (`ComputeScore @0052f550`), constants from the serialized `Q4.ScoreSettings` (globalsettings pid
  6594865192701025772): chibiPoints 50, allChibisSafeBonus 500, clearBonus 10000, allWaveEnemiesKilledPoints 100,
  coinPoints 1, gemPoints 100.
  `score = sum_wave[50*c_i + (c_i==c_{i-1} ? 100 : 0) + (c_i==start ? 500 : 0)] + (coins+interest)*1 + gems*100 + 10000`
  with `c_i = Home.NumChibiAtEndOfWave(i)` over the wave progress list, `c_-1 = NumStartingChibi`.
* Rows (Update @0052f960): Score, Best Score (set directly, not counted), Coins, Gems, Waves Cleared
  (= `waveCurrentIndex`), Bonus (interest coins), Clear Bonus (ScoreSettings.clearBonus), Chibis Saved
  (`NumChibi`). `countUpAlpha += dt/countUpDuration` (3.0 s), eased by the prefab `countUpCurve`
  (Hermite keys (0,0,.207,.207) (.8407,.3316,1.351,1.351) (1,1,8.933,8.933)); `ScoreCountUp` SFX
  (`sfx_menu_scorecount`) every frame while counting; at alpha=1: perfect -> UnityEvent(1,perfect) +
  `GameClearRainbow` SFX (`sfx_stage_rainbowaquired`) + Animator `ShowRainbow`/`ShowPerfectIcon`; new record ->
  `NewRecord` SFX (`sfx_menu_newscore`) + `new_record` animation. `OnConfirm @00530060`: alpha < 1 -> jump to 0.99
  (skip) else start `ResultScreenCoroutines`: optional MedalMenu (`MedalManager.CheckForRewards`,
  `RewardMapping`) then `WorldMap.LoadWorldMap` = back to stage select. BGM `bgm_results`.

### 1.4 Music per stage
`StageMain.Start @005260a0` plays `m_stageMusic` (+0x28); `OnWaveActivate @00527160` plays `m_bossMusic` (+0x30) when
the last wave activates. The PPtrs are cross-file refs resolved with `tools/data/resolve_stage_music.py`
(`src/data/stageMusic.generated.ts`): stage 1 = `bgm_stage_easy`, 2 = `bgm_stage_medium`, 3 = `bgm_stage_hard`,
the pattern repeats per area; area 3 stage 1 / area 4 stage 3 / area 5 stage 3 use `bgm_ex_easy`; boss music
`bgm_boss_1` (areas 1-4) / `bgm_boss_2` (3d_stage_007, 013-015). The old demo constant `bgm_stage_medium` for stage 1
was an unverified guess (now `bgm_stage_easy`).

## 2. What was built

| Area | Files |
|---|---|
| Stage catalogue (15 stages, URLs, `?stage=N`) | `src/data/stageCatalog.ts`, generated `stageCatalog.generated.ts`, `stageMusic.generated.ts` |
| Data export (per-stage bundles) | `tools/data/export_stage_bundles.py` -> `public/assets/data/stage{1..15}-bundle.json`, `stages-index.json` (stage 1 bundle verified identical to the old baseline, not rewritten) |
| Music resolver | `tools/data/resolve_stage_music.py` |
| Scene pipeline (one command per stage) | `tools/stages/build_stage.sh <3d_stage_NNN>` (extract scene -> col0 -> colliders -> WebP -> mesh pack/shuffle -> gzip) |
| Progression + persistence | `src/view/save/SaveData.ts` (+unlockedStages/hasUnlockedHard/medals/lastPlay, legacy `tl_stage_001` key copy), `src/view/save/StageProgress.ts` |
| Score + count-up | `src/view/ui/ResultScore.ts`, `OriginalScreens.ts` (Score/Best/Bonus/Clear Bonus rows, count-up, skip, New!, Stage Select/Next/Retry), `GameShell.ts` (`ResultsData.score`), `src/main/stageResult.ts` |
| Stage select UI | `src/view/ui/StageSelectModel.ts`, `StageSelectScreen.ts`, `src/main/stageSelectFeature.ts`, `stage-select.html` + `src/main/stage-select.ts`, `tools/assets/extract_stage_select_assets.py` (sprites + 15 thumbnails) |
| Flow | `src/main/flow.ts` (extended: `boot -> stageSelect` edge); stageSelect claimed by `StageSelectFeature`, `stageLoading` handled by game.html boot |
| game.ts | `STAGE_CFG` (`?stage=N`), `GAME_DIFFICULTY` (`?diff=`), per-stage BGM/boss BGM, save key = scene name, result score + unlock/record save, result exits |
| Packs | `tools/assets/pack_assets.ts`: boot-data excludes per-stage bundles; `stageN-boot` (low), `ui-stage-thumbs` (low). **`npm run build:packs` not re-run** (stale by design until the owner rebuilds) |
| Headless | `npm run sim:stage1 -- <N>` (also `STAGE=N`) |

### Stage switching without a page reload
`game.ts` is a single-boot module with module-level singletons (renderer, sim world, audio, UI roots, particles), so
a clean in-page teardown/rebuild was NOT attempted inside the shared file. Stage changes are full navigations
(`game.html?stage=N&notitle&diff=D`); the previous stage's GPU resources are released by the page unload. The
flow state machine reflects the transition (`stageSelect -> stageLoading`), and the loading screen is game.html's
existing one. In-page disposal (`StageSceneView.dispose`, particles, views) is a follow-up that needs game.ts to be
split into `createStage()/dispose()`.

## 3. Per-stage status
> **UPDATE:** the pinned hashes / outcomes in this table are the OLD naive-bot results. Current pins, bot modes, root causes of the stage 2/4 GAME OVERs
> (air enemies vs a ground-only cannon bot, bot standing above the coins, missing boss weak points / damage tables) and results for stages 6-15 (synthetic layout)
> are in docs/STAGE_GAMEPLAY_AUDIT.md and tests/data/headless-stages.test.ts.


Headless = `npm run sim:stage1 -- N` with the bot (naive: builds arrow towers on the trees nearest the wave paths, null
physics seam). Hashes are pinned in `tests/data/headless-stages.test.ts` (re-pin when sim semantics change; stage 1
was `0x27227819f56d94ad` before the enemy-drops work and is now `0x61889fae2ea828f1`).

| # | scene | area / stage | waves | data bundle | scene+colliders+packs | headless (pinned) | browser | enemy views present | notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 3d_stage_001 | Pockulu Forest 1 | 10 | yes | yes (original) | STAGE CLEARED `0x61889fae2ea828f1` | not re-run after game.ts edits | all | boss_bero_00 |
| 2 | 3d_stage_002 | Pockulu Forest 2 | 10 | yes | yes (extracted this session) | GAME OVER `0xf5dec45809d65bcb` | probe hung (machine load ~40, software GL); NOT verified | all | boss_bero_01; bot loses (not a sim error: bot is naive) |
| 3 | 3d_stage_003 | Pockulu Forest 3 | 10 | yes | yes | STAGE CLEARED `0x049939b21ebc36d6` | scene present, not probed | all | boss_bero_02 |
| 4 | 3d_stage_004 | Karstale Highlands 1 | 15 | yes | yes | GAME OVER `0xacc118c9d7e8277a` | not probed | all (bat, boss_kao_00) | flying bats, boss_kao |
| 5 | 3d_stage_005 | Karstale Highlands 2 | 15 | yes | yes | STAGE CLEARED `0x0201d49b499cc085` | not probed | all (spider_02, boss_kao_01) | |
| 6-15 | 3d_stage_006..015 | areas 2-5 | 15/20 | yes | NO (scene not extracted: size/time budget) | not run (needs scene.json) | no | all views already in `public/assets/characters` | enemy sets in 4 |
| 16-21 | 3d_stage_016..021 | DLC areas 6/7 | - | - | not in the stages bundle | - | - | - | out of scope |

Run `tools/stages/build_stage.sh 3d_stage_006` (then `node .work/repack-textures.mjs` is part of it) to add more;
sim support is generic. Each stage directory is ~330-430 MB on disk (raw PNG sources 190 MB + WebP 99 MB + packs);
only `textures_webp`, `scene-webp.json`, `meshes.pack.sh.bin(.gz)`, `physics` and `sky` are needed at runtime.

### Enemy sets (waves) per stage (all have extracted views)
See `.work/stage-multi/enemy_sets.txt`; new vs stage 1: bat (4,6,7,9-11,13-15), bee (8-11,13-15), cisors (10,12,13,15),
boss_kao (4-7), boss_ude (8-12), boss_fat (13-15), kuri/giant/spider variants 01..06. Whether the sim ports every
mechanic (bats flying paths, bee tower interaction, cisors, boss attacks) is NOT verified by the headless bot; stage
4 ends in GAME OVER at wave 5 with the naive bot and was not inspected for unported behaviour.

## 4. Per-stage environment
All five extracted scenes share the same RenderSettings (`skyboxMaterial` = `sky_test_003`, no fog, one
directional light colour (0.976,0.922,0.718) intensity 1.5, same top-down camera 'GameCameraTopDown(Real)' at
(0,22,30.59)), the same home (`home_001` at the origin) and 25-31 `RespawnPoint`s. The sky cubemap faces were copied
from stage 1 (identical shared asset). `SkyAtmosphere.DEFAULT_SKY_TEXTURE_URL`, `PostGrade` ("3d_stage_001_topdown_pp"),
`StageAmbient` and `CameraFollow` still carry stage-1 constants (owned by the lighting agent); the other scenes'
post-process profile objects were not diffed against stage 1 -- UNVERIFIED that they are identical.
Water params / river material come from the scene (`riverMeshes`); stage 4/5 use skyboxMaterial index 18 (different
material slot, same texture name).

## 5. Verification log
* `npm run check` (tsc + 86 files / 1248 tests incl. pinned per-stage hashes): GREEN.
* Browser: `.work/probe-stage2.cjs` (`?stage=2&lite&notitle`) was still running/hung after 30+ min under load (left running; not killed because the kill was denied); `probe-visual.cjs` (stage 1) was NOT re-run after the game.ts edits. Both UNVERIFIED -- run them first when the machine is quiet.
* UI screenshots (ui-lab, no WebGL): `.work/stage-multi/stageselect.png`, `results.png` via
  `.work/probe-stageselect.cjs` (`/ui-lab.html?scene=stageselect|results`).

## 6. URL / flow contract
* `game.html?stage=N` (1..15, default 1, invalid -> 1), `&diff=0|1|2` (default 1 = Tricky), `&notitle` (unchanged).
* `stage-select.html` = stage select page; result screen entries: Stage Select / Next / Retry.
* `flow.ts`: `boot -> stageSelect` added. `StageSelectFeature` claims `stageSelect`; a pick runs
  `flow.go('stageLoading', {stageId, stage, difficulty})` then the launcher (navigation by default).

## 7. Unverified / missing (honest list)
* World map walk-around (3D map, portals, Tikiman, flyover, stage clear/unlock cinematics, rainbow indicators,
  weather) is NOT ported; replaced by a grid cursor with the original panel contents.
* Show/Hide animation timings are approximations (Animator clips not extracted).
* `CountUpValue.Evaluate` rounding (0x52fe60) not located in the disassembly: modelled as floor(eased*target).
* `noRecordLabel` text is a serialized string not extracted: "-" is used.
* AreaLocks ARE wired (data read from BuildPlayer-3d_stage_000_env): 2 rainbows -> stages 4,7; 6 -> 8..12; 9 -> 13;
  pressing Start on a locked stage whose lock is satisfiable opens it (rainbows not spent). The in-world
  interaction/dialog (tl_dialog_text_007) is not ported.
* Medals (`MedalManager`, `MedalMenuController`, rewards, `StageSelectInventoryController` counters) only have the
  `medalsInTheBank` counter; no reward logic.
* Multiplayer/ranking/guide-book portals, DLC stage locks, trophies not ported.
* HasUnlockedHard fires the data rule but no "Mayhem now available" dialog is shown (strings exist:
  tl_mini_dialog_text_001/002/015).
* Boss music switch uses `waveStartedEvent` (index+1 == waveCount); not browser-verified.
* Per-stage BGM WAVs: only stage_easy/medium/hard + boss_1 + results copied to `public/assets/audio/bgm`
  (bgm_ex_easy/bgm_boss_2 needed for stages 7,12,13-15 not copied: those stages are not extracted).
* In-page stage switching/disposal (see section 2).
