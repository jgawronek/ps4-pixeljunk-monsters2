// src/main/stageSession.ts
// ONE stage's worth of game: stage view, sim world, views/systems, UI features bound to the sim, input
// handlers, debug hooks. Created by `createStageSession()` and torn down by `session.dispose()`;
// game.ts (the persistent shell: renderer/canvas, audio, save, flow, title/stage-select) can build any
// number of sessions one after another in the same page. See docs/STAGE_SESSION_ARCHITECTURE.md.
//
// This file is the former body of game.ts (the single-stage-per-page-load demo), moved as a closure:
// every module-level `let` of the old game.ts is now a local of createStageSession(). The original
// header notes (documented demo seams, coordinate discipline) are kept below.
//
// Documented demo seams (same status as headless-stage1.ts's header):
//   * enemyDestroyedEvent → currency drops: NO LONGER a seam — Q4.PickupManager is ported in
//     src/view/pickups/PickupDrops.ts (docs/ENEMY_DROPS_ANALYSIS.md).
//   * tower_001 projectile/enemy-detector contracts: Trajectory + sphere
//     stand-ins (raw PPtrs unresolved — DATA GAP).
//   * Player: real tikiman_01 rig (extracted from the globalsettings bundle —
//     Player logic prefab → tikiman_01_pa visual; idle/run anims wired).
//     Movement is view-side auto-walk/WASD writing GameCorePlayer.position
//     directly (4 u/s is a DEMO constant; the real walk speed is view data);
//     dance/attack/damage clips are baked but not yet event-wired.
//   * Projectile visuals: the C# view-follow wiring is upstream of the
//     reconstructed sim; the page syncs simple meshes from sim positions.
//   * Tree meshes are not hidden when converted to a tower (stage-view
//     follow-up); currency is a simple coin/gem mesh.
//
// Coordinate discipline (PORTING_CONVENTIONS): sim stays Unity LH; the view
// mirrors x at the boundary (EnemyStageView/TowerStageView do it internally;
// this file mirrors for its own meshes).

import * as THREE from 'three';

import { Bounds, Quaternion, Vector3 } from '../engine/math';
import { Events } from '../core/Events';
import { EventTime } from '../core/event/CoreEvent';
import { EInventoryType, GameCoreInventory } from '../core/GameCoreInventory';
import { GameCore } from '../core/GameCore';
import { setBoundsProvider } from '../core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../core/GameCoreEnemy';
import { setViewerResolver } from '../core/GameCoreHandle';
import { GameCoreHome, ChibiData, setHomeQueryHeight } from '../core/GameCoreHome';
import { GameCorePickupCurrency } from '../core/GameCorePickupCurrency';
import { GameCorePlayer } from '../core/GameCorePlayer';
import { GameCoreProjectile } from '../core/GameCoreProjectile';
import { GameCoreTower } from '../core/GameCoreTower';
import { GameCoreTree } from '../core/GameCoreTree';
import { EnemyDetectorSphere } from '../core/EnemyDetectorSphere';
import { EnemyDetectorCone } from '../core/EnemyDetectorCone';
import { GameCoreProjectileTrajectory } from '../core/GameCoreProjectileTrajectory';
import { Difficulty, GameCoreWaveManager } from '../core/GameCoreWaveManager';
import { BuildTowerCommand } from '../core/network/BuildTowerCommand';
import { IntroSequenceSkipCommand } from '../core/network/IntroSequenceSkipCommand';
import { setSimPhysics, Q4Layers } from '../core/physics-seam';
import { loadStageWorld, PhysicsWorld } from '../engine/physics/world';
import { nextStage, stageConfigFor, stageFromSearch } from '../data/stageCatalog';
import { buildClearResult } from './stageResult';
import { STAGE_MUSIC } from '../data/stageMusic.generated';
import { difficultyFromSearch, gameUrl, stageSelectUrl } from './stageUrls';
import { DIFFICULTY_LABEL_KEYS } from '../view/save/StageProgress';
import { createQueries } from '../engine/physics/queries';
import { GroundConform } from '../view/stage/GroundConform';
import { PlayerMover } from '../view/player/PlayerMover';
import { RangeIndicator } from '../view/stage/RangeIndicator';
import { TreeView } from '../view/stage/TreeView';
import { applyTreeSurfaceMaps } from '../view/stage/TreeSurfaceMaps';
import { SkyAtmosphere } from '../view/stage/SkyAtmosphere';
import { addStageAmbient } from '../view/stage/StageAmbient';
import { loadStageReflectionProbe, installStageReflectionProbe } from '../view/stage/StageReflectionProbe';
import { WaterPass } from '../view/stage/WaterPass';
import { renderExtrasFor } from '../view/stage/renderExtras';
import { loadGrassView, type GrassView } from '../view/stage/GrassView';
import { loadWeatherView, type WeatherView } from '../view/stage/WeatherView';
import {
  EEnemyClassTypeDef,
  EEnemyStrengthTypeDef,
  ETowerAttackDef,
} from '../core/enums';
import { SimDriver } from './sim-driver';
import { StageSceneView } from '../view/stage/StageSceneView';
import { stageEnvironmentFor, skyEnvTextureUrl } from '../view/stage/StageEnvironment';
import { StageCamera } from '../view/stage/StageCamera';
import { GroundPicker } from '../view/stage/GroundPicker';
import { CharacterLibrary } from '../view/characters/CharacterLibrary';
import { createEnemyViewerFactory, EnemyStageView, setEnemyGroundProbe } from '../view/characters/EnemyStageView';
import { EnemyViewSystem } from '../view/characters/enemyViewSystem';
import { stageEnemyDefs } from '../view/characters/stageEnemyDefs';
import {
  createTowerViewerFactory,
  TowerStageView,
  type TowerViewEffects,
} from '../view/characters/TowerStageView';
import { towerSimSnapshot } from '../view/characters/towerSimSource';
import { burstPrefab, startLoopingPrefab } from '../view/characters/towerEffects';
import { TREE_TOWER_DIRECTION } from '../data/treeTowerDirection';
import { PlayerStageView } from '../view/characters/PlayerStageView';
import { setTowerFlagFactory } from '../view/characters/TowerFlag';
import { MeshParticles, loadMeshParticles, setMeshParticles } from '../view/particles/MeshParticles';
import { prefabRangeRadius, detectorGroundRadius } from '../view/tower/towerRange';
import { BLOCKING_FADE, FadedRenderers, ObjectFade } from '../view/characters/BlockingFade';
import { ChibiStageView, quatYawDeg as quatYawDegOf } from '../view/characters/ChibiStageView';
import type { GroundLinecast, V3 } from '../view/characters/ChibiMotor';
import { HomeChibiSolver, HOME_001_CONFIG } from '../view/characters/HomeChibiSolver';
import { AudioManager, createWebAudioManager } from '../view/audio/AudioManager';
import { ParticleSystem } from '../view/particles/ParticleSystem';
import { parseEmitterFile, type EmitterRecord } from '../view/particles/ExtractedEmitter';
import { PickupView } from '../view/pickups/PickupView';
import { PickupDropManager } from '../view/pickups/PickupDrops';
import { ENEMY_PICKUP_MOVEMENT, STAGE_PICKUP_MANAGERS } from '../data/dropData.generated';
import { CurrencyFlyerLayer } from '../view/ui/CurrencyFlyers';
import { HUD } from '../view/ui/OriginalHud';
import { ProjectileViewerSystem } from '../view/projectiles/ProjectileViewer';
import { ProjectileEffects } from '../view/projectiles/projectileEffects';
import { loadProjectileModels } from '../view/projectiles/projectileAssets';
import { projectileContractForTower } from '../view/projectiles/projectileContracts';
import { PROJECTILE_DATA } from '../view/projectiles/projectileData.generated';
import { FrameTimeHistogram } from '../view/perf/FrameTimeHistogram';
import { fetchJsonCompressed } from '../view/stage/compressedFetch';
import { HudLayout } from '../view/ui/HudLayout';
import { loadUiAssets, type UiAssets } from '../view/ui/UiAssets';
import { GameUiFeature } from '../view/ui/GameUiFeature';
import { BuildMenuFeature } from '../view/ui/BuildMenuFeature';
import { loadStrings, hudStrings, t, waveCallKey, type StringTable } from '../view/ui/UiText';
import { createBrowserAssetCache } from '../view/cache/AssetCache';
import { initPacks, packsHighPriorityLoaded, prefetchLoose } from '../view/pack/bootPacks';
import { applyPreferences } from './preferences';
import { bindLegacyStart, bootTitle, titleDisabled } from './titleBoot';
import { flow as introFlow } from './flow';
import { StageIntroController } from '../view/intro/StageIntroController';
import { IntroCardUi } from '../view/intro/IntroCardUi';
import { loadIntroRig, type StageIntroRig } from '../view/intro/IntroRig';
import { START_CALL_SECONDS, waveStartCall } from '../view/ui/WaveCalls';
import { createBrowserSaveData, type SaveData } from '../view/save/SaveData';
import { GameShell, type ResultScoreData, type ResultsData } from '../view/ui/GameShell';
import { TouchControls } from '../view/input/TouchControls';
import { TowerLevelFeature } from '../view/tower/TowerLevelFeature';
import { addOutline, OUTLINE_SELECTION_WIDTH, type OutlineHandle } from '../view/characters/ToonOutline';
import { applyToonToCharacter, type ToonHandle } from '../view/characters/ToonMaterial';
import { TowerState } from '../core/TowerState';
import { TowerStateBuild } from '../core/TowerStateBuild';
import { GameCorePickup } from '../core/GameCorePickup';
import { headlessWaveManagerView, loadStageMainContract, loadWaveResource } from '../data/waveResource';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  setCurrentStageProvider,
  setEnemyViewerFactory,
  setChibiAvoidanceZoneNotifier,
  setGamePreferencesProvider,
  setTowerDatabaseProvider,
  setProjectileViewerFactory,
  setTowerViewerFactory,
  type HomeViewContract,
  type NatureTreeViewContract,
  type PickupPrefabContract,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { collectObject3Ds, disposeObject3D } from './disposeThree';
import type { AssetCache } from '../view/cache/AssetCache';
import { resetSimGlobals } from './simReset';
import type { StageCatalogEntry } from '../data/stageCatalog';

const f = Math.fround;
const DT_MAX = 0.5; // GameCore.tick clamps internally; we clamp the wall read too
const BUILD_REACH = 2.5; // player→tree distance that triggers the build command
const CHARACTER_DEFS = [
  'kuri_00_001',
  'spider_00_001',
  'giant_00_001',
  'kurukuru_00_001',
  'boss_bero_00',
  'tower_001',
  'tikiman_01',
  'mask_00',
  'carapace_00',
  'chibi_00',
];
// The other buildable towers of the build ring (Hud_TowerRing; DLC 005/010 stay hidden).
// Without the GLB in the library createTowerViewerFactory falls back to a model-less
// data record, i.e. the sim builds the tower and charges the cost but nothing appears.
// Not needed to START: loaded in the background right behind the critical set (pack
// `chars-towers`, low priority) — add `?eagertowers` to block Start on them like before.
const CHARACTER_LATE_DEFS = [
  'tower_002', 'tower_003', 'tower_004', 'tower_006', 'tower_007', 'tower_008', 'tower_009', 'tower_011', 'tower_012',
  // tower level flags (TowerUpgrade.flagPrefab levels 2..5, mounted on `flag_pos`)
  'flag_001_2', 'flag_001_3', 'flag_001_4', 'flag_001_5',
];

type Json = Record<string, unknown>;

interface SceneNode {
  i: number;
  name: string;
  parent: number;
  activeSelf: boolean;
  pos: [number, number, number];
  rot: [number, number, number, number];
  scale: [number, number, number];
}
interface SceneDoc {
  nodes: SceneNode[];
}

/** Same parent-chain TRS compose as headless-stage1.ts (view-layer copy). */
function worldTransform(nodes: SceneNode[], node: SceneNode): { pos: Vector3; rot: Quaternion } {
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
    const scaled = new Vector3(n.pos[0] * scale.x, n.pos[1] * scale.y, n.pos[2] * scale.z);
    pos = pos.add(rot.multiplyVector(scaled));
    rot = rot.multiply(new Quaternion(n.rot[0], n.rot[1], n.rot[2], n.rot[3]));
    scale = new Vector3(scale.x * n.scale[0], scale.y * n.scale[1], scale.z * n.scale[2]);
  }
  return { pos, rot };
}

/** tower_001 (arrow) from structures_TowerBase.json — same record shape as
 *  the headless milestone; the fire point here comes from the GLB muzzle
 *  nodes via TowerStageView (no world-space wrapper needed). */
function tower001Contract(raw: Json, getTowerLevel: () => TowerLevelFeature | null): TowerBaseContract {
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
    cautionRotateAngleMin: (raw.cautionRotateAngleMin as number | undefined) ?? 10,
    playerDetectionRange: raw.playerDetectionRange as number,
    firePointNames: raw.firePointNames as string[],
    // Real per-tower projectile prefab (props bundle; docs/PROJECTILE_ANALYSIS.md) — the
    // Trajectory stand-in below is only the fallback for an unknown tower name.
    projectile: projectileContractForTower(String(raw.__gameObject)) ?? {
      // DATA GAP: projectile PPtr unresolved → Trajectory stand-in.
      getFireDirection: (from, to) => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }),
      getGameCoreType: () => GameCoreProjectileTrajectory,
      traceTarget: true,
      maxLifeDuration: 5,
      getComponentInChildrenRenderer: () => ({
        bounds: { size: { x: 0.3, y: 0.3, z: 0.3 }, extents: { x: 0.15, y: 0.15, z: 0.15 } },
      }),
    },
    // Q4.TowerUpgradeSettingGeneric table (docs/TOWER_LEVEL_UPGRADE_ANALYSIS.md).
    getComponentTowerUpgradeSetting: () => getTowerLevel()?.settingFor(String(raw.__gameObject)) ?? null,
    getComponentEnemyDetectorView: () => ({
      // Real EnemyDetectorViewCone of the tower prefab (structures bundle); sphere stand-in only for unknown towers.
      createGameCoreDetector: () => {
        const cone = PROJECTILE_DATA.towers[String(raw.__gameObject)]?.detector;
        if (cone) {
          return new EnemyDetectorCone(
            new Vector3(cone.offset[0], cone.offset[1], cone.offset[2]),
            cone.upperRadius, cone.lowerRadius, cone.height, cone.affectRangeRate,
          );
        }
        return new EnemyDetectorSphere(
          new Vector3(0, 1, 0),
          f(f(raw.attackRangeInner as number) + f(raw.attackSpread as number)),
          1,
        );
      },
    }),
    findDeepChildY: () => 1.5,
    getFirePointByRemainingMag: () => ({ x: 0, y: 1.5, z: 0 }), // overridden by TowerStageView
  };
}

/** NatureTree viewer. towerDirection is the SERIALIZED per-species value
 *  (TREE_TOWER_DIRECTION) — it seeds the tower's body/fort direction and thus
 *  the tower's facing (Q4.TowerBase.Start: LookRotation(bodyDirection)).
 *  TS ADAPTATION: tree_002 serializes (0,0,0); a zero direction would leave
 *  the sim's fort direction degenerate, so it keeps the neutral +Z. */
function treeViewer(pos: Vector3, species: 'tree_001' | 'tree_002' = 'tree_001'): NatureTreeViewContract {
  const td = TREE_TOWER_DIRECTION[species];
  const zero = td.x === 0 && td.y === 0 && td.z === 0;
  return {
    playerDetectionRange: 2,
    towerDirection: zero ? { x: 0, y: 0, z: 1 } : { ...td },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: pos.x, y: pos.y, z: pos.z } },
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

const SFX_NAMES = [
  'sfx/sfx_item_coin', 'sfx/sfx_item_gem', 'sfx/sfx_menu_countdownbase', 'sfx/sfx_menu_countdownfinal',
  'sfx/sfx_tower_buildcomplete', 'sfx/sfx_tower_buildtower', 'sfx/sfx_tower_rotate',
  'sfx/sfx_tower_levelup', 'sfx/sfx_tower_levelcomplete',
  'sfx/sfx_tiki_dancejingle',
  'sfx/sfx_towerarrow_shoot', 'sfx/sfx_towerarrow_hit',
  'sfx/sfx_stage_wavestart', 'sfx/sfx_stage_firstwave',
  'sfx/sfx_stage_waveclear', 'sfx/sfx_stage_gameclearperfect',
  'sfx/sfx_stage_gameover', 'sfx/sfx_chibi_soulfading',
  // StageResultMenuController (GlobalSounds ScoreCountUp / NewRecord / GameClearRainbow)
  'sfx/sfx_menu_scorecount', 'sfx/sfx_menu_newscore', 'sfx/sfx_stage_rainbowaquired',
  // tower level/upgrade (GlobalSounds TowerSell/TowerFlagUp/ring menu)
  'sfx/sfx_tower_dismantletower', 'sfx/sfx_tower_flagup',
  'sfx/sfx_ringmenu_openringmenu', 'sfx/sfx_ringmenu_select', 'sfx/sfx_ringmenu_confirm',
  'sfx/sfx_ringmenu_cancel', 'sfx/sfx_ringmenu_closeringmenu',
  'sfx/sfx_ringmenu_accessdenied', 'sfx/sfx_ringmenu_notenoughresources',
];

export interface GameWorld {
  driver: SimDriver;
  core: GameCore;
  player: GameCorePlayer;
  home: GameCoreHome;
  inventory: GameCoreInventory;
  waveManager: GameCoreWaveManager;
  trees: GameCoreTree[];
  towerPrefab: TowerBaseContract;
  waveCount: number;
}

export type ExitKind = 'stageSelect' | 'next' | 'retry';

/** What the persistent shell (game.ts) offers a session. Everything a session may NOT own goes through here. */
export interface ShellServices {
  renderer: THREE.WebGLRenderer;
  /** #app (canvas parent). */
  app: HTMLElement;
  save: SaveData | null;
  assetCache: AssetCache;
  /** Shell-wide, loaded once (UiAssets are shared textures/fonts; strings = Q4.TextDatabase). */
  uiAssets: Promise<UiAssets>;
  strings: Promise<StringTable>;
  /** The shared AudioManager (null until the first user gesture created it). */
  getAudio(): AudioManager | null;
  /** Create + unlock the shared AudioManager; call from a gesture handler. */
  ensureAudio(): AudioManager;
  flash(text: string, seconds?: number): void;
  /** Loading-screen progress (pct 0..100 or null = unchanged). */
  progress(pct: number | null, text: string): void;
  /** Dev panels (#hud / #wave / #perf). */
  panels: { hud: HTMLElement; wave: HTMLElement; perf: HTMLElement };
  /** Result-screen / pause-menu exits (shell owns the flow transition + session lifecycle). */
  exit(kind: ExitKind): void;
  /** Terminal sim outcome (cleared/over): shell moves the flow to `results`. */
  outcome(kind: 'cleared' | 'over'): void;
}

export interface StageSessionOptions {
  stage: StageCatalogEntry;
  difficulty: 0 | 1 | 2;
}

/** Per-session resource counters (disposal audit). */
export interface SessionCounters {
  particlesAlive: number;
  enemyViews: number;
  towerViews: number;
  /** DOM children currently owned by this session under body (approx: gameUi/results/intro/touch/etc). */
  overlays: number;
}

export interface StageSession {
  readonly stageId: string;
  readonly stage: number;
  readonly difficulty: number;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly world: GameWorld | null;
  /** `window.__pjm2` targets this object (probe hooks, unchanged API). */
  readonly debug: Record<string, unknown>;
  /** The START path (old click handler): wires outcome/audio/particles/UI and begins the intro. */
  start(): void;
  /** One animation frame: sim step, view sync, render. */
  frame(nowMs: number): void;
  resize(aspect: number): void;
  /** Free everything this session created; safe to call twice. */
  dispose(): void;
  counters(): SessionCounters;
}

export async function createStageSession(sh: ShellServices, opts: StageSessionOptions): Promise<StageSession> {
  // A new stage must start from a pristine sim-global state (Events listeners, handle ids, RNG, registries).
  resetSimGlobals();
  const STAGE_CFG = stageConfigFor(opts.stage);
  /** `?diff=0|1|2` (Fun|Tricky|Mayhem) / stage-select pick. */
  const GAME_DIFFICULTY = opts.difficulty;
  const STAGE_BUNDLE_URL = STAGE_CFG.bundleUrl;
  /** Per-stage environment (ambient SH, post grade profile, clear colour, camera yaw/fov, shadow params): src/view/stage/StageEnvironment.ts. */
  const STAGE_ENV = stageEnvironmentFor(STAGE_CFG.entry.scene);
  const search = window.location.search;
  /** Stage intro (docs/STAGE_INTRO_ANALYSIS.md): authored camera cuts + chibi runners of THIS stage scene.
   *  `?nointro` (or a stage without an extracted rig) keeps the legacy immediate IntroSequenceSkipCommand. */
  const NO_INTRO = new URLSearchParams(search).has('nointro');
  const introRigLoad: Promise<StageIntroRig | null> = NO_INTRO ? Promise.resolve(null) : loadIntroRig(STAGE_CFG.entry.scene);
  introRigLoad.catch(() => { /* handled where awaited */ });
  let introController: StageIntroController | null = null;
  let introChibiRig: (() => ReturnType<CharacterLibrary['instantiate']> | null) | null = null;
  let disposed = false;
  const A = (): AudioManager | null => sh.getAudio();
  const save = sh.save;
  const flash = sh.flash;
  const renderer = sh.renderer;
  const app = sh.app;
  const hud = sh.panels.hud;
  const waveHud = sh.panels.wave;
  const perfHud = sh.panels.perf;
  /** Per-session listener scope: everything registered on window/document/canvas goes through this. */
  const ac = new AbortController();
  let uiStrings: StringTable = {};
  let hudLayout: HudLayout | null = null;
  /** Library kept for dispose (templates are freed with it). */
  let libraryRef: CharacterLibrary | null = null;
  const ownedTemplates: THREE.Object3D[] = [];
  /** One DOM container for every stage-bound overlay (HUD, calls, build ring, tower ring, intro card): dispose = remove(). */
  const sessionUi = document.createElement('div');
  sessionUi.dataset.pjm2 = 'stage-session-ui';
  document.body.appendChild(sessionUi);
  let introCardRef: IntroCardUi | null = null;
  const scene = new THREE.Scene();
  /** Grab + depth pipeline for the faithful Nature/Water shader. */
  const waterPass = new WaterPass(renderer, scene, STAGE_ENV.clearHex, 4,
    new URLSearchParams(window.location.search).has('nograde') ? false : STAGE_ENV.grade, // ?nograde = legacy ACES (A/B probes)
    renderExtrasFor(STAGE_ENV, new URLSearchParams(window.location.search)));
  // Ambient = the stage's baked RenderSettings SH probe (StageAmbient.ts); the old invented hemisphere light is gone.
  // Tuning aid (shadow fill vs the original): ?ambient=<multiplier> scales the ambient SH probe (1 = the extracted value).
  const ambientScale = ((): number => { try { const q = Number(new URLSearchParams(location.search).get('ambient')); return q > 0 ? q : 1; } catch { return 1; } })();
  const stageAmbient = addStageAmbient(scene, STAGE_ENV.ambient.intensity * ambientScale, STAGE_ENV.ambient.sh);
  let stageProbeTexture: THREE.Texture | null = null;
  (window as unknown as Record<string, unknown>).__amb = stageAmbient;

  // Faithful sky/atmosphere (see SkyAtmosphere.ts): the original's 12 cameras
  // all clear to flat pastel #81b5d4 (SolidColor) — the sky_test_003 cubemap
  // feeds AMBIENT + reflections only, it is NOT the visible background. The
  // stage post profile grades with ACES + 0.6EV exposure + warm tint. apply()
  // (in boot) builds the PMREM environment from the cubemap face + sets ACES;
  // we then restore the faithful flat clear color as the visible background.
  const sky = new SkyAtmosphere(renderer, scene, {
    ambientIntensity: 1, postGraded: waterPass.gradeEnabled, skyTextureUrl: skyEnvTextureUrl(STAGE_ENV, STAGE_CFG.sceneBaseUrl),
  });

  // WASD = player; edge-pan off (PJM2 camera follows the tikiman, no edge pan).
  const stageCamera = new StageCamera({
    keyboardPan: false, edgeMargin: 0, fov: STAGE_ENV.camera.fov, pitchDeg: STAGE_ENV.camera.pitchDeg, yawDeg: STAGE_ENV.camera.yawDeg,
  });
  stageCamera.resize(window.innerWidth / window.innerHeight);
  stageCamera.attach(renderer.domElement);

  const picker = new GroundPicker();
  // Build-range ring (Q4.StructureRangeEffect — scale-sized mesh ring; detect
  // preview color orange per structures_EnemyDetectorViewCone.json). Shown when
  // a tree is targeted, hidden on build-complete/cancel.
  const rangeIndicator = new RangeIndicator(scene, {
    color: new THREE.Color().setRGB(1, 0.5, 0.25, THREE.SRGBColorSpace),
    opacity: 0.5,
  });
  function showTreeRange(tree: GameCoreTree): void {
    if (world === null) return;
    rangeIndicator.show(tree.position, prefabRangeRadius(world.towerPrefab as never)); // the detector's real attack radius
  }
  const characterRoot = new THREE.Group();
  characterRoot.name = 'characters';
  scene.add(characterRoot);

  // NEAR-fidelity effects pool (hand-tuned, not extracted — see
  // src/view/particles/ParticleSystem.ts header).
  const particles = new ParticleSystem(2048);
  /** Mesh-mode particle emitters (rock chunks, gears, leaves): lit 3D meshes. Loaded with the emitters; null = billboard fallback. */
  let meshParticles: MeshParticles | null = null;
  scene.add(particles.points);
  // Real Unity ParticleSystem settings extracted from the user's own bundles
  // (tools/assets/extract_particles.py → public/assets/particles/particles.json).
  // Empty until loaded; wireParticles falls back to hand-tuned beats per event.
  const emitters = new Map<string, EmitterRecord>();
  let world: GameWorld | null = null;
  let started = false;
  /** Original-art UI (HUD / wave calls / pause+results skin) and the tower build ring
   *  (docs/GAME_UI_ANALYSIS.md). Both created in boot() once the UI assets are loaded. */
  let gameUi: GameUiFeature | null = null;
  let buildMenu: BuildMenuFeature | null = null;
  let uiAssets: UiAssets | null = null;
  let enemyViewSystem: EnemyViewSystem | null = null;
  /** TowerDatabase: every shipping tower prefab contract by name (public/assets/data/towers.json). */
  const towerContracts = new Map<string, TowerBaseContract>();
  const towerMeta = new Map<string, { lockable: boolean; dlcLock: number }>();
  /** Tower level / upgrade feature (docs/TOWER_LEVEL_UPGRADE_ANALYSIS.md). */
  let towerLevel: TowerLevelFeature | null = null;
  let stageViewRef: StageSceneView | null = null;
  let playerMesh: THREE.Object3D | null = null;
  let playerView: PlayerStageView | null = null;
  let chibiView: ChibiStageView | null = null;
  let physicsLoaded = false;
  let physicsWorld: PhysicsWorld | null = null;
  /** Physics.Linecast(a, b, TerrainMask) in Unity space -> hit y (what Q4.Chibi.ProjectToGround casts). Null until physics loads. */
  const chibiLinecast: GroundLinecast = (a, b) => {
    if (physicsWorld === null) return null;
    const hit = createQueries(physicsWorld).linecast(a.x, a.y, a.z, b.x, b.y, b.z, physicsWorld.terrainMask);
    return hit === null ? null : hit.point[1];
  };
  let playerMover: PlayerMover | null = null;
  let groundConform: GroundConform | null = null;
  /** Unity-space horizontal move intent this frame (for anim + camera look-ahead). */
  const playerMoveDir = new THREE.Vector3(); // three-space (mirrored) for look-ahead

  interface TrackedEnemy {
    view: EnemyStageView;
    enemy: GameCoreEnemy;
    lastPos: THREE.Vector3;
    deadUntil: number | null;
  }
  const enemyViews = new Map<number, TrackedEnemy>();
  const towerViews = new Map<number, { view: TowerStageView; tower: GameCoreTower; fade?: { f: ObjectFade; r: FadedRenderers } }>();
  /** Range ring of the tower the player stands at (Structure.SetSelected -> StructureRangeEffect; detectColor yellow). */
  const selectedRange = new RangeIndicator(scene, { color: new THREE.Color().setRGB(1, 0.9216, 0.0157, THREE.SRGBColorSpace), opacity: 0.5 });
  let selectedRangeKey = '';
  let selOutline: { h: OutlineHandle; w: number } | null = null;
  let selOutlineId = -1;
  // Real coin/gem GLBs (extracted from props bundle); null until boot loads them.
  let pickupView: PickupView | null = null;
  let pickupDrops: PickupDropManager | null = null;
  let currencyFlyers: CurrencyFlyerLayer | null = null;
  let treeView: TreeView | null = null;
  /** Q4.GrassInstanceRenderer port (stages 1-6; ?nograss disables): src/view/stage/GrassView.ts. */
  let grassView: GrassView | null = null;
  /** Q4.StageWeatherPlayer port (stages 4-6 sand cloud, 11 snow; ?noweather disables): src/view/stage/WeatherView.ts. */
  let weatherView: WeatherView | null = null;
  const weatherTarget = new THREE.Vector3();

  // Q4.Projectile* views (cannonball / mortar shell / missile models, invisible hitscan
  // arrow/anti-air, muzzle+hit effects, sounds): src/view/projectiles/ProjectileViewer.ts,
  // docs/PROJECTILE_ANALYSIS.md. Created after the models/emitters/audio exist.
  let projectileViewer: ProjectileViewerSystem | null = null;
  let projectileParticles: ParticleSystem | null = null;

  const toThree = (p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 =>
    out.set(-p.x, p.y, p.z);

  const scratch = new THREE.Vector3();

  // Character rims (NEAR fidelity — see ToonOutline.ts header; the decompiled
  // outline system is the yellow SELECTION highlight, not the permanent rim).
  const outlineHandles = new Map<THREE.Object3D, OutlineHandle>();
  /** DISABLED: the original has NO permanent character outline (the Q4/Effect/*Outline shaders default to width 0 and only draw
   *  the yellow selection highlight; see docs/ORIGINAL_CHARACTER_RENDERING_FACTS.md). Kept as a no-op seam for a selection pass. */
  const CHARACTER_RIM = false;
  function outline(root: THREE.Object3D): void {
    if (!CHARACTER_RIM) return;
    if (!outlineHandles.has(root)) outlineHandles.set(root, addOutline(root));
  }
  function dropOutline(root: THREE.Object3D): void {
    outlineHandles.get(root)?.dispose();
    outlineHandles.delete(root);
  }

  // Cel shading (NEAR — original character shader params match Unity Standard;
  // band/tint/rim are style-matched defaults, see ToonMaterial.ts header). Clones
  // materials so shared templates stay intact; dispose restores them.
  const toonHandles = new Map<THREE.Object3D, ToonHandle>();
  /** DISABLED: no toon/cel shader exists in the original; characters are plain Unity Standard (PBR) in a Linear/Forward/HDR pipeline. */
  const CHARACTER_CEL = false;
  function toon(root: THREE.Object3D): void {
    if (!CHARACTER_CEL) return;
    if (!toonHandles.has(root)) toonHandles.set(root, applyToonToCharacter(root));
  }
  function dropToon(root: THREE.Object3D): void {
    toonHandles.get(root)?.dispose();
    toonHandles.delete(root);
  }
  /** Distance falloff for tower loop/one-shot sounds (the original plays 3D
   *  AudioSources whose rolloff comes from MonstersAudio clip settings — not
   *  recovered; this simple falloff around the camera target is a view adaptation). */
  function towerSfxVolume(unityPos: { x: number; y: number; z: number }): number {
    const t = stageCamera.target;
    const d = Math.hypot(-unityPos.x - t.x, unityPos.z - t.z);
    return Math.min(1, Math.max(0.1, 1 - d / 70));
  }

  /** Audio/particle sinks for TowerStageView (Q4.TowerBase.Update's
   *  Instantiate(towerBuildEffect) / PlaySFXMonitored / PlaySFX calls). */
  const towerEffects: TowerViewEffects = {
    startBuildEffect: (prefab, pos) =>
      startLoopingPrefab(particles, emitters, prefab, toThree(pos, new THREE.Vector3())),
    startLoopSfx: (clip, pos) => A()?.startLoop(`sfx/${clip}`, { volume: towerSfxVolume(pos) }) ?? null,
    playSfx: (clip, pos) => { void A()?.play(`sfx/${clip}`, { volume: towerSfxVolume(pos) }); },
    burstEffect: (prefab, pos) => { burstPrefab(particles, emitters, prefab, toThree(pos, new THREE.Vector3())); },
    cameraRight: () => {
      const e = stageCamera.camera.matrixWorld.elements; // column 0 = world right (three space)
      return { x: e[0], y: e[1], z: e[2] };
    },
  };

  function syncViews(dt: number, nowSec: number): void {
    const w = world!;
    // Enemies (create-on-spawn via the sim's own registerUnityObject).
    for (const enemy of w.core.allObjects<GameCoreEnemy>(GameCoreEnemy)) {
      const id = enemy.handle.m_handle;
      if (!enemyViews.has(id)) {
        const view = getRegisteredUnityObject(id);
        if (view instanceof EnemyStageView) {
          outline(view.root); toon(view.root);
          enemyViews.set(id, {
            view,
            enemy,
            lastPos: toThree(enemy.position, new THREE.Vector3()),
            deadUntil: null,
          });
        }
      }
    }
    for (const [id, tracked] of enemyViews) {
      const e = tracked.enemy;
      if (e.isDestroyed()) {
        if (tracked.deadUntil === null) tracked.deadUntil = nowSec + 1.8; // death chain length (legacy views)
        // Controller-driven views live for EnemyBase.DestroyDelay (StateDead @007fce90).
        if (tracked.view.base !== null ? tracked.view.base.expired : nowSec >= tracked.deadUntil) {
          dropOutline(tracked.view.root); dropToon(tracked.view.root); freeSkeletons(tracked.view.root);
          tracked.view.dispose();
          enemyViews.delete(id);
          continue;
        }
      }
      const pos = toThree(e.position, scratch);
      tracked.view.bindSimSource(() => ({
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
        moveVector: { x: -(pos.x - tracked.lastPos.x), y: 0, z: pos.z - tracked.lastPos.z },
        m_life: e.isDestroyed() ? 0 : 1,
        enemyMoveType: e.enemyMoveType as number,
        previousPosition: { x: -tracked.lastPos.x, y: tracked.lastPos.y, z: tracked.lastPos.z },
        speedCur: e.speedCur,
        // Q4.EnemyBase core reads (BossUpdate / LateUpdate / `core == null` attack+dead+drown choreography)
        alive: !e.isDestroyed(),
        groundOffsetY: e.groundOffsetY,
        slowMode: e.isSlowMode,
        damagedMode: e.isDamagedMode,
        isBalloon: e.isBalloon,
      }));
      tracked.view.update(dt);
      tracked.lastPos.copy(pos);
    }

    enemyViewSystem?.update(dt, nowSec);

    // Towers (Q4.TowerBase / TowerAnimator view port — TowerStageView header).
    for (const tower of w.core.allObjects<GameCoreTower>(GameCoreTower)) {
      const id = tower.handle.m_handle;
      if (!towerViews.has(id)) {
        const view = getRegisteredUnityObject(id);
        if (view instanceof TowerStageView) {
          view.bindSim(() => towerSimSnapshot(tower));
          view.bindEffects(towerEffects);
          outline(view.root); toon(view.root);
          towerViews.set(id, { view, tower });
        }
      }
    }
    // BlockingTreeHider (top-down camera): the tower the player is DANCING on fades to topDownFadeAlpha so the player stays visible.
    for (const tracked of towerViews.values()) {
      const dancing = towerLevel?.danceTarget === tracked.tower;
      if (!dancing && tracked.fade === undefined) continue;
      tracked.fade ??= { f: new ObjectFade(), r: new FadedRenderers(tracked.view.root) };
      if (dancing || tracked.fade.f.active) {
        tracked.fade.f.update(dt, dancing, dancing);
        tracked.fade.r.setAlpha(tracked.fade.f.alpha(BLOCKING_FADE.topDownFadeAlpha));
      }
    }
    for (const [id, tracked] of towerViews) {
      // Sold/destroyed: OnSell scrap effect + ShrinkAndDestroy, then drop the view.
      if (tracked.tower.isDestroyed()) tracked.view.beginSell();
      tracked.view.update(dt);
      if (tracked.view.finished) {
        dropOutline(tracked.view.root); dropToon(tracked.view.root); freeSkeletons(tracked.view.root);
        tracked.view.dispose();
        towerViews.delete(id);
      }
    }

    // Selection outline (Q4.TowerBase.SetSelected -> ObjectOutlineRenderer.AddOutlineMesh): the tower the player stands at gets
    // the Q4/Effect/Skinned*Outline passes (HOLLOW, OUTLINE, BLOCKED OUTLINE) in the player's colour (default yellow), width
    // ramped 0 -> k_destWidth 0.05 by Q4.OutlineFade; removed (width back to 0) on deselect. Ramp rate = view constant (the
    // OutlineFade rate rodata is not recoverable) and the pass alpha is not decoded: NEAR.
    {
      const selected = towerLevel?.interaction.selected ?? null;
      const selId = selected !== null && !selected.isDestroyed() ? selected.handle.m_handle : -1;
      if (selId !== selOutlineId) {
        selOutline?.h.dispose();
        selOutline = null;
        selOutlineId = selId;
        const tv = towerViews.get(selId);
        if (tv !== undefined) selOutline = { h: addOutline(tv.view.root, { color: 0xffe600, width: 0 }), w: 0 };
      }
      // shooting radius of the selected tower (the detection volume at ground level, scaled by the level upgrades)
      if (selected !== null && !selected.isDestroyed() && selected.enemyDetector !== null) {
        const r = detectorGroundRadius(selected.enemyDetector, 'detect');
        const key = `${selId}:${r?.toFixed(2)}`;
        if (r !== null && key !== selectedRangeKey) { selectedRangeKey = key; selectedRange.show(selected.position, r); }
      } else if (selectedRangeKey !== '') { selectedRangeKey = ''; selectedRange.hide(); }
      if (selOutline !== null && selOutline.w < OUTLINE_SELECTION_WIDTH) {
        selOutline.w = Math.min(OUTLINE_SELECTION_WIDTH, selOutline.w + dt * 0.3);
        selOutline.h.setWidth(selOutline.w);
      }
    }

    // Currency drops: real coin/gem GLBs, pooled + spun by PickupView (sim owns
    // the bounce/suck-to-player motion; view follows position — see PickupView.ts).
    pickupView?.sync(w.core.allObjects<GameCorePickupCurrency>(GameCorePickupCurrency), dt, nowSec);
    treeView?.update(dt);
    grassView?.update(dt, stageCamera.camera);
    weatherView?.update(dt, toThree(w.player.position, weatherTarget));
    // Tree contact shake: Structure's sphere trigger (r = 2) → NatureTree.OnPlayerEnter.
    treeView?.trackPlayers([w.player.position]);

    // Projectiles: Q4.Projectile* view Update (Trajectory view-blend/aim, Instant lifetime).
    projectileViewer?.update(dt, w.core.allObjects<GameCoreProjectile>(GameCoreProjectile));

    // Player: real rig (position/facing/anim) or capsule fallback. Ground-conform
    // the view y onto the terrain (the sim mover never sets y; enemies/chibis
    // already conform sim-side via the physics seam — see GroundConform.ts).
    const p = w.player;
    // PlayerMover (CharacterController) owns the player's y; GroundConform only without it.
    const groundY = playerMover !== null ? p.position.y : (groundConform?.sample(p.position.x, p.position.z, dt, 'player') ?? p.position.y);
    if (playerView !== null) {
      playerView.setPosition({ x: p.position.x, y: groundY, z: p.position.z });
      const moving = playerMoveUnity.x !== 0 || playerMoveUnity.z !== 0;
      playerView.setMoving(moving);
      if (moving) playerView.face(playerMoveUnity);
      playerView.update(dt);
      playerMoveDir.set(-playerMoveUnity.x, 0, playerMoveUnity.z); // mirror → three
    } else if (playerMesh !== null) {
      toThree(p.position, playerMesh.position);
      playerMesh.position.y = groundY;
    }

    // Chibis: ChibiMotor (Q4.Chibi.Update) + chibi_ctrl Animator; deaths/clear are event-driven.
    chibiView?.update(dt);
    particles?.update(dt);
    meshParticles?.update(dt);
    projectileParticles?.update(dt);
    rangeIndicator.update(dt);
    selectedRange.update(dt);
  }
  const moveKeys = new Set<string>();
  /** Press order of the held keys (newest = highest). Opposite keys resolve to the NEWEST press, so a key whose keyup was lost
   *  (macOS swallows keyups while Cmd is held, alt-tab, browser shortcuts) can no longer cancel the opposite direction forever. */
  const moveKeyOrder = new Map<string, number>();
  let moveKeySeq = 0;
  const clearMoveKeys = (): void => { moveKeys.clear(); moveKeyOrder.clear(); };
  /** -1 / 0 / +1 along one axis from two key groups; the most recently pressed key wins when both are held. */
  const keyAxis = (neg: readonly string[], pos: readonly string[]): number => {
    let n = -1, q = -1;
    for (const k of neg) if (moveKeys.has(k)) n = Math.max(n, moveKeyOrder.get(k) ?? 0);
    for (const k of pos) if (moveKeys.has(k)) q = Math.max(q, moveKeyOrder.get(k) ?? 0);
    return q === n ? 0 : q > n ? 1 : -1;
  };
  window.addEventListener('keydown', (e) => {
    // Tower interaction (E/Enter = interact, ring menu keys) consumes the key first.
    if (started && !e.repeat && !(shell?.paused ?? false) && towerLevel?.onKey(e.code)) {
      e.preventDefault();
      return;
    }
    if (!moveKeys.has(e.code)) moveKeyOrder.set(e.code, ++moveKeySeq);
    moveKeys.add(e.code);
    }, { signal: ac.signal });
  window.addEventListener('keyup', (e) => {
    moveKeys.delete(e.code);
    moveKeyOrder.delete(e.code);
    // macOS delivers no keyup for other keys while Cmd/Ctrl/Alt is held: releasing a modifier drops everything held.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight' || e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'ControlLeft' || e.code === 'ControlRight') clearMoveKeys();
  }, { signal: ac.signal });
  // Lost focus / hidden tab / context menu: keyups never arrive -> nothing may stay pressed.
  window.addEventListener('blur', clearMoveKeys, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearMoveKeys(); }, { signal: ac.signal });
  window.addEventListener('contextmenu', clearMoveKeys, { signal: ac.signal });

  let walkTarget: { pos: Vector3; tree: GameCoreTree | null } | null = null;
  let buildQueuedFor: number = -1;
  /** Unity-space horizontal move direction this frame (zero = standing). */
  const playerMoveUnity = { x: 0, z: 0 };
  /** DEBUG (probe): counts frames the WASD branch ran. */
  let wasdFrames = 0;
  /** DEBUG (probe): counts tickPlayerMovement invocations / frame() iterations. */
  let tickCalls = 0;
  let frameCalls = 0;

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!started || world === null || (introController?.active ?? false)) return; // intro: clicks only confirm the stage card
    const rect = renderer.domElement.getBoundingClientRect();
    const hit = picker.pickUnity(e.clientX, e.clientY, rect, stageCamera.camera);
    if (hit === null) return;
    const target = new Vector3(hit.x, hit.y, hit.z);
    // Nearest valid tree to the click — clicking a tree = walk there & build.
    let nearest: GameCoreTree | null = null;
    let nearestD = Infinity;
    for (const t of world.trees) {
      if (!t.isTreeValid()) continue;
      const d = Vector3.Distance(t.position, target);
      if (d < nearestD) {
        nearestD = d;
        nearest = t;
      }
    }
    if (nearest !== null && nearestD < 2.0) {
      walkTarget = { pos: nearest.position.clone(), tree: nearest };
      buildQueuedFor = -1;
      showTreeRange(nearest);
    } else {
      walkTarget = { pos: target, tree: null };
      rangeIndicator.hide();
      }
      }, { signal: ac.signal });

  /** Movement intent for this frame (Unity-space, |v| <= 1) consumed by stepPlayerMover. */
  const moverIntent = { x: 0, z: 0 };
  let walkStuckTime = 0;

  /**
   * Advance the original-faithful locomotion (PlayerMover = PlayerMotor +
   * CharacterController on the static stage colliders) with this frame's intent
   * and publish the result to the sim's GameCorePlayer.position.
   */
  function stepPlayerMover(dt: number): void {
    const p = world!.player;
    const m = playerMover;
    if (m === null) {
      // physics failed to load: unconstrained fallback at the original walk speed
      p.position = p.position.add(new Vector3(f(moverIntent.x * 3.5343 * dt), 0, f(moverIntent.z * 3.5343 * dt)));
      return;
    }
    // external teleports (debug hooks) rewrite p.position — resync the controller
    if (Math.abs(p.position.x - m.x) > 0.02 || Math.abs(p.position.z - m.z) > 0.02) {
      m.teleportToGround(p.position.x, p.position.z);
    }
    m.update(dt, moverIntent, { run: moveKeys.has('ShiftLeft') || moveKeys.has('ShiftRight') });
    p.position = new Vector3(f(m.x), f(m.y), f(m.z));
    if (m.mode !== 'normal') { playerMoveUnity.x = 0; playerMoveUnity.z = 0; walkTarget = null; }
    // click-to-walk that cannot make progress (wall/river bank) gives up
    const speed = Math.hypot(m.vx, m.vz);
    if (walkTarget !== null && Math.hypot(moverIntent.x, moverIntent.z) > 0.3 && speed < 0.4) {
      walkStuckTime += dt;
      if (walkStuckTime > 0.6) { walkTarget = null; walkStuckTime = 0; }
    } else {
      walkStuckTime = 0;
    }
  }

  function tickPlayerMovement(dt: number): void {
    moverIntent.x = 0;
    moverIntent.z = 0;
    tickPlayerIntent(dt);
    stepPlayerMover(dt);
  }

  function tickPlayerIntent(dt: number): void {
    tickCalls++;
    const w = world!;
    const p = w.player;
    playerMoveUnity.x = 0;
    playerMoveUnity.z = 0;
    // Ring menu open = player busy (TowerBuildRingController.OnShow BusyCommand): no walking.
    if (towerLevel?.ringOpen || buildMenu?.isOpen) { walkTarget = null; return; }
    // Stage intro (card + intro cameras): the player does not walk until the camera hand-off.
    if (introController?.active ?? false) { walkTarget = null; return; }

    // WASD / arrows + touch joystick, mapped CAMERA-RELATIVE so input always
    // matches the view orientation (stageCamera.mapInput handles the yaw basis
    // + three→unity mirror; see screenInputToUnity). ix = screen right+,
    // iz = screen up/into-screen+.
    let ix = 0, iz = 0;
    ix += keyAxis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    iz += keyAxis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    ix += touchMove.x;
    iz += touchMove.y;
    if (ix !== 0 || iz !== 0) {
      walkTarget = null; // manual input cancels auto-walk
      wasdFrames++;
      const dir = stageCamera.mapInput(ix, iz);
      const ux = dir.x, uz = dir.z;
      playerMoveUnity.x = ux;
      playerMoveUnity.z = uz;
      moverIntent.x = ux;
      moverIntent.z = uz;
      return;
    }

    if (walkTarget === null) return;
    const delta = walkTarget.pos.sub(p.position);
    delta.y = 0;
    const dist = delta.magnitude;
    if (walkTarget.tree !== null && dist <= BUILD_REACH) {
      const tree = walkTarget.tree;
      walkTarget = null;
      if (!tree.isTreeValid()) {
        flash('Tree occupied');
        return;
      }
      if (buildQueuedFor !== tree.handle.m_handle) {
        buildQueuedFor = tree.handle.m_handle;
        // Arrived at the tree: open the original build ring (TowerBuildRingController.Show);
        // the tower is chosen there and BuildTowerCommand is issued on confirm.
        if (buildMenu !== null) buildMenu.openFor(tree);
        else w.driver.addPlayerCommand(new BuildTowerCommand(tree.handle, w.towerPrefab), p);
      }
      return;
    }
    if (dist < 0.12) {
      walkTarget = null;
      return;
    }
    playerMoveUnity.x = delta.x / dist;
    playerMoveUnity.z = delta.z / dist;
    // ease the target speed in the last half unit (PlayerMotor accelerates/brakes at 12/16 u/s^2)
    const mag = Math.min(1, dist / 0.5);
    moverIntent.x = playerMoveUnity.x * mag;
    moverIntent.z = playerMoveUnity.z * mag;
  }
  // ---- outcome / HUD -------------------------------------------------------------------

  let kills = 0;
  let outcome: 'cleared' | 'over' | null = null;
  // Results-screen accumulators (Phase-4 shell).
  let coinsEarned = 0, gemsEarned = 0, playSeconds = 0;
  let shell: GameShell | null = null;
  let touch: TouchControls | null = null;
  /** Analog joystick vector (screen space: x right, y up), set by TouchControls. */
  const touchMove = { x: 0, y: 0 };
  // Per-stage BGM = StageMain.m_stageMusic (Q4.StageMain.Start @005260a0 -> PlayBGMusic); boss music =
  // m_bossMusic when the LAST wave activates (OnWaveActivate @00527160). Resolved by tools/data/resolve_stage_music.py
  // (stage 1 = bgm_stage_easy; the old demo constant 'bgm_stage_medium' was an unverified guess).
  const BGM_STAGE = `bgm/${STAGE_MUSIC[STAGE_CFG.entry.scene]?.stageMusic ?? 'bgm_stage_medium'}`;
  const BGM_BOSS = STAGE_MUSIC[STAGE_CFG.entry.scene]?.bossMusic ? `bgm/${STAGE_MUSIC[STAGE_CFG.entry.scene].bossMusic}` : null;
  function wireAudio(): void {
    const audio = sh.ensureAudio(); // may already exist (title screen created it on the first gesture)
    void audio.unlock().then(() => {
      void A()?.playBgm(BGM_STAGE);
      void A()?.preload(SFX_NAMES);
      void A()?.preload(PROJECTILE_DATA.sfx.map((n) => `sfx/${n}`)); // per-tower fire/hit clips
    });
    // Wave fanfares.
    Events.waveStartedEvent.addListener(
      (_m: GameCoreWaveManager, waveIndex: number) => {
        void A()?.play(waveIndex === 0 ? 'sfx/sfx_stage_firstwave' : 'sfx/sfx_stage_wavestart');
        if (BGM_BOSS !== null && world !== null && waveIndex + 1 === world.waveCount) void A()?.playBgm(BGM_BOSS);
        // Original wave callout (StartCallMenuController: tl_wave_call_NN).
        // (the original-art call is shown by GameUiFeature on waveActivateEvent)
        void waveCallKey;
      },
      EventTime.Immediate,
    );
    // Build-dance jingle. The build LOOP + completion sting are played by the
    // tower view itself (Q4.TowerBase.Update: PlaySFXMonitored(TowerBuild) while
    // the state is Build, StopSFX + PlaySFX(TowerComplete) on the first
    // non-Build frame — see TowerStageView.updateFromSim).
    const building = new Set<number>();
    Events.towerBuildEvent.addListener(() => {
      void A()?.play('sfx/sfx_tiki_dancejingle');
    }, EventTime.Immediate);
    Events.towerChangeStateEvent.addListener(
      (tower: GameCoreTower, state: TowerState) => {
        const id = tower.handle.m_handle;
        if (state instanceof TowerStateBuild) {
          building.add(id);
        } else if (building.delete(id)) {
          rangeIndicator.hide(); // build finished → drop the range ring
        }
      },
      EventTime.Immediate,
    );
    // Arrow shots/hits (throttled — many towers fire together late-game).
    // projectileLaunchEvent (Events+0x88) also drives the tower VIEW: Q4.TowerBase.Recoil
    // and Q4.TowerAnimator.OnFire both subscribe to it and act only when the event's
    // tower is their own.
    Events.projectileLaunchEvent.addListener((tower: GameCoreTower) => {
      towerViews.get(tower.handle.m_handle)?.view.onFire();
    }, EventTime.Immediate);
    // towerUpgradeEvent → Q4.TowerBase.OnUpgrade (level-up / final-upgrade sting).
    Events.towerUpgradeEvent.addListener((tower: GameCoreTower) => {
      towerViews.get(tower.handle.m_handle)?.view.onUpgrade(tower.getNextUpgrade() !== null, tower.currentLevel);
    }, EventTime.Immediate);
    // Projectile fire/hit sounds are per-prefab (Q4.Projectile.fireSound/hitSound) and
    // played by ProjectileViewer — no generic arrow sound here anymore.
    // Chibi soul + pickups.
    Events.enemyAttackedHomeEvent.addListener(() => {
      void A()?.play('sfx/sfx_chibi_soulfading');
    }, EventTime.Immediate);
    Events.pickupAcquiredEvent.addListener(
      (_p: GameCorePlayer, pickup: GameCorePickup) => {
        const name = pickup.inventoryType === EInventoryType.Gem
          ? 'sfx/sfx_item_gem' : 'sfx/sfx_item_coin';
        void A()?.play(name, { throttleMs: 60, volume: 0.6 });
      },
      EventTime.Immediate,
    );
    // Outcome stings (stageCleared/gameOver listeners in wireOutcome also run;
    // audio keeps its own so the banner logic stays untouched).
    Events.stageClearedEvent.addListener(() => {
      const perfect = world !== null && world.home.numChibi === world.home.numStartingChibi;
      void A()?.play(perfect ? 'sfx/sfx_stage_gameclearperfect' : 'sfx/sfx_stage_waveclear');
    }, EventTime.Immediate);
    Events.gameOverEvent.addListener(() => {
      void A()?.play('sfx/sfx_stage_gameover');
    }, EventTime.Immediate);
  }

  /** Particle emitters (NEAR fidelity, view-only). Unity→three mirror via
   *  toThree; one temp vector per burst (rates are low). */
  function wireParticles(): void {
    if (particles === null) return;
    const ps = particles;
    // Spawn every named extracted emitter that loaded; if NONE are present,
    // fall back to the hand-tuned beat (keeps effects working offline / pre-load).
    const emit = (names: string[], pos: THREE.Vector3, fallback: Parameters<typeof ps.burst>[0]): void => {
      let any = false;
      for (const n of names) {
        const rec = emitters.get(n);
        if (rec !== undefined) { ps.burstFromEmitter(rec, pos); any = true; }
      }
      if (!any) ps.burst(fallback);
    };
    // Tower build dust: NOT a one-shot burst. The original's TowerBase.Update
    // instantiates the looping ef_tower_common_build_pv ParticleGroup at the
    // tower's final position for the whole Build state (TowerStageView →
    // towerEffects.startBuildEffect); StopLoopingThenDestroy on build end.
    // Enemy death: no generic enemy-death prefab extracted (the die_* set is
    // chibi-specific) — keep the hand-tuned white poof.
    Events.enemyDestroyedEvent.addListener(
      (_t: unknown, enemy: GameCoreEnemy) => {
        ps.burst({
          position: toThree(enemy.position, new THREE.Vector3()),
          count: 16, life: [0.3, 0.7], speed: [1, 2.5], up: 1.0,
          gravity: -2, size: [0.2, 0.45], color: 0xf2f2f2,
        });
      },
      EventTime.Immediate,
    );
    Events.projectileHitEvent.addListener(
      (projectile: GameCoreProjectile) => {
        if (projectileViewer !== null) return; // real per-prefab hit effects (ProjectileViewer)
        emit(['ps_tower_arrow_hit_spark', 'ps_tower_arrow_hit_flash'],
          toThree(projectile.position, new THREE.Vector3()), {
            position: toThree(projectile.position, new THREE.Vector3()),
            count: 5, life: [0.15, 0.35], speed: [2, 4], up: 0.6,
            gravity: -6, size: [0.08, 0.18], color: 0xffe28a,
          });
      },
      EventTime.Immediate,
    );
    // Q4.PickupCurrency prefab effects: the coin has NO acquire effect (only sfx_item_coin); the gem
    // spawns ef_item_jem_pickup_pv (= ps_item_jem_pickup_spark) on acquire. The *_vanish_pv groups
    // (coin: ps_item_coin_vanish + _spark; gem: ps_item_jem_vanish(+_small) + _spark) play when the
    // pickup is LOST (lifespan expiry / water) — Q4.PickupCurrency.OnPickupLost @0x3E2FF0.
    Events.pickupAcquiredEvent.addListener(
      (_p: GameCorePlayer, pickup: GameCorePickup) => {
        if (pickup.inventoryType !== EInventoryType.Gem) return;
        emit(['ps_item_jem_pickup_spark'],
          toThree(pickup.position, new THREE.Vector3()), {
            position: toThree(pickup.position, new THREE.Vector3()),
            count: 10, life: [0.3, 0.6], speed: [1, 2], up: 1.8,
            gravity: -1, size: [0.1, 0.22], color: 0xb57aff,
          });
      },
      EventTime.Immediate,
    );
    Events.pickupLostEvent.addListener(
      (pickup: GameCorePickup) => {
        const gem = pickup.inventoryType === EInventoryType.Gem;
        emit(gem ? ['ps_item_jem_vanish', 'ps_item_jem_vanish_small', 'ps_item_jem_vanish_spark']
          : ['ps_item_coin_vanish', 'ps_item_coin_vanish_spark'],
        toThree(pickup.position, new THREE.Vector3()), {
          position: toThree(pickup.position, new THREE.Vector3()),
          count: 8, life: [0.3, 0.6], speed: [0.5, 1.5], up: 1.2,
          gravity: -1, size: [0.1, 0.2], color: gem ? 0xb57aff : 0xffd34d,
        });
      },
      EventTime.Immediate,
    );
    Events.enemyAttackedHomeEvent.addListener(
      (_e: GameCoreEnemy, _h: GameCoreHome, chibi: ChibiData) => {
        emit(['ps_npc_chibi_die_smoke', 'ps_npc_chibi_die_spark'],
          toThree(chibi.pos, new THREE.Vector3()), {
            position: toThree(chibi.pos, new THREE.Vector3()),
            count: 14, life: [0.5, 1.1], speed: [0.5, 1.5], up: 2.2,
            gravity: 0.4, size: [0.12, 0.3], color: 0x9fd8ff, fade: 0.5,
          });
      },
      EventTime.Immediate,
    );
  }

  function wireOutcome(): void {
    const w = world!;
    // Q4.PickupManager port (src/view/pickups/PickupDrops.ts): enemy-death / tower-sell / bump /
    // gem-tower currency drops with the extracted prop_001/prop_002 prefabs + per-enemy
    // PickupMovement, and the gem credit through the CurrencyFlyer -> AddInventoryCommand seam.
    pickupDrops?.dispose();
    pickupDrops = new PickupDropManager({
      globalCoinPerValueOverride:
        STAGE_PICKUP_MANAGERS[`BuildPlayer-${STAGE_CFG.entry.scene}_env`]?.globalCoinPerValueOverride ?? 0,
      issueCommand: (cmd, p) => w.driver.addPlayerCommand(cmd, p),
      onGemFlyer: (pk) => {
        // CurrencyFlyerPool.OnAcquireCurrency: the flyer starts at the pickup's screen position.
        if (currencyFlyers === null || gameUi === null) return;
        const v = toThree(pk.position, new THREE.Vector3()).project(stageCamera.camera);
        const rect = renderer.domElement.getBoundingClientRect();
        const ref = gameUi.root.toRef(
          rect.left + (v.x * 0.5 + 0.5) * rect.width,
          rect.top + (-v.y * 0.5 + 0.5) * rect.height,
        );
        currencyFlyers.spawn(ref);
      },
    });
    pickupDrops.install();
    Events.enemyDestroyedEvent.addListener(
      () => {
        kills++;
      },
      EventTime.Immediate,
    );
    // PJM2 build-dance: the tikiman dances at the tree while its tower builds.
    Events.towerBuildEvent.addListener(
      (tower: GameCoreTower, tree: GameCoreTree, player: GameCorePlayer) => {
        if (playerView === null || player !== w.player) return;
        // Face the tree (unity-space direction), then dance for buildTime.
        const d = tree.position.sub(player.position);
        playerView.face({ x: d.x, z: d.z });
        playerView.startBuildDance(tower.buildTime > 0 ? tower.buildTime : 6);
      },
      EventTime.Immediate,
    );
    Events.stageClearedEvent.addListener(() => {
      outcome = 'cleared';
      queueMicrotask(() => { if (!disposed) sh.outcome('cleared'); });
      const perfectClear = w.home.numChibi === w.home.numStartingChibi;
      const ht = hudStrings(uiStrings, {
        coins: 0, gems: 0, wave: w.waveCount, waveCount: w.waveCount,
        chibis: w.home.numChibi, chibiTotal: w.home.numStartingChibi,
        difficulty: GAME_DIFFICULTY, outcome: 'cleared', perfect: perfectClear,
      });
      void ht; // original-art CLEAR call replaces the dev banner (GameUiFeature.onStageCleared)
      // StageResultMenuController.Show: stageClearedScreenEvent(0, ShouldAwardPerfectClear) -> chibis celebrate (perfect: step 1 below).
      chibiView?.onStageClearedScreen(0, perfectClear);
      // Q4.StageResultMenuController.OnCameraSwitch: ComputeScore + AddUnlockedStage + UpdateStageRecord.
      const cleared = buildClearResult({
        home: w.home, waveManager: w.waveManager, inventory: w.inventory, save: save ?? null,
        scene: STAGE_CFG.saveKey, difficulty: GAME_DIFFICULTY,
      });
      if (cleared.outcome?.newBest) flash('New record!');
      if (gameUi !== null) gameUi.onStageCleared(resultsData(true, cleared.score));
      else shell?.showResults(resultsData(true, cleared.score));
    }, EventTime.Immediate);
    Events.gameOverEvent.addListener(() => {
      outcome = 'over';
      queueMicrotask(() => { if (!disposed) sh.outcome('over'); });
      const ht = hudStrings(uiStrings, {
        coins: 0, gems: 0, wave: w.waveManager.currentWaveIndex + 1, waveCount: w.waveCount,
        chibis: w.home.numChibi, chibiTotal: w.home.numStartingChibi,
        difficulty: GAME_DIFFICULTY, outcome: 'gameover',
      });
      void ht; // original-art GAME OVER call replaces the dev banner (GameUiFeature.onGameOver)
      if (gameUi !== null) gameUi.onGameOver(resultsData(false));
      else shell?.showResults(resultsData(false));
    }, EventTime.Immediate);
    // Results-screen currency accumulators.
    Events.pickupAcquiredEvent.addListener(
      (_p: GameCorePlayer, pickup: GameCorePickup) => {
        if (!(pickup instanceof GameCorePickupCurrency)) return;
        if (pickup.inventoryType === EInventoryType.Gem) gemsEarned += pickup.value;
        else coinsEarned += pickup.value;
      },
      EventTime.Immediate,
    );
  }

  /** Snapshot for the results overlay (Phase-4 shell). */
  function resultsData(won: boolean, score?: ResultScoreData): ResultsData {
    const w = world!;
    return {
      score,
      won,
      perfect: won && w.home.numChibi === w.home.numStartingChibi,
      wavesCleared: won ? w.waveCount : w.waveManager.currentWaveIndex,
      totalWaves: w.waveCount,
      kills,
      coinsEarned,
      gemsEarned,
      chibisSaved: w.home.numChibi,
      chibisTotal: w.home.numStartingChibi,
      timeSeconds: playSeconds,
    };
  }

  function updateHud(fps: number, maxFrameMs: number): void {
    const w = world!;
    const coins = w.inventory.getAvailableInventory(w.player.handle, EInventoryType.Coin);
    const gems = w.inventory.getAvailableInventory(w.player.handle, EInventoryType.Gem);
    const wave = Math.min(w.waveManager.currentWaveIndex + 1, w.waveCount);
    const ht = hudStrings(uiStrings, {
      coins, gems, wave, waveCount: w.waveCount,
      chibis: w.home.numChibi, chibiTotal: w.home.numStartingChibi,
      difficulty: GAME_DIFFICULTY,
    });
    hudLayout?.update({
      coins, gems,
      chibisSaved: w.home.numChibi, chibisTotal: w.home.numStartingChibi,
      kills, wave, totalWaves: w.waveCount,
      stageName: `${ht.stage} · ${ht.area}`, difficulty: ht.difficulty,
    });
    const info = renderer.info.render;
    const p95 = frameHistogram.percentile(95);
    perfHud.textContent =
      `${fps} fps | p95 ${p95.toFixed(1)}ms | worst ${maxFrameMs.toFixed(1)}ms | calls ${info.calls} tris ${(info.triangles / 1000).toFixed(0)}k`;
  }


  // ---- main loop ---------------------------------------------------------------------------

  let lastTime = performance.now();
  let fpsAccum = 0, fpsFrames = 0, fpsDisplay = 0, maxFrameMs = 0;
  // Phase-5 frame-time distribution (2ms buckets to 100ms + overflow tail).
  const frameHistogram = new FrameTimeHistogram(2, 100);

  function frame(now: number): void {
    if (disposed) return;
    frameCalls++;
    const wallDelta = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(wallDelta, DT_MAX);

    if (started && world !== null && outcome === null && !(shell?.paused ?? false)) {
      playSeconds += dt;
      tickPlayerMovement(dt);
      world.driver.step(dt);
      world.driver.lateUpdate();
      towerLevel?.update(dt, playerMoveUnity.x !== 0 || playerMoveUnity.z !== 0, outcome !== null);
    }
    if (started && world !== null) {
      const uiDt = shell?.paused ? 0 : dt;
      introController?.update(uiDt);
      gameUi?.update(uiDt);
      currencyFlyers?.update(uiDt);
      buildMenu?.update(uiDt);
    }
    // Touch suppression while any overlay is up (Esc-pause has no callback).
    touch?.setEnabled(!(shell?.paused ?? false) && !(shell?.resultsVisible ?? false));
    if (world !== null) {
      syncViews(dt, now / 1000);
      stageViewRef?.tickWater(dt); // river flow animation (cosmetic)
      // Faithful PJM2 follow (serialized GameCameraTopDown node 889): Unity
      // SmoothDamp, smoothTime = max(zoomRate,0.1)*0.2, NO look-ahead/deadzone
      // (GetDesiredLookatTarget @004469b0). vel feeds the parallel-pan reset gate.
      if (playerMesh !== null && debugCamFocus === null) {
        stageCamera.follow(playerMesh.position, playerMoveDir, dt);
      }
    }

    stageCamera.update(dt);
    introController?.applyCamera(); // intro cut overrides the follow pose until the hand-off
    waterPass.render(stageCamera.camera);

    const frameMs = wallDelta * 1000;
    if (frameMs > maxFrameMs && fpsFrames > 10) maxFrameMs = frameMs;
    if (frameCalls > 30) frameHistogram.record(frameMs); // skip startup warmup
    fpsAccum += wallDelta;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      fpsDisplay = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
      if (world !== null) updateHud(fpsDisplay, maxFrameMs);
    }
    }

  /** Stage intro (docs/STAGE_INTRO_ANALYSIS.md). Without a rig (`?nointro`, no extracted rig) the legacy path queues the
   *  IntroSequenceSkipCommand immediately - same as the headless sim (npm run sim:stage1). */
  async function startIntroOrSkip(): Promise<void> {
    const w = world;
    const rig = await introRigLoad;
    if (w === null) return;
    if (rig === null || rig.cameras.length === 0 || uiAssets === null) {
      if (gameUi !== null) gameUi.root.el.style.visibility = ''; // no intro to slide the HUD in
      w.driver.addPlayerCommand(new IntroSequenceSkipCommand(), w.player);
      return;
    }
    const S = (k: string, f: string): string => t(uiStrings, k, f);
    const card = new IntroCardUi(uiAssets);
    card.attach(sessionUi);
    introCardRef = card;
    const cfg = STAGE_CFG.entry;
    introController = new StageIntroController({
      rig, camera: stageCamera.camera, scene, card,
      hooks: {
        simIntroFinished: () => w.waveManager.introSequenceFinished,
        queueSkipCommand: () => { w.driver.addPlayerCommand(new IntroSequenceSkipCommand(), w.player); },
        setCountdownDigit: (d) => { gameUi?.calls.setCountdown(d); },
        playCountdownSound: (step) => { void A()?.play(step < 3 ? 'sfx/sfx_menu_countdownbase' : 'sfx/sfx_menu_countdownfinal'); },
        showStartCall: () => { gameUi?.calls.showCall(waveStartCall(S, 1, w.waveCount === 1), START_CALL_SECONDS); },
        setHudSlide: (s) => {
          const el = gameUi?.root.el;
          if (el === undefined) return;
          el.style.visibility = s > 0 ? '' : 'hidden';
          el.style.opacity = s >= 1 ? '' : String(s);
          el.style.translate = s >= 1 ? '' : `0 ${Math.round((s - 1) * 120)}px`; // GameInfoController.Show: slides in from above
        },
        onHandoff: () => { if (playerMesh !== null) stageCamera.snap(playerMesh.position); },
        cardText: () => ({
          area: S(cfg.areaName, 'Area'),
          stage: S(cfg.stageName, `STAGE ${cfg.stage}`),
          difficulty: S(DIFFICULTY_LABEL_KEYS[GAME_DIFFICULTY], ['Fun', 'Tricky', 'Mayhem'][GAME_DIFFICULTY]),
          hint: 'Press Enter / click to start',
        }),
        makeChibiRig: () => introChibiRig?.() ?? null,
        // No outline / toon: the original chibi material is plain Unity Standard (see ToonMaterial.ts provenance; original screenshots show smooth PBR, no black rim).
        setLateHomeChibisHidden: (h) => { chibiView?.setLateHidden(3, h); },
        linecast: physicsWorld !== null ? chibiLinecast : null,
        // Fallback when physics is unavailable: the picker works in three space (x mirrored).
        groundY: (x, z, fb) => picker.groundY(-x, fb + 2, z) ?? fb,
      },
    });
    introController.bindFlow(introFlow);
    introController.begin();
  }

    function start(): void {
    if (world === null || started) return;
    started = true;
    wireOutcome();
    wireParticles();
    wireAudio(); // gesture context: create + unlock WebAudio here
    towerLevel?.wireEvents();
    // Phase-4 shell: pause/results overlays + touch controls (multi-device).
    gameUi?.wireEvents();
    shell = new GameShell({
      skin: gameUi?.screens,
      onResume: () => { /* frame() reads shell.paused each tick */ },
      onRestart: () => { sh.exit('retry'); }, // in-page restart: the shell disposes this session and builds a fresh one
      onToggleMute: () => {
        const m = !(A()?.muted ?? false);
        A()?.setMuted(m);
        save?.setMuted(m); // persist preference
        return m;
      },
    });
    shell.attach();
    // Restore persisted mute preference (Phase-4 save).
    const savedMuted = save?.preferences.muted ?? false;
    if (save !== null) applyPreferences(A(), save.preferences); // option-menu volumes
    A()?.setMuted(savedMuted);
    shell.setMuted(savedMuted);
    gameUi?.screens.setMuted(savedMuted);
    touch = new TouchControls({
      target: renderer.domElement,
      onMove: (x, y) => { touchMove.x = x; touchMove.y = y; },
      onTap: (cx, cy) => {
        // Same semantics as the mouse pointerdown handler below.
        if (!started || world === null || (introController?.active ?? false)) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const hit = picker.pickUnity(cx, cy, rect, stageCamera.camera);
        if (hit === null) return;
        const target = new Vector3(hit.x, hit.y, hit.z);
        let nearest: GameCoreTree | null = null;
        let nearestD = Infinity;
        for (const t of world.trees) {
          if (!t.isTreeValid()) continue;
          const d = Vector3.Distance(t.position, target);
          if (d < nearestD) { nearestD = d; nearest = t; }
        }
        walkTarget = nearest !== null && nearestD < 2.0
          ? { pos: nearest.position.clone(), tree: nearest }
          : { pos: target, tree: null };
        if (nearest !== null && nearestD < 2.0) { buildQueuedFor = -1; showTreeRange(nearest); }
        else rangeIndicator.hide();
      },
      onPause: () => { if (!(introController?.timeline.isIntroSequence ?? false)) shell?.togglePause(); }, // StageMain.OnPauseMenu: IsIntroSequence blocks pause
    });
    touch.attach();
    void startIntroOrSkip();
    }

    // Debug/verification handle (harmless in production; used by .work probes). `window.__pjm2` -> this.
  let debugCamFocus: { x: number; z: number } | null = null; // probe-only camera override
    const debug: Record<string, unknown> = {
    /** Debug (intro probes): intro timeline state, or null when no intro is running. */
    introState: () => {
      const c = introController;
      if (c === null) return null;
      const tl = c.timeline;
      return { stage: tl.stage, cut: tl.camera.name, animTime: tl.animTime, elapsed: tl.elapsed, lockout: tl.lockout,
        confirmed: tl.confirmed, follow: tl.followActive, black: tl.blackAlpha, digit: tl.countdownDigit, active: c.active };
    },
    /** Debug (intro probes): advance the intro (and the sim) by `seconds` in 1/30 s steps without rendering. */
    introAdvance: (seconds: number) => {
      if (world === null) return;
      for (let t = 0; t < seconds; t += 1 / 30) {
        world.driver.step(1 / 30);
        world.driver.lateUpdate();
        introController?.update(1 / 30);
        gameUi?.update(1 / 30);
        chibiView?.update(1 / 30);
      }
    },
    /** Debug (intro probes): confirm the stage card (same path as Enter / click). */
    introConfirm: () => introController?.tryConfirm() ?? false,
    /** Debug (drop probes): spawn an enemy-style currency drop `dx,dz` from the player with a
     *  given enemy prefab's PickupMovement; returns the number of pickups created. */
    debugDrop: (coin: number, gem: number, dx = 2, dz = 0, enemy = 'kuri_00_001') => {
      if (world === null || pickupDrops === null) return -1;
      const p = world.player.position;
      const pos = new Vector3(p.x + dx, p.y + 0.2, p.z + dz);
      const mv = ENEMY_PICKUP_MOVEMENT[enemy] ?? null;
      return pickupDrops.createCurrency(pos, EInventoryType.Coin, coin, mv).length
        + pickupDrops.createCurrency(pos, EInventoryType.Gem, gem, mv).length;
    },
    /** Debug (drop probes): live currency pickups + inventory + flyer count. */
    pickupInfo: () => {
      if (world === null) return null;
      const list = [...world.core.allObjects<GameCorePickupCurrency>(GameCorePickupCurrency)].map((c) => ({
        type: c.inventoryType, value: c.value, x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
        carried: c.pickupPlayer !== null, life: +c.remainingLifespan.toFixed(1),
      }));
      return {
        pickups: list,
        coins: world.inventory.getAvailableInventory(world.player.handle, EInventoryType.Coin),
        gems: world.inventory.getAvailableInventory(world.player.handle, EInventoryType.Gem),
        flyers: currencyFlyers?.count ?? -1,
        spawned: pickupDrops ? [pickupDrops.spawnedCoins, pickupDrops.spawnedGems] : null,
        views: pickupView !== null,
      };
    },
    /** Debug: queue a BuildTowerCommand on the valid tree nearest the player (no walk/UI). */
    buildNearestTree: () => {
      if (world === null) return null;
      let nearest: GameCoreTree | null = null;
      let nearestD = Infinity;
      for (const t of world.trees) {
        if (!t.isTreeValid()) continue;
        const d = Vector3.Distance(t.position, world.player.position);
        if (d < nearestD) { nearestD = d; nearest = t; }
      }
      if (nearest === null) return null;
      world.driver.addPlayerCommand(new BuildTowerCommand(nearest.handle, world.towerPrefab), world.player);
      return { x: nearest.position.x, y: nearest.position.y, z: nearest.position.z };
    },
    /** Debug (projectile probes): build a SPECIFIC tower prefab (tower_001..012) on the tree
     *  nearest the player; returns the tree position or null. */
    buildTowerNearest: (name: string) => {
      const c = towerContracts.get(name);
      if (world === null || c === undefined) return null;
      let nearest: GameCoreTree | null = null;
      let nearestD = Infinity;
      for (const t of world.trees) {
        if (!t.isTreeValid()) continue;
        const d = Vector3.Distance(t.position, world.player.position);
        if (d < nearestD) { nearestD = d; nearest = t; }
      }
      if (nearest === null) return null;
      world.driver.addPlayerCommand(new BuildTowerCommand(nearest.handle, c), world.player);
      return { x: nearest.position.x, y: nearest.position.y, z: nearest.position.z };
    },
    /** Debug: live Q4.Projectile views (class, model, view/sim pose) + counters. */
    projectileViews: () => ({
      stats: projectileViewer?.stats ?? null,
      effects: projectileViewer?.deps.effects?.counters ?? null,
      particlesAlive: projectileParticles?.alive ?? -1,
      live: [...(projectileViewer?.instances.values() ?? [])].map((i) => ({
        prefab: i.prefabName,
        cls: i.className,
        model: i.object3d !== null,
        viewPos: i.viewPos,
        sim: i.lastSimPosition,
        visible: i.viewTransform.visible,
      })),
    }),
    /** Debug (UI probes): park the player next to the nearest valid tree; returns it. */
    teleportNearTree: (dx = 1.2, dz = 0) => {
      if (world === null) return null;
      let nearest: GameCoreTree | null = null;
      let nearestD = Infinity;
      for (const t of world.trees) {
        if (!t.isTreeValid()) continue;
        const d = Vector3.Distance(t.position, world.player.position);
        if (d < nearestD) { nearestD = d; nearest = t; }
      }
      if (nearest === null) return null;
      world.player.position = new Vector3(nearest.position.x + dx, world.player.position.y, nearest.position.z + dz);
      return { x: nearest.position.x, z: nearest.position.z };
    },
    /** Debug (UI probes): build-ring + wave-UI state. */
    uiState: () => ({
      ring: buildMenu?.snapshot() ?? null,
      lastBuilt: buildMenu?.lastBuilt ?? null,
      coins: world ? world.inventory.getAvailableInventory(world.player.handle, EInventoryType.Coin) : null,
      wave: world ? world.waveManager.currentWaveIndex : null,
      outcome,
    }),
    /** Debug (UI probes): jump the wave manager to a wave (skipToWave). */
    skipToWave: (i: number) => { world?.waveManager.skipToWave(i); },
    /** Debug (enemy view probes): live enemy views (anim state, three-space pos, life) + health bars. */
    enemyViews: () => [...enemyViews.values()].map(({ view, enemy }) => ({
      def: view.defName, anim: view.animState, base: view.base?.state ?? null,
      pos: { x: view.root.position.x, y: view.root.position.y, z: view.root.position.z },
      life: enemy.getLife(), max: enemy.getMaxLife(),
    })),
    enemyBars: () => enemyViewSystem?.bars.items.length ?? 0,
    /** Debug: damage the first live enemy (probe: shows the health bar). */
    hurtFirstEnemy: (amount: number) => {
      const t = [...enemyViews.values()][0];
      if (!t) return false;
      t.enemy.dealDamage(null, amount, 0, null);
      return true;
    },
    /** Debug: per-tower view state (construction probes). */
    towerViews: () => [...towerViews.entries()].map(([id, { view, tower }]) => ({
      id,
      state: tower.getTowerState()?.constructor.name ?? null,
      simY: tower.position.y,
      viewY: view.root.position.y,
      building: view.building,
      anim: view.animatorPath,
      scaleY: view.root.scale.y,
    })),
    /** Debug: river mesh world bounds + park the camera on (x,z) (null = resume follow). */
    riverBounds: () => {
      const box = new THREE.Box3();
      stageViewRef?.riverMeshes.forEach((m) => box.expandByObject(m));
      return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
    },
    /** Debug: live stage material by id (prop-rendering probes). */
    stageMaterial: (id: string) => stageViewRef?.materials.get(id) ?? null,
    focusCamera: (x: number | null, z = 0) => {
      debugCamFocus = x === null ? null : { x, z };
      if (x !== null) stageCamera.snap({ x, y: 0, z });
    },
    tikimanInfo: () => {
      if (playerView === null) return null;
      const box = new THREE.Box3().setFromObject(playerView.root);
      const size = box.getSize(new THREE.Vector3());
      return {
        size: { x: size.x, y: size.y, z: size.z },
        pos: playerView.root.position.toArray(),
        visible: playerView.root.visible,
        clips: playerView['rig'].clips.length,
      };
    },
    chibiPositions: () => (chibiView?.root.children.map((c) => c.position.toArray()) ?? []),
    cameraInfo: () => ({
      distance: stageCamera.camera.position.distanceTo(stageCamera.target),
      target: stageCamera.target.toArray(),
    }),
    /** Debug: splat-terrain wiring — layer textures live + geometry weights. */
    terrainSplat: () => {
      if (stageViewRef === null) return null;
      const m = ([...stageViewRef.materials.entries()].find(([, mm]) => mm.userData.splat !== undefined)?.[1]);
      if (!m) return null;
      const splat = m.userData.splat as
        { layers: Record<string, THREE.Texture | null>; shader: unknown } | undefined;
      const terrainMesh = stageViewRef.terrainPickMeshes[0] as THREE.Mesh | undefined;
      const attr = (terrainMesh?.geometry as THREE.BufferGeometry | undefined)
        ?.getAttribute('splat') as THREE.BufferAttribute | undefined;
      return {
        installed: splat !== undefined,
        layers: splat
          ? Object.fromEntries(Object.entries(splat.layers).map(([k, v]) => [k, v !== null]))
          : null,
        baseMap: m.map !== null,
        splatVerts: attr?.count ?? 0,
        splatSample: attr ? [attr.getX(0), attr.getY(0), attr.getZ(0), attr.getW(0)] : null,
      };
    },
    /** Phase-5: frame-time distribution snapshot (probe-verification hook). */
    perfHistogram: () => frameHistogram.snapshot(),
    /** Debug: tree unity positions + wind clock / contact-shake state (tree-sway probes). */
    treeInfo: () => ({
      windTime: treeView?.windTime ?? -1,
      trees: (world?.trees ?? []).slice(0, 700).map((t) => ({
        id: t.handle.m_handle, x: t.position.x, z: t.position.z, shake: treeView?.getShake(t.handle.m_handle) ?? null,
      })),
    }),
    /** Visual-fidelity batch probe: trees/HUD/sky/toon wiring took effect. */
    sceneInfo: () => ({
      trees: treeView?.count ?? -1,
      hudAttached: hudLayout !== null,
      toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure,
      postGrade: waterPass.gradeEnabled, // PPSv1 grade replaces renderer tone mapping
      background: scene.background instanceof THREE.Color ? scene.background.getHexString() : 'texture',
      envSet: scene.environment !== null,
      pickups: pickupView !== null,
    }),
    /** Debug: fire a test burst at the player (probe-verification hook). */
    testBurst: () => particles.burst({
      position: playerView !== null ? playerView.root.position.clone() : new THREE.Vector3(),
      count: 30, life: [0.4, 0.8], speed: [1, 3], up: 1.2,
      size: [0.15, 0.3], color: 0xffffff,
    }),
    /** Debug: vertical terrain linecast (unity coords) via the sim seam. */
    linecastDown: (x: number, z: number) => {
      if (physicsWorld === null) return null;
      const hit = createQueries(physicsWorld).linecast(
        x, 40, z, x, -40, z, physicsWorld.terrainMask,
      );
      return hit === null ? null : { y: hit.point[1], normal: hit.normal[1] };
    },
    state: () => ({
      started,
      outcome,
      keys: [...moveKeys],
      wasdFrames,
      tickCalls,
      frameCalls,
      dancing: playerView?.dancing ?? false,
      chibisAlive: chibiView?.alive ?? -1,
      chibiRigs: chibiView?.root.children.length ?? -1,
      physicsLoaded,
      paused: shell?.paused ?? false,
      resultsVisible: shell?.resultsVisible ?? false,
      muted: A()?.muted ?? false,
      bestRecord: save?.getStageRecord(STAGE_CFG.saveKey, GAME_DIFFICULTY) ?? 0,
      stageClearedBefore: save?.hasClearedStage(STAGE_CFG.saveKey) ?? false,
      particlesAlive: particles?.alive ?? -1,
      audio: A() === null ? null : {
        bgm: A()!.currentBgm,
        plays: Object.fromEntries(A()!.playCounts),
        failed: [...A()!.failed],
      },
      playerUnity: world === null ? null : {
        x: world.player.position.x, z: world.player.position.z,
        y: world.player.position.y, mode: playerMover?.mode ?? null,
        grounded: playerMover?.groundedCC ?? null, waterDepth: playerMover?.waterDepth ?? null,
      },
    }),
    };

  async function boot(): Promise<void> {
    const assetCache = sh.assetCache; // shared Cache-API bucket (repeat loads = zero RTT)
    // Start the independent small/medium fetches NOW so they overlap sky/PMREM
    // (HAR: physics collider files used to start only after the view finished,
    // at t=8.3s, queued behind ~66MB of textures on a 6-connection HTTP/1.1 link).
    const bundleFetch = fetch(STAGE_BUNDLE_URL);
    const physicsLoad = loadStageWorld(STAGE_CFG.physicsUrl);
    physicsLoad.catch(() => { /* handled where awaited */ });
    // Everything below used to be awaited serially AFTER the stage/characters (HAR: tower-upgrades →
    // ui fonts/sprites → towers.json = 3 chained round trips at the very end). Start them all at t=0.
    const towerUpgradesLoad = fetch('/assets/data/tower-upgrades.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`tower-upgrades ${r.status}`))));
    const towersJsonLoad = fetch('/assets/data/towers.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`towers ${r.status}`))));
    const uiAssetsLoad = sh.uiAssets;
    for (const pr of [towerUpgradesLoad, towersJsonLoad, uiAssetsLoad]) pr.catch(() => { /* handled where awaited */ });
    // PMREM ambient + ACES tonemap + exposure (evidence-based) — GPU work, overlaps the downloads.
    // Baked HDR ReflectionProbe (docs/REFLECTION_PROBE_ANALYSIS.md): fetched in parallel, installed AFTER the PMREM
    // (which stays as the fallback when a stage ships no probe). ?noprobe = A/B against the stock PMREM path.
    const probeLoad = new URLSearchParams(window.location.search).has('noprobe')
      ? Promise.resolve(null) : loadStageReflectionProbe(STAGE_CFG.sceneBaseUrl);
    const skyReady = sky.apply().then(async () => {
      scene.background = new THREE.Color(STAGE_ENV.clearHex); // faithful flat clear (cubemap not visible)
      const probe = await probeLoad;
      if (probe) { stageProbeTexture = probe.texture; installStageReflectionProbe(scene, probe.texture, probe.meta.intensity); }
    });
    sh.progress(null, `stage-${STAGE_CFG.entry.stage} data bundle…`);
    const bundle = (await (await bundleFetch).json()) as Record<string, unknown>;
    const readJson = (file: string): Json[] => bundle[file] as Json[];
    const BUNDLE_IDX = STAGE_CFG.bundleIdx; // 0: per-stage bundle holds its record at idx 0 (stage 1: source idx 12)

    const stageView = new StageSceneView({
      baseUrl: STAGE_CFG.sceneBaseUrl,
      renderer,
      sceneFile: 'scene-webp.json', // repacked textures (falls back to scene.json)
      textureConcurrency: 10,
      blockingPriorityBelow: 8, // terrain + river gate Start; props/huts stream in behind
      // props/huts textures (60MB) wait until the critical bytes (packs, terrain) are in, so they
      // never compete with them for bandwidth on slow links; on fast links this is ~instant.
      deferNonBlockingUntil: packsHighPriorityLoaded(),
      assetCache,
      onProgress: (p) => {
        const pct = p.totalBytes > 0 ? (p.loadedBytes / p.totalBytes) * 100 : 0;
        sh.progress(pct, `${p.phase}: ${p.detail} — ${(p.loadedBytes / 1e6).toFixed(0)}/${(p.totalBytes / 1e6).toFixed(0)} MB`);
      },
    });
    stageViewRef = stageView;

    const library = new CharacterLibrary('/assets/characters/', assetCache);
    libraryRef = library;
    const eagerTowers = new URLSearchParams(window.location.search).has('eagertowers');
    const coreCharacters = library.loadMany(CHARACTER_DEFS);
    const lateCharacters = coreCharacters.then(() => library.loadMany(CHARACTER_LATE_DEFS));
    setTowerFlagFactory((lvl) => (library.get(`flag_001_${lvl}`) !== null ? library.instantiate(`flag_001_${lvl}`) : null));
    lateCharacters.catch((err) => { console.warn('late tower models failed to load:', err); });
    void loadMeshParticles().then((mp) => { if (mp !== null && !disposed) { meshParticles = mp; setMeshParticles(mp); scene.add(mp.group); } });
    const [, sceneDoc, , , pickupAssets, strings, treeAssets, projectileModels] = await Promise.all([
      stageView.load().then(() => {
        scene.add(stageView.group);
        picker.setTargets(stageView.terrainPickMeshes);
        const riverMat = stageView.riverMeshes[0]?.material;
        if (riverMat) waterPass.setWater(stageView.riverMeshes, riverMat as THREE.ShaderMaterial);
      }),
      fetchJsonCompressed<SceneDoc>(STAGE_CFG.sceneJsonUrl, assetCache),
      coreCharacters,
      // Extracted particle settings (cosmetic — failure leaves hand-tuned beats).
      fetch('/assets/particles/particles.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`particles ${r.status}`))))
        .then((json) => { for (const rec of parseEmitterFile(json)) emitters.set(rec.name, rec); })
        .catch((err) => { console.warn('particle settings unavailable — hand-tuned fallback:', err); }),
      // Real coin/gem GLBs (per-file failure → primitive fallback, never throws).
      PickupView.load('/assets/pickups/'),
      // Extracted UI string table (Q4.TextDatabase, main_assets) — failure→{}.
      sh.strings,
      // Real NatureTree GLBs (nature bundle) — failure→procedural fallback trees.
      TreeView.load('/assets/trees/'),
      // Projectile model GLBs (props/structures bundles; never throws, model-less on failure).
      loadProjectileModels('/assets/projectiles/'),
      skyReady,
      eagerTowers ? lateCharacters : Promise.resolve(),
    ]);
    // Loader template bundles (not in the scene graph) are freed in dispose().
    for (const a of [pickupAssets, treeAssets, projectileModels]) ownedTemplates.push(...collectObject3Ds(a));
    pickupView = new PickupView(characterRoot, pickupAssets);
    // Q4.Projectile* views. Own particle pool (per-particle sizes) + lazy audio sink
    // (audio is created on the START gesture).
    projectileParticles = new ParticleSystem(4096, undefined, { perParticleSize: true });
    scene.add(projectileParticles.points);
    projectileViewer = new ProjectileViewerSystem({
      parent: characterRoot,
      models: projectileModels,
      effects: new ProjectileEffects(projectileParticles, emitters, PROJECTILE_DATA.effects),
      audio: {
        play: (n, o) => A()?.play(n, o),
        startLoop: (n, o) => A()?.startLoop(n, o) ?? { stop: () => {} },
      },
      towerFirePose: (towerId) => {
        const v = getRegisteredUnityObject(towerId);
        return v instanceof TowerStageView ? v.getFireEffectLocation() : null;
      },
      enemyAnchor: (enemy) => {
        // Q4.Projectile.EmitProjectileHitEffect: Hips_Bn child position, else the root.
        const v = getRegisteredUnityObject(enemy.handle.m_handle) as { root?: THREE.Object3D } | null;
        const hips = v?.root?.getObjectByName('Hips_Bn');
        if (hips === undefined || hips === null) return null;
        const wp = hips.getWorldPosition(new THREE.Vector3());
        return { x: -wp.x, y: wp.y, z: wp.z };
      },
    });
    setProjectileViewerFactory(projectileViewer.factory);
    Events.projectileHitEvent.addListener(projectileViewer.onProjectileHit, EventTime.Immediate);
    await applyTreeSurfaceMaps(treeAssets); // DXT5nm normal + Metal/smoothness (SolidTree), never throws
    treeView = new TreeView(characterRoot, treeAssets);
    if (!new URLSearchParams(window.location.search).has('nograss')) {
      void loadGrassView(STAGE_CFG.entry.scene).then((g) => {
        if (g === null) return;
        if (ac.signal.aborted) { g.dispose(); return; }
        grassView = g;
        scene.add(g.group);
      });
    }
    if (!new URLSearchParams(window.location.search).has('noweather')) {
      void loadWeatherView(STAGE_CFG.entry.scene).then((wv) => {
        if (wv === null) return;
        if (ac.signal.aborted) { wv.dispose(); return; }
        weatherView = wv;
        scene.add(wv.points);
      });
    }
    uiStrings = strings;
    hudLayout = new HudLayout({
      coin: t(uiStrings, 'tl_result_003', 'Coins'),
      gem: t(uiStrings, 'tl_result_005', 'Gems'),
      chibis: t(uiStrings, 'tl_result_008', 'Chibis Saved'),
      kills: 'Kills',
      wave: 'WAVE',
    });
    // HudLayout stays as the data seam; the on-screen HUD is the original-art OriginalHud (below).
    // Tower level/upgrade UI + per-tower upgrade tables (Q4.TowerUpgradeSetting).
    towerLevel = new TowerLevelFeature({
      core: () => world!.core,
      player: () => world!.player,
      inventory: () => world!.inventory,
      issue: (cmd) => world!.driver.addPlayerCommand(cmd, world!.player),
      playSound: (n) => { void A()?.play(n); },
      strings: () => uiStrings,
      project: (pos, h) => {
        const v = toThree({ x: pos.x, y: pos.y + h, z: pos.z }, new THREE.Vector3()).project(stageCamera.camera);
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
          visible: v.z > -1 && v.z < 1,
        };
      },
      danceView: (active) => { if (active) playerView?.keepDancing(); },
      danceExpRate: 1.0, // DifficultySettings Medium danceEXPRate (x multiplayer 1P 1.0)
    });
    towerLevel.attach(sessionUi);
    await towerUpgradesLoad
      .then((table) => towerLevel!.setTable(table))
      .catch((err) => { console.warn('tower-upgrades.json unavailable — towers stay level 1:', err); });
    // ---- original-art UI: HUD, wave calls, build ring, pause/results skin ----
    uiAssets = await uiAssetsLoad;
    towerLevel?.ui.setAssets(uiAssets); // clock-style EXP gauge sprites + Font_01 level label (crown glyph)
    // Q4.NewHealthBar port + enemy Animator event routing (enemyViewSystem.ts).
    setEnemyGroundProbe((x, y, z) => picker.groundY(x, y, z));
    enemyViewSystem = new EnemyViewSystem({
      camera: stageCamera.camera,
      container: app,
      spriteUrl: (n) => uiAssets!.spriteUrl(n),
      toThree: (p, out) => toThree(p, out),
      scene, // enemy ParticleGroupEvent effects (fire / ice / die / boss dust ...)
    });
    const noUi =new URLSearchParams(location.search).has('noui'); // debug: skip the original-art UI
    await towersJsonLoad
      .then((defs: Json[]) => {
        for (const d of defs) {
          const c = tower001Contract(d, () => towerLevel);
          towerContracts.set(c.name, c);
          towerMeta.set(c.name, { lockable: d.lockable === true, dlcLock: (d.dlcLock as number) | 0 });
        }
      })
      .catch((err) => { console.warn('towers.json unavailable — single arrow tower only:', err); });
    const projectToScreen = (pos: { x: number; y: number; z: number }, h: number) => {
      const v = toThree({ x: pos.x, y: pos.y + h, z: pos.z }, new THREE.Vector3()).project(stageCamera.camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, visible: v.z > -1 && v.z < 1 };
    };
    const S = (k: string, f: string): string => t(uiStrings, k, f);
    if (!noUi) gameUi = new GameUiFeature({
      assets: uiAssets,
      strings: () => uiStrings,
      world: () => world,
      project: projectToScreen,
      playSound: (n) => { void A()?.play(n); },
      identity: () => ({ area: S(STAGE_CFG.entry.areaName, 'Area'), stage: S(STAGE_CFG.entry.stageName, `STAGE ${STAGE_CFG.entry.stage}`), difficulty: S(DIFFICULTY_LABEL_KEYS[GAME_DIFFICULTY], ['Fun', 'Tricky', 'Mayhem'][GAME_DIFFICULTY]) }),
      screens: {
        onResume: () => shell?.hidePause(),
        onRetry: () => { sh.exit('retry'); },
        // Result screen exits (StageResultMenuController.OnConfirm -> WorldMap.LoadWorldMap = stage select).
        onStageSelect: () => { sh.exit('stageSelect'); },
        onNextStage: nextStage(STAGE_CFG.entry.stage) !== null
          ? () => { sh.exit('next'); }
          : undefined,
        onResultSfx: (k) => { if (k === 'rainbow') chibiView?.onStageClearedScreen(1, true); void A()?.play(k === 'scoreCountUp' ? 'sfx/sfx_menu_scorecount' : k === 'newRecord' ? 'sfx/sfx_menu_newscore' : 'sfx/sfx_stage_rainbowaquired'); },
        onToggleMute: () => {
          const m = !(A()?.muted ?? false);
          A()?.setMuted(m);
          save?.setMuted(m);
          return m;
        },
      },
      showResults: (d) => shell?.showResults(d),
      introOwnsCalls: () => introController?.ownsCalls ?? false,
    });
    gameUi?.attach(sessionUi);
    // The session also serves as the (not yet started) title / stage-select backdrop: the gameplay HUD
    // must not show through the menus. Revealed by the intro's HUD slide-in or, without an intro, at start.
    if (gameUi !== null) gameUi.root.el.style.visibility = 'hidden';
    // Q4.UI.CurrencyFlyerPool: gem icons fly to the HUD gem counter (Hud_02 player_gem_r plank).
    if (gameUi !== null && uiAssets !== null) currencyFlyers = new CurrencyFlyerLayer(uiAssets, gameUi.root, { x: HUD.gem.plank[0], y: HUD.gem.plank[1] });
    if (gameUi !== null) buildMenu = new BuildMenuFeature({
      assets: uiAssets,
      uiRoot: gameUi!.root,
      player: () => world!.player,
      inventory: () => world!.inventory,
      trees: () => world?.trees ?? [],
      towers: () => towerContracts,
      towerMeta: () => towerMeta,
      issue: (cmd) => world!.driver.addPlayerCommand(cmd, world!.player),
      playSound: (n) => { void A()?.play(n); },
      strings: () => uiStrings,
      project: projectToScreen,
      preview: (tree, prefab) => {
        if (tree === null || prefab === null) rangeIndicator.hide();
        else rangeIndicator.show(tree.position, prefabRangeRadius(prefab as never));
      },
      towerSelected: () => towerLevel?.interaction.selected != null,
      blocked: () => (shell?.paused ?? false) || (shell?.resultsVisible ?? false) || outcome !== null,
      singletonBuilt: (name) => {
        for (const tw of world?.core.allObjects<GameCoreTower>(GameCoreTower) ?? []) {
          if ((tw as unknown as { prefabName: string }).prefabName === name) return true;
        }
        return false;
      },
    });
    window.addEventListener('keydown', (e) => {
      // capture phase: the ring is modal and must see Escape before the shell pauses.
      if (started && !e.repeat && buildMenu?.onKey(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      // Tower upgrade/dismantle ring is modal too: Escape closes it (instead of opening the pause menu behind it).
      if (started && !e.repeat && e.code === 'Escape' && towerLevel?.ringOpen === true && towerLevel.onKey(e.code)) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, { capture: true, signal: ac.signal });
    window.addEventListener('keyup', (e) => buildMenu?.onKeyUp(e.code), { signal: ac.signal });
    hud.style.display = 'none'; // dev panels replaced by HudLayout
    waveHud.style.display = 'none';

    sh.progress(null, 'building simulation…');

    const waveResource = loadWaveResource(BUNDLE_IDX, readJson);
    // This stage's enemy + balloon-rig GLBs (CHARACTER_DEFS only covers stage 1: no GLB = invisible enemy).
    await library.loadMany(stageEnemyDefs(waveResource).filter((n) => library.get(n) === null))
      .catch((err) => { console.warn('stage enemy models failed to load:', err); });
    const stageMain = loadStageMainContract(BUNDLE_IDX, readJson);
    const towerRaw = (bundle['structures_TowerBase.json'] as Json[])[0];
    const towerPrefab = tower001Contract(towerRaw, () => towerLevel);

    // ---- sim bootstrap (mirrors headless-stage1.ts) ----
    const driver = new SimDriver();
    const core = driver.core;
    core.installFrame(core.currentFrame);
    setViewerResolver((h) => getRegisteredUnityObject(h));
    // Rapier-WASM static-collider world (terrain LoS, chibi ground-snap,
    // water checks). Loaded BEFORE the sim bootstrap so GameCoreHome's chibi
    // spawns snap onto the real terrain. Falls back to the null seam on any
    // load failure (matches the headless milestone's documented behavior).
    try {
      physicsWorld = await physicsLoad;
      setSimPhysics(createQueries(physicsWorld));
      groundConform = new GroundConform(createQueries(physicsWorld));
      // Range rings drape over the TERRAIN only (props/trees excluded).
      const terrainOnly = new GroundConform(createQueries(physicsWorld), { mask: Q4Layers.landscapeMask });
      rangeIndicator.setHeightProvider((x, z) => terrainOnly.groundHeight(x, z));
      physicsLoaded = true;
    } catch (err) {
      console.warn('physics world failed to load — null-physics fallback:', err);
      setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
      groundConform = new GroundConform(null); // miss → y=0 fallback
    }

    const treeNodes = sceneDoc.nodes.filter((n) => n.activeSelf && /^tree_\d+/.test(n.name));
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    const treePositions = treeNodes.map((n) => {
      const w = worldTransform(sceneDoc.nodes, n);
      minX = Math.min(minX, w.pos.x); maxX = Math.max(maxX, w.pos.x);
      minZ = Math.min(minZ, w.pos.z); maxZ = Math.max(maxZ, w.pos.z);
      return w.pos;
    });
    const homeNode = sceneDoc.nodes.find((n) => n.name === 'home_001' && n.parent >= 0)!;
    const homeWorld = worldTransform(sceneDoc.nodes, homeNode);
    // Original player locomotion/collision (Q4.PlayerMotor + CharacterController
    // on the static colliders) — see docs/PLAYER_BOUNDS_ANALYSIS.md. PlayerRespawnPoint
    // objects (scene layer 18) are the drown-respawn targets.
    if (physicsWorld !== null) {
      const respawnPts: [number, number, number][] = sceneDoc.nodes
        .filter((n) => n.activeSelf && /^RespawnPoint( \(\d+\))?$/.test(n.name))
        .map((n) => { const w = worldTransform(sceneDoc.nodes, n).pos; return [w.x, w.y, w.z]; });
      playerMover = new PlayerMover(physicsWorld, respawnPts);
    }
    setBoundsProvider(
      () =>
        new Bounds(
          new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
          new Vector3(maxX - minX + 40, 80, maxZ - minZ + 40),
        ),
    );

    setHomeQueryHeight(0.25); // same flat-platform knife-edge tolerance as the headless smart bot (GameCoreHome)
    setCurrentStageProvider(() => stageMain);
    setGamePreferencesProvider(() => ({ difficultySetting: GAME_DIFFICULTY }));
    setEnemyViewerFactory(createEnemyViewerFactory(library, characterRoot));
    setTowerViewerFactory(createTowerViewerFactory(library, characterRoot));
    setTowerDatabaseProvider(() => ({
      getData: (n: string) => towerContracts.get(n) ?? (n === towerPrefab.name ? towerPrefab : null),
    }));

    const trees = treePositions.map((p, i) => {
      const t = new GameCoreTree(p);
      // Species from the scene node name (425 tree_001 + 32 tree_002 on stage 1).
      const species = treeNodes[i].name.startsWith('tree_002') ? 'tree_002' : 'tree_001';
      registerUnityObject(t.handle.m_handle, treeViewer(p, species));
      treeView?.addTree(t.handle.m_handle, { x: p.x, y: p.y, z: p.z }, i, species);
      return t;
    });
    // Tower built → EVERY NatureTree whose handle is in tower.retainedTrees falls
    // (Q4.NatureTree.OnTowerBuild @0x64A680: List<GameCoreHandle>.Contains on
    // tower+0xA8), away from the tower position (see docs/TREE_SWAP_ANALYSIS.md).
    // The event fires with a null tower when no valid site exists → no fall.
    Events.towerBuildEvent.addListener(
      (tower: GameCoreTower | null) => {
        if (!tower) return;
        const tp = tower.position;
        for (const h of tower.retainedTrees) {
          treeView?.onTowerBuilt(h.m_handle, { x: tp.x, y: tp.y, z: tp.z });
        }
      },
      EventTime.Immediate,
    );
    // Tower sold → retained trees Revive(player, index) → treeReviveEvent →
    // Q4.NatureTree.OnTreeRevive @0x64A490 (TreeRise, staggered index*0.05s).
    Events.treeReviveEvent.addListener(
      (tree: GameCoreTree, _p: GameCorePlayer, index: number) => {
        treeView?.onTreeRevive(tree.handle.m_handle, index);
      },
      EventTime.Immediate,
    );

    const homeFwd = homeWorld.rot.multiplyVector(Vector3.forward);
    const homeView: HomeViewContract = {
      playerDetectionRange: 2.0,
      enemyDetectionRange: 3.0,
      kidPrefab: {},
      chibiHomeZones: [{ numChibi: 20, angleCenter: 0, angleSpread: 133, minDist: 2.02, maxDist: 2.31 }],
      transform: {
        forward: { x: homeFwd.x, y: homeFwd.y, z: homeFwd.z },
        position: { x: homeWorld.pos.x, y: homeWorld.pos.y, z: homeWorld.pos.z },
      },
      gameObject: {},
    };
    const home = new GameCoreHome(homeView);
    home.position = homeWorld.pos.clone();

    // Chibis: one chibi_00 rig per living villager (extracted from the stages
    // bundle — Chibi MB → PrefabLoader → chibi_00_pa, 13 baked clips).
    chibiView = new ChibiStageView(library, home, { linecast: physicsWorld !== null ? chibiLinecast : null });
    introChibiRig = () => (library.get('chibi_00') !== null ? library.instantiate('chibi_00') : null);
    characterRoot.add(chibiView.root);
    // Chibis keep the GLB's Standard (PBR) material — original reference renders show no black rim and no cel bands.
    // Q4.Home.Update -> ChibiCollisions: the VIEW solver decides where each chibi stands (scatter from the player,
    // keep out of the hut, avoid enemies); the ChibiMotors then run to the DestPos it writes.
    const chibiSolver = new HomeChibiSolver({ homePos: { x: homeWorld.pos.x, y: homeWorld.pos.y, z: homeWorld.pos.z }, ...HOME_001_CONFIG });
    const solverQuery = chibiSolver.playerQuery();
    chibiView.setSolver({
      update: (dt, motors) => {
        // AllObjects<GameCorePlayer>(home, Cylinder(MaxDist*1.5, 2.0)) -> view positions of players that have a viewer.
        const players: V3[] = [];
        const pv = playerView?.root.position ?? playerMesh?.position ?? null;
        if (pv !== null) {
          const up = { x: -pv.x, y: pv.y, z: pv.z }; // three -> unity
          if (Math.hypot(up.x - solverQuery.center.x, up.z - solverQuery.center.z) <= solverQuery.radius
              && Math.abs(up.y - solverQuery.center.y) <= solverQuery.height) players.push(up);
        }
        chibiSolver.update(dt, motors, players, home.isEnemyClose, (id) => {
          const d = home.getChibiDataById(id);
          return d === null ? null : { pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z }, yawDeg: quatYawDegOf(d.rot) };
        });
      },
    });
    // UnityEvents.chibiAvoidanceZoneEvent (raised by GameCoreEnemy.CanAttack) -> Q4.Home.OnChibiAvoidanceZone.
    setChibiAvoidanceZoneNotifier((pos, radius, dur) => { chibiSolver.addAvoidanceZone({ x: pos.x, y: pos.y, z: pos.z }, radius, dur); });
    // Death: the enemyAttackedHomeEvent carries the dying ChibiData (stable
    // id — m_chibisActive removes the dead, so index mapping is unsafe).
    Events.enemyAttackedHomeEvent.addListener(
      (_e: GameCoreEnemy, _h: GameCoreHome, chibi: ChibiData) => {
        chibiView?.onChibiDying(chibi);
      },
      EventTime.Immediate,
    );

    const player = new GameCorePlayer();
    player.playerId = 1;
    player.position = homeWorld.pos.add(new Vector3(3, 0, 3));

    const inventory = GameCoreInventory.getInventoryObject()!;
    const waveManager = new GameCoreWaveManager(headlessWaveManagerView(BUNDLE_IDX, readJson));

    world = {
      driver, core, player, home, inventory, waveManager, trees, towerPrefab,
      waveCount: waveResource.waveDataList.length,
    };

    // Player: real tikiman_01 rig (extracted from globalsettings — see
    // PlayerStageView header); capsule fallback if the def failed to load.
    const tikimanRig = library.get('tikiman_01') !== null ? library.instantiate('tikiman_01') : null;
    if (tikimanRig !== null) {
      playerView = new PlayerStageView(tikimanRig, {
        mask: library.get('mask_00') !== null ? library.instantiate('mask_00') : undefined,
        carapace: library.get('carapace_00') !== null ? library.instantiate('carapace_00') : undefined,
      });
      characterRoot.add(playerView.root);
      outline(playerView.root);
      toon(playerView.root);
      playerMesh = playerView.root;
    } else {
      console.warn('tikiman_01 def missing — capsule placeholder');
      const capsule = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 0.7, 4, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8572a, roughness: 0.7 }),
      );
      capsule.castShadow = true;
      capsule.name = 'tikiman-placeholder';
      characterRoot.add(capsule);
      playerMesh = capsule;
    }

    // Pre-link every shader program for the scene as it stands (KHR_parallel_shader_compile when
    // available) so the first frames after START don't stall on synchronous program links.
    sh.progress(null, 'compiling shaders…');
    try { await renderer.compileAsync(scene, stageCamera.camera); } catch { /* cosmetic */ }
    sh.progress(100, 'ready');
    // Audio (37MB of WAV) only plays after the START gesture: fetch the bytes NOW at low priority,
    // after everything critical, so they are ready (and don't compete) by the time the player clicks.
    prefetchLoose([BGM_STAGE, ...SFX_NAMES].map((n) => `/assets/audio/${n}.wav`));
  }

  // ---- teardown ------------------------------------------------------------------------------
  // Order: input/UI first (stop new work), sim-bound views, GPU pipeline, then the sim globals.
  // Each step is isolated: a failure in one must not leak the rest.
  /** Free the per-rig bone textures (three keeps one float DataTexture per skeleton once rendered). */
  function freeSkeletons(root: THREE.Object3D): void {
    root.traverse((o) => {
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if (sk !== undefined && sk !== null) sk.dispose();
    });
  }

  function safe(label: string, fn: () => void): void {
    try { fn(); } catch (err) { console.warn(`stage dispose: ${label} failed`, err); }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    safe('listeners', () => ac.abort());
    safe('intro', () => { introController?.dispose(); introController = null; introCardRef?.root.detach(); introCardRef = null; });
    safe('touch', () => { touch?.detach(); touch = null; });
    safe('shell', () => { shell?.detach(); shell = null; });
    safe('ui', () => { gameUi?.dispose(); gameUi = null; buildMenu = null; currencyFlyers = null; sessionUi.remove(); });
    safe('enemyViewSystem', () => { enemyViewSystem?.dispose(); enemyViewSystem = null; });
    safe('camera', () => stageCamera.detach());
    safe('audio', () => { A()?.stopBgm(); A()?.stopAllLoops(); });
    // SkinnedMesh bone textures (float DataTextures) are not freed by geometry/material disposal.
    safe('skeletons', () => freeSkeletons(characterRoot));
    safe('enemy views', () => {
      for (const t of enemyViews.values()) { dropOutline(t.view.root); dropToon(t.view.root); t.view.dispose(); }
      enemyViews.clear();
    });
    safe('tower views', () => {
      for (const t of towerViews.values()) { dropOutline(t.view.root); dropToon(t.view.root); t.view.dispose(); }
      towerViews.clear();
    });
    safe('pickup drops', () => { pickupDrops?.dispose(); pickupDrops = null; });
    safe('projectiles', () => { projectileViewer?.dispose(); projectileViewer = null; });
    safe('tower flags', () => { setTowerFlagFactory(null); });
    safe('chibi avoidance', () => { setChibiAvoidanceZoneNotifier(null); });
    safe('chibis', () => { if (chibiView !== null) { dropOutline(chibiView.root); dropToon(chibiView.root); chibiView.dispose(); chibiView = null; } });
    safe('player', () => { if (playerView !== null) { dropOutline(playerView.root); dropToon(playerView.root); playerView.dispose(); playerView = null; } });
    safe('trees', () => { treeView?.dispose(); treeView = null; });
    safe('grass', () => { grassView?.dispose(); grassView = null; });
    safe('weather', () => { weatherView?.dispose(); weatherView = null; });
    safe('pickups', () => { pickupView?.dispose(); pickupView = null; });
    safe('outline/toon', () => {
      for (const h of outlineHandles.values()) h.dispose();
      outlineHandles.clear();
      for (const h of toonHandles.values()) h.dispose();
      toonHandles.clear();
    });
    safe('range', () => rangeIndicator.dispose());
    safe('selection outline', () => { selOutline?.h.dispose(); selOutline = null; });
    safe('mesh particles', () => { setMeshParticles(null); meshParticles?.dispose(); meshParticles = null; });
    safe('particles', () => { particles.dispose(); projectileParticles?.dispose(); projectileParticles = null; });
    safe('stage view', () => { stageViewRef?.dispose(); stageViewRef = null; });
    safe('water pass', () => waterPass.dispose());
    safe('sky', () => sky.dispose());
    safe('reflection probe', () => { stageProbeTexture?.dispose(); stageProbeTexture = null; });
    safe('ambient', () => stageAmbient.dispose());
    // Catch-all for anything still reachable from the scene (character rigs, stragglers) + loader templates.
    safe('scene sweep', () => { disposeObject3D(scene); scene.clear(); scene.environment = null; scene.background = null; });
    safe('templates', () => { for (const o of ownedTemplates) disposeObject3D(o); ownedTemplates.length = 0; });
    safe('library', () => { libraryRef?.dispose(); libraryRef = null; });
    safe('physics', () => { physicsWorld?.world.free(); physicsWorld = null; playerMover = null; groundConform = null; });
    safe('sim globals', () => { setEnemyGroundProbe(null); resetSimGlobals(); });
    world = null;
    (window as unknown as Record<string, unknown>).__amb = undefined;
  }

  try {
    await boot();
  } catch (err) {
    dispose();
    throw err;
  }

  return {
    stageId: STAGE_CFG.entry.scene,
    stage: STAGE_CFG.entry.stage,
    difficulty: GAME_DIFFICULTY,
    get started() { return started; },
    get disposed() { return disposed; },
    get world() { return world; },
    debug,
    start() { if (!disposed) start(); },
    frame,
    resize(aspect: number) { stageCamera.resize(aspect); },
    dispose,
    counters: () => ({
      particlesAlive: (particles?.alive ?? 0) + (projectileParticles?.alive ?? 0),
      enemyViews: enemyViews.size,
      towerViews: towerViews.size,
      overlays: sessionUi.isConnected ? sessionUi.children.length : 0,
    }),
  };
}
