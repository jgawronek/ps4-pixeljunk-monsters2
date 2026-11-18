// src/view/pickups/PickupView.ts
// Three.js-backed coin/gem pickup viewer: pools one clone per sim pickup
// handle, follows the sim position (Unity LH → three RH: x→−x), and spins
// the drop around Y exactly like the original Q4 view.
//
// Assets: public/assets/pickups/{coin_001,gem_001}.glb — extracted from the
// user's own `props` bundle by tools/assets/extract_pickups.py (logic prefabs
// prop_001/prop_002 → PrefabLoader → coin_001_pa/gem_001_pa visuals, LOD0
// static meshes; mirror already baked into the GLBs, so they load in three
// NATIVE space — see manifest.json coordinateConvention).
//
// DECOMP EVIDENCE for the motion (decomp/decompiled/, DATA):
//   - Position follow: Q4.Pickup.Update @0x3E2850 sets transform.position =
//     core position every frame. Q4.PickupCurrency.Update @0x3E2A30 adds a
//     cosmetic lerp toward the player's Structure transform while collected;
//     the sim ALREADY flies the pickup to the player (GameCorePickupCurrency.
//     SuckToPlayer @0x4C07A0, acceleration + attractOffset), so following the
//     sim position reproduces the collect flight — no view-side magnet here.
//   - Spin: Q4.PickupCurrency.Update @0x3E2A30 does
//       transform.Rotate(Vector3.up * m_pickupMovement.rotateSpeed * Time.deltaTime)
//     (dump.cs: Pickup.m_pickupMovement 0x30 → PickupMovement.rotateSpeed 0x1C).
//     rotateSpeed = −180 deg/s on BOTH prefabs, rotateSpeedVariation = 0
//     (decomp/data/pickup_prefabs.json; PickupMovement.Awake @0x3E57C0 only
//     jitteres by ±variation, i.e. not at all here).
//   - Initial yaw: Q4.PickupCurrency.Awake @0x3E2950 does
//       transform.Rotate(Vector3.up * Random.Range(0, 180))
//     → uniform random yaw in [0°,180°) at spawn.
//   - NO bob and NO scale-pop in the view code: the spawn scatter/bounce is
//     SIM physics (GameCorePickup ctor @0x4BEFB0: appearForceMin/Max launch +
//     appearRangeAngle cone + bouncingRate terrain reflection), already in
//     the sim position we follow. Adding a view bob would double-motion.
//   - Lifespan flash (Q4.PickupLifeCycle @0x3E33C0 + <Flash> iterator) toggles
//     m_renderObject = the UIHelpBar child GameObject; currency prefabs have
//     NO UIHelpBar child (verified component inventory), so the flash is a
//     visual no-op for coins/gems — intentionally not reproduced.
//
// TS ADAPTATION: the Awake yaw uses UnityEngine.Random in the original; the
// port forbids Math.random, so the phase is a deterministic hash of the sim
// handle mapped to the same [0,π) range (cosmetic-only, view layer).
// Mirror rule for the spin: unity quat (x,y,z,w) → three (x,−y,−z,w), so a
// unity yaw θ about +Y becomes three rotation.y = −θ; rotateSpeed −180°/s
// (unity LH) therefore renders as +180°/s (= +π rad/s) in three.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EInventoryType } from '../../core/GameCoreInventory';

const f = Math.fround;
const DEG2RAD = Math.PI / 180;

/** PickupMovement.rotateSpeed on prop_001 AND prop_002 (props bundle). */
const UNITY_ROTATE_SPEED_DEG = -180;
/** three-space spin rate: negated by the LH→RH quat mirror (see header). */
const SPIN_RAD_PER_SEC = f(-UNITY_ROTATE_SPEED_DEG * DEG2RAD); // +π

/** Minimal sim surface PickupView reads (GameCorePickupCurrency satisfies it
 *  structurally; headless tests pass plain fakes). */
export interface PickupLike {
  handle: { m_handle: number };
  position: { x: number; y: number; z: number };
  inventoryType: number;
}

export interface PickupAssets {
  coinScene: THREE.Object3D | null;
  gemScene: THREE.Object3D | null;
}

/** Deterministic spawn-yaw phase in [0,π) from the sim handle — replaces
 *  Q4.PickupCurrency.Awake's Random.Range(0,180) (TS ADAPTATION, see header).
 *  Integer avalanche hash; NO Math.random anywhere in this module. */
export function handlePhase(handle: number): number {
  let h = handle | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return f((h % 180) * DEG2RAD);
}

interface PickupEntry {
  /** Wrapper group — sim position + spin go HERE; GLB internals untouched. */
  node: THREE.Group;
  /** Spawn-relative age (s); spin = phase + SPIN_RAD_PER_SEC * age. */
  age: number;
  phase: number;
}

export class PickupView {
  private readonly entries = new Map<number, PickupEntry>();
  private readonly coinTemplate: THREE.Object3D | null;
  private readonly gemTemplate: THREE.Object3D | null;
  private disposed = false;

  // Fallback primitives (assets null → game keeps working offline). Sized to
  // the real LOD0 bounds (coin 0.342×0.342×0.078 disc facing ±Z; gem
  // 0.264×0.397×0.267 upright crystal). Colors derived from the extracted
  // albedo medians: coin_001_Color ≈ #f4e28a gold; gem_001_Color ≈ #b4fef8
  // bright TEAL (the real gem is teal, not purple — slightly deepened here
  // for readability without an environment map).
  private readonly fallbackCoinGeometry: THREE.CylinderGeometry;
  private readonly fallbackGemGeometry: THREE.OctahedronGeometry;
  private readonly fallbackCoinMaterial: THREE.MeshStandardMaterial;
  private readonly fallbackGemMaterial: THREE.MeshStandardMaterial;

  /** @param root parent for pickup wrappers (e.g. the stage characterRoot).
   *  @param assets master scenes from PickupView.load — NEVER added to a live
   *  scene themselves; instances are .clone()s sharing geometry/materials.
   *  Templates are caller-owned: dispose() frees instances + fallbacks only. */
  constructor(
    private readonly root: THREE.Object3D,
    assets: PickupAssets,
  ) {
    this.coinTemplate = this.prepareTemplate(assets.coinScene);
    this.gemTemplate = this.prepareTemplate(assets.gemScene);
    // Coin disc: cylinder axis Y rotated to Z so the flat faces point ±Z
    // exactly like coin_001_comp_LOD0 (bounds x/y ≈ 0.342, z ≈ 0.078).
    this.fallbackCoinGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.078, 24);
    this.fallbackCoinGeometry.rotateX(Math.PI / 2);
    this.fallbackGemGeometry = new THREE.OctahedronGeometry(0.16);
    this.fallbackGemGeometry.scale(1, 1.25, 1); // ≈ 0.32 × 0.40 × 0.32
    this.fallbackCoinMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4e28a, metalness: 0.6, roughness: 0.3,
    });
    this.fallbackGemMaterial = new THREE.MeshStandardMaterial({
      color: 0x8ef2e6, metalness: 0.7, roughness: 0.25,
    });
  }

  /** Load the extracted GLBs. Per-file failure → null (fallback primitive),
   *  never throws. WebP repack is used when textures_webp/_ok is present
   *  (same URL-rewrite pattern as CharacterLibrary). */
  static async load(baseUrl = '/assets/pickups/'): Promise<PickupAssets> {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    let useWebp = false;
    if (typeof fetch === 'function') {
      useWebp = await fetch(`${base}textures_webp/_ok`, { method: 'HEAD' })
        .then((r) => r.ok)
        .catch(() => false);
    }
    const manager = new THREE.LoadingManager();
    if (useWebp) {
      manager.setURLModifier((url) => {
        if (url.includes('/textures/') && url.toLowerCase().endsWith('.png')) {
          return url.replace('/textures/', '/textures_webp/').replace(/\.png$/i, '.webp');
        }
        return url;
      });
    }
    const loader = new GLTFLoader(manager);
    const loadOne = async (file: string): Promise<THREE.Object3D | null> => {
      try {
        return (await loader.loadAsync(base + file)).scene;
      } catch (err) {
        console.warn(`PickupView: ${file} failed to load — using fallback primitive`, err);
        return null;
      }
    };
    const [coinScene, gemScene] = await Promise.all([
      loadOne('coin_001.glb'),
      loadOne('gem_001.glb'),
    ]);
    return { coinScene, gemScene };
  }

  /** Reconcile the view with the live sim pickups: create clones for new
   *  handles, follow position (x mirrored), advance the Y spin, and remove
   *  clones whose pickup disappeared (collected / expired / drowned).
   *  @param dt frame delta (s) — advances spawn-relative spin age.
   *  @param timeSeconds global clock (part of the sync contract; spin uses
   *  spawn-relative age so the initial yaw matches the original Awake). */
  sync(pickups: Iterable<PickupLike>, dt: number, _timeSeconds: number): void {
    if (this.disposed) return;
    const seen = new Set<number>();
    for (const p of pickups) {
      const id = p.handle.m_handle;
      seen.add(id);
      let entry = this.entries.get(id);
      if (entry === undefined) {
        entry = this.createEntry(id, p.inventoryType);
        this.entries.set(id, entry);
      }
      // Position follow — Q4.Pickup.Update @0x3E2850 (mirror x only).
      entry.node.position.set(-p.position.x, p.position.y, p.position.z);
      // Spin — Q4.PickupCurrency.Update @0x3E2A30 (see header for the sign).
      entry.age = f(entry.age + dt);
      entry.node.rotation.y = f(entry.phase + f(SPIN_RAD_PER_SEC * entry.age));
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.removeEntry(id, entry);
      }
    }
  }

  /** Remove every instance and free view-owned resources. Templates are
   *  caller-owned (may be shared) and are NOT disposed here. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, entry] of this.entries) {
      this.removeEntry(id, entry);
    }
    this.fallbackCoinGeometry.dispose();
    this.fallbackGemGeometry.dispose();
    this.fallbackCoinMaterial.dispose();
    this.fallbackGemMaterial.dispose();
  }

  // ---- internals ----------------------------------------------------------

  private prepareTemplate(scene: THREE.Object3D | null): THREE.Object3D | null {
    if (scene === null) return null;
    scene.traverse((o) => {
      // LOD0 only (character pipeline stage policy); stubs stay in the GLB.
      if (/_LOD[1-9]\d*$/.test(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return scene;
  }

  private createEntry(id: number, inventoryType: number): PickupEntry {
    // EInventoryType.Gem=1 → gem; every other type renders as coin (the sim
    // only drops Coin/Gem; matches game.ts's previous `=== Gem ? gem : coin`).
    const isGem = inventoryType === EInventoryType.Gem;
    const template = isGem ? this.gemTemplate : this.coinTemplate;
    const inner = template !== null
      ? template.clone() // static meshes: shares geometry/materials — cheap
      : new THREE.Mesh(
        isGem ? this.fallbackGemGeometry : this.fallbackCoinGeometry,
        isGem ? this.fallbackGemMaterial : this.fallbackCoinMaterial,
      );
    const node = new THREE.Group();
    node.name = `pickup:${id}`;
    node.add(inner);
    this.root.add(node);
    return { node, age: 0, phase: handlePhase(id) };
  }

  private removeEntry(id: number, entry: PickupEntry): void {
    this.root.remove(entry.node);
    this.entries.delete(id);
    // Clones SHARE geometry/materials with their template (and fallback
    // meshes share the view-owned fallbacks) — nothing instance-exclusive to
    // GPU-dispose here; disposing shared resources would break live siblings.
    // Template/fallback disposal happens in dispose() (CharacterLibrary pattern).
  }
}
