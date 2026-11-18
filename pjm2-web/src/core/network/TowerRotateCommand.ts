// src/core/network/TowerRotateCommand.ts
// TypeScript port of decomp/src/GameCore/Network/TowerRotateCommand.cs
// (TypeDefIndex 3004, RVA 0x4DF710..0x4DF830). Manual turret aiming: snaps the
// tower's fort direction to the given Euler angles (the player drags the aim
// reticle; the view samples it into this command every frame while aiming).

import { Quaternion } from '../../engine/math/Quaternion';
import { Vector3 } from '../../engine/math/Vector3';
import type { GameCoreHandle } from '../GameCoreHandle';
import type { GameCorePlayer } from '../GameCorePlayer';
import { GameCoreTower } from '../GameCoreTower';
import { NetworkCommand } from './NetworkCommand';

export class TowerRotateCommand extends NetworkCommand {
  private m_towerHandle: GameCoreHandle; // 0x10 (32-byte struct)
  private m_rotateX: number; // 0x30
  private m_rotateY: number; // 0x34

  // .ctor @0x4DF710 — C# takes Vector2 rotateEuler.
  constructor(towerHandle: GameCoreHandle, rotateEuler: { x: number; y: number }) {
    super();
    this.m_towerHandle = towerHandle;
    this.m_rotateX = rotateEuler.x;
    this.m_rotateY = rotateEuler.y;
  }

  // ExecuteCommand @0x4DF750 (virtual slot 4)
  executeCommand(_executingPlayerObject: GameCorePlayer | null): void {
    const tower = this.m_towerHandle.getMostRecentObjectVersion<GameCoreTower>();
    if (tower !== null) {
      tower.fortDirection = Quaternion.Euler(this.m_rotateX, this.m_rotateY, 0).multiplyVector(
        Vector3.forward,
      );
    }
  }
}
