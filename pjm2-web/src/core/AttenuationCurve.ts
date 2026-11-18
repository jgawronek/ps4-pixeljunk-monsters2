// src/core/AttenuationCurve.ts
// TypeScript port of Q4.AttenuationCurve.Sample @0x007302c0 (decompiled/
// Q4.AttenuationCurve.c). Damage attenuation curve sampling used by
// GameCoreProjectile.GetAttackDamage.
//
// Constants CONFIRMED by ELF float read: DAT_00b7fcd0 = 1.0 (default/fallback),
// DAT_00b7fcd4 = -1.0 (first-segment offset).
//
// Semantics (decoded from the raw body):
//  - null/empty table → 1.0.
//  - find the FIRST entry with t < rate; if none, fall back to index 0.
//  - snap entry → its attenuation (step).
//  - non-snap: lerp. First segment lerps from 1.0 (at t=0) to the entry's
//    attenuation (at t=rate): (atten − 1) × (t/rate) + 1. Later segments lerp
//    between the previous and current entry attenuations.

import type { AttackAttenuation } from '../data/types';

const f = Math.fround;

export class AttenuationCurve {
  private constructor() {}

  static sample(infos: AttackAttenuation[] | null, t: number): number {
    if (infos === null || infos.length < 1) return f(1.0);

    let i = 0;
    while (i < infos.length && !(t < infos[i].rate)) i++;
    if (i >= infos.length) i = 0; // faithful: no match → reset to 0

    const info = infos[i];
    if (info.snap) return f(info.attenuation);

    const atten = f(info.attenuation);
    if (i < 1) {
      // (atten + (−1)) × (1 − (rate − t)/rate) + 1
      const rate = f(info.rate);
      return f(f(f(atten + f(-1.0)) * f(f(1.0) - f(f(rate - t) / rate))) + f(1.0));
    }
    const prev = infos[i - 1];
    const rate = f(info.rate);
    const prevRate = f(prev.rate);
    const factor = f(f(1.0) - f(f(rate - t) / f(rate - prevRate)));
    return f(f(prev.attenuation) + f(factor * f(atten - f(prev.attenuation))));
  }
}
