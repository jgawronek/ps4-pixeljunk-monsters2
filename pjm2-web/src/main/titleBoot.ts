// src/main/titleBoot.ts
// Glue between game.ts and the title flow (kept out of game.ts on purpose).
//   boot  -> (critical assets ready) -> title -> [options|credits] -> stageSelect -> stageLoading
// `stageLoading` is owned by game.ts (in-page stage sessions: src/main/stageSession.ts).
// `?notitle` restores the old direct START button (probes keep working).

import type { AudioManager } from '../view/audio/AudioManager';
import type { SaveData } from '../view/save/SaveData';
import type { UiAssets } from '../view/ui/UiAssets';
import type { StringLookup } from '../view/ui/WaveCalls';
import { flow } from './flow';
import { applyPreferences } from './preferences';
import { TitleHost } from './titleFlow';

export interface TitleBootCtx {
  assets: UiAssets;
  t: StringLookup;
  save: SaveData | null;
  getAudio: () => AudioManager | null;
  /** Create the shared AudioManager (once) and unlock it; must run inside a user gesture. */
  makeAudio: () => AudioManager | null;
  /** Legacy (unused since the in-page stage switch): game.ts now owns `stageLoading` itself. */
  startStage?: () => void;
  isStarted?: () => boolean;
  /** The old loading overlay (#loading): kept as a transparent click-through shell. */
  loadingEl: HTMLElement;
}

export const titleDisabled = (): boolean => new URLSearchParams(window.location.search).has('notitle');

const STYLE_ID = 'pjm2-title-style';

function setTitleChrome(on: boolean): void {
  let st = document.getElementById(STYLE_ID);
  if (st === null) {
    st = document.createElement('style');
    st.id = STYLE_ID;
    // The dev panels (#hud/#wave/#perf/#help/#msg) must not show over the title / option menu.
    st.textContent = 'body.pjm2-title #hud, body.pjm2-title #wave, body.pjm2-title #perf, body.pjm2-title #help, body.pjm2-title #msg { display: none !important; }';
    document.head.appendChild(st);
  }
  document.body.classList.toggle('pjm2-title', on);
}

/** Wire the legacy START button into the flow (so intro/playing subscribers fire in ?notitle mode too). */
export function bindLegacyStart(startButton: HTMLElement, isStarted: () => boolean): void {
  startButton.addEventListener('click', () => {
    if (!isStarted()) return;
    // A programmatic START while the title is up (probes, ?notitle-less automation) skips the menus.
    if (flow.state === 'options' || flow.state === 'credits') flow.go('title');
    if (flow.state !== 'boot' && flow.state !== 'title') return;
    flow.go('stageLoading');
    flow.complete('stageLoading');
  });
}

export async function bootTitle(ctx: TitleBootCtx): Promise<TitleHost | null> {
  let titleUi: { credits: never };
  try {
    titleUi = (await (await fetch('/assets/ui/title-ui.json')).json()) as { credits: never };
  } catch (err) {
    console.warn('title UI data unavailable — falling back to the START button:', err);
    return null;
  }
  // Restore the loading shell: transparent + click-through so the title/3D scene shows through.
  for (const c of Array.from(ctx.loadingEl.children)) (c as HTMLElement).style.display = 'none';
  ctx.loadingEl.style.background = 'transparent';
  ctx.loadingEl.style.pointerEvents = 'none';
  ctx.loadingEl.style.zIndex = '1';
  setTitleChrome(true);

  const host = new TitleHost({
    assets: ctx.assets,
    t: ctx.t,
    titleUi,
    save: ctx.save,
    flow,
    audio: ctx.getAudio,
    ensureAudio: () => {
      const a = ctx.makeAudio();
      if (a !== null && ctx.save !== null) applyPreferences(a, ctx.save.preferences);
      return a;
    },
    audioRunning: () => ctx.getAudio() !== null || (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === true,
  });
  // `stageLoading` is owned by game.ts (loads/starts the stage in-page, then flow.complete); the title only hides its chrome.
  flow.onEnter('stageLoading', () => { setTitleChrome(false); });
  flow.onEnter('title', () => { setTitleChrome(true); });
  (window as unknown as { __pjm2Flow?: typeof flow; __pjm2Title?: TitleHost }).__pjm2Flow = flow; // probes
  (window as unknown as { __pjm2Title?: TitleHost }).__pjm2Title = host;
  host.start();
  return host;
}
