// src/view/characters/controllerPlayer.ts
// Applies an EnemyAnimator (serialized Unity AnimatorController evaluator) to a three.js skeleton:
// every frame the animator's cross-fade mix (EnemyAnimator.poses(): clip, final weight, clip time, additive layer)
// is written onto AnimationActions whose time is scrubbed (timeScale 0) and whose weights are set explicitly.
// Weights summing to < 1 blend toward the bind pose (three.js PropertyMixer) = Unity's Write Defaults for states
// without a motion. Also fires the clips' baked AnimationEvents (TriggerEffect(label) -> ParticleGroupEventHandler)
// when a clip with weight >= 0.3 passes the event time.

import * as THREE from 'three';
import type { EnemyAnimator, PoseItem } from './EnemyAnimatorLogic';

export class ControllerPlayer {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly lastClipTime = new Map<string, number>();

  constructor(
    root: THREE.Object3D,
    private readonly clips: THREE.AnimationClip[],
    private readonly animator: EnemyAnimator,
    private readonly events: Readonly<Record<string, [number, string, string][]>>,
    private readonly onEvent: (fn: string, data: string) => void,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  /** Controller clip name (`<clip> [data]`) -> baked GLB clip. */
  clipByName(name: string): THREE.AnimationClip | null {
    const n = name.replace(/ \[data\]$/, '');
    return this.clips.find((c) => c.name === n) ?? null;
  }

  private actionFor(clipName: string, additive: boolean): THREE.AnimationAction | null {
    const key = (additive ? 'a:' : 'n:') + clipName;
    let act = this.actions.get(key);
    if (act === undefined) {
      let clip = this.clipByName(clipName);
      if (clip === null) return null;
      if (additive) {
        // Unity additive layer: the clip is applied as a delta from its own first frame (reference pose frame 0)
        clip = clip.clone();
        THREE.AnimationUtils.makeClipAdditive(clip, 0, clip, 30);
      }
      act = this.mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
      act.timeScale = 0; // time is scrubbed from the Animator evaluator
      if (additive) act.blendMode = THREE.AdditiveAnimationBlendMode;
      act.play();
      act.setEffectiveWeight(0);
      this.actions.set(key, act);
    }
    return act;
  }

  apply(): void {
    const poses: PoseItem[] = this.animator.poses();
    const weights = new Map<THREE.AnimationAction, number>();
    for (const p of poses) {
      const act = this.actionFor(p.clip, p.additive);
      if (act === null) continue;
      weights.set(act, (weights.get(act) ?? 0) + p.weight);
      act.time = Math.min(p.time, act.getClip().duration);
    }
    for (const act of this.actions.values()) act.setEffectiveWeight(weights.get(act) ?? 0);
    this.fireEvents(poses);
    this.mixer.update(0);
  }

  private fireEvents(poses: PoseItem[]): void {
    const seen = new Set<string>();
    for (const p of poses) {
      const key = `${p.layer}:${p.clip}`;
      seen.add(key);
      const evs = this.events[p.clip];
      const last = this.lastClipTime.get(key);
      this.lastClipTime.set(key, p.time);
      if (evs === undefined || last === undefined || p.weight < 0.3) continue;
      const len = this.clipByName(p.clip)?.duration ?? 0;
      const wrapped = p.loop && p.time < last - 1e-4;
      for (const [t, fn, data] of evs) {
        const hit = wrapped ? (t > last && t <= len) || t <= p.time : t > last && t <= p.time;
        if (hit) this.onEvent(fn, data);
      }
    }
    for (const k of this.lastClipTime.keys()) if (!seen.has(k)) this.lastClipTime.delete(k); // re-entry restarts
  }

  dispose(): void { this.mixer.stopAllAction(); }
}
