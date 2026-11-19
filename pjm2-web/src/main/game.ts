// src/main/game.ts
// PERSISTENT SHELL of the playable game (game.html). Bootstrap + glue only; everything that belongs to ONE
// stage (stage view, sim world, views/systems, UI bound to the sim, key handlers, debug hooks) lives in
// src/main/stageSession.ts (`createStageSession()` / `session.dispose()`), so the page can run
//   title -> stage select -> loading -> intro -> play -> results -> stage select / next / retry
// without navigating. Architecture, lifecycle and the disposal checklist: docs/STAGE_SESSION_ARCHITECTURE.md.
//
// SHELL-OWNED (lives for the whole page): WebGLRenderer + canvas, shared AudioManager, SaveData, asset cache,
// UiAssets + string table, flow state machine glue, title / options / credits (TitleHost), stage select
// (StageSelectFeature), loading overlay, dev panels, the rAF loop, window.__pjm2 (-> current session).
//
// URL flags (unchanged meaning): ?stage=N ?diff=D ?notitle ?nointro ?nograde ?noui ?nopacks ?lazytex ?lazytowers ?lite.

import * as THREE from 'three';

import { nextStage, stageByNumber, stageByScene, stageFromSearch } from '../data/stageCatalog';
import { difficultyFromSearch } from './stageUrls';
import { createWebAudioManager, type AudioManager } from '../view/audio/AudioManager';
import { createBrowserAssetCache } from '../view/cache/AssetCache';
import { initPacks } from '../view/pack/bootPacks';
import { createBrowserSaveData } from '../view/save/SaveData';
import { loadUiAssets } from '../view/ui/UiAssets';
import { LoadingScreenUi } from '../view/loading/LoadingScreenUi';
import { loadStrings, t } from '../view/ui/UiText';
import { simGlobalCounters } from './simReset';
import { flow, type FlowContext } from './flow';
import { bootTitle, titleDisabled } from './titleBoot';
import { StageSelectFeature } from './stageSelectFeature';
import { installListenerAudit, listenerAudit } from './listenerAudit';
import { installTextureAudit, textureAuditSummary } from './textureAudit';
import { createStageSession, type ExitKind, type ShellServices, type StageSession } from './stageSession';
import { createHubSession, type HubMode, type HubSession } from './hubSession';

installListenerAudit();
if (new URLSearchParams(window.location.search).has('texaudit')) installTextureAudit();

// Asset packs: patch fetch + start the pack downloads BEFORE any other module-level work
// (WebGLRenderer creation below can block the main thread for seconds on software GL).
initPacks();

// ---- DOM ---------------------------------------------------------------------

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const waveHud = document.getElementById('wave')!;
const perfHud = document.getElementById('perf')!;
const msgHud = document.getElementById('msg')!;
const loading = document.getElementById('loading')!;
const loadingBar = document.getElementById('loading-bar') as HTMLElement;
const loadingText = document.getElementById('loading-text')!;
const startButton = document.getElementById('start') as HTMLButtonElement;

let msgTimer = 0;
function flash(text: string, seconds = 2.2): void {
  msgHud.textContent = text;
  msgHud.style.opacity = '1';
  msgTimer = seconds;
}

// ---- persistent renderer ------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// ?lite: debug/verification mode for software-GL environments (no shadows).
const LITE = new URLSearchParams(window.location.search).has('lite');
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
listenerAudit.watchCanvas(renderer.domElement);

// ---- shell state ----------------------------------------------------------------

const save = createBrowserSaveData(); // Phase-4 persistence (best-effort localStorage)
const assetCache = createBrowserAssetCache(); // shared Cache-API bucket (repeat loads = zero RTT)
const uiAssetsLoad = loadUiAssets('/assets/ui/');
const stringsLoad = loadStrings('/assets/ui/');
uiAssetsLoad.catch(() => { /* handled where awaited */ });
stringsLoad.catch(() => { /* handled where awaited */ });

let audio: AudioManager | null = null;
/** The one live stage (or the title backdrop = a loaded, not-yet-started session). */
let session: StageSession | null = null;
let buildToken = 0;
/** Resolves when the last requested stage switch finished loading + started (probes / switchStage()). */
let stageLoadPromise: Promise<boolean> = Promise.resolve(true);
let stageSelectFeature: StageSelectFeature | null = null;

// ---- hub (walkable world map = title backdrop + stage select; src/main/hubSession.ts, docs/HUB_AND_TITLE_ANALYSIS.md) ----
// The hub is used unless `?notitle` / `?stage=N` / `?grid` (explicit stage / grid-cursor request) -- `?hub` forces it -- or it fails to load
// (then the old stage-1 backdrop + grid cursor stay).
const urlQuery = new URLSearchParams(window.location.search);
let hubWanted = urlQuery.has('hub') || (!titleDisabled() && !urlQuery.has('stage') && !urlQuery.has('grid') && !urlQuery.has('nohub'));
let hub: HubSession | null = null;
let hubBuild: Promise<HubSession | null> | null = null;
let stringTable: Record<string, string> = {};

const initialStage = stageFromSearch(window.location.search);
const initialDifficulty = difficultyFromSearch(window.location.search) as 0 | 1 | 2;

// ---- loading overlay ---------------------------------------------------------------

/** Original loading screen (Q4.LoadingScreen: background + tips); created lazily once the UI assets are available. */
let loadingUi: LoadingScreenUi | null = null;
let bootLoading = true; // the first load (hub + title assets) also shows the original loading screen instead of the bare black bar
void uiAssetsLoad.then((a) => { loadingUi = new LoadingScreenUi(a, (k, f) => (stringTable[k] !== undefined && stringTable[k] !== '' ? stringTable[k] : f)); if (bootLoading) showLoading(loadingText.textContent ?? 'loading …'); }).catch(() => { /* plain overlay */ });
/** Dev progress overlay shown over the picture: bar + text hugging the bottom edge, no opaque backdrop. */
function styleLoadingOverImage(on: boolean): void {
  loading.style.background = on ? 'transparent' : '#0a0e12';
  loading.style.justifyContent = on ? 'flex-end' : 'center';
  loading.style.paddingBottom = on ? '28px' : '0';
  loading.style.boxSizing = 'border-box';
  loading.style.zIndex = on ? '41' : '30';
  const first = loading.firstElementChild as HTMLElement | null;
  if (first !== null) first.style.display = on ? 'none' : '';
}

function showLoading(label: string): void {
  loading.style.display = 'flex';
  loading.style.background = '#0a0e12';
  loading.style.pointerEvents = '';
  loading.style.zIndex = '30';
  for (const c of Array.from(loading.children)) (c as HTMLElement).style.display = '';
  startButton.style.display = 'none';
  loadingBar.style.width = '0%';
  loadingText.textContent = label;
  if (loadingUi !== null) {
    if (!loadingUi.active || loadingUi.hiding) loadingUi.show();
    styleLoadingOverImage(true);
    for (const c of Array.from(loading.children)) if (c !== loading.firstElementChild && (c as HTMLElement).id !== 'loading-track' && (c as HTMLElement).id !== 'loading-text') (c as HTMLElement).style.display = 'none';
    loading.firstElementChild && ((loading.firstElementChild as HTMLElement).style.display = 'none');
  } else styleLoadingOverImage(false);
}

function hideLoading(): void {
  if (loadingUi !== null && loadingUi.active) {
    // keep the dev bar out of the fade; the picture fades itself (>= 1 s on screen, then the 1 s Out clip)
    loading.style.display = 'none';
    loadingUi.hide();
    return;
  }
  loading.style.display = 'none';
}

async function buildHub(): Promise<HubSession | null> {
  if (hub !== null && !hub.disposed) return hub;
  if (hubBuild !== null) return hubBuild;
  hubBuild = (async () => {
    try {
      disposeSession();
      const h = await createHubSession({
        renderer, save, assetCache, getAudio: () => audio,
        progress: (pct, text) => { if (pct !== null) loadingBar.style.width = `${pct.toFixed(1)}%`; loadingText.textContent = text; },
        t: (k, f) => (stringTable[k] !== undefined && stringTable[k] !== '' ? stringTable[k] : f),
      });
      hub = h;
      stageSelectFeature?.screen.setHubTarget(null, null, null); // fresh session: clear the previous panel state
      h.onState((st) => { stageSelectFeature?.screen.setHubTarget(st.portalStage, st.areaKey, st.message); });
      return h;
    } catch (err) {
      console.warn('hub failed to load -> grid-cursor stage select + stage backdrop', err);
      hubWanted = false;
      stageSelectFeature?.screen.setHubMode(false);
      return null;
    } finally {
      hubBuild = null;
    }
  })();
  return hubBuild;
}

function disposeHub(): void {
  if (hub === null) return;
  const h = hub;
  hub = null;
  h.dispose();
}

/** flow state -> hub camera/mode (title/options: title camera; credits: dancing tikiman; stage select: walkable map). */
async function syncHub(mode: HubMode): Promise<void> {
  if (!hubWanted) return;
  const had = hub !== null;
  if (!had) showLoading('hub …');
  const h = await buildHub();
  if (!had) hideLoading();
  h?.setMode(mode);
}

const services: ShellServices = {
  renderer,
  app,
  save,
  assetCache,
  uiAssets: uiAssetsLoad,
  strings: stringsLoad,
  getAudio: () => audio,
  ensureAudio: () => {
    audio ??= createWebAudioManager(); // may already exist (title screen created it on the first gesture)
    void audio.unlock();
    return audio;
  },
  flash,
  progress: (pct, text) => {
    if (pct !== null) loadingBar.style.width = `${pct.toFixed(1)}%`;
    loadingText.textContent = text;
  },
  panels: { hud, wave: waveHud, perf: perfHud },
  exit: (kind) => exitStage(kind),
  outcome: (kind) => { flow.go('results', { outcome: kind }); },
};

// ---- session lifecycle -----------------------------------------------------------------

function disposeSession(): void {
  if (session === null) return;
  const s = session;
  session = null;
  s.dispose();
  perfHud.textContent = '';
}

/** Dispose the current session, then build stage `n`. A newer request cancels an older in-flight build. */
async function buildSession(n: number, difficulty: 0 | 1 | 2): Promise<StageSession> {
  const entry = stageByNumber(n);
  if (entry === undefined) throw new Error(`unknown stage ${n}`);
  const token = ++buildToken;
  disposeSession(); // free the previous stage's GPU/CPU resources BEFORE loading the next one
  const s = await createStageSession(services, { stage: entry, difficulty });
  if (token !== buildToken) { s.dispose(); throw new Error('stage load superseded'); }
  session = s;
  return s;
}

/** flow `stageLoading` (owned here): make sure the requested stage is loaded, start it, complete the state. */
function enterStageLoading(ctx: FlowContext): void {
  const wantStage = typeof ctx.stage === 'number'
    ? ctx.stage
    : (typeof ctx.stageId === 'string' ? stageByScene(ctx.stageId)?.stage : undefined) ?? session?.stage ?? initialStage.stage;
  const wantDiff = (typeof ctx.difficulty === 'number' ? ctx.difficulty : session?.difficulty ?? initialDifficulty) as 0 | 1 | 2;
  const reusable = session !== null && !session.started && !session.disposed && session.stage === wantStage && session.difficulty === wantDiff;
  const startAndComplete = (s: StageSession): boolean => {
    if (flow.state !== 'stageLoading') return false; // user moved on (e.g. back to title) while loading
    hideLoading();
    setUrl(s.stage, s.difficulty);
    s.start();
    flow.complete('stageLoading');
    return true;
  };
  if (reusable) { // title backdrop / ?notitle START: already loaded -> synchronous (probes click START and read state at once)
    stageLoadPromise = Promise.resolve(startAndComplete(session!));
    return;
  }
  const entry = stageByNumber(wantStage);
  showLoading(`stage-${wantStage} …`);
  disposeHub(); // the world map is rebuilt when the player comes back to stage select / title
  stageLoadPromise = buildSession(wantStage, wantDiff).then(
    (s) => startAndComplete(s),
    (err: unknown) => {
      if (err instanceof Error && err.message === 'stage load superseded') return false;
      console.error(err);
      loadingText.textContent = `LOAD FAILED: ${err}`;
      void entry;
      return false;
    },
  );
}

/** Result-screen / pause-menu exits -> flow transitions (no navigation). */
function exitStage(kind: ExitKind): void {
  const s = session;
  if (s === null) return;
  if (kind === 'stageSelect') { flow.go('stageSelect', { from: 'results' }); return; }
  if (kind === 'retry') {
    flow.go('stageLoading', { stage: s.stage, stageId: s.stageId, difficulty: s.difficulty, retry: true });
    return;
  }
  const nx = nextStage(s.stage);
  if (nx !== null) flow.go('stageLoading', { stage: nx.stage, stageId: nx.scene, difficulty: s.difficulty, from: 'results' });
}

/** `history.replaceState` of ?stage=&diff= (cosmetic: reload re-enters the same stage; other flags kept). */
function setUrl(stage: number, difficulty: number): void {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('stage', String(stage));
    u.searchParams.set('diff', String(difficulty));
    window.history.replaceState(null, '', u);
  } catch { /* cosmetic */ }
}

flow.onEnter('stageLoading', (ctx) => { enterStageLoading(ctx); });
// Leaving a played stage for a menu frees it; the title backdrop (loaded, not started) survives title -> select.
flow.onEnter('stageSelect', () => { if (session?.started === true) disposeSession(); void syncHub('select'); });
flow.onEnter('title', () => { if (session?.started === true) disposeSession(); void syncHub('title'); });
flow.onEnter('credits', () => { void syncHub('credits'); });
flow.onEnter('options', () => { void syncHub('title'); });

// ---- main loop ---------------------------------------------------------------------------

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (msgTimer > 0) {
    msgTimer -= 1 / 60;
    if (msgTimer <= 0) msgHud.style.opacity = '0';
  }
  const s = session;
  if (s !== null && !s.disposed) {
    s.frame(now);
  } else if (hub !== null && !hub.disposed) {
    hub.frame(now);
  } else {
    renderer.setClearColor(0x0b1c14);
    renderer.clear();
  }
}

window.addEventListener('resize', () => {
  session?.resize(window.innerWidth / window.innerHeight);
  hub?.resize(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- boot --------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  const hubLoaded = hubWanted ? await buildHub() : null;
  if (hubLoaded === null) await buildSession(initialStage.stage, initialDifficulty);
  const assets = await uiAssetsLoad.catch(() => null);
  const strings = await stringsLoad.catch(() => ({}));
  stringTable = strings as Record<string, string>;
  const tt = (k: string, f: string): string => t(strings, k, f);

  // Stage select (flow `stageSelect` owner): a pick goes through flow -> `stageLoading` above (no navigation).
  if (assets !== null) {
    stageSelectFeature = new StageSelectFeature({
      assets, save, t: tt,
      launchStage: () => { /* flow.go('stageLoading') (done by the feature) is the whole launch */ },
      onExit: () => { flow.go('title'); },
    });
    stageSelectFeature.attach(document.body);
    stageSelectFeature.screen.setHubMode(hubWanted);
  }

  // Title screen (Q4.TitleScreenController port) replaces the bare START button; `?notitle` keeps the old path.
  if (!titleDisabled() && assets !== null) {
    const booted = await bootTitle({
      assets,
      t: tt,
      save,
      getAudio: () => audio,
      makeAudio: () => services.ensureAudio(),
      loadingEl: loading,
      isBlocked: () => {
        const loadingUp = bootLoading || (loadingUi?.active ?? false);
        // Loading screen gone -> the hub's first-show intro starts (closeup -> camera switch -> hut + tikiman entrance); the title UI (logo, jingle)
        // waits for it (TitleScreenController.StartIntroAnimation waits for the player's TitleIdle).
        if (!loadingUp) hub?.beginIntro();
        return loadingUp || (hub !== null && !hub.disposed && hub.introPending);
      },
    });
    if (booted === null) startButton.style.display = 'block';
  } else startButton.style.display = 'block';
  bootLoading = false;
  hideLoading(); // first load done: the loading screen fades out, then the title intro starts (isBlocked)
}

// Legacy START button (?notitle / title UI unavailable; probes click it programmatically).
startButton.addEventListener('click', () => {
  if (session === null || session.started) return;
  // A programmatic START while a menu is up skips the menus.
  if (flow.state === 'options' || flow.state === 'credits') flow.go('title');
  if (flow.state !== 'boot' && flow.state !== 'title' && flow.state !== 'stageSelect') return;
  flow.go('stageLoading', { stage: session.stage, stageId: session.stageId, difficulty: session.difficulty });
});

// ---- debug / verification handle (harmless in production; used by .work probes) ------------------------
// `window.__pjm2.<hook>` resolves against the CURRENT session's debug object; the shell adds a few of its own.

const shellDebug: Record<string, unknown> = {
  flow,
  /** The hub (world map) session's debug hooks (hubState, hubTeleportToPortal, hubSetMode, ...) or null. */
  hub: () => (hub === null ? null : hub.debug),
  /** Current session summary (null while between stages). */
  session: () => (session === null ? null : { stageId: session.stageId, stage: session.stage, difficulty: session.difficulty, started: session.started, disposed: session.disposed }),
  /** In-page stage switch through the flow (same path as stage select / results exits). Resolves true once started. */
  switchStage: (n: number, difficulty?: number): Promise<boolean> => {
    const ok = flow.go('stageLoading', { stage: n, stageId: stageByNumber(n)?.scene, difficulty: difficulty ?? session?.difficulty ?? initialDifficulty });
    return ok ? stageLoadPromise : Promise.resolve(false);
  },
  /** Results-screen exits without clicking UI. */
  exit: (kind: ExitKind) => { exitStage(kind); },
  /** Disposal audit snapshot: GPU/CPU/DOM/listener counters (docs/STAGE_SESSION_ARCHITECTURE.md). */
  audit: () => ({
    flow: flow.state,
    stage: session?.stage ?? null,
    memory: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    programs: renderer.info.programs?.length ?? 0,
    sim: simGlobalCounters(),
    audioLoops: audio?.loopCount ?? 0,
    audioBgm: audio?.currentBgm ?? null,
    bodyChildren: document.body.children.length,
    canvases: document.querySelectorAll('canvas').length,
    listeners: listenerAudit.snapshot(),
    session: session?.counters() ?? null,
  }),
  /** ?texaudit only: GPU-resident textures grouped by signature (names the owners of leaked textures). */
  textureAudit: () => textureAuditSummary(),
  state: () => ({ started: false, outcome: null, paused: false, resultsVisible: false, flow: flow.state }),
};

(window as unknown as Record<string, unknown>).__pjm2 = new Proxy({} as Record<string, unknown>, {
  get(_t, key: string) {
    const d = session?.debug;
    if (d !== undefined && key in d) return d[key];
    const hd = hub?.debug;
    if (hd !== undefined && key in hd) return hd[key];
    return shellDebug[key];
  },
  has(_t, key: string) {
    return (session?.debug !== undefined && key in session.debug) || (hub?.debug !== undefined && key in hub.debug) || key in shellDebug;
  },
});
(window as unknown as { __pjm2Flow?: typeof flow }).__pjm2Flow = flow; // probes (title agent contract)

boot().catch((err) => {
  loadingText.textContent = `LOAD FAILED: ${err}`;
  console.error(err);
});
requestAnimationFrame(loop);
