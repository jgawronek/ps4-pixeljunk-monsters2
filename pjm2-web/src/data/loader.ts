// src/data/loader.ts
// TypeScript port of decomp/src/GameData/GameDataLoader.cs.
// Loads the numeric gameplay tables extracted from the user's own copy
// (decomp/data/*.json). Transport-agnostic: callers supply already-parsed JSON
// via a `readJson(file)` function (Node: fs; browser: fetch + JSON.parse).
//
// Source JSON files (all under decomp/data/):
//   enemy_roster.json                     → Enemies
//   structures_TowerBase.json             → Towers
//   structures_TowerUpgradeSettingGeneric.json → merged into Towers.upgrades
//   stage_waves_resolved.json             → Stages
//   stages_DifficultySettings.json        → Difficulties
//   globalsettings_AreaStageInfoMap.json  → Areas

import {
  EEnemyClassTypeDef,
  EEnemyMoveTypeDef,
  EEnemyStrengthTypeDef,
  ESpawnMode,
  ETowerAttackDef,
} from './enums';
import type {
  AreaInfo,
  AttackAttenuation,
  DifficultyMultipliers,
  EnemyAttributes,
  EnemyDefinition,
  StageDefinition,
  StageInfo,
  TowerDefinition,
  TowerUpgradeLevel,
  Vector3Data,
  Wave,
  WaveDifficulty,
  WaveSpawn,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** Field readers mirroring the C# loader's F/I/S/B helpers (with same defaults). */
function F(e: Json, n: string, d = 0): number {
  const v = e?.[n];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function I(e: Json, n: string, d = 0): number {
  const v = e?.[n];
  return typeof v === 'number' && Number.isFinite(v) ? v | 0 : d;
}
function S(e: Json, n: string): string | null {
  const v = e?.[n];
  return typeof v === 'string' ? v : null;
}
function B(e: Json, n: string): boolean {
  const v = e?.[n];
  return typeof v === 'number' ? v !== 0 : v === true;
}

export type ReadJson = (file: string) => Json;

export class GameDataLoader {
  readonly enemies = new Map<string, EnemyDefinition>();
  readonly towers = new Map<string, TowerDefinition>();
  readonly stages: StageDefinition[] = [];
  readonly difficulties: DifficultyMultipliers[] = [];
  readonly areas: AreaInfo[] = [];

  constructor(private readonly readJson: ReadJson) {}

  loadAll(): void {
    this.loadEnemies();
    this.loadTowers();
    this.loadUpgrades();
    this.loadStages();
    this.loadDifficulties();
    this.loadAreas();
  }

  private loadEnemies(): void {
    const doc = this.readJson('enemy_roster.json') as Record<string, Json>;
    for (const name of Object.keys(doc)) {
      const e = doc[name];
      const def: EnemyDefinition = {
        name,
        enemyMoveType: I(e, 'enemyMoveType') as EEnemyMoveTypeDef,
        spawnMode: I(e, 'spawnMode') as ESpawnMode,
        expValue: I(e, 'expValue'),
        maxLife: F(e, 'maxLife'),
        speed: F(e, 'speed'),
        fireSpeed: F(e, 'fireSpeed', 1),
        balloonSpeed: F(e, 'balloonSpeed', 1),
        maxShockSpeed: F(e, 'maxShockSpeed', 2),
        additionShockRate: F(e, 'additionShockRate', 1),
        collisionScaleH: F(e, 'collisionScaleH', 1),
        collisionScaleV: F(e, 'collisionScaleV', 1),
        animMoveSpeed: F(e, 'animMoveSpeed', 1),
        attributes: [],
      };
      const attrs = e?.attributes;
      if (Array.isArray(attrs)) {
        for (const a of attrs) {
          const at: EnemyAttributes = {
            effectScale: F(a, 'effectScale', 1),
            strengthDamageInfos: [],
            classDamageInfos: [],
          };
          const si = a?.strengthDamageInfos;
          if (Array.isArray(si)) {
            for (const s of si) {
              at.strengthDamageInfos.push({
                strength: I(s, 'strength') as EEnemyStrengthTypeDef,
                damageTime: F(s, 'damageTime', 1),
                reactionTime: F(s, 'reactionTime', 1),
              });
            }
          }
          // Improvement over the C# loader (which declared but never populated
          // classDamageInfos): the raw JSON carries them; load them too.
          const ci = a?.classDamageInfos;
          if (Array.isArray(ci)) {
            for (const c of ci) {
              at.classDamageInfos.push({
                classType: I(c, 'classType') as EEnemyClassTypeDef,
                damageTime: F(c, 'damageTime', 1),
                reactionTime: F(c, 'reactionTime', 1),
              });
            }
          }
          def.attributes.push(at);
        }
      }
      this.enemies.set(name, def);
    }
  }

  private loadTowers(): void {
    const doc = this.readJson('structures_TowerBase.json') as Json[];
    for (const e of doc) {
      const t: TowerDefinition = {
        gameObjectName: S(e, '__gameObject') ?? '',
        structureUID: I(e, 'structureUID'),
        towerName: S(e, 'towerName'),
        attackType: I(e, 'attackType') as ETowerAttackDef,
        strengthType: I(e, 'strengthType') as EEnemyStrengthTypeDef,
        classType: I(e, 'classType') as EEnemyClassTypeDef,
        enemyDetectionRange: F(e, 'enemyDetectionRange'),
        playerDetectionRange: F(e, 'playerDetectionRange'),
        attackPower: F(e, 'attackPower'),
        attackSpeed: F(e, 'attackSpeed'),
        attackRangeInner: F(e, 'attackRangeInner'),
        attackRangeOuter: F(e, 'attackRangeOuter'),
        attackSpread: F(e, 'attackSpread'),
        balloonAimable: B(e, 'balloonAimable'),
        oneShotOneBalloon: B(e, 'oneShotOneBalloon'),
        fullRangeFire: B(e, 'fullRangeFire'),
        costCoin: I(e, 'costCoin'),
        costGem: I(e, 'costGem'),
        refundCoin: I(e, 'refundCoin'),
        refundGem: I(e, 'refundGem'),
        buildTime: F(e, 'buildTime'),
        buildRange: F(e, 'buildRange'),
        magazineCapacity: I(e, 'magazineCapacity', -1),
        burstCount: I(e, 'burstCount', 1),
        burstInterval: F(e, 'burstInterval'),
        nextTargetToAttackIndex: I(e, 'nextTargetToAttackIndex'),
        fortAngleMax: F(e, 'fortAngleMax'),
        fortAngleMin: F(e, 'fortAngleMin'),
        rotateSpeedX: F(e, 'rotateSpeedX'),
        rotateSpeedY: F(e, 'rotateSpeedY'),
        dlcLock: B(e, 'dlcLock'),
        attackAttenuations: [],
        upgrades: [],
      };
      const att = e?.attackAttenuations;
      if (Array.isArray(att)) {
        for (const a of att) {
          t.attackAttenuations.push({
            rate: F(a, 'rate'),
            attenuation: F(a, 'attenuation', 1),
            snap: B(a, 'snap'),
          } satisfies AttackAttenuation);
        }
      }
      if (t.gameObjectName !== '') {
        this.towers.set(t.gameObjectName, t);
      }
    }
  }

  private loadUpgrades(): void {
    let doc: Json[];
    try {
      doc = this.readJson('structures_TowerUpgradeSettingGeneric.json') as Json[];
    } catch {
      return; // file optional (matches C# File.Exists guard)
    }
    if (!Array.isArray(doc)) return;
    for (const e of doc) {
      const go = S(e, '__gameObject');
      if (go === null) continue;
      const t = this.towers.get(go);
      if (!t) continue;
      const ups = e?.upgrades;
      if (!Array.isArray(ups)) continue;
      for (const u of ups) {
        t.upgrades.push({
          level: I(u, 'level'),
          reachExp: I(u, 'reachExp'),
          costCoin: I(u, 'costCoin'),
          costGem: I(u, 'costGem'),
          refundCoin: I(u, 'refundCoin'),
          refundGem: I(u, 'refundGem'),
          attackPower: F(u, 'attackPower'),
          attackSpeed: F(u, 'attackSpeed'),
          attackRangeInner: F(u, 'attackRangeInner'),
          attackRangeScale: F(u, 'attackRangeScale', 1),
          affectRangeRate: F(u, 'affectRangeRate', 1),
          attackSpread: F(u, 'attackSpread'),
          burstCount: I(u, 'burstCount', 1),
          burstInterval: F(u, 'burstInterval'),
        } satisfies TowerUpgradeLevel);
      }
    }
  }

  private loadStages(): void {
    const doc = this.readJson('stage_waves_resolved.json') as Json[];
    for (const e of doc) {
      const st: StageDefinition = {
        index: I(e, 'index'),
        stageName: S(e, 'stageName'),
        areaName: S(e, 'areaName'),
        initCoin: I(e, 'initCoin'),
        initGem: I(e, 'initGem'),
        waveCoinRate: F(e, 'waveCoinRate', 1),
        waveTimeRate: F(e, 'waveTimeRate', 1),
        waves: [],
      };
      const waves = e?.waves;
      if (Array.isArray(waves)) {
        for (const w of waves) {
          const wave: Wave = { perDifficulty: [] };
          if (Array.isArray(w)) {
            for (const d of w) {
              const wd: WaveDifficulty = {
                spawns: [],
                waveParams: (d?.waveParams ?? {}) as Record<string, unknown>,
              };
              const sp = d?.spawns;
              if (Array.isArray(sp)) {
                for (const s of sp) wd.spawns.push(readSpawn(s));
              }
              wave.perDifficulty.push(wd);
            }
          }
          st.waves.push(wave);
        }
      }
      this.stages.push(st);
    }
  }

  private loadDifficulties(): void {
    const doc = this.readJson('stages_DifficultySettings.json') as Json[];
    const root = doc[0];
    const ds = root?.difficultySettings;
    if (!Array.isArray(ds)) return;
    for (const d of ds) {
      this.difficulties.push({
        coinValueRate: F(d, 'coinValueRate', 1),
        danceEXPRate: F(d, 'danceEXPRate', 1),
        towerBuildTimeRate: F(d, 'towerBuildTimeRate', 1),
        enemyHPRate: F(d, 'enemyHPRate', 1),
        bossHPRate: F(d, 'bossHPRate', 1),
        enemyAmountRate: F(d, 'enemyAmountRate', 1),
      });
    }
  }

  private loadAreas(): void {
    const doc = this.readJson('globalsettings_AreaStageInfoMap.json') as Json[];
    const root = doc[0];
    const areas = root?.areaInfos;
    if (!Array.isArray(areas)) return;
    for (const a of areas) {
      const ai: AreaInfo = { areaLabel: S(a, 'areaLabel'), stageInfos: [] };
      const sis = a?.stageInfos;
      if (Array.isArray(sis)) {
        for (const si of sis) {
          ai.stageInfos.push({
            initialLocked: B(si, 'initialLocked'),
            stageSceneName: S(si, 'stageSceneName'),
            stageLabel: S(si, 'stageLabel'),
            stageUnlockName: S(si, 'stageUnlockName'),
            areaIDOverride: I(si, 'areaIDOverride', -1),
          } satisfies StageInfo);
        }
      }
      this.areas.push(ai);
    }
  }
}

function readSpawn(s: Json): WaveSpawn {
  const pathList: Vector3Data[] = [];
  const pl = s?.m_pathList;
  if (Array.isArray(pl)) {
    for (const p of pl) pathList.push({ x: F(p, 'x'), y: F(p, 'y'), z: F(p, 'z') });
  }
  const segTypeList: number[] = [];
  const sg = s?.m_segTypeList;
  if (Array.isArray(sg)) {
    for (const g of sg) segTypeList.push(typeof g === 'number' ? g | 0 : 0);
  }
  return {
    enemy: S(s, 'enemy'),
    enemySpawnNum: I(s, 'enemySpawnNum'),
    enemySpawnInterval: F(s, 'enemySpawnInterval'),
    delay: F(s, 'delay'),
    enemyTrackerEnable: B(s, 'enemyTrackerEnable'),
    pathStartTime: F(s, 'pathStartTime'),
    pathName: S(s, 'm_pathName'),
    activateIndex: I(s, 'm_activateIndex'),
    pathList,
    segTypeList,
    offsetStartAngle: F(s, 'offsetStartAngle'),
    offsetFreq: F(s, 'offsetFreq'),
    offsetDist: F(s, 'offsetDist'),
    walkDriftFreq: F(s, 'walkDriftFreq'),
    walkDriftDist: F(s, 'walkDriftDist'),
  };
}
