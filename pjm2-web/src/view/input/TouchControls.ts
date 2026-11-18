// src/view/input/TouchControls.ts
// Touch input for the browser port — multi-device (phone/tablet) is a locked
// requirement. VIEW-ONLY: emits screen-space vectors and client-coordinate
// taps; the integrator maps screen → Unity (screen x right = −unity x,
// screen y up = +unity z, same convention as the WASD branch in game.ts) and
// frounds when applying to sim (PORTING_CONVENTIONS §2/§6). No Math.random.
//
// Layout: a pointer starting on the LEFT half of the target becomes the
// joystick pointer (tracked by pointerId, one at a time); pointers starting
// on the RIGHT half are tap candidates — released within TAP_MAX_DURATION_MS
// and moved < TAP_MAX_MOVE_PX → onTap (integrator does ground-pick/build).
//
// Node-testable: the joystick math (computeJoystick) and tap-vs-drag
// classification (classifyGesture) are exported pure helpers, and all DOM
// injection is guarded by `typeof document !== 'undefined'`, so the class
// runs headless against a minimal fake element (addEventListener /
// removeEventListener / style / getBoundingClientRect).

export const JOYSTICK_RADIUS_PX = 56;
export const JOYSTICK_DEADZONE = 0.15;
export const TAP_MAX_DURATION_MS = 250;
export const TAP_MAX_MOVE_PX = 12;

/** Screen-space joystick output: x right, y up, each in [-1, 1]. */
export interface JoystickVector {
  x: number;
  y: number;
}

/**
 * Pure joystick math. (dx, dy) is the finger offset from the touch-start
 * position in px, screen-space (x right, y up). Output = offset clamped to
 * `radius`, divided by `radius`; offsets inside the deadzone
 * (`deadzone` fraction of the radius) produce (0, 0). Non-positive radius
 * or deadzone ≥ 1 always produce (0, 0).
 */
export function computeJoystick(dx: number, dy: number, radius: number, deadzone: number): JoystickVector {
  if (radius <= 0 || deadzone >= 1) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  const mag = len / radius;
  if (mag <= deadzone) return { x: 0, y: 0 };
  const out = Math.min(mag, 1); // clamp at the radius rim
  // `|| 0` normalizes -0 → 0 (callers pass -dyScreen, which is -0 when dy === 0).
  return { x: ((dx / len) * out) || 0, y: ((dy / len) * out) || 0 };
}

export type GestureKind = 'tap' | 'drag';

/**
 * Pure tap-vs-drag classification: a tap is released within
 * TAP_MAX_DURATION_MS (inclusive) and moved < TAP_MAX_MOVE_PX (exclusive).
 * `movedPx` is the max distance from the touch-start position.
 */
export function classifyGesture(durationMs: number, movedPx: number): GestureKind {
  return durationMs <= TAP_MAX_DURATION_MS && movedPx < TAP_MAX_MOVE_PX ? 'tap' : 'drag';
}

export interface TouchControlsOptions {
  /** Element covering the play area (the canvas). */
  target: HTMLElement;
  /** Called continuously while the joystick is active; vector in [-1,1], screen-space: x right, y up. Zero when released. */
  onMove: (x: number, y: number) => void;
  /** A quick tap (not a drag) on the right half — integrator does ground-pick/build. Client coords. */
  onTap: (clientX: number, clientY: number) => void;
  /** Optional pause button callback. */
  onPause?: () => void;
}

interface TapCandidate {
  startX: number;
  startY: number;
  startTime: number;
  /** Max distance (px) from the start position seen so far. */
  moved: number;
}

export class TouchControls {
  private readonly opts: TouchControlsOptions;
  private attached = false;
  private enabledFlag = true;
  /** pointerId of the engaged joystick pointer, or null. */
  private joystickId: number | null = null;
  private joyStartX = 0;
  private joyStartY = 0;
  private readonly taps = new Map<number, TapCandidate>();
  private savedTouchAction = '';
  // Injected DOM (null when headless or detached).
  private host: HTMLElement | null = null;
  private baseEl: HTMLElement | null = null;
  private knobEl: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;

  constructor(opts: TouchControlsOptions) {
    this.opts = opts;
  }

  /** Joystick currently engaged. */
  get active(): boolean {
    return this.joystickId !== null;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  /** When false, no joystick/tap processing (menus open). The pause button
   *  stays live so the menu can be closed again. Disabling mid-gesture
   *  releases the joystick (emits onMove(0, 0)) and drops tap candidates. */
  setEnabled(v: boolean): void {
    if (this.enabledFlag === v) return;
    this.enabledFlag = v;
    if (!v) {
      this.releaseJoystick();
      this.taps.clear();
    }
  }

  /** Attach pointer listeners + inject minimal DOM (joystick base/knob divs,
   *  pause button). Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const t = this.opts.target;
    this.savedTouchAction = t.style.touchAction;
    t.style.touchAction = 'none'; // stop browser scroll/zoom gestures
    t.addEventListener('pointerdown', this.onPointerDown);
    t.addEventListener('pointermove', this.onPointerMove);
    t.addEventListener('pointerup', this.onPointerUp);
    t.addEventListener('pointercancel', this.onPointerCancel);
    this.createDom();
  }

  /** Remove listeners + injected DOM, restore touch-action, reset state.
   *  Idempotent. Releases an engaged joystick (emits onMove(0, 0)). */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.releaseJoystick();
    this.taps.clear();
    const t = this.opts.target;
    t.removeEventListener('pointerdown', this.onPointerDown);
    t.removeEventListener('pointermove', this.onPointerMove);
    t.removeEventListener('pointerup', this.onPointerUp);
    t.removeEventListener('pointercancel', this.onPointerCancel);
    t.style.touchAction = this.savedTouchAction;
    this.removeDom();
  }

  // ---- pointer routing ---------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabledFlag || !this.attached) return;
    const rect = this.opts.target.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX < rect.width / 2) {
      // LEFT half → joystick. Only one joystick pointer at a time; extra
      // left-half touches are ignored (not taps).
      if (this.joystickId !== null) return;
      this.joystickId = e.pointerId;
      this.joyStartX = e.clientX;
      this.joyStartY = e.clientY;
      this.capture(e.pointerId);
      this.showJoystick(e.clientX, e.clientY);
      this.opts.onMove(0, 0);
      e.preventDefault();
      return;
    }
    // RIGHT half → tap candidate (multi-touch: any number of these).
    this.taps.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      moved: 0,
    });
    this.capture(e.pointerId); // guarantee up/cancel delivery even off-canvas
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabledFlag || !this.attached) return;
    if (e.pointerId === this.joystickId) {
      const dx = e.clientX - this.joyStartX;
      const dyScreen = e.clientY - this.joyStartY;
      // Client y grows downward; output y is up.
      const v = computeJoystick(dx, -dyScreen, JOYSTICK_RADIUS_PX, JOYSTICK_DEADZONE);
      this.moveKnob(dx, dyScreen);
      this.opts.onMove(v.x, v.y);
      e.preventDefault();
      return;
    }
    const tap = this.taps.get(e.pointerId);
    if (tap !== undefined) {
      const d = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY);
      if (d > tap.moved) tap.moved = d;
      e.preventDefault();
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.attached) return;
    if (e.pointerId === this.joystickId) {
      this.releaseJoystick();
      e.preventDefault();
      return;
    }
    const tap = this.taps.get(e.pointerId);
    if (tap !== undefined) {
      this.taps.delete(e.pointerId);
      this.uncapture(e.pointerId);
      if (this.enabledFlag && classifyGesture(Date.now() - tap.startTime, tap.moved) === 'tap') {
        this.opts.onTap(e.clientX, e.clientY);
      }
      e.preventDefault();
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (!this.attached) return;
    if (e.pointerId === this.joystickId) {
      this.releaseJoystick();
      e.preventDefault();
      return;
    }
    if (this.taps.delete(e.pointerId)) {
      this.uncapture(e.pointerId);
      e.preventDefault(); // cancelled taps never fire onTap
    }
  };

  private readonly onPauseDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.opts.onPause?.();
  };

  // ---- joystick state ----------------------------------------------------------

  private releaseJoystick(): void {
    if (this.joystickId === null) return;
    const id = this.joystickId;
    this.joystickId = null;
    this.uncapture(id);
    this.hideJoystick();
    this.opts.onMove(0, 0);
  }

  private capture(id: number): void {
    const t = this.opts.target;
    if (typeof t.setPointerCapture === 'function') {
      try {
        t.setPointerCapture(id);
      } catch {
        // Pointer already gone (fast cancel) — routing still works by id.
      }
    }
  }

  private uncapture(id: number): void {
    const t = this.opts.target;
    if (typeof t.releasePointerCapture === 'function') {
      try {
        t.releasePointerCapture(id);
      } catch {
        // Not captured / pointer already gone — nothing to release.
      }
    }
  }

  // ---- injected DOM (all inline styles; skipped headless) ----------------------

  private createDom(): void {
    if (typeof document === 'undefined') return; // Node/vitest: logic only
    const host = this.opts.target.parentElement ?? document.body;
    this.host = host;

    const base = document.createElement('div');
    base.style.position = 'fixed';
    base.style.boxSizing = 'border-box';
    base.style.width = `${JOYSTICK_RADIUS_PX * 2}px`;
    base.style.height = `${JOYSTICK_RADIUS_PX * 2}px`;
    base.style.borderRadius = '50%';
    base.style.background = 'rgba(255, 255, 255, 0.12)';
    base.style.border = '2px solid rgba(255, 255, 255, 0.35)';
    base.style.transform = 'translate(-50%, -50%)';
    base.style.pointerEvents = 'none';
    base.style.zIndex = '10000';
    base.style.display = 'none';

    const knob = document.createElement('div');
    knob.style.position = 'fixed';
    knob.style.boxSizing = 'border-box';
    knob.style.width = '48px';
    knob.style.height = '48px';
    knob.style.borderRadius = '50%';
    knob.style.background = 'rgba(255, 255, 255, 0.45)';
    knob.style.transform = 'translate(-50%, -50%)';
    knob.style.pointerEvents = 'none';
    knob.style.zIndex = '10001';
    knob.style.display = 'none';

    const pause = document.createElement('div');
    pause.textContent = '⏸';
    pause.style.position = 'fixed';
    pause.style.top = '12px';
    pause.style.right = '12px';
    pause.style.width = '40px';
    pause.style.height = '40px';
    pause.style.display = 'flex';
    pause.style.alignItems = 'center';
    pause.style.justifyContent = 'center';
    pause.style.borderRadius = '10px';
    pause.style.background = 'rgba(0, 0, 0, 0.35)';
    pause.style.color = '#ffffff';
    pause.style.fontSize = '20px';
    pause.style.lineHeight = '1';
    pause.style.userSelect = 'none';
    pause.style.touchAction = 'none';
    pause.style.pointerEvents = 'auto';
    pause.style.cursor = 'pointer';
    pause.style.zIndex = '10002';
    pause.addEventListener('pointerdown', this.onPauseDown);

    host.appendChild(base);
    host.appendChild(knob);
    host.appendChild(pause);
    this.baseEl = base;
    this.knobEl = knob;
    this.pauseEl = pause;
  }

  private removeDom(): void {
    if (this.pauseEl !== null) this.pauseEl.removeEventListener('pointerdown', this.onPauseDown);
    if (this.host !== null) {
      if (this.baseEl !== null) this.host.removeChild(this.baseEl);
      if (this.knobEl !== null) this.host.removeChild(this.knobEl);
      if (this.pauseEl !== null) this.host.removeChild(this.pauseEl);
    }
    this.host = null;
    this.baseEl = null;
    this.knobEl = null;
    this.pauseEl = null;
  }

  private showJoystick(clientX: number, clientY: number): void {
    if (this.baseEl === null || this.knobEl === null) return;
    this.baseEl.style.left = `${clientX}px`;
    this.baseEl.style.top = `${clientY}px`;
    this.baseEl.style.display = 'block';
    this.knobEl.style.left = `${clientX}px`;
    this.knobEl.style.top = `${clientY}px`;
    this.knobEl.style.display = 'block';
  }

  private moveKnob(dx: number, dyScreen: number): void {
    if (this.knobEl === null) return;
    // Visual knob follows the finger, clamped to the rim (no deadzone).
    const len = Math.hypot(dx, dyScreen);
    const scale = len > JOYSTICK_RADIUS_PX ? JOYSTICK_RADIUS_PX / len : 1;
    this.knobEl.style.left = `${this.joyStartX + dx * scale}px`;
    this.knobEl.style.top = `${this.joyStartY + dyScreen * scale}px`;
  }

  private hideJoystick(): void {
    if (this.baseEl !== null) this.baseEl.style.display = 'none';
    if (this.knobEl !== null) this.knobEl.style.display = 'none';
  }
}