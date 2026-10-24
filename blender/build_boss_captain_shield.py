"""Hollow Knight Captains' TOWER SHIELD (C2 r12, Enemy Art C) -> public/assets/models/boss_captain_shield_<tier>.glb
(+ public/assets/textures/boss_captain_shield_<tier>_*.png), tiers patina (crimson field, rusted iron rim, bronze
trident) and oxide (black-violet field, gilded rim + trident).

    node tools/blender-run.mjs --what "captain shield" --owner bosses -- -b --factory-startup -P blender/build_boss_captain_shield.py -- [--fast] [--only patina,oxide]

Ref docs/refs/c2/bosses/hollow_knight_captain.png: a tall rusted tower shield carried on the left side, slightly
curved face, riveted iron rim, a raised trident emblem down the middle, worn/chipped paint, dents.
Baked with build_weapon_sword_bone.bake_weapon (imported, not edited), FULL game scale for the native ~3 m captain
GLBs (like boss_captain_halberd_*): 1.55 m tall x 0.80 m wide.

FRAME (Blender; glTF = Y up, so Blender +Z -> glTF +Y, Blender -Y -> glTF +Z):
  origin            = centre of the vertical HANDLE bar (the left fist closes round it, like a weapon grip_main)
  handle axis       = +Z Blender  (= +Y glTF), same as a weapon's haft
  shield FACE       = toward +X   (emblem side; the board sits 8 cm in front of the handle, the forearm points -X)
  long axis         = Z: top edge +0.75 m, bottom point -0.80 m (grip slightly above the middle)
Nodes (glTF empties, children of the mesh): grip_shield (0,0,0), face_centre (face, +X), shield_top, shield_bottom,
arm_strap (where a forearm crossing the back would rest, -X of the grip).
"""
import os
import sys
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib

import numpy as np
import build_weapon_sword_bone as W
importlib.reload(W)
from lib import meshutil, shaders, sdf
from lib.sdf import (V, norm, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff, RoundCone,
                     RoundBox, Torus, Slab, Offset, Displace)

RC_ = 0.95                  # face curvature radius (cylinder about Z)
CX = -0.835                 # cylinder axis x: outer face at x = CX + RC_ = 0.115 on the centre line
T_FACE, T_WOOD = 0.013, 0.022
TOP, BOT, HALF_W = 0.75, -0.80, 0.40
MATS = W.MATS + ["field"]


def face_x(y, r=RC_):
    """x of the cylinder surface of radius r at lateral offset y."""
    return CX + math.sqrt(max(r * r - y * y, 1e-6))


def cylz(r):
    return Capsule(V(CX, 0, -3.0), V(CX, 0, 3.0), r)


def outline(inset=0.0):
    """Tower/kite outline, extruded along X: arched top, slightly tapering sides, pointed bottom."""
    w0, w1 = HALF_W - inset, HALF_W - 0.04 - inset
    top = Capsule(V(-3, 0, TOP - 2.6 - inset), V(3, 0, TOP - 2.6 - inset), 2.6)          # gentle arch
    hs = [top]
    for s in (1, -1):
        hs.append(HalfSpace(V(0, s * w0, 0.3), norm(V(0, s, -0.06))))                       # sides, tapering down
        hs.append(HalfSpace(V(0, s * w1, -0.25), norm(V(0, s, -w1 / (-0.25 - BOT - inset)))))   # lower point
    hs.append(HalfSpace(V(0, 0, BOT + inset), V(0, 0, -1)))
    return Inter(*hs, k=0.03)


def outline_pts(n=40, inset=0.03):
    """Points round the rim (y, z) for rivets: sample the outline SDF boundary by marching rays from the centre."""
    O = outline(inset)
    pts = []
    for a in np.linspace(0, 2 * math.pi, n, endpoint=False):
        d = np.array([0.0, math.sin(a), math.cos(a)])
        lo_, hi_ = 0.0, 1.2
        for _ in range(30):
            m = (lo_ + hi_) / 2
            p = d * m + np.array([0, 0, -0.05])
            v = O.d(np.array([0.0]), np.array([p[1]]), np.array([p[2]]))[0]
            if v < 0:
                lo_ = m
            else:
                hi_ = m
        p = d * lo_ + np.array([0, 0, -0.05])
        pts.append((float(p[1]), float(p[2])))
    return pts


def on_face(y, z, lift=0.0):
    return V(face_x(y) + lift, y, z)


def trident(S, mat):
    """Raised trident emblem following the curved face."""
    L = 0.012
    shaft = [on_face(0, z, L) for z in np.linspace(-0.58, 0.30, 8)]
    S.add(Chain(shaft, [0.022, 0.02, 0.019, 0.019, 0.019, 0.02, 0.021, 0.022], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.006, mat=mat)
    S.add(Chain([on_face(0, 0.28, L), on_face(0, 0.44, L), on_face(0, 0.54, L)], [0.024, 0.016, 0.003], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.004, mat=mat)
    for s in (1, -1):
        tine = [on_face(0.0, 0.29, L), on_face(0.11 * s, 0.30, L), on_face(0.16 * s, 0.38, L), on_face(0.165 * s, 0.47, L)]
        S.add(Chain(tine, [0.02, 0.018, 0.014, 0.003], squash=(0.45, 1.0), ref=(1, 0, 0), k=0.006), 0.004, mat=mat)
        S.add(Chain([on_face(0.165 * s, 0.45, L), on_face(0.135 * s, 0.42, L)], [0.012, 0.003], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.003, mat=mat)  # barb
    S.add(Chain([on_face(-0.12, 0.24, L), on_face(0, 0.235, L), on_face(0.12, 0.24, L)], [0.016, 0.02, 0.016], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.004, mat=mat)
    S.add(Torus(on_face(0, -0.62, L), 0.045, 0.011, basis(V(1, 0, 0))), 0.004, mat=mat)                     # pommel ring
    for s in (1, -1):                                                                                     # pommel flukes
        S.add(Chain([on_face(0.0, -0.50, L), on_face(0.06 * s, -0.56, L), on_face(0.075 * s, -0.64, L)], [0.016, 0.012, 0.003],
                    squash=(0.45, 1.0), ref=(1, 0, 0)), 0.004, mat=mat)


def shield_sculpt(v):
    gilt = v == "oxide"
    S = Sculpt(materials=MATS, default_mat="field")
    O = outline()
    S.add(Inter(Diff(cylz(RC_), cylz(RC_ - T_FACE)), O), 0.0, mat="field")                              # painted iron face
    S.add(Inter(Diff(cylz(RC_ - T_FACE + 0.001), cylz(RC_ - T_FACE - T_WOOD)), outline(0.006)), 0.002, mat="wood")   # plank core
    rim_band = Diff(O, outline(0.05), k=0.004)
    S.add(Inter(Diff(cylz(RC_ + 0.012), cylz(RC_ - T_FACE - T_WOOD - 0.012)), rim_band), 0.004, mat="bronze" if gilt else "steel")
    for (y, z) in outline_pts(46, 0.026):                                                                 # rim rivets
        S.add(Sphere(on_face(y, z, 0.012), 0.0115), 0.002, mat="iron")
    # second (inner) band of studs + horizontal straps on the face (iron, like the ref's riveted bands)
    for zz in (0.08, -0.36):
        band = Inter(Diff(cylz(RC_ + 0.006), cylz(RC_ - 0.004)), outline(0.04), Slab(V(0, 0, zz), V(0, 0, 1), 0.018))
        S.add(band, 0.003, mat="bronze" if gilt else "steel")
        for y in np.linspace(-0.3, 0.3, 7):
            if abs(y) < 0.05:
                continue
            S.add(Sphere(on_face(y, zz, 0.008), 0.009), 0.002, mat="iron")
    trident(S, "bronze")
    # battle damage: dents on the face + a hacked notch in the rim
    rng = np.random.default_rng(5 if gilt else 3)
    for _ in range(9):
        y = float(rng.uniform(-0.3, 0.3)); z = float(rng.uniform(-0.6, 0.6))
        S.sub(Sphere(on_face(y, z, 0.05 + 0.0), 0.055), 0.006)
    S.sub(Ellipsoid(V(face_x(HALF_W) - 0.01, HALF_W - 0.01, 0.42), V(0.08, 0.035, 0.03)), 0.004)
    S.sub(Ellipsoid(V(face_x(-0.33) + 0.02, -0.34, -0.42), V(0.07, 0.03, 0.022)), 0.004)
    # back: vertical handle bar (leather wrap) on two iron brackets, two horizontal iron battens, arm strap
    S.add(Capsule(V(0, 0, -0.1), V(0, 0, 0.1), 0.02), 0.0, mat="leather")
    for z in (-0.115, 0.115):
        S.add(RoundBox(V(0.045, 0, z), V(0.05, 0.018, 0.014), r=0.006), 0.004, mat="iron")
    back = face_x(0, RC_ - T_FACE - T_WOOD)
    for z in (0.42, -0.42):
        S.add(Inter(Diff(cylz(RC_ - T_FACE - T_WOOD + 0.001), cylz(RC_ - T_FACE - T_WOOD - 0.02)), outline(0.05),
                    Slab(V(0, 0, z), V(0, 0, 1), 0.03)), 0.003, mat="iron")
    S.add(Inter(Diff(cylz(RC_ - T_FACE - T_WOOD + 0.001), cylz(RC_ - T_FACE - T_WOOD - 0.012)), outline(0.08),
                Slab(V(0, 0, -0.22), V(0, 0, 1), 0.035)), 0.003, mat="leather")
    lo = V(-0.05, -HALF_W - 0.03, BOT - 0.03)
    hi = V(face_x(0) + 0.04, HALF_W + 0.03, TOP + 0.03)
    nodes = {"grip_shield": V(0, 0, 0), "face_centre": V(face_x(0) + 0.012, 0, 0), "shield_top": V(face_x(0), 0, TOP),
             "shield_bottom": V(face_x(0), 0, BOT), "arm_strap": V(back - 0.05, 0, -0.22)}
    return S, lo, hi, nodes


def cn(c, freq, octaves=3, seed=0):
    """c.noise() is centred on 0 (~-0.7..0.35): remap to ~0..1."""
    return np.clip(0.5 + 0.7 * c.noise(freq, octaves, seed), 0.0, 1.0)


def p_field(c, pal):
    """Chipped enamel over rusted iron: faded dye with value noise, chips to rust on ridges/edges, rust streaks running
    down, dark grime and moss-green verdigris collecting low and in the dents."""
    P = c.P
    n1 = cn(c, 5.0, 3, 501)
    n2 = cn(c, 34.0, 2, 502)
    streak = np.clip(0.5 + 0.7 * sdf.fbm(P[:, 0] * 30.0, P[:, 1] * 30.0, P[:, 2] * 3.5, 3, 1.0, seed=503), 0, 1)
    base = np.asarray(pal["field"]) * (0.78 + 0.34 * n1)[:, None]
    chip = shaders.smooth01(n2 + 0.5 * c.ridge + 0.2 * n1, 0.72, 0.8)
    rgb = shaders.mix(base, pal["steel_rust"] * (0.75 + 0.3 * n2)[:, None], chip)
    rgb = shaders.mix(rgb, pal["steel_rust"] * 0.75, 0.38 * shaders.smooth01(streak, 0.55, 0.8) * (1 - chip))
    low = shaders.smooth01(-P[:, 2], 0.1, 0.8)
    rgb = shaders.mix(rgb, rgb * 0.45, 0.45 * low * shaders.smooth01(cn(c, 8.0, 2, 504), 0.4, 0.7))
    moss = shaders.smooth01(cn(c, 11.0, 3, 505), 0.6, 0.75) * np.clip(shaders.smooth01(c.cav, 0.02, 0.3) + 0.4 * low, 0, 1)
    rgb = shaders.mix(rgb, pal.get("moss", shaders.srgb(70, 84, 40)), 0.55 * moss)
    rough = 0.6 + 0.25 * chip - 0.1 * n1
    return shaders.out(c.n, rgb, np.clip(rough, 0.3, 0.95), 0.55 * chip)


PAL = {
    "patina": dict(W.PAL, field=shaders.srgb(122, 26, 26), steel=shaders.srgb(132, 128, 126), steel_rust=shaders.srgb(118, 62, 30),
                   rust_amt=0.7, iron=shaders.srgb(86, 80, 76), iron_patina=shaders.srgb(110, 58, 30), iron_patina_amt=0.7,
                   bronze=shaders.srgb(176, 126, 58), bronze_patina=shaders.srgb(70, 88, 64), wood=shaders.srgb(70, 46, 30),
                   leather=shaders.srgb(58, 32, 22), moss=shaders.srgb(72, 86, 40)),
    "oxide": dict(W.PAL, field=shaders.srgb(44, 28, 52), steel=shaders.srgb(150, 150, 156), steel_rust=shaders.srgb(104, 58, 32),
                  rust_amt=0.45, iron=shaders.srgb(70, 66, 70), iron_patina=shaders.srgb(96, 58, 34), iron_patina_amt=0.5,
                  bronze=shaders.srgb(222, 170, 70), bronze_patina=shaders.srgb(110, 84, 40), wood=shaders.srgb(50, 34, 28),
                  leather=shaders.srgb(44, 26, 34), moss=shaders.srgb(64, 78, 44)),
}
shaders.MICRO["field"] = "hammered"


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--only", default="patina,oxide")
    a = ap.parse_args(argv)
    for v in a.only.split(","):
        meshutil.clear_scene()
        S, lo, hi, nodes = shield_sculpt(v)
        W.bake_weapon(S, "boss_captain_shield_" + v, lo, hi, 3400, PAL[v], nodes, fast=a.fast,
                      painters={"field": p_field}, h_hi=0.0024 if a.fast else 0.0013, h_lo=0.004, density=1.0)


if __name__ == "__main__":
    main()
