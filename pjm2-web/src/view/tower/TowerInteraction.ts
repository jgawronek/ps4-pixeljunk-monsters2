// src/view/tower/TowerInteraction.ts
// Player <-> tower interaction + the Upgrade/Dismantle ring menu state machine
// (no DOM; the overlay lives in src/view/ui/TowerLevelUi.ts).
//
// ORIGINAL FLOW (decompiled/, see docs/TOWER_LEVEL_UPGRADE_ANALYSIS.md):
//   1. Walking into a structure's PlayerTrigger (radius = Structure 0x20 =
//      TowerBase.playerDetectionRange) adds it to PlayerStructureSelector
//      (Structure.OnPlayerEnter @0x535BE0); PlayerInteraction.Update
//      (@0x3EE7A0) calls TowerBuildRingController.EnterHover -> the ring shows
//      a "button prompt" state (RingStateEvolveButtonShow).
//   2. The "interact" button -> PlayerController.ReceiveActionInput @0x3EE370:
//      fruit interaction first, then InteractionObject AI, otherwise the
//      NEAREST SELECTION's OnInteraction(player). TowerBase.OnInteraction
//      @0x54BCF0 opens the ring (TowerBuildRingController.Show) unless the
//      player is stunned/busy or the tower is in TowerStateBuild.
//   3. TowerBuildRingController.OnShow @0x5CBDC0 registers the ring-menu axis
//      "ring_menu_scroll", the confirm button (GamePreferences
//      interactConfirmButtonName) and the cancel button, sends BusyCommand(true)
//      for local players in network matches, and pushes RingStateEvolveUpgrade
//      when the target is a tower (RingStateBuildCategory for a tree).
//   4. RingStateEvolveUpgrade.OnCursorMove @0x5B4C30: scroll axis below the
//      threshold switches to RingStateEvolveSell (and back).
//   5. UPGRADE confirm (OnConfirm @0x5B4910): disabled state (OnDisable flag
//      from CanConfirm @0x5B3FD0 = HasInventory(Coin, next.costCoin) &&
//      HasInventory(Gem, next.costGem) for the LOCAL player) -> sound
//      TowerNoEnoughInventory when a next upgrade exists, TowerConfirmFail when
//      there is none (max level); otherwise queue UpgradeTowerCommand(next.level)
//      for the player, push RingStateEvolveConfirmUpgrade (plays the Decide
//      animation, then ForceBackFirstState: the ring closes and re-hovers).
//   6. DISMANTLE confirm (RingStateEvolveSell.OnConfirm @0x5B35D0): queue
//      SellTowerCommand(handle, tower.refundCoin (+0x94), tower.refundGem
//      (+0x98)), play TowerSell, push RingStateEvolveConfirmSell. The refund
//      reaches the inventory through CurrencyFlyer -> AddInventoryCommand.
//   7. Cancel (RingState.OnCancel @0x5AB240) closes the ring; leaving the
//      trigger closes it too (TowerBuildRingController.OnOutHover @0x5CC350).

import { GameCoreHandle } from '../../core/GameCoreHandle';
import { EInventoryType } from '../../core/GameCoreInventory';
import type { GameCoreTower } from '../../core/GameCoreTower';
import { TowerStateBuild } from '../../core/TowerStateBuild';
import type { NetworkCommand } from '../../core/network/NetworkCommand';
import { SellTowerCommand } from '../../core/network/SellTowerCommand';
import { UpgradeTowerCommand } from '../../core/network/UpgradeTowerCommand';

export type RingPhase = 'closed' | 'upgrade' | 'sell';

/** Sound ids (Q4.GlobalSounds property -> decoded clip, tools/assets/audio-out/globalsounds_map.json). */
export const RING_SOUND = {
  open: 'sfx/sfx_ringmenu_openringmenu',
  select: 'sfx/sfx_ringmenu_select',
  confirm: 'sfx/sfx_ringmenu_confirm',
  cancel: 'sfx/sfx_ringmenu_cancel',
  close: 'sfx/sfx_ringmenu_closeringmenu',
  /** GlobalSounds.TowerConfirmFail */
  confirmFail: 'sfx/sfx_ringmenu_accessdenied',
  /** GlobalSounds.TowerNoEnoughInventory */
  noInventory: 'sfx/sfx_ringmenu_notenoughresources',
  /** GlobalSounds.TowerSell */
  sell: 'sfx/sfx_tower_dismantletower',
} as const;

export interface TowerInteractionDeps {
  /** Alive towers (excluding destroyed). */
  towers(): Iterable<GameCoreTower>;
  playerPos(): { x: number; y: number; z: number };
  playerHandle(): GameCoreHandle;
  hasInventory(type: EInventoryType, amount: number): boolean;
  /** GameCoreNetworkBridge.AddPlayerCommand for the local player. */
  issue(cmd: NetworkCommand): void;
  playSound(name: string): void;
}

export type ConfirmOutcome = 'upgrade' | 'sell' | 'max' | 'no-funds' | 'ignored';

export class TowerInteraction {
  phase: RingPhase = 'closed';
  /** PlayerStructureSelector nearest selection (hover target). */
  selected: GameCoreTower | null = null;
  /** The tower the ring is open for (TowerBuildRingController.target). */
  target: GameCoreTower | null = null;

  constructor(private readonly deps: TowerInteractionDeps) {}

  get isOpen(): boolean {
    return this.phase !== 'closed';
  }

  /** PlayerStructureSelector.UpdateSelection: nearest tower whose trigger the player is inside. */
  updateSelection(): void {
    const p = this.deps.playerPos();
    let best: GameCoreTower | null = null;
    let bestD = Infinity;
    for (const t of this.deps.towers()) {
      if (t.isDestroyed()) continue;
      const dx = t.position.x - p.x;
      const dz = t.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= t.playerDetectionRange && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    this.selected = best;
    // OnOutHover: leaving the trigger (or the tower disappearing) closes the ring.
    if (this.isOpen && (this.target === null || this.target.isDestroyed() || this.selected !== this.target)) {
      this.close(false);
    }
  }

  /** TowerBase.OnInteraction guard: not while the tower is still being built. */
  canOpen(): boolean {
    const t = this.selected;
    if (t === null || t.isDestroyed()) return false;
    return !(t.getTowerState() instanceof TowerStateBuild);
  }

  /** The "interact" button. */
  open(): boolean {
    if (this.isOpen || !this.canOpen()) return false;
    this.target = this.selected;
    this.phase = 'upgrade'; // OnShow pushes RingStateEvolveUpgrade
    this.deps.playSound(RING_SOUND.open);
    return true;
  }

  /** Scroll axis: +1 = toward Dismantle, -1 = toward Upgrade. */
  moveCursor(dir: number): void {
    if (!this.isOpen || dir === 0) return;
    const want: RingPhase = dir > 0 ? 'sell' : 'upgrade';
    if (want === this.phase) return;
    this.phase = want;
    this.deps.playSound(RING_SOUND.select);
  }

  /** RingStateEvolveUpgrade.CanConfirm @0x5B3FD0. */
  canUpgrade(): boolean {
    const t = this.target;
    if (t === null) return false;
    const next = t.getNextUpgrade();
    if (next === null) return false;
    return (
      this.deps.hasInventory(EInventoryType.Coin, next.costCoin ?? 0) &&
      this.deps.hasInventory(EInventoryType.Gem, next.costGem ?? 0)
    );
  }

  /** OnConfirm of the current ring state. */
  confirm(): ConfirmOutcome {
    const t = this.target;
    if (!this.isOpen || t === null || t.isDestroyed()) return 'ignored';
    if (this.phase === 'upgrade') {
      const next = t.getNextUpgrade();
      if (next === null || next.level === 0) {
        this.deps.playSound(RING_SOUND.confirmFail); // max level
        return 'max';
      }
      if (!this.canUpgrade()) {
        this.deps.playSound(RING_SOUND.noInventory);
        return 'no-funds';
      }
      this.deps.issue(new UpgradeTowerCommand(t.handle, next.level));
      this.deps.playSound(RING_SOUND.confirm);
      this.close(false); // ConfirmUpgrade state -> ForceBackFirstState
      return 'upgrade';
    }
    // sell: refund values come from the live sim tower (+0x94/+0x98)
    this.deps.issue(new SellTowerCommand(t.handle, t.refundCoin, t.refundGem));
    this.deps.playSound(RING_SOUND.sell);
    this.close(false);
    return 'sell';
  }

  cancel(): void {
    if (!this.isOpen) return;
    this.deps.playSound(RING_SOUND.cancel);
    this.close(false);
  }

  private close(sound: boolean): void {
    if (sound) this.deps.playSound(RING_SOUND.close);
    this.phase = 'closed';
    this.target = null;
  }
}
