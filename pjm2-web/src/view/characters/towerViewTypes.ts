// src/view/characters/towerViewTypes.ts
// Types for the generated tower view data (towerViewData.generated.ts, written
// by tools/assets/extract_tower_view_data.py from the structures AssetBundle).

/** AnimatorControllerParameterType, by name. */
export type AnimParamType = 'float' | 'int' | 'bool' | 'trigger';

export interface AnimCondition {
  param: string | null;
  /** Unity AnimatorConditionMode: 1 If, 2 IfNot, 3 Greater, 4 Less, 6 Equals, 7 NotEqual. */
  mode: number;
  threshold: number;
}

export interface AnimTransition {
  /** Index into the layer's `states`. */
  dest: number;
  conds: AnimCondition[];
  exit: boolean;
  exitTime: number;
  duration: number;
  offset: number;
  fixed: boolean;
}

export interface AnimState {
  /** Short state name (m_NameID), e.g. "fire"; the full path is `<layer.name>.<name>`. */
  name: string;
  /** AnimationClip m_Name this state plays (null for blend trees without a clip). */
  clip: string | null;
  speed: number;
  loop: boolean;
  transitions: AnimTransition[];
}

export interface AnimLayer {
  name: string;
  defaultState: number;
  /** 0 override, 1 additive. */
  blendMode: number;
  defaultWeight: number;
  states: AnimState[];
}

export interface AnimController {
  params: { name: string | null; type: AnimParamType }[];
  layers: AnimLayer[];
}

export interface TowerViewRecord {
  /** Q4.TowerBase.fortJointNameHorizontal (0xA0) — receives the flat yaw aim. */
  jointHorizontal: string;
  /** Q4.TowerBase.fortJointNameVertical (0xA8) — receives the clamped full aim + recoil. */
  jointVertical: string;
  fortAngleMin: number;
  fortAngleMax: number;
  recoil: number;
  /** AudioClip name of TowerBase.rotateSound (null = silent). */
  rotateSound: string | null;
  /** GameObject name of the towerBuildEffect ParticleGroup prefab. */
  buildEffect: string | null;
  destroyEffect: string | null;
  flagPlaceholder: string;
  /** Class of the TowerAnimator* component on the logic prefab (null = none). */
  animatorClass: string | null;
  /** Q4.TowerAnimator.fireAnimationDuration (0x18, serialized; ctor default 1.0). */
  fireAnimationDuration: number;
  controller: AnimController | null;
  flagController: AnimController | null;
}
