// src/core/GameCoreFruit.ts
// TypeScript port of decomp/src/GameCore/GameCoreFruit.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3048,
// RVA 0x4B5AD0..0x4B99F0). Replaces the iter-11 skeleton.
// Simulation-side throwable "fruit" item (bomb/trampoline/flare consumables):
// mini bounce physics, enemy/player/interaction detection, BuffSetting
// application, grab/carry/drop/throw (IGrabbable).
//
// ALL float constants CONFIRMED by ELF float read (iter 19; the C#
// reconstruction's INFERRED values were corrected — see its header).
//
// TS ADAPTATIONS: Q4.Fruit → FruitContract (data + viewer accessors; headless
// factory returns the record itself); Physics → Rapier seam (CheckWater uses
// 'Collide' — water zones are triggers; movement sweeps use Unity's default
// 'UseGlobal'); MonstersAudio/GestureManager → contract hooks; C# `Zero`
// alias split per raw use-site (0.1 below-world / 0.0 expiry / 1.0 cap+align).

import { Mathf, Quaternion, Vector3 } from '../engine/math';
import {
  getAISettings,
  getMonstersAudio,
  instantiateFruitViewer,
  notifyRumble,
  registerUnityObject,
  type FruitContract,
  type PickupMovementContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { EBuffTriggerTarget } from './enums';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreInteractionObject } from './GameCoreInteractionObject';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import type { IGrabbable } from './interfaces';
import { getSimPhysics, Q4Layers, UNITY_GRAVITY } from './physics-seam';
import type { PlayerViewContract } from '../view/q4-contracts';

const f = Math.fround;

export class GameCoreFruit extends GameCoreObject implements IGrabbable {
  private m_active = false; // 0x60
  private m_atRest = false; // 0x61
  private m_prefabName: string | null = null; // 0x68
  remainingLifespan = f(0); // 0x70 (public)
  private m_enemyDetectionRange = f(0); // 0x74
  private m_playerDetectionRange = f(0); // 0x78
  private m_playerJumpDetectionRange = f(0); // 0x7C
  private m_playerDetectionRangeMax = f(0); // 0x80
  private m_detectionDelay = f(0); // 0x84
  private m_acceleration = f(0); // 0x88
  private m_bouncingRate = f(0); // 0x8C
  private m_bounceTime = f(0); // 0x90
  private m_currentVelocity: Vector3 = Vector3.zero; // 0x94
  private m_usageRemain = 0; // 0xA0
  private m_cooldownTime = f(0); // 0xA4
  private m_currentCooldownTime = f(0); // 0xA8
  private m_destroyWhenUsedUp = false; // 0xAC
  private m_textKey: string | null = null; // 0xB0
  protected m_isInWater = false; // 0xB8
  protected isNonInteractable = false; // 0xB9 [C# casing]
  /** @internal semantics — GameCorePlayer.OnFruitPickedUp writes directly. */
  m_playerOwner: GameCoreHandle = GameCoreHandle.nullHandle; // 0xC0
  /** @internal semantics — GameCorePlayer.OnFruitPickedUp writes directly. */
  m_lastPlayerOwner: GameCoreHandle = GameCoreHandle.nullHandle; // 0xE0
  private m_alreadyPlayingRumblePlayer: GameCorePlayer[] = []; // 0x100

  // ---- constants (ALL CONFIRMED by ELF float read, iter 19) ----
  private static readonly defaultEnemyDetectionRange = f(1.0); // DAT_00b7c540
  private static readonly defaultPlayerJumpDetectionRange = f(0.5); // DAT_00b7c548
  private static readonly defaultDetectionDelay = f(0.5); // 0x3f000000
  private static readonly randomAxisComponentMin = f(-1.0); // DAT_00b7c2f0 (also lifespan fallback)
  private static readonly randomAxisComponentMax = f(1.0); // DAT_00b7c2f4
  private static readonly groundSnapRayDistance = f(100.0); // DAT_00b7c2f8
  private static readonly groundSnapRadiusFactor = f(0.475); // DAT_00b7c2fc
  private static readonly waterCheckSphereRadiusFactor = f(0.475); // DAT_00b7c304
  private static readonly waterRaycastDistance = f(2.0); // DAT_00b7c308
  private static readonly killBelowWorldY = f(-20.0); // DAT_00b7c30c
  private static readonly belowWorldLifespan = f(0.1); // DAT_00b7c310
  private static readonly expiredLifespan = f(0.0); // DAT_00b7c314
  private static readonly separationVelocityCap = f(1.0); // DAT_00b7c320
  private static readonly bounceAlignmentBase = f(1.0); // DAT_00b7c320 reused
  private static readonly heldHeightOffset = f(0.5); // DAT_00b7c318
  private static readonly separationVelocityDamping = f(-0.75); // DAT_00b7c31c
  private static readonly separationJitterMin = f(-0.1); // DAT_00b7c324
  private static readonly separationJitterMax = f(0.1); // DAT_00b7c328
  private static readonly movementSphereRadiusFactor = f(0.475); // DAT_00b7c32c
  private static readonly bounceTimeDecrement = f(-1.0); // DAT_00b7c330 sentinel
  private static readonly restProbeHeight = f(2.0); // DAT_00b7c334
  private static readonly restProbeRadiusFactor = f(0.475); // DAT_00b7c32c reused
  private static readonly restProbeDistancePadding = f(2.1); // DAT_00b7c338
  private static readonly restSpeedThreshold = f(0.25); // DAT_00b7c33c
  private static readonly queryRadiusMargin = f(0.1); // DAT_00b7c340
  private static readonly queryHeight = f(4.0); // DAT_00b7c344
  private static readonly interactionQueryDownOffset = f(0.25); // DAT_00b7c348
  private static readonly interactionQueryRadius = f(0.5); // DAT_00b7c34c
  private static readonly jumpTriggerDeltaY = f(-0.11); // DAT_00b7c350
  private static readonly playerTriggerHeightFactor = f(0.5); // DAT_00b7c354
  private static readonly gentleDropForceThreshold = f(0.001); // DAT_00b7c358
  private static readonly gentleDropRayDistance = f(100.0); // DAT_00b7c35c
  private static readonly gentleDropRadiusFactor = f(0.475); // DAT_00b7c360
  private static readonly throwDropSphereRadiusFactor = f(0.5); // DAT_00b7c364
  private static readonly throwDropProbeHeight = f(1.0); // DAT_00b7c368
  private static readonly throwDropProbeMaxDistance = f(1.05); // DAT_00b7c36c
  private static readonly throwDropLandingClearance = f(-0.05); // DAT_00b7c370 NEGATIVE

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onStageClearedListener = (manager: GameCoreWaveManager): void =>
    this.onStageCleared(manager);
  private readonly m_onGameOverListener = (): void => this.onGameOver();

  // .ctor @0x4B5AD0
  constructor(
    prefab: FruitContract | null,
    isPrefab: boolean,
    a_position: Vector3,
    movement: PickupMovementContract | null,
  ) {
    super();
    // Field initializers (C# prologue, before base — equivalent here).
    this.m_enemyDetectionRange = GameCoreFruit.defaultEnemyDetectionRange;
    this.m_playerJumpDetectionRange = GameCoreFruit.defaultPlayerJumpDetectionRange;
    this.m_detectionDelay = GameCoreFruit.defaultDetectionDelay;
    this.m_currentVelocity = Vector3.zero;
    this.m_playerOwner = GameCoreHandle.nullHandle;
    this.m_lastPlayerOwner = GameCoreHandle.nullHandle;
    this.m_alreadyPlayingRumblePlayer = [];

    let viewer: FruitContract | null;
    if (isPrefab) {
      viewer = instantiateFruitViewer(prefab!, this.handle.m_handle); // Object.Instantiate
      this.m_prefabName = prefab!.name;
    } else {
      viewer = prefab;
      this.m_prefabName = null;
    }

    // FAITHFUL: viewer dereferenced without a null check (NRE on null).
    const view = viewer!;
    this.isNonInteractable = view.isNonInteractable;
    registerUnityObject(this.handle.m_handle, view); // bridge SetUnityObject
    this.position = a_position;

    let mv = movement;
    if (mv === null) mv = view.getComponentPickupMovement();

    // FAITHFUL (reconstruction INFERRED note): a second PickupMovement lookup
    // supplies the initial lifespan via its acceleration field; fallback -1
    // (immortal) when missing.
    const lifeSource = view.getComponentPickupMovement();
    this.remainingLifespan =
      lifeSource !== null ? f(lifeSource.acceleration) : GameCoreFruit.randomAxisComponentMin;

    if (isPrefab) {
      // Appear pop: up × random force, tilted by appearRangeAngle around a
      // random horizontal axis. FAITHFUL: mv dereferenced without null check.
      this.m_currentVelocity = Vector3.up.mulScalar(
        GameCoreObject.randomRangeF(mv!.appearForceMin, mv!.appearForceMax, this.handle),
      );
      const angle = mv!.appearRangeAngle;
      const axisX = GameCoreObject.randomRangeF(
        GameCoreFruit.randomAxisComponentMin,
        GameCoreFruit.randomAxisComponentMax,
        this.handle,
      );
      const axisZ = GameCoreObject.randomRangeF(
        GameCoreFruit.randomAxisComponentMin,
        GameCoreFruit.randomAxisComponentMax,
        this.handle,
      );
      const axis = new Vector3(axisX, 0.0, axisZ);
      this.m_currentVelocity = Quaternion.AngleAxis(angle, axis.normalized).multiplyVector(
        this.m_currentVelocity,
      );
    }

    if (mv !== null) {
      this.m_acceleration = f(mv.acceleration);
      this.m_bouncingRate = f(mv.bouncingRate);
      this.m_bounceTime = f(mv.bounceTime); // int → float
    }

    const meshFilter = view.getComponentInChildrenMeshFilter();
    if (meshFilter === null || meshFilter.sharedMesh === null) {
      // No render mesh: collision from the prefab ground scale (r=s, h=2s).
      const s = f(view.scaleGround);
      this.collision = new Cylinder(s, f(s + s));
    } else {
      this.collision = Cylinder.fromBounds(meshFilter.sharedMesh.bounds);
      this.collision = new Cylinder(
        f(this.collision.radius * view.scaleGround),
        f(this.collision.height * view.scaleGround),
      );
      // Snap the spawn position onto the terrain below ('Collide' — literal 2).
      const hit = getSimPhysics().raycast(
        a_position.x, f(a_position.y + 1), a_position.z,
        0, -1, 0,
        GameCoreFruit.groundSnapRayDistance,
        Q4Layers.terrainMask,
        'Collide',
      );
      if (hit !== null) {
        this.position = new Vector3(
          hit.point[0],
          f(hit.point[1] + f(this.collision.radius * GameCoreFruit.groundSnapRadiusFactor)),
          hit.point[2],
        );
      }
    }

    if (prefab !== null) {
      this.m_detectionDelay = f(prefab.detectDelay);
      this.m_cooldownTime = f(prefab.cooldownTime);
      this.m_currentCooldownTime = f(0.0);
      this.m_enemyDetectionRange = f(prefab.enemyDetectRange);
      this.m_playerDetectionRange = f(prefab.playerDetectRange);
      this.m_playerJumpDetectionRange = f(prefab.playerJumpDetectRange);
      this.m_playerDetectionRangeMax = Mathf.Max(
        this.m_playerDetectionRange,
        this.m_playerJumpDetectionRange,
      );

      // EventTime from unread rodata (DAT_010d5118/DAT_010d4fa8) — Immediate
      // assumed per reconstruction TODO.
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

      this.m_usageRemain = view.usage | 0;
      this.m_destroyWhenUsedUp = view.destroyWhenUsedUp;
      this.m_textKey = view.textKey;
    }

    this.m_alreadyPlayingRumblePlayer.length = 0;
    this.m_active = true;
  }

  // ---- properties ----

  get enemyDetectionRange(): number {
    return this.m_enemyDetectionRange;
  }
  get playerDetectionRange(): number {
    return this.m_playerDetectionRange;
  }
  get playerJumpDetectionRange(): number {
    return this.m_playerJumpDetectionRange;
  }
  get playerDetectionRangeMax(): number {
    return this.m_playerDetectionRangeMax;
  }
  // get_remainingUses @0x4B6690
  get remainingUses(): number {
    return this.m_usageRemain;
  }
  // get_textKey @0x4B66A0
  get textKey(): string | null {
    return this.m_textKey;
  }
  // get_isHeld @0x4B66B0
  get isHeld(): boolean {
    return this.playerOwner !== null;
  }
  // get_IsInteractable @0x4B6830
  get isInteractable(): boolean {
    return (
      !this.isNonInteractable &&
      this.playerOwner === null &&
      this.m_active &&
      this.m_usageRemain > 0
    );
  }
  // get_playerOwner @0x4B66D0 — resolves latest version; clears stale handle.
  get playerOwner(): GameCorePlayer | null {
    if (this.m_playerOwner.m_handle === -1) return null;
    const player = this.m_playerOwner.getMostRecentObjectVersion<GameCorePlayer>();
    if (player === null) this.m_playerOwner = GameCoreHandle.nullHandle;
    return player;
  }
  // get_LastPlayerOwner @0x4B6870
  get lastPlayerOwner(): GameCoreHandle {
    return this.m_lastPlayerOwner;
  }

  // DestroySelf @0x4B6880 (virtual slot 6)
  override destroySelf(): void {
    super.destroySelf();
    Events.fruitVanishEvent.invoke(this);
    if (this.m_isInWater) {
      // C#: MonstersAudio.Instance.PlaySFX(GlobalSounds.FruitWaterDie, position)
      getMonstersAudio()?.playSFX('FruitWaterDie', {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      });
    }
    Events.stageClearedEvent.removeListener(this.m_onStageClearedListener, this.handle.m_handle);
    Events.gameOverEvent.removeListener(this.m_onGameOverListener, this.handle.m_handle);
  }

  // Tick @0x4B6A70 (virtual slot 7)
  override tick(): void {
    if (!this.m_active || this.isDestroyed()) return;

    if (this.playerOwner === null) this.checkWater();
    this.tickLifeSpan();

    // TickCooldown @0x4B7110 inlined (confirmed identical decrements).
    const dt = GameCore.tickDeltaTime;
    this.m_detectionDelay = Mathf.Max(f(this.m_detectionDelay - dt), f(0.0));
    this.m_currentCooldownTime = Mathf.Max(f(this.m_currentCooldownTime - dt), f(0.0));

    this.tickPosition();

    if (
      this.m_currentCooldownTime <= GameCoreFruit.expiredLifespan &&
      this.m_detectionDelay <= GameCoreFruit.expiredLifespan &&
      this.m_playerOwner.m_handle < 0 &&
      this.m_usageRemain > 0
    ) {
      this.tickHitEnemy();
      this.tickHitPlayer();
      this.tickHitInteractableObject();
    }
  }

  // CheckWater @0x4B6BC0
  private checkWater(): void {
    if (this.m_currentVelocity.y >= 0.0) return;

    let inWater = false;
    const sphere = getSimPhysics().checkSphere(
      this.position.x, this.position.y, this.position.z,
      f(this.collision.radius * GameCoreFruit.waterCheckSphereRadiusFactor),
      Q4Layers.waterMask,
      'Collide', // water zones are triggers — literal 2
    );
    if (sphere) {
      const hit = getSimPhysics().raycast(
        this.position.x, f(this.position.y + 1), this.position.z,
        0, -1, 0,
        GameCoreFruit.waterRaycastDistance,
        (Q4Layers.waterMask | Q4Layers.terrainMask) | 0,
        'Collide',
      );
      inWater = true; // default when the ray misses entirely (faithful)
      if (hit !== null) {
        inWater = hit.layer === Q4Layers.waterIndex;
      }

      if (inWater && !this.m_isInWater) {
        this.m_isInWater = true;
        const killTime = f(getAISettings().pickupWaterKillTime);
        this.remainingLifespan =
          this.remainingLifespan >= 0.0
            ? Mathf.Min(this.remainingLifespan, killTime)
            : killTime;
        getMonstersAudio()?.playSFX('FruitWaterSplash', {
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
        });
      }
    }
    this.m_isInWater = inWater;
  }

  // TickLifeSpan @0x4B6F90
  // FAITHFUL QUIRK (raw @0x4B6F90, same structure as pickup): below the world
  // the FIELD is reset to 0.1 but the countdown uses the fresh LOCAL 0.1 —
  // a fruit that STAYS below −20 never expires; it must rise above first.
  private tickLifeSpan(): void {
    if (this.position.y < GameCoreFruit.killBelowWorldY) {
      this.remainingLifespan = GameCoreFruit.belowWorldLifespan; // 0.1 (raw line 842)
    } else if (this.remainingLifespan < 0.0) {
      return; // negative == immortal
    }

    this.remainingLifespan = Mathf.Max(f(this.remainingLifespan - GameCore.tickDeltaTime), f(0.0));
    if (this.remainingLifespan === GameCoreFruit.expiredLifespan) {
      Events.fruitVanishEvent.invoke(this);
      this.destroySelf();
    }
  }

  // TickPosition @0x4B71E0
  private tickPosition(): void {
    const owner = this.playerOwner;
    if (owner !== null) {
      this.position = owner.position.add(Vector3.up.mulScalar(GameCoreFruit.heldHeightOffset));
      return;
    }

    if (this.m_atRest || this.isNonInteractable) return;

    let sphereHit = false;
    let rayHit = false;

    // (a) Separate from the first other fruit (only while descending).
    if (this.m_currentVelocity.y < 0.0) {
      let other: GameCoreFruit | null = null;
      for (const fruit of GameCore.instance!.allObjectsIn<GameCoreFruit>(
        GameCoreFruit,
        this.position,
        this.collision,
      )) {
        if (fruit === this) continue;
        other = fruit;
        break; // at most one separation per tick (faithful)
      }

      // FAITHFUL: damping is NEGATIVE (−0.75) and the cap is 1.0 (raw 1077).
      this.m_currentVelocity = new Vector3(
        this.m_currentVelocity.x,
        Mathf.Min(
          f(this.m_currentVelocity.y * GameCoreFruit.separationVelocityDamping),
          GameCoreFruit.separationVelocityCap,
        ),
        this.m_currentVelocity.z,
      );

      if (other !== null) {
        const delta = other.position.sub(this.position);
        const distance = f(delta.magnitude - f(this.collision.radius + other.collision.radius));
        if (distance < 0.0) {
          const dir = delta.normalized;
          const push = dir.mulScalar(distance);
          this.position = this.position.add(push);
          other.position = other.position.sub(push);
          this.m_currentVelocity = this.m_currentVelocity.add(
            new Vector3(
              GameCoreObject.randomRangeF(GameCoreFruit.separationJitterMin, GameCoreFruit.separationJitterMax, this.handle),
              GameCoreObject.randomRangeF(GameCoreFruit.separationJitterMin, GameCoreFruit.separationJitterMax, this.handle),
              GameCoreObject.randomRangeF(GameCoreFruit.separationJitterMin, GameCoreFruit.separationJitterMax, this.handle),
            ),
          );
        }
      }
    }

    // (b) Gravity + terrain sweep with bounce.
    const dt = GameCore.tickDeltaTime;
    this.m_currentVelocity = this.m_currentVelocity.add(UNITY_GRAVITY.mulScalar(dt));

    const dir = this.m_currentVelocity.normalized;
    const sphereRadius = f(this.collision.radius * GameCoreFruit.movementSphereRadiusFactor);
    const moveHit = getSimPhysics().sphereCast(
      this.position.x, this.position.y, this.position.z,
      dir.x, dir.y, dir.z,
      sphereRadius,
      f(this.m_currentVelocity.magnitude * dt),
      Q4Layers.terrainMask,
      // no explicit mode in C# → Unity global default
      'UseGlobal',
    );
    sphereHit = moveHit !== null;
    if (moveHit !== null) {
      this.position = this.position.sub(dir.mulScalar(moveHit.distance));

      const normal = new Vector3(moveHit.normal[0], moveHit.normal[1], moveHit.normal[2]);
      const alignment = f(GameCoreFruit.bounceAlignmentBase - Vector3.Dot(normal, dir));
      const rate =
        this.m_bounceTime === GameCoreFruit.bounceTimeDecrement || this.m_bounceTime > 0.0
          ? this.m_bouncingRate
          : f(0.0);
      this.m_currentVelocity = Vector3.Reflect(this.m_currentVelocity, normal).mulScalar(
        f(alignment * rate),
      );
      if (this.m_bounceTime !== GameCoreFruit.bounceTimeDecrement || this.m_bounceTime > 0.0) {
        this.m_bounceTime = f(this.m_bounceTime + GameCoreFruit.bounceTimeDecrement);
      }
      getMonstersAudio()?.playSFX('FruitBounce', {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      });
    }

    // (c) Integrate.
    this.position = this.position.add(this.m_currentVelocity.mulScalar(dt));

    // (d) Ground snap probe when the sweep missed.
    if (!sphereHit) {
      const snapRadius = f(this.collision.radius * GameCoreFruit.restProbeRadiusFactor);
      const snapHit = getSimPhysics().raycast(
        this.position.x, f(this.position.y + GameCoreFruit.restProbeHeight), this.position.z,
        0, -1, 0,
        f(snapRadius + GameCoreFruit.restProbeDistancePadding),
        Q4Layers.terrainMask,
        'UseGlobal',
      );
      rayHit = snapHit !== null;
      if (snapHit !== null && snapHit.distance < f(GameCoreFruit.restProbeHeight - snapRadius)) {
        this.position = new Vector3(
          snapHit.point[0],
          f(snapHit.point[1] + snapRadius),
          snapHit.point[2],
        );
        this.m_currentVelocity = Vector3.zero;
      }
    }

    // (e) Rest detection.
    if ((sphereHit || rayHit) && this.m_currentVelocity.magnitude < GameCoreFruit.restSpeedThreshold) {
      this.m_atRest = true;
    }
  }

  // Triggerable @0x4B7FD0
  triggerable(): boolean {
    return (
      !(this.m_currentCooldownTime > 0.0) &&
      !(this.m_detectionDelay > 0.0) &&
      this.m_playerOwner.m_handle < 0 &&
      this.m_usageRemain > 0
    );
  }

  // TickHitEnemy @0x4B8010
  tickHitEnemy(): void {
    const query = new Cylinder(
      f(this.m_enemyDetectionRange + GameCoreFruit.queryRadiusMargin),
      GameCoreFruit.queryHeight,
    );
    for (const enemy of GameCore.instance!.allObjectsIn<GameCoreEnemy>(GameCoreEnemy, this.position, query)) {
      const distance = Vector3.Distance(enemy.position, this.position);
      if (f(distance - enemy.collision.radius) <= this.m_enemyDetectionRange) {
        this.triggerInteraction(enemy, distance);
        break;
      }
    }
  }

  // TickHitPlayer @0x4B8370
  tickHitPlayer(): void {
    for (const player of GameCore.instance!.allObjects<GameCorePlayer>(GameCorePlayer)) {
      if (player === null || player.isDestroyed()) continue;

      const distance = Vector3.Distance(player.position, this.position);
      if (f(distance - player.collision.radius) < this.m_playerDetectionRangeMax) {
        this.triggerInteraction(player, distance);
        return;
      }
      const idx = this.m_alreadyPlayingRumblePlayer.indexOf(player);
      if (idx !== -1) this.m_alreadyPlayingRumblePlayer.splice(idx, 1);
    }
  }

  // TickHitInteractableObject @0x4B8790
  tickHitInteractableObject(): void {
    const queryPos = this.position.add(
      Vector3.down.mulScalar(GameCoreFruit.interactionQueryDownOffset),
    );
    const query = new Cylinder(
      GameCoreFruit.interactionQueryRadius,
      GameCoreFruit.interactionQueryRadius,
    );
    for (const obj of GameCore.instance!.allObjectsIn<GameCoreInteractionObject>(
      GameCoreInteractionObject,
      queryPos,
      query,
    )) {
      this.triggerInteraction(obj, 0.0);
      break; // only the first element (faithful)
    }
  }

  // TriggerInteraction @0x4B8AD0
  triggerInteraction(target: GameCoreObject | null, distance: number): void {
    if (
      this.m_currentCooldownTime > 0.0 ||
      this.m_detectionDelay > 0.0 ||
      this.m_playerOwner.m_handle > -1 ||
      this.m_usageRemain < 1
    ) {
      return;
    }

    const viewer = this.getUnityObject() as FruitContract | null;
    if (viewer === null || target === null) return;

    const settings = viewer.getComponentsBuffSetting();
    let anyApplied = false;

    if (target instanceof GameCoreEnemy) {
      for (const setting of settings) {
        if ((setting.triggerTarget & EBuffTriggerTarget.Enemy) !== 0) {
          setting.addBuff(this, target, null);
          anyApplied = true;
        }
      }
    } else if (target instanceof GameCorePlayer) {
      const deltaY = f(this.position.y - target.position.y);
      const jumpCase = deltaY < GameCoreFruit.jumpTriggerDeltaY;
      for (const setting of settings) {
        let apply: boolean;
        if ((setting.triggerTarget & EBuffTriggerTarget.PlayerJump) !== 0 && jumpCase) {
          apply = distance < this.m_playerJumpDetectionRange;
        } else {
          apply =
            !jumpCase &&
            (setting.triggerTarget & EBuffTriggerTarget.Player) !== 0 &&
            distance < target.collision.radius &&
            Mathf.Abs(f(this.position.y - target.position.y)) <
              f(this.collision.radius * GameCoreFruit.playerTriggerHeightFactor);
        }

        if (!apply) continue;

        setting.addBuff(this, target, null);
        anyApplied = true;

        if (
          target.isLocalPlayer() &&
          !this.m_alreadyPlayingRumblePlayer.includes(target)
        ) {
          const playerViewer = target.getUnityObjectAs<PlayerViewContract>();
          if (playerViewer !== null) {
            // C#: GestureManager.Rumble(playerID, VibrationSettings.PlayerTriggerFruit)
            notifyRumble(playerViewer.playerID, 'PlayerTriggerFruit');
            this.m_alreadyPlayingRumblePlayer.push(target);
          }
        }
      }
    } else if (target instanceof GameCoreInteractionObject) {
      // INFERRED payload (reconstruction): null player + target.handle.
      Events.triggerInterationEvent.invoke(null, target.handle); // [sic]
      return; // the interaction path does not consume a use
    } else {
      return;
    }

    if (!anyApplied) return;

    Events.fruitCaboomEvent.invoke(this);
    this.m_currentCooldownTime = this.m_cooldownTime;
    this.m_usageRemain--;
    if (this.m_usageRemain < 1) {
      this.m_active = false;
      if (this.m_destroyWhenUsedUp) this.destroySelf();
    }
  }

  // RecreateViewer @0x4B90E0 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let viewer = this.getUnityObject() as FruitContract | null;
    if (viewer === null && this.m_prefabName !== null) {
      viewer = GameCoreObject.createViewerFromPrefabName(this.m_prefabName) as FruitContract | null;
    }
    return viewer !== null ? viewer.gameObject : null;
  }

  // OnGrab @0x4B92D0 (IGrabbable slot 0) — ownership on the LATEST version.
  onGrab(a_player: GameCorePlayer): void {
    const latest = this.handle.getMostRecentObjectVersion<GameCoreFruit>();
    if (latest !== null) {
      latest.m_playerOwner = a_player.handle;
      latest.m_lastPlayerOwner = a_player.handle;
    }
  }

  // OnDrop @0x4B9380 (IGrabbable slot 1)
  onDrop(a_player: GameCorePlayer, force: Vector3): void {
    const latest = this.handle.getMostRecentObjectVersion<GameCoreFruit>();
    if (latest === null) return;
    const viewer = this.getUnityObject() as FruitContract | null;
    if (viewer === null) return;

    latest.position = a_player.position;
    latest.m_playerOwner = GameCoreHandle.nullHandle;

    if (force.magnitude <= GameCoreFruit.gentleDropForceThreshold) {
      const hit = getSimPhysics().raycast(
        latest.position.x, f(latest.position.y + 1), latest.position.z,
        0, -1, 0,
        GameCoreFruit.gentleDropRayDistance,
        Q4Layers.terrainMask,
        'UseGlobal',
      );
      if (hit !== null) {
        latest.position = new Vector3(
          hit.point[0],
          f(hit.point[1] + f(latest.collision.radius * GameCoreFruit.gentleDropRadiusFactor)),
          hit.point[2],
        );
      }
      latest.m_atRest = true;
      latest.m_currentVelocity = Vector3.zero;
    } else {
      // FAITHFUL: uses THIS fruit's collision radius (not latest's) here.
      const sphereRadius = f(this.collision.radius * GameCoreFruit.throwDropSphereRadiusFactor);
      const originY = f(latest.position.y + GameCoreFruit.throwDropProbeHeight);
      const hit = getSimPhysics().sphereCast(
        latest.position.x, originY, latest.position.z,
        0, -1, 0,
        sphereRadius,
        GameCoreFruit.throwDropProbeMaxDistance,
        Q4Layers.terrainMask,
        'UseGlobal',
      );
      if (
        hit !== null &&
        f(GameCoreFruit.throwDropProbeHeight - sphereRadius) <= hit.distance
      ) {
        latest.position = new Vector3(
          latest.position.x,
          f(originY - f(hit.distance + GameCoreFruit.throwDropLandingClearance)),
          latest.position.z,
        );
      }
      latest.m_atRest = false;
      latest.m_currentVelocity = force;
    }
  }

  // ThrowWithForce @0x4B99C0 (IGrabbable slot 2) — player param unused (faithful).
  throwWithForce(_player: GameCorePlayer, force: Vector3): void {
    this.m_atRest = false;
    this.m_currentVelocity = force;
  }

  // OnStageCleared @0x4B99E0 — no-op (confirmed empty body).
  onStageCleared(_manager: GameCoreWaveManager): void {}

  // OnGameOver @0x4B99F0
  onGameOver(): void {
    this.m_active = false;
  }
}
