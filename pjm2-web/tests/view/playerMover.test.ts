/**
 * PlayerMover — original CharacterController-style locomotion on the REAL
 * stage-001 static colliders (public/assets/stages/3d_stage_001/physics).
 * Evidence for every constant: docs/PLAYER_BOUNDS_ANALYSIS.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { createQueries, loadStageWorld, type PhysicsWorld } from '../../src/engine/physics/index.js';
import type { PhysicsQueries } from '../../src/engine/physics/index.js';
import {
  evalCurve,
  PLAYER_CC,
  PLAYER_COLLISION_MASK,
  PlayerMover,
} from '../../src/view/player/PlayerMover.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = resolve(HERE, '..', '..', 'public', 'assets', 'stages', '3d_stage_001');
const COLLIDERS = join(STAGE_DIR, 'physics', '3d_stage_001_colliders.json');

type V3 = [number, number, number];
let pw: PhysicsWorld;
let q: PhysicsQueries;
let respawnPoints: V3[] = [];

beforeAll(async () => {
  pw = await loadStageWorld(COLLIDERS);
  q = createQueries(pw);
  const scene = JSON.parse(readFileSync(join(STAGE_DIR, 'scene.json'), 'utf8')) as {
    nodes: { name: string; activeSelf: boolean; pos: V3 }[];
  };
  // RespawnPoints parent chain is identity in stage 001 (verified in the analysis doc)
  respawnPoints = scene.nodes
    .filter((n) => n.activeSelf && /^RespawnPoint( \(\d+\))?$/.test(n.name))
    .map((n) => n.pos);
}, 120_000);

function spawn(x: number, z: number, mover?: PlayerMover): PlayerMover {
  const m = mover ?? new PlayerMover(pw, respawnPoints);
  m.teleport(x, q.groundHeight(x, z) + 0.05, z);
  return m;
}

function run(m: PlayerMover, seconds: number, dx: number, dz: number, stopOnMode = true): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    m.update(1 / 60, { x: dx, z: dz });
    if (stopOnMode && m.mode !== 'normal') return;
  }
}

describe('collision data (decomp-derived)', () => {
  it('Players-layer mask = matrix row 8: terrain/player-area/props/trees yes, water/enemies no', () => {
    const has = (layer: number): boolean => (PLAYER_COLLISION_MASK & (1 << layer)) !== 0;
    for (const l of [26, 29, 30, 31, 16, 12, 19, 22]) expect(has(l), `layer ${l}`).toBe(true);
    for (const l of [0, 4, 8, 9, 13, 21, 27]) expect(has(l), `layer ${l}`).toBe(false);
  });

  it('CharacterController constants from the tikiman_01 prefab', () => {
    expect(PLAYER_CC.radius).toBeCloseTo(0.15, 6);
    expect(PLAYER_CC.height).toBe(0.75);
    expect(PLAYER_CC.stepOffset).toBeCloseTo(0.4, 6);
    expect(PLAYER_CC.slopeLimitDeg).toBeCloseTo(52.2, 4);
    expect(PLAYER_CC.skinWidth).toBeCloseTo(0.02, 6);
  });

  it('respawn height/time curves evaluate like Unity Hermite curves', () => {
    const keys = [
      { time: 0, value: 0, inSlope: 2.330434560775757, outSlope: 2.330434560775757 },
      { time: 1, value: 1, inSlope: 0.9019255042076111, outSlope: 0.9019255042076111 },
    ];
    expect(evalCurve(keys, 0)).toBe(0);
    expect(evalCurve(keys, 1)).toBe(1);
    expect(evalCurve(keys, -1)).toBe(0);
    expect(evalCurve(keys, 2)).toBe(1);
    expect(evalCurve(keys, 0.5)).toBeGreaterThan(0.5);
  });
});

describe('PlayerMover on the real stage-001 colliders', () => {
  it('settles onto the terrain (grounded, feet on the surface)', () => {
    const m = spawn(3, 3);
    m.y += 0.4; // drop from 0.45 above
    run(m, 1, 0, 0);
    expect(m.groundedCC).toBe(true);
    expect(m.grounded).toBe(true);
    expect(Math.abs(m.y - q.groundHeight(3, 3))).toBeLessThan(0.06);
  });

  it('accelerates at 12 u/s^2 to the walk speed 3.5343 and brakes at 16 u/s^2', () => {
    const m = spawn(3, 3);
    run(m, 0.5, 0, 0);
    // walk -z from (3,3): open, flat ground for >1.5 units
    for (let i = 0; i < 6; i++) m.update(1 / 60, { x: 0, z: 1 });
    // after 6 fixed steps: v = 12 * 6/60 = 1.2
    expect(Math.hypot(m.vx, m.vz)).toBeCloseTo(1.2, 1);
    for (let i = 0; i < 30; i++) m.update(1 / 60, { x: 0, z: 1 });
    expect(Math.hypot(m.vx, m.vz)).toBeCloseTo(3.5343, 1); // x slope speed scale
    for (let i = 0; i < 6; i++) m.update(1 / 60, { x: 0, z: 0 });
    expect(Math.hypot(m.vx, m.vz)).toBeCloseTo(3.5343 - 16 * 0.1, 1);
  });

  it('is deterministic (same inputs -> identical trajectory)', () => {
    const a = spawn(3, 3);
    const b = spawn(3, 3);
    for (let i = 0; i < 300; i++) {
      const inp = { x: Math.sin(i / 20), z: Math.cos(i / 31) };
      a.update(1 / 60, inp);
      b.update(1 / 60, inp);
    }
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
  });

  it('a steep rock face blocks (no climbing past the slope limit)', () => {
    // terrain at z=1.5 rises from y=0 at x=4.0 to y=1.5 at x=5.0 (normal.y 0.31..0.6)
    const m = spawn(3, 1.5);
    run(m, 6, 1, 0);
    expect(m.x).toBeLessThan(4.45);
    expect(m.y).toBeLessThan(0.6);
    expect(m.mode).toBe('normal');
  });

  it('slides along a wall instead of stopping dead', () => {
    const m = spawn(3, 3);
    run(m, 1.2, 0.8, -0.6); // into the same rock face at an angle
    expect(m.x).toBeLessThan(4.45);
    expect(m.z).toBeLessThan(1.0); // z kept decreasing (slide) while x was blocked
  });

  it('terrain y is tracked while walking uphill/downhill (stays grounded)', () => {
    const m = spawn(3, 3);
    let off = 0;
    let n = 0;
    for (let i = 0; i < 60 * 5; i++) {
      m.update(1 / 60, { x: 0, z: 1 });
      if (m.mode !== 'normal') break;
      if (i > 30) {
        n++;
        if (!m.groundedCC || Math.abs(m.y - q.groundHeight(m.x, m.z)) > 0.15) off++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(off / n).toBeLessThan(0.05);
  });

  it('a tree "collision" capsule (layer 16) blocks the player', () => {
    // capsule at (2.716, y, 3.922), radius 0.125 * 1.0025; approach from -x side
    const cx = 2.7160000801086426, cz = 3.921999931335449;
    const m = spawn(cx - 1.5, cz + 0.02);
    let minD = Infinity;
    for (let i = 0; i < 60 * 3; i++) {
      m.update(1 / 60, { x: 1, z: 0 });
      minD = Math.min(minD, Math.hypot(m.x - cx, m.z - cz));
    }
    // never closer than trunk radius + player radius (minus numerical slack)
    expect(minD).toBeGreaterThan(0.125 + PLAYER_CC.radius - 0.02);
    // it was actually stopped/deflected by the trunk, not walking free through x=cx
    expect(minD).toBeLessThan(0.125 + PLAYER_CC.radius + 0.1);
  });

  it('the home hut sphere (r 1.73 at the origin, layer 29) blocks the player', () => {
    const m = spawn(0.2, -3.6);
    run(m, 6, 0, 1);
    expect(Math.hypot(m.x, m.z)).toBeGreaterThan(1.7);
    expect(m.y).toBeLessThan(0.45);
  });

  it('the invisible player_col wall (layer 26) keeps the player inside the map', () => {
    // terrain_001_player_col spans x[-25.5,28.5] z[-28.5,28.7]
    const starts: V3[] = [[3, 3, 0], [5, -4, 0], [-3, 6, 0], [8, 12, 0], [-2, -10, 0]];
    let tested = 0;
    for (const [sx, sz] of starts) {
      for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const m = spawn(sx, sz);
        if (m.overlapsNow()) continue;
        const dx = Math.cos((a * Math.PI) / 180), dz = Math.sin((a * Math.PI) / 180);
        run(m, 12, dx, dz);
        tested++;
        if (m.mode === 'normal') {
          expect(m.x, `${sx},${sz}@${a}`).toBeGreaterThan(-26.5);
          expect(m.x).toBeLessThan(29.5);
          expect(m.z).toBeGreaterThan(-29.5);
          expect(m.z).toBeLessThan(29.7);
          expect(m.y).toBeGreaterThan(-6);
        }
      }
    }
    expect(tested).toBeGreaterThan(20);
  }, 120_000);

  it('the river is NOT a wall: the player wades in, drowns at depth >= 0.6, then respawns', () => {
    const m = spawn(3, 3);
    let sawDepth = 0;
    for (let i = 0; i < 60 * 12 && m.mode === 'normal'; i++) {
      m.update(1 / 60, { x: -1, z: 0 });
      sawDepth = Math.max(sawDepth, m.waterDepth);
    }
    expect(m.mode).toBe('drowning');
    expect(sawDepth).toBeGreaterThanOrEqual(0.6);
    const lastGround = [...m.lastGround];
    // 5 s drown delay + 1 s respawn arc
    run(m, 7.5, 0, 0, false);
    expect(m.mode).toBe('normal');
    expect(m.respawnCount).toBe(1);
    // respawned at the PlayerRespawnPoint closest to the last grounded position
    let best = respawnPoints[0]!;
    let bd = Infinity;
    for (const p of respawnPoints) {
      const d = Math.hypot(p[0] - lastGround[0]!, p[1] - lastGround[1]!, p[2] - lastGround[2]!);
      if (d < bd) { bd = d; best = p; }
    }
    expect(Math.hypot(m.x - best[0], m.z - best[2])).toBeLessThan(0.6);
  }, 60_000);
});
