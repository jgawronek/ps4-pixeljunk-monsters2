/**
 * sphereCast sanity — mirrors how GameCoreFruit / GameCorePickupCurrency sweep
 * a sphere along motion against TerrainMask. Two checks:
 *  (a) a downward sphere sweep from above path points should hit terrain with
 *      sane unit normals pointing up;
 *  (b) a sphere sweep ALONG a path segment should produce some hits, all with
 *      |normal| ≈ 1.
 * Also validates the Unity SphereCast initial-overlap rule (toi≈0 → miss).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createQueries, loadStageWorld, type PhysicsWorld } from '../../src/engine/physics/index.js';
import {
  collectPathPoints,
  ensureStageJson,
  loadParityEntry,
  samplePoints,
  stageJsonAvailable,
  type PathPoint,
} from './helpers.js';

const canRun = stageJsonAvailable();
let pw!: PhysicsWorld;

beforeAll(async () => {
  const p = ensureStageJson();
  if (p) pw = await loadStageWorld(p);
}, 600_000);

function segments(entry: ReturnType<typeof loadParityEntry>): Array<[PathPoint, PathPoint, string]> {
  const out: Array<[PathPoint, PathPoint, string]> = [];
  for (const wave of entry.waves ?? []) {
    for (const g of wave ?? []) {
      for (const sp of g.spawns ?? []) {
        const pl = sp.m_pathList ?? [];
        for (let i = 0; i + 1 < pl.length; i++) out.push([pl[i], pl[i + 1], sp.m_pathName ?? '?']);
      }
    }
  }
  return out;
}

const nlen = (n: number[]) => Math.hypot(n[0], n[1], n[2]);

describe.skipIf(!canRun)('sphereCast sanity (3d_stage_001)', () => {
  it('downward sphere sweep hits terrain with up-facing unit normals', () => {
    const q = createQueries(pw);
    const mask = pw.terrainMask;
    const pts = samplePoints(collectPathPoints(loadParityEntry()), 12, 400);
    let hits = 0;
    let sumNy = 0;
    let badNormal = 0;
    for (const { p } of pts) {
      const hit = q.sphereCast(p.x, p.y + 2, p.z, 0, -1, 0, 0.3, 4, mask);
      if (hit) {
        hits++;
        const L = nlen(hit.normal);
        if (Math.abs(L - 1) > 1e-2) badNormal++;
        sumNy += hit.normal[1];
      }
    }
    const rate = hits / pts.length;
    // eslint-disable-next-line no-console
    console.log(`[sphereCast↓] hits=${hits}/${pts.length} (${(rate * 100).toFixed(1)}%) meanNormalY=${(sumNy / Math.max(1, hits)).toFixed(3)} badNormals=${badNormal}`);
    expect(rate).toBeGreaterThanOrEqual(0.9);
    expect(badNormal).toBe(0); // |normal| ≈ 1 for all hits
    expect(sumNy / hits).toBeGreaterThan(0.7); // mostly up-facing ground
  });

  it('sphere sweep along path segments produces hits with |normal| ≈ 1', () => {
    const q = createQueries(pw);
    const mask = pw.terrainMask;
    const segs = samplePoints(segments(loadParityEntry()), 8, 400);
    let hits = 0;
    let badNormal = 0;
    for (const [a, b] of segs) {
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.2) continue;
      dx /= len; dy /= len; dz /= len;
      // sweep a 0.35 m sphere from just above point A toward B
      const hit = q.sphereCast(a.x, a.y + 0.4, a.z, dx, dy, dz, 0.35, len, mask);
      if (hit) {
        hits++;
        if (Math.abs(nlen(hit.normal) - 1) > 1e-2) badNormal++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[sphereCast→] along-segment hits=${hits}/${segs.length} badNormals=${badNormal}`);
    expect(hits).toBeGreaterThan(0); // "some hits"
    expect(badNormal).toBe(0); // all sane unit normals
  });

  it('respects Unity SphereCast initial-overlap rule (toi≈0 → miss)', () => {
    const q = createQueries(pw);
    const mask = pw.terrainMask;
    const p = collectPathPoints(loadParityEntry())[Math.floor(collectPathPoints(loadParityEntry()).length / 2)].p;
    // First find the terrain surface below the path point.
    const down = q.linecast(p.x, p.y + 2, p.z, p.x, p.y - 2, p.z, mask);
    expect(down).toBeTruthy();
    const surfY = down!.point[1];
    // A sphere centred BELOW the surface already overlaps terrain at origin →
    // Unity SphereCast reports NO hit for that collider.
    const overlapping = q.sphereCast(p.x, surfY - 0.2, p.z, 0, -1, 0, 0.5, 3, mask);
    expect(overlapping, 'sphere starting inside terrain must be a miss (Unity parity)').toBeNull();
    // A sphere clearly above the surface must hit.
    const clear = q.sphereCast(p.x, surfY + 2, p.z, 0, -1, 0, 0.3, 4, mask);
    expect(clear).toBeTruthy();
  });
});
