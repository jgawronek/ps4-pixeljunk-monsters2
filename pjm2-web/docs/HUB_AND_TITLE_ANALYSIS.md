# Hub (world map) scene, title backdrop, credits dance — analysis and port

Scope: the ORIGINAL title screen is drawn over the 3D scene `3d_stage_000` (the "hub"), and the original stage select is a WALKABLE
world map in the very same scene (`Q4.WorldMap`, `Q4.StagePortal`, `Q4.WorldMapArea`, `Q4.AreaLock`). This file records what the
original does (decompiled `decomp/decompiled/Q4.*.c`, addresses = RVA of `Il2CppUserAssemblies.elf`; serialized data read with
UnityPy from the `stages` bundle scene `BuildPlayer-3d_stage_000_env`), what the port does, and what is NOT verified.
Companion docs: `TITLE_OPTIONS_CREDITS_ANALYSIS.md` (title UI / options / credits UI), `STAGE_SELECT_AND_MULTISTAGE.md` (panel + progression),
`STAGE_SESSION_ARCHITECTURE.md` (session lifecycle), `PLAYER_BOUNDS_ANALYSIS.md` (PlayerMover).

## 1. The hub scene (extraction)

`tools/stages/build_stage.sh 3d_stage_000` works unchanged (scene 2146 nodes / 975 render entries (287 renderable LOD0+active) / 65 meshes /
40 materials / 183 textures / 25 lights; terrain meshes `terrain_000_area_N`, rivers, props, 21 rainbow arches, 6 AreaLock barrier groups;
colliders 566 (448 active) incl. 82 capsule + 79 sphere TriggerToPlayer triggers). Output `public/assets/stages/3d_stage_000/`
(scene.json 1.1 MB, meshes 33 MB, textures_webp 243 MB — the hub carries the terrain splat sets of every area). `terrain_001` validation is
"not present" (expected: the hub's terrain is `terrain_000`). No baked reflection probe exists for the hub (PMREM fallback).

* Environment: `tools/data/export_stage_environment.py` now iterates scenes **0..15** (stage 0 = hub; it tolerates the missing `StageMain` / music) and
  regenerates `src/data/stageEnvironment.generated.ts` (rows 1..15 byte-identical to before, verified by diff). Hub row: gameplay camera =
  `GameCameraTopDown(Real)` at (0,22,30.59), **FOV 18** (stages: 22.5), clear colour (0.263,0.702,0.965) (stage 1: 0.506,0.710,0.831),
  post profile `3d_stage_000_topdown_pp`, ambient intensity 0.5, no fog, skybox `skybox_03_m` (`sky_test_003`), 25 lights (22 point lights,
  main `Directional Light` with soft shadows, `Directional Light(Lim)` 0.4). `stageEnvironmentFor('3d_stage_000')` resolves it.
* Gameplay data: `tools/data/export_hub.py` -> `src/data/hubScene.generated.ts` (`HUB_SCENE`: portals, areas, locks, rainbow indicators,
  cameras, player, respawn points; world-space Unity numbers).

### What is in the scene (MonoBehaviour census)
`StagePortal` 42 (21 walk-on portals under `StagePortalRoot/area_00N` + a second component on each `Rainbow_GRP/number_001_N_pa`, which the export
skips), `WorldMapArea` 8 (triggers `Collision_GRP/Area_Col_GRP/area_00N`, `m_areaNameLabel` `tl_area_NNN`), `AreaLock` 11 (6 real barriers with
`unlockStages`; `Unlock_01/02/04/05/06` are inert 3/6/12/99/99-rainbow markers with no stages), `StageRainbowIndicator` 21, `GameCameraTitle`,
`GameCameraTopDown`, `GameCameraBehind` (third-person, distance 1.75, used by shops/special sequences), `PointOfInterest(Trigger)` 59,
`CameraController`/`GameCameraSwitchBlackInOut` 56, `Shop` 8, `RankingPortal`/`GuideBookPortal`/`DLCStageLock`, `Player` (`tikiman_01`),
`WorldMap` (single, on `StagePortalRoot`): `stageSelectBGM` = **`bgm_title`**, `portalSpawnEffectDuration` 5.0 s.
`CameraManager.defaultCamera` (pid 8395) = `GameCameraTopDown(Real)`: **the walkable map is viewed through the same fixed top-down boom camera
as the stages** (minDistance = maxDistance = 30, parallel-move right stick), not through the 1.75 m behind-camera.

## 2. What the original does

### 2.1 World map session (`Q4.WorldMap.Start @00904...`, decompiled in Q4.WorldMap.c)
Creates `StageSelectController` / `StageSelectInventoryController` / `StageSelectRainbowController`, `CameraManager`, the GameCore bridge,
plays `stageSelectBGM` (`bgm_title`), then positions each player: if `SaveData.GetLastPlayStageName()` names a portal (found by
`FindObjectsOfType`) the player is placed at `StagePortal.GetPlayerReturnSpawnLocation(i)` (one of the portal's `spawn_NN` children, i.e. NEXT to
the portal, not on its trigger), else at `SaveData.GetStageSelectReturnPosition(i)`; a fresh game leaves tikiman at his authored origin.
Then `InitInteractive` and the `StageClearSequence` coroutine (post-clear cinematics: unlock-portal camera, new rainbow, hard-mode dialog, game clear).

### 2.2 Portals (`Q4.StagePortal`)
* `Awake @00529700`: remembers its world position; the interaction POI label; **if the stage is not unlocked
  (`!m_ignoreLockedFlag && !AreaStageInfoMap.IsStageUnlocked(stage)`, unless it is the transfer target) it calls `SetActive(false)` on itself** and
  subscribes to the portal-unlocked UnityEvent (`OnPortalUnlocked @0052a3f0` -> `StartSpawn @00529e60`).
* `StartSpawn` re-activates the GameObject and runs `SpawnCoroutine`: spawns `WorldMap.portalSpawnEffectPrefab` (LightningBolt) at the portal, plays
  `GlobalSounds.TowerBuild` then `UnlockArea`, and lerps the position from `pos + portalSpawnStartOffset (0,-0.5,0)` to `pos` over
  `portalSpawnEffectDuration` (5 s).
* `OnTriggerEnter/Exit @0052a1f0/@0052a2f0`: the player's collider fires `UnityEvents.EnterStagePortal/ExitStagePortal`.
* Portal data: capsule trigger (r 1.0, h 1.65, TriggerToPlayer layer 10) at `pos`, children `ShowTriggerCol` (POI sphere r 5), `RespawnRoot/spawn_00,01`
  (+ an editor `Cube`, inactive). Stage 1 at (-15.04,-2,2.54), 2 at (-22.93,-2,-0.86), 3 at (-19.19,-2,6.63) ... 15 at (-63.45,-3,-16.82);
  16..21 (DLC, no scene) at x 7..30, z -26..7.

### 2.3 Stage panel (`Q4.StageSelectController`)
`OnEnterStagePortal @00531bf0` (primary local player only): `currentStagePortal = portal`, `StagePortalSelectController.Show`, `UpdateHelpOptions`,
`UpdateStagePortal @00531330` (panel contents: names, per-difficulty record/perfect, highest available difficulty; see STAGE_SELECT doc §1.1).
`OnExitStagePortal @00531ce0` clears it and hides the select controller. `WorldMapArea.OnTriggerEnter @00907a20` -> `OnEnterArea @005319b0` sets the
area name (`UpdateAreaPanel`), `OnStayArea` refreshes it while the panel is in `OutIdle`. `WorldMapArea.OnEnterTitle @00907880` disables the area
trigger collider and stops the weather, `OnExitTitle @00907a00` enables it (no area banner on the title).
`StagePortalSelectController` (`OnConfirm @0052b3b0`, `OnMenuScroll @0052cc80` = difficulty change, `OnCancel`) shows the difficulty selector and the
confirmation dialog (`tl_dialog_text_006` "Do you wish to play {replace_01}. {replace_02} at {replace_03} difficulty?") before `OnProceedToStage @005330b0`.

### 2.4 AreaLock (`Q4.AreaLock`)
* `get_isUnlocked @0072b9f0`: AND over `unlockStages` ∈ `SaveData.unlockedStages` (empty -> true).
* `get_canUnlock @0072b810`: `GetTotalPerfectCount() >= requiredRainbows` and every `requiredStages` portal has `HasClearedStage(stage, -1)`.
* `ApplyLockState @0072bcb0` (Start/ApplyAllLockStates): **the lock's direct children are active iff NOT unlocked** (`setActiveOnUnlock == 0`):
  the barrier model + the barrier colliders disappear; `ShowUnlockEffect` plays the unlock effect on already-unlocked locks.
* `OnTriggerEnter @0072c0a0` shows the access icon, `OnInteract @0072c380`: not satisfiable -> dialog `dialogText` ("You need {replace_01}
  Rainbow Fragments!"), satisfiable -> `unlockConfirmText` dialog -> `OnUnlockDialogResult @0072ce60` -> `SetStagesUnlock @0072c980` (adds `unlockStages`)
  + `PerformUnlockSequence @0072cab0` (camera cut to the lock, effect, portals spawn). Rainbow fragments are NOT spent (they are a count of perfect clears).
* Serialized (hub scene): `lock_001_pa` and `(3)` need **2** -> stages 4 and 7; `(1)`, `(2)` need **5** -> stage 10; `Col_obj_001 (12)` needs **6** ->
  stages 8..12; `(4)` needs **9** -> stage 13. Barriers: 6 lock groups at (-22.4,0.4,-11.0), (-47.9,1.3,-12.2), (-27.6,-0.3,9.2), (-51.0,-0.3,7.3), (-53.8,-1.6,-5.0)
  (blocker boxes as children) — each opens as soon as ALL its `unlockStages` are unlocked, regardless of which barrier was used.

### 2.5 Rainbow arches (`Q4.StageRainbowIndicator.DecorateRainbows @0052d380`)
One arch GameObject per difficulty (`rainbowEasy/Medium/Hard` = `rainbow_001_N_comp`) is active iff the stage is perfect on that difficulty
(`SetRainbowEnable(d)`); `icingOnTheCake` (`clear_parts_00N`) + the all-rainbow effect when all three are perfect. All start ACTIVE in the scene data.

### 2.6 Title camera and animator
`GameCameraTitle` (node `3d_stage_000_data/CameraRoot/GameCameraTitle`): Camera FOV 50, near 0.3, far 1000, world position **(0, 0.76, 4.79)**,
forward (0, 0.146, -0.989) (i.e. looking at the origin from +Z, slightly upward). Its `LateUpdate @00446120` + `CameraController` +
`GameCameraSwitchBlackInOut` handle the switch; the **Animator controller `GameCameraTitle` has only two 1.0 s clips, `ShowRainbowTitle` and
`HideRainbow`, whose curves are a GameObject-active toggle (path `ef_ui_bg_rainbow_pv`, a child of the camera) and a ParticleSystem property** — there is
NO camera position/FOV/orbit clip: the title camera is static. `tikiman_01` is authored at the origin facing +Z (towards the title camera);
`TitleScreenController.tikimanLocator` is a `level3` object whose transform could not be decoded (UnityPy fails on `level3` MonoBehaviours). The origin is INSIDE the
title home (`Ground_GRP/Home_GRP/home_001_title_pa` sits at the origin = the big stone disc), so the port stands him 1 m in front of it (+Z, towards the title camera,
snapped to the ground): an UNVERIFIED stand-in for the locator. The title animator (`title_screen_ctrl`: InStart 2.5 s -> StartIdle ...) is documented in TITLE_OPTIONS_CREDITS_ANALYSIS §1.3 and unchanged.

### 2.7 Credits scene
Credits run over the separate scene `BuildPlayer-3d_stage_000_credit_env` (present in the `stages` bundle, NOT extracted) with the tikiman dancing
(`CreditDanceEnd` trigger, `m_lastPhaseLength`) to `sfx_tiki_creditdance`.

## 3. Port

| file | role |
|---|---|
| `tools/data/export_hub.py` -> `src/data/hubScene.generated.ts` | portals/areas/locks/rainbows/cameras/respawn data |
| `tools/data/export_stage_environment.py` (+stage 0) -> `src/data/stageEnvironment.generated.ts` | hub environment row |
| `src/view/hub/HubModel.ts` | PURE rules: trigger tests, `selectPortal`, `portalVisible` (Awake), `lockIsUnlocked/lockCanUnlock/lockChildrenActive`, blocker/hidden-node sets, title camera pose, spawn rise, start position (`tests/view/hubModel.test.ts`, 17 tests) |
| `src/main/hubSession.ts` | `createHubSession(services)` / `frame` / `resize` / `dispose` / `setMode('title'\|'select'\|'credits')` / `onState` |
| `src/view/ui/StageSelectScreen.ts` | + hub mode: `setHubMode/setHubTarget/confirmHub` (panel follows the portal underfoot, banner the area; no grid/backdrop/preview) |
| `src/main/game.ts` | shell wiring: hub built at boot (instead of the stage-1 backdrop), `syncHub(mode)` on flow `title/options/credits/stageSelect`, disposed when a stage loads, `window.__pjm2.hub()` |
| `tools/assets/pack_assets.ts` | group `hub-boot` (low priority: manifest, meshes-pack.json, physics, sky) |

Flow (`docs/STAGE_SESSION_ARCHITECTURE.md` lifecycle, hub added): `boot -> [hub loaded = title backdrop, tikiman 1 m in front of the home, GameCameraTitle]` ->
title/options (same camera) -> credits (same camera, tikiman dances) -> `stageSelect` = hub `select` mode (camera blends title -> top-down follow in 1.2 s,
tikiman placed at the last played portal's spawn point or on the title spot, WASD/arrows move, Shift runs via `PlayerMover` on the hub's colliders) ->
standing in a portal trigger shows the panel for that stage -> Z/X difficulty, Enter = `StageSelectModel.pick()` -> `flow.go('stageLoading')` (hub disposed,
stage session built) -> ... -> results -> `stageSelect` (hub rebuilt; Cache API makes the bytes free).
When the hub is not wanted or fails: **`?notitle`, `?stage=N`, `?grid` (or `?nohub`) keep the old behaviour** (stage-1/N backdrop + grid cursor); `?hub`
forces the hub even with `?stage=`. A hub load error is caught in `buildHub` (`hubWanted=false`, `StageSelectScreen.setHubMode(false)`) and the old path boots.
Locked portals are not selectable (`StagePortal.Awake`); AreaLock barriers block until opened (Enter next to the barrier with enough rainbow fragments:
adds `unlockStages` to the save, hides the barrier meshes (`mergeByMaterial:false` keeps per-renderer meshes tagged `userData.nodeIndex`), rebuilds the Rapier world without
the barrier colliders (`removedBlockerColliders`)). Rainbow arches follow the save (`DecorateRainbows`). Prompt strings: `tl_mini_dialog_text_009/011/015`.

## 4. Verification
* `tests/view/hubModel.test.ts` (portal selection, trigger edges, Awake visibility, AreaLock unlock/can-unlock/children/blockers, title camera pose, rainbow-clip
  alpha, spawn rise, start position) — green; `npm run check` see the report.
* Browser probe `.work/probe-hub.cjs` (own no-watch vite on :5393, 640x360, software GL): hub loads in ~16 s to the title (textures stream behind), `hubState`
  `{meshes: 287, colliders: 448, portals: 15, visiblePortals: ['3d_stage_001']}` on a fresh save, the tikiman is grounded on the title spot, entering `select` shows
  "Dawn Fields" (area `tl_area_000`), the portal trigger selects stage 1, Enter at the portal -> `flow` `stageLoading`. Screenshots `.work/hub/*.png`.
* Unchanged: the headless sim (stage 1 hash `0x61889fae2ea828f1`), `?notitle` / `?stage` paths.

## 5. Not verified / approximated (honest list)
* **tikimanLocator** (title position) not decoded; a spot 1 m in front of the home along +Z is used (the authored origin is inside the home mesh).
* **Area containers** `StagePortalRoot/area_00N` are saved INACTIVE in the scene; the port assumes the original activates them (otherwise no `StagePortal.Awake`
  could ever run); not found in the decompiled code.
* **Hub camera**: the top-down boom is the stage camera (`StageCamera`, FOV 18, pitch/yaw from the serialized rotation); the original's `PointOfInterest`
  camera offsets (`m_offsetTopDown`), `CameraController` zones (56 `GameCameraSwitchBlackInOut`), parallel-move stick and fall-out-of-world logic are not ported; title ->
  map is an eased 1.2 s blend, not the original black-in/out cut.
* Not ported: the portal spawn rise + lightning/sfx when a stage unlocks (`SpawnCoroutine`), the unlock camera sequence, the unlock/locked `DialogMenuController`
  dialogs (a one-line prompt/notice is shown instead; `tl_dialog_text_007` is not in the extracted string table), `StagePortalSelectController`'s difficulty menu +
  confirmation dialog (Z/X + Enter instead), guide-book / ranking / shop / changing-room / matching-lobby portals, companions (`CompanionsGathering`), NPC props' animations,
  `StageWeatherPlayer` weather, `BirdEmitter`s, `SoundZone`s, particle groups, `ObjectOutlineRenderer`, bloom/AO of the hub profile beyond what `renderExtrasFor` provides.
* Trigger geometry is a capsule-vs-point approximation of Unity's collider overlap (player capsule r 0.15, centre +0.4); portal spawn points lie just outside the
  trigger (as in the original).
* **Credits**: `3d_stage_000_credit` is not extracted; the credits run over the hub with the title camera and the tikiman playing the existing
  `dance_buildTower_*` loop (the real credit dance clips / camera are not decoded). `sfx_tiki_creditdance` is played by the existing credits host.
* **Music**: `WorldMap.stageSelectBGM` is `bgm_title`; the existing title host keeps title music — the port does not (re)start it on entering the select state.
* **Load cost**: the hub's textures_webp are 243 MB (all areas' terrain sets); decode is progressive but heavy on software GL. `game.html` still preloads the
  stage-1 scene files (`<link rel=preload>`) that the hub path does not use (harmless console warning).
* Screens of the original for comparison were not available; the look is compared only through the data (environment row above).


## 2.7 Title intro in 3D (hut + tikiman entrance) — decoded from the original

`TitleScreenController.StartIntroAnimation @00545740` (+ `InitIntroAnimation`, `Show`):
* `InitIntroAnimation`: player animator trigger `TitleScreenEnterWait` -> tikiman_ctrl state 11 (`tikiman_title_enter` at speed 0 = frame 0 held, tag `TitleIdle`).
* `StartIntroAnimation`: player disabled; first show (`+0xb3 == 0`): `FindGameObjectWithTag("Home")` -> Animator trigger `TitleScreenEnter` => `home_001_ctrl`
  (structures bundle) plays the `curtain` clip (1.4583 s, bones `Curtain_*_Bn` under `House_Bn`) while the tikiman is set to the saved pose and plays
  `TitleScreenEnter` (state 14, `tikiman_title_enter`, 4.5 s one-shot) -> `TitleScreenIdle` (state 12, `tikiman_title_idle_02` loop; `RandomHop` bool -> state 13 `tikiman_title_idle`).
  Later shows (`+0xb3 == 1`): player trigger `TitleScreenEnterV2` (Idle -> TitleScreenIdle, 0.5 s blend), no hut animation. `TitleScreenExit` (Play) -> Idle.
  The coroutine waits until the animator's STATE TAG hash == `TitleIdle` (states 11-14 all carry it), then restores the saved pose one frame later.
* Saved pose: `m_tikimanLocator` is UNASSIGNED in the shipped title scene (no level3 MonoBehaviour references the locator Transform), so the code's fallback
  `Vector3(0.715, 0, 1.9)` (consts @0xB7CFD0 / @0xB7CFD4) + identity rotation is used (replaces the old "1 m in front" stand-in; HubModel.TITLE_TIKIMAN_SPOT).
* The hut is a SkinnedMeshRenderer (`home_001_comp_LOD0`) that the stage extractor skipped (it was invisible in the port): `tools/assets/extract_hub_hut.py`
  exports GLB + clip to `public/assets/stages/3d_stage_000/hut/`; `src/view/hub/HubHut.ts` plays it (linear keys; Unity slopes are not exported).
* Wiring: `titleFlow` emits `pjm2:titleIntro` with the title model's intro phase (jingle); `hubSession` starts hut + entrance then (held in the Wait pose before).
* NOT done / unknown: `RandomHop` has no setter in the decompile (idle_02 loops only); the hub's 10 `ChibiRoot/chibi_01` objects are `PrefabLoader` placeholders
  (prefab pid 848, external) with MiniDialog — the title/hub chibis are not spawned yet (the port has none in the hub); PlayerMotor root-motion in the entrance clip is not checked.
