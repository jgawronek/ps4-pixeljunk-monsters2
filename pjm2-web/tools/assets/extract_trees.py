#!/usr/bin/env python3
"""
extract_trees.py — PixelJunk Monsters 2 (PS4) NatureTree visual asset extractor.

Extracts the REAL tree visuals from the user's own `nature` bundle for BOTH
stage species (3d_stage_001 scene.json: 425 active tree_001 + 32 active
tree_002 anchors):
  logic prefab tree_001 (NatureTree MB pid -7999508030866578251)
    -> PrefabLoader.prefabRandomList = [tree_001_1_pa, tree_001_2_pa,
                                        tree_001_3_pa, tree_001_4_pa]
  logic prefab tree_002 (NatureTree MB pid 8006127797388548711)
    -> PrefabLoader.prefabRandomList = [tree_002_1_pa, tree_002_2_pa,
                                        tree_002_3_pa, tree_002_4_pa]
  Each visual prefab: tree_XXX_N (Animator + LODGroup) -> LOD0..LOD3 static
  MeshFilter/MeshRenderer children + vfx_pv (BirdEmitter, no mesh).
  tree_001 LOD0 = 849 verts / 1480 tris per variant; the four variants SHARE
  the same geometry + normals (verified: identical position hashes) and differ
  ONLY in UV0 — each samples a different quadrant of the shared tree_001_Color
  atlas. tree_002 LOD0 = 1843 verts for variants 1-3 (shared geometry, UV0
  quadrants of tree_002_Color) and 5075 verts for variant 4 (a DISTINCT mesh
  shape, slightly larger bounds). A per-species UV0 audit (source mesh AND
  exported GLB accessor hashes) verifies the variants stay visually distinct;
  collapsed UVs abort the run.

Outputs (browser-ready, public/assets/trees/):
  tree_001_<N>.glb           LOD0 static mesh + full transform hierarchy +
  tree_002_<N>.glb           material referencing shared PNGs (mirror baked)
  textures/<tex>__<pid>.png  albedo sRGB-encoded when source is linear
                             (m_ColorSpace=1), data maps stay linear;
                             downscaled to --web-size (default 1024)
  textures_webp/<...>.webp   WebP repack of every texture (+ `_ok` sentinel);
                             TreeView.load rewrites PNG URIs to these when the
                             sentinel is present (PickupView/CharacterLibrary
                             pattern)
  manifest.json              {species:{tree_001:{variantChoice,natureTree,
                             wind,...}, tree_002:{...}}, variants:[{name,
                             species, file, textures, clips, bounds, uv0,
                             vertexCount, ...}]} — variants stay a FLAT list
                             (legacy loader shape); each entry carries its
                             species so TreeView.load can group them.

Scratch (not shipped): pjm2-web/.work/trees/<name>/components.json

VARIANT CHOICE (decomp = DATA):
  Q4.PrefabLoader.Awake @0x7470F0 / InstantiateAll @0x747220: prefabList is
  empty on BOTH logic prefabs; ONE prefab is instantiated from
  prefabRandomList at index prefabRandomIndex (serialized -1 ->
  UnityEngine.Random.Range(0, count)). The port replaces the random pick with
  a deterministic hash of the sim tree handle (TreeView.stableVariant) — no
  Math.random.

ANIMATION (verified ZERO clips):
  - No AnimationClip in the nature bundle matches tree* (bundle-wide scan).
  - The visual Animator has a NULL controller (m_Controller path_id 0); the
    avatar (tree_XXX_NAvatar) is rig metadata only.
  Tree motion is CODE-DRIVEN (Q4.NatureTree, decomp/decompiled/):
  - TreeFall: OnTowerBuild @0x64A680 starts <TreeFall>c__Iterator0
    (@0x64B270): WaitForSeconds(Random.Range(0, 0.25) [DAT_00b7e72c]), then
    over fallDuration sinks the transform by fallHeight, rotates
    AngleAxis(-angle, Cross(direction, up)) up to fallAngle over
    fallRotateDuration, shrinks localScale toward fallScale; when
    Distance(origin, current) >= fallHeight -> SetActive(false) and RESTORE
    origin position/rotation/scale. The runtime direction is
    treePos - towerPos; when it is ZERO the original picks a random XZ angle
    Random.Range(0, DAT_00b7e730 = pi, CONFIRMED from ELF rodata) ->
    (cos, 0, sin) — a HALF-circle of directions (faithful quirk).
  - TreeRise: OnTreeRevive @0x64A490 starts <TreeRise>c__Iterator1
    (@0x64B770): SetActive(true), localScale=0, WaitForSeconds(index*0.05
    [DAT_00b7e738]), then linear regrow to the saved scale over 0.1s
    (0x3DCCCCCD immediate / DAT_00b7e734), exact restore + shader bump.
  - Idle sway is a VERTEX SHADER wind (materials tree_001_m / tree_002_m
    floats _MainWindSpeed/_MainWindFrequency/_MainWindStrength + noise layer)
    and a contact shake (_ShakeDirection/_ShakeStartTime set by
    SetBumpShaderParameters @0x649B20 via MaterialPropertyBlock on the
    LODGroup renderers; ctor seeds _ShakeStartTime = DAT_00b7e720 = -100).
    Not representable as glTF clips; manifest.species.<s>.wind records the
    constants and TreeView reproduces the wind with an onBeforeCompile
    vertex-shader patch (contact shake is not reproduced).
  Fall constants below are the SERIALIZED values on each species' NatureTree
  component (they match the ctor defaults: DAT_00b7e7d0 = 0.5/0.5,
  _UNK_00b7e7d8 = 0.5/75, fallScale immediate 0x3E800000 = 0.25).
  FAITHFUL QUIRK: tree_002's serialized towerDirection is (0,0,0) (tree_001's
  is (-0.41066, 0, -0.91179)); the runtime fall direction comes from the
  tower position anyway (see above).

Pipeline reuse (established pattern — see extract_pickups.py):
  imports extract_character as ec (Bundle/walk_tree/component_inventory/
  mirror math) and extract_all_characters as eac (WebWriter/
  export_character_glb/validate_glb/srgb_encode), both unmodified.

Bundle keying discipline: textures dedup by (assets_file.name, path_id).
The nature bundle packs a SINGLE serialized file
(CAB-5d3f32cf1644103815ef51026903b606), so path_id collisions across files
cannot occur here; duplicate GameObject NAMES do exist (standalone model
prefabs vs the _pa hierarchies) — variants are resolved by walking the _pa
roots, never by bare name lookup of mesh nodes.

COORDINATE CONVENTION (identical to the character/pickup pipeline):
  Unity LH Y-up -> glTF RH Y-up: mirror X on positions/normals/translations,
  quaternion (x,y,z,w) -> (x,-y,-z,w), winding (a,b,c) -> (a,c,b), UV v -> 1-v.
  GLBs load in three.js NATIVE space; the view mirrors sim POSITIONS only.

Usage:
  /srv/opencode/venv-unity/bin/python tools/assets/extract_trees.py [--force]
      [--variants 4] [--web-size 1024]
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from UnityPy.helpers.MeshHelper import MeshHandler  # noqa: E402
import extract_character as ec  # noqa: E402  (spike module — reused, unmodified)
import extract_all_characters as eac  # noqa: E402  (scale pipeline — reused, unmodified)

ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
BUNDLES = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'pjm2-web/public/assets/trees')
WORK = os.path.join(ROOT, 'pjm2-web/.work/trees')

ALBEDO_SLOTS = {'_MainTex'}
# Both stage species (scene.json node-name prefixes; game.ts maps each tree
# anchor's species to TreeView.addTree(..., species)).
SPECIES = ('tree_001', 'tree_002')


def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, 'run.log'), 'a') as f:
        f.write(line + '\n')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------- textures ----

class TreeTextureStore:
    """Like eac.TextureStore but flat under trees/ (GLBs sit at the root, so
    material URIs are `textures/<...>.png`, no `../`). Dedup by
    (assets_file.name, path_id); downscale to web_size; PNG + WebP repack +
    `_ok` sentinel for the loader's URL rewrite (PickupView pattern)."""

    def __init__(self, web_size):
        self.web_size = web_size
        self.recs = {}
        os.makedirs(os.path.join(OUT, 'textures'), exist_ok=True)
        os.makedirs(os.path.join(OUT, 'textures_webp'), exist_ok=True)

    def export(self, b, tpid, slot, mat_name):
        t = b.idx[tpid].read()
        key = (b.idx[tpid].assets_file.name, tpid)
        if key in self.recs:
            rec = self.recs[key]
            rec['usedBy'].append({'material': mat_name, 'slot': slot})
            return rec
        tt = b.idx[tpid].read_typetree()
        fmt = tt.get('m_TextureFormat')
        cs = tt.get('m_ColorSpace')
        rec = {'textureName': t.m_Name, 'pathId': tpid,
               'assetsFile': b.idx[tpid].assets_file.name,
               'width': t.m_Width, 'height': t.m_Height,
               'sourceFormat': fmt, 'sourceFormatName': ec.TEX_FORMAT_NAMES.get(fmt, str(fmt)),
               'sourceColorSpace': 'linear' if cs == 1 else 'srgb',
               'usedBy': [{'material': mat_name, 'slot': slot}]}
        base = f'{t.m_Name}__{tpid}'
        try:
            img = t.image.convert('RGBA')
            w, h = img.size
            scale = min(1.0, self.web_size / max(w, h)) if self.web_size > 0 else 1.0
            web_img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                                 Image.LANCZOS) if scale < 1 else img
            converted = slot in ALBEDO_SLOTS and cs == 1
            if converted:
                arr = np.asarray(web_img).copy()
                arr[..., :3] = eac.srgb_encode(arr[..., :3])
                web_img = Image.fromarray(arr, 'RGBA')
            png = os.path.join(OUT, 'textures', base + '.png')
            web_img.save(png)
            webp = os.path.join(OUT, 'textures_webp', base + '.webp')
            web_img.save(webp, 'WEBP', quality=90, method=6)
            rec['file'] = 'textures/' + base + '.png'
            rec['webpFile'] = 'textures_webp/' + base + '.webp'
            rec['webWidth'], rec['webHeight'] = web_img.size
            rec['pngBytes'] = os.path.getsize(png)
            rec['webpBytes'] = os.path.getsize(webp)
            rec['colorSpace'] = 'srgb' if converted else 'linear'
            rec['convertedLinearToSrgb'] = converted
            arr = np.asarray(web_img)
            rec['meanRGBA'] = [round(float(x), 2) for x in arr.reshape(-1, 4).mean(axis=0)]
            if slot == '_BumpMap':
                rec['note'] = ('grayscale height/bump-style map (not tangent-space RGB); '
                               'not bound as glTF normalTexture (character pipeline policy)')
            if slot == '_MetallicGlossMap':
                rec['note'] = ('Unity metallic(R)/smoothness(A); glTF wants metallic(B)/roughness(G) '
                               '— factors used instead (character pipeline policy)')
        except Exception as e:
            rec['error'] = f'{type(e).__name__}: {e}'
        self.recs[key] = rec
        return rec

    def write_sentinel(self):
        with open(os.path.join(OUT, 'textures_webp', '_ok'), 'w') as f:
            f.write('webp repack complete\n')


def build_tree_materials(b, mat_pids, texstore, w):
    """eac.build_materials with flat URIs (GLB at trees/ root, textures/ subdir).
    Binding policy identical: baseColor + occlusion + emission only; bump and
    metallic-gloss maps are manifest-only (channel layout mismatch)."""
    mat_index = {}
    for mp in mat_pids:
        if mp in mat_index:
            continue
        mt = b.tt(mp)
        props = mt.get('m_SavedProperties', {})
        floats = {k: v for k, v in props.get('m_Floats', [])}
        colors = {k: v for k, v in props.get('m_Colors', [])}
        gm = {'name': mt.get('m_Name') or f'mat_{mp}',
              'pbrMetallicRoughness': {
                  'baseColorFactor': [1, 1, 1, 1],
                  'metallicFactor': float(floats.get('_Metallic', 0.0)),
                  'roughnessFactor': float(1.0 - floats.get('_Glossiness', 0.5))}}
        c = colors.get('_Color')
        if c:
            gm['pbrMetallicRoughness']['baseColorFactor'] = [c['r'], c['g'], c['b'], c.get('a', 1)]
        mode = int(floats.get('_Mode', 0))
        if mode == 1:
            gm['alphaMode'] = 'MASK'
            gm['alphaCutoff'] = float(floats.get('_Cutoff', 0.5))
        elif mode >= 2:
            gm['alphaMode'] = 'BLEND'
        if floats.get('_Cull', 2) == 0:
            gm['doubleSided'] = True
        ec_col = colors.get('_EmissionColor')
        if ec_col:
            gm['emissiveFactor'] = [min(1.0, ec_col['r']), min(1.0, ec_col['g']), min(1.0, ec_col['b'])]
        for te in props.get('m_TexEnvs', []):
            slot, tp = te[0], te[1]
            tpid = ec.ref_pid(tp.get('m_Texture'))
            if not tpid or tpid not in b.idx:
                continue
            rec = texstore.export(b, tpid, slot, mt.get('m_Name'))
            if rec.get('error') or not rec.get('file'):
                continue
            uri = rec['file']
            if slot == '_MainTex':
                gm['pbrMetallicRoughness']['baseColorTexture'] = {'index': w.add_texture(uri)}
            elif slot == '_OcclusionMap':
                gm['occlusionTexture'] = {'index': w.add_texture(uri),
                                          'strength': float(floats.get('_OcclusionStrength', 1.0))}
            elif slot == '_EmissionMap':
                gm['emissiveTexture'] = {'index': w.add_texture(uri)}
        mat_index[mp] = len(w.materials)
        w.materials.append(gm)
    return mat_index


# -------------------------------------------------------------------- main ----

def mesh_bounds(b, mesh_pid):
    """Vertex min/max/size in glTF (mirrored) space; size is mirror-invariant
    and matches the serialized m_LocalAABB to float32 rounding."""
    mesh = b.idx[mesh_pid].read()
    h = MeshHandler(mesh)
    h.process()
    pos = np.nan_to_num(np.array(h.m_Vertices, dtype=np.float32))
    pos[:, 0] *= -1
    mn, mx = pos.min(axis=0), pos.max(axis=0)
    return {'min': mn.tolist(), 'max': mx.tolist(),
            'size': (mx - mn).tolist(), 'center': ((mx + mn) / 2).tolist(),
            'vertexCount': int(h.m_VertexCount)}


def mesh_uv0_audit(b, mesh_pid):
    """Source-mesh position/UV0 hashes + UV0 bounds (UNITY space, pre-mirror).
    Variants of one species share positions but MUST differ in UV0 (atlas
    quadrant) — the audit below aborts on collapsed UVs."""
    mesh = b.idx[mesh_pid].read()
    h = MeshHandler(mesh)
    h.process()
    pos = np.nan_to_num(np.array(h.m_Vertices, dtype=np.float32))
    uv = np.array(h.m_UV0, dtype=np.float32)
    return {'positionSha256': hashlib.sha256(pos.tobytes()).hexdigest(),
            'uv0Sha256': hashlib.sha256(uv.tobytes()).hexdigest(),
            'uv0Min': uv.min(axis=0).tolist(), 'uv0Max': uv.max(axis=0).tolist()}


def glb_uv0_sha(glb_path):
    """Hash the exported GLB's TEXCOORD_0 accessor bytes (first mesh, first
    primitive) — proves the per-variant UV0 survived the glTF write (mirror
    flips v, which preserves distinctness)."""
    data = open(glb_path, 'rb').read()
    off = 12
    js = None
    bin_chunk = None
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off)
        body = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body)
        elif ctype == 0x004E4942:
            bin_chunk = body
        off += 8 + clen
    prim = js['meshes'][0]['primitives'][0]
    a = js['accessors'][prim['attributes']['TEXCOORD_0']]
    assert a['componentType'] == 5126 and a['type'] == 'VEC2'
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 8)
    h = hashlib.sha256()
    for i in range(a['count']):
        h.update(bin_chunk[base + i * stride:base + i * stride + 8])
    return h.hexdigest()


def mesh_wind_weights(b, mesh_pid):
    """Per-vertex wind weight = Unity vertex COLOR.r (0..1).

    Nature/Plant/SolidTree's vertex program reads the color channel (shader
    channel map source 2 -> target 1; fetch regs v12..v15 -> v12 = .r) and
    multiplies it by saturate(position.y / 3) — see docs/TREE_SWAY_ANALYSIS.md.
    m_Colors is UNORM8 here (0..255). Returns float32[nv] in mesh vertex
    order (identical to the GLB POSITION order)."""
    mesh = b.idx[mesh_pid].read()
    h = MeshHandler(mesh)
    h.process()
    nv = int(h.m_VertexCount)
    if not h.m_Colors:
        raise RuntimeError(f'mesh {mesh.m_Name}: no vertex colors — SolidTree wind weight missing')
    col = np.array(h.m_Colors, dtype=np.float32)
    if col.shape[0] != nv:
        raise RuntimeError(f'mesh {mesh.m_Name}: color count {col.shape[0]} != vertex count {nv}')
    scale = 255.0 if col.max() > 1.0 else 1.0
    return np.ascontiguousarray((col[:, 0] / scale).astype('<f4'))


def patch_glb_wind_weight(glb_path, weights_per_mesh):
    """Add the custom per-vertex attribute `_WINDWEIGHT` (float SCALAR; three's
    GLTFLoader exposes it as geometry attribute `_windweight`) to every
    primitive of every glTF mesh. weights_per_mesh[i] belongs to glTF mesh i
    (one MeshFilter per LOD0 renderer, in export order). Idempotent: an
    existing `_WINDWEIGHT` accessor is replaced in place. Deliberately NOT
    COLOR_0 — GLTFLoader would turn that into material.vertexColors and tint
    the albedo red (the Unity shader uses .r ONLY as a wind weight)."""
    data = open(glb_path, 'rb').read()
    off, js, binc = 12, None, None
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off)
        body = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body)
        elif ctype == 0x004E4942:
            binc = bytearray(body)
        off += 8 + clen
    assert js is not None and binc is not None, glb_path
    if len(js['meshes']) != len(weights_per_mesh):
        raise RuntimeError(f'{glb_path}: {len(js["meshes"])} meshes vs {len(weights_per_mesh)} weight arrays')
    for mi, w in enumerate(weights_per_mesh):
        prims = js['meshes'][mi]['primitives']
        pos_count = js['accessors'][prims[0]['attributes']['POSITION']]['count']
        if pos_count != len(w):
            raise RuntimeError(f'{glb_path}: mesh {mi} has {pos_count} verts, {len(w)} weights')
        existing = prims[0]['attributes'].get('_WINDWEIGHT')
        raw = np.asarray(w, dtype='<f4').tobytes()
        if existing is not None:
            acc = js['accessors'][existing]
            bv = js['bufferViews'][acc['bufferView']]
            binc[bv['byteOffset']:bv['byteOffset'] + len(raw)] = raw
            continue
        while len(binc) % 4:
            binc.append(0)
        bv_idx = len(js['bufferViews'])
        js['bufferViews'].append({'buffer': 0, 'byteOffset': len(binc), 'byteLength': len(raw),
                                  'target': 34962})
        binc += raw
        acc_idx = len(js['accessors'])
        js['accessors'].append({'bufferView': bv_idx, 'componentType': 5126, 'count': len(w),
                                'type': 'SCALAR', 'min': [float(w.min())], 'max': [float(w.max())]})
        for p in prims:
            p['attributes']['_WINDWEIGHT'] = acc_idx
    while len(binc) % 4:
        binc.append(0)
    js['buffers'][0]['byteLength'] = len(binc)
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    while len(jb) % 4:
        jb += b' '
    out = bytearray(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binc)))
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(binc), 0x004E4942) + binc
    with open(glb_path, 'wb') as f:
        f.write(out)


def find_clips(b, visual_name):
    """Any AnimationClip in the bundle name-matched to the visual prefab.
    (Expected EMPTY: sway is shader wind, fall/rise are code coroutines,
    Animator controller is null.)"""
    prefix = visual_name.split('_')[0]  # 'tree'
    found = []
    for o in b.env.objects:
        if o.type.name != 'AnimationClip':
            continue
        try:
            n = o.read().m_Name
        except Exception:
            continue
        if n.startswith(prefix + '_') or n.startswith(prefix + '@') or n == prefix:
            found.append({'name': n, 'pathId': o.path_id, 'assetsFile': o.assets_file.name})
    return found


def resolve_logic(b, species):
    """<species> logic prefab -> (logic_pid, NatureTree MB pid, PrefabLoader
    pid, random-list pids). The logic GO name is unique in the nature bundle."""
    go = b.find_gameobject_by_name(species)
    if go is None:
        raise RuntimeError(f'{species} logic prefab not found in nature bundle')
    logic_pid = go.path_id
    nt_pid, pl_pid = None, None
    for c in b.tt(logic_pid)['m_Component']:
        cpid = ec.ref_pid(c['component'])
        r = b.idx[cpid]
        if r.type.name == 'MonoBehaviour':
            cls = b.comp_class(r)
            if cls == 'NatureTree':
                nt_pid = cpid
            elif cls == 'PrefabLoader':
                pl_pid = cpid
    if nt_pid is None or pl_pid is None:
        raise RuntimeError(f'{species}: NatureTree/PrefabLoader components missing')
    pl = b.tt(pl_pid)
    if pl.get('prefabList'):
        raise RuntimeError(f'{species}: unexpected non-empty prefabList (pipeline assumes random list)')
    random_pids = [ec.ref_pid(p) for p in pl.get('prefabRandomList') or []]
    if not random_pids:
        raise RuntimeError(f'{species}: empty prefabRandomList')
    return logic_pid, nt_pid, pl_pid, random_pids


def collect_wind(b, species):
    """Serialized <species>_m shader wind + contact-shake floats (DATA)."""
    mat_pid = None
    for o in b.env.objects:
        if o.type.name == 'Material':
            try:
                if o.read().m_Name == f'{species}_m':
                    mat_pid = o.path_id
                    break
            except Exception:
                pass
    wind = {}
    if mat_pid is not None:
        floats = dict(b.tt(mat_pid).get('m_SavedProperties', {}).get('m_Floats', []))
        wind = {k: floats[k] for k in ('_MainWindSpeed', '_MainWindFrequency', '_MainWindStrength',
                                       '_NoiseWindAngle', '_NoiseWindFrequency', '_NoiseWindSpeed',
                                       '_NoiseWindStrength', '_ShakeDuration', '_ShakeFrequency',
                                       '_ShakeStrength', '_NumShakes', '_CenterHeight')
                if k in floats}
        # _NoiseWindAngle/_CenterHeight/_ShakeFrequency are material floats the
        # compiled SolidTree vertex program never reads (not in its constant
        # buffer; constants 0.7071/45deg are hard-coded) — see TREE_SWAY_ANALYSIS.md.
        wind['materialPathId'] = mat_pid
        wind['note'] = ('vertex-shader wind + contact shake (SetBumpShaderParameters @0x649B20 '
                        'sets _ShakeDirection/_ShakeStartTime via MaterialPropertyBlock; ctor '
                        'seeds _ShakeStartTime=DAT_00b7e720=-100); NOT animation clips — '
                        'TreeView ports the Nature/Plant/SolidTree vertex program '
                        '(docs/TREE_SWAY_ANALYSIS.md) via onBeforeCompile; per-vertex weight '
                        '= mesh vertex color.r in the GLB attribute _WINDWEIGHT')
    return wind


def process_variant(b, visual_pid, texstore, species):
    visual_name = b.name_of(visual_pid)              # tree_XXX_N_pa
    name = visual_name[:-3] if visual_name.endswith('_pa') else visual_name
    t0 = time.time()
    work_dir = os.path.join(WORK, name)
    os.makedirs(work_dir, exist_ok=True)
    glb_path = os.path.join(OUT, f'{name}.glb')

    visual_inv = ec.component_inventory(b, visual_pid, 'visual')
    with open(os.path.join(work_dir, 'components.json'), 'w') as f:
        json.dump({'prefabName': species, 'visualPrefab': visual_name,
                   'visualPrefabInv': visual_inv,
                   'visualResolvedVia': 'PrefabLoader.prefabRandomList'}, f, indent=1, default=str)
    visual_nodes = visual_inv['nodes']

    # ---- LOD0 static MeshFilter + MeshRenderer only (demo LOD policy) ----
    renderers = []
    for n in visual_nodes:
        if not n['name'].endswith('_LOD0'):
            continue
        mf = next((c for c in n['components'] if c['type'] == 'MeshFilter'), None)
        mr = next((c for c in n['components'] if c['type'] == 'MeshRenderer'), None)
        if mf and mr:
            renderers.append({'kind': 'static', 'pid': mf['path_id'], 'node': n['name'],
                              'rendererPid': mr['path_id']})
    if not renderers:
        raise RuntimeError(f'{name}: no LOD0 MeshFilter+MeshRenderer in {visual_name}')
    mat_pids = []
    for rd in renderers:
        for m in b.tt(rd['rendererPid']).get('m_Materials', []):
            mp = ec.ref_pid(m)
            if mp and mp not in mat_pids:
                mat_pids.append(mp)

    # ---- Animator audit (controller expected null -> no clips to bake) ----
    animator_info = None
    for n in visual_nodes:
        for c in n['components']:
            if c['type'] == 'Animator':
                at = b.tt(c['path_id'])
                animator_info = {'node': n['name'],
                                 'controllerPathId': ec.ref_pid(at.get('m_Controller')),
                                 'controller': b.name_of(ec.ref_pid(at.get('m_Controller'))),
                                 'avatar': b.name_of(ec.ref_pid(at.get('m_Avatar')))}

    # ---- GLB (mirror baked in, same as characters/pickups) ----
    w = eac.WebWriter()
    mat_index = build_tree_materials(b, mat_pids, texstore, w)
    glb_stats, _ = eac.export_character_glb(
        b, 'nature', visual_nodes, renderers, mat_index, w,
        generator='pjm2-web extract_trees.py (UnityPy + hand-rolled glTF)')
    data, _j = w.finish([0], generator='pjm2-web extract_trees.py')
    with open(glb_path, 'wb') as f:
        f.write(data)
    # Wind weight (Unity vertex color.r) as custom attribute _WINDWEIGHT —
    # the SolidTree vertex program multiplies displacement by it.
    patch_glb_wind_weight(glb_path, [mesh_wind_weights(b, m['meshPathId']) for m in glb_stats['meshes']])

    # ---- clips (expected none) + bounds + UV0 audit ----
    clips = find_clips(b, visual_name)
    mesh_pid = ec.ref_pid(b.tt(renderers[0]['pid']).get('m_Mesh'))
    bounds = mesh_bounds(b, mesh_pid)
    uv0 = mesh_uv0_audit(b, mesh_pid)
    uv0['glbUv0Sha256'] = glb_uv0_sha(glb_path)

    # ---- validate (trimesh reload; one geometry per primitive) ----
    trimesh_verts = sum(m['vertices'] * m['submeshes'] for m in glb_stats['meshes'])
    verrs, vinfo = eac.validate_glb(glb_path, {'clips': len(clips), 'vertices': trimesh_verts})

    # ---- textures used by this variant ----
    tex_recs = []
    seen = set()
    for mp in mat_pids:
        for te in b.tt(mp).get('m_SavedProperties', {}).get('m_TexEnvs', []):
            tpid = ec.ref_pid(te[1].get('m_Texture'))
            if not tpid or tpid in seen:
                continue
            key = (b.idx[tpid].assets_file.name, tpid) if tpid in b.idx else None
            if key and key in texstore.recs:
                seen.add(tpid)
                r2 = texstore.recs[key]
                tex_recs.append({k: r2[k] for k in ('textureName', 'pathId', 'assetsFile', 'file',
                                                    'webpFile', 'colorSpace', 'sourceColorSpace',
                                                    'convertedLinearToSrgb', 'width', 'height',
                                                    'webWidth', 'webHeight', 'pngBytes', 'webpBytes',
                                                    'sourceFormat', 'sourceFormatName', 'meanRGBA',
                                                    'note', 'error')
                                 if k in r2} | {'slots': sorted({u['slot'] for u in r2['usedBy']})})

    entry = {
        'name': name,
        'species': species,
        'file': f'{name}.glb',
        'glbBytes': os.path.getsize(glb_path),
        'glbSha256': sha256(glb_path),
        'textures': tex_recs,
        'clips': clips,
        'bounds': bounds,
        'uv0': uv0,
        'vertexCount': sum(m['vertices'] for m in glb_stats['meshes']),
        'triangleCount': sum(m['triangles'] for m in glb_stats['meshes']),
        'animator': animator_info,
        'source': {
            'bundle': 'nature',
            'logicPrefab': species,
            'visualPrefab': visual_name,
            'pathIds': {'visualPrefab': visual_pid,
                        'meshes': [m['meshPathId'] for m in glb_stats['meshes']],
                        'materials': mat_pids},
            'assetsFile': b.idx[visual_pid].assets_file.name,
        },
        'glbWarnings': glb_stats['warnings'],
        'validation': {'errors': verrs, **vinfo},
        'extractSeconds': round(time.time() - t0, 2),
    }
    log(f'  {name}: {entry["vertexCount"]} verts / {entry["triangleCount"]} tris / '
        f'{len(tex_recs)} tex / {len(clips)} clips / {entry["glbBytes"]} bytes '
        f'{"VALID" if not verrs else "WARN:" + str(verrs)} [{time.time()-t0:.1f}s]')
    return entry


def audit_uv0_diversity(species, entries):
    """Verify the exported variants of one species have DISTINCT UV0 (both in
    the source meshes and in the exported GLB accessors). Collapsed UVs would
    render every tree identically — abort loudly instead of shipping that."""
    src = {e['name']: e['uv0']['uv0Sha256'] for e in entries}
    glb = {e['name']: e['uv0']['glbUv0Sha256'] for e in entries}
    if len(set(src.values())) != len(entries) or len(set(glb.values())) != len(entries):
        raise RuntimeError(f'{species}: variant UV0 collapsed (identical atlas regions) — '
                           f'source={src} glb={glb}; fix the exporter to preserve per-variant UV0')
    pos = {e['uv0']['positionSha256'] for e in entries}
    return {'perVariant': {e['name']: {'uv0Sha256': e['uv0']['uv0Sha256'],
                                       'glbUv0Sha256': e['uv0']['glbUv0Sha256'],
                                       'uv0Min': e['uv0']['uv0Min'], 'uv0Max': e['uv0']['uv0Max']}
                           for e in entries},
            'uv0Distinct': True,
            'sharedPositions': len(pos) == 1,
            'note': 'UV0 hashes pairwise distinct in source AND exported GLB TEXCOORD_0; '
                    'variants sample different regions of the shared color atlas'}


def wind_only():
    """Patch `_WINDWEIGHT` into the already-exported GLBs and refresh the
    manifest's glbBytes/glbSha256 (everything else in the GLBs is untouched)."""
    b = ec.Bundle(os.path.join(BUNDLES, 'nature'))
    mpath = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(mpath))
    for e in manifest['variants']:
        glb = os.path.join(OUT, e['file'])
        pids = e['source']['pathIds']['meshes']
        ws = [mesh_wind_weights(b, pid) for pid in pids]
        patch_glb_wind_weight(glb, ws)
        e['glbBytes'] = os.path.getsize(glb)
        e['glbSha256'] = sha256(glb)
        e['windWeight'] = {'attribute': '_WINDWEIGHT', 'source': 'mesh vertex color.r (UNORM8/255)',
                           'min': float(min(w.min() for w in ws)), 'max': float(max(w.max() for w in ws)),
                           'nonZero': int(sum((w > 0).sum() for w in ws))}
        log(f'  {e["name"]}: _WINDWEIGHT patched ({e["windWeight"]})')
    with open(mpath, 'w') as f:
        json.dump(manifest, f, indent=1)
    log('manifest.json refreshed (wind-only)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='re-extract even if outputs exist')
    ap.add_argument('--variants', type=int, default=4,
                    help='how many prefabRandomList variants to export per species '
                         '(default 4 = full list on both species)')
    ap.add_argument('--web-size', type=int, default=1024,
                    help='max texture edge for the web copies (0 = full res; default 1024)')
    ap.add_argument('--wind-only', action='store_true',
                    help='only add/refresh the _WINDWEIGHT attribute in the existing GLBs '
                         '(+ manifest sha/bytes); no texture/material re-extraction')
    args = ap.parse_args()
    t_start = time.time()
    os.makedirs(OUT, exist_ok=True)
    if args.wind_only:
        wind_only()
        return
    log(f'extract_trees.py START out={OUT} species={SPECIES} variants={args.variants} '
        f'web-size={args.web_size}')

    b = ec.Bundle(os.path.join(BUNDLES, 'nature'))
    log(f'nature bundle: {len(b.idx)} objects')

    texstore = TreeTextureStore(args.web_size)
    old = {}
    old_manifest = os.path.join(OUT, 'manifest.json')
    if os.path.exists(old_manifest):
        try:
            old = {e['name']: e for e in json.load(open(old_manifest)).get('variants', [])}
        except Exception:
            old = {}

    species_info = {}
    entries = []
    for species in SPECIES:
        logic_pid, nt_pid, pl_pid, random_pids = resolve_logic(b, species)
        random_names = [b.name_of(p) for p in random_pids]
        log(f'{species} logic pid={logic_pid}; NatureTree MB pid={nt_pid}; '
            f'prefabRandomList={random_names}')

        # ---- serialized NatureTree fall constants + shader wind (DATA) ----
        nt = b.tt(nt_pid)
        nature_tree = {
            'fallHeight': nt['fallHeight'],
            'fallDuration': nt['fallDuration'],
            'fallRotateDuration': nt['fallRotateDuration'],
            'fallAngle': nt['fallAngle'],
            'fallScale': nt['fallScale'],
            'towerDirection': nt['towerDirection'],
            'fallDelayRange': [0, 0.25],
            'riseScaleTime': 0.1,
            'riseDelayPerIndex': 0.05,
            'evidence': f'serialized NatureTree MB (nature bundle, {species}, pid {nt_pid}); ctor '
                        'defaults DAT_00b7e7d0=0.5/0.5, _UNK_00b7e7d8=0.5/75, '
                        'fallScale=0x3E800000=0.25; fall delay Random.Range(0,DAT_00b7e72c=0.25) '
                        '@OnTowerBuild 0x64A680; TreeRise wait index*DAT_00b7e738=0.05, scaleTime '
                        '0x3DCCCCCD=0.1 (<TreeFall>/<TreeRise> MoveNext @0x64B270/@0x64B770); '
                        'rodata read from Media/Modules/Il2CppUserAssemblies.elf',
        }
        td = nt['towerDirection']
        if td['x'] == 0 and td['y'] == 0 and td['z'] == 0:
            nature_tree['towerDirectionNote'] = (
                'FAITHFUL QUIRK: serialized towerDirection is ZERO on this species. '
                'OnTowerBuild @0x64A680 uses the runtime treePos-towerPos direction; when that '
                'is zero it picks Random.Range(0, DAT_00b7e730=pi) -> (cos,0,sin) — a '
                'HALF-circle of fall directions. TreeView uses a deterministic per-handle '
                'angle in the same range (TS ADAPTATION, no Math.random).')
        wind = collect_wind(b, species)

        sp_entries = []
        for vpid in random_pids[:max(1, args.variants)]:
            vname = b.name_of(vpid)
            name = vname[:-3] if vname.endswith('_pa') else vname
            prev = old.get(name)
            if (not args.force and prev is not None and prev.get('species') == species
                    and 'uv0' in prev and os.path.exists(os.path.join(OUT, f'{name}.glb'))):
                log(f'  {name}: exists, skipped (--force to re-extract)')
                sp_entries.append(prev)
                continue
            sp_entries.append(process_variant(b, vpid, texstore, species))
        audit = audit_uv0_diversity(species, sp_entries)
        log(f'  {species}: UV0 audit OK — {len(sp_entries)} distinct atlas regions '
            f'(sharedPositions={audit["sharedPositions"]})')
        entries.extend(sp_entries)

        species_info[species] = {
            'source': {'logicPrefab': species,
                       'logicPathId': logic_pid,
                       'natureTreeComponentPathId': nt_pid,
                       'prefabLoaderPathId': pl_pid},
            'variantChoice': {
                'prefabRandomList': random_names,
                'prefabRandomListPathIds': random_pids,
                'exported': [e['name'] for e in sp_entries],
                'serializedIndex': b.tt(pl_pid).get('prefabRandomIndex'),
                'geometryNote': ('variants share identical LOD0 positions/normals; they differ '
                                 'ONLY in UV0 — different regions of the shared '
                                 f'{species}_Color atlas' if audit['sharedPositions'] else
                                 'variants differ in UV0 atlas region; at least one variant also '
                                 'has distinct LOD0 geometry (see per-variant vertexCount/bounds)'),
                'uv0Audit': audit,
                'evidence': 'Q4.PrefabLoader.Awake @0x7470F0 + InstantiateAll @0x747220: '
                            'prefabRandomIndex<0 -> Random.Range(0,count); one random prefab '
                            'instantiated per tree anchor. Port: deterministic handle hash '
                            '(TreeView.stableVariant), no Math.random.',
            },
            'natureTree': nature_tree,
            'wind': wind,
        }
    texstore.write_sentinel()

    manifest = {
        'generatedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'generatedBy': 'pjm2-web/tools/assets/extract_trees.py',
        'source': {'bundle': os.path.join(BUNDLES, 'nature'),
                   'unityVersion': '.'.join(str(x) for x in (b.unity_version or ())[:3])},
        'coordinateConvention': 'glTF outputs mirrored Unity->glTF (X negated, winding/V flipped); '
                                'load in three native space, mirror sim positions x->-x only',
        'texturePolicy': 'baseColor (sRGB) + occlusion bound; bump/metallic-gloss manifest-only '
                         '(character pipeline policy). textures_webp/_ok sentinel enables the '
                         'loader PNG->WebP URL rewrite. Web copies downscaled to '
                         f'{args.web_size}px (0 = full res).',
        'animationPolicy': 'no clips (verified: zero tree* AnimationClips in the nature bundle; '
                           'Animator controller null). TreeFall/TreeRise are CODE-DRIVEN '
                           'coroutines (see species.<s>.natureTree constants + TreeView.ts); idle '
                           'sway is vertex-shader wind (see species.<s>.wind) reproduced by '
                           'TreeView via onBeforeCompile.',
        'species': species_info,
        'variants': entries,
    }
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    log(f'manifest.json written ({len(entries)} variants across {len(species_info)} species)')
    log(f'extract_trees.py DONE in {time.time()-t_start:.1f}s')


if __name__ == '__main__':
    main()
