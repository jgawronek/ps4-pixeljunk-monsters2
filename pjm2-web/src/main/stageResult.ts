// src/main/stageResult.ts
// Builds the Q4.StageResultMenuController score block for a CLEARED stage and applies the save-side effects
// of OnCameraSwitch (UpdateStageRecord + stage unlock). Separate from game.ts so the (shared) game module only
// calls one function. Pure over its inputs (testable with fakes).

import type { GameCoreHome } from '../core/GameCoreHome';
import type { GameCoreInventory } from '../core/GameCoreInventory';
import type { GameCoreWaveManager } from '../core/GameCoreWaveManager';
import type { SaveData } from '../view/save/SaveData';
import { applyStageClear, type ClearOutcome } from '../view/save/StageProgress';
import type { ResultScoreData } from '../view/ui/GameShell';
import { SCORE_SETTINGS, computeScore } from '../view/ui/ResultScore';

export interface ClearResultInputs {
  home: Pick<GameCoreHome, 'numChibiAtEndOfWave' | 'numStartingChibi' | 'numChibi'>;
  waveManager: Pick<GameCoreWaveManager, 'waveProgressList'>;
  inventory: Pick<GameCoreInventory, 'getEndOfGameStatistics'>;
  save: SaveData | null;
  /** Scene name = SaveData stage key (StageMain.GetStageNameFromCurrentScene). */
  scene: string;
  difficulty: number;
}

export interface ClearResult {
  score: ResultScoreData;
  outcome: ClearOutcome | null;
  /** ShouldAwardPerfectClear: NumChibi == TotalNumChibi. */
  perfect: boolean;
  stats: { coins: number; gems: number; interest: number };
}

export function buildClearResult(i: ClearResultInputs): ClearResult {
  const waves = i.waveManager.waveProgressList.length;
  const perWave: number[] = [];
  for (let w = 0; w < waves; w++) perWave.push(i.home.numChibiAtEndOfWave(w));
  const st = i.inventory.getEndOfGameStatistics();
  const stats = { coins: st.totalCoinsAcquired, gems: st.totalGemsAcquired, interest: st.totalInterestCoinsAcquired };
  const score = computeScore({
    startingChibis: i.home.numStartingChibi, chibisAtEndOfWave: perWave,
    coins: stats.coins, gems: stats.gems, interestCoins: stats.interest,
  });
  const perfect = i.home.numChibi === i.home.numStartingChibi;
  let outcome: ClearOutcome | null = null;
  let best = score;
  if (i.save !== null) {
    outcome = applyStageClear(i.save, i.scene, i.difficulty, score, perfect);
    best = i.save.getStageRecord(i.scene, i.difficulty);
  }
  return {
    score: {
      score, bestScore: best, interestCoins: stats.interest, clearBonus: SCORE_SETTINGS.clearBonus,
      newRecord: outcome?.newBest ?? true,
    },
    outcome, perfect, stats,
  };
}
