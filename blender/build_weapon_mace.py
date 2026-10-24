"""Ashen Marauder weapons (one script, four GLBs): the tier escalation club -> mace -> flanged mace -> spiked mace.

  weapon_club          straw : gnarled oak cudgel, knotty swollen head with three crude iron nails, rag-wrapped grip
  weapon_mace          rust  : ash haft, rusty iron ball head with 8 pyramid studs, iron collar, leather grip
  weapon_mace_flanged  violet: iron-banded haft, 7-flange dark-iron head with a top knob, violet cloth grip wrap
  weapon_mace_spiked   iron  : heavy steel-banded haft, big bright steel morning-star head (14 spikes + top spike)

Weapon frame (docs/ART_PIPELINE.md 4.2): grip (right hand) at the origin, haft along +Z Blender = +Y glTF; heads
top out at ~0.62-0.70 m (src/anim/profiles.js marauder blade R 0.62). Nodes: grip_main (origin), head_tip (top).
Run: blender -b --factory-startup -P blender/build_weapon_mace.py -- [--fast] [--which club,mace,flanged,spiked]
Outputs public/assets/models/<id>.glb, textures public/assets/textures/enemy_marauder_<id>_*.png.
"""
import os
import sys
import math
import time
import argparse
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import bpy

from lib import sdf, meshutil, pipeline, shaders
for _m in (sdf, meshutil, pipeline, shaders):
    importlib.reload(_m)
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, RoundCone, RoundBox, Torus, Chain,
                     HalfSpace, Inter, Union, Diff, Bounded, Offset, Slab, Displace)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
MATS = ["wood", "iron", "steel", "leather_dark", "cloth"]
BOT = -0.13


def radial(n, phase=0.0):
    return [(math.cos(phase + i * 2 * math.pi / n), math.sin(phase + i * 2 * math.pi / n)) for i in range(n)]


def grip_wrap(S, r, z0, z1, mat, turns=9, cord=0.0034):
    pts = []
    n = 160
    for i in range(n + 1):
        t = i / n
        a = t * 2 * math.pi * turns
        pts.append(V(math.cos(a) * r, math.sin(a) * r, z0 + (z1 - z0) * t))
    S.add(Capsule(V(0, 0, z0), V(0, 0, z1), r + 0.001), 0.001, mat=mat)
    S.add(Chain(pts, cord, margin=0.02), 0.0015, mat=mat)


def club():
    S = Sculpt(materials=MATS, default_mat="wood")
    rng = np.random.RandomState(4)
    S.add(RoundCone(V(0, 0, BOT), V(0, 0, 0.36), 0.021, 0.034), 0.0, mat="wood")
    S.add(RoundCone(V(0, 0, 0.3), V(0.004, -0.003, 0.6), 0.036, 0.058), 0.03, mat="wood")
    S.add(Ellipsoid(V(0.004, -0.004, 0.57), V(0.062, 0.058, 0.07)), 0.03, mat="wood")
    for i in range(9):                                  # knots / burls
        a = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(0.36, 0.62)
        r = 0.035 + (z - 0.3) * 0.08
        S.add(Sphere(V(math.cos(a) * r, math.sin(a) * r, z), rng.uniform(0.012, 0.02)), 0.012, mat="wood")
    for i in range(3):                                  # crude nails
        a = i * 2.1 + 0.4
        z = 0.5 + 0.045 * i
        d = V(math.cos(a), math.sin(a), 0.15)
        c = V(0, 0, z) + d * 0.05
        S.add(RoundCone(c - d * 0.02, c + d * 0.04, 0.0055, 0.0018), 0.001, mat="iron")
        S.add(Sphere(c - d * 0.005, 0.009), 0.002, mat="iron")
    S.add(Sphere(V(0, 0, BOT - 0.004), 0.026), 0.012, mat="wood")    # pommel knob
    grip_wrap(S, 0.022, -0.1, 0.1, "cloth", turns=7, cord=0.004)
    return S, 0.64, Displace


def mace():
    S = Sculpt(materials=MATS, default_mat="wood")
    S.add(RoundCone(V(0, 0, BOT), V(0, 0, 0.52), 0.02, 0.023), 0.0, mat="wood")
    hc = V(0, 0, 0.56)
    S.add(Sphere(hc, 0.054), 0.004, mat="iron")
    for (x, y) in radial(4):                            # two rings of pyramid studs
        for dz, ph in ((0.022, 0.0), (-0.022, math.pi / 4)):
            a = math.atan2(y, x) + ph
            d = norm(V(math.cos(a), math.sin(a), dz * 12))
            S.add(RoundCone(hc + d * 0.045, hc + d * 0.078, 0.02, 0.004, squash=(1.0, 1.0)), 0.004, mat="iron")
    S.add(RoundCone(hc + V(0, 0, 0.04), hc + V(0, 0, 0.075), 0.018, 0.005), 0.004, mat="iron")
    S.add(Torus(V(0, 0, 0.5), 0.026, 0.008), 0.003, mat="iron")                  # collar
    S.add(RoundCone(V(0, 0, 0.46), V(0, 0, 0.51), 0.023, 0.028), 0.003, mat="iron")
    S.add(Sphere(V(0, 0, BOT - 0.006), 0.025), 0.008, mat="iron")
    grip_wrap(S, 0.021, -0.1, 0.11, "leather_dark")
    return S, 0.635, None


def flanged():
    S = Sculpt(materials=MATS, default_mat="iron")
    S.add(RoundCone(V(0, 0, BOT), V(0, 0, 0.5), 0.02, 0.022), 0.0, mat="wood")
    for z in (0.16, 0.3, 0.44):
        S.add(Torus(V(0, 0, z), 0.023, 0.0055), 0.002, mat="iron")
    z0, z1 = 0.47, 0.63
    S.add(RoundCone(V(0, 0, z0 - 0.02), V(0, 0, z1), 0.028, 0.026), 0.004, mat="iron")
    for (x, y) in radial(7):
        d = V(x, y, 0)
        n = V(-y, x, 0)
        M = np.stack([d, n, V(0, 0, 1)], axis=1)
        prof = Inter(RoundBox(V(0, 0, (z0 + z1) / 2) + d * 0.045, V(0.03, 0.0065, 0.078), M, r=0.003),
                     Sphere(V(0, 0, (z0 + z1) / 2 - 0.01), 0.1), k=0.004)       # curved outer edge
        S.add(prof, 0.004, mat="iron")
    S.add(Sphere(V(0, 0, z1 + 0.012), 0.024), 0.006, mat="iron")
    S.add(RoundCone(V(0, 0, z1 + 0.02), V(0, 0, z1 + 0.05), 0.012, 0.003), 0.003, mat="iron")
    S.add(Torus(V(0, 0, z0 - 0.02), 0.03, 0.007), 0.002, mat="iron")
    S.add(Sphere(V(0, 0, BOT - 0.006), 0.025), 0.008, mat="iron")
    grip_wrap(S, 0.021, -0.1, 0.11, "cloth", turns=8)
    return S, 0.68, None


def spiked():
    S = Sculpt(materials=MATS, default_mat="steel")
    S.add(RoundCone(V(0, 0, BOT - 0.01), V(0, 0, 0.52), 0.022, 0.025), 0.0, mat="wood")
    for z in (0.14, 0.26, 0.38, 0.5):
        S.add(Torus(V(0, 0, z), 0.026, 0.006), 0.002, mat="steel")
    for (x, y) in radial(4):                            # steel langets
        S.add(RoundBox(V(x * 0.024, y * 0.024, 0.43), V(0.003, 0.003, 0.08), None, r=0.002), 0.002, mat="steel")
    hc = V(0, 0, 0.6)
    HR = 0.088                     # C2 r7: the iron rank's head is the biggest weapon in the lineup (was 0.072)
    S.add(Sphere(hc, HR), 0.004, mat="steel")
    S.add(Torus(hc, HR - 0.001, 0.008), 0.003, mat="steel")
    dirs = []
    for ring, (dz, n, ph) in enumerate(((0.55, 5, 0.0), (0.0, 6, 0.5), (-0.55, 3, 0.2))):
        for (x, y) in radial(n, ph):
            dirs.append(norm(V(x, y, dz)))
    dirs.append(V(0, 0, 1))
    for d in dirs:
        L = 0.08 if d[2] < 0.99 else 0.095
        S.add(RoundCone(hc + d * (HR - 0.012), hc + d * (HR + L), 0.02, 0.0024), 0.004, mat="steel")
    S.add(RoundCone(V(0, 0, 0.5), V(0, 0, 0.535), 0.026, 0.034), 0.003, mat="steel")
    S.add(Sphere(V(0, 0, BOT - 0.018), 0.028), 0.008, mat="steel")
    grip_wrap(S, 0.023, -0.11, 0.11, "leather_dark")
    return S, 0.6 + HR + 0.095, None


WEAPONS = {"club": ("weapon_club", club, 1500), "mace": ("weapon_mace", mace, 1700),
           "flanged": ("weapon_mace_flanged", flanged, 2000), "spiked": ("weapon_mace_spiked", spiked, 2400)}


# ---------------------------------------------------------------------------- painters
def p_wood(c, pal):
    P = c.P
    grain = 0.5 + 0.5 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 5.0 + c.noise(3.0, 2, 94) * 9.0 + P[:, 2] * 40.0)
    n1 = c.noise(30.0, 3, 95)
    rgb = np.tile(pal["wood"], (c.n, 1)) * (0.78 + 0.28 * grain + 0.1 * n1)[:, None]
    rgb = shaders.mix(rgb, pal["wood"] * 1.5, 0.35 * c.ridge)
    rgb = shaders.mix(rgb, rgb * 0.45, 0.7 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.66 + 0.1 * n1, 0.3, 0.9), 0.0)


def p_iron(c, pal):
    n1 = c.noise(14.0, 3, 51)
    n2 = c.noise(80.0, 2, 52)
    rgb = np.tile(pal["iron"], (c.n, 1)) * (1.0 + 0.1 * n1 + 0.05 * n2)[:, None]
    rust = np.clip(shaders.smooth01(c.cav, 0.03, 0.4) + 0.5 * shaders.smooth01(n1, 0.2, 0.8), 0, 1) * pal["rust_amt"]
    rgb = shaders.mix(rgb, pal["rust"], rust)
    rgb = shaders.mix(rgb, pal["iron_hi"], 0.55 * c.ridge * (1 - rust))
    return shaders.out(c.n, rgb, np.clip(0.4 + 0.1 * n1 + 0.35 * rust - 0.15 * c.ridge, 0.15, 0.92),
                       0.75 * (1 - 0.85 * rust))


def p_steel(c, pal):
    n1 = c.noise(40.0, 2, 93)
    rgb = np.tile(pal["steel"], (c.n, 1)) * (1.0 + 0.06 * n1)[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(225, 228, 234), 0.7 * shaders.smooth01(c.ridge, 0.05, 0.4))
    rgb = shaders.mix(rgb, rgb * 0.4, 0.6 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.26 + 0.08 * n1, 0.1, 0.6), 0.85)


def p_cloth(c, pal):
    return shaders.p_cloth(c, pal)


PAINTERS = {"wood": p_wood, "iron": p_iron, "steel": p_steel, "cloth": p_cloth}
KINDS = {"wood": "leather", "steel": "iron"}
PALS = {
    "club": dict(wood=shaders.srgb(132, 96, 62), iron=shaders.srgb(80, 78, 76), iron_hi=shaders.srgb(150, 146, 140),
                 rust=shaders.srgb(110, 58, 30), rust_amt=0.7, cloth=shaders.srgb(190, 166, 100),
                 steel=shaders.srgb(180, 182, 188)),
    "mace": dict(wood=shaders.srgb(96, 66, 42), iron=shaders.srgb(84, 80, 78), iron_hi=shaders.srgb(170, 160, 150),
                 rust=shaders.srgb(140, 66, 30), rust_amt=0.75, leather_dark=shaders.srgb(46, 30, 22),
                 steel=shaders.srgb(180, 182, 188)),
    "flanged": dict(wood=shaders.srgb(54, 36, 30), iron=shaders.srgb(70, 66, 80), iron_hi=shaders.srgb(170, 166, 186),
                    rust=shaders.srgb(70, 44, 60), rust_amt=0.35, cloth=shaders.srgb(96, 36, 142),
                    steel=shaders.srgb(180, 182, 188)),
    "spiked": dict(wood=shaders.srgb(60, 42, 32), steel=shaders.srgb(66, 69, 78), iron=shaders.srgb(70, 72, 78),  # C2 r7 gunmetal
                   iron_hi=shaders.srgb(200, 200, 206), rust=shaders.srgb(90, 60, 42), rust_amt=0.2,
                   leather_dark=shaders.srgb(36, 26, 20)),
}


def build_one(key, args):
    T0 = time.time()
    asset, fn, tris = WEAPONS[key]
    fast = getattr(args, "fast", False)
    res = 512 if fast else 1024
    meshutil.clear_scene()
    device = pipeline.setup_cycles(getattr(args, "device", "AUTO"))
    S, tip, _ = fn()
    lo_b, hi_b = V(-0.2, -0.2, BOT - 0.06), V(0.2, 0.2, tip + 0.04)
    hi = pipeline.sculpt_mesh(S, asset + "_hi", 0.0011 if fast else 0.0007, lo_b, hi_b)
    lo = pipeline.lowpoly(S, asset + "_lo", 0.0024, tris, lo_b, hi_b, symmetry=False)
    allf = np.ones(len(lo.data.polygons), bool)
    pipeline.smart_project_faces(lo, allf, angle=60.0)
    pipeline.normalize_density(lo, allf, 1.0)
    pipeline.pack_atlas([lo], margin=0.006)
    pal = dict(PALS[key])
    pal.setdefault("leather_dark", shaders.srgb(40, 28, 22))
    shaders.assign_bake_materials(hi, S.materials, prefix=key + "_", kinds=KINDS)
    shaders.paint_mesh(hi, S.materials, {}, pal, {}, painters=PAINTERS)
    B = pipeline.Baker(res, [(lo, [hi], 0.005, 0.014)], shaders.set_pass, [lo], [hi])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                         ("normal", "NORMAL", 8)])
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao_s, ao_l = np.clip(maps["ao"][..., 0], 0, 1), np.clip(maps["ao"][..., 1], 0, 1)
    occl = np.clip(1.0 - 0.7 * (1 - ao_s) - 0.35 * (1 - ao_l), 0, 1)[..., None]
    tint = np.array([0.5, 0.36, 0.3])
    rgb = alb[..., :3] * (tint + (1 - tint) * occl)
    prm = maps["prm"]
    orm = np.stack([np.clip(0.4 + 0.6 * ao_l * ao_s, 0, 1), np.clip(prm[..., 0], 0.05, 1), np.clip(prm[..., 1], 0, 1)], -1)
    rgb, orm, nrm = (pipeline.dilate(x, cov, 12) for x in (rgb, orm, maps["normal"][..., :3]))
    pre = "enemy_marauder_" + asset
    tex = dict(albedo=pipeline.save_png(rgb, os.path.join(OUT_TEX, pre + "_albedo.png"), pre + "_a", "sRGB", True),
               orm=pipeline.save_png(orm, os.path.join(OUT_TEX, pre + "_orm.png"), pre + "_o", "Non-Color"),
               normal=pipeline.save_png(nrm, os.path.join(OUT_TEX, pre + "_normal.png"), pre + "_n", "Non-Color"))
    mat = pipeline.final_material("M_" + asset, tex["albedo"], tex["normal"], tex["orm"])
    lo.data.materials.clear()
    lo.data.materials.append(mat)
    pipeline.strip_for_export(lo)
    bpy.data.objects.remove(hi, do_unlink=True)
    bpy.context.view_layer.update()
    ob = meshutil.join([lo], asset)
    empties = []
    for name, loc in (("grip_main", (0.0, 0.0, 0.0)), ("head_tip", (0.0, 0.0, tip))):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = loc
        e.parent = ob
        empties.append(e)
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, asset + ".glb")
    pipeline.export_glb(out, [ob] + empties, scene_name=asset)
    rep = dict(asset=asset, tris=meshutil.tri_count(ob), res=res, tip=tip, seconds=time.time() - T0, device=device)
    pipeline.log(f"DONE {asset} {rep}")
    return rep


def build(args):
    which = (getattr(args, "which", None) or "club,mace,flanged,spiked").split(",")
    reps = {k: build_one(k, args) for k in which}
    pipeline.write_json(os.path.join(HERE, "out", "marauder_weapons_report.json"), reps)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--which", default=None)
    build(ap.parse_args(argv))
