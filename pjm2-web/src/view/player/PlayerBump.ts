// src/view/player/PlayerBump.ts
// Enemy contact -> player bump (Q4.PlayerMotor.OnTriggerEnter/Stay -> BumpEnemyLogic @0x3F4AF0 -> BumpPlayer @0x3F4E20).
//
//   BumpEnemyLogic(enemyHandle, hitPos, motor, enemy): only when the motor's invulnerability timer (+0xA4) is <= 0 and the motor is not in
//   TikimanStateSlideDownSlope; then BumpPlayer(hitPos = enemy position, forceScale, motor, looseCoins = true).
//   BumpPlayer: state = 5 (bounced); invulnerability = max(invulnerability, Player.EnemyBounceInvulnerabilityDur);
//     dir = normalize(player.pos - hitPos); velocity = (dir.x * EnemyBounceH, EnemyBounceV, dir.z * EnemyBounceH) * forceScale;
//     TikimanStateBounce(velocity, stunned = EnemyBounceStunDur, recover presses = EnemyStunRecoverPresses, ...) becomes the state;
//     a HipAttackEnemyCommand (power 0) arms the loose-currency spill (EnemyBounceDropCoins/Gems x value) via AddPlayerCommand; DropFruit.
//   Serialized Player values (globalsettings, Player MB): EnemyBounceH 2.0, EnemyBounceV 6.0, EnemyBounceInvulnerabilityDur 2.0,
//   EnemyBounceDropCoins 2 (x5), EnemyBounceDropGems 0 (x1), EnemyBounceStunDur 3.5, EnemyStunRecoverPresses 5.

export const PLAYER_BUMP = {
  bounceH: 2.0,
  bounceV: 6.0,
  invulnerabilityDur: 2.0,
  dropCoins: 2,
  dropGems: 0,
  valuePerCoin: 5,
  valuePerGem: 1,
  stunDur: 3.5,
  stunRecoverPresses: 5,
  /** DAT_00b7a77c passed to BumpPlayer by BumpEnemyLogic: not recoverable here, neutral 1.0 */
  forceScale: 1.0,
} as const;

export interface V3 { x: number; y: number; z: number }

export interface BumpResult {
  /** new velocity for the player controller (Unity space) */
  velocity: V3;
  /** loose-currency spill to arm (HipAttackEnemyCommand with power 0) */
  drop: { coins: number; gems: number; valuePerCoin: number; valuePerGem: number };
}

export class PlayerBump {
  /** m_invulnerability (+0xA4), seconds */
  invulnerable = 0;
  /** remaining stun, seconds (TikimanStateBounce stunned phase) */
  stun = 0;
  private presses = 0;

  get stunned(): boolean { return this.stun > 0; }
  get canBeBumped(): boolean { return this.invulnerable <= 0 && this.stun <= 0; }

  tick(dt: number): void {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);
  }

  /** A button press while stunned (EnemyStunRecoverPresses presses end the stun early). */
  press(): void {
    if (this.stun <= 0) return;
    this.presses++;
    if (this.presses >= PLAYER_BUMP.stunRecoverPresses) { this.stun = 0; this.presses = 0; }
  }

  /** Horizontal capsule vs enemy collision-cylinder overlap (the trigger volumes of the original). */
  static touching(player: V3, playerRadius: number, playerHeight: number,
                  enemy: V3, enemyRadius: number, enemyHeight: number): boolean {
    const d = Math.hypot(enemy.x - player.x, enemy.z - player.z);
    if (d > playerRadius + enemyRadius) return false;
    return enemy.y < player.y + playerHeight && enemy.y + enemyHeight > player.y;
  }

  /** BumpEnemyLogic + BumpPlayer. Returns null when the bump is ignored (invulnerable / already stunned). */
  bump(player: V3, hitPos: V3): BumpResult | null {
    if (!this.canBeBumped) return null;
    this.invulnerable = Math.max(this.invulnerable, PLAYER_BUMP.invulnerabilityDur);
    this.stun = PLAYER_BUMP.stunDur;
    this.presses = 0;
    let dx = player.x - hitPos.x, dz = player.z - hitPos.z;
    const l = Math.hypot(dx, dz);
    if (l > 1e-5) { dx /= l; dz /= l; } else { dx = 0; dz = 1; }
    const k = PLAYER_BUMP.forceScale;
    return {
      velocity: { x: dx * PLAYER_BUMP.bounceH * k, y: PLAYER_BUMP.bounceV * k, z: dz * PLAYER_BUMP.bounceH * k },
      drop: { coins: PLAYER_BUMP.dropCoins, gems: PLAYER_BUMP.dropGems, valuePerCoin: PLAYER_BUMP.valuePerCoin, valuePerGem: PLAYER_BUMP.valuePerGem },
    };
  }
}
