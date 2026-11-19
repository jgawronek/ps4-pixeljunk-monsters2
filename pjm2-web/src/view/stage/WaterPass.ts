// src/view/stage/WaterPass.ts
// Frame pipeline the original Nature/Water shader needs: the water samples a
// GRAB of the scene behind it (_BGTexture) and the depth buffer
// (_CameraDepthTexture). Passes per frame:
//   1. opaque scene (water meshes on layer 1 → skipped) → HDR render target
//      with a depth texture,
//   2. fullscreen copy of that target to the canvas (tonemapped + sRGB, depth
//      written from the RT depth so later draws occlude correctly; far-plane
//      pixels re-emit the flat clear colour untouched, as before),
//   3. water meshes only (camera layer 1) over the canvas — the water shader
//      composites against the grab itself (Blend One Zero).
// The Unity PostProcessing grade (PostGrade.ts: exact LUT generator + uber port,
// ACES, curves, vignette) is applied in this copy pass AND, via a patch of the
// river shader's tone-mapping hook, to the water, so every pixel gets the same
// grade. Renderer tone mapping must be NoToneMapping (SkyAtmosphere
// {postGraded:true}); when the grade is on the scene always renders through the
// RT even without water.
// Known limit: transparent objects/particles over the river are part of the
// grab and get covered by the water pixels (Unity sorts them with the water).

import * as THREE from 'three';
import { clearRiverSceneInputs, setRiverSceneInputs } from './RiverWaterMaterial';
import {
  POST_GRADE_GLSL, STAGE1_GRADE_PROFILE, makeGradeLutTexture, makeGradeUniforms, bakeGradeLut,
  type GradeProfile, type GradeUniforms,
} from './PostGrade';

import { BloomChain, BLOOM_APPLY_GLSL, type BloomParams } from './PostBloom';
import { AoPass, type AoParams } from './StageAO';

import { DepthOfFieldPass, dofUrlEnabled, type DofSettings } from './DepthOfField';
export const WATER_LAYER = 1;

/** Optional render extras (Unity PPSv1 bloom / ambient occlusion); null/undefined = off. */
/** A camera's PostProcessing profile as far as the pass cares (grade LUT + vignette, bloom). */
export interface PostProfile { grade: GradeProfile; bloom: BloomParams | null }

/** A ground-projected disc/ring (tower range): painted in the copy pass onto whatever the depth buffer shows (terrain, props, slopes). Three.js world space. */
export interface RangeDecal { x: number; y: number; z: number; radius: number; color: [number, number, number]; alpha: number }
export const MAX_RANGE_DECALS = 4;
/** Vertical reach of the projection volume around the decal centre (world units). */
const DECAL_HALF_HEIGHT = 4;

export interface PassExtras { bloom?: BloomParams | null; ao?: AoParams | null }

const COPY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const COPY_FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec3 uClear; // LINEAR camera clear colour for far-plane pixels
uniform float uGradeOn;
uniform mat4 uInvVP;
uniform int uDecalN;
uniform vec4 uDecalPos[${MAX_RANGE_DECALS}]; // xyz centre, w radius
uniform vec4 uDecalCol[${MAX_RANGE_DECALS}]; // rgb linear, a edge opacity
varying vec2 vUv;
#ifdef PJM_BLOOM
${BLOOM_APPLY_GLSL}
#endif
${POST_GRADE_GLSL}
void main() {
	float d = texture2D( tDepth, vUv ).r;
	gl_FragDepth = d;
	vec3 c = ( d >= 0.999999 ) ? uClear : texture2D( tColor, vUv ).rgb;
	if ( uDecalN > 0 && d < 0.999999 ) {
		vec4 wp = uInvVP * vec4( vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
		vec3 w = wp.xyz / wp.w;
		for ( int i = 0; i < ${MAX_RANGE_DECALS}; i ++ ) {
			if ( i >= uDecalN ) break;
			vec3 dp = w - uDecalPos[ i ].xyz;
			float R = uDecalPos[ i ].w;
			float r = length( dp.xz );
			if ( r < R && abs( dp.y ) < ${DECAL_HALF_HEIGHT.toFixed(1)} ) {
				float edge = smoothstep( R * 0.95, R * 0.965, r );
				c = mix( c, uDecalCol[ i ].rgb, mix( uDecalCol[ i ].a * 0.25, uDecalCol[ i ].a, edge ) );
			}
		}
	}
	#ifdef PJM_BLOOM
	c += bloomColor( vUv ); // PPSv1 bloom also lights the sky (the far-plane pixels hold the flat clear colour in the bloom source)
	#endif
	gl_FragColor = vec4( uGradeOn > 0.5 ? postGrade( c, vUv ) : c, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/** Patch the river ShaderMaterial so its tone-mapping hook applies the stage grade. */
const RIVER_GRADE_HOOK = '#include <tonemapping_fragment>';
function installRiverGrade(m: THREE.ShaderMaterial, u: GradeUniforms, res: { value: THREE.Vector2 }): void {
  if (m.userData.postGrade) return;
  m.userData.postGrade = true;
  Object.assign(m.uniforms, u, { uGradeRes: res });
  if (!m.fragmentShader.includes(RIVER_GRADE_HOOK)) return;
  m.fragmentShader = 'uniform vec2 uGradeRes;\n' + POST_GRADE_GLSL + m.fragmentShader.replace(
    RIVER_GRADE_HOOK,
    'gl_FragColor.rgb = postGrade( gl_FragColor.rgb, gl_FragCoord.xy / uGradeRes );',
  );
  m.needsUpdate = true;
}

export class WaterPass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly size = new THREE.Vector2();
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly copyScene = new THREE.Scene();
  private readonly copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clear = new THREE.Color();
  private meshes: THREE.Mesh[] = [];
  private material: THREE.ShaderMaterial | null = null;
  private readonly grade: GradeUniforms;
  private readonly gradeRes = { value: new THREE.Vector2(1, 1) };
  private gradeLut: THREE.DataTexture | null = null;
  private gradeOn: boolean;
  private bloom: BloomChain | null;
  private bloomOn: boolean;
  private readonly extrasBloomBase: boolean;
  private readonly baseGrade: GradeProfile;
  private readonly gradeLuts = new Map<GradeProfile, THREE.DataTexture>();
  private activeProfile: PostProfile | null = null;
  private readonly ao: AoPass | null;
  private dof: DepthOfFieldPass | null = null;
  private dofSettings: DofSettings | null = null;
  private readonly dofAllowed = dofUrlEnabled(typeof window !== 'undefined' ? window.location.search : '');

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    /** Flat clear colour (sRGB hex) re-emitted for far-plane pixels. */
    clearHex: THREE.ColorRepresentation,
    private readonly msaaSamples = 4,
    /** Apply the Unity PostProcessing grade (default on). */
    grade: boolean | GradeProfile = true,
    extras: PassExtras = {},
  ) {
    this.bloom = extras.bloom ? new BloomChain(extras.bloom) : null;
    this.bloomOn = this.bloom !== null;
    this.extrasBloomBase = this.bloom !== null;
    this.baseGrade = typeof grade === 'object' ? grade : STAGE1_GRADE_PROFILE;
    this.ao = extras.ao ? new AoPass(extras.ao) : null;
    this.clear.set(clearHex); // → working (linear) space
    this.gradeOn = grade !== false;
    this.grade = makeGradeUniforms(typeof grade === 'object' ? grade : STAGE1_GRADE_PROFILE);
    if (this.gradeOn) {
      this.gradeLut = makeGradeLutTexture(bakeGradeLut(this.baseGrade));
      this.gradeLuts.set(this.baseGrade, this.gradeLut);
      this.grade.uGradeLut.value = this.gradeLut;
    }
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: COPY_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uClear: { value: new THREE.Vector3(this.clear.r, this.clear.g, this.clear.b) },
        uGradeOn: { value: this.gradeOn ? 1 : 0 },
        uInvVP: { value: new THREE.Matrix4() },
        uDecalN: { value: 0 },
        uDecalPos: { value: Array.from({ length: MAX_RANGE_DECALS }, () => new THREE.Vector4()) },
        uDecalCol: { value: Array.from({ length: MAX_RANGE_DECALS }, () => new THREE.Vector4()) },
        ...this.grade,
        ...(this.bloom ? this.bloom.applyUniforms : {}),
      },
      defines: this.bloom ? { PJM_BLOOM: '' } : {},
      // GL disables depth WRITES when the depth test is off, so keep the test on
      // and make it always pass: the copy then writes the RT depth through
      // gl_FragDepth and later draws (water) are occluded by bridge/player/props.
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
      blending: THREE.NoBlending,
      toneMapped: !this.gradeOn, // the grade IS the tone map (ACES inside the LUT)
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
    quad.frustumCulled = false;
    this.copyScene.add(quad);
  }

  /** Register the river meshes + their material; they move to WATER_LAYER only. */
  setWater(meshes: THREE.Mesh[], material: THREE.ShaderMaterial | null): void {
    this.meshes = meshes;
    this.material = material;
    if (material && this.gradeOn) installRiverGrade(material, this.grade, this.gradeRes);
    for (const m of meshes) {
      m.layers.set(WATER_LAYER);
      m.frustumCulled = false;
    }
  }

  /**
   * Switch the post profile at runtime (camera -> PostProcessingBehaviour.profile): grade (LUT + vignette) and bloom.  null = the construction
   * profile.  The LUT of each profile is baked once (~30 ms) and kept.  Only meaningful when the grade is on.
   */
  setPostProfile(p: PostProfile | null): void {
    if (p === this.activeProfile || !this.gradeOn) return;
    this.activeProfile = p;
    const g = p?.grade ?? this.baseGrade;
    let lut = this.gradeLuts.get(g);
    if (lut === undefined) { lut = makeGradeLutTexture(bakeGradeLut(g)); this.gradeLuts.set(g, lut); }
    this.grade.uGradeLut.value = lut;
    const fresh = makeGradeUniforms(g);
    this.grade.uGradeA.value.copy(fresh.uGradeA.value);
    this.grade.uGradeB.value.x = fresh.uGradeB.value.x; this.grade.uGradeB.value.y = fresh.uGradeB.value.y; this.grade.uGradeB.value.z = fresh.uGradeB.value.z;
    this.grade.uGradeVigColor.value.copy(fresh.uGradeVigColor.value);
    const b = p?.bloom ?? null;
    if (b !== null) {
      if (this.bloom === null) {
        this.bloom = new BloomChain(b);
        Object.assign(this.copyMat.uniforms, this.bloom.applyUniforms);
        this.copyMat.defines = { ...this.copyMat.defines, PJM_BLOOM: '' };
        this.copyMat.needsUpdate = true;
      } else this.bloom.setParams(b);
      this.bloomOn = true;
    } else if (this.bloom !== null && !this.extrasBloomBase) {
      this.bloomOn = false;
      this.bloom.applyUniforms.uBloom.value.set(0, 0, 0); // PJM_BLOOM stays compiled in; zero intensity = off
    }
  }

  /** Probe: which post profile is live. */
  get postState(): { profile: boolean; bloomOn: boolean; gradeOn: boolean; dof: boolean } { return { profile: this.activeProfile !== null, bloomOn: this.bloomOn, gradeOn: this.gradeOn, dof: this.dofActive }; }

  private readonly decals = new Map<string, RangeDecal>();
  /** Show (or with null remove) a ground-projected range decal; implements RangeIndicator's DecalSink. */
  setRangeDecal(id: string, d: RangeDecal | null): void {
    if (d === null) this.decals.delete(id); else this.decals.set(id, d);
  }

  get active(): boolean { return this.meshes.length > 0 && this.material !== null; }
  /** Scene renders via the HDR target (water and/or grade). */
  get usesTarget(): boolean { return this.decals.size > 0 || this.active || this.gradeOn || this.bloomOn || !!this.ao || this.dofActive; }
  /** Unity PPSv1 depth of field of the active camera's profile (null = disabled); `?dof=0` forces off. */
  setDof(s: DofSettings | null): void { this.dofSettings = this.dofAllowed ? s : null; }
  get dofActive(): boolean { return this.dofSettings !== null; }
  get extrasEnabled(): { bloom: boolean; ao: boolean } { return { bloom: this.bloomOn, ao: !!this.ao }; }
  /** Last AO buffer (probes). */
  get aoTexture(): THREE.Texture | null { return this.ao?.texture ?? null; }
  get gradeEnabled(): boolean { return this.gradeOn; }

  private ensureTarget(w: number, h: number): THREE.WebGLRenderTarget {
    if (this.rt && this.rt.width === w && this.rt.height === h) return this.rt;
    this.rt?.dispose();
    this.rt?.depthTexture?.dispose();
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.msaaSamples,
      depthTexture: depth,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    return this.rt;
  }

  /** Drop-in for renderer.render(scene, camera). */
  render(camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.usesTarget) { r.render(this.scene, camera); return; }
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    const rt = this.ensureTarget(w, h);
    this.gradeRes.value.set(w, h);
    this.grade.uGradeB.value.w = w / h;
    {
      const u = this.copyMat.uniforms;
      camera.updateMatrixWorld();
      (u.uInvVP.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      let n = 0;
      for (const d of this.decals.values()) {
        if (n >= MAX_RANGE_DECALS) break;
        (u.uDecalPos.value as THREE.Vector4[])[n].set(d.x, d.y, d.z, d.radius);
        (u.uDecalCol.value as THREE.Vector4[])[n].set(d.color[0], d.color[1], d.color[2], d.alpha);
        n++;
      }
      u.uDecalN.value = n;
    }

    // 1. opaque scene (water is on layer 1; camera sees layer 0)
    this.ao?.beginFrame(camera, w, h);
    r.setRenderTarget(rt);
    r.render(this.scene, camera);
    r.setRenderTarget(null);
    if (this.ao) this.ao.endFrame(r, rt.depthTexture!, camera as THREE.PerspectiveCamera, w, h);
    let sceneTex: THREE.Texture = rt.texture;
    if (this.dofSettings !== null && camera instanceof THREE.PerspectiveCamera) {
      this.dof ??= new DepthOfFieldPass();
      sceneTex = this.dof.run(r, rt.texture, rt.depthTexture!, camera, this.dofSettings, w, h); // PPSv1 order: DoF before bloom / grade
    }
    if (this.bloomOn) this.bloom?.run(r, sceneTex, w, h);

    // 2. copy to the canvas
    this.copyMat.uniforms.tColor.value = sceneTex;
    this.copyMat.uniforms.tDepth.value = rt.depthTexture;
    r.render(this.copyScene, this.copyCam);
    if (!this.active) return;

    // 3. water over the canvas (no clear, no background, no shadow re-render)
    setRiverSceneInputs(this.material!, {
      bg: rt.texture, depth: rt.depthTexture!, width: w, height: h, camera,
    });
    const prevAuto = r.autoClear;
    const prevShadow = r.shadowMap.autoUpdate;
    const prevBg = this.scene.background;
    const prevMask = camera.layers.mask;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    this.scene.background = null;
    camera.layers.set(WATER_LAYER);
    r.render(this.scene, camera);
    camera.layers.mask = prevMask;
    this.scene.background = prevBg;
    r.shadowMap.autoUpdate = prevShadow;
    r.autoClear = prevAuto;
  }

  dispose(): void {
    if (this.material) clearRiverSceneInputs(this.material);
    this.rt?.dispose();
    this.rt?.depthTexture?.dispose();
    this.rt = null;
    this.copyMat.dispose();
    for (const t of this.gradeLuts.values()) t.dispose();
    this.bloom?.dispose();
    this.ao?.dispose();
    this.dof?.dispose();
  }
}
