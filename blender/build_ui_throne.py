"""Title screen Serpent Throne (ui-flow C2 r1): the throne is now a REAL lit 3D asset rendered with Cycles, not a flat vector paint.
Obsidian gothic throne with a tall spired back, carved caduceus-knot medallion, two colossal scaled cobras coiled round the dais
whose hooded heads rear over the backrest, cracked basalt dais + stairs with a ragged crimson runner, two stone braziers with green
witchfire, the copper axe relic glowing on the seat, rubble - lit by the dusk sun from behind-left (orange rim), violet sky fill and
the green fire.  Renders RGBA (transparent film) as a float .npy that blender/ui_title_paint.py composites into the dusk backdrop.

    node tools/blender-run.mjs --owner ui-flow --what "ui throne" -- -b --factory-startup -P blender/build_ui_throne.py -- [--fast] [--w 1408] [--samples 192]
    -> progress/tmp/throne_rgba.npy (float16, H x W x 4, premultiplied-by-Cycles straight RGBA) + progress/tmp/throne_preview.png
Reference (look only, never shipped): docs/refs/c2/world/serpent_throne.png.
"""
import os
import sys
import math
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import numpy as np
import bpy
import bmesh
from mathutils import Vector, noise as mnoise

from lib import meshutil, pipeline

ROOT = os.path.dirname(HERE)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None, cast=str):
    if name in ARGS:
        i = ARGS.index(name)
        return cast(ARGS[i + 1]) if i + 1 < len(ARGS) and not ARGS[i + 1].startswith('--') else True
    return default


FAST = '--fast' in ARGS
RW = int(arg('--w', 704 if FAST else 1408, int))
ASPECT = 1.10                                  # width / height of the throne frame
RH = int(round(RW / ASPECT))
SAMPLES = int(arg('--samples', 24 if FAST else 192, int))
LOG = lambda *a: print('[throne]', *a, flush=True)
T00 = time.time()
rs = np.random.RandomState(7)

meshutil.clear_scene()
sc = bpy.context.scene
pipeline.setup_cycles('AUTO', SAMPLES)
try:
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_x = RW
sc.render.resolution_y = RH
sc.render.resolution_percentage = 100
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
try:
    sc.view_settings.look = 'None'
except Exception:
    pass
try:
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 4
    sc.cycles.sample_clamp_indirect = 8.0
except Exception:
    pass

# ================================================================================================ small helpers
def mk_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    sh = build(nt)
    nt.links.new(sh.outputs[0], out.inputs['Surface'])
    return m


def N(nt, typ, **kw):
    n = nt.nodes.new(typ)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def L(nt, a, ao, b, bi):
    nt.links.new(a.outputs[ao] if isinstance(ao, (int, str)) else ao, b.inputs[bi])


def ramp(nt, stops):
    r = N(nt, 'ShaderNodeValToRGB')
    el = r.color_ramp.elements
    while len(el) > len(stops):
        el.remove(el[-1])
    while len(el) < len(stops):
        el.new(0.5)
    for e, (p, c) in zip(el, stops):
        e.position = p
        e.color = c if len(c) == 4 else (c[0], c[1], c[2], 1)
    return r


def _sock(v):
    if hasattr(v, 'outputs'):
        return v.outputs[2] if v.bl_idname == 'ShaderNodeMix' else v.outputs[0]     # Mix(RGBA): colour result is socket 2
    return v


def _is_link(v):
    return hasattr(v, 'outputs') or hasattr(v, 'links')


def mix(nt, fac, a, b):
    m = N(nt, 'ShaderNodeMix', data_type='RGBA')
    if _is_link(fac):
        nt.links.new(_sock(fac), m.inputs[0])
    else:
        m.inputs[0].default_value = fac
    for idx, v in ((6, a), (7, b)):
        if _is_link(v):
            nt.links.new(_sock(v), m.inputs[idx])
        else:
            m.inputs[idx].default_value = v if len(v) == 4 else (v[0], v[1], v[2], 1)
    return m


def principled(nt, base=(0.1, 0.1, 0.1, 1), rough=0.6, metal=0.0, spec=0.5):
    b = N(nt, 'ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = base
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs:
            b.inputs[k].default_value = spec
    return b


def mathn(nt, op, a=None, b=None, clamp=False):
    m = N(nt, 'ShaderNodeMath', operation=op)
    m.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if hasattr(v, 'outputs'):
            nt.links.new(v.outputs[0], m.inputs[i])
        elif hasattr(v, 'links'):                     # a bare output socket
            nt.links.new(v, m.inputs[i])
        else:
            m.inputs[i].default_value = v
    return m


def noise_tex(nt, vec, scale, detail=4.0, rough=0.55):
    n = N(nt, 'ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    if vec is not None:
        nt.links.new(vec, n.inputs['Vector'])
    return n


# ------------------------------------------------------------------------------------------------ materials
SD = {}
def stone_shader(nt, tint=(1, 1, 1), moss=0.8, crack=1.0):
    tc = N(nt, 'ShaderNodeTexCoord')
    geo = N(nt, 'ShaderNodeNewGeometry')
    big = noise_tex(nt, tc.outputs['Object'], 0.7, 5, 0.6)
    fine = noise_tex(nt, tc.outputs['Object'], 9.0, 6, 0.65)
    vor = N(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    vor.inputs['Scale'].default_value = 0.75
    vor.inputs['Randomness'].default_value = 1.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    crk = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.035, (0.6, 0.6, 0.6, 1)), (0.06, (1, 1, 1, 1))])
    nt.links.new(vor.outputs['Distance'], crk.inputs['Fac'])
    base = ramp(nt, [(0.25, (0.034 * tint[0], 0.027 * tint[1], 0.042 * tint[2], 1)), (0.55, (0.10 * tint[0], 0.080 * tint[1], 0.10 * tint[2], 1)),
                     (0.85, (0.19 * tint[0], 0.155 * tint[1], 0.165 * tint[2], 1))])
    nt.links.new(big.outputs['Fac'], base.inputs['Fac'])
    # moss in concave crevices
    cav = ramp(nt, [(0.40, (1, 1, 1, 1)), (0.50, (0, 0, 0, 1))])
    nt.links.new(geo.outputs['Pointiness'], cav.inputs['Fac'])
    col = mix(nt, 0.0, base, (0.05, 0.10, 0.03, 1))
    mf = mathn(nt, 'MULTIPLY', cav, fine)
    mf2 = mathn(nt, 'MULTIPLY', mf, moss)
    nt.links.new(mf2.outputs[0], col.inputs[0])
    col2 = mix(nt, crk, (0.004, 0.003, 0.005, 1), col)
    # edge wear: lighten convex edges
    edge = ramp(nt, [(0.52, (0, 0, 0, 1)), (0.66, (1, 1, 1, 1))])
    nt.links.new(geo.outputs['Pointiness'], edge.inputs['Fac'])
    col3 = mix(nt, mathn(nt, 'MULTIPLY', edge, 0.55), col2, (0.20, 0.17, 0.17, 1))
    b = principled(nt, rough=0.78, spec=0.35)
    nt.links.new(col3.outputs[2], b.inputs['Base Color'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.8
    bump.inputs['Distance'].default_value = 0.08
    hh = mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', fine, 0.5), mathn(nt, 'MULTIPLY', crk, 0.7))
    nt.links.new(hh.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def obsidian_shader(nt, panel=False):
    tc = N(nt, 'ShaderNodeTexCoord')
    n1 = noise_tex(nt, tc.outputs['Object'], 1.3, 5, 0.6)
    n2 = noise_tex(nt, tc.outputs['Object'], 18.0, 4, 0.5)
    vor = N(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    vor.inputs['Scale'].default_value = 2.1
    vor.inputs['Randomness'].default_value = 1.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    crk = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.022, (0, 0, 0, 1))])           # thin hairline cracks
    nt.links.new(vor.outputs['Distance'], crk.inputs['Fac'])
    base = ramp(nt, [(0.30, (0.007, 0.006, 0.012, 1)), (0.7, (0.028, 0.020, 0.040, 1))])
    nt.links.new(n1.outputs['Fac'], base.inputs['Fac'])
    b = principled(nt, rough=0.3, spec=0.7)
    b.inputs['Coat Weight'].default_value = 0.35
    b.inputs['Coat Roughness'].default_value = 0.2
    nt.links.new(base.outputs[0], b.inputs['Base Color'])
    rr = ramp(nt, [(0.3, (0.16, 0.16, 0.16, 1)), (0.8, (0.50, 0.50, 0.50, 1))])
    nt.links.new(n2.outputs['Fac'], rr.inputs['Fac'])
    r2 = mathn(nt, 'MAXIMUM', rr, mathn(nt, 'MULTIPLY', crk, 0.9))
    nt.links.new(r2.outputs[0], b.inputs['Roughness'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.55
    bump.inputs['Distance'].default_value = 0.05
    hh = mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', n2, 0.35), mathn(nt, 'MULTIPLY', crk, 0.9))
    nt.links.new(hh.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def scale_shader(nt):
    """Cobra skin: imbricate overlapping scales (staggered rows, rounded free tips pointing to the tail, dark grooves between them),
    per-scale tone from a white-noise hash, wet specular, pale belly/hood front via the 'Col' red channel."""
    uv = N(nt, 'ShaderNodeUVMap', uv_map='UV')
    col_attr = N(nt, 'ShaderNodeAttribute', attribute_name='Col', attribute_type='GEOMETRY')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs['Vector'])
    X0, Y0 = sep.outputs['X'], sep.outputs['Y']

    def m(op, a, b=None):
        n = N(nt, 'ShaderNodeMath', operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    # C2 r13 (board r12 "hood scales tile as a halftone repeat"): warp the scale lattice with two low-frequency noises so rows wander and scale
    # sizes breathe instead of printing a regular dot grid (at title size a perfect lattice aliases into halftone).
    wz1 = N(nt, 'ShaderNodeTexNoise'); wz1.inputs['Scale'].default_value = 0.55; wz1.inputs['Detail'].default_value = 2.0
    nt.links.new(uv.outputs['UV'], wz1.inputs['Vector'])
    voff = N(nt, 'ShaderNodeVectorMath', operation='ADD'); voff.inputs[1].default_value = (7.3, 3.1, 0.0)
    nt.links.new(uv.outputs['UV'], voff.inputs[0])
    wz2 = N(nt, 'ShaderNodeTexNoise'); wz2.inputs['Scale'].default_value = 0.8; wz2.inputs['Detail'].default_value = 2.0
    nt.links.new(voff.outputs[0], wz2.inputs['Vector'])
    # C2 r15 (board r14 "hood rows = stamped shingle rows"): a third, mid-frequency noise makes the rows wavy, and the 'Col' alpha channel (hood-edge
    # factor e, 0 on the body and the hood centre -> 1 at the hood's side edge) compresses the row lattice toward the edge about the hood's own origin
    # (yh0 = the hood's first row), so the scales shrink and the rows curve like real hood scales fall off toward the rim.
    wz3 = N(nt, 'ShaderNodeTexNoise'); wz3.inputs['Scale'].default_value = 2.4; wz3.inputs['Detail'].default_value = 2.0
    voff3 = N(nt, 'ShaderNodeVectorMath', operation='ADD'); voff3.inputs[1].default_value = (3.7, 11.9, 0.0)
    nt.links.new(uv.outputs['UV'], voff3.inputs[0])
    nt.links.new(voff3.outputs[0], wz3.inputs['Vector'])
    edgef = col_attr.outputs['Alpha']
    yh0 = N(nt, 'ShaderNodeValue'); yh0.outputs[0].default_value = 0.0
    SD['yh0'] = yh0
    X = m('ADD', X0, m('MULTIPLY', m('SUBTRACT', wz1.outputs['Fac'], 0.5), 1.1))
    Yw = m('ADD', m('ADD', Y0, m('MULTIPLY', m('SUBTRACT', wz2.outputs['Fac'], 0.5), 1.25)), m('MULTIPLY', m('SUBTRACT', wz3.outputs['Fac'], 0.5), 0.55))
    Y = m('ADD', Yw, m('MULTIPLY', m('MULTIPLY', edgef, 0.70), m('SUBTRACT', Yw, yh0.outputs[0])))
    row = m('FLOOR', Y)
    par = m('MODULO', row, 2.0)
    xs = m('ADD', X, m('MULTIPLY', par, 0.5))
    # C2 r14 (board r13 "hood scales = uniform stamped scallop rows with identical arc highlights, plastic-smooth"): every scale owns three independent
    # hashes (cell colour channels): h1 tone / highlight gain, h2 size + warm tint, h3 tilt + where its arc highlight sits.
    cells = N(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(m('FLOOR', xs), cells.inputs['X'])
    nt.links.new(row, cells.inputs['Y'])
    wn = N(nt, 'ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    nt.links.new(cells.outputs[0], wn.inputs['Vector'])
    hsp = N(nt, 'ShaderNodeSeparateColor')
    nt.links.new(wn.outputs['Color'], hsp.inputs['Color'])
    h1, h2, h3 = hsp.outputs['Red'], hsp.outputs['Green'], hsp.outputs['Blue']
    fxr = m('SUBTRACT', m('FRACT', xs), 0.5)
    fyr = m('SUBTRACT', 1.0, m('FRACT', Y))
    fx = m('ADD', fxr, m('MULTIPLY', m('MULTIPLY', m('SUBTRACT', h3, 0.5), 0.70), fyr))      # per-scale tilt: the free tip drifts sideways
    fy = m('ADD', fyr, m('MULTIPLY', m('SUBTRACT', h2, 0.5), 0.26))                           # per-scale length
    sizev = m('ADD', 0.70, m('MULTIPLY', h2, 0.55))                                           # per-scale tip-size
    tipy = m('MULTIPLY', m('ADD', 0.66, m('MULTIPLY', 0.34, m('SUBTRACT', 1.0, m('MULTIPLY', m('MULTIPLY', fx, fx), 4.0)))), sizev)
    rel0 = m('DIVIDE', fy, tipy)
    rel = m('MULTIPLY', rel0, m('ADD', 0.93, m('MULTIPLY', h3, 0.12)))                         # the bright rim band slides per scale
    hr = ramp(nt, [(0.0, (0.0, 0, 0, 1)), (0.30, (0.45, 0.45, 0.45, 1)), (0.80, (0.9, 0.9, 0.9, 1)), (0.93, (1, 1, 1, 1)), (0.985, (0.25, 0.25, 0.25, 1)), (1.0, (0.0, 0, 0, 1))])
    nt.links.new(rel, hr.inputs['Fac'])
    # per-scale highlight gain (0.38..1.0) so the arcs are not identical stamps; the groove (value 0) is untouched
    hrg = N(nt, 'ShaderNodeMath', operation='MULTIPLY')
    nt.links.new(hr.outputs[0], hrg.inputs[0])
    nt.links.new(m('ADD', 0.38, m('MULTIPLY', h1, 0.62)), hrg.inputs[1])
    big = N(nt, 'ShaderNodeTexNoise')
    big.inputs['Scale'].default_value = 0.35
    big.inputs['Detail'].default_value = 3.0
    nt.links.new(uv.outputs['UV'], big.inputs['Vector'])
    tonef = m('ADD', m('MULTIPLY', h1, 0.80), m('MULTIPLY', big.outputs['Fac'], 0.9))
    sk = ramp(nt, [(0.0, (0.006, 0.009, 0.007, 1)), (0.50, (0.030, 0.044, 0.026, 1)), (1.0, (0.095, 0.110, 0.050, 1))])      # r15: value lift ~x2.8 (board r14: near-black green mass at 1x); r12 olive-brown
    nt.links.new(tonef, sk.inputs['Fac'])
    warmf = m('MINIMUM', m('MAXIMUM', m('MULTIPLY', m('SUBTRACT', h2, 0.40), 1.3), 0.0), 0.75)     # r14: ~half the scales drift toward warm umber, the rest stay olive
    body = mix(nt, warmf, sk.outputs[0], (0.150, 0.088, 0.034, 1))
    shade = mix(nt, hr, (0.0030, 0.007, 0.005, 1), body)                          # grooves dark, scale body = tone
    pale = mix(nt, hr, (0.006, 0.007, 0.004, 1), mix(nt, wn.outputs['Value'], (0.085, 0.085, 0.040, 1), (0.16, 0.15, 0.075, 1)))
    sp = N(nt, 'ShaderNodeSeparateColor')
    nt.links.new(col_attr.outputs['Color'], sp.inputs['Color'])
    fin = mix(nt, 0.0, shade, pale)
    nt.links.new(sp.outputs['Red'], fin.inputs[0])
    # r12 bronze (hood rim, skull scutes): scale bodies go warm bronze-brown, tips catch a copper edge; spectacle: pale parchment scales with dark groove lines
    bron_body = mix(nt, wn.outputs['Value'], (0.17, 0.115, 0.032, 1), (0.34, 0.24, 0.075, 1))      # r15: olive bronze (the orange read against the orange sky)
    bron = mix(nt, hr, (0.012, 0.007, 0.003, 1), bron_body)
    fin2 = mix(nt, 0.0, fin, bron)
    nt.links.new(sp.outputs['Green'], fin2.inputs[0])
    spec_body = mix(nt, wn.outputs['Value'], (0.80, 0.60, 0.32, 1), (1.0, 0.86, 0.52, 1))
    spec = mix(nt, hr, (0.018, 0.012, 0.006, 1), spec_body)
    fin3 = mix(nt, 0.0, fin2, spec)
    nt.links.new(sp.outputs['Blue'], fin3.inputs[0])
    b = principled(nt, rough=0.42, spec=0.20)                                    # r14: matte keratin (was a wet 0.35 spec / 0.42 rough)
    b.inputs['Coat Weight'].default_value = 0.0
    b.inputs['Coat Roughness'].default_value = 0.25
    nt.links.new(fin3.outputs[2], b.inputs['Base Color'])
    SD.update({'fin': fin, 'fin2': fin2, 'fin3': fin3, 'spec': spec, 'sp': sp, 'b': b, 'bron': bron})
    b.inputs['Metallic'].default_value = 0.0
    nt.links.new(m('MULTIPLY', sp.outputs['Green'], 0.65), b.inputs['Metallic'])
    rg = m('ADD', 0.80, m('MULTIPLY', hrg.outputs[0], -0.20))
    nt.links.new(m('ADD', rg, m('MULTIPLY', sp.outputs['Green'], -0.22)), b.inputs['Roughness'])
    # keratin micro-grain: fine striations running along the scale (stretched noise) so a lit scale is not a smooth plastic dome
    stv = N(nt, 'ShaderNodeVectorMath', operation='MULTIPLY')
    nt.links.new(uv.outputs['UV'], stv.inputs[0])
    stv.inputs[1].default_value = (46.0, 150.0, 1.0)
    stn = N(nt, 'ShaderNodeTexNoise'); stn.inputs['Scale'].default_value = 1.0; stn.inputs['Detail'].default_value = 3.0; stn.inputs['Roughness'].default_value = 0.6
    nt.links.new(stv.outputs[0], stn.inputs['Vector'])
    hbump = m('ADD', m('MULTIPLY', hrg.outputs[0], 0.55), m('MULTIPLY', m('SUBTRACT', stn.outputs['Fac'], 0.5), 0.34))
    # C2 r15 (board r14 "stamped scale rows, smooth lofted tubes"): the imbricate height field (rising to the free tip, dropping to the groove) is now REAL
    # displacement (per-scale gain, a per-scale lift so neighbours sit at different depths) on a pre-subdivided hood; the bump keeps the micro-grain only.
    dsp = N(nt, 'ShaderNodeDisplacement')
    dsp.inputs['Midlevel'].default_value = 0.0
    dsp.inputs['Scale'].default_value = 0.075
    # (damped where the bronze head scutes are - 'Col' green - so the sculpted skull is not buried under scale noise; finer there)
    nt.links.new(m('MULTIPLY', m('ADD', hrg.outputs[0], m('MULTIPLY', m('SUBTRACT', h1, 0.5), 0.22)), m('SUBTRACT', 1.0, m('MULTIPLY', sp.outputs['Green'], 0.80))), dsp.inputs['Height'])
    outn_ = [n_ for n_ in nt.nodes if n_.type == 'OUTPUT_MATERIAL'][0]
    nt.links.new(dsp.outputs['Displacement'], outn_.inputs['Displacement'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = 0.05
    nt.links.new(hbump, bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def metal_shader(nt, col=(0.80, 0.36, 0.14, 1), rough=0.28, glow=0.0):
    b = principled(nt, base=col, rough=rough, metal=1.0, spec=0.6)
    tc = N(nt, 'ShaderNodeTexCoord')
    n = noise_tex(nt, tc.outputs['Object'], 14.0, 5, 0.6)
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.4
    bump.inputs['Distance'].default_value = 0.01
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    rr = ramp(nt, [(0.3, (0.18, 0.18, 0.18, 1)), (0.8, (0.55, 0.55, 0.55, 1))])
    nt.links.new(n.outputs['Fac'], rr.inputs['Fac'])
    nt.links.new(rr.outputs[0], b.inputs['Roughness'])
    if glow > 0:
        b.inputs['Emission Color'].default_value = (1.0, 0.40, 0.10, 1)
        b.inputs['Emission Strength'].default_value = glow
    return b


def cloth_shader(nt):
    tc = N(nt, 'ShaderNodeTexCoord')
    n = noise_tex(nt, tc.outputs['Object'], 3.5, 5, 0.6)
    w = N(nt, 'ShaderNodeTexWave', wave_type='BANDS')
    w.inputs['Scale'].default_value = 90
    nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
    base = ramp(nt, [(0.2, (0.045, 0.003, 0.004, 1)), (0.7, (0.20, 0.014, 0.014, 1))])
    nt.links.new(n.outputs['Fac'], base.inputs['Fac'])
    b = principled(nt, rough=0.9, spec=0.15)
    b.inputs['Sheen Weight'].default_value = 0.6
    nt.links.new(base.outputs[0], b.inputs['Base Color'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.01
    nt.links.new(w.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def emit_shader(nt, col, strength):
    e = N(nt, 'ShaderNodeEmission')
    e.inputs['Color'].default_value = col
    e.inputs['Strength'].default_value = strength
    return e


def flame_shader(nt):
    tc = N(nt, 'ShaderNodeTexCoord')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    r = ramp(nt, [(0.0, (0.02, 0.8, 0.05, 1)), (0.55, (0.10, 1.0, 0.06, 1)), (1.0, (0.45, 1.0, 0.12, 1))])
    nt.links.new(sep.outputs['Z'], r.inputs['Fac'])
    e = N(nt, 'ShaderNodeEmission')
    e.inputs['Strength'].default_value = 1.7
    nt.links.new(r.outputs[0], e.inputs['Color'])
    # soft edges: fade the tip + the silhouette (layer-weight facing) towards transparent
    t = N(nt, 'ShaderNodeBsdfTransparent')
    fade = ramp(nt, [(0.30, (0, 0, 0, 1)), (1.0, (0.9, 0.9, 0.9, 1))])
    nt.links.new(sep.outputs['Z'], fade.inputs['Fac'])
    lw = N(nt, 'ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    face = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.85, (0.0, 0, 0, 1))])
    nt.links.new(lw.outputs['Facing'], face.inputs['Fac'])
    ofac = mathn(nt, 'SUBTRACT', 1.0, mathn(nt, 'MULTIPLY', mathn(nt, 'SUBTRACT', 1.0, fade), face))
    m = N(nt, 'ShaderNodeMixShader')
    nt.links.new(ofac.outputs[0], m.inputs[0])
    nt.links.new(e.outputs[0], m.inputs[1])
    nt.links.new(t.outputs[0], m.inputs[2])
    return m


def eye_shader(nt):
    """Cobra eye (C2 r11): a recessed glowing iris - hot yellow-green core falling off to a dark olive rim - with a vertical slit pupil."""
    tc = N(nt, 'ShaderNodeTexCoord')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    lw = N(nt, 'ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    rr = ramp(nt, [(0.0, (0.02, 0.07, 0.01, 1)), (0.35, (0.08, 0.40, 0.02, 1)), (0.75, (0.35, 0.95, 0.06, 1)), (1.0, (0.70, 1.0, 0.20, 1))])
    nt.links.new(lw.outputs['Facing'], rr.inputs['Fac'])
    dx = mathn(nt, 'ABSOLUTE', mathn(nt, 'SUBTRACT', sep.outputs['X'], 0.5))
    dy = mathn(nt, 'ABSOLUTE', mathn(nt, 'SUBTRACT', sep.outputs['Y'], 0.5))
    slit = ramp(nt, [(0.09, (0, 0, 0, 1)), (0.17, (1, 1, 1, 1))])             # 0 inside the slit
    sx_ = mathn(nt, 'ADD', dx, mathn(nt, 'MULTIPLY', dy, 0.18))
    nt.links.new(sx_.outputs[0], slit.inputs['Fac'])
    e = N(nt, 'ShaderNodeEmission')
    e.inputs['Strength'].default_value = 3.4
    col = mix(nt, slit, (0.0, 0.0, 0.0, 1), rr)
    nt.links.new(col.outputs[2], e.inputs['Color'])
    return e


def lens_shader(nt):
    """C2 r15 (board r14 'dot eyes'): a wet cornea over the glowing iris - mostly clear, a sharp glossy reflection at the grazing edge and from the key lamp,
    so each eye carries a lit lens / catch-light instead of a flat green dot."""
    t = N(nt, 'ShaderNodeBsdfTransparent')
    g = N(nt, 'ShaderNodeBsdfGlossy')
    g.inputs['Roughness'].default_value = 0.035
    g.inputs['Color'].default_value = (1.0, 0.97, 0.88, 1)
    fr = N(nt, 'ShaderNodeLayerWeight')
    fr.inputs['Blend'].default_value = 0.30
    f = mathn(nt, 'ADD', 0.26, mathn(nt, 'MULTIPLY', fr.outputs['Fresnel'], 0.75), clamp=True)
    m = N(nt, 'ShaderNodeMixShader')
    nt.links.new(f.outputs[0], m.inputs[0])
    nt.links.new(t.outputs[0], m.inputs[1])
    nt.links.new(g.outputs[0], m.inputs[2])
    return m


def mouth_shader(nt):
    """Mouth lining: wet crimson-pink flesh with transverse palate ridges and fine veins, going black toward the throat."""
    tc = N(nt, 'ShaderNodeTexCoord')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    w = N(nt, 'ShaderNodeTexWave', wave_type='BANDS')
    w.inputs['Scale'].default_value = 9
    w.inputs['Distortion'].default_value = 3.0
    nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
    vn = noise_tex(nt, tc.outputs['Object'], 22.0, 5, 0.6)
    base = ramp(nt, [(0.2, (0.10, 0.012, 0.014, 1)), (0.6, (0.30, 0.050, 0.045, 1)), (0.9, (0.46, 0.17, 0.12, 1))])
    nt.links.new(vn.outputs['Fac'], base.inputs['Fac'])
    ridge = mix(nt, w.outputs['Fac'], (1.0, 1.0, 1.0, 1), (0.55, 0.55, 0.55, 1))
    col = mix(nt, 0.55, base, (0.0, 0.0, 0.0, 1))
    fadeb = ramp(nt, [(0.05, (0.0, 0.0, 0.0, 1)), (0.7, (1.0, 1.0, 1.0, 1))])             # darker toward the back of the throat
    nt.links.new(sep.outputs['Z'], fadeb.inputs['Fac'])
    dark = mix(nt, fadeb, (0.004, 0.0, 0.002, 1), base)
    b = principled(nt, rough=0.24, spec=0.6)
    b.inputs['Coat Weight'].default_value = 0.5
    b.inputs['Coat Roughness'].default_value = 0.12
    nt.links.new(dark.outputs[2], b.inputs['Base Color'])
    # r12: witchfire glows INSIDE the throat (sculpt ref: green light in the mouth), strongest toward the back, ridged by the palate waves
    glow = ramp(nt, [(0.0, (0.0, 0.0, 0.0, 1)), (0.35, (0.05, 0.55, 0.05, 1)), (1.0, (0.35, 1.0, 0.12, 1))])
    gfac = mathn(nt, 'MULTIPLY', mathn(nt, 'SUBTRACT', 1.0, fadeb), mathn(nt, 'ADD', 0.55, mathn(nt, 'MULTIPLY', w.outputs['Fac'], 0.5)))
    nt.links.new(gfac.outputs[0], glow.inputs['Fac'])
    nt.links.new(glow.outputs[0], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.4
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.7
    bump.inputs['Distance'].default_value = 0.05
    hh = mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', w.outputs['Fac'], 0.6), mathn(nt, 'MULTIPLY', vn.outputs['Fac'], 0.4))
    nt.links.new(hh.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def fang_shader(nt):
    """Fang / tooth: stained amber-brown at the gum, bone ivory toward the tip (vertex 'Col'.R = 0 root .. 1 tip), glossy with streaks."""
    col_attr = N(nt, 'ShaderNodeAttribute', attribute_name='Col', attribute_type='GEOMETRY')
    sp = N(nt, 'ShaderNodeSeparateColor')
    nt.links.new(col_attr.outputs['Color'], sp.inputs['Color'])
    tc = N(nt, 'ShaderNodeTexCoord')
    n = noise_tex(nt, tc.outputs['Object'], 40.0, 4, 0.6)
    r = ramp(nt, [(0.0, (0.22, 0.12, 0.04, 1)), (0.45, (0.62, 0.50, 0.30, 1)), (1.0, (0.92, 0.88, 0.72, 1))])
    nt.links.new(sp.outputs['Red'], r.inputs['Fac'])
    col = mix(nt, mathn(nt, 'MULTIPLY', n, 0.25), r, (0.15, 0.10, 0.05, 1))
    b = principled(nt, rough=0.3, spec=0.6)
    b.inputs['Coat Weight'].default_value = 0.4
    nt.links.new(col.outputs[2], b.inputs['Base Color'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.3
    bump.inputs['Distance'].default_value = 0.01
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def tongue_shader(nt):
    col_attr = N(nt, 'ShaderNodeAttribute', attribute_name='Col', attribute_type='GEOMETRY')
    sp = N(nt, 'ShaderNodeSeparateColor')
    nt.links.new(col_attr.outputs['Color'], sp.inputs['Color'])
    tc = N(nt, 'ShaderNodeTexCoord')
    n = noise_tex(nt, tc.outputs['Object'], 60.0, 4, 0.6)
    r = ramp(nt, [(0.0, (0.022, 0.040, 0.020, 1)), (0.7, (0.075, 0.12, 0.05, 1)), (1.0, (0.16, 0.22, 0.09, 1))])
    nt.links.new(sp.outputs['Red'], r.inputs['Fac'])
    col = mix(nt, mathn(nt, 'MULTIPLY', n, 0.3), r, (0.012, 0.022, 0.010, 1))
    b = principled(nt, rough=0.5, spec=0.35)
    b.inputs['Coat Weight'].default_value = 0.08
    b.inputs['Coat Roughness'].default_value = 0.3
    nt.links.new(col.outputs[2], b.inputs['Base Color'])
    bump = N(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.01
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return b


def ramp_f(nt, fac_out, stops):
    """scalar piecewise ramp (value 0..1) of a float output."""
    r = ramp(nt, [(p_, (v_, v_, v_, 1)) for p_, v_ in stops])
    nt.links.new(fac_out, r.inputs['Fac'])
    return r


def flame_sheet_shader(nt, hot=0.0):
    """Witchfire tongue sheet (UV x across, y up): streaky turbulent alpha, soft side + tip falloff, hot pale-green base -> saturated green -> dark tip."""
    uv = N(nt, 'ShaderNodeUVMap', uv_map='UV')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs['Vector'])
    X, Yv = sep.outputs['X'], sep.outputs['Y']
    cmb = N(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(mathn(nt, 'MULTIPLY', X, 5.0).outputs[0], cmb.inputs['X'])
    nt.links.new(mathn(nt, 'MULTIPLY', Yv, 1.4).outputs[0], cmb.inputs['Y'])
    cmb.inputs['Z'].default_value = 3.3
    nz = N(nt, 'ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 1.8
    nz.inputs['Detail'].default_value = 5.0
    nz.inputs['Roughness'].default_value = 0.62
    nt.links.new(cmb.outputs[0], nz.inputs['Vector'])
    edge = mathn(nt, 'SUBTRACT', 1.0, mathn(nt, 'MULTIPLY', mathn(nt, 'ABSOLUTE', mathn(nt, 'SUBTRACT', mathn(nt, 'MULTIPLY', X, 2.0), 1.0)), 1.0))
    ed = ramp(nt, [(0.0, (0, 0, 0, 1)), (0.92, (1, 1, 1, 1))])                 # r12: soft side falloff (no hard blade edge)
    nt.links.new(edge.outputs[0], ed.inputs['Fac'])
    tip = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.35, (0.78, 0.78, 0.78, 1)), (0.68, (0.26, 0.26, 0.26, 1)), (0.90, (0.05, 0.05, 0.05, 1)), (1.0, (0, 0, 0, 1))])      # r15: soft transparent tip
    nt.links.new(Yv, tip.inputs['Fac'])
    base_ = mathn(nt, 'MULTIPLY', ed, tip)
    # C2 r14 (board r13 "witchfire = solid neon-green gradient blobs, hard white core, no tongues, no translucency"): the turbulence now carves
    # real gaps (a vertical-streak noise splits each sheet into licks and detaches the tips), alpha tops out < 1 so the tongues are translucent
    # and overlap into depth, and the core is a pale lime that stays inside the green family (no white, no flat clip).
    cmb2 = N(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(mathn(nt, 'MULTIPLY', X, 9.0).outputs[0], cmb2.inputs['X'])
    nt.links.new(mathn(nt, 'MULTIPLY', Yv, 0.8).outputs[0], cmb2.inputs['Y'])
    cmb2.inputs['Z'].default_value = 7.7
    nz2 = N(nt, 'ShaderNodeTexNoise')
    nz2.inputs['Scale'].default_value = 1.6
    nz2.inputs['Detail'].default_value = 3.0
    nz2.inputs['Roughness'].default_value = 0.55
    nt.links.new(cmb2.outputs[0], nz2.inputs['Vector'])
    tur = mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', nz, 0.50), mathn(nt, 'MULTIPLY', nz2, 0.62))
    a0 = mathn(nt, 'SUBTRACT', base_, tur)
    a1 = mathn(nt, 'MULTIPLY', mathn(nt, 'ADD', a0, 0.40), 2.1, clamp=True)
    a2 = mathn(nt, 'MULTIPLY', mathn(nt, 'MULTIPLY', a1, 0.92), ramp_f(nt, Yv, [(0.0, 0.0), (0.035, 0.55), (0.11, 1.0), (1.0, 1.0)]))      # r15: soft base
    # C2 r15 (board r14 'uniform green gel, hard-clipped base, highest saturation in the corner'): a HOT pale core at the base (low saturation, near cream-lime)
    # cooling to green and fading to a soft transparent tip; the base itself eases in (no flat cut line on the bowl) and sits on an ember pool (flamepool).
    col = ramp(nt, [(0.0, (0.86, 1.0, 0.62, 1) if hot else (0.74, 1.0, 0.52, 1)), (0.14, (0.50, 0.96, 0.30, 1)), (0.42, (0.15, 0.66, 0.13, 1)), (1.0, (0.025, 0.26, 0.06, 1))])
    # inner streaks: brighter / dimmer filaments rising along the tongue, so it reads as layered fire, not a flat green card
    nt.links.new(Yv, col.inputs['Fac'])
    e = N(nt, 'ShaderNodeEmission')
    stk = mathn(nt, 'ADD', 0.35, mathn(nt, 'MULTIPLY', nz2, 1.5))
    hotk = mathn(nt, 'ADD', 0.42, mathn(nt, 'MULTIPLY', mathn(nt, 'POWER', mathn(nt, 'SUBTRACT', 1.0, Yv), 3.2), 2.3))        # r15: brightest at the base
    nt.links.new(mathn(nt, 'MULTIPLY', mathn(nt, 'MULTIPLY', stk, 1.75), hotk).outputs[0], e.inputs['Strength'])
    nt.links.new(col.outputs[0], e.inputs['Color'])
    t = N(nt, 'ShaderNodeBsdfTransparent')
    m = N(nt, 'ShaderNodeMixShader')
    nt.links.new(a2.outputs[0], m.inputs[0])
    nt.links.new(t.outputs[0], m.inputs[1])
    nt.links.new(e.outputs[0], m.inputs[2])
    return m


def flame_pool_shader(nt):
    """Flat radial ember pool under the witchfire: hot pale-lime centre, soft transparent rim."""
    tc = N(nt, 'ShaderNodeTexCoord')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    dx = mathn(nt, 'SUBTRACT', sep.outputs['X'], 0.5)
    dy = mathn(nt, 'SUBTRACT', sep.outputs['Y'], 0.5)
    r = mathn(nt, 'SQRT', mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', dx, dx), mathn(nt, 'MULTIPLY', dy, dy)))
    al = ramp_f(nt, mathn(nt, 'MULTIPLY', r, 2.0).outputs[0], [(0.0, 1.0), (0.45, 0.62), (0.80, 0.12), (1.0, 0.0)])
    col = ramp(nt, [(0.0, (0.80, 1.0, 0.55, 1)), (0.5, (0.35, 0.95, 0.22, 1)), (1.0, (0.08, 0.45, 0.10, 1))])
    nt.links.new(mathn(nt, 'MULTIPLY', r, 2.0).outputs[0], col.inputs['Fac'])
    e = N(nt, 'ShaderNodeEmission')
    e.inputs['Strength'].default_value = 2.6
    nt.links.new(col.outputs[0], e.inputs['Color'])
    t = N(nt, 'ShaderNodeBsdfTransparent')
    m = N(nt, 'ShaderNodeMixShader')
    nt.links.new(al.outputs[0], m.inputs[0])
    nt.links.new(t.outputs[0], m.inputs[1])
    nt.links.new(e.outputs[0], m.inputs[2])
    return m


def flame_vol_mat():
    """Soft emissive green gas (Principled Volume, noise-driven density with radial + height falloff): the witchfire's body, behind the tongue sheets."""
    m = bpy.data.materials.new('flame_vol')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    tc = N(nt, 'ShaderNodeTexCoord')
    sep = N(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    dx = mathn(nt, 'SUBTRACT', sep.outputs['X'], 0.5)
    dy = mathn(nt, 'SUBTRACT', sep.outputs['Y'], 0.5)
    r2 = mathn(nt, 'ADD', mathn(nt, 'MULTIPLY', dx, dx), mathn(nt, 'MULTIPLY', dy, dy))
    rad = ramp(nt, [(0.0, (1, 1, 1, 1)), (0.07, (0.45, 0.45, 0.45, 1)), (0.19, (0, 0, 0, 1))])
    nt.links.new(r2.outputs[0], rad.inputs['Fac'])
    zr_ = ramp(nt, [(0.0, (0.9, 0.9, 0.9, 1)), (0.55, (0.6, 0.6, 0.6, 1)), (1.0, (0, 0, 0, 1))])
    nt.links.new(sep.outputs['Z'], zr_.inputs['Fac'])
    cmb = N(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], cmb.inputs['X'])
    nt.links.new(sep.outputs['Y'], cmb.inputs['Y'])
    nt.links.new(mathn(nt, 'SUBTRACT', sep.outputs['Z'], 0.0).outputs[0], cmb.inputs['Z'])
    nz = noise_tex(nt, cmb.outputs[0], 3.2, 5.0, 0.6)
    wsp = ramp(nt, [(0.38, (0, 0, 0, 1)), (0.62, (1, 1, 1, 1))])           # noise -> wisps (clear gaps between the filaments)
    nt.links.new(nz.outputs['Fac'], wsp.inputs['Fac'])
    dens = mathn(nt, 'MULTIPLY', mathn(nt, 'MULTIPLY', rad, zr_), mathn(nt, 'ADD', wsp, 0.10))
    pv = N(nt, 'ShaderNodeVolumePrincipled')
    nt.links.new(mathn(nt, 'MULTIPLY', dens, 0.8).outputs[0], pv.inputs['Density'])
    pv.inputs['Color'].default_value = (0.1, 0.5, 0.08, 1)
    pv.inputs['Emission Color'].default_value = (0.38, 1.0, 0.24, 1)
    nt.links.new(mathn(nt, 'MULTIPLY', dens, 0.9).outputs[0], pv.inputs['Emission Strength'])
    nt.links.new(pv.outputs['Volume'], out.inputs['Volume'])
    return m


M = {
    'stone': mk_mat('stone', lambda nt: stone_shader(nt)),
    'stone_b': mk_mat('stone_b', lambda nt: stone_shader(nt, tint=(1.15, 1.0, 0.9), moss=1.0)),
    'obsidian': mk_mat('obsidian', obsidian_shader),
    'scales': mk_mat('scales', scale_shader),
    'copper': mk_mat('copper', lambda nt: metal_shader(nt)),
    'axe': mk_mat('axe', lambda nt: metal_shader(nt, (0.50, 0.20, 0.07, 1), 0.42, glow=0.35)),
    'gold': mk_mat('gold', lambda nt: metal_shader(nt, (0.85, 0.55, 0.14, 1), 0.34)),
    'iron': mk_mat('iron', lambda nt: metal_shader(nt, (0.10, 0.10, 0.12, 1), 0.5)),
    'cloth': mk_mat('cloth', cloth_shader),
    'wood': mk_mat('wood', lambda nt: principled(nt, (0.06, 0.035, 0.02, 1), 0.7, 0.0, 0.3)),
    'eye': mk_mat('eye', eye_shader),
    'lens': mk_mat('lens', lens_shader),
    'mouth': mk_mat('mouth', mouth_shader),
    'tongue': mk_mat('tongue', tongue_shader),
    'fang': mk_mat('fang', fang_shader),
    'flame': mk_mat('flame', flame_shader),
    'flame_vol': flame_vol_mat(),
    'flame_sheet': mk_mat('flame_sheet', lambda nt: flame_sheet_shader(nt)),
    'flame_hot': mk_mat('flame_hot', lambda nt: flame_sheet_shader(nt, hot=1.0)),
    'flame_pool': mk_mat('flame_pool', flame_pool_shader),
    'rune': mk_mat('rune', lambda nt: emit_shader(nt, (0.2, 1.0, 0.15, 1), 0.32)),
    'ember': mk_mat('ember', lambda nt: emit_shader(nt, (1.0, 0.36, 0.08, 1), 1.5)),
}

M['scales'].displacement_method = 'DISPLACEMENT'       # C2 r15: real (non-adaptive) displacement of the cobra scale height field


# ------------------------------------------------------------------------------------------------ geometry helpers
def link(ob):
    sc.collection.objects.link(ob)
    return ob


def obj_from_bm(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def grid_box_bm(size, step=0.55, bevel=0.07, chip=0.05, seed=0, fn=3.0, rough_top=0.0):
    """Closed grid box (resolution ~step), outer edges bevelled, surface noise-displaced along the normal (chipped stone)."""
    sx, sy, sz = size
    bm = bmesh.new()
    faces = []
    for ax in range(3):
        for sgn in (-1, 1):
            others = [a for a in range(3) if a != ax]
            na, nb = max(1, int(math.ceil(size[others[0]] / step))), max(1, int(math.ceil(size[others[1]] / step)))
            vs = []
            for i in range(na + 1):
                row = []
                for j in range(nb + 1):
                    p = [0.0, 0.0, 0.0]
                    p[ax] = sgn * size[ax] / 2
                    p[others[0]] = (i / na - 0.5) * size[others[0]]
                    p[others[1]] = (j / nb - 0.5) * size[others[1]]
                    row.append(bm.verts.new(p))
                vs.append(row)
            for i in range(na):
                for j in range(nb):
                    q = [vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]]
                    if (ax + (0 if sgn > 0 else 1)) % 2 == 1:
                        q = q[::-1]
                    try:
                        bm.faces.new(q)
                    except ValueError:
                        pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel > 0:
        bm.edges.ensure_lookup_table()
        sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.9]
        bmesh.ops.bevel(bm, geom=sharp, offset=bevel, segments=2, affect='EDGES', profile=0.6)
    bm.normal_update()
    if chip > 0:
        for v in bm.verts:
            p = v.co
            d = mnoise.noise(Vector((p.x * fn + seed * 7.3, p.y * fn + 1.7, p.z * fn - seed * 3.1))) * chip
            d += mnoise.noise(Vector((p.x * fn * 3 + 9, p.y * fn * 3, p.z * fn * 3 + seed))) * chip * 0.35
            v.co = p + v.normal * d
    return bm


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale
    return ob


def box(name, center, size, mat, rot=(0, 0, 0), step=0.55, bevel=0.07, chip=0.05, seed=0, fn=3.0):
    bm = grid_box_bm(size, step, bevel, chip, seed, fn)
    return place(obj_from_bm(name, bm, mat), center, rot)


def lathe(name, prof, mat, seg=40, center=(0, 0, 0), noise_amp=0.0, seed=0):
    """Revolve profile [(r, z), ...] about Z."""
    prof = np.asarray(prof, np.float32)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    V = np.zeros((len(prof), seg, 3), np.float32)
    V[:, :, 0] = prof[:, 0, None] * np.cos(th)[None, :]
    V[:, :, 1] = prof[:, 0, None] * np.sin(th)[None, :]
    V[:, :, 2] = prof[:, 1, None]
    if noise_amp > 0:
        for i in range(len(prof)):
            for j in range(seg):
                p = V[i, j]
                V[i, j, :2] *= 1 + noise_amp * mnoise.noise(Vector((p[0] * 2 + seed, p[1] * 2, p[2] * 2)))
    bm = bmesh.new()
    vs = [[bm.verts.new(V[i, j]) for j in range(seg)] for i in range(len(prof))]
    for i in range(len(prof) - 1):
        for j in range(seg):
            try:
                bm.faces.new((vs[i][j], vs[i][(j + 1) % seg], vs[i + 1][(j + 1) % seg], vs[i + 1][j]))
            except ValueError:
                pass
    # caps
    try:
        bm.faces.new([vs[0][j] for j in range(seg)][::-1])
        bm.faces.new([vs[-1][j] for j in range(seg)])
    except ValueError:
        pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return place(obj_from_bm(name, bm, mat), center)


def rock(name, center, r, mat, sq=(1, 1, 0.7), seed=0, amp=0.32):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        p = v.co.copy()
        d = 1 + amp * mnoise.noise(Vector((p.x * 1.7 + seed, p.y * 1.7, p.z * 1.7))) + amp * 0.5 * mnoise.noise(Vector((p.x * 4.1, p.y * 4.1 + seed, p.z * 4.1)))
        # a few flat facets for broken stone
        v.co = Vector((p.x * d * sq[0], p.y * d * sq[1], max(p.z * d * sq[2], -0.25 * sq[2])))
    bm.normal_update()
    ob = obj_from_bm(name, bm, mat)
    return place(ob, center, (rs.uniform(0, 6.28) * 0, 0, rs.uniform(0, 6.28)), (r, r, r))


def prism(name, base_c, w, d, h, mat, sides=4, rot=0.0, top=0.0):
    prof = [(w, 0), (w * 0.98, h * 0.02), (top, h)]
    ob = lathe(name, prof, mat, seg=sides, center=base_c)
    ob.rotation_euler = (0, 0, rot + math.pi / sides)
    ob.data.shade_flat()
    return ob


# ---------------------------------------------------------------- swept tubes (cobra bodies, tails, tongues)
def catmull(P, n_per=14):
    P = np.asarray(P, np.float64)
    Q = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        t = np.linspace(0, 1, n_per, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1][None, :])
    return np.vstack(out)


def frames(P, wref=None, wref_from=1e9):
    """Rotation-minimising frames along polyline P; optionally blend into 'width axis = projected wref' from arclength fraction wref_from."""
    n = len(P)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    f = s / s[-1]
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    Bw = np.zeros((n, 3))
    b = ref - T[0] * np.dot(ref, T[0])
    b /= np.linalg.norm(b)
    Bw[0] = b
    for i in range(1, n):
        b = Bw[i - 1] - T[i] * np.dot(Bw[i - 1], T[i])
        b /= np.linalg.norm(b) + 1e-9
        Bw[i] = b
    if wref is not None:
        W0 = np.asarray(wref, np.float64)
        for i in range(n):
            if f[i] < wref_from:
                continue
            w = W0 - T[i] * np.dot(W0, T[i])
            nw = np.linalg.norm(w)
            if nw < 1e-3:
                continue
            w /= nw
            if np.dot(w, Bw[i]) < 0:
                w = -w
            k = min(1.0, (f[i] - wref_from) / 0.04)
            k = k * k * (3 - 2 * k)
            bb = Bw[i] * (1 - k) + w * k
            Bw[i] = bb / (np.linalg.norm(bb) + 1e-9)
    Bd = np.cross(T, Bw)
    return T, Bw, Bd, s


def sweep(name, P, A, B, mat, seg=28, wref=None, wref_from=1e9, cap_start=True, cap_end=True, scale_u=1.0, scale_v=1.0, pale=None,
          offset_fn=None, paint=None, scale_fn=None):
    """Swept elliptical tube: width axis A (along Bw), depth axis B (along Bd).  UV u = around (scale units), v = along (scale rows)."""
    P = np.asarray(P, np.float64)
    n = len(P)
    T, Bw, Bd, s = frames(P, wref, wref_from)
    A = np.broadcast_to(np.asarray(A, np.float64), (n,))
    B = np.broadcast_to(np.asarray(B, np.float64), (n,))
    th = np.linspace(0, 2 * np.pi, seg + 1)
    ct, st = np.cos(th), np.sin(th)
    V = P[:, None, :] + (A[:, None, None] * ct[None, :, None]) * Bw[:, None, :] + (B[:, None, None] * st[None, :, None]) * Bd[:, None, :]
    nrm_t = (ct[None, :, None] / A[:, None, None]) * Bw[:, None, :] + (st[None, :, None] / B[:, None, None]) * Bd[:, None, :]
    nrm_t /= np.linalg.norm(nrm_t, axis=2, keepdims=True) + 1e-9               # true ellipse surface normal (the radial vector of a thin hood is ~parallel to its face)
    if offset_fn is not None:
        V = offset_fn(V, s, nrm_t)
    # uvs: around-count follows the local circumference so scales keep a constant size
    circ = 2 * np.pi * np.sqrt((A ** 2 + B ** 2) / 2)
    mult = np.ones(n) if scale_fn is None else np.asarray(scale_fn(s), np.float64)      # r13: per-ring scale size (hood big, head fine)
    cs = np.maximum(np.round(circ / (0.17 * scale_u * mult)), 3.0)
    uu = (th / (2 * np.pi))[None, :] * cs[:, None]
    ds = np.concatenate([[0.0], np.diff(s)]) / (0.15 * scale_v * mult)
    vv = np.broadcast_to(np.cumsum(ds)[:, None], uu.shape)
    verts = V.reshape(-1, 3)
    faces = []
    for i in range(n - 1):
        for j in range(seg):
            a = i * (seg + 1) + j
            faces.append((a, a + 1, a + 1 + (seg + 1), a + (seg + 1)))
    uvs = np.stack([uu.reshape(-1), vv.reshape(-1)], 1)
    extra_v, extra_uv, extra_f = [], [], []
    for flag, ring in ((cap_start, 0), (cap_end, n - 1)):          # close the tube ends with a fan to the ring centre
        if not flag:
            continue
        ci = len(verts) + len(extra_v)
        extra_v.append(P[ring])
        extra_uv.append(uvs[ring * (seg + 1)])
        for j in range(seg):
            a_ = ring * (seg + 1) + j
            extra_f.append((ci, a_, a_ + 1) if ring else (ci, a_ + 1, a_))
    if extra_v:
        verts = np.vstack([verts, np.array(extra_v)])
        uvs = np.vstack([uvs, np.array(extra_uv)])
        faces = faces + extra_f
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UV')
    loop_v = np.array([l.vertex_index for l in me.loops])
    uvl.data.foreach_set('uv', uvs[loop_v].ravel())
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col = np.zeros((n, seg + 1, 4), np.float32)
    col[..., 3] = 0                                              # C2 r15: alpha = hood-edge factor (scale_shader compresses rows by it); 0 everywhere but the cobra hood
    NEXTRA = len(extra_v)
    if paint is not None:
        # paint(ctx) -> (R, G, B) arrays (n, seg+1): R pale belly / hood front, G bronze (hood rim + head scutes), B spectacle marking
        ch = paint({'A': A, 'B': B, 'th': th, 's': s, 'nrm': nrm_t, 'V': V})
        col[..., 0], col[..., 1], col[..., 2] = ch[:3]
        if len(ch) > 3:
            col[..., 3] = ch[3]
    elif pale is not None:
        # pale(f, nx, ny, nz) -> 0..1 ; normal approx from ring geometry
        col[..., 0] = pale(s / s[-1], nrm_t)
    flat = np.concatenate([col.reshape(-1, 4), np.tile(np.array([[0, 0, 0, 1]], np.float32), (NEXTRA, 1))]) if NEXTRA else col.reshape(-1, 4)
    ca.data.foreach_set('color', flat.reshape(-1))
    me.shade_smooth()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    # end caps (closed with a fan to the ring centre)
    return ob, (T, Bw, Bd, s, V, nrm_t)


# ================================================================================================ the scene
LOG('building scene')
# ---- dais: three tiers of cracked basalt + front stairs
TIERS = [  # (size x,y,z), centre y, top z
    ((19.0, 11.4, 0.80), 0.8, 0.0),
    ((16.0, 9.6, 0.80), 1.4, 0.8),
    ((13.2, 7.8, 0.80), 2.0, 1.6),
]
for i, (sz, cy, z0) in enumerate(TIERS):
    box(f'tier{i}', (0, cy, z0 + sz[2] / 2 - 0.3 * 0), sz, M['stone'] if i % 2 == 0 else M['stone_b'], step=0.62, bevel=0.09, chip=0.07, seed=i + 1, fn=2.4)
DAIS_TOP = 2.4
# bottom plinth ring of broken blocks in front (rubble steps)
for i in range(9):
    x = -8.2 + i * 2.05 + rs.uniform(-0.2, 0.2)
    box(f'step{i}', (x, -5.0 + rs.uniform(-0.1, 0.15), 0.35), (1.9 + rs.uniform(-0.3, 0.2), 0.9, 0.7 + rs.uniform(-0.12, 0.1)), M['stone'], bevel=0.08, chip=0.07, seed=20 + i,
        rot=(0, 0, rs.uniform(-0.05, 0.05)))

# ---- crimson runner down the stairs (follows tier tops/risers, ragged)
runner = [(-5.4, 0.0), (-5.4 + 0.0, 0.0)]
tx0, tx1 = -1.75, 1.75
steps = [(-5.15, 0.0, 0.8), (-4.0, 0.8, 1.6), (-2.7, 1.6, 2.4)]  # (y edge of riser, z bottom, z top)
for k, (yy, z0, z1) in enumerate(steps):
    bm = bmesh.new()
    nx, nz = 14, 5
    ytop_to = yy + (1.25 if k < 2 else 1.3)
    # riser
    vs = []
    for i in range(nx + 1):
        row = []
        for j in range(nz + 1):
            x = tx0 + (tx1 - tx0) * i / nx
            z = z0 + (z1 - z0) * j / nz
            row.append(bm.verts.new((x, yy - 0.08, z + 0.06)))
        vs.append(row)
    for i in range(nx):
        for j in range(nz):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    # tread
    ny = 6
    vs2 = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            x = tx0 + (tx1 - tx0) * i / nx
            y = yy - 0.08 + (ytop_to - yy + 0.08) * j / ny
            row.append(bm.verts.new((x, y, z1 + 0.06)))
        vs2.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vs2[i][j], vs2[i + 1][j], vs2[i + 1][j + 1], vs2[i][j + 1]))
    for v in bm.verts:
        v.co.z += 0.05 * mnoise.noise(Vector((v.co.x * 2.2 + k * 4, v.co.y * 1.6, v.co.z * 2))) + 0.03 * math.sin(v.co.x * 7 + k)
        v.co.y += 0.05 * mnoise.noise(Vector((v.co.x * 1.5, 3 + v.co.z * 2, k)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj_from_bm(f'runner{k}', bm, M['cloth'])
# runner on the tier-3 tread running back to the seat
bm = bmesh.new()
nx, ny = 14, 8
vsr = [[bm.verts.new((tx0 + (tx1 - tx0) * i / nx, -2.7 - 0.08 + (2.6 + 0.08) * j / ny, 2.46 + 0.04 * mnoise.noise(Vector((i * .4, j * .5, 7))))) for j in range(ny + 1)] for i in range(nx + 1)]
for i in range(nx):
    for j in range(ny):
        bm.faces.new((vsr[i][j], vsr[i + 1][j], vsr[i + 1][j + 1], vsr[i][j + 1]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
obj_from_bm('runner_top', bm, M['cloth'])
# gold trim lines along the runner edges
for sx_ in (tx0 + 0.18, tx1 - 0.18):
    for k, (yy, z0, z1) in enumerate(steps):
        pass

# ---- the throne
CY = 3.6       # centre depth of throne body
seat = box('seat_base', (0, CY - 0.2, DAIS_TOP + 0.95), (5.6, 3.6, 1.9), M['obsidian'], step=0.5, bevel=0.1, chip=0.03, seed=40, fn=2.0)
box('seat_plinth', (0, CY - 0.2, DAIS_TOP + 0.12), (6.4, 4.3, 0.34), M['stone_b'], step=0.6, bevel=0.07, chip=0.05, seed=41)
# cushion (crimson with gold piping)
cushion = box('cushion', (0, CY - 0.1, DAIS_TOP + 2.02), (4.1, 2.9, 0.36), M['cloth'], step=0.35, bevel=0.14, chip=0.04, seed=3, fn=3)
for dy in (-1.46, 1.46):
    pass
# armrests
for sg in (-1, 1):
    box(f'arm{sg}', (sg * 3.0, CY - 0.2, DAIS_TOP + 2.5), (1.15, 3.6, 2.2), M['obsidian'], step=0.5, bevel=0.12, chip=0.03, seed=50 + sg)
    box(f'armcap{sg}', (sg * 3.0, CY - 0.2, DAIS_TOP + 3.72), (1.45, 3.9, 0.3), M['stone_b'], step=0.5, bevel=0.07, chip=0.04, seed=52 + sg)
    # armrest finial: ball on a collar
    lathe(f'fin{sg}', [(0.32, 0), (0.38, 0.1), (0.3, 0.2), (0.5, 0.45), (0.62, 0.75), (0.5, 1.05), (0.12, 1.28)], M['gold'], seg=24, center=(sg * 3.0, CY - 1.7, DAIS_TOP + 3.9))

# tall back: slab + ogive crown + spires
BACK_Y = CY + 1.9
back = box('back', (0, BACK_Y, DAIS_TOP + 5.2), (5.9, 1.0, 6.8), M['obsidian'], step=0.5, bevel=0.1, chip=0.03, seed=60, fn=1.8)
box('back_frame_l', (-2.95, BACK_Y - 0.18, DAIS_TOP + 5.3), (0.45, 1.15, 7.0), M['stone_b'], step=0.5, bevel=0.07, chip=0.05, seed=61)
box('back_frame_r', (2.95, BACK_Y - 0.18, DAIS_TOP + 5.3), (0.45, 1.15, 7.0), M['stone_b'], step=0.5, bevel=0.07, chip=0.05, seed=62)
box('back_panel', (0, BACK_Y - 0.55, DAIS_TOP + 5.0), (3.6, 0.3, 5.0), M['obsidian'], step=0.4, bevel=0.1, chip=0.03, seed=63)
box('back_cap', (0, BACK_Y - 0.05, DAIS_TOP + 8.75), (5.2, 1.0, 0.8), M['stone_b'], step=0.5, bevel=0.08, chip=0.05, seed=64)
BACK_TOP = DAIS_TOP + 9.15
# spires: central tall + two side + crockets
def spire(name, x, y, z, w, h, mat=None, sides=4, top=0.0):
    ob = lathe(name, [(w, 0), (w * 0.92, h * 0.55), (top, h)], mat or M['stone_b'], seg=sides, center=(x, y, z))
    ob.rotation_euler = (0, 0, math.pi / sides)
    ob.data.shade_flat()
    return ob


spire('sp_c', 0, BACK_Y - 0.05, BACK_TOP - 0.2, 0.62, 3.6, M['obsidian'])
spire('sp_l', -1.75, BACK_Y - 0.05, BACK_TOP - 0.3, 0.42, 2.2, M['obsidian'])
spire('sp_r', 1.75, BACK_Y - 0.05, BACK_TOP - 0.3, 0.42, 2.2, M['obsidian'])
spire('sp_ll', -2.95, BACK_Y - 0.15, BACK_TOP - 0.45, 0.34, 1.4, M['stone_b'])
spire('sp_rr', 2.95, BACK_Y - 0.15, BACK_TOP - 0.45, 0.34, 1.4, M['stone_b'])
for k in range(5):
    for sg in (-1, 1):
        zc = BACK_TOP + 0.3 + k * 0.62
        spire(f'crock{k}{sg}', sg * (0.42 - k * 0.03), BACK_Y - 0.4, zc, 0.12, 0.45, M['obsidian'], 3)
for sg in (-1, 1):
    for k in range(6):
        spire(f'cs{k}{sg}', sg * 2.95, BACK_Y - 0.75, DAIS_TOP + 2.7 + k * 1.15, 0.14, 0.5, M['stone_b'], 3)
# C2 r13 (board r12 "flat green line-art rings on the throne back"): the emissive knot rings and flutes are gone. The panel carries real relief
# instead - two tall sunk gothic fields with bevelled stone frames either side of the centre, the middle left clear for the mounted Copper Ax.
for sg in (-1, 1):
    box(f'fieldfr{sg}', (sg * 1.62, BACK_Y - 0.74, DAIS_TOP + 5.0), (0.62, 0.12, 4.5), M['stone_b'], step=0.45, bevel=0.06, chip=0.03, seed=70 + sg)
    box(f'fieldin{sg}', (sg * 1.62, BACK_Y - 0.80, DAIS_TOP + 5.0), (0.34, 0.10, 4.1), M['obsidian'], step=0.45, bevel=0.05, chip=0.02, seed=72 + sg)
# gold inlay bands across the panel
for zz in (2.9, 7.55):
    box(f'inlay{zz}', (0, BACK_Y - 0.72, DAIS_TOP + zz), (3.2, 0.08, 0.14), M['gold'], bevel=0.02, chip=0.0, step=0.6)

# ---- copper axe relic (C2 r11): the Heroes team's real hero weapon (public/assets/models/weapon_copperax.glb - copper cheeks, teal rune
# knotwork, brass bands) imported into the scene and laid across the seat, head up-right, broad cheek to the camera.
def axe():
    from mathutils import Matrix
    GLB = os.path.join(ROOT, 'public', 'assets', 'models', 'weapon_copperax.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    assert meshes, 'copper ax glb has no mesh'
    root = meshes[0]
    bpy.context.view_layer.update()
    edge_pt = None
    for o in new:
        if o.name.startswith('bit_edge'):
            edge_pt = o.matrix_world.translation.copy()
    # flatten the importer's axis conversion into the mesh so local axes == world axes of the imported pose
    for o in new:
        o.select_set(False)
    for o in new:
        if o is not root and o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    root.parent = None
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    me = root.data
    co = np.array([v.co[:] for v in me.vertices], np.float64)
    lo, hi = co.min(0), co.max(0)
    ext = hi - lo
    ax_h = int(np.argmax(ext))                                     # haft axis
    rest = [i for i in range(3) if i != ax_h]
    ax_e = rest[int(np.argmax(ext[rest]))]                         # blade-width axis
    ax_t = [i for i in rest if i != ax_e][0]                       # cheek thickness axis
    ctr = (lo + hi) / 2
    # sign of the haft axis: the head (heavier end) is on the side with more vertices spread along the edge axis
    wide = np.abs(co[:, ax_e] - ctr[ax_e]) > ext[ax_e] * 0.25
    h_pos = co[wide, ax_h].mean() - ctr[ax_h]
    sg_h = 1.0 if h_pos >= 0 else -1.0
    # sign of the edge axis: where the bit edge empty was, else toward the larger lobe
    if edge_pt is not None:
        sg_e = 1.0 if (edge_pt[ax_e] - ctr[ax_e]) >= 0 else -1.0
    else:
        sg_e = 1.0 if abs(co[:, ax_e].max() - ctr[ax_e]) >= abs(co[:, ax_e].min() - ctr[ax_e]) else -1.0
    LOG('axe glb ext', ext.round(3), 'axes h/e/t', ax_h, ax_e, ax_t, 'signs', sg_h, sg_e, 'tris', len(me.polygons))
    lh = Vector((0.0, 0.0, 0.0)); lh[ax_h] = sg_h
    le = Vector((0.0, 0.0, 0.0)); le[ax_e] = sg_e
    lt = lh.cross(le)
    # C2 r13 (board r12 "flat red/teal painted axe floating diagonally"): the relic now STANDS in the seat, pommel on the cushion, haft leaning back
    # against the panel (two iron straps hold it), broad cheek turned to the camera; the material is real copper (below), not the painted albedo.
    d = Vector((0.13, 0.17, 1.0)).normalized()                      # haft direction in the scene: up, leaning right and back onto the panel
    t0 = Vector((0.0, -1.0, 0.0))                                   # cheek normal wanted: toward the camera
    e = t0.cross(d).normalized()
    t = d.cross(e)
    Lm = Matrix((lh, le, lt)).transposed()                         # columns = local basis
    Wm = Matrix((d, e, t)).transposed()
    R = Matrix.Rotation(math.radians(12.0), 3, d) @ Wm @ Lm.inverted()          # cheek turned ~12 deg about the haft toward the green brazier so the metal catches its light
    SC = 5.0
    pommel_l = Vector(ctr)
    pommel_l[ax_h] = lo[ax_h] if sg_h > 0 else hi[ax_h]
    a_pt = Vector((-0.55, CY + 0.15, DAIS_TOP + 2.34))              # pommel stands on the cushion top (DAIS_TOP + 2.2)
    global AXE_D, AXE_P, AXE_OBJ
    AXE_OBJ = root
    AXE_D, AXE_P = d.copy(), a_pt.copy()
    root.rotation_mode = 'XYZ'                                       # the glTF importer leaves quaternion mode
    root.rotation_euler = R.to_euler()
    root.scale = (SC, SC, SC)
    root.location = a_pt - (R @ pommel_l) * SC
    bpy.context.view_layer.update()
    # C2 r13: REAL COPPER. The painted albedo only drives the tone (so the bit keeps its worn / polished variation and the verdigris in the
    # engraving); metallic is 1 everywhere with a low, ORM-driven roughness, a pale copper highlight tone and a deep red-brown shadow tone, and
    # only the rune knotwork (the emissive map) glows - the cheeks no longer glow orange like paint.
    for slot in root.material_slots:
        mt_ = slot.material
        nt_ = mt_.node_tree
        tex_ = {}
        for n_ in nt_.nodes:
            if n_.type == 'TEX_IMAGE' and n_.image:
                for key in ('albedo', 'emissive', 'normal', 'orm'):
                    if key in n_.image.name.lower():
                        tex_[key] = n_
        if 'albedo' not in tex_:
            continue
        out_ = [n for n in nt_.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        for n_ in list(nt_.nodes):
            if n_.type == 'BSDF_PRINCIPLED':
                nt_.nodes.remove(n_)
        alb = tex_['albedo'].outputs['Color']
        bw = N(nt_, 'ShaderNodeRGBToBW')
        nt_.links.new(alb, bw.inputs['Color'])
        sp_ = N(nt_, 'ShaderNodeSeparateColor')
        nt_.links.new(alb, sp_.inputs['Color'])
        # C2 r14 (board r13 "broad orange blades + bright cyan rune circles read as a flat graphic emblem / decals"): dimensional copper. The painted
        # teal / emissive rune map is now a CARVED recess (dark oxide floor, normal pushed in, only a dull ember glow deep inside), a cavity-AO node
        # darkens every crease to oxide, a convex-edge AO node + a bevelled shading normal put a polished copper highlight on every rim, and the tone
        # ramp is less saturated (oxide shadow -> mid copper -> pale polished edge) so the cheeks have a value range instead of one orange plane.
        teal = mathn(nt_, 'MULTIPLY', mathn(nt_, 'SUBTRACT', sp_.outputs['Blue'], sp_.outputs['Red'], clamp=True), 2.6, clamp=True)
        if 'emissive' in tex_:
            ebw = N(nt_, 'ShaderNodeRGBToBW')
            nt_.links.new(tex_['emissive'].outputs['Color'], ebw.inputs['Color'])
            rune = mathn(nt_, 'MAXIMUM', teal, mathn(nt_, 'MULTIPLY', ebw, 1.6, clamp=True), clamp=True)
        else:
            rune = teal
        aoc = N(nt_, 'ShaderNodeAmbientOcclusion'); aoc.inputs['Distance'].default_value = 0.30; aoc.samples = 10
        aoe = N(nt_, 'ShaderNodeAmbientOcclusion'); aoe.inputs['Distance'].default_value = 0.10; aoe.inside = True; aoe.samples = 10
        cav = ramp(nt_, [(0.25, (0.18, 0.18, 0.18, 1)), (0.85, (1, 1, 1, 1))])
        nt_.links.new(aoc.outputs['AO'], cav.inputs['Fac'])
        edgem = ramp(nt_, [(0.55, (0, 0, 0, 1)), (0.95, (1, 1, 1, 1))])
        nt_.links.new(aoe.outputs['AO'], edgem.inputs['Fac'])
        t0_ = mathn(nt_, 'MULTIPLY', bw, cav)
        t1_ = mathn(nt_, 'ADD', t0_, mathn(nt_, 'MULTIPLY', edgem, 0.34))
        t2_ = mathn(nt_, 'MULTIPLY', t1_, mathn(nt_, 'SUBTRACT', 1.0, mathn(nt_, 'MULTIPLY', rune, 0.82)))      # rune floor drops to oxide
        tone = ramp(nt_, [(0.02, (0.030, 0.012, 0.008, 1)), (0.20, (0.17, 0.062, 0.036, 1)), (0.42, (0.46, 0.19, 0.10, 1)), (0.70, (0.78, 0.40, 0.24, 1)), (0.95, (0.98, 0.68, 0.50, 1))])
        nt_.links.new(t2_.outputs[0], tone.inputs['Fac'])
        base = mix(nt_, mathn(nt_, 'MULTIPLY', rune, 0.30), tone, (0.020, 0.012, 0.010, 1))          # rune recess = dark oxide, not cyan / verdigris paint
        pb = principled(nt_, rough=0.3, metal=1.0, spec=0.6)
        nt_.links.new(base.outputs[2], pb.inputs['Base Color'])
        pb.inputs['Metallic'].default_value = 1.0
        rbase = mathn(nt_, 'ADD', 0.18, mathn(nt_, 'MULTIPLY', rune, 0.42))
        if 'orm' in tex_:
            osp = N(nt_, 'ShaderNodeSeparateColor')
            nt_.links.new(tex_['orm'].outputs['Color'], osp.inputs['Color'])
            rbase = mathn(nt_, 'ADD', rbase, mathn(nt_, 'MULTIPLY', osp.outputs['Green'], 0.40), clamp=True)
        nt_.links.new(rbase.outputs[0], pb.inputs['Roughness'])
        bev = N(nt_, 'ShaderNodeBevel'); bev.inputs['Radius'].default_value = 0.035; bev.samples = 8
        if 'normal' in tex_:
            nm_ = N(nt_, 'ShaderNodeNormalMap')
            nm_.inputs['Strength'].default_value = 1.6
            tex_['normal'].image.colorspace_settings.name = 'Non-Color'
            nt_.links.new(tex_['normal'].outputs['Color'], nm_.inputs['Color'])
            nt_.links.new(nm_.outputs['Normal'], bev.inputs['Normal'])
        bmp = N(nt_, 'ShaderNodeBump')                                                                  # runes sunk below the cheek surface
        bmp.inputs['Strength'].default_value = 1.0
        bmp.inputs['Distance'].default_value = 0.05
        bmp.invert = True
        nt_.links.new(rune.outputs[0], bmp.inputs['Height'])
        nt_.links.new(bev.outputs['Normal'], bmp.inputs['Normal'])
        nt_.links.new(bmp.outputs['Normal'], pb.inputs['Normal'])
        if 'emissive' in tex_:
            pb.inputs['Emission Color'].default_value = (1.0, 0.36, 0.10, 1)
            nt_.links.new(mathn(nt_, 'MULTIPLY', rune, 0.9).outputs[0], pb.inputs['Emission Strength'])      # dull ember glow only inside the recess
        nt_.links.new(pb.outputs[0], out_.inputs['Surface'])
    head_c = ctr.copy()
    head_c[ax_h] = ctr[ax_h] + sg_h * ext[ax_h] * 0.30
    head_world = root.matrix_world @ Vector(tuple(head_c))
    LOG('axe head at', tuple(round(x, 2) for x in head_world))
    return head_world


AXE_HEAD = axe()
# two iron straps pin the haft to the back panel (the relic is MOUNTED, not balanced): a collar round the haft + a stay running back to the panel face
for k_, lz_ in enumerate((3.7, 5.5)):
    pt_ = AXE_P + AXE_D * (lz_ / AXE_D.z)
    box(f'strap{k_}', (pt_.x, pt_.y, pt_.z), (0.46, 0.34, 0.20), M['iron'], rot=(0, 0, 0), step=0.5, bevel=0.05, chip=0.0, seed=80 + k_)
    box(f'stay{k_}', (pt_.x, (pt_.y + 4.78) / 2, pt_.z), (0.14, abs(4.78 - pt_.y) + 0.1, 0.12), M['iron'], step=0.5, bevel=0.03, chip=0.0, seed=84 + k_)
    box(f'plate{k_}', (pt_.x, 4.74, pt_.z), (0.62, 0.10, 0.42), M['iron'], step=0.5, bevel=0.04, chip=0.0, seed=88 + k_)

def flame_sheet(name, base, H, W, yaw, lean, seed, mat, nu=10, nv=26):
    """One teardrop tongue as a gently cupped, S-curved sheet standing on `base`, turned by `yaw` about the vertical (0 = broad face to the camera)."""
    r_ = np.random.RandomState(seed)
    ph = r_.uniform(0, 6.28)
    xs = np.linspace(-1, 1, nu + 1)[:, None]
    v = np.linspace(0, 1, nv + 1)[None, :]
    w = W * (0.45 + 0.55 * np.sin(np.pi * np.minimum(1.0, v * 1.5 + 0.05))) * (1 - v) ** 0.5
    cx = lean * H * v ** 2 + 0.10 * H * np.sin(v * 5.3 + ph) * v
    cy = 0.16 * H * np.sin(v * 3.1 + ph * 0.7) * v
    X = cx + xs * w
    Yd = cy + 0.22 * W * xs ** 2 * (1 - v)                        # cup toward the viewer
    Z = v * H + 0.0 * xs
    Xr = X * math.cos(yaw) - Yd * math.sin(yaw)
    Yr = X * math.sin(yaw) + Yd * math.cos(yaw)
    P3 = np.stack([Xr + base[0], Yr + base[1], Z + base[2]], -1)   # (nu+1, nv+1, 3)
    verts = P3.reshape(-1, 3)
    faces = [(i * (nv + 1) + j, (i + 1) * (nv + 1) + j, (i + 1) * (nv + 1) + j + 1, i * (nv + 1) + j + 1) for i in range(nu) for j in range(nv)]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(q) for q in verts], [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UV')
    U = np.broadcast_to((xs + 1) / 2, (nu + 1, nv + 1)).reshape(-1)
    Vv = np.broadcast_to(v, (nu + 1, nv + 1)).reshape(-1)
    uvs = np.stack([U, Vv], 1)
    loop_v = np.array([l.vertex_index for l in me.loops])
    uvl.data.foreach_set('uv', uvs[loop_v].ravel())
    me.shade_smooth()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.visible_shadow = False
    return ob


# ---- braziers (stone pedestal, bowl, green witchfire)
BR = [(-6.6, -1.4), (6.6, -1.4)]
for k, (bx, by) in enumerate(BR):
    z0 = 1.6 if abs(bx) < 7 else 0.8
    prof = [(1.0, 0.0), (1.05, 0.25), (0.78, 0.45), (0.62, 0.9), (0.55, 1.5), (0.7, 1.7), (0.58, 1.9), (0.9, 2.2), (1.35, 2.7), (1.45, 2.95), (1.28, 2.95), (1.18, 2.7), (0.7, 2.45)]
    br = lathe(f'brazier{k}', prof, M['stone'], seg=36, center=(bx, by, DAIS_TOP - 1.4 + 0.0), noise_amp=0.05, seed=k)
    # iron bands
    for zz in (1.05, 2.2):
        lathe(f'band{k}{zz}', [(0.66 if zz < 2 else 0.95, 0), (0.7 if zz < 2 else 1.0, 0.08)], M['iron'], seg=36, center=(bx, by, DAIS_TOP - 1.4 + zz))
    # embers heap
    rock(f'embers{k}', (bx, by, DAIS_TOP - 1.4 + 2.78), 0.95, M['ember'], (1, 1, 0.35), seed=k + 3, amp=0.3)
    # witchfire (C2 r11): layered, camera-facing-ish translucent tongue sheets at different yaws / radial offsets / heights (real depth: the
    # coils and bowl rim pass in front of / behind them, they light the stone), a hot pale core and two thin wisps - not flat painted cards
    fr_ = np.random.RandomState(100 + k)
    zf = DAIS_TOP - 1.4 + 2.85
    YAWS = [-76, -58, -40, -24, -9, 6, 20, 36, 52, 70, 100, -104, -88, 84]
    for t, yaw in enumerate(YAWS):
        H_ = fr_.uniform(1.8, 4.2) * (1.15 if t == 5 else 1.0)
        W_ = fr_.uniform(0.42, 0.95)
        ang = fr_.uniform(0, 6.283)
        rad_ = fr_.uniform(0.0, 0.62)
        flame_sheet(f'flame{k}_{t}', (bx + rad_ * math.cos(ang), by + rad_ * math.sin(ang), zf), H_, W_, math.radians(yaw + fr_.uniform(-8, 8)),
                    fr_.uniform(-0.45, 0.45), 40 * k + t, M['flame_sheet'])
    for t, yaw in enumerate([-30, 8, 40]):
        flame_sheet(f'flamehot{k}_{t}', (bx + fr_.uniform(-.2, .2), by + fr_.uniform(-.2, .2), zf - 0.05), fr_.uniform(1.0, 1.7), fr_.uniform(0.38, 0.55),
                    math.radians(yaw), fr_.uniform(-0.2, 0.2), 90 + 10 * k + t, M['flame_hot'])
    pb_ = bmesh.new()                                   # r15: ember pool - the flames stand IN a hot bed instead of on a cut line
    bmesh.ops.create_grid(pb_, x_segments=2, y_segments=2, size=1.0)
    po_ = obj_from_bm(f'flamepool{k}', pb_, M['flame_pool'])
    po_.location = (bx, by, zf - 0.02)
    po_.scale = (1.15, 1.15, 1.0)
    po_.visible_shadow = False
    vb = bmesh.new()
    bmesh.ops.create_uvsphere(vb, u_segments=24, v_segments=14, radius=1.0)
    vo = obj_from_bm(f'firevol{k}', vb, M['flame_vol'])
    vo.location = (bx, by, zf + 1.45)
    vo.scale = (1.15, 1.15, 1.9)
    vo.visible_shadow = False
    ln_ = bpy.data.lights.new(f'green{k}', 'POINT')
    ln_.color = (0.42, 1.0, 0.28)
    ln_.energy = 1000.0
    ln_.shadow_soft_size = 0.8
    lo = link(bpy.data.objects.new(f'green{k}', ln_))
    lo.location = (bx, by - 0.2, DAIS_TOP - 1.4 + 4.0)

# ---- cobras
FR = 1.0
PSI = math.radians(24)
HEADS = {}


def smooth01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def basis_obj(ob, ex, ez, scale):
    """Orient an object so local X -> ex (projected perpendicular to ez), local Z -> ez, and scale it (sx, sy, sz)."""
    from mathutils import Matrix
    ez = Vector(ez).normalized()
    ex = Vector(ex) - ez * Vector(ex).dot(ez)
    ex.normalize()
    ey = ez.cross(ex)
    M3 = Matrix((ex, ey, ez)).transposed()
    ob.rotation_euler = M3.to_euler()
    ob.scale = scale
    return ob


def ellipsoid(name, center, ex, ez, radii, mat, u=16, v=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    ob = obj_from_bm(name, bm, mat)
    ob.location = tuple(center)
    return basis_obj(ob, ex, ez, radii)


def cobra(sg, seed, name):
    """One colossal cobra, mirrored by sg (+1 right / -1 left): tail climbs the stairs, coils twice round the dais corner, trunk rises
    along the back's flank, a broad RIBBED HOOD flares behind the head (C2 r11), and a sculpted skull - brow ridges, deep eye sockets with a
    glowing iris, nostril pits, temple glands, a lined mouth with palate ridges, teeth, curved fangs on gum boots, a thick forked tongue."""
    HS = 1.20                                  # head scale (r12: smaller beside a much broader hood so the flare reads)
    r_ = np.random.RandomState(seed)
    cx, cy = 5.1, CY - 0.3
    pts = []
    # tail: lies on the plinth, then up and onto the dais
    pts += [(sg * 9.0, -4.9, 0.95), (sg * 8.0, -4.6, 1.15), (sg * 7.0, -4.0, 1.25), (sg * 6.6, -3.2, 2.2), (sg * 6.9, -2.4, 2.95)]
    # helix coils round (cx, cy)
    th0 = -0.35 * math.pi
    turns = 1.95
    nh = 40
    for i in range(1, nh + 1):
        t = i / nh
        th = th0 + t * turns * 2 * math.pi * 1.0
        R = 2.35 - 0.55 * t + 0.12 * math.sin(t * 17)
        z = 3.1 + t * 3.55 + 0.1 * math.sin(t * 11)
        pts.append((sg * (cx + R * math.cos(th * (1))), cy + R * math.sin(th) * 0.9, z))
    # trunk up the flank of the backrest
    pts += [(sg * 4.25, BACK_Y - 1.2, 7.3), (sg * 4.05, BACK_Y - 1.5, 8.6), (sg * 3.95, BACK_Y - 1.7, 9.9), (sg * 3.95, BACK_Y - 1.8, 11.2),
            (sg * 3.95, BACK_Y - 1.7, 12.5)]
    P = catmull(pts, 12)
    top = P[-1]
    # r12: the head used to hang off the hood's outer corner (x +1.85) and rise above its crown; now the neck bends FORWARD and DOWN so the skull sits in front
    # of the hood's upper centre with the hood framing it on both sides and rising behind (the sculpt reference's front / three-quarter view)
    P = np.vstack([P, catmull([top, top + np.array([sg * 0.10, -0.30, 0.30]), top + np.array([sg * 0.55, -1.10, -0.45]) * HS, top + np.array([sg * 1.25, -2.20, -1.45]) * HS], 10)[1:]])
    n = len(P)
    seglen = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seglen)])
    S_total = s[-1]
    s_top = s[len(catmull(pts, 12)) - 1]
    s_hood0 = s_top - 5.7
    s_hood1 = s_top - 0.70
    HOOD_W = 2.9
    A = np.zeros(n)
    Bd = np.zeros(n)
    for i in range(n):
        si = s[i]
        u = si / (s_top)
        r = 0.30 + 0.48 * np.clip(u / 0.2, 0, 1) ** 0.7
        r *= 1.0 + 0.04 * math.sin(si * 3.1)
        r = r * (1 - 0.30 * np.clip((u - 0.72) / 0.28, 0, 1))
        a_, b_ = r, r
        if si > s_hood0 - 0.01:
            # hood: a broad shield that opens out from the trunk (rise), with a rounded crown; depth stays thin (a membrane, not a bulge)
            q = np.clip((si - s_hood0) / (s_hood1 - s_hood0), 0, 1.2)
            rise = np.clip(q / 0.80, 0, 1)
            rise = rise ** 1.25 * (3 - 2 * rise) * 0.55 + rise * 0.45
            fall = math.sqrt(max(0.0, 1 - ((max(q, 0.80) - 0.80) / 0.20) ** 2)) if q < 1.0 else 0.0
            flare = rise * (fall if q > 0.80 else 1.0)
            a_ = r + (HOOD_W - r) * flare
            b_ = r * (1 - 0.62 * flare) + 0.10
        if si > s_top - 0.05:
            # head: wedge, width tapering to the snout, height flattening
            h_ = np.clip((si - s_top + 0.05) / (S_total - s_top + 0.05), 0, 1)
            a_ = 1.30 * HS * (1 - 0.60 * h_ ** 0.8) * (0.7 + 0.3 * min(1, h_ * 8))
            b_ = 0.80 * HS * (1 - 0.55 * h_ ** 0.8) * (0.6 + 0.4 * min(1, h_ * 8))
        if si > S_total - 0.55:                       # round the snout off with an elliptical taper (a flat cap fan swirls its UVs)
            tq = (si - (S_total - 0.55)) / 0.55
            k_ = max(0.05, math.sqrt(max(0.0, 1 - tq * tq)))
            a_ *= k_
            b_ *= k_
        A[i] = a_
        Bd[i] = b_

    def pale(ff, nrm):
        # hood front + throat/belly pale: normals facing the camera (-y) inside the hood, down on the head
        front = np.clip((-nrm[..., 1] - 0.20) / 0.6, 0, 1)
        sc_ = (s / 1.0)[:, None]
        inhood = np.clip((sc_ - (s_hood0 + 0.9)) / 1.4, 0, 1) * np.clip((s_top + 0.15 - sc_) / 0.7, 0, 1)
        thr = np.clip((-nrm[..., 2] - 0.2) / 0.5, 0, 1) * np.clip((sc_ - s_top + 0.2) / 0.5, 0, 1)
        band = 0.55 + 0.45 * np.sin(sc_ * 15.0) ** 2
        return np.clip(front * inhood * band * 0.0 + thr, 0, 1)      # r12: the hood face is DARK skin (the spectacle + bronze rim carry the pale), only the throat is pale

    def paint(c):
        """C2 r12 (board: 'no hood flare'): the hood now carries a big pale SPECTACLE marking (two teardrop rings, dark inside) and a bronze rim band
        along its side edges, the skull top is bronze-scuted - the cobra silhouette and hood read at title size, like the sculpt reference."""
        nrm = c['nrm']
        R = pale(None, nrm)
        sc_ = c['s'][:, None]
        ct, st = np.cos(c['th'])[None, :], np.sin(c['th'])[None, :]
        Aa, Bb = c['A'][:, None], c['B'][:, None]
        across = Aa * ct / HOOD_W
        q = np.clip((sc_ - s_hood0) / (s_hood1 - s_hood0), 0, 1)
        inhood = smooth01((sc_ - (s_hood0 + 0.5)) / 0.9) * smooth01((s_top + 0.05 - sc_) / 0.5)
        facing = smooth01((-nrm[..., 1] - 0.15) / 0.45)
        spect = np.zeros_like(R)
        for sx in (-1, 1):
            du = (across - sx * 0.60) / 0.27
            dv = (q - 0.55 + 0.10 * du ** 2) / 0.30                         # teardrop-ish: the ring's ends droop toward the centre line
            rr = np.sqrt(du ** 2 + dv ** 2)
            ring = smooth01((rr - 0.42) / 0.36) * (1 - smooth01((rr - 0.92) / 0.30)) * 0.62      # r13: soft, partial mix (a thin hard ring of parchment scales printed as a halftone)
            spect = np.maximum(spect, ring)
        spect = spect * inhood * facing
        nx_, ny_ = ct / Aa, st / Bb
        side = np.abs(nx_) / np.sqrt(nx_ ** 2 + ny_ ** 2 + 1e-9)
        rim = smooth01((side - 0.62) / 0.26) * smooth01((sc_ - (s_hood0 + 0.1)) / 0.6) * smooth01((s_top + 0.3 - sc_) / 0.4)
        crown = smooth01((q - 0.86) / 0.12) * inhood * 0.0
        hd = smooth01((sc_ - s_top + 0.05) / 0.5) * smooth01((-nrm[..., 2] * -1 - 0.2) / 0.5)   # skull top (normal up)
        bronze = np.clip(np.maximum(rim * 0.95, hd * 0.8) + crown, 0, 1) * (1 - spect)
        Vv_ = c['V']
        sel_ = spect > 0.5
        LOG('spectCount', int(sel_.sum()), 'centroid', Vv_[sel_].mean(0).round(2) if sel_.any() else None, 'bronzeCount', int((bronze > 0.5).sum()), 'Rmax', float(R.max()))
        hm_ = (sc_[:, 0] > s_hood0 + 1.0) & (sc_[:, 0] < s_hood1)
        Vh = c['V'][hm_].reshape(-1, 3)
        LOG('hoodbox', name, Vh.min(0).round(2), Vh.max(0).round(2), 'P at hood0/mid/1', P[int(np.argmin(np.abs(s - s_hood0)))].round(2), P[int(np.argmin(np.abs(s - 0.5 * (s_hood0 + s_hood1))))].round(2), P[int(np.argmin(np.abs(s - s_hood1)))].round(2))
        LOG('paint', name, 'spect max', float(spect.max()), 'bronze max', float(bronze.max()), 'hood s', round(float(s_hood0), 2), round(float(s_hood1), 2), 's_top', round(float(s_top), 2), 'A max', round(float(c['A'].max()), 2))
        edge_e = smooth01((np.abs(across) - 0.30) / 0.62) * smooth01((s_top + 0.05 - sc_) / 1.1) * smooth01((sc_ - s_hood0) / 0.5)
        return R, bronze, spect, np.broadcast_to(edge_e, R.shape)

    # head frame (known from the path before the tube is built)
    i0 = int(np.searchsorted(s, s_top + 0.15))
    head_p0 = P[i0]
    head_dir = P[-1] - P[i0]
    head_dir = head_dir / np.linalg.norm(head_dir)
    side = np.cross(head_dir, np.array([0.0, 0.0, 1.0]))
    side /= np.linalg.norm(side)
    up = np.cross(side, head_dir)
    up /= np.linalg.norm(up)
    s_h0 = s[i0]
    ANCH = {}
    HEADS[sg] = head_p0 + head_dir * 1.3 * HS

    def head_offsets(V, s_arr, Nrm):
        V = V.astype(np.float64).copy()
        # ---- hood ribs: transverse rounded ribs across the hood faces + a scalloped, thickened rim
        inh = smooth01((s_arr - (s_hood0 + 0.7)) / 1.1) * smooth01((s_top - 0.05 - s_arr) / 0.8)
        wv = np.array([math.cos(PSI), sg * math.sin(PSI), 0.0])
        xw = (V - P[:, None, :]) @ wv                                             # across-the-hood coordinate
        shh = (s_arr - (s_hood0 - 1.4))[:, None]                                  # distance up from a fan origin below the hood's base
        phi = np.arctan2(xw, shh)
        rib = (0.5 + 0.5 * np.cos(phi * 19.0 + 1.3 * np.sin(s_arr[:, None] * 0.9) + 0.9 * np.sin(phi * 7.0 + 2.0))) ** 1.6          # r13: fewer, irregular radiating ribs (46 evenly spaced ribs beat against the scale lattice into a halftone)
        face = np.abs(Nrm[..., 1])
        V += Nrm * (0.13 * rib * inh[:, None] * face)[..., None]

        # ---- skull sculpt (world-space anisotropic Gaussians placed on the undisplaced surface)
        def anchor(s_t, sx, wside, wup):
            i = int(np.argmin(np.abs(s_arr - s_t)))
            sc = sx * (Nrm[i] @ side) * wside + (Nrm[i] @ up) * wup
            j = int(np.argmax(sc))
            return V[i, j].copy(), Nrm[i, j].copy()

        def blob(c, su, sp, amp):
            su, sp, amp = su * HS, sp * HS, amp * HS
            d = V - c
            du = d @ head_dir
            dp2 = np.maximum((d * d).sum(-1) - du ** 2, 0.0)
            return amp * np.exp(-0.5 * (du ** 2 / su ** 2 + dp2 / sp ** 2))

        disp = np.zeros(V.shape[:2])
        for sx in (-1, 1):
            a, na = anchor(s_h0 + 0.80 * HS, sx, 0.8, 0.65)
            ANCH[sx] = (a.copy(), na.copy())
            disp += blob(a, 0.33, 0.25, -0.36)                                         # eye socket (r15: deeper)
            disp += blob(a + (up * 0.27 + head_dir * 0.10) * HS, 0.66, 0.17, 0.52)           # brow ridge, slanting forward (r15: heavier)
            disp += blob(a + (up * 0.12 + head_dir * 0.55) * HS, 0.30, 0.10, 0.07)           # lower canthal ridge in front of the eye
            disp += blob(a - (head_dir * 0.70 + up * 0.05) * HS, 0.44, 0.34, 0.12)           # temple (venom gland) bulge
            an, nn = anchor(S_total - 0.42 * HS, sx, 0.9, 0.6)
            ANCH[('nose', sx)] = (an.copy(), nn.copy())
            disp += blob(an, 0.07, 0.065, -0.07)                                        # nostril pit
            disp += blob(an + up * 0.1 * HS, 0.20, 0.15, 0.05)                              # raised nasal ridge around it
        ac, nc = anchor(s_h0 + 1.0 * HS, 1, 0.0, 1.0)
        disp += blob(ac, 0.75, 0.15, 0.13)                                             # midline crest
        disp += blob(ac + head_dir * 0.25 * HS, 0.95, 0.60, 0.17)                      # r15: skull cap (a domed crown between the brows)
        disp += blob(ac + head_dir * 1.35 * HS - up * 0.05, 0.55, 0.30, 0.09)          # r15: snout bridge
        disp += blob(ac - head_dir * 0.45 * HS, 0.30, 0.45, 0.06)                           # occipital plate
        wu = smooth01(((V - head_p0) @ head_dir + 0.25) / 0.6)
        V += Nrm * (disp * wu)[..., None]
        return V

    ob, fr = sweep(name, P, A, Bd, M['scales'], seg=96, scale_fn=lambda s_: 1.25 + 0.30 * smooth01((s_ - (s_hood0 - 0.8)) / 1.2) - 0.80 * smooth01((s_ - (s_top - 0.1)) / 0.9), wref=(math.cos(PSI), sg * math.sin(PSI), 0), wref_from=(s_top - 5.5) / S_total, pale=pale,
                   offset_fn=head_offsets, paint=paint)
    T, Bw, Bdv, s_, Vf, Nf = fr
    # C2 r15: pre-subdivide (SIMPLE: only density, no smoothing) so the material's scale displacement has vertices to move; and tell the shader where the
    # hood's first scale row lies (rows compress toward the hood edge about it).
    smd = ob.modifiers.new('dens', 'SUBSURF')
    smd.subdivision_type = 'SIMPLE'
    smd.levels = 0
    smd.render_levels = 2 if not FAST else 1
    _mult = 1.25 + 0.30 * smooth01((s_ - (s_hood0 - 0.8)) / 1.2) - 0.80 * smooth01((s_ - (s_top - 0.1)) / 0.9)
    _vv = np.cumsum(np.concatenate([[0.0], np.diff(s_)]) / (0.15 * _mult))
    SD['yh0'].outputs[0].default_value = float(_vv[int(np.argmin(np.abs(s_ - s_hood0)))])
    # ---- eyes: a glowing iris nested in each socket + a faint green point light so the socket walls and brow glow with falloff
    for sx in (-1, 1):
        a, na = ANCH[sx]
        ctr = a - na * 0.20 * HS                     # r13: seated deep - the brow and lids overhang it and the socket walls take the glow
        ellipsoid(name + f'_eye{sx}', ctr, head_dir, na, (0.21 * HS, 0.17 * HS, 0.12 * HS), M['eye'], u=24, v=14)
        lns = ellipsoid(name + f'_lens{sx}', ctr + na * 0.02 * HS, head_dir, na, (0.225 * HS, 0.185 * HS, 0.150 * HS), M['lens'], u=28, v=18)
        lns.visible_shadow = False
        ln_e = bpy.data.lights.new(name + f'_eyelight{sx}', 'POINT')
        ln_e.color = (0.45, 1.0, 0.15)
        ln_e.energy = 34.0
        ln_e.shadow_soft_size = 0.05
        lo_e = link(bpy.data.objects.new(name + f'_eyelight{sx}', ln_e))
        lo_e.location = tuple(a - na * 0.02 * HS)
    # ---- jaws: lower jaw swept from the head base, opened ~40 deg
    jaw_len = 2.15 * HS
    d_open = head_dir * math.cos(math.radians(40)) - up * math.sin(math.radians(40))
    jp = [head_p0 - up * 0.18 + head_dir * 0.1, head_p0 - up * 0.30 + head_dir * 0.5 + d_open * 0.35, head_p0 + d_open * jaw_len - up * 0.3]
    JP = catmull(jp, 14)
    ja = np.linspace(0.90 * HS, 0.28 * HS, len(JP))
    jb = np.linspace(0.36 * HS, 0.13 * HS, len(JP))
    jaw, _ = sweep(name + '_jaw', JP, ja, jb, M['scales'], seg=24, wref=tuple(side), wref_from=0.0)
    jmd = jaw.modifiers.new('dens', 'SUBSURF')
    jmd.subdivision_type = 'SIMPLE'
    jmd.levels = 0
    jmd.render_levels = 2
    # mouth lining: the cavity between the jaws (dark wet crimson with palate ridges, black throat) + an upper palate dome under the skull
    mid = head_p0 + head_dir * 1.05 * HS - up * 0.34 * HS
    ellipsoid(name + '_mouth', mid, side, head_dir, (0.62 * HS, 0.45 * HS, 1.25 * HS), M['mouth'], u=24, v=16)
    ellipsoid(name + '_palate', head_p0 + head_dir * 1.15 * HS - up * 0.43 * HS, side, up, (0.50 * HS, 1.15 * HS, 0.12 * HS), M['mouth'], u=20, v=10)
    # teeth: two rows of recurved cones rooted in RIDGED GUM LINES (a swept ridge tube along the upper lip and along each side of the lower jaw)
    def tooth(nm, base, dirn, ln, rad):
        pts_ = [base, base + dirn * ln * 0.5 + np.cross(dirn, side) * 0.0, base + dirn * ln]
        pts_[1] = base + dirn * ln * 0.55 + head_dir * ln * 0.10
        pts_[2] = base + dirn * ln * 0.98 + head_dir * ln * 0.30
        Q = catmull(pts_, 4)
        rr = np.linspace(rad, 0.004, len(Q)) ** 1.0
        sweep(nm, Q, rr, rr, M['fang'], seg=7, pale=lambda ff, nrm: np.tile(np.linspace(0, 1, len(Q))[:, None], (1, 8))[:len(Q)])

    def gum_line(nm, pts_, r0, r1):
        Q = catmull(pts_, 6)
        rr = np.linspace(r0, r1, len(Q)) * (1 + 0.28 * np.sin(np.arange(len(Q)) * 2.1))          # a scalloped ridge: a bump per tooth socket
        sweep(nm, Q, rr, rr * 0.8, M['mouth'], seg=10, pale=lambda ff, nrm: np.zeros((len(Q), 11)))
    for sx in (-1, 1):
        up_pts = []
        for ti, uu in enumerate(np.linspace(0.70, 2.15, 7) * HS):
            ii = int(np.argmin(np.abs(s_ - (s_h0 + uu))))
            sc = sx * (Nf[ii] @ side) * 0.60 - (Nf[ii] @ up) * 1.0
            jj = int(np.argmax(sc))
            up_pts.append(Vf[ii, jj] - up * 0.015)
            tooth(name + f'_tu{sx}{ti}', Vf[ii, jj] - up * 0.03, -up * 1.0 + side * sx * 0.05, (0.20 - 0.018 * ti) * HS, 0.050 * HS)
        gum_line(name + f'_gumu{sx}', up_pts, 0.085 * HS, 0.05 * HS)
        lo_pts = []
        for ti, kk in enumerate(np.linspace(0.16, 0.82, 7)):
            ii = int(kk * (len(JP) - 1))
            lo_pts.append(JP[ii] + up * jb[ii] * 0.50 + side * sx * ja[ii] * 0.80)
            tooth(name + f'_tl{sx}{ti}', lo_pts[-1], up * 0.9, (0.19 - 0.018 * ti) * HS, 0.048 * HS)
        gum_line(name + f'_guml{sx}', lo_pts, 0.08 * HS, 0.045 * HS)
    # fangs: long curved cones rooted in swollen gum boots on the upper jaw
    for sx in (-1, 1):
        ii = int(np.argmin(np.abs(s_ - (s_h0 + 1.25 * HS))))
        sc = sx * (Nf[ii] @ side) * 0.45 - (Nf[ii] @ up) * 1.0
        jj = int(np.argmax(sc))
        root_ = Vf[ii, jj]
        fp = [root_ + up * 0.08, root_ - up * 0.34 * HS - head_dir * 0.03 * HS + side * sx * 0.03, root_ - up * 0.80 * HS + head_dir * 0.02 * HS + side * sx * 0.05 * HS, root_ - up * 1.22 * HS + head_dir * 0.30 * HS + side * sx * 0.03 * HS]
        FQ = catmull(fp, 8)
        fr_ = 0.012 + 0.175 * HS * (1 - np.linspace(0, 1, len(FQ))) ** 1.9              # r13: swelling root, fast taper, needle tip (was a straight cone)
        sweep(name + f'_fang{sx}', FQ, fr_, fr_ * 0.9, M['fang'], seg=12, pale=lambda ff, nrm: np.tile(np.linspace(0, 1, len(FQ))[:, None], (1, 13)))
        ellipsoid(name + f'_gum{sx}', root_ - up * 0.06, head_dir, -up, (0.25 * HS, 0.29 * HS, 0.20 * HS), M['mouth'], u=14, v=8)
    # forked tongue (r12): a TAPERED muscular tongue that leaves the mouth and curls DOWN and back in (was a horizontal red spike that read as a horn);
    # the two prongs hang apart, each ending in a fine tip
    tp = [head_p0 + (head_dir * 0.95 - up * 0.42) * HS, head_p0 + (head_dir * 1.70 - up * 0.64) * HS, head_p0 + (head_dir * 2.30 - up * 0.98) * HS,
          head_p0 + (head_dir * 2.50 - up * 1.55) * HS, head_p0 + (head_dir * 2.34 - up * 2.05) * HS]
    TP = catmull(tp, 9)
    tfr = np.linspace(0, 1, len(TP))
    tw = 0.05 + 0.19 * (1 - tfr) ** 0.85
    tt = 0.04 + 0.13 * (1 - tfr) ** 0.9
    sweep(name + '_tongue', TP, tw, tt, M['tongue'], seg=14, wref=tuple(side), wref_from=0.0, pale=lambda ff, nrm: np.tile(tfr[:, None], (1, 15)))
    for sx in (-1, 1):
        fk = [TP[-1], TP[-1] - up * 0.20 * HS + head_dir * 0.06 + side * sx * 0.10, TP[-1] - up * 0.42 * HS - head_dir * 0.04 + side * sx * 0.30, TP[-1] - up * 0.60 * HS - head_dir * 0.18 + side * sx * 0.55]
        FK = catmull(fk, 6)
        ffr = np.linspace(0.085, 0.012, len(FK))
        sweep(name + f'_fork{sx}', FK, ffr, ffr * 0.8, M['tongue'], seg=10, pale=lambda ff, nrm: np.ones((len(FK), 11)))
    return ob


cobra(1, 1, 'cobraR')
cobra(-1, 2, 'cobraL')

# ---- foreground rubble, broken pillars, shield + spear
for i in range(46):
    side_ = rs.choice([-1, 1])
    x = rs.uniform(-11.5, 11.5)
    y = rs.uniform(-6.6, -4.4) if rs.rand() < 0.6 else rs.uniform(-4.6, 5.0)
    if abs(x) < 8.8 and y > -4.4:
        x = side_ * rs.uniform(8.9, 11.5)
    z0 = 0.15 if y < -4.0 else 0.8
    rock(f'rub{i}', (x, y, z0 + 0.1), rs.uniform(0.25, 0.8), M['stone'] if rs.rand() < 0.7 else M['stone_b'], (1, rs.uniform(0.7, 1.1), rs.uniform(0.5, 0.85)), seed=i, amp=0.35)
for sg in (-1, 1):
    for k in range(7):                       # tumbled blocks where the old pillars stood
        rock(f'blk{sg}{k}', (sg * (8.6 + rs.uniform(-0.5, 1.2)), rs.uniform(-1.8, 2.8), 0.9 + rs.uniform(0, 0.6)), rs.uniform(0.5, 1.0), M['stone_b'], (1, rs.uniform(.8, 1.2), rs.uniform(.6, 1.0)), seed=90 + k + sg * 9, amp=0.28)

# ---- tattered war banners on iron poles flanking the dais (frame the throne, catch the sunset)
def banner(sg, x, y, h, seed, lean):
    r2 = np.random.RandomState(seed)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.12, radius2=0.09, depth=h)
    pole = obj_from_bm(f'pole{sg}', bm, M['iron'])
    pole.location = (x, y, 0.8 + h / 2 - 0.3)
    pole.rotation_euler = (0.0, lean, 0.0)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.16, radius2=0.0, depth=0.9)
    tip = obj_from_bm(f'ptip{sg}', bm, M['iron'])
    tip.location = (x + math.sin(lean) * h * 0.5, y, 0.8 + h - 0.3 + 0.35)
    tip.rotation_euler = (0.0, lean, 0.0)
    # crossbar + ring
    bar = box(f'pbar{sg}', (x + math.sin(lean) * h * 0.46, y, 0.8 + h - 1.0), (2.6, 0.12, 0.12), M['iron'], bevel=0.03, chip=0.0, step=1.3)
    # cloth: hangs from the bar, ragged hem + side rips, billows in a breeze
    bm = bmesh.new()
    nx, nz = 14, 22
    cw, ch = 2.1, 4.8
    vs = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            u = i / nx - 0.5
            v = j / nz
            hem = (0.35 * mnoise.noise(Vector((u * 5 + seed, v * 3, 1))) + 0.35) * ch * 0.35 * (v ** 3)     # ragged lower edge (pulled up in places)
            z = 0.8 + h - 1.1 - (v * ch - hem * (1 if abs(u) < .5 else 0))
            wob = 0.28 * math.sin(v * 5.0 + seed) * v + 0.4 * v * v * sg * 0.5 + 0.15 * mnoise.noise(Vector((u * 3, v * 4 + seed, 0)))
            row.append(bm.verts.new((x + math.sin(lean) * h * 0.46 + u * cw * (1 - 0.2 * v), y + wob + 0.05, z)))
        vs.append(row)
    for j in range(nz):
        for i in range(nx):
            # rip a few ragged holes in the lower half
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = obj_from_bm(f'cloth{sg}', bm, M['cloth'])
    sol = ob.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.03


banner(-1, -9.5, 4.2, 11.2, 5, 0.04)
banner(1, 9.4, 4.4, 10.2, 8, -0.05)

# ================================================================================================ lighting + camera
w = bpy.data.worlds.new('w')
w.use_nodes = True
sc.world = w
nt = w.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
wout = N(nt, 'ShaderNodeOutputWorld')
bg = N(nt, 'ShaderNodeBackground')
tcw = N(nt, 'ShaderNodeTexCoord')
sepw = N(nt, 'ShaderNodeSeparateXYZ')
nt.links.new(tcw.outputs['Generated'], sepw.inputs['Vector'])
zr = ramp(nt, [(0.30, (0.30, 0.10, 0.16, 1)), (0.50, (0.10, 0.04, 0.14, 1)), (0.75, (0.025, 0.012, 0.06, 1)), (1.0, (0.012, 0.008, 0.03, 1))])
nt.links.new(sepw.outputs['Z'], zr.inputs['Fac'])
dirv = N(nt, 'ShaderNodeVectorMath', operation='DOT_PRODUCT')
nt.links.new(tcw.outputs['Window'] if False else tcw.outputs['Generated'], dirv.inputs[0])
dirv.inputs[1].default_value = (-0.45, 0.9, 0.05)
sunr = ramp(nt, [(0.55, (0, 0, 0, 1)), (1.0, (1.0, 0.42, 0.12, 1))])
nt.links.new(dirv.outputs['Value'], sunr.inputs['Fac'])
adds = N(nt, 'ShaderNodeVectorMath', operation='ADD')
nt.links.new(zr.outputs[0], adds.inputs[0])
nt.links.new(sunr.outputs[0], adds.inputs[1])
nt.links.new(adds.outputs[0], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.45
nt.links.new(bg.outputs[0], wout.inputs['Surface'])

sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 9.0
sun.angle = 0.06
sun.color = (1.0, 0.50, 0.20)
so = link(bpy.data.objects.new('sun', sun))
tosun = Vector((-0.12, 0.93, 0.34)).normalized()
so.rotation_euler = (-tosun).to_track_quat('-Z', 'Y').to_euler()

fill = bpy.data.lights.new('fill', 'AREA')
fill.energy = 1100.0
fill.specular_factor = 0.4
fill.size = 18.0
fill.color = (0.55, 0.42, 1.0)
fo = link(bpy.data.objects.new('fill', fill))
fo.location = (6.0, -18.0, 12.0)
fo.rotation_euler = Vector((-6.0, 18.0, -12.0 + 6.0)).to_track_quat('-Z', 'Y').to_euler()

warm = bpy.data.lights.new('warm', 'SUN')          # raking sunset key from the camera's left: glints on scales, warm planes on the stone
warm.energy = 5.0
warm.angle = 0.30
warm.color = (1.0, 0.52, 0.24)
wo = link(bpy.data.objects.new('warm', warm))
wo.rotation_euler = (-Vector((-0.78, -0.42, 0.40)).normalized()).to_track_quat('-Z', 'Y').to_euler()

axl = bpy.data.lights.new('axeglow', 'POINT')
axl.energy = 800.0
axl.color = (1.0, 0.45, 0.14)
axl.shadow_soft_size = 0.4
ao_ = link(bpy.data.objects.new('axeglow', axl))
ao_.location = (AXE_HEAD.x, AXE_HEAD.y - 0.9, AXE_HEAD.z + 0.5)

# C2 r15 (board r14 "near-black green mass at 1x, cobras do not separate from the dark set"): a dedicated warm KEY spot per cobra, from the camera side above,
# confined to the hood + head by a narrow cone, so each hood face and skull has a lit top and a shadow side instead of one dark lump.
COB = bpy.data.collections.new('cobras')                  # light linking: the cobra keys light the cobras only (the panel / relic keep their own contrast)
sc.collection.children.link(COB)
for _o in list(bpy.data.objects):
    if _o.type == 'MESH' and _o.name.startswith(('cobraR', 'cobraL')):
        COB.objects.link(_o)
REL = bpy.data.collections.new('relic')
sc.collection.children.link(REL)
REL.objects.link(AXE_OBJ)
for _sg in (-1, 1):
    _hp = Vector(tuple(float(x) for x in HEADS[_sg]))
    _tgt = Vector((_sg * 4.3, 2.4, 9.6))
    _k = bpy.data.lights.new(f'cobrakey{_sg}', 'SPOT')
    _k.energy = float(arg('--ckey', 52000.0, float))
    _k.color = (1.0, 0.74, 0.46)
    _k.spot_size = 0.40
    _k.spot_blend = 0.65
    _k.shadow_soft_size = 2.2
    _ko = link(bpy.data.objects.new(f'cobrakey{_sg}', _k))
    _ko.location = (_sg * 5.5 - _sg * 3.0, -20.0, 16.0)
    _ko.rotation_euler = (_tgt - _ko.location).to_track_quat('-Z', 'Y').to_euler()
    _ko.light_linking.receiver_collection = COB
    _h = bpy.data.lights.new(f'headkey{_sg}', 'SPOT')            # a tighter lamp on the skull: lights the brow, lens and snout
    _h.energy = float(arg('--hkey', 9000.0, float))
    _h.color = (1.0, 0.86, 0.66)
    _h.spot_size = 0.16
    _h.spot_blend = 0.6
    _h.shadow_soft_size = 0.8
    _ho = link(bpy.data.objects.new(f'headkey{_sg}', _h))
    _ho.location = _hp + Vector((-_sg * 3.0, -13.0, 5.5))
    _ho.rotation_euler = (_hp - _ho.location).to_track_quat('-Z', 'Y').to_euler()
    _ho.light_linking.receiver_collection = COB

# C2 r15 (board r14 'the copper relic is carved but small and dim - make it the throne's brightest focal point'): its own warm key + a cool-white rim, linked
# to the relic only, so it outshines the witchfire and the stone around it.
_rk = bpy.data.lights.new('relickey', 'SPOT')
_rk.energy = float(arg('--rkey', 17000.0, float))
_rk.color = (1.0, 0.80, 0.58)
_rk.spot_size = 0.20
_rk.spot_blend = 0.5
_rk.shadow_soft_size = 1.6
_rko = link(bpy.data.objects.new('relickey', _rk))
_rko.location = (AXE_HEAD.x - 3.5, -19.0, AXE_HEAD.z + 6.5)
_rko.rotation_euler = (AXE_HEAD - _rko.location).to_track_quat('-Z', 'Y').to_euler()
_rko.light_linking.receiver_collection = REL
_rr = bpy.data.lights.new('relicrim', 'SPOT')
_rr.energy = float(arg('--rrim', 4500.0, float))
_rr.color = (1.0, 0.92, 0.80)
_rr.spot_size = 0.24
_rr.spot_blend = 0.5
_rr.shadow_soft_size = 1.0
_rro = link(bpy.data.objects.new('relicrim', _rr))
_rro.location = (AXE_HEAD.x + 5.5, -6.0, AXE_HEAD.z + 6.5)
_rro.rotation_euler = (AXE_HEAD - _rro.location).to_track_quat('-Z', 'Y').to_euler()
_rro.light_linking.receiver_collection = REL

# off-camera emissive reflector cards (invisible to the camera): give the copper cheeks and wet scales warm / green gradients to reflect
def reflector(name, loc, size, col, strength, aim):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    ob_ = obj_from_bm(name, bm, mk_mat(name, lambda nt: emit_shader(nt, col, strength)))
    ob_.scale = (size[0], size[1], 1)
    ob_.location = loc
    ob_.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    ob_.visible_camera = False
    ob_.visible_shadow = False
    return ob_


reflector('refl_warm', (-9.0, -9.0, 8.5), (7.0, 3.0), (1.0, 0.55, 0.22, 1), 4.2, (AXE_HEAD.x, AXE_HEAD.y, AXE_HEAD.z))
reflector('refl_green', (8.5, -7.0, 7.0), (4.0, 7.0), (0.30, 1.0, 0.20, 1), 6.0, (AXE_HEAD.x, AXE_HEAD.y, AXE_HEAD.z))
reflector('refl_cool', (0.0, -14.0, 13.0), (14.0, 3.0), (0.60, 0.50, 1.0, 1), 2.0, (AXE_HEAD.x, AXE_HEAD.y, AXE_HEAD.z))

wf = bpy.data.lights.new('witchfire_axe', 'POINT')           # the braziers' green light grazes the copper cheeks (verdigris sheen on the bit)
wf.energy = 190.0
wf.color = (0.25, 1.0, 0.18)
wf.shadow_soft_size = 0.6
wfo = link(bpy.data.objects.new('witchfire_axe', wf))
wfo.location = (AXE_HEAD.x + 2.2, AXE_HEAD.y - 2.4, AXE_HEAD.z - 0.2)

for _nm in (arg('--off', '', str) or '').split(','):      # debugging: --off warm,fill,sun,green0,green1,axeglow
    if _nm and _nm in bpy.data.objects:
        bpy.data.objects[_nm].hide_render = True
cam = bpy.data.cameras.new('cam')
cam.lens = 47.0
cam.sensor_fit = 'HORIZONTAL'
cam.sensor_width = 36.0
cam.clip_end = 400
co = link(bpy.data.objects.new('cam', cam))
cam_pos = Vector((0.0, -27.0, 2.6))
look = Vector((0.0, 3.0, 5.7))
co.location = cam_pos
co.rotation_euler = (look - cam_pos).to_track_quat('-Z', 'Y').to_euler()
if '--dbgcol' in ARGS:                    # debug: show the cobra 'Col' attribute (R pale, G bronze, B spectacle) as emission
    nt_ = M['scales'].node_tree
    for n_ in list(nt_.nodes):
        if n_.type != 'OUTPUT_MATERIAL':
            nt_.nodes.remove(n_)
    at_ = N(nt_, 'ShaderNodeAttribute', attribute_name='Col', attribute_type='GEOMETRY')
    em_ = N(nt_, 'ShaderNodeEmission')
    nt_.links.new(at_.outputs['Color'], em_.inputs['Color'])
    nt_.links.new(em_.outputs[0], [n for n in nt_.nodes if n.type == 'OUTPUT_MATERIAL'][0].inputs['Surface'])
CLOSE = arg('--closeup', '', str)
if CLOSE in ('R', 'L'):
    hp = Vector(tuple(float(x) for x in HEADS[1 if CLOSE == 'R' else -1]))
    co.location = hp + Vector((0.0, -float(arg('--cdist', 10.5, float)), float(arg('--cup', 0.4, float))))
    co.rotation_euler = (hp - co.location).to_track_quat('-Z', 'Y').to_euler()
elif CLOSE == 'axe':
    co.location = Vector((0.0, -14.0, 7.0))
    co.rotation_euler = (AXE_HEAD - co.location).to_track_quat('-Z', 'Y').to_euler()
elif CLOSE == 'fire':
    co.location = Vector((6.6, -12.0, 5.0))
    co.rotation_euler = (Vector((6.6, -1.4, 5.0)) - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = co
LOG('scene built', round(time.time() - T00, 1), 's')
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
import json
KEY = {'braziers': [], 'axe': None, 'flames': 'rendered'}
for (bx, by) in BR:
    v = world_to_camera_view(sc, co, Vector((bx, by, DAIS_TOP - 1.4 + 2.9)))
    v2 = world_to_camera_view(sc, co, Vector((bx + 1.0, by, DAIS_TOP - 1.4 + 2.9)))
    KEY['braziers'].append({'x': v.x, 'y': 1 - v.y, 'unit': abs(v2.x - v.x)})
v = world_to_camera_view(sc, co, AXE_HEAD)
KEY['axe'] = {'x': v.x, 'y': 1 - v.y}
os.makedirs(os.path.join(ROOT, 'progress', 'tmp'), exist_ok=True)
json.dump(KEY, open(os.path.join(ROOT, 'progress', 'tmp', 'throne_keys.json'), 'w'))

# ================================================================================================ render
tmp = os.path.join(ROOT, 'progress', 'tmp')
os.makedirs(tmp, exist_ok=True)
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.color_depth = '16'
p = os.path.join(tmp, 'throne_rgba.exr')
sc.render.filepath = p
OUT_NPY = arg('--npy', os.path.join(tmp, 'throne_rgba.npy'), str)
PNG = arg('--png', '', str)


def render_rgba():
    bpy.ops.render.render(write_still=True)
    im_ = bpy.data.images.load(p)
    im_.colorspace_settings.name = 'Non-Color'
    wd_, ht_ = im_.size
    a_ = np.empty(wd_ * ht_ * 4, np.float32)
    im_.pixels.foreach_get(a_)
    bpy.data.images.remove(im_)
    return a_.reshape(ht_, wd_, 4)[::-1].copy()


# C2 r13 (board r12 "witchfire reads as flat additive blobs with hard edges"): the flames are rendered as their OWN layer. Pass A = the scene
# without any flame object; pass B = only the flames (every other mesh is a holdout, so the bowl rim and coils still occlude them) into
# <npy>_flames.npy. blender/ui_title_paint.py adds that layer to the dusk plate (additively, softened over three radii) instead of alpha-over,
# so a tongue never prints an opaque cut-out outline over the plate.
FLAME_OBJS = [o for o in bpy.data.objects if o.name.startswith(('flame', 'firevol'))]
SPLIT = bool(FLAME_OBJS) and not arg('--noflamesplit', False)
if SPLIT:
    for o in FLAME_OBJS:
        o.hide_render = True
a = render_rgba()
wd, ht = a.shape[1], a.shape[0]
np.save(OUT_NPY, a.astype(np.float16))
af = None
if SPLIT:
    for o in FLAME_OBJS:
        o.hide_render = False
    for o in bpy.data.objects:
        if o.type == 'MESH' and o not in FLAME_OBJS:
            o.is_holdout = True
    af = render_rgba()
    np.save(OUT_NPY.replace('.npy', '_flames.npy'), af.astype(np.float16))
    for o in bpy.data.objects:
        if o.type == 'MESH' and o not in FLAME_OBJS:
            o.is_holdout = False
    for o in FLAME_OBJS:
        o.hide_render = False
elif os.path.exists(OUT_NPY.replace('.npy', '_flames.npy')):
    os.remove(OUT_NPY.replace('.npy', '_flames.npy'))
if PNG:                                   # dev preview: composite over a dusk grey (flames added back additively), sRGB-encode, write a PNG
    comp_src = a.copy()
    if af is not None:
        comp_src[..., :3] += af[..., :3]
        comp_src[..., 3:4] = np.clip(comp_src[..., 3:4] + af[..., 3:4], 0, 1)
    al = comp_src[..., 3:4]
    comp = comp_src[..., :3] * 1.0 + np.array([0.20, 0.09, 0.07])[None, None, :] * (1 - al)
    comp = 1 - np.exp(-np.clip(comp, 0, None) * 1.25)
    enc = np.where(comp <= 0.0031308, comp * 12.92, 1.055 * comp ** (1 / 2.4) - 0.055)
    pim = bpy.data.images.new('prev', wd, ht, alpha=False)
    px = np.concatenate([enc[::-1], np.ones((ht, wd, 1))], axis=2).astype(np.float32)
    pim.pixels.foreach_set(px.ravel())
    pim.filepath_raw = PNG
    pim.file_format = 'PNG'
    pim.save()
try:
    os.remove(p)
except OSError:
    pass


def dev_png(path, arr):
    wd_, ht_ = arr.shape[1], arr.shape[0]
    al_ = arr[..., 3:4]
    cmp_ = 1 - np.exp(-np.clip(arr[..., :3] + np.array([0.20, 0.09, 0.07])[None, None, :] * (1 - al_), 0, None) * 1.25)
    enc_ = np.where(cmp_ <= 0.0031308, cmp_ * 12.92, 1.055 * cmp_ ** (1 / 2.4) - 0.055)
    im_ = bpy.data.images.new('prevv', wd_, ht_, alpha=False)
    im_.pixels.foreach_set(np.concatenate([enc_[::-1], np.ones((ht_, wd_, 1))], axis=2).astype(np.float32).ravel())
    im_.filepath_raw = path
    im_.file_format = 'PNG'
    im_.save()


if arg('--variants', '', str):                # dev: re-render with the cobra skin replaced by a debug emission of one shader node (diagnostics)
    nt_ = M['scales'].node_tree
    outn = [n for n in nt_.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    for var in arg('--variants', '', str).split(','):
        if var == 'fin3':
            src = SD['fin3'].outputs[2]
        elif var == 'spec':
            src = SD['spec'].outputs[2]
        elif var == 'g':
            src = SD['sp'].outputs['Green']
        elif var == 'b':
            src = SD['sp'].outputs['Blue']
        else:
            continue
        em_ = N(nt_, 'ShaderNodeEmission')
        nt_.links.new(src, em_.inputs['Color'])
        nt_.links.new(em_.outputs[0], outn.inputs['Surface'])
        bpy.ops.render.render(write_still=True)
        im2 = bpy.data.images.load(p)
        im2.colorspace_settings.name = 'Non-Color'
        w2, h2 = im2.size
        a2 = np.empty(w2 * h2 * 4, np.float32)
        im2.pixels.foreach_get(a2)
        dev_png(PNG.replace('.png', '_' + var + '.png'), a2.reshape(h2, w2, 4)[::-1])
        bpy.data.images.remove(im2)
        LOG('variant', var)
LOG('rendered', wd, ht, round(time.time() - T00, 1), 's -> progress/tmp/throne_rgba.npy')
