// src/view/ui/ResultScore.ts
// Q4.StageResultMenuController score + count-up (pure; UI-only numbers, plain JS ints).
//
// SCORE (ComputeScore @0052f550, Q4.StageResultMenuController.c L859-985; constants from the serialized
// Q4.ScoreSettings in the globalsettings bundle, pid 6594865192701025772):
//   chibiPoints 50, allChibisSafeBonus 500, clearBonus 10000, allWaveEnemiesKilledPoints 100,
//   coinPoints 1, gemPoints 100.
//   perWave(i) = chibiPoints*c_i + (c_i == c_{i-1} ? allWaveEnemiesKilledPoints : 0)
//                                + (c_i == startingChibis ? allChibisSafeBonus : 0)
//     where c_i = home.NumChibiAtEndOfWave(i), c_{-1} = NumStartingChibi, i over waveProgressList.
//   score = Σ perWave + (coins + interestCoins) * coinPoints + gems * gemPoints + clearBonus
//   (GetEndOfGameStatistics out order = coins, gems, interest -- Update()'s text<-field mapping.)
//   ComputeInventoryScore(coins,gems,interest) = gems*gemPoints + (interest+coins)*coinPoints.
//
// COUNT-UP (Update @0052f960): `countUpAlpha += dt / countUpDuration` (3.0 s, prefab value), clamped to 1;
//   the eased value `countUpCurve.Evaluate(alpha)` (Unity AnimationCurve, 3 Hermite keys) clamped to [0,1]
//   drives every number as CountUpValue.Evaluate(eased) (UNVERIFIED rounding: modelled as floor(eased*target);
//   the raw 0x52fe60 body could not be located in the disassembly -- see docs). While alpha was < 1 at frame
//   start the ScoreCountUp SFX plays each frame; when it reaches 1: perfect -> UnityEvent(1,perfect) +
//   GameClearRainbow SFX + ShowRainbow/ShowPerfectIcon animator bools; new record -> NewRecord SFX +
//   `new_record` animation. OnConfirm @00530060: alpha >= ~1 -> leave (-> WorldMap.LoadWorldMap = stage
//   select); else alpha jumps to 0.99 (0x3f7d70a4) = skip the count-up.

export interface ScoreSettings {
  chibiPoints: number;
  allChibisSafeBonus: number;
  clearBonus: number;
  allWaveEnemiesKilledPoints: number;
  coinPoints: number;
  gemPoints: number;
}

/** globalsettings bundle MonoBehaviour "ScoreSettings". */
export const SCORE_SETTINGS: Readonly<ScoreSettings> = {
  chibiPoints: 50,
  allChibisSafeBonus: 500,
  clearBonus: 10000,
  allWaveEnemiesKilledPoints: 100,
  coinPoints: 1,
  gemPoints: 100,
};

export interface ScoreInputs {
  startingChibis: number;
  /** home.numChibiAtEndOfWave(i) for every entry of the wave progress list. */
  chibisAtEndOfWave: readonly number[];
  coins: number;
  gems: number;
  interestCoins: number;
}

export function computeInventoryScore(coins: number, gems: number, interestCoins: number, s: ScoreSettings = SCORE_SETTINGS): number {
  return gems * s.gemPoints + (interestCoins + coins) * s.coinPoints;
}

export function computeScore(i: ScoreInputs, s: ScoreSettings = SCORE_SETTINGS): number {
  let waves = 0;
  let prev = i.startingChibis;
  for (const c of i.chibisAtEndOfWave) {
    waves += s.chibiPoints * c;
    if (c === prev) waves += s.allWaveEnemiesKilledPoints;
    if (c === i.startingChibis) waves += s.allChibisSafeBonus;
    prev = c;
  }
  return (waves + computeInventoryScore(i.coins, i.gems, i.interestCoins, s) + s.clearBonus) | 0;
}

// ---- count-up ------------------------------------------------------------------------------

export const COUNT_UP_DURATION = 3.0;
/** countUpCurve keys (time,value,inSlope,outSlope), ResultMenuController prefab MonoBehaviour. */
export const COUNT_UP_CURVE: readonly (readonly [number, number, number, number])[] = [
  [0.0, 0.0, 0.20712806284427643, 0.20712806284427643],
  [0.8406797647476196, 0.33161282539367676, 1.351406455039978, 1.351406455039978],
  [1.0, 1.0, 8.933391571044922, 8.933391571044922],
];

/** UnityEngine.AnimationCurve.Evaluate for cubic-Hermite keys with clamped (PreInfinity/PostInfinity=2 = clamp) ends. */
export function evalCurve(keys: readonly (readonly [number, number, number, number])[], t: number): number {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0, , o0] = keys[i];
  const [t1, v1, i1] = keys[i + 1];
  const dt = t1 - t0;
  const u = (t - t0) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * dt * o0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * dt * i1;
}

export interface CountUpTargets {
  score: number;
  coins: number;
  gems: number;
  wavesCleared: number;
  interest: number;
  clearBonus: number;
  chibisRemaining: number;
}

export interface CountUpFrame {
  alpha: number;
  eased: number;
  values: CountUpTargets;
  /** True on frames where ScoreCountUp SFX plays (alpha at frame START < 1). */
  playCountSfx: boolean;
  /** True exactly once, on the frame alpha reaches 1. */
  finishedNow: boolean;
  done: boolean;
}

export class CountUp {
  alpha = 0;
  private finished = false;
  constructor(readonly targets: CountUpTargets, private readonly duration = COUNT_UP_DURATION) {}

  /** Update(): started by StartCountUp (flag +0x130). */
  tick(dt: number): CountUpFrame {
    const before = this.alpha;
    const rate = 1 / (this.duration > 0 ? this.duration : 1);
    this.alpha = Math.min(1, before + dt * rate);
    return this.frame(before < 1);
  }

  /** OnConfirm: false = skipped to 0.99 (count-up still running), true = confirmed (alpha >= 1). */
  confirm(): boolean {
    if (this.alpha >= 1) return true;
    this.alpha = Math.fround(0.99);
    return false;
  }

  private frame(sfx: boolean): CountUpFrame {
    const eased = Math.min(1, Math.max(0, evalCurve(COUNT_UP_CURVE, this.alpha)));
    const f = (v: number): number => Math.floor(v * eased + 1e-9);
    const t = this.targets;
    const done = this.alpha >= 1;
    const finishedNow = done && !this.finished;
    if (done) this.finished = true;
    return {
      alpha: this.alpha,
      eased,
      values: {
        score: f(t.score), coins: f(t.coins), gems: f(t.gems), wavesCleared: f(t.wavesCleared),
        interest: f(t.interest), clearBonus: f(t.clearBonus), chibisRemaining: f(t.chibisRemaining),
      },
      playCountSfx: sfx,
      finishedNow,
      done,
    };
  }
}
