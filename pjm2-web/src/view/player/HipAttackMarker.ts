// src/view/player/HipAttackMarker.ts
// The "!" shown over the enemy the hip attack would hit (Q4.UI.HUDHipAttackIcon: pooled HUD icon, Animator bool "ShieldAttack", shown by
// Events.hipAttackConditionEvent(player, enemy-or-null) from PlayerMotor.set_HipAttackEnemy, hidden with a DelayedGoToSleep invoke).
// APPROXIMATE: the prefab's art/animation was not decoded; this is a billboard "!" that follows the target, bobbing slightly.

import * as THREE from 'three';

export class HipAttackMarker {
  readonly sprite: THREE.Sprite;
  private readonly tex: THREE.CanvasTexture;
  private t = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g !== null) {
      g.font = 'bold 110px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 14;
      g.strokeStyle = '#7a1d00';
      g.strokeText('!', 64, 68);
      g.fillStyle = '#ffd21a';
      g.fillText('!', 64, 68);
    }
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    this.sprite.scale.set(0.6, 0.6, 1);
    this.sprite.renderOrder = 1000;
    this.sprite.visible = false;
    this.sprite.name = 'hip-attack-marker';
  }

  /** @param unityPos target body-top position in Unity space (x is mirrored here), or null to hide */
  update(dt: number, unityPos: { x: number; y: number; z: number } | null): void {
    if (unityPos === null) { this.sprite.visible = false; return; }
    this.t += dt;
    this.sprite.visible = true;
    this.sprite.position.set(-unityPos.x, unityPos.y + 0.25 + Math.sin(this.t * 9) * 0.06, unityPos.z);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    (this.sprite.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
