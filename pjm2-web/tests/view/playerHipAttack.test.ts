import { describe, expect, it } from 'vitest';
import { HIP_ATTACK, PLAYER_JUMP, PlayerHipAttack, type HipTarget, type HipTickInput } from '../../src/view/player/PlayerHipAttack';

const enemy: HipTarget = { handle: { m_handle: 7 }, pos: { x: 0, y: 0, z: 0 }, height: 0.8 };

function input(over: Partial<HipTickInput> = {}): HipTickInput {
  return {
    dt: 1 / 60, pos: { x: 0, y: 0, z: 0 }, vy: 0, grounded: true, facing: { x: 0, z: 1 }, moving: false, holdJump: false,
    blocked: false, holdingFruit: false, groundWithin: () => false, findTarget: () => null, lookup: () => null, ...over,
  };
}

describe('PlayerHipAttack (PlayerMotor.Jump / Attack, TikimanStateJump / Attack / AttackBounce)', () => {
  it('jump press on the ground sets vy = m_JumpSpeed and emits a jump event (idle / running variants)', () => {
    const h = new PlayerHipAttack();
    h.press();
    const r = h.tick(input());
    expect(r.control.velocity).toEqual({ y: PLAYER_JUMP.speed });
    expect(r.events).toEqual([{ type: 'jump', running: false }]);
    expect(h.state).toBe('jump');
    const h2 = new PlayerHipAttack();
    h2.press();
    expect(h2.tick(input({ moving: true })).events).toEqual([{ type: 'jump', running: true }]);
  });

  it('CanJump: a ledge walk-off still jumps within m_JumpAirTime (0.1 s), not after', () => {
    const h = new PlayerHipAttack();
    for (let i = 0; i < 4; i++) h.tick(input({ grounded: false })); // 4/60 s airborne
    h.press();
    expect(h.tick(input({ grounded: false })).events.map((e) => e.type)).toEqual(['jump']);
    const g = new PlayerHipAttack();
    for (let i = 0; i < 10; i++) g.tick(input({ grounded: false })); // 10/60 s > 0.1
    g.press();
    expect(g.tick(input({ grounded: false })).events).toEqual([]);
    expect(g.state).toBe('ground');
  });

  it('no jump while blocked (stunned / drowning) and none in the air', () => {
    const h = new PlayerHipAttack();
    h.press();
    expect(h.tick(input({ blocked: true })).events).toEqual([]);
    const j = new PlayerHipAttack();
    j.press(); j.tick(input());
    j.press();
    expect(j.tick(input({ grounded: false, vy: 3 })).events).toEqual([]); // second press with no target does nothing
  });

  it('holding the button lowers gravity to m_JumpBoostGravity for m_JumpBoostDur', () => {
    const h = new PlayerHipAttack();
    h.press(); h.tick(input());
    expect(h.tick(input({ grounded: false, vy: 7, holdJump: true })).control.gravity).toBe(PLAYER_JUMP.boostGravity);
    expect(h.tick(input({ grounded: false, vy: 7, holdJump: false })).control.gravity).toBe(PLAYER_JUMP.gravity);
    for (let i = 0; i < 40; i++) h.tick(input({ grounded: false, vy: 1, holdJump: true })); // > 0.5 s
    expect(h.tick(input({ grounded: false, vy: -1, holdJump: true })).control.gravity).toBe(PLAYER_JUMP.gravity);
  });

  it('landing returns to ground only when not rising', () => {
    const h = new PlayerHipAttack();
    h.press(); h.tick(input());
    expect(h.tick(input({ grounded: true, vy: 5 })).events).toEqual([]);
    expect(h.tick(input({ grounded: true, vy: -1 })).events).toEqual([{ type: 'land', fromBounce: false }]);
    expect(h.state).toBe('ground');
  });

  const airborne = (h: PlayerHipAttack, extra: Partial<HipTickInput> = {}) =>
    h.tick(input({ grounded: false, vy: -1, pos: { x: 0, y: 3, z: 0 }, findTarget: () => enemy, ...extra }));

  it('target needs clear space below (terrain within m_HipAttackMinStartHeight blocks it) and an enemy in the 0.75 x 2 cylinder under the player', () => {
    const h = new PlayerHipAttack();
    h.press(); h.tick(input());
    airborne(h, { groundWithin: () => true });
    expect(h.target).toBeNull();
    const calls: unknown[] = [];
    airborne(h, { findTarget: (c, r, hh) => { calls.push([c, r, hh]); return enemy; } });
    expect(h.target).toBe(enemy);
    expect(calls[0]).toEqual([{ x: 0, y: 3 - HIP_ATTACK.targetSearchDown, z: 0 }, HIP_ATTACK.targetMaxDist, HIP_ATTACK.targetSearchHeight]);
    airborne(h, { holdingFruit: true });
    expect(h.target).toBeNull();
  });

  it('attack: hover 0.5 s (gravity 0, velocity frozen), then one pound event and dive (gravity 80, 20 % homing)', () => {
    const h = new PlayerHipAttack();
    h.press(); h.tick(input());
    airborne(h);
    h.press();
    const start = airborne(h);
    expect(start.events).toEqual([{ type: 'attackStart' }]);
    expect(start.control).toMatchObject({ gravity: 0, freeze: 'all' });
    let pounds = 0;
    let last = start;
    for (let i = 0; i < 40; i++) {
      last = airborne(h, { lookup: () => ({ ...enemy, pos: { x: 1, y: 0, z: 0 } }) });
      pounds += last.events.filter((e) => e.type === 'pound').length;
    }
    expect(pounds).toBe(1);
    expect(last.control.gravity).toBe(HIP_ATTACK.gravity);
    expect(last.control.freeze).toBe('horizontal');
    const k = 1 - 0.8 ** 1; // one 60 Hz tick
    expect(last.control.external!.x).toBeCloseTo(1 * k, 6);
    expect(last.control.external!.y).toBeCloseTo((0 + 0.8 * 0.75 - 3) * k, 6);
    expect(h.diving).toBe(true);
  });

  function diving(jumpY = 3): PlayerHipAttack {
    const h = new PlayerHipAttack();
    h.press(); h.tick(input({ pos: { x: 0, y: jumpY, z: 0 } }));
    airborne(h);
    h.press(); airborne(h);
    return h;
  }

  it('contact with an enemy far enough below the jump start: damage + bounce backwards (-forward * BounceH, BounceV)', () => {
    const h = diving();
    const ev = h.afterMove({ pos: { x: 0, y: 0.5, z: 0 }, contact: true, touching: enemy, facing: { x: 0, z: 1 } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'bounce', hit: true, target: enemy });
    const v = (ev[0] as { velocity: { x: number; y: number; z: number } }).velocity;
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBe(HIP_ATTACK.bounceV);
    expect(v.z).toBeCloseTo(-HIP_ATTACK.bounceH, 9);
    expect(h.state).toBe('bounce');
  });

  it('enemy less than m_HipAttackMinAttackHeight below the jump start: bounce without damage', () => {
    const h = diving(0.5);
    const ev = h.afterMove({ pos: { x: 0, y: 0.5, z: 0 }, contact: false, touching: { ...enemy, pos: { x: 0, y: 0, z: 0 } }, facing: { x: 1, z: 0 } });
    expect(ev[0]).toMatchObject({ type: 'bounce', hit: false, target: null });
  });

  it('hitting plain ground ends the dive with a straight-up bounce (AttackLogic with no enemy)', () => {
    const h = diving();
    const ev = h.afterMove({ pos: { x: 0, y: 0, z: 0 }, contact: true, touching: null, facing: { x: 0, z: 1 } });
    expect(ev[0]).toMatchObject({ type: 'bounce', hit: false, velocity: { x: 0, y: HIP_ATTACK.bounceV, z: 0 } });
    expect(h.afterMove({ pos: { x: 0, y: 0, z: 0 }, contact: true, touching: null, facing: { x: 0, z: 1 } })).toEqual([]); // only while attacking
  });

  it('no contact, no bounce; the bounce lands only after 0.25 s grounded and not rising', () => {
    const h = diving();
    expect(h.afterMove({ pos: { x: 0, y: 2, z: 0 }, contact: false, touching: null, facing: { x: 0, z: 1 } })).toEqual([]);
    h.afterMove({ pos: { x: 0, y: 0, z: 0 }, contact: true, touching: null, facing: { x: 0, z: 1 } });
    expect(h.tick(input({ grounded: true, vy: -1 })).events).toEqual([]); // < 0.25 s
    let landed: unknown[] = [];
    for (let i = 0; i < 20; i++) landed = h.tick(input({ grounded: true, vy: -1 })).events;
    expect(landed.length + (h.state === 'ground' ? 1 : 0)).toBeGreaterThan(0);
    expect(h.state).toBe('ground');
  });

  it('being blocked (bump / stun) cancels the attack; bounce state disables locomotion', () => {
    const h = diving();
    h.tick(input({ blocked: true, grounded: false }));
    expect(h.state).toBe('ground');
    const b = diving();
    b.afterMove({ pos: { x: 0, y: 0, z: 0 }, contact: true, touching: null, facing: { x: 0, z: 1 } });
    expect(b.tick(input({ grounded: false, vy: 3 })).control.canMove).toBe(false);
  });
});
