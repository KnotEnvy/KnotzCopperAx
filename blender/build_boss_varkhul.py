"""Boss art: IRON CHANCELLOR VARKHUL (stage 4 boss) -- the giant knight-lord, rebuilt to docs/refs/c2/bosses/varkhul.png.

Usage (headless, from the project root, through the shared slot runner):
  node tools/blender-run.mjs --log blender/out/varkhul_r13.log --what "varkhul" --owner bosses -- \
       -b --factory-startup -P blender/build_boss_varkhul.py -- [options]
Options:
  --preview 1          workbench clay renders -> progress/shots/bosses/c2r13/dev/varkhul_clay.png (no export)
  --q fast|med         hi-poly density + atlas (fast 1024 / med 2048)
  --out <glb>          export path (default public/assets/models/boss_varkhul.glb)
Outputs boss_varkhul.glb + public/assets/textures/boss_varkhul_*.png, report blender/out/boss/varkhul_report.json.

Board C2 r12: "a slim figure, a flat teal disc helm, one stiff tan cape slab, the flail drops out of the silhouette -- an
elite Hollow Knight recolour". The ref: a MASSIVE armoured knight-lord -- layered pauldrons far wider than the torso with
serpent ornament + medallions, a fur mantle across the shoulders, a crested great-helm with a glowing T-visor and a red
horsehair plume, a cream tabard with the crowned-serpent heraldry, a long torn crimson cape, chainmail at the joints,
heavy greaves, blackened steel with gold trim.

Body kit = the Hollow Knight (blender/build_enemy_knight.py, IMPORTED and re-parameterised in THIS process only, never
edited). Rig contract kept (bosses code relies on it): the knight humanoid rig (33 joints incl. socket_hand_L/R,
socket_back, kilt_F/B/L/R_1..2), built at the 2.0 m reference with the knight's hip landmarks (the game fits def.height
via the hip height), one body atlas material + one glow material. The materials carry glTF extras kcaMetalTint /
kcaMetalEnv (GLTFLoader -> material.userData -> render/characterLook.js hue-locked metal: gold stays gold, the blackened
plate never washes grey-blue).
"""
import os
import sys
import time
import math
import json
import struct
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np
import bpy

from lib import sdf, rig, meshutil, preview, pipeline, shaders, skin, charkit
import build_enemy_knight as BK
importlib.reload(BK)
BM = BK.BM
BS = BK.BS
anatomy = BK.anatomy
gear = BK.gear
from lib.sdf import (V, norm, rot, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff, Bounded,
                     Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace)
from lib.charkit import trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "bosses", "c2r13", "dev")
ASSET = "boss_varkhul"

# ----------------------------------------------------------------------------------------------- re-parameterise
# Same hip landmarks as the knight (hip_joint_z 0.99, pelvis 1.04): the game's height fit is unchanged. Wider frame +
# heavier muscle under the plate; the silhouette mass comes from the armour layers below.
BK.KNIGHT.update(shoulder_x=0.262, hip_x=0.114, stance_x=0.15, upperarm=0.34, forearm=0.3)
BK.STYLE.update(muscle=1.5, chest=1.5, lats=1.45, traps=1.75, waist=1.38, delts=1.6, arm=1.42, forearm=1.48,
                neck=1.65)
BELT_Z = BK.BELT_Z
MATS = BK.MATERIALS + ["plume", "fur", "tabard", "gold"]
GEAR_MATS = ["steel", "trim", "void", "plume", "leather", "cloth", "gold"]
KINDS = dict(BK.KINDS, fur="fur", tabard="cloth", gold="bronze", cloth_trim="cloth")

HELM_BOUNDS = (V(-0.36, -0.42, 1.56), V(0.36, 0.6, 2.36))
MANTLE_BOUNDS = (V(-0.56, -0.36, 1.0), V(0.56, 0.46, 2.0))
TABARD_W = 0.14
CAPE_RT, CAPE_FLARE, CAPE_HEM = 0.06, 0.2, 0.13   # lower cape: top radius over the kilt top, hem flare, hem height
CAPE_BOUNDS = (V(-0.62, -0.3, 0.04), V(0.62, 0.66, 1.2))
SKIRT_BOUNDS = (V(-0.4, -0.42, 0.06), V(0.4, 0.42, 1.18))
GEAR_TRIS = {"helm": 3000, "pauldron": 1500, "mantle": 2600, "cape": 2000, "skirt": 1300}

PAL = dict(
    BK.PAL,
    # blackened steel: dark body value, warm worn edges, near-black grime, a rusty-brown oil drift (ref)
    steel=shaders.srgb(46, 44, 48), steel_edge=shaders.srgb(200, 188, 168), steel_rust=shaders.srgb(92, 54, 30),
    skin=shaders.srgb(54, 52, 56), skin_rough=0.5,
    trim=shaders.srgb(214, 158, 60), trim_patina=shaders.srgb(96, 66, 30), trim_patina_amt=0.22,
    gold=shaders.srgb(222, 166, 64), gold_patina=shaders.srgb(104, 70, 30), gold_patina_amt=0.2,
    bronze=shaders.srgb(196, 140, 62), bronze_patina=shaders.srgb(90, 62, 30), bronze_patina_amt=0.25,
    cloth=shaders.srgb(118, 14, 20), cloth_trim=shaders.srgb(200, 150, 62),
    tabard=shaders.srgb(206, 188, 150), tabard_border=shaders.srgb(122, 16, 22), tabard_ink=shaders.srgb(70, 46, 32),
    leather=shaders.srgb(66, 40, 28), leather_worn=shaders.srgb(124, 86, 56),
    leather_dark=shaders.srgb(36, 24, 18), leather_dark_worn=shaders.srgb(84, 60, 42),
    plume=shaders.srgb(150, 16, 22),
    fur_root=shaders.srgb(58, 46, 38), fur=shaders.srgb(146, 126, 106), fur_tip=shaders.srgb(222, 208, 186),
    void=shaders.srgb(6, 5, 5), void_glow=shaders.srgb(255, 150, 50),
    glow=(1.0, 0.56, 0.16), glow_strength=7.0,
)
METAL_TINT = [0.85, 0.3, 0.45, 0.5]    # [strength, shadow floor, highlight desat, contrast] (characterLook kMetalTint)
METAL_ENV = 0.5


# ============================================================================ body + plate
def plate_vk(S, snap, L):
    """The knight's fused plate, heavier: thick cuirass + a raised plastron under the collar, four stepped faulds, flared
    vambraces, big couters / poleyns with diamond knee plates, heavy greaves and broad sabatons. Gold rims everywhere."""
    nk = L["neck"]
    NC = BM.neck_cutter(L, r0=0.11)
    cuts = [BM.arm_cutter(L, s, t=0.0, pad=0.025)[0] for s in ("L", "R")]
    top = HalfSpace(V(0, 0, float(nk[2]) + 0.05), V(0, 0, 1))
    lo, hi = V(-0.75, -0.55, 0.8), V(0.75, 0.55, float(nk[2]) + 0.2)
    cu = Diff(Inter(Offset(snap, 0.044), top, HalfSpace(V(0, 0, BELT_Z - 0.02), V(0, 0, -1)), k=0.005),
              Union(*cuts, NC), k=0.005)
    S.add(Bounded(cu, lo, hi), 0.0, mat="steel")
    for C in cuts + [NC]:
        rim = Inter(Offset(snap, 0.052), Diff(Offset(C, 0.016), C), top, HalfSpace(V(0, 0, BELT_Z), V(0, 0, -1)),
                    k=0.002)
        S.add(Bounded(rim, lo, hi), 0.003, mat="gold")
    # plastron: a second, raised plate over the upper chest with a gold scalloped lower edge
    pz0, pz1 = 1.3, float(nk[2]) - 0.02
    pl = Diff(Inter(Offset(snap, 0.062), HalfSpace(V(0, -0.02, 0), V(0, 1, 0)), HalfSpace(V(0, 0, pz1), V(0, 0, 1)),
                    Ellipsoid(V(0, -0.2, pz0 + 0.24), V(0.36, 0.4, 0.26)), k=0.006), Union(*cuts, NC), k=0.006)
    S.add(Bounded(pl, lo, hi), 0.004, mat="steel")
    S.add(Bounded(Inter(Offset(snap, 0.068), HalfSpace(V(0, -0.02, 0), V(0, 1, 0)),
                        Diff(Ellipsoid(V(0, -0.2, pz0 + 0.24), V(0.365, 0.4, 0.265)),
                             Ellipsoid(V(0, -0.2, pz0 + 0.24), V(0.342, 0.4, 0.243))),
                        HalfSpace(V(0, 0, pz1), V(0, 0, 1)), k=0.002), lo, hi), 0.002, mat="gold")
    # medial ridge + gold sternum cross
    P = S.project(np.array([V(0, -0.5, z) for z in np.linspace(BELT_Z + 0.05, float(nk[2]) - 0.08, 11)]), offset=0.0)
    S.add(Chain(list(P), 0.013, squash=(0.55, 1.0), ref=(1, 0, 0)), 0.012, mat="steel")
    cz = 1.27
    pc = trace_in(S, V(0, 0, cz), V(0, -1, 0), r=0.6)
    S.add(RoundBox(pc + V(0, -0.006, 0), V(0.012, 0.01, 0.07), r=0.004), 0.004, mat="gold")
    S.add(RoundBox(pc + V(0, -0.006, 0.02), V(0.05, 0.01, 0.012), r=0.004), 0.004, mat="gold")
    # four stepped faulds (lower ones flare) with gold edges
    for i in range(4):
        z = BELT_Z - 0.06 - 0.055 * i
        f = Inter(Offset(snap, 0.05 + 0.009 * i), Slab(V(0, 0, z), V(0, 0.15, 1), 0.029), k=0.003)
        S.add(Bounded(f, V(-0.55, -0.45, z - 0.09), V(0.55, 0.45, z + 0.09)), 0.002, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.057 + 0.009 * i), Slab(V(0, 0, z - 0.025), V(0, 0.15, 1), 0.006), k=0.002),
                      V(-0.55, -0.45, z - 0.09), V(0.55, 0.45, z + 0.09)), 0.002, mat="gold")
    # gorget: three lames rising into the helm
    for i, (t, z0, z1) in enumerate(((0.05, nk[2] - 0.07, nk[2] + 0.01), (0.04, nk[2] - 0.01, nk[2] + 0.07),
                                      (0.03, nk[2] + 0.05, nk[2] + 0.12))):
        g = Inter(Offset(snap, t), Sphere(nk + V(0, 0, 0.04), 0.19), HalfSpace(V(0, 0, float(z0)), V(0, 0, -1)),
                  HalfSpace(V(0, 0, float(z1)), V(0, 0, 1)), k=0.004)
        S.add(Bounded(g, nk - 0.28, nk + 0.28), 0.002, mat="steel")
        S.add(Bounded(Inter(Offset(snap, t + 0.004), Sphere(nk + V(0, 0, 0.04), 0.19),
                            Slab(V(0, 0, float(z1) - 0.004), V(0, 0, 1), 0.004), k=0.002), nk - 0.28, nk + 0.28),
              0.002, mat="gold")
    for s in ("L", "R"):
        sx = 1 if s == "L" else -1
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        S.add(Bounded(BK.limb_region(snap, 0.022, sh, el, pad0=-0.1, pad1=-0.05), sh - 0.45, sh + 0.45), 0.002,
              mat="steel")
        # flared vambrace: thicker toward the wrist, gold cuff edge
        S.add(Bounded(BK.limb_region(snap, 0.024, el, wr, pad0=-0.05, pad1=-0.03), el - 0.45, el + 0.45), 0.002,
              mat="steel")
        b = norm(wr - el)
        lf = float(np.linalg.norm(wr - el))
        fl = Inter(Shell(RoundCone(el + b * lf * 0.45, wr - b * 0.01, 0.07, 0.092), 0.008),
                   Slab(el + b * lf * 0.72, b, lf * 0.26), k=0.004)
        S.add(Bounded(fl, el - 0.4, wr + 0.2), 0.004, mat="steel")
        S.add(Bounded(Inter(Shell(RoundCone(el + b * lf * 0.45, wr - b * 0.01, 0.072, 0.096), 0.008),
                            Slab(wr - b * 0.025, b, 0.008), k=0.002), el - 0.4, wr + 0.2), 0.002, mat="gold")
        cp = el + V(0, 0.025, 0)
        S.add(Bounded(Inter(Offset(snap, 0.04), Sphere(cp, 0.08), k=0.004), el - 0.14, el + 0.14), 0.004, mat="steel")
        n_out = norm(V(sx * 0.6, 0.8, 0.0))
        fan = Inter(Slab(cp + n_out * 0.04, n_out, 0.006), Sphere(cp + n_out * 0.03, 0.085), k=0.003)
        S.add(Bounded(fan, el - 0.16, el + 0.16), 0.004, mat="steel")
        S.add(Bounded(Inter(Slab(cp + n_out * 0.04, n_out, 0.0075), Diff(Sphere(cp + n_out * 0.03, 0.087),
                                                                          Sphere(cp + n_out * 0.03, 0.076))),
                      el - 0.16, el + 0.16), 0.002, mat="gold")
        # legs: cuisse, big poleyn + diamond, HEAVY greave, broad sabaton
        hp, kn, an = L["hip_" + s], L["knee_" + s], L["ankle_" + s]
        S.add(Bounded(BK.limb_region(snap, 0.026, hp, kn, pad0=-0.04, pad1=-0.06), hp - 0.5, hp + 0.5), 0.002,
              mat="steel")
        S.add(Bounded(BK.limb_region(snap, 0.034, kn, an, pad0=-0.06, pad1=0.03), kn - 0.55, kn + 0.55), 0.003,
              mat="steel")
        # greave front ridge + gold top rim
        a2 = norm(an - kn)
        # (r13 resume: traced out from the shin axis -- the old S.project points slid onto the foot / off the shin and
        # left a floating zig-zag wire down to the sabaton)
        P2 = [trace_in(S, kn + a2 * (0.12 + 0.05 * j), V(0, -1, 0), r=0.3) for j in range(6)]
        S.add(Chain(P2, 0.011, squash=(0.5, 1.0), ref=(1, 0, 0)), 0.01, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.04), Slab(kn + a2 * 0.1, a2, 0.007), Sphere(kn + a2 * 0.1, 0.16), k=0.002),
                      kn - 0.3, kn + 0.3), 0.002, mat="gold")
        pc = kn + V(0, -0.05, 0.0)
        S.add(Bounded(Inter(Offset(snap, 0.044), Sphere(pc, 0.095), HalfSpace(V(0, float(kn[1]) + 0.01, 0), V(0, 1, 0)),
                            k=0.004), kn - 0.16, kn + 0.16), 0.004, mat="steel")
        wing = Inter(Slab(pc + V(sx * 0.07, 0, 0), norm(V(sx, -0.3, 0)), 0.006), Sphere(pc + V(sx * 0.05, 0, 0), 0.075),
                     k=0.003)
        S.add(Bounded(wing, kn - 0.17, kn + 0.17), 0.004, mat="steel")
        # diamond knee plate (gold rim + raised steel boss)
        dk = trace_in(S, kn, V(0, -1, 0), r=0.3)
        dM = np.stack([V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], axis=1) @ rot(0, 45, 0)
        S.add(Bounded(RoundBox(dk + V(0, -0.004, 0.0), V(0.042, 0.012, 0.042), M=dM, r=0.006), kn - 0.2, kn + 0.2), 0.004,
              mat="gold")
        S.add(Bounded(RoundBox(dk + V(0, -0.01, 0.0), V(0.03, 0.012, 0.03), M=dM, r=0.008), kn - 0.2, kn + 0.2), 0.003,
              mat="steel")
        foot_reg = Inter(Offset(snap, 0.022), HalfSpace(V(0, 0, 0.16), V(0, 0, 1)),
                         Sphere(an + V(0, -0.09, -0.04), 0.26), k=0.004)
        S.add(Bounded(foot_reg, an - 0.32, an + 0.32), 0.002, mat="steel")
        for j in range(3):                                                   # sabaton lames
            ball = L["ball_" + s]
            c = an + (ball - an) * (0.35 + 0.3 * j)
            S.sub(Inter(Slab(c, norm(V(0, -1, 0.5)), 0.003), Offset(snap, 0.028), k=0.002), 0.003)
    for s in ("L", "R"):
        for a_, b_, t in (("shoulder_", "elbow_", 0.55), ("elbow_", "wrist_", 0.5), ("hip_", "knee_", 0.5),
                          ("knee_", "ankle_", 0.35)):
            a, b = L[a_ + s], L[b_ + s]
            ax = norm(b - a)
            c = a + (b - a) * t
            S.sub(Bounded(Inter(Slab(c, ax, 0.0035), Offset(snap, 0.04), Sphere(c, 0.16)), c - 0.17, c + 0.17), 0.003)
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def chest_drape(S, snap, L):
    """Crimson cloth swag hung across the chest under the fur (ref), two gilt serpent medallions + a chain between."""
    nk = L["neck"]
    zt = float(nk[2]) - 0.07
    pts = [V(sx * 0.22, 0, zt + 0.02 - 0.12 * (1 - abs(sx) / 0.22) ** 1.4) for sx in np.linspace(-0.22, 0.22, 9)]
    meds = []
    for sx in (1, -1):
        p = trace_in(S, V(sx * 0.2, 0, zt + 0.02), V(0, -1, 0.15), r=0.6)
        d = norm(V(0, -1, 0.15))
        M = np.stack([V(1, 0, 0), np.cross(d, V(1, 0, 0)), d], axis=1)
        S.add(Ellipsoid(p + d * 0.006, V(0.05, 0.05, 0.016), M), 0.004, mat="gold")
        S.sub(Ellipsoid(p + d * 0.02, V(0.038, 0.038, 0.01), M), 0.003)
        # serpent S coiled in the medallion
        sp = [p + d * 0.012 + V(0.024 * math.sin(t * 5.2) * (1 - t * 0.3), 0, 0.03 - 0.06 * t) for t in np.linspace(0, 1, 9)]
        S.add(Chain(sp, 0.0065), 0.003, mat="gold")
        S.add(Ellipsoid(sp[0] + V(0, -0.002, 0.006), V(0.011, 0.008, 0.009)), 0.003, mat="gold")
        meds.append(p)
    for i in range(9):
        f = (i + 0.5) / 9
        p = meds[0] * (1 - f) + meds[1] * f + V(0, -0.035, -0.06 * math.sin(f * math.pi))
        S.add(Torus(p, 0.011, 0.0038, sdf.basis(V(0, 1, 0) if i % 2 else V(0, 0, 1))[:, [1, 2, 0]]), 0.002, mat="gold")


def body_sculpt(L):
    S = Sculpt(materials=MATS, default_mat="skin")
    info = {}
    anatomy.torso(S, L, BK.STYLE)
    for s in ("L", "R"):
        anatomy.arm(S, L, s, BK.STYLE)
        anatomy.leg(S, L, s, BK.STYLE)
        anatomy.foot(S, L, s)
    H = anatomy.HeadFrame(L)
    info["H"] = H
    S.add(Ellipsoid(H(0, 0.005, -0.01), H.r(0.085, 0.1, 0.11)), 0.03)
    for s in ("L", "R"):
        el, wr, b, Lf = BM.forearm_frame(L, s)
        c = el + b * Lf * BK.WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
    snap = S.snapshot()
    plate_vk(S, snap, L)
    snap2 = S.snapshot()
    chest_drape(S, snap2, L)
    snap3 = S.snapshot()
    gear.belt(S, snap3, L, z=BELT_Z, half=0.045, thick=0.02, buckle=True)
    anatomy.separate_legs(S, L, top_z=BK.LEG_GAP_TOP, gap=0.018)
    info["kilt"] = BK.kilt_params(S)
    return S, info


def hand_sculpt(L, side):
    """Knight gauntlet + a big flared cuff with a gold rim and gold knuckle studs."""
    S = BK.hand_sculpt(L, side)
    el, wr, b, Lf = BM.forearm_frame(L, side)
    S.add(Bounded(Inter(Shell(RoundCone(wr - b * 0.075, wr + b * 0.005, 0.068, 0.084), 0.007),
                        Slab(wr - b * 0.035, b, 0.04), k=0.003), wr - 0.17, wr + 0.17), 0.003, mat="steel")
    S.add(Bounded(Inter(Shell(RoundCone(wr - b * 0.075, wr + b * 0.005, 0.07, 0.086), 0.007),
                        Slab(wr + b * 0.0, b, 0.006), k=0.002), wr - 0.17, wr + 0.17), 0.002, mat="trim")
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    sc = L["P"]["hand"] / 0.2
    W = L["wrist_" + side]
    return S


# ============================================================================ helm
def serpent(S, pts, r0, r1, head_dir, mat="gold", s=1.0):
    n = len(pts)
    radii = [(r0 + (r1 - r0) * i / (n - 1)) * s for i in range(n)]
    S.add(Chain(pts, radii), 0.006, mat=mat)
    d = norm(head_dir)
    hc = pts[-1] + d * r1 * 1.6 * s
    S.add(Ellipsoid(hc, V(r1 * 1.9, r1 * 1.9, r1 * 1.3) * s), 0.008, mat=mat)
    S.add(RoundCone(hc, hc + d * r1 * 2.6 * s, r1 * 1.3 * s, r1 * 0.5 * s), 0.008, mat=mat)
    return hc, d


def helm_shape(H):
    """Great helm: a tall bucket with a slightly domed top and a forward-pointed face (not the knight's round bascinet)."""
    return Union(RoundCone(H(0, 0.008, -0.215), H(0, 0.008, 0.05), 0.142 * H.s, 0.132 * H.s, squash=(1.0, 0.94)),
                 Ellipsoid(H(0, 0.008, 0.05), H.r(0.132, 0.142, 0.11)),
                 Ellipsoid(H(0, -0.03, -0.07), H.r(0.118, 0.13, 0.13)), k=0.035)


def helm(L, H):
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    s = H.s
    base = helm_shape(H)
    S.add(base, 0.0, mat="steel")
    skin_ = Diff(Offset(base, 0.035), Offset(base, -0.026))
    front = HalfSpace(H(0, -0.05, 0), V(0, 1, 0))
    # raised face plate (a shield-shaped front plate) with a gold rim and a vertical gold keel
    fp = Inter(Offset(base, 0.012), front, Slab(H(0, 0, 0), V(1, 0, 0), 0.098 * s),
               HalfSpace(H(0, 0, 0.045), V(0, 0, 1)), HalfSpace(H(0, 0, -0.205), V(0, 0, -1)), k=0.008)
    S.add(fp, 0.006, mat="steel")
    S.add(Inter(Offset(base, 0.016), front, HalfSpace(H(0, 0, 0.045), V(0, 0, 1)), HalfSpace(H(0, 0, -0.205), V(0, 0, -1)),
                Diff(Slab(H(0, 0, 0), V(1, 0, 0), 0.103 * s), Slab(H(0, 0, 0), V(1, 0, 0), 0.088 * s)), k=0.002), 0.002,
          mat="gold")
    keel = [H(0, -0.13, 0.15), H(0, -0.152, 0.06), H(0, -0.158, -0.03), H(0, -0.156, -0.12), H(0, -0.14, -0.2)]
    # glow positions: the T visor (traced on the plate BEFORE the slit is cut)
    eye_pts, nose_pts = [], []
    for x in np.linspace(-0.082, 0.082, 9):
        p = trace_in(S, H(x * 0.4, 0.0, -0.01), norm(V(x * 3.0, -1, 0.0)), r=0.4)
        eye_pts.append(p + V(0, 0.007, 0))
    for z in np.linspace(-0.03, -0.12, 5):
        p = trace_in(S, H(0, 0.0, z), V(0, -1, 0), r=0.4)
        nose_pts.append(p + V(0, 0.008, 0))
    S.add(Chain([keel[0], keel[1]], [0.012 * s, 0.016 * s], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.02, mat="gold")
    S.add(Chain(keel[3:], [0.014 * s, 0.01 * s], squash=(0.45, 1.0), ref=(1, 0, 0)), 0.02, mat="gold")
    # T visor: wide eye slit + nose slit into the void (the glow mesh sits in it)
    slit = Inter(Slab(H(0, 0, -0.01), V(0, 0.15, 1), 0.016 * s), skin_, front, Slab(V(0, 0, 0), V(1, 0, 0), 0.086 * s),
                 k=0.003)
    S.sub(slit, 0.004, mat="void")
    vert = Inter(Slab(V(0, 0, 0), V(1, 0, 0), 0.0105 * s), skin_, front, HalfSpace(H(0, 0, -0.125), V(0, 0, -1)),
                 HalfSpace(H(0, 0, -0.005), V(0, 0, 1)), k=0.003)
    S.sub(vert, 0.004, mat="void")
    for sx in (1, -1):                                              # breath holes on the cheeks
        for j in range(4):
            p = H(sx * (0.062 + 0.012 * j), -0.112 + 0.016 * j, -0.1 - 0.018 * j)
            S.sub(Inter(Sphere(p, 0.0062 * s), skin_), 0.002, mat="void")
    # brow band, brim + rivets
    S.add(Inter(Offset(base, 0.006), Slab(H(0, 0, 0.06), V(0, 0.22, 1), 0.013 * s), k=0.002), 0.002, mat="gold")
    S.add(Inter(Offset(base, 0.01), Slab(H(0, 0, -0.205), V(0, 0, 1), 0.014 * s), k=0.002), 0.002, mat="gold")
    for i in range(20):
        a = (i + 0.5) / 20 * 2 * math.pi
        p = trace_in(S, H(0, 0.0, 0.06), norm(V(math.sin(a), -math.cos(a), 0.22)), r=0.3)
        S.add(Sphere(p, 0.0058), 0.001, mat="gold")
    S.inter(HalfSpace(H(0, 0, -0.222), V(0, 0, -1)))
    # gold CREST: a tall comb from the brow over the crown with a forward point (ref), a socket for the plume
    comb = Inter(Slab(H(0, 0, 0), V(1, 0, 0), 0.0085 * s),
                 Union(Ellipsoid(H(0, -0.01, 0.1), H.r(0.04, 0.16, 0.115)),
                       RoundCone(H(0, -0.11, 0.12), H(0, -0.17, 0.26), 0.035 * s, 0.004), k=0.03),
                 HalfSpace(H(0, 0, 0.03), V(0, 0, -1)), k=0.004)
    S.add(comb, 0.008, mat="gold")
    S.add(Inter(Slab(H(0, 0, 0), V(1, 0, 0), 0.011 * s), Offset(base, 0.012), HalfSpace(H(0, 0, 0.03), V(0, 0, -1))),
          0.006, mat="gold")
    for sx in (1, -1):                                              # swept gold crown fins at the temples
        for k_ in range(2):
            fp_ = [H(sx * 0.12, -0.04 + 0.05 * k_, 0.07 - 0.03 * k_), H(sx * 0.15, 0.0 + 0.05 * k_, 0.15 - 0.03 * k_),
                   H(sx * 0.158, 0.06 + 0.06 * k_, 0.23 - 0.05 * k_)]
            S.add(Chain(fp_, [0.022 * s, 0.018 * s, 0.003], squash=(0.3, 1.0), ref=(1, 0, 0)), 0.008, mat="gold")
        # flared cheek plates: the helm widens toward the jaw line
        ch = Inter(Offset(base, 0.014), HalfSpace(H(sx * 0.07, 0, 0), V(-sx, 0, 0)), HalfSpace(H(0, 0, -0.07), V(0, 0, 1)),
                   HalfSpace(H(0, 0, -0.22), V(0, 0, -1)), HalfSpace(H(0, 0.05, 0), V(0, 1, 0)), k=0.006)
        S.add(ch, 0.006, mat="steel")
    # red horsehair plume: rises from the crest socket and falls down the back
    S.add(RoundCone(H(0, 0.06, 0.16), H(0, 0.08, 0.215), 0.02 * s, 0.018 * s), 0.008, mat="gold")
    pts = [H(0, 0.06, 0.2), H(0, 0.1, 0.28), H(0, 0.2, 0.29), H(0, 0.29, 0.2), H(0, 0.34, 0.06), H(0, 0.36, -0.08),
           H(0, 0.355, -0.2)]
    rr = [0.028, 0.062, 0.076, 0.074, 0.064, 0.044, 0.014]
    S.add(Displace(Chain(pts, [r * s for r in rr], squash=(0.62, 1.0), ref=(1, 0, 0)), 0.008, 46.0, 2, seed=16), 0.014,
          mat="plume")
    for sx in (1, -1):                                              # loose side locks
        lp = [H(sx * 0.02, 0.24, 0.22), H(sx * 0.07, 0.31, 0.08), H(sx * 0.085, 0.34, -0.04), H(sx * 0.075, 0.345, -0.14)]
        S.add(Displace(Chain(lp, [0.03 * s, 0.03 * s, 0.022 * s, 0.008 * s]), 0.006, 50.0, 2, seed=17 + sx), 0.014,
              mat="plume")
    return S, eye_pts, nose_pts


def visor_glow(eye_pts, nose_pts):
    S = Sculpt(materials=["glow"], default_mat="glow")
    S.add(Chain(eye_pts, 0.0125), 0.0)
    S.add(Chain(nose_pts, 0.0085), 0.004)
    return S


# ============================================================================ pauldrons
def pauldron(snapA, L, side):
    """Huge layered pauldron (rigid upperarm): a domed cop far wider than the torso, three stepped lames down the arm,
    a raised haute-piece toward the neck, gold rims + rivets, a gilt serpent coiled on the dome with its head
    striking forward, a serpent medallion, two gold-capped spikes."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    out = V(sx, 0, 0)
    up = V(0, 0, 1)
    c0 = sh + V(sx * 0.07, 0.0, 0.035)
    R = V(0.215, 0.215, 0.165)
    inner = HalfSpace(V(float(sh[0]) - sx * 0.11, 0, 0), V(-sx, 0, 0))
    under = HalfSpace(c0 + V(0, 0, -0.06), norm(V(-sx * 0.55, 0, -1)))
    dome = Inter(Shell(Ellipsoid(c0, R), 0.014), Diff(Ellipsoid(c0, R + 0.03), Ellipsoid(c0, R - 0.03)), inner, under,
                 k=0.006)
    lo, hi = sh - 0.46, sh + 0.46
    S.add(Bounded(dome, lo, hi), 0.0, mat="steel")
    # dome rim (gold) along the cut edges
    S.add(Bounded(Inter(Shell(Ellipsoid(c0, R), 0.019), Diff(HalfSpace(c0 + V(0, 0, -0.074), norm(V(-sx * 0.55, 0, -1))),
                                                             under), inner, k=0.002), lo, hi), 0.002, mat="gold")
    # three stepped lames down the outer arm
    for i in range(3):
        cc = sh + a * (0.13 + 0.075 * i) + out * 0.03
        r = 0.2 - 0.026 * i
        lam = Inter(Shell(Ellipsoid(cc, V(r, r, r * 0.8)), 0.011), Slab(cc + a * 0.02, a, 0.04),
                    HalfSpace(cc - out * 0.05, -out), k=0.004)
        S.add(Bounded(lam, lo, hi), 0.002, mat="steel")
        S.add(Bounded(Inter(Shell(Ellipsoid(cc, V(r, r, r * 0.8)), 0.015), Slab(cc + a * 0.058, a, 0.006),
                            HalfSpace(cc - out * 0.05, -out), k=0.002), lo, hi), 0.002, mat="gold")
    # haute-piece: an upturned flange rising toward the neck
    fc = V(float(sh[0]) - sx * 0.03, float(sh[1]), float(sh[2]) + 0.1)
    fn = norm(V(sx, 0, -0.35))
    fl = Inter(Slab(fc, fn, 0.008), Ellipsoid(fc + V(sx * 0.03, 0, 0.0), V(0.12, 0.17, 0.11)),
               HalfSpace(fc - V(0, 0, 0.02), V(0, 0, -1)), k=0.003)
    S.add(Bounded(fl, lo, hi), 0.004, mat="steel")
    S.add(Bounded(Inter(Slab(fc, fn, 0.0105), Diff(Ellipsoid(fc + V(sx * 0.03, 0, 0.0), V(0.123, 0.173, 0.113)),
                                                    Ellipsoid(fc + V(sx * 0.03, 0, 0.0), V(0.108, 0.158, 0.098))),
                        HalfSpace(fc - V(0, 0, 0.02), V(0, 0, -1)), k=0.002), lo, hi), 0.002, mat="gold")
    # rivets round the dome
    for j in range(11):
        ang = -1.3 + j * (2.6 / 10)
        d = norm(up * math.cos(ang) * 0.75 + V(0, 1, 0) * math.sin(ang) + out * 0.45)
        p = trace_in(S, c0, d, r=0.4)
        S.add(Sphere(p, 0.0075), 0.001, mat="gold")
    # gilt serpent coiled over the dome, head striking forward out of the front
    pts = []
    for i in range(10):
        t = i / 9
        ang = math.pi * (0.95 - 1.15 * t)
        d = norm(up * math.sin(ang) * 0.8 + V(0, 1, 0) * math.cos(ang) + out * (0.55 + 0.2 * math.sin(t * math.pi)))
        p = trace_in(S, c0, d, r=0.45)
        pts.append(p + d * 0.004)
    hc, hd = serpent(S, pts, 0.012, 0.02, norm(V(sx * 0.25, -1, 0.15)), mat="gold")
    for k_ in (1, -1):                                                # fangs + brow horns on the serpent head
        S.add(RoundCone(hc + V(k_ * 0.012, -0.03, -0.012), hc + V(k_ * 0.012, -0.05, -0.04), 0.005, 0.0015), 0.002,
              mat="gold")
        S.add(RoundCone(hc + V(k_ * 0.018, 0.0, 0.018), hc + V(k_ * 0.03, 0.04, 0.05), 0.008, 0.002), 0.003, mat="gold")
    # two gold-capped spikes at the outer top
    for j, (dz, dy, ln) in enumerate(((0.75, 0.25, 0.13), (0.45, -0.3, 0.1))):
        d = norm(out * 0.8 + up * dz + V(0, dy, 0))
        p = trace_in(S, c0, d, r=0.45)
        S.add(RoundCone(p - d * 0.01, p + d * ln, 0.03 - 0.004 * j, 0.003), 0.006, mat="steel")
        S.add(Inter(Offset(RoundCone(p - d * 0.01, p + d * ln, 0.03 - 0.004 * j, 0.003), 0.003),
                    HalfSpace(p + d * (ln * 0.55), -d)), 0.002, mat="gold")
    return S


# ============================================================================ mantle (fur + crimson back)
def mantle(snapA, L, S_body, kp):
    S = Sculpt(materials=MATS, default_mat="fur")
    nk = L["neck"]
    lo, hi = MANTLE_BOUNDS
    # fur collar: a thick lumpy roll around the neck + over the shoulder tops, spilling down the upper back in a V
    cz = float(nk[2]) - 0.01
    fur = Union(Torus(V(0, 0.03, cz + 0.06), 0.2, 0.085),
                Ellipsoid(V(0, 0.17, cz - 0.04), V(0.27, 0.13, 0.2)),
                *[Ellipsoid(V(sx * 0.22, 0.03, cz + 0.12), V(0.16, 0.21, 0.1), rot(0, sx * -22, 0)) for sx in (1, -1)],
                k=0.05)
    fur = Diff(fur, Union(Sphere(nk + V(0, -0.01, 0.08), 0.112), Ellipsoid(V(0, -0.2, cz - 0.04), V(0.15, 0.13, 0.13)),
                          k=0.03), k=0.02)
    fur = Diff(fur, Offset(snapA, -0.005), k=0.01)
    S.add(Bounded(Displace(fur, 0.014, 20.0, 3, seed=91), lo, hi), 0.0, mat="fur")
    # fur clumps / tufts breaking the lower edge + the outline
    rng = np.random.default_rng(7)
    for i in range(46):
        ang = rng.uniform(-math.pi, math.pi)
        d = norm(V(math.cos(ang) * 1.0, math.sin(ang) * 0.75, rng.uniform(-0.6, 0.35)))
        p = trace_in(S, V(0, 0.04, cz + 0.06), d, r=0.5)
        if p[2] > cz + 0.2 or (p[1] < -0.04 and abs(p[0]) < 0.12):
            continue
        tip = p + norm(d * 0.6 + V(0, 0, -0.8)) * rng.uniform(0.04, 0.075)
        S.add(RoundCone(p - d * 0.01, tip, rng.uniform(0.018, 0.028), 0.004), 0.012, mat="fur")
    # crimson UPPER CAPE: the same cone family as the lower cape (cape()), from under the fur down to the belt where the
    # radii meet, so shoulders -> ankles reads as one heavy cape (its hem overlaps the lower cape top: a small 1 cm step)
    sq = kp["squash"] * 1.05
    rt = kp["r_top"] + CAPE_RT + 0.01           # just outside the lower cape's top edge (it tucks under; small step)
    top_c = kp["top_z"] + 0.07
    cy0 = kp["cy"] + 0.03
    zt = cz + 0.05                              # tucked up under the fur (no plate gap between fur and cape)
    r_up = 0.5                                 # wide across the back under the fur, pauldron to pauldron
    cone = RoundCone(V(0, cy0 + 0.02, zt), V(0, cy0, top_c + 0.02), r_up, rt, squash=(sq, 1.0))   # top set back: clears the back-plate rims
    back = HalfSpace(V(0, cy0 + 0.02, 0), V(0, -1, 0))
    up = Inter(Shell(cone, 0.0065), back, HalfSpace(V(0, 0, zt - 0.02), V(0, 0, 1)),
               HalfSpace(V(0, 0, top_c - 0.075), V(0, 0, -1)), k=0.004)
    # yoke: the top slopes in from the cape's shoulder edge to under the fur, so the cape hangs FROM the shoulders
    # (side view: no board-like top edge standing off the back)
    yk = RoundCone(V(0, cy0 - 0.01, zt + 0.07), V(0, cy0 + 0.02, zt - 0.03), 0.36, r_up + 0.003, squash=(sq, 1.0))
    yoke = Inter(Shell(yk, 0.0065), back, HalfSpace(V(0, 0, zt + 0.07), V(0, 0, 1)),
                 HalfSpace(V(0, 0, zt - 0.04), V(0, 0, -1)), k=0.004)
    up = Union(up, yoke, k=0.012)
    up = Diff(up, Offset(snapA, 0.012), k=0.004)
    S.add(Bounded(Displace(up, 0.0025, 11.0, 2, seed=92), lo, hi), 0.0, mat="cloth")
    for i, f in enumerate(1.05 * np.linspace(-0.85, 0.85, 9)):            # folds from the shoulders, on the SAME 9
        def at(t):                                                          # angles as the lower cape's: one fold line
            z = zt - 0.05 + (top_c - 0.075 - (zt - 0.05)) * t
            r = r_up + (rt - r_up) * t + 0.004
            return V(math.sin(f) * r, cy0 + 0.02 - 0.02 * t + math.cos(f) * r * sq, z)
        fold = Inter(Chain([at(t) for t in np.linspace(0, 1, 5)], [0.006, 0.012, 0.014, 0.012, 0.01]), back, k=0.004)
        S.add(Bounded(fold, lo, hi), 0.016, mat="cloth")
    return S


# ============================================================================ skirt (tabard + side rags) + cape
def skirt(kp):
    """Front: the long cream TABARD (crowned serpent painted on it, crimson border, torn hem) to the shins.
    Sides: two torn crimson rags over the hips. Kilt-chain skinned."""
    S = Sculpt(materials=MATS, default_mat="cloth")
    top = kp["top_z"] + 0.03
    # front tabard
    hz, w = 0.2, TABARD_W
    y_s = kp["yf"] - 0.016
    cone = RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"] - 0.03, hz - 0.1), kp["r_top"] + 0.006,
                     kp["r_hem"] + 0.07, squash=(kp["squash"], 1.0))
    panel = Inter(Shell(cone, 0.0055), HalfSpace(V(0, kp["cy"] - 0.03, 0), V(0, 1, 0)), Slab(V(0, 0, 0), V(1, 0, 0), w),
                  HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
    tongues = Union(*[Ellipsoid(V(x, y_s, hz + 0.2 + dz), V(0.036, 0.4, 0.2)) for x, dz in
                      ((-w * 0.8, 0.05), (-w * 0.42, -0.02), (-w * 0.02, -0.06), (w * 0.4, 0.0), (w * 0.82, 0.07))],
                    HalfSpace(V(0, 0, hz + 0.24), V(0, 0, -1)), k=0.02)
    reg = Inter(panel, tongues, k=0.004)
    lo, hi = SKIRT_BOUNDS
    S.add(Bounded(Displace(reg, 0.001, 9.0, 2, seed=3), lo, hi), 0.0, mat="tabard")
    # side rags
    for sx in (1, -1):
        hz2 = 0.42
        cone2 = RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"], hz2 - 0.1), kp["r_top"] + 0.012, kp["r_hem"] + 0.08,
                          squash=(kp["squash"], 1.0))
        side = Inter(Shell(cone2, 0.005), HalfSpace(V(sx * 0.07, 0, 0), V(-sx, 0, 0)),
                     Slab(V(0, kp["cy"] + 0.0, 0), V(0, 1, 0), 0.13), HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
        tg = Union(*[Ellipsoid(V(sx * 0.3, y, hz2 + 0.2 + dz), V(0.4, 0.035, 0.2)) for y, dz in
                     ((-0.1, 0.04), (-0.04, -0.05), (0.03, 0.02), (0.09, -0.08))],
                   HalfSpace(V(0, 0, hz2 + 0.24), V(0, 0, -1)), k=0.02)
        S.add(Bounded(Displace(Inter(side, tg, k=0.004), 0.002, 16.0, 2, seed=11 + sx), lo, hi), 0.0, mat="cloth")
    return S


def cape(kp):
    """Long TORN crimson cape (belt to the ankles, behind the legs), wider than the body, heavy vertical folds, a
    ragged broken hem with notches and holes, gold border. Painted with the gold crowned serpent (painter)."""
    S = Sculpt(materials=MATS, default_mat="cloth")
    top, hz = kp["top_z"] + 0.07, CAPE_HEM
    rt, rh = kp["r_top"] + CAPE_RT, kp["r_hem"] + CAPE_FLARE
    cy0 = kp["cy"] + 0.03
    cone = RoundCone(V(0, cy0, top + 0.02), V(0, cy0 + 0.1, hz - 0.12), rt, rh, squash=(kp["squash"] * 1.05, 1.0))
    back = HalfSpace(V(0, cy0 + 0.0, 0), V(0, -1, 0))
    panel = Inter(Shell(cone, 0.0065), back, HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
    rng = np.random.default_rng(23)
    # ragged hem: a lot of uneven tongues (some long, some torn short)
    tongues = [HalfSpace(V(0, 0, hz + 0.34), V(0, 0, -1))]
    xs = np.linspace(-0.62, 0.62, 15)
    for i, x in enumerate(xs):
        dz = rng.uniform(-0.1, 0.1) + (0.07 if i % 4 == 1 else 0.0)
        tongues.append(Ellipsoid(V(x + rng.uniform(-0.02, 0.02), cy0 + 0.3, hz + 0.24 + dz),
                                 V(0.05 + rng.uniform(0, 0.02), 0.6, 0.3)))
    tg = Union(*tongues, k=0.025)
    reg = Inter(panel, tg, k=0.004)
    # tears + holes near the hem
    tears = []
    for i in range(4):
        x = rng.uniform(-0.45, 0.45)
        z = hz + rng.uniform(0.2, 0.36)
        tears.append(Ellipsoid(V(x, cy0 + 0.3, z), V(0.008 + rng.uniform(0, 0.008), 0.6, 0.05 + rng.uniform(0, 0.04))))
    reg = Diff(reg, Union(*tears, k=0.01), k=0.004)
    lo, hi = CAPE_BOUNDS
    S.add(Bounded(Displace(reg, 0.0028, 11.0, 2, seed=71), lo, hi), 0.0, mat="cloth")
    # heavy vertical folds: ridges that fan out and deepen toward the hem
    for i, f in enumerate(np.linspace(-0.85, 0.85, 9)):
        def at(t):
            z = top - 0.04 + (hz + 0.08 - (top - 0.04)) * t
            r = rt + (rh - rt) * (top + 0.02 - z) / (top + 0.02 - (hz - 0.12)) + 0.004
            ang = f * (1.05 + 0.2 * t)
            return V(math.sin(ang) * r, cy0 + 0.1 * t + math.cos(ang) * r * kp["squash"] * 1.05, z)
        pts = [at(t) for t in np.linspace(0, 1, 6)]
        fold = Inter(Chain(pts, [0.006, 0.012, 0.02, 0.028, 0.034, 0.036]), back, tg, k=0.004)
        S.add(Bounded(Diff(fold, Union(*tears, k=0.01)), lo, hi), 0.018, mat="cloth")
    # (r13 resume: no gathered belt band -- the upper cape overlaps this top edge, one cape shoulders -> ankles)
    # gold border down the two side edges (inside the cut)
    edge = Inter(Offset(panel, 0.0015), tg, Diff(back, HalfSpace(V(0, cy0 + 0.02, 0), V(0, -1, 0))), k=0.002)
    S.add(Bounded(edge, lo, hi), 0.001, mat="cloth_trim")
    return S


def skin_kilt_vk(ob, arm, kp, n, share, seam):
    """charkit.skin_kilt with a tunable thigh share + L/R seam width. The long back cape and the front tabard only
    lean on the thighs a little (share 0.3) and blend L/R over a wide centre seam, so the hem does not tear down the
    middle in split/kick poses and the chain stays the main joint (validate-glb far-joint rule)."""
    kilt_bones = ["hips", "thigh_L", "thigh_R"] + [b.name for b in arm.data.bones if b.name.startswith("kilt_")]
    top = kp["top_z"]

    def post(P, names, W):
        for t in ("thigh_L", "thigh_R"):
            W[:, names.index(t)] = 0.0
        W = charkit.kilt_angular_blend(P, names, W, kp, n)
        W, _ = skin.top_k(W, 4)
        return skin.skirt_weights(P, names, W, top, kp["hem_z"], share=share, seam=seam)
    return skin.skin(ob, arm, method="sdf", allowed=kilt_bones, power=3.0, post=post,
                     overrides=[(lambda P: np.clip((P[:, 2] - (top - 0.05)) / 0.04, 0, 1), "hips")])


def mantle_post(P, names, W):
    z = P[:, 2]
    a = shaders.smooth01(z, 1.18, 1.32)
    b = shaders.smooth01(z, 1.34, 1.5)
    W = np.zeros_like(W)
    W[:, names.index("hips")] = 1 - a
    W[:, names.index("spine")] = a * (1 - b)
    W[:, names.index("chest")] = a * b
    return W


def armpit_post(L):
    """The bulked torso flank sits ~15-20 cm from the inner upper arm, but the sdf weighting bound flank vertices at
    chest height to upperarm_* (stretch QA: reach/overhead tore spine<->upperarm edges). Below/inside the upper-arm
    axis by more than the arm's own radius, hand the upperarm weight to the chest."""
    def post(P, names, W):
        if "chest" not in names:
            return W
        c = names.index("chest")
        for s in ("L", "R"):
            ua = "upperarm_" + s
            if ua not in names:
                continue
            sh, el = L["shoulder_" + s], L["elbow_" + s]
            d = norm(el - sh)
            u = np.array([d[2], 0.0, -d[0]])
            if u[2] > 0:
                u = -u
            u = u / np.linalg.norm(u)
            v = P - sh
            t = v @ d
            ou = (v - t[:, None] * d[None, :]) @ u
            k = shaders.smooth01(ou, 0.05, 0.18) * (t > -0.05) * (t < 0.38)   # wide ramp: no hard seam at the armpit
            j = names.index(ua)
            mv = W[:, j] * k
            W[:, j] -= mv
            W[:, c] += mv
        return W
    return post


def cape_params(kp):
    k = dict(kp)
    k.update(hem_z=CAPE_HEM, r_hem=kp["r_hem"] + CAPE_FLARE)
    return k


def skirt_params(kp):
    k = dict(kp)
    k.update(hem_z=0.2)
    return k


# ============================================================================ painters
def p_plate_vk(c, pal):
    """Blackened, battered plate: dark body value, bright warm worn edges on every ridge/rim, rusty-brown oil drift
    in broad patches (ref), fine scratches, near-black cavities. No enamel: the colour masses are gold and crimson."""
    n1 = c.noise(5.0, 3, 401)
    n2 = c.noise(70.0, 2, 402)
    n3 = c.noise(11.0, 3, 406)
    scratch = shaders.smooth01(np.abs(c.noise(38.0, 1, 403)), 0.0, 0.018)
    base, edge = pal["steel"], pal["steel_edge"]
    rgb = np.tile(base, (c.n, 1)) * (0.88 + 0.18 * n1 + 0.05 * n2)[:, None]
    rust = shaders.smooth01(n3 + 0.25 * c.cav, 0.35, 0.85)
    rgb = shaders.mix(rgb, pal["steel_rust"], 0.55 * rust)
    wear = shaders.smooth01(c.ridge, 0.22, 0.7) * (0.75 + 0.25 * shaders.smooth01(n2, 0.5, 0.9))
    rgb = shaders.mix(rgb, edge, 0.85 * wear)
    rgb = shaders.mix(rgb, edge * 0.6, (1 - scratch) * 0.16 * (1 - c.cav))
    rgb = shaders.mix(rgb, base * 0.22, shaders.smooth01(c.cav, 0.03, 0.42) * 0.92)
    rough = 0.44 + 0.1 * n1 + 0.18 * c.cav - 0.24 * wear + 0.16 * rust
    metal = 0.9 - 0.35 * rust
    return shaders.out(c.n, rgb, np.clip(rough, 0.16, 0.85), metal)


def p_mail_vk(c, pal):
    n = c.noise(40.0, 2, 404)
    rgb = np.tile(pal["skin"], (c.n, 1)) * (0.85 + 0.25 * n)[:, None]
    rgb = shaders.mix(rgb, np.minimum(pal["steel_edge"] * 0.7, 1), 0.35 * c.ridge)
    rgb = shaders.mix(rgb, rgb * 0.35, c.cav)
    return shaders.out(c.n, rgb, 0.5, np.full(c.n, 0.8))


def _sdist_poly(px, pz, pts):
    """Distance from 2D points to a polyline (pts list of (x, z))."""
    d = np.full(len(px), 1e9)
    for (x0, z0), (x1, z1) in zip(pts[:-1], pts[1:]):
        vx, vz = x1 - x0, z1 - z0
        ll = vx * vx + vz * vz
        t = np.clip(((px - x0) * vx + (pz - z0) * vz) / max(ll, 1e-9), 0, 1)
        d = np.minimum(d, np.hypot(px - (x0 + vx * t), pz - (z0 + vz * t)))
    return d


def heraldry(px, pz, cx, z_top, z_bot, amp, width, crown_w):
    """Crowned serpent emblem in panel space: returns (serpent mask, serpent outline mask, crown mask, head pos)."""
    zs = np.linspace(z_bot, z_top, 26)
    pts = []
    for i, z in enumerate(zs):
        t = (z - z_bot) / (z_top - z_bot)
        pts.append((cx + amp * math.sin(t * 2.6 * math.pi + 0.4) * (0.55 + 0.45 * t), z))
    d = _sdist_poly(px, pz, pts)
    taper = np.clip((pz - z_bot) / (z_top - z_bot), 0, 1)
    wv = width * (0.35 + 0.65 * np.sqrt(taper))
    body = d < wv
    ring = (d < wv + 0.006) & ~body
    hx, hz = pts[-1]
    hx2 = hx + 0.022
    head = ((px - hx2) / (width * 1.9)) ** 2 + ((pz - hz - 0.008) / (width * 1.25)) ** 2 < 1.0
    body = body | head
    # crown above the head: band + three points
    cz0 = hz + 0.05
    band = (np.abs(px - cx) < crown_w) & (pz > cz0) & (pz < cz0 + 0.022)
    pts_m = np.zeros(len(px), bool)
    for k_ in (-1, 0, 1):
        x0 = cx + k_ * crown_w * 0.75
        h = 0.05 if k_ == 0 else 0.038
        inside = (pz >= cz0 + 0.02) & (pz < cz0 + 0.02 + h) & (np.abs(px - x0) < crown_w * 0.28 * (1 - (pz - cz0 - 0.02) / h))
        pts_m |= inside
    jewels = np.zeros(len(px), bool)
    for k_ in (-1, 0, 1):
        jewels |= np.hypot(px - (cx + k_ * crown_w * 0.6), pz - (cz0 + 0.011)) < 0.006
    crown = band | pts_m
    return body, ring, crown, jewels


def p_tabard(c, pal):
    """Cream tabard: weathered linen, crimson border + gold edge line, the crowned serpent (dark ink) + a gold cross."""
    rgb, rough, metal, emit = BM.p_rag(c, pal, "tabard")
    P = c.P
    px, pz = P[:, 0], P[:, 2]
    n1 = c.noise(9.0, 2, 501)
    # torn-hem dirt
    rgb = shaders.mix(rgb, rgb * 0.55, shaders.smooth01(0.42 - pz + 0.04 * n1, 0.0, 0.2) * 0.7)
    w = TABARD_W
    edge_d = w - np.abs(px)
    border = edge_d < 0.024
    goldline = (edge_d >= 0.024) & (edge_d < 0.031)
    rgb = np.where(border[:, None], pal["tabard_border"] * (0.9 + 0.15 * n1)[:, None], rgb)
    rgb = np.where(goldline[:, None], pal["cloth_trim"], rgb)
    body, ring, crown, jewels = heraldry(px, pz, 0.0, 0.84, 0.4, 0.046, 0.021, 0.056)
    rgb = np.where(ring[:, None], pal["cloth_trim"] * 0.9, rgb)
    rgb = np.where(body[:, None], pal["tabard_ink"] * (0.9 + 0.2 * n1)[:, None], rgb)
    rgb = np.where(crown[:, None], pal["cloth_trim"], rgb)
    rgb = np.where(jewels[:, None], pal["tabard_border"], rgb)
    cross = ((np.abs(px) < 0.007) & (np.abs(pz - 0.3) < 0.04)) | ((np.abs(pz - 0.31) < 0.007) & (np.abs(px) < 0.028))
    rgb = np.where(cross[:, None], pal["cloth_trim"], rgb)
    rough = np.where((goldline | crown | cross)[None, :][0], 0.45, rough)
    metal = np.where((goldline | crown | cross)[None, :][0], 0.6, metal)
    return rgb, rough, metal, emit


def p_cloth_vk(c, pal):
    """Crimson cloth; on the CAPE part the big gold crowned serpent on the back + darker torn hem."""
    rgb, rough, metal, emit = BM.p_rag(c, pal, "cloth")
    part = c.x.get("part", "")
    P = c.P
    n1 = c.noise(9.0, 2, 511)
    if part == "cape":
        rgb = shaders.mix(rgb, rgb * 0.5, shaders.smooth01(0.4 - P[:, 2] + 0.05 * n1, 0.0, 0.3) * 0.75)
        back = P[:, 1] > 0.05
        body, ring, crown, jewels = heraldry(P[:, 0], P[:, 2], 0.0, 0.92, 0.34, 0.12, 0.042, 0.115)
        gold = (body | crown) & back
        rgb = np.where(gold[:, None], pal["cloth_trim"] * (0.88 + 0.2 * n1)[:, None], rgb)
        rgb = np.where((ring & back)[:, None], pal["cloth"] * 0.45, rgb)
        rgb = np.where((jewels & back)[:, None], pal["cloth"] * 0.6, rgb)
        rough = np.where(gold, 0.5, rough)
        metal = np.where(gold, 0.55, metal)
    return rgb, rough, metal, emit


def p_gold_thread(c, pal):
    """Cape border: gilt thread (gold, semi-metal) instead of the knight kit's tan rag trim."""
    n1 = c.noise(60.0, 2, 521)
    rgb = np.tile(pal["cloth_trim"], (c.n, 1)) * (0.85 + 0.25 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.45, c.cav)
    return shaders.out(c.n, rgb, 0.45, 0.65)


def p_void_vk(c, pal):
    rgb = np.tile(pal["void"], (c.n, 1))
    return shaders.out(c.n, rgb, 0.9)


PAINTERS = dict(BK.PAINTERS, steel=p_plate_vk, skin=p_mail_vk, eye=p_mail_vk, nail=p_mail_vk, brow=p_mail_vk,
                trim=lambda c, pal: shaders.p_metal(c, pal, "trim"), gold=lambda c, pal: shaders.p_metal(c, pal, "gold"),
                fur=shaders.p_fur_mass, tabard=p_tabard, cloth=p_cloth_vk, void=p_void_vk, cloth_trim=p_gold_thread)

MAT_COLORS = dict(BK.MAT_COLORS, steel=(0.16, 0.16, 0.17), trim=(0.75, 0.52, 0.16), gold=(0.78, 0.55, 0.16),
                  cloth=(0.42, 0.04, 0.05), cloth_trim=(0.75, 0.55, 0.2), plume=(0.6, 0.05, 0.06),
                  fur=(0.62, 0.55, 0.46), tabard=(0.8, 0.74, 0.6), skin=(0.12, 0.12, 0.13), glow=(1.0, 0.6, 0.2))


# ============================================================================ build helpers
def build_parts(L, grid_h=0.0035):
    S, info = body_sculpt(L)
    H = info["H"]
    KP = info["kilt"]
    t = time.time()
    snapA = charkit.GridSDF(S, h=grid_h, lo=V(-0.8, -0.5, 1.0), hi=V(0.8, 0.55, 1.98))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    Sh, eye_pts, nose_pts = helm(L, H)
    G = {"helm": (Sh, "head", HELM_BOUNDS)}
    for sd in ("L", "R"):
        sh = L["shoulder_" + sd]
        G["pauldron_" + sd] = (pauldron(snapA, L, sd), "upperarm_" + sd, (sh - 0.46, sh + 0.46))
    G["mantle"] = (mantle(snapA, L, S, KP), None, MANTLE_BOUNDS)
    return S, info, G, visor_glow(eye_pts, nose_pts)


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(BK.KNIGHT)
    t0 = time.time()
    out = args.outdir or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info, G, Sg = build_parts(L)
    KP = info["kilt"]
    hh = float(args.h or 0.0045)
    col = MAT_COLORS
    charkit.mesh_sculpt(S, "body", hh, colors=col)
    charkit.mesh_sculpt(skirt(KP), "skirt", hh * 0.8, *SKIRT_BOUNDS, colors=col)
    charkit.mesh_sculpt(cape(KP), "cape", hh * 0.8, *CAPE_BOUNDS, colors=col)
    for s in ("L", "R"):
        w = L["wrist_" + s]
        charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.0025, w - 0.17, w + 0.17, colors=col)
    for nm, (Sx, _, bnd) in G.items():
        charkit.mesh_sculpt(Sx, nm, hh * 0.7, *bnd, colors=col)
    charkit.mesh_sculpt(Sg, "glow", 0.002, colors=col)
    views = [dict(target=(0.0, 0, 1.05), ortho=2.6, yaw=y, dist=10, pitch=6) for y in (0, 35, 90, 180)]
    preview.render_views(os.path.join(out, "varkhul_clay.png"), views, res=(1600, 900))
    views = [dict(target=(0.0, 0, 1.72), ortho=0.9, yaw=y, dist=6, pitch=6) for y in (0, 35, 120)]
    preview.render_views(os.path.join(out, "varkhul_clay_top.png"), views, res=(1500, 700))
    print(f"[varkhul] preview done in {time.time()-t0:.1f}s")


def patch_glb_extras(path, extras_by_material):
    """Add glTF material extras (GLTFLoader copies them into material.userData) without re-exporting."""
    b = bytearray(open(path, "rb").read())
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(bytes(b[20:20 + jl]).decode("utf-8"))
    rest = bytes(b[20 + jl:])
    for m in j.get("materials", []):
        ex = extras_by_material.get(m.get("name"))
        if ex:
            m.setdefault("extras", {}).update(ex)
    j.setdefault("asset", {}).setdefault("extras", {})["kcaBuild"] = "build_boss_varkhul.py C2 r13"
    js = json.dumps(j, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    hdr = struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A)
    open(path, "wb").write(hdr + js + rest)


# ============================================================================ build
def build(args):
    T0 = time.time()
    q = args.q
    res = 1024 if q == "fast" else 2048
    h_body, h_hand, h_kilt, h_gear = {"fast": (0.0042, 0.0014, 0.003, 0.002), "med": (0.0028, 0.0011, 0.002, 0.0014)}[q]
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(BK.KNIGHT)
    report = {"device": device, "q": q, "res": res, "parts": {}}
    t = time.time()
    S, info, G, Sglow = build_parts(L)
    H = info["H"]
    KP = info["kilt"]
    Sk = skirt(KP)
    Sc = cape(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, BK.KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=BK.KILT_CHAIN)

    t = time.time()
    his = {"body": [pipeline.sculpt_mesh(S, "body_hi", h_body)]}
    charkit.drop_islands(his["body"][0], h_body)
    for s in ("L", "R"):
        w = L["wrist_" + s]
        his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)]
    his["skirt"] = [pipeline.sculpt_mesh(Sk, "skirt_hi", h_kilt, *SKIRT_BOUNDS)]
    his["cape"] = [pipeline.sculpt_mesh(Sc, "cape_hi", h_kilt, *CAPE_BOUNDS)]
    for nm, (Sg, _, bnd) in G.items():
        o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *bnd)
        charkit.drop_islands(o, h_gear, min_verts=40)
        his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.0036 if q != "fast" else 0.0045
    hb0, hb1 = BK.HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {"body": pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, 200)],
                                    clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))}
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, 600, w - 0.17, w + 0.17, symmetry=False)
    los["skirt"] = pipeline.lowpoly(Sk, "skirt_lo", 0.003, GEAR_TRIS["skirt"], *SKIRT_BOUNDS)
    los["cape"] = pipeline.lowpoly(Sc, "cape_lo", 0.003, GEAR_TRIS["cape"], *CAPE_BOUNDS)
    for nm, (Sg, _, bnd) in G.items():
        kind = nm.split("_")[0]
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0026, GEAR_TRIS[kind], *bnd, symmetry=kind in ("helm", "mantle"),
                                   clean=lambda o: charkit.drop_islands(o, 0.0026, min_verts=30))
    glow_lo = pipeline.lowpoly(Sglow, "glow_lo", 0.0015, 160, symmetry=False)
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(los["body"], arm, method="sdf", S=S, allowed=body_bones, post=armpit_post(L),
                       overrides=[(charkit.head_mask(H), "head"), (BK.crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    skin_kilt_vk(los["skirt"], arm, skirt_params(KP), BK.KILT_CHAIN, share=0.3, seam=0.2)
    skin_kilt_vk(los["cape"], arm, cape_params(KP), BK.KILT_CHAIN, share=0.3, seam=0.35)
    # mantle (fur collar + upper cape): weights by HEIGHT, hips -> spine -> chest. The sdf weighting + mesh smoothing
    # leaked neck weight down the upper cape to the belt (twist QA tore it); the bottom overlaps the lower cape's top,
    # which is hips-bound, so both move together; the fur collar rides the chest.
    skin.skin(los["mantle"], arm, method="sdf", S=S, allowed=["hips", "spine", "chest"], smooth=4, post=mantle_post)
    for nm, (_, bone, _) in G.items():
        if bone:
            charkit.rigid_bind(los[nm], arm, bone)
    charkit.rigid_bind(glow_lo, arm, "head")
    pipeline.log(f"skinning {time.time()-t:.1f}s")

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=0.6, head_density=0.4)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.1)
    charkit.smart_uv(los["skirt"], 70.0, 1.15)
    charkit.smart_uv(los["cape"], 70.0, 1.0)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.3 if nm == "helm" else 1.0)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "skirt": Sk, "cape": Sc}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.012, 0.03), "hand_L": (0.006, 0.014), "hand_R": (0.006, 0.014), "skirt": (0.005, 0.012),
           "cape": (0.006, 0.016), "mantle": (0.008, 0.02)}
    parts = ["body", "hand_L", "hand_R", "skirt", "cape", "mantle", "helm", "pauldron_L", "pauldron_R"]
    pal = dict(PAL)
    report["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in parts], margin_px=6 if q != "fast" else 4, res=res)
    for k in parts:
        for o in his[k]:
            shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, dict(part=k), painters=PAINTERS)
    for o in all_hi + list(los.values()) + [glow_lo]:
        pipeline.set_ray_visibility(o, False)
    jobs = [(los[k], his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
    B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if q == "fast" else 48),
                         ("normal", "NORMAL", 4 if q == "fast" else 8)])
    tex = charkit.composite_maps(maps, OUT_TEX, ASSET, tint=(0.4, 0.38, 0.4))
    mat = pipeline.final_material("M_" + ASSET, tex["albedo"], tex["normal"], tex["orm"])
    gmat = BS.glow_material("M_" + ASSET + "_glow", pal["glow"], pal["glow_strength"])
    dups = []
    cape_ob = None
    for k in parts:
        o = meshutil.duplicate(los[k], f"{k}_x")
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
        if k == "cape":
            # own mesh, same atlas material + skeleton: the bosses code skips its runtime cape when the body GLB has
            # a mesh whose name contains "cape" (src/enemies/bosses/_varkhul.js r13Asset)
            cape_ob = o
            o.name = o.data.name = ASSET + "_cape"
            continue
        dups.append(o)
    bpy.context.view_layer.update()
    body = meshutil.join(dups, ASSET + "_mesh")
    body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
    g = meshutil.duplicate(glow_lo, "glow_x")
    g.data.materials.clear()
    g.data.materials.append(gmat)
    pipeline.strip_for_export(g)
    body = meshutil.join([body, g], ASSET + "_mesh")
    report["tris"] = meshutil.tri_count(body) + meshutil.tri_count(cape_ob)
    report["tris_cape"] = meshutil.tri_count(cape_ob)
    report["stretch_qa"] = {}
    for tag, ob_ in (("body", body), ("cape", cape_ob)):
        qa = skin.stretch_report(ob_, arm)
        report["stretch_qa"].update({f"{tag}:{k}": dict(bad=q_["bad"], soft=q_["soft"]) for k, q_ in qa.items()})
    pipeline.log("stretch QA: " + ", ".join(f"{k}: bad {q_['bad']} soft {q_['soft']}" for k, q_ in report["stretch_qa"].items()))
    P = np.concatenate([meshutil.get_verts(body), meshutil.get_verts(cape_ob)])
    report["extent"] = dict(min=P.min(axis=0).tolist(), max=P.max(axis=0).tolist(),
                            hip_z=float(L["hip_L"][2]), shoulder_x=float(L["shoulder_L"][0]))
    pipeline.log(f"extent {report['extent']}")
    out = args.out or os.path.join(OUT_MODELS, ASSET + ".glb")
    pipeline.export_glb(out, [arm, body, cape_ob], scene_name=ASSET)
    patch_glb_extras(out, {"M_" + ASSET: {"kcaMetalTint": METAL_TINT, "kcaMetalEnv": METAL_ENV}})
    report["glb"] = out
    report["glb_mb"] = os.path.getsize(out) / 1e6
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "boss", "varkhul_report.json"), report)
    pipeline.log(f"DONE {out} ({report['glb_mb']:.1f} MB, {report['tris']} tris) in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--q", default="med")
    ap.add_argument("--out", default=None)
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--body-tris", type=int, default=10000)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
