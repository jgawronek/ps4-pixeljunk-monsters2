// GameCore/GameCoreObject.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Base class of every simulated entity (enemy, tower, fruit, coin, buff, player,
// wave manager, home, ...). Owns a stable GameCoreHandle, a position (+ previous
// tick position for render interpolation), a Cylinder collision volume, and a
// destroyed flag. Logic from Ghidra decompilation (RVA 0x4AB7F0..0x4BEF30).
//
// Field offsets from global-metadata.dat (TypeDefIndex 2990). Virtual slots:
// RecreateViewer=5, DestroySelf=6, Tick=7, Clone=8; ToString=3, Equals(T)=4.

namespace GameCore
{
    public class GameCoreObject : System.IEquatable<GameCoreObject>
    {
        private string m_typeName;                  // 0x10
        private bool destroyed;                     // 0x18
        private UnityEngine.Vector3 m_position;     // 0x1C
        private UnityEngine.Vector3 m_previousTickPosition; // 0x28
        private Cylinder m_collision;               // 0x34
        public GameCoreHandle handle;               // 0x40 (32-byte struct)

        // .ctor @0x4AB7F0
        // Registers the new object with the live frame and the collision grid. If
        // there is no GameCore instance yet (e.g. during deserialization) the object
        // is left unregistered and handle-less.
        public GameCoreObject()
        {
            if (GameCore.Instance == null)
                return;

            handle = GameCoreHandle.CreateHandle();
            collision = new Cylinder(0.5f, 0.5f);   // default volume (literal 0x00B7C250 = 0.5)
            position = UnityEngine.Vector3.zero;
            GameCore.Instance.currentFrame.AddObject(this);
        }

        // get_typeName @0x4BA200
        public string typeName
        {
            get
            {
                if (m_typeName == null)
                    m_typeName = GetType().Name;
                return m_typeName;
            }
        }

        // get_collision @0x4AC4B0 / set_collision @0x4AE350
        public Cylinder collision
        {
            get { return m_collision; }
            set
            {
                m_collision = value;
                if (!destroyed)
                    GameCore.Instance.collisionManager.UpdateCoreObject(this);
            }
        }

        // get_position @0x4ABA80 / set_position @0x4ABA30
        // Moving an object re-buckets it in the collision grid.
        public UnityEngine.Vector3 position
        {
            get { return m_position; }
            set
            {
                m_position = value;
                if (!destroyed)
                    GameCore.Instance.collisionManager.UpdateCoreObject(this);
            }
        }

        // get_previousTickPosition @0x4B91E0
        public UnityEngine.Vector3 previousTickPosition
        {
            get { return m_previousTickPosition; }
        }

        // get_gameCore @0x4BEBE0
        public GameCore gameCore
        {
            get { return GameCore.Instance; }
        }

        // IsDestroyed @0x4AC4A0
        public bool IsDestroyed()
        {
            return destroyed;
        }

        // DestroySelf @0x4AF6C0 (virtual slot 6)
        // Marks destroyed and removes from the grid; the object stays in the frame's
        // lists until the next CreateFrameCopyForUpdate sweep.
        public virtual void DestroySelf()
        {
            destroyed = true;
            GameCore.Instance.collisionManager.RemoveCoreObject(this);
        }

        // Tick @0x4ABAA0 (virtual slot 7) — base is a no-op.
        public virtual void Tick() { }

        // PretickUpdatePreviousTickPosition @0x4B5760
        // Snapshots position before the tick so the view can interpolate.
        public void PretickUpdatePreviousTickPosition()
        {
            m_previousTickPosition = m_position;
        }

        // RecreateViewer @0x4BEBF0 (virtual slot 5) — base returns null.
        public virtual UnityEngine.GameObject RecreateViewer()
        {
            return null;
        }

        // CreateViewerFromPrefabName<T> (generic; e.g. <TowerBase> @0x2C6480)
        // Finds a loaded object of type T whose name matches, then instantiates it.
        // INFERRED: the exact Unity search/instantiate APIs (rgctx-driven) and the
        // T : Object constraint — the shape (search all loaded T by name, instantiate
        // the match, else null) is confirmed from the pseudocode.
        protected static T CreateViewerFromPrefabName<T>(string name) where T : UnityEngine.Object
        {
            // TODO: confirm search API (Resources.FindObjectsOfTypeAll<T> vs Object.FindObjectsOfType<T>).
            T[] all = UnityEngine.Resources.FindObjectsOfTypeAll<T>();
            if (all == null)
                return null;
            foreach (T obj in all)
            {
                if (obj == null)
                    continue;
                if (obj.name == name)
                    return UnityEngine.Object.Instantiate(obj);   // TODO: confirm Instantiate overload
            }
            return null;
        }

        // GetUnityObject @0x4AF040
        public UnityEngine.GameObject GetUnityObject()
        {
            return handle.GetUnityObject();
        }

        // GetUnityObject<T> (generic; e.g. <Structure> @0x2C65C0)
        public T GetUnityObject<T>()
        {
            return handle.GetUnityObject<T>();
        }

        // RandomRange @0x4B2A10 (float)
        // Single-player is just UnityEngine.Random.Range. The handle is used only to
        // key a NetworkLog entry in online matches (out of scope); randomness is NOT
        // handle-seeded in single-player (corrects the blueprint's inference).
        public static float RandomRange(float min, float max, GameCoreHandle handle)
        {
            float result = UnityEngine.Random.Range(min, max);
            // Online (skipped): NetworkLog.Instance.Log(handle.ToString(), (int)result, 1);
            return result;
        }

        // RandomRange @0x4BEC00 (int)
        public static int RandomRange(int min, int max, GameCoreHandle handle)
        {
            int result = UnityEngine.Random.Range(min, max);
            // Online (skipped): NetworkLog.Instance.Log(handle.ToString(), result, 1);
            return result;
        }

        // Clone @0x4BECD0 (virtual slot 8)
        public virtual GameCoreObject Clone()
        {
            return CoreObjectPool.AllocateDeepCopy(this) as GameCoreObject;
        }

        // ToString @0x4BED70 (slot 3) — literals " (" and ")" confirmed.
        public override string ToString()
        {
            return string.Concat(GetType().Name, " (", handle.m_handle.ToString(), ")");
        }

        // Equals @0x4BEF30 (slot 4, IEquatable) — compares handle ids.
        // Throws NullReferenceException if other is null (matches shipped behavior).
        public bool Equals(GameCoreObject other)
        {
            return handle.m_handle == other.handle.m_handle;
        }
    }
}
