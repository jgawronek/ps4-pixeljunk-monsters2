// Per-stage headless milestone: each stage the sim plays to a terminal state is pinned (outcome + replay hash).
// Runs `tsx src/main/headless-stage1.ts <N>` (the stage-N bundle + extracted scene or a synthetic layout, null physics seam).
// RE-PIN when sim semantics legitimately change (e.g. enemy drops, new mechanics): the hash covers every tick.
//
// TWO BOT MODES (see the header of headless-stage1.ts and docs/STAGE_GAMEPLAY_AUDIT.md):
//   legacy - stage 1 default: one tower_001 stand-in, damage tables x1, null terrain. Pin 0x61889fae2ea828f1 is UNCHANGED since
//            the enemy-drops work (pin history: 0x27227819f56d94ad before drops).
//   smart  - stages >= 2 default (BOT=smart for stage 1): real towers / projectile prefabs (Gaseous + Insect ported), serialized
//            enemy damage tables, boss weak points, balloon contract, terrain linecast, tower-mix bot, REAL per-enemy model bounds
//            (src/data/enemyBounds.generated.ts), home-query tolerance (GameCoreHome.setHomeQueryHeight). ALL 15 stages run on their
//            extracted scene (the earlier SYNTH=1 synthetic-layout pins were retired; the old 6-15 table was recorded on real scenes anyway).
// RE-PIN 2 (docs/STAGE_GAMEPLAY_AUDIT.md section 8): real enemy bounds + 60-min cap + home-query tolerance + bot (site weighting, balloon-aware AA mix,
// affordability fallback) changed every smart hash.
// Pin history of the smart pins (stages 2-5 were the OLD naive-bot results 0xf5dec45809d65bcb GAME OVER, 0x049939b21ebc36d6,
// 0xacc118c9d7e8277a GAME OVER, 0x0201d49b499cc085): re-pinned by the stage gameplay audit (docs/STAGE_GAMEPLAY_AUDIT.md).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run1 = promisify(execFile);
const ROOT = resolve(__dirname, '../..');
interface Pin { stage: number; bot: 'legacy' | 'smart'; outcome: 'STAGE CLEARED' | 'GAME OVER' | 'TIME CAP'; hash: string }
const PINS: ReadonlyArray<Pin> = [
  { stage: 1, bot: 'legacy', outcome: 'STAGE CLEARED', hash: '0x61889fae2ea828f1' },
  { stage: 1, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x62482f8a87a2f590' },
  { stage: 2, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x3b35b2d7ea80b47a' },
  { stage: 3, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x5151be58438f4e1b' },
  { stage: 4, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x55bd6c83d53eddf6' },
  { stage: 5, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x7e98904e5fa63a66' },
  { stage: 6, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0xd4a154cf7aeb9266' },
  { stage: 7, bot: 'smart', outcome: 'GAME OVER', hash: '0x3cc903fa932b1aca' },
  { stage: 8, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x63588e3d0382a4be' },
  { stage: 9, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x0c4c227166433f00' },
  { stage: 10, bot: 'smart', outcome: 'GAME OVER', hash: '0x2ed96a257b925307' },
  { stage: 11, bot: 'smart', outcome: 'GAME OVER', hash: '0xd197abd4747c5784' },
  { stage: 12, bot: 'smart', outcome: 'STAGE CLEARED', hash: '0x96b5b2efd5315fb6' },
  { stage: 13, bot: 'smart', outcome: 'GAME OVER', hash: '0xeb89bb8b81256246' },
  { stage: 14, bot: 'smart', outcome: 'GAME OVER', hash: '0x45d9a14655c9ffd4' },
  { stage: 15, bot: 'smart', outcome: 'GAME OVER', hash: '0x9e0deb9ffa9f01c6' },
];

async function run(p: Pin): Promise<{ outcome: string; hash: string }> {
  let out = '';
  try {
    const r = await run1(resolve(ROOT, 'node_modules/.bin/tsx'), ['src/main/headless-stage1.ts', String(p.stage)], {
      cwd: ROOT, encoding: 'utf8', timeout: 280_000, maxBuffer: 1 << 26,
      env: { ...process.env, BOT: p.bot },
    });
    out = r.stdout;
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? ''); // exit code 1 on GAME OVER / TIME CAP by design
  }
  return {
    outcome: /outcome:\s+(.+)/.exec(out)?.[1].trim() ?? 'none',
    hash: /replay hash:\s+(0x[0-9a-f]+)/.exec(out)?.[1] ?? 'none',
  };
}

describe.concurrent('headless per-stage milestones (pinned replay hashes)', () => {
  for (const p of PINS) {
    const have = existsSync(resolve(ROOT, `public/assets/stages/3d_stage_${String(p.stage).padStart(3, '0')}/scene.json`));
    (have ? it : it.skip)(`stage ${p.stage} [${p.bot}]: ${p.outcome} @ ${p.hash}`, async () => {
      const r = await run(p);
      expect(r.outcome).toBe(p.outcome);
      expect(r.hash).toBe(p.hash);
    }, 300_000);
  }
});
