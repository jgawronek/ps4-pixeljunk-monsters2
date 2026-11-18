# Tree swap / fall / regrow: what the original does

Source: `decomp/decompiled/Q4.NatureTree*.c`, raw x86-64 bytes of `Il2CppUserAssemblies.elf` (file offset = vaddr + 0x4000), `nature` bundle. There is NO model/LOD/species swap on build: the only visual changes are the code-driven fall (TreeFall) and regrow (TreeRise). Nature bundle has zero tree AnimationClips; the visual Animator has a null controller.

## Behaviors and evidence

| Behavior | Function @addr | Detail |
|---|---|---|
| Subscribe | `NatureTree.Awake` @0x649900 | EVERY tree registers listeners for towerBuildEvent(+0xB0), structureBreakEvent(+0xB8), treeReviveEvent(+0xD8); seeds `_ShakeStartTime=-100`. |
| Which trees fall | `OnTowerBuild` @0x64A680 (asm 0x64A838-0x64A86C) | Handler runs per tree: `tower.retainedTrees (+0xA8).Contains(thisTree.handle)` (call 0x51280). So ALL cost trees claimed by `TowerHelper.FromTreeToTower`, not just the clicked tree. Null tower (no valid site) -> nothing. |
| Fall direction | same, asm 0x64A8B1-0x64AA11 | `d = treePos - towerPos` (tower = GameCoreObject.position). asm 0x64A8EB-0x64A8F5: `vmovlps [rbp-40],xmm0 ; vmovss [rbp-38],xmm1 ; mov [rbp-3c],0` -> y is ZEROED (the Ghidra `local_48 & 0xffffffff` is this, not a packed-CONCAT44 value). `|d| != 0` -> `delay = Random.Range(0, 0.25)` (DAT_00b7e72c), dir = d. `|d| == 0` (the clicked tree is AT the tower) -> `delay = 0`, `theta = Random.Range(0, pi)` (DAT_00b7e730), dir = (cos, 0, sin). Then Normalize, `axis = Cross(dir, Vector3.up)`. |
| towerDirection (0x74) | `TowerHelper.FromTreeToTower` | Only seeds the TOWER body/fort facing. NatureTree never reads it in OnTowerBuild. |
| Trigger hide | `OnTowerBuild` | If the clicked tree == this: `m_triggerToPlayer(0x28).gameObject.SetActive(false)`, `RemoveFromPlayerSelection` (logic/UI, no mesh). |
| TreeFall | `<TreeFall>MoveNext` @0x64B270 | WaitForSeconds(delay); snapshot position/localScale/rotation; `dt = Time.deltaTime` captured ONCE; scaleSpeed=(scale.x-fallScale)/fallDuration; each frame while `Distance(origin,pos) < fallHeight`: pos -= up*(fallHeight/fallDuration)*dt; angle=Min(angle+fallAngle/fallRotateDuration*dt, fallAngle); rotation=AngleAxis(-angle, axis) (sign bit xor DAT_00b7e7e0); scale=Max(scale-dt*scaleSpeed, fallScale)*one. Else: `gameObject.SetActive(false)` + SetPositionAndRotation(origin) + localScale=origin. Consts (ctor @0x649810 & serialized, both species): fallHeight .5, fallDuration .5, fallRotateDuration .5, fallAngle 75, fallScale .25. |
| OnTreeBreak | @0x64A3A0 | structureBreakEvent for this tree: hides trigger, clears victim flag. No mesh change. |
| TreeRise | `OnTreeRevive` @0x64A490, `<TreeRise>MoveNext` @0x64B770 | treeReviveEvent(tree, player, index) fires when the refcount returns to 0 (tower SOLD: `SellTowerCommand` revives retainedTrees with index 0,1,2...). SetActive(true) (+trigger), localScale=0, `WaitForSeconds(index*0.05)` (DAT_00b7e738), then scaleTime=0.1: `localScale = one*(0.1-remaining)/0.1`; at remaining<=0 exact restore of saved scale + random shader bump. |
| Idle sway / contact shake | `SetBumpShaderParameters` @0x649B20, `Bump`, `OnPlayerEnter` | Shader-driven (MaterialPropertyBlock `_ShakeDirection/_ShakeStartTime` on LODGroup renderers). Shader ISA recovered and ported faithfully: see `TREE_SWAY_ANALYSIS.md`. |
| Species/variant | `PrefabLoader.Awake` @0x7470F0 | One random prefab from prefabRandomList at spawn; fixed afterwards. Never swapped. |
| Selection fx | `SetSelected`, `ShowSelectionEffect`, `SetSelectedAsVictimTree` | Outline / "SelectionEffect" child; not ported here. |

## What the port got wrong (fixed)

1. Only the clicked tree fell; the original falls every tree in `tower.retainedTrees`.
2. All trees fell in one fixed direction taken from the serialized `towerDirection`; the original falls away from the tower (per-tree axis from `treePos - towerPos`, y flattened).
3. The clicked tree (offset zero) must use delay 0 and a random half-circle direction; the port gave it the 0-0.25 delay and a fixed axis.
4. `treeReviveEvent` was never wired, so sold towers never regrew trees; added `onTreeRevive(id, index)` with the `index*0.05` stagger. Regrow scale is `one*k` (not `origin*k`).

## Unverified / adaptations

- `Random.Range` -> deterministic per-handle hash (no Math.random).
- Fall is closed-form over time instead of the original's fixed-first-frame dt stepping (<= 1 frame difference at constant fps).
- A revive arriving while a tree is still mid-fall is ignored (original restarts scale; sub-0.5s window).
- Victim-tree outlines not ported (shader wind / contact shake / rise bump: see `TREE_SWAY_ANALYSIS.md`).
