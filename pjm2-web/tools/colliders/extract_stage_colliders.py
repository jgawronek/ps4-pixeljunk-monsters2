#!/usr/bin/env python3
"""Extract static scene colliders for the pjm2-web physics layer (Rapier).

Reads a stage scene from the shipped `stages` AssetBundle (user's own PS4 copy,
read-only) with UnityPy and writes a compact JSON description plus binary mesh
buffers that `src/engine/physics/world.ts` loads into a Rapier query world.

Usage:
    /srv/opencode/venv-unity/bin/python extract_stage_colliders.py \
        [stage_scene_name] [--bundle PATH] [--out DIR] [--media-dir PATH]

Defaults:
    stage_scene_name = 3d_stage_001
    bundle   = <repo>/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages
    out      = <repo>/pjm2-web/.work/physics-spike
    media-dir= <repo>/game/extracted/CUSA11967/Media   (for globalgamemanagers TagManager)

COORDINATES / HANDEDNESS (important, documented per the physics-spike task):
    Unity is LEFT-HANDED Y-up. We KEEP Unity coordinates exactly as they are
    serialized — the parity ground truth (enemy m_pathList points from
    decomp/data/stage_waves_resolved.json) is also in Unity coordinates, so the
    physics world must live in that same frame. Conversion to a right-handed
    frame (if any) belongs to the renderer only, never to the sim/physics data.
    Keeping the numbers untouched is safe because Unity's vector/quaternion
    algebra is formula-identical to the standard (right-handed) algebra; only
    the *interpretation* of the frame differs. Empirical check performed on
    terrain_001 (stage 001): the right-hand-rule face normal (b-a)x(c-a) of the
    Unity-wound triangles agrees with Unity's own baked vertex normals on
    1999/2000 sampled triangles, i.e. Rapier fed with Unity index order computes
    the same normals Unity reports — do NOT flip winding, do NOT negate normals.

Q4.Layers PROVENANCE (differs from the original task assumption — honest note):
    The task brief said the Q4.Layers singleton is a MonoBehaviour serialized in
    the `globalsettings` bundle. That is NOT the case: exhaustive scans of
    globalsettings, main_assets, PS4, level0..3, resources.assets and the stages
    scene files found no 'Layers' MonoScript and no serialized TerrainMask
    anywhere. Q4.Layers is a plain lazily-constructed C# singleton
    (decomp/il2cpp_user/dump.cs TypeDefIndex 3091) whose .ctor
    (decomp/decompiled/Q4.Layers.c @ 0x004694F0) computes every Index with
    LayerMask.NameToLayer(<name>) and every Mask as (1<<Index) — TerrainMask
    being the only 3-layer OR:
        TerrainMask      = 1<<Art_Terrain | 1<<Art_LargeProps | 1<<Art_SmallProps
        LargeTerrainMask = 1<<Art_Terrain | 1<<Art_LargeProps
        LandscapeMask    = 1<<Art_Terrain
        WaterMask        = 1<<Water
        ... (all single-layer otherwise)
    Layer *names*→indices come from the TagManager in Media/globalgamemanagers.
    This script reproduces that .ctor exactly and dumps the result in the JSON
    header under "q4Layers", so nothing is hard-coded blind: change the tag
    manager and the masks follow.
"""

import argparse
import array
import collections
import json
import math
import os
import re
import struct
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_BUNDLE = os.path.join(
    REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages')
DEFAULT_MEDIA = os.path.join(REPO, 'game/extracted/CUSA11967/Media')
DEFAULT_OUT = os.path.join(REPO, 'pjm2-web/.work/physics-spike')

COLLIDER_KINDS = {
    'MeshCollider': 'mesh',
    'BoxCollider': 'box',
    'SphereCollider': 'sphere',
    'CapsuleCollider': 'capsule',
    'TerrainCollider': 'terrain',
    'EdgeCollider': 'edge',
    'WheelCollider': 'wheel',
    'CharacterController': 'character',
}
EXPORTED_KINDS = {'mesh', 'box', 'sphere', 'capsule'}

# ---------------------------------------------------------------- vector math
# Tiny internal helpers (pure python). NOTE: these mirror what src/engine/math
# will provide on the TS side; kept local so this tool has no in-repo deps.

def qmul(a, b):
    """Hamilton product of quaternions stored as (x, y, z, w) — Unity order."""
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )

def qrot(q, v):
    """Rotate vector v by quaternion q (x,y,z,w)."""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )

def mat_mul(a, b):
    """4x4 matrix multiply (row-major lists of 16)."""
    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            s = 0.0
            for k in range(4):
                s += a[r * 4 + k] * b[k * 4 + c]
            out[r * 4 + c] = s
    return out

def trs_matrix(pos, rot, scale):
    """Unity TRS as a column-major-style 4x4 (row-major list): M = T * R * S."""
    x, y, z, w = rot
    # rotation matrix from quaternion (standard formula, identical in Unity)
    r = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w),
        2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y),
    ]
    sx, sy, sz = scale
    return [
        r[0] * sx, r[1] * sy, r[2] * sz, pos[0],
        r[3] * sx, r[4] * sy, r[5] * sz, pos[1],
        r[6] * sx, r[7] * sy, r[8] * sz, pos[2],
        0.0,       0.0,       0.0,       1.0,
    ]

def decompose_trs(m):
    """Split a 4x4 (row-major list) into (pos, quat(xyzw), scale).

    Assumes no shear (true for Unity hierarchies that never mix non-uniform
    scale with rotation across ancestors — verified: all extracted collider
    scales come out axis-aligned; the loader asserts |R*R^T - I| implicitly by
    construction). Negative determinant (mirroring) folds into scale.x.
    """
    pos = (m[3], m[7], m[11])
    cols = [(m[0], m[4], m[8]), (m[1], m[5], m[9]), (m[2], m[6], m[10])]
    scale = [math.sqrt(sum(c * c for c in col)) for col in cols]
    det = (
        cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1])
        - cols[1][0] * (cols[0][1] * cols[2][2] - cols[0][2] * cols[2][1])
        + cols[2][0] * (cols[0][1] * cols[1][2] - cols[0][2] * cols[1][1])
    )
    if det < 0:
        scale[0] = -scale[0]
    r = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        s = scale[i] if abs(scale[i]) > 1e-12 else 1.0
        for j in range(3):
            r[j][i] = cols[i][j] / s
    quat = matrix_to_quat(r)
    return pos, quat, tuple(scale)

def matrix_to_quat(r):
    """Rotation matrix (r[row][col]) -> quaternion (x, y, z, w), Shepperd's method."""
    tr = r[0][0] + r[1][1] + r[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w = 0.25 * s
        x = (r[2][1] - r[1][2]) / s
        y = (r[0][2] - r[2][0]) / s
        z = (r[1][0] - r[0][1]) / s
    elif r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1.0 + r[0][0] - r[1][1] - r[2][2]) * 2
        w = (r[2][1] - r[1][2]) / s
        x = 0.25 * s
        y = (r[0][1] + r[1][0]) / s
        z = (r[0][2] + r[2][0]) / s
    elif r[1][1] > r[2][2]:
        s = math.sqrt(1.0 + r[1][1] - r[0][0] - r[2][2]) * 2
        w = (r[0][2] - r[2][0]) / s
        x = (r[0][1] + r[1][0]) / s
        y = 0.25 * s
        z = (r[1][2] + r[2][1]) / s
    else:
        s = math.sqrt(1.0 + r[2][2] - r[0][0] - r[1][1]) * 2
        w = (r[1][0] - r[0][1]) / s
        x = (r[0][2] + r[2][0]) / s
        y = (r[1][2] + r[2][1]) / s
        z = 0.25 * s
    q = (x, y, z, w)
    n = math.sqrt(sum(c * c for c in q))
    return tuple(c / n for c in q)

def compose_world(local, parent):
    """World TRS from local (pos, quat, scale) and parent world TRS (or None)."""
    pos, rot, scale = local
    if parent is None:
        return pos, rot, scale
    ppos, prot, pscale = parent
    # M_world = M_parent * M_local  (compose matrices, then decompose — keeps
    # shear out by construction when the inputs are pure TRS)
    m = mat_mul(trs_matrix(ppos, prot, pscale), trs_matrix(pos, rot, scale))
    return decompose_trs(m)

# ---------------------------------------------------------------- Q4.Layers

# Field order from decomp/il2cpp_user/dump.cs (Q4.Layers, TypeDefIndex 3091) and
# mask composition from decomp/decompiled/Q4.Layers.c .ctor @0x004694F0.
LAYER_INDEX_FIELDS = [
    ('DefaultIndex', 'Default'),
    ('UIIndex', 'UI'),
    ('TerrainIndex', 'Art_Terrain'),
    ('PlayerAreaIndex', 'Art_PlayerArea'),
    ('LargePropsIndex', 'Art_LargeProps'),
    ('SmallPropsIndex', 'Art_SmallProps'),
    ('PlayersIndex', 'Players'),
    ('EnemiesIndex', 'Enemies'),
    ('TriggerToPlayerIndex', 'TriggerToPlayer'),
    ('TriggerToEnemyIndex', 'TriggerToEnemy'),
    ('ItemsIndex', 'Items'),
    ('PlayerToCharactersIndex', 'PlayerToCharacters'),
    ('AestheticDebrisIndex', 'AestheticDebris'),
    ('AutoAvoidAbstacleIndex', 'AutoAvoidAbstacle'),
    ('BounceIndex', 'Bounce'),
    ('HeadTrackingTargetIndex', 'LookTarget'),
    ('WaterIndex', 'Water'),
    ('AudioZoneIndex', 'AudioZone'),
    ('RespawnPointIndex', 'RespawnPoint'),
    ('InteractionIndex', 'Interaction'),
]

def to_int32(v):
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v >= 0x80000000 else v

def compute_q4_layers(unity_layer_names):
    """Reproduce Q4.Layers..ctor (decompiled @0x004694F0) from TagManager names."""
    def name_to_layer(n):
        # Unity LayerMask.NameToLayer: index of the name, -1 when absent.
        return unity_layer_names.index(n) if n in unity_layer_names else -1

    indices = {f: name_to_layer(n) for f, n in LAYER_INDEX_FIELDS}

    def bit(i):
        # C# `1 << i` shifts by (i & 31) even for i == -1 (NameToLayer miss),
        # so reproduce that exactly instead of silently yielding 0.
        return 1 << (i & 31)

    masks = {
        'DefaultMask': bit(indices['DefaultIndex']),
        'UIMask': bit(indices['UIIndex']),
        'LandscapeMask': bit(indices['TerrainIndex']),
        'TerrainMask': (bit(indices['TerrainIndex']) | bit(indices['LargePropsIndex'])
                        | bit(indices['SmallPropsIndex'])),
        'LargeTerrainMask': bit(indices['TerrainIndex']) | bit(indices['LargePropsIndex']),
        'PlayerAreaMask': bit(indices['PlayerAreaIndex']),
        'PlayersMask': bit(indices['PlayersIndex']),
        'EnemiesMask': bit(indices['EnemiesIndex']),
        'TriggerToPlayerMask': bit(indices['TriggerToPlayerIndex']),
        'TriggerToEnemyMask': bit(indices['TriggerToEnemyIndex']),
        'ItemsMask': bit(indices['ItemsIndex']),
        'PlayerToCharactersMask': bit(indices['PlayerToCharactersIndex']),
        'AestheticDebrisMask': bit(indices['AestheticDebrisIndex']),
        'AutoAvoidAbstacleMask': bit(indices['AutoAvoidAbstacleIndex']),
        'BounceMask': bit(indices['BounceIndex']),
        'HeadTrackingTargetMask': bit(indices['HeadTrackingTargetIndex']),
        'WaterMask': bit(indices['WaterIndex']),
        'AudioZoneMask': bit(indices['AudioZoneIndex']),
        'RespawnPointMask': bit(indices['RespawnPointIndex']),
        'InteractionMask': bit(indices['InteractionIndex']),
    }
    return {
        'note': ('Reproduced from decomp/decompiled/Q4.Layers.c .ctor @0x004694F0 '
                 '(pure C# runtime singleton — NOT a serialized MonoBehaviour; the '
                 'original task assumption that globalsettings contains it is wrong). '
                 'Layer names→indices from Media/globalgamemanagers TagManager.'),
        'indices': indices,
        'masks': {k: to_int32(v) for k, v in masks.items()},
        'masksUnsigned': {k: v & 0xFFFFFFFF for k, v in masks.items()},
    }

def load_tag_manager_layers(media_dir):
    import UnityPy
    gg = os.path.join(media_dir, 'globalgamemanagers')
    env = UnityPy.load(gg)
    for o in env.objects:
        if o.type.name == 'TagManager':
            d = o.read()
            names = list(getattr(d, 'layers', None) or getattr(d, 'm_Layers'))
            # normalize to 32 entries
            names = (names + [''] * 32)[:32]
            return names
    raise RuntimeError('TagManager not found in ' + gg)

# ---------------------------------------------------------------- extraction

def sanitize(s):
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', s)

def find_scene_file(bundle, stage):
    """Locate the SerializedFile for the stage scene inside the bundle."""
    exact = f'BuildPlayer-{stage}_env'
    if exact in bundle.files and hasattr(bundle.files[exact], 'objects'):
        return exact, bundle.files[exact]
    cands = []
    for name, f in bundle.files.items():
        if not hasattr(f, 'objects'):
            continue
        base = name
        if base.endswith(f'{stage}_env') and '.sharedAssets' not in base and '.resource' not in base:
            cands.append((name, f))
    if not cands:
        raise RuntimeError(f'no scene file for stage {stage!r} in bundle')
    # prefer the shortest name (the real scene, not fps_check/GARI variants)
    cands.sort(key=lambda nf: (len(nf[0]), nf[0]))
    return cands[0]

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('stage', nargs='?', default='3d_stage_001',
                    help='stage scene name (default: 3d_stage_001)')
    ap.add_argument('--bundle', default=DEFAULT_BUNDLE, help='stages AssetBundle path')
    ap.add_argument('--out', default=DEFAULT_OUT, help='output dir (.work/physics-spike/)')
    ap.add_argument('--media-dir', default=DEFAULT_MEDIA,
                    help='Media dir containing globalgamemanagers (TagManager)')
    args = ap.parse_args()

    import UnityPy
    from UnityPy.helpers.MeshHelper import MeshHandler

    os.makedirs(args.out, exist_ok=True)
    mesh_dir = os.path.join(args.out, 'meshes')
    os.makedirs(mesh_dir, exist_ok=True)

    t0 = time.time()
    print(f'[extract] loading bundle {args.bundle} ...', flush=True)
    env = UnityPy.load(args.bundle)
    bundle = env.files[args.bundle]
    print(f'[extract] bundle loaded in {time.time() - t0:.1f}s', flush=True)

    unity_layers = load_tag_manager_layers(args.media_dir)
    q4 = compute_q4_layers(unity_layers)
    print(f'[extract] TerrainMask = {q4["masks"]["TerrainMask"]} '
          f'(0x{q4["masksUnsigned"]["TerrainMask"]:08X})  '
          f'WaterMask = {q4["masks"]["WaterMask"]}')

    scene_name, sf = find_scene_file(bundle, args.stage)
    print(f'[extract] scene file: {scene_name} ({len(sf.objects)} objects)')

    objs = sf.objects

    # ---- GameObjects, Transforms, Rigidbodies -------------------------------
    gos = {}       # path_id -> GameObject data
    transforms = {}  # transform path_id -> dict
    tr_by_go = {}    # go path_id -> transform path_id
    rb_gos = set()   # go path_ids carrying a Rigidbody
    for o in objs.values():
        t = o.type.name
        if t == 'GameObject':
            gos[o.path_id] = o.read()
        elif t == 'Transform':
            d = o.read()
            transforms[o.path_id] = d
            tr_by_go[d.m_GameObject.path_id] = o.path_id
        elif t == 'Rigidbody':
            d = o.read()
            rb_gos.add(d.m_GameObject.path_id)

    world_cache = {}

    def world_trs(tr_pid):
        """World (pos, quat xyzw, scale) of a Transform, walking m_Father chain."""
        if tr_pid in world_cache:
            return world_cache[tr_pid]
        d = transforms[tr_pid]
        p = d.m_LocalPosition
        r = d.m_LocalRotation
        s = d.m_LocalScale
        local = ((p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z))
        father_pid = d.m_Father.path_id if d.m_Father is not None else 0
        parent = None
        if father_pid and father_pid in transforms:
            parent = world_trs(father_pid)  # recursion == parent-first composition
        w = compose_world(local, parent)
        world_cache[tr_pid] = w
        return w

    def active_in_hierarchy(go_pid):
        tr_pid = tr_by_go.get(go_pid)
        seen = set()
        while tr_pid and tr_pid not in seen:
            seen.add(tr_pid)
            d = transforms.get(tr_pid)
            if d is None:
                break
            go = gos.get(d.m_GameObject.path_id)
            if go is not None and not go.m_IsActive:
                return False
            tr_pid = d.m_Father.path_id if d.m_Father is not None else 0
        return True

    def has_rigidbody(go_pid):
        tr_pid = tr_by_go.get(go_pid)
        seen = set()
        while tr_pid and tr_pid not in seen:
            seen.add(tr_pid)
            d = transforms.get(tr_pid)
            if d is None:
                break
            if d.m_GameObject.path_id in rb_gos:
                return True
            tr_pid = d.m_Father.path_id if d.m_Father is not None else 0
        return False

    # ---- meshes --------------------------------------------------------------
    meshes_out = {}       # mesh id -> meta
    mesh_cache = {}       # (file, path_id) -> mesh id

    def export_mesh(mesh_ref):
        """mesh_ref: PPtr to the Mesh; dedupe by (source file, path_id)."""
        mesh = mesh_ref.read()
        key = (mesh.assets_file.name, mesh_ref.path_id)
        if key in mesh_cache:
            return mesh_cache[key]
        h = MeshHandler(mesh)
        h.process()
        if not h.m_Vertices or h.m_VertexCount <= 0:
            print(f'[extract] WARNING: mesh {mesh.m_Name!r} has no readable vertices — skipped')
            mesh_cache[key] = None
            return None
        tris = []
        for sub in h.get_triangles():
            for a, b, c in sub:
                tris.extend((a, b, c))
        mid = sanitize(f'{mesh.m_Name}@{key[0]}#{key[1]}')
        vf = f'{mid}.verts.f32.bin'
        idxf = f'{mid}.idx.u32.bin'
        va = array.array('f')
        for v in h.m_Vertices:
            va.extend((float(v[0]), float(v[1]), float(v[2])))
        ia = array.array('I', tris)  # uint32, little-endian on all target hosts
        if sys.byteorder != 'little':
            va.byteswap(); ia.byteswap()
        with open(os.path.join(mesh_dir, vf), 'wb') as f:
            va.tofile(f)
        with open(os.path.join(mesh_dir, idxf), 'wb') as f:
            ia.tofile(f)
        meshes_out[mid] = {
            'name': mesh.m_Name,
            'sourceFile': key[0],
            'pathId': key[1],
            'vertexCount': len(h.m_Vertices),
            'triangleCount': len(tris) // 3,
            'vertsFile': f'meshes/{vf}',
            'idxFile': f'meshes/{idxf}',
        }
        mesh_cache[key] = mid
        return mid

    # ---- colliders -----------------------------------------------------------
    colliders = []
    kind_counts = collections.Counter()
    skipped = collections.Counter()
    layers_used = collections.defaultdict(int)

    for o in objs.values():
        kind = COLLIDER_KINDS.get(o.type.name)
        if kind is None:
            continue
        kind_counts[o.type.name] += 1
        d = o.read()
        go_pid = d.m_GameObject.path_id
        go = gos.get(go_pid)
        if go is None:
            skipped['no-gameobject'] += 1
            continue
        layer = int(go.m_Layer)
        layers_used[layer] += 1
        rec = {
            'kind': kind,
            'name': go.m_Name,
            'layer': layer,
            'layerName': unity_layers[layer] if 0 <= layer < 32 else f'?{layer}',
            'enabled': bool(d.m_Enabled),
            'isTrigger': bool(getattr(d, 'm_IsTrigger', False)),
            'activeInHierarchy': active_in_hierarchy(go_pid),
            'hasRigidbody': has_rigidbody(go_pid),
        }
        if kind not in EXPORTED_KINDS:
            # terrain/edge/wheel/character: report presence only (none expected:
            # this game bakes terrain as MeshColliders on the Art_Terrain layer)
            rec['reportedOnly'] = True
            colliders.append(rec)
            continue

        tr_pid = tr_by_go.get(go_pid)
        if tr_pid is None:
            skipped['no-transform'] += 1
            continue
        pos, rot, scale = world_trs(tr_pid)
        rec['transform'] = {
            'pos': [pos[0], pos[1], pos[2]],
            'rot': [rot[0], rot[1], rot[2], rot[3]],  # xyzw, Unity order
            'scale': [scale[0], scale[1], scale[2]],
        }
        if kind == 'box':
            c, s = d.m_Center, d.m_Size
            rec['center'] = [c.x, c.y, c.z]
            rec['size'] = [s.x, s.y, s.z]
        elif kind == 'sphere':
            c = d.m_Center
            rec['center'] = [c.x, c.y, c.z]
            rec['radius'] = float(d.m_Radius)
        elif kind == 'capsule':
            c = d.m_Center
            rec['center'] = [c.x, c.y, c.z]
            rec['radius'] = float(d.m_Radius)
            rec['height'] = float(d.m_Height)
            rec['direction'] = int(d.m_Direction)  # 0=X 1=Y 2=Z (Unity)
        elif kind == 'mesh':
            rec['convex'] = bool(d.m_Convex)
            mref = d.m_Mesh
            if mref is None or getattr(mref, 'path_id', 0) == 0:
                skipped['mesh-null'] += 1
                rec['meshRef'] = None
            else:
                try:
                    mesh = mref.read()
                except Exception as e:
                    skipped[f'mesh-read-fail'] += 1
                    print(f'[extract] WARNING: cannot read mesh for {go.m_Name!r}: {e}')
                    rec['meshRef'] = None
                else:
                    mid = export_mesh(mref)
                    rec['meshRef'] = mid
                    if mid is None:
                        skipped['mesh-unreadable'] += 1
        colliders.append(rec)

    used_layers = {}
    for layer, n in sorted(layers_used.items()):
        nm = unity_layers[layer] if 0 <= layer < 32 else f'?{layer}'
        used_layers[nm or f'(unnamed {layer})'] = layer

    out = {
        'meta': {
            'stage': args.stage,
            'sceneFile': scene_name,
            'bundle': args.bundle,
            'generatedBy': 'pjm2-web/tools/colliders/extract_stage_colliders.py',
            'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'coordinateSystem': ('Unity LEFT-HANDED Y-up, kept AS-IS (no conversion). '
                                 'Parity data (enemy m_pathList) is in the same frame; '
                                 'right-handed conversion belongs to the renderer only.'),
            'winding': ('Unity triangle order preserved; Rapier right-hand-rule face '
                        'normals verified to match Unity baked normals on terrain_001 '
                        '(1999/2000 sampled triangles). Do not flip winding or normals.'),
            'scaleNote': ('Rapier trimesh colliders ignore per-collider scale — the TS '
                          'loader must pre-multiply mesh vertices by transform.scale '
                          'before building the trimesh, and use pos/rot for the Isometry3.'),
            'triggerNote': ('isTrigger colliders are extracted but EXCLUDED from queries '
                            'by default (QueryTriggerInteraction.Ignore parity).'),
            'rigidbodyNote': ('hasRigidbody=true colliders belong to dynamic bodies in the '
                              'original game (guide/shop/stone props); the TS loader skips '
                              'them — the sim only queries STATIC scene colliders.'),
        },
        'q4Layers': q4,
        'unityLayers': unity_layers,
        'layers': used_layers,
        'colliders': colliders,
        'meshes': meshes_out,
    }

    out_path = os.path.join(args.out, f'{args.stage}_colliders.json')
    with open(out_path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    # ---- summary -------------------------------------------------------------
    exported = [c for c in colliders if c['kind'] in EXPORTED_KINDS]
    usable = [c for c in exported
              if c['enabled'] and c['activeInHierarchy'] and not c['hasRigidbody']
              and not c['isTrigger'] and c.get('meshRef', 'x') is not None]
    total_tris = sum(m['triangleCount'] for m in meshes_out.values())
    total_verts = sum(m['vertexCount'] for m in meshes_out.values())
    json_size = os.path.getsize(out_path)
    bin_size = sum(os.path.getsize(os.path.join(mesh_dir, f)) for f in os.listdir(mesh_dir))

    print('\n===== extraction summary =====')
    print(f'stage/scene:      {args.stage} / {scene_name}')
    print(f'TerrainMask:      {q4["masks"]["TerrainMask"]} (0x{q4["masksUnsigned"]["TerrainMask"]:08X})'
          f'  [Art_Terrain(29)|Art_LargeProps(30)|Art_SmallProps(31)]')
    print(f'WaterMask:        {q4["masks"]["WaterMask"]}')
    print('colliders by component type:')
    for k, v in kind_counts.most_common():
        print(f'  {k}: {v}')
    trig = sum(1 for c in exported if c['isTrigger'])
    inact = sum(1 for c in exported if not c['activeInHierarchy'])
    rbs = sum(1 for c in exported if c['hasRigidbody'])
    dis = sum(1 for c in exported if not c['enabled'])
    print(f'exported records: {len(exported)}  (triggers: {trig}, inactive: {inact}, '
          f'rigidbody: {rbs}, disabled: {dis})')
    print(f'static query candidates (enabled+active+no-rb+non-trigger): {len(usable)}')
    by_layer = collections.Counter((c['layer'], c['layerName']) for c in usable)
    print('usable colliders per layer:')
    for (ln, lname), n in sorted(by_layer.items()):
        print(f'  {ln:2d} {lname or "(unnamed)"}: {n}')
    print(f'meshes: {len(meshes_out)}  verts: {total_verts}  triangles: {total_tris}')
    print(f'output: {out_path} ({json_size / 1e6:.2f} MB json, {bin_size / 1e6:.2f} MB mesh bins)')
    if skipped:
        print(f'skipped: {dict(skipped)}')
    print(f'[extract] done in {time.time() - t0:.1f}s')

if __name__ == '__main__':
    main()
