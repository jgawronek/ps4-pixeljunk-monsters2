// src/view/characters/enemyParticles.ts
// Small billboard-point particle pool for the enemy ParticleGroup effects (die poof, burning, freezing,
// boss dust ...). Unlike src/view/particles/ParticleSystem (RGB-only, fade to black) it honours what the
// enemies-bundle emitters actually carry (tools/assets/extract_particles.py --bundles enemies):
//   * startColor.a and the colour-over-lifetime gradient (colour + ALPHA keys),
//   * the material blend: `Particles/Additive*` shaders -> additive, everything else alpha-blended;
//     the shaders multiply vertex colour by 2 * _TintColor (neutral tint 0.5),
//   * size-over-lifetime, shape (sphere / hemisphere / cone family / circle / box), local +Z = emission axis,
//   * non-looping emitters emit their bursts + rate over `duration`, looping ones until stopped.
// Sprites are the soft round dot (sprite sheets / ring textures are not reproduced: NEAR fidelity).
// Simulation space = world (particles trail behind a moving enemy).

import * as THREE from 'three';
import type { EmitterRecord } from '../particles/ExtractedEmitter';

export interface EnemyEmitter extends Omit<EmitterRecord, 'texture'> {
  texture?: { name: string | null; file: string | null; avg?: number[] } | null;
  render?: { material: string | null; shader: string | null; tint: number[] | null } | null;
}

interface P {
  alive: boolean; add: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; size: number; r: number; g: number; b: number; a: number; gravity: number;
  rec: EnemyEmitter | null;
}

export interface EmitterHandle { stop(): void; readonly active: boolean }

const _v = new THREE.Vector3();
const UNITY_GRAVITY = -9.81;

function softDot(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function rnd(a: number, b: number): number { return a + Math.random() * (b - a); }

export function sampleGradient(rec: EnemyEmitter, t: number): [number, number, number, number] {
  const g = rec.colorOverLifetime;
  if (!g || !g.enabled) return [1, 1, 1, 1];
  const col = g.gradient.color;
  const al = g.gradient.alpha;
  const lerpKeys = <K extends { time: number }>(keys: K[], f: (k: K) => number[]): number[] => {
    if (keys.length === 0) return [1, 1, 1, 1];
    if (t <= keys[0].time) return f(keys[0]);
    for (let i = 0; i < keys.length - 1; i++) {
      if (t <= keys[i + 1].time) {
        const span = keys[i + 1].time - keys[i].time;
        const u = span > 0 ? (t - keys[i].time) / span : 1;
        const a = f(keys[i]); const b = f(keys[i + 1]);
        return a.map((x, j) => x + (b[j] - x) * u);
      }
    }
    return f(keys[keys.length - 1]);
  };
  const c = lerpKeys(col, (k) => [k.r, k.g, k.b]);
  const a = lerpKeys(al, (k) => [k.a]);
  return [c[0], c[1], c[2], a[0]];
}

export function sampleSize(rec: EnemyEmitter, t: number): number {
  const s = rec.sizeOverLifetime;
  if (!s || !s.enabled || s.samples.length < 2) return 1;
  const pos = Math.min(1, Math.max(0, t)) * (s.samples.length - 1);
  const i = Math.min(s.samples.length - 2, Math.floor(pos));
  const v = s.samples[i] + (s.samples[i + 1] - s.samples[i]) * (pos - i);
  return v; // samples already include the curve scalar (multiplier on startSize)
}

export class EnemyParticles {
  readonly normal: THREE.Points;
  readonly additive: THREE.Points;
  private readonly pool: P[];
  private readonly bufs: Array<{
    pos: Float32Array; col: Float32Array; size: Float32Array; geo: THREE.BufferGeometry; n: number;
  }>;
  private aliveCount = 0;
  private readonly loops: { rec: EnemyEmitter; origin: THREE.Vector3; quat: THREE.Quaternion; scale: number; acc: number; active: boolean; left: number }[] = [];

  constructor(capacity = 3072) {
    this.pool = Array.from({ length: capacity }, () => ({
      alive: false, add: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1,
      r: 1, g: 1, b: 1, a: 1, gravity: 0, rec: null,
    }));
    const map = softDot();
    const mk = (blending: THREE.Blending): { pts: THREE.Points; buf: EnemyParticles['bufs'][number] } => {
      const pos = new Float32Array(capacity * 3);
      const col = new Float32Array(capacity * 4);
      const size = new Float32Array(capacity);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({
        size: 1, map: map ?? null, transparent: true, depthWrite: false, vertexColors: true, blending, sizeAttenuation: true,
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'attribute float aSize;\nvoid main() {')
          .replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
      };
      mat.customProgramCacheKey = () => 'pjm2-enemy-particles';
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.name = blending === THREE.AdditiveBlending ? 'enemy-particles-add' : 'enemy-particles';
      pts.renderOrder = 5;
      return { pts, buf: { pos, col, size, geo, n: 0 } };
    };
    const a = mk(THREE.NormalBlending);
    const b = mk(THREE.AdditiveBlending);
    this.normal = a.pts; this.additive = b.pts;
    this.bufs = [a.buf, b.buf];
  }

  get alive(): number { return this.aliveCount; }
  addTo(parent: THREE.Object3D): void { parent.add(this.normal); parent.add(this.additive); }

  /** Play a non-looping emitter: its bursts at t=0 plus its rate over `duration`. */
  play(rec: EnemyEmitter, origin: THREE.Vector3, quat: THREE.Quaternion, scale = 1): number {
    let n = 0;
    for (const b of rec.emission.bursts) {
      const count = Math.max(1, Math.round((((b as { minCount?: number }).minCount ?? (b as { count: number }).count) + ((b as { maxCount?: number }).maxCount ?? (b as { count: number }).count)) / 2));
      for (let i = 0; i < count; i++) if (this.emit(rec, origin, quat, scale)) n++;
    }
    if (rec.emission.rate.max > 0 && rec.duration > 0) {
      this.loops.push({ rec, origin: origin.clone(), quat: quat.clone(), scale, acc: 0, active: true, left: rec.duration });
    }
    return n;
  }

  /** Start a looping emitter that follows `origin` / `quat` (mutated by the owner). `maxSeconds`: emit at most this long
   *  (one-shot triggers of emitters that are authored `looping` but must not run forever), live particles still finish. */
  startLoop(rec: EnemyEmitter, origin: THREE.Vector3, quat: THREE.Quaternion, scale = 1, maxSeconds = Infinity): EmitterHandle {
    const l = { rec, origin, quat, scale, acc: 0, active: true, left: maxSeconds };
    this.loops.push(l);
    return { stop: (): void => { l.active = false; }, get active(): boolean { return l.active; } };
  }

  private emit(rec: EnemyEmitter, origin: THREE.Vector3, quat: THREE.Quaternion, scale: number): boolean {
    const p = this.pool.find((q) => !q.alive);
    if (p === undefined) return false;
    const sh = rec.shape;
    const radius = sh.radius * scale;
    const th = Math.random() * Math.PI * 2;
    let ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 1;
    switch (sh.typeId) {
      case 0: case 1: case 2: case 3: { // sphere family
        const y = Math.random() * 2 - 1;
        const flat = Math.sqrt(1 - y * y);
        dx = Math.cos(th) * flat; dy = Math.sin(th) * flat; dz = y;
        if (sh.typeId >= 2 && dz < 0) dz = -dz;
        const rr = (sh.typeId === 1 || sh.typeId === 3) ? radius : radius * Math.cbrt(Math.random());
        ox = dx * rr; oy = dy * rr; oz = dz * rr;
        break;
      }
      case 4: case 7: case 8: case 9: { // cone family: +Z, spread by angle
        const rr = (sh.typeId === 7 || sh.typeId === 9) ? radius : radius * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr;
        const tilt = (sh.angle * Math.PI / 180) * (radius > 0 ? rr / radius : 1);
        dx = Math.sin(tilt) * Math.cos(th); dy = Math.sin(tilt) * Math.sin(th); dz = Math.cos(tilt);
        break;
      }
      case 10: case 11: { // circle: radial in the XY plane
        const rr = sh.typeId === 11 ? radius : radius * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr; dx = Math.cos(th); dy = Math.sin(th); dz = 0;
        break;
      }
      case 5: case 15: case 16: { // box
        const b = sh.box ?? { x: 1, y: 1, z: 1 };
        ox = (Math.random() - 0.5) * b.x * scale; oy = (Math.random() - 0.5) * b.y * scale; oz = (Math.random() - 0.5) * b.z * scale;
        break;
      }
      default: { dx = Math.cos(th); dy = Math.sin(th); dz = 0; }
    }
    const speed = rnd(rec.startSpeed.min, rec.startSpeed.max) * scale;
    _v.set(dx, dy, dz).applyQuaternion(quat);
    p.vx = _v.x * speed; p.vy = _v.y * speed; p.vz = _v.z * speed;
    _v.set(ox, oy, oz).applyQuaternion(quat);
    p.x = origin.x + _v.x; p.y = origin.y + _v.y; p.z = origin.z + _v.z;
    p.alive = true;
    p.rec = rec;
    p.add = (rec.render?.shader ?? '').includes('Additive');
    p.age = 0;
    p.life = Math.max(0.05, rnd(rec.startLifetime.min, rec.startLifetime.max));
    p.size = rnd(rec.startSize.min, rec.startSize.max) * scale;
    const tint = rec.render?.tint ?? [0.5, 0.5, 0.5, 1];
    // the sprite's own hue (alpha-weighted mean colour, normalised to its brightest channel) tints the dot
    const ta = rec.texture?.avg;
    const tm = ta ? Math.max(ta[0], ta[1], ta[2], 1e-3) : 1;
    p.r = rec.startColor.r * Math.min(1, tint[0] * 2) * (ta ? ta[0] / tm : 1);
    p.g = rec.startColor.g * Math.min(1, tint[1] * 2) * (ta ? ta[1] / tm : 1);
    p.b = rec.startColor.b * Math.min(1, tint[2] * 2) * (ta ? ta[2] / tm : 1);
    p.a = rec.startColor.a;
    p.gravity = ((rec.gravityModifier.min + rec.gravityModifier.max) / 2) * UNITY_GRAVITY;
    this.aliveCount++;
    return true;
  }

  update(dt: number): void {
    for (const l of this.loops) {
      if (!l.active) continue;
      const rate = rnd(l.rec.emission.rate.min, l.rec.emission.rate.max);
      l.acc += rate * dt;
      while (l.acc >= 1) { l.acc -= 1; if (!this.emit(l.rec, l.origin, l.quat, l.scale)) { l.acc = 0; break; } }
      l.left -= dt;
      if (l.left <= 0) l.active = false;
    }
    for (let i = this.loops.length - 1; i >= 0; i--) if (!this.loops[i].active) this.loops.splice(i, 1);
    for (const b of this.bufs) b.n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; this.aliveCount--; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life;
      const rec = p.rec!;
      const g = sampleGradient(rec, t);
      const b = this.bufs[p.add ? 1 : 0];
      const w = b.n++;
      b.pos[w * 3] = p.x; b.pos[w * 3 + 1] = p.y; b.pos[w * 3 + 2] = p.z;
      b.col[w * 4] = p.r * g[0]; b.col[w * 4 + 1] = p.g * g[1]; b.col[w * 4 + 2] = p.b * g[2];
      b.col[w * 4 + 3] = p.a * g[3];
      b.size[w] = p.size * sampleSize(rec, t);
    }
    for (const b of this.bufs) {
      b.geo.setDrawRange(0, b.n);
      (b.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (b.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      (b.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.bufs) b.geo.dispose();
    (this.normal.material as THREE.Material).dispose();
    (this.additive.material as THREE.Material).dispose();
    this.normal.removeFromParent();
    this.additive.removeFromParent();
  }
}
