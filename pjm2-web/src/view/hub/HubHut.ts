// src/view/hub/HubHut.ts
// The title hut of the hub scene (Home_GRP/home_001_title_pa/home_001_comp): a SkinnedMeshRenderer (home_001_comp_LOD0) driven by the Animator
// `home_001_ctrl` (structures bundle): state Empty --trigger TitleScreenEnter--> `curtain` (1.4583 s, not looping) --exit--> Empty.
// TitleScreenController.StartIntroAnimation fires that trigger (FindGameObjectWithTag("Home") -> Animator) on the FIRST title show only
// (the +0xb3 "has played" flag); later shows go straight to the idle pose. tools/assets/extract_hub_hut.py exports the GLB + the clip.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ClipBinding { path: string; property: string; times: number[]; values: number[] }
interface HutClips { clips: { clipName: string; stopTime: number; startTime: number; bindings: ClipBinding[] }[] }

const BASE = '/assets/stages/3d_stage_000/hut/';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Raw Unity channels -> three.js tracks (mirror: position x -> -x, quaternion (x,y,z,w) -> (x,-y,-z,w)). */
export function buildCurtainClip(doc: HutClips, name = 'curtain'): THREE.AnimationClip | null {
  const src = doc.clips.find((c) => c.clipName === name);
  if (!src) return null;
  const byNode = new Map<string, Map<string, ClipBinding>>();
  for (const b of src.bindings) {
    const node = b.path.split('/').pop() ?? b.path;
    let m = byNode.get(node);
    if (!m) { m = new Map(); byNode.set(node, m); }
    m.set(b.property, b);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [node, m] of byNode) {
    const q = ['x', 'y', 'z', 'w'].map((a) => m.get(`m_LocalRotation.${a}`));
    if (q.every((b) => b !== undefined)) {
      const t = q[0]!.times;
      const v: number[] = [];
      for (let i = 0; i < t.length; i++) v.push(q[0]!.values[i], -q[1]!.values[i], -q[2]!.values[i], q[3]!.values[i]);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, t, v));
    }
    const p = ['x', 'y', 'z'].map((a) => m.get(`m_LocalPosition.${a}`));
    if (p.every((b) => b !== undefined)) {
      const t = p[0]!.times;
      const v: number[] = [];
      for (let i = 0; i < t.length; i++) v.push(-p[0]!.values[i], p[1]!.values[i], p[2]!.values[i]);
      tracks.push(new THREE.VectorKeyframeTrack(`${node}.position`, t, v));
    }
    const s = ['x', 'y', 'z'].map((a) => m.get(`m_LocalScale.${a}`));
    if (s.every((b) => b !== undefined)) {
      const t = s[0]!.times;
      const v: number[] = [];
      for (let i = 0; i < t.length; i++) v.push(s[0]!.values[i], s[1]!.values[i], s[2]!.values[i]);
      tracks.push(new THREE.VectorKeyframeTrack(`${node}.scale`, t, v));
    }
  }
  return new THREE.AnimationClip(name, src.stopTime - src.startTime, tracks);
}

export class HubHut {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private clip: THREE.AnimationClip | null = null;
  private action: THREE.AnimationAction | null = null;

  /** @param material the hub's `home_001_m` stage material (shared, already textured) */
  static async load(material: THREE.Material | null): Promise<HubHut | null> {
    const hut = new HubHut();
    try {
      const [glbBuf, clips] = await Promise.all([
        fetch(`${BASE}home_001_comp.glb`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`hut glb ${r.status}`)))),
        fetch(`${BASE}clips.json`).then((r) => (r.ok ? r.json() as Promise<HutClips> : Promise.reject(new Error(`hut clips ${r.status}`)))),
      ]);
      const mgr = new THREE.LoadingManager();
      mgr.setURLModifier((u) => (u.endsWith('.png') ? PIXEL : u)); // the stage material already carries the (webp) textures
      const gltf = await new GLTFLoader(mgr).parseAsync(glbBuf, BASE);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          if (material !== null) m.material = material;
          m.frustumCulled = false; // skinned bounds are bind-pose
          m.castShadow = true; m.receiveShadow = true;
        }
      });
      hut.root.add(gltf.scene);
      hut.mixer = new THREE.AnimationMixer(gltf.scene);
      hut.clip = buildCurtainClip(clips);
      return hut;
    } catch (err) {
      console.warn('hub hut unavailable:', err);
      return null;
    }
  }

  /** Animator trigger TitleScreenEnter (Empty -> curtain). */
  playCurtain(): void {
    if (this.mixer === null || this.clip === null) return;
    this.action?.stop();
    const a = this.mixer.clipAction(this.clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false; // back to Empty = bind pose when the clip ends
    a.play();
    this.action = a;
  }

  update(dt: number): void { this.mixer?.update(dt); }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
