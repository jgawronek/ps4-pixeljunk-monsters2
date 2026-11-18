/**
 * Shared helpers for the physics parity/spike tests.
 *
 * Path resolution is derived from this file's location so the tests run from
 * any cwd. Layout:
 *   <repo>/pjm2-web/tests/physics/helpers.ts
 *   <repo>/pjm2-web/.work/physics-spike/3d_stage_001_colliders.json
 *   <repo>/pjm2-web/tools/colliders/extract_stage_colliders.py
 *   <repo>/decomp/data/stage_waves_resolved.json
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PJM2_WEB = resolve(HERE, '..', '..');
export const REPO = resolve(PJM2_WEB, '..');

export const PYTHON = process.env.PJM2_PYTHON ?? '/srv/opencode/venv-unity/bin/python';
export const EXTRACTOR = join(PJM2_WEB, 'tools', 'colliders', 'extract_stage_colliders.py');
export const WORK_DIR = join(PJM2_WEB, '.work', 'physics-spike');
export const STAGE = '3d_stage_001';
export const STAGE_JSON = join(WORK_DIR, `${STAGE}_colliders.json`);
export const WAVES_JSON = join(REPO, 'decomp', 'data', 'stage_waves_resolved.json');
export const STAGE_ORDER_JSON = join(REPO, 'decomp', 'data', 'stage_order.json');

/** The waves entry whose (area, stage) resolves to scene 3d_stage_001. */
export const PARITY_AREA = 'tl_area_001';
export const PARITY_STAGE = 'tl_stage_001';

export function pythonAvailable(): boolean {
  if (!existsSync(PYTHON)) return false;
  try {
    execFileSync(PYTHON, ['-c', 'import UnityPy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous "can these tests run at all" check, safe to evaluate at vitest
 * collection time (describe.skipIf). True when the extraction JSON already
 * exists OR python+UnityPy is available to (re)generate it.
 */
export function stageJsonAvailable(): boolean {
  return existsSync(STAGE_JSON) || pythonAvailable();
}

/**
 * Ensure the stage extraction JSON exists, running the python extractor if it
 * does not. Returns the JSON path, or null when extraction is impossible
 * (python missing AND no pre-generated JSON) so callers can skip gracefully.
 */
export function ensureStageJson(force = false): string | null {
  if (!force && existsSync(STAGE_JSON)) return STAGE_JSON;
  if (!pythonAvailable()) {
    return existsSync(STAGE_JSON) ? STAGE_JSON : null;
  }
  const res = spawnSync(
    PYTHON,
    [EXTRACTOR, STAGE, '--out', WORK_DIR],
    { stdio: 'pipe', encoding: 'utf8', timeout: 600_000 },
  );
  if (res.status !== 0) {
    throw new Error(
      `extractor failed (exit ${res.status}):\n${(res.stdout ?? '').slice(-800)}\n${(res.stderr ?? '').slice(-800)}`,
    );
  }
  return existsSync(STAGE_JSON) ? STAGE_JSON : null;
}

export interface PathPoint { x: number; y: number; z: number }
export interface WavesEntry {
  stageName: string;
  areaName: string;
  waves: Array<Array<{ spawns?: Array<{ m_pathName?: string; m_pathList?: PathPoint[] }> }>>;
}

/**
 * Load the ground-truth waves entry that corresponds to scene 3d_stage_001.
 *
 * IMPORTANT: stageName alone is ambiguous — `tl_stage_001` appears once per
 * area (tl_area_001 → 3d_stage_001, tl_area_002 → 3d_stage_004, ...). We pick
 * the (tl_area_001, tl_stage_001) entry, which stage_order.json /
 * AreaStageInfoMap.json map to scene 3d_stage_001. Selecting the wrong entry
 * (e.g. list index 0 = tl_area_002) makes paths float 4–9 m above this scene's
 * terrain — that was the only reason an early probe showed a low hit rate.
 */
export function loadParityEntry(): WavesEntry {
  const all = JSON.parse(readFileSync(WAVES_JSON, 'utf8')) as WavesEntry[];
  const entry = all.find(
    (e) => e.stageName === PARITY_STAGE && e.areaName === PARITY_AREA,
  );
  if (!entry) {
    throw new Error(`waves entry (${PARITY_AREA}, ${PARITY_STAGE}) not found`);
  }
  return entry;
}

/** Flatten every m_pathList point across all waves, tagged with its path name. */
export function collectPathPoints(entry: WavesEntry): Array<{ path: string; p: PathPoint }> {
  const out: Array<{ path: string; p: PathPoint }> = [];
  for (const wave of entry.waves ?? []) {
    for (const group of wave ?? []) {
      for (const sp of group.spawns ?? []) {
        for (const p of sp.m_pathList ?? []) out.push({ path: sp.m_pathName ?? '?', p });
      }
    }
  }
  return out;
}

/** Deterministic sample: every `stride`-th point, capped at `cap`. */
export function samplePoints<T>(pts: T[], stride = 10, cap = 500): T[] {
  const out: T[] = [];
  for (let i = 0; i < pts.length && out.length < cap; i += stride) out.push(pts[i]);
  return out;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
