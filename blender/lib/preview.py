"""Fast sculpt review renders (Workbench clay or Cycles) tiled into one PNG contact sheet."""
import math
import os
import numpy as np
import bpy
from mathutils import Vector


def _cam(name="prev_cam"):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def setup_workbench(color_type="MATERIAL", cavity=True):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    try:
        sh.studio_light = "outdoor.sl"
    except Exception:
        pass
    sh.color_type = color_type
    sh.single_color = (0.62, 0.52, 0.44)
    sh.show_cavity = cavity
    sh.cavity_type = "BOTH"
    sh.cavity_ridge_factor = 1.0
    sh.cavity_valley_factor = 1.4
    sh.curvature_ridge_factor = 0.6
    sh.curvature_valley_factor = 0.8
    sh.show_shadows = True
    sh.shadow_intensity = 0.4
    sh.show_specular_highlight = True
    sc.display.shadow_shift = 0.1
    sc.render.film_transparent = False
    try:
        sc.display_settings.display_device = "sRGB"
        sc.view_settings.view_transform = "Standard"
    except Exception:
        pass
    world = sc.world or bpy.data.worlds.new("w")
    sc.world = world


def look_at(cam, target, dist, yaw, pitch=5.0, ortho=None, lens=85.0):
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    # yaw 0 = front view (camera at -Y looking +Y)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    cam.data.clip_start = 0.01
    cam.data.clip_end = 100


def render_views(out_png, views, res=(700, 1000), samples=None):
    """views: list of dicts {target, dist, yaw, pitch, ortho|lens}. Tiles horizontally into out_png."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    cam = _cam()
    tiles = []
    tmp_dir = os.path.dirname(out_png)
    os.makedirs(tmp_dir, exist_ok=True)
    for i, v in enumerate(views):
        look_at(cam, v["target"], v.get("dist", 4.0), v.get("yaw", 0.0), v.get("pitch", 0.0),
                v.get("ortho"), v.get("lens", 85.0))
        p = os.path.join(tmp_dir, f"_tile{i}.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(p)
        a = np.array(img.pixels[:], np.float32).reshape(res[1], res[0], 4)
        bpy.data.images.remove(img)
        os.remove(p)
        tiles.append(a)
    sheet = np.concatenate(tiles, axis=1)
    H, W = sheet.shape[:2]
    im = bpy.data.images.new("sheet", W, H, alpha=True)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = out_png
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    print("[preview] wrote", out_png)
    return out_png


def clay_material(name, rgb, rough=0.5):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    m.roughness = rough
    return m
