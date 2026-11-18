// tests/view/buildMenuSim.test.ts
// END-TO-END (real sim): the build ring -> BuildTowerCommand -> GameCoreTower in
// TowerStateBuild, coins/gems deducted, tree claimed, tower type = the selected
// option. DOM is a permissive fake (the ring DOM itself is covered by the UI lab
// screenshots); everything the sim sees is real.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { EInventoryType, GameCoreInventory } from '../../src/core/GameCoreInventory';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import type { NetworkCommand } from '../../src/core/network/NetworkCommand';
import { setSimPhysics } from '../../src/core/physics-seam';
import { TowerStateBuild } from '../../src/core/TowerStateBuild';
import {
  getRegisteredUnityObject, registerUnityObject, resetUnityObjectRegistryForTests,
  setCurrentStageProvider, setDebugCanvasProvider, setTowerDatabaseProvider, setViewObjectByNameFinder,
  type NatureTreeViewContract, type TowerBaseContract,
} from '../../src/view/q4-contracts';
import { ETowerAttackDef, EEnemyClassTypeDef, EEnemyStrengthTypeDef } from '../../src/core/enums';
import { BuildMenuFeature } from '../../src/view/ui/BuildMenuFeature';
import { emptyUiAssets } from '../../src/view/ui/UiAssets';

const P = (x: number, y: number, z: number) => new Vector3(x, y, z);
const defs = JSON.parse(readFileSync(resolve(__dirname, '../../public/assets/data/towers.json'), 'utf8')) as Record<string, unknown>[];

/** Permissive element: any method is a no-op, properties store. */
function fakeEl(): never {
  const target: Record<string, unknown> = { style: {}, children: [], textContent: '' };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : () => fakeEl()),
    set: (t, k, v) => { t[k as string] = v; return true; },
  }) as never;
}

function contract(raw: Record<string, unknown>): TowerBaseContract {
  return {
    name: String(raw.__gameObject), gameObject: {}, transform: { position: { x: 0, y: 0, z: 0 } },
    singletonInScene: raw.singletonInScene === 1,
    nextTargetToAttackIndex: 0, attackType: raw.attackType as ETowerAttackDef,
    strengthType: EEnemyStrengthTypeDef.Normal, classType: EEnemyClassTypeDef.Normal,
    balloonAimable: true, attackPower: raw.attackPower as number, attackSpeed: raw.attackSpeed as number,
    attackRangeInner: raw.attackRangeInner as number, attackSpread: raw.attackSpread as number,
    costCoin: raw.costCoin as number, costGem: raw.costGem as number,
    buildTime: raw.buildTime as number, buildRange: raw.buildRange as number,
    refundCoin: raw.refundCoin as number, refundGem: raw.refundGem as number,
    magazineCapacity: 3, rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180, oneShotOneBalloon: false,
    fullRangeFire: true, fireAngleThreshold: 30, attackAttenuations: [], burstCount: 1, burstInterval: 0,
    cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30, cautionRotateAngleMin: 10,
    playerDetectionRange: 2, firePointNames: ['firePoint'],
    projectile: {
      getFireDirection: (a: Vector3, b: Vector3) => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }),
      getGameCoreType: () => null as never,
    },
    getComponentTowerUpgradeSetting: () => null, getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => 3, getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
  } as TowerBaseContract;
}

function treeViewer(): NatureTreeViewContract {
  return {
    playerDetectionRange: 2, towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null, getHiddenTreePickup: () => null,
    transform: { position: { x: 40, y: 0, z: 40 } }, gameObject: { activeSelf: true, setActive: () => {} },
  } as NatureTreeViewContract;
}

let core: GameCore;
const contracts = new Map<string, TowerBaseContract>();
const meta = new Map<string, { lockable: boolean; dlcLock: number }>();

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics({ linecast: () => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
  setDebugCanvasProvider(() => null);
  setCurrentStageProvider(() => ({ initCoin: 2000, initGem: 20, initWaveCoinRate: 1, initWaveTimeRate: 1.75 }));
  contracts.clear(); meta.clear();
  for (const d of defs) {
    const c = contract(d);
    contracts.set(c.name, c);
    meta.set(c.name, { lockable: d.lockable === true, dlcLock: (d.dlcLock as number) | 0 });
  }
  setTowerDatabaseProvider(() => ({ getData: (n: string) => contracts.get(n) ?? null }));
  vi.stubGlobal('document', { createElement: () => fakeEl(), body: fakeEl() });
  vi.stubGlobal('window', { addEventListener: () => undefined, innerWidth: 1920, innerHeight: 1080 });
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; src = ''; });
});

afterEach(() => {
  setInstanceProvider(null); setFrameResolver(null); setViewerResolver(null); setBoundsProvider(null);
  setSimPhysics(null); setCurrentStageProvider(() => null); setTowerDatabaseProvider(null);
  setViewObjectByNameFinder(null); resetUnityObjectRegistryForTests();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

function setup(opts: { coins?: number; gems?: number; towerSelected?: boolean } = {}) {
  const player = new GameCorePlayer();
  player.playerId = 1;
  player.position = P(41, 0, 40); // 1 unit from the tree
  const tree = new GameCoreTree(P(40, 0, 40));
  registerUnityObject(tree.handle.m_handle, treeViewer());
  const inv = GameCoreInventory.getInventoryObject()!;
  if (opts.coins !== undefined) {
    const have = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    if (opts.coins < have) inv.removeInventory(player.handle, EInventoryType.Coin, have - opts.coins, true);
  }
  if (opts.gems !== undefined) {
    const have = inv.getAvailableInventory(player.handle, EInventoryType.Gem);
    if (opts.gems < have) inv.removeInventory(player.handle, EInventoryType.Gem, have - opts.gems, true);
  }
  const sounds: string[] = [];
  const issued: NetworkCommand[] = [];
  const feature = new BuildMenuFeature({
    assets: emptyUiAssets(),
    uiRoot: { el: fakeEl(), toRef: (x: number, y: number) => ({ x, y }) } as never,
    player: () => player, inventory: () => inv, trees: () => [tree],
    towers: () => contracts, towerMeta: () => meta,
    // the game's driver.addPlayerCommand executes between prepare and tick; the sim
    // result is what matters, so run the command directly against the real sim.
    issue: (cmd) => { issued.push(cmd); cmd.executeCommand(player); },
    playSound: (n) => sounds.push(n),
    strings: () => ({}),
    project: () => ({ x: 960, y: 540, visible: true }),
    preview: () => undefined,
    towerSelected: () => opts.towerSelected === true,
    blocked: () => false,
    singletonBuilt: (name) => [...core.allObjects<GameCoreTower>(GameCoreTower)].some((t) => (t as unknown as { prefabName: string }).prefabName === name),
  });
  feature.update(1 / 60); // hover the tree
  return { player, tree, inv, feature, sounds, issued };
}

/** Drive the ring with the keyboard: E opens, direction keys pick the category, E enters, hover slot, E builds. */
function pickViaKeys(f: BuildMenuFeature, category: number, slot: number): void {
  const dir = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][category];
  expect(f.onKey('KeyE')).toBe(true); // open
  f.onKey(dir); f.onKey(dir); // (hold) point at the category
  f.onKeyUp(dir);
  expect(f.model.category).toBe(category);
  expect(f.onKey('KeyE')).toBe(true); // enter category
  expect(f.model.phase).toBe('icon');
  if (f.model.slot !== slot) expect(f.model.hoverSlot(slot)).toBe(true);
  expect(f.onKey('KeyE')).toBe(true); // confirm build
}

const OPTIONS: { category: number; slot: number; tower: string }[] = [
  { category: 3, slot: 7, tower: 'tower_001' }, { category: 3, slot: 6, tower: 'tower_002' },
  { category: 3, slot: 8, tower: 'tower_003' }, { category: 3, slot: 1, tower: 'tower_004' },
  { category: 3, slot: 5, tower: 'tower_006' }, { category: 0, slot: 1, tower: 'tower_007' },
  { category: 0, slot: 2, tower: 'tower_008' }, { category: 0, slot: 8, tower: 'tower_009' },
  { category: 1, slot: 3, tower: 'tower_011' }, { category: 1, slot: 4, tower: 'tower_012' },
];

describe('build ring -> BuildTowerCommand -> real sim', () => {
  for (const o of OPTIONS) {
    it(`${o.tower}: selecting it builds that tower on that tree and charges its cost`, () => {
      const { player, tree, inv, feature, issued } = setup();
      const c0 = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
      const g0 = inv.getAvailableInventory(player.handle, EInventoryType.Gem);
      const builds: GameCoreTower[] = [];
      Events.towerBuildEvent.addListener((t: GameCoreTower) => builds.push(t), EventTime.Immediate);

      pickViaKeys(feature, o.category, o.slot);

      expect(issued).toHaveLength(1);
      expect((issued[0] as unknown as { towerType: string }).towerType).toBe(o.tower);
      expect(builds).toHaveLength(1);
      expect((builds[0] as unknown as { prefabName: string }).prefabName).toBe(o.tower);
      expect(tree.referenceCount).toBe(1); // claimed
      expect(builds[0].getTowerState()).toBeInstanceOf(TowerStateBuild);
      const def = contracts.get(o.tower)!;
      expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(c0 - def.costCoin);
      expect(inv.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(g0 - def.costGem);
      expect(feature.model.isOpen).toBe(false); // ring closes (Decide state)
    });
  }

  it('unaffordable option: no command, no charge, reject feedback sound + ring stays open', () => {
    const { player, tree, inv, feature, sounds, issued } = setup({ coins: 100 });
    pickViaKeys(feature, 3, 7); // tower_001 costs 120
    expect(issued).toHaveLength(0);
    expect(tree.referenceCount).toBe(0);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(100);
    expect(sounds).toContain('sfx/sfx_ringmenu_notenoughresources');
    expect(feature.model.isOpen).toBe(true);
  });

  it('gem-priced option with no gems is rejected too', () => {
    const { feature, issued, sounds } = setup({ gems: 0 });
    pickViaKeys(feature, 3, 6); // tower_002: 400 coins + 5 gems
    expect(issued).toHaveLength(0);
    expect(sounds).toContain('sfx/sfx_ringmenu_notenoughresources');
  });

  it('key handling: Q/Escape cancel, the tower-level ring keeps E when a tower is selected', () => {
    const a = setup();
    expect(a.feature.onKey('KeyE')).toBe(true);
    expect(a.feature.onKey('KeyW')).toBe(true); // W is consumed while open (no player walk)
    expect(a.feature.onKey('Escape')).toBe(true);
    expect(a.feature.model.isOpen).toBe(false);
    const b = setup({ towerSelected: true });
    expect(b.feature.onKey('KeyE')).toBe(false); // tower ring owns interact
    expect(b.feature.model.isOpen).toBe(false);
  });

  it('E does nothing when no tree is within reach', () => {
    const { feature, player } = setup();
    player.position = P(60, 0, 60);
    feature.update(1 / 60);
    expect(feature.onKey('KeyE')).toBe(false);
  });
});
