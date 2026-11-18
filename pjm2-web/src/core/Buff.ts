// src/core/Buff.ts
// TypeScript port of decomp/src/GameCore/Buff.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; RVA 0x93CE50..0x93D120).
// Base class for all timed buffs applied to a GameCoreObject (enemy/player).
//
// Accessibility notes carried over from the C# reconstruction: the binary
// reads/writes m_timeRemain and calls executeBuff directly from
// BuffContainer.Tick (same-assembly access in the original) — both are public
// here with @internal-semantics comments.

import { Vector3 } from '../engine/math/Vector3';
import { Events } from './Events';
import { GameCoreHandle } from './GameCoreHandle';
import { GameCoreObject } from './GameCoreObject';
import {
  getMonstersAudio,
  type AudioSourceContract,
} from '../view/q4-contracts';

const f = Math.fround;

export abstract class Buff extends GameCoreObject {
  /** @internal semantics — BuffContainer.Tick reads/writes this directly
   *  (binary @0x93DE87/0x93DEF2..0x93DEFE). */
  m_timeRemain: number; // 0x60
  protected m_sound: AudioSourceContract | null = null; // 0x68 (C#: UnityEngine.AudioSource)
  protected m_sourceProjectile: GameCoreHandle; // 0x70

  // get_SourceProjectile @0x93CF10
  get sourceProjectile(): GameCoreHandle {
    return this.m_sourceProjectile;
  }

  // .ctor @0x93CE50
  constructor(duration: number) {
    super();
    this.m_sourceProjectile = GameCoreHandle.nullHandle;
    this.m_timeRemain = f(duration);
  }

  // ResetTimer @0x93CF00
  resetTimer(duration: number): void {
    this.m_timeRemain = f(duration);
  }

  // UpdateBuff @0x93CF20
  // While the buff is still valid, run its effect, then count down by dt.
  updateBuff(target: GameCoreObject, dt: number): void {
    if (this.m_timeRemain >= 0.0) {
      this.executeBuff(target); // virtual slot 10
    }
    this.m_timeRemain = f(this.m_timeRemain - dt);
  }

  // UpdateTime @0x93CF90 (private in C#; unused externally)
  private updateTime(dt: number): void {
    this.m_timeRemain = f(this.m_timeRemain - dt);
  }

  // Valid @0x93CF70
  valid(): boolean {
    return this.m_timeRemain >= 0.0;
  }

  // OnEnterBuff @0x93CFA0 (virtual slot 9) — base no-op.
  onEnterBuff(_target: GameCoreObject): void {}

  // ExecuteBuff (abstract, virtual slot 10).
  // @internal semantics: invoked by BuffContainer.Tick through the vtable.
  abstract executeBuff(target: GameCoreObject): void;

  // OnExitBuff @0x93CFB0 (virtual slot 11)
  // Raises removeBuffEvent (Events statics +0x158), then stops SFX.
  // TS ADAPTATION: C# passes System.Type (this.GetType()); TS passes the
  // constructor function — listeners compare constructors instead of Types.
  onExitBuff(target: GameCoreObject): void {
    Events.removeBuffEvent.invoke(target, this.constructor);
    this.stopSFX();
  }

  // StopSFX @0x93D060
  protected stopSFX(): void {
    if (this.m_sound !== null) {
      const audio = getMonstersAudio();
      if (audio !== null) audio.stopSFX(this.m_sound);
      this.m_sound = null;
    }
  }

  // PlaySFX @0x93D120
  // If a sound is already playing, only move it; otherwise start a monitored
  // SFX and keep the returned source. Headless (no audio provider): no-op —
  // sim state never depends on audio.
  protected playSFX(a_clip: unknown, a_pos: Vector3): void {
    if (a_clip == null) return;
    const audio = getMonstersAudio();
    if (this.m_sound !== null) {
      this.m_sound.setPosition({ x: a_pos.x, y: a_pos.y, z: a_pos.z });
    } else {
      if (audio === null) return;
      this.m_sound = audio.playSFXMonitored(a_clip, { x: a_pos.x, y: a_pos.y, z: a_pos.z }, this.m_sound);
    }
  }
}
