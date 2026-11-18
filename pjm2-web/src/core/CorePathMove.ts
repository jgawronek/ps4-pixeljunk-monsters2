// src/core/CorePathMove.ts
// TypeScript port of decomp/src/GameCore/CorePathMove.cs
// (original: PixelJunk Monsters 2, Unity 5.6.5p1; @0x942020..0x942230 +
// IsSameCurve @0x93C530).
// Wraps a Q4.CatmullCurve path and converts travelled distance into curve
// samples. Caches the last curve parameter (m_lastCurveTime) so DistanceToTime
// can search incrementally from the previous position.
//
// TS ADAPTATIONS: CatmullCurve → CatmullCurveContract (the spline math port
// lands with the enemy-movement iteration); C# Sample overloads with out
// params → sample()/sampleWithVel() result objects ({ok, pos[, vel]}).

import { Vector3 } from '../engine/math/Vector3';
import type { CatmullCurveContract } from '../view/q4-contracts';

const f = Math.fround;

function toV3(v: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export class CorePathMove {
  private m_curve: CatmullCurveContract; // 0x10
  private m_lastCurveTime = f(-1.0); // 0x18
  /** C#: WaveData m_minionWaveData — set by the wave/minion spawn path
   *  (WaveManager port); opaque until then. */
  private m_minionWaveData: unknown = null; // 0x20

  // .ctor @0x942020
  constructor(pathCurve: CatmullCurveContract) {
    this.m_lastCurveTime = f(-1.0);
    this.m_curve = pathCurve;
  }

  // get_pathLength @0x942050
  get pathLength(): number {
    return this.m_curve.curveLength;
  }

  // get_curveLengthBeforeActivation @0x942070
  get curveLengthBeforeActivation(): number {
    return this.m_curve.curveLengthB4Activation;
  }

  // IsSameCurve @0x93C530 — same curve id.
  isSameCurve(other: CorePathMove): boolean {
    return this.m_curve.id === other.m_curve.id;
  }

  // Sample @0x942090 — position only, by linear distance along the curve.
  // Returns ok=false (and zero) once distance reaches/exceeds curve length.
  sample(distance: number): { ok: boolean; pos: Vector3 } {
    if (this.m_curve.curveLength <= distance) {
      return { ok: false, pos: Vector3.zero };
    }
    return { ok: true, pos: toV3(this.m_curve.sampleLinearDistance(distance)) };
  }

  // Sample @0x942110 — position + velocity, with a lateral side offset.
  sampleWithVel(
    distance: number,
    sideOffset: number,
  ): { ok: boolean; pos: Vector3; vel: Vector3 } {
    if (this.m_curve.curveLength <= distance) {
      return { ok: false, pos: Vector3.zero, vel: Vector3.zero };
    }
    this.m_lastCurveTime = f(this.m_curve.distanceToTime(distance, this.m_lastCurveTime));
    const pos = toV3(this.m_curve.sampleDirect(this.m_lastCurveTime, sideOffset));
    const vel = toV3(this.m_curve.sampleVelDirect(this.m_lastCurveTime));
    return { ok: true, pos, vel };
  }

  // GetMinionWaveData @0x9421F0
  getMinionWaveData(): unknown {
    return this.m_minionWaveData;
  }

  // DistanceToTime @0x942200 — fresh search (lastTime = -1).
  distanceToTime(distance: number): number {
    return this.m_curve.distanceToTime(distance, f(-1.0));
  }

  // NodeTimeToDistance @0x942230
  nodeTimeToDistance(time: number): number {
    return this.m_curve.nodeTimeToDistance(time);
  }
}
