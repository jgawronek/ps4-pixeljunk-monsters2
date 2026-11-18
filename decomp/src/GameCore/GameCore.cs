// GameCore/GameCore.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The simulation root. Owns the collision manager and the current GameCoreFrame,
// and drives the fixed-step tick. The singleton is reached through the Unity-side
// Q4.GameCoreBridge (GameCore.Instance == GameCoreBridge.Instance.m_gameCore).
// Logic from Ghidra decompilation (RVA 0x4AA2B0..0x4AB020) + disassembly checks.
//
// Field offsets from global-metadata.dat (TypeDefIndex 2972). Static TickDeltaTime
// lives at statics +0x0. TicksPerSecond = 60 (const, confirmed).

namespace GameCore
{
    public class GameCore
    {
        public const uint TicksPerSecond = 60;

        // Auto-property <TickDeltaTime>k__BackingField (statics +0x0)
        public static float TickDeltaTime { get; private set; }

        private GameCoreCollisionManager m_collisionManager;   // 0x10
        private float lastUpdateTime;                          // 0x18
        private bool m_extremeDesyncTesting;                   // 0x1C
        // Auto-property <currentFrame>k__BackingField
        public GameCoreFrame currentFrame { get; private set; } // 0x20

        // .ctor @0x4AA2B0
        public GameCore()
        {
            m_collisionManager = new GameCoreCollisionManager();
            GameCoreHandle.ResetNextHandleIndex();
            TickDeltaTime = 0.16f;   // literal 0x3E23D70A; Tick() overwrites it each frame
            currentFrame = CoreObjectPool.Allocate<GameCoreFrame>();
            currentFrame.m_frameTime = 0f;

            // Command-line flag "-desynctesting" (literal confirmed) enables extreme
            // desync testing. OR-accumulated over all args, case-insensitive.
            string[] args = System.Environment.GetCommandLineArgs();
            if (args != null)
            {
                foreach (string arg in args)
                    m_extremeDesyncTesting |= arg.ToLower() == "-desynctesting";
            }
        }

        // get_Instance @0x4AA810
        public static GameCore Instance
        {
            get
            {
                Q4.GameCoreBridge bridge = Q4.GameCoreBridge.Instance;
                if (bridge == null)
                    return null;
                return bridge.m_gameCore;
            }
        }

        // get_collisionManager @0x4AA7F0
        public GameCoreCollisionManager collisionManager
        {
            get { return m_collisionManager; }
        }

        // PrepareNextFrame @0x4AA8C0
        // Advances the frame clock and runs the in-place pre-tick pass. The return of
        // CreateFrameCopyForUpdate is discarded (it returns the same frame it mutated).
        public void PrepareNextFrame()
        {
            lastUpdateTime += TickDeltaTime;
            currentFrame.CreateFrameCopyForUpdate(lastUpdateTime);
        }

        // Tick @0x4AAB30
        // Single-player: clamp the step to Time.deltaTime (max 0.5s), tick all objects,
        // then fire post-tick events. Online matches use a fixed 1/60 step (skipped).
        public void Tick()
        {
            // Online (skipped): if (NetworkMatch.IsNetworkMatch) TickDeltaTime = 1f/60f;
            TickDeltaTime = UnityEngine.Mathf.Min(UnityEngine.Time.deltaTime, 0.5f);

            currentFrame.TickAllObjects(false);
            Event.CoreEventBase.InvokePendingPostGameCoreTickEvents();

            // Determinism frame-log (present single-player; Instance may be null).
            if (Network.NetworkLog.Instance != null)
                Network.NetworkLog.Instance.EndLogFrame();
        }

        // InstallFrame @0x4AB020
        // Swaps in a (re)built frame, invalidates all handle caches, re-inits the grid.
        public void InstallFrame(GameCoreFrame frame)
        {
            currentFrame = frame;
            GameCoreHandle.InvalidateAllCachedData();
            collisionManager.Init();
        }

        // FirstObject<T> (generic; e.g. <GameCoreHome> @0x2C5DC0)
        public T FirstObject<T>()
        {
            return currentFrame.FirstObject<T>();
        }

        // AllObjects<T> (generic iterator; wrapper MoveNext @0x76F590)
        public System.Collections.Generic.IEnumerable<T> AllObjects<T>()
        {
            foreach (T obj in currentFrame.AllObjects<T>())
                yield return obj;
        }

        // AllObjects<T>(Vector3, Cylinder) (generic iterator; wrapper MoveNext @0x76FAD0)
        // Spatial query delegating to the collision grid.
        public System.Collections.Generic.IEnumerable<T> AllObjects<T>(UnityEngine.Vector3 a_pos, Cylinder a_cylinder)
        {
            if (collisionManager == null)
                yield break;
            foreach (T obj in collisionManager.IntersectingObjects<T>(a_pos, a_cylinder.radius, a_cylinder.height))
                yield return obj;
        }
    }
}
