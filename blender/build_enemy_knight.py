"""Build the Hollow Knight (plate-armoured halberdier, Golden Axe 'Bitter' knight DNA) -- three rank tiers.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_enemy_knight.py -- [options]
Options:
  --preview full|head       clay renders to progress/shots/enemies-art-2/dev/ (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --stage skin              LO + weights + stretch QA only (progress/tmp/knight_skin_test.glb)
  --tiers silver,red,gold   export only these tiers
Default: public/assets/models/enemy_knight_<tier>.glb (+ copy silver -> enemy_knight.glb), textures
public/assets/textures/enemy_knight_<tier>_*.png, report blender/out/knight_report.json.

Design: a 2.0 m wall of plate. Nobody is inside: a great helm with a pointed visor ridge and a T-shaped eye slit
cut into a black void, two faint cold pinpoints deep in the slit (separate emissive mesh / 2nd material so the
body's hit-flash still works). Fused plate (cuirass with medial ridge + rolled rims, gorget, faulds, rerebraces,
fan couters, vambraces, cuisses, fan poleyns, greaves, sabatons -- all Offset shells of one body snapshot, weighted
like skin), dark mail at the joints, a tattered tabard (fused chest panel + kilt-chain skirt panels F/B with a
trim border), belt, gauntlets gripping the halberd haft. Rank tiers (separate GLBs, per-tier UV pack):
  silver (Lt.)  : blued steel + oxidised silver-blue pauldrons/cuirass, slate-blue tabard, iron trim, small blue horsehair tuft, standard pauldrons
  red    (Col.) : blued steel + crimson-enamel pauldrons/cuirass, crimson tabard, brass trim, tall crimson crest, bigger pauldrons with haute-piece flanges
  gold   (Gen.) : blued steel, gilded pauldrons/cuirass/helm + trim, black-violet tabard, huge ivory-gold plume + crown circlet, the biggest
                  pauldrons (haute-pieces + spikes).
"""
import os
import sys
import time
import math
import json
import shutil
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np
import bpy

from lib import sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit
for _m in (sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit):
    importlib.reload(_m)
import build_enemy_marauder as BM
importlib.reload(BM)
import build_enemy_skeleton as BS
importlib.reload(BS)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-2", "dev")
ASSET = "enemy_knight"

KNIGHT = dict(
    height=2.0, head_h=0.25,
    shoulder_x=0.235, shoulder_z=1.63, clav_in_x=0.026,
    hip_x=0.105, hip_joint_z=0.99, pelvis_z=1.04,
    knee_z=0.54, ankle_z=0.09, foot_len=0.28, stance_x=0.125,
    spine_z=1.16, chest_z=1.36, neck_z=1.655, head_base_z=1.76,
    upperarm=0.33, forearm=0.29, hand=0.2,
    arm_down=40.0, arm_fwd=7.0, elbow_bend=12.0,
)
STYLE = dict(muscle=1.2, defin=0.4, fat=0.6, chest=1.18, lats=1.12, traps=1.3, waist=1.1, delts=1.25, arm=1.15,
             forearm=1.25, neck=1.3)
MATERIALS = ["skin", "eye", "nail", "brow", "steel", "trim", "cloth", "cloth_trim", "leather", "leather_dark",
             "bronze", "iron", "void"]
GEAR_MATS = ["steel", "trim", "void", "plume", "leather", "cloth"]
KINDS = {"skin": "mail", "steel": "iron", "trim": "bronze", "cloth_trim": "cloth", "void": "leather",
         "plume": "cloth", "eye": "leather", "nail": "iron", "brow": "leather"}
WRIST_CUT_T = 0.88
HAND_CUT_T = 0.8
GRIP_R = 0.03
BELT_Z = 1.1
KILT_CHAIN = 2
LEG_GAP_TOP = 0.86
HEAD_BOX = (V(-0.2, -0.22, 1.72), V(0.2, 0.2, 2.02))
TIERS = {
    "silver": ["helm_silver", "pauldron_silver_L", "pauldron_silver_R"],
    "red": ["helm_red", "pauldron_red_L", "pauldron_red_R"],
    "gold": ["helm_gold", "pauldron_gold_L", "pauldron_gold_R"],
}
PAULDRON = {"silver": (1.08, False, False), "red": (1.26, True, False), "gold": (1.42, True, True)}


# ============================================================================ body + fused plate
def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {}
    anatomy.torso(S, L, STYLE)
    arms = {}
    for s in ("L", "R"):
        arms[s] = anatomy.arm(S, L, s, STYLE)
        anatomy.leg(S, L, s, STYLE)
        anatomy.foot(S, L, s)
    H = anatomy.HeadFrame(L)
    info["H"] = H
    S.add(Ellipsoid(H(0, 0.005, -0.01), H.r(0.085, 0.1, 0.11)), 0.03)            # head filler (inside the helm)
    for s in ("L", "R"):
        el, wr, b, Lf = BM.forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
    snap = S.snapshot()
    plate(S, snap, L)
    snap2 = S.snapshot()
    tabard_top(S, snap2, L)
    snap3 = S.snapshot()
    gear.belt(S, snap3, L, z=BELT_Z, half=0.036, thick=0.016, buckle=True)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.016)
    info["kilt"] = kilt_params(S)
    return S, info


def limb_region(snap, t, a, b, pad0=0.0, pad1=0.0, r=0.2):
    ax = norm(b - a)
    Ln = float(np.linalg.norm(b - a))
    c = a + ax * (Ln * 0.5 + (pad1 - pad0) * 0.5)
    return Inter(Offset(snap, t), Slab(c, ax, Ln * 0.5 + (pad0 + pad1) * 0.5), Sphere((a + b) / 2, Ln * 0.5 + r),
                 k=0.004)


def plate(S, snap, L):
    nk = L["neck"]
    NC = BM.neck_cutter(L, r0=0.1)
    cuts = [BM.arm_cutter(L, s, t=0.0, pad=0.025)[0] for s in ("L", "R")]
    top = HalfSpace(V(0, 0, float(nk[2]) + 0.05), V(0, 0, 1))
    lo, hi = V(-0.7, -0.5, 0.8), V(0.7, 0.5, float(nk[2]) + 0.2)
    # cuirass
    cu = Diff(Inter(Offset(snap, 0.034), top, HalfSpace(V(0, 0, BELT_Z - 0.02), V(0, 0, -1)), k=0.004),
              Union(*cuts, NC), k=0.004)
    S.add(Bounded(cu, lo, hi), 0.0, mat="steel")
    # rolled rims (kept side only) at the neck + arm holes
    for C in cuts + [NC]:
        rim = Inter(Offset(snap, 0.04), Diff(Offset(C, 0.014), C), top, HalfSpace(V(0, 0, BELT_Z), V(0, 0, -1)),
                    k=0.002)
        S.add(Bounded(rim, lo, hi), 0.003, mat="trim")
    # medial ridge down the breastplate
    P = S.project(np.array([V(0, -0.4, z) for z in np.linspace(BELT_Z + 0.04, float(nk[2]) - 0.1, 10)]), offset=0.0)
    S.add(Chain(list(P), 0.011, squash=(0.55, 1.0), ref=(1, 0, 0)), 0.012, mat="steel")
    # faulds: 3 stepped hoops below the waist
    for i in range(3):
        z = BELT_Z - 0.05 - 0.05 * i
        f = Inter(Offset(snap, 0.04 + 0.006 * i), Slab(V(0, 0, z), V(0, 0.15, 1), 0.026), k=0.003)
        S.add(Bounded(f, V(-0.5, -0.4, z - 0.08), V(0.5, 0.4, z + 0.08)), 0.002, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.046 + 0.006 * i), Slab(V(0, 0, z - 0.022), V(0, 0.15, 1), 0.005), k=0.002),
                      V(-0.5, -0.4, z - 0.08), V(0.5, 0.4, z + 0.08)), 0.002, mat="trim")
    # gorget: two lames round the neck, rising into the helm
    for i, (t, z0, z1) in enumerate(((0.03, nk[2] - 0.06, nk[2] + 0.02), (0.022, nk[2] + 0.0, nk[2] + 0.1))):
        g = Inter(Offset(snap, t), Sphere(nk + V(0, 0, 0.04), 0.16), HalfSpace(V(0, 0, float(z0)), V(0, 0, -1)),
                  HalfSpace(V(0, 0, float(z1)), V(0, 0, 1)), k=0.004)
        S.add(Bounded(g, nk - 0.25, nk + 0.25), 0.002, mat="steel")
    for s in ("L", "R"):
        sx = 1 if s == "L" else -1
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        # rerebrace + vambrace + couter with a fan wing
        S.add(Bounded(limb_region(snap, 0.017, sh, el, pad0=-0.08, pad1=-0.05), sh - 0.4, sh + 0.4), 0.002,
              mat="steel")
        S.add(Bounded(limb_region(snap, 0.016, el, wr, pad0=-0.05, pad1=-0.03), el - 0.4, el + 0.4), 0.002,
              mat="steel")
        cp = el + V(0, 0.02, 0)
        S.add(Bounded(Inter(Offset(snap, 0.03), Sphere(cp, 0.065), k=0.004), el - 0.12, el + 0.12), 0.004,
              mat="steel")
        n_out = norm(V(sx * 0.6, 0.8, 0.0))
        fan = Inter(Slab(cp + n_out * 0.03, n_out, 0.005), Sphere(cp + n_out * 0.02, 0.07), k=0.003)
        S.add(Bounded(fan, el - 0.14, el + 0.14), 0.004, mat="steel")
        for p0 in (sh, el):
            pass
        # legs: cuisse, poleyn + fan, greave, sabaton
        hp, kn, an = L["hip_" + s], L["knee_" + s], L["ankle_" + s]
        S.add(Bounded(limb_region(snap, 0.018, hp, kn, pad0=-0.04, pad1=-0.06), hp - 0.45, hp + 0.45), 0.002,
              mat="steel")
        S.add(Bounded(limb_region(snap, 0.017, kn, an, pad0=-0.06, pad1=0.02), kn - 0.5, kn + 0.5), 0.002,
              mat="steel")
        pc = kn + V(0, -0.045, 0.0)
        S.add(Bounded(Inter(Offset(snap, 0.032), Sphere(pc, 0.075), HalfSpace(V(0, float(kn[1]) + 0.01, 0), V(0, 1, 0)),
                            k=0.004), kn - 0.14, kn + 0.14), 0.004, mat="steel")
        wing = Inter(Slab(pc + V(sx * 0.055, 0, 0), norm(V(sx, -0.3, 0)), 0.005), Sphere(pc + V(sx * 0.04, 0, 0), 0.06),
                     k=0.003)
        S.add(Bounded(wing, kn - 0.14, kn + 0.14), 0.004, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.022), Sphere(pc + V(0, -0.02, 0), 0.04), k=0.003), kn - 0.14, kn + 0.14),
              0.003, mat="trim")
        foot_reg = Inter(Offset(snap, 0.014), HalfSpace(V(0, 0, 0.14), V(0, 0, 1)),
                         Sphere(an + V(0, -0.08, -0.04), 0.24), k=0.004)
        S.add(Bounded(foot_reg, an - 0.3, an + 0.3), 0.002, mat="steel")
        for j in range(3):                                                   # sabaton lames
            ball = L["ball_" + s]
            c = an + (ball - an) * (0.35 + 0.3 * j) + V(0, 0, 0.0)
            S.sub(Inter(Slab(c, norm(V(0, -1, 0.5)), 0.0025), Offset(snap, 0.02), k=0.002), 0.003)
    # plate breaks: soft grooves where the plates overlap (reads as separate plates, never slots)
    for s in ("L", "R"):
        for a_, b_, t in (("shoulder_", "elbow_", 0.55), ("elbow_", "wrist_", 0.5), ("hip_", "knee_", 0.5),
                          ("knee_", "ankle_", 0.35)):
            a, b = L[a_ + s], L[b_ + s]
            ax = norm(b - a)
            c = a + (b - a) * t
            S.sub(Bounded(Inter(Slab(c, ax, 0.003), Offset(snap, 0.03), Sphere(c, 0.14)), c - 0.15, c + 0.15), 0.003)
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def tabard_top(S, snap, L):
    """Tattered tabard panels fused over the breastplate + back (cloth), with a trim border."""
    nk = L["neck"]
    for sy in (-1, 1):
        w = 0.13 if sy < 0 else 0.15
        base = Inter(Offset(snap, 0.006), HalfSpace(V(0, sy * 0.02, 0), V(0, -sy, 0)),
                     HalfSpace(V(0, 0, float(nk[2]) - 0.1), V(0, 0, 1)), HalfSpace(V(0, 0, BELT_Z - 0.04), V(0, 0, -1)),
                     k=0.004)
        pan = Inter(base, Slab(V(0, 0, 0), V(1, 0, 0), w), k=0.003)
        lo, hi = V(-0.3, -0.45 if sy < 0 else 0.0, BELT_Z - 0.08), V(0.3, 0.0 if sy < 0 else 0.45, float(nk[2]))
        S.add(Bounded(Displace(pan, 0.0012, 20.0, 2, seed=8 + sy), lo, hi), 0.002, mat="cloth")
        border = Inter(Offset(snap, 0.0085), base, Diff(Slab(V(0, 0, 0), V(1, 0, 0), w - 0.002),
                                                         Slab(V(0, 0, 0), V(1, 0, 0), w - 0.02)), k=0.002)
        S.add(Bounded(border, lo, hi), 0.001, mat="cloth_trim")
        # shoulder straps over the pauldron line (into the gorget)
        for sx in (1, -1):
            st = Inter(Offset(snap, 0.007), Slab(V(sx * 0.1, 0, 0), norm(V(1, 0, 0.25 * sx)), 0.025),
                       HalfSpace(V(0, 0, float(nk[2]) - 0.12), V(0, 0, -1)), HalfSpace(V(0, sy * 0.02, 0), V(0, -sy, 0)),
                       k=0.003)
            S.add(Bounded(st, lo, hi + V(0, 0, 0.1)), 0.002, mat="cloth")


def kilt_params(S, z=BELT_Z - 0.02):
    c = V(0, 0.0, z)
    xs = ray_hit(S, c, V(1, 0, 0))[0]
    yf = ray_hit(S, c, V(0, -1, 0))[1]
    yb = ray_hit(S, c, V(0, 1, 0))[1]
    rx = float(xs) + 0.012
    ry = (float(yb) - float(yf)) / 2 + 0.012
    return dict(top_z=BELT_Z - 0.01, hem_z=0.5, r_top=rx, r_hem=rx * 1.12, squash=ry / rx, cy=float(yf + yb) / 2,
                yf=float(yf), yb=float(yb))


def tabard_skirt(kp):
    """Long tattered tabard panels front + back (kilt chains F/B), torn hems, trim border down the sides."""
    S = Sculpt(materials=MATERIALS, default_mat="cloth")
    for side, w, hz, seed in (("F", 0.13, 0.5, 3), ("B", 0.15, 0.48, 5)):
        sg = -1 if side == "F" else 1
        y_s = (kp["yf"] - 0.012) if side == "F" else (kp["yb"] + 0.012)
        top = kp["top_z"] + 0.03
        cone = RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"], hz - 0.1), kp["r_top"], kp["r_hem"] + 0.03,
                         squash=(kp["squash"], 1.0))
        panel = Inter(Shell(cone, 0.005), HalfSpace(V(0, kp["cy"] + sg * 0.03, 0), V(0, -sg, 0)),
                      Slab(V(0, 0, 0), V(1, 0, 0), w), HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
        tongues = Union(*[Ellipsoid(V(x, y_s, hz + 0.22 + dz), V(0.042, 0.3, 0.22)) for x, dz in
                          ((-w * 0.74, 0.02), (-w * 0.25, -0.03), (w * 0.22, 0.01), (w * 0.72, -0.05))], k=0.02)
        reg = Inter(panel, tongues, k=0.004)
        lo, hi = V(-0.3, y_s - 0.12, hz - 0.1), V(0.3, y_s + 0.12, top + 0.03)
        S.add(Bounded(Displace(reg, 0.002, 16.0, 2, seed=seed), lo, hi), 0.0, mat="cloth")
        border = Inter(Offset(panel, 0.0015), tongues, Diff(Slab(V(0, 0, 0), V(1, 0, 0), w + 0.002),
                                                            Slab(V(0, 0, 0), V(1, 0, 0), w - 0.018)), k=0.002)
        S.add(Bounded(border, lo, hi), 0.001, mat="cloth_trim")
    return S


def hand_sculpt(L, side):
    """Gauntlet: fist gripping the haft, plated as an Offset of the hand + flared cuff + knuckle ridge."""
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip", STYLE, grip_r=GRIP_R)
    W = L["wrist_" + side]
    snap = S.snapshot()
    S.add(Bounded(Offset(snap, 0.0085), W - 0.17, W + 0.17), 0.0, mat="steel")
    el, wr, b, Lf = BM.forearm_frame(L, side)
    cuff = Inter(Offset(snap, 0.024), Slab(wr - b * 0.035, b, 0.04), k=0.004)
    S.add(Bounded(cuff, wr - 0.12, wr + 0.12), 0.003, mat="steel")
    S.add(Bounded(Inter(Offset(snap, 0.029), Slab(wr - b * 0.0, b, 0.005), k=0.002), wr - 0.12, wr + 0.12), 0.002,
          mat="trim")
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    sc = L["P"]["hand"] / 0.2
    pts = [W + h * (0.088 * sc) + t * ((0.03 - 0.02 * i) * sc) - n * 0.012 for i in range(4)]
    P = S.project(np.array(pts), offset=0.004)
    S.add(Chain(list(P), 0.008), 0.004, mat="steel")
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


# ============================================================================ rigid gear (per tier)
def helm_shape(H):
    s = H.s
    return Union(Ellipsoid(H(0, 0.006, 0.012), H.r(0.118, 0.134, 0.135)),
                 Ellipsoid(H(0, -0.03, -0.1), H.r(0.108, 0.118, 0.1)),
                 Ellipsoid(H(0, 0.01, -0.17), H.r(0.13, 0.14, 0.07)), k=0.04)


def helm(L, H, tier):
    """Great helm: pointed visor ridge, T eye slit into a black void, breath holes, brow band + rim trim; per-tier
    plume / crest / crown."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    s = H.s
    base = helm_shape(H)
    S.add(base, 0.0, mat="steel")
    ridge = [H(0, -0.125, 0.07), H(0, -0.14, 0.0), H(0, -0.142, -0.06), H(0, -0.13, -0.13), H(0, -0.1, -0.2)]
    S.add(Chain(ridge, [0.01 * s, 0.014 * s, 0.014 * s, 0.012 * s, 0.01 * s], squash=(0.5, 1.0), ref=(1, 0, 0)), 0.03,
          mat="steel")
    skin_ = Diff(Offset(base, 0.03), Offset(base, -0.024))
    front = HalfSpace(H(0, -0.055, 0), V(0, 1, 0))
    slit = Inter(Slab(H(0, 0, -0.012), V(0, 0.2, 1), 0.011 * s), skin_, front, Slab(V(0, 0, 0), V(1, 0, 0), 0.088 * s),
                 k=0.003)
    S.sub(slit, 0.004, mat="void")
    vert = Inter(Slab(V(0, 0, 0), V(1, 0, 0), 0.0085 * s), skin_, front, HalfSpace(H(0, 0, -0.1), V(0, 0, -1)),
                 HalfSpace(H(0, 0, -0.01), V(0, 0, 1)), k=0.003)
    S.sub(vert, 0.004, mat="void")
    for sx in (1, -1):                                              # breath holes on the cheeks
        for j in range(3):
            p = H(sx * (0.05 + 0.012 * j), -0.105 + 0.012 * j, -0.085 - 0.018 * j)
            S.sub(Inter(Sphere(p, 0.0068 * s), skin_), 0.002, mat="void")
    # brow band + lower rim trim + rivets
    S.add(Inter(Offset(base, 0.005), Slab(H(0, 0, 0.055), V(0, 0.25, 1), 0.012 * s), k=0.002), 0.002, mat="trim")
    S.add(Inter(Offset(base, 0.005), Slab(H(0, 0, -0.225), V(0, 0, 1), 0.011 * s), k=0.002), 0.002, mat="trim")
    for i in range(18):
        a = (i + 0.5) / 18 * 2 * math.pi
        p = trace_in(S, H(0, 0.0, 0.06), norm(V(math.sin(a), -math.cos(a), 0.25)), r=0.3)
        S.add(Sphere(p, 0.005), 0.001, mat="trim")
    S.inter(HalfSpace(H(0, 0, -0.235), V(0, 0, -1)))
    # plume / crest per rank
    if tier == "silver":
        pts = [H(0, 0.02, 0.12), H(0, 0.06, 0.16), H(0, 0.12, 0.15), H(0, 0.17, 0.09)]
        S.add(RoundCone(H(0, 0.0, 0.1), H(0, 0.02, 0.145), 0.014 * s, 0.011 * s), 0.01, mat="trim")    # socket
        S.add(Displace(Chain(pts, [0.03 * s, 0.034 * s, 0.028 * s, 0.012 * s]), 0.004, 60.0, 2, seed=5), 0.01,
              mat="plume")
    elif tier == "red":
        pts = [H(0, -0.12, 0.1), H(0, -0.06, 0.19), H(0, 0.03, 0.225), H(0, 0.12, 0.2), H(0, 0.19, 0.12),
               H(0, 0.21, 0.04)]
        S.add(Chain([H(0, -0.11, 0.08), H(0, 0.0, 0.14), H(0, 0.13, 0.1)], 0.01 * s), 0.01, mat="trim")      # crest holder
        S.add(Displace(Chain(pts, [0.02 * s, 0.05 * s, 0.06 * s, 0.055 * s, 0.04 * s, 0.018 * s],
                             squash=(0.4, 1.0), ref=(1, 0, 0)), 0.005, 55.0, 2, seed=6), 0.012, mat="plume")
    else:
        # crown circlet with points
        S.add(Inter(Offset(base, 0.012), Slab(H(0, 0, 0.085), V(0, 0.2, 1), 0.014 * s), k=0.002), 0.003, mat="trim")
        for i in range(8):
            a = (i + 0.5) / 8 * 2 * math.pi
            d = norm(V(math.sin(a), -math.cos(a), 0.0))
            p = trace_in(S, H(0, 0.0, 0.09), d, r=0.3)
            S.add(RoundCone(p - V(0, 0, 0.005), p + V(0, 0, 0.05) * s + d * 0.004, 0.012 * s, 0.002), 0.004, mat="trim")
        pts = [H(0, 0.0, 0.13), H(0, 0.03, 0.22), H(0, 0.11, 0.26), H(0, 0.2, 0.22), H(0, 0.26, 0.12),
               H(0, 0.28, 0.0)]
        S.add(RoundCone(H(0, 0.0, 0.1), H(0, 0.0, 0.16), 0.02 * s, 0.014 * s), 0.01, mat="trim")
        S.add(Displace(Chain(pts, [0.03 * s, 0.05 * s, 0.065 * s, 0.06 * s, 0.045 * s, 0.02 * s],
                             squash=(0.55, 1.0), ref=(1, 0, 0)), 0.006, 50.0, 2, seed=7), 0.014, mat="plume")
    eyes = [H(sx * 0.036, -0.1, -0.014) for sx in (1, -1)]
    return S, eyes


def pauldron(snapA, L, side, tier):
    """Layered steel pauldron (rigid upperarm) sized by rank; haute-piece flange (Col./Gen.), spikes (Gen.)."""
    size, flange, spikes = PAULDRON[tier]
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    cap = sh + a * 0.05 + up * 0.03
    R = 0.15 * size
    t = 0.022 + 0.012 * (size - 1.0)
    lo, hi = cap - 0.3, cap + 0.3
    plane = HalfSpace(sh - up * 0.04, -up)
    inner = HalfSpace(V(float(sh[0]) - sx * 0.085, 0, 0), V(-sx, 0, 0))
    body = Inter(BM.shell(snapA, t, t - 0.01), Sphere(cap, R), plane, inner, k=0.004)
    S.add(Bounded(body, lo, hi), 0.0, mat="steel")
    rim = Inter(BM.shell(snapA, t + 0.004, t - 0.012), Diff(Sphere(cap, R + 0.004), Sphere(cap, R - 0.012)), plane,
                inner, k=0.002)
    S.add(Bounded(rim, lo, hi), 0.002, mat="trim")
    for i in range(3):
        c = sh + a * (0.11 + 0.05 * i)
        tt = t + 0.004 + 0.003 * i
        lame = Inter(BM.shell(snapA, tt, tt - 0.009), Slab(c, a, 0.026), Sphere(cap, R + 0.04), plane, k=0.003)
        S.add(Bounded(lame, lo, hi), 0.0015, mat="steel")
        edge = Inter(BM.shell(snapA, tt + 0.003, tt - 0.01), Slab(c + a * 0.024, a, 0.004), Sphere(cap, R + 0.04), plane,
                     k=0.002)
        S.add(Bounded(edge, lo, hi), 0.001, mat="trim")
    if flange:
        fc = V(float(sh[0]) - sx * 0.035, float(sh[1]) + 0.0, float(sh[2]) + 0.05)
        fl = Inter(Slab(fc, norm(V(sx, 0, -0.25)), 0.006), Sphere(fc + V(sx * 0.02, 0, -0.03), 0.1 * size),
                   HalfSpace(fc - V(0, 0, 0.03), V(0, 0, -1)), k=0.003)
        S.add(Bounded(fl, lo, hi), 0.004, mat="steel")
        S.add(Bounded(Inter(Slab(fc, norm(V(sx, 0, -0.25)), 0.008), Diff(Sphere(fc + V(sx * 0.02, 0, -0.03), 0.1 * size),
                                                                           Sphere(fc + V(sx * 0.02, 0, -0.03), 0.09 * size)),
                            HalfSpace(fc - V(0, 0, 0.03), V(0, 0, -1)), k=0.002), lo, hi), 0.002, mat="trim")
    for j in range(7):
        ang = -1.0 + j * (2.0 / 6)
        side_v = norm(np.cross(a, up)) * sx
        d = norm(up * math.cos(ang) * 0.9 + side_v * math.sin(ang) * 0.9 + a * 0.15)
        p = trace_in(S, sh + a * 0.05, d)
        S.add(Sphere(p, 0.0065), 0.001, mat="trim")
    if spikes:
        for j, (da, du) in enumerate(((0.02, 0.9), (0.1, 0.7))):
            d = norm(up * du + a * da + V(sx * 0.35, 0, 0))
            p = trace_in(S, sh + a * 0.04, d)
            S.add(RoundCone(p - d * 0.006, p + d * (0.07 - 0.015 * j), 0.016, 0.0022), 0.004, mat="steel")
    return S


def gear_bounds(name, L):
    if name.startswith("helm"):
        return V(-0.3, -0.35, 1.6), V(0.3, 0.4, 2.3)
    sh = L["shoulder_" + name[-1]]
    return sh - 0.3, sh + 0.3


def build_gear(S_body, L, H, names, h=0.0035):
    t = time.time()
    snapA = charkit.GridSDF(S_body, h=h, lo=V(-0.75, -0.45, 1.2), hi=V(0.75, 0.45, 1.95))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    out, eyes = {}, None
    for nm in names:
        tier = nm.split("_")[1]
        if nm.startswith("helm"):
            Sg, eyes = helm(L, H, tier)
            out[nm] = (Sg, "head")
        else:
            out[nm] = (pauldron(snapA, L, nm[-1], tier), "upperarm_" + nm[-1])
    return out, eyes


GEAR_TRIS = {"helm": 1700, "pauldron": 650}


# ============================================================================ palette + painters
# Value ladder r2 (critic r1: plate read chalk-white = same value as skeleton bone under the stage 1 dusk key).
# Plate is now mid-dark BLUED / blackened steel (albedo luma ~36%, metal 0.85, rough ~0.45) whose read comes from
# the bright edge wear on ridges/rims (~75%) against dark cavities (~12%) -- real reflection contrast, never a pale
# wash. Each rank owns a LARGE colour mass (pauldrons + cuirass + upper faulds; Gen. also the helm):
#   Lt. = oxidised silver-blue plate, Col. = crimson enamel (glossy dielectric, chipped to steel on edges),
#   Gen. = gilded plate. Trim: iron / brass / gold. Tabard slate / crimson / black-violet. Visor void ~3%.
PAL = dict(
    skin=shaders.srgb(40, 40, 46), skin_rough=0.6,
    steel=shaders.srgb(78, 84, 98), steel_edge=shaders.srgb(188, 194, 206),
    trim=shaders.srgb(96, 96, 104), trim_patina=shaders.srgb(52, 48, 46),
    trim_patina_amt=0.3, bronze=shaders.srgb(170, 128, 66), bronze_patina=shaders.srgb(70, 60, 44),
    bronze_patina_amt=0.3, iron=shaders.srgb(90, 90, 96), iron_patina=shaders.srgb(80, 60, 44), iron_patina_amt=0.3,
    cloth=shaders.srgb(52, 64, 92), cloth_trim=shaders.srgb(170, 170, 176),
    leather=shaders.srgb(58, 40, 28), leather_worn=shaders.srgb(110, 80, 56),
    leather_dark=shaders.srgb(34, 24, 18), leather_dark_worn=shaders.srgb(80, 60, 44),
    void=shaders.srgb(6, 7, 10), void_glow=shaders.srgb(20, 60, 80),
    plume=shaders.srgb(40, 74, 170), glow=(0.55, 0.9, 1.0), glow_strength=3.0,
    # rank colour mass (enamel on pauldrons / cuirass / faulds)
    enamel=shaders.srgb(120, 150, 186), enamel_dark=shaders.srgb(40, 54, 74), enamel_metal=0.8, enamel_rough=0.34,
    enamel_helm=False,
)
TIER_PAL = {
    "silver": {},
    "red": dict(cloth=shaders.srgb(146, 22, 26), cloth_trim=shaders.srgb(206, 164, 72),
                trim=shaders.srgb(196, 146, 66), trim_patina=shaders.srgb(90, 70, 40), plume=shaders.srgb(180, 22, 28),
                enamel=shaders.srgb(168, 20, 24), enamel_dark=shaders.srgb(52, 6, 10), enamel_metal=0.05,
                enamel_rough=0.26),
    "gold": dict(cloth=shaders.srgb(40, 22, 52), cloth_trim=shaders.srgb(218, 176, 76),
                 trim=shaders.srgb(226, 178, 74), trim_patina=shaders.srgb(120, 90, 40), trim_patina_amt=0.15,
                 plume=shaders.srgb(236, 214, 150), enamel=shaders.srgb(222, 164, 58),
                 enamel_dark=shaders.srgb(86, 52, 18), enamel_metal=1.0, enamel_rough=0.3, enamel_helm=True),
}


def enamel_mask(c, pal):
    """Which steel verts carry the rank colour: pauldron parts, the cuirass + upper faulds on the body (not arms,
    not the gorget / legs), the helm for the Gen."""
    part = c.x.get("part", "")
    if part.startswith("pauldron"):
        return np.ones(c.n, bool)
    if part.startswith("helm"):
        return np.full(c.n, bool(pal.get("enamel_helm")))
    if part != "body":
        return np.zeros(c.n, bool)
    L = c.L
    P = c.P
    m = (P[:, 2] > 0.935) & (P[:, 2] < float(L["neck"][2]) - 0.035)
    for s in ("L", "R"):
        sh, el = L["shoulder_" + s], L["elbow_" + s]
        ax = el - sh
        ln = float(np.linalg.norm(ax))
        ax = ax / ln
        t = (P - sh) @ ax
        d = np.linalg.norm(P - sh - np.outer(t, ax), axis=1)
        m &= ~((t > 0.03) & (d < 0.14))
    return m


def p_plate(c, pal):
    """Blued / blackened battered plate: dark mid value, bright worn edges on every ridge + rim, fine bright
    scratches, grime-black cavities, broad oil-slick value drift. Rank enamel mass where enamel_mask()."""
    n1 = c.noise(6.0, 3, 401)
    n2 = c.noise(70.0, 2, 402)
    n3 = c.noise(14.0, 2, 406)
    scratch = shaders.smooth01(np.abs(c.noise(35.0, 1, 403)), 0.0, 0.02)
    base = pal["steel"]
    edge = pal["steel_edge"]
    rgb = np.tile(base, (c.n, 1)) * (0.9 + 0.16 * n1 + 0.04 * n2)[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(70, 70, 92), 0.25 * shaders.smooth01(n3, 0.2, 0.8))   # blued drift
    wear = np.clip(c.ridge * 1.3 + 0.25 * shaders.smooth01(n2, 0.55, 0.9) * c.ridge, 0, 1)
    rgb = shaders.mix(rgb, edge, 0.85 * wear)
    rgb = shaders.mix(rgb, edge * 0.8, (1 - scratch) * 0.3 * (1 - c.cav))
    rgb = shaders.mix(rgb, base * 0.28, shaders.smooth01(c.cav, 0.03, 0.45) * 0.9)
    rough = 0.46 + 0.1 * n1 + 0.2 * c.cav - 0.22 * wear
    metal = np.full(c.n, 0.85)
    m = enamel_mask(c, pal)
    if m.any():
        en, ed = pal["enamel"], pal["enamel_dark"]
        e = np.tile(en, (c.n, 1)) * (0.92 + 0.12 * n1 + 0.04 * n2)[:, None]
        e = shaders.mix(e, ed, shaders.smooth01(c.cav, 0.03, 0.45) * 0.85)
        e = shaders.mix(e, np.minimum(en * 1.25 + 0.04, 1), 0.35 * c.ridge)
        chip = np.clip(shaders.smooth01(c.ridge, 0.45, 0.85) + 0.6 * shaders.smooth01(n2, 0.7, 0.85) * c.ridge, 0, 1)
        e = shaders.mix(e, edge, chip * 0.9)                                   # chipped to bare steel on the edges
        er = pal["enamel_rough"] + 0.08 * n1 + 0.15 * c.cav
        em = pal["enamel_metal"] * (1 - chip) + 0.85 * chip
        rgb = np.where(m[:, None], e, rgb)
        rough = np.where(m, er, rough)
        metal = np.where(m, em, metal)
    return shaders.out(c.n, rgb, np.clip(rough, 0.18, 0.8), metal)


def p_mail(c, pal):
    rgb = np.tile(pal["skin"], (c.n, 1)) * (0.85 + 0.2 * c.noise(40.0, 2, 404))[:, None]
    rgb = shaders.mix(rgb, rgb * 0.4, c.cav)
    return shaders.out(c.n, rgb, 0.55, np.full(c.n, 0.5))


def p_plume(c, pal):
    """Horsehair: strand streaks along the plume, darker roots / clump gaps, sheen on ridges."""
    P = c.P
    st = 0.5 + 0.5 * np.sin(P[:, 0] * 900.0 + 8.0 * c.noise(30.0, 2, 405))
    rgb = np.tile(pal["plume"], (c.n, 1)) * (0.8 + 0.3 * st)[:, None]
    rgb = shaders.mix(rgb, pal["plume"] * 0.35, np.clip(c.cav * 1.2, 0, 1))
    rgb = shaders.mix(rgb, np.minimum(pal["plume"] * 1.35 + 0.05, 1), 0.3 * c.ridge)
    return shaders.out(c.n, rgb, 0.75)


def p_void(c, pal):
    rgb = np.tile(pal["void"], (c.n, 1))
    eyes = c.x.get("eyes") or []
    if eyes:
        d = np.min([np.linalg.norm(c.P - V(*e), axis=1) for e in eyes], axis=0)
        rgb = shaders.mix(rgb, pal["void_glow"], np.clip(1.0 - d / 0.04, 0, 1) ** 1.6)
    return shaders.out(c.n, rgb, 0.9)


PAINTERS = {"steel": p_plate, "skin": p_mail, "eye": p_mail, "nail": p_mail, "brow": p_mail,
            "trim": lambda c, pal: shaders.p_metal(c, pal, "trim"), "void": p_void, "plume": p_plume,
            "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth"), "cloth_trim": lambda c, pal: BM.p_rag(c, pal, "cloth_trim")}


def tier_pal(tier):
    p = dict(PAL)
    p.update(TIER_PAL[tier])
    return p


# ============================================================================ previews
MAT_COLORS = {"skin": (0.1, 0.1, 0.11), "eye": (0.1, 0.1, 0.1), "nail": (0.1, 0.1, 0.1), "brow": (0.1, 0.1, 0.1),
              "steel": (0.62, 0.64, 0.68), "trim": (0.6, 0.45, 0.2), "cloth": (0.12, 0.15, 0.3),
              "cloth_trim": (0.6, 0.5, 0.2), "leather": (0.2, 0.13, 0.08), "leather_dark": (0.08, 0.06, 0.05),
              "bronze": (0.6, 0.45, 0.2), "iron": (0.3, 0.3, 0.32), "void": (0.01, 0.01, 0.01),
              "plume": (0.6, 0.08, 0.08), "glow": (0.6, 0.9, 1.0)}


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(KNIGHT)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = body_sculpt(L)
    H = info["H"]
    tiers = ("silver", "red", "gold")
    G, eyes = build_gear(S, L, H, [g for t in tiers for g in TIERS[t]])
    base = [charkit.mesh_sculpt(S, "body", args.h or 0.004, colors=MAT_COLORS),
            charkit.mesh_sculpt(tabard_skirt(info["kilt"]), "kilt", 0.003, colors=MAT_COLORS),
            charkit.mesh_sculpt(BS.glow_sculpt(eyes, 0.009), "glow", 0.0015, colors=MAT_COLORS)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.002, w - 0.17, w + 0.17, colors=MAT_COLORS))
    for i, tier in enumerate(tiers):
        dx = V(i * 1.25, 0, 0)
        for g in TIERS[tier]:
            o = charkit.mesh_sculpt(G[g][0], g, 0.003, *gear_bounds(g, L), colors=MAT_COLORS)
            o.location = dx
        if i:
            for b in base:
                o = meshutil.duplicate(b, b.name + f"_{i}")
                o.location = dx
    views = [dict(target=(1.25, 0, 1.05), ortho=3.9, yaw=y, dist=9, pitch=4) for y in (0, 35)]
    preview.render_views(os.path.join(out, "knight_full.png"), views, res=(1000, 820))
    print(f"[knight] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.03)) / 0.1, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.25)


def build(args):
    T0 = time.time()
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_hand, h_kilt, h_gear = ((0.0042, 0.0014, 0.003, 0.002) if fast else (0.0022, 0.0009, 0.0016, 0.0011))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(KNIGHT)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["gold"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}}

    t = time.time()
    S, info = body_sculpt(L)
    H = info["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = tabard_skirt(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    G, eyes = build_gear(S, L, H, [g for t_ in tiers for g in TIERS[t_]])
    Sglow = BS.glow_sculpt(eyes, 0.009)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN)

    t = time.time()
    his = {}
    if args.stage != "skin":
        his["body"] = [pipeline.sculpt_mesh(S, "body_hi", h_body)]
        charkit.drop_islands(his["body"][0], h_body)
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        for nm, (Sg, _) in G.items():
            o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *gear_bounds(nm, L))
            charkit.drop_islands(o, h_gear, min_verts=40)
            his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.0036 if not fast else 0.0045
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, 300)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, args.hand_tris, w - 0.17, w + 0.17,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.003, args.kilt_tris)
    for nm, (Sg, _) in G.items():
        sym = nm.startswith("helm")
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0026, GEAR_TRIS[nm.split("_")[0]], *gear_bounds(nm, L),
                                   symmetry=sym, clean=lambda o: charkit.drop_islands(o, 0.0026, min_verts=30))
    glow_lo = pipeline.lowpoly(Sglow, "glow_lo", 0.0015, 100, symmetry=False)
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(los["body"], arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN)
    for nm, (_, bone) in G.items():
        charkit.rigid_bind(los[nm], arm, bone)
    charkit.rigid_bind(glow_lo, arm, "head")
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt"]
    if args.stage == "skin":
        obs = [los[k] for k in common + TIERS["gold"]]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.log(f"tris gold {meshutil.tri_count(body)}")
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "knight_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=1.0, head_density=0.6)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.9)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.25 if nm.startswith("helm") else 1.0)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    extra_p = dict(eyes=[tuple(e) for e in eyes])
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.012, 0.03), "hand_L": (0.006, 0.014), "hand_R": (0.006, 0.014), "kilt": (0.005, 0.012)}
    for tier in tiers:
        tt = time.time()
        pal = tier_pal(tier)
        parts = common + TIERS[tier]
        report["uv_fill_" + tier] = pipeline.pack_atlas_shape([los[k] for k in parts], margin_px=6 if not fast else 4,
                                                             res=res)
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, dict(extra_p, part=k), painters=PAINTERS)
        for o in all_hi + list(los.values()) + [glow_lo]:
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        prefix = f"{ASSET}_{tier}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix, tint=(0.46, 0.44, 0.48))
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        gmat = BS.glow_material("M_" + prefix + "_glow", pal["glow"], pal["glow_strength"])
        dups = []
        for k in parts:
            o = meshutil.duplicate(los[k], f"{k}_{tier}")
            o.data.materials.clear()
            o.data.materials.append(mat)
            pipeline.strip_for_export(o)
            dups.append(o)
        bpy.context.view_layer.update()
        body = meshutil.join(dups, prefix + "_mesh")
        body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
        g = meshutil.duplicate(glow_lo, f"glow_{tier}")
        g.data.materials.clear()
        g.data.materials.append(gmat)
        pipeline.strip_for_export(g)
        body = meshutil.join([body, g], prefix + "_mesh")
        rep = {"tris": meshutil.tri_count(body)}
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=q["bad"], soft=q["soft"], pairs=q["pairs"]) for k, q in qa.items()}
        pipeline.log(f"[{tier}] stretch QA: " + ", ".join(f"{k}: bad {q['bad']} soft {q['soft']}" for k, q in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "silver":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(os.path.join(HERE, "out", "knight_report.json"), report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "knight_report.json"), report)
    pipeline.log(f"DONE {ASSET} {tiers} in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--tiers", default=None)
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=8400)
    ap.add_argument("--hand-tris", type=int, default=520)
    ap.add_argument("--kilt-tris", type=int, default=800)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
