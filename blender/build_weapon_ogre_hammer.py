"""Ogre Brute weapon: a giant stone-and-iron maul (weapon_ogre_hammer.glb), baked with build_weapon_sword_bone.bake_weapon.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_weapon_ogre_hammer.py -- [--fast]
Frame (FULL game scale, the ogre GLB is exported x1.42): grip at the origin, haft along +Z (Blender) = +Y glTF, striking
faces toward +-X (edge direction), flat +-Y. Haft radius 5.1 cm = the ogre fist (GRIP_R 0.036 x 1.42).
Nodes: grip_main (origin), head_tip (+X striking face centre), blade_tip (top spike point). Overall ~1.6 m:
butt -0.36 .. spike +1.28.
Design: a rough-hewn granite block (chipped corners, fbm-knapped faces) lashed to a gnarled oak haft by two broad
riveted iron straps, iron face-plates bolted on both striking faces, an iron socket collar + stubby top spike,
rawhide grip wrap with a rope binding, heavy iron butt knob with a ring.
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
from lib import meshutil, shaders
from lib.sdf import (V, norm, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff, RoundCone,
                     RoundBox, Torus, Slab, Displace, Offset, Shell)

HEAD_Z = 0.96
BUTT = -0.36
TOP = 1.28
HX, HY, HZ = 0.27, 0.17, 0.19          # stone half extents
MATS = W.MATS + ["stone"]


def chamfered_block(c, hx, hy, hz, ch=0.05, face=0.045, r=0.012):
    """Block along X with its 4 long edges chamfered (octagonal section) and bevelled striking faces."""
    blk = RoundBox(c, V(hx, hy, hz), r=r)
    cut = []
    for sy in (1, -1):
        for sz in (1, -1):                                  # long-edge chamfers
            n = norm(V(0, sy, sz))
            cut.append(HalfSpace(c + V(0, sy * hy, sz * hz) - n * ch * 0.7071, n))
    for sx in (1, -1):                                      # striking-face bevels (raised square face)
        for n0 in (V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)):
            n = norm(V(sx, 0, 0) + n0)
            e = V(sx * hx, 0, 0) + n0 * (hy if abs(n0[1]) else hz)
            cut.append(HalfSpace(c + e - n * face * 0.7071, n))
    return Inter(blk, *cut, k=0.006)


def hammer_sculpt():
    """C1 r3: iron-shod maul -- granite core block between two thick bevelled iron striking caps, a riveted iron
    band round the middle, chamfered edges, leather-wrapped haft with crossed rawhide binding."""
    S = Sculpt(materials=MATS, default_mat="wood")
    # gnarled haft (slight taper, knots)
    S.add(Displace(RoundCone(V(0, 0, BUTT + 0.05), V(0, 0, HEAD_Z), 0.054, 0.047), 0.003, 9.0, 2, seed=3), 0.0,
          mat="wood")
    for z, sx in ((0.42, 1), (0.6, -1)):
        S.add(Ellipsoid(V(sx * 0.04, 0.01, z), V(0.022, 0.02, 0.03)), 0.02, mat="wood")
    # leather grip wrap -0.26..0.3 with a crossed rawhide spiral binding
    S.add(RoundCone(V(0, 0, -0.26), V(0, 0, 0.3), 0.058, 0.056), 0.004, mat="leather")
    for ph, sd in ((0.0, 1), (math.pi, -1)):
        pts = []
        for i in range(57):
            t = i / 56
            z = -0.25 + t * 0.54
            a = ph + sd * t * 2 * math.pi * 6
            pts.append(V(math.cos(a) * 0.059, math.sin(a) * 0.059, z))
        S.add(Chain(pts, [0.0055] * len(pts)), 0.003, mat="cloth")
    for z in (-0.27, 0.31):
        S.add(Torus(V(0, 0, z), 0.06, 0.009), 0.003, mat="cloth")
    # upper haft: rope lashing under the head
    for i in range(5):
        S.add(Torus(V(0, 0, HEAD_Z - HZ - 0.2 + i * 0.022), 0.052, 0.0075), 0.003, mat="cloth")
    S.add(Ellipsoid(V(0, 0, BUTT + 0.06), V(0.075, 0.075, 0.07)), 0.01, mat="iron")
    S.add(Torus(V(0, 0, BUTT + 0.1), 0.06, 0.01), 0.004, mat="iron")
    S.add(Torus(V(0, 0, BUTT - 0.0), 0.035, 0.009, np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)), 0.004,
          mat="iron")
    c = V(0, 0, HEAD_Z)
    # granite core (chamfered, knapped)
    core = chamfered_block(c, HX - 0.03, HY, HZ, ch=0.06, face=0.02)
    S.add(Displace(core, 0.008, 7.0, 3, seed=11), 0.0, mat="stone")
    # C1 r4: no knapped scoops on the broad cheeks (the two 0.2 m sphere cuts read as concave dents from every
    # camera); flat worn faces, small chips knocked out of the chamfered edges instead
    for sy in (1, -1):
        for dx, dz, r in ((0.12, HZ, 0.022), (-0.15, -HZ, 0.018), (0.05, -HZ, 0.014), (-0.06, HZ, 0.016)):
            S.sub(Sphere(V(dx, sy * HY, HEAD_Z + dz), r), 0.006, mat="stone")
    # iron striking caps: thick, chamfered, bevelled faces, studded rim
    for sx in (1, -1):
        cc = V(sx * (HX - 0.035), 0, HEAD_Z)
        cap = Inter(chamfered_block(c, HX + 0.012, HY + 0.014, HZ + 0.014, ch=0.07, face=0.05, r=0.008),
                    Slab(cc, V(1, 0, 0), 0.05), k=0.004)
        S.add(Displace(cap, 0.0015, 22.0, 2, seed=13 + sx), 0.004, mat="iron")
        # C1 r4 (board r3: the inset panel read as a concave dent = modelling error): a CROWNED striking face --
        # a low convex dome ~9 mm proud of the bevelled cap, worn flat at the centre, with a few peened chips
        fx = sx * (HX + 0.012)
        crown = Inter(Ellipsoid(V(fx - sx * 0.024, 0, HEAD_Z), V(0.033, HY - 0.03, HZ - 0.03)),
                      HalfSpace(V(fx - sx * 0.004, 0, HEAD_Z), V(-sx, 0, 0)),
                      HalfSpace(V(fx + sx * 0.0075, 0, HEAD_Z), V(sx, 0, 0)), k=0.003)
        S.add(Displace(crown, 0.0012, 26.0, 2, seed=31 + sx), 0.007, mat="iron")
        for y, z, r in ((0.09, 0.11, 0.011), (-0.11, -0.06, 0.009), (0.12, -0.12, 0.008), (-0.05, 0.14, 0.007)):
            S.sub(Sphere(V(fx + sx * 0.011, y, HEAD_Z + z), r), 0.003, mat="iron")    # peened chips at the rim
        for y, z in ((HY + 0.014, 0.1), (HY + 0.014, -0.1), (-HY - 0.014, 0.1), (-HY - 0.014, -0.1),
                     (0.08, HZ + 0.014), (-0.08, HZ + 0.014), (0.08, -HZ - 0.014), (-0.08, -HZ - 0.014)):
            S.add(Sphere(V(sx * (HX - 0.06), y, HEAD_Z + z), 0.013), 0.002, mat="iron")
    # riveted iron band round the middle
    band = Inter(Diff(chamfered_block(c, 0.2, HY + 0.018, HZ + 0.018, ch=0.075, face=0.0, r=0.006),
                      chamfered_block(c, 0.3, HY - 0.01, HZ - 0.01, ch=0.06, face=0.0)), Slab(c, V(1, 0, 0), 0.04),
                 k=0.003)
    S.add(band, 0.003, mat="iron")
    for x in (-0.022, 0.022):
        for y, z in ((HY + 0.018, 0.09), (HY + 0.018, -0.09), (-HY - 0.018, 0.09), (-HY - 0.018, -0.09),
                     (0.07, HZ + 0.018), (-0.07, HZ + 0.018), (0.07, -HZ - 0.018), (-0.07, -HZ - 0.018)):
            S.add(Sphere(V(x, y, HEAD_Z + z), 0.0105), 0.002, mat="iron")
    # socket collar under / over the head, stubby top spike
    S.add(RoundCone(V(0, 0, HEAD_Z - HZ - 0.12), V(0, 0, HEAD_Z - HZ + 0.02), 0.062, 0.07), 0.006, mat="iron")
    S.add(Torus(V(0, 0, HEAD_Z - HZ - 0.1), 0.062, 0.011), 0.003, mat="iron")
    S.add(RoundCone(V(0, 0, HEAD_Z + HZ - 0.02), V(0, 0, HEAD_Z + HZ + 0.05), 0.07, 0.05), 0.006, mat="iron")
    S.add(RoundCone(V(0, 0, HEAD_Z + HZ + 0.04), V(0, 0, TOP), 0.04, 0.004), 0.006, mat="iron")
    return S


def p_stone(c, pal):
    """Weathered granite: speckled mid-grey with warm lichen/dirt blotches, pale chipped ridges, dark cracks."""
    n1 = c.noise(6.0, 3, 601)
    n2 = c.noise(120.0, 1, 602)
    n3 = c.noise(18.0, 2, 603)
    rgb = np.tile(pal["stone"], (c.n, 1)) * (0.9 + 0.14 * n1)[:, None]
    rgb = shaders.mix(rgb, pal["stone_dark"], 0.35 * shaders.smooth01(n2, 0.3, 0.7))
    rgb = shaders.mix(rgb, np.minimum(pal["stone"] * 1.3, 1), 0.3 * shaders.smooth01(n2, -0.7, -0.4))
    rgb = shaders.mix(rgb, pal["stone_moss"], 0.35 * shaders.smooth01(n3, 0.35, 0.8))
    rgb = shaders.mix(rgb, np.minimum(pal["stone"] * 1.3 + 0.03, 1), 0.3 * c.ridge)
    rgb = shaders.mix(rgb, pal["stone_dark"] * 0.5, 0.8 * c.cav)
    rgb = shaders.mix(rgb, shaders.srgb(70, 30, 22), 0.25 * shaders.smooth01(c.noise(9.0, 2, 604), 0.55, 0.85))  # old blood
    return shaders.out(c.n, rgb, np.clip(0.78 + 0.1 * n1 - 0.15 * c.ridge, 0.4, 0.95), 0.0)


PAL = dict(W.PAL, wood=shaders.srgb(92, 62, 40), leather=shaders.srgb(84, 56, 36), leather_worn=shaders.srgb(140, 104, 70),
           cloth=shaders.srgb(170, 146, 104), iron=shaders.srgb(96, 94, 92), iron_patina=shaders.srgb(118, 70, 40),
           iron_patina_amt=0.6, stone=shaders.srgb(82, 78, 72), stone_dark=shaders.srgb(40, 38, 36),
           stone_moss=shaders.srgb(96, 104, 64))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args(argv)
    import build_enemy_skeleton as BS
    meshutil.clear_scene()
    S = hammer_sculpt()
    W.bake_weapon(S, "weapon_ogre_hammer", V(-0.36, -0.26, BUTT - 0.06), V(0.36, 0.26, TOP + 0.02), 2600, PAL,
                  {"grip_main": V(0, 0, 0), "head_tip": V(HX + 0.02, 0, HEAD_Z), "blade_tip": V(0, 0, TOP)},
                  fast=a.fast, painters={"stone": p_stone, "iron": BS.p_iron},
                  h_hi=0.0018 if a.fast else 0.0011, h_lo=0.003, density=1.0)


if __name__ == "__main__":
    main()
