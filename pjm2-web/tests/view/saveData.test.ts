// tests/view/saveData.test.ts
// Phase-4 persistence (Q4.SaveData-shaped subset). Fake storage, no DOM.

import { describe, it, expect } from 'vitest';
import { SaveData, SAVE_VERSION, type StorageLike } from '../../src/view/save/SaveData';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  failOnSet = false;
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.failOnSet) throw new Error('quota');
    this.map.set(k, v);
  }
  removeItem(k: string): void { this.map.delete(k); }
}

const STAGE = 'tl_stage_001';
const MED = 1;

describe('SaveData', () => {
  it('starts empty with default preferences', () => {
    const s = new SaveData(new FakeStorage());
    expect(s.getStageRecord(STAGE, MED)).toBe(0);
    expect(s.hasClearedStage(STAGE)).toBe(false);
    expect(s.getStagePerfect(STAGE, MED)).toBe(false);
    expect(s.preferences.muted).toBe(false);
  });

  it('updateStageRecord stores score/perfect/cleared and reports improvement', () => {
    const s = new SaveData(new FakeStorage());
    expect(s.updateStageRecord(STAGE, MED, 50, false)).toBe(true); // first record
    expect(s.getStageRecord(STAGE, MED)).toBe(50);
    expect(s.hasClearedStage(STAGE, MED)).toBe(true);
    expect(s.getStagePerfect(STAGE, MED)).toBe(false);
  });

  it('keeps the BEST score across attempts', () => {
    const s = new SaveData(new FakeStorage());
    s.updateStageRecord(STAGE, MED, 80, false);
    expect(s.updateStageRecord(STAGE, MED, 40, false)).toBe(false); // worse → not improved
    expect(s.getStageRecord(STAGE, MED)).toBe(80); // best kept
    expect(s.updateStageRecord(STAGE, MED, 90, false)).toBe(true);
    expect(s.getStageRecord(STAGE, MED)).toBe(90);
  });

  it('perfect is sticky once earned', () => {
    const s = new SaveData(new FakeStorage());
    s.updateStageRecord(STAGE, MED, 86, true);
    expect(s.getStagePerfect(STAGE, MED)).toBe(true);
    s.updateStageRecord(STAGE, MED, 86, false); // later non-perfect run
    expect(s.getStagePerfect(STAGE, MED)).toBe(true); // still perfect
  });

  it('hasClearedStage with no difficulty checks ANY difficulty', () => {
    const s = new SaveData(new FakeStorage());
    s.updateStageRecord(STAGE, 2, 30, false); // Hard only
    expect(s.hasClearedStage(STAGE, MED)).toBe(false);
    expect(s.hasClearedStage(STAGE)).toBe(true); // any
    expect(s.hasClearedStage(STAGE, -1)).toBe(true);
  });

  it('persists across instances via storage', () => {
    const store = new FakeStorage();
    const a = new SaveData(store);
    a.updateStageRecord(STAGE, MED, 70, true);
    a.setMuted(true);
    const b = new SaveData(store); // reload
    expect(b.getStageRecord(STAGE, MED)).toBe(70);
    expect(b.getStagePerfect(STAGE, MED)).toBe(true);
    expect(b.preferences.muted).toBe(true);
  });

  it('discards a mismatched-version blob', () => {
    const store = new FakeStorage();
    store.setItem('pjm2-web.save', JSON.stringify({ version: SAVE_VERSION + 1, stages: { 'x|1': { score: 99, perfect: true, cleared: true } }, preferences: { muted: true } }));
    const s = new SaveData(store);
    expect(s.getStageRecord('x', 1)).toBe(0); // discarded
    expect(s.preferences.muted).toBe(false);
  });

  it('survives a corrupt blob', () => {
    const store = new FakeStorage();
    store.setItem('pjm2-web.save', '{not json');
    const s = new SaveData(store);
    expect(s.getStageRecord(STAGE, MED)).toBe(0);
    s.updateStageRecord(STAGE, MED, 10, false); // still usable
    expect(s.getStageRecord(STAGE, MED)).toBe(10);
  });

  it('removeStageRecord clears all difficulties for the stage', () => {
    const s = new SaveData(new FakeStorage());
    s.updateStageRecord(STAGE, MED, 50, false);
    s.updateStageRecord(STAGE, 2, 60, true);
    s.removeStageRecord(STAGE);
    expect(s.hasClearedStage(STAGE)).toBe(false);
    expect(s.getStageRecord(STAGE, 2)).toBe(0);
  });

  it('setMuted persists and preferences is a copy', () => {
    const store = new FakeStorage();
    const s = new SaveData(store);
    s.setMuted(true);
    const p = s.preferences;
    p.muted = false; // mutating the copy must not affect the save
    expect(s.preferences.muted).toBe(true);
    expect(new SaveData(store).preferences.muted).toBe(true);
  });

  it('flush failure is swallowed (quota/private-mode)', () => {
    const store = new FakeStorage();
    store.failOnSet = true;
    const s = new SaveData(store);
    expect(() => s.updateStageRecord(STAGE, MED, 10, false)).not.toThrow();
    expect(s.getStageRecord(STAGE, MED)).toBe(10); // in-memory still works
  });

  it('null storage runs in-memory without throwing', () => {
    const s = new SaveData(null);
    s.updateStageRecord(STAGE, MED, 5, false);
    s.setMuted(true);
    expect(s.getStageRecord(STAGE, MED)).toBe(5);
    expect(s.preferences.muted).toBe(true);
  });
});
