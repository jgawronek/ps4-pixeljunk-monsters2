// tests/view/skyAtmosphere.test.ts
// SkyAtmosphere: pure evidence-based decisions + headless guard/dispose logic.
// Node-only — a minimal fake renderer stands in for WebGLRenderer (same
// approach as riverWater.test.ts); the browser paths (TextureLoader, canvas
// grading, PMREM) are guarded by `typeof document` and never run here.
//
// Evidence under test: profile "3d_stage_001_topdown_pp" (tonemapper=1 ACES,
// postExposure 0.6 EV), RenderSettings m_AmbientIntensity 0.5 / m_Fog False,
// camera 4810 m_BackGroundColor #81b5d4 (see SkyAtmosphere.ts header).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SkyAtmosphere,
  resolveSkyOptions,
  gradeSkyRgb,
  SKY_TONE_MAPPING,
  DEFAULT_EXPOSURE,
  DEFAULT_AMBIENT_INTENSITY,
  SKY_TEXTURE_MAPPING,
  DEFAULT_SKY_TEXTURE_URL,
  SKY_CLEAR_COLOR,
  SKY_GRADIENT_STOPS,
  DEFAULT_GRADE_TINT_RGB,
  STAGE1_GRADE_EVIDENCE,
  type SkyOptions,
} from '../../src/view/stage/SkyAtmosphere';

/** Minimal renderer stand-in: apply() headless only writes these two props. */
function fakeRenderer() {
  return {
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

describe('pure evidence constants', () => {
  it('tone mapping is ACES (profile tonemapper=1), exposure = 2^0.6 EV, ambient 0.5', () => {
    expect(STAGE1_GRADE_EVIDENCE.tonemapper).toBe(1); // ACES, not Neutral(2)
    expect(SKY_TONE_MAPPING).toBe(THREE.ACESFilmicToneMapping);
    expect(DEFAULT_EXPOSURE).toBe(Math.fround(2 ** 0.6));
    expect(DEFAULT_EXPOSURE).toBeCloseTo(1.5157, 3);
    expect(DEFAULT_AMBIENT_INTENSITY).toBe(0.5); // RenderSettings.m_AmbientIntensity
    expect(STAGE1_GRADE_EVIDENCE.bloomEnabled).toBe(false); // gameplay camera
    expect(STAGE1_GRADE_EVIDENCE.fogEnabled).toBe(false); // m_Fog = False
  });

  it('sky mapping is equirect (NEAR single-face adaptation) + clear color #81b5d4', () => {
    expect(SKY_TEXTURE_MAPPING).toBe(THREE.EquirectangularReflectionMapping);
    expect(SKY_CLEAR_COLOR).toBe(0x81b5d4); // camera 4810 m_BackGroundColor
    expect(DEFAULT_SKY_TEXTURE_URL).toBe(
      '/assets/stages/3d_stage_001/textures_webp/sky_test_003.webp',
    );
  });

  it('gradient stops ascend 0→1, blue-dominant zenith, warm horizon', () => {
    expect(SKY_GRADIENT_STOPS.length).toBeGreaterThanOrEqual(3);
    expect(SKY_GRADIENT_STOPS[0].stop).toBe(0);
    expect(SKY_GRADIENT_STOPS[SKY_GRADIENT_STOPS.length - 1].stop).toBe(1);
    for (let i = 1; i < SKY_GRADIENT_STOPS.length; i++) {
      expect(SKY_GRADIENT_STOPS[i].stop).toBeGreaterThan(SKY_GRADIENT_STOPS[i - 1].stop);
    }
    const chan = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
    const [zr, , zb] = chan(SKY_GRADIENT_STOPS[0].color);
    expect(zb).toBeGreaterThan(zr); // zenith: soft blue
    expect(SKY_GRADIENT_STOPS[0].color).toBe(SKY_CLEAR_COLOR); // evidence-tied
    const horizon = SKY_GRADIENT_STOPS.find((s) => s.stop === 0.5);
    expect(horizon).toBeDefined();
    const [hr, , hb] = chan(horizon!.color);
    expect(hr).toBeGreaterThan(hb); // horizon: warm
    for (const s of SKY_GRADIENT_STOPS) {
      expect(s.color).toBeGreaterThanOrEqual(0);
      expect(s.color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('resolveSkyOptions', () => {
  it('defaults come from the serialized evidence', () => {
    const r = resolveSkyOptions();
    expect(r.skyTextureUrl).toBe(DEFAULT_SKY_TEXTURE_URL);
    expect(r.exposure).toBe(DEFAULT_EXPOSURE);
    expect(r.ambientIntensity).toBe(DEFAULT_AMBIENT_INTENSITY);
    expect(r.grade.saturation).toBe(1); // profile basic.saturation = 1.0
    expect(r.grade.tint.r).toBe(DEFAULT_GRADE_TINT_RGB[0]);
    expect(r.grade.tint.g).toBe(DEFAULT_GRADE_TINT_RGB[1]);
    expect(r.grade.tint.b).toBe(DEFAULT_GRADE_TINT_RGB[2]);
    expect(r.grade.tint.r).toBeGreaterThan(r.grade.tint.b); // warm push
  });

  it('honors overrides (url, exposure, ambient, tint, saturation)', () => {
    const opts: SkyOptions = {
      skyTextureUrl: '/other/sky.webp',
      exposure: 0.9,
      ambientIntensity: 0.7,
      grade: { tint: 0x808080, saturation: 0.8 },
    };
    const r = resolveSkyOptions(opts);
    expect(r.skyTextureUrl).toBe('/other/sky.webp');
    expect(r.exposure).toBe(0.9);
    expect(r.ambientIntensity).toBe(0.7);
    expect(r.grade.saturation).toBe(0.8);
    const expected = new THREE.Color(0x808080);
    expect(r.grade.tint.equals(expected)).toBe(true);
  });
});

describe('gradeSkyRgb', () => {
  const white = new THREE.Color(1, 1, 1);

  it('identity with white tint + saturation 1', () => {
    expect(gradeSkyRgb(0.2, 0.4, 0.6, white, 1)).toEqual([0.2, 0.4, 0.6]);
  });

  it('saturation 0 collapses to Rec.709 luma gray', () => {
    const [r, g, b] = gradeSkyRgb(0.2, 0.4, 0.6, white, 0);
    const luma = 0.2126 * 0.2 + 0.7152 * 0.4 + 0.0722 * 0.6;
    expect(r).toBeCloseTo(luma, 6);
    expect(g).toBeCloseTo(luma, 6);
    expect(b).toBeCloseTo(luma, 6);
  });

  it('tint multiplies channels and output clamps to [0,1]', () => {
    const tint = new THREE.Color(2, 1, 0.5);
    const [r, g, b] = gradeSkyRgb(0.8, 0.5, 0.8, tint, 1);
    expect(r).toBe(1); // 0.8*2 = 1.6 → clamped
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.4, 6);
    const [r2, g2, b2] = gradeSkyRgb(-0.1, 0.5, 0.5, white, 1);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(g2).toBeGreaterThanOrEqual(0);
    expect(b2).toBeGreaterThanOrEqual(0);
  });
});

describe('SkyAtmosphere headless (Node guard)', () => {
  it('constructor touches neither document nor scene/renderer state', () => {
    // Node has no document — any DOM access in the ctor would throw.
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const sentinel = new THREE.Color(0x123456);
    scene.background = sentinel;
    const sky = new SkyAtmosphere(renderer, scene);
    expect(sky).toBeInstanceOf(SkyAtmosphere);
    expect(scene.background).toBe(sentinel);
    expect(scene.environment).toBe(null);
    expect((renderer as unknown as { toneMapping: number }).toneMapping).toBe(THREE.NoToneMapping);
  });

  it('apply() resolves without GL: ACES + exposure + flat clear-color sky', async () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const sky = new SkyAtmosphere(renderer, scene, { exposure: 0.9 });
    await expect(sky.apply()).resolves.toBeUndefined();
    const r = renderer as unknown as { toneMapping: number; toneMappingExposure: number };
    expect(r.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(r.toneMappingExposure).toBe(0.9); // override honored
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(SKY_CLEAR_COLOR);
    expect(scene.environment).toBe(null); // no PMREM headless
    // Second apply() is a no-op (already applied).
    await sky.apply();
    expect(r.toneMappingExposure).toBe(0.9);
  });

  it('dispose() restores prior state, is idempotent, and blocks re-apply', async () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const sentinel = new THREE.Color(0x123456);
    scene.background = sentinel;
    scene.environmentIntensity = 0.25;
    const sky = new SkyAtmosphere(renderer, scene);
    await sky.apply();
    expect(scene.background).not.toBe(sentinel);
    sky.dispose();
    const r = renderer as unknown as { toneMapping: number; toneMappingExposure: number };
    expect(scene.background).toBe(sentinel); // restored
    expect(r.toneMapping).toBe(THREE.NoToneMapping); // restored
    expect(r.toneMappingExposure).toBe(1); // restored
    expect(scene.environmentIntensity).toBe(0.25); // untouched headless
    sky.dispose(); // idempotent — no throw, no double restore
    await sky.apply(); // disposed → no-op
    expect(scene.background).toBe(sentinel);
    expect(r.toneMapping).toBe(THREE.NoToneMapping);
  });

  it('dispose() before apply() is safe and leaves state untouched', () => {
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const sentinel = new THREE.Color(0xabcdef);
    scene.background = sentinel;
    const sky = new SkyAtmosphere(renderer, scene);
    sky.dispose();
    expect(scene.background).toBe(sentinel);
    const r = renderer as unknown as { toneMapping: number };
    expect(r.toneMapping).toBe(THREE.NoToneMapping);
  });
});

describe('postGraded (PPSv1 grade owns tone mapping)', () => {
  it('resolves to exposure 1 and a neutral sky tint', () => {
    const o = resolveSkyOptions({ postGraded: true });
    expect(o.postGraded).toBe(true);
    expect(o.exposure).toBe(1);
    expect([o.grade.tint.r, o.grade.tint.g, o.grade.tint.b]).toEqual([1, 1, 1]);
  });
  it('apply() headless disables renderer tone mapping when postGraded', async () => {
    const r = { toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 3 } as unknown as THREE.WebGLRenderer;
    const sky = new SkyAtmosphere(r, new THREE.Scene(), { postGraded: true });
    await sky.apply();
    expect(r.toneMapping).toBe(THREE.NoToneMapping);
    expect(r.toneMappingExposure).toBe(1);
  });
});
