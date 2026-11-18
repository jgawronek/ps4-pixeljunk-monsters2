// GameCore/Event/CoreEventBase.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Non-generic base of every core event. Tracks which events were raised this
// frame so their deferred (PostGameCoreTick / PostUnityUpdate) listeners can be
// replayed at the right point in the frame. Logic from Ghidra decompilation of
// GameCore.Event.CoreEventBase methods (RVA 0x9453D0..0x945CF0).
//
// Static-field offsets are relative to the class's static_fields block.

namespace GameCore.Event
{
    public abstract class CoreEventBase
    {
        private static System.Collections.Generic.HashSet<CoreEventBase> pendingInvokedEvents;    // statics +0x0
        private static System.Collections.Generic.HashSet<CoreEventBase> pendingUnityEvents;      // statics +0x8
        private static System.Collections.Generic.HashSet<CoreEventBase> processingInvokedEvents; // statics +0x10

        private string m_cachedTypeName;   // 0x10

        // .cctor @0x945CF0
        static CoreEventBase()
        {
            pendingInvokedEvents = new System.Collections.Generic.HashSet<CoreEventBase>();
            pendingUnityEvents = new System.Collections.Generic.HashSet<CoreEventBase>();
            processingInvokedEvents = new System.Collections.Generic.HashSet<CoreEventBase>();
        }

        // .ctor @0x945870 (base object ctor only)
        protected CoreEventBase() { }

        // get_cachedTypeName @0x945880
        protected string cachedTypeName
        {
            get
            {
                if (m_cachedTypeName == null)
                    m_cachedTypeName = GetType().Name;   // Type.get_Name, vtable slot 8
                return m_cachedTypeName;
            }
        }

        // Finalize @0x9458D0 (virtual slot 1) — empty finalizer, calls base only.
        ~CoreEventBase() { }

        // NotifyInvoked @0x9453D0
        // Called by CoreEvent.Invoke after dispatching Immediate listeners. Marks
        // this event as needing both its post-tick and post-Unity-update replay.
        protected void NotifyInvoked()
        {
            pendingInvokedEvents.Add(this);
            pendingUnityEvents.Add(this);
        }

        // InvokePendingPostGameCoreTickEvents @0x9458E0
        // Drains pendingInvokedEvents. Swaps the pending set with the processing
        // set so events raised *during* processing land in a fresh pending set and
        // are handled on the next loop iteration (avoids modify-while-iterating).
        public static void InvokePendingPostGameCoreTickEvents()
        {
            while (pendingInvokedEvents.Count > 0)
            {
                // swap pending <-> processing
                var tmp = pendingInvokedEvents;
                pendingInvokedEvents = processingInvokedEvents;
                processingInvokedEvents = tmp;

                pendingInvokedEvents.Clear();

                foreach (CoreEventBase e in processingInvokedEvents)
                    e.DoPendingPostGameCoreTickEventsWrapper();   // virtual slot 4
            }
        }

        // InvokePendingPostUnityUpdateEvents @0x945B40
        // Replays every pending Unity event once, then clears the set.
        public static void InvokePendingPostUnityUpdateEvents()
        {
            foreach (CoreEventBase e in pendingUnityEvents)
                e.DoPendingPostUnityUpdateEventsWrapper();        // virtual slot 5
            pendingUnityEvents.Clear();
        }

        // Slot 4 — implemented by CoreEventShim: sets processingEvents, calls the
        // typed DoPendingPostGameCoreTickEvents, then applies queued listener changes.
        protected abstract void DoPendingPostGameCoreTickEventsWrapper();

        // Slot 5 — same for the post-Unity-update pass.
        protected abstract void DoPendingPostUnityUpdateEventsWrapper();
    }
}
