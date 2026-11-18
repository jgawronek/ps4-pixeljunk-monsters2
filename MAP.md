# MAP — PixelJunk Monsters 2 (PS4, CUSA11967, v01.00)

Plain-English map of the game, built from the shipped artifacts (decrypted
fake-SELF ELFs + IL2CPP metadata + Unity assets). Everything below is derived
from the user's own copy; no third-party decompilation was used.

## 1. Language & engine — the EASY/MEDIUM case
- **Engine: Unity 5.6.5p1** (version string read from `Media/globalgamemanagers`).
- **Scripting: C#, compiled with IL2CPP** (C# → C++ → native x86-64). This is NOT
  hand-written C++ machine code and NOT Cell/SPU. The original C# type/method/
  field names are fully recoverable from `global-metadata.dat` (IL2CPP metadata
  **version 23**).
- **Platform: PS4 (Orbis OS, FreeBSD-based), AMD x86-64.** ELFs are
  `ET_SCE_DYNEXEC`/`ET_SCE_DYNAMIC`, little-endian, machine 0x3E (AMD x86-64).
- Why this matters: instead of reverse-engineering anonymous assembly, we can
  recover the *named* C# class structure and decompile the IL2CPP-generated
  native code with those names attached. Much more tractable than a raw C++ game.

## 2. Shipped file layout (after decryption)
- `eboot.bin` → `eboot.elf` (22 MB): Unity player + IL2CPP runtime + engine.
- `Media/Modules/Il2CppUserAssemblies.prx` → `.elf` (21.5 MB): **the game's C#
  code** (Q4 + GameCore + framework), IL2CPP-compiled. Main decompilation target.
- `Media/Metadata/global-metadata.dat` (4.6 MB, v23): all C# names/signatures.
- `Media/Plugins/SavedGames.prx`: native **save-game** plugin.
- `Media/Plugins/CommonDialog.prx`: native system-dialog plugin.
- `Media/Plugins/UnityNpToolkit2.prx`, `sce_module/libSceNpToolkit2.prx`:
  PSN/online toolkit — **out of scope (online)**.
- `Media/{globalgamemanagers,level0..3,sharedassets*,resources.assets}`: Unity
  scenes & assets (art/sound/levels — loaded from the user's copy, never copied
  into the rebuild output).
- `Media/SymbolMap`, `ScriptLayoutHashes.txt`: IL2CPP symbol/layout aids.
- `sce_module/libc.prx`, `libSceFios2.prx`: PS4 system libs (libc, file IO).

## 3. Code architecture (two layers + a bridge)
- **`Q4` namespace — Unity presentation layer** (MonoBehaviours): rendering,
  input, camera, UI, audio, animation, scene flow. 428 types / 3,869 methods.
- **`GameCore` namespace — pure-C# simulation layer**: the actual tower-defense
  logic, deterministic and command-driven. 70 types / 709 methods.
- **`Q4.GameCoreBridge`** (32 methods): connects the Unity layer to the
  simulation core.
- **`Q4.UI`** (115 types / 1,137 methods): menus/HUD.
- **`GameCore.Network.*Command`**: the gameplay command pattern (BuildTower,
  UpgradeTower, SellTower, SpawnFruit, DropFruit, TowerAttack, …). Despite the
  "Network" name these drive single-player too; the *online* services live in
  `Q4.Networking` / Steamworks / NP Toolkit and are out of scope.
- Framework (reusable, not game logic): UnityEngine, UnityEngine.UI,
  UnityEngine.PostProcessing, System.* (.NET), Steamworks (online — skip).

## 4. Main loop (inferred from structure)
Unity player loop → `Q4` MonoBehaviour `Update`/`FixedUpdate` → input sampled
(`ControllerPS4`/`GestureManager`) → gameplay commands issued →
`GameCoreBridge` → `GameCore.GameCore` / `GameCoreFrame` simulation tick
(`GameCoreWaveManager` spawns enemies, `GameCoreEnemy`/`GameCorePlayer` step,
`GameCoreCollisionManager` resolves hits, projectiles/buffs apply) → results
marshalled back to `Q4` views (`EnemyBase`, `Player`, towers) for rendering.
`LauncherManager` boots; scenes flow splash → title → stage → result.

## 5. Big systems (with key classes)
- **Gameplay / simulation (GameCore):** `GameCoreEnemy` (82m/84f),
  `GameCorePlayer` (26m), `GameCoreWaveManager` (29m), `GameCoreFruit` (28m —
  towers are fruit trees), `GameCoreHome` (base to protect), `GameCorePickup`/
  `PickupCurrency` (coins), `GameCoreProjectileBeam`/`Electric`, `Buff*`
  (Bomb/Burn/Freeze/Slow/Flare/Trampoline/FastPlayer), `GameCoreCollisionManager`,
  `CoreObjectPool`, `GameCoreHandle`/`GameCoreObject`/`GameCoreFrame`.
- **Gameplay views (Q4):** `Player` (177m/138f), `PlayerMotor` (87m),
  `EnemyBase` (75m/164f), `Chibi` (38m/37f — creatures to protect), `Companion`,
  `BuildData`, `BuffSetting*`, `Command*` (Move/Attack/Jump/Trampoline),
  `EnemyDatabase`/`EEnemyDef`/`ETowerDef` (data tables), `PickupManager`,
  `FruitShop`, `MedalManager`.
- **Graphics:** Unity renderer + `UnityEngine.PostProcessing`; `CameraManager`
  (32m) and many `GameCamera*` modes (TopDown, Behind, Dolly, Minimap, Title,
  Result, GameOver); `Billboard`, `AttackEffect`, `BeeEffectController`.
- **Input:** `ControllerPS4`, `ControllerDualShock`, `ControllerKeyboardAndMouse`,
  `ControllerXInput`, `ControllerNpad*` (Switch), `GestureManager` (42m),
  `ControllerButtonEvent`.
- **Sound:** `AudioEventHandler`, `AudioSettings`-type hooks; Unity audio.
- **Menus / UI:** `Q4.UI` (1,137m), `DialogMenuController`, `GameOverMenuController`,
  `BgMenuController`, `Title` flow, `LoadingTipsMap`, `CustomFont`.
- **Saving:** native `SavedGames.prx` plugin + `GamePreferences` (19m/19f),
  `SaveIcon.png`; `GameCoreInventory`/currency persistence.
- **Progression / meta:** `AreaLock`, `AreaStageInfoMap`, `AreaUnlockRainbow`,
  `DifficultySettings`, `ClothingUnlock*`, `DLCManager`, `EndGameSceneMap`.
- **Out of scope (online/multiplayer):** `Q4.Networking` (669m), Steamworks
  (2,226m), `UnityNpToolkit2`, `AnalyticsManager`, `LocalMultiplayerListener`,
  `Multiplay*`, `DevelopScene_NetworkScene`.

## 6. Scenes (from globalgamemanagers)
- `Assets/Scenes/UI/Splash_Screen/splash_screen_01.unity`
- `Assets/Scenes/UI/Title_Screen/title_screen_01.unity`
- `Assets/Scenes/Develop/Stage/DevelopScene_StageMain.unity5` (main gameplay)
- `Assets/Scenes/Develop/DevelopScene_NetworkScene.unity` (multiplayer — skip)

## 7. Size estimate (from metadata v23)
- Whole image: **4,049 types / 26,477 methods / 18,786 fields / 5,115 string
  literals** (includes Unity + .NET framework).
- **Game-relevant logic ≈ 5,700 methods**: Q4 core 3,869 + Q4.UI 1,137 +
  GameCore 709 (minus online/analytics subsets).
- Largest classes: Player 177, PlayerMotor 87, GameCoreEnemy 82, EnemyBase 75,
  GestureManager 42, CameraManager 32, GameCoreBridge 32, GameCoreWaveManager 29.

## 8. Verification constraint
No mature PS4 emulator exists and this host is headless (no GPU), so running the
*original* PS4 code side-by-side is not feasible here. Verification will be
static (decompiled logic vs. metadata/strings/asset data) plus any footage the
user captures on their own PS4. A Unity-PC rebuild could run under a virtual
framebuffer for behavioral checks of the rebuild alone.