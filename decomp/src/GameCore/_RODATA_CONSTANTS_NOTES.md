# Resolved rodata constants (read directly from Il2CppUserAssemblies.elf)

File offset = Ghidra vaddr + 0x4000 (first PT_LOAD: offset 0x4000, vaddr 0).

For `src/GameCore/GameCoreWaveManager.cs` (marked INFERRED there — apply when
the wave/tower agent finishes):

| Symbol | vaddr | hex (LE) | float value | Meaning |
|---|---|---|---|---|
| DAT_00b7c47c | 0xB7C47C | 00000000 | **0.0** | StageClearLifeEpsilon — INFERRED 0.0 was CORRECT |
| DAT_00b7c480 | 0xB7C480 | 0000803f | **1.0** | SpawnStartEpsilon — INFERRED 0.0 was WRONG; actual 1.0 |
| DAT_00b7c484 | 0xB7C484 | 35fa8e3c | **0.01745329238** = Mathf.Deg2Rad | OffsetAngleScale — degrees→radians factor (INFERRED 1.0 was WRONG) |
| DAT_00b7c488 | 0xB7C488 | 00000000 | **0.0** | SpawnDelayEpsilon — INFERRED 0.0 was CORRECT |

Note: DAT_00b7c480 (1.0) and DAT_00b7c484 (Deg2Rad) sit adjacent in a small
.rodata constant block; these are shared literal-pool entries so double-check
the exact DAT each instruction references before substituting (the 1.0 may be
a generic constant used as an epsilon elsewhere — verify against the
disassembly of the comparing instruction).
