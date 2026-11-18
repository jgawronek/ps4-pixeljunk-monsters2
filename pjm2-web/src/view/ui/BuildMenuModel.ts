// src/view/ui/BuildMenuModel.ts
// Pure state machine of the tower BUILD ring menu (no DOM, no sim imports).
//
// ORIGINAL (decomp/decompiled, docs/GAME_UI_ANALYSIS.md section 3):
//  * Q4.UI.TowerBuildRingController.Show(player, tree) pushes
//    RingStateBuildCategory (UIStateStack). Confirm on a category pushes
//    RingStateBuildTowerIcon(categoryAnimator, index, isHistory = index==2)
//    (RingStateBuildCategory.OnConfirm @005ac5b0). Confirm on a tower icon with
//    CanConfirm == EnoughInventory && Buildable creates
//    `new BuildTowerCommand(prefab)` and AddPlayerCommand(playerID) then pushes
//    RingStateBuildTowerIconConfirm (the "Decide" animation) and
//    PushTowerSelectionHistory (RingStateBuildTowerIcon.OnConfirm @005b00a0).
//    Cancel pops a state (RingState.OnCancel).
//  * Prefab Hud_TowerRing (globalsettings bundle): 4 category slots
//    Ring_Build_Cat_01..04; each owns 8 Ring_Build_Tower_01..08 slots whose
//    TowerRingIconHook.towerID (0 = empty) is the tower number
//    (Q4.TowerDatabase.GetTowerPrefabByIDString: name EndsWith("D3")).
//    Slot positions: radius ~207 at 45 deg steps clockwise from "up"
//    (01 = (0,206), 02 = (147,146), 03 = (208,0) ... 08 = (-145,146)).
//  * Category index 2 (Cat_03, "Recent") is Q4.UI.RingStateBuildCategory
//    .IsHistoryCategory (index == 2); the prefab keeps Cat_03_Pos inactive and
//    maximumHistoryAmount = 3, rememberLastCategory = 1, rememberLastSelection = 0.
//  * Cursor input: Q4.UI.RingStateBuildCategory.OnCursorMove @005acf20 — stick
//    magnitude >= 0.5 (rodata b7da4c, Il2CppUserAssemblies.elf file off +0x4000)
//    -> angle = Vector2.Angle(up, v), mirrored to 360-angle when v.x < 0
//    (clockwise from up). GetCategoryIndex @005ad000: sector width 360/n,
//    half-width threshold categoryAngleThreshold = 45 deg; icons use
//    iconAngleThreshold = 22.5 (45 deg spacing).
//  * Availability (Q4.UI.TowerRingIconHook): Avaliable = prefab found AND DLC
//    available (GetTowerPrefab nulls DLC-locked prefabs -> empty slot);
//    Locked = TowerBase.IsLocked() (Lockable not in SaveData.unlockedItems);
//    Buildable = !Locked && !(singletonInScene && hasHiveTowerBuilt);
//    EnoughInventory = HasInventory(Coin, costCoin) && HasInventory(Gem, costGem).

export const STICK_THRESHOLD = 0.5; // rodata b7da4c
export const CATEGORY_ANGLE_THRESHOLD = 45; // TowerBuildRingController.categoryAngleThreshold
export const ICON_ANGLE_THRESHOLD = 22.5; // iconAngleThreshold
export const MAX_HISTORY = 3; // maximumHistoryAmount
export const SLOT_COUNT = 8;
export const HISTORY_CATEGORY = 2;

export interface RingCategoryDef {
  /** 0-based index = clockwise position (0 up, 1 right, 2 down, 3 left). */
  index: number;
  /** tl_ring_building_cat_00N. */
  labelKey: string;
  /** Sprite name (ring_icon_category_0N). */
  icon: string;
  /** slot (1..8) -> towerID (Hud_TowerRing TowerRingIconHook.towerID). */
  slots: Readonly<Record<number, number>>;
}

/** Extracted from Hud_TowerRing (tools: .work/ui/dump_prefab.py). */
export const RING_CATEGORIES: readonly RingCategoryDef[] = [
  { index: 0, labelKey: 'tl_ring_building_cat_001', icon: 'ring_icon_category_01', slots: { 1: 7, 2: 8, 3: 10, 8: 9 } },
  { index: 1, labelKey: 'tl_ring_building_cat_002', icon: 'ring_icon_category_02', slots: { 3: 11, 4: 12 } },
  { index: 2, labelKey: 'tl_ring_building_cat_003', icon: 'ring_icon_category_03', slots: {} },
  { index: 3, labelKey: 'tl_ring_building_cat_004', icon: 'ring_icon_category_04', slots: { 1: 4, 2: 5, 5: 6, 6: 2, 7: 1, 8: 3 } },
];

/** One tower as the ring sees it. */
export interface BuildTowerEntry {
  id: number;
  /** prefab name, e.g. tower_001 (also the BuildTowerCommand towerType). */
  name: string;
  costCoin: number;
  costGem: number;
  /** TowerBase.IsLocked(). */
  locked: boolean;
  singleton: boolean;
}

export interface BuildMenuDeps {
  /** TowerDatabase lookup by id; null = no prefab / DLC unavailable (empty slot). */
  tower(id: number): BuildTowerEntry | null;
  coins(): number;
  gems(): number;
  /** TowerBase.hasHiveTowerBuilt (a singleton tower already exists). */
  singletonBuilt(name: string): boolean;
}

export type BuildPhase = 'closed' | 'category' | 'icon';

export type ConfirmResult =
  | { kind: 'enter-category'; category: number }
  | { kind: 'build'; tower: BuildTowerEntry }
  | { kind: 'rejected'; reason: 'no-funds' | 'locked' | 'singleton' | 'empty' }
  | { kind: 'none' };

/** Angle in degrees, clockwise from "up" (+y), for stick vector (x right, y up). */
export function stickAngle(x: number, y: number): number {
  const len = Math.hypot(x, y);
  if (len === 0) return 0;
  // Vector2.Angle(up, v) in [0,180], mirrored when v.x < 0 (rodata 360.0).
  const ang = (Math.acos(Math.max(-1, Math.min(1, y / len))) * 180) / Math.PI;
  return x < 0 ? 360 - ang : ang;
}

export function angleDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Slot (1..8) screen angle: clockwise from up in 45 deg steps. */
export function slotAngle(slot: number): number {
  return (slot - 1) * 45;
}

export class BuildMenuModel {
  phase: BuildPhase = 'closed';
  category = 0;
  /** selected slot (1..8) in the icon phase; 0 = none. */
  slot = 0;
  /** Most-recent-first tower ids (RingStateBuildTowerIcon.PushTowerSelectionHistory). */
  history: number[] = [];
  private lastCategory = 0; // rememberLastCategory

  constructor(private readonly deps: BuildMenuDeps) {}

  get isOpen(): boolean {
    return this.phase !== 'closed';
  }

  // ---- derived views ------------------------------------------------------

  /** Slots of `category` that have a resolvable tower. */
  slotsOf(category: number): { slot: number; tower: BuildTowerEntry }[] {
    const out: { slot: number; tower: BuildTowerEntry }[] = [];
    if (category === HISTORY_CATEGORY) {
      this.history.slice(0, MAX_HISTORY).forEach((id, i) => {
        const tower = this.deps.tower(id);
        if (tower !== null) out.push({ slot: i + 1, tower });
      });
      return out;
    }
    const def = RING_CATEGORIES[category];
    for (let s = 1; s <= SLOT_COUNT; s++) {
      const id = def.slots[s];
      if (id === undefined) continue;
      const tower = this.deps.tower(id);
      if (tower !== null) out.push({ slot: s, tower });
    }
    return out;
  }

  /** Categories shown: history only once something was built. */
  visibleCategories(): number[] {
    return [0, 1, 2, 3].filter((c) => (c === HISTORY_CATEGORY ? this.history.length > 0 : this.slotsOf(c).length > 0));
  }

  /** RingState*.OnDisable flags for a tower (greyed icon / red cost). */
  status(t: BuildTowerEntry): { buildable: boolean; coinOk: boolean; gemOk: boolean; affordable: boolean; locked: boolean } {
    const locked = t.locked;
    const singleton = t.singleton && this.deps.singletonBuilt(t.name);
    const coinOk = this.deps.coins() >= t.costCoin;
    const gemOk = this.deps.gems() >= t.costGem;
    return { buildable: !locked && !singleton, coinOk, gemOk, affordable: coinOk && gemOk, locked };
  }

  selectedTower(): BuildTowerEntry | null {
    if (this.phase !== 'icon') return null;
    return this.slotsOf(this.category).find((s) => s.slot === this.slot)?.tower ?? null;
  }

  // ---- transitions --------------------------------------------------------

  open(): boolean {
    if (this.visibleCategories().length === 0) return false;
    this.phase = 'category';
    const vis = this.visibleCategories();
    this.category = vis.includes(this.lastCategory) ? this.lastCategory : vis[0];
    this.slot = 0;
    return true;
  }

  close(): void {
    this.phase = 'closed';
    this.slot = 0;
  }

  /** OnCancel: icon -> category -> closed. Returns true if the menu closed. */
  cancel(): boolean {
    if (this.phase === 'icon') {
      this.phase = 'category';
      this.slot = 0;
      return false;
    }
    this.close();
    return true;
  }

  /** Stick/keys/pointer direction. Magnitude below STICK_THRESHOLD is ignored. */
  cursor(x: number, y: number): boolean {
    if (Math.hypot(x, y) < STICK_THRESHOLD) return false;
    return this.cursorAngle(stickAngle(x, y));
  }

  /** Direct angle (clockwise from up); returns true when the selection changed. */
  cursorAngle(angle: number): boolean {
    if (this.phase === 'category') {
      let best = -1;
      let bestD = Infinity;
      for (const c of this.visibleCategories()) {
        const d = angleDistance(angle, c * 90);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best < 0 || bestD > CATEGORY_ANGLE_THRESHOLD || best === this.category) return false;
      this.category = best;
      this.lastCategory = best;
      return true;
    }
    if (this.phase === 'icon') {
      let best = 0;
      let bestD = Infinity;
      for (const s of this.slotsOf(this.category)) {
        const d = angleDistance(angle, slotAngle(s.slot));
        if (d < bestD) { bestD = d; best = s.slot; }
      }
      if (best === 0 || bestD > ICON_ANGLE_THRESHOLD * 2 || best === this.slot) return false;
      this.slot = best;
      return true;
    }
    return false;
  }

  /** Jump straight to a category / slot (pointer hover). */
  hoverCategory(c: number): boolean {
    if (this.phase !== 'category' || !this.visibleCategories().includes(c) || c === this.category) return false;
    this.category = c;
    this.lastCategory = c;
    return true;
  }

  hoverSlot(slot: number): boolean {
    if (this.phase !== 'icon' || slot === this.slot) return false;
    if (!this.slotsOf(this.category).some((s) => s.slot === slot)) return false;
    this.slot = slot;
    return true;
  }

  confirm(): ConfirmResult {
    if (this.phase === 'category') {
      if (this.slotsOf(this.category).length === 0) return { kind: 'rejected', reason: 'empty' };
      this.phase = 'icon';
      // First icon snap: the lowest occupied slot (m_firstIconSnap).
      this.slot = this.slotsOf(this.category)[0].slot;
      return { kind: 'enter-category', category: this.category };
    }
    if (this.phase === 'icon') {
      const t = this.selectedTower();
      if (t === null) return { kind: 'none' };
      const st = this.status(t);
      // CanConfirm = EnoughInventory && Buildable.
      if (st.locked) return { kind: 'rejected', reason: 'locked' };
      if (!st.buildable) return { kind: 'rejected', reason: 'singleton' };
      if (!st.affordable) return { kind: 'rejected', reason: 'no-funds' };
      this.pushHistory(t.id);
      return { kind: 'build', tower: t };
    }
    return { kind: 'none' };
  }

  /** PushTowerSelectionHistory: move-to-front, unique, capped. */
  pushHistory(id: number): void {
    this.history = [id, ...this.history.filter((h) => h !== id)].slice(0, MAX_HISTORY);
  }
}
