// src/view/tower/TowerLevelFeature.ts
// Glue that wires the tower level / upgrade feature into the game shell:
//   * loads the per-tower upgrade tables (public/assets/data/tower-upgrades.json,
//     exported by tools/data/export_tower_upgrades.py) and serves the
//     Q4.TowerUpgradeSetting component for TowerBaseContract;
//   * hover/selection + ring-menu interaction (TowerInteraction);
//   * tikiman tower-EXP dance (TowerDanceExp -> TowerXPCommand);
//   * level overlay (TowerLevelUi) + upgrade/sell/level-up presentation events;
//   * sell refund -> coin/gem pickups at the tower (PickupDrops.ts, Q4.PickupManager.OnTowerSold).
// Input (the original uses the "interact" action; keyboard/touch equivalents):
//   open ring  : E / Enter (or tap the on-screen prompt)
//   cursor     : W/S/Up/Down  (ring_menu_scroll axis)
//   confirm    : E / Enter / Space (menu_confirm_interact)
//   cancel     : Q / Backspace / Escape (menu_cancel_interact; Escape closes the OPEN ring first, pause otherwise) /
//                gamepad B / click outside the ring / the ✕ entry

import { EventTime } from '../../core/event/CoreEvent';
import { Events } from '../../core/Events';
import type { GameCoreEnemy } from '../../core/GameCoreEnemy';
import type { GameCoreHandle } from '../../core/GameCoreHandle';
import type { GameCoreInventory } from '../../core/GameCoreInventory';
import type { GameCorePlayer } from '../../core/GameCorePlayer';
import { GameCoreTower } from '../../core/GameCoreTower';
import type { GameCore } from '../../core/GameCore';
import { TowerXPCommand } from '../../core/network/TowerXPCommand';
import type { NetworkCommand } from '../../core/network/NetworkCommand';
import { TowerStateBuild } from '../../core/TowerStateBuild';
import { TowerStateDegenerate } from '../../core/TowerStateDegenerate';
import { AIHelper } from '../../core/AIHelper';
import { Vector3 } from '../../engine/math/Vector3';
import type { TowerUpgradeSettingContract } from '../q4-contracts';
import { t, type StringTable } from '../ui/UiText';
import { TowerLevelUi, type WorldProjector, type RingView } from '../ui/TowerLevelUi';
import {
  DANCE_SEARCH_HEIGHT,
  DANCE_SEARCH_RADIUS,
  DanceState,
  STILL_EPSILON,
  TowerDanceExp,
} from './TowerDanceExp';
import { TowerInteraction } from './TowerInteraction';
import { buildUpgradeSettings, type TowerUpgradeSettingGeneric, type TowerUpgradeTable } from './TowerUpgradeSetting';

export const FLAG_UP_SOUND = 'sfx/sfx_tower_flagup'; // GlobalSounds.TowerFlagUp
export const UPGRADE_SOUND = 'sfx/sfx_tower_levelup'; // GlobalSounds.TowerUpgrade
export const FINAL_UPGRADE_SOUND = 'sfx/sfx_tower_levelcomplete'; // GlobalSounds.TowerFinalUpgrade

export interface TowerLevelFeatureDeps {
  core(): GameCore;
  player(): GameCorePlayer;
  inventory(): GameCoreInventory;
  /** GameCoreNetworkBridge.AddPlayerCommand for the local player. */
  issue(cmd: NetworkCommand): void;
  playSound(name: string): void;
  strings(): StringTable;
  project: WorldProjector;
  /** tikiman dance hook (PlayerStageView.keepDancing). */
  danceView(active: boolean): void;
  /** Difficulty multiplier (DifficultySettings.DanceEXPByDifficulty: Medium = 1.0). */
  danceExpRate: number;
}

export class TowerLevelFeature {
  private settings = new Map<string, TowerUpgradeSettingGeneric>();
  readonly interaction: TowerInteraction;
  readonly dance = new TowerDanceExp();
  readonly ui: TowerLevelUi;
  private lastPos: Vector3 | null = null;
  /** Unity-space speed this frame supplied by the game (standing detection). */
  private moving = false;

  constructor(private readonly deps: TowerLevelFeatureDeps) {
    this.interaction = new TowerInteraction({
      towers: () => deps.core().allObjects<GameCoreTower>(GameCoreTower),
      playerPos: () => deps.player().position,
      playerHandle: () => deps.player().handle,
      hasInventory: (type, amount) => deps.inventory().hasInventory(deps.player().handle, type, amount),
      issue: (c) => deps.issue(c),
      playSound: (n) => deps.playSound(n),
    });
    this.ui = new TowerLevelUi(
      {
        levelUp: t(deps.strings(), 'tl_hud_001', 'Level Up!'),
        upgrade: t(deps.strings(), 'tl_ring_tower_001', 'Upgrade'),
        dismantle: t(deps.strings(), 'tl_ring_tower_002', 'Dismantle'),
        interact: t(deps.strings(), 'tl_controls_006', 'Interact'),
        levelByKey: (k) => t(deps.strings(), k, 'Lv.'),
        max: 'MAX',
      },
      deps.project,
      {
        onInteract: () => this.openRing(),
        onCursor: (d) => this.interaction.moveCursor(d),
        onConfirm: () => this.interaction.confirm(),
        onCancel: () => this.interaction.cancel(),
      },
    );
  }

  /** Install the per-tower tables (from tower-upgrades.json). */
  setTable(table: TowerUpgradeTable): void {
    this.settings = buildUpgradeSettings(table);
  }

  /** Q4.TowerBase.GetComponent<TowerUpgradeSetting>() for the prefab `name`. */
  settingFor(name: string): TowerUpgradeSettingContract | null {
    return this.settings.get(name) ?? null;
  }

  attach(container: HTMLElement): void {
    this.ui.attach(container);
  }

  /** Wire sim events -> presentation. Call once at game start. */
  wireEvents(): void {
    Events.expGrantEvent.addListener((tower: GameCoreTower, amount: number) => {
      this.ui.onGrantExp(tower, amount);
    }, EventTime.Immediate);
    Events.towerUpgradeEvent.addListener((tower: GameCoreTower) => {
      // Q4.TowerBase.OnUpgrade @0x54B520: TowerUpgrade / TowerFinalUpgrade sound
      // (final when GetNextUpgrade is now null) + flag-up sound after the flag animation.
      const finalLevel = tower.getNextUpgrade() === null;
      this.deps.playSound(finalLevel ? FINAL_UPGRADE_SOUND : UPGRADE_SOUND);
      this.ui.onUpgrade(tower, tower.currentLevel);
    }, EventTime.Immediate);
    Events.towerSellEvent.addListener(
      (tower: GameCoreTower, _p: GameCorePlayer) => {
        this.ui.onSell(tower);
        // Q4.PickupManager.OnTowerSold @0x3E40E0 spawns the refund as coin/gem PICKUPS at the tower
        // (the player collects them) and reduces SpentCoins/SpentGems — see PickupDrops.ts.
        // Nothing is credited directly here (the previous instant AddInventoryCommand was wrong).
      },
      EventTime.Immediate,
    );
    Events.enemyDestroyedEvent.addListener((_t: unknown, enemy: GameCoreEnemy) => {
      if (enemy.isBoss) this.ui.onBossDestroyed();
    }, EventTime.Immediate);
  }

  get ringOpen(): boolean {
    return this.interaction.isOpen;
  }

  openRing(): void {
    this.interaction.open();
  }

  /** Keyboard handler. Returns true when the key was consumed. */
  onKey(code: string): boolean {
    const ix = this.interaction;
    if (!ix.isOpen) {
      if (code === 'KeyE' || code === 'Enter') return ix.open();
      return false;
    }
    switch (code) {
      case 'KeyW': case 'ArrowUp': ix.moveCursor(-1); return true;
      case 'KeyS': case 'ArrowDown': ix.moveCursor(1); return true;
      case 'KeyE': case 'Enter': case 'Space': ix.confirm(); return true;
      case 'KeyQ': case 'Backspace': case 'Escape': ix.cancel(); return true;
      default: return false;
    }
  }

  /** Tower the player is currently dancing on (EXP dance), or null. */
  danceTarget: GameCoreTower | null = null;

  private padA = false;
  private padB = false;
  private padUp = false;
  private padDown = false;

  /** Gamepad: A = interact / confirm, B = cancel, stick / d-pad up-down = cursor (BuildMenuFeature uses the same buttons). */
  private pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p !== null && p !== undefined) ?? null;
    if (pad === null) { this.padA = this.padB = this.padUp = this.padDown = false; return; }
    const a = pad.buttons[0]?.pressed === true;
    const b = pad.buttons[1]?.pressed === true;
    const ay = pad.axes[1] ?? 0;
    const up = ay < -0.6 || pad.buttons[12]?.pressed === true;
    const down = ay > 0.6 || pad.buttons[13]?.pressed === true;
    const ix = this.interaction;
    if (ix.isOpen) {
      if (a && !this.padA) ix.confirm();
      if (b && !this.padB) ix.cancel();
      if (up && !this.padUp) ix.moveCursor(-1);
      if (down && !this.padDown) ix.moveCursor(1);
    }
    this.padA = a; this.padB = b; this.padUp = up; this.padDown = down;
  }

  /** Per-frame: selection, dance EXP, overlay. `moving`: player is walking this frame. */
  update(dt: number, moving: boolean, gameOver: boolean, locked = false): void {
    const player = this.deps.player();
    this.pollGamepad();
    // Never leave the player stuck in a modal ring: the game ended (clear / game over) -> close it.
    if (gameOver && this.interaction.isOpen) this.interaction.cancel();
    this.moving = moving;
    this.interaction.updateSelection(locked);

    // ---- tower-EXP dance (Q4.Player.CheckForTowers) ----
    const pos = player.position;
    const moved = this.lastPos === null ? 0 : pos.sub(this.lastPos).magnitude;
    this.lastPos = pos.clone();
    const nearest = AIHelper.findClosestObject<GameCoreTower>(
      GameCoreTower, pos, DANCE_SEARCH_RADIUS, DANCE_SEARCH_HEIGHT,
    );
    const grant = this.dance.update({
      dt,
      still: moved < STILL_EPSILON && !moving,
      standing: !this.interaction.isOpen,
      gameOver,
      nearestTower: nearest,
      towerBusy: nearest !== null && (nearest.getTowerState() instanceof TowerStateBuild || nearest.getTowerState() instanceof TowerStateDegenerate),
      isNearestSelection: nearest !== null && nearest === this.interaction.selected,
      expRate: this.deps.danceExpRate,
    });
    if (grant !== null) this.deps.issue(new TowerXPCommand(grant.handle as GameCoreHandle, grant.amount));
    this.deps.danceView(this.dance.danceState === DanceState.Dancing);
    // Player.DanceTowerHandle / PlayerMotor.IsDancing: the tower being danced on (BlockingTreeHider fades it in the top-down view).
    this.danceTarget = this.dance.danceState === DanceState.Dancing ? nearest : null;

    // ---- overlay ----
    const t = this.interaction.target;
    const next = t?.getNextUpgrade() ?? null;
    const ring: RingView = {
      phase: this.interaction.phase,
      tower: t,
      upgradeEnabled: this.interaction.canUpgrade(),
      nextCostCoin: next?.costCoin ?? 0,
      nextCostGem: next?.costGem ?? 0,
      maxLevel: t !== null && next === null,
      refundCoin: t?.refundCoin ?? 0,
      refundGem: t?.refundGem ?? 0,
    };
    this.ui.update(dt, this.interaction.selected, this.interaction.canOpen(), 'E', ring);
  }
}
