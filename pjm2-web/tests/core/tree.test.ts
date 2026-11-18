// tests/core/tree.test.ts
// Semantics tests for the GameCoreTree port: ctor constants (ELF .rodata
// values), breakdown/revive counting with structureBreakEvent/treeReviveEvent,
// and the RecreateViewer scene scan (threshold 1.0, active-flag sync).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bounds, Vector3 } from '../../src/engine/math';
import { CoreObjectPool } from '../../src/core/CoreObjectPool';
import { EventTime } from '../../src/core/event/CoreEvent';
import { Events, resetAllEventsForTests } from '../../src/core/Events';
import { GameCore, setInstanceProvider } from '../../src/core/GameCore';
import { setBoundsProvider } from '../../src/core/GameCoreCollisionManager';
import { GameCoreHandle, setFrameResolver, setViewerResolver } from '../../src/core/GameCoreHandle';
import { GameCoreObject } from '../../src/core/GameCoreObject';
import { GameCorePlayer } from '../../src/core/GameCorePlayer';
import { GameCoreTree } from '../../src/core/GameCoreTree';
import {
  setAllTreesInSceneProvider,
  type NatureTreeViewContract,
} from '../../src/view/q4-contracts';

let core: GameCore;

beforeEach(() => {
  GameCoreHandle.resetStaticsForTests();
  resetAllEventsForTests();
  CoreObjectPool.resetInstanceForTests();
  setBoundsProvider(() => new Bounds(new Vector3(32, 0, 32), new Vector3(64, 10, 64)));
  core = new GameCore();
  setInstanceProvider(() => core);
  core.installFrame(core.currentFrame);
});

afterEach(() => {
  setInstanceProvider(null);
  setFrameResolver(null);
  setViewerResolver(null);
  setBoundsProvider(null);
  setAllTreesInSceneProvider(null);
});

function makePlayer(id: number): GameCorePlayer {
  const p = new GameCorePlayer();
  p.playerId = id;
  p.position = new Vector3(40, 0, 40);
  return p;
}

function makeSceneTree(
  x: number,
  activeSelf = true,
): { view: NatureTreeViewContract; setActiveCalls: boolean[] } {
  const setActiveCalls: boolean[] = [];
  const view: NatureTreeViewContract = {
    playerDetectionRange: 2,
    towerDirection: { x: 0, y: 0, z: 1 },
    getComponentPickupMovement: () => null,
    getHiddenTreePickup: () => null,
    transform: { position: { x, y: 0, z: 40 } },
    gameObject: {
      activeSelf,
      setActive: (v: boolean) => setActiveCalls.push(v),
    },
  };
  return { view, setActiveCalls };
}

describe('GameCoreTree', () => {
  it('ctor: hiddenPickupIndex -1, landed position, collision (0.15, 2.0)', () => {
    const t = new GameCoreTree(new Vector3(40, 0, 40));
    expect(t.hiddenPickupIndex).toBe(-1);
    expect(t.position.x).toBe(40);
    expect(t.position.z).toBe(40);
    expect(t.collision.radius).toBeCloseTo(0.15, 6);
    expect(t.collision.height).toBe(2);
    expect(t.isTreeValid()).toBe(true);
    expect(GameCoreTree.directlySetPickupDataIndex).toBe(2000);
  });

  it('breakdown counts + raises structureBreakEvent; revive raises treeReviveEvent only at 0', () => {
    const breaks: GameCoreObject[] = [];
    const revives: Array<[GameCoreTree, GameCorePlayer, number]> = [];
    const cbB = (o: GameCoreObject) => breaks.push(o);
    const cbR = (t: GameCoreTree, p: GameCorePlayer, i: number) => revives.push([t, p, i]);
    Events.structureBreakEvent.addListener(cbB, EventTime.Immediate);
    Events.treeReviveEvent.addListener(cbR, EventTime.Immediate);

    const tree = new GameCoreTree(new Vector3(40, 0, 40));
    const p = makePlayer(1);
    tree.breakdown();
    tree.breakdown();
    expect(breaks).toEqual([tree, tree]);
    expect(tree.referenceCount).toBe(2);
    expect(tree.isTreeValid()).toBe(false);

    tree.revive(p, 0);
    expect(revives).toEqual([]); // still 1 outstanding
    expect(tree.referenceCount).toBe(1);

    tree.revive(p, 1);
    expect(revives).toEqual([[tree, p, 1]]);
    expect(tree.isTreeValid()).toBe(true);

    Events.structureBreakEvent.removeListener(cbB);
    Events.treeReviveEvent.removeListener(cbR);
  });

  it('recreateViewer scans allTreesInScene: rejects far candidates, links within 1.0, syncs active flag', () => {
    const far = makeSceneTree(45); // delta 5 > 1.0 → rejected
    const near = makeSceneTree(40.5); // delta 0.5 ≤ 1.0 → linked
    setAllTreesInSceneProvider(() => [far.view, near.view]);

    const tree = new GameCoreTree(new Vector3(40, 0, 40));
    tree.breakdown(); // referenceCount 1 → shouldBeActive false

    const go = tree.recreateViewer();
    expect(go).toBe(near.view.gameObject);
    expect(near.setActiveCalls).toEqual([false]); // activeSelf true ≠ false → synced
    expect(far.setActiveCalls).toEqual([]);
  });

  it('recreateViewer leaves a healthy tree’s active viewer untouched', () => {
    const near = makeSceneTree(40.5, true);
    setAllTreesInSceneProvider(() => [near.view]);
    const tree = new GameCoreTree(new Vector3(40, 0, 40));
    expect(tree.recreateViewer()).toBe(near.view.gameObject);
    expect(near.setActiveCalls).toEqual([]); // activeSelf already matches
  });

  it('recreateViewer returns null with no scene trees (non-throwing, per reconstruction)', () => {
    setAllTreesInSceneProvider(() => null);
    const tree = new GameCoreTree(new Vector3(40, 0, 40));
    expect(tree.recreateViewer()).toBeNull();
  });
});
