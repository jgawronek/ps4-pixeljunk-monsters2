// src/view/characters/AnimatorRuntime.ts
// Minimal, data-driven evaluator for the serialized Unity AnimatorControllers of
// the tower prefabs (extracted by tools/assets/extract_tower_view_data.py).
//
// It reproduces the Unity Animator state-machine semantics the towers rely on:
//   * one current state per layer, starting in the layer's default state;
//   * a transition fires when ALL its conditions hold AND (if it has an exit
//     time) the state's normalized time has reached exitTime; the first
//     transition in serialized order wins;
//   * Trigger parameters are consumed by the transition that used them;
//   * transition duration blends clips (fixed = seconds, else a fraction of the
//     source state length); duration 0 switches instantly.
// Not modelled (absent from the stage-1 towers): blend trees, any-state
// transitions, interruption sources, layer sync. A state with no clip simply
// holds (tower_005 "Idle", tower_012 "blend_muzzle").
//
// Clip PLAYBACK is the host's job (TowerStageView maps layer states onto three
// AnimationActions); this class only decides WHICH state each layer is in.

import type { AnimController, AnimLayer, AnimTransition } from './towerViewTypes';

export interface AnimatorHost {
  /** Length (seconds) of the named AnimationClip, or 0 when unknown. */
  clipLength(clip: string): number;
  /** A layer entered `state`. `prev` is the state it left (null on init). */
  onEnter(layer: number, state: number, prev: number | null, blendSeconds: number, startOffsetSeconds: number): void;
}

const MODE_IF = 1;
const MODE_IF_NOT = 2;
const MODE_GREATER = 3;
const MODE_LESS = 4;
const MODE_EQUALS = 6;
const MODE_NOT_EQUAL = 7;

interface LayerRuntime {
  def: AnimLayer;
  state: number;
  /** Seconds spent in the current state (speed applied). */
  time: number;
  prevNormalized: number;
}

export class AnimatorRuntime {
  private readonly layers: LayerRuntime[];
  private readonly values = new Map<string, number>();
  private readonly types = new Map<string, string>();

  constructor(
    private readonly controller: AnimController,
    private readonly host: AnimatorHost,
  ) {
    for (const p of controller.params) {
      if (p.name === null) continue;
      this.values.set(p.name, 0);
      this.types.set(p.name, p.type);
    }
    this.layers = controller.layers.map((def) => ({ def, state: def.defaultState, time: 0, prevNormalized: 0 }));
    this.layers.forEach((l, i) => this.host.onEnter(i, l.state, null, 0, 0));
  }

  // ---- parameters (Animator.SetBool / SetTrigger / GetBool) ----

  hasParameter(name: string): boolean {
    return this.types.has(name);
  }

  /** Animator.SetBool. On a Trigger-typed parameter (tower_008 "OnReady") Unity
   *  stores the same bit, so true arms the trigger and false clears it. */
  setBool(name: string, value: boolean): void {
    if (this.types.has(name)) this.values.set(name, value ? 1 : 0);
  }

  setTrigger(name: string): void {
    if (this.types.has(name)) this.values.set(name, 1);
  }

  getBool(name: string): boolean {
    return (this.values.get(name) ?? 0) !== 0;
  }

  // ---- state queries (Animator.GetCurrentAnimatorStateInfo(layer)) ----

  currentState(layer: number): number {
    return this.layers[layer].state;
  }

  /** `<LayerName>.<stateName>` — the string Unity hashes for fullPathHash. */
  currentPath(layer: number): string {
    const l = this.layers[layer];
    return `${l.def.name}.${l.def.states[l.state].name}`;
  }

  /** AnimatorStateInfo.loop (0x20) — the state's clip loops. */
  currentLoop(layer: number): boolean {
    const l = this.layers[layer];
    return l.def.states[l.state].loop;
  }

  normalizedTime(layer: number): number {
    const l = this.layers[layer];
    const len = this.stateLength(l.def, l.state);
    return len > 0 ? l.time / len : 0;
  }

  // ---- evaluation ----

  update(dt: number): void {
    this.layers.forEach((l, i) => this.updateLayer(i, l, dt));
  }

  private stateLength(def: AnimLayer, state: number): number {
    const s = def.states[state];
    if (s.clip === null) return 0;
    const len = this.host.clipLength(s.clip);
    return len > 0 && s.speed !== 0 ? len / Math.abs(s.speed) : 0;
  }

  private updateLayer(index: number, l: LayerRuntime, dt: number): void {
    // Unity can chain instantaneous (duration 0) transitions inside one update;
    // cap the chain so a malformed controller cannot spin.
    for (let hops = 0; hops < 4; hops++) {
      const len = this.stateLength(l.def, l.state);
      const before = l.time;
      if (hops === 0) l.time += dt;
      const normalized = len > 0 ? l.time / len : 0;
      const prevNormalized = len > 0 ? before / len : 0;
      const t = this.pickTransition(l, normalized, prevNormalized);
      l.prevNormalized = normalized;
      if (t === null) return;
      this.take(index, l, t, len);
    }
  }

  private pickTransition(l: LayerRuntime, normalized: number, prevNormalized: number): AnimTransition | null {
    const state = l.def.states[l.state];
    for (const t of state.transitions) {
      if (t.exit && !this.exitTimeReached(state.loop, t.exitTime, normalized, prevNormalized)) continue;
      if (!t.conds.every((c) => this.condition(c.param, c.mode, c.threshold))) continue;
      return t;
    }
    return null;
  }

  private exitTimeReached(loop: boolean, exitTime: number, normalized: number, prev: number): boolean {
    if (!loop) return normalized >= exitTime;
    // Looping state: the exit time recurs every loop — fire when its crossing
    // happened between the previous and the current update.
    return Math.floor(normalized - exitTime) > Math.floor(prev - exitTime);
  }

  private condition(param: string | null, mode: number, threshold: number): boolean {
    const v = param === null ? 0 : (this.values.get(param) ?? 0);
    switch (mode) {
      case MODE_IF: return v !== 0;
      case MODE_IF_NOT: return v === 0;
      case MODE_GREATER: return v > threshold;
      case MODE_LESS: return v < threshold;
      case MODE_EQUALS: return v === threshold;
      case MODE_NOT_EQUAL: return v !== threshold;
      default: return false;
    }
  }

  private take(index: number, l: LayerRuntime, t: AnimTransition, sourceLength: number): void {
    // Triggers named in the conditions are consumed by the transition.
    for (const c of t.conds) {
      if (c.param !== null && this.types.get(c.param) === 'trigger') this.values.set(c.param, 0);
    }
    const prev = l.state;
    const blend = t.fixed ? t.duration : t.duration * sourceLength;
    const destLen = this.stateLength(l.def, t.dest);
    const offset = t.offset * destLen;
    l.state = t.dest;
    l.time = offset;
    l.prevNormalized = destLen > 0 ? offset / destLen : 0;
    this.host.onEnter(index, t.dest, prev, Math.max(0, blend), offset);
  }

  /** Test/diagnostic: the controller this runtime evaluates. */
  get definition(): AnimController {
    return this.controller;
  }
}
