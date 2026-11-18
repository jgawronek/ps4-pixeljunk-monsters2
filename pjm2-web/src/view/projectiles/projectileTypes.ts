// src/view/projectiles/projectileTypes.ts
// Shapes of projectileData.generated.ts (tools/assets/extract_projectiles.py).

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export interface EffectNode {
  name: string;
  /** Local TRS of the child GameObject (RAW Unity space). */
  pos: Vec3Tuple;
  rot: QuatTuple;
  scale: Vec3Tuple;
  components: string[];
  children: EffectNode[];
}

export interface ProjectilePrefabData {
  name: string;
  pathId: number;
  /** Q4 component class: ProjectileTrajectory / Instant / Gaseous / Insect / Electric / Lightning / Beam / Gem. */
  class: string;
  /** Serialized fields with PPtrs resolved to asset/GameObject NAMES. */
  fields: Record<string, number | string | null | boolean>;
  /** PrefabLoader.prefabList names (visual prefab, optional effect groups). */
  prefabList: string[];
  components: { class: string; fields: Record<string, number | string | null | boolean> }[];
}

export interface TowerProjectileRef {
  projectile: string;
  projectilePathId: number;
  attackType: number;
  attackSpread: number;
  burstCount: number;
  firePointNames: string[];
  magazineCapacity: number;
  /** EnemyDetectorViewCone on the tower prefab (the sim detection volume). */
  detector: { upperRadius: number; lowerRadius: number; height: number; offset: number[]; affectRangeRate: number } | null;
}

export interface ProjectileModelRef {
  file: string;
  node: string;
  bounds: { min: number[]; max: number[]; size: number[]; center: number[]; vertexCount: number };
}

export interface ProjectileData {
  projectiles: Record<string, ProjectilePrefabData>;
  effects: Record<string, EffectNode>;
  towers: Record<string, TowerProjectileRef>;
  models: Record<string, ProjectileModelRef>;
  sfx: string[];
}
