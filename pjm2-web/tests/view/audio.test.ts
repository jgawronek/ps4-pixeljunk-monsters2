// tests/view/audio.test.ts
// AudioManager against a fake WebAudio context — no audio device in Node.
// Covers: load caching/dedup, failure caching, throttling, play counters,
// BGM swap/stop, unlock-on-gesture.

import { describe, it, expect } from 'vitest';
import {
  AudioManager,
  type AudioContextLike,
  type AudioSourceLike,
} from '../../src/view/audio/AudioManager';

class FakeSource implements AudioSourceLike {
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;
  onended: (() => void) | null = null;
  connect(): void { /* graph irrelevant */ }
  start(): void { this.started++; }
  stop(): void { this.stopped++; }
}

class FakeContext implements AudioContextLike {
  state = 'suspended';
  currentTime = 0;
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  decoded = 0;
  resumes = 0;
  async resume(): Promise<void> { this.resumes++; this.state = 'running'; }
  async decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    this.decoded++;
    return { bytes: data.byteLength };
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => { /* noop */ } };
  }
}

function makeFetch(map: Record<string, number>): (url: string) => Promise<ArrayBuffer> {
  return async (url) => {
    for (const [key, size] of Object.entries(map)) {
      if (url.endsWith(`${key}.wav`)) return new ArrayBuffer(size);
    }
    throw new Error(`404 ${url}`);
  };
}

function makeManager(ctx = new FakeContext()) {
  const fetchImpl = makeFetch({ 'a': 100, 'b': 200 });
  return { ctx, mgr: new AudioManager({ context: ctx, baseUrl: '/x/', fetchImpl }) };
}

describe('AudioManager', () => {
  it('load fetches + decodes once per name', async () => {
    const { ctx, mgr } = makeManager();
    expect(await mgr.load('a')).toBe(true);
    expect(await mgr.load('a')).toBe(true);
    expect(ctx.decoded).toBe(1);
  });

  it('concurrent loads dedup', async () => {
    const { ctx, mgr } = makeManager();
    const [r1, r2] = await Promise.all([mgr.load('b'), mgr.load('b')]);
    expect(r1 && r2).toBe(true);
    expect(ctx.decoded).toBe(1);
  });

  it('failed loads are cached, not retried', async () => {
    const { mgr } = makeManager();
    expect(await mgr.load('nope')).toBe(false);
    expect(await mgr.load('nope')).toBe(false);
    expect(mgr.failed.has('nope')).toBe(true);
  });

  it('play starts a source and counts plays', async () => {
    const { ctx, mgr } = makeManager();
    expect(await mgr.play('a')).toBe(true);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].started).toBe(1);
    expect(mgr.playCounts.get('a')).toBe(1);
  });

  it('play on a missing clip is a silent false', async () => {
    const { mgr } = makeManager();
    expect(await mgr.play('nope')).toBe(false);
    expect(mgr.playCounts.has('nope')).toBe(false);
  });

  it('throttle drops rapid repeats', async () => {
    const { ctx, mgr } = makeManager();
    expect(await mgr.play('a', { throttleMs: 100 })).toBe(true);
    expect(await mgr.play('a', { throttleMs: 100 })).toBe(false); // same tick
    ctx.currentTime = 0.15; // 150ms later
    expect(await mgr.play('a', { throttleMs: 100 })).toBe(true);
    expect(mgr.playCounts.get('a')).toBe(2);
  });

  it('playBgm loops, swaps, and stops the previous track', async () => {
    const { ctx, mgr } = makeManager();
    await mgr.playBgm('a');
    expect(mgr.currentBgm).toBe('a');
    expect(ctx.sources[0].loop).toBe(true);
    await mgr.playBgm('b');
    expect(ctx.sources[0].stopped).toBe(1); // old track stopped
    expect(mgr.currentBgm).toBe('b');
    mgr.stopBgm();
    expect(mgr.currentBgm).toBe(null);
    expect(ctx.sources[1].stopped).toBe(1);
  });

  it('playBgm on the same track is a no-op', async () => {
    const { ctx, mgr } = makeManager();
    await mgr.playBgm('a');
    await mgr.playBgm('a');
    expect(ctx.sources.length).toBe(1);
  });

  it('unlock resumes a suspended context once', async () => {
    const { ctx, mgr } = makeManager();
    await mgr.unlock();
    await mgr.unlock(); // already running → no second resume
    expect(ctx.resumes).toBe(1);
  });

  it('setMuted flips the master bus gain and the muted getter', async () => {
    const { ctx, mgr } = makeManager();
    await mgr.play('a');
    const master = (mgr as unknown as { master: { gain: { value: number } } }).master;
    expect(master.gain.value).toBe(1);
    mgr.setMuted(true);
    expect(mgr.muted).toBe(true);
    expect(master.gain.value).toBe(0);
    mgr.setMuted(false);
    expect(master.gain.value).toBe(1);
    expect(ctx.sources.length).toBe(1); // mute does not stop sources
  });
});
