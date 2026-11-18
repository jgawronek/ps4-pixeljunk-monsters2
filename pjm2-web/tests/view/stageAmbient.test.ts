import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  STAGE1_AMBIENT_SH, STAGE1_AMBIENT_INTENSITY, unityProbeToThree, probeIrradianceOver, disableEnvDiffuse,
} from '../../src/view/stage/StageAmbient';

describe('StageAmbient (RenderSettings m_AmbientProbe)', () => {
  it('has the serialized 27 coefficients and intensity 0.5', () => {
    expect(STAGE1_AMBIENT_SH).toHaveLength(27);
    expect(STAGE1_AMBIENT_INTENSITY).toBe(0.5);
  });
  it('DC term equals the mean radiance (Unity pre-multiplies by Y00)', () => {
    const sh = unityProbeToThree(STAGE1_AMBIENT_SH);
    expect(sh.coefficients[0].x * 0.282095).toBeCloseTo(STAGE1_AMBIENT_SH[0], 5);
    expect(sh.coefficients[0].y * 0.282095).toBeCloseTo(STAGE1_AMBIENT_SH[9], 5);
    expect(sh.coefficients[0].z * 0.282095).toBeCloseTo(STAGE1_AMBIENT_SH[18], 5);
  });
  it('dominant lobe points at the skybox sun in three space (up, +x mirrored, +z NOT flipped)', () => {
    const sh = unityProbeToThree(STAGE1_AMBIENT_SH);
    const c = sh.coefficients;
    // three order y z x. Unity-world sun of the baked probe cube is (-0.64, 0.71, +0.29); the port mirrors x only.
    expect(c[1].x).toBeGreaterThan(0);
    expect(c[2].x).toBeGreaterThan(0);
    expect(c[3].x).toBeGreaterThan(0);
    // L2 xy / yz / xz keep the product-of-axes signs of that direction (x mirrored): xy<0 -> +? checked numerically
    const toSun = new THREE.Vector3(0.64, 0.71, 0.29).normalize();
    const e = new THREE.Vector3(); sh.getIrradianceAt(toSun, e);
    const away = new THREE.Vector3(); sh.getIrradianceAt(toSun.clone().negate(), away);
    expect(e.x).toBeGreaterThan(away.x * 1.5);
  });
  it('up irradiance/pi is warm (R > G > B) and ~1.4/1.1/0.85 before intensity', () => {
    const e = probeIrradianceOver(unityProbeToThree(STAGE1_AMBIENT_SH), new THREE.Vector3(0, 1, 0));
    expect(e.x).toBeGreaterThan(e.y);
    expect(e.y).toBeGreaterThan(e.z);
    expect(e.x).toBeGreaterThan(1.2); expect(e.x).toBeLessThan(1.6);
  });
  it('disables the PMREM diffuse term in three chunk', () => {
    disableEnvDiffuse();
    expect(THREE.ShaderChunk.envmap_physical_pars_fragment).not.toContain('PI * envMapColor.rgb');
    disableEnvDiffuse(); // idempotent
  });
});
