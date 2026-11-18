// src/data/pickupPrefabs.ts
// Verified stage-1 currency pickup prefab records (data lane, iter 13).
// Source: decomp/data/pickup_prefabs.json — extracted from the user's own
// decrypted copy (props bundle):
//   coin prop_001 (GO pid -8994034644167341400, prefab pid 1569343402696278429)
//   gem  prop_002 (GO pid 7173683470124004964, prefab pid -7195634620545009480)
// Spawn chain (verified): Q4.PickupManager.CreateCurrency @0x003E3F50 →
// GlobalResources.debugCoinPrefab/debugGemPrefab → these prefabs.
//
// meshBounds uses the SERIALIZED m_LocalAABB (Unity Mesh.bounds returns it at
// runtime); size = extents × 2 (exact f32 doubling). The extraction also
// computed vertex-min/max bounds — they match to float32 rounding, but the
// serialized AABB is the faithful runtime source.
//
// Float literals are the exact serialized f32 values (double representations
// from the type-tree dump); Math.fround on consumption reproduces them.

import type { PickupPrefabContract } from '../view/q4-contracts';

const f = Math.fround;

/** Unity Bounds.size = extents * 2 (f32-exact doubling). */
function sizeFromExtents(e: { x: number; y: number; z: number }) {
  return { x: f(2 * e.x), y: f(2 * e.y), z: f(2 * e.z) };
}

const COIN_EXTENTS = {
  x: 0.17080363631248474,
  y: 0.17079252004623413,
  z: 0.03913235291838646,
};
const GEM_EXTENTS = {
  x: 0.13210347294807434,
  y: 0.1986689418554306,
  z: 0.13342899084091187,
};

/** prop_001 — the stage-1 coin (EInventoryType.Coin). */
export const COIN_PREFAB: PickupPrefabContract = {
  name: 'prop_001',
  detectRange: 1.7999999523162842, // f32 1.8
  detectDelay: 1.5,
  value: 20, // matches stage-1 PickupManager.globalCoinPerValueOverride = 20
  lifespan: 42.900001525878906, // f32 42.9
  movement: {
    appearForceMin: 4.0,
    appearForceMax: 5.5,
    appearRangeAngle: 17.799999237060547, // f32 17.8
    acceleration: 12.0,
    bouncingRate: 0.30000001192092896, // f32 0.3
    bounceTime: -1, // unlimited
    attractOffset: { x: 0.0, y: 0.5, z: 0.0 },
  },
  meshBounds: {
    size: sizeFromExtents(COIN_EXTENTS),
    extents: COIN_EXTENTS,
  },
};

/** prop_002 — the stage-1 gem (EInventoryType.Gem). */
export const GEM_PREFAB: PickupPrefabContract = {
  name: 'prop_002',
  detectRange: 2.4000000953674316, // f32 2.4
  detectDelay: 0.5,
  value: 1,
  lifespan: 57.20000076293945, // f32 57.2
  movement: {
    appearForceMin: 5.0,
    appearForceMax: 7.5,
    appearRangeAngle: 30.0,
    acceleration: 10.0,
    bouncingRate: 0.30000001192092896,
    bounceTime: -1,
    attractOffset: { x: 0.0, y: 0.5, z: 0.0 },
  },
  meshBounds: {
    size: sizeFromExtents(GEM_EXTENTS),
    extents: GEM_EXTENTS,
  },
};

/** Stage-1 scene PickupManager view data (BuildPlayer-3d_stage_001_env,
 *  pid 8745) — the headless driver registers this as the manager's viewer.
 *  hiddenFruitData is EMPTY: stage 1 has no scheduled fruit drops. */
export const STAGE1_PICKUP_MANAGER = {
  globalCoinPerValueOverride: 20,
  maximumFruitsOnGround: 3,
  hiddenPickupData: [] as Array<{ type: number; amount: number }>,
  hiddenFruitData: [] as Array<{ time: number }>,
};

/** GlobalSounds water clips (verified PPtr resolution, props bundle):
 *  itemDieInWater → sfx_item_disintegrate; itemLostInWater → sfx_item_splash.
 *  The audio layer resolves these via tools/assets/audio-out/globalsounds_map.json. */
export const WATER_SOUND_CLIPS = {
  itemDieInWater: 'sfx_item_disintegrate',
  itemLostInWater: 'sfx_item_splash',
} as const;
