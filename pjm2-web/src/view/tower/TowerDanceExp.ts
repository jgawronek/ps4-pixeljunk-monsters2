// src/view/tower/TowerDanceExp.ts
// Port of the tower-EXP "dance" logic in Q4.Player.CheckForTowers @0x3E9670
// (decompiled/Q4.Player.c L3208..; constants from Il2CppUserAssemblies.elf
// .rodata at Ghidra vaddr + 0x4000: DAT_00b7a6e4 = 5.0, DAT_00b7a6e8 = 1.0,
// DAT_00b7a6ec = 0.001, DAT_00b7a6f0 = 0.75, DAT_00b7a6f4 = -1.0).
//
// The tikiman charges a nearby tower by standing still next to it:
//   * tower = FindClosestObject<GameCoreTower>(playerPos, radius 5.0, height 1.0)
//   * the player must be standing (motor in a standing state — the two generic
//     IsStateRunning<> instantiations were not resolvable; the caller supplies
//     `standing`), moved < 0.001 since the previous frame (|pos - m_lastpos|)
//     and the game must not be over;
//   * tower state must not be TowerStateBuild/TowerStateDegenerate, the tower
//     must be the player's NEAREST SELECTION (the structure whose trigger the
//     player stands in) and must still have a next upgrade;
//   * IdleTime (0x250) fills at 1/m_TowerXPIdleDur per second (clamped to 1);
//     DanceState 1 (waiting) until IdleTime >= 0.75, then DanceState 2: XPTime
//     (0x254) accumulates dt and every time it exceeds m_TowerXPInterval it
//     is reduced by the interval and TowerXPCommand(tower,
//     DanceEXPByDifficulty(m_TowerXPAmount)) is queued;
//   * every other path "decays": IdleTime -= dt/m_TowerXPIdleCoolDownDur (with a
//     cooldown <= 0.001 it simply resets IdleTime and XPTime to 0), DanceState 0.
// Serialized Q4.Player values (globalsettings bundle, MonoBehaviour
// path_id 2514285418080110840): IdleDur 1.5, IdleCoolDownDur 0.0,
// Interval 0.1, Amount 0.612.

import type { GameCoreHandle } from '../../core/GameCoreHandle';
import type { GameCoreTower } from '../../core/GameCoreTower';

export const DANCE_SEARCH_RADIUS = 5.0; // DAT_00b7a6e4
export const DANCE_SEARCH_HEIGHT = 1.0; // DAT_00b7a6e8
export const STILL_EPSILON = 0.001; // DAT_00b7a6ec (also the cooldown/idle-dur guard)
export const DANCE_START_FRACTION = 0.75; // DAT_00b7a6f0

export interface DanceParams {
  idleDur: number; // m_TowerXPIdleDur 0x16C
  coolDownDur: number; // m_TowerXPIdleCoolDownDur 0x170
  interval: number; // m_TowerXPInterval 0x174
  amount: number; // m_TowerXPAmount 0x178
}
/** Serialized tikiman values (see header). */
export const DEFAULT_DANCE_PARAMS: DanceParams = {
  idleDur: 1.5,
  coolDownDur: 0.0,
  interval: 0.10000000149011612,
  amount: 0.6119999885559082,
};

export const enum DanceState {
  None = 0,
  Waiting = 1,
  Dancing = 2,
}

export interface DanceFrameInput {
  dt: number;
  /** Player moved less than STILL_EPSILON since the previous frame. */
  still: boolean;
  /** Motor is in a state that may start dancing (idle/standing). */
  standing: boolean;
  gameOver: boolean;
  /** FindClosestObject<GameCoreTower>(pos, 5, 1) — nearest tower or null. */
  nearestTower: GameCoreTower | null;
  /** tower state is TowerStateBuild or TowerStateDegenerate. */
  towerBusy: boolean;
  /** tower is PlayerStructureSelector.GetNearestSelection(). */
  isNearestSelection: boolean;
  /** DifficultySettings.DanceEXPByDifficulty multiplier (Medium: 1.0). */
  expRate: number;
}

export interface DanceXpGrant {
  tower: GameCoreTower;
  handle: GameCoreHandle;
  amount: number;
}

export class TowerDanceExp {
  danceState: DanceState = DanceState.None; // 0x238
  idleTime = 0; // 0x250
  xpTime = 0; // 0x254
  /** m_TowerHandle 0x268 — dance target. */
  target: GameCoreTower | null = null;

  constructor(private readonly params: DanceParams = DEFAULT_DANCE_PARAMS) {}

  private decay(dt: number): void {
    const cd = this.params.coolDownDur;
    if (cd <= STILL_EPSILON) {
      this.idleTime = 0;
      this.xpTime = 0;
    } else {
      this.idleTime = Math.min(1, Math.max(0, this.idleTime + (-1.0 / cd) * dt));
      if (this.idleTime <= 0) this.xpTime = 0;
    }
    this.danceState = DanceState.None;
  }

  /** One CheckForTowers pass; returns the TowerXPCommand payload when one fires. */
  update(inp: DanceFrameInput): DanceXpGrant | null {
    const dt = inp.dt;
    if (!inp.standing) {
      // motor not in an eligible state: handle cleared, full reset
      this.target = null;
      this.idleTime = 0;
      this.xpTime = 0;
      this.danceState = DanceState.None;
      return null;
    }
    const tower = inp.nearestTower;
    if (tower === null || !inp.still || inp.gameOver) {
      this.target = null;
      if (tower === null) {
        this.idleTime = 0;
        this.xpTime = 0;
        this.danceState = DanceState.None;
      } else {
        this.decay(dt);
      }
      return null;
    }
    if (inp.towerBusy || !inp.isNearestSelection || tower.getNextUpgrade() === null) {
      this.decay(dt); // handle intentionally NOT cleared (matches LAB_003e9b96 path)
      return null;
    }
    this.target = tower;
    const idleDur = this.params.idleDur;
    if (idleDur <= STILL_EPSILON) {
      this.idleTime = 0;
      this.danceState = DanceState.Waiting;
      return null;
    }
    this.idleTime = Math.min(1.0, this.idleTime + (1.0 / idleDur) * dt);
    if (this.idleTime < DANCE_START_FRACTION) {
      this.danceState = DanceState.Waiting;
      return null;
    }
    this.danceState = DanceState.Dancing;
    this.xpTime += dt;
    if (this.xpTime > this.params.interval) {
      this.xpTime -= this.params.interval;
      return { tower, handle: tower.handle, amount: this.params.amount * inp.expRate };
    }
    return null;
  }
}
