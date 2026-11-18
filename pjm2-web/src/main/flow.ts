// src/main/flow.ts
// Game FLOW state machine shared by the title / stage-select / stage-intro work.
// Pure TypeScript (no DOM, no three.js) so every agent can unit-test against it.
//
// ORIGINAL (Q4 UI controllers): the game is a stack of UIController screens over the
// "home" scene. Title (Q4.TitleScreenController) -> Play -> OnPlayHideComplete ->
// StageSelectController.Show -> stage start -> (StartIntroAnimation / chibi run intro)
// -> gameplay -> result menu -> stage select / title. Options and credits are children
// of the title. See docs/TITLE_OPTIONS_CREDITS_ANALYSIS.md.
//
// STATES
//   boot          page loaded, critical assets still streaming (no UI yet)
//   title         title screen ("Press any button" then Play / Options / Credits)
//   options       Q4.OptionMenuController over the title (returns to `title`)
//   credits       Q4.StaffCreditsController roll (returns to `title`)
//   stageSelect   stage-select map (owned by the stage-select agent)
//   stageLoading  stage assets/world being built; game.ts owns this state
//   intro         camera fly-in + chibi run intro (owned by the stage-intro agent)
//   playing       gameplay (sim ticking)
//   results       clear / game-over screens; leaves to stageSelect or title
//
// API (stable; extend, do not rename)
//   flow.state                  current FlowState
//   flow.ctx                    { stageId?, difficulty?, from?, ... } payload of the last go()
//   flow.go(next, ctx?)         request a transition; returns false (and does nothing) if the
//                               edge is not in EDGES. Listeners run synchronously.
//   flow.onEnter(state, cb)     subscribe; returns an unsubscribe fn. cb(ctx, prev).
//   flow.onLeave(state, cb)     same for leaving.
//   flow.onAny(cb)              every transition: cb(next, prev, ctx).
//   flow.claim(state)           an owner declares it handles `state`; returns a release fn.
//                               UNCLAIMED pass-through states (stageSelect, intro) auto-complete
//                               to their default successor so the flow never stalls while a
//                               feature is not merged yet.
//   flow.complete(state)        owner says "done with `state`": go(DEFAULT_NEXT[state], ctx).
//                               No-op if `state` is not current.
//   flow.isClaimed(state)
//
// DEFAULT_NEXT: title has none (Play is explicit); stageSelect -> stageLoading;
//   stageLoading -> intro; intro -> playing.
// Title hand-off contract: TitleFeature calls flow.go('stageSelect', { from: 'title' }).
//   - stage-select agent: flow.claim('stageSelect'); on pick call
//       flow.go('stageLoading', { stageId, difficulty })  (or flow.complete('stageSelect')).
//   - game.ts: owns 'stageLoading' (starts the stage), then flow.complete('stageLoading').
//   - stage-intro agent: flow.claim('intro'); when the fly-in/run intro is over
//       flow.complete('intro') -> 'playing'.
//   - results agent/glue: flow.go('results') on clear/game over; flow.go('stageSelect'|'title').

export type FlowState =
  | 'boot'
  | 'title'
  | 'options'
  | 'credits'
  | 'stageSelect'
  | 'stageLoading'
  | 'intro'
  | 'playing'
  | 'results';

export interface FlowContext {
  stageId?: string;
  difficulty?: number;
  from?: FlowState;
  [k: string]: unknown;
}

export const FLOW_STATES: readonly FlowState[] = [
  'boot', 'title', 'options', 'credits', 'stageSelect', 'stageLoading', 'intro', 'playing', 'results',
];

/** Allowed transitions. `playing -> title` / `results -> title` cover "Title Screen" from pause/results. */
export const EDGES: Readonly<Record<FlowState, readonly FlowState[]>> = {
  boot: ['title', 'stageLoading', 'stageSelect'], // stageLoading directly = ?notitle legacy path; stageSelect = stage-select.html entry / results->select
  title: ['options', 'credits', 'stageSelect', 'stageLoading'],
  options: ['title', 'playing'], // playing: pause-menu options return (OptionMenuController is also reachable in game)
  credits: ['title'],
  stageSelect: ['stageLoading', 'title'],
  stageLoading: ['intro', 'playing', 'stageSelect', 'title'],
  intro: ['playing', 'stageSelect', 'title'],
  playing: ['results', 'options', 'stageSelect', 'stageLoading', 'title'], // stageLoading = pause-menu Restart (in-page)
  results: ['stageSelect', 'title', 'stageLoading', 'playing'],
};

export const DEFAULT_NEXT: Readonly<Partial<Record<FlowState, FlowState>>> = {
  stageSelect: 'stageLoading',
  stageLoading: 'intro',
  intro: 'playing',
};

/** States that auto-complete when nobody claimed them (feature not merged / disabled). */
const PASS_THROUGH: ReadonlySet<FlowState> = new Set<FlowState>(['stageSelect', 'intro']);

type EnterCb = (ctx: FlowContext, prev: FlowState) => void;
type AnyCb = (next: FlowState, prev: FlowState, ctx: FlowContext) => void;

export class Flow {
  state: FlowState = 'boot';
  ctx: FlowContext = {};
  private readonly enter = new Map<FlowState, Set<EnterCb>>();
  private readonly leave = new Map<FlowState, Set<EnterCb>>();
  private readonly any = new Set<AnyCb>();
  private readonly claims = new Map<FlowState, number>();
  /** Transition log (bounded) — handy in probes/tests. */
  readonly history: FlowState[] = ['boot'];

  go(next: FlowState, ctx: FlowContext = {}): boolean {
    const prev = this.state;
    if (!EDGES[prev].includes(next)) return false;
    for (const cb of [...(this.leave.get(prev) ?? [])]) cb(ctx, next);
    this.state = next;
    this.ctx = { ...ctx, from: ctx.from ?? prev };
    this.history.push(next);
    if (this.history.length > 64) this.history.shift();
    for (const cb of [...(this.enter.get(next) ?? [])]) {
      if (this.state !== next) return true; // a listener already moved on
      cb(this.ctx, prev);
    }
    for (const cb of [...this.any]) cb(next, prev, this.ctx);
    if (this.state === next && PASS_THROUGH.has(next) && !this.isClaimed(next)) this.complete(next);
    return true;
  }

  complete(state: FlowState): boolean {
    if (this.state !== state) return false;
    const n = DEFAULT_NEXT[state];
    if (n === undefined) return false;
    return this.go(n, { ...this.ctx, from: state });
  }

  onEnter(state: FlowState, cb: EnterCb): () => void {
    return sub(this.enter, state, cb);
  }

  onLeave(state: FlowState, cb: EnterCb): () => void {
    return sub(this.leave, state, cb);
  }

  onAny(cb: AnyCb): () => void {
    this.any.add(cb);
    return () => { this.any.delete(cb); };
  }

  claim(state: FlowState): () => void {
    this.claims.set(state, (this.claims.get(state) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.claims.set(state, (this.claims.get(state) ?? 1) - 1);
    };
  }

  isClaimed(state: FlowState): boolean {
    return (this.claims.get(state) ?? 0) > 0;
  }
}

function sub(map: Map<FlowState, Set<EnterCb>>, state: FlowState, cb: EnterCb): () => void {
  let s = map.get(state);
  if (s === undefined) { s = new Set(); map.set(state, s); }
  s.add(cb);
  return () => { s?.delete(cb); };
}

export function createFlow(): Flow {
  return new Flow();
}

/** Process-wide instance (game.ts + feature modules share it). */
export const flow: Flow = createFlow();
