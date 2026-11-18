// tests/view/extractedEmitter.test.ts
// Parser validation + record->BurstOpts mapping + ParticleSystem.burstFromEmitter
// for the EXTRACTED Unity particle settings (Node-safe — no document/renderer).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem } from '../../src/view/particles/ParticleSystem';
import {
  parseEmitterFile,
  emitterToBurstOptions,
  emitterCount,
  coneUpBias,
  shapeUpBias,
  deriveFade,
  UNITY_GRAVITY,
  WORLD_SCALE,
  CONE_UP_CAP,
  DEFAULT_FADE,
  type EmitterRecord,
  type EmitterShape,
} from '../../src/view/particles/ExtractedEmitter';

/** A complete, valid particles.json record (plain object, as the extractor writes). */
function goodRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'ps_test',
    bundle: 'props',
    duration: 0.5,
    looping: false,
    maxParticles: 1000,
    startLifetime: { min: 0.4, max: 0.8, mode: 'twoConstants', minMaxState: 3 },
    startSpeed: { min: 1, max: 2, mode: 'twoConstants', minMaxState: 3 },
    startSize: { min: 0.1, max: 0.2, mode: 'twoConstants', minMaxState: 3 },
    startColor: { r: 1, g: 0.5, b: 0.25, a: 1, mode: 'color', minMaxState: 0, randomBetween: false },
    gravityModifier: { min: 0, max: 0, mode: 'constant', minMaxState: 0 },
    emission: {
      rate: { min: 0, max: 0, mode: 'constant', minMaxState: 0 },
      bursts: [{ time: 0, count: 10, minCount: 8, maxCount: 12 }],
    },
    shape: { type: 'sphere', typeId: 0, enabled: true, radius: 0.1, angle: 25 },
    colorOverLifetime: null,
    sizeOverLifetime: null,
    texture: { name: null, file: null, note: 'none' },
    ...overrides,
  };
}

/** Build + validate a record (exercises the parser on the way in). */
function rec(overrides: Record<string, unknown> = {}): EmitterRecord {
  return parseEmitterFile([goodRecord(overrides)])[0];
}

const POS = new THREE.Vector3(1, 2, 3);

describe('parseEmitterFile validation', () => {
  it('accepts a good record (bare array and {emitters} wrapper)', () => {
    const bare = parseEmitterFile([goodRecord()]);
    expect(bare).toHaveLength(1);
    expect(bare[0].name).toBe('ps_test');
    const wrapped = parseEmitterFile({ version: 1, emitters: [goodRecord(), goodRecord({ name: 'ps_two' })] });
    expect(wrapped.map((r) => r.name)).toEqual(['ps_test', 'ps_two']);
  });

  it('rejects a non-array / non-wrapper top level', () => {
    expect(() => parseEmitterFile(null)).toThrow();
    expect(() => parseEmitterFile({})).toThrow();
    expect(() => parseEmitterFile({ emitters: 'nope' })).toThrow();
    expect(() => parseEmitterFile(42)).toThrow();
  });

  it('throws when required fields are missing', () => {
    for (const field of ['name', 'duration', 'looping', 'maxParticles', 'startLifetime',
      'startSpeed', 'startSize', 'startColor', 'gravityModifier', 'emission', 'shape']) {
      const bad = goodRecord();
      delete bad[field];
      expect(() => parseEmitterFile([bad]), `missing ${field}`).toThrow();
    }
  });

  it('throws on malformed field types', () => {
    expect(() => parseEmitterFile([goodRecord({ name: '' })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ duration: '0.5' })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ looping: 'false' })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ startLifetime: { min: 0.4 } })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ startColor: { r: 1, g: 0, b: 0 } })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ emission: { rate: { min: 0, max: 0 }, bursts: 'x' } })])).toThrow();
    expect(() => parseEmitterFile([goodRecord({ shape: { type: 'sphere', typeId: 0, enabled: true, radius: 0.1 } })])).toThrow();
  });

  it('throws on a malformed burst entry', () => {
    const bad = goodRecord({ emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0 }] } });
    expect(() => parseEmitterFile([bad])).toThrow();
  });

  it('accepts null colorOverLifetime / sizeOverLifetime and populated objects', () => {
    expect(rec().colorOverLifetime).toBeNull();
    const withCol = rec({
      colorOverLifetime: { enabled: true, gradient: { color: [], alpha: [{ time: 0, a: 1 }, { time: 1, a: 0 }] } },
    });
    expect(withCol.colorOverLifetime?.enabled).toBe(true);
  });
});

describe('emitterToBurstOptions mapping', () => {
  it('maps constant ranges (min == max) to life/speed/size', () => {
    const opts = emitterToBurstOptions(rec({
      startLifetime: { min: 0.5, max: 0.5 },
      startSpeed: { min: 2, max: 2 },
      startSize: { min: 0.3, max: 0.3 },
    }), POS);
    expect(opts.life).toEqual([0.5, 0.5]);
    expect(opts.speed).toEqual([2, 2]);
    expect(opts.size).toEqual([0.3, 0.3]);
  });

  it('maps random-between-two-constants ranges (min < max) verbatim', () => {
    const opts = emitterToBurstOptions(rec({
      startLifetime: { min: 0.3, max: 0.9 },
      startSpeed: { min: 1, max: 4 },
      startSize: { min: 0.1, max: 0.5 },
    }), POS);
    expect(opts.life).toEqual([0.3, 0.9]);
    expect(opts.speed).toEqual([1, 4]);
    expect(opts.size).toEqual([0.1, 0.5]);
  });

  it('passes the position through', () => {
    const opts = emitterToBurstOptions(rec(), POS);
    expect(opts.position).toBe(POS);
  });

  it('gravity = gravityModifier * -9.81 (positive modifier -> downward)', () => {
    const down = emitterToBurstOptions(rec({ gravityModifier: { min: 1, max: 1 } }), POS);
    expect(down.gravity).toBeCloseTo(1 * UNITY_GRAVITY * WORLD_SCALE, 5);
    expect(down.gravity).toBeLessThan(0);
    // Negative modifier (buoyant smoke) -> upward acceleration.
    const up = emitterToBurstOptions(rec({ gravityModifier: { min: -0.5, max: -0.5 } }), POS);
    expect(up.gravity).toBeCloseTo(-0.5 * UNITY_GRAVITY * WORLD_SCALE, 5);
    expect(up.gravity).toBeGreaterThan(0);
    // Range uses the midpoint.
    const mid = emitterToBurstOptions(rec({ gravityModifier: { min: -1, max: 0 } }), POS);
    expect(mid.gravity).toBeCloseTo(-0.5 * UNITY_GRAVITY, 5);
  });

  it('color comes from startColor rgb', () => {
    const opts = emitterToBurstOptions(rec({ startColor: { r: 0.988, g: 1, b: 0.11, a: 1 } }), POS);
    const c = opts.color as THREE.Color;
    expect(c.r).toBeCloseTo(0.988, 3);
    expect(c.g).toBeCloseTo(1, 3);
    expect(c.b).toBeCloseTo(0.11, 3);
  });

  it('cone shape biases up by cot(angle); narrower cone -> larger bias', () => {
    const wide = emitterToBurstOptions(rec({ shape: { type: 'cone', typeId: 4, enabled: true, radius: 0.01, angle: 45 } }), POS);
    const narrow = emitterToBurstOptions(rec({ shape: { type: 'cone', typeId: 4, enabled: true, radius: 0.01, angle: 10 } }), POS);
    expect(wide.up).toBeCloseTo(1, 3); // cot(45) = 1
    expect(narrow.up).toBeGreaterThan(wide.up as number);
    expect(narrow.up).toBeLessThanOrEqual(CONE_UP_CAP);
  });

  it('cone-family variants (coneVolume/coneVolumeShell) also bias up; sphere does not', () => {
    for (const typeId of [7, 8, 9]) {
      const opts = emitterToBurstOptions(rec({ shape: { type: 'coneVolume', typeId, enabled: true, radius: 0.1, angle: 25 } }), POS);
      expect(opts.up).toBeGreaterThan(0);
    }
    const sphere = emitterToBurstOptions(rec({ shape: { type: 'sphere', typeId: 0, enabled: true, radius: 0.1, angle: 25 } }), POS);
    expect(sphere.up).toBe(0);
    const hemi = emitterToBurstOptions(rec({ shape: { type: 'hemisphere', typeId: 2, enabled: true, radius: 0.1, angle: 25 } }), POS);
    expect(hemi.up).toBe(1);
    const disabled = emitterToBurstOptions(rec({ shape: { type: 'cone', typeId: 4, enabled: false, radius: 0.1, angle: 10 } }), POS);
    expect(disabled.up).toBe(0);
  });
});

describe('mapping helpers', () => {
  it('coneUpBias: cot(angle), clamped to [0, CONE_UP_CAP]', () => {
    expect(coneUpBias(45)).toBeCloseTo(1, 5);
    expect(coneUpBias(25)).toBeCloseTo(1 / Math.tan((25 * Math.PI) / 180), 5);
    expect(coneUpBias(0)).toBe(CONE_UP_CAP);
    expect(coneUpBias(90)).toBeCloseTo(0, 5);
  });

  it('shapeUpBias handles disabled shapes', () => {
    expect(shapeUpBias({ type: 'cone', typeId: 4, enabled: false, radius: 0, angle: 5 } as EmitterShape)).toBe(0);
  });

  it('emitterCount: sums time-0 bursts, else first burst, else rate*duration, capped', () => {
    expect(emitterCount(rec())).toBe(10); // single time-0 burst
    expect(emitterCount(rec({
      emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 10 }, { time: 0, count: 5 }] },
    }))).toBe(15);
    expect(emitterCount(rec({
      emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0.5, count: 7 }] },
    }))).toBe(7); // no time-0 burst -> first burst
    expect(emitterCount(rec({
      duration: 1, emission: { rate: { min: 16, max: 32 }, bursts: [] },
    }))).toBe(32); // rate snapshot
    expect(emitterCount(rec({
      maxParticles: 1000, emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 5000 }] },
    }))).toBe(1000); // capped at maxParticles
  });

  it('deriveFade: alpha->0 (smoke), color->black (additive), else default', () => {
    expect(deriveFade(null)).toBe(DEFAULT_FADE);
    // alpha holds then fades over the last 30%.
    expect(deriveFade({ enabled: true, gradient: { color: [], alpha: [{ time: 0, a: 1 }, { time: 0.7, a: 1 }, { time: 1, a: 0 }] } })).toBeCloseTo(0.3, 5);
    // alpha fades from the start -> whole life.
    expect(deriveFade({ enabled: true, gradient: { color: [], alpha: [{ time: 0, a: 0.5 }, { time: 1, a: 0 }] } })).toBeCloseTo(1, 5);
    // additive: alpha constant 1, color white->black over the last 40%.
    expect(deriveFade({
      enabled: true,
      gradient: {
        color: [{ time: 0, r: 1, g: 1, b: 1 }, { time: 0.6, r: 1, g: 1, b: 1 }, { time: 1, r: 0, g: 0, b: 0 }],
        alpha: [{ time: 0, a: 1 }, { time: 1, a: 1 }],
      },
    })).toBeCloseTo(0.4, 5);
  });
});

describe('ParticleSystem.burstFromEmitter', () => {
  it('spawns the mapped burst count into the pool and tracks alive', () => {
    const ps = new ParticleSystem(64);
    const r = rec({ emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 12 }] } });
    expect(ps.burstFromEmitter(r, POS)).toBe(12);
    expect(ps.alive).toBe(12);
  });

  it('pool-full drops extra spawns (same semantics as burst)', () => {
    const ps = new ParticleSystem(8);
    const r = rec({ emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 8 }] } });
    expect(ps.burstFromEmitter(r, POS)).toBe(8);
    expect(ps.burstFromEmitter(r, POS)).toBe(0);
    expect(ps.alive).toBe(8);
  });

  it('particles start at the emitter position', () => {
    const ps = new ParticleSystem(16);
    const r = rec({
      startSpeed: { min: 0, max: 0 },
      gravityModifier: { min: 0, max: 0 },
      shape: { type: 'sphere', typeId: 0, enabled: true, radius: 0.1, angle: 0 },
      emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 1 }] },
    });
    ps.burstFromEmitter(r, new THREE.Vector3(1, 5, 2));
    ps.update(0.1);
    const pos = ps.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(1, 5);
    expect(pos.getY(0)).toBeCloseTo(5, 5);
    expect(pos.getZ(0)).toBeCloseTo(2, 5);
  });

  it('applies mapped gravity (positive gravityModifier pulls down)', () => {
    const ps = new ParticleSystem(16);
    const r = rec({
      startSpeed: { min: 0, max: 0 },
      gravityModifier: { min: 1, max: 1 },
      shape: { type: 'sphere', typeId: 0, enabled: true, radius: 0.1, angle: 0 },
      emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 1 }] },
    });
    ps.burstFromEmitter(r, new THREE.Vector3(0, 5, 0));
    ps.update(0.1);
    const pos = ps.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.getY(0)).toBeLessThan(5);
  });

  it('particles die after their extracted lifetime', () => {
    const ps = new ParticleSystem(16);
    const r = rec({
      startLifetime: { min: 0.5, max: 0.5 },
      emission: { rate: { min: 0, max: 0 }, bursts: [{ time: 0, count: 6 }] },
    });
    ps.burstFromEmitter(r, POS);
    ps.update(0.3);
    expect(ps.alive).toBe(6);
    ps.update(0.3); // past 0.5s life
    expect(ps.alive).toBe(0);
  });
});
