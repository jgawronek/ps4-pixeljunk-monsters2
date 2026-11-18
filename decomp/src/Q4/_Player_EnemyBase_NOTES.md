# Q4.Player / Q4.EnemyBase — structural notes (NOT full reconstructions)

Scope note: these two classes are too large to reconstruct method-by-method in
this pass (Player 177 methods / 138 fields; EnemyBase 75 methods / 164 fields).
This file maps their structure and — most importantly — how they drive and
reflect their GameCore counterparts across the seam. Everything marked
**[verified]** was read from the Ghidra pseudocode in
`decomp/decompiled/Q4.Player.c`, `Q4.PlayerMotor.c`, `Q4.EnemyBase.c` (and the
GameCore-side files cited); offsets/RVAs come from `decomp/skeleton/Q4.cs`
(Player TypeDefIndex 2753, EnemyBase 2733) unless noted.

---

## 0. The seam in one picture (verified end-to-end)

```
BOOTSTRAP
  GameCoreBridge.CreateGameCoreFromCurrentUnityScene @0x44A2D0
    scene MonoBehaviours implementing GameCore.IPlaceableViewObject
      -> CreateGameCoreObject() creates the core object and registers the view
         (Player @0x3EA730, Home @0x462650, WaveManager @0x9024A0,
          PickupManager @0x3E5700, Shop @0x75E900, TowerBase @0x54BB00,
          NatureTree @0x64A310, InteractionObject @0x464CB0, Fruit @0x439510)

PER-FRAME (single-player)
  GameCoreBridge.Update @0x449D80
    -> CheckForNextUpdateFrame @0x449EB0 (one tick per Update in SP)
       -> GameCore.PrepareNextFrame @0x4AA8C0
            (in-place: frameTime += dt, snapshot previousTickPosition,
             purge destroyed objects — NOT a deep copy in the tick path)
       -> GameCoreNetworkBridge.OnGameCoreTicked @0x4DC7D0
            (a) sample each LOCAL Q4.Player view -> NetworkDataBlobPlayerSample
                { position, facingDegrees, animationStateHash, animationTime,
                  sampleTime, towerDanceHandle }  (ctor @0x4DD5F0/0x4DD430)
            (b) apply received frames (NullNetworkLayer loopback in SP):
                write samples into GameCorePlayer (position via inlined
                set_position + collisionManager.UpdateCoreObject @0x4ABB80;
                facingDegrees +0x64; animationStateHash +0x68;
                animationStateTime +0x6c; sampleTime +0x74)
                and execute each queued NetworkCommand.ExecuteCommand(corePlayer)
                (vtable +0x150)  <-- THIS is where gameplay mutations happen
       -> GameCore.Tick @0x4AAB30
            TickDeltaTime = Min(Time.deltaTime, 0.5f) in SP (1/60 in network)
            GameCoreFrame.TickAllObjects @0x4AAC90 (list order, virtual Tick
            at vtable +0x180), then post-tick events + NetworkLog.EndLogFrame

ENEMY SPAWN (verified)
  GameCoreWaveManager spawns GameCoreEnemy; the GameCoreEnemy CTOR @0x4AD0E0
  itself instantiates the view: Object.Instantiate<EnemyBase>(enemyPrefab,
  spawnPos, identity) [decompiler artifact <LightningBoltScript>], then
  GameCoreBridge.SetUnityObject(handle, view), tags it "Character", parents it
  under the enemy root. Prefab name cached at core +0x68 for RecreateViewer.
  (Q4.WaveManager.OnSpawnGroupStarted @0x902600 only spawns the spawn VFX.)

ENEMY DEATH / HOME ATTACK (verified call graph)
  GameCoreEnemy.DealDamage -> CheckIfDestroy -> enemyDestroyedEvent
    -> EnemyBase.OnEnemyDestroyed @0x7FF0E0 -> StateDeadInit @0x7FF1C0
       (death physics: StrongDeath/WeakDeath speeds, crumble) -> StateDead
       @0x7FCE90 runs the corpse sim until DestroyDelay, then destroys the GO.
  GameCoreEnemy.Attack(home, chibi) -> enemyAttackEvent
    -> EnemyBase.OnEnemyAttack @0x7FFDC0: stores m_chibi (0x2E0), reads
       ChibiData.pos (+0x18), drives the carry-off animation, fires
       UnityEvents.chibiKilledEvent -> Chibi.OnEnemyAttackedMe @0x742DE0.
```

Key consequence: **views never mutate sim state directly** (except the Player
pose samples). All gameplay changes go through `GameCoreNetworkBridge.
AddPlayerCommand(playerID, command)` @0x4D6C40, even in single-player.

---

## 1. Q4.Player (177 methods, 138 fields) — the avatar view

`public class Player : MonoBehaviour, IPlaceableViewObject` — presentation of
one GameCorePlayer. Movement is **presentation-driven**: the sim has no
velocity/motor fields; PlayerMotor moves the Unity avatar and the pose is
sampled into the sim once per tick (§0).

### 1.1 Field groups (offsets from skeleton)

- Tuning (SerializeField, exposed as read-only properties, getters @0x3E5F80..0x3E6460):
  `m_WalkSpeed` 0x24, `m_RunSpeed` 0x28, `m_Acceleration` 0x2C, `m_Deceleration` 0x30,
  `m_TurnSpeedMax` 0x34, `m_TurnSpeedWeight` 0x38, `m_HoldingFruitSpeedScale` 0x3C,
  jump: `m_JumpSpeed` 0x40, `m_JumpBoostAutoDur` 0x44, `m_JumpBoostDur` 0x48,
  `m_JumpBoostGravity` 0x4C, `m_JumpGravity` 0x50, `m_JumpAttempts` 0x54,
  `m_JumpAirTime` 0x58, `EnableFixedTimeStepMovement` 0x5C,
  slopes: `m_SlideSpeed` 0x60, `m_SlideAngleMin` 0x64, `m_SlopeAcceleration` 0x68,
  `m_SlopeDistFromGround` 0x6C, `m_SlideStrength` 0x70, `m_SlideBounce` 0x74,
  `m_SlopeUpAngle` 0x78, `m_SlopeUpSpeedScale` 0x7C, `m_SlopeDownAngle` 0x80,
  `m_SlopeDownSpeedScale` 0x84,
  throw: `m_ThrowMinH` 0x88, `m_ThrowMinV` 0x8C, ... (ThrowMaxH/V, IdleH/V, PickupDelay),
  hip attack: HipAttackGravity/DelayDur/MinStartHeight/MinAttackHeight/Power/
  BounceH/BounceV/AimAssist/OnlyAboveMinStartHeight/OnlyIfTarget/TargetMaxDist
  (0x90..0xBC region), enemy bounce: EnemyBounceH/V/InvulnerabilityDur/DropCoins/
  DropGems/ValuePerCoin/ValuePerGem/StunDur, EnemyStunRecoverPresses, StunnedBounce,
  MaxFallDistance, FallBounce, BombDamageMin/MaxH/V,
  drowning: `m_EnableDrowning` 0x114, `m_DrownDepth` 0x118, `m_DrownDragH` 0x11C,
  `m_DrownDragV` 0x120, buoyancy min/max/distScale 0x124..0x12C,
  `m_DrownRespawnDelay` 0x130, rotation/bob fields 0x134..0x144,
  respawn curves `m_RespawnMovementTime` 0x148 / `m_RespawnMovementHeight` 0x150,
  `m_RespawnDuration` 0x158,
  avoidance: `m_EnableAvoidance` 0x15C, ranges 0x160/0x164, `m_AvoidanceForce` 0x168,
  dance-XP: `m_TowerXPIdleDur` 0x16C, `m_TowerXPIdleCoolDownDur` 0x170,
  `m_TowerXPInterval` 0x174, `m_TowerXPAmount` 0x178, `m_TowerBuildDanceDur` 0x17C,
  `m_TowerBuildDanceRange` 0x180, `IdleDelayMin/Max` 0x184/0x188, `LavaJumpSpeed` 0x18C.
- Identity/combat typing: `oneKickOneBalloon` 0x18, `strengthType` 0x1C
  (EEnemyStrengthTypeDef), `classType` 0x20 (EEnemyClassTypeDef) — the player's
  hip-attack damage typing, passed to HipAttackEnemyCommand.
- Components (auto-properties): `Motor` (PlayerMotor) 0x1C8, `Controller`
  (PlayerController) 0x1D0, `HeadTracking` 0x1D8, `IKBiped` 0x1E0,
  `StructureSelector` (PlayerStructureSelector) 0x1E8, `Interactible`
  (PlayerInteraction) 0x1F0, `PlayerSequencer` 0x1F8, `PlayerAnimator` 0x200.
- Identity/state: `playerName` 0x208, `playerID` 0x210, static `m_playerList`
  (List<Player>, statics+0x0), `m_transform` 0x218, `m_hipsTransform` 0x220,
  `m_lastpos` 0x228, `m_isEndOfGame` 0x234, `m_isPlayerEnabled` 0x235,
  `m_isLocal` 0x236, `m_DanceState` 0x238 (EDanceState), `m_DanceXPLevel` 0x23C,
  `m_TowerBuildDanceTime` 0x240, `m_TowerBuildDancePos` 0x244, `IdleTime` 0x250,
  `XPTime` 0x254, `DanceEffectInstance` 0x258, `m_ParticleGroupEvent` 0x260,
  `m_TowerHandle` 0x268 (GameCoreHandle — dance target), `m_playerAvatarDecorator`
  0x288, `cameraFocusTarget` 0x290, `m_iceSFX` 0x298, `m_fireSFX` 0x2A0,
  `m_iceEffect` 0x2A8, `m_fireEffect` 0x2B0.
- Misc serialized: `m_Sounds` 0x190 (AudioEventHandler.Sounds), local-multiplay
  join/leave effects 0x198/0x1A0, overhead-icon flags/offsets 0x1A8..0x1B4,
  `m_SpeedPotion` 0x1BC, `m_AutoPickup` 0x1BD, `m_ButtonPickup` 0x1BE,
  `m_EnableNewCollisions` 0x1BF, `IsLeavingGame` 0x1C0.

### 1.2 Key methods (RVAs)

Lifecycle / wiring:
- `.ctor` @0x3E5B00; `Awake` @0x3E6920; `Start` @0x3E76D0 (event subscriptions
  live here / in InitPlayerComponents); `OnEnable` @0x3E6A10 **[verified]** just
  calls SetHeldFruitEnabled(true); `OnDisable` @0x3E6BB0 (inverse);
  `Terminate` @0x3E7F20; `OnDestroy` @0x3E8580.
- `InitPlayerComponents` @0x3E7BE0 / `ManualInitPlayerComponents` @0x3E8970 —
  GetComponent wiring for Motor/Controller/HeadTracking/IK/Animator/etc.
- `SetInfo(string name, PlayerInfo info)` @0x3E6BC0 **[verified]**: sets
  playerName/playerID/m_isLocal, IdleTime=0; for local players AddComponent
  PlayerStructureSelector + PlayerInteraction (decompiler artifacts
  <GestureInputModule> with two distinct rgctx slots); names the GameObject;
  applies mask/carapace customization (SetCustomizedParts @0x3E72A0 /
  SetCustomizedPartsFromSettings @0x3E6D10, prefab overload @0x3EABF0).
- `GetTransform()` @0x3E6910 **[verified]** returns m_transform (0x218).
- Statics: `players` getter @0x3E1330 (m_playerList), `GetPrimaryLocalPlayer`
  @0x3E0FC0, `GetPlayer(int)` @0x3E74D0, `IsLocal()` @0x3E7430,
  `IsPrimaryLocalPlayer()` @0x3E7440.

Per-frame:
- `Update` @0x3E8A20 **[verified]**:
  ```
  dt = Time.deltaTime
  m_TowerBuildDanceTime = Max(0, m_TowerBuildDanceTime - dt)
  if (!m_isLocal) MirrorRemotePlayer()
  if (m_isPlayerEnabled && PlayerSequencer != null) PlayerSequencer.UpdateSequence(dt)
  if (Motor != null) Motor.UpdateMotor(dt)
  if (m_isLocal && GameCoreBridge.Instance != null) CheckForTowers(dt)
  m_lastpos = m_transform.position
  m_ParticleGroupEvent.<grounded flag 0x28> = Motor.m_isGrounded (0x87)
  IKBiped.Mode = Motor.m_isGrounded
  m_iceSFX.transform.position = m_fireSFX.transform.position = m_transform.position
  ```
- `LateUpdate` @0x3E9F40 **[verified]**: HeadTracking.LateUpdateCall() only.
- `MirrorRemotePlayer` @0x3E8DC0 **[verified]** (non-local players only):
  ```
  t = Clamp((networkBridge.synchronizedWallClockTime - corePlayer.sampleTime) / K, 0, 1)
  m_transform.position = Lerp(corePos, corePos, t)   // two get_position calls in
                                                     // the binary; INFERRED one is
                                                     // previousTickPosition/sample
  m_transform.rotation = AngleAxis(corePlayer.facingDegrees, up)
  animator.SetFloat("Random", Lerp(animTime, animTime, t))  // TODO: confirm operands
  ```
  (K = DAT_00b7a6d4; remote interpolation window. TODO: confirm exact operands.)
- `CheckForTowers(float dt)` @0x3E9670 — dance-XP mechanic: while idle near a
  tower, accumulates XPTime and every m_TowerXPInterval sends
  **TowerXPCommand** (amount = DifficultySettings.DanceEXPByDifficulty(m_TowerXPAmount))
  via AddPlayerCommand **[verified command emission @0x3E3422 region]**; also
  handles m_TowerBuildDance (build dance after OnTowerBuild).
- `SetEnabled(bool)` @0x3E9FE0 / `IsEnabled()` @0x3E9FF0 — m_isPlayerEnabled.

Sim bootstrap / reflection:
- `GameCore.IPlaceableViewObject.CreateGameCoreObject` @0x3EA730 **[verified]**:
  ```
  var corePlayer = new GameCorePlayer();
  corePlayer.playerId = playerID;                 // core +0x60
  corePlayer.position = transform.position;
  GameCoreBridge.Instance.SetUnityObject(corePlayer.handle, this);
  if (Player.players.Count > 1 && !NetworkMatch.IsNetworkMatch)
      GameCoreLocalMultiplayerInfo.AddLocalMultiplayerMarkerToGameCore();
  return corePlayer;
  ```
- `OnHiddenPickupFound(GameCorePlayer, EInventoryType, int)` @0x3EA630 —
  hiddenPickupFoundEvent feedback.
- `OnStageCleared(GameCoreWaveManager)` @0x3EA010, `OnStageClearScreenWiped`
  @0x3EA320, `OnGameOver` @0x3EA590 — end-of-game presentation.
- `OnTowerBuild(tower, tree, player)` @0x3EA9A0, `OnTowerUpgrade(tower, upgrade)`
  @0x3EAAF0 — towerBuildEvent/towerUpgradeEvent feedback (build dance etc.).
- `OnBuffStart(GameCoreObject, BuffSetting)` @0x3EB7C0 / `OnBuffEnd(GameCoreObject,
  Type)` @0x3EB980 — addBuffEvent/removeBuffEvent; EnableFire @0x3EB5C0 /
  ExtinguishFire @0x3EA350 / EnableIce @0x3EB6C0 / ExtinguishIce @0x3EA470;
  `IsOnFire` @0x3EB4E0 / `IsOnIce` @0x3EB550.
- `OnBusyEventReceived(GameCoreHandle, bool)` @0x3EBB70 / `OnBusyEventSend(bool)`
  @0x3EBD00 — busyEvent (menus/dialogs); sends **BusyCommand**.
- `SetCameraFocusTarget(CameraTarget)` @0x3EBB60; outline rendering hooks
  @0x3E7E80/@0x3E8660/@0x3E86F0.

### 1.3 PlayerMotor (87 methods) — where movement actually happens

`Q4.PlayerMotor` (TypeDefIndex 2760) owns the CharacterController/Rigidbody and
the TikimanStateMachine (Q4 state machine built on GameCore.StateMachine<T>).
Key fields: `m_player` 0x20, `m_characterController` 0x28, `m_transform` 0x30,
`m_rigidbody` 0x38, `m_currentVelocity` 0x40, `m_currentVelocityH` 0x4C,
`m_moveVector` 0x58, `m_faceVector` 0x64, `m_slideVector` 0x70, `m_isRun` 0x84,
`m_isInputMoving` 0x85, `m_isJumpRequest` 0x86, `m_isGrounded` 0x87,
`m_ExternalDeltaPos` 0x88, `m_Mode` 0xE8 (EMode), `m_stateMachine` 0xF0,
`m_hipAttackEnemy` 0x148 (GameCoreEnemy), `m_deltaTimeRemainder` 0x174,
`m_interactableFruitHandle` 0x180. Constants: `FIXED_UPDATE_DT = 1/60`,
`FIXED_UPDATE_DT_TOL = 0.00016666666`.

- `UpdateMotor(float dt)` @0x3E91C0 **[verified]**: guards m_player;
  UpdateAttackTarget; syncs transform.position from rigidbody.position; feeds
  the state machine (IsMoving/MoveVelH/IsJumpRequest/InputDir/InputJump/
  InputDrownJump), TickState(dt) (vtable +0x150), WaterBouyancy, then:
  ```
  if (!m_player.EnableFixedTimeStepMovement)
      UpdateMovementInternal(dt);
  else {
      m_deltaTimeRemainder += dt;
      while (m_deltaTimeRemainder >= 0.0165f) {        // DT - TOL, ELF @0x00B7A6D8
          UpdateMovementInternal(1f/60f);              // @0x00B7A6DC
          m_deltaTimeRemainder -= 1f/60f;              // @0x00B7A6E0
      }
  }
  ```
  then UpdateGroundDetection, CheckForFruit/AutoPickUpFruit, clears per-frame
  input vectors, records m_lastKnownGroundPos. **This is the only true
  fixed-step loop in the SP seam — it paces avatar physics, not the sim.**
- `UpdateMovementInternal` @0x3F6230 — reads core player via
  bridge.GetGameCoreObject<GameCorePlayer>(gameObject): multiplies speed by
  `corePlayer.GetSpeedScale()` (buffs) and by HoldingFruitSpeedScale when
  `corePlayer.IsHoldingFruit` **[verified]**. Moves the CharacterController.
- Command emissions **[verified]**: DropFruitCommand (when the held fruit is
  dropped/thrown, @0x3F0 region), TriggerInteractionCommand (interaction zone,
  end of UpdateMotor), HipAttackEnemyCommand (hip attack lands — see
  UpdateAttackTarget @0x3F0280 and m_hipAttackEnemy). Pickup/throw fruit go
  through PickupFruitCommand/DropFruitCommand/SpawnFruitCommand elsewhere
  (PlayerInteraction / FruitShop).
- `FixedUpdate` @0x3F0270 is a stub (empty) — movement is Update-driven with the
  accumulator above, NOT Unity FixedUpdate.

### 1.4 How Player reflects/drives GameCorePlayer — summary

- DRIVES: pose samples (position/facing/anim state) once per sim tick via
  OnGameCoreTicked (§0); gameplay intents via NetworkCommands (TowerXP, Busy,
  DropFruit, TriggerInteraction, HipAttack, EnterLeaveTower, ...).
- REFLECTS: held fruit (corePlayer.HeldFruit -> fruit view active state,
  SetHeldFruitEnabled @0x3E6A20 **[verified]**), speed scale & buffs (motor),
  fire/ice effects (buff events), busy bubble, dance state; remote players are
  interpolated mirrors of the core state (MirrorRemotePlayer).
- The core object's `position` is ONLY written by the sample-application path
  (and at bootstrap); no Q4 method calls set_position during movement
  **[verified by exhaustive grep of decompiled Q4 files]**.

---

## 2. Q4.EnemyBase (75 methods, 164 fields) — the enemy view

`public class EnemyBase : MonoBehaviour` — presentation + death/attack
choreography for one GameCoreEnemy. Unlike the player, enemy movement is
simulated in the core (path following); the view mostly FOLLOWS the core
position and adds visual physics (hit shock, death ragdoll-ish bounce, drown).

### 2.1 Field groups (offsets from skeleton)

- Data-table stats (copied INTO GameCoreEnemy at construction; many carry
  [AttributeSyncWithJson]): `enemyMoveType` 0x20 (EEnemyMoveTypeDef),
  `spawnMode` 0x24 (ESpawnMode), `expValue` 0x28, `maxLife` 0x2C, `speed` 0x30,
  `fireSpeed` 0x34, `balloonSpeed` 0x38, `targetOffset` 0x3C, `groundOffsetY` 0x48,
  `offsetHpGauge` 0x4C, shock spring: `maxShockSpeed` 0x58, `additionShockRate`
  0x5C, `shockCurveInfos` 0x60, `shockScale` 0x68, `shockSpring` 0x6C,
  `shockDamping` 0x70, `collisionScaleH/V` 0x74/0x78.
- Animation tuning: `enableAnimMoveSpeedScaling` 0x7C, `animMoveSpeed` 0x80,
  `randomWalkAnimIntervalMin/Max` 0x84/0x88, freeze anim 0x8C..0x94.
- Sounds: `Sounds` 0x98, `deathSound` 0xA0, `damageEffectiveSound` 0xA8,
  `damageIneffectiveSound` 0xB0, `randomWalkSound` 0xB8 (+intervals 0xC0/0xC4),
  `deathHitGroundSound` 0xC8, `attackSound` 0xD0.
- Slopes: `m_EnableSlopeMovement` 0xD8, up/down angles+scales 0xDC..0xE8.
- Death: `IsCrumbleDeath` 0xEC, `DestroyDelay` 0xF0, `StrongDeathSpeedH/V`
  0xF4/0xF8, `WeakDeathSpeedH/V` 0xFC/0x100, `BombAttenuationCenter/Outside`
  0x104/0x108, `StrongDeathBounce` 0x10C, `StrongDeathFriction` 0x110,
  `DrownDepth` 0x114.
- Attack: `AttackType` 0x118 (EAttackType Ground/Jump), `AttackDestroySelfDur`
  0x11C, `AttackRange` 0x120, `AttackDstHeightOffset` 0x124, `AttackDelay` 0x128,
  `ChibiAvoidRadius` 0x12C, `ChibiAvoidDur` 0x130.
- Balloons: `BalloonSpawnHeight` 0x134, `BalloonHeight` 0x138, `BalloonAccScale`
  0x13C, `BalloonDamping` 0x140, `BalloonTargetHeight` 0x144.
- Boss: `m_bossType` 0x148 (EBossType None/Bero/Fat/Tall/Kao), `m_bossSinkSpeed`
  0x14C, `m_bossSinkShake` 0x150, `m_isJumpingBoss` 0x154, `m_bossJumpDur` 0x158,
  `m_bossRestDur` 0x15C, `m_bossJumpUpSpeed` 0x160, `m_attackFreq` 0x164,
  `m_bossAttackDur` 0x168, `m_bossAttackDist` 0x16C, `m_bossAttackHeightForward/Back`
  0x170/0x174, `m_lowHpThreshold` 0x178, `m_lowHpSpeed` 0x17C,
  `m_damagedHpThreshold` 0x180, boss damage-anim durs 0x184/0x188,
  `m_bossSpawnWaitDur` 0x18C. (All exposed as properties for GameCoreEnemy to
  read at construction.)
- Misc: `m_TrampolineSpeed` 0x190, `m_waveBarSprite` 0x198, `m_ScareAnimals` 0x1A0,
  health-bar/critical-icon/tracker offsets 0x1A8..0x1F0, debug flags 0x1FC/0x1FD.
- Runtime: `Transform` 0x18 (auto), `m_Animator` 0x200, animator param hashes
  0x208..0x248 (Run, Attack, TakeDamageWeak/Strong, TakeHipAttackDamage,
  MoveSpeedScale, WalkCycleOffset, Die, DeathType, DeathImpact, Balloon,
  BalloonFall, BalloonFallLand, RandomWalkVariation, Drown, state tags
  DrownDead/Dead), `m_randomWalkAnimTime` 0x24C, `m_randomWalkSoundTime` 0x250,
  balloon transforms 0x258..0x268, `m_Balloon` 0x270, `m_isBalloonFall` 0x278,
  `m_eventHandler` 0x280 (ParticleGroupEvent), `m_EnemyMode` 0x288 (EEnemyMode
  Move/Attack/Dead/Drown), `m_IsGameOver` 0x28C, `m_lastPos` 0x290, `m_vel` 0x29C,
  `m_wasDamaged` 0x2A8, `m_DeadTime` 0x2AC, `m_StrongDeath` 0x2B0, `m_DeadVel`
  0x2B4, `m_DeadPos` 0x2C0, `m_DeathRot` 0x2CC, `m_chibi` 0x2E0 (ChibiData being
  carried), attack choreography 0x2E8..0x304, ice/fire/sink effects 0x310..0x320,
  SFX AudioSources 0x328..0x340, `m_attackPointObjects` 0x348 (List<GameObject>),
  **`m_coreHandle` 0x350 (GameCoreHandle)**, hit-shock state 0x370..0x37C,
  `m_frozenAnimTime` 0x380, boss anim state 0x384..0x3A4, `m_isInWater` 0x3A5,
  `m_drownFloatPosY` 0x3A8, `HasTriggeredAttack` 0x3AC.

### 2.2 Key methods (RVAs)

- `.ctor` @0x7F9470 (initializes m_coreHandle to nullHandle);
  `Awake` @0x7F9A60 **[verified]**: Transform = GetComponent<Transform>();
  randomizes walk-anim/sound timers.
- `Start` @0x7F9AF0 (virtual Slot 4) **[verified subscription list]** — all with
  EventTime.PostUnityUpdate: gameOverEvent(+0x38)→OnGameOver,
  enemyDestroyedEvent(+0x40)→OnEnemyDestroyed, enemyHitEvent(+0x50)→OnEnemyHit,
  enemyDrownEvent(+0x58)→OnEnemyDrown, enemyAttackEvent(+0x60)→OnEnemyAttack,
  jumpReactionEvent(+0x68)→OnJumpReaction, bossJumpEvent(+0x70)→OnBossJump,
  popBalloonsEvent(+0x80)→OnPopBalloons, addBuffEvent(+0x150)→OnBuffStart,
  removeBuffEvent(+0x158)→OnBuffEnd, onFireExtinguished(+0x170)→OnFireExtinguished,
  bossAttackEffectEvent(+0x1C8)→OnBossAttackEffectEvent; bosses also
  spawnGroupStartedEvent(+0x20)→OnSpawnGroupStarted. Then resolves
  **m_coreHandle = bridge.GetGameCoreObject<GameCoreEnemy>(gameObject)?.handle
  ?? nullHandle** **[verified]**.
- `InitAnimation` @0x7FA210 (hashes via Animator.StringToHash), `InitAI`
  @0x7FA820 **[verified]**: m_EnemyMode=Move, m_lastPos=Transform.position,
  m_vel=zero, BossInit @0x7FB740.
- `Update` @0x7FB8E0 **[verified]**:
  ```
  dt = Time.deltaTime
  UpdateFrozen(dt)                                   // freeze-buff anim throttling
  core = m_coreHandle.GetMostRecentObjectVersion<GameCoreEnemy>()
  if (core != null) UpdateHitShock(dt, core)         // spring-damper hit bounce
  switch (m_EnemyMode):
    Move:   StateMove(dt, core); m_vel = pos - m_lastPos; m_lastPos = pos;
            random walk anim trigger + randomWalkSound on timer
    Attack: boss ? StateBossAttack(dt, core)
                 : (AttackType==Jump ? StateJumpAttack(dt) : StateGroundAttack(dt))
    Dead:   StateDead(dt)
    Drown:  StateDrown(dt)
  if (m_isBalloonFall && core.GroundOffsetY <= 0) animator.SetTrigger(BalloonFallLand)
  ```
- `StateMove` @0x7FC140 **[verified]**:
  ```
  if (m_IsGameOver) { animator.SetFloat(MoveSpeedScale, 0); return; }
  Transform.position = core.position + up * m_hitShockHeight;
  speedScale = Clamp(core.SpeedCur / 1.75f, 0.5f, 1.0f);      // ELF @0x00B92988..90
  delta = core.position - core.previousTickPosition (y=0);
  if (delta.magnitude >= 1e-6f)                               // @0x00B92998
      Transform.rotation = RotateTowards(rot, LookRotation(delta, up),
                                         speedScale * 75f * dt); // @0x00B92994
  // anim speed from per-tick displacement:
  animSpeed = (enableAnimMoveSpeedScaling)
      ? (dist / dt) / animMoveSpeed
      : (dist / dt > 0.001f ? 1f : 0f);                       // @0x00B9299C
  animator.SetFloat(MoveSpeedScale, animSpeed);
  ```
  NOTE: the view SNAPS to core.position (no inter-tick lerp) — SP ticks once per
  frame; previousTickPosition is used for direction/anim speed only.
- `LateUpdate` @0x7FE1A0 — camera-facing bits (health bars/icons handled by UI).
- `UpdateHitShock(dt, core)` @0x7FBE30 — spring/damper on m_hitShockHeight using
  shockSpring/shockDamping/shockScale; triggered by OnEnemyHit.
- `OnEnemyHit(EnemyHitInfo)` @0x7FE710 — damage anim (weak/strong by
  info.strongToDamage), shock impulse, damage sounds, EnemyAttributesSettings
  effects; `OnJumpReaction(enemy, weight)` @0x7FE4E0; `OnBossJump(enemy, dur)`
  @0x7FE5E0.
- `BossUpdate(core, dt)` @0x7FDDE0 + `BossTakeStrongDamage` @0x7FEC20 — boss
  injured/slow modes, sink shake; `OnBossAttackEffectEvent` @0x800530.
- Attack states: `StateJumpAttack` @0x7FC670, `StateGroundAttack` @0x7FCA40,
  `StateBossAttack` @0x7FC490 — choreograph the wind-up/leap toward the home
  using core.m_attack* state; `OnEnemyAttack(enemy, home, chibi)` @0x7FFDC0
  **[verified]**: only reacts when home's view matches, stores m_chibi, reads
  ChibiData.pos, fires UnityEvents.chibiKilledEvent (Chibi dies), calls
  Chibi.NotifyBeingAttacked.
- Death: `OnEnemyDestroyed(sourceTower, enemy, hitInfo)` @0x7FF0E0 →
  `StateDeadInit` @0x7FF1C0 (picks Strong/Weak death velocities from hitInfo,
  crumble params via SetCrumbleParams @0x8003D0, death anim triggers) →
  `StateDead(dt)` @0x7FCE90 (integrates m_DeadVel with gravity/bounce/friction,
  destroys the GameObject after DestroyDelay; deathHitGroundSound on landing).
- Drown: `OnEnemyDrown(enemy)` @0x7FF010 → `StateDrown(dt)` @0x7FD770 (sinks to
  DrownDepth, drown anim, then destroy).
- Balloons: `OnPopBalloons(enemy, num)` @0x7FFC00 → `PopBalloons(num)` @0x7FFA70
  (m_Balloon.PopBalloons, fall state when all popped); `AttackPoints()` @0x7FE360
  returns m_attackPointObjects; `GetBasePosition()` @0x7FE400.
- Buffs: `OnBuffStart` @0x7FB400 / `OnBuffEnd` @0x7FB590 → EnableFire @0x7FAEB0 /
  ExtinguishFire @0x7FB0F0 / EnableIce @0x7FB2F0 / ExtinguishIce @0x7FB1F0 /
  OnFireExtinguished @0x7FAFC0; `UpdateFrozen(dt)` @0x7FBD30 (freeze anim
  interval/speed from m_freezeAnim* fields).
- `OnGameOver` @0x7FFCB0 sets m_IsGameOver (freezes anim speed).
- `UpdateOrientation(dt, lookat, anglePerSec)` @0x7FFCC0 — shared rotate helper.
- `OnSpawnGroupStarted(id, enemy, pos, isMinion)` @0x7FEED0 — boss minion-spawn
  anim (m_AnimParam_SpawnMinion).

### 2.3 Core-side counterparts (for cross-reference)

- `GameCoreEnemy.RecreateViewer` @0x4B2960 **[verified]**: existing
  GetUnityObject<EnemyBase>() or CreateViewerFromPrefabName<EnemyBase>(m_prefabName
  @0x68); returns its GameObject. Used by bridge resync.
- `GameCoreEnemy` ctor @0x4AD0E0 reads ALL the tuning properties above off the
  EnemyBase prefab (stats, boss params, attack params, sounds) — the prefab is
  the data table; wave/difficulty ratios scale hp/speed.
- Core movement fields (m_distance, pathMove, m_speedCur, GroundOffsetY,
  m_orientationInterpolator...) are what StateMove/BossUpdate read each frame.

---

## 3. Unknowns / TODO

1. **MirrorRemotePlayer interpolation operands** — the binary calls
   get_position twice; one operand is likely previousTickPosition or a stored
   sample. Confirm at 0x3E8DC0 (affects remote-player smoothing only; SP has no
   remote players).
2. **PlayerManager.JoinPlayer capacity guard** — counts are read but no
   comparison survives in the binary (see PlayerManager.cs INFERRED note).
3. **Structure.SetSelected component type** — inferred
   SkinnedMeshOutlineSetting from the Color-at-0x18 layout + confirmed
   GetComponent instantiation; verify against the prefab (not possible from
   code alone).
4. **Exact NullNetworkLayer loopback point** — where pendingPlayerBlobs are
   handed to the layer and come back as pendingReceivedFrames (inside
   GameCoreNetworkBridge / NullNetworkLayer, not decompiled in this pass; the
   application side IS verified in OnGameCoreTicked @0x4DC7D0).
5. **Player event subscription list** — Start @0x3E76D0 / InitPlayerComponents
   wire the callbacks listed in §1.2; the exact event→callback pairing was only
   partially traced (EnemyBase's is fully verified, §2.2).
6. Generic-sharing artifacts: decompiler names like
   `FindObjectsOfType<NatureTree>`, `Instantiate<LightningBoltScript>`,
   `GetComponent<DelegateUpdates>`, `GetUnityObject<Structure>` are shared
   generic bodies; the true type arguments used above were resolved from field
   types, confirmed instantiation lists (dump.cs) and call context, and are
   flagged in the reconstructed files.