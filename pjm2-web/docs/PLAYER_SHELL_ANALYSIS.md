# Player shell ("carapace") — analysis of the original and the port

## What the shell is
The shell on tikiman's back is the **Carapace** cosmetic. It is not part of the
tikiman body mesh. The game has two equippable player cosmetics:

| slot | save field | defs asset (globalsettings) | default prefab |
|---|---|---|---|
| mask (face) | `SaveData.equippedMaskName` | `MaskDefinitions` (`assets/globalsettings/maskdefinitions.asset`) | `mask_00_pa` (pid -7835467561352950186) |
| carapace (shell) | `SaveData.equippedCarapaceName` | `CarapaceDefinitions` (`carapacedefinitions.asset`) | `carapace_00_pa` (pid 8144356912889441074) |

Both lists are referenced from `ClothingUnlockData` (`m_maskDefinitions`,
`m_carapaceDefinitions`, `m_fruitDefinitions`). Each `ClothingUnlockDefinition`
is `{name, description, coinCost, gemCost, medalCost, prefab, dlcLock, dialog}`;
the default item is `m_defaultItem` (`tl_costume_name_02_00` for the carapace,
cost 0), then 15+ unlockable alternatives bought with medals in the shop
(`tl_costume_name_02_01..`, 23-33 medals each). The shop/ChangingRoom/lobby
avatar equip them via `Q4.UI.ShopMainController`, `Q4.ChangingRoom`,
`Q4.UI.MatchingLobbyAvatar`.

The body GLB `tikiman_01_comp_LOD0` (31452 indices, 1 material) has the
`Carapace_Bn` bone (child of `Spine_03_Bn`) but **no geometry skinned to the
shell and no face mask geometry** — those live in the cosmetic prefabs. So the
port was missing both the shell and the mask (face).

## How it is attached and driven — `Q4.PlayerAvatarDecorator` (TypeDef 3609)
Fields: `m_currentMaskPrefab/Instance` 0x18/0x20, `m_currentCarapacePrefab/Instance`
0x28/0x30, `m_playerTransform` 0x38, `m_bodyTransforms` 0x40,
`m_maskTransforms` 0x48, `m_carapaceTransforms` 0x50 (lists of
`TransformMapping{m_source, m_destination}`).

- `Awake` @0x3EC010: `FindDeep(gameObject,"Root")`, collect all child
  Transforms into `m_bodyTransforms`; `m_playerTransform = gameObject.transform`
  (the decorator sits on the visual `tikiman_01_comp`; the Player MonoBehaviour
  holds it at +0x288).
- `Player.SetInfo` @0x3E6BC0 → `SetCustomizedPartsFromSettings` @0x3E6D10: takes
  `SaveData.Instance.equippedMaskName/equippedCarapaceName`; non-network,
  non-primary local players pick a random unlocked/DLC-available item
  (up to 9 tries); empty name → `ClothingUnlockDefinitions.defaultItem`
  (so default loadout = mask_00 + carapace_00). → `SetCustomizedParts(name,name)`
  @0x3E72A0 (name → prefab via `GetDefinition`) → prefab overload @0x3EABF0, which
  calls `SetInternal` for mask and carapace, then `UpdateTransforms`, and when
  changed in the shop triggers Animator `SwitchMask/RemoveMask/SwitchCarapace/
  RemoveCarapace` + `ShopPutOn/TakeOffCarapace` SFX.
- `SetInternal` @0x3EC230: destroys the old instance (and outline), `Instantiate(prefab)`,
  `SetParent(m_playerTransform)`, `localPosition = zero`, `localRotation = identity`,
  tag `"Carapace"` (also used for the mask slot), layer copied from the player
  recursively, `ObjectOutlineRenderer.AddOutlineMesh(instance, Color.clear)`, then
  `FindUsedTransforms`.
- `FindUsedTransforms` @0x3EC4F0 / `AddBoneHierarchyToMap` @0x3EC960: for each
  SkinnedMeshRenderer in the instance, for each vertex boneWeight with weight >
  const (`DAT_00b7a700`, not read) add that bone and its ancestors (up to the
  renderer's rootBone parent) to a dictionary keyed by the part transform, with the
  same-named player bone as value → `TransformMapping(source=player bone,
  destination=part bone)`.
- `LateUpdate` @0x3EC0B0 → `UpdateTransforms` @0x3EC0C0: for every mapping copy
  `localPosition` and `localRotation` source → destination, mask list then carapace list.

There is **no spring/jiggle/physics** component on the shell: its motion is
entirely the player's own animation channels on `Carapace_Bn` (and parents)
copied each LateUpdate. It does not change with tower-building, damage or gems
(only the player clips drive it, including the dance/damage clips).

## Prefab hierarchy dump (globalsettings bundle)
```
carapace_00_pa
  carapace_00_comp  [Animator, LODGroup (4 LODs)]
    carapace_00_comp_LOD0 [SkinnedMeshRenderer mesh=carapace_00_comp_LOD0, mat tikiman_01_m, 2 bones]
    carapace_00_comp_LOD1..3 [SMR, 1 bone each]
    Root/Hips_Bn/Spine_01_Bn/Spine_02_Bn/Spine_03_Bn/{Belt_Bn…, Carapace_Bn, Chest_Bn/…arms/head…}, Thigh_*  (full copy of the tikiman skeleton, 98 bones)
mask_00_pa
  mask_00_comp [Animator, LODGroup]
    mask_00_comp_LOD0 [SMR mesh=mask_00_comp_LOD0, mat tikiman_01_m, 8 bones] (+LOD1..3, 7 bones)
    Root/... (same full skeleton copy)
```
All GameObjects active, SMRs enabled; both reuse the **tikiman_01_m** material
(same atlas as the body, no new textures). 394 verts (carapace LOD0), 2453 verts (mask LOD0).

## Why it was missing
`extract_all_characters.py` exported only the player prefab `tikiman_01_pa` →
`tikiman_01_comp_LOD0`. The cosmetics are not children of the player prefab: they
are separate prefabs reachable only through `ClothingUnlockData`
(a ScriptableObject reference graph) and instantiated by C# at runtime. Nothing
in the extractor or the viewer knew about them.

## What changed
- `tools/assets/extract_all_characters.py`: new `player-part` defs `carapace_00`,
  `mask_00` (`visualPid` bypasses the logic-prefab lookup; no animation baked since pose
  is copied at runtime). Outputs `public/assets/characters/{carapace_00,mask_00}/*.glb`
  (53 KB + 220 KB; textures already shared). `PJM2_MANIFEST_OUT` env redirects the
  manifest write (default unchanged).
- Same bug class found for other characters: SMRs that are **not LOD-named** but active,
  enabled and outside the LODGroup (always drawn by the engine) were dropped
  (`chosen_smr` = LOD0 only). Fixed (`non_lod` added) and regenerated:
  `boss_kao_00..03` (`boss_kao_00_face_skin`), `tower_007` and `tower_test_007`
  (`tower_007_add_parts_01`). `tools/assets/audit_dropped_renderers.py` compares
  prefab renderer nodes with GLB mesh nodes for all 82 outputs: remaining
  mismatches are only `tower_test_001/005`, whose source renderers have a dangling
  `m_Mesh` (no mesh in the shipped data). Towers/enemies/chibi are otherwise clean.
- `src/view/characters/PlayerAvatarDecorator.ts`: port of the decorator (used-bone
  mapping from skin weights + ancestors, per-frame local pos/rot copy).
- `PlayerStageView`: takes `{mask, carapace}` rigs, calls `decorator.updateTransforms()`
  right after `mixer.update` (LateUpdate order). `src/main/game.ts`: loads `mask_00`,
  `carapace_00` and passes them (default loadout).
- Test: `tests/view/playerShell.test.ts`.

## Not ported / unverified
- Equipped-item selection from save data and the other 15 carapaces / masks (shop,
  medals, DLC locks, random pick for non-primary players, SwitchMask/Carapace
  triggers): only the default loadout is wired; the extractor can emit any other
  prefab by adding a def with `visualPid` (pids in `CarapaceDefinitions`).
- The weight threshold constant `DAT_00b7a700` was not read; the port uses `> 0`
  (only affects whether near-zero-weight bones are copied, which is visually inert).
- `ObjectOutlineRenderer` colour (`Color.clear` per decompile) – the port uses the
  shared toon/outline pass.
- `tower_007_add_parts_01` / `boss_kao_*_face_skin` are drawn whenever the model is
  shown (engine behaviour for active renderers outside the LODGroup); any script-driven
  toggling was not investigated.
