// src/core/StateMachine.ts
// TypeScript port of decomp/src/GameCore/StateMachine.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3375/3376;
// shared-generic bodies @0x770BA0..0x771010).
// Generic simulation-side state machine. The owner is the machine itself
// (TOwner = the StateMachine subclass; C# get_m_owner is a castclass of this).
//
// Field offsets: State — stateTime 0x10, blocking 0x14, priority 0x18,
// duration 0x1C. StateMachine — m_defaultState 0x10, m_lastState 0x18,
// m_currentState 0x20, m_nextState 0x28, m_nextNextState 0x30.
//
// TS ADAPTATIONS: IsStateRunning<TState>/IsStateRunningOrPending<TState> take
// the constructor explicitly (typeof(T) → ctor arg); C# `is TState` → instanceof.

const f = Math.fround;

/** C#: State<TOwner> (TypeDefIndex 3375). */
export abstract class State<TOwner> {
  stateTime = f(0); // 0x10 — reset to 0 on enter; accumulates dt
  blocking = false; // 0x14 — while true, SetCurrentCommand defers
  priority = 0; // 0x18 — higher-priority commands preempt
  duration: number; // 0x1C — stateTime >= duration → transition

  // .ctor @0x770BA0
  constructor(aDuration: number) {
    this.duration = f(aDuration);
  }

  // Enter @0x770BE0 — base no-op.
  enter(_owner: TOwner): void {}

  // Tick — abstract. Return value is IGNORED by StateMachine.TickState;
  // transitions are driven purely by stateTime vs duration (faithful).
  abstract tick(owner: TOwner, dt: number): boolean;

  // Exit @0x770BF0 — base no-op.
  exit(_owner: TOwner): void {}
}

/** C#: StateMachine<TOwner> (TypeDefIndex 3376). [DeepCopy] on all state refs. */
export abstract class StateMachine<TOwner> {
  private m_defaultState: State<TOwner>; // 0x10
  private m_lastState: State<TOwner> | null = null; // 0x18
  private m_currentState: State<TOwner> | null = null; // 0x20
  private m_nextState: State<TOwner> | null = null; // 0x28
  private m_nextNextState: State<TOwner> | null = null; // 0x30

  // .ctor @0x770C00
  constructor(defaultState: State<TOwner>) {
    this.m_defaultState = defaultState;
  }

  // get_CurrentState @0x770C40 / get_NextState @0x770C50
  get currentState(): State<TOwner> | null {
    return this.m_currentState;
  }
  get nextState(): State<TOwner> | null {
    return this.m_nextState;
  }

  // get_m_owner @0x770C60 — the machine IS its own owner.
  private get m_owner(): TOwner {
    return this as unknown as TOwner;
  }

  // GetCurrentState @0x770D60
  getCurrentState(): State<TOwner> | null {
    return this.m_currentState;
  }

  // IsStateRunning<TState> @0x354650 (shared body)
  isStateRunning<TState extends State<TOwner>>(ctor: new (...args: never[]) => TState): boolean {
    return this.m_currentState instanceof ctor;
  }

  // IsStateRunningOrPending<TState> @0x354680 (shared body)
  isStateRunningOrPending<TState extends State<TOwner>>(
    ctor: new (...args: never[]) => TState,
  ): boolean {
    return this.m_currentState instanceof ctor || this.m_nextState instanceof ctor;
  }

  // TickState @0x770D70 (virtual slot 4)
  tickState(dt: number): void {
    this.preTickState(dt);

    let state = this.m_currentState;
    if (state !== null) {
      state.stateTime = f(state.stateTime + dt);
      state.tick(this.m_owner, dt); // return value discarded (faithful)
      // Re-read: Tick may have forced a transition mid-frame.
      state = this.m_currentState;
      if (state !== null && state.stateTime < state.duration) return;
    }
    this.internalForceCurrentCommand(this.m_nextState);
  }

  // PreTickState @0x770E40 (virtual slot 5) — base no-op.
  protected preTickState(_dt: number): void {}

  // StatePreEnter (virtual slot 6, abstract) / StatePostExit (slot 7, abstract).
  abstract statePreEnter(state: State<TOwner>): void;
  abstract statePostExit(state: State<TOwner>): void;

  // InternalForceCurrentCommand @0x770E50
  private internalForceCurrentCommand(state: State<TOwner> | null): void {
    if (this.m_currentState !== null) {
      this.m_currentState.exit(this.m_owner);
      this.statePostExit(this.m_currentState);
      this.m_lastState = this.m_currentState;
    }
    if (state === null) state = this.m_defaultState;
    this.m_currentState = state;
    this.statePreEnter(state);
    this.m_currentState.enter(this.m_owner);
    this.m_currentState.stateTime = f(0);
    this.m_nextState = this.m_nextNextState;
    this.m_nextNextState = null;
  }

  // ForceCurrentCommand @0x770F40
  forceCurrentCommand(state: State<TOwner>, state_next: State<TOwner> | null): void {
    if (this.m_nextState !== null) this.statePostExit(this.m_nextState);
    this.internalForceCurrentCommand(state);
    this.m_nextState = state_next;
  }

  // SetCurrentCommand @0x770FA0
  setCurrentCommand(state: State<TOwner>, state_next: State<TOwner> | null): void {
    const cur = this.m_currentState;
    if (cur === null || (!cur.blocking && cur.priority <= state.priority)) {
      this.internalForceCurrentCommand(state);
      return;
    }
    this.setNextCommand(state);
    this.m_nextNextState = state_next;
  }

  // SetNextCommand @0x771010
  setNextCommand(command: State<TOwner> | null): void {
    this.m_nextState = command;
    this.m_nextNextState = null;
  }
}
