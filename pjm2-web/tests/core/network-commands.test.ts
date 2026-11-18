// tests/core/network-commands.test.ts
// Semantics tests for the 19 Network commands + the GameCoreNetworkBridge SP
// loopback seam + the SimDriver tick pipeline. Pins the verified driver
// facts: commands execute BETWEEN prepareNextFrame() and tick() in FIFO
// order, Random.InitState(updateCount) seeds every tick, SP must-wait = no
// players, and GameCore.tick clamps dt to 0.5 internally.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Mathf, Vector3, Bounds } from '../../src/engine/math';
import { unityRandom, UnityRandom } from '../../src/engine/rng/UnityRandom';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { CoreEventBase, EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { EInventoryType, GameCoreInventory } from '../../src/core/GameCoreInventory';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreEnemy } from '../../src/core/GameCoreEnemy';
import { GameCoreFruit } from '../../src/core/GameCoreFruit';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreShop } from '../../src/core/GameCoreShop';
import { GameCoreTower } from '../../src/core/GameCoreTower';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import { setSimPhysics } from '../../src/core/physics-seam';
import { TowerHelper } from '../../src/core/TowerHelper';
import { TowerStateAttack } from '../../src/core/TowerStateAttack';
import { AddInventoryCommand } from '../../src/core/network/AddInventoryCommand';
import { AddLocalPlayerCommand } from '../../src/core/network/AddLocalPlayerCommand';
import { BuildTowerCommand } from '../../src/core/network/BuildTowerCommand';
import { BusyCommand } from '../../src/core/network/BusyCommand';
import { DetonateFruitCommand } from '../../src/core/network/DetonateFruitCommand';
import { DropFruitCommand } from '../../src/core/network/DropFruitCommand';
import { EnterLeaveTowerCommand } from '../../src/core/network/EnterLeaveTowerCommand';
import { HipAttackEnemyCommand } from '../../src/core/network/HipAttackEnemyCommand';
import { IntroSequenceSkipCommand } from '../../src/core/network/IntroSequenceSkipCommand';
import { NetworkCommand } from '../../src/core/network/NetworkCommand';
import { PickupFruitCommand } from '../../src/core/network/PickupFruitCommand';
import { SellTowerCommand } from '../../src/core/network/SellTowerCommand';
import { SignCommand } from '../../src/core/network/SignCommand';
import { SpawnFruitCommand } from '../../src/core/network/SpawnFruitCommand';
import { TowerAttackComamnd } from '../../src/core/network/TowerAttackComamnd';
import { TowerRotateCommand } from '../../src/core/network/TowerRotateCommand';
import { TowerXPCommand } from '../../src/core/network/TowerXPCommand';
import { TriggerInteractionCommand } from '../../src/core/network/TriggerInteractionCommand';
import { UpgradeTowerCommand } from '../../src/core/network/UpgradeTowerCommand';
import { SimDriver } from '../../src/main/sim-driver';
import {
  getRegisteredUnityObject,
  registerUnityObject,
  resetUnityObjectRegistryForTests,
  setCurrentStageProvider,
  setDebugCanvasProvider,
  setFruitDefinitionsProvider,
  setPlayerManagerProvider,
  setShopMainControllerProvider,
  setStageHubProvider,
  setStageTransferInfoProvider,
  setTowerDatabaseProvider,
  setViewObjectByNameFinder,
  type FruitContract,
  type NatureTreeViewContract,
  type PickupManagerContract,
  type PlayerFruitViewContract,
  type TowerBaseContract,
} from '../../src/view/q4-contracts';
import {
  EEnemyClassTypeDef,
  EEnemyMoveTypeDef,
  EEnemyStrengthTypeDef,
  EBossType,
  ESpawnMode,
  ETowerAttackDef,
} from '../../src/core/enums';

const f = Math.fround;
const P = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DT = 1 / 60;

let core: GameCore;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
  setViewerResolver((h) => getRegisteredUnityObject(h));
  setSimPhysics({
    linecast: () => null,
    raycast: () => null,
    sphereCast: () => null,
    checkSphere: () => false,
  });
  setDebugCanvasProvider(() => null);
  setCurrentStageProvider(() => ({
    initCoin: 450,
    initGem: 2,
    initWaveCoinRate: 1,
    initWaveTimeRate: 1.75,
  }));
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setSimPhysics(null);
  setDebugCanvasProvider(() => null);
  setCurrentStageProvider(() => null);
  setTowerDatabaseProvider(null);
  setViewObjectByNameFinder(null);
  setPlayerManagerProvider(null);
  setStageTransferInfoProvider(null);
  setFruitDefinitionsProvider(null);
  setShopMainControllerProvider(null);
  setStageHubProvider(null);
  resetUnityObjectRegistryForTests();
  vi.restoreAllMocks();
});

// ---- fixtures ------------------------------------------------------------------

function makePlayer(id: number): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = P(40, 0, 40);
  return p;
}

function towerData(overrides: Partial<TowerBaseContract> = {}): TowerBaseContract {
  return {
    name: 'tower_test',
    gameObject: {},
    transform: { position: { x: 0, y: 0, z: 0 } },
    nextTargetToAttackIndex: 0,
    attackType: ETowerAttackDef.all,
    strengthType: EEnemyStrengthTypeDef.Normal,
    classType: EEnemyClassTypeDef.Normal,
    balloonAimable: true,
    attackPower: 10,
    attackSpeed: 1,
    attackRangeInner: 1,
    attackSpread: 0,
    costCoin: 50,
    costGem: 0,
    buildTime: 2,
    buildRange: 2,
    refundCoin: 25,
    refundGem: 0,
    magazineCapacity: 3,
    rotateSpeedX: 90,
    rotateSpeedXAcel: 180,
    rotateSpeedXDecl: 180,
    rotateSpeedY: 90,
    rotateSpeedYAcel: 180,
    rotateSpeedYDecl: 180,
    oneShotOneBalloon: false,
    fullRangeFire: true,
    fireAngleThreshold: 30,
    attackAttenuations: [],
    burstCount: 1,
    burstInterval: 0,
    cautionRange: 45,
    cautionIdleTime: 1,
    cautionRotateSpeed: 30,
    cautionRotateAngleMin: 10,
    playerDetectionRange: 2,
    firePointNames: ['firePoint'],
    projectile: {
      getFireDirection: (from: Vector3, to: Vector3) => ({
        x: to.x - from.x,
        y: to.y - from.y,
        z: to.z - from.z,
      }),
      getGameCoreType: () => null as unknown as new () => import('../../src/core/GameCoreProjectile').GameCoreProjectile,
    },
    getComponentTowerUpgradeSetting: () => null,
    getComponentEnemyDetectorView: () => null,
    findDeepChildY: () => 3,
    getFirePointByRemainingMag: () => ({ x: 40, y: 3, z: 40 }),
    ...overrides,
  };
}

function makeTower(data: TowerBaseContract = towerData()): GameCoreTower {
  const tower = new GameCoreTower(data.name, []);
  tower.position = P(40, 0, 40);
  registerUnityObject(tower.handle.m_handle, data);
  tower.initialize();
  return tower;
}

function treeViewer(): NatureTreeViewContract {
  return {
    playerDetectionRange: 2,
    towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x: 40, y: 0, z: 40 } },
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

function fruitContract(): FruitContract {
  return {
    name: 'test_fruit',
    detectDelay: 0,
    cooldownTime: 0,
    enemyDetectRange: 1,
    playerDetectRange: 1,
    playerJumpDetectRange: 1,
    isNonInteractable: false,
    scaleGround: 1,
    usage: 1,
    destroyWhenUsedUp: false,
    textKey: '',
    getComponentPickupMovement: () => null,
    getComponentInChildrenMeshFilter: () => null,
    getComponentsBuffSetting: () => [],
    gameObject: { activeSelf: true, setActive: () => {} },
  };
}

function makeFruit(pos: Vector3 = P(40, 0, 40)): GameCoreFruit {
  return new GameCoreFruit(fruitContract(), false, pos, null);
}

function makeEnemy(): GameCoreEnemy {
  // Pool-default ctor; enough for dealPlayerDamage (m_life set directly).
  const e = new GameCoreEnemy();
  // FAITHFUL test-side setup: spawn() normally assigns m_life = maxLife.
  (e as unknown as { m_maxLife: number }).m_maxLife = 100;
  (e as unknown as { m_life: number }).m_life = f(100);
  return e;
}

// ---- SimDriver / GameCoreNetworkBridge seam -------------------------------------

class RecordingCommand extends NetworkCommand {
  constructor(
    private readonly tag: string,
    private readonly log: string[],
  ) {
    super();
  }
  executeCommand(_p: GameCorePlayer | null): void {
    this.log.push(this.tag);
  }
}

describe('SimDriver (verified GameCoreBridge SP pipeline)', () => {
  it('must-wait while there are no players: step is a no-op', () => {
    const driver = new SimDriver();
    expect(driver.step(DT)).toBe(false);
    expect(driver.updateCount).toBe(0);
  });

  it('ticks exactly once per step with a player present; dt clamped to 0.5 inside', () => {
    const driver = new SimDriver();
    makePlayer(1);
    expect(driver.step(10)).toBe(true); // huge wall delta
    expect(driver.updateCount).toBe(1);
    expect(GameCore.tickDeltaTime).toBe(0.5); // SP cap @0x00B7C248
    expect(driver.step(DT)).toBe(true);
    expect(driver.updateCount).toBe(2);
    expect(GameCore.tickDeltaTime).toBeCloseTo(DT, 6);
  });

  it('commands queued via the bridge execute FIFO on the NEXT tick only', () => {
    const driver = new SimDriver();
    const player = makePlayer(1);
    const log: string[] = [];
    driver.addPlayerCommand(new RecordingCommand('a', log), player);
    driver.addPlayerCommand(new RecordingCommand('b', log), player);
    expect(log).toEqual([]); // nothing runs before the tick seam
    driver.step(DT);
    expect(log).toEqual(['a', 'b']); // drained in order
    expect(driver.bridge.pendingCommandCount).toBe(0);
  });

  it('commands execute between prepareNextFrame and tick (player tick sees command effects)', () => {
    const driver = new SimDriver();
    const player = makePlayer(1);
    // A command that marks the player via speed scale; tick ordering is
    // observable because prepareNextFrame snapshots positions BEFORE the
    // command runs.
    let observedPrevious: Vector3 | null = null;
    class PosProbe extends NetworkCommand {
      executeCommand(): void {
        player.position = P(50, 0, 50); // move DURING the command slot
      }
    }
    driver.addPlayerCommand(new PosProbe(), player);
    driver.step(DT);
    observedPrevious = player.previousTickPosition;
    // prepareNextFrame snapshotted the PRE-command position; tick then ran
    // with the command-applied position.
    expect(observedPrevious).not.toBeNull();
    expect(player.position.x).toBe(50);
    expect(observedPrevious!.x).toBe(40);
  });

  it('RNG is seeded with InitState(updateCount) before commands run', () => {
    const driver = new SimDriver();
    makePlayer(1);
    let seenState: import('../../src/engine/rng/UnityRandom').RandomState | null = null;
    class RngProbe extends NetworkCommand {
      executeCommand(): void {
        seenState = unityRandom.state;
      }
    }
    driver.addPlayerCommand(new RngProbe(), null);
    driver.step(DT); // updateCount 0 → InitState(0)
    const reference = new UnityRandom(0);
    expect(seenState).not.toBeNull();
    expect(seenState!.x).toBe(reference.state.x);
    expect(seenState!.y).toBe(reference.state.y);
    driver.addPlayerCommand(new RngProbe(), null);
    driver.step(DT); // updateCount 1 → InitState(1)
    const ref1 = new UnityRandom(1);
    expect(seenState!.x).toBe(ref1.state.x);
  });
});

// ---- simple event-relay commands -------------------------------------------------

describe('BusyCommand', () => {
  it('broadcasts busyEvent with the executing player handle + flag', () => {
    const player = makePlayer(1);
    const seen: [number, boolean][] = [];
    Events.busyEvent.addListener((h: GameCoreHandle, b: boolean) => {
      seen.push([h.m_handle, b]);
    }, EventTime.Immediate);
    new BusyCommand(true).executeCommand(player);
    new BusyCommand(false).executeCommand(player);
    expect(seen).toEqual([
      [player.handle.m_handle, true],
      [player.handle.m_handle, false],
    ]);
  });

  it('null executing player → no event (binary exception path)', () => {
    let fired = false;
    Events.busyEvent.addListener(() => {
      fired = true;
    }, EventTime.Immediate);
    new BusyCommand(true).executeCommand(null);
    expect(fired).toBe(false);
  });
});

describe('IntroSequenceSkipCommand', () => {
  it('fires introSequenceFinishedEvent with the skipping player', () => {
    const player = makePlayer(1);
    let got: GameCorePlayer | null = null;
    Events.introSequenceFinishedEvent.addListener((p: GameCorePlayer) => {
      got = p;
    }, EventTime.Immediate);
    new IntroSequenceSkipCommand().executeCommand(player);
    expect(got).toBe(player);
  });
});

describe('SignCommand', () => {
  it('relays (player handle, category, icon) through signEvent', () => {
    const player = makePlayer(1);
    const seen: [number, number, number][] = [];
    Events.signEvent.addListener((h: GameCoreHandle, c: number, i: number) => {
      seen.push([h.m_handle, c, i]);
    }, EventTime.Immediate);
    new SignCommand(2, 7).executeCommand(player);
    expect(seen).toEqual([[player.handle.m_handle, 2, 7]]);
  });
});

describe('TriggerInteractionCommand', () => {
  it('relays (player, target handle) through triggerInterationEvent', () => {
    const player = makePlayer(1);
    const target = makePlayer(2); // any GameCoreObject handle works
    const seen: [GameCorePlayer | null, number][] = [];
    Events.triggerInterationEvent.addListener((p: GameCorePlayer | null, h: GameCoreHandle) => {
      seen.push([p, h.m_handle]);
    }, EventTime.Immediate);
    new TriggerInteractionCommand(target.handle).executeCommand(player);
    expect(seen).toEqual([[player, target.handle.m_handle]]);
  });
});

describe('DetonateFruitCommand', () => {
  it('is a faithful no-op (empty in the shipped binary)', () => {
    const player = makePlayer(1);
    expect(() => new DetonateFruitCommand().executeCommand(player)).not.toThrow();
  });
});

// ---- inventory -------------------------------------------------------------------

describe('AddInventoryCommand', () => {
  it('credits the target player bag by handle (not the executing player)', () => {
    const target = makePlayer(1);
    const other = makePlayer(2);
    const inv = GameCoreInventory.getInventoryObject()!;
    const before = inv.getAvailableInventory(target.handle, EInventoryType.Gem);
    new AddInventoryCommand(target.handle, 5, EInventoryType.Gem).executeCommand(other);
    expect(inv.getAvailableInventory(target.handle, EInventoryType.Gem)).toBe(before + 5);
  });

  it('stale handle → silent no-op', () => {
    const target = makePlayer(1);
    const stale = target.handle;
    target.destroySelf();
    core.prepareNextFrame(); // swap-back removal
    expect(() =>
      new AddInventoryCommand(stale, 5, EInventoryType.Gem).executeCommand(null),
    ).not.toThrow();
  });
});

// ---- tower commands ----------------------------------------------------------------

describe('TowerAttackComamnd [sic]', () => {
  it('forces an immediate TowerStateAttack (burst 0/0, forceAttack)', () => {
    const tower = makeTower();
    new TowerAttackComamnd(tower.handle).executeCommand(null);
    const state = tower.getTowerState();
    expect(state).toBeInstanceOf(TowerStateAttack);
    expect((state as unknown as { m_forceAttack: boolean }).m_forceAttack).toBe(true);
  });

  it('stale handle → no throw', () => {
    expect(() => new TowerAttackComamnd(GameCoreHandle.nullHandle).executeCommand(null)).not.toThrow();
  });
});

describe('TowerRotateCommand', () => {
  it('snaps fortDirection to Quaternion.Euler(x, y, 0) * forward', () => {
    const tower = makeTower();
    new TowerRotateCommand(tower.handle, { x: 0, y: 90 }).executeCommand(null);
    expect(tower.fortDirection.x).toBeCloseTo(1, 5);
    expect(tower.fortDirection.y).toBeCloseTo(0, 5);
    expect(tower.fortDirection.z).toBeCloseTo(0, 5);
  });
});

describe('TowerXPCommand', () => {
  it('grants EXP to the tower on behalf of the executing player', () => {
    const tower = makeTower(
      towerData({
        getComponentTowerUpgradeSetting: () => ({
          getCurrentUpgrade: () => ({ level: 1, reachExp: 0 }),
          getNextUpgrade: () => ({ level: 2, reachExp: 1000 }),
          upgradeTower: () => 2,
        }),
      }),
    );
    const player = makePlayer(1);
    new TowerXPCommand(tower.handle, 25).executeCommand(player);
    expect(tower.currentEXP).toBe(25);
    new TowerXPCommand(tower.handle, 5).executeCommand(null); // null player OK
    expect(tower.currentEXP).toBe(30);
  });
});

describe('EnterLeaveTowerCommand', () => {
  it('enter claims the seat; a second enter is blocked; leave frees it', () => {
    const tower = makeTower();
    const p1 = makePlayer(1);
    const p2 = makePlayer(2);
    new EnterLeaveTowerCommand(p1.handle, tower.handle, true).executeCommand(null);
    expect(tower.hasPlayerInTower()).toBe(true);
    expect(tower.playerInTowerID()).toBe(1);
    new EnterLeaveTowerCommand(p2.handle, tower.handle, true).executeCommand(null);
    expect(tower.playerInTowerID()).toBe(1); // occupied — p2 blocked
    new EnterLeaveTowerCommand(p1.handle, tower.handle, false).executeCommand(null);
    expect(tower.hasPlayerInTower()).toBe(false);
    // Leaving an empty seat is a no-op (no throw).
    new EnterLeaveTowerCommand(p1.handle, tower.handle, false).executeCommand(null);
    expect(tower.hasPlayerInTower()).toBe(false);
  });
});

describe('SellTowerCommand', () => {
  it('destroys the tower, broadcasts refunds, and revives retained trees', () => {
    const tree = new GameCoreTree(P(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    const prefab = towerData();
    // Build through the helper exactly like BuildTowerCommand does.
    const tower = TowerHelper.fromTreeToTower(tree, prefab)!;
    expect(tree.referenceCount).toBe(1);

    const player = makePlayer(1);
    const sells: [GameCoreTower, GameCorePlayer, number, number][] = [];
    Events.towerSellEvent.addListener(
      (t: GameCoreTower, p: GameCorePlayer, c: number, g: number) => {
        sells.push([t, p, c, g]);
      },
      EventTime.Immediate,
    );
    new SellTowerCommand(tower.handle, 25, 1).executeCommand(player);
    expect(sells).toEqual([[tower, player, 25, 1]]);
    expect(tree.referenceCount).toBe(0); // revived
  });
});

describe('BuildTowerCommand', () => {
  it('no tower database → logs an error and builds nothing', () => {
    const tree = new GameCoreTree(P(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    const player = makePlayer(1);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    new BuildTowerCommand(tree.handle, towerData()).executeCommand(player);
    expect(err).toHaveBeenCalledWith('No tower found of type tower_test');
    expect(tree.referenceCount).toBe(0); // not claimed
  });

  it('happy path: converts the tree, fires towerBuildEvent, charges coin+gem', () => {
    const tree = new GameCoreTree(P(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    const player = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const coinsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    const prefab = towerData({ costCoin: 50, costGem: 1 });
    setTowerDatabaseProvider(() => ({ getData: (n: string) => (n === prefab.name ? prefab : null) }));
    const builds: unknown[] = [];
    Events.towerBuildEvent.addListener((t: unknown) => builds.push(t), EventTime.Immediate);

    new BuildTowerCommand(tree.handle, prefab).executeCommand(player);
    expect(builds.length).toBe(1);
    expect(tree.referenceCount).toBe(1); // claimed by the new tower
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore - 50);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(1); // 2 - 1
  });

  it('unaffordable → no build, no charge', () => {
    const tree = new GameCoreTree(P(40, 0, 40));
    registerUnityObject(tree.handle.m_handle, treeViewer());
    const player = makePlayer(1);
    const prefab = towerData({ costCoin: 999999 });
    setTowerDatabaseProvider(() => ({ getData: () => prefab }));
    let fired = false;
    Events.towerBuildEvent.addListener(() => {
      fired = true;
    }, EventTime.Immediate);
    new BuildTowerCommand(tree.handle, prefab).executeCommand(player);
    expect(fired).toBe(false);
    expect(tree.referenceCount).toBe(0);
  });
});

describe('UpgradeTowerCommand', () => {
  it('tops EXP to the next level and charges its costs', () => {
    const player = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    inv.addInventory(player.handle, EInventoryType.Gem, 10);
    const prefab = towerData({
      getComponentTowerUpgradeSetting: () => ({
        getCurrentUpgrade: () => ({ level: 1, reachExp: 0 }),
        getNextUpgrade: () => ({ level: 2, reachExp: 100, costCoin: 30, costGem: 2 }),
        upgradeTower: (_t: GameCoreTower) => 2, // C#: the setting writes the level; sim stores the return
      }),
    });
    const tower = makeTower(prefab);
    const coinsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    const gemsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Gem);
    new UpgradeTowerCommand(tower.handle, 2).executeCommand(player);
    expect(tower.currentLevel).toBe(2);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore - 30);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Gem)).toBe(gemsBefore - 2);
  });

  it('wrong requested level → no-op', () => {
    const prefab = towerData({
      getComponentTowerUpgradeSetting: () => ({
        getCurrentUpgrade: () => ({ level: 1, reachExp: 0 }),
        getNextUpgrade: () => ({ level: 2, reachExp: 100 }),
        upgradeTower: () => 2,
      }),
    });
    const tower = makeTower(prefab);
    new UpgradeTowerCommand(tower.handle, 3).executeCommand(makePlayer(1));
    expect(tower.currentEXP).toBe(0);
  });
});

// ---- fruit commands ----------------------------------------------------------------

describe('PickupFruitCommand / DropFruitCommand', () => {
  it('unowned fruit → fruitPickedUpEvent; the player grab wiring claims it', () => {
    const player = makePlayer(1);
    const fruit = makeFruit();
    new PickupFruitCommand(fruit).executeCommand(player);
    expect(player.heldFruit).toBe(fruit); // GameCorePlayer.onFruitPickedUp claimed it
  });

  it('drop: only the carrier can drop; fruitDroppedEvent carries the force', () => {
    const player = makePlayer(1);
    const other = makePlayer(2);
    const fruit = makeFruit();
    new PickupFruitCommand(fruit).executeCommand(player);
    expect(player.heldFruit).toBe(fruit);

    const drops: [GameCorePlayer, GameCoreFruit, Vector3][] = [];
    Events.fruitDroppedEvent.addListener(
      (p: GameCorePlayer, fr: GameCoreFruit, force: Vector3) => {
        drops.push([p, fr, force]);
      },
      EventTime.Immediate,
    );
    // Non-carrier is silently ignored.
    new DropFruitCommand(fruit, P(1, 0, 0)).executeCommand(other);
    expect(drops.length).toBe(0);
    // Carrier drops with the force vector.
    new DropFruitCommand(fruit, P(1, 2, 3)).executeCommand(player);
    expect(drops.length).toBe(1);
    expect(drops[0][0]).toBe(player);
    expect(drops[0][2].x).toBe(1);
  });

  it('fruit owned by another player → requester view force-reset (motor + FSM)', () => {
    const owner = makePlayer(1);
    const thief = makePlayer(2);
    const fruit = makeFruit();
    new PickupFruitCommand(fruit).executeCommand(owner);
    expect(fruit.playerOwner).not.toBeNull();

    const dropSpy = vi.fn();
    const fsmSpy = vi.fn();
    const thiefView: PlayerFruitViewContract = {
      playerID: 2,
      transform: { position: { x: 0, y: 0, z: 0 } },
      gameObject: {},
      motor: {
        dropFruit: dropSpy,
        stateMachine: { forceCurrentCommand: fsmSpy },
      },
    };
    registerUnityObject(thief.handle.m_handle, thiefView);
    new PickupFruitCommand(fruit).executeCommand(thief);
    expect(dropSpy).toHaveBeenCalledTimes(1);
    expect(fsmSpy).toHaveBeenCalledTimes(1);
    expect((fsmSpy.mock.calls[0][0] as { __typeName: string }).__typeName).toBe('TikimanStateIdle');
    expect(thief.heldFruit).toBeNull(); // no steal
  });

  it('stale fruit handle → requester view force-reset, no event', () => {
    const player = makePlayer(1);
    const fruit = makeFruit();
    const cmd = new PickupFruitCommand(fruit); // handle captured while alive
    fruit.destroySelf();
    core.prepareNextFrame();
    const dropSpy = vi.fn();
    registerUnityObject(player.handle.m_handle, {
      playerID: 1,
      transform: { position: { x: 0, y: 0, z: 0 } },
      gameObject: {},
      motor: { dropFruit: dropSpy, stateMachine: null },
    } satisfies PlayerFruitViewContract);
    let fired = false;
    Events.fruitPickedUpEvent.addListener(() => {
      fired = true;
    }, EventTime.Immediate);
    cmd.executeCommand(player);
    expect(fired).toBe(false);
    expect(dropSpy).toHaveBeenCalledTimes(1);
  });
});

describe('HipAttackEnemyCommand', () => {
  it('deals typed damage via the player VIEW stats and arms the coin spill', () => {
    const player = makePlayer(1);
    registerUnityObject(player.handle.m_handle, {
      playerID: 1,
      transform: { position: { x: 40, y: 0, z: 40 } },
      gameObject: {},
      strengthType: EEnemyStrengthTypeDef.Normal,
      classType: EEnemyClassTypeDef.Normal,
      oneKickOneBalloon: false,
    });
    const enemy = makeEnemy();
    new HipAttackEnemyCommand(enemy.handle, 30, 1, 0, 1, 0).executeCommand(player);
    expect(enemy.life).toBeLessThan(100); // damage landed (exact table value lives in DamageHelper)
  });

  it('null view → no damage and NO drop arming (faithful skip)', () => {
    const player = makePlayer(1); // no view registered
    const enemy = makeEnemy();
    new HipAttackEnemyCommand(enemy.handle, 30, 1, 0, 1, 0).executeCommand(player);
    expect(enemy.life).toBe(100);
  });
});

describe('SpawnFruitCommand', () => {
  function fruitDefs(costCoin: number, costGem: number, prefab: unknown = {}) {
    setFruitDefinitionsProvider(() => ({
      getDefinition: () => ({ costCoin, costGem, fruitPrefab: prefab }),
    }));
  }
  function stageHub(createFruit: PickupManagerContract['createFruit']) {
    setStageHubProvider(() => ({
      pickupManager: {
        hiddenPickupData: [],
        createPickup: () => null,
        createFruit,
      },
    }));
  }

  it('pays the cost at execute, spawns at spawner.position + offset, preserves sim RNG state', () => {
    const player = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const coinsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    fruitDefs(20, 0);
    const spawnerTree = new GameCoreTree(P(10, 0, 10));
    registerUnityObject(spawnerTree.handle.m_handle, treeViewer());
    const created: { pos: Vector3 }[] = [];
    const fakeFruit = makeFruit(P(0, 0, 0));
    stageHub((data, position) => {
      created.push({ pos: position as Vector3 });
      expect(data!.amount).toBe(1);
      expect(data!.time).toBe(1);
      // View-side randomness that MUST be rolled back:
      unityRandom.value;
      unityRandom.value;
      return fakeFruit;
    });

    const stateBefore = unityRandom.state;
    new SpawnFruitCommand(player, spawnerTree.handle, 0, P(0, 1, 0)).executeCommand(player);
    expect(created.length).toBe(1);
    expect(created[0].pos.x).toBe(10); // spawner.position + offset
    expect(created[0].pos.y).toBe(1);
    expect(created[0].pos.z).toBe(10);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore - 20);
    const stateAfter = unityRandom.state;
    expect(stateAfter.x).toBe(stateBefore.x); // save/restore held
    expect(stateAfter.y).toBe(stateBefore.y);
    expect(stateAfter.z).toBe(stateBefore.z);
    expect(stateAfter.w).toBe(stateBefore.w);
  });

  it('ctor pays the cost up-front when the sim tick is paused; execute does not double-charge', () => {
    const driver = new SimDriver(); // owns the gameCoreTickEnabled provider
    driver.gameCoreTickEnabled = false;
    const player = makePlayer(1);
    const inv = GameCoreInventory.getInventoryObject()!;
    const coinsBefore = inv.getAvailableInventory(player.handle, EInventoryType.Coin);
    fruitDefs(20, 0);
    const spawnerTree = new GameCoreTree(P(10, 0, 10));
    registerUnityObject(spawnerTree.handle.m_handle, treeViewer());
    stageHub(() => makeFruit());
    const cmd = new SpawnFruitCommand(player, spawnerTree.handle, 0, P(0, 0, 0));
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore - 20);
    cmd.executeCommand(player);
    expect(inv.getAvailableInventory(player.handle, EInventoryType.Coin)).toBe(coinsBefore - 20);
  });

  it('unaffordable → silently ignored (no spawn)', () => {
    const player = makePlayer(1);
    fruitDefs(999999, 0);
    const spawnerTree = new GameCoreTree(P(10, 0, 10));
    registerUnityObject(spawnerTree.handle.m_handle, treeViewer());
    let spawned = 0;
    stageHub(() => {
      spawned++;
      return null;
    });
    new SpawnFruitCommand(player, spawnerTree.handle, 0, P(0, 0, 0)).executeCommand(player);
    expect(spawned).toBe(0);
  });

  it('shop spawner → instant handoff via fruitPickedUpEvent (+ shop refresh for the local player)', () => {
    const player = makePlayer(1);
    GameCoreInventory.getInventoryObject();
    fruitDefs(0, 0);
    const shop = new GameCoreShop();
    shop.position = P(5, 0, 5);
    const fakeFruit = makeFruit(P(0, 0, 0));
    stageHub(() => fakeFruit);
    const refresh = vi.fn();
    setShopMainControllerProvider(() => ({ isShowing: true, refreshShopBoards: refresh }));
    new SpawnFruitCommand(player, shop.handle, 0, P(0, 0, 0)).executeCommand(player);
    expect(player.heldFruit).toBe(fakeFruit); // grabbed via the event wiring
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

// ---- AddLocalPlayerCommand ----------------------------------------------------------

describe('AddLocalPlayerCommand', () => {
  it('joins id max+1 through the PlayerManager view and applies transfer parts', () => {
    const existing = makePlayer(3);
    expect(existing).not.toBeNull();
    const joined: { info: { id: number; localPlayer: boolean } }[] = [];
    const createdPlayer = new GameCorePlayer(); // sim side of the new avatar
    const parts: [string, string][] = [];
    setPlayerManagerProvider(() => ({
      joinPlayer: (info, position, _rotation) => {
        joined.push({ info });
        expect(position.x).toBe(0); // Vector3.zero
        return {
          playerID: info.id,
          transform: { position: { x: 0, y: 0, z: 0 } },
          gameObject: {},
          createGameCoreObject: () => createdPlayer,
          setCustomizedParts: (m: string, c: string) => {
            parts.push([m, c]);
          },
        };
      },
    }));
    setStageTransferInfoProvider(() => ({
      tryGetParts: (id: number) => (id === 4 ? { maskName: 'mask_a', carapaceName: 'shell_b' } : null),
    }));
    new AddLocalPlayerCommand().executeCommand(null);
    expect(joined.length).toBe(1);
    expect(joined[0].info.id).toBe(4); // max(3) + 1
    expect(joined[0].info.localPlayer).toBe(true);
    expect(parts).toEqual([['mask_a', 'shell_b']]);
  });

  it('no PlayerManager → silent no-op (binary exception path)', () => {
    expect(() => new AddLocalPlayerCommand().executeCommand(null)).not.toThrow();
  });
});
