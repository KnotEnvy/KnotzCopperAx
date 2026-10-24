"""Grave Skeleton weapon: a notched, rust-bitten arming sword (weapon_sword_bone.glb) + the shared SDF weapon baker
used by build_weapon_halberd.py.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_weapon_sword_bone.py -- [--fast]
Frame (docs/ART_PIPELINE.md 4.2): grip (main hand) at the origin, blade +Z (Blender) = +Y glTF, flat facing +-Y,
edges +-X. Nodes: grip_main, blade_tip.
Design: ~0.95 m one-hander, diamond-section blade 6 cm wide tapering to a point, a shallow fuller, three nicks hacked
out of the edges and a snapped-off corner; heavy straight iron crossguard with drooping block ends, leather-wrapped
grip with a cord binding, a wheel pommel. Rusty steel (mid-tone, bright ridges) so it holds value in-game.
"""
import os
import sys
import time
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib
import numpy as np
import bpy

from lib import sdf, meshutil, pipeline, shaders, charkit
for _m in (sdf, meshutil, pipeline, shaders, charkit):
    importlib.reload(_m)
import build_enemy_marauder as BM
importlib.reload(BM)
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     RoundCone, RoundBox, Torus, Slab, Displace)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
MATS = ["steel", "iron", "leather", "wood", "bronze", "cloth"]
KINDS = {"steel": "iron", "wood": "leather", "cloth": "cloth"}


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
    S = Sculpt(materials=MATS, default_mat="steel")
    z0, z1 = 0.045, 0.74
    blade, tip = lens_blade(z0, z1, 0.03, 0.022, 0.0068, 0.11)
    S.add(blade, 0.0, mat="steel")
    for sy in (1, -1):                                              # shallow fuller both faces
        S.sub(Capsule(V(0, sy * 0.0112, 0.085), V(0, sy * 0.0112, 0.5), 0.0075), 0.003)
    # battle damage: nicks + a snapped corner near the tip
    for sx, z, r in ((1, 0.33, 0.009), (1, 0.52, 0.006), (-1, 0.41, 0.011), (-1, 0.22, 0.005)):
        w = 0.03 + (0.022 - 0.03) * (z - z0) / (z1 - z0)
        S.sub(Sphere(V(sx * (w + r * 0.35), 0, z), r), 0.002)
    S.sub(Ellipsoid(V(-0.036, 0, 0.66), V(0.018, 0.03, 0.026)), 0.002)
    # ricasso block + crossguard (straight, drooping block terminals)
    S.add(RoundBox(V(0, 0, 0.045), V(0.03, 0.012, 0.012), r=0.004), 0.004, mat="iron")
    S.add(RoundBox(V(0, 0, 0.028), V(0.1, 0.014, 0.012), r=0.006), 0.004, mat="iron")
    for sx in (1, -1):
        S.add(RoundBox(V(sx * 0.108, 0, 0.022), V(0.014, 0.017, 0.02), rot(0, sx * 12, 0), r=0.006), 0.006,
              mat="iron")
    S.add(Ellipsoid(V(0, 0, 0.028), V(0.024, 0.02, 0.018)), 0.006, mat="iron")
    # grip: leather wrap with raised spiral cord, wheel pommel
    S.add(RoundCone(V(0, 0, 0.018), V(0, 0, -0.095), 0.0155, 0.0165), 0.003, mat="leather")
    pts = [V(math.cos(a) * 0.0165, math.sin(a) * 0.0165, 0.012 - a / (2 * math.pi) * 0.021)
           for a in np.linspace(0, 2 * math.pi * 5, 120)]
    S.add(Chain(pts, 0.0032, margin=0.01), 0.002, mat="leather")
    S.add(Torus(V(0, 0, -0.118), 0.018, 0.012, basis(V(0, 1, 0))[:, [1, 2, 0]]), 0.006, mat="iron")
    S.add(Ellipsoid(V(0, 0, -0.118), V(0.02, 0.014, 0.02)), 0.004, mat="iron")
    S.add(Sphere(V(0, 0, -0.142), 0.008), 0.004, mat="iron")
    return S, tip


PAL = dict(steel=shaders.srgb(176, 176, 180), steel_rust=shaders.srgb(122, 70, 38),
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


PAINTERS = {"steel": p_steel_rust, "wood": p_wood, "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth")}


def bake_weapon(S, name, lo, hi, tris, pal, nodes, fast=False, painters=None, h_hi=None, h_lo=0.0016,
                density=1.0):
    """SDF weapon -> HI (bake source) + LO (budget) -> smart UV -> albedo/prm/ao/normal bake -> GLB with nodes."""
    T0 = time.time()
    res = 512 if fast else 1024
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
    pipeline.export_glb(out, [lo_ob] + empties, scene_name=name)
    rep = dict(asset=name, tris=meshutil.tri_count(lo_ob), uv_fill=fill, geom_qa=qa, seconds=time.time() - T0,
               mb=os.path.getsize(out) / 1e6, nodes={k: [float(x) for x in v] for k, v in nodes.items()})
    pipeline.write_json(os.path.join(HERE, "out", name + "_report.json"), rep)
    pipeline.log(f"DONE {out} {rep['tris']} tris {rep['seconds']:.0f}s qa={qa}")
    return rep


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args(argv)
    meshutil.clear_scene()
    S, tip = sword_sculpt()
    bake_weapon(S, "weapon_sword_bone", V(-0.16, -0.05, -0.17), V(0.16, 0.05, tip + 0.02), 1400, PAL,
                {"grip_main": V(0, 0, 0), "blade_tip": V(0, 0, 0.79)}, fast=a.fast, density=1.2)


if __name__ == "__main__":
    main()
