// Wave bar: per-wave icons come from Q4.EnemyBase.m_waveBarSprite (WaveBarMonsterIcon.Init @0x9006B0).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENEMY_WAVE_BAR } from '../../src/data/enemyWaveBar.generated';

const UI = resolve(__dirname, '../../public/assets/ui');
const sprites = existsSync(`${UI}/sprites.json`) ? (JSON.parse(readFileSync(`${UI}/sprites.json`, 'utf8')) as Record<string, unknown>) : null;

describe('ENEMY_WAVE_BAR (extracted from the enemies bundle)', () => {
  it('covers the roster and flags balloon / boss variants like the original', () => {
    expect(Object.keys(ENEMY_WAVE_BAR).length).toBeGreaterThanOrEqual(50);
    expect(ENEMY_WAVE_BAR['kuri_00_001']).toEqual({ sprite: 'wavebar_kuri_00', balloon: false, boss: false });
    // balloon variants (spawnMode 2) reuse the walker's sprite
    expect(ENEMY_WAVE_BAR['kuri_03_001']).toEqual({ sprite: 'wavebar_kuri_00', balloon: true, boss: false });
    expect(ENEMY_WAVE_BAR['giant_03_001'].sprite).toBe('wavebar_giant_00');
    expect(ENEMY_WAVE_BAR['boss_kao_01'].boss).toBe(true);
    // the boss sprites are NOT in name order in the original (boss_kao_01 uses ..._02_001)
    expect(ENEMY_WAVE_BAR['boss_kao_01'].sprite).toBe('wavebar_boss_kao_02_001');
  });
  it('every referenced sprite exists in sprites.json (when extracted)', () => {
    if (sprites === null) return;
    for (const d of Object.values(ENEMY_WAVE_BAR)) expect(sprites[d.sprite], d.sprite).toBeDefined();
  });
});
