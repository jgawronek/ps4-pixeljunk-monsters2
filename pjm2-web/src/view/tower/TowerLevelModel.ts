// src/view/tower/TowerLevelModel.ts
// Pure model of the tower-level presentation (no DOM / Three) so it is
// unit-testable. Ports, from the original Q4 UI:
//   * TowerEXPGauge (Q4.TowerEXPGauge @0x552000..): the gauge value fed to the
//     Animator float "ExpGauge" is (level-1) + expRate; the Animator consumes
//     value - floor(value) (vroundss mode 9 = floor) as the fill; the gauge
//     GameObject is deactivated when the tower has no next upgrade (max level).
//     It is shown for 2.0 s (ctor 0x48) after every EXP grant / range entry,
//     the displayed value eases toward the target by 0.1 per frame (ctor 0x4C)
//     after a 0.25 s delay (ctor 0x38), and the object is deactivated 3.0 s
//     after the show timer expires (Update: timer < DAT_00b7d024 = -3.0).
//   * TowerLevelText / TowerLevelTextPool: after every upgrade the tower shows a
//     persistent level label (string tl_hud_level_00N, array index
//     max(0, newLevel-2)) until the tower is sold or a BOSS dies.
//   * TowerLevelUpText: a "Level Up!" (tl_hud_001) popup, auto-hidden by Invoke.
//   * TowerLevelUpEffect: `newLevel` particle bursts, one every 0.2 s (ctor 0x18
//     = 0x3e4ccccd).

import type { GameCoreTower } from '../../core/GameCoreTower';

/** TowerEXPGauge ctor constants (ctor @0x552000; DAT_00b7d018/01c = 1.25/1.0). */
export const GAUGE_SHOW_SECONDS = 2.0; // +0x48 = 0x40000000
export const GAUGE_EASE_PER_FRAME = f32(0.1); // +0x4C = 0x3dcccccd
export const GAUGE_EASE_DELAY = 0.25; // +0x38 = 0x3e800000
export const GAUGE_DEACTIVATE_AFTER = -3.0; // DAT_00b7d024
export const GAUGE_SETTLE_EPS = -0.01; // DAT_00b7d020 (maxed gauge keeps showing while it animates)
export const LEVELUP_EFFECT_INTERVAL = f32(0.2); // TowerLevelUpEffect ctor +0x18

function f32(x: number): number {
  return Math.fround(x);
}

/** Tower HUD string key for a level (tl_hud_level_001..005). */
export function levelStringKey(level: number): string {
  return `tl_hud_level_${String(Math.max(1, Math.min(5, level | 0))).padStart(3, '0')}`;
}

/** The gauge strings carry a trailing '#' glyph placeholder at max level
 *  (tl_hud_level_005 = 'Lv.5#'); the sprite glyph is not extracted, strip it. */
export function levelLabel(raw: string): string {
  return raw.replace(/#/g, '');
}

/** TowerEXPGauge.OnGrantEXP target value: (level-1) + GetCurrentExpRate. */
export function gaugeTarget(tower: GameCoreTower): number {
  return tower.currentLevel - 1 + tower.getCurrentExpRate();
}

/** TowerEXPGauge.OnGrantEXP start value (value shown BEFORE the grant):
 *  (level-1) + ((EXP - amount) - curReach) / (nextReach - curReach), clamped >= 0;
 *  0 when no next upgrade (faithful: fVar13 = 0 then + (level-1)). */
export function gaugeStart(tower: GameCoreTower, grantedAmount: number): number {
  const cur = tower.getCurrentUpgrade();
  const next = tower.getNextUpgrade();
  const curReach = cur !== null ? cur.reachExp : 0;
  let rate = 0;
  if (next !== null && next.reachExp !== 0) {
    rate = (tower.currentEXP - grantedAmount - curReach) / (next.reachExp - curReach);
  }
  const v = tower.currentLevel - 1 + rate;
  return v < 0 ? 0 : v;
}

/** Per-tower EXP gauge animation state (Q4.TowerEXPGauge Update/OnGrantEXP). */
export class ExpGaugeState {
  /** True when the tower has no next upgrade (+0x5C) — gauge hidden. */
  maxed = false;
  private showTimer = 0; // +0x50
  private displayed = 0; // +0x54
  private target = 0; // +0x58
  private delay = 0; // +0x60 (counts up to 0.25)
  /** GameObject active flag (SetActive). */
  active = false;

  /** OnGrantEXP(amount, tower). */
  onGrant(tower: GameCoreTower, amount: number): void {
    this.showTimer = GAUGE_SHOW_SECONDS;
    if (!this.active) this.delay = 0;
    this.target = gaugeTarget(tower);
    this.displayed = gaugeStart(tower, amount);
    this.maxed = tower.getNextUpgrade() === null;
    this.active = !this.maxed;
  }

  /** Update(dt). `visible` is the Animator OnInIdle bool. */
  update(dt: number): void {
    this.showTimer -= dt;
    if (this.showTimer < GAUGE_DEACTIVATE_AFTER) this.active = false;
    this.delay = Math.min(this.delay + dt, GAUGE_EASE_DELAY);
    if (this.delay !== GAUGE_EASE_DELAY) return;
    const next = this.displayed + (this.target - this.displayed) * GAUGE_EASE_PER_FRAME;
    this.displayed = Math.min(Math.max(next, 0), this.target);
  }

  get visible(): boolean {
    if (this.showTimer <= 0) return false;
    return !this.maxed || this.displayed < this.target + GAUGE_SETTLE_EPS;
  }

  /** Value handed to the Animator "ExpGauge" float: fractional part of the value. */
  get fill(): number {
    return this.displayed - Math.floor(this.displayed);
  }
  /** Completed-level count shown by the integer part (level - 1 at rest). */
  get completedLevels(): number {
    return Math.floor(this.displayed);
  }
}
