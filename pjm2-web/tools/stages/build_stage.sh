#!/usr/bin/env bash
# build_stage.sh <3d_stage_NNN> -- full per-stage asset pipeline (user's own copy; not redistributed):
#   extract scene -> col0 vertex colours -> colliders -> WebP repack -> mesh pack/shuffle -> gzip.
# Idempotent per step. Run from pjm2-web/. Heavy: ~2-5 min and ~0.5GB scratch per stage.
set -euo pipefail
S="${1:?stage scene name e.g. 3d_stage_002}"
PY=/srv/opencode/venv-unity/bin/python
AB=../game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages
OUT=public/assets/stages/$S
mkdir -p .work/stage-multi
[ -f "$OUT/scene.json" ] || nice $PY -I tools/stages/extract_stage_scene.py "$S" --out "$OUT" --manifest ".work/stage-multi/manifest_$S.json"
nice $PY -I tools/stages/add_col0_channel.py "$AB" "$OUT"
if [ ! -f "$OUT/physics/${S}_colliders.json" ]; then
  nice $PY -I tools/colliders/extract_stage_colliders.py "$S" --out "$OUT/physics"
fi
nice node .work/repack-textures.mjs "$OUT"
python3 tools/stages/pack_mesh_bins.py "$OUT"
python3 tools/stages/shuffle_mesh_pack.py "$OUT"
python3 tools/stages/compress_assets.py "$OUT"
python3 tools/stages/install_stage_sky.py "$S"
nice $PY -I tools/stages/extract_reflection_probe.py "$S"   # baked HDR ReflectionProbe -> probe/reflection_probe.{f16.bin,json}
du -sh "$OUT"
