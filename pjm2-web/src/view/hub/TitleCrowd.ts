// src/view/hub/TitleCrowd.ts
// The crowd of chibis in front of the hut on the title screen (orig_main.png / the 19.50.03 still: ~20 chibis in an arc in front of the hut, facing
// outwards = towards the title camera, the tikiman at the arch).  It is NOT the CompanionsGathering system (that only fills 10 CompanionPoints scattered
// over the whole world map, one of them 4.6 m left of the hut and out of frame, from SaveData.companionRecords written by the multiplayer result menu):
// the hub scene carries a real `Q4.Home` MonoBehaviour on `3d_stage_000_data/ObjectRoot/HomeRoot/home_000` (world (0,0,0), identity rotation, so the home
// forward is +Z = towards the title camera) with
//     NumChibi 20, IntroNumHomeChibi 20, ChibiMaxDistFromHome 2.78, enemyDetectionRange 3.0
//     ChibiHomeZones: 2 x { NumChibi 10, MinDist 2.15, MaxDist 2.5, AngleSpread 60, AngleCenter +35 / -35 }
// (UnityPy, BuildPlayer-3d_stage_000_env MonoBehaviour pid 8228; the same component the stages use, stage 1 has one zone 20 / 2.02..2.31 / 133 deg).
// GameCoreHome.CreateChibis @0x4BA500 -> SpawnChibi @0x4BB410 (polar spot: angle = Range(-spread, +spread) * 0.5 + centre, dist = Range(min, max),
// offset = AngleAxis(angle, up) * forward * dist, rotation = LookRotation(offset)) -> SpreadOutChibi @0x4BB7C0 (sort by distance to home + forward *
// enemyDetectionRange, <= 9 relaxation passes pushing pairs closer than 0.16 apart by (0.4 - d) * 0.5), exactly as src/core/GameCoreHome.ts.
// Exact: the zone data, the spawn / spread maths.  Approximated: the original draws the angle / distance from UnityEngine.Random (different every
// run) - here a fixed UnityRandom seed; the terrain snap is flat y = 0 (the ground under the hut is flat within 0.07 m); the live Q4.Chibi wander /
// avoidance of the tikiman is not run (they idle through the same ChibiMotor / chibi_ctrl view as the hub NPCs).

import type { HubChibiNode } from '../../data/hubTrees.generated';
import { UnityRandom } from '../../engine/rng/UnityRandom';

export interface HomeChibiZone { numChibi: number; minDist: number; maxDist: number; angleCenter: number; angleSpread: number }

/** Q4.Home of the hub (home_000) as serialized. */
export const HUB_HOME = {
  pos: [0, 0, 0] as const,
  forward: [0, 0, 1] as const,
  enemyDetectionRange: 3.0,
  zones: [
    { numChibi: 10, minDist: 2.15, maxDist: 2.5, angleCenter: 35, angleSpread: 60 },
    { numChibi: 10, minDist: 2.15, maxDist: 2.5, angleCenter: -35, angleSpread: 60 },
  ] as readonly HomeChibiZone[],
};

/** UnityEngine.Random substitute for the title (the original is unseeded). */
export const TITLE_CROWD_SEED = 20181;

const MIN_SPACING = 0.16;
const PUSH_REST = 0.4;
const PUSH_SCALE = 0.5;
const MAX_PASSES = 9;

interface Spot { id: number; x: number; z: number; yaw: number }

/** GameCoreHome.CreateChibis: spawn + spread (pure; `rng` = UnityRandom.Range(min, max)). */
export function homeChibiLayout(
  zones: readonly HomeChibiZone[],
  home: { forward: readonly [number, number, number]; enemyDetectionRange: number; pos: readonly [number, number, number] },
  range: (min: number, max: number) => number,
): HubChibiNode[] {
  const spots: Spot[] = [];
  let id = 0;
  const fl = Math.hypot(home.forward[0], home.forward[2]) || 1;
  const fx = home.forward[0] / fl, fz = home.forward[2] / fl;
  for (const zone of zones) {
    for (let j = 0; j < zone.numChibi; j++) {
      const angle = range(-zone.angleSpread, zone.angleSpread) * 0.5 + zone.angleCenter;
      const dist = range(zone.minDist, zone.maxDist);
      const a = (angle * Math.PI) / 180;
      // Quaternion.AngleAxis(angle, up) * (forward * dist): Unity yaw about +Y (x' = x cos + z sin, z' = -x sin + z cos)
      const ox = (fx * Math.cos(a) + fz * Math.sin(a)) * dist;
      const oz = (-fx * Math.sin(a) + fz * Math.cos(a)) * dist;
      spots.push({ id: id++, x: home.pos[0] + ox, z: home.pos[2] + oz, yaw: (Math.atan2(ox, oz) * 180) / Math.PI }); // LookRotation(offset)
    }
  }
  // SpreadOutChibi
  const ax = home.pos[0] + fx * home.enemyDetectionRange, az = home.pos[2] + fz * home.enemyDetectionRange;
  spots.sort((p, q) => {
    const dp = Math.hypot(p.x - ax, p.z - az), dq = Math.hypot(q.x - ax, q.z - az);
    return dq < dp ? 1 : dq > dp ? -1 : p.id - q.id;
  });
  let pass = 0;
  let moved: boolean;
  do {
    moved = false;
    for (let i = 0; i < spots.length; i++) {
      let cx = spots[i].x, cz = spots[i].z;
      for (let j = i + 1; j < spots.length; j++) {
        const dx = spots[j].x - cx, dz = spots[j].z - cz;
        const d = Math.hypot(dx, dz);
        if (d < MIN_SPACING) {
          const k = d > 0 ? (PUSH_REST - d) * PUSH_SCALE / d : 0;
          cx -= dx * k; cz -= dz * k;
          spots[j].x += dx * k; spots[j].z += dz * k;
          moved = true;
        }
      }
      spots[i].x = cx; spots[i].z = cz;
    }
    if (!moved) break;
    pass++;
  } while (pass <= MAX_PASSES - 1);
  return spots.map((s) => ({ i: 90000 + s.id, pos: [s.x, 0, s.z] as [number, number, number], yaw: s.yaw }));
}

export const TITLE_CAMERA_XZ = { x: 0, z: 4.79 };

/** The title crowd of the hub: Home zones laid out with the fixed seed. */
export function titleCrowdNodes(seed = TITLE_CROWD_SEED): HubChibiNode[] {
  const r = new UnityRandom(seed);
  return homeChibiLayout(HUB_HOME.zones, HUB_HOME, (a, b) => r.Range(a, b));
}
