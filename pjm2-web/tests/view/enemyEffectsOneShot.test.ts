// Boss footprint / land / attack effects contain emitters authored `looping`; as one-shot triggers they must stop emitting
// after their own duration (they used to stack a permanent white trail behind the boss).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EnemyEffects, type EnemyFxAnchor } from '../../src/view/characters/enemyEffects';
import { EnemyParticles, type EnemyEmitter } from '../../src/view/characters/enemyParticles';
import type { EffectNode } from '../../src/view/projectiles/projectileTypes';

const rec = {
  name: 'ps_test_rock', duration: 1, looping: true, maxParticles: 32,
  startLifetime: { min: 0.2, max: 0.3, mode: 'twoConstants', minMaxState: 3 },
  startSpeed: { min: 1, max: 1, mode: 'twoConstants', minMaxState: 3 },
  startSize: { min: 0.1, max: 0.1, mode: 'twoConstants', minMaxState: 3 },
  startColor: { r: 1, g: 1, b: 1, a: 1, mode: 'color', minMaxState: 0, randomBetween: false },
  gravityModifier: { min: 1, max: 1, mode: 'twoConstants', minMaxState: 3 },
  emission: { rate: { min: 50, max: 50, mode: 'twoConstants', minMaxState: 3 }, bursts: [] },
  shape: { typeId: 0, radius: 0.1, angle: 25, arc: 360 },
  colorOverLifetime: { enabled: false }, sizeOverLifetime: { enabled: false },
  render: { material: null, shader: null, tint: null }, texture: null,
} as unknown as EnemyEmitter;

const node: EffectNode = { name: 'ef_test', pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], components: [], children: [
  { name: 'ps_test_rock', pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], components: ['ParticleSystem'], children: [] }] };
const anchor: EnemyFxAnchor = { worldPosition: (o) => o.set(0, 0, 0), worldQuaternion: (o) => o.identity() };

function run(oneShot: boolean, seconds: number): { alive: number; active: boolean } {
  const p = new EnemyParticles(256);
  const fx = new EnemyEffects(p, new Map([['ps_test_rock', rec]]), { ef_test: node });
  const h = fx.spawn('ef_test', anchor, 1, oneShot)!;
  for (let t = 0; t < seconds; t += 1 / 60) p.update(1 / 60);
  return { alive: p.alive, active: h.active };
}

describe('enemy one-shot effects', () => {
  it('a one-shot looping emitter stops after its duration and leaves no particles', () => {
    const early = run(true, 0.5);
    expect(early.alive).toBeGreaterThan(0);
    expect(early.active).toBe(true);
    const late = run(true, 3);
    expect(late.alive).toBe(0);
    expect(late.active).toBe(false);
  });
  it('a continuous effect (fire / ice / sink) keeps emitting until stopped', () => {
    const late = run(false, 3);
    expect(late.alive).toBeGreaterThan(0);
    expect(late.active).toBe(true);
  });
});
