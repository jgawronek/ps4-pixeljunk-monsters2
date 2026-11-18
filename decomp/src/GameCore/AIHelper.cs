// GameCore/AIHelper.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Static helpers for enemy AI: finding blocking/avoidance neighbours, closest-object
// queries, and terrain orientation sampling. Nested BlockingInfo / TerrainInfo /
// TerrainOrientationInterpolator recovered from dump.cs + Ghidra (bodies FUN_0093ca50,
// FUN_0093cb90, FUN_0093cb70). Field offsets from global-metadata.dat.
//
// Float constants resolved from the binary (.rodata):
//   look-ahead height scale 1.5, slower-by 0.1, parallel-dot 0.8, lateral pad 0.2,
//   linecast depth 10, Rad2Deg 57.29578, predict time 0.25, sample ticks 15.

using System;
using System.Collections.Generic;
using UnityEngine;
using Q4; // Layers, AISettings

namespace GameCore
{
    public static class AIHelper
    {
        private static List<GameCoreEnemy> enemyStorage; // 0x0 (static)

        // .cctor @0x93C990
        static AIHelper()
        {
            enemyStorage = new List<GameCoreEnemy>();
        }

        // GetBlockingEnemy @0x93B550
        // Finds the single nearest enemy ahead of a_me within a_dist and reports it in
        // all three blocking categories (same-group / same-path / diff-path).
        public static BlockingInfo GetBlockingEnemy(GameCoreEnemy a_me, float a_dist, float a_speed)
        {
            GameCoreEnemy closest = null;
            float closestDist = float.PositiveInfinity;
            float speed = a_speed;

            if (a_me != null)
            {
                Vector3 pos = a_me.position;
                Vector3 moveVec = a_me.MoveVec;
                float myRadius = a_me.collision.radius;
                var neighbours = GameCore.Instance.AllObjects<GameCoreEnemy>(
                    pos, new Cylinder(myRadius + a_dist, a_me.collision.height));
                foreach (GameCoreEnemy enemy in neighbours)
                {
                    if (enemy == a_me)
                        continue;
                    Vector3 diff = enemy.position - pos;
                    if (Vector3.Dot(moveVec, diff) <= 0.0f)
                        continue; // behind me
                    float dist = diff.magnitude - enemy.collision.radius;
                    if (closestDist <= dist)
                        continue; // not nearer
                    speed = enemy.SpeedCur;
                    closest = enemy;
                    closestDist = dist;
                }
            }
            return new BlockingInfo(
                closest, closestDist, speed,
                closest, closestDist, speed,
                closest, closestDist, speed);
        }

        // GetAvoidanceEnemy @0x93BC70
        // Categorises nearby enemies into same-wave-group, same-path and different-path
        // blockers so StateWalk can decide whether to slow down or steer around them.
        public static BlockingInfo GetAvoidanceEnemy(GameCoreEnemy a_me, float a_lookAheadDist, float a_speed)
        {
            GameCoreEnemy enemySameGroup = null, enemySamePath = null, enemyDiffPath = null;
            float distSameGroup = float.PositiveInfinity;
            float distSamePath = float.PositiveInfinity;
            float distDiffPath = float.PositiveInfinity;
            float speedSameGroup = a_speed, speedSamePath = a_speed, speedDiffPath = a_speed;

            if (a_me != null)
            {
                float myRadius = a_me.collision.radius;
                Vector3 moveVec = a_me.MoveVec;
                // Lateral (side) direction: moveVec rotated 90 degrees in the XZ plane.
                Vector3 sideVec = new Vector3(moveVec.z, 0.0f, -moveVec.x);
                Vector3 pos = a_me.position;
                bool isBalloon = a_me.IsBalloon;
                int waveGroupID = a_me.WaveGroupID;
                CorePathMove myPathMove = a_me.PathMove;

                enemyStorage.Clear();
                // INFERRED: exact search cylinder dims not fully recoverable from the SSE
                // blend; radius uses the look-ahead distance, height scaled by 1.5.
                enemyStorage.AddRange(GameCore.Instance.AllObjects<GameCoreEnemy>(
                    pos, new Cylinder(a_lookAheadDist, a_me.collision.height * 1.5f)));

                float slowerThreshold = a_speed - 0.1f;
                foreach (GameCoreEnemy enemy in enemyStorage)
                {
                    if (enemy == a_me)
                        continue;
                    if (enemy.IsBalloon != isBalloon)
                        continue; // only avoid enemies in the same "layer" (air/ground)

                    float otherRadius = enemy.collision.radius;
                    Vector3 diff = enemy.position - pos;
                    Vector3 diffH = new Vector3(diff.x, 0.0f, diff.z);
                    float dotForward = Vector3.Dot(moveVec, diffH);

                    if (enemy.WaveGroupID == waveGroupID)
                    {
                        // Same wave group: only yield to enemies spawned earlier that are ahead.
                        if (dotForward < distSameGroup && dotForward > 0.0f &&
                            enemy.WaveSpawnIndex < a_me.WaveSpawnIndex)
                        {
                            speedSameGroup = enemy.SpeedCur;
                            distSameGroup = dotForward;
                            enemySameGroup = enemy;
                        }
                    }
                    else if (myPathMove.IsSameCurve(enemy.PathMove))
                    {
                        // Different group but same path: avoid slower, unblocked enemies ahead.
                        if (!enemy.IsBlocked && enemy.SpeedCur < slowerThreshold)
                        {
                            float dist = dotForward - otherRadius;
                            if (dist > 0.0f && dist < distSamePath)
                            {
                                speedSamePath = enemy.SpeedCur;
                                distSamePath = dist;
                                enemySamePath = enemy;
                            }
                        }
                    }
                    else
                    {
                        // Different path: avoid crossing enemies that are roughly ahead and
                        // laterally close, moving in a non-parallel direction.
                        float dotMoves = Vector3.Dot(moveVec, enemy.MoveVec);
                        if (Mathf.Abs(dotMoves) < 0.8f && !enemy.IsBlocked)
                        {
                            float sideDist = Vector3.Dot(sideVec, diffH);
                            if (Mathf.Abs(sideDist) < dotForward &&
                                dotForward < distDiffPath && dotForward > 0.0f &&
                                Mathf.Abs(sideDist) < otherRadius + myRadius + 0.2f)
                            {
                                distDiffPath = dotForward - otherRadius;
                                speedDiffPath = 0.0f;
                                enemyDiffPath = enemy;
                            }
                        }
                    }
                }
            }
            return new BlockingInfo(
                enemySameGroup, distSameGroup, speedSameGroup,
                enemySamePath, distSamePath, speedSamePath,
                enemyDiffPath, distDiffPath, speedDiffPath);
        }

        // FindClosestObject<T> @0x2C58A0 (generic; instantiated for GameCoreTower/Enemy/object)
        public static T FindClosestObject<T>(Vector3 a_pos, float a_radius, float a_height)
            where T : GameCoreObject
        {
            T closest = null;
            float closestSqr = float.PositiveInfinity;
            foreach (T obj in GameCore.Instance.AllObjects<T>(a_pos, new Cylinder(a_radius, a_height)))
            {
                float sqr = (obj.position - a_pos).sqrMagnitude;
                if (sqr < closestSqr)
                {
                    closestSqr = sqr;
                    closest = obj;
                }
            }
            return closest;
        }

        // DetectGroundOrientation @0x93C580
        // Samples the terrain under a_pos by a vertical linecast, returning the surface
        // normal, the forward direction projected onto the surface, the terrain height and
        // the slope angle (degrees) along a_forward.
        // NOTE: a_size is present in the metadata signature but unused in the decompiled
        // body (linecast depth is a constant 10); call sites omit it, so it is defaulted here.
        public static TerrainInfo DetectGroundOrientation(Vector3 a_pos, Vector3 a_forward, float a_size = 0.0f)
        {
            TerrainInfo result = default(TerrainInfo);
            int terrainMask = Layers.Instance.TerrainMask;
            RaycastHit hit;
            if (!Physics.Linecast(a_pos + Vector3.up, a_pos - Vector3.up * 10.0f, out hit, terrainMask))
            {
                // No terrain hit: degenerate fallback (flat normal at the query height).
                result.normal = Vector3.up;
                result.terrainHeight = a_pos.y;
                // NOTE: original scales forward by (0,1,0) here (vertical-only) — reproduced
                // faithfully; looks like a degenerate fallback for the no-hit case.
                result.forward = Vector3.Normalize(Vector3.Scale(a_forward, new Vector3(0.0f, 1.0f, 0.0f)));
                result.facingSlopeAngle = 0.0f;
            }
            else
            {
                result.normal = hit.normal;
                // Project a_forward onto the plane perpendicular to the surface normal.
                result.forward = Vector3.Cross(Vector3.Cross(hit.normal, a_forward), hit.normal);
                result.terrainHeight = hit.point.y;
                Vector3 horiz = Vector3.Scale(result.forward, new Vector3(1.0f, 0.0f, 1.0f));
                float horizMag = horiz.magnitude;
                result.facingSlopeAngle = Mathf.Atan2(result.forward.y, horizMag) * Mathf.Rad2Deg;
            }
            return result;
        }

        // ---------------------------------------------------------------------------
        // Nested types
        // ---------------------------------------------------------------------------

        // AIHelper.BlockingInfo (TypeDefIndex 3084) — .ctor @0x93BA10
        public class BlockingInfo
        {
            public GameCoreHandle enemySameGroup;   // 0x10
            public float distanceSameGroup;         // 0x30
            public float speedSameGroup;            // 0x34
            public GameCoreHandle enemySamePath;    // 0x38
            public float distanceSamePath;          // 0x58
            public float speedSamePath;             // 0x5C
            public GameCoreHandle enemyDiffPath;    // 0x60
            public float distanceDiffPath;          // 0x80
            public float speedDiffPath;             // 0x84

            public BlockingInfo(GameCoreEnemy a_enemySG, float a_distSG, float a_speedSG,
                GameCoreEnemy a_enemySP, float a_distSP, float a_speedSP,
                GameCoreEnemy a_enemyDP, float a_distDP, float a_speedDP)
            {
                enemySameGroup = (a_enemySG != null) ? a_enemySG.handle : GameCoreHandle.nullHandle;
                distanceSameGroup = a_distSG;
                speedSameGroup = a_speedSG;
                enemySamePath = (a_enemySP != null) ? a_enemySP.handle : GameCoreHandle.nullHandle;
                distanceSamePath = a_distSP;
                speedSamePath = a_speedSP;
                enemyDiffPath = (a_enemyDP != null) ? a_enemyDP.handle : GameCoreHandle.nullHandle;
                distanceDiffPath = a_distDP;
                speedDiffPath = a_speedDP;
            }
        }

        // AIHelper.TerrainInfo (TypeDefIndex 3085)
        [Serializable]
        public struct TerrainInfo
        {
            public float facingSlopeAngle; // 0x0
            public Vector3 forward;        // 0x4
            public Vector3 normal;         // 0x10
            public float terrainHeight;    // 0x1C
        }

        // AIHelper.ETerrainDetectRaycast (TypeDefIndex 3086) — private; raycast slots.
        // Not referenced by the shipped single-linecast DetectGroundOrientation.
        private enum ETerrainDetectRaycast
        {
            Center = 0,
            Forward = 1,
            Back = 2,
            Left = 3,
            Right = 4,
            Num = 5
        }

        // AIHelper.TerrainOrientationInterpolator (TypeDefIndex 3087)
        // Smoothly interpolates terrain orientation samples taken every 15 ticks, looking
        // slightly ahead of the enemy. Bodies: ctor FUN_0093ca50, Tick FUN_0093cb90.
        [Serializable]
        public struct TerrainOrientationInterpolator
        {
            private const int m_ticksBetweenSamples = 15;
            private GameCoreHandle m_enemyHandle;          // 0x0
            private TerrainInfo m_previousSample;          // 0x20
            private TerrainInfo m_currentSample;           // 0x40
            private TerrainInfo m_interpolatedSample;      // 0x60
            private int m_ticksToNextSample;               // 0x80

            // .ctor @0x93CB60 (body FUN_0093ca50)
            public TerrainOrientationInterpolator(GameCoreEnemy enemy)
            {
                m_enemyHandle = enemy.handle;
                TerrainInfo sample = AIHelper.DetectGroundOrientation(enemy.position, enemy.MoveVec);
                m_previousSample = sample;
                m_currentSample = sample;
                m_interpolatedSample = sample;
                m_ticksToNextSample = 0;
            }

            // get_interpolatedSample @0x93CB80 (body FUN_0093cb70)
            public TerrainInfo interpolatedSample
            {
                get { return m_interpolatedSample; }
            }

            // Tick @0x93CE40 (body FUN_0093cb90)
            public void Tick()
            {
                m_ticksToNextSample--;
                if (m_ticksToNextSample < 1)
                {
                    m_ticksToNextSample += m_ticksBetweenSamples;
                    m_previousSample = m_currentSample;
                    GameCoreEnemy enemy = m_enemyHandle.GetMostRecentObjectVersion<GameCoreEnemy>();
                    if (enemy != null)
                    {
                        Vector3 pos, dir;
                        enemy.PredictPositionAndDirection(0.25f, out pos, out dir);
                        m_currentSample = AIHelper.DetectGroundOrientation(pos, dir);
                    }
                }

                // Blend from the previous sample toward the current one over the interval.
                float t = 1.0f - m_ticksToNextSample / (float)m_ticksBetweenSamples;
                m_interpolatedSample.terrainHeight = Mathf.Lerp(
                    m_previousSample.terrainHeight, m_currentSample.terrainHeight, t);
                m_interpolatedSample.normal = Vector3.Normalize(Vector3.Lerp(
                    m_previousSample.normal, m_currentSample.normal, t));
                m_interpolatedSample.forward = Vector3.Normalize(Vector3.Lerp(
                    m_previousSample.forward, m_currentSample.forward, t));
                m_interpolatedSample.facingSlopeAngle = Mathf.LerpAngle(
                    m_previousSample.facingSlopeAngle, m_currentSample.facingSlopeAngle, t);
            }
        }
    }
}