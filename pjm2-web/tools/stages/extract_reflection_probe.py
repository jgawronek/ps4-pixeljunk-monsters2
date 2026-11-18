#!/usr/bin/env python3
"""Export each stage's baked HDR ReflectionProbe (Unity 5.6 BC6H cube, 128px, 8 mips) for the web port.

Unity's reflection probe cubemap is ALREADY GGX-convolved per mip (Standard shader: mip = pr*(1.7-0.7*pr)*6 with
pr = perceptualRoughness).  Stage 1 probe peak radiance is ~3e4 (the sun) -- the previous LDR face / PMREM of one
clamped face carried none of that.  We resample the seamless cube mip chain into an equirect RGBA16F mip chain
(512x256 at mip 0, halving) so the runtime can sample it with ONE texture2D/textureLod and no seam handling.

Cube face layout (verified by edge-continuity search over all 8 orientations per face; the standard GL/D3D layout):
  +X u->-z v->-y | -X u->+z v->-y | +Y u->+x v->+z | -Y u->+x v->-z | +Z u->+x v->-y | -Z u->-x v->-y   (v = image row,
  row 0 first).  Directions are Unity WORLD space (left handed; the port mirrors x at the shader).
Equirect: u = atan2(z, x)/(2pi) + 0.5, v = acos(y)/pi, row 0 = +Y.

Outputs (public/assets/stages/<scene>/probe/): reflection_probe.f16.bin (mips concatenated, RGBA half, little endian)
and reflection_probe.json.   Usage: extract_reflection_probe.py [scene ...]   (default: every dir under assets/stages)
"""
import json, math, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bc6h_hdr as bc6h
import UnityPy

AB = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'assets', 'stages')
EQ_W, EQ_H = 512, 256

C = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
AB_AXES = [((0, 0, -1), (0, -1, 0)), ((0, 0, 1), (0, -1, 0)), ((1, 0, 0), (0, 0, 1)),
           ((1, 0, 0), (0, 0, -1)), ((1, 0, 0), (0, -1, 0)), ((-1, 0, 0), (0, -1, 0))]


def face_dir(f, u, v):
    A, B = AB_AXES[f]; c = C[f]
    return tuple(c[i] + u * A[i] + v * B[i] for i in range(3))


def locate(d):
    """direction -> (face, u, v) in [-1,1]."""
    ax = [abs(x) for x in d]; m = max(ax); i = ax.index(m)
    f = {(0, True): 0, (0, False): 1, (1, True): 2, (1, False): 3, (2, True): 4, (2, False): 5}[(i, d[i] > 0)]
    A, B = AB_AXES[f]
    return f, sum(d[j] * A[j] for j in range(3)) / m, sum(d[j] * B[j] for j in range(3)) / m


def decode_cube(data):
    """-> faces[f][mip] = rows of [r,g,b] floats; mips 128..1."""
    face_bytes = len(data) // 6
    faces = []
    for f in range(6):
        off = f * face_bytes; s = 128; mips = []
        while s >= 1:
            n = max(1, s // 4) ** 2 * 16
            w = max(4, s)
            img, _bad = bc6h.decode(data[off:off + n], w, w)
            off += n
            mips.append([row[:s] for row in img[:s]])
            s //= 2
        faces.append(mips)
    return faces


def texel(faces, mip, f, x, y):
    s = len(faces[f][mip])
    return faces[f][mip][min(s - 1, max(0, y))][min(s - 1, max(0, x))]


def sample_seamless(faces, mip, d):
    """Bilinear cube lookup; taps beyond a face edge are re-projected onto the neighbouring face (seamless)."""
    f, u, v = locate(d)
    s = len(faces[f][mip])
    fx = (u + 1) / 2 * s - 0.5; fy = (v + 1) / 2 * s - 0.5
    x0 = math.floor(fx); y0 = math.floor(fy); tx = fx - x0; ty = fy - y0
    out = [0.0, 0.0, 0.0]
    for dx, dy, w in ((0, 0, (1 - tx) * (1 - ty)), (1, 0, tx * (1 - ty)), (0, 1, (1 - tx) * ty), (1, 1, tx * ty)):
        ix, iy = x0 + dx, y0 + dy
        if 0 <= ix < s and 0 <= iy < s:
            p = faces[f][mip][iy][ix]
        else:
            g, gu, gv = locate(face_dir(f, 2 * (ix + 0.5) / s - 1, 2 * (iy + 0.5) / s - 1))
            gs = len(faces[g][mip])
            p = texel(faces, mip, g, int((gu + 1) / 2 * gs), int((gv + 1) / 2 * gs))
        for c in range(3):
            out[c] += w * p[c]
    return out


def equirect_dir(i, j, w, h):
    phi = ((i + 0.5) / w - 0.5) * 2 * math.pi; theta = (j + 0.5) / h * math.pi
    return (math.sin(theta) * math.cos(phi), math.cos(theta), math.sin(theta) * math.sin(phi))


def build_equirect(faces):
    chunks = []; mips = []
    for m in range(len(faces[0])):
        w, h = max(1, EQ_W >> m), max(1, EQ_H >> m)
        buf = bytearray()
        for j in range(h):
            for i in range(w):
                r, g, b = sample_seamless(faces, m, equirect_dir(i, j, w, h))
                buf += struct.pack('<4e', min(r, 65504.0), min(g, 65504.0), min(b, 65504.0), 1.0)
        chunks.append(bytes(buf)); mips.append({'width': w, 'height': h, 'bytes': len(buf)})
    return b''.join(chunks), mips


def main():
    scenes = sys.argv[1:] or sorted(d for d in os.listdir(OUT) if d.startswith('3d_stage_'))
    env = UnityPy.load(AB)
    cubes = {}; probes = {}
    for o in env.objects:
        fn = o.assets_file.name
        if o.type.name == 'Cubemap':
            d = o.read()
            if d.m_Name == 'ReflectionProbe-0' and d.m_TextureFormat == 24:
                cubes[fn] = d
        elif o.type.name == 'ReflectionProbe' and fn.startswith('BuildPlayer-3d_stage_') and fn.endswith('_env'):
            probes[fn] = o.read_typetree()
    for scene in scenes:
        key = f'BuildPlayer-{scene}_env.sharedAssets'
        cube = cubes.get(key)
        if cube is None:
            print(f'{scene}: no baked probe'); continue
        pt = probes.get(f'BuildPlayer-{scene}_env', {})
        faces = decode_cube(cube.image_data)
        data, mips = build_equirect(faces)
        peak = max(max(max(p) for p in row) for row in faces[0][0])
        d = os.path.join(OUT, scene, 'probe'); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'reflection_probe.f16.bin'), 'wb').write(data)
        meta = {'format': 'equirect-rgba16f-mips', 'scene': scene, 'cubeSize': cube.m_Width, 'mips': mips,
                'lodSteps': 6, 'intensity': pt.get('m_IntensityMultiplier', 1.0), 'hdr': pt.get('m_HDR', True),
                'boxProjection': pt.get('m_BoxProjection', False), 'boxSize': pt.get('m_BoxSize'), 'boxOffset': pt.get('m_BoxOffset'),
                'source': f'{key} Cubemap ReflectionProbe-0 (BC6H)', 'orientation': 'unity-world'}
        json.dump(meta, open(os.path.join(d, 'reflection_probe.json'), 'w'), indent=1, default=float)
        print(f'{scene}: {len(data)} bytes, face0 peak radiance {peak:.0f}, intensity {meta["intensity"]}')


if __name__ == '__main__':
    main()
