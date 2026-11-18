// src/main/browser.ts
// Browser entry point — currently the Phase-0 RENDER/TOOLCHAIN bootstrap:
// proves Vite + Three.js + WebGL2 + the tick-seam loop structure work end to
// end at 60fps+ before any game content exists. A real viewer/driver replaces
// the placeholder scene in Phase 3.
//
// The RAF loop below mirrors the ORIGINAL seam contract verified from the
// Q4.GameCoreBridge reconstruction (decomp/src/Q4/GameCoreBridge.cs):
//   one sim tick per frame; dt = min(wallDelta, 0.5); updateCount++;
//   (rngSeed=InitState(updateCount) + command execution slot marked below).
// Keeping this shape from day one means the sim driver drops straight in.

import * as THREE from 'three';

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

// ---- renderer / scene (placeholder until Phase 3) ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // DPR cap per perf plan
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 2.2, 6);
camera.lookAt(0, 0.6, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(3, 6, 4);
scene.add(sun);

// Ground grid = stylized stand-in for a stage; spinning knot = draw/render proof.
const grid = new THREE.GridHelper(24, 24, 0x3a7d44, 0x22442a);
scene.add(grid);
const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.8, 0.26, 160, 24),
  new THREE.MeshStandardMaterial({ color: 0xe8b64c, roughness: 0.45, metalness: 0.05 }),
);
knot.position.y = 1.1;
scene.add(knot);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- tick-seam loop (shape of the original bridge.Update) ----
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
  // viewer updates + render
  // CoreEventBase.invokePendingPostUnityUpdateEvents()

  // placeholder visuals
  knot.rotation.x += dt * 0.8;
  knot.rotation.y += dt * 1.1;
  renderer.render(scene, camera);

  // perf HUD (Phase 0 gate: sustained 60fps+, watch worst frame)
  const frameMs = wallDelta * 1000;
  if (frameMs > maxFrameMs && fpsFrames > 10) maxFrameMs = frameMs;
  fpsAccum += wallDelta;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsDisplay = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
    hud.textContent =
      `pjm2-web bootstrap | ${fpsDisplay} fps | worst ${maxFrameMs.toFixed(1)}ms | ` +
      `ticks ${updateCount} | WebGL${renderer.capabilities.isWebGL2 ? '2' : '1'} | ` +
      `DPR ${renderer.getPixelRatio()}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
