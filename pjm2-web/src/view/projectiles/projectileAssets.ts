// src/view/projectiles/projectileAssets.ts
// Loads the extracted projectile model GLBs (tools/assets/extract_projectiles.py ->
// public/assets/projectiles/*.glb). Same loader pattern as PickupView.load: mirror
// baked into the GLB, WebP texture repack when textures_webp/_ok exists, per-file
// failure -> missing entry (the viewer then draws the projectile model-less).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PROJECTILE_DATA } from './projectileData.generated';

/** visual prefab name (bullet_001_pa) -> loaded template scene. */
export async function loadProjectileModels(
  baseUrl = '/assets/projectiles/',
): Promise<Map<string, THREE.Object3D>> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let useWebp = false;
  if (typeof fetch === 'function') {
    useWebp = await fetch(`${base}textures_webp/_ok`, { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
  }
  const manager = new THREE.LoadingManager();
  if (useWebp) {
    manager.setURLModifier((url) =>
      url.includes('/textures/') && url.toLowerCase().endsWith('.png')
        ? url.replace('/textures/', '/textures_webp/').replace(/\.png$/i, '.webp')
        : url,
    );
  }
  const loader = new GLTFLoader(manager);
  const out = new Map<string, THREE.Object3D>();
  await Promise.all(
    Object.entries(PROJECTILE_DATA.models).map(async ([name, ref]) => {
      try {
        out.set(name, (await loader.loadAsync(base + ref.file)).scene);
      } catch (err) {
        console.warn(`projectile model ${ref.file} failed to load — model-less projectile`, err);
      }
    }),
  );
  return out;
}
