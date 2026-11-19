// src/view/stage/PostBloom.ts
// Unity Post-Processing Stack v1 "Bloom" (BloomComponent + Hidden/Post FX/Bloom), enabled in the gameplay camera
// profiles of stages 4-15 (see docs/RENDER_EXTRAS_ANALYSIS.md). Parameters come from the serialized profile
// (StageEnvironment.bloom); the algorithm is PPSv1's (recalled from the public package, not disassembled).
//
//   half-res pyramid: level0 = prefilter(scene) at w/2 x h/2 (soft-knee threshold, 4-tap box),
//   level i>0 = 13-tap box downsample of level i-1,
//   iterations = clamp(int(log2(h/2) + radius - 8), 1, 16), sampleScale = 0.5 + frac(logh)
//   combine (coarse -> fine): level[i] + tent9(level[i+1]) * sampleScale
//   uber:     color += tent9(level0, sampleScale) * intensity        (before vignette/grade)
// The gameplay camera is LDR (m_HDR = 0): the scene fed to the prefilter is clamped to 1.

import * as THREE from 'three';

export interface BloomParams { intensity: number; threshold: number; softKnee: number; radius: number; antiFlicker: boolean }

export const BLOOM_MAX_LEVELS = 16;

/** Unity Mathf.GammaToLinearSpace (PPSv1 uses the cheap pow(2.2) variant for thresholdLinear). */
export function gammaToLinear(v: number): number {
  return v <= 0 ? 0 : v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export interface BloomDerived {
  levels: number; sampleScale: number; thresholdLinear: number;
  curve: [number, number, number]; intensity: number;
}

/** BloomComponent.Prepare() parameter math for a camera of the given pixel height. */
export function bloomDerive(p: BloomParams, height: number): BloomDerived {
  const th = Math.max(1, Math.floor(height / 2));
  const logh = Math.log2(th) + p.radius - 8;
  const logI = Math.trunc(logh);
  const levels = Math.min(BLOOM_MAX_LEVELS, Math.max(1, logI));
  const lthresh = gammaToLinear(p.threshold);
  const knee = lthresh * p.softKnee + 1e-5;
  return {
    levels, sampleScale: 0.5 + logh - logI, thresholdLinear: lthresh,
    curve: [lthresh - knee, knee * 2, 0.25 / knee], intensity: Math.max(0, p.intensity),
  };
}

/** Prefilter weight: Prefilter() in Bloom.shader (soft knee quadratic), per-pixel multiplier of colour. */
export function bloomPrefilterWeight(br: number, d: Pick<BloomDerived, 'thresholdLinear' | 'curve'>): number {
  let rq = Math.min(Math.max(br - d.curve[0], 0), d.curve[1]);
  rq = d.curve[2] * rq * rq;
  return Math.max(rq, br - d.thresholdLinear) / Math.max(br, 1e-5);
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const FRAG_PRE = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec3 uCurve; uniform float uThreshold; uniform float uAnti;
varying vec2 vUv;
vec3 fetch( vec2 uv ) { return min( texture2D( tSrc, uv ).rgb, vec3( 1.0 ) ); } // LDR camera
void main() {
	vec3 c;
	if ( uAnti > 0.5 ) { // Karis-weighted 13-tap
		vec3 A = fetch( vUv + uTexel * vec2( -1., -1. ) ), B = fetch( vUv + uTexel * vec2( 0., -1. ) ), C = fetch( vUv + uTexel * vec2( 1., -1. ) );
		vec3 D = fetch( vUv + uTexel * vec2( -.5, -.5 ) ), E = fetch( vUv + uTexel * vec2( .5, -.5 ) );
		vec3 F = fetch( vUv + uTexel * vec2( -1., 0. ) ), G = fetch( vUv ), H = fetch( vUv + uTexel * vec2( 1., 0. ) );
		vec3 I = fetch( vUv + uTexel * vec2( -.5, .5 ) ), J = fetch( vUv + uTexel * vec2( .5, .5 ) );
		vec3 K = fetch( vUv + uTexel * vec2( -1., 1. ) ), L = fetch( vUv + uTexel * vec2( 0., 1. ) ), M = fetch( vUv + uTexel * vec2( 1., 1. ) );
		vec3 g0 = ( D + E + I + J ) * 0.25, g1 = ( A + B + G + F ) * 0.25, g2 = ( B + C + H + G ) * 0.25, g3 = ( F + G + L + K ) * 0.25, g4 = ( G + H + M + L ) * 0.25;
		float w0 = 0.5 / ( 1.0 + dot( g0, vec3( 0.2126, 0.7152, 0.0722 ) ) ), w1 = 0.125 / ( 1.0 + dot( g1, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		float w2 = 0.125 / ( 1.0 + dot( g2, vec3( 0.2126, 0.7152, 0.0722 ) ) ), w3 = 0.125 / ( 1.0 + dot( g3, vec3( 0.2126, 0.7152, 0.0722 ) ) ), w4 = 0.125 / ( 1.0 + dot( g4, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		c = ( g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
	} else { // DownsampleBox4Tap, amount 1
		vec4 d = uTexel.xyxy * vec4( -1., -1., 1., 1. );
		c = ( fetch( vUv + d.xy ) + fetch( vUv + d.zy ) + fetch( vUv + d.xw ) + fetch( vUv + d.zw ) ) * 0.25;
	}
	float br = max( c.r, max( c.g, c.b ) );
	float rq = clamp( br - uCurve.x, 0.0, uCurve.y );
	rq = uCurve.z * rq * rq;
	c *= max( rq, br - uThreshold ) / max( br, 1e-5 );
	gl_FragColor = vec4( c, 1.0 );
}`;

const FRAG_DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() { // DownsampleBox13Tap
	vec3 A = texture2D( tSrc, vUv + uTexel * vec2( -1., -1. ) ).rgb, B = texture2D( tSrc, vUv + uTexel * vec2( 0., -1. ) ).rgb, C = texture2D( tSrc, vUv + uTexel * vec2( 1., -1. ) ).rgb;
	vec3 D = texture2D( tSrc, vUv + uTexel * vec2( -.5, -.5 ) ).rgb, E = texture2D( tSrc, vUv + uTexel * vec2( .5, -.5 ) ).rgb;
	vec3 F = texture2D( tSrc, vUv + uTexel * vec2( -1., 0. ) ).rgb, G = texture2D( tSrc, vUv ).rgb, H = texture2D( tSrc, vUv + uTexel * vec2( 1., 0. ) ).rgb;
	vec3 I = texture2D( tSrc, vUv + uTexel * vec2( -.5, .5 ) ).rgb, J = texture2D( tSrc, vUv + uTexel * vec2( .5, .5 ) ).rgb;
	vec3 K = texture2D( tSrc, vUv + uTexel * vec2( -1., 1. ) ).rgb, L = texture2D( tSrc, vUv + uTexel * vec2( 0., 1. ) ).rgb, M = texture2D( tSrc, vUv + uTexel * vec2( 1., 1. ) ).rgb;
	vec3 o = ( D + E + I + J ) * 0.125 + ( A + B + G + F ) * 0.03125 + ( B + C + H + G ) * 0.03125 + ( F + G + L + K ) * 0.03125 + ( G + H + M + L ) * 0.03125;
	gl_FragColor = vec4( o, 1.0 );
}`;

const TENT = /* glsl */ `
vec3 upsampleTent( sampler2D tex, vec2 uv, vec2 texel, float scale ) {
	vec4 d = texel.xyxy * vec4( 1., 1., -1., 0. ) * scale;
	vec3 s = texture2D( tex, uv - d.xy ).rgb;
	s += texture2D( tex, uv - d.wy ).rgb * 2.0;
	s += texture2D( tex, uv - d.zy ).rgb;
	s += texture2D( tex, uv + d.zw ).rgb * 2.0;
	s += texture2D( tex, uv ).rgb * 4.0;
	s += texture2D( tex, uv + d.xw ).rgb * 2.0;
	s += texture2D( tex, uv + d.zy ).rgb;
	s += texture2D( tex, uv + d.wy ).rgb * 2.0;
	s += texture2D( tex, uv + d.xy ).rgb;
	return s * ( 1.0 / 16.0 );
}`;

const FRAG_COMBINE = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uScale; varying vec2 vUv;
${TENT}
void main() { gl_FragColor = vec4( texture2D( tBase, vUv ).rgb + upsampleTent( tSrc, vUv, uTexel, uScale ), 1.0 ); }`;

/** Final combine, GLSL for the copy/uber pass: `bloomColor(vUv)` ready to add to the scene colour. */
export const BLOOM_APPLY_GLSL = /* glsl */ `
uniform sampler2D tBloom; uniform vec3 uBloom; // x: sampleScale, y: intensity, z: 1/texel (unused)
uniform vec2 uBloomTexel;
${TENT}
vec3 bloomColor( vec2 uv ) { return upsampleTent( tBloom, uv, uBloomTexel, uBloom.x ) * uBloom.y; }`;

function target(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
}

export class BloomChain {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly pre: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly comb: THREE.ShaderMaterial;
  private down_: THREE.WebGLRenderTarget[] = [];
  private up_: THREE.WebGLRenderTarget[] = [];
  private key = '';
  /** Uniforms for BLOOM_APPLY_GLSL (shared with the final pass). */
  readonly applyUniforms = {
    tBloom: { value: null as THREE.Texture | null },
    uBloom: { value: new THREE.Vector3(0.5, 0, 0) },
    uBloomTexel: { value: new THREE.Vector2(1, 1) },
  };

  constructor(private params: BloomParams) {
    const mk = (frag: string, u: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, uniforms: u, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.pre = mk(FRAG_PRE, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uCurve: { value: new THREE.Vector3() },
      uThreshold: { value: 1 }, uAnti: { value: params.antiFlicker ? 1 : 0 },
    });
    this.down = mk(FRAG_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.comb = mk(FRAG_COMBINE, {
      tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 0.5 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pre);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget): void {
    this.quad.material = m;
    r.setRenderTarget(to);
    r.render(this.scene, this.cam);
  }

  private ensure(w: number, h: number, levels: number): void {
    const key = `${w}x${h}x${levels}`;
    if (key === this.key) return;
    this.free();
    this.key = key;
    let lw = Math.max(1, w >> 1), lh = Math.max(1, h >> 1);
    this.down_.push(target(lw, lh)); // level 0 (prefilter output)
    for (let i = 1; i < levels; i++) { lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1); this.down_.push(target(lw, lh)); }
    for (let i = 0; i < levels - 1; i++) this.up_.push(target(this.down_[i].width, this.down_[i].height));
  }

  /** Build the pyramid from `src` (HDR scene colour, w x h) and expose the result via applyUniforms. Restores the render target. */
  run(r: THREE.WebGLRenderer, src: THREE.Texture, w: number, h: number): void {
    const d = bloomDerive(this.params, h);
    this.ensure(w, h, d.levels);
    const prevRt = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    const pu = this.pre.uniforms;
    pu.tSrc.value = src;
    (pu.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    (pu.uCurve.value as THREE.Vector3).set(...d.curve);
    pu.uThreshold.value = d.thresholdLinear;
    this.pass(r, this.pre, this.down_[0]);
    for (let i = 1; i < d.levels; i++) {
      const s = this.down_[i - 1];
      this.down.uniforms.tSrc.value = s.texture;
      (this.down.uniforms.uTexel.value as THREE.Vector2).set(1 / s.width, 1 / s.height);
      this.pass(r, this.down, this.down_[i]);
    }
    let last = this.down_[d.levels - 1];
    for (let i = d.levels - 2; i >= 0; i--) {
      const cu = this.comb.uniforms;
      cu.tSrc.value = last.texture;
      cu.tBase.value = this.down_[i].texture;
      (cu.uTexel.value as THREE.Vector2).set(1 / last.width, 1 / last.height);
      cu.uScale.value = d.sampleScale;
      this.pass(r, this.comb, this.up_[i]);
      last = this.up_[i];
    }
    r.setRenderTarget(prevRt);
    r.autoClear = prevAuto;
    this.applyUniforms.tBloom.value = last.texture;
    this.applyUniforms.uBloom.value.set(d.sampleScale, d.intensity, 0);
    this.applyUniforms.uBloomTexel.value.set(1 / last.width, 1 / last.height);
  }

  setParams(p: BloomParams): void { this.params = p; (this.pre.uniforms.uAnti as THREE.IUniform).value = p.antiFlicker ? 1 : 0; }

  private free(): void {
    for (const t of [...this.down_, ...this.up_]) t.dispose();
    this.down_ = []; this.up_ = []; this.key = '';
  }

  dispose(): void {
    this.free();
    this.pre.dispose(); this.down.dispose(); this.comb.dispose();
    this.quad.geometry.dispose();
  }
}
