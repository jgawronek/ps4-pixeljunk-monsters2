// src/view/ui/MenuInput.ts
// Menu input abstraction for the title / options / credits screens: keyboard + gamepad
// (+ pointer handled by each view). Pure mapping functions are exported for tests.
//
// Original: Q4.GestureManager menu gestures (menu_confirm / menu_cancel / menu_resetOptions /
// stick+dpad navigation) on DefaultPS4Gestures / DefaultKeyboardAndMouseGestures. Web mapping:
//   confirm : Enter, Space, E, gamepad A(0)/Start(9)
//   cancel  : Escape, Backspace, Q, gamepad B(1)
//   reset   : R, Delete, gamepad Y(3)   (menu_resetOptions)
//   up/down/left/right : arrows, WASD, dpad (12-15), left stick (|axis|>0.6, edge-triggered)

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'reset';

export function mapMenuKey(code: string): MenuAction | null {
  switch (code) {
    case 'ArrowUp': case 'KeyW': return 'up';
    case 'ArrowDown': case 'KeyS': return 'down';
    case 'ArrowLeft': case 'KeyA': return 'left';
    case 'ArrowRight': case 'KeyD': return 'right';
    case 'Enter': case 'NumpadEnter': case 'Space': case 'KeyE': return 'confirm';
    case 'Escape': case 'Backspace': case 'KeyQ': return 'cancel';
    case 'KeyR': case 'Delete': return 'reset';
    default: return null;
  }
}

/** Gamepad button index -> action. */
export function mapPadButton(i: number): MenuAction | null {
  switch (i) {
    case 0: case 9: return 'confirm';
    case 1: return 'cancel';
    case 3: return 'reset';
    case 12: return 'up';
    case 13: return 'down';
    case 14: return 'left';
    case 15: return 'right';
    default: return null;
  }
}

export interface PadSnapshot {
  buttons: boolean[];
  axes: number[];
}

/** Edge detector over successive gamepad snapshots: returns the actions newly pressed. */
export class PadEdges {
  private prev = new Set<string>();

  poll(pads: PadSnapshot[]): { actions: MenuAction[]; anyButton: boolean } {
    const now = new Set<string>();
    const actions: MenuAction[] = [];
    let anyButton = false;
    for (const p of pads) {
      p.buttons.forEach((down, i) => {
        if (!down) return;
        const a = mapPadButton(i);
        const key = a ?? `b${i}`;
        now.add(key);
        if (!this.prev.has(key)) {
          anyButton = true;
          if (a !== null) actions.push(a);
        }
      });
      const x = p.axes[0] ?? 0;
      const y = p.axes[1] ?? 0;
      const stick: Array<[MenuAction, boolean]> = [['left', x < -0.6], ['right', x > 0.6], ['up', y < -0.6], ['down', y > 0.6]];
      for (const [a, on] of stick) {
        if (!on) continue;
        const key = `s${a}`;
        now.add(key);
        if (!this.prev.has(key)) actions.push(a);
      }
    }
    this.prev = now;
    return { actions, anyButton };
  }
}

export interface MenuInputHandlers {
  /** Called for every mapped action (keyboard or pad). */
  action(a: MenuAction): void;
  /** Called for ANY key/button/pointer press (the "Press any button" semantic). */
  any(): void;
}

/** Browser wiring (keyboard + gamepad polling). `poll()` must be called each frame. */
export class MenuInput {
  private readonly pads = new PadEdges();
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat && mapMenuKey(e.code) === null) return;
    const a = mapMenuKey(e.code);
    if (e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.code) || e.code === 'Tab') return; // browser shortcuts stay
    this.h.any();
    if (a !== null) {
      this.h.action(a);
      e.preventDefault();
      e.stopPropagation();
    }
  };

  constructor(private readonly h: MenuInputHandlers) {}

  attach(): void {
    window.addEventListener('keydown', this.onKey, true);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKey, true);
  }

  poll(): void {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const snaps: PadSnapshot[] = [];
    for (const g of list) {
      if (g === null || g === undefined) continue;
      snaps.push({ buttons: g.buttons.map((b) => b.pressed), axes: [...g.axes] });
    }
    const r = this.pads.poll(snaps);
    if (r.anyButton) this.h.any();
    for (const a of r.actions) this.h.action(a);
  }
}
