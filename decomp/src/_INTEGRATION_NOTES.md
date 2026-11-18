# Integration notes — cross-session compile & consistency

Snapshot taken while sub-agents (enemy/AI, wave/tower/projectile, Q4 bridge)
were still landing files. Re-run the full integration compile once all agents
complete. Harness: /tmp/opencode/intcheck (copy of decomp/src + stubs.cs).

## REAL BUGS to fix (apply after owning agent finishes)
1. **GameCoreWaveManager.cs — invalid C# backing-field name.** Field declared as
   `private bool <introSequenceFinished>k__BackingField;` with matching get/set.
   `k__BackingField` is the compiler-generated name from the IL2CPP dump; it is
   NOT valid C# source. Replace with an auto-property:
   `public bool introSequenceFinished { get; private set; }   // 0xB4`
   (the metadata shows a get_/private set_ pair → it was an auto-property).
   Owner: wave/tower agent. Blocks ALL builds.

2. **RESOLVED rodata constants** (see _RODATA_CONSTANTS_NOTES.md) — apply to
   GameCoreWaveManager.cs: SpawnStartEpsilon 0.0→**1.0** (DAT_00b7c480),
   OffsetAngleScale 1.0→**Mathf.Deg2Rad 0.01745329** (DAT_00b7c484). The two
   0.0 epsilons were correct. Verify the comparing instruction's exact DAT
   before substituting (shared literal pool).

## Already fixed this session
- Events.cs: `BuffSetting`→`Q4.BuffSetting`, `TowerUpgrade`→`Q4.TowerUpgrade`
  (both are Q4-namespace types; confirmed dump.cs TypeDefIndex 2669/3420).

## External (out-of-scope) types the landed SIM references
These are Q4 view / engine types the reconstructed GameCore sim depends on but
which are NOT part of the sim reconstruction. For a headless sim compile they
need stubs; in the real Unity rebuild they come from the Q4 layer:
- UnityEngine: Animator, Behaviour (add to engine stubs).
- Q4 wave/view: WaveManager, WaveResource, WaveData(+SpawnDataList), SpawnData,
  BossMinionSpawnData, DifficultySettings(+nested Difficulty enum, Instance,
  EnemyToSpawnByDifficulty, ValueCoinByDifficulty), GamePreferences(.Instance
  .difficultySetting), CatmullCurve, PathEdit(+EPathSegType), Fruit.
- Q4 enemy/view: EnemyBase, EnemyAttributesSettings(+StrengthDamageInfo,
  ClassDamageInfo), TowerBase, Structure, NatureTree, Player, Home, Shop,
  TowerUpgrade, TowerUpgradeSettingGeneric, AreaStageInfoMap, InteractionObject,
  Jarvis, GameInfoController, MiniDialogController, AudioEventHandler, Q4.UI.*,
  Layers, MonstersAudio, GlobalSounds, AISettings, StageMain, StageHub,
  GlobalSettingsContainer<T>, Pickup*, HiddenTreePickup, PickupManager(+nested),
  Extensions(RemoveAtSwapBack/RemoveSwapBack), Q4.Networking.NetworkMatch.
- GameCore sim types not yet landed (wave/tower agent owns): GameCoreTower,
  GameCoreHome, GameCoreFruit, GameCoreTree, GameCoreProjectile(+Beam/Electric/
  Insect), TowerState, GameCoreNetworkBridge.

## Sim-layer compile blocked (expected, mid-flight)
GameCoreEnemy.cs (landed) calls members on GameCoreTower/GameCoreHome/
GameCoreFruit/GameCoreProjectile which the wave/tower agent hasn't landed yet.
A full sim compile is only meaningful AFTER that agent completes. GameData layer
compiles + loads clean standalone (DATA_LAYER_OK, 1873/1873).

## Next integration pass (when agents done)
1. Fix k__BackingField + rodata constants in GameCoreWaveManager.cs.
2. Rebuild /tmp/opencode/intcheck stubs to cover ONLY the external surface above
   (remove stubs for types now landed for real).
3. Compile GameCore/** + GameData/** → expect 0 errors; fix any cross-session
   signature drift (e.g. GameCoreEnemy↔GameCoreTower method shapes).
4. Then compile Q4/** view files against the same + Unity stubs.

## COVERAGE MAP — top-level GameCore classes not yet landed (as of Q4-bridge
## agent completion; wave/tower agent still running)
In wave/tower agent scope (expect to land): GameCoreTower (1784 ln),
GameCoreHome (1117), GameCoreProjectile+Beam/Electric/Gaseous/Gem/Insect/
Instant/Lightning/Trajectory (~6,100 total), GameCoreCharacterTemplate (78),
GameCoreFruit, and TowerState* FSM (dispatched as "tower FSM": TowerState 103,
Attack 586, Broken 107, Build 209, ChangeMag 156, Degenerate 51, Idle 908,
Machine 96, UpgradeAround 402).
AMBIGUOUS / UNASSIGNED — verify when agent reports, dispatch follow-up if missed:
- TowerHelper (1,548 ln — tower targeting/damage helpers)
- GameCoreTree (251 — fruit trees; referenced by landed Events + PickupManager)
- GameCoreShop (197 — build/upgrade purchase flow; IPlaceableViewObject impl)
- GameCoreInteractionObject (854 — IPlaceableViewObject impl)
- StateMachine_object_ / _TowerStateMachine_ / _TikimanStateMachine_ /
  State_TikimanStateMachine_ (generic FSM base, 339 total)
Also unassigned (Q4 side, view commands): Q4.Command/CommandAttack/CommandJump/
CommandMove/CommandTrampoline/CommandSignMenu/PlayerCommand — the pose/command
seam the bridge executes (NetworkCommand.ExecuteCommand). Needed for the
minimal playable slice (~4 commands per blueprint §6).
