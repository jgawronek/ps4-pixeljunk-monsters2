/**
 * World test — init Rapier (WASM), load the extracted stage-001 static
 * colliders, and assert the world is populated and queryable.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { createQueries, loadStageWorld, type PhysicsWorld, type RaycastHit } from '../../src/engine/physics/index.js';
import { createGroundHeightQuery } from '../../src/engine/physics/queries.js';
import type { StageCollidersJson } from '../../src/engine/physics/world.js';
import {
  collectPathPoints,
  ensureStageJson,
  loadParityEntry,
  readJson,
  stageJsonAvailable,
  STAGE_JSON,
} from './helpers.js';

const canRun = stageJsonAvailable();
let pw!: PhysicsWorld;
let jsonPath: string | null;

beforeAll(async () => {
  jsonPath = ensureStageJson();
  if (jsonPath) pw = await loadStageWorld(jsonPath);
}, 600_000);

describe.skipIf(!canRun)('PhysicsWorld (stage 3d_stage_001)', () => {
  it('initializes Rapier and loads static colliders', () => {
    expect(pw).toBeTruthy();
    const n = pw.colliderCount();
    // 633 exported records − 9 disabled − 36 inactive − 6 rigidbody = 582 static.
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThan(700);
    // eslint-disable-next-line no-console
    console.log(`[world] rapier colliders: ${n}`);
  });

  it('exposes the reconstructed Q4.Layers masks', () => {
    expect(pw.terrainMask).toBe(-536870912); // 0xE0000000
    expect(pw.waterMask).toBe(1 << 4);
    expect(pw.unityLayers[29]).toBe('Art_Terrain');
  });

  it('loads exactly the usable per-layer collider counts', () => {
    const json = readJson<StageCollidersJson>(jsonPath ?? STAGE_JSON);
    const usable = json.colliders.filter(
      (c) => !c.reportedOnly && c.enabled && c.activeInHierarchy && !c.hasRigidbody && c.transform,
    );
    // every usable collider should map 1:1 into the rapier world
    expect(pw.colliderCount()).toBe(usable.length);
    const terrain = usable.filter((c) => c.layerName === 'Art_Terrain').length;
    // eslint-disable-next-line no-console
    console.log(`[world] usable=${usable.length} Art_Terrain=${terrain} meshes=${Object.keys(json.meshes).length}`);
    expect(terrain).toBeGreaterThan(100);
  });

  it('answers a downward linecast at a real path point with terrain', () => {
    const q = createQueries(pw);
    const pts = collectPathPoints(loadParityEntry());
    expect(pts.length).toBeGreaterThan(1000);
    // use a mid-path point (index far from the airborne spawn) for a clean hit
    const p = pts[Math.floor(pts.length / 2)].p;
    const hit: RaycastHit | null = q.linecast(p.x, p.y + 2, p.z, p.x, p.y - 2, p.z, pw.terrainMask);
    expect(hit, 'expected terrain under a mid-path point').toBeTruthy();
    expect(hit!.layerName).toBe('Art_Terrain');
    expect(Math.abs(hit!.point[1] - p.y)).toBeLessThan(0.35);
    const nlen = Math.hypot(hit!.normal[0], hit!.normal[1], hit!.normal[2]);
    expect(nlen).toBeCloseTo(1, 3);
    // eslint-disable-next-line no-console
    console.log(`[world] probe hit ${hit!.colliderName} dy=${(hit!.point[1] - p.y).toFixed(3)} normal.y=${hit!.normal[1].toFixed(3)}`);
  });

  it('checkSphere detects terrain just below a path point, empty far above', () => {
    const q = createQueries(pw);
    const pts = collectPathPoints(loadParityEntry());
    const p = pts[Math.floor(pts.length / 2)].p;
    expect(q.checkSphere(p.x, p.y - 0.4, p.z, 0.6, pw.terrainMask)).toBe(true);
    expect(q.checkSphere(p.x, p.y + 50, p.z, 0.5, pw.terrainMask)).toBe(false);
  });

  // ---- additive: groundHeight probe (GroundConform / flat-y bug) ----
  // Evidence: .work/ground-conform-probe.ts — the home stump mound rises to
  // y≈1.7588 at the unity origin while the chibi ring / player spawn sit on
  // flat y=0 terrain. A wide-span vertical probe must see the mound.
  it('groundHeight sees the home mound at the origin, flat ring, and miss→0', () => {
    const q = createQueries(pw);
    expect(q.groundHeight(0, 0)).toBeCloseTo(1.7588, 3); // home_001 stump mound
    expect(q.groundHeight(0, 2.15)).toBeCloseTo(0, 6); // chibi spawn ring is flat
    expect(q.groundHeight(3, 3)).toBeCloseTo(0, 6); // player demo spawn is flat
    expect(q.groundHeight(10000, 10000)).toBe(0); // far outside stage → miss → 0
  });

  it('groundHeight agrees with a manual ±40 linecast at a mid-path point', () => {
    const q = createQueries(pw);
    const pts = collectPathPoints(loadParityEntry());
    const p = pts[Math.floor(pts.length / 2)].p;
    const hit = q.linecast(p.x, 40, p.z, p.x, -40, p.z, pw.terrainMask);
    expect(hit).toBeTruthy();
    expect(q.groundHeight(p.x, p.z)).toBe(hit!.point[1]);
  });

  it('createGroundHeightQuery is null-safe (null seam → 0) and wraps real queries', () => {
    const nullSeam = createGroundHeightQuery(null, pw.terrainMask);
    expect(nullSeam.groundHeight(0, 0)).toBe(0);
    expect(nullSeam.groundHeight(123, 456)).toBe(0);
    const real = createGroundHeightQuery(createQueries(pw), pw.terrainMask);
    expect(real.groundHeight(0, 0)).toBeCloseTo(1.7588, 3);
    expect(real.groundHeight(10000, 10000)).toBe(0);
  });
});
