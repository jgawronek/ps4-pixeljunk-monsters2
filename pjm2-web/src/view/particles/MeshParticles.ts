// src/view/particles/MeshParticles.ts
// Unity ParticleSystemRenderer in MESH mode (RenderMode 4): the tower build / scrap / boss-footstep ROCK chunks, gears and
// leaves are lit 3D meshes (vfx_rock_01 with the Standard material `vfx_rock_m`, _Color (0.375, 0.321, 0.240); Standard ignores
// vertex colour, so there is no per-particle fade — size-over-lifetime shrinks them to 0 at the end). The billboard systems
// (ParticleSystem / EnemyParticles) cannot draw meshes, so mesh emitters are routed here.
// Data: tools/assets/extract_particle_meshes.py -> public/assets/particles/{mesh-render.json, meshes/*.json}.
// Space: callers pass THREE-space origins and a THREE-space emission axis. Simulation is world-space, view-only (Math.random).

import * as THREE from 'three';
import type { EmitterRecord } from './ExtractedEmitter';

export interface MeshRender {
  mesh: string;
  color: [number, number, number, number];
  shader?: string | null;
  /** Unity Standard material: _Mode (0 opaque, 1 cutout, 2 fade, 3 transparent), _Glossiness, _Metallic, _EmissionColor. */
  mode?: number;
  glossiness?: number;
  metallic?: number;
  emission?: [number, number, number];
}
export interface MeshData { name: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
export interface MeshHandle { stop(): void; readonly active: boolean }

const UNITY_GRAVITY = -9.81;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const mid = (r: { min: number; max: number }): number => (r.min + r.max) / 2;

interface Slot {
  alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; size: number; gravity: number; q: THREE.Quaternion; wx: number; wy: number; wz: number;
  sizeCurve: number[] | null;
}

interface Layer { mesh: THREE.InstancedMesh; slots: Slot[]; cap: number }

interface Loop { rec: EmitterRecord; render: MeshRender; origin: THREE.Vector3; axis: THREE.Vector3; scale: number; acc: number; active: boolean; left: number }

export function meshGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // RAW Unity -> three: mirror X (and flip winding to keep faces outward)
  const p = d.positions.slice(); const n = d.normals.slice();
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
  const idx = d.indices.slice();
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class MeshParticles {
  readonly group = new THREE.Group();
  private readonly layers = new Map<string, Layer>();
  private readonly loops: Loop[] = [];
  private readonly _m = new THREE.Matrix4();
  private readonly _s = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();

  constructor(
    private readonly geometries: ReadonlyMap<string, THREE.BufferGeometry>,
    private readonly render: ReadonlyMap<string, MeshRender>,
    private readonly capacity = 192,
  ) {
    this.group.name = 'mesh-particles';
  }

  /** True when this emitter is a mesh-mode ParticleSystemRenderer. */
  handles(emitter: string): boolean {
    const r = this.render.get(emitter);
    return r !== undefined && this.geometries.has(r.mesh);
  }

  private layer(r: MeshRender): Layer | null {
    const geo = this.geometries.get(r.mesh);
    if (geo === undefined) return null;
    const key = `${r.mesh}|${r.color.join(',')}|${r.mode ?? 0}|${r.glossiness ?? ''}|${r.metallic ?? ''}`;
    let l = this.layers.get(key);
    if (l === undefined) {
      // Unity Standard: smoothness = _Glossiness -> roughness = 1 - smoothness; ice is _Mode 2 (fade) alpha 0.5, ZWrite off.
      const mat = new THREE.MeshStandardMaterial({
        roughness: 1 - (r.glossiness ?? 0.1), metalness: r.metallic ?? 0,
      });
      mat.color.setRGB(r.color[0], r.color[1], r.color[2], THREE.SRGBColorSpace);
      if (r.emission !== undefined) mat.emissive.setRGB(r.emission[0], r.emission[1], r.emission[2], THREE.SRGBColorSpace);
      if ((r.mode ?? 0) >= 2) { mat.transparent = true; mat.opacity = r.color[3]; mat.depthWrite = false; }
      const mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.count = 0;
      this.group.add(mesh);
      const slots: Slot[] = Array.from({ length: this.capacity }, () => ({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, gravity: 0,
        q: new THREE.Quaternion(), wx: 0, wy: 0, wz: 0, sizeCurve: null,
      }));
      l = { mesh, slots, cap: this.capacity };
      this.layers.set(key, l);
    }
    return l;
  }

  /** Burst of every `bursts` entry (count = mean of min/max). */
  burst(rec: EmitterRecord, origin: THREE.Vector3, axis: THREE.Vector3, scale = 1): number {
    const r = this.render.get(rec.name);
    if (r === undefined) return 0;
    let n = 0;
    for (const b of rec.emission.bursts) {
      const bb = b as { minCount?: number; maxCount?: number; count?: number };
      const c = Math.max(1, Math.round(((bb.minCount ?? bb.count ?? 1) + (bb.maxCount ?? bb.count ?? 1)) / 2));
      for (let i = 0; i < c; i++) if (this.emit(rec, r, origin, axis, scale)) n++;
    }
    if (rec.emission.rate.max > 0 && rec.duration > 0 && !rec.looping) {
      this.loops.push({ rec, render: r, origin: origin.clone(), axis: axis.clone(), scale, acc: 0, active: true, left: rec.duration });
    }
    return n;
  }

  /** Rate-over-time emitter following `origin` (mutate it to move); `maxSeconds` bounds one-shot triggers. */
  startLoop(rec: EmitterRecord, origin: THREE.Vector3, axis: THREE.Vector3, scale = 1, maxSeconds = Infinity): MeshHandle {
    const r = this.render.get(rec.name);
    const l: Loop = { rec, render: r ?? { mesh: '', color: [1, 1, 1, 1] }, origin, axis, scale, acc: 0, active: r !== undefined, left: maxSeconds };
    if (r !== undefined) this.loops.push(l);
    // initial bursts of a looping system fire on start
    if (r !== undefined) for (const b of rec.emission.bursts) {
      const bb = b as { minCount?: number; maxCount?: number; count?: number };
      const c = Math.max(1, Math.round(((bb.minCount ?? bb.count ?? 1) + (bb.maxCount ?? bb.count ?? 1)) / 2));
      for (let i = 0; i < c; i++) this.emit(rec, r, origin, axis, scale);
    }
    return { stop: (): void => { l.active = false; }, get active(): boolean { return l.active; } };
  }

  private emit(rec: EmitterRecord, r: MeshRender, origin: THREE.Vector3, axis: THREE.Vector3, scale: number): boolean {
    const L = this.layer(r);
    if (L === null) return false;
    const s = L.slots.find((q) => !q.alive);
    if (s === undefined) return false;
    // basis around the emission axis
    const up = Math.abs(axis.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const bx = new THREE.Vector3().crossVectors(up, axis).normalize();
    const by = new THREE.Vector3().crossVectors(axis, bx).normalize();
    const th = Math.random() * Math.PI * 2;
    const sh = rec.shape;
    const rad = (sh.radius ?? 0) * scale;
    let ox = 0, oy = 0, dirA = 1, dirX = 0, dirY = 0; // direction = axis*dirA + bx*dirX + by*dirY
    switch (sh.typeId) {
      case 0: case 1: case 2: case 3: { // sphere family: random direction
        const y = Math.random() * 2 - 1; const f = Math.sqrt(1 - y * y);
        dirA = sh.typeId >= 2 ? Math.abs(y) : y; dirX = Math.cos(th) * f; dirY = Math.sin(th) * f;
        const rr = sh.typeId === 1 || sh.typeId === 3 ? rad : rad * Math.cbrt(Math.random());
        ox = dirX * rr; oy = dirY * rr;
        break;
      }
      case 4: case 7: case 8: case 9: { // cone family
        const rr = (sh.typeId === 7 || sh.typeId === 9) ? rad : rad * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr;
        const tilt = (sh.angle * Math.PI / 180) * (rad > 0 ? rr / rad : Math.random());
        dirA = Math.cos(tilt); dirX = Math.sin(tilt) * Math.cos(th); dirY = Math.sin(tilt) * Math.sin(th);
        break;
      }
      case 10: case 11: { // circle: radial in the plane
        const rr = sh.typeId === 11 ? rad : rad * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr; dirA = 0; dirX = Math.cos(th); dirY = Math.sin(th);
        break;
      }
      default: break;
    }
    const speed = rnd(rec.startSpeed.min, rec.startSpeed.max) * scale;
    const dx = bx.x * dirX + by.x * dirY + axis.x * dirA;
    const dy = bx.y * dirX + by.y * dirY + axis.y * dirA;
    const dz = bx.z * dirX + by.z * dirY + axis.z * dirA;
    s.x = origin.x + bx.x * ox + by.x * oy; s.y = origin.y + bx.y * ox + by.y * oy; s.z = origin.z + bx.z * ox + by.z * oy;
    s.vx = dx * speed; s.vy = dy * speed; s.vz = dz * speed;
    s.age = 0;
    s.life = Math.max(0.05, rnd(rec.startLifetime.min, rec.startLifetime.max));
    s.size = rnd(rec.startSize.min, rec.startSize.max) * scale;
    s.gravity = mid(rec.gravityModifier) * UNITY_GRAVITY;
    s.q.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    s.wx = rnd(-4, 4); s.wy = rnd(-4, 4); s.wz = rnd(-4, 4); // tumble (rad/s)
    const sz = rec.sizeOverLifetime;
    s.sizeCurve = sz && sz.enabled && sz.samples && sz.samples.length > 1 ? sz.samples : null;
    s.alive = true;
    return true;
  }

  update(dt: number): void {
    for (const l of this.loops) {
      if (!l.active) continue;
      l.acc += rnd(l.rec.emission.rate.min, l.rec.emission.rate.max) * dt;
      while (l.acc >= 1) { l.acc -= 1; if (!this.emit(l.rec, l.render, l.origin, l.axis, l.scale)) { l.acc = 0; break; } }
      l.left -= dt;
      if (l.left <= 0) l.active = false;
    }
    for (let i = this.loops.length - 1; i >= 0; i--) if (!this.loops[i].active) this.loops.splice(i, 1);
    const qd = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const L of this.layers.values()) {
      let n = 0;
      for (const s of L.slots) {
        if (!s.alive) continue;
        s.age += dt;
        if (s.age >= s.life) { s.alive = false; continue; }
        s.vy += s.gravity * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        // very light ground bounce (rocks settle instead of falling through the world at y < spawn - 3)
        e.set(s.wx * dt, s.wy * dt, s.wz * dt);
        s.q.multiply(qd.setFromEuler(e));
        let k = 1;
        if (s.sizeCurve !== null) {
          const f = (s.age / s.life) * (s.sizeCurve.length - 1);
          const i0 = Math.min(s.sizeCurve.length - 2, Math.floor(f));
          k = s.sizeCurve[i0] + (s.sizeCurve[i0 + 1] - s.sizeCurve[i0]) * (f - i0);
        }
        const sc = Math.max(0, s.size * k);
        this._p.set(s.x, s.y, s.z); this._s.set(sc, sc, sc);
        this._m.compose(this._p, s.q, this._s);
        L.mesh.setMatrixAt(n++, this._m);
      }
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get alive(): number {
    let n = 0;
    for (const L of this.layers.values()) n += L.mesh.count;
    return n;
  }

  dispose(): void {
    for (const L of this.layers.values()) { (L.mesh.material as THREE.Material).dispose(); L.mesh.dispose(); }
    this.layers.clear();
    this.loops.length = 0;
    this.group.removeFromParent();
  }
}

/** Process-wide handle so the tower / enemy effect modules can route mesh emitters without plumbing (set by the stage session). */
let current: MeshParticles | null = null;
export function setMeshParticles(m: MeshParticles | null): void { current = m; }
export function getMeshParticles(): MeshParticles | null { return current; }

export async function loadMeshParticles(base = '/assets/particles'): Promise<MeshParticles | null> {
  try {
    const rr = await fetch(`${base}/mesh-render.json`);
    if (!rr.ok) return null;
    const doc = (await rr.json()) as { emitters: Record<string, MeshRender> };
    const names = [...new Set(Object.values(doc.emitters).map((e) => e.mesh))];
    const geos = new Map<string, THREE.BufferGeometry>();
    await Promise.all(names.map(async (n) => {
      const r = await fetch(`${base}/meshes/${n}.json`);
      if (r.ok) geos.set(n, meshGeometry((await r.json()) as MeshData));
    }));
    return new MeshParticles(geos, new Map(Object.entries(doc.emitters)));
  } catch {
    return null;
  }
}
