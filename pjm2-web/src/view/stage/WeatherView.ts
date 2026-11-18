// src/view/stage/WeatherView.ts
// Q4.StageWeatherPlayer (stages 4-6 sand cloud, 11 snow; stages 10 and 12 serialize a NULL weatherEffectPrefab =
// no weather). Original: a timer (threshold = random(playbackIntervalMin, Max), regenerated after each playback;
// stage 4-6: 10..60 s, stage 11: 20..60 s) plays the weatherEffectPrefab (a ParticleGroup) at the camera target.
// The prefab systems are WORLD-space, non-looping (sand cloud: duration 1 s, snow: 20 s), emitted from a coneVolume
// (angle 0 => flat disc) of radius 15 / 10 at local height 0.1 / 8.0 above the target, speed 0, rate 32..64 /s
// (+ a burst 8..16 for the sand), alpha-over-lifetime gradients. Records come from tools/assets/extract_weather.py
// (public/assets/particles/weather.json, same schema as particles.json). The renderer is a dedicated Points pool
// with per-particle size + alpha (the shared effect pool darkens instead of fading and sizes by a fov-less formula).
// Approximations: twoGradients alpha uses the extracted gradient, texture = soft dot (sand: vfx_smoke is a
// 4x4-sheet-free soft puff; the soft dot is used), snow = soft dot at its tiny size.

import * as THREE from 'three';
import type { EmitterRecord } from '../particles/ExtractedEmitter';

export interface WeatherPlayerData { intervalMin: number; intervalMax: number }
export interface WeatherFile {
  players: Record<string, { intervalMin: number; intervalMax: number }[]>;
  emitters: (EmitterRecord & { prefabLocal?: { pos: number[] } })[];
  stageEmitter: Record<string, string>;
}

const rnd = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/** Alpha of the colour-over-lifetime gradient at normalised age t (piecewise linear). */
export function alphaAt(keys: { time: number; a: number }[], t: number): number {
  if (keys.length === 0) return 1;
  if (t <= keys[0].time) return keys[0].a;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].time) {
      const a = keys[i - 1], b = keys[i];
      return b.time === a.time ? b.a : a.a + ((b.a - a.a) * (t - a.time)) / (b.time - a.time);
    }
  }
  return keys[keys.length - 1].a;
}

export class WeatherView {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array; // rgba
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly peak: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  private n = 0;
  private timer = 0;
  private threshold: number;
  /** Seconds left of the current playback's emission window; 0 = idle. */
  private playing = 0;
  private acc = 0;
  private burstDone = true;
  private readonly origin = new THREE.Vector3();
  private readonly tint: THREE.Color;
  private readonly gravity: [number, number];

  constructor(private readonly rec: EmitterRecord, private readonly player: WeatherPlayerData, private readonly localY: number) {
    this.cap = Math.min(2048, rec.maxParticles ?? 1000);
    this.pos = new Float32Array(this.cap * 3);
    this.col = new Float32Array(this.cap * 4);
    this.size = new Float32Array(this.cap);
    this.vel = new Float32Array(this.cap * 3);
    this.age = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap);
    this.peak = new Float32Array(this.cap);
    const cg = rec.colorOverLifetime?.gradient?.color?.[0];
    this.tint = new THREE.Color().setRGB(
      rec.startColor.r * (cg?.r ?? 1), rec.startColor.g * (cg?.g ?? 1), rec.startColor.b * (cg?.b ?? 1), THREE.SRGBColorSpace);
    this.gravity = [rec.gravityModifier.min * -9.81, rec.gravityModifier.max * -9.81];
    this.threshold = rnd(player.intervalMin, player.intervalMax);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setDrawRange(0, 0);
    const tex = this.softDot();
    this.material = new THREE.PointsMaterial({
      size: 1, map: tex, transparent: true, depthWrite: false, vertexColors: true, blending: THREE.NormalBlending, sizeAttenuation: true,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aSize;\nvoid main() {')
        .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[ 1 ][ 1 ];')
        .replace('gl_PointSize *= ( scale / - mvPosition.z );', 'gl_PointSize *= ( scale / - mvPosition.z );');
    };
    this.material.customProgramCacheKey = () => 'pjm2-weather-points';
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'weather';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  private softDot(): THREE.Texture | null {
    if (typeof document === 'undefined') return null;
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  get alive(): number { return this.n; }
  get isPlaying(): boolean { return this.playing > 0; }

  /** Start a playback at `target` (three-space camera target). */
  play(target: THREE.Vector3): void {
    this.origin.set(target.x, target.y + this.localY, target.z);
    this.playing = this.rec.duration;
    this.burstDone = false;
    this.acc = 0;
  }

  private spawn(): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const r = this.rec.shape.radius * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    this.pos[i * 3] = this.origin.x + Math.cos(th) * r;
    this.pos[i * 3 + 1] = this.origin.y;
    this.pos[i * 3 + 2] = this.origin.z + Math.sin(th) * r;
    this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0; // startSpeed 0 in both prefabs
    this.age[i] = 0;
    this.life[i] = rnd(this.rec.startLifetime.min, this.rec.startLifetime.max);
    this.size[i] = rnd(this.rec.startSize.min, this.rec.startSize.max);
    this.peak[i] = rnd(this.gravity[0], this.gravity[1]); // per-particle gravity accel (u/s^2, +up)
    this.col[i * 4] = this.tint.r; this.col[i * 4 + 1] = this.tint.g; this.col[i * 4 + 2] = this.tint.b; this.col[i * 4 + 3] = 0;
  }

  update(dt: number, target: THREE.Vector3): void {
    if (this.playing > 0) {
      this.origin.set(target.x, target.y + this.localY, target.z); // the effect object follows the camera target
      const step = Math.min(dt, this.playing);
      if (!this.burstDone) {
        this.burstDone = true;
        for (const b of this.rec.emission.bursts) for (let k = 0; k < b.count; k++) this.spawn();
      }
      const rate = this.rec.emission.rate;
      this.acc += rnd(rate.min, rate.max) * step;
      while (this.acc >= 1) { this.acc -= 1; this.spawn(); }
      this.playing -= step;
    } else {
      this.timer += dt;
      if (this.timer >= this.threshold) { this.timer = 0; this.threshold = rnd(this.player.intervalMin, this.player.intervalMax); this.play(target); }
    }
    const keys = this.rec.colorOverLifetime?.gradient?.alpha ?? [];
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      this.vel[i * 3 + 1] += this.peak[i] * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      if (w !== i) {
        for (let k = 0; k < 3; k++) { this.pos[w * 3 + k] = this.pos[i * 3 + k]; this.vel[w * 3 + k] = this.vel[i * 3 + k]; }
        for (let k = 0; k < 3; k++) this.col[w * 4 + k] = this.col[i * 4 + k];
        this.size[w] = this.size[i]; this.age[w] = this.age[i]; this.life[w] = this.life[i]; this.peak[w] = this.peak[i];
      }
      this.col[w * 4 + 3] = alphaAt(keys, this.age[w] / this.life[w]) * this.rec.startColor.a;
      w++;
    }
    this.n = w;
    this.geometry.setDrawRange(0, w);
    for (const a of ['position', 'color', 'aSize']) (this.geometry.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}

/** Build the weather of `scene` from weather.json (null: stage has none, or asset missing). */
export function weatherViewFor(scene: string, file: WeatherFile): WeatherView | null {
  const name = file.stageEmitter[scene];
  const player = file.players[scene]?.[0];
  const rec = file.emitters.find((e) => e.name === name);
  if (!name || !player || !rec) return null;
  return new WeatherView(rec, player, rec.prefabLocal?.pos[1] ?? 0);
}

export async function loadWeatherView(scene: string, fetchFn: typeof fetch = fetch, url = '/assets/particles/weather.json'): Promise<WeatherView | null> {
  try {
    const r = await fetchFn(url);
    if (!r.ok) return null;
    return weatherViewFor(scene, (await r.json()) as WeatherFile);
  } catch {
    return null;
  }
}
