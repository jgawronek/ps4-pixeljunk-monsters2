import { describe, expect, it } from 'vitest';
import { SaveData } from '../../src/view/save/SaveData';
import { applyStageClear } from '../../src/view/save/StageProgress';
import { StageSelectModel } from '../../src/view/ui/StageSelectModel';

describe('StageSelectModel', () => {
  it('starts on stage 1, locked stages cannot be picked, cursor wraps in the 5x3 grid', () => {
    const save = new SaveData(null);
    const m = new StageSelectModel(save);
    expect(m.cursor).toBe(1);
    expect(m.pick()).toMatchObject({ ok: true, difficulty: 0 });
    m.move('right'); expect(m.cursor).toBe(2);
    expect(m.pick()).toMatchObject({ ok: false, reason: 'locked' });
    m.move('left'); m.move('left'); expect(m.cursor).toBe(3);
    m.move('down'); expect(m.cursor).toBe(6);
    m.move('up'); m.move('up'); expect(m.cursor).toBe(15); // wraps to the last area, same column
    m.move('down'); expect(m.cursor).toBe(3);
  });

  it('difficulty is clamped to what the stage has unlocked and cycles', () => {
    const save = new SaveData(null);
    const m = new StageSelectModel(save);
    m.cycleDifficulty(1); expect(m.difficulty).toBe(0);
    applyStageClear(save, '3d_stage_001', 0, 100, false);
    m.cycleDifficulty(1); expect(m.difficulty).toBe(1);
    expect(m.pick().ok).toBe(true);
    m.cycleDifficulty(1); expect(m.difficulty).toBe(0); // only Fun+Tricky available
    m.cycleDifficulty(-1); expect(m.difficulty).toBe(1);
    m.move('right'); // stage 2 is now unlocked but nothing cleared there
    expect(m.difficulty).toBe(0);
    expect(m.pick().ok).toBe(true);
  });

  it('resumes at the last played stage', () => {
    const save = new SaveData(null);
    applyStageClear(save, '3d_stage_001', 0, 1, false);
    applyStageClear(save, '3d_stage_002', 0, 1, false);
    expect(new StageSelectModel(save).cursor).toBe(2);
  });
});
