import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MeshParticles } from '../../src/view/particles/MeshParticles';
import type { EmitterRecord } from '../../src/view/particles/ExtractedEmitter';

const rec = {
  name: 'ps_rock', duration: 1, looping: true, maxParticles: 32,
  startLifetime: { min: 1, max: 1 }, startSpeed: { min: 2, max: 2 }, startSize: { min: 1, max: 1 },
  gravityModifier: { min: 1, max: 1 }, emission: { rate: { min: 40, max: 40 }, bursts: [] },
  shape: { typeId: 9, radius: 0.5, angle: 25 }, sizeOverLifetime: { enabled: true, samples: [1, 1, 1, 0] },
} as unknown as EmitterRecord;

function make(): MeshParticles {
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  return new MeshParticles(new Map([['vfx_rock_01', geo]]), new Map([['ps_rock', { mesh: 'vfx_rock_01', color: [0.375, 0.32, 0.24, 1] }]]), 64);
}

describe('MeshParticles (RenderMode Mesh emitters)', () => {
  it('handles only mesh-mode emitters and spawns lit mesh instances', () => {
    const mp = make();
    expect(mp.handles('ps_rock')).toBe(true);
    expect(mp.handles('ps_smoke')).toBe(false);
    const h = mp.startLoop(rec, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < 30; i++) mp.update(1 / 60);
    expect(mp.alive).toBeGreaterThan(5);
    const mesh = mp.group.children[0] as THREE.InstancedMesh;
    expect((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    h.stop();
    for (let i = 0; i < 120; i++) mp.update(1 / 60);
    expect(mp.alive).toBe(0); // live particles finish, nothing emits after stop
  });
  it('a one-shot bounded loop stops by itself', () => {
    const mp = make();
    const h = mp.startLoop(rec, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 1, 0.5);
    for (let i = 0; i < 60 * 4; i++) mp.update(1 / 60);
    expect(h.active).toBe(false);
    expect(mp.alive).toBe(0);
  });
  it('ice material (Standard _Mode 2): translucent, glossy, metallic, emissive; rock stays opaque and rough', () => {
    const ice = new MeshParticles(new Map([['vfx_rock_01', new THREE.BoxGeometry(0.1, 0.1, 0.1)]]), new Map([
      ['ps_ice', { mesh: 'vfx_rock_01', color: [0.64, 0.806, 1, 0.502], mode: 2, glossiness: 0.85, metallic: 0.9, emission: [0.255, 0.265, 0.264] }],
      ['ps_rock', { mesh: 'vfx_rock_01', color: [0.375, 0.321, 0.24, 1], mode: 0, glossiness: 0.2, metallic: 0 }],
    ]), 16);
    const a = new THREE.Vector3(0, 1, 0);
    ice.burst({ ...rec, name: 'ps_ice', looping: false, emission: { rate: { min: 0, max: 0 }, bursts: [{ count: 3 }] } } as unknown as EmitterRecord, new THREE.Vector3(), a);
    ice.burst({ ...rec, name: 'ps_rock', looping: false, emission: { rate: { min: 0, max: 0 }, bursts: [{ count: 3 }] } } as unknown as EmitterRecord, new THREE.Vector3(), a);
    ice.update(0.01);
    const mats = ice.group.children.map((c) => (c as THREE.InstancedMesh).material as THREE.MeshStandardMaterial);
    const iceMat = mats.find((m) => m.transparent)!;
    const rockMat = mats.find((m) => !m.transparent)!;
    expect(iceMat.opacity).toBeCloseTo(0.502, 3);
    expect(iceMat.roughness).toBeCloseTo(0.15, 3);
    expect(iceMat.metalness).toBeCloseTo(0.9, 3);
    expect(iceMat.depthWrite).toBe(false);
    expect(rockMat.roughness).toBeCloseTo(0.8, 3);
  });
});
