// src/view/characters/towerSimSource.ts
// Builds the per-frame TowerSimSnapshot the TowerStageView reads from a live
// GameCoreTower (the original view classes read the same sim fields directly:
// GetGameCoreObject<GameCoreTower>() → GetTowerState() / position / directions).

import { GameCoreTower } from '../../core/GameCoreTower';
import { TowerStateBuild } from '../../core/TowerStateBuild';
import { TowerStateIdle } from '../../core/TowerStateIdle';
import type { TowerSimSnapshot } from './TowerStageView';

const v3 = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({
  x: v.x, y: v.y, z: v.z,
});

export function towerSimSnapshot(tower: GameCoreTower): TowerSimSnapshot {
  const state = tower.getTowerState();
  let kind: TowerSimSnapshot['state']['kind'] = 'other';
  let shootOnSight = false;
  let finalPosition: TowerSimSnapshot['state']['finalPosition'] = null;
  if (state instanceof TowerStateBuild) {
    kind = 'build';
    finalPosition = v3(state.towerFinalPosition);
  } else if (state instanceof TowerStateIdle) {
    kind = 'idle';
    shootOnSight = state.shootOnSight;
  }
  return {
    position: v3(tower.position),
    bodyDirection: v3(tower.bodyDirection),
    fortDirection: v3(tower.fortDirection),
    attackSpeed: tower.attackSpeed,
    state: { kind, stateTime: state?.stateTime ?? 0, shootOnSight, finalPosition },
  };
}
