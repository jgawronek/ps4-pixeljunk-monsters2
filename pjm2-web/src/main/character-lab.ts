// src/main/character-lab.ts
// Character-viewer dev page (characters.html): visual-verification harness for
// the step-4b character layer. Loads five lab characters through
// CharacterLibrary, instantiates them through the REAL contract views
// (EnemyStageView / TowerStageView), and exercises the contract surface:
//   - enemies walk a circle in UNITY space via view.transform.position /
//     rotation writes (proves the LH→RH mirror + facing path),
//   - towers sweep their fort direction (tower_rot_y / tower_rot_x joints),
//   - every clip of each GLB is playable from its dropdown.
// Perf HUD mirrors the stage-viewer pattern. View-layer only — no sim tick.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CharacterLibrary } from '../view/characters/CharacterLibrary';
import { EnemyStageView } from '../view/characters/EnemyStageView';
import { TowerStageView } from '../view/characters/TowerStageView';
import type { TowerBaseContract } from '../view/q4-contracts';

const ENEMY_DEFS = ['kuri_00_001', 'spider_00_001', 'giant_00_001'];
const TOWER_DEFS = ['tower_001', 'tower_002'];
const ALL_DEFS = [...ENEMY_DEFS, ...TOWER_DEFS];

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const panel = document.getElementById('panel')!;
const loading = document.getElementById('loading')!;
const loadingBar = document.getElementById('loading-bar') as HTMLElement;
const loadingText = document.getElementById('loading-text')!;

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a8c8);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(6, 7, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbdd3e8, 0x5a6b4a, 0.8));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(18, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x6d8f5a, roughness: 0.95 }),
);
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(36, 36, 0x33502a, 0x4a6b3d));

// ---- minimal tower prefab records (data fields the view delegates; stats
// are display-only here — the real records come from the data lane) ----
function labTowerPrefab(name: string, firePointNames: string[] | null): TowerBaseContract {
  return {
    name,
    gameObject: null,
    transform: { position: { x: 0, y: 0, z: 0 } },
    nextTargetToAttackIndex: 0,
    attackType: 1 as TowerBaseContract['attackType'],
    strengthType: 0 as TowerBaseContract['strengthType'],
    classType: 0 as TowerBaseContract['classType'],
    balloonAimable: false,
    attackPower: 10,
    attackSpeed: 1,
    attackRangeInner: 5,
    attackSpread: 0,
    costCoin: 100,
    costGem: 0,
    buildTime: 1,
    buildRange: 2,
    refundCoin: 50,
    refundGem: 0,
    magazineCapacity: 1,
    rotateSpeedX: 90,
    rotateSpeedXAcel: 180,
    rotateSpeedXDecl: 180,
    rotateSpeedY: 90,
    rotateSpeedYAcel: 180,
    rotateSpeedYDecl: 180,
    oneShotOneBalloon: false,
    fullRangeFire: true,
    fireAngleThreshold: 360,
    attackAttenuations: [],
    burstCount: 1,
    burstInterval: 0,
    cautionRange: 45,
    cautionIdleTime: 2,
    cautionRotateSpeed: 30,
    cautionRotateAngleMin: 30,
    playerDetectionRange: 2,
    firePointNames,
    projectile: null,
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => null,
    getFirePointByRemainingMag: () => ({ x: 0, y: 0, z: 0 }),
  };
}

// ---- load + build the gallery ----
interface LabEntry {
  defName: string;
  kind: 'enemy' | 'tower';
  enemy?: EnemyStageView;
  tower?: TowerStageView;
  /** Per-frame demo driver. */
  drive?: (t: number, dt: number) => void;
}
const entries: LabEntry[] = [];

const library = new CharacterLibrary('/assets/characters/');
library
  .loadMany(ALL_DEFS, (p) => {
    loadingBar.style.width = `${((p.loaded / p.total) * 100).toFixed(1)}%`;
    loadingText.textContent = `${p.loaded}/${p.total}: ${p.defName}`;
  })
  .then(() => {
    // Enemies walk a circle (UNITY-space writes → three mirror inside the view).
    ENEMY_DEFS.forEach((def, i) => {
      const enemy = new EnemyStageView(library.instantiate(def));
      scene.add(enemy.root);
      enemy.setAnimState('walk');
      const radius = 5;
      const phase = (i / ENEMY_DEFS.length) * Math.PI * 2;
      const entry: LabEntry = {
        defName: def,
        kind: 'enemy',
        enemy,
        drive: (t) => {
          const a = t * 0.5 + phase;
          const ux = Math.cos(a) * radius;
          const uz = Math.sin(a) * radius;
          enemy.transform.position = { x: ux, y: 0, z: uz };
          // Unity yaw quat (0, sin(yaw/2), 0, cos(yaw/2)); yaw from velocity.
          const vx = -Math.sin(a);
          const vz = Math.cos(a);
          const yaw = Math.atan2(vx, vz);
          enemy.transform.rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
        },
      };
      entries.push(entry);
    });

    // Towers stand on the back row sweeping their fort direction.
    TOWER_DEFS.forEach((def, i) => {
      const prefab = labTowerPrefab(
        def,
        def === 'tower_001' ? ['cannonball_default_pos'] : ['bullet_pos'],
      );
      const tower = new TowerStageView(
        prefab,
        library.instantiate(def),
        { x: -3 + i * 6, y: 0, z: -8 },
        { x: 0, y: 0, z: 0 },
      );
      scene.add(tower.root);
      tower.setAnimState(def === 'tower_001' ? 'close_idle' : 'ready_to_fire');
      const phase = i * Math.PI;
      const entry: LabEntry = {
        defName: def,
        kind: 'tower',
        tower,
        drive: (t) => {
          const a = t * 0.7 + phase;
          tower.setFortDirection({ x: Math.cos(a), y: 0.15 * Math.sin(t * 0.9), z: Math.sin(a) });
        },
      };
      entries.push(entry);
    });

    buildPanel();
    loading.remove();
    console.info('[character-lab] loaded', ALL_DEFS);
  })
  .catch((err) => {
    loadingText.textContent = `LOAD FAILED: ${err}`;
    console.error(err);
  });

/** Per-character clip dropdown + label (visual checklist companion). */
function buildPanel(): void {
  for (const entry of entries) {
    const view = entry.enemy ?? entry.tower!;
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = entry.defName;
    const select = document.createElement('select');
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = '(demo driver)';
    select.appendChild(auto);
    for (const clipName of view.clipNames()) {
      const opt = document.createElement('option');
      opt.value = clipName;
      opt.textContent = clipName;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      if (select.value === '') {
        if (entry.enemy) entry.enemy.setAnimState('walk');
        else if (entry.tower) entry.tower.setAnimState('ready_to_fire');
      } else {
        view.playClipByName(select.value);
      }
    });
    row.appendChild(label);
    row.appendChild(select);
    panel.appendChild(row);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- RAF loop (same shape as stage-viewer.ts) ----
let lastTime = performance.now();
let elapsed = 0;
let fpsAccum = 0;
let fpsFrames = 0;
let fpsDisplay = 0;
let maxFrameMs = 0;

function frame(now: number): void {
  const wallDelta = (now - lastTime) / 1000;
  lastTime = now;
  const dt = Math.min(wallDelta, 0.5);
  elapsed += dt;

  for (const entry of entries) {
    entry.drive?.(elapsed, dt);
    (entry.enemy ?? entry.tower)!.update(dt);
  }
  controls.update();
  renderer.render(scene, camera);

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
      `pjm2 character-lab | ${fpsDisplay} fps | worst ${maxFrameMs.toFixed(1)}ms | ` +
      `calls ${info.calls} tris ${(info.triangles / 1000).toFixed(0)}k | ` +
      `chars ${entries.length}/${ALL_DEFS.length} | ` +
      `WebGL${renderer.capabilities.isWebGL2 ? '2' : '1'} | DPR ${renderer.getPixelRatio()}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
