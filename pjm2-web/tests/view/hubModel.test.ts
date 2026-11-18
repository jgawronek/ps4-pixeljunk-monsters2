import { describe, expect, it } from 'vitest';

import { HUB_SCENE } from '../../src/data/hubScene.generated';
import { STAGE_CATALOG } from '../../src/data/stageCatalog';
import {
  hiddenLockNodes, hubPortals, lockCanUnlock, lockChildrenActive, lockIsUnlocked, lockMissingRainbows, portalSpawnHeight, portalVisible,
  rainbowBackdropAlpha, removedBlockerColliders, selectArea, selectLock, selectPortal, stagesOpenedBy, startPosition, titleCameraPose,
  titleTikimanPose, triggerContains, type V3,
} from '../../src/view/hub/HubModel';

const inCatalog = (s: string): boolean => STAGE_CATALOG.some((e) => e.scene === s);
const save = (unlocked: string[], rainbows = 0, cleared: string[] = []) => ({
  unlockedStages: unlocked,
  getTotalPerfectCount: () => rainbows,
  hasClearedStage: (s: string) => cleared.includes(s),
});

describe('hub data (tools/data/export_hub.py)', () => {
  it('has the 21 walk-on portals, 8 areas, the AreaLocks and the 21 rainbow indicators', () => {
    expect(HUB_SCENE.portals.length).toBe(21);
    expect(HUB_SCENE.areas.length).toBe(8);
    expect(HUB_SCENE.rainbows.length).toBe(21);
    expect(HUB_SCENE.locks.map((l) => l.requiredRainbows).sort((a, b) => a - b)).toEqual([2, 2, 5, 5, 6, 9]);
    expect(hubPortals(inCatalog).length).toBe(15); // 16..21 are DLC stages without a scene in the port
  });
  it('rainbow thresholds match the documented gates (2 -> 4,7; 6 -> 8..12; 9 -> 13)', () => {
    const by = (n: number) => HUB_SCENE.locks.filter((l) => l.requiredRainbows === n).flatMap((l) => l.unlockStages);
    expect(new Set(by(2))).toEqual(new Set(['3d_stage_004', '3d_stage_007']));
    expect(new Set(by(6))).toEqual(new Set(['3d_stage_008', '3d_stage_009', '3d_stage_010', '3d_stage_011', '3d_stage_012']));
    expect(new Set(by(9))).toEqual(new Set(['3d_stage_013']));
  });
});

describe('portal selection (StagePortal trigger -> OnEnterStagePortal)', () => {
  const portals = hubPortals(inCatalog);
  const all = () => true;
  it('stands on a portal -> that portal; far away -> none', () => {
    const p1 = portals.find((p) => p.stage === '3d_stage_001')!;
    expect(selectPortal(portals, p1.pos as unknown as V3, all)?.stage).toBe('3d_stage_001');
    expect(selectPortal(portals, [0, 0, 0], all)).toBeNull();
  });
  it('trigger radius + player capsule radius: edge inside, beyond outside', () => {
    const p1 = portals.find((p) => p.stage === '3d_stage_001')!;
    const [x, y, z] = p1.pos;
    expect(selectPortal(portals, [x + 0.95, y, z], all)).not.toBeNull(); // radius 1.0 + player 0.15 (capsule == sphere r=1 at this height)
    expect(selectPortal(portals, [x + 1.3, y, z], all)).toBeNull();
  });
  it('hidden (locked) portals are never selected', () => {
    const p4 = portals.find((p) => p.stage === '3d_stage_004')!;
    expect(selectPortal(portals, p4.pos as unknown as V3, (p) => p.stage !== '3d_stage_004')).toBeNull();
  });
  it('StagePortal.Awake: locked portals are inactive unless ignoreLockedFlag; DLC stages never', () => {
    const p4 = portals.find((p) => p.stage === '3d_stage_004')!;
    expect(portalVisible(p4, save([]), () => false, true)).toBe(false);
    expect(portalVisible(p4, save([]), () => true, true)).toBe(true);
    expect(portalVisible({ ...p4, ignoreLockedFlag: true }, save([]), () => false, true)).toBe(true);
    expect(portalVisible(p4, save([]), () => true, false)).toBe(false);
  });
  it('all 15 shipped portals are reachable: a spawn position lies near its own trigger', () => {
    for (const p of portals) {
      expect(p.trigger).not.toBeNull();
      expect(triggerContains(p.trigger!, p.pos as unknown as V3, p.pos as unknown as V3)).toBe(true);
    }
  });
});

describe('areas', () => {
  it('an area trigger selects its banner; outside every area -> null', () => {
    const a = HUB_SCENE.areas[0];
    const centre = (a.trigger!.pos ?? a.pos) as unknown as V3;
    expect(selectArea(HUB_SCENE.areas, centre)?.label).toBeTruthy();
    expect(selectArea(HUB_SCENE.areas, [500, 0, 500])).toBeNull();
  });
});

describe('AreaLock (get_isUnlocked / get_canUnlock / ApplyLockState)', () => {
  const lock2 = HUB_SCENE.locks.find((l) => l.requiredRainbows === 2)!;
  const lock6 = HUB_SCENE.locks.find((l) => l.requiredRainbows === 6)!;
  it('unlocked only when every unlockStages entry is unlocked', () => {
    expect(lockIsUnlocked(lock2, [])).toBe(false);
    expect(lockIsUnlocked(lock2, ['3d_stage_004'])).toBe(false);
    expect(lockIsUnlocked(lock2, ['3d_stage_004', '3d_stage_007'])).toBe(true);
  });
  it('canUnlock needs the rainbow fragments and every required stage clear', () => {
    expect(lockCanUnlock(lock2, save([], 1))).toBe(false);
    expect(lockCanUnlock(lock2, save([], 2))).toBe(true);
    expect(lockCanUnlock(lock6, save([], 5))).toBe(false);
    expect(lockCanUnlock(lock6, save([], 6))).toBe(true);
    expect(lockCanUnlock({ requiredRainbows: 0, requiredStages: ['a'] }, save([], 9, []))).toBe(false);
    expect(lockCanUnlock({ requiredRainbows: 0, requiredStages: ['a'] }, save([], 0, ['a']))).toBe(true);
    expect(lockMissingRainbows(lock6, save([], 4))).toBe(2);
    expect(lockMissingRainbows(lock6, save([], 9))).toBe(0);
  });
  it('children (barrier model + colliders) are active exactly while locked', () => {
    expect(lockChildrenActive(lock2, false)).toBe(true);
    expect(lockChildrenActive(lock2, true)).toBe(false);
    const locked = hiddenLockNodes(HUB_SCENE.locks, []);
    const open = hiddenLockNodes(HUB_SCENE.locks, ['3d_stage_004', '3d_stage_007']);
    expect(locked.size).toBe(0);
    for (const n of lock2.descendantNodes) expect(open.has(n)).toBe(true);
    expect(removedBlockerColliders(HUB_SCENE.locks, []).size).toBe(0);
    expect(removedBlockerColliders(HUB_SCENE.locks, ['3d_stage_004', '3d_stage_007']).size).toBeGreaterThan(0);
  });
  it('opening a lock reports only the newly unlocked stages', () => {
    expect(stagesOpenedBy(lock2, ['3d_stage_004'])).toEqual(['3d_stage_007']);
  });
  it('the interact trigger of a barrier selects it', () => {
    const l = HUB_SCENE.locks.find((x) => x.trigger !== null)!;
    expect(selectLock([l], l.pos as unknown as V3)).toBe(l);
    expect(selectLock([l], [900, 0, 900])).toBeNull();
  });
});

describe('title camera / tikiman (GameCameraTitle)', () => {
  it('static pose from the scene: (0, 0.76, 4.79) looking -Z with a 0.146 upward tilt, FOV 50; tikiman 1 m in front of the home facing +Z', () => {
    const c = titleCameraPose();
    expect(c.pos).toEqual([0, 0.76, 4.79]);
    expect(c.fov).toBe(50);
    expect(c.forward[2]).toBeLessThan(-0.98);
    expect(c.forward[1]).toBeCloseTo(0.1464, 3);
    const t = titleTikimanPose();
    expect(t.pos).toEqual([0.715, 0, 1.9]); // StartIntroAnimation fallback pose (m_tikimanLocator unassigned)
    expect(t.forward).toEqual([0, 0, 1]);
  });
  it('rainbow backdrop clips are 1 s fades (no camera transform curves)', () => {
    expect(rainbowBackdropAlpha('ShowRainbowTitle', 0)).toBe(0);
    expect(rainbowBackdropAlpha('ShowRainbowTitle', 0.5)).toBe(0.5);
    expect(rainbowBackdropAlpha('ShowRainbowTitle', 3)).toBe(1);
    expect(rainbowBackdropAlpha('HideRainbow', 0.25)).toBe(0.75);
  });
  it('portal spawn rise lerps from the start offset to 0 over the effect duration', () => {
    expect(portalSpawnHeight(-0.5, 5, 0)).toBe(-0.5);
    expect(portalSpawnHeight(-0.5, 5, 2.5)).toBe(-0.25);
    expect(portalSpawnHeight(-0.5, 5, 9)).toBeCloseTo(0, 9);
  });
  it('start position: last played portal spawn, else the tikiman origin', () => {
    const portals = hubPortals(inCatalog);
    const p = portals.find((q) => q.stage === '3d_stage_002')!;
    expect(startPosition('3d_stage_002', portals)).toEqual(p.spawnPositions[0]);
    expect(startPosition('', portals)).toEqual([0.715, 0, 1.9]);
    expect(startPosition(null, portals)).toEqual([0.715, 0, 1.9]);
    expect(startPosition('nope', portals)).toEqual([0.715, 0, 1.9]);
  });
});
