// src/core/GameCoreCollisionManager.ts
// TypeScript port of decomp/src/GameCore/GameCoreCollisionManager.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2976,
// RVA 0x4AA480..0x4ACD50 + IntersectingObjects iterator @0x770030).
// Uniform XZ spatial-hash grid (unitsPerCell = 4). Objects are bucketed into
// every cell their collision radius overlaps; queries walk the cell rectangle
// and run a cylinder narrow-phase (XZ distance + vertical overlap; height
// matters only in the narrow phase — the broad phase is radius-only).
// Confirmed literals: inverseUnitsPerCell=0.25 (0x00B7C24C/54),
// unitsPerCell=4 (0x00B7C258), half=0.5 (0x00B808C0), two=2 (0x00B808C4).
//
// TS ADAPTATIONS (documented):
//  1. C# Init() derives world bounds from FindObjectsOfType<Collider>() (Unity
//     scene). The port takes a registered bounds provider instead — fed from
//     the extracted stage collider JSON (tools/colliders pipeline) in both
//     headless and browser runs.
//  2. The C# Init() re-buckets all GameCoreTower objects; the Tower module
//     registers its ctor via registerRebucketType() when it lands (avoids an
//     import cycle now and keeps the behavior identical).
//  3. Typed queries pass the constructor explicitly (typeof(T) unavailable).

import { Bounds } from '../engine/math/Bounds';
import { Mathf, Vector3 } from '../engine/math';
import { removeSwapBack } from './extensions';
import { GameCore } from './GameCore';
import { GameCoreObject } from './GameCoreObject';
import { hierarchyTypes } from './typechain';

const f = Math.fround;
const unitsPerCell = 4;
const inverseUnitsPerCell = 0.25;

/** Registered by view/stage bootstrap: world bounds of the loaded stage. */
export type BoundsProvider = () => Bounds | null;
let boundsProvider: BoundsProvider | null = null;
export function setBoundsProvider(p: BoundsProvider | null): void {
  boundsProvider = p;
}

/** Types re-bucketed on Init (C#: hardcoded GameCoreTower). */
const rebucketTypes: Function[] = [];
export function registerRebucketType(ctor: Function): void {
  if (!rebucketTypes.includes(ctor)) rebucketTypes.push(ctor);
}

// ---- nested GridCell (TypeDefIndex 2977) ------------------------------------

class GridCell {
  private static emptyList: GameCoreObject[] = [];
  readonly objectList: GameCoreObject[] = []; // 0x10
  private typeObjects = new Map<Function, GameCoreObject[]>(); // 0x18

  // AddObjectToCell @0x4AC5F0
  addObjectToCell(coreObject: GameCoreObject): void {
    if (this.containsObject(coreObject)) {
      // Original logs "Attempting to add {0} to cell, but it's already in it!"
      return;
    }
    this.objectList.push(coreObject);
    for (const t of hierarchyTypes(coreObject)) {
      let list = this.typeObjects.get(t);
      if (list === undefined) {
        list = [];
        this.typeObjects.set(t, list);
      }
      list.push(coreObject);
    }
  }

  // RemoveObjectFromCell @0x4AC2A0
  removeObjectFromCell(coreObject: GameCoreObject): boolean {
    if (!removeSwapBack(this.objectList, coreObject)) {
      // Original logs "Attempting to remove {0} from cell, but it isn't in it!"
      return false;
    }
    for (const t of hierarchyTypes(coreObject)) {
      const list = this.typeObjects.get(t);
      if (list !== undefined) removeSwapBack(list, coreObject);
    }
    return true;
  }

  // ContainsObject @0x4ACC90
  containsObject(coreObject: GameCoreObject): boolean {
    const list = this.typeObjects.get(coreObject.constructor);
    if (list === undefined) return false;
    return list.includes(coreObject);
  }

  // AllObjectsOfType<T> @0x3798C0
  allObjectsOfType(type: Function): GameCoreObject[] {
    if (type === GameCoreObject) return this.objectList;
    const list = this.typeObjects.get(type);
    if (list !== undefined) return list;
    return GridCell.emptyList;
  }
}

// ---- manager -----------------------------------------------------------------

export class GameCoreCollisionManager {
  private cellList: GridCell[] = []; // 0x10
  private coreObjectCells = new Map<number, GridCell[]>(); // 0x18 (key: handle id)
  private collectedObjectSet = new Set<GameCoreObject>(); // 0x20
  private bounds: Bounds | null = null; // 0x28
  xCells = 0; // 0x40
  zCells = 0; // 0x44
  private newOverlappingCells: GridCell[] = []; // 0x48

  // .ctor @0x4AA480
  constructor() {
    this.cellList = [];
    this.coreObjectCells = new Map();
    this.collectedObjectSet = new Set();
    this.newOverlappingCells = [];
  }

  // Init @0x4AB130
  init(): void {
    // TS ADAPTATION: bounds come from the registered provider (stage collider
    // extraction) instead of Unity's FindObjectsOfType<Collider>().
    const b = boundsProvider ? boundsProvider() : null;
    if (b !== null) this.bounds = b;
    if (this.bounds === null) {
      // Fallback: degenerate 1-cell grid so headless smoke tests can run
      // before a stage is loaded (original would NRE — never hit in game).
      this.bounds = new Bounds(Vector3.zero, Vector3.zero);
    }

    const size = this.bounds.size;
    this.xCells = (Math.trunc(f(size.x * inverseUnitsPerCell)) + 1) | 0;
    this.zCells = (Math.trunc(f(size.z * inverseUnitsPerCell)) + 1) | 0;

    this.cellList = [];
    const total = this.xCells * this.zCells;
    for (let i = 0; i < total; i++) this.cellList.push(new GridCell());

    this.collectedObjectSet.clear();
    const core = GameCore.instance;
    if (core !== null) {
      for (const t of rebucketTypes) {
        for (const obj of core.currentFrame.allObjects<GameCoreObject>(t)) {
          this.updateCoreObject(obj);
        }
      }
    }
  }

  // UpdateCoreObject @0x4ABB80
  updateCoreObject(coreObject: GameCoreObject): void {
    if (this.cellList.length === 0) this.init();

    if (coreObject.isDestroyed()) {
      // Original: Debug.LogErrorFormat("Attemping to add destroyed object {0}
      // to GameCoreCollisionManager", obj) [sic — original typo], then remove.
      this.removeCoreObject(coreObject);
      return;
    }

    this.newOverlappingCells.length = 0;
    const r = coreObject.collision.radius;
    const radiusVec = new Vector3(r, r, r);
    const min = coreObject.position.sub(radiusVec);
    const max = coreObject.position.add(radiusVec);

    const [minX, minZ] = this.getCellXZ(min);
    const [maxX, maxZ] = this.getCellXZ(max);
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        this.newOverlappingCells.push(this.getCell(x, z));
      }
    }

    const handleId = coreObject.handle.m_handle;
    let oldCells = this.coreObjectCells.get(handleId);
    if (oldCells === undefined) {
      oldCells = [];
      this.coreObjectCells.set(handleId, oldCells);
    }

    let changed = false;
    for (let i = 0; i < oldCells.length; i++) {
      const cell = oldCells[i];
      if (!this.newOverlappingCells.includes(cell)) {
        cell.removeObjectFromCell(coreObject);
        changed = true;
      }
    }
    for (let i = 0; i < this.newOverlappingCells.length; i++) {
      const cell = this.newOverlappingCells[i];
      if (!oldCells.includes(cell)) {
        cell.addObjectToCell(coreObject);
        changed = true;
      }
    }
    if (changed) {
      oldCells.length = 0;
      for (const c of this.newOverlappingCells) oldCells.push(c);
    }
  }

  // RemoveCoreObject @0x4AC130
  removeCoreObject(coreObject: GameCoreObject): void {
    const handleId = coreObject.handle.m_handle;
    const cells = this.coreObjectCells.get(handleId);
    if (cells === undefined) return;
    for (let i = 0; i < cells.length; i++) cells[i].removeObjectFromCell(coreObject);
    cells.length = 0;
    this.coreObjectCells.delete(handleId);
  }

  // GetCellXZ @0x4AC870
  private getCellXZ(location: Vector3): [number, number] {
    const b = this.bounds!;
    const local = location.sub(b.min);
    let cellX = Math.trunc(f(local.x * inverseUnitsPerCell)) | 0;
    let cellZ = Math.trunc(f(local.z * inverseUnitsPerCell)) | 0;
    cellX = Mathf.Clamp(cellX, 0, this.xCells - 1);
    cellZ = Mathf.Clamp(cellZ, 0, this.zCells - 1);
    return [cellX, cellZ];
  }

  // GetCell @0x4AC960
  private getCell(cellX: number, cellZ: number): GridCell {
    return this.cellList[cellZ * this.xCells + cellX];
  }

  // GetCellBounds @0x4AC9D0 (kept for parity/debug; unused by queries)
  getCellBounds(cellX: number, cellZ: number): Bounds {
    const b = this.bounds!;
    const min = b.min;
    let center = min.add(
      new Vector3(f(cellX * unitsPerCell), min.y, f(cellZ * unitsPerCell)),
    );
    const size = new Vector3(2, b.extents.y, 2);
    center = center.add(size);
    return new Bounds(center, size.mulScalar(2));
  }

  // IntersectingObjects<T> @0x770030
  // Cylinder query: broad-phase over the cell rectangle (CellIterator walk,
  // inlined), then XZ-distance + vertical-overlap narrow phase. The collected
  // set dedups objects spanning multiple cells.
  *intersectingObjects<T extends GameCoreObject>(
    type: Function,
    a_pos: Vector3,
    a_radius: number,
    a_height: number,
  ): IterableIterator<T> {
    const halfHeight = f(a_height * 0.5);
    const pos = new Vector3(a_pos.x, f(a_pos.y + halfHeight), a_pos.z);
    this.collectedObjectSet.clear();
    const searchMin = new Vector3(f(pos.x - a_radius), f(pos.y - halfHeight), f(pos.z - a_radius));
    const searchMax = new Vector3(f(pos.x + a_radius), f(pos.y + halfHeight), f(pos.z + a_radius));

    // CellIterator (struct in C#): row-major rectangle walk, terminates when
    // cellZ > maxZ. Clamped cell coords mirror GetCellXZ.
    const [minX, minZ] = this.getCellXZ(searchMin);
    const [maxX, maxZ] = this.getCellXZ(searchMax);
    let cellX = minX;
    let cellZ = minZ;
    while (cellZ <= maxZ) {
      const cell = this.getCell(cellX, cellZ);
      const objects = cell.allObjectsOfType(type);
      for (let index = 0; index < objects.length; index++) {
        const coreObject = objects[index];
        if (this.collectedObjectSet.has(coreObject)) continue; // already returned
        this.collectedObjectSet.add(coreObject);

        const delta = coreObject.position.sub(pos);
        const other = coreObject.collision;
        const xyDistSqr = f(f(delta.x * delta.x) + f(delta.z * delta.z));
        const radius = f(other.radius + a_radius);
        const radiusSqr = f(radius * radius);
        if (radiusSqr <= xyDistSqr) continue;

        const dy = f(delta.y + f(other.height * 0.5));
        if (f(f(other.height + a_height) * 0.5) <= Mathf.Abs(dy)) continue;

        yield coreObject as T;
      }
      // op_Increment: advance x, wrap to next row.
      if (cellX < maxX) cellX++;
      else {
        cellX = minX;
        cellZ++;
      }
    }
  }
}
