// src/view/hub/HubChibis.ts
// The hub's NPC chibis: 10 `chibi_01` PrefabLoader nodes (prefab = the chibi rig, MiniDialog interaction) scattered over the world map
// (hubTrees.generated.ts HUB_CHIBIS, world TRS from the scene). Each stands at its node, runs the real Chibi logic (ChibiMotor + the serialized
// chibi_ctrl Animator: idle variations) through the shared IntroChibiView renderer. Not ported: MiniDialog talk bubbles, reactions to the player
// (Chibi.IsPlayerClose / hop) -- the NPCs just idle.

import type * as THREE from 'three';
import { HUB_CHIBIS, type HubChibiNode } from '../../data/hubTrees.generated';
import type { CharacterRig } from '../characters/CharacterLibrary';
import { ChibiMotor } from '../characters/ChibiMotor';
import { CHIBI_VIEW_DATA } from '../characters/chibiViewData.generated';
import { IntroChibiView } from '../intro/IntroChibiView';
import type { ChibiIntroRunner } from '../intro/ChibiIntroRunner';

export class HubChibis {
  readonly view: IntroChibiView;
  readonly root: THREE.Group;
  private readonly motors: ChibiMotor[] = [];

  constructor(makeRig: () => CharacterRig | null, nodes: readonly HubChibiNode[] = HUB_CHIBIS) {
    for (const c of nodes) {
      const y = c.pos[1];
      const m = new ChibiMotor(
        {
          clipLength: (n) => (CHIBI_VIEW_DATA.clips as Record<string, { length: number | null }>)[n]?.length ?? 0,
          // flat ground at the authored node height (the hub terrain pick is not wired to the motors)
          linecast: (a, b) => (a.y >= y && b.y <= y ? y : null),
        },
        { x: c.pos[0], y, z: c.pos[2] }, c.yaw,
      );
      m.enableRunSound = false;
      this.motors.push(m);
    }
    const runner = {
      chibis: this.motors.map((motor) => ({ motor })),
      update: (dt: number): void => { for (const m of this.motors) m.update(dt); },
    } as unknown as ChibiIntroRunner;
    this.view = new IntroChibiView(runner, makeRig);
    this.root = this.view.root;
    this.root.name = 'hub-chibis';
  }

  update(dt: number): void { this.view.update(dt); }
  dispose(): void { this.view.dispose(); }
}
