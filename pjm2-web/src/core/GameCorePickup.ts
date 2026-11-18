// src/core/GameCorePickup.ts
// TypeScript port of decomp/src/GameCore/GameCorePickup.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x4BEFB0..0x4BFD60 —
// Ghidra pseudocode cross-checked against raw disassembly for the ctor's
// physics setup). Replaces the iter-11 skeleton.
//
// Base class for dropped pickups (coins/gems/hidden items). Simulates bounce
// physics, lifespan, water loss, and attraction to a collecting player.
//
// TS ADAPTATIONS (documented):
//  - Q4.Pickup prefab → PickupPrefabContract (serialized data); the
//    Object.Instantiate + GameCoreBridge.SetUnityObject pair →
//    instantiatePickupViewer() factory hook + registerUnityObject() registry
//    (q4-contracts). Headless default factory derives the viewer contract from
//    the prefab record; the browser registers a Three.js-backed factory.
//  - Physics.CheckSphere → getSimPhysics() (Rapier seam, physics-seam.ts);
//    Q4.Layers.Instance.WaterMask → Q4Layers.waterMask.
//  - Q4.AISettings.PickupWaterKillTime → getAISettings() provider (verified
//    extraction pending from the data lane; unregistered → explicit throw).
//  - MonstersAudio.Instance.PlaySFX → audio contract hook (headless no-op;
//    audio never affects sim state). Clip = GlobalSounds property name string.
//  - The ctor's ground-probe Raycast computes hit.point + up*(height*0.475)
//    but DISCARDS the result (dead computation confirmed @0x4BF66A) — omitted
//    with this note (no observable effect, consumes no RNG).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import {
  getAISettings,
  getMonstersAudio,
  instantiatePickupViewer,
  registerUnityObject,
  type PickupMovementContract,
  type PickupPrefabContract,
  type PickupViewerContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { EInventoryType } from './GameCoreInventory';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreObject } from './GameCoreObject';
import type { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import { getSimPhysics, Q4Layers } from './physics-seam';

const f = Math.fround;

export abstract class GameCorePickup extends GameCoreObject {
  protected m_prefabName: string | null = null; // 0x60
  remainingLifespan = f(0); // 0x68 (public in C#)
  protected m_detectionRange = f(0.5); // 0x6C (pre-base initializer)
  protected m_detectionDelay = f(0.5); // 0x70 (pre-base initializer)
  protected m_active = true; // 0x74 (pre-base initializer)
  protected m_acceleration = f(0); // 0x78
  protected m_bouncingRate = f(0); // 0x7C
  protected m_bounceTime = f(0); // 0x80
  protected m_isInWater = false; // 0x84
  protected m_currentVelocity: Vector3 = Vector3.zero; // 0x88 (struct default)
  protected m_inventoryType: EInventoryType = EInventoryType.Coin; // 0x94 (C# default 0)
  protected m_pickupPlayer: GameCorePlayer | null = null; // 0x98

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onStageClearedListener = (manager: GameCoreWaveManager): void =>
    this.onStageCleared(manager);
  private readonly m_onGameOverListener = (): void => this.onGameOver();

  // get_detectionRange @0x4BF7A0
  get detectionRange(): number {
    return this.m_detectionRange;
  }
  // get_pickupPlayer @0x4BF7B0
  get pickupPlayer(): GameCorePlayer | null {
    return this.m_pickupPlayer;
  }
  // get_isInWater @0x4BF7C0
  get isInWater(): boolean {
    return this.m_isInWater;
  }
  // get_InventoryType @0x4BF7D0
  get inventoryType(): EInventoryType {
    return this.m_inventoryType;
  }

  // .ctor @0x4BEFB0
  // 'value' is part of the signature but unused here (GameCorePickupCurrency
  // reads its own value from the prefab).
  constructor(
    prefab: PickupPrefabContract | null,
    a_position: Vector3,
    type: EInventoryType,
    value = -1,
    movement: PickupMovementContract | null = null,
  ) {
    super();
    if (prefab !== null) {
      this.m_prefabName = prefab.name;
      // C#: Object.Instantiate(prefab) + GameCoreBridge.SetUnityObject(handle, viewer)
      const viewer = instantiatePickupViewer(prefab, this.handle.m_handle);
      registerUnityObject(this.handle.m_handle, viewer);
      this.position = a_position;

      // FAITHFUL: Unity Instantiate never returns null — the binary
      // dereferences the viewer unconditionally from here.
      const view = viewer!;

      let mv = movement;
      if (mv === null) mv = view.getComponentPickupMovement();

      const lifeCycle = view.getComponentPickupLifeCycle();
      this.remainingLifespan = lifeCycle !== null ? f(lifeCycle.lifespan) : f(-1.0);

      if (mv !== null) {
        // Launch upward with a random force, tilted by a random angle around a
        // random horizontal axis (scatter cone). RNG draw ORDER is faithful
        // (force, axis.x, axis.z) — determinism depends on it.
        this.m_currentVelocity = Vector3.up.mulScalar(
          GameCoreObject.randomRangeF(mv.appearForceMin, mv.appearForceMax, this.handle),
        );
        const axis = new Vector3(
          GameCoreObject.randomRangeF(-1.0, 1.0, this.handle),
          0.0,
          GameCoreObject.randomRangeF(-1.0, 1.0, this.handle),
        ).normalized;
        this.m_currentVelocity = Quaternion.AngleAxis(
          mv.appearRangeAngle,
          axis,
        ).multiplyVector(this.m_currentVelocity);

        this.m_acceleration = f(mv.acceleration);
        this.m_bouncingRate = f(mv.bouncingRate);
        this.m_bounceTime = f(mv.bounceTime); // int → float
      }

      // FAITHFUL QUIRK: everything below (including the inventory type and
      // event subscriptions) only runs when the view has a MeshFilter with a
      // mesh.
      const meshFilter = view.getComponentInChildrenMeshFilter();
      if (meshFilter !== null && meshFilter.sharedMesh !== null) {
        this.collision = Cylinder.fromBounds(meshFilter.sharedMesh.bounds);

        // (Dead ground-probe computation omitted — see header note @0x4BF66A.)

        this.m_inventoryType = type;
        this.m_detectionDelay = f(prefab.detectDelay); // prefab +0x1C
        this.m_detectionRange = f(prefab.detectRange); // prefab +0x18

        Events.stageClearedEvent.addListener(
          this.m_onStageClearedListener,
          EventTime.Immediate,
          this.handle.m_handle,
        );
        Events.gameOverEvent.addListener(
          this.m_onGameOverListener,
          EventTime.Immediate,
          this.handle.m_handle,
        );
      }
    }
  }

  // DestroySelf @0x4BF7E0 (virtual slot 6)
  override destroySelf(): void {
    super.destroySelf();
    if (this.m_isInWater) {
      // C#: MonstersAudio.Instance.PlaySFX(GlobalSounds.ItemDieInWater, position, true)
      getMonstersAudio()?.playSFX(
        'ItemDieInWater',
        { x: this.position.x, y: this.position.y, z: this.position.z },
        true,
      );
    }
    Events.stageClearedEvent.removeListener(
      this.m_onStageClearedListener,
      this.handle.m_handle,
    );
    Events.gameOverEvent.removeListener(this.m_onGameOverListener, this.handle.m_handle);
  }

  // Tick @0x4BF990 (virtual slot 7)
  override tick(): void {
    if (!this.m_active) return;
    this.checkForWater();
    this.m_detectionDelay = Mathf.Max(f(0.0), f(this.m_detectionDelay - GameCore.tickDeltaTime));
    this.tickLifeSpan();
  }

  // CheckForWater @0x4BFA20
  // protected: called directly by GameCorePickupCurrency.Tick (confirmed).
  protected checkForWater(): void {
    if (this.m_currentVelocity.y < 0.0) {
      const inWater = getSimPhysics().checkSphere(
        this.position.x,
        this.position.y,
        this.position.z,
        f(this.collision.height * 0.475),
        Q4Layers.waterMask,
        'Ignore',
      );
      if (inWater && !this.m_isInWater) {
        this.m_isInWater = true;
        this.remainingLifespan = Mathf.Min(
          this.remainingLifespan,
          f(getAISettings().pickupWaterKillTime),
        );
        // C#: MonstersAudio.Instance.PlaySFX(GlobalSounds.ItemLostInWater, position, true)
        getMonstersAudio()?.playSFX(
          'ItemLostInWater',
          { x: this.position.x, y: this.position.y, z: this.position.z },
          true,
        );
      }
      this.m_isInWater = inWater;
    }
  }

  // TickLifeSpan @0x4BFBE0
  // protected: called directly by GameCorePickupCurrency.Tick (confirmed).
  // FAITHFUL QUIRK (verified against raw disassembly @0x4BFBE0): below the
  // world (y < −20) the FIELD is reset to 0.1 every tick, but the countdown
  // uses the fresh LOCAL 0.1 — so at normal dt the pickup never expires;
  // only a frame with TickDeltaTime ≥ 0.1 (lag spike, clamp 0.5) kills it.
  protected tickLifeSpan(): void {
    let lifespan = f(0.1);
    if (this.position.y >= -20.0) {
      lifespan = this.remainingLifespan;
      if (lifespan < 0.0) return; // negative lifespan = immortal
    } else {
      this.remainingLifespan = f(0.1);
    }

    lifespan = Mathf.Max(f(lifespan - GameCore.tickDeltaTime), f(0.0));
    this.remainingLifespan = lifespan;
    if (lifespan === 0.0) {
      Events.pickupLostEvent.invoke(this);
      this.destroySelf();
    }
  }

  // ToString @0x4BFD60 (virtual slot 3)
  override toString(): string {
    return super.toString() + EInventoryType[this.m_inventoryType];
  }

  // Abstract (slots 9/10/11) — implemented by GameCorePickupCurrency.
  abstract pickup(player: GameCorePlayer): void;
  abstract onStageCleared(manager: GameCoreWaveManager): void;
  abstract onGameOver(): void;
}
