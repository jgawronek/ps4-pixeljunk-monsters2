// src/view/audio/AudioManager.ts
// Minimal WebAudio playback for the browser game. The audio ASSETS come from
// the user's own copy (tools/assets/audio-out — Unity ADPCM/Vorbis decoded to
// WAV; OGG/Opus transcode is an endgame item pending ffmpeg). This manager
// deliberately covers only what the stage-1 demo wires today: BGM loop +
// throttled one-shot SFX keyed by name.
//
// TESTABILITY: the WebAudio surface is structural (AudioContextLike) and the
// fetch is injectable, so Node tests drive a fake context — no real audio
// device needed. The manager never throws on missing/failed clips: audio is
// cosmetic and must never break the game loop.

export interface AudioSourceLike {
  buffer: unknown;
  loop: boolean;
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(): void;
  onended: (() => void) | null;
}

export interface GainLike {
  gain: { value: number };
  connect(destination: unknown): void;
}

export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createBufferSource(): AudioSourceLike;
  createGain(): GainLike;
}

export type AudioFetch = (url: string) => Promise<ArrayBuffer>;

export interface PlayOptions {
  volume?: number;
  /** Per-name minimum gap between plays; rapid repeats (arrow shots) are
   *  dropped instead of stacked. 0 = no throttle. */
  throttleMs?: number;
}

/** Handle for a looping SFX started by startLoop (MonstersAudio.PlaySFXMonitored
 *  + StopSFX equivalents). stop() is idempotent and safe before the clip loaded. */
export interface LoopHandle {
  stop(): void;
  /** True once the underlying source actually started (diagnostic). */
  readonly started: boolean;
}

const defaultFetch: AudioFetch = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio fetch ${url}: ${res.status}`);
  return res.arrayBuffer();
};

export class AudioManager {
  private readonly ctx: AudioContextLike;
  private readonly baseUrl: string;
  private readonly fetchImpl: AudioFetch;
  private readonly buffers = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly lastPlayAt = new Map<string, number>();
  private bgmSource: AudioSourceLike | null = null;
  private bgmName: string | null = null;
  /** Master bus — every source routes through it so mute is one gain. */
  private readonly master: GainLike;
  /** Q4.MonstersAudio.OnAudioLevelsChanged(bgVolume, seVolume): two category buses under master. */
  private readonly bgmBus: GainLike;
  private readonly seBus: GainLike;
  private mutedFlag = false;
  /** Diagnostic counters (probe-visible): successful plays per clip name. */
  readonly playCounts = new Map<string, number>();
  /** Diagnostic: names that failed to load (404/decode). */
  readonly failed = new Set<string>();

  constructor(opts: { context: AudioContextLike; baseUrl?: string; fetchImpl?: AudioFetch }) {
    this.ctx = opts.context;
    this.baseUrl = opts.baseUrl ?? '/assets/audio/';
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.connect(this.master);
    this.seBus = this.ctx.createGain();
    this.seBus.connect(this.master);
  }

  /** Option-menu music volume 0..1 (GamePreferences.bgVolume; UI step * 0.1 @003db940). */
  setBgmVolume(v: number): void {
    this.bgmBus.gain.value = Math.min(1, Math.max(0, v));
  }

  /** Option-menu sound-effect volume 0..1 (GamePreferences.seVolume). */
  setSeVolume(v: number): void {
    this.seBus.gain.value = Math.min(1, Math.max(0, v));
  }

  get bgmVolume(): number {
    return this.bgmBus.gain.value;
  }

  get seVolume(): number {
    return this.seBus.gain.value;
  }

  /** Global mute (UI shell toggle). Sources keep playing silently — cheap. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.master.gain.value = muted ? 0 : 1;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** Call from a user-gesture handler (START button) — browsers refuse audio
   *  before a gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Fetch + decode a clip by name (`<baseUrl><name>.wav`); idempotent.
   *  Resolves false on failure (logged, cached, never retried mid-session). */
  load(name: string): Promise<boolean> {
    if (this.buffers.has(name)) return Promise.resolve(true);
    if (this.failed.has(name)) return Promise.resolve(false);
    const hit = this.pending.get(name);
    if (hit !== undefined) return hit;
    const p = (async () => {
      try {
        const data = await this.fetchImpl(`${this.baseUrl}${name}.wav`);
        this.buffers.set(name, await this.ctx.decodeAudioData(data));
        return true;
      } catch (err) {
        console.warn(`audio: ${name} failed to load:`, err);
        this.failed.add(name);
        return false;
      } finally {
        this.pending.delete(name);
      }
    })();
    this.pending.set(name, p);
    return p;
  }

  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map((n) => this.load(n)));
  }

  /** One-shot SFX. Resolves true when the clip actually started. */
  async play(name: string, opts: PlayOptions = {}): Promise<boolean> {
    const throttleMs = opts.throttleMs ?? 0;
    if (throttleMs > 0) {
      const last = this.lastPlayAt.get(name) ?? -Infinity;
      if (this.ctx.currentTime * 1000 - last < throttleMs) return false;
    }
    if (!(await this.load(name))) return false;
    this.startSource(name, this.buffers.get(name), opts.volume ?? 1, false);
    if (throttleMs > 0) this.lastPlayAt.set(name, this.ctx.currentTime * 1000);
    this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
    return true;
  }

  /** Looping SFX (Q4.MonstersAudio.PlaySFXMonitored @00647780 sets
   *  AudioSource.loop = true; Q4.MonstersAudio.StopSFX @00647950 ends it).
   *  Returns immediately; the clip starts once decoded unless stop() came first. */
  startLoop(name: string, opts: PlayOptions = {}): LoopHandle {
    let src: AudioSourceLike | null = null;
    let stopped = false;
    const handle = {
      stop: (): void => {
        stopped = true;
        this.loops.delete(handle);
        if (src !== null) {
          src.stop();
          src = null;
        }
      },
      get started(): boolean {
        return src !== null;
      },
    };
    this.loops.add(handle);
    void this.load(name).then((ok) => {
      if (!ok || stopped) return;
      src = this.startSource(name, this.buffers.get(name), opts.volume ?? 1, true);
      this.playCounts.set(name, (this.playCounts.get(name) ?? 0) + 1);
    });
    return handle;
  }

  /** Looping BGM; swaps the current track (only one BGM at a time). */
  async playBgm(name: string, volume = 0.55): Promise<boolean> {
    if (this.bgmName === name && this.bgmSource !== null) return true;
    if (!(await this.load(name))) return false;
    this.stopBgm();
    this.bgmSource = this.startSource(name, this.buffers.get(name), volume, true, this.bgmBus);
    this.bgmName = name;
    return true;
  }

  /** Live looping SFX handles (disposal audit). */
  private readonly loops = new Set<LoopHandle>();
  get loopCount(): number {
    return this.loops.size;
  }

  /** Stop every looping SFX (stage teardown). */
  stopAllLoops(): void {
    for (const l of [...this.loops]) l.stop();
    this.loops.clear();
  }

  stopBgm(): void {
    this.bgmSource?.stop();
    this.bgmSource = null;
    this.bgmName = null;
  }

  get currentBgm(): string | null {
    return this.bgmName;
  }

  private startSource(name: string, buffer: unknown, volume: number, loop: boolean, bus: GainLike = this.seBus): AudioSourceLike {
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    src.loop = loop;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(bus);
    if (!loop) {
      src.onended = () => { src.onended = null; };
    }
    src.start();
    return src;
  }
}

/** Browser factory: real AudioContext, fetch. (Separated so tests inject
 *  fakes and game.ts has a one-liner.) */
export function createWebAudioManager(): AudioManager {
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AudioManager({ context: new Ctor() as unknown as AudioContextLike });
}
