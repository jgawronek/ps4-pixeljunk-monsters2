// src/view/characters/stageEnemyDefs.ts
// Enemy (and balloon rig) GLB names a stage needs, read from its resolved WaveResource (regular waves of every
// difficulty + the boss minion groups). Without a GLB in the CharacterLibrary the enemy viewer factory returns
// null = the enemy exists in the sim but is invisible (the core set only covers stage 1's kuri / boss_bero_00).
// Balloon enemies (spawnMode Balloon) additionally need their Q4.Balloon rig `balloon_<family>`
// (tools/assets/extract_balloons.py).

import type { WaveDataContract, WaveResourceContract } from '../q4-contracts';
import { BALLOON_ENEMIES } from '../../data/enemyBalloons';

export function balloonRigName(enemyDef: string): string { return `balloon_${enemyDef.split('_')[0]}`; }

export function stageEnemyDefs(res: WaveResourceContract): string[] {
  const names = new Set<string>();
  const addWave = (w: WaveDataContract): void => {
    for (const l of w.perDifficulyLists) for (const s of l.spawnDataList) if (s.enemyObject !== null) names.add(s.enemyObject.name);
  };
  res.waveDataList.forEach(addWave);
  for (const list of [res.waveDataBossListEasy, res.waveDataBossListMedium, res.waveDataBossListHard]) {
    if (list !== null) for (const b of list) addWave(b.waveData);
  }
  for (const n of [...names]) if (n in BALLOON_ENEMIES) names.add(balloonRigName(n));
  return [...names].sort();
}
