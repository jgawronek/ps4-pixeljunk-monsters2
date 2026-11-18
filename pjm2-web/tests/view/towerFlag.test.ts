// Tower level flags: flag_001_ctrl state machine + CoroutineDecorateFlag sequencing.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FLAG_CLIPS, TowerFlag, sampleKeys, setTowerFlagFactory } from '../../src/view/characters/TowerFlag';
import type { CharacterRig } from '../../src/view/characters/CharacterLibrary';

function rigFor(level: number): CharacterRig {
  const root = new THREE.Group();
  root.name = `flag_001_${level}`;
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial()));
  return { root } as unknown as CharacterRig;
}
function run(f: TowerFlag, seconds: number): void { for (let t = 0; t < seconds; t += 1 / 60) f.update(1 / 60); }

describe('TowerFlag', () => {
  it('clip keys: In swings flag_pos 90 -> -15 -> 5 -> 0 while the flag unfurls scaleY 0 -> 1.2 -> 0.9 -> 1', () => {
    expect(sampleKeys(FLAG_CLIPS.In.rotZ, 0)).toBe(90);
    expect(sampleKeys(FLAG_CLIPS.In.rotZ, 0.2)).toBe(-15);
    expect(sampleKeys(FLAG_CLIPS.In.scaleY, 0.2)).toBeCloseTo(1.2, 5);
    expect(sampleKeys(FLAG_CLIPS.Out.scaleY, 0.2)).toBe(0);
  });

  it('first upgrade: swaps the flag in on flag_pos, plays In (0.333 s) then rests at OnInIdle with the flag-up sound once', () => {
    setTowerFlagFactory(rigFor);
    const mount = new THREE.Group();
    let sounds = 0;
    const f = new TowerFlag(mount, () => { sounds++; });
    expect(f.state).toBe('OutIdle');
    f.setLevel(2);
    f.update(1 / 60);
    expect(f.state).toBe('In');
    expect(mount.children.map((c) => c.name)).toEqual(['flag_001_2']);
    expect(sounds).toBe(1);
    run(f, 0.5);
    expect(f.state).toBe('OnInIdle');
    expect(mount.rotation.z).toBeCloseTo(0, 5);
    expect(mount.children[0].scale.y).toBeCloseTo(1, 5);
  });

  it('a later upgrade first plays Out (0.2 s) and only then replaces the banner and plays In', () => {
    setTowerFlagFactory(rigFor);
    const mount = new THREE.Group();
    let sounds = 0;
    const f = new TowerFlag(mount, () => { sounds++; });
    f.setLevel(2); run(f, 0.6);
    f.setLevel(3);
    f.update(1 / 60);
    expect(f.state).toBe('Out');
    expect(mount.children[0].name).toBe('flag_001_2'); // old banner still there while folding away
    run(f, 0.25);
    expect(mount.children.map((c) => c.name)).toEqual(['flag_001_3']);
    expect(['In', 'OnInIdle']).toContain(f.state);
    expect(sounds).toBe(2);
  });

  it('ignores levels without a flag prefab (1, 6)', () => {
    setTowerFlagFactory(rigFor);
    const f = new TowerFlag(new THREE.Group(), () => undefined);
    f.setLevel(1); f.setLevel(6); run(f, 1);
    expect(f.state).toBe('OutIdle');
  });
});
