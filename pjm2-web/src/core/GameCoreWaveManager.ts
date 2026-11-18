// src/core/GameCoreWaveManager.ts
// TypeScript port of decomp/src/GameCore/GameCoreWaveManager.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 2991,
// RVA 0x4D1AB0..0x4D5590). Simulation-side wave director: converts the
// stage's Q4.WaveResource into WaveProgress/SpawnProgress bookkeeping,
// spawns GameCoreEnemy instances on schedule, tracks kills, shortens the
// next wave on early clears, drives boss-minion waves and detects stage
// clear.
//
// Rodata CONFIRMED from the ELF (see C# header):
//   DAT_00b7c47c = 0.0f          StageClearLifeEpsilon
//   DAT_00b7c480 = 1.0f          SpawnStartEpsilon
//   DAT_00b7c488 = 0.0f          SpawnDelayEpsilon
//   DAT_00b7c484 = 0.01745329f   OffsetAngleScale (Mathf.Deg2Rad)
//   0x40980000 = 4.75f           StageStartDelayAfterIntro
//   0xC47A0000 = -1000.0f        MinionSpawnNow
//
// TS ADAPTATION: Q4.WaveManager/WaveResource/SpawnData → view/data contracts
// in q4-contracts.ts; GamePreferences/GameInfoController/Jarvis singletons →
// providers with data-verified defaults; MiniDialogStageSettings → plain
// interface; GameObjectHelper.SetParent → view-side concern (documented
// no-op headless).

import { Mathf } from '../engine/math/Mathf';
import { Vector3 } from '../engine/math/Vector3';
import {
  getCurrentStage,
  getDifficultySetting,
  getEnemyToSpawnByDifficulty,
  getGameInfoController,
  getWalkthroughMode,
  type BossMinionSpawnDataContract,
  type EnemyBaseContract,
  type MiniDialogStageSettings,
  type SpawnDataContract,
  type WaveDataContract,
  type WaveManagerViewContract,
} from '../view/q4-contracts';
import { EEnemyMoveTypeDef, ESpawnMode } from './enums';
import { Events } from './Events';
import { EventTime } from './event/CoreEvent';
import { GameCore } from './GameCore';
import { GameCoreEnemy } from './GameCoreEnemy';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreHome, type ChibiData } from './GameCoreHome';
import { GameCoreObject } from './GameCoreObject';
import { GameCorePlayer } from './GameCorePlayer';
import { GameCoreTower } from './GameCoreTower';
import type { EnemyHitInfo } from './EnemyHitInfo';

const f = Math.fround;

/** C#: DifficultySettings.Difficulty (TypeDefIndex 2828). */
export enum Difficulty {
  Any = -1,
  Easy = 0,
  Medium = 1,
  Hard = 2,
}

// GameCoreWaveManager.SpawnProgress (TypeDefIndex 2992) — runtime state of
// one spawn group.
export class SpawnProgress {
  spawnData: SpawnDataContract | null = null; // 0x10
  remainingSpawnDelay = f(0); // 0x18
  numToSpawn = 0; // 0x1C
  numSpawned = 0; // 0x20
  hasTriggeredStartEvent = false; // 0x24
}

// GameCoreWaveManager.WaveProgress (TypeDefIndex 2993) — runtime state of
// one wave.
export class WaveProgress {
  spawnerProgress: SpawnProgress[] = []; // 0x10
  remainingSpawnStartDelay = f(0); // 0x18
  remainingWaveActivateDelay = f(0); // 0x1C
  remainingWaveTime = f(0); // 0x20
  waveTime = f(0); // 0x24
  speedRatio = f(1.0); // 0x28
  hpRatio = f(1.0); // 0x2C
  started = false; // 0x30
  totalNumEnemy = 0; // 0x34
  totalNumEnemyDead = 0; // 0x38
  totalNumSpawned = 0; // 0x3C
  dialogStageSettings: MiniDialogStageSettings = { label: '', icon: 0 }; // 0x40
  moneyArray: number[] = []; // 0x50
  gemArray: number[] = []; // 0x58

  // get_activated @0x4D4090
  get activated(): boolean {
    return this.remainingWaveActivateDelay <= 0.0;
  }
}

export class GameCoreWaveManager extends GameCoreObject {
  private viewer: WaveManagerViewContract | null = null; // 0x60
  waveProgress: WaveProgress[] = []; // 0x68 (C# private; harness-readable)
  waveBossMinionProgress: WaveProgress[] = []; // 0x70
  // m_DestroySelf @0x78 → base GameCoreObject.destroyed (@0x18, same field)
  private m_hasClearedStage = false; // 0x79
  private m_difficultyLevel: Difficulty = Difficulty.Medium; // 0x7C (INFERRED Medium default)
  currentWaveIndex = 0; // 0x80 (C# private; harness-readable)
  private waveClearTimeBonusRate = f(1.0); // 0x84
  private remainingStageClearDelay = f(0); // 0x88
  private m_bossHandle: GameCoreHandle = GameCoreHandle.nullHandle; // 0x90
  private currentBossWaveIndex = 0; // 0xB0
  private m_introSequenceFinished = false; // 0xB4
  private stageStartDelay = f(0); // 0xB8

  private static readonly StageClearLifeEpsilon = f(0.0); // DAT_00b7c47c
  private static readonly SpawnStartEpsilon = f(1.0); // DAT_00b7c480
  private static readonly SpawnDelayEpsilon = f(0.0); // DAT_00b7c488
  private static readonly OffsetAngleScale = f(0.01745329); // DAT_00b7c484 (Mathf.Deg2Rad)
  private static readonly StageStartDelayAfterIntro = f(4.75); // 0x40980000
  private static readonly MinionSpawnNow = f(-1000.0); // 0xC47A0000

  /** Bound listeners — C# delegate (method + target) equality stand-ins. */
  private readonly m_onGameOverListener = (): void => this.onGameOver();
  private readonly m_onEnemyDestroyedListener = (
    tower: GameCoreTower | null,
    enemy: GameCoreEnemy,
    hitInfo: EnemyHitInfo,
  ): void => this.onEnemyDestroyed(tower, enemy, hitInfo);
  private readonly m_onEnemyAttackedListener = (
    enemy: GameCoreEnemy,
    home: GameCoreHome,
    chibi: ChibiData,
  ): void => this.onEnemyAttacked(enemy, home, chibi);
  private readonly m_onIntroSequenceFinishedListener = (player: GameCorePlayer): void =>
    this.onIntroSequenceFinished(player);
  private readonly m_onResyncListener = (): void => this.onResync();

  // .ctor @0x4D1AB0 (parameterless) + .ctor @0x4D1C00 (viewer) — TS: one
  // implementation; C# chains viewer → default.
  constructor(viewer?: WaveManagerViewContract) {
    super();
    if (viewer === undefined) return; // pool-default path

    this.viewer = viewer;
    this.setupWaveData(getDifficultySetting());

    Events.gameOverEvent.addListener(this.m_onGameOverListener, EventTime.Immediate);
    Events.enemyDestroyedEvent.addListener(this.m_onEnemyDestroyedListener, EventTime.Immediate);
    Events.enemyAttackedHomeEvent.addListener(this.m_onEnemyAttackedListener, EventTime.Immediate);
    Events.introSequenceFinishedEvent.addListener(
      this.m_onIntroSequenceFinishedListener,
      EventTime.Immediate,
    );
    Events.postResyncEvent.addListener(this.m_onResyncListener, EventTime.Immediate);
  }

  // get_hasClearedStage @0x4D2370
  get hasClearedStage(): boolean {
    return this.m_hasClearedStage;
  }

  // get_waveCurrentIndex @0x4C2AF0
  get waveCurrentIndex(): number {
    return this.currentWaveIndex;
  }

  // get_waveProgressList @0x4D2380
  get waveProgressList(): WaveProgress[] {
    return this.waveProgress;
  }

  // get_bossHasAppeared @0x4D2390
  get bossHasAppeared(): boolean {
    return this.m_bossHandle.m_handle > -1;
  }

  // auto-property (get @0x4D23A0 / private set @0x4D23B0)
  get introSequenceFinished(): boolean {
    return this.m_introSequenceFinished;
  }

  // get_Instance @0x4D23C0
  static get Instance(): GameCoreWaveManager | null {
    const core = GameCore.instance;
    return core === null ? null : core.firstObject<GameCoreWaveManager>(GameCoreWaveManager);
  }

  // DestroySelf @0x4D2410 (virtual slot 6)
  override destroySelf(): void {
    this.destroyed = true;
    const core = GameCore.instance;
    if (core !== null) {
      core.collisionManager.removeCoreObject(this);
      Events.gameOverEvent.removeListener(this.m_onGameOverListener);
      Events.enemyDestroyedEvent.removeListener(this.m_onEnemyDestroyedListener);
      Events.enemyAttackedHomeEvent.removeListener(this.m_onEnemyAttackedListener);
      Events.introSequenceFinishedEvent.removeListener(this.m_onIntroSequenceFinishedListener);
      Events.postResyncEvent.removeListener(this.m_onResyncListener);
    }
  }

  // OnResync @0x4D2670 — after a network resync the (freshly restored)
  // manager must consider the intro done.
  private onResync(): void {
    const latest = GameCore.instance!.firstObject<GameCoreWaveManager>(GameCoreWaveManager);
    if (latest !== null) latest.m_introSequenceFinished = true;
  }

  // GetEnemyPrefabForWave @0x4D26D0
  getEnemyPrefabForWave(waveIndex: number): EnemyBaseContract | null {
    if (this.waveProgress.length <= waveIndex) return null;
    const spawners = this.waveProgress[waveIndex].spawnerProgress;
    if (spawners.length < 1) return null;
    return spawners[0].spawnData !== null ? spawners[0].spawnData!.enemyObject : null;
  }

  // GetTimeUntilWaveActivates @0x4D27B0 — sum of every earlier wave's
  // (start + activate + wave time) plus this wave's start + activate; never
  // negative.
  getTimeUntilWaveActivates(waveIndex: number): number {
    if (this.waveProgress.length <= waveIndex) return f(0.0); // INFERRED
    let total = f(0.0);
    for (let i = 0; i < waveIndex; i++) {
      const p = this.waveProgress[i];
      total = f(
        total + f(f(p.remainingSpawnStartDelay + p.remainingWaveActivateDelay) + p.remainingWaveTime),
      );
    }
    const current = this.waveProgress[waveIndex];
    return Mathf.Max(
      f(total + f(current.remainingSpawnStartDelay + current.remainingWaveActivateDelay)),
      f(0.0),
    );
  }

  // IsStartedWave @0x4D2970 — FAITHFUL: bounds-checks against
  // currentWaveIndex but indexes with 'index'.
  isStartedWave(index: number): boolean {
    if (this.waveProgress.length <= this.currentWaveIndex) return false;
    return this.waveProgress[index].started;
  }

  // Tick @0x4D2A00 (virtual slot 7)
  override tick(): void {
    if (this.destroyed) {
      this.destroySelf();
    } else {
      this.updateWaveSpawning();
    }
  }

  // UpdateWaveSpawning @0x4D2A20 — main per-frame driver.
  updateWaveSpawning(): void {
    if (getWalkthroughMode() || !this.m_introSequenceFinished) return;

    this.stageStartDelay = f(this.stageStartDelay - GameCore.tickDeltaTime);
    if (this.stageStartDelay > 0.0) return;

    this.updateStageClear();

    if (this.currentWaveIndex < this.waveProgress.length) {
      if (this.updateWaveProgress(this.waveProgress[this.currentWaveIndex], this.currentWaveIndex, false)) {
        this.currentWaveIndex++;
      }
    }

    if (
      this.m_bossHandle.m_handle > -1 &&
      this.currentBossWaveIndex < this.waveBossMinionProgress.length
    ) {
      const boss = this.m_bossHandle.getMostRecentObjectVersion<GameCoreEnemy>();
      if (boss !== null) {
        if (boss.pathMove !== null) {
          // Time the boss needs to reach its current distance on the path.
          const bossTime = f(boss.pathMove.distanceToTime(boss.distance));
          const minion = this.waveBossMinionProgress[this.currentBossWaveIndex];
          if (minion.remainingSpawnStartDelay <= bossTime) {
            minion.remainingSpawnStartDelay = GameCoreWaveManager.MinionSpawnNow;
          }
          if (minion.remainingSpawnStartDelay < 0.0) {
            if (this.updateWaveProgress(minion, this.currentBossWaveIndex, true)) {
              this.currentBossWaveIndex++;
            }
          }
        }
      } else {
        this.m_bossHandle = GameCoreHandle.nullHandle; // boss died/vanished
      }
    }
  }

  // UpdateStageClear @0x4D2D30 — once every wave has been reached: wait
  // until no enemy is alive, then count down stageClearDelay and fire
  // stageClearedEvent exactly once.
  updateStageClear(): void {
    if (this.currentWaveIndex < this.waveProgress.length || this.m_hasClearedStage) return;

    if (this.remainingStageClearDelay === 0.0) {
      // Start the countdown only when the field is empty.
      let anyAlive = false;
      for (const enemy of GameCore.instance!.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
        if (enemy.life > GameCoreWaveManager.StageClearLifeEpsilon) {
          anyAlive = true;
          break;
        }
      }
      if (anyAlive) return;
      this.remainingStageClearDelay = f(getGameInfoController().stageClearDelay);
    } else {
      this.remainingStageClearDelay = f(this.remainingStageClearDelay - GameCore.tickDeltaTime);
      if (this.remainingStageClearDelay <= 0.0) {
        Events.stageClearedEvent.invoke(this);
        this.m_hasClearedStage = true;
      }
    }
  }

  // UpdateWaveProgress @0x4D3140 — advances one wave (regular or
  // boss-minion). Returns true when the wave is fully spawned and activated.
  // Group ids = waveIndex*1000 + spawner index (confirmed @0x4D323C/0x4D3EA2).
  private updateWaveProgress(
    a_currentWave: WaveProgress,
    a_currentWaveIndex: number,
    isMinnion: boolean,
  ): boolean {
    // Pass 1: fire spawnGroupStartedEvent for every spawner whose
    // (wave start delay + own delay) has expired.
    let groupId = a_currentWaveIndex * 1000;
    for (const sp of a_currentWave.spawnerProgress) {
      if (
        !sp.hasTriggeredStartEvent &&
        f(a_currentWave.remainingSpawnStartDelay + sp.remainingSpawnDelay) <=
          GameCoreWaveManager.SpawnStartEpsilon
      ) {
        const spawnData = sp.spawnData!;
        const sideOffset = f(
          Mathf.Round(f(spawnData.offsetStartAngle * GameCoreWaveManager.OffsetAngleScale)) *
            spawnData.offsetDist,
        );
        const sampled = spawnData.pathCurve.sampleDirect(spawnData.pathStartTime, sideOffset);
        const pos = new Vector3(sampled.x, sampled.y, sampled.z);
        // NOTE: the binary contains a second, result-discarded
        // SampleDirect(pathStartTime, 0) call here (dead code — not ported).

        const prefab = spawnData.enemyObject;
        if (prefab !== null) {
          if (prefab.spawnMode === ESpawnMode.Balloon) {
            pos.y = f(pos.y + prefab.balloonSpawnHeight);
          } else if (prefab.enemyMoveType === EEnemyMoveTypeDef.air) {
            pos.y = f(pos.y + prefab.groundOffsetY);
          }
        }

        Events.spawnGroupStartedEvent.invoke(groupId, null, pos, isMinnion);
        sp.hasTriggeredStartEvent = true;
      }
      groupId++;
    }

    const dt = GameCore.tickDeltaTime;

    // The wave has not begun yet: just burn down its start delay.
    if (a_currentWave.remainingSpawnStartDelay > 0.0) {
      a_currentWave.remainingSpawnStartDelay = Mathf.Max(
        f(a_currentWave.remainingSpawnStartDelay - dt),
        f(0.0),
      );
      return false;
    }

    if (!a_currentWave.started) {
      a_currentWave.started = true;
      Events.waveStartedEvent.invoke(this, a_currentWaveIndex);
    }

    if (a_currentWave.remainingWaveActivateDelay > 0.0) {
      a_currentWave.remainingWaveActivateDelay = Mathf.Max(
        f(a_currentWave.remainingWaveActivateDelay - dt),
        f(0.0),
      );
      if (a_currentWave.remainingWaveActivateDelay <= 0.0 && !isMinnion) {
        Events.waveActivateEvent.invoke(this, a_currentWaveIndex);
      }
    }

    a_currentWave.remainingWaveTime = Mathf.Max(f(a_currentWave.remainingWaveTime - dt), f(0.0));

    // Pass 2: actual spawning.
    let waveComplete = a_currentWave.remainingWaveActivateDelay <= 0.0;
    let spawnerIndex = -1;
    for (const sp of a_currentWave.spawnerProgress) {
      spawnerIndex++;
      if (sp.remainingSpawnDelay > GameCoreWaveManager.SpawnDelayEpsilon) {
        sp.remainingSpawnDelay = f(sp.remainingSpawnDelay - dt);
        waveComplete = false;
        continue;
      }
      if (sp.numSpawned >= sp.numToSpawn) continue; // keeps 'waveComplete' as-is (confirmed)

      const spawnData = sp.spawnData!;
      const pathStartTime = f(
        Mathf.Round(
          f(
            f(spawnData.offsetStartAngle * GameCoreWaveManager.OffsetAngleScale) +
              f(a_currentWave.waveTime * spawnData.enemySpawnInterval),
          ),
        ) * spawnData.offsetDist,
      ); // INFERRED: offsetDist scaling of the rounded time

      const enemy = new GameCoreEnemy(
        spawnData.enemyObject,
        spawnData.pathCurve,
        spawnData.pathSegTypeInfos,
        pathStartTime,
        spawnData.pathName,
        a_currentWave.speedRatio,
        a_currentWave.hpRatio,
        a_currentWave.moneyArray[a_currentWave.totalNumSpawned],
        a_currentWave.gemArray[a_currentWave.totalNumSpawned],
        a_currentWaveIndex,
        spawnerIndex,
        sp.numSpawned,
        spawnData.enemySpawnInterval,
        spawnData.offsetStartAngle,
        spawnData.walkDriftDist,
        spawnData.walkDriftFreq,
        isMinnion,
        spawnData.enemyTrackerEnable,
      );

      // C#: GameObjectHelper.SetParent(enemy.GetUnityObject(), viewer.GetEnemyRoot())
      // TS ADAPTATION: view-side parenting — the browser enemy-viewer factory
      // parents on enemySpawnEvent; no-op headless.

      Events.enemySpawnEvent.invoke(enemy);

      if (enemy.isBoss) this.m_bossHandle = enemy.handle;

      if (sp.numSpawned === sp.numToSpawn - 1) {
        Events.spawnGroupEndedEvent.invoke(a_currentWaveIndex * 1000 + spawnerIndex);
      }

      a_currentWave.totalNumSpawned++;
      sp.numSpawned++;
      if (sp.numSpawned < sp.numToSpawn) {
        sp.remainingSpawnDelay = f(spawnData.enemySpawnInterval);
        waveComplete = false;
      }
    }

    a_currentWave.waveTime = f(a_currentWave.waveTime + dt);
    return waveComplete;
  }

  // SkipToWave @0x4D4150 (debug/walkthrough helper)
  skipToWave(waveIndex: number): void {
    this.setupWaveData(this.m_difficultyLevel);
    this.currentWaveIndex = Mathf.Clamp(waveIndex | 0, 0, this.waveProgress.length - 1);
    this.waveProgress[this.currentWaveIndex].remainingSpawnStartDelay = f(0.0);
  }

  // SetupWaveData @0x4D1F80 — (re)builds waveProgress from the stage's
  // WaveResource for a given difficulty. A negative delay marks the end of
  // the playable wave list for that difficulty.
  setupWaveData(a_difficulty: Difficulty): void {
    this.m_difficultyLevel = a_difficulty;
    const stage = getCurrentStage();
    this.waveClearTimeBonusRate = f(stage !== null ? stage.initWaveTimeRate : 1.0);

    this.waveProgress = [];
    this.waveBossMinionProgress = [];

    const resource = this.viewer!.getWaveResource(); // FAITHFUL: NRE on null viewer
    for (const waveData of resource.waveDataList) {
      if (waveData.delay[this.m_difficultyLevel] < 0.0) break;
      this.waveProgress.push(this.createWaveProgress(waveData));
    }

    let bossList: BossMinionSpawnDataContract[] | null = resource.waveDataBossListMedium;
    if (this.m_difficultyLevel === Difficulty.Hard) bossList = resource.waveDataBossListHard;
    else if (this.m_difficultyLevel === Difficulty.Easy) bossList = resource.waveDataBossListEasy;

    if (bossList !== null) {
      for (const minionData of bossList) {
        const progress = this.createWaveProgress(minionData.waveData);
        progress.remainingSpawnStartDelay = f(minionData.time);
        this.waveBossMinionProgress.push(progress);
      }
    }
  }

  // CreateWaveProgress @0x4D4220 — builds the runtime progress record for
  // one WaveData: per-difficulty delay/speed/hp ratios, dialog settings,
  // the wave activate delay (time for the fastest spawner's enemies to
  // reach the activate node), per-spawner SpawnProgress entries, total wave
  // time and the per-enemy money/gem distribution arrays.
  createWaveProgress(waveData: WaveDataContract): WaveProgress {
    const progress = new WaveProgress();
    const diff = this.m_difficultyLevel;

    progress.remainingSpawnStartDelay = f(waveData.delay[diff]);
    progress.speedRatio = f(waveData.speedRatio[diff]);
    progress.hpRatio = f(waveData.hpRatio[diff]);
    progress.totalNumSpawned = 0;
    progress.dialogStageSettings = {
      label: waveData.dialogLabel[diff],
      icon: waveData.dialogIcon[diff],
    };
    progress.remainingWaveActivateDelay = f(Number.MAX_VALUE);

    // Activate delay: minimum over spawners of
    // curveLengthB4Activation / (speedRatio * enemy speed), where the enemy
    // speed depends on its spawn mode (balloon/fire override).
    const spawnList = waveData.perDifficulyLists[diff].spawnDataList;
    const numSpawners = spawnList.length;
    for (let spawnerIndex = 0; spawnerIndex < numSpawners; spawnerIndex++) {
      const spawnData = spawnList[spawnerIndex];
      const prefab = spawnData.enemyObject!;
      // C#: prefab.AverageSpeed @0x7f97e0 =
      //   (bossType == None || !isJumpingBoss) ? speed
      //   : (bossJumpDur * speed) / (bossJumpDur + bossRestDur)
      let speed = f(prefab.speed);
      if (!(prefab.bossType === 0 || !prefab.isJumpingBoss)) {
        speed = f(f(prefab.bossJumpDur * prefab.speed) / f(prefab.bossJumpDur + prefab.bossRestDur));
      }
      if (prefab.spawnMode === ESpawnMode.Balloon) speed = f(prefab.balloonSpeed);
      else if (prefab.spawnMode === ESpawnMode.Fire) speed = f(prefab.fireSpeed);

      const activateTime = f(
        spawnData.pathCurve.curveLengthB4Activation / f(waveData.speedRatio[diff] * speed),
      );
      if (activateTime < progress.remainingWaveActivateDelay) {
        progress.remainingWaveActivateDelay = activateTime;
      }
    }

    // Per-spawner progress.
    let totalNumEnemy = 0;
    for (const spawnData of spawnList) {
      const sp = new SpawnProgress();
      sp.remainingSpawnDelay = f(spawnData.delay);
      sp.numToSpawn = getEnemyToSpawnByDifficulty(spawnData.enemySpawnNum);
      sp.spawnData = spawnData;
      progress.spawnerProgress.push(sp);
      totalNumEnemy += sp.numToSpawn;
    }
    progress.totalNumEnemy = totalNumEnemy;
    progress.totalNumEnemyDead = 0;

    // Total wave time: last spawner's start delay plus its spawn train.
    const lastSpawner = progress.spawnerProgress[numSpawners - 1];
    progress.remainingWaveTime = f(progress.remainingWaveTime + lastSpawner.remainingSpawnDelay);
    if (lastSpawner.numToSpawn > 1) {
      progress.remainingWaveTime = f(
        progress.remainingWaveTime +
          f((lastSpawner.numToSpawn - 1) * lastSpawner.spawnData!.enemySpawnInterval),
      );
    }

    progress.moneyArray = this.distributeCurrency(
      waveData.totalMoney[diff] | 0,
      waveData.money[diff] | 0,
      totalNumEnemy,
    );
    progress.gemArray = this.distributeCurrency(
      waveData.totalGem[diff] | 0,
      waveData.gem[diff] | 0,
      totalNumEnemy,
    );
    // CheckWaveMoney/CheckWaveGem @0x4D4E00/@0x4D4E20 — [Conditional]
    // debug verifies; no-ops in this build (not ported).
    return progress;
  }

  // Money and gem distribution share one inlined algorithm in the binary
  // (CreateWaveProgress @0x4D44D0..0x4D4B00 / @0x4D4B00..0x4D4DE0; INFERRED
  // factoring — the two copies are identical in shape). 'baseValue' is the
  // guaranteed per-enemy amount (max of the flat per-wave value and
  // total/numEnemies, int division); the remainder is sprinkled over
  // randomly chosen entries that still hold exactly baseValue, using the
  // deterministic GameCoreObject RNG.
  private distributeCurrency(total: number, baseValueSetting: number, totalNumEnemy: number): number[] {
    const baseValue = Math.max(Math.trunc(total / totalNumEnemy), baseValueSetting);
    const array = new Array<number>(totalNumEnemy).fill(baseValue);

    let numLeftoverEnemies = 0;
    if (baseValue > 0) numLeftoverEnemies = totalNumEnemy - Math.trunc(total / baseValue);

    if (numLeftoverEnemies >= 0 && baseValue === baseValueSetting) {
      // The flat setting already covers everyone: zero the entries outside
      // the even split; the very last picked entry receives the remainder.
      const remainder = baseValue < 1 ? 0 : total % baseValue;
      while (numLeftoverEnemies > 0) {
        let idx: number;
        do {
          idx = GameCoreObject.randomRangeI(0, array.length, this.handle);
        } while (array[idx] !== baseValue);
        numLeftoverEnemies--;
        array[idx] = numLeftoverEnemies === 0 && remainder > 0 ? remainder : 0;
      }
    } else {
      // Uneven split: distribute (total % totalNumEnemy) as +1 bonuses.
      let leftoverCurrency = total % totalNumEnemy;
      while (leftoverCurrency > 0) {
        let idx: number;
        do {
          idx = GameCoreObject.randomRangeI(0, array.length, this.handle);
        } while (array[idx] !== baseValue);
        array[idx] = baseValue + 1;
        leftoverCurrency--;
      }
    }
    return array;
  }

  // RecreateViewer @0x4D4E40 (virtual slot 5) — re-links the
  // (non-serializable) SpawnData references after a load.
  override recreateViewer(): unknown | null {
    // TS ADAPTATION: Object.FindObjectOfType<Q4.WaveManager> → a view-layer
    // concern; the headless sim keeps its existing viewer reference. The
    // spawnData relink loop only matters across network resync (Phase 4).
    return this.viewer;
  }

  // ---- event handlers -------------------------------------------------

  // OnGameOver @0x4D52A0 — FAITHFUL: sets the base destroyed field only;
  // the removal + unsubscribe happens on the next Tick's DestroySelf call.
  onGameOver(): void {
    this.destroyed = true;
  }

  // OnEnemyDestroyed @0x4D52B0
  onEnemyDestroyed(_tower: GameCoreTower | null, enemy: GameCoreEnemy, _hitInfo: EnemyHitInfo): void {
    this.onDeadEnemy(enemy);
  }

  // OnDeadEnemy @0x4D52C0 — counts the kill against its wave. When the wave
  // is wiped out: zero the dead wave's timers on the LATEST manager
  // version, shorten the next wave's start delay by waveClearTimeBonusRate,
  // then raise waveEndedEvent.
  private onDeadEnemy(enemy: GameCoreEnemy | null): void {
    if (enemy === null) return;
    const waveIndex = enemy.waveIndex;
    if (waveIndex < 0 || this.waveProgress.length <= waveIndex) return;

    const progress = this.waveProgress[waveIndex];
    progress.totalNumEnemyDead++;
    if (progress.totalNumEnemy !== progress.totalNumEnemyDead) return;

    if (waveIndex + 1 < this.waveProgress.length) {
      const latest = this.handle.getMostRecentObjectVersion<GameCoreWaveManager>();
      // PORT GUARD: after gameOverEvent the manager is flagged destroyed and the handle no longer resolves; C# would NRE here
      // (Unity logs the exception and carries on with the frame) - skip the wave-end bookkeeping instead.
      if (latest === null) return;
      const deadWave = latest.waveProgress[waveIndex];
      deadWave.remainingWaveTime = f(0.0);
      deadWave.remainingSpawnStartDelay = f(0.0);
      deadWave.remainingWaveActivateDelay = f(0.0);

      const next = latest.waveProgress[waveIndex + 1];
      const startDelay = f(next.remainingSpawnStartDelay);
      next.remainingSpawnStartDelay = Mathf.Max(
        f(startDelay - f(f(startDelay * this.waveClearTimeBonusRate) - startDelay)),
        f(0.0),
      );
    }

    Events.waveEndedEvent.invoke(this, waveIndex);
  }

  // OnEnemyAttacked @0x4D5520 — an enemy that reached the home counts as
  // dead for wave bookkeeping (bosses excepted — they must actually die).
  onEnemyAttacked(enemy: GameCoreEnemy, _home: GameCoreHome, _chibi: ChibiData): void {
    if (!enemy.isBoss) this.onDeadEnemy(enemy);
  }

  // OnIntroSequenceFinished @0x4D5540
  onIntroSequenceFinished(_finishedPlayer: GameCorePlayer): void {
    const latest = this.handle.getMostRecentObjectVersion<GameCoreWaveManager>()!;
    latest.m_introSequenceFinished = true;
    latest.stageStartDelay = GameCoreWaveManager.StageStartDelayAfterIntro; // 4.75
  }
}
