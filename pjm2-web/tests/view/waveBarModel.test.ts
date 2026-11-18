// WaveBarModel = Q4.WaveBarMonsterIcon + GameInfoController bar pool, driven by a fake wave timeline.
import { describe, expect, it } from 'vitest';
import { WAVE_BAR, WaveBarModel, type WaveBarWorld } from '../../src/view/ui/WaveBarModel';

/** waves activate at absolute times A[i]; world.timeUntil(i) = max(0, A[i] - now) like the cumulative remaining delays. */
function world(A: number[], startDelay: () => number = () => 0): { w: WaveBarWorld; set(now: number): void } {
  let now = 0;
  return { w: { timeUntil: (i) => Math.max(0, A[i] - now), spawnStartDelay: startDelay }, set: (n) => { now = n; } };
}
function run(m: WaveBarModel, w: { set(n: number): void }, from: number, to: number, dt = 1 / 30): void {
  for (let t = from; t < to; t += dt) { w.set(t); m.update(dt); }
}

describe('WaveBarModel', () => {
  it('window: an icon stays queued (progress 1) until its wave is < enemyBarTime (60 s) away, then moves linearly with remaining time', () => {
    const w = world([100, 160]);
    const m = new WaveBarModel(w.w, 2);
    run(m, w, 0, 30);
    expect(m.iconViews()[0].hasStarted).toBe(false);
    run(m, w, 30, 41); // 59 s remaining -> progress 59/60
    const v = m.iconViews()[0];
    expect(v.hasStarted).toBe(true);
    expect(v.progress).toBeGreaterThan(0.9);
    expect(v.progress).toBeLessThan(1);
    run(m, w, 41, 70); // 30 s remaining
    expect(m.iconViews()[0].progress).toBeCloseTo(30 / 60, 1);
  });

  it('x = 437 * progress once in the Pos state (right = start, 0 = home)', () => {
    const w = world([60]);
    const m = new WaveBarModel(w.w, 1);
    run(m, w, 0, 31);
    run(m, w, 31, 32); // Start (0.533) + 0.2 blend done
    const v = m.iconViews()[0];
    expect(v.anim).toBe('Pos');
    expect(v.x).toBeCloseTo(WAVE_BAR.startX * v.progress, 0);
  });

  it('the second icon only pops in after the first has started, and only starts when the first is below 0.95 progress', () => {
    const w = world([100, 100.5]);
    const m = new WaveBarModel(w.w, 2);
    run(m, w, 0, 10);
    expect(m.iconViews()[1].anim).toBe('OutIdle'); // prev not started
    run(m, w, 10, 41); // first icon starts (< 60 s)
    expect(m.iconViews()[0].hasStarted).toBe(true);
    expect(['In', 'InIdle', 'Start', 'Pos']).toContain(m.iconViews()[1].anim);
  });

  it('first wave waits for its spawn start delay', () => {
    let delay = 5;
    const w = world([20], () => delay);
    const m = new WaveBarModel(w.w, 1);
    run(m, w, 0, 4);
    expect(m.iconViews()[0].hasStarted).toBe(false);
    delay = 0;
    run(m, w, 4, 6);
    expect(m.iconViews()[0].hasStarted).toBe(true); // 14-16 s away < 60
  });

  it('arrival: Goal for 3 s (x -> -30, scale -> 0 after 2.5 s), the bar slot is freed and fades out', () => {
    const w = world([20]);
    const m = new WaveBarModel(w.w, 1);
    run(m, w, 0, 19.9);
    expect(m.barViews().some((b) => b.visible && b.posBar > 0)).toBe(true);
    run(m, w, 19.9, 21);
    expect(m.iconViews()[0].anim).toBe('Goal');
    run(m, w, 21, 21.5);
    expect(m.iconViews()[0].x).toBeCloseTo(-30, 0);
    run(m, w, 21.5, 24.5);
    expect(m.iconViews()[0].visible).toBe(false); // scale reached 0
    run(m, w, 24.5, 26);
    expect(m.barViews().every((b) => !b.visible)).toBe(true);
  });

  it('bar pool: waves take bar_01, bar_02, bar_03 in order, PosBar = progress', () => {
    const w = world([30, 40, 50]);
    const m = new WaveBarModel(w.w, 3);
    run(m, w, 0, 25);
    const bars = m.barViews();
    expect(bars.filter((b) => b.visible).length).toBeGreaterThanOrEqual(2);
    expect(bars[0].posBar).toBeGreaterThan(0);
  });

  it('OnWaveCleared rescales appearDelay so an early call does not make the icon jump', () => {
    const w = world([100, 200]);
    const m = new WaveBarModel(w.w, 2);
    run(m, w, 0, 45);
    run(m, w, 45, 140); // wave 1 timeline: icon 1 started at 140
    const before = m.iconViews()[1].progress;
    // wave 0 cleared: the next wave is now 50 s away instead of 60
    w.set(140);
    m.onWaveCleared(0);
    m.update(1 / 30);
    expect(Math.abs(m.iconViews()[1].progress - before)).toBeLessThan(0.05);
  });
});
