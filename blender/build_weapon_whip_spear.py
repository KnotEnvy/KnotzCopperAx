"""Viper Maiden weapon: a segmented whip-spear (weapon_whip_spear.glb), baked with build_weapon_sword_bone.bake_weapon.

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_weapon_whip_spear.py -- [--fast]
Frame: grip at the origin, shaft along +Z (Blender) = +Y glTF, blade flat facing +-Y, edges +-X.
Nodes: grip_main (origin), blade_tip (+1.52). Overall ~1.77 m: rattle butt -0.24 .. blade tip +1.52 (C1 r4: short butt, validate blade-along-+Y).
Design: black-lacquered shaft with emerald cord wraps and bone rings, a snake-tail rattle butt of stacked bone
beads; above the shaft a SEGMENTED whip section -- seven bone vertebra links on iron ring joints in a gentle S (it
reads as the flexible whip-spear, rigid in-game) -- and a wavy serpent (kris) blade in bright steel with a dark
mid-rib, rising out of a bone snake-head socket with two down-curved fangs.
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
                     RoundBox, Torus, Slab, Displace)

BUTT = -0.15             # C1 r4: short rattle butt (validate: pommel <= 0.25 m; was -0.58 -> -0.685 m)
SHAFT_TOP = 0.56
SEG_TOP = 1.04
TIP = 1.52               # unchanged tip/reach (anim blade R 1.5)
MATS = W.MATS + ["bone", "lacquer"]
K_THICK = 1.4            # C1 r4: shaft / vertebrae / head ~40 % thicker above the grip (thin-rod read at game distance)


def spear_sculpt():
    S = Sculpt(materials=MATS, default_mat="lacquer")
    k = K_THICK
    # shaft: grip-radius under the hand (the hand sculpt closes on GRIP_R 1.7 cm), flaring above the grip
    S.add(RoundCone(V(0, 0, BUTT + 0.02), V(0, 0, 0.16), 0.022, 0.022), 0.0, mat="lacquer")
    S.add(RoundCone(V(0, 0, 0.16), V(0, 0, SHAFT_TOP), 0.022 * k, 0.02 * k), 0.012, mat="lacquer")
    # grip: emerald cord wrap between two bone rings
    S.add(RoundCone(V(0, 0, -0.09), V(0, 0, 0.14), 0.0235, 0.0235), 0.002, mat="cloth")
    for i in range(12):
        S.add(Torus(V(0, 0, -0.08 + i * 0.019), 0.0238, 0.0036), 0.0015, mat="cloth")
    S.add(Torus(V(0, 0, -0.105), 0.023, 0.0065), 0.002, mat="bone")
    for z in (0.165, 0.36, SHAFT_TOP - 0.02):
        S.add(Torus(V(0, 0, z), 0.023 * k, 0.0075 * k), 0.002, mat="bone")
    # emerald cord band mid-shaft (colour break so the long shaft reads as a weapon, not a rod)
    for i in range(6):
        S.add(Torus(V(0, 0, 0.42 + i * 0.016), 0.0295, 0.0045), 0.0015, mat="cloth")
    # rattle butt: three stacked bone beads tapering to a short point
    for j in range(3):
        z = BUTT + 0.01 - j * 0.026
        S.add(Ellipsoid(V(0, 0, z), V(0.026 - 0.003 * j, 0.022 - 0.0025 * j, 0.016)), 0.004, mat="bone")
    S.add(RoundCone(V(0, 0, BUTT - 0.06), V(0, 0, BUTT - 0.09), 0.01, 0.002), 0.004, mat="bone")
    # segmented whip section: vertebra links on iron joints along a gentle S curve in the XZ plane
    n = 8
    pts = [V(0.05 * math.sin(i / n * 2 * math.pi), 0, SHAFT_TOP + (SEG_TOP - SHAFT_TOP) * i / n) for i in range(n + 1)]
    for i in range(n):
        a, b = pts[i], pts[i + 1]
        m = (a + b) / 2
        d = norm(b - a)
        S.add(RoundCone(a + d * 0.012, b - d * 0.012, 0.026 * k, 0.021 * k), 0.004, mat="bone")      # vertebra body
        side = norm(np.cross(d, V(0, 1, 0)))
        for sx in (1, -1):                                   # hooked lateral blades (barbed whip links)
            S.add(Chain([m - d * 0.01, m + side * sx * 0.045 - d * 0.004, m + side * sx * 0.066 - d * 0.034],
                        [0.013, 0.008, 0.0016], squash=(0.35, 1.0), ref=(0, 1, 0)), 0.004, mat="steel")
        S.sub(Torus(m, 0.026 * k + 0.001, 0.003), 0.002)                                       # carved groove
        S.add(Torus(a, 0.022 * k, 0.0085 * k), 0.003, mat="iron")                                  # joint ring
    S.add(Torus(pts[-1], 0.023 * k, 0.009 * k), 0.003, mat="iron")
    # snake-head socket + fangs (bigger: the spearhead silhouette must read uncropped at 1600x900)
    h0 = pts[-1] + V(0, 0, 0.045)
    S.add(Ellipsoid(h0, V(0.058, 0.042, 0.062)), 0.01, mat="bone")
    S.add(Ellipsoid(h0 + V(0, 0, 0.055), V(0.042, 0.032, 0.042)), 0.01, mat="bone")
    for sx in (1, -1):
        S.add(Chain([h0 + V(sx * 0.038, 0, 0.045), h0 + V(sx * 0.086, 0, 0.0), h0 + V(sx * 0.09, 0, -0.08)],
                    [0.014, 0.01, 0.0025]), 0.004, mat="bone")
        S.add(Sphere(h0 + V(sx * 0.028, -0.027, 0.026), 0.0085), 0.002, mat="iron")                # eye rivets
    # wavy kris blade (flat in XZ): a Chain of lens sections along a sine centreline, fuller groove
    z0 = h0[2] + 0.065
    L = TIP - z0
    bp = []
    br = []
    for i in range(13):
        f = i / 12
        bp.append(V(0.028 * math.sin(f * 3 * math.pi) * (1 - f), 0, z0 + L * f))
        br.append(0.064 * (1 - f) ** 0.7 * (0.75 + 0.25 * math.sin(min(f * 4, 1) * math.pi / 2)) + 0.002)
    S.add(Chain(bp, br, squash=(0.15, 1.0), ref=(0, 1, 0)), 0.004, mat="steel")
    S.add(Chain(bp[:9], [r * 0.3 for r in br[:9]], squash=(0.5, 1.0), ref=(0, 1, 0)), 0.003, mat="iron")  # dark mid-rib
    for sx in (1, -1):                                        # swept-back barbs at the blade root (spear-head read)
        S.add(Chain([V(sx * 0.04, 0, z0 + 0.02), V(sx * 0.09, 0, z0 - 0.0), V(sx * 0.108, 0, z0 - 0.065)],
                    [0.015, 0.009, 0.0018], squash=(0.2, 1.0), ref=(0, 1, 0)), 0.004, mat="steel")
    # emerald silk streamers tied under the snake head (motion read; rigid but draped)
    for sx, ln in ((1, 0.26), (-1, 0.2)):
        q = [h0 + V(sx * 0.03, 0, -0.05), h0 + V(sx * 0.064, 0.004, -0.11), h0 + V(sx * 0.084, -0.004, -0.11 - ln * 0.6),
             h0 + V(sx * 0.09, 0, -0.11 - ln)]
        S.add(Chain(q, [0.018, 0.022, 0.02, 0.009], squash=(0.18, 1.0), ref=(0, 1, 0)), 0.004, mat="cloth")
    return S


PAL = dict(W.PAL, steel=shaders.srgb(196, 200, 204), rust_amt=0.15, cloth=shaders.srgb(20, 118, 66),
           iron=shaders.srgb(96, 96, 100), bone=shaders.srgb(228, 214, 178), bone_dark=shaders.srgb(110, 92, 64),
           lacquer=shaders.srgb(20, 22, 22))


def p_lacquer(c, pal):
    n1 = c.noise(30.0, 2, 701)
    rgb = np.tile(pal["lacquer"], (c.n, 1)) * (0.9 + 0.2 * n1)[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(80, 84, 80), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, np.clip(0.3 + 0.1 * n1, 0.2, 0.6), 0.0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args(argv)
    import build_enemy_marauder as BM
    meshutil.clear_scene()
    S = spear_sculpt()
    W.bake_weapon(S, "weapon_whip_spear", V(-0.15, -0.07, BUTT - 0.12), V(0.15, 0.07, TIP + 0.02), 2600, PAL,
                  {"grip_main": V(0, 0, 0), "blade_tip": V(0, 0, TIP)}, fast=a.fast,
                  painters={"bone": BM.p_bone, "lacquer": p_lacquer}, h_hi=0.0008 if a.fast else 0.0005,
                  h_lo=0.0014, density=1.2)


if __name__ == "__main__":
    main()
