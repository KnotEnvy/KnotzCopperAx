"""Hollow Knight team fork (r22 + r23 forged-plate fix): scratch-only hollow plate ranks, 1024 atlas.

Usage (through tools/blender-run.mjs): --fast|--release --tiers silver,red,gold --out <scratch-dir>.
One mail/body/hand/tabard base is generated and weighted once; rank gear and palette dress it.
No face, skull, skin, cape, tower shield, or boss asset is built. Sept builder is unchanged.
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
import skelknight_team as TEAM

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
OUT_MODELS = TEAM.out_dir("knight", "knight", "out", "iter0")
OUT_TEX = os.path.join(OUT_MODELS, "textures")
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
             "bronze", "iron", "void", "edge"]
GEAR_MATS = ["steel", "trim", "void", "plume", "leather", "cloth", "edge"]
KINDS = {"skin": "mail", "steel": "iron", "trim": "bronze", "cloth_trim": "cloth", "void": "leather",
         "edge": "iron", "plume": "cloth", "eye": "leather", "nail": "iron", "brow": "leather"}
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
CONFIG = dict(seed=23, atlas=1024, tabard_half_width=0.17, tabard_hem=0.36,
              mail_radius_arm=0.069, mail_radius_forearm=0.057, mail_radius_thigh=0.083,
              mail_radius_shin=0.058, pauldron_radius=0.15,
              crest_height=dict(silver=0.08, red=0.16, gold=0.24))
PAULDRON = {"silver": (1.1, False, False), "red": (1.3, True, False), "gold": (1.45, True, True)}


# ============================================================================ body + fused plate
def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {}
    # The only body is a quiet MAIL envelope. No head, muscles, face, skin or hidden anatomy.
    # Tagged envelopes retain the Sept skeleton's part-weight method at anatomical joints.
    tag = BS.Tagger(S)
    S.add(Ellipsoid(V(0, 0.012, 1.38), V(0.218, 0.142, 0.23)), 0.0, mat="skin")
    tag("chest")
    S.add(RoundCone(V(0, 0.015, 1.13), V(0, 0.015, 1.43), 0.155, 0.19, squash=(0.78, 1)), 0.035, mat="skin")
    tag("spine")
    S.add(Ellipsoid(V(0, 0.015, 1.015), V(0.19, 0.132, 0.12)), 0.028, mat="skin")
    tag("hips")
    S.add(RoundCone(L["neck"] - V(0, 0, 0.04), L["head"] - V(0, 0, 0.035), 0.098, 0.09), 0.025, mat="skin")
    tag("neck")
    for side in ("L", "R"):
        sh, el, wr = [L[x + side] for x in ("shoulder_", "elbow_", "wrist_")]
        S.add(Capsule(V(0, 0.012, 1.54), sh, 0.085), 0.025, mat="skin")
        tag("clavicle_" + side)
        S.add(RoundCone(sh, el, 0.091, CONFIG["mail_radius_arm"]), 0.018, mat="skin")
        tag("upperarm_" + side)
        S.add(RoundCone(el, wr, CONFIG["mail_radius_arm"], CONFIG["mail_radius_forearm"]), 0.015, mat="skin")
        tag("forearm_" + side)
        hp, kn, an = [L[x + side] for x in ("hip_", "knee_", "ankle_")]
        S.add(RoundCone(hp, kn, 0.091, CONFIG["mail_radius_thigh"]), 0.025, mat="skin")
        tag("thigh_" + side)
        S.add(RoundCone(kn, an, CONFIG["mail_radius_shin"] + 0.012, CONFIG["mail_radius_shin"]), 0.016, mat="skin")
        tag("shin_" + side)
        S.add(Ellipsoid(an + V(0, -0.07, -0.03), V(0.065, 0.15, 0.06)), 0.018, mat="skin")
        tag("foot_" + side)
    H = anatomy.HeadFrame(L)
    info["H"] = H
    info["weight_sculpt"] = S.snapshot()
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
    # Keep mail below the open visor: there is no head-shaped support in its black cavity.
    S.inter(HalfSpace(V(0, 0, 1.71), V(0, 0, 1)))
    info["kilt"] = kilt_params(S)
    return S, info


def limb_region(snap, t, a, b, pad0=0.0, pad1=0.0, r=0.2):
    ax = norm(b - a)
    Ln = float(np.linalg.norm(b - a))
    c = a + ax * (Ln * 0.5 + (pad1 - pad0) * 0.5)
    return Inter(Offset(snap, t), Slab(c, ax, Ln * 0.5 + (pad0 + pad1) * 0.5), Sphere((a + b) / 2, Ln * 0.5 + r),
                 k=0.004)


def add_limb_lames(S, snap, a, b, start, end, thick, count=3):
    axis=norm(b-a); length=float(np.linalg.norm(b-a)); span=(end-start)*length/count
    for i in range(count):
        c=a+axis*(start*length+(i+.5)*span)
        t=thick-.004*i
        # Upper plate overlaps the following smaller plate by 8 mm.
        section=Inter(Offset(snap,t),Slab(c,axis,span*.5+.006),
                      Sphere(c,span+.14),k=.002)
        S.add(Bounded(section,c-.25,c+.25),.001,mat="steel")
        rim=Inter(Offset(snap,t+.006),Slab(c+axis*(span*.5+.002),axis,.0055),
                  Sphere(c,span+.14),k=.0015)
        S.add(Bounded(rim,c-.25,c+.25),.001,mat="edge")
        # A pair of seated hinge/rivet heads per lame; the projection embeds the roots.
        for sign in (-1,1):
            q=S.project(np.array([c+V(sign*.040,-.28,0)]),offset=-.001)[0]
            S.add(Sphere(q,.0065),.001,mat="trim")


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
    # Forged breastplate: a broad angular keel and two flanks, buried in the mail envelope.
    breast = Inter(RoundBox(V(0, -0.10, 1.39), V(0.214, 0.112, 0.205), r=0.028),
                   HalfSpace(V(0, -0.235, 1.39), norm(V(0.38, -1, -0.05))),
                   HalfSpace(V(0, -0.235, 1.39), norm(V(-0.38, -1, -0.05))),
                   HalfSpace(V(0, 0, 1.17), V(0, 0, -1)),
                   HalfSpace(V(.165,0,1.18),norm(V(1,0,-.25))),
                   HalfSpace(V(-.165,0,1.18),norm(V(-1,0,-.25))), k=0.004)
    S.add(breast, 0.006, mat="steel")
    # medial ridge down the breastplate
    P = S.project(np.array([V(0, -0.4, z) for z in np.linspace(BELT_Z + 0.04, float(nk[2]) - 0.1, 10)]), offset=0.0)
    S.add(Chain(list(P), 0.011, squash=(0.55, 1.0), ref=(1, 0, 0)), 0.012, mat="steel")
    # A riveted upper band and arm-hole rolls remain visible beside the wide rank tabard.
    for sx in (-1, 1):
        pts = S.project(np.array([V(sx*x, -0.4, z) for x,z in
                        ((.07,1.58),(.13,1.565),(.175,1.53),(.202,1.47),(.205,1.36),(.186,1.24))]), offset=-0.002)
        S.add(Chain(list(pts), 0.007), 0.0015, mat="edge")
        for q in pts[1::2]:
            S.add(Sphere(q+V(0,-0.002,0),0.008),0.001,mat="trim")
    # faulds: 3 stepped hoops below the waist
    for i in range(3):
        z = BELT_Z - 0.05 - 0.05 * i
        f = Inter(Offset(snap, 0.040 + 0.014 * i), Slab(V(0, 0, z), V(0, 0.15, 1), 0.026), k=0.003)
        S.add(Bounded(f, V(-0.5, -0.4, z - 0.08), V(0.5, 0.4, z + 0.08)), 0.002, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.047 + 0.014 * i), Slab(V(0, 0, z - 0.022), V(0, 0.15, 1), 0.007), k=0.002),
                      V(-0.5, -0.4, z - 0.08), V(0.5, 0.4, z + 0.08)), 0.002, mat="edge")
    # gorget: two lames round the neck, rising into the helm
    for i, (t, z0, z1) in enumerate(((0.03, nk[2] - 0.06, nk[2] + 0.02), (0.022, nk[2] + 0.0, nk[2] + 0.1))):
        g = Inter(Offset(snap, t), Sphere(nk + V(0, 0, 0.04), 0.16), HalfSpace(V(0, 0, float(z0)), V(0, 0, -1)),
                  HalfSpace(V(0, 0, float(z1)), V(0, 0, 1)), k=0.004)
        S.add(Bounded(g, nk - 0.25, nk + 0.25), 0.002, mat="steel")
    for s in ("L", "R"):
        sx = 1 if s == "L" else -1
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        # rerebrace + vambrace + couter with a fan wing
        S.add(Bounded(limb_region(snap, 0.008, sh, el, pad0=-0.08, pad1=-0.05), sh - 0.4, sh + 0.4), 0.002,
              mat="steel")
        S.add(Bounded(limb_region(snap, 0.007, el, wr, pad0=-0.05, pad1=-0.03), el - 0.4, el + 0.4), 0.002,
              mat="steel")
        cp = el + V(0, 0.02, 0)
        S.add(Bounded(Inter(Offset(snap, 0.03), Sphere(cp, 0.065), k=0.004), el - 0.12, el + 0.12), 0.004,
              mat="steel")
        n_out = norm(V(sx * 0.6, 0.8, 0.0))
        fan = Inter(Slab(cp + n_out * 0.03, n_out, 0.005), Sphere(cp + n_out * 0.02, 0.07), k=0.003)
        S.add(Bounded(fan, el - 0.14, el + 0.14), 0.004, mat="steel")
        # Three transverse articulated plates replace the unbroken cylinder on each arm.
        add_limb_lames(S, snap, sh, el, .22, .77, .022, count=2)
        add_limb_lames(S, snap, el, wr, .18, .81, .020, count=3)
        # The couter fan is a flattened forged leaf, not a circular washer.
        fan_pts = [el+V(sx*.040,-.025,.045),el+V(sx*.105,-.015,.018),
                   el+V(sx*.118,.014,-.027),el+V(sx*.052,.025,-.042)]
        S.add(Chain(fan_pts,[.014,.012,.010,.016],squash=(.42,1),ref=(0,1,0)),.004,mat="edge")
        # legs: cuisse, poleyn + fan, greave, sabaton
        hp, kn, an = L["hip_" + s], L["knee_" + s], L["ankle_" + s]
        S.add(Bounded(limb_region(snap, 0.008, hp, kn, pad0=-0.04, pad1=-0.06), hp - 0.45, hp + 0.45), 0.002,
              mat="steel")
        S.add(Bounded(limb_region(snap, 0.007, kn, an, pad0=-0.06, pad1=0.02), kn - 0.5, kn + 0.5), 0.002,
              mat="steel")
        pc = kn + V(0, -0.045, 0.0)
        S.add(Bounded(Inter(Offset(snap, 0.032), Sphere(pc, 0.075), HalfSpace(V(0, float(kn[1]) + 0.01, 0), V(0, 1, 0)),
                            k=0.004), kn - 0.14, kn + 0.14), 0.004, mat="steel")
        wing = Inter(Slab(pc + V(sx * 0.055, 0, 0), norm(V(sx, -0.3, 0)), 0.005), Sphere(pc + V(sx * 0.04, 0, 0), 0.06),
                     k=0.003)
        S.add(Bounded(wing, kn - 0.14, kn + 0.14), 0.004, mat="steel")
        S.add(Bounded(Inter(Offset(snap, 0.022), Sphere(pc + V(0, -0.02, 0), 0.04), k=0.003), kn - 0.14, kn + 0.14),
              0.003, mat="trim")
        add_limb_lames(S, snap, hp, kn, .18, .76, .024, count=3)
        add_limb_lames(S, snap, kn, an, .18, .83, .023, count=3)
        # Fan-shaped knee wing, with a rolled outward-pointing edge.
        fan_pts = [kn+V(sx*.045,-.070,.045),kn+V(sx*.105,-.050,.018),
                   kn+V(sx*.123,-.025,-.020),kn+V(sx*.055,-.045,-.053)]
        S.add(Chain(fan_pts,[.014,.012,.010,.016],squash=(.42,1),ref=(0,1,0)),.003,mat="edge")
        foot_reg = Inter(Offset(snap, 0.014), HalfSpace(V(0, 0, 0.14), V(0, 0, 1)),
                         Sphere(an + V(0, -0.08, -0.04), 0.24), k=0.004)
        S.add(Bounded(foot_reg, an - 0.3, an + 0.3), 0.002, mat="steel")
        for j in range(3):
            ball = L["ball_" + s]
            c = an + (ball - an) * (0.35 + 0.3 * j)
            lame = Inter(Offset(snap, 0.019), Slab(c, norm(V(0, -1, 0.5)), 0.007),
                         HalfSpace(V(0, 0, 0.14), V(0, 0, 1)), Sphere(an, 0.25), k=0.002)
            S.add(Bounded(lame, an - 0.3, an + 0.3), 0.002, mat="trim")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def tabard_top(S, snap, L):
    """Tattered tabard panels fused over the breastplate + back (cloth), with a trim border."""
    nk = L["neck"]
    for sy in (-1, 1):
        w = CONFIG["tabard_half_width"]
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
    return dict(top_z=BELT_Z - 0.01, hem_z=CONFIG["tabard_hem"], r_top=rx, r_hem=rx * 1.12, squash=ry / rx, cy=float(yf + yb) / 2,
                yf=float(yf), yb=float(yb))


def tabard_skirt(kp):
    """Continuous broad front/back panels, buried in the belt and torn only at the hem."""
    S = Sculpt(materials=MATERIALS, default_mat="cloth")
    w, hz = CONFIG["tabard_half_width"], CONFIG["tabard_hem"]
    top = kp["top_z"] + 0.035
    for side, seed in (("F", 3), ("B", 5)):
        sg = -1 if side == "F" else 1
        # Conforming radius at the belt. The 9 mm shell overlaps the belt; no detached lower rag.
        cone = RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"], hz - 0.08),
                         kp["r_top"] - 0.012, kp["r_top"] + 0.055, squash=(kp["squash"], 1.0))
        panel = Inter(Shell(cone, 0.006), HalfSpace(V(0, kp["cy"] + sg * 0.04, 0), V(0, -sg, 0)),
                      Slab(V(0, 0, 0), V(1, 0, 0), w), HalfSpace(V(0, 0, top), V(0, 0, 1)),
                      HalfSpace(V(0, 0, hz), V(0, 0, -1)), k=0.002)
        # Remove triangular bites near the bottom only; the full upper panel stays continuous.
        for x, dz, rr in ((-0.11, 0.0, 0.028), (-0.035, -0.015, 0.035), (0.07, 0.01, 0.026)):
            panel = Diff(panel, Ellipsoid(V(x, kp["cy"], hz + dz), V(rr, 0.5, 0.05)), k=0.002)
        S.add(panel, 0.0, mat="cloth")
        border = Inter(Offset(panel, 0.001), Diff(Slab(V(0, 0, 0), V(1, 0, 0), w + 0.002),
                                                   Slab(V(0, 0, 0), V(1, 0, 0), w - 0.012)), k=0.001)
        S.add(border, 0.001, mat="cloth_trim")
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
    # Faceted bell: planar cheek flanks and a domed crown, with an outward flare below.
    bell=Union(RoundBox(H(0,.005,-.075),H.r(.122,.128,.158),r=.055),
               Ellipsoid(H(0,.012,.012),H.r(.119,.133,.128)),
               RoundBox(H(0,.009,-.190),H.r(.133,.141,.045),r=.028),k=.010)
    return Inter(bell,HalfSpace(H(.125,-.075,0),norm(V(.85,-.30,0))),
                 HalfSpace(H(-.125,-.075,0),norm(V(-.85,-.30,0))),k=.004)


def helm(L, H, tier):
    """Forged great helm with brow, cheek plates, riveted rim and a black hollow visor."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    base = helm_shape(H)
    S.add(base, 0.0, mat="steel")
    # Raised brow and paired cheek planes are forged into the bell before the hollow opening is cut.
    for sx in (-1,1):
        cheek=RoundBox(H(sx*.095,-.085,-.128),H.r(.038,.036,.098),r=.025)
        S.add(cheek,.005,mat="steel")
        brow=[H(0,-.135,.043),H(sx*.052,-.141,.024),H(sx*.095,-.123,-.002)]
        S.add(Chain(brow,[.012,.011,.009]),.003,mat="edge")
    # A long, broad vertical opening with arched upper corners. No physical head is built anywhere.
    opening = Union(RoundBox(H(0, -0.16, -0.115), H.r(0.074, 0.12, 0.105), r=0.012),
                    Ellipsoid(H(0, -0.16, -0.035), H.r(0.083, 0.12, 0.066)), k=0.008)
    S.sub(opening, 0.003, mat="void")
    # The cavity wall is unlit black; a recessed void backing prevents seeing the background through it.
    # Backing is fused into the shell on every side; it is not a skull-shaped object.
    S.add(Inter(Offset(base, -0.016), HalfSpace(H(0, -0.068, 0), V(0, -1, 0))), 0.0, mat="void")
    for sx in (-1, 1):
        rim = [H(sx * 0.076, -0.115, -0.218), H(sx * 0.083, -0.13, -0.10),
               H(sx * 0.077, -0.132, -0.02), H(sx * 0.047, -0.13, 0.027), H(0, -0.13, 0.036)]
        # Project the rim onto the carved bell, then bury it to eliminate hovering trim.
        pts = S.project(np.array(rim), offset=-0.002)
        S.add(Chain(list(pts), 0.008), 0.002, mat="edge")
        for x,z in ((.112,-.176),(.116,-.119),(.111,-.060),(.096,.008)):
            q=S.project(np.array([H(sx*x,-.28,z)]),offset=-.002)[0]
            S.add(Sphere(q,.0065),.001,mat="trim")
    S.add(Inter(Offset(base, 0.004), Slab(H(0, 0, -0.218), V(0, 0, 1), 0.009),
                Diff(Offset(base, 0.005), Offset(base, -0.009)), k=0.001), 0.002, mat="trim")
    # A double engraved band at the rim, both bright and dark, visible at 4x.
    for z in (-.201,-.224):
        band=Inter(Offset(base,.006),Slab(H(0,0,z),V(0,0,1),.0035),
                   Diff(Offset(base,.008),Offset(base,-.012)),k=.001)
        S.add(band,.001,mat="edge")
    S.inter(HalfSpace(H(0, 0, -0.235), V(0, 0, -1)))
    # Thin sagittal crest, rooted in the crown; exact height ladder is measured from the bell crown.
    zc = float(H(0, 0, 0.149)[2])
    height = CONFIG["crest_height"][tier]
    S.add(RoundBox(V(0, 0.01, zc - 0.005), V(0.014, 0.075, 0.014), r=0.009), 0.01, mat="trim")
    crest = [V(0, -0.07, zc - 0.005), V(0, -0.035, zc + height - 0.025),
             V(0, 0.055, zc + height - 0.022), V(0, 0.15, zc + height * 0.57),
             V(0, 0.18, zc + 0.005)]
    S.add(Chain(crest, [0.018, 0.024, 0.022, 0.018, 0.008], squash=(0.5, 1), ref=(1, 0, 0)),
          0.006, mat="plume")
    S.add(Ellipsoid(V(0, 0.04, zc + height*0.37), V(0.017, 0.12, height*0.61)),
          0.003, mat="plume")
    if tier == "gold":
        # Crown ridge is rooted directly in the bell; regular troops have no boss ornaments.
        for sx in (-1, 1):
            p = H(sx * 0.078, 0.0, 0.102)
            S.add(RoundCone(p - V(0, 0, 0.014), p + V(sx * 0.008, 0, 0.047), 0.013, 0.002),
                  0.006, mat="trim")
    eyes = [H(sx * 0.036, -0.073, -0.037) for sx in (-1, 1)]
    return S, eyes


def pauldron(snapA, L, side, tier):
    """A shaped shoulder cap over two descending lames; all roots overlap the mail/preceding plate."""
    size, flange, spikes=PAULDRON[tier]
    S=Sculpt(materials=GEAR_MATS,default_mat="steel")
    sx=1 if side=="L" else -1
    sh,el=L["shoulder_"+side],L["elbow_"+side]
    a=norm(el-sh)
    up=norm(V(0,0,1)-a*float(np.dot(V(0,0,1),a)))
    cross=norm(np.cross(a,up))
    M=np.column_stack([cross,up,a])
    # Rounded shoulder roof, broad front/back but not an open barrel at the elbow.
    capc=sh+a*.028+up*.010
    R=.117+.030*(size-1)
    roof=Inter(Ellipsoid(capc,V(R*.98,R*.90,.135),M),
               HalfSpace(sh-up*.028,-up),HalfSpace(sh-a*.075,-a),k=.003)
    S.add(roof,.0,mat="steel")
    # Each lame is a tapered, domed closed volume with a crisp lower cut and a rolled edge.
    for i in range(3):
        t0=-.025+i*.073
        t1=t0+.112
        c=sh+a*((t0+t1)*.5)+up*.006
        r=R-.012*i
        dome=Ellipsoid(sh+a*(t0+.012)+up*.003,V(r,r*.86,.140),M)
        reg=Inter(dome,Slab(c,a,(t1-t0)*.5),HalfSpace(sh-up*.038,-up),k=.002)
        S.add(Bounded(reg,sh-.31,sh+.31),.001,mat="steel")
        rim=Inter(Offset(dome,.0055),Slab(sh+a*(t1-.003)+up*.006,a,.006),
                  HalfSpace(sh-up*.037,-up),k=.0015)
        S.add(Bounded(rim,sh-.31,sh+.31),.001,mat="edge")
        # Rivet heads follow the domed shoulder instead of floating around a giant sphere.
        for theta in (-.75,.75):
            d=norm(up*math.cos(theta)+cross*math.sin(theta))
            p=trace_in(S,sh+a*(t0+.055),d)
            S.add(Sphere(p-d*.002,.0075),.001,mat="trim")
    if flange:
        # Low raised haute-piece stays rooted in the cap; no thick hollow tube cut ends.
        p0=sh-a*.023+up*.075
        p1=p0+up*(.035 if tier=="red" else .048)
        S.add(RoundCone(p0,p1,.052,.036,squash=(.22,1),ref=a),.008,mat="steel")
    if spikes:
        for da in (.0,.075):
            d=norm(up+V(sx*.25,0,0))
            p=trace_in(S,sh+a*da,d)
            S.add(RoundCone(p-d*.010,p+d*.045,.014,.002),.003,mat="trim")
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


GEAR_TRIS = {"helm": dict(silver=2300,red=2400,gold=2600), "pauldron": dict(silver=1050,red=1150,gold=1350)}


# ============================================================================ palette + painters
# Dark steel has narrow rolled-edge highlights. Rank colour is carried by the broad cloth tabard,
# pauldron enamel (silver steel / Colonel crimson / General metallic gold), and tier-specific metal trim.
# skelknight_palettes.py overrides these fallback defaults; the baked report records the actual palette.
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
    """Only the pauldrons carry rank enamel/gilding; body and hollow helm stay dark steel."""
    part = c.x.get("part", "")
    if part.startswith("pauldron"):
        return np.ones(c.n, bool)
    if part.startswith("helm"):
        return np.zeros(c.n, bool)
    return np.zeros(c.n, bool)


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
    rgb = shaders.mix(rgb, base * np.array([0.92, 0.96, 1.05]), 0.25 * shaders.smooth01(n3, 0.2, 0.8))   # blued drift
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
        e = shaders.mix(e, edge if pal.get("rank")!="gold" else pal["trim"], chip * 0.65)                                   # chipped to bare steel on the edges
        er = pal["enamel_rough"] + 0.08 * n1 + 0.15 * c.cav
        em = pal["enamel_metal"] * (1 - chip) + (1.0 if pal.get("rank")=="gold" else .85) * chip
        rgb = np.where(m[:, None], e, rgb)
        rough = np.where(m, er, rough)
        metal = np.where(m, em, metal)
    return shaders.out(c.n, rgb, np.clip(rough, 0.18, 0.8), metal)


def p_mail(c, pal):
    rgb = np.tile(pal["skin"], (c.n, 1)) * (0.85 + 0.2 * c.noise(40.0, 2, 404))[:, None]
    rgb = shaders.mix(rgb, rgb * 0.4, c.cav)
    upper = c.P[:, 2] > 1.675
    rgb[upper] = pal["void"]
    metal = np.where(upper, 0.0, 0.5)
    return shaders.out(c.n, rgb, 0.75, metal)


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
        rgb = shaders.mix(rgb, pal["void_glow"], np.clip(1.0 - d / 0.012, 0, 1) ** 1.6)
    return shaders.out(c.n, rgb, 0.9)


def p_edge(c,pal):
    # Rolled steel / gilded edge. Bright narrow geometry provides highlights without pale broad plate.
    base=pal["trim"] if pal.get("rank") in ("red","gold") else pal["steel_edge"]
    rgb=np.tile(base,(c.n,1))*(.96+.06*c.noise(55,2,231))[:,None]
    return shaders.out(c.n,rgb,np.clip(.23+.07*c.noise(22,2,232)+.10*c.cav,.18,.43),.98)


PAINTERS = {"edge": p_edge, "steel": p_plate, "skin": p_mail, "eye": p_mail, "nail": p_mail, "brow": p_mail,
            "trim": lambda c, pal: shaders.p_metal(c, pal, "trim"), "void": p_void, "plume": p_plume,
            "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth"), "cloth_trim": lambda c, pal: BM.p_rag(c, pal, "cloth_trim")}


def tier_pal(tier):
    return dict(TEAM.tier_pal("knight", tier, defaults=PAL), rank=tier)


# ============================================================================ previews
MAT_COLORS = {"skin": (0.1, 0.1, 0.11), "eye": (0.1, 0.1, 0.1), "nail": (0.1, 0.1, 0.1), "brow": (0.1, 0.1, 0.1),
              "steel": (0.62, 0.64, 0.68), "trim": (0.6, 0.45, 0.2), "cloth": (0.12, 0.15, 0.3),
              "cloth_trim": (0.6, 0.5, 0.2), "leather": (0.2, 0.13, 0.08), "leather_dark": (0.08, 0.06, 0.05),
              "bronze": (0.6, 0.45, 0.2), "iron": (0.3, 0.3, 0.32), "void": (0.01, 0.01, 0.01),
              "edge": (.8,.8,.75), "plume": (0.6, 0.08, 0.08), "glow": (0.6, 0.9, 1.0)}


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
    preview.render_views(TEAM.guard_out(os.path.join(out, "knight_full.png")), views, res=(1000, 820))
    print(f"[knight] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.03)) / 0.1, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.25)


def drop_degenerate(ob, area=1e-9):
    """r22 integration (lead): remove sub-micro triangles left by decimation (qa_model degenerate WARN)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    bad = [f for f in bm.faces if f.calc_area() < area]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def team_uv(ob, density=1.0):
    """Broad, area-weighted projections reduce the tiny-chart waste of the Sept default."""
    pipeline.ensure_uv(ob)
    meshutil.select_only([ob], ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(89), island_margin=0.0, area_weight=0.5,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    pipeline.normalize_density(ob, np.ones(len(ob.data.polygons),bool), density)
    # r22 integration (lead): the 89 deg projection crushes faces seen edge-on (crest fin, tabard sides) -> flecks.
    UV_REPAIR[ob.name] = repair_smear(ob, np.zeros(len(ob.data.polygons), np.int64), {0: density})


UV_REPAIR = {}


def face_uv_jacobian(ob):
    """Per-face singular values (s_max, s_min) and sign of the 3D->UV map on the first fan triangle."""
    V = meshutil.get_verts(ob)
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    a, b, c = ls, ls + 1, ls + 2
    e1, e2 = V[lv[b]] - V[lv[a]], V[lv[c]] - V[lv[a]]
    n = np.cross(e1, e2)
    nl = np.linalg.norm(n, axis=1) + 1e-15
    u = e1 / (np.linalg.norm(e1, axis=1, keepdims=True) + 1e-15)
    v = np.cross(n / nl[:, None], u)
    P = np.stack([np.stack([(e1 * u).sum(1), (e2 * u).sum(1)], 1), np.stack([(e1 * v).sum(1), (e2 * v).sum(1)], 1)], 1)
    Q = np.stack([uv[b] - uv[a], uv[c] - uv[a]], 2)
    det = P[:, 0, 0] * P[:, 1, 1] - P[:, 0, 1] * P[:, 1, 0]
    det = np.where(np.abs(det) < 1e-15, 1e-15, det)
    Pinv = np.stack([np.stack([P[:, 1, 1], -P[:, 0, 1]], 1), np.stack([-P[:, 1, 0], P[:, 0, 0]], 1)], 1) / det[:, None, None]
    J = Q @ Pinv
    sv = np.linalg.svd(J, compute_uv=False)
    sgn = np.sign(np.linalg.det(J))
    return sv[:, 0], sv[:, 1], sgn


def repair_smear(ob, labels, dens, iters=2):
    """r22 integration fix for the dark jaw/rib/wrist smearing: angle-based charts of big closed regions crush
    some faces to slivers in UV (one texel stretched over cm of surface -> streaks and void colour bleeding).
    Faces whose UV map is crushed (s_min < 0.3x region density), strongly anisotropic (> 3.5:1) or folded
    are re-projected as their own smart-UV islands and rescaled to their region's texel density."""
    A3, _ = pipeline.face_areas_3d_uv(ob)
    out = {"faces": int(len(labels)), "bad": []}
    ls, lt, lv, _, lf = pipeline.loop_arrays(ob)
    for it in range(iters):
        smax, smin, sgn = face_uv_jacobian(ob)
        bad = np.zeros(len(labels), bool)
        for r in np.unique(labels):
            m = labels == r
            w = A3[m]
            ref = math.sqrt(max(float((smax[m] * smin[m] * w).sum() / max(w.sum(), 1e-15)), 1e-15))
            maj = 1.0 if (sgn[m] * w).sum() >= 0 else -1.0
            bad[m] = ((smin[m] < 0.3 * ref) | (smax[m] > 3.5 * np.maximum(smin[m], 1e-12)) | (sgn[m] != maj)) & (w > 2e-8)
        out["bad"].append(int(bad.sum()))
        if not bad.any():
            break
        # grow one ring over shared vertices so repaired patches are whole little charts, not single slivers
        vb = np.zeros(len(ob.data.vertices), bool)
        vb[lv[bad[lf]]] = True
        grow = np.zeros(len(labels), bool)
        np.logical_or.at(grow, lf, vb[lv])
        pipeline.smart_project_faces(ob, grow, angle=55.0)
        for r in np.unique(labels[grow]):
            m = grow & (labels == r)
            pipeline.normalize_density(ob, m, dens.get(int(r), 1.0))
    smax, smin, sgn = face_uv_jacobian(ob)
    out["anisotropy_p99"] = float(np.percentile(smax / np.maximum(smin, 1e-12), 99))
    pipeline.log(f"repair_smear {ob.name}: bad faces per pass {out['bad']}, aniso p99 {out['anisotropy_p99']:.2f}")
    return out



def pack_box(obs, box, res=1024):
    """Pack once into a reserved atlas box; tiers reuse the same common body UVs.

    Margins are converted back to atlas pixels so every box retains >=4 px island padding.
    The 2 px box border also protects adjacent rank-gear slots.
    """
    x, y, w, h = box
    pad = 2.0 / res
    x, y, w, h = x + pad, y + pad, w - 2*pad, h - 2*pad
    # Keep source charts in one tile before CLOSEST_UDIM packing, preserving relative density.
    arrays = [pipeline.loop_arrays(o)[3] for o in obs]
    all_uv = np.concatenate(arrays)
    lo, hi = all_uv.min(0), all_uv.max(0)
    span = max(float((hi-lo).max()), 1e-9)
    for o, uv in zip(obs, arrays):
        pipeline.set_loop_uv(o, (uv-lo)/span*0.90+0.05)
    cov = pipeline.pack_atlas_shape(obs, margin_px=4.0/min(w,h), res=res)
    for ob in obs:
        layer = ob.data.uv_layers.active
        for item in layer.data:
            u, v = item.uv
            item.uv = (x + u*w, y + v*h)
    return cov*w*h


def build(args):
    global OUT_MODELS, OUT_TEX
    OUT_MODELS = TEAM.guard_out(os.path.abspath(args.out))
    OUT_TEX = TEAM.guard_out(os.path.join(OUT_MODELS, "textures"))
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)
    T0 = time.time()
    fast = args.fast
    res = 1024
    h_body, h_hand, h_kilt, h_gear = ((0.0042, 0.0014, 0.003, 0.002) if fast else (0.0022, 0.0009, 0.0016, 0.0011))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(KNIGHT)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["gold"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}, "timings": {}, "config": CONFIG}

    t = time.time()
    S, info = body_sculpt(L)
    H = info["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = tabard_skirt(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    G, eyes = build_gear(S, L, H, [g for t_ in tiers for g in TIERS[t_]])
    Sglow = BS.glow_sculpt(eyes, 0.005)
    report["timings"]["sculpt"] = time.time()-t
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
    report["timings"]["hi"] = time.time()-t
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
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0026, GEAR_TRIS[nm.split("_")[0]][nm.split("_")[1]], *gear_bounds(nm, L),
                                   symmetry=sym, clean=lambda o: charkit.drop_islands(o, 0.0026, min_verts=30))
    glow_lo = pipeline.lowpoly(Sglow, "glow_lo", 0.0015, 100, symmetry=False)
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["form"] = {"tabard_w_m": 2*CONFIG["tabard_half_width"], "hem_m": CONFIG["tabard_hem"],
                      "crest_m": CONFIG["crest_height"], "shoulder_span_m": {}}
    for tier in tiers:
        P = np.concatenate([meshutil.get_verts(los["pauldron_" + tier + "_" + side]) for side in ("L", "R")])
        report["form"]["shoulder_span_m"][tier] = float(P[:, 0].max() - P[:, 0].min())
    Pk = meshutil.get_verts(los["kilt"])
    report["form"]["tabard_measured_w_m"] = float(np.ptp(Pk[:,0]))
    report["form"]["hem_measured_m"] = float(Pk[:,2].min())
    report["form"]["crest_measured_m"] = {}
    for tier in tiers:
        o = his["helm_"+tier][0] if "helm_"+tier in his else None
        if o is not None:
            P = meshutil.get_verts(o)
            ids = np.empty(len(P),np.float32);o.data.attributes["mat_id"].data.foreach_get("value",ids)
            steel = ids.astype(int)==GEAR_MATS.index("steel")
            plume = ids.astype(int)==GEAR_MATS.index("plume")
            report["form"]["crest_measured_m"][tier] = float(P[plume,2].max()-P[steel,2].max())
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    report["timings"]["lo"] = time.time()-t
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(los["body"], arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN, share=0.30)
    for nm, (_, bone) in G.items():
        charkit.rigid_bind(los[nm], arm, bone)
    charkit.rigid_bind(glow_lo, arm, "head")
    report["timings"]["skin"] = time.time()-t
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
        pipeline.export_glb(TEAM.guard_out(os.path.join(OUT_MODELS, ASSET + "_skin.glb")), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    team_uv(los["body"], 1.0)
    report["uv_method"] = "smart_angle89_area0.5_fixed_slots + repair_smear"
    for s in ("L", "R"):
        team_uv(los["hand_" + s], 1.2)
    team_uv(los["kilt"], 0.9)
    for nm in G:
        team_uv(los[nm], 2.0 if nm.startswith("helm") else 1.0)
    report["timings"]["uv"] = time.time()-t
    report["uv_repair"] = UV_REPAIR
    # Stable common charts and reserved gear boxes: body/weights/UV pack once per family.
    # Helm box has about four times the area per square metre (2x linear density).
    t_pack = time.time()
    common_fill = pack_box([los[k] for k in common], (0, 0, 0.68, 1), res)
    gear_fill = {}
    for nm in G:
        box = (0.68, 0.30, 0.32, 0.70) if nm.startswith("helm") else \
              ((0.68, 0, 0.16, 0.30) if nm.endswith("L") else (0.84, 0, 0.16, 0.30))
        gear_fill[nm] = pack_box([los[nm]], box, res)
    report["timings"]["pack"] = time.time()-t_pack
    report["texel_density_px_per_m"] = {}
    for nm,o in los.items():
        A3,Au = pipeline.face_areas_3d_uv(o)
        report["texel_density_px_per_m"][nm] = float(res*np.sqrt(Au.sum()/max(A3.sum(),1e-9)))
    report["atlas_boxes"] = dict(common=[0,0,.68,1], helm=[.68,.30,.32,.70],
                                 pauldron_L=[.68,0,.16,.30], pauldron_R=[.84,0,.16,.30])
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    extra_p = dict(eyes=[tuple(e) for e in eyes])
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.012, 0.03), "hand_L": (0.006, 0.014), "hand_R": (0.006, 0.014), "kilt": (0.012, 0.035)}
    for tier in tiers:
        tt = time.time()
        pal = tier_pal(tier)
        parts = common + TIERS[tier]
        report["uv_fill_" + tier] = common_fill + sum(gear_fill[k] for k in TIERS[tier])
        pipeline.log(f"[{tier}] reserved atlas coverage {report['uv_fill_' + tier]*100:.1f}%")
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
            drop_degenerate(o)
            dups.append(o)
        bpy.context.view_layer.update()
        body = meshutil.join(dups, prefix + "_mesh")
        body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
        g = meshutil.duplicate(glow_lo, f"glow_{tier}")
        g.data.materials.clear()
        g.data.materials.append(gmat)
        pipeline.strip_for_export(g)
        body = meshutil.join([body, g], prefix + "_mesh")
        rep = {"tris": meshutil.tri_count(body), "palette": pal}
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=q["bad"], soft=q["soft"], pairs=q["pairs"]) for k, q in qa.items()}
        pipeline.log(f"[{tier}] stretch QA: " + ", ".join(f"{k}: bad {q['bad']} soft {q['soft']}" for k, q in qa.items()))
        out = TEAM.guard_out(os.path.join(OUT_MODELS, prefix + ".glb"))
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        TEAM.patch_extras(out, TEAM.rim_scales("knight", tier))
        rep["contract"] = TEAM.check_glb(out, "knight", tier)
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "silver":
            shutil.copyfile(out, TEAM.guard_out(os.path.join(OUT_MODELS, ASSET + ".glb")))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(TEAM.guard_out(os.path.join(OUT_MODELS, "knight_report.json")), report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(TEAM.guard_out(os.path.join(OUT_MODELS, "knight_report.json")), report)
    pipeline.log(f"DONE {ASSET} {tiers} in {report['seconds']:.0f}s")


def release_qa(args):
    """Release also runs the unchanged house QA before yielding the GPU to engine captures."""
    import runpy
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    assets = [f"enemy_knight_{tier}" for tier in tiers]
    if os.path.isfile(os.path.join(OUT_MODELS,"weapon_halberd.glb")):
        assets.append("weapon_halberd")
    outcomes = {}
    for asset in assets:
        glb = TEAM.guard_out(os.path.join(OUT_MODELS,asset+".glb"))
        qa_out = TEAM.guard_out(os.path.join(TEAM.QA_DIR,"knight","r23-fix",asset))
        sys.argv = ["qa_model.py","--","--glb",glb,"--out",qa_out,
                    "--max-tris",str(TEAM.BUDGETS[asset]),"--tex","1024"]
        try:
            runpy.run_path(os.path.join(ROOT,".claude","skills","kca-model-builder","scripts","qa_model.py"),
                           run_name="__main__")
            outcomes[asset] = 0
        except SystemExit as exc:
            outcomes[asset] = exc.code or 0
    pipeline.write_json(TEAM.guard_out(os.path.join(OUT_MODELS,"release_qa.json")),outcomes)
    if any(outcomes.values()):
        raise RuntimeError("release QA failed: "+str(outcomes))


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=OUT_MODELS)
    modes = ap.add_mutually_exclusive_group()
    modes.add_argument("--fast", action="store_true")
    modes.add_argument("--release", action="store_true")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--tiers", default=None)
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=9000)
    ap.add_argument("--hand-tris", type=int, default=520)
    ap.add_argument("--kilt-tris", type=int, default=1400)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    TEAM.guard_out(a.out)
    if a.preview:
        preview_main(a)
    else:
        build(a)
        if a.release:
            release_qa(a)
