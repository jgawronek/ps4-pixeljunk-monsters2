import { describe, it, expect } from 'vitest';
import { STAGE_ENV_DATA } from '../../src/data/stageEnvironment.generated';
import { STAGE_CATALOG } from '../../src/data/stageCatalog';
import { STAGE_MUSIC } from '../../src/data/stageMusic.generated';
import { ALL_STAGE_SCENES, stageEnvironmentFor, skyEnvTextureUrl } from '../../src/view/stage/StageEnvironment';
import { STAGE1_AMBIENT_SH, STAGE1_AMBIENT_INTENSITY } from '../../src/view/stage/StageAmbient';
import { STAGE1_GRADE_PROFILE, bakeGradeLut } from '../../src/view/stage/PostGrade';
import { SKY_CLEAR_COLOR } from '../../src/view/stage/SkyAtmosphere';

describe('per-stage environment table', () => {
  it('has a row for every catalogue stage and matching music', () => {
    // 15 catalogue stages + the hub scene 3d_stage_000 (world map; stageEnvironmentFor('3d_stage_000'))
    expect(ALL_STAGE_SCENES.length).toBe(16);
    for (const s of STAGE_CATALOG) {
      const e = stageEnvironmentFor(s.scene);
      expect(e.known).toBe(true);
      expect(e.scene).toBe(s.scene);
      expect(e.music.stage).toBe(STAGE_MUSIC[s.scene].stageMusic);
      expect(e.music.boss).toBe(STAGE_MUSIC[s.scene].bossMusic);
      expect(e.ambient.sh).toHaveLength(27);
      expect(e.initCoin).toBeGreaterThan(0);
      expect(e.shadow?.casterName).toBe('Directional Light');
    }
  });

  it('stage 1 reproduces the former hard-coded constants', () => {
    const e = stageEnvironmentFor('3d_stage_001');
    expect(e.clearHex).toBe(SKY_CLEAR_COLOR);
    expect(e.ambient.intensity).toBe(STAGE1_AMBIENT_INTENSITY);
    e.ambient.sh.forEach((v, i) => expect(v).toBeCloseTo(STAGE1_AMBIENT_SH[i], 6));
    const g = e.grade, r = STAGE1_GRADE_PROFILE;
    expect(g.postExposure).toBeCloseTo(r.postExposure, 6);
    expect(g.temperature).toBe(r.temperature);
    expect(g.tint).toBe(r.tint);
    expect(g.hueShift).toBe(r.hueShift);
    expect(g.contrast).toBeCloseTo(r.contrast, 6);
    expect(g.logWheels.offset[0]).toBeCloseTo(r.logWheels.offset[0], 6);
    expect(g.curves.master[0].outSlope).toBeCloseTo(r.curves.master[0].outSlope, 6);
    expect(g.vignette.intensity).toBeCloseTo(r.vignette.intensity, 6);
    expect(e.camera.yawDeg).toBeCloseTo(0, 3);
    expect(e.camera.pitchDeg).toBeCloseTo(45, 2);
    expect(e.camera.fov).toBe(22.5);
    expect(e.bloom.enabled).toBe(false);
    // baked LUT identical to the stage-1 profile's
    const a = bakeGradeLut(g), b = bakeGradeLut(r);
    let maxd = 0;
    for (let i = 0; i < a.length; i++) maxd = Math.max(maxd, Math.abs(a[i] - b[i]));
    expect(maxd).toBeLessThan(1e-5);
  });

  it('stages 2/3 share stage 1 grade and stage 4+ differ (real per-area data)', () => {
    expect(stageEnvironmentFor('3d_stage_002').postProfile).toBe('3d_stage_001_topdown_pp');
    expect(stageEnvironmentFor('3d_stage_004').postProfile).toBe('3d_stage_004_topdown_pp');
    expect(stageEnvironmentFor('3d_stage_007').postProfile).toBe('3d_stage_007_topdown_pp');
    expect(stageEnvironmentFor('3d_stage_010').postProfile).toBe('3d_stage_010_topdown_pp');
    expect(stageEnvironmentFor('3d_stage_013').postProfile).toBe('3d_stage_013_topdown_pp');
    expect(stageEnvironmentFor('3d_stage_004').grade.postExposure).toBeCloseTo(0.4, 5);
    expect(stageEnvironmentFor('3d_stage_004').grade.channelMixer.red[0]).toBeCloseTo(1.35, 5);
    expect(stageEnvironmentFor('3d_stage_004').bloom.enabled).toBe(true);
    expect(stageEnvironmentFor('3d_stage_004').clearHex).not.toBe(stageEnvironmentFor('3d_stage_001').clearHex);
    expect(stageEnvironmentFor('3d_stage_004').ambient.intensity).toBe(1);
    expect(stageEnvironmentFor('3d_stage_007').clearHex).toBe(0x3e3e42);
  });

  it('camera rotation is the same top-down 45 deg / yaw 0 rig in every stage (stage 11 rig POSITION sits on +X but its rotation is identical)', () => {
    for (const s of STAGE_CATALOG) {
      const y = stageEnvironmentFor(s.scene).camera.yawDeg;
      expect(Math.abs(y)).toBeLessThan(0.01);
      expect(stageEnvironmentFor(s.scene).camera.pitchDeg).toBeCloseTo(45, 1);
    }
  });

  it('unknown scene falls back to stage 1 with known=false; sky env url only for sky_test_001/002', () => {
    expect(stageEnvironmentFor('nope').known).toBe(false);
    expect(skyEnvTextureUrl(stageEnvironmentFor('3d_stage_001'), '/x/')).toBeUndefined();
    expect(skyEnvTextureUrl(stageEnvironmentFor('3d_stage_004'), '/x/')).toBe('/x/sky/sky_test_001_env.webp');
    expect(skyEnvTextureUrl(stageEnvironmentFor('3d_stage_010'), '/x/')).toBe('/x/sky/sky_test_002_env.webp');
    expect(Object.keys(STAGE_ENV_DATA)).toHaveLength(16);
  });
});
