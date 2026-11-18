#!/usr/bin/env python3
"""
extract_all_characters.py — scale the extract_character.py spike to the full
PixelJunk Monsters 2 (PS4, CUSA11967) enemy + tower roster.

Outputs (browser-ready):
  pjm2-web/public/assets/characters/<def>/<def>.glb
      mesh(es) + skin(s) + full transform hierarchy + materials referencing
      shared PNGs + ALL animation clips baked to uniform 30 Hz glTF tracks.
  pjm2-web/public/assets/characters/_textures/<tex>__<pid>.png
      deduplicated across characters, downscaled to --web-size (default 1024).
      Albedo (_MainTex, m_ColorSpace=1 == sRGB in Unity) is written UNCHANGED (bytes are already sRGB; three.js
      SRGBColorSpace). An earlier version sRGB-encoded it a second time (washed-out colours) — see
      docs/ORIGINAL_CHARACTER_RENDERING_FACTS.md. _BumpMap is DXT5nm (X in A, Y in G): exported as a tangent-space
      RGB normal map. _MetallicGlossMap (R metallic, A smoothness) is exported as a glTF metallic-roughness map
      (G = 1 - smoothness, B = metallic). _OcclusionMap with m_ColorSpace=1 is sRGB-DECODED (Unity's hardware decode
      when sampling an sRGB-flagged texture in linear colour space). Other data maps stay linear.
  decomp/data/character_asset_manifest.json  (+ copy next to the GLBs)

Scratch / lossless sources (not shipped):
  pjm2-web/.work/asset-scale/<def>/{components,clips,glb_stats,result}.json
      clips.json keeps RAW Unity values AND cubic coefficients (lossless).
  pjm2-web/.work/asset-scale/textures-full/<tex>__<pid>.png  (full-res, linear)

Generalizations over the spike (extract_character.py, imported as `ec`):
  - logic prefab disambiguated by EnemyBase/TowerBase component path_id matched
    against decomp/data JSON (duplicate GameObject names exist in the bundles).
  - multi-SMR / static MeshFilter visuals supported; per-submesh materials.
  - multiple Animators per visual (e.g. tower flag_pos) each get their own
    CRC32 path map and baked clips.
  - animation bake evaluates the TRUE cubic segment polynomial recovered from
    StreamedClip coefficients: v(dt) = c0*dt^3 + c1*dt^2 + c2*dt + c3
    (verified against key values), sampled at 30 Hz; constant channels emitted
    as 2-key tracks. Unresolved CRC32 bindings are counted and reported, never
    silently dropped.

Coordinate convention: identical to the spike (mirror X, flip winding/V,
quaternion (x,-y,-z,w), matrices S*M*S). Baked glTF tracks are already mirrored;
clips.json scratch stays raw Unity.

Usage:
  /srv/opencode/venv-unity/bin/python extract_all_characters.py [--stage1]
      [--only def1,def2] [--role enemy|tower|all] [--force] [--web-size 1024]
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import time
import traceback
import zlib
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from UnityPy.helpers.MeshHelper import MeshHandler  # noqa: E402
import extract_character as ec  # noqa: E402  (spike module — reused, unmodified)

ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
BUNDLES = os.path.join(ROOT, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
OUT = os.path.join(ROOT, 'pjm2-web/public/assets/characters')
WORK = os.path.join(ROOT, 'pjm2-web/.work/asset-scale')
MANIFEST = os.path.join(ROOT, 'decomp/data/character_asset_manifest.json')
# Optional redirect of the manifest WRITE (prior entries are still merged from MANIFEST),
# for runs that must not touch files outside pjm2-web/.
MANIFEST_OUT = os.environ.get('PJM2_MANIFEST_OUT', MANIFEST)

STAGE1 = {'kuri_00_001', 'boss_bero_00', 'tower_001', 'tower_006', 'tower_007', 'tower_011'}
FPS = 30.0
ALBEDO_SLOTS = {'_MainTex'}

RUN_LOG = os.path.join(WORK, 'run.log')


def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    os.makedirs(WORK, exist_ok=True)
    with open(RUN_LOG, 'a') as f:
        f.write(line + '\n')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ----------------------------------------------------------------- roster ----

def load_roster():
    enemies = json.load(open(os.path.join(ROOT, 'decomp/data/enemy_roster.json')))
    eb = json.load(open(os.path.join(ROOT, 'decomp/data/enemies_EnemyBase.json')))
    towers = json.load(open(os.path.join(ROOT, 'decomp/data/structures_TowerBase.json')))
    defs = []
    for name in sorted(enemies):
        defs.append({'defName': name, 'role': 'enemy', 'bundle': 'enemies',
                     'baseClass': 'EnemyBase', 'basePids': {r['__path_id'] for r in eb},
                     'stage1': name in STAGE1})
    for t in towers:
        name = t['__gameObject']
        defs.append({'defName': name, 'role': 'tower', 'bundle': 'structures',
                     'baseClass': 'TowerBase', 'basePids': {t['__path_id']},
                     'stage1': name in STAGE1, 'towerBase': {
                         k: t[k] for k in ('costCoin', 'costGem', 'classType', 'attackType',
                                           'dlcLock', 'towerName', 'fortJointNameHorizontal',
                                           'fortJointNameVertical') if k in t}})
    # Player: tikiman_01 logic prefab in globalsettings (Player MB pid
    # 2514285418080110840) → PrefabLoader → tikiman_01_pa visual
    # (tikiman_01_comp SMR LOD0-3 + Animator with the full tikiman_* set).
    defs.append({'defName': 'tikiman_01', 'role': 'player', 'bundle': 'globalsettings',
                 'baseClass': 'Player', 'basePids': {2514285418080110840},
                 'stage1': True})
    # Chibi (home villager): chibi_00 logic prefab in stages (Chibi MB pid
    # 2479 in 3d_stage_004_env.sharedAssets) → PrefabLoader → chibi_00_pa
    # visual (chibi_00_comp SMR LOD0-3 + Animator, chibi_ctrl).
    defs.append({'defName': 'chibi_00', 'role': 'chibi', 'bundle': 'stages',
                 'preferFile': '3d_stage_004_env.sharedAssets',
                 'baseClass': 'Chibi', 'basePids': {2479},
                 'stage1': True})
    # Player cosmetic parts: PlayerAvatarDecorator (Q4, SetInternal @0x3EC230)
    # instantiates the equipped mask/carapace (shell) prefab and parents it to
    # the player. The tikiman_01 body mesh has NO shell/face. Defaults come from
    # ClothingUnlockData (globalsettings): MaskDefinitions.m_defaultItem.prefab
    # (mask_00_pa) and CarapaceDefinitions.m_defaultItem.prefab (carapace_00_pa).
    # See docs/PLAYER_SHELL_ANALYSIS.md. Pose is driven at runtime (bone copy), so
    # no animation is baked.
    defs.append({'defName': 'carapace_00', 'role': 'player-part', 'bundle': 'globalsettings',
                 'baseClass': None, 'basePids': set(), 'visualPid': 8144356912889441074,
                 'stage1': True})
    defs.append({'defName': 'mask_00', 'role': 'player-part', 'bundle': 'globalsettings',
                 'baseClass': None, 'basePids': set(), 'visualPid': -7835467561352950186,
                 'stage1': True})
    # Tower level flags: TowerUpgrade.flagPrefab (level 2..5) instantiated on the tower's `flag_pos` node by
    # TowerBase.CoroutineDecorateFlag. Static skinned banner (the wave is the Flag/FlagWave vertex shader), so no clips are baked.
    for lvl, pid in ((2, 5088384819505837652), (3, -6528921509254407661), (4, -5421328749145731145), (5, -6289381480930986628)):
        defs.append({'defName': f'flag_001_{lvl}', 'role': 'player-part', 'bundle': 'structures',
                     'baseClass': None, 'basePids': set(), 'visualPid': pid, 'stage1': True})
    return defs


class BundleCache:
    def __init__(self):
        self.bundles = {}
        self.go_index = {}
        self.pathcrc = {}

    def get(self, name, prefer_file=None):
        key = (name, prefer_file)
        if key not in self.bundles:
            t0 = time.time()
            b = ec.Bundle(os.path.join(BUNDLES, name), prefer_file=prefer_file)
            idx = defaultdict(list)
            for o in b.env.objects:
                if o.type.name == 'GameObject':
                    try:
                        idx[o.read().m_Name].append(o.path_id)
                    except Exception:
                        pass
            self.bundles[key] = b
            self.go_index[key] = idx
            log(f'bundle {name}: {len(b.idx)} objects ({time.time()-t0:.1f}s)')
        return self.bundles[key], self.go_index[key]

    def annotation_map(self, name):
        """Bundle-wide CRC32 -> path suffix index, used ONLY to annotate unresolved
        hashes with likely target names (never to bind across skeletons)."""
        if name not in self.pathcrc:
            t0 = time.time()
            b, _ = self.get(name)
            crc = {}
            for o in b.env.objects:
                if o.type.name != 'GameObject':
                    continue
                try:
                    nodes = ec.walk_tree(b, o)
                except Exception:
                    continue
                for n in nodes:
                    parts = n['path'].split('/')
                    for i in range(len(parts)):
                        s = '/'.join(parts[i:])
                        crc.setdefault(zlib.crc32(s.encode()), s)
            self.pathcrc[name] = crc
            log(f'bundle {name}: path-CRC annotation index {len(crc)} entries ({time.time()-t0:.1f}s)')
        return self.pathcrc[name]


def resolve_logic(b, gos, d):
    """Pick the logic prefab GO: base component path_id must match decomp JSON."""
    cands = gos.get(d['defName'], [])
    scored = []
    for pid in cands:
        tt = b.tt(pid)
        base_pid, pl = None, []
        for c in tt['m_Component']:
            cpid = ec.ref_pid(c['component'])
            r = b.idx[cpid]
            if r.type.name == 'MonoBehaviour':
                cls = b.comp_class(r)
                if cls == d['baseClass']:
                    base_pid = cpid
                elif cls == 'PrefabLoader':
                    pl = b.tt(cpid).get('prefabList') or []
        score = (base_pid in d['basePids'] if base_pid else False, bool(pl))
        scored.append((score, pid, base_pid, pl))
    scored.sort(key=lambda x: x[0], reverse=True)
    if not scored:
        raise RuntimeError(f'no GameObject named {d["defName"]}')
    score, pid, base_pid, pl = scored[0]
    if not score[0]:
        raise RuntimeError(f'{d["defName"]}: no {d["baseClass"]} matching decomp path_id '
                           f'(candidates={cands})')
    visual_pid = ec.ref_pid(pl[0]) if pl else pid
    return pid, base_pid, visual_pid, len(cands)


# --------------------------------------------------------------- textures ----

def srgb_decode(arr_u8):
    """sRGB byte -> linear byte (what the GPU does when sampling an sRGB-flagged texture)."""
    x = arr_u8.astype(np.float32) / 255.0
    y = np.where(x <= 0.04045, x / 12.92, np.power((np.maximum(x, 0) + 0.055) / 1.055, 2.4))
    return np.clip(np.round(y * 255.0), 0, 255).astype(np.uint8)


def srgb_encode(arr_u8):
    x = arr_u8.astype(np.float32) / 255.0
    y = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)
    return np.clip(np.round(y * 255.0), 0, 255).astype(np.uint8)


class TextureStore:
    """Dedup textures by (bundle, path_id); full-res linear scratch + web PNG."""

    def __init__(self, web_size):
        self.web_size = web_size
        self.recs = {}
        os.makedirs(os.path.join(WORK, 'textures-full'), exist_ok=True)
        os.makedirs(os.path.join(OUT, '_textures'), exist_ok=True)

    def export(self, b, bundle_name, tpid, slot, mat_name):
        key = (bundle_name, tpid)
        if key in self.recs:
            rec = self.recs[key]
            rec['usedBy'].append({'material': mat_name, 'slot': slot})
            return rec
        t = b.idx[tpid].read()
        tt = b.idx[tpid].read_typetree()
        fmt = tt.get('m_TextureFormat')
        cs = tt.get('m_ColorSpace')
        rec = {'textureName': t.m_Name, 'pathId': tpid, 'bundle': bundle_name,
               'width': t.m_Width, 'height': t.m_Height,
               'sourceFormat': fmt, 'sourceFormatName': ec.TEX_FORMAT_NAMES.get(fmt, str(fmt)),
               'mipCount': tt.get('m_MipCount'), 'sourceColorSpace': 'srgb' if cs == 1 else 'linear',
               'usedBy': [{'material': mat_name, 'slot': slot}]}
        base = f'{t.m_Name}__{tpid}'
        try:
            img = t.image.convert('RGBA')
            full = os.path.join(WORK, 'textures-full', base + '.png')
            if not os.path.exists(full):
                img.save(full)
            rec['fullRes'] = os.path.relpath(full, ROOT)
            rec['fullResBytes'] = os.path.getsize(full)
            # web copy: downscale + albedo linear->sRGB
            w, h = img.size
            scale = min(1.0, self.web_size / max(w, h))
            web_img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                                 Image.LANCZOS) if scale < 1 else img
            converted = False  # albedo bytes are already sRGB (Unity m_ColorSpace=1): NEVER re-encode
            arr = np.asarray(web_img).copy()
            if slot == '_BumpMap':
                # DXT5nm: X in A, Y in G; Z reconstructed (Unity UnpackNormalDXT5nm), _BumpScale applied in the material.
                x = arr[..., 3].astype(np.float32) / 255.0 * 2.0 - 1.0
                y = arr[..., 1].astype(np.float32) / 255.0 * 2.0 - 1.0
                z = np.sqrt(np.clip(1.0 - x * x - y * y, 0.0, 1.0))
                out = np.stack([x, y, z], axis=-1) * 0.5 + 0.5
                arr = np.dstack([np.clip(np.round(out * 255.0), 0, 255).astype(np.uint8),
                                 np.full(x.shape, 255, np.uint8)])
                web_img = Image.fromarray(arr, 'RGBA')
                rec['note'] = 'DXT5nm decoded to tangent-space RGB (x=A, y=G, z reconstructed); glTF normalTexture'
            elif slot == '_MetallicGlossMap':
                metal = srgb_decode(arr[..., 0]) if cs == 1 else arr[..., 0]
                rough = 255 - arr[..., 3]                    # smoothness (A) -> roughness (G); _GlossMapScale applied via factors
                arr = np.dstack([np.full(rough.shape, 255, np.uint8), rough, metal, np.full(rough.shape, 255, np.uint8)])
                web_img = Image.fromarray(arr, 'RGBA')
                rec['note'] = 'Unity metallic(R)/smoothness(A) -> glTF metallicRoughness (G=1-smoothness, B=metallic)'
            elif slot == '_OcclusionMap' and cs == 1:
                arr[..., :3] = srgb_decode(arr[..., :3])
                web_img = Image.fromarray(arr, 'RGBA')
                rec['note'] = 'sRGB-flagged occlusion map decoded to linear (Unity samples it through the sRGB hardware decode)'
            web = os.path.join(OUT, '_textures', base + '.png')
            web_img.save(web)
            rec['file'] = '_textures/' + base + '.png'
            rec['webWidth'], rec['webHeight'] = web_img.size
            rec['webBytes'] = os.path.getsize(web)
            rec['colorSpace'] = 'srgb' if slot in ALBEDO_SLOTS or slot == '_EmissionMap' else 'linear'
            rec['convertedLinearToSrgb'] = converted
        except Exception as e:
            rec['error'] = f'{type(e).__name__}: {e}'
        self.recs[key] = rec
        return rec


# ------------------------------------------------------------------ writer ----

class WebWriter(ec.GltfWriter):
    def __init__(self):
        super().__init__()
        self.materials = []
        self.images = []
        self.textures = []
        self.samplers = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
        self.animations = []

    def add_image(self, uri):
        for i, im in enumerate(self.images):
            if im['uri'] == uri:
                return i
        self.images.append({'uri': uri})
        return len(self.images) - 1

    def add_texture(self, uri):
        idx = self.add_image(uri)
        for i, tx in enumerate(self.textures):
            if tx.get('source') == idx:
                return i
        self.textures.append({'sampler': 0, 'source': idx})
        return len(self.textures) - 1

    def finish(self, root_node_indices, generator):
        j = {'asset': {'version': '2.0', 'generator': generator},
             'scene': 0, 'scenes': [{'nodes': root_node_indices}],
             'nodes': self.nodes}
        if self.materials:
            j['materials'] = self.materials
        if self.meshes:
            j['meshes'] = self.meshes
        if self.skins:
            j['skins'] = self.skins
        if self.images:
            j['images'] = self.images
            j['textures'] = self.textures
            j['samplers'] = self.samplers
        if self.animations:
            j['animations'] = self.animations
        j['buffers'] = [{'byteLength': len(self.bin)}]
        j['bufferViews'] = self.buffer_views
        j['accessors'] = self.accessors
        js = json.dumps(j, separators=(',', ':')).encode('utf-8')
        while len(js) % 4:
            js += b' '
        self._pad()
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        out = bytearray()
        out += struct.pack('<III', 0x46546C67, 2, total)
        out += struct.pack('<II', len(js), 0x4E4F534A) + js
        out += struct.pack('<II', len(self.bin), 0x004E4942) + self.bin
        return bytes(out), j


# ------------------------------------------------------------- glTF export ----

def euler_to_quat(x, y, z):
    """Unity Quaternion.Euler (degrees, ZXY order) -> (x,y,z,w)."""
    rx, ry, rz = np.radians([x, y, z]) / 2
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    # q = qY * qX * qZ
    qy = (0, sy, 0, cy); qx = (sx, 0, 0, cx); qz = (0, 0, sz, cz)
    return ec.q_mul(ec.q_mul(qy, qx), qz)


def build_materials(b, bundle_name, mat_pids, texstore, w):
    """Unity material -> glTF material index map."""
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
            rec = texstore.export(b, bundle_name, tpid, slot, mt.get('m_Name'))
            if rec.get('error') or not rec.get('file'):
                continue
            uri = '../' + rec['file']
            if slot == '_MainTex':
                gm['pbrMetallicRoughness']['baseColorTexture'] = {'index': w.add_texture(uri)}
            elif slot == '_OcclusionMap':
                gm['occlusionTexture'] = {'index': w.add_texture(uri),
                                          'strength': float(floats.get('_OcclusionStrength', 1.0))}
            elif slot == '_EmissionMap':
                gm['emissiveTexture'] = {'index': w.add_texture(uri)}
            elif slot == '_BumpMap':
                gm['normalTexture'] = {'index': w.add_texture(uri), 'scale': float(floats.get('_BumpScale', 1.0))}
            elif slot == '_MetallicGlossMap':
                # Standard with a metallic-gloss map: metallic = map.R, smoothness = map.A * _GlossMapScale (_Metallic / _Glossiness ignored)
                gm['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': w.add_texture(uri)}
                gm['pbrMetallicRoughness']['metallicFactor'] = 1.0
                gm['pbrMetallicRoughness']['roughnessFactor'] = 1.0
                gloss_scale = float(floats.get('_GlossMapScale', 1.0))
                if abs(gloss_scale - 1.0) > 1e-6:
                    gm.setdefault('extras', {})['glossMapScale'] = gloss_scale
        mat_index[mp] = len(w.materials)
        w.materials.append(gm)
    return mat_index


def export_character_glb(b, bundle_name, visual_nodes, renderers, mat_index, w, generator):
    """renderers: list of dicts {kind:'smr'|'static', pid, nodeIdx}. Adds meshes/skins."""
    node_by_transform_pid = {}
    gl_nodes = []
    child_lists = {}
    stack = []
    for n in visual_nodes:
        while stack and n['depth'] <= stack[-1][1]:
            stack.pop()
        parent = stack[-1][0] if stack else None
        stack.append((len(gl_nodes), n['depth']))
        p, r, s = n['localPosition'], n['localRotation'], n['localScale']
        gn = {'name': n['name'],
              'translation': [-p['x'], p['y'], p['z']],
              'rotation': [r['x'], -r['y'], -r['z'], r['w']],
              'scale': [s['x'], s['y'], s['z']]}
        gl_nodes.append(gn)
        node_by_transform_pid[n['transformPid']] = len(gl_nodes) - 1
        child_lists.setdefault(parent, []).append(len(gl_nodes) - 1)
    for parent, kids in child_lists.items():
        if parent is not None:
            gl_nodes[parent]['children'] = kids
    w.nodes = gl_nodes

    globs = ec.global_transforms(visual_nodes)
    stats = {'meshes': [], 'warnings': []}
    used_go = set()
    for rd in renderers:
        tt = b.tt(rd['pid'])
        mesh_pid = ec.ref_pid(tt.get('m_Mesh'))
        if not mesh_pid or mesh_pid not in b.idx:
            stats['warnings'].append(f'renderer {rd["pid"]}: missing mesh')
            continue
        mesh = b.idx[mesh_pid].read()
        b.unity_version = b.unity_version or mesh.object_reader.version
        h = MeshHandler(mesh)
        h.process()
        nv = h.m_VertexCount
        pos = np.nan_to_num(np.array(h.m_Vertices, dtype=np.float32)); pos[:, 0] *= -1
        nrm = np.nan_to_num(np.array(h.m_Normals, dtype=np.float32)) if h.m_Normals else np.zeros((nv, 3), np.float32)
        nrm[:, 0] *= -1
        uv = np.nan_to_num(np.array(h.m_UV0, dtype=np.float32)) if h.m_UV0 else np.zeros((nv, 2), np.float32)
        uv[:, 1] = 1.0 - uv[:, 1]
        tan = None
        if h.m_Tangents:
            tan = np.nan_to_num(np.array(h.m_Tangents, dtype=np.float32)); tan[:, 0] *= -1; tan[:, 3] *= -1
        tris = h.get_triangles()
        pos_acc = w.add_accessor(pos.astype('<f4').tobytes(), nv, 5126, 'VEC3',
                                 minmax=[pos.min(axis=0).tolist(), pos.max(axis=0).tolist()])
        attrs = {'POSITION': pos_acc,
                 'NORMAL': w.add_accessor(nrm.astype('<f4').tobytes(), nv, 5126, 'VEC3'),
                 'TEXCOORD_0': w.add_accessor(uv.astype('<f4').tobytes(), nv, 5126, 'VEC2')}
        if tan is not None:
            attrs['TANGENT'] = w.add_accessor(tan.astype('<f4').tobytes(), nv, 5126, 'VEC4')
        has_skin = rd['kind'] == 'smr' and bool(h.m_BoneIndices)
        if has_skin:
            joints = np.array(h.m_BoneIndices, dtype=np.uint16)
            weights = np.array(h.m_BoneWeights, dtype=np.float32)
            wsum = weights.sum(axis=1, keepdims=True)
            bad = wsum[:, 0] < 1e-6
            weights = np.where(wsum > 1e-6, weights / np.where(wsum > 1e-6, wsum, 1.0), weights)
            weights[bad, 0] = 1.0
            attrs['JOINTS_0'] = w.add_accessor(joints.astype('<u2').tobytes(), nv, 5123, 'VEC4')
            attrs['WEIGHTS_0'] = w.add_accessor(weights.astype('<f4').tobytes(), nv, 5126, 'VEC4')
        mat_src = b.tt(rd['rendererPid']) if rd.get('rendererPid') else tt
        mats = [ec.ref_pid(m) for m in mat_src.get('m_Materials', [])]
        prims = []
        for si, sub in enumerate(tris):
            flat = np.array([i for t in sub for i in (t[0], t[2], t[1])], dtype=np.uint32)
            if len(flat) == 0:
                continue
            ia = (w.add_accessor(flat.astype('<u2').tobytes(), len(flat), 5123, 'SCALAR')
                  if flat.max() < 65536 else
                  w.add_accessor(flat.astype('<u4').tobytes(), len(flat), 5125, 'SCALAR'))
            mi = mat_index.get(mats[si] if si < len(mats) else (mats[0] if mats else 0), 0)
            prims.append({'attributes': attrs, 'indices': ia, 'material': mi, 'mode': 4})
        mesh_idx = len(w.meshes)
        w.meshes.append({'name': mesh.m_Name, 'primitives': prims})

        go_pid = ec.ref_pid(tt.get('m_GameObject'))
        node_idx = next(i for i, n in enumerate(visual_nodes) if n['path_id'] == go_pid)
        if node_idx in used_go:  # two renderers on one GO: duplicate node
            gl_nodes.append({'name': gl_nodes[node_idx]['name'] + '_mesh',
                             'translation': gl_nodes[node_idx].get('translation'),
                             'rotation': gl_nodes[node_idx].get('rotation'),
                             'scale': gl_nodes[node_idx].get('scale')})
            parent = next((p for p, kids in child_lists.items() if node_idx in kids), None)
            if parent is not None:
                gl_nodes[parent]['children'].append(len(gl_nodes) - 1)
            node_idx = len(gl_nodes) - 1
        used_go.add(node_idx)
        gl_nodes[node_idx]['mesh'] = mesh_idx

        gp, gq, gs = globs[next(i for i, n in enumerate(visual_nodes) if n['path_id'] == go_pid)]
        identity = (max(abs(x) for x in gp) < 1e-6 and abs(gq[3] - 1) < 1e-4
                    and max(abs(x - 1) for x in gs) < 1e-6)
        mstats = {'meshName': mesh.m_Name, 'meshPathId': mesh_pid, 'vertices': nv,
                  'triangles': int(sum(len(t) for t in tris)), 'submeshes': len(prims),
                  'skinned': has_skin, 'meshNodeGlobalIsIdentity': identity}
        if not identity:
            stats['warnings'].append(f'mesh node {mesh.m_Name} global transform NOT identity')
        if has_skin:
            bone_pids = [ec.ref_pid(bp) for bp in tt.get('m_Bones', [])]
            joint_nodes = [node_by_transform_pid[bp] for bp in bone_pids]
            mt = b.tt(mesh_pid)
            bindposes = mt.get('m_BindPose') or []
            if len(bindposes) != len(bone_pids):
                if (len(bindposes) < len(bone_pids) and h.m_BoneIndices
                        and int(np.max(h.m_BoneIndices)) < len(bindposes)):
                    stats['warnings'].append(
                        f'{mesh.m_Name}: SMR lists {len(bone_pids)} bones but mesh has '
                        f'{len(bindposes)} bindposes; skin indices only use the first '
                        f'{len(bindposes)} — joint list truncated (shipping data quirk)')
                    bone_pids = bone_pids[:len(bindposes)]
                    joint_nodes = joint_nodes[:len(bindposes)]
                else:
                    raise RuntimeError(f'{mesh.m_Name}: bindpose/bone count mismatch '
                                       f'{len(bindposes)} vs {len(bone_pids)}')
            ibm = np.array([ec.mirror_mat4(bp) for bp in bindposes], dtype='<f4')

            def ancestors_of(i):
                chain = [i]
                cur = visual_nodes[i]
                while cur['depth'] > 0:
                    j = next(k for k, n in enumerate(visual_nodes)
                             if n['depth'] == cur['depth'] - 1 and cur['path'].startswith(n['path'] + '/'))
                    chain.append(j); cur = visual_nodes[j]
                return chain
            common = set(ancestors_of(joint_nodes[0]))
            for jn in joint_nodes[1:]:
                common &= set(ancestors_of(jn))
            skel_root = min(common, key=lambda i: visual_nodes[i]['depth'])
            ibm_acc = w.add_accessor(ibm.tobytes(), len(bone_pids), 5126, 'MAT4')
            w.skins.append({'name': f'{mesh.m_Name}_skin', 'inverseBindMatrices': ibm_acc,
                            'joints': joint_nodes, 'skeleton': skel_root})
            gl_nodes[node_idx]['skin'] = len(w.skins) - 1
            mstats['joints'] = len(bone_pids)
        stats['meshes'].append(mstats)
    return stats, node_by_transform_pid


# ---------------------------------------------------------- animation bake ----

def decode_clip_channels(b, clip_reader, crc_map):
    """Like ec.decode_clip but keeps cubic coefficients; returns raw channel data
    grouped by binding plus lossless JSON doc."""
    ct = clip_reader.read_typetree()
    name = ct['m_Name']
    clean = name[:-len(' [data]')] if name.endswith(' [data]') else name
    mc = ct.get('m_MuscleClip') or {}
    doc = {'clipName': clean, 'sourceName': name, 'pathId': clip_reader.path_id,
           'sampleRate': ct.get('m_SampleRate'), 'wrapMode': ct.get('m_WrapMode'),
           'legacy': ct.get('m_Legacy'),
           'events': [{'time': e['time'], 'functionName': e.get('functionName'),
                       'data': e.get('data')} for e in ct.get('m_Events') or []]}
    clipdata = ((mc.get('m_Clip') or {}).get('data')) if mc else None
    if not clipdata:
        doc['note'] = 'no m_MuscleClip data'
        return doc, None
    start = mc.get('m_StartTime', 0.0)
    stop = mc.get('m_StopTime', 0.0)
    doc.update(startTime=start, stopTime=stop, loopTime=mc.get('m_LoopTime'),
               loopBlend=mc.get('m_LoopBlend'),
               rootMotion={k: mc.get(k) for k in ('m_StartX', 'm_StopX', 'm_StartQ', 'm_StopQ',
                                                  'm_Mirror', 'm_LoopBlendPositionXZ')})
    gb = (ct.get('m_ClipBindingConstant') or {}).get('genericBindings') or []
    layout, total_channels = ec.binding_layout(gb)
    sc = clipdata.get('m_StreamedClip') or {}
    dc = clipdata.get('m_DenseClip') or {}
    cc = clipdata.get('m_ConstantClip') or {}
    stream_count = sc.get('curveCount', 0)
    dense_count = dc.get('m_CurveCount', 0)

    # channel -> ('streamed', [(t, coeff4)]) | ('dense', (rate, begin, [values])) | ('const', v)
    streamed = defaultdict(list)
    for t, keys in ec.decode_streamed_frames(sc.get('data') or []):
        if t is None:
            continue
        for ci, coeff in keys:
            streamed[ci].append((t, coeff))
    dense_arr = dc.get('m_SampleArray') or []
    const_data = cc.get('data') or []

    chans = {}
    for ci, keys in streamed.items():
        keys.sort(key=lambda x: x[0])
        chans[ci] = ('streamed', keys)
    if dense_count and dc.get('m_FrameCount'):
        rate = dc.get('m_SampleRate') or 30.0
        begin = dc.get('m_BeginTime') or 0.0
        for k in range(dense_count):
            vals = [dense_arr[f * dense_count + k] for f in range(dc['m_FrameCount'])
                    if f * dense_count + k < len(dense_arr)]
            chans[stream_count + k] = ('dense', (rate, begin, vals))
    for k, v in enumerate(const_data):
        chans[stream_count + dense_count + k] = ('const', v)

    resolved, unresolved, non_transform = [], [], []
    for ci in sorted(chans):
        bnd, comp = ec.find_binding(layout, ci)
        if bnd is None:
            unresolved.append({'channel': ci, 'reason': 'no binding for channel index'})
            continue
        type_id, attr = bnd.get('typeID'), bnd.get('attribute')
        if type_id != 4:
            non_transform.append({'channel': ci, 'typeID': type_id, 'attribute': attr,
                                  'kind': 'animatorFloat' if type_id == 95 else f'type{type_id}'})
            continue
        path_hash = bnd.get('path')
        path = '' if path_hash == 0 else crc_map.get(path_hash)
        if path is None:
            unresolved.append({'channel': ci, 'reason': f'UNKNOWN_HASH_{path_hash}',
                               'pathHash': path_hash, 'attribute': attr, 'component': comp})
            continue
        if attr in ec.COMPONENT_NAMES and comp < len(ec.COMPONENT_NAMES[attr]):
            prop = ec.COMPONENT_NAMES[attr][comp]
        else:
            unresolved.append({'channel': ci, 'reason': f'unknown transform attribute {attr}',
                               'path': path})
            continue
        resolved.append({'path': path, 'property': prop, 'channel': ci, 'data': chans[ci]})
    doc['stats'] = {'streamedCurves': stream_count, 'denseCurves': dense_count,
                    'constantCurves': len(const_data), 'totalChannels': total_channels,
                    'channelsWithData': len(chans), 'bindingCount': len(gb)}
    return doc, {'start': start, 'stop': stop, 'resolved': resolved,
                 'unresolved': unresolved, 'nonTransform': non_transform}


def eval_channel(data, t):
    kind = data[0]
    if kind == 'const':
        return data[1]
    if kind == 'streamed':
        keys = data[1]
        if t <= keys[0][0]:
            return keys[0][1][3]
        if t >= keys[-1][0]:
            return keys[-1][1][3]
        lo, hi = 0, len(keys) - 1
        while lo + 1 < hi:
            mid = (lo + hi) // 2
            if keys[mid][0] <= t:
                lo = mid
            else:
                hi = mid
        t0, c = keys[lo]
        dt = t - t0
        return ((c[0] * dt + c[1]) * dt + c[2]) * dt + c[3]
    rate, begin, vals = data[1]
    f = (t - begin) * rate
    i = int(f)
    if i < 0:
        return vals[0]
    if i >= len(vals) - 1:
        return vals[-1]
    frac = f - i
    return vals[i] * (1 - frac) + vals[i + 1] * frac


def bake_animations(b, visual_nodes, animators, clip_pids_by_anim, crc_maps, node_by_transform_pid, w,
                    annotation_map=None):
    """Bake all clips at 30 Hz into glTF animations. Returns (anim_meta, raw_docs, issues)."""
    anim_meta, raw_docs = [], []
    issues = {'unresolvedBindings': [], 'nonTransformChannels': [], 'missingNodes': [],
              'clipErrors': []}
    # path -> node index, per animator GO
    node_index_by_path = {}
    for an in animators:
        base = an['path']
        m = {}
        for n in visual_nodes:
            if n['path'] == base:
                m[''] = node_by_transform_pid[n['transformPid']]
            elif n['path'].startswith(base + '/'):
                m[n['path'][len(base) + 1:]] = node_by_transform_pid[n['transformPid']]
        node_index_by_path[an['name']] = m

    used_names = set()
    for an in animators:
        path_map = node_index_by_path[an['name']]
        crc_map = crc_maps[an['name']]
        for cpid in clip_pids_by_anim[an['name']]:
            try:
                doc, bake = decode_clip_channels(b, b.idx[cpid], crc_map)
            except Exception as e:
                issues['clipErrors'].append({'clipPathId': cpid, 'error': f'{type(e).__name__}: {e}'})
                continue
            raw_docs.append(doc)
            if bake is None:
                anim_meta.append({'name': doc['clipName'], 'animator': an['name'],
                                  'duration': 0, 'fps': FPS, 'loop': False, 'trackCount': 0,
                                  'note': doc.get('note', 'no clip data')})
                continue
            for u in bake['unresolved']:
                u = dict(u, clip=doc['clipName'], animator=an['name'])
                if annotation_map and u.get('pathHash') is not None:
                    lp = annotation_map.get(u['pathHash'])
                    if lp:
                        u['likelyPath'] = lp
                issues['unresolvedBindings'].append(u)
            for nt in bake['nonTransform']:
                issues['nonTransformChannels'].append(dict(nt, clip=doc['clipName'], animator=an['name']))
            start, stop = bake['start'], bake['stop']
            n_frames = max(2, int(round((stop - start) * FPS)) + 1)
            times = np.array([min(start + i / FPS, stop) for i in range(n_frames)], dtype='<f4')
            # group channels by (path, property-family)
            tracks = defaultdict(dict)  # path -> {'pos': {x,y,z}, 'rot': ..., 'scale': ...}
            for ch in bake['resolved']:
                prop = ch['property']
                fam, comp = prop.rsplit('.', 1)
                fam = {'m_LocalPosition': 'translation', 'm_LocalRotation': 'rotation',
                       'm_LocalScale': 'scale', 'localEulerAnglesRaw': 'euler'}.get(fam)
                if fam is None:
                    issues['unresolvedBindings'].append(
                        {'clip': doc['clipName'], 'path': ch['path'], 'reason': f'unmapped property {prop}'})
                    continue
                tracks[ch['path']].setdefault(fam, {})[comp] = ch['data']
            time_acc = w.add_accessor(times.tobytes(), n_frames, 5126, 'SCALAR',
                                      minmax=[float(times[0]), float(times[-1])])
            channels, samplers = [], []
            loop = bool(doc.get('loopTime'))
            for path, fams in sorted(tracks.items()):
                node_idx = path_map.get(path)
                if node_idx is None:
                    issues['missingNodes'].append({'clip': doc['clipName'], 'path': path,
                                                   'animator': an['name']})
                    continue
                # euler -> quaternion merge
                if 'euler' in fams and 'rotation' not in fams:
                    e = fams.pop('euler')
                    if all(c in e for c in 'xyz'):
                        quats = []
                        for t in times:
                            qx, qy, qz, qw = euler_to_quat(eval_channel(e['x'], t),
                                                           eval_channel(e['y'], t),
                                                           eval_channel(e['z'], t))
                            quats.append((qx, -qy, -qz, qw))
                        arr = np.array(quats, dtype='<f4')
                        norms = np.linalg.norm(arr, axis=1, keepdims=True)
                        arr = arr / np.where(norms > 1e-8, norms, 1.0)
                        acc = w.add_accessor(arr.tobytes(), n_frames, 5126, 'VEC4')
                        samplers.append({'input': time_acc, 'output': acc, 'interpolation': 'LINEAR'})
                        channels.append({'sampler': len(samplers) - 1,
                                         'target': {'node': node_idx, 'path': 'rotation'}})
                for fam, comps in fams.items():
                    if fam == 'translation' and all(c in comps for c in 'xyz'):
                        vals = np.array([[eval_channel(comps['x'], t),
                                          eval_channel(comps['y'], t),
                                          eval_channel(comps['z'], t)] for t in times], dtype='<f4')
                        vals[:, 0] *= -1
                        const = np.all(np.abs(vals - vals[0]) < 1e-9)
                        out = vals[[0, -1]] if const else vals
                        acc = w.add_accessor(out.astype('<f4').tobytes(), len(out), 5126, 'VEC3')
                        tin = w.add_accessor(times[[0, -1]].tobytes(), 2, 5126, 'SCALAR',
                                             minmax=[float(times[0]), float(times[-1])]) if const else time_acc
                        samplers.append({'input': tin, 'output': acc, 'interpolation': 'LINEAR'})
                        channels.append({'sampler': len(samplers) - 1,
                                         'target': {'node': node_idx, 'path': 'translation'}})
                    elif fam == 'rotation' and all(c in comps for c in 'xyzw'):
                        vals = np.array([[eval_channel(comps['x'], t),
                                          eval_channel(comps['y'], t),
                                          eval_channel(comps['z'], t),
                                          eval_channel(comps['w'], t)] for t in times], dtype='<f4')
                        vals[:, 1] *= -1; vals[:, 2] *= -1
                        norms = np.linalg.norm(vals, axis=1, keepdims=True)
                        vals = vals / np.where(norms > 1e-8, norms, 1.0)
                        for i in range(1, len(vals)):
                            if np.dot(vals[i], vals[i - 1]) < 0:
                                vals[i] *= -1
                        const = np.all(np.abs(vals - vals[0]) < 1e-7)
                        out = vals[[0, -1]] if const else vals
                        acc = w.add_accessor(out.astype('<f4').tobytes(), len(out), 5126, 'VEC4')
                        tin = w.add_accessor(times[[0, -1]].tobytes(), 2, 5126, 'SCALAR',
                                             minmax=[float(times[0]), float(times[-1])]) if const else time_acc
                        samplers.append({'input': tin, 'output': acc, 'interpolation': 'LINEAR'})
                        channels.append({'sampler': len(samplers) - 1,
                                         'target': {'node': node_idx, 'path': 'rotation'}})
                    elif fam == 'scale' and all(c in comps for c in 'xyz'):
                        vals = np.array([[eval_channel(comps['x'], t),
                                          eval_channel(comps['y'], t),
                                          eval_channel(comps['z'], t)] for t in times], dtype='<f4')
                        const = np.all(np.abs(vals - vals[0]) < 1e-9)
                        out = vals[[0, -1]] if const else vals
                        acc = w.add_accessor(out.astype('<f4').tobytes(), len(out), 5126, 'VEC3')
                        tin = w.add_accessor(times[[0, -1]].tobytes(), 2, 5126, 'SCALAR',
                                             minmax=[float(times[0]), float(times[-1])]) if const else time_acc
                        samplers.append({'input': tin, 'output': acc, 'interpolation': 'LINEAR'})
                        channels.append({'sampler': len(samplers) - 1,
                                         'target': {'node': node_idx, 'path': 'scale'}})
                    else:
                        issues['unresolvedBindings'].append(
                            {'clip': doc['clipName'], 'path': path,
                             'reason': f'incomplete {fam} components {sorted(comps)}'})
            aname = doc['clipName'] if len(animators) == 1 else f'{an["name"]}/{doc["clipName"]}'
            while aname in used_names:
                aname += '_'
            used_names.add(aname)
            if channels:
                w.animations.append({'name': aname, 'samplers': samplers, 'channels': channels,
                                     'extras': {'loop': loop, 'animator': an['name'],
                                                'sourceClipPathId': cpid}})
            anim_meta.append({'name': aname, 'animator': an['name'],
                              'duration': round(float(stop - start), 6), 'fps': FPS,
                              'loop': loop, 'trackCount': len(channels),
                              'sourceClipPathId': cpid,
                              **({'note': 'empty clip: no curve channels (likely code-driven)'}
                                 if not (bake['resolved'] or bake['unresolved'] or bake['nonTransform'])
                                 else {})})
    return anim_meta, raw_docs, issues


def clip_targets_resolve(b, cpid, crc_map):
    """True if every Transform binding path hash of the clip resolves in crc_map.
    Used to gate name-matched extra clips (family prefixes like 'boss'/'tower'
    are shared across characters with different skeletons)."""
    try:
        ct = b.tt(cpid)
        gb = (ct.get('m_ClipBindingConstant') or {}).get('genericBindings') or []
        hashes = {g.get('path') for g in gb if g.get('typeID') == 4 and g.get('path')}
        return all(h in crc_map for h in hashes)
    except Exception:
        return False


def collect_clips(b, visual_name, animators, crc_maps):
    """Controller clips + name-matched extras per animator. Extras must have
    ALL binding paths resolvable against this animator's skeleton."""
    out = {}
    visual_base = (visual_name or '')[:-3] if (visual_name or '').endswith('_pa') else (visual_name or '')
    family = visual_base.split('_')[0]
    all_clips = []
    for o in b.env.objects:
        if o.type.name == 'AnimationClip':
            try:
                all_clips.append((o.path_id, o.read().m_Name))
            except Exception:
                pass
    for an in animators:
        pids, seen = [], set()
        cpid = an['controllerPid']
        if cpid and cpid in b.idx:
            act = b.tt(cpid)
            for c in act.get('m_AnimationClips') or []:
                p = ec.ref_pid(c)
                if p and p not in seen:
                    seen.add(p); pids.append(p)
        if an['isMain']:
            extra_prefixes = [visual_base, family]
        else:
            extra_prefixes = [an['name']]
        crc_map = crc_maps[an['name']]
        for p, n in all_clips:
            if p in seen:
                continue
            if any(n.startswith(px + '_') or n.startswith(px + '@') for px in extra_prefixes if px):
                if clip_targets_resolve(b, p, crc_map):
                    seen.add(p); pids.append(p)
        out[an['name']] = pids
    return out


# ---------------------------------------------------------------- validate ----

def validate_glb(path, expect):
    import trimesh
    errs = []
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, total = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67 or ver != 2 or total != len(data):
        errs.append('bad GLB header')
    jlen, jtype = struct.unpack_from('<II', data, 12)
    j = json.loads(data[20:20 + jlen])
    n_anim = len(j.get('animations', []))
    if n_anim != expect['clips']:
        errs.append(f'animation count {n_anim} != expected {expect["clips"]}')
    for a in j.get('animations', []):
        for ch in a['channels']:
            if ch['target']['node'] >= len(j['nodes']):
                errs.append('animation channel targets invalid node')
            s = a['samplers'][ch['sampler']]
            if s['input'] >= len(j['accessors']) or s['output'] >= len(j['accessors']):
                errs.append('animation sampler invalid accessor')
    for s in j.get('skins', []):
        if max(s['joints']) >= len(j['nodes']):
            errs.append('skin joint out of range')
    try:
        scene = trimesh.load(path, process=False)
        geoms = scene.geometry if hasattr(scene, 'geometry') else {scene.name: scene}
        verts = sum(len(g.vertices) for g in geoms.values())
        if verts != expect['vertices']:
            errs.append(f'trimesh verts {verts} != expected {expect["vertices"]}')
    except Exception as e:
        errs.append(f'trimesh reload failed: {type(e).__name__}: {e}')
    return errs, {'glbJsonNodes': len(j['nodes']), 'glbJsonAnimations': n_anim,
                  'glbJsonSkins': len(j.get('skins', [])), 'glbJsonMaterials': len(j.get('materials', []))}


# -------------------------------------------------------------------- main ----

def process_def(d, cache, texstore, args):
    t0 = time.time()
    defname = d['defName']
    work_dir = os.path.join(WORK, defname)
    os.makedirs(work_dir, exist_ok=True)
    out_dir = os.path.join(OUT, defname)
    os.makedirs(out_dir, exist_ok=True)
    b, gos = cache.get(d['bundle'], d.get('preferFile'))
    if d.get('visualPid'):
        logic_pid = base_pid = visual_pid = d['visualPid']
        n_cands = 1
    else:
        logic_pid, base_pid, visual_pid, n_cands = resolve_logic(b, gos, d)
    visual_name = b.name_of(visual_pid)
    visual_inv = ec.component_inventory(b, visual_pid, 'visual')
    logic_inv = ec.component_inventory(b, logic_pid, 'logic')
    visual_nodes = visual_inv['nodes']
    with open(os.path.join(work_dir, 'components.json'), 'w') as f:
        json.dump({'prefabName': defname, 'logicPrefab': logic_inv, 'visualPrefab': visual_inv,
                   'visualResolvedVia': 'PrefabLoader.prefabList[0]' if visual_pid != logic_pid else 'self'},
                  f, indent=1, default=str)

    # ---- select renderers: LOD0 SMRs (+ static MeshFilter parts) ----
    smr_nodes = [n for n in visual_nodes
                 if any(c['type'] == 'SkinnedMeshRenderer' for c in n['components'])]
    lod0 = [n for n in smr_nodes if 'LOD0' in n['name']]
    # SMRs that are not part of the LOD naming scheme (e.g. boss_kao_*_face_skin,
    # tower_007_add_parts_01) are active+enabled and outside the LODGroup, so the
    # engine always draws them — they were silently dropped before.
    non_lod = [n for n in smr_nodes if not re.search(r'_LOD\d+$', n['name'])]
    chosen_smr = (lod0 + [n for n in non_lod if n not in lod0]) if lod0 else smr_nodes
    renderers = []
    for n in chosen_smr:
        for c in n['components']:
            if c['type'] == 'SkinnedMeshRenderer':
                renderers.append({'kind': 'smr', 'pid': c['path_id'], 'node': n['name']})
    smr_go_pids = {n['path_id'] for n in chosen_smr}
    for n in visual_nodes:
        mf = next((c for c in n['components'] if c['type'] == 'MeshFilter'), None)
        mr = next((c for c in n['components'] if c['type'] == 'MeshRenderer'), None)
        if mf and mr and n['path_id'] not in smr_go_pids and 'LOD' not in n['name']:
            renderers.append({'kind': 'static', 'pid': mf['path_id'], 'node': n['name'],
                              'rendererPid': mr['path_id']})
    if not renderers:
        raise RuntimeError('no renderable mesh found in visual prefab')
    # static renderer materials come from MeshRenderer, not MeshFilter
    mat_pids = []
    for rd in renderers:
        src = rd.get('rendererPid', rd['pid'])
        tt = b.tt(src)
        for m in tt.get('m_Materials', []):
            mp = ec.ref_pid(m)
            if mp and mp not in mat_pids:
                mat_pids.append(mp)

    w = WebWriter()
    mat_index = build_materials(b, d['bundle'], mat_pids, texstore, w)
    glb_stats, node_by_transform_pid = export_character_glb(
        b, d['bundle'], visual_nodes, renderers, mat_index, w,
        generator='pjm2-web extract_all_characters.py (UnityPy + hand-rolled glTF)')

    # ---- animators ----
    animators = []
    for n in visual_nodes:
        if d['role'] == 'player-part':
            break  # pose copied from the player's bones at runtime
        for c in n['components']:
            if c['type'] == 'Animator':
                at = b.tt(c['path_id'])
                animators.append({'name': n['name'], 'path': n['path'], 'path_id': n['path_id'],
                                  'pid': c['path_id'],
                                  'controllerPid': ec.ref_pid(at.get('m_Controller')),
                                  'avatarPid': ec.ref_pid(at.get('m_Avatar')),
                                  'isMain': len(animators) == 0})
    crc_maps = {an['name']: ec.build_crc_map(b, an['path_id'], visual_nodes) for an in animators}
    clip_pids = collect_clips(b, visual_name, animators, crc_maps)
    anim_meta, raw_docs, issues = bake_animations(
        b, visual_nodes, animators, clip_pids, crc_maps, node_by_transform_pid, w,
        annotation_map=cache.annotation_map(d['bundle']))

    glb_path = os.path.join(out_dir, f'{defname}.glb')
    data, j = w.finish([0], generator='pjm2-web extract_all_characters.py')
    with open(glb_path, 'wb') as f:
        f.write(data)

    with open(os.path.join(work_dir, 'clips.json'), 'w') as f:
        json.dump({'prefab': defname, 'visualPrefab': visual_name,
                   'conventions': {'space': 'RAW Unity (left-handed, Y-up); mirror at load',
                                   'coefficients': 'streamed keys keep coeff[0..3]; v(dt)=c0*dt^3+c1*dt^2+c2*dt+c3',
                                   'bake': f'GLB animations baked at {FPS} Hz, mirrored to glTF space'},
                   'clips': raw_docs}, f, indent=1, default=str)
    with open(os.path.join(work_dir, 'glb_stats.json'), 'w') as f:
        json.dump(glb_stats, f, indent=1)

    # ---- validate ----
    total_verts = sum(m['vertices'] for m in glb_stats['meshes'])
    total_joints = sum(m.get('joints', 0) for m in glb_stats['meshes'])
    # trimesh builds one geometry per primitive, repeating shared vertex arrays
    trimesh_verts = sum(m['vertices'] * m['submeshes'] for m in glb_stats['meshes'])
    baked_clips = len([a for a in anim_meta if a['trackCount'] > 0])
    verrs, vinfo = validate_glb(glb_path, {'clips': baked_clips, 'vertices': trimesh_verts})

    # ---- textures used by this def ----
    tex_recs = []
    seen = set()
    for mp in mat_pids:
        mt = b.tt(mp)
        for te in mt.get('m_SavedProperties', {}).get('m_TexEnvs', []):
            tpid = ec.ref_pid(te[1].get('m_Texture'))
            if tpid and (d['bundle'], tpid) in texstore.recs and tpid not in seen:
                seen.add(tpid)
                r = texstore.recs[(d['bundle'], tpid)]
                tex_recs.append({k: r[k] for k in ('textureName', 'pathId', 'file', 'colorSpace',
                                                    'sourceColorSpace', 'convertedLinearToSrgb',
                                                    'webWidth', 'webHeight', 'webBytes',
                                                    'sourceFormat', 'sourceFormatName', 'note', 'error')
                                 if k in r} | {'slots': sorted({u['slot'] for u in r['usedBy']})})

    unresolved_total = (len(issues['unresolvedBindings']) + len(issues['missingNodes'])
                        + len(issues['clipErrors']))
    status = 'done' if not verrs else 'done-with-warnings'
    extra_notes = []
    if not glb_stats['meshes']:
        status = 'done-with-warnings'
        extra_notes.append('NO MESH in source: visual prefab renderer has dangling m_Mesh PPtr; '
                           'GLB contains skeleton hierarchy only')
    if not any(a['trackCount'] > 0 for a in anim_meta):
        extra_notes.append('no baked animation tracks (null/empty controller or foreign-rig clips)')
    if unresolved_total:
        extra_notes.append(f'{unresolved_total} unresolved animation channels — see issues.unresolvedBindings '
                           f'(likelyPath annotations identify foreign-rig/missing joints); raw curves preserved in clips.json')
    entry = {
        'defName': defname, 'role': d['role'], 'stage1': d['stage1'],
        'status': status,
        'glb': f'{defname}/{defname}.glb',
        'glbBytes': os.path.getsize(glb_path), 'glbSha256': sha256(glb_path),
        'animations': anim_meta,
        'textures': tex_recs,
        'sourceBundle': d['bundle'],
        'pathIds': {'logicPrefab': logic_pid, 'baseComponent': base_pid,
                    'visualPrefab': visual_pid,
                    'animators': {an['name']: an['pid'] for an in animators},
                    'controllers': {an['name']: an['controllerPid'] for an in animators},
                    'meshes': [m['meshPathId'] for m in glb_stats['meshes']],
                    'materials': mat_pids},
        'vertexCount': total_verts, 'jointCount': total_joints,
        'clipCount': len(anim_meta),
        'unresolvedBindings': unresolved_total,
        'issues': issues,
        'glbWarnings': glb_stats['warnings'],
        'validation': {'errors': verrs, **vinfo},
        'meshNodeGlobalIsIdentity': all(m['meshNodeGlobalIsIdentity'] for m in glb_stats['meshes']),
        'scratch': {'components': os.path.relpath(os.path.join(work_dir, 'components.json'), ROOT),
                    'clipsRaw': os.path.relpath(os.path.join(work_dir, 'clips.json'), ROOT)},
        'extractSeconds': round(time.time() - t0, 2),
    }
    if d['role'] == 'tower':
        entry['towerBase'] = d.get('towerBase')
    if n_cands > 1:
        extra_notes.append(f'{n_cands} GameObjects named {defname}; logic picked by {d["baseClass"]} path_id')
    if extra_notes:
        entry['notes'] = '; '.join(extra_notes)
    with open(os.path.join(work_dir, 'result.json'), 'w') as f:
        json.dump(entry, f, indent=1, default=str)
    log(f'  {defname}: {total_verts} verts / {total_joints} joints / {len(anim_meta)} clips '
        f'({baked_clips} baked) / {len(tex_recs)} tex / unresolved={unresolved_total} '
        f'{"VALID" if not verrs else "WARN:" + str(verrs)} [{time.time()-t0:.1f}s]')
    return entry


def write_manifest(entries):
    done = [e for e in entries if e['status'].startswith('done')]
    totals = {'characters': len(entries),
              'done': len(done),
              'failed': len([e for e in entries if e['status'] == 'failed']),
              'pending': len([e for e in entries if e['status'] == 'pending']),
              'glbBytes': sum(e.get('glbBytes', 0) for e in entries),
              'webTextureBytes': sum(t.get('webBytes', 0) for e in done for t in e.get('textures', [])),
              'vertexCount': sum(e.get('vertexCount', 0) for e in done),
              'clipCount': sum(e.get('clipCount', 0) for e in done),
              'unresolvedBindings': sum(e.get('unresolvedBindings', 0) for e in done)}
    # web texture bytes double-count shared textures; compute unique
    uniq = {}
    for e in done:
        for t in e.get('textures', []):
            if t.get('file'):
                uniq[t['file']] = t.get('webBytes', 0)
    totals['webTextureBytesUnique'] = sum(uniq.values())
    totals['uniqueTextures'] = len(uniq)
    doc = {'generatedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'tool': 'pjm2-web/tools/assets/extract_all_characters.py',
           'game': 'PixelJunk Monsters 2 (PS4 CUSA11967, Unity 5.6.5p1) — user-owned decrypted copy',
           'coordinateConvention': 'glTF RH Y-up; Unity mirrored across YZ (x negated, winding/V flipped, '
                                   'quat (x,-y,-z,w)); baked animation tracks already in glTF space',
           'animationBake': {'fps': FPS, 'method': 'cubic segment polynomial v(dt)=c0*dt^3+c1*dt^2+c2*dt+c3 '
                                                  'from StreamedClip coefficients, uniform 30 Hz; '
                                                  'constant channels as 2-key tracks; quaternions normalized',
                             'location': 'embedded in each GLB (glTF animations); raw lossless clips in '
                                         'pjm2-web/.work/asset-scale/<def>/clips.json'},
           'texturePolicy': {'albedo': '_MainTex m_ColorSpace=1 == sRGB: bytes written UNCHANGED -> three.js '
                                       'texture.colorSpace = SRGBColorSpace',
                             'dataMaps': 'normal (DXT5nm decoded) / metallic-roughness / AO (sRGB-decoded) linear (NoColorSpace); bound as normalTexture / '
                                         'metallicRoughnessTexture (see docs/ORIGINAL_CHARACTER_RENDERING_FACTS.md)',
                             'resolution': f'web PNGs downscaled to <=1024; full-res linear originals in '
                                           f'pjm2-web/.work/asset-scale/textures-full/'},
           'totals': totals,
           'characters': entries}
    os.makedirs(os.path.dirname(MANIFEST_OUT), exist_ok=True)
    with open(MANIFEST_OUT, 'w') as f:
        json.dump(doc, f, indent=1, default=str)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(doc, f, indent=1, default=str)
    return totals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated def names')
    ap.add_argument('--role', choices=['enemy', 'tower', 'player-part', 'all'], default='all')
    ap.add_argument('--stage1', action='store_true', help='only the stage-1 priority set')
    ap.add_argument('--force', action='store_true', help='re-extract even if result.json exists')
    ap.add_argument('--web-size', type=int, default=1024)
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    defs = load_roster()
    if args.only:
        wanted = set(args.only.split(','))
        defs = [d for d in defs if d['defName'] in wanted]
    if args.role != 'all':
        defs = [d for d in defs if d['role'] == args.role]
    if args.stage1:
        defs = [d for d in defs if d['stage1']]
    # stage-1 first, then enemies, then towers (test towers last)
    defs.sort(key=lambda d: (not d['stage1'], d['role'] != 'enemy',
                             d['defName'].startswith('tower_test'), d['defName']))
    log(f'extract_all_characters.py START: {len(defs)} defs '
        f'(stage1={sorted(d["defName"] for d in defs if d["stage1"])})')
    cache = BundleCache()
    texstore = TextureStore(args.web_size)
    entries = []
    # merge with existing manifest so partial runs (--only) don't drop other defs
    prior = {}
    prior_path = MANIFEST_OUT if os.path.exists(MANIFEST_OUT) else MANIFEST
    if os.path.exists(prior_path):
        try:
            prior = {e['defName']: e for e in json.load(open(prior_path)).get('characters', [])}
        except Exception:
            pass
    processed = set()
    for d in defs:
        work_result = os.path.join(WORK, d['defName'], 'result.json')
        glb_file = os.path.join(OUT, d['defName'], d['defName'] + '.glb')
        if not args.force and os.path.exists(work_result) and os.path.exists(glb_file):
            try:
                entries.append(json.load(open(work_result)))
                processed.add(d['defName'])
                log(f'  {d["defName"]}: cached (skip)')
                continue
            except Exception:
                pass
        try:
            entries.append(process_def(d, cache, texstore, args))
        except Exception as e:
            log(f'  {d["defName"]}: FAILED {type(e).__name__}: {e}')
            traceback.print_exc()
            entries.append({'defName': d['defName'], 'role': d['role'], 'stage1': d['stage1'],
                            'status': 'failed', 'error': f'{type(e).__name__}: {e}',
                            'sourceBundle': d['bundle']})
        processed.add(d['defName'])
        write_manifest(entries + [e for n, e in prior.items() if n not in processed])
    entries += [e for n, e in prior.items() if n not in processed]
    totals = write_manifest(entries)
    log(f'DONE: {totals}')


if __name__ == '__main__':
    main()