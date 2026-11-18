#!/usr/bin/env python3
"""
extract_character.py — PixelJunk Monsters 2 (PS4) Unity AssetBundle -> web asset extractor.

Spike-quality but parameterized: converts one enemy prefab end-to-end.

Usage:
  python extract_character.py <prefab_name> <bundle_path> <output_dir> [--pid PATH_ID] [--lod N]

Run with:
  PYTHONPATH=<project>/tools/assets/pylibs /srv/opencode/venv-unity/bin/python extract_character.py ...

Pipeline (each stage writes its output + appends a line to SPIKE_REPORT.md as it lands):
  A. components.json   - GameObject/component inventory of logic prefab AND visual prefab
                         (visual prefab is resolved through the game's PrefabLoader component)
  B. <name>.glb        - LOD<N> skinned mesh -> glTF 2.0 binary:
                         POSITION, NORMAL, TANGENT, TEXCOORD_0, JOINTS_0, WEIGHTS_0,
                         indices, full transform hierarchy, skin with inverse bind matrices.
  C. textures/*.png    - all textures referenced by the mesh materials (+ textures.json metadata)
  D. clips.json        - all AnimationClips of the AnimatorController (plus name-matched extras):
                         decoded from Unity's compressed m_MuscleClip stream
                         (StreamedClip + DenseClip + ConstantClip) into
                         {clipName, bindings:[{path, property, times[], values[]}]}
  E. manifest.json     - every output file with byte size + sha256

COORDINATE CONVENTION (Unity left-handed Y-up -> glTF right-handed Y-up):
  - mirror across the YZ plane: negate X on positions/normals; negate X on translations
  - quaternions (x,y,z,w) -> (x,-y,-z,w)          [equivalently (-x,y,z,-w)]
  - tangents (x,y,z,w) -> (-x,y,z,-w)             [mirror + handedness flip]
  - triangle winding reversed (a,b,c) -> (a,c,b)
  - UV: v -> 1-v (Unity UV origin bottom-left, glTF top-left)
  - matrices M -> S*M*S with S=diag(-1,1,1,1) (negate row0 and col0, keep e00)
  AnimationClip JSON (stage D) stays in RAW Unity convention on purpose (lossless);
  apply the same rules at load time. See SPIKE_REPORT.md.

Animation decoding algorithm follows AssetStudio / AssetStudioMod (MIT license),
ModelConverter.ReadCurveData / FindBinding / StreamedClip.ReadData.
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import time
import zlib

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'pylibs'))

import numpy as np  # noqa: E402
import UnityPy  # noqa: E402
from UnityPy.helpers.MeshHelper import MeshHandler  # noqa: E402

REPORT_PATH = os.path.join(SCRIPT_DIR, 'SPIKE_REPORT.md')

TEX_FORMAT_NAMES = {
    10: 'DXT1/BC1', 12: 'DXT5/BC3', 24: 'BC6H', 25: 'BC7', 26: 'BC4', 27: 'BC5',
    28: 'DXT1Crunched', 29: 'DXT5Crunched', 34: 'ETC_RGB4', 45: 'ETC2_RGBA8',
}
AUDIO_COMPRESSION_NAMES = {0: 'PCM', 1: 'Vorbis', 2: 'ADPCM', 3: 'MP3', 4: 'VAG',
                           5: 'HEVAG', 6: 'XMA', 7: 'AAC', 8: 'GCADPCM', 9: 'ATRAC9'}


def log(msg):
    line = f'- [{time.strftime("%H:%M:%S")}] {msg}'
    print(line)
    try:
        with open(REPORT_PATH, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass


def ref_pid(c):
    """PPtr dict (typetree) or PPtr object -> path_id."""
    if c is None:
        return 0
    if isinstance(c, dict):
        return c.get('path_id') or c.get('m_PathID') or 0
    return getattr(c, 'path_id', 0) or 0


class Bundle:
    def __init__(self, path, prefer_file=None):
        self.path = path
        self.env = UnityPy.load(path)
        # Multi-scene bundles (e.g. 'stages' packs ~29 BuildPlayer-* files)
        # have path_id COLLISIONS across files — small sequential pids
        # (1..N) repeat per serialized file. idx is last-wins; when
        # prefer_file is set, objects from that assets-file overwrite the
        # collisions so prefabs living there resolve correctly (chibi_00
        # lives only in 3d_stage_004_env.sharedAssets).
        self.idx = {o.path_id: o for o in self.env.objects}
        self.scripts = {}
        for o in self.env.objects:
            if o.type.name == 'MonoScript':
                self.scripts[o.path_id] = getattr(o.read(), 'm_ClassName', None)
        if prefer_file is not None:
            for o in self.env.objects:
                if prefer_file in o.assets_file.name:
                    self.idx[o.path_id] = o
                    if o.type.name == 'MonoScript':
                        self.scripts[o.path_id] = getattr(o.read(), 'm_ClassName', None)
        self.unity_version = None

    def tt(self, pid):
        return self.idx[pid].read_typetree()

    def name_of(self, pid):
        try:
            return self.idx[pid].read().m_Name
        except Exception:
            return None

    def comp_class(self, reader):
        try:
            d = reader.read()
            return self.scripts.get(d.m_Script.path_id)
        except Exception:
            return None

    def find_gameobject_by_name(self, name):
        for o in self.env.objects:
            if o.type.name == 'GameObject':
                try:
                    if o.read().m_Name == name:
                        return o
                except Exception:
                    pass
        return None


# ---------------------------------------------------------------- hierarchy --

def walk_tree(b: Bundle, go_reader, depth=0, out=None, parent_path=''):
    """Depth-first walk; returns list of node dicts (pre-order)."""
    if out is None:
        out = []
    t = go_reader.read_typetree()
    name = t['m_Name']
    path = f'{parent_path}/{name}' if parent_path else name
    comps = []
    tr_pid = None
    for c in t['m_Component']:
        pid = ref_pid(c['component'])
        reader = b.idx[pid]
        tn = reader.type.name
        entry = {'type': tn, 'path_id': pid}
        if tn == 'MonoBehaviour':
            entry['scriptClass'] = b.comp_class(reader)
        if tn == 'Transform':
            tr_pid = pid
        comps.append(entry)
    node = {'name': name, 'path': path, 'path_id': go_reader.path_id,
            'depth': depth, 'components': comps, 'transformPid': tr_pid}
    # transform details
    tt = b.tt(tr_pid)
    node['localPosition'] = tt['m_LocalPosition']
    node['localRotation'] = tt['m_LocalRotation']
    node['localScale'] = tt['m_LocalScale']
    out.append(node)
    for child in tt['m_Children']:
        ctt = b.tt(ref_pid(child))
        walk_tree(b, b.idx[ref_pid(ctt['m_GameObject'])], depth + 1, out, path)
    return out


def component_inventory(b: Bundle, root_pid, label):
    nodes = walk_tree(b, b.idx[root_pid])
    for n in nodes:
        # enrich renderers/animator with resolved refs
        for c in n['components']:
            if c['type'] in ('SkinnedMeshRenderer', 'MeshFilter', 'MeshRenderer', 'Animator'):
                tt = b.tt(c['path_id'])
                info = {}
                if c['type'] == 'SkinnedMeshRenderer':
                    mp = ref_pid(tt.get('m_Mesh'))
                    info = {'mesh': b.name_of(mp), 'meshPathId': mp,
                            'boneCount': len(tt.get('m_Bones', [])),
                            'materials': [b.name_of(ref_pid(m)) for m in tt.get('m_Materials', [])],
                            'rootBone': b.name_of(ref_pid(tt.get('m_RootBone')))}
                elif c['type'] in ('MeshFilter', 'MeshRenderer'):
                    mp = ref_pid(tt.get('m_Mesh'))
                    info = {'mesh': b.name_of(mp), 'meshPathId': mp}
                    if c['type'] == 'MeshRenderer':
                        info['materials'] = [b.name_of(ref_pid(m)) for m in tt.get('m_Materials', [])]
                elif c['type'] == 'Animator':
                    cp, ap = ref_pid(tt.get('m_Controller')), ref_pid(tt.get('m_Avatar'))
                    info = {'controller': b.name_of(cp), 'controllerPathId': cp,
                            'avatar': b.name_of(ap), 'avatarPathId': ap}
                c.update(info)
    return {'label': label, 'rootPathId': root_pid, 'rootName': b.name_of(root_pid),
            'nodeCount': len(nodes), 'nodes': nodes}


# --------------------------------------------------------------- glTF / GLB --

def q_mul(a, bq):
    ax, ay, az, aw = a
    bx, by, bz, bw = bq
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def q_vrotate(q, v):
    x, y, z = v
    qx, qy, qz, qw = q
    ix = qw * x + qy * z - qz * y
    iy = qw * y + qz * x - qx * z
    iz = qw * z + qx * y - qy * x
    iw = -qx * x - qy * y - qz * z
    return (ix * qw + iw * -qx + iy * -qz - iz * -qy,
            iy * qw + iw * -qy + iz * -qx - ix * -qz,
            iz * qw + iw * -qz + ix * -qy - iy * -qx)


def global_transforms(nodes):
    """nodes in pre-order (parent always before child). Returns {i: (pos, quat, scale)} globals."""
    parents = {}
    stack = []
    globs = {}
    for i, n in enumerate(nodes):
        while stack and n['depth'] <= stack[-1][1]:
            stack.pop()
        parents[i] = stack[-1][0] if stack else None
        stack.append((i, n['depth']))
    for i, n in enumerate(nodes):
        p = n['localPosition']; r = n['localRotation']; s = n['localScale']
        loc = ((p['x'], p['y'], p['z']), (r['x'], r['y'], r['z'], r['w']), (s['x'], s['y'], s['z']))
        par = parents[i]
        if par is None:
            globs[i] = loc
        else:
            gp, gq, gs = globs[par]
            lp, lq, ls = loc
            npos = (gp[0] + gs[0] * q_vrotate(gq, lp)[0],
                    gp[1] + gs[1] * q_vrotate(gq, lp)[1],
                    gp[2] + gs[2] * q_vrotate(gq, lp)[2])
            nquat = q_mul(gq, lq)
            nscale = (gs[0] * ls[0], gs[1] * ls[1], gs[2] * ls[2])
            globs[i] = (npos, nquat, nscale)
    return globs


class GltfWriter:
    """Minimal hand-rolled glTF 2.0 binary writer (single buffer)."""

    def __init__(self):
        self.bin = bytearray()
        self.buffer_views = []
        self.accessors = []
        self.nodes = []
        self.meshes = []
        self.skins = []
        self.materials = [{'name': 'default', 'pbrMetallicRoughness': {
            'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.9}}]

    def _pad(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def add_accessor(self, data: bytes, count, comp_type, acc_type, minmax=None):
        self._pad()
        bv = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        self.bin += data
        self.buffer_views.append(bv)
        acc = {'bufferView': len(self.buffer_views) - 1, 'componentType': comp_type,
               'count': count, 'type': acc_type}
        if minmax:
            acc['min'], acc['max'] = minmax
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def finish(self, root_node_indices, generator):
        j = {'asset': {'version': '2.0', 'generator': generator},
             'scene': 0,
             'scenes': [{'nodes': root_node_indices}],
             'nodes': self.nodes,
             'materials': self.materials}
        if self.meshes:
            j['meshes'] = self.meshes
        if self.skins:
            j['skins'] = self.skins
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
        return bytes(out)


def mirror_mat4(e):
    """Unity Matrix4x4 typetree dict (e00..e33, row-major naming) -> glTF column-major
    float list, mirrored S*M*S (S=diag(-1,1,1,1)): negate row0 (except e00) and col0."""
    m = [[e[f'e{r}{c}'] for c in range(4)] for r in range(4)]
    for c in range(1, 4):
        m[0][c] = -m[0][c]
    for r in range(1, 4):
        m[r][0] = -m[r][0]
    flat = []
    for c in range(4):          # glTF stores column-major
        for r in range(4):
            flat.append(m[r][c])
    return flat


def export_glb(b: Bundle, nodes, smr_pid, out_path, generator):
    """nodes: pre-order node dicts from walk_tree of the visual prefab root."""
    smr = b.tt(smr_pid)
    mesh_pid = ref_pid(smr['m_Mesh'])
    mesh = b.idx[mesh_pid].read()
    b.unity_version = b.unity_version or mesh.object_reader.version
    h = MeshHandler(mesh)
    h.process()

    n_verts = h.m_VertexCount
    pos = np.nan_to_num(np.array(h.m_Vertices, dtype=np.float32))
    pos[:, 0] *= -1                                     # mirror X
    nrm = np.nan_to_num(np.array(h.m_Normals, dtype=np.float32)) if h.m_Normals else np.zeros((n_verts, 3), np.float32)
    nrm[:, 0] *= -1
    uv = np.nan_to_num(np.array(h.m_UV0, dtype=np.float32)) if h.m_UV0 else np.zeros((n_verts, 2), np.float32)
    uv[:, 1] = 1.0 - uv[:, 1]                           # flip V
    tan = None
    if h.m_Tangents:
        tan = np.nan_to_num(np.array(h.m_Tangents, dtype=np.float32))
        tan[:, 0] *= -1
        tan[:, 3] *= -1                                 # mirror + handedness
    joints = np.array(h.m_BoneIndices, dtype=np.uint16) if h.m_BoneIndices else np.zeros((n_verts, 4), np.uint16)
    weights = np.array(h.m_BoneWeights, dtype=np.float32) if h.m_BoneWeights else np.zeros((n_verts, 4), np.float32)
    wsum = weights.sum(axis=1, keepdims=True)
    bad = (wsum[:, 0] < 1e-6)
    weights = np.where(wsum > 1e-6, weights / np.where(wsum > 1e-6, wsum, 1.0), weights)
    weights[bad, 0] = 1.0

    # indices per submesh, winding flipped (a,b,c)->(a,c,b)
    tris = h.get_triangles()
    idx_arrays = []
    for sub in tris:
        flat = np.array([i for t in sub for i in (t[0], t[2], t[1])], dtype=np.uint32)
        idx_arrays.append(flat)

    w = GltfWriter()

    # --- nodes (all transforms of the visual prefab, mirrored TRS) ---
    node_by_transform_pid = {}
    gl_nodes = []
    child_lists = {}
    stack = []
    for n in nodes:
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

    # --- which node carries the mesh: the SMR's own GameObject node ---
    smr_go_pid = ref_pid(smr['m_GameObject'])
    mesh_node = next(i for i, n in enumerate(nodes) if n['path_id'] == smr_go_pid)

    # warn if the mesh node's global transform is not identity (skinning convention)
    globs = global_transforms(nodes)
    gp, gq, gs = globs[mesh_node]
    identity = (max(abs(x) for x in gp) < 1e-6 and abs(gq[3] - 1) < 1e-4 and max(abs(x - 1) for x in gs) < 1e-6)
    if not identity:
        log(f'  WARN: mesh node global transform is NOT identity (pos={gp} scale={gs}); '
            f'three.js applies node transform on top of skinning - verify visually')

    # --- primitives ---
    pos_acc = w.add_accessor(pos.astype('<f4').tobytes(), n_verts, 5126, 'VEC3',
                             minmax=[pos.min(axis=0).tolist(), pos.max(axis=0).tolist()])
    nrm_acc = w.add_accessor(nrm.astype('<f4').tobytes(), n_verts, 5126, 'VEC3')
    uv_acc = w.add_accessor(uv.astype('<f4').tobytes(), n_verts, 5126, 'VEC2')
    attrs = {'POSITION': pos_acc, 'NORMAL': nrm_acc, 'TEXCOORD_0': uv_acc}
    if tan is not None:
        attrs['TANGENT'] = w.add_accessor(tan.astype('<f4').tobytes(), n_verts, 5126, 'VEC4')
    if h.m_BoneIndices:
        attrs['JOINTS_0'] = w.add_accessor(joints.astype('<u2').tobytes(), n_verts, 5123, 'VEC4')
        attrs['WEIGHTS_0'] = w.add_accessor(weights.astype('<f4').tobytes(), n_verts, 5126, 'VEC4')

    prims = []
    for flat in idx_arrays:
        if flat.max() < 65536:
            ia = w.add_accessor(flat.astype('<u2').tobytes(), len(flat), 5123, 'SCALAR')
        else:
            ia = w.add_accessor(flat.astype('<u4').tobytes(), len(flat), 5125, 'SCALAR')
        prims.append({'attributes': attrs, 'indices': ia, 'material': 0, 'mode': 4})

    w.meshes.append({'name': mesh.m_Name, 'primitives': prims})
    gl_nodes[mesh_node]['mesh'] = 0

    # --- skin ---
    bone_pids = [ref_pid(bp) for bp in smr['m_Bones']]
    joint_nodes = [node_by_transform_pid[bp] for bp in bone_pids]
    mt = b.tt(mesh_pid)
    bindposes = mt.get('m_BindPose') or []
    ibm = np.array([mirror_mat4(bp) for bp in bindposes], dtype='<f4')
    assert len(bindposes) == len(bone_pids), 'bindpose/bone count mismatch'
    # skeleton root = nearest common ancestor of joints (walk node parents by depth/path)
    def ancestors_of(i):
        chain = [i]
        cur = nodes[i]
        while cur['depth'] > 0:
            j = next(k for k, n in enumerate(nodes)
                     if n['depth'] == cur['depth'] - 1 and cur['path'].startswith(n['path'] + '/'))
            chain.append(j)
            cur = nodes[j]
        return chain
    common = set(ancestors_of(joint_nodes[0]))
    for jn in joint_nodes[1:]:
        common &= set(ancestors_of(jn))
    skel_root = min(common, key=lambda i: nodes[i]['depth'])
    ibm_acc = w.add_accessor(ibm.tobytes(), len(bone_pids), 5126, 'MAT4')
    w.skins.append({'name': f'{mesh.m_Name}_skin', 'inverseBindMatrices': ibm_acc,
                    'joints': joint_nodes, 'skeleton': skel_root})
    w.nodes = gl_nodes

    data = w.finish([0], generator)
    with open(out_path, 'wb') as f:
        f.write(data)
    stats = {'meshName': mesh.m_Name, 'vertices': n_verts,
             'triangles': int(sum(len(t) for t in tris)),
             'joints': len(bone_pids), 'unityVersion': '.'.join(str(x) for x in b.unity_version[:3]),
             'tangents': tan is not None, 'hasSkin': bool(h.m_BoneIndices),
             'meshNodeGlobalIsIdentity': identity, 'submeshes': len(idx_arrays)}
    return stats


# ----------------------------------------------------------------- textures --

def export_textures(b: Bundle, mat_pids, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    infos = []
    for mpid in mat_pids:
        mt = b.tt(mpid)
        mat_name = mt.get('m_Name')
        shader = b.name_of(ref_pid(mt.get('m_Shader')))
        tex_envs = mt.get('m_SavedProperties', {}).get('m_TexEnvs', [])
        floats = {k: v for k, v in mt.get('m_SavedProperties', {}).get('m_Floats', [])}
        colors = {k: v for k, v in mt.get('m_SavedProperties', {}).get('m_Colors', [])}
        for te in tex_envs:
            slot, props = te[0], te[1]
            tpid = ref_pid(props.get('m_Texture'))
            if not tpid or tpid not in b.idx:
                continue
            t = b.idx[tpid].read()
            tt = b.idx[tpid].read_typetree()
            fmt = tt.get('m_TextureFormat')
            raw = tt.get('image data') or b''
            rec = {'material': mat_name, 'shader': shader, 'slot': slot,
                   'textureName': t.m_Name, 'pathId': tpid,
                   'width': t.m_Width, 'height': t.m_Height,
                   'textureFormat': fmt, 'textureFormatName': TEX_FORMAT_NAMES.get(fmt, str(fmt)),
                   'mipCount': tt.get('m_MipCount'), 'colorSpace': tt.get('m_ColorSpace'),
                   'rawDataBytes': len(raw) if raw else 0,
                   'rawMagic': bytes(raw[:8]).hex() if raw else ''}
            try:
                img = t.image
                fn = os.path.join(out_dir, f'{t.m_Name}.png')
                img.save(fn)
                rec['png'] = os.path.basename(fn)
                rec['pngBytes'] = os.path.getsize(fn)
                rec['pngMode'] = img.mode
                rec['pngSize'] = list(img.size)
                arr = np.asarray(img.convert('RGBA'), dtype=np.uint8)
                rec['pngMeanRGBA'] = [round(float(x), 2) for x in arr.reshape(-1, 4).mean(axis=0)]
            except Exception as e:
                rec['error'] = f'{type(e).__name__}: {e}'
            infos.append(rec)
        # material params summary (for the web shader)
        infos.append({'__materialParams': mat_name, 'shader': shader,
                      'floats': floats, 'colors': colors})
    with open(os.path.join(out_dir, 'textures.json'), 'w') as f:
        json.dump(infos, f, indent=1, default=str)
    return infos


# ------------------------------------------------------- animation decoding --

def decode_streamed_frames(data_u32):
    """StreamedClip.data (uint32 LE) -> [(time, [(channelIndex, coeff0..3)])]."""
    buf = np.asarray(data_u32, dtype='<u4').tobytes()
    frames = []
    off = 0
    n = len(buf)
    while off + 8 <= n:
        t = struct.unpack_from('<f', buf, off)[0]
        nk = struct.unpack_from('<i', buf, off + 4)[0]
        off += 8
        if nk < 0 or off + nk * 20 > n:
            break
        keys = []
        for _ in range(nk):
            ci = struct.unpack_from('<i', buf, off)[0]
            coeff = struct.unpack_from('<4f', buf, off + 4)
            keys.append((ci, coeff))
            off += 20
        if abs(t) < 1e30:            # skip +/-FLT_MAX sentinel frames
            frames.append((t, keys))
        else:
            frames.append((None, keys))
    return frames


def binding_layout(generic_bindings):
    """[(startChannel, nChannels, binding)] following AssetStudio FindBinding."""
    layout = []
    cur = 0
    for bnd in generic_bindings:
        type_id = bnd.get('typeID')
        attr = bnd.get('attribute')
        if type_id == 4:  # Transform
            n = {1: 3, 2: 4, 3: 3, 4: 3}.get(attr, 1)
        else:
            n = 1
        layout.append((cur, n, bnd))
        cur += n
    return layout, cur


COMPONENT_NAMES = {1: ['m_LocalPosition.x', 'm_LocalPosition.y', 'm_LocalPosition.z'],
                   2: ['m_LocalRotation.x', 'm_LocalRotation.y', 'm_LocalRotation.z', 'm_LocalRotation.w'],
                   3: ['m_LocalScale.x', 'm_LocalScale.y', 'm_LocalScale.z'],
                   4: ['localEulerAnglesRaw.x', 'localEulerAnglesRaw.y', 'localEulerAnglesRaw.z']}


def find_binding(layout, index):
    for start, n, bnd in layout:
        if start <= index < start + n:
            return bnd, index - start
    return None, 0


def build_crc_map(b: Bundle, animator_go_pid, nodes):
    """CRC32 over animator-relative transform paths + all suffixes (AssetStudio
    CreateBonePathHash). Returns {crc: path}."""
    base = next(n['path'] for n in nodes if n['path_id'] == animator_go_pid)
    crc_map = {}
    for n in nodes:
        if not (n['path'] == base or n['path'].startswith(base + '/')):
            continue
        rel = n['path'][len(base):].lstrip('/')
        if not rel:
            continue
        parts = rel.split('/')
        for i in range(len(parts)):
            s = '/'.join(parts[i:])
            crc_map[zlib.crc32(s.encode())] = s
    return crc_map


def decode_clip(b: Bundle, clip_reader, crc_map, visual_nodes):
    ct = clip_reader.read_typetree()
    name = ct['m_Name']
    clean = name[:-len(' [data]')] if name.endswith(' [data]') else name
    mc = ct.get('m_MuscleClip') or {}
    out = {'clipName': clean, 'sourceName': name, 'pathId': clip_reader.path_id,
           'sampleRate': ct.get('m_SampleRate'), 'wrapMode': ct.get('m_WrapMode'),
           'legacy': ct.get('m_Legacy')}

    # legacy/plain curves (empty for these clips, but handle if present)
    plain = []
    for key, prop, comp_names in (('m_PositionCurves', 'm_LocalPosition', ('x', 'y', 'z')),
                                  ('m_ScaleCurves', 'm_LocalScale', ('x', 'y', 'z')),
                                  ('m_EulerCurves', 'localEulerAnglesRaw', ('x', 'y', 'z'))):
        for curve in ct.get(key) or []:
            path = crc_map.get(zlib.crc32(curve['path'].encode()), curve['path'])
            for ci, cn in enumerate(comp_names):
                ks = curve['curve']['m_Curve']
                plain.append({'path': path, 'property': f'{prop}.{cn}',
                              'times': [k['time'] for k in ks],
                              'values': [k['value'][cn] for k in ks]})
    for curve in ct.get('m_RotationCurves') or []:
        path = crc_map.get(zlib.crc32(curve['path'].encode()), curve['path'])
        for ci, cn in enumerate(('x', 'y', 'z', 'w')):
            ks = curve['curve']['m_Curve']
            plain.append({'path': path, 'property': f'm_LocalRotation.{cn}',
                          'times': [k['time'] for k in ks],
                          'values': [k['value'][cn] for k in ks]})
    for curve in ct.get('m_FloatCurves') or []:
        path = crc_map.get(zlib.crc32(curve['path'].encode()), curve['path']) if curve['path'] else ''
        ks = curve['curve']['m_Curve']
        plain.append({'path': path, 'property': curve.get('attribute'),
                      'times': [k['time'] for k in ks], 'values': [k['value'] for k in ks]})
    if plain:
        out['bindings'] = plain

    clipdata = ((mc.get('m_Clip') or {}).get('data')) if mc else None
    if not clipdata:
        out['note'] = 'no m_MuscleClip data'
        out['events'] = [{'time': e['time'], 'functionName': e.get('functionName'),
                          'data': e.get('data')} for e in ct.get('m_Events') or []]
        return out

    stop_time = mc.get('m_StopTime', 0.0)
    start_time = mc.get('m_StartTime', 0.0)
    out['startTime'] = start_time
    out['stopTime'] = stop_time
    out['loopTime'] = mc.get('m_LoopTime')
    out['loopBlend'] = mc.get('m_LoopBlend')

    cbc = ct.get('m_ClipBindingConstant') or {}
    gb = cbc.get('genericBindings') or []
    layout, total_channels = binding_layout(gb)

    sc = clipdata.get('m_StreamedClip') or {}
    dc = clipdata.get('m_DenseClip') or {}
    cc = clipdata.get('m_ConstantClip') or {}
    stream_count = sc.get('curveCount', 0)
    dense_count = dc.get('m_CurveCount', 0)
    const_count = len(cc.get('data') or [])

    # channels: dict channelIndex -> {'times': [], 'values': []}
    chans = {}

    def chan(ci):
        if ci not in chans:
            chans[ci] = {'times': [], 'values': []}
        return chans[ci]

    # streamed
    frames = decode_streamed_frames(sc.get('data') or [])
    real_frames = [f for f in frames if f[0] is not None]
    for t, keys in real_frames:
        for ci, coeff in keys:
            chan(ci)['times'].append(round(t, 6))
            chan(ci)['values'].append(coeff[3])
    # dense
    dense_arr = dc.get('m_SampleArray') or []
    if dense_count and dc.get('m_FrameCount'):
        rate = dc.get('m_SampleRate') or 30.0
        begin = dc.get('m_BeginTime') or 0.0
        for f in range(dc['m_FrameCount']):
            t = begin + f / rate
            base_i = f * dense_count
            for k in range(dense_count):
                if base_i + k < len(dense_arr):
                    chan(stream_count + k)['times'].append(round(t, 6))
                    chan(stream_count + k)['values'].append(dense_arr[base_i + k])
    # constant: two keyframes at start/stop (AssetStudio convention)
    for k, v in enumerate(cc.get('data') or []):
        ci = stream_count + dense_count + k
        c = chan(ci)
        c['times'].extend([start_time, stop_time])
        c['values'].extend([v, v])

    bindings = []
    unresolved = []
    for ci in sorted(chans):
        bnd, comp = find_binding(layout, ci)
        if bnd is None:
            unresolved.append(ci)
            continue
        type_id = bnd.get('typeID')
        attr = bnd.get('attribute')
        if type_id == 4:  # Transform
            path_hash = bnd.get('path')
            path = '' if path_hash == 0 else crc_map.get(path_hash, f'UNKNOWN_HASH_{path_hash}')
            if attr in COMPONENT_NAMES and comp < len(COMPONENT_NAMES[attr]):
                prop = COMPONENT_NAMES[attr][comp]
            else:
                prop = f'attr{attr}[{comp}]'
        else:
            path = ''
            prop = f'animatorFloat[{attr}]' if type_id == 95 else f'type{type_id}attr[{attr}]'
        c = chans[ci]
        bindings.append({'path': path, 'property': prop, 'channel': ci,
                         'times': c['times'], 'values': [round(v, 7) for v in c['values']]})

    out['bindings'] = bindings
    out['events'] = [{'time': e['time'], 'functionName': e.get('functionName'),
                      'data': e.get('data'), 'floatParameter': e.get('floatParameter'),
                      'intParameter': e.get('intParameter')} for e in ct.get('m_Events') or []]
    out['stats'] = {'streamedFramesTotal': len(frames), 'streamedFramesUsed': len(real_frames),
                    'streamedCurves': stream_count, 'denseCurves': dense_count,
                    'constantCurves': const_count, 'totalChannels': total_channels,
                    'channelsWithData': len(chans), 'unresolvedChannels': unresolved,
                    'bindingCount': len(gb)}
    return out


# -------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('prefab_name')
    ap.add_argument('bundle_path')
    ap.add_argument('output_dir')
    ap.add_argument('--pid', type=int, default=None, help='GameObject path_id (else search by name)')
    ap.add_argument('--lod', type=int, default=0)
    args = ap.parse_args()

    t_start = time.time()
    out_dir = os.path.abspath(args.output_dir)
    os.makedirs(out_dir, exist_ok=True)
    log(f'extract_character.py START prefab={args.prefab_name} bundle={args.bundle_path} out={out_dir}')

    b = Bundle(args.bundle_path)
    log(f'  bundle loaded: {len(b.idx)} objects ({time.time()-t_start:.1f}s)')

    # ---- locate logic prefab ----
    go = b.idx[args.pid] if args.pid else b.find_gameobject_by_name(args.prefab_name)
    if go is None:
        log(f'  FATAL: prefab {args.prefab_name} not found'); sys.exit(1)
    logic_pid = go.path_id
    assert go.read().m_Name == args.prefab_name or args.pid

    # ---- resolve visual prefab via PrefabLoader ----
    visual_pid = logic_pid
    logic_tt = b.tt(logic_pid)
    for c in logic_tt['m_Component']:
        cpid = ref_pid(c['component'])
        if b.idx[cpid].type.name == 'MonoBehaviour' and b.comp_class(b.idx[cpid]) == 'PrefabLoader':
            pl = b.tt(cpid)
            lst = pl.get('prefabList') or []
            if lst:
                visual_pid = ref_pid(lst[0])
    visual_name = b.name_of(visual_pid)
    log(f'  logic prefab: {args.prefab_name} ({logic_pid}); visual prefab: {visual_name} ({visual_pid})')

    # ---- Stage A: component inventory ----
    logic_inv = component_inventory(b, logic_pid, 'logic')
    visual_inv = component_inventory(b, visual_pid, 'visual')
    inv = {'prefabName': args.prefab_name, 'bundlePath': args.bundle_path,
           'logicPrefab': logic_inv, 'visualPrefab': visual_inv,
           'visualResolvedVia': 'PrefabLoader.prefabList[0]' if visual_pid != logic_pid else 'self'}
    # EnemyBase cross-reference (match by component path_id; the decomp JSON's
    # __gameObject field is None due to a UnityPy API change in the old script)
    try:
        eb_path = '/srv/opencode/ps3-pixeljunk-monsters2/decomp/data/enemies_EnemyBase.json'
        ebs = json.load(open(eb_path))
        eb_pids = {c['path_id'] for n in logic_inv['nodes'] for c in n['components']
                   if c.get('scriptClass') == 'EnemyBase'}
        match = [r for r in ebs if r.get('__path_id') in eb_pids
                 or r.get('__gameObject') == args.prefab_name]
        if match:
            inv['enemyBaseCrossRef'] = match[0]
            inv['enemyBaseCrossRefMatchedBy'] = 'path_id'
    except Exception as e:
        inv['enemyBaseCrossRef'] = f'unavailable: {e}'
    with open(os.path.join(out_dir, 'components.json'), 'w') as f:
        json.dump(inv, f, indent=1, default=str)
    comp_types = {}
    for n in visual_inv['nodes'] + logic_inv['nodes']:
        for c in n['components']:
            k = c.get('scriptClass') or c['type']
            comp_types[k] = comp_types.get(k, 0) + 1
    log(f'  STAGE A ok: components.json ({len(logic_inv["nodes"])} logic + {len(visual_inv["nodes"])} visual nodes; '
        f'component types: {sorted(comp_types.items(), key=lambda kv: -kv[1])})')

    # ---- find Animator + SMR (LOD n) ----
    visual_nodes = visual_inv['nodes']
    anim_node = next((n for n in visual_nodes
                      if any(c['type'] == 'Animator' for c in n['components'])), None)
    smr_nodes = [n for n in visual_nodes
                 if any(c['type'] == 'SkinnedMeshRenderer' for c in n['components'])]
    lod_tag = f'LOD{args.lod}'
    smr_node = next((n for n in smr_nodes if lod_tag in n['name']), smr_nodes[0] if smr_nodes else None)
    if smr_node is None:
        log('  FATAL: no SkinnedMeshRenderer in visual prefab'); sys.exit(1)
    smr_pid = next(c['path_id'] for c in smr_node['components'] if c['type'] == 'SkinnedMeshRenderer')
    log(f'  animator node: {anim_node["name"] if anim_node else None}; mesh node: {smr_node["name"]}')

    # ---- Stage B: GLB ----
    glb_path = os.path.join(out_dir, f'{args.prefab_name}.glb')
    stats = export_glb(b, visual_nodes, smr_pid, glb_path,
                       generator='pjm2-web extract_character.py (UnityPy + hand-rolled glTF)')
    log(f'  STAGE B ok: {os.path.basename(glb_path)} {os.path.getsize(glb_path)} bytes — '
        f"{stats['vertices']} verts, {stats['triangles']} tris, {stats['joints']} joints, "
        f"tangents={stats['tangents']}, unity={stats['unityVersion']}, meshNodeIdentity={stats['meshNodeGlobalIsIdentity']}")
    with open(os.path.join(out_dir, 'glb_stats.json'), 'w') as f:
        json.dump(stats, f, indent=1)

    # ---- Stage C: textures ----
    mat_pids = []
    for n in visual_nodes:
        for c in n['components']:
            if c['type'] == 'SkinnedMeshRenderer':
                tt = b.tt(c['path_id'])
                for m in tt.get('m_Materials', []):
                    mp = ref_pid(m)
                    if mp and mp not in mat_pids:
                        mat_pids.append(mp)
    tex_dir = os.path.join(out_dir, 'textures')
    tex_infos = export_textures(b, mat_pids, tex_dir)
    pngs = [t for t in tex_infos if t.get('png')]
    errs = [t for t in tex_infos if t.get('error')]
    fmts = sorted({(t['textureName'], t['textureFormat'], t['textureFormatName']) for t in tex_infos if 'textureName' in t})
    log(f'  STAGE C {"ok" if not errs else "PARTIAL"}: {len(pngs)} PNGs exported '
        f'({sum(t.get("pngBytes", 0) for t in pngs)} bytes total), {len(errs)} errors; formats: {fmts}')
    for e in errs:
        log(f'    texture ERROR {e.get("textureName")}: {e.get("error")}')

    # ---- Stage D: animation clips ----
    clips_out = []
    anim_pid = next((c['path_id'] for c in (anim_node['components'] if anim_node else [])
                     if c['type'] == 'Animator'), None)
    controller_name = avatar_name = None
    avatar_type = 'unknown'
    clip_pids = []
    if anim_pid:
        at = b.tt(anim_pid)
        cpid, avid = ref_pid(at.get('m_Controller')), ref_pid(at.get('m_Avatar'))
        controller_name, avatar_name = b.name_of(cpid), b.name_of(avid)
        if cpid in b.idx:
            act = b.tt(cpid)
            seen = set()
            for c in act.get('m_AnimationClips') or []:
                p = ref_pid(c)
                if p and p not in seen:
                    seen.add(p); clip_pids.append(p)
        if avid in b.idx:
            avt = b.tt(avid)['m_Avatar']
            hb = ((avt.get('m_Human') or {}).get('data') or {}).get('m_HumanBoneIndex') or []
            avatar_type = 'Humanoid' if any(x >= 0 for x in hb) else 'Generic'
    # name-matched extras (clips not in controller, e.g. used via overrides/events)
    prefix = visual_name.split('_')[0] if visual_name else args.prefab_name.split('_')[0]
    for o in b.env.objects:
        if o.type.name == 'AnimationClip' and o.path_id not in clip_pids:
            try:
                n = o.read().m_Name
            except Exception:
                continue
            if n.startswith(prefix + '_') or n.startswith(prefix + '@'):
                clip_pids.append(o.path_id)

    animator_go_pid = anim_node['path_id'] if anim_node else visual_pid
    crc_map = build_crc_map(b, animator_go_pid, visual_nodes)
    t0 = time.time()
    for cpid in clip_pids:
        try:
            clips_out.append(decode_clip(b, b.idx[cpid], crc_map, visual_nodes))
        except Exception as e:
            clips_out.append({'clipName': f'ERROR_{cpid}', 'error': f'{type(e).__name__}: {e}'})
    clips_doc = {
        'prefab': args.prefab_name, 'visualPrefab': visual_name,
        'animator': {'controller': controller_name, 'avatar': avatar_name, 'avatarType': avatar_type,
                     'animatorGameObject': anim_node['name'] if anim_node else None},
        'conventions': {
            'space': 'RAW Unity values (left-handed, Y-up). Convert at load: '
                     'position x -> -x; quaternion (x,y,z,w) -> (x,-y,-z,w); euler (x,y,z) -> (x,-y,-z)',
            'paths': 'transform paths relative to the Animator GameObject',
            'times': 'seconds from clip start',
            'constants': 'constant channels exported as 2 keyframes (startTime, stopTime)',
            'sentinelFrames': 'first/last StreamedClip frames (time=+/-FLT_MAX) skipped, as in AssetStudio',
            'slopes': 'NOT exported (coeff[1]/coeff[2] in-slope/out-slope dropped; values only)',
        },
        'clipNames': [c.get('clipName') for c in clips_out],
        'clips': clips_out,
    }
    with open(os.path.join(out_dir, 'clips.json'), 'w') as f:
        json.dump(clips_doc, f, indent=1, default=str)
    kb = os.path.getsize(os.path.join(out_dir, 'clips.json')) // 1024
    ok_clips = [c for c in clips_out if 'error' not in c]
    tot_keys = sum(len(bd['times']) for c in ok_clips for bd in c.get('bindings', []))
    log(f'  STAGE D ok: clips.json {kb} KB — {len(ok_clips)}/{len(clip_pids)} clips '
        f'({tot_keys} keyframes, {time.time()-t0:.1f}s); names: {clips_doc["clipNames"]}')

    # ---- Stage E: manifest ----
    manifest = {'generatedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'source': {'bundle': args.bundle_path,
                           'bundleBytes': os.path.getsize(args.bundle_path),
                           'prefab': args.prefab_name, 'prefabPathId': logic_pid,
                           'visualPrefab': visual_name, 'visualPathId': visual_pid,
                           'unityVersion': '.'.join(str(x) for x in (b.unity_version or ())[:3])},
                'coordinateConvention': 'glTF outputs mirrored Unity->glTF (X negated, winding flipped, V flipped); clips.json raw Unity',
                'files': []}
    for root, _, files in os.walk(out_dir):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            if os.path.abspath(p) == os.path.abspath(os.path.join(out_dir, 'manifest.json')):
                continue
            h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
            manifest['files'].append({'path': os.path.relpath(p, out_dir),
                                      'bytes': os.path.getsize(p), 'sha256': h})
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    log(f'  STAGE E ok: manifest.json ({len(manifest["files"])} files)')
    log(f'extract_character.py DONE in {time.time()-t_start:.1f}s')


if __name__ == '__main__':
    main()
