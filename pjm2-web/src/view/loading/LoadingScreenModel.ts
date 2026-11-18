// src/view/loading/LoadingScreenModel.ts
// Pure model of the original loading screen (Q4.LoadingScreen + Q4.LoadingTipsMap, prefab `LoadingMenu`, loading_ui bundle).
// Evidence + what is exact/approximate: docs/LOADING_SCREEN_ANALYSIS.md.
//
//  * Animator `loding_screen_ctrl`: In (1.5 s, root alpha cubic -0.593t^3+1.333t^2 -> 1) -> InIdle; DisplayTips bool fades the
//    title + tip text (0.333 s states); OnInIdle=false -> Out (1.0 s, alpha 2t^3-3t^2+1 -> 0, tip text hidden).
//  * LoadingScreen serialized: minTipDisplayTime 1.0, maxTipDisplayTime 12.0, backgroundFadeSpeed 1.0, backgroundScaleSpeedMax 0.
//  * UpdateTips @0046b120: tipTimer(+0x8c) += dt; >= maxTip -> ChangeTips (new tip + new background) and timer = 0.
//  * Hide -> CoroutineHideLoading: waits tipTimer >= minTip, RemoveListeners, DisplayTips=false, OnInIdle=false (-> Out).
//  * LoadingTipsMap.ShuffleTip @0046b360: shuffle bag with a recent-history list.
//  * Background = the tip's own atlas texture (LoadingTipsMap.GetNextBackground @0046c040 matches tip.atlas against the
//    backgrounds' centre-sprite texture name); the new one cross-fades in at backgroundFadeSpeed per second.

import type { LoadingTipRow } from './loadingScreen.generated';

export const LOADING = {
  inTime: 1.5,
  outTime: 1.0,
  /** DisplayTips / OutIdle state length (loding_screen_ctrl) */
  tipFadeTime: 1 / 3,
  minTipDisplayTime: 1.0,
  maxTipDisplayTime: 12.0,
  backgroundFadeSpeed: 1.0,
} as const;

/** Unity cubic segment values read from the In / Out clips (see docs). */
export function inAlpha(t: number): number {
  const x = Math.min(Math.max(t, 0), LOADING.inTime);
  return (-0.593 * x + 1.333) * x * x;
}
export function outAlpha(t: number): number {
  const x = Math.min(Math.max(t, 0), LOADING.outTime);
  return (2 * x - 3) * x * x + 1;
}

/** Q4.LoadingTip.Unlocked: stages / items subset of the save, DLC available, networking tips need networking. */
export interface TipEnv {
  hasStage(id: string): boolean;
  hasItem(id: string): boolean;
  dlcAvailable(dlc: number): boolean;
  networking: boolean;
}
/** Single-player port: everything unlocked in the save is checked by the caller, no DLC, no networking. */
export const OFFLINE_ENV: TipEnv = { hasStage: () => true, hasItem: () => true, dlcAvailable: (d) => d === 0, networking: false };

export function tipUnlocked(tip: LoadingTipRow, env: TipEnv): boolean {
  if (!tip.unlockStages.every((s) => env.hasStage(s))) return false;
  if (!tip.unlockItems.every((s) => env.hasItem(s))) return false;
  if (!env.dlcAvailable(tip.requiredDLC)) return false;
  if (tip.requiresNetworking && !env.networking) return false;
  return true;
}

/** Q4.LoadingTipsMap shuffle state: bag (+0x38 unused unlocked), used (+0x30), history (+0x40). rnd(n) = UnityEngine.Random.Range(0, n). */
export class TipShuffler {
  private bag: LoadingTipRow[];
  private readonly used: LoadingTipRow[] = [];
  private readonly history: LoadingTipRow[] = [];
  constructor(tips: readonly LoadingTipRow[], env: TipEnv, private readonly rnd: (n: number) => number) {
    this.bag = tips.filter((t) => tipUnlocked(t, env));
  }
  get size(): number { return this.bag.length + this.used.length; }
  next(): LoadingTipRow | null {
    const nBag = this.bag.length, nUsed = this.used.length;
    let tip: LoadingTipRow | null = null;
    if (nBag < 1) {
      if (nUsed > 0) {
        let guard = 0;
        do { tip = this.used[this.rnd(nUsed)]; } while (this.history.includes(tip) && ++guard < 1000);
        this.history.push(tip);
      }
    } else {
      const i = this.rnd(nBag);
      tip = this.bag[i];
      this.bag.splice(i, 1);
      this.used.push(tip);
      this.history.push(tip);
    }
    if (this.history.length >= nUsed + nBag) this.history.splice(0, Math.floor((nUsed + nBag) / 2));
    return tip;
  }
}

export type LoadingPhase = 'in' | 'idle' | 'out' | 'done';

export interface LoadingView {
  phase: LoadingPhase;
  rootAlpha: number;
  tipAlpha: number;
  tip: LoadingTipRow | null;
  /** background texture names; `bgPrev` is drawn under `bg` while bgAlpha < 1 */
  bg: string | null;
  bgPrev: string | null;
  bgAlpha: number;
}

export class LoadingScreenModel {
  private phase: LoadingPhase = 'in';
  private t = 0;
  private outT = 0;
  private tipTimer = 0;
  private hideRequested = false;
  private current: LoadingTipRow | null = null;
  private pending: LoadingTipRow | null = null;
  private shownTip: LoadingTipRow | null = null;
  private tipA = 0;
  private tipDir: 1 | -1 = 1;
  private bg: string | null = null;
  private bgPrev: string | null = null;
  private bgA = 1;
  private readonly shuffler: TipShuffler;

  constructor(tips: readonly LoadingTipRow[], rnd: (n: number) => number, env: TipEnv = OFFLINE_ENV) {
    this.shuffler = new TipShuffler(tips, env, rnd);
    this.changeTips(true); // Awake: RefreshUnlocks + ChangeTips(true)
  }

  private changeTips(first: boolean): void {
    const tip = this.shuffler.next();
    if (tip === null) return;
    this.pending = tip;
    this.current = tip;
    if (first) { this.bg = tip.atlas; this.bgPrev = null; this.bgA = 1; }
    else if (tip.atlas !== this.bg) { this.bgPrev = this.bg; this.bg = tip.atlas; this.bgA = 0; }
    if (!first) this.tipDir = -1; // CoroutineChangeTip: DisplayTips=false first
  }

  get hiding(): boolean { return this.hideRequested; }
  get finished(): boolean { return this.phase === 'done'; }

  /** LoadingScreen.Hide */
  hide(): void { this.hideRequested = true; }

  update(dt: number): void {
    if (this.phase === 'done') return;
    this.t += dt;
    this.tipTimer += dt;
    if (this.phase === 'in' && this.t >= LOADING.inTime) this.phase = 'idle';
    if (this.phase === 'idle' && this.hideRequested && this.tipTimer >= LOADING.minTipDisplayTime) {
      this.phase = 'out'; // OnInIdle=false: InIdle -> Out (starts next frame)
      this.outT = 0;
      return;
    }
    if (this.phase === 'out') {
      this.outT += dt;
      if (this.outT >= LOADING.outTime) this.phase = 'done';
      return;
    }
    if (this.phase === 'idle' && !this.hideRequested) {
      if (this.tipTimer >= LOADING.maxTipDisplayTime) { this.changeTips(false); this.tipTimer = 0; }
      // tip text: fade out the old one, swap, fade in (DisplayTips bool)
      const step = dt / LOADING.tipFadeTime;
      if (this.tipDir === -1) {
        this.tipA = Math.max(0, this.tipA - step);
        if (this.tipA <= 0) { this.shownTip = this.pending; this.tipDir = 1; }
      } else {
        if (this.shownTip !== this.pending && this.tipA <= 0) this.shownTip = this.pending;
        this.tipA = Math.min(1, this.tipA + step);
      }
    }
    if (this.bgPrev !== null) {
      this.bgA = Math.min(1, this.bgA + dt * LOADING.backgroundFadeSpeed);
      if (this.bgA >= 1) this.bgPrev = null;
    }
  }

  view(): LoadingView {
    const rootAlpha = this.phase === 'in' ? inAlpha(this.t) : this.phase === 'idle' ? 1 : this.phase === 'out' ? outAlpha(this.outT) : 0;
    const tipAlpha = this.phase === 'idle' || this.phase === 'in' ? (this.phase === 'in' ? 0 : this.tipA) : 0;
    return { phase: this.phase, rootAlpha, tipAlpha, tip: this.shownTip, bg: this.bg, bgPrev: this.bgPrev, bgAlpha: this.bgA };
  }
}
