// tests/view/touchControls.test.ts
// Touch input module: pure joystick/gesture math + pointer routing against a
// minimal fake element (Node-safe — no real DOM required; DOM injection is
// covered separately with a stubbed minimal document).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TouchControls,
  computeJoystick,
  classifyGesture,
  JOYSTICK_RADIUS_PX,
  TAP_MAX_DURATION_MS,
  TAP_MAX_MOVE_PX,
} from '../../src/view/input/TouchControls';

// ---- fake element ------------------------------------------------------------

type Handler = (e: PointerEvent) => void;

interface FakePointerEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function pointerEvent(pointerId: number, clientX: number, clientY: number): FakePointerEvent {
  return {
    pointerId,
    clientX,
    clientY,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

/** Minimal element surface: records listeners so tests can dispatch + verify removal. */
class FakeTarget {
  readonly listeners = new Map<string, Handler[]>();
  readonly style = { touchAction: 'auto' };
  rect = { left: 0, top: 0, width: 800, height: 600 };
  readonly captured: number[] = [];
  readonly released: number[] = [];

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.listeners.delete(type);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }

  releasePointerCapture(id: number): void {
    this.released.push(id);
  }

  dispatch(type: string, e: FakePointerEvent): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e as unknown as PointerEvent);
  }

  listenerCount(): number {
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }

  asElement(): HTMLElement {
    return this as unknown as HTMLElement;
  }
}

function makeControls() {
  const target = new FakeTarget();
  const moves: Array<[number, number]> = [];
  const taps: Array<[number, number]> = [];
  let pauses = 0;
  const tc = new TouchControls({
    target: target.asElement(),
    onMove: (x, y) => moves.push([x, y]),
    onTap: (x, y) => taps.push([x, y]),
    onPause: () => {
      pauses++;
    },
  });
  tc.attach();
  return { target, tc, moves, taps, pauses: () => pauses };
}

// ---- pure joystick math --------------------------------------------------------

describe('computeJoystick', () => {
  it('zero offset → zero vector', () => {
    expect(computeJoystick(0, 0, 56, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('offset inside the deadzone → zero vector', () => {
    expect(computeJoystick(5, 0, 56, 0.15)).toEqual({ x: 0, y: 0 }); // 5/56 ≈ 0.089
    expect(computeJoystick(0, -8, 56, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('offset exactly at the deadzone boundary → zero (inclusive)', () => {
    // radius 100 keeps 15/100 === 0.15 exact in fp64.
    expect(computeJoystick(15, 0, 100, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('offset just outside the deadzone → clamped offset/radius', () => {
    const v = computeJoystick(16, 0, 100, 0.15);
    expect(v.x).toBeCloseTo(0.16, 10);
    expect(v.y).toBe(0);
  });

  it('mid-range offset passes through unscaled (offset/radius)', () => {
    const v = computeJoystick(28, 0, 56, 0.15);
    expect(v.x).toBeCloseTo(0.5, 10);
    expect(v.y).toBe(0);
  });

  it('offset beyond the radius clamps to magnitude 1', () => {
    expect(computeJoystick(200, 0, 56, 0.15)).toEqual({ x: 1, y: 0 });
    expect(computeJoystick(0, -200, 56, 0.15)).toEqual({ x: 0, y: -1 });
    expect(computeJoystick(-56, 0, 56, 0.15)).toEqual({ x: -1, y: 0 });
  });

  it('diagonal at/beyond the rim normalizes to unit length', () => {
    const v = computeJoystick(80, 80, 56, 0.15); // len ≈ 113 > 56
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 10);
  });

  it('diagonal inside the rim keeps offset/radius magnitude (no renormalize)', () => {
    const v = computeJoystick(16.8, 16.8, 56, 0.15); // 0.3r each axis
    expect(v.x).toBeCloseTo(0.3, 10);
    expect(v.y).toBeCloseTo(0.3, 10);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(0.3 * Math.SQRT2, 10);
  });

  it('screen y up maps to positive output y', () => {
    expect(computeJoystick(0, 56, 56, 0.15)).toEqual({ x: 0, y: 1 });
  });

  it('non-positive radius or deadzone ≥ 1 → zero vector', () => {
    expect(computeJoystick(30, 30, 0, 0.15)).toEqual({ x: 0, y: 0 });
    expect(computeJoystick(30, 30, -5, 0.15)).toEqual({ x: 0, y: 0 });
    expect(computeJoystick(30, 30, 56, 1)).toEqual({ x: 0, y: 0 });
  });
});

// ---- pure gesture classification -----------------------------------------------

describe('classifyGesture', () => {
  it('quick + still → tap', () => {
    expect(classifyGesture(100, 0)).toBe('tap');
    expect(classifyGesture(0, 0)).toBe('tap');
  });

  it('duration boundary: exactly TAP_MAX_DURATION_MS is a tap, +1ms is a drag', () => {
    expect(classifyGesture(TAP_MAX_DURATION_MS, 0)).toBe('tap');
    expect(classifyGesture(TAP_MAX_DURATION_MS + 1, 0)).toBe('drag');
  });

  it('move boundary: just under TAP_MAX_MOVE_PX is a tap, exactly it is a drag', () => {
    expect(classifyGesture(50, TAP_MAX_MOVE_PX - 0.1)).toBe('tap');
    expect(classifyGesture(50, TAP_MAX_MOVE_PX)).toBe('drag');
  });

  it('slow but still → drag; quick but far → drag', () => {
    expect(classifyGesture(1000, 0)).toBe('drag');
    expect(classifyGesture(50, 40)).toBe('drag');
  });
});

// ---- pointer routing (fake element, fake timers) --------------------------------

describe('TouchControls routing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('attach registers the four pointer listeners and sets touch-action:none', () => {
    const { target } = makeControls();
    expect(target.listenerCount()).toBe(4);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      expect(target.listeners.get(type)?.length).toBe(1);
    }
    expect(target.style.touchAction).toBe('none');
  });

  it('attach is idempotent', () => {
    const { target, tc } = makeControls();
    tc.attach();
    expect(target.listenerCount()).toBe(4);
  });

  it('left-half pointerdown engages the joystick, captures, emits onMove(0,0)', () => {
    const { target, tc, moves } = makeControls();
    const down = pointerEvent(1, 100, 300); // left half of 800px
    target.dispatch('pointerdown', down);
    expect(tc.active).toBe(true);
    expect(target.captured).toEqual([1]);
    expect(moves).toEqual([[0, 0]]);
    expect(down.prevented).toBe(true);
  });

  it('joystick move emits clamped offset/radius; screen up = +y', () => {
    const { target, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointermove', pointerEvent(1, 100 + JOYSTICK_RADIUS_PX, 300));
    expect(moves[moves.length - 1]).toEqual([1, 0]);
    target.dispatch('pointermove', pointerEvent(1, 100, 300 - JOYSTICK_RADIUS_PX));
    expect(moves[moves.length - 1]).toEqual([0, 1]);
    target.dispatch('pointermove', pointerEvent(1, 100 - JOYSTICK_RADIUS_PX, 300));
    expect(moves[moves.length - 1]).toEqual([-1, 0]);
    target.dispatch('pointermove', pointerEvent(1, 100, 300 + JOYSTICK_RADIUS_PX));
    expect(moves[moves.length - 1]).toEqual([0, -1]);
  });

  it('joystick move inside the deadzone emits zero', () => {
    const { target, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    const move = pointerEvent(1, 105, 300); // 5px < 0.15 * 56
    target.dispatch('pointermove', move);
    expect(moves[moves.length - 1]).toEqual([0, 0]);
    expect(move.prevented).toBe(true);
  });

  it('joystick move beyond the rim clamps to unit magnitude', () => {
    const { target, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointermove', pointerEvent(1, 400, 300));
    expect(moves[moves.length - 1]).toEqual([1, 0]);
  });

  it('joystick release resets: onMove(0,0), inactive, capture released', () => {
    const { target, tc, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointermove', pointerEvent(1, 156, 300));
    const up = pointerEvent(1, 156, 300);
    target.dispatch('pointerup', up);
    expect(tc.active).toBe(false);
    expect(moves[moves.length - 1]).toEqual([0, 0]);
    expect(target.released).toContain(1);
    expect(up.prevented).toBe(true);
    // Moves after release are ignored.
    const n = moves.length;
    target.dispatch('pointermove', pointerEvent(1, 200, 300));
    expect(moves.length).toBe(n);
  });

  it('pointercancel releases the joystick without a tap', () => {
    const { target, tc, moves, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointercancel', pointerEvent(1, 150, 300));
    expect(tc.active).toBe(false);
    expect(moves[moves.length - 1]).toEqual([0, 0]);
    expect(taps).toEqual([]);
  });

  it('quick right-half tap fires onTap with client coords', () => {
    const { target, tc, moves, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    vi.advanceTimersByTime(100);
    const up = pointerEvent(2, 600, 300);
    target.dispatch('pointerup', up);
    expect(taps).toEqual([[600, 300]]);
    expect(moves).toEqual([]); // taps never drive the joystick
    expect(tc.active).toBe(false);
    expect(up.prevented).toBe(true);
  });

  it('slow right-half release is not a tap', () => {
    const { target, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    vi.advanceTimersByTime(TAP_MAX_DURATION_MS + 1);
    target.dispatch('pointerup', pointerEvent(2, 600, 300));
    expect(taps).toEqual([]);
  });

  it('right-half drag (moved ≥ 12px) is not a tap even if quick', () => {
    const { target, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    target.dispatch('pointermove', pointerEvent(2, 620, 300)); // 20px
    vi.advanceTimersByTime(50);
    target.dispatch('pointerup', pointerEvent(2, 620, 300));
    expect(taps).toEqual([]);
  });

  it('movement is measured as max distance from start (return-to-start still drags)', () => {
    const { target, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    target.dispatch('pointermove', pointerEvent(2, 630, 300)); // out 30px…
    target.dispatch('pointermove', pointerEvent(2, 600, 300)); // …and back
    vi.advanceTimersByTime(50);
    target.dispatch('pointerup', pointerEvent(2, 600, 300));
    expect(taps).toEqual([]);
  });

  it('cancelled right-half pointer never fires onTap', () => {
    const { target, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    vi.advanceTimersByTime(50);
    target.dispatch('pointercancel', pointerEvent(2, 600, 300));
    expect(taps).toEqual([]);
  });

  it('multi-touch: right-half tap while joystick active routes independently', () => {
    const { target, tc, moves, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300)); // joystick
    target.dispatch('pointerdown', pointerEvent(2, 600, 300)); // tap candidate
    expect(tc.active).toBe(true);
    vi.advanceTimersByTime(80);
    target.dispatch('pointerup', pointerEvent(2, 600, 300));
    expect(taps).toEqual([[600, 300]]);
    expect(tc.active).toBe(true); // joystick unaffected
    // Joystick pointer still routes by id after the tap ends.
    target.dispatch('pointermove', pointerEvent(1, 156, 300));
    expect(moves[moves.length - 1]).toEqual([1, 0]);
    // The ended tap pointer no longer routes.
    const n = moves.length;
    target.dispatch('pointermove', pointerEvent(2, 700, 300));
    expect(moves.length).toBe(n);
  });

  it('second left-half pointer while joystick active is ignored', () => {
    const { target, tc, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    const down2 = pointerEvent(3, 50, 400);
    target.dispatch('pointerdown', down2);
    expect(target.captured).toEqual([1]); // no second capture
    expect(down2.prevented).toBe(false); // unhandled
    const n = moves.length;
    target.dispatch('pointermove', pointerEvent(3, 200, 400));
    expect(moves.length).toBe(n); // not the joystick pointer
    target.dispatch('pointerup', pointerEvent(3, 200, 400));
    expect(tc.active).toBe(true); // original joystick still engaged
    target.dispatch('pointermove', pointerEvent(1, 156, 300));
    expect(moves[moves.length - 1]).toEqual([1, 0]);
  });

  it('two simultaneous right-half taps both fire', () => {
    const { target, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(2, 500, 200));
    target.dispatch('pointerdown', pointerEvent(3, 700, 400));
    vi.advanceTimersByTime(60);
    target.dispatch('pointerup', pointerEvent(3, 700, 400));
    target.dispatch('pointerup', pointerEvent(2, 500, 200));
    expect(taps).toEqual([[700, 400], [500, 200]]);
  });

  it('setEnabled(false) suppresses joystick and tap processing', () => {
    const { target, tc, moves, taps } = makeControls();
    tc.setEnabled(false);
    expect(tc.enabled).toBe(false);
    const down = pointerEvent(1, 100, 300);
    target.dispatch('pointerdown', down);
    expect(tc.active).toBe(false);
    expect(down.prevented).toBe(false); // let menus handle it
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    vi.advanceTimersByTime(50);
    target.dispatch('pointerup', pointerEvent(2, 600, 300));
    expect(moves).toEqual([]);
    expect(taps).toEqual([]);
    // Re-enable restores processing.
    tc.setEnabled(true);
    expect(tc.enabled).toBe(true);
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    expect(tc.active).toBe(true);
  });

  it('setEnabled(false) mid-gesture releases the joystick and drops taps', () => {
    const { target, tc, moves, taps } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointermove', pointerEvent(1, 156, 300));
    target.dispatch('pointerdown', pointerEvent(2, 600, 300));
    tc.setEnabled(false);
    expect(tc.active).toBe(false);
    expect(moves[moves.length - 1]).toEqual([0, 0]);
    vi.advanceTimersByTime(50);
    target.dispatch('pointerup', pointerEvent(2, 600, 300));
    target.dispatch('pointerup', pointerEvent(1, 156, 300));
    expect(taps).toEqual([]);
    expect(moves[moves.length - 1]).toEqual([0, 0]); // no duplicate zero spam
  });

  it('detach removes all listeners, restores touch-action, resets state', () => {
    const { target, tc, moves } = makeControls();
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    tc.detach();
    expect(target.listenerCount()).toBe(0);
    expect(target.style.touchAction).toBe('auto');
    expect(tc.active).toBe(false);
    expect(moves[moves.length - 1]).toEqual([0, 0]); // released on detach
    // Events after detach do nothing (no listeners left to dispatch to).
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    expect(tc.active).toBe(false);
    tc.detach(); // idempotent
  });

  it('untracked pointer moves are not prevented', () => {
    const { target } = makeControls();
    const move = pointerEvent(9, 400, 300);
    target.dispatch('pointermove', move);
    expect(move.prevented).toBe(false);
  });

  it('uses the target rect for half-splitting (offset canvas)', () => {
    const { target, tc, taps } = makeControls();
    target.rect = { left: 100, top: 50, width: 800, height: 600 };
    // clientX 450 → local 350 < 400 → joystick side.
    target.dispatch('pointerdown', pointerEvent(1, 450, 300));
    expect(tc.active).toBe(true);
    // clientX 550 → local 450 ≥ 400 → tap side.
    target.dispatch('pointerdown', pointerEvent(2, 550, 300));
    vi.advanceTimersByTime(50);
    target.dispatch('pointerup', pointerEvent(2, 550, 300));
    expect(taps).toEqual([[550, 300]]);
  });
});

// ---- DOM injection (stubbed minimal document) -----------------------------------

class FakeNode {
  style: Record<string, string> = {};
  textContent = '';
  readonly children: FakeNode[] = [];
  readonly listeners = new Map<string, Handler[]>();

  addEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Handler): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.listeners.delete(type);
  }

  appendChild(n: FakeNode): void {
    this.children.push(n);
  }

  removeChild(n: FakeNode): void {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
  }

  dispatch(type: string, e: FakePointerEvent): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e as unknown as PointerEvent);
  }
}

describe('TouchControls DOM injection', () => {
  let body: FakeNode;

  beforeEach(() => {
    body = new FakeNode();
    vi.stubGlobal('document', {
      body,
      createElement: (_tag: string) => new FakeNode(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeDomControls() {
    const target = new FakeTarget(); // no parentElement → falls back to document.body
    const moves: Array<[number, number]> = [];
    let pauses = 0;
    const tc = new TouchControls({
      target: target.asElement(),
      onMove: (x, y) => moves.push([x, y]),
      onTap: () => {},
      onPause: () => {
        pauses++;
      },
    });
    tc.attach();
    return { target, tc, moves, pauses: () => pauses };
  }

  it('injects base, knob and pause into document.body, hidden joystick', () => {
    makeDomControls();
    expect(body.children.length).toBe(3);
    const [base, knob, pause] = body.children;
    expect(base.style.display).toBe('none');
    expect(knob.style.display).toBe('none');
    expect(base.style.pointerEvents).toBe('none');
    expect(knob.style.pointerEvents).toBe('none');
    expect(base.style.borderRadius).toBe('50%');
    expect(pause.textContent).toBe('⏸');
    expect(pause.style.pointerEvents).toBe('auto');
  });

  it('joystick base appears at the touch start; knob clamps to the rim', () => {
    const { target } = makeDomControls();
    const [base, knob] = body.children;
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    expect(base.style.display).toBe('block');
    expect(base.style.left).toBe('100px');
    expect(base.style.top).toBe('300px');
    expect(knob.style.left).toBe('100px');
    target.dispatch('pointermove', pointerEvent(1, 400, 300)); // 300px > 56px rim
    expect(knob.style.left).toBe(`${100 + JOYSTICK_RADIUS_PX}px`);
    expect(knob.style.top).toBe('300px');
    target.dispatch('pointerup', pointerEvent(1, 400, 300));
    expect(base.style.display).toBe('none');
    expect(knob.style.display).toBe('none');
  });

  it('pause button pointerdown calls onPause (even while disabled)', () => {
    const { tc, pauses } = makeDomControls();
    const pause = body.children[2];
    const e = pointerEvent(7, 780, 20);
    pause.dispatch('pointerdown', e);
    expect(pauses()).toBe(1);
    expect(e.prevented).toBe(true);
    expect(e.stopped).toBe(true);
    tc.setEnabled(false); // pause stays live so menus can be closed
    pause.dispatch('pointerdown', pointerEvent(7, 780, 20));
    expect(pauses()).toBe(2);
  });

  it('detach removes injected nodes and the pause listener', () => {
    const { tc, pauses } = makeDomControls();
    const pause = body.children[2];
    tc.detach();
    expect(body.children.length).toBe(0);
    pause.dispatch('pointerdown', pointerEvent(7, 780, 20));
    expect(pauses()).toBe(0);
  });

  it('headless (no document) still routes input without DOM', () => {
    vi.unstubAllGlobals(); // remove the stubbed document
    const { target, tc, moves } = makeDomControls();
    expect(body.children.length).toBe(0); // nothing injected
    target.dispatch('pointerdown', pointerEvent(1, 100, 300));
    target.dispatch('pointermove', pointerEvent(1, 156, 300));
    expect(tc.active).toBe(true);
    expect(moves[moves.length - 1]).toEqual([1, 0]);
    tc.detach();
  });
});