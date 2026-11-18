# Enemy + boss view fidelity (Q4.EnemyBase view states, boss controllers, buff / hit / death / balloon visuals)

Follow-up of `docs/ENEMY_ANIMATION_AND_HEALTH_ANALYSIS.md` ("Not ported" list) and `docs/STAGE_GAMEPLAY_AUDIT.md` section 6/7.
Everything below is read from the decompiled `Q4.EnemyBase` (`decomp/decompiled/Q4.EnemyBase.c`, il2cpp RVAs in brackets),
the raw x86-64 of `Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000; disassembled with capstone because Ghidra
dropped the `SetFloat` value argument in `BossUpdate` and the struct offsets of the hit info), and the serialized
`enemies` AssetBundle (UnityPy). Nothing is tuned by eye except where a section says APPROXIMATION.

Re-run the extractors (from `pjm2-web/`):

```
/srv/opencode/venv-unity/bin/python -I tools/assets/extract_enemy_view_data.py          # -> src/view/characters/enemyViewData.generated.ts
/srv/opencode/venv-unity/bin/python -I tools/assets/extract_particles.py --bundles enemies --out public/assets/particles-enemy
PJM2_MANIFEST_OUT=.work/char-manifest-out.json /srv/opencode/venv-unity/bin/python -I tools/assets/extract_balloons.py
node .work/repack-char-textures.mjs                                                       # webp variants of the new balloon textures
```

## 1. Who appears where (stage_waves_resolved.json, regular waves; `bossMinions` = boss minion groups)

| area / stage (resolved index) | boss (controller) | other enemy families | air | balloon rigs | fire-spawn (`_06_`) |
|---|---|---|---|---|---|
| area_001 stage_001 (12) | boss_bero_00 (boss_bero_ctrl) | kuri_00, spider_00, giant_00, kurukuru_00 | kurukuru | - | - |
| area_001 stage_002 / 003 (3 / 15) | boss_bero_01 / 02 | + kuri minions | kurukuru | - | - |
| area_002 stages (0, 13, 11) | boss_kao_00 / 01 / 02 (boss_kao_ctrl) | spider, giant, bat, kurukuru | bat, kurukuru | - | - |
| area_003 (6) | boss_kao_03 | kuri_03.., giant_01/03/05, spider_01/03/05 | bat | yes (5) | - |
| area_004 / 003 (1, 7, 4, 14) | boss_ude_00 / 03 / 04 / 01 (boss_ude_ctrl) | bee, cisors_00, giant_02/04 | bat, bee | 1, 1, 0, 6 | idx 4: 2 |
| area_005 (5, 8, 10) | boss_fat_02 / 00 / 01 (boss_fat_ctrl) | everything incl. kuri_01..05, cisors_01..05 | all | 5 / 8 / 7 | 3 / 0 / 1 |
| (9) | boss_ude_02 | spider_06, giant_06, kuri_06, cisors_06 only | none | - | 4 (all fire-spawn) |

Priority used: (1) wave-1 enemies (kuri, kurukuru, spider, giant - states Idle/Walk/Hit/Attack/Die/Drown), (2) common effects on them (fire, ice,
shock, death poof, attack jump), (3) balloon enemies (7 of 15 stages), (4) the four boss controllers.

**Finding (loader):** `CHARACTER_DEFS` in `stageSession.ts` only preloads kuri_00 / spider_00 / giant_00 / kurukuru_00 / boss_bero_00. Every other
enemy GLB (bat, bee, cisors, kuri_01.., kao / fat / ude, balloon variants) was missing from the library, so `createEnemyViewerFactory`
returned null = an invisible enemy. `src/view/characters/stageEnemyDefs.ts` now derives the stage's enemy + balloon-rig names from the
`WaveResourceContract` and `stageSession` loads the missing ones before the sim starts (4-line Edit after `loadWaveResource`).

## 2. Controllers (extracted: `enemyViewData.generated.ts`)

| controller | states beyond the kuri family | parameters |
|---|---|---|
| boss_fat_ctrl | Idle / Move / SpawnMinion / TakeDamage are **1D blend trees**; Attack, Die, Dead (speed 0, cycleOffset .99), FallToGround (`boss_land`) | BossGrounded (0 flying .. 1 walking), BossInjured (one-wing), BossWalkSpeed, BossDamageWeight, SpawnMinion, FastSlowTransition triggers |
| boss_ude_ctrl | Loco = nested trees `BossWalkSpeed` x `BossDamageWeight` (slow_walk / crawl / walk), SpawnMinion, FastSlowTransition (= `boss_damage`), Attack, Die, Dead | same |
| boss_kao_ctrl | boss_walk / boss_fly (`BossGrounded` 0.5 hysteresis), TakeDamageStrong, Attack, Die + Dead (**no motion**) | BossGrounded |
| boss_bero_ctrl | Idle / Attack / Loco / Die / Dead have **no motion** (the boss is a rigid statue; Balloon/Land reuse giant clips) | - |
| giant_controller | layer 0 as kuri; **layer 1 = additive** (blendMode 1, full body mask, weight 1): Empty -> TakeDamageStrong (`giant_damage`, exit .7); DieCrumble / AttackCrumble have no motion (QGames.CrumbleBehaviour) | CrumbleDirX/Y/Z, CrumbleStrong |
| balloon_*_ctrl | Balloons3 -(PopBalloon)-> 3to2 -> 2balloon -(PopBalloon)-> 2to1 -> 1balloon | PopBalloon |

Evaluator (`EnemyAnimatorLogic.ts`, rewritten): blend trees with Unity semantics (children sorted, clamped to the first/last threshold, linear
weight between neighbours, nested weights multiply, one shared normalized time, state length = weight-averaged clip length), several layers
(additive layer 1 of the giants; synced copies with weight 0 are skipped), cross-fades (`poses()`: weight_i = alpha_i * prod(1-alpha_j)), Animator.speed,
state cycle offset, motionless states (length 1 s, previous slot keeps no pose -> three.js blends to the bind pose = Write Defaults).
`controllerPlayer.ts` applies `poses()` to a three.js mixer by scrubbing action times (timeScale 0) and setting weights; additive layers use
`makeClipAdditive(clip, 0)` (reference pose = first frame - UNVERIFIED which frame the Unity import used) and fires the clip AnimationEvents.

**AnimationEvents (new finding).** The clips carry events: `TriggerEffect(label)` -> `Q4.ParticleGroupEventHandler.TriggerEffect` (Die at the end of every
*_impact clip, Land, ArmLeft/Right, FootLeft/FootRight on boss steps, Attack, Damage), `Die` / `FootPlant` / `WingFlap` -> `Q4.AudioEventHandler` (sounds, not
ported). They are in `ENEMY_VIEW_DATA.clipEvents` and fire when a clip with weight >= 0.3 passes the event time. The death poof of every normal enemy
comes from `*_impact` events, not from `StateDeadInit`.

## 3. What the original does (EnemyBase) and what is ported (`EnemyBaseView.ts`)

| behaviour | original | port |
|---|---|---|
| Update order | `Update @007fb8e0`: UpdateFrozen, UpdateHitShock, mode switch (Move/Attack/Dead/Drown = 0/1/2/3), balloon `GroundOffsetY <= 0` -> `BalloonFallLand`, BossUpdate | `update()` same order, then `animator.update(dt)` |
| hit shock `UpdateHitShock @007fbe30` | active flag +0x370, height +0x374, speed +0x37c. **Air** (core.enemyMoveType == 2): `v -= h*spring*dt; v *= 1 - clamp01(damping*dt); h += v*dt`, stop when `abs(h) < 0.05 && abs(v) < 0.05` (consts 1.0, 0.05 @b92980/84). **Ground**: `v -= dt*20; h += v*dt; if h < 0 -> 0` (+ boss: FootLeft dust unless Tall / recently damaged). Position = `core.position + up*h` in StateMove and StateBossAttack | `updateHitShock`, `stateMove` |
| impulse `OnEnemyHit @007fe710` (raw @7fea40..7feae2) | `v = Sample(shockCurveInfos, hit.distanceToCenterRate) * maxShockSpeed * (hit.strongToDamage ? additionShockRate : 1.0) * shockScale * hit.reactionRate` (hit struct +0x14 strongToDamage, +0x18 distance rate, +0x1c reactionRate, +0x20 strongReaction) only when no shock is active; hip hits (no source) only set `TakeAttackDamage`; bosses (type 1..4) play the `Damage` effect and set wasDamaged; strong reaction -> `BossTakeStrongDamage` | `onHit`. Data: kuri 2.5 / 3.5, kurukuru 4 / 2.25 with **shockScale -1** (hits push air units DOWN), spider 5 / 1.7, bosses 2 / 1 with an empty curve (=1.0) |
| `OnJumpReaction @007fe4e0`, `OnBossJump @007fe5e0` | shock speed `m_TrampolineSpeed * weight` (15) / `m_bossJumpUpSpeed` (5-6); weak/strong trigger at weight 0.5 | `onJumpReaction`, `onBossJump` (events `jumpReactionEvent`, `bossJumpEvent`) |
| frozen stepping `UpdateFrozen @007fbd30` | if `m_freezeAnimEnable && iceEffect != null`: `timer -= dt; if timer > 0: Animator.speed = freezeAnimSpeed (0.1) else timer = interval (0.2); speed = interval * 60 (b92978)`; else speed 1 | `updateFrozen` -> `EnemyAnimator.speed` (scales state time and clip scrubbing) |
| `BossInit @007fb740` | BossWalkSpeed 1, BossGrounded 1, BossInjured 0, reset SpawnMinion | `initAnimation` |
| `BossUpdate @007fdde0` (raw @7fdde0..7fe182) | strong-damage ramp: progress p; while `p <= 1`: `p += dt/DownDur`, weight = p; then `p += dt/UpDur`, weight = `1 - clamp01(p-1)`, done at 0 -> `BossDamageWeight`; `IsSlowMode` -> FastSlowTransition trigger + `BossWalkSpeed = 0` (Fat: wing sound); `BossGrounded = groundOffsetY > 0.001 ? 0 : 1` (+ landing sound); `IsDamagedMode && !slow` -> `BossInjured = 1` | `bossUpdate` (sim fields `isSlowMode / isDamagedMode / groundOffsetY` passed from stageSession) |
| `OnSpawnGroupStarted @007feed0` | **every** boss gets the `SpawnMinion` trigger when a minion group starts (event carries no enemy) | `onSpawnGroupStarted` (spawnGroupStartedEvent) |
| `OnBossAttackEffectEvent @00800530` | `Attack` effect + smoke sound on **every** enemy view (event has no payload) | `onBossAttackEffect` for all views |
| `OnEnemyAttack @007ffdc0` | non-boss: mode Attack, destination = chibi, or home edge `home + dir*EnemyAttackDistance` when the chibi is farther. **Jump** (AttackType 1: kuri, spider, bat, bee, kurukuru): lerp start->dst over 0.5 s with `sin(frac*pi) * 1.0` arc, `Attack` trigger, rotate toward dst at 1080 deg/s, chibi-kill beat + `Attack` effect at 0.5 s, destroyed at `AttackDestroySelfDur`. **Ground** (AttackType 0: cisors, giants): `Attack` in place, beat at 1.2 s, destroyed at `AttackDestroySelfDur`. **Boss**: MoveSpeedScale 0, `Attack` trigger, keeps following the core (never leaves the mode) | `onAttack` / `stateAttack`. **Fixes a leak**: before, an attacking enemy's view stayed in `move` forever (never `expired`) |
| `StateDeadInit @007ff1c0` / `StateDead @007fce90` | normal: ballistic corpse (existing port). **Boss** (`m_bossType != 0`): no launch; Kao/Bero trigger `Die`; saved pos/rot. StateDead: Bero/Tall/Kao **sink** `m_bossSinkSpeed` u/s with `insideUnitSphere * m_bossSinkShake`, `Sink` effect detached at the death spot, destroy after DestroyDelay (10 s). **Fat** boss falls (gravity 20) until the terrain ray (pos+1, 1 u) hits, rewrites its type to 1 and sinks. **IsCrumbleDeath** (giants): crumble params + `Die` effect | `onDestroyed` / `stateDead`; crumble = **APPROXIMATION** (below) |
| `StateDrown @007fd770` | only balloon-landed enemies: `m_vel` (= last per-frame displacement) `+= Physics.gravity(-9.81 verified in globalgamemanagers)*dt`, ray (pos+3, down 5, WaterMask): in water when `hit.distance < 3 - DrownDepth` -> vel 0, `floatY = surface - DrownDepth`, WaterSplash + Drowning effects; then `vel.y += 0.5*g*dt; vel.y += g*-1.35*clamp01((floatY - y)/0.3)*dt` (buoyancy, never damped); destroyed when the Animator state tag is `DrownDead` | `stateDrown`; water height from `getSimPhysics().raycast(..., waterMask)` (fallback: start height) |
| buffs `OnBuffStart @007fb400` / `OnBuffEnd @007fb590` / `EnableFire @007faeb0` / `EnableIce @007fb2f0` | `TriggerEffect("Fire" / "Ice")` on the `ParticleGroupEvent`; each cancels the other; `OnFireExtinguished` (sim `isOnFire` true->false, drown) | `onBuffStart/End`, `enemyViewSystem` routes `addBuffEvent` (BuffSettingBurn -> fire, BuffSettingFreeze / Slow -> ice), `removeBuffEvent` (BuffBurn / BuffFreeze / BuffSlow), `onFireExtinguished`. **Note:** the decompile names the tested types FastPlayer / Slow / Freeze (TypeInfo slots look shifted by one); behaviour taken from the buff semantics (burn = fire, freeze/slow = ice). spawnMode 1 (fire-spawn) calls `EnableFire` in `InitAnimation` |
| `InitAnimation @007fa210` | `WalkCycleOffset = Range(0,10) * 0.1` (b92970 = 0.1), spawnMode 2 -> `Balloon` trigger | `initAnimation` (no shipped state reads `WalkCycleOffset`; the state cycle-offset parameter ids are all 0) |
| balloon rig `Q4.Balloon` + `LateUpdate @007fe1a0` + `PopBalloons @007ffa70` | rig = `Balloon` child prefab (3 balloons, `BalloonAttachBone` Knot_Bn / Sucker_Bn glued to the enemy's `Balloon_Be`); pop: balloon + twine bone scale 0 (last index first), `popBalloonEffect` (`ef_tower_air_hit_balloon_pv`), `PopBalloon` trigger, destroyed when empty; when none remain `BalloonFall`, then `BalloonFallLand` at `GroundOffsetY <= 0`; `OnEnemyDestroyed` pops all | `enemyBalloonRig.ts` + `onPopBalloons` (popBalloonsEvent); rigs extracted by `tools/assets/extract_balloons.py` (balloon_kuri/giant/spider/cisors, 1310 verts, 5 clips) |

Constant table (all read from raw bytes): turn 75 deg/s @b92994, /1.75 @b92988, clamp .5..1 @b9298c/90, move eps 1e-6 @b92998, anim dt min .001 @b9299c; shock
eps 0.05 @b92984, 1.0 @b92980; frozen x60 @b92978; death random .8/1.2 @b929f8/fc, corpse turn 180 @b929c4, ground ray lift 1.0 / max 1.25 / hit <= .99 @b929b8/bc/c0;
jump attack `180 * 0.0174532925` @b929a0/a4 (sin(frac*pi)), 0.5 / 1.0 / 1.2 / 0.8 literals in OnEnemyAttack; attack turn 1080 @b929ac; drown 3.0 / 5.0 / .5 / .3 / -1.35 @b929d4/d8/c8/cc/d0;
boss grounded eps .001 / .5 @b929e4/e8; jump-reaction strong weight .5 @b929ec; weak shock rate 1.0 @b929f0.

## 4. Enemy effects (ParticleGroupEvent)

`Q4.ParticleGroupEvent.TriggerEffect(label) @003de150` instantiates the prefab mapped to `label` at the named bone position **and rotation**, parented to the
bone (follows it); looping systems run until `FreeParticleGroup`, `DetachTransform` frees the sink dust. Labels: Die, Attack, Fire, Ice, Damage, FootLeft/Right,
Sink, ArmLeft/Right, Land, WaterSplash, Drowning (data: `ENEMY_VIEW_DATA.enemies[x].fx` + `effects`; 60 effect prefabs, 106 ParticleSystems).
`enemyParticles.ts` is a dedicated point-sprite pool (the shared `ParticleSystem` is RGB-only/fade-to-black and would render the 0.06-alpha ice cloud as opaque blobs): it
uses startColor.a, the colour+alpha gradient over lifetime, size over lifetime, the material blend (`Particles/Additive*` -> additive, `Alpha Blended` -> normal; recorded by the
extractor as `render.shader` / `tint`), the sprite hue (`texture.avg`) and the emitter shape. NEAR fidelity: soft dots instead of the sprite sheets / rings / rock meshes
(`Standard` shader emitters), world-space simulation assumed.

## 5. Approximations / unverified

* **Giants' crumble** (`IsCrumbleDeath`, `AttackCrumble` / `DieCrumble` states, `QGames.CrumbleBehaviour` + `CrumbleAnimator`/`DebrisPart` rigid-body debris from
  `CrumbleBehaviourDefinition`): the QGames.* code is not in the decompile. Port: the `Die` effect plays, the body (bind pose, as Unity Write Defaults would show for a
  motionless state) shrinks away in 0.35 s. Kao / Bero die states are also motionless; they sink in the bind pose.
* Additive-layer reference pose frame (assumed clip frame 0); which weight Unity needs before a blended clip fires its AnimationEvents (0.3 used).
* Fire/ice effect orientation: effects take the bone's world rotation like the original, hips rotation of the baked GLB is not verified against Unity.
* Water surface for StateDrown needs the sim physics world (stage with water layer); otherwise the start height is used.
* Particle sprite sheets, ring/wave textures, rock meshes, simulation space, sounds (FootPlant / WingFlap / Die / deathSound / PuffOfSmoke / BossLostWing ...) not ported.
* boss_kao_00..03 "face skin": the four extracted GLBs have identical topology (2963 vertices, 24 joints, 4 clips - `.work/asset-scale/boss_kao_0N/result.json`) and differ only in
  their own mesh/material/texture set (`boss_kao_0N_*`, `boss_kao_wing_0N_*`); the face is part of that skinned mesh driven by the boss_walk/fly/damage/attack clips - no
  Animator parameter, blendshape or second skin switches it (nothing found in boss_kao_ctrl / EnemyBase). `EnemyQuotePlayer` speech bubbles (`TriggerQuote`) not ported.
* `m_ScareAnimals`, critical icon, enemy tracker (separate UI) untouched.
* SkinnedMeshOutline: the permanent rim is the existing `ToonOutline` (NEAR); enemy shadows follow the stage lighting (not changed here).

## 6. Verification / evidence

* Unit tests: `tests/view/enemyBossView.test.ts` (blend-tree golden weights, cross-fade sums, Dead hold, additive giant layer, frozen speed sequence, shock numbers,
  jump-attack arc / timing, boss sink / Fat fall, drown, balloon trigger chain, balloon controller, stage enemy defs) + the existing `enemyAnimatorAndHealth.test.ts`.
* Single-character render probe with the real view classes: `.work/enemy-state-probe.html` + `.work/probe-enemy-state.cjs <prefix> "<query>" t1,t2,..`
  (query: `e=<def>&script=t:cmd[:arg],...&cam=z,h,fov`; cmds move hit hitS hip attack die dieS drown fire ice fireoff iceoff slow damaged ground minion bossfx jump pop trig param).
  Screenshots (`.work/enemy-probe/`): `kuri-fire3-1.4` / `kuri-ice3-1.4` (burn / freeze on the enemy; before: nothing), `kuri-die2-3.15` (death poof from the clip event),
  `kuri-atk-0.8` (jump attack arc), `ude-a-2.1` (boss damage dust + blend), `fat-a-5.0` (boss_land) / `fat-a-8.4` (death), `giant-a-1.3` (additive flinch), `giant-a-3.3` (crumble approximation),
  `bal-kuri-0.6` / `bal-kuri-1.7` (balloon rig, one popped). "Before" of the boss blend trees = the old `clipOf` pick (one clip, e.g. `boss_walk` at BossWalkSpeed 1 / DamageWeight 0 = same pose
  as the new mix at weight 1.0) - the old code could not show any intermediate mix, the slow/injured/crawl poses, the stepped frozen pose, shock offsets or any effect.
* `npm run sim:stage1` -> `0x61889fae2ea828f1` unchanged (view-only); `node .work/probe-visual.cjs` -> VISUAL-OK.

Files: `src/view/characters/{EnemyAnimatorLogic,EnemyBaseView,EnemyStageView,enemyViewSystem,enemyViewTypes,controllerPlayer,enemyEffects,enemyParticles,enemyBalloonRig,stageEnemyDefs}.ts`,
`tools/assets/{extract_enemy_view_data,extract_particles,extract_balloons}.py`, `public/assets/particles-enemy/`, `public/assets/characters/balloon_*`,
`src/main/stageSession.ts` (3 small edits: stage enemy GLBs, sim fields in `bindSimSource`, `scene` for the enemy particles).
