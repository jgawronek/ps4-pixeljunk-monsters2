/**
 * PARITY TEST — the heart of the physics spike.
 *
 * Ground truth: decomp/data/stage_waves_resolved.json, the waves entry that
 * resolves to scene 3d_stage_001 = (tl_area_001, tl_stage_001). We collect every
 * m_pathList point across all waves, sample every 10th (capped 500), and for
 * each do a downward linecast (x, y+2, z) → (x, y-2, z) with the reconstructed
 * Q4.Layers.TerrainMask. If the extracted static terrain is faithful and the
 * query layer matches Unity, the paths the original enemies walk must sit ON the
 * terrain: high hit rate and |hit.y − pathY| small.
 *
 * NOTE ON ENTRY SELECTION (important, was the only real bug found):
 * stageName "tl_stage_001" is NOT unique — it appears once per area. List index
 * 0 is (tl_area_002, tl_stage_001) which maps to scene 3d_stage_004, a DIFFERENT
 * map; probing its paths against 3d_stage_001 terrain yields ~20% grounded and
 * paths floating 4–9 m in the air. The correct entry for scene 3d_stage_001 is
 * (tl_area_001, tl_stage_001) — see helpers.loadParityEntry().
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createQueries, loadStageWorld, type PhysicsWorld } from '../../src/engine/physics/index.js';
import {
  collectPathPoints,
  ensureStageJson,
  loadParityEntry,
  samplePoints,
  stageJsonAvailable,
} from './helpers.js';

// Synchronous availability check (evaluated at collection time, unlike `pw`).
const canRun = stageJsonAvailable();
let pw!: PhysicsWorld;

beforeAll(async () => {
  const p = ensureStageJson();
  if (p) pw = await loadStageWorld(p);
}, 600_000);

interface Stat { n: number; hits: number; sumAbsDy: number; maxAbsDy: number; within035: number; maxDy: number; minDy: number }

describe.skipIf(!canRun)('PARITY: enemy walk paths vs extracted terrain (3d_stage_001)', () => {
  it('paths sit on terrain: hit rate ≥ 95% and |dy| ≤ 0.35 for ≥ 90% of hits', () => {
    const q = createQueries(pw);
    const mask = pw.terrainMask;
    const entry = loadParityEntry();
    const all = collectPathPoints(entry);
    const sample = samplePoints(all, 10, 500);

    const per: Record<string, Stat> = {};
    let hits = 0;
    let sumAbsDy = 0;
    let maxAbsDy = 0;
    let within035 = 0;
    let grounded = 0; // |dy|<=0.35
    for (const { path, p } of sample) {
      const s: Stat = (per[path] ??= { n: 0, hits: 0, sumAbsDy: 0, maxAbsDy: 0, within035: 0, maxDy: -1e9, minDy: 1e9 });
      s.n++;
      const hit = q.linecast(p.x, p.y + 2, p.z, p.x, p.y - 2, p.z, mask);
      if (hit) {
        const dy = hit.point[1] - p.y;
        const ady = Math.abs(dy);
        hits++; s.hits++;
        sumAbsDy += ady; s.sumAbsDy += ady;
        if (ady > maxAbsDy) maxAbsDy = ady;
        if (ady > s.maxAbsDy) s.maxAbsDy = ady;
        if (ady <= 0.35) { within035++; s.within035++; grounded++; }
        if (dy > s.maxDy) s.maxDy = dy;
        if (dy < s.minDy) s.minDy = dy;
      }
    }

    const n = sample.length;
    const hitRate = hits / n;
    const meanAbsDy = hits ? sumAbsDy / hits : 0;
    const within035Rate = hits ? within035 / hits : 0;

    // ---- report -----------------------------------------------------------
    // eslint-disable-next-line no-console
    console.log('\n===== PARITY (linecast y+2 → y-2, TerrainMask) =====');
    // eslint-disable-next-line no-console
    console.log(`waves entry: area=${entry.areaName} stage=${entry.stageName}  total path pts=${all.length}  sampled=${n}`);
    // eslint-disable-next-line no-console
    console.log(`HIT RATE      : ${(hitRate * 100).toFixed(2)}%  (${hits}/${n})`);
    // eslint-disable-next-line no-console
    console.log(`mean |dy|     : ${meanAbsDy.toFixed(4)} m   max |dy|: ${maxAbsDy.toFixed(4)} m`);
    // eslint-disable-next-line no-console
    console.log(`|dy| ≤ 0.35   : ${(within035Rate * 100).toFixed(2)}% of hits  (${within035}/${hits})`);
    // eslint-disable-next-line no-console
    console.log('per-path breakdown:');
    for (const [name, s] of Object.entries(per).sort((a, b) => b[1].n - a[1].n)) {
      const rate = s.hits / s.n;
      const mdy = s.hits ? s.sumAbsDy / s.hits : 0;
      const w = s.hits ? s.within035 / s.hits : 0;
      // eslint-disable-next-line no-console
      console.log(
        `  ${name.padEnd(24)} n=${String(s.n).padStart(4)} hit=${(rate * 100).toFixed(1).padStart(5)}% ` +
        `mean|dy|=${mdy.toFixed(3)} max|dy|=${s.maxAbsDy.toFixed(3)} within0.35=${(w * 100).toFixed(1)}% ` +
        `dy∈[${s.hits ? s.minDy.toFixed(2) : '-'},${s.hits ? s.maxDy.toFixed(2) : '-'}]`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('===================================================\n');

    // ---- assertions (thresholds chosen from measured data with margin) ----
    expect(hitRate, 'path points should find terrain within ±2 m').toBeGreaterThanOrEqual(0.95);
    expect(meanAbsDy, 'mean vertical error should be small').toBeLessThanOrEqual(0.15);
    expect(within035Rate, '≥90% of hits within 0.35 m of the path height').toBeGreaterThanOrEqual(0.9);
  });
});
