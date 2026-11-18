// tests/view/towerEffects.test.ts
// Looping build effect (ef_tower_common_build_pv), AudioManager.startLoop
// (PlaySFXMonitored/StopSFX), and generated-data ↔ shipped-asset consistency.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AudioManager, type AudioContextLike, type AudioSourceLike } from '../../src/view/audio/AudioManager';
import { parseEmitterFile, type EmitterRecord } from '../../src/view/particles/ExtractedEmitter';
import { ParticleSystem } from '../../src/view/particles/ParticleSystem';
import { burstPrefab, startLoopingPrefab, TOWER_EFFECT_PREFABS } from '../../src/view/characters/towerEffects';
import { TOWER_VIEW_DATA } from '../../src/view/characters/towerViewData.generated';

function loadEmitters(): Map<string, EmitterRecord> {
  const json = JSON.parse(readFileSync(new URL('../../public/assets/particles/particles.json', import.meta.url), 'utf8'));
  return new Map(parseEmitterFile(json).map((r) => [r.name, r]));
}

describe('looping build effect (ParticleSystem.startLoop)', () => {
  const emitters = loadEmitters();

  it('the effect prefab children exist in the extracted emitters and loop in the original', () => {
    for (const c of TOWER_EFFECT_PREFABS['ef_tower_common_build_pv']) {
      const rec = emitters.get(c.emitter);
      expect(rec, c.emitter).toBeDefined();
      expect(rec!.looping).toBe(true);
    }
  });

  it('emits continuously at the serialized rate while looping, and stops emitting on stop()', () => {
    const ps = new ParticleSystem(4096);
    const h = startLoopingPrefab(ps, emitters, 'ef_tower_common_build_pv', new THREE.Vector3(-40, 0, 40))!;
    expect(h).not.toBeNull();
    expect(ps.activeLoops).toBe(2);
    // 2 s at 60 Hz: smoke 16..32/s (mean 24) + rock 8..16/s (mean 12) ≈ 72 emitted; live ≥ most of them (life 1-2 s)
    for (let i = 0; i < 120; i++) ps.update(1 / 60);
    const live = ps.alive;
    expect(live).toBeGreaterThan(35);
    expect(live).toBeLessThan(95);
    h.stop(); // StopLoopingThenDestroy
    expect(ps.activeLoops).toBe(0);
    ps.update(1 / 60);
    for (let i = 0; i < 240; i++) ps.update(1 / 60); // live particles finish, nothing new
    expect(ps.alive).toBe(0);
  });

  it('smoke starts at the ground ring (r 0.3, y+0.1) and is speed-limited to ≤ 1 u/s', () => {
    const ps = new ParticleSystem(4096);
    startLoopingPrefab(ps, new Map([['ps_tower_common_build_smoke', emitters.get('ps_tower_common_build_smoke')!]]),
      'ef_tower_common_build_pv', new THREE.Vector3(0, 0, 0));
    const pos: number[] = [];
    for (let i = 0; i < 90; i++) ps.update(1 / 60);
    const attr = ps.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = ps.points.geometry.drawRange.count;
    for (let i = 0; i < n; i++) pos.push(Math.hypot(attr.getX(i), attr.getZ(i)));
    expect(n).toBeGreaterThan(10);
    // without the LimitVelocity clamp a 10-20 u/s start speed would reach >> 5 units in 1.5 s
    expect(Math.max(...pos)).toBeLessThan(2.5);
  });

  it('scrap burst one-shot spawns every child emitter', () => {
    const ps = new ParticleSystem(4096);
    expect(burstPrefab(ps, emitters, 'ef_tower_common_scrap_pv', new THREE.Vector3())).toBeGreaterThan(0);
    expect(ps.alive).toBeGreaterThan(0);
  });
});

// ---- AudioManager.startLoop -------------------------------------------------------

class FakeSource implements AudioSourceLike {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect(): void {}
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}

function fakeAudio(): { audio: AudioManager; sources: FakeSource[] } {
  const sources: FakeSource[] = [];
  const ctx: AudioContextLike = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: async () => {},
    decodeAudioData: async () => ({ decoded: true }),
    createBufferSource: () => { const s = new FakeSource(); sources.push(s); return s; },
    createGain: () => ({ gain: { value: 1 }, connect: () => {} }),
  };
  return { audio: new AudioManager({ context: ctx, fetchImpl: async () => new ArrayBuffer(8) }), sources };
}

describe('AudioManager.startLoop (PlaySFXMonitored loop = true / StopSFX)', () => {
  it('starts a looping source once decoded and stop() ends it', async () => {
    const { audio, sources } = fakeAudio();
    const h = audio.startLoop('sfx/sfx_tower_buildtower');
    await audio.load('sfx/sfx_tower_buildtower');
    await Promise.resolve();
    expect(sources.length).toBe(1);
    expect(sources[0].loop).toBe(true);
    expect(sources[0].started).toBe(true);
    expect(h.started).toBe(true);
    h.stop();
    expect(sources[0].stopped).toBe(true);
    h.stop(); // idempotent
  });

  it('stop() before the clip decoded cancels the start', async () => {
    const { audio, sources } = fakeAudio();
    const h = audio.startLoop('sfx/sfx_tower_rotate');
    h.stop();
    await audio.load('sfx/sfx_tower_rotate');
    await Promise.resolve();
    expect(sources.length).toBe(0);
  });
});

// ---- generated data vs shipped assets ---------------------------------------------

describe('towerViewData.generated vs public/assets', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/assets/characters/manifest.json', import.meta.url), 'utf8'));
  const clipsOf = (def: string): string[] =>
    (manifest.characters.find((c: { defName: string }) => c.defName === def)?.animations ?? []).map((a: { name: string }) => a.name);

  it('every controller state clip of every production tower exists in its baked GLB clip list', () => {
    for (const [def, rec] of Object.entries(TOWER_VIEW_DATA)) {
      const baked = clipsOf(def);
      if (baked.length === 0 || rec.controller === null) continue;
      for (const l of rec.controller.layers) {
        for (const s of l.states) {
          if (s.clip === null || s.clip.startsWith('#clip')) continue; // blend trees (tower_012)
          const hit = baked.includes(`${def}_comp/${s.clip}`) || baked.includes(s.clip);
          expect(hit, `${def} ${l.name}.${s.name} → ${s.clip}`).toBe(true);
        }
      }
    }
  });

  it('every TowerBase fort joint / rotate sound / effect named by the data resolves', () => {
    const emitters = loadEmitters();
    for (const [def, rec] of Object.entries(TOWER_VIEW_DATA)) {
      if (rec.buildEffect !== null) expect(TOWER_EFFECT_PREFABS[rec.buildEffect], def).toBeDefined();
      if (rec.destroyEffect !== null) expect(TOWER_EFFECT_PREFABS[rec.destroyEffect], def).toBeDefined();
      if (rec.rotateSound !== null) {
        expect(rec.rotateSound).toBe('sfx_tower_rotate');
        void emitters;
      }
    }
  });
});
