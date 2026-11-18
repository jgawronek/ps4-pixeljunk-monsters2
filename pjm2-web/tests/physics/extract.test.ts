/**
 * Extraction smoke test — actually RUNS the python extractor via child_process
 * into an isolated temp output dir (so it cannot race the shared .work JSON that
 * the parity/world tests read) and validates the emitted artifacts.
 *
 * Skips gracefully with a clear message when the UnityPy venv is unavailable.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StageCollidersJson } from '../../src/engine/physics/world.js';
import { EXTRACTOR, PYTHON, pythonAvailable, STAGE, WORK_DIR } from './helpers.js';

const havePython = pythonAvailable();
const TMP_OUT = join(WORK_DIR, '_extract_smoke');
const TMP_JSON = join(TMP_OUT, `${STAGE}_colliders.json`);

let json: StageCollidersJson | null = null;
let runLog = '';

beforeAll(() => {
  if (!havePython) return;
  rmSync(TMP_OUT, { recursive: true, force: true });
  const res = spawnSync(PYTHON, [EXTRACTOR, STAGE, '--out', TMP_OUT], {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 600_000,
  });
  runLog = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  if (res.status !== 0) throw new Error(`extractor exited ${res.status}\n${runLog.slice(-1500)}`);
  json = JSON.parse(readFileSync(TMP_JSON, 'utf8')) as StageCollidersJson;
}, 600_000);

afterAll(() => {
  // keep artifacts for inspection under .work (owned by this task); remove only
  // if they are large and python ran — leaving them aids debugging.
  void TMP_OUT;
});

describe.skipIf(!havePython)('extract_stage_colliders.py (runs python)', () => {
  it('prints a summary and reports the TerrainMask', () => {
    expect(runLog).toContain('extraction summary');
    expect(runLog).toMatch(/TerrainMask:\s+-536870912/);
    // eslint-disable-next-line no-console
    console.log(runLog.split('\n').filter((l) => /summary|TerrainMask|colliders by|MeshCollider|BoxCollider|CapsuleCollider|SphereCollider|usable|meshes:|output:/.test(l)).join('\n'));
  });

  it('emits parseable JSON with colliders > 0', () => {
    expect(json).toBeTruthy();
    expect(Array.isArray(json!.colliders)).toBe(true);
    expect(json!.colliders.length).toBeGreaterThan(0);
  });

  it('records Q4.Layers header (TerrainMask = 0xE0000000, WaterMask = 1<<4)', () => {
    expect(json!.q4Layers.masks.TerrainMask).toBe(-536870912);
    expect(json!.q4Layers.masksUnsigned.TerrainMask >>> 0).toBe(0xe0000000);
    expect(json!.q4Layers.masks.WaterMask).toBe(1 << 4);
    expect(json!.unityLayers[29]).toBe('Art_Terrain');
  });

  it('writes mesh binaries whose byte sizes match counts', () => {
    const ids = Object.keys(json!.meshes);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const m = json!.meshes[id];
      const vf = join(TMP_OUT, m.vertsFile);
      const idf = join(TMP_OUT, m.idxFile);
      expect(existsSync(vf), `missing ${m.vertsFile}`).toBe(true);
      expect(existsSync(idf), `missing ${m.idxFile}`).toBe(true);
      expect(statSync(vf).size).toBe(m.vertexCount * 3 * 4);
      expect(statSync(idf).size).toBe(m.triangleCount * 3 * 4);
    }
  });

  it('exports the terrain MeshCollider with identity scale on Art_Terrain', () => {
    const terrain = json!.colliders.find(
      (c) => c.kind === 'mesh' && c.name.startsWith('terrain_001') && c.layerName === 'Art_Terrain',
    );
    expect(terrain, 'terrain_001 mesh collider present').toBeTruthy();
    expect(terrain!.meshRef).toBeTruthy();
    expect(terrain!.transform!.scale).toEqual([1, 1, 1]);
    expect(terrain!.isTrigger).toBe(false);
  });

  it('reports collider kinds (no TerrainCollider — terrain is a MeshCollider here)', () => {
    const byKind: Record<string, number> = {};
    for (const c of json!.colliders) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    // eslint-disable-next-line no-console
    console.log('[extract-smoke] kinds:', byKind);
    expect(byKind.mesh ?? 0).toBeGreaterThanOrEqual(3);
    expect(byKind.box ?? 0).toBeGreaterThan(100);
    expect(byKind.capsule ?? 0).toBeGreaterThan(100);
    expect(byKind.terrain ?? 0).toBe(0); // documented: baked as MeshCollider
  });
});

describe('extraction environment', () => {
  it('reports python availability (informational; suite skips without it)', () => {
    // eslint-disable-next-line no-console
    console.log(`[extract] python venv available: ${havePython} (${PYTHON})`);
    expect(typeof havePython).toBe('boolean');
  });
});
