import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import {
  PROBE_FORMAT, unityGlossyMip, equirectUv, stageProbeUrls, parseProbeMeta, buildProbeTexture,
  patchUnityIndirectChunks, installStageReflectionProbe, isUnityProbeScene, loadStageReflectionProbe,
  type ProbeMeta,
} from '../../src/view/stage/StageReflectionProbe';
import { disableEnvDiffuse } from '../../src/view/stage/StageAmbient';

/** Expand `#include <chunk>` recursively against the live ShaderChunk (what three does at program build). */
function expand(src: string): string {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, n: string) => expand(C[n] ?? ''));
}
const half = (h: number): number => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
};
const ROOT = 'public/assets/stages/3d_stage_001/probe/';

describe('Unity probe maths', () => {
  it('glossy mip = pr*(1.7-0.7pr)*6', () => {
    expect(unityGlossyMip(0)).toBe(0);
    expect(unityGlossyMip(1)).toBeCloseTo(6, 6);
    expect(unityGlossyMip(0.5)).toBeCloseTo(0.5 * 1.35 * 6, 6);
    expect(unityGlossyMip(0.964)).toBeCloseTo(5.93, 2); // terrain gloss 0.036
  });
  it('equirect: +Y at v=0, +X at u=0.5, +Z at u=0.75', () => {
    expect(equirectUv(0, 1, 0)[1]).toBeCloseTo(0, 6);
    expect(equirectUv(0, -1, 0)[1]).toBeCloseTo(1, 6);
    expect(equirectUv(1, 0, 0)[0]).toBeCloseTo(0.5, 6);
    expect(equirectUv(0, 0, 1)[0]).toBeCloseTo(0.75, 6);
    expect(equirectUv(-1, 0, 0)[0]).toBeCloseTo(1.0, 6);
  });
});

describe('meta + texture', () => {
  const mips = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => { const w = 512 >> m, h = 256 >> m; return { width: w, height: h, bytes: w * h * 8 }; });
  const meta: ProbeMeta = { format: PROBE_FORMAT, mips, lodSteps: 6, intensity: 1 };
  it('rejects malformed meta', () => {
    expect(() => parseProbeMeta(null)).toThrow();
    expect(() => parseProbeMeta({ ...meta, format: 'x' })).toThrow();
    expect(() => parseProbeMeta({ ...meta, mips: [{ width: 4, height: 2, bytes: 3 }] })).toThrow();
    expect(() => parseProbeMeta({ ...meta, mips: mips.map((m, i) => (i === 3 ? { ...m, width: 99, bytes: 99 * m.height * 8 } : m)) })).toThrow();
    expect(parseProbeMeta(meta).mips).toHaveLength(8);
  });
  it('builds a mip-mapped half-float CubeUV DataTexture and refuses short buffers', () => {
    const total = mips.reduce((a, b) => a + b.bytes, 0);
    const t = buildProbeTexture(meta, new ArrayBuffer(total));
    expect(t.mipmaps).toHaveLength(8);
    expect(t.mapping).toBe(THREE.CubeUVReflectionMapping);
    expect(t.type).toBe(THREE.HalfFloatType);
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(() => buildProbeTexture(meta, new ArrayBuffer(total - 1))).toThrow();
  });
  it('stageProbeUrls', () => {
    expect(stageProbeUrls('/a/b/').json).toBe('/a/b/probe/reflection_probe.json');
  });
});

describe('shader chunk patches (against the real three 0.169 ShaderLib)', () => {
  it('apply idempotently and land inside the expanded physical fragment shader in a compilable order', () => {
    disableEnvDiffuse();
    patchUnityIndirectChunks(); patchUnityIndirectChunks();
    for (const lib of ['standard', 'physical'] as const) {
      const src = expand(THREE.ShaderLib[lib].fragmentShader);
      expect(src).toContain('float unityMip = roughness * ( 1.7 - 0.7 * roughness ) * 6.0;');
      expect(src).toContain('textureLod( envMap, unityUv, unityMip )');
      expect(src).toContain('surfaceReduction * unityF');
      expect(src).toContain('material.diffuseColor *= 1.0 - max(');
      expect(src.match(/float unityMip/g)).toHaveLength(1); // not double-patched
      // the marker uniform is declared before every use
      const decl = src.indexOf('uniform float envMapIntensity');
      expect(decl).toBeGreaterThan(-1);
      for (const use of ['unityMip', 'surfaceReduction', 'material.diffuseColor *= 1.0 - max(']) expect(src.indexOf(use)).toBeGreaterThan(decl);
      // stock PMREM branch is still there for positive intensities
      expect(src).toContain('textureCubeUV( envMap, envMapRotation * reflectVec, roughness )');
      // no unresolved includes
      expect(src).not.toMatch(/#include </);
    }
  });
  it('install sets the negative-intensity marker; PMREM scenes are not marked', () => {
    const scene = new THREE.Scene();
    const tex = new THREE.DataTexture(new Uint16Array(8), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.name = 'StageReflectionProbe';
    expect(isUnityProbeScene(scene)).toBe(false);
    installStageReflectionProbe(scene, tex, 0.5);
    expect(scene.environmentIntensity).toBe(-0.5);
    expect(isUnityProbeScene(scene)).toBe(true);
    const pm = new THREE.Scene(); pm.environment = tex; pm.environmentIntensity = 1;
    expect(isUnityProbeScene(pm)).toBe(false);
  });
});

describe('loadStageReflectionProbe', () => {
  it('resolves null when the stage has no probe or the fetch fails', async () => {
    expect(await loadStageReflectionProbe('/x/', (async () => ({ ok: false })) as unknown as typeof fetch)).toBeNull();
    expect(await loadStageReflectionProbe('/x/', (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe.skipIf(!existsSync(`${ROOT}reflection_probe.json`))('stage-1 exported probe (real data)', () => {
  const meta = parseProbeMeta(JSON.parse(readFileSync(`${ROOT}reflection_probe.json`, 'utf8')));
  const bin = readFileSync(`${ROOT}reflection_probe.f16.bin`);
  const u16 = new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
  const offs: number[] = []; { let o = 0; for (const m of meta.mips) { offs.push(o / 2); o += m.bytes; } }
  /** bilinear texel lookup of mip `m` along a Unity-world direction (wrap in u, clamp in v). */
  const look = (m: number, d: [number, number, number]): number[] => {
    const [u, v] = equirectUv(...d); const w = meta.mips[m].width, h = meta.mips[m].height;
    const fx = u * w - 0.5, fy = v * h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const out = [0, 0, 0];
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const ix = (((x0 + dx) % w) + w) % w, iy = Math.min(h - 1, Math.max(0, y0 + dy));
      const i = offs[m] + (iy * w + ix) * 4;
      for (let c = 0; c < 3; c++) out[c] += wt * half(u16[i + c]);
    }
    return out;
  };
  it('file size matches the meta and has no NaN/Inf', () => {
    expect(bin.byteLength).toBe(meta.mips.reduce((a, b) => a + b.bytes, 0));
    for (let i = 0; i < u16.length; i += 4097) expect(Number.isFinite(half(u16[i]))).toBe(true);
  });
  it('mip 0 holds the HDR sun (>1000) toward Unity (-0.64, 0.71, +0.29); sky is bright above, dark below', () => {
    const sun = look(0, [-0.64, 0.71, 0.29]);
    expect(Math.max(...sun)).toBeGreaterThan(1000);
    const up = look(0, [0.1, 1, 0.1]); const down = look(0, [0, -1, 0]);
    expect(up[0]).toBeGreaterThan(down[0]);
  });
  it('blurred lobe at the camera mirror direction (0, .707, -.707) is ~ (1.2, 1.0, 0.8) at mip 5.9', () => {
    const c = look(6, [0, 0.7071, -0.7071]);
    expect(look(4, [0, 0.7071, -0.7071])[0]).toBeLessThan(0.5); // sharper mips are much darker: the blur carries the sun glow
    expect(c[0]).toBeGreaterThan(0.8); expect(c[0]).toBeLessThan(2.0);
    expect(c[0]).toBeGreaterThan(c[2]); // warm
  });
});
