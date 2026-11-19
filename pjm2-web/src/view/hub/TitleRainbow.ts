// src/view/hub/TitleRainbow.ts
// The pale rainbow behind the title logo: `ef_ui_bg_rainbow_pv` is a child of GameCameraTitle (local (0,-10.5,23.66), scale 5) with one
// ParticleSystem `ps_env_rainbow` (decoded from the stages bundle, tools/assets/extract_title_rainbow.py):
//   startDelay 2.5 s (= the InStart clip length: it appears as the logo lands), duration 0.1 looping, 1 burst per loop (=> a new camera-facing
//   billboard every 0.1 s), startLifetime 0.5, startSize 8 x 4 (size3D; x prefab scale 5 = 40 x 20 units), renderer pivot y 0.76, startSpeed 0, startColor rgba(1,1,1,0.251),
//   colour-over-lifetime alpha keys 0 -> 1 @0.3, 1 @0.6 -> 0 @1.0, material Particles/Alpha Blended (vertex colour x 2*_TintColor(0.502) = 1),
//   billboard render mode, no depth write. ~5 quads overlap at any time, which makes the final pastel arc.
// The GameCameraTitle animator clips ShowRainbowTitle / HideRainbow only toggle the object active (1 s).

import * as THREE from 'three';

export const RAINBOW = {
  /** world position (Unity space) of ef_ui_bg_rainbow_pv under the title camera */
  pos: [0, -6.16, -20.15] as const,
  startDelay: 2.5,
  loopDuration: 0.1,
  lifetime: 0.5,
  /** size3D = true: startSize (x 8, y 4) x the prefab's hierarchy scale 5 -> 40 x 20 units (matches the 1024x512 texture). */
  width: 8 * 5,
  height: 4 * 5,
  /** ParticleSystemRenderer.m_Pivot.y = 0.76 (in particle-size units): the quad is lifted by 0.76 x its height. Verified against orig_main.png (arc top ~9 m above the camera axis). */
  pivotY: 0.76,
  /** InitialModule.startColor is a constant (minMaxState 0 -> maxColor) = rgba(1,1,1,0.251). */
  startAlpha: 0.25098041,
  /** colour-over-lifetime alpha keys [time, alpha] */
  alphaKeys: [[0, 0], [0.3, 1], [0.6, 1], [1, 0]] as const,
};

/** Gradient alpha at normalised age t (linear between keys). */
export function rainbowAlpha(t: number): number {
  const k = RAINBOW.alphaKeys;
  if (t <= 0) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (t <= k[i + 1][0]) {
      const u = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * u;
    }
  }
  return k[k.length - 1][1];
}

interface Quad { mesh: THREE.Mesh; age: number }

export class TitleRainbow {
  readonly root = new THREE.Group();
  private readonly quads: Quad[] = [];
  private playing = false;
  private clock = 0;
  private spawnAcc = 0;
  private frozen = false;

  private constructor(private readonly tex: THREE.Texture) {
    this.root.name = 'title-rainbow';
    this.root.visible = false;
    const geo = new THREE.PlaneGeometry(RAINBOW.width, RAINBOW.height);
    geo.translate(0, RAINBOW.pivotY * RAINBOW.height, 0); // renderer pivot (billboard-local up)
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: true }); // depthWrite: WaterPass's copy re-emits the flat clear colour for far-plane (depth ~1) pixels, which would erase a sky-only billboard
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.quads.push({ mesh, age: RAINBOW.lifetime });
    }
    this.root.position.set(-RAINBOW.pos[0], RAINBOW.pos[1], RAINBOW.pos[2]);
  }

  static async load(url = '/assets/stages/3d_stage_000/title/rainbow.png'): Promise<TitleRainbow | null> {
    try {
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      return new TitleRainbow(tex);
    } catch {
      return null;
    }
  }

  /** ShowRainbowTitle: (re)start the emitter (the startDelay counts from here). */
  start(): void {
    this.playing = true; this.clock = 0; this.spawnAcc = 0;
    this.root.visible = true;
  }

  /** HideRainbow: stop emitting; live quads fade out with their lifetime. */
  stop(): void { this.playing = false; }

  update(dt: number, camQuat: THREE.Quaternion): void {
    if (this.playing) {
      this.clock += dt;
      if (this.clock >= RAINBOW.startDelay) {
        this.spawnAcc += dt;
        while (this.spawnAcc >= RAINBOW.loopDuration) { this.spawnAcc -= RAINBOW.loopDuration; this.spawn(); }
      }
    }
    let any = false;
    for (const q of this.quads) {
      if (q.age >= RAINBOW.lifetime) { q.mesh.visible = false; continue; }
      if (!this.frozen) q.age += dt;
      const t = Math.min(1, q.age / RAINBOW.lifetime);
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = RAINBOW.startAlpha * rainbowAlpha(t);
      q.mesh.quaternion.copy(camQuat); // billboard: aligned to the camera plane
      q.mesh.visible = true;
      any = true;
    }
    if (!this.playing && !any) this.root.visible = false;
  }

  private spawn(): void {
    const q = this.quads.find((x) => x.age >= RAINBOW.lifetime);
    if (q !== undefined) q.age = 0;
  }

  /** Debug: hold 5 overlapping quads at age 0.1..0.5 s (the steady state of the real emitter) so a slow headless frame can capture it. */
  debugFreeze(): void { this.frozen = true; this.playing = true; this.root.visible = true; this.quads.forEach((q, i) => { q.age = i < 5 ? 0.1 * (i + 1) - 0.05 : RAINBOW.lifetime; }); }

  /** Probe. */
  get state(): { playing: boolean; clock: number; rootVisible: boolean; live: { age: number; vis: boolean; op: number }[] } {
    return { playing: this.playing, clock: this.clock, rootVisible: this.root.visible, live: this.quads.map((q) => ({ age: +q.age.toFixed(2), vis: q.mesh.visible, op: +(q.mesh.material as THREE.MeshBasicMaterial).opacity.toFixed(3) })) };
  }

  dispose(): void {
    this.tex.dispose();
    for (const q of this.quads) (q.mesh.material as THREE.Material).dispose();
    this.quads[0]?.mesh.geometry.dispose();
    this.root.removeFromParent();
  }
}
