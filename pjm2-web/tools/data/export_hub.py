#!/usr/bin/env python3
"""export_hub.py -- gameplay data of the hub / world-map scene (3d_stage_000) -> src/data/hubScene.generated.ts

Reads (read-only):
  * public/assets/stages/3d_stage_000/scene.json         (node graph, local TRS, colliders kinds; tools/stages/extract_stage_scene.py)
  * public/assets/stages/3d_stage_000/physics/*.json     (collider list; tools/colliders/extract_stage_colliders.py)
  * the `stages` AssetBundle scene BuildPlayer-3d_stage_000_env (UnityPy): StagePortal, AreaLock, WorldMapArea,
    StageRainbowIndicator, GameCameraTitle/TopDown/Behind, Player, WorldMap, PlayerRespawnPoint ...
Writes src/data/hubScene.generated.ts (HUB_SCENE) with WORLD-space Unity (left-handed) numbers.
Usage: /srv/opencode/venv-unity/bin/python -I tools/data/export_hub.py
"""
import json
import math
import os

import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = os.path.abspath(os.path.join(ROOT, '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/stages')
SCENE_DIR = os.path.join(ROOT, 'public/assets/stages/3d_stage_000')
SCENE = json.load(open(os.path.join(SCENE_DIR, 'scene.json')))
COLL = json.load(open(os.path.join(SCENE_DIR, 'physics/3d_stage_000_colliders.json')))
N = SCENE['nodes']
BY_PID = {n['pathId']: n for n in N}
BY_TPID = {n['transformPathId']: n for n in N}


def tm(c):
    x, y, z, w = c['rot']
    s = c['scale']
    p = c['pos']
    r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
         2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
         2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * s[0], r[1] * s[1], r[2] * s[2], p[0], r[3] * s[0], r[4] * s[1], r[5] * s[2], p[1],
            r[6] * s[0], r[7] * s[1], r[8] * s[2], p[2], 0, 0, 0, 1]


def mm(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4)) for r in range(4) for c in range(4)]


_cache = {}


def world(i):
    if i in _cache:
        return _cache[i]
    n = N[i]
    m = tm(n)
    if n['parent'] >= 0:
        m = mm(world(n['parent']), m)
    _cache[i] = m
    return m


def r3(v):
    return [round(float(x), 4) for x in v]


def wpos(i):
    m = world(i)
    return r3([m[3], m[7], m[11]])


def wfwd(i):
    m = world(i)
    l = math.sqrt(m[2] ** 2 + m[6] ** 2 + m[10] ** 2) or 1
    return r3([m[2] / l, m[6] / l, m[10] / l])


def wup(i):
    m = world(i)
    l = math.sqrt(m[1] ** 2 + m[5] ** 2 + m[9] ** 2) or 1
    return r3([m[1] / l, m[5] / l, m[9] / l])


def descendants(i):
    out = []
    for n in N:
        if n['parent'] == i:
            out.append(n['i'])
            out.extend(descendants(n['i']))
    return out


def children(i):
    return [n['i'] for n in N if n['parent'] == i]


def pid_node(pptr):
    pid = pptr['m_PathID']
    if pid == 0 or pptr['m_FileID'] != 0:
        return None
    return BY_PID.get(pid)


def tpid_node(pptr):
    pid = pptr['m_PathID']
    if pid == 0 or pptr['m_FileID'] != 0:
        return None
    return BY_TPID.get(pid)


def collider_of(i):
    """First trigger/other collider JSON entry attached to node i (matched by name + world position)."""
    out = []
    n = N[i]
    p = wpos(i)
    for k, c in enumerate(COLL['colliders']):
        if c['name'] != n['name']:
            continue
        cp = c['transform']['pos']
        if abs(cp[0] - p[0]) < 2e-3 and abs(cp[1] - p[1]) < 2e-3 and abs(cp[2] - p[2]) < 2e-3:
            out.append((k, c))
    return out


def shape(c):
    d = {'kind': c['kind'], 'trigger': bool(c['isTrigger']), 'scale': r3(c['transform']['scale']), 'center': r3(c.get('center', [0, 0, 0]))}
    if c['kind'] == 'sphere':
        d['radius'] = round(c['radius'], 4)
    elif c['kind'] == 'capsule':
        d['radius'] = round(c['radius'], 4)
        d['height'] = round(c['height'], 4)
        d['direction'] = c.get('direction', 1)
    elif c['kind'] == 'box':
        d['size'] = r3(c['size'])
    return d


def main():
    bun = UnityPy.load(AB).files[AB]
    f = bun.files['BuildPlayer-3d_stage_000_env']
    monos = []
    for pid, o in f.objects.items():
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            cls = o.read().m_Script.read().m_ClassName
            tt = o.read_typetree()
        except Exception:
            continue
        gn = pid_node(tt['m_GameObject'])
        if gn is None:
            continue
        monos.append((cls, gn, tt))

    def of(cls):
        return [(g, t) for c, g, t in monos if c == cls]

    portals = []
    for g, t in sorted(of('StagePortal'), key=lambda x: x[1]['m_stageName']):
        i = g['i']
        area = N[g['parent']]['name'] if g['parent'] >= 0 else ''
        if not area.startswith('area_'):
            continue  # Rainbow_GRP/number_001_N_pa carry a second StagePortal each (rainbow bridge decoration), not a walk-on portal
        cols = [shape(c) | {'idx': k} for k, c in collider_of(i)]
        spawns = []
        for sp in t['m_spawnPositions']:
            sn = tpid_node(sp)
            if sn is not None:
                spawns.append(wpos(sn['i']))
        portals.append({
            'name': g['name'], 'node': i, 'stage': t['m_stageName'], 'label': t['m_stageLabel'], 'area': area,
            'pos': wpos(i), 'trigger': cols[0] if cols else None, 'useSpawnPosition': bool(t['m_useSpawnPosition']), 'spawnPositions': spawns,
            'ignoreLockedFlag': bool(t['m_ignoreLockedFlag']), 'spawnStartOffset': r3([t['portalSpawnStartOffset'][k] for k in 'xyz']),
        })

    areas = []
    for g, t in sorted(of('WorldMapArea'), key=lambda x: x[1]['m_areaNameLabel']):
        cols = [shape(c) | {'idx': k, 'pos': r3(c['transform']['pos'])} for k, c in collider_of(g['i'])]
        areas.append({'name': g['name'], 'node': g['i'], 'label': t['m_areaNameLabel'], 'pos': wpos(g['i']), 'trigger': cols[0] if cols else None})

    removed_idx = set()
    locks = []
    for g, t in of('AreaLock'):
        i = g['i']
        own = [(k, shape(c)) for k, c in collider_of(i)]
        kids = children(i)
        blockers = []
        for d in descendants(i):
            for k, c in collider_of(d):
                blockers.append(k)
        locks.append({
            'name': g['name'], 'node': i, 'pos': wpos(i), 'requiredRainbows': t['requiredRainbows'],
            'requiredStages': [s for s in t['requiredStages'] if s] if isinstance(t['requiredStages'], list) else [],
            'unlockStages': [s for s in t['unlockStages'] if s], 'dialogText': t['dialogText'], 'unlockConfirmText': t['unlockConfirmText'],
            'setActiveOnUnlock': bool(t['setActiveOnUnlock']), 'active': bool(g['activeInHierarchy']),
            'trigger': next((s | {'idx': k} for k, s in own if s['trigger']), None),
            'childNodes': kids, 'descendantNodes': descendants(i), 'blockerColliders': sorted(set(blockers)),
            'poiNode': (pid_node(t['pointOfInterest']) or {}).get('i') if isinstance(t.get('pointOfInterest'), dict) else None,
        })
    locks = [l for l in locks if l['unlockStages']]

    rainbows = []
    for g, t in of('StageRainbowIndicator'):
        def tree(key):
            n = pid_node(t[key])
            return [] if n is None else [n['i']] + descendants(n['i'])
        # SetRainbowEnable(d) toggles the GameObject per difficulty (perfect at d); icingOnTheCake = all three (DecorateRainbows @0052d380)
        rainbows.append({'name': g['name'], 'node': g['i'], 'stage': t['stageName'], 'pos': wpos(g['i']),
                         'easy': tree('rainbowEasy'), 'medium': tree('rainbowMedium'), 'hard': tree('rainbowHard'), 'icing': tree('icingOnTheCake')})

    def cam(cls):
        for g, t in of(cls):
            i = g['i']
            cn = None
            for o in f.objects.values():
                if o.type.name == 'Camera':
                    c = o.read_typetree()
                    if c['m_GameObject']['m_PathID'] == g['pathId']:
                        cn = c
            return {'node': i, 'pos': wpos(i), 'forward': wfwd(i), 'up': wup(i), 'fov': cn['field of view'] if cn else None,
                    'near': cn['near clip plane'] if cn else None, 'far': cn['far clip plane'] if cn else None,
                    'params': {k: v for k, v in t.items() if k not in ('m_GameObject', 'm_Script', 'm_Name', 'm_Enabled', 'controller') and not isinstance(v, dict) and not isinstance(v, list)}}
        return None

    player = None
    for g, t in of('Player'):
        player = {'node': g['i'], 'pos': wpos(g['i']), 'forward': wfwd(g['i']),
                  'walkSpeed': t['m_WalkSpeed'], 'runSpeed': t['m_RunSpeed']}
    respawn = [wpos(n['i']) for n in N if n['name'].startswith('RespawnPoint') and n['activeSelf']]
    worldmap = None
    for g, t in of('WorldMap'):
        worldmap = {'node': g['i'], 'portalSpawnEffectDuration': t['portalSpawnEffectDuration']}

    out = {
        'scene': '3d_stage_000',
        'player': player,
        'cameras': {'title': cam('GameCameraTitle'), 'topDown': cam('GameCameraTopDown'), 'behind': cam('GameCameraBehind')},
        'worldMap': worldmap,
        'portals': portals,
        'areas': areas,
        'locks': locks,
        'rainbows': rainbows,
        'respawn': respawn,
    }
    body = json.dumps(out, separators=(',', ':'))
    path = os.path.join(ROOT, 'src/data/hubScene.generated.ts')
    with open(path, 'w') as fh:
        fh.write(
            '// GENERATED by tools/data/export_hub.py -- do not edit.\n'
            '// Gameplay data of the hub / world-map scene 3d_stage_000 (Q4.WorldMap, StagePortal, AreaLock, WorldMapArea, cameras).\n'
            '// World-space Unity (left-handed) numbers; see docs/HUB_AND_TITLE_ANALYSIS.md.\n'
            'export interface HubShape { kind: string; trigger: boolean; scale: number[]; center: number[]; radius?: number; height?: number; direction?: number; size?: number[]; idx: number; pos?: number[] }\n'
            'export interface HubCameraData { node: number; pos: number[]; forward: number[]; up: number[]; fov: number | null; near: number | null; far: number | null; params: Record<string, number | boolean | string> }\n'
            'export interface HubPortalData { name: string; node: number; stage: string; label: string; area: string; pos: number[]; trigger: HubShape | null; useSpawnPosition: boolean; spawnPositions: number[][]; ignoreLockedFlag: boolean; spawnStartOffset: number[] }\n'
            'export interface HubAreaData { name: string; node: number; label: string; pos: number[]; trigger: HubShape | null }\n'
            'export interface HubLockData { name: string; node: number; pos: number[]; requiredRainbows: number; requiredStages: string[]; unlockStages: string[]; dialogText: string; unlockConfirmText: string; setActiveOnUnlock: boolean; active: boolean; trigger: HubShape | null; childNodes: number[]; descendantNodes: number[]; blockerColliders: number[]; poiNode: number | null }\n'
            'export interface HubRainbowData { name: string; node: number; stage: string; pos: number[]; easy: number[]; medium: number[]; hard: number[]; icing: number[] }\n'
            'export interface HubSceneData {\n'
            '  scene: string;\n'
            '  player: { node: number; pos: number[]; forward: number[]; walkSpeed: number; runSpeed: number } | null;\n'
            '  cameras: { title: HubCameraData | null; topDown: HubCameraData | null; behind: HubCameraData | null };\n'
            '  worldMap: { node: number; portalSpawnEffectDuration: number } | null;\n'
            '  portals: HubPortalData[]; areas: HubAreaData[]; locks: HubLockData[]; rainbows: HubRainbowData[]; respawn: number[][];\n'
            '}\n\n'
            'export const HUB_SCENE: HubSceneData = ' + body + ';\n')
    print('portals', len(portals), 'areas', len(areas), 'locks', len(locks), 'rainbows', len(rainbows), 'respawn', len(respawn))
    for l in locks:
        print(' lock', l['name'], l['pos'], l['requiredRainbows'], l['unlockStages'], 'blockers', len(l['blockerColliders']), 'trigger', bool(l['trigger']), 'children', len(l['childNodes']))
    print('wrote', path)


if __name__ == '__main__':
    main()
