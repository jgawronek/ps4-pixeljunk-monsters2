// src/main/headless-stage1.ts
// PHASE 1 MILESTONE RUNNER — `npm run sim:stage1`.
// Simulates tl_stage_001 (3d_stage_001, area 1 stage 1) end-to-end in Node
// with ZERO rendering: the real wave tables (stages_WaveResource.json idx 12,
// joined by path_id 8680/8610 — NOT the attribution array order), the real
// scene tree/home layout (public/assets/stages/3d_stage_001/scene.json),
// the real tower_001 (arrow) stats, scripted build+collection bot, and a
// deterministic replay hash over per-tick sim state.
//
// Harness-level seams (documented, NOT sim modifications):
//   * enemyDestroyedEvent → currency drops: the Q4.PickupManager port (src/view/pickups/PickupDrops.ts,
//     docs/ENEMY_DROPS_ANALYSIS.md) with the real prop_001/prop_002 prefabs. Terrain: only
//     sphereCast(terrainMask) uses the real Rapier stage world (pickups need a floor); the rest of
//     the physics seam stays null so the logical pipeline is unchanged.
//   * tower_001 projectile: the raw projectile PPtr is unresolved in the
//     extraction (DATA GAP) — GameCoreProjectileTrajectory with the tower's
//     serialized stats stands in; flagged in the report.
//   * enemy detector: EnemyDetectorViewCone PPtrs unresolved (DATA GAP) —
//     EnemyDetectorSphere(offset (0,1,0), attackRangeInner+attackSpread)
//     stands in (same family as the shipped sphere detectors).
//   * scripted bot: builds arrow towers on the best path-adjacent trees when
//     affordable, walks the player to the nearest currency pickup. Player
//     speed 4 u/s is a BOT CONSTANT (the tikiman's real walk speed is view
//     data, not sim data).
//
// Determinism: SimDriver seeds unityRandom with InitState(updateCount) each
// tick exactly like GameCoreBridge; everything else is data-driven. The
// replay hash must be identical across runs/machines (f32 discipline).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Bounds, Mathf, Quaternion, Vector3 } from '../engine/math';
import { Events } from '../core/Events';
import { EventTime } from '../core/event/CoreEvent';
import { EInventoryType, GameCoreInventory } from '../core/GameCoreInventory';
import { GameCore, setInstanceProvider } from '../core/GameCore';
import { setBoundsProvider } from '../core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../core/GameCoreEnemy';
import type { EnemyHitInfo } from '../core/EnemyHitInfo';
import { GameCoreHandle, setViewerResolver } from '../core/GameCoreHandle';
import { GameCoreHome, setHomeQueryHeight } from '../core/GameCoreHome';
import type { GameCorePickup } from '../core/GameCorePickup';
import { GameCorePickupCurrency } from '../core/GameCorePickupCurrency';
import { PickupDropManager } from '../view/pickups/PickupDrops';
import { STAGE_PICKUP_MANAGERS } from '../data/dropData.generated';
import { GameCorePlayer } from '../core/GameCorePlayer';
import { GameCoreTower } from '../core/GameCoreTower';
import { GameCoreTree } from '../core/GameCoreTree';
import { EnemyDetectorSphere } from '../core/EnemyDetectorSphere';
import { GameCoreProjectileTrajectory } from '../core/GameCoreProjectileTrajectory';
import { Difficulty, GameCoreWaveManager } from '../core/GameCoreWaveManager';
import { BuildTowerCommand } from '../core/network/BuildTowerCommand';
import { UpgradeTowerCommand } from '../core/network/UpgradeTowerCommand';
import { IntroSequenceSkipCommand } from '../core/network/IntroSequenceSkipCommand';
import { Q4Layers, setSimPhysics } from '../core/physics-seam';
import { createQueries } from '../engine/physics/queries';
import { loadStageWorld } from '../engine/physics/world';
import { EEnemyClassTypeDef, EEnemyMoveTypeDef, EEnemyStrengthTypeDef, ETowerAttackDef } from '../core/enums';
import { SimDriver } from './sim-driver';
import { resetSimGlobals } from './simReset';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  setCurrentStageProvider,
  setEnemyViewerFactory,
  setGamePreferencesProvider,
  setTowerDatabaseProvider,
  setTowerViewerFactory,
  type EnemyViewerContract,
  type HomeViewContract,
  type NatureTreeViewContract,
  type PickupPrefabContract,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { balloonAttributes, enemyAttackPointsFor, enemyAttributesFor } from '../data/enemyAttributes';
import { BALLOON_ENEMIES } from '../data/enemyBalloons';
import { ENEMY_MODEL_BOUNDS } from '../data/enemyBounds.generated';
import { realTowerContract } from './headlessTowers';
import { buildUpgradeSettings, type TowerUpgradeTable } from '../view/tower/TowerUpgradeSetting';
import { loadStageMainContract, loadWaveResource, headlessWaveManagerView } from '../data/waveResource';
import { stageByNumber } from '../data/stageCatalog';
import { PROJECTILE_DATA } from '../view/projectiles/projectileData.generated';

const f = Math.fround;
const DT = 1 / 60;
const HERE = path.dirname(fileURLToPath(import.meta.url)); // pjm2-web/src/main
const DECOMP_DATA = path.resolve(HERE, '../../../decomp/data');
// Multi-stage: `npm run sim:stage1 -- <N>` (or STAGE=N) plays stage N from its per-stage bundle
// (public/assets/data/stageN-bundle.json, record idx 0; tools/data/export_stage_bundles.py) and
// public/assets/stages/<scene>/scene.json. Stage 1 (default) keeps reading decomp/data idx 12 so
// its replay hash is untouched.
// RE-ENTRANT: the per-stage inputs below are (re)selected by selectStage(); the CLI selects once at import,
// runHeadlessStage(n) re-selects (tests play stages back to back in one process: tests/main/multistage-sim.test.ts).
let STAGE_NUM = 1;
let STAGE_INFO: NonNullable<ReturnType<typeof stageByNumber>>;
let SCENE_JSON = '';
let BOT_MODE: 'legacy' | 'smart' = 'legacy';
let SMART = false;
let STAGE_INDEX = 12;
let BUNDLE_JSON: Record<string, unknown> | null = null;
const readJson = (file: string): unknown =>
  BUNDLE_JSON !== null ? BUNDLE_JSON[file] : JSON.parse(fs.readFileSync(path.join(DECOMP_DATA, file), 'utf8'));
function selectStage(n: number): void {
  const info = stageByNumber(n);
  if (info === undefined) throw new Error(`unknown stage ${n}`);
  STAGE_NUM = n;
  STAGE_INFO = info;
  SCENE_JSON = path.resolve(HERE, `../../public/assets/stages/${info.scene}/scene.json`);
  BOT_MODE = (process.env.BOT ?? (n === 1 ? 'legacy' : 'smart')) === 'smart' ? 'smart' : 'legacy';
  SMART = BOT_MODE === 'smart';
  STAGE_INDEX = n === 1 ? 12 : 0; // stage 1: decomp/data idx 12 (path_id-verified); else bundle idx 0
  BUNDLE_JSON = n === 1 ? null : JSON.parse(
    fs.readFileSync(path.resolve(HERE, `../../public/assets/data/${info.bundle}`), 'utf8'),
  );
}
// BOT MODE. 'legacy' (stage-1 default, keeps the historic pin 0x61889fae2ea828f1): ONE tower_001 with the straight-line
// Trajectory stand-in, ground-only, every enemy damage table x1, null terrain linecast, null balloon view.
// 'smart' (stages >= 2 default; BOT=smart STAGE=1 for stage 1): real per-tower projectile prefabs + detector cones,
// the serialized Q4.EnemyAttributesSettings damage tables (src/data/enemyAttributes.ts), the Q4.Balloon contract,
// terrain linecast (flame/ice ground fire, arcs landing), and a tower-mix policy (cannon / crossbow / anti-air / gem
// towers) chosen from the stage's wave composition. See docs/STAGE_GAMEPLAY_AUDIT.md.

// ---- scene.json world transforms -------------------------------------------------

interface SceneNode {
  i: number;
  name: string;
  parent: number; // index into nodes, -1 root
  activeSelf: boolean;
  pos: [number, number, number];
  rot: [number, number, number, number];
  scale: [number, number, number];
}

interface SceneDoc {
  nodes: SceneNode[];
}

/** Compose the parent chain into a world TRS (TRS matrix order, no shear). */
function worldTransform(
  nodes: SceneNode[],
  node: SceneNode,
): { pos: Vector3; rot: Quaternion } {
  const chain: SceneNode[] = [];
  let cur: SceneNode | undefined = node;
  while (cur !== undefined && cur.parent >= 0) {
    chain.unshift(cur);
    cur = nodes[cur.parent];
  }
  let pos = new Vector3(0, 0, 0);
  let rot = Quaternion.identity;
  let scale = new Vector3(1, 1, 1);
  for (const n of chain) {
    const lp = new Vector3(n.pos[0], n.pos[1], n.pos[2]);
    const scaled = new Vector3(lp.x * scale.x, lp.y * scale.y, lp.z * scale.z);
    pos = pos.add(rot.multiplyVector(scaled));
    const lr = new Quaternion(n.rot[0], n.rot[1], n.rot[2], n.rot[3]);
    rot = rot.multiply(lr);
    scale = new Vector3(scale.x * n.scale[0], scale.y * n.scale[1], scale.z * n.scale[2]);
  }
  return { pos, rot };
}

// ---- headless view fixtures --------------------------------------------------------

const MODEL_BOUNDS = {
  size: { x: 0.6, y: 1.0, z: 0.6 },
  extents: { x: 0.3, y: 0.5, z: 0.3 },
};

/** REAL per-enemy Renderer.bounds (smart bot): the same bind-pose GLB bounds the browser feeds the sim (src/data/enemyBounds.generated.ts).
 *  Unknown prefab -> the flat 0.6 x 1.0 x 0.6 stand-in. The legacy bot (stage-1 pin 0x61889fae2ea828f1) keeps the flat stand-in. */
function modelBoundsFor(prefabName: string): { size: { x: number; y: number; z: number }; extents: { x: number; y: number; z: number } } {
  const b = ENEMY_MODEL_BOUNDS[prefabName];
  if (b === undefined) return MODEL_BOUNDS;
  return { size: { x: b[0], y: b[1], z: b[2] }, extents: { x: b[0] / 2, y: b[1] / 2, z: b[2] / 2 } };
}

/** Headless EnemyViewerContract (same surface as tests/core/wave-manager.test.ts). */
function headlessEnemyViewer(prefabName = '', expValue = 10): EnemyViewerContract & { expValue: number } {
  return {
    expValue, // Q4.EnemyBase.expValue (read through the viewer by GameCoreTower.OnEnemyDestroy; was missing -> NaN EXP)
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    gameObject: { tag: 'enemyView' },
    getComponentInChildrenBalloon: () =>
      SMART && prefabName in BALLOON_ENEMIES
        ? { balloonsRemaining: 3, hp: 225, gameObject: { getComponentEnemyAttributesSettings: () => balloonAttributes(), activeSelf: true, setActive: () => {} } }
        : null,
    findTransformWithTag: (tag: string) =>
      tag !== 'Character'
        ? null
        : { gameObject: { getComponentInChildrenRenderer: () => ({ bounds: SMART && !process.env.FLAT_BOUNDS ? modelBoundsFor(prefabName) : MODEL_BOUNDS }) } },
    attackPoints: () => (SMART ? enemyAttackPointsFor(prefabName) : null),
    isSlopeMovement: false,
    slopeDownSpeedScale: 1,
    slopeDownAngle: 30,
    slopeUpSpeedScale: 1,
    slopeUpAngle: 30,
    getComponentEnemyAttributesSettings: () => (SMART ? enemyAttributesFor(prefabName) : null),
  };
}

function treeViewer(pos: Vector3): NatureTreeViewContract {
  return {
    playerDetectionRange: 2,
    towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: pos.x, y: pos.y, z: pos.z } },
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

// ---- tower prefab: tower_001 (arrow) from structures_TowerBase.json ----------------

type Json = Record<string, unknown>;

function tower001Contract(raw: Json): TowerBaseContract {
  return {
    name: String(raw.__gameObject),
    gameObject: {},
    transform: { position: { x: 0, y: 0, z: 0 } },
    singletonInScene: false,
    nextTargetToAttackIndex: (raw.nextTargetToAttackIndex as number) | 0,
    attackType: raw.attackType as ETowerAttackDef,
    strengthType: raw.strengthType as EEnemyStrengthTypeDef,
    classType: raw.classType as EEnemyClassTypeDef,
    balloonAimable: (raw.balloonAimable as number) !== 0,
    attackPower: raw.attackPower as number,
    attackSpeed: raw.attackSpeed as number,
    attackRangeInner: raw.attackRangeInner as number,
    attackSpread: raw.attackSpread as number,
    costCoin: (raw.costCoin as number) | 0,
    costGem: (raw.costGem as number) | 0,
    buildTime: raw.buildTime as number,
    buildRange: raw.buildRange as number,
    refundCoin: (raw.refundCoin as number) | 0,
    refundGem: (raw.refundGem as number) | 0,
    magazineCapacity: (raw.magazineCapacity as number) | 0,
    rotateSpeedX: raw.rotateSpeedX as number,
    rotateSpeedXAcel: raw.rotateSpeedXAcel as number,
    rotateSpeedXDecl: raw.rotateSpeedXDecl as number,
    rotateSpeedY: raw.rotateSpeedY as number,
    rotateSpeedYAcel: raw.rotateSpeedYAcel as number,
    rotateSpeedYDecl: raw.rotateSpeedYDecl as number,
    oneShotOneBalloon: (raw.oneShotOneBalloon as number) !== 0,
    fullRangeFire: (raw.fullRangeFire as number) !== 0,
    fireAngleThreshold: raw.fireAngleThreshold as number,
    attackAttenuations: (raw.attackAttenuations as { rate: number; attenuation: number; snap: number }[]).map(
      (a) => ({ rate: f(a.rate), attenuation: f(a.attenuation), snap: a.snap !== 0 }),
    ),
    burstCount: (raw.burstCount as number) | 0,
    burstInterval: raw.burstInterval as number,
    cautionRange: raw.cautionRange as number,
    cautionIdleTime: raw.cautionIdleTime as number,
    cautionRotateSpeed: raw.cautionRotateSpeed as number,
    cautionRotateAngleMin: 10, // not serialized on this prefab (dump.cs default)
    playerDetectionRange: raw.playerDetectionRange as number,
    firePointNames: raw.firePointNames as string[],
    projectile: {
      // DATA GAP: projectile PPtr unresolved → Trajectory stand-in.
      getFireDirection: (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }),
      getGameCoreType: () => GameCoreProjectileTrajectory,
      traceTarget: true,
      maxLifeDuration: 5,
      getComponentInChildrenRenderer: () => ({ bounds: MODEL_BOUNDS }),
    },
    getComponentTowerUpgradeSetting: () => null, // generic upgrade JSON join pending
    getComponentEnemyDetectorView: () => ({
      // DATA GAP: cone PPtr unresolved → sphere stand-in (see header).
      createGameCoreDetector: () =>
        new EnemyDetectorSphere(
          new Vector3(0, 1, 0),
          f(f(raw.attackRangeInner as number) + f(raw.attackSpread as number)),
          1,
        ),
    }),
    findDeepChildY: () => 1.5, // fire-point height stand-in (scene node lookup pending)
    getFirePointByRemainingMag: () => ({ x: 0, y: 1.5, z: 0 }),
  };
}

// ---- synthetic layout (stages without an extracted scene) -------------------------------------
/** Tree sites generated along the wave paths: both sides of each Medium-difficulty path, ~2.4 u off the centre line,
 *  ranked by how many path samples lie within 5 u, min spacing 2.4 u, never within 3.5 u of home or 1.8 u of a path.
 *  Deterministic (pure arithmetic over the curve samples). NOT the original tree placement — mechanics only. */
function syntheticTrees(wr: { waveDataList: { perDifficulyLists: { spawnDataList: { pathCurve: { curveLength: number; curveLengthB4Activation: number; sampleLinearDistance(d: number): { x: number; y: number; z: number } } }[] }[] }[] }): Vector3[] {
  const samples: Vector3[] = [];
  const dirs: Vector3[] = [];
  const seen = new Set<string>();
  for (const wave of wr.waveDataList) {
    for (const sp of wave.perDifficulyLists[1].spawnDataList) {
      const c = sp.pathCurve;
      const key = `${c.curveLength.toFixed(3)}:${c.curveLengthB4Activation.toFixed(3)}`;
      if (seen.has(key)) continue; // identical path (same pathName) already sampled
      seen.add(key);
      for (let d = c.curveLengthB4Activation + 1; d < c.curveLength - 1; d += 2) {
        const a = c.sampleLinearDistance(d);
        const b = c.sampleLinearDistance(Math.min(c.curveLength, d + 0.5));
        const dir = new Vector3(b.x - a.x, 0, b.z - a.z);
        if (dir.magnitude < 1e-4) continue;
        samples.push(new Vector3(a.x, a.y, a.z));
        dirs.push(dir.normalized);
      }
    }
  }
  const cands: { p: Vector3; score: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const perp = new Vector3(-dirs[i].z, 0, dirs[i].x);
    for (const sgn of [1, -1]) {
      const p = samples[i].add(perp.mulScalar(2.4 * sgn));
      p.y = samples[i].y;
      if (Math.hypot(p.x, p.z) < 3.5) continue;
      let score = 0, tooClose = false;
      for (const q of samples) {
        const dd = Math.hypot(p.x - q.x, p.z - q.z);
        if (dd < 1.8) { tooClose = true; break; }
        if (dd < 5) score++;
      }
      if (!tooClose) cands.push({ p, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out: Vector3[] = [];
  for (const c of cands) {
    if (out.length >= 60) break;
    if (out.every((q) => Math.hypot(q.x - c.p.x, q.z - c.p.z) >= 2.4)) out.push(c.p);
  }
  return out;
}

// ---- replay hash (FNV-1a 64 over per-tick state words) ------------------------------

class ReplayHash {
  private h = 0xcbf29ce484222325n;
  private static P = 0x100000001b3n;
  addU32(v: number): void {
    let x = (v >>> 0);
    for (let i = 0; i < 4; i++) {
      this.h = (this.h ^ BigInt(x & 0xff)) * ReplayHash.P & 0xffffffffffffffffn;
      x >>>= 8;
    }
  }
  addF32(v: number): void {
    this.addU32(new DataView(new Float32Array([v]).buffer).getUint32(0, true));
  }
  get hex(): string {
    return '0x' + this.h.toString(16).padStart(16, '0');
  }
}

// ---- main ----------------------------------------------------------------------------

export interface HeadlessResult {
  stage: number;
  outcome: 'STAGE CLEARED' | 'GAME OVER' | 'TIME CAP';
  ticks: number;
  hash: string;
}

/** Play stage `n` headless to a terminal state. Re-entrant: resets every sim global first (simReset.ts). */
export async function runHeadlessStage(n: number, opts: { quiet?: boolean } = {}): Promise<HeadlessResult> {
  selectStage(n);
  resetSimGlobals();
  return main(opts.quiet === true);
}

async function main(quiet = false): Promise<HeadlessResult> {
  const report: string[] = [];
  const log = (s: string): void => {
    report.push(s);
    if (!quiet) console.log(s);
  };

  // ---- data ----
  const waveResource = loadWaveResource(STAGE_INDEX, readJson as (f: string) => never);
  const stageMain = loadStageMainContract(STAGE_INDEX, readJson as (f: string) => never);
  const towerRaw = (readJson('structures_TowerBase.json') as Json[]).find(
    (t) => t.__gameObject === 'tower_001',
  )!;
  const towerPrefab = tower001Contract(towerRaw);
  // Smart mode: the whole tower roster (towers.json = structures_TowerBase.json of every tower) with real contracts.
  const towerPrefabs = new Map<string, TowerBaseContract>();
  towerPrefabs.set(towerPrefab.name, towerPrefab);
  if (SMART) {
    const roster = JSON.parse(
      fs.readFileSync(path.resolve(HERE, '../../public/assets/data/towers.json'), 'utf8'),
    ) as Json[];
    const upgrades = buildUpgradeSettings(
      JSON.parse(fs.readFileSync(path.resolve(HERE, '../../public/assets/data/tower-upgrades.json'), 'utf8')) as TowerUpgradeTable,
    );
    for (const raw of roster) {
      const c = realTowerContract(raw);
      // Q4.TowerUpgradeSetting (Lv2..5 tables): kills bank EXP on the killing tower -> automatic level-ups, as in the game.
      c.getComponentTowerUpgradeSetting = () => upgrades.get(c.name) ?? null;
      towerPrefabs.set(c.name, c);
    }
  }
  // Stages whose scene is not extracted (6-15) run on a SYNTHETIC layout: home at the origin (every stage's home_001 is at
  // the origin and every wave path ends there) and trees generated along the wave paths (see syntheticTrees()).
  // SYNTH=1 forces it for a stage that has a scene (used by the pins so they survive scene extraction).
  const SYNTHETIC = process.env.SYNTH === '1' || !fs.existsSync(SCENE_JSON);
  const scene: SceneDoc = SYNTHETIC ? { nodes: [] } : (JSON.parse(fs.readFileSync(SCENE_JSON, 'utf8')) as SceneDoc);

  // ---- world bootstrap ----
  const driver = new SimDriver();
  const core = driver.core;
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  // No terrain in the headless seam for the LOGICAL pipeline: linecasts never hit (clear line of
  // sight), no water, enemies/chibis do not ground-conform — pinned replay-hash semantics.
  // EXCEPTION (pickups): currency drops are ballistic and need a floor (GameCorePickupCurrency
  // bounces via sphereCast(terrainMask); with a null seam every coin falls forever below y=-20,
  // where the lifespan quirk never expires it). The real Rapier stage world is loaded for
  // sphereCast(terrainMask) ONLY; everything else stays null so the rest of the pipeline is untouched.
  const physicsJson = path.resolve(
    HERE,
    `../../public/assets/stages/${STAGE_INFO!.scene}/physics/${STAGE_INFO!.scene}_colliders.json`,
  );
  let terrainQueries: ReturnType<typeof createQueries> | null = null;
  if (fs.existsSync(physicsJson) && !SYNTHETIC) {
    terrainQueries = createQueries(await loadStageWorld(physicsJson));
  }
  setSimPhysics({
    linecast: (ax, ay, az, bx, by, bz, mask, trig) =>
      SMART && process.env.LC !== '0' && terrainQueries !== null && mask === Q4Layers.terrainMask
        ? terrainQueries.linecast(ax, ay, az, bx, by, bz, mask, trig)
        : null,
    raycast: () => null,
    sphereCast: (ox, oy, oz, dx, dy, dz, radius, maxDist, mask, trig) =>
      terrainQueries !== null && mask === Q4Layers.terrainMask
        ? terrainQueries.sphereCast(ox, oy, oz, dx, dy, dz, radius, maxDist, mask, trig)
        : null,
    checkSphere: () => false,
  });

  // Scene content bounds → collision grid.
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  const grow = (p: Vector3): void => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  };
  let treePositions: Vector3[];
  let homeWorld: { pos: Vector3; rot: Quaternion };
  if (SYNTHETIC) {
    treePositions = syntheticTrees(waveResource);
    treePositions.forEach(grow);
    homeWorld = { pos: Vector3.zero, rot: Quaternion.identity };
  } else {
    const treeNodes = scene.nodes.filter((n) => n.activeSelf && /^tree_\d+/.test(n.name));
    treePositions = treeNodes.map((n) => {
      const w = worldTransform(scene.nodes, n);
      grow(w.pos);
      return w.pos;
    });
    const homeNode = scene.nodes.find((n) => n.name === 'home_001' && n.parent >= 0)!;
    homeWorld = worldTransform(scene.nodes, homeNode);
  }
  setBoundsProvider(
    () =>
      new Bounds(
        new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
        new Vector3(maxX - minX + 40, 80, maxZ - minZ + 40),
      ),
  );

  // Smart bot: tolerate the flat-platform y == home y knife edge of the home enemy query (GameCoreHome.setHomeQueryHeight); legacy stays faithful.
  setHomeQueryHeight(SMART && process.env.HOME_QH !== '0' ? 0.25 : 0);

  // Providers (SP defaults data-verified in q4-contracts where omitted).
  setCurrentStageProvider(() => stageMain);
  setGamePreferencesProvider(() => ({ difficultySetting: Difficulty.Medium }));
  setEnemyViewerFactory((prefab) => headlessEnemyViewer(prefab.name, prefab.expValue));
  setTowerDatabaseProvider(() => ({
    getData: (n: string) => towerPrefabs.get(n) ?? null,
  }));
  // Headless tower-viewer seam: C# spawns a scene instance per tower; here the
  // shared prefab record is wrapped per instance so position-relative queries
  // (fire point = tower muzzle) resolve in WORLD space. TowerStateAttack reads
  // getFirePointByRemainingMag as a world position (projectile spawn point).
  setTowerViewerFactory((prefab, _handleId, position, _rot) => ({
    ...prefab,
    // spawnPos = tower.position + down*height (height=2 default) → +3.5 lands
    // ~1.5 above the tower base (arrow muzzle).
    getFirePointByRemainingMag: () => ({ x: position.x, y: position.y + 3.5, z: position.z }),
  }));

  // ---- sim objects ----
  const trees: GameCoreTree[] = treePositions.map((p) => {
    const t = new GameCoreTree(p);
    registerUnityObject(t.handle.m_handle, treeViewer(p));
    return t;
  });

  const homeView: HomeViewContract = {
    playerDetectionRange: 2.0,
    enemyDetectionRange: 3.0,
    kidPrefab: {},
    chibiHomeZones: [
      { numChibi: 20, angleCenter: 0, angleSpread: 133, minDist: 2.02, maxDist: 2.31 },
    ],
    transform: {
      forward: (() => {
        const fwd = homeWorld.rot.multiplyVector(Vector3.forward);
        return { x: fwd.x, y: fwd.y, z: fwd.z };
      })(),
      position: { x: homeWorld.pos.x, y: homeWorld.pos.y, z: homeWorld.pos.z },
    },
    gameObject: {},
  };
  const home = new GameCoreHome(homeView);
  home.position = homeWorld.pos.clone();

  const player = new GameCorePlayer();
  player.playerId = 1;
  player.position = homeWorld.pos.add(new Vector3(3, 0, 3));

  const inventory = GameCoreInventory.getInventoryObject()!;

  const waveManager = new GameCoreWaveManager(headlessWaveManagerView(STAGE_INDEX, readJson as (f: string) => never));

  // ---- enemy death → currency drops: the Q4.PickupManager port (src/view/pickups/PickupDrops.ts) ----
  // Real coin/gem prefabs (prop_001 / prop_002), per-enemy PickupMovement launch data, value-20
  // coin splitting, gem credit via the CurrencyFlyer→AddInventoryCommand seam (no HUD here, so the
  // credit is issued straight through the command queue exactly like the flyer's first update).
  const drops = new PickupDropManager({
    globalCoinPerValueOverride:
      STAGE_PICKUP_MANAGERS[`BuildPlayer-${STAGE_INFO!.scene}_env`]?.globalCoinPerValueOverride ?? 0,
    issueCommand: (cmd, p) => driver.addPlayerCommand(cmd, p),
  });
  drops.install();
  let kills = 0;
  // Instrumentation (all modes; does not touch sim state): kills / spawns / home attacks by enemy class.
  const tally = (m: Map<string, number>, e: GameCoreEnemy): void => {
    const k = `${e.isBoss ? 'boss' : e.moveType() === EEnemyMoveTypeDef.air ? 'air' : e.isBalloon ? 'balloon' : 'ground'}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  const killsBy = new Map<string, number>(), spawnedBy = new Map<string, number>(), homeHitsBy = new Map<string, number>();
  const launchesBy = new Map<string, number>(), hitsBy = new Map<string, number>();
  Events.projectileLaunchEvent.addListener((t: GameCoreTower) => {
    const n = (t.getUnityObject() as { name?: string } | null)?.name ?? '?';
    launchesBy.set(n, (launchesBy.get(n) ?? 0) + 1);
  }, EventTime.Immediate);
  Events.projectileHitEvent.addListener((p: { sourceTower: { getMostRecentObjectVersion<T>(): T | null } }, d: unknown) => {
    const t = p.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const n = (t?.getUnityObject() as { name?: string } | null)?.name ?? '?';
    if (d !== null) hitsBy.set(n, (hitsBy.get(n) ?? 0) + 1);
  }, EventTime.Immediate);
  Events.enemySpawnEvent.addListener((e: GameCoreEnemy) => tally(spawnedBy, e), EventTime.Immediate);
  Events.enemyAttackedHomeEvent.addListener((e: GameCoreEnemy) => {
    tally(homeHitsBy, e);
    if (process.env.DEBUG_HIT === '1') console.log(`HIT w${e.waveIndex} t${driver.updateCount} ${(e as unknown as { m_prefabName: string }).m_prefabName} dXZ=${Math.hypot(e.position.x - home.position.x, e.position.z - home.position.z).toFixed(2)} dy=${(e.position.y - home.position.y).toFixed(3)} r=${e.collision.radius.toFixed(2)}`);
  }, EventTime.Immediate);
  Events.enemyDestroyedEvent.addListener(
    (_tower: GameCoreTower | null, _enemy: GameCoreEnemy, _info: EnemyHitInfo) => {
      kills++;
      tally(killsBy, _enemy);
    },
    EventTime.Immediate,
  );
  let pickedCoins = 0, pickedGems = 0, lostPickups = 0;
  Events.pickupAcquiredEvent.addListener((_p: GameCorePlayer, pk: GameCorePickup) => {
    if (pk instanceof GameCorePickupCurrency) {
      if (pk.inventoryType === EInventoryType.Gem) pickedGems += pk.value;
      else pickedCoins += pk.value;
    }
  }, EventTime.Immediate);
  Events.pickupLostEvent.addListener(() => { lostPickups++; }, EventTime.Immediate);

  // ---- scripted bot ----
  // Rank build sites: trees nearest any wave path node score highest.
  // Enemies are only targetable past curveLengthB4Activation (they emerge
  // from the spawn portal first) — sample each spawn curve AFTER that point.
  const pathNodes: Vector3[] = [];
  for (const wave of waveResource.waveDataList) {
    for (const spawn of wave.perDifficulyLists[1].spawnDataList) {
      const curve = spawn.pathCurve;
      const startD = curve.curveLengthB4Activation + 1;
      for (let d = startD; d < curve.curveLength; d += 2) {
        const p = curve.sampleLinearDistance(d);
        pathNodes.push(new Vector3(p.x, p.y, p.z));
      }
    }
  }
  const rankedTrees = [...trees].sort((a, b) => {
    const da = Math.min(...pathNodes.map((p) => Vector3.Distance(a.position, p)));
    const db = Math.min(...pathNodes.map((p) => Vector3.Distance(b.position, p)));
    return da - db;
  });
  // ---- smart tower-mix policy (BOT=smart) ----
  // air share of the stage's Medium waves decides how many anti-air-capable towers are mixed in;
  // every 3rd build is a gem tower (flame / ice / laser / hive / lightning / tesla / mortar) when gems allow.
  let airEnemies = 0, allEnemies = 0, balloonEnemies = 0;
  for (const wave of waveResource.waveDataList) {
    for (const sp of wave.perDifficulyLists[1].spawnDataList) {
      allEnemies += sp.enemySpawnNum;
      if (sp.enemyObject?.enemyMoveType === EEnemyMoveTypeDef.air) airEnemies += sp.enemySpawnNum;
      else if (sp.enemyObject !== undefined && sp.enemyObject !== null && ((sp.enemyObject as { name?: string }).name ?? '') in BALLOON_ENEMIES) balloonEnemies += sp.enemySpawnNum;
    }
  }
  const airShare = allEnemies > 0 ? airEnemies / allEnemies : 0;
  // Special towers, in rotation (flame, ice, laser, tesla, mortar, hive; lightning is 500 coins, left out): built whenever the
  // gem balance covers the next one, otherwise the coin pattern (cannon / crossbow / anti-air) is used.
  const GEM_ROTATION = ['tower_004', 'tower_006', 'tower_012', 'tower_003', 'tower_008', 'tower_002'];
  const aaShare = allEnemies > 0 ? (airEnemies + balloonEnemies) / allEnemies : 0; // balloon carriers can only be popped by anti-air-capable towers
  const AA = airShare >= 0.15 || (process.env.AA_BAL !== '0' && aaShare >= 0.15) ? 'tower_011' : 'tower_001';
  const COIN_SEQ = process.env.AA_BAL !== '0' && aaShare >= 0.3 && airShare < 0.5
    ? ['tower_001', 'tower_007', 'tower_001', AA, 'tower_001', AA, 'tower_006', 'tower_007', AA]
    : ['tower_001', 'tower_007', 'tower_001', AA, 'tower_001', 'tower_006', 'tower_001', 'tower_007', AA];
  const COIN_PATTERN = (k: number): string => COIN_SEQ[k % COIN_SEQ.length];
  const builtByName = new Map<string, number>();
  const singletonBuilt = new Set<string>();
  let coinBuilds = 0, gemIdx = 0;
  const smartWant = (coins: number, gems: number): TowerBaseContract => {
    for (let i = 0; i < GEM_ROTATION.length; i++) {
      const t = towerPrefabs.get(GEM_ROTATION[(gemIdx + i) % GEM_ROTATION.length])!;
      if (t.costGem > 0 && gems >= t.costGem && !(t.singletonInScene && singletonBuilt.has(t.name))) {
        return t;
      }
    }
    // Affordability fallback: when the next pattern tower is out of reach but the one after it (cheaper) is not, buy that now
    // instead of idling (early waves arrive on a timer; towers standing earlier beat the ideal mix).
    const nxt = towerPrefabs.get(COIN_PATTERN(coinBuilds))!;
    if (process.env.FALLBACK !== '0' && coins < nxt.costCoin) {
      const alt = towerPrefabs.get(COIN_PATTERN(coinBuilds + 1))!;
      if (alt.costCoin <= coins && alt.costCoin < nxt.costCoin) { coinBuilds++; return alt; }
    }
    return nxt;
  };
  // Smart site choice: the tower's real engagement ring is [attackRangeInner (dead zone), detector cone radius]; score a tree
  // by the number of active-path samples inside that ring (the legacy bot just took the tree nearest to any path node,
  // which lands INSIDE the dead zone of ring-limited towers: the real tower_001 never fired).
  const HOME_W = Number(process.env.HOME_W ?? 3), HOME_R = Number(process.env.HOME_R ?? 20);
  const DECAY = Number(process.env.DECAY ?? 1);
  const nodeW = pathNodes.map((q) => (HOME_W > 1 && Math.hypot(q.x - home.position.x, q.z - home.position.z) < HOME_R ? HOME_W : 1));
  const usedTrees = new Set<GameCoreTree>();
  const pickSite = (want: TowerBaseContract): GameCoreTree | null => {
    const det = PROJECTILE_DATA.towers[want.name]?.detector;
    const outer = det !== null && det !== undefined ? Math.min(det.upperRadius, det.lowerRadius) || Math.max(det.upperRadius, det.lowerRadius) : 4;
    const lo = want.attackRangeInner + 0.3;
    let best: GameCoreTree | null = null, bestScore = -1;
    for (const t of rankedTrees) {
      if (usedTrees.has(t) || !t.isTreeValid()) continue;
      let sc = 0;
      for (let qi = 0; qi < pathNodes.length; qi++) {
        const q = pathNodes[qi];
        const d = Math.hypot(t.position.x - q.x, t.position.z - q.z);
        if (d >= lo && d <= outer - 0.3) sc += nodeW[qi];
      }
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    if (best !== null) {
      usedTrees.add(best);
      // Diminishing returns: path samples this tower already covers count less for the next tower (spreads coverage over all paths).
      for (let qi = 0; qi < pathNodes.length; qi++) {
        const q = pathNodes[qi];
        const d = Math.hypot(best.position.x - q.x, best.position.z - q.z);
        if (d >= lo && d <= outer - 0.3) nodeW[qi] *= DECAY;
      }
    }
    return best;
  };
  const BUILD_RESERVE = 0; // spend everything on towers
  let nextSite = 0;
  const BOT_SPEED = 4; // u/s (bot constant, see header)

  let stageCleared = false;
  let gameOver = false;
  Events.stageClearedEvent.addListener(() => {
    stageCleared = true;
  }, EventTime.Immediate);
  Events.gameOverEvent.addListener(() => {
    gameOver = true;
  }, EventTime.Immediate);

  // Intro skip through the real command seam.
  driver.addPlayerCommand(new IntroSequenceSkipCommand(), player);

  const hash = new ReplayHash();
  // Initial chibi layout (SpawnChibi + SpreadOutChibi output). Per-tick words
  // below never see positions, so without this a placement change (e.g. the
  // SpawnChibi arc fix, @0x4bb4a2) is invisible to the replay hash.
  let arcMin = Infinity, arcMax = -Infinity;
  for (let i = 0; i < home.numChibi; i++) {
    const c = home.getChibiDataByIndex(i);
    hash.addF32(c.pos.x);
    hash.addF32(c.pos.y);
    hash.addF32(c.pos.z);
    // Unity yaw of the chibi around the home (0 = home forward +z).
    const deg = (Math.atan2(c.pos.x - home.position.x, c.pos.z - home.position.z) * 180) / Math.PI;
    arcMin = Math.min(arcMin, deg);
    arcMax = Math.max(arcMax, deg);
  }
  const chibiArc = `[${arcMin.toFixed(1)}°, ${arcMax.toFixed(1)}°]`;
  const MAX_TICKS = 60 * 60 * Number(process.env.CAP_MIN ?? 60); // sim-minutes cap (default 60: stages 13-15 need ~30)
  let ticks = 0;

  for (; ticks < MAX_TICKS; ticks++) {
    // Bot: build when affordable.
    if (nextSite < rankedTrees.length) {
      const coins = inventory.getAvailableInventory(player.handle, EInventoryType.Coin);
      const gems = inventory.getAvailableInventory(player.handle, EInventoryType.Gem);
      const want = SMART ? smartWant(coins, gems) : towerPrefab;
      if (coins >= want.costCoin + BUILD_RESERVE && gems >= want.costGem) {
        const site = SMART ? (pickSite(want) ?? rankedTrees[nextSite]) : rankedTrees[nextSite];
        if (site.isTreeValid()) {
          driver.addPlayerCommand(new BuildTowerCommand(site.handle, want), player);
          if (process.env.DEBUG_BUILD === '1') console.log(`BUILD t=${ticks} ${want.name} at (${site.position.x.toFixed(1)},${site.position.z.toFixed(1)}) dHome=${Math.hypot(site.position.x, site.position.z).toFixed(1)} coins=${coins}`);
          builtByName.set(want.name, (builtByName.get(want.name) ?? 0) + 1);
          if (want.singletonInScene) singletonBuilt.add(want.name);
          if (SMART) {
            const gi = GEM_ROTATION.indexOf(want.name);
            if (want.costGem > 0 && gi >= 0) gemIdx = (gi + 1) % GEM_ROTATION.length;
            else coinBuilds++;
          }
        }
        nextSite++;
      }
    }

    // Bot (smart): spend spare gems/coins on the paid tower upgrade shortcut (UpgradeTowerCommand tops EXP up to the next level).
    if (SMART && ticks % 20 === 0) {
      const coins = inventory.getAvailableInventory(player.handle, EInventoryType.Coin);
      const gems = inventory.getAvailableInventory(player.handle, EInventoryType.Gem);
      if (gems >= 1) {
        let best: GameCoreTower | null = null;
        for (const t of core.allObjects<GameCoreTower>(GameCoreTower)) {
          const nu = t.getNextUpgrade();
          if (nu === null || t.attackType === ETowerAttackDef.air && airShare < 0.15) continue;
          if (coins >= (nu.costCoin ?? 0) && gems >= (nu.costGem ?? 0) && (best === null || t.currentLevel < best.currentLevel)) best = t;
        }
        if (best !== null) driver.addPlayerCommand(new UpgradeTowerCommand(best.handle, best.getNextUpgrade()!.level), player);
      }
    }

    // Bot: walk toward the nearest currency pickup (magnetism does the rest).
    let nearest: GameCorePickupCurrency | null = null;
    let nearestD = Infinity;
    for (const c of core.allObjects<GameCorePickupCurrency>(GameCorePickupCurrency)) {
      const d = Vector3.Distance(player.position, c.position);
      if (d < nearestD) {
        nearestD = d;
        nearest = c;
      }
    }
    if (nearest !== null) {
      const dir = nearest.position.sub(player.position);
      dir.y = 0;
      const len = dir.magnitude;
      if (len > 1e-4) {
        const stepLen = Math.min(len, BOT_SPEED * DT);
        player.position = player.position.add(dir.mulScalar(stepLen / len));
      }
      // BOT FIX (smart mode): the real Tikiman walks ON the terrain; the legacy bot kept y=0, so on stages whose
      // ground lies 1.5-2 below that (stage 2: y -1.8) it stood right above the coins without ever touching them
      // ("collected 0 coins" -> economy starvation -> the stage-2 GAME OVER was partly this bot artifact).
      if (SMART) player.position = new Vector3(player.position.x, nearest.position.y, player.position.z);
    }

    if (process.env.DEBUG_ENEMY === '1' && ticks % 6000 === 0 && ticks > 30000) {
      for (const e of [...core.allObjects<GameCoreEnemy>(GameCoreEnemy)].slice(0, 3)) {
        console.log(`t=${ticks} enemy ${e.moveType() === EEnemyMoveTypeDef.air ? 'air' : 'gnd'} pos=(${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)}) pathD=${e.pathDistance.toFixed(2)} F[wait=${(e as any).m_waitTime} atk=${(e as any).m_isAttacking} can=${(e as any).m_canAttack} len=${(e as any).pathMove?.pathLength?.toFixed?.(2)}] spd=${e.speedCur.toFixed(2)} blocked=${e.isBlocked} life=${e.getLife().toFixed(0)} scale=${e.getSpeedScale()} buffs=${e.buffs.getAllBuffs().length} dest=${e.isDestroyed()} dHome=${Vector3.Distance(e.position, home.position).toFixed(2)}`);
      }
    }
    if (process.env.DEBUG_PICK === '1' && ticks % 300 === 0) {
      const cs = [...core.allObjects<GameCorePickupCurrency>(GameCorePickupCurrency)];
      console.log(`t=${ticks} player=(${player.position.x.toFixed(1)},${player.position.y.toFixed(1)},${player.position.z.toFixed(1)}) pickups=${cs.length}`, cs.slice(0, 3).map((c) => `(${c.position.x.toFixed(1)},${c.position.y.toFixed(1)},${c.position.z.toFixed(1)})`).join(' '));
    }
    driver.step(DT);
    driver.lateUpdate();

    // Replay digest (post-tick state).
    let enemyCount = 0;
    let lifeBits = 0;
    for (const e of core.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
      enemyCount++;
      lifeBits = (lifeBits + new DataView(new Float32Array([e.getLife()]).buffer).getUint32(0, true)) >>> 0;
    }
    hash.addU32(driver.updateCount);
    hash.addU32(enemyCount);
    hash.addU32(lifeBits);
    hash.addU32(inventory.getAvailableInventory(player.handle, EInventoryType.Coin));
    hash.addU32(home.numChibi);

    if (stageCleared || gameOver) break;
  }

  const waves = waveResource.waveDataList.length;
  log('');
  log('==== sim:stage1 report ====');
  log(`stage:            #${STAGE_NUM} ${STAGE_INFO!.scene} (WaveResource idx ${STAGE_INDEX}, Medium)`);
  log(`outcome:          ${stageCleared ? 'STAGE CLEARED' : gameOver ? 'GAME OVER' : 'TIME CAP'}`);
  log(`ticks:            ${ticks} (${(ticks / 60).toFixed(1)} sim-seconds)`);
  log(`waves:            ${waveManager.currentWaveIndex + 1} / ${waves}`);
  log(`enemies killed:   ${kills}`);
  log(`chibis remaining: ${home.numChibi} / 20`);
  log(`drops:           ${drops.spawnedCoins} coin + ${drops.spawnedGems} gem pickups spawned; collected ${pickedCoins} coins / ${pickedGems} gems; ${lostPickups} expired/lost`);
  log(`coins held:       ${inventory.getAvailableInventory(player.handle, EInventoryType.Coin)}`);
  log(`gems held:        ${inventory.getAvailableInventory(player.handle, EInventoryType.Gem)}`);
  log(`towers built:     ${nextSite} sites used (${[...builtByName].map(([k, v]) => `${k}x${v}`).join(' ') || 'tower_001 stand-in'})`);
  const fmt = (m: Map<string, number>): string => [...m].sort().map(([k, v]) => `${k}=${v}`).join(' ');
  log(`bot mode:         ${BOT_MODE}${SYNTHETIC ? ' (SYNTHETIC tree layout, no scene)' : ''}; air share of waves ${(airShare * 100).toFixed(0)}%`);
  log(`tower launches:   ${[...launchesBy].sort().map(([k, v]) => `${k}=${v}`).join(' ')} | projectile hits on a target: ${[...hitsBy].sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
  log(`tower levels:    ${[...core.allObjects<GameCoreTower>(GameCoreTower)].map((t) => `${(t.getUnityObject() as { name?: string } | null)?.name?.replace('tower_', '')}:L${t.currentLevel}/${Math.round(t.currentEXP)}xp`).join(' ')}`);
  log(`spawned by class: ${fmt(spawnedBy)}`);
  log(`killed by class:  ${fmt(killsBy)}`);
  log(`home attacks:     ${fmt(homeHitsBy)} (enemies that reached the chibis)`);
  log(`chibi arc:        ${chibiArc} around home forward (spawn ±66.5° + SpreadOut)`);
  if (process.env.DEBUG_ALIVE === '1') {
    for (const e of core.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
      const ee = e as unknown as { m_attackDelay: number; m_isAttacking: boolean; m_canAttack: boolean; m_waitTime: number; m_prefabName: string };
      log(`  alive[${ee.m_prefabName}] home=(${home.position.x.toFixed(1)},${home.position.y.toFixed(1)},${home.position.z.toFixed(1)}) dXZ=${Math.hypot(e.position.x - home.position.x, e.position.z - home.position.z).toFixed(2)} dy=${(e.position.y - home.position.y).toFixed(2)} r=${e.collision.radius.toFixed(2)} h=${e.collision.height.toFixed(2)} delay=${ee.m_attackDelay.toFixed(2)} atk=${ee.m_isAttacking} can=${ee.m_canAttack} wait=${ee.m_waitTime.toFixed(2)}`);
      log(`  alive: ${e.moveType() === EEnemyMoveTypeDef.air ? 'air' : 'gnd'}${e.isBoss ? ' BOSS' : ''} pos=(${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)}) pathD=${e.pathDistance.toFixed(1)} life=${e.getLife().toFixed(0)} spd=${e.speedCur.toFixed(2)} blocked=${e.isBlocked} wave=${e.waveIndex}`);
    }
  }
  log(`replay hash:      ${hash.hex}`);
  return {
    stage: STAGE_NUM,
    outcome: stageCleared ? 'STAGE CLEARED' : gameOver ? 'GAME OVER' : 'TIME CAP',
    ticks,
    hash: hash.hex,
  };
}

// CLI: `tsx src/main/headless-stage1.ts <N>` (also STAGE=N). Not run when imported (tests).
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selectStage(Number(process.argv[2] ?? process.env.STAGE ?? '1'));
  main()
    .then((r) => { if (r.outcome !== 'STAGE CLEARED') process.exitCode = 1; })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
