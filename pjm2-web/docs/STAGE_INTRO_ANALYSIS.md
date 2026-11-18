# Stage intro sequence ("level cut scene") - analysis and port

Evidence: `decomp/decompiled/*.c` (Ghidra), `decomp/il2cpp/dump.cs` (field layout), raw x86-64 disassembly
of `Il2CppUserAssemblies.elf` (file offset = VA + 0x4000; `objdump -D -b binary -m i386:x86-64`), rodata
floats read straight from the ELF, and serialized data of the `stages` AssetBundle (UnityPy,
`tools/stages/extract_stage_intro.py`).  Code: `src/view/intro/*`, tests `tests/view/stageIntro.test.ts`.
Unity LH world coordinates everywhere in the data; the view converts (x,y,z)->(-x,y,z), quat (x,y,z,w)->(x,-y,-z,w).

## 1. The original is real-time, driven by StageMain.MainSequence

`Q4.StageMain.<MainSequence>c__Iterator0.MoveNext @00528730` (coroutine started by `StageMain.Start @005260a0`):

| step | call | what |
|---|---|---|
| 0 | `GestureManager.AddButtonEvent(all players, "", InputBlock)`, `IsIntroSequence = true` (+0x69), `GameCoreBridge.CreateInstance` | sim starts; empty input catch-all; pause blocked (`StageMain.OnPauseMenu @00526b50` returns while +0x69) |
| 1-3 | `StageLoader.CheckForDirectMapLoadSetup`, wait `SceneLoader.IsLoading` | |
| 4 | `StartOutlineController.Show @00528ec0`, wait while `isShowing` | stage card (area / stage / difficulty / best score) + intro cameras |
| 5 | `StartCountdownController.Show`, wait while `isShowing` | 3-2-1 (`start_countdown_01`, the big blue wooden digits) |
| 6 | `StartCallMenuController.Show(!m_showWaveStartCall = 1)` -> "WAVE START / Here they come!", remove input catch-all, `IsIntroSequence=false`, fire a UnityEvent, wait while showing (4.0 s) | |
| 7 | `GameInfoController.Show` | HUD slides in (only caller besides EventCameraTrace) |

`StageMain.Start` plays the stage BGM immediately (music cue = stage start, not intro end).
`StageMain.OnWaveActivate @00527160`: wave index 0 plays `FirstWaveStart` sfx but does NOT show the call when
`StartCallMenuController.m_showWaveStartCall == 0` (prefab value) - the first "WAVE START" comes from step 6.

## 2. Does the sim run during the intro? What does skip do?

* The sim is created at step 0 and ticks normally during the intro.  `GameCoreWaveManager.Update` returns while
  `!introSequenceFinished` (GameCoreWaveManager.cs:211) so no wave timer runs; `OnIntroSequenceFinished @004d5540`
  sets `introSequenceFinished = true` and `stageStartDelay = 4.75` (0x40980000): the first wave activates 4.75 s after
  the skip (plus the wave's own spawn/activate delays).
* `GameCore.Network.IntroSequenceSkipCommand.ExecuteCommand @004DD790` = `Events.introSequenceFinishedEvent.Invoke(player)`.
  Only `Q4.StartOutlineController.OnConfirm @00535020` creates it (`GameCoreNetworkBridge.AddPlayerCommand(playerId, cmd)`);
  it is refused while `+0xf8` (already sent) or `+0xe0 != 0`.  `+0xe0` is initialised to 1.0 by the ctor @00534970 and
  decremented `Max(x - dt, 0)` in `Update @00534c70` => **1.0 s confirm lock-out** from Show.  Input: button
  `menu_skipcallscreen` (`AddInputCallbacks @005353c0`).  Multiplayer non-hosts return before sending.
  The player does not "hold": one press.  (Original: a 30 s auto-confirm timer `+0xe4` exists but is only decremented for
  network matches.)
* `StartOutlineController.Update`: `isShowing && introSequenceFinished` -> `UIController.Hide(HideFinished)`; the
  `HideCoroutine` (`UIController._HideCoroutine_c__Iterator3`) runs the hide animation first and invokes the callback
  after it; `HideFinished @00535230` = `CameraManager.SwitchCameraTo<follow camera>(immediate=0)`.
  `isShowing` falls at the same time so MainSequence proceeds to the countdown.
* The web headless sim (`npm run sim:stage1`) queues the command immediately via `SimDriver` and ignores the view: unchanged.

## 3. Camera chain (Q4.GameCameraIntro / CameraManager)

Scene hierarchy of stage 1 (`3d_stage_001_data/IntroRoot`, identity transform): children in order
`GameCameraIntro01`, `GameCameraIntro02`, `Chibi01` (ChibiIntro), `RoadMarkPathRoot`.

* `CameraManager.InitCameras @0073a6c0`: no walkthrough mode => `ActivateCamera<GameCameraIntro>` (first intro camera);
  `StartOutlineController.Update` re-activates it if another camera is active.
* `GameCameraIntro` fields (dump): `startDelay`, `nextCut`, `cameraAnimator`, `remainingDelay`, `hasUpdatedOnce`.
  `Start @00443320` finds `nextCut` = the next SIBLING that has a GameCameraIntro (wrapping), so the cuts form a
  ring.  `Update @004434f0`: `Animator.GetCurrentAnimatorStateInfo(0).normalizedTime >= 1.0` (rodata b7b6a4) **and**
  `!GameCoreWaveManager.introSequenceFinished` => `nextCut.remainingDelay = nextCut.startDelay;
  CameraManager.SwitchCameraTo(nextCut, immediate 0, 0, 0, camMove 1)`.  The animator is enabled only while
  `remainingDelay == 0` (startDelay is 0 in stage 1).  => the two cuts **loop forever until the player confirms**.
* Serialized data (`extract_stage_intro.py`, `public/assets/data/intro/3d_stage_001_env.json`):

| cut | controller / clip | FOV | length | motion |
|---|---|---|---|---|
| GameCameraIntro01 | `cam_stage_001_01_ctrl` / `intro_cam_move_01` | 60 | 7.0 s | static shot: constant clip (21.501, 3.773, -4.357), rotation (0.0369,0.7923,-0.0445,0.6074) = looks +x, slightly down, at the chibis running in |
| GameCameraIntro02 | `cam_stage_001_02_ctrl` / `intro_cam_move_02` | 20 | 30.5 s | Mecanim StreamedClip, 3 position curves (cubic per key frame, 17 key frames): starts (24.77,12.75,3.75), climbs to y 21.7 (3 s), sweeps a wide path over the stage, ends (0,10.71,12.07) = 45 deg pitch looking at the hut at the origin; rotation fixed (0,0.9239,-0.3827,0) |

  Only the root `position` binding is animated (ClipBindingConstant: 1 generic binding, typeID 4 attribute 1).
  The state machine has one non-looping state (speed 1, no transitions).  StreamedClip key evaluation:
  `value = ((a*dt + b)*dt + c)*dt + d`, dt = t - key time; verified continuous at every key frame (test).
* **Fade switch** = `GameCameraSwitchBlackInOut` on each camera (serialized `switchInTime/switchOutTime/fadeInTime/fadeOutTime`:
  intro01 0.4/0.3/0/0, intro02 1.0/0.3/0/0, follow camera 0.4/0.3/0/0.15, fovChange 1 only matters when LEAVING it).
  `OnRenderImage @00445d10` (asm verified): out-phase of the old camera: factor = 1 until `t >= fadeOut`, then
  `(switchOut - t)/(switchOut - fadeOut)`; at `t >= switchOut` `CameraManager.OnSwitchCamera` swaps cameras
  (`UnityEvents` camera-switch listeners fire: see section 4).  In-phase of the new camera: `f = Min(f + dt/switchIn, 1)`,
  alpha = `Clamp01(1 - (switchIn - f)/(switchIn - fadeIn))` (mixes the normalised f with seconds: a 0.4 s camera is fully
  visible after 0.16 s, the 1.0 s camera fades in linearly over 1 s).  The very first camera fades in from black too.
  `GameCamera.animator`/GameObject re-activation restarts each cut's clip at 0 on every swap.

## 4. Chibis (Q4.ChibiIntro / PathRunner)

* Serialized (`Chibi01`, world (32.895, 3.089, -3.592), yaw -90 deg): `m_chibiRunDelay 0.016`, `m_chibiJumpDelay 0.016`,
  `m_chibiFaceAngleRange 0`, `PanicJumpMinVel 3`, `PanicJumpMaxVel 7`, `MoveSpeed 2.0`, `EndFacingAngle 296`, **3 paths**
  of 8 points each (offsets relative to Chibi01, rotation identity) running from the right of cut 1's frame towards -x/-z
  (ends ~ (24.4,-0.46,-6.8)); chibi prefab = `Chibi`/`chibi_00`.
* `Awake @00743150`: creates one chibi per path (`CreateChibis @00743450`, rotation = transform rotation * AngleAxis(Random(-range,+range))),
  Chibi `+0x70 = 1`, `AccMin (+0x74) = Random(2.5,3.0)` (b7fe28/2c), `AccMax (+0x78) = 5.0`; runner k's runDelay =
  `0.016 + sum Random(0.075, 0.15)` (b7fe20/24); registers `OnCameraSwitch` on the camera-switch UnityEvent.
* `PathRunner.Update @00744090` (asm @7440e1..744375):
  `runDelay -= dt; if runDelay <= 0 && pathTime < last { seg = p[i+1]-p[i]; f = Clamp01((last - pathTime) * 4.0) [b7fe44];
  speed = Lerp(0, MoveSpeed, f); pathTime += speed/|seg| * dt; if pathTime < last { Chibi.DestPos = Sample(pathTime);
  if f < 1.0 [b7fe48] Chibi.DestRot = AngleAxis(EndFacingAngle) } }`; once `pathTime >= last - 0.1` [b7fe4c] the jump delay
  counts down; at <= 0 the chibi gets `+0xce = 1`, `m_jumpDelay = Random(0.25,1.5)` [b7fe50/54] and its panic jump
  velocities (Min/Max).  `Sample @00744630` = `startPos + Lerp(p[i], p[i+1], frac)` (identity start rotation).
* The runners only write `DestPos/DestRot`; `Q4.Chibi.UpdatePosition @007421b0` (acceleration chase, ground snap, run/jump
  animator params) then moves the rig.  **That chase is approximated** (exponential chase with AccMin, hop gravity 20).
* `OnCameraSwitch(from, to)`: `from` is an intro camera and `to` is not => `Object.Destroy(ChibiIntro)` (runners vanish);
  `Q4.Home.OnCameraSwitch @00460560` activates a list of inactive home chibi objects (home `IntroNumHomeChibi 17`, 3 arrive).
  `ChibiIntro.EnableChibiJumping` / `SpreadOutChibi` have no callers in the decompile (dead code).

## 5. After the skip (timeline, seconds after the confirm; sim runs throughout)

| t | event | source |
|---|---|---|
| 0 | confirm -> `IntroSequenceSkipCommand` queued; sim: `introSequenceFinished=true`, `stageStartDelay=4.75`; cut switching stops | OnConfirm, OnIntroSequenceFinished |
| 0..H | stage card hides (H = clip `HideStageStart_01` 1.0 s, **link to the prefab not traced**) | UIController.HideCoroutine |
| H | `HideFinished`: fade-out of the current cut (0.3 s) starts; countdown starts | HideFinished, MainSequence |
| H+0.3 | camera swap to the follow camera: runner chibis destroyed, 3 home chibis revealed, `GameCameraTopDown` active (fade-in 0.16 s) | OnSwitchCamera, ChibiIntro/Home.OnCameraSwitch |
| H..H+3.6 | countdown: `m_timeRemain` 3.5 (`0x40600000`), index = `Clamp(3 - (int)(t + 1.0), 0, 3)`: Three 3.5..2.0, Two 2..1, One 1..0, Zero 0..-0.1; hides at `<= -0.1` (b7cee8); sfx `LobbyCountDown` (=`sfx_menu_countdownbase`) for 0..2, `LobbyCountDownLast` (=`sfx_menu_countdownfinal`) for Zero | StartCountdownController.Update/UpdateCountdown |
| H+3.6 | "WAVE START / Here they come!" call (4.0 s), pause allowed | MainSequence step 6 |
| 4.75+ | wave 0 activates in the sim (FirstWaveStart sfx) | WaveManager |
| H+7.6 | HUD slides in (`GameInfoController.Show`, slide time approximated 0.5 s) | MainSequence step 7 |

With H = 1.0 the countdown ends at 4.6 s, next to the sim's 4.75 s - consistent, which supports H ~ 1.

## 6. What the port does (src/view/intro)

* `IntroRig.ts` - serialized rig types + `evalClipCurve` / `cameraWorldPose` (headless).  Per stage: `/assets/data/intro/<scene>_env.json`
  via `introRigUrl(stageScene)`; `loadIntroRig` returns null if the stage has none (legacy immediate skip).
* `IntroTimeline.ts` - the sequence/camera/fade state machine above (`INTRO_CONST` documents each constant).
* `ChibiIntroRunner.ts` + `IntroChibiView.ts` - PathRunner port + approximated chase, `chibi_00` rigs with `run`/`jump`/`idle_01`.
* `IntroCardUi.ts` - stage card (Font_02 stage name at (960,488); area / difficulty / hint line positions approximate).
* `StageIntroController.ts` - glue: feeds dt + `waveManager.introSequenceFinished`, applies the camera pose after
  `StageCamera.update`, fade overlay, input (Enter / Space / click / tap -> `tryConfirm` -> hook queues the REAL
  `IntroSequenceSkipCommand`), hooks into `GameUiFeature` (3-2-1 via `WaveCallsUi.setCountdown`, WAVE START call via
  `showCall`, HUD slide), `bindFlow(flow)` (claims `intro`, begins on enter, `flow.complete('intro')` when the follow camera has faded in).
* game.ts (small edits): rig load, `startIntroOrSkip()` replacing the immediate command, player frozen while the intro is
  active, `?nointro` flag (legacy), pause blocked during the intro (`IsIntroSequence`), debug handles `introState/introAdvance/introConfirm`.
* `GameUiFeature.deps.introOwnsCalls` suppresses its sim-driven 3-2-1 / wave-0 call while the intro owns them.

## 7. Unverified / approximated

* Card hide duration H (1.0 s, from the `HideStageStart_01` clip length, prefab link untraced), digit pop animations
  (`CountdownThree 0.667`, `Two 0.133`, `One 0.167`, `Zero 0.4` not applied), HUD slide time/shape, card layout.
* Chibi chase / jump physics (`Q4.Chibi.UpdatePosition`), which 3 home chibis are held back (last 3 by creation order).
* Whether the player can walk during the intro in the original (the empty-name input catch-all suggests not); the port freezes
  the player until the hand-off.  Player spawn pose is unchanged (sim spawn).
* Screen-material shader of the fade (assumed black multiply: image * alpha).
* Stages other than those with an extracted rig fall back to the immediate skip.
