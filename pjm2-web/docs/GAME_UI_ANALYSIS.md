# In-game UI analysis (wave UI + tower build menu)

Scope: how the ORIGINAL PixelJunk Monsters 2 draws/drives the gameplay UI, with
evidence, and how the web port reproduces it. Evidence sources:

* decompiled Q4 UI code: `decomp/decompiled/Q4.*.c` (Ghidra pseudo-C; function
  addresses below are the `@RVA` of the Il2Cpp user assembly), `decomp/il2cpp/dump.cs`
  (field/method tables);
* UI prefabs in the `globalsettings` AssetBundle (UnityPy typetrees, dumped with
  `.work/ui/dump_prefab.py`; 132 root prefabs: `Hud_02`, `Hud_TowerRing`,
  `start_call_01`, `clear_call_01`, `start_countdown_01`, `pause_01`, `result_01`,
  `game_over_01`, `Access_Icon_01`, ...), 328 Sprites, fonts/atlases in `main_assets`;
* raw rodata floats read from `Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000,
  sanity-checked against the known `DAT_00b7c448 = 1.0`).

Every UI prefab carries `CanvasScaler: ScaleWithScreenSize, ReferenceResolution 1920x1080,
matchWidthOrHeight 0`. All layout numbers below are in that reference space
(origin top-left, y down for anchored positions written as `(x, y)`).

## 1. The key finding: building is a RING MENU, not a shop

`Q4.Shop` / `Q4.FruitShop` / `Q4.UI.Shop*` are the **clothing/medal shop** (totem NPC).
Towers are built from a radial "ring" menu opened on a tree:
`Q4.UI.RingController` -> `Q4.UI.TowerBuildRingController` + a `UIStateStack` of
`RingStateBuildCategory` -> `RingStateBuildTowerIcon` -> `RingStateBuildTowerIconConfirm`
(upgrade/sell siblings `RingStateEvolve*` belong to the tower-level feature, see
`TOWER_LEVEL_UPGRADE_ANALYSIS.md`).

## 2. Text and fonts

`Q4.LocText` (Unity UI Text subclass) fields: `textLabel` (key into the TextDatabase,
`strings.json`), `fontName` (CustomFont asset), `textColor`, `outlineColor`, `shaderType`,
`tracking`, `emTtracking`, jitter*. Fonts (`main_assets`):

| name | source font | atlas | use |
|---|---|---|---|
| Font_02 | FOT-Yuruka Std UB | 1024x2048 RGBA | blue wooden display letters/numerals ("WAVE START", countdown, stage name, CLEAR, GAME OVER, PAUSE) — `shaderType 1`, atlas colours used as-is |
| Font_01 | FOT-Baby Pop Std EB | 2048x4096 white alpha mask, 1251 glyphs | body text; tinted by `textColor`, `outlineColor` black outline |
| Font_00 | FOT-Cezanne Pro B | 256x512 | small numerals |

Glyph metrics = Unity `Font.m_CharacterRects` (uv y-up, `vert` quad about the line centre,
advance) + `CustomFont.m_kerningList`. Extracted by `tools/assets/extract_ui_sprites.py` to
`public/assets/ui/fonts/*.{png,json}`; rendered by `src/view/ui/UiAssets.ts`
(`BitmapFont`, `renderText`). Check: `WAVE START` raw advance width = 1430 px, the reference
screenshot (`Screenshot ... 19.09.09.png`) shows ~1440 px at 1920 wide => font scale 1.0.
`tracking` (-6 / -15) is applied as 0.33 px per unit (approximation tuned to that screenshot).

Palette from prefabs: body (0.88) + black outline; value/gold (1,0.85,0.35) + (0.18,0.13,0.08)
outline; tower name (1,0.73,0.14); sub-title blue (0.15,0.73,1); dim menu entry 0.68; bonus
label (0.06,0.69,0.88).

## 3. Build ring (tower construction UI)

### 3.1 Flow (decomp)

1. `Q4.PlayerStructureSelector` keeps the structures whose player trigger the tikiman stands
   in; `PlayerInteraction.Update` calls `TowerBuildRingController.EnterHover(player)` ->
   `Q4.UI.AccessIconController` shows the access icon (`Access_Icon_01`: `ControlImage`
   92x92, `m_iconEscapeCode "interact"`, plus `ring_sign_01` 78x92 bubble) above the nearest tree.
2. Interact button -> `Q4.TowerBase`/tree `OnInteraction` -> `TowerBuildRingController.Show(player,
   structure)` -> `OnShow` pushes `RingStateBuildCategory` (for a tree; `RingStateEvolveUpgrade`
   for a tower). `RingController.uiPosLimitationInRate = 0.42` keeps the ring near the target.
3. `RingStateBuildCategory.OnCursorMove @005acf20`: stick magnitude `>= 0.5`
   (rodata `b7da4c = 0.5`), `angle = Vector2.Angle(up, v)`, `360 - angle` when `v.x < 0`
   (rodata `b7da50 = 360.0`): clockwise from up. `GetCategoryIndex @005ad000`: sector
   `(360/n) * 0.5` (rodata `b7da54 = 360`, `b7da58 = 0.5`), `categoryAngleThreshold = 45`;
   returns -1 (`b7da60`) outside the threshold.
   `IsHistoryCategory @005ac4c0` = `index == 2`. `CanConfirm @005ac4d0` = the category's
   Animator bool `OnDisable` is false.
4. `OnConfirm @005ac5b0` (category) pushes `RingStateBuildTowerIcon(categoryAnimator, index,
   isHistory)`. Icon ring: `iconAngleThreshold = 22.5` (45 deg spacing, `k_actualAngleBtwIcons`),
   cursor thresholds 10 / 8, `initialInputHoldDuration 0.25`, `initialInputAngleThreshold 15`
   (stick must leave the entry vector before it selects), `rememberLastCategory = 1`,
   `rememberLastSelection = 0`, `maximumHistoryAmount = 3`.
5. `RingStateBuildTowerIcon.CanConfirm @005afeb0` = `TowerRingIconHook.EnoughInventory &&
   Buildable`. `OnConfirm @005b00a0`: if it can confirm, creates
   `new BuildTowerCommand(prefab)` and `GameCoreNetworkBridge.AddPlayerCommand(playerID, cmd)`,
   `PushTowerSelectionHistory`, pushes `RingStateBuildTowerIconConfirm` (Animator `OnDecide`,
   then back to the first state) and plays the select sound. **The sim command is the existing
   `BuildTowerCommand` (`towerType` = prefab name)** — the port only changes WHICH prefab it carries.
6. Cancel (`RingState.OnCancel @005ab240`) pops one state; leaving the trigger
   (`OnOutHover`) / stage clear / game over close the ring.

### 3.2 Availability / greyed state (`Q4.UI.TowerRingIconHook`)

* `towerID` (int, 0 = empty slot) -> `ResetTowerID` pads it with `"D3"` ->
  `TowerDatabase.GetTowerPrefabByIDString @0054df60` (name `EndsWith("001")`).
* `GetTowerPrefab @005afbc0`: null (= slot hidden) when `DLCManager.IsDLCAvailable(tower.dlcLock)`
  fails (`tower_010` dlcLock 1, `tower_005` dlcLock 2).
* `Locked @005afb40` = `TowerBase.IsLocked @0054c210` = `Lockable.IsLocked @0043c520` =
  `!SaveData.unlockedItems.Contains(prefabName)` (Lockable on `tower_002/004/006/009`).
* `Buildable @005afa60` = `!Locked && !(singletonInScene && TowerBase.hasHiveTowerBuilt)`.
* `EnoughInventory @005aff60` = `HasInventory(Coin, costCoin@0x5c) && HasInventory(Gem, costGem@0x60)`.
* `UpdateIconDecorations @005ae800` drives Animator bools: `OnDisable` (= !Buildable: icon
  greyed), `OnRock` (= IsLocked: padlock sprite `ring_cursor_lock`), and on the cost row
  `OnDisableCoin` / `OnDisableJem` (= HasInventory fails). `DecorateIconAnimatorByHook
  @005af2e0` writes the icon sprite (`towerIcon@0x108`), the coin/gem numbers, and
  `HideCoin/HideJem` (cost < 1) + `SetActive(cost > 0)`.
* Tower name text = `TowerBase.towerName@0x110` (`tl_tower_name_0NN`) only when Buildable
  (`UpdateTowerNameText @005afd10`).

### 3.3 Prefab geometry (`Hud_TowerRing`, `TowerBuildRingController` fields)

* 4 categories `Ring_Build_Cat_01..04`, clockwise **0 = up, 1 = right, 2 = down (history),
  3 = left**. Icon `ring_icon_category_0N` 200x200, cursor `ring_cursor_01` 240x240, label
  `tl_ring_building_cat_00N`: 1 "All-Range", 2 "Air", 3 "Recent", 4 "Ground" (`Cat_03_Pos` is
  inactive in the prefab; history only appears once something was built).
* 8 tower slots per category, radius ~207, 45 deg steps clockwise from up
  (01 `(0,206)`, 02 `(147,146)`, 03 `(208,0)`, 04 `(147,-147)`, 05 `(0,-208)`, 06 `(-145,-147)`,
  07 `(-206,0)`, 08 `(-145,146)`). Slot -> `towerID`:

| category | slot -> tower |
|---|---|
| 1 All-Range | 1 -> 7, 2 -> 8 (Hive, singleton), 3 -> 10 (DLC), 8 -> 9 |
| 2 Air | 3 -> 11, 4 -> 12 |
| 3 Recent | (history, <= 3) |
| 4 Ground | 1 -> 4, 2 -> 5 (DLC), 5 -> 6, 6 -> 2, 7 -> 1, 8 -> 3 |

* per-slot text group: name 74 above, Value row 50 below (coin/gem icons 60x60), shown for the
  selected slot only. Centre "Button" group: `Mess_Loc_Player_Text` (`tl_hud_006` "1P" in
  multiplayer), `Mess_Loc_Info_Text`, `Action_BT_Loc` (button glyph).
* sounds (prefab): `sfx_ringmenu_openringmenu/select/confirm/cancel/closeringmenu`.

### 3.4 Ring preview

`Q4.UI.TowerBuildMenuPreviewer` (`SetTreeTarget`, `OnChange(towerPrefab)`): spawns the
hovered tower's attack-range preview (`m_attackPreview`) and highlights the trees it would
consume (`m_costTrees`). Port: attack range ring (`RangeIndicator`) for the highlighted tower
(`attackRangeInner + attackSpread`); cost-tree highlight is not drawn (deferred).

### 3.5 Port mapping (input)

| original | keyboard/mouse | touch | gamepad |
|---|---|---|---|
| interact -> open | `E`/`Enter` near a tree, or click/tap the tree (walk + open) or the access bubble | tap tree / bubble | A / Cross |
| stick `ring_menu_scroll` | `WASD`/arrows (direction -> angle), mouse hover | tap icon | left stick |
| confirm | `E`/`Enter`/`Space`, click selected icon | tap selected icon again | A / Cross |
| cancel | `Q`/`Backspace`/`Esc` (Esc closes the ring before it pauses), click outside | tap outside | B / Circle |

Gamepad *movement* of the tikiman is not wired in this port (pre-existing); the pad only drives the menu.

## 4. Wave UI

### 4.1 Wave start / clear calls (`Q4.StartCallMenuController`, prefab `start_call_01`)

* `Show @00528340(waveIndex, lastWave)`: `shown = waveIndex`; `if (!m_showWaveStartCall(=0) &&
  waveIndex == 1) shown = 0`; title = `waveTextPrefix "tl_wave_call_" + shown.ToString("D2")`
  -> `tl_wave_call_00 "WAVE START"` for the first wave else `"WAVE N"`; subtitle =
  `lastWave ? tl_wave_call_accent_03 "Last push!" : shown==0 ? accent_01 "Here they come!" :
  accent_02 "More incoming!"`; hide time `Time.time + showDurationInSeconds (4.0)`. Also registers the
  `menu_skipcallscreen` button.
* `ShowWaveClear @005276b0(waveIndex)`: subtitle `accent_04 "You made it!"`, title prefix +
  `D2(waveIndex)`, `waveClearShowDurationInSeconds = 3.0`.
* Triggers: `Q4.StageMain.OnWaveActivate @00527160` (from `Events.waveActivateEvent`, via the
  `DelayedWaveStartMenuShow` coroutine; `lastWave = waveProgressList.Count == waveIndex + 1`;
  first-wave vs later start sound `FirstWaveStart`/`WaveStart`) and `StageMain.OnWaveEnded
  @00527570` (`WaveClearBonus` sfx, then `ShowWaveClear` unless it was the last wave).
* Layout (reference px): accent `Font_01` `(968,367)`, title `Font_02` `(960,490)`.
  This reproduces the reference screenshot (`19.09.09`): big blue wooden "WAVE START" with
  the white "Here they come!" above it.
* The big blue "1" of screenshot `19.10.07` is the **start countdown**:
  `Q4.StartCountdownController` (prefab `start_countdown_01`: three `Mess` "1","2","3",
  `Font_02` at `(960,490)`). `UpdateCountdown @00534630`: index = `Clamp(3 - (int)(timeRemain +
  1.0), 0, 3)` (rodata `b7ceec = 1.0`) selects the Animator bool; sfx `LobbyCountDown` /
  `LobbyCountDownLast`. The port shows 3-2-1 for the last 3 s before the first wave activates
  (`stageStartDelay + remainingSpawnStartDelay + remainingWaveActivateDelay`).
* Animator clips (`ShowStageStart_01`, `HideStageStart_01`, `toHideStageStart_01`) were not
  decoded; `callEnvelope` is a documented approximation (0.3 s pop-in, hold, 0.4 s fade).

### 4.2 HUD (`Q4.GameInfoController`, prefab `Hud_02`)

`LateUpdate @0044cd20`: coin counter = `GetAvailableInventory(0)` minus the bonus accumulator,
gem counter = type 1. Layout (reference px): coin plank `player_coin_r` centre `(206,902)`
value right `x=246`; gem plank `player_gem_r` `(199,978)` value right `x=249`; chibi plank
`player_chibi` `(1704,988)`, value `"<n>/<total>"` right edge `1841` (`DecrementChibiCounterOnKill
@0044c6f0`, `"/{0}"`); wave meter: frame `wave_bar` centre `(900,76)`, number window
`wave_meter_bg` `(595,77)` containing `wave_number_NN` tinted (0.56,0.04,0), "WAVE" plank
`wave_bar_sign` `(525,61)`, track groove sprite-x 290..730 (= abs 727..1167, `progressbar_bg`
439 wide), one `WaveBarMonsterIcon` per wave starting at x=1177 and walking left toward the home
tree (`UpdateMonsterBarIcons @0044c880`, Animator float `PosBar`); bonus plank at `(146,818)` with
`tl_wave_call_22` label (`bonusCoinShowDelay 2.5`, `bonusCoinAnimationDelay 1.5`,
`bonusCoinPostAnimationDelay 1.0` from `GameInfoController.json`).

### 4.3 Enemy-incoming indicator (`Q4.UI.WaveTracker`, `Hud_02/Bubble_Enemy`)

`OnWaveActivate @005d0360` arms the tracker for the activated wave (`displayTime 4`,
`textDisplayTime 5`), `UpdateTrackedEnemy @005d0400` picks the wave's lead enemy,
`CanvasToCameraPositionConvert` clamps the bubble (`enemy_alert` 140x140 + arrow
`enemy_alert_point`, text `tl_hud_005 "Incoming!"`) to the screen edge and `UpdateArrow
@005d0eb0` rotates the arrow toward the enemy.

### 4.4 Stage clear / game over / results

`StageMain.OnStageCleared @00526da0` -> `DelayedResultMenuShow` after
`GameInfoController.m_stageClearDelay = 5.0`; `OnGameOver @00527800` ->
`DelayedGameOverMenuShow` after `m_gameOverDelay = 6.0`. Prefabs:

* `clear_call_01`: area `Font_01 (968,304)`, stage `Font_02 (960,433)`, `tl_in_game_003 "CLEAR"`
  `Font_02 (960,587)`, difficulty `Font_01 (968,722)`.
* `game_over_01`: `tl_gameover_001` `Font_02 (960,358)`, menu (Retry/Stage Select/Title) spacing 84.
* `result_01`: card 1686x306 @ `(960,696)`, header (area/stage/difficulty), separator, left
  column labels x=144 / values right x=881 at y 577/669/737/805 (Score, Coins, Gems, Waves
  Cleared), right column labels x=1041 / values right x=1778 (Best Score, Bonus, Clear Bonus,
  Chibis Saved), "New!" (0.88,0.24,0), `perfect_big_img` + `tl_result_010` at `(1533,311)`.
* `pause_01`: `PAUSE` `Font_02 0.76 (960,283)`, `Pause` blue `(960,195)`, vertical list spacing
  82 from y=436: Resume, Retry, (End Local Multi, 2P only), Stage Select, Options, Title Screen,
  How To Play; stage card `pause_stage_bg (286,176)`. `PauseMenuController` dialog labels
  `tl_dialog_text_033/034`.

### 4.5 Stage select / difficulty

`Stage_Select_02/03`, `stage_select_01`, `StartOutlineController` (area/stage/difficulty card
`start_outline_01`: stage name `Font_02 0.76 (960,488)`), `AreaStageInfoMap` (7 areas, 15 stages
available; stage 1 `initialLocked 0`). The web shell has no world map, so stage select is not
reproduced (strings Fun/Tricky/Mayhem `tl_difficulty_00N` are used in the stage cards).

## 5. What the port implements (files, `src/view/ui/`)

| file | role |
|---|---|
| `UiAssets.ts` | sprite/font loader; `BitmapFont` layout + canvas text (tint, outline, kerning) |
| `UiDom.ts` | 1920x1080 reference root, `place/spriteEl/textEl`, palette |
| `OriginalHud.ts` | coin/gem/chibi planks, wave meter with per-wave icons, bonus plank, enemy bubble |
| `WaveCalls.ts` | start/clear calls, 3-2-1 countdown, stage-clear call, timing + envelope |
| `GameUiFeature.ts` | glue: sim events (`waveActivate/waveEnded/stageCleared/gameOver`) -> UI, tracker |
| `BuildMenuModel.ts` | pure ring state machine (categories, slots, history, affordability) |
| `BuildMenuUi.ts` | DOM ring (prefab geometry) |
| `BuildMenuFeature.ts` | hover/access icon, input (keys/mouse/touch/pad), BuildTowerCommand, range preview |
| `OriginalScreens.ts` | pause / result / game-over (GameShell `skin`) |
| assets | `tools/assets/extract_ui_sprites.py` (sprites, fonts, tower icons), `tools/data/export_tower_defs.py` (12 towers), `extract_ui_text.py` (+ring/pause strings) |

Sim determinism: no sim file changed; the ring issues the existing `BuildTowerCommand`. The
tower database provider now resolves all 12 prefab contracts (generic contract builder), so the
command can carry any tower; replay hash unaffected (replay builds tower_001).

## 6. Unverified / deferred

* Animator curves (call pop/fade, ring icon pop, `PosBar`, `OnDecide`) not decoded: approximations.
* `GetCategoryIndex` hysteresis branch (-1 return) and icon `ClampTo*` helpers: re-implemented
  as nearest-visible-sector / nearest-occupied-slot within threshold.
* Tower-unlock progression (`SaveData.unlockedItems`) is not ported: `Lockable` towers default
  unlocked (`BuildMenuFeature.setUnlocked`); DLC towers (005, 010) are hidden like the original
  without DLC.
* Non-arrow towers use the sim's stand-in projectile/detector (pre-existing DATA GAP in
  `tower001Contract`); `tower_005` gem/`tower_008` hive special mechanics are not simulated.
* Score / Best Score / Bonus / Clear Bonus on the result card (formula in
  `StageResultMenuController`) not ported.
* Keyboard glyph sprites do not exist in the assets (only Xbox/PS4 `action_bt_*`): key caps are CSS.

## 7. Bug report: "towers don't construct when a tower option is selected"

Root cause (found while verifying the ring end-to-end): the sim side was always fine —
the ring issues `BuildTowerCommand(tree.handle, prefab)`, `GameCoreInventory` is charged and a
`GameCoreTower` enters `TowerStateBuild` (pinned by `tests/view/buildMenuSim.test.ts`, which drives
the ring with the keyboard through the real sim for every option and checks tower type, tree
claim, `TowerStateBuild`, coin/gem deduction, and the reject feedback). The failure was the VIEW:
`game.ts` `CHARACTER_DEFS` only preloaded the `tower_001` GLB, so for every other option
`createTowerViewerFactory` hit `library.get(name) === null` and fell back to a model-less
"data-record view" — coins were spent and the sim tower existed but nothing appeared/rose.
Fix: the GLBs of every ring tower (002/003/004/006/007/008/009/011/012) are preloaded with
`tower_001` (4.4 MB total). Also: the old click-to-auto-build path (arrive -> BuildTowerCommand
for tower_001) was replaced by "arrive -> open the ring".

Key handling vs the tower-level ring (`TowerLevelFeature`): the build ring registers a *capture*
keydown listener. When closed it consumes only `E`/`Enter` and only if a tree is hovered and no
tower is hover-selected (`towerSelected()`), so `E` on a tower still opens the Upgrade/Dismantle
ring (W/S/Q there). While the build ring is open it is modal: `WASD`/arrows = cursor, `E`/`Enter`/
`Space` = confirm, `Q`/`Backspace`/`Esc` = cancel (Esc never reaches the pause handler), every
other key is swallowed, and `tickPlayerMovement` stops the tikiman.
