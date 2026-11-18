// src/view/particles/SheetParticles.ts
// Billboard particles WITH a texture-sheet animation (Unity ParticleSystem TextureSheetAnimationModule), the bit the point-sprite
// pools cannot draw: the ice tower's spray (ps_tower_ice_flow / _start: 8x8 `vfx_fireball_anim`, frame = curve(age/life) over the whole
// sheet), flame, explosions, lightning idle ... Extracted per emitter by tools/assets/extract_particles.py (`textureSheet`,
// `velocityOverLifetime`). Unity semantics reproduced:
//   * frame = floor(clamp(frameOverTime(t) * frameScalar * cycles + startFrame) * tilesX*tilesY), frame 0 = top-left, row-major;
//   * VelocityModule: extra per-particle velocity (random between the min/max curves, fixed per particle) added to the motion each
//     frame in world (or emitter-local) axes - NOT integrated into the base velocity;
//   * start colour * colour-over-lifetime gradient * 2*_TintColor (Particles shaders), size-over-lifetime, gravityModifier, cone family /
//     sphere / box / circle shapes along local +Z, additive vs alpha blend from the material shader.
// NOT reproduced: ClampVelocityModule (ice flow has it enabled), rotation (the ice emitters have none), sorting.
// Space: callers pass THREE-space origin/axis (x mirrored); velocity-module world X is mirrored here.

import * as THREE from 'three';
import type { EmitterRecord, MinMaxRange } from './ExtractedEmitter';
import { sampleGradient, sampleSize, type EnemyEmitter } from '../characters/enemyParticles';

export interface SheetHandle { stop(): void; readonly active: boolean }

interface Sheet { tilesX: number; tilesY: number; cycles: number; frameScalar: number; frameOverTime: MinMaxRange; startFrame: MinMaxRange }
interface Vel { inWorldSpace: boolean; x: MinMaxRange & { scalar: number }; y: MinMaxRange & { scalar: number }; z: MinMaxRange & { scalar: number } }
export type SheetEmitter = EmitterRecord & {
  textureSheet?: (Sheet & { enabled: boolean }) | null;
  velocityOverLifetime?: (Vel & { enabled: boolean }) | null;
  render?: { material: string | null; shader: string | null; tint: number[] | null } | null;
};

const UNITY_GRAVITY = -9.81;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Sample a 1-curve / 2-curve MinMaxRange at t with a per-particle random weight r (twoCurves lerps between min and max curve). */
export function sampleRange(m: MinMaxRange, t: number, r: number): number {
  const s = m.samples;
  const at = (arr: number[] | undefined): number => {
    if (arr === undefined || arr.length === 0) return 0;
    const pos = Math.min(1, Math.max(0, t)) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(pos));
    return arr[i] + (arr[i + 1] - arr[i]) * (pos - i);
  };
  if (m.minMaxState === 1) return at(s?.max);
  if (m.minMaxState === 2) { const a = at(s?.min), b = at(s?.max); return a + (b - a) * r; }
  return m.min + (m.max - m.min) * r;
}

/** Sheet frame index (0..tiles-1) for particle age fraction t (pure; unit-tested). */
export function sheetFrame(sh: Pick<Sheet, "tilesX" | "tilesY" | "cycles" | "frameScalar" | "frameOverTime" | "startFrame">, t: number): number {
  const total = Math.max(1, sh.tilesX * sh.tilesY);
  const f = sampleRange(sh.frameOverTime, t, 1) * sh.frameScalar * sh.cycles + sh.startFrame.min;
  return Math.min(total - 1, Math.max(0, Math.floor(f * total)));
}

interface P {
  alive: boolean; tex: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; size: number; r: number; g: number; b: number; a: number; gravity: number;
  rx: number; ry: number; rz: number; add: boolean; rec: SheetEmitter | null; mx: number; my: number; mz: number; // mirrored axes for velocity module
}

const VERT = `
attribute vec3 iPos; attribute float iSize; attribute vec4 iColor; attribute vec3 iFrame; // frame col,row (from top-left), tiles packed in z (tx*100+ty)
varying vec2 vUv; varying vec4 vColor;
void main() {
  vColor = iColor;
  float tx = floor(iFrame.z / 100.0); float ty = iFrame.z - tx * 100.0;
  vec2 cell = vec2(iFrame.x, ty - 1.0 - iFrame.y);
  vUv = (uv + cell) / vec2(tx, ty);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  #include <colorspace_fragment>
}`;

class Layer {
  readonly mesh: THREE.Mesh;
  readonly pos: Float32Array; readonly size: Float32Array; readonly col: Float32Array; readonly frame: Float32Array;
  n = 0;
  constructor(readonly capacity: number, tex: THREE.Texture, additive: boolean) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.getAttribute('position')); g.setAttribute('uv', q.getAttribute('uv'));
    this.pos = new Float32Array(capacity * 3); this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 4); this.frame = new Float32Array(capacity * 3);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 1));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.col, 4));
    g.setAttribute('iFrame', new THREE.InstancedBufferAttribute(this.frame, 3));
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
  }
  flush(): void {
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.n;
    for (const k of ['iPos', 'iSize', 'iColor', 'iFrame']) (g.getAttribute(k) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

export class SheetParticles {
  readonly group = new THREE.Group();
  private readonly layers = new Map<string, Layer>();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly pool: P[];
  private readonly loops: { rec: SheetEmitter; origin: THREE.Vector3; axis: THREE.Vector3; scale: number; acc: number; active: boolean; left: number }[] = [];
  private readonly loader = new THREE.TextureLoader();
  private readonly _q = new THREE.Quaternion();
  private readonly _v = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(private readonly base = '/assets/particles', capacity = 2048) {
    this.group.name = 'sheet-particles';
    this.pool = Array.from({ length: capacity }, () => ({
      alive: false, tex: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, r: 1, g: 1, b: 1, a: 1, gravity: 0,
      rx: 0, ry: 0, rz: 0, add: false, rec: null, mx: 0, my: 0, mz: 0,
    }));
  }

  /** True when this emitter should be drawn here (texture-sheet animation + a texture file). */
  handles(rec: EmitterRecord): boolean {
    const r = rec as SheetEmitter;
    return r.textureSheet?.enabled === true && (rec.texture?.file ?? null) !== null;
  }

  private layerFor(rec: SheetEmitter): Layer {
    const file = rec.texture!.file!;
    const add = (rec.render?.shader ?? '').includes('Additive');
    const key = `${file}|${add ? 1 : 0}`;
    let l = this.layers.get(key);
    if (l === undefined) {
      let tex = this.textures.get(file);
      if (tex === undefined) {
        tex = this.loader.load(`${this.base}/${file}`);
        tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = true; tex.generateMipmaps = true;
        this.textures.set(file, tex);
      }
      l = new Layer(1024, tex, add);
      this.layers.set(key, l);
      this.group.add(l.mesh);
    }
    return l;
  }

  burst(rec: EmitterRecord, origin: THREE.Vector3, axis: THREE.Vector3, scale = 1): number {
    const r = rec as SheetEmitter;
    let n = 0;
    for (const b of r.emission.bursts) {
      const bb = b as { count: number; minCount?: number; maxCount?: number };
      const count = Math.max(1, Math.round(((bb.minCount ?? bb.count) + (bb.maxCount ?? bb.count)) / 2));
      for (let i = 0; i < count; i++) if (this.emit(r, origin, axis, scale)) n++;
    }
    if (r.emission.rate.max > 0 && r.duration > 0) this.loops.push({ rec: r, origin: origin.clone(), axis: axis.clone(), scale, acc: 0, active: true, left: r.duration });
    return n;
  }

  startLoop(rec: EmitterRecord, origin: THREE.Vector3, axis: THREE.Vector3, scale = 1, maxSeconds = Infinity): SheetHandle {
    const l = { rec: rec as SheetEmitter, origin, axis, scale, acc: 0, active: true, left: maxSeconds };
    this.loops.push(l);
    return { stop: (): void => { l.active = false; }, get active(): boolean { return l.active; } };
  }

  private emit(rec: SheetEmitter, origin: THREE.Vector3, axis: THREE.Vector3, scale: number): boolean {
    const p = this.pool.find((q) => !q.alive);
    if (p === undefined) return false;
    const sh = rec.shape;
    const radius = sh.radius * scale;
    const th = Math.random() * Math.PI * 2;
    let ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 1;
    switch (sh.typeId) {
      case 0: case 1: case 2: case 3: {
        const y = Math.random() * 2 - 1, flat = Math.sqrt(1 - y * y);
        dx = Math.cos(th) * flat; dy = Math.sin(th) * flat; dz = y;
        if (sh.typeId >= 2 && dz < 0) dz = -dz;
        const rr = (sh.typeId === 1 || sh.typeId === 3) ? radius : radius * Math.cbrt(Math.random());
        ox = dx * rr; oy = dy * rr; oz = dz * rr; break;
      }
      case 4: case 7: case 8: case 9: {
        const rr = (sh.typeId === 7 || sh.typeId === 9) ? radius : radius * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr;
        const tilt = (sh.angle * Math.PI / 180) * (radius > 0 ? rr / radius : 1);
        dx = Math.sin(tilt) * Math.cos(th); dy = Math.sin(tilt) * Math.sin(th); dz = Math.cos(tilt); break;
      }
      case 10: case 11: {
        const rr = sh.typeId === 11 ? radius : radius * Math.sqrt(Math.random());
        ox = Math.cos(th) * rr; oy = Math.sin(th) * rr; dx = Math.cos(th); dy = Math.sin(th); dz = 0; break;
      }
      case 5: case 15: case 16: {
        const b = sh.box ?? { x: 1, y: 1, z: 1 };
        ox = (Math.random() - 0.5) * b.x * scale; oy = (Math.random() - 0.5) * b.y * scale; oz = (Math.random() - 0.5) * b.z * scale; break;
      }
      default: { dx = Math.cos(th); dy = Math.sin(th); dz = 0; }
    }
    this._q.setFromUnitVectors(SheetParticles.Z, axis);
    const speed = rnd(rec.startSpeed.min, rec.startSpeed.max) * scale;
    this._v.set(dx, dy, dz).applyQuaternion(this._q);
    p.vx = this._v.x * speed; p.vy = this._v.y * speed; p.vz = this._v.z * speed;
    this._v.set(ox, oy, oz).applyQuaternion(this._q);
    p.x = origin.x + this._v.x; p.y = origin.y + this._v.y; p.z = origin.z + this._v.z;
    p.alive = true; p.rec = rec; p.age = 0;
    p.add = (rec.render?.shader ?? '').includes('Additive');
    p.life = Math.max(0.05, rnd(rec.startLifetime.min, rec.startLifetime.max));
    p.size = rnd(rec.startSize.min, rec.startSize.max) * scale;
    const tint = rec.render?.tint ?? [0.5, 0.5, 0.5, 1];
    p.r = rec.startColor.r * Math.min(1, tint[0] * 2); p.g = rec.startColor.g * Math.min(1, tint[1] * 2); p.b = rec.startColor.b * Math.min(1, tint[2] * 2);
    p.a = rec.startColor.a;
    p.gravity = ((rec.gravityModifier.min + rec.gravityModifier.max) / 2) * UNITY_GRAVITY;
    p.rx = Math.random(); p.ry = Math.random(); p.rz = Math.random();
    this._v.set(0, 0, 0);
    return true;
  }

  update(dt: number): void {
    for (const l of this.loops) {
      if (!l.active) continue;
      l.acc += rnd(l.rec.emission.rate.min, l.rec.emission.rate.max) * dt;
      while (l.acc >= 1) { l.acc -= 1; if (!this.emit(l.rec, l.origin, l.axis, l.scale)) { l.acc = 0; break; } }
      l.left -= dt;
      if (l.left <= 0) l.active = false;
    }
    for (let i = this.loops.length - 1; i >= 0; i--) if (!this.loops[i].active) this.loops.splice(i, 1);
    for (const l of this.layers.values()) l.n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      const rec = p.rec!;
      const t = p.age / p.life;
      p.vy += p.gravity * dt;
      let ex = 0, ey = 0, ez = 0;
      const vm = rec.velocityOverLifetime;
      if (vm?.enabled === true) {
        // world-space module axes are Unity's: X is mirrored into three space
        ex = -sampleRange(vm.x, t, p.rx) * vm.x.scalar; ey = sampleRange(vm.y, t, p.ry) * vm.y.scalar; ez = sampleRange(vm.z, t, p.rz) * vm.z.scalar;
      }
      p.x += (p.vx + ex) * dt; p.y += (p.vy + ey) * dt; p.z += (p.vz + ez) * dt;
      const g = sampleGradient(rec as unknown as EnemyEmitter, t);
      const layer = this.layerFor(rec);
      if (layer.n >= layer.capacity) continue;
      const w = layer.n++;
      layer.pos[w * 3] = p.x; layer.pos[w * 3 + 1] = p.y; layer.pos[w * 3 + 2] = p.z;
      layer.size[w] = p.size * sampleSize(rec as unknown as EnemyEmitter, t);
      layer.col[w * 4] = p.r * g[0]; layer.col[w * 4 + 1] = p.g * g[1]; layer.col[w * 4 + 2] = p.b * g[2]; layer.col[w * 4 + 3] = p.a * g[3];
      const sht = rec.textureSheet!;
      const f = sheetFrame(sht, t);
      layer.frame[w * 3] = f % sht.tilesX; layer.frame[w * 3 + 1] = Math.floor(f / sht.tilesX); layer.frame[w * 3 + 2] = sht.tilesX * 100 + sht.tilesY;
    }
    for (const l of this.layers.values()) l.flush();
  }

  dispose(): void {
    for (const l of this.layers.values()) { l.mesh.geometry.dispose(); (l.mesh.material as THREE.Material).dispose(); }
    for (const t of this.textures.values()) t.dispose();
    this.layers.clear(); this.textures.clear();
    this.group.removeFromParent();
  }
}

let current: SheetParticles | null = null;
export function setSheetParticles(s: SheetParticles | null): void { current = s; }
export function getSheetParticles(): SheetParticles | null { return current; }
