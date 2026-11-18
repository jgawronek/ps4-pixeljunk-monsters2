# Stage sessions: in-page stage switching

`game.html` used to boot exactly ONE stage per page load (module-level singletons in `src/main/game.ts`), so
Stage Select -> stage, Results -> Next/Retry/Stage Select and Title -> Play needed a full navigation
(`game.html?stage=N&notitle&diff=D`). Now the whole loop runs in one page session:

    title -> stage select -> stageLoading (progress screen) -> intro -> playing -> results -> stage select / next / retry

## Structure

| file | role |
|---|---|
| `src/main/game.ts` (~330 lines) | PERSISTENT SHELL: renderer + canvas, shared `AudioManager`, `SaveData`, asset cache, `UiAssets` + string table, loading overlay, dev panels, rAF loop, flow glue (`stageLoading` is owned here), title/options/credits (`bootTitle`), stage select (`StageSelectFeature`), `window.__pjm2` proxy |
| `src/main/stageSession.ts` | PER-STAGE: `createStageSession(shellServices, {stage, difficulty}) -> Promise<StageSession>`; `session.start()`, `session.frame(now)`, `session.dispose()`. This is the old body of game.ts moved into a closure (every old module-level `let` is now a local) |
| `src/main/simReset.ts` | `resetSimGlobals()` + `simGlobalCounters()`: reset path for the sim's process-global state |
| `src/main/disposeThree.ts` | `disposeObject3D()` (geometry/material/textures incl. ShaderMaterial uniforms and splat layers) + `collectObject3Ds()` for loader template bundles |
| `src/main/listenerAudit.ts` | counts LIVE listeners on window/document/canvas (add minus remove) for the audit; never removes anything |
| `src/main/headless-stage1.ts` | now re-entrant: `runHeadlessStage(n, {quiet})` (CLI unchanged, pins unchanged) |
| `tests/main/multistage-sim.test.ts` | stage 1 twice / stage 3 after stage 1 in ONE process == fresh process hashes; reset leaves 0 listeners / 0 registry entries |
| `.work/probe-stage-switch.cjs` | browser disposal audit (see below) |

### Global (shell) vs per-session

Shell (page lifetime): `THREE.WebGLRenderer` (+ canvas, shadow-map settings, `?lite`), `AudioManager` (created on the
first gesture by the title or by START), `SaveData`, Cache-API `AssetCache`, `UiAssets` (UI sprite/font textures) and the
`StringTable`, `flow` (`src/main/flow.ts`), `TitleHost` (+ options/credits), `StageSelectFeature`, `#loading` overlay,
`#hud/#wave/#perf/#msg` dev panels, `preferences.ts`, the pack loader (`initPacks`).

Session (stage lifetime): `THREE.Scene`, `WaterPass` (render targets), `SkyAtmosphere` (PMREM), `StageAmbient`,
`StageCamera`, `StageSceneView`, `CharacterLibrary` (GLB templates), tree/pickup/projectile/tower/enemy/chibi/player
views, `ParticleSystem`s, `RangeIndicator`, Rapier `PhysicsWorld`, `SimDriver`/`GameCore` world, `GameUiFeature`
(HUD, wave calls, results/pause skin, build ring, currency flyers), `TowerLevelFeature`, `EnemyViewSystem`, `GameShell`
(pause/results overlays), `TouchControls`, `StageIntroController` + `IntroCardUi`, all stage key/pointer handlers, every
`Events.*` subscription made by these, the debug hook object.

Possible later optimisation (not done): share `CharacterLibrary`/`TreeView.load` templates and `WaterPass` between
sessions to shorten stage switches. Today everything is per-session for correctness; the Cache API makes repeat byte
fetches free, so a switch costs decode + GPU upload only.

## Lifecycle

```
boot():   createStageSession(initial stage from ?stage/?diff)   // loaded, NOT started = title backdrop
          StageSelectFeature (claims flow 'stageSelect'), bootTitle() unless ?notitle; START button otherwise
title Play -> flow 'stageSelect' -> pick -> flow.go('stageLoading', {stage, stageId, difficulty})
flow.onEnter('stageLoading')  (game.ts enterStageLoading):
    same stage+difficulty as the loaded, unstarted session? -> reuse (synchronous; ?notitle START click path)
    else  showLoading(); disposeSession(); createStageSession(...) (progress -> #loading-bar)
    then  session.start(); flow.complete('stageLoading')  -> intro (StageIntroController.bindFlow) -> playing
sim outcome  -> sh.outcome() -> flow.go('results')   (GameUiFeature draws the result screen)
results exits (GameUiFeature screens / pause-menu Restart) -> sh.exit(kind):
    'stageSelect' -> flow.go('stageSelect')  (shell disposes the played session on enter)
    'next'        -> flow.go('stageLoading', {stage: nextStage})
    'retry'       -> flow.go('stageLoading', {same stage})      (new session; no page reload)
```
`flow.ts` edges: `playing -> stageLoading` was added for the pause-menu Restart. `history.replaceState` keeps
`?stage=N&diff=D` current (other flags untouched). `?stage=N`, `?notitle`, `?nointro`, `?nograde`, `?noui`, `?nopacks`,
`?eagertowers`, `?diff=`, `?lite` keep their meaning (read inside the session / shell as before).

A newer stage request supersedes an in-flight build (`buildToken`); the superseded session is disposed as soon as it
resolves.

## `window.__pjm2`

A `Proxy`: `__pjm2.<hook>` resolves to the CURRENT session's `debug` object (all the old probe hooks: `state`, `introState`,
`buildNearestTree`, `skipToWave`, `treeInfo`, `perfHistogram` ... unchanged), then to shell hooks:
`flow`, `session()`, `switchStage(n, diff) -> Promise<boolean>` (goes through the flow; resolves when the new stage started),
`exit('stageSelect'|'next'|'retry')`, `audit()`. Between stages `state()` returns a minimal shell record
(`started:false`). `__pjm2Flow` / `__pjm2Title` are as before.

## Disposal checklist (`StageSession.dispose()`, each step isolated by `safe()`)

1. `AbortController.abort()` - window keydown/keyup (capture + normal) and canvas pointerdown added by the session.
2. `StageIntroController.dispose()` (+ its window listeners + flow `onEnter('intro')` unsubscription, new) and the intro card root.
3. `TouchControls.detach()`, `GameShell.detach()` (overlays + window keydown).
4. `GameUiFeature.dispose()` (new: `UiRoot.detach()` of HUD/calls/screens roots incl. resize listeners), `sessionUi` container
   (one div under body holding the HUD, tower ring, intro card; `dispose` = `remove()`).
5. `EnemyViewSystem.dispose()` (health-bar canvas + its Events listeners), `StageCamera.detach()`.
6. Audio: `stopBgm()`, `stopAllLoops()` (new `AudioManager.loopCount` tracks live `startLoop` handles).
7. Per-instance views: enemy/tower views (+ outline/toon handles), `PickupDropManager.dispose()` (Events), `ProjectileViewerSystem.dispose()`,
   `ChibiStageView`, `PlayerStageView`, `TreeView`, `PickupView`, `RangeIndicator`, both `ParticleSystem`s.
8. `StageSceneView.dispose()`, `WaterPass.dispose()` (render targets), `SkyAtmosphere.dispose()` (PMREM), `StageAmbient.dispose()`.
9. Catch-all: `disposeObject3D(scene)` then `scene.clear()`; loader template bundles (trees/pickups/projectile models) via
   `collectObject3Ds()`; `CharacterLibrary.dispose()`.
10. Rapier `world.free()`; `setEnemyGroundProbe(null)`; `resetSimGlobals()`.

`resetSimGlobals()` (also run at the START of `createStageSession` and by `runHeadlessStage`):
`resetAllEventsForTests()` (every `Events.*` listener + replay sets), `GameCoreHandle.resetStaticsForTests()`,
`CoreObjectPool.resetInstanceForTests()`, `resetUnityObjectRegistryForTests()`, tick delta, **`unityRandom.InitState(0)`**
(the home's chibi layout draws from the global RNG at construction, before the first tick re-seeds it: without this the 2nd
stage in a process had a different chibi arc and hash - found by the re-entrancy test), and nulls the provider hooks
(instance, viewer resolver, bounds, sim physics, stage/prefs/tower DB, enemy/tower/projectile viewer factories).

Rule for new code: anything a session creates must be freed in `dispose()`. New `Events.*` subscriptions are covered by
`resetSimGlobals()`; new window/document/canvas listeners must use the session `AbortController` signal or a `detach()`
(the audit's `listeners.window/document/canvas` counts catch regressions); new DOM must go under `sessionUi`; new GPU
objects must be reachable from `scene` or be disposed explicitly.

## Disposal audit (`__pjm2.audit()` + `.work/probe-stage-switch.cjs`)

`audit()` returns `{ flow, stage, memory:{geometries,textures} (renderer.info.memory), programs, sim:{eventListeners,unityObjects},
audioLoops, audioBgm, bodyChildren, canvases, listeners:{window,document,canvas}, session:{particlesAlive,enemyViews,towerViews,overlays} }`.
The probe (one browser, 640x360, software GL, hard timeout) loads stage 1, STARTs, switches to stage 3 through the flow,
then leaves to stage select, and asserts 0 page errors, ticks advancing in both stages and the counters back at zero.
Numbers are recorded in the section below.

### Last recorded run (software GL, 640x360, `?lite&nointro&noui&texaudit`, no-watch vite)

`probe-stage-switch.cjs` (stage 1 -> in-page switch to stage 3 -> stage select), 0 page errors, ticks advanced (8+) in both stages:

| counter | stage 1 running | stage 3 running | stage select (no session) |
|---|---|---|---|
| `renderer.info.memory.geometries` | 31 | 30 | 2 (renderer-internal background quads) |
| `renderer.info.memory.textures` | 90 | 84 | 2 (renderer-internal empty cube textures) |
| Events listeners / unity objects | 46 / 457 | 46 / 458 | 0 / 0 |
| live `window` listeners | 24 | 24 | 16 (shell: stage select, resize, title) |
| audio loops / BGM | 0 / bgm_stage_easy | 0 / bgm_stage_hard | 0 / none |
| body children | 13 | 13 | 10 |

`probe-title-flow.cjs`: title -> Play (flow) -> stage select -> Enter picks -> stageLoading -> intro -> playing -> `exit('retry')`
-> playing -> `exit('stageSelect')`; flow history `boot,title,stageSelect,stageLoading,intro,playing,stageLoading,intro,playing,stageSelect`;
document never replaced; the retried stage-1 session has the same geometries (+1), textures (-5), listeners, window listeners and body
children as the first (the +/- are live enemy views/textures still streaming at the sampling instant).

Bugs the audit found and this change fixed: (1) `StageSceneView` kept streaming/uploading textures AFTER `dispose()` (96 textures stayed
resident; now `disposed` flag + `TextureUploadQueue.cancel()`); (2) every `SkinnedMesh` skeleton keeps a float bone `DataTexture` that
geometry/material disposal does not free (40 left; now `freeSkeletons()`, also when an enemy/tower view dies at runtime);
(3) `CharacterLibrary.dispose()` did not free GLB textures; (4) `UiRoot.attach` leaked a window `resize` listener (new `UiRoot.detach()`);
(5) `StageIntroController.bindFlow` never unsubscribed its `flow.onEnter('intro')`; (6) stale `unityRandom` state changed the chibi layout
of the 2nd stage in a process (`resetSimGlobals` now `InitState(0)`).

## Where the old game.ts code went (for agents with pending edits)

Every former top-level section of `src/main/game.ts` is now inside `createStageSession()` in `src/main/stageSession.ts`
**in the same relative order** (scene/WaterPass/sky/camera setup; state vars; registries; `towerEffects`; `syncViews`;
input + `tickPlayerMovement`; audio/particles/outcome wiring; `updateHud`; `frame`; `startIntroOrSkip`; `start()` (the former START
click handler); `debug` (= the `window.__pjm2` object); `boot()` (stage loading + sim bootstrap)). Module-level pieces kept at
module level: `tower001Contract`, `treeViewer`, `worldTransform`, `CHARACTER_DEFS`, `SFX_NAMES`.
Config-driven environment edits (`STAGE_ENV`) belong in `stageSession.ts` (near the top of `createStageSession`). A backup of the last
single-file game.ts is `.work/game.ts.bak-final`.
What stayed in `game.ts`: renderer creation, DOM refs, `flash`, loading overlay, the legacy START button handler, title/stage-select boot,
the rAF loop, resize, `__pjm2`.
Removed: `bindLegacyStart` is no longer called (the shell START handler does `flow.go('stageLoading')`); `titleBoot`'s `stageLoading`
handler only toggles the title chrome (game.ts owns the state); `TitleBootCtx.startStage/isStarted` are optional/unused.
