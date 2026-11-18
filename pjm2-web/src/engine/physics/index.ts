/**
 * Physics query layer (static colliders only — no dynamics).
 *
 * Public surface:
 *  - PhysicsWorld / loadStageWorld  — init Rapier WASM + build static colliders
 *  - PhysicsQueries / createQueries — Unity-compatible Linecast/Raycast/SphereCast/CheckSphere
 *
 * See world.ts and queries.ts headers for the full parity/determinism notes.
 */
export {
  PhysicsWorld,
  loadStageWorld,
  defaultFileLoader,
} from './world.js';
export type {
  ExtractedCollider,
  ExtractedColliderKind,
  ExtractedMeshMeta,
  ExtractedTransform,
  FileLoader,
  Q4LayersData,
  StageCollidersJson,
  StaticColliderInfo,
} from './world.js';

export { PhysicsQueries, createQueries } from './queries.js';
export type { RaycastHit, QueryTriggerInteraction } from './queries.js';
