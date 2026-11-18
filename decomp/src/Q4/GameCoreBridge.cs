// Q4/GameCoreBridge.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// THE Q4 <-> GameCore SEAM. Singleton MonoBehaviour that owns the simulation
// (GameCore.GameCore), drives it from the Unity player loop, and keeps the
// bidirectional handle <-> GameObject maps that every view uses.
//
// Verified driver pipeline (single-player), from pseudocode + disassembly:
//
//   Update() @0x449D80
//     if SceneLoader.IsLoading() -> skip everything
//     if m_enableGameCoreTick:
//       m_networkBridge.Update()                       (wall-clock advance)
//       firstUpdateTime = Time.timeSinceLevelLoad      (once)
//       t = IsNetworkMatch ? networkBridge.synchronizedWallClockTime
//                          : Time.timeSinceLevelLoad - firstUpdateTime
//       m_networkBridge.CheckForNextNetworkFrame(t)    (serialize local blob, log hash)
//       CheckForNextUpdateFrame(t):
//         while updateCount < target:                  (target = updateCount+1 in SP)
//           if networkBridge.GameCoreMustWait() -> stop
//              (SP: waits only while Player.players.Count == 0; after 10 ticks
//               also waits if pendingReceivedFrames is non-empty)
//           if maxTicksThisFrame < 1 -> stop           (max(5, timeScale*5))
//           Random.InitState((int)updateCount)         (determinism aid)
//           m_gameCore.PrepareNextFrame()              @0x4AA8C0
//           m_networkBridge.OnGameCoreTicked()         @0x4DC7D0  <-- see below
//           m_gameCore.Tick()                          @0x4AAB30
//           updateCount++
//     else:
//       firstUpdateTime += Time.deltaTime              (keep elapsed time ~0 while paused)
//
//   LateUpdate() -> CoreEventBase.InvokePendingPostUnityUpdateEvents()
//
// IMPORTANT verified corrections to the blueprint's inferred model:
//  * Single-player is NOT fixed 60 Hz: GameCore.Tick sets
//    TickDeltaTime = Mathf.Min(Time.deltaTime, 0.5f) and ticks once per Update.
//    Fixed 1/60 s (constant @0x00B7C244) applies only in network matches; the
//    SP cap 0.5f is @0x00B7C248. The driver constants here (5.0f cap factor,
//    60.0f network rate) were read from the ELF constant pool.
//  * PrepareNextFrame -> GameCoreFrame.CreateFrameCopyForUpdate @0x4AA930 does
//    NOT deep-copy in the tick path: it updates the CURRENT frame in place
//    (sets m_frameTime, snapshots m_position -> m_previousTickPosition for every
//    live object, removes destroyed objects via swap-back from m_gameObjects and
//    the per-type lists). The deep-copy machinery is for network resync.
//  * GameCoreNetworkBridge.OnGameCoreTicked @0x4DC7D0 (called BETWEEN Prepare and
//    Tick) is where the local player's Unity pose enters the sim and commands
//    execute: for each local Q4.Player it appends a NetworkDataBlobPlayerSample
//    (position/facing/animState/animTime/sampleTime/towerDanceHandle sampled from
//    the view) to the pending player blob, then applies received frames:
//    writes each sample into the matching GameCorePlayer (position via inlined
//    set_position + collisionManager.UpdateCoreObject, facingDegrees @0x64,
//    animationStateHash @0x68, animationStateTime @0x6c, sampleTime @0x74) and
//    calls NetworkCommand.ExecuteCommand(corePlayer) for every queued command
//    (vtable call at +0x150). Single-player uses NullNetworkLayer loopback.
//  * GameCore.InstallFrame @0x4AB020 (used by DeserializeGameState) swaps
//    currentFrame, bumps GameCoreHandle.s_cacheTag and re-inits the collision
//    grid; it does not pool the old frame here.
//
// Field offsets from skeleton/Q4.cs (TypeDefIndex 2975); RVAs per method.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using GameCore;
using GameCore.Event;
using GameCore.Network;
using UnityEngine;

namespace Q4
{
    public class GameCoreBridge : MonoBehaviour
    {
        private static GameCoreBridge m_instance;                       // 0x0 (static)
        // original name: <>f__am$cache0                                // 0x8 (static) cached sort delegate
        private static Comparison<MonoBehaviour> s_placeableSortCache;

        // Type is GameCore.GameCore (namespace/class name collision — qualified
        // to bind the class, as the original source must have done).
        public GameCore.GameCore m_gameCore { get; private set; }       // 0x18 (auto-property)
        public GameCoreNetworkBridge m_networkBridge { get; private set; } // 0x20 (auto-property)
        public Dictionary<GameCoreHandle, GameObject> m_gameCoreToUnityMap; // 0x28
        public Dictionary<GameObject, GameCoreHandle> m_unityToGameCoreMap; // 0x30
        private bool hasSetFirstUpdateTime;                             // 0x38
        public float firstUpdateTime { get; private set; }              // 0x3C (auto-property)
        public uint updateCount { get; private set; }                   // 0x40 (auto-property)
        private bool m_enableGameCoreTick;                              // 0x44
        [SerializeField] private bool debugCollisionManager;            // 0x45

        public static GameCoreBridge Instance
        {
            get { return m_instance; }                                  // get_Instance @0x43A790
        }

        public bool gameCoreTickEnabled
        {
            get { return m_enableGameCoreTick; }                        // get_gameCoreTickEnabled @0x4493F0
            set                                                             // set_gameCoreTickEnabled @0x449400
            {
                m_enableGameCoreTick = value;
                StageHub stage = StageHub.GetCurrentStage();
                if (stage == null)
                    return;
                // Pause/resume the enemy and tower viewers (animators + particles)
                // when the sim is paused (menus etc.).
                SetViewersPaused<EnemyBase>(!value, stage.waveManager.GetEnemyRoot());
                SetViewersPaused<TowerBase>(!value, TowerBase.TowerRoot);
            }
        }

        // .ctor @0x4492F0
        public GameCoreBridge()
        {
            m_gameCoreToUnityMap = new Dictionary<GameCoreHandle, GameObject>();
            m_unityToGameCoreMap = new Dictionary<GameObject, GameCoreHandle>();
            m_enableGameCoreTick = true;
        }

        // Awake @0x449580
        public void Awake()
        {
            Debug.Log("GameCoreBridge.Awake");
            m_gameCore = new GameCore.GameCore();
            m_networkBridge = ScriptableObject.CreateInstance<GameCoreNetworkBridge>();
            // The bridge GameObject may carry a scene PointOfInterest; drop it.
            GameObjectHelper.RemoveComponent<PointOfInterest>(gameObject);
        }

        // OnDestroy @0x449640
        public void OnDestroy()
        {
            Debug.Log("GameCoreBridge.OnDestroy");
            foreach (GameCoreTower tower in m_gameCore.AllObjects<GameCoreTower>())
                tower.DestroySelf();                                    // virtual slot 6 (vtable +0x170)
            UnityEngine.Object.Destroy(m_networkBridge);
            m_networkBridge = null;
            m_instance = null;
        }

        // ------------------------------------------------------------------
        // Handle <-> Unity maps
        // ------------------------------------------------------------------

        // GetUnityObject @0x4499B0
        // Indexer lookup; throws KeyNotFoundException when the handle is unmapped.
        public GameObject GetUnityObject(GameCoreHandle gameCoreHandle)
        {
            return m_gameCoreToUnityMap[gameCoreHandle];
        }

        // GetUnityObject<T> @0x2C7050 (generic shared body)
        // Returns null when the mapped GameObject is null/destroyed.
        public T GetUnityObject<T>(GameCoreHandle gameCoreHandle) where T : Component
        {
            GameObject go = GetUnityObject(gameCoreHandle);
            if (go == null)
                return null;
            return go.GetComponent<T>();
        }

        // GetGameCoreObject<T>(GameObject) @0x2C6EF0 (generic shared body)
        // Resolves the handle against the CURRENT frame and rejects destroyed
        // objects; returns null when unmapped/missing/destroyed.
        public T GetGameCoreObject<T>(GameObject unityObject) where T : GameCoreObject
        {
            GameCoreHandle handle;
            if (m_unityToGameCoreMap.TryGetValue(unityObject, out handle))
            {
                T obj = handle.GetMostRecentObjectVersion<T>();
                if (obj != null && !obj.IsDestroyed())
                    return obj;
            }
            return null;
        }

        // GetGameCoreObject<T>(MonoBehaviour) @0x2C7000 (generic shared body)
        public T GetGameCoreObject<T>(MonoBehaviour unityObject) where T : GameCoreObject
        {
            return GetGameCoreObject<T>(unityObject.gameObject);
        }

        // SetUnityObject(GameCoreHandle, GameObject) @0x449AC0
        // First mapping wins: if the handle is already mapped and the new view is
        // non-null, this is a no-op. (Views also register themselves inside
        // CreateGameCoreObject, so the bootstrap's second registration is skipped.)
        public void SetUnityObject(GameCoreHandle coreObject, GameObject viewObject)
        {
            GameObject existing;
            if (viewObject != null && m_gameCoreToUnityMap.TryGetValue(coreObject, out existing))
                return;

            m_gameCoreToUnityMap[coreObject] = viewObject;
            if (viewObject == null)
            {
                // As shipped: Remove(viewObject) with a null key would throw;
                // this branch is effectively dead (cleanup happens in
                // ResyncUnityWorldToGameCore). Kept faithful to the binary.
                m_unityToGameCoreMap.Remove(viewObject);
            }
            else
            {
                m_unityToGameCoreMap[viewObject] = coreObject;
            }
        }

        // SetUnityObject(GameCoreHandle, MonoBehaviour) @0x449C50
        public void SetUnityObject(GameCoreHandle coreObject, MonoBehaviour viewObject)
        {
            GameObject go = (viewObject == null) ? null : viewObject.gameObject;
            SetUnityObject(coreObject, go);
        }

        // ------------------------------------------------------------------
        // Fixed-step driver
        // ------------------------------------------------------------------

        // Update @0x449D80
        public void Update()
        {
            if (SceneLoader.IsLoading())
                return;

            if (m_enableGameCoreTick)
            {
                m_networkBridge.Update();

                if (!hasSetFirstUpdateTime)
                {
                    firstUpdateTime = Time.timeSinceLevelLoad;
                    hasSetFirstUpdateTime = true;
                }

                float t;
                if (!Q4.Networking.NetworkMatch.IsNetworkMatch)
                    t = Time.timeSinceLevelLoad - firstUpdateTime;
                else
                    t = m_networkBridge.synchronizedWallClockTime;

                m_networkBridge.CheckForNextNetworkFrame(t);
                CheckForNextUpdateFrame(t);
            }
            else
            {
                // While ticking is disabled, slide the epoch forward so no
                // catch-up burst happens when ticking resumes.
                firstUpdateTime += Time.deltaTime;
            }
        }

        // CheckForNextUpdateFrame @0x449EB0
        // Returns true if at least one sim tick ran. Single-player target is
        // exactly updateCount+1 (one tick per Update); network matches target
        // (uint)(t * 60). maxTicks caps catch-up at max(5, timeScale*5).
        private bool CheckForNextUpdateFrame(float timeSinceLevelStart)
        {
            int maxTicks = Math.Max(5, (int)(Time.timeScale * 5.0f));   // 5.0f @0x00B7B6DC

            uint targetCount;
            if (!Q4.Networking.NetworkMatch.IsNetworkMatch)
                targetCount = updateCount + 1;
            else
                targetCount = (uint)(timeSinceLevelStart * 60.0f);      // 60.0f @0x00B7B6E0

            bool ticked = false;
            while (targetCount > updateCount)
            {
                if (m_networkBridge.GameCoreMustWait())
                    return ticked;
                if (maxTicks < 1)
                    return ticked;

                UnityEngine.Random.InitState((int)updateCount);

                m_gameCore.PrepareNextFrame();          // in-place frame refresh (see header)
                m_networkBridge.OnGameCoreTicked();     // sample local player pose + apply frames/commands
                m_gameCore.Tick();                      // TickAllObjects + post-tick events + log hash

                maxTicks--;
                ticked = true;
                updateCount = updateCount + 1;
            }
            return ticked;
        }

        // LateUpdate @0x44A000
        public void LateUpdate()
        {
            CoreEventBase.InvokePendingPostUnityUpdateEvents();
        }

        // TimeSkip @0x44A050
        // Debug/fast-forward: shift the epoch back, then tick until caught up.
        public void TimeSkip(float seconds)
        {
            firstUpdateTime -= seconds;
            float t = Time.timeSinceLevelLoad - firstUpdateTime;
            while (CheckForNextUpdateFrame(t))
            {
                m_networkBridge.CheckForNextNetworkFrame(t);
            }
        }

        // ------------------------------------------------------------------
        // Singleton / bootstrap
        // ------------------------------------------------------------------

        // CreateInstance @0x44A0C0
        public static void CreateInstance()
        {
            if (m_instance == null)
                m_instance = UnityEngine.Object.FindObjectOfType<GameCoreBridge>();
            if (m_instance != null)
                UnityEngine.Object.Destroy(m_instance.gameObject);

            GameObject go = new GameObject("GameCoreBridge");
            m_instance = go.AddComponent<GameCoreBridge>();
            // NOTE: Ghidra labels the two generic calls <TitleScreenController>
            // and <GestureInputModule> (shared generic bodies); the static field
            // type forces <GameCoreBridge>, which is a confirmed instantiation.
        }

        // CreateGameCoreFromCurrentUnityScene @0x44A2D0
        // THE LEVEL BOOTSTRAP. Scans every MonoBehaviour in the scene, keeps the
        // ones implementing GameCore.IPlaceableViewObject, and asks each to create
        // its core object (WaveManager, Player, Home, PickupManager, Shop,
        // TowerBase/NatureTree via Structure, InteractionObject, Fruit...).
        public void CreateGameCoreFromCurrentUnityScene()
        {
            m_gameCore = new GameCore.GameCore();

            List<MonoBehaviour> placeables = new List<MonoBehaviour>();
            // NOTE: decompiler shows FindObjectsOfType<NatureTree> (shared generic
            // body artifact). The scan must be <MonoBehaviour>: the list is typed
            // List<MonoBehaviour>, every element is interface-cast, and all nine
            // implementors are created only here. <MonoBehaviour> is a confirmed
            // instantiation of the same shared body @0xA24E50.
            foreach (MonoBehaviour mb in UnityEngine.Object.FindObjectsOfType<MonoBehaviour>())
            {
                if (mb is IPlaceableViewObject)
                {
                    if (placeables.Contains(mb))
                        Debug.LogError("AlreadyAdded!");
                    placeables.Add(mb);
                }
            }

            if (Q4.Networking.NetworkMatch.IsNetworkMatch)
            {
                // Deterministic creation order for lockstep: sort by position,
                // then by name (see comparison below). Single-player keeps
                // FindObjectsOfType order.
                UnityEngine.Random.InitState(0);
                if (s_placeableSortCache == null)
                    s_placeableSortCache = ComparePlaceables_m__0;
                placeables.Sort(s_placeableSortCache);
            }

            foreach (MonoBehaviour mb in placeables)
            {
                IPlaceableViewObject placeable = (IPlaceableViewObject)mb;
                GameCoreObject coreObject = placeable.CreateGameCoreObject();
                SetUnityObject(coreObject.handle, mb.gameObject);

                NetworkLog.Instance.Log(
                    "Adding PlaceableObject: " + coreObject.ToString() + ", " +
                    coreObject.position.ToString("F8"),
                    coreObject.handle.m_handle);
            }

            NetworkLog.Instance.Log("Total PlaceableObjects: " + placeables.Count, placeables.Count);
            GameCoreInventory.GetInventoryObject();
        }

        // <CreateGameCoreFromCurrentUnityScene>m__0 @0x44BA10
        // (renamed ComparePlaceables_m__0 for valid C#)
        // Comparison<MonoBehaviour>: order by world position (x, then y, then z),
        // ties broken by ToString() (type name for components).
        private static int ComparePlaceables_m__0(MonoBehaviour object1, MonoBehaviour object2)
        {
            if (object1 == object2)
                return 0;

            float x1 = object1.transform.position.x;
            float x2 = object2.transform.position.x;
            if (x1 != x2)
                return x1 < x2 ? -1 : 1;

            float y1 = object1.transform.position.y;
            float y2 = object2.transform.position.y;
            if (y1 != y2)
                return y1 < y2 ? -1 : 1;

            float z1 = object1.transform.position.z;
            float z2 = object2.transform.position.z;
            if (z1 != z2)
                return z1 < z2 ? -1 : 1;

            // Positions equal: compare names. (Shipped code returns -1 for
            // CompareTo <= 0, 1 otherwise — not a strict weak ordering.)
            return object1.ToString().CompareTo(object2.ToString()) < 1 ? -1 : 1;
        }

        // .cctor @0x44BA00 — empty.

        // ------------------------------------------------------------------
        // Serialization / resync
        // ------------------------------------------------------------------

        // SerializeGameState @0x44A990
        public void SerializeGameState(Stream stream)
        {
            using (GZipStream gzip = new GZipStream(stream, CompressionMode.Compress))
            {
                UnitySerializationSelector.formatterInstance.Serialize(gzip, m_gameCore.currentFrame);
            }
        }

        // DeserializeGameState @0x44AB10
        public void DeserializeGameState(Stream stream)
        {
            GameCoreFrame frame;
            using (GZipStream gzip = new GZipStream(stream, CompressionMode.Decompress))
            {
                frame = UnitySerializationSelector.formatterInstance.Deserialize(gzip) as GameCoreFrame;
            }
            if (frame != null)
            {
                m_gameCore.InstallFrame(frame);     // swap frame, bump handle cache tag, re-init grid
                ResyncUnityWorldToGameCore();
                updateCount = 0;
                firstUpdateTime = Time.timeSinceLevelLoad;
            }
        }

        // ResyncUnityWorldToGameCore @0x44ACF0
        // Rebuilds the Unity side from the current frame: every live core object
        // recreates its viewer; stale viewers are destroyed; the maps are rebuilt.
        public void ResyncUnityWorldToGameCore()
        {
            HashSet<GameCoreHandle> liveHandles = new HashSet<GameCoreHandle>();
            foreach (GameCoreObject obj in m_gameCore.currentFrame.AllObjects<GameCoreObject>())
            {
                liveHandles.Add(obj.handle);
                GameCoreHandle.EnsureNextHandleIsGreaterThan(obj.handle);
            }

            Dictionary<GameCoreHandle, GameObject> newViews = new Dictionary<GameCoreHandle, GameObject>();
            HashSet<GameObject> recreatedViews = new HashSet<GameObject>();
            foreach (GameCoreHandle handle in liveHandles)
            {
                GameCoreObject obj = handle.GetMostRecentObjectVersion<GameCoreObject>();
                GameObject view = obj.RecreateViewer();               // virtual slot 5 (vtable +0x160)
                newViews.Add(handle, view);
                recreatedViews.Add(view);
            }

            foreach (GameCoreHandle handle in liveHandles)
            {
                GameObject newView = newViews[handle];
                GameObject oldView;
                if (m_gameCoreToUnityMap.TryGetValue(handle, out oldView))
                {
                    if (!recreatedViews.Contains(oldView))
                        UnityEngine.Object.Destroy(oldView);
                }
                m_gameCoreToUnityMap[handle] = newView;
                if (newView != null)
                    m_unityToGameCoreMap[newView] = handle;
            }

            // Destroy Unity objects whose core handle no longer exists.
            foreach (GameObject go in new List<GameObject>(m_unityToGameCoreMap.Keys))
            {
                GameCoreHandle handle = m_unityToGameCoreMap[go];
                if (!liveHandles.Contains(handle))
                {
                    m_unityToGameCoreMap.Remove(go);
                    UnityEngine.Object.Destroy(go);
                }
            }

            UnityEvents.resyncedEvent.Invoke();
            GC.Collect();
        }

        // ------------------------------------------------------------------
        // Viewer pausing
        // ------------------------------------------------------------------

        // SetViewersPaused<T> @0x33FF70 (generic shared; instantiations
        // <EnemyBase> and <TowerBase> confirmed). INFERRED constraint: the body
        // sets Behaviour.enabled on each T, so T : Behaviour.
        private static void SetViewersPaused<T>(bool paused, GameObject root) where T : Behaviour
        {
            float animatorSpeed = paused ? 0.0f : 1.0f;                 // 1.0f @0x00B7A218
            foreach (T viewer in root.GetComponentsInChildren<T>(true))
            {
                viewer.enabled = !paused;
                foreach (Animator animator in viewer.GetComponentsInChildren<Animator>(true))
                    animator.speed = animatorSpeed;
                foreach (ParticleGroup particles in viewer.GetComponentsInChildren<ParticleGroup>(true))
                    particles.enabled = !paused;
            }
        }
    }
}