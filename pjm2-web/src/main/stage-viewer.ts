// src/main/stage-viewer.ts
// Stage-scene dev page (stage.html): loads the extracted 3d_stage_001 scene with
// a loading bar, then runs the tick-seam RAF loop from browser.ts with the PJM2
// camera rig, extracted lights + GI-compensation fill, and click-to-log ground
// picking. View-layer only — no sim tick is wired yet (Phase-1 seam kept as
// comments, same as browser.ts).

import * as THREE from 'three';
import { StageSceneView, type StageSceneStats } from '../view/stage/StageSceneView';
import { StageCamera } from '../view/stage/StageCamera';
import { GroundPicker } from '../view/stage/GroundPicker';

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const loading = document.getElementById('loading')!;
const loadingBar = document.getElementById('loading-bar') as HTMLElement;
const loadingText = document.getElementById('loading-text')!;

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // DPR cap per perf plan
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c8); // placeholder sky (no skybox exported)

const stageCamera = new StageCamera();
stageCamera.resize(window.innerWidth / window.innerHeight);

// No lightmaps/GI were exported (report §7.2) — compensate with a soft hemisphere
// fill so shadowed sides aren't pitch black. Revisit when lightmaps land.
const fill = new THREE.HemisphereLight(0xbdd3e8, 0x5a6b4a, 0.55);
scene.add(fill);

// ---- stage load (progressive) ----
const picker = new GroundPicker();
let stageStats: StageSceneStats | null = null;

const view = new StageSceneView({
  baseUrl: '/assets/stages/3d_stage_001/',
  renderer,
  onProgress: (p) => {
    const pct = p.totalBytes > 0 ? (p.loadedBytes / p.totalBytes) * 100 : 0;
    loadingBar.style.width = `${pct.toFixed(1)}%`;
    loadingText.textContent =
      `${p.phase}: ${p.detail} — ${(p.loadedBytes / 1e6).toFixed(0)}/${(p.totalBytes / 1e6).toFixed(0)} MB`;
  },
});

view.load().then(() => {
  scene.add(view.group);
  picker.setTargets(view.terrainPickMeshes);
  stageStats = view.stats;
  loading.remove();
  console.info('[stage-viewer] stage loaded', stageStats);
}).catch((err) => {
  loadingText.textContent = `LOAD FAILED: ${err}`;
  console.error(err);
});

// ---- input ----
stageCamera.attach(renderer.domElement);

renderer.domElement.addEventListener('click', (e) => {
  if (!stageStats) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const world = picker.pick(e.clientX, e.clientY, rect, stageCamera.camera);
  const unity = picker.pickUnity(e.clientX, e.clientY, rect, stageCamera.camera);
  if (world && unity) {
    console.info(
      `[pick] three(RH) x=${world.x.toFixed(2)} y=${world.y.toFixed(2)} z=${world.z.toFixed(2)}` +
      ` | unity(LH) x=${unity.x.toFixed(2)} y=${unity.y.toFixed(2)} z=${unity.z.toFixed(2)}`,
    );
  } else {
    console.info('[pick] no terrain hit');
  }
});

window.addEventListener('resize', () => {
  stageCamera.resize(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- tick-seam loop (same shape as browser.ts / the original bridge.Update) ----
let updateCount = 0;
let lastTime = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let fpsDisplay = 0;
let maxFrameMs = 0;

function frame(now: number): void {
  const wallDelta = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(wallDelta, 0.5); // GameCore.Tick: TickDeltaTime = Min(Time.deltaTime, 0.5)

  // --- sim seam (empty until the core spine lands) ---
  updateCount++;
  // Random.InitState(updateCount)            ← Phase 1: engine/rng
  // bridge.prepareNextFrame()                ← Phase 1: GameCoreFrame
  // execute queued NetworkCommands           ← Phase 1: command queue
  // gameCore.tick(dt)                        ← Phase 1: GameCore.Tick
  // CoreEventBase.invokePendingPostGameCoreTickEvents()
  // --- view seam ---
  stageCamera.update(dt);
  renderer.render(scene, stageCamera.camera);
  // CoreEventBase.invokePendingPostUnityUpdateEvents()

  // perf HUD
  const frameMs = wallDelta * 1000;
  if (frameMs > maxFrameMs && fpsFrames > 10) maxFrameMs = frameMs;
  fpsAccum += wallDelta;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsDisplay = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
    const info = renderer.info.render;
    hud.textContent =
      `pjm2 stage-viewer | ${fpsDisplay} fps | worst ${maxFrameMs.toFixed(1)}ms | ` +
      `calls ${info.calls} tris ${(info.triangles / 1000).toFixed(0)}k | ` +
      (stageStats
        ? `meshes ${stageStats.mergedDrawMeshes} mats ${stageStats.materialsBuilt} ` +
          `tex ${stageStats.texturesLoaded}/77 | `
        : 'loading | ') +
      `WebGL${renderer.capabilities.isWebGL2 ? '2' : '1'} | DPR ${renderer.getPixelRatio()}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
