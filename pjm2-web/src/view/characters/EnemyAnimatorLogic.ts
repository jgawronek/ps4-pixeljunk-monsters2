// src/view/characters/EnemyAnimatorLogic.ts
// Data-driven evaluator for the serialized enemy AnimatorControllers
// (enemyViewData.generated.ts). Same semantics as AnimatorRuntime (towers) plus
// what enemy controllers need:
//   * Any-State transitions (Attack / Die / TakeDamage* / Balloon / Drown),
//     evaluated before the current state's own transitions, honouring
//     m_CanTransitionToSelf;
//   * selector nodes (dest >= 30000): sub-state-machine entry/exit nodes whose
//     condition lists pick the real destination (Die -> DieNormal/DieStrong by
//     DeathType, Walk variation by RandomInt, ...);
//   * QGames.RandomIntBehaviour: entering a selector that tests `RandomInt`
//     re-rolls it with Random.Range(0, 2) (serialized m_Min 0 / m_Max 2);
//   * state speed (m_Speed and optional speed parameter), Animator.speed
//     (`speed`, driven by EnemyBase.UpdateFrozen), cycle offset (`cycleOffset`
//     or its parameter; Dead states hold the end of the die clip with
//     speed 0 + cycleOffset 0.99);
//   * 1D blend trees (nested; boss_fat Idle/Move/SpawnMinion/TakeDamage on
//     BossGrounded/BossInjured, boss_ude Loco on BossWalkSpeed/BossDamageWeight),
//     Unity semantics: children sorted by threshold, parameter clamped to the
//     first/last threshold, two neighbouring children share the weight linearly,
//     nested trees multiply, children share ONE normalized time, state duration =
//     weight-averaged clip length;
//   * several layers: layer 0 is the base (its serialized defaultWeight 0 is ignored by
//     Unity), other layers contribute with their defaultWeight unless they are synced
//     copies with weight 0 (kuri layer 1). giant_controller layer 1 is an ADDITIVE layer
//     (blendMode 1, full body mask) holding the Empty/TakeDamageStrong flinch;
//   * cross-fades: every layer keeps its recently left states alive while the new state
//     fades in (poses()), weight_i = alpha_i * prod_{j>i}(1 - alpha_j).
// A state without a motion has no pose (the previous pose is kept) and a duration of 1 s
// (so `Die`/`Dead` of boss_kao_ctrl still exit after 1 normalized time).
// Clip playback is the host's job: it applies `poses()` every frame.

import type { AnimCondition } from './towerViewTypes';
import type { EnemyAnimTransition, EnemyController, EnemyAnimLayer, EnemyMotion } from './enemyViewTypes';

export interface EnemyAnimatorHost {
  clipLength(clip: string): number;
  /** Entered `state` of `layer`; `prev` null on init. blend/offset in seconds (optional hook). */
  onEnter?(state: number, prev: number | null, blendSeconds: number, startOffsetSeconds: number, layer: number): void;
}

/** One clip contribution of the current mix (weights of one layer sum to <= 1). */
export interface PoseItem {
  clip: string;
  layer: number;
  additive: boolean;
  /** Final weight inside the layer (cross-fade * blend-tree weight). */
  weight: number;
  /** Position in the clip, seconds (loop wrapped / clamped as the state demands). */
  time: number;
  loop: boolean;
}

const MODE_IF = 1;
const MODE_IF_NOT = 2;
const MODE_GREATER = 3;
const MODE_LESS = 4;
const MODE_EQUALS = 6;
const MODE_NOT_EQUAL = 7;

interface Slot {
  state: number;
  /** Normalized time in the state (unbounded; loops wrap when posing). */
  ntime: number;
  alpha: number;
  /** Cross-fade seconds into this slot (0 = instant). */
  blend: number;
}

interface LayerRt {
  def: EnemyAnimLayer;
  index: number;
  slots: Slot[];
  additive: boolean;
  weight: number;
}

/** Flatten a (nested) 1D blend tree into weighted clip leaves for the current parameters. */
export function blendLeaves(
  m: EnemyMotion | null,
  param: (name: string) => number,
  weight = 1,
  out: { clip: string; weight: number }[] = [],
): { clip: string; weight: number }[] {
  if (m === null || weight <= 0) return out;
  if (m.children === undefined || m.children.length === 0) {
    if (m.clip !== undefined && m.clip !== null) out.push({ clip: m.clip, weight });
    return out;
  }
  const kids = [...m.children].sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));
  const v = m.param ? param(m.param) : 0;
  const t = (i: number): number => kids[i].threshold ?? 0;
  if (kids.length === 1 || v <= t(0)) return blendLeaves(kids[0].node, param, weight, out);
  if (v >= t(kids.length - 1)) return blendLeaves(kids[kids.length - 1].node, param, weight, out);
  for (let i = 0; i < kids.length - 1; i++) {
    if (v >= t(i) && v < t(i + 1)) {
      const span = t(i + 1) - t(i);
      const w1 = span > 0 ? (v - t(i)) / span : 1;
      blendLeaves(kids[i].node, param, weight * (1 - w1), out);
      blendLeaves(kids[i + 1].node, param, weight * w1, out);
      break;
    }
  }
  return out;
}

export class EnemyAnimator {
  /** Base layer (layer 0). */
  readonly layer: EnemyAnimLayer;
  private readonly values = new Map<string, number>();
  private readonly types = new Map<string, string>();
  private readonly rt: LayerRt[] = [];
  /** Random source (injectable for tests). */
  random: () => number = Math.random;
  /** Animator.speed (EnemyBase.UpdateFrozen scales it). */
  speed = 1;

  constructor(readonly controller: EnemyController, private readonly host: EnemyAnimatorHost) {
    for (const p of controller.params) {
      if (p.name === null) continue;
      this.values.set(p.name, 0);
      this.types.set(p.name, p.type);
    }
    this.layer = controller.layers[0];
    controller.layers.forEach((def, index) => {
      // Unity ignores the base layer's weight; other layers use defaultWeight (synced copies at 0 contribute nothing).
      if (index > 0 && !(def.defaultWeight > 0)) return;
      this.rt.push({ def, index, slots: [], additive: index > 0 && def.blendMode === 1, weight: index === 0 ? 1 : def.defaultWeight });
    });
    for (const l of this.rt) {
      const s = this.resolve(l, l.def.defaultState);
      l.slots.push({ state: s, ntime: 0, alpha: 1, blend: 0 });
      this.host.onEnter?.(s, null, 0, 0, l.index);
    }
  }

  // ---- Animator parameter API ----
  hasParameter(name: string): boolean { return this.types.has(name); }
  setFloat(name: string, v: number): void { if (this.types.has(name)) this.values.set(name, v); }
  setInteger(name: string, v: number): void { if (this.types.has(name)) this.values.set(name, Math.trunc(v)); }
  setBool(name: string, v: boolean): void { if (this.types.has(name)) this.values.set(name, v ? 1 : 0); }
  setTrigger(name: string): void { if (this.types.has(name)) this.values.set(name, 1); }
  resetTrigger(name: string): void { if (this.types.has(name)) this.values.set(name, 0); }
  getFloat(name: string): number { return this.values.get(name) ?? 0; }

  // ---- state queries (layer 0 unless a layer is given) ----
  get currentState(): number { return this.cur(this.rt[0]).state; }
  get currentName(): string { return this.layer.states[this.currentState].name; }
  /** AnimatorStateInfo.tagHash equivalent (state tag string, '' if none). */
  get currentTag(): string { return this.layer.states[this.currentState].tag ?? ''; }
  /** Number of evaluated layers (>= 1). */
  get layerCount(): number { return this.rt.length; }
  stateName(layer: number): string { const l = this.rt[layer]; return l.def.states[this.cur(l).state].name ?? ''; }
  /** Effective playback speed of the current state (m_Speed x speed parameter). */
  get currentSpeed(): number { return this.stateSpeed(this.rt[0], this.currentState); }
  normalizedTime(): number { return this.cur(this.rt[0]).ntime; }

  private cur(l: LayerRt): Slot { return l.slots[l.slots.length - 1]; }

  private stateSpeed(l: LayerRt, state: number): number {
    const s = l.def.states[state];
    return s.speed * (s.speedParam !== null ? this.getFloat(s.speedParam) : 1);
  }

  private cycleOffsetOf(l: LayerRt, state: number): number {
    const s = l.def.states[state];
    return s.cycleOffsetParam !== null ? this.getFloat(s.cycleOffsetParam) : s.cycleOffset;
  }

  update(dt: number): void {
    const step = dt * this.speed;
    for (const l of this.rt) this.updateLayer(l, step);
  }

  private updateLayer(l: LayerRt, dt: number): void {
    // Unity can chain instantaneous transitions inside one update.
    for (let hops = 0; hops < 4; hops++) {
      const len = this.stateLength(l, this.cur(l).state);
      const before = this.cur(l).ntime;
      if (hops === 0) {
        // advance every live slot, then the fade of the newest
        for (const s of l.slots) {
          const sl = this.stateLength(l, s.state);
          s.ntime += sl > 0 ? (dt * Math.sign(this.stateSpeed(l, s.state)) * 1) / sl : 0;
        }
        const nw = this.cur(l);
        if (nw.alpha < 1) nw.alpha = nw.blend > 0 ? Math.min(1, nw.alpha + dt / nw.blend) : 1;
        if (nw.alpha >= 1 && l.slots.length > 1) l.slots.splice(0, l.slots.length - 1);
      }
      const t = this.pick(l, this.cur(l).ntime, before);
      if (t === null) return;
      this.take(l, t, len);
    }
  }

  /** Seconds of one pass through the state: weight-averaged clip length / |speed|; 1 s without a motion. */
  private stateLength(l: LayerRt, state: number): number {
    const st = l.def.states[state];
    const sp = Math.abs(this.stateSpeed(l, state));
    if (sp === 0) return 0;
    if (st.motion === null) return 1 / sp;
    const leaves = blendLeaves(st.motion, (n) => this.getFloat(n));
    let sum = 0; let w = 0;
    for (const lf of leaves) { sum += lf.weight * this.host.clipLength(lf.clip); w += lf.weight; }
    return w > 0 && sum > 0 ? sum / w / sp : 0;
  }

  /** Dominant clip of a state (length queries / simple hosts). */
  clipOf(state: number, layer = 0): string | null {
    const leaves = blendLeaves(this.rt[layer].def.states[state].motion, (n) => this.getFloat(n));
    let best: { clip: string; weight: number } | null = null;
    for (const lf of leaves) if (best === null || lf.weight > best.weight) best = lf;
    return best?.clip ?? null;
  }

  /** The current mix: every clip of every layer's live slots with its final weight and clip time. */
  poses(): PoseItem[] {
    const out: PoseItem[] = [];
    for (const l of this.rt) {
      const n = l.slots.length;
      for (let i = 0; i < n; i++) {
        let w = l.slots[i].alpha;
        for (let j = i + 1; j < n; j++) w *= 1 - l.slots[j].alpha;
        w *= l.weight;
        if (w <= 0) continue;
        const slot = l.slots[i];
        const st = l.def.states[slot.state];
        const norm = slot.ntime + this.cycleOffsetOf(l, slot.state);
        const loop = st.loop;
        const nt = loop ? norm - Math.floor(norm) : Math.min(1, Math.max(0, norm));
        for (const lf of blendLeaves(st.motion, (nm) => this.getFloat(nm))) {
          out.push({
            clip: lf.clip, layer: l.index, additive: l.additive, weight: w * lf.weight,
            time: nt * this.host.clipLength(lf.clip), loop,
          });
        }
      }
    }
    return out;
  }

  private pick(l: LayerRt, normalized: number, prev: number): EnemyAnimTransition | null {
    const cur = this.cur(l).state;
    // Any-State first (Unity orders Any-State transitions ahead of the state's own).
    for (const t of l.def.anyState) {
      if (!t.conds.every((c) => this.cond(c))) continue;
      const dest = this.destinationState(l, t.dest, true);
      if (dest === cur && !t.canSelf) continue;
      return t;
    }
    const st = l.def.states[cur];
    for (const t of st.transitions) {
      if (t.exit && !this.exitReached(st.loop, t.exitTime, normalized, prev)) continue;
      if (!t.conds.every((c) => this.cond(c))) continue;
      return t;
    }
    return null;
  }

  private exitReached(loop: boolean, exitTime: number, n: number, prev: number): boolean {
    if (!loop) return n >= exitTime;
    return Math.floor(n - exitTime) > Math.floor(prev - exitTime);
  }

  private cond(c: AnimCondition): boolean {
    const v = c.param === null ? 0 : (this.values.get(c.param) ?? 0);
    switch (c.mode) {
      case MODE_IF: return v !== 0;
      case MODE_IF_NOT: return v === 0;
      case MODE_GREATER: return v > c.threshold;
      case MODE_LESS: return v < c.threshold;
      case MODE_EQUALS: return v === c.threshold;
      case MODE_NOT_EQUAL: return v !== c.threshold;
      default: return false;
    }
  }

  /** Follow selector (>= 30000) nodes to a real state index. `peek` = do not re-roll RandomInt. */
  private destinationState(l: LayerRt, dest: number, peek = false): number {
    let d = dest;
    for (let i = 0; i < 8 && d >= 30000; i++) {
      const sel = l.def.selectors[d - 30000];
      if (!peek && sel.transitions.some((t) => t.conds.some((c) => c.param === 'RandomInt'))) {
        this.setInteger('RandomInt', Math.floor(this.random() * 2)); // RandomIntBehaviour Range(0, 2)
      }
      const next = sel.transitions.find((t) => t.conds.every((c) => this.cond(c)));
      if (!next) return this.cur(l).state;
      d = next.dest;
    }
    return d;
  }

  private resolve(l: LayerRt, dest: number): number {
    // initial entry: the current "state" is unset, selectors with no match fall back to the default state
    let d = dest;
    for (let i = 0; i < 8 && d >= 30000; i++) {
      const sel = l.def.selectors[d - 30000];
      const next = sel.transitions.find((t) => t.conds.every((c) => this.cond(c)));
      if (!next) return 0;
      d = next.dest;
    }
    return d;
  }

  private take(l: LayerRt, t: EnemyAnimTransition, sourceLength: number): void {
    for (const c of t.conds) {
      if (c.param !== null && this.types.get(c.param) === 'trigger') this.values.set(c.param, 0);
    }
    const prev = this.cur(l).state;
    const dest = this.destinationState(l, t.dest);
    const blend = Math.max(0, t.fixed ? t.duration : t.duration * sourceLength);
    const destLen = this.stateLength(l, dest);
    const offsetNorm = t.offset;
    l.slots.push({ state: dest, ntime: offsetNorm, alpha: blend > 0 ? 0 : 1, blend });
    if (blend <= 0) l.slots.splice(0, l.slots.length - 1);
    this.host.onEnter?.(dest, prev, blend, offsetNorm * destLen, l.index);
  }
}
