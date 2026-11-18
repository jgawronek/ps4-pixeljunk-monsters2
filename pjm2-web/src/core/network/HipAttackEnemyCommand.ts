// src/core/network/HipAttackEnemyCommand.ts
// TypeScript port of decomp/src/GameCore/Network/HipAttackEnemyCommand.cs
// (TypeDefIndex 3009, RVA 0x4DD600..0x4DD790). The player's hip-attack
// (butt-stomp) on an enemy: damage is typed by the PLAYER VIEW's
// strength/class through DamageHelper.damageByAttributes, applied via
// enemy.dealPlayerDamage. Then — regardless of whether damage landed — the
// player's loose-coin drop is armed (the hip-attack knocks coins/gems out of
// the player: dropPickup with delay 1, loss == drop for both currencies).
// This is the sim half of the "money spills when you stomp" mechanic;
// processDropPickup spawns them.

import { DamageHelper } from '../DamageHelper';
import type { GameCoreEnemy } from '../GameCoreEnemy';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import type { PlayerCombatViewContract } from '../../view/q4-contracts';
import { NetworkCommand } from './NetworkCommand';

const f = Math.fround;

export class HipAttackEnemyCommand extends NetworkCommand {
  private m_enemyHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private m_power: number; // 0x30
  private m_numCoinsToDrop: number; // 0x34
  private m_numGemsToDrop: number; // 0x38
  private m_valuePerCoin: number; // 0x3C
  private m_valuePerGem: number; // 0x40

  // .ctor @0x4DD600
  constructor(
    a_enemyHandle: GameCoreHandle,
    a_power: number,
    a_numCoinsToDrop: number,
    a_numGemsToDrop: number,
    a_valuePerCoin: number,
    a_valuePerGem: number,
  ) {
    super();
    this.m_enemyHandle = a_enemyHandle;
    this.m_power = f(a_power);
    this.m_numCoinsToDrop = a_numCoinsToDrop | 0;
    this.m_numGemsToDrop = a_numGemsToDrop | 0;
    this.m_valuePerCoin = a_valuePerCoin | 0;
    this.m_valuePerGem = a_valuePerGem | 0;
  }

  // ExecuteCommand @0x4DD660 (virtual slot 4)
  executeCommand(a_executingPlayer: GameCorePlayer | null): void {
    if (this.m_power > 0) {
      const enemy = this.m_enemyHandle.getMostRecentObjectVersion<GameCoreEnemy>();
      if (enemy !== null) {
        if (a_executingPlayer === null) return; // binary: exception path
        // Player attack typing lives on the VIEW prefab (the decompiler shows
        // the raw field offsets 0x1C/0x20/0x18).
        const view = a_executingPlayer.getUnityObjectAs<PlayerCombatViewContract>();
        if (view === null) return; // binary: exception path — NOTE: skips the drop arming below (faithful)
        const damage = DamageHelper.damageByAttributes(
          view.strengthType,
          view.classType,
          enemy,
          this.m_power,
        );
        enemy.dealPlayerDamage(a_executingPlayer, damage, 0, view.oneKickOneBalloon);
      }
    }

    // Always arm the loose-currency spill (binary writes the player's
    // 0x80..0x9C block directly — identical to dropPickup with delay 1 and
    // loss == drop counts).
    if (a_executingPlayer !== null) {
      a_executingPlayer.dropPickup(
        1,
        this.m_numCoinsToDrop,
        this.m_numCoinsToDrop,
        this.m_numGemsToDrop,
        this.m_numGemsToDrop,
        this.m_valuePerCoin,
        this.m_valuePerGem,
      );
    }
  }
}
