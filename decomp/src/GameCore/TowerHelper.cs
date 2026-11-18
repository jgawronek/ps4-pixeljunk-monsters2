// GameCore/TowerHelper.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Static utility class for tower targeting and construction:
//  - target acquisition (nearest valid targets inside the tower's enemy
//    detector, filtered by attack type / fire range / line of sight),
//  - target-queue resolution,
//  - tree -> tower conversion (collecting cost trees, spawning the viewer),
//  - random idle "caution" directions.
// Logic from GameCore.TowerHelper methods (RVA 0x4C5ED0..0x4E0C60).
//
// Rodata (all CONFIRMED from the ELF):
//   DAT_00b7c4a4 = 0.5f    (target line-of-sight probe raise, ClearViewOnTarget)
//   DAT_00b7c4a8 = 100.0f  (tree query cylinder height, GetCostTrees)
//   DAT_00b7c4ac = 360.0f  (full yaw sweep, RandomCautionDirection)

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public static class TowerHelper // TypeDefIndex: 3379
    {
        // ---- Fields ----
        // Scratch buffer reused by every GetNearestTargets call to avoid GC.
        private static List<GameCoreObject> targetsCache;   // 0x0

        // DAT_00b7c4a8 = 100.0f — GetCostTrees query-cylinder height scale.
        private const float TreeQueryHeightScale = 100.0f;

        // .cctor @0x4E0C60
        static TowerHelper()
        {
            targetsCache = new List<GameCoreObject>();
        }

        // GetProjectileGameCoreHitPoisition @0x4C5ED0 [sic — original typo]
        // Where a projectile aimed at `targetPos` should actually detonate:
        // when the target is closer than the tower's inner attack range the
        // impact point is pushed out onto the inner-range sphere (keeping the
        // target's height), otherwise the raw target position is used.
        public static Vector3 GetProjectileGameCoreHitPoisition(GameCoreTower tower, Vector3 targetPos)
        {
            if (tower == null)
            {
                return Vector3.zero;
            }

            Vector3 delta = targetPos - tower.position;

            // FUN_0098c8c0 = Vector3 length.
            if (delta.magnitude < tower.attackRangeInner)
            {
                // FUN_0098d750 = Vector3 normalized.
                // Impact pushed OUT along tower→target to the inner-range
                // sphere, keeping the target's relative height (delta.y).
                return tower.position
                    + delta.normalized * tower.attackRangeInner
                    + Vector3.up * delta.y;
            }

            return targetPos;
        }

        // IsTarget @0x4CAD00 — can a tower with `attackType` shoot something
        // that moves with `movementType`? The decompilation folds the attack
        // type into a 3-bit key: ground(1)->4, air(2)->5, all(3)->6;
        // unknown(0) and out-of-range values -> 0/3 (never a target).
        public static bool IsTarget(EEnemyMoveTypeDef movementType, ETowerAttackDef attackType)
        {
            int key = ((int)attackType < 4 ? (int)attackType + 3 : 0) & 7;
            switch (key)
            {
                case 6: return true;                              // all
                case 5: return movementType == (EEnemyMoveTypeDef)2; // air targets flying
                case 4: return movementType == (EEnemyMoveTypeDef)1; // ground targets walkers
                default: return false;
            }
        }

        // GetNearestTargets @0x4CF510 (3-arg) — collect every enemy/attack
        // point inside the tower's affect cylinder that the tower may shoot:
        // validates each candidate, filters by attack type, aimability, inner
        // range (unless ignored), the detector's attack volume and terrain
        // line of sight. The collision manager returns candidates ordered by
        // distance, so `result` ends up nearest-first. When nothing is inside
        // the *detection* volume the result is cleared entirely (the tower is
        // blind this tick even if attackable candidates existed).
        public static void GetNearestTargets(GameCoreTower tower, List<IDamageable> result, bool ignoreInnerRange = true)
        {
            // NOTE: the original NREs here when tower or its detector is null.
            IEnemyDetector detector = tower.enemyDetector;   // 0x108

            Cylinder collision = detector.GetCollisionCylinder();
            Cylinder affect = detector.GetAffectCylinder();

            // Query origin: detector anchor point, pushed down by the
            // collision-cylinder height scaled by the vertical anchor factor.
            // NOTE: the lowered anchor is used ONLY for the spatial query —
            // InAttack/InDetection below use the un-lowered detector position
            // (uVar20/uVar22 in the decompilation are captured before the
            // anchor math and never overwritten).
            Vector3 detectorPos = tower.position + detector.GetOffset();
            Vector3 queryPos = detectorPos
                + Vector3.down * (collision.height * detector.GetAnchorV());

            targetsCache.Clear();

            foreach (GameCoreEnemy enemy in GameCore.Instance.AllObjects<GameCoreEnemy>(queryPos, affect))
            {
                targetsCache.Add(enemy);
            }

            // NOTE: attack points are gathered globally (the no-argument
            // AllObjects overload) — no spatial filter, faithful.
            foreach (GameCoreEnemyAttackPoint point in GameCore.Instance.AllObjects<GameCoreEnemyAttackPoint>())
            {
                targetsCache.Add(point);
            }

            bool foundAny = false;

            for (int i = 0; i < targetsCache.Count; i++)
            {
                GameCoreObject obj = targetsCache[i];
                IDamageable d = (IDamageable)obj;

                if (!d.ValidateTarget())
                {
                    continue;
                }

                // IsTarget inlined by the compiler (same key arithmetic).
                if (!IsTarget(d.MoveType(), tower.attackType))
                {
                    continue;
                }

                if (!d.IsAimableTarget(tower))
                {
                    continue;
                }

                bool pass = true;
                if (!ignoreInnerRange)
                {
                    Vector3 delta = tower.position - d.Position();
                    // FUN_0098dcd0 = Vector3 sqrMagnitude.
                    pass = tower.attackRangeInner * tower.attackRangeInner <= delta.sqrMagnitude;
                }

                if (!detector.InAttack(detectorPos, obj))
                {
                    continue;
                }

                if (pass && ClearViewOnTarget(tower, d))
                {
                    if (!foundAny)
                    {
                        // First candidate decides `foundAny` purely through the
                        // detection test; later candidates skip the test and
                        // keep it sticky — faithful to the shipped code.
                        pass = detector.InDetection(detectorPos, obj);
                    }

                    result.Add(d);
                    foundAny = pass;
                }
            }

            if (!foundAny)
            {
                result.Clear();
            }
        }

        // GetNearestTargets @0x4E0150 (5-arg) — same collection pass, then
        // optional post-filters: drop everything the tower cannot actually
        // fire at (fire-angle threshold, IsTargetInFireRange) and truncate the
        // list to `count` entries.
        public static void GetNearestTargets(
            GameCoreTower tower,
            List<IDamageable> result,
            bool filterInFireRange = false,
            int count = 0,
            bool ignoreInnerRange = true)
        {
            GetNearestTargets(tower, result, ignoreInnerRange);

            if (result == null || !filterInFireRange)
            {
                return;
            }

            // Reverse walk so removals keep the indices valid.
            for (int i = result.Count - 1; i >= 0; i--)
            {
                IDamageable item = result[i];
                if (item == null || !IsTargetInFireRange(tower, item))
                {
                    result.Remove(item);
                }
            }

            if (count != 0 && count < result.Count)
            {
                result.RemoveRange(count, result.Count - count);
            }
        }

        // ClearViewOnTarget @0x4DFFA0 — true when terrain does not block the
        // line from the tower's muzzle (position + up*height) to a point
        // 0.5f above the target (DAT_00b7c4a4 CONFIRMED).
        // NOTE: the original NREs when tower or target is null.
        public static bool ClearViewOnTarget(GameCoreTower tower, IDamageable target)
        {
            Vector3 from = tower.position + Vector3.up * tower.height;
            Vector3 to = target.Position() + Vector3.up * 0.5f;
            return !Physics.Linecast(from, to, Q4.Layers.Instance.TerrainMask);
        }

        // IsTargetInFireRange @0x4E02D0 — can the tower physically hit the
        // target right now? Asks the viewer's projectile for the required fire
        // direction (from the muzzle at position + up*height) and compares the
        // angle against the tower's current fort direction with the
        // fireAngleThreshold (float @0xE0).
        public static bool IsTargetInFireRange(GameCoreTower tower, IDamageable enemy)
        {
            if (tower == null || enemy == null)
            {
                return false;
            }

            // NOTE: the original NREs when the viewer (or its projectile) is
            // null — the tower has not spawned its view yet.
            Q4.TowerBase viewer = tower.GetUnityObject<Q4.TowerBase>();
            Q4.Projectile projectile = viewer.projectile;   // TowerBase 0xC0

            Vector3 firePos = tower.position + Vector3.up * tower.height;
            Vector3 fireDir = projectile.GetFireDirection(firePos, enemy.Position(), Vector3.zero);

            return Vector3.Angle(tower.fortDirection, fireDir) <= tower.fireAngleThreshold;
        }

        // GetNextTargetFromTowerTargetQueue @0x4DFE50 — resolve one queued
        // handle to its live damageable. FAITHFUL ODDITY: the `index` parameter
        // is DEAD in the binary — the branch re-tests queue.Count (< 1 is
        // impossible past the guard above), so element 0 is always used.
        public static IDamageable GetNextTargetFromTowerTargetQueue(GameCoreTower tower, int index)
        {
            if (tower == null || tower.targetQueue == null || tower.targetQueue.Count < 1)
            {
                return null;
            }

            GameCoreHandle handle = tower.targetQueue[0];
            return (IDamageable)handle.GetMostRecentObjectVersion<GameCoreObject>();
        }

        // FilterEnemiesByAttackType @0x4DFB50 — keep only the enemies a tower
        // with `attackType` may shoot. key = attackType & 7: ground(1) keeps
        // walkers (move type 1), air(2) keeps flyers (move type 2), all(3)
        // keeps everything, unknown(0) keeps nothing.
        // FAITHFUL ODDITY: for key==5 or attackType>3 (both impossible with
        // the shipped enum) the loop calls MoveType() on every item but never
        // adds anything — an empty list is returned.
        public static List<IDamageable> FilterEnemiesByAttackType(List<IDamageable> raw, ETowerAttackDef attackType)
        {
            if (raw == null || raw.Count < 1)
            {
                return null;
            }

            List<IDamageable> result = new List<IDamageable>();
            int key = (int)attackType & 7;

            if (key == 5 || (int)attackType > 3)
            {
                // Dead branch: MoveType() is evaluated and discarded.
                for (int i = 0; i < raw.Count; i++)
                {
                    raw[i].MoveType();
                }
            }
            else
            {
                for (int i = 0; i < raw.Count; i++)
                {
                    EEnemyMoveTypeDef moveType = raw[i].MoveType();
                    if (key == 1)
                    {
                        if ((int)moveType == 1)
                        {
                            result.Add(raw[i]);
                        }
                    }
                    else if (key == 3 || (key == 2 && (int)moveType == 2))
                    {
                        result.Add(raw[i]);
                    }
                }
            }

            return result;
        }

        // GetCostTrees @0x4E04F0 — collect every unclaimed tree (referenceCount
        // == 0, int @0x64) within `range` of `center`. The query runs against a
        // flat cylinder (radius = range, height = 2*range — DAT_00b7c4a8 =
        // 100.0f CONFIRMED) around the center; the distance test flattens both
        // positions to y = 0 (DAT_00b7c5b0 = 0.0f CONFIRMED) so height
        // differences between tree and build site do not matter.
        // NOTE: the original NREs when center or costTrees is null.
        public static void GetCostTrees(GameCoreTree center, float range, List<GameCoreTree> costTrees)
        {
            Vector3 centerPos = center.position;
            Vector3 flatCenter = new Vector3(centerPos.x, 0.0f, centerPos.z);

            // FUN_0093ba00(range + range, range * 100.0f): broad-phase cylinder
            // of radius 2×range and height 100×range (DAT_00b7c4a8 = 100.0f).
            foreach (GameCoreTree tree in GameCore.Instance.AllObjects<GameCoreTree>(
                centerPos, new Cylinder(range + range, range * TreeQueryHeightScale)))
            {
                if (tree.referenceCount != 0)
                {
                    continue;
                }

                Vector3 treePos = tree.position;
                Vector3 flatTree = new Vector3(treePos.x, 0.0f, treePos.z);
                if (Vector3.Distance(flatTree, flatCenter) <= range)
                {
                    costTrees.Add(tree);
                }
            }
        }

        // FromTreeToTower @0x4D6170 — convert a nature tree into a tower:
        // gather the trees consumed by the build (claiming them), broadcast
        // structureBreakEvent, create the simulation tower from the prefab
        // settings, spawn/attach the viewer and queue the build state.
        public static GameCoreTower FromTreeToTower(GameCoreTree tree, Q4.TowerBase towerPrefab)
        {
            if (tree == null || towerPrefab == null)
            {
                return null;
            }

            // Ghidra labels the shared body GetUnityObject<Structure>, but the
            // field actually read (Vector3 @0x74) only exists on NatureTree —
            // the tree's viewer type (a <NatureTree> instantiation exists in
            // the metadata).
            Q4.NatureTree treeView = tree.GetUnityObject<Q4.NatureTree>();

            List<GameCoreTree> costTrees = new List<GameCoreTree>();
            GetCostTrees(tree, towerPrefab.buildRange /* float @0x84 CONFIRMED */, costTrees);

            // No unclaimed trees within buildRange (normally the source tree
            // itself is collected here) -> no valid build site, return null.
            if (costTrees.Count < 1)
            {
                return null;
            }

            List<GameCoreHandle> handles = new List<GameCoreHandle>(costTrees.Count);
            foreach (GameCoreTree costTree in costTrees)
            {
                handles.Add(costTree.handle);
                Events.structureBreakEvent.Invoke(costTree);
                costTree.referenceCount += 1;   // claim the tree
            }

            GameCoreTower tower = new GameCoreTower(towerPrefab.name, handles);
            tower.position = tree.position;

            // CONFIRMED by offset: NatureTree.towerDirection (Vector3 @0x74)
            // seeds both body and fort direction.
            tower.bodyDirection = treeView.towerDirection;
            tower.fortDirection = tower.bodyDirection;

            GameObject instance = Object.Instantiate<GameObject>(
                towerPrefab.gameObject,
                tower.position + Vector3.down * tower.height,
                Quaternion.Euler(tower.bodyDirection));
            instance.name = towerPrefab.name;
            Q4.GameCoreBridge.Instance.SetUnityObject(tower.handle, instance);

            tower.Initialize();

            // buildTime int @0x64 CONFIRMED; difficulty scales the raise time.
            float buildTime = Q4.DifficultySettings.TowerBuildTimeByDifficulty(
                (float)towerPrefab.buildTime);
            tower.SetTowerState(new TowerStateBuild(buildTime));

            return tower;
        }

        // RandomCautionDirection @0x4E0B10 — random idle look-around target
        // direction: a random yaw within tower.cautionAngleRange (float @0xE4)
        // around an axis perpendicular to the fort direction, tilted by a
        // random pitch in [view.cautionRotateAngleMin, 360 - min]
        // (TowerBase float @0x178; DAT_00b7c4ac = 360.0f CONFIRMED).
        // SIDE EFFECT (faithful): zeroes tower.currentRotateSpeedX AND
        // currentRotateSpeedY (single 8-byte store @0x13C in the binary).
        // NOTE: the original NREs when tower or towerView is null.
        public static Vector3 RandomCautionDirection(
            GameCoreTower tower, Q4.TowerBase towerView, Vector3 directionBeforeCaution)
        {
            float yaw = GameCoreObject.RandomRange(0.0f, tower.cautionAngleRange, tower.handle);
            float minPitch = towerView.cautionRotateAngleMin;   // TowerBase @0x178
            float pitch = GameCoreObject.RandomRange(minPitch, 360.0f - minPitch, tower.handle);

            Vector3 cross = Vector3.Cross(tower.fortDirection, Vector3.up);
            // Tilt the perpendicular axis by `pitch` around the fort direction.
            Vector3 tiltedAxis = Quaternion.AngleAxis(pitch, tower.fortDirection) * cross;

            tower.currentRotateSpeedX = 0.0f;
            tower.currentRotateSpeedY = 0.0f;

            return Quaternion.AngleAxis(yaw, tiltedAxis) * directionBeforeCaution;
        }
    }
}
