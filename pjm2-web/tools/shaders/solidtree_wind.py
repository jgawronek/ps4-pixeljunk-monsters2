#!/usr/bin/env python3
"""Nature/Plant/SolidTree vertex program: extract, disassemble, execute.

  PYTHONPATH=tools/assets/pylibs /srv/opencode/venv-unity/bin/python \
      tools/shaders/solidtree_wind.py asm      # prints the wind vertex program (blob 0, 0xe0-0x3fc)
  ... solidtree_wind.py golden                  # writes tests/view/fixtures/treeWindIsaGolden.json

The fixture holds inputs + the OUTPUT of executing the real ISA (isa_exec.py,
a tiny GCN interpreter for exactly the instructions this program uses) so
tests/view/treeView.test.ts can verify TreeView.treeWindDisplacement against
the original shader math. See docs/TREE_SWAY_ANALYSIS.md.
"""
import json, math, os, random, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import UnityPy, lz4.block  # noqa: E402
import gcn, isa_exec  # noqa: E402

AB = os.path.join(HERE, '../../../game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/nature')
CODE = (0xe0, 0x3fc)  # vertex program range inside the sub-program blob (s_swappc fetch call at 0xdc)


def load_blob0():
    env = UnityPy.load(AB)
    for o in env.objects:
        if o.type.name != 'Shader':
            continue
        d = o.read()
        if d.m_ParsedForm.m_Name != 'Nature/Plant/SolidTree':
            continue
        raw = lz4.block.decompress(bytes(d.compressedBlob)[d.offsets[0]:][:d.compressedLengths[0]],
                                   uncompressed_size=d.decompressedLengths[0])
        n = struct.unpack_from('<I', raw, 0)[0]
        off, ln = struct.unpack_from('<II', raw, 4)   # table entry 0 = FORWARDBASE vertex variant 0
        assert n == 952
        return raw[off:off + ln]
    raise SystemExit('SolidTree not found')


def asm_lines(blob):
    return gcn.dis(blob, *CODE)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'asm'
    blob = load_blob0()
    lines = asm_lines(blob)
    if cmd == 'asm':
        print('\n'.join(lines))
        return
    random.seed(7)
    cases = []
    for _ in range(48):
        sc = random.choice([1, 1, 0.8, 1.3])
        yaw = random.uniform(0, 6.28)
        M = [[math.cos(yaw) * sc, 0, math.sin(yaw) * sc, random.uniform(-30, 30)],
             [0, sc, 0, random.uniform(0, 2)],
             [-math.sin(yaw) * sc, 0, math.cos(yaw) * sc, random.uniform(-30, 30)],
             [0, 0, 0, 1]]
        d = [random.gauss(0, 1), random.gauss(0, 1)]
        dn = math.hypot(*d) or 1
        T = random.uniform(0, 300)
        start = random.choice([-100, T - random.uniform(0, 3.5), T - 0.2])
        g = dict(MWF=random.choice([1.6, 1.8, 2.2]), MWS=random.choice([1.2, 2.0]),
                 NWF=random.choice([10, 9.5, 1.25]), NWS=random.choice([1, 5]),
                 MWStr=random.choice([0.3, 0.45, 2.5]), NWStr=random.choice([0.2, 0.4, 0.05]),
                 SStr=0.3, SDur=3, NS=10, SStart=start, SDx=d[0] / dn, SDy=0, SDz=d[1] / dn)
        p = [random.uniform(-.4, .4), random.uniform(0, 4.2), random.uniform(-.4, .4)]
        r = random.random()
        out = isa_exec.run_case(lines, g, T, M, p, r)
        cases.append({'params': {'mainFrequency': g['MWF'], 'mainSpeed': g['MWS'], 'mainStrength': g['MWStr'],
                                 'noiseFrequency': g['NWF'], 'noiseSpeed': g['NWS'], 'noiseStrength': g['NWStr'],
                                 'shakeStrength': g['SStr'], 'shakeDuration': g['SDur'], 'numShakes': g['NS']},
                      'shake': {'dirX': g['SDx'], 'dirZ': g['SDz'], 'start': start},
                      'timeY': T, 'objToWorld': M, 'objPos': p, 'weight': r, 'isaWorldOut': out})
    path = os.path.join(HERE, '../../tests/view/fixtures/treeWindIsaGolden.json')
    json.dump({'source': 'Nature/Plant/SolidTree vertex program, blob 0, executed by tools/shaders/isa_exec.py',
               'cases': cases}, open(path, 'w'), indent=0)
    print('wrote', path, len(cases))


if __name__ == '__main__':
    main()
