#!/usr/bin/env python3
"""extract_pickup_data.py — AISettings global settings + coin/gem pickup prefab parameters.

PixelJunk Monsters 2 (CUSA11967, Unity 5.6.5p1), user's own decrypted PS4 copy.
Read-only against game assets; writes ONLY:
  decomp/data/globalsettings_AISettings.json
  decomp/data/pickup_prefabs.json

Run: /srv/opencode/venv-unity/bin/python extract_pickup_data.py

Provenance chain (verified, see EXTRACTION_REPORT.md):
  Q4.AISettings getters (decomp/decompiled/Q4.AISettings.c) read
    GlobalSettingsContainer<AISettings>.Instance + 0x18/0x19/0x1C
    = m_OvertakeSlowerEnemies / m_EnableEnemyBlocking / m_PickupWaterKillTime
    (decomp/skeleton/Q4.cs TypeDefIndex 3089). Asset: globalsettings bundle,
    Assets/GlobalSettings/AISettings.asset (container rootPath "GlobalSettings/").
  Q4.PickupManager.CreateCurrency/GetPickupPrefab/CreatePickup
    (decomp/decompiled/Q4.PickupManager.c @ 0x3E3F50/0x3E5500/0x3E5520) select
    GlobalResources.DebugCoinPrefab (type 0) / DebugGemPrefab (type 1);
    those PPtrs resolve to the PickupCurrency components of prop_001 / prop_002
    in the props bundle. Stage-1 scene BuildPlayer-3d_stage_001_env carries a
    PickupManager (globalCoinPerValueOverride=20).
  Mesh bounds are COMPUTED FROM VERTEX MIN/MAX of the referenced Mesh
    (UnityPy MeshHandler), not copied from the serialized AABB (both reported;
    they agree to float32 rounding). The sim ctor uses
    viewer.GetComponentInChildren<MeshFilter>() -> first MeshFilter in DFS order
    = the LOD0 child of the PrefabLoader visual (coin_001_pa / gem_001_pa).
"""
import json
import os
import time

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
AB = os.path.join(REPO, 'game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles')
DATA = os.path.join(REPO, 'decomp/data')


def ref_pid(c):
    if c is None:
        return 0
    if isinstance(c, dict):
        return c.get('m_PathID') or c.get('path_id') or 0
    return getattr(c, 'path_id', 0) or 0


class Bundle:
    def __init__(self, name):
        self.name = name
        self.path = os.path.join(AB, name)
        self.env = UnityPy.load(self.path)
        self.idx = {o.path_id: o for o in self.env.objects}
        self.scripts = {}
        for o in self.env.objects:
            if o.type.name == 'MonoScript':
                try:
                    self.scripts[o.path_id] = o.read().m_ClassName
                except Exception:
                    pass
        self.unity_version = None

    def tt(self, pid):
        return self.idx[pid].read_typetree()

    def name_of(self, pid):
        try:
            return self.idx[pid].read().m_Name
        except Exception:
            return None

    def comp_class(self, pid):
        try:
            return self.scripts.get(self.idx[pid].read().m_Script.path_id)
        except Exception:
            return None

    def go_name_of_comp(self, pid):
        """name of the GameObject carrying a component (effects have empty m_Name)."""
        try:
            tt = self.tt(pid)
            return self.name_of(ref_pid(tt.get('m_GameObject')))
        except Exception:
            return None

    def version(self):
        if self.unity_version is None:
            for o in self.env.objects:
                v = getattr(getattr(o, 'assets_file', None), 'unity_version', None)
                if v:
                    self.unity_version = v if isinstance(v, str) else '.'.join(str(x) for x in v[:3])
                    break
        return self.unity_version


def mesh_bounds_from_vertices(b, mesh_pid):
    m = b.idx[mesh_pid].read()
    h = MeshHandler(m)
    h.process()
    vs = h.m_Vertices
    xs = [v[0] for v in vs]; ys = [v[1] for v in vs]; zs = [v[2] for v in vs]
    mn = [min(xs), min(ys), min(zs)]
    mx = [max(xs), max(ys), max(zs)]
    size = [mx[i] - mn[i] for i in range(3)]
    center = [(mx[i] + mn[i]) / 2.0 for i in range(3)]
    extents = [s / 2.0 for s in size]
    aabb = b.tt(mesh_pid).get('m_LocalAABB')
    # Cylinder.fromBounds (GameCorePickup ctor): height=size.y,
    # radius=Lerp(min(extents.x,extents.z), max(extents.x,extents.z), 0.2)
    lo, hi = min(extents[0], extents[2]), max(extents[0], extents[2])
    return {
        'meshName': m.m_Name, 'meshPathId': mesh_pid, 'vertexCount': len(vs),
        'method': 'COMPUTED FROM MESH VERTEX MIN/MAX (UnityPy MeshHandler); '
                  'matches serialized m_LocalAABB to float32 rounding',
        'vertexMin': mn, 'vertexMax': mx,
        'size': size, 'center': center, 'extents': extents,
        'serializedLocalAABB': aabb,
        'cylinderFromBounds': {
            'height': size[1],
            'radius': lo + (hi - lo) * 0.2,
            'formula': 'height=size.y; radius=Lerp(min(extents.x,extents.z), max(extents.x,extents.z), 0.2)',
        },
    }


def main():
    t0 = time.time()
    gs = Bundle('globalsettings')
    props = Bundle('props')
    print(f'bundles loaded ({time.time()-t0:.1f}s); unity {props.version()}', flush=True)

    # ---------------------------------------------------------- AISettings --
    ai_readers = [o for o in gs.env.objects if o.type.name == 'MonoBehaviour'
                  and gs.comp_class(o.path_id) == 'AISettings']
    assert len(ai_readers) == 1, f'expected exactly one AISettings asset, got {len(ai_readers)}'
    ai = ai_readers[0]
    ait = gs.tt(ai.path_id)
    ai_doc = [{
        '__class': 'AISettings',
        '__gameObject': ait['m_Name'],
        '__path_id': ai.path_id,
        '__bundle': 'globalsettings',
        '__source_asset': 'Assets/GlobalSettings/AISettings.asset',
        '__container': 'Q4.GlobalSettingsContainer<Q4.AISettings>.Instance '
                       '(rootPath "GlobalSettings/", Resources.Load path GlobalSettings/AISettings)',
        '__propertyMapping': {
            'OvertakeSlowerEnemies': {'field': 'm_OvertakeSlowerEnemies', 'offset': '0x18',
                                      'getter': 'Q4.AISettings.get_OvertakeSlowerEnemies @ 0x007290A0',
                                      'value': bool(ait['m_OvertakeSlowerEnemies'])},
            'EnableEnemyBlocking': {'field': 'm_EnableEnemyBlocking', 'offset': '0x19',
                                    'getter': 'Q4.AISettings.get_EnableEnemyBlocking @ 0x00729180',
                                    'value': bool(ait['m_EnableEnemyBlocking'])},
            'PickupWaterKillTime': {'field': 'm_PickupWaterKillTime', 'offset': '0x1C',
                                    'getter': 'Q4.AISettings.get_PickupWaterKillTime @ 0x00729260',
                                    'value': ait['m_PickupWaterKillTime'],
                                    'usedBy': 'GameCorePickup.CheckForWater / GameCoreFruit water logic: '
                                              'remainingLifespan = Min(remainingLifespan, PickupWaterKillTime)'},
        },
        '__note': 'bool fields serialized as 0/1 exactly as in the type-tree; '
                  'ctor @0x729030 defaults m_OvertakeSlowerEnemies=true, m_PickupWaterKillTime=2.0 '
                  '(0x40000000), m_EnableEnemyBlocking=false — serialized values below take precedence',
        'm_OvertakeSlowerEnemies': ait['m_OvertakeSlowerEnemies'],
        'm_EnableEnemyBlocking': ait['m_EnableEnemyBlocking'],
        'm_PickupWaterKillTime': ait['m_PickupWaterKillTime'],
    }]
    with open(os.path.join(DATA, 'globalsettings_AISettings.json'), 'w') as f:
        json.dump(ai_doc, f, indent=1)
    print('AISettings:', json.dumps(ai_doc[0]['__propertyMapping']['PickupWaterKillTime']), flush=True)

    # ------------------------------------------------------ GlobalSounds ----
    gso = next(o for o in gs.env.objects if o.type.name == 'MonoBehaviour'
               and gs.comp_class(o.path_id) == 'GlobalSounds')
    gst = gs.tt(gso.path_id)
    water_refs = {}
    for key in ('itemDieInWater', 'itemLostInWater', 'fruitWaterDie', 'fruitWaterSplash',
                'hiddenPickupFound'):
        pid = ref_pid(gst.get(key))
        rec = {'globalSoundsField': key, 'path_id': pid, 'bundle': 'props'}
        if pid in props.idx:
            rec['audioClipName'] = props.name_of(pid)
            rec['resolved'] = True
        else:
            rec['resolved'] = False
        water_refs[key] = rec

    # ------------------------------------------------- GlobalResources refs --
    gro = next(o for o in gs.env.objects if o.type.name == 'MonoBehaviour'
               and gs.comp_class(o.path_id) == 'GlobalResources')
    grt = gs.tt(gro.path_id)
    coin_ref = ref_pid(grt['debugCoinPrefab'])
    gem_ref = ref_pid(grt['debugGemPrefab'])

    # ------------------------------------------------------- pickup prefabs --
    def extract_prefab(go_name, currency_pid, role):
        go_pid = ref_pid(props.tt(currency_pid)['m_GameObject'])
        assert props.name_of(go_pid) == go_name
        ct = props.tt(currency_pid)
        comps = {}
        for c in props.tt(go_pid)['m_Component']:
            pid = ref_pid(c['component'])
            tn = props.idx[pid].type.name
            if tn == 'MonoBehaviour':
                comps[props.comp_class(pid)] = (pid, props.tt(pid))
            else:
                comps.setdefault(tn, (pid, props.tt(pid)))
        pl_pid, pl = comps['PrefabLoader']
        visual_pid = ref_pid(pl['prefabList'][0])
        pm_pid, pm = comps['PickupMovement']
        lc_pid, lc = comps['PickupLifeCycle']

        # first MeshFilter in DFS order over the instantiated hierarchy:
        # logic root has no MeshFilter; visual prefab's first child chain leads to LOD0.
        def first_meshfilter(pid, depth=0):
            t = props.tt(pid)
            tr = None
            for c in t['m_Component']:
                cpid = ref_pid(c['component'])
                tn = props.idx[cpid].type.name
                if tn == 'MeshFilter':
                    return cpid
                if tn == 'Transform':
                    tr = cpid
            if tr is not None:
                for ch in props.tt(tr)['m_Children']:
                    cgo = ref_pid(props.tt(ref_pid(ch))['m_GameObject'])
                    r = first_meshfilter(cgo, depth + 1)
                    if r:
                        return r
            return None

        mf_pid = first_meshfilter(go_pid)
        if mf_pid is None:
            mf_pid = first_meshfilter(visual_pid)
        mesh_pid = ref_pid(props.tt(mf_pid)['m_Mesh'])
        bounds = mesh_bounds_from_vertices(props, mesh_pid)
        mf_go = props.name_of(ref_pid(props.tt(mf_pid)['m_GameObject']))

        # all LOD bounds (supplementary; LOD0 is what the sim sees)
        lods = []
        def collect_lods(pid):
            t = props.tt(pid)
            tr = None
            for c in t['m_Component']:
                cpid = ref_pid(c['component'])
                tn = props.idx[cpid].type.name
                if tn == 'MeshFilter':
                    mp = ref_pid(props.tt(cpid)['m_Mesh'])
                    if mp in props.idx:
                        bb = mesh_bounds_from_vertices(props, mp)
                        lods.append({'node': props.name_of(ref_pid(props.tt(cpid)['m_GameObject'])),
                                     'meshName': bb['meshName'], 'meshPathId': mp,
                                     'size': bb['size'], 'extents': bb['extents'],
                                     'cylinderFromBounds': bb['cylinderFromBounds']})
                if tn == 'Transform':
                    tr = cpid
            if tr is not None:
                for ch in props.tt(tr)['m_Children']:
                    collect_lods(ref_pid(props.tt(ref_pid(ch))['m_GameObject']))
        collect_lods(visual_pid)

        def pp(pid):
            if not pid:
                return None
            return {'path_id': pid, 'name': props.name_of(pid) or props.go_name_of_comp(pid),
                    'type': props.idx[pid].type.name}

        sc_pid, sc = comps.get('SphereCollider', (None, {}))
        rb_pid, rb = comps.get('Rigidbody', (None, {}))
        return {
            '__class': 'PickupCurrency',
            '__gameObject': go_name,
            '__path_id': currency_pid,
            '__bundle': 'props',
            '__source_asset': f'Assets/Prefabs/Master_Prefabs/Gimmick_Obj/Prop/Money/{go_name}.prefab',
            'role': role,
            'gameObjectPathId': go_pid,
            'referencedBy': {'globalResourcesField': 'debugCoinPrefab' if role == 'coin' else 'debugGemPrefab',
                             'globalResourcesPathId': gro.path_id,
                             'note': 'field type is PickupCurrency (component PPtr), resolved by path_id in props bundle'},
            'pickup': {
                'detectRange': ct['detectRange'],
                'detectDelay': ct['detectDelay'],
                'collectSound': pp(ref_pid(ct['collectSound'])),
                'disappearEffect': pp(ref_pid(ct['disappearEffect'])),
            },
            'pickupCurrency': {
                'type': ct['type'],
                'typeMeaning': 'GameCoreInventory.EInventoryType (0=Coin, 1=Gem)',
                'value': ct['value'],
                'acquireEffect': pp(ref_pid(ct['acquireEffect'])),
            },
            'pickupMovement': {
                '__path_id': pm_pid,
                'acceleration': pm['acceleration'],
                'rotateSpeed': pm['rotateSpeed'],
                'rotateSpeedVariation': pm['rotateSpeedVariation'],
                'appearForceMin': pm['appearForceMin'],
                'appearForceMax': pm['appearForceMax'],
                'appearRangeAngle': pm['appearRangeAngle'],
                'bouncingRate': pm['bouncingRate'],
                'bounceTime': pm['bounceTime'],
                'attractOffset': pm['attractOffset'],
            },
            'pickupLifeCycle': {
                '__path_id': lc_pid,
                'lifespan': lc['lifespan'],
                'lifespanFlashTime': lc['lifespanFlashTime'],
                'flashInterval': lc['flashInterval'],
            },
            'visualPrefab': {
                'name': props.name_of(visual_pid), 'path_id': visual_pid,
                'resolvedVia': 'PrefabLoader.prefabList[0]', 'prefabLoaderPathId': pl_pid,
            },
            'meshBounds': {
                **bounds,
                'meshFilterPathId': mf_pid,
                'meshFilterGameObject': mf_go,
                'selection': 'first MeshFilter in GetComponentInChildren DFS order = LOD0',
                'allLODs': lods,
            },
            'otherComponents': {
                'SphereCollider': {'__path_id': sc_pid, 'radius': sc.get('m_Radius'),
                                   'center': sc.get('m_Center'), 'isTrigger': sc.get('m_IsTrigger')},
                'Rigidbody': {'__path_id': rb_pid, 'mass': rb.get('m_Mass'), 'drag': rb.get('m_Drag'),
                              'angularDrag': rb.get('m_AngularDrag'), 'useGravity': rb.get('m_UseGravity'),
                              'isKinematic': rb.get('m_IsKinematic'), 'constraints': rb.get('m_Constraints')},
            },
        }

    coin = extract_prefab('prop_001', coin_ref, 'coin')
    gem = extract_prefab('prop_002', gem_ref, 'gem')

    # ------------------------------------------- stage-1 PickupManager -------
    stages = Bundle('stages')
    sbundle = stages.env.files[stages.path]
    scene_name = 'BuildPlayer-3d_stage_001_env'
    sf = sbundle.files[scene_name]
    sscripts = {}
    for fname, f in sbundle.files.items():
        if not hasattr(f, 'objects'):
            continue
        for o in f.objects.values():
            if o.type.name == 'MonoScript':
                try:
                    sscripts[o.path_id] = o.read().m_ClassName
                except Exception:
                    pass
    pm = None
    for o in sf.objects.values():
        if o.type.name == 'MonoBehaviour':
            try:
                if sscripts.get(o.read().m_Script.path_id) == 'PickupManager':
                    pm = o
                    break
            except Exception:
                pass
    assert pm is not None, 'stage-1 PickupManager not found'
    pmt = pm.read_typetree()
    stage1 = {
        'scene': '3d_stage_001',
        'sceneFile': scene_name,
        'bundle': 'stages',
        'attribution': 'decomp/data/stage_scene_attribution.json: true first level = '
                       '(tl_area_001, tl_stage_001), initCoin=450, 10 waves',
        'pickupManager': {
            '__path_id': pm.path_id,
            'globalCoinPerValueOverride': pmt['globalCoinPerValueOverride'],
            'maximumFruitsOnGround': pmt['maximumFruitsOnGround'],
            'hiddenPickupData': pmt['hiddenPickupData'],
            'hiddenFruitData': pmt['hiddenFruitData'],
            'note': 'globalCoinPerValueOverride=20 matches prop_001.value=20; '
                    'CreateCurrency divides enemy coin drops by this per-coin value',
        },
    }

    doc = {
        '__generatedBy': 'pjm2-web/tools/data/extract_pickup_data.py',
        '__unityVersion': props.version(),
        '__spawnChain': {
            'code': 'Q4.PickupManager.CreateCurrency @ 0x003E3F50, GetPickupPrefab @ 0x003E5500, '
                    'CreatePickup @ 0x003E5520 (decomp/decompiled/Q4.PickupManager.c)',
            'selection': 'type 0 -> GlobalResources.DebugCoinPrefab (prop_001), '
                         'type 1 -> GlobalResources.DebugGemPrefab (prop_002)',
            'globalResources': {'__path_id': gro.path_id, '__bundle': 'globalsettings',
                                '__source_asset': 'Assets/GlobalSettings/GlobalResources.asset',
                                'debugCoinPrefab_pathId': coin_ref, 'debugGemPrefab_pathId': gem_ref},
            'simCtor': 'GameCorePickup ctor @ 0x004BEFB0 reads detectRange/detectDelay/name, '
                       'PickupCurrency.value, PickupMovement fields, PickupLifeCycle.lifespan, '
                       'and GetComponentInChildren<MeshFilter>().sharedMesh.bounds -> Cylinder.fromBounds',
        },
        'stage1': stage1,
        'prefabs': [coin, gem],
        'globalSoundsWaterRefs': {
            '__source': {'class': 'GlobalSounds', '__path_id': gso.path_id, '__bundle': 'globalsettings',
                         '__source_asset': 'Assets/GlobalSettings/GlobalSounds.asset'},
            **water_refs,
        },
    }
    with open(os.path.join(DATA, 'pickup_prefabs.json'), 'w') as f:
        json.dump(doc, f, indent=1)
    print(f'wrote globalsettings_AISettings.json + pickup_prefabs.json ({time.time()-t0:.1f}s)', flush=True)
    for p in (coin, gem):
        mb = p['meshBounds']
        print(p['__gameObject'], 'value=', p['pickupCurrency']['value'],
              'lifespan=', p['pickupLifeCycle']['lifespan'],
              'cylinder=', mb['cylinderFromBounds'], flush=True)


if __name__ == '__main__':
    main()
