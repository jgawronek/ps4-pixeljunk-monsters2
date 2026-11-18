// src/view/stage/StageAO.ts
// Unity Post-Processing Stack v1 "Ambient Occlusion" (Keijiro's Obscurance estimator) with ambientOnly = 1,
// intensity 1.3, radius 0.3, sampleCount 3 (Lowest), downsampling 1 (half-res), as serialized in every stage
// profile. In the original (deferred) the occlusion is blended onto the ambient/indirect G-buffer term only, so
// direct sun light is untouched. The port renders forward, so:
//   1. after the scene render, an AO buffer is estimated from the RT depth texture (half-res, 3 hemisphere samples
//      per pixel, interleaved-gradient noise, then a depth-aware separable blur),
//   2. the NEXT frame's lit materials multiply reflectedLight.indirectDiffuse / indirectSpecular by it (patch of
//      the lights_fragment_end ShaderChunk). Because the AO buffer lags one frame, the fragment reprojects its
//      own NDC position with prevViewProj * inverse(curViewProj) (exact for static geometry).
// three 0.169: chunk strings are patched globally (see StageReflectionProbe.ts for the pattern); the per-program
// uniforms are injected through a Material.prototype.onBeforeCompile accessor so every material (including ones that
// assign their own onBeforeCompile) gets the shared uniform objects.

import * as THREE from 'three';

export interface AoParams { intensity: number; radius: number; sampleCount: number; downsampling: boolean }

/** Kino/PPSv1 constants. */
export const AO_BETA = 0.002;
export const AO_EPSILON = 1e-4;
export const AO_CONTRAST = 0.6;

/** Linear eye depth from a [0,1] depth-buffer value for a perspective projection (P22 = elements[10], P23 = elements[14]). */
export function linearEyeDepth(z01: number, p22: number, p23: number): number {
  return p23 / (z01 * 2 - 1 + p22);
}

/** CPU reference of the obscurance estimator's per-sample term (a1 / a2). */
export function obscuranceTerm(vOS: [number, number, number], normal: [number, number, number], depthO: number): number {
  const a1 = Math.max(vOS[0] * normal[0] + vOS[1] * normal[1] + vOS[2] * normal[2] - AO_BETA * depthO, 0);
  const a2 = vOS[0] * vOS[0] + vOS[1] * vOS[1] + vOS[2] * vOS[2] + AO_EPSILON;
  return a1 / a2;
}

/** Final occlusion factor from the accumulated sum (Kino: pow(sum * radius * intensity / N, contrast)). Returns 1 - ao. */
export function obscuranceToFactor(sum: number, p: Pick<AoParams, 'intensity' | 'radius' | 'sampleCount'>): number {
  return Math.min(1, Math.max(0, 1 - (Math.max(0, sum * p.radius * p.intensity / p.sampleCount) ** AO_CONTRAST)));
}

// ---- material side ---------------------------------------------------------------------------------------------

export const AO_UNIFORMS = {
  tPjmAo: { value: null as THREE.Texture | null },
  uAoReproj: { value: new THREE.Matrix4() },
  uAoInvRes: { value: new THREE.Vector2(1, 1) },
  uAoOn: { value: 0 },
};

export const AO_PARS_GLSL = `
uniform sampler2D tPjmAo;
uniform mat4 uAoReproj;
uniform vec2 uAoInvRes;
uniform float uAoOn;
`;

export const AO_APPLY_GLSL = `
	if ( uAoOn > 0.5 ) {
		vec4 pjmN = vec4( gl_FragCoord.xy * uAoInvRes * 2.0 - 1.0, gl_FragCoord.z * 2.0 - 1.0, 1.0 );
		vec4 pjmP = uAoReproj * pjmN;
		vec2 pjmUv = pjmP.xy / pjmP.w * 0.5 + 0.5;
		if ( pjmP.w > 0.0 && pjmUv.x > 0.0 && pjmUv.x < 1.0 && pjmUv.y > 0.0 && pjmUv.y < 1.0 ) {
			float pjmAo = texture2D( tPjmAo, pjmUv ).r;
			reflectedLight.indirectDiffuse *= pjmAo;
			reflectedLight.indirectSpecular *= pjmAo;
		}
	}
`;

let chunksPatched = false;
let hookInstalled = false;

/** Patch the three ShaderChunks (idempotent). Throws when three's chunk layout changed. */
export function patchAoChunks(chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): void {
  if (chunksPatched && chunks === (THREE.ShaderChunk as unknown as Record<string, string>)) return;
  const pars = chunks.lights_pars_begin;
  const end = chunks.lights_fragment_end;
  if (typeof pars !== 'string' || typeof end !== 'string' || !end.includes('RE_IndirectDiffuse')) {
    throw new Error('StageAO: three lights_pars_begin / lights_fragment_end changed');
  }
  if (pars.includes('tPjmAo')) return;
  chunks.lights_pars_begin = AO_PARS_GLSL + pars;
  chunks.lights_fragment_end = end + AO_APPLY_GLSL;
  if (chunks === (THREE.ShaderChunk as unknown as Record<string, string>)) chunksPatched = true;
}

function injectUniforms(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, AO_UNIFORMS);
}

/** Every material program gets the shared AO uniforms (chains any onBeforeCompile assigned later). */
export function installAoMaterialHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  const proto = THREE.Material.prototype as unknown as Record<string, unknown>;
  const base = proto.onBeforeCompile as (s: unknown, r: unknown) => void;
  Object.defineProperty(proto, 'onBeforeCompile', {
    configurable: true,
    get(this: { __pjmObc?: (s: { uniforms: Record<string, THREE.IUniform> }, r: unknown) => void }) {
      return this.__pjmObc ?? ((s: { uniforms: Record<string, THREE.IUniform> }, r: unknown) => { base.call(this, s, r); injectUniforms(s); });
    },
    set(this: { __pjmObc?: unknown }, f: (s: { uniforms: Record<string, THREE.IUniform> }, r: unknown) => void) {
      const self = this;
      this.__pjmObc = (s: { uniforms: Record<string, THREE.IUniform> }, r: unknown) => { f.call(self, s, r); injectUniforms(s); };
    },
  });
}

// ---- AO buffer pass --------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const FRAG_AO = /* glsl */ `
uniform sampler2D tDepth;
uniform vec4 uProj;   // P00, P11, P22, P23
uniform vec2 uSize;   // AO target size
uniform float uRadius, uIntensity, uCount;
varying vec2 vUv;
float linD( vec2 uv ) { float z = texture2D( tDepth, uv ).r; return z >= 0.999999 ? 1e9 : uProj.w / ( z * 2.0 - 1.0 + uProj.z ); }
vec3 vpos( vec2 uv, float d ) { return vec3( ( uv * 2.0 - 1.0 ) * vec2( 1.0 / uProj.x, 1.0 / uProj.y ) * d, - d ); }
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float hash( float x ) { return fract( sin( x * 12.9898 ) * 43758.5453 ); }
void main() {
	float d0 = linD( vUv );
	if ( d0 > 5e8 ) { gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 ); return; }
	vec2 tx = 1.0 / uSize;
	vec3 p0 = vpos( vUv, d0 );
	vec2 uvl = vUv - vec2( tx.x, 0.0 ), uvr = vUv + vec2( tx.x, 0.0 ), uvd = vUv - vec2( 0.0, tx.y ), uvu = vUv + vec2( 0.0, tx.y );
	float dl = min( linD( uvl ), d0 * 4.0 ), dr = min( linD( uvr ), d0 * 4.0 ), dd = min( linD( uvd ), d0 * 4.0 ), du = min( linD( uvu ), d0 * 4.0 );
	vec3 dx = abs( dr - d0 ) < abs( d0 - dl ) ? vpos( uvr, dr ) - p0 : p0 - vpos( uvl, dl );
	vec3 dy = abs( du - d0 ) < abs( d0 - dd ) ? vpos( uvu, du ) - p0 : p0 - vpos( uvd, dd );
	vec3 n = normalize( cross( dx, dy ) );
	if ( dot( n, p0 ) > 0.0 ) n = - n;
	float gn = ign( gl_FragCoord.xy );
	float sum = 0.0;
	for ( int s = 0; s < 16; s++ ) {
		if ( float( s ) >= uCount ) break;
		float u = fract( hash( float( s ) ) + gn ) * 2.0 - 1.0;
		float th = ( hash( float( s ) + 7.0 ) + gn ) * 6.2831853;
		float u2 = sqrt( 1.0 - u * u );
		vec3 v = vec3( u2 * cos( th ), u2 * sin( th ), u );
		v = faceforward( v, - n, v ) * ( uRadius * sqrt( ( float( s ) + 1.0 ) / uCount ) );
		vec3 ps = p0 + v;
		vec4 c = vec4( ps.x * uProj.x, ps.y * uProj.y, 0.0, - ps.z );
		vec2 suv = c.xy / c.w * 0.5 + 0.5;
		float ds = linD( suv );
		if ( ds > 5e8 ) continue;
		vec3 v2 = vpos( suv, ds ) - p0;
		sum += max( dot( v2, n ) - ${'0.002'} * d0, 0.0 ) / ( dot( v2, v2 ) + 1e-4 );
	}
	float ao = pow( max( sum * uRadius * uIntensity / uCount, 0.0 ), ${'0.6'} );
	gl_FragColor = vec4( clamp( 1.0 - ao, 0.0, 1.0 ), min( d0, 60000.0 ), 0.0, 1.0 );
}`;

const FRAG_BLUR = /* glsl */ `
uniform sampler2D tAo; uniform vec2 uDir; // texel step
varying vec2 vUv;
void main() {
	vec2 c = texture2D( tAo, vUv ).rg;
	float acc = c.r, wsum = 1.0;
	for ( int i = 1; i <= 4; i++ ) {
		for ( int s = -1; s <= 1; s += 2 ) {
			vec2 t = texture2D( tAo, vUv + uDir * float( i * s ) ).rg;
			float w = exp( - abs( t.g - c.g ) / ( c.g * 0.03 + 0.05 ) ) * ( 1.0 - float( i ) * 0.18 );
			acc += t.r * w; wsum += w;
		}
	}
	gl_FragColor = vec4( acc / wsum, c.g, 0.0, 1.0 );
}`;

function mkTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, generateMipmaps: false,
  });
}

export class AoPass {
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly aoMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private a: THREE.WebGLRenderTarget | null = null;
  private b: THREE.WebGLRenderTarget | null = null;
  private readonly prevViewProj = new THREE.Matrix4();
  private havePrev = false;
  private readonly tmp = new THREE.Matrix4();

  constructor(private readonly params: AoParams) {
    patchAoChunks();
    installAoMaterialHook();
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG_AO, depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: null }, uProj: { value: new THREE.Vector4() }, uSize: { value: new THREE.Vector2() },
        uRadius: { value: params.radius }, uIntensity: { value: params.intensity }, uCount: { value: Math.min(16, Math.max(1, params.sampleCount)) },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG_BLUR, depthTest: false, depthWrite: false,
      uniforms: { tAo: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.aoMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Call BEFORE the scene render: reprojection matrix from this frame's camera to the AO buffer's camera. */
  beginFrame(camera: THREE.Camera, w: number, h: number): void {
    AO_UNIFORMS.uAoInvRes.value.set(1 / w, 1 / h);
    if (!this.havePrev) { AO_UNIFORMS.uAoOn.value = 0; return; }
    camera.updateMatrixWorld();
    this.tmp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    AO_UNIFORMS.uAoReproj.value.multiplyMatrices(this.prevViewProj, this.tmp);
    AO_UNIFORMS.uAoOn.value = 1;
  }

  /** Call AFTER the scene render with its depth texture. */
  endFrame(r: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera, w: number, h: number): void {
    const scale = this.params.downsampling ? 2 : 1;
    const aw = Math.max(1, Math.floor(w / scale)), ah = Math.max(1, Math.floor(h / scale));
    if (!this.a || this.a.width !== aw || this.a.height !== ah) {
      this.a?.dispose(); this.b?.dispose();
      this.a = mkTarget(aw, ah); this.b = mkTarget(aw, ah);
    }
    const e = camera.projectionMatrix.elements;
    const u = this.aoMat.uniforms;
    u.tDepth.value = depth;
    (u.uProj.value as THREE.Vector4).set(e[0], e[5], e[10], e[14]);
    (u.uSize.value as THREE.Vector2).set(aw, ah);
    const prevRt = r.getRenderTarget(), prevAuto = r.autoClear, prevXr = r.xr.enabled;
    r.autoClear = false; r.xr.enabled = false;
    this.quad.material = this.aoMat; r.setRenderTarget(this.a); r.render(this.scene, this.cam);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tAo.value = this.a.texture;
    (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(1 / aw, 0);
    r.setRenderTarget(this.b); r.render(this.scene, this.cam);
    this.blurMat.uniforms.tAo.value = this.b!.texture;
    (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1 / ah);
    r.setRenderTarget(this.a); r.render(this.scene, this.cam);
    r.setRenderTarget(prevRt); r.autoClear = prevAuto; r.xr.enabled = prevXr;
    AO_UNIFORMS.tPjmAo.value = this.a.texture;
    camera.updateMatrixWorld();
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.havePrev = true;
  }

  /** Last computed AO texture (R = ao factor), for probes. */
  get texture(): THREE.Texture | null { return this.a?.texture ?? null; }

  dispose(): void {
    AO_UNIFORMS.uAoOn.value = 0;
    AO_UNIFORMS.tPjmAo.value = null;
    this.a?.dispose(); this.b?.dispose();
    this.aoMat.dispose(); this.blurMat.dispose(); this.quad.geometry.dispose();
  }
}
