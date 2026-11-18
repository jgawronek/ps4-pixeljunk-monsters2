// GameCore/GameCoreHome.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The home base the monsters attack. Its HP is the pool of chibis ("kid" villagers):
// each successful enemy attack kills one chibi; when the last chibi dies the sim
// raises Events.gameOverEvent (unless the debug menu disables it). Also tracks the
// chibi count at the end of every wave (used by the stage-clear ranking).
//
// Logic from Ghidra decompilation of GameCore.GameCoreHome (RVA 0x4BA2A0..0x4BBC60).
// Field offsets from global-metadata.dat (skeleton/GameCore.cs, TypeDefIndex 3040).
// All float constants were read from the ELF .rodata literal pool (CONFIRMED,
// file offset = vaddr + 0x4000):
//   DAT_00b7c374 = 1.75   DAT_00b7c378 = 0.925  DAT_00b7c37c = 0.2
//   DAT_00b7c380 = 4.0    DAT_00b7c384 = 0.5    DAT_00b7c388 = 0.25
//   DAT_00b7c38c = -1.0   DAT_00b7c390 = 0.16   DAT_00b7c394 = 0.4
//   DAT_00b7c398 = 0.5

using System.Collections.Generic;
using UnityEngine;

namespace GameCore
{
    public class GameCoreHome : GameCoreObject // TypeDefIndex: 3040
    {
        // Backing field 0x60; public get / protected set (metadata).
        public bool IsEnemyClose { get; protected set; }

        protected GameObject m_chibiPrefab;                        // 0x68 (= Q4.Home.kidPrefab @0x50)
        protected float m_playerDetectionRange;                    // 0x70 (= Structure.playerDetectionRange @0x20)
        protected float m_enemyDetectionRange;                     // 0x74 (= Structure.enemyDetectionRange @0x1C)
        protected int m_totalStartChibiNum;                        // 0x78
        [CoreObjectPool.DeepCopyAttribute]
        protected List<ChibiData> m_chibisActive;                  // 0x80
        protected List<int> m_numChibiAtEndOfWave;                 // 0x88
        protected Vector3 m_OrientationForward;                    // 0x90

        // ---- constants (all CONFIRMED from ELF .rodata) --------------------

        private const float CollisionRadius = 1.75f;               // DAT_00b7c374
        private const float CollisionHeight = 0.925f;              // DAT_00b7c378
        private const float EnemyAttackDistancePad = 0.2f;         // DAT_00b7c37c
        private const float EnemyQueryPadding = 4.0f;              // DAT_00b7c380
        private const float ChibiAngleHalve = 0.5f;                // DAT_00b7c384
        private const float ChibiLinecastUp = 0.25f;               // DAT_00b7c388
        private const float ChibiLinecastDown = -1.0f;             // DAT_00b7c38c
        private const float ChibiMinSpacing = 0.16f;               // DAT_00b7c390
        private const float ChibiPushRestDist = 0.4f;              // DAT_00b7c394
        private const float ChibiPushScale = 0.5f;                 // DAT_00b7c398
        private const int ChibiListCapacity = 100;                 // literal 100 in CreateChibis @0x4BA500
        private const int MaxSpreadPasses = 9;                     // pass counter: exits when count > 8 @0x4BBB6E

        // ---- nested type ---------------------------------------------------

        // TypeDefIndex: 3041. One chibi (villager) standing guard at the home.
        // Pure data; the Q4.Chibi views are event-driven off this (see Q4/Chibi.cs).
        public class ChibiData
        {
            public bool isDead;        // 0x10
            public int id;             // 0x14
            public Vector3 pos;        // 0x18
            public Quaternion rot;     // 0x24

            // .ctor @0x4BB3D0 (inlined into SpawnChibi in the binary)
            public ChibiData(int a_id, Vector3 a_pos, Quaternion a_rot)
            {
                isDead = false;
                id = a_id;
                pos = a_pos;
                rot = a_rot;
            }
        }

        // ---- properties ----------------------------------------------------

        // get_NumChibi @0x4BA650 — living chibis. Dead chibis are REMOVED from
        // the list by DealDamage, so Count == alive count.
        public int NumChibi
        {
            get { return m_chibisActive.Count; }
        }

        // get_NumStartingChibi @0x4BA6A0
        public int NumStartingChibi
        {
            get { return m_totalStartChibiNum; }
        }

        // get_EnemyAttackDistance @0x4BA870
        // NOTE: faithful to the binary — derived from the PLAYER detection range
        // (0x70), not the enemy one: enemies close to within this distance of the
        // home are considered "arrived" by the Q4 view/AI side.
        public float EnemyAttackDistance
        {
            get { return m_playerDetectionRange + EnemyAttackDistancePad; }
        }

        // ---- lifecycle -----------------------------------------------------

        // .ctor @0x4BA2A0
        // Created by the Q4.Home view during scene bootstrap
        // (IPlaceableViewObject.CreateGameCoreObject @0x462650).
        public GameCoreHome(Q4.Home a_viewer)
        {
            m_numChibiAtEndOfWave = new List<int>();
            // (base GameCoreObject() registers the object + assigns the handle;
            //  the binary shows the List<int> field-init running before it.)

            if (a_viewer == null)
            {
                // Binary: null viewer falls into the shared NullReferenceException
                // path (FUN_00a78ac0). Member access below reproduces that.
                Debug.LogError("GameCoreHome created without a Q4.Home viewer.");
            }

            m_playerDetectionRange = a_viewer.playerDetectionRange;   // Structure @0x20
            m_enemyDetectionRange = a_viewer.enemyDetectionRange;     // Structure @0x1C
            m_chibiPrefab = a_viewer.kidPrefab;                       // Home @0x50

            // The landed collision setter re-buckets this object in the grid
            // (matches the explicit UpdateCoreObject call at 0x4BA344).
            collision = new Cylinder(CollisionRadius, CollisionHeight);

            m_OrientationForward = a_viewer.transform.forward;
            IsEnemyClose = false;

            CreateChibis(a_viewer);

            Events.enemyAttackedHomeEvent.AddListener(OnEnemyAttacked, Event.EventTime.Immediate);   // Events statics +0x48
            Events.waveEndedEvent.AddListener(OnEndOfWave, Event.EventTime.Immediate);               // Events statics +0x18
        }

        // DestroySelf @0x4BA880 (virtual slot 6)
        public override void DestroySelf()
        {
            // The binary inlines the base cleanup (destroyed flag @0x18 + de-grid)
            // guarded by non-null GameCore.Instance / collisionManager, then
            // unsubscribes both listeners inside the same guard.
            if (GameCore.Instance != null && GameCore.Instance.collisionManager != null)
            {
                base.DestroySelf();
                Events.enemyAttackedHomeEvent.RemoveListener(OnEnemyAttacked);
                Events.waveEndedEvent.RemoveListener(OnEndOfWave);
            }
        }

        // ---- chibi creation --------------------------------------------------

        // CreateChibis @0x4BA500
        // Spawns every zone's chibis with random polar placement around the home
        // and relaxes overlaps.
        private void CreateChibis(Q4.Home a_viewer)
        {
            m_totalStartChibiNum = 0;
            m_chibisActive = new List<ChibiData>(ChibiListCapacity);

            Q4.Home.ChibiHomeZone[] zones = a_viewer.ChibiHomeZones;      // Home @0x60 (array)
            int nextId = 0;
            for (int z = 0; z < zones.Length; z++)
            {
                Q4.Home.ChibiHomeZone zone = zones[z];
                m_totalStartChibiNum += zone.NumChibi;
                for (int j = 0; j < zone.NumChibi; j++)
                {
                    m_chibisActive.Add(SpawnChibi(nextId + j, zone));
                }
                nextId += zone.NumChibi;
            }

            SpreadOutChibi();
        }

        // SpawnChibi @0x4BB410
        // Random polar spot inside the zone's [MinDist, MaxDist] ring and
        // AngleCenter±AngleSpread/2 arc,
        // then snapped down onto terrain with a Linecast.
        private ChibiData SpawnChibi(int a_id, Q4.Home.ChibiHomeZone zone)
        {
            // Binary (disassembly @0x4bb4a2..0x4bb4ba, SysV float args):
            //   vmovss 0x20(%r15),%xmm1           ; xmm1 = AngleSpread  (max)
            //   vxorps 0xb7c560,%xmm1,%xmm0        ; xmm0 = -AngleSpread (min)
            //   call   RandomRange
            // 0xb7c560 is a 16-byte sign mask (0x80000000 x4). CORRECTED: an
            // earlier reading took Ghidra's CONCAT44 upper lane (DAT_00b7c564,
            // more mask) as max = -0.0f and sampled only half the arc. The real
            // sample is symmetric: AngleCenter ± AngleSpread/2.
            float angle = RandomRange(-zone.AngleSpread, zone.AngleSpread, handle) * ChibiAngleHalve
                        + zone.AngleCenter;

            Quaternion spin = Quaternion.AngleAxis(angle, Vector3.up);
            float dist = RandomRange(zone.MinDist, zone.MaxDist, handle);
            Vector3 offset = spin * (m_OrientationForward * dist);
            Vector3 pos = position + offset;
            Quaternion rot = Quaternion.LookRotation(offset, Vector3.up);

            // Ground snap: cast a short vertical segment and take the hit's y.
            Vector3 lineStart = pos + Vector3.up * ChibiLinecastUp;      // +0.25
            Vector3 lineEnd = pos + Vector3.up * ChibiLinecastDown;      // -1.0
            RaycastHit hit = default(RaycastHit);
            if (Physics.Linecast(lineStart, lineEnd, out hit, Q4.Layers.Instance.TerrainMask))
            {
                pos.y = hit.point.y;   // vblendps mask 2 — y component only
            }

            return new ChibiData(a_id, pos, rot);
        }

        // SpreadOutChibi @0x4BB7C0
        // Sorts chibis by distance to the "attack position" (the point on the
        // home's forward axis at m_enemyDetectionRange — where enemies arrive),
        // then runs up to MaxSpreadPasses relaxation passes pushing overlapping
        // chibis apart so the crowd reads clearly in the view.
        private void SpreadOutChibi()
        {
            Vector3 attackPos = position + m_OrientationForward * m_enemyDetectionRange;

            // <>m__0 @0x4BBC30: Compare(a,b) = dist(b) < dist(a) ? 1 : -1
            // → ascending by distance to attackPos (closest chibi guards the
            //   arrival point). Equal distances keep -1 (a before b), faithful
            //   to the binary's non-stable comparator.
            m_chibisActive.Sort(delegate(ChibiData a, ChibiData b)
            {
                float da = (a.pos - attackPos).magnitude;
                float db = (b.pos - attackPos).magnitude;
                return db < da ? 1 : -1;
            });

            int pass = 0;
            bool moved;
            do
            {
                moved = false;
                for (int i = 0; i < m_chibisActive.Count; i++)
                {
                    Vector3 cur = m_chibisActive[i].pos;
                    for (int j = i + 1; j < m_chibisActive.Count; j++)
                    {
                        Vector3 other = m_chibisActive[j].pos;
                        Vector3 delta = other - cur;
                        float d = delta.magnitude;
                        if (d < ChibiMinSpacing)                          // 0.16
                        {
                            Vector3 push = delta.normalized
                                         * ((ChibiPushRestDist - d) * ChibiPushScale); // (0.4 - d) * 0.5
                            cur -= push;
                            m_chibisActive[j].pos = other + push;
                            moved = true;
                        }
                    }
                    m_chibisActive[i].pos = cur;
                }
                if (!moved)
                    return;
                pass++;
            } while (pass <= MaxSpreadPasses - 1);   // binary: exits when 8 < pass counter
        }

        // ---- queries ---------------------------------------------------------

        // NumChibiAtEndOfWave @0x4BA6B0 — chibi count recorded after wave
        // `waveIndex` ended (0 if not recorded / negative index).
        public int NumChibiAtEndOfWave(int waveIndex)
        {
            if (waveIndex < 0)
                return 0;
            if (m_numChibiAtEndOfWave.Count <= waveIndex)
                return 0;
            return m_numChibiAtEndOfWave[waveIndex];
        }

        // GetChibiDataByIndex @0x4BA740
        public ChibiData GetChibiDataByIndex(int a_chibiIndex)
        {
            return m_chibisActive[a_chibiIndex];
        }

        // GetChibiDataById @0x4BA7A0 — null when no chibi carries that id.
        public ChibiData GetChibiDataById(int a_chibiId)
        {
            for (int i = 0; i < m_chibisActive.Count; i++)
            {
                ChibiData chibi = m_chibisActive[i];
                if (chibi != null && chibi.id == a_chibiId)
                    return m_chibisActive[i];
            }
            return null;
        }

        // ---- tick --------------------------------------------------------------

        // Tick @0x4BA9D0 (virtual slot 7)
        // Each tick: refresh IsEnemyClose from a spatial query, and let arrived
        // attackers kill one chibi each (or clean themselves up when the home is
        // already empty — the game-over stragglers).
        public override void Tick()
        {
            IsEnemyClose = false;

            // Broad-phase query around the home. VERIFIED (raw Tick @0x4BA9D0):
            // cylinder height 0. NOTE (raw grid MoveNext @0x770030): the height
            // filter (h_obj + h_query)*0.5 <= |dy + h_obj*0.5| SKIPS same-y-or-
            // higher objects for a height-0 query — only objects strictly BELOW
            // the home's position y are returned (scene home sits elevated).
            Cylinder query = new Cylinder(m_enemyDetectionRange + EnemyQueryPadding, 0f);
            IEnumerable<GameCoreEnemy> enemies =
                GameCore.Instance.AllObjects<GameCoreEnemy>(position, query);

            foreach (GameCoreEnemy enemy in enemies)
            {
                Vector3 delta = enemy.position - position;
                float reach = m_enemyDetectionRange + enemy.collision.radius;   // enemy Cylinder @0x34
                // NOTE: the decompiled compare visibly squares two components
                // (SSE packing artifact); reconstructed as full sqrMagnitude.
                if (reach * reach <= delta.sqrMagnitude)
                {
                    IsEnemyClose = true;
                }
                else if (enemy.CanAttack)
                {
                    if (m_chibisActive.Count < 1)
                    {
                        // Home already empty (game over pending): non-boss
                        // attackers are removed, viewer destroyed. Vtable calls
                        // resolved via 16-byte vtable entries (+0x160/+0x170 =
                        // entries 22/23 = slots 5/6 with the +17 interface shift):
                        // RecreateViewer() then DestroySelf().
                        if (!enemy.IsBoss)
                        {
                            GameObject viewerGo = enemy.RecreateViewer();
                            enemy.DestroySelf();
                            Object.Destroy(viewerGo);
                        }
                    }
                    else
                    {
                        // First living chibi is the target.
                        int idx = 0;
                        while (idx < m_chibisActive.Count && m_chibisActive[idx].isDead)
                            idx++;
                        if (idx < m_chibisActive.Count)
                        {
                            ChibiData chibi = m_chibisActive[idx];
                            // Attack @0x4B4A20 (vtable entry 41 = slot 24 + 17
                            // shift, offset 0x290). Raises enemyAttackedHomeEvent
                            // → OnEnemyAttacked → DealDamage on success.
                            if (enemy.Attack(this, chibi))
                            {
                                chibi.isDead = true;
                            }
                        }
                    }
                }
            }
        }

        // RecreateViewer @0x4BAF40 (virtual slot 5)
        // Re-links (or rediscovers) the scene's Home view after a load/resync:
        // snaps it to the sim position and returns its GameObject.
        public override GameObject RecreateViewer()
        {
            Q4.Structure viewer = GetUnityObject<Q4.Structure>();
            if (viewer == null)
            {
                // Decompiler labels the shared-generic instantiation
                // FindObjectsOfType<NatureTree>; the confirmed instantiation for
                // this call site is Q4.Home (same artifact noted by the bridge
                // reconstruction — see GameCoreBridge bootstrap).
                Q4.Home[] found = Object.FindObjectsOfType<Q4.Home>();
                if (found != null && found.Length > 0)
                    viewer = found[0];
            }
            if (viewer != null)
            {
                viewer.transform.position = position;
                return viewer.gameObject;
            }
            return null;   // binary: falls into the exception path; kept non-throwing
        }

        // ---- damage / events ---------------------------------------------------

        // DealDamage @0x4BB040
        // Kills the matching chibi: every chibi behind it in the (attack-pos
        // sorted) list shifts one formation slot forward, the victim is flagged
        // isDead (view plays the death anim) and removed. When the pool empties,
        // raises gameOverEvent unless the debug menu suppresses it.
        public void DealDamage(ChibiData a_chibi)
        {
            if (a_chibi == null)
                return;

            int index = 0;
            while (index < m_chibisActive.Count && m_chibisActive[index].id != a_chibi.id)
                index++;

            // Shift poses forward from the tail down to the victim, so the
            // chibis behind inherit the formation slots (faithful to the
            // descending copy loop at 0x4BB200..0x4BB248). When the id is not
            // found the original walks index to -1 and throws on Item(-1) —
            // reproduced by the unguarded indexer below.
            int last = m_chibisActive.Count - 1;
            while (last > index)
            {
                m_chibisActive[last].pos = m_chibisActive[last - 1].pos;
                m_chibisActive[last].rot = m_chibisActive[last - 1].rot;
                last--;
            }

            ChibiData victim = m_chibisActive[index];
            victim.isDead = true;
            m_chibisActive.RemoveAt(index);

            if (m_chibisActive.Count == 0)
            {
                // Q4.UI.Debug.DebugMenuCanvas.canvasInstance.disableGameOver
                // (field @0x1A) suppresses the loss in debug builds.
                Q4.UI.Debug.DebugMenuCanvas debug = Q4.UI.Debug.DebugMenuCanvas.canvasInstance;
                if (debug == null || !debug.disableGameOver)
                {
                    Events.gameOverEvent.Invoke();   // Events statics +0x38
                }
            }
        }

        // OnEnemyAttacked @0x4BB370 — enemyAttackedHomeEvent listener.
        // The enemy's Attack() raised the event; route the chibi kill here.
        public void OnEnemyAttacked(GameCoreEnemy a_enemy, GameCoreHome a_home, ChibiData a_chibi)
        {
            DealDamage(a_chibi);
        }

        // OnEndOfWave @0x4BB380 — waveEndedEvent listener.
        // Records the surviving chibi count for the wave (stage-clear ranking /
        // "chibis saved" stats). Args unused in the binary.
        public void OnEndOfWave(GameCoreWaveManager manager, int waveIndex)
        {
            m_numChibiAtEndOfWave.Add(m_chibisActive.Count);
        }
    }
}
