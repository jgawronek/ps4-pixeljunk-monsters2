// tests/view/towerLevel.test.ts
// Tower level / upgrade feature: upgrade table + ApplyUpgrade stat writes,
// UpgradeTowerCommand end-to-end through the real GameCoreTower sim, EXP gauge
// model, dance-EXP state machine (Q4.Player.CheckForTowers), ring-menu state
// machine (RingStateEvolveUpgrade/Sell) and the DOM overlay (fake DOM).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import type { RaycastHit } from '../../src/engine/physics/queries';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EnemyDetectorSphere } from '../../src/core/EnemyDetectorSphere';
import { resetAllEventsForTests, Events } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { EInventoryType, GameCoreInventory } from '../../src/core/GameCoreInventory';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { setSimPhysics } from '../../src/core/physics-seam';
import { ETowerAttackDef } from '../../src/core/enums';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setDebugCanvasProvider,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';
import {
  buildUpgradeSettings,
  TowerUpgradeSettingGeneric,
  type TowerUpgradeTable,
} from '../../src/view/tower/TowerUpgradeSetting';
import {
  ExpGaugeState,
  gaugeStart,
  gaugeTarget,
  levelLabel,
  levelStringKey,
} from '../../src/view/tower/TowerLevelModel';
import { DanceState, TowerDanceExp, DEFAULT_DANCE_PARAMS } from '../../src/view/tower/TowerDanceExp';
import { RING_SOUND, TowerInteraction } from '../../src/view/tower/TowerInteraction';
import { UpgradeTowerCommand } from '../../src/core/network/UpgradeTowerCommand';
import { SellTowerCommand } from '../../src/core/network/SellTowerCommand';
import { TowerLevelUi } from '../../src/view/ui/TowerLevelUi';

const f = Math.fround;
const table = JSON.parse(
  readFileSync(new URL('../../public/assets/data/tower-upgrades.json', import.meta.url), 'utf8'),
) as TowerUpgradeTable;
const settings = buildUpgradeSettings(table);

let core: GameCore;
beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  resetUnityObjectRegistryForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(0, 0, 0), new Vector3(128, 80, 128)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  core.tick(1 / 60);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics({ linecast: (): RaycastHit | null => null, raycast: () => null, sphereCast: () => null, checkSphere: () => false });
});
afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setDebugCanvasProvider(() => null);
  resetUnityObjectRegistryForTests();
});

function arrowData(): TowerBaseContract {
  return {
    name: 'tower_001',
    gameObject: {},
    transform: { position: { x: 40, y: 0, z: 40 } },
    nextTargetToAttackIndex: 0,
    attackType: ETowerAttackDef.all,
    strengthType: 1, classType: 1, balloonAimable: false,
    attackPower: 200, attackSpeed: 6.25, attackRangeInner: 2, attackSpread: 3.3,
    costCoin: 120, costGem: 0, buildTime: 2, buildRange: 2, refundCoin: 90, refundGem: 0,
    magazineCapacity: -1,
    rotateSpeedX: 90, rotateSpeedXAcel: 180, rotateSpeedXDecl: 180,
    rotateSpeedY: 90, rotateSpeedYAcel: 180, rotateSpeedYDecl: 180,
    oneShotOneBalloon: false, fullRangeFire: true, fireAngleThreshold: 30, attackAttenuations: [],
    burstCount: 1, burstInterval: 0, cautionRange: 45, cautionIdleTime: 1, cautionRotateSpeed: 30,
    cautionRotateAngleMin: 10, playerDetectionRange: 1.5, firePointNames: ['p'],
    projectile: { getFireDirection: (a: any, b: any) => b, getGameCoreType: () => null as any },
    getComponentTowerUpgradeSetting: () => settings.get('tower_001') ?? null,
    getComponentEnemyDetectorView: () => ({
      createGameCoreDetector: () => new EnemyDetectorSphere(new Vector3(0, 1, 0), 5, 1),
    }),
    findDeepChildY: () => 3,
    getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
  } as unknown as TowerBaseContract;
}

function makeTower(): GameCoreTower {
  const tower = new GameCoreTower('tower_001', []);
  tower.position = new Vector3(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, arrowData());
  tower.initialize();
  return tower;
}

describe('upgrade data (structures_TowerUpgradeSettingGeneric.json)', () => {
  it('tower_001 has Lv2..Lv5 with gem-only costs 1/1/2/3 and reachExp 100/287/568/1037', () => {
    const rows = table['tower_001'];
    expect(rows.map((r) => r.level)).toEqual([2, 3, 4, 5]);
    expect(rows.map((r) => r.reachExp)).toEqual([100, 287, 568, 1037]);
    expect(rows.map((r) => r.costGem)).toEqual([1, 1, 2, 3]);
    expect(rows.every((r) => r.costCoin === 0)).toBe(true);
    expect(rows.map((r) => r.attackPower)).toEqual([250, 300, 420, 660]);
    expect(rows.map((r) => r.refundGem)).toEqual([0, 1, 2].length ? [0, 0, 1, 2] : []);
  });
  it('lookup mirrors GetUpgrade/GetCurrentUpgrade/GetNextUpgrade', () => {
    const s = settings.get('tower_001')!;
    const tower = makeTower();
    expect(tower.currentLevel).toBe(1);
    expect(s.getCurrentUpgrade(tower)).toBeNull(); // no Lv1 row
    expect(s.getNextUpgrade(tower)!.level).toBe(2);
    expect(s.getUpgrade(6)).toBeNull();
  });
});

describe('upgrade through the sim', () => {
  it('GrantEXP at reachExp applies ApplyUpgrade stats (attackPower/refund) and the level', () => {
    const tower = makeTower();
    const ups: number[] = [];
    Events.towerUpgradeEvent.addListener((_t: GameCoreTower, u: { level: number }) => ups.push(u.level), 0 as never);
    tower.grantEXP(99, null);
    expect(tower.currentLevel).toBe(1);
    tower.grantEXP(1, null);
    expect(tower.currentLevel).toBe(2);
    expect(tower.attackPower).toBe(f(250));
    expect(tower.refundCoin).toBe(90);
    expect(tower.costGem).toBe(1); // ApplyUpgrade overwrites tower cost with the row cost
    expect(tower.getNextUpgrade()!.level).toBe(3);
  });
  it('reaches max level: no next upgrade, further EXP ignored', () => {
    const tower = makeTower();
    tower.grantEXP(5000, null); // one grant crosses at most one level (upgradeTower once)
    for (let i = 0; i < 6; i++) tower.grantEXP(5000, null);
    expect(tower.currentLevel).toBe(5);
    expect(tower.getNextUpgrade()).toBeNull();
    expect(tower.attackPower).toBe(f(660));
    expect(tower.refundGem).toBe(2);
    const exp = tower.currentEXP;
    tower.grantEXP(100, null);
    expect(tower.currentEXP).toBe(exp);
  });
  it('UpgradeTowerCommand tops EXP up, levels the tower and charges the gem cost', () => {
    const player = new GameCorePlayer();
    player.playerId = 1;
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(player.handle, EInventoryType.Gem, 5);
    const tower = makeTower();
    tower.grantEXP(40, null);
    new UpgradeTowerCommand(tower.handle, 2).executeCommand(player);
    expect(tower.currentLevel).toBe(2);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(4);
    // wrong level request is ignored
    new UpgradeTowerCommand(tower.handle, 5).executeCommand(player);
    expect(tower.currentLevel).toBe(2);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(4);
  });
});

describe('level model (TowerEXPGauge)', () => {
  it('gauge target = (level-1) + rate; fill is the fractional part', () => {
    const tower = makeTower();
    tower.grantEXP(50, null); // Lv1, 50/100
    expect(gaugeTarget(tower)).toBeCloseTo(0.5, 5);
    const g = new ExpGaugeState();
    g.onGrant(tower, 10);
    expect(g.active).toBe(true);
    expect(g.visible).toBe(true);
    for (let i = 0; i < 400; i++) g.update(1 / 60);
    expect(g.visible).toBe(false); // 2s show window elapsed
    expect(g.active).toBe(false); // deactivated 3s after expiry
  });
  it('start value uses pre-grant EXP over the CURRENT level span (faithful)', () => {
    const tower = makeTower();
    tower.grantEXP(60, null);
    expect(gaugeStart(tower, 10)).toBeCloseTo(0.5, 5);
  });
  it('max level hides the gauge', () => {
    const tower = makeTower();
    for (let i = 0; i < 6; i++) tower.grantEXP(5000, null);
    const g = new ExpGaugeState();
    g.onGrant(tower, 1);
    expect(g.maxed).toBe(true);
    expect(g.active).toBe(false);
  });
  it('level strings', () => {
    expect(levelStringKey(2)).toBe('tl_hud_level_002');
    expect(levelStringKey(9)).toBe('tl_hud_level_005');
    expect(levelLabel('Lv.5#')).toBe('Lv.5');
  });
});

describe('dance EXP (Q4.Player.CheckForTowers)', () => {
  const base = (tower: GameCoreTower | null) => ({
    dt: 1 / 60, still: true, standing: true, gameOver: false,
    nearestTower: tower, towerBusy: false, isNearestSelection: true, expRate: 1,
  });
  it('waits until IdleTime >= 0.75 (1.125 s at idleDur 1.5), then pays 0.612 EXP every 0.1 s', () => {
    const tower = makeTower();
    const d = new TowerDanceExp();
    let t = 0;
    let firstGrantAt = -1;
    let total = 0;
    let grants = 0;
    for (let i = 0; i < 60 * 3; i++) {
      t += 1 / 60;
      const g = d.update(base(tower));
      if (g !== null) {
        if (firstGrantAt < 0) firstGrantAt = t;
        total += g.amount;
        grants++;
      }
    }
    expect(firstGrantAt).toBeGreaterThan(1.1);
    expect(firstGrantAt).toBeLessThan(1.35);
    expect(d.danceState).toBe(DanceState.Dancing);
    expect(total / grants).toBeCloseTo(DEFAULT_DANCE_PARAMS.amount, 6);
    expect(grants).toBeGreaterThan(12); // ~ (3 - 1.2) / 0.1 minus frame quantisation
  });
  it('moving, build state, wrong selection or max level resets/decays to None', () => {
    const tower = makeTower();
    const d = new TowerDanceExp();
    for (let i = 0; i < 100; i++) d.update(base(tower));
    expect(d.danceState).toBe(DanceState.Dancing);
    d.update({ ...base(tower), still: false });
    expect(d.danceState).toBe(DanceState.None);
    expect(d.idleTime).toBe(0);
    for (let i = 0; i < 100; i++) d.update(base(tower));
    d.update({ ...base(tower), isNearestSelection: false });
    expect(d.danceState).toBe(DanceState.None);
    for (let i = 0; i < 6; i++) tower.grantEXP(5000, null);
    for (let i = 0; i < 100; i++) expect(d.update(base(tower))).toBeNull(); // max level: no dance
  });
});

describe('ring menu (TowerInteraction)', () => {
  function rig(gems: number) {
    const player = new GameCorePlayer();
    player.playerId = 1;
    player.position = new Vector3(40.5, 0, 40);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(player.handle, EInventoryType.Gem, gems);
    const tower = makeTower();
    // finish the build state so the tower is interactable
    const cmds: unknown[] = [];
    const sounds: string[] = [];
    const ix = new TowerInteraction({
      towers: () => core.allObjects<GameCoreTower>(GameCoreTower),
      playerPos: () => player.position,
      playerHandle: () => player.handle,
      hasInventory: (type, amount) => inv.hasInventory(player.handle, type, amount),
      issue: (c) => cmds.push(c),
      playSound: (n) => sounds.push(n),
    });
    return { player, inv, tower, ix, cmds, sounds };
  }
  it('selects the tower in range, opens on interact, upgrade confirm queues UpgradeTowerCommand', () => {
    const { ix, cmds, sounds, tower } = rig(3);
    ix.updateSelection();
    expect(ix.selected).toBe(tower);
    expect(ix.open()).toBe(true);
    expect(ix.phase).toBe('upgrade');
    expect(ix.canUpgrade()).toBe(true);
    expect(ix.confirm()).toBe('upgrade');
    expect(cmds[0]).toBeInstanceOf(UpgradeTowerCommand);
    expect(sounds).toContain(RING_SOUND.confirm);
    expect(ix.isOpen).toBe(false);
  });
  it('no gems -> disabled confirm plays TowerNoEnoughInventory and queues nothing', () => {
    const { ix, cmds, sounds } = rig(0);
    ix.updateSelection();
    ix.open();
    expect(ix.canUpgrade()).toBe(false);
    expect(ix.confirm()).toBe('no-funds');
    expect(cmds).toHaveLength(0);
    expect(sounds).toContain(RING_SOUND.noInventory);
    expect(ix.isOpen).toBe(true); // ring stays open
  });
  it('max level -> TowerConfirmFail; dismantle -> SellTowerCommand with the live refund', () => {
    const { ix, cmds, sounds, tower } = rig(9);
    for (let i = 0; i < 6; i++) tower.grantEXP(5000, null);
    ix.updateSelection();
    ix.open();
    expect(ix.confirm()).toBe('max');
    expect(sounds).toContain(RING_SOUND.confirmFail);
    ix.moveCursor(1);
    expect(ix.phase).toBe('sell');
    expect(ix.confirm()).toBe('sell');
    const cmd = cmds[0] as SellTowerCommand;
    expect(cmd).toBeInstanceOf(SellTowerCommand);
    expect((cmd as unknown as { m_refundCoin: number }).m_refundCoin).toBe(90);
    expect((cmd as unknown as { m_refundGem: number }).m_refundGem).toBe(2); // Lv5 refund
  });
  it('walking out of the trigger closes the ring; cancel closes with the cancel sound', () => {
    const { ix, player, sounds } = rig(1);
    ix.updateSelection();
    ix.open();
    player.position = new Vector3(60, 0, 60);
    ix.updateSelection();
    expect(ix.isOpen).toBe(false);
    player.position = new Vector3(40.5, 0, 40);
    ix.updateSelection();
    ix.open();
    ix.cancel();
    expect(ix.isOpen).toBe(false);
    expect(sounds).toContain(RING_SOUND.cancel);
  });
});

// ---- overlay (fake DOM) ---------------------------------------------------------

class FakeEl {
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  readonly style: Record<string, string> = {};
  textContent = '';
  listeners: Record<string, Array<() => void>> = {};
  constructor(readonly tagName: string) {}
  appendChild(c: FakeEl): FakeEl { c.remove(); c.parent = this; this.children.push(c); return c; }
  remove(): void { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  addEventListener(t: string, fn: () => void): void { (this.listeners[t] ??= []).push(fn); }
}
describe('TowerLevelUi overlay', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('shows Level Up! + persistent Lv.N label after an upgrade, hides on boss death, gauge at max is hidden', () => {
    vi.stubGlobal('document', { createElement: (t: string) => new FakeEl(t) });
    const strings = {
      levelUp: 'Level Up!', upgrade: 'Upgrade', dismantle: 'Dismantle', interact: 'Interact', max: 'MAX',
      levelByKey: (k: string) => ({ tl_hud_level_002: 'Lv.2' } as Record<string, string>)[k] ?? 'Lv.?',
    };
    const ui = new TowerLevelUi(strings, () => ({ x: 10, y: 10, visible: true }), {
      onInteract() {}, onCursor() {}, onConfirm() {}, onCancel() {},
    });
    ui.attach(new FakeEl('div') as unknown as HTMLElement);
    const tower = makeTower();
    tower.grantEXP(100, null);
    ui.onGrantExp(tower, 100);
    ui.onUpgrade(tower, tower.currentLevel);
    const ring = { phase: 'closed' as const, tower: null, upgradeEnabled: false, nextCostCoin: 0, nextCostGem: 0, maxLevel: false, refundCoin: 0, refundGem: 0 };
    ui.update(1 / 60, null, false, 'E', ring);
    const t1 = ui.badgeTexts(tower)!;
    expect(t1.level).toBe('Lv.2');
    expect(t1.popupVisible).toBe(true);
    expect(t1.gaugeVisible).toBe(true);
    for (let i = 0; i < 200; i++) ui.update(1 / 60, null, false, 'E', ring);
    const t2 = ui.badgeTexts(tower)!;
    expect(t2.popupVisible).toBe(false);
    expect(t2.level).toBe('Lv.2'); // persists
    ui.onBossDestroyed();
    ui.update(1 / 60, null, false, 'E', ring);
    expect(ui.badgeTexts(tower)).not.toBeNull();
    expect(ui.badgeTexts(tower)!.level).toBe('');
    ui.onSell(tower);
    expect(ui.badgeCount).toBe(0);
  });
});

describe('TowerLevelFeature keys: the modal ring can always be closed', () => {
  it('Q, Backspace and Escape cancel an open ring; unrelated keys fall through', async () => {
    const { TowerLevelFeature } = await import('../../src/view/tower/TowerLevelFeature');
    const feat = new TowerLevelFeature({
      strings: () => ({}), project: () => ({ x: 0, y: 0, visible: true }), core: () => ({ allObjects: () => [] }),
      player: () => ({ position: { x: 0, y: 0, z: 0 }, handle: {} }), inventory: () => ({ hasInventory: () => true }),
      issue: () => undefined, playSound: () => undefined, danceView: () => undefined, danceExpRate: 1,
    } as never);
    const ix = feat.interaction;
    for (const code of ['KeyQ', 'Backspace', 'Escape']) {
      ix.phase = 'upgrade';
      expect(feat.ringOpen).toBe(true);
      expect(feat.onKey(code)).toBe(true);
      expect(feat.ringOpen).toBe(false);
    }
    ix.phase = 'sell';
    expect(feat.onKey('KeyZ')).toBe(false);
    expect(feat.ringOpen).toBe(true);
  });
});
