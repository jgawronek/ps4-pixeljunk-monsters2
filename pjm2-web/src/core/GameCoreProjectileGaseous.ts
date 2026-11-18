// src/core/GameCoreProjectileGaseous.ts
// TypeScript port of GameCore.GameCoreProjectileGaseous (TypeDefIndex 3057, RVA 0x4C5850..0x4C7680).
// NO C# reconstruction exists upstream for this class: ported directly from the Ghidra pseudo-C
// (decomp/decompiled/GameCore.GameCoreProjectileGaseous.c) with the arithmetic cross-checked against raw
// x86-64 disassembly (TickFlow @0x4C61E0: `moveVector.y += dt*gravity; position += moveVector*dt`,
// xmm2 = dt) and the rodata floats read from Il2CppUserAssemblies.elf (file offset = vaddr + 0x4000):
//   DAT_00b7c410 = 2.5   (no-target fire distance along the fort direction; same as Trajectory)
//   DAT_00b7c414 = 0.25  (enemy-probe cylinder radius, also the probe's downward origin shift)
//   DAT_00b7c418 = 0.5   (enemy-probe cylinder height)
//   DAT_00b7c41c = 1.0 / DAT_00b7c420 = 1.0 (furthestAffectRangeRate fallback when the view is gone)
//
// Behaviour (flame tower_004 / ice tower_006):
//   * A "gas parcel" flies along a lightly-gravitied ballistic arc (view.GetFireDirection == the Trajectory
//     closed form, speedHorizontal 4 / 16, gravity -1) for at most flowLengthMax.
//   * TickFlow probes terrain with a Linecast along the frame step -> OnHitTerrain (grounded at the hit point),
//     otherwise the first valid IDamageable inside a small cylinder -> OnHitEnemy (grounded on the enemy).
//   * Once grounded the parcel lingers affectDuration seconds (ground fire / frost cloud) and every tick
//     applies the tower's BuffSettings (Burn / Freeze) to every valid damageable within m_affectRadiusToEnemy
//     (and to players within m_affectRadiusToPlayer when affectPlayer).
//   * The affect radius shrinks with the distance from the tower: r += clamp01(dist/detectorRadius)*(rate*r - r)
//     with rate = view.furthestAffectRangeRate (flame 0.5, ice 0.33).
// Damage is dealt ONLY through the buffs (BuffBurn / BuffFreeze), never directly.

import { Mathf } from '../engine/math';
import { Vector3 } from '../engine/math/Vector3';
import {
  instantiateProjectileViewer,
  registerUnityObject,
  type BuffSettingContract,
  type ProjectileViewContract,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import { Events } from './Events';
import { GameCore } from './GameCore';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { asDamageable, type IDamageable } from './interfaces';
import { getSimPhysics, Q4Layers } from './physics-seam';
import { TowerHelper } from './TowerHelper';

const f = Math.fround;

/** Optional view hooks of Q4.ProjectileGaseous (ctor reads +0x48..+0x70; SetupEffect @0x749AF0). */
export interface GaseousViewContract extends ProjectileViewContract {
  affectPlayer?: boolean; // 0x48
  affectToPlayerRadius?: number; // 0x4C
  flowLengthMax?: number; // 0x5C
  affectDuration?: number; // 0x70
  furthestAffectRangeRate?: number; // 0x80
  setupEffect?(direction: Vector3, enemyPos: Vector3): void;
}

export class GameCoreProjectileGaseous extends GameCoreProjectile {
  private m_affectPlayer = false; // 0xB0
  private m_moveVector: Vector3 = Vector3.zero; // 0xB4
  private m_traceTarget = true; // 0xC0 (ctor initializer = 1)
  private m_gravity = f(0); // 0xC4
  private m_targetCoreObject: GameCoreHandle = GameCoreHandle.nullHandle; // 0xC8
  private m_affectRadiusToEnemy = f(0); // 0xE8
  private m_affectRadiusToPlayer = f(0); // 0xEC
  private m_maxFlowLength = f(0); // 0xF0
  private m_flowLength = f(0); // 0xF4
  private m_grounded = false; // 0xF8
  private m_expiredLength = false; // 0xF9
  private m_affectDuration = f(2.5); // 0xFC (ctor initializer 0x40200000)
  private m_attackDamagePerSecond = f(0); // 0x100 (auto-property backing field)

  /** True once the parcel has landed (ground fire / frost cloud phase). View read: flow vs affect effect. */
  get grounded(): boolean {
    return this.m_grounded;
  }
  /** Current flight direction (view: orientation of the flow effect). */
  get moveVector(): Vector3 {
    return this.m_moveVector;
  }

  get attackDamagePerSecond(): number {
    return this.m_attackDamagePerSecond;
  }
  protected set attackDamagePerSecond(v: number) {
    this.m_attackDamagePerSecond = f(v);
  }

  // .ctor @0x4C5850
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super(tower, enemies, dealsDamage);
    const currentTarget = tower.getCurrentTarget();
    if (currentTarget === null) {
      if (this.m_targetHandles === null || this.m_targetHandles.length < 1) {
        this.m_targetCoreObject = GameCoreHandle.nullHandle;
      } else {
        this.m_targetCoreObject = this.m_targetHandles[0];
      }
    } else {
      this.m_targetCoreObject = currentTarget.handle;
    }

    const viewer = tower.getUnityObjectAs<TowerBaseContract>();
    const normFort = tower.fortDirection.normalized;
    this.m_affectRadiusToEnemy = tower.attackSpread; // tower +0x7C
    this.m_attackDamagePerSecond = tower.attackPower; // tower +0x70

    // Aim point: first enemy's position, else 2.5 ahead along the fort direction (DAT_00b7c410).
    const targetPos =
      enemies === null || enemies.length < 1
        ? tower.position.add(normFort.mulScalar(f(2.5)))
        : enemies[0].position;
    const hitPos = TowerHelper.getProjectileGameCoreHitPoisition(tower, targetPos);

    if (viewer === null) {
      // FAITHFUL: binary NREs on a null tower viewer (lVar11 == 0 -> FUN_00a78ac0). Headless drivers always have one.
      throw new Error('NullReferenceException (faithful): GameCoreProjectileGaseous without tower viewer');
    }
    const firePoint = viewer.getFirePointByRemainingMag(tower.magazineCapacity);
    const view = instantiateProjectileViewer(viewer.projectile, this.handle.m_handle, firePoint) as GaseousViewContract | null;
    if (view !== null) {
      registerUnityObject(this.handle.m_handle, view);
      this.m_affectPlayer = view.affectPlayer ?? false; // +0x48
      this.m_affectRadiusToPlayer = f(view.affectToPlayerRadius ?? 0); // +0x4C
      const fd = view.getFireDirection(
        { x: this.position.x, y: this.position.y, z: this.position.z },
        { x: hitPos.x, y: hitPos.y, z: hitPos.z },
        { x: 0, y: 0, z: 0 },
      );
      this.m_moveVector = new Vector3(fd.x, fd.y, fd.z);
      this.m_maxTimeAlive = f(view.maxLifeDuration ?? 0); // +0x18
      this.m_traceTarget = view.traceTarget ?? true; // +0x58
      this.m_gravity = f(view.gravity ?? 0); // +0x54
      this.m_affectDuration = f(view.affectDuration ?? 0); // +0x70
      this.m_maxFlowLength = f(view.flowLengthMax ?? 0); // +0x5C
      this.m_flowLength = f(0);
      this.m_grounded = false;
      this.m_expiredLength = false;
      view.setupEffect?.(this.m_moveVector, hitPos); // Q4.ProjectileGaseous.SetupEffect
    }
  }

  // Tick @0x4C6020 — base lifetime inlined, then expiry test, then flow / attack phase.
  override tick(): void {
    const dt = GameCore.tickDeltaTime;
    this.duration = f(this.duration + dt);
    this.m_maxTimeAlive = f(this.m_maxTimeAlive - dt);
    if (this.m_maxTimeAlive <= 0.0) this.destroySelf();
    if (this.hasExpired()) this.destroySelf();
    if (!this.m_grounded) this.tickFlow(dt);
    else this.tickAttack();
  }

  // HasExpired @0x4C6170 — the source tower is gone (null / destroyed) or the flow length is used up.
  private hasExpired(): boolean {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const towerGone = tower === null ? true : tower.isDestroyed();
    return towerGone || this.m_expiredLength;
  }

  // TickFlow @0x4C61E0
  private tickFlow(dt: number): void {
    this.m_moveVector = new Vector3(this.m_moveVector.x, f(this.m_moveVector.y + f(dt * this.m_gravity)), this.m_moveVector.z);
    this.position = this.position.add(this.m_moveVector.mulScalar(dt));

    if (this.m_traceTarget) {
      const target = this.m_targetCoreObject.getMostRecentObjectVersion<GameCoreObject>();
      if (target !== null) {
        this.position = this.position.add(target.position.sub(target.previousTickPosition));
      }
    }

    const speed = this.m_moveVector.magnitude;
    const start = this.position;
    const end = start.add(this.m_moveVector.normalized.mulScalar(f(speed * dt)));
    const terrainHit = getSimPhysics().linecast(
      start.x, start.y, start.z, end.x, end.y, end.z, Q4Layers.terrainMask,
    );
    if (terrainHit !== null) {
      this.onHitTerrain(terrainHit.point, terrainHit.normal);
    } else {
      // Probe cylinder (r 0.25, h 0.5) centred 0.25 below the parcel: first valid IDamageable.
      const probePos = start.add(Vector3.down.mulScalar(f(0.25)));
      let hit: IDamageable | null = null;
      for (const obj of GameCore.instance!.allObjectsIn<GameCoreObject>(GameCoreObject, probePos, new Cylinder(f(0.25), f(0.5)))) {
        const d = asDamageable(obj);
        if (d !== null && d.valid()) {
          hit = d;
          break;
        }
      }
      if (hit !== null) this.onHitEnemy(hit);
    }

    this.m_flowLength = f(f(speed * dt) + this.m_flowLength);
    if (this.m_maxFlowLength <= this.m_flowLength) this.m_expiredLength = true;
  }

  // TickAttack @0x4C68C0 — every tick: buff every valid damageable (and player) inside the affect radii.
  private tickAttack(): void {
    const r = Mathf.Max(this.m_affectRadiusToEnemy, this.m_affectRadiusToPlayer);
    const origin = this.position.add(Vector3.down.mulScalar(r));
    // Snapshot: OnHit may spawn buffs (not core objects of the queried grid) but keep the iteration stable.
    const objs = [...GameCore.instance!.allObjectsIn<GameCoreObject>(GameCoreObject, origin, new Cylinder(r, f(r + r)))];
    for (const obj of objs) {
      const dist = Vector3.Distance(obj.position, this.position);
      const d = asDamageable(obj);
      if (d === null) {
        if (this.m_affectPlayer && obj instanceof GameCorePlayer && dist <= this.m_affectRadiusToPlayer) {
          this.onHitPlayer(obj);
        }
      } else {
        if (!d.valid() || this.m_affectRadiusToEnemy < dist) continue;
        this.onHit(d);
      }
    }
  }

  /** Shared tail of OnHitTerrain/OnHitEnemy: shrink the affect radius with the distance from the tower. */
  private scaleAffectRadius(): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const view = this.getUnityObjectAs<GaseousViewContract>();
    const rate = view !== null ? f(view.furthestAffectRangeRate ?? 0) : f(1.0); // DAT_00b7c41c/420 = 1.0
    if (tower === null || tower.enemyDetector === null) {
      throw new Error('NullReferenceException (faithful): gaseous projectile without tower detector');
    }
    const dist = Vector3.Distance(this.position, tower.position);
    const detectorRadius = tower.enemyDetector.getCollisionCylinder().radius; // IEnemyDetector slot 6
    const t = Mathf.Clamp01(f(dist / detectorRadius));
    const old = this.m_affectRadiusToEnemy;
    this.m_affectRadiusToEnemy = f(old + f(t * f(f(rate * old) - old)));
  }

  // OnHitTerrain @0x4C6DC0 (RaycastHit: point + normal)
  private onHitTerrain(point: [number, number, number], normal: [number, number, number]): void {
    this.m_grounded = true;
    this.m_maxTimeAlive = f(this.duration + this.m_affectDuration);
    this.position = new Vector3(point[0], point[1], point[2]);
    this.scaleAffectRadius();
    Events.projectileHitTerrain.invoke(this, this.position, new Vector3(normal[0], normal[1], normal[2]));
  }

  // OnHitEnemy @0x4C70A0
  private onHitEnemy(enm: IDamageable): void {
    this.m_grounded = true;
    this.m_maxTimeAlive = f(this.duration + this.m_affectDuration);
    this.position = enm.position;
    this.scaleAffectRadius();
    Events.projectileHitTerrain.invoke(this, this.position, Vector3.zero);
  }

  // OnHit @0x4C73D0 — apply every BuffSetting on the projectile view, then raise projectileHitEvent.
  private onHit(hit: IDamageable | null): void {
    if (hit === null) return;
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const settings = this.getBuffSettings();
    if (settings !== null) {
      for (const s of settings) {
        s.addBuff(this, hit.host() ?? (hit as unknown as GameCoreObject), tower !== null ? tower.upgradeBuffOverride : null);
      }
    }
    Events.projectileHitEvent.invoke(this, hit);
  }

  // OnHitPlayer @0x4C7580
  private onHitPlayer(player: GameCorePlayer): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const settings = this.getBuffSettings();
    if (settings === null) return;
    for (const s of settings) s.addBuff(this, player, tower !== null ? tower.upgradeBuffOverride : null);
  }

  // GetBuffSettings @0x4C7680 — BuffSetting components on this projectile's view GameObject.
  getBuffSettings(): BuffSettingContract[] | null {
    const view = this.getUnityObjectAs<ProjectileViewContract>();
    if (view === null) return null;
    return view.getComponentsBuffSetting?.() ?? null;
  }
}
