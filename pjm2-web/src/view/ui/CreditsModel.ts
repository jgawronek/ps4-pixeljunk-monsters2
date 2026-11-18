// src/view/ui/CreditsModel.ts
// Pure timeline of the staff credits (Q4.StaffCreditsController + Animator controller
// credit_screen_ctrl in globalsettings; prefab credits_01 = 7 pages Screen_01..07).
//
// Controller (dumped with UnityPy, see analysis doc): per page N: In_N (1.5 s) -> Idle_N (8.0 s)
// -> Out_N (0.5 s) -> In_{N+1}; trigger `Skip` (StepPage @00764540 on menu_confirm / ExternalStepPage)
// jumps In_N/Idle_N -> Idle_{N+1} immediately; page 7: Idle_07 (8 s) -> Out_07 (4.0 s clip) ->
// CreditFinish -> Update @00764b50 sees the exit state -> DismissScreen @00764ec0 (restores BGM, hides).
// `Cancel` trigger (ShutdownMenu @00764f60 on menu_cancel) goes straight to the exit.

export const CREDIT_PAGES = 7;
export const CREDIT_TIMES = { in: 1.5, idle: 8.0, out: 0.5, outLast: 4.0 } as const;

export type CreditStage = 'in' | 'idle' | 'out' | 'done';

export class CreditsModel {
  page = 0; // 0-based
  stage: CreditStage = 'in';
  t = 0;
  cancelled = false;

  get done(): boolean {
    return this.stage === 'done';
  }

  /** Page opacity 0..1 (In fades up, Out fades down — clip curves approximated as linear). */
  get alpha(): number {
    switch (this.stage) {
      case 'in': return Math.min(1, this.t / CREDIT_TIMES.in);
      case 'idle': return 1;
      case 'out': return 1 - Math.min(1, this.t / this.outLen());
      default: return 0;
    }
  }

  private outLen(): number {
    return this.page === CREDIT_PAGES - 1 ? CREDIT_TIMES.outLast : CREDIT_TIMES.out;
  }

  /** `Skip` trigger. */
  skip(): void {
    if (this.stage === 'done') return;
    if (this.stage === 'in' || this.stage === 'idle') {
      if (this.page === CREDIT_PAGES - 1) {
        this.stage = 'out';
        this.t = 0;
      } else {
        this.page++;
        this.stage = 'idle';
        this.t = 0;
      }
    } else if (this.stage === 'out' && this.page < CREDIT_PAGES - 1) {
      this.page++;
      this.stage = 'idle';
      this.t = 0;
    }
  }

  /** `Cancel` trigger. */
  cancel(): void {
    this.cancelled = true;
    this.stage = 'done';
  }

  update(dt: number): void {
    if (this.stage === 'done') return;
    this.t += dt;
    for (let guard = 0; guard < 8; guard++) {
      if (this.stage === 'in' && this.t >= CREDIT_TIMES.in) {
        this.t -= CREDIT_TIMES.in; this.stage = 'idle';
      } else if (this.stage === 'idle' && this.t >= CREDIT_TIMES.idle) {
        this.t -= CREDIT_TIMES.idle; this.stage = 'out';
      } else if (this.stage === 'out' && this.t >= this.outLen()) {
        this.t -= this.outLen();
        if (this.page === CREDIT_PAGES - 1) { this.stage = 'done'; return; }
        this.page++; this.stage = 'in';
      } else break;
    }
  }

  /** Total auto-run length in seconds (no skipping). */
  static totalSeconds(): number {
    return CREDIT_PAGES * (CREDIT_TIMES.in + CREDIT_TIMES.idle) + (CREDIT_PAGES - 1) * CREDIT_TIMES.out + CREDIT_TIMES.outLast;
  }
}
