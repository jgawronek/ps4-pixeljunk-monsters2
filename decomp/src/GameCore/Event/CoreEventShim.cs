// GameCore/Event/CoreEventShim.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Generic listener bookkeeping shared by CoreEvent and CoreEvent<T1..T4>.
// Holds the sorted listener table, per-GameCoreObject listener index, and the
// add/remove queues used while an event is being dispatched. Logic from Ghidra
// decompilation of the CoreEventShim<object, CoreEvent.EventData> instantiation
// (RVA 0x8E5FE0..0x8E6880); all instantiations share this body.
//
// Field offsets confirmed from the .ctor stores (the skeleton lists them as 0x0
// because they are generic-instance fields).

namespace GameCore.Event
{
    public abstract class CoreEventShim<CallbackType, EventDataType> : CoreEventBase
    {
        private System.Collections.Generic.Dictionary<GameCoreHandle, CallbackType> coreObjectListeners; // 0x18
        protected System.Collections.Generic.SortedDictionary<CallbackType, EventTime> listeners;        // 0x20
        protected System.Collections.Generic.List<EventDataType> eventData;                              // 0x28
        private bool processingEvents;                                                                   // 0x30
        private System.Collections.Generic.Dictionary<CallbackType, EventTime> pendingAddedListeners;    // 0x38
        private System.Collections.Generic.List<CallbackType> pendingRemovedListeners;                   // 0x40

        // .ctor (generic; e.g. CoreEventShim<CoreEvent.Callback, CoreEvent.EventData> @0x8E5FE0)
        protected CoreEventShim()
        {
            coreObjectListeners = new System.Collections.Generic.Dictionary<GameCoreHandle, CallbackType>();
            listeners = new System.Collections.Generic.SortedDictionary<CallbackType, EventTime>(new ListenerSorter());
            eventData = new System.Collections.Generic.List<EventDataType>();
            pendingAddedListeners = new System.Collections.Generic.Dictionary<CallbackType, EventTime>();
            pendingRemovedListeners = new System.Collections.Generic.List<CallbackType>();
        }

        // AddListener (generic; e.g. @0x8E61B0)
        public void AddListener(CallbackType callback, EventTime callbackTime)
        {
            if (processingEvents)
            {
                // Queue the change; applied after dispatch finishes.
                pendingAddedListeners[callback] = callbackTime;
                return;
            }

            listeners[callback] = callbackTime;

            // If the callback targets a GameCoreObject, index it by that object's
            // handle so RemoveListener can find the stored delegate later.
            var d = callback as System.Delegate;
            if (d != null)
            {
                var coreObj = d.Target as GameCoreObject;
                if (coreObj != null)
                    coreObjectListeners[coreObj.handle] = callback;
            }
        }

        // RemoveListener (generic; e.g. @0x8E6300)
        public void RemoveListener(CallbackType callback)
        {
            if (processingEvents)
            {
                pendingRemovedListeners.Add(callback);
                return;
            }

            var d = callback as System.Delegate;
            if (d != null)
            {
                var coreObj = d.Target as GameCoreObject;
                if (coreObj != null)
                {
                    CallbackType stored;
                    if (coreObjectListeners.TryGetValue(coreObj.handle, out stored))
                    {
                        coreObjectListeners.Remove(coreObj.handle);
                        callback = stored;   // remove the exact stored delegate
                    }
                }
            }
            listeners.Remove(callback);
        }

        // ApplyPendingListenerChanges (generic; e.g. @0x8E6480)
        // Runs after processingEvents is cleared; flushes the queued adds/removes.
        private void ApplyPendingListenerChanges()
        {
            if (pendingAddedListeners.Count < 1 && pendingRemovedListeners.Count < 1)
                return;

            foreach (var kv in pendingAddedListeners)
                AddListener(kv.Key, kv.Value);

            for (int i = 0; i < pendingRemovedListeners.Count; i++)
                RemoveListener(pendingRemovedListeners[i]);

            pendingAddedListeners.Clear();
            pendingRemovedListeners.Clear();
        }

        // DoPendingPostGameCoreTickEventsWrapper (generic; e.g. @0x8E67C0, slot 4)
        protected override void DoPendingPostGameCoreTickEventsWrapper()
        {
            processingEvents = true;
            DoPendingPostGameCoreTickEvents();   // virtual slot 6 (typed)
            processingEvents = false;
            ApplyPendingListenerChanges();
        }

        // DoPendingPostUnityUpdateEventsWrapper (generic; e.g. @0x8E6820, slot 5)
        protected override void DoPendingPostUnityUpdateEventsWrapper()
        {
            processingEvents = true;
            DoPendingPostUnityUpdateEvents();    // virtual slot 7 (typed)
            processingEvents = false;
            ApplyPendingListenerChanges();
        }

        // Slot 6 / 7 — implemented by CoreEvent / CoreEvent<T1..T4>.
        protected abstract void DoPendingPostGameCoreTickEvents();
        protected abstract void DoPendingPostUnityUpdateEvents();

        // ListenerSorter (nested; e.g. Compare @0x8E2630)
        // Deterministic listener ordering: callbacks whose Target is a
        // GameCoreObject sort first, ordered by that object's handle id; all other
        // callbacks sort after, ordered by delegate hash code. This keeps sim
        // listeners firing in a stable, handle-ordered sequence.
        private sealed class ListenerSorter : System.Collections.Generic.IComparer<CallbackType>
        {
            public int Compare(CallbackType x, CallbackType y)
            {
                var dx = x as System.Delegate;
                var dy = y as System.Delegate;
                var tx = dx.Target as GameCoreObject;
                var ty = dy.Target as GameCoreObject;

                if (tx != null && ty != null)
                {
                    if (tx.handle == ty.handle)
                        return 0;
                    return tx.handle.m_handle > ty.handle.m_handle ? 1 : -1;
                }

                if (tx == null && ty == null)
                {
                    int hx = x.GetHashCode();
                    int hy = y.GetHashCode();
                    if (hx == hy) return 0;
                    return hx < hy ? -1 : 1;
                }

                // Exactly one targets a GameCoreObject: it sorts first.
                return tx == null ? 1 : -1;
            }
        }
    }
}
