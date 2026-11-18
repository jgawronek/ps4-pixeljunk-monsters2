// tests/view/gameUi.test.ts
// Original-art in-game UI: bitmap-font layout against the REAL extracted font
// metrics, wave-call logic against the real string table, the build-ring state
// machine against the prefab-extracted slot table, and the shell skin hook.
// Data-dependent tests skip when public/assets/ui has not been extracted.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { BitmapFont, type FontData } from '../../src/view/ui/UiAssets';
import { edgeInset, refOffset, screenToRef, uiScale } from '../../src/view/ui/UiDom';
import {
  CLEAR_CALL_SECONDS, GAME_OVER_DELAY, STAGE_CLEAR_DELAY, START_CALL_SECONDS,
  callEnvelope, countdownDigit, waveClearCall, waveStartCall,
} from '../../src/view/ui/WaveCalls';
import {
  BuildMenuModel, HISTORY_CATEGORY, MAX_HISTORY, RING_CATEGORIES, angleDistance, slotAngle, stickAngle,
  type BuildTowerEntry,
} from '../../src/view/ui/BuildMenuModel';
import { categoryOffset, slotOffset } from '../../src/view/ui/BuildMenuUi';
import { HUD, iconX } from '../../src/view/ui/OriginalHud';
import { GameShell } from '../../src/view/ui/GameShell';

const UI = resolve(__dirname, '../../public/assets/ui');
const DATA = resolve(__dirname, '../../public/assets/data/towers.json');
const have = existsSync(`${UI}/fonts/Font_02.json`) && existsSync(`${UI}/strings.json`) && existsSync(DATA);
const maybe = have ? describe : describe.skip;

function font(name: string): BitmapFont {
  return new BitmapFont(JSON.parse(readFileSync(`${UI}/fonts/${name}.json`, 'utf8')) as FontData);
}
const strings = have ? (JSON.parse(readFileSync(`${UI}/strings.json`, 'utf8')) as Record<string, string>) : {};
const T = (k: string, f: string): string => (strings[k] !== undefined && strings[k] !== '' ? strings[k] : f);

describe('reference scaler (CanvasScaler 1920x1080)', () => {
  it('matches WIDTH like the original CanvasScaler (match 0) and centres the stage vertically', () => {
    expect(uiScale(1920, 1080)).toBe(1);
    expect(uiScale(960, 540)).toBe(0.5);
    // wider than 16:9: scale still follows the width; the stage is taller than the window (negative offset)
    const wide = refOffset(2000, 1080);
    expect(wide.s).toBeCloseTo(2000 / 1920, 6);
    expect(wide.x).toBe(0);
    expect(wide.y).toBeLessThan(0);
    // taller than 16:9: letterbox rows become extra canvas rows; edgeInset is that extra, per side, in reference px
    const tall = refOffset(1684, 1260);
    expect(tall.s).toBeCloseTo(1684 / 1920, 6);
    expect(edgeInset(1684, 1260)).toBeCloseTo((1260 / (1684 / 1920) - 1080) / 2, 4);
    expect(edgeInset(1920, 1080)).toBe(0);
    // round trip: the reference stage centre maps to the window centre
    expect(screenToRef(960 * tall.s, 1260 / 2, 1684, 1260)).toEqual({ x: 960, y: 540 });
  });
});

maybe('bitmap font (extracted Font_02 / Font_01 metrics)', () => {
  it('WAVE START width matches the reference screenshot (~1440px at 1920)', () => {
    const f2 = font('Font_02');
    const w = f2.measure('WAVE START', 0);
    expect(w).toBeGreaterThan(1380);
    expect(w).toBeLessThan(1480);
    // tracking -15 (start_call_01 Mess) narrows it a little
    expect(f2.measure('WAVE START', -15)).toBeLessThan(w);
  });
  it('kerning pairs apply (Font_02 A-Y = -16)', () => {
    const f2 = font('Font_02');
    expect(f2.measure('AY', 0)).toBe(f2.glyph('A')!.advance + f2.glyph('Y')!.advance - 16);
  });
  it('Font_01 covers the latin subtitle and digits; multiline measure = widest line', () => {
    const f1 = font('Font_01');
    expect(f1.measure('Here they come!', 0)).toBeGreaterThan(450);
    expect(f1.measure('12\nabcdef', 0)).toBe(f1.measure('abcdef', 0));
    expect(f1.glyph('7')).toBeDefined();
  });
});

maybe('wave calls (StartCallMenuController)', () => {
  it('first wave = WAVE START + Here they come!', () => {
    expect(waveStartCall(T, 1, false)).toEqual({ title: 'WAVE START', subtitle: 'Here they come!' });
  });
  it('later waves = WAVE N + More incoming!, last wave = Last push!', () => {
    expect(waveStartCall(T, 3, false)).toEqual({ title: 'WAVE 3', subtitle: 'More incoming!' });
    expect(waveStartCall(T, 10, true)).toEqual({ title: 'WAVE 10', subtitle: 'Last push!' });
  });
  it('m_showWaveStartCall=true shows WAVE 1 for the first wave', () => {
    expect(waveStartCall(T, 1, false, true).title).toBe('WAVE 1');
  });
  it('wave clear = WAVE N + You made it!', () => {
    expect(waveClearCall(T, 4)).toEqual({ title: 'WAVE 4', subtitle: 'You made it!' });
  });
});

describe('call timing', () => {
  it('prefab durations', () => {
    expect(START_CALL_SECONDS).toBe(4.0);
    expect(CLEAR_CALL_SECONDS).toBe(3.0);
    expect(STAGE_CLEAR_DELAY).toBe(5.0);
    expect(GAME_OVER_DELAY).toBe(6.0);
  });
  it('envelope pops in, holds and fades out', () => {
    expect(callEnvelope(-1, 4).alpha).toBe(0);
    expect(callEnvelope(0.01, 4).scale).toBeGreaterThan(1.3);
    expect(callEnvelope(2, 4)).toEqual({ alpha: 1, scale: 1 });
    expect(callEnvelope(3.9, 4).alpha).toBeLessThan(0.5);
    expect(callEnvelope(4.5, 4).alpha).toBe(0);
  });
  it('countdown digit 3-2-1 then hidden', () => {
    expect(countdownDigit(3.4)).toBe(0);
    expect(countdownDigit(2.9)).toBe(3);
    expect(countdownDigit(1.2)).toBe(2);
    expect(countdownDigit(0.3)).toBe(1);
    expect(countdownDigit(0)).toBe(0);
  });
});

describe('HUD layout numbers (Hud_02)', () => {
  it('monster icons walk from the bar start to the home end', () => {
    expect(iconX(0)).toBe(HUD.iconStartX);
    expect(iconX(1)).toBe(HUD.iconEndX);
    expect(iconX(2)).toBe(HUD.iconEndX);
    expect(HUD.trackRight - HUD.trackLeft).toBe(440);
  });
});

describe('ring geometry (Hud_TowerRing)', () => {
  it('slots are 45 deg steps clockwise from up on a ~207 radius', () => {
    expect(slotOffset(1).x).toBeCloseTo(0);
    expect(slotOffset(1).y).toBeCloseTo(-207); // up
    expect(slotOffset(3).x).toBeCloseTo(207);
    expect(slotOffset(5).y).toBeCloseTo(207);
    expect(slotOffset(7).x).toBeCloseTo(-207);
    expect(categoryOffset(0).y).toBe(-150);
    expect(categoryOffset(1).x).toBeCloseTo(150);
  });
  it('stick angle is clockwise from up (rodata 360 mirror)', () => {
    expect(stickAngle(0, 1)).toBeCloseTo(0);
    expect(stickAngle(1, 0)).toBeCloseTo(90);
    expect(stickAngle(0, -1)).toBeCloseTo(180);
    expect(stickAngle(-1, 0)).toBeCloseTo(270);
    expect(angleDistance(350, 10)).toBe(20);
    expect(slotAngle(3)).toBe(90);
  });
});

function entries(): Map<number, BuildTowerEntry> {
  const m = new Map<number, BuildTowerEntry>();
  const costs: Record<number, [number, number]> = { 1: [120, 0], 2: [400, 5], 3: [250, 3], 4: [350, 4], 6: [200, 0], 7: [100, 0], 8: [450, 5], 9: [500, 4], 11: [150, 0], 12: [300, 4] };
  for (const [id, [c, g]] of Object.entries(costs)) {
    m.set(+id, { id: +id, name: `tower_${id.padStart(3, '0')}`, costCoin: c, costGem: g, locked: false, singleton: +id === 8 });
  }
  return m; // 5 and 10 (DLC) are absent = empty slots
}

function menu(coins = 1000, gems = 10, hive = false, tweak?: (m: Map<number, BuildTowerEntry>) => void): BuildMenuModel {
  const e = entries();
  tweak?.(e);
  return new BuildMenuModel({ tower: (id) => e.get(id) ?? null, coins: () => coins, gems: () => gems, singletonBuilt: () => hive });
}

describe('build ring model (RingStateBuildCategory / TowerIcon)', () => {
  it('category table matches the Hud_TowerRing prefab', () => {
    expect(RING_CATEGORIES).toHaveLength(4);
    expect(RING_CATEGORIES[3].slots).toEqual({ 1: 4, 2: 5, 5: 6, 6: 2, 7: 1, 8: 3 });
    expect(RING_CATEGORIES[0].slots).toEqual({ 1: 7, 2: 8, 3: 10, 8: 9 });
    expect(RING_CATEGORIES[1].slots).toEqual({ 3: 11, 4: 12 });
    expect(HISTORY_CATEGORY).toBe(2);
  });

  it('opens on a category; history is hidden until something is built', () => {
    const m = menu();
    expect(m.open()).toBe(true);
    expect(m.phase).toBe('category');
    expect(m.visibleCategories()).toEqual([0, 1, 3]);
  });

  it('stick below 0.5 is ignored; direction picks the nearest category', () => {
    const m = menu();
    m.open();
    expect(m.cursor(0.3, 0.3)).toBe(false);
    expect(m.cursor(-1, 0)).toBe(true); // left = Ground
    expect(m.category).toBe(3);
    expect(m.cursor(1, 0)).toBe(true); // right = Air
    expect(m.category).toBe(1);
    expect(m.cursor(0, -1)).toBe(false); // bottom = history, not visible
    expect(m.category).toBe(1);
  });

  it('confirm enters the icon ring on the first occupied slot; empty/DLC slots are skipped', () => {
    const m = menu();
    m.open();
    m.cursor(-1, 0);
    expect(m.confirm()).toEqual({ kind: 'enter-category', category: 3 });
    expect(m.phase).toBe('icon');
    expect(m.slotsOf(3).map((s) => s.slot)).toEqual([1, 5, 6, 7, 8]); // slot 2 (tower_005, DLC) empty
    expect(m.slot).toBe(1);
    expect(m.cursor(0, -1)).toBe(true); // down -> slot 5
    expect(m.slot).toBe(5);
    expect(m.selectedTower()!.name).toBe('tower_006');
  });

  it('build confirm returns the tower and records history (max 3, move-to-front)', () => {
    const m = menu();
    m.open(); m.cursor(-1, 0); m.confirm();
    m.hoverSlot(7);
    const r = m.confirm();
    expect(r.kind).toBe('build');
    if (r.kind === 'build') expect(r.tower.name).toBe('tower_001');
    for (const id of [2, 3, 4, 1]) m.pushHistory(id);
    expect(m.history).toEqual([1, 4, 3]);
    expect(m.history.length).toBeLessThanOrEqual(MAX_HISTORY);
    const m2 = menu();
    m2.pushHistory(6);
    m2.open();
    expect(m2.visibleCategories()).toContain(2);
  });

  it('unaffordable / locked / singleton towers are rejected (greyed state)', () => {
    const poor = menu(100, 0);
    poor.open(); poor.cursor(-1, 0); poor.confirm(); poor.hoverSlot(7); // tower_001 120c
    expect(poor.status(poor.selectedTower()!).coinOk).toBe(false);
    expect(poor.confirm()).toEqual({ kind: 'rejected', reason: 'no-funds' });

    const locked = menu(1000, 10, false, (e) => { e.get(1)!.locked = true; });
    locked.open(); locked.cursor(-1, 0); locked.confirm(); locked.hoverSlot(7);
    expect(locked.confirm()).toEqual({ kind: 'rejected', reason: 'locked' });

    const hive = menu(1000, 10, true);
    hive.open(); hive.confirm(); hive.hoverSlot(2); // category 0 slot 2 = tower_008 singleton
    expect(hive.selectedTower()!.name).toBe('tower_008');
    expect(hive.confirm()).toEqual({ kind: 'rejected', reason: 'singleton' });

    const gemless = menu(1000, 0);
    gemless.open(); gemless.cursor(-1, 0); gemless.confirm(); gemless.hoverSlot(6); // tower_002 400c 5g
    expect(gemless.status(gemless.selectedTower()!).gemOk).toBe(false);
    expect(gemless.confirm()).toEqual({ kind: 'rejected', reason: 'no-funds' });
  });

  it('cancel pops icon -> category -> closed', () => {
    const m = menu();
    m.open(); m.confirm();
    expect(m.cancel()).toBe(false);
    expect(m.phase).toBe('category');
    expect(m.cancel()).toBe(true);
    expect(m.isOpen).toBe(false);
  });

  it('remembers the last category (rememberLastCategory = 1)', () => {
    const m = menu();
    m.open(); m.cursor(-1, 0); m.cancel();
    m.open();
    expect(m.category).toBe(3);
  });
});

maybe('tower definitions data', () => {
  const defs = JSON.parse(readFileSync(DATA, 'utf8')) as { __gameObject: string; costCoin: number; costGem: number; lockable: boolean; dlcLock: number }[];
  it('12 shipping towers, every ring slot resolves', () => {
    expect(defs.map((d) => d.__gameObject)).toEqual(Array.from({ length: 12 }, (_, i) => `tower_${String(i + 1).padStart(3, '0')}`));
    const names = new Set(defs.map((d) => d.__gameObject));
    for (const c of RING_CATEGORIES) for (const id of Object.values(c.slots)) expect(names.has(`tower_${String(id).padStart(3, '0')}`)).toBe(true);
  });
  it('costs / locks match the prefabs', () => {
    const by = Object.fromEntries(defs.map((d) => [d.__gameObject, d]));
    expect([by.tower_001.costCoin, by.tower_001.costGem]).toEqual([120, 0]);
    expect([by.tower_002.costCoin, by.tower_002.costGem]).toEqual([400, 5]);
    expect(by.tower_002.lockable).toBe(true);
    expect(by.tower_005.dlcLock).toBe(2);
    expect(by.tower_010.dlcLock).toBe(1);
    expect(existsSync(`${UI}/tower-icons.json`)).toBe(true);
  });
});

// ---- GameShell skin hook ------------------------------------------------------

class Ev { private l = new Map<string, Array<(e: unknown) => void>>(); addEventListener(t: string, f: (e: unknown) => void): void { this.l.set(t, [...(this.l.get(t) ?? []), f]); } removeEventListener(): void { /* */ } }
class El extends Ev {
  children: El[] = []; parent: El | null = null; style: Record<string, string> = {}; textContent = '';
  constructor(readonly tagName: string) { super(); }
  appendChild(c: El): El { c.parent = this; this.children.push(c); return c; }
  remove(): void { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('GameShell skin', () => {
  it('delegates pause/results drawing to the skin and keeps its own overlays hidden', () => {
    vi.stubGlobal('document', { body: new El('body'), createElement: (t: string) => new El(t) });
    vi.stubGlobal('window', new Ev());
    const calls: string[] = [];
    const shell = new GameShell({
      onResume: () => undefined, onRestart: () => undefined, onToggleMute: () => false,
      skin: {
        showPause: () => calls.push('showPause'), hidePause: () => calls.push('hidePause'),
        showResults: (d) => calls.push(`showResults:${d.won}`), hideResults: () => calls.push('hideResults'),
      },
    });
    shell.attach();
    shell.showPause();
    expect(shell.paused).toBe(true);
    shell.hidePause();
    shell.showResults({ won: true, perfect: false, wavesCleared: 10, totalWaves: 10, kills: 1, coinsEarned: 1, gemsEarned: 1, chibisSaved: 20, chibisTotal: 20, timeSeconds: 1 });
    expect(shell.resultsVisible).toBe(true);
    shell.hideResults();
    expect(calls).toEqual(['showPause', 'hidePause', 'showResults:true', 'hideResults']);
    // the shell's own overlays never became visible
    const overlays = (document.body as unknown as El).children;
    expect(overlays.every((o) => o.style.display !== 'flex')).toBe(true);
  });
});
