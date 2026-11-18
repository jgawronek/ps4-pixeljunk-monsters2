// src/view/stage/renderExtras.ts
// Which Unity PPSv1 extras (bloom, ambient occlusion) a stage's gameplay profile enables, gated by URL flags
// (?nobloom, ?noao). Pure: Node-testable.
import type { StageEnvironment } from './StageEnvironment';
import type { PassExtras } from './WaterPass';

export function renderExtrasFor(env: Pick<StageEnvironment, 'bloom' | 'ambientOcclusion'>, q: { has(k: string): boolean }): PassExtras {
  const b = env.bloom, a = env.ambientOcclusion;
  return {
    bloom: b.enabled && !q.has('nobloom') ? { intensity: b.intensity, threshold: b.threshold, softKnee: b.softKnee, radius: b.radius, antiFlicker: b.antiFlicker } : null,
    ao: a.enabled && !q.has('noao') ? { intensity: a.intensity, radius: a.radius, sampleCount: 3, downsampling: true } : null,
  };
}
