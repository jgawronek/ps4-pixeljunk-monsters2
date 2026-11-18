// tests/view/hudLayout.test.ts
// HudLayout (gameplay HUD panels) against a MINIMAL fake DOM — no jsdom, no
// browser. Same shim as tests/view/gameShell.test.ts: createElement +
// appendChild + remove + textContent + style{} (+ addEventListener surface,
// unused here). document is stubbed onto globalThis per test (vi.stubGlobal)
// and restored afterwards.
//
// Shim semantics: textContent is an element's OWN text (the module only sets
// it on leaves); containers are traversed via .children.
//
// Panel order in the container: [0] stage/currencies (top-left),
// [1] wave (top-right), [2] prompt (bottom-center, hidden until setPrompt).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HudLayout, type HudState, type HudStrings } from '../../src/view/ui/HudLayout';

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

let doc: FakeDocument;

function installDom(): void {
  doc = new FakeDocument();
  vi.stubGlobal('document', doc);
}

afterEach(() => { vi.unstubAllGlobals(); });

// ---- traversal helpers ---------------------------------------------------------

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

/** Counter rows are [icon?, value, (total), label] — the value sits right
 *  before/after its label. Returns the row containing the label. */
function rowOf(root: FakeElement, label: string): FakeElement {
  const row = byText(root, label).parent;
  if (row === null) throw new Error(`label ${label} has no row`);
  return row;
}

// ---- fixtures ------------------------------------------------------------------

const STATE: HudState = {
  coins: 310, gems: 7,
  chibisSaved: 17, chibisTotal: 20,
  kills: 42,
  wave: 3, totalWaves: 10,
  stageName: 'tl_stage_001', difficulty: 'Medium',
};

interface Attached {
  hud: HudLayout;
  container: FakeElement;
  stage: FakeElement;
  wave: FakeElement;
  prompt: FakeElement;
}

function attachedHud(strings?: HudStrings): Attached {
  installDom();
  const container = new FakeElement('div');
  const hud = new HudLayout(strings);
  hud.attach(container as unknown as HTMLElement);
  const [stage, wave, prompt] = container.children;
  return { hud, container, stage, wave, prompt };
}

/** stage panel header row: [stagePrefix, stageName, difficultyPrefix, difficulty]. */
function header(stage: FakeElement): FakeElement {
  return stage.children[0];
}

/** wave panel: [labelRow, track]; track: [fill]. */
function waveFill(wave: FakeElement): FakeElement {
  return wave.children[1].children[0];
}

// ---- tests ---------------------------------------------------------------------

describe('HudLayout', () => {
  it('constructs without a DOM; attach() throws a clear Node error; pre-attach calls are no-ops', () => {
    // No document stub here — pure Node.
    const hud = new HudLayout();
    expect(() => hud.attach(new FakeElement('div') as unknown as HTMLElement)).toThrow(/document/i);
    // Cosmetic never-throw: refresh/prompt/detach before attach do nothing.
    hud.update(STATE);
    hud.setPrompt('defend the chibis!');
    hud.setPrompt(null);
    hud.detach();
  });

  it('attach builds three positioned panels and is idempotent', () => {
    const { hud, container, stage, wave, prompt } = attachedHud();
    expect(container.children.length).toBe(3);
    expect(stage.style.top).toBe('10px');
    expect(stage.style.left).toBe('10px');
    expect(wave.style.top).toBe('10px');
    expect(wave.style.right).toBe('10px');
    expect(prompt.style.bottom).toBe('12%');
    expect(prompt.style.left).toBe('50%');
    expect(prompt.style.display).toBe('none'); // hidden until setPrompt
    hud.attach(container as unknown as HTMLElement); // idempotent
    expect(container.children.length).toBe(3);
  });

  it('panels use the demo dark-translucent style (rgba .55, 8px radius, monospace, no pointer)', () => {
    const { stage, wave, prompt } = attachedHud();
    for (const panel of [stage, wave, prompt]) {
      expect(panel.style.position).toBe('fixed');
      expect(panel.style.background).toBe('rgba(0,0,0,0.55)');
      expect(panel.style.borderRadius).toBe('8px');
      expect(panel.style.font).toContain('monospace');
      expect(panel.style.pointerEvents).toBe('none'); // canvas keeps input
    }
  });

  it('update fills coin and gem counters with icons and default labels', () => {
    const { hud, stage } = attachedHud();
    hud.update(STATE);
    const coinRow = rowOf(stage, 'coins');
    expect(coinRow.children[0].textContent).toBe('◉');
    expect(coinRow.children[1].textContent).toBe('310');
    expect(coinRow.children[1].style.color).toBe('#ffd34d');
    const gemRow = rowOf(stage, 'gems');
    expect(gemRow.children[0].textContent).toBe('◆');
    expect(gemRow.children[1].textContent).toBe('7');
    hud.update({ ...STATE, coins: 0, gems: 1234 });
    expect(coinRow.children[1].textContent).toBe('0');
    expect(gemRow.children[1].textContent).toBe('1234');
  });

  it('update fills the chibi counter as value + "/total" (two text fields, faithful "/{0}")', () => {
    const { hud, stage } = attachedHud();
    hud.update(STATE);
    const row = rowOf(stage, 'chibis');
    expect(row.children[0].textContent).toBe('♥');
    expect(row.children[1].textContent).toBe('17'); // chibiText
    expect(row.children[2].textContent).toBe('/20'); // totalChibiText "/{0}"
    hud.update({ ...STATE, chibisSaved: 20 });
    expect(row.children[1].textContent).toBe('20');
    expect(row.children[2].textContent).toBe('/20');
  });

  it('update fills stage name, difficulty and kills', () => {
    const { hud, stage } = attachedHud();
    hud.update(STATE);
    expect(header(stage).children[1].textContent).toBe('tl_stage_001');
    expect(header(stage).children[3].textContent).toBe('Medium');
    expect(rowOf(stage, 'kills').children[1].textContent).toBe('42');
    hud.update({ ...STATE, stageName: 'tl_stage_002', difficulty: 'Hard', kills: 99 });
    expect(header(stage).children[1].textContent).toBe('tl_stage_002');
    expect(header(stage).children[3].textContent).toBe('Hard');
    expect(rowOf(stage, 'kills').children[1].textContent).toBe('99');
  });

  it('update renders wave NN/NN (D2 zero-pad) and sets the progress bar width %', () => {
    const { hud, wave } = attachedHud();
    hud.update(STATE);
    expect(rowOf(wave, 'wave').children[1].textContent).toBe('03/10');
    expect(waveFill(wave).style.width).toBe('30%');
    hud.update({ ...STATE, wave: 10 });
    expect(rowOf(wave, 'wave').children[1].textContent).toBe('10/10');
    expect(waveFill(wave).style.width).toBe('100%');
  });

  it('wave bar edges: zero total, overflow clamp, fractional rounding, pre-start wave 0', () => {
    const { hud, wave } = attachedHud();
    hud.update({ ...STATE, wave: 3, totalWaves: 0 });
    expect(waveFill(wave).style.width).toBe('0%');
    expect(rowOf(wave, 'wave').children[1].textContent).toBe('03/00');
    hud.update({ ...STATE, wave: 12, totalWaves: 10 });
    expect(waveFill(wave).style.width).toBe('100%'); // clamped
    hud.update({ ...STATE, wave: 1, totalWaves: 3 });
    expect(waveFill(wave).style.width).toBe('33.33%'); // 2-decimal rounding
    hud.update({ ...STATE, wave: 0, totalWaves: 10 });
    expect(waveFill(wave).style.width).toBe('0%');
    expect(rowOf(wave, 'wave').children[1].textContent).toBe('00/10');
  });

  it('setPrompt shows/hides the bottom line; pre-attach prompt survives attach', () => {
    const hud = new HudLayout();
    hud.setPrompt('walk over coins to collect'); // before attach — remembered
    installDom();
    const container = new FakeElement('div');
    hud.attach(container as unknown as HTMLElement);
    const prompt = container.children[2];
    expect(prompt.textContent).toBe('walk over coins to collect');
    expect(prompt.style.display).toBe('block');
    hud.setPrompt(null);
    expect(prompt.style.display).toBe('none');
    expect(prompt.textContent).toBe('');
    hud.setPrompt('defend the chibis!');
    expect(prompt.style.display).toBe('block');
    expect(prompt.textContent).toBe('defend the chibis!');
    hud.setPrompt(''); // empty string hides too
    expect(prompt.style.display).toBe('none');
  });

  it('strings record overrides every label', () => {
    const { hud, stage, wave } = attachedHud({
      coin: 'COINS', gem: 'GEMS', wave: 'WAVE', chibis: 'CHIBIS', kills: 'KILLS',
      stage: 'STAGE', difficulty: 'DIFF',
    });
    hud.update(STATE);
    expect(rowOf(stage, 'COINS').children[1].textContent).toBe('310');
    expect(rowOf(stage, 'GEMS').children[1].textContent).toBe('7');
    expect(rowOf(stage, 'CHIBIS').children[1].textContent).toBe('17');
    expect(rowOf(stage, 'KILLS').children[1].textContent).toBe('42');
    expect(rowOf(wave, 'WAVE').children[1].textContent).toBe('03/10');
    expect(header(stage).children[0].textContent).toBe('STAGE'); // prefix label
    expect(header(stage).children[1].textContent).toBe('tl_stage_001');
    expect(header(stage).children[2].textContent).toBe('DIFF'); // difficulty prefix
    expect(header(stage).children[3].textContent).toBe('Medium'); // value from state
  });

  it('detach removes all panels, is safe twice, and re-attach restores the prompt', () => {
    const { hud, container } = attachedHud();
    hud.update(STATE);
    hud.setPrompt('defend the chibis!');
    hud.detach();
    expect(container.children.length).toBe(0);
    hud.detach(); // safe twice
    expect(container.children.length).toBe(0);
    hud.update(STATE); // no-op while detached — never throws
    hud.attach(container as unknown as HTMLElement);
    expect(container.children.length).toBe(3);
    expect(container.children[2].textContent).toBe('defend the chibis!');
    expect(container.children[2].style.display).toBe('block');
  });

  it('repeated updates never rebuild the DOM (textContent/style.width only)', () => {
    const { hud, container, stage, wave } = attachedHud();
    hud.update(STATE);
    const counts = walk(container).map((e) => e.children.length);
    const coinValue = rowOf(stage, 'coins').children[1];
    const fill = waveFill(wave);
    for (let i = 0; i < 5; i++) {
      hud.update({ ...STATE, coins: STATE.coins + i, wave: (i % 10) + 1 });
    }
    // Same tree shape, same leaf elements — only their text/width changed.
    expect(walk(container).map((e) => e.children.length)).toEqual(counts);
    expect(rowOf(stage, 'coins').children[1]).toBe(coinValue);
    expect(waveFill(wave)).toBe(fill);
    expect(coinValue.textContent).toBe('314');
    expect(fill.style.width).toBe('50%');
    // The shim has no innerHTML surface; the module must never need one.
    expect(walk(container).every((e) => !('innerHTML' in e))).toBe(true);
  });
});
