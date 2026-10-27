"""Boss weapons: Morvane's serpent great-axe + Varkhul's flail (haft + spiked ball; the chain is built at runtime).

Usage: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_boss_weapons.py -- [--fast] [--only axe,flail,ball,hammer_gor,hammer_mog,halberd_patina,halberd_oxide]
Brute Brothers hammers (boss_brute_hammer_gor/mog.glb) are at FULL game scale (see their section).
Outputs public/assets/models/boss_morvane_axe.glb, boss_varkhul_flail.glb, boss_varkhul_ball.glb (+ textures
public/assets/textures/boss_*). Baked with build_weapon_sword_bone.bake_weapon (imported, not edited).
Frame (all): main-hand grip at the origin, haft along +Z (Blender) = +Y glTF, edge toward +X, flat facing +-Y.
Sizes are at the 2.0 m reference rig (the game scales the bosses ×1.5 / ×1.3, the weapon rides the hand socket).

Axe (~1.45 m ref → ~2.2 m in game): blackened oak haft wrapped by a bronze serpent whose head bites the socket,
leather grips at both hands (off hand −0.32), a colossal bearded crescent blade (dark green-black steel, bright
honed edge, raised fuller band, verdigris in the cavities), a hooked back-fang, a top spike and a bronze skull pommel.
Flail: iron-shod haft with brass bands, a ring eye at the top (head_tip = chain anchor). Ball: a flanged spiked iron
morning-star head with a ring (ring_tip at +Z = chain end).
"""
import os
import sys
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib

import build_weapon_sword_bone as W
importlib.reload(W)
from lib import meshutil, shaders
from lib.sdf import (V, norm, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff, RoundCone,
                     RoundBox, Torus, Slab, Displace)

AXE_Z = 0.98
TOP = 1.3
BUTT = -0.42


def cyl_y(c, r, half=0.1):
    return Capsule(V(c[0], -half, c[2]), V(c[0], half, c[2]), r)


def axe_sculpt():
    S = Sculpt(materials=W.MATS, default_mat="wood")
    S.add(RoundCone(V(0, 0, BUTT + 0.05), V(0, 0, AXE_Z - 0.02), 0.024, 0.021), 0.0, mat="wood")
    # skull-ish pommel (bronze) + butt spike
    S.add(Ellipsoid(V(0, 0, BUTT + 0.02), V(0.036, 0.034, 0.042)), 0.006, mat="bronze")
    S.add(RoundCone(V(0, 0, BUTT - 0.01), V(0, 0, BUTT - 0.09), 0.02, 0.003), 0.004, mat="iron")
    for sy in (1, -1):
        S.sub(Sphere(V(0.03, sy * 0.013, BUTT + 0.03), 0.009), 0.003, mat="bronze")          # eye sockets
    # grips
    for zc in (0.0, -0.32):
        S.add(RoundCone(V(0, 0, zc - 0.08), V(0, 0, zc + 0.08), 0.0255, 0.0255), 0.003, mat="leather")
        for dz in (-0.085, 0.085):
            S.add(Torus(V(0, 0, zc + dz), 0.025, 0.006), 0.002, mat="bronze")
    # bronze serpent coiling up the haft between the grips and the head
    pts = []
    for i in range(22):
        t = i / 21
        a = t * math.pi * 5.0
        pts.append(V(math.cos(a) * 0.03, math.sin(a) * 0.03, 0.12 + t * (AXE_Z - 0.3)))
    S.add(Displace(Chain(pts, [0.009 + 0.004 * math.sin(math.pi * i / 21) for i in range(22)]), 0.0008, 120.0, 1, seed=3),
          0.004, mat="bronze")
    hc = V(0.034, 0, AXE_Z - 0.15)
    S.add(Ellipsoid(hc, V(0.028, 0.02, 0.022)), 0.005, mat="bronze")                          # serpent head
    S.add(RoundCone(hc, hc + V(0.02, 0, 0.03), 0.016, 0.006), 0.004, mat="bronze")
    # socket + langets
    S.add(RoundCone(V(0, 0, AXE_Z - 0.16), V(0, 0, AXE_Z + 0.2), 0.032, 0.028), 0.004, mat="iron")
    for z in (AXE_Z - 0.15, AXE_Z + 0.19):
        S.add(Torus(V(0, 0, z), 0.033, 0.007), 0.002, mat="bronze")
    # colossal bearded crescent blade in the XZ plane (lens thickness toward the edge)
    shape = Inter(cyl_y(V(-0.1, 0, AXE_Z), 0.42), HalfSpace(V(0.016, 0, 0), V(-1, 0, 0)), k=0.004)
    shape = Diff(shape, Union(cyl_y(V(0.12, 0, AXE_Z + 0.5), 0.28), cyl_y(V(0.16, 0, AXE_Z - 0.52), 0.27)), k=0.008)
    thick = Inter(HalfSpace(V(0.31, 0.0, 0), norm(V(0.06, 1, 0))), HalfSpace(V(0.31, 0.0, 0), norm(V(0.06, -1, 0))))
    blade = Inter(shape, Union(thick, Slab(V(0, 0, 0), V(0, 1, 0), 0.0035), k=0.002), Slab(V(0, 0, 0), V(0, 1, 0), 0.016))
    S.add(blade, 0.004, mat="steel")
    for sy in (1, -1):
        S.add(Inter(Diff(cyl_y(V(-0.1, 0, AXE_Z), 0.34), cyl_y(V(-0.1, 0, AXE_Z), 0.32)), shape,
                    Slab(V(0, sy * 0.008, 0), V(0, 1, 0), 0.005), k=0.002), 0.003, mat="steel")
        S.add(Inter(Diff(cyl_y(V(-0.1, 0, AXE_Z), 0.25), cyl_y(V(-0.1, 0, AXE_Z), 0.2)), shape,
                    Slab(V(0, sy * 0.009, 0), V(0, 1, 0), 0.004), k=0.002), 0.003, mat="bronze")   # etched gold band
        for dz in (-0.1, 0.0, 0.1):
            S.add(Sphere(V(0.06, sy * 0.013, AXE_Z + dz), 0.009), 0.002, mat="bronze")
        S.sub(Inter(Sphere(V(0.2, 0, AXE_Z + 0.02), 0.03), Slab(V(0, sy * 0.012, 0), V(0, 1, 0), 0.006)), 0.003,
              mat="steel")                                                                         # serpent-eye piercing
    # hooked back fang
    pts = [V(-0.03, 0, AXE_Z + 0.02), V(-0.12, 0, AXE_Z + 0.0), V(-0.2, 0, AXE_Z - 0.05), V(-0.24, 0, AXE_Z - 0.13)]
    S.add(Chain(pts, [0.026, 0.02, 0.012, 0.004], squash=(0.45, 1.0), ref=(0, 1, 0)), 0.006, mat="steel")
    z0 = AXE_Z + 0.19
    S.add(RoundCone(V(0, 0, z0), V(0, 0, TOP), 0.03, 0.003, squash=(0.42, 1.0), ref=(0, 1, 0)), 0.006, mat="steel")
    S.add(Ellipsoid(V(0, 0, z0 + 0.01), V(0.04, 0.026, 0.028)), 0.006, mat="bronze")
    return S


def flail_sculpt():
    """C2 r13 (ref varkhul.png: the chain leaves the fist): a SHORT blackened-iron grip -- leather-wrapped haft under the
    fist, gold bands, a flanged pommel, and a heavy collar + forged ring at head_tip (+0.24 m) where the runtime chain
    hangs. grip_main = origin (unchanged contract)."""
    S = Sculpt(materials=W.MATS, default_mat="iron")
    S.add(RoundCone(V(0, 0, -0.15), V(0, 0, 0.17), 0.026, 0.028), 0.0, mat="iron")
    S.add(RoundCone(V(0, 0, -0.09), V(0, 0, 0.09), 0.03, 0.03), 0.003, mat="leather")
    for z in (-0.095, 0.095):
        S.add(Torus(V(0, 0, z), 0.031, 0.007), 0.002, mat="bronze")
    S.add(Ellipsoid(V(0, 0, -0.165), V(0.042, 0.042, 0.03)), 0.006, mat="bronze")             # pommel
    for a in range(4):                                                                       # pommel flanges
        d = V(math.cos(a * math.pi / 2 + 0.785), math.sin(a * math.pi / 2 + 0.785), 0)
        S.add(RoundCone(V(0, 0, -0.165) + d * 0.03, V(0, 0, -0.2) + d * 0.045, 0.012, 0.004), 0.004, mat="bronze")
    S.add(RoundCone(V(0, 0, 0.13), V(0, 0, 0.2), 0.036, 0.03), 0.004, mat="iron")             # collar
    S.add(Torus(V(0, 0, 0.165), 0.037, 0.0075), 0.002, mat="bronze")
    S.add(Torus(V(0, 0, 0.228), 0.03, 0.011, M=SWAP_XZ), 0.003, mat="iron")                  # forged ring
    return S


SWAP_XZ = [[0, 0, 1], [0, 1, 0], [1, 0, 0]]
BALL_C = -0.27          # C2 r13: centre node (ring_tip stays at the origin)


def ball_sculpt():
    """C2 r13 (ref varkhul.png): a BIG blackened-iron ball (r 0.17 at the 2 m reference, ~1.45x the r1 ball) with 22
    heavy four-sided spikes on raised gold collars, two riveted gold bands, a forged neck + ring at the origin."""
    S = Sculpt(materials=W.MATS, default_mat="iron")
    c = V(0, 0, BALL_C)
    R = 0.17
    S.add(Displace(Sphere(c, R), 0.0025, 18.0, 2, seed=5), 0.0, mat="iron")
    for sy in (1, -1):                                                                      # riveted bands
        nb = norm(V(0, 1, 0.35 * sy))
        S.add(Inter(Sphere(c, R + 0.009), Slab(c, nb, 0.013)), 0.004, mat="bronze")
        for i in range(10):
            a = i / 10 * 2 * math.pi
            M = basis(nb)
            d = norm(M[:, 1] * math.cos(a) + M[:, 2] * math.sin(a))
            S.add(Sphere(c + d * (R + 0.01), 0.008), 0.002, mat="bronze")
    phi = (1 + 5 ** 0.5) / 2
    n = 22
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = 2 * math.pi * i / phi
        d = norm(V(math.cos(a) * r, math.sin(a) * r, z))
        if d[2] > 0.8:
            continue
        S.add(Inter(Sphere(c, R + 0.018), Capsule(c, c + d * 0.4, 0.05)), 0.006, mat="bronze")   # gold collar
        M = basis(d)
        tip = c + d * (R + 0.13)
        base = c + d * (R + 0.008)
        sp = Inter(RoundCone(base, tip, 0.05, 0.002),
                   *[HalfSpace(base + (M[:, 1] * math.cos(k * math.pi / 2) + M[:, 2] * math.sin(k * math.pi / 2)) * 0.033,
                               norm((M[:, 1] * math.cos(k * math.pi / 2) + M[:, 2] * math.sin(k * math.pi / 2)) + d * 0.3))
                     for k in range(4)], k=0.003)
        S.add(sp, 0.006, mat="steel")
    S.add(RoundCone(c + V(0, 0, R - 0.02), V(0, 0, -0.045), 0.05, 0.034), 0.006, mat="iron")    # neck
    S.add(Torus(V(0, 0, -0.06), 0.04, 0.008), 0.002, mat="bronze")
    S.add(Torus(V(0, 0, -0.026), 0.026, 0.0095, M=SWAP_XZ), 0.003, mat="iron")                 # ring (top ~ origin)
    return S


PAL_AXE = dict(W.PAL, steel=shaders.srgb(96, 108, 102), steel_rust=shaders.srgb(56, 108, 78), rust_amt=0.4,
               wood=shaders.srgb(38, 30, 26), leather=shaders.srgb(56, 40, 30), bronze=shaders.srgb(182, 140, 64),
               bronze_patina=shaders.srgb(60, 96, 70), iron=shaders.srgb(72, 76, 74))
PAL_FLAIL = dict(W.PAL, steel=shaders.srgb(84, 80, 80), steel_rust=shaders.srgb(96, 54, 28), rust_amt=0.3,
                 wood=shaders.srgb(62, 42, 30), bronze=shaders.srgb(216, 160, 62), bronze_patina=shaders.srgb(96, 66, 30),
                 bronze_patina_amt=0.25, iron=shaders.srgb(50, 48, 50), iron_patina=shaders.srgb(92, 54, 30),
                 iron_patina_amt=0.35, leather=shaders.srgb(70, 42, 28))   # C2 r13: blackened iron + gold (Varkhul ref)


# ============================================================================ Brute Brothers hammers (FULL game scale)
# The brute GLBs are exported natively (x1.60 / x1.55 applied), so these are at game scale like weapon_ogre_hammer:
# grip at the origin, haft +Z, striking faces +-X. Haft radius 5.7 cm = GRIP_R 0.036 x 1.58.
HB_HEAD = 1.1
HB_BUTT = -0.4
HB_TOP = 1.46


def _haft(S, top_z, r0=0.06, r1=0.053, seed=5):
    S.add(Displace(RoundCone(V(0, 0, HB_BUTT + 0.06), V(0, 0, top_z), r0, r1), 0.0035, 8.0, 2, seed=seed), 0.0,
          mat="wood")
    for z, sx in ((0.34, 1), (0.6, -1)):
        S.add(Ellipsoid(V(sx * 0.05, 0.01, z), V(0.024, 0.022, 0.034)), 0.02, mat="wood")
    S.add(RoundCone(V(0, 0, -0.23), V(0, 0, 0.23), 0.062, 0.062), 0.004, mat="leather")          # rawhide grip
    for i in range(7):
        S.add(Torus(V(0, 0, -0.21 + i * 0.07), 0.063, 0.0065), 0.003, mat="cloth")
    S.add(Ellipsoid(V(0, 0, HB_BUTT + 0.07), V(0.085, 0.085, 0.08)), 0.012, mat="iron")          # pommel knob
    S.add(Torus(V(0, 0, HB_BUTT + 0.12), 0.066, 0.011), 0.004, mat="iron")
    for a in range(6):
        t = a / 6 * 2 * math.pi
        S.add(RoundCone(V(0.07 * math.cos(t), 0.07 * math.sin(t), HB_BUTT + 0.06),
                        V(0.1 * math.cos(t), 0.1 * math.sin(t), HB_BUTT + 0.03), 0.014, 0.003), 0.004, mat="iron")


def stone_hammer_sculpt(bro):
    """C2 r18: quarried stone block, battered corners, cracks and riveted forged hoops.
    Grip, haft length, hit-tip nodes and existing animation timing are unchanged.
    """
    S = Sculpt(materials=W.MATS + ["stone"], default_mat="wood")
    hx,hy,hz = (0.365,0.215,0.250) if bro=="gor" else (0.345,0.235,0.265)
    _haft(S, HB_HEAD, seed=7 if bro=="gor" else 9)
    block=RoundBox(V(0,0,HB_HEAD),V(hx,hy,hz),r=.034 if bro=="gor" else .050)
    S.add(Displace(block,.005,13,3,seed=181 if bro=="gor" else 182),0,mat="stone")
    for sx in (-1,1):
        for sy,dz in ((-1,-.16),(1,.15),(-1,.13)):
            S.sub(Sphere(V(sx*(hx-.008),sy*(hy-.008),HB_HEAD+dz),.039),.006)
        # A branching fracture on each striking face, including dark bevelled pockets.
        pts=[V(sx*(hx+.002),-.16,HB_HEAD+.12),V(sx*(hx-.004),-.025,HB_HEAD+.05),
             V(sx*(hx+.002),.025,HB_HEAD-.075),V(sx*(hx+.001),.15,HB_HEAD-.19)]
        S.sub(Chain(pts,.008),.004)
        S.sub(Capsule(pts[1],V(sx*(hx+.002),.12,HB_HEAD+.16),.006),.003)
    for x in (-.17,.17):
        outer=RoundBox(V(x,0,HB_HEAD),V(.033,hy+.019,hz+.019),r=.014)
        inner=RoundBox(V(x,0,HB_HEAD),V(.060,hy-.007,hz-.007),r=.014)
        S.add(Diff(outer,inner),.003,mat="iron")
        for sy in (-1,1):
            for dz in (-.17,0,.17):
                S.add(Sphere(V(x,sy*(hy+.025),HB_HEAD+dz),.015),.002,mat="steel")
        for sx in (-1,1):
            S.add(Sphere(V(x,sx*.12,HB_HEAD+hz+.024),.014),.002,mat="steel")
    for sy in (-1,1):
        S.add(RoundBox(V(0,sy*.060,HB_HEAD-hz-.14),V(.025,.010,.17),r=.008),.003,mat="iron")
        for z in (HB_HEAD-hz-.045,HB_HEAD-hz-.24):
            S.add(Sphere(V(0,sy*.070,z),.012),.002,mat="steel")
    S.add(RoundCone(V(0,0,HB_HEAD-hz-.055),V(0,0,HB_HEAD-hz+.035),.078,.088),.004,mat="iron")
    S.add(RoundBox(V(0,0,1.405),V(.065,.065,.032),r=.012),.004,mat="iron")
    # MOG's blunt iron studs contrast with GOR's flat rectangular stone block.
    if bro=="mog":
        for x in (-.17,.17):
            for sy in (-1,1):
                p=V(x,sy*(hy+.01),HB_HEAD+.08)
                S.add(RoundCone(p,p+V(0,sy*.052,.010),.024,.007),.003,mat="iron")
    return S,(hx+.025,hy+.075)


def hammer_gor_sculpt():
    return stone_hammer_sculpt("gor")


def hammer_mog_sculpt():
    return stone_hammer_sculpt("mog")


def p_brute_stone(c,pal):
    import build_weapon_ogre_hammer as OH
    rgb,rough,metal,emit=OH.p_stone(c,pal)
    # A cold mineral surface with compact edge chips, distinct from the dark iron hoops.
    return rgb,rough,metal,emit


PAL_BRUTE = dict(W.PAL, steel=shaders.srgb(117,116,108), steel_rust=shaders.srgb(78,50,31),rust_amt=.35,
                 iron=shaders.srgb(58,61,60),iron_patina=shaders.srgb(84,55,34),iron_patina_amt=.35,
                 wood=shaders.srgb(68,44,26),leather=shaders.srgb(58,37,24),leather_worn=shaders.srgb(105,74,44),
                 cloth=shaders.srgb(113,91,59),stone=shaders.srgb(112,116,105),stone_dark=shaders.srgb(43,49,45),
                 stone_moss=shaders.srgb(79,86,57))


# ---------------------------------------------------------------------------- Hollow Knight Captains' great-halberds
# FULL game scale (the captain GLBs are exported at native ~3 m, like the brutes): the regular halberd frame x CK.
# PATINA "Crimson Oath": huge bearded crescent + hooked back-beak, bronze-banded haft, long crimson pennon.
# OXIDE "Gilded Doom": double moon-crescent (both sides), gilded socket + bands, long diamond spike, bone-white pennon.
CK = 1.5
CH_AXE, CH_TOP, CH_BUTT = 1.14 * CK, 1.62 * CK, -0.62 * CK


def captain_halberd_sculpt(v):
    k = CK
    P = lambda x, y, z: V(x * k, y * k, z * k)
    S = Sculpt(materials=W.MATS, default_mat="wood")
    AX = 1.14
    gold = v == "oxide"
    band = "bronze" if not gold else "bronze"
    S.add(Displace(RoundCone(P(0, 0, -0.58), P(0, 0, AX - 0.02), 0.021 * k, 0.019 * k), 0.002, 10.0, 2, seed=41),
          0.0, mat="wood")
    S.add(RoundCone(P(0, 0, -0.5), P(0, 0, -0.6), 0.024 * k, 0.027 * k), 0.004, mat="iron")         # butt cap
    S.add(RoundCone(P(0, 0, -0.6), P(0, 0, -0.7), 0.022 * k, 0.004), 0.004, mat="steel")            # butt spike
    for zc in (0.0, -0.34):
        S.add(RoundCone(P(0, 0, zc - 0.075), P(0, 0, zc + 0.075), 0.0235 * k, 0.0235 * k), 0.003, mat="leather")
        for dz in (-0.08, 0.08):
            S.add(Torus(P(0, 0, zc + dz), 0.023 * k, 0.005 * k), 0.002, mat=band)
    for z in (0.3, 0.55, 0.8):                                                                      # haft bands
        S.add(Torus(P(0, 0, z), 0.021 * k, 0.0055 * k), 0.002, mat=band)
    S.add(RoundCone(P(0, 0, AX - 0.16), P(0, 0, AX + 0.18), 0.03 * k, 0.026 * k), 0.004, mat=band if gold else "iron")
    for z in (AX - 0.15, AX + 0.17):
        S.add(Torus(P(0, 0, z), 0.031 * k, 0.007 * k), 0.002, mat=band)
    for sy in (1, -1):                                                                              # langets
        S.add(RoundBox(P(0, sy * 0.021, AX - 0.3), V(0.009, 0.0045, 0.16) * k, r=0.003 * k), 0.003, mat="iron")
        for z in (AX - 0.42, AX - 0.24):
            S.add(Sphere(P(0, sy * 0.025, z), 0.0055 * k), 0.001, mat=band)

    def crescent(sx, R, zc=AX, cut_up=0.21, cut_dn=0.2):
        c = P(-sx * 0.09, 0, zc)
        shape = Inter(cyl_y(c, R * k), HalfSpace(P(sx * 0.014, 0, 0), V(-sx, 0, 0)), k=0.004)
        shape = Diff(shape, Union(cyl_y(P(sx * 0.12, 0, zc + 0.38), cut_up * k), cyl_y(P(sx * 0.15, 0, zc - 0.4), cut_dn * k)),
                     k=0.006)
        e = sx * (R - 0.07)
        thick = Inter(HalfSpace(P(e, 0.0, 0), norm(V(sx * 0.055, 1, 0))), HalfSpace(P(e, 0.0, 0), norm(V(sx * 0.055, -1, 0))))
        blade = Inter(shape, Union(thick, Slab(V(0, 0, 0), V(0, 1, 0), 0.0032 * k), k=0.002), Slab(V(0, 0, 0), V(0, 1, 0), 0.014 * k))
        S.add(blade, 0.004, mat="steel")
        for sy in (1, -1):                                                                          # fuller ridge
            S.add(Inter(Diff(cyl_y(c, (R - 0.06) * k), cyl_y(c, (R - 0.075) * k)), shape,
                        Slab(P(0, sy * 0.007, 0), V(0, 1, 0), 0.0045 * k), k=0.002), 0.003, mat=band if gold else "steel")
            for dz in (-0.08, 0.0, 0.08):
                S.add(Sphere(P(sx * 0.045, sy * 0.012, zc + dz), 0.008 * k), 0.002, mat=band)
    crescent(1, 0.33)
    if gold:
        crescent(-1, 0.27, cut_up=0.18, cut_dn=0.17)
    else:
        pts = [P(-0.02, 0, AX + 0.03), P(-0.11, 0, AX + 0.02), P(-0.19, 0, AX - 0.03), P(-0.24, 0, AX - 0.11), P(-0.23, 0, AX - 0.17)]
        S.add(Chain(pts, [0.026 * k, 0.021 * k, 0.014 * k, 0.007 * k, 0.003 * k], squash=(0.42, 1.0), ref=(0, 1, 0)), 0.006,
              mat="steel")                                                                          # hooked beak
    z0 = AX + 0.17
    S.add(RoundCone(P(0, 0, z0), P(0, 0, 1.62), 0.028 * k, 0.002, squash=(0.42, 1.0), ref=(0, 1, 0)), 0.006, mat="steel")
    S.add(Ellipsoid(P(0, 0, z0 + 0.01), V(0.036, 0.024, 0.026) * k), 0.006, mat=band)
    if gold:                                                                                        # crown collar
        for i in range(6):
            a = i / 6 * 2 * math.pi
            d = V(math.cos(a), math.sin(a), 0)
            S.add(RoundCone(P(0, 0, z0 + 0.02) + d * 0.03 * k, P(0, 0, z0 + 0.075) + d * 0.036 * k, 0.008 * k, 0.0015), 0.003,
                  mat="bronze")
    # long tattered pennon (crimson / bone) on the -X side under the head
    L_ = 0.34 if not gold else 0.28
    pen = Inter(Slab(V(0, 0, 0), V(0, 1, 0), 0.004 * k), RoundBox(P(-0.12, 0, AX - 0.18 - L_ / 2), V(0.1, 0.02, L_ / 2 + 0.04) * k,
                                                              r=0.01 * k),
                Union(*[Ellipsoid(P(-0.12 + dx, 0, AX - 0.1 - L_ * 0.5 + dz), V(0.04, 0.1, L_ * 0.62) * k)
                        for dx, dz in ((-0.075, -0.03), (-0.025, 0.03), (0.03, -0.06), (0.078, 0.0))], k=0.01),
                k=0.003)
    S.add(Displace(pen, 0.0018, 20.0, 2, seed=43 if gold else 47), 0.004, mat="cloth")
    lo, hi = V(-0.36 * k, -0.05 * k, -0.74 * k), V(0.4 * k, 0.05 * k, 1.64 * k)
    nodes = {"grip_main": V(0, 0, 0), "grip_offhand": V(0, 0, -0.34 * k), "head_tip": V(0.28 * k, 0, AX * k),
             "blade_tip": V(0, 0, 1.62 * k)}
    return S, lo, hi, nodes


PAL_CAPT = {
    "patina": dict(W.PAL, steel=shaders.srgb(150, 152, 160), rust_amt=0.25, wood=shaders.srgb(58, 34, 26),
                   bronze=shaders.srgb(176, 128, 60), cloth=shaders.srgb(140, 20, 24), leather=shaders.srgb(60, 30, 24)),
    "oxide": dict(W.PAL, steel=shaders.srgb(160, 160, 166), rust_amt=0.15, wood=shaders.srgb(40, 28, 30),
                  bronze=shaders.srgb(222, 170, 70), bronze_patina=shaders.srgb(110, 84, 40), cloth=shaders.srgb(214, 204, 176),
                  leather=shaders.srgb(44, 26, 34)),
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--only", default="axe,flail,ball")
    a = ap.parse_args(argv)
    only = a.only.split(",")
    hh = 0.0009 if a.fast else 0.0006
    if "axe" in only:
        meshutil.clear_scene()
        W.bake_weapon(axe_sculpt(), "boss_morvane_axe", V(-0.32, -0.05, BUTT - 0.12), V(0.36, 0.05, TOP + 0.02), 3600,
                      PAL_AXE, {"grip_main": V(0, 0, 0), "grip_offhand": V(0, 0, -0.32), "head_tip": V(0.3, 0, AXE_Z),
                                "blade_tip": V(0, 0, TOP)}, fast=a.fast, h_hi=hh, density=1.0)
    if "flail" in only:
        meshutil.clear_scene()
        W.bake_weapon(flail_sculpt(), "boss_varkhul_flail", V(-0.08, -0.08, -0.24), V(0.08, 0.08, 0.27), 1400,
                      PAL_FLAIL, {"grip_main": V(0, 0, 0), "head_tip": V(0, 0, 0.24)}, fast=a.fast, h_hi=hh, density=1.0)
    for b in ("gor", "mog"):
        if "hammer_" + b in only:
            import build_enemy_skeleton as BS
            meshutil.clear_scene()
            S, (ex, ey) = (hammer_gor_sculpt if b == "gor" else hammer_mog_sculpt)()
            W.bake_weapon(S, "boss_brute_hammer_" + b, V(-ex, -ey, HB_BUTT - 0.06), V(ex, ey, HB_TOP + 0.02), 8000,
                          PAL_BRUTE, {"grip_main": V(0, 0, 0), "head_tip": V(ex - 0.02, 0, HB_HEAD),
                                      "blade_tip": V(0, 0, HB_TOP if b == "gor" else HB_HEAD + 0.32)},
                          fast=a.fast, painters={"iron": BS.p_iron, "stone": p_brute_stone}, h_hi=0.0016 if a.fast else 0.001, h_lo=0.0022,
                          density=1.0)
    for c in ("patina", "oxide"):
        if "halberd_" + c in only:
            meshutil.clear_scene()
            S, lo, hi, nodes = captain_halberd_sculpt(c)
            W.bake_weapon(S, "boss_captain_halberd_" + c, lo, hi, 3200, PAL_CAPT[c], nodes, fast=a.fast,
                          h_hi=0.0014 if a.fast else 0.0009, h_lo=0.0025, density=1.0)
    if "ball" in only:
        meshutil.clear_scene()
        W.bake_weapon(ball_sculpt(), "boss_varkhul_ball", V(-0.33, -0.33, -0.6), V(0.33, 0.33, 0.02), 2600,
                      PAL_FLAIL, {"ring_tip": V(0, 0, 0.0), "centre": V(0, 0, BALL_C)}, fast=a.fast, h_hi=hh,
                      density=1.0)


if __name__ == "__main__":
    main()
