// GameCore/GameCoreCollisionManager.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Uniform XZ spatial-hash grid (unitsPerCell = 4). Each object is bucketed into the
// cells its collision radius overlaps; queries walk the cell rectangle and do a
// cylinder narrow-phase. Nested GridCell (per-cell object list + per-Type index) and
// CellIterator (rectangle walker) are included. Logic from Ghidra decompilation
// (RVA 0x4AA480..0x4ACD50, plus the IntersectingObjects iterator @0x770030).
//
// Field offsets from global-metadata.dat (TypeDefIndex 2976). Confirmed float
// literals: inverseUnitsPerCell=0.25 (0x00B7C24C/54), unitsPerCell=4 (0x00B7C258),
// half=0.5 (0x00B808C0), two=2 (0x00B808C4), abs-mask=0x7FFFFFFF (0x00B808D0).

namespace GameCore
{
    public class GameCoreCollisionManager
    {
        private const float unitsPerCell = 4f;
        private const float inverseUnitsPerCell = 0.25f;

        private System.Collections.Generic.List<GridCell> cellList;                                    // 0x10
        private System.Collections.Generic.Dictionary<GameCoreHandle, System.Collections.Generic.List<GridCell>> coreObjectCells; // 0x18
        private System.Collections.Generic.HashSet<GameCoreObject> collectedObjectSet;                 // 0x20
        private UnityEngine.Bounds bounds;                                                             // 0x28
        public int xCells { get; private set; }                                                          // 0x40
        public int zCells { get; private set; }                                                          // 0x44
        private System.Collections.Generic.List<GridCell> newOverlappingCells;                          // 0x48

        // .ctor @0x4AA480
        public GameCoreCollisionManager()
        {
            cellList = new System.Collections.Generic.List<GridCell>();
            coreObjectCells = new System.Collections.Generic.Dictionary<GameCoreHandle, System.Collections.Generic.List<GridCell>>();
            collectedObjectSet = new System.Collections.Generic.HashSet<GameCoreObject>();
            newOverlappingCells = new System.Collections.Generic.List<GridCell>();
        }

        // Init @0x4AB130
        // Computes world bounds from every scene Collider, builds the cell grid, then
        // re-buckets all towers. (The decompiler labels the search FindObjectsOfType
        // <NatureTree>, but each element is used directly as a Collider, so the query
        // is FindObjectsOfType<Collider>.)
        public void Init()
        {
            UnityEngine.Collider[] colliders = UnityEngine.Object.FindObjectsOfType<UnityEngine.Collider>();
            bool first = true;
            foreach (UnityEngine.Collider c in colliders)
            {
                if (first)
                {
                    bounds = c.bounds;
                    first = false;
                }
                else
                {
                    bounds.Encapsulate(c.bounds);
                }
            }

            UnityEngine.Vector3 size = bounds.size;
            xCells = (int)(size.x * inverseUnitsPerCell) + 1;
            zCells = (int)(size.z * inverseUnitsPerCell) + 1;

            cellList = new System.Collections.Generic.List<GridCell>(xCells * zCells);
            for (int i = 0; i < cellList.Capacity; i++)
                cellList.Add(new GridCell());

            collectedObjectSet.Clear();
            foreach (GameCoreTower tower in GameCore.Instance.AllObjects<GameCoreTower>())
                UpdateCoreObject(tower);
        }

        // UpdateCoreObject @0x4ABB80
        // Re-buckets an object after it moves/resizes. Diffs the old cell set against
        // the new overlapping cells, removing/adding as needed.
        public void UpdateCoreObject(GameCoreObject coreObject)
        {
            if (cellList.Count == 0)
                Init();

            if (coreObject.IsDestroyed())
            {
                UnityEngine.Debug.LogErrorFormat(
                    "Attemping to add destroyed object {0} to GameCoreCollisionManager",
                    coreObject.ToString());
                RemoveCoreObject(coreObject);
                return;
            }

            newOverlappingCells.Clear();
            UnityEngine.Vector3 radiusVec = UnityEngine.Vector3.one * coreObject.collision.radius;
            UnityEngine.Vector3 min = coreObject.position - radiusVec;
            UnityEngine.Vector3 max = coreObject.position + radiusVec;

            int minX, minZ, maxX, maxZ;
            GetCellXZ(min, out minX, out minZ);
            GetCellXZ(max, out maxX, out maxZ);
            for (int z = minZ; z <= maxZ; z++)
                for (int x = minX; x <= maxX; x++)
                    newOverlappingCells.Add(GetCell(x, z));

            System.Collections.Generic.List<GridCell> oldCells;
            if (!coreObjectCells.TryGetValue(coreObject.handle, out oldCells))
            {
                oldCells = new System.Collections.Generic.List<GridCell>();
                coreObjectCells[coreObject.handle] = oldCells;
            }

            bool changed = false;
            for (int i = 0; i < oldCells.Count; i++)
            {
                GridCell cell = oldCells[i];
                if (!newOverlappingCells.Contains(cell))
                {
                    cell.RemoveObjectFromCell(coreObject);
                    changed = true;
                }
            }
            for (int i = 0; i < newOverlappingCells.Count; i++)
            {
                GridCell cell = newOverlappingCells[i];
                if (!oldCells.Contains(cell))
                {
                    cell.AddObjectToCell(coreObject);
                    changed = true;
                }
            }
            if (changed)
            {
                oldCells.Clear();
                oldCells.AddRange(newOverlappingCells);
            }
        }

        // RemoveCoreObject @0x4AC130
        public void RemoveCoreObject(GameCoreObject coreObject)
        {
            System.Collections.Generic.List<GridCell> cells;
            if (!coreObjectCells.TryGetValue(coreObject.handle, out cells))
                return;
            for (int i = 0; i < cells.Count; i++)
                cells[i].RemoveObjectFromCell(coreObject);
            cells.Clear();
            coreObjectCells.Remove(coreObject.handle);
        }

        // GetCellXZ @0x4AC870
        private void GetCellXZ(UnityEngine.Vector3 location, out int cellX, out int cellZ)
        {
            UnityEngine.Vector3 local = location - bounds.min;
            cellX = (int)(local.x * inverseUnitsPerCell);
            cellZ = (int)(local.z * inverseUnitsPerCell);
            cellX = UnityEngine.Mathf.Clamp(cellX, 0, xCells - 1);
            cellZ = UnityEngine.Mathf.Clamp(cellZ, 0, zCells - 1);
        }

        // GetCell @0x4AC960
        private GridCell GetCell(int cellX, int cellZ)
        {
            return cellList[cellZ * xCells + cellX];
        }

        // GetCellBounds @0x4AC9D0
        // World-space Bounds of a cell (full world height; 2f = unitsPerCell * 0.5).
        private UnityEngine.Bounds GetCellBounds(int cellX, int cellZ)
        {
            UnityEngine.Vector3 min = bounds.min;
            UnityEngine.Vector3 center = min + new UnityEngine.Vector3(cellX * unitsPerCell, min.y, cellZ * unitsPerCell);
            UnityEngine.Vector3 size = new UnityEngine.Vector3(2f, bounds.extents.y, 2f);
            center += size;
            return new UnityEngine.Bounds(center, size * 2f);
        }

        // IntersectingObjects<T> (generic iterator; MoveNext @0x770030)
        // Cylinder query: broad-phase over the cell rectangle, then XZ-distance and
        // vertical-overlap narrow-phase. collectedObjectSet dedups objects that span
        // multiple cells.
        public System.Collections.Generic.IEnumerable<T> IntersectingObjects<T>(UnityEngine.Vector3 a_pos, float a_radius, float a_height)
        {
            float halfHeight = a_height * 0.5f;
            a_pos.y += halfHeight;
            collectedObjectSet.Clear();
            UnityEngine.Bounds searchBounds = new UnityEngine.Bounds(
                a_pos, new UnityEngine.Vector3(a_radius, halfHeight, a_radius) * 2f);

            CellIterator iterator = new CellIterator(this, searchBounds.min, searchBounds.max);
            while (iterator)
            {
                GridCell cell = iterator.currentCell;
                System.Collections.Generic.List<GameCoreObject> objects = cell.AllObjectsOfType<T>();
                for (int index = 0; index < objects.Count; index++)
                {
                    GameCoreObject coreObject = objects[index];
                    if (!collectedObjectSet.Add(coreObject))
                        continue;   // already returned from another cell

                    UnityEngine.Vector3 deltaPos = coreObject.position - a_pos;
                    Cylinder otherCylinder = coreObject.collision;
                    float xyDistSqr = deltaPos.x * deltaPos.x + deltaPos.z * deltaPos.z;
                    float radius = otherCylinder.radius + a_radius;
                    float radiusSqr = radius * radius;
                    if (radiusSqr <= xyDistSqr)
                        continue;

                    deltaPos.y += otherCylinder.height * 0.5f;
                    if ((otherCylinder.height + a_height) * 0.5f <= UnityEngine.Mathf.Abs(deltaPos.y))
                        continue;

                    yield return (T)(object)coreObject;
                }
                iterator++;
            }
        }

        // ---- nested GridCell (TypeDefIndex 2977) --------------------------------
        private class GridCell
        {
            private static System.Collections.Generic.List<GameCoreObject> emptyList;   // statics +0x0
            private System.Collections.Generic.List<GameCoreObject> objectList;          // 0x10
            private System.Collections.Generic.Dictionary<System.Type, System.Collections.Generic.List<GameCoreObject>> typeObjects; // 0x18

            // .cctor @0x4ACD50
            static GridCell()
            {
                emptyList = new System.Collections.Generic.List<GameCoreObject>();
            }

            // .ctor @0x4ABAF0
            public GridCell()
            {
                objectList = new System.Collections.Generic.List<GameCoreObject>();
                typeObjects = new System.Collections.Generic.Dictionary<System.Type, System.Collections.Generic.List<GameCoreObject>>();
            }

            // AddObjectToCell @0x4AC5F0
            public void AddObjectToCell(GameCoreObject coreObject)
            {
                if (ContainsObject(coreObject))
                {
                    UnityEngine.Debug.LogErrorFormat(
                        "Attempting to add {0} to cell, but it's already in it!", coreObject);
                    return;
                }
                objectList.Add(coreObject);
                for (System.Type t = coreObject.GetType(); t != typeof(GameCoreObject); t = t.BaseType)
                {
                    System.Collections.Generic.List<GameCoreObject> list;
                    if (!typeObjects.TryGetValue(t, out list))
                    {
                        list = new System.Collections.Generic.List<GameCoreObject>();
                        typeObjects[t] = list;
                    }
                    list.Add(coreObject);
                }
            }

            // RemoveObjectFromCell @0x4AC2A0
            public void RemoveObjectFromCell(GameCoreObject coreObject)
            {
                if (!Q4.Extensions.RemoveSwapBack(objectList, coreObject))
                {
                    UnityEngine.Debug.LogErrorFormat(
                        "Attempting to remove {0} from cell, but it isn't in it!", coreObject);
                    return;
                }
                for (System.Type t = coreObject.GetType(); t != typeof(GameCoreObject); t = t.BaseType)
                {
                    System.Collections.Generic.List<GameCoreObject> list;
                    if (typeObjects.TryGetValue(t, out list))
                        Q4.Extensions.RemoveSwapBack(list, coreObject);
                }
            }

            // ContainsObject @0x4ACC90
            public bool ContainsObject(GameCoreObject coreObject)
            {
                System.Collections.Generic.List<GameCoreObject> list;
                if (!typeObjects.TryGetValue(coreObject.GetType(), out list))
                    return false;
                return list.Contains(coreObject);
            }

            // AllObjectsOfType<T> (generic; shared body @0x3798C0)
            public System.Collections.Generic.List<GameCoreObject> AllObjectsOfType<T>()
            {
                if (typeof(T) == typeof(GameCoreObject))
                    return objectList;
                System.Collections.Generic.List<GameCoreObject> list;
                if (typeObjects.TryGetValue(typeof(T), out list))
                    return list;
                return emptyList;
            }
        }

        // ---- nested CellIterator (TypeDefIndex 2978, struct) --------------------
        // Walks the cell rectangle row-major. The true/false operators let it be used
        // as `while (iterator) { ...; iterator++; }`.
        private struct CellIterator
        {
            private GameCoreCollisionManager manager;   // 0x0
            private int minX;                           // 0x8
            private int minZ;                           // 0xC
            private int maxX;                           // 0x10
            private int maxZ;                           // 0x14
            private int cellX;                          // 0x18
            private int cellZ;                          // 0x1C

            // .ctor @0x4ACB90
            public CellIterator(GameCoreCollisionManager manager, UnityEngine.Vector3 min, UnityEngine.Vector3 max)
            {
                this.manager = manager;
                manager.GetCellXZ(min, out minX, out minZ);
                manager.GetCellXZ(max, out maxX, out maxZ);
                cellX = minX;
                cellZ = minZ;
            }

            // get_currentCell @0x4ACC10
            public GridCell currentCell
            {
                get { return manager.GetCell(cellX, cellZ); }
            }

            // op_Increment @0x4AC5A0
            public static CellIterator operator ++(CellIterator iterator)
            {
                if (iterator.cellX < iterator.maxX)
                {
                    iterator.cellX++;
                }
                else
                {
                    iterator.cellX = iterator.minX;
                    iterator.cellZ++;
                }
                return iterator;
            }

            // op_True @0x4AC5E0 / op_False @0x4ACC80
            public static bool operator true(CellIterator iterator)
            {
                return iterator.cellZ <= iterator.maxZ;
            }
            public static bool operator false(CellIterator iterator)
            {
                return iterator.cellZ > iterator.maxZ;
            }
        }
    }
}
