#!/usr/bin/env python3
"""
extract_ui_sprites.py — in-game UI sprites + display fonts -> public/assets/ui/.

SOURCE (from the user's own copy, never redistributed):
  game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles/
    globalsettings : the Q4 UI prefabs live here (Hud_02, Hud_TowerRing,
                     start_call_01, clear_call_01, pause_01, result_01,
                     game_over_01, ... = Q4.MenuDatabase screens) with their
                     Sprite assets (ring_icon_*, wave_number_*, player_coin_r,
                     wave_bar, enemy_alert, ...).
    structures     : tower icon sprites for towers 009..012 (TowerBase.towerIcon
                     PPtr targets not present in globalsettings).
    main_assets    : Font_00/01/02 bitmap-font atlases + Unity Font
                     m_CharacterRects (glyph uv/vert/advance) + the Q4 CustomFont
                     MonoBehaviour (ascent/lineHeight/kerning). Font_02 is the
                     blue wooden display font used for "WAVE START" / wave
                     numerals; Font_01 the white outlined body font.

OUTPUT:
  public/assets/ui/sprites/<name>.png      one PNG per Sprite (kept at native px)
  public/assets/ui/sprites.json            { name: {w,h,ppu,pivot:[x,y],border:[l,b,r,t]} }
  public/assets/ui/fonts/<Font_NN>.png     atlas
  public/assets/ui/fonts/<Font_NN>.json    { atlas:[w,h], ascent, lineHeight, size,
                                             kerning:[[l,r,v]], glyphs:{code:{uv:[x,y,w,h],
                                             vert:[x,y,w,h], advance}} }  (uv normalised, y-up)
  public/assets/ui/tower-icons.json        { tower_NNN: spriteName }  via TowerBase.towerIcon
Usage: /srv/opencode/venv-unity/bin/python tools/assets/extract_ui_sprites.py
"""
import json, os, re, sys
import UnityPy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
AB = '/srv/opencode/ps3-pixeljunk-monsters2/game/extracted/CUSA11967/Media/StreamingAssets/AssetBundles'
OUT = os.path.join(ROOT, 'public', 'assets', 'ui')
os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'fonts'), exist_ok=True)

# Skip big photo/background art the in-game UI does not use.
SKIP = re.compile(r'^(loading_bg_|stage_photo_|guide_photo_|help_bt_|common_img_|multi_bg_|sign_icon_|stage_.*_bg|shop_|guide_|controller_|game_pad)')

meta = {}
def dump_sprites(bundle, only_ids=None):
    env = UnityPy.load(os.path.join(AB, bundle))
    for o in env.objects:
        if o.type.name != 'Sprite':
            continue
        if only_ids is not None and o.path_id not in only_ids:
            continue
        d = o.read()
        if only_ids is None and SKIP.match(d.m_Name):
            continue
        try:
            img = d.image
        except Exception as e:
            print('skip', d.m_Name, e); continue
        img.save(os.path.join(OUT, 'sprites', d.m_Name + '.png'))
        meta[d.m_Name] = {
            'w': img.size[0], 'h': img.size[1], 'ppu': d.m_PixelsToUnits,
            'pivot': [d.m_Pivot.x, d.m_Pivot.y],
            'border': ([d.m_Border.x, d.m_Border.y, d.m_Border.z, d.m_Border.w] if getattr(d, 'm_Border', None) is not None else [0, 0, 0, 0]),
        }

dump_sprites('globalsettings')

# tower icons: TowerBase.towerIcon PPtr path ids (decomp/data/structures_TowerBase.json)
tb = json.load(open('/srv/opencode/ps3-pixeljunk-monsters2/decomp/data/structures_TowerBase.json'))
want = {t['towerIcon']['m_PathID']: t['__gameObject'] for t in tb if t['__gameObject'].startswith('tower_0')}
icons = {}
for env_name in ('globalsettings', 'structures'):
    env = UnityPy.load(os.path.join(AB, env_name))
    for o in env.objects:
        if o.type.name == 'Sprite' and o.path_id in want:
            d = o.read()
            icons[want[o.path_id]] = d.m_Name
            if d.m_Name not in meta:
                d.image.save(os.path.join(OUT, 'sprites', d.m_Name + '.png'))
                meta[d.m_Name] = {'w': d.image.size[0], 'h': d.image.size[1], 'ppu': d.m_PixelsToUnits,
                                  'pivot': [d.m_Pivot.x, d.m_Pivot.y], 'border': [0, 0, 0, 0]}
json.dump(icons, open(os.path.join(OUT, 'tower-icons.json'), 'w'), indent=1, sort_keys=True)
json.dump(meta, open(os.path.join(OUT, 'sprites.json'), 'w'), indent=1, sort_keys=True)

# fonts
env = UnityPy.load(os.path.join(AB, 'main_assets'))
tex = {}; fonts = {}; cf = {}
for o in env.objects:
    t = o.type.name
    if t == 'Texture2D':
        d = o.read(); tex[d.m_Name] = d.image
    elif t == 'Font':
        d = o.read_typetree(); fonts[d['m_Name']] = d
    elif t == 'MonoBehaviour':
        d = o.read_typetree()
        if d.get('m_Name', '').startswith('Font_0') and 'm_kerningList' in d:
            cf[d['m_Name']] = d
for name in ('Font_00', 'Font_01', 'Font_02'):
    img = tex[name]; f = fonts[name]; c = cf[name]
    img.save(os.path.join(OUT, 'fonts', name + '.png'))
    glyphs = {}
    for r in f['m_CharacterRects']:
        glyphs[str(r['index'])] = {
            'uv': [r['uv']['x'], r['uv']['y'], r['uv']['width'], r['uv']['height']],
            'vert': [r['vert']['x'], r['vert']['y'], r['vert']['width'], r['vert']['height']],
            'advance': r['advance'],
        }
    json.dump({
        'atlas': list(img.size), 'ascent': c['m_ascent'], 'lineHeight': c['m_lineHeight'],
        'bearing': c['m_bearning'], 'size': c['m_fontSize'], 'sourceFont': c['m_useFontName'],
        'pixelScale': f['m_PixelScale'],
        'kerning': [[k['left'], k['right'], k['value']] for k in c['m_kerningList']],
        'glyphs': glyphs,
    }, open(os.path.join(OUT, 'fonts', name + '.json'), 'w'))
print('sprites', len(meta), 'icons', icons)
