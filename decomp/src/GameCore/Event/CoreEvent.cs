// GameCore/Event/CoreEvent.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// The concrete event types raised by the simulation. CoreEvent (no payload) and
// CoreEvent<T1..T4> (typed payload). Immediate listeners fire inside Invoke();
// PostGameCoreTick / PostUnityUpdate listeners are replayed later by CoreEventBase.
// Logic from Ghidra decompilation (non-generic RVA 0x945180..0x945630; generic
// bodies shared across instantiations, e.g. CoreEvent<GameCoreHandle,bool>
// Invoke @0x8D1390, DoPendingPostGameCoreTickEvents @0x8D1710).
//
// The Callback delegates and EventData structs are nested in the NON-generic
// CoreEvent (metadata names them CoreEvent.Callback<T1> etc.); the generic
// CoreEvent<T1..T4> classes reference them.

namespace GameCore.Event
{
    // ---- no-payload event ----------------------------------------------------
    public class CoreEvent : CoreEventShim<CoreEvent.Callback, CoreEvent.EventData>
    {
        private int unityInvokeCount;   // 0x48
        private int coreInvokeCount;    // 0x4C

        // .ctor @0x945180
        public CoreEvent() { }

        // Invoke @0x9451C0
        public void Invoke()
        {
            unityInvokeCount++;
            coreInvokeCount++;
            foreach (var kv in listeners)
                if (kv.Value == EventTime.Immediate)
                    kv.Key();
            NotifyInvoked();
        }

        // DoPendingPostGameCoreTickEvents @0x945470 (slot 6)
        protected override void DoPendingPostGameCoreTickEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostGameCoreTick && coreInvokeCount > 0)
                {
                    for (int i = 0; i < coreInvokeCount; i++)
                        kv.Key();
                }
            }
            coreInvokeCount = 0;
        }

        // DoPendingPostUnityUpdateEvents @0x945630 (slot 7)
        protected override void DoPendingPostUnityUpdateEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostUnityUpdate && unityInvokeCount > 0)
                {
                    for (int i = 0; i < unityInvokeCount; i++)
                        kv.Key();
                }
            }
            unityInvokeCount = 0;
        }

        // Nested payload-less callback / data (TypeDefIndex 2899 / 2900).
        public delegate void Callback();
        public struct EventData { }

        // ---- generic payload callbacks / data (nested in non-generic CoreEvent)
        public delegate void Callback<T1>(T1 value1);
        public struct EventData<T1> { public T1 value1; }

        public delegate void Callback<T1, T2>(T1 value1, T2 value2);
        public struct EventData<T1, T2> { public T1 value1; public T2 value2; }

        public delegate void Callback<T1, T2, T3>(T1 value1, T2 value2, T3 value3);
        public struct EventData<T1, T2, T3> { public T1 value1; public T2 value2; public T3 value3; }

        public delegate void Callback<T1, T2, T3, T4>(T1 value1, T2 value2, T3 value3, T4 value4);
        public struct EventData<T1, T2, T3, T4> { public T1 value1; public T2 value2; public T3 value3; public T4 value4; }
    }

    // ---- one-argument event --------------------------------------------------
    public class CoreEvent<T1> : CoreEventShim<CoreEvent.Callback<T1>, CoreEvent.EventData<T1>>
    {
        private int postGameCoreUpdatePostedDataCount;   // 0x48

        public CoreEvent() { }

        // Invoke (generic; e.g. CoreEvent<GameCoreObject>.Invoke @0x8D0170)
        public void Invoke(T1 value1)
        {
            eventData.Add(new CoreEvent.EventData<T1> { value1 = value1 });
            foreach (var kv in listeners)
                if (kv.Value == EventTime.Immediate)
                    kv.Key(value1);
            NotifyInvoked();
        }

        // DoPendingPostGameCoreTickEvents (generic; e.g. @0x8D0410, slot 6)
        // Replays only the data appended since the last post-tick pass.
        protected override void DoPendingPostGameCoreTickEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostGameCoreTick)
                {
                    for (int i = postGameCoreUpdatePostedDataCount; i < eventData.Count; i++)
                        kv.Key(eventData[i].value1);
                }
            }
            postGameCoreUpdatePostedDataCount = eventData.Count;
        }

        // DoPendingPostUnityUpdateEvents (generic; e.g. @0x8D0720, slot 7)
        // Replays ALL accumulated data, then clears the buffer.
        protected override void DoPendingPostUnityUpdateEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostUnityUpdate)
                {
                    foreach (var data in eventData)
                        kv.Key(data.value1);
                }
            }
            eventData.Clear();
            postGameCoreUpdatePostedDataCount = 0;
        }
    }

    // ---- two-argument event --------------------------------------------------
    public class CoreEvent<T1, T2> : CoreEventShim<CoreEvent.Callback<T1, T2>, CoreEvent.EventData<T1, T2>>
    {
        private int postGameCoreUpdatePostedDataCount;   // 0x48

        public CoreEvent() { }

        // Invoke (generic; e.g. CoreEvent<GameCoreHandle,bool>.Invoke @0x8D1390)
        public void Invoke(T1 value1, T2 value2)
        {
            eventData.Add(new CoreEvent.EventData<T1, T2> { value1 = value1, value2 = value2 });
            foreach (var kv in listeners)
                if (kv.Value == EventTime.Immediate)
                    kv.Key(value1, value2);
            NotifyInvoked();
        }

        // DoPendingPostGameCoreTickEvents (generic; e.g. @0x8D1710, slot 6)
        protected override void DoPendingPostGameCoreTickEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostGameCoreTick)
                {
                    for (int i = postGameCoreUpdatePostedDataCount; i < eventData.Count; i++)
                    {
                        var d = eventData[i];
                        kv.Key(d.value1, d.value2);
                    }
                }
            }
            postGameCoreUpdatePostedDataCount = eventData.Count;
        }

        // DoPendingPostUnityUpdateEvents (generic; e.g. @0x8D1A90, slot 7)
        protected override void DoPendingPostUnityUpdateEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostUnityUpdate)
                {
                    foreach (var d in eventData)
                        kv.Key(d.value1, d.value2);
                }
            }
            eventData.Clear();
            postGameCoreUpdatePostedDataCount = 0;
        }
    }

    // ---- three-argument event ------------------------------------------------
    public class CoreEvent<T1, T2, T3> : CoreEventShim<CoreEvent.Callback<T1, T2, T3>, CoreEvent.EventData<T1, T2, T3>>
    {
        private int postGameCoreUpdatePostedDataCount;   // 0x48

        public CoreEvent() { }

        // Invoke (generic; e.g. CoreEvent<GameCoreTower,GameCoreEnemy,EnemyHitInfo>.Invoke @0x8D8490)
        public void Invoke(T1 value1, T2 value2, T3 value3)
        {
            eventData.Add(new CoreEvent.EventData<T1, T2, T3> { value1 = value1, value2 = value2, value3 = value3 });
            foreach (var kv in listeners)
                if (kv.Value == EventTime.Immediate)
                    kv.Key(value1, value2, value3);
            NotifyInvoked();
        }

        // DoPendingPostGameCoreTickEvents (generic; e.g. @0x8D8880, slot 6)
        protected override void DoPendingPostGameCoreTickEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostGameCoreTick)
                {
                    for (int i = postGameCoreUpdatePostedDataCount; i < eventData.Count; i++)
                    {
                        var d = eventData[i];
                        kv.Key(d.value1, d.value2, d.value3);
                    }
                }
            }
            postGameCoreUpdatePostedDataCount = eventData.Count;
        }

        // DoPendingPostUnityUpdateEvents (generic; e.g. @0x8D8C90, slot 7)
        protected override void DoPendingPostUnityUpdateEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostUnityUpdate)
                {
                    foreach (var d in eventData)
                        kv.Key(d.value1, d.value2, d.value3);
                }
            }
            eventData.Clear();
            postGameCoreUpdatePostedDataCount = 0;
        }
    }

    // ---- four-argument event -------------------------------------------------
    public class CoreEvent<T1, T2, T3, T4> : CoreEventShim<CoreEvent.Callback<T1, T2, T3, T4>, CoreEvent.EventData<T1, T2, T3, T4>>
    {
        private int postGameCoreUpdatePostedDataCount;   // 0x48

        public CoreEvent() { }

        // Invoke (generic; e.g. CoreEvent<GameCoreHandle,float,float,float>.Invoke @0x8DE700)
        public void Invoke(T1 value1, T2 value2, T3 value3, T4 value4)
        {
            eventData.Add(new CoreEvent.EventData<T1, T2, T3, T4> { value1 = value1, value2 = value2, value3 = value3, value4 = value4 });
            foreach (var kv in listeners)
                if (kv.Value == EventTime.Immediate)
                    kv.Key(value1, value2, value3, value4);
            NotifyInvoked();
        }

        // DoPendingPostGameCoreTickEvents (generic; e.g. @0x8DEAC0, slot 6)
        protected override void DoPendingPostGameCoreTickEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostGameCoreTick)
                {
                    for (int i = postGameCoreUpdatePostedDataCount; i < eventData.Count; i++)
                    {
                        var d = eventData[i];
                        kv.Key(d.value1, d.value2, d.value3, d.value4);
                    }
                }
            }
            postGameCoreUpdatePostedDataCount = eventData.Count;
        }

        // DoPendingPostUnityUpdateEvents (generic; e.g. @0x8DEE70, slot 7)
        protected override void DoPendingPostUnityUpdateEvents()
        {
            foreach (var kv in listeners)
            {
                if (kv.Value == EventTime.PostUnityUpdate)
                {
                    foreach (var d in eventData)
                        kv.Key(d.value1, d.value2, d.value3, d.value4);
                }
            }
            eventData.Clear();
            postGameCoreUpdatePostedDataCount = 0;
        }
    }
}
