# Enemy animation ("arm in the air") and enemy health display

Evidence: decompiled IL2CPP (`decomp/decompiled/Q4.EnemyBase.c`, `Q4.NewHealthBar.c`, `Q4.UI.HealthBarSetting.c`),
raw x86-64 of `Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000) for every numeric constant, and the
serialized `enemies` / `globalsettings` AssetBundles (UnityPy). Re-run extractor:
`/srv/opencode/venv-unity/bin/python -I tools/assets/extract_enemy_view_data.py` -> `src/view/characters/enemyViewData.generated.ts`.

## 1. Bug 1 - raised arm: root cause

Wave 1 of stage 1 (`decomp/data/stage_waves_resolved.json`, wave 0) is 17x `kuri_00_001` on three ground paths.
`EnemyStageView.update()` chose the clip with `enemyMoveType === 1 ? 'fly' : 'walk'`, but
`EEnemyMoveTypeDef` is `unknown 0, ground 1, air 2` (`decomp/src/GameData/GameDataEnums.cs`,
`src/core/enums.ts`; kuri_00_001 serializes `enemyMoveType = 1`). So every GROUND enemy played `kuri_fly`,
whose pose has one arm thrust straight up (screenshot `.work/en-fly.png`, left figure). The existing unit test
encoded the same inversion (`enemyMoveType: 1, // air`).

The original never picks clips by name: the prefab's `Animator` runs a serialized controller
(`kuri_ctrl`) driven by parameters from `Q4.EnemyBase`. The fly clip belongs to controller state `Balloon`
(reached only through the `Balloon` trigger, i.e. balloon enemies).

## 2. How the original drives enemy animation (ported)

`Q4.EnemyBase.InitAnimation @007fa210` caches parameter hashes: Run, Attack, TakeDamageWeak, TakeDamageStrong,
TakeAttackDamage, MoveSpeedScale, WalkCycleOffset, Die, DeathType, DeathImpact, Balloon, BalloonFall,
BalloonFallLand, WalkVariation, Drown (+ state tags DrownDead, Dead).

kuri_ctrl (layer 0; layer 1 has defaultWeight 0): default state **Idle**; Idle -(MoveSpeedScale>0, 0.1s)-> Walk;
Walk -(MoveSpeedScale<0.001, exit 0.84)-> Idle; Any-State transitions: Attack, Die, TakeDamageStrong,
TakeDamageWeak, TakeAttackDamage(hip), Balloon, Drown. Die -> selector: `DeathType==2` -> DieStrong else DieNormal;
`DeathImpact` trigger -> *Impact states. `WalkVariation` trigger -> selector on `RandomInt` -> walk_01/walk_02 -> Walk.
`QGames.RandomIntBehaviour` (m_RandomParam `RandomInt`, Min 0, Max 2) re-rolls RandomInt on entering that selector
(its code is not in the decompile; behaviour taken from the serialized fields - UNVERIFIED in code).

Parameter driving (all in `src/view/characters/EnemyBaseView.ts`):

| Original | Address | Port |
|---|---|---|
| `StateMove` position, turn `RotateTowards(LookRotation(delta, y=0), clamp(speedCur/1.75, 0.5, 1) * 75 deg/s * dt)` when `|delta|^2 >= 1e-6` | `@007fc140` (consts raw: 1.75, 0.5, 1.0, 75.0, 1e-6) | `stateMove` |
| `MoveSpeedScale = enableAnimMoveSpeedScaling ? |delta|/dt / animMoveSpeed : (vel > 0.001 ? 1 : 0)` (dt > 0.001) | same | `stateMove` |
| random `WalkVariation` trigger every `Range(randomWalkAnimIntervalMin, Max)` s (kuri 2..8) + walk sound | `Update @007fb8e0` | `randomWalk` |
| `OnEnemyHit`: strongReaction ? TakeDamageStrong : TakeDamageWeak; no damage source -> TakeAttackDamage | `@007fe710` | `onHit` |
| `OnEnemyAttack` -> Attack trigger; `OnEnemyDrown` -> Drown trigger | `@007ffdc0`, `@007ff010` | `onAttack/onDrown` |
| `StateDeadInit`: Die trigger, `DeathType = strongToDamage + 1`, reset damage triggers, corpse velocity `dirXZ * Range(0.8,1.2) * (Strong/Weak)DeathSpeedH`, `Range(0.8,1.2) * (Strong/Weak)DeathSpeedV` (x bomb attenuation when a splash source exists) | `@007ff1c0` | `onDestroyed` |
| `StateDead`: gravity 20 (ctor `+0x378 = 0x41a00000`), `pos += vel*dt`; when vel.y<0 raycast pos+up down (max 1.25, hit<=0.99): `vel.y = -vel.y*StrongDeathBounce`, xz *= `1 - StrongDeathFriction`, **DeathImpact trigger**; rotate toward push direction at 180 deg/s; destroyed after `DestroyDelay` (kuri 2.35 s) | `@007fce90` (consts 0.99, 180.0) | `stateDead` |

The Animator state machine is `EnemyAnimatorLogic.ts` (Any-State, selector nodes, exit times, triggers, fixed/relative
blend durations) - the same semantics as the tower `AnimatorRuntime`, extended. The view plays the clip of each state
(`EnemyStageView.attachAnimator`, crossfade = transition duration).

Formerly "not ported" - NOW PORTED, see `docs/ENEMY_BOSS_VIEW_ANALYSIS.md`: hit-shock spring `UpdateHitShock @007fbe30`, frozen-anim stepping
(`UpdateFrozen`), boss attack / jump / sink / Fat fall states, blend trees (1D, nested, real weights), the giants' additive layer 1,
balloon rig + pop / fall / land sequence (`PopBalloons`), `StateDrown`, fire / ice / die / dust effects, clip AnimationEvents, enemy attack choreography.
Still approximated: the giants' QGames.CrumbleAnimator debris.

## 3. Bug 2 - enemy health display (`Q4.NewHealthBar`)

A Unity UI `Graphic` (prefab in `globalsettings`, path id -4426263646834160718) that draws sprite quads over every
enemy that has recently been hit. It is the only enemy health display (`Q4.HPGauge` is a timer for another gauge).

* Visibility: nothing is shown until the first hit. `Awake @003d7190` listens to `enemyHitEvent` and
  `enemyDestroyedEvent`; `OnEnemyHit @003d8830` calls `ShowHealthBar` only when `hitInfo.damage > 0`;
  `OnEnemyDestroyed @003d8b70` always calls it.
* `ShowHealthBar @003d8870`: per-enemy `HealthBarData` {enemy, viewer, headBone (`Mask_Bn`/`mask_bn`, else viewer),
  barSize, damageHealth, degenStartTime, showAlpha, criticalDelay, flicker, isHiding}. If `degenStartTime <= now`
  `damageHealth = damage` else `+= damage`; `degenStartTime = now + degenDisplayDelay(0.5) + (1-showAlpha)*showDuration`;
  flicker = `degenFlickerCount (6)`.
* `LateUpdate @003d7c30`: alpha fades in at `dt / max(showDuration,0.01)` (prefab showDuration 0 -> instant), hides when the viewer is
  destroyed or the enemy is dead and `degenStart + 0.25 + deadEnemyHideDelayAfterDegen(1.0) < now`; fades out over
  hideDuration 0.25 using the hide curve; flicker decays `degenFlickerCountPerSecond (10)/s`.
* `OnPopulateMesh @003d8020`: for each bar, scale = curve(showAlpha) * spriteScale(0.72). Draw order: background
  (`gauge_enemy_bar_bg`) stretched over the `barDimensions` rect of the chosen cover, red damage trail (`gauge_enemy_bar_red`,
  width `(lerp(damageHealth,0,t)+life)/maxLife`, t = (now-degenStart)/0.25, tinted white<->(1,1,1,0.5) by `sin(2pi*flicker)*.5+.5`), HP fill
  (`gauge_enemy_bar`, width `life/maxLife`), then the cover frame sprite (`gauge_enemy_01/02/03/boss`) at the head position.
  Bar rects (canvas px, y up): cover 0 (-40,-20,80,17), 1 (-60,-20,120,17), 2 (-80,-20,160,17), boss (-100,-20,230,17).
* Position: head bone world position -> canvas (1920x1080 ScaleWithScreenSize, match 0) + `EnemyBase.BehindLifeGaugeOffset`
  (kuri (0,80); TopDownLifeGaugeOffset (0,50) is used by the top-down camera). The original
  `CanvasToCameraPositionConvert.ConvertWorldSpacePositionToCanvasLocation @00476810` (edge clamp/smoothing) is simplified to a plain projection.
* Cover choice `GetBarSizeForEnemy @003d8bc0`: boss -> 3; else the first `HealthBarSetting` whose `MinThreshold` is above all
  earlier minima and below `maxLife`. Raw disassembly shows all three threshold reads call `get_MinThreshold @0048da20`
  (MaxThreshold is never read), so the data's third range (cover 2) is unreachable: every non-boss with maxLife > first-nonzero
  min gets cover 1 (kuri 300 -> cover 1; maxLife <= 150 -> cover 0). Ported verbatim.
* No damage numbers, no hit flash and no separate boss HP UI exist in `NewHealthBar`; the boss uses cover 3 of the same bar.
  (Hit reaction is the TakeDamage* animations above; critical icon / enemy tracker are separate UI, not ported here.)

Port: `EnemyHealthBar.ts` (pure logic, unit-tested), `EnemyHealthBarOverlay.ts` (canvas-2D over the game canvas, sprites from
`public/assets/ui/sprites/gauge_enemy_*.png`), `enemyViewSystem.ts` (event routing), wired in `src/main/game.ts`.

## 4. Verification

* `tests/view/enemyAnimatorAndHealth.test.ts` (controller semantics, bar size quirk, bar lifecycle); `npm run check`.
* Screenshots: `.work/en-fly.png` (before: kuri_fly arm up), `.work/en-ctl.png` (after: controller-driven Walk),
  `.work/enemy-game-after-*.png` (full game).
* Sim determinism untouched (view-only): `npm run sim:stage1`.

## 5. Unverified / approximations

RandomIntBehaviour semantics; behind-vs-top-down life-gauge offset selection (camera type); hit-shock; canvas edge clamp;
corpse ground probe uses the terrain pick meshes (fallback: spawn height).
