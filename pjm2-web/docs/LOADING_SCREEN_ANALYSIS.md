# Loading screen + tips — original analysis and port

Sources: `Q4.LoadingScreen*` / `Q4.LoadingTip` / `Q4.LoadingTipsMap` / `Q4.LoadingBackgroundShuffleBag` (decomp, RVAs below), prefab `LoadingMenu` + animator
`loding_screen_ctrl` (bundle `loading_ui`), `LoadingTipsMap` asset (bundle `globalsettings`). Extraction: `tools/assets/extract_loading_screen.py`
(-> `src/view/loading/loadingScreen.generated.ts`, `public/assets/ui/loading/*`), strings via `extract_ui_text.py` (all `tl_guide_title_*` / `tl_guide_detail_*`).

## Original behaviour
* Prefab (CanvasScaler 1920x1080, match 0.529): `Loc_BG` = 3 images of one 2048x1024 atlas (centre 1920x1024 at the top; two 56-px strips, 1024 and 896 long,
  rotated 90° CCW by the prefab and laid under it as the bottom 56 px row); `Loc_BG_Cover` = 1920x1080 rgba(0.035,0.161,0.349,0.302); tip title `Mess_Loc_Title`
  at (960,100) scale 1.2; tip text in `Text_Area` (1920x299 mask at y=661, text centred in it, left-aligned lines, Font_01, colour 0.878 grey, black outline);
  scroll arrows `shop_sign_up/down` (158x90, scale 0.5) shown only if the text overflows (`ScrollView.NeedScroll`); `Mess_Loc_Loading` ("LOADING", blue) is inactive in the prefab.
* `LoadingScreen` serialized: minTipDisplayTime **1.0**, maxTipDisplayTime **12.0**, backgroundFadeSpeed **1.0**, backgroundScaleSpeedMax **0**, scrollSpeed 5, loadingTipsEnable.
* Animator: `In` 1.5 s (root alpha cubic -0.593t³+1.333t² 0→1) → `InIdle`; bool `DisplayTips` → title/tip alpha 1 (`DisplayTips`/`OutIdle` states 0.333 s);
  `OnInIdle=false` → `Out` 1.0 s (alpha 2t³-3t²+1, tip text 0); `ShowScrollBar`/`HideScrollBar` fade the arrows.
* `Awake @0046a5d0`: `RefreshUnlocks`, `ChangeTips(true)`. `UpdateTips @0046b120`: timer += dt; `>= maxTip` → `ChangeTips` + timer = 0; the first tip text appears once the animator is in `InIdle`.
  `CoroutineChangeTip`: DisplayTips=false → swap title/content text → DisplayTips=true (+0.1 s) → `NeedScroll`/`ResetScroll`/`ShowScrollBar`.
  `Hide @0046abd0` → `CoroutineHideLoading`: wait timer ≥ minTip (1 s), `RemoveListeners`, `DisplayTips=false`, `OnInIdle=false`.
* `LoadingTipsMap.ShuffleTip @0046b360`: bag of unlocked tips (42 rows in the asset); pick random bag entry → used list + history; empty bag → random used entry not in history;
  history trimmed (first `(bag+used)/2`) when it reaches `bag+used`. `LoadingTip.Unlocked @0046d730`: stages ⊆ SaveData.unlockedStages, items ⊆ unlockedItems,
  `DLCManager.IsDLCAvailable(requiredDLC)`, networking tips need networking. In the asset no tip has stage/item conditions; 4 need networking (08_01–04) and 3 DLC (07_04, 07_05, empty row).
* Background = the tip's own `atlas` texture (`GetNextBackground @0046c040` matches tip.atlas to the backgrounds' centre-sprite texture; 25 backgrounds `loading_bg_001..025`).
  The new picture is activated on top with alpha 0 and rises by `backgroundFadeSpeed`/s; the old one is then deactivated. `CoroutineTransformBackground` (random drift/zoom) scales by
  backgroundScaleSpeedMax = 0 → no zoom.

## Port
`LoadingScreenModel.ts` (pure: curves, `TipShuffler`, timeline) + `LoadingScreenUi.ts` (DOM, `UiRoot`-anchored, cover backdrop) wired in `src/main/game.ts` `showLoading/hideLoading`
(shown for hub and stage loads; the dev progress bar/text sit over it at the bottom edge). Tests: `tests/view/loadingScreen.test.ts`.

## Exact vs approximate
Exact: all serialized timings, In/Out curves, prefab geometry/colours, the 42 tip rows + atlas mapping, shuffle algorithm, hide rule (≥1 s then Out), background cross-fade rate.
Approximate: tip-text fade length (0.333 s = state clip length; transition durations not decoded); the +0.1 s `WaitForSeconds`; offline unlock env (no DLC/network, save conditions unused as no tip has any);
`{jump}`/`{c_l_stick}`/`{interact}`/`{c_r_stick}` inline gamepad icons replaced by keyboard words (WASD/Space/E/Mouse), other icon tokens dropped; scroll is wheel-only (original: right-stick `OnScrollMove`);
canvas scale uses the port's match-width scaler (original 0.529); the "LOADING" label (prefab-inactive) is shown; background drift not reproduced (it is scaled to 0 / unclear random velocity).
Not verified visually (headless GL too slow) — check on a GPU machine.
