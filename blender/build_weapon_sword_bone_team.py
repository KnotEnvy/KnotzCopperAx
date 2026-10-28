"""C2 r22 bone sword fork: broad porous ivory blade, knuckle pommel and wrapped grip.

Run through tools/blender-run.mjs with --fast or --release --out <scratch directory>.
Grip at origin; blade +Z Blender = +Y glTF. Seeded SDF pores bake into the normal map.
This fork never writes to public/ or changes the shared Sept weapon baker.
"""
import os
import sys
import time
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import skelknight_team as team
import importlib
import numpy as np
import bpy

from lib import sdf, meshutil, pipeline, shaders, charkit, preview
for _m in (sdf, meshutil, pipeline, shaders, charkit):
    importlib.reload(_m)
import build_enemy_marauder as BM
importlib.reload(BM)
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     RoundCone, RoundBox, Torus, Slab, Displace)

ROOT = os.path.dirname(HERE)
OUT_MODELS = team.out_dir("skeleton", "skeleton", "out", "1")
OUT_TEX = os.path.join(OUT_MODELS, "textures")
CONFIG = dict(seed=223, blade_width=0.11, tris=1980, atlas=1024)
MATS = ["bone", "iron", "leather", "wood", "bronze", "cloth"]
KINDS = {"bone": "nail", "wood": "leather", "cloth": "cloth"}


def lens_blade(z0, z1, w0, w1, t_half, point_len, s_edge=None):
    """Diamond-section blade between z0..z1 (half-width w0 -> w1), centre half-thickness t_half, pointed tip."""
    wmax = max(w0, w1) * 1.12
    s = t_half / wmax
    n1, n2 = norm(V(s, 1, 0)), norm(V(-s, 1, 0))
    t = t_half / math.sqrt(s * s + 1)
    lens = Inter(Slab(V(0, 0, 0), n1, t), Slab(V(0, 0, 0), n2, t))
    L = z1 - z0
    sides = []
    for sx in (1, -1):
        sides.append(HalfSpace(V(sx * w0, 0, z0), norm(V(sx, 0, (w0 - w1) / L))))
    tip = z1 + point_len
    pts = []
    for sx in (1, -1):
        pts.append(HalfSpace(V(sx * w1, 0, z1), norm(V(sx * point_len, 0, w1))))
    return Inter(lens, *sides, *pts, HalfSpace(V(0, 0, z0), V(0, 0, -1)), k=0.0015), tip


def sword_sculpt():
    """Broad, asymmetric grave-bone blade; pits bake into its normal map, never a steel blade."""
    S = Sculpt(materials=MATS, default_mat="bone")
    z0, z1 = 0.035, 0.72
    blade, tip = lens_blade(z0, z1, CONFIG["blade_width"] / 2, 0.040, 0.020, 0.13)
    S.add(blade, 0.0, mat="bone")
    # Broad recessed fuller on both flats: shallow enough to retain a continuous central web.
    for sy in (-1, 1):
        S.sub(RoundBox(V(0, sy * 0.020, 0.405), V(0.017, 0.009, 0.270), r=0.012), 0.002, mat="bone")
    # Notched cutting edges break the silhouette at the stage camera.
    for sx, z, r in ((1, 0.24, 0.013), (1, 0.47, 0.010), (-1, 0.35, 0.016), (-1, 0.61, 0.012)):
        w = 0.055 + (0.040 - 0.055) * (z - z0) / (z1 - z0)
        S.sub(Sphere(V(sx * (w + r * 0.25), 0, z), r), 0.003)
    # Shallow irregular porous depressions in the HI surface transfer to the LO normal bake.
    rng = np.random.default_rng(CONFIG["seed"])
    for sy in (-1, 1):
        for i in range(26):
            z = float(rng.uniform(0.10, 0.73))
            x = float(rng.uniform(-0.026, 0.026))
            y = sy * (0.020 - abs(x) * 0.22 + 0.001)
            r = float(rng.uniform(0.0025, 0.0065))
            S.sub(Ellipsoid(V(x, y, z), V(r, r * 0.8, r * 1.5)), 0.0012, mat="bone")
    # Knuckle guard, continuous bone tang and wrapped leather grip.
    S.add(RoundBox(V(0, 0, 0.026), V(0.074, 0.018, 0.018), r=0.012), 0.006, mat="bone")
    for sx in (-1, 1):
        S.add(Ellipsoid(V(sx * 0.075, 0, 0.025), V(0.025, 0.022, 0.027)), 0.008, mat="bone")
    S.add(RoundCone(V(0, 0, 0.025), V(0, 0, -0.105), 0.014, 0.016), 0.004, mat="bone")
    S.add(RoundCone(V(0, 0, 0.010), V(0, 0, -0.094), 0.017, 0.018), 0.003, mat="leather")
    pts = [V(math.cos(a) * 0.018, math.sin(a) * 0.018, 0.009 - a / (2 * math.pi) * 0.021)
           for a in np.linspace(0, 2 * math.pi * 5, 100)]
    S.add(Chain(pts, 0.0048, margin=0.01), 0.0015, mat="leather")
    S.add(Ellipsoid(V(0, 0, -0.116), V(0.029, 0.023, 0.026)), 0.007, mat="bone")
    for sx in (-1, 1):
        S.add(Sphere(V(sx * 0.020, 0, -0.123), 0.018), 0.005, mat="bone")
    return S, tip


PAL = dict(bone=shaders.srgb(224, 206, 166), bone_dark=shaders.srgb(72, 50, 28), bone_grime=shaders.srgb(150, 116, 72), steel=shaders.srgb(176, 176, 180), steel_rust=shaders.srgb(122, 70, 38),
           iron=shaders.srgb(104, 100, 98), iron_patina=shaders.srgb(116, 62, 32), iron_patina_amt=0.6,
           leather=shaders.srgb(66, 44, 30), leather_worn=shaders.srgb(120, 88, 60),
           wood=shaders.srgb(80, 54, 36), bronze=shaders.srgb(170, 128, 66), bronze_patina=shaders.srgb(70, 60, 44),
           cloth=shaders.srgb(120, 30, 26))


def p_steel_rust(c, pal):
    """Mid-tone steel with bright worn edges/ridges and rust blooms in cavities + blotches (holds value in-game)."""
    n1 = c.noise(24.0, 3, 301)
    n2 = c.noise(90.0, 2, 302)
    base = pal["steel"]
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.07 * n1 + 0.05 * n2)[:, None]
    rust = np.clip(shaders.smooth01(c.cav, 0.05, 0.45) + 0.6 * shaders.smooth01(n1, 0.45, 0.85), 0, 1) * \
        pal.get("rust_amt", 0.75)
    rgb = shaders.mix(rgb, pal["steel_rust"] * (0.8 + 0.3 * n2)[:, None], rust)
    rgb = shaders.mix(rgb, np.minimum(base * 1.3 + 0.05, 1), 0.55 * c.ridge * (1 - rust))
    metal = 0.85 - 0.75 * rust
    rough = 0.3 + 0.1 * n1 + 0.45 * rust - 0.12 * c.ridge
    return shaders.out(c.n, rgb, np.clip(rough, 0.15, 0.92), metal)


def p_wood(c, pal):
    P = c.P
    grain = 0.5 + 0.5 * np.sin(P[:, 2] * 40.0 + 30.0 * P[:, 0] + 5.0 * c.noise(18.0, 2, 303))
    rgb = shaders.mix(np.tile(pal["wood"], (c.n, 1)), pal["wood"] * 0.55, 0.45 * grain)
    rgb = shaders.mix(rgb, rgb * 0.5, np.clip(c.cav, 0, 1))
    return shaders.out(c.n, rgb, 0.7)


def p_bone(c, pal):
    n = c.noise(18.0, 3, 211)
    rgb = np.tile(pal["bone"], (c.n, 1)) * (0.96 + 0.05 * n)[:, None]
    # Centre fuller ages darker; bevels remain clean ivory, with elongated mineral streaks.
    fuller = (1-shaders.smooth01(np.abs(c.P[:,0]), .012, .026)) * shaders.smooth01(c.P[:,2], .08,.17) * (1-shaders.smooth01(c.P[:,2],.62,.73))
    streak = 0.5 + 0.5*np.sin(c.P[:,0]*430 + c.noise(8,2,212)*3)
    rgb = shaders.mix(rgb, pal["bone_grime"], fuller*.42 + streak*.12)
    rgb = shaders.mix(rgb, pal["bone_grime"], shaders.smooth01(c.cav, 0.02, 0.45) * 0.75)
    rgb = shaders.mix(rgb, pal["bone_dark"], shaders.smooth01(c.cav, 0.3, 0.75) * 0.45)
    return shaders.out(c.n, rgb, np.clip(0.68 - 0.1 * c.ridge, 0.5, 0.85))


PAINTERS = {"bone": p_bone, "wood": p_wood, "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth")}


def bake_weapon(S, name, lo, hi, tris, pal, nodes, fast=False, painters=None, h_hi=None, h_lo=0.0016,
                density=1.0):
    """SDF weapon -> HI (bake source) + LO (budget) -> smart UV -> albedo/prm/ao/normal bake -> GLB with nodes."""
    T0 = time.time()
    res = CONFIG["atlas"]
    pipeline.setup_cycles("AUTO")
    hi_ob = pipeline.sculpt_mesh(S, name + "_hi", h_hi or (0.0009 if fast else 0.0005), lo, hi)
    lo_ob = pipeline.lowpoly(S, name + "_lo", h_lo, tris, lo, hi, symmetry=False,
                             clean=lambda o: charkit.drop_islands(o, h_lo, min_verts=20))
    charkit.drop_islands(lo_ob, 0.0036, min_verts=20)
    lo_ob.data.validate()
    qa = charkit.geom_qa(lo_ob)
    charkit.smart_uv(lo_ob, 60.0, density)
    fill = pipeline.pack_atlas_shape([lo_ob], margin_px=4, res=res)
    shaders.assign_bake_materials(hi_ob, S.materials, prefix="wk_", kinds=KINDS)
    shaders.paint_mesh(hi_ob, S.materials, {}, pal, {}, painters=dict(PAINTERS, **(painters or {})))
    pipeline.set_ray_visibility(lo_ob, False)
    B = pipeline.Baker(res, [(lo_ob, [hi_ob], 0.004, 0.012)], shaders.set_pass, [lo_ob], [hi_ob])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 32 if fast else 64),
                         ("normal", "NORMAL", 8)])
    tex = charkit.composite_maps(maps, OUT_TEX, name, tint=(0.5, 0.36, 0.3), dil=12)
    mat = pipeline.final_material("M_" + name, tex["albedo"], tex["normal"], tex["orm"])
    lo_ob.data.materials.clear()
    lo_ob.data.materials.append(mat)
    pipeline.strip_for_export(lo_ob)
    bpy.data.objects.remove(hi_ob, do_unlink=True)
    lo_ob.name = name
    empties = []
    for nm, p in nodes.items():
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = tuple(float(x) for x in p)
        e.parent = lo_ob
        empties.append(e)
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, name + ".glb")
    pipeline.export_glb(team.guard_out(out), [lo_ob] + empties, scene_name=name)
    team.patch_extras(out, {"M_" + name: {"rim": 0.65}})
    rep = dict(asset=name, tris=meshutil.tri_count(lo_ob), uv_fill=fill, geom_qa=qa, seconds=time.time() - T0,
               mb=os.path.getsize(out) / 1e6, nodes={k: [float(x) for x in v] for k, v in nodes.items()})
    pipeline.write_json(team.guard_out(os.path.join(OUT_MODELS, name + "_report.json")), rep)
    pipeline.log(f"DONE {out} {rep['tris']} tris {rep['seconds']:.0f}s qa={qa}")
    return rep


def main():
    global OUT_MODELS, OUT_TEX
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--fast", action="store_true")
    mode.add_argument("--release", action="store_true")
    ap.add_argument("--out", default=OUT_MODELS)
    ap.add_argument("--preview", nargs="?", const="full", default=None)
    a = ap.parse_args(argv)
    OUT_MODELS = os.path.abspath(team.guard_out(a.out))
    OUT_TEX = team.guard_out(os.path.join(OUT_MODELS, "textures"))
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)
    np.random.seed(CONFIG["seed"])
    meshutil.clear_scene()
    S, tip = sword_sculpt()
    if a.preview:
        preview.setup_workbench("MATERIAL")
        charkit.mesh_sculpt(S, "bone_sword_preview", 0.0015, V(-0.16, -0.05, -0.17), V(0.16, 0.05, tip + 0.02),
                            colors={"bone": (0.82, 0.74, 0.56), "leather": (0.15, 0.09, 0.05)})
        preview.render_views(team.guard_out(os.path.join(OUT_MODELS, "sword_preview.png")),
                             [dict(target=(0, 0, 0.35), ortho=1.12, yaw=y, dist=3, pitch=0) for y in (0, 35, 90)],
                             res=(400, 900))
        return
    bake_weapon(S, "weapon_sword_bone", V(-0.16, -0.05, -0.17), V(0.16, 0.05, tip + 0.02), CONFIG["tris"], team.tier_pal("skeleton", "white", PAL),
                {"grip_main": V(0, 0, 0), "blade_tip": V(0, 0, tip)}, fast=a.fast, density=1.2)


if __name__ == "__main__":
    main()
