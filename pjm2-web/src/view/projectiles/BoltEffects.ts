// src/view/projectiles/BoltEffects.ts
// Procedural bolts / beam line for the projectiles whose original visuals are NOT particle prefabs:
//   * ProjectileBeam (tower_012 laser): a LineRenderer, 2 points: head = sim position, tail = head - dir * min(beamLength, dist
//     from the muzzle) (docs/PROJECTILE_ANALYSIS.md). `BeamLine`.
//   * ProjectileElectric (tower_003 tesla) / ProjectileLightning (tower_009): the original instantiates the procedural
//     DigitalRuby LightningBoltScript prefabs (lightning_bolt_effect_tesla / _tower / _ground). Their exact shader/params are not
//     extracted, so `Bolt` is a recreation: midpoint-displaced jagged polyline, white core + coloured glow, ~0.2 s life, re-jittered
//     every 40 ms (flicker). Colour/thickness are VISUAL STAND-INS (UNVERIFIED against footage).
// Coordinates are Unity space (x mirrored to three at the boundary: three.x = -unity.x), like the rest of the projectile views.

import * as THREE from 'three';
import type { V3 } from './projectileMath';

const f = Math.fround;

function toThree(p: V3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-p.x, p.y, p.z);
}

/** Deterministic-free (view-only) jagged polyline between a and b. */
export function jaggedPoints(a: THREE.Vector3, b: THREE.Vector3, segments: number, amp: number, rnd: () => number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [a.clone()];
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 1e-5) return [a.clone(), b.clone()];
  dir.divideScalar(len);
  // two perpendiculars
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const p1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  const p2 = new THREE.Vector3().crossVectors(dir, p1).normalize();
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const base = a.clone().lerp(b, t);
    const fall = Math.sin(Math.PI * t); // pinned at both ends
    base.addScaledVector(p1, (rnd() - 0.5) * 2 * amp * fall).addScaledVector(p2, (rnd() - 0.5) * 2 * amp * fall);
    pts.push(base);
  }
  pts.push(b.clone());
  return pts;
}

interface BoltItem {
  lines: THREE.Line[];
  a: V3;
  b: V3;
  age: number;
  life: number;
  nextJitter: number;
  amp: number;
  segments: number;
}

export interface BoltStyle {
  color: number;
  life?: number;
  amp?: number;
  segments?: number;
}

export class BoltEffects {
  private readonly items: BoltItem[] = [];
  private seed = 0x9e3779b9;
  readonly stats = { spawned: 0 };

  constructor(private readonly parent: THREE.Object3D) {}

  private rnd = (): number => {
    // xorshift32 (view randomness only)
    let x = this.seed >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 0xffffffff;
  };

  private makeLines(color: number): THREE.Line[] {
    const mk = (c: number, o: number): THREE.Line => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 14), 3));
      const m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      return l;
    };
    // glow (3 slightly different strands) + white core
    return [mk(color, 0.55), mk(color, 0.55), mk(0xffffff, 1.0)];
  }

  spawn(a: V3, b: V3, style: BoltStyle): void {
    const it: BoltItem = {
      lines: this.makeLines(style.color),
      a: { ...a }, b: { ...b },
      age: 0, life: f(style.life ?? 0.2), nextJitter: 0,
      amp: style.amp ?? 0.25, segments: Math.min(style.segments ?? 10, 12),
    };
    for (const l of it.lines) this.parent.add(l);
    this.items.push(it);
    this.stats.spawned++;
    this.rejitter(it);
  }

  private rejitter(it: BoltItem): void {
    const A = toThree(it.a, new THREE.Vector3());
    const B = toThree(it.b, new THREE.Vector3());
    it.lines.forEach((line, i) => {
      const pts = jaggedPoints(A, B, it.segments, it.amp * (i === 2 ? 0.6 : 1), this.rnd);
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = Math.min(pts.length, attr.count);
      for (let k = 0; k < attr.count; k++) {
        const p = pts[Math.min(k, n - 1)];
        attr.setXYZ(k, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      line.geometry.setDrawRange(0, n);
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.nextJitter -= dt;
      const k = 1 - it.age / it.life;
      if (k <= 0) {
        for (const l of it.lines) {
          l.removeFromParent();
          l.geometry.dispose();
          (l.material as THREE.Material).dispose();
        }
        this.items.splice(i, 1);
        continue;
      }
      if (it.nextJitter <= 0) {
        it.nextJitter = 0.04;
        this.rejitter(it);
      }
      it.lines.forEach((l, j) => ((l.material as THREE.LineBasicMaterial).opacity = (j === 2 ? 1 : 0.55) * k));
    }
  }

  get active(): number {
    return this.items.length;
  }

  dispose(): void {
    for (const it of this.items) for (const l of it.lines) l.removeFromParent();
    this.items.length = 0;
  }
}

/** ProjectileBeam LineRenderer: head = sim position, tail = head - dir * min(beamLength, |head - muzzle|). */
export class BeamLine {
  private readonly line: THREE.Line;
  private readonly glow: THREE.Line;

  constructor(parent: THREE.Object3D, private readonly beamLength: number, color = 0xff4a6a) {
    const mk = (c: number, o: number): THREE.Line => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      parent.add(l);
      return l;
    };
    this.glow = mk(color, 0.7);
    this.line = mk(0xffffff, 1);
  }

  /** `head` = sim projectile position, `muzzle` = fire point where it started, `dir` unit flight direction (unity space). */
  update(head: V3, muzzle: V3, dir: V3): void {
    const dist = Math.hypot(head.x - muzzle.x, head.y - muzzle.y, head.z - muzzle.z);
    const len = Math.min(this.beamLength, dist);
    const tail: V3 = { x: head.x - dir.x * len, y: head.y - dir.y * len, z: head.z - dir.z * len };
    for (const l of [this.glow, this.line]) {
      const a = l.geometry.getAttribute('position') as THREE.BufferAttribute;
      a.setXYZ(0, -head.x, head.y, head.z);
      a.setXYZ(1, -tail.x, tail.y, tail.z);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const l of [this.glow, this.line]) {
      l.removeFromParent();
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}
