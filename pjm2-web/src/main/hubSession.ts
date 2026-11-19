// src/main/hubSession.ts
// The HUB (world map) session: scene `3d_stage_000` = the original's home diorama / walkable stage-select world map
// (Q4.WorldMap + StagePortal + AreaLock + WorldMapArea). Same lifecycle as stageSession.ts (create -> frame -> dispose),
// but NO sim world: it is a view + the PlayerMover on the hub's static colliders.
//
//   mode 'title'   : GameCameraTitle (static, FOV 50) on the tikiman standing at his authored hub position; title UI drawn over it.
//   mode 'select'  : WALKABLE world map: the tikiman (WASD / arrows, Shift = run) walks on the hub colliders, the top-down camera
//                    (GameCameraTopDown(Real), the hub's default camera) follows, StagePortal triggers drive the stage-select panel
//                    (OnEnterStagePortal -> UpdateStagePortal), WorldMapArea triggers the area banner, AreaLock barriers block the
//                    path until their stages are unlocked (rainbow-fragment toll).
//   mode 'credits' : title camera + the tikiman dancing (dance_buildTower loop) while the staff roll runs.
//
// Pure rules live in src/view/hub/HubModel.ts (tested); all numbers in src/data/hubScene.generated.ts (tools/data/export_hub.py).
// Facts + the list of approximations: docs/HUB_AND_TITLE_ANALYSIS.md. The grid cursor stays as the fallback (`?grid`, or when
// this session fails to load: game.ts then keeps the old behaviour).

import * as THREE from 'three';

import { HUB_SCENE, type HubAreaData, type HubPortalData } from '../data/hubScene.generated';
import { stageByScene } from '../data/stageCatalog';
import { defaultFileLoader, PhysicsWorld, type StageCollidersJson } from '../engine/physics/world';
import { CharacterLibrary } from '../view/characters/CharacterLibrary';
import { PlayerStageView } from '../view/characters/PlayerStageView';
import { addOutline, type OutlineHandle } from '../view/characters/ToonOutline';
import { applyToonToCharacter, type ToonHandle } from '../view/characters/ToonMaterial';
import type { AudioManager } from '../view/audio/AudioManager';
import type { AssetCache } from '../view/cache/AssetCache';
import { PlayerMover } from '../view/player/PlayerMover';
import { isStageUnlocked } from '../view/save/StageProgress';
import type { SaveData } from '../view/save/SaveData';
import { addStageAmbient } from '../view/stage/StageAmbient';
import { renderExtrasFor } from '../view/stage/renderExtras';
import { SkyAtmosphere } from '../view/stage/SkyAtmosphere';
import { StageCamera } from '../view/stage/StageCamera';
import { stageEnvironmentFor, skyEnvTextureUrl } from '../view/stage/StageEnvironment';
import { StageSceneView } from '../view/stage/StageSceneView';
import { DOF_PROFILES } from '../view/stage/DepthOfField';
import { CameraSwitch, SWITCH_TOPDOWN, topDownSwitchOutFov } from '../view/stage/CameraSwitch';
import { WaterPass, type PostProfile } from '../view/stage/WaterPass';
import {
  hiddenLockNodes, hubPortals, lockCanUnlock, lockIsUnlocked, lockMissingRainbows, portalVisible, removedBlockerColliders,
  selectArea, selectLock, selectPortal, stagesOpenedBy, startPosition, titleCameraPose, titleTikimanPose, type CameraPose, type V3,
} from '../view/hub/HubModel';
import { disposeObject3D } from './disposeThree';
import { HubHut } from '../view/hub/HubHut';
import { buildHubTrees } from '../view/hub/HubTrees';
import { TitleRainbow } from '../view/hub/TitleRainbow';
import { installStageReflectionProbe, loadStageReflectionProbe } from '../view/stage/StageReflectionProbe';
import { titleCrowdNodes } from '../view/hub/TitleCrowd';
import { TITLE_BLOOM, TITLE_GRADE_PROFILE } from '../view/stage/TitleProfile';
import { HubChibis } from '../view/hub/HubChibis';
import { TreeView } from '../view/stage/TreeView';

export type HubMode = 'title' | 'select' | 'credits';

/** What the stage-select panel needs (StageSelectScreen.setHubTarget). */
export interface HubUiState {
  /** Stage number of the portal underfoot (null = none). */
  portalStage: number | null;
  /** Area-name string key of the WorldMapArea the tikiman is in (null = none). */
  areaKey: string | null;
  /** Interaction prompt / result line (AreaLock), already localised. */
  message: string | null;
}

export interface HubServices {
  renderer: THREE.WebGLRenderer;
  save: SaveData | null;
  assetCache: AssetCache;
  getAudio(): AudioManager | null;
  progress(pct: number | null, text: string): void;
  /** String lookup (Q4.TextDatabase) with fallback text. */
  t(key: string, fallback: string): string;
}

export interface HubSession {
  readonly sceneId: '3d_stage_000';
  readonly disposed: boolean;
  readonly mode: HubMode;
  readonly debug: Record<string, unknown>;
  setMode(mode: HubMode): void;
  /** True from creation until the first-show title intro (closeup -> camera switch -> hut curtain + tikiman entrance) has finished: the title UI waits (TitleScreenController.StartIntroAnimation waits for TitleIdle). */
  readonly introPending: boolean;
  /** Start the first-show intro (the shell calls it when the loading screen goes away). */
  beginIntro(): void;
  onState(cb: (s: HubUiState) => void): () => void;
  frame(nowMs: number): void;
  resize(aspect: number): void;
  dispose(): void;
}

const BASE = '/assets/stages/3d_stage_000/';
const CAMERA_BLEND_SECONDS = 1.2;
const DT_MAX = 1 / 20;

const toThreeV = (v: V3, out = new THREE.Vector3()): THREE.Vector3 => out.set(-v[0], v[1], v[2]);

export async function createHubSession(sh: HubServices): Promise<HubSession> {
  const renderer = sh.renderer;
  const search = new URLSearchParams(window.location.search);
  const ENV = stageEnvironmentFor('3d_stage_000');
  const ac = new AbortController();
  let disposed = false;
  let mode: HubMode = 'title';
  const titlePost: PostProfile = { grade: TITLE_GRADE_PROFILE, bloom: search.has('nobloom') ? null : TITLE_BLOOM };
  const scene = new THREE.Scene();
  const waterPass = new WaterPass(renderer, scene, ENV.clearHex, 4, search.has('nograde') ? false : ENV.grade, renderExtrasFor(ENV, search));
  const ambient = addStageAmbient(scene, ENV.ambient.intensity, ENV.ambient.sh);
  const sky = new SkyAtmosphere(renderer, scene, { ambientIntensity: 1, postGraded: waterPass.gradeEnabled, skyTextureUrl: skyEnvTextureUrl(ENV, BASE) });
  // GameCameraTopDown(Real): the hub's default camera (CameraManager.defaultCamera -> pid 8395): fov 18, boom 30.
  const stageCamera = new StageCamera({ keyboardPan: false, edgeMargin: 0, fov: ENV.camera.fov, pitchDeg: ENV.camera.pitchDeg, yawDeg: ENV.camera.yawDeg });
  stageCamera.resize(window.innerWidth / window.innerHeight);
  const titlePose: CameraPose = titleCameraPose();
  const viewCam = new THREE.PerspectiveCamera(titlePose.fov, window.innerWidth / window.innerHeight, 0.3, 1000);
  const characterRoot = new THREE.Group();
  characterRoot.name = 'hub-characters';
  scene.add(characterRoot);

  const save = sh.save;
  const catalogScene = (s: string): boolean => stageByScene(s) !== undefined;
  const portals: HubPortalData[] = hubPortals(catalogScene);
  const areas: HubAreaData[] = HUB_SCENE.areas;
  const locks = HUB_SCENE.locks;

  // ---- scene ------------------------------------------------------------------------------
  sh.progress(null, 'hub: world map…');
  const sceneStart = performance.now();
  const stageView = new StageSceneView({
    baseUrl: BASE,
    renderer,
    sceneFile: 'scene-webp.json',
    textureConcurrency: 10,
    ...(new URLSearchParams(window.location.search).has('lazytex') ? { blockingPriorityBelow: 8 } : {}), // default: all hub textures load before the title shows
    mergeByMaterial: false, // per-renderer meshes (tagged with userData.nodeIndex) so AreaLock barriers / rainbows can be toggled
    assetCache: sh.assetCache,
    onProgress: (p) => {
      const pct = p.totalBytes > 0 ? (p.loadedBytes / p.totalBytes) * 100 : 0;
      sh.progress(pct, `hub ${p.phase}: ${p.detail} — ${(p.loadedBytes / 1e6).toFixed(0)}/${(p.totalBytes / 1e6).toFixed(0)} MB`);
    },
  });

  const library = new CharacterLibrary('/assets/characters/', sh.assetCache);
  const collidersLoad: Promise<StageCollidersJson> = fetch(`${BASE}physics/3d_stage_000_colliders.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`hub colliders ${r.status}`))));
  collidersLoad.catch(() => { /* handled where awaited */ });
  // The hub's baked HDR ReflectionProbe (ReflectionProbe pid 7749, cubemap `ReflectionProbe-0` in BuildPlayer-3d_stage_000_editor.sharedAssets, box 134.5 x 20.9 x 78.4,
  // tools/stages/extract_reflection_probe.py): the original deferred terrain/standard shaders add its Fresnel reflection (grazing angles = the pale haze on distant hills).
  let probeTexture: THREE.Texture | null = null;
  const probeLoad = search.has('noprobe') ? Promise.resolve(null) : loadStageReflectionProbe(BASE);
  const skyReady = sky.apply().then(async () => {
    scene.background = new THREE.Color(ENV.clearHex);
    const probe = await probeLoad;
    if (probe) { probeTexture = probe.texture; installStageReflectionProbe(scene, probe.texture, probe.meta.intensity); }
  });
  const [, collidersJson] = await Promise.all([
    stageView.load().then(() => {
      scene.add(stageView.group);
      const riverMat = stageView.riverMeshes[0]?.material;
      if (riverMat) waterPass.setWater(stageView.riverMeshes, riverMat as THREE.ShaderMaterial);
    }),
    collidersLoad,
    library.loadMany(['tikiman_01', 'mask_00', 'carapace_00', 'chibi_00']),
    skyReady,
  ]);

  // ---- title hut (skinned home_001_comp + curtain animator; the stage extractor skips skinned renderers) ----
  let hut: HubHut | null = null;
  if (!search.has('nohut')) {
    hut = await HubHut.load(stageView.materials.get('home_001_m') ?? null);
    if (hut !== null) scene.add(hut.root);
  }

  // ---- title rainbow (ef_ui_bg_rainbow_pv under GameCameraTitle) ----
  const rainbow = await TitleRainbow.load();
  if (rainbow !== null) scene.add(rainbow.root);

  // ---- NPC chibis (chibi_01 PrefabLoaders) ----
  let hubChibis: HubChibis | null = null;
  let titleCrowd: HubChibis | null = null;
  if (!search.has('nochibis') && library.get('chibi_00') !== null) {
    hubChibis = new HubChibis(() => library.instantiate('chibi_00'));
    scene.add(hubChibis.root);
    if (!search.has('nocrowd')) { titleCrowd = new HubChibis(() => library.instantiate('chibi_00'), titleCrowdNodes()); scene.add(titleCrowd.root); } // title-only decorative crowd (orig_main.png)
  }

  // ---- hub trees (PrefabLoader random lists; skipped by the scene export) ----
  if (!search.has('notrees')) {
    try { const ta = await TreeView.load('/assets/trees/'); const g = buildHubTrees(ta); if (g.children.length > 0) scene.add(g); } catch (err) { console.warn('hub trees unavailable', err); }
  }

  // ---- physics + mover --------------------------------------------------------------------
  const loader = defaultFileLoader(`${BASE}physics`);
  let physics: PhysicsWorld | null = null;
  let mover: PlayerMover | null = null;
  const respawn = HUB_SCENE.respawn.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  let removedKey = '';
  async function buildPhysics(): Promise<void> {
    const removed = removedBlockerColliders(locks, save?.unlockedStages ?? []);
    const key = [...removed].sort((a, b) => a - b).join(',');
    if (physics !== null && key === removedKey) return;
    const keep = collidersJson.colliders.filter((_, i) => !removed.has(i));
    const next = await PhysicsWorld.fromJson({ ...collidersJson, colliders: keep }, loader);
    const old = physics;
    const oldMover = mover;
    physics = next;
    removedKey = key;
    mover = new PlayerMover(next, respawn);
    if (oldMover !== null) mover.teleport(oldMover.x, oldMover.y, oldMover.z);
    old?.world.free();
  }
  try { await buildPhysics(); } catch (err) { console.warn('hub physics unavailable (unconstrained walking):', err); }

  // ---- tikiman ----------------------------------------------------------------------------
  let playerView: PlayerStageView | null = null;
  let outlineHandle: OutlineHandle | null = null;
  let toonHandle: ToonHandle | null = null;
  if (library.get('tikiman_01') !== null) {
    playerView = new PlayerStageView(library.instantiate('tikiman_01'), {
      mask: library.get('mask_00') !== null ? library.instantiate('mask_00') : undefined,
      carapace: library.get('carapace_00') !== null ? library.instantiate('carapace_00') : undefined,
    });
    characterRoot.add(playerView.root);
    outlineHandle = addOutline(playerView.root);
    toonHandle = applyToonToCharacter(playerView.root);
  }
  const player = { x: 0, y: 0, z: 0 };
  const titleStand = titleTikimanPose();
  function placePlayer(p: V3): void {
    player.x = p[0]; player.y = p[1]; player.z = p[2];
    if (mover !== null) mover.teleport(p[0], p[1] + 0.05, p[2]);
    playerView?.setPosition({ x: p[0], y: p[1], z: p[2] });
  }
  function standOnTitleSpot(): void {
    placePlayer(titleStand.pos);
    if (mover !== null) { mover.teleportToGround(titleStand.pos[0], titleStand.pos[2]); player.y = mover.y; playerView?.setPosition(player); }
    playerView?.face({ x: titleStand.forward[0], z: titleStand.forward[2] });
  }
  standOnTitleSpot();
  stageCamera.snap(toThreeV([player.x, player.y, player.z])); // the intro opens on the follow camera, already framed on the hut / tikiman
  /** Q4.TitleScreenController `m_hasSeenTitleIntro` (+0xb3): the hut/entrance plays once per session, later shows use TitleScreenEnterV2. */
  let titleIntroPlayed = false;
  function startTitleAnim(): void {
    rainbow?.start(); // ShowRainbowTitle
    if (!titleIntroPlayed) hut?.playCurtain(); // StartIntroAnimation: Home Animator.SetTrigger(TitleScreenEnter), first show only
    playerView?.startTitle(!titleIntroPlayed);
    titleIntroPlayed = true;
  }
  playerView?.holdTitleEnter(); // InitIntroAnimation: TitleScreenEnterWait until the title intro starts

  // ---- first-show intro (TitleScreenController.Update / StartIntroAnimation) -----------------------
  // Original order: the default camera (GameCameraTopDown, a tight close-up of the hut / tikiman at the origin) is active -> Update calls
  // CameraManager.SwitchCameraTo<GameCameraTitle>(blend): the top-down camera's GameCameraSwitchBlackInOut zooms in (FOV -30 deg/s) while fading to black for
  // 0.3 s, then the camera swaps to GameCameraTitle (in front of the hut) and the switch callback runs StartIntroAnimation: hut curtain + tikiman
  // TitleScreenEnter (4.5 s).  The coroutine waits for the player animator to reach TitleIdle, and only THEN does the title UI (logo drop + jingle) run.
  // `?nointro` keeps the old behaviour (title camera from the start, the logo drives the entrance).
  const introSeq = !search.has('nointro');
  let introPhase: 'wait' | 'closeup' | 'enter' | 'done' = introSeq ? 'wait' : 'done';
  const introSwitch = new CameraSwitch('top');
  let introFov = 18;
  let introEnterWall = 0; // failsafe: the title UI never waits longer than this for the entrance animation
  let fadeEl: HTMLDivElement | null = null;
  function setFade(a: number): void {
    if (a <= 0.001) { if (fadeEl !== null) fadeEl.style.opacity = '0'; return; }
    if (fadeEl === null) {
      fadeEl = document.createElement('div');
      fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:4;opacity:0';
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = String(Math.min(1, a));
  }
  function startEntrance(): void {
    if (!titleIntroPlayed) hut?.playCurtain();
    if (playerView === null) introPhase = 'done'; else playerView.startTitle(!titleIntroPlayed, () => { introPhase = 'done'; });
    titleIntroPlayed = true;
    introEnterWall = 0;
  }
  // The title UI's own intro (jingle) starts the rainbow ("appears as the logo lands"); with the sequence on, the entrance has already run.
  function onTitleUiIntro(): void { if (titleIntroPlayed) rainbow?.start(); else startTitleAnim(); }
  if ((window as unknown as { __pjm2TitleIntro?: boolean }).__pjm2TitleIntro === true) onTitleUiIntro(); // the title intro began before the hub finished loading
  window.addEventListener('pjm2:titleIntro', () => { if (!disposed && mode === 'title') onTitleUiIntro(); }, { signal: ac.signal });

  // ---- node visibility (AreaLock barriers, stage rainbows) ----------------------------------
  const meshesByNode = new Map<number, THREE.Object3D[]>();
  for (const o of stageView.draws.children) {
    const n = o.userData.nodeIndex as number | undefined;
    if (n === undefined) continue;
    const l = meshesByNode.get(n);
    if (l === undefined) meshesByNode.set(n, [o]); else l.push(o);
  }
  function applyNodeVisibility(): void {
    const unlocked = save?.unlockedStages ?? [];
    const hidden = hiddenLockNodes(locks, unlocked);
    // StageRainbowIndicator.DecorateRainbows @0052d380: one rainbow per perfect difficulty, icing when all three are perfect.
    for (const r of HUB_SCENE.rainbows) {
      const perfect = [0, 1, 2].map((d) => save?.getStagePerfect(r.stage, d) ?? false);
      const groups = [r.easy, r.medium, r.hard];
      groups.forEach((g, d) => { if (!perfect[d]) for (const n of g) hidden.add(n); });
      if (!(perfect[0] && perfect[1] && perfect[2])) for (const n of r.icing) hidden.add(n);
    }
    for (const [n, list] of meshesByNode) for (const o of list) o.visible = !hidden.has(n);
  }
  applyNodeVisibility();

  // ---- state / events -----------------------------------------------------------------------
  const listeners = new Set<(s: HubUiState) => void>();
  let uiState: HubUiState = { portalStage: null, areaKey: null, message: null };
  let noticeUntil = 0;
  let notice: string | null = null;
  function emit(next: HubUiState): void {
    if (next.portalStage === uiState.portalStage && next.areaKey === uiState.areaKey && next.message === uiState.message) return;
    uiState = next;
    for (const cb of listeners) cb(uiState);
  }
  const moveKeys = new Set<string>();
  const lockOf = new Map(locks.map((l) => [l.node, l] as const));
  void lockOf;
  let currentLock: (typeof locks)[number] | null = null;

  function portalIsVisible(p: HubPortalData): boolean {
    const entry = stageByScene(p.stage);
    return save !== null && portalVisible(p, save, () => entry !== undefined && isStageUnlocked(save, entry), entry !== undefined);
  }

  function recompute(nowMs: number): void {
    const pos: V3 = [player.x, player.y, player.z];
    const portal = mode === 'select' ? selectPortal(portals, pos, portalIsVisible) : null;
    // WorldMapArea.OnEnterTitle disables the area triggers (no banner on the title); ExitTitle re-enables them.
    const area = mode === 'select' ? selectArea(areas, pos) : null;
    currentLock = null;
    let message: string | null = null;
    if (mode === 'select' && portal === null && save !== null) {
      const lk = selectLock(locks.filter((l) => !lockIsUnlocked(l, save.unlockedStages)), pos);
      if (lk !== null) {
        currentLock = lk;
        message = lockCanUnlock(lk, save)
          ? sh.t('tl_mini_dialog_text_009', 'Use Rainbow Fragments to open paths!').replace(/\{c_rainbow_01\}/g, '').replace(/\s*\n\s*/g, ' ') + '  [Enter]'
          : sh.t('tl_mini_dialog_text_011', 'You need {replace_01} Rainbow Fragments!').replace('{replace_01}', String(lockMissingRainbows(lk, save))).replace(/\{c_rainbow_01\}/g, '').replace(/\s*\n\s*/g, ' ');
      }
    }
    if (notice !== null && nowMs < noticeUntil) message = notice;
    const entry = portal === null ? undefined : stageByScene(portal.stage);
    emit({ portalStage: entry?.stage ?? null, areaKey: area?.label ?? null, message });
  }

  /** AreaLock.OnInteract -> OnUnlockDialogResult(yes): SetStagesUnlock + unlock effect (ApplyAllLockStates). */
  async function openLock(): Promise<void> {
    const lk = currentLock;
    if (lk === null || save === null || !lockCanUnlock(lk, save)) return;
    for (const s of stagesOpenedBy(lk, save.unlockedStages)) save.addUnlockedStage(s);
    applyNodeVisibility();
    try { await buildPhysics(); } catch (err) { console.warn('hub physics rebuild failed', err); }
    notice = sh.t('tl_mini_dialog_text_015', 'A new stage has appeared!').replace(/\s*\n\s*/g, ' ');
    noticeUntil = performance.now() + 4000;
    recompute(performance.now());
  }

  window.addEventListener('keydown', (e) => {
    moveKeys.add(e.code);
    if (mode === 'select' && !e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') && currentLock !== null && uiState.portalStage === null) {
      e.preventDefault();
      void openLock();
    }
  }, { signal: ac.signal });
  window.addEventListener('keyup', (e) => moveKeys.delete(e.code), { signal: ac.signal });
  window.addEventListener('blur', () => moveKeys.clear(), { signal: ac.signal });

  // ---- camera ---------------------------------------------------------------------------------
  const titleCamPos = toThreeV(titlePose.pos);
  const titleCamQuat = new THREE.Quaternion();
  {
    const m = new THREE.Matrix4();
    const f = new THREE.Vector3(-titlePose.forward[0], titlePose.forward[1], titlePose.forward[2]);
    const up = new THREE.Vector3(-titlePose.up[0], titlePose.up[1], titlePose.up[2]);
    m.lookAt(titleCamPos, titleCamPos.clone().add(f), up);
    titleCamQuat.setFromRotationMatrix(m);
  }
  /** 0 = title/credits camera, 1 = follow camera (eased over CAMERA_BLEND_SECONDS). */
  let blend = 0;
  let blendTarget = 0;
  const followPos = new THREE.Vector3();
  const followQuat = new THREE.Quaternion();
  const playerMoveDir = new THREE.Vector3();
  const moveIntent = { x: 0, z: 0 };

  function setMode(next: HubMode): void {
    if (disposed || next === mode) return;
    const prev = mode;
    mode = next;
    if (next === 'select') {
      const last = save?.getLastPlayStageName() ?? null;
      const start = startPosition(last === '' ? null : last, portals);
      playerView?.endTitle(); // TitleScreenExit -> Idle
      rainbow?.stop(); // HideRainbow
      placePlayer(start);
      mover?.teleportToGround(start[0], start[2]);
      if (mover !== null) { player.y = mover.y; }
      stageCamera.snap(toThreeV([player.x, player.y, player.z]));
      blendTarget = 1;
      applyNodeVisibility();
    } else {
      blendTarget = 0;
      if (prev === 'select') { standOnTitleSpot(); startTitleAnim(); }
    }
    if (next === 'credits') {
      // Staff credits: the original plays `3d_stage_000_credit` with the tikiman dancing to sfx_tiki_creditdance.
      playerView?.startBuildDance(1e9);
    } else if (prev === 'credits' && playerView !== null) {
      startTitleAnim(); // back on the title: TitleScreenIdle (V2 path)
    }
    recompute(performance.now());
  }

  // ---- frame ------------------------------------------------------------------------------------
  let last = performance.now();
  function frame(nowMs: number): void {
    if (disposed) return;
    const wall = (nowMs - last) / 1000;
    const dt = Math.min(wall, DT_MAX);
    last = nowMs;
    if (mode === 'select') {
      let ix = 0, iz = 0;
      if (moveKeys.has('KeyA') || moveKeys.has('ArrowLeft')) ix -= 1;
      if (moveKeys.has('KeyD') || moveKeys.has('ArrowRight')) ix += 1;
      if (moveKeys.has('KeyW') || moveKeys.has('ArrowUp')) iz += 1;
      if (moveKeys.has('KeyS') || moveKeys.has('ArrowDown')) iz -= 1;
      moveIntent.x = 0; moveIntent.z = 0;
      if (ix !== 0 || iz !== 0) {
        const d = stageCamera.mapInput(ix, iz);
        const l = Math.hypot(d.x, d.z) || 1;
        moveIntent.x = d.x / Math.max(1, l); moveIntent.z = d.z / Math.max(1, l);
      }
      const run = moveKeys.has('ShiftLeft') || moveKeys.has('ShiftRight');
      if (mover !== null) {
        mover.update(dt, moveIntent, { run });
        player.x = mover.x; player.y = mover.y; player.z = mover.z;
        if (mover.mode !== 'normal') { moveIntent.x = 0; moveIntent.z = 0; }
      } else {
        const sp = (run ? HUB_SCENE.player?.runSpeed : HUB_SCENE.player?.walkSpeed) ?? 3.5;
        player.x += moveIntent.x * sp * dt; player.z += moveIntent.z * sp * dt;
      }
      const moving = moveIntent.x !== 0 || moveIntent.z !== 0;
      if (playerView !== null) {
        playerView.setPosition(player);
        playerView.setMoving(moving);
        if (moving) playerView.face(moveIntent);
      }
      playerMoveDir.set(-moveIntent.x, 0, moveIntent.z);
      recompute(nowMs);
    }
    playerView?.update(dt);
    hut?.update(dt);
    rainbow?.update(dt, viewCam.quaternion);
    hubChibis?.update(dt);
    if (titleCrowd !== null) { titleCrowd.root.visible = blendTarget === 0 && blend < 0.5; if (titleCrowd.root.visible) titleCrowd.update(dt); }
    stageView.tickWater(dt);

    // camera: follow pose (GameCameraTopDown) <-> title pose, eased
    stageCamera.follow(toThreeV([player.x, player.y, player.z]), playerMoveDir, dt);
    stageCamera.update(dt);
    followPos.copy(stageCamera.camera.position);
    followQuat.copy(stageCamera.camera.quaternion);
    if (blend !== blendTarget) {
      const step = Math.min(wall, 0.25) / CAMERA_BLEND_SECONDS; // wall-clock so slow frames do not stretch the cut
      blend = blendTarget > blend ? Math.min(blendTarget, blend + step) : Math.max(blendTarget, blend - step);
    }
    // first-show intro: closeup on the follow camera -> SwitchCameraTo(title) (zoom + black) -> entrance (see startEntrance)
    if (introPhase === 'closeup') {
      if (introSwitch.inOutPhase) introFov = topDownSwitchOutFov(introFov, SWITCH_TOPDOWN, dt);
      const st = introSwitch.update(dt);
      setFade(st.fade);
      if (st.swapped) { introPhase = 'enter'; blend = 0; blendTarget = 0; startEntrance(); }
    } else if (introSwitch.switching) setFade(introSwitch.update(dt).fade);
    if (introPhase === 'enter') { introEnterWall += wall; if (introEnterWall > 8) introPhase = 'done'; }
    const onFollowCam = introPhase === 'wait' || introPhase === 'closeup';
    const e = onFollowCam ? 1 : blend * blend * (3 - 2 * blend);
    viewCam.position.lerpVectors(titleCamPos, followPos, e);
    viewCam.quaternion.slerpQuaternions(titleCamQuat, followQuat, e);
    viewCam.fov = onFollowCam ? introFov : titlePose.fov + (stageCamera.camera.fov - titlePose.fov) * e;
    viewCam.updateProjectionMatrix();
    viewCam.updateMatrixWorld(true);
    const titleCam = !onFollowCam && blendTarget === 0 && blend < 0.5;
    waterPass.setDof(titleCam ? DOF_PROFILES.title : null);
    waterPass.setPostProfile(titleCam ? titlePost : null); // GameCameraTitle -> 3d_stage_title_1_pp (grade + bloom)
    waterPass.render(viewCam);
  }

  function resize(aspect: number): void {
    stageCamera.resize(aspect);
    viewCam.aspect = aspect;
    viewCam.updateProjectionMatrix();
  }
  resize(window.innerWidth / window.innerHeight);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const safe = (label: string, fn: () => void): void => { try { fn(); } catch (err) { console.warn(`hub dispose: ${label} failed`, err); } };
    safe('listeners', () => ac.abort());
    safe('outline/toon', () => { outlineHandle?.dispose(); toonHandle?.dispose(); });
    safe('skeleton', () => characterRoot.traverse((o) => { (o as THREE.SkinnedMesh).skeleton?.dispose(); }));
    safe('hut', () => hut?.dispose());
    safe('rainbow', () => rainbow?.dispose());
    safe('reflection probe', () => { probeTexture?.dispose(); probeTexture = null; });
    safe('hub chibis', () => hubChibis?.dispose());
    safe('title crowd', () => titleCrowd?.dispose());
    safe('intro fade', () => fadeEl?.remove());
    safe('player', () => playerView?.dispose());
    safe('stage view', () => stageView.dispose());
    safe('water pass', () => waterPass.dispose());
    safe('sky', () => sky.dispose());
    safe('ambient', () => ambient.dispose());
    safe('scene sweep', () => { disposeObject3D(scene); scene.clear(); scene.environment = null; scene.background = null; });
    safe('library', () => library.dispose());
    safe('physics', () => { physics?.world.free(); physics = null; mover = null; });
    listeners.clear();
  }

  const debug: Record<string, unknown> = {
    hubState: () => ({
      mode, player: { ...player }, ui: uiState, blend, loadSeconds: (performance.now() - sceneStart) / 1000,
      moverMode: mover?.mode ?? null, grounded: mover?.groundedCC ?? null,
      unlocked: [...(save?.unlockedStages ?? [])], portals: portals.length, visiblePortals: portals.filter(portalIsVisible).map((p) => p.stage),
      meshes: meshesByNode.size, colliders: physics?.colliderCount() ?? 0,
    }),
    hubTeleport: (x: number, z: number) => { placePlayer([x, 0, z]); mover?.teleportToGround(x, z); if (mover !== null) player.y = mover.y; stageCamera.snap(toThreeV([player.x, player.y, player.z])); recompute(performance.now()); },
    hubTeleportToPortal: (stage: number) => {
      const p = portals.find((q) => stageByScene(q.stage)?.stage === stage);
      if (p === undefined) return false;
      const sp = p.useSpawnPosition && p.spawnPositions.length > 0 ? p.spawnPositions[0] : p.pos;
      placePlayer([sp[0], sp[1], sp[2]]); mover?.teleportToGround(sp[0], sp[2]); if (mover !== null) player.y = mover.y;
      stageCamera.snap(toThreeV([player.x, player.y, player.z])); recompute(performance.now()); return true;
    },
    hubSetMode: (m: HubMode) => setMode(m),
    hubOpenLock: () => openLock(),
    hubPortals: () => portals.map((p) => ({ stage: p.stage, pos: p.pos, visible: portalIsVisible(p) })),
    hubSnapCamera: () => { blend = blendTarget; },
    hubCamera: () => ({ pos: viewCam.position.toArray(), blend }),
    /** Debug: what the title camera sees under NDC (nx,ny in -1..1): nearest hits (mesh/node/material names). */
    hubRainbow: () => rainbow?.state ?? null,
    /** Debug: fast-forward the rainbow emitter by `sec` seconds (headless frames are slow). */
    /** Debug (headless colour calibration): force the title view, apply toggles, render once and read back pixels at NDC points -> [r,g,b] 0..255. */
    hubProbe: (opts: { fog?: { color: number; density: number }; envOff?: boolean; shadows?: boolean; sun?: number; fill?: number; ambient?: number; point?: number; bloom?: number; dof?: boolean; grade?: boolean }, pts: [number, number][]) => {
      const saved = stageView.lights.map((l) => [l, l.intensity, (l as THREE.DirectionalLight).castShadow] as const);
      const amb = ambient.probe.intensity;
      for (const [l, i] of saved) {
        const dl = l as THREE.DirectionalLight;
        if (dl.isDirectionalLight) { if (dl.castShadow || dl.shadow?.camera !== undefined && dl.name === 'Directional Light') l.intensity = i * (opts.sun ?? 1); else l.intensity = i * (opts.fill ?? 1); if (opts.shadows === false) dl.castShadow = false; }
        else l.intensity = i * (opts.point ?? 1);
      }
      ambient.probe.intensity = amb * (opts.ambient ?? 1);
      const prevBloom = titlePost.bloom;
      if (opts.bloom !== undefined) titlePost.bloom = opts.bloom === 0 ? null : { ...TITLE_BLOOM, intensity: TITLE_BLOOM.intensity * opts.bloom };
      waterPass.setPostProfile(null); waterPass.setPostProfile(titlePost);
      waterPass.setDof(opts.dof === false ? null : DOF_PROFILES.title);
      viewCam.position.copy(titleCamPos); viewCam.quaternion.copy(titleCamQuat); viewCam.fov = titlePose.fov; viewCam.updateProjectionMatrix(); viewCam.updateMatrixWorld(true);
      const prevFog = scene.fog; const prevEnv = scene.environment; const prevEI = (scene as unknown as { environmentIntensity?: number }).environmentIntensity;
      if (opts.fog !== undefined) scene.fog = new THREE.FogExp2(opts.fog.color, opts.fog.density);
      if (opts.envOff === true) scene.environment = null;
      renderer.shadowMap.needsUpdate = true;
      waterPass.render(viewCam);
      scene.fog = prevFog; scene.environment = prevEnv; void prevEI;
      const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(4);
      const out = pts.map(([nx, ny]) => { gl.readPixels(Math.round((nx * 0.5 + 0.5) * (w - 1)), Math.round((ny * 0.5 + 0.5) * (h - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]]; });
      for (const [l, i, c] of saved) { l.intensity = i; (l as THREE.DirectionalLight).castShadow = c; }
      ambient.probe.intensity = amb; titlePost.bloom = prevBloom;
      return out;
    },
    hubFreezeRainbow: () => rainbow?.debugFreeze(),
    hubAdvanceRainbow: (sec: number) => { for (let t = 0; t < sec; t += 0.05) rainbow?.update(0.05, viewCam.quaternion); },
    hubPost: () => ({ ...waterPass.postState, blend, blendTarget }),
    hubNode: (n: number) => (meshesByNode.get(n) ?? []).map((o) => { o.updateWorldMatrix(true, false); const b = new THREE.Box3().setFromObject(o); return { name: o.name, world: o.getWorldPosition(new THREE.Vector3()).toArray(), visible: o.visible, parent: o.parent?.name, parentWorld: o.parent?.getWorldPosition(new THREE.Vector3()).toArray(), box: [...b.min.toArray(), ...b.max.toArray()].map((v) => +v.toFixed(1)) }; }),
    hubPick: (nx: number, ny: number) => {
      viewCam.updateMatrixWorld();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(nx, ny), viewCam);
      return rc.intersectObjects(scene.children, true).slice(0, 4).map((h) => {
        const o = h.object as THREE.Mesh;
        const m = o.material as THREE.Material | THREE.Material[];
        return { d: +h.distance.toFixed(2), name: o.name, node: o.userData?.nodeIndex ?? null, mat: Array.isArray(m) ? m.map((x) => x.name) : m?.name, at: h.point.toArray().map((v) => +v.toFixed(2)) };
      });
    },
  };

  return {
    sceneId: '3d_stage_000',
    get disposed() { return disposed; },
    get mode() { return mode; },
    get introPending() { return introPhase !== 'done'; },
    beginIntro() { if (introPhase === 'wait') { introPhase = 'closeup'; introFov = stageCamera.camera.fov; introSwitch.request(); } },
    debug,
    setMode,
    onState(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    frame,
    resize,
    dispose,
  };
}
