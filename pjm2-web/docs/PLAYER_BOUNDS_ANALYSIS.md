# Player (tikiman) movement bounds — how the original does it

Scope: PixelJunk Monsters 2, stage `3d_stage_001`. Everything below is derived
from the decompiled `Q4.PlayerMotor` (Ghidra pseudo-C in `decomp/decompiled/`,
constants re-read from raw x86-64 / rodata of `Il2CppUserAssemblies.elf`) and
from the shipped bundles (`globalsettings`, `globalgamemanagers`, stage scene).
Port: `src/view/player/PlayerMover.ts`; tests: `tests/view/playerMover.test.ts`.

## 1. Verdict

There is **no custom "bounds" code**. The tikiman is a Unity
`CharacterController` and is constrained purely by **PhysX collision against the
stage colliders, filtered by the Unity layer-collision matrix**:

| What stops him | Collider(s) in stage 001 | Layer |
|---|---|---|
| Map edge (invisible wall, closed ring ~25–32 u from origin, y −9.9..50) | `terrain_001_player_col` (130-tri mesh) | 26 `Art_PlayerArea` |
| Terrain, cliffs, rocks, deco meshes | `terrain_001 (Optimized)`, 2 more meshes, 112 boxes, 1 sphere | 29 `Art_Terrain` |
| Home hut | `home_001` sphere r 1.729 @ origin (serialized on the prefab as layer 29) | 29 |
| Trees / props | 457 capsules named `collision` (r 0.125–0.225 × scale) | 16 `AutoAvoidAbstacle` |
| (unused here) | Art_LargeProps 30, Art_SmallProps 31 (only 9 *disabled* spheres), Interaction 19 (dynamic), Bounce 22, Items 12 (inactive) | — |

He is **not** stopped by: rivers (Water layer 4, only trigger boxes — he can
wade in; at water depth >= 0.6 he **drowns and respawns**), enemies (9), towers
(tower prefabs carry **no colliders** — verified by scanning all `structures`
bundle colliders: only `home_001`, `GateTrigger`, LookTarget/detector triggers),
the camera area (27, camera-only), chibis/`PlayerToCharacters` (13).

`terrain_001_camera_col` (layer 27) is the camera's collision; the player does
not touch it. `terrain_001_player_col` (layer 26) is the player's: it is the
map boundary.

## 2. Evidence

### 2.1 Player object (globalsettings bundle, GameObject `tikiman_01`, layer 8 `Players`)
(UnityPy dump; CharacterController path id 3649893383731521726)

```
CharacterController: height 0.75, radius 0.15, center (0,0.4,0),
  slopeLimit 52.2, stepOffset 0.4, skinWidth 0.02, minMoveDistance 0, isTrigger false
Rigidbody: mass 10, useGravity false, isKinematic false, constraints 112 (freeze rot)
children: Collision (layer 13, capsule r0.25 h0.7 c(0,.55,0), non-trigger)  -> water trigger probe
          InteractionDetect (layer 8, sphere r0.225 trigger)  SoundZoneMonitor (20, r6 trigger)
          BlockingTreeHider (layer 8, script only: hides trees blocking the camera)
Q4.Player (MonoBehaviour 2514285418080110840):
  m_WalkSpeed 3.5343  m_RunSpeed 4.41787  m_Acceleration 12  m_Deceleration 16
  m_HoldingFruitSpeedScale 0.75  m_JumpGravity 25  m_JumpSpeed 7.5
  m_SlideAngleMin 46.4  m_SlideSpeed 7  m_SlopeUpAngle 45 / Scale 0.75  m_SlopeDownAngle 25 / Scale 1.25
  EnableFixedTimeStepMovement 1  m_EnableNewCollisions 1  m_SpeedPotion 1
  m_EnableDrowning 1  m_DrownDepth 0.6  m_DrownRespawnDelay 5  m_RespawnDuration 1
  m_RespawnMovementTime / Height : AnimationCurves (copied into PlayerMover.ts)
```
Field offsets from `decomp/skeleton/Q4.cs` (Player: walk 0x24, run 0x28,
accel 0x2C, decel 0x30, holdFruit 0x3C, jumpGravity 0x50, slope fields
0x78..0x84, drown 0x114.., newCollisions 0x1BF).

### 2.2 Layer-collision matrix (what the CC can touch)
`Media/globalgamemanagers` PhysicsManager `m_LayerCollisionMatrix` (32 words;
symmetric — verified), row 8 (`Players`) = **0xE7C914C8**:
layers {3,6,7,10,12,16,19,22,23,24,25,26,29,30,31}. Names from the TagManager
(`Q4.Layers` is a plain singleton, `.ctor` @ 0x4694F0). Triggers (10) never
block a CC. Water (row 4 = 0x19022C8) collides with {Enemies 9, PlayerToCharacters
13, AutoAvoid 16} — **not Players**, i.e. water volumes are only ever seen by the
player's child `Collision` capsule (layer 13) for trigger events.
`PhysicsManager`: skin/contact offset 0.01, `m_QueriesHitTriggers = true`,
`m_QueriesHitBackfaces = false`.

No script ever reads `PlayerAreaMask`/`PlayersMask` (grep of all decompiled
files: only `Q4.Layers.c`, `Q4.PlayerMotor.c` reference the layer API) — the
matrix is the whole mechanism.

### 2.3 Movement path (Q4.PlayerMotor, addresses = Ghidra VA)
* `UpdateMotor` @3E91C0 → `UpdateMovementInternal` @3F6230 in **fixed 1/60 s
  steps** when `EnableFixedTimeStepMovement` (accumulator `+0x174`; loop
  `while acc >= 0.0165 { step(1/60); acc -= 1/60 }`; constants DAT_00b7a6d8
  0.0165, b7a6dc 0.016666668, b7a6e0 −0.016666668; **disasm** at 3ED4D2/3ED4F5/
  3ED514: `vucomiss … [0xB7E6D8]`, `vmovss … [0xB7E6DC]`, `vaddss … [0xB7E6E0]`).
* `UpdateMovementInternal`: moving if `|input|² > 0.005` (b7a794; disasm
  3FA29F); accel 12 when moving else decel 16 (also decel when `CanMove()` false);
  target speed = walk 3.5343 (or run 4.4179 with run input + `m_SpeedPotion`)
  × `GameCorePlayer.GetSpeedScale()` × 0.75 if holding fruit × slope scale
  `Lerp(1, up/down scale, clamp01(angle/slopeAngle))` using `m_facingSlopeAngle`
  (+0x80; ≤0 → down scale 1.25 over 25°, >0 → up scale 0.75 over 45°);
  `vel.xz = Vector3.MoveTowards(vel, target, accel·dt)`; `ApplyGravity`; then
  **`CharacterController.Move(vel·dt + external(0x88) + external(0x94))`**;
  then `WorldCollisionHandler`. No bounds test, no clamp, no position limits.
* `ApplyGravity` @3F60B0: if `cc.isGrounded` → `vy = Max(vy, −1.0)` (b7a790),
  else `vy −= m_JumpGravity(25)·dt` (jump-boost variant uses 0x4C).
* `UpdateGroundDetection` @3F0DB0 (every frame, dt ≥ 1e-4): 5 terrain-mask
  `Physics.Linecast`s (centre, ±0.3375 along facing, ±0.3375 along right;
  segment ±0.8 vertical, consts b7a728/b7a72c/b7a730) → ground normal and the
  signed slope along facing → `m_facingSlopeAngle`; `m_SlideAngle` ≥
  `m_SlideAngleMin` (46.4°) forces `TikimanStateSlideDownSlope`.
  With `EnableNewCollisions` the grounded flag comes from
  `OnControllerColliderHit` @3F3760: hit normal.y > 0.2 (b7a764) and contact
  point within `radius·0.5` (b7a768) of the feet counts as ground; hits on
  layer `AutoAvoidAbstacle` (16) are ignored for this bookkeeping (they still
  *block* — the CC has already resolved them).
* `WorldCollisionHandler` @3F3960: collision-flag reactions (fall damage /
  HighFall when fall > `m_MaxFallDistance` 4, bounce, stun).

### 2.4 Water / drowning (OnTriggerStay @3F54F0, `TikimanStateDrown`)
`OnTriggerStay(other)`: if the other collider's layer is in `WaterMask`
(1<<4): `Linecast(pos+up·10, pos−up·10, WaterMask, QueryTriggerInteraction.Collide)`
(b7a78c = 10) → `waterDepth = hit.y − pos.y`; if `m_EnableDrowning` and
`waterDepth >= m_DrownDepth (0.6)` → `DropFruit()`, `ForceCurrentCommand(
TikimanStateDrown)`, Mode = 7 (Drowning). `TikimanStateDrown.Tick` counts down
`m_DrownRespawnDelay` (5 s; reduced by button-mashing), then lerps from the
current position to the closest `PlayerRespawnPoint`
(`PlayerRespawnPoint.GetClosest(LastKnownGroundPos)` @744B40, nearest by
distance) over `m_RespawnDuration` (1 s) using `m_RespawnMovementTime` /
`m_RespawnMovementHeight` curves, then back to Idle. `LastKnownGroundPos`
(+0x11C) is stored from `UpdateMotor` while grounded in Mode 0.
Stage 001 water: 4 trigger boxes `WaterZone*` (layer 4, tops at y −1.7/−1.54/
−1.24); 27 `RespawnPoint*` transforms (layer 18) in the scene.

No `KillBelowWorldY` exists for the player (the −20 constant is `GameCoreFruit`
only) — falling off the map is prevented by `player_col`.

### 2.5 Does the sim move/limit the player?
No. `GameCorePlayer` has no velocity/motor state; movement is view-side
(`PlayerMotor`), the pose is sampled into the sim each tick
(`GameCoreNetworkBridge.OnGameCoreTicked`, see
`decomp/src/Q4/_Player_EnemyBase_NOTES.md` §0–1). Hence the headless replay
(`npm run sim:stage1`, which scripts the player with a straight-line walk and
null physics) is untouched by this work: hash stays **0x27227819f56d94ad**.

## 3. Why the port could walk anywhere
`tickPlayerMovement` simply did `player.position += dir · 4·dt` — a demo
constant, no physics at all; `GroundConform` only set the render y. The
existing Rapier world was used for the sim's LoS/ground queries only.

## 4. What was implemented
`src/view/player/PlayerMover.ts` (pure TS + the existing `PhysicsWorld`;
headless testable):
* Unity 5.6 `CharacterController.Move` re-created with Rapier **capsule shape
  casts** (`world.castShape`) against the static stage colliders, filtered by
  row 8 of the layer matrix (`PLAYER_COLLISION_MASK`), triggers ignored:
  up pass (stepOffset 0.4 lift) → horizontal collide-and-slide (up to 8
  iterations, corner stop) → down pass (undo lift + gravity); slopeLimit 52.2°
  "walk experiment" (a stepped move that lands on a >52.2° face higher than the
  start is refused and redone as a plain slide → PREVENT_CLIMBING); skin 0.02
  kept as resting gap (PhysX contact offset).
* Locomotion constants/accel/decel/slope scales/gravity/fixed 1/60 step as in
  §2.3; the 5-linecast ground/slope probe; water-depth probe + drown →
  respawn (closest respawn point, 5 s + 1 s arc with the serialized curves).
* `game.ts`: `tickPlayerMovement` now only computes input intent (WASD /
  touch / click-to-walk), `stepPlayerMover` runs the mover and writes
  `GameCorePlayer.position` (x,y,z; y is real now, was the spawn y), the view
  uses that y; click-to-walk gives up when stuck against a wall. `Shift` =
  run (original: separate run input). Without physics the old unconstrained
  motion remains as fallback.

### Known deviations / not ported (honest list)
* **TikimanStateSlideDownSlope** (forced slide on slopes ≥ 46.4°, slide
  speed 7) is not implemented: the player simply cannot climb > 52.2° and
  stands on 46–52° slopes. Jump/hip-attack/bounce/stun/HighFall states and the
  `WorldCollisionHandler` reactions are not ported (no input/animation for them
  yet), nor the airborne wall-bounce nudge (0x160 hit counter).
* PhysX CCT internals are approximated, not bit-identical: sweeps use the
  nominal capsule and stop `skinWidth/cos` short; the side pass is purely
  horizontal. **Deviation**: while standing, the down pass reaches an extra
  stepOffset (0.4) below so the player stays glued when descending slopes
  (plain CCT flickers airborne; the original masks that elsewhere).
* Dynamic colliders (stone_spawner etc., `hasRigidbody`) are not in the
  static world, so they do not block.
* Drowning: no sinking/bobbing buoyancy (`WaterBouyancy`), no drown VFX/anim,
  respawn delay is a flat 5 s (button-mash reduction not ported).
* Rapier trimesh edge normals can differ slightly from PhysX at triangle
  edges; unverified against a real PhysX run (no Unity runtime available).
