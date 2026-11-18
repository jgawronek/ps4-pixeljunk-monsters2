// src/main/preferences.ts
// Applies Q4.GamePreferences to the running web game (Q4.GamePreferences.ApplySettingsToGame
// @0044eaf0: MonstersAudio.OnAudioLevelsChanged(bgVolume, seVolume) + language refresh), and lets
// other features subscribe to the remaining options.
//
//   bgVolume / seVolume   -> AudioManager.setBgmVolume / setSeVolume   (APPLIED)
//   invertY               -> `prefsEvents` listeners / getPrefs().invertY (the stage camera feature may read it;
//                            the web top-down camera has no Y-axis look, so there is nothing to invert today)
//   showActionIcon        -> same bus; read by the interaction-icon HUD (Access_Icon_01) if it wants to hide
//   show2PJoinLabel       -> stored only (no local 2P in the web port)
//   language              -> English only in this build (option row inactive in the prefab as well)

import type { AudioManager } from '../view/audio/AudioManager';
import type { GamePreferences } from '../view/save/SaveData';
import { DEFAULT_PREFERENCES } from '../view/save/SaveData';

let current: GamePreferences = { ...DEFAULT_PREFERENCES };
const listeners = new Set<(p: GamePreferences) => void>();

export function getPrefs(): GamePreferences {
  return { ...current };
}

/** Subscribe to applied preference changes; returns an unsubscribe fn. Called immediately with the current value. */
export function onPrefs(cb: (p: GamePreferences) => void): () => void {
  listeners.add(cb);
  cb({ ...current });
  return () => { listeners.delete(cb); };
}

export function applyAudioPrefs(audio: Pick<AudioManager, 'setBgmVolume' | 'setSeVolume'> | null, p: Pick<GamePreferences, 'bgVolume' | 'seVolume'>): void {
  audio?.setBgmVolume(p.bgVolume);
  audio?.setSeVolume(p.seVolume);
}

/** Apply a full preference set (boot restore, option menu Apply, reset). */
export function applyPreferences(audio: Pick<AudioManager, 'setBgmVolume' | 'setSeVolume'> | null, p: GamePreferences): void {
  current = { ...p };
  applyAudioPrefs(audio, p);
  for (const cb of [...listeners]) cb({ ...current });
}
