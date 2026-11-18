// src/view/particles/ParticleSystem.ts
// Lightweight CPU-sim / GPU-points particle pool for the browser game.
//
// FIDELITY STATUS: NEAR (hand-tuned, NOT extracted). The original drives
// Unity ParticleSystem prefabs via Q4.TowerEffectPlayer / Q4.GlobalEffects;
// extracting those is a Phase-3 follow-up. The emitter beats wired in
// game.ts (build dust, death poof, hit spark, pickup sparkle, chibi soul)
// match the original's visible rhythm but not its curves/textures. The
// BurstOpts contract is extraction-friendly: a future particle exporter can
// emit the same structs.
//
// EXTRACTED PATH (added): tools/assets/extract_particles.py now dumps the real
// Unity ParticleSystem settings to public/assets/particles/particles.json.
// ExtractedEmitter.ts parses that contract and maps a record to BurstOpts;
// burstFromEmitter() below spawns it through this same pool. The hand-tuned
// beats above are unchanged; callers can opt into the extracted settings.
//
// Determinism: VIEW-ONLY — Math.random() is allowed here (never in sim).

import * as THREE from 'three';
import {
  deriveFade,
  emitterToBurstOptions,
  UNITY_GRAVITY,
  WORLD_SCALE,
  type EmitterRecord,
} from './ExtractedEmitter';

const mid = (r: { min: number; max: number }): number => (r.min + r.max) / 2;

export interface BurstOpts {
  /** World (three-space) emitter position. */
  position: THREE.Vector3;
  count: number;
  /** Seconds each particle lives (uniform random in [min,max]). */
  life: readonly [number, number];
  /** Initial speed (u/s, uniform random in [min,max]). */
  speed: readonly [number, number];
  /** Direction: unit sphere biased upward by `up` (0 = sphere, 1 = cone up). */
  up?: number;
  /** Gravity acceleration applied to velocity.y (u/s², negative = down). */
  gravity?: number;
  /** Point size (world units, uniform random in [min,max]). */
  size: readonly [number, number];
  color: THREE.ColorRepresentation;
  /** Fade-out over the last `fade` fraction of life (0..1). */
  fade?: number;
  /** three-space unit direction of the emitter's shape axis (Unity cone/+Z axis
   *  of the prefab child, mirrored into three). Default +Y (the legacy bias axis).
   *  Used by projectile fire/hit effects (muzzle flash points along the barrel). */
  axis?: THREE.Vector3;
}

/** Unity ParticleSystem.LimitVelocityOverLifetime (ClampVelocityModule) subset:
 *  magnitude limit = curve(t) * scalar (curve sampled at 8 points over the
 *  normalized lifetime); `dampen` is the fraction by which speed above the
 *  limit is reduced per frame. */
export interface SpeedLimit {
  samples: readonly number[];
  scalar: number;
  dampen: number;
}

/** A continuously emitting (looping) Unity emitter — the original keeps the
 *  tower build ParticleGroup alive for the whole Build state and then calls
 *  Q4.ParticleGroup.StopLoopingThenDestroy @003dcbb0 (stop emitting, let the
 *  live particles finish). */
export interface LoopEmitterSpec {
  rec: EmitterRecord;
  /** three-space world origin of the ParticleSystem GameObject. */
  origin: THREE.Vector3;
  /** Shapes are sampled with the Unity prefab child's -90 degree X rotation
   *  baked in: the shape's local +Z (cone axis) points world +Y and its local
   *  XY plane (circle) is the ground plane. */
  speedLimit?: SpeedLimit;
  /** three-space unit shape axis (default +Y). The vector may be mutated by the
   *  owner each frame (e.g. a missile burner following its projectile). */
  axis?: THREE.Vector3;
}

export interface LoopHandle {
  /** StopLoopingThenDestroy: stop emitting; live particles run out. */
  stop(): void;
  readonly active: boolean;
}

interface LoopState {
  spec: LoopEmitterSpec;
  acc: number;
  active: boolean;
}

interface Particle {
  alive: boolean;
  /** Per-particle speed-limit curve (null = none). */
  limit: SpeedLimit | null;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  r: number; g: number; b: number;
  gravity: number;
  fade: number;
}

const DEFAULT_CAPACITY = 2048;
const _Y = new THREE.Vector3(0, 1, 0);
const _axisQ = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Rotate the legacy +Y-frame direction/offset into the emitter's shape axis. */
function toAxisFrame(v: THREE.Vector3, axis: THREE.Vector3 | undefined): THREE.Vector3 {
  if (axis === undefined) return v;
  return v.applyQuaternion(_axisQ.setFromUnitVectors(_Y, axis));
}

export interface ParticleSystemOptions {
  /** Honour BurstOpts.size per particle (Unity startSize = billboard side, in
   *  world units) instead of the shared 0.3 PointsMaterial size. Opt-in so the
   *  other effect pools keep their established look. */
  perParticleSize?: boolean;
}

/** Soft radial sprite (procedural — no extracted texture needed). */
function makeSoftDotTexture(): THREE.Texture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = 'particle-softdot';
  return tex;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly pool: Particle[];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private aliveCount = 0;
  private readonly loops: LoopState[] = [];

  constructor(capacity = DEFAULT_CAPACITY, texture?: THREE.Texture, options: ParticleSystemOptions = {}) {
    this.pool = Array.from({ length: capacity }, () => ({
      alive: false, limit: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      age: 0, life: 1, size: 1, r: 1, g: 1, b: 1, gravity: 0, fade: 0.3,
    }));
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    if (options.perParticleSize === true) {
      this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    }
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      size: 0.3,
      // No map in Node (no document) — tests get square points, fine.
      map: texture ?? (typeof document !== 'undefined' ? makeSoftDotTexture() : null),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });
    // Default: shared material size + color/alpha variation (demo puffs).
    // perParticleSize: the point diameter comes from the per-particle aSize
    // attribute (world units, same sizeAttenuation as PointsMaterial.size).
    if (options.perParticleSize === true) {
      this.material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'attribute float aSize;\nvoid main() {')
          .replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
      };
      this.material.customProgramCacheKey = () => 'pjm2-per-particle-size';
    }
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'particles';
    this.points.frustumCulled = false; // pool spans the stage
  }

  /** Particles currently alive (probe/test-visible). */
  get alive(): number {
    return this.aliveCount;
  }

  /** Spawn a burst. Pool-full → oldest-overwritten is NOT done (drops extra
   *  spawns instead — bounded cost, honest behavior). */
  burst(opts: BurstOpts): number {
    const color = new THREE.Color(opts.color);
    const up = opts.up ?? 0.5;
    const gravity = opts.gravity ?? -3;
    const fade = opts.fade ?? 0.35;
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= opts.count) break;
      if (p.alive) continue;
      // Random direction: unit sphere biased toward +Y by `up`.
      const theta = Math.random() * Math.PI * 2;
      const y = Math.random() * 2 - 1;
      const flat = Math.sqrt(Math.max(0, 1 - y * y));
      let dx = Math.cos(theta) * flat;
      let dy = y;
      let dz = Math.sin(theta) * flat;
      dy += up;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const speed = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      const dir = toAxisFrame(_v.set(dx / len, dy / len, dz / len), opts.axis);
      p.alive = true;
      p.limit = null;
      p.x = opts.position.x;
      p.y = opts.position.y;
      p.z = opts.position.z;
      p.vx = dir.x * speed;
      p.vy = dir.y * speed;
      p.vz = dir.z * speed;
      p.age = 0;
      p.life = opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]);
      p.size = opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]);
      p.r = color.r; p.g = color.g; p.b = color.b;
      p.gravity = gravity;
      p.fade = fade;
      spawned++;
    }
    this.aliveCount += spawned;
    return spawned;
  }

  /** Spawn a burst from an EXTRACTED Unity emitter record (particles.json).
   *  Additive convenience over burst(): maps the record via emitterToBurstOptions
   *  and delegates to the same pool. Returns the number of particles spawned. */
  burstFromEmitter(rec: EmitterRecord, position: THREE.Vector3): number {
    return this.burst(emitterToBurstOptions(rec, position));
  }

  /** Start a looping emitter (rate-over-time). Spawns per update(); returns a
   *  handle whose stop() is Q4.ParticleGroup.StopLoopingThenDestroy. */
  startLoop(spec: LoopEmitterSpec): LoopHandle {
    const state: LoopState = { spec, acc: 0, active: true };
    this.loops.push(state);
    return {
      stop: (): void => {
        state.active = false;
      },
      get active(): boolean {
        return state.active;
      },
    };
  }

  /** Active looping emitters (diagnostic / tests). */
  get activeLoops(): number {
    return this.loops.filter((l) => l.active).length;
  }

  /** Emit one particle of `spec.rec` honoring its Unity shape (circle edge /
   *  cone family) and optional speed limit. Returns false when the pool is full. */
  private emitLooped(spec: LoopEmitterSpec): boolean {
    const p = this.pool.find((q) => !q.alive);
    if (p === undefined) return false;
    const rec = spec.rec;
    const r = rec.shape.radius;
    const theta = Math.random() * Math.PI * 2;
    let ox = 0, oz = 0, dx = 0, dy = 1, dz = 0;
    switch (rec.shape.typeId) {
      case 10: // Circle (filled disc)  — direction radial in the plane
      case 11: { // CircleEdge
        const rr = rec.shape.typeId === 11 ? r : r * Math.sqrt(Math.random());
        ox = Math.cos(theta) * rr;
        oz = Math.sin(theta) * rr;
        dx = Math.cos(theta); dy = 0; dz = Math.sin(theta);
        break;
      }
      case 4: case 7: case 8: case 9: { // Cone family: spread grows with the base radius
        const rr = (rec.shape.typeId === 7 || rec.shape.typeId === 9) ? r : r * Math.sqrt(Math.random());
        ox = Math.cos(theta) * rr;
        oz = Math.sin(theta) * rr;
        const tilt = (rec.shape.angle * Math.PI / 180) * (r > 0 ? rr / r : 1);
        dx = Math.sin(tilt) * Math.cos(theta); dy = Math.cos(tilt); dz = Math.sin(tilt) * Math.sin(theta);
        break;
      }
      default: { // sphere-ish fallback
        const y = Math.random() * 2 - 1;
        const flat = Math.sqrt(Math.max(0, 1 - y * y));
        dx = Math.cos(theta) * flat; dy = y; dz = Math.sin(theta) * flat;
      }
    }
    const lo = rec.startSpeed.min, hi = rec.startSpeed.max;
    const speed = lo + Math.random() * (hi - lo);
    const g = mid(rec.gravityModifier) * UNITY_GRAVITY * WORLD_SCALE;
    const dirV = toAxisFrame(new THREE.Vector3(dx, dy, dz), spec.axis);
    const offV = toAxisFrame(new THREE.Vector3(ox, 0, oz), spec.axis);
    p.alive = true;
    p.limit = spec.speedLimit ?? null;
    p.x = spec.origin.x + offV.x; p.y = spec.origin.y + offV.y; p.z = spec.origin.z + offV.z;
    p.vx = dirV.x * speed; p.vy = dirV.y * speed; p.vz = dirV.z * speed;
    p.age = 0;
    p.life = rec.startLifetime.min + Math.random() * (rec.startLifetime.max - rec.startLifetime.min);
    p.size = rec.startSize.min + Math.random() * (rec.startSize.max - rec.startSize.min);
    p.r = rec.startColor.r; p.g = rec.startColor.g; p.b = rec.startColor.b;
    p.gravity = g;
    p.fade = deriveFade(rec.colorOverLifetime);
    this.aliveCount++;
    return true;
  }

  /** Integrate + kill + repack the GPU buffers. Call once per frame. */
  update(dt: number): void {
    // Looping emitters: rate-over-time (random between the two constants per frame).
    for (const l of this.loops) {
      if (!l.active) continue;
      const rate = l.spec.rec.emission.rate;
      l.acc += (rate.min + Math.random() * (rate.max - rate.min)) * dt;
      while (l.acc >= 1) {
        l.acc -= 1;
        if (!this.emitLooped(l.spec)) { l.acc = 0; break; }
      }
    }
    for (let i = this.loops.length - 1; i >= 0; i--) if (!this.loops[i].active) this.loops.splice(i, 1);
    let w = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.aliveCount--;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.limit !== null) this.applySpeedLimit(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const alpha = t > 1 - p.fade ? (1 - t) / p.fade : 1;
      this.positions[w * 3] = p.x;
      this.positions[w * 3 + 1] = p.y;
      this.positions[w * 3 + 2] = p.z;
      this.colors[w * 3] = p.r * alpha;
      this.colors[w * 3 + 1] = p.g * alpha;
      this.colors[w * 3 + 2] = p.b * alpha;
      this.sizes[w] = p.size;
      w++;
    }
    this.geometry.setDrawRange(0, w);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    const aSize = this.geometry.getAttribute('aSize') as THREE.BufferAttribute | undefined;
    if (aSize !== undefined) aSize.needsUpdate = true;
  }

  /** LimitVelocityOverLifetime: pull speed toward curve(t)*scalar by `dampen`
   *  per 60 Hz frame (Unity applies it per frame; made frame-rate independent). */
  private applySpeedLimit(p: Particle, dt: number): void {
    const lim = p.limit!;
    const t = Math.min(1, p.age / p.life);
    const pos = t * (lim.samples.length - 1);
    const i = Math.min(lim.samples.length - 2, Math.floor(pos));
    const limit = (lim.samples[i] + (lim.samples[i + 1] - lim.samples[i]) * (pos - i)) * lim.scalar;
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    if (speed <= limit || speed === 0) return;
    const keep = Math.pow(1 - lim.dampen, dt * 60);
    const target = limit + (speed - limit) * keep;
    const k = target / speed;
    p.vx *= k; p.vy *= k; p.vz *= k;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
