# Stage 2-15 gameplay audit (enemy types, mechanics, sim coverage)

Scope: for every stage, which enemies / bosses / mechanics its waves use, what the TS sim (`src/core`) and the view layer implement,
what was missing, what this audit ported, and what the headless bot now proves. Evidence: the per-stage bundles
(`public/assets/data/stage{N}-bundle.json` -> `stage_waves_resolved.json` Medium difficulty + `enemies_EnemyBase.json`), decompiled IL2CPP
(`decomp/decompiled`, Ghidra vaddrs; file offset = vaddr + 0x4000 in `Il2CppUserAssemblies.elf`), the `enemies`/`props` AssetBundles (UnityPy)
and rodata floats read straight from the ELF. Data table from `.work/audit.py`; headless results from `npm run sim:stage1 -- N` (`.work/run-all-stages.sh`, `.work/all-stages-3.txt`).

## 1. Per-stage composition (Medium; counts = enemies spawned over all waves)

| # | waves | coins/gems | enemies | air | balloon | fire-spawn | boss | composition |
|---|---|---|---|---|---|---|---|---|
| 1 | 10 | 450/0 | 127 | 14 (11%) | 0 | 0 | boss_bero_00 | boss_bero0x1, giant0x12, kuri0x64, kurukuru0x14, spider0x36 |
| 2 | 10 | 400/0 | 100 | 40 (40%) | 0 | 0 | boss_bero_01 | boss_bero_01x1, giant0x5, kuri0x40, kurukuru0x40, spider0x14 |
| 3 | 10 | 340/0 | 124 | 40 (32%) | 0 | 0 | boss_bero_02 | boss_bero_02x1, giant0x19, kuri0x14, kurukuru0x40, spider0x50 |
| 4 | 15 | 400/0 | 292 | 131 (44%) | 0 | 0 | boss_kao_00 | bat0x58, bat0_lessJointsx16, boss_kao0x1, giant0x5, kuri0x117, kurukuru0x57, spider0x38 |
| 5 | 15 | 500/0 | 228 | 0 (0%) | 0 | 0 | boss_kao_01 | boss_kao_01x1, spider0x110, spider_02x117 |
| 6 | 15 | 400/0 | 207 | 50 (24%) | 0 | 0 | boss_kao_02 | boss_kao_02x1, giant0x9, giant_01x9, kuri0x31, kuri_01x12, kuri_02x52, kurukuru0x50, spider0x31, spider_01x12 |
| 7 | 15 | 340/0 | 189 | 48 (25%) | 42 | 0 | boss_kao_03 | bat0x48, boss_kao_03x1, giant0x14, giant_01x6, giant_03x11, kuri0x54, kuri_03x7, spider0x24, spider_03x24 |
| 8 | 15 | 450/0 | 214 | 71 (33%) | 0 | 0 | boss_ude_03 | bee0x14, boss_ude_03x1, giant_02x12, kuri0x88, kurukuru0x57, spider0x42 |
| 9 | 15 | 500/0 | 125 | 52 (41%) | 0 | 25 | boss_ude_04 | bat0_lessJointsx24, bee0x6, boss_ude_04x1, giant0x5, giant_02x5, kuri0x32, kuri_06x17, kurukuru0x22, spider0x5, spider_06x8 |
| 10 | 15 | 500/2 | 157 | 126 (80%) | 8 | 0 | boss_ude_00 | bat0x40, bee0x31, boss_ude0x1, cisors0x12, kurukuru0x55, spider0x10, spider_03x8 |
| 11 | 15 | 400/0 | 226 | 199 (88%) | 26 | 0 | boss_ude_01 | bat0x91, bee0x24, boss_ude_01x1, giant_05x5, kuri_03x4, kuri_04x6, kurukuru0x84, spider_03x11 |
| 12 | 15 | 500/0 | 131 | 0 (0%) | 0 | 130 | boss_ude_02 | boss_ude_02x1, cisors_06x13, giant_06x13, kuri_06x48, spider_06x56 |
| 13 | 20 | 400/3 | 178 | 71 (39%) | 51 | 0 | boss_fat_00 | bat0x23, bee0x10, boss_fat0x1, cisors0x5, cisors_03x5, cisors_04x5, giant0x5, giant_03x5, giant_05x5, kuri0x18, kuri_01x18, kuri_05x14, kurukuru0x37, spider_01x10, spider_03x10, spider_05x7 |
| 14 | 20 | 500/0 | 162 | 51 (31%) | 59 | 10 | boss_fat_01 | bat0x21, bee0x9, boss_fat_01x1, giant_04x5, giant_05x6, kuri0x15, kuri_03x6, kuri_04x15, kurukuru0x20, spider0x7, spider_02x20, spider_03x7, spider_04x5, spider_05x15, spider_06x10 |
| 15 | 20 | 500/0 | 204 | 78 (38%) | 36 | 26 | boss_fat_02 | bat0x30, bee0x17, boss_fat_02x1, cisors_01x8, cisors_04x10, giant0x7, giant_01x7, giant_06x8, kuri0x20, kuri_02x12, kuri_04x10, kuri_06x8, kurukuru0x30, spider0x10, spider_03x6, spider_05x10, spider_06x10 |

(`air` = `EnemyBase.enemyMoveType == air`: kurukuru (UFO), bat, bee and the Fat boss; `balloon` = `spawnMode == Balloon` (kuri/spider/giant/cisors 03-05);
`fire` = `spawnMode == Fire` (_06 variants, burn-immune and fireSpeed). Variants 01..07 differ only in damage tables / hp / speed.)
There is **no per-stage tower restriction in the data**: `StageMain` only carries music + economy; tower availability is progression
(`towers.json` `lockable` = 002/004/006/009, DLC `dlcLock` 1 = missile tower_010, 2 = gem tower_005). Enemy classes that REQUIRE a specific
tower: air enemies (kurukuru, bat, bee, Fat boss) need an air-capable tower (crossbow tower_007 / tesla / lightning / hive: `attackType all`;
anti-air tower_011 and laser tower_012: `air`); the cannon tower_001 is `ground` only.

## 2. Mechanic matrix (sim = `src/core`, view = `src/view`)

| mechanic | stages | sim | view | state after this audit |
|---|---|---|---|---|
| ground walkers kuri / spider / giant / cisors, slopes, blocking queue | all | ported (GameCoreEnemy) | ported | OK |
| air movers kurukuru / bat / bee (attackType all/air only) | 1-4,6-11,13-15 | ported | fly clips | OK (stage 1-3 kurukuru were never killable by the old bot: cannon is ground-only) |
| **Enemy damage tables** (`EnemyAttributesSettings`: strength x class damage/reaction multipliers; giants take 0.3x from Soft, bats 2x from Physic, bee 3.34x Hard, balloons 10x Normal) | all | DamageHelper ported | **MISSING**: every enemy viewer returned `null` -> all hits x1 (headless AND browser) | FIXED: `src/data/enemyAttributes.ts` (+`enemyAttributes.generated.ts`, `tools/data/export_enemy_attributes.py`), wired into `EnemyStageView` and the headless viewer |
| **Boss weak points** (`EnemyBase.AttackPoints()` = "AttackPoint" children: bero 4, kao 4 (2 ground + 2 air), fat 2 (ground+air), ude/tall 3) | 1-5 (bero/kao), 8-15 | GameCoreEnemyAttackPoint + vulnerable-damage accumulation ported | **MISSING**: `attackPoints()` returned `null` | FIXED: `tools/data/export_enemy_attackpoints.py` -> `src/data/enemyAttackPoints.generated.ts`; both viewers return them (own attribute tables for ude/fat points) |
| Balloon-spawn enemies (3 balloons, hp 225, pop = fall + land) | 7,10,11,13,14,15 | ported (popBalloons, balloon attack point) | `getComponentInChildrenBalloon() -> null` => **NullReferenceException on the first balloon enemy** (sim derefs it) | FIXED contract (3 balloons / hp 225 / balloon attribute table x10 Normal); balloon MESH + fall/land anims still not drawn |
| Tower EXP from kills (`GameCoreTower.OnEnemyDestroy` reads `EnemyBase.expValue` via the viewer) | all | ported | viewer had no `expValue` => **EXP = NaN, towers never levelled from kills** (browser too) | FIXED (`EnemyStageView.expValue`, headless viewer); stage-1 pin unaffected (no upgrade table in the legacy bot) |
| Fire-spawn enemies (burn-immune, fireSpeed; freeze extinguishes) | 9,12,14,15 | `isOnFire`, BuffFreeze extinguish ported | no fire visual | OK sim; ice/flame now actually reach them |
| Burn / Freeze buffs, BuffSettingBurn/Freeze | flame/ice towers | Buff* ported, **BuffSetting* not** | - | PORTED `src/view/projectiles/buffSettings.ts` (Ghidra) |
| **Flame tower_004 / Ice tower_006** (ProjectileGaseous: flow, ground fire 11.3 s / frost 1.0 s, burn / freeze) | any | **MISSING** (Trajectory stand-in) | - | PORTED `GameCoreProjectileGaseous.ts` + flow/ground effect view |
| **Hive tower_008** (ProjectileInsect: bees) | any | **skeleton** (Trajectory stand-in) | - | PORTED `GameCoreProjectileInsect.ts` + bee swarm effect |
| Tesla tower_003 chain, Lightning tower_009, Laser tower_012 beam | any | ported earlier (Electric/Lightning/Beam) | muzzle/hit particles only | bolt + beam-line visuals ADDED (`BoltEffects.ts`); bolt look = stand-in |
| Gem tower_005 (DLC), missile tower_010 (DLC), EXP aura | DLC | ProjectileGem + TowerStateUpgradeAround ported | - | OK (not exercised: DLC-locked) |
| Mortar tower_002, crossbow tower_007, anti-air tower_011 (burst 4) | any | ported (Trajectory / Instant) | ok | OK |
| Tower dead-zone `attackRangeInner` + detector cone | any | ported (TowerHelper / EnemyDetectorCone) | - | bot ignored it (see 3) |
| Boss Bero (jumping), Kao (ground/air path segments `BossGround/BossAir`), Fat (air, weak points), Tall/Ude (weak points, low-HP speed) AI | 1-15 | `bossAI` + `bossAITerrainDetection` ported | boss attack/jump/blend animator states NOT ported (view) | sim OK once weak points exist |
| Boss minions (`bossMinions` per difficulty) | all boss waves | WaveManager ported | - | OK |
| Splitters / burrow / invisible / shield / healers | - | none exist in the data | - | n/a (no such enemy in `EnemyBase`; "shield" = anti-magic/physics class table + weakEffect, now live through the tables) |
| Water / drown (`DrownDepth` 0.25..5, `checkSphere`) | water stages | ported | drown sink anim not ported | headless seam has no water (checkSphere null) |
| Hit-shock spring, frozen animation stepping, giants' crumble, drown sink, boss anim blend trees | - | - | NOT ported (docs/ENEMY_ANIMATION_AND_HEALTH_ANALYSIS.md) | unchanged, see 6 |

## 3. Root causes of the stage 2 / stage 4 GAME OVERs (they were NOT sim errors)

Instrumented the unchanged legacy bot (`BOT=legacy`, now with kill/spawn/launch counters):

* **stage 2**: spawned air=40 boss=1 ground=59, killed ground=20 only. Cause chain: (a) the bot only builds tower_001 (cannon = `attackType ground`,
  `Hard`/`Physic`) -> the 40 kurukuru (air) are untouchable; (b) the bot player walked at y=0 while stage-2 ground is y=-1.5..-1.9, standing
  *above* every coin ("collected 0 coins / 29 expired"), so only the 400 starting coins (3 cannons) ever existed; (c) bero boss has weak points
  the viewer never supplied; (d) cannon stand-in geometry (sphere r=5.3) ignores the real dead zone.
* **stage 4**: same economy starvation (3 towers, 9 kills of 64 spawned by wave 5), air=17 bats/kurukuru unkillable, chibis 0 at wave 5.
* The legacy stage-1 clear is itself a bot artefact: 14 kurukuru were never killed there either (`killed by class: ground=95 boss=1`), they just never lost the chibis.

Fixes (bot, `BOT=smart`, default for stages >= 2; stage 1 stays `legacy` so its pin is untouched): player y follows the pickup, real tower contracts
(`src/main/headlessTowers.ts`: per-tower projectile prefab + detector cone + upgrade tables), tower-mix policy (cannon / crossbow / anti-air by air share,
flame/ice/laser/tesla/hive/mortar when gems allow), site choice by the tower's real engagement ring [attackRangeInner+0.3, cone radius],
paid upgrades (`UpgradeTowerCommand`) with spare gems, terrain linecast (arcs land, flame grounds), balloon / attribute / attack-point view data.
Synthetic tree layout (`syntheticTrees`) for stages whose scene is not extracted (6-15).

## 4. What was ported (evidence)

* `GameCoreProjectileGaseous` (RVA 0x4C5850..0x4C7680, 1,157 lines of pseudo-C, no C# upstream): ctor (target / fire direction / view tuning at +0x48..+0x80),
  `Tick` (age, `HasExpired` = tower gone or flow length used), `TickFlow` (`v.y += g*dt; p += v*dt` verified in raw disasm @0x4C6252..0x4C62B9, homing delta,
  terrain Linecast then a 0.25/0.5 probe cylinder), `TickAttack` (buff every valid damageable within `affectRadius`, players if `affectPlayer`),
  `OnHitTerrain/OnHitEnemy` (ground + lifetime = age + affectDuration, radius shrink by `furthestAffectRangeRate` with distance/detector radius,
  `projectileHitTerrain`), `OnHit/OnHitPlayer` (BuffSetting.AddBuff). Rodata: 2.5 / 0.25 / 0.5 / 1.0 read from the ELF.
* `Q4.BuffSetting / BuffSettingBurn / BuffSettingFreeze` (0x7349F0 / 0x734A90 / 0x736350 / 0x737910): duration by target kind, `IsEnemyOfBuffType` mask test
  (EBuffAffectTarget), dedupe by source projectile (`ResetTimer`), BuffBurn(duration, attackDamagePerSecond, source, frequency 0.067), BuffFreeze(...) with
  `BuffSettingOverrideFreeze` from tower upgrades; player burn raises `explosionDamageEvent(0.5)`. Not ported: the ice-fruit spread branch.
* `GameCoreProjectileInsect` (RVA 0x4C7B00..0x4C9D90): ctor field initialisers + view tuning, `ChangeHoverTarget` (players then tower), swirl heading with two
  random yaw/roll draws (`RandomFromMultipleRange`: 3 draws), `TickHover` (RotateTowards `m_rotateSpeed` deg/s, `m_moveSpeed`), `TickGroundAttaching`
  (MoveTowards 0.1 u/s, applied as a per-tick delta - faithful), `TickEnemyDetection` (closest valid damageable in the cylinder -> `beeSpotATargetEvent`),
  `StateAttackStandBy`, `StateAttackAppreach`, `OnHit` (full attributed damage). The delegate-typed `InsectState` is a plain function field.
  UNVERIFIED details: the coin-flip draw `RandomRange(0,2)` signature, exact quaternion multiplication order (rot * AngleAxis, read from the call
  argument order), `GetCollisionCylinder().radius` for Gaseous radius shrink (IEnemyDetector slot 6 returned a float: radius).
* View: Gaseous flow stream -> ground-fire loop swap (`ProjectileViewer.updateGaseous`), bee swarm loop riding the sim bee, `BeamLine` (head = sim pos,
  tail = head - dir * min(beamLength, dist from muzzle)), `BoltEffects` (tesla chain segments, sky lightning strikes).

## 5. Per-stage headless result (improved bot, Medium, `npm run sim:stage1 -- N`)

`BOT=smart` (stage 1 also pinned in legacy mode). Stages 6-15 run on the synthetic layout (no extracted scene). "OLD" = the pre-audit pin.

| # | outcome | waves | chibis | towers built | killed | replay hash | notes |
|---|---|---|---|---|---|---|---|
| 1 | STAGE CLEARED | 11 / 10 | 20 / 20 | 14 (tower_001x10 tower_007x3 tower_006x1) | air=1 boss=1 ground=117 | `0xaf1cd17fa037ae55` | legacy pin 0x61889fae2ea828f1 unchanged; smart bot also clears (14 kurukuru: only 1 air kill by 10 cannons + 3 crossbows is enough because they never hurt the chibis) |
| 2 | STAGE CLEARED | 11 / 10 | 20 / 20 | 17 (tower_001x8 tower_007x4 tower_011x3 tower_006x2) | air=45 boss=1 ground=64 | `0x4888bb246a2d8913` | OLD: GAME OVER (naive bot). Clears once coins are collected, air is covered (3 anti-air) and the bero weak points exist |
| 3 | STAGE CLEARED | 11 / 10 | 20 / 20 | 17 (tower_001x8 tower_007x4 tower_011x3 tower_006x2) | air=24 boss=1 ground=89 | `0x7be1592f899581dc` | OLD: CLEARED (naive); smart clears |
| 4 | STAGE CLEARED | 16 / 15 | 20 / 20 | 24 (tower_001x11 tower_007x5 tower_011x5 tower_006x3) | air=86 boss=1 ground=174 | `0x027e7667302aa978` | OLD: GAME OVER at wave 5. Clears: 24 towers, 86 air kills (bats/kurukuru), Kao boss killed |
| 5 | STAGE CLEARED | 16 / 15 | 20 / 20 | 26 (tower_001x17 tower_007x6 tower_006x3) | boss=1 ground=237 | `0x4b6c13ea7e45103e` | OLD: CLEARED; no air units; 17 cannons |
| 6 | STAGE CLEARED | 16 / 15 | 20 / 20 | 22 (tower_001x10 tower_007x5 tower_011x5 tower_006x2) | air=50 boss=1 ground=173 | `0x0118c608f69b9297` | synthetic layout; Kao boss, 50 air |
| 7 | GAME OVER | 14 / 15 | 0 / 20 | 18 (tower_001x8 tower_007x4 tower_011x4 tower_006x2) | air=30 ground=94 | `0x37ad11da0709c500` | GAME OVER at wave 14 of 15 (balloon + bat stage; bot leaks 20 ground; balloons are 10x vulnerable to Normal-strength = crossbow/anti-air, 0.1x to the cannon) |
| 8 | GAME OVER | 12 / 15 | 0 / 20 | 12 (tower_001x6 tower_007x3 tower_011x2 tower_006x1) | air=22 ground=77 | `0x89012f26018ccd5f` | GAME OVER at wave 12: Tall boss stage with bees (900 hp) + giants; 12 towers only (economy: no gems) |
| 9 | STAGE CLEARED | 16 / 15 | 7 / 20 | 21 (tower_001x10 tower_007x5 tower_011x4 tower_006x2) | air=43 boss=1 ground=63 | `0xec06a3044f8fb363` | cleared with 7/20 chibis; fire-spawn kuri/spider/cisors (burn-immune) + Tall boss |
| 10 | TIME CAP | 16 / 15 | 20 / 20 | 4 (tower_001x2 tower_007x1 tower_011x1) | air=74 ground=15 | `0x7e80f5da34634143` | TIME CAP: 80% air (bat/bee/kurukuru); only 4 towers built (initial gems 2, little ground income); leftover enemies parked outside the home reach (see 6) |
| 11 | TIME CAP | ? | 12 / 20 | 6 (tower_001x3 tower_007x1 tower_011x1 tower_006x1) | air=48 ground=10 | `0x7fbee34c632bfe35` | TIME CAP: 88% air; 229 air spawned / 48 killed, 6 towers; economy collapse |
| 12 | STAGE CLEARED | 16 / 15 | 16 / 20 | 26 (tower_001x17 tower_007x6 tower_006x3) | boss=1 ground=132 | `0xfea32e6eedbbc100` | cleared; all fire-spawn: flame towers would be useless, ice extinguishes |
| 13 | TIME CAP | 19 / 20 | 20 / 20 | 21 (tower_003x1 tower_001x9 tower_007x5 tower_011x4 tower_006x2) | air=64 ground=56 | `0x3e9deca749391dc6` | TIME CAP (wave 19/20): Fat boss stage, 5 tower types built incl. tesla |
| 14 | TIME CAP | 21 / 20 | 20 / 20 | 13 (tower_001x6 tower_007x3 tower_011x3 tower_006x1) | air=24 ground=39 | `0xae9bdb8c9a246cbf` | TIME CAP (wave 21/20) |
| 15 | TIME CAP | 20 / 20 | 20 / 20 | 26 (tower_001x12 tower_007x6 tower_011x5 tower_006x3) | air=43 ground=88 | `0x8695fe6a30ad0924` | TIME CAP (wave 20/20); hive + flame built when gems allowed |

Mechanics exercised in the FINAL pinned runs: cannon (Trajectory lob), crossbow (Instant), anti-air (Instant burst 4), ice tower_006 (Gaseous + BuffFreeze:
hundreds-thousands of buff-applied hits per run), tower EXP -> automatic Lv2-5 + paid `UpgradeTowerCommand`, balloons (7,10,11,13,14,15), fire-spawn
(9,12,14,15), air enemies, Bero/Kao/Tall/Fat bosses with real weak points, tesla (stage 13). The gem towers flame / laser / hive were exercised in the
instrumented intermediate runs (stage 2: flame 3,592 buff-hits; stage 4: flame 17,481 hits, laser 41 hits, hive built) and by tests/core/gaseous-insect.test.ts,
but the final bot spends its few gems on upgrades first, so most pinned runs do not build them (the bot is a coverage tool, not a strategy claim).
Notes in the table are observations of one deterministic run each, not difficulty claims.

TIME CAP analysis (stages 10, 11, 13, 14, 15 - not game outcomes): at the cap `DEBUG_ALIVE=1` shows (a) ground enemies parked at pathD ~87.5 / 3.30 u from
home with `m_canAttack = true`, `isAttacking = false`, `waitTime 0`: the home only calls `enemy.attack` inside `enemyDetectionRange 3.0 + enemy.collision.radius`;
the headless fixture gives EVERY enemy the same 0.6 x 1.0 x 0.6 model bounds (radius 0.30, so reach 3.30) so the enemy hovers just outside it and is
held forever by the canAttack hold branch of `GameCoreEnemy.tick`; (b) bees/bats frozen at pathD 20-30 (y = -5.5) with `blocked`: enemies queued behind a parked leader. Both look like
the same fixture-radius deadlock; the browser uses real GLB bounds (EnemyStageView). UNVERIFIED - fix = per-enemy bounds from the GLBs in the headless viewer
(not done), which would change every smart hash again.

## 6. Still stubbed / not done

* Boss view: attack / jump / blend-tree states, hit-shock spring, frozen animation stepping, balloon rig + fall/land, drown, burn / freeze visuals ON the enemy
  (`addBuffEvent` -> Fire / Ice ParticleGroup): DONE in docs/ENEMY_BOSS_VIEW_ANALYSIS.md (only the giants' debris crumble stays approximated).
* Bolt colour/thickness, bee effect orientation, flame stream orientation are VISUAL stand-ins verified only by unit tests (no browser footage compare).
* Stages 6-15 have no extracted scene: headless uses a synthetic tree layout around the wave paths (mechanics, not placement); their pins carry that caveat.
* Ice-fruit buff spread, `BuffSetting.GetAllInRange`.
* The bot never dances for EXP, sells, or uses fruits; GAME OVER / TIME CAP outcomes of the bot are not claims about game difficulty.

## 7. Notes for PROGRESS.md (outside pjm2-web, not edited by this lane)

* RE-PIN (stage gameplay audit): stage 1 legacy `0x61889fae2ea828f1` UNCHANGED; smart pins stage 1 `0xaf1cd17fa037ae55`, 2 `0x4888bb246a2d8913` (was GAME OVER
  `0xf5dec45809d65bcb`), 3 `0x7be1592f899581dc` (was `0x049939b21ebc36d6`), 4 `0x027e7667302aa978` (was GAME OVER `0xacc118c9d7e8277a`), 5 `0x4b6c13ea7e45103e`
  (was `0x0201d49b499cc085`). Stages 6-15 synthetic pins in tests/data/headless-stages.test.ts (`PIN_SYNTH=1`).
* Upstream gaps closed: GameCoreProjectileGaseous, GameCoreProjectileInsect, Q4.BuffSetting{,Burn,Freeze}. Still open: GameCoreNetworkBridge (MP), InteractionObject.
* Live-game bugs fixed by this audit (browser, not only headless): enemy damage tables were x1, boss weak points absent, balloon enemies would NRE,
  tower EXP from kills was NaN.


## 8. TIME CAP / GAME OVER triage (re-pin 2)

Per-stage classification of the old TIME CAPs (10, 11, 13, 14, 15) and GAME OVERs (7, 8, 9):

* **Stages 13, 14, 15 TIME CAP = (b) cap too short.** Real stages 13-15 need 29-33 sim-minutes (20 waves); the runner cap was 25 min. The runner now
  caps at 60 min (`CAP_MIN`). Not a deadlock.
* **Stage 10 / 11 TIME CAP = (a) fixture artifact (+ (c) latent deadlock).** At the cap ground enemies sat at 3.30 u from the home with `canAttack=true`.
  The headless viewer gave every enemy model the flat 0.6x1.0x0.6 bounds (collision radius 0.30, reach 3.30). The REAL radii (Cylinder.fromBounds of the
  GLB bind-pose bounds, the same the browser feeds) are kuri 0.25, spider 0.52, cisors/bee 0.56-0.6, giant 0.77, fat boss 0.96 (src/data/enemyBounds.generated.ts,
  tools/data/export_enemy_bounds.py). With real bounds the stage-10 deadlock is gone. A second, independent deadlock remained and is a port-level
  issue (c): the Home enemy query is a height-0 cylinder and the grid filter is strict, so an enemy with `e.y >= home.y` is not returned. The flat
  platform around every home is y == 0 == home.y with ~1e-6 probe noise, so an enemy that latched `m_canAttack` on a tick with y = -1e-6 was dropped on the next tick
  (y = 0) and parked forever (stage 11: 12 parked kuri/spiders for 3,300 s; they also blocked everything queued behind them: the "bees frozen behind a parked leader"
  of section 5 is the same effect). The same knife edge made enemies with y >= 0 walk through the home harmlessly to the path end (silent
  destroySelf), i.e. many earlier "20/20 chibis" clears were partly enemies that never attacked. `GameCoreHome.setHomeQueryHeight(0.25)` (default 0 = faithful,
  legacy stage-1 pin untouched) is enabled by the smart bot and by stageSession; the original's real height argument could NOT be re-verified (Ghidra drops the
  xmm1 height of `new Cylinder(range+4, h)` and eboot.elf offsets for Home.Tick could not be mapped in this session; REA/Ghidra unavailable) - UNVERIFIED.
* **Stages 7 / 8 / 9 GAME OVER = (b) bot weakness.** With the fixture fixed + bot changes (path-sample weighting toward the home (HOME_W=3 within 20 u), balloon-aware
  anti-air share (balloon carriers count as air), affordability fallback so early waves do not wait for the next pattern tower): 8 and 9 clear, 7 still loses (20 leaks: waves 1-2 with 4 towers,
  balloon waves 6 / 12). No unported mechanic was identified (balloons, fire-immune, boss weak points are ported); stage 7 has 0 gem income and 340 start coins.
* Stage 10 economy is data-poor: `totalMoney` is 0 for waves 0-13 (250 only on the boss wave) and 2 initial gems, so the bot (500 start coins, 4 towers) cannot grow: bot/economy, not a sim bug (unverified whether hidden pickups / fruit feed it in the real game).
* Port fix found on the way: `GameCoreWaveManager.onDeadEnemy` dereferenced a null `getMostRecentObjectVersion()` when an enemy attacked after gameOver (stage 13 crash); now guarded.
* Remaining GAME OVERS (7, 10, 11, 13, 14, 15) are the bot (3-8 towers on 10/11/14: only coin drops fund it) running against the now actually-attacking sim; they are not difficulty claims.

Final table (BOT=smart, real extracted scenes for all 15, cap 60 min; stage 1 legacy `0x61889fae2ea828f1` unchanged):

| # | outcome | waves | chibis | hash |
|---|---|---|---|---|
| 1 | CLEARED | 11/10 | 20 | `0x62482f8a87a2f590` |
| 2 | CLEARED | 11/10 | 15 | `0x3b35b2d7ea80b47a` |
| 3 | CLEARED | 11/10 | 20 | `0x5151be58438f4e1b` |
| 4 | CLEARED | 16/15 | 20 | `0x55bd6c83d53eddf6` |
| 5 | CLEARED | 16/15 | 16 | `0x7e98904e5fa63a66` |
| 6 | CLEARED | 16/15 | 20 | `0xd4a154cf7aeb9266` |
| 7 | GAME OVER | 14/15 | 0 | `0x3cc903fa932b1aca` |
| 8 | CLEARED | 16/15 | 12 | `0x63588e3d0382a4be` |
| 9 | CLEARED | 16/15 | 11 | `0x0c4c227166433f00` |
| 10 | GAME OVER | 15/15 | 0 | `0x2ed96a257b925307` |
| 11 | GAME OVER | 13/15 | 0 | `0xd197abd4747c5784` |
| 12 | CLEARED | 16/15 | 19 | `0x96b5b2efd5315fb6` |
| 13 | GAME OVER | 14/20 | 0 | `0xeb89bb8b81256246` |
| 14 | GAME OVER | 9/20 | 0 | `0x45d9a14655c9ffd4` |
| 15 | GAME OVER | 17/20 | 0 | `0x9e0deb9ffa9f01c6` |

Note: the old stage 6-15 "synthetic layout" pins were in fact recorded on the real scenes (SYNTH=1 gives different results); the SYNTH pin list was retired.
