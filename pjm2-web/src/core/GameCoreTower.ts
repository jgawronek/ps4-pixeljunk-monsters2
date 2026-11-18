// src/core/GameCoreTower.ts
// TypeScript port of decomp/src/GameCore/GameCoreTower.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3070,
// RVA 0x4C3FE0..0x4D1A50). Replaces the iter-12 skeleton.
// The sim-side tower (fruit-tree cannon): targeting queue, rotation speeds,
// EXP/upgrade progression, magazine ammo, and the tower FSM.
//
// Constants CONFIRMED from ELF .rodata: collision (1.0, 2.0) DAT_00b7c44c/450;
// ChangeMag duration 5.0 DAT_00b7c454; full-range fire angle 360 DAT_00b7c45c;
// fire-point fallback 2.0 DAT_00b7c460; target-queue period 0.25 (0x3e800000);
// k_gatheringTime 1.0 (.cctor @0x4D12C0).
//
// TS ADAPTATIONS: TowerBase viewer → TowerBaseContract; TowerUpgradeSetting →
// contract (upgradeTower's C# ref level → return value); `as IDamageable` →
// asDamageable duck-cast; C# Finalize (GC) listener teardown → explicit
// destroySelf override (no GC in TS — deterministic teardown required).

import { Mathf, Vector3 } from '../engine/math';
import {
  getDebugCanvas,
  type EnemyBaseContract,
  type TowerBaseContract,
  type TowerUpgradeContract,
  type TowerUpgradeSettingContract,
} from '../view/q4-contracts';
import { Cylinder } from './Cylinder';
import type { EEnemyClassTypeDef, EEnemyStrengthTypeDef, ETowerAttackDef } from './enums';
import { EventTime } from './event/CoreEvent';
import { Events } from './Events';
import type { EnemyHitInfo } from './EnemyHitInfo';
import { GameCore } from './GameCore';
import type { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import type { GameCorePlayer } from './GameCorePlayer';
import type { GameCoreWaveManager } from './GameCoreWaveManager';
import { asDamageable, type IDamageable, type IEnemyDetector } from './interfaces';
import { TowerHelper } from './TowerHelper';
import { TowerStateChangeMag } from './TowerStateChangeMag';
import { TowerStateMachine } from './TowerStateMachine';
import type { TowerState } from './TowerState';
import type { IBuffSettingOverride } from './BuffSettingOverrideFreeze';

const f = Math.fround;

/** C#: GameCoreTower.PlayerAroundInfo (nested struct, TypeDefIndex 3071). */
class PlayerAroundInfo {
  player: GameCoreHandle; // 0x0
  time: number; // 0x20

  // .ctor @0x4D1490
  constructor(aPlayer: GameCoreHandle) {
    this.player = aPlayer;
    this.time = GameCoreTower.k_gatheringTime;
  }
  // Tick @0x4D1530
  tick(dt: number): void {
    this.time = Mathf.Max(f(0), f(this.time - dt));
  }
  // Reset @0x4D15C0
  reset(): void {
    this.time = GameCoreTower.k_gatheringTime;
  }
}

export class GameCoreTower extends GameCoreObject {
  // ---- settings copied from the Q4.TowerBase viewer (InitializeSettings) ----
  attackType: ETowerAttackDef = 0; // 0x60
  strengthType: EEnemyStrengthTypeDef = 0; // 0x64
  classType: EEnemyClassTypeDef = 0; // 0x68
  balloonAimable = false; // 0x6C
  attackPower = f(0); // 0x70
  attackSpeed = f(0); // 0x74
  attackRangeInner = f(0); // 0x78
  attackSpread = f(0); // 0x7C
  costCoin = 0; // 0x80
  costGem = 0; // 0x84
  buildTime = 0; // 0x88
  burstCount = 0; // 0x8C
  burstInterval = f(0); // 0x90
  refundCoin = 0; // 0x94
  refundGem = 0; // 0x98
  /** NOTE (faithful): metadata name is magazineCapacity but at runtime this is
   *  the CURRENT ammo (init from capacity, decremented per burst, -1 unlimited). */
  magazineCapacity = 0; // 0x9C
  attackAttenuationInfos: unknown[] | null = null; // 0xA0
  retainedTrees: GameCoreHandle[] = []; // 0xA8 (paid trees; refunded on sell)
  targetQueue: GameCoreHandle[] = []; // 0xB0
  nextTargetToAttackIndex = 0; // 0xB8
  rotateSpeedX = f(0); // 0xBC
  rotateSpeedXAcel = f(0); // 0xC0
  rotateSpeedXDecl = f(0); // 0xC4
  rotateSpeedY = f(0); // 0xC8
  rotateSpeedYAcel = f(0); // 0xCC
  rotateSpeedYDecl = f(0); // 0xD0
  rotateSpeed = f(0); // 0xD4
  rotateAcceleration = f(0); // 0xD8
  rotateDeceleration = f(0); // 0xDC
  fireAngleThreshold = f(0); // 0xE0
  cautionAngleRange = f(0); // 0xE4 (= TowerBase.cautionRange)
  cautionIdleTime = f(0); // 0xE8
  cautionRotateSpeed = f(0); // 0xEC
  height = f(0); // 0xF0 (highest fire point above base)

  private m_stateMachine: TowerStateMachine | null = null; // 0xF8
  private m_currentTarget: IDamageable | null = null; // 0x100
  enemyDetector: IEnemyDetector | null = null; // 0x108 (public)
  bodyDirection: Vector3 = Vector3.zero; // 0x110
  fortDirection: Vector3 = Vector3.zero; // 0x11C
  private m_currentLevel = 0; // 0x128
  private m_currentEXP = f(0); // 0x12C
  private prefabName: string; // 0x130
  playerDetectionRange = f(0); // 0x138
  currentRotateSpeedX = f(0); // 0x13C
  currentRotateSpeedY = f(0); // 0x140
  hiveTowerInsectMaxAmount = -1; // 0x144 (-1 unless projectile is Insect)
  hitEffectScale = f(0); // 0x148
  oneShotOneBalloon = false; // 0x14C
  isPostStageClear = false; // 0x14D
  upgradeBuffOverride: IBuffSettingOverride | null = null; // 0x150
  /** C# private static; exposed for the PlayerAroundInfo helper in this module. */
  static readonly k_gatheringTime = f(1.0); // statics +0x0 (.cctor @0x4D12C0)
  private m_expSourcePlayers: PlayerAroundInfo[] | null = null; // 0x158
  private m_playerInside: GameCoreHandle = GameCoreHandle.nullHandle; // 0x160
  private timeToNextUpdate = f(0); // 0x180
  private targetsInRangeStorage: IDamageable[] = []; // 0x188
  private newTargetHandlesStorage: GameCoreHandle[] = []; // 0x190

  // ---- constants (CONFIRMED from ELF .rodata) ----
  private static readonly collisionRadius = f(1.0); // DAT_00b7c44c
  private static readonly collisionHeight = f(2.0); // DAT_00b7c450
  private static readonly changeMagDuration = f(5.0); // DAT_00b7c454
  private static readonly fullRangeFireAngle = f(360.0); // DAT_00b7c45c
  private static readonly firePointHeightFallback = f(2.0); // DAT_00b7c460
  private static readonly defaultHeight = f(2.0); // 0x40000000
  private static readonly targetQueueUpdateInterval = f(0.25); // 0x3e800000

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onEnemyDestroyListener = (
    attackingTower: GameCoreTower,
    enemy: GameCoreEnemy,
    hitInfo: EnemyHitInfo,
  ): void => this.onEnemyDestroy(attackingTower, enemy, hitInfo);
  private readonly m_onWaveEndedListener = (manager: GameCoreWaveManager, waveIndex: number): void =>
    this.onWaveEnded(manager, waveIndex);
  private readonly m_onStageClearListener = (manager: GameCoreWaveManager): void =>
    this.onStageClear(manager);

  // get_currentLevel @0x4CDEA0 / get_currentEXP @0x4CDEB0
  get currentLevel(): number {
    return this.m_currentLevel;
  }
  get currentEXP(): number {
    return this.m_currentEXP;
  }

  // .ctor @0x4CDAD0
  constructor(prefabName: string, costTrees: GameCoreHandle[]) {
    super();
    this.targetQueue = [];
    this.height = GameCoreTower.defaultHeight;
    this.m_currentLevel = 1;
    this.hitEffectScale = f(1.0);
    this.m_playerInside = GameCoreHandle.nullHandle;
    this.targetsInRangeStorage = [];
    this.newTargetHandlesStorage = [];
    this.prefabName = prefabName;

    // Binary passes EventTime 1 = PostGameCoreTick for all three.
    Events.enemyDestroyedEvent.addListener(
      this.m_onEnemyDestroyListener,
      EventTime.PostGameCoreTick,
      this.handle.m_handle,
    ); // +0x40
    Events.waveEndedEvent.addListener(
      this.m_onWaveEndedListener,
      EventTime.PostGameCoreTick,
      this.handle.m_handle,
    ); // +0x18
    Events.stageClearedEvent.addListener(
      this.m_onStageClearListener,
      EventTime.PostGameCoreTick,
      this.handle.m_handle,
    ); // +0x30

    this.retainedTrees = costTrees;
    this.m_expSourcePlayers = [];
    this.collision = new Cylinder(GameCoreTower.collisionRadius, GameCoreTower.collisionHeight);
  }

  // TS ADAPTATION of Finalize @0x4CDEC0 (C# GC destructor): deterministic
  // teardown via destroySelf (no GC in TS). Terminate @0x4CE0D0 keeps its
  // own FSM-drop semantics below.
  override destroySelf(): void {
    Events.stageClearedEvent.removeListener(this.m_onStageClearListener, this.handle.m_handle);
    Events.enemyDestroyedEvent.removeListener(this.m_onEnemyDestroyListener, this.handle.m_handle);
    Events.waveEndedEvent.removeListener(this.m_onWaveEndedListener, this.handle.m_handle);
    this.m_stateMachine = null;
    super.destroySelf();
  }

  // Terminate @0x4CE0D0 — drops the FSM (dev/resync teardown).
  terminate(): void {
    this.m_stateMachine = null;
  }

  // Initialize @0x4CE2C0
  initialize(): void {
    this.initializeSettings();
    this.m_stateMachine = new TowerStateMachine(this.handle);
  }

  // InitializeSettings @0x4CE400 — copies Q4.TowerBase stats (offsets verified).
  private initializeSettings(): void {
    const viewer = this.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) return; // binary: op_Implicit false → skip everything

    this.isPostStageClear = false;
    this.nextTargetToAttackIndex = viewer.nextTargetToAttackIndex | 0; // 0x80
    this.attackType = viewer.attackType; // 0x3C
    this.strengthType = viewer.strengthType; // 0x40
    this.classType = viewer.classType; // 0x44
    this.balloonAimable = viewer.balloonAimable; // 0x48
    this.attackPower = f(viewer.attackPower); // 0x4C
    this.attackSpeed = f(viewer.attackSpeed); // 0x50
    this.attackRangeInner = f(viewer.attackRangeInner); // 0x54
    this.attackSpread = f(viewer.attackSpread); // 0x58
    this.costCoin = viewer.costCoin | 0; // 0x5C
    this.costGem = viewer.costGem | 0; // 0x60
    this.buildTime = viewer.buildTime | 0; // 0x64
    this.refundCoin = viewer.refundCoin | 0; // 0x68
    this.refundGem = viewer.refundGem | 0; // 0x6C
    this.magazineCapacity = viewer.magazineCapacity | 0; // 0x98 (current ammo := capacity)
    this.rotateSpeedX = f(viewer.rotateSpeedX); // 0xCC
    this.rotateSpeedXAcel = f(viewer.rotateSpeedXAcel); // 0xD0
    this.rotateSpeedXDecl = f(viewer.rotateSpeedXDecl); // 0xD4
    this.rotateSpeedY = f(viewer.rotateSpeedY); // 0xD8
    this.rotateSpeedYAcel = f(viewer.rotateSpeedYAcel); // 0xDC
    this.rotateSpeedYDecl = f(viewer.rotateSpeedYDecl); // 0xE0
    this.oneShotOneBalloon = viewer.oneShotOneBalloon; // 0x70
    // fullRangeFire (0xE4) → fixed 360° threshold; else the authored angle.
    this.fireAngleThreshold = viewer.fullRangeFire
      ? GameCoreTower.fullRangeFireAngle
      : f(viewer.fireAngleThreshold); // 0xE8
    this.attackAttenuationInfos = viewer.attackAttenuations; // 0x90
    this.burstCount = viewer.burstCount | 0; // 0xEC
    this.burstInterval = f(viewer.burstInterval); // 0xF0
    this.cautionAngleRange = f(viewer.cautionRange); // 0xF4
    this.cautionIdleTime = f(viewer.cautionIdleTime); // 0xF8
    this.cautionRotateSpeed = f(viewer.cautionRotateSpeed); // 0xFC
    this.playerDetectionRange = f(viewer.playerDetectionRange); // Structure 0x20

    // height := highest named fire point above the tower base; fallback 2.0.
    this.height = GameCoreTower.defaultHeight;
    const firePointNames = viewer.firePointNames; // 0xB0
    if (firePointNames !== null && firePointNames.length > 0) {
      for (const firePointName of firePointNames) {
        let dy = GameCoreTower.firePointHeightFallback;
        const childY = viewer.findDeepChildY(firePointName);
        if (childY !== null) dy = f(childY - viewer.transform.position.y);
        this.height = Mathf.Max(dy, this.height);
      }
    }

    // Sim-side detector built by the view component.
    const detectorView = viewer.getComponentEnemyDetectorView();
    if (detectorView !== null) this.enemyDetector = detectorView.createGameCoreDetector();

    // Hive tower: insect swarm capacity from the projectile prefab.
    const insectAmount = viewer.projectile?.insectAmountMax;
    this.hiveTowerInsectMaxAmount = insectAmount !== undefined ? insectAmount | 0 : -1;
  }

  // ---- tick ----

  // Tick @0x4CEB20 (virtual slot 7)
  override tick(): void {
    // Refresh the cached current target to its most recent version.
    if (this.m_currentTarget !== null) {
      const obj = this.m_currentTarget.handle.getMostRecentObjectVersion<GameCoreObject>();
      if (obj !== null && !obj.isDestroyed()) this.m_currentTarget = asDamageable(obj);
    }

    this.tickRotateSpeed(GameCore.tickDeltaTime);
    this.tickEXPSources();
    this.tickTargetQueue();
    this.tickState();
  }

  // TickRotateSpeed @0x4CECB0
  private tickRotateSpeed(dt: number): void {
    this.currentRotateSpeedX = Mathf.Clamp(
      f(this.currentRotateSpeedX + f(dt * this.rotateSpeedXAcel)),
      f(0),
      this.rotateSpeedX,
    );
    this.currentRotateSpeedY = Mathf.Clamp(
      f(this.currentRotateSpeedY + f(dt * this.rotateSpeedYAcel)),
      f(0),
      this.rotateSpeedY,
    );
  }

  // TickEXPSources @0x4CEDF0 — ages the window; removes AT MOST ONE expired
  // entry per tick (faithful early break).
  private tickEXPSources(): void {
    if (this.m_expSourcePlayers === null) return;
    const dt = GameCore.tickDeltaTime;
    for (let i = this.m_expSourcePlayers.length - 1; i >= 0; i--) {
      const info = this.m_expSourcePlayers[i];
      info.tick(dt);
      if (info.time === 0.0) {
        this.m_expSourcePlayers.splice(i, 1);
        break;
      }
    }
  }

  // TickTargetQueue @0x4CF070 — every 0.25s: re-query, prune, append, promote.
  private tickTargetQueue(): void {
    this.timeToNextUpdate = f(this.timeToNextUpdate - GameCore.tickDeltaTime);
    if (this.timeToNextUpdate > 0.0) return;
    this.timeToNextUpdate = GameCoreTower.targetQueueUpdateInterval;

    this.targetsInRangeStorage.length = 0;
    this.newTargetHandlesStorage.length = 0;

    const self = this.handle.getMostRecentObjectVersion<GameCoreTower>();
    // INFERRED overload/defaults: (tower, result, ignoreInnerRange = true).
    TowerHelper.getNearestTargets(self!, this.targetsInRangeStorage);

    for (let i = 0; i < this.targetsInRangeStorage.length; i++) {
      this.newTargetHandlesStorage.push(this.targetsInRangeStorage[i].handle);
    }

    // Drop queued targets out of range; keep only genuinely new handles.
    this.targetQueue = this.targetQueue.filter((h) =>
      this.newTargetHandlesStorage.some((n) => n.equals(h)),
    );
    const fresh = this.newTargetHandlesStorage.filter(
      (h) => !this.targetQueue.some((q) => q.equals(h)),
    );
    for (const h of fresh) this.targetQueue.push(h);

    let target: IDamageable | null = null;
    if (this.targetQueue.length >= 1) {
      const first = this.targetQueue[0].getMostRecentObjectVersion<GameCoreObject>();
      target = asDamageable(first);
    }
    this.setCurrentTarget(target);
  }

  // TickState @0x4D0780 (virtual slot 10)
  protected tickState(): void {
    if (this.m_stateMachine === null) return;
    this.m_stateMachine.tickState(GameCore.tickDeltaTime);
  }

  // ---- targeting ----

  // GetCurrentTarget @0x4C3FE0
  getCurrentTarget(): IDamageable | null {
    if (this.m_currentTarget === null) return null;
    const obj = this.m_currentTarget.handle.getMostRecentObjectVersion<GameCoreObject>();
    return obj !== null ? asDamageable(obj) : null;
  }

  // SetCurrentTarget @0x4D03E0 — acts only on actual change (handle ids);
  // zeroes both rotation speeds; notifies the view.
  setCurrentTarget(enemy: IDamageable | null): void {
    const cur = this.m_currentTarget;
    let changed = (enemy === null) !== (cur === null);
    if (!changed && enemy !== null) {
      changed = cur!.handle.m_handle !== enemy.handle.m_handle;
    }
    if (!changed) return;

    this.m_currentTarget = enemy;
    this.currentRotateSpeedX = f(0);
    this.currentRotateSpeedY = f(0); // single 8-byte zero store @0x13C
    Events.towerTargetChangeEvent.invoke(this); // +0x90
  }

  // ---- FSM ----

  // SetTowerState @0x4D0690 (virtual slot 9)
  setTowerState(state: TowerState): void {
    if (this.m_stateMachine === null) return;
    this.m_stateMachine.setCurrentCommand(state, null);
  }

  // GetTowerState @0x4D06F0
  getTowerState(): TowerState | null {
    if (this.m_stateMachine === null) return null;
    return this.m_stateMachine.getCurrentState() as TowerState | null;
  }

  // ---- ammo / wave hooks ----

  // HasEnoughBullet @0x4CE0E0 — -1 is the unlimited magazine.
  hasEnoughBullet(): boolean {
    return this.magazineCapacity > 0 || this.magazineCapacity === -1;
  }

  // OnWaveEnded @0x4CE100 (args unused).
  onWaveEnded(_manager: GameCoreWaveManager, _waveIndex: number): void {
    this.rechargeBullet();
  }

  // RechargeBullet @0x4CE110 — refill toward capacity via ChangeMag state.
  rechargeBullet(): void {
    const viewer = this.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null || this.magazineCapacity < 0) return; // unlimited never reloads
    const maxMag = viewer.magazineCapacity | 0;
    if (maxMag <= this.magazineCapacity) return; // already full
    this.setTowerState(
      new TowerStateChangeMag(GameCoreTower.changeMagDuration, this.magazineCapacity, maxMag),
    );
  }

  // OnStageClear @0x4CE240 (arg unused).
  onStageClear(_manager: GameCoreWaveManager): void {
    this.isPostStageClear = true;
  }

  // ---- EXP / upgrades ----

  // OnEnemyDestroy @0x4D07F0 — bank expValue when THIS tower killed the enemy.
  onEnemyDestroy(
    attackingTower: GameCoreTower | null,
    enemy: GameCoreEnemy | null,
    _a_hitInfo: EnemyHitInfo,
  ): void {
    if (enemy === null || attackingTower === null) return;
    if (attackingTower.handle.m_handle !== this.handle.m_handle) return;

    const tower = this.handle.getMostRecentObjectVersion<GameCoreTower>();
    const enemyView = enemy.getUnityObjectAs<EnemyBaseContract>(); // expValue @0x28
    if (tower !== null && enemyView !== null) tower.grantEXP(f(enemyView.expValue), null);
  }

  // GrantEXP @0x4D0900
  grantEXP(amount: number, from: GameCorePlayer | null): void {
    const next = this.getNextUpgrade();
    if (next === null || next.level === 0) return; // max level sentinel

    const debug = getDebugCanvas();
    if (debug !== null) amount = f(amount * debug.towerEXPRate); // field @0x28

    if (from !== null && this.m_expSourcePlayers !== null) {
      let found = false;
      for (let i = 0; i < this.m_expSourcePlayers.length; i++) {
        if (this.m_expSourcePlayers[i].player.m_handle === from.handle.m_handle) {
          this.m_expSourcePlayers[i].reset();
          found = true;
          break;
        }
      }
      if (!found) this.m_expSourcePlayers.push(new PlayerAroundInfo(from.handle));
    }

    this.m_currentEXP = f(this.m_currentEXP + amount);
    if (this.m_currentEXP >= f(next.reachExp)) this.upgradeTower();
    Events.expGrantEvent.invoke(this, amount); // +0xA8
  }

  // GetCurrentUpgrade @0x4D0FE0 / GetNextUpgrade @0x4D0D70
  getCurrentUpgrade(): TowerUpgradeContract | null {
    const setting = this.getUpgradeSetting();
    if (setting === null) return null;
    return setting.getCurrentUpgrade(this);
  }
  getNextUpgrade(): TowerUpgradeContract | null {
    const setting = this.getUpgradeSetting();
    if (setting === null) return null;
    return setting.getNextUpgrade(this);
  }

  // UpgradeTower @0x4D0E70 — setting writes stats + level (C# ref → return).
  private upgradeTower(): void {
    const setting = this.getUpgradeSetting();
    if (setting === null) return;
    const next = setting.getNextUpgrade(this);
    this.m_currentLevel = setting.upgradeTower(this) | 0;
    Events.towerUpgradeEvent.invoke(this, next); // +0xC0
  }

  // GetCurrentExpRate @0x4D10E0 — 0..1 progress toward the next level.
  getCurrentExpRate(): number {
    const cur = this.getCurrentUpgrade();
    const next = this.getNextUpgrade();
    const baseExp = cur !== null ? cur.reachExp : 0;
    if (next !== null && next.reachExp !== 0) {
      return f(f(this.m_currentEXP - baseExp) / f(next.reachExp - baseExp));
    }
    return f(0);
  }

  private getUpgradeSetting(): TowerUpgradeSettingContract | null {
    const viewer = this.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) return null;
    return viewer.getComponentTowerUpgradeSetting();
  }

  // ---- player occupancy ----

  // PlayerEnterTower @0x4D1140 / PlayerExitTower @0x4D1150
  playerEnterTower(player: GameCoreHandle): void {
    this.m_playerInside = player;
  }
  playerExitTower(): void {
    this.m_playerInside = GameCoreHandle.nullHandle;
  }
  // HasPlayerInTower @0x4D1240 / PlayerInTowerID @0x4D1250
  hasPlayerInTower(): boolean {
    return this.m_playerInside.m_handle > -1;
  }
  playerInTowerID(): number {
    if (this.m_playerInside.m_handle > -1) {
      const player = this.m_playerInside.getMostRecentObjectVersion<GameCorePlayer>();
      if (player !== null) return player.playerId;
    }
    return -1;
  }

  // ---- viewer ----

  // RecreateViewer @0x4D05E0 (virtual slot 5)
  override recreateViewer(): unknown | null {
    let viewer = this.getUnityObjectAs<TowerBaseContract>();
    if (viewer === null) {
      viewer = GameCoreObject.createViewerFromPrefabName(this.prefabName) as TowerBaseContract | null;
    }
    // FAITHFUL: binary exception path if still null.
    return (viewer as TowerBaseContract).gameObject;
  }
}
