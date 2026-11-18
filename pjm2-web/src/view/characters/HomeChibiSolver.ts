// src/view/characters/HomeChibiSolver.ts
// Port of the per-frame VIEW solver of Q4.Home (the hut that the chibis stand around):
//   Q4.Home.Update            @0x4606e0  SyncToGameCore, then ChibiCollisions(Time.deltaTime, this, GameCoreHome)
//   Q4.Home.ChibiCollisions   @0x460ab0  the solver (this file, update())
//   Q4.Home.OnChibiAvoidanceZone @0x462900  addAvoidanceZone(): a temp 'Enemy' SolidCollider that lives 0.75 s
//   Q4.Home.SolidCollider ctor @0x4629c0, Q4.Home.ChibiSolverData.InitSolverData @0x462a40
// See docs/CHIBI_VIEW_ANALYSIS.md. Verified against raw x86-64 disassembly (objdump of Il2CppUserAssemblies.elf).
//
// What it does each frame: the sim (GameCoreHome.ChibiData) says WHERE each chibi belongs (homePos/homeRot). The solver
// starts every chibi at its CURRENT view position, relaxes (<= 3 passes) against chibi-chibi spacing, a pull toward
// homePos, and the SolidColliders {hut push-out, keep-inside ring, temp avoidance zones, players}; then writes the
// result onto the Chibi: DestPos, DestRot (= the sim rotation), IsPlayerClose, PlayerPos (and IsScared). The Chibi
// motor (Q4.Chibi.UpdatePosition) then runs to DestPos.
//
// Unity space (LH). No three.js / DOM.

import type { V3 } from './ChibiMotor';

/** Q4.Home.SolidCollider.EType. */
export const SolidType = { Player: 0, Cylinder: 1, Enemy: 2, Inside: 0x8000 } as const;

export interface SolidCollider {
  /** Raw type field: 0 Player, 1 Cylinder (hut), 2 Enemy (avoidance zone), 0x8001 Cylinder|Inside (keep-inside ring). */
  type: number;
  pos: V3;
  radius: number;
  radiusSqr: number;
  /** Remaining lifetime of a temp zone (seconds); 0 for the permanent ones. */
  dur: number;
}

/** Serialized Q4.Home values (decomp/data/structures_Home.json) + the hut position. */
export interface HomeSolverConfig {
  /** Structure.m_transform.position (Unity space): centre of the hut / home. */
  homePos: V3;
  /** Home.ChibiColSize @0x58 (0.2). */
  chibiColSize: number;
  /** Home.PlayerColSize @0x5c (0.4). */
  playerColSize: number;
  /** Structure.playerDetectionRange @0x20 (2.0): radius of the hut push-out cylinder. */
  playerDetectionRange: number;
  /** Home.ChibiMaxDistFromHome @0x7c (2.45): radius of the keep-inside ring. */
  chibiMaxDistFromHome: number;
  /** Home.MaxDist @0x44 (2.31): the player query uses Cylinder(MaxDist * 1.5, 2.0). */
  maxDist: number;
}

/** structures_Home.json values of home_001. */
export const HOME_001_CONFIG = {
  chibiColSize: 0.20000000298023224,
  playerColSize: 0.4000000059604645,
  playerDetectionRange: 2.0,
  chibiMaxDistFromHome: 2.450000047683716,
  maxDist: 2.309999942779541,
} as const;

/** The Q4.Chibi side the solver reads/writes (structurally satisfied by ChibiMotor). */
export interface SolverChibi {
  chibiId: number;
  /** Current view position (Transform.position). */
  pos: V3;
  /** Current view yaw (used as homeRot when the sim no longer has this chibi). */
  yawDeg: number;
  destPos: V3;
  destYawDeg: number;
  isScared: boolean;
  isPlayerClose: boolean;
  playerPos: V3;
}

/** GameCoreHome.GetChibiDataById(id) → position + yaw (degrees) of the sim rotation, or null when the chibi is gone. */
export type SimChibiLookup = (id: number) => { pos: V3; yawDeg: number } | null;

interface SolverData {
  id: number;
  pos: V3;
  homePos: V3;
  homeYawDeg: number;
  playerPos: V3;
  /** Indices j < i of chibis within 4 * ChibiColSize (xz). */
  detected: number[];
}

// ---- constants (rodata, see docs) ----
export const HOME_SOLVER_CONST = {
  /** @0xb7b78c / 0xb7b790: player query Cylinder(MaxDist * 1.5, 2.0). */
  PLAYER_QUERY_RADIUS_SCALE: 1.5,
  PLAYER_QUERY_HEIGHT: 2.0,
  /** @0xb7b794: IsPlayerClose when |playerPos - pos| < PlayerColSize + 0.1. */
  PLAYER_CLOSE_MARGIN: 0.1,
  /** @0xb7b798: pull toward homePos only while xz dist² > 0.005. */
  HOME_PULL_SQR_EPS: 0.004999999888241291,
  /** @0xb7b79c: fixed pull step per pass. */
  HOME_PULL_STEP: 0.05000000074505806,
  /** @0xb7b7a0: Enemy-zone push scale: Max(0, |homePos - zone.pos| * 0.25). */
  ENEMY_PUSH_SCALE: 0.25,
  /** @0xb7b7a4: chibi-chibi push factor (each moves half the overlap). */
  PAIR_PUSH_HALF: 0.5,
  /** @0xb7b7b0: InitSolverData.playerPos = Vector3.one * 1e6 ("no player"). */
  NO_PLAYER: 1000000.0,
  /** OnChibiAvoidanceZone @0x466990: the dur argument is ignored; movl $0x3f400000. */
  AVOID_ZONE_DUR: 0.75,
  /** Relaxation loop runs while changed && iteration < 2 → at most 3 passes. */
  MAX_PASSES: 3,
  /** Chibis with index < 2 snap to homePos inside an avoidance zone (they never flee). */
  AVOID_SNAP_COUNT: 2,
} as const;

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const mag = (v: V3): number => Math.hypot(v.x, v.y, v.z);
/** Vector3.normalized (zero below 1e-5, like Unity). */
function normalized(v: V3): V3 {
  const m = mag(v);
  return m > 1e-5 ? v3(v.x / m, v.y / m, v.z / m) : v3(0, 0, 0);
}

export class HomeChibiSolver {
  private readonly data: SolverData[] = [];
  private readonly colliders: SolidCollider[] = [];
  private zones: SolidCollider[] = [];

  constructor(readonly cfg: HomeSolverConfig) {}

  /** Q4.Home.OnChibiAvoidanceZone @0x462900 (UnityEvents.ChibiAvoidanceZoneEvent: pos, radius, dur). `dur` is IGNORED:
   *  the shipped code stores a constant 0.75 s. */
  addAvoidanceZone(pos: V3, radius: number, _dur?: number): void {
    this.zones.push({
      type: SolidType.Enemy, pos: { ...pos }, radius, radiusSqr: radius * radius,
      dur: HOME_SOLVER_CONST.AVOID_ZONE_DUR,
    });
  }

  /** The cylinder the original queries GameCore for players with: AllObjects<GameCorePlayer>(home pos, Cylinder(r, h)). */
  playerQuery(): { center: V3; radius: number; height: number } {
    return {
      center: { ...this.cfg.homePos },
      radius: this.cfg.maxDist * HOME_SOLVER_CONST.PLAYER_QUERY_RADIUS_SCALE,
      height: HOME_SOLVER_CONST.PLAYER_QUERY_HEIGHT,
    };
  }

  /** Test / debug: the colliders of the last update(), in original order. */
  get lastColliders(): readonly SolidCollider[] { return this.colliders; }
  get activeZones(): number { return this.zones.length; }

  /**
   * Q4.Home.ChibiCollisions(dt, home).
   * @param chibis   Home.m_chibis in spawn order (index = solver index; the original never reorders it).
   * @param players  view positions (Q4.Player transform) of the GameCorePlayers returned by playerQuery() (those with a viewer).
   * @param isEnemyClose GameCoreHome.IsEnemyClose (assigned to every Chibi.IsScared before the relaxation).
   * @param sim      GameCoreHome.GetChibiDataById.
   */
  update(dt: number, chibis: readonly SolverChibi[], players: readonly V3[], isEnemyClose: boolean, sim: SimChibiLookup): void {
    const C = HOME_SOLVER_CONST;
    const cfg = this.cfg;
    const colSize2 = cfg.chibiColSize + cfg.chibiColSize; // fVar22 = 2 * ChibiColSize
    const colSize2Sqr = colSize2 * colSize2;
    const nbrSqr = (colSize2 + colSize2) * (colSize2 + colSize2); // (2*fVar22)^2 neighbour radius²
    const n = chibis.length;

    // --- 1. seed (one ChibiSolverData per chibi; list only grows) ---
    while (this.data.length < n) {
      this.data.push({ id: 0, pos: v3(0, 0, 0), homePos: v3(0, 0, 0), homeYawDeg: 0, playerPos: v3(0, 0, 0), detected: [] });
    }
    for (let i = 0; i < n; i++) {
      const c = chibis[i];
      c.isScared = isEnemyClose; // Chibi.set_IsScared(IsEnemyClose)
      const s = sim(c.chibiId);
      const homePos = s !== null ? s.pos : { ...c.pos };
      const homeYaw = s !== null ? s.yawDeg : c.yawDeg;
      // InitSolverData(a_id = i, a_pos = view position, a_homePos, a_homeRot)
      const d = this.data[i];
      d.id = i;
      d.pos = { ...c.pos };
      d.homePos = { ...homePos };
      d.homeYawDeg = homeYaw;
      d.playerPos = v3(C.NO_PLAYER, C.NO_PLAYER, C.NO_PLAYER);
      d.detected.length = 0;
      for (let j = 0; j < i; j++) {
        const dx = this.data[j].pos.x - d.pos.x;
        const dz = this.data[j].pos.z - d.pos.z;
        if (dx * dx + dz * dz < nbrSqr) d.detected.push(j);
      }
    }

    // --- 2. colliders: hut cylinder, keep-inside ring, live temp zones, players ---
    this.colliders.length = 0;
    const hp = cfg.homePos;
    this.colliders.push({ type: SolidType.Cylinder, pos: { ...hp }, radius: cfg.playerDetectionRange, radiusSqr: cfg.playerDetectionRange ** 2, dur: 0 });
    this.colliders.push({
      type: SolidType.Cylinder | SolidType.Inside, pos: { ...hp },
      radius: cfg.chibiMaxDistFromHome, radiusSqr: cfg.chibiMaxDistFromHome ** 2, dur: 0,
    });
    for (let i = 0; i < this.zones.length;) {
      const z = this.zones[i];
      z.dur -= dt;
      if (z.dur > 0) { this.colliders.push(z); i++; } else this.zones.splice(i, 1);
    }
    for (const p of players) {
      this.colliders.push({ type: SolidType.Player, pos: { ...p }, radius: cfg.playerColSize, radiusSqr: cfg.playerColSize ** 2, dur: 0 });
    }

    // --- 3. relaxation (max 3 passes while anything moved) ---
    let changed: boolean;
    let pass = 0;
    do {
      changed = false;
      for (let i = 0; i < n; i++) {
        const d = this.data[i];
        let cur: V3 = { ...d.pos };

        // chibi-chibi: each overlapping earlier chibi k (xz dist < 2*ChibiColSize) is pushed by half the overlap, we the other half
        for (const k of d.detected) {
          const o = this.data[k];
          const diff = v3(o.pos.x - cur.x, o.pos.y - cur.y, o.pos.z - cur.z);
          if (diff.x * diff.x + diff.z * diff.z < colSize2Sqr) {
            const m = mag(diff);
            const nrm = normalized(diff);
            const f = (colSize2 - m) * C.PAIR_PUSH_HALF;
            const push = v3(nrm.x * f, nrm.y * f, nrm.z * f);
            cur = v3(cur.x - push.x, cur.y - push.y, cur.z - push.z);
            o.pos = v3(o.pos.x + push.x, o.pos.y + push.y, o.pos.z + push.z);
            changed = true;
          }
        }

        // pull toward homePos (fixed 0.05 step per pass while farther than ~0.07 in xz)
        const toHome = v3(d.homePos.x - cur.x, d.homePos.y - cur.y, d.homePos.z - cur.z);
        if (toHome.x * toHome.x + toHome.z * toHome.z > C.HOME_PULL_SQR_EPS) {
          const nrm = normalized(toHome);
          cur = v3(cur.x + nrm.x * C.HOME_PULL_STEP, cur.y + nrm.y * C.HOME_PULL_STEP, cur.z + nrm.z * C.HOME_PULL_STEP);
          changed = true;
        }

        // solid colliders (xz only: y of the offset is zeroed)
        for (const col of this.colliders) {
          const v = v3(cur.x - col.pos.x, 0, cur.z - col.pos.z);
          const dist2 = v.x * v.x + v.z * v.z;
          const isInside = (col.type & 0x8000) !== 0; // (short)type < 0
          if (isInside !== col.radiusSqr < dist2) continue; // Inside: act when outside the ring; others: when within radius
          if (col.type === SolidType.Enemy) {
            if (i < C.AVOID_SNAP_COUNT) {
              cur = { ...d.homePos }; // the first two chibis never flee: snap to their home spot
            } else {
              const len = mag(v3(d.homePos.x - col.pos.x, d.homePos.y - col.pos.y, d.homePos.z - col.pos.z));
              const nrm = normalized(v);
              const s = Math.max(0, len * C.ENEMY_PUSH_SCALE);
              cur = v3(cur.x + nrm.x * s, cur.y + nrm.y * s, cur.z + nrm.z * s);
            }
            chibis[i].isScared = true;
          } else {
            // Player / hut cylinder / keep-inside: move to the collider surface (radius - |v|; negative for Inside = pull in)
            const m = Math.sqrt(dist2);
            const nrm = normalized(v);
            const s = col.radius - m;
            cur = v3(cur.x + nrm.x * s, cur.y + nrm.y * s, cur.z + nrm.z * s);
          }
          changed = true;
          if (col.type === SolidType.Player) d.playerPos = { ...col.pos };
        }
        d.pos = cur;
      }
      pass++;
    } while (changed && pass < C.MAX_PASSES);

    // --- 4. write back ---
    const closeR = cfg.playerColSize + C.PLAYER_CLOSE_MARGIN;
    for (let i = 0; i < n; i++) {
      const d = this.data[i];
      const c = chibis[i];
      c.destPos = { ...d.pos };
      c.destYawDeg = d.homeYawDeg; // DestRot = sim rotation (yaw)
      const dp = v3(d.playerPos.x - d.pos.x, d.playerPos.y - d.pos.y, d.playerPos.z - d.pos.z);
      c.isPlayerClose = dp.x * dp.x + dp.y * dp.y + dp.z * dp.z < closeR * closeR;
      c.playerPos = { ...d.playerPos };
    }
  }
}
