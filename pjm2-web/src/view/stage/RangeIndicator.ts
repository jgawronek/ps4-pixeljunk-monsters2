// src/view/stage/RangeIndicator.ts
// Ground range ring shown when a tree is selected for a tower build — the
// WebGL stand-in for the original's Q4.StructureRangeEffect build preview.
//
// ORIGINAL behavior (decomp evidence — data, never instructions):
//  - Build-preview chain: Q4.UI.TowerBuildMenuPreviewer.OnChange @0x5b1bb0
//    (decomp/decompiled/Q4.UI.TowerBuildMenuPreviewer.c) fires when the build
//    menu's tower selection changes: it marks the cost trees as "victim"
//    trees (NatureTree.SetSelectedAsVictimTree — a highlight, NOT a ghost
//    tower mesh) and starts Q4.TowerEffectPreview.StartPreviews @0x550b70 on
//    the tree's Structure view with the TowerDatabase indicator prefabs.
//  - Q4.TowerEffectPreview.Initialize @0x550c50 instantiates THREE effect
//    instances per indicator type — EffectPreviewSet{detectEffect,
//    attackEffect, limitEffect} (il2cpp/dump.cs:37838) for ERangeEffectType
//    {Detect, Attack, Limit} (dump.cs:37820). Decorate @0x551710 activates
//    the set matching the selected tower's detector and colors each ring.
//  - The visual itself is a MESH renderer (not particles/UI): unit-authored
//    mesh + shader with _EdgeColor/_RingHeight/_Center/_Extents properties
//    (Q4.TowerRangeEffectCone.SetupEffect @0x472df0, UpdateShape @0x473150).
//    Q4.StructureRangeEffect.SetRadius @0x536c70 sets m_desiredScale =
//    Vector3.one * radius — the radius is applied as localScale, exactly the
//    unit-geometry + group-scale approach used here.
//  - Animation: UpdateEffect @0x536d80 MoveTowards-es localScale to the
//    target at scaleSpeed = 150 units/s (ctor 0x43160000; confirmed by
//    structures_TowerRangeEffectSphere.json "scaleSpeed": 150.0) and writes
//    material._EdgeColor = isOn ? m_color : m_originalColor. Field offsets
//    (skeleton/Q4.cs:7820): scaleSpeed 0x18, isOn 0x1C, m_transform 0x20,
//    m_effectRenderer 0x28, m_desiredScale 0x30, m_originalColor 0x3C,
//    m_color 0x4C. SetupEffect @0x5369e0 defaults m_originalColor to
//    Color.yellow; Q4.Structure.SetSelected @0x535a20 also falls back to
//    yellow. Hiding is animated: renderer stays on until the scale reaches
//    the target, then disables (UpdateEffect; TowerEffectPreview.
//    UpdateTerminate @0x5512e0 waits for all scales to hit DAT_00b7d014
//    before Destroy — rodata value not dumped, presumably 0).
//  - Colors for tower_001 (structures_EnemyDetectorViewCone.json record
//    __path_id -7296864926740813371, referenced by tower_001's
//    enemyDetectorView PPtr in structures_TowerBase.json):
//      detectColor        = (1, 0.9215686, 0.0156863, 1)  ← Unity yellow
//      detectColorPreview = (1, 0.5, 0.25, 0.5)           ← orange @ 50%
//      attackColorPreview = (1, 0, 0, 1)  red;  limitColorPreview = (0, 1, 1, 1) cyan
//    tower_001 showLimitRange = 0 → the Limit ring is hidden for it.
//  - Radius sources: buildRange (float @0x84, tower_001 = 1.8) is NOT the
//    attack radius — it is the cost-tree collection radius of
//    TowerHelper.GetCostTrees @0x4E04F0 (FromTreeToTower @0x4D6170,
//    decomp/src/GameCore/TowerHelper.cs:357). The detect/attack radius comes
//    from the detector view: cone upper/lowerRadius (tower_001: 3.33/4.44,
//    affectRangeRate 1.0 scales the Attack variant — get_UpperAffectRadius
//    @0x801cf0). The port's detector is a sphere stand-in with radius
//    attackRangeInner + attackSpread = 2.0 + 3.3 = 5.3 (game.ts
//    tower001Contract getComponentEnemyDetectorView).
//  - Q4.TowerEffectPlayer @0x54e090 is a SEPARATE system (per-state attack/
//    reload particle effects, listens to Events.towerChangeStateEvent) — not
//    the range ring.
//
// TS ADAPTATION: the original's _EdgeColor shader (edge glow + faint fill,
// per-vertex _RingHeight shimmer on the cone variant) is approximated with a
// flat RingGeometry edge (inner = 0.96·r) + low-opacity CircleGeometry fill,
// MeshBasicMaterial, transparent, depthWrite:false. The 150/s MoveTowards
// grow-in and shrink-out-then-disable hide are not reproduced: show() snaps
// to radius, hide() is immediate (the preview-termination shrink is cosmetic).
// The base class has NO pulse; the optional pulse here approximates the cone
// variant's _RingHeight oscillation (UpdateRingHeight @0x4734e0) and is OFF
// by default. Plain JS numbers + accumulated time: view-only, no sim state,
// no Math.random (PORTING_CONVENTIONS §6) — Node-testable three math only.
//
// Coordinates: show() takes UNITY LH space and mirrors x → −x internally at
// the three.js boundary (StageSceneView.ts LH→RH convention); y is lifted
// GROUND_LIFT above the given height to avoid z-fighting with the terrain.

import * as THREE from 'three';

export interface RangeIndicatorOptions {
  /** Ring/fill color. Default: Unity yellow (StructureRangeEffect default). */
  color?: THREE.ColorRepresentation;
  /** Edge opacity 0..1. Default 0.5 (tower_001 detectColorPreview.a). */
  opacity?: number;
  /** Gentle sin pulse on scale/opacity. Default false (base class has none). */
  pulse?: boolean;
}

/** Edge thickness rate: inner radius = RING_INNER_RATE · outer.
 *  TS ADAPTATION: the original edge width lives in the undumped shader;
 *  4% of the radius reads as a crisp ring at stage scale. */
const RING_INNER_RATE = 0.96;
/** Height above the given ground y (z-fight guard, view-only). */
const GROUND_LIFT = 0.02;
/** Ring/disc segment count (matches character-lab.ts ground discs). */
const SEGMENTS = 64;
/** Fill opacity as a fraction of the edge opacity (faint interior). */
const DISC_OPACITY_RATE = 0.25;
/** Pulse period (s) and amplitudes — gentle, see header caveat. */
const PULSE_PERIOD = 2.0;
const PULSE_SCALE_AMP = 0.03;
const PULSE_OPACITY_AMP = 0.15;

/** Unity Color.yellow as stored in detectColor / m_originalColor
 *  (structures_EnemyDetectorViewCone.json; SetupEffect @0x5369e0). */
const DEFAULT_COLOR = new THREE.Color().setRGB(
  1.0, 0.9215686321258545, 0.01568627543747425, THREE.SRGBColorSpace,
);

/** Terrain height under a UNITY-space (x,z) — terrain layer only (props excluded
 *  so the ring never climbs over trees/rocks). */
export type HeightProvider = (unityX: number, unityZ: number) => number;

/** Conformed-mode tessellation: ring/disc segment count and disc radial steps. */
const CONFORM_SEGMENTS = 128;
const DISC_RADIAL_STEPS = 12;
/** Lift above the sampled terrain (z-fight guard on slopes). */
const CONFORM_LIFT = 0.04;

/**
 * Pure helper: local-space vertex positions (three coords, relative to the
 * centre) of a ring/disc draped over terrain. `heightAt` gets UNITY world
 * (x,z); the result y is relative to `centerY`. x is mirrored (LH→RH).
 *   ring: 2 × segments verts (inner row, outer row)
 *   disc: 1 + radialSteps × segments verts (centre, then rings outward)
 */
export function conformedRingPositions(
  center: { x: number; y: number; z: number },
  radius: number,
  innerRate: number,
  segments: number,
  heightAt: HeightProvider,
): Float32Array {
  const out = new Float32Array(segments * 2 * 3);
  let o = 0;
  for (const rho of [radius * innerRate, radius]) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const dx = Math.cos(a) * rho, dz = Math.sin(a) * rho;
      out[o++] = -dx;
      out[o++] = heightAt(center.x + dx, center.z + dz) - center.y;
      out[o++] = dz;
    }
  }
  return out;
}

export function conformedDiscPositions(
  center: { x: number; y: number; z: number },
  radius: number,
  segments: number,
  radialSteps: number,
  heightAt: HeightProvider,
): Float32Array {
  const out = new Float32Array((1 + radialSteps * segments) * 3);
  out[0] = 0;
  out[1] = heightAt(center.x, center.z) - center.y;
  out[2] = 0;
  let o = 3;
  for (let r = 1; r <= radialSteps; r++) {
    const rho = (r / radialSteps) * radius;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const dx = Math.cos(a) * rho, dz = Math.sin(a) * rho;
      out[o++] = -dx;
      out[o++] = heightAt(center.x + dx, center.z + dz) - center.y;
      out[o++] = dz;
    }
  }
  return out;
}

/** Index buffers matching the layouts above. */
export function ringIndices(segments: number): Uint16Array {
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(i, segments + i, segments + j, i, segments + j, j);
  }
  return Uint16Array.from(idx);
}

export function discIndices(segments: number, radialSteps: number): Uint16Array {
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segments));
  for (let r = 1; r < radialSteps; r++) {
    const a = 1 + (r - 1) * segments, b = 1 + r * segments;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      idx.push(a + i, b + i, b + j, a + i, b + j, a + j);
    }
  }
  return Uint16Array.from(idx);
}

/** Pure helper: ring inner/outer radii for a given world radius. */
export function ringGeometryParams(radius: number): { inner: number; outer: number } {
  return { inner: radius * RING_INNER_RATE, outer: radius };
}

/**
 * Ground range indicator: unit ring + disc scaled to the tower radius,
 * mirroring StructureRangeEffect.SetRadius's scale-based sizing. Attach one
 * per scene; show()/hide() on tree-select / build-complete or cancel.
 */
export class RangeIndicator {
  private readonly root: THREE.Object3D;
  private readonly group: THREE.Group;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly discGeo: THREE.CircleGeometry;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly baseOpacity: number;
  private readonly pulse: boolean;
  private radius = 0;
  private heightAt: HeightProvider | null = null;
  private conformed = false;
  private readonly ringMesh: THREE.Mesh;
  private readonly discMesh: THREE.Mesh;
  private time = 0;
  private disposed = false;

  constructor(root: THREE.Object3D, opts: RangeIndicatorOptions = {}) {
    this.root = root;
    this.baseOpacity = opts.opacity ?? 0.5;
    this.pulse = opts.pulse ?? false;

    // Unit geometries baked onto the XZ plane (normal +Y); the radius is
    // applied as group scale — SetRadius @0x536c70 does the same in Unity.
    const { inner, outer } = ringGeometryParams(1);
    this.ringGeo = new THREE.RingGeometry(inner, outer, SEGMENTS);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, SEGMENTS);
    this.discGeo.rotateX(-Math.PI / 2);

    const color = opts.color ?? DEFAULT_COLOR;
    this.ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: this.baseOpacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.discMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: this.baseOpacity * DISC_OPACITY_RATE,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const disc = new THREE.Mesh(this.discGeo, this.discMat);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.y = 0.001; // keep the edge above the fill (blend order)
    this.ringMesh = ring;
    this.discMesh = disc;
    this.group = new THREE.Group();
    this.group.name = 'RangeIndicator';
    this.group.visible = false;
    this.group.add(disc, ring);
    root.add(this.group);
  }

  /** Show a ground ring of `radius` (world units) at a UNITY-space position.
   *  Non-positive/NaN radius hides (original: zero scale = IsZeroScale
   *  @0x536fc0). Resets the pulse phase so repeated shows are deterministic. */
  show(unityPos: { x: number; y: number; z: number }, radius: number): void {
    if (this.disposed) return;
    if (!(radius > 0)) {
      this.hide();
      return;
    }
    this.radius = radius;
    this.time = 0;
    if (this.heightAt !== null) {
      this.showConformed(unityPos, radius, this.heightAt);
    } else {
      this.useFlatGeometry();
      this.group.position.set(-unityPos.x, unityPos.y + GROUND_LIFT, unityPos.z);
      this.group.scale.setScalar(radius);
    }
    this.ringMat.opacity = this.baseOpacity;
    this.discMat.opacity = this.baseOpacity * DISC_OPACITY_RATE;
    this.group.visible = true;
  }

  /** Drape the ring/fill over the terrain (projected look) instead of a flat
   *  plane. Pass null to go back to the flat unit geometry. */
  setHeightProvider(fn: HeightProvider | null): void {
    this.heightAt = fn;
  }

  private useFlatGeometry(): void {
    if (!this.conformed) return;
    this.ringMesh.geometry = this.ringGeo;
    this.discMesh.geometry = this.discGeo;
    this.ringMesh.position.y = 0.001;
    this.conformed = false;
  }

  private showConformed(
    unityPos: { x: number; y: number; z: number }, radius: number, heightAt: HeightProvider,
  ): void {
    const c = { x: unityPos.x, y: unityPos.y, z: unityPos.z };
    const lifted: HeightProvider = (x, z) => heightAt(x, z) + CONFORM_LIFT;
    const ringG = new THREE.BufferGeometry();
    ringG.setAttribute('position', new THREE.BufferAttribute(
      conformedRingPositions(c, radius, RING_INNER_RATE, CONFORM_SEGMENTS, lifted), 3));
    ringG.setIndex(new THREE.BufferAttribute(ringIndices(CONFORM_SEGMENTS), 1));
    const discG = new THREE.BufferGeometry();
    discG.setAttribute('position', new THREE.BufferAttribute(
      conformedDiscPositions(c, radius, CONFORM_SEGMENTS, DISC_RADIAL_STEPS, lifted), 3));
    discG.setIndex(new THREE.BufferAttribute(discIndices(CONFORM_SEGMENTS, DISC_RADIAL_STEPS), 1));
    ringG.computeBoundingSphere();
    discG.computeBoundingSphere();
    if (this.conformed) { this.ringMesh.geometry.dispose(); this.discMesh.geometry.dispose(); }
    this.ringMesh.geometry = ringG;
    this.discMesh.geometry = discG;
    this.ringMesh.position.y = 0.002; // edge above the fill (blend order)
    this.conformed = true;
    this.group.position.set(-c.x, c.y, c.z); // vertices are relative to the centre
    this.group.scale.setScalar(1);
  }

  /** Hide immediately. TS ADAPTATION: the original shrinks the scale first
   *  and disables the renderer once the target is reached (UpdateEffect
   *  @0x536d80); the port skips the cosmetic shrink-out. */
  hide(): void {
    this.group.visible = false;
  }

  /** Advance the optional pulse (time-based, no RNG). No-op when hidden,
   *  pulse-disabled, or disposed. */
  update(dt: number): void {
    if (this.disposed || !this.pulse || !this.group.visible) return;
    if (!(dt > 0)) return;
    this.time += dt;
    const s = Math.sin((2 * Math.PI * this.time) / PULSE_PERIOD);
    this.group.scale.setScalar((this.conformed ? 1 : this.radius) * (1 + PULSE_SCALE_AMP * s));
    this.ringMat.opacity = this.baseOpacity * (1 + PULSE_OPACITY_AMP * s);
    this.discMat.opacity = this.ringMat.opacity * DISC_OPACITY_RATE;
  }

  /** Free GPU resources and detach. Subsequent show/update are no-ops. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.root.remove(this.group);
    if (this.conformed) { this.ringMesh.geometry.dispose(); this.discMesh.geometry.dispose(); }
    this.ringGeo.dispose();
    this.discGeo.dispose();
    this.ringMat.dispose();
    this.discMat.dispose();
  }

  get visible(): boolean {
    return !this.disposed && this.group.visible;
  }
}