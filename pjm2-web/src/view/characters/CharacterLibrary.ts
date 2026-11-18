// src/view/characters/CharacterLibrary.ts
// Async GLB cache for the extracted character models (public/assets/characters/).
//
// Source-of-truth conventions (public/assets/characters/manifest.json):
//   - GLBs are glTF RH Y-up with the Unity→glTF mirror ALREADY BAKED IN
//     (x negated vs Unity, winding/V flipped, baked 30fps animation tracks in
//     glTF space). They therefore load in three.js NATIVE space — the stage
//     loader's LH→RH mirror must NOT be applied here.
//   - Textures are EXTERNAL: each GLB references `../_textures/<name>__<pathId>.png`
//     (shared dedup dir). GLTFLoader resolves those URIs relative to the GLB
//     URL, so no manual texture wiring is needed. Only baseColor (sRGB —
//     GLTFLoader sets SRGBColorSpace per spec) and occlusion (linear) are
//     bound; normal/metal maps are manifest-only (channel layout mismatch,
//     manifest.texturePolicy) and intentionally unused.
//   - Every GLB has one skinned LOD0 mesh + empty LOD1..LOD4 stub nodes.
//
// Usage pattern (mirrors StageSceneView): `await library.loadMany(defs)` at
// page/sim startup, then the synchronous q4-contracts factories
// (setEnemyViewerFactory / setTowerViewerFactory) clone from the cache.
// SkeletonUtils.clone shares geometry/materials and clones the bone
// hierarchy, so instances are cheap; the template scene is never added to a
// live THREE.Scene.
//
// Repeat loads: GLB bytes and external texture bytes route through the
// AssetCache (Cache API, src/view/cache/AssetCache.ts) — zero network
// round-trips once cached. Pass ONE shared cache from boot (same instance as
// StageSceneView's options.assetCache); defaults to createBrowserAssetCache()
// which is a passthrough when the Cache API is absent (headless Node).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createBrowserAssetCache, type AssetCache } from '../cache/AssetCache';

export interface CharacterTemplate {
  defName: string;
  /** Master scene — NEVER add to a live scene (instances are clones). */
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Bind-pose AABB over the mesh-bearing nodes (native three space).
   *  The sim's collision-scale query only needs size/extents, which are
   *  mirror-invariant, so this box doubles as the Unity-space bounds. */
  bounds: THREE.Box3;
}

/** Everything a character view needs to pose/animate one spawned instance. */
export interface CharacterRig {
  /** Wrapper group (name `char:<def>`) holding the skeleton-cloned scene.
   *  Sim-driven transforms go on THIS node; GLB internals stay untouched. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** Bind-pose AABB of the template (shared, read-only). */
  modelBounds: THREE.Box3;
  defName: string;
}

export interface CharacterLoadProgress {
  defName: string;
  loaded: number;
  total: number;
}

/** External image URIs inside character GLBs (`../_textures/<name>__<id>.png`). */
const IMAGE_URI_RE = /\.(png|webp|jpe?g)$/i;

/** Texture loader whose bytes come from the AssetCache instead of a fresh
 *  network fetch. Registered as a LoadingManager handler, which GLTFLoader
 *  consults for every external texture URI (GLTFLoader.loadTexture). Sets
 *  the ImageBitmapLoader contract flag so GLTFLoader wraps the onLoad bitmap
 *  in a Texture (flipY=false etc) — without extending ImageBitmapLoader,
 *  whose constructor warns about missing createImageBitmap in headless Node.
 *  The manager's URLModifier still applies (png → webp rewrite), so the
 *  cache key is the FINAL webp URL. */
class CachedImageBitmapLoader extends THREE.Loader<ImageBitmap> {
  readonly isImageBitmapLoader = true;
  /** Same default as THREE.ImageBitmapLoader. */
  options: ImageBitmapOptions = { premultiplyAlpha: 'none' };

  constructor(manager: THREE.LoadingManager, private readonly assetCache: AssetCache) {
    super(manager);
  }

  override load(
    url: string,
    onLoad?: (data: ImageBitmap) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void {
    const resolved = this.manager.resolveURL(url);
    this.assetCache
      .getOrFetch(resolved, async () => {
        const res = await fetch(resolved);
        // Never cache error bodies — a 404 must stay a miss.
        if (!res.ok) throw new Error(`fetch ${resolved}: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => createImageBitmap(new Blob([buf]), this.options))
      .then((bitmap) => onLoad?.(bitmap))
      .catch((err: unknown) => onError?.(err));
  }
}

export class CharacterLibrary {
  private readonly templates = new Map<string, CharacterTemplate>();
  private readonly pending = new Map<string, Promise<CharacterTemplate>>();
  private readonly loader: GLTFLoader;
  /** Loader with _textures/*.png → _textures_webp/*.webp URL rewrite; used
   *  only when the repacked variant is present (sentinel `_ok`). */
  private readonly webpLoader: GLTFLoader;
  /** Resolved once: true when the WebP repack exists on the server. */
  private readonly webpAvailable: Promise<boolean>;
  private readonly assetCache: AssetCache;

  /** @param baseUrl must end with '/'; GLBs live at `<base><def>/<def>.glb`.
   *  @param assetCache shared browser asset cache; defaults to
   *  createBrowserAssetCache() (passthrough without the Cache API). */
  constructor(readonly baseUrl: string = '/assets/characters/', assetCache?: AssetCache) {
    this.assetCache = assetCache ?? createBrowserAssetCache();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.includes('/_textures/') && url.toLowerCase().endsWith('.png')) {
        return url
          .replace('/_textures/', '/_textures_webp/')
          .replace(/\.png$/i, '.webp');
      }
      return url;
    });
    manager.addHandler(IMAGE_URI_RE, new CachedImageBitmapLoader(manager, this.assetCache));
    this.webpLoader = new GLTFLoader(manager);
    // Private manager (not DefaultLoadingManager) so the texture handler
    // never leaks into unrelated loaders elsewhere in the app.
    const plainManager = new THREE.LoadingManager();
    plainManager.addHandler(IMAGE_URI_RE, new CachedImageBitmapLoader(plainManager, this.assetCache));
    this.loader = new GLTFLoader(plainManager);
    this.webpAvailable = fetch(`${baseUrl}_textures_webp/_ok`, { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
  }

  urlFor(defName: string): string {
    return `${this.baseUrl}${defName}/${defName}.glb`;
  }

  /** Load (or await the in-flight load of) one character GLB. Cached.
   *  GLB bytes come from the AssetCache (keyed by GLB URL); parseAsync gets
   *  the GLB's dir as resourcePath — exactly what loadAsync(url) derives —
   *  so external `../_textures/…` URIs resolve (and cache) identically. */
  load(defName: string): Promise<CharacterTemplate> {
    const hit = this.templates.get(defName);
    if (hit) return Promise.resolve(hit);
    const inFlight = this.pending.get(defName);
    if (inFlight) return inFlight;
    const p = this.webpAvailable
      .then(async (useWebp) => {
        const url = this.urlFor(defName);
        const buf = await this.assetCache.getOrFetch(url, async () => {
          const res = await fetch(url);
          // Never cache error bodies — a 404 must stay a miss.
          if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
          return res.arrayBuffer();
        });
        const loader = useWebp ? this.webpLoader : this.loader;
        return loader.parseAsync(buf, `${this.baseUrl}${defName}/`);
      })
      .then((gltf) => this.prepare(defName, gltf.scene, gltf.animations));
    this.pending.set(defName, p);
    p.then(
      () => this.pending.delete(defName),
      () => this.pending.delete(defName),
    );
    return p;
  }

  /** Load several characters with a simple item-count progress callback.
   *  Bounded worker pool (default 4 GLBs in flight): GLB fetch+parse and the
   *  external texture loads inside each GLB are already parallel, but an
   *  unbounded burst competes with the stage loader's requests on the dev
   *  server's per-host connection limit. Clones NEVER re-fetch textures —
   *  SkeletonUtils.clone shares geometry/materials (and thus the decoded
   *  THREE.Textures) with the template; the _textures_webp URL rewrite runs
   *  once per GLB load, not per instance. */
  async loadMany(
    defNames: string[],
    onProgress?: (p: CharacterLoadProgress) => void,
    concurrency = 4,
  ): Promise<void> {
    let loaded = 0;
    let cursor = 0;
    const limit = Math.max(1, concurrency);
    const worker = async () => {
      while (cursor < defNames.length) {
        const defName = defNames[cursor++];
        await this.load(defName);
        loaded++;
        onProgress?.({ defName, loaded, total: defNames.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, defNames.length) }, worker));
  }

  /** Synchronous cache read — null when not preloaded (factories early-out). */
  get(defName: string): CharacterTemplate | null {
    return this.templates.get(defName) ?? null;
  }

  /** Clone the cached template into a fresh rig. Throws when not preloaded. */
  instantiate(defName: string): CharacterRig {
    const t = this.templates.get(defName);
    if (!t) {
      throw new Error(`CharacterLibrary.instantiate: '${defName}' not preloaded`);
    }
    const inner = cloneSkeleton(t.scene);
    const root = new THREE.Group();
    root.name = `char:${defName}`;
    root.add(inner);
    return { root, clips: t.clips, modelBounds: t.bounds, defName };
  }

  private prepare(
    defName: string,
    scene: THREE.Object3D,
    clips: THREE.AnimationClip[],
  ): CharacterTemplate {
    // Hide the empty LOD1+ stub nodes (LOD0 only, per stage policy §5).
    scene.traverse((o) => {
      if (/_LOD[1-9]\d*$/.test(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    // Bind-pose AABB over mesh-bearing nodes only (empty LOD stubs excluded).
    // SkinnedMesh contributes its geometry bounding box (bind pose) — exactly
    // what the sim's spawn-time collision-scale computation wants.
    const bounds = new THREE.Box3();
    const tmp = new THREE.Box3();
    scene.updateWorldMatrix(false, true);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      tmp.setFromObject(mesh);
      if (!tmp.isEmpty()) bounds.union(tmp);
    });
    const template: CharacterTemplate = { defName, scene, clips, bounds };
    this.templates.set(defName, template);
    return template;
  }

  /** Frees the master scenes. Cloned instances share geometry/materials with
   *  their template, so dispose instances (remove from scene) BEFORE this. */
  dispose(): void {
    for (const t of this.templates.values()) {
      t.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            // GLB textures live on the material (map/normalMap/...): free them with it (stage-session teardown).
            for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
            m.dispose();
          }
        }
      });
    }
    this.templates.clear();
  }
}
