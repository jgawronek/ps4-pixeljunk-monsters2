// src/core/GameCorePickupCurrency.ts
// TypeScript port of decomp/src/GameCore/GameCorePickupCurrency.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x4BFE20..0x4C0BA0).
//
// A coin/gem pickup: bounces on the terrain until it comes to rest, then is
// magnetically sucked to the player that collected it (Pickup()). On arrival it
// fires pickupAcquiredEvent and credits the inventory (coins only — gems are
// handled by the Q4 view, see Pickup()).
//
// TS ADAPTATIONS: Physics.gravity/SphereCast → physics-seam (UNITY_GRAVITY +
// Rapier queries, TerrainMask); `prefab as Q4.PickupCurrency` → structural
// presence of `value` on the prefab contract; GlobalSettingsContainer<
// DifficultySettings>.ValueCoinByDifficulty → getValueCoinByDifficulty()
// (SP default Max(1,v), data-verified rates 1.0).

import { Mathf, Vector3 } from '../engine/math';
import {
  getValueCoinByDifficulty,
  type PickupMovementContract,
  type PickupPrefabContract,
  type PickupViewerContract,
} from '../view/q4-contracts';
import { EInventoryType } from './GameCoreInventory';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreInventory } from './GameCoreInventory';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePickup } from './GameCorePickup';
import type { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import { getSimPhysics, Q4Layers, UNITY_GRAVITY } from './physics-seam';

const f = Math.fround;

export class GameCorePickupCurrency extends GameCorePickup {
  private m_value = 1; // 0xA0 (pre-base initializer)
  private m_attractOffset: Vector3 = Vector3.zero; // 0xA4
  private m_currentSpeed = f(0); // 0xB0
  private m_atRest = false; // 0xB4

  // get_Value @0x4C00C0
  get value(): number {
    return this.m_value;
  }

  // .ctor @0x4BFE20
  constructor(
    prefab: PickupPrefabContract | null,
    a_position: Vector3,
    type: EInventoryType,
    value = -1,
    movement: PickupMovementContract | null = null,
  ) {
    super(prefab, a_position, type, value, movement);
    // C#: `prefab as Q4.PickupCurrency` — TS: currency prefabs carry `value`.
    if (prefab === null || prefab.value === undefined) return;

    let v = value;
    if (v < 1) v = prefab.value; // prefab +0x3C
    this.m_value = v | 0;
    // Difficulty scaling: Max(1, amount * multiplayerRate * coinValueRate).
    // NOTE: applied to gems as well — faithful to the binary.
    this.m_value = getValueCoinByDifficulty(this.m_value) | 0;

    const viewer = this.getUnityObjectAs<PickupViewerContract>();
    let mv = movement;
    if (mv === null && viewer !== null) mv = viewer.getComponentPickupMovement();
    if (mv !== null) {
      const o = mv.attractOffset; // movement +0x38
      this.m_attractOffset = new Vector3(o.x, o.y, o.z);
    }
  }

  // DestroySelf @0x4C00D0 (virtual slot 6) — base behaviour only.
  override destroySelf(): void {
    super.destroySelf();
  }

  // Tick @0x4C00E0 (virtual slot 7)
  override tick(): void {
    if (!this.m_active) return;
    this.checkForWater();
    this.m_detectionDelay = Mathf.Max(f(0.0), f(this.m_detectionDelay - GameCore.tickDeltaTime));
    this.tickLifeSpan();
    if (this.m_active && !this.isDestroyed()) {
      this.updatePosition();
    }
  }

  // UpdatePosition @0x4C0180
  // Ballistic bounce until at rest; once a player is attached, suck to them.
  private updatePosition(): void {
    if (this.m_pickupPlayer === null) {
      if (!this.m_atRest) {
        const dt = GameCore.tickDeltaTime;
        this.m_currentVelocity = this.m_currentVelocity.add(UNITY_GRAVITY.mulScalar(dt));

        const dir = this.m_currentVelocity.normalized;
        const speed = this.m_currentVelocity.magnitude;
        const hit = getSimPhysics().sphereCast(
          this.position.x,
          this.position.y,
          this.position.z,
          dir.x,
          dir.y,
          dir.z,
          f(this.collision.height * 0.475),
          f(speed * dt),
          Q4Layers.terrainMask,
          'Ignore',
        );
        if (hit !== null) {
          // Stop at the surface, then reflect with bounce damping.
          const normal = new Vector3(hit.normal[0], hit.normal[1], hit.normal[2]);
          this.position = this.position.sub(dir.mulScalar(hit.distance));

          const bounceRate =
            this.m_bounceTime === -1.0 || this.m_bounceTime > 0.0
              ? this.m_bouncingRate
              : f(0.0);
          const factor = f(1.0 - Vector3.Dot(normal, dir));
          this.m_currentVelocity = Vector3.Reflect(this.m_currentVelocity, normal).mulScalar(
            f(factor * bounceRate),
          );
          // FAITHFUL QUIRK: the odd `!= -1 || > 0` condition (== -1 → unlimited,
          // 0 → already exhausted); decrement only when it holds.
          if (this.m_bounceTime !== -1.0 || this.m_bounceTime > 0.0) {
            this.m_bounceTime = f(this.m_bounceTime + -1.0); // -1 = unlimited bounces
          }

          if (this.m_currentVelocity.magnitude < 0.5) this.m_atRest = true;
        }

        this.position = this.position.add(this.m_currentVelocity.mulScalar(dt));
      }
    } else {
      this.suckToPlayer();
    }
  }

  // RecreateViewer @0x4C06F0 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let view = this.getUnityObjectAs<PickupViewerContract>();
    if (view === null) {
      view = GameCoreObject.createViewerFromPrefabName(
        this.m_prefabName!,
      ) as PickupViewerContract | null;
    }
    // FAITHFUL: the binary NREs when both lookups fail (return view.gameObject).
    return (view as PickupViewerContract).gameObject;
  }

  // SuckToPlayer @0x4C07A0
  // Accelerates toward player.position + m_attractOffset; on arrival, fires the
  // acquired event, credits inventory and destroys itself.
  // FAITHFUL: the binary dereferences m_pickupPlayer without null guards
  // (NullReferenceException if unset or no longer resolvable).
  suckToPlayer(): void {
    // Refresh to the current frame's version of the player.
    this.m_pickupPlayer =
      this.m_pickupPlayer!.handle.getMostRecentObjectVersion<GameCorePlayer>();

    const dt = GameCore.tickDeltaTime;
    const player = this.m_pickupPlayer!;
    const toTarget = player.position.add(this.m_attractOffset).sub(this.position);
    this.m_currentVelocity = toTarget.normalized;
    this.m_currentSpeed = f(this.m_currentSpeed + f(this.m_acceleration * dt));
    this.m_currentVelocity = this.m_currentVelocity.mulScalar(this.m_currentSpeed);

    const step = this.m_currentVelocity.mulScalar(dt);
    if (step.magnitude <= toTarget.magnitude) {
      this.position = this.position.add(step);
    } else {
      // Arrived: collect.
      Events.pickupAcquiredEvent.invoke(player, this);
      if (this.m_inventoryType !== EInventoryType.Gem) {
        // FAITHFUL QUIRK: gems are NOT credited here (the Q4.PickupCurrency
        // view handles them in OnPickupAcquired).
        GameCoreInventory.getInventoryObject()!.addInventory(
          player.handle,
          this.m_inventoryType,
          this.m_value,
        );
      }
      this.destroySelf();
    }
  }

  // Pickup @0x4C0AC0 (virtual slot 9)
  // Called by GameCorePlayer.CheckForPickups when in detection range.
  override pickup(player: GameCorePlayer): void {
    if (this.m_pickupPlayer === null && this.m_detectionDelay <= 0.0) {
      this.m_pickupPlayer = player;
      this.m_currentVelocity = player.position.sub(this.position).normalized;
      this.remainingLifespan = f(-1.0); // immortal while being collected
    }
  }

  // OnStageCleared @0x4C0B80 (virtual slot 10) — confirmed no-op.
  override onStageCleared(_manager: GameCoreWaveManager): void {}

  // OnGameOver @0x4C0B90 (virtual slot 11)
  override onGameOver(): void {
    this.m_active = false;
  }
}
