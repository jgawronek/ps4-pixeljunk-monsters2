# PROGRESS — PixelJunk Monsters 2 (PS4) decompilation

## Status: MAPPED — decryption done; starting named decompilation
User consent on record ("decrypt my game" / "you have consent"): option (a),
local-only, own copy, single-player, output = source only.

## Target (confirmed)
PixelJunk Monsters 2, PS4, CUSA11967, v01.00, content ID
UP4774-CUSA11967_00-PJM2000000000000. Limited Run #150 disc dump (fpkg).
**Unity 5.6.5p1, IL2CPP (C# → native x86-64), metadata v23.** → EASY/MEDIUM case.

## Milestones done
1. Identified real target (PS4 PJM2, not the mislabeled PS3 pkg first staged).
2. Verified archive: 47/47 RAR parts CRC OK; pkg MD5 matches NFO.
3. Decrypted PS4 PKG → PFS → 377 files (ps4-pkg-tools, built from source).
   PKG was fpkg (no retail flag); platform RSA keys → EKPFS → AES-XTS.
4. Converted fake-SELFs → x86-64 ELF (ps4_unfself): eboot.elf,
   Il2CppUserAssemblies.elf (game code), SavedGames/CommonDialog/PS4Util/libc/
   libSceFios2/etc. All segments Encrypted:0 (wrapper-strip, not retail decrypt).
5. Parsed IL2CPP v23 metadata directly (Il2CppDumper couldn't auto-locate code
   regs in stripped PS4 ELF): **4,049 types / 26,477 methods / 18,786 fields /
   5,115 string literals**. Wrote decomp/il2cpp/{dump.cs, q4_types.txt,
   structure_summary.txt, string_literals.txt}.
6. Wrote MAP.md (engine, architecture, systems, main loop, scenes, estimate).

## Size estimate (step 2 deliverable)
- Game-relevant logic ≈ **5,700 methods**: Q4 core 3,869 + Q4.UI 1,137 +
  GameCore 709 (excluding online/analytics).
- Architecture: Q4 (Unity presentation) ↔ GameCoreBridge ↔ GameCore (C# sim).
- Biggest classes: Player 177m, PlayerMotor 87m, GameCoreEnemy 82m, EnemyBase 75m.
- Difficulty: EASY/MEDIUM (Unity IL2CPP, named C# recoverable) — NOT Cell/SPU.
- Faithful playable rebuild ≈ weeks–months of focused work; this session targets
  map + structure + decompilation of key systems + honest reporting.

## Tooling
- REA MCP v6.9.0 connected. Ghidra 12.2 + JDK21 installed (/opt/ghidra_12.2_PUBLIC).
  REA↔Ghidra needs OpenCode restart with GHIDRA_INSTALL_DIR set; meanwhile using
  Ghidra headless directly.
- ps4-pkg-tools (/srv/opencode/ps4-pkg-tools/build/ps4-pkg-tool),
  ps4_unfself (/srv/opencode/ps4_unfself), Il2CppDumper (/srv/opencode/Il2CppDumper).
- Host: Ubuntu 24.04, 24 cores, 63 GB, HEADLESS (no GPU).

## Method→address mapping: SOLVED
- Il2CppDumper succeeded on Il2CppUserAssemblies.elf (force-continue past dump
  prompt): CodeRegistration=0xFEC7A, MetadataRegistration=0xFEC9A.
- decomp/il2cpp_user/: dump.cs (7.9MB, full C# API w/ field offsets + method
  RVAs + signatures + constants), script.json (53,497 named functions→addr),
  il2cpp.h, stringliteral.json, DummyDll/Assembly-CSharp.dll (ILSpy-browsable).
- decomp/skeleton/: per-namespace C# skeletons (117 namespaces). GAME: Q4 5728m,
  Q4.UI 1371m, GameCore 800m, Q4.UI.Debug 177m, Q4.UI.GuideBook 93m,
  GameCore.Event 37m, Q4.Prototyping 36m, Q4.PS4 19m, etc.

## Ghidra decompilation (in progress)
- Ghidra 12.2 needs JDK 25 (installed openjdk-25). Headless analysis of
  Il2CppUserAssemblies.elf DONE + saved (project decomp/ghidra_proj/PJM2).
- Ghidra 12.2 dropped Jython for PyGhidra → Python scripts fail headless.
  Rewrote naming/export as JAVA GhidraScripts (Il2CppName.java, ExportDecomp.java).
- Fixed exec permissions on Ghidra native binaries (zipfile extraction dropped
  them): decompiler `openProgram` was failing until decompile/sleigh chmod +x.
- NAMING DONE: 53,497 methods + 5,115 strings + 3,239 metadata labeled
  (image base 0; names.tsv/strings.tsv/metadata.tsv from script.json).
- GameCore decompilation DONE: 1,198 methods / 246 classes, 0 failures.
- Q4 decompilation DONE: 5,879 methods / 737 classes, 0 failures.
  TOTAL: 7,077 methods / 983 classes decompiled → decomp/decompiled/<class>.c.
- Sub-agent: GameCore_BLUEPRINT.md (simulation architecture + reconstruction order).
- RECONSTRUCTION_GUIDE.md written (IL2CPP→C# method + boilerplate rules).
- Pilot reconstruction done: decomp/src/GameCore/Buff.cs (worked example).
- RECONSTRUCTION PHASE: per-subsystem sub-agents → decomp/src/GameCore/ and /Q4/.
- GameCore_BLUEPRINT.md DONE (1,132 lines): GameCore is a 60 Hz copy-on-tick
  deterministic sim (TicksPerSecond=60); deep-copy GameCoreFrame via CoreObjectPool,
  tick, InstallFrame swap. GameCoreHandle survives swaps + caches Unity viewer.
  Collision = 4-unit XZ cylinder grid. Q4.GameCoreBridge drives loop + maps
  handles↔GameObjects + bootstraps from scene (IPlaceableViewObject).
  Tick order: waves→enemies→player→towers→projectiles→damage→pickups (buffs tick
  inside targets; collision query-based). Tree→tower build (TowerHelper.FromTreeToTower),
  8-state tower FSM, 8 projectile types, IDamageable/DamageHelper strength×class
  pipeline, chibis-as-HP home, 5-slot inventory (Coin/Gem/Interest/Spent).
  24 NetworkCommand subclasses; solo runs via NullNetworkLayer. Events: 58 typed
  events, 3 delivery times. MINIMAL PLAYABLE SLICE ≈ 250–300 methods (see blueprint).
- Data extraction (Phase 3): UnityPy venv (/srv/opencode/venv-unity). Extracted
  JSON TextAssets → decomp/data/settings/: TowerSetting (tower stats+upgrades),
  EnemySetting (3 enemies). These are a TEST subset; full enemy/tower/wave roster
  is in prefab MonoBehaviours (needs IL2CPP field-mapping to read — follow-up).

## Phase 3 DATA LAYER — DONE + VERIFIED (compiles & runs)
- Full numeric gameplay tables extracted from AssetBundle MonoBehaviour
  type-trees → decomp/data/*.json (see decomp/data/README.md). Parameters only,
  NO art/audio/geometry copied. Extraction scripts in /tmp/opencode/.
  - enemy_roster.json: 57 enemies (life/speed/moveType/spawnMode/exp + strength/
    class damage-reaction tables). Real prefab stats supersede shipped test JSON
    (e.g. kuri_00_001: life=300 speed=0.836, NOT the test-file 100/0.462).
  - structures_TowerBase.json: 21 towers (power/speed/ranges/costs/refunds/
    buildTime/burst/attenuation) + TowerUpgradeSettingGeneric (Lv2–5 upgrades).
  - stage_waves_resolved.json: 17 stages × waves × 4 difficulties; every
    enemyObject PPtr RESOLVED to an enemy name (via enemies-bundle GameObject
    path_id map) + world-space spawn paths (m_pathList/m_pathName/segTypes).
  - stages_DifficultySettings.json (4 tiers), globalsettings_AreaStageInfoMap
    (7 areas/21 stage entries, scene names + unlock chain), structures_Home
    (NumChibi=20 → chibis are the base HP).
- Wrote decomp/src/GameData/{GameDataEnums,GameDataTypes,GameDataLoader}.cs:
  enums EXACT from metadata (EEnemyDef 48-member roster, ETowerDef, E*TypeDef,
  EEnemyMode/ESpawnMode/EBossType), faithful POCOs, System.Text.Json loader.
- VERIFIED: installed dotnet-sdk-8.0; compiled the 3 files + a harness and ran
  against real tables → "DATA_LAYER_OK": 57 enemies / 21 towers / 17 stages /
  4 difficulties / 7 areas load; **1873/1873 spawn→EnemyDef resolve, 0 missing**.
  Stage 1 (tl_stage_001): 15 waves, initCoin=400, wave1=17×kuri over 3 ground
  paths, wave15=boss_kao_00 on Boss path — matches retail first-level shape.
- Sub-agents dispatched: core-lifecycle, enemy/AI, wave/tower/projectile,
  buffs/currency/player (GameCore) + Q4 bridge/views. NOTE: model deployment
  limits 4 parallel requests; wave/tower/projectile sub-agent hit RateLimitError
  → RE-RUN when slots free. Avoid >3 concurrent sub-agents.

## Sub-agent completions (integrated)
- BUFFS/CURRENCY/PLAYER — COMPLETE: 19 files in decomp/src/GameCore/ (~1,940
  lines). IBuffs, IGrabbable, CurrencyValueInfo, Buff(+refine),
  BuffBomb/Burn/Freeze/Slow/Flare/Trampoline/FastPlayer, BuffContainer,
  BuffSettingOverrideFreeze(+IBuffSettingOverride), GameCorePickup/
  PickupCurrency/PickupManager, GameCoreInventory(+EInventoryType,InventoryBag),
  GameCorePlayer (26 methods), GameCoreLocalMultiplayerInfo. Build succeeded
  0/0 in scratch harness. Bomb/Burn/Freeze/Slow effects confirmed;
  Flare/Trampoline = empty ExecuteBuff (behavior in Q4). Currency: coins
  credited by sim, gems by Q4 view; wave-end interest = RoundToInt(coins×rate)−coins.
- CORE LIFECYCLE — COMPLETE: 12 files. GameCore.cs, GameCoreObject,
  GameCoreHandle, GameCoreFrame, CoreObjectPool(+TypePool,DeepCopyAttribute),
  GameCoreCollisionManager(+GridCell,CellIterator), Events(+58 nested events),
  Cylinder, Event/{EventTime,CoreEventBase,CoreEventShim,CoreEvent}.
  Frame order: PrepareNextFrame → Tick(TickAllObjects → PostGameCoreTickEvents)
  → PostUnityUpdateEvents. KEY CORRECTIONS to blueprint (now folded in):
  * CreateFrameCopyForUpdate does NOT deep-copy — mutates frame IN PLACE
    (normal single-player tick never deep-copies; DeepCopy* uses
    Reflection.Emit which IL2CPP can't run = dev/resync path only).
  * RandomRange is NOT handle-seeded — plain UnityEngine.Random.Range; handle
    only keys a NetworkLog entry online.
- Q4 BRIDGE/VIEWS — COMPLETE: GameCoreBridge (32 methods: driver, maps,
  bootstrap, serialize/resync, viewer pausing), IPlaceableViewObject (actually
  GameCore.IPlaceableViewObject internal — noted in-file, 9 implementors+RVAs),
  Structure (real base view class of Home/TowerBase/NatureTree — the hinted
  GameCoreViewBase/ViewObject/TowerView names don't exist), Chibi (38 methods),
  PlayerInfo, PlayerManager (14 methods), _Player_EnemyBase_NOTES.md (Player
  177m / EnemyBase 75m field groups + RVAs + verified seams). All compile 0/0
  against minimal stubs. KEY VERIFIED CORRECTIONS (folded into blueprint):
  * SP is VARIABLE-STEP: one tick per Update, TickDeltaTime =
    Min(Time.deltaTime, 0.5f); fixed 60 Hz is network-only.
  * SP determinism aid = Random.InitState(updateCount) per tick (bridge-side).
  * Pose/command seam = OnGameCoreTicked (between PrepareNextFrame and Tick):
    samples Player views → applies frames → executes queued NetworkCommands.
    Views never mutate sim state; ALL gameplay goes through AddPlayerCommand
    even in SP (NullNetworkLayer loopback).
  * Bootstrap = FindObjectsOfType<MonoBehaviour>() filtered by
    IPlaceableViewObject (the decompiler's <NatureTree> label = shared-generic
    artifact); enemy views instantiated by GameCoreEnemy ctor itself.
  * EnemyBase.StateMove snaps to core.position + hit-shock; facing/anim speed
    derived from position − previousTickPosition; chibis = event-driven views
    of GameCoreHome.ChibiData.
- Sub-agents still running: wave/tower/projectile (GameCoreWaveManager landed;
  towers/fruit/projectiles/home pending). Full sim integration compile deferred
  until it completes (GameCoreEnemy calls into its unlanded types).

## RATE LIMIT — sub-agents blocked, continuing DIRECTLY in main session
- wave/tower agent hit RateLimitError twice; second = WEEKLY Clinepass limit
  (resets ~5d16h). Sub-agent dispatch unusable for now → main session (separate
  model pool) continues reconstruction directly.
- Before dying, the wave/tower agent landed GameCoreFruit.cs (36KB) AND fixed
  both flagged GameCoreWaveManager.cs bugs: k__BackingField → auto-property
  `introSequenceFinished { get; private set; }`; rodata constants CONFIRMED
  (SpawnStartEpsilon=1.0, OffsetAngleScale=Deg2Rad). No action needed on those.
- REMAINING (critical path to minimal playable slice, per coverage map in
  _INTEGRATION_NOTES.md): GameCoreHome (1,117 ln), GameCoreTower (1,784) +
  TowerState FSM (9 files ~2,600) + TowerHelper (1,548), GameCoreProjectile
  family (9 files ~6,100), GameCoreTree (251), GameCoreShop (197),
  GameCoreInteractionObject (854), GameCoreCharacterTemplate (78),
  StateMachine_* (~340), Q4.PlayerCommand + Command* views, GameCore.Network
  command classes (BuildTowerCommand, PickupFruitCommand, DropFruitCommand,
  DetonateFruitCommand, AddInventoryCommand, EnterLeaveTowerCommand, ...).

## Direct reconstruction (main session, post-rate-limit) — TOWER LANE
Discovered the dead wave/tower agent HAD landed before dying: TowerHelper.cs,
GameCoreProjectile.cs, GameCoreProjectileTrajectory/Instant/Electric/Lightning/
Beam.cs. Reconstructed directly (main session):
- GameCoreHome.cs (chibi pool = base HP; spawn/spread/linecast-ground-snap;
  DealDamage formation-shift + gameOverEvent with DebugMenuCanvas.disableGameOver
  suppression; Tick attacker handling incl. non-boss cleanup when home empty;
  NumChibiAtEndOfWave for stage ranking). All 12 rodata constants CONFIRMED.
- GameCoreTree.cs (Breakdown/Revive refcount, structureBreak/treeRevive events,
  position-matched viewer relink).
- GameCoreTower.cs (full 30-method sim tower: InitializeSettings copies ~30
  fields from Q4.TowerBase prefab; TickTargetQueue 0.25s requery + queue
  maintenance; GrantEXP/UpgradeTower via Q4.TowerUpgradeSetting slots 5/6/7;
  hive ammo + PlayerAroundInfo gathering window; vtable slots resolved via
  16-byte entries + 17-slot interface shift, verified against IDamageable).
- StateMachine.cs (State<TOwner> + StateMachine<TOwner>: blocking/priority
  gating, next/next-next state chaining, owner = (TOwner)this).
- TowerStateMachine.cs, TowerState.cs, TowerStateIdle.cs (caution scan cycle
  EReset→ERotating→EWatching; hive insect-budget + gem forced attacks),
  TowerStateAttack.cs (burst timer/ammo/reflection projectile spawn via
  Q4.Projectile.GetGameCoreType + Activator.CreateInstance(tower, targets, true)),
  TowerStateBuild.cs (rise from underground over difficulty-scaled buildTime),
  TowerStateChangeMag.cs, TowerStateBroken.cs (gem pop delay),
  TowerStateUpgradeAround.cs (gem-tower EXP aura + sink progress events),
  TowerStateDegenerate.cs.
- CROSS-CHECKED landed TowerHelper.cs against fresh full decompilation →
  fixed 6 fidelity bugs: hit-position delta sign flip; InAttack/InDetection
  must use un-lowered detectorPos (anchor only for spatial query); dead index
  param in GetNextTargetFromTowerTargetQueue (always queue[0]); GetCostTrees
  cylinder = (2×range, 100×range); SetUnityObject(tower.handle,…) type fix;
  RandomCautionDirection pitch from TowerBase.cautionRotateAngleMin @0x178 +
  correct tilt-axis construction + zero both rotate speeds.
- Fixed GameCoreWaveManager.cs + GameCoreHome.cs AddListener calls to 2-arg
  (EventTime) — CoreEventShim has no 1-arg overload. WaveManager binary uses
  EventTime.Immediate (0) for all 5 listeners; Tower ctor uses PostGameCoreTick (1).
- STILL MISSING (projectile lane tail + interactions): GameCoreProjectileGaseous
  (1,157 ln), GameCoreProjectileInsect (1,373), GameCoreProjectileGem (142),
  GameCoreCharacterTemplate (78), GameCoreShop (197), GameCoreInteractionObject
  (854), Q4 view commands + GameCore.Network command classes.

## COMMAND LAYER — reconstructed directly (main session)
- Exported the missing GameCore.Network namespace from Ghidra (new script
  decomp/ghidra_scripts/ExportNetCmd.java; 128 funcs / 38 classes / 0 failures
  → decomp/decompiled/GameCore.Network.*.c). The original export had skipped
  everything containing "Network" — but these are the SINGLE-PLAYER command
  pattern classes (Q4.GameCoreBridge.OnGameCoreTicked executes them via the
  NullNetworkLayer loopback), so they are in scope.
- Wrote 19 files in decomp/src/GameCore/Network/:
  NetworkCommand (abstract base, slot 4 ExecuteCommand),
  BuildTowerCommand (DatabaseManager.TowerDatabase lookup → singleton check →
    coin/gem affordability via HasInventory → TowerHelper.FromTreeToTower →
    towerBuildEvent → RemoveInventory×2),
  SellTowerCommand (tower.DestroySelf → towerSellEvent(tower,player,coin,gem) →
    release retained trees via GameCoreTree.Revive),
  UpgradeTowerCommand (level-match guard → GrantEXP top-up to reachExp →
    charge upgrade costs),
  TowerRotateCommand (manual aim: fortDirection = Euler(x,y,0)*forward),
  TowerAttackComamnd [sic — original typo] (forced single shot:
    SetTowerState(new TowerStateAttack(0,0,true))),
  TowerXPCommand (dance EXP funnel → tower.GrantEXP(xp, player)),
  PickupFruitCommand (free fruit → fruitPickedUpEvent; owned-by-other or
    vanished fruit → force player VIEW reset: Motor.DropFruit +
    TikimanStateMachine.ForceCurrentCommand(Idle)),
  DropFruitCommand (identity-check vs player.HeldFruit → fruitDroppedEvent
    with force vector),
  DetonateFruitCommand (FAITHFUL FINDING: ctor AND ExecuteCommand are EMPTY in
    the shipped binary — vestigial placeholder),
  EnterLeaveTowerCommand (guarded seat enter/leave via HasPlayerInTower +
    PlayerEnterTower/PlayerExitTower),
  AddInventoryCommand (view-side currency credit → inventory.AddInventory),
  BusyCommand (busyEvent(handle,isBusy)),
  IntroSequenceSkipCommand (introSequenceFinishedEvent(player)),
  TriggerInteractionCommand (triggerInterationEvent(player, m_gco) [sic]),
  SignCommand (signEvent(handle, category, icon)),
  HipAttackEnemyCommand (DamageByAttributes(view.strengthType, view.classType,
    enemy, power) → enemy.DealPlayerDamage(player, dmg, 0, oneKickOneBalloon);
    then ALWAYS arms the loose-coin spill via player.DropPickup(1, coins,coins,
    gems,gems, valuePerCoin, valuePerGem) — the "stomping drops your money"
    mechanic),
  SpawnFruitCommand (ClothingUnlockData.fruitDefinitions.GetDefinition(index);
    PayFruitCost coin+gem; Q4.PickupManager.CreateFruit wrapped in
    Random.state save/restore to protect the sim RNG stream; SHOP spawners
    instantly fire fruitPickedUpEvent + refresh ShopMainController for local
    player),
  AddLocalPlayerCommand (max playerId+1 → PlayerManager.JoinPlayer(PlayerInfo,
    zero, identity) → view.CreateGameCoreObject() → StageTransferInfo
    customization carry-over [transfer accessors marked INFERRED/TODO]).
- Also reconstructed this session: GameCoreShop.cs (position-matched viewer
  relink; collision 0.5/0.5), GameCoreCharacterTemplate.cs (QuatPos anchor +
  prefab instantiate + bridge map; empty Tick), GameCoreProjectileGem.cs
  (deploy projectile: Tick → source tower gets TowerStateUpgradeAround(10000,
  expBoost, dropGem, interval, sinkTime, maxLife, gemDelay) → DestroySelf).
- All state-duration literals confirmed 10000.0f from .rodata; vtable slots
  resolved via 16-byte entries + 17-slot interface shift (verified against
  IDamageable slot numbers in the landed interface file).

## REMAINING (next session)
- GameCore.Network: GameCoreNetworkBridge (1,726 ln — the frame pump the landed
  Q4/GameCoreBridge.cs calls: GameCoreMustWait/CheckForNextNetworkFrame/
  AddPlayerCommand/OnGameCoreTicked + NetworkDataBlob* structs),
  RemoveLocalPlayerCommand (338), Debug* commands ×5 (low priority),
  CommandBuffEffect (521) / CommandSoundEffect (949) (presentation commands).
- GameCore sim: GameCoreProjectileGaseous (1,157), GameCoreProjectileInsect
  (1,373 — hive swarm FSM), GameCoreInteractionObject (854).
- Q4 view commands: PlayerCommand, CommandMove/Attack/Jump/Trampoline/SignMenu
  (the pose-sampling side of the seam).
- THEN: full integration compile (/tmp/opencode/intcheck harness rebuild — see
  _INTEGRATION_NOTES.md), k__BackingField-class bug sweep, and the minimal
  headless play-through harness (stage 1 wave tables from decomp/data).
- FIX: Events.cs referenced unqualified BuffSetting + TowerUpgrade (both live
  in Q4 namespace) → qualified as Q4.BuffSetting / Q4.TowerUpgrade. Confirmed
  via dump.cs TypeDefIndex (BuffSetting 2669, TowerUpgrade 3420, both Q4).
- Resolved 4 INFERRED rodata constants in GameCoreWaveManager.cs directly from
  the ELF (see decomp/src/GameCore/_RODATA_CONSTANTS_NOTES.md): 0xB7C47C=0.0,
  0xB7C480=1.0, 0xB7C484=Deg2Rad(0.01745329), 0xB7C488=0.0. To apply once
  wave/tower agent settles (avoid clobbering its file).

## Integration pass 1 (mid-flight snapshot — see decomp/src/_INTEGRATION_NOTES.md)
- Ran a full-tree compile harness (/tmp/opencode/intcheck) over landed src.
- CONFIRMED BUG (blocks all builds): GameCoreWaveManager.cs declares
  `private bool <introSequenceFinished>k__BackingField;` — the IL2CPP
  compiler-generated name is NOT valid C#. Skeleton/dump confirm it is an
  auto-property `public bool introSequenceFinished { get; private set; }`
  (backing field 0xB4, private setter). Fix when wave/tower agent completes
  (it owns the file — not editing mid-flight).
- Mapped the external (out-of-scope) Q4/engine surface the landed sim references
  (WaveManager/WaveResource/WaveData/SpawnData/DifficultySettings.Difficulty/
  PathEdit/CatmullCurve/Animator/Behaviour/etc.) — listed in integration notes
  for the stub layer.
- Sim-layer full compile is PREMATURE: GameCoreEnemy.cs (landed) calls members on
  GameCoreTower/Home/Fruit/Projectile that the still-running wave/tower agent
  hasn't landed. Full integration compile deferred until all agents complete.
- GameData layer re-verified standalone: DATA_LAYER_OK, 1873/1873 resolve.
- ENEMY/AI agent COMPLETE: 13 files (~3,150 lines) — GameCoreEnemy (82 methods),
  GameCoreEnemyAttackPoint, AIHelper(+BlockingInfo/TerrainInfo/
  TerrainOrientationInterpolator/ETerrainDetectRaycast), DamageHelper (37
  strength/class overloads), EnemyDetectorCone/Sphere, CorePathMove, EnemyHitInfo,
  AIDebugHelper, IDamageable/ISpeedScale/IEnemyDetector, EnemyEnums. All Roslyn-
  parse clean; float constants from .rodata; enemy AI flow (spawn→Tick→walk/
  attack/wait→avoidance→terrain-snap→boss AI→balloon pop→drown→death) documented.
- CROSS-SESSION ENUM CONSISTENCY VERIFIED: the shared enums reconstructed
  independently in GameData/GameDataEnums.cs (from dump.cs) and GameCore/
  EnemyEnums.cs (from skeleton) MATCH EXACTLY — EEnemyDef (49 members),
  ESpawnMode, EBossType, EEnemyMode, EEnemyMoveTypeDef, EEnemyStrengthTypeDef,
  EEnemyClassTypeDef. Data layer ↔ sim layer agree on canonical IDs.
  NOTE: EnemyEnums.cs declares these in the Q4 namespace (faithful to original);
  GameDataEnums.cs declares parallel copies in GameData namespace (data layer).
  Integration stubs must NOT also define Q4.EEnemy* (would duplicate EnemyEnums).

## Scope guards
- Single-player only. SKIP: Q4.Networking, Steamworks, UnityNpToolkit2,
  AnalyticsManager, LocalMultiplayer/Multiplay*, NetworkScene.
- Output = source only; art/sound/levels loaded from user's copy, never copied in.
- No third-party decompilation/source port/leaked source used.

## Verification constraint
No mature PS4 emulator + headless host → cannot run original side-by-side here.
Static verification + user-captured PS4 footage; Unity-PC rebuild could run under
virtual framebuffer for rebuild-only behavioral checks.

# WEBGL PORT (TypeScript + Three.js + Rapier-WASM) — loop_b9ls1
Goal (user-locked): the game running IN A BROWSER with the SAME game logic and
graphics as the original, 60fps+ on desktop Chrome, multi-device. Plan: Three.js
renderer; Rapier-WASM as STATIC-collider query engine only (sim broadphase =
ported GameCoreCollisionManager grid); headless-first sim port; all writes
ONLY under /srv/opencode/ps3-pixeljunk-monsters2 (scratch → pjm2-web/.work/).
Source of truth: decomp/src (C# reconstruction) + decomp/data (verified tables).
Fidelity pillars: float32-exact math (Math.fround discipline) + UnityEngine.Random
Xorshift128 clone with per-tick InitState(updateCount) + pinned Rapier WASM.

## Phase status board (loop reads this)
- [x] Scaffold pjm2-web (package.json/tsconfig/vitest/vite/README; npm install OK:
      three 0.169, @dimforge/rapier3d-compat 0.14.0, vitest, tsx)
- [x] PHASE 0 SPIKES — ALL COMPLETE (iter 6):
  * ENGINE math/rng — MAIN-SESSION TAKEOVER (original agent produced no files in
    ~1h; if its output ever lands, MERGE BY COMPARISON, do not clobber):
    src/engine/math/{Mathf,Vector2,Vector3,Quaternion,index}.ts — strict fround
    discipline; Euler ZXY formula verified by composition test; LookRotation =
    Unity's sqrt-branch algorithm; eulerAngles MakePositive w/ epsilon guards;
    roundToInt = BANKER'S rounding (C# Math.Round ToEven — affects wave interest).
    src/engine/rng/UnityRandom.ts — Xorshift128 + MT19937 InitState scramble
    (x=seed; y=imul(1812433253,x)+1; …). VERIFIED vs published golden vectors
    from real Unity 4.7–2020.1 testing: InitState(1234) state =
    {1234, 3159640283, 3392860520, 3460949513}; 20-draw int sequences across
    4 span orientations EXACT; Range(min,min) consumes no state EXACT;
    value/Range(float) near-parity (±1ulp — Unity's native float path is
    documented "slightly different"; optional stretch: disassemble
    Random::RandomRange in eboot.elf). Int paths are what wave/spawn logic uses.
  * ASSETS — agent COMPLETE, verdict FEASIBLE (tools/assets/SPIKE_REPORT.md):
    extract_character.py: 7 s/enemy; kuri GLB 3,367 verts/28 joints/IBMs ✓;
    4×2048² PNG (BC1/BC3, no GNF issue; albedo LINEAR → sRGB note; normal map
    grayscale); 20 anim clips, 35,938 keyframes, 0 unresolved CRC32 bindings,
    57 FootPlant events; audio = FSB5 (Unity ADPCM ×81 + Vorbis BGM ×21)
    decoded out-of-the-box via fmod_toolkit → WAV proven. Logic prefab →
    PrefabLoader.prefabList[0] → visual prefab indirection documented.
    Extrapolation: 57 enemies ≈7 min, 21 towers ≈5 min; **17 STAGES = the risk
    area** (1.17 GB, 137k objects → dedicated static-scene extractor phase).
    Phase-2 recs: KTX2 repack, 30 Hz anim bake (cubic slopes dropped in spike),
    stage pipeline, particle exporter, audio repack to OGG/Opus.
  * PHYSICS — agent landed src/engine/physics/{index,mathx,queries,world}.ts +
    tests/physics/{extract,parity,spherecast,world}.test.ts — ALL GREEN inside
    the 84-test suite (stage-001: 633 colliders, TerrainMask from Layers
    singleton, linecast ground-snap parity vs extracted walk paths).
  * RENDER/toolchain — verified iter 4 (Vite build + tick-seam bootstrap page).
- [~] PHASE 1 headless sim port — UNBLOCKED (engine landed). DONE so far:
      * src/data/{enums,types,loader}.ts — port of GameData C# layer; test
        re-verifies the real tables: 57/21/17/4/7, stage-1 shape (wave1 17×kuri
        over 3 ground paths, wave15 boss_kao_00), **1873/1873 spawns resolve**;
        loader improvement over C#: classDamageInfos now populated too.
      * src/core/event/{EventTime,CoreEvent,CoreEventBase-in-CoreEvent}.ts —
        full event machinery port: Immediate dispatch + eventData cursor
        replay (PostGameCoreTick = only-new; PostUnityUpdate = all-then-clear),
        no-payload invoke counters, queued add/remove during dispatch,
        ListenerSorter parity (sim-handle listeners first by handle id).
        Documented TS divergence: non-sim listener order = registration order
        (C# used delegate hash — deterministic in-run but not portable;
        registration order is deterministic across runs/browsers).
      * @types/node added (dev).
      * src/core/CoreObjectPool.ts — per-ctor pools (identity-preserving recycle
        = behaviorally significant), GetUninitializedObject parity via
        Object.create, deepCopy via per-class static deepCopyFields registries
        (TS stand-in for [DeepCopyAttribute]; dev/resync-only path — normal SP
        tick never deep-copies, per lifecycle reconstruction).
      * src/core/GameCoreHandle.ts — full handle port: s_nextHandle/s_cacheTag
        statics, CreateHandle/nullHandle/isNull, ResetNextHandleIndex wrap
        (>100000 → −1000000), EnsureNextHandleIsGreaterThan, tag-gated
        GetMostRecentObjectVersion + GetUnityObject caches, ToString format.
        Documented adaptations: class (not struct), frame/viewer resolver hooks
        (setFrameResolver/setViewerResolver) until GameCore/bridge ports land.
        FAITHFUL QUIRK encoded in tests: the viewer cache never bumps
        m_cacheTag, so it only hits after an object resolution primes the tag.
      * tests: tests/core/pool-handle.test.ts (16) — suite total 32/32 green,
        tsc clean for src/{core,data} + tests/core.
      * src/core/Cylinder.ts (fp32-exact; fromBounds via structural BoundsLike —
        no engine/math dep; Lerp(min,max,0.2) formula inlined, to be switched
        to Mathf when math lands) + src/core/CurrencyValueInfo.ts +
        src/main/headless-stage1.ts (documented placeholder runner).
        Suite: 36/36 green.
      NEXT (UNBLOCKED — engine landed): GameCoreObject → GameCoreFrame →
      GameCoreCollisionManager grid → GameCore (tick root) → DamageHelper →
      Buffs → Enemy(+CorePathMove/AIHelper/detectors) → Home/Tree/Fruit/
      Pickups/Inventory → Tower+FSM+TowerHelper → Projectiles → WaveManager →
      Commands (port the 19 decomp/src/GameCore/Network C# files) → driver.
      Full suite at iter-6 end: **84/84 green (9 files), tsc clean** (npm run check).
- [x] CORE SPINE PORTED (iter 7): src/core/{GameCoreObject,GameCoreFrame,
      GameCoreCollisionManager,GameCore,typechain,extensions}.ts +
      src/engine/math/Bounds.ts. Faithful ports with documented TS adaptations:
      instance-provider hook for GameCore.Instance (C#: bridge indirection),
      setFrameResolver for handles, tick(deltaTime) param (C#: Time.deltaTime),
      ctor-passed type keys for typed queries (C#: typeof(T)), bounds-provider
      hook for collision Init (C#: FindObjectsOfType<Collider> → fed from the
      stage-collider JSON), rebucket-type registry (C#: hardcoded Tower loop).
      Grid narrow-phase (XZ radius + vertical overlap), swap-back purges,
      tick-order + added-during-tick semantics all per C#. tests/core/
      spine.test.ts: 17 integration tests (registration, purge, snapshot,
      typed hierarchy queries, clamp 0.5, dedup, re-bucket, event seam).
- [x] ENGINE MERGE (iter 7): the original engine agent's implementation landed
      mid-iteration and was ADOPTED per the merge policy (stronger evidence:
      UnityPlayer.dll Ghidra decompile, exhaustive fp32 verification,
      andanteyk RngLab references; PascalCase API: Mathf.Clamp/Lerp/RoundToInt
      (banker's), Vector3 instance add/sub/mulScalar + static Dot/Cross/
      Distance/Angle/Reflect/Lerp/MoveTowards, Quaternion.Euler/AngleAxis/
      LookRotation/MultiplyVector/Slerp/eulerAngles with Unity's
      Internal_ToEulerRad+MakePositive naming, UnityRandom.InitState/Next/
      value/Range/RangeInt/state). All consumers (spine, Bounds, tests)
      adapted. My iter-6 GOLDEN VECTOR tests (published real-Unity values)
      now independently VERIFY the agent's RNG: all pass, including the exact
      20-draw int sequences and InitState(1234) MT-scramble.
      Agent's float `value` = (w & 0x7FFFFF)·fround(1/8388607); Range(float) =
      (1−t)·max + t·min (decompiled order). Two of the agent's own test
      tolerances were test bugs, fixed: acos fp32 conditioning near |dot|≈1,
      and the Euler grid including Unity's gimbal-singular band (|test|>0.9999
      folds pitch to exactly ±90 — REAL Unity doesn't round-trip there either;
      now pinned by a dedicated gimbal-fold parity test).
- [!] STAGE-1 MAPPING — RESOLVED (iter 8): scene-level attribution run over the
      stages bundle (decomp/data/stage_scene_attribution.json, generator inline
      in loop log): StageMain+WaveResource joined BY SOURCE SCENE FILE, not list
      order. TRUE FIRST LEVEL = scene 3d_stage_001 = (tl_area_001, tl_stage_001),
      **initCoin=450, 10 waves, wave1=10×kuri_00_001, finale boss_bero_00**
      (= stage_waves_resolved idx 12). The 15-wave/400-coin/boss_kao record is
      the SECOND area's opener (3d_stage_004 = tl_area_002/tl_stage_001); the
      99999-coin/20-wave record is a dev/test config (duplicate env file, 17
      StageMains vs 16 scenes). data.test.ts now selects stage 1 via the
      attribution table and pins both decoys as regression tests. Headless
      milestone MUST use the attribution-selected record.
- [x] ENGINE agent completion report received (iter 8): implementation
      bit-exact vs 80 published real-Unity outputs + UnityPlayer.dll Ghidra
      decompile; InitState MT19937 scramble confirmed 3 ways; value =
      (w&0x7FFFFF)·fround(1/8388607) ∈ [0,1] both-ends-inclusive; Range(float)
      = (1−t)·max + t·min; RangeInt biased-modulo with no-consume on min==max.
      Unverified residuals documented for eboot.elf pass (gimbal threshold
      0.4995, ±1-ULP groupings, FTZ epsilon, libm ulps). Merge with main-session
      adaptations confirmed clean by both sides.
- Suite at iter-8 end: **182/182 green (12 files), tsc clean**.
- [x] EVENTS HUB PORTED (iter 9): src/core/Events.ts — all **58 static events**
      with original static-block offsets; payload shapes from metadata
      (TypeDefIndex 2914..2971). TS ADAPTATION: payloads referencing not-yet-
      ported classes are `unknown` aliases (documented per-alias with the
      original C# type) — tighten one line per type as modules land.
      + src/view/q4-contracts.ts (StageMain/NetworkMatch/DebugMenuCanvas
      structural contracts + provider hooks, per convention §8; SP
      NetworkMatch.isNetworkMatch = false constant).
      + src/core/NetworkLog.ts (null-instance default matches SP; opt-in
      collecting instance for the Phase-5 replay-hash harness).
      + tests/core/events.test.ts (5 events exercised incl. 4-payload
      onAddInventory, PostGameCoreTick flush through the hub).
      Suite at iter-9 end: **187/187 green (13 files), tsc clean**.
      NEXT: GameCorePlayer (26 methods — gate for Inventory/Commands) →
      GameCoreInventory (interest math uses verified banker's RoundToInt) →
      DamageHelper → Buffs → Enemy(+CorePathMove/AIHelper/detectors) →
      Home/Tree/Fruit/Pickups → Tower+FSM+TowerHelper → Projectiles →
      WaveManager → Commands → driver → headless stage-1 milestone.
- [x] BUFF FOUNDATION PORTED (iter 10): src/core/enums.ts (sim-side Q4 enums —
      EEnemyDef 48-roster, ETowerDef incl. 'moter' [sic], type/mode/spawn/boss
      enums; values verified identical to data-layer copies),
      src/core/interfaces.ts (IBuffs/IGrabbable/ISpeedScale/IDamageable with
      slot comments; progressive typing — TIGHTEN markers where GameCoreTower/
      Enemy/Player types land later; C# out-params → result objects),
      src/core/Buff.ts (m_timeRemain public w/ @internal note — binary accesses
      it cross-class; removeBuffEvent passes constructor as System.Type
      stand-in; PlaySFX/StopSFX via MonstersAudio contract hook, headless
      no-op), src/core/BuffContainer.ts (handle-based storage; getAllBuffs
      KEEPS nulls faithful; removeBuffs EXACT-type match via constructor ===,
      exception-buff skip, no-advance-on-remove; tick increment-BEFORE-execute
      quirk), src/core/BuffSettingOverrideFreeze.ts (+IBuffSettingOverride).
      q4-contracts.ts += MonstersAudio/AudioSource contracts + provider.
      tests/core/buffs.test.ts: 11 tests incl. the mid-tick RemoveBuffs
      traversal quirk (freeze-supersedes-slow pattern).
      Suite at iter-10 end: **198/198 green (14 files), tsc clean**.
      NEXT (iter 11): GameCorePlayer (364 ln C#) → GameCoreInventory →
      buff subclasses (Bomb/Burn/Freeze/Slow/Flare/Trampoline/FastPlayer) →
      DamageHelper → GameCorePickup family → GameCoreEnemy (+AI) → ...
- [x] PLAYER + INVENTORY + TREE PORTED (iter 11):
      src/core/GameCorePlayer.ts — FULL port (364 ln C#; @0x4B91F0,
      @0x4BDE50, 0x4C1280..0x4C30B0): forward derivation (0.001 threshold),
      CheckForPickups with the FAITHFUL range² quirk (distance vs
      detectionRange²), CheckForHiddenTreePickups (indexed +
      DirectlySetPickupDataIndex=2000 paths via StageHub/NatureTree/
      HiddenTreePickup contracts; index resets even on null data),
      DropPickup/ProcessDropPickup loose-coin scheduling (wave multiplier on
      coins only, clamped losses removed as NOT spent, valuePer* reset-to-0
      + delay-not-reset quirks), fruit carry via fruitPickedUp/Dropped
      listeners (cross-class m_playerOwner/m_lastPlayerOwner writes +
      isHeldFruitError getter side effect), IsLocalPlayer/GetPlayer/
      GetPlayerCount/GetLocalPlayer statics, RecreateViewer (playerID match,
      faithful NRE path), DestroySelf teardown + playerRemovedEvent.
      src/core/GameCoreInventory.ts — FULL port (252 ln C#): EInventoryType
      (3044) + lazy InventoryBag (3045), singleton getInventoryObject seeded
      from StageMain, SP shared bag under client key 0 (lazy-seeds late
      joiners), spent stats incl. any-non-Coin→SpentGems + full-amount-not-
      clamped-delta quirks, wave interest = banker's RoundToInt(coins×rate)−
      coins with HashSet bag dedup on the PostGameCoreTick replay,
      GetEndOfGameStatistics both overloads (out-params → result object),
      NetworkLog null-safe.
      src/core/GameCoreTree.ts — FULL port (127 ln C#; .rodata constants
      0.15/2.0/1.0): breakdown/revive referenceCount + structureBreak/
      treeRevive events, RecreateViewer scene scan (1.0 threshold) +
      active-flag sync.
      SKELETONS (prominently marked; replaced wholesale at their iteration):
      GameCorePickup.ts (abstract, full 0x60-0x98 field block + getters),
      GameCoreFruit.ts (owner handles 0xC0/0xE0 + IGrabbable no-op slots),
      GameCoreWaveManager.ts (waveCurrentIndex @0x4C2AF0).
      q4-contracts.ts += StageHub/PickupManager/HiddenPickupData, NatureTree+
      HiddenTreePickup+allTreesInScene hook, Player view+finder hook,
      NetworkMatch instance hook, GameObject/Vector3Like.
      Events.ts TIGHTENED: Player/Fruit/Pickup/WaveManager/Tree/Inventory/
      EInventoryType aliases → real types (type-only imports, no cycles).
      interfaces.ts IGrabbable TIGHTENED → GameCorePlayer.
      CoreEvent machinery += test-only resets (resetAllEventsForTests &
      friends) — stale sim-object listeners + handle-id reuse had
      cross-contaminated in-file tests (found by the new suites).
      tests/core/{player,inventory,tree}.test.ts: 36 new tests incl. the
      banker's canaries f(100×f(1.025))→102 / f(100×f(1.005))→100, interest
      dedup on the shared bag, drop-scheduling clamps, fruit error-getter.
      Suite at iter-11 end: **234/234 green (17 files), tsc clean**.
      NEXT (iter 12): buff subclasses (Bomb/Burn/Freeze/Slow/Flare/
      Trampoline/FastPlayer) → DamageHelper → Pickup family (full Pickup +
      Currency) → GameCoreEnemy (+CorePathMove/AIHelper/detectors/
      EnemyHitInfo) → Home + Fruit(full) → Tower+FSM+TowerHelper →
      Projectiles → WaveManager(full) → 19 commands → driver →
      `npm run sim:stage1` headless milestone.
- [x] BUFF SUBCLASSES + DAMAGEHELPER PORTED (iter 12):
      src/core/DamageHelper.ts — FULL static port (452 ln C#,
      @0x93D4C0..0x9443E0): table/target/settings overload sets collapsed to
      runtime-dispatched TS overloads (Array.isArray / instanceof
      GameCoreObject); damage/reaction rate lookups (first-match, default
      1.0), DamageBy*/RateByAttributes, strong/weak type lists, max-combo
      DamageStrongToEnemy/ReactionStrongToEnemy; BOTH original spellings kept
      (reactionStrongToEnemybyClass [sic] table vs ...ByClass target).
      GetEnemyOnHitSound @0x9443E0 DEFERRED (pure AudioClip selection via
      EnemyBase/TowerBase/GlobalSounds → Phase-4 audio contracts) — documented
      in-file.
      All 7 buff subclasses: BuffBomb (m_power WRITE-BACK quirk — re-execute
      compounds scaling; typed DealDamage), BuffBurn (timer cadence off
      TickDeltaTime; tower typing via projectile→sourceTower chain; on-fire
      enemies take a 0-damage tick — call still made), BuffSlow (applies only
      while scale ≤ current; RemoveBuffs<BuffSlow> self-excepting),
      BuffFastPlayer (fastest-effect-wins inverse guard; exit restores 1.0),
      BuffFreeze (1s cadence; extinguishes fire via the IsOnFire setter →
      onFireExtinguished; UNTYPED DealDamage with projectile as source; final
      partial tick Clamp01(1−timer)×power on exit; supersedes slows AND other
      freezes), BuffFlare + BuffTrampoline (pure timed markers — empty
      ExecuteBuff confirmed, settings ignored; ctor param orders differ,
      faithful).
      src/core/EnemyHitInfo.ts — full port (struct→class, 7 fields + ctor).
      SKELETONS (marked): GameCoreEnemy.ts (IsOnFire property with the
      FAITHFUL true→false onFireExtinguished setter side effect; ISpeedScale +
      IBuffs surface; IDamageable slots 2/3 as no-op stubs),
      GameCoreProjectile.ts (sourceTower 0x60), GameCoreTower.ts
      (strengthType 0x64 / classType 0x68).
      q4-contracts.ts += BuffSetting{Bomb,Slow,FastPlayer,Flare,Trampoline}
      contracts, StrengthDamageInfo/ClassDamageInfo/EnemyAttributesSettings/
      EnemyView contracts. interfaces.ts += asSpeedScale/asBuffs duck-typed
      helpers (TS ADAPTATION of C# `as` interface casts).
      Events.ts TIGHTENED: EnemyHitInfo alias → real type.
      tests/core/damage-helper.test.ts + buff-subclasses.test.ts: 35 new
      tests. FINDINGS pinned: (1) removeBuffs EXACT-ctor matching means test
      spies must not subclass (vi.spyOn instead); (2) emergent faithful
      behavior — the FIRST slow's re-execution eats later slows (container
      order), so a new slow never overrides an old one; freeze still
      supersedes both directions correctly (0.5 ≤ 0.6 applies; 0.6 ≤ 0.5
      inert).
      Suite at iter-12 end: **269/269 green (19 files), tsc clean**.
      NEXT (iter 13): Pickup family (full GameCorePickup 187 ln +
      GameCorePickupCurrency + GameCorePickupManager if present) → Home →
      GameCoreEnemy (full, ~1500 ln — biggest single module; CorePathMove +
      AIHelper + detectors + EnemyHitInfo consumers) → Fruit(full) →
      Tower+FSM+TowerHelper → Projectiles → WaveManager(full) → 19 commands →
      driver → `npm run sim:stage1`.
- [x] PICKUP FAMILY PORTED + AUDIO PIPELINE DONE (iter 13):
      User authorized +2 agents → dispatched 2 background lanes (data
      extraction; audio scale). AUDIO LANE COMPLETE: 269 unique clips
      (443 occurrences, 174 dupes merged by sha256) decoded from 14 FSB5
      archives → WAV 16-bit (ffmpeg absent; ogg transcode command documented),
      404 MB under tools/assets/audio-out/{sfx,bgm}/ + manifest.json +
      inventory.json; **113/113 Q4.GlobalSounds properties mapped** (high
      confidence, serialized GlobalSounds MonoBehaviour + 10 PPtrs resolved);
      scripts audio_pipeline.py / map_globalsounds.py + AUDIO_PIPELINE_REPORT.md.
      DATA LANE COMPLETE + INCORPORATED (same iter): AISettings verified
      (globalsettings bundle, AISettings.asset pid −2994841570289042843):
      **pickupWaterKillTime = 5.0** (serialized overrides ctor default 2.0),
      overtakeSlowerEnemies/enableEnemyBlocking = true →
      decomp/data/globalsettings_AISettings.json + getAISettings() now
      defaults to the verified values (provider still overrides).
      Stage-1 currency prefabs verified (props bundle; spawn chain
      PickupManager.CreateCurrency → GlobalResources.debugCoin/GemPrefab):
      coin prop_001 value=20 detectRange=1.8 detectDelay=1.5 lifespan=42.9
      force 4–5.5 angle 17.8 accel 12 bounce 0.3/−1; gem prop_002 value=1
      range=2.4 delay=0.5 lifespan=57.2 force 5–7.5 angle 30 accel 10;
      serialized m_LocalAABB captured (runtime Mesh.bounds source) →
      src/data/pickupPrefabs.ts (COIN_PREFAB/GEM_PREFAB/STAGE1_PICKUP_MANAGER
      — maxFruits 3, hiddenFruitData EMPTY, coinPerValueOverride 20 /
      WATER_SOUND_CLIPS: itemDieInWater→sfx_item_disintegrate,
      itemLostInWater→sfx_item_splash). 2 new tests pin the records through
      the sim ctor. Outputs: decomp/data/pickup_prefabs.json +
      tools/data/EXTRACTION_REPORT.md + extract_pickup_data.py.
      src/core/physics-seam.ts — SimPhysics interface (structurally satisfied
      by engine PhysicsQueries/Rapier), setSimPhysics/getSimPhysics (THROWS
      when unregistered — explicit > silently wrong), Q4Layers masks
      (terrainMask −536870912 / waterMask 16 etc., cross-verified vs the
      decompiled Q4.Layers ctor + extraction q4Layers dump), UNITY_GRAVITY.
      src/core/GameCorePickup.ts — FULL port (replaces skeleton): prefab→
      viewer factory + bridge registry wiring, launch RNG (force/axis.x/axis.z
      draw order pinned), scatter-cone AngleAxis, lifespan from
      PickupLifeCycle, bounds-collision via Cylinder.fromBounds, the
      FAITHFUL meshless-viewer quirk (type/events/collision skipped),
      dead ground-probe computation documented (@0x4BF66A), water kill
      (CheckSphere WaterMask + AISettings.PickupWaterKillTime + SFX hooks),
      stageCleared/gameOver subscriptions, pickupLostEvent expiry.
      **NEW VERIFIED QUIRK** (raw disasm @0x4BFBE0): below-world (y<−20)
      resets the lifespan FIELD to 0.1 each tick but counts down a fresh
      LOCAL 0.1 → never expires at normal dt; only TickDeltaTime ≥ 0.1 frames
      kill it. C# reconstruction note + TS port + test all updated.
      src/core/GameCorePickupCurrency.ts — FULL port: value fallback +
      difficulty scaling (gems too — faithful), ballistic bounce
      (gravity/SphereCast/Reflect, factor=1−Dot(n,dir), bounceTime −1
      unlimited / 0→rate-0-but-wraps-to−1 quirks, rest < 0.5), detection-delay
      gate, immortal-while-carried, SuckToPlayer (accel toward
      player+attractOffset, arrival → pickupAcquiredEvent + coin credit;
      GEMS NOT CREDITED quirk; faithful NRE on destroyed player),
      OnGameOver deactivation, RecreateViewer prefab-name fallback.
      src/core/GameCorePickupManager.ts — FULL port: fruit-drop schedule walk
      (elapsed timer, maxFruitsOnGround saturation resets timer, RNG tree
      choice via RangeInt, stale-handle do/while skip, CreateFruit through
      StageHub contract, FindObjectOfType fallback).
      q4-contracts.ts += PickupPrefab/Viewer/Movement(concrete)/LifeCycle/
      MeshFilter contracts + headless default viewer factory (derives from
      prefab data; browser registers Three.js factory), Unity-object registry
      (= bridge SetUnityObject/GetUnityObject map), AISettings provider
      (throws until verified data lands), DifficultySettings provider (SP
      default Max(1,v) — data-verified rates 1.0), PickupManager fruit-side
      members (optional), MonstersAudio.playSFX, FindObjectOfType hook.
      tests/core/pickups.test.ts: 31 new tests (fake Rapier seam; behavioral
      assertions for private fields). player.test.ts TestPickup adapted to
      the full base ctor.
      Suite at iter-13 end: **302/302 green (20 files), tsc clean**.
      NEXT (iter 14): GameCoreHome (435 ln) → GameCoreEnemy (full, ~1500 ln —
      split across iterations if needed; CorePathMove + AIHelper + detectors;
      AISettings overtake/blocking values now verified) → Fruit(full) →
      Tower+FSM+TowerHelper → Projectiles → WaveManager(full) → 19 commands →
      driver → `npm run sim:stage1`.
- [x] GAMECOREHOME PORTED + ENEMY ATTACK LOOP LIVE (iter 14):
      src/core/GameCoreHome.ts — FULL port (435 ln C#, TypeDefIndex 3040,
      @0x4BA2A0..0x4BBC60) + exported ChibiData (nested 3041): chibi spawn
      (polar RNG with the FAITHFUL negative-half-arc quirk, draw order
      angle→dist, ground-snap Linecast y-only), SpreadOutChibi (attack-pos
      sort + ≤9 relaxation passes, zero-push degenerate overlap case),
      EnemyAttackDistance = PLAYER range + 0.2 quirk, Tick attack loop,
      DealDamage formation-shift (descending pose copy) + gameOverEvent on
      empty pool (debug disableGameOver suppression), wave-end chibi
      recording, guarded DestroySelf, RecreateViewer finder fallback.
      GameCoreEnemy skeleton += FULLY PORTED CanAttack @0x4AEC90 (first-access
      chibiAvoidanceZone announcement via Q4.UnityEvents hook + latch),
      IsBoss @0x4AEE60, Attack @0x4B4A20 (events + boss attackFreq delay) —
      the home-attack loop now runs end-to-end headless.
      physics-seam SimPhysics += linecast. q4-contracts += HomeView/
      ChibiHomeZone contracts, FindObjectsOfType<Q4.Home> hook,
      Object.Destroy hook, UnityEvents.chibiAvoidanceZone notifier.
      Events.ts TIGHTENED: GameCoreHome + ChibiData aliases.
      **TWO VERIFIED FIDELITY FINDINGS** (raw disasm):
      (1) Home's height-0 query (raw Tick @0x4BA9D0) + the grid's
      `(h_obj+h_query)*0.5 <= |Δy + h_obj*0.5|` filter (raw MoveNext
      @0x770030, `<=` CONFIRMED) → only objects strictly BELOW the home's
      position y are returned; same-y objects are excluded at the boundary.
      The scene home sits elevated; attackers approach from below. C# recon
      + TS port + tests document this — critical for stage-1 driver placement.
      (2) The chibi sort comparator never returns 0 (inconsistent for ties;
      .NET introsort tie order implementation-defined) → TS ADAPTATION:
      deterministic id tie-break (distinct-distance ordering identical).
      tests/core/home.test.ts: 19 new tests (spawn determinism across seeds,
      half-arc bounds, ground snap, spread relaxation to 0.4, attack loop
      events + victim flag, delay gate + one-shot announcement, straggler
      cleanup w/ boss exemption, boss freq gate, formation shift, game-over
      suppression, wave recording, guarded destroy, viewer fallback).
      Suite at iter-14 end: **321/321 green (21 files), tsc clean**.
      NEXT (iter 15): GameCoreEnemy full port — start with the helper modules
      (CorePathMove, AIHelper, EnemyDetectorCone/Sphere,
      GameCoreEnemyAttackPoint) then the enemy body (AI modes, movement,
      damage/death, balloons, drown, boss) across iterations → Fruit(full) →
      Tower+FSM+TowerHelper → Projectiles → WaveManager(full) → 19 commands →
      driver → `npm run sim:stage1`.
- [x] ENEMY HELPERS PORTED (iter 15 / demo-loop loop_0aq6v iter 1):
      User invoked /loop "continue until theres a playable demo" → created
      loop_0aq6v (dynamic) complementing loop_b9ls1: same board/conventions,
      stops at the playable browser demo; shortest-path priority (stage-1 sim
      → minimal Three.js vertical slice → polish).
      src/core/CorePathMove.ts — FULL port (91 ln): curve wrap, incremental
      DistanceToTime cache (m_lastCurveTime), sample/sampleWithVel result
      objects (C# out-params), boundary ok=false at curveLength, fresh-search
      distanceToTime, isSameCurve by id. CatmullCurve → CatmullCurveContract
      (spline math port pending — decompiled/Q4.CatmullCurve.c available).
      src/core/EnemyDetectorSphere.ts + EnemyDetectorCone.ts — FULL ports
      (295 ln) + IEnemyDetector interface (overload unions w/ instanceof
      dispatch). Sphere FAITHFUL QUIRK pinned: inAttack POSITION overload
      reads m_radiusScale not affect. Cone: downward frustum interpolation,
      object-cylinder radius subtraction + height span, affect vs detection
      radii, bounding cylinders, anchors 0.5/1.0.
      src/core/GameCoreEnemyAttackPoint.ts — FULL port (194 ln): first real
      IDamageable implementer; damage forwards to host tagged with THIS point
      (both overloads), moveType inherit/override (+faithful NRE on null host
      without override), balloon aimability via tower.balloonAimable,
      afterAirPoints ground-shielding while an air point is enabled,
      validateTarget (curveLengthB4Activation < pathDistance),
      predictPositionAndDirection (path sample + LookRotation(vel)×localPos;
      host-gone → localPosition/forward; sample-miss → host pos/moveVec).
      interfaces.ts IDamageable ADAPTED: C# Collision()/Position()/Handle()
      slots → inherited readonly properties (TS can't share property/method
      names); host() nullable. Enemy skeleton += path/movement state
      (enemyMoveType 0x60, pathMove, pathDistance, speedCur 0x160, sideOffset
      0x164, moveVec 0x140, isBalloon 0x181, attackPoints 0x1B0); Tower
      skeleton += balloonAimable 0x6C. q4-contracts += CatmullCurveContract +
      AttackPointSettingContract (data table exists).
      tests/core/enemy-helpers.test.ts: 19 new tests.
      Suite at iter-15 end: **340/340 green (22 files), tsc clean**.
      NEXT (iter 16): AIHelper (325 ln) + AIDebugHelper → CatmullCurve math
      port (from decompiled/Q4.CatmullCurve.c) → GameCoreEnemy body (AI modes,
      movement, damage/death, balloons, drown, boss — split across iterations)
      → Fruit(full) → Tower+FSM+TowerHelper → Projectiles → WaveManager(full)
      → 19 commands → driver → `npm run sim:stage1` → Three.js vertical slice
      → PLAYABLE DEMO (loop_0aq6v stop condition).
- [x] AIHELPER PORTED + 3 AGENT LANES DISPATCHED (iter 16):
      src/core/AIHelper.ts — FULL port (325 ln C#): GetBlockingEnemy
      @0x93B550 (nearest-ahead, mirrored 3 categories), GetAvoidanceEnemy
      @0x93BC70 (same-group earlier-spawn rule / same-path slower-unblocked
      rule / diff-path crossing rule w/ lateral pad 0.2 + parallel-dot 0.8,
      balloon layer filter, static enemyStorage scratch), FindClosestObject<T>
      (ctor-arg adaptation), DetectGroundOrientation @0x93C580 (linecast
      pos+up → pos−10up; FAITHFUL no-hit degenerate fallback Scale(fwd,(0,1,0));
      hit: double-cross plane projection + Atan2 slope×Rad2Deg).
      Nested types exported: BlockingInfo (3084, handle fields), TerrainInfo
      (3085 struct→class), TerrainOrientationInterpolator (3087: 15-tick
      sample cadence, 0.25s look-ahead via enemy prediction, Lerp/Normalize/
      LerpAngle blend; C# struct-copy semantics emulated via cloning).
      src/core/AIDebugHelper.ts — compiled-out no-op gizmos (both overloads).
      Enemy skeleton += wave state (m_waveIndex 0xE8 / m_waveSubIndex 0xEC /
      m_waveSpawnIndex 0xF0 / m_enemyBlockingMe 0xF8; waveGroupID =
      index×10000+sub computed getter; isBlocked) + FULL
      PredictPositionAndDirection @0x4AED70 port.
      tests/core/ai-helper.test.ts: 14 new tests (categorisation rules, layer
      filter, closest-object, ground orientation flat/slope/no-hit,
      interpolator cadence ticks 1/15/29 + blend values + destroyed-enemy
      stability).
      Suite at iter-16 end: **354/354 green (23 files), tsc clean**.
      USER: "use 3 more agents" → 3 background lanes dispatched (ownership
      until completion notices — main keeps src/core minus CatmullCurve.ts,
      q4-contracts.ts, tests/core minus catmull-curve.test.ts, PROGRESS.md):
      (A) CatmullCurve reconstruction+port+tests — owns decomp/src/Q4/
      CatmullCurve.cs, src/core/CatmullCurve.ts, tests/core/catmull-curve.test.ts,
      .work/catmull/ (ses_e18e387bfffeXGypK27AgtvG8W);
      (B) character assets at scale (57 enemies/21 towers → GLB+30Hz anims+
      PNG textures+manifest; stage-1 priority kuri/boss_bero/towers) — owns
      tools/assets/ new scripts, public/assets/characters/, .work/asset-scale/,
      decomp/data/character_asset_manifest.json (ses_e18e387bdffeONRLwoxLc5CEhL);
      (C) stage-001 static scene extractor (Three.js-ready scene.json+mesh
      bins+textures; terrain_001 validation) — owns tools/stages/,
      public/assets/stages/, .work/stage-extract/,
      decomp/data/stage_scene_manifest.json (ses_e18e387bbffeCXQzH1bUn7NX5B).
      NEXT (iter 17): GameCoreEnemy body (read ~1500 ln C# in chunks; port
      ctor/lifecycle/Tick/movement first, then damage/death/balloons/boss) —
      integrate Agent A's CatmullCurve when it lands → Fruit(full) →
      Tower+FSM+TowerHelper → Projectiles → WaveManager(full) → 19 commands →
      driver → `npm run sim:stage1` → Three.js vertical slice (uses agents
      B/C outputs) → PLAYABLE DEMO.
- [~] GAMECOREENEMY CHUNK 1 PORTED (iter 17 / demo-loop run 1):
      src/core/GameCoreEnemy.ts rewritten — FULL field block (every offset
      0x60..0x29C), default ctor @0x4ACDC0 (faithful pool defaults: ground
      type, canAttack latch true, freq 4, wave indices −1, moveVec forward,
      speeds 1) + spawn ctor @0x4AD0E0 (18 params, view-contract driven):
      path start placement, Character-tagged model bounds → collision ×
      collisionScaleH/V + heavy flag (≥0.99 pre-scale), tangent facing,
      speed/fire/balloon ratios, difficulty-scaled HP/thresholds, spawn modes
      (Normal/Fire/Balloon incl. balloon count/HP-interval/delta-Y math),
      ground offset landing, wave fields + waveDistance, drift Deg2Rad, boss
      tuning, TerrainOrientationInterpolator, attack-point init (view list /
      Kao-Fat move-type config / balloon single point), PostGameCoreTick
      gameOver + boss spawnGroupStarted listeners, attackDelay 1 / canAttack
      false post-spawn, ChibiAvoidRadius-for-BOTH-fields quirk.
      All properties/getters (speed fire/balloon/scale, slow/damaged modes,
      anti-magic/physics via DamageHelper+viewer, wave ids, blocking handles,
      sideOffset internal accessor, tracker/minion flags), attack-point mgmt
      (Init/Tick/Config/RemoveAll), DestroySelf (points disabled + buffs
      terminated + listeners detached), OnGameOver (latest-version flag),
      OnSpawnGroupStarted (minion wait), RecreateViewer (faithful NRE),
      IDamageable targeting (IsAimableTarget/ValidateTarget/Valid = no-points
      rule; host()=this; predict ✓). DealDamage routines + Tick/AI/movement =
      NEXT CHUNK (stubs/base no-op documented in-file).
      **NEW FAITHFUL QUIRK pinned**: fire-spawned enemies' initial m_speedCur
      uses NORMAL speed — the ctor computes speedCur BEFORE setting m_isOnFire
      from spawnMode (the Speed getter reads the live flag → fireSpeed).
      q4-contracts += EnemyBase/EnemyViewer/Balloon/AttackPointView/
      CharacterTransform contracts + enemyViewerFactory hook;
      DifficultySettingsContract += enemyHPByDifficulty (verified formula
      Max(1, trunc(diffRate×v×mpRate)); SP default 0.9/1.0 from
      globalsettings_DifficultySettings.json[0]).
      tests/core/enemy-spawn.test.ts: 13 new tests; home/buff-subclasses/
      enemy-helpers/ai-helper tests adapted to faithful defaults (post-spawn
      canAttack latch, buffs container, nullable attackPoints, waveSubIndex).
      Suite (main scope): **367/367 green (24 files), tsc clean**.
      AGENT STATUS: (A) CATMULLCURVE **COMPLETE**: C# reconstruction
      (decomp/src/Q4/CatmullCurve.cs, all 16 functions, Ghidra-lost args
      resolved via objdump, 15 .rodata constants float-verified) + TS port
      src/core/CatmullCurve.ts + 47 tests. DistanceToTime fully decoded
      (fresh .NET BinarySearch vs backward+forward incremental scan);
      20,000-case bit-exact parity vs instruction-sequence fp32 emulation;
      quirks pinned: d≥length → Count−1, Count−4 tail clamp, table ends
      t=N−1.2, NodeTimeToDistance Count−2 clamp, duplicate-dist fresh-vs-
      incremental divergence, normalized lerped velocity, fp32 sub/5
      subsegment t. Merge note: CatmullCurveDeserializable extension
      interface lives in its module. Gate GREEN 414/414 (25 files).
      (B) CHARACTER ASSETS **COMPLETE** (78/78: 57 enemies + 21 towers; 76
      clean + 2 warnings, 0 failed): stage-1 fully covered (kuri_00_001
      3367v/28j/20 clips 0 unresolved; boss_bero_00 mesh/skin/textures ready;
      towers 001/006/007/011). Outputs public/assets/characters/<def>/<def>.glb
      (mesh+skin+joints+materials+30Hz baked anims — 901/932 clips baked via
      true cubic StreamedClip evaluation, bake error ≤9e-07 on 13-char
      validation), shared _textures/ (226 deduped PNGs ≤1024², albedo
      linear→sRGB converted), manifest decomp/data/character_asset_manifest.json
      (+runtime copy). 335 MB shipped / 69 GB free. 6223 unresolved channels
      across 28 chars ALL source-data realities (bero bosses reference
      giant-rig clips — only root tracks bind; bat/bee/kurukuru deleted arm
      joints; etc.) — reported per-def with likelyPath, never dropped.
      Warnings: tower_test_001/005 dangling mesh PPtrs → skeleton-only GLBs.
      Tools: tools/assets/extract_all_characters.py (--stage1/--only/--force,
      idempotent) + validate_bake.py + CHARACTER_PIPELINE_REPORT.md.
      Follow-ups: KTX2 repack, grayscale height→normal, LOD1+ optional.
      (C) STAGE SCENE **COMPLETE**: 3d_stage_001 → 2399 nodes (8 roots),
      198 renderable (LOD0+active, ~385k tris), 16 meshes/19 materials/
      77 textures (BC1/BC3/BC6H decoded), 4 lights; outputs
      public/assets/stages/3d_stage_001/ (scene.json 1.14MB + mesh bins
      38.8MB + PNGs 198.8MB = 238.8MB) + decomp/data/stage_scene_manifest.json
      (provenance+sha256) + tools/stages/{extract,validate}_stage_scene.py +
      STAGE_SCENE_REPORT.md. Terrain validation PASS (terrain_001 10960v/
      21785t exact collider parity); independent reload validator 0 errors.
      KEY DISCOVERY: props are Unity STATIC-BATCHED into 10 world-space
      Combined Mesh assets — m_StaticBatchInfo.firstSubMesh gives the exact
      renderer→submesh slice (geometrically verified); loader draws batched
      at identity + slice, non-batched compose transforms. Coords Unity-LH
      as-is; colorSpace corrected. Phase-3 gaps documented: 2 custom shaders
      (terrain Splatt_Normal_Gloss, river Nature/Water), lightmaps, animated
      props (river/stone), KTX2/downscale for 190MB texture weight.
      NEXT (iter 18): enemy chunk 2 — Tick @0x4AF7F0 + StateWalk/StateAttacking/
      UpdateGroundOffset/UdpateDrift/RaycastGroundSlope (AIHelper integration)
      + DealDamage routines @0x4B1200/0x4B13E0 (enemyHitEvent/popBalloons/
      enemyDestroyed) + Drown/PopBalloons/CheckIfDestroy/BossAI; integrate
      CatmullCurve when Agent A completes → Fruit(full) → Tower+FSM →
      Projectiles → WaveManager → commands → driver → sim:stage1 → vertical
      slice → PLAYABLE DEMO.
- [x] GAMECOREENEMY COMPLETE (iter 18 / demo-loop run 2):
      Chunk 2 ported — Tick @0x4AF7F0 (hold-vs-walk dispatch, FIELD canAttack
      read — no announcement side effect), UdpateDrift [sic] sinusoidal drift,
      StateWalk (avoidance refresh w/ RNG-jittered first detection, slope
      speed scaling via view tuning, MoveTowards side/speed easing, jumping-
      boss rest/jump cycle + bossJumpEvent, path-end DestroySelf, tangent
      facing), UpdateBlockingEnemies @0x4B2BA0 (ALL THREE refresh branches
      write distanceSameGroup quirk; same-group priority/stop/overtake-speed
      blend; spawn-index SWAP quirk; diff-path/same-path rules; AISettings
      blocking/overtake gates), RaycastGroundSlope (terrain snap / falling
      landing), UpdateGroundOffset (9.8 spring ×0.999 damping + landing thud
      SFX), StateAttacking (non-boss self-destruct at home; boss holds),
      LandedOnDeathPath (Death segment → destroyed event), BossAI (Bero/Kao
      attack lunge w/ sin arc + bossAttackEffectEvent at mid-hold; Fat
      land-when-near-or-damaged; Tall low-HP speed) + BossAITerrainDetection
      (Kao segment-driven ground/air switching), PopBalloons (falling
      conversion + point re-init), DrownDetection/Drown (water CheckSphere +
      events), CheckIfDestroy, DealDamage untyped (projectile→tower typing)
      + typed (debug damageRate, dealt=Min(dmg,life), NO life loss while
      balloons up, Fat/Tall-ground vulnerable accumulation, Lightning/Insect
      special-hit, per-point attribute tables, tookDamageThisFrame gate,
      balloon HP-interval CeilToInt pops / oneShotOneBalloon, death →
      enemyDestroyedEvent + boss-death cascade KillOtherEnemiesOnBossDeath),
      DealPlayerDamage (kick), TriggerJumpReaction.
      Support: enums += EPathSegType (Normal/Death/BossGround/BossAir from
      dump.cs); GameCoreProjectileLightning/Insect marked skeletons
      (instanceof dispatch live); Tower skeleton += oneShotOneBalloon 0x14C;
      EnemyViewerContract += slope tuning + body attributes accessor;
      MonstersAudio.playSFX union overload (2-arg landing variant).
      tests/core/enemy-tick.test.ts: 13 new tests (hold/walk/path-end,
      blocking stop, jumping-boss cadence — f32 rest-crossing at tick 61
      pinned, body damage + events + immediateDestroy, debug rate, balloon
      pop math + oneShot, boss vulnerable + death cascade, kick damage,
      drown, death-path landing).
      **GameCoreEnemy is now fully ported** (remaining upstream gaps:
      Projectile Lightning/Insect bodies). ALL THREE AGENT LANES COMPLETE
      (CatmullCurve 47 tests + characters 78/78 + stage-001 scene).
      Suite at iter-18 end: **427/427 green (26 files), tsc clean**.
      NEXT (iter 19): GameCoreFruit FULL (778 ln — throwable consumables,
      tree interplay, water logic) → GameCoreShop → Tower+FSM+TowerHelper →
      Projectiles (5 full + Lightning/Insect reconstruction) →
      WaveManager(full) → 19 commands → driver → `npm run sim:stage1` →
      Three.js vertical slice (assets READY: characters + stage + audio) →
      PLAYABLE DEMO (loop_0aq6v stop condition).
- [x] GAMECOREFRUIT FULL + RODATA VERIFICATION (iter 19):
      **ELF float-read verification pass**: ALL ~33 fruit DAT_00b7cxxx
      literals read directly from Il2CppUserAssemblies.elf (file offset =
      vaddr + 0x4000; sanity-checked vs known 0.15/0.1 constants). Many
      INFERRED values in the C# reconstruction were WRONG — corrected in
      decomp/src/GameCore/GameCoreFruit.cs (source of truth improved):
      GroundSnapRayDistance 100 (not 1000), radius factors 0.475 (not 1),
      WaterRaycastDistance 2, KillBelowWorldY −20 (not −1000),
      HeldHeightOffset 0.5, SeparationVelocityDamping **−0.75** (flips
      descent to capped ascent, cap 1.0), jitter ±0.1, RestProbeHeight 2 /
      padding 2.1 / threshold 0.25, QueryMargin 0.1 / height 4,
      JumpTriggerDeltaY **−0.11**, GentleDropForceThreshold **0.001**,
      ThrowDropProbeMaxDistance 1.05, LandingClearance **−0.05**,
      default ranges 1.0/0.5; "Zero" alias split per raw use-site
      (0.1 below-world / 0.0 expiry / 1.0 cap+alignment — raw lines
      842/866/1077/1259).
      src/core/GameCoreFruit.ts — FULL port (replaces skeleton): ctor
      (isPrefab instantiate vs adopt, appear pop RNG, lifespan-from-
      movement.acceleration quirk w/ −1 immortal fallback, mesh bounds ×
      scaleGround + ground snap / meshless scale cylinder, tuning copy +
      listeners), playerOwner latest-version resolution + stale clear,
      held pin +0.5, CheckWater ('Collide' trigger mode — water zones are
      triggers; layer-4 ray verification; killTime clamp incl. immortal
      case), TickLifeSpan (NEW documented quirk: below-world resets 0.1
      every tick — never expires while staying below −20, same structure
      as pickup), TickPosition (first-fruit separation w/ negative damping
      + jitter RNG, gravity sweep bounce w/ alignment×rate + sentinel
      countdown + FruitBounce SFX, rest probe + 0.25 rest threshold),
      Triggerable gate, TickHitEnemy/Player/InteractableObject,
      TriggerInteraction (BuffSetting triggerTarget flags Enemy=1/Player=2/
      PlayerJump=4; jump case deltaY < −0.11; plain case radius + height×0.5
      tests; one-shot rumble via GestureManager hook; interaction path
      fires triggerInterationEvent(null, handle) WITHOUT consuming a use;
      caboom + cooldown + usage consumption + destroyWhenUsedUp),
      OnGrab/OnDrop (gentle ≤0.001 snap+rest / throw probe placement w/
      THIS-fruit radius quirk + −0.05 clearance)/ThrowWithForce,
      RecreateViewer, OnStageCleared no-op, OnGameOver deactivate.
      Support: enums += EBuffTriggerTarget; GameCoreInteractionObject
      skeleton (upstream C# gap noted); FruitContract + headless factory +
      BuffSettingContract + rumble hook; Q4Layers.waterIndex;
      triggerInterationEvent payload nullable (faithful null player).
      tests/core/fruit.test.ts: 16 new tests; player.test TestFruit +
      pickups.test count-fruits adapted to the full ctor.
      Suite at iter-19 end: **443/443 green (27 files), tsc clean**.
      NEXT (iter 20): GameCoreShop → Tower+FSM (StateMachine/TowerState×7)
      +TowerHelper → Projectiles (5 full + Lightning/Insect reconstruction)
      → WaveManager(full) → 19 commands → driver → `npm run sim:stage1` →
      Three.js vertical slice → PLAYABLE DEMO.
- [x] FSM FRAMEWORK + SHOP + CHARACTERTEMPLATE (iter 20 / demo-loop run 3):
      src/core/StateMachine.ts — FULL port of the generic State<TOwner>/
      StateMachine<TOwner> (192 ln C#, shared-generic bodies @0x770BA0..
      0x771010): duration-driven transitions (State.Tick return IGNORED —
      faithful), default fallback, next/next-next consumption, blocking +
      priority deferral (SetCurrentCommand), ForceCurrentCommand (discards
      pending next via PostExit hook ONLY, no Exit), InternalForce (Exit →
      PostExit → lastState; PreEnter → Enter → clock 0), mid-tick re-read,
      IsStateRunning/OrPending (ctor-arg instanceof adaptation).
      src/core/GameCoreShop.ts — FULL (58 ln): collision (0.5,0.5)
      DAT_00b7c250, origin position, RecreateViewer scene-renderer scan
      (sqrDistance < 1.0 DAT_00b7c448) via findShopViewerCandidates hook.
      src/core/GameCoreCharacterTemplate.ts — FULL (37 ln): QuatPos split
      params, position landing, prefab adopted as unity object (Instantiate
      is view-layer; documented), tick no-op.
      tests/core/state-machine.test.ts: 10 new tests (transition/expiry/
      fallback/queue/priority/blocking/force-hook-order/mid-tick/instanceof
      + shop scan + template link).
      Suite at iter-20 end: **453/453 green (28 files), tsc clean**.
      NEXT (iter 21): TOWER CLUSTER (~1900 ln, split as needed):
      TowerBase view contract + GameCoreTower (614 ln: settings copy,
      target queue, EXP/upgrade, rotation, FSM boot) + TowerHelper (424 ln)
      + TowerStateMachine/TowerState base + 7 states (Idle 310 / Attack 218 /
      UpgradeAround 131 / Build 80 / ChangeMag 72 / Broken 57 / Degenerate 38)
      → Projectiles → WaveManager(full) → 19 commands → driver →
      `npm run sim:stage1` → Three.js vertical slice → PLAYABLE DEMO.
- [x] TOWER CLUSTER COMPLETE (iter 21):
      GameCoreTower FULL (614 ln): settings copy from TowerBaseContract
      (all offsets), fire-point height, detector creation, hive insect cap;
      Tick (target refresh, rotate-speed accel, EXP-source aging w/ at-most-
      one-removal quirk, 0.25s target-queue prune/append/promote, FSM tick);
      SetCurrentTarget handle-change semantics + speed zeroing; EXP/upgrade
      pipeline (GrantEXP debug rate + gathering window + auto-upgrade via
      TowerUpgradeSettingContract ref-level→return; GetCurrentExpRate);
      ammo (HasEnoughBullet −1 unlimited; RechargeBullet → ChangeMag);
      wave/stage hooks; occupancy; RecreateViewer; Finalize→destroySelf
      adaptation (deterministic listener teardown).
      TowerHelper FULL (424 ln): IsTarget 3-bit key fold; GetNearestTargets
      (lowered query anchor ONLY for spatial query; global attack-point
      gather; sticky foundAny detection quirk; blind-clear); fire-range
      filter overload; ClearViewOnTarget (muzzle→target+0.5 linecast);
      IsTargetInFireRange (projectile aim vs fortDirection angle);
      GetNextTargetFromTowerTargetQueue (DEAD index param quirk);
      FilterEnemiesByAttackType (direct key + dead branch); GetCostTrees
      (flat y=0 distance, 2r/100r cylinder); FromTreeToTower (claim trees +
      structureBreakEvent + towerDirection seeding + viewer factory + Build
      state w/ difficulty build time); RandomCautionDirection (speed-zero
      side effect).
      ALL 7 FSM states + TowerState base (towerChangeStateEvent on Enter) +
      TowerStateMachine (self-owner, Idle(true) default): Idle (aim tracking
      via euler MoveTowardsAngle + caution EReset/ERotating/EWatching cycle +
      hive/gem/normal attack gates), Attack (charged burst timer, ammo at
      burst end, reflection projectile creation via GetGameCoreType ctor,
      mid-burst tracking, force-attack), Build (rise + exact snap), ChangeMag
      (refill at start + animator duration + missileTowerChangeMag), Broken
      (pop-once + reentry Exit — forcing out recurses faithfully, dead code
      in practice), Degenerate, UpgradeAround (EXP aura + sink progress +
      gem pop + Broken transition).
      **TWO RAW-DISASM CORRECTIONS** (synced to C# recon): gemTowerSinkEvent
      4th payload = m_sinkTimePerFrag (Ghidra arg scramble; field 0x38);
      UpgradeAround upgrade-tick is a CATCH-UP WHILE loop (goto @0x4E3CC1).
      GameCoreProjectile ctor+Tick ported (flight pending); contracts +=
      TowerBase/TowerUpgrade/UpgradeSetting/EnemyDetectorView/ProjectileView
      + tower viewer factory; Events tightened (Tower nullable/TowerState/
      TowerUpgrade); asDamageable duck-cast helper.
      tests/core/tower.test.ts: 13 new tests. Suite: **466/466 (29 files)**.
      NEXT (iter 22): Projectiles (Trajectory/Beam/Electric/Instant/Gem full
      + Lightning/Insect C# reconstruction → port) → WaveManager(full 745 ln)
      → 19 Network commands → driver + `npm run sim:stage1` headless milestone
      → Three.js vertical slice (assets ready) → PLAYABLE DEMO.
- [x] PROJECTILE FAMILY COMPLETE (iter 22 / demo-loop run 4):
      AttenuationCurve.ts — Q4.AttenuationCurve.Sample @0x7302c0 ported;
      constants ELF-verified (DAT_00b7fcd0 = 1.0, DAT_00b7fcd4 = −1.0);
      semantics decoded: first-match index (no-match → 0), snap steps,
      first-segment lerp from 1.0, neighbor lerps.
      GameCoreProjectile base COMPLETE (GetTargets/GetAttackDamage/
      DamageToEnemyInfo/CompareEnemyByDistance/RecreateViewer; abstract).
      ALL SIX subclasses ported: Trajectory (ballistic flight + home-track
      displacement + terrain Linecast detonation + first-overlap verdict
      quirk + direct/splash damage + player buffs; 2.5 fallback + 0.5 probe
      constants confirmed), Instant (no-target ctor death; virtual bullet
      arrival; splash WITHOUT Valid() check — faithful difference vs
      Trajectory), Gem (aura handoff → UpgradeAround, 10000s DAT_00b7c424),
      Beam (swept-capsule perpendicular test DAT_00b7c40c=0, once-per-target
      dedup, terrain-latched spread), Electric (nearest-first bolt front,
      no-advance removal, silent empty-list death), Lightning (host-deduped
      global snapshot, random per-target delays, list-governed lifetime —
      base lifetime NEVER touched, faithful).
      Contracts: ProjectileViewContract extended (all subtype tuning +
      view hooks) + projectile viewer factory; TowerBase +=
      getFirePointByRemainingMag. Insect remains skeleton (C# upstream gap;
      hive tower not needed for stage 1 — documented).
      tests/core/projectiles.test.ts: 10 new tests (curve sampling, terrain
      detonation, direct+splash, instant arrival, gem handoff, beam dedup,
      electric front cadence incl. f32 boundary + next-tick destroy,
      lightning dedup/lifetime).
      Suite at iter-22 end: **476/476 green (30 files), tsc clean**.
- [x] WAVE MANAGER FULL PORT (iter 23 / demo-loop run 5): 745-ln
      GameCoreWaveManager.cs → src/core/GameCoreWaveManager.ts COMPLETE —
      SpawnProgress/WaveProgress records, Difficulty enum (Any=-1..Hard=2),
      SetupWaveData (per-difficulty selection, negative-delay truncation,
      easy/medium/hard boss-minion lists), CreateWaveProgress (activate-delay
      minimum over spawners w/ spawn-mode speed overrides + jumping-boss
      AverageSpeed formula — ELF body @0x7f97e0 decoded: bossType≠None &&
      isJumpingBoss → jumpDur×speed/(jumpDur+restDur); wave-time formula;
      EnemyToSpawnByDifficulty), distributeCurrency (both branches: uneven
      +1 bonuses / flat-covering zeroes + last-pick remainder), tick driver
      (walkthrough + intro gates, 4.75s StageStartDelayAfterIntro, pass-1
      group-start events w/ side-offset SampleDirect, pass-2 spawning w/
      group ids waveIndex*1000+idx, boss-handle latch, boss-minion release
      by boss path distanceToTime + MinionSpawnNow −1000 latch, early-clear
      next-wave shortening ×(2−initWaveTimeRate), UpdateStageClear empty-
      field scan + 5.0s countdown, deferred destroy on game over).
      DATA VERIFICATIONS this iter: GameInfoController stageClearDelay 5.0 /
      gameOverDelay 6.0 extracted from the user's globalsettings bundle via
      UnityPy → decomp/data/globalsettings_GameInfoController.json (the
      stage_001 scene ships no GameInfoController; jovian's copy is 5.0/5.0
      but the singleton is authoritative). Contracts: StageMainContract
      +initWaveTimeRate, DifficultySettings +enemyToSpawnByDifficulty
      (verified formula), new GamePreferences/GameInfoController/Jarvis
      providers + full wave contract set (SpawnData/WaveData/WaveResource/
      WaveManagerView/BossMinionSpawnData/MiniDialogStageSettings).
      GameCoreObject.destroyed private→protected (C# subclasses write it);
      GameCoreEnemy gained life/distance/waveIndex getters (C# cross-class
      field reads). tests/core/wave-manager.test.ts: 14 tests (fixture
      corrections: negative-delay wave excluded entirely; next-wave delay
      burns from wave completion — both faithful behaviors confirmed).
      Suite at iter-23 end: **490/490 green (31 files), tsc clean**.
      NEXT (iter 24): 19 Network commands → tick driver +
      `npm run sim:stage1` headless milestone (needs wave-resource loader:
      stages_WaveResource.json raw per-difficulty WaveData → contracts,
      CatmullCurve from m_pathList/m_segTypeList/m_activateIndex) →
      Three.js vertical slice → PLAYABLE DEMO (loop_0aq6v stop condition).
- [x] NETWORK COMMANDS + TICK DRIVER COMPLETE (iter 24 / demo-loop run 6,
      user-ordered demo push step 1 of 4): ALL 19 Network commands ported
      from decomp/src/GameCore/Network/*.cs → src/core/network/ (NetworkCommand
      base + Busy/IntroSequenceSkip/DetonateFruit (faithful empty)/Sign/
      TriggerInteraction/AddInventory/TowerAttackComamnd [sic]/TowerRotate
      (Quaternion.Euler.multiplyVector)/TowerXP/EnterLeaveTower/SellTower
      (retained-tree revive loop)/BuildTower (singleton + affordability
      gates)/UpgradeTower (EXP top-up then charge, faithful inventory
      re-fetch)/DropFruit (held-fruit identity gate)/PickupFruit (owned-
      by-other → view force-reset: motor.dropFruit + TikimanStateIdle marker)
      /HipAttackEnemy (VIEW-typed damage via PlayerCombatViewContract
      +0x1C/0x20/0x18; view-null skips drop-arming, faithful)/SpawnFruit
      (ctor-pays-when-tick-paused, unityRandom.state save/restore around
      view createFruit, shop instant-handoff + RefreshShopBoards)/
      AddLocalPlayer (max-id+1 via PlayerManager view + StageTransferInfo
      parts)). GameCoreNetworkBridge.ts — minimal VERIFIED SP loopback seam
      (AddPlayerCommand queue → onGameCoreTicked drains FIFO between
      prepareNextFrame and tick, per GameCoreBridge.cs lines 9-58; the
      1726-ln C# network-sync half documented out of scope).
      src/main/sim-driver.ts — SimDriver: the verified SP pipeline
      (InitState(updateCount) → prepareNextFrame → execute commands →
      tick(dt, 0.5 cap internal); must-wait = no players; gameCoreTickEnabled
      wired to the SpawnFruitCommand ctor provider).
      q4-contracts.ts += TowerDatabase/findViewObjectByName(GameObject.Find)/
      PlayerManager+PlayerInfoData+JoinedPlayerView/StageTransferInfo/
      FruitDefinitions/ShopMainController/gameCoreTickEnabled providers,
      PlayerCombatView + PlayerMotor/PlayerFruitView contracts,
      TowerBaseContract.singletonInScene (0x39), HiddenFruitData
      +fruitPrefab/amount, TowerUpgradeContract +costCoin 0x24/costGem 0x28
      (dump.cs-verified). tests/core/network-commands.test.ts: 36 tests
      (pipeline order, RNG InitState pinning, FIFO loopback, all 19 commands'
      guards + happy paths). Suite: **539/539 green (33 files), tsc clean**.
      Also landed this push (subagent lanes): src/data/waveResource.ts
      wave/stage loader (13 tests; step 2 of 4) + src/view/stage/
      StageSceneView/StageCamera/GroundPicker + stage.html dev page
      (step 4a). NEXT (iter 25): step 3 — wire src/main/headless-stage1.ts
      (stage-1 bootstrap idx 12, initCoin 450, initWaveTimeRate 1.75,
      scripted 10-wave playthrough → deterministic replay hash) + npm
      script sim:stage1 → then step 4b character viewers + input + HUD
      → PLAYABLE DEMO (loop_uz3cb stop condition).
- [x] GAME PAGE WRITTEN — PLAYABLE DEMO CANDIDATE (iter 26 / demo-loop run 8,
      step 4b-ii): pjm2-web/game.html + src/main/game.ts — the full vertical
      slice: StageSceneView + CharacterLibrary (6 defs preloaded: kuri/spider/
      giant/kurukuru/boss_bero_00 + tower_001) + real viewer factories
      (createEnemy/TowerViewerFactory per the checks-doc recipe) + SimDriver
      bootstrap identical to the pinned headless milestone (457 trees + home
      world-TRS, Medium, initCoin 450) + input→command queue (WASD/arrows
      move the player placeholder — NO tikiman GLB exists in the 78-def
      manifest; click tree → auto-walk → BuildTowerCommand at 2.5u reach via
      GroundPicker.pickUnity) + HUD (coins/gems/chibis/kills/wave + fps/worst-
      ms) + START button → IntroSequenceSkipCommand + win/lose banners.
      View sync: enemies bindSimSource (position/moveVector-from-delta/life/
      moveType) with 1.8s death-chain retention; towers bindFortDirection;
      currency/projectile meshes page-synced (view-follow upstream gap
      documented); StageCamera += keyboardPan option (WASD reassigned to the
      player; camera lerps after the tikiman). Browser data: NEW
      public/assets/data/stage1-bundle.json (873KB trimmed slice — stage
      records at bundle idx 0 = source idx 12; initCoin 450 / rate 1.75 /
      path_ids 8610+8680 verified; 57 enemy defs + tower_001). Verified so
      far: tsc clean, 561/561 green, vite dev serves game.html + transformed
      game.ts (80KB) + bundle/scene.json/GLBs all 200, no node: builtins in
      the browser graph. NOT YET VERIFIED: in-browser run (desktop browser
      automation unreachable this iteration — tabs.open/list timeout).
      NEXT (iter 27): in-browser verification (loading → START → play wave 1,
      screenshot, fps) OR if the browser stays unreachable, ask the user to
      open http://localhost:5199/game.html (`npx vite` in pjm2-web) and
      report; then polish: hide tree mesh on build, chibi/home visuals,
      vite multi-entry build, ProjectileInsect-free tower roster.
- [x] IN-BROWSER VERIFIED (iter 27 / demo-loop run 9): desktop bridge still
      down, so verification went through playwright-core + the cached
      chromium-1248 headless shell (SwiftShader; scripts in
      .work/verify-game.cjs / verify-game-long.cjs). Boot → loading bar →
      START → play: page loads clean, ZERO page errors, 404 was just the
      implicit /favicon.ico (fixed with an inline SVG icon). Click→walk→build
      pipeline works in-browser: 4 blind clicks built 2 arrow towers
      (450→210 coins), HUD live (coins/chibis/kills/wave), banners wired.
      Added `?lite` render mode (no shadows) for software-GL runs; vite
      multi-entry build added (game/stage/characters/index all emit;
      game chunk 158KB + shared three 558KB, `vite build` green).
      Screenshots: .work/game-1-loaded.png / game-2-playing.png /
      game-3-towers.png / game-4-late.png. fps counter is meaningless under
      SwiftShader (worst frame = one-time shader compile); real-GPU Chrome
      check remains a user-side confirmation. Tree-hide-on-build stays a
      documented seam: stage draws are material-merged static batches (21
      draw calls / 401k tris), per-tree hiding would need an instanced
      tree-draw split — deferred.
      NEXT (iter 28): extended combat run evidence (kills>0, wave 2+),
      then chibi/home visuals, Rapier-WASM static queries in browser.
      ITER-28 NOTES: (a) the long-run "tower vanished +120 coins" anomaly
      was NOT a sim bug — the iter-27 vite.config.ts edit (multi-entry)
      restarted the dev server mid-run and force-reloaded the page, resetting
      the world (450/0/wave 1). RULE: no edits under pjm2-web/ while a
      verification run or a live user session is attached to the dev server.
      (b) User loaded the page in real Chrome — loading is slow because the
      stage streams 238MB of raw 2K/4K PNGs (4-way concurrent fetch +
      createImageBitmap decode, NOT single-threaded, no conversion); the
      planned KTX2 repack is the real fix (≈6× smaller + GPU-native upload).
      (c) Uninterrupted combat verification (.work/verify-game-combat.cjs,
      RUN_SECONDS=720, 320x180 SwiftShader) running in background: roams the
      tikiman scattering build clicks (towers across the map, not just home),
      polls HUD for kills>0. Awaiting result.
      ITER-28b (mission loop, no served-file edits — quiesce rule): TEXTURE
      REPACK PREPPED. Stage textures measured: 77 PNGs / 199MB (47× 2048²,
      30× 1024²; largest 10.2MB). sharp 0.35.5 added as devDep. NEW
      .work/repack-textures.mjs: PNG→WebP (color cs=1 → lossy q90; data
      maps cs=0 → LOSSLESS — normals/AO/metal are data), writes
      textures_webp/ + scene-webp.json variant (texture.file rewritten,
      originals untouched). EXECUTION DEFERRED — public/ writes trigger
      vite full-reloads (quiesce rule). Loader patch (also deferred, ~5
      lines): StageSceneViewOptions.sceneFile (default 'scene.json'),
      used at the scene fetch; game.ts passes sceneFile:'scene-webp.json'
      with fallback. Character _textures: 226 PNGs / 273MB — same repack
      applicable but GLB image URIs point at ../_textures/*.png (needs GLB
      JSON-chunk rewrite — separate, bigger step; only 6 defs' textures
      load for the demo, so stage repack is the 80/20). Full KTX2/BasisU
      (GPU-native, transcode-in-worker) remains the Phase-2- polish
      endgame; WebP is the cheap 5-10× intermediate.
- [x] COMBAT-VERIFIED IN-BROWSER → DEMO LOOP STOPPED (iter 28c): the
      uninterrupted run (.work/verify-combat.log) roamed the tikiman,
      built 3 arrow towers across the map (450→330→210→90 coins), waves
      advanced 1→2 by t=61s, towers killed (kills 3 @ t=161s), chibis
      20/20 defended, ZERO page errors over 161s. Combined with the
      pinned headless STAGE CLEARED milestone (win/lose logic + banners),
      the playable-demo stop condition is MET and loop_h1j6r was stopped.
      Evidence: .work/verify-combat.log, combat-1-built.png,
      combat-2-final.png. loop_svwoq (full-fidelity mission) continues:
      NEXT = execute texture repack + sceneFile loader option when the
      user's live session is idle (ask), then chibi/home visuals,
      Rapier-WASM browser queries, KTX2 endgame.
- [x] TEXTURE REPACK LIVE + TIKIMAN EXTRACTED + PLAYER GFX + CAMERA
      (iter 29, user-approved): (a) WEBP REPACK EXECUTED: stage textures
      199MB → 76.9MB (39%) — color q90 lossy 108→31.6MB, data maps
      (normals/AO/metal) q95 lossy 90.8→45.3MB; scene-webp.json variant
      written; StageSceneView += sceneFile option (fallback → scene.json)
      + game.ts textureConcurrency 4→10. Loading bar now counts ~77MB
      instead of 238MB. (b) TIKIMAN FOUND + EXTRACTED: the player was in
      the globalsettings bundle all along — logic prefab tikiman_01
      (Player MB pid 2514285418080110840 + PrefabLoader) → tikiman_01_pa
      visual (tikiman_01_comp SMR LOD0-3, Animator, 65 clips). Roster
      entry added to extract_all_characters.py (role 'player'); ran
      --only tikiman_01: 7720 verts / 72 joints / 65 clips baked /
      unresolved=0 VALID → public/assets/characters/tikiman_01/. The
      "no tikiman GLB" seam is CLOSED (manifest now 79 defs).
      (c) PLAYER GFX: NEW src/view/characters/PlayerStageView.ts —
      tikiman rig, idle_stand/run crossfade (0.15s), +Z-forward facing
      (same mirror convention as EnemyStageView), setOneShot for
      dance/attack/damage (event wiring TBD); game.ts swaps the capsule
      for the rig (capsule fallback kept), WASD/auto-walk direction now
      feeds anim + facing. (d) CAMERA: PJM2-style — edge-pan OFF in the
      game (edgeMargin: 0), follow lerp tightened (3.0), 1.6u look-ahead
      in the move direction. tsc clean, 561/561 green. Verification:
      .work/verify-player.cjs (screenshots player-1-idle/2-run/3-stop).
      NEXT: repack character _textures (226 PNGs/273MB; GLB URI rewrite
      needed), dance-on-build wiring, chibi/home visuals, KTX2 endgame.
- [x] CAMERA-FOLLOW BUG DIAGNOSED + CLOSED (iter 30): the "camera 9u off
      the tikiman" reading was a SwiftShader artifact, not a code bug —
      headless rAF delivers frames at ~0.25-2fps under software GL
      (frameCalls counter froze at ~92 over 5s while wall clock ran), so
      the 1-exp(-3dt) target lerp simply hadn't converged when the probe
      sampled it. Patient probe (.work/probe-move.cjs, 5s samples):
      WASD confirmed live (playerUnity x 3 -> -13 under KeyD, wasdFrames
      counting), camera target tracks the player correctly (cam x
      -3 -> 14.03 following). tikiman-framed.png confirms the follow
      converges on the player. Added probe counters to the __pjm2 debug
      handle (wasdFrames/tickCalls/frameCalls + state()) — permanent
      diagnostic surface for headless verification. LESSON: all future
      headless probes must sample sim counters, not assume wall-time
      frames. 561/561 green, tsc clean.
- [x] CHARACTER TEXTURE REPACK (iter 31): public/assets/characters/_textures
      290MB → 88.9MB (31%) in _textures_webp/ (Color/Emissive q90 lossy,
      Normal/AO/Metal q95 lossy — same policy as the stage repack) +
      _ok sentinel. CharacterLibrary now auto-detects the repack (HEAD on
      _textures_webp/_ok) and routes GLB texture fetches through a
      LoadingManager URL modifier (png → webp); GLBs untouched, graceful
      fallback to PNG when the repack is absent. Verified in-browser:
      .work/probe-webp-chars.cjs — all character texture requests hit
      _textures_webp/, zero PNG fetches, zero page errors. Script:
      .work/repack-char-textures.mjs (skip-if-exists, FORCE=1).
      561/561 green, tsc clean. NOTE: game.html page-load time was already
      dominated by the stage repack (76.9MB); this trims character loads
      (~7 defs on game.html, 79-def gallery on character-lab.html) by ~3x.
- [x] BUILD-DANCE WIRING (iter 32): the tikiman now plays the REAL PJM2
      build-dance when a tower goes up — game.ts listens to
      Events.towerBuildEvent (fires from BuildTowerCommand with tower, tree,
      player), faces the tikiman at the tree and calls
      PlayerStageView.startBuildDance(tower.buildTime || 6).
      PlayerStageView gained a full dance sequencer over the baked
      dance_buildTower_enter/loop/exit clips: enter (one-shot, clamped) →
      loop (held for the build duration) → exit (one-shot) → back to
      idle/run; walking away cancels the dance (matches the original —
      the tikiman must stay next to the tower); no-op on rigs lacking the
      clips; setOneShot kept for attack/damage/podium. 6 new Node tests
      (sequence phases, movement cancel, missing-clip fallback, position
      mirror, one-shot return) → 567/567 green, tsc clean. __pjm2.state()
      exposes `dancing` for in-browser verification.
- [x] CHIBI EXTRACTION + VISUALS (iter 33): the home chibis are now REAL.
      Pipeline: chibi_00 lives ONLY in the stages bundle's
      3d_stage_004_env.sharedAssets (Chibi MB pid 2479 + PrefabLoader →
      chibi_00_pa) — and the stages bundle packs ~29 BuildPlayer-* scene
      files with massive path_id collisions (137k objects → 10.6k unique
      pids), so the flattened index resolved pid 692 to a 'collision' GO.
      Fix: ec.Bundle(path, prefer_file) — the preferred serialized file
      wins pid collisions — threaded through BundleCache.get(name,
      preferFile) + a roster 'preferFile' field. Extraction: 8198 verts /
      49 joints / 13 clips (die, jump, run, idle_01-03, fear, talk_01,
      stage_clear_*) / unresolved=0 VALID → 2.1MB GLB (manifest now
      80/80 done). View: ChibiStageView spawns one rig per
      GameCoreHome.getChibiDataByIndex (phase-offset idle_01/02/03),
      Events.enemyAttackedHomeEvent → onChibiDying plays the baked `die`
      clip then disposes (mapped by stable ChibiData.id — the sim REMOVES
      dead chibis from m_chibisActive). game.ts: 'chibi_00' added to
      CHARACTER_DEFS, view constructed after home bootstrap, per-frame
      update; __pjm2.state() exposes chibisAlive + chibiRigs. NOTE:
      chibi ChibiData.pos is relative to the home's position AT CTOR TIME
      (faithful binary quirk) — stage 1's home sits at world origin so the
      rigs land correctly; non-origin homes would need the same bootstrap
      ordering as the original. Tests: 5 new Node tests (spawn count,
      unity→three mirror, dying→die-clip→remove, repeat/unknown id no-op,
      missing def) → 572/572 green, tsc clean, sim hash unchanged
      (0x41bb08621c2989ef). In-browser probe (probe-chibi.cjs):
      chibisAlive=20, chibiRigs=20, GLB requested, zero page errors.
- [x] RAPIER-WASM STATIC QUERIES LIVE IN BROWSER (iter 34): the game page no
      longer stubs the physics seam. Published the stage-1 extraction
      (3d_stage_001_colliders.json + 4 mesh bins, 764KB) to
      public/assets/stages/3d_stage_001/physics/; game.ts boot now does
      loadStageWorld() → setSimPhysics(createQueries(pw)) BEFORE the sim
      bootstrap (so GameCoreHome chibi spawns + tower LoS + pickup
      bounce/water all query the real 633-collider world), with a
      documented null-seam fallback on load failure (matches the headless
      milestone). rapier3d-compat 0.14.0 WASM inits fine under vite.
      __pjm2.state().physicsLoaded + __pjm2.linecastDown(x,z) debug hooks
      added. Headless sim:stage1 untouched (its own null seam) → hash
      unchanged. Verified: 572/572 green, tsc clean; probe-physics.cjs →
      physicsLoaded=true, terrain hits at home/3,3/−10,5/20,−15 with sane
      normals (mound y≈1.76 at origin, flat 0 at the chibi ring — chibi
      rigs confirmed NOT buried), zero page errors, game ticks. GOTCHA:
      vite/sirv transiently 404'd freshly-copied public files once (HTML
      fallback, 874B) — re-request a minute later before debugging.
      Terrain LoS now faithful — tower kill pacing in-browser may differ
      slightly from the null-physics milestone (expected, faithful).
- [x] AUDIO MANAGER + STAGE-1 SOUND (iter 35, Phase 4 head start): no ffmpeg
      on host (OGG/Opus transcode stays endgame), so a curated stage-1 WAV
      set ships uncompressed (37MB over localhost — fine for dev; transcode
      before any release): bgm_stage_medium + 12 SFX (coin/gem, dance
      jingle, build complete, arrow shoot/hit, wave start/first/clear,
      game-clear-perfect, game-over, chibi soulfading) from
      tools/assets/audio-out → public/assets/audio/. NEW
      src/view/audio/AudioManager.ts: structural AudioContextLike +
      injectable fetch (Node-testable), unlock-on-gesture, load caching /
      concurrent dedup / failure caching, per-name throttle (arrow shots
      don't stack), single-track BGM swap, play-count + failure diagnostics
      (never throws — audio is cosmetic). game.ts wireAudio() on START:
      BGM loop + preload, then event listeners — waveStartedEvent (first
      wave jingle), towerBuildEvent (dance jingle), towerChangeStateEvent
      build→non-build (buildcomplete sting), projectileLaunch/Hit
      (throttled 70/90ms), enemyAttackedHomeEvent (chibi soulfading),
      pickupAcquiredEvent (coin/gem by inventoryType), stageClearedEvent
      (perfect jingle iff all chibis saved), gameOverEvent.
      __pjm2.state().audio = {bgm, plays, failed}. Tests: 9 new
      (tests/view/audio.test.ts, fake context) → **581/581 green**, tsc
      clean. probe-audio.cjs in-browser: BGM playing, SFX preloaded,
      zero failed, zero page errors → AUDIO-OK.
- [x] PARTICLE SYSTEM (iter 36, NEAR fidelity): NEW
      src/view/particles/ParticleSystem.ts — CPU-sim pool (2048 cap) →
      THREE.Points (soft procedural dot sprite, vertex-color fade,
      depthWrite off). BurstOpts contract (position/count/life/speed/up-
      bias/gravity/size/color/fade) is extraction-friendly for a future
      particle exporter; today's emitters are HAND-TUNED, NOT extracted —
      the original drives Unity ParticleSystem prefabs via
      Q4.TowerEffectPlayer/Q4.GlobalEffects (extraction = Phase-3
      follow-up). View-only Math.random (never in sim). game.ts
      wireParticles(): towerBuildEvent → tan build dust at the tree,
      enemyDestroyedEvent → white poof, projectileHitEvent → yellow spark,
      pickupAcquiredEvent → gold/purple sparkle (coin/gem),
      enemyAttackedHomeEvent → pale-blue rising chibi soul (upward
      gravity). Pool-full drops extra spawns (bounded cost, no overwrite).
      __pjm2.state().particlesAlive + __pjm2.testBurst() debug hooks.
      Tests: 6 new (spawn/alive counts, pool cap, lifetime expiry +
      drawRange, slot reuse, gravity integration, up-bias) →
      **587/587 green**, tsc clean. probe-particles.cjs in-browser:
      burst spawns 30, decays to 0 past max life, zero page errors →
      PARTICLES-OK.
- [x] TERRAIN SPLAT SHADER (iter 37, NEAR): root cause of the flat-gravel
      fallback found — the source meshes DO carry RGBA vertex colors (the
      Shader Forge "Splatt_Normal_Gloss" material has NO splat-map texture
      slot; vertex colors ARE the layer weights) and the scene extractor
      never exported them. NEW tools/stages/add_col0_channel.py backfills
      meshes/<id>.col0.u8.bin from the stages bundle by (sourceFile, pathId)
      match (52 colored meshes in bundle; 3 in stage 1 incl. BOTH terrain
      combined meshes 6+7 — 254KB/216KB bins; weight histogram: moss-G
      dominant, soil-R paths, gravel base — matches PJM2 stage 1). NEW
      src/view/stage/SplatTerrainMaterial.ts: installSplatTerrainShader
      patches MeshStandardMaterial (onBeforeCompile) with a `splat` vec4
      attribute → varying and a map_fragment replacement implementing the
      Shader Forge lerp chain lerp(lerp(lerp(base,R,r),G,g),B,b); layer
      samplers are live-patched custom uniforms with per-layer use-flags
      (progressive streaming safe — base color until each layer decodes);
      customProgramCacheKey pinned. Albedo only; per-layer Normal/Gloss
      blending is a documented follow-up. StageSceneView: col0 channel
      fetch, slice remap to normalized float `splat` attribute,
      ensureSplatAttributes zero-fill so merge groups keep identical
      attribute sets, layer tiling-equality assert (all layers ×56),
      applyTextures wires _R/_G/_B_Color. FIXED latent bug: local
      mergeGeometries only merged position/normal/uv/tangent — silently
      dropped splat on the first attempt. __pjm2.terrainSplat() probe hook.
      Tests: 8 new (tests/view/splatTerrain.test.ts — chunk injection,
      uniforms pre/post compile, zero-fill, merge acceptance) →
      **595/595 green**, tsc clean. probe-splat.cjs in-browser: installed,
      base+3 layers live, 15105 splat verts (= 12013+3092 slice verts ✓),
      sample vert (0,1,0,1)=full moss, zero page errors → SPLAT-OK;
      screenshot (.work/splat-terrain.png) shows green field + winding
      soil path + river, replacing the flat gravel.
- [x] LIGHTING INVESTIGATION + IBL AMBIENT (iter 38, parallel-agent batch):
      lightmap agent proved PJM2 has NO baked lightmaps — Unity 5.6.5p1,
      all 863 stage-001 renderers m_LightmapIndex=65535 (none),
      LightmapSettings.m_Lightmaps=[], m_EnableRealtimeLightmaps=true with
      197 Enlighten dynamic-atlas renderers + 23 radiosity systems; lighting
      is runtime Enlighten GI + light probes + 4 realtime lights + skybox
      ambient, NONE extractable as static textures (evidence:
      .work/lightmap_evidence.json). The "diffuse only" look is therefore
      fixed with data that DOES exist: game.ts now builds PMREM image-based
      ambient from the exported sky_test_003.webp (scene.environment,
      intensity 0.7) + uses it as the real sky background, dropping the hack
      HemisphereLight 0.55→0.25 once IBL arrives. NEAR: square 1024² sky
      treated as equirect (color distribution drives soft ambient). The 4
      realtime lights (warm key 1.5 + 2 yellow fills 0.5 + point) were
      already exported/built by StageSceneView.buildLights; _OcclusionMap
      AO already wired in applyTextures. Offline GI re-bake = endgame.
- [x] CHARACTER OUTLINES (iter 38, NEAR): NEW src/view/characters/
      ToonOutline.ts — inverted-hull rims (shared geometry, per-hull
      BackSide MeshBasicMaterial, begin_vertex normal push pre-skin,
      skinned hulls share skeleton + bind state parented under source with
      identity transform, live uOutlineWidth/Color uniforms, idempotent,
      dispose frees only hull mats). Decomp finding: Q4.SkinnedMeshOutline
      Setting/OutlineFade/ObjectOutlineRenderer are the yellow SELECTION
      highlight (color=yellow, k_destWidth=0.05 confirmed, fade rates
      unrecoverable — different eboot build), NOT the permanent rim; rim
      uses documented NEAR defaults 0x1a120b/0.02 (exported
      OUTLINE_SELECTION_WIDTH=0.05 for a future selection pass). game.ts
      wires outline() on player/chibi/enemy/tower roots + dropOutline on
      enemy/tower dispose. Tests: 21 new → green.
- [x] PHASE-4 SHELL + TOUCH + RIVER + MUTE (iter 38, parallel-agent batch,
      integrated): GameShell (pause Esc + results overlays, 12 tests) wired
      — sim ticks gate on shell.paused, results pull live stats via new
      coinsEarned/gemsEarned/playSeconds accumulators, restart=reload,
      mute button → NEW AudioManager master-gain setMuted (+2 tests).
      TouchControls (joystick left-half + tap-to-build right-half, 40 tests)
      wired — analog stick merges with WASD in tickPlayerMovement, tap
      reuses mouse pick semantics, pause button toggles shell, touch
      auto-suppressed while overlays up. RiverWaterMaterial (dual-phase
      flow-map normals + fresnel deep/shallow + sky approx, 11 tests) wired
      via stageView.tickWater(dt) in the frame loop. __pjm2.state() now
      exposes paused/resultsVisible/muted. 73 tests green across the four
      integrated modules + outline/audio (31). Full gate deferred pending
      the load-optimization agent's StageSceneView edits.
- [x] GROUND-CONFORM (iter 38, fixes "everything on a single ground plane"):
      decomp shows ground handling is split — enemies SIM-side
      (GameCoreEnemy.RaycastGroundSlope → AIHelper.DetectGroundOrientation
      vertical Physics.Linecast, ALREADY ported via the physics seam),
      chibis SIM-side spawn snap (GameCoreHome.SpawnChibi, ported), player
      VIEW-side (Q4.PlayerMotor CharacterController; the demo mover never
      set y — the real gap). NEW src/view/stage/GroundConform.ts (downward
      linecast +40→−40 terrainMask, exponential smoothing k=12, spawn/
      teleport snap, per-entity cache) + additive queries.ts groundHeight/
      createGroundHeightQuery (null→0). game.ts: shared GroundConform after
      physics load (null-seam fallback), player root/capsule y =
      sample(unityX, unityZ, dt, 'player'); enemies/chibis trust sim y
      (faithful), camera follow reads the conformed rig root. Sim state
      untouched → hash 0x41bb08621c2989ef stays pinned. Tests: 11 new +
      physics 19 green. Follow-up: optional groundHeight on SimPhysics seam
      + milestone re-verify before wiring into GameCore movement.
- [x] PHASE-5 RE-VERIFICATION (iter 38 batch): after all view/shell/physics-
      seam changes, `npm run sim:stage1` re-run = STAGE CLEARED, 85797 ticks,
      86 kills, replay hash **0x41bb08621c2989ef** (IDENTICAL to the pinned
      milestone) — confirms the parallel-agent batch touched no sim logic.
      (Headless null-physics chibis 2/20; browser real-physics pacing differs
      by design — documented seam.)
- [x] REAL PARTICLE EXTRACTION (iter 38, upgrades NEAR→extracted): NEW
      tools/assets/extract_particles.py scanned structures (45 PS) + props
      (112 PS) → public/assets/particles/particles.json (30 emitters:
      tower_001 arrow-hit bg/bullet/flash/spark, build smoke/rock, chibi
      die smoke/body/spark, tower scrap, coin/gem pickup sparks) + 4 VFX
      textures (BC3→RGBA PNG). KEY fidelity fix: Unity 5.6 CurveMode is
      0=const,1=curve,2=twoCurves,3=twoConstants (the task hint had 2/3
      reversed); bundles store mode 3 + scalar/minScalar = random-between-
      two-constants. Shape enum Unity 5.6 (Cone=4 etc). NEW
      ExtractedEmitter.ts (parseEmitterFile validation + emitterToBurstOptions:
      gravity=mid(mod)×−9.81, cone up-bias=cot(angle) clamp[0,4], count from
      time-0 bursts, color from startColor, fade from colorOverLifetime).
      ParticleSystem.burstFromEmitter added ADDITIVELY (BurstOpts/burst/update
      unchanged). game.ts loads particles.json at boot + wireParticles emit()
      helper spawns extracted records per event (build/arrow-hit/pickup/chibi-
      soul) with hand-tuned fallback when absent; enemy-death poof stays
      hand-tuned (no generic enemy-death prefab). Caveats: 8-point curve
      samples, sizeOverLifetime not applied to static burst, RGB-only color.
      Tests: 22 new + 6 existing green.
- [x] REAL COIN/GEM RENDERING (iter 38): NEW tools/assets/extract_pickups.py
      resolved coin_001/gem_001 through the verified spawn chain (prop_001/
      prop_002 PickupCurrency → PrefabLoader → coin_001_pa/gem_001_pa →
      LOD0 mesh) from props bundle → public/assets/pickups/ GLBs (coin 166v/
      240t, gem 73v/122t) + 512² textures (Color/AO bound; Metal/Normal
      manifest-only) + manifest.json. glTF metallic/roughness match Unity
      material (gem metallic=1, coin dielectric). NO anim clips (verified
      null controller) — spin is code-driven: Q4.PickupCurrency.Update
      rotateSpeed=−180°/s → +π rad/s in three; initial yaw Random.Range(0,180)
      replaced by deterministic handle-hash (no Math.random). Bob/suck-to-
      player are SIM-owned (GameCorePickup bounce + SuckToPlayer) — view
      follows position only (no double-motion). NEW PickupView.ts (pooled
      clones, mirror, spin, collected/expired removal, teal/gold primitive
      fallback sized to real LOD0 bounds). game.ts: PickupView.load at boot,
      pickupView.sync replaces the currencyMeshes primitive loop. Tests: 13
      new green. 41 tests green across pickup+particle modules.
- [x] FAITHFUL CAMERA (iter 38, replaces hand-tuned guess): camera agent
      found the ACTUAL serialized camera in the shipped bundle — scene node
      889 "GameCameraTopDown(Real)" (Camera pathId 4810: fov 22.5/near 0.3/
      far 1000; transform pitch 45°/yaw 180° Unity → boom yawDeg 0/pitchDeg
      45 under x-mirror; GameCameraTopDown Mono 8192: distance FIXED 30
      (min==max), cameraFollowSmoothTime 0.2 via Unity Vector3.SmoothDamp,
      zoomSpeed 2 but rate∈[0,1] with min==max → no distance zoom, parallel
      pan range (7.8,5) chase 1000/10 return 3.5/5 wait 0.17 resetWhenMove).
      ELF rodata constants confirmed (DAT_00b7b6d0=0.1 etc). OLD 55°/140°
      sun-based guess was WRONG — original is axis-aligned 45° top-down.
      StageCamera.ts rewritten + NEW CameraFollow.ts (exact SmoothDamp fp32
      + overshoot guard, parallel-move state machine ported 1:1 incl. the
      zoomRate-scales-whole-position quirk + EQ reset gate; NO look-ahead/
      deadzone/panBounds clamp on follow — decomp has none). game.ts:
      stageCamera.follow(playerMesh.position, playerMoveDir, dt) replaces
      the lerp+1.6u look-ahead. Tests: 17 new green. Caveats documented:
      intro sweep / game-over kill-cam / behind-view / vertical shake not
      implemented; panSpeed unverified; stage-viewer.ts dev pan needs opts.
- [x] WEAPONS/ORIENTATION/ANIMATIONS (iter 38, fixes "all wrong"): weapons
      agent found the MAIN bug — fort aim wrote bare local Eulers, wiping
      the GLB bind-pose compensation (tower_001 Root ~112° bind cancelled by
      tower_rot_y conjugate; neutral aim pointed muzzle at (−0.97,0,0.23)
      not +Z). Decomp Q4.TowerBase.InitFort @005493b0 caches bind WORLD rot;
      UpdateFortViewRotation @0054aeb0 sets joint.rot = LookRotation(dir) *
      bindWorldRot (never local Euler). FIX: pure aimAnglesUnity/aimToThree
      (mirror once) + aimQuaternionThree; setFortDirection applies local =
      parentWorld⁻¹·(qAim·bindWorld) with lazy bind capture. Also: joint
      discovery table FORT_JOINT_NAMES (tower_012 Rot_Y; clip-driven towers
      002/003/005/008/009/010 with empty data names → no code aim); fire-clip
      resolution towerAttackClipName (tower_010 numbered fire_01/02/03,
      tower_011 typo coll_down_idle; states fire/cool_down/reload per
      Q4.TowerAnimator.Start @00546bf0); multi-muzzle index spent%n (was
      reversed). Enemy quat mirror hardened (mirrorQuat self-inverse) +
      world-space lookAt. NEW ProjectileView.ts (pooled shaft+head arrow
      along +Y, orientation priority sim-rot>velocity>position-delta per
      Q4.ProjectileTrajectory.UpdateViewPosition @0074d8d0; sim exposes only
      handle/position so delta path used). game.ts: projectileView.sync
      replaces the cone stand-in loops. Tests: 23 new + characters 33 green.
- [x] LOAD OPTIMIZATION (iter 38, fixes ">1 minute load"): load-opt agent
      found 4 bottlenecks: (1) sequential mesh fetch (52 render-bin requests
      serialized into 10 waves), (2) request count (52 bins = one contiguous
      blob on disk), (3) textures applied only at the very end despite the
      "progressive" comment (ground untextured until last decode; deco before
      terrain), (4) DATA BUG — chibi_00 textures extracted AFTER the WebP
      repack so vite SPA-fallback returned 200+HTML (874B) and GLTFLoader
      .catch(()=>null) silently nulled chibi albedo/AO. FIXES: NEW
      tools/stages/pack_mesh_bins.py packs 83 bins → meshes.pack.bin (39.3MB,
      4-byte aligned) + meshes-pack.json sidecar (byte-identical verified);
      StageSceneView pack-first loading (2 requests, zero-copy typed-array
      views, wholesale validation + auto per-file fallback via bounded worker
      pool meshConcurrency=6, order-independent geometry); textures
      priority-sorted (terrain splat albedo→river→home/guide→deco, albedo
      before data maps) + wired INCREMENTALLY per decode with per-material
      signature guard (recompile only when resolved set changes);
      CharacterLibrary.loadMany bounded pool (default 4); repacked
      chibi_00_{Color,AO} webp (fixes silent loss). All behavior preserved
      (splat/river/col0/merge/terrainPickMeshes/stats). Measured headless
      probe: 16693ms→11727ms (−30%), render bins 52→1 pack blob (93.6ms),
      total requests 255→212 (SwiftShader inflates absolute seconds; the
      52→2 collapse + removed serialized awaits is the durable win). NO
      game.ts wiring needed (loader-internal). Tests: 10 new (loadPerf) green.
      Endgame: KTX2/BasisU GPU-compressed textures (transcoder absent).
- [x] PHASE-5 COMBINED BROWSER PROBE (iter 38): .work/probe-batch.cjs in
      real headless WebGL (SwiftShader) → **BATCH-OK**: load 15s, camera
      distance 30.00 (faithful), splat installed + base + R/G/B layers live
      + 15105 splat verts, physics loaded, Esc pause→true / resume→true,
      zero page errors; screenshot .work/batch-integrated.png. Verifies the
      integrated batch (splat/river/IBL/outlines/ground/shell/touch/camera/
      pickups/particles) renders + runs together.
- [x] PHASE-5 FRAME-TIME HISTOGRAM (iter 12): NEW src/view/perf/
      FrameTimeHistogram.ts — fixed-width bucket histogram (2ms buckets to
      100ms + overflow tail) over wall-clock frame deltas; count/mean/max,
      bucket-upper-bound percentiles (p50/p95/p99, accurate to one bucket),
      fractionUnder60fps (interpolates the straddling 16.67ms bucket),
      snapshot/reset. Pure CPU, Node-testable, view-only (never sim time).
      game.ts: records frameMs after 30-frame warmup (frameCalls gate, not
      the resetting fpsFrames), perf HUD now shows p95, __pjm2.perfHistogram()
      probe hook. Tests: 12 new → **791/791 green (48 files)**, tsc clean.
      probe-perf.cjs → PERF-HISTOGRAM-OK (53 samples, 0 errors). HONEST
      SwiftShader data: p50 18ms but p95/max ~7s software-render stalls,
      24% under 60fps — confirms the headless env CANNOT prove 60fps; real-GPU
      verification requires the user's live Chrome session perf HUD.
- [x] LOADING-FREEZE FIX (iter 12, user-reported "loading or freezing? stuck
      at meshes.pack.bin 1/116 MB"): root cause — the pack path downloaded
      the whole 39MB blob via await blobRes.arrayBuffer() with ZERO progress
      feedback, so the bar froze at the scene-json byte count (~1MB) for the
      entire transfer; on a slower machine this reads as a freeze. FIX:
      StageSceneView.loadMeshPack now STREAMS the blob via response.body
      reader, advancing progress.loadedBytes proportionally to the
      referenced-mesh byte budget (throttled DOM reports ~1MB steps), with
      arrayBuffer fallback when body/Content-Length absent; validation
      failure resets the streamed accounting before per-file fallback;
      slicing loop no longer double-counts bytes. probe-loadprogress.cjs →
      LOADPROGRESS-OK: mesh phase now shows "meshes.pack.bin — 38/39 MB —
      38/116 MB" advancing (was frozen 1/116), load completes ~11.7s, 0
      errors. **791/791 green**, tsc clean.
- [x] PHASE-4 SAVE SYSTEM (iter 13): NEW src/view/save/SaveData.ts grounded
      in Q4.SaveData (skeleton TypeDefIndex 3329: SAVE_VERSION=3, per-
      (stage,difficulty) records score/perfect/cleared, UpdateStageRecord/
      GetStageRecord/HasClearedStage(-1=any)/GetStagePerfect/RemoveStageRecord,
      GamePreferences). Structural StorageLike (browser localStorage, fake
      in Node), version-guarded + corrupt-blob-safe JSON, best-effort flush
      (swallows quota/private-mode errors), never throws. UpdateStageRecord
      called on CLEAR only (cleared implied, matches C# signature); keeps
      BEST score, perfect sticky; returns improved-flag. SCORE METRIC = kills
      (documented assumption — exact original metric unrecovered). Clothing
      unlocks/unlockedStages/medals/companions out of scope (single-stage
      demo). game.ts: createBrowserSaveData at boot; stageCleared →
      updateStageRecord('tl_stage_001', Medium, kills, perfectClear) +
      "New record!" flash on improvement; mute preference persisted +
      restored on START (audio.setMuted + shell.setMuted); state() exposes
      bestRecord/stageClearedBefore. Tests: 12 new → **803/803 green (49
      files)**, tsc clean. probe-save.cjs → SAVE-OK (mute toggled → blob
      {version:3,preferences:{muted:true}} written → survives full reload).
      probe-batch still BATCH-OK (no regression).
- [x] ASSET COMPRESSION FOR SLOW LINKS (iter 13, user-reported "meshes.pack.bin
      takes over a minute"): DIAGNOSIS — localhost fetches the 39MB pack in
      0.063s (620MB/s); the user's >1min is the network link to the remote dev
      server (~0.6MB/s), NOT the loader. FIX: pre-compressed .gz siblings +
      client-side inflate. NEW tools/stages/compress_assets.py (gzip -6,
      idempotent, skips webp/png): mesh pack 39.3→15.2MB (39%), scene-webp.json
      1.1→0.1MB (10%), scene.json 1.1→0.1MB. NEW src/view/stage/compressedFetch.ts
      (fetchCompressed/fetchJsonCompressed): fetches url+'.gz' first, peeks the
      first chunk's gzip magic (0x1f8b) to decide whether to DecompressionStream
      — KEY subtlety: vite dev serves .gz with Content-Encoding:gzip so the
      browser ALREADY inflates the body; a naive DecompressionStream double-
      inflates → fails → wasteful raw 39MB re-download (caught by probe). The
      magic peek handles both auto-decoded and raw-gz servers. Streams progress
      in decompressed bytes; raw fallback when .gz absent. StageSceneView scene
      fetch + mesh pack + game.ts scene.json all use it. NO server restart
      (loader-side, .gz served as static octet-stream). Tests: 7 new
      (compressedFetch incl. the auto-decoded case) + loadPerf 10 green.
      probe-compressed.cjs → COMPRESSED-OK: .gz siblings fetched, pack transfer
      15192488 bytes (was 39323036), no raw fallback, 0 errors. Remaining
      transfer dominated by 77MB WebP textures (already compressed; KTX2/BasisU
      GPU-compression is the endgame lever).
- [x] CAMERA-RELATIVE MOVEMENT (iter 13, user-reported "player movement doesn't
      match camera orientation"): the faithful camera (iter 38) changed yaw
      140°→0° (axis-aligned top-down looking toward three −z), but movement
      still hardcoded the old basis (W→unity +z = BACKWARD relative to the new
      view). FIX: NEW exported pure screenInputToUnity(ix,iz,yawDeg) in
      StageCamera.ts derives the camera ground basis (right=(cos y,−sin y),
      forward=(−sin y,−cos y) in three (x,z), per updatePose) and mirrors x→
      unity; StageCamera.mapInput(ix,iz) wraps it at the current yaw. game.ts
      tickPlayerMovement now uses stageCamera.mapInput for WASD+joystick —
      input matches the view at ANY yaw (future-proof). At yaw 0: W→unity −z
      (into-screen), D→unity −x (screen-right). Tests: 6 new (yaw-0 signs,
      yaw-90 rotation, normalization, zero input, mapInput) → **816/816 green
      (50 files)**, tsc clean. probe-move-dir.cjs → MOVE-DIR-OK (W: z 3→1,
      D: x 3→1; poll by sim ticks — SwiftShader gives ~1 tick/1.5s wall).
- [x] BUILD-RANGE INDICATOR (iter 14, rendering+UI): NEW src/view/stage/
      RangeIndicator.ts grounded in Q4.StructureRangeEffect (SetRadius
      @0x536c70 sizes a unit mesh via localScale; _EdgeColor shader ring;
      default Color.yellow; MoveTowards grow @150/s) + Q4.TowerEffectPreview
      (build preview = 3 rings Detect/Attack/Limit; tower_001 detect=orange
      (1,.5,.25), attack=red, limit=cyan, showLimitRange=0). KEY data finding:
      buildRange 1.8 is the COST-TREE footprint (TowerHelper.GetCostTrees),
      NOT attack radius; attack radius = attackRangeInner+attackSpread = 5.3
      (sphere detector stand-in). WebGL: RingGeometry(0.96,1)+CircleGeometry
      fill, radius via group scale (mirrors original scale-sizing), mirror x,
      y+0.02 anti-z-fight, transparent depthWrite:false, optional pulse (off).
      game.ts: orange detect ring shown when a tree is targeted (pointerdown
      + onTap), hidden on build-complete (towerChangeState leaves Build) +
      cancel; update(dt) in frame loop. Tests: 12 new green. NEAR caveats:
      flat ring+disc vs _EdgeColor glow falloff, single ring vs triple, no
      grow/shrink anim, no victim-tree highlight.
- [x] FAITHFUL UI TEXT + HUD LAYOUT (iter 14, fixes "UI text" gap): UI-text
      agent extracted 214 VERIFIED strings from main_assets TextDatabase
      (Q4.TextDatabaseManager.LoadTextdataBase @00538380 → ui_mess*_en.asset;
      common/dialog/guide/loading tables) → public/assets/ui/strings.json +
      strings.meta.json provenance. KEY findings: difficulty labels are
      Fun/Tricky/Mayhem (NOT Easy/Medium/Hard), stage = "STAGE 1 · Pockulu
      Forest" (tl_stage_001/tl_area_001), wave callouts tl_wave_call_NN
      (D2-pad), chibi counter N/20 two-field (GameInfoController @0044c6f0),
      outcome CLEAR/Perfect!/GAME OVER. NEW UiText.ts (loadStrings/t/
      hudStrings/menuStrings/waveCallKey/difficultyKey/stripIcons, 18 tests).
      HUD-layout agent reproduced Q4.GameInfoController structure (coin/gem
      UICounter, two-field chibi, wave bar, stage/difficulty header) → NEW
      HudLayout.ts (DOM, inline styles, 12 tests). game.ts: loadStrings at
      boot, HudLayout replaces dev #hud/#wave (hidden), updateHud feeds
      hudStrings (stage·area header, Fun/Tricky/Mayhem, coin/gem/chibi labels),
      waveStartedEvent flashes WAVE N callout, outcome banners use
      hudStrings bannerTitle/Sub (CLEAR/Perfect!/GAME OVER). NEAR: unicode
      icons, aggregate wave bar vs per-wave monster icons, exact positions
      unrecoverable without footage.
- [x] BROWSER ASSET CACHE (iter 14, reduces repeat loading): NEW src/view/
      cache/AssetCache.ts — Cache-API wrapper (structural CacheLike/
      CacheStorageLike, Node-testable), bucket pjm2-assets, keys
      `${ASSET_CACHE_VERSION=pjm2-v1}:${url}`, getOrFetch stores decompressed
      bytes as Response, every op try/catch (quota/private-mode→passthrough,
      never throws), 404s never cached, clear() for version bumps. Wired into
      compressedFetch (optional cache param wraps .gz+raw), StageSceneView
      (scene/pack/texture blob), CharacterLibrary (GLB bytes +
      CachedImageBitmapLoader for external GLB textures via manager.addHandler).
      game.ts: one createBrowserAssetCache() shared across stageView/library/
      scene-doc fetch. Repeat loads = ZERO network RTTs (no 200s, no 304s) —
      local disk read + decode only. ~116MB in CacheStorage (browser-managed
      eviction). Tests: 17 new + compressedFetch 7 + loadPerf 10 = 34 green.
- [x] TOON CHARACTER SHADING (iter 14, NEAR): NEW src/view/characters/
      ToonMaterial.ts — applyToonShading (onBeforeCompile RE_Direct_Toon
      wrapper quantizing direct light into 3 bands, soft terminator 0.12,
      cool shadow tint 0xb4bccc, warm fresnel rim 0xfff3dc/0.25; vertex
      untouched → skinning safe; live uniforms, shared program cache key) +
      applyToonToCharacter (clones unique standard mats once, skips outline
      hulls, dispose restores). HONEST finding: original character shader
      params match Unity Standard EXACTLY (kuri_00_m _Glossiness/_Metallic/
      _Mode etc; shader PPtr unresolved into main_assets; NO toon props
      recoverable) → band/tint/rim are style-matched NEAR defaults, not
      extracted. game.ts: toon()/dropToon() helpers applied alongside outline
      on player/chibi/enemy/tower roots. Tests: 14 new (real ShaderLib.standard
      sources) green.
- [x] BUILDABLE TREES RENDERED (iter 14, fixes "we need trees" — the biggest
      start-screen gap): 457 tree_XXX nodes had ZERO render meshes (empty
      logic anchors; original instantiates NatureTree prefabs). Trees agent
      extracted 3 variants from nature bundle → public/assets/trees/ GLBs
      (tree_001_1/2/3, 849v/1480t each; KEY: all 4 variants share identical
      LOD0 geometry, differ ONLY in UV0 atlas region of tree_001_Color) +
      textures (Color sRGB/AO bound, Normal/Metal manifest-only) + manifest.
      Decomp: variant via prefabRandomList Random.Range (PrefabLoader
      @0x7470F0) → stableVariant(id) hash; TreeFall OnTowerBuild @0x64A680
      (fallHeight 0.5/fallDuration 0.5/fallAngle 75°/fallScale 0.25, axis=
      Cross(treePos−towerPos,up), sink+rotate+shrink then SetActive(false)+
      restore TRS); TreeRise OnTreeRevive @0x64A490 (scale 0→1 over 0.1s);
      idle sway is SHADER wind (_MainWindSpeed 1.2/etc, unrecoverable) →
      bounded ~1.1° tilt NEAR. NEW TreeView.ts (pooled clones, mirror,
      deterministic variant, fall/rise state machines, procedural cone+cyl
      fallback, 16 tests). game.ts: TreeView.load at boot, addTree per
      treePositions (stable index), towerBuildEvent→onTowerBuilt, update(dt).
- [x] FAITHFUL SKY/ATMOSPHERE/GRADE (iter 14, fixes "lighting"): sky agent
      CRITICAL finding — the sky_test_003 cubemap (Skybox/Cubemap shader,
      BC6H HDR) is NOT the visible background: all 12 stage cameras clear
      SolidColor #81b5d4 (m_ClearFlags=2); cubemap feeds ambient
      (m_AmbientIntensity 0.5) + reflections only. Fog FALSE (PPSv1 fog gated
      off). Post profile 3d_stage_001_topdown_pp: ACES tonemapper (=1),
      postExposure 0.6 EV (→exposure 2^0.6≈1.52), temperature+10/tint+13,
      contrast 1.07, vignette 0.47, SSAO, FXAA; NO bloom in gameplay (lobby
      only). NEW SkyAtmosphere.ts (PMREM env from cubemap face, ACES +
      exposure, warm grade baked into sky pixels, gradient fallback, pure
      helpers + 12 tests). game.ts: replaces inline PMREM block; sky.apply()
      at boot then scene.background = flat SKY_CLEAR_COLOR #81b5d4 (faithful
      — cubemap not visible), hemi 0.55→0.25. NEAR caveats: single face ≠
      equirect, full-frame grade (contrast/wheels/vignette/SSAO/FXAA) =
      fullscreen-pass follow-up; ACES+1.52 brightens lights (retune may be
      needed). **917/917 green (57 files)** after full batch integration.
- [x] RIVER WATER → Nature/Water look (iter 15, fixes "water looks worse"):
      ROOT CAUSE found — water_A_Normal is a grayscale HEIGHT field (channel
      corr(R,B)=1.000, decoded z≈0), NOT a normal map; our old xyz*2−1 unpack
      produced near-horizontal chaos normals wrecking fresnel/lighting. Fix
      (RiverWaterMaterial.ts, NEAR — shader compiled, grounded in material
      data): height-field bump via inlined Mikkelsen surface-gradient
      (_BumpScale 1), dual-phase flow scroll strength 0.1→0.2, Schlick fresnel
      (_F0 0.05: F0+(1−F0)(1−N·V)^5, reflection REPLACES body color not additive
      sheen), world-space equirect sky reflection (validated: sky sun u≈0.36
      matches main light node 874 mirrored dir atan2→u=0.36), Blinn-Phong sun
      glint pow(N·H,256)×_SpecStrength 0.15 (was misapplied as sky-dimming),
      crest scattering toward _Color1 (_ScatteringHeight), gentle vertex wave
      amp 0.03. API unchanged → NO StageSceneView/game.ts wiring needed
      (tickRiverWater drives flow+waves). Caveats: no refraction grab-pass
      (_RefractScale), no depth extinction, glossiness→shininess + scatter
      strength tuned. Tests: 15 green (incl. static ShaderLib.standard assembly
      check).
- [x] SHADOWS + AO + PROPS (iter 15, fixes "no shadows near water" + part of
      "hut/logs incorrect"): 4 objective bugs found from bundle data
      (UnityPy Light.m_Shadows probe): (1) shadow ortho frustum ±80 clipped
      the stage (river bank at light-space X=−81.3; light-side geometry behind
      near) → fitShadowCamera to the mirrored stage AABB + pull light back
      along its axis; (2) both "Directional Light(Lim)" fills + Pointlight_Lim
      have m_Shadows=0 in the original but we cast from all three → only the
      main sun casts; (3) shadow params from data: m_Strength 0.8 →
      shadow.intensity, m_NormalBias 0.4 → normalBias, bias −0.0005 (TS
      ADAPTATION); (4) AO SILENTLY DISABLED on hut/logs/all deco — three 0.169
      aoMap.channel defaults to uv1, sliced geometry has only uv0 → AO
      sampled at constant (0,0) (white corner) → baked occlusion lost; Unity
      _UVSec=0 → ao.channel=0. Verified objectively CORRECT (no change): hut
      transform chain all-identity, LOD0 submesh 153 chosen, 200/200 hut
      triangles' winding agrees with mirrored normals, textures present +
      color spaces right. Tests: 6 new (stageProps).
- [x] SPLAT PER-LAYER TILING (iter 15, my own bug, flagged by the props
      agent): source layers tile differently — base/B ×56, R ×64, G ×48 — but
      the splat shader reused the base UV transform for all layers (R/G
      mis-tiled). Fix: splatUvScaleR/G/B vec2 uniforms (layerScale/baseScale)
      multiply vMapUv per layer; setSplatLayerUvScales live-patches; wired in
      StageSceneView.applyTextures from mat.textures scales (old "tiling must
      match" warning removed). Tests: 4 new.
- [x] TREE SPECIES + VERTEX WIND (iter 15, fixes "trees all the same" + "not
      swaying"): stage has 425 tree_001 + 32 tree_002; extractor now exports
      both species × 4 prefabRandomList variants (8 GLBs). Sway is now a
      vertex-shader wind patch from the serialized material floats
      (tree_001_m _MainWindSpeed 1.2/_MainWindFrequency 1.6/_MainWindStrength
      0.3; tree_002_m 1.2/1.8/…) + noise layer, weighted by squared vertex
      height (trunk rigid), driven by update(dt) — replaces the barely-visible
      ~1.1° whole-object tilt. game.ts passes species from the node name.
      Tests: treeView 30 green.
- Gate after this batch: **949/949 green (59 files)**, tsc clean;
  probe-visual → VISUAL-OK (457 trees, ACES, #81b5d4, 0 errors).
- [x] CHIBI ARC — SIM BUG FIXED FROM DISASSEMBLY (iter 16, "babies not in
      the correct places" — user: "look at the original logic"): the port's
      "FAITHFUL QUIRK (verified): RandomRange(-AngleSpread, -0.0f)" (one-sided
      arc) was a MIS-READ of Ghidra's packed CONCAT44 rendering. Raw x86-64
      disassembly of Il2CppUserAssemblies.elf (PS4 e_type 0xfe18 → vaddr→file
      offset via program headers, objdump -b binary) @0x4bb4a2:
        vmovss 0x20(%r15),%xmm1 ; vxorps 0xb7c560,%xmm1,%xmm0 ; call RandomRange
      SysV: min = xmm0 = -AngleSpread, max = xmm1 = +AngleSpread. 0xb7c560 =
      16-byte sign mask 0x80000000×4 (the "upper lane" Ghidra showed is mask,
      not an argument); 0xb7c384 = 0.5. Faithful arc = AngleCenter ±
      AngleSpread/2 (±66.5° around the hut front) — ours crammed all 20 onto
      one side. Fixed in src/core/GameCoreHome.ts AND decomp/src/GameCore/
      GameCoreHome.cs (reconstruction source of truth). Replay hash did NOT
      change → it never covered chibi positions; headless-stage1 now hashes the
      initial chibi layout + logs the arc. NEW PINNED HASH
      **0x27227819f56d94ad** (was 0x41bb08621c2989ef), deterministic across
      runs, STAGE CLEARED unchanged, arc [-63.6°, 69.0°]. home.test quirk test
      rewritten to assert both halves populated. **949/949 green.**
- [ ] CHIBI VIEW SOLVER (analysed, not yet ported): the original VIEW runs
      its own per-frame system — Q4.Home.Update → SyncToGameCore →
      ChibiCollisions @0x460ab0: seeds Home.ChibiSolverData from sim
      ChibiData.pos + current view pos, neighbour lists within 2×(2×
      ChibiColSize), ≤3 relaxation passes against SolidColliders {hut: r=
      playerDetectionRange 2.0, flag 1 push-out; home keep-inside r=
      ChibiMaxDistFromHome 2.45, flag 0x8001; players r=PlayerColSize 0.4 →
      IsScared; temp avoidance zones (OnChibiAvoidanceZone)}, chibi-chibi
      spacing 2×ChibiColSize 0.4; writes Chibi.DestPos/DestRot/IsPlayerClose/
      PlayerPos. Q4.Chibi then MOVES to DestPos (AccMin/AccMax, run/land/
      panic-jump/scared/idle-variation anim params). Serialized values
      (data/structures_Home.json): IntroNumHomeChibi 17 (3 arrive via
      ChibiIntro paths). Ours places rigs statically at sim pos → missing:
      scatter-from-player, scared reaction, run-to-spot motion.
- [ ] QUIRK RE-VERIFICATION: other comments marked "verified in
      reconstruction" (Ghidra-derived, same failure mode) should be re-checked
      against raw disassembly: EnemyDetectorSphere.ts:65, GameCoreEnemy.ts:377,
      AIHelper.ts:326, GameCorePlayer.ts:222.
- BLOCKED (subagent provider quota exhausted until 11-28, no output):
  turret hierarchy, chibi placement, enemy fidelity, systematic audit →
  continuing these single-threaded in-session.
- [x] HEADLESS STAGE-1 SIM CLEARED (iter 25 / demo-loop run 7, step 3 of 4
      DONE): src/main/headless-stage1.ts + `npm run sim:stage1` simulates
      tl_stage_001 end-to-end in Node — real wave tables (idx 12, Medium),
      real scene tree/home layout (457 trees + home_001 world-TRS bootstrap
      from scene.json parent chains), tower_001 real stats, scripted
      build+collect bot through the REAL command seam (BuildTowerCommand/
      IntroSequenceSkipCommand via SimDriver). OUTCOME: **STAGE CLEARED**,
      86 kills, 11/10 waves, 2/20 chibis left, 85797 ticks, deterministic
      replay hash **0x41bb08621c2989ef** (FNV-1a-64 over per-tick
      updateCount/enemyCount/life-bits/coins/chibis; verified identical
      across runs). Root causes fixed (both HARNESS-side, sim was faithful):
      (1) tower viewer headless default returns the SHARED prefab record →
      getFirePointByRemainingMag must be per-instance WORLD muzzle
      (setTowerViewerFactory wrapper; was spawning projectiles at world
      origin); (2) bot ranked build sites by distance to path-START samples,
      but enemies are only targetable past curveLengthB4Activation (~14u,
      faithful portal-emergence) → ranking now samples post-activation curve
      points. Debug tooling kept: .work/debug-tower.ts (detector/target-queue
      probe), .work/debug-curve.ts. Also landed (subagent lane, step 4b-i):
      src/view/characters/ CharacterLibrary (GLB cache + SkeletonUtils.clone,
      three-native per manifest) + EnemyStageView (full EnemyViewerContract +
      AnimationMixer semantic clips) + TowerStageView (fort aim via
      tower_rot_y/x) + character-lab.ts/characters.html dev page +
      tests/view/characters.test.ts 22 tests + .work/character-viewer-checks.md
      (integration recipe: preload lib → setEnemyViewerFactory /
      setTowerViewerFactory factories + setViewerResolver; keep enemy views
      ~1–1.8s post-death; prefab name must equal GLB defName).
      Suite: **561/561 green (34 files), tsc clean, vite build green**.
      NEXT (iter 26 — FINAL DEMO STEP): step 4b-ii — src/main/game.ts +
      game.html: StageSceneView + SimDriver + wave data + character viewers
      (per the checks-doc recipe) + input→command queue (GroundPicker →
      BuildTowerCommand) + HUD (coins/wave/chibis) → PLAYABLE DEMO = the
      loop_uz3cb stop condition. Then: vite multi-entry (stage/characters/
      game pages), KTX2, Phase 3 visual gaps, Phase 4/5.
- Suite at iter-7 end: **181/181 green (12 files), tsc clean**.
      Iteration-3 agent progress snapshot: physics extractor 614 ln written;
      asset spike probe scripts + kuri/audio output dirs staged.
- [x] WEB TOOLCHAIN VERIFIED (iter 4): index.html + src/main/browser.ts
      (Three.js WebGL2 bootstrap with the ORIGINAL tick-seam loop shape:
      1 tick/RAF, dt=min(wall,0.5), updateCount++, slots marked for
      InitState/prepare/commands/tick/event-flush) + perf HUD (fps, worst
      frame, WebGL2 flag, DPR cap 2.0). `npm run build` → dist OK (471KB,
      119KB gzip, 1.2s). Visual/60fps confirmation pending Phase 3 (headless
      host; will verify via user browser or puppeteer+SwiftShader later).
- [~] Iteration-4 agent snapshot: PHYSICS extraction SUCCEEDED —
      .work/physics-spike/3d_stage_001_colliders.json: 633 colliders (458
      capsule/154 box/16 sphere/5 mesh incl. terrain_001 Art_Terrain layer 29),
      full layer map (Water=4, Art_Terrain=29, ...), meshes as f32/u32 bins
      (476KB); Rapier TS layer + parity test still pending from that agent.
      ASSETS: pylibs installed, extraction running. ENGINE math/rng: no files
      yet (agent researching?) — core spine remains gated; if still empty next
      iteration with no completion notice, reassess (agent may be stuck).
- [~] Iteration-5 snapshot:
  * ASSET SPIKE findings (tools/assets/SPIKE_REPORT.md, still in progress but
    the hard parts are PROVEN): kuri_00_001 = logic prefab → PrefabLoader →
    visual 'kuri_00_pa'/kuri_00_comp (Animator+LODGroup, 5 LOD skinned meshes,
    28-bone skeleton); LOD0 3,367 verts pos/norm/tan/uv0 + skin weights OK;
    textures are STANDARD BC1/BC3 (DXT) 2048² inline w/ mips (no GNF problem,
    texture2ddecoder installed); animator 'kuri_ctrl' = 17 clips, StreamedClip+
    ConstantClip format DECODED, all 28 CRC32 path-hash bindings resolved
    (AssetStudioMod algorithm); audio = Unity ADPCM 44.1kHz (NOT ATRAC9) in
    .resource archives, fmod_toolkit extraction probe pending.
  * docs/PORTING_CONVENTIONS.md written — binding C#→TS rules for every
    module + future agents (fround discipline, faithful-quirk markers, naming
    incl. original typos, offset/RVA comment retention, dependency direction
    core→engine/data only, RNG/physics seams, Q4 view-contract interfaces).
  * `npm run check` gate added (typecheck+tests) — currently green (36/36).
  * ENGINE math/rng STILL empty (~50 min in). POLICY: one more iteration of
    patience; if iter-6 shows no files AND no completion notice, main session
    TAKES OVER the scope (writes src/engine/math+rng directly); late agent
    output then gets merged/selected by comparison, not clobbered blindly.
      Milestone: `npm run sim:stage1` — headless 15-wave playthrough verified
      against decomp/data (spawn counts/timing/paths/economy), deterministic
      replay hash. Tick-seam contract: 1 tick/RAF, dt=min(deltaTime,0.5),
      InitState(updateCount), command seam between prepare & tick.
      NOTE: C# sim gaps still open upstream (GameCoreNetworkBridge, Projectile
      Gaseous/Insect, InteractionObject) — port what exists, reconstruct the
      rest from decomp/decompiled as they're reached.
- [ ] PHASE 2 asset pipeline at scale (57 enemies, 21 towers, 17 stages, UI,
      fonts, localization, audio) — generalize the spike scripts.
      AUDIO DONE (iter 13, agent lane): 269 clips → WAV + manifest +
      113/113 GlobalSounds map under tools/assets/audio-out/ (ogg transcode
      pending ffmpeg availability).
      CHARACTERS DONE (iter 17, agent lane): 78/78 enemies+towers → GLB +
      30Hz baked anims + sRGB PNG textures + manifest under
      public/assets/characters/ (stage-1 fully covered; see iter-17 entry).
      REMAINING: stage scenes (agent C running), UI/fonts/localization.
- [ ] PHASE 3 Three.js view layer (viewer map = bridge pattern, animators,
      particles, chibi/home, camera, stage scenes, recreated toon/outline/
      terrain GLSL shaders matched vs user footage)
- [ ] PHASE 4 game shell (KB/gamepad/touch → NetworkCommand queue, menus,
      stage select/unlocks, localStorage saves, pause/results, audio mix)
- [ ] PHASE 5 verification (side-by-side vs footage; cross-browser replay-hash
      equality; Chrome 60fps+ frame-time histograms; honest identical/near/
      missing report) → stop_loop when stage 1 plays start-to-finish in browser

## Loop operating notes
- loop_b9ls1, dynamic pacing (~300s between iterations; wakes early on sub-agent
  completion notifications). Each iteration: next unchecked item above.
- Sub-agent cap: 3 concurrent + main (deployment max_parallel_requests=4).
- Do NOT edit files owned by a RUNNING agent (scopes in the dispatch prompts:
  engine=src/engine/{math,rng}+tests/engine; assets=tools/assets+.work/
  asset-spike; physics=src/engine/physics+tests/physics+tools/colliders+
  .work/physics-spike).- [x] WATER → FAITHFUL SHADER PORT (iter 16, "water very wrong"): Nature/Water GCN ISA disassembled
      (tools/shaders/, docs/WATER_SHADER_ANALYSIS.md). Root causes: _NormalMap is DXT5nm (alpha/green),
      shader refracts a scene grab, reconstructs world height from the depth texture for extinction,
      samples a real CUBEMAP sky, no vertex waves, `_Color` unused. New RiverWaterMaterial.ts
      (ShaderMaterial) + WaterPass.ts (RT grab+depth) + extract_sky_cube.py. Same DXT5nm bug fixed
      for props by the props agent (UnityStandardMaps.ts). Trees: TREE_SWAP_ANALYSIS.md (all claimed
      trees fall, per-tree axis/delay, revive wiring). HAR load analysis: LOAD_HAR_ANALYSIS.md.
      Dev server now bound 0.0.0.0:5199. Tower construction analysis agent still running.
- [x] REPLAY HASH RE-PIN (enemy drops, iter 17): Q4.PickupManager ported (PickupDrops.ts; docs/ENEMY_DROPS_ANALYSIS.md):
      real scattered coin/gem drops (coins split into 20s + remainder, gems 1 each, +0.2 lift, per-enemy
      PickupMovement), gems credited via CurrencyFlyer→AddInventoryCommand, tower sells drop pickups,
      terrain floor for pickups. Stage 1 headless: 76 coin + 9 gem pickups, collected 474 coins / 5 gems.
      Pinned replay hash is now **0x61889fae2ea828f1** (was 0x27227819f56d94ad, which itself replaced
      0x41bb08621c2989ef at the chibi-arc fix). Docs citing older values are historical.
      Also this iteration: StageAmbient.ts (real baked ambient probe replaces invented hemi light;
      docs/LIGHTING_SATURATION_ANALYSIS.md — grass/path still too saturated, realtime-GI gap open).

- [x] MULTI-STAGE + STAGE SELECT (iter 18; docs/STAGE_SELECT_AND_MULTISTAGE.md in pjm2-web):
      15 stages catalogued (src/data/stageCatalog.ts, generated from AreaStageInfoMap; stage N = 3d_stage_NNN);
      per-stage data bundles (tools/data/export_stage_bundles.py -> public/assets/data/stage{N}-bundle.json,
      stage 1 verified identical to the old baseline); scene+colliders+WebP+packs extracted for stages 2..5
      (tools/stages/build_stage.sh); game.ts boots `?stage=N` (`&diff=0|1|2`, default stage 1 / Tricky);
      headless `npm run sim:stage1 -- N`. PINNED REPLAY HASHES (tests/data/headless-stages.test.ts, run by
      `npm run check`): stage 1 STAGE CLEARED 0x61889fae2ea828f1 | stage 2 GAME OVER 0xf5dec45809d65bcb |
      stage 3 STAGE CLEARED 0x049939b21ebc36d6 | stage 4 GAME OVER 0xacc118c9d7e8277a |
      stage 5 STAGE CLEARED 0x0201d49b499cc085 (stage 2/4 losses = naive bot, not asserted to be sim bugs).
      Stage select (StageSelectScreen/Model, original stage_select_01 layout + sprites, thumbnails, locked/unlocked,
      Fun/Tricky/Mayhem scores + perfect rainbows) + progression (StageProgress.ts: unlock chain, highest available
      difficulty, HasUnlockedHard) + result count-up (ResultScore.ts: ScoreSettings 50/500/10000/100/1/100, 3 s
      Hermite count-up, Score/Best/Bonus/Clear Bonus rows). Per-stage BGM from StageMain.m_stageMusic (stage 1 is
      bgm_stage_easy, not medium). OPEN: world-map walk-around, AreaLock gates for areas 2-5, medals, stages 6-15
      scenes, in-page stage switching (navigation used), CountUpValue rounding unverified.

- [x] ALL 15 STAGES LOADABLE + PER-STAGE ENVIRONMENT (iter 19; docs/ALL_STAGES_STATUS.md in pjm2-web):
      stages 6..15 extracted (tools/stages/build_stage.sh; no new shaders: Standard / Splatt_Normal_Gloss / Nature/Water
      only), validated (validate_stage_scene.py: terrain parity is stage-1 only), added to pack_assets EXTRA_STAGES.
      BUG FIXED: StageSceneView hard-wired 'terrain_001_m'/'terrain_001_river_m' -> stages 4-15 rendered white ground and no
      water (now resolved by shader name). Per-stage environment table tools/data/export_stage_environment.py ->
      src/data/stageEnvironment.generated.ts + src/view/stage/StageEnvironment.ts (ambient SH+intensity, PP profile,
      clear colour, camera, shadow, fog, skybox, music); consumed by stageSession.ts. Stages 4-15 have their OWN ambient probe,
      grade profile (per area 1/2/3/4/5 = topdown_pp of stage 1,4,7,10,13) and clear colour; stage 1-3 unchanged.
      PINNED (default bot): 6 STAGE CLEARED 0x02de9a8500558bce | 7 GAME OVER 0x37ad11da0709c500 | 8 GAME OVER
      0x89012f26018ccd5f | 9 GAME OVER 0xabff20fd9d057bf5 | 10 TIME CAP 0x2253727cdb44d207 | 11 TIME CAP 0x573f58a385d26eac |
      12 STAGE CLEARED 0xcd0b1a3e78985f4a | 13 TIME CAP 0x3e9deca749391dc6 | 14 TIME CAP 0x4fd60d844a13e20b |
      15 TIME CAP 0x8695fe6a30ad0924. Stage 1 hash unchanged 0x61889fae2ea828f1. OPEN: bloom (enabled in profiles 4-15),
      weather (StageWeatherPlayer), grass instancing, stage 7-9 Fruit/PickupMovement buff, AO.
- [x] ALL-STAGES INTEGRATION (iter 18): final gate 91 files / 1280 tests (10 skipped), tsc clean, sim:stage1 STAGE CLEARED
      0x61889fae2ea828f1 (legacy bot, unchanged), visual probe VISUAL-OK, stage-switch probe STAGE-SWITCH-OK.
      Landed: title/options/credits (docs/TITLE_OPTIONS_CREDITS_ANALYSIS.md), stage intro (STAGE_INTRO_ANALYSIS.md),
      stage select + results score (STAGE_SELECT_AND_MULTISTAGE.md), in-page stage switching: game.ts = shell,
      stageSession.ts = per-stage session (STAGE_SESSION_ARCHITECTURE.md), 15 stages extracted with per-stage
      environments (ALL_STAGES_STATUS.md; StageEnvironment.ts; fixed terrain/river material lookup by shader name),
      stage gameplay audit + sim ports: GameCoreProjectileGaseous/Insect, buffs, enemy damage tables, boss weak
      points, balloons, tower EXP (STAGE_GAMEPLAY_AUDIT.md), HDR reflection probe + SH sign fix
      (REFLECTION_PROBE_ANALYSIS.md; grass/path still ~0.10 over reference saturation).
      HEADLESS PINS: stage 1 legacy 0x61889fae2ea828f1. BOT=smart (default for stages 2-15): s1 0xaf1cd17fa037ae55,
      s2 0x4888bb246a2d8913, s3 0x7be1592f899581dc, s4 0x027e7667302aa978, s5 0x4b6c13ea7e45103e (all cleared).
      Stages 6-15 pins live in tests/data/headless-stages.test.ts (6,12 cleared; 7,8,9 game over; 10,11,13,14,15
      TIME CAP — suspected headless-fixture artifact: uniform 0.3 enemy radius parks enemies at exactly home reach).
      TODO: run `npm run build:packs` (packs stale); per-enemy bounds for the TIME CAP stages; boss states;
      bloom/AO/weather/grass; world-map walk-around; medals/DLC.


## RE-PIN 2 (TIME CAP / GAME OVER triage, pjm2-web docs/STAGE_GAMEPLAY_AUDIT.md section 8)
Stage 1 legacy `0x61889fae2ea828f1` UNCHANGED. Smart pins (real enemy model bounds src/data/enemyBounds.generated.ts, 60-min cap, GameCoreHome.setHomeQueryHeight(0.25) tolerance,
bot site weighting / balloon-aware AA / affordability fallback): s1 `0x62482f8a87a2f590` s2 `0x3b35b2d7ea80b47a` s3 `0x5151be58438f4e1b` s4 `0x55bd6c83d53eddf6` s5 `0x7e98904e5fa63a66`
s6 `0xd4a154cf7aeb9266` s7 GAME OVER `0x3cc903fa932b1aca` s8 `0x63588e3d0382a4be` s9 `0x0c4c227166433f00` s10 GAME OVER `0x2ed96a257b925307` s11 GAME OVER `0xd197abd4747c5784`
s12 `0x96b5b2efd5315fb6` s13 GAME OVER `0xeb89bb8b81256246` s14 GAME OVER `0x45d9a14655c9ffd4` s15 GAME OVER `0x9e0deb9ffa9f01c6`. All 15 pins run on extracted scenes (no SYNTH). Home-query height tolerance UNVERIFIED vs the original binary.
- [x] ITER 19 INTEGRATION: gate tsc clean, 94 files / 1348 tests; sim:stage1 CLEARED 0x61889fae2ea828f1 (legacy bot);
      probe-visual VISUAL-OK, probe-stage-switch OK, title (hub backdrop) loads 0 errors.
      Landed since iter 18: boss/enemy view (blend trees, hit-shock, frozen, burn/freeze fx, balloons, all stage
      enemy GLBs now loaded — many enemies had been invisible: docs/ENEMY_BOSS_VIEW_ANALYSIS.md), render extras
      (bloom st4-15, AO, grass, weather: docs/RENDER_EXTRAS_ANALYSIS.md), walkable hub + title backdrop + credits
      tikiman (docs/HUB_AND_TITLE_ANALYSIS.md), headless fixture real enemy bounds + home-query tolerance
      (GameCoreHome.setHomeQueryHeight(0.25) — UNVERIFIED vs original binary), smart-bot pins re-pinned (RE-PIN 2).
      HUD no longer shows through the title (stageSession.ts hides gameUi root until intro/start).
      OPEN: title-flow probe 'select: textures <= 4' (6 left after dispose; stable across retries, no growth);
      verify home-query tolerance in the original; 60fps cost of AO/bloom on real GPU; hub textures 243MB;
      boss/giant crumble approximations; stage 7/10/11/13/14/15 bot losses; world-map cinematics; medals/DLC;
      credits scene (3d_stage_000_credit_env) not extracted.
