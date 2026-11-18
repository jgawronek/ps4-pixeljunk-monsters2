// src/view/hub/HubModel.ts
// PURE logic of the walkable hub / world map (Q4.WorldMap + StagePortal + AreaLock + WorldMapArea + GameCameraTitle).
// No THREE / DOM: Node-testable. Data = src/data/hubScene.generated.ts (tools/data/export_hub.py). Evidence and the
// decompiled addresses are in docs/HUB_AND_TITLE_ANALYSIS.md. Coordinates here are Unity-space (left-handed, x NOT mirrored).
//
//   StagePortal.Awake @00529700      : a portal whose stage is not unlocked deactivates its GameObject (SetActive(false))
//                                      unless `m_ignoreLockedFlag`; OnPortalUnlocked -> StartSpawn (rises from `portalSpawnStartOffset`
//                                      over WorldMap.portalSpawnEffectDuration seconds, SFX TowerBuild then UnlockArea).
//   StagePortal.OnTriggerEnter/Exit  : UnityEvents.EnterStagePortal / ExitStagePortal -> StageSelectController.OnEnterStagePortal /
//                                      OnExitStagePortal @00531bf0/@00531ce0 -> StagePortalSelectController.Show + UpdateStagePortal.
//   WorldMapArea.OnTriggerEnter @00907a20 -> StageSelectController.OnEnterArea @005319b0 (area-name banner); triggers are
//                                      disabled while the title is up (OnEnterTitle) and enabled on ExitTitle.
//   AreaLock.get_isUnlocked @0072b9f0 : every `unlockStages` entry is in SaveData.unlockedStages (empty list -> true).
//   AreaLock.get_canUnlock @0072b810  : GetTotalPerfectCount() >= requiredRainbows && every requiredStages stage has a clear.
//   AreaLock.ApplyLockState @0072bcb0 : the lock's direct children are active iff NOT unlocked (setActiveOnUnlock == false).

import { HUB_SCENE, type HubAreaData, type HubLockData, type HubPortalData, type HubShape } from '../../data/hubScene.generated';

export type V3 = readonly [number, number, number];

/** tikiman_01 CharacterController capsule (docs/PLAYER_BOUNDS_ANALYSIS.md): radius 0.15, centre y 0.4 above the feet. */
export const PLAYER_TRIGGER = { radius: 0.15, centerY: 0.4, halfHeight: 0.375 } as const;

/** Minimal slice of SaveData the hub rules need (the real SaveData satisfies it). */
export interface HubSave {
  readonly unlockedStages: readonly string[];
  getTotalPerfectCount(): number;
  /** HasClearedStage(scene, -1): cleared at any difficulty. */
  hasClearedStage(scene: string, difficulty?: number): boolean;
}

export function hubPortals(sceneFilter?: (scene: string) => boolean): HubPortalData[] {
  return HUB_SCENE.portals.filter((p) => sceneFilter === undefined || sceneFilter(p.stage));
}

/** Unity trigger shape test: is the player's capsule centre inside the (scaled) trigger around `origin`? */
export function triggerContains(shape: HubShape, origin: V3, p: V3): boolean {
  const sx = Math.abs(shape.scale[0]);
  const sy = Math.abs(shape.scale[1]);
  const sz = Math.abs(shape.scale[2]);
  const cx = origin[0] + shape.center[0] * shape.scale[0];
  const cy = origin[1] + shape.center[1] * shape.scale[1];
  const cz = origin[2] + shape.center[2] * shape.scale[2];
  const py = p[1] + PLAYER_TRIGGER.centerY;
  const dx = p[0] - cx;
  const dz = p[2] - cz;
  const pr = PLAYER_TRIGGER.radius;
  if (shape.kind === 'sphere') {
    const r = (shape.radius ?? 0.5) * Math.max(sx, sy, sz) + pr;
    const dy = py - cy;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
  if (shape.kind === 'capsule') {
    // direction 1 = Y axis (every portal / area / lock capsule of the hub); capsule = cylinder + 2 hemispheres
    const r = (shape.radius ?? 0.5) * Math.max(sx, sz) + pr;
    const half = Math.max((shape.height ?? 1) * sy * 0.5, (shape.radius ?? 0.5) * Math.max(sx, sz));
    const dy = Math.abs(py - cy);
    if (dx * dx + dz * dz > r * r) return false;
    if (dy <= half - (shape.radius ?? 0.5) * Math.max(sx, sz)) return true;
    const cap = dy - (half - (shape.radius ?? 0.5) * Math.max(sx, sz));
    return dx * dx + dz * dz + cap * cap <= r * r;
  }
  if (shape.kind === 'box' && shape.size) {
    return Math.abs(dx) <= (shape.size[0] * sx) / 2 + pr && Math.abs(py - cy) <= (shape.size[1] * sy) / 2 + PLAYER_TRIGGER.halfHeight && Math.abs(dz) <= (shape.size[2] * sz) / 2 + pr;
  }
  return false;
}

/** StagePortal.Awake: is the portal's GameObject active for this save? `inCatalog` = the stage exists in the port (DLC stages 16..21 do not). */
export function portalVisible(portal: HubPortalData, save: Pick<HubSave, 'unlockedStages'>, isStageUnlocked: (scene: string) => boolean, inCatalog: boolean): boolean {
  if (!inCatalog) return false;
  if (portal.ignoreLockedFlag) return true;
  return isStageUnlocked(portal.stage);
}

/** The portal whose trigger contains `p` (first match in data order = Unity's last-entered semantics are not needed: portals are >3 units apart). */
export function selectPortal(portals: readonly HubPortalData[], p: V3, visible: (portal: HubPortalData) => boolean): HubPortalData | null {
  let best: HubPortalData | null = null;
  let bestD = Infinity;
  for (const portal of portals) {
    if (portal.trigger === null || !visible(portal)) continue;
    if (!triggerContains(portal.trigger, portal.pos as unknown as V3, p)) continue;
    const d = (portal.pos[0] - p[0]) ** 2 + (portal.pos[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = portal; }
  }
  return best;
}

/** WorldMapArea trigger containing `p` (area-name banner). Areas overlap: the one whose centre is nearest wins. */
export function selectArea(areas: readonly HubAreaData[], p: V3): HubAreaData | null {
  let best: HubAreaData | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    if (a.trigger === null) continue;
    const origin = (a.trigger.pos ?? a.pos) as unknown as V3;
    if (!triggerContains(a.trigger, origin, p)) continue;
    const d = (origin[0] - p[0]) ** 2 + (origin[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

// ---- AreaLock ------------------------------------------------------------------------------

/** AreaLock.get_isUnlocked. */
export function lockIsUnlocked(lock: Pick<HubLockData, 'unlockStages' | 'requiredRainbows' | 'requiredStages'>, unlocked: readonly string[]): boolean {
  return lock.unlockStages.every((s) => unlocked.includes(s));
}

/** AreaLock.get_canUnlock: enough rainbow fragments AND every required stage cleared at any difficulty. */
export function lockCanUnlock(lock: Pick<HubLockData, 'requiredRainbows' | 'requiredStages'>, save: Pick<HubSave, 'getTotalPerfectCount' | 'hasClearedStage'>): boolean {
  if (save.getTotalPerfectCount() < lock.requiredRainbows) return false;
  return lock.requiredStages.every((s) => save.hasClearedStage(s, -1));
}

/** Rainbow fragments still missing for the lock (tl_mini_dialog_text_011 `{replace_01}`). */
export function lockMissingRainbows(lock: Pick<HubLockData, 'requiredRainbows'>, save: Pick<HubSave, 'getTotalPerfectCount'>): number {
  return Math.max(0, lock.requiredRainbows - save.getTotalPerfectCount());
}

/** ApplyLockState: the lock's children are visible while locked (setActiveOnUnlock == false). */
export function lockChildrenActive(lock: Pick<HubLockData, 'setActiveOnUnlock'>, unlocked: boolean): boolean {
  return unlocked === lock.setActiveOnUnlock;
}

/** Locks sorted so overlapping barriers resolve deterministically: the lock whose interact trigger contains `p`. */
export function selectLock(locks: readonly HubLockData[], p: V3): HubLockData | null {
  let best: HubLockData | null = null;
  let bestD = Infinity;
  for (const l of locks) {
    if (l.trigger === null) continue;
    if (!triggerContains(l.trigger, l.pos as unknown as V3, p)) continue;
    const d = (l.pos[0] - p[0]) ** 2 + (l.pos[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

/** Collider indices (into the physics JSON) that still block the player for this set of unlocked stages. */
export function removedBlockerColliders(locks: readonly HubLockData[], unlocked: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const l of locks) {
    if (!lockChildrenActive(l, lockIsUnlocked(l, unlocked))) for (const k of l.blockerColliders) out.add(k);
  }
  return out;
}

/** Scene node indices hidden for this unlock state (lock children and their descendants). */
export function hiddenLockNodes(locks: readonly HubLockData[], unlocked: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const l of locks) {
    if (!lockChildrenActive(l, lockIsUnlocked(l, unlocked))) for (const n of l.descendantNodes) out.add(n);
  }
  return out;
}

/** AreaLock.SetStagesUnlock: stages newly unlocked by opening `lock` (does not mutate). */
export function stagesOpenedBy(lock: Pick<HubLockData, 'unlockStages'>, unlocked: readonly string[]): string[] {
  return lock.unlockStages.filter((s) => !unlocked.includes(s));
}

// ---- cameras -------------------------------------------------------------------------------

export interface CameraPose { pos: V3; forward: V3; up: V3; fov: number }

/** GameCameraTitle (static: its Animator `GameCameraTitle` only toggles the rainbow backdrop effect; no transform curves). */
export function titleCameraPose(): CameraPose {
  const c = HUB_SCENE.cameras.title;
  if (c === null) throw new Error('hub data has no GameCameraTitle');
  return { pos: c.pos as unknown as V3, forward: c.forward as unknown as V3, up: c.up as unknown as V3, fov: c.fov ?? 50 };
}

/** TitleScreenController.StartIntroAnimation @00545740: the m_tikimanLocator field is UNASSIGNED in the shipped title scene (no MonoBehaviour in
 *  level3 references the locator Transform), so the saved pose is the code's fallback `new Vector3(0.715, 0, 1.9)` (consts @0xB7CFD0/@0xB7CFD4) with
 *  Quaternion.identity (facing +Z, towards GameCameraTitle); the ground snap supplies y. */
export const TITLE_TIKIMAN_SPOT: V3 = [0.715, 0, 1.9];
export function titleTikimanPose(): { pos: V3; forward: V3 } {
  return { pos: [TITLE_TIKIMAN_SPOT[0], TITLE_TIKIMAN_SPOT[1], TITLE_TIKIMAN_SPOT[2]], forward: [0, 0, 1] };
}

/** Sample of the `ShowRainbowTitle` / `HideRainbow` clips of the GameCameraTitle animator: they only toggle an active flag
 *  (+ a ParticleSystem emission) over 1.0 s; there is no camera transform curve. Linear fade is used for the backdrop tint. */
export function rainbowBackdropAlpha(clip: 'ShowRainbowTitle' | 'HideRainbow', t: number): number {
  const k = Math.min(1, Math.max(0, t / 1.0));
  return clip === 'ShowRainbowTitle' ? k : 1 - k;
}

/** Portal rise (StagePortal.SpawnCoroutine): position lerps from pos+startOffset to pos over `duration` seconds. */
export function portalSpawnHeight(startOffsetY: number, duration: number, t: number): number {
  const k = duration <= 0 ? 1 : Math.min(1, Math.max(0, t / duration));
  return startOffsetY * (1 - k);
}

/** SaveData.GetStageSelectReturnPosition / StagePortal.GetPlayerReturnSpawnLocation: where the tikiman stands when the hub opens. */
export function startPosition(lastPlayedStage: string | null, portals: readonly HubPortalData[], playerIndex = 0): V3 {
  if (lastPlayedStage !== null && lastPlayedStage !== '') {
    const p = portals.find((q) => q.stage === lastPlayedStage);
    if (p !== undefined) {
      if (p.useSpawnPosition && p.spawnPositions.length > 0) return p.spawnPositions[Math.min(playerIndex, p.spawnPositions.length - 1)] as unknown as V3;
      return p.pos as unknown as V3;
    }
  }
  return titleTikimanPose().pos;
}
