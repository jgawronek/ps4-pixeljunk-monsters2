// src/view/characters/TowerFlag.ts
// Tower level flags (Q4.TowerBase.OnUpgrade -> CoroutineDecorateFlag @0054b780, controller `flag_001_ctrl`).
//
// What they are: every TowerUpgrade row of level 2..5 carries a `flagPrefab` (flag_001_2_pa .. flag_001_5_pa, shared by all
// tower types; level 1 has none). The four banners are one texture atlas (flag_001_Color): yellow "2", green "3", blue "4",
// red "5" badges — the flag SHOWS the tower's level. They sit on the tower's `flag_pos` node.
//
// CoroutineDecorateFlag: Animator.SetBool(OnInIdle, false) -> wait until the animator is in BaseLayer.OutIdle ->
//   DestroyChilds(flag_pos) -> Instantiate(newFlagPrefab, flag_pos) -> SetBool(OnInIdle, true) -> PlaySFX(TowerFlagUp).
// Controller flag_001_ctrl (one layer, one bool OnInIdle): OutIdle -[OnInIdle]-> In (0.333 s) -> OnInIdle -[!OnInIdle]-> Out
// (0.2 s) -> OutIdle. Clips (decoded from the bundle; they animate flag_pos itself and the flag's root):
//   OutIdle  flag_pos.rotZ 90, flag.scaleY 0                  (hidden: folded down and flat)
//   In       rotZ 90 -> -15 (0.2) -> 5 (0.3) -> 0 (0.333); scaleY 0 -> 1.2 (0.2) -> 0.9 (0.3) -> 1 (0.333)   (swings up, unfurls)
//   OnInIdle rotZ 0, scaleY 1
//   Out      rotZ 0 -> 90, scaleY 1 -> 0 over 0.2 s
// Cloth: material `Flag/FlagWave` (wind vertex wave). Its compiled program is not readable; applyFlagWave() is an approximation
// driven by the serialized material values (_MainWindSpeed 2.0, _MainWindFrequency 2.2, _MainWindStrength 2.5, _PoleThreshold 0.2).

import * as THREE from 'three';
import type { CharacterRig } from './CharacterLibrary';

type Track = readonly (readonly [number, number])[];

/** flag_001_ctrl clip keys (seconds, value). rotZ = flag_pos localEulerAngles.z (Unity degrees), scaleY = flag root localScale.y. */
export const FLAG_CLIPS = {
  In: { length: 0.3333, rotZ: [[0, 90], [0.2, -15], [0.3, 5], [0.3333, 0]] as Track, scaleY: [[0, 0], [0.2, 1.2], [0.3, 0.9], [0.3333, 1]] as Track },
  Out: { length: 0.2, rotZ: [[0, 0], [0.2, 90]] as Track, scaleY: [[0, 1], [0.2, 0]] as Track },
} as const;

export type FlagState = 'OutIdle' | 'In' | 'OnInIdle' | 'Out';

export function sampleKeys(track: Track, t: number): number {
  if (t <= track[0][0]) return track[0][1];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t <= b[0]) return a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0]));
  }
  return track[track.length - 1][1];
}

export type FlagFactory = (level: number) => CharacterRig | null;
let factory: FlagFactory | null = null;
/** Installed by the stage session once the flag GLBs are loaded (CharacterLibrary.instantiate('flag_001_N')). */
export function setTowerFlagFactory(f: FlagFactory | null): void { factory = f; }

const WAVE = { speed: 2.0, frequency: 2.2, strength: 2.5, pole: 0.2 } as const; // Flag/FlagWave material values
const timeUniform = { value: 0 };

/** Wind wave on the cloth: displacement grows with distance from the pole (poleThreshold) — view approximation. */
export function applyFlagWave(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if ((mat as THREE.Material & { userData: { flagWave?: boolean } }).userData.flagWave === true) continue;
      (mat as THREE.Material & { userData: { flagWave?: boolean } }).userData.flagWave = true;
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer): void => {
        prev?.call(mat, shader, renderer);
        shader.uniforms.uFlagTime = timeUniform;
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'uniform float uFlagTime;\nvoid main() {')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              // flag extends along object X away from the pole at x = 0 (bounds -1.0 .. -0.5 in Unity, mirrored here)
              float tx = clamp((abs(position.x) - 0.5) / 0.5, 0.0, 1.0);
              float w = max(tx - ${WAVE.pole.toFixed(2)}, 0.0) / ${(1 - WAVE.pole).toFixed(2)};
              float ph = uFlagTime * ${(WAVE.speed * 3).toFixed(2)} + abs(position.x) * ${(WAVE.frequency * 5).toFixed(2)};
              transformed.z += sin(ph) * ${(WAVE.strength * 0.045).toFixed(3)} * w;
              transformed.y += sin(ph * 0.7 + 1.3) * ${(WAVE.strength * 0.012).toFixed(3)} * w;
            }`);
      };
      mat.customProgramCacheKey = (): string => 'pjm2-flag-wave';
      mat.needsUpdate = true;
    }
  });
}

export class TowerFlag {
  state: FlagState = 'OutIdle';
  private t = 0;
  private flagRoot: THREE.Object3D | null = null;
  private onInIdle = false;
  private pendingLevel: number | null = null;

  constructor(private readonly mount: THREE.Object3D, private readonly playFlagUp: () => void) {
    this.pose();
  }

  /** TowerBase.OnUpgrade -> CoroutineDecorateFlag(flagPrefab of the NEW level). */
  setLevel(level: number): void {
    if (level < 2 || level > 5) return;
    this.pendingLevel = level;
    this.onInIdle = false; // Animator.SetBool(OnInIdle, false)
  }

  update(dt: number): void {
    timeUniform.value = performance.now() / 1000;
    this.t += dt;
    // controller transitions
    if (this.state === 'OnInIdle' && !this.onInIdle) { this.state = 'Out'; this.t = 0; }
    if (this.state === 'In' && this.t >= FLAG_CLIPS.In.length) { this.state = 'OnInIdle'; this.t = 0; }
    if (this.state === 'Out' && this.t >= FLAG_CLIPS.Out.length) { this.state = 'OutIdle'; this.t = 0; }
    // the coroutine proceeds once the animator is in OutIdle
    if (this.state === 'OutIdle' && this.pendingLevel !== null) {
      const level = this.pendingLevel;
      this.pendingLevel = null;
      this.replaceFlag(level);
      this.onInIdle = true; // SetBool(OnInIdle, true)
      this.state = 'In';
      this.t = 0;
      this.playFlagUp();
    }
    this.pose();
  }

  private replaceFlag(level: number): void {
    // GameObjectHelper.DestroyChilds(flag_pos)
    for (const c of [...this.mount.children]) this.mount.remove(c);
    this.flagRoot = null;
    const rig = factory?.(level) ?? null;
    if (rig === null) return;
    applyFlagWave(rig.root);
    this.mount.add(rig.root);
    this.flagRoot = rig.root;
  }

  private pose(): void {
    let rotZ = 90, sy = 0;
    switch (this.state) {
      case 'OutIdle': rotZ = 90; sy = 0; break;
      case 'In': rotZ = sampleKeys(FLAG_CLIPS.In.rotZ, this.t); sy = sampleKeys(FLAG_CLIPS.In.scaleY, this.t); break;
      case 'OnInIdle': rotZ = 0; sy = 1; break;
      case 'Out': rotZ = sampleKeys(FLAG_CLIPS.Out.rotZ, this.t); sy = sampleKeys(FLAG_CLIPS.Out.scaleY, this.t); break;
    }
    // Unity (x,y,z) euler -> three (x mirrored): rotation about Z flips sign
    this.mount.rotation.set(0, 0, (-rotZ * Math.PI) / 180);
    if (this.flagRoot !== null) this.flagRoot.scale.set(1, Math.max(0.0001, sy), 1);
  }

  dispose(): void {
    for (const c of [...this.mount.children]) this.mount.remove(c);
    this.flagRoot = null;
  }
}
