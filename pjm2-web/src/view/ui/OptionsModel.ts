// src/view/ui/OptionsModel.ts
// Pure state machine of the option menu (Q4.OptionMenuController, prefab option_01).
//
// ROWS (prefab option_01 Screen_Loc, active ones; y in the 1920x1080 reference, label x=544):
//   Mess_Loc_Sel_01/Change_01 y=421  controlButton       UIButton  tl_option_003 "Controls"  (opens ControlMenuController)
//   Mess_Loc_Sel_02/Change_02 y=503  bgmSelect           UISelect 0..10 (init 5)  tl_option_004 "Music"
//   Mess_Loc_Sel_03/Change_03 y=585  seSelect            UISelect 0..10           tl_option_005 "Sound Effects"
//   Mess_Loc_Sel_05/Change_05 y=667  invertYSelect       UISelect [false,true]    tl_option_013 "Y-Axis Camera" Normal/Inverted
//   Mess_Loc_Sel_06/Change_06 y=749  show2PJoinLabel     UISelect [Off,On]        tl_option_017 "2P Icon Display"
//   Mess_Loc_Sel_08/Change_08 y=831  showActionIcon      UISelect [Off,On]        tl_option_022 "Action Button Display"
//   (inactive in this build: Sel_04 Language, Sel_07 Set Controllers)
//
// SEMANTICS (decomp Q4.OptionMenuController.c):
//   InitFromSettings @003daeb0: bg/se -> round(v*10); invertY, show2P, showActionIcon -> index 0/1;
//     then snapshots every select's index (initialOptionValues).
//   OnValueChanged @003db940: bg/se rows -> MonstersAudio.OnAudioLevelsChanged(v*0.1, v*0.1) LIVE preview.
//   UISelect.OnLeft/OnRight @005d62e0/@005d6590: clamp (Max(min, i-1) / Min(max, i+1)), SFX
//     MenuSettingChange only when the value changed.
//   haveAnyValuesChanged @003daa80: any select index != snapshot.
//   OnConfirm @003db580: on a value row, if changed -> dialog tl_dialog_text_001 ("save?"); Yes -> Apply + close.
//   OnCancel @003db6a0: if changed -> same dialog (Yes: apply + close, No: revert audio levels from prefs + close);
//     unchanged -> close.
//   OnResetOptions @003dbd60 (gesture menu_resetOptions): if changed or HasNonDefaultPreferences ->
//     dialog tl_dialog_text_002 ("restore defaults?"); Yes -> ResetAllPreferences + InitFromSettings.
//   Apply @003dbeb0: bg/se = value*0.1, invertY = (value=="true"), show2P/showActionIcon = (index==1),
//     SavePreferences + ApplySettingsToGame.

export interface OptionValues {
  bgVolume: number; // 0..1
  seVolume: number;
  invertY: boolean;
  show2PJoinLabel: boolean;
  showActionIcon: boolean;
}

export const OPTION_DEFAULTS: Readonly<OptionValues> = {
  bgVolume: 1, seVolume: 1, invertY: false, show2PJoinLabel: true, showActionIcon: true,
};

/** Unity Mathf.RoundToInt = round-half-to-even (System.Math.Round default). */
export function roundToInt(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export type OptionRowId = 'controls' | 'bgm' | 'se' | 'invertY' | 'show2P' | 'actionIcon';

export interface OptionRowDef {
  id: OptionRowId;
  node: string;
  /** y in the 1920x1080 reference (prefab ap.y of Mess_Loc_Sel_NN / Change_NN, negated). */
  y: number;
  label: string;
  kind: 'button' | 'number' | 'text';
  max: number;
  /** text labels per index (TextDatabase keys). */
  texts?: readonly string[];
}

export const OPTION_ROWS: readonly OptionRowDef[] = [
  { id: 'controls', node: 'Sel_01', y: 421, label: 'tl_option_003', kind: 'button', max: 0 },
  { id: 'bgm', node: 'Sel_02', y: 503, label: 'tl_option_004', kind: 'number', max: 10 },
  { id: 'se', node: 'Sel_03', y: 585, label: 'tl_option_005', kind: 'number', max: 10 },
  { id: 'invertY', node: 'Sel_05', y: 667, label: 'tl_option_013', kind: 'text', max: 1, texts: ['tl_option_014', 'tl_option_015'] },
  { id: 'show2P', node: 'Sel_06', y: 749, label: 'tl_option_017', kind: 'text', max: 1, texts: ['tl_option_019', 'tl_option_018'] },
  { id: 'actionIcon', node: 'Sel_08', y: 831, label: 'tl_option_022', kind: 'text', max: 1, texts: ['tl_option_019', 'tl_option_018'] },
];

export type OptionDialog = null | { kind: 'save' | 'reset'; text: string; yes: boolean; fromCancel: boolean };

export type OptionEvent =
  | { type: 'sfx'; name: 'select' | 'change' | 'confirm' | 'cancel' }
  | { type: 'audioLevels'; bg: number; se: number }
  | { type: 'apply'; values: OptionValues }
  | { type: 'reset'; values: OptionValues }
  | { type: 'controls' }
  | { type: 'close' };

export class OptionsModel {
  /** Index per row (button row stays 0). */
  readonly index: number[] = OPTION_ROWS.map(() => 0);
  private snapshot: number[] = OPTION_ROWS.map(() => 0);
  row = 0;
  dialog: OptionDialog = null;
  readonly events: OptionEvent[] = [];
  private stored: OptionValues;

  constructor(prefs: OptionValues, private readonly hasNonDefault: () => boolean) {
    this.stored = { ...prefs };
    this.initFromSettings(prefs);
  }

  drain(): OptionEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** InitFromSettings @003daeb0. */
  initFromSettings(p: OptionValues): void {
    this.stored = { ...p };
    this.index[1] = roundToInt(p.bgVolume * 10);
    this.index[2] = roundToInt(p.seVolume * 10);
    this.index[3] = p.invertY ? 1 : 0;
    this.index[4] = p.show2PJoinLabel ? 1 : 0;
    this.index[5] = p.showActionIcon ? 1 : 0;
    this.snapshot = [...this.index];
  }

  get haveAnyValuesChanged(): boolean {
    return this.index.some((v, i) => v !== this.snapshot[i]);
  }

  /** Help-bar "Reset" entry visible (HasNonDefaultProperties @003dbae0). */
  get canReset(): boolean {
    return this.haveAnyValuesChanged || this.hasNonDefault();
  }

  values(): OptionValues {
    return {
      bgVolume: (this.index[1] ?? 0) * 0.1,
      seVolume: (this.index[2] ?? 0) * 0.1,
      invertY: this.index[3] === 1,
      show2PJoinLabel: this.index[4] === 1,
      showActionIcon: this.index[5] === 1,
    };
  }

  moveRow(d: number): void {
    if (this.dialog !== null) return;
    const n = this.row + d;
    if (n < 0 || n >= OPTION_ROWS.length) return; // Unity vertical navigation does not wrap
    this.row = n;
    this.events.push({ type: 'sfx', name: 'select' });
  }

  setRow(i: number): void {
    if (this.dialog !== null || i < 0 || i >= OPTION_ROWS.length || i === this.row) return;
    this.row = i;
    this.events.push({ type: 'sfx', name: 'select' });
  }

  /** UISelect.OnLeft / OnRight (clamped, SFX only when changed). */
  adjust(d: number): void {
    if (this.dialog !== null) {
      this.dialog.yes = d < 0; // left = Yes, right = No (horizontal dialog buttons)
      this.events.push({ type: 'sfx', name: 'select' });
      return;
    }
    const def = OPTION_ROWS[this.row]!;
    if (def.kind === 'button') return;
    const cur = this.index[this.row]!;
    const nxt = Math.min(def.max, Math.max(0, cur + d));
    if (nxt === cur) return;
    this.index[this.row] = nxt;
    this.events.push({ type: 'sfx', name: 'change' });
    if (def.id === 'bgm' || def.id === 'se') {
      const v = this.values();
      this.events.push({ type: 'audioLevels', bg: v.bgVolume, se: v.seVolume }); // OnValueChanged live preview
    }
  }

  confirm(): void {
    if (this.dialog !== null) {
      this.answer(this.dialog.yes);
      return;
    }
    const def = OPTION_ROWS[this.row]!;
    if (def.kind === 'button') {
      this.events.push({ type: 'sfx', name: 'confirm' });
      this.events.push({ type: 'controls' });
      return;
    }
    if (this.haveAnyValuesChanged) {
      this.dialog = { kind: 'save', text: 'tl_dialog_text_001', yes: true, fromCancel: false };
      this.events.push({ type: 'sfx', name: 'confirm' });
    }
  }

  cancel(): void {
    if (this.dialog !== null) {
      this.answer(false);
      return;
    }
    if (this.haveAnyValuesChanged) {
      this.dialog = { kind: 'save', text: 'tl_dialog_text_001', yes: true, fromCancel: true };
    } else {
      this.events.push({ type: 'sfx', name: 'cancel' }, { type: 'close' });
    }
  }

  /** menu_resetOptions gesture (OnResetOptions @003dbd60). */
  requestReset(): void {
    if (this.dialog !== null || !this.canReset) return;
    this.dialog = { kind: 'reset', text: 'tl_dialog_text_002', yes: true, fromCancel: false };
  }

  answer(yes: boolean): void {
    const dlg = this.dialog;
    if (dlg === null) return;
    this.dialog = null;
    if (dlg.kind === 'reset') {
      if (!yes) return;
      this.initFromSettings(OPTION_DEFAULTS);
      this.events.push({ type: 'sfx', name: 'confirm' }, { type: 'reset', values: { ...OPTION_DEFAULTS } });
      return;
    }
    if (yes) {
      const v = this.values();
      this.stored = { ...v };
      this.snapshot = [...this.index];
      this.events.push({ type: 'sfx', name: 'confirm' }, { type: 'apply', values: v }, { type: 'close' });
    } else if (dlg.fromCancel) {
      // OnConfirmCancel(false): hide without apply + restore the saved audio levels.
      this.events.push({ type: 'audioLevels', bg: this.stored.bgVolume, se: this.stored.seVolume }, { type: 'sfx', name: 'cancel' }, { type: 'close' });
    }
  }
}
