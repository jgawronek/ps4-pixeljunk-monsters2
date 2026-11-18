// tests/view/frameTimeHistogram.test.ts
// Frame-time distribution math (Phase-5 verification). Pure CPU, no DOM.

import { describe, it, expect } from 'vitest';
import { FrameTimeHistogram } from '../../src/view/perf/FrameTimeHistogram';

describe('FrameTimeHistogram', () => {
  it('starts empty', () => {
    const h = new FrameTimeHistogram();
    expect(h.count).toBe(0);
    expect(h.meanMs).toBe(0);
    expect(h.maxMs).toBe(0);
    expect(h.percentile(95)).toBe(0);
    expect(h.fractionUnder60fps).toBe(0);
  });

  it('records count, mean, max', () => {
    const h = new FrameTimeHistogram(2, 100);
    [10, 20, 30].forEach((ms) => h.record(ms));
    expect(h.count).toBe(3);
    expect(h.meanMs).toBe(20);
    expect(h.maxMs).toBe(30);
  });

  it('ignores negative / NaN / Infinity samples', () => {
    const h = new FrameTimeHistogram();
    h.record(-5);
    h.record(NaN);
    h.record(Infinity);
    h.record(16);
    expect(h.count).toBe(1);
    expect(h.maxMs).toBe(16);
  });

  it('buckets frames by width', () => {
    const h = new FrameTimeHistogram(10, 100);
    [5, 15, 15, 25].forEach((ms) => h.record(ms));
    const b = h.buckets();
    expect(b[0].count).toBe(1); // [0,10)
    expect(b[1].count).toBe(2); // [10,20)
    expect(b[2].count).toBe(1); // [20,30)
  });

  it('overflow frames land in a tail bucket and drive the max percentile', () => {
    const h = new FrameTimeHistogram(10, 50);
    h.record(200); // beyond 50
    const b = h.buckets();
    expect(b[b.length - 1].hi).toBe(Infinity);
    expect(b[b.length - 1].count).toBe(1);
    expect(h.percentile(99)).toBe(200); // tail → real max
  });

  it('percentile is bucket-upper-bound and monotone', () => {
    const h = new FrameTimeHistogram(2, 100);
    for (let i = 0; i < 100; i++) h.record(i); // 0..99ms uniform
    const p50 = h.percentile(50);
    const p95 = h.percentile(95);
    const p99 = h.percentile(99);
    expect(p50).toBeLessThanOrEqual(p95);
    expect(p95).toBeLessThanOrEqual(p99);
    expect(p50).toBeGreaterThanOrEqual(48); // ~50ms ± bucket
    expect(p50).toBeLessThanOrEqual(52);
    expect(p95).toBeGreaterThanOrEqual(94);
  });

  it('fractionUnder60fps counts frames at/below 16.67ms', () => {
    const h = new FrameTimeHistogram(1, 100);
    // 8 frames at 10ms (under) + 2 at 30ms (over) → 0.8
    for (let i = 0; i < 8; i++) h.record(10);
    for (let i = 0; i < 2; i++) h.record(30);
    expect(h.fractionUnder60fps).toBeCloseTo(0.8, 5);
  });

  it('fractionUnder60fps interpolates the straddling bucket', () => {
    const h = new FrameTimeHistogram(4, 100); // bucket [16,20) straddles 16.67
    for (let i = 0; i < 10; i++) h.record(18); // all in [16,20)
    // frac = (16.67-16)/4 ≈ 0.167 of the bucket counts as under
    expect(h.fractionUnder60fps).toBeCloseTo((1000 / 60 - 16) / 4, 2);
  });

  it('all-fast frames → fraction 1.0', () => {
    const h = new FrameTimeHistogram(2, 100);
    for (let i = 0; i < 50; i++) h.record(8);
    expect(h.fractionUnder60fps).toBe(1);
  });

  it('snapshot exposes the full distribution', () => {
    const h = new FrameTimeHistogram(2, 100);
    for (let i = 0; i < 60; i++) h.record(12);
    const s = h.snapshot();
    expect(s.count).toBe(60);
    expect(s.meanMs).toBe(12);
    expect(s.p95).toBe(14); // bucket [12,14) upper bound
    expect(s.fractionUnder60fps).toBe(1);
    expect(s.buckets.length).toBeGreaterThan(0);
  });

  it('reset clears everything', () => {
    const h = new FrameTimeHistogram();
    h.record(50);
    h.reset();
    expect(h.count).toBe(0);
    expect(h.maxMs).toBe(0);
    expect(h.buckets().every((b) => b.count === 0)).toBe(true);
  });

  it('rejects invalid construction', () => {
    expect(() => new FrameTimeHistogram(0, 100)).toThrow();
    expect(() => new FrameTimeHistogram(2, -1)).toThrow();
  });
});
