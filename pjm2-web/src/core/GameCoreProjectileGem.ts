// src/core/GameCoreProjectileGem.ts
// TypeScript port of decomp/src/GameCore/GameCoreProjectileGem.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; TypeDefIndex 3058,
// RVA 0x4C7720..0x4C7A50). Gem-tower deploy projectile: on its single Tick it
// hands the source tower the TowerStateUpgradeAround EXP-aura state (numbers
// snapshotted from the view prefab) and destroys itself.
// Aura state duration CONFIRMED: DAT_00b7c424 = 10000.0.

import {
  instantiateProjectileViewer,
  registerUnityObject,
  type TowerBaseContract,
} from '../view/q4-contracts';
import { GameCoreProjectile } from './GameCoreProjectile';
import type { GameCoreTower } from './GameCoreTower';
import { TowerStateUpgradeAround } from './TowerStateUpgradeAround';
import type { IDamageable } from './interfaces';

const f = Math.fround;

export class GameCoreProjectileGem extends GameCoreProjectile {
  private m_expBoostPerSecond = f(0); // 0xB0
  private m_destroyDropGem = 0; // 0xB4
  private m_maxLifeDuration = f(0); // 0xB8
  private m_sinkTimePerFragment = f(0); // 0xBC
  private m_upgradeInterval = f(0); // 0xC0
  private m_gemDropDelay = f(0); // 0xC4

  private static readonly upgradeAroundStateDuration = f(10000.0); // DAT_00b7c424

  // .ctor @0x4C7720
  constructor(tower: GameCoreTower, enemies: IDamageable[] | null, dealsDamage = true) {
    super(tower, enemies, dealsDamage);
    const towerBase = this.sourceTower.getUnityObject() as TowerBaseContract | null;
    if (towerBase === null || towerBase.projectile === null) return; // silent fall-through

    const gemView = instantiateProjectileViewer(towerBase.projectile, this.handle.m_handle);
    if (gemView === null) return;

    registerUnityObject(this.handle.m_handle, gemView);

    this.m_expBoostPerSecond = f(gemView.expBoostPerSecond ?? 0);
    this.m_destroyDropGem = (gemView.destroyDropGem ?? 0) | 0;
    this.m_maxLifeDuration = f(gemView.maxLifeDuration ?? 0);
    this.m_sinkTimePerFragment = f(gemView.towerSinkTimePerFragment ?? 0);
    this.m_upgradeInterval = f(gemView.upgradeInterval ?? 0);
    this.m_gemDropDelay = f(gemView.gemDropDelay ?? 0);
  }

  // Tick @0x4C7910 — hand the aura to the tower, then destroy self.
  override tick(): void {
    const tower = this.sourceTower.getMostRecentObjectVersion<GameCoreTower>();
    const auraState = new TowerStateUpgradeAround(
      GameCoreProjectileGem.upgradeAroundStateDuration,
      this.m_expBoostPerSecond,
      this.m_destroyDropGem,
      this.m_upgradeInterval,
      this.m_sinkTimePerFragment,
      this.m_maxLifeDuration, // → m_upgradeDuration (+Max) in the state
      this.m_gemDropDelay,
    );
    // FAITHFUL: binary NREs if the tower is gone.
    tower!.setTowerState(auraState);
    this.destroySelf();
  }
}
