"""Hollow Knight weapon: a heavy halberd (weapon_halberd.glb), baked with build_weapon_sword_bone.bake_weapon.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_weapon_halberd.py -- [--fast]
Frame: main-hand grip at the origin, haft along +Z (Blender) = +Y glTF, axe edge toward +X (edge direction), flat
facing +-Y. Nodes: grip_main, grip_offhand (y -0.34, toward the butt), head_tip (axe edge centre), blade_tip (top
spike point). Overall ~2.1 m: butt -0.62 .. spike tip +1.5.
Design: dark oak haft with iron langets and a spiked butt cap, leather grip wraps at both hands, a broad bearded
crescent axe (bright steel, dark fuller band, riveted socket), a hooked back-spike and a long diamond top spike;
a tattered cloth pennon under the head.
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
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     RoundCone, RoundBox, Torus, Slab, Displace)

AXE_Z = 1.14
TOP = 1.5
BUTT = -0.62


def cyl_y(c, r, half=0.1):
    """Infinite-ish cylinder along Y (2-D disc in the XZ blade plane once intersected with a slab)."""
    return Capsule(V(c[0], -half, c[2]), V(c[0], half, c[2]), r)


def halberd_sculpt():
    S = Sculpt(materials=W.MATS, default_mat="wood")
    # haft
    S.add(RoundCone(V(0, 0, BUTT + 0.04), V(0, 0, AXE_Z - 0.02), 0.019, 0.017), 0.0, mat="wood")
    # butt cap + spike
    S.add(RoundCone(V(0, 0, BUTT + 0.1), V(0, 0, BUTT + 0.03), 0.021, 0.024), 0.004, mat="iron")
    S.add(RoundCone(V(0, 0, BUTT + 0.03), V(0, 0, BUTT - 0.03), 0.02, 0.004), 0.004, mat="iron")
    # grips (main at origin, off hand at -0.34) with raised binding rings
    for zc in (0.0, -0.34):
        S.add(RoundCone(V(0, 0, zc - 0.07), V(0, 0, zc + 0.07), 0.0205, 0.0205), 0.003, mat="leather")
        for dz in (-0.075, 0.075):
            S.add(Torus(V(0, 0, zc + dz), 0.02, 0.0045), 0.002, mat="leather")
    # socket + langets (iron straps down the haft)
    S.add(RoundCone(V(0, 0, AXE_Z - 0.13), V(0, 0, AXE_Z + 0.16), 0.025, 0.022), 0.004, mat="iron")
    for z in (AXE_Z - 0.12, AXE_Z + 0.15):
        S.add(Torus(V(0, 0, z), 0.026, 0.006), 0.002, mat="iron")
    for sy in (1, -1):
        S.add(RoundBox(V(0, sy * 0.018, AXE_Z - 0.26), V(0.008, 0.004, 0.14), r=0.003), 0.003, mat="iron")
        for z in (AXE_Z - 0.36, AXE_Z - 0.2):
            S.add(Sphere(V(0, sy * 0.022, z), 0.005), 0.001, mat="iron")
    # axe blade: bearded crescent in the XZ plane, lens thickness toward the edge
    shape = Inter(cyl_y(V(-0.07, 0, AXE_Z), 0.27), HalfSpace(V(0.012, 0, 0), V(-1, 0, 0)), k=0.004)
    shape = Diff(shape, Union(cyl_y(V(0.1, 0, AXE_Z + 0.33), 0.19), cyl_y(V(0.13, 0, AXE_Z - 0.34), 0.18)),
                 k=0.006)
    thick = Inter(HalfSpace(V(0.22, 0.0, 0), norm(V(0.055, 1, 0))), HalfSpace(V(0.22, 0.0, 0), norm(V(0.055, -1, 0))))
    blade = Inter(shape, Union(thick, Slab(V(0, 0, 0), V(0, 1, 0), 0.0028), k=0.002), Slab(V(0, 0, 0), V(0, 1, 0), 0.012))
    S.add(blade, 0.004, mat="steel")
    # dark 'fuller' band along the edge curve (raised ridge) + rivets
    for sy in (1, -1):
        S.add(Inter(Diff(cyl_y(V(-0.07, 0, AXE_Z), 0.215), cyl_y(V(-0.07, 0, AXE_Z), 0.2)), shape,
                    Slab(V(0, sy * 0.006, 0), V(0, 1, 0), 0.004), k=0.002), 0.003, mat="steel")
        for dz in (-0.07, 0.07):
            S.add(Sphere(V(0.04, sy * 0.01, AXE_Z + dz), 0.0075), 0.002, mat="iron")
    # hooked back spike
    pts = [V(-0.02, 0, AXE_Z + 0.01), V(-0.09, 0, AXE_Z + 0.0), V(-0.15, 0, AXE_Z - 0.03), V(-0.18, 0, AXE_Z - 0.08)]
    S.add(Chain(pts, [0.02, 0.016, 0.01, 0.0035], squash=(0.45, 1.0), ref=(0, 1, 0)), 0.006, mat="steel")
    # top spike (diamond section)
    z0 = AXE_Z + 0.15
    for n in (norm(V(1, 0.35, 0)), norm(V(-1, 0.35, 0))):
        pass
    S.add(RoundCone(V(0, 0, z0), V(0, 0, TOP), 0.024, 0.002, squash=(0.42, 1.0), ref=(0, 1, 0)), 0.006,
          mat="steel")
    S.add(Ellipsoid(V(0, 0, z0 + 0.01), V(0.032, 0.02, 0.022)), 0.006, mat="iron")
    # tattered pennon under the head (flat, hangs on the -X side of the haft)
    pen = Inter(Slab(V(0, 0, 0), V(0, 1, 0), 0.0035), RoundBox(V(-0.1, 0, AXE_Z - 0.3), V(0.09, 0.02, 0.09),
                                                               r=0.01),
                Union(*[Ellipsoid(V(-0.1 + dx, 0, AXE_Z - 0.2 + dz), V(0.035, 0.1, 0.19))
                        for dx, dz in ((-0.07, -0.02), (-0.02, 0.02), (0.035, -0.04), (0.075, 0.0))], k=0.01),
                k=0.003)
    S.add(Displace(pen, 0.0015, 22.0, 2, seed=7), 0.004, mat="cloth")
    return S


PAL = dict(W.PAL, steel=shaders.srgb(188, 190, 196), rust_amt=0.35, wood=shaders.srgb(70, 46, 30),
           cloth=shaders.srgb(40, 38, 52))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args(argv)
    meshutil.clear_scene()
    S = halberd_sculpt()
    W.bake_weapon(S, "weapon_halberd", V(-0.24, -0.04, BUTT - 0.05), V(0.26, 0.04, TOP + 0.02), 2600, PAL,
                  {"grip_main": V(0, 0, 0), "grip_offhand": V(0, 0, -0.34), "head_tip": V(0.2, 0, AXE_Z),
                   "blade_tip": V(0, 0, TOP)}, fast=a.fast, h_hi=0.0009 if a.fast else 0.0006, density=1.0)


if __name__ == "__main__":
    main()
