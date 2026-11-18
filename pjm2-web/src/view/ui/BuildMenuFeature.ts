// src/view/ui/BuildMenuFeature.ts
// Glue between the sim and the build ring (BuildMenuModel + BuildMenuUi):
//   hover  : Q4.PlayerStructureSelector nearest tree within the trigger -> the
//            access icon (Q4.UI.AccessIconController / InteractionHint) over the tree;
//   open   : "interact" (ReceiveActionInput -> TowerBuildRingController.Show);
//   choose : stick/keys angle -> category -> tower icon; pointer hover/tap;
//   confirm: RingStateBuildTowerIcon.OnConfirm -> BuildTowerCommand(prefab) via the
//            network bridge (driver.addPlayerCommand) — the sim command is
//            UNCHANGED, only the tower prefab it carries now comes from the ring;
//   cancel : pops one state, then closes.
// Sim determinism: nothing here touches the sim except issuing the existing
// BuildTowerCommand for the local player.
//
// INPUT SCHEME (original: gamepad stick "ring_menu_scroll" + confirm/cancel buttons;
// the keyboard/mouse/touch equivalents are this port's mapping):
//   keyboard : E / Enter / Space = interact + confirm; WASD / arrows = cursor
//              direction; Q / Backspace / Escape = cancel (Escape closes the ring
//              before it can pause); the tower-level feature keeps E for towers.
//   mouse    : hover = move cursor, click = confirm (click outside = cancel);
//              clicking a tree walks to it and opens the ring.
//   touch    : tap tree = walk + open; tap an icon = select, tap it again = build;
//              tap outside = cancel; the on-screen access icon is tappable.
//   gamepad  : left stick = cursor, A/Cross(0) = interact + confirm, B/Circle(1) = cancel.

import { EInventoryType, type GameCoreInventory } from '../../core/GameCoreInventory';
import type { GameCorePlayer } from '../../core/GameCorePlayer';
import type { GameCoreTree } from '../../core/GameCoreTree';
import { BuildTowerCommand } from '../../core/network/BuildTowerCommand';
import type { NetworkCommand } from '../../core/network/NetworkCommand';
import type { TowerBaseContract } from '../q4-contracts';
import {
  BuildMenuModel,
  RING_CATEGORIES,
  type BuildTowerEntry,
} from './BuildMenuModel';
import { BuildMenuUi, type RingRenderInput } from './BuildMenuUi';
import type { UiAssets } from './UiAssets';
import { css, spriteEl, UiRoot } from './UiDom';
import { t, type StringTable } from './UiText';

export const HOVER_RADIUS = 2.5; // matches game.ts BUILD_REACH
export const SOUND = {
  open: 'sfx/sfx_ringmenu_openringmenu',
  select: 'sfx/sfx_ringmenu_select',
  confirm: 'sfx/sfx_ringmenu_confirm',
  cancel: 'sfx/sfx_ringmenu_cancel',
  close: 'sfx/sfx_ringmenu_closeringmenu',
  denied: 'sfx/sfx_ringmenu_accessdenied',
  noFunds: 'sfx/sfx_ringmenu_notenoughresources',
} as const;

/** DLC gate of TowerBase.dlcLock (Q4.DLCManager.IsDLCAvailable): 0 none, 1/2 DLC packs. */
export type DlcAvailable = (lock: number) => boolean;

export interface BuildMenuDeps {
  assets: UiAssets;
  uiRoot: UiRoot;
  player(): GameCorePlayer;
  inventory(): GameCoreInventory;
  trees(): readonly GameCoreTree[];
  /** All buildable tower contracts by prefab name (TowerDatabase). */
  towers(): ReadonlyMap<string, TowerBaseContract>;
  /** towers.json records (lockable / dlcLock metadata). */
  towerMeta(): ReadonlyMap<string, { lockable: boolean; dlcLock: number }>;
  issue(cmd: NetworkCommand): void;
  playSound(name: string): void;
  strings(): StringTable;
  /** world -> viewport px (+ visible). */
  project(pos: { x: number; y: number; z: number }, h: number): { x: number; y: number; visible: boolean };
  /** attack-range preview (TowerBuildMenuPreviewer.m_attackPreview). */
  preview(tree: GameCoreTree | null, prefab: TowerBaseContract | null): void;
  /** true while a tower is hover-selected (the level ring owns "interact"). */
  towerSelected(): boolean;
  /** true while pause/results own the input. */
  blocked(): boolean;
  /** query: is a singleton tower (hive) already present? */
  singletonBuilt(name: string): boolean;
  dlcAvailable?: DlcAvailable;
}

const KEY_DIR: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export class BuildMenuFeature {
  readonly model: BuildMenuModel;
  private readonly ui: BuildMenuUi;
  private target: GameCoreTree | null = null;
  private hover: GameCoreTree | null = null;
  private readonly prompt: HTMLDivElement;
  private shakeT = 0;
  private held = new Set<string>();
  private padConfirm = false;
  private padCancel = false;
  /** Q4.SaveData.unlockedItems stand-in (progression is not ported: default = all). */
  readonly unlocked = new Set<string>();
  private unlockAll = true;
  private lastPreview = '';
  /** Last build request (debug/tests). */
  lastBuilt: string | null = null;

  constructor(private readonly deps: BuildMenuDeps) {
    this.model = new BuildMenuModel({
      tower: (id) => this.entry(id),
      coins: () => deps.inventory().getAvailableInventory(deps.player().handle, EInventoryType.Coin),
      gems: () => deps.inventory().getAvailableInventory(deps.player().handle, EInventoryType.Gem),
      singletonBuilt: (n) => deps.singletonBuilt(n),
    });
    this.ui = new BuildMenuUi(deps.assets, deps.uiRoot.el);
    this.ui.setCallbacks({
      hoverCategory: (i) => { if (this.model.hoverCategory(i)) deps.playSound(SOUND.select); },
      hoverSlot: (s) => { if (this.model.hoverSlot(s)) { deps.playSound(SOUND.select); } },
      pickCategory: (i) => { this.model.hoverCategory(i); this.confirm(); },
      pickSlot: (s) => {
        if (this.model.slot === s) this.confirm();
        else if (this.model.hoverSlot(s)) deps.playSound(SOUND.select);
      },
      cancel: () => this.cancel(),
    });
    // Access icon (AccessIconController): keycap bubble over the hovered tree.
    this.prompt = document.createElement('div');
    css(this.prompt, {
      position: 'absolute', left: '0', top: '0', display: 'none', pointerEvents: 'auto', cursor: 'pointer', zIndex: '7',
    });
    const bubble = spriteEl(deps.assets, 'ring_sign_01', 78, 92);
    const cap = document.createElement('div');
    cap.textContent = 'E';
    css(cap, {
      position: 'absolute', left: '0', top: '8px', width: '78px', textAlign: 'center',
      font: '800 46px "Trebuchet MS", sans-serif', color: '#fff6dc', textShadow: '0 2px 0 #4b2a10, 0 0 6px #4b2a10',
    });
    const wrap = document.createElement('div');
    css(wrap, { position: 'relative', width: '78px', height: '92px', transform: 'translate(-50%, -100%)' });
    wrap.append(bubble, cap);
    this.prompt.appendChild(wrap);
    this.prompt.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.openHovered(); });
    deps.uiRoot.el.appendChild(this.prompt);
  }

  /** Test/debug: unlock Lockable towers explicitly instead of "all". */
  setUnlocked(names: Iterable<string> | 'all'): void {
    this.unlocked.clear();
    if (names === 'all') { this.unlockAll = true; return; }
    this.unlockAll = false;
    for (const n of names) this.unlocked.add(n);
  }

  get isOpen(): boolean {
    return this.model.isOpen;
  }

  get targetTree(): GameCoreTree | null {
    return this.target;
  }

  /** TowerDatabase.GetTowerPrefabByIDString + TowerRingIconHook flags. */
  private entry(id: number): BuildTowerEntry | null {
    const name = `tower_${String(id).padStart(3, '0')}`;
    const prefab = this.deps.towers().get(name);
    if (prefab === undefined) return null;
    const meta = this.deps.towerMeta().get(name);
    if (meta !== undefined && meta.dlcLock !== 0 && !(this.deps.dlcAvailable?.(meta.dlcLock) ?? false)) return null;
    const locked = meta?.lockable === true && !this.unlockAll && !this.unlocked.has(name);
    return { id, name, costCoin: prefab.costCoin, costGem: prefab.costGem, locked, singleton: prefab.singletonInScene === true };
  }

  // ---- open / close -----------------------------------------------------------

  /** Open the ring for `tree` (RingController.OnShow). */
  openFor(tree: GameCoreTree): boolean {
    if (this.deps.blocked() || this.model.isOpen || !tree.isTreeValid()) return false;
    if (!this.model.open()) return false;
    this.target = tree;
    this.deps.playSound(SOUND.open);
    return true;
  }

  openHovered(): boolean {
    return this.hover !== null && this.openFor(this.hover);
  }

  private close(playSound = true): void {
    this.model.close();
    this.target = null;
    this.held.clear();
    this.deps.preview(null, null);
    this.lastPreview = '';
    this.ui.render({ phase: 'closed', cx: 0, cy: 0, categories: [], slots: [], centerIcon: '', shake: 0, hint: { confirm: '', cancel: '' } });
    if (playSound) this.deps.playSound(SOUND.close);
  }

  cancel(): void {
    if (!this.model.isOpen) return;
    const closed = this.model.cancel();
    this.deps.playSound(SOUND.cancel);
    if (closed) this.close(true);
  }

  confirm(): void {
    if (!this.model.isOpen) return;
    const r = this.model.confirm();
    switch (r.kind) {
      case 'enter-category':
        this.deps.playSound(SOUND.confirm);
        break;
      case 'build': {
        const tree = this.target;
        const prefab = this.deps.towers().get(r.tower.name);
        if (tree !== null && prefab !== undefined && tree.isTreeValid()) {
          this.deps.issue(new BuildTowerCommand(tree.handle, prefab));
          this.lastBuilt = r.tower.name;
          this.deps.playSound(SOUND.confirm);
        }
        this.close(false);
        break;
      }
      case 'rejected':
        this.shakeT = 0.28;
        this.deps.playSound(r.reason === 'no-funds' ? SOUND.noFunds : SOUND.denied);
        break;
      default:
        break;
    }
  }

  // ---- input ---------------------------------------------------------------------

  /** Keydown. Returns true when consumed. */
  onKey(code: string): boolean {
    if (this.deps.blocked()) return false;
    if (!this.model.isOpen) {
      if ((code === 'KeyE' || code === 'Enter') && !this.deps.towerSelected()) return this.openHovered();
      return false;
    }
    if (code in KEY_DIR) {
      this.held.add(code);
      this.applyHeld();
      return true;
    }
    if (code === 'KeyE' || code === 'Enter' || code === 'Space') { this.confirm(); return true; }
    if (code === 'KeyQ' || code === 'Backspace' || code === 'Escape') { this.cancel(); return true; }
    return true; // modal: swallow everything else while open
  }

  onKeyUp(code: string): void {
    this.held.delete(code);
  }

  private applyHeld(): void {
    let x = 0;
    let y = 0;
    for (const k of this.held) { x += KEY_DIR[k][0]; y += KEY_DIR[k][1]; }
    if (this.model.cursor(x, y)) this.deps.playSound(SOUND.select);
  }

  private pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p !== null && p !== undefined) ?? null;
    if (pad === null) { this.padConfirm = false; this.padCancel = false; return; }
    const a = pad.buttons[0]?.pressed === true;
    const b = pad.buttons[1]?.pressed === true;
    if (a && !this.padConfirm) {
      if (this.model.isOpen) this.confirm();
      else if (!this.deps.towerSelected()) this.openHovered();
    }
    if (b && !this.padCancel && this.model.isOpen) this.cancel();
    this.padConfirm = a;
    this.padCancel = b;
    if (this.model.isOpen) {
      const x = pad.axes[0] ?? 0;
      const y = -(pad.axes[1] ?? 0);
      if (this.model.cursor(x, y)) this.deps.playSound(SOUND.select);
    }
  }

  // ---- per frame -------------------------------------------------------------------

  update(dt: number): void {
    const d = this.deps;
    this.pollGamepad();
    if (d.blocked() && this.model.isOpen) this.close(false);

    // Hover tree = nearest valid tree in the trigger (PlayerStructureSelector).
    this.hover = null;
    if (!this.model.isOpen && !d.blocked()) {
      const p = d.player().position;
      let best = HOVER_RADIUS * HOVER_RADIUS;
      for (const tr of d.trees()) {
        if (!tr.isTreeValid()) continue;
        const dx = tr.position.x - p.x;
        const dz = tr.position.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; this.hover = tr; }
      }
    }
    // Access icon.
    if (this.hover !== null && !d.towerSelected()) {
      const s = d.project(this.hover.position, 2.2);
      const r = d.uiRoot.toRef(s.x, s.y);
      css(this.prompt, { display: s.visible ? 'block' : 'none', left: `${r.x}px`, top: `${r.y}px` });
    } else {
      this.prompt.style.display = 'none';
    }

    if (this.target !== null && !this.target.isTreeValid()) this.close(false);
    if (!this.model.isOpen || this.target === null) return;

    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    const s = d.project(this.target.position, 0.6);
    const ref = d.uiRoot.toRef(s.x, s.y);
    // RingController.uiPosLimitationInRate 0.42 + keep the whole ring on screen.
    const cx = Math.max(340, Math.min(1920 - 340, ref.x));
    const vis = d.uiRoot.visible();
    const cy = Math.max(vis.yMin + 330, Math.min(vis.yMax - 330, ref.y));
    this.ui.render(this.view(cx, cy));

    // attack-range preview of the highlighted tower (or none in the category phase)
    const sel = this.model.selectedTower();
    const key = sel === null ? '' : sel.name;
    if (key !== this.lastPreview) {
      this.lastPreview = key;
      d.preview(sel === null ? null : this.target, sel === null ? null : (d.towers().get(sel.name) ?? null));
    }
  }

  private view(cx: number, cy: number): RingRenderInput {
    return buildRingView(this.model, this.deps.assets, this.deps.strings(), cx, cy, this.shakeT > 0 ? Math.sin(this.shakeT * 70) * 14 * (this.shakeT / 0.28) : 0);
  }

  /** Visible/computed state for tests and the probe. */
  snapshot(): { open: boolean; phase: string; category: number; slot: number; tree: number | null; hover: number | null } {
    return {
      open: this.model.isOpen, phase: this.model.phase, category: this.model.category, slot: this.model.slot,
      tree: this.target?.handle.m_handle ?? null, hover: this.hover?.handle.m_handle ?? null,
    };
  }
}

/** Model -> render input (pure; also used by the UI lab page). */
export function buildRingView(
  m: BuildMenuModel, assets: UiAssets, S: StringTable, cx: number, cy: number, shake: number,
): RingRenderInput {
  const catView = m.visibleCategories().map((c) => ({
    index: c,
    icon: RING_CATEGORIES[c].icon,
    label: t(S, RING_CATEGORIES[c].labelKey, ''),
    selected: c === m.category,
  }));
  const slots = m.phase === 'icon'
    ? m.slotsOf(m.category).map(({ slot, tower }) => {
      const st = m.status(tower);
      return {
        slot,
        icon: assets.towerIcons[tower.name] ?? `ring_icon_tower_${String(tower.id).padStart(3, '0')}`,
        name: t(S, `tl_tower_name_${String(tower.id).padStart(3, '0')}`, tower.name),
        costCoin: tower.costCoin,
        costGem: tower.costGem,
        greyed: !st.buildable,
        locked: st.locked,
        coinOk: st.coinOk,
        gemOk: st.gemOk,
        selected: slot === m.slot,
      };
    })
    : [];
  return {
    phase: m.phase, cx, cy, categories: catView, slots,
    centerIcon: RING_CATEGORIES[m.category].icon, shake,
    hint: { confirm: 'E', cancel: 'Q' },
  };
}
