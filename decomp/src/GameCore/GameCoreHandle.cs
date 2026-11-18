// GameCore/GameCoreHandle.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Lightweight struct identity for a GameCoreObject. The int m_handle is the stable
// key; the struct also caches the resolved GameCoreObject and its Unity viewer,
// tagged with the static s_cacheTag so caches invalidate when a new frame is
// installed. Logic from Ghidra decompilation (RVA 0x4AA560..0x4BA260, plus shared
// generic bodies FUN_002C61C0 / FUN_002C63D0 / FUN_004B9C80 / FUN_004BA0A0).
//
// Instance field offsets are the true in-struct offsets (skeleton). The decompiler
// adds a 0x10 header bias to `this`; shared bodies receive the raw struct pointer.
// Struct size = 0x20 (32 bytes), confirmed by the 32-byte zero/init in the ctors.

namespace GameCore
{
    public struct GameCoreHandle : System.IEquatable<GameCoreHandle>
    {
        private static int s_nextHandle;   // statics +0x0
        private static int s_cacheTag;     // statics +0x4

        // Auto-property <m_handle>k__BackingField
        public int m_handle { get; private set; }   // 0x0
        private UnityEngine.GameObject m_cachedViewer;      // 0x8
        private GameCoreObject m_cachedGameObject;          // 0x10
        private int m_cacheTag;                             // 0x18

        // .cctor @0x4BA260
        static GameCoreHandle()
        {
            s_cacheTag = 100;
        }

        // .ctor @0x4B9A70 (private)
        private GameCoreHandle(int handle)
        {
            m_cachedViewer = null;
            m_cachedGameObject = null;
            m_cacheTag = 0;
            m_handle = handle;
        }

        // get_isNull @0x4B9B10 — sign-bit test: any negative id is "null".
        public bool isNull
        {
            get { return m_handle < 0; }
        }

        // get_nullHandle @0x4AD070
        public static GameCoreHandle nullHandle
        {
            get { return new GameCoreHandle(-1); }
        }

        // CreateHandle @0x4B9BA0
        public static GameCoreHandle CreateHandle(int handle = -1)
        {
            if (handle < 0)
            {
                handle = s_nextHandle;
                s_nextHandle = handle + 1;
            }
            return new GameCoreHandle(handle);
        }

        // ResetNextHandleIndex @0x4AA560
        // Single-player: wrap the counter back by 1,000,000 once it exceeds 100,000
        // (constants confirmed from disassembly: cmp 0x186A1, add 0xFFF0BDC0).
        // NOTE: this drives s_nextHandle negative; isNull treats negatives as null,
        // so the wrap is a long-session guard, not a normal-path concern.
        public static void ResetNextHandleIndex()
        {
            // Online branch (out of scope): in a NetworkMatch the counter is seeded
            // from Mathf.Abs(NetworkMatch.Instance.<field 0x60> % 100000).
            if (s_nextHandle > 100000)
                s_nextHandle -= 1000000;
        }

        // EnsureNextHandleIsGreaterThan @0x4B9B20
        // Used on load/resync so restored handles never collide with new ones.
        public static void EnsureNextHandleIsGreaterThan(GameCoreHandle handle)
        {
            s_nextHandle = System.Math.Max(s_nextHandle, handle.m_handle + 1);
        }

        // InvalidateAllCachedData @0x4AB0D0
        public static void InvalidateAllCachedData()
        {
            s_cacheTag++;
        }

        // GetMostRecentObjectVersion<T> @0x2C63C0 (shared body FUN_002C61C0)
        // Resolves this handle against the CURRENT frame, caching the base object
        // and tagging it. Returns null if unresolved or destroyed; otherwise casts
        // to T (throws InvalidCastException if the object is not a T).
        public T GetMostRecentObjectVersion<T>()
        {
            if (m_cachedGameObject == null || m_cacheTag != s_cacheTag)
            {
                m_cachedGameObject = GameCore.Instance.currentFrame.GetObject<GameCoreObject>(this);
                m_cacheTag = s_cacheTag;
            }
            if (m_cachedGameObject == null || m_cachedGameObject.IsDestroyed())
                return default(T);
            return (T)(object)m_cachedGameObject;
        }

        // GetUnityObject @0x4B9DC0 (shared body FUN_004B9C80)
        // Returns the cached viewer if still valid, else asks the bridge to map this
        // handle to its GameObject. Does NOT refresh m_cacheTag (only the object
        // cache above does), so the viewer re-resolves after a tag bump.
        public UnityEngine.GameObject GetUnityObject()
        {
            if (m_cachedViewer != null && m_cacheTag == s_cacheTag)
                return m_cachedViewer;

            UnityEngine.GameObject result = null;
            Q4.GameCoreBridge bridge = Q4.GameCoreBridge.Instance;
            if (bridge != null)
                result = bridge.GetUnityObject(this);
            m_cachedViewer = result;
            return result;
        }

        // GetUnityObject<T> @0x2C6470 (shared body FUN_002C63D0)
        public T GetUnityObject<T>()
        {
            UnityEngine.GameObject go = GetUnityObject();
            if (go == null)
                return default(T);
            return go.GetComponent<T>();
        }

        // op_Equality @0x4B9C70 / op_Inequality @0x4AF210 — compare the int id only.
        public static bool operator ==(GameCoreHandle handle1, GameCoreHandle handle2)
        {
            return handle1.m_handle == handle2.m_handle;
        }
        public static bool operator !=(GameCoreHandle handle1, GameCoreHandle handle2)
        {
            return handle1.m_handle != handle2.m_handle;
        }

        // Equals @0x4B9E50 (slot 0)
        public override bool Equals(object obj)
        {
            if (obj is GameCoreHandle)
                return m_handle == ((GameCoreHandle)obj).m_handle;
            return false;
        }

        // Equals @0x4B9FC0 (slot 4, IEquatable)
        public bool Equals(GameCoreHandle other)
        {
            return m_handle == other.m_handle;
        }

        // GetHashCode @0x4BA060 (slot 2) — int.GetHashCode returns the value.
        public override int GetHashCode()
        {
            return m_handle.GetHashCode();
        }

        // ToString @0x4BA250 (slot 3, shared body FUN_004BA0A0)
        // Format string "GameCoreHandle({0}), {1}" and suffix " Destroyed" are
        // confirmed string literals.
        public override string ToString()
        {
            GetMostRecentObjectVersion<GameCoreObject>();   // refresh the object cache
            GameCoreObject obj = m_cachedGameObject;
            string name = null;
            if (obj != null)
            {
                name = obj.typeName;
                if (obj.IsDestroyed())
                    name = name + " Destroyed";
            }
            return string.Format("GameCoreHandle({0}), {1}", m_handle, name);
        }
    }
}
