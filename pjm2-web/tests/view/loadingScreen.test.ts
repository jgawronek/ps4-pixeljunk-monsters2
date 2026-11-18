import { describe, expect, it } from 'vitest';
import { LOADING_BACKGROUNDS, LOADING_SCREEN_SETTINGS, LOADING_TIPS } from '../../src/view/loading/loadingScreen.generated';
import { inAlpha, LOADING, LoadingScreenModel, OFFLINE_ENV, outAlpha, TipShuffler, tipUnlocked } from '../../src/view/loading/LoadingScreenModel';

function lcg(seed: number): (n: number) => number {
  let s = seed;
  return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
}

describe('loading screen data (decoded from loading_ui + globalsettings)', () => {
  it('has the serialized timings and 42 tips / 25 backgrounds', () => {
    expect(LOADING_SCREEN_SETTINGS.minTipDisplayTime).toBe(LOADING.minTipDisplayTime);
    expect(LOADING_SCREEN_SETTINGS.maxTipDisplayTime).toBe(LOADING.maxTipDisplayTime);
    expect(LOADING_TIPS).toHaveLength(42);
    expect(LOADING_BACKGROUNDS).toHaveLength(25);
    for (const t of LOADING_TIPS) expect(LOADING_BACKGROUNDS).toContain(t.atlas);
  });
  it('offline: networking + DLC tips are locked', () => {
    const open = LOADING_TIPS.filter((t) => tipUnlocked(t, OFFLINE_ENV));
    expect(open.length).toBe(42 - 4 - 3);
    expect(open.every((t) => !t.requiresNetworking && t.requiredDLC === 0)).toBe(true);
  });
});

describe('animator curves', () => {
  it('In / Out clips hit 0 and 1 at the ends', () => {
    expect(inAlpha(0)).toBe(0);
    expect(inAlpha(1.5)).toBeCloseTo(1, 2);
    expect(outAlpha(0)).toBe(1);
    expect(outAlpha(1)).toBeCloseTo(0, 5);
  });
});

describe('TipShuffler (LoadingTipsMap.ShuffleTip)', () => {
  it('every tip once before any repeat; afterwards never an immediate repeat', () => {
    const sh = new TipShuffler(LOADING_TIPS, OFFLINE_ENV, lcg(1));
    const n = sh.size;
    const seen = new Set<object>();
    for (let i = 0; i < n; i++) seen.add(sh.next()!);
    expect(seen.size).toBe(n);
    let prev: object | null = null;
    for (let i = 0; i < 200; i++) {
      const t = sh.next()!;
      expect(t).not.toBe(prev);
      prev = t;
    }
  });
});

describe('LoadingScreenModel timeline', () => {
  it('fades in 1.5 s, shows a tip, rotates every 12 s with a text fade, hides after min 1 s + 1 s Out', () => {
    const m = new LoadingScreenModel(LOADING_TIPS, lcg(3));
    const first = m.view();
    expect(first.phase).toBe('in');
    expect(first.tipAlpha).toBe(0);
    for (let i = 0; i < 130; i++) m.update(1 / 60);
    let v = m.view();
    expect(v.phase).toBe('idle');
    expect(v.rootAlpha).toBe(1);
    const tip1 = v.tip;
    expect(tip1).not.toBeNull();
    expect(v.tipAlpha).toBeGreaterThan(0.9);
    for (let i = 0; i < 60 * 12; i++) m.update(1 / 60);
    v = m.view();
    expect(v.tip).not.toBe(tip1);
    m.hide();
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    expect(m.view().phase).toBe('out');
    expect(m.view().tipAlpha).toBe(0);
    for (let i = 0; i < 40; i++) m.update(1 / 60);
    expect(m.finished).toBe(true);
  });
  it('hide before the 1.5 s In ends waits for InIdle', () => {
    const m = new LoadingScreenModel(LOADING_TIPS, lcg(5));
    m.hide();
    m.update(0.5);
    expect(m.view().phase).toBe('in');
    m.update(1.1);
    m.update(0.01);
    expect(m.view().phase).toBe('out');
  });
});
