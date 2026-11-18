// tests/view/titleOptionsCredits.test.ts
// Pure state machines of the title / options / credits screens + flow + persistence.
// Numbers asserted here are the ones documented in docs/TITLE_OPTIONS_CREDITS_ANALYSIS.md
// (Animator clip lengths, UISelect semantics, GamePreferences defaults).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createFlow } from '../../src/main/flow';
import { applyPreferences, getPrefs } from '../../src/main/preferences';
import { SaveData, DEFAULT_PREFERENCES, type StorageLike } from '../../src/view/save/SaveData';
import { CREDIT_PAGES, CREDIT_TIMES, CreditsModel } from '../../src/view/ui/CreditsModel';
import { parseCreditPages } from '../../src/view/ui/CreditsFeature';
import { mapMenuKey, mapPadButton, PadEdges } from '../../src/view/ui/MenuInput';
import { OPTION_ROWS, OptionsModel, type OptionValues } from '../../src/view/ui/OptionsModel';
import { TITLE_ENTRIES, TITLE_TIMES, TitleModel } from '../../src/view/ui/TitleModel';

const defaults: OptionValues = { bgVolume: 1, seVolume: 1, invertY: false, show2PJoinLabel: true, showActionIcon: true };

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe('flow', () => {
  it('title -> stageSelect auto-completes through unclaimed pass-through states', () => {
    const f = createFlow();
    const seen: string[] = [];
    f.onAny((n) => seen.push(n));
    f.onEnter('stageLoading', () => { /* game.ts owns this state */ });
    expect(f.go('title')).toBe(true);
    expect(f.go('stageSelect', { from: 'title' })).toBe(true);
    expect(f.state).toBe('stageLoading'); // stageSelect unclaimed -> default next
    f.complete('stageLoading');
    expect(f.state).toBe('playing'); // intro unclaimed -> pass-through
    expect(seen).toEqual(['title', 'stageSelect', 'stageLoading', 'intro', 'playing']);
  });
  it('a claimed stageSelect waits for its owner', () => {
    const f = createFlow();
    f.claim('stageSelect');
    f.go('title');
    f.go('stageSelect');
    expect(f.state).toBe('stageSelect');
    f.go('stageLoading', { stageId: 'tl_stage_002' });
    expect(f.ctx.stageId).toBe('tl_stage_002');
  });
  it('rejects edges that are not allowed', () => {
    const f = createFlow();
    expect(f.go('credits')).toBe(false);
    expect(f.state).toBe('boot');
  });
  it('options/credits return to title', () => {
    const f = createFlow();
    f.go('title');
    f.go('options');
    expect(f.go('stageSelect')).toBe(false);
    expect(f.go('title')).toBe(true);
    f.go('credits');
    expect(f.go('title')).toBe(true);
  });
});

describe('TitleModel (title_screen_ctrl)', () => {
  it('plays the jingle at the start of InStart (t=0) when audio is already running', () => {
    const m = new TitleModel({ needsGesture: false });
    expect(m.phase).toBe('intro');
    expect(m.drain()).toEqual([{ type: 'sfx', name: 'titlejingle' }]);
  });
  it('gate waits for a gesture, then InStart 2.5 s, then StartIdle', () => {
    const m = new TitleModel({ needsGesture: true });
    expect(m.phase).toBe('gate');
    m.update(10);
    expect(m.phase).toBe('gate');
    expect(m.press()).toBe(true);
    expect(m.drain()).toContainEqual({ type: 'sfx', name: 'titlejingle' });
    m.update(TITLE_TIMES.inStart - 0.01);
    expect(m.phase).toBe('intro');
    m.update(0.02);
    expect(m.phase).toBe('pressStart');
  });
  it('StartPressed is latched while InStart plays', () => {
    const m = new TitleModel({ needsGesture: false });
    m.press();
    m.update(TITLE_TIMES.inStart + 0.001);
    expect(m.phase).toBe('startOut');
    m.update(TITLE_TIMES.startOut + 0.001);
    expect(m.phase).toBe('menu');
    expect(m.menuInteractive).toBe(true);
  });
  it('menu navigation wraps; Play fires the action after the Out clip (0.667 s)', () => {
    const m = new TitleModel({ needsGesture: false });
    m.update(TITLE_TIMES.inStart);
    m.press();
    m.update(TITLE_TIMES.startOut);
    m.drain();
    m.move(-1);
    expect(TITLE_ENTRIES[m.selected]!.id).toBe('credits');
    m.move(1);
    expect(TITLE_ENTRIES[m.selected]!.id).toBe('play');
    m.confirm();
    expect(m.phase).toBe('hiding');
    m.update(TITLE_TIMES.out - 0.01);
    expect(m.drain().some((e) => e.type === 'action')).toBe(false);
    m.update(0.02);
    expect(m.drain()).toContainEqual({ type: 'action', action: 'play' });
    expect(m.phase).toBe('away');
  });
  it('returns from options to an interactive menu', () => {
    const m = new TitleModel({ needsGesture: false });
    m.update(TITLE_TIMES.inStart); m.press(); m.update(TITLE_TIMES.startOut);
    m.move(1);
    m.confirm(); m.update(1);
    expect(m.drain()).toContainEqual({ type: 'action', action: 'options' });
    m.returnFromSubScreen();
    expect(m.phase).toBe('returning');
    m.update(TITLE_TIMES.returning);
    expect(m.menuInteractive).toBe(true);
  });
});

describe('OptionsModel (OptionMenuController)', () => {
  it('InitFromSettings: volumes are round(v*10); defaults per GamePreferences ctor', () => {
    const m = new OptionsModel({ ...defaults, bgVolume: 0.7, seVolume: 0.25 }, () => false);
    expect(m.index[1]).toBe(7);
    expect(m.index[2]).toBe(2); // Mathf.RoundToInt(2.5) = 2 (half-to-even)
  });
  it('rows are the six active prefab rows in prefab order with prefab y', () => {
    expect(OPTION_ROWS.map((r) => [r.id, r.y])).toEqual([
      ['controls', 421], ['bgm', 503], ['se', 585], ['invertY', 667], ['show2P', 749], ['actionIcon', 831],
    ]);
  });
  it('UISelect clamps at 0..10 and emits live audio levels only when the value changed', () => {
    const m = new OptionsModel(defaults, () => false);
    m.moveRow(1);
    m.drain();
    m.adjust(1); // already 10
    expect(m.drain()).toEqual([]);
    m.adjust(-1);
    const ev = m.drain();
    expect(ev).toContainEqual({ type: 'audioLevels', bg: 0.9, se: 1 });
    expect(m.index[1]).toBe(9);
    expect(m.haveAnyValuesChanged).toBe(true);
  });
  it('navigation does not wrap (Unity vertical nav)', () => {
    const m = new OptionsModel(defaults, () => false);
    m.moveRow(-1);
    expect(m.row).toBe(0);
    for (let i = 0; i < 10; i++) m.moveRow(1);
    expect(m.row).toBe(OPTION_ROWS.length - 1);
  });
  it('cancel with changes asks to save; Yes applies, No reverts audio levels', () => {
    const m = new OptionsModel(defaults, () => false);
    m.moveRow(1); m.adjust(-1); m.adjust(-1);
    m.drain();
    m.cancel();
    expect(m.dialog?.text).toBe('tl_dialog_text_001');
    m.answer(true);
    const ev = m.drain();
    const ap = ev.find((e) => e.type === 'apply');
    expect(ap).toMatchObject({ type: 'apply', values: { bgVolume: 0.8 } });
    expect(ev.at(-1)).toEqual({ type: 'close' });

    const n = new OptionsModel(defaults, () => false);
    n.moveRow(1); n.adjust(-1); n.drain();
    n.cancel(); n.answer(false);
    const ev2 = n.drain();
    expect(ev2).toContainEqual({ type: 'audioLevels', bg: 1, se: 1 });
    expect(ev2.some((e) => e.type === 'apply')).toBe(false);
    expect(ev2.at(-1)).toEqual({ type: 'close' });
  });
  it('cancel without changes closes immediately; confirm without changes does nothing', () => {
    const m = new OptionsModel(defaults, () => false);
    m.moveRow(1);
    m.confirm();
    expect(m.dialog).toBeNull();
    m.cancel();
    expect(m.drain().at(-1)).toEqual({ type: 'close' });
  });
  it('confirm on the Controls button opens the controls panel', () => {
    const m = new OptionsModel(defaults, () => false);
    m.confirm();
    expect(m.drain()).toContainEqual({ type: 'controls' });
  });
  it('reset is offered only with non-default prefs or edits (HasNonDefaultProperties) and restores defaults', () => {
    const m = new OptionsModel({ ...defaults, invertY: true }, () => true);
    expect(m.canReset).toBe(true);
    m.requestReset();
    expect(m.dialog?.text).toBe('tl_dialog_text_002');
    m.answer(true);
    expect(m.drain()).toContainEqual({ type: 'reset', values: defaults });
    expect(m.index[3]).toBe(0);
    expect(new OptionsModel(defaults, () => false).canReset).toBe(false);
  });
  it('toggle rows: text selects switch between the two labels', () => {
    const m = new OptionsModel(defaults, () => false);
    for (let i = 0; i < 3; i++) m.moveRow(1); // invertY
    m.adjust(1);
    expect(m.values().invertY).toBe(true);
    m.confirm();
    m.answer(true);
    expect(m.drain().find((e) => e.type === 'apply')).toMatchObject({ values: { invertY: true } });
  });
});

describe('CreditsModel (credit_screen_ctrl)', () => {
  it('auto-run length = 7*(1.5+8) + 6*0.5 + 4.0 s', () => {
    expect(CreditsModel.totalSeconds()).toBeCloseTo(7 * 9.5 + 3 + 4, 6);
    const m = new CreditsModel();
    let t = 0;
    while (!m.done && t < 200) { m.update(0.05); t += 0.05; }
    expect(t).toBeCloseTo(CreditsModel.totalSeconds(), 0);
    expect(m.page).toBe(CREDIT_PAGES - 1);
  });
  it('In 1.5 s fades in, Idle 8 s, Out 0.5 s, then next page In', () => {
    const m = new CreditsModel();
    m.update(CREDIT_TIMES.in / 2);
    expect(m.alpha).toBeCloseTo(0.5, 5);
    m.update(CREDIT_TIMES.in / 2 + 0.001);
    expect(m.stage).toBe('idle');
    m.update(CREDIT_TIMES.idle);
    expect(m.stage).toBe('out');
    m.update(CREDIT_TIMES.out);
    expect([m.page, m.stage]).toEqual([1, 'in']);
  });
  it('Skip jumps to the next page Idle; on the last page it starts the 4 s Out; Cancel ends', () => {
    const m = new CreditsModel();
    m.skip();
    expect([m.page, m.stage]).toEqual([1, 'idle']);
    for (let i = 0; i < 5; i++) m.skip();
    expect(m.page).toBe(CREDIT_PAGES - 1);
    m.skip();
    expect(m.stage).toBe('out');
    m.update(CREDIT_TIMES.outLast + 0.01);
    expect(m.done).toBe(true);
    const c = new CreditsModel();
    c.cancel();
    expect(c.done && c.cancelled).toBe(true);
  });
  it('credits prefab data: 7 pages with positioned text (extracted title-ui.json)', () => {
    const ui = JSON.parse(readFileSync('public/assets/ui/title-ui.json', 'utf8')) as { credits: Parameters<typeof parseCreditPages>[0] };
    const pages = parseCreditPages(ui.credits);
    expect(pages).toHaveLength(CREDIT_PAGES);
    expect(pages[0]!.items[0]).toMatchObject({ label: 'tl_credit_title_001', x: 960, y: 242 });
    const strings = JSON.parse(readFileSync('public/assets/ui/strings.json', 'utf8')) as Record<string, string>;
    const labels = pages.flatMap((p) => p.items.map((i) => i.label)).filter((l) => !l.includes('kana'));
    expect(labels.filter((l) => strings[l] === undefined)).toEqual([]);
    expect(strings.tl_credit_name_002).toBe('Dylan Cuthbert');
  });
});

describe('MenuInput', () => {
  it('maps keys and pad buttons', () => {
    expect(mapMenuKey('Enter')).toBe('confirm');
    expect(mapMenuKey('Escape')).toBe('cancel');
    expect(mapMenuKey('KeyR')).toBe('reset');
    expect(mapMenuKey('KeyW')).toBe('up');
    expect(mapMenuKey('F5')).toBeNull();
    expect(mapPadButton(0)).toBe('confirm');
    expect(mapPadButton(1)).toBe('cancel');
    expect(mapPadButton(15)).toBe('right');
  });
  it('PadEdges is edge-triggered and treats any other button as "any"', () => {
    const e = new PadEdges();
    const down = (b: number): { buttons: boolean[]; axes: number[] } => ({ buttons: Array.from({ length: 16 }, (_, i) => i === b), axes: [0, 0] });
    expect(e.poll([down(0)])).toEqual({ actions: ['confirm'], anyButton: true });
    expect(e.poll([down(0)])).toEqual({ actions: [], anyButton: false });
    expect(e.poll([down(5)]).anyButton).toBe(true);
    expect(e.poll([{ buttons: [], axes: [0, 0.9] }]).actions).toEqual(['down']);
  });
});

describe('preferences persistence + apply', () => {
  it('defaults match Q4.GamePreferences ctor', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ bgVolume: 1, seVolume: 1, invertY: false, show2PJoinLabel: true, showActionIcon: true });
  });
  it('setPreferences round-trips through storage; hasNonDefault/reset follow HasNonDefaultPreferences', () => {
    const st = mem();
    const s = new SaveData(st);
    expect(s.hasNonDefaultPreferences()).toBe(false);
    s.setPreferences({ bgVolume: 0.3, invertY: true });
    expect(new SaveData(st).preferences).toMatchObject({ bgVolume: 0.3, invertY: true, seVolume: 1 });
    expect(s.hasNonDefaultPreferences()).toBe(true);
    s.resetPreferences();
    expect(s.preferences).toMatchObject({ bgVolume: 1, invertY: false });
    expect(s.hasNonDefaultPreferences()).toBe(false);
  });
  it('old blobs without the new fields load with defaults; garbage volumes are clamped', () => {
    const st = mem();
    st.setItem('pjm2-web.save', JSON.stringify({ version: 3, stages: {}, preferences: { muted: true, bgVolume: 7 } }));
    const p = new SaveData(st).preferences;
    expect(p.muted).toBe(true);
    expect(p.bgVolume).toBe(1);
    expect(p.showActionIcon).toBe(true);
  });
  it('applyPreferences drives the audio buses and notifies subscribers', () => {
    const calls: Array<[string, number]> = [];
    const audio = { setBgmVolume: (v: number) => calls.push(['bgm', v]), setSeVolume: (v: number) => calls.push(['se', v]) };
    applyPreferences(audio, { ...DEFAULT_PREFERENCES, bgVolume: 0.4, seVolume: 0.6 });
    expect(calls).toEqual([['bgm', 0.4], ['se', 0.6]]);
    expect(getPrefs().bgVolume).toBe(0.4);
  });
});
