// src/view/ui/WaveCalls.ts
// Full-screen "calls" of the original: wave-start / wave-clear banner
// (Q4.StartCallMenuController, prefab start_call_01), the 3-2-1 start
// countdown (Q4.StartCountdownController, prefab start_countdown_01) and the
// stage-clear call (prefab clear_call_01 / Q4.StageClearMenuController).
//
// EVIDENCE (decomp/decompiled, docs/GAME_UI_ANALYSIS.md section 4):
//  * StartCallMenuController.Show @00528340 (waveIndex, lastWave):
//      shown = waveIndex; if (!m_showWaveStartCall(=0 in the prefab) && waveIndex==1) shown = 0;
//      title    = waveTextPrefix("tl_wave_call_") + shown.ToString("D2")
//                 -> tl_wave_call_00 "WAVE START" for the FIRST wave, else "WAVE N";
//      subtitle = lastWave ? finalWaveStartText (tl_wave_call_accent_03 "Last push!")
//                 : shown==0 ? firstWaveStartText (accent_01 "Here they come!")
//                 : normalWaveStartText (accent_02 "More incoming!");
//      hide time = Time.time + showDurationInSeconds (prefab: 4.0).
//  * ShowWaveClear @005276b0 (waveIndex): subtitle accent_04 "You made it!",
//      title prefix + D2(waveIndex); hide time = Time.time + waveClearShowDurationInSeconds (3.0).
//  * StageMain.OnWaveActivate @00527160 triggers the start call from
//    Events.waveActivateEvent (coroutine DelayedWaveStartMenuShow, lastWave =
//    waveProgressList.Count == waveIndex+1); StageMain.OnWaveEnded @00527570
//    plays WaveClearBonus and calls ShowWaveClear unless it was the last wave.
//  * Layout (prefab numbers, 1920x1080 reference, y down):
//      start_call_01: accent Font_01 @ (968,367) colour (0.88) outline black;
//                     title  Font_02 @ (960,490) white (atlas colours).
//      start_countdown_01: digits Font_02 @ (960,490).
//      clear_call_01: area Font_01 @ (968,304); stage Font_02 @ (960,433);
//                     "CLEAR" Font_02 @ (960,587); difficulty Font_01 @ (968,722).
//  * The in/out animation curves live in AnimationClips (ShowStageStart_01 /
//    HideStageStart_01 / toHideStageStart_01) and were NOT decoded; callEnvelope()
//    is a documented approximation (pop-in 0.3s, hold, fade-out 0.4s).
//  * Countdown digit: StartCountdownController.UpdateCountdown @00534630:
//    index = Clamp(3 - (int)(timeRemain + 1.0), 0, 3) selects the Animator bool
//    "1"/"2"/"3" (rodata b7ceec = 1.0); sfx LobbyCountDown, LobbyCountDownLast.

import type { UiAssets } from './UiAssets';
import { css, place, REF_H, TEXT, textEl, UiRoot } from './UiDom';

export const START_CALL_SECONDS = 4.0; // start_call_01 showDurationInSeconds
export const CLEAR_CALL_SECONDS = 3.0; // waveClearShowDurationInSeconds
export const STAGE_CLEAR_DELAY = 5.0; // globalsettings GameInfoController.m_stageClearDelay
export const GAME_OVER_DELAY = 6.0;
/** Settled on-screen y of the call (prefab Mess_Loc_Call/Start rest at 367/490, the Animator
 *  clip moves them; the reference screenshot 19.09.09 shows the settled pose at ~415/560). */
export const CALL_SUBTITLE_Y = 413;
export const CALL_TITLE_Y = 560; // GameInfoController.m_gameOverDelay

export type StringLookup = (key: string, fallback: string) => string;

const d2 = (n: number): string => Math.max(0, n | 0).toString().padStart(2, '0');

export interface CallText {
  title: string;
  subtitle: string;
}

/** StartCallMenuController.Show. `waveNumber` is 1-based. */
export function waveStartCall(t: StringLookup, waveNumber: number, lastWave: boolean, showWaveStartCall = false): CallText {
  const shown = !showWaveStartCall && waveNumber === 1 ? 0 : waveNumber;
  const title = t(`tl_wave_call_${d2(shown)}`, shown === 0 ? 'WAVE START' : `WAVE ${shown}`);
  const subtitle = lastWave
    ? t('tl_wave_call_accent_03', 'Last push!')
    : shown === 0
      ? t('tl_wave_call_accent_01', 'Here they come!')
      : t('tl_wave_call_accent_02', 'More incoming!');
  return { title, subtitle };
}

/** StartCallMenuController.ShowWaveClear. */
export function waveClearCall(t: StringLookup, waveNumber: number): CallText {
  return {
    title: t(`tl_wave_call_${d2(waveNumber)}`, `WAVE ${waveNumber}`),
    subtitle: t('tl_wave_call_accent_04', 'You made it!'),
  };
}

/** 3,2,1 digit for the remaining pre-wave time; 0 = hidden. */
export function countdownDigit(remaining: number): number {
  if (!(remaining > 0) || remaining > 3) return 0;
  return Math.min(3, Math.ceil(remaining));
}

/** Pop-in / hold / fade-out envelope (APPROXIMATION of the clip curves). */
export function callEnvelope(elapsed: number, total: number): { alpha: number; scale: number } {
  const IN = 0.3;
  const OUT = 0.4;
  if (elapsed < 0 || elapsed > total) return { alpha: 0, scale: 1 };
  if (elapsed < IN) {
    const k = elapsed / IN;
    // ease-out-back pop: 1.5 -> 1.0 with slight overshoot
    const e = 1 - Math.pow(1 - k, 3);
    return { alpha: Math.min(1, k * 1.6), scale: 1.5 - 0.5 * e - 0.08 * Math.sin(k * Math.PI) };
  }
  if (elapsed > total - OUT) {
    const k = (total - elapsed) / OUT;
    return { alpha: k, scale: 0.9 + 0.1 * k };
  }
  return { alpha: 1, scale: 1 };
}

interface ActiveCall {
  root: HTMLElement;
  t: number;
  total: number;
}

export class WaveCallsUi {
  private readonly rootUi: UiRoot;
  private readonly layer: HTMLDivElement;
  private calls: ActiveCall[] = [];
  private countdown: { digit: number; el: HTMLElement } | null = null;

  constructor(private readonly assets: UiAssets, rootUi?: UiRoot) {
    this.rootUi = rootUi ?? new UiRoot(18);
    this.layer = document.createElement('div');
    css(this.layer, { position: 'absolute', left: '0', top: '0', width: '1920px', height: `${REF_H}px`, pointerEvents: 'none' });
    this.rootUi.el.appendChild(this.layer);
  }

  /** Stage teardown: remove the root element + its resize listener. */
  dispose(): void {
    this.rootUi.detach();
  }

  attach(container: HTMLElement = document.body): void {
    if (!this.rootUi.el.isConnected) this.rootUi.attach(container);
  }

  /** Wood-lettered title (Font_02) + white subtitle (Font_01). */
  private wood(text: string, y: number, scale = 1): HTMLElement {
    const el = textEl(this.assets, 'Font_02', text, { scale, tracking: -15, px: 150 * scale });
    place(el, 960, y);
    return el;
  }
  private body(text: string, x: number, y: number, scale = 1): HTMLElement {
    const el = textEl(this.assets, 'Font_01', text, { scale, tracking: -6, tint: TEXT.body.tint, outline: TEXT.body.outline, px: 52 * scale });
    place(el, x, y);
    return el;
  }

  private push(children: HTMLElement[], total: number): void {
    const root = document.createElement('div');
    css(root, { position: 'absolute', left: '0', top: '0', width: '1920px', height: `${REF_H}px`, transformOrigin: '960px 540px', pointerEvents: 'none' });
    for (const c of children) root.appendChild(c);
    this.layer.appendChild(root);
    this.calls.push({ root, t: 0, total });
  }

  /** start_call_01 (also used for the wave clear call with its own copy). */
  showCall(c: CallText, seconds: number): void {
    this.clear();
    this.push([this.body(c.subtitle, 968, CALL_SUBTITLE_Y), this.wood(c.title, CALL_TITLE_Y)], seconds);
  }

  /** clear_call_01: area / stage / CLEAR / difficulty (StageClearMenuController). */
  showStageClear(area: string, stage: string, clear: string, difficulty: string, seconds: number): void {
    this.clear();
    this.push(
      [this.body(area, 968, 304), this.wood(stage, 433), this.wood(clear, 587), this.body(difficulty, 968, 722)],
      seconds,
    );
  }

  /** Show / hide the 3-2-1 digit (start_countdown_01, Font_02 at (960,490)). */
  setCountdown(digit: number): void {
    if (digit === (this.countdown?.digit ?? 0)) return;
    if (this.countdown !== null) { this.countdown.el.remove(); this.countdown = null; }
    if (digit > 0) {
      const el = this.wood(String(digit), 490);
      this.layer.appendChild(el);
      this.countdown = { digit, el };
    }
  }

  clear(): void {
    for (const c of this.calls) c.root.remove();
    this.calls = [];
  }

  update(dt: number): void {
    for (const c of this.calls) {
      c.t += dt;
      const e = callEnvelope(c.t, c.total);
      c.root.style.opacity = String(e.alpha);
      c.root.style.transform = `scale(${e.scale})`;
    }
    const live: ActiveCall[] = [];
    for (const c of this.calls) {
      if (c.t > c.total) c.root.remove();
      else live.push(c);
    }
    this.calls = live;
    if (this.countdown !== null) {
      // digit pulse: scale 1.35 -> 1 over the second (Animator bool trigger approximation)
      this.countdown.el.style.opacity = '1';
    }
  }

  get active(): boolean {
    return this.calls.length > 0;
  }
}
