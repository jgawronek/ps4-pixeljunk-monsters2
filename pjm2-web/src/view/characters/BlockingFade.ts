// src/view/characters/BlockingFade.ts
// Q4.BlockingTreeHider (Update @0x733150, UpdateObjectTransparency @0x7338A0) — keeps the player visible by fading what blocks the view.
//   Serialized (globalsettings / stages): fadeAlpha 0.3 (behind camera), topDownFadeAlpha 0.6, fadeDuration 0.5 s, danceFadeDelay 0.5 s,
//   rayRadius 0.5 (behind camera sphere cast only).
//   TOP-DOWN camera: the only blocking object is the tower the player is DANCING on (PlayerMotor.IsDancing -> Player.DanceTowerHandle);
//   behind camera: NatureTrees hit by a SphereCast camera -> player.
//   Per fade entry {f (1 opaque .. 0), hiding, wait}:
//     rate = 1 / fadeDuration
//     if (hiding || (f > 0 && wait > 0)) f -= dt * rate          // blocking, OR still sinking while a post-dance delay is pending
//     else if (wait <= 0) f += dt * rate                         // restoring
//     else wait -= dt                                            // fully transparent: hold for `wait`
//     f = clamp01(f);  alpha = Lerp(maximumFade, 1, f)           // material._Color.a on every LOD renderer; blend mode transparent while f < 1
//   While an object is blocking because the player dances, wait = danceFadeDelay: when the dance ends the tower first finishes fading to
//   alpha = maximumFade, holds 0.5 s, then returns — the visible "pulse".

import * as THREE from 'three';

export const BLOCKING_FADE = { fadeAlpha: 0.3, topDownFadeAlpha: 0.6, fadeDuration: 0.5, danceFadeDelay: 0.5 } as const;

export class ObjectFade {
  /** 1 = opaque, 0 = fully faded to `maximumFade` */
  f = 1;
  wait = 0;
  hiding = false;

  /** One UpdateObjectTransparency step. `blocking` = the object is in this frame's blocking list; `dancing` = the flag of that entry. */
  update(dt: number, blocking: boolean, dancing: boolean): void {
    this.hiding = blocking;
    if (blocking) this.wait = dancing ? BLOCKING_FADE.danceFadeDelay : 0;
    const rate = BLOCKING_FADE.fadeDuration <= 0 ? 1 : 1 / BLOCKING_FADE.fadeDuration;
    if (this.hiding || (this.f > 0 && this.wait > 0)) this.f -= dt * rate;
    else if (this.wait <= 0) this.f += dt * rate;
    else this.wait -= dt;
    this.f = Math.min(1, Math.max(0, this.f));
  }

  alpha(maximumFade: number): number {
    return maximumFade + (1 - maximumFade) * this.f;
  }

  get active(): boolean { return this.f < 1 || this.hiding || this.wait > 0; }
}

interface Saved { mat: THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean }; transparent: boolean; opacity: number; depthWrite: boolean }

/** Applies a fade to a view's renderers on PER-VIEW cloned materials (library materials are shared between instances). */
export class FadedRenderers {
  private cloned = false;
  private readonly saved: Saved[] = [];
  private faded = false;
  constructor(private readonly root: THREE.Object3D) {}

  private ensureClones(): void {
    if (this.cloned) return;
    this.cloned = true;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material): THREE.Material => {
        const c = mat.clone();
        const cc = c as THREE.Material & { opacity: number; transparent: boolean; depthWrite: boolean };
        this.saved.push({ mat: cc, transparent: cc.transparent, opacity: cc.opacity, depthWrite: cc.depthWrite });
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }

  /** alpha 1 restores the opaque material state (SetupMaterialWithBlendMode(false)). */
  setAlpha(alpha: number): void {
    if (alpha >= 1 && !this.cloned) return;
    this.ensureClones();
    const nowFaded = alpha < 1;
    for (const s of this.saved) {
      if (!nowFaded) { s.mat.transparent = s.transparent; s.mat.opacity = s.opacity; s.mat.depthWrite = s.depthWrite; }
      else { s.mat.transparent = true; s.mat.opacity = s.opacity * alpha; s.mat.depthWrite = false; }
      if (nowFaded !== this.faded) s.mat.needsUpdate = true; // blend mode change only (recompile), not every frame
    }
    this.faded = nowFaded;
  }
}
