// tests/view/particles.test.ts
// Pool/integration semantics of the view particle system (Node-safe — no
// document, no renderer; BufferAttributes are plain CPU arrays).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem } from '../../src/view/particles/ParticleSystem';

function burstAt(y = 0, count = 10) {
  return {
    position: new THREE.Vector3(1, y, 2),
    count,
    life: [0.5, 0.5] as const,
    speed: [1, 1] as const,
    size: [0.2, 0.2] as const,
    color: 0xff0000,
    gravity: 0,
  };
}

describe('ParticleSystem', () => {
  it('burst spawns the requested count and tracks alive', () => {
    const ps = new ParticleSystem(64);
    expect(ps.burst(burstAt(0, 12))).toBe(12);
    expect(ps.alive).toBe(12);
  });

  it('pool-full drops extra spawns instead of overwriting', () => {
    const ps = new ParticleSystem(8);
    expect(ps.burst(burstAt(0, 8))).toBe(8);
    expect(ps.burst(burstAt(0, 8))).toBe(0); // full
    expect(ps.alive).toBe(8);
  });

  it('particles die after their lifetime; draw range follows', () => {
    const ps = new ParticleSystem(16);
    ps.burst(burstAt(0, 6));
    ps.update(0.3); // mid-life
    expect(ps.alive).toBe(6);
    expect(ps.points.geometry.drawRange.count).toBe(6);
    ps.update(0.3); // past 0.5s life
    expect(ps.alive).toBe(0);
    expect(ps.points.geometry.drawRange.count).toBe(0);
  });

  it('dead slots are reused by later bursts', () => {
    const ps = new ParticleSystem(4);
    ps.burst(burstAt(0, 4));
    ps.update(1); // all dead
    expect(ps.burst(burstAt(0, 4))).toBe(4); // pool reusable
    expect(ps.alive).toBe(4);
  });

  it('gravity pulls velocity.y down; spawn starts at emitter position', () => {
    const ps = new ParticleSystem(16);
    ps.burst({ ...burstAt(5, 1), speed: [0, 0], gravity: -10, up: 0 });
    ps.update(0.1);
    const pos = ps.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    // started at y=5, v0=0 → y = 5 - 0.5*10*0.01 (semi-implicit: 5 - 10*0.1*0.1)
    expect(pos.getY(0)).toBeLessThan(5);
    expect(pos.getX(0)).toBeCloseTo(1, 5);
    expect(pos.getZ(0)).toBeCloseTo(2, 5);
  });

  it('up-bias keeps initial motion upward on average', () => {
    const ps = new ParticleSystem(256);
    ps.burst({ ...burstAt(0, 100), speed: [2, 2], gravity: 0, up: 3, life: [1, 1] });
    ps.update(0.05);
    const pos = ps.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += pos.getY(i);
    expect(sum / 100).toBeGreaterThan(0.05); // net upward drift
  });
});
