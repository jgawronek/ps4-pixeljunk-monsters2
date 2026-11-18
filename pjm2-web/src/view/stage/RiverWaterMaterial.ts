// src/view/stage/RiverWaterMaterial.ts
// Unity "Nature/Water" (terrain_001_river_m) — faithful port of the ORIGINAL
// compiled shader. The PS4 GCN program (nature bundle, Shader "Nature/Water",
// LZ4 blob → OrbShdr ISA) was disassembled and symbolically evaluated; the
// GLSL below is that dataflow, not a look-alike. Findings (see
// docs/WATER_SHADER_ANALYSIS.md):
//
// Render state: Queue Transparent, Blend One Zero (OPAQUE write — the shader
// composites against the grabbed scene itself), ZWrite Off, ZTest LEqual,
// Cull Off. Vertex stage: plain MVP, world position, uv*_NormalMap_ST,
// raw uv for the flow map. NO vertex waves.
//
// Fragment (all constants from the ISA):
//  - flow = _FlowMap.rg at raw uv (NOT remapped *2-1), two phases
//    p0 = fract(t/3.5), p1 = fract(t/3.5 + 0.5), offsets _FlowSpeed*p (added).
//  - _NormalMap is DXT5nm: normal.xy = (alpha, green)*2-1, z = sqrt(1-|xy|²)
//    (the old port read it as an RGB height field — the root of "very wrong").
//  - phases crossfaded with w = 1 - 2|p1 - 0.5| (weight on phase 1).
//  - The normal is used AS A UNITY-WORLD VECTOR (no tangent frame): the
//    water mesh is a flat XZ plane, the map's "up" component is world +Z.
//  - view V = normalize(worldPos - cameraPos); d = dot(N, V).
//  - refracted lookup: P' = P + d·N + k(V - d·N) - V, k = 1/(1 + 0.333·sat(
//    3.333(1 - screenY))); projected with ViewProj → uvR.
//  - depth (_CameraDepthTexture) reconstructed to WORLD HEIGHT through
//    unity_CameraProjection + _InverseView at uvR and at uvD (uvD = screen
//    uv when the refracted lookup hits something nearer than the water).
//  - BG = lerp(grab(uv), grab(uvR), smoothstep(sat(50(waterY - sceneY_R))))
//  - depth = sat(waterY + _ScatteringHeight - sceneY_D)
//  - fresnel = F0 + (1-F0)·sat(1+d)^5
//  - col = _Color1·depth³ + _RefractScale·BG + fresnel·_SpecStrength·SkyCube(R)
//    with R = V - 2dN; out = lerp(grab(uv), col, smoothstep(sat(6.667·depth))).
//  (_Color is NOT used by the original shader.)
//
// Inputs the shader needs from the renderer: a grab of the opaque scene
// (tBG, linear HDR) and its depth texture (tDepth) — supplied by WaterPass.
// Without them (uHasScene = 0) it falls back to a flat _Color1 tint.
//
// Coordinate note: the port mirrors Unity's x axis (LH → RH). Quantities that
// are used as Unity-world VECTORS (normal, reflect dir, displacement) are
// converted with F = diag(-1,1,1); positions/matrices stay in three-world.
//
// LIMITS: sky cube is BC6H HDR clamped to 8-bit by the decoder (NEAR).

import * as THREE from 'three';

export interface RiverTextures {
  flow: THREE.Texture | null;
  normal: THREE.Texture | null;
  sky: THREE.CubeTexture | null;
}

export interface RiverWaterOptions {
  /** _FlowSpeed (0.3 in stage 1). */
  flowSpeed: number;
  /** _Color1, authored sRGB → converted to linear. */
  color1: THREE.Color;
  /** _F0 (0.05). */
  f0?: number;
  /** _ScatteringHeight (0.03). */
  scatteringHeight?: number;
  /** _SpecStrength (0.15). */
  specStrength?: number;
  /** _RefractScale (0.05). */
  refractScale?: number;
  /** _NormalMap tiling (10,10) + offset (0,0). */
  normalScale?: [number, number];
  normalOffset?: [number, number];
}

/** Uniform names kept exported for tests/probes. */
export const RIVER_UNIFORMS = {
  time: 'uTime', flowSpeed: 'uFlowSpeed', color1: 'uColor1', f0: 'uF0',
  scatteringHeight: 'uScatterH', specStrength: 'uSpecStrength', refractScale: 'uRefractScale',
  normalScale: 'uNormalScale', normalOffset: 'uNormalOffset',
  flow: 'tFlow', normal: 'tNormal', sky: 'tSky', bg: 'tBG', depth: 'tDepth',
  hasFlow: 'uHasFlow', hasNormal: 'uHasNormal', hasSky: 'uHasSky', hasScene: 'uHasScene',
  res: 'uRes', nearFar: 'uNearFar', proj: 'uProj', ortho: 'uOrtho', camWorld: 'uCamWorld', viewProj: 'uViewProj',
} as const;

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
	vUv = uv;
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vWorld = wp.xyz;
	gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAGMENT = /* glsl */ `
#include <common>
uniform float uTime, uFlowSpeed, uF0, uScatterH, uSpecStrength, uRefractScale, uOrtho;
uniform float uHasFlow, uHasNormal, uHasSky, uHasScene;
uniform vec3 uColor1;
uniform vec2 uNormalScale, uNormalOffset, uRes, uNearFar;
uniform vec4 uProj; // P00, P11, P02, P12 of the camera projection
uniform mat4 uCamWorld; // view → world (unity_MatrixInvV)
uniform mat4 uViewProj; // unity_MatrixVP (three declares no projectionMatrix in the fragment stage)
uniform sampler2D tFlow, tNormal, tBG, tDepth;
uniform samplerCube tSky;
varying vec2 vUv;
varying vec3 vWorld;

float eyeDepth( float d ) {
	float n = uNearFar.x, f = uNearFar.y;
	float persp = n * f / ( f + d * ( n - f ) );
	float orth = n + d * ( f - n );
	return mix( persp, orth, uOrtho );
}
// World-space HEIGHT of the scene point under screen uv with depth d.
float worldY( vec2 uv, float d ) {
	float z = eyeDepth( d );
	float s = mix( z, 1.0, uOrtho );
	float vx = s * ( ( 2.0 * uv.x - 1.0 ) / uProj.x - uProj.z / uProj.x );
	float vy = s * ( ( 2.0 * uv.y - 1.0 ) / uProj.y - uProj.w / uProj.y );
	return ( uCamWorld * vec4( vx, vy, -z, 1.0 ) ).y;
}
vec3 flipX( vec3 v ) { return vec3( -v.x, v.y, v.z ); }
float smooth01( float x ) { return x * x * ( 3.0 - 2.0 * x ); }

void main() {
	vec3 col;
	vec2 uvS = gl_FragCoord.xy / uRes;
	if ( uHasScene < 0.5 ) {
		col = uColor1 * 0.35;
	} else {
		// ---- flow-blended DXT5nm normal (unity-world vector) ----
		float p0 = fract( uTime * 0.285714 );
		float p1 = fract( uTime * 0.285714 + 0.5 );
		vec2 flow = uHasFlow > 0.5 ? texture2D( tFlow, vUv ).rg : vec2( 0.0 );
		vec2 uv1 = vUv * uNormalScale + uNormalOffset;
		vec3 n = vec3( 0.0, 0.0, 1.0 );
		if ( uHasNormal > 0.5 ) {
			vec4 a = texture2D( tNormal, uv1 + flow * ( uFlowSpeed * p0 ) );
			vec4 b = texture2D( tNormal, uv1 + flow * ( uFlowSpeed * p1 ) );
			vec2 xa = vec2( a.a, a.g ) * 2.0 - 1.0;
			vec2 xb = vec2( b.a, b.g ) * 2.0 - 1.0;
			vec3 na = vec3( xa, sqrt( 1.0 - min( 1.0, dot( xa, xa ) ) ) );
			vec3 nb = vec3( xb, sqrt( 1.0 - min( 1.0, dot( xb, xb ) ) ) );
			float w = 1.0 - 2.0 * abs( p1 - 0.5 );
			n = normalize( mix( na, nb, w ) );
		}
		vec3 V = normalize( flipX( vWorld - cameraPosition ) );
		float d = dot( n, V );
		// ---- refracted lookup ----
		float k = 1.0 / ( 1.0 + 0.333 * clamp( 3.33333 * ( 1.0 - uvS.y ), 0.0, 1.0 ) );
		vec3 dn = d * n;
		vec3 disp = dn + k * ( V - dn ) - V;
		vec4 clip = uViewProj * vec4( vWorld + flipX( disp ), 1.0 );
		vec2 uvR = 0.5 * clip.xy / clip.w + 0.5;
		float dR = texture2D( tDepth, uvR ).r;
		bool nearer = dR < gl_FragCoord.z - 0.0001; // refracted hit is in front of the water
		vec2 uvD = nearer ? uvS : uvR;
		float dD = nearer ? texture2D( tDepth, uvS ).r : dR;
		float yR = worldY( uvR, dR );
		float yD = worldY( uvD, dD );
		float sA = smooth01( clamp( 50.0 * ( vWorld.y - yR ), 0.0, 1.0 ) );
		vec3 bgS = texture2D( tBG, uvS ).rgb;
		vec3 bg = mix( bgS, texture2D( tBG, uvR ).rgb, sA );
		float depth = clamp( vWorld.y + uScatterH - yD, 0.0, 1.0 );
		float m = smooth01( clamp( 6.66667 * depth, 0.0, 1.0 ) );
		float f1 = clamp( 1.0 + d, 0.0, 1.0 );
		float fres = pow( f1, 5.0 ) * ( 1.0 - uF0 ) + uF0;
		vec3 R = V - 2.0 * d * n;
		vec3 sky = uHasSky > 0.5 ? textureCube( tSky, R ).rgb : vec3( 0.0 );
		vec3 water = uColor1 * ( depth * depth * depth ) + uRefractScale * bg + fres * uSpecStrength * sky;
		col = mix( bgS, water, m );
	}
	gl_FragColor = vec4( col, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

interface RiverState { time: number }

/** Build the faithful Nature/Water material (render state per the original:
 *  opaque write, no depth write, double sided). */
export function createRiverWaterMaterial(opts: RiverWaterOptions): THREE.ShaderMaterial {
  const state: RiverState = { time: 0 };
  const u = (value: unknown) => ({ value });
  const m = new THREE.ShaderMaterial({
    name: 'Nature/Water',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      [RIVER_UNIFORMS.time]: u(0),
      [RIVER_UNIFORMS.flowSpeed]: u(opts.flowSpeed),
      [RIVER_UNIFORMS.color1]: u(opts.color1.clone()),
      [RIVER_UNIFORMS.f0]: u(opts.f0 ?? 0.05),
      [RIVER_UNIFORMS.scatteringHeight]: u(opts.scatteringHeight ?? 0.03),
      [RIVER_UNIFORMS.specStrength]: u(opts.specStrength ?? 0.15),
      [RIVER_UNIFORMS.refractScale]: u(opts.refractScale ?? 0.05),
      [RIVER_UNIFORMS.normalScale]: u(new THREE.Vector2(...(opts.normalScale ?? [10, 10]))),
      [RIVER_UNIFORMS.normalOffset]: u(new THREE.Vector2(...(opts.normalOffset ?? [0, 0]))),
      [RIVER_UNIFORMS.flow]: u(null),
      [RIVER_UNIFORMS.normal]: u(null),
      [RIVER_UNIFORMS.sky]: u(null),
      [RIVER_UNIFORMS.bg]: u(null),
      [RIVER_UNIFORMS.depth]: u(null),
      [RIVER_UNIFORMS.hasFlow]: u(0),
      [RIVER_UNIFORMS.hasNormal]: u(0),
      [RIVER_UNIFORMS.hasSky]: u(0),
      [RIVER_UNIFORMS.hasScene]: u(0),
      [RIVER_UNIFORMS.res]: u(new THREE.Vector2(1, 1)),
      [RIVER_UNIFORMS.nearFar]: u(new THREE.Vector2(0.3, 1000)),
      [RIVER_UNIFORMS.proj]: u(new THREE.Vector4(1, 1, 0, 0)),
      [RIVER_UNIFORMS.ortho]: u(0),
      [RIVER_UNIFORMS.camWorld]: u(new THREE.Matrix4()),
      [RIVER_UNIFORMS.viewProj]: u(new THREE.Matrix4()),
    },
    // Blend One Zero, ZWrite Off, ZTest LEqual, Cull Off (serialized state).
    blending: THREE.NoBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    transparent: false,
  });
  m.userData.river = state;
  return m;
}

function riverState(m: THREE.ShaderMaterial): RiverState {
  const s = m.userData.river as RiverState | undefined;
  if (!s) throw new Error('not a river water material (createRiverWaterMaterial first)');
  return s;
}

/** Push decoded water textures into the material (any time; uniforms only —
 *  no recompile). */
export function setRiverTextures(m: THREE.ShaderMaterial, textures: Partial<RiverTextures>): void {
  riverState(m);
  const u = m.uniforms;
  if (textures.flow !== undefined) {
    u[RIVER_UNIFORMS.flow].value = textures.flow;
    u[RIVER_UNIFORMS.hasFlow].value = textures.flow ? 1 : 0;
  }
  if (textures.normal !== undefined) {
    u[RIVER_UNIFORMS.normal].value = textures.normal;
    u[RIVER_UNIFORMS.hasNormal].value = textures.normal ? 1 : 0;
  }
  if (textures.sky !== undefined) {
    u[RIVER_UNIFORMS.sky].value = textures.sky;
    u[RIVER_UNIFORMS.hasSky].value = textures.sky ? 1 : 0;
  }
}

/** Advance the shader clock by dt seconds (Unity-style float timer). */
export function tickRiverWater(m: THREE.ShaderMaterial, dt: number): void {
  const s = riverState(m);
  s.time = Math.fround(s.time + dt);
  m.uniforms[RIVER_UNIFORMS.time].value = s.time;
}

/** Per-frame renderer inputs (called by WaterPass right before the water
 *  draw): the grabbed opaque scene + its depth, the drawing-buffer size and
 *  the camera matrices the shader reconstructs world height from. */
export function setRiverSceneInputs(
  m: THREE.ShaderMaterial,
  inputs: { bg: THREE.Texture; depth: THREE.Texture; width: number; height: number; camera: THREE.Camera },
): void {
  riverState(m);
  const u = m.uniforms;
  u[RIVER_UNIFORMS.bg].value = inputs.bg;
  u[RIVER_UNIFORMS.depth].value = inputs.depth;
  u[RIVER_UNIFORMS.hasScene].value = 1;
  (u[RIVER_UNIFORMS.res].value as THREE.Vector2).set(inputs.width, inputs.height);
  const cam = inputs.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const e = cam.projectionMatrix.elements; // column-major: [col*4 + row]
  (u[RIVER_UNIFORMS.proj].value as THREE.Vector4).set(e[0], e[5], e[8], e[9]);
  (u[RIVER_UNIFORMS.nearFar].value as THREE.Vector2).set(cam.near, cam.far);
  u[RIVER_UNIFORMS.ortho].value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
  (u[RIVER_UNIFORMS.camWorld].value as THREE.Matrix4).copy(cam.matrixWorld);
  (u[RIVER_UNIFORMS.viewProj].value as THREE.Matrix4)
    .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

/** Drop the scene inputs (water falls back to the flat tint). */
export function clearRiverSceneInputs(m: THREE.ShaderMaterial): void {
  riverState(m);
  m.uniforms[RIVER_UNIFORMS.hasScene].value = 0;
}

/** Load the six `_SkyMap` cube faces (Unity order +X,-X,+Y,-Y,+Z,-Z) written
 *  by tools/stages/extract_sky_cube.py. Rejects if any face fails. */
export async function loadSkyCube(baseUrl: string, name = 'sky_test_003'): Promise<THREE.CubeTexture> {
  const faces = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => {
    const res = await fetch(`${baseUrl}sky/${name}_${i}.webp`);
    if (!res.ok) throw new Error(`sky face ${i}: ${res.status}`);
    return createImageBitmap(await res.blob(), {
      imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
  }));
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.NoColorSpace; // _SkyMap is linear (colorSpace 0)
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
