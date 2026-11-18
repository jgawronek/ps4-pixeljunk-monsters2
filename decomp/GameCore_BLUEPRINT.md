# GameCore BLUEPRINT — PixelJunk Monsters 2 simulation layer

Read-only analysis of the recovered IL2CPP metadata skeletons, written to guide
reconstruction of the `GameCore` namespace as clean C#.

**Evidence base.** Everything below comes from the user's own copy:
- `decomp/skeleton/GameCore.cs` (69 types / 800 method entries, bodies empty)
- `decomp/skeleton/GameCore_Event.cs` (8 types / 37 methods)
- `decomp/skeleton/GameCore_Network.cs` (29 types / 119 methods)
- `decomp/il2cpp_user/dump.cs` (nested types, enums, Q4 view classes)
- `decomp/il2cpp_user/stringliteral.json` (log strings)

`decomp/decompiled/` is currently **empty** — no method bodies have been
decompiled yet. So: **names, signatures, field layouts, offsets, enum values,
and generic instantiations are CONFIRMED** (they come straight from metadata
v23). **Control flow, ordering, and formulas are INFERRED** from structure and
must be verified against Ghidra output at the cited RVAs. Each section marks
which is which. RVAs are offsets into `Il2CppUserAssemblies.elf` (the skeleton
lists RVA/Offset/VA; RVA is what Ghidra needs).

Note: MAP.md says "70 types / 709 methods" for GameCore; the skeleton header
says 69 types / 800 methods. The difference is counting convention (the
skeleton count includes property accessors, constructors and static
initializers). Method counts in §6 are skeleton entries per class.

---

## 1. Simulation architecture

### 1.1 The five core pieces (confirmed structure)

```
Q4.GameCoreBridge (MonoBehaviour singleton, Unity side)
   │  owns
   ▼
GameCore.GameCore (singleton via GameCore.Instance)
   ├── m_collisionManager : GameCoreCollisionManager   (spatial hash grid)
   ├── currentFrame       : GameCoreFrame              (the live world state)
   ├── lastUpdateTime     : float
   └── const TicksPerSecond = 60   → static TickDeltaTime
       CORRECTION (Q4-bridge reconstruction): 60 Hz / fixed TickDeltaTime applies
       ONLY to network matches. Single-player is VARIABLE-step: GameCore.Tick sets
       TickDeltaTime = Min(Time.deltaTime, 0.5f), one tick per Unity Update.

GameCoreFrame = one immutable-ish snapshot of the whole simulation:
   ├── m_handleMap  : Dictionary<GameCoreHandle, GameCoreObject>
   ├── m_gameObjects: List<GameCoreObject>          (tick order = list order, inferred)
   ├── m_typeMap    : Dictionary<Type, List<GameCoreObject>>
   └── m_frameTime  : float

GameCoreObject = base class of EVERY simulated thing (enemy, tower, coin,
   buff, wave manager, home, inventory, player, fruit, tree, projectile…).
   Fields: m_typeName, destroyed, m_position, m_previousTickPosition,
           m_collision (Cylinder), handle (GameCoreHandle).
   Virtuals: Tick(), DestroySelf(), RecreateViewer(), Clone().

GameCoreHandle = lightweight struct ID (int m_handle) that survives frame
   copies; also caches the Unity viewer GameObject + last resolved
   GameCoreObject, tagged with static s_cacheTag.

CoreObjectPool = static per-Type object pools (Queue<object> per Type) +
   reflection-based deep copy driven by [CoreObjectPool.DeepCopyAttribute].
```

### 1.2 Frame-copy simulation model (confirmed fields, inferred flow)

> **CORRECTION (post-reconstruction, verified vs. disassembly):**
> `CreateFrameCopyForUpdate` does NOT deep-copy despite its name — it mutates
> the frame **in place** (sets `m_frameTime`, snapshots `previousTickPosition`,
> swap-removes destroyed objects) and returns `this`. The normal single-player
> tick never deep-copies. The `DeepCopy*` machinery uses `Reflection.Emit`,
> which IL2CPP cannot run — it is a dev/resync path only. See
> `src/GameCore/GameCoreFrame.cs` and `src/GameCore/CoreObjectPool.cs`.

This is a **copy-on-tick** design, built for lockstep networking and resync
(the same machinery is used single-player):

1. `GameCore.PrepareNextFrame()` (RVA 0x4AA8C0) creates the next frame via
   `GameCoreFrame.CreateFrameCopyForUpdate(float newFrameTime)` (0x4AA930).
   The copy deep-copies each object (`CoreObjectPool.AllocateDeepCopy`,
   0x941EB0) — fields marked `[CoreObjectPool.DeepCopyAttribute]` are copied
   recursively (`DeepCopyList` 0x93F270, `DeepCopyDictionary` 0x941050,
   `DeepCopy` 0x93FDE0); everything else (handles, viewer references, cached
   data) is shallow-copied. Confirmed deep-copy fields include
   `GameCoreWaveManager.waveProgress` / `waveBossMinionProgress`,
   `GameCoreHome.m_chibisActive`, `GameCoreInventory.playerInventory` /
   `clientInventory`, and all five state slots of `StateMachine<TOwner>`.
2. `GameCore.Tick()` (0x4AAB30) runs `GameCoreFrame.TickAllObjects(bool
   desyncTesting)` (0x4AAC90) on the new frame.
3. `GameCore.InstallFrame(GameCoreFrame frame)` (0x4AB020) swaps
   `currentFrame`; the old frame's objects go back to the pool
   (`GameCoreFrame.ReturnObjectsToPool`, 0x4B5640). `GameCoreFrame` itself is
   pooled (`CoreObjectPool.Allocate<GameCoreFrame>` is a confirmed generic
   instantiation; `GameCoreFrame.AllocateFrame(float frameTime)` 0x4AA720).
4. Handles stay valid across the swap: `GameCoreHandle.CreateHandle(int
   handle = -1)` (0x4B9BA0) draws from static `s_nextHandle`;
   `GetMostRecentObjectVersion<T>()` (generic RVA 0x2C63C0) resolves a handle
   against the *current* frame. `InvalidateAllCachedData()` (0x4AB0D0) bumps
   `s_cacheTag` so per-handle caches (`m_cachedGameObject`, `m_cachedViewer`,
   `m_cacheTag`) re-resolve. `ResetNextHandleIndex()` (0x4AA560) and
   `EnsureNextHandleIsGreaterThan(handle)` (0x4B9B20) are used on
   load/resync so restored handles never collide with new ones (inferred).

**Object lifecycle** (inferred from the API surface):
`CoreObjectPool.Allocate<T>()` → constructor/init → `frame.AddObject(obj)`
(0x4B5770, registers in `m_handleMap`/`m_typeMap` via `AddToCacheMaps`
0x4B57D0, and in the collision grid) → `Tick()` every frame →
`DestroySelf()` (sets `destroyed`, removes from grid; string literal
"Attemping to add destroyed object {0} to GameCoreCollisionManager" confirms
the grid guards against destroyed objects) → object returned to pool when
its frame is retired. `GameCoreObject.PretickUpdatePreviousTickPosition()`
(0x4B5760) snapshots `m_position` into `m_previousTickPosition` before each
tick — used by the presentation layer for interpolation (inferred).

**Determinism aids (confirmed):**
> **CORRECTION (Q4-bridge reconstruction):** single-player is NOT fixed 60 Hz —
> it is variable-step (`TickDeltaTime = Min(Time.deltaTime, 0.5f)`, one tick per
> Update). Fixed 60 Hz (`TicksPerSecond = 60`) applies only to network matches.
> The SP determinism aid is `Random.InitState(updateCount)` called by the bridge
> before each tick (verified from bridge source).

`GameCoreObject.RandomRange(float min, float max, GameCoreHandle handle)`
(0x4B2A10) and an int overload (0x4BEC00).
> **CORRECTION (post-reconstruction):** RandomRange is NOT handle-seeded in
> single-player — it is plain `UnityEngine.Random.Range`; the handle only keys
> a NetworkLog entry for the online desync-detection path.
`m_extremeDesyncTesting` flag + `NetworkLog` frame hashing
(§4.4) exist to detect divergence.

### 1.3 Queries

- `GameCore.FirstObject<T>()` / `AllObjects<T>()` — confirmed instantiations
  show the singletons the game looks up: `GameCoreInventory`,
  `GameCoreWaveManager`, `GameCoreHome`, `GameCoreLocalMultiplayerInfo`;
  and the per-tick populations: `GameCoreEnemy`, `GameCorePlayer`,
  `GameCoreFruit`, `GameCoreTower`, `GameCoreTree`, `GameCoreHome`,
  `GameCoreEnemyAttackPoint`, `GameCoreProjectileInsect`.
- `GameCore.AllObjects<T>(Vector3 a_pos, Cylinder a_cylinder)` and
  `GameCoreCollisionManager.IntersectingObjects<T>(pos, radius, height)`
  delegate to the grid.
- `GameCoreFrame.GetObject<T>(GameCoreHandle)` — handle → object lookup.

### 1.4 Collision manager (confirmed structure)

`GameCoreCollisionManager` is a **uniform XZ grid**, `unitsPerCell = 4`
(`inverseUnitsPerCell = 0.25`). Fields: `cellList`,
`coreObjectCells : Dictionary<GameCoreHandle, List<GridCell>>` (which cells
each object occupies), `collectedObjectSet` (dedup during queries), `bounds`,
`xCells`/`zCells`, `newOverlappingCells` (scratch). Methods: `Init()`
(0x4AB130), `UpdateCoreObject(obj)` (0x4ABB80 — re-bucket on move),
`RemoveCoreObject(obj)` (0x4AC130), `GetCellXZ` (0x4AC870), `GetCell`
(0x4AC960), `GetCellBounds` (0x4AC9D0), `IntersectingObjects<T>` (generic
0x3727B0). Nested `GridCell` keeps `objectList` plus a per-Type index
(`typeObjects`, `AllObjectsOfType<T>()`); `CellIterator` walks the cell
rectangle. Objects are cylinders (`Cylinder { float radius; float height; }`,
ctors from radius/height or `Bounds`) — height matters for ground-vs-air
targeting. **Inferred:** `GameCoreObject.set_position` notifies the grid
(`UpdateCoreObject`); verify at 0x4ABA30.

### 1.5 The Unity bridge (confirmed API, Q4 side)

`Q4.GameCoreBridge : MonoBehaviour` (dump.cs line 173414; 32 methods):
- Singleton (`Instance`, `CreateInstance()` 0x44A0C0), owns `m_gameCore` and
  `m_networkBridge` (`GameCoreNetworkBridge`).
- Bidirectional maps `m_gameCoreToUnityMap : Dictionary<GameCoreHandle,
  GameObject>` and `m_unityToGameCoreMap`; `GetUnityObject(handle)`,
  `GetUnityObject<T>`, `GetGameCoreObject<T>(GameObject|MonoBehaviour)`,
  `SetUnityObject(handle, view)`. This is how `GameCoreHandle.GetUnityObject`
  and `GameCoreObject.GetUnityObject<T>` work (confirmed instantiations:
  `EnemyBase`, `TowerBase`, `Fruit`, `Player`, `PickupCurrency`, `Home`,
  `Projectile*`, `NatureTree`, `Structure`, `PickupManager`, …).
- `Update()` (0x449D80) / `LateUpdate()` (0x44A000) drive the fixed-step
  loop; `CheckForNextUpdateFrame(float timeSinceLevelStart)` (0x449EB0),
  `firstUpdateTime`, `updateCount`, `m_enableGameCoreTick`,
  `gameCoreTickEnabled`, `TimeSkip(float seconds)` (0x44A050).
- `CreateGameCoreFromCurrentUnityScene()` (0x44A2D0): scans the scene for
  `IPlaceableViewObject` MonoBehaviours (interface with one method,
  `GameCoreObject CreateGameCoreObject()`), sorted by a comparison delegate,
  and asks each to create its core object. Confirmed implementors:
  `WaveManager`, `Player`, `Home`, `PickupManager`, `Shop`, `TowerBase`
  (via `Structure`), `InteractionObject` views. **This is the level bootstrap.**
- `SerializeGameState(Stream)` (0x44A990) / `DeserializeGameState(Stream)`
  (0x44AB10) / `ResyncUnityWorldToGameCore()` (0x44ACF0) — binary
  serialization of the frame (objects are `[Serializable]`,
  `GameCoreFrame.OnDeserialized` rebuilds cache maps). Used for network
  resync; also the natural save-state mechanism for a rebuild.
- `SetViewersPaused<T>(bool, GameObject)` — pauses `EnemyBase`/`TowerBase`
  viewers (e.g. during menus).

**Presentation split (confirmed by field names):** core objects keep a
`viewer` reference (e.g. `GameCoreWaveManager.viewer : WaveManager`) and
`RecreateViewer()` / `CreateViewerFromPrefabName<T>(string name)` can rebuild
the Unity side from a prefab name after resync. Simulation stats are *copied
out of* view prefabs at construction (enemy ctor takes `EnemyBase`, tower
resolves `TowerBase` by name) — the prefab is the data table, the core object
is the runtime state.

---

## 2. Core tick / update flow

**Confirmed:** the methods below exist with these signatures; **the ordering
inside them is inferred** (bodies are empty) and is the first thing to verify
in Ghidra.

### 2.1 Outer loop (Unity → sim)

```
Unity player loop
└─ GameCoreBridge.Update()                        RVA 0x449D80
   ├─ CheckForNextUpdateFrame(timeSinceLevelStart)
   │     CORRECTION (verified from source): single-player runs ONE tick per
   │     Update, gated by GameCoreMustWait() (waits until a Player view exists).
   │     Fixed 60 Hz accumulation (firstUpdateTime/updateCount) is network-only.
   ├─ GameCoreNetworkBridge.GameCoreMustWait()    0x4DAE10  (network gate;
   │     single-player uses NullNetworkLayer loopback)
   ├─ GameCoreNetworkBridge.CheckForNextNetworkFrame(t)  0x4DAF60
   ├─ UnityEngine.Random.InitState(updateCount)   (per-tick RNG reseed — THIS is
   │     the SP determinism aid, not handle-seeding; verified from bridge source)
   ├─ GameCore.PrepareNextFrame()                 0x4AA8C0
   │     └─ currentFrame.CreateFrameCopyForUpdate(lastUpdateTime + TickDeltaTime)
   │        (refreshes the frame IN PLACE — frame time, previousTickPosition
   │         snapshots, swap-back purge of destroyed objects; NO deep copy in SP)
   ├─ GameCoreBridge.OnGameCoreTicked()  ← the pose/command seam (between
   │     PrepareNextFrame and Tick): samples each local Player view into a
   │     NetworkDataBlobPlayerSample, applies received frames (writes
   │     GameCorePlayer position/facing/anim-state), and executes every queued
   │     NetworkCommand.ExecuteCommand(corePlayer). Views NEVER mutate sim state
   │     directly — all gameplay goes through AddPlayerCommand, even in SP.
   ├─ GameCore.Tick()                             0x4AAB30
   │     └─ TickDeltaTime = Min(Time.deltaTime, 0.5f)  (SP variable step)
   │     └─ newFrame.TickAllObjects(m_extremeDesyncTesting)  0x4AAC90
   ├─ GameCore.InstallFrame(newFrame)             0x4AB020
   │     └─ old frame ReturnObjectsToPool(); handle caches invalidated
   ├─ CoreEventBase.InvokePendingPostGameCoreTickEvents()  0x9458E0
   └─ GameCoreNetworkBridge.OnGameCoreTicked()    0x4DC7D0
         └─ NetworkLog.EndLogFrame() + hash (desync detection)
GameCoreBridge.LateUpdate()                       0x44A000
   └─ CoreEventBase.InvokePendingPostUnityUpdateEvents()   0x945B40  [inferred]
Q4 views (EnemyBase, TowerBase, Player, PickupManager…) read core state
   via handles and interpolate position/previousTickPosition for rendering.
```

### 2.2 Inner loop (per tick, inside `TickAllObjects`)

**Inferred:** iterate `m_gameObjects` in insertion order; for each object call
`PretickUpdatePreviousTickPosition()` then virtual `Tick()`. There is no
per-subsystem scheduler class in the metadata — ordering comes from the order
objects were added to the frame (scene bootstrap order + spawn order). Verify
at 0x4AAC90. The *logical* per-frame pipeline, reconstructed from method
names and call relationships:

1. **Wave spawning** — `GameCoreWaveManager.Tick()` (0x4D2A00) →
   `UpdateWaveSpawning()` (0x4D2A20) → `UpdateWaveProgress(wave, index,
   isMinion)` (0x4D3140): count down delays, spawn `GameCoreEnemy` objects,
   fire `spawnGroupStartedEvent` / `waveStartedEvent` / `waveActivateEvent`;
   also `UpdateStageClear()` (0x4D2D30) for win detection.
2. **Enemy movement/AI** — `GameCoreEnemy.Tick()` (0x4AF7F0):
   `TickBuffs()` (0x4AFC00) → `StateWalk(dt)` (0x4AFF20) with
   `FindBlockingEnemies()`/`UpdateBlockingEnemies()` (0x4B2AF0/0x4B2BA0),
   `UdpateDrift(dt)` (sic, 0x4AFE80), `UpdateGroundOffset(dt)` (0x4AFC20),
   `RaycastGroundSlope` (0x4B0680), `DrownDetection()` (0x4B0E50);
   `StateAttacking(dt)` (0x4B0750) when at the home; `BossAI(dt)`
   (0x4B0960) for bosses; `TickAttackPoints(dt)` (0x4AEAD0).
3. **Player** — `GameCorePlayer.Tick()` (0x4C1B60): `TickBuffs()`
   (0x4C2A90), `CheckForPickups()` (0x4C1C40),
   `CheckForHiddenTreePickups()` (0x4C1FD0), `ProcessDropPickup()`
   (0x4C2670). **Movement itself is not simulated here** — no move/velocity
   fields exist on `GameCorePlayer`; the Q4 `Player`/`PlayerMotor`
   (177/87 methods) drives the avatar and writes `position`/`facingDegrees`
   into the core object (inferred; verify who calls `set_position`).
4. **Towers** — `GameCoreTower.Tick()` (0x4CEB20): `TickTargetQueue()`
   (0x4CF070), `TickEXPSources()` (0x4CEDF0), `TickRotateSpeed(dt)`
   (0x4CECB0), `TickState()` (0x4D0780) → `TowerStateMachine.TickState` →
   current `TowerState.Tick`. `TowerStateIdle` scans for targets
   (`UpdateTarget`, 0x4E3650) and switches to `TowerStateAttack`;
   `TowerStateAttack.Tick` (0x4E0F10) rotates (`UpdateRotation` 0x4E16C0)
   and fires via `OnAttack(tower, targets)` (0x4E1380), which creates the
   tower's `GameCoreProjectile*` and fires `projectileLaunchEvent`.
5. **Projectiles** — each `GameCoreProjectile.Tick()` moves/advances the
   shot and calls `OnHit(IDamageable)` → `IDamageable.DealDamage(...)` →
   `GameCoreEnemy.DealDamage` (0x4B1200 / 0x4B13E0) → `CheckIfDestroy()`
   (0x4B0FB0) → `enemyHitEvent` / `enemyDestroyedEvent` →
   `GameCoreWaveManager.OnEnemyDestroyed(tower, enemy, hitInfo)` (0x4D52B0)
   and `GameCoreTower.OnEnemyDestroy` (0x4D07F0) → `GrantEXP` (0x4D0900).
6. **Collision** — not a separate pass: the grid is kept current as objects
   move (`UpdateCoreObject`), and queries happen inside steps 2–5 and in
   pickup/fruit detection (`IntersectingObjects<T>`). (Inferred.)
7. **Buffs** — ticked *inside* their targets (`GameCoreEnemy.TickBuffs`,
   `GameCorePlayer.TickBuffs` → `BuffContainer.Tick(target)` 0x93DD90 →
   `Buff.UpdateBuff(target, dt)` 0x93CF20). Buffs are themselves pooled
   `GameCoreObject`s referenced by handle.
8. **Pickups/currency** — `GameCorePickupCurrency.Tick()` (0x4C00E0) →
   `UpdatePosition()` (0x4C0180) / `SuckToPlayer()` (0x4C07A0) →
   `Pickup(player)` (0x4C0AC0) → `GameCoreInventory.AddInventory` (0x4BE160)
   → `pickupAcquiredEvent` / `onAddInventory`.
   `GameCorePickupManager.Tick()` (0x4C0CA0) → `UpdateFruitDrops()`
   (0x4C0CB0) periodically drops fruit from fruit trees.
9. **Win/lose** — `GameCoreWaveManager.UpdateStageClear()` fires
   `stageClearedEvent` when all waves are done (with
   `remainingStageClearDelay`); `GameCoreHome.DealDamage(chibi)` (0x4BB040)
   removes a chibi per enemy attack (`enemyAttackedHomeEvent`); when
   `NumChibi == 0` the manager/home fires `gameOverEvent` and calls
   `OnGameOver()` across objects (inferred chain; verify 0x4BB040 and
   `GameCoreWaveManager.OnEnemyAttacked` 0x4D5520).

---

## 3. Subsystems

### 3.1 Enemy (`GameCoreEnemy`, 90 methods; `GameCoreEnemyAttackPoint`, 23)

Implements `IBuffs`, `IDamageable`, `ISpeedScale`. The biggest class in the
namespace.

**Construction (confirmed signature, 0x4AD0E0):**
```csharp
GameCoreEnemy(EnemyBase enemyPrefab, CatmullCurve pathCurve,
  List<PathEdit.EPathSegType> segTypeInfos, float pathStartTime,
  string pathName, float speedRatio, float hpRatio, int money, int gem,
  int waveIndex, int waveSubIndex, int waveSpawnIndex, float spawnInterval,
  float sideCenterOffset, float driftDist, float driftFreq,
  bool isMinion, bool isEnemyTrackEnableOnMe)
```
Stats (`maxLife`, `speed`, `fireSpeed`, `balloonSpeed`, `enemyMoveType`,
`expValue`, `DrownDepth`, attack params, sounds…) are read from the
`EnemyBase` prefab (confirmed fields on `EnemyBase`, dump/Q4 skeleton);
`speedRatio`/`hpRatio` come from wave data × difficulty.

**Field groups (confirmed, meanings inferred from names):**
- Identity/wave: `m_waveIndex`, `m_waveSubIndex`, `m_waveSpawnIndex`,
  `m_waveDistance`, `IsMinion`, `enemyTrackerEnable`.
- Health: `m_life`, `m_maxLife`, `m_vulnerableDamageTaken`,
  `m_tookDamageThisFrame`, `m_lowHpThreshold`/`m_lowHpSpeed` (enrage at low
  HP), `m_damagedHpThreshold` (`IsDamagedMode`).
- Movement: `pathMove : CorePathMove`, `m_pathName`, `m_segTypeInfos`,
  `m_distance` (distance along path), `m_speed`/`m_speedCur`/`m_speedScale`,
  `m_moveVector`, `m_sideOffset`/`m_sideOffsetCenter` (lane offset),
  `m_driftOffset/Time/Freq/Dist` (sinusoidal wander),
  `m_groundOffsetY/DestY/ModeHeight/VelY/AccScaleY/VelDamping/BalloonDeltaY`
  (vertical spring: hops, balloon lift, knock-up),
  `m_orientationInterpolator : AIHelper.TerrainOrientationInterpolator`
  (slope alignment, samples every 15 ticks — confirmed const).
- Traffic AI: `m_enemyBlockingMe`, `m_enemiesBlockedByMe`,
  `m_enemyToOvertake`, `m_blockingInfo : AIHelper.BlockingInfo`
  (nearest blocker in same-group / same-path / different-path, with
  distance+speed each), `secondsBetweenAvoidanceUpdates = 0.5` (const).
- Combat vs home: `m_canAttack`, `m_attackDelay`, `m_attackFreq`,
  `m_isAttacking`, `m_attackHomeHandle`, `m_attackChibi`,
  `m_ChibiAvoidRadius`/`m_ChibiAvoidDur`; boss: `m_isBoss`, `m_bossType`
  (`EBossType`), `m_isJumpingBoss`, `BossAttackDur/Dist/HeightForward/Back`,
  `m_bossAttacking`, `m_bossAttackTime`, `m_bossAttackEffectTriggered`,
  `m_spawnMinionWaitDur`, `m_restDur/m_jumpDur/m_restTime/m_jumpTime`.
- Balloons (flying enemies carried by balloons): `m_isBalloon`,
  `m_startedBalloon`, `m_numBalloons`, `m_balloonHP`,
  `m_balloonPopHPInterval`, `m_balloonSpeed`; `PopBalloons(int)` (0x4B0D00)
  + `popBalloonsEvent`; popping all balloons drops the enemy to the ground
  (inferred).
- Rewards: `m_coinValue`, `m_gemValue` (`GetCoinValue()`/`GetGemValue()`).
- Status: `m_isOnFire`, `m_isFalling`, `m_buffs : BuffContainer`,
  `m_attackPoints : List<GameCoreHandle>`, `m_IsGameOver`, `m_drownDepth`.

**Key methods:** `Tick()` 0x4AF7F0; `StateWalk` 0x4AFF20; `StateAttacking`
0x4B0750; `BossAI` 0x4B0960 + `BossAITerrainDetection` 0x4B4BD0;
`DealDamage(GameCoreObject source, float dmg, float distanceToCenterRate,
GameCoreObject attackPoint, bool immediateDestroy = true)` 0x4B1200 and the
strength/class-typed overload 0x4B13E0; `DealPlayerDamage(player, dmg,
distanceToCenterRate, oneKickOneBalloon)` 0x4B21B0 (player hip-attack);
`CheckIfDestroy` 0x4B0FB0; `Drown()` 0x4B10C0 / `DrownDetection` 0x4B0E50;
`TriggerJumpReaction(float weight)` 0x4B28C0 (knock-up from hits);
`Attack(GameCoreHome, ChibiData)` 0x4B4A20 (virtual);
`PredictPositionAndDirection(out pos, out dir, float aTime)` 0x4AED70
(lead targeting for projectiles); `IsAimableTarget(GameCoreTower)` 0x4B1000
(ground/air/balloon filtering); `ValidateTarget()` 0x4B0F70;
`OnGameOver()` 0x4AF700; `OnSpawnGroupStarted` 0x4B4D80.

**Attack points:** big enemies expose multiple `GameCoreEnemyAttackPoint`
objects (each `IDamageable`, `localPosition` relative to host,
`m_afterAirPoints`, `m_isEnabled`, `SetAttackPointEnabled`). Damage to a
point forwards to the host (`Host()` returns the enemy). Towers can aim at
individual points (`AllObjects<GameCoreEnemyAttackPoint>` instantiation).

**Helpers:** `AIHelper` (static): `GetBlockingEnemy(me, dist, speed)`
0x93B550, `GetAvoidanceEnemy(me, lookAheadDist, speed)` 0x93BC70,
`FindClosestObject<T>(pos, radius, height)`, `DetectGroundOrientation(pos,
forward, size)` 0x93C580 (5-raycast terrain probe: Center/Forward/Back/
Left/Right). `CorePathMove` (9 methods) wraps `CatmullCurve`:
`Sample(distance, out pos)` / `Sample(distance, sideOffset, out pos, out
vel)`, `DistanceToTime`, `NodeTimeToDistance`, `pathLength`,
`curveLengthBeforeActivation` (path prefix before the "activate" node —
enemies are invisible/inactive until activation, inferred),
`GetMinionWaveData()` (boss minion spawning uses a nested `WaveData`).
`CatmullCurve` itself (Q4, 12 methods) is a Catmull-Rom spline with
5 subsegments per segment, arc-length tables (`SampleLinearDistance`,
`DistanceToTime`), built from `List<Vector3>` path points + activateIndex.

**Connections:** spawned by WaveManager; damaged by projectiles/player/
fruits/buffs; on death notifies WaveManager (wave counts, money) and the
killing tower (EXP); attacks Home; drops currency via PickupManager
(inferred from `PickupManager.OnEnemyDestroyed(tower, enemy, hitInfo)`).

### 3.2 Waves (`GameCoreWaveManager`, 37 methods)

A `GameCoreObject` singleton (`Instance`), constructed with the scene's
`WaveManager` viewer. State:
- `waveProgress : List<WaveProgress>` and `waveBossMinionProgress` (both
  deep-copied), `currentWaveIndex`, `currentBossWaveIndex`, `m_bossHandle`,
  `m_difficultyLevel : DifficultySettings.Difficulty` (Easy=0/Medium=1/
  Hard=2, Any=-1), `m_hasClearedStage`, `remainingStageClearDelay`,
  `waveClearTimeBonusRate`, `stageStartDelay`, `introSequenceFinished`,
  `m_DestroySelf`.
- `WaveProgress` (confirmed fields): `spawnerProgress : List<SpawnProgress>`,
  `remainingSpawnStartDelay`, `remainingWaveActivateDelay`,
  `remainingWaveTime`, `waveTime`, `speedRatio`, `hpRatio`, `started`,
  `totalNumEnemy`, `totalNumEnemyDead`, `totalNumSpawned`, `moneyArray`,
  `gemArray`, `dialogStageSettings`, property `activated`.
- `SpawnProgress`: `spawnData : SpawnData`, `remainingSpawnDelay`,
  `numToSpawn`, `numSpawned`, `hasTriggeredStartEvent`.

**Data source (confirmed):** `WaveResource` (scene MonoBehaviour) holds
`waveList : List<WaveData>` + per-difficulty boss-minion lists
(`BossMinionSpawnData { float time; WaveData waveData; }`). `WaveData` holds
per-difficulty arrays: `perDifficulyLists` (sic; `List<SpawnData>` per
difficulty), `delay[]`, `hpRatio[]`, `speedRatio[]`, `totalMoney[]`,
`totalGem[]`, `money[]`, `gem[]`, `dialogLabel[]`, `dialogIcon[]`.
`SpawnData` (Q4) = one spawner: `enemyObject` (prefab), `enemySpawnNum`,
`enemySpawnInterval`, `delay`, `enemyTrackerEnable`, path (`m_pathName`,
`m_pathList`, `m_segTypeList`, `m_activateIndex`, `pathStartTime`, cached
`CatmullCurve`), drift/offset params (`offsetStartAngle/Freq/Dist`,
`walkDriftFreq/Dist`), `hpRatio`.

**Key methods:** `SetupWaveData(DifficultySettings.Difficulty)` 0x4D1F80
(builds `waveProgress` from `WaveData` via `CreateWaveProgress(waveData)`
0x4D4220); `Tick()` 0x4D2A00 → `UpdateWaveSpawning()` 0x4D2A20 +
`UpdateStageClear()` 0x4D2D30; `UpdateWaveProgress(WaveProgress, int, bool
isMinnion)` 0x4D3140 (sic); `SkipToWave(int)` 0x4D4150;
`GetTimeUntilWaveActivates(int)` 0x4D27B0; `IsStartedWave(int)` 0x4D2970;
`GetEnemyPrefabForWave(int)` 0x4D26D0; callbacks `OnEnemyDestroyed(tower,
enemy, hitInfo)` 0x4D52B0, `OnDeadEnemy(enemy)` 0x4D52C0,
`OnEnemyAttacked(enemy, home, chibi)` 0x4D5520, `OnGameOver()` 0x4D52A0,
`OnIntroSequenceFinished(player)` 0x4D5540, `OnResync()` 0x4D2670.
Debug-only `CheckWaveMoney`/`CheckWaveGem` ([Conditional]).

**Semantics (inferred):** waves have a start delay, then an *activation*
delay (enemies walk the pre-activation path prefix before becoming
"active" — matches `curveLengthBeforeActivation` and `waveActivateEvent`);
`remainingWaveTime`/`waveTime` bound the wave; a wave ends when all its
enemies are dead (`totalNumEnemyDead == totalNumEnemy`); stage clear when
the last wave ends (+ `remainingStageClearDelay`). Difficulty scaling via
`DifficultySettings` (rates: `coinValueRate`, `danceEXPRate`,
`towerBuildTimeRate`, `enemyHPRate`, `bossHPRate`, `enemyAmountRate`;
methods `EnemyHPByDifficulty`, `EnemyToSpawnByDifficulty`,
`ValueCoinByDifficulty`, `TowerBuildTimeByDifficulty`, `DanceEXPByDifficulty`).

**Connections:** creates enemies; receives death/attack callbacks; fires
`waveStartedEvent`, `waveActivateEvent`, `waveEndedEvent`,
`spawnGroupStartedEvent(int id, enemy, pos, isMinion)`,
`spawnGroupEndedEvent(int)`, `stageClearedEvent`, `gameOverEvent`,
`introSequenceFinishedEvent`. `GameCoreInventory.OnWaveEnded` and
`GameCoreHome.OnEndOfWave` and `GameCoreTower.OnWaveEnded` subscribe to
wave end (interest coins, chibi census, tower reload — inferred).

### 3.3 Fruit / trees / towers

**`GameCoreTree` (8 methods)** — the build site. `referenceCount` (how many
towers claim this tree), `hiddenPickupIndex` (const
`DirectlySetPickupDataIndex = 2000`), `IsTreeValid()`, `Breakdown()`
(0x4D1970, tree destroyed → `structureBreakEvent`), `Revive(player,
reviveIndex)` (0x4D1A00 → `treeReviveEvent`). Building a tower consumes
nearby trees: `TowerHelper.GetCostTrees(center, range, costTrees)`
(0x4E04F0); `GameCoreTower.retainedTrees : List<GameCoreHandle>` records
them; selling refunds and revives them (inferred).

**`GameCoreFruit` (28 methods)** — throwable consumable item (NOT the tower;
towers are built on trees). Implements `IGrabbable`
(`OnGrab(player)`/`OnDrop(player, force)`/`ThrowWithForce(player, force)`).
Ctor `(Fruit prefab, bool isPrefab, Vector3 position, PickupMovement
movement)`. Fields: `remainingLifespan`, `m_usageRemain`/`m_cooldownTime`/
`m_currentCooldownTime`/`m_destroyWhenUsedUp` (limited-use items),
detection ranges (enemy/player/playerJump/max), bounce physics
(`m_acceleration`, `m_bouncingRate`, `m_bounceTime`, `m_currentVelocity`,
`m_atRest`), `m_playerOwner`/`m_lastPlayerOwner` handles, `m_isInWater`,
`isNonInteractable`, `m_textKey`. Tick = `TickLifeSpan` + `TickCooldown` +
`TickPosition` + `CheckWater` + `TickHitEnemy()` (0x4B8010) +
`TickHitPlayer()` (0x4B8370) + `TickHitInteractableObject()` (0x4B8790);
`Triggerable()` / `TriggerInteraction(target, distance)` (0x4B8AD0) apply
the fruit's effect (buff or damage — inferred). Events: `fruitSpawnEvent`,
`fruitVanishEvent`, `fruitPickedUpEvent`, `fruitDroppedEvent`,
`fruitCaboomEvent` (explosive fruit), `explosionDamageEvent(source, pos,
radius)`. `OnStageCleared`/`OnGameOver` hooks.

**`GameCoreTower` (36 methods)** — the actual tower. Ctor
`(string prefabName, List<GameCoreHandle> costTrees)` (0x4CDAD0);
`Initialize()` 0x4CE2C0 / `InitializeSettings()` 0x4CE400 resolve the
`TowerBase` prefab by name (string literal "No tower found of type "
confirms name lookup; `TowerDatabase.GetTowerPrefabByIDString` exists) and
copy its stats into public fields: `attackType : ETowerAttackDef`
(ground=1/air=2/all=3), `strengthType : EEnemyStrengthTypeDef`
(Normal/Soft/Hard), `classType : EEnemyClassTypeDef` (Normal/Magic/Physic),
`balloonAimable`, `attackPower`, `attackSpeed`, `attackRangeInner`,
`attackSpread`, `costCoin`/`costGem`, `buildTime`, `burstCount`/
`burstInterval`, `refundCoin`/`refundGem`, `magazineCapacity`,
`attackAttenuationInfos : List<AttenuationInfo>` (`{rate, attenuation,
snap}` sampled by `AttenuationCurve.Sample`), rotation speeds/accels
(X/Y), `fireAngleThreshold`, `cautionAngleRange`/`cautionIdleTime`/
`cautionRotateSpeed`, `height`, `playerDetectionRange`,
`hiveTowerInsectMaxAmount`, `hitEffectScale`, `oneShotOneBalloon`,
`upgradeBuffOverride : IBuffSettingOverride`.
Runtime state: `m_stateMachine : TowerStateMachine`, `m_currentTarget :
IDamageable`, `enemyDetector : IEnemyDetector`, `bodyDirection`/
`fortDirection`, `m_currentLevel`/`m_currentEXP`, `targetQueue :
List<GameCoreHandle>` + `nextTargetToAttackIndex`, `m_expSourcePlayers :
List<PlayerAroundInfo>` (`{player handle, time}` with Tick/Reset/Expired —
players standing near a tower feed it EXP over time, "dance" mechanic),
`m_playerInside` (player manning the tower), `timeToNextUpdate`,
`targetsInRangeStorage`/`newTargetHandlesStorage` (scratch lists),
`isPostStageClear`, static `k_gatheringTime`.

Key methods: `Tick()` 0x4CEB20; `TickTargetQueue` 0x4CF070;
`TickEXPSources` 0x4CEDF0; `TickRotateSpeed` 0x4CECB0; `TickState`
0x4D0780; `SetTowerState(TowerState)` 0x4D0690 (virtual) /
`GetTowerState`; `GetCurrentTarget`/`SetCurrentTarget`;
`GrantEXP(float amount, GameCorePlayer from)` 0x4D0900 → `expGrantEvent`;
`GetCurrentUpgrade()`/`GetNextUpgrade()` → `TowerUpgrade` (Q4 data class:
`level`, `reachExp`, `costCoin/Gem`, `refundCoin/Gem`, `attackPower`,
`attackSpeed`, `attackRangeInner`, `attackRangeScale`, `affectRangeRate`,
`attackSpread`, `burstCount/Interval`, `ApplyUpgrade(tower)`; subclasses
`TowerUpgradeIce` (+speedScale/buffDuration), `TowerUpgradeHive`
(+insectAmountMax), `TowerUpgradeMotor` (+hitEffectScale));
`UpgradeTower()` 0x4D0E70 (private; auto-upgrade when EXP reaches
`reachExp`, inferred); `PlayerEnterTower(handle)`/`PlayerExitTower()`/
`HasPlayerInTower()`/`PlayerInTowerID()`; `HasEnoughBullet()`/
`RechargeBullet()` (magazine towers); `OnWaveEnded`/`OnStageClear`;
`OnEnemyDestroy(attackingTower, enemy, hitInfo)` 0x4D07F0.

**Tower state machine** — generic `State<TOwner>` / `StateMachine<TOwner>`
(GameCore namespace, also used by Q4's `TikimanStateMachine`): states have
`stateTime`, `duration`, `blocking`, `priority`; machine keeps
default/last/current/next/nextNext (all deep-copied), API
`SetCurrentCommand(state, next)`, `SetNextCommand`, `ForceCurrentCommand`,
`IsStateRunning<T>`, `IsStateRunningOrPending<T>`, `TickState(dt)`,
`PreTickState(dt)`, abstract `StatePreEnter`/`StatePostExit`.
`TowerStateMachine` (6 methods) adds `m_towerHandle`, `GetTower()`,
`Initialize`/`Terminate`. Concrete states (method counts incl. accessors):
- `TowerStateBuild` (6): tower rises from the ground over `buildTime`
  (`m_buildSpeed`, `GetBuildStartPosition(tower)` 0x4E0A40,
  `towerFinalPosition`); → Idle on completion (inferred).
- `TowerStateIdle` (12): target scanning (`UpdateTarget` 0x4E3650),
  rotation, attack cooldown (`UpdateAttackCooldown` 0x4E2DE0),
  "caution" idle behavior (`UpdateCautionInit`/`UpdateCaution`,
  `CautionMode`, `TowerHelper.RandomCautionDirection`), `ShootOnSight`.
- `TowerStateAttack` (6): burst fire (`m_burstTimer`, `m_burstCount`,
  ctor `(burstInterval, burstCount, forceAttack=false)`),
  `UpdateRotation`/`DesiredDirection`/`UpdateTarget`,
  `OnAttack(tower, List<IDamageable>)` 0x4E1380 → spawns projectile.
- `TowerStateChangeMag` (4): magazine swap animation/state
  (`missileTowerChangeMag` event).
- `TowerStateBroken` (3): destroyed tower drops gems after
  `m_gemDropDelay` (`m_destroyDropGem`), then exits.
- `TowerStateDegenerate` (4): timed state, purpose unclear (possibly tower
  downgrade/sink; **unknown** — decompile 0x4E25F0–0x4E2660).
- `TowerStateUpgradeAround` (6): the gem tower — boosts EXP of towers in
  range (`TickTowersInRangeForEXP` 0x4E3D20, `m_expBoostPerSecond`),
  periodic upgrades (`m_upgradeInterval`), sinks fragments
  (`m_sinkTimePerFrag`), drops gems (`m_gemCreationDelayTime`); events
  `onGemTowerPopGem`, `gemTowerSinkEvent`, `onGemTowerDestroy`.

**Targeting helpers** — `TowerHelper` (static, 12 methods):
`FilterEnemiesByAttackType(raw, attackType)` 0x4DFB50,
`IsTarget(EEnemyMoveTypeDef, ETowerAttackDef)` 0x4CAD00,
`GetNextTargetFromTowerTargetQueue(tower, index)` 0x4DFE50,
`GetNearestTargets(tower, result, ignoreInnerRange=true)` 0x4CF510 +
overload with `filterInFireRange`/`count` 0x4E0150,
`ClearViewOnTarget(tower, target)` 0x4DFFA0 (line-of-sight raycast),
`IsTargetInFireRange` 0x4E02D0,
`GetProjectileGameCoreHitPoisition(tower, targetPos)` 0x4C5ED0 (sic),
`GetCostTrees` 0x4E04F0, `FromTreeToTower(tree, towerPrefab)` 0x4D6170
(the actual tree→tower conversion used by BuildTowerCommand, inferred),
`RandomCautionDirection` 0x4E0B10.
**Detectors** — `IEnemyDetector` with `EnemyDetectorSphere` (21 methods;
radius + affect radius, offset, anchor 0.5) and `EnemyDetectorCone`
(29 methods; upper/lower radius + height, anchor 1):
`InDetection(pos, other)`, `InAttack(pos, other)`,
`GetCollisionCylinder()`/`GetAffectCylinder()`, `Upgrade(scale,
affectScale)` (range grows with tower level), `GetRadiusScale()`.
Tower types (confirmed `ETowerDef`): ice, fire, tesla_coil, laser, hive,
moter (sic), lightning (+ test towers).

### 3.4 Projectiles (base 7 methods + 8 subclasses, ~65 methods)

`GameCoreProjectile : GameCoreObject` (abstract). Ctor
`(GameCoreTower tower, List<IDamageable> enemies, bool dealsDamage = true)`
(0x4C3230) — **the tower passes its acquired target list at launch**.
Fields: `sourceTower : GameCoreHandle`, `m_towerClass`/`m_towerStrength`
(damage typing), `duration`, `m_attackPowerMax`, `m_attackSpread`,
`m_attackAttenuations : List<AttenuationInfo>`, `m_dealDamage`,
`m_maxTimeAlive`, `m_targetHandles`. Shared helpers:
`GetAttackDamage(float distance)` 0x4C3620 (attenuation by distance),
`GetTargets()`, `CompareEnemyByDistance(left, right)` 0x4C38E0,
`DamageToEnemyInfo(...)` (debug string), `RecreateViewer()`.

Subclasses (all ctor `(tower, enemies, dealsDamage)`):
| Class | Methods | Behavior (inferred from fields/method names) |
|---|---|---|
| `GameCoreProjectileTrajectory` | 10 | Ballistic/homing shot: `m_moveVector`, `m_gravity`, `m_traceTarget`, `m_targetHandle`, `hitEffectScale`; `OnHit(IDamageable)` 0x4CCCE0; `GetBuffSettings()` 0x4CD8A0 (applies tower buffs on hit, e.g. fire/ice). |
| `GameCoreProjectileInstant` | 5 | Hitscan with travel-time scheduling: `m_bulletSpeed`, `m_target`; `TickHitSchedule` 0x4CA160, `OnHit` 0x4CA3C0. |
| `GameCoreProjectileBeam` | 7 | Piercing laser: `m_directiveTarget`, `m_speed`, `m_startPoint`/`m_direction`, `m_beamFlyLength`, `m_radius`, `m_triggerSpread`, `m_attackTargets`; `TickBeamFly`/`TickRayCastGround`/`TickLineCastEnemies`/`TickHitEnemiesSpread`; `OnHit(enemy, distanceToCenter=0)` 0x4C4DF0. |
| `GameCoreProjectileElectric` | 5 | Multi-target zap: `m_validTargets`, `m_bulletSpeed`; `TickHitSchedule` 0x4C5340 staggers hits; `ValidTargetsCount()`. |
| `GameCoreProjectileLightning` | 6 | Chain/random lightning: `m_attackTimer`, `m_initialDelay`, `m_randomFactorMin/Max`, `m_lightningAttackTargets : List<LightningTargetInfo>`; `InitAttackTargets(tower)` 0x4CB1D0. |
| `GameCoreProjectileGaseous` | 16 | Flowing gas cloud: `m_moveVector`, `m_gravity`, `m_traceTarget`, `m_affectRadiusToEnemy/Player`, `m_maxFlowLength`/`m_flowLength`, `m_grounded`, `m_affectDuration`, `attackDamagePerSecond`, `m_affectPlayer`; `TickFlow`/`TickAttack`/`OnHitTerrain`/`OnHitEnemy`/`OnHitPlayer`; `GetBuffSettings()`. |
| `GameCoreProjectileInsect` | 14 | Hive bee: state machine via `InsectState` (a **MulticastDelegate** type used as state token — confirmed oddity), `StateHover`/`StateAttackStandBy`/`StateAttackAppreach` (sic), `TickEnemyDetection` 0x4C8F70, `ChangeHoverTarget`, `m_playersPassedBy` (bees buff/heal passing players? **unknown**), `m_detectionRange`, fly init angle range. Event `beeSpotATargetEvent(insect, handle)`. |
| `GameCoreProjectileGem` | 2 | Gem-tower projectile: `m_expBoostPerSecond`, `m_destroyDropGem`, `m_maxLifeDuration`, `m_sinkTimePerFragment`, `m_upgradeInterval`, `m_gemDropDelay`. |

**Damage pipeline (confirmed types, inferred math):** projectile `OnHit` →
`IDamageable.DealDamage(damageSource, damageToDeal, distanceToCenterRate,
attackPoint, immediateDestroy = true)` or the overload taking
`(EEnemyStrengthTypeDef, EEnemyClassTypeDef, ...)`. `DamageHelper` (static,
38 methods) computes type multipliers from per-enemy tables
(`StrengthDamageInfo`/`ClassDamageInfo` on `EnemyAttributesSettings`):
`DamageRateByStrength/Class/Attributes`, `DamageByStrength/Class/Attributes`,
`DamageStrongToEnemy*`, `ReactionStrongToEnemy*`, `ReactionRateBy*`,
`GetEnemyOnHitSound(hitInfo, soundSetting)`. Result packaged as
`EnemyHitInfo { GameCoreObject damageSource; GameCoreEnemy toEnemy; float
damage; bool strongToDamage; float distanceToCenterRate; float
reactionRate; bool strongReaction; }` → `enemyHitEvent` (feedback) and, on
kill, `enemyDestroyedEvent(tower, enemy, hitInfo)`.

### 3.5 Buffs (Buff 11 + BuffContainer 9 + 7 concretes × 3 ≈ 41 methods)

`Buff : GameCoreObject` (abstract): `m_timeRemain`, `m_sourceProjectile :
GameCoreHandle`, `m_sound : AudioSource`. API: ctor `(float duration)`,
`ResetTimer(duration)`, `UpdateBuff(GameCoreObject target, float dt)`
0x93CF20 (calls `UpdateTime` + abstract `ExecuteBuff(target)`),
virtual `OnEnterBuff(target)` / `OnExitBuff(target)`, `Valid()`,
`PlaySFX`/`StopSFX`. **Buffs are pooled core objects with handles**, not
plain components.

`BuffContainer` (owned by `GameCoreEnemy` and `GameCorePlayer` via `IBuffs`):
`m_buffs : List<GameCoreHandle>`; `AddBuff(buff, target)` 0x93DB20,
`GetAllBuffs()`, `Contains<T>()` (instantiated for `BuffFastPlayer`),
`RemoveBuffs<T>(target, Buff exception)` (instantiated for `BuffSlow`,
`BuffFreeze` — new freeze replaces old slows etc.), `RemoveAllbuffs(target)`,
`Tick(target)` 0x93DD90, `Initialize()`, `Terminate(target)`.

Concrete buffs (fields confirmed; effects inferred):
- `BuffBomb(duration, BuffSettingBomb, distanceToCenter)` — delayed
  explosion; `m_power`, `m_strengthType`/`m_classType`; damage on
  `OnExitBuff` (0x93D510) with distance attenuation.
- `BuffBurn(duration, powerPerSec, sourceHandle, frequency)` — DoT ticks
  (`m_timer`, `m_timerFrequency`); sets `IsOnFire` (inferred).
- `BuffFreeze(duration, powerPerSec, speedScaleEnm, speedScalePlayer,
  sourceHandle)` — DoT + slow for both enemy and player; interacts with
  `ISpeedScale.SetSpeedScale`.
- `BuffSlow(duration, BuffSettingSlow, target)` — `m_speedScale` only.
- `BuffFlare(BuffSettingFlare, duration)` — no fields; fires `flareEvent
  (source, target, lastPlayerOwner)`; taunt/aggro redirect (inferred from
  Q4 `OnFlareTriggered` + camera trace).
- `BuffTrampoline(duration, BuffSettingTrampoline)` — launches target
  (player jump boost / enemy knock-up; inferred).
- `BuffFastPlayer(duration, BuffSettingFastPlayer, target)` — player speed
  boost; `m_speedScale`, `m_isContinuous`.

**Application path (confirmed API):** Q4 `BuffSetting : MonoBehaviour`
(settings live on prefabs: `triggerTarget`, `affectTarget` masks,
`enemyDuration`/`playerDuration`, `effect`) with
`AddBuff(GameCoreObject source, GameCoreObject target, IBuffSettingOverride
buffOverride)` 0x7349F0 → abstract `InternalAddBuff(source, target,
duration, override)`; helpers `IsEnemyOfBuffType`, `GetAllInRange(origin,
spread, filter)`; subclasses `BuffSettingBomb/Burn/FastPlayer/Flare/Freeze/
Slow/Trampoline`, each `GetGameCoreType()` returns its Buff type.
`IBuffSettingOverride` / `BuffSettingOverrideFreeze { speedScale, duration }`
lets tower upgrades tune buff strength. Events `addBuffEvent(target,
BuffSetting)`, `removeBuffEvent(target, Type)`, `onFireExtinguished(target)`.

### 3.6 Currency / pickups (Pickup 13 + Currency 10 + PickupManager 4)

`GameCorePickup : GameCoreObject` (abstract). Ctor `(Pickup prefab, Vector3
position, EInventoryType type, int value = -1, PickupMovement movement)`.
Fields: `remainingLifespan`, `m_detectionRange`/`m_detectionDelay`,
`m_active`, bounce physics (`m_acceleration`, `m_bouncingRate`,
`m_bounceTime`, `m_currentVelocity`), `m_isInWater`, `m_inventoryType`,
`m_pickupPlayer`. `Tick()` 0x4BF990 → `CheckForWater` + `TickLifeSpan`;
abstract `Pickup(GameCorePlayer)`, `OnStageCleared(manager)`,
`OnGameOver()`.

`GameCorePickupCurrency` (coins/gems): `m_value`, `m_attractOffset`,
`m_currentSpeed`, `m_atRest`; `UpdatePosition()` 0x4C0180 (bounce, then
magnet), `SuckToPlayer()` 0x4C07A0 (attraction when player in detection
range), `Pickup(player)` 0x4C0AC0 → inventory add + `pickupAcquiredEvent`;
`pickupLostEvent` when expired/in water (inferred).
`CurrencyValueInfo { int total; int perValue; }` — used by
`playerBumpedEvent(player, coins, gems)` (player drops loose coins when
bumped by enemies).

`GameCorePickupManager` (4 methods): constructed from the scene
`PickupManager` viewer; `fruitElapsedTime`, `fruitTreeHandleList`,
`fruitCurIndex`; `Tick` → `UpdateFruitDrops()` 0x4C0CB0 — round-robin
periodic fruit drops from fruit trees (inferred). The Q4 `PickupManager`
also has `OnEnemyDestroyed`, `OnTowerSold`, `OnGemTowerBreak`,
`OnPlayerBumped`, `CreateFruit(HiddenFruitData, pos, movement)` — i.e. the
*view* coordinates drop spawning while the core simulates the pickups
(exact split of responsibility **unknown**; decompile both).

### 3.7 Home / base (`GameCoreHome`, 23 methods)

Ctor `(Home a_viewer)`; the `Home` view (a `Structure`) defines chibi spawn
zones (`Home.ChibiHomeZone`). State: `m_chibisActive : List<ChibiData>`
(deep-copied; `ChibiData { bool isDead; int id; Vector3 pos; Quaternion rot; }`),
`m_totalStartChibiNum`, `m_numChibiAtEndOfWave : List<int>` (per-wave census
for results screen), `m_playerDetectionRange`/`m_enemyDetectionRange`,
`IsEnemyClose`, `m_OrientationForward`.
Methods: `Tick()` 0x4BA9D0 (chibi scatter/avoid behavior, inferred);
`CreateChibis(viewer)` 0x4BA500 / `SpawnChibi(id, zone)` 0x4BB410 /
`SpreadOutChibi()` 0x4BB7C0 (sorts chibis by distance to attack point —
confirmed comparer closure); `DealDamage(ChibiData)` 0x4BB040 (one enemy
attack kills/carries off one chibi — inferred); `OnEnemyAttacked(enemy,
home, chibi)` 0x4BB370; `OnEndOfWave(manager, waveIndex)` 0x4BB380;
`GetChibiDataByIndex/ById`, `NumChibi`, `NumStartingChibi`,
`NumChibiAtEndOfWave(waveIndex)`, `EnemyAttackDistance`.
**Lose condition:** all chibis gone → `gameOverEvent` (inferred; the home
has no HP field — chibis ARE the health). Enemies reach the home via path
end, then `GameCoreEnemy.Attack(home, chibi)` (0x4B4A20) with
`m_attackDelay`/`m_attackFreq`; `enemyAttackEvent` /
`enemyAttackedHomeEvent(enemy, home, chibi)` notify Q4 (chibi carried away
animation, inferred).

### 3.8 Inventory (`GameCoreInventory`, 13 methods)

A `GameCoreObject` singleton created lazily — `GetInventoryObject()`
0x4BD300 (string literal: "Creating GameCoreInventory object. Please verify
we are in a game core safe context."). Per-player bags:
`playerInventory` / `clientInventory : Dictionary<int, InventoryBag>`
(playerId → bag; the client copy is for network prediction, inferred).
`InventoryBag` = `int[] values` indexed by
`EInventoryType { Coin=0, Gem=1, InterestCoins=2, SpentCoins=3, SpentGems=4 }`
(confirmed values). API: `AddInventory(playerHandle, type, amount)`
0x4BE160, `RemoveInventory(playerHandle, type, amount, bool spent = true)`
0x4BE460 (the `spent` flag feeds SpentCoins/SpentGems statistics),
`HasInventory`, `GetAvailableInventory`, `OnWaveEnded(manager, waveIndex)`
0x4BDAD0 (wave-clear bonus + interest: `waveClearCoinRate` field,
`InterestCoins` type), `GetEndOfGameStatistics(out totalCoins, totalGems,
totalInterest)` (+ per-player overload). Events `onAddInventory(player,
inventory, type, amount)` / `onRemoveInventory(...)` drive the HUD.
Tower/fruit costs are checked against this (`notEnoughMoneyForTower(int)`
event exists).

### 3.9 Player (`GameCorePlayer`, 34 methods)

Sim-side avatar state (movement is presentation-driven, §2.2):
`playerId`, `facingDegrees`, `animationStateHash`/`animationStateTime`,
`towerDanceHandle` (tower the player is dancing at for EXP), `sampleTime`,
`IdleTime`, `XPTime`, `m_buffs`, `m_heldFruitHandle` (+ `HeldFruit`,
`IsHoldingFruit`, `IsHeldFruitError`), `m_speedScale` (`ISpeedScale`),
`m_lastPosition`, `m_forward`; loose-currency state
`m_isPendingLooseCoins`, `m_looseCoinsDelay`, `m_lossCoins`/`m_dropCoins`/
`m_lossGems`/`m_dropGems`/`m_valuePerCoin`/`m_valuePerGem`.
Methods: `Tick()` 0x4C1B60, `TickBuffs`, `CheckForPickups` 0x4C1C40,
`CheckForHiddenTreePickups` 0x4C1FD0 (trees hide pickups;
`hiddenPickupFoundEvent(player, type, amount)`),
`DropPickup(delay, lossCoins, dropCoins, lossGems, dropGems, valuePerCoin=-1,
valuePerGem=-1)` 0x4C2AB0 + `ProcessDropPickup` 0x4C2670 (spawn scattered
currency pickups after a delay — used when bumped), fruit callbacks
`OnFruitPickedUp`/`OnFruitDropped`; statics `GetPlayerCount()`,
`GetLocalPlayer()`, `GetPlayer(int)`, `IsLocalPlayer()`.
Events: `localPlayerAddedEvent`/`localPlayerRemovedEvent`/
`playerRemovedEvent`/`playerBumpedEvent`/`busyEvent(handle, bool)`.

### 3.10 Misc core objects

- `GameCoreInteractionObject` (21 methods): triggerable moving contraptions
  (rolling balls etc.): spline `pathPoints`, `m_speed`, `m_damage`,
  `m_destroyOnHit`, `BounceCount`, `useGravity`, `bounce`, `m_velY`;
  `TriggerInteraction()` 0x4BCB30, `UpdateMovement`, `CollisionDetection`,
  static `SampleDirect(splinePoints, t, out pos, out vel)`;
  `triggerInterationEvent(player, handle)` (sic).
- `GameCoreShop` (2 methods): stub — only `RecreateViewer`; shop logic is
  entirely in Q4 (`Shop`, `FruitShop`). Skip for simulation.
- `GameCoreCharacterTemplate` (2): decorative placed character
  (`QuatPos` + prefab). Skip.
- `GameCoreLocalMultiplayerInfo` (3): marker object for local 2P
  (`did2PEnterTheGame`, `AddLocalMultiplayerMarkerToGameCore`). Single-
  player rebuild can stub it, but `AddLocalPlayerCommand` creates the
  player, so keep the command.
- `AIDebugHelper` (2): gizmo drawing. Skip.

---

## 4. The command pattern (single-player included)

### 4.1 Structure (confirmed)

`GameCore.Network.NetworkCommand` (abstract, `[Serializable]`): one method,
`abstract void ExecuteCommand(GameCorePlayer executingPlayerObject)`.
Every gameplay mutation is a subclass carrying plain data (handles, ints,
strings, Vector3) — no Unity object references except prefab lookups done
at construction. This is what makes the sim deterministic and serializable.

Entry point: `GameCoreNetworkBridge.AddPlayerCommand(int playerID,
NetworkCommand command)` (0x4D6C40). The bridge
(`GameCoreNetworkBridge : ScriptableObject`, const `NetworkDelay = 0.5`,
`UpdateTicksPerNetworkFrame`, `lastNetworkFrame`,
`synchronizedWallClockTime`, `targetWallClockTime`, `primingDelay`,
`pendingPlayerBlobs : List<NetworkDataPlayerBlob>`, `pendingReceivedFrames
: Queue<NetworkDataFrame>`, `NetworkLayer : NullNetworkLayer`) batches
commands per network frame. **Single-player uses `NullNetworkLayer`**
(confirmed type name/property): commands loop back locally with no network
(inferred — verify `AddPlayerCommand`/`Update` bodies). `GameCoreMustWait()`
(0x4DAE10) gates the sim when waiting for remote frames; in single-player
it should always return false (inferred). `OnGameCoreTicked()` (0x4DC7D0)
runs after each sim tick.

**Execution timing (inferred):** commands queued via `AddPlayerCommand`
are executed against the *next* frame copy, before/inside `TickAllObjects`,
with the issuing `GameCorePlayer` resolved from `playerID` and passed to
`ExecuteCommand`. Verify at `GameCoreNetworkBridge.Update` 0x4DAD50 and
`OnReceiveNetworkFrame` 0x4DBC00.

### 4.2 Command catalog (24 commands; effects inferred from fields + target APIs)

| Command | Ctor data | ExecuteCommand does (inferred) |
|---|---|---|
| `BuildTowerCommand` | `(GameCoreHandle treeHandle, TowerBase towerPrefab)` → stores `treeHandle`, `towerType` string | Checks cost (`HasInventory`), `TowerHelper.FromTreeToTower(tree, prefab)` → `GameCoreTower` in Build state; `RemoveInventory(costCoin/Gem)`; `towerBuildEvent(tower, tree, player)`. 0x4D5D30 |
| `UpgradeTowerCommand` | `(towerHandle, int nextLevel)` | Validates level/cost, applies `TowerUpgrade.ApplyUpgrade`, deducts cost; `towerUpgradeEvent`. 0x4DFA00 |
| `SellTowerCommand` | `(towerHandle, refundCoin, refundGem)` | Destroys tower, refunds via `AddInventory`, revives retained trees; `towerSellEvent(tower, player, coin, gem)`. 0x4DE9E0 |
| `TowerAttackComamnd` (sic) | `(towerHandle)` | Forces attack (sets `TowerStateAttack(forceAttack: true)` — player manually fires a manned tower). 0x4DF5D0 |
| `TowerRotateCommand` | `(towerHandle, Vector2 rotateEuler)` | Sets manual aim of manned tower. 0x4DF750 |
| `TowerXPCommand` | `(towerHandle, float xp)` | `tower.GrantXP(xp, player)` (dance EXP). 0x4DF870 |
| `EnterLeaveTowerCommand` | `(playerHandle, towerHandle, bool enter)` | `PlayerEnterTower`/`PlayerExitTower`. 0x4D9880 |
| `SpawnFruitCommand` | `(player, spawningObjectHandle, int fruitIndex, Vector3 posOffset)` + `hasPaidCost` | `PayFruitCost(player)` 0x4DEF70 then creates `GameCoreFruit` at shop/tree; `fruitSpawnEvent`. 0x4DF1E0 |
| `PickupFruitCommand` | `(GameCoreFruit)` → handle | `fruit.OnGrab(player)`; `fruitPickedUpEvent`. 0x4DDEA0 |
| `DropFruitCommand` | `(GameCoreFruit, Vector3 force)` | `fruit.OnDrop(player, force)`; `fruitDroppedEvent`. 0x4D9740 |
| `DetonateFruitCommand` | () | Detonates held explosive fruit → `fruitCaboomEvent` + `explosionDamageEvent`. 0x4D96D0 |
| `HipAttackEnemyCommand` | `(enemyHandle, power, numCoinsToDrop, numGemsToDrop, valuePerCoin, valuePerGem)` | `enemy.DealPlayerDamage(player, power, ..., oneKickOneBalloon)`; drops loose coins. 0x4DD660 |
| `AddInventoryCommand` | `(playerHandle, int value, EInventoryType)` | `inventory.AddInventory(...)` (pickup collection is command-driven!). 0x4D5600 |
| `TriggerInteractionCommand` | `(GameCoreHandle gco)` | `GameCoreInteractionObject.TriggerInteraction()` / fruit trigger. 0x4DF900 |
| `AddLocalPlayerCommand` | () | Creates `GameCorePlayer` + `localPlayerAddedEvent`. 0x4D56C0 |
| `RemoveLocalPlayerCommand` | `(int playerId)` + static `StopLocalMultiplay()` | Removes player. 0x4DE5F0 |
| `IntroSequenceSkipCommand` | () | `waveManager.OnIntroSequenceFinished(player)`. 0x4DD790 |
| `BusyCommand` | `(bool isBusy)` | Sets player busy flag → `busyEvent`. 0x4D67A0 |
| `SignCommand` | `(int cat, int icon)` | Emote/sign → `signEvent(handle, cat, icon)`. 0x4DED00 |
| `CommandBuffEffect` | `(EEffectID, onOff, monitored)` | **Presentation-only**: plays/stops particle effect on player (static `PlayEffect`/`StopEffect` + tracking). 0x4D72A0 |
| `CommandSoundEffect` | `(ESoundEffectID, onOff, monitored, delay)` | **Presentation-only**: plays/stops SFX (static `PlaySFX`, `PlaySoundDelayed` coroutine). 0x4D8440 |
| `DebugAdjustInventoryCommand` | `(type, amount)` | Debug money. 0x4D8CE0 |
| `DebugSkipToWaveCommand` | `(int wave)` | `waveManager.SkipToWave`. 0x4D8FD0 |
| `DebugClearStageCommand` / `DebugFailStageCommand` | () | Force win/lose. 0x4D8DA0 / 0x4D8E90 |
| `DebugSpawnEnemyCommand` | `(spawnListIndex, hpRatio)` | Spawn one enemy from wave data. 0x4D90A0 |

Note the two presentation commands (`CommandBuffEffect`,
`CommandSoundEffect`) ride the same pipeline so effects stay synchronized
with sim state in multiplayer; a single-player rebuild can execute them
directly against the view layer or drop them.

### 4.3 Q4 side: two command layers (confirmed classes)

Do not confuse them:
1. **`Q4.Command` / `Q4.PlayerCommand`** (abstract, `startTime`/`executeTime`
   ticks, `Initialize/Execute/Terminate`): *presentation-side* avatar
   actions — `CommandMove`, `CommandJump`, `CommandAttack`,
   `CommandTrampoline`, `CommandSignMenu`, `CommandDanceOLD` — executed by
   `Q4.Player`/`PlayerMotor` against the Unity character controller. These
   produce the movement that gets written into `GameCorePlayer`, and
   trigger sim commands (e.g. hip attack → `HipAttackEnemyCommand`).
2. **`GameCore.Network.NetworkCommand`**: the sim mutations above, issued
   through `GameCoreNetworkBridge.AddPlayerCommand`. (The exact Q4 call
   sites are inside method bodies we haven't decompiled yet — the skeleton
   shows `Q4.Player` holds `m_TowerHandle`, `DanceTowerHandle`,
   `InteractableFruit`, `BumpPlayer(enemyHandle, hitPos, forceScale,
   looseCoins)` etc., consistent with this flow.)

### 4.4 Desync logging (confirmed, skip for single-player but useful)

`NetworkLog` singleton: `Log(string message, int checkValue, bool
includeStack = false)` 0x4BE340, `EndLogFrame()` 0x4AAE00,
`GetLocalFrameLogHash()` 0x4DB270, `ComputeCheckValueHash(LocalFrameLog)`
0x4DBF40, `DumpLogToFile()`. String literals confirm runtime messages:
"gamestate desync detected on frame ", "requesting serialized game state
for resync", "Resynced", "-desynctesting". For the rebuild this is a
ready-made **regression harness**: log per-frame check values and compare
runs. Resync itself (`OnRequestResyncGameState`/`OnReceiveResyncGameState`,
`postResyncEvent`) is multiplayer machinery — out of scope, but
`SerializeGameState`/`DeserializeGameState` are worth keeping for
save-states.

---

## 5. Event system (GameCore.Event + GameCore.Events)

### 5.1 Machinery (confirmed structure)

- `EventTime { Immediate = 0, PostGameCoreTick = 1, PostUnityUpdate = 2 }`.
- `CoreEventBase` (abstract): static sets `pendingInvokedEvents`,
  `pendingUnityEvents`, `processingInvokedEvents`; `NotifyInvoked()`
  (0x9453D0) registers an invoked event for deferred delivery; static flush
  points `InvokePendingPostGameCoreTickEvents()` (0x9458E0) and
  `InvokePendingPostUnityUpdateEvents()` (0x945B40); abstract
  `DoPendingPostGameCoreTickEventsWrapper` / `...PostUnityUpdate...`.
- `CoreEventShim<CallbackType, EventDataType>` (generic base):
  `listeners : SortedDictionary<CallbackType, EventTime>` (delivery-time
  per listener), `coreObjectListeners : Dictionary<GameCoreHandle,
  CallbackType>` (auto-removal when the core object dies, inferred),
  `eventData : List<EventDataType>` (queued payloads), `processingEvents`
  flag + `pendingAddedListeners`/`pendingRemovedListeners` +
  `ApplyPendingListenerChanges()` — **re-entrancy safe**: listeners can
  add/remove listeners during dispatch. API: `AddListener(callback,
  EventTime)`, `RemoveListener(callback)`.
- `CoreEvent`, `CoreEvent<T1>`, `<T1,T2>`, `<T1,T2,T3>`, `<T1,T2,T3,T4>`
  add typed `Invoke(...)` (e.g. `CoreEvent<GameCoreTower, GameCoreEnemy,
  EnemyHitInfo>.Invoke`). Confirmed instantiations cover every payload in
  the table below. `CoreEvent` tracks `unityInvokeCount`/`coreInvokeCount`.

**Dispatch semantics (inferred):** `Invoke` calls `Immediate` listeners
synchronously (inside the sim tick) and queues payload copies for
`PostGameCoreTick` listeners (flushed right after the tick, still on the
sim thread — safe to read core state) and `PostUnityUpdate` listeners
(flushed after Unity's Update — the normal choice for views, since they
may instantiate GameObjects). Payloads are structs (`CoreEvent.EventData<…>`)
so queued events survive frame swaps. Verify at `CoreEvent.Invoke`
0x9451C0 and the generic `DoPending*` bodies.

### 5.2 The registry (confirmed: `GameCore.Events`, 58 static event instances)

`Events` is a static class whose `.cctor` (0x945DC0) news up all events;
simulation code fires `Events.xxxEvent.Invoke(...)`, Q4 views subscribe
with `AddListener`. Key events (payload types confirmed from dump.cs
172605–173118):

| Event | Payload | Fired by → consumed by (inferred) |
|---|---|---|
| `introSequenceFinishedEvent` | `GameCorePlayer` | WaveManager → stage start |
| `waveStartedEvent` / `waveActivateEvent` / `waveEndedEvent` | `(GameCoreWaveManager, int waveIndex)` | WaveManager → HUD wave bar, inventory interest, home census, tower reload |
| `spawnGroupStartedEvent` | `(int id, GameCoreEnemy, Vector3 pos, bool isMinion)` | WaveManager → `WaveManager` view (spawn effects), `GameCoreEnemy.OnSpawnGroupStarted` |
| `spawnGroupEndedEvent` | `(int id)` | → view cleanup |
| `stageClearedEvent` | `GameCoreWaveManager` | → results flow, `OnStageCleared` on fruits/pickups/towers |
| `gameOverEvent` | () | → game-over flow, `OnGameOver` on all objects |
| `enemySpawnEvent` | `GameCoreEnemy` | → `EnemyBase` viewer creation |
| `enemyHitEvent` | `EnemyHitInfo` | → hit flash/shake/sound |
| `enemyDestroyedEvent` | `(GameCoreTower, GameCoreEnemy, EnemyHitInfo)` | → death anim, coin drops (`PickupManager.OnEnemyDestroyed`), wave counts, EXP |
| `enemyAttackEvent` / `enemyAttackedHomeEvent` | `(GameCoreEnemy, GameCoreHome, ChibiData)` | → chibi carry-off animation, home alarm |
| `enemyDrownEvent` | `GameCoreEnemy` | → splash |
| `popBalloonsEvent` | `(GameCoreEnemy, int)` | → balloon pop FX |
| `jumpReactionEvent` / `bossJumpEvent` | `(GameCoreEnemy, float)` | → knock-up/jump FX |
| `bossAttackEffectEvent` | () | → boss attack FX |
| `projectileLaunchEvent` | `GameCoreTower` | → muzzle FX/sound |
| `projectileHitEvent` | `(GameCoreProjectile, IDamageable)` | → impact FX |
| `projectileHitTerrain` | `(GameCoreProjectile, Vector3 pos, Vector3 normal)` | → terrain impact FX |
| `towerTargetChangeEvent` | `GameCoreTower` | → turret aim view |
| `towerBuildEvent` | `(GameCoreTower, GameCoreTree, GameCorePlayer)` | → build FX, HUD (`BuildData.OnTowerBuilt` confirmed in Q4) |
| `towerUpgradeEvent` | `(GameCoreTower, TowerUpgrade)` | → level-up FX |
| `towerSellEvent` | `(GameCoreTower, GameCorePlayer, int coin, int gem)` | → refund FX |
| `towerChangeStateEvent` | `(GameCoreTower, TowerState)` | → state-driven animation |
| `structureBreakEvent` | `GameCoreObject` | → tree/tower break FX |
| `treeReviveEvent` | `(GameCoreTree, GameCorePlayer, int)` | → tree regrow |
| `expGrantEvent` | `(GameCoreTower, float)` | → EXP flyover |
| `pickupAcquiredEvent` / `pickupLostEvent` | `(GameCorePlayer, GameCorePickup)` / `(GameCorePickup)` | → coin sound/HUD |
| `onAddInventory` / `onRemoveInventory` | `(GameCorePlayer, GameCoreInventory, EInventoryType, int)` | → HUD counters |
| `hiddenPickupFoundEvent` | `(GameCorePlayer, EInventoryType, int)` | → secret reveal |
| `playerBumpedEvent` | `(GameCorePlayer, CurrencyValueInfo coins, CurrencyValueInfo gems)` | → loose-coin scatter |
| `fruitSpawnEvent` / `fruitVanishEvent` | `GameCoreFruit` | → fruit views |
| `fruitPickedUpEvent` / `fruitDroppedEvent` | `(GameCorePlayer, GameCoreFruit[, Vector3 force])` | → carry/throw anim |
| `fruitCaboomEvent` / `explosionDamageEvent` | `GameCoreFruit` / `(GameCoreObject, Vector3, float)` | → explosion |
| `addBuffEvent` / `removeBuffEvent` | `(GameCoreObject, BuffSetting)` / `(GameCoreObject, Type)` | → buff FX |
| `flareEvent` | `(GameCoreObject source, GameCoreObject target, GameCoreHandle owner)` | → flare camera trace |
| `onFireExtinguished` | `GameCoreObject` | → fire FX off |
| `triggerInterationEvent` (sic) | `(GameCorePlayer, GameCoreHandle)` | → contraption anim |
| `localPlayerAddedEvent` / `localPlayerRemovedEvent` / `playerRemovedEvent` | `GameCorePlayer` | → avatar spawn/despawn |
| `busyEvent` | `(GameCoreHandle, bool)` | → UI lock |
| `signEvent` | `(GameCoreHandle, int cat, int icon)` | → emote bubble |
| `onGemTowerPopGem` / `onGemTowerDestroy` / `gemTowerSinkEvent` | `(GameCoreTower, int)` / `(GameCoreTower)` / `(GameCoreHandle, float, float, float)` | → gem tower FX |
| `missileTowerChangeMag` | `(GameCoreHandle, int, int)` | → magazine swap anim |
| `notEnoughMoneyForTower` | `(int)` | → UI error |
| `beeSpotATargetEvent` | `(GameCoreProjectileInsect, GameCoreHandle)` | → bee target FX |
| `postResyncEvent` | () | → full view rebuild (multiplayer; skip) |

**For the rebuild:** keep this exact shape (static registry + typed
deferred events). It is the clean seam between sim and presentation: a
headless simulation can subscribe with `Immediate`/`PostGameCoreTick`
listeners and log everything, with zero Unity dependency.

---

## 6. Reconstruction plan

Counts below are skeleton method entries (incl. accessors/ctors) — they
include trivial property stubs, so treat them as upper bounds on real work.
"Critical" methods are the ones to decompile first (RVAs in §2–§5).

### Phase 0 — Math & path infrastructure (~25 methods)
`Cylinder`, `Vector3`/`Quaternion` (reuse UnityEngine structs or plain
equivalents), `CatmullCurve` (Q4, 12 methods — spline + arc-length tables;
pure math, no Unity dependency beyond Vector3), `CorePathMove` (9),
`AttenuationInfo` + `AttenuationCurve.Sample` (1).
**Why first:** enemies, waves and interaction objects all sample paths.
Critical: `CatmullCurve.BuildCurveData` 0x73F550, `DistanceToTime`
0x740410, `CorePathMove.Sample` 0x942090/0x942110.

### Phase 1 — Core runtime (~110 methods)
`CoreObjectPool` (10; deep-copy reflection can be replaced with explicit
per-class copy code — keep `[DeepCopy]` semantics), `GameCoreHandle` (23),
`GameCoreObject` (21), `GameCoreFrame` (14), `GameCore` (23),
`GameCoreCollisionManager` + `GridCell` + `CellIterator` (~28).
Critical: `GameCore.Tick` 0x4AAB30, `PrepareNextFrame` 0x4AA8C0,
`GameCoreFrame.TickAllObjects` 0x4AAC90, `CreateFrameCopyForUpdate`
0x4AA930, `CoreObjectPool.DeepCopy` 0x93FDE0,
`GameCoreObject.RandomRange` 0x4B2A10/0x4BEC00 (determinism!),
`GameCoreCollisionManager.UpdateCoreObject` 0x4ABB80.
**Milestone:** empty frames tick at 60 Hz, objects spawn/destroy/pool,
handle resolution works.

### Phase 2 — Events (~45 methods + 58 tiny event classes)
`CoreEventBase`, `CoreEventShim<,>`, `CoreEvent`…`CoreEvent<T1..T4>`,
`Events` registry. Generic-heavy but mechanical; can be hand-written from
the confirmed API without decompiling every instantiation.
Critical: `CoreEvent.Invoke` 0x9451C0, `CoreEventBase.NotifyInvoked`
0x9453D0, flush methods 0x9458E0/0x945B40.
**Milestone:** sim can emit typed events with the three delivery times.

### Phase 3 — Data definitions (no sim methods; extraction work)
Plain-data equivalents of the prefab tables: `EnemyBase` stats,
`TowerBase` stats, `TowerUpgrade`(+Ice/Hive/Motor), `WaveData`/`SpawnData`/
`WaveResource`, `BuffSetting*` parameters, `EnemyAttributesSettings`
(strength/class damage tables), `DifficultySettings.DifficultySetting`,
enums (`EEnemyMoveTypeDef`, `ETowerAttackDef`, `EEnemyStrengthTypeDef`,
`EEnemyClassTypeDef`, `ETowerDef`, `EEnemyDef`, `EBossType`,
`EInventoryType`). Fields are `[AttributeSyncWithJson]` — the game ships
JSON-synced settings, so values can be extracted from the user's own
assets/JSON rather than hardcoded. **No game art/levels copied into output
— only numeric parameters.**

### Phase 4 — Economy (~40 methods)
`GameCoreInventory` (13) + `InventoryBag`, `GameCorePickup` (13),
`GameCorePickupCurrency` (10), `CurrencyValueInfo`,
`GameCorePickupManager` (4).
Critical: `AddInventory` 0x4BE160, `OnWaveEnded` 0x4BDAD0 (interest math),
`GameCorePickupCurrency.Tick` 0x4C00E0 / `Pickup` 0x4C0AC0.
Depends: Phase 1–2. **Milestone:** coins spawn, bounce, magnet to a
position, and credit a player bag.

### Phase 5 — Home & lose condition (~25 methods)
`GameCoreHome` (23) + `ChibiData`.
Critical: `DealDamage` 0x4BB040, `Tick` 0x4BA9D0, `OnEnemyAttacked`
0x4BB370. Depends: Phase 1–2 (enemy interface only).

### Phase 6 — Waves (~40 methods)
`GameCoreWaveManager` (37) + `WaveProgress`/`SpawnProgress`.
Critical: `SetupWaveData` 0x4D1F80, `UpdateWaveSpawning` 0x4D2A20,
`UpdateWaveProgress` 0x4D3140, `UpdateStageClear` 0x4D2D30,
`OnEnemyDestroyed` 0x4D52B0. Depends: Phase 0 (paths), 3 (wave data),
enemy ctor (Phase 7 — build them together).
**Milestone:** a full wave schedule spawns enemies on paths and detects
stage clear.

### Phase 7 — Enemies & damage (~160 methods, the hard part)
`GameCoreEnemy` (90), `GameCoreEnemyAttackPoint` (23), `AIHelper` (5),
`DamageHelper` (38), `EnemyHitInfo`.
Critical: `GameCoreEnemy.Tick` 0x4AF7F0, `StateWalk` 0x4AFF20,
`DealDamage` 0x4B1200/0x4B13E0, `CheckIfDestroy` 0x4B0FB0,
`FindBlockingEnemies` 0x4B2AF0, `DamageHelper.DamageRateByAttributes`
0x943390. Suggested order inside the phase: walk-only enemy (path +
speed) → damage/death → blocking/overtake AI → ground offset/drift →
balloons → attack-home state → boss AI last.
Depends: Phase 0–2, 5 (home), 6 (waves).

### Phase 8 — Towers (~145 methods)
`GameCoreTower` (36), `TowerStateMachine` (6) + `State`/`StateMachine`
generics (~20), 8 `TowerState*` (~46), `EnemyDetectorSphere` (21) +
`EnemyDetectorCone` (29) + `IEnemyDetector`, `TowerHelper` (12),
`GameCoreTree` (8).
Critical: `TowerStateAttack.OnAttack` 0x4E1380, `TowerStateIdle.UpdateTarget`
0x4E3650, `TowerHelper.GetNearestTargets` 0x4E0150,
`GameCoreTower.GrantEXP` 0x4D0900, `TowerHelper.FromTreeToTower` 0x4D6170.
Depends: Phase 7 (targets), Phase 4 (costs). Start with ONE tower type
(trajectory or instant) and the Build→Idle→Attack cycle; add magazine,
caution, gem/hive states later.

### Phase 9 — Projectiles (~72 methods)
Base (7) + Trajectory (10) + Instant (5) first (they close the
tower→enemy→coin loop), then Beam (7), Electric (5), Lightning (6),
Gaseous (16), Insect (14), Gem (2).
Critical: `GameCoreProjectile.GetAttackDamage` 0x4C3620,
`GameCoreProjectileTrajectory.Tick` 0x4CC610 / `OnHit` 0x4CCCE0.
Depends: Phase 7–8.

### Phase 10 — Buffs (~41 methods + settings glue)
`Buff` (11), `BuffContainer` (9), 7 concrete buffs (21),
`BuffSettingOverrideFreeze`; port Q4 `BuffSetting.AddBuff` logic into a
sim-side factory. Depends: Phase 7 (targets), 9 (source projectiles).
Burn/Freeze/Slow first (they modify enemy speed/HP, easy to verify);
Bomb/Flare/Trampoline/FastPlayer after.

### Phase 11 — Player, fruit, interaction, commands (~135 methods)
`GameCorePlayer` (34), `GameCoreFruit` (28), `GameCoreInteractionObject`
(21), `GameCoreTree` revival glue, `NetworkCommand` + 24 commands (~50),
`GameCoreNetworkBridge` single-player subset (`AddPlayerCommand`,
`Update`, `GameCoreMustWait`, `OnGameCoreTicked`), `GameCoreBridge`
equivalent (maps + fixed-step driver + scene bootstrap),
`GameCoreLocalMultiplayerInfo` stub, `GameCoreShop` stub.
Critical: `BuildTowerCommand.ExecuteCommand` 0x4D5D30,
`SpawnFruitCommand.ExecuteCommand` 0x4DF1E0,
`GameCoreNetworkBridge.AddPlayerCommand` 0x4D6C40 / `Update` 0x4DAD50,
`GameCoreBridge.CreateGameCoreFromCurrentUnityScene` 0x44A2D0.
Depends: everything above. For a headless rebuild, replace the Q4
movement driver with a scripted/recorded input feed into
`GameCorePlayer.position` + commands.

### Phase 12 — Verification & extras
`NetworkLog`-style per-frame hashing as a determinism regression test;
`SerializeGameState`/`DeserializeGameState` for save-states; then optional
content (bosses, balloon enemies, all tower types, hidden pickups).
**Out of scope:** online services (`Q4.Networking`, Steamworks, NP
Toolkit), resync protocol, `postResyncEvent` handling, analytics.

### Minimal playable slice (one level: waves + one shooting tower + coins + win/lose)

Required, in dependency order:
1. Phase 0 math/paths (subset: `CatmullCurve`, `CorePathMove`).
2. Phase 1 core runtime (can simplify: single mutable frame instead of
   copy-on-tick IF determinism/resync is not needed — but keeping the copy
   model is safer and matches the original).
3. Phase 2 events (subset: wave/enemy/tower/pickup/inventory events).
4. Phase 3 data for ONE enemy type + ONE tower type + one stage's wave list.
5. Phase 4 economy (inventory + currency pickups).
6. Phase 5 home (chibi count = lose condition).
7. Phase 6 wave manager (no boss-minion lists).
8. Phase 7 enemy **subset**: ctor, `Tick`/`StateWalk` (no blocking AI at
   first), `DealDamage`/`CheckIfDestroy`, `Attack(home, chibi)`,
   `GetCoinValue` — ~20 of 90 methods.
9. Phase 8 tower **subset**: `GameCoreTower` core + Build/Idle/Attack
   states + sphere detector + `TowerHelper.GetNearestTargets`/
   `IsTargetInFireRange` + `GameCoreTree` — ~50 of 145 methods.
10. Phase 9 **one** projectile (`GameCoreProjectileTrajectory` or
    `Instant`) + `DamageHelper.DamageByAttributes` — ~20 of 72 methods.
11. Phase 11 commands **subset**: `AddLocalPlayerCommand`,
    `BuildTowerCommand`, `SellTowerCommand`, `AddInventoryCommand` +
    the bridge driver; a stationary auto-collecting "player" position is
    enough for coins.

That is roughly **250–300 methods** (many trivial accessors) to simulate a
level headlessly: waves spawn, walk the path, a tower shoots them, coins
drop and are collected, chibis die on leaks, stage clears or game-overs.
Buffs, fruit throwing, bosses, balloons, hive/gem/lightning towers,
interaction objects and the full player avatar are all additive after that.

### Unknowns to resolve during decompilation (explicit list)
1. Exact iteration/order semantics of `GameCoreFrame.TickAllObjects`
   (insertion order? type-priority? two passes?) — 0x4AAC90.
2. Where commands execute relative to the frame copy — 0x4DAD50/0x4DBC00.
3. ~~`GameCoreObject.RandomRange` algorithm (handle-seeded hash?)~~ RESOLVED:
   plain `UnityEngine.Random.Range`; handle only feeds NetworkLog online.
4. Wave activation semantics (`remainingWaveActivateDelay` vs
   `curveLengthBeforeActivation` vs `waveActivateEvent`) — 0x4D3140.
5. Damage/attenuation formulas: `GetAttackDamage(distance)`,
   `AttenuationCurve.Sample`, `distanceToCenterRate` usage,
   `m_vulnerableDamageTaken` accumulation — 0x4C3620, 0x4B1200.
6. Interest/wave-clear coin math — `GameCoreInventory.OnWaveEnded` 0x4BDAD0.
7. Who writes `GameCorePlayer.position` (Q4 `PlayerMotor` path) and how
   `sampleTime`/`animationStateHash` are used.
8. `TowerStateDegenerate` purpose; `GameCoreProjectileInsect.m_playersPassedBy`
   purpose; `BuffFlare` exact effect; `InsectState` delegate-as-state trick.
9. Pickup drop ownership split between `GameCorePickupManager` and Q4
   `PickupManager` (who decides counts/positions on enemy death).
10. `GameCoreNetworkBridge` single-player path through `NullNetworkLayer`
    (confirm no waiting/priming in solo mode).
