#!/usr/bin/env python3
"""Extract the STATIC stage scene for pjm2-web (Three.js) from the shipped `stages`
AssetBundle (user's own PS4 copy, read-only).

Scope: ONE stage scene (default 3d_stage_001 = the true first level, verified in
decomp/data/stage_scene_attribution.json). Walks the full GameObject hierarchy and
exports a Three.js-loadable scene graph: local transforms + mesh binary buffers +
material/texture references (textures decoded to PNG).

Usage:
    /srv/opencode/venv-unity/bin/python extract_stage_scene.py \
        [stage_scene_name] [--bundle PATH] [--out DIR] [--media-dir PATH] \
        [--manifest PATH]

Defaults:
    stage      = 3d_stage_001
    bundle     = <repo>/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages
    out        = <repo>/pjm2-web/public/assets/stages/3d_stage_001
    media-dir  = <repo>/game/extracted/CUSA11967/Media
    manifest   = <repo>/decomp/data/stage_scene_manifest.json

COORDINATES / HANDEDNESS (established convention — KEEP):
    Unity LEFT-HANDED Y-up coordinates are kept AS-IS in the data. The renderer
    converts to a right-handed frame later; never the sim/physics data. Triangle
    winding is preserved (verified vs baked normals in the collider spike). Mesh
    vertices are NOT pre-scaled: we store local transforms + raw mesh data and let
    the loader compose (per the scene-graph task). The ONLY exception is Unity
    static-batched "Combined Mesh" geometry, which is baked in WORLD space by the
    engine — those render entries carry worldSpace=true and must be drawn with an
    identity transform (see STATIC BATCHING below).

STATIC BATCHING (the key discovery for stages):
    Most stage props are combined at build time into a handful of "Combined Mesh
    (root: scene)" assets. Each MeshRenderer that references a combined mesh carries
    m_StaticBatchInfo {firstSubMesh, subMeshCount} telling exactly which submesh(es)
    of the combined mesh it draws. The combined mesh vertices are pre-transformed to
    world space (m_StaticBatchRoot == 0 for every batched renderer here), and the
    referencing GameObject transforms are left at their authored values but are NOT
    applied at draw time. Verified geometrically: a prop's submesh bbox center matches
    its GameObject world position (constant pivot offset). Therefore:
      - export each combined mesh ONCE (all submeshes), world-space baked;
      - each batched render entry records subMesh={first,count} and worldSpace=true;
      - the loader draws batched geometry at IDENTITY and slices the submesh range.
    Non-batched renderers (m_StaticBatchInfo.subMeshCount==0) draw their whole mesh
    with the composed node world transform, as usual.

LOD:
    LODGroup renderers are tagged with lodLevel (0..n). Only lodLevel==0 (and
    non-LOD renderers, lodLevel==null) should be rendered; higher LODs are recorded
    for completeness but skipped by the loader. Combined meshes contain all LODs'
    geometry; the subMesh slice + lodLevel filter selects the right one.

COLOR SPACE (corrects the asset-spike note):
    Texture2D.m_ColorSpace: 1 = sRGB/gamma-encoded data (albedo), 0 = linear data
    (normal maps). Confirmed empirically: normal maps are cs=0 with mean ~127.5,
    albedo cs=1. PNGs hold the RAW decoded values (no conversion). For three.js set
    texture.colorSpace = SRGBColorSpace when colorSpace==1 else NoColorSpace — this
    reproduces Unity's GPU sampling exactly. (The earlier SPIKE_REPORT §4.3 labelled
    cs=1 as "linear"; that was a misread — the data is sRGB-encoded and three.js's
    SRGBColorSpace flag decodes it correctly, no manual re-encode needed.)

TEXTURE ORIENTATION:
    UnityPy .image decodes with a vertical flip (visually-upright PNG). Combined with
    three.js's default flipY=true and Unity UVs (v=0 at bottom), orientation is
    correct. Do not flip again.
"""

import argparse
import array
import collections
import hashlib
import json
import math
import os
import re
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
DEFAULT_BUNDLE = os.path.join(AB, 'stages')
DEFAULT_MEDIA = os.path.join(REPO, 'game/extracted/CUSA11967/Media')
DEFAULT_OUT = os.path.join(REPO, 'pjm2-web/public/assets/stages/3d_stage_001')
DEFAULT_MANIFEST = os.path.join(REPO, 'decomp/data/stage_scene_manifest.json')

# Auxiliary files needed to resolve cross-bundle PPtrs for THIS scene:
#   structures -> home_001_m material + textures (CAB-1e64b90a...)
#   props      -> stone_001_m material + textures (CAB-90733f0f...)
#   nature     -> terrain/river custom shader names (CAB-5d3f32cf...)
#   unity default resources -> builtin Cube/Sphere meshes + Default-Material
AUX_BUNDLES = ['structures', 'props', 'nature']
AUX_MEDIA = ['Resources/unity default resources']

COLLIDER_KINDS = {
    'MeshCollider': 'mesh', 'BoxCollider': 'box', 'SphereCollider': 'sphere',
    'CapsuleCollider': 'capsule', 'TerrainCollider': 'terrain', 'EdgeCollider': 'edge',
    'WheelCollider': 'wheel', 'CharacterController': 'character',
}

TEX_FORMAT_NAMES = {10: 'DXT1/BC1', 12: 'DXT5/BC3', 24: 'BC6H', 25: 'BC7', 26: 'BC4'}


def sanitize(s):
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', s).strip('_') or 'unnamed'


def make_id(name, used, pid):
    base = sanitize(name)
    mid = base
    if mid in used:
        mid = f'{base}_{pid}'
    n = 2
    while mid in used:
        mid = f'{base}_{pid}_{n}'; n += 1
    used.add(mid)
    return mid


def ref_pid(p):
    return p.path_id if p is not None else 0


# ------------------------------------------------------------------ TRS math
def trs_matrix(pos, rot, scale):
    x, y, z, w = rot
    r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
         2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
         2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    sx, sy, sz = scale
    return [r[0] * sx, r[1] * sy, r[2] * sz, pos[0],
            r[3] * sx, r[4] * sy, r[5] * sz, pos[1],
            r[6] * sx, r[7] * sy, r[8] * sz, pos[2],
            0, 0, 0, 1]


def mat_mul(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4))
            for r in range(4) for c in range(4)]


def load_tag_manager_layers(media_dir):
    import UnityPy
    env = UnityPy.load(os.path.join(media_dir, 'globalgamemanagers'))
    for o in env.objects:
        if o.type.name == 'TagManager':
            d = o.read()
            names = list(getattr(d, 'layers', None) or getattr(d, 'm_Layers'))
            return (names + [''] * 32)[:32]
    raise RuntimeError('TagManager not found')


def find_scene_file(bundle, stage):
    exact = f'BuildPlayer-{stage}_env'
    if exact in bundle.files and hasattr(bundle.files[exact], 'objects'):
        return exact, bundle.files[exact]
    cands = [(n, f) for n, f in bundle.files.items()
             if hasattr(f, 'objects') and n.endswith(f'{stage}_env')
             and '.sharedAssets' not in n and '.resource' not in n]
    if not cands:
        raise RuntimeError(f'no scene file for stage {stage!r}')
    cands.sort(key=lambda nf: (len(nf[0]), nf[0]))
    return cands[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('stage', nargs='?', default='3d_stage_001')
    ap.add_argument('--bundle', default=DEFAULT_BUNDLE)
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--media-dir', default=DEFAULT_MEDIA)
    ap.add_argument('--manifest', default=DEFAULT_MANIFEST)
    args = ap.parse_args()

    import UnityPy
    from UnityPy.helpers.MeshHelper import MeshHandler
    from UnityPy.enums import TextureFormat

    os.makedirs(args.out, exist_ok=True)
    mesh_dir = os.path.join(args.out, 'meshes'); os.makedirs(mesh_dir, exist_ok=True)
    tex_dir = os.path.join(args.out, 'textures'); os.makedirs(tex_dir, exist_ok=True)

    t0 = time.time()
    print(f'[scene] loading bundle {args.bundle} ...', flush=True)
    env = UnityPy.load(args.bundle)
    bundle = env.files[args.bundle]
    aux_loaded = []
    for b in AUX_BUNDLES:
        p = os.path.join(os.path.dirname(args.bundle), b)
        if os.path.exists(p):
            env.load_file(p); aux_loaded.append(b)
    for m in AUX_MEDIA:
        p = os.path.join(args.media_dir, m)
        if os.path.exists(p):
            env.load_file(p); aux_loaded.append(m)
    print(f'[scene] loaded in {time.time()-t0:.1f}s (aux: {aux_loaded})', flush=True)

    unity_layers = load_tag_manager_layers(args.media_dir)
    scene_name, sf = find_scene_file(bundle, args.stage)
    objs = sf.objects
    print(f'[scene] scene file {scene_name}: {len(objs)} objects', flush=True)

    # ---- index components ---------------------------------------------------
    gos, trs = {}, {}
    tr_by_go, go_by_tr = {}, {}
    mf_by_go, mr_by_go = {}, {}
    mr_obj_by_go = {}
    colliders_by_go = collections.defaultdict(list)
    meshcolliders = []
    rb_gos, anim_gos = set(), set()
    lodgroups = []
    lights, render_settings = [], None
    type_counts = collections.Counter()
    for o in objs.values():
        t = o.type.name
        type_counts[t] += 1
        if t == 'GameObject':
            gos[o.path_id] = o.read()
        elif t == 'Transform':
            d = o.read(); trs[o.path_id] = d
            tr_by_go[d.m_GameObject.path_id] = o.path_id
            go_by_tr[o.path_id] = d.m_GameObject.path_id
        elif t == 'MeshFilter':
            d = o.read(); mf_by_go[d.m_GameObject.path_id] = d
        elif t == 'MeshRenderer':
            d = o.read(); mr_by_go[d.m_GameObject.path_id] = d
            mr_obj_by_go[d.m_GameObject.path_id] = o
        elif t in COLLIDER_KINDS:
            d = o.read(); colliders_by_go[d.m_GameObject.path_id].append(COLLIDER_KINDS[t])
            if t == 'MeshCollider':
                meshcolliders.append(d)
        elif t == 'Rigidbody':
            rb_gos.add(o.read().m_GameObject.path_id)
        elif t == 'Animator':
            anim_gos.add(o.read().m_GameObject.path_id)
        elif t == 'LODGroup':
            lodgroups.append((o.path_id, o.read()))
        elif t == 'Light':
            lights.append(o.read())
        elif t == 'RenderSettings':
            render_settings = o.read()

    # ---- node ordering: DFS from roots, serialized child order --------------
    children_by_tr = {pid: [c.path_id for c in d.m_Children] for pid, d in trs.items()}
    roots = sorted([pid for pid, d in trs.items()
                    if d.m_Father is None or d.m_Father.path_id == 0])
    nodes = []
    node_by_go, node_by_tr = {}, {}

    def visit(tr_pid, parent_idx):
        d = trs[tr_pid]
        go_pid = d.m_GameObject.path_id
        g = gos.get(go_pid)
        idx = len(nodes)
        p, r, s = d.m_LocalPosition, d.m_LocalRotation, d.m_LocalScale
        layer = int(g.m_Layer) if g else 0
        node = {
            'i': idx,
            'name': g.m_Name if g else f'<no-go:{go_pid}>',
            'pathId': go_pid,
            'transformPathId': tr_pid,
            'parent': parent_idx,
            'activeSelf': bool(g.m_IsActive) if g else False,
            'activeInHierarchy': True,  # filled below
            'layer': layer,
            'layerName': unity_layers[layer] if 0 <= layer < 32 else f'?{layer}',
            'pos': [p.x, p.y, p.z],
            'rot': [r.x, r.y, r.z, r.w],
            'scale': [s.x, s.y, s.z],
            'colliders': colliders_by_go.get(go_pid) or None,
            'rigidbody': go_pid in rb_gos,
            'animator': go_pid in anim_gos,
            'lodGroup': None,
            'render': None,
        }
        nodes.append(node)
        node_by_go[go_pid] = idx
        node_by_tr[tr_pid] = idx
        for c in children_by_tr.get(tr_pid, []):
            if c in trs:
                visit(c, idx)

    for rpid in roots:
        visit(rpid, -1)
    # activeInHierarchy via parent chain
    for n in nodes:
        a = n['activeSelf']
        p = n['parent']
        while a and p >= 0:
            a = nodes[p]['activeSelf']; p = nodes[p]['parent']
        n['activeInHierarchy'] = a
    print(f'[scene] nodes: {len(nodes)} (GameObjects: {len(gos)})', flush=True)

    # ---- LOD level per renderer --------------------------------------------
    lodlevel_by_renderer = {}
    for lg_pid, lg in lodgroups:
        for i, lod in enumerate(lg.m_LODs):
            for lr in lod.renderers:
                rpid = ref_pid(lr.renderer)
                if rpid:
                    lodlevel_by_renderer[rpid] = min(i, lodlevel_by_renderer.get(rpid, i))
        g_pid = lg.m_GameObject.path_id
        if g_pid in node_by_go:
            nodes[node_by_go[g_pid]]['lodGroup'] = {
                'lodCount': len(lg.m_LODs),
                'lods': [{'screenRelativeHeight': lod.screenRelativeHeight,
                          'renderers': [node_by_go.get(go_by_tr.get(ref_pid(lr.renderer)))
                                        for lr in lod.renderers if ref_pid(lr.renderer)]}
                         for lod in lg.m_LODs],
            }

    # ---- export caches ------------------------------------------------------
    meshes_out, materials_out, textures_out = {}, {}, {}
    mesh_cache, mat_cache, tex_cache = {}, {}, {}
    mesh_ids, mat_ids, tex_ids = set(), set(), set()
    skipped = collections.Counter()
    warnings = []

    def write_f32(path, vals):
        a = array.array('f', vals)
        if sys.byteorder != 'little':
            a.byteswap()
        with open(path, 'wb') as f:
            a.tofile(f)

    def export_mesh(pptr, collider_only=False):
        key = None
        try:
            mesh = pptr.read()
        except Exception as e:
            skipped['mesh-unresolved'] += 1
            warnings.append(f'mesh resolve fail pid={pptr.path_id}: {e}')
            return None
        key = (mesh.assets_file.name, pptr.path_id)
        if key in mesh_cache:
            return mesh_cache[key]
        try:
            h = MeshHandler(mesh); h.process()
        except Exception as e:
            skipped['mesh-process-fail'] += 1
            warnings.append(f'mesh process fail {mesh.m_Name}: {e}')
            mesh_cache[key] = None
            return None
        if not h.m_Vertices:
            skipped['mesh-empty'] += 1
            mesh_cache[key] = None
            return None
        tris = h.get_triangles()
        submeshes, flat = [], []
        for sub, sm in zip(tris, mesh.m_SubMeshes):
            first = len(flat)
            for a, b, c in sub:
                flat.extend((a, b, c))
            submeshes.append({'firstIndex': first, 'indexCount': len(flat) - first,
                              'topology': int(sm.topology)})
        mid = make_id(mesh.m_Name, mesh_ids, pptr.path_id)
        files = {}
        vs = h.m_Vertices
        write_f32(os.path.join(mesh_dir, f'{mid}.pos.f32.bin'),
                  [c for v in vs for c in (v[0], v[1], v[2])])
        files['pos'] = f'meshes/{mid}.pos.f32.bin'
        if h.m_Normals:
            write_f32(os.path.join(mesh_dir, f'{mid}.nrm.f32.bin'),
                      [c for v in h.m_Normals for c in (v[0], v[1], v[2])])
            files['nrm'] = f'meshes/{mid}.nrm.f32.bin'
        if h.m_UV0:
            write_f32(os.path.join(mesh_dir, f'{mid}.uv0.f32.bin'),
                      [c for v in h.m_UV0 for c in (v[0], v[1])])
            files['uv0'] = f'meshes/{mid}.uv0.f32.bin'
        if h.m_Tangents:
            write_f32(os.path.join(mesh_dir, f'{mid}.tan.f32.bin'),
                      [c for v in h.m_Tangents for c in (v[0], v[1], v[2], v[3])])
            files['tan'] = f'meshes/{mid}.tan.f32.bin'
        ia = array.array('I', flat)
        if sys.byteorder != 'little':
            ia.byteswap()
        with open(os.path.join(mesh_dir, f'{mid}.idx.u32.bin'), 'wb') as f:
            ia.tofile(f)
        files['idx'] = f'meshes/{mid}.idx.u32.bin'
        xs = [v[0] for v in vs]; ys = [v[1] for v in vs]; zs = [v[2] for v in vs]
        combined = mesh.m_Name.startswith('Combined Mesh')
        meshes_out[mid] = {
            'name': mesh.m_Name, 'sourceFile': key[0], 'pathId': key[1],
            'vertexCount': len(vs), 'indexCount': len(flat),
            'triangleCount': len(flat) // 3, 'submeshes': submeshes,
            'files': files, 'channels': list(files.keys()),
            'bounds': {'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]},
            'combined': combined, 'bakedWorldSpace': combined,
            'colliderOnly': collider_only,
        }
        mesh_cache[key] = mid
        return mid

    def export_texture(pptr):
        try:
            t = pptr.read()
        except Exception as e:
            skipped['texture-unresolved'] += 1
            warnings.append(f'texture resolve fail pid={pptr.path_id}: {e}')
            return None
        key = (t.assets_file.name, pptr.path_id)
        if key in tex_cache:
            return tex_cache[key]
        tid = make_id(t.m_Name, tex_ids, pptr.path_id)
        fmt = int(t.m_TextureFormat)
        rec = {
            'name': t.m_Name, 'sourceFile': key[0], 'pathId': key[1],
            'width': t.m_Width, 'height': t.m_Height,
            'format': fmt, 'formatName': TEX_FORMAT_NAMES.get(fmt, TextureFormat(fmt).name),
            'colorSpace': getattr(t, 'm_ColorSpace', None),
            'mipCount': getattr(t, 'm_MipCount', None),
        }
        try:
            img = t.image
            fn = f'{tid}.png'
            img.save(os.path.join(tex_dir, fn))
            rec['file'] = f'textures/{fn}'
            rec['bytes'] = os.path.getsize(os.path.join(tex_dir, fn))
            rec['pngMode'] = img.mode
            if fmt == 24:
                rec['note'] = 'BC6H HDR clamped to LDR PNG by decoder'
        except Exception as e:
            skipped['texture-decode-fail'] += 1
            rec['error'] = f'{type(e).__name__}: {e}'
            warnings.append(f'texture decode fail {t.m_Name}: {e}')
        textures_out[tid] = rec
        tex_cache[key] = tid
        return tid

    def export_material(pptr):
        try:
            mat = pptr.read()
        except Exception as e:
            skipped['material-unresolved'] += 1
            warnings.append(f'material resolve fail pid={pptr.path_id}: {e}')
            return None
        key = (mat.assets_file.name, pptr.path_id)
        if key in mat_cache:
            return mat_cache[key]
        mid = make_id(mat.m_Name, mat_ids, pptr.path_id)
        shader_name, shader_src, shader_pid = None, None, ref_pid(mat.m_Shader)
        if shader_pid:
            try:
                sh = mat.m_Shader.read()
                shader_name = sh.m_Name
                shader_src = sh.assets_file.name
                if not shader_name:
                    stt = mat.m_Shader.read_typetree()
                    shader_name = (stt.get('m_ParsedForm') or {}).get('m_Name') or None
            except Exception as e:
                skipped['shader-unresolved'] += 1
                warnings.append(f'shader resolve fail for {mat.m_Name}: {e}')
        texmap = {}
        for slot, props in mat.m_SavedProperties.m_TexEnvs:
            tref = props.m_Texture
            if tref is None or tref.path_id == 0:
                continue
            tid = export_texture(tref)
            if tid:
                texmap[slot] = {'texture': tid,
                                'scale': [props.m_Scale.x, props.m_Scale.y],
                                'offset': [props.m_Offset.x, props.m_Offset.y]}
        materials_out[mid] = {
            'name': mat.m_Name, 'sourceFile': key[0], 'pathId': key[1],
            'shader': {'name': shader_name, 'sourceFile': shader_src, 'pathId': shader_pid},
            'renderQueue': mat.m_CustomRenderQueue,
            'keywords': mat.m_ShaderKeywords,
            'lightmapFlags': mat.m_LightmapFlags,
            'textures': texmap,
            'floats': {k: v for k, v in mat.m_SavedProperties.m_Floats},
            'colors': {k: [v.r, v.g, v.b, v.a] for k, v in mat.m_SavedProperties.m_Colors},
        }
        mat_cache[key] = mid
        return mid

    # ---- render entries -----------------------------------------------------
    render_count = 0
    for go_pid, mr in mr_by_go.items():
        if go_pid not in node_by_go:
            skipped['renderer-no-node'] += 1
            continue
        node = nodes[node_by_go[go_pid]]
        mf = mf_by_go.get(go_pid)
        mesh_id = None
        if mf is not None and ref_pid(mf.m_Mesh):
            mesh_id = export_mesh(mf.m_Mesh)
        mat_list = []
        for p in mr.m_Materials:
            if ref_pid(p) == 0:
                mat_list.append(None)
            else:
                mat_list.append(export_material(p))
        tt = mr_obj_by_go[go_pid].read_typetree()
        sbi = tt.get('m_StaticBatchInfo') or {}
        first, count = sbi.get('firstSubMesh', 0), sbi.get('subMeshCount', 0)
        batch_root = ref_pid_from(tt.get('m_StaticBatchRoot'))
        world_space = count > 0 and batch_root == 0
        if count > 0 and batch_root != 0:
            warnings.append(f'batched renderer {node["name"]} has non-zero batchRoot {batch_root}')
        mr_pid = mr_obj_by_go[go_pid].path_id
        node['render'] = {
            'mesh': mesh_id,
            'materials': mat_list,
            'enabled': bool(mr.m_Enabled),
            'lodLevel': lodlevel_by_renderer.get(mr_pid),
            'worldSpace': world_space,
            'subMesh': {'first': first, 'count': count} if count > 0 else None,
            'castShadows': int(mr.m_CastShadows),
            'receiveShadows': int(mr.m_ReceiveShadows),
        }
        render_count += 1

    # ---- collider-only meshes (cross-check w/ physics spike) ---------------
    for mc in meshcolliders:
        if ref_pid(mc.m_Mesh):
            export_mesh(mc.m_Mesh, collider_only=True)

    # ---- lights / render settings ------------------------------------------
    lights_out = []
    for L in lights:
        g_pid = L.m_GameObject.path_id
        lights_out.append({
            'name': gos[g_pid].m_Name if g_pid in gos else '?',
            'node': node_by_go.get(g_pid),
            'type': int(L.m_Type), 'enabled': bool(L.m_Enabled),
            'color': [L.m_Color.r, L.m_Color.g, L.m_Color.b],
            'intensity': L.m_Intensity,
            'range': getattr(L, 'm_Range', None),
            'spotAngle': getattr(L, 'm_SpotAngle', None),
        })
    rs_out = None
    if render_settings is not None:
        amb = getattr(render_settings, 'm_AmbientLight', None)
        rs_out = {
            'fog': bool(getattr(render_settings, 'm_Fog', False)),
            'ambientMode': getattr(render_settings, 'm_AmbientMode', None),
            'ambientLight': [amb.r, amb.g, amb.b] if amb else None,
            'skyboxMaterial': ref_pid(getattr(render_settings, 'm_SkyboxMaterial', None)),
        }

    # ---- validation ---------------------------------------------------------
    validation = {}
    # terrain_001 collider mesh present with expected counts
    terr = next((m for m in meshes_out.values() if m['name'] == 'terrain_001'), None)
    validation['terrain_001'] = {
        'present': terr is not None,
        'vertexCount': terr['vertexCount'] if terr else None,
        'triangleCount': terr['triangleCount'] if terr else None,
        'expected': {'vertexCount': 10960, 'triangleCount': 21785},
        'pass': bool(terr and terr['vertexCount'] == 10960 and terr['triangleCount'] == 21785),
    }
    # every render mesh/material/texture ref resolves
    bad_mesh = [n['name'] for n in nodes if n['render'] and n['render']['mesh']
                and n['render']['mesh'] not in meshes_out]
    bad_mat, bad_tex = [], []
    for n in nodes:
        if not n['render']:
            continue
        for m in n['render']['materials']:
            if m and m not in materials_out:
                bad_mat.append(n['name'])
    for mat in materials_out.values():
        for slot, t in mat['textures'].items():
            if t['texture'] not in textures_out:
                bad_tex.append(f'{mat["name"]}.{slot}')
    validation['meshRefsResolve'] = not bad_mesh
    validation['materialRefsResolve'] = not bad_mat
    validation['textureRefsResolve'] = not bad_tex
    validation['badRefs'] = {'mesh': bad_mesh[:10], 'material': bad_mat[:10], 'texture': bad_tex[:10]}
    # submesh ranges within index buffer
    bad_sub = []
    for n in nodes:
        r = n['render']
        if r and r['subMesh'] and r['mesh'] in meshes_out:
            m = meshes_out[r['mesh']]
            if r['subMesh']['first'] + r['subMesh']['count'] > len(m['submeshes']):
                bad_sub.append(n['name'])
    validation['subMeshRangesValid'] = not bad_sub
    ws_noncombined = [n['name'] for n in nodes if n['render'] and n['render']['worldSpace']
                      and n['render']['mesh'] in meshes_out
                      and not meshes_out[n['render']['mesh']]['combined']]
    validation['worldSpaceAlwaysCombined'] = not ws_noncombined
    validation['nodeCount'] = len(nodes)
    validation['nodeCountMatchesGameObjects'] = len(nodes) == len(gos)

    # world-space bake spot check (one batched renderer)
    bake_check = None
    for n in nodes:
        r = n['render']
        if r and r['worldSpace'] and r['mesh'] in meshes_out and meshes_out[r['mesh']]['combined']:
            # compute world pos of node
            M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            chain = []
            cur = n
            while cur is not None:
                chain.append(cur); cur = nodes[cur['parent']] if cur['parent'] >= 0 else None
            for c in reversed(chain):
                M = mat_mul(M, trs_matrix(c['pos'], c['rot'], c['scale']))
            wp = (M[3], M[7], M[11])
            m = meshes_out[r['mesh']]
            # read submesh vertices back from the pos bin
            import struct
            with open(os.path.join(args.out, m['files']['pos']), 'rb') as f:
                posdata = f.read()
            with open(os.path.join(args.out, m['files']['idx']), 'rb') as f:
                idxdata = f.read()
            sm = m['submeshes'][r['subMesh']['first']]
            idxs = struct.unpack_from(f"<{sm['indexCount']}I", idxdata, sm['firstIndex'] * 4)
            vids = sorted(set(idxs))
            xs = [struct.unpack_from('<f', posdata, v * 12)[0] for v in vids]
            ys = [struct.unpack_from('<f', posdata, v * 12 + 4)[0] for v in vids]
            zs = [struct.unpack_from('<f', posdata, v * 12 + 8)[0] for v in vids]
            mnx, mxx, mny, mxy, mnz, mxz = min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
            cx, cy, cz = (mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2
            delta = math.sqrt((wp[0] - cx) ** 2 + (wp[1] - cy) ** 2 + (wp[2] - cz) ** 2)
            # Correct invariant for world-baked geometry: the object's authored pivot
            # (world pos) lies INSIDE its own submesh bbox. Pivot-to-center distance
            # varies with object height (tall props pivot at the base), so a fixed
            # center-distance threshold is wrong; containment is the robust check.
            eps = 0.05
            inside = (mnx - eps <= wp[0] <= mxx + eps and
                      mny - eps <= wp[1] <= mxy + eps and
                      mnz - eps <= wp[2] <= mxz + eps)
            bake_check = {'node': n['name'], 'worldPos': list(wp),
                          'subMeshBBoxCenter': [cx, cy, cz],
                          'subMeshBBox': {'min': [mnx, mny, mnz], 'max': [mxx, mxy, mxz]},
                          'centerDelta': delta, 'pivotInsideBBox': inside,
                          'pass': inside}
            break
    validation['worldSpaceBakeSpotCheck'] = bake_check

    # ---- assemble scene.json ------------------------------------------------
    meta = {
        'stage': args.stage, 'sceneFile': scene_name, 'bundle': args.bundle,
        'auxFiles': aux_loaded,
        'generatedBy': 'pjm2-web/tools/stages/extract_stage_scene.py',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'unityVersion': '5.6.5p1',
        'coordinateSystem': ('Unity LEFT-HANDED Y-up kept AS-IS; renderer converts to RH. '
                             'Triangle winding preserved.'),
        'staticBatching': ('Combined meshes are world-space baked; render entries with '
                           'worldSpace=true draw at IDENTITY and slice subMesh={first,count}. '
                           'Non-batched renderers compose node world transforms.'),
        'lodPolicy': 'Render only render.lodLevel==0 or null; higher LODs recorded but skipped.',
        'colorSpace': ('texture.colorSpace: 1=sRGB, 0=linear. PNGs hold raw values; set three.js '
                       'texture.colorSpace=SRGBColorSpace iff colorSpace==1 else NoColorSpace.'),
        'textureOrientation': 'UnityPy flip + three.js default flipY=true + Unity UVs = correct.',
        'visibility': ('Loader should skip nodes with activeInHierarchy==false and '
                       'render.enabled==false.'),
    }
    scene = {
        'meta': meta, 'unityLayers': unity_layers, 'nodes': nodes,
        'meshes': meshes_out, 'materials': materials_out, 'textures': textures_out,
        'lights': lights_out, 'renderSettings': rs_out,
        'skipped': dict(skipped), 'validation': validation,
    }
    scene_path = os.path.join(args.out, 'scene.json')
    with open(scene_path, 'w') as f:
        json.dump(scene, f, separators=(',', ':'))

    # ---- manifest -----------------------------------------------------------
    def dirsize(d):
        return sum(os.path.getsize(os.path.join(d, fn)) for fn in os.listdir(d))
    mesh_bytes = dirsize(mesh_dir); tex_bytes = dirsize(tex_dir)
    scene_bytes = os.path.getsize(scene_path)
    total = mesh_bytes + tex_bytes + scene_bytes
    lod0 = sum(1 for n in nodes if n['render'] and n['render']['lodLevel'] in (0, None)
               and n['render']['enabled'] and n['activeInHierarchy'])
    manifest = {
        'stage': args.stage, 'sceneFile': scene_name,
        'generatedBy': meta['generatedBy'], 'generatedAt': meta['generatedAt'],
        'source': {'bundle': args.bundle, 'sceneFile': scene_name, 'auxFiles': aux_loaded,
                   'meshes': [{'id': k, 'name': m['name'], 'sourceFile': m['sourceFile'],
                               'pathId': m['pathId']} for k, m in meshes_out.items()],
                   'materials': [{'id': k, 'name': m['name'], 'sourceFile': m['sourceFile'],
                                  'pathId': m['pathId']} for k, m in materials_out.items()],
                   'textures': [{'id': k, 'name': t['name'], 'sourceFile': t['sourceFile'],
                                 'pathId': t['pathId']} for k, t in textures_out.items()]},
        'counts': {'nodes': len(nodes), 'gameObjects': len(gos),
                   'meshFilters': type_counts['MeshFilter'], 'meshRenderers': type_counts['MeshRenderer'],
                   'renderEntries': render_count, 'renderableLOD0Active': lod0,
                   'lodGroups': type_counts['LODGroup'], 'uniqueMeshes': len(meshes_out),
                   'uniqueMaterials': len(materials_out), 'uniqueTextures': len(textures_out),
                   'lights': len(lights_out), 'animators': type_counts['Animator'],
                   'monoBehaviours': type_counts['MonoBehaviour'],
                   'colliders': sum(type_counts[k] for k in COLLIDER_KINDS)},
        'sizes': {'sceneJsonBytes': scene_bytes, 'meshBinBytes': mesh_bytes,
                  'texturePngBytes': tex_bytes, 'totalBytes': total},
        'outputs': {'scene': 'scene.json', 'meshes': 'meshes/', 'textures': 'textures/'},
        'validation': validation,
        'skipped': dict(skipped),
        'rerun': (f'/srv/opencode/venv-unity/bin/python pjm2-web/tools/stages/extract_stage_scene.py '
                  f'{args.stage}'),
        'sha256': {'scene.json': hashlib.sha256(open(scene_path, 'rb').read()).hexdigest()},
    }
    os.makedirs(os.path.dirname(args.manifest), exist_ok=True)
    with open(args.manifest, 'w') as f:
        json.dump(manifest, f, indent=1)
    # also drop a copy beside the outputs for a self-contained asset dir
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)

    # ---- summary ------------------------------------------------------------
    print('\n===== stage scene extraction summary =====')
    print(f'stage/scene:       {args.stage} / {scene_name}')
    print(f'nodes:             {len(nodes)}  (GameObjects {len(gos)})')
    print(f'render entries:    {render_count}  (renderable LOD0+active: {lod0})')
    print(f'unique meshes:     {len(meshes_out)}  (combined: '
          f'{sum(1 for m in meshes_out.values() if m["combined"])}, '
          f'colliderOnly: {sum(1 for m in meshes_out.values() if m["colliderOnly"])})')
    print(f'unique materials:  {len(materials_out)}')
    print(f'unique textures:   {len(textures_out)}')
    print(f'lights:            {len(lights_out)}')
    print(f'terrain_001:       {validation["terrain_001"]}')
    print(f'refs resolve:      mesh={validation["meshRefsResolve"]} '
          f'mat={validation["materialRefsResolve"]} tex={validation["textureRefsResolve"]} '
          f'submesh={validation["subMeshRangesValid"]} wsCombined={validation["worldSpaceAlwaysCombined"]}')
    print(f'world-bake check:  {bake_check}')
    print(f'sizes:             scene {scene_bytes/1e6:.2f} MB, meshes {mesh_bytes/1e6:.2f} MB, '
          f'textures {tex_bytes/1e6:.2f} MB, TOTAL {total/1e6:.2f} MB')
    print(f'output:            {args.out}')
    print(f'manifest:          {args.manifest}')
    if skipped:
        print(f'skipped:           {dict(skipped)}')
    if warnings:
        print(f'warnings ({len(warnings)}):')
        for w in warnings[:20]:
            print('   ', w)
    print(f'[scene] done in {time.time()-t0:.1f}s')


def ref_pid_from(d):
    if not d:
        return 0
    return d.get('m_PathID', 0)


if __name__ == '__main__':
    main()
