// GameCore/StateMachine.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
// Generic simulation-side state machine. The owner is the machine itself
// (TOwner = the StateMachine subclass; get_m_owner is a castclass of `this`).
// Shared-generic bodies decompiled from:
//   StateMachine<object>              @0x770C50..0x770E50
//   StateMachine<TikimanStateMachine> @0x354650..0x771010 (ctor, commands, Is*State)
//   StateMachine<TowerStateMachine>   @0x770D70 (TickState) / 0x770E40 (PreTickState)
//   State<TikimanStateMachine>        @0x770BA0 (ctor) / 0x770BE0 (Enter) / 0x770BF0 (Exit)
// Field offsets: State — stateTime 0x10, blocking 0x14, priority 0x18, duration 0x1C
// (skeleton collapsed them to 0x0; offsets recovered from the decompiled accesses).
// StateMachine — m_defaultState 0x10, m_lastState 0x18, m_currentState 0x20,
// m_nextState 0x28, m_nextNextState 0x30.

namespace GameCore
{
    // TypeDefIndex: 3375
    public abstract class State<TOwner>
    {
        public float stateTime;    // 0x10 — reset to 0 on enter; accumulates dt
        public bool blocking;      // 0x14 — while true, SetCurrentCommand defers
        public int priority;       // 0x18 — higher-priority commands preempt
        public float duration;     // 0x1C — stateTime >= duration → transition

        // .ctor @0x770BA0
        public State(float aDuration)
        {
            duration = aDuration;
        }

        // Enter @0x770BE0 — base is a no-op.
        public virtual void Enter(TOwner owner) { }

        // Tick — abstract (no shared State<T>.Tick body exists; every concrete
        // state overrides). Return value is IGNORED by StateMachine.TickState —
        // transitions are driven purely by stateTime vs duration.
        public abstract bool Tick(TOwner owner, float dt);

        // Exit @0x770BF0 — base is a no-op.
        public virtual void Exit(TOwner owner) { }
    }

    // TypeDefIndex: 3376
    public abstract class StateMachine<TOwner>
    {
        [CoreObjectPool.DeepCopyAttribute]
        private State<TOwner> m_defaultState;     // 0x10
        [CoreObjectPool.DeepCopyAttribute]
        private State<TOwner> m_lastState;        // 0x18
        [CoreObjectPool.DeepCopyAttribute]
        private State<TOwner> m_currentState;     // 0x20
        [CoreObjectPool.DeepCopyAttribute]
        private State<TOwner> m_nextState;        // 0x28
        [CoreObjectPool.DeepCopyAttribute]
        private State<TOwner> m_nextNextState;    // 0x30

        // .ctor @0x770C00
        public StateMachine(State<TOwner> defaultState)
        {
            m_defaultState = defaultState;
            m_lastState = null;
            m_currentState = null;
            m_nextState = null;
            m_nextNextState = null;
        }

        // get_CurrentState @0x770C40
        public State<TOwner> CurrentState
        {
            get { return m_currentState; }
        }

        // get_NextState @0x770C50
        public State<TOwner> NextState
        {
            get { return m_nextState; }
        }

        // get_m_owner @0x770C60 — the machine IS its own owner: the IL2CPP body
        // is a castclass of `this` to TOwner (hence StateMachine<Self> subclasses).
        private TOwner m_owner
        {
            get { return (TOwner)(object)this; }
        }

        // GetCurrentState @0x770D60
        public State<TOwner> GetCurrentState()
        {
            return m_currentState;
        }

        // IsStateRunning<TState> @0x354650 (shared body)
        public bool IsStateRunning<TState>()
        {
            return m_currentState is TState;
        }

        // IsStateRunningOrPending<TState> @0x354680 (shared body)
        public bool IsStateRunningOrPending<TState>()
        {
            return m_currentState is TState || m_nextState is TState;
        }

        // TickState @0x770D70 (virtual slot 4)
        // Advances the running state; when it expires (stateTime >= duration) or
        // no state is running, force-transitions to the pending next state
        // (null next → default state). NOTE: State.Tick's bool return is
        // discarded by the machine — faithful to the binary.
        public virtual void TickState(float dt)
        {
            PreTickState(dt);

            State<TOwner> state = m_currentState;
            if (state != null)
            {
                state.stateTime += dt;
                state.Tick(m_owner, dt);
                // Re-read: Tick may have forced a transition mid-frame.
                state = m_currentState;
                if (state != null && state.stateTime < state.duration)
                    return;
            }
            InternalForceCurrentCommand(m_nextState);
        }

        // PreTickState @0x770E40 (virtual slot 5) — base is a no-op.
        protected virtual void PreTickState(float dt) { }

        // StatePreEnter (virtual slot 6, abstract).
        public abstract void StatePreEnter(State<TOwner> state);

        // StatePostExit (virtual slot 7, abstract).
        public abstract void StatePostExit(State<TOwner> state);

        // InternalForceCurrentCommand @0x770E50
        // Immediate transition: exit the old state (hook + Exit), enter the new
        // one (PreEnter hook + Enter), reset its clock, and consume the pending
        // next-next state into next.
        private void InternalForceCurrentCommand(State<TOwner> state)
        {
            if (m_currentState != null)
            {
                m_currentState.Exit(m_owner);
                StatePostExit(m_currentState);
                m_lastState = m_currentState;
            }
            if (state == null)
                state = m_defaultState;
            m_currentState = state;
            StatePreEnter(state);
            m_currentState.Enter(m_owner);
            m_currentState.stateTime = 0f;
            m_nextState = m_nextNextState;
            m_nextNextState = null;
        }

        // ForceCurrentCommand @0x770F40
        // Discards the pending next state (post-exit hook on it) and forces
        // `state` now; `state_next` becomes the new pending next state.
        public void ForceCurrentCommand(State<TOwner> state, State<TOwner> state_next)
        {
            if (m_nextState != null)
                StatePostExit(m_nextState);
            InternalForceCurrentCommand(state);
            m_nextState = state_next;
        }

        // SetCurrentCommand @0x770FA0
        // Requests a transition NOW if allowed: no current state, or the current
        // state is non-blocking and the new state's priority is >= its priority.
        // Otherwise queues it as the next state (and state_next as next-next).
        public void SetCurrentCommand(State<TOwner> state, State<TOwner> state_next)
        {
            State<TOwner> cur = m_currentState;
            if (cur == null || (!cur.blocking && cur.priority <= state.priority))
            {
                InternalForceCurrentCommand(state);
                return;
            }
            SetNextCommand(state);
            m_nextNextState = state_next;
        }

        // SetNextCommand @0x771010
        public void SetNextCommand(State<TOwner> command)
        {
            m_nextState = command;
            m_nextNextState = null;
        }
    }
}
