// tests/view/homeChibiSolver.test.ts — Q4.Home.ChibiCollisions port (HomeChibiSolver).
import { describe, it, expect } from 'vitest';
import {
  HomeChibiSolver, HOME_001_CONFIG, HOME_SOLVER_CONST, type SolverChibi, type SimChibiLookup,
} from '../../src/view/characters/HomeChibiSolver';

const HOME = { x: 10, y: 0, z: 5 };
const mk = (): HomeChibiSolver => new HomeChibiSolver({ homePos: HOME, ...HOME_001_CONFIG });
const chibi = (id: number, x: number, z: number): SolverChibi => ({
  chibiId: id, pos: { x, y: 0, z }, yawDeg: 0, destPos: { x, y: 0, z }, destYawDeg: 0,
  isScared: false, isPlayerClose: false, playerPos: { x: 0, y: 0, z: 0 },
});
/** Sim: every chibi belongs at (home + ring point). */
const simAt = (pts: Record<number, [number, number]>, yaw = 30): SimChibiLookup => (id) =>
  pts[id] === undefined ? null : { pos: { x: pts[id][0], y: 0, z: pts[id][1] }, yawDeg: yaw };
const distHome = (c: SolverChibi): number => Math.hypot(c.destPos.x - HOME.x, c.destPos.z - HOME.z);

describe('HomeChibiSolver', () => {
  it('settled chibi at its home spot: DestPos == home spot, DestRot == sim yaw, no player', () => {
    const s = mk();
    const c = chibi(1, 12.2, 5);
    s.update(1 / 60, [c], [], false, simAt({ 1: [12.2, 5] }, 77));
    expect(c.destPos.x).toBeCloseTo(12.2, 4);
    expect(c.destPos.z).toBeCloseTo(5, 4);
    expect(c.destYawDeg).toBe(77);
    expect(c.isPlayerClose).toBe(false);
    expect(c.isScared).toBe(false);
    expect(c.playerPos.x).toBe(HOME_SOLVER_CONST.NO_PLAYER);
  });

  it('IsScared mirrors GameCoreHome.IsEnemyClose', () => {
    const s = mk();
    const c = chibi(1, 12.2, 5);
    s.update(1 / 60, [c], [], true, simAt({ 1: [12.2, 5] }));
    expect(c.isScared).toBe(true);
  });

  it('pulls toward homePos by 0.05 per pass (max 3 passes)', () => {
    const s = mk();
    const c = chibi(1, 12.3, 5); // 2.3 from hut centre; home spot at (12.3, 7.5)? use far spot on same ring side
    s.update(1 / 60, [c], [], false, simAt({ 1: [12.3, 5.4] })); // 0.4 away in z, outside hut r=2 → free
    // 3 passes x 0.05 toward +z
    expect(c.destPos.z).toBeCloseTo(5.15, 3);
    expect(c.destPos.x).toBeCloseTo(12.3, 3);
  });

  it('hut cylinder (r = playerDetectionRange 2.0) pushes a chibi out to its surface', () => {
    const s = mk();
    const c = chibi(1, 10.5, 5); // 0.5 from centre, home spot also inside → pushed to r=2 each pass
    s.update(1 / 60, [c], [], false, simAt({ 1: [10.5, 5] }));
    expect(distHome(c)).toBeGreaterThanOrEqual(2.0 - 1e-4);
    expect(distHome(c)).toBeLessThan(2.1);
  });

  it('keep-inside ring (ChibiMaxDistFromHome 2.45) pulls a far chibi back in', () => {
    const s = mk();
    const c = chibi(1, 14, 5); // 4 from centre; sim spot is far too (so the pull-to-home doesn't matter)
    s.update(1 / 60, [c], [], false, simAt({ 1: [14, 5] }));
    expect(distHome(c)).toBeCloseTo(2.45, 3);
  });

  it('collider order: hut, keep-inside, then players (list shape)', () => {
    const s = mk();
    s.update(1 / 60, [chibi(1, 12.2, 5)], [{ x: 11, y: 0, z: 6 }], false, simAt({ 1: [12.2, 5] }));
    expect(s.lastColliders.map((c) => c.type)).toEqual([1, 0x8001, 0]);
    expect(s.lastColliders[0].radius).toBe(2.0);
    expect(s.lastColliders[1].radius).toBeCloseTo(2.45, 5);
    expect(s.lastColliders[2].radius).toBeCloseTo(0.4, 5);
  });

  it('player scatter: a nearby player pushes the chibi out of r=PlayerColSize and sets PlayerPos / IsPlayerClose', () => {
    const s = mk();
    const c = chibi(1, 12.2, 5);
    const player = { x: 12.4, y: 0, z: 5 }; // 0.2 from the chibi
    s.update(1 / 60, [c], [player], false, simAt({ 1: [12.2, 5] }));
    expect(c.playerPos).toEqual(player);
    // pushed away from the player (−x) to the 0.4 surface, then pulled back 0.05/pass → ends within ~0.45 of the player
    expect(c.destPos.x).toBeLessThan(12.2);
    expect(Math.hypot(c.destPos.x - player.x, c.destPos.z - player.z)).toBeLessThan(0.5);
    expect(c.isPlayerClose).toBe(true);
  });

  it('a far player does not trigger IsPlayerClose', () => {
    const s = mk();
    const c = chibi(1, 12.2, 5);
    s.update(1 / 60, [c], [{ x: 20, y: 0, z: 5 }], false, simAt({ 1: [12.2, 5] }));
    expect(c.isPlayerClose).toBe(false);
    expect(c.playerPos.x).toBe(HOME_SOLVER_CONST.NO_PLAYER);
  });

  it('chibi-chibi spacing: overlapping chibis are separated toward 2*ChibiColSize (0.4)', () => {
    const s = mk();
    const a = chibi(1, 12.2, 5);
    const b = chibi(2, 12.2, 5.1); // 0.1 apart, same sim spot
    s.update(1 / 60, [a, b], [], false, simAt({ 1: [12.2, 5], 2: [12.2, 5] }));
    const d = Math.hypot(a.destPos.x - b.destPos.x, a.destPos.z - b.destPos.z);
    expect(d).toBeGreaterThan(0.1);
    // later chibi's list has the earlier one (only j < i are neighbours); the push is symmetric
    expect(a.destPos.z).toBeLessThan(5.0 + 1e-6);
  });

  it('chibis farther apart than 4*ChibiColSize are not neighbours', () => {
    const s = mk();
    const a = chibi(1, 12.2, 5);
    const b = chibi(2, 12.2, 6.0);
    s.update(1 / 60, [a, b], [], false, simAt({ 1: [12.2, 5], 2: [12.2, 6.0] }));
    expect(a.destPos.z).toBeCloseTo(5, 4);
    expect(b.destPos.z).toBeCloseTo(6, 4);
  });

  it('avoidance zone: scares everyone inside, snaps chibis 0/1 to their home spot, pushes chibis >= 2 away from the zone', () => {
    const s = mk();
    s.addAvoidanceZone({ x: 12.2, y: 0, z: 5 }, 1.0, 99);
    const cs = [chibi(10, 12.2, 5.9), chibi(11, 12.2, 4.1), chibi(12, 12.3, 5.0)];
    // chibi 12's sim spot is far from the zone centre → the zone push (0.25 * |home - zone|) is substantial
    const sim = simAt({ 10: [12.2, 5.9], 11: [12.2, 4.1], 12: [12.3, 5.0] });
    s.update(0.01, cs, [], false, sim);
    expect(s.activeZones).toBe(1);
    expect(cs.every((c) => c.isScared)).toBe(true);
    // first two: snapped to homePos each pass (the later passes only add the 0.05 pull / no-op)
    expect(Math.abs(cs[0].destPos.z - 5.9)).toBeLessThan(0.1);
    expect(Math.abs(cs[1].destPos.z - 4.1)).toBeLessThan(0.1);
  });

  it('avoidance zone push on index >= 2 = normalized(offset) * 0.25 * |homePos - zone.pos|', () => {
    const s = mk();
    s.addAvoidanceZone({ x: 11.6, y: 0, z: 5 }, 1.0);
    // chibis 0 and 1 far away (outside the zone), chibi 2 inside the zone at x=12.2, home spot (12.2, 5) → len = 0.6
    const cs = [chibi(1, 10.0, 7.4), chibi(2, 10.0, 2.6), chibi(3, 12.2, 5)];
    s.update(0.01, cs, [], false, simAt({ 1: [10.0, 7.4], 2: [10.0, 2.6], 3: [12.2, 5] }));
    expect(cs[2].isScared).toBe(true);
    expect(cs[0].isScared).toBe(false);
    // 3 passes: +0.15 (0.25 * 0.6) away from the zone in +x each time it is inside (zone r = 1.0, offset 0.6 → inside)
    expect(cs[2].destPos.x).toBeGreaterThan(12.2 + 0.05);
  });

  it('avoidance zone expires after 0.75 s of updates', () => {
    const s = mk();
    s.addAvoidanceZone({ x: 12.2, y: 0, z: 5 }, 1.0, 5);
    const c = chibi(1, 12.2, 5);
    const sim = simAt({ 1: [12.2, 5] });
    for (let t = 0; t < 0.7; t += 0.1) s.update(0.1, [c], [], false, sim);
    expect(s.activeZones).toBe(1);
    s.update(0.1, [c], [], false, sim); // 0.75 - 0.8 < 0 → removed
    expect(s.activeZones).toBe(0);
    c.isScared = false;
    s.update(0.1, [c], [], false, sim);
    expect(c.isScared).toBe(false);
  });

  it('a chibi missing from the sim stays where it is (homePos = its own position, homeRot = its own yaw)', () => {
    const s = mk();
    const c = chibi(9, 12.2, 5);
    c.yawDeg = 123;
    s.update(1 / 60, [c], [], false, simAt({}));
    expect(c.destPos.x).toBeCloseTo(12.2, 4);
    expect(c.destYawDeg).toBe(123);
  });

  it('playerQuery = Cylinder(MaxDist * 1.5, 2.0) at the hut', () => {
    const q = mk().playerQuery();
    expect(q.radius).toBeCloseTo(2.31 * 1.5, 4);
    expect(q.height).toBe(2.0);
    expect(q.center).toEqual(HOME);
  });
});
