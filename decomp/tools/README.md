# Data-extraction & verification tools

Reproducible pipeline that turns the user's own decrypted game AssetBundles into
the numeric data tables in `decomp/data/`, plus a harness that verifies the C#
data layer loads them.

## Prerequisites
- Decrypted game at `game/extracted/CUSA11967/` (see PROGRESS.md for how it was
  produced: ps4-pkg-tools → ps4_unfself; fake-SELF, no retail DRM broken).
- UnityPy venv: `python3 -m venv /srv/opencode/venv-unity && /srv/opencode/venv-unity/bin/pip install unitypy`
- .NET 8 SDK (for the verify step): `apt-get install -y dotnet-sdk-8.0`

## Run order
```
/srv/opencode/venv-unity/bin/python 01_extract_enemies.py
/srv/opencode/venv-unity/bin/python 02_extract_structures_stages.py
/srv/opencode/venv-unity/bin/python 03_resolve_waves.py
```
These write `decomp/data/*.json` (enemy roster, tower/upgrade tables, resolved
per-stage wave tables, difficulty multipliers, area/stage map). Paths inside the
scripts are absolute; edit `BASE`/`OUT` if the tree moves.

## Verify the C# data layer
`verify_datalayer.cs` is a throwaway console harness (kept for auditability).
To re-run: copy `decomp/src/GameData/{GameDataEnums,GameDataTypes,GameDataLoader}.cs`
and `verify_datalayer.cs` into a `net8.0` console project and `dotnet run`.
Expected tail of output: `Spawn->EnemyDef resolution: 1873/1873 ... 0 missing`
and `DATA_LAYER_OK`.

## Scope
These tools read NUMERIC PARAMETERS ONLY from the user's own copy. They never
copy art/audio/mesh/level binaries into the output tree, per project rules.
