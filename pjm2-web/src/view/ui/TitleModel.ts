// src/view/ui/TitleModel.ts
// Pure state machine of the title screen (Q4.TitleScreenController + the
// title_screen_ctrl / title_screen_sel_ctrl Animator controllers in level3).
// No DOM, no clock: the feature feeds it dt and input; it emits events.
//
// ORIGINAL FLOW (decomp/decompiled/Q4.TitleScreenController*.c, controller dump in
// docs/TITLE_OPTIONS_CREDITS_ANALYSIS.md):
//   Show @00541fb0 -> Animator InStart (2.5 s, SFX event at t=0 = sfx_stage_titlejingle)
//   -> StartIdle (waits; "Press any button" = Mess_Loc_Sel_01 tl_title_004)
//   -> OnStartPressed @00543200 sets Animator bool StartPressed (latched) -> StartOut
//      (clip 2.0 s, transition 0.25 s, exits to InIdle at normalized 0.5 = 1.0 s + 0.2 s blend)
//   -> menu (MainScreen_Loc vertical list of UIButtons: Play OnPlay, Options OnOptions,
//      Credits OnCredits ...). A button's own animator (title_screen_sel_ctrl): Idle -> Enter
//      (0.2 s) on select, Decide (0.2 s) on confirm.
//   Play: OnPlay @00542720 -> Hide anim (clip Out 0.667 s) -> OnPlayHideComplete @005438a0 ->
//      StageSelectController.Show.
//   Credits: OnCredits @00544570 -> CoroutineGoToCredits (StartCredit_Title 4 s clip), back via
//      ReturnTitle (2.0 s clip) -> InIdle.
//
// WEB ADDITION: `gate` phase. Browsers only allow audio after a user gesture, so when the audio
// context is still suspended the title waits for a first press BEFORE running InStart (so the jingle
// at t=0 is audible). When audio is already running the gate is skipped.

export type TitlePhase = 'gate' | 'intro' | 'pressStart' | 'startOut' | 'menu' | 'hiding' | 'away' | 'returning';
export type TitleAction = 'play' | 'options' | 'credits';

export interface TitleEntry {
  id: TitleAction;
  /** TextDatabase label (strings.json). */
  label: string;
  /** Original prefab object (Mess_Loc_Sel_NN) and UIButton onClick method. */
  prefabNode: string;
  onClick: string;
}

/** Visible entries in prefab order. Original prefab: Play, Ranking(off), Options(off), Credits, DLC, Quit(off).
 *  The web build shows Options (inactive in the PS4 title prefab, reachable from the pause menu there). */
export const TITLE_ENTRIES: readonly TitleEntry[] = [
  { id: 'play', label: 'tl_title_005', prefabNode: 'Mess_Loc_Sel_02', onClick: 'OnPlay' },
  { id: 'options', label: 'tl_pause_006', prefabNode: 'Mess_Loc_Sel_04', onClick: 'OnOptions' },
  { id: 'credits', label: 'tl_title_007', prefabNode: 'Mess_Loc_Sel_05', onClick: 'OnCredits' },
];

/** Seconds, from the AnimationClip lengths in sharedassets3.assets (see analysis doc). */
export const TITLE_TIMES = {
  inStart: 2.5, // clip InStart (title_screen_ctrl)
  startOut: 1.2, // StartOut 2.0 s clip, exit time 0.5 -> 1.0 s, + 0.2 s transition
  out: 0.667, // clip Out (hide)
  creditsOut: 0.667,
  returning: 1.0, // ReturnTitle (2.0 s) -> InIdle at exit; menu usable after the first half
  decide: 0.2, // title_screen_sel_ctrl Decide clip
} as const;

export type TitleEvent =
  | { type: 'sfx'; name: 'titlejingle' | 'select' | 'confirm' | 'cancel' }
  | { type: 'action'; action: TitleAction };

export class TitleModel {
  phase: TitlePhase;
  /** Seconds spent in the current phase. */
  t = 0;
  selected = 0;
  private pressLatched = false;
  private pending: TitleAction | null = null;
  readonly events: TitleEvent[] = [];

  constructor(opts: { needsGesture: boolean }) {
    this.phase = opts.needsGesture ? 'gate' : 'intro';
    if (this.phase === 'intro') this.events.push({ type: 'sfx', name: 'titlejingle' });
  }

  /** True while the menu buttons react (UIButtons enabled). */
  get menuInteractive(): boolean {
    return this.phase === 'menu';
  }

  /** 0..1 progress of the current timed phase (for the view's fade/slide). */
  get progress(): number {
    const d = this.phaseDuration();
    return d <= 0 ? 1 : Math.min(1, this.t / d);
  }

  private phaseDuration(): number {
    switch (this.phase) {
      case 'intro': return TITLE_TIMES.inStart;
      case 'startOut': return TITLE_TIMES.startOut;
      case 'hiding': return this.pending === 'credits' ? TITLE_TIMES.creditsOut : TITLE_TIMES.out;
      case 'returning': return TITLE_TIMES.returning;
      default: return 0;
    }
  }

  drain(): TitleEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private setPhase(p: TitlePhase): void {
    this.phase = p;
    this.t = 0;
  }

  /** Any button / key / click / tap (Q4.TitleScreenController.OnStartPressed). Returns true if consumed. */
  press(): boolean {
    switch (this.phase) {
      case 'gate':
        this.setPhase('intro');
        this.events.push({ type: 'sfx', name: 'titlejingle' });
        return true;
      case 'intro':
      case 'pressStart':
        if (this.pressLatched) return false;
        this.pressLatched = true; // Animator bool StartPressed stays set until the StartIdle state reads it
        if (this.phase === 'pressStart') this.enterStartOut();
        return true;
      default:
        return false;
    }
  }

  private enterStartOut(): void {
    this.setPhase('startOut');
    this.events.push({ type: 'sfx', name: 'confirm' });
  }

  move(d: number): void {
    if (!this.menuInteractive) return;
    const n = TITLE_ENTRIES.length;
    this.selected = (this.selected + d + n) % n;
    this.events.push({ type: 'sfx', name: 'select' });
  }

  hover(i: number): void {
    if (!this.menuInteractive || i === this.selected || i < 0 || i >= TITLE_ENTRIES.length) return;
    this.selected = i;
    this.events.push({ type: 'sfx', name: 'select' });
  }

  confirm(): void {
    if (!this.menuInteractive) return;
    this.pending = TITLE_ENTRIES[this.selected]!.id;
    this.events.push({ type: 'sfx', name: 'confirm' });
    this.setPhase('hiding');
  }

  /** The sub-screen (options/credits) closed: ReturnTitle -> InIdle. */
  returnFromSubScreen(): void {
    if (this.phase !== 'away') return;
    this.setPhase('returning');
  }

  update(dt: number): void {
    this.t += dt;
    switch (this.phase) {
      case 'intro':
        if (this.t >= TITLE_TIMES.inStart) {
          this.setPhase('pressStart');
          if (this.pressLatched) this.enterStartOut();
        }
        break;
      case 'startOut':
        if (this.t >= TITLE_TIMES.startOut) this.setPhase('menu');
        break;
      case 'hiding':
        if (this.t >= this.phaseDuration()) {
          const a = this.pending!;
          this.pending = null;
          // Play leaves the title for good (flow decides); options/credits park the title.
          this.setPhase(a === 'play' ? 'away' : 'away');
          this.events.push({ type: 'action', action: a });
        }
        break;
      case 'returning':
        if (this.t >= TITLE_TIMES.returning) this.setPhase('menu');
        break;
      default:
        break;
    }
  }
}
