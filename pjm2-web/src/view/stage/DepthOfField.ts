// src/view/stage/DepthOfField.ts
// Unity Post-Processing Stack v1 "Hidden/Post FX/Depth Of Field" (Kino-style bokeh), as shipped in resources.assets
// (passes: COC CALCULATION, COC TEMPORAL FILTER, DOWNSAMPLE AND PREFILTER, BOKEH FILTER small/medium/large/very large,
// POSTFILTER, + combine). Docs: docs/DEPTH_OF_FIELD_ANALYSIS.md. Profile values are decoded from the *_pp assets.
//
//   focal length f   = useCameraFov ? 0.5 * 0.024 / tan(fov/2) : focalLength(mm) / 1000       (DepthOfFieldComponent)
//   s1               = max(focusDistance, f)
//   lensCoeff        = f^2 / (aperture * (s1 - f) * 0.024 * 2)
//   maxCoC           = min(0.05, (kernelSize * 4 + 6) / screenHeight)                          (fraction of screen height)
//   CoC(d)           = (d - s1) * lensCoeff / max(d, 1e-5)                                     (signed: + far, - near)
// Pipeline: prefilter (half res, Karis-weighted 2x2, largest CoC, CoC-premultiplied) -> disc bokeh (16/22/43/71 taps)
// -> 3x3 tent postfilter -> combine (far-field alpha smoothstep(2px, 4px) | near-field alpha from the blur).
// Runs on the HDR scene BEFORE bloom / the grade, like PPSv1's component order.

import * as THREE from 'three';

export interface DofSettings {
  /** metres */ focusDistance: number;
  aperture: number;
  /** millimetres */ focalLength: number;
  useCameraFov: boolean;
  /** 0 small, 1 medium, 2 large, 3 very large */ kernelSize: number;
}

/** Decoded PostProcessingProfile.depthOfField.m_Settings (enabled = m_Enabled of the model). */
export const DOF_PROFILES = {
  /** 3d_stage_NNN_behind_pp (stages 1,4,7,10,13 identical; others reuse stage 1's): GameCameraIntro01/Result/GameOver/Behind */
  stageBehind: { focusDistance: 2, aperture: 3.5, focalLength: 35, useCameraFov: false, kernelSize: 1 },
  /** 3d_stage_title_1_pp (GameCameraTitle of the hub) and 3d_stage_credit_moon_pp (identical) */
  title: { focusDistance: 3, aperture: 4, focalLength: 47, useCameraFov: false, kernelSize: 1 },
  /** 3d_stage_000_behind_pp (hub GameCameraBehind / GameCameraRainbowNN) */
  hubBehind: { focusDistance: 5, aperture: 3.5, focalLength: 35, useCameraFov: false, kernelSize: 1 },
  /** 3d_stage_000_lobby_pp (globalsettings) */
  lobby: { focusDistance: 0.1, aperture: 32, focalLength: 18, useCameraFov: false, kernelSize: 3 },
} as const satisfies Record<string, DofSettings>;

export const DOF_FILM_HEIGHT = 0.024;
export const DOF_KERNEL_SAMPLES = [16, 22, 43, 71] as const;

export function dofFocalLength(s: DofSettings, fovDeg: number): number {
  if (!s.useCameraFov) return s.focalLength / 1000;
  return (0.5 * DOF_FILM_HEIGHT) / Math.tan(0.5 * (fovDeg * Math.PI) / 180);
}

export function dofMaxCoCRadius(kernelSize: number, screenHeight: number): number {
  return Math.min(0.05, (kernelSize * 4 + 6) / screenHeight);
}

export interface DofParams { distance: number; lensCoeff: number; maxCoC: number }

export function dofParams(s: DofSettings, fovDeg: number, screenHeight: number): DofParams {
  const f = dofFocalLength(s, fovDeg);
  const s1 = Math.max(s.focusDistance, f);
  return { distance: s1, lensCoeff: (f * f) / (s.aperture * (s1 - f) * DOF_FILM_HEIGHT * 2), maxCoC: dofMaxCoCRadius(s.kernelSize, screenHeight) };
}

/** Signed circle of confusion (fraction of screen height) at linear eye depth d, clamped to +-maxCoC like the shader's saturate(). */
export function dofCoC(d: number, p: DofParams): number {
  const coc = ((d - p.distance) * p.lensCoeff) / Math.max(d, 1e-5);
  return Math.max(-p.maxCoC, Math.min(p.maxCoC, coc));
}

/** Blur radius in pixels for a CoC (the disc radius is the CoC itself, in screen-height units). */
export function dofBlurRadiusPx(coc: number, screenHeight: number): number {
  return Math.abs(coc) * screenHeight;
}

/** Is the effect on? `?dof=0` disables it. */
export function dofUrlEnabled(search: string): boolean {
  const v = new URLSearchParams(search).get('dof');
  return !(v === '0' || v === 'off' || v === 'false');
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear, uFar, uDist, uCoeff, uMaxCoC, uRcpAspect;
uniform vec2 uTexel;      // texel size of the pass INPUT
uniform vec2 uFullTexel;  // texel size of the full-res scene
float eyeDepth(vec2 uv) {
  float ndc = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
}
// signed CoC, saturate()d to +-maxCoC like the shader's 0..1 storage
float cocAt(vec2 uv) {
  float d = eyeDepth(uv);
  float c = (d - uDist) * uCoeff / max(d, 1e-5);
  return (clamp(c * 0.5 / uMaxCoC + 0.5, 0.0, 1.0) - 0.5) * 2.0 * uMaxCoC;
}
float max3(vec3 v) { return max(v.x, max(v.y, v.z)); }
`;

const PREFILTER = COMMON + /* glsl */ `
void main() {
  vec2 o = uFullTexel * 0.5;
  vec2 uv0 = vUv + vec2(-o.x, -o.y), uv1 = vUv + vec2(o.x, -o.y), uv2 = vUv + vec2(-o.x, o.y), uv3 = vUv + vec2(o.x, o.y);
  vec3 c0 = texture2D(tColor, uv0).rgb, c1 = texture2D(tColor, uv1).rgb, c2 = texture2D(tColor, uv2).rgb, c3 = texture2D(tColor, uv3).rgb;
  vec4 cocs = vec4(cocAt(uv0), cocAt(uv1), cocAt(uv2), cocAt(uv3));
  vec4 w = 1.0 / (vec4(max3(c0), max3(c1), max3(c2), max3(c3)) + 1.0);
  vec3 avg = (c0 * w.x + c1 * w.y + c2 * w.z + c3 * w.w) / dot(w, vec4(1.0));
  float cocMin = min(min(cocs.x, cocs.y), min(cocs.z, cocs.w));
  float cocMax = max(max(cocs.x, cocs.y), max(cocs.z, cocs.w));
  float coc = (-cocMin > cocMax) ? cocMin : cocMax;
  avg *= smoothstep(0.0, uFullTexel.y * 2.0, abs(coc));
  gl_FragColor = vec4(avg, coc);
}
`;

const BOKEH = COMMON + /* glsl */ `
uniform float uSamples;
void main() {
  vec4 samp0 = texture2D(tColor, vUv);
  vec4 bgAcc = vec4(0.0), fgAcc = vec4(0.0);
  float margin = uTexel.y * 2.0;
  for (int k = 0; k < SAMPLES; k++) {
    float fk = float(k);
    float r = sqrt((fk + 0.5) / uSamples);
    float th = fk * 2.39996323;
    vec2 disp = vec2(cos(th), sin(th)) * r * uMaxCoC;
    float dist = length(disp);
    vec2 duv = vec2(disp.x * uRcpAspect, disp.y);
    vec4 samp = texture2D(tColor, vUv + duv);
    float bgCoC = max(min(samp0.a, samp.a), 0.0);
    float bgWeight = clamp((bgCoC - dist + 0.005) / 0.01, 0.0, 1.0);
    float fgWeight = clamp((-samp.a - dist + 0.005) / 0.01, 0.0, 1.0);
    fgWeight *= step(margin, -samp.a);
    bgAcc += vec4(samp.rgb, 1.0) * bgWeight;
    fgAcc += vec4(samp.rgb, 1.0) * fgWeight;
  }
  bgAcc.rgb /= bgAcc.a + (bgAcc.a == 0.0 ? 1.0 : 0.0);
  fgAcc.rgb /= fgAcc.a + (fgAcc.a == 0.0 ? 1.0 : 0.0);
  fgAcc.a *= 3.14159265 / uSamples;
  float alpha = clamp(fgAcc.a, 0.0, 1.0);
  gl_FragColor = vec4(mix(bgAcc.rgb, fgAcc.rgb, alpha), alpha);
}
`;

const POSTFILTER = COMMON + /* glsl */ `
void main() {
  vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
  vec4 acc = texture2D(tColor, vUv - d.xy) + texture2D(tColor, vUv - d.wy) * 2.0 + texture2D(tColor, vUv - d.zy)
    + texture2D(tColor, vUv + d.zw) * 2.0 + texture2D(tColor, vUv) * 4.0 + texture2D(tColor, vUv + d.xw) * 2.0
    + texture2D(tColor, vUv + d.zy) + texture2D(tColor, vUv + d.wy) * 2.0 + texture2D(tColor, vUv + d.xy);
  gl_FragColor = acc / 16.0;
}
`;

const COMBINE = COMMON + /* glsl */ `
uniform sampler2D tBlur;
void main() {
  vec4 src = texture2D(tColor, vUv);
  vec4 dst = texture2D(tBlur, vUv);
  float coc = cocAt(vUv);
  float ffa = smoothstep(uFullTexel.y * 2.0, uFullTexel.y * 4.0, coc);
  gl_FragColor = vec4(mix(src.rgb, dst.rgb, ffa + dst.a - ffa * dst.a), src.a);
}
`;

export class DepthOfFieldPass {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly bokeh: THREE.ShaderMaterial[];
  private readonly post: THREE.ShaderMaterial;
  private readonly combine: THREE.ShaderMaterial;
  private rtA: THREE.WebGLRenderTarget | null = null;
  private rtB: THREE.WebGLRenderTarget | null = null;
  private rtC: THREE.WebGLRenderTarget | null = null;
  private rtOut: THREE.WebGLRenderTarget | null = null;

  constructor() {
    const mk = (frag: string, defines: Record<string, string | number> = {}): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, defines, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null },
        uNear: { value: 0.3 }, uFar: { value: 1000 }, uDist: { value: 1 }, uCoeff: { value: 0 }, uMaxCoC: { value: 0.01 },
        uRcpAspect: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uFullTexel: { value: new THREE.Vector2() }, uSamples: { value: 16 },
      },
    });
    this.prefilter = mk(PREFILTER);
    this.bokeh = DOF_KERNEL_SAMPLES.map((n) => { const m = mk(BOKEH, { SAMPLES: n }); m.uniforms.uSamples.value = n; return m; });
    this.post = mk(POSTFILTER);
    this.combine = mk(COMBINE);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.prefilter);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private target(w: number, h: number): THREE.WebGLRenderTarget {
    const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
    return t;
  }

  private ensure(w: number, h: number): void {
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (this.rtOut && this.rtOut.width === w && this.rtOut.height === h) return;
    this.rtA?.dispose(); this.rtB?.dispose(); this.rtC?.dispose(); this.rtOut?.dispose();
    this.rtA = this.target(hw, hh); this.rtB = this.target(hw, hh); this.rtC = this.target(hw, hh); this.rtOut = this.target(w, h);
  }

  private draw(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget): void {
    this.quad.material = m;
    r.setRenderTarget(to);
    r.render(this.scene, this.cam);
  }

  /** Blur `color` by the CoC derived from `depth`; returns the full-res result texture. */
  run(r: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, camera: THREE.PerspectiveCamera, s: DofSettings, w: number, h: number): THREE.Texture {
    this.ensure(w, h);
    const p = dofParams(s, camera.fov, h);
    const all = [this.prefilter, ...this.bokeh, this.post, this.combine];
    for (const m of all) {
      const u = m.uniforms;
      u.tDepth.value = depth;
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uDist.value = p.distance; u.uCoeff.value = p.lensCoeff; u.uMaxCoC.value = p.maxCoC;
      u.uRcpAspect.value = h / w;
      u.uFullTexel.value.set(1 / w, 1 / h);
    }
    const hw = this.rtA!.width, hh = this.rtA!.height;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.prefilter.uniforms.tColor.value = color;
    this.draw(r, this.prefilter, this.rtA!);
    const bk = this.bokeh[Math.max(0, Math.min(3, s.kernelSize))];
    bk.uniforms.tColor.value = this.rtA!.texture; bk.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.draw(r, bk, this.rtB!);
    this.post.uniforms.tColor.value = this.rtB!.texture; this.post.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.draw(r, this.post, this.rtC!);
    this.combine.uniforms.tColor.value = color; this.combine.uniforms.tBlur.value = this.rtC!.texture;
    this.draw(r, this.combine, this.rtOut!);
    r.setRenderTarget(null);
    r.autoClear = prevAuto;
    return this.rtOut!.texture;
  }

  dispose(): void {
    this.rtA?.dispose(); this.rtB?.dispose(); this.rtC?.dispose(); this.rtOut?.dispose();
    this.rtA = this.rtB = this.rtC = this.rtOut = null;
    for (const m of [this.prefilter, ...this.bokeh, this.post, this.combine]) m.dispose();
    this.quad.geometry.dispose();
  }
}
