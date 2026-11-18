// src/view/perf/FrameTimeHistogram.ts
// Phase-5 verification: frame-time distribution (the HUD's fps + worst-frame
// alone can't prove "60fps+" — a few long spikes hide behind a good average).
// Fixed-width bucket histogram over wall-clock frame deltas, with bucket-
// upper-bound percentiles (standard for frame histograms; accurate to within
// one bucket width — documented). Pure CPU, no DOM, Node-testable.
//
// View-only measurement: records real renderer frame deltas, never sim time.

export interface HistogramBucket {
  lo: number;
  hi: number;
  count: number;
}

export interface HistogramSnapshot {
  count: number;
  meanMs: number;
  maxMs: number;
  p50: number;
  p95: number;
  p99: number;
  /** Fraction of frames at or under the 60fps budget (16.67ms). */
  fractionUnder60fps: number;
  buckets: HistogramBucket[];
}

const FRAME_60FPS_MS = 1000 / 60;

export class FrameTimeHistogram {
  private readonly bucketWidth: number;
  private readonly bucketCount: number;
  private readonly counts: Uint32Array;
  private overflow = 0; // frames beyond the last bucket
  private total = 0;
  private sum = 0;
  private max = 0;

  constructor(bucketWidthMs = 2, maxMs = 100) {
    if (bucketWidthMs <= 0 || maxMs <= 0) throw new Error('bucketWidth/maxMs must be > 0');
    this.bucketWidth = bucketWidthMs;
    this.bucketCount = Math.ceil(maxMs / bucketWidthMs);
    this.counts = new Uint32Array(this.bucketCount);
  }

  /** Record one frame delta in milliseconds (negative/NaN ignored). */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.total++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
    const idx = Math.floor(ms / this.bucketWidth);
    if (idx >= this.bucketCount) this.overflow++;
    else this.counts[idx]++;
  }

  get count(): number {
    return this.total;
  }

  get maxMs(): number {
    return this.max;
  }

  get meanMs(): number {
    return this.total === 0 ? 0 : this.sum / this.total;
  }

  /** Bucket-upper-bound percentile (p in [0,100]). Approximate to within one
   *  bucket width; returns the overflow ceiling (maxMs) for the tail bucket. */
  percentile(p: number): number {
    if (this.total === 0) return 0;
    const clamped = Math.min(100, Math.max(0, p));
    const target = (clamped / 100) * this.total;
    let cum = 0;
    for (let i = 0; i < this.bucketCount; i++) {
      cum += this.counts[i];
      if (cum >= target) return (i + 1) * this.bucketWidth;
    }
    return this.max; // overflow tail
  }

  get fractionUnder60fps(): number {
    if (this.total === 0) return 0;
    let under = 0;
    const limitIdx = Math.floor(FRAME_60FPS_MS / this.bucketWidth);
    for (let i = 0; i < this.bucketCount; i++) {
      const hi = (i + 1) * this.bucketWidth;
      if (hi <= FRAME_60FPS_MS) under += this.counts[i];
      else if (i === limitIdx) {
        // Partial bucket straddling 16.67ms: assume uniform within the bucket.
        const lo = i * this.bucketWidth;
        const frac = (FRAME_60FPS_MS - lo) / this.bucketWidth;
        under += this.counts[i] * frac;
      }
    }
    return under / this.total;
  }

  buckets(): HistogramBucket[] {
    const out: HistogramBucket[] = [];
    for (let i = 0; i < this.bucketCount; i++) {
      out.push({ lo: i * this.bucketWidth, hi: (i + 1) * this.bucketWidth, count: this.counts[i] });
    }
    if (this.overflow > 0) {
      out.push({ lo: this.bucketCount * this.bucketWidth, hi: Infinity, count: this.overflow });
    }
    return out;
  }

  snapshot(): HistogramSnapshot {
    return {
      count: this.total,
      meanMs: this.meanMs,
      maxMs: this.max,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      fractionUnder60fps: this.fractionUnder60fps,
      buckets: this.buckets(),
    };
  }

  reset(): void {
    this.counts.fill(0);
    this.overflow = 0;
    this.total = 0;
    this.sum = 0;
    this.max = 0;
  }
}
