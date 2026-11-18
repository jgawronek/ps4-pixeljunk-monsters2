// src/view/tower/TowerUpgradeSetting.ts
// Q4.TowerUpgradeSetting<T> / Q4.TowerUpgradeSettingGeneric + Q4.TowerUpgrade
// (TypeDefIndex 3420) port — the per-tower level table and the stat write the
// sim performs when a tower gains a level.
//
// ORIGINAL (see docs/TOWER_LEVEL_UPGRADE_ANALYSIS.md for the evidence):
//   GetUpgrade(level)        @0x7757B0  linear scan of the serialized `upgrades`
//                                       list for the row whose level == arg
//                                       (null when absent -> max level).
//   GetCurrentUpgrade(tower) @0x7759B0  GetUpgrade(tower.currentLevel)
//   GetNextUpgrade(tower)    @0x775A10  GetUpgrade(tower.currentLevel + 1)
//   UpgradeTower(tower, ref level) @0x775A60
//                                       row = GetNextUpgrade; if null -> level
//                                       untouched; else row.ApplyUpgrade(tower)
//                                       and level = row.level.
//   TowerUpgrade.ApplyUpgrade @0x473B00 (verified against the x86-64 disassembly
//     @file 0x477B00): only when tower.currentLevel < row.level it writes
//       tower+0x80 costCoin   = row+0x24   tower+0x84 costGem  = row+0x28
//       tower+0x94 refundCoin = row+0x2C   tower+0x98 refundGem = row+0x30
//       tower+0x70 attackPower= row+0x34   tower+0x74 attackSpeed = row+0x38
//       tower+0x78 attackRangeInner = row+0x3C
//       detector.Upgrade(row+0x40 attackRangeScale, row+0x44 affectRangeRate)
//       tower+0x7C attackSpread = row+0x48 tower+0x8C burstCount = row+0x4C
//       tower+0x90 burstInterval = row+0x50
//     It does NOT write the level; the Setting's ref-level write does.
// Row 0x10 level / 0x18 flagPrefab / 0x20 reachExp are read by the sim and view.

import type { GameCoreTower } from '../../core/GameCoreTower';
import type { TowerUpgradeContract, TowerUpgradeSettingContract } from '../q4-contracts';

const f = Math.fround;

/** One serialized Q4.TowerUpgrade record (structures_TowerUpgradeSettingGeneric.json). */
export interface TowerUpgradeRow extends TowerUpgradeContract {
  level: number; // 0x10
  flagPathId?: string; // 0x18 flagPrefab PPtr (decorates the tower; model not extracted)
  reachExp: number; // 0x20
  costCoin: number; // 0x24
  costGem: number; // 0x28
  refundCoin: number; // 0x2C
  refundGem: number; // 0x30
  attackPower: number; // 0x34
  attackSpeed: number; // 0x38
  attackRangeInner: number; // 0x3C
  attackRangeScale: number; // 0x40
  affectRangeRate: number; // 0x44
  attackSpread: number; // 0x48
  burstCount: number; // 0x4C
  burstInterval: number; // 0x50
}

/** Q4.TowerUpgradeSettingGeneric: the Lv2..Lv5 table of ONE tower prefab. */
export class TowerUpgradeSettingGeneric implements TowerUpgradeSettingContract {
  constructor(readonly upgrades: readonly TowerUpgradeRow[]) {}

  // GetUpgrade @0x7757B0
  getUpgrade(level: number): TowerUpgradeRow | null {
    for (const u of this.upgrades) if (u.level === level) return u;
    return null;
  }

  // GetCurrentUpgrade @0x7759B0 (a null tower queries level -1)
  getCurrentUpgrade(tower: GameCoreTower): TowerUpgradeRow | null {
    return this.getUpgrade(tower === null ? -1 : tower.currentLevel);
  }

  // GetNextUpgrade @0x775A10 (a null tower queries level 0)
  getNextUpgrade(tower: GameCoreTower): TowerUpgradeRow | null {
    return this.getUpgrade(tower === null ? 0 : tower.currentLevel + 1);
  }

  // UpgradeTower @0x775A60 — C# `ref int currentLevel` -> returned new level.
  upgradeTower(tower: GameCoreTower): number {
    const row = this.getNextUpgrade(tower);
    if (row === null) return tower.currentLevel; // ref untouched
    applyUpgrade(row, tower);
    return row.level;
  }
}

/** Q4.TowerUpgrade.ApplyUpgrade @0x473B00 (instruction-verified field map above). */
export function applyUpgrade(row: TowerUpgradeRow, tower: GameCoreTower): boolean {
  if (!(tower.currentLevel < row.level)) return false;
  tower.costCoin = row.costCoin | 0;
  tower.costGem = row.costGem | 0;
  tower.refundCoin = row.refundCoin | 0;
  tower.refundGem = row.refundGem | 0;
  tower.attackPower = f(row.attackPower);
  tower.attackSpeed = f(row.attackSpeed);
  tower.attackRangeInner = f(row.attackRangeInner);
  tower.enemyDetector?.upgrade(f(row.attackRangeScale), f(row.affectRangeRate));
  tower.attackSpread = f(row.attackSpread);
  tower.burstCount = row.burstCount | 0;
  tower.burstInterval = f(row.burstInterval);
  return true;
}

export type TowerUpgradeTable = Record<string, TowerUpgradeRow[]>;

/** Build per-tower settings from public/assets/data/tower-upgrades.json. */
export function buildUpgradeSettings(table: TowerUpgradeTable): Map<string, TowerUpgradeSettingGeneric> {
  const out = new Map<string, TowerUpgradeSettingGeneric>();
  for (const [name, rows] of Object.entries(table)) out.set(name, new TowerUpgradeSettingGeneric(rows));
  return out;
}
