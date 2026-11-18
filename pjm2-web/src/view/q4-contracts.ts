// src/view/q4-contracts.ts
// Structural stand-ins for the Q4 (presentation-layer) types that the SIM
// reads during headless play (porting convention §8). Each interface lists
// only the fields the sim actually consumes, with their original offsets from
// dump.cs. The real Three.js-backed viewers (Phase 3) implement these; tests
// provide plain-object fakes via the provider hooks below.

// ---- Q4.StageMain (dump.cs; sim reads the initial-economy fields) ----
export interface StageMainContract {
  initCoin: number; // StageMain.m_initCoin
  initGem: number; // StageMain.m_initGem
  initWaveCoinRate: number; // StageMain.m_initWaveCoinRate
  initWaveTimeRate: number; // StageMain.m_initWaveTimeRate (wave-clear time bonus)
}

let currentStageProvider: (() => StageMainContract | null) | null = null;
/** C#: Q4.StageMain.CurrentStage static. */
export function setCurrentStageProvider(p: () => StageMainContract | null): void {
  currentStageProvider = p;
}
export function getCurrentStage(): StageMainContract | null {
  return currentStageProvider ? currentStageProvider() : null;
}

// ---- Q4.MonstersAudio (buff SFX; sim calls it through Buff.PlaySFX/StopSFX) ----
// C#: Buff holds a UnityEngine.AudioSource and calls
// MonstersAudio.Instance.PlaySFXMonitored(clip, pos, source) /
// StopSFX(source) / source.transform.position = pos. Headless: provider is
// null → sound operations no-op (sim state never depends on audio).
export interface AudioSourceContract {
  setPosition(pos: { x: number; y: number; z: number }): void;
}
export interface MonstersAudioContract {
  playSFXMonitored(clip: unknown, pos: { x: number; y: number; z: number }, source: AudioSourceContract | null): AudioSourceContract | null;
  stopSFX(source: AudioSourceContract): void;
  /** C#: MonstersAudio.Instance.PlaySFX — two overloads:
   *  PlaySFX(GlobalSounds.X, position, bool) and PlaySFX(sounds.Land, bool).
   *  TS ADAPTATION: union second param (Vector3Like = positional, boolean =
   *  the 2-arg overload). Clip identifiers are GlobalSounds property names
   *  (strings) until the audio manifest wiring (Phase 4). */
  playSFX(clip: unknown, posOrFlag: Vector3Like | boolean, x?: boolean): void;
}
let monstersAudioProvider: (() => MonstersAudioContract | null) | null = null;
export function setMonstersAudioProvider(p: () => MonstersAudioContract | null): void {
  monstersAudioProvider = p;
}
export function getMonstersAudio(): MonstersAudioContract | null {
  return monstersAudioProvider ? monstersAudioProvider() : null;
}

// ---- Q4.Networking.NetworkMatch (out-of-scope online; SP = always false) ----
export const NetworkMatch = {
  /** C#: Q4.Networking.NetworkMatch.IsNetworkMatch — single-player: false. */
  get isNetworkMatch(): boolean {
    return false;
  },
};
/** C#: Q4.Networking.NetworkMatch.Instance (null in SP). */
export interface NetworkMatchInstanceContract {
  localPlayerId: number; // NetworkMatch.LocalPlayerId
}
let networkMatchInstanceProvider: (() => NetworkMatchInstanceContract | null) | null = null;
export function setNetworkMatchInstanceProvider(
  p: (() => NetworkMatchInstanceContract | null) | null,
): void {
  networkMatchInstanceProvider = p;
}
export function getNetworkMatchInstance(): NetworkMatchInstanceContract | null {
  return networkMatchInstanceProvider ? networkMatchInstanceProvider() : null;
}

// ---- shared structural helpers ------------------------------------------------
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}
/** C#: UnityEngine.GameObject (only the members the sim touches). */
export interface GameObjectContract {
  activeSelf: boolean;
  setActive(value: boolean): void;
}

// ---- Q4.StageHub / Q4.PickupManager (hidden tree pickups + fruit drops) ---------
// C#: Q4.StageHub.GetCurrentStage() returns the RUNNING stage (distinct from
// Q4.StageMain.CurrentStage, the data asset above); its pickupManager holds the
// hidden-pickup/fruit tables and spawns physical pickups/fruits.
import type { BoundsLike } from '../core/Cylinder';
import type { GameCoreHandle } from '../core/GameCoreHandle';

/** C#: Q4.PickupManager.HiddenPickupData. `type` is a raw
 *  GameCoreInventory.EInventoryType value (view side stores the int). */
export interface HiddenPickupData {
  type: number;
  amount: number;
}
/** C#: Q4.PickupManager.HiddenFruitData — scheduled fruit drop (time = int
 *  seconds, +0x1C); the rest of the record is passed through to CreateFruit.
 *  SpawnFruitCommand reuses this record as the CreateFruit parameter bundle
 *  (fruitPrefab + amount + time), so those fields are optional here. */
export interface HiddenFruitData {
  time: number;
  fruitPrefab?: unknown; // C#: Q4.Fruit component off the definition prefab
  amount?: number;
}
/** C#: Q4.PickupMovement — serialized movement tuning on pickup prefabs and
 *  tree views; the sim copies these into its bounce/attract state. */
export interface PickupMovementContract {
  appearForceMin: number;
  appearForceMax: number;
  appearRangeAngle: number; // degrees (scatter cone around a random horizontal axis)
  acceleration: number;
  bouncingRate: number;
  bounceTime: number; // C# int → float on copy; -1 = unlimited bounces
  attractOffset: Vector3Like; // +0x38
}
export interface PickupManagerContract {
  hiddenPickupData: HiddenPickupData[]; // Q4.PickupManager.hiddenPickupData (List)
  createPickup(
    data: HiddenPickupData,
    position: Vector3Like,
    movement: PickupMovementContract | null,
  ): unknown;
  // ---- members read by GameCorePickupManager (iter 13; optional because the
  // StageHub-side consumers above only read the pickup half) ----
  hiddenFruitData?: HiddenFruitData[]; // view +0x30 (FAITHFUL: NRE if missing when used)
  maximumFruitsOnGround?: number; // view +0x2C
  fruitTreeHandleList?: GameCoreHandle[]; // copied into the sim list on first tick
  createFruit?(
    data: HiddenFruitData,
    position: Vector3Like,
    movement: PickupMovementContract | null,
  ): unknown;
  gameObject?: unknown; // RecreateViewer
}
export interface StageHubContract {
  pickupManager: PickupManagerContract; // Q4.StageHub.pickupManager
}
let stageHubProvider: (() => StageHubContract | null) | null = null;
/** C#: Q4.StageHub.GetCurrentStage() static. Headless default: null. */
export function setStageHubProvider(p: (() => StageHubContract | null) | null): void {
  stageHubProvider = p;
}
export function getStageHubCurrentStage(): StageHubContract | null {
  return stageHubProvider ? stageHubProvider() : null;
}

// ---- Q4.NatureTree (tree viewer; GameCoreTree.RecreateViewer + hidden pickups) ----
export interface HiddenTreePickupContract {
  hiddenPickupData: HiddenPickupData | null; // Q4.HiddenTreePickup.hiddenPickupData
}
export interface NatureTreeViewContract {
  playerDetectionRange: number; // Q4.Structure.playerDetectionRange (+0x20)
  towerDirection: Vector3Like; // Q4.NatureTree.towerDirection (+0x74) — seeds tower body/fort direction
  /** TS ADAPTATION of Unity GetComponent<Q4.PickupMovement>(). */
  getComponentPickupMovement(): PickupMovementContract | null;
  /** TS ADAPTATION of Unity gameObject.GetComponent<Q4.HiddenTreePickup>(). */
  getHiddenTreePickup(): HiddenTreePickupContract | null;
  transform: { position: Vector3Like };
  gameObject: GameObjectContract;
}
let allTreesInSceneProvider: (() => NatureTreeViewContract[] | null) | null = null;
/** C#: Q4.NatureTree.allTreesInScene static list. Headless default: null. */
export function setAllTreesInSceneProvider(
  p: (() => NatureTreeViewContract[] | null) | null,
): void {
  allTreesInSceneProvider = p;
}
export function getAllTreesInScene(): NatureTreeViewContract[] | null {
  return allTreesInSceneProvider ? allTreesInSceneProvider() : null;
}

// ---- Q4.Player (player viewer; GameCorePlayer.RecreateViewer) -------------------
export interface PlayerViewContract {
  playerID: number; // Q4.Player.playerID
  transform: { position: Vector3Like };
  gameObject: unknown;
}
/** C#: the Q4.Player view fields read by HipAttackEnemyCommand — the player's
 *  attack typing lives on the VIEW prefab (raw field reads 0x1C/0x20/0x18 in
 *  the binary). A real view always has them; the duck-type cast in the command
 *  keeps this a structural check. */
export interface PlayerCombatViewContract extends PlayerViewContract {
  strengthType: EEnemyStrengthTypeDef; // Q4.Player +0x1C
  classType: EEnemyClassTypeDef; // Q4.Player +0x20
  oneKickOneBalloon: boolean; // Q4.Player +0x18
}
/** C#: Q4.Player.Motor (+ StateMachine) — read by PickupFruitCommand's
 *  ForcePlayerViewDropFruit (view-desync reset path). */
export interface PlayerMotorViewContract {
  dropFruit(): void; // Motor.DropFruit()
  stateMachine: {
    forceCurrentCommand(state: unknown, arg: unknown): void; // TikimanStateMachine.ForceCurrentCommand
  } | null;
}
export interface PlayerFruitViewContract extends PlayerViewContract {
  motor: PlayerMotorViewContract | null; // Q4.Player.Motor
}
let playerViewsFinder: (() => PlayerViewContract[]) | null = null;
/** C#: Object.FindObjectsOfType<Q4.Player>(). Headless default: empty. */
export function setPlayerViewsFinder(p: (() => PlayerViewContract[]) | null): void {
  playerViewsFinder = p;
}
export function getPlayerViews(): PlayerViewContract[] {
  return playerViewsFinder ? playerViewsFinder() : [];
}

// ---- Q4.BuffSetting* (buff tuning data handed to the sim buff ctors) -------------
// C#: UnityEngine.Object-derived settings assets; BuffBomb fake-null-checks its
// setting, BuffSlow/BuffFastPlayer null-check (NRE if null). TS: plain data
// contracts; the data layer (Phase 2) fills them from extracted assets.
import type { EEnemyClassTypeDef, EEnemyMoveTypeDef, EEnemyStrengthTypeDef } from '../core/enums';

export interface BuffSettingBombContract {
  attackPower: number; // setting +0x3C
  strengthType: EEnemyStrengthTypeDef; // setting +0x40
  classType: EEnemyClassTypeDef; // setting +0x44
}
export interface BuffSettingSlowContract {
  enemySpeedScale: number; // setting +0x34
  playerSpeedScale: number; // setting +0x38
}
export interface BuffSettingFastPlayerContract extends BuffSettingSlowContract {
  isContinuous: boolean; // setting +0x3C
}
/** C#: Q4.BuffSettingFlare — never read by the sim ctor (opaque). */
export type BuffSettingFlareContract = unknown;
/** C#: Q4.BuffSettingTrampoline — never read by the sim ctor (opaque). */
export type BuffSettingTrampolineContract = unknown;

// ---- Q4.EnemyAttributesSettings (damage/reaction tables on the enemy view) -------
// C#: component on the enemy's collider GameObject; DamageHelper resolves it via
// Q4.GameCoreBridge.Instance.GetUnityObject(handle).GetComponent<...>(). TS: the
// viewer object returned by the handle's viewer resolver implements this.
/** C#: Q4.StrengthDamageInfo (serializable struct). */
export interface StrengthDamageInfo {
  strength: EEnemyStrengthTypeDef;
  damageTime: number; // damage multiplier ("strong" = > 1)
  reactionTime: number; // reaction multiplier
}
/** C#: Q4.ClassDamageInfo (serializable struct). */
export interface ClassDamageInfo {
  classType: EEnemyClassTypeDef;
  damageTime: number;
  reactionTime: number;
}
export interface EnemyAttributesSettingsContract {
  strengthDamageInfos: StrengthDamageInfo[];
  classDamageInfos: ClassDamageInfo[];
  /** C#: EnemyAttributesSettings.HasShieldEffect (used by GetEnemyOnHitSound). */
  hasShieldEffect(classType: EEnemyClassTypeDef): boolean;
}
export interface EnemyViewContract {
  /** TS ADAPTATION of Unity GetComponent<EnemyAttributesSettings>(). */
  getComponentEnemyAttributesSettings(): EnemyAttributesSettingsContract | null;
}

// ---- Q4.UI.Debug.DebugMenuCanvas (debug overrides the sim reads) ----
export interface DebugMenuCanvasContract {
  disableGameOver: boolean; // field @0x1A
  towerEXPRate: number; // field @0x28
  damageRate: number; // enemy damage debug multiplier
}
let debugCanvasProvider: (() => DebugMenuCanvasContract | null) | null = null;
/** C#: Q4.UI.Debug.DebugMenuCanvas.canvasInstance static. */
export function setDebugCanvasProvider(p: () => DebugMenuCanvasContract | null): void {
  debugCanvasProvider = p;
}
export function getDebugCanvas(): DebugMenuCanvasContract | null {
  return debugCanvasProvider ? debugCanvasProvider() : null;
}

// ---- Q4.Pickup prefabs + viewers (GameCorePickup ctor) ---------------------------
// C#: the ctor instantiates the Q4.Pickup prefab (Object.Instantiate), links it
// via GameCoreBridge.SetUnityObject(handle, viewer), then reads components off
// the viewer. TS ADAPTATION: the prefab is a serialized-data contract (Phase-2
// extraction fills it); the viewer factory hook returns the presentation shell.
// The browser registers a real Three.js-backed factory; headless runs use the
// built-in stub that derives the contract from the prefab record itself (the
// ctor reads the same values either way).
export interface PickupLifeCycleContract {
  lifespan: number; // Q4.PickupLifeCycle.lifespan (negative = immortal)
}
export interface MeshFilterContract {
  sharedMesh: { bounds: BoundsLike } | null;
}
export interface PickupPrefabContract {
  name: string; // UnityEngine.Object.name
  detectRange: number; // prefab +0x18
  detectDelay: number; // prefab +0x1C
  /** Q4.PickupCurrency.value (+0x3C) — present only on currency prefabs
   *  (C# `prefab as Q4.PickupCurrency` type test → structural presence check). */
  value?: number;
  movement?: PickupMovementContract | null; // serialized PickupMovement
  lifespan?: number; // serialized PickupLifeCycle.lifespan
  meshBounds?: BoundsLike | null; // child MeshFilter.sharedMesh.bounds
}
export interface PickupViewerContract {
  /** TS ADAPTATION of Unity GetComponent<Q4.PickupMovement>(). */
  getComponentPickupMovement(): PickupMovementContract | null;
  /** TS ADAPTATION of Unity GetComponent<Q4.PickupLifeCycle>(). */
  getComponentPickupLifeCycle(): PickupLifeCycleContract | null;
  /** TS ADAPTATION of Unity gameObject.GetComponentInChildren<MeshFilter>(). */
  getComponentInChildrenMeshFilter(): MeshFilterContract | null;
  gameObject: GameObjectContract;
}

function defaultHeadlessPickupViewer(prefab: PickupPrefabContract): PickupViewerContract {
  return {
    getComponentPickupMovement: () => prefab.movement ?? null,
    getComponentPickupLifeCycle: () =>
      prefab.lifespan !== undefined ? { lifespan: prefab.lifespan } : null,
    getComponentInChildrenMeshFilter: () =>
      prefab.meshBounds != null ? { sharedMesh: { bounds: prefab.meshBounds } } : null,
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

let pickupViewerFactory:
  | ((prefab: PickupPrefabContract, handleId: number) => PickupViewerContract | null)
  | null = null;
/** C#: Object.Instantiate(prefab) — the browser factory also performs the
 *  bridge SetUnityObject linking internally if it needs to. */
export function setPickupViewerFactory(
  f: ((prefab: PickupPrefabContract, handleId: number) => PickupViewerContract | null) | null,
): void {
  pickupViewerFactory = f;
}
export function instantiatePickupViewer(
  prefab: PickupPrefabContract,
  handleId: number,
): PickupViewerContract | null {
  if (pickupViewerFactory !== null) return pickupViewerFactory(prefab, handleId);
  return defaultHeadlessPickupViewer(prefab);
}

// ---- Q4.GameCoreBridge.SetUnityObject / GetUnityObject registry ------------------
// C#: the bridge keeps a handle→GameObject map written by SetUnityObject and
// read by GetUnityObject. TS: this registry + the GameCoreHandle viewer
// resolver hook. Drivers/tests wire:
//   setViewerResolver((h) => getRegisteredUnityObject(h))
// (chain with extra fakes as needed).
const unityObjectRegistry = new Map<number, unknown>();
/** C#: Q4.GameCoreBridge.Instance.SetUnityObject(handle, viewer). */
export function registerUnityObject(handleId: number, viewer: unknown): void {
  unityObjectRegistry.set(handleId, viewer);
}
export function getRegisteredUnityObject(handleId: number): unknown | null {
  return unityObjectRegistry.get(handleId) ?? null;
}
export function resetUnityObjectRegistryForTests(): void {
  unityObjectRegistry.clear();
}
/** Registry size (disposal audit / probes). */
export function unityObjectCount(): number {
  return unityObjectRegistry.size;
}

// ---- Q4.AISettings (global settings container) -----------------------------------
// C#: Q4.AISettings.PickupWaterKillTime static getter @0x00729260 reads the
// GlobalSettingsContainer<AISettings> instance (+0x1C).
// VERIFIED DEFAULT (data lane, iter 13): globalsettings bundle,
// Assets/GlobalSettings/AISettings.asset, pathId -2994841570289042843 —
// serialized m_PickupWaterKillTime = 5.0 (overrides the ctor default 2.0),
// m_OvertakeSlowerEnemies = true, m_EnableEnemyBlocking = true.
// Source: decomp/data/globalsettings_AISettings.json (type-tree extraction).
export interface AISettingsContract {
  pickupWaterKillTime: number;
  overtakeSlowerEnemies: boolean;
  enableEnemyBlocking: boolean;
}
const VERIFIED_AI_SETTINGS: AISettingsContract = {
  pickupWaterKillTime: 5.0,
  overtakeSlowerEnemies: true,
  enableEnemyBlocking: true,
};
let aiSettingsProvider: (() => AISettingsContract | null) | null = null;
export function setAISettingsProvider(p: (() => AISettingsContract | null) | null): void {
  aiSettingsProvider = p;
}
export function getAISettings(): AISettingsContract {
  const s = aiSettingsProvider ? aiSettingsProvider() : null;
  return s ?? VERIFIED_AI_SETTINGS;
}

// ---- Q4.GlobalSettingsContainer<Q4.DifficultySettings> ----------------------------
// C#: DifficultySettings.ValueCoinByDifficulty @0x007f64f0 =
//   Mathf.Max(1, (int)(amount * multiplayer.coinValueRate * difficulty[pref].coinValueRate))
// The provider stands in for GamePreferences difficulty selection (Phase 4).
// SP DEFAULT (data-verified): globalsettings_DifficultySettings.json →
// multiplayerSettings[0].coinValueRate = 1.0 and difficultySettings[0].
// coinValueRate = 1.0 → Max(1, amount).
export interface DifficultySettingsContract {
  valueCoinByDifficulty(value: number): number;
  /** C#: DifficultySettings.EnemyHPByDifficulty @0x007f6780 =
   *  Mathf.Max(1, (int)(difficulty.enemyHPRate * value * multiplayer.enemyHPRate)). */
  enemyHPByDifficulty(value: number): number;
  /** C#: DifficultySettings.TowerBuildTimeByDifficulty @0x007f6xxx =
   *  difficulty.towerBuildTimeRate * value * multiplayer.towerBuildTimeRate (float). */
  towerBuildTimeByDifficulty(value: number): number;
  /** C#: DifficultySettings.EnemyToSpawnByDifficulty (Q4.DifficultySettings.c) =
   *  Mathf.Max(1, Mathf.RoundToInt(num * difficulty.enemyAmountRate *
   *  multiplayer.enemyAmountRate)) — VERIFIED from the raw decompilation. */
  enemyToSpawnByDifficulty(num: number): number;
}
let difficultySettingsProvider: (() => DifficultySettingsContract | null) | null = null;
export function setDifficultySettingsProvider(
  p: (() => DifficultySettingsContract | null) | null,
): void {
  difficultySettingsProvider = p;
}
export function getValueCoinByDifficulty(value: number): number {
  const ds = difficultySettingsProvider ? difficultySettingsProvider() : null;
  if (ds !== null) return ds.valueCoinByDifficulty(value) | 0;
  return Math.max(1, value | 0);
}
/** SP DEFAULT (data-verified): globalsettings_DifficultySettings.json →
 *  difficultySettings[0].enemyHPRate = 0.8999999761581421 (f32 0.9),
 *  multiplayerSettings[0].enemyHPRate = 1.0 → Max(1, trunc(0.9 × value)). */
export function getEnemyHPByDifficulty(value: number): number {
  const ds = difficultySettingsProvider ? difficultySettingsProvider() : null;
  if (ds !== null) return ds.enemyHPByDifficulty(value) | 0;
  const f = Math.fround;
  return Math.max(1, Math.trunc(f(f(f(0.8999999761581421) * value) * 1.0)));
}
/** SP DEFAULT (data-verified): difficultySettings[0].towerBuildTimeRate = 1.0,
 *  multiplayerSettings[0].towerBuildTimeRate = 1.0 → identity. */
export function getTowerBuildTimeByDifficulty(value: number): number {
  const ds = difficultySettingsProvider ? difficultySettingsProvider() : null;
  if (ds !== null) return ds.towerBuildTimeByDifficulty(value);
  const f = Math.fround;
  return f(f(1.0 * value) * 1.0);
}
/** SP DEFAULT (data-verified): Medium enemyAmountRate = 1.0 × multiplayer 1.0
 *  → Max(1, RoundToInt(num)) = num for integral inputs. Mathf.RoundToInt is
 *  round-half-to-EVEN. */
export function getEnemyToSpawnByDifficulty(num: number): number {
  const ds = difficultySettingsProvider ? difficultySettingsProvider() : null;
  if (ds !== null) return ds.enemyToSpawnByDifficulty(num) | 0;
  const f = Math.fround;
  const x = f(f(num * 1.0) * 1.0);
  const r = Math.round(x); // integral inputs make half-to-even moot; provider handles rates
  return Math.max(1, r);
}

// ---- Object.FindObjectOfType<Q4.PickupManager> (GameCorePickupManager) -------------
let pickupManagerViewFinder: (() => PickupManagerContract | null) | null = null;
export function setPickupManagerViewFinder(
  p: (() => PickupManagerContract | null) | null,
): void {
  pickupManagerViewFinder = p;
}
export function findPickupManagerView(): PickupManagerContract | null {
  return pickupManagerViewFinder ? pickupManagerViewFinder() : null;
}

// ---- Q4.CatmullCurve (enemy path spline; CorePathMove wraps it) ---------------------
// The full CatmullCurve math port lands with the enemy-movement iteration
// (decompiled/Q4.CatmullCurve.c is available); CorePathMove is ported against
// this structural contract now.
export interface CatmullCurveContract {
  id: number; // CatmullCurve.ID
  curveLength: number;
  curveLengthB4Activation: number;
  sampleLinearDistance(distance: number): Vector3Like;
  /** Incremental search from lastTime (-1 = fresh). */
  distanceToTime(distance: number, lastTime: number): number;
  sampleDirect(time: number, sideOffset: number): Vector3Like;
  sampleVelDirect(time: number): Vector3Like;
  nodeTimeToDistance(time: number): number;
}

// ---- Q4.AttackPointSetting (enemy weak-point tuning; data table exists:
//      decomp/data/enemies_AttackPointSetting.json) -----------------------------------
export interface AttackPointSettingContract {
  moveTypeOverride: EEnemyMoveTypeDef;
  afterAirPoints: boolean;
}

// ---- Q4.EnemyBase (enemy prefab tuning + instantiated viewer) ----------------------
// C#: the enemy spawn ctor reads tuning off the EnemyBase prefab, instantiates the
// view, finds the "Character"-tagged model transform, and takes collision from its
// renderer bounds. TS: prefab = data contract; viewer = presentation shell from the
// factory hook (browser: Three.js-backed; tests: fakes; unset → null → the ctor's
// faithful early-out path).
import type { EBossType, ESpawnMode } from '../core/enums';

export interface BalloonContract {
  balloonsRemaining: number; // Q4.Balloon.BalloonsRemaining
  hp: number; // Q4.Balloon.hp
  gameObject: unknown;
}
export interface EnemyAttackPointViewContract {
  /** C#: pointView.GetComponent<Collider>() cast to SphereCollider → radius;
   *  null when no collider (ctor defaults radius 0.5). */
  getComponentSphereColliderRadius(): number | null;
  transform: { localPosition: Vector3Like };
  getComponentAttackPointSetting(): AttackPointSettingContract | null;
  /** C#: pointView.GetComponent<EnemyAttributesSettings>() — per-point
   *  damage tables read by GameCoreEnemy.DealDamage. */
  getComponentEnemyAttributesSettings(): EnemyAttributesSettingsContract | null;
}
export interface CharacterTransformContract {
  gameObject: {
    /** C#: charTransform.gameObject.GetComponentInChildren<Renderer>().bounds */
    getComponentInChildrenRenderer(): { bounds: BoundsLike } | null;
  };
}
export interface EnemyViewerContract {
  transform: { position: Vector3Like; rotation: { x: number; y: number; z: number; w: number } };
  gameObject: unknown;
  getComponentInChildrenBalloon(): BalloonContract | null;
  /** TS ADAPTATION of GameObjectHelper.FindTransformWithTag(go, Tags.Character). */
  findTransformWithTag(tag: string): CharacterTransformContract | null;
  /** C#: EnemyBase.AttackPoints() — the weak-point child GameObjects. */
  attackPoints(): EnemyAttackPointViewContract[] | null;
  // Slope-movement tuning (StateWalk reads these off the view instance):
  isSlopeMovement: boolean; // view.IsSlopeMovement
  slopeDownSpeedScale: number; // view.SlopeDownSpeedScale
  slopeDownAngle: number; // view.SlopeDownAngle
  slopeUpSpeedScale: number; // view.SlopeUpSpeedScale
  slopeUpAngle: number; // view.SlopeUpAngle
  /** C#: the enemy GameObject's GetComponent<EnemyAttributesSettings>() —
   *  DamageHelper's target overloads read the body damage tables from here. */
  getComponentEnemyAttributesSettings(): EnemyAttributesSettingsContract | null;
}
export interface EnemyBaseContract {
  name: string;
  speed: number;
  fireSpeed: number;
  balloonSpeed: number;
  collisionScaleH: number;
  collisionScaleV: number;
  lowHPThreshold: number; // view.LowHPThreshold
  lowHPSpeed: number; // view.LowHPSpeed
  damagedHpThreshold: number; // view.DamagedHpThreshold
  maxLife: number;
  spawnMode: ESpawnMode;
  enemyMoveType: EEnemyMoveTypeDef;
  balloonAccScale: number; // view.BalloonAccScale
  balloonDamping: number; // view.BalloonDamping
  balloonHeight: number; // view.BalloonHeight
  balloonSpawnHeight: number; // view.BalloonSpawnHeight
  balloonTargetHeight: number; // view.BalloonTargetHeight
  groundOffsetY: number;
  drownDepth: number; // view.DrownDepth
  isBoss: boolean; // view.IsBoss
  isJumpingBoss: boolean;
  bossType: EBossType; // view.BossType
  bossRestDur: number; // view.BossRestDur
  bossJumpDur: number; // view.BossJumpDur
  attackFreq: number; // view.AttackFreq
  bossAttackDur: number;
  bossAttackDist: number;
  bossAttackHeightForward: number;
  bossAttackHeightBack: number;
  bossSpawnWaitDur: number; // view.BossSpawnWaitDur
  sounds: unknown; // AudioEventHandler.Sounds (opaque until audio iteration)
  chibiAvoidRadius: number; // view.ChibiAvoidRadius (read for BOTH radius+dur — faithful quirk)
  expValue: number; // EnemyBase.expValue @0x28 (EXP banked by the killing tower)
}
let enemyViewerFactory:
  | ((prefab: EnemyBaseContract, handleId: number, position: Vector3Like) => EnemyViewerContract | null)
  | null = null;
/** C#: Object.Instantiate(enemyPrefab, position, Quaternion.identity) +
 *  GameCoreBridge.SetUnityObject. Headless default: null (ctor early-outs). */
export function setEnemyViewerFactory(
  f: ((prefab: EnemyBaseContract, handleId: number, position: Vector3Like) => EnemyViewerContract | null) | null,
): void {
  enemyViewerFactory = f;
}
export function instantiateEnemyViewer(
  prefab: EnemyBaseContract,
  handleId: number,
  position: Vector3Like,
): EnemyViewerContract | null {
  return enemyViewerFactory !== null ? enemyViewerFactory(prefab, handleId, position) : null;
}

// ---- Q4.Fruit (throwable consumable prefab/viewer) + BuffSetting -------------------
import type { GameCoreObject } from '../core/GameCoreObject';

/** C#: Q4.BuffSetting component carried by fruit viewers — triggerTarget
 *  flags (EBuffTriggerTarget) + AddBuff(source, target, extra) which creates
 *  the concrete buff on the target (view-side; Phase 3/4 wiring). */
export interface BuffSettingContract {
  triggerTarget: number;
  addBuff(source: GameCoreObject, target: GameCoreObject, extra: unknown): void;
}
/** C#: Q4.Fruit — serialized tuning + viewer component accessors on one class
 *  (prefab OR placed scene component; the ctor's isPrefab flag distinguishes). */
export interface FruitContract {
  name: string;
  detectDelay: number;
  cooldownTime: number;
  enemyDetectRange: number;
  playerDetectRange: number;
  playerJumpDetectRange: number;
  isNonInteractable: boolean; // viewer.IsNonInteractable
  scaleGround: number;
  usage: number;
  destroyWhenUsedUp: boolean;
  textKey: string;
  getComponentPickupMovement(): PickupMovementContract | null;
  getComponentInChildrenMeshFilter(): MeshFilterContract | null;
  getComponentsBuffSetting(): BuffSettingContract[];
  gameObject: GameObjectContract;
}
let fruitViewerFactory: ((prefab: FruitContract, handleId: number) => FruitContract) | null = null;
/** C#: Object.Instantiate(prefab). Headless default: the data record doubles
 *  as its own viewer (same values read either way); the browser registers a
 *  Three.js-backed factory. */
export function setFruitViewerFactory(
  f: ((prefab: FruitContract, handleId: number) => FruitContract) | null,
): void {
  fruitViewerFactory = f;
}
export function instantiateFruitViewer(prefab: FruitContract, handleId: number): FruitContract {
  return fruitViewerFactory !== null ? fruitViewerFactory(prefab, handleId) : prefab;
}

// ---- Q4.GestureManager.Rumble (haptics; headless no-op) -----------------------------
let rumbleNotifier: ((playerId: number, setting: string) => void) | null = null;
/** C#: Q4.GestureManager.Rumble(playerID, Q4.VibrationSettings.X). Setting
 *  identifiers are the VibrationSettings property names (strings). */
export function setRumbleNotifier(f: ((playerId: number, setting: string) => void) | null): void {
  rumbleNotifier = f;
}
export function notifyRumble(playerId: number, setting: string): void {
  if (rumbleNotifier !== null) rumbleNotifier(playerId, setting);
}

// ---- GameCoreShop.RecreateViewer scene scan ------------------------------------------
// C#: Resources.FindObjectsOfTypeAll<Renderer>() filtered by go.scene.isLoaded.
// The view layer supplies loaded-scene renderer positions; headless: none.
export interface ShopViewerCandidate {
  position: Vector3Like;
  gameObject: unknown;
}
let shopViewerCandidatesProvider: (() => ShopViewerCandidate[]) | null = null;
export function setShopViewerCandidatesProvider(p: (() => ShopViewerCandidate[]) | null): void {
  shopViewerCandidatesProvider = p;
}
export function findShopViewerCandidates(): ShopViewerCandidate[] {
  return shopViewerCandidatesProvider ? shopViewerCandidatesProvider() : [];
}

// ---- Q4.TowerBase (tower prefab/viewer) + upgrade/detector/projectile components ----
import type { GameCoreTower } from '../core/GameCoreTower';
import type { IDamageable, IEnemyDetector } from '../core/interfaces';
import type { GameCoreProjectile } from '../core/GameCoreProjectile';
import type { ETowerAttackDef } from '../core/enums';

/** C#: Q4.TowerUpgrade — one upgrade level row (reachExp/level consumed by
 *  the sim; the rest is view-side). Data: structures_TowerUpgradeSettingGeneric.json. */
export interface TowerUpgradeContract {
  level: number; // 0x10 (0 = sentinel "no upgrade" — max level)
  reachExp: number; // 0x20
  costCoin?: number; // 0x24 (UpgradeTowerCommand; optional until the data layer fills it)
  costGem?: number; // 0x28
}
/** C#: Q4.TowerUpgradeSetting component (virtual slots 5/6/7). upgradeTower
 *  writes the tower's stats + level (C# ref param) → TS returns the new level. */
export interface TowerUpgradeSettingContract {
  getCurrentUpgrade(tower: GameCoreTower): TowerUpgradeContract | null;
  getNextUpgrade(tower: GameCoreTower): TowerUpgradeContract | null;
  upgradeTower(tower: GameCoreTower): number;
}
/** C#: Q4.EnemyDetectorView.CreateGameCoreDetector (virtual). */
export interface EnemyDetectorViewContract {
  createGameCoreDetector(): IEnemyDetector;
}
/** C#: Q4.Projectile view prefab — GetFireDirection (slot 10, ballistic aim)
 *  + GetGameCoreType (slot 4, the sim projectile ctor). TS ADAPTATION:
 *  `as ProjectileInsect`/`as ProjectileGem` type tests → structural markers
 *  (insectAmountMax present / isGemProjectile). */
export interface ProjectileViewContract {
  getFireDirection(firePos: Vector3Like, targetPos: Vector3Like, extra: Vector3Like): Vector3Like;
  getGameCoreType(): new (tower: GameCoreTower, targets: IDamageable[], dealsDamage: boolean) => GameCoreProjectile;
  insectAmountMax?: number; // Q4.ProjectileInsect.insectAmountMax
  isGemProjectile?: boolean; // Q4.ProjectileGem marker
  gameObject?: unknown;
  // ---- subtype tuning (read by the sim projectile ctors) ----
  maxLifeDuration?: number; // Q4.Projectile @0x18
  traceTarget?: boolean; // ProjectileTrajectory
  gravity?: number; // ProjectileTrajectory
  bulletSpeed?: number; // ProjectileInstant/Electric
  beamFlyLength?: number; // ProjectileBeam @0x48
  speed?: number; // ProjectileBeam @0x50
  radius?: number; // ProjectileBeam @0x54
  initialAttackDelay?: number; // ProjectileLightning @0x6C
  randomAttackTimeMin?: number; // ProjectileLightning @0x70
  randomAttackTimeMax?: number; // ProjectileLightning @0x74
  expBoostPerSecond?: number; // ProjectileGem @0x50
  destroyDropGem?: number; // ProjectileGem @0x54
  towerSinkTimePerFragment?: number; // ProjectileGem @0x48
  upgradeInterval?: number; // ProjectileGem @0x4C
  gemDropDelay?: number; // ProjectileGem @0x58
  // ---- view-side hooks (headless stubs may omit; documented adaptations) ----
  setupEstimateTime?(proj: GameCoreProjectile, predictedPos?: Vector3Like): void;
  initBeam?(towerBase: TowerBaseContract, target: GameCoreHandle): void;
  initializeLightnings?(proj: GameCoreProjectile): void;
  getComponentInChildrenRenderer?(): { bounds: BoundsLike } | null;
  getComponentsBuffSetting?(): BuffSettingContract[];
}
let projectileViewerFactory:
  | ((prefab: ProjectileViewContract | null, handleId: number, position?: Vector3Like) => ProjectileViewContract | null)
  | null = null;
/** C#: Object.Instantiate(viewer.projectile [, firePoint, identity]).
 *  Headless default: the prefab record doubles as its own viewer. */
export function setProjectileViewerFactory(
  f: ((prefab: ProjectileViewContract | null, handleId: number, position?: Vector3Like) => ProjectileViewContract | null) | null,
): void {
  projectileViewerFactory = f;
}
export function instantiateProjectileViewer(
  prefab: ProjectileViewContract | null,
  handleId: number,
  position?: Vector3Like,
): ProjectileViewContract | null {
  if (projectileViewerFactory !== null) return projectileViewerFactory(prefab, handleId, position);
  return prefab;
}
export interface TowerBaseContract {
  name: string;
  gameObject: unknown;
  transform: { position: Vector3Like };
  // InitializeSettings reads (offsets from dump.cs TowerBase):
  singletonInScene?: boolean; // 0x39 (BuildTowerCommand singleton check; optional — data records default false)
  nextTargetToAttackIndex: number; // 0x80
  attackType: ETowerAttackDef; // 0x3C
  strengthType: EEnemyStrengthTypeDef; // 0x40
  classType: EEnemyClassTypeDef; // 0x44
  balloonAimable: boolean; // 0x48
  attackPower: number; // 0x4C
  attackSpeed: number; // 0x50
  attackRangeInner: number; // 0x54
  attackSpread: number; // 0x58
  costCoin: number; // 0x5C
  costGem: number; // 0x60
  buildTime: number; // 0x64
  buildRange: number; // 0x84
  refundCoin: number; // 0x68
  refundGem: number; // 0x6C
  magazineCapacity: number; // 0x98
  rotateSpeedX: number; // 0xCC
  rotateSpeedXAcel: number; // 0xD0
  rotateSpeedXDecl: number; // 0xD4
  rotateSpeedY: number; // 0xD8
  rotateSpeedYAcel: number; // 0xDC
  rotateSpeedYDecl: number; // 0xE0
  oneShotOneBalloon: boolean; // 0x70
  fullRangeFire: boolean; // 0xE4
  fireAngleThreshold: number; // 0xE8
  attackAttenuations: unknown[]; // 0x90 (AttenuationInfo rows; shape at projectile port)
  burstCount: number; // 0xEC
  burstInterval: number; // 0xF0
  cautionRange: number; // 0xF4
  cautionIdleTime: number; // 0xF8
  cautionRotateSpeed: number; // 0xFC
  cautionRotateAngleMin: number; // 0x178
  playerDetectionRange: number; // Structure 0x20
  firePointNames: string[] | null; // 0xB0
  projectile: ProjectileViewContract | null; // 0xC0
  /** C#: GetComponent<TowerUpgradeSetting>() */
  getComponentTowerUpgradeSetting(): TowerUpgradeSettingContract | null;
  /** C#: GetComponent<EnemyDetectorView>() */
  getComponentEnemyDetectorView(): EnemyDetectorViewContract | null;
  /** C#: GetUnityObject<TowerAnimatorMissile>().ChangeMagDuration() — optional
   *  component on the tower viewer (missile towers only). */
  changeMagDuration?(): number;
  /** C#: GameObjectHelper.FindDeep(viewer.gameObject, name).transform.position.y */
  findDeepChildY(name: string): number | null;
  /** C#: TowerBase.GetFirePointByRemainingMag(magazineCapacity) — muzzle fire
   *  point selection by remaining ammo. */
  getFirePointByRemainingMag(mag: number): Vector3Like;
}
let towerViewerFactory:
  | ((prefab: TowerBaseContract, handleId: number, position: Vector3Like, rotationEuler: Vector3Like) => TowerBaseContract)
  | null = null;
/** C#: Object.Instantiate(towerPrefab.gameObject, pos, Quaternion.Euler(dir)).
 *  Headless default: the data record doubles as its own viewer. */
export function setTowerViewerFactory(
  f: ((prefab: TowerBaseContract, handleId: number, position: Vector3Like, rotationEuler: Vector3Like) => TowerBaseContract) | null,
): void {
  towerViewerFactory = f;
}
export function instantiateTowerViewer(
  prefab: TowerBaseContract,
  handleId: number,
  position: Vector3Like,
  rotationEuler: Vector3Like,
): TowerBaseContract {
  return towerViewerFactory !== null
    ? towerViewerFactory(prefab, handleId, position, rotationEuler)
    : prefab;
}

// ---- Q4.Home (home base viewer; GameCoreHome ctor + RecreateViewer) ----------------
/** C#: Q4.Home.ChibiHomeZone — polar spawn zone for the chibi crowd. */
export interface ChibiHomeZoneContract {
  numChibi: number;
  angleCenter: number; // degrees
  angleSpread: number; // degrees (only the negative half-arc is sampled — faithful)
  minDist: number;
  maxDist: number;
}
export interface HomeViewContract {
  playerDetectionRange: number; // Structure +0x20
  enemyDetectionRange: number; // Structure +0x1C
  kidPrefab: unknown; // Home +0x50
  chibiHomeZones: ChibiHomeZoneContract[]; // Home.ChibiHomeZones (+0x60)
  transform: { forward: Vector3Like; position: Vector3Like };
  gameObject: unknown;
}
let homeViewsFinder: (() => HomeViewContract[]) | null = null;
/** C#: Object.FindObjectsOfType<Q4.Home>(). Headless default: empty. */
export function setHomeViewsFinder(p: (() => HomeViewContract[]) | null): void {
  homeViewsFinder = p;
}
export function getHomeViews(): HomeViewContract[] {
  return homeViewsFinder ? homeViewsFinder() : [];
}

// ---- UnityEngine.Object.Destroy (view teardown requested by the sim) ---------------
// C#: GameCoreHome.Tick destroys the viewer GameObject of game-over stragglers.
// Headless default: no-op (view lifetime never affects sim state).
let unityObjectDestroyer: ((obj: unknown) => void) | null = null;
export function setUnityObjectDestroyer(f: ((obj: unknown) => void) | null): void {
  unityObjectDestroyer = f;
}
export function destroyUnityObject(obj: unknown): void {
  if (unityObjectDestroyer !== null) unityObjectDestroyer(obj);
}

// ---- Q4.UnityEvents.chibiAvoidanceZoneEvent (view-side hub) -------------------------
// C#: GameCoreEnemy.get_CanAttack announces the chibi-avoidance zone on FIRST
// access (UnityEvents is the Q4 view event hub, distinct from GameCore.Events).
let chibiAvoidanceZoneNotifier:
  | ((pos: Vector3Like, radius: number, duration: number) => void)
  | null = null;
export function setChibiAvoidanceZoneNotifier(
  f: ((pos: Vector3Like, radius: number, duration: number) => void) | null,
): void {
  chibiAvoidanceZoneNotifier = f;
}
export function notifyChibiAvoidanceZone(
  pos: Vector3Like,
  radius: number,
  duration: number,
): void {
  if (chibiAvoidanceZoneNotifier !== null) chibiAvoidanceZoneNotifier(pos, radius, duration);
}

// ---- Q4.GamePreferences (difficulty selection) ---------------------------------------
// C#: Q4.GamePreferences.Instance.difficultySetting — consumed by
// GameCoreWaveManager..ctor to pick the per-difficulty wave lists.
// DifficultySettings.Difficulty: Any=-1, Easy=0, Medium=1, Hard=2 (metadata
// TypeDefIndex 2828). SP DEFAULT: Medium (1) — also the WaveManager's own
// field-initializer default.
export interface GamePreferencesContract {
  difficultySetting: number; // DifficultySettings.Difficulty
}
let gamePreferencesProvider: (() => GamePreferencesContract | null) | null = null;
export function setGamePreferencesProvider(
  p: (() => GamePreferencesContract | null) | null,
): void {
  gamePreferencesProvider = p;
}
export function getDifficultySetting(): number {
  const gp = gamePreferencesProvider ? gamePreferencesProvider() : null;
  return gp !== null ? gp.difficultySetting | 0 : 1; // Medium
}

// ---- Q4.GameInfoController (stage flow delays) ---------------------------------------
// C#: Q4.GameInfoController.Instance.stageClearDelay / gameOverDelay
// (get @0x44BE50 / @0x44BE60, fields @0x100/@0x104).
// VERIFIED from the user's copy (globalsettings bundle GameInfoController,
// decomp/data/globalsettings_GameInfoController.json): stageClearDelay = 5.0,
// gameOverDelay = 6.0. (The 3d_stage_jovian scene copy ships 5.0/5.0; the
// globalsettings singleton is the one Instance resolves to in gameplay.)
export interface GameInfoControllerContract {
  stageClearDelay: number;
  gameOverDelay: number;
}
let gameInfoControllerProvider: (() => GameInfoControllerContract | null) | null = null;
export function setGameInfoControllerProvider(
  p: (() => GameInfoControllerContract | null) | null,
): void {
  gameInfoControllerProvider = p;
}
export function getGameInfoController(): GameInfoControllerContract {
  const gi = gameInfoControllerProvider ? gameInfoControllerProvider() : null;
  return gi ?? { stageClearDelay: 5.0, gameOverDelay: 6.0 }; // VERIFIED defaults
}

// ---- Q4.Jarvis (debug/walkthrough) -----------------------------------------------------
// C#: Q4.Jarvis.Instance.walkthroughMode — true halts wave spawning.
// Headless default: false.
export interface JarvisContract {
  walkthroughMode: boolean;
}
let jarvisProvider: (() => JarvisContract | null) | null = null;
export function setJarvisProvider(p: (() => JarvisContract | null) | null): void {
  jarvisProvider = p;
}
export function getWalkthroughMode(): boolean {
  const j = jarvisProvider ? jarvisProvider() : null;
  return j !== null ? j.walkthroughMode : false;
}

// ---- Q4.WaveManager + Q4.WaveResource (stage wave tables) ------------------------------
// C#: the scene WaveManager view exposes GetWaveResource() (the stage's
// WaveData tables) and GetEnemyRoot() (view-side parenting of spawned enemy
// GameObjects). Data shapes mirror decomp/data/stages_WaveResource.json
// (verified against the user's copy; 1873 spawn entries).
export interface SpawnDataContract {
  enemyObject: EnemyBaseContract | null; // C#: GetComponent<EnemyBase>() on the prefab
  enemySpawnNum: number;
  enemySpawnInterval: number;
  delay: number; // first-spawn delay of this group
  enemyTrackerEnable: boolean;
  offsetStartAngle: number; // degrees (× Mathf.Deg2Rad in the sim)
  offsetFreq: number;
  offsetDist: number;
  walkDriftFreq: number;
  walkDriftDist: number;
  pathName: string; // C#: m_pathName
  pathCurve: CatmullCurveContract; // C#: the scene CatmullCurve named pathName
  pathSegTypeInfos: number[] | null; // C#: m_segTypeList
  pathStartTime: number; // serialized spawn offset along the path
}
export interface WaveDataContract {
  delay: number[]; // per difficulty [Easy, Medium, Hard]; <0 ends the wave list
  speedRatio: number[];
  hpRatio: number[];
  totalMoney: number[];
  totalGem: number[];
  money: number[];
  gem: number[];
  dialogLabel: string[];
  dialogIcon: number[];
  perDifficulyLists: Array<{ spawnDataList: SpawnDataContract[] }>; // C# typo kept
}
export interface BossMinionSpawnDataContract {
  waveData: WaveDataContract;
  time: number; // boss-path time at which the group is released
}
export interface WaveResourceContract {
  waveDataList: WaveDataContract[]; // C#: WaveDataList
  waveDataBossListEasy: BossMinionSpawnDataContract[] | null;
  waveDataBossListMedium: BossMinionSpawnDataContract[] | null;
  waveDataBossListHard: BossMinionSpawnDataContract[] | null;
}
export interface WaveManagerViewContract {
  getWaveResource(): WaveResourceContract;
  /** C#: GetEnemyRoot() — view-side parent for spawned enemies (unused headless). */
  getEnemyRoot?(): unknown | null;
}

// ---- MiniDialogController.MiniDialogStageSettings --------------------------------------
// C#: 12-byte struct (WaveProgress.dialogStageSettings @0x40). View-side wave
// dialog data; carried opaquely by the sim.
export interface MiniDialogStageSettings {
  label: string; // waveData.dialogLabel[diff]
  icon: number; // waveData.dialogIcon[diff]
}

// ---- Q4.DatabaseManager.TowerDatabase (BuildTowerCommand) --------------------------
// C#: DatabaseManager.TowerDatabase.GetData(name) → Q4.TowerBase prefab.
// Headless default: null → the command logs + returns (faithful early-out).
export interface TowerDatabaseContract {
  getData(name: string): TowerBaseContract | null;
}
let towerDatabaseProvider: (() => TowerDatabaseContract | null) | null = null;
export function setTowerDatabaseProvider(p: (() => TowerDatabaseContract | null) | null): void {
  towerDatabaseProvider = p;
}
export function getTowerPrefabByName(name: string): TowerBaseContract | null {
  const db = towerDatabaseProvider ? towerDatabaseProvider() : null;
  return db !== null ? db.getData(name) : null;
}

// ---- UnityEngine.GameObject.Find (BuildTowerCommand singleton check) ---------------
// C#: GameObject.Find(prefab.name) != null blocks a second singleton tower.
// Headless default: nothing found (build allowed).
let viewObjectByNameFinder: ((name: string) => unknown | null) | null = null;
export function setViewObjectByNameFinder(f: ((name: string) => unknown | null) | null): void {
  viewObjectByNameFinder = f;
}
export function findViewObjectByName(name: string): unknown | null {
  return viewObjectByNameFinder ? viewObjectByNameFinder(name) : null;
}

// ---- Q4.PlayerManager / Q4.PlayerInfo / Q4.StageTransferInfo (AddLocalPlayerCommand) ---
// C#: PlayerManager.Instance.JoinPlayer(info, pos, rot) spawns the avatar view,
// whose IPlaceableViewObject.CreateGameCoreObject() creates the sim player.
/** C#: Q4.PlayerInfo (struct, +0x0 id / +0x4 localPlayer / +0x8 maskName / +0x10 carapaceName). */
export interface PlayerInfoData {
  id: number;
  localPlayer: boolean;
  maskName: string;
  carapaceName: string;
}
export interface JoinedPlayerViewContract extends PlayerViewContract {
  /** C#: IPlaceableViewObject.CreateGameCoreObject() — the sim player. */
  createGameCoreObject(): unknown;
  setCustomizedParts(maskName: string, carapaceName: string): void;
}
export interface PlayerManagerContract {
  joinPlayer(
    info: PlayerInfoData,
    position: Vector3Like,
    rotation: unknown,
  ): JoinedPlayerViewContract | null;
}
let playerManagerProvider: (() => PlayerManagerContract | null) | null = null;
export function setPlayerManagerProvider(p: (() => PlayerManagerContract | null) | null): void {
  playerManagerProvider = p;
}
export function getPlayerManager(): PlayerManagerContract | null {
  return playerManagerProvider ? playerManagerProvider() : null;
}
/** C#: Q4.StageTransferInfo.transferInfo — carried-over customization between scenes. */
export interface StageTransferInfoContract {
  tryGetParts(playerId: number): { maskName: string; carapaceName: string } | null;
}
let stageTransferInfoProvider: (() => StageTransferInfoContract | null) | null = null;
export function setStageTransferInfoProvider(
  p: (() => StageTransferInfoContract | null) | null,
): void {
  stageTransferInfoProvider = p;
}
export function getStageTransferInfo(): StageTransferInfoContract | null {
  return stageTransferInfoProvider ? stageTransferInfoProvider() : null;
}

// ---- Q4.GlobalSettingsContainer<ClothingUnlockData>.fruitDefinitions (SpawnFruitCommand) ---
/** C#: Q4.ClothingUnlockDefinitions.FruitDefinition. */
export interface FruitDefinitionContract {
  costCoin: number;
  costGem: number;
  fruitPrefab: unknown | null; // C#: GameObject (FAITHFUL: null → command early-out)
}
export interface FruitDefinitionsContract {
  getDefinition(index: number): FruitDefinitionContract;
}
let fruitDefinitionsProvider: (() => FruitDefinitionsContract | null) | null = null;
export function setFruitDefinitionsProvider(
  p: (() => FruitDefinitionsContract | null) | null,
): void {
  fruitDefinitionsProvider = p;
}
/** FAITHFUL: null provider → callers dereference → TypeError (C# NRE on the
 *  missing globalsettings singleton). */
export function getFruitDefinitions(): FruitDefinitionsContract | null {
  return fruitDefinitionsProvider ? fruitDefinitionsProvider() : null;
}

// ---- Q4.UI.ShopMainController (SpawnFruitCommand shop refresh) ----------------------
export interface ShopMainControllerContract {
  isShowing: boolean;
  refreshShopBoards(): void;
}
let shopMainControllerProvider: (() => ShopMainControllerContract | null) | null = null;
export function setShopMainControllerProvider(
  p: (() => ShopMainControllerContract | null) | null,
): void {
  shopMainControllerProvider = p;
}
export function getShopMainController(): ShopMainControllerContract | null {
  return shopMainControllerProvider ? shopMainControllerProvider() : null;
}

// ---- Q4.GameCoreBridge.gameCoreTickEnabled (SpawnFruitCommand ctor) ------------------
// C#: GameCoreBridge.Instance.gameCoreTickEnabled — when the sim tick is paused
// the fruit cost is settled in the ctor. The TS driver (src/main/sim-driver.ts)
// registers the real flag; headless default: ticking (true).
let gameCoreTickEnabledProvider: (() => boolean) | null = null;
export function setGameCoreTickEnabledProvider(p: (() => boolean) | null): void {
  gameCoreTickEnabledProvider = p;
}
export function getGameCoreTickEnabled(): boolean {
  return gameCoreTickEnabledProvider ? gameCoreTickEnabledProvider() : true;
}
