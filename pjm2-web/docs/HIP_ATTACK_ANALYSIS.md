# Jump + hip attack ("Shell Attack") — analysis and port

Sources: IL2CPP decompile (`decomp/decompiled/Q4.TikimanState{Jump,Attack,AttackBounce}.c`, `Q4.PlayerMotor.c`, `Q4.PlayerController.c`, `Q4.Command{Jump,Attack}.c`),
serialized `Q4.Player` MonoBehaviour (globalsettings, pid 2514285418080110840, UnityPy), `tikiman_ctrl` AnimatorController (UnityPy), rodata floats
read from `Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000), loading-tip / guide strings (`strings.json`). Addresses are RVAs.

## 1. What the original does

### Input
`PlayerController.InitListeners` binds gesture actions `jump`, `jumpBoost`, `attack`, `interact`, `run`, `walk` (the gesture -> physical button table is not in the
decompile / bundles; `jump` = the PS4 cross button). `ReceiveJumpInput` -> `CommandJump(press = true)`, `ReceiveJumpBoostInput` -> `CommandJump(press = false)`,
`ReceiveAttackInput` -> `CommandAttack`. In-game text (`tl_guide_detail_05_03`, loading tip 16) says the hip attack is "press {jump} again" while a "!" is shown, so
attack and jump share the button. Port: **Space** (`PlayerController` gesture names kept in the comments).

### Jump (`PlayerMotor.Jump @003f3110`, `CanJump @003f2f30`, `TikimanStateJump`)
* `CanJump`: motor mode 0 (not jumping/attacking/bounced), not sliding, airborne timer (+0xA0) <= `m_JumpAirTime` (**0.1 s**, coyote time).
* Enter (`@0053f220`): `CurVelocity.y = m_JumpSpeed` (**7.5**), `JumpStartPos = position`, trigger `IdleJump` / `RunningJump` (by IsMoving), `PlaySFX(index 0)` = GlobalSounds.PlayerJump, rumble.
* `ApplyGravity @003f60b0`: grounded -> `vy = max(vy, -1)`; else `vy -= gravity * dt` with `OverrideGravity` if set, else **`m_JumpBoostGravity` 20** while `IsJumpBoost`, else `m_JumpGravity` **25**.
  `IsJumpBoost = jumpHeld && elapsed <= m_JumpBoostDur (0.5 s)` (Tick @0053f400 writes `sm+0x6d`; `jumpBoost` events set `sm.IsJumpRequest`).
  Apex = 7.5² / 50 = 1.125 m (1.41 m while held).
* Landing (`WorldCollisionHandler @003f3960`): `isGrounded && vy <= 0` -> mode 0, state Idle/Move, landing SFX (random pitch), `JumpStartPos` follows the feet while grounded.
  A drop > `Player+0xF0` (m_MaxFallDistance 4.0) starts `TikimanStateHighFall` (not ported).

### Hip attack
* **Target** (`UpdateAttackTarget @003f0280`, every frame): only while the Jump state runs, mode not in 3..6 and the player holds no fruit.
  `m_HipAttackOnlyAboveMinStartHeight` (true): `Physics.Linecast(pos + up*0.1 [DAT_b7a70c], pos - up*m_HipAttackMinStartHeight(1.5), TerrainMask)` must NOT hit.
  Then, if `OnlyIfTarget || AimAssist` (both true): `FindEnemyToAttack @003f3600` = `AIHelper.FindClosestObject<GameCoreEnemy>(pos + down*2.0, radius m_HipAttackTargetMaxDist 0.75, height 2.0)`.
  Result -> `PlayerMotor.HipAttackEnemy`; changes fire `Events.hipAttackConditionEvent` -> `HUDHipAttackIconPool` shows the "!" (`Animator bool ShieldAttack`).
  Consequence: on flat ground the apex (<= 1.41 m) is below the 1.5 m clearance, so the attack needs a ledge / slope / high ground ("jump of high positions", tip 16).
* **Attack** (`PlayerMotor.Attack @003f3510`): needs mode not 4/5, the Jump state running and `HipAttackEnemy != null`; mode = 3, `TikimanStateAttack(enemyHandle)`.
  Enter: trigger `HipAttack`, reset Pound/BounceSuccess/BounceFail/BounceLand, `PlaySFX(index 4)` = PlayerHipAtackStart.
  Tick (@00539a50): `elapsed += dt`; **elapsed < `m_HipAttackDelayDur` (0.5 s)**: OverrideGravity 0, OverrideVel = zero (hover). After: OverrideGravity = `m_HipAttackGravity` (**80**),
  OverrideVel = (0, curVel.y, 0), trigger `HipAttackPound` once, and while the enemy handle still resolves:
  `delta = PredictPositionAndDirection(enemy).pos + (0, collision.height * 0.75 [DAT_b7cf04], 0) - position; motor.external(+0x88) += delta * 0.2 [DAT_b7cf08]` (per Tick = per frame; UpdateMotor zeroes `+0x88` afterwards).
* **Contact**: in mode 3, `OnCollisionEnter` with an `EnemiesMask` collider -> `AttackLogic(enemy)`; any `CharacterController.collisionFlags != None` (`WorldCollisionHandler`) -> `AttackLogic(null)`.
  `AttackLogic @003f4110` (ignored while already in AttackBounce / Bounce / Stunned): mode 4; with an enemy `JumpStartPos.y - enemy.y >= m_HipAttackMinAttackHeight (1.0)` -> returns true;
  velocity `(forward * -m_HipAttackBounceH (2), m_HipAttackBounceV (6), ...)` (no enemy: `(0, 6, 0)`); `TikimanStateAttackBounce(velocity, power = m_HipAttackPower 30, enemyHandle)`.
* **AttackBounce.Enter** (@0053a0a0): local player -> `GameCamera.ShakeCameraOnAttack`; trigger `HipAttackBounceSuccess`; `CurVelocity = velocity`; if the handle is valid and the player is local:
  `HipAttackEnemyCommand(handle, 30, 0 coins, 0 gems, 1, 1)` via `AddPlayerCommand` (the sim half already in `src/core/network/HipAttackEnemyCommand.ts`: damage by the player view's strength/class [tikiman_01: Normal / Normal, oneKickOneBalloon 0]); `PlaySFX(index 5)` = PlayerHipAtackHit.
* **Landing from the bounce**: grounded, not rising, state timer > `DAT_b7a76c` (0.25 s) -> mode 0, Idle/Move.
* Animator (`tikiman_ctrl`): `HipAttack` -> Prepare (`tikiman_attack_carapace`), `HipAttackPound` -> Pound (same clip), `HipAttackBounceSuccess` -> BounceSuccess (`tikiman_attack_impactAir`, tag DisableMovement),
  `HipAttackBounceLand` -> BounceIdleLand (`tikiman_attack_impactLand`). `IdleJump` -> IdleToJump (`tikiman_idleToJump`), `RunningJump` -> RunToJumpL/R (`tikiman_runtojump_left/right`).
* GlobalSounds: PlayerJump = `sfx_tiki_jump`, PlayerHipAtackStart = `sfx_tiki_hipattack`, PlayerHipAtackHit = `sfx_tiki_hipattackenemy` (audio-out `globalsounds_map.json`; copied to `public/assets/audio/sfx`).
* Cooldown / stun: none specific. (Enemy-contact bump is the separate `PlayerBump`.)

## 2. Port

| file | role |
|---|---|
| `src/view/player/PlayerHipAttack.ts` | pure state machine (ground / jump / attack / bounce), constants `PLAYER_JUMP`, `HIP_ATTACK`; `tick()` before the mover, `afterMove()` after it |
| `src/view/player/PlayerMover.ts` | `MoverOptions.gravity / freeze / external` (OverrideGravity / OverrideVel / external displacement), `contact` (collisionFlags), `groundWithin()` (terrain linecast) |
| `src/view/player/HipAttackMarker.ts` | the "!" over the target |
| `src/view/characters/PlayerStageView.ts` | `playJump / playHipAttack / playHipPound / playHipBounce / endAir` clips |
| `src/main/stageSession.ts` | Space key (press + hold), event handling (SFX, HipAttackEnemyCommand, view), player view contract registration, bump suppression while diving |
| `tests/view/playerHipAttack.test.ts` | 12 tests |

Keys: **Space** = jump; hold = higher jump (boost gravity); Space again in the air while the "!" shows = hip attack. A bump while airborne cancels the state (BumpPlayer replaces it with TikimanStateBounce).

### Exact
Every constant above (Player MB values, rodata floats), the target rule (linecast + cylinder), hover / dive gravity and velocity override, 20 % homing, AttackLogic height rule and bounce velocity,
0.25 s bounce landing, command arguments, SFX identities, animator state -> clip mapping.

### Approximated / not ported
* Gesture -> button table (not in the data): Space is the port's choice. `jumpBoost` = key held.
* Homing is applied per frame scaled by `dt*60` (the original adds 20 % per Tick = per frame); `PredictPositionAndDirection` is evaluated at the current position (look-ahead 0).
* When the enemy is hit < 1.0 m below the jump start the port bounces without damage (the decompile builds the bounce for both outcomes; the return value of AttackLogic is the "hit" flag — the damage-on-false path was not provable).
* **Camera shake** (`GameCamera.ShakeCameraOnAttack`): the port's `StageCamera` has no shake yet (documented in its header); not wired. Rumble / vibration: none.
* "!" icon art/animation (HUDHipAttackIcon prefab) not decoded: a bobbing billboard "!" is used.
* Jump anim: RunToJump left/right alternate by foot cycle in the original; the port always uses the right-foot clip. IdleLand / `tikiman_land` and the Idle/Move blend after a plain jump are skipped (straight back to locomotion). High fall (> 4 m) is not ported.
* Jump-triggered fruit trampling uses the sim's own player-y check (`GameCoreFruit` `jumpCase`), unchanged.
* The press is processed on the next frame tick (the original processes the command in the sequencer the same frame); jump buffering does not exist in the original (`CommandJump` repeats are one-shot because `Jump()` always returns true).
