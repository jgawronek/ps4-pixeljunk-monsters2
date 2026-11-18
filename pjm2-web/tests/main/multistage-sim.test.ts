// Re-entrancy of the sim globals (docs/STAGE_SESSION_ARCHITECTURE.md): running stages back to back in ONE
// process must give the same replay hashes as fresh processes (the pins of tests/data/headless-stages.test.ts).
// This is the sim-side half of "a second stage behaves identically to a fresh page load" (the browser half is
// the disposal-audit probe .work/probe-stage-switch.cjs).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runHeadlessStage } from '../../src/main/headless-stage1';
import { resetSimGlobals, simGlobalCounters } from '../../src/main/simReset';

const ROOT = resolve(__dirname, '../..');
/** Hash of a FRESH process (CLI) — robust to legitimate re-pins in tests/data/headless-stages.test.ts. */
function fresh(stage: number): string {
  let out = '';
  try {
    out = execFileSync(resolve(ROOT, 'node_modules/.bin/tsx'), ['src/main/headless-stage1.ts', String(stage)], { cwd: ROOT, encoding: 'utf8', timeout: 110_000 });
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? '');
  }
  return /replay hash:\s+(0x[0-9a-f]+)/.exec(out)?.[1] ?? 'none';
}
const have3 = existsSync(resolve(ROOT, 'public/assets/stages/3d_stage_003/scene.json'));

describe('sim globals are re-entrant (one process, several stages)', () => {
  it('stage 1 twice in one process: identical to the pin both times', async () => {
    const a = await runHeadlessStage(1, { quiet: true });
    const b = await runHeadlessStage(1, { quiet: true });
    const ref = fresh(1);
    expect(ref).not.toBe('none');
    expect(a.hash).toBe(ref);
    expect(b.hash).toBe(ref);
    expect(b.ticks).toBe(a.ticks);
  }, 240_000);

  (have3 ? it : it.skip)('stage 3 after stage 1 equals a fresh stage-3 run', async () => {
    await runHeadlessStage(1, { quiet: true });
    const r3 = await runHeadlessStage(3, { quiet: true });
    expect(r3.hash).toBe(fresh(3));
  }, 240_000);

  it('resetSimGlobals() drops every Events listener and registered view object', async () => {
    await runHeadlessStage(1, { quiet: true }); // leaves listeners/registry populated
    expect(simGlobalCounters().eventListeners).toBeGreaterThan(0);
    expect(simGlobalCounters().unityObjects).toBeGreaterThan(0);
    resetSimGlobals();
    expect(simGlobalCounters()).toEqual({ eventListeners: 0, unityObjects: 0 });
  }, 240_000);
});
