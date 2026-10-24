"""World-map relief painting for the map interlude (ui-flow r7): the whole realm modelled as a low-poly 3D diorama (heightfield
terrain with real mountains, lake, rivers, forests, burning village, Shellback tortoise carrying its village, eagle peaks, Serpent
Keep, the serpent throne ...), lit by a low north-west sun with soft shadows and rendered with an orthographic 38-degree tilt so
every map coordinate used by src/ui/screens/map.js (plaques, route, marker) stays valid (see lib/mapkit.py for the space).
Blender only renders the passes (beauty + normal + depth as float .npy under progress/tmp/); the ink / hatch / parchment post is
plain numpy (blender/ui_map_post.py, bundled python, NO Blender slot) so it can be tuned without re-rendering.

    node tools/blender-run.mjs --owner ui-flow --what "ui map" -- -b --factory-startup -P blender/build_ui_map.py -- [--fast] [--w 3200]
    <bundled python> blender/ui_map_post.py [out.png]   then   node tools/ui-art-encode.mjs out.png public/assets/ui/map_relief.webp
    --fast = 800x450, few samples (iteration).  --props a,b,c  restrict props.  --nocache  recompute terrain/paint.
"""
import os
import sys
import time
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import numpy as np
import bpy

from lib import mapkit as MK, mapworld as MW, mapland as ML, mapprops as MP, meshutil
for _m in (MK, MW, ML, MP, meshutil):
    importlib.reload(_m)

ROOT = os.path.dirname(HERE)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None, cast=str):
    if name in ARGS:
        i = ARGS.index(name)
        return cast(ARGS[i + 1]) if i + 1 < len(ARGS) and not ARGS[i + 1].startswith('--') else True
    return default


FAST = '--fast' in ARGS
RW = int(arg('--w', 800 if FAST else 3200, int))
RH = RW * 9 // 16
SAMPLES = int(arg('--samples', 24 if FAST else 160, int))
TEXW = 1600 if FAST else 3200
ONLY = arg('--props', None)
CACHE = os.path.join(ROOT, 'progress', 'tmp', f'map_cache_{TEXW}.npz')
LOG = lambda *a: print('[map]', *a, flush=True)
t00 = time.time()


# ------------------------------------------------------------------------------------------------ terrain + albedo (cached)
def load_fields():
    if os.path.exists(CACHE) and '--nocache' not in ARGS:
        d = np.load(CACHE)
        T = {k: d['T_' + k] for k in MP.TERRAIN_KEYS}
        LOG('cache hit', CACHE)
        return T, d['albedo']
    T = MW.terrain()
    A = MW.paint(T, TEXW, TEXW * 9 // 16)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    np.savez(CACHE, albedo=A, **{'T_' + k: T[k] for k in MP.TERRAIN_KEYS})
    return T, A


T, ALB = load_fields()
LOG('fields ready', round(time.time() - t00, 1), 's')

# ------------------------------------------------------------------------------------------------ scene
meshutil.clear_scene()
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
from lib import pipeline
pipeline.setup_cycles('AUTO', SAMPLES)
try:
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_x = RW; sc.render.resolution_y = RH; sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'Standard'
try:
    sc.view_settings.look = 'None'
except Exception:
    pass

# world: soft warm sky (ambient occlusion comes free from Cycles)
w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
bg = w.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.86, 0.80, 0.70, 1); bg.inputs['Strength'].default_value = 0.55

# sun from the north-west, ~40 deg elevation
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.4; sun.angle = 0.045; sun.color = (1.0, 0.93, 0.80)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
from mathutils import Vector
tosun = Vector((-0.62, 0.52, 0.66)).normalized()
so.rotation_euler = (-tosun).to_track_quat('-Z', 'Y').to_euler()

# camera: orthographic, tilted MK.TILT from straight down, centred on the map
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 1600; cam.sensor_fit = 'HORIZONTAL'; cam.clip_start = 1; cam.clip_end = 6000
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co)
co.rotation_euler = (MK.TILT, 0, 0)
co.location = (0, -1500 * np.sin(MK.TILT), 1500 * np.cos(MK.TILT))
sc.camera = co


# materials
def mk_mat(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    sh = build(nt)
    nt.links.new(sh.outputs[0], out.inputs['Surface'])
    return m


def principled(nt, rough=0.95):
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = rough
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs:
            b.inputs[k].default_value = 0.0
    return b


img = bpy.data.images.new('albedo', ALB.shape[1], ALB.shape[0], alpha=False)
img.colorspace_settings.name = 'sRGB'
buf = np.concatenate([ALB[::-1], np.ones(ALB.shape[:2] + (1,), np.float32)], -1)
img.pixels.foreach_set(buf.ravel()); img.pack()


def build_terrain_mat(nt):
    b = principled(nt, 0.97)
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Linear'; t.extension = 'EXTEND'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    return b


def build_vcol_mat(nt, rough=0.9, alpha=None):
    b = principled(nt, rough)
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = 'Col'; a.attribute_type = 'GEOMETRY'
    nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
    return b


def build_emit_mat(nt, strength=7.0):
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Strength'].default_value = strength
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = 'Col'; a.attribute_type = 'GEOMETRY'
    nt.links.new(a.outputs['Color'], e.inputs['Color'])
    return e


MATS = {
    'terrain': mk_mat('terrain', build_terrain_mat),
    'flat': mk_mat('flat', build_vcol_mat),
    'smooth': mk_mat('smooth', build_vcol_mat),
    'smoke': mk_mat('smoke', lambda nt: build_vcol_mat(nt, 1.0, 0.42)),
    'emit': mk_mat('emit', lambda nt: build_emit_mat(nt, 6.0)),
    'glow': mk_mat('glow', lambda nt: build_emit_mat(nt, 2.5)),
}

# terrain object
ter = MK.grid_mesh('terrain', T['Z'], material=MATS['terrain'])
LOG('terrain mesh', round(time.time() - t00, 1), 's')

# props
ctx = MP.Ctx(T, MATS, ONLY.split(',') if isinstance(ONLY, str) else None)
MP.build_all(ctx)
LOG('props', ctx.stats(), round(time.time() - t00, 1), 's')

# ------------------------------------------------------------------------------------------------ render passes -> float .npy (post runs OUTSIDE Blender)
tmp = os.path.join(ROOT, 'progress', 'tmp'); os.makedirs(tmp, exist_ok=True)
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.color_depth = '32'


def read_img(path):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    w_, h_ = im.size
    a = np.empty(w_ * h_ * 4, np.float32); im.pixels.foreach_get(a)
    a = a.reshape(h_, w_, 4)[::-1]
    bpy.data.images.remove(im)
    return a[..., :3].copy()


def render_to(name):
    p = os.path.join(tmp, f'map_{name}.exr')
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    np.save(os.path.join(tmp, f'map_{name}.npy'), read_img(p).astype(np.float16 if name == 'beauty' else np.float32))
    if os.path.exists(p):
        os.remove(p)


render_to('beauty')
LOG('beauty rendered', round(time.time() - t00, 1), 's')


# ------------------------------------------------------------------------------------------------ guide passes: normals + depth
def guide_pass(kind):
    """Override every material by an emission that encodes camera-space normal (rgb) or camera depth (grey)."""
    m = bpy.data.materials.new('guide_' + kind); m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    e = nt.nodes.new('ShaderNodeEmission')
    g = nt.nodes.new('ShaderNodeNewGeometry')
    vt = nt.nodes.new('ShaderNodeVectorTransform'); vt.convert_from = 'WORLD'; vt.convert_to = 'CAMERA'
    if kind == 'normal':
        vt.vector_type = 'NORMAL'
        mp = nt.nodes.new('ShaderNodeVectorMath'); mp.operation = 'MULTIPLY_ADD'; mp.inputs[1].default_value = (0.5, 0.5, 0.5); mp.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(g.outputs['Normal'], vt.inputs['Vector']); nt.links.new(vt.outputs['Vector'], mp.inputs[0]); nt.links.new(mp.outputs['Vector'], e.inputs['Color'])
    else:
        vt.vector_type = 'POINT'
        sp = nt.nodes.new('ShaderNodeSeparateXYZ'); mp = nt.nodes.new('ShaderNodeMath'); mp.operation = 'MULTIPLY_ADD'
        mp.inputs[1].default_value = -1.0; mp.inputs[2].default_value = 0.0     # camera-space depth (-z) in world units
        nt.links.new(g.outputs['Position'], vt.inputs['Vector']); nt.links.new(vt.outputs['Vector'], sp.inputs['Vector']); nt.links.new(sp.outputs['Z'], mp.inputs[0])
        nt.links.new(mp.outputs['Value'], e.inputs['Color'])
    e.inputs['Strength'].default_value = 1.0
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    return m


sc.cycles.samples = 8; sc.cycles.use_denoising = False
sc.view_settings.view_transform = 'Raw'
sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
vl = bpy.context.view_layer
for kind in ('normal', 'depth'):
    vl.material_override = guide_pass(kind)
    render_to(kind)
vl.material_override = None
LOG('guides rendered', round(time.time() - t00, 1), 's  -> run blender/ui_map_post.py with the bundled python (no Blender slot)')
