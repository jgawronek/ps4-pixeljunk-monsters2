// src/view/player/PlayerHipAttack.ts
// Player jump + HIP ATTACK ("Shell Attack") state machine, ported from the original (docs/HIP_ATTACK_ANALYSIS.md has the evidence trail):
//   Q4.PlayerController.ReceiveJumpInput / ReceiveJumpBoostInput / ReceiveAttackInput -> CommandJump / CommandAttack -> Q4.PlayerMotor.Jump / Attack
//   Q4.TikimanStateJump (Enter @0053f220, Tick @0053f400), Q4.TikimanStateAttack (Enter @005398b0, Tick @00539a50),
//   Q4.TikimanStateAttackBounce (Enter @0053a0a0), Q4.PlayerMotor.UpdateAttackTarget @003f0280, FindEnemyToAttack @003f3600,
//   AttackLogic @003f4110, WorldCollisionHandler @003f3960, OnCollisionEnter @003f4670, ApplyGravity @003f60b0.
//
// Flow (PlayerMotor.m_mode: 0 ground, 1 jump, 3 attack, 4 attack-bounce):
//   ground --jump press (mode 0, air time <= m_JumpAirTime)--> jump: vy = m_JumpSpeed, gravity m_JumpGravity (m_JumpBoostGravity while the
//     jump button is held for <= m_JumpBoostDur).
//   jump --attack press (a target exists)--> attack: 0.5 s hover (gravity 0, velocity frozen), then dive (gravity 80, horizontal frozen,
//     20 % homing per frame towards the target's predicted body centre).
//   attack --contact (enemy collider / any CharacterController hit)--> attack-bounce: velocity (-forward * BounceH, BounceV), HipAttackEnemyCommand
//     (power 30) when the enemy was >= m_HipAttackMinAttackHeight below the jump start; camera shake + SFX.
//   attack-bounce --grounded after 0.25 s--> ground.
//
// Pure (no three / DOM): the caller feeds it the mover state each frame and applies the returned control to the PlayerMover.

export const PLAYER_JUMP = {
  /** Q4.Player.m_JumpSpeed (+0x40) */
  speed: 7.5,
  /** m_JumpBoostDur (+0x48): the held jump button lowers gravity for this long */
  boostDur: 0.5,
  /** m_JumpBoostGravity (+0x4C) */
  boostGravity: 20,
  /** m_JumpGravity (+0x50) */
  gravity: 25,
  /** m_JumpAirTime (+0x58): CanJump allows a jump while the airborne timer (PlayerMotor +0xA0) is <= this (coyote time) */
  airTime: 0.1,
} as const;

export const HIP_ATTACK = {
  /** m_HipAttackGravity (+0xA4) */
  gravity: 80,
  /** m_HipAttackDelayDur (+0xA8): hover time before the dive */
  delayDur: 0.5,
  /** m_HipAttackMinStartHeight (+0xAC): terrain must be further than this below the player for a target to be offered */
  minStartHeight: 1.5,
  /** m_HipAttackMinAttackHeight (+0xB0): enemy must be at least this far below the jump start to take damage */
  minAttackHeight: 1.0,
  /** m_HipAttackPower (+0xB4): HipAttackEnemyCommand power */
  power: 30,
  /** m_HipAttackBounceH / V (+0xB8 / +0xBC) */
  bounceH: 2.0,
  bounceV: 6.0,
  /** +0xC0 / +0xC1 / +0xC2 (all true in the shipped prefab) */
  aimAssist: true,
  onlyAboveMinStartHeight: true,
  onlyIfTarget: true,
  /** m_HipAttackTargetMaxDist (+0xC4): FindClosestObject radius */
  targetMaxDist: 0.75,
  /** FindEnemyToAttack: centre = position + Vector3.down * DAT_00b7a760 (2.0), cylinder height 2.0 (same constant) */
  targetSearchDown: 2.0,
  targetSearchHeight: 2.0,
  /** UpdateAttackTarget terrain linecast starts DAT_00b7a70c (0.1) above the feet */
  probeUp: 0.1,
  /** TikimanStateAttack.Tick: pos += (predicted + collision.height * DAT_00b7cf04 (0.75) - pos) * DAT_00b7cf08 (0.2) per tick */
  homingHeightScale: 0.75,
  homingRate: 0.2,
  /** WorldCollisionHandler: the bounce state lands only after its timer exceeds DAT_00b7a76c (0.25 s) */
  bounceLandMinTime: 0.25,
  /** HipAttackEnemyCommand drop args from TikimanStateAttackBounce.Enter: 0 coins, 0 gems, value 1 / 1 */
  dropCoins: 0,
  dropGems: 0,
  valuePerCoin: 1,
  valuePerGem: 1,
} as const;

export type V3 = { x: number; y: number; z: number };
export type HipState = 'ground' | 'jump' | 'attack' | 'bounce';

/** A candidate / locked hip-attack victim (a GameCoreEnemy seen through the caller). */
export interface HipTarget {
  handle: unknown;
  pos: V3;
  /** collision cylinder (GameCoreObject.collision) */
  height: number;
}

export interface HipTickInput {
  dt: number;
  pos: V3;
  vy: number;
  /** CharacterController grounded after the previous move */
  grounded: boolean;
  facing: { x: number; z: number };
  moving: boolean;
  /** jump button currently held ("jumpBoost" gesture) */
  holdJump: boolean;
  /** stunned / drowning / respawning / cut-scene: no jump, no target */
  blocked: boolean;
  /** GameCorePlayer.IsHoldingFruit: UpdateAttackTarget offers no target while carrying a fruit */
  holdingFruit: boolean;
  /** Physics.Linecast(pos + up*dyUp, pos - down*dyDown, TerrainMask) hit? */
  groundWithin: (dyUp: number, dyDown: number) => boolean;
  /** AIHelper.FindClosestObject<GameCoreEnemy>(center, radius, height) */
  findTarget: (center: V3, radius: number, height: number) => HipTarget | null;
  /** re-resolve a locked target this frame (null when it died / left) */
  lookup: (handle: unknown) => HipTarget | null;
}

export interface HipControl {
  /** override gravity for the PlayerMover (null = its default) */
  gravity: number | null;
  /** OverrideVel: 'all' = velocity zero, 'horizontal' = (0, vy, 0) */
  freeze: 'none' | 'all' | 'horizontal';
  /** external displacement for this frame (CharacterController.Move extra) */
  external: V3 | null;
  /** set the controller velocity before this frame's move (jump impulse) */
  velocity: Partial<V3> | null;
  /** motor.CanMove() for the locomotion accel path */
  canMove: boolean;
}

export type HipEvent =
  | { type: 'jump'; running: boolean }
  | { type: 'attackStart' }
  | { type: 'pound' }
  | { type: 'bounce'; hit: boolean; target: HipTarget | null; velocity: V3 }
  | { type: 'land'; fromBounce: boolean };

export interface HipAfterMoveInput {
  pos: V3;
  /** CharacterController touched something this frame (collisionFlags != None) */
  contact: boolean;
  /** enemy collider overlapping the player (OnCollisionEnter, EnemiesMask) */
  touching: HipTarget | null;
  facing: { x: number; z: number };
}

export class PlayerHipAttack {
  state: HipState = 'ground';
  /** PlayerMotor.HipAttackEnemy (+0x148): the "!" target while jumping */
  target: HipTarget | null = null;
  /** TikimanStateMachine.JumpStartPos.y */
  jumpStartY = 0;
  private stateTime = 0;
  /** PlayerMotor +0xA0: seconds since the feet last touched ground */
  private airTime = 0;
  private pressed = false;
  private locked: HipTarget | null = null;

  /** true while the dive or its bounce owns the player (enemy-contact bump is not applied) */
  get diving(): boolean { return this.state === 'attack' || this.state === 'bounce'; }
  get airborneAction(): boolean { return this.state !== 'ground'; }

  /** Jump/attack button went down (CommandJump(true) / CommandAttack): handled on the next tick. */
  press(): void { this.pressed = true; }

  /** Bump / respawn / drown replaced the state (BumpPlayer -> TikimanStateBounce, ...). */
  cancel(): void {
    this.state = 'ground';
    this.target = null;
    this.locked = null;
    this.pressed = false;
    this.stateTime = 0;
  }

  tick(i: HipTickInput): { control: HipControl; events: HipEvent[] } {
    const events: HipEvent[] = [];
    const ctl: HipControl = { gravity: null, freeze: 'none', external: null, velocity: null, canMove: true };
    const dt = i.dt;
    const wasPressed = this.pressed;
    this.pressed = false;

    if (i.blocked && this.state !== 'ground') this.cancel();

    // PlayerMotor +0xA0: airborne timer (reset while grounded)
    this.airTime = i.grounded ? 0 : this.airTime + dt;

    // landing (WorldCollisionHandler): grounded and not rising; the bounce needs its timer > 0.25 s
    if (this.state === 'jump' && i.grounded && i.vy <= 0) {
      this.state = 'ground';
      this.target = null;
      events.push({ type: 'land', fromBounce: false });
    } else if (this.state === 'bounce' && i.grounded && i.vy <= 0 && this.stateTime > HIP_ATTACK.bounceLandMinTime) {
      this.state = 'ground';
      this.target = null;
      events.push({ type: 'land', fromBounce: true });
    }
    if (this.state === 'ground' && i.grounded) this.jumpStartY = i.pos.y; // JumpStartPos follows the feet while grounded

    this.stateTime += dt;

    // ---- UpdateAttackTarget: only while the Jump state runs (and not in modes 3..6)
    if (this.state === 'jump') this.target = this.findAttackTarget(i);
    else if (this.state !== 'attack') this.target = null;

    // ---- button
    if (wasPressed && !i.blocked) {
      if (this.state === 'ground' && this.airTime <= PLAYER_JUMP.airTime) {
        // PlayerMotor.Jump -> TikimanStateJump.Enter: CurVelocity.y = speed, JumpStartPos = position
        this.state = 'jump';
        this.stateTime = 0;
        this.jumpStartY = i.pos.y;
        ctl.velocity = { y: PLAYER_JUMP.speed };
        events.push({ type: 'jump', running: i.moving });
      } else if (this.state === 'jump' && this.target !== null) {
        // PlayerMotor.Attack: needs HipAttackEnemy
        this.state = 'attack';
        this.stateTime = 0;
        this.locked = this.target;
        events.push({ type: 'attackStart' });
      }
    }

    // ---- state ticks
    if (this.state === 'jump') {
      // TikimanStateJump.Tick: IsJumpBoost = jump held && elapsed <= m_JumpBoostDur; ApplyGravity uses +0x4C when boosting
      const boost = i.holdJump && this.stateTime <= PLAYER_JUMP.boostDur;
      ctl.gravity = boost ? PLAYER_JUMP.boostGravity : PLAYER_JUMP.gravity;
    } else if (this.state === 'attack') {
      const prev = this.stateTime - dt;
      if (this.stateTime < HIP_ATTACK.delayDur) {
        ctl.gravity = 0; // OverrideGravity 0, OverrideVel zero: hover
        ctl.freeze = 'all';
      } else {
        ctl.gravity = HIP_ATTACK.gravity;
        ctl.freeze = 'horizontal'; // OverrideVel (0, curVel.y, 0)
        if (prev < HIP_ATTACK.delayDur) events.push({ type: 'pound' });
        const t = this.locked !== null ? i.lookup(this.locked.handle) : null;
        if (t !== null) {
          this.locked = t;
          const k = 1 - Math.pow(1 - HIP_ATTACK.homingRate, dt * 60); // the original adds 20 % once per (60 Hz) tick
          ctl.external = {
            x: (t.pos.x - i.pos.x) * k,
            y: (t.pos.y + t.height * HIP_ATTACK.homingHeightScale - i.pos.y) * k,
            z: (t.pos.z - i.pos.z) * k,
          };
        }
      }
    } else if (this.state === 'bounce') {
      ctl.canMove = false; // TikimanStateAttackBounce animations carry the DisableMovement tag
    }
    return { control: ctl, events };
  }

  /** After the mover moved: the dive ends on enemy contact or any controller hit (OnCollisionEnter / WorldCollisionHandler -> AttackLogic). */
  afterMove(i: HipAfterMoveInput): HipEvent[] {
    if (this.state !== 'attack') return [];
    if (i.touching === null && !i.contact) return [];
    const enemy = i.touching;
    // AttackLogic: with an enemy, damage only when jumpStart.y - enemy.y >= MinAttackHeight; without one: straight up
    const hit = enemy !== null && this.jumpStartY - enemy.pos.y >= HIP_ATTACK.minAttackHeight;
    let vx = 0, vz = 0;
    if (enemy !== null) {
      const l = Math.hypot(i.facing.x, i.facing.z) || 1;
      vx = -(i.facing.x / l) * HIP_ATTACK.bounceH; // forward * -BounceH
      vz = -(i.facing.z / l) * HIP_ATTACK.bounceH;
    }
    this.state = 'bounce';
    this.stateTime = 0;
    this.target = null;
    this.locked = null;
    return [{ type: 'bounce', hit, target: hit ? enemy : null, velocity: { x: vx, y: HIP_ATTACK.bounceV, z: vz } }];
  }

  /** UpdateAttackTarget (+ FindEnemyToAttack). */
  private findAttackTarget(i: HipTickInput): HipTarget | null {
    if (i.blocked || i.holdingFruit) return null;
    if (HIP_ATTACK.onlyAboveMinStartHeight) {
      // terrain closer than MinStartHeight below the feet: too low to start an attack
      if (i.groundWithin(HIP_ATTACK.probeUp, HIP_ATTACK.minStartHeight)) return null;
    } else if (i.pos.y - this.jumpStartY < HIP_ATTACK.minStartHeight) {
      return null;
    }
    if (!HIP_ATTACK.onlyIfTarget && !HIP_ATTACK.aimAssist) return null;
    return i.findTarget({ x: i.pos.x, y: i.pos.y - HIP_ATTACK.targetSearchDown, z: i.pos.z }, HIP_ATTACK.targetMaxDist, HIP_ATTACK.targetSearchHeight);
  }
}
