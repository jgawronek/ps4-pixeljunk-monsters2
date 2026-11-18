// GameCore/GameCoreFrame.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The live world state: a handle->object map, an ordered object list (tick order),
// and a per-Type index for fast typed queries. Logic from Ghidra decompilation
// (RVA 0x4AA720..0x4B59E0, plus generic GetObject/FirstObject/AllObjects bodies).
//
// KEY FINDING: despite its name, CreateFrameCopyForUpdate does NOT copy the frame.
// It mutates this frame in place (snapshots previousTickPosition, sweeps destroyed
// objects) and returns `this`. The normal single-player tick path does not deep-copy
// objects; the deep-copy machinery is used by Clone()/resync, not by the tick.
// (This corrects the blueprint's "copy-on-tick" inference.)
//
// Field offsets from global-metadata.dat (TypeDefIndex 2981).

namespace GameCore
{
    public class GameCoreFrame
    {
        private System.Collections.Generic.Dictionary<GameCoreHandle, GameCoreObject> m_handleMap; // 0x10
        private System.Collections.Generic.List<GameCoreObject> m_gameObjects;                     // 0x18
        private System.Collections.Generic.Dictionary<System.Type, System.Collections.Generic.List<GameCoreObject>> m_typeMap; // 0x20
        public float m_frameTime;                                                                  // 0x28

        // .ctor @0x4B5590
        public GameCoreFrame()
        {
            m_handleMap = new System.Collections.Generic.Dictionary<GameCoreHandle, GameCoreObject>();
            m_gameObjects = new System.Collections.Generic.List<GameCoreObject>();
            m_typeMap = new System.Collections.Generic.Dictionary<System.Type, System.Collections.Generic.List<GameCoreObject>>();
        }

        // AllocateFrame @0x4AA720 (static) — frames themselves are pooled.
        public static GameCoreFrame AllocateFrame(float frameTime)
        {
            GameCoreFrame frame = CoreObjectPool.Allocate<GameCoreFrame>();
            frame.m_frameTime = frameTime;
            return frame;
        }

        // ReturnObjectsToPool @0x4B5640
        public void ReturnObjectsToPool()
        {
            foreach (GameCoreObject obj in m_gameObjects)
                CoreObjectPool.ReturnObject(obj);
            m_handleMap.Clear();
            m_gameObjects.Clear();
            m_typeMap.Clear();
        }

        // CreateFrameCopyForUpdate @0x4AA930
        // In-place pre-tick pass: set the frame time, snapshot each live object's
        // position into previousTickPosition, and swap-remove destroyed objects from
        // the object list and every per-Type index list. Returns this (not a copy).
        public GameCoreFrame CreateFrameCopyForUpdate(float newFrameTime)
        {
            m_frameTime = newFrameTime;
            for (int i = 0; i < m_gameObjects.Count; i++)
            {
                GameCoreObject obj = m_gameObjects[i];
                if (!obj.IsDestroyed())
                {
                    obj.PretickUpdatePreviousTickPosition();
                }
                else
                {
                    // Q4.Extensions swap-back helpers (remove without preserving order).
                    Q4.Extensions.RemoveAtSwapBack(m_gameObjects, i);
                    for (System.Type t = obj.GetType(); t != typeof(GameCoreObject); t = t.BaseType)
                    {
                        System.Collections.Generic.List<GameCoreObject> list;
                        if (m_typeMap.TryGetValue(t, out list))
                            Q4.Extensions.RemoveSwapBack(list, obj);
                    }
                    i--;   // re-process the element swapped into slot i
                }
            }
            return this;
        }

        // TickAllObjects @0x4AAC90
        // Ticks every object in list order. Count is captured up front, so objects
        // added during the tick are not ticked until next frame. The desyncTesting
        // parameter is present in the signature but unused in the shipped body.
        public void TickAllObjects(bool desyncTesting)
        {
            int count = m_gameObjects.Count;
            for (int i = 0; i < count; i++)
                m_gameObjects[i].Tick();   // virtual slot 7
        }

        // AddObject @0x4B5770
        public void AddObject(GameCoreObject coreObject)
        {
            m_gameObjects.Add(coreObject);
            AddToCacheMaps(coreObject);
        }

        // AddToCacheMaps @0x4B57D0
        // Indexes the object by handle and under every Type in its hierarchy down to
        // (but NOT including) GameCoreObject itself.
        private void AddToCacheMaps(GameCoreObject coreObject)
        {
            m_handleMap[coreObject.handle] = coreObject;
            for (System.Type t = coreObject.GetType(); t != typeof(GameCoreObject); t = t.BaseType)
            {
                System.Collections.Generic.List<GameCoreObject> list;
                if (!m_typeMap.TryGetValue(t, out list))
                {
                    list = new System.Collections.Generic.List<GameCoreObject>();
                    m_typeMap[t] = list;
                }
                list.Add(coreObject);
            }
        }

        // OnDeserialized @0x4B59D0 ([OnDeserialized])
        [System.Runtime.Serialization.OnDeserialized]
        private void OnDeserialized(System.Runtime.Serialization.StreamingContext context)
        {
            RebuildCacheMaps();
        }

        // RebuildCacheMaps @0x4B59E0
        private void RebuildCacheMaps()
        {
            m_handleMap = new System.Collections.Generic.Dictionary<GameCoreHandle, GameCoreObject>();
            m_typeMap = new System.Collections.Generic.Dictionary<System.Type, System.Collections.Generic.List<GameCoreObject>>();
            foreach (GameCoreObject obj in m_gameObjects)
                AddToCacheMaps(obj);
        }

        // GetObject<T> (generic; shared body @0x2C6050)
        // handle -> object lookup; returns default if missing or destroyed; otherwise
        // hard-casts to T (throws InvalidCastException on a type mismatch).
        public T GetObject<T>(GameCoreHandle handle)
        {
            GameCoreObject obj;
            if (!m_handleMap.TryGetValue(handle, out obj) || obj == null)
                return default(T);
            if (obj.IsDestroyed())
                return default(T);
            return (T)(object)obj;
        }

        // FirstObject<T> (generic; shared body @0x2C5E00)
        public T FirstObject<T>()
        {
            if (typeof(T) == typeof(GameCoreObject))
            {
                if (m_gameObjects.Count < 1)
                    return default(T);
                return (T)(object)m_gameObjects[0];
            }
            System.Collections.Generic.List<GameCoreObject> list;
            if (m_typeMap.TryGetValue(typeof(T), out list) && list != null && list.Count > 0)
                return (T)(object)list[0];
            return default(T);
        }

        // AllObjects<T> (generic iterator; shared MoveNext @0x770760)
        // Enumerates live (non-destroyed) objects of type T. GameCoreObject is
        // special-cased to the full object list; other types use the per-Type index.
        public System.Collections.Generic.IEnumerable<T> AllObjects<T>()
        {
            System.Collections.Generic.List<GameCoreObject> list;
            if (typeof(T) == typeof(GameCoreObject))
                list = m_gameObjects;
            else
                m_typeMap.TryGetValue(typeof(T), out list);

            if (list == null)
                yield break;

            for (int i = 0; i < list.Count; i++)
            {
                GameCoreObject obj = list[i];
                if (obj.IsDestroyed())
                    continue;
                yield return (T)(object)obj;
            }
        }
    }
}
