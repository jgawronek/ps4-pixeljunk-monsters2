// tests/view/playerShell.test.ts
// The tikiman body GLB has no shell/mask; PlayerAvatarDecorator attaches the
// default carapace_00 + mask_00 prefabs and drives them from the player bones
// (Q4.PlayerAvatarDecorator.UpdateTransforms). See docs/PLAYER_SHELL_ANALYSIS.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CharacterLibrary } from '../../src/view/characters/CharacterLibrary';
import { PlayerStageView } from '../../src/view/characters/PlayerStageView';

const dir = (n: string) => new URL(`../../public/assets/characters/${n}/${n}.glb`, import.meta.url);

function stubFetch(): void {
  vi.stubGlobal('ProgressEvent', class {
    type: string; lengthComputable = false; loaded = 0; total = 0;
    constructor(type: string) { this.type = type; }
  });
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close: () => {} }));
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    const m = /\/([a-z0-9_]+)\/\1\.glb$/i.exec(url);
    if (m) return Promise.resolve(new Response(readFileSync(dir(m[1])).buffer.slice(0) as ArrayBuffer));
    if (/\.(png|webp)$/i.test(url)) return Promise.resolve(new Response(new Uint8Array([0])));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('tikiman shell (carapace) + mask cosmetics', () => {
  it('attaches default parts and mirrors player bone pose onto them', async () => {
    stubFetch();
    const lib = new CharacterLibrary('http://char.test/assets/characters/');
    await lib.loadMany(['tikiman_01', 'mask_00', 'carapace_00']);
    const view = new PlayerStageView(lib.instantiate('tikiman_01'), {
      mask: lib.instantiate('mask_00'),
      carapace: lib.instantiate('carapace_00'),
    });
    const shell = view.decorator.get('carapace');
    expect(shell).not.toBeNull();
    let skinned = 0;
    shell!.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) skinned++; });
    expect(skinned).toBe(1); // LOD0 only
    expect(view.decorator.get('mask')).not.toBeNull();
    expect(view.decorator.mappingCount).toBeGreaterThan(2);

    // Animate; the shell's Carapace_Bn must equal the body's Carapace_Bn pose.
    view.setMoving(true);
    for (let i = 0; i < 20; i++) view.update(1 / 30);
    const names = (root: THREE.Object3D) => {
      const found: THREE.Object3D[] = [];
      root.traverse((o) => { if (o.name === 'Carapace_Bn') found.push(o); });
      return found;
    };
    const body = view.root.getObjectByName('tikiman_01_comp')!;
    const bodyBone = names(body).find((b) => !shell!.getObjectById(b.id))!;
    const shellBone = names(shell!)[0];
    expect(shellBone.position.distanceTo(bodyBone.position)).toBeLessThan(1e-6);
    expect(shellBone.quaternion.angleTo(bodyBone.quaternion)).toBeLessThan(1e-6);
  });
});
