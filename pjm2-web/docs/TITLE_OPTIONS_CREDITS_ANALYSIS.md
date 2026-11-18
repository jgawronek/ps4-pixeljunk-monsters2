# Title screen, option menu and credits — analysis and port

Scope: how the ORIGINAL PixelJunk Monsters 2 title screen (`Q4.TitleScreenController`), option menu
(`Q4.OptionMenuController`) and staff credits (`Q4.StaffCreditsController`) work, and how the web port
reproduces them. Evidence sources:

* decompiled Q4 code `decomp/decompiled/Q4.*.c` (Ghidra pseudo-C; addresses below are the RVA of
  `Il2CppUserAssemblies.elf`), field tables from `decomp/skeleton/Q4.cs`;
* the title SCENE (`Media/level3` + `sharedassets3.assets`: RectTransforms, Image/LocText/UIButton
  MonoBehaviours, 6 sprites, 25 AnimationClips, 3 AnimatorControllers, the title jingle AudioClip);
* UI prefabs in the `globalsettings` AssetBundle (`option_01`, `credits_01`, `common_bg_01`,
  `common_dialogue_01`, `credit_screen_ctrl`), TextDatabase tables (`common_en`, `dialog_en`,
  `credit_en`) in `main_assets`;
* rodata floats read from `Media/Modules/Il2CppUserAssemblies.elf` at file offset = vaddr + 0x4000
  (`10.0` @b7a668, `0.1` @b7a66c/b7a670, `1.0` @b7b6e8; sanity `1.0` @b7c448).
  No CONCAT44 values are used for any number below.

Extraction: `tools/assets/extract_title_ui.py` (title scene + option/credits prefabs -> `public/assets/ui/title-ui.json`,
title sprites, `sfx_stage_titlejingle.wav`) and `tools/assets/extract_ui_text.py` (extended with title/option/help/
controls strings, the two option dialogs, the first-play prompt and the `credit_en` table: 231 -> 340 keys).
NOTE: `extract_title_ui.py` merges its sprites into `sprites.json`; re-running `extract_ui_sprites.py` rewrites that
file, so run `extract_title_ui.py` afterwards.

## 1. Title screen

### 1.1 Where it lives
`Media/level3` is the title scene. Its hierarchy: `RequiredSceneLoader("3d_stage_000_editor")` (additively loads the
3D home diorama `3d_stage_000` from the `stages` bundle: the title is drawn OVER the hub island with the tikiman),
`DummyCanvas`, and the UI prefab-in-scene `title_screen_01` (Canvas 1920x1080 reference + `TitleScreenController`
fields: `tikimanLocator` (GameObject), `versionNumber` (Text), `showDLCButton`, `m_pcPositionY=-210.0 (0xc3520000)`/`m_pcSpacing=70.0 (0x428c0000)` (decoded from the ctor bit patterns by hand)
(ctor @00541a20), `m_quitDialog = "Do you want to quit the game?"`, `m_quitButton = Mess_Loc_Sel_07`). `level0` is the
splash/logo scene (`Logo1..5_BG`, `Mess_Loc_Loading`), `level2` a leftover launcher UI, `level1` empty.

### 1.2 Screen layout (reference 1920x1080, y down)
Derived from the RectTransforms (Screen_Loc is a full-screen stretch; (0,-y) top-left anchors are pixel offsets,
(0.5,0.5)-anchored groups add (960,540)):

| node | sprite / text | position |
|---|---|---|
| `title_m2_logo` | `title_m2_logo` 1430x512 | centre (930, 443) |
| `title_m2_mask` | `title_m2_logo_mask` 74x100 (skull peeking out of the "O") | ap (410,-235) pivot (1,.5) from logo TL |
| `title_m2_cover` | `title_m2_logo_cover` 201x279 (front ring of the "O") | ap (469.5,-238.5) from logo TL |
| `title_number` | `title_number` 329x434 (blue "2") | (1643, 591) |
| `title_pixeljunk_logo02` | `title_pixeljunk_logo_02` 911x225 | (957.5, 75) |
| `Loc_Develop/Image` | `title_copy` (stretched to 512x64, "(c)2007-2018 Q-Games Ltd.") | (960, 1013) |
| `Version_Loc` | `tl_title_010` "ver." + `Num` "000１" (BuildData.VersionString) | TL (96, 60) |
| `GameStart_Loc/Mess_Loc_Sel_01` | `tl_title_004` "Press any button" | (960, 832) |
| `MainScreen_Loc` (VerticalLayoutGroup) | entries `Mess_Loc_Sel_02..07` | x 960, y 753 + 84 k (k over ACTIVE entries) |

Menu entries (prefab order, UIButton onClick): `Sel_02` Play `tl_title_005` (OnPlay), `Sel_03` Ranking `tl_title_006`
(OnRanking, **inactive** in this build), `Sel_04` Options `tl_pause_006` (OnOptions, **inactive**), `Sel_05` Credits
`tl_title_007` (OnCredits), `Sel_06` Downloadable Content `tl_title_009` (OnDLC), `Sel_07` "QUIT" (OnQuitGame, inactive:
PC only; `OnQuitDialogConfirm`). Strings: `tl_title_001 "MONSTERS 2"`, `_002 "Developed by Q-Games, LTD."`, `_004 "Press any button"`,
`_008 "PixelJunk(TM)"`, `_010 "ver."`.

### 1.3 Animator (`title_screen_ctrl`, `title_screen_sel_ctrl`, dumped with UnityPy; clip lengths in seconds)
```
InStart(2.5, event SFX @0 = sfx_stage_titlejingle) -> StartIdle(4.0 loop)
StartIdle --StartPressed--> StartOut(2.0, blend .25) --exit@0.5, blend .2--> InIdle(4.0)
InIdle/In(0.667)/Out(0.667)/OutIdle(0.333)  driven by bool OnInIdle (menu shown / hidden)
OnCredits: StartCredit_Title(4.0) [AllClear(4.0) when m_isGameClearCredits] -> CreditTitleFinish(1.0)
           --FinishCredit--> InStartWait --ReturnTitle(2.0)--> InIdle        Cancel -> ReturnTitle
HideMenu (bool HideMenu) = leave the title (Play)
layer LogoMonster(60.2 loop) = the skull peeking out of the "O" (compressed muscle clip, curves NOT decoded)
button Animator: Idle -OnEnter-> Enter(0.2) -> EnterStay; EnterStay -OnDecide-> Decide(0.2); -!OnEnter-> Exit(0.033); Disable(0.97)
```

### 1.4 Code flow (addresses are RVAs)
* `Awake @00541ba0`: instance, if `StageTransferInfo` has a target and `RequestShowCredits` is false -> `IsTitleScreen=false`,
  `StageSelectController.Show` directly + `StageSelectInventory/Rainbow.Show` and the title hides itself (returning from a stage).
* `Start @00541ee0`: `Invoke("Show")`, subscribes `UnityEvents.EnterTitleScreen`.
* `Show @00541fb0`: only when `!isTitleScreen`; waits for `SplashScreenController.IsLoading()==false` and `SceneLoader.IsLoading()==false`;
  fires `UnityEvents.EnterTitleScreen`, `EventSystem.SetSelectedGameObject(null)`, `Animator.SetBool("HideMenu",false)`,
  `InitIntroAnimation`, sets the version text, then `OnCredits` if `RequestShowCredits`.
* `ShowAnimationCouroutine` -> `StartIntroAnimation` (the TIKIMAN is moved to `tikimanLocator` and gets the animator trigger
  `TitleScreenEnter`; the camera is `GameCameraTitle`, switched via `CameraManager.SwitchCameraTo<GameCameraTitle>`) or the
  `ReturnTitle` trigger when coming back from credits.
* `OnStartPressed @00543200` (gesture, any button): `Animator.SetBool("StartPressed", true)` (LATCHED: it is a bool, so pressing
  during InStart counts), `m_hasSeenPressStart = true`, unregisters itself.
* `OnPlay @00542720`: `SwitchCameraTo<GameCameraTitle>` -> `UnityEvents.ExitTitleScreen` -> hide animation (`HideAnimationCouroutine`:
  waits `OutIdle`, `SetBool("OnInIdle",false)`, `HideMenu`) -> `OnPlayHideComplete @005438a0`:
  1. `SaveData.hasSeenFirstPlayGuidePrompt == false` -> set it true, dialog `tl_dialog_text_036` "Do you wish to take a look at the manual?"
     (`OnReadSimplePlayGuide`: Yes -> play guide `play_guide_01`; No -> `tl_dialog_text_038` "You can view the manual at any time from the Pause menu!");
  2. else DLC unlock dialogs (`tl_dlc_01/02_dialog_text_01` when `GetDLCPurchaseState==1`, plays `UnlockArea`, `ChangeCameraTargetByAreaID`);
  3. else `ResetCameraTarget`, `StageSelectController.Show` (+ `StageSelectInventoryController.Show`, `StageSelectRainbowController.Show`).
* `OnOptions @005444f0`: `OptionMenuController.Instance.Show(parentTitleController)`.
* `OnCredits @00544570` -> `CoroutineGoToCredits`: disables navigation of all widgets, plays `StartCredit_Title` (`AllClear` after game clear),
  registers gesture `menu_skipcredit`, waits for `Base Layer.CreditTitleFinish`, then `StaffCreditsController.Show`.
  `CreditsToTitleActivateWidgetList` waits for `InIdle` and re-enables widget navigation.
* `ClearAllStagesDialogCheck/OnAllStageClearDialogConfirm`: after the last stage was cleared once, a dialog offers the credits.

### 1.5 First launch
`GamePreferences` ctor defaults (§2) + `SaveData.hasSeenFirstPlayGuidePrompt=false`: first Play shows the manual prompt before
stage select. Splash scene (`level0`) precedes the title; the title only appears after splash+scene loading finished.

## 2. Option menu (`option_01`, `Q4.OptionMenuController`)

### 2.1 Rows (prefab, reference px; label x=544 left-aligned (TextAnchor 3), value text centred x=1274, colours from LocText.textColor)
| row | prefab nodes | y | widget | values |
|---|---|---|---|---|
| Controls `tl_option_003` | Sel_01/Change_01 | 421 | UIButton (icon `action_bt_04_win` @ x=1326) | opens `UI.ControlMenuController` |
| Music `tl_option_004` | Sel_02/Change_02 | 503 | UISelect min 0 max 10 (init 5) | 0..10 |
| Sound Effects `tl_option_005` | Sel_03/Change_03 | 585 | UISelect 0..10 | 0..10 |
| Y-Axis Camera `tl_option_013` | Sel_05/Change_05 | 667 | UISelect text | `tl_option_014` Normal ("false") / `_015` Inverted ("true") |
| 2P Icon Display `tl_option_017` | Sel_06/Change_06 | 749 | UISelect text | OFF `_019` / ON `_018` |
| Action Button Display `tl_option_022` | Sel_08/Change_08 | 831 | UISelect text | OFF/ON |
| (Language `tl_option_007`, Sel_04) | | 749 | **inactive** | Ja `_008` / En `_009` |
| (Set Controllers `tl_option_020`, Sel_07) | | 913 | **inactive** | button |

Title "OPTIONS"(`tl_option_001`, Font_02) @ (960,283), caption `tl_option_002` blue (0.145,0.733,1) @ (960,189). Value text/arrow tint
(0.878,0.243,0); unselected labels grey 0.678. Arrow sprites `option_arrow_left/right` 63x54, placed `textWidth/2 + spacing`
(40 numbers / 42 text; QHorizontalLayoutGroup spacing) from the value centre (Sel_04 in the prefab: text 158 wide, arrows at +-121).
Background: `common_bg_01` = full-screen (0.145,0.263,0.380,a=0.502) wash (`BgMenuController`, `showBGMenu`). Help bar (`UIHelpData`):
`menu_confirm tl_help_001 "Select"`, `menu_cancel tl_help_002 "Back"`, `menu_resetOptions tl_help_006 "Reset"` (visible only if `HasNonDefaultProperties`).

### 2.2 Persistence (`Q4.GamePreferences`, owned by `SaveData.gamePreferences`; ctor @0044e7c0)
Defaults: `cachedBGVolume = cachedSEVolume = 1.0f` (0x3f800000), `languageCode = OS_Utility.GetSystemLanguage()`, `invertY=false`,
`useInteractConfirmButton=true`, `show2PJoinLabel=true`, `showActionIcon=true`, `difficultySetting=1`.
* `set_bgVolume/set_seVolume` store the float and call `ApplySettingsToGame @0044eaf0` = `MonstersAudio.OnAudioLevelsChanged(bg, se)` (+ language refresh).
* `SavePreferences @0044f000` = `SaveData.Save()`. `HasNonDefaultPreferences @0044f070`: bg!=1 || se!=1 || invertY || !show2PJoinLabel || !showActionIcon.
  `ResetAllPreferences @0044f0b0` = `SaveData.ResetGamePreferences` + `ApplySettingsToGame`.

### 2.3 Behaviour
* `InitFromSettings @003daeb0`: bg/se -> `RoundToInt(v * 10)` (`DAT_b7a668 = 10.0`), `invertY`/`show2P`/`showActionIcon` -> index 0/1, then snapshots all select indices (`initialOptionValues`).
* `UISelect.OnLeft/OnRight @005d62e0/@005d6590`: `Max(min, v-1)` / `Min(max, v+1)` **clamped, no wrap**; the value-changed event + `GlobalSounds.MenuSettingChange` only fire when the value changed.
* `OnValueChanged @003db940`: bg/se rows -> `MonstersAudio.OnAudioLevelsChanged(v*0.1, v*0.1)` (**live preview**, `DAT_b7a66c = 0.1`).
* `haveAnyValuesChanged @003daa80`: any select index != snapshot.
* `OnConfirm @003db580` (menu_confirm on a value row): if changed -> dialog `tl_dialog_text_001` "Do you wish to save the current settings?"; Yes -> `OnConfirmDialog` (flags delivered, hide with Apply); No -> stay.
* `OnCancel @003db6a0`: unchanged -> close; changed -> same dialog; Yes -> Apply + close; No -> `OnConfirmCancel(false)`: close **without** applying and restore the audio levels from `GamePreferences`.
* `OnResetOptions @003dbd60` (gesture `menu_resetOptions`): if changed or `HasNonDefaultPreferences` -> `tl_dialog_text_002` "Do you wish to restore the default settings?" -> `ResetAllPreferences` + `InitFromSettings`.
* `Apply @003dbeb0`: bg/se = value*0.1, language parse, `invertY = (value=="true")`, `show2P/showActionIcon = (index==1)`, `SavePreferences`, `ApplySettingsToGame`.

## 3. Credits (`credits_01`, `Q4.StaffCreditsController`)
* 7 static pages `Screen_01_President .. Screen_07_etc` (8/9/15/21/18/17/13 text nodes), every text a `LocText` Font_01, TextAnchor centre,
  titles (0.145,0.733,1.0) (`tl_credit_title_NNN`), names (0.878) (`tl_credit_name_NNN`), `tl_credit_kana_NNN` (empty in English). Positions are prefab `ap`
  (top-left pivot, y down), e.g. page 1: "Developed by" (960,242) / "Q-Games, Ltd." (960,310) / "Executive Director" (960,499) / "Dylan Cuthbert" (960,568)...
* Animator `credit_screen_ctrl` (globalsettings): per page `In_N`(1.5) -> `Idle_N`(8.0) -> `Out_N`(0.5, page 7: 4.0) -> `In_{N+1}`; trigger `Skip`
  (`StepPage @00764540`, input `menu_confirm`; `ExternalStepPage` from the title) jumps `In_N/Idle_N` -> `Idle_{N+1}` (page 7 -> `Out_07`); `Cancel`
  (`ShutdownMenu @00764f60`, `menu_cancel`) exits; after `Out_07 -> CreditFinish` `Update @00764b50` calls `DismissScreen @00764ec0`
  (`MonstersAudio.PlayBGMusic(m_LastBGM)`, hide). Auto-run = 7*(1.5+8) + 6*0.5 + 4.0 = **73.5 s**.
* Music: `GlobalSounds.bgmCreditsScreen` = `sfx_tiki_creditdance` (2.8 MB). In the original the scene behind is `3d_stage_000_credit` and the tikiman
  plays dance animations (`CreditDanceEnd` trigger on `m_playerAnimator`, 'last phase' timing `m_lastPhaseLength`).

## 4. Navigation, input, sounds
UI navigation is Unity `Selectable` navigation (explicit/automatic, no wrap) driven by `Q4.GestureManager` menu gestures (confirm/cancel/resetOptions/skipcredit +
stick/dpad); sounds are `GlobalSounds` (`menuMove`=sfx_menu_selectitem, `menuConfirm`, `menuCancel`, `menuSettingChange`, `menuOpen`); resolved by
`tools/assets/map_globalsounds.py` (`audio-out/globalsounds_map.json`).

## 5. Port

| file | role |
|---|---|
| `src/main/flow.ts` | shared flow state machine (boot, title, options, credits, stageSelect, stageLoading, intro, playing, results); API documented at the top |
| `src/main/titleFlow.ts` | `TitleHost`: orchestrates title/options/credits, input, audio, persistence |
| `src/main/titleBoot.ts` | glue with game.ts (`bootTitle`, `?notitle`, owns `stageLoading`) |
| `src/main/preferences.ts` | `applyPreferences` (volumes -> AudioManager buses) + subscription bus (invertY, showActionIcon, ...) |
| `src/view/ui/TitleModel.ts`, `OptionsModel.ts`, `CreditsModel.ts` | pure state machines/timelines (tests) |
| `src/view/ui/TitleFeature.ts`, `OptionsMenuFeature.ts`, `CreditsFeature.ts`, `TitleUiKit.ts` | DOM views with the original art (reference px) |
| `src/view/ui/MenuInput.ts` | keyboard + gamepad menu input; pointer handled by the views |
| `src/view/save/SaveData.ts` | `GamePreferences` subset persisted (bgVolume, seVolume, invertY, show2PJoinLabel, showActionIcon, hasSeenFirstPlayGuidePrompt; muted kept) |
| `src/view/audio/AudioManager.ts` | `setBgmVolume/setSeVolume` category buses (BGM bus vs SFX bus) |
| `src/main/title-lab.ts` + `ui-lab.html?scene=title-*|options*|credits-N|guide` | no-WebGL screenshots |

Flow hand-off: Play -> `flow.go('stageSelect', {from:'title'})`; unclaimed `stageSelect`/`intro` pass through; `stageLoading` is started by `titleBoot` (the legacy
START path) and completed to `intro`/`playing`. `?notitle` keeps the old START button (and still drives the flow so subscribers fire).

Browser audio rule: when the AudioContext may not start (no prior user activation) the title shows a `gate` phase (logo hidden, blinking "Press any
button"); the first key/click/tap/pad button creates + unlocks the AudioManager inside the gesture and only then runs InStart so the jingle at t=0 is audible.
If the user already interacted (`navigator.userActivation.hasBeenActive`) the gate is skipped.

### Applied vs stored
bg/se volume -> applied (live preview while editing, persisted on Apply, restored at boot and when the stage starts). invertY / showActionIcon: persisted and
published through `preferences.onPrefs` (the web top-down camera has no Y look to invert; the interaction-icon HUD may subscribe). show2PJoinLabel: persisted only
(no local 2P). Language: English only (row inactive in the prefab, too).

## 6. Not verified / approximated
* The 3D home diorama (`3d_stage_000`, tikiman at `tikimanLocator`, `GameCameraTitle` camera) is NOT reproduced; the title shows over the already-loaded stage scene
  (flat sky in the UI lab). Credits scene `3d_stage_000_credit` and the dancing tikiman likewise.
* Clip CURVES (logo drop-in, skull peeking, button Enter/Decide scale, page In/Out slides) live in compressed muscle data and are approximated (ease-out/overshoot,
  linear alpha); the DURATIONS are exact.
* Title position of the Options entry: the PS4 title prefab has Options (`Sel_04`) and Ranking inactive (Options is reached from the pause/stage-select flow there); the port
  shows Play / Options / Credits at y 753/837/921 (the active-entry spacing 84 of the prefab layout).
* Title music: `bgm_title` exists in the audio inventory; that it plays on the title (rather than from the home scene's AudioSource) is assumed. Menu sounds are the real GlobalSounds clips.
* Dialog box art uses `dialogue_bg` (9-slice, border 54) and `dialogue_sel`; box growth and button placement are computed (DialogMenuController sizes them at runtime).
* "Controls" panel is a port stand-in for `ControlMenuController` (web key map with the original `tl_controls_*` names).
* Manual prompt: "Yes" has no separate manual screen in the port (the pause menu's How To Play panel); "No" shows `tl_dialog_text_038`.
* Rounding: `Mathf.RoundToInt` (half-to-even) is implemented for the 0..10 step conversion.
