import { describe, expect, it } from 'vitest';
import { PLAYER_BUMP, PlayerBump } from '../../src/view/player/PlayerBump';

describe('PlayerBump (enemy contact)', () => {
  it('knocks the player away from the enemy with H 2 / V 6, drops 2 coins worth 5, invulnerable 2 s, stunned 3.5 s', () => {
    const b = new PlayerBump();
    const r = b.bump({ x: 3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })!;
    expect(r.velocity).toEqual({ x: PLAYER_BUMP.bounceH, y: PLAYER_BUMP.bounceV, z: 0 });
    expect(r.drop).toEqual({ coins: 2, gems: 0, valuePerCoin: 5, valuePerGem: 1 });
    expect(b.invulnerable).toBe(2);
    expect(b.stun).toBe(3.5);
    expect(b.stunned).toBe(true);
  });

  it('ignores contact while invulnerable or stunned; stun ends by time or by 5 presses; invulnerability by time', () => {
    const b = new PlayerBump();
    const P = { x: 0, y: 0, z: 0 }, E = { x: 1, y: 0, z: 0 };
    expect(b.bump(P, E)).not.toBeNull();
    expect(b.bump(P, E)).toBeNull();
    for (let i = 0; i < 4; i++) b.press();
    expect(b.stunned).toBe(true);
    b.press(); // 5th press recovers
    expect(b.stunned).toBe(false);
    expect(b.bump(P, E)).toBeNull(); // still invulnerable (2 s)
    b.tick(2.01);
    expect(b.canBeBumped).toBe(true);
    expect(b.bump(P, E)).not.toBeNull();
    b.tick(3.6);
    expect(b.stunned).toBe(false); // timed out without presses
  });

  it('contact test = horizontal radius sum + vertical overlap', () => {
    const P = { x: 0, y: 0, z: 0 };
    expect(PlayerBump.touching(P, 0.15, 0.75, { x: 0.4, y: 0, z: 0 }, 0.3, 0.5)).toBe(true);
    expect(PlayerBump.touching(P, 0.15, 0.75, { x: 0.5, y: 0, z: 0 }, 0.3, 0.5)).toBe(false);
    expect(PlayerBump.touching(P, 0.15, 0.75, { x: 0.2, y: 2, z: 0 }, 0.3, 0.5)).toBe(false); // flying above
  });
});
