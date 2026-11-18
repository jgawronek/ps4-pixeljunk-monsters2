// tests/view/gameShell.test.ts
// GameShell (pause menu + stage results) against a MINIMAL fake DOM — no
// jsdom, no browser. The shim only implements what the module uses:
// createElement + appendChild + remove + textContent + style{} +
// addEventListener/removeEventListener. document/window are stubbed onto
// globalThis per test (vi.stubGlobal) and restored afterwards.
//
// Shim semantics: textContent is an element's OWN text (the module only
// sets it on leaves); containers are traversed via .children.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  GameShell,
  type ShellCallbacks,
  type ResultsData,
} from '../../src/view/ui/GameShell';

// ---- minimal DOM shim --------------------------------------------------------

class FakeEventTarget {
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

class FakeElement extends FakeEventTarget {
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly style: Record<string, string> = {};
  textContent = '';
  constructor(readonly tagName: string) { super(); }
  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (this.parent === null) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
}

class FakeDocument {
  readonly body = new FakeElement('body');
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
}

class FakeWindow extends FakeEventTarget {}

let doc: FakeDocument;
let win: FakeWindow;

function installDom(): void {
  doc = new FakeDocument();
  win = new FakeWindow();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
}

afterEach(() => { vi.unstubAllGlobals(); });

// ---- traversal / action helpers ----------------------------------------------

function walk(root: FakeElement, out: FakeElement[] = []): FakeElement[] {
  out.push(root);
  for (const c of root.children) walk(c, out);
  return out;
}

function byText(root: FakeElement, text: string): FakeElement {
  const hit = walk(root).find((e) => e.textContent === text);
  if (hit === undefined) throw new Error(`no element with text ${JSON.stringify(text)}`);
  return hit;
}

function button(root: FakeElement, label: string): FakeElement {
  const hit = walk(root).find((e) => e.tagName === 'button' && e.textContent === label);
  if (hit === undefined) throw new Error(`no button ${JSON.stringify(label)}`);
  return hit;
}

function hasButton(root: FakeElement, label: string): boolean {
  return walk(root).some((e) => e.tagName === 'button' && e.textContent === label);
}

/** The attached overlay whose subtree contains the given text. */
function overlayWithText(text: string): FakeElement {
  const hit = doc.body.children.find((c) => walk(c).some((e) => e.textContent === text));
  if (hit === undefined) throw new Error(`no overlay containing ${JSON.stringify(text)}`);
  return hit;
}

/** Stat rows are [labelSpan, valueSpan] — read the value next to a label. */
function statValue(root: FakeElement, label: string): string {
  const row = byText(root, label).parent;
  if (row === null) throw new Error(`stat ${label} has no row`);
  return row.children[1].textContent;
}

/** Click with a real-ish event; reports whether stopPropagation was called. */
function click(el: FakeElement): { stopped: boolean } {
  const ev = { stopped: false, stopPropagation(): void { this.stopped = true; } };
  el.dispatch('click', ev);
  return ev;
}

function esc(): void {
  win.dispatch('keydown', { key: 'Escape' });
}

// ---- fixtures ------------------------------------------------------------------

function makeCallbacks(overrides: Partial<ShellCallbacks> = {}) {
  const calls = { resume: 0, restart: 0, mute: 0 };
  let muted = false;
  const cb: ShellCallbacks = {
    onResume: () => { calls.resume++; },
    onRestart: () => { calls.restart++; },
    onToggleMute: () => { calls.mute++; muted = !muted; return muted; },
    ...overrides,
  };
  return { calls, cb };
}

const RESULTS: ResultsData = {
  won: true, perfect: true,
  wavesCleared: 5, totalWaves: 5,
  kills: 42, coinsEarned: 310, gemsEarned: 7,
  chibisSaved: 20, chibisTotal: 20,
  timeSeconds: 125, // → 2:05
};

function attachedShell(cb: ShellCallbacks): GameShell {
  installDom();
  const shell = new GameShell(cb);
  shell.attach();
  return shell;
}

// ---- tests ---------------------------------------------------------------------

describe('GameShell', () => {
  it('constructs without a DOM; attach() throws a clear Node error; pre-attach calls are no-ops', () => {
    // No document/window stubs here — pure Node.
    const shell = new GameShell(makeCallbacks().cb);
    expect(shell.paused).toBe(false);
    expect(shell.resultsVisible).toBe(false);
    expect(() => shell.attach()).toThrow(/document/i);
    // Cosmetic never-throw: show/hide before attach do nothing.
    shell.showPause();
    shell.togglePause();
    shell.showResults(RESULTS);
    shell.hideResults();
    shell.setMuted(true);
    shell.detach();
    expect(shell.paused).toBe(false);
    expect(shell.resultsVisible).toBe(false);
  });

  it('attach appends two hidden overlays; detach removes them (both idempotent)', () => {
    const shell = attachedShell(makeCallbacks().cb);
    expect(doc.body.children.length).toBe(2);
    for (const o of doc.body.children) {
      expect(o.style.display).toBe('none');
      expect(o.style.pointerEvents).toBe('none');
      expect(o.style.opacity).toBe('0');
    }
    shell.attach(); // idempotent
    expect(doc.body.children.length).toBe(2);
    shell.detach();
    expect(doc.body.children.length).toBe(0);
    shell.detach(); // safe twice
    expect(doc.body.children.length).toBe(0);
  });

  it('showPause/hidePause manage display, fade opacity and backdrop pointer-events', () => {
    const shell = attachedShell(makeCallbacks().cb);
    const pause = doc.body.children[0];
    shell.showPause();
    expect(shell.paused).toBe(true);
    expect(pause.style.display).toBe('flex');
    expect(pause.style.opacity).toBe('1');
    expect(pause.style.pointerEvents).toBe('auto'); // blocks canvas input
    expect(pause.style.transition).toContain('opacity'); // inline CSS fade
    expect(byText(pause, 'PAUSED')).toBeTruthy();
    shell.hidePause();
    expect(shell.paused).toBe(false);
    expect(pause.style.display).toBe('none');
    expect(pause.style.opacity).toBe('0');
    expect(pause.style.pointerEvents).toBe('none');
  });

  it('togglePause and Esc flip the pause state; other keys are ignored', () => {
    const shell = attachedShell(makeCallbacks().cb);
    shell.togglePause();
    expect(shell.paused).toBe(true);
    esc();
    expect(shell.paused).toBe(false);
    esc();
    expect(shell.paused).toBe(true);
    win.dispatch('keydown', { key: 'KeyW' });
    expect(shell.paused).toBe(true); // only Escape
    shell.hidePause();
    expect(shell.paused).toBe(false);
  });

  it('Esc is ignored while results are visible and after detach', () => {
    const shell = attachedShell(makeCallbacks().cb);
    shell.showResults(RESULTS);
    esc();
    expect(shell.paused).toBe(false);
    expect(shell.resultsVisible).toBe(true);
    shell.hideResults();
    shell.detach();
    expect(win.listenerCount('keydown')).toBe(0); // listener removed
    esc(); // no listener → nothing happens, no throw
    expect(shell.paused).toBe(false);
  });

  it('pause buttons fire callbacks exactly once, stop propagation; Resume/Restart hide the menu', () => {
    const { calls, cb } = makeCallbacks();
    const shell = attachedShell(cb);
    shell.showPause();
    const pause = doc.body.children[0];
    const ev = click(button(pause, 'Resume'));
    expect(calls.resume).toBe(1);
    expect(ev.stopped).toBe(true); // panel clicks never reach the canvas
    expect(shell.paused).toBe(false);
    shell.showPause();
    click(button(pause, 'Restart'));
    expect(calls.restart).toBe(1);
    expect(shell.paused).toBe(false);
    expect(calls.resume).toBe(1); // no cross-firing
  });

  it('mute label flips from the onToggleMute return; setMuted updates without the callback', () => {
    const { calls, cb } = makeCallbacks();
    const shell = new GameShell(cb);
    shell.setMuted(true); // pre-attach state survives attach()
    installDom();
    shell.attach();
    shell.showPause();
    const mute = button(doc.body.children[0], '🔇 Muted');
    click(mute); // fake toggles false→true, returns true
    expect(calls.mute).toBe(1);
    expect(mute.textContent).toBe('🔇 Muted');
    click(mute); // returns false
    expect(calls.mute).toBe(2);
    expect(mute.textContent).toBe('🔊 Sound');
    shell.setMuted(true); // direct update — no callback
    expect(calls.mute).toBe(2);
    expect(mute.textContent).toBe('🔇 Muted');
  });

  it('Quit button exists only when onQuitToTitle is provided, and fires once', () => {
    installDom();
    const noQuit = new GameShell(makeCallbacks().cb);
    noQuit.attach();
    expect(hasButton(doc.body.children[0], 'Quit')).toBe(false);
    noQuit.detach();
    let quits = 0;
    const shell = new GameShell({ ...makeCallbacks().cb, onQuitToTitle: () => { quits++; } });
    shell.attach();
    shell.showPause();
    click(button(doc.body.children[0], 'Quit'));
    expect(quits).toBe(1);
    expect(shell.paused).toBe(false);
  });

  it('results (win/perfect) render header, badge and formatted stat rows', () => {
    const shell = attachedShell(makeCallbacks().cb);
    shell.showResults(RESULTS);
    expect(shell.resultsVisible).toBe(true);
    const results = overlayWithText('STAGE CLEAR!');
    expect(results.style.display).toBe('flex');
    expect(results.style.pointerEvents).toBe('auto');
    expect(byText(results, '★ PERFECT ★').style.display).not.toBe('none');
    expect(statValue(results, 'waves')).toBe('5/5');
    expect(statValue(results, 'kills')).toBe('42');
    expect(statValue(results, 'coins')).toBe('310');
    expect(statValue(results, 'gems')).toBe('7');
    expect(statValue(results, 'chibis saved')).toBe('20/20');
    expect(statValue(results, 'time')).toBe('2:05');
    expect(hasButton(results, 'Restart')).toBe(true);
    expect(hasButton(results, 'Resume')).toBe(false); // Resume hidden on results
  });

  it('results (loss) show GAME OVER without the badge; time formats m:ss incl. edges', () => {
    const shell = attachedShell(makeCallbacks().cb);
    shell.showResults({ ...RESULTS, won: false, perfect: false, wavesCleared: 2, chibisSaved: 0, timeSeconds: 0 });
    const results = overlayWithText('GAME OVER');
    expect(byText(results, '★ PERFECT ★').style.display).toBe('none');
    expect(statValue(results, 'waves')).toBe('2/5');
    expect(statValue(results, 'chibis saved')).toBe('0/20');
    expect(statValue(results, 'time')).toBe('0:00');
    shell.showResults({ ...RESULTS, won: false, timeSeconds: 65 });
    expect(statValue(results, 'time')).toBe('1:05');
    shell.showResults({ ...RESULTS, won: true, timeSeconds: 3661 });
    expect(statValue(results, 'time')).toBe('61:01'); // minutes uncapped
    expect(byText(results, 'STAGE CLEAR!')).toBeTruthy(); // header re-renders
  });

  it('showResults hides an open pause menu; results Restart fires once and hides the screen', () => {
    const { calls, cb } = makeCallbacks();
    const shell = attachedShell(cb);
    shell.showPause();
    shell.showResults(RESULTS);
    expect(shell.paused).toBe(false);
    expect(doc.body.children[0].style.display).toBe('none');
    const results = overlayWithText('STAGE CLEAR!');
    click(button(results, 'Restart'));
    expect(calls.restart).toBe(1);
    expect(shell.resultsVisible).toBe(false);
    expect(results.style.display).toBe('none');
    expect(results.style.pointerEvents).toBe('none');
  });

  it('hideResults restores Esc; detach resets pause/results state', () => {
    const shell = attachedShell(makeCallbacks().cb);
    shell.showResults(RESULTS);
    shell.hideResults();
    expect(shell.resultsVisible).toBe(false);
    expect(overlayWithText('STAGE CLEAR!').style.display).toBe('none');
    esc(); // works again once results are gone
    expect(shell.paused).toBe(true);
    shell.detach();
    expect(shell.paused).toBe(false);
    expect(shell.resultsVisible).toBe(false);
    expect(doc.body.children.length).toBe(0);
  });
});
