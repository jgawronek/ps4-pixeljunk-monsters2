# Player camera controls — analysis and port

Sources: decompiled `Q4.GameCameraTopDown.c`, `Q4.GameCameraBehind.c`, `Q4.CameraManager.c`, `Q4.CameraController.c`, `Q4.GameCameraSwitchBlackInOut.c`; raw disassembly of
`Il2CppUserAssemblies.elf` (file offset = RVA + 0x4000) for the float constants Ghidra drops; serialized values via UnityPy (`BuildPlayer-fps_check_3d_stage_001_env`,
`globalgamemanagers` InputManager). Addresses are RVAs.

## 1. What the original does

### 1.1 Inputs (`Q4.CameraController.SetupCallbacks @007395c0`, `Q4.CameraManager.SetupInputCallbacks @0073c1a0`)
GestureManager axes/buttons: `camera_rotate` (right stick, `ReceiveCameraRotateInput @00739890`; Y is multiplied by the invert-Y preference table DAT_00b7bb80), `camera_reset_parallel`
(button), `camera_focus_forward` (axis), `camera_zoom_in/out`, and in `CameraManager` **`camera_switch`**. The Unity InputManager (globalgamemanagers) lists `camera_switch` with positive button
**"q"** (the only keyboard binding of the camera axes), `camera_rotateH/V` = joystick axes 0/1. `CameraManager.m_inputEnabled (+0x19)` is set to 1 in the ctor and not overridden by the
stage scene, so the player CAN toggle cameras in a stage.

### 1.2 TopDown camera (`GameCameraTopDown`)
`Rotate @00448870` stores the stick in `m_rotateInput (+0xbc)` (Y scaled by the preference table); ignored while a sign/tower ring is open or in 2P mode. `UpdateCameraTransform @00447eb0`
dispatches on `rotateType (+0x40)`: `(type+6)&0xf` → 6, 7 = orbit variants (AngleAxis around the cross of centre direction × input), **8 = ParallelMove**. Every stage and the hub serialize
**rotateType 2 = ParallelMove** (+ `parallelMoveRange (7.8, 5)`, chase 1000/10, return 3.5/5, post wait 0.17), so in the shipped game the right stick **pans** the top-down view around
the player; it never rotates. `CameraFollow.ts` already ports that state machine (`CameraFollow.rotate`, `StageCamera.setParallelInput`); it simply had no input. Zoom: `minDistance == maxDistance == 30`
(no distance zoom in the original; the port's 18..45 wheel zoom is a web extension, already present). `camera_reset_parallel` → `CheckSnapWhileParallelMoving @00448b40` (zero the pan).

### 1.3 Behind camera (`GameCameraBehind`, 2300 lines)
Third-person boom: serialized (stage 1, MonoBehaviour pid 8052) offset (0,0.8,0), distance fixed **1.75** (distanceMin = Max = default), view limits **±15°** + `overRotateLimit 25`,
rotate speeds **120°/s H, 90°/s V**, rotate acceleration 3.5, follow smoothing **0.15 s H / 0.3 s V**, `followInAir`, `autoCorrectRotation` (threshold 45°, speed 50, accel 4, idle speed 5, accel 1,
idle time 3 s), camera FOV 50, `lookAtType 1` (smoothed look-at). Update order `Update @0043ede0`: `UpdatePosition` (`UpdateRotateVector @0043f470`, `UpdateTargetLookAtPosition @0043f860`, zoom,
occlusion `GetOccludeDistance`/`UpdateCameraClampTracing @0043fb80`, `UpdateCameraPosition`) → `UpdateRotation @0043eff0` (manual `LookRotation(lookAt - pos)`, `UpdatePlayerIdle`, `UpdateAutoRotation @004402e0`,
`HorizontallySnapToPlayer` while occluded) → `UpdateDepthOfField @0043f0d0`.
* `m_currentEuler (+0x148)`: x = yaw, y = pitch. Position = `smoothLookAt + Quaternion.Euler(-pitch, -yaw, 0) * (0,0,-distance)`.
* Rotate vector: `MoveTowards(current, input, dt*3.5)`, vertical component follows immediately; `yaw += cur.x*120*dt`; `pitch += sin(π/2·shape)*cur.y*90*dt` with `shape = t` (moving down) / `1-t` (up),
  `t = (pitch-(min-over))/(2·over+(max-min))`; pitch is clamped to `[max(min-over,-90), min(max+over,90)]` (DAT_00b7b66c/b670) and eases back inside the limits when there is no vertical input.
* Auto rotation: only without manual input; proceeds when the player has been idle > 3 s or is moving. `angle = Angle(cameraForward, stickDirection)` folded (`>90 → 180-angle`); rotating iff `> 45`.
  Step = `MoveTowards(speed, clamp(signedAngle(cam, playerForward),±75)/75 * autoRotateSpeed * dt, accel*dt)` added to yaw; idle values (5, 1) after 3 s. Sign table DAT_00b7bb58/b7bb68 = {-1, +1} on `cross(cam,player).y < 0`.
* `InheritCamera @0043e342` (on switch to Behind): `ForceToPlayerBack` (yaw += signed angle camera→player forward) unless the camera target is occluding.

### 1.4 Switching (`CameraManager.SwitchCamera @0073c8d0`, `GameCameraSwitchBlackInOut`)
Edge-triggered on the `camera_switch` press; ignored while a switch runs or in 2P mode. `GetNextCamera @0073e5c0` cycles `GameCamera.cameras` over the TopDown/Behind entries. The outgoing
camera's `GameCameraSwitchBlackInOut` (serialized, identical in all stages) runs: `switchOutTime 0.3 s`, `switchInTime 0.4`, `fadeOutTime 0.15`, `fadeInTime 0`;
**Behind (camTransformChange)**: `UpdateSwitching @004455e0` each frame sets `viewLimitMin = -90`, `distanceMax = 100`, rotate input (0, -2) (`rotateOutSpeedScale 2`), `ZoomOut(5)` (`zoomOutSpeedScale 5`)
→ the boom swings up over the player and pulls back; at the end the saved `m_previous*` values (limit, pitch, distance, offset) are restored; **TopDown (fovChange)**: FOV `MoveTowards(fov, 0, dt*30)` clamped at 1°.
After `switchOutTime` the camera is swapped (InvokeOnSwitch + callback), then the black screen material (`screenMaterial`, OnRenderImage) clears.

### 1.5 DepthOfField focus
See `DEPTH_OF_FIELD_ANALYSIS.md` ("Focus animation").

## 2. Port
| file | role |
|---|---|
| `src/view/stage/BehindCamera.ts` | pure Unity-space port of GameCameraBehind (rotate, look-at smoothing, pitch limits, auto-rotation, ForceToPlayerBack, switch-out animation, DoF focus) |
| `src/view/stage/CameraSwitch.ts` | switch timeline (serialized BlackInOut values for both cameras) |
| `src/main/stageCameraModes.ts` | session driver: key bindings, applies the Behind pose to the three.js camera (x mirrored), black overlay, behind-relative WASD, DoF settings |
| `src/main/stageSession.ts` | 6 small hook-ups (`cameraModes` construction, keydown, input mapping, per-frame update, `setDof`, dispose) |
| tests | `tests/view/behindCamera.test.ts`, `tests/view/cameraSwitch.test.ts`, `tests/main/stageCameraModes.test.ts` |

### Controls (web port)
| key | original |
|---|---|
| **Q** or **C** | `camera_switch` (InputManager "q"): toggle TopDown ↔ Behind (ignored during the intro, menus, pause, results) |
| **J / L**, **I / K** | `camera_rotate` stick X / Y: top-down = PAN (rotateType 2), behind = rotate the boom |
| **F** (hold) | `camera_focus_forward`: DoF focus +20 m, FOV -5° (Behind camera) |
| **V** | `camera_reset_parallel` (top-down): recentre the pan (implemented as a camera snap onto the player) |
| mouse wheel | web extension (zoom 18..45, top-down) — the original boom is fixed |
| WASD / arrows | move; relative to the Behind camera's yaw while it is shown |

### Exact vs approximated
Exact (from code/data): all serialized parameters, the rotate/pitch/limit maths, look-at SmoothDamp (vector H + scalar V), auto-rotation maths, ForceToPlayerBack sign table, DoF focus/FOV formulas and constants,
switch timings and the Behind switch-out animation values, TopDown FOV shrink, input name/binding "q".
Approximated / not decoded:
* the sign of the vertical stick (original depends on the invert-Y preference; here stick up = look up);
* the over-rotate return branch (Ghidra shows a Nullable<float>; implemented as easing to the nearest limit at `overRotateBackSpeed`);
* auto-rotation uses the LAST stick direction while idle (the original reads `PlayerController.CurrentInputVector`, whose idle value was not decoded) so the idle swing-behind works;
* the black overlay curve (ramp over the last `fadeOutTime` of the out phase, 0.15 s fade-in since the serialized `fadeInTime` is 0) — OnRenderImage / the screen material were not decompiled;
* camera occlusion (`GetOccludeDistance`, `CameraTarget.occluding`, `hideBlockingTrees`) — no per-frame camera linecast in the port; boom is always 1.75;
* grounded flag is always true (the lookAt follows the live Y; `followInAir` is serialized true anyway);
* keyboard stands in for the gamepad stick/trigger; no mouse-drag rotate (not in the original);
* the TopDown→Behind direction animates only the TopDown FOV (as serialized); Behind→TopDown swings the Behind boom as serialized.
* `GameCameraDolly` (interpolates two Behind cameras' `[CamInterpolateParam]` fields by zoom rate) is not in stage 1 and not ported.
