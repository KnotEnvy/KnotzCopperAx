"""C2 r23 Skeleton repair: paired bones, lobed joints, skeletal hands/feet, unchanged Sept rig.

Run only through tools/blender-run.mjs. Modes: --preview full|head, --fast,
--release (Sept full sculpt resolution and bake samples; decision D2 keeps atlas at 1024).
--out is a scratch directory; no build output may enter public/. Both tiers share the
same base triangles, weights and atlas layout. Palette belongs to skelknight_palettes.
Reports and textures live beside the GLBs. --stage skin exports only deformation QA.
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

import skelknight_team as team
import importlib
import numpy as np
import bpy

from lib import sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit
for _m in (sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit):
    importlib.reload(_m)
import build_enemy_marauder as BM
importlib.reload(BM)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = team.out_dir("skeleton", "skeleton", "out", "1")
OUT_TEX = os.path.join(OUT_MODELS, "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-2", "r22-team", "skeleton")
ASSET = "enemy_skeleton"

# Proportions (Blender, metres); height matches src/enemies/types/skeleton.js (1.8). Big skull (1/6.7 of height).
CONFIG = dict(seed=23, limb_scale=1.45, skull_width_scale=1.15, rib_radius=0.017, atlas=1024,
              uv_margin=5, shaft_radius=0.025, forearm_gap=0.028, shin_gap=0.025, purple_rim=0.0)
SKEL = dict(
    height=1.8, head_h=0.27,
    shoulder_x=0.205, shoulder_z=1.42, clav_in_x=0.024,
    hip_x=0.095, hip_joint_z=0.89, pelvis_z=0.93,
    knee_z=0.48, ankle_z=0.085, foot_len=0.24, stance_x=0.201,
    spine_z=1.03, chest_z=1.2, neck_z=1.45, head_base_z=1.545,
    upperarm=0.3, forearm=0.27, hand=0.19,
    arm_down=40.0, arm_fwd=7.0, elbow_bend=12.0,
)
MATERIALS = ["bone", "teeth", "void", "skin", "nail", "iron", "leather", "cloth", "wood", "horn"]
GEAR_MATS = ["iron", "leather", "wood", "horn", "bone", "cloth"]
KINDS = {"bone": "nail", "teeth": "nail", "void": "leather", "skin": "nail", "nail": "nail", "wood": "leather",
         "horn": "nail"}
HAND_CUT_T = 0.8
WRIST_CUT_T = 0.9
GRIP_R = 0.0165
BELT_Z = 0.985
KILT_CHAIN = 2
HEAD_BOX = (V(-0.17, -0.2, 1.505), V(0.17, 0.17, 1.83))
FACE_DENSITY = 2.4
RIB_ZS = (1.345, 1.295, 1.245, 1.195, 1.145)
TIERS = {
    "white": ["shield"],
    "purple": ["shield", "pauldron_L", "pauldron_R", "helm", "breastplate"],
}


# ============================================================================ helpers
def forearm_bones(S, L, side, mat="bone"):
    """Radius + ulna: two bowed bones with a real gap, joined at the elbow / wrist knobs."""
    el, wr, b, Lf = BM.forearm_frame(L, side)
    # Project the separation into the frontal plane: the old pair overlapped in the game camera.
    sx = 1 if side == "L" else -1
    t = norm(V(sx, -0.18, 0) - b * float(np.dot(V(sx, -0.18, 0), b)))
    for sg, r0, rm, r1 in ((1, 0.024, 0.0165, 0.021), (-1, 0.022, 0.014, 0.018)):
        pts = [el + b * 0.014 + t * sg * 0.014,
               el + b * Lf * 0.34 + t * sg * 0.032,
               el + b * Lf * 0.63 + t * sg * 0.034,
               wr + t * sg * 0.015]
        S.add(Chain(pts, [r0, rm, rm * 0.94, r1]), 0.0025, mat=mat)
        S.add(Sphere(pts[0], r0 * 1.16), 0.0025, mat=mat)
    S.add(Ellipsoid(wr - b * 0.008, V(0.031, 0.029, 0.027)), 0.004, mat=mat)


class Tagger:
    """Tags every op added since the last call with a bone name (skeleton = rigid parts per bone)."""

    def __init__(self, S):
        self.S, self.n = S, len(S.ops)

    def __call__(self, bone):
        for op in self.S.ops[self.n:]:
            if op.kind == "add":
                op.tag = bone
        self.n = len(self.S.ops)


def part_weights(S, ob, arm, soft=0.007, cut=0.03):
    """Per-vertex weights from the tagged SDF parts: softmin over each bone's nearest part (joints blend where
    two parts meet, everything else is rigid to its own bone)."""
    P = meshutil.get_verts(ob)
    bones = sorted({op.tag for op in S.ops if op.kind == "add" and isinstance(op.tag, str)})
    D = np.full((len(P), len(bones)), 9.0)
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    for op in S.ops:
        if op.kind != "add" or not isinstance(op.tag, str):
            continue
        m = ((X >= op.lo[0] - 0.05) & (X <= op.hi[0] + 0.05) & (Y >= op.lo[1] - 0.05) & (Y <= op.hi[1] + 0.05) &
             (Z >= op.lo[2] - 0.05) & (Z <= op.hi[2] + 0.05))
        idx = np.nonzero(m)[0]
        if not len(idx):
            continue
        d = np.abs(np.broadcast_to(op.prim.d(X[idx], Y[idx], Z[idx]), idx.shape))
        j = bones.index(op.tag)
        D[idx, j] = np.minimum(D[idx, j], d)
    dmin = D.min(1, keepdims=True)
    W = np.exp(-(D - dmin) / soft) * ((D - dmin) < cut)
    names = [b.name for b in arm.data.bones if b.use_deform]
    Wf = np.zeros((len(P), len(names)))
    for j, b in enumerate(bones):
        Wf[:, names.index(b)] += W[:, j]
    Wf, _ = skin.top_k(Wf, 4)
    Wf = Wf / np.maximum(Wf.sum(1, keepdims=True), 1e-9)
    skin.write_groups(ob, names, Wf)
    skin.bind(ob, arm)
    return names, Wf


class SkullFrame(anatomy.HeadFrame):
    def __call__(self, x, y, z):
        return super().__call__(x * CONFIG["skull_width_scale"], y, z)

    def r(self, x, y, z):
        return super().r(x * CONFIG["skull_width_scale"], y, z)


def head_frame(L):
    return SkullFrame(L)


# ============================================================================ body
def skull(S, L):
    """Chunky characterful skull: dome, heavy scowling brow bar, cheekbones, deep sockets (void), nasal void,
    toothy grin over a dark mouth, heavy square mandible."""
    H = head_frame(L)
    s = H.s
    S.add(Ellipsoid(H(0, 0.018, 0.028), H.r(0.098, 0.113, 0.1)), 0.0, mat="bone")               # cranium
    S.add(Ellipsoid(H(0, -0.05, -0.045), H.r(0.084, 0.068, 0.07)), 0.03, mat="bone")              # face mass
    for sx in (1, -1):
        S.add(Ellipsoid(H(sx * 0.07, -0.066, -0.046), H.r(0.03, 0.034, 0.022)), 0.016, mat="bone")  # zygoma
        S.add(Capsule(H(sx * 0.07, -0.05, -0.05), H(sx * 0.086, 0.02, -0.04), 0.011 * s), 0.012, mat="bone")
    brow = [H(-0.085, -0.075, 0.03), H(-0.045, -0.1, 0.014), H(0, -0.106, -0.004), H(0.045, -0.1, 0.014),
            H(0.085, -0.075, 0.03)]
    S.add(Chain(brow, [0.014 * s, 0.02 * s, 0.017 * s, 0.02 * s, 0.014 * s]), 0.018, mat="bone")
    # temples: soft hollow
    for sx in (1, -1):
        S.sub(Ellipsoid(H(sx * 0.108, -0.03, -0.01), H.r(0.02, 0.035, 0.03)), 0.02)
    # upper jaw (maxilla) + teeth over a dark mouth void
    S.add(Ellipsoid(H(0, -0.078, -0.094), H.r(0.056, 0.036, 0.022)), 0.02, mat="bone")
    S.add(Ellipsoid(H(0, -0.06, -0.118), H.r(0.05, 0.04, 0.022)), 0.0, mat="void")
    # mandible: heavy square U + chin
    jaw = [H(-0.08, 0.008, -0.07), H(-0.078, -0.03, -0.14), H(-0.05, -0.08, -0.16), H(0, -0.104, -0.162),
           H(0.05, -0.08, -0.16), H(0.078, -0.03, -0.14), H(0.08, 0.008, -0.07)]
    S.add(Chain(jaw, [0.014 * s, 0.018 * s, 0.018 * s, 0.02 * s, 0.018 * s, 0.018 * s, 0.014 * s]), 0.01,
          mat="bone")
    S.add(Ellipsoid(H(0, -0.098, -0.165), H.r(0.034, 0.02, 0.018)), 0.012, mat="bone")
    # teeth rows (upper bigger, a gap-toothed grin): rounded boxes along the dental arcs
    for row, z, hh, n in ((0, -0.108, 0.0095, 8), (1, -0.134, 0.0085, 8)):
        for i in range(n):
            if row == 0 and i == 5:
                continue                                   # missing tooth (character)
            a = (i + 0.5) / n * 1.9 - 0.95
            c = H(math.sin(a) * 0.048, -0.066 - math.cos(a) * 0.04, z)
            yaw = math.degrees(a)
            S.add(RoundBox(c, H.r(0.0053, 0.0060, hh), rot(0, 0, yaw), r=0.0025 * s), 0.0008, mat="teeth")
    # eye sockets: deep, angled (scowl) -- cut with the void material
    eyes = []
    for sx in (1, -1):
        c = H(sx * 0.038, -0.098, -0.026)
        S.sub(Ellipsoid(c, H.r(0.03, 0.034, 0.027), rot(0, sx * -14, 0)), 0.007, mat="void")
        eyes.append(H(sx * 0.037, -0.07, -0.028))
    # nasal cavity (inverted heart)
    for sx in (1, -1):
        S.sub(Ellipsoid(H(sx * 0.009, -0.112, -0.062), H.r(0.011, 0.02, 0.018), rot(0, sx * 18, 0)), 0.004,
              mat="void")
    # chipped hole on the left of the cranium (battle damage)
    S.sub(Ellipsoid(H(0.09, 0.035, 0.055), H.r(0.02, 0.024, 0.019)), 0.006, mat="void")
    return H, eyes


def neck_spine(S, L, T):
    nk, hd = L["neck"], L["head"]
    for i in range(3):
        f = (i + 0.5) / 3
        c = nk + (hd - nk) * f + V(0, 0.012, -0.01)
        S.add(Ellipsoid(c, V(0.03, 0.027, 0.014)), 0.006, mat="bone")
        S.add(RoundCone(c + V(0, 0.015, 0), c + V(0, 0.04, -0.012), 0.009, 0.006), 0.004, mat="bone")
    S.add(Capsule(nk + V(0, 0.012, -0.03), hd + V(0, 0.01, 0.02), 0.017), 0.006, mat="bone")
    T("neck")
    # lumbar spine: the skeleton's wasp waist
    zs = np.linspace(0.975, 1.14, 5)
    for z in zs:
        c = V(0, 0.035, z)
        S.add(Ellipsoid(c, V(0.036, 0.03, 0.017)), 0.007, mat="bone")
        S.add(RoundCone(c + V(0, 0.02, 0), c + V(0, 0.058, -0.012), 0.012, 0.008), 0.004, mat="bone")
        for sx in (1, -1):
            S.add(RoundCone(c, c + V(sx * 0.05, 0.012, 0.004), 0.009, 0.006), 0.004, mat="bone")
        T("hips" if z < 1.02 else "spine")
    S.add(Capsule(V(0, 0.03, 0.95), V(0, 0.03, 1.03), 0.021), 0.008, mat="bone")
    T("hips")
    S.add(Capsule(V(0, 0.03, 1.03), V(0, 0.03, 1.17), 0.021), 0.008, mat="bone")
    T("spine")


def ribcage(S, L, T):
    """Barrel of 5 fat ribs from the thoracic spine to the sternum over a dark void core."""
    # Capsule-like barrel gives every rib gap a continuous opaque backing at all yaw angles.
    core = RoundBox(V(0, 0.012, 1.235), V(0.139, 0.086, 0.145), r=0.050)
    S.add(core, 0.0, mat="void")
    S.add(Capsule(V(0, 0.07, 1.14), V(0, 0.064, 1.4), 0.02), 0.01, mat="bone")               # thoracic spine
    for z in np.linspace(1.16, 1.38, 6):
        S.add(RoundCone(V(0, 0.08, z), V(0, 0.112, z - 0.014), 0.012, 0.008), 0.004, mat="bone")
    for i, z in enumerate(RIB_ZS):
        f = i / (len(RIB_ZS) - 1)
        rx = 0.132 + 0.026 * math.sin(math.pi * (0.25 + 0.75 * f))
        ry = 0.1 + 0.012 * math.sin(math.pi * f)
        r = CONFIG["rib_radius"] - 0.001 * f
        for sx in (1, -1):
            pts = []
            for a in np.linspace(0.12, math.pi - 0.2 - 0.12 * f, 9):
                # a=0 at the spine (back, +Y), pi at the sternum (front, -Y); ribs dip down toward the front
                x = sx * math.sin(a) * rx
                y = 0.012 + math.cos(a) * ry
                zz = z - 0.05 * (a / math.pi) ** 1.4 - 0.012 * math.sin(a)
                pts.append(V(x, y, zz))
            pts = [V(sx * 0.012, 0.075, z + 0.004)] + pts + [V(sx * 0.026, -0.094, z - 0.052 - 0.01 * f)]
            S.add(Chain(pts, r), 0.006, mat="bone")
    S.add(RoundBox(V(0, -0.1, 1.255), V(0.024, 0.012, 0.1), rot(-8, 0, 0), r=0.01), 0.012, mat="bone")   # sternum
    S.add(Ellipsoid(V(0, -0.098, 1.365), V(0.036, 0.016, 0.026)), 0.01, mat="bone")                     # manubrium
    T("chest")
    for sx in (1, -1):
        sh = L["shoulder_" + sx_side(sx)]
        S.add(Chain([V(sx * 0.02, -0.098, 1.372), V(sx * 0.09, -0.086, 1.395), sh + V(-sx * 0.02, -0.012, 0.01)],
                    [0.014, 0.013, 0.015]), 0.008, mat="bone")                                   # clavicle
        T("clavicle_" + sx_side(sx))
        # scapula: flat triangular blade on the back ribs + acromion to the shoulder
        c = V(sx * 0.09, 0.118, 1.305)
        S.add(Ellipsoid(c, V(0.05, 0.011, 0.062), rot(8, 0, sx * -14) @ rot(0, sx * 10, 0)), 0.01,
              mat="bone")
        T("chest")
        S.add(Capsule(c + V(sx * 0.03, 0.0, 0.06), sh + V(-sx * 0.01, 0.02, 0.02), 0.013), 0.01, mat="bone")
        T("clavicle_" + sx_side(sx))


def sx_side(sx):
    return "L" if sx > 0 else "R"


def pelvis(S, L):
    for sx in (1, -1):
        # ilium wings (butterfly), angled out-forward
        S.add(Ellipsoid(V(sx * 0.098, 0.012, 1.0), V(0.07, 0.02, 0.06), rot(0, 0, sx * 38) @ rot(0, sx * -12, 0)),
              0.012, mat="bone")
        S.add(Chain([V(sx * 0.052, 0.020, 1.022), V(sx * 0.116, 0.003, 1.060),
                     V(sx * 0.160, -0.025, 1.022)], [0.018, 0.021, 0.018]), 0.003, mat="bone")
        S.add(Sphere(L["hip_" + sx_side(sx)] + V(sx * 0.006, 0, 0.004), 0.036), 0.012, mat="bone")   # acetabulum
        S.add(Chain([V(sx * 0.1, 0.0, 0.95), V(sx * 0.07, -0.04, 0.9), V(sx * 0.02, -0.052, 0.885)], 0.017), 0.01,
              mat="bone")                                                                          # pubic arch
    S.add(Ellipsoid(V(0, 0.052, 0.95), V(0.048, 0.026, 0.062), rot(-18, 0, 0)), 0.014, mat="bone")    # sacrum
    S.add(Ellipsoid(V(0, -0.052, 0.885), V(0.034, 0.016, 0.022)), 0.01, mat="bone")                   # symphysis


def arm(S, L, side, T):
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    S.add(Sphere(sh, 0.059), 0.01, mat="bone")
    a = norm(el - sh)
    S.add(Chain([sh + a * 0.035, sh + a * 0.12, el - a * 0.055, el - a * 0.015],
                [0.040, 0.027, 0.024, 0.036]), 0.005, mat="bone")
    cross = norm(V(sx, 0, 0) - a * float(np.dot(V(sx, 0, 0), a)))
    for sg in (-1, 1):
        S.add(Sphere(el - a * 0.009 + cross * sg * 0.025, 0.027), 0.003, mat="bone")
    T("upperarm_" + side)
    S.add(Sphere(el + a * 0.004 + V(0, 0.02, 0), 0.024), 0.008, mat="bone")                            # olecranon
    forearm_bones(S, L, side)
    T("forearm_" + side)


def leg(S, L, side, T):
    sx = 1 if side == "L" else -1
    hp, kn, an = L["hip_" + side], L["knee_" + side], L["ankle_" + side]
    tro = hp + V(sx * 0.04, 0.004, -0.03)
    S.add(Sphere(tro, 0.036), 0.012, mat="bone")                                                         # trochanter
    S.add(Capsule(hp, tro, 0.029), 0.01, mat="bone")                                                    # femoral neck
    S.add(Chain([tro + V(-sx * 0.01, 0, -0.03), (tro + kn) * 0.5 + V(-sx * 0.008, 0, 0),
                 kn + V(0, 0, 0.055), kn + V(0, 0, 0.02)], [0.043, 0.030, 0.028, 0.040]), 0.005, mat="bone")
    for sg in (-1, 1):
        S.add(Ellipsoid(kn + V(sg * 0.028, 0.006, 0.018), V(0.032, 0.039, 0.034)), 0.003, mat="bone")
    S.add(Ellipsoid(kn + V(0, -0.037, 0.004), V(0.028, 0.018, 0.031)), 0.003, mat="bone")
    T("thigh_" + side)
    S.add(Ellipsoid(kn + V(0, 0.0, -0.024), V(0.050, 0.039, 0.024)), 0.004, mat="bone")
    S.add(Chain([kn + V(-sx * 0.008, -0.006, -0.03), (kn + an) / 2 + V(-sx * 0.011, -0.006, 0),
                 an + V(-sx * 0.005, -0.004, 0.033)], [0.031, 0.024, 0.027]), 0.003, mat="bone")
    fib = [kn + V(sx * 0.034, 0.014, -0.03), (kn + an) / 2 + V(sx * 0.057, 0.018, 0),
           an + V(sx * 0.030, 0.012, 0.025)]
    S.add(Chain(fib, [0.018, 0.0135, 0.018]), 0.002, mat="bone")
    for dx in (0.028, -0.024):
        S.add(Sphere(an + V(sx * dx, 0.004, 0.008), 0.020), 0.003, mat="bone")
    T("shin_" + side)
    # Distinct heel, talus, navicular and five arched metatarsals; gaps persist to the toe tips.
    ball, toe = L["ball_" + side], L["toe_" + side]
    S.add(Ellipsoid(an + V(0, 0.030, -0.044), V(0.032, 0.043, 0.035)), 0.004, mat="bone")
    S.add(Ellipsoid(an + V(0, -0.016, -0.016), V(0.037, 0.036, 0.028)), 0.003, mat="bone")
    mid = (an + ball) / 2 + V(0, 0.008, 0.002)
    S.add(Ellipsoid(mid, V(0.038, 0.026, 0.023)), 0.004, mat="bone")
    T("foot_" + side)
    for i, dx in enumerate((-0.042, -0.017, 0.008, 0.031, 0.051)):
        r = 0.0125 - 0.00135 * i
        b0 = mid + V(sx * dx * 0.52, -0.012, -0.002)
        b1 = ball + V(sx * dx, -0.006 + i * 0.006, 0.006)
        S.add(Chain([b0, (b0 + b1) / 2 + V(0, 0, 0.004), b1], [r, r * 0.70, r]), 0.0015, mat="bone")
        S.add(Sphere(b1, r * 1.15), 0.0015, mat="bone")
        T("foot_" + side)
        tp = b1 + V(sx * dx * 0.08, -0.061 + 0.0055 * i, -0.007)
        joint = b1 * 0.48 + tp * 0.52
        S.add(Chain([b1, joint, tp], [r * 0.88, r * 0.77, r * 0.68]), 0.0013, mat="bone")
        S.add(Sphere(joint, r * 0.95), 0.0015, mat="bone")
        T("toe_" + side)


def belt(S):
    """Leather belt slung between the ilium wings, sagging in front, knotted at the right hip."""
    ring = []
    for i in range(49):
        a = i / 48 * 2 * math.pi
        front = 0.5 + 0.5 * math.cos(a)
        ring.append(V(math.sin(a) * (0.15 + 0.008 * front), 0.012 - math.cos(a) * (0.098 if front > 0.5 else 0.07),
                      BELT_Z - 0.012 * front ** 2.5))
    S.add(Chain(ring, 0.019, squash=(0.75, 1.0), ref=(0, 0, 1), margin=0.02), 0.004, mat="leather")
    S.add(RoundBox(V(-0.14, -0.06, BELT_Z - 0.03), V(0.022, 0.012, 0.02), rot(0, 0, -40), r=0.005), 0.004,
          mat="iron")

    # Iron belt ring is rooted in the leather at the front-left hip.
    S.add(Torus(V(0.075, -0.088, BELT_Z - 0.045), 0.021, 0.006,
                basis(V(0, -1, 0))[:, [1, 2, 0]]), 0.003, mat="iron")


def wrist_wrap(S, L, side):
    el, wr, b, length = BM.forearm_frame(L, side)
    for t in (0.70, 0.77, 0.84):
        c = el + b * length * t
        band = Inter(Ellipsoid(c, V(0.044, 0.034, 0.014), basis(b)[:, [1, 2, 0]]),
                     Slab(c, b, 0.011))
        S.add(band, 0.005, mat="leather")


def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="bone")
    info = {}
    T = Tagger(S)
    H, eyes = skull(S, L)
    T("head")
    info["H"], info["eyes"] = H, eyes
    neck_spine(S, L, T)
    ribcage(S, L, T)
    pelvis(S, L)
    T("hips")
    for s in ("L", "R"):
        arm(S, L, s, T)
        leg(S, L, s, T)
        wrist_wrap(S, L, s)
        T("forearm_" + s)
        el, wr, b, Lf = BM.forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.1)), wr - 0.1, wr + 0.1))
    belt(S)
    T("hips")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))
    info["kilt"] = dict(top_z=BELT_Z - 0.01, hem_z=0.62, r_top=0.15, r_hem=0.17, squash=0.62, cy=0.0)
    return S, info


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="bone")
    forearm_bones(S, L, side)
    guide = Sculpt(materials=MATERIALS, default_mat="bone")
    info = anatomy.hand(guide, L, side, "grip" if side == "R" else "relaxed", {}, grip_r=GRIP_R)
    W = L["wrist_" + side]
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    S.add(Ellipsoid(W + h * 0.014, V(0.026, 0.030, 0.019), np.stack([h, t, n], axis=1)), 0.004, mat="bone")
    for i, pts in enumerate(info["fingers"].values()):
        base = W + h * 0.022 + t * ((0.027 - i * 0.018) * 0.50)
        S.add(Chain([base, pts[0]], [0.011, 0.009]), 0.002, mat="bone")
        for j in range(3):
            r = (0.0085 - i * 0.0004) * (1 - j * 0.1)
            S.add(RoundCone(pts[j], pts[j+1], r, r * 0.82), 0.0014, mat="bone")
            S.add(Sphere(pts[j], r * 1.20), 0.0014, mat="bone")
    pts = info["thumb"]
    S.add(Chain(pts, [0.012, 0.0105, 0.009, 0.007]), 0.002, mat="bone")
    for pt in pts[1:3]:
        S.add(Sphere(pt, 0.011), 0.002, mat="bone")
    el, wr, b, Lf = BM.forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


def glow_sculpt(eyes, r=0.012):
    S = Sculpt(materials=["glow"], default_mat="glow")
    for e in eyes:
        S.add(Sphere(e, r), 0.0)
    return S


def loincloth(kp):
    """Tattered rag panels front + back hanging from the belt (kilt chains), ragged torn hems."""
    S = Sculpt(materials=MATERIALS, default_mat="cloth")
    for side, yc, w, hz, seed in (("F", -0.108, 0.1, 0.75, 3), ("B", 0.085, 0.12, 0.72, 5)):
        sg = -1 if side == "F" else 1
        top = BELT_Z + 0.005
        cyl = Ellipsoid(V(0, 0.0, 0.8), V(0.2, abs(yc) - 0.003, 0.6))
        panel = Inter(Shell(cyl, 0.0045), HalfSpace(V(0, sg * 0.02, 0), V(0, -sg, 0)),
                      Slab(V(0, 0, 0), V(1, 0, 0), w), HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
        # torn hem: a big ellipsoid per rag tongue
        tongues = Union(*[Ellipsoid(V(x, yc, hz + 0.2 + dz), V(0.034, 0.3, 0.2)) for x, dz in
                          ((-w * 0.72, 0.03), (-w * 0.26, -0.03), (w * 0.2, 0.0), (w * 0.68, -0.05))], k=0.02)
        reg = Inter(panel, tongues, k=0.004)
        S.add(Bounded(Displace(reg, 0.002, 18.0, 2, seed=seed), V(-0.25, yc - 0.06, hz - 0.1),
                      V(0.25, yc + 0.06, top + 0.02)), 0.0, mat="cloth")
    return S


# ============================================================================ gear (per tier, separate meshes)
def shield(L, tier):
    """Round wooden shield (iron rim, boss, 2 iron bands, rim rivets, a bite hacked out of the rim) strapped on the
    outside of the left forearm by two leather straps (rigid forearm_L)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="wood")
    el, wr, b, Lf = BM.forearm_frame(L, "L")
    dors = -L["hand_n_L"]
    dors = norm(dors - b * float(np.dot(dors, b)))
    c = el + b * Lf * 0.62 + dors * 0.06
    R = 0.23
    M = basis(dors)
    dome_s = Sphere(c - dors * 0.9, 0.9 + 0.03)
    disc = Inter(dome_s, Sphere(c, R), HalfSpace(c - dors * 0.02, -dors), k=0.006)
    planks = disc
    S.add(Bounded(planks, c - 0.3, c + 0.3), 0.0, mat="wood")
    u = norm(np.cross(dors, b))
    for i in range(-2, 3):                                   # plank grooves (soft, wide: no sub-voxel slots)
        S.sub(Inter(Slab(c + u * (i * 0.084 + 0.042), u, 0.004), Sphere(c, R - 0.023), Shell(dome_s, 0.009)), 0.002)
    MT = basis(dors)[:, [1, 2, 0]]
    S.add(Torus(c + dors * 0.010, R - 0.010, 0.019, MT, squash=0.7), 0.004, mat="iron")                  # rim
    for sb in (-0.1, 0.1):                                                                                # bands
        S.add(Inter(Slab(c + b * sb, b, 0.017), Sphere(c, R - 0.005), Offset(disc, 0.010), k=0.002), 0.003,
              mat="iron")
    boss = Inter(Sphere(c + dors * 0.028, 0.074), HalfSpace(c + dors * 0.030, -dors), k=0.004)
    S.add(boss, 0.01, mat="iron")
    S.add(Torus(c + dors * 0.034, 0.073, 0.010, MT), 0.004, mat="iron")
    if tier == "purple":                                     # spiked boss + more studs
        S.add(RoundCone(c + dors * 0.06, c + dors * 0.13, 0.024, 0.003), 0.006, mat="iron")
    for j in range(16):
        a = j / 16 * 2 * math.pi
        d = u * math.cos(a) + b * math.sin(a)
        S.add(Sphere(c + d * (R - 0.010) + dors * 0.024, 0.011), 0.002, mat="iron")
    for sb in (-0.1, 0.1):
        for sgn in (-1, 1):
            S.add(Sphere(c + b * sb + u * sgn * 0.15 + dors * 0.032, 0.010), 0.002, mat="iron")
    # battle damage: a bite hacked out of the rim + gouges
    bite = c + (u * math.cos(2.2) + b * math.sin(2.2)) * (R + 0.01)
    S.sub(Ellipsoid(bite, V(0.05, 0.05, 0.05)), 0.008, mat="wood")
    for k_, (a0, a1) in enumerate(((0.3, 0.9), (-2.4, -1.9))):
        p0 = c + (u * math.cos(a0) + b * math.sin(a0)) * 0.09 + dors * 0.03
        p1 = c + (u * math.cos(a1) + b * math.sin(a1)) * 0.17 + dors * 0.016
        S.sub(Capsule(p0, p1, 0.005), 0.004, mat="wood")
    # straps round the forearm bones (rigid with the shield)
    for t_ in (0.35, 0.8):
        p = el + b * Lf * t_
        S.add(Torus(p + dors * 0.008, 0.036, 0.0085, basis(b)[:, [1, 2, 0]], squash=0.75), 0.004, mat="leather")
        S.add(RoundBox(p + dors * 0.034, V(0.02, 0.014, 0.016), M, r=0.004), 0.006, mat="leather")
    return S


def pauldron(L, side, tier):
    """Rusted iron shoulder dome + a lame over a leather pad, strapped round the humerus (rigid upperarm)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    big = 1.18 if tier == "purple" else 1.0
    c = sh + up * 0.01 + a * 0.012
    S.add(Sphere(c, 0.059), 0.0, mat="leather")                                       # pad (touches the ball)
    dome = Inter(Shell(Ellipsoid(c + up * 0.004, V(0.053, 0.108, 0.108) * big, basis(up)), 0.0065), HalfSpace(c - up * 0.02, -up),
                 HalfSpace(V(float(sh[0]) - sx * 0.07, 0, 0), V(-sx, 0, 0)), k=0.004)
    S.add(Displace(dome, 0.0008, 30.0, 2, seed=11 + sx), 0.004, mat="iron")
    lame = Inter(Shell(Sphere(c - up * 0.01, 0.108 * big), 0.0055), Slab(c + a * 0.075 - up * 0.02, a, 0.026),
                 HalfSpace(c - up * 0.06, -up), k=0.004)
    S.add(lame, 0.004, mat="iron")
    S.add(Torus(c - up * 0.016, 0.107 * big, 0.0075, basis(up)[:, [1, 2, 0]]), 0.003, mat="iron")  # rolled rim
    for j in range(6):
        ang = -0.9 + j * 0.36
        side_v = norm(np.cross(a, up)) * sx
        d = norm(up * math.cos(ang) + side_v * math.sin(ang) + a * 0.2)
        S.add(Sphere(trace_in(S, c, d, r=0.3), 0.0068), 0.001, mat="iron")
    ring = el + (sh - el) * 0.6
    S.add(Torus(ring, 0.03, 0.0075, basis(a)[:, [1, 2, 0]], squash=0.8), 0.003, mat="leather")      # arm strap
    S.add(Chain([ring + up * 0.028, c + up * 0.0 + a * 0.07 - up * 0.02 + V(sx * 0.0, 0, 0)], 0.007), 0.003,
          mat="leather")
    if tier == "purple":
        d = norm(up * 0.9 + a * -0.1 + V(sx * 0.3, 0, 0))
        p = trace_in(S, c, d, r=0.3)
        S.add(RoundCone(p - d * 0.012, p + d * 0.075, 0.020, 0.003), 0.004, mat="iron")
        for sg in (-1, 1):
            d2 = norm(up * 0.65 + norm(np.cross(a, up)) * sg * 0.7)
            p2 = trace_in(S, c, d2, r=0.3)
            S.add(RoundCone(p2 - d2 * 0.014, p2 + d2 * 0.05, 0.015, 0.0025), 0.004, mat="iron")
    return S


def helm(L, H):
    """(purple) Blackened iron half-helm on the cranium with swept-forward horns, riveted brow band."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    base = Ellipsoid(H(0, 0.018, 0.028), H.r(0.098, 0.113, 0.1))
    c1 = H(0, -0.095, 0.035)
    nrm = norm(V(0, -0.35, 1))
    dome = Inter(Shell(Offset(base, 0.003), 0.008), HalfSpace(c1 - nrm * 0.0, -nrm), k=0.004)
    S.add(Displace(dome, 0.0007, 34.0, 2, seed=31), 0.0, mat="iron")
    band = Inter(Shell(Offset(base, 0.006), 0.007), Slab(c1 + nrm * 0.012, nrm, 0.012), k=0.003)
    S.add(band, 0.003, mat="iron")
    for i in range(14):
        a = (i + 0.5) / 14 * 2 * math.pi
        d = norm(V(math.sin(a), -math.cos(a), 0) - nrm * float(np.dot(V(math.sin(a), -math.cos(a), 0), nrm)))
        p = trace_in(S, H(0, 0.01, 0.02) + nrm * 0.03, d, r=0.25)
        S.add(Sphere(p, 0.005), 0.001, mat="iron")
    crest = [H(0, -0.09, 0.075), H(0, -0.02, 0.125), H(0, 0.06, 0.12), H(0, 0.12, 0.07)]
    S.add(Chain(crest, 0.009 * s, squash=(0.5, 1.0), ref=(1, 0, 0)), 0.006, mat="iron")
    for sx in (1, -1):
        b0 = trace_in(S, H(sx * 0.03, 0.0, 0.03), norm(V(sx * 0.9, -0.2, 0.45)), r=0.3)
        BM.horn(S, b0, [(sx * 0.04, -0.01, 0.02), (sx * 0.09, -0.04, 0.06), (sx * 0.12, -0.08, 0.1),
                        (sx * 0.12, -0.13, 0.13)], 0.028, s=s, mat="horn", collar="iron")
    return S


def breastplate(L):
    """(purple) Broken rusted breastplate over the left ribs, strapped over the right shoulder (rigid chest)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    env = Ellipsoid(V(0, -0.012, 1.245), V(0.174, 0.148, 0.24))
    reg = Inter(Shell(env, 0.006), HalfSpace(V(0, -0.02, 0), V(0, 1, 0)), HalfSpace(V(-0.035, 0, 0), V(-1, 0, 0)),
                HalfSpace(V(0, 0, 1.36), V(0, 0, 1)), HalfSpace(V(0, 0, 1.12), V(0, 0, -1)),
                HalfSpace(V(0.17, 0, 1.12), norm(V(0.6, 0, -0.8))), k=0.006)
    S.add(Displace(reg, 0.001, 26.0, 2, seed=41), 0.0, mat="iron")
    S.add(Inter(Shell(Offset(env, 0.004), 0.004), Slab(V(0, 0, 1.352), V(0, 0, 1), 0.008),
                HalfSpace(V(0, -0.02, 0), V(0, 1, 0)), HalfSpace(V(-0.035, 0, 0), V(-1, 0, 0)), k=0.003), 0.003,
          mat="iron")
    for z in (1.33, 1.2):
        for x in (0.02, 0.1):
            S.add(Sphere(trace_in(S, V(x, 0.0, z), V(0, -1, 0), r=0.3), 0.006), 0.001, mat="iron")
    # Buried standoff pin contacts an upper rib and roots the proud plate without purple surface intersections.
    S.add(Capsule(V(0.05, -0.10, 1.29), V(0.05, -0.155, 1.29), 0.009), 0.003, mat="iron")
    strap = [V(0.0, -0.14, 1.33), V(-0.08, -0.12, 1.4), V(-0.14, -0.04, 1.455), V(-0.14, 0.06, 1.44),
             V(-0.09, 0.13, 1.35)]
    S.add(Chain(strap, 0.009, squash=(0.5, 1.0), ref=(0, 0, 1)), 0.004, mat="leather")
    return S


GEAR = {  # name -> (builder(L, H, tier), bone, tris)
    "shield": (lambda L, H, t: shield(L, t), "forearm_L", 1450),
    "pauldron_L": (lambda L, H, t: pauldron(L, "L", t), "upperarm_L", 420),
    "pauldron_R": (lambda L, H, t: pauldron(L, "R", t), "upperarm_R", 420),
    "helm": (lambda L, H, t: helm(L, H), "head", 1000),
    "breastplate": (lambda L, H, t: breastplate(L), "chest", 550),
}


def gear_bounds(name, L):
    if name == "shield":
        w = L["wrist_L"]
        return w - 0.42, w + 0.42
    if name.startswith("pauldron"):
        sh = L["shoulder_" + name[-1]]
        return sh - 0.17, sh + 0.17
    if name == "helm":
        return V(-0.3, -0.35, 1.55), V(0.3, 0.25, 2.05)
    return V(-0.25, -0.2, 1.05), V(0.25, 0.2, 1.52)


# ============================================================================ palette + painters
# Value ladder (albedo luma): white bone ivory ~70% (the brightest big shape) >> wood shield ~30% / rusted iron
# ~28-34% (orange-brown patina over grey) / dusty oxblood rags ~20% > leather ~14% > void core/sockets ~5%.
# Eyes: emissive ember pinpoints (2nd material). Purple: lilac-grey bone ~48%, violet rags ~14%, blackened iron
# ~20% with bright bone-horn tips, black-violet shield ~12% with a bright iron rim.
PAL = dict(
    bone=shaders.srgb(206, 180, 128), bone_dark=shaders.srgb(70, 50, 30), bone_grime=shaders.srgb(128, 98, 60),
    bone_soil=shaders.srgb(92, 70, 46), teeth=shaders.srgb(200, 178, 124), void=shaders.srgb(14, 11, 12), void_glow=shaders.srgb(70, 26, 12),
    iron=shaders.srgb(128, 122, 116), iron_patina=shaders.srgb(132, 72, 36), iron_patina_amt=0.9,
    leather=shaders.srgb(62, 42, 28), leather_worn=shaders.srgb(118, 88, 62),
    cloth=shaders.srgb(104, 40, 30), wood=shaders.srgb(124, 84, 50), wood_dark=shaders.srgb(58, 38, 24),
    horn=shaders.srgb(40, 32, 30), horn_tip=shaders.srgb(214, 200, 170),
    glow=(1.0, 0.36, 0.08), glow_strength=2.6,
)
TIER_PAL = {
    "white": {},
    "purple": dict(bone=shaders.srgb(168, 144, 150), bone_dark=shaders.srgb(48, 30, 52),
                   bone_grime=shaders.srgb(104, 76, 100), bone_soil=shaders.srgb(66, 46, 64), teeth=shaders.srgb(180, 160, 150),
                   void=shaders.srgb(16, 8, 24), void_glow=shaders.srgb(70, 20, 110),
                   iron=shaders.srgb(104, 100, 112), iron_patina=shaders.srgb(66, 46, 76), iron_patina_amt=0.75,
                   cloth=shaders.srgb(62, 26, 90), wood=shaders.srgb(40, 28, 46), wood_dark=shaders.srgb(20, 14, 24),
                   leather=shaders.srgb(40, 28, 34), glow=(0.72, 0.28, 1.0), glow_strength=3.2),
}


def p_bone(c, pal, key="bone"):
    """Stylised bone: ivory, grime settling in cavities, bright worn ridges, faint crack streaks, blotchy age."""
    n1 = c.noise(9.0, 3, 101)
    n2 = c.noise(60.0, 2, 102)
    rgb = np.tile(pal[key], (c.n, 1)) * (0.93 + 0.08 * n1 + 0.04 * n2)[:, None]
    # r2 (critic r1: bone and knight plate merged into one white value): warmer ochre-ivory, dirtier -- age
    # blotches, grave soil rising from the feet, grime packed in every crevice; only worn ridges stay pale.
    blotch = shaders.smooth01(n1, 0.25, 0.75) * 0.5
    rgb = shaders.mix(rgb, pal["bone_grime"], blotch)
    soil = (1.0 - shaders.smooth01(c.P[:, 2], 0.1, 0.75)) * (0.35 + 0.35 * shaders.smooth01(n2, 0.1, 0.7))
    rgb = shaders.mix(rgb, pal.get("bone_soil", pal["bone_grime"]), soil)
    joints = [c.L[k] for k in c.L if k.startswith(("elbow_", "knee_", "ankle_", "wrist_"))]
    if joints:
        d = np.min([np.linalg.norm(c.P - j, axis=1) for j in joints], axis=0)
        joint = (1 - shaders.smooth01(d, 0.018, 0.066)) * (0.40 + 0.15 * n2)
        rgb = shaders.mix(rgb, pal["bone_dark"], joint)
    rgb = shaders.mix(rgb, pal["bone_dark"], shaders.smooth01(c.cav, 0.02, 0.4) * 0.88)
    rgb = shaders.mix(rgb, np.minimum(pal[key] * 1.25, 1), 0.4 * c.ridge)
    crack = shaders.smooth01(np.abs(c.noise(22.0, 2, 103)), 0.0, 0.035)
    rgb = shaders.mix(rgb, pal["bone_dark"], (1 - crack) * 0.35 * shaders.smooth01(n2, 0.2, 0.6))
    return shaders.out(c.n, rgb, np.clip(0.62 - 0.12 * c.ridge + 0.06 * n1, 0.35, 0.8))


def p_void(c, pal):
    """Near-black cavity with a faint glow tint (the eye light spilling in the sockets / soul core)."""
    n1 = c.noise(12.0, 2, 104)
    rgb = np.tile(pal["void"], (c.n, 1)) * (0.9 + 0.2 * n1)[:, None]
    eyes = c.x.get("eyes") or []
    if eyes:
        d = np.min([np.linalg.norm(c.P - V(*e), axis=1) for e in eyes], axis=0)
        rgb = shaders.mix(rgb, pal["void_glow"], np.clip(1.0 - d / 0.045, 0, 1) ** 1.5)
    return shaders.out(c.n, rgb, 0.9)


def p_wood(c, pal):
    """Painted-off planks: grain streaks along the forearm-perpendicular plank axis, dark grooves, pale scuffs."""
    P = c.P
    u = c.x.get("wood_u")
    g = P @ V(*u) if u is not None else P[:, 0]
    grain = 0.5 + 0.5 * np.sin(g * 520.0 + 6.0 * c.noise(14.0, 2, 105))
    n1 = c.noise(7.0, 3, 106)
    rgb = shaders.mix(np.tile(pal["wood"], (c.n, 1)), pal["wood_dark"], 0.35 * grain + 0.2 * shaders.smooth01(n1, 0.3, 0.9))
    rgb = shaders.mix(rgb, pal["wood_dark"] * 0.6, np.clip(c.cav * 1.3, 0, 1))
    rgb = shaders.mix(rgb, np.minimum(pal["wood"] * 1.5 + 0.04, 1), 0.3 * c.ridge)
    return shaders.out(c.n, rgb, 0.78)


def p_iron(c, pal):
    """Grave-rusted iron: mostly matte rust crust (value holds mid-tone in any env), dark pitting in cavities, only
    the worn ridges/edges show bare metal (bright, metallic)."""
    n1 = c.noise(14.0, 3, 111)
    n2 = c.noise(70.0, 2, 112)
    rust = np.clip(0.55 + 0.45 * n1 + 0.8 * c.cav - 1.1 * c.ridge, 0, 1) * pal.get("iron_patina_amt", 0.9)
    base = np.tile(pal["iron"], (c.n, 1)) * (1.0 + 0.08 * n2)[:, None]
    base = shaders.mix(base, np.minimum(pal["iron"] * 1.35 + 0.04, 1), 0.6 * c.ridge)
    crust = pal["iron_patina"] * (0.75 + 0.35 * n2 + 0.15 * n1)[:, None]
    rgb = shaders.mix(base, crust, rust)
    rgb = shaders.mix(rgb, rgb * 0.45, shaders.smooth01(c.cav, 0.1, 0.6) * 0.7)
    metal = np.clip(0.9 - 0.95 * rust, 0.0, 0.9)
    rough = np.clip(0.35 + 0.5 * rust + 0.08 * n1, 0.2, 0.95)
    return shaders.out(c.n, rgb, rough, metal)


PAINTERS = {"bone": p_bone, "skin": p_bone, "nail": p_bone, "teeth": lambda c, pal: p_bone(c, pal, "teeth"),
            "void": p_void, "wood": p_wood, "iron": p_iron, "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth"),
            "horn": BM.p_horn}


def tier_pal(tier):
    return team.tier_pal("skeleton", tier, defaults=PAL)



def bone_charts(ob, arm, density=1.0):
    """Separate bone/material charts; dense teeth and skull UVs, followed by the r22 distortion repair.

    Final qa_model raster checks and textured sheets are the acceptance check for these charts.
    """
    names = [b.name for b in arm.data.bones if b.use_deform]
    W = skin.read_groups(ob, names)
    dominant = np.argmax(W, axis=1)
    pipeline.ensure_uv(ob)
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    f = dominant[lv[np.stack([ls, ls + 1, ls + 2], axis=1)]]
    labels = np.where(f[:, 1] == f[:, 2], f[:, 1], f[:, 0])
    labels = pipeline.clean_labels(labels, pipeline.face_adjacency(ob), iters=3)
    # LO meshes do not carry sculpt materials. Sample them explicitly; treating polygon.material_index
    # as sculpt material was the first fast diagnostic's mistake (all indices were zero).
    materials, material_names = LOW_FACE_MATS[ob.name]
    labels = labels * 32 + materials
    densities = {}
    for r in np.unique(labels):
        name, mat = names[r // 32], material_names[r % 32]
        d = 5.0 if mat == "teeth" else 2.6 if name == "head" else density
        mask = labels == r
        pipeline.smart_project_faces(ob, mask, angle=72.0)
        pipeline.normalize_density(ob, mask, d)
        densities[int(r)] = d
    UV_REPAIR[ob.name] = repair_smear(ob, labels, densities)
    return len(np.unique(pipeline.uv_islands(ob)[0]))


UV_REPAIR = {}
LOW_FACE_MATS = {}


def split_nonmanifold(ob):
    """r22 integration (lead): decimated elite gear leaves a few edges shared by > 2 faces (qa_model WARN on purple).
    Splitting exactly those edges changes no vertex position, weight or UV; returns the number split."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bad = [e for e in bm.edges if len(e.link_faces) > 2]
    if bad:
        bmesh.ops.split_edges(bm, edges=bad)
        bm.to_mesh(ob.data)
    bm.free()
    return len(bad)


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
        for r in np.unique(labels[grow]):
            m = grow & (labels == r)
            pipeline.smart_project_faces(ob, m, angle=55.0)
            pipeline.normalize_density(ob, m, dens.get(int(r), 1.0))
    smax, smin, sgn = face_uv_jacobian(ob)
    out["anisotropy_p99"] = float(np.percentile(smax / np.maximum(smin, 1e-12), 99))
    pipeline.log(f"repair_smear {ob.name}: bad faces per pass {out['bad']}, aniso p99 {out['anisotropy_p99']:.2f}")
    return out


def nearest_gutters(img, cov):
    """Jump-flood nearest covered texel, including distant mip gutters; never average tan and violet charts."""
    H, W = cov.shape
    yy, xx = np.indices((H, W), dtype=np.int32)
    sy = np.where(cov, yy, -100000)
    sx = np.where(cov, xx, -100000)
    best = (sy - yy).astype(np.float64)**2 + (sx - xx).astype(np.float64)**2
    step = 1 << (max(H, W).bit_length() - 1)
    while step:
        for dy, dx in ((0, 1),(0, -1),(1, 0),(-1, 0),(1, 1),(1, -1),(-1, 1),(-1, -1)):
            cy, cx = np.roll(sy, (dy*step, dx*step), (0,1)), np.roll(sx, (dy*step, dx*step), (0,1))
            valid = cy >= 0
            if dy > 0: valid[:step] = False
            if dy < 0: valid[-step:] = False
            if dx > 0: valid[:, :step] = False
            if dx < 0: valid[:, -step:] = False
            dist = (cy-yy).astype(np.float64)**2 + (cx-xx).astype(np.float64)**2
            take = valid & (dist < best)
            sy[take], sx[take], best[take] = cy[take], cx[take], dist[take]
        step //= 2
    return img[np.maximum(sy,0), np.maximum(sx,0)]


def composite_bone_maps(maps, out, prefix, pal):
    """Neutral/chromatic AO avoids warm brown shadows on violet; full nearest-chart dilation prevents halos."""
    cov = maps["albedo"][...,3] > 0.5
    a = maps["albedo"][...,:3].copy()
    ao_s, ao_l = np.clip(maps["ao"][...,0],0,1), np.clip(maps["ao"][...,1],0,1)
    occl = np.clip(1 - 0.85*(1-ao_s) - 0.50*(1-ao_l), 0, 1)[...,None]
    tint = np.array(pal.get("bone_ao_tint", (0.46,0.39,0.29)))
    a *= tint + (1-tint)*occl
    orm = np.stack([np.clip(0.25+0.75*ao_l*(0.45+0.55*ao_s),0,1),
                    np.clip(maps["prm"][...,0],.04,1),np.clip(maps["prm"][...,1],0,1)],axis=-1)
    tex = {}
    for key, arr, space in (("albedo", a, "sRGB"),("orm",orm,"Non-Color"),("normal",maps["normal"][...,:3],"Non-Color")):
        padded = nearest_gutters(arr, cov)
        tex[key] = pipeline.save_png(padded, os.path.join(out,prefix+"_"+key+".png"),prefix+"_"+key,space,
                                     linear_to_srgb=(key=="albedo"))
    return tex


def semantic_atlas(parts, meshes, sculpts, res):
    """Scratch-only bone/iron/cloth labels for foreground colour measurement in the real stage render."""
    img = np.zeros((res,res,3),np.float32)
    kinds = {"bone":1,"teeth":1,"skin":1,"nail":1,"iron":2,"horn":2,"cloth":4,"wood":3,"leather":3}
    for key in parts:
        ob = meshes[key]
        ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
        for fi, poly in enumerate(ob.data.polygons):
            code = kinds.get(LOW_FACE_MATS[ob.name][1][LOW_FACE_MATS[ob.name][0][fi]],0)
            tri = uv[ls[fi]:ls[fi]+3] * res
            lo = np.maximum(np.floor(tri.min(0)-1).astype(int),0)
            hi = np.minimum(np.ceil(tri.max(0)+1).astype(int),res-1)
            xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
            d=tri[1]-tri[0];e=tri[2]-tri[0];det=d[0]*e[1]-d[1]*e[0]
            if abs(det)<1e-12: continue
            u=((xx-tri[0,0])*e[1]-(yy-tri[0,1])*e[0])/det
            v=(d[0]*(yy-tri[0,1])-d[1]*(xx-tri[0,0]))/det
            mask=(u>=0)&(v>=0)&(u+v<=1)
            tile=img[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
            tile[mask]=[float(bool(code & bit)) for bit in (1,2,4)]
    return img


def glow_material(name, rgb, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*rgb, 1.0)
    bs.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bs.inputs["Emission Strength"].default_value = strength
    bs.inputs["Roughness"].default_value = 0.4
    return m


# ============================================================================ previews
MAT_COLORS = {"bone": (0.85, 0.8, 0.68), "teeth": (0.8, 0.74, 0.6), "void": (0.03, 0.02, 0.02),
              "skin": (0.85, 0.8, 0.68), "nail": (0.85, 0.8, 0.68), "iron": (0.35, 0.25, 0.18),
              "leather": (0.2, 0.13, 0.08), "cloth": (0.35, 0.1, 0.08), "wood": (0.42, 0.27, 0.15),
              "horn": (0.15, 0.12, 0.1), "glow": (1.0, 0.4, 0.05)}


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(SKEL)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = body_sculpt(L)
    H = info["H"]
    if args.preview == "head":
        charkit.mesh_sculpt(S, "head", args.h or 0.0012, HEAD_BOX[0], HEAD_BOX[1], colors=MAT_COLORS)
        charkit.mesh_sculpt(glow_sculpt(info["eyes"]), "glow", 0.001, colors=MAT_COLORS)
        Sg = helm(L, H)
        o = charkit.mesh_sculpt(Sg, "helm", 0.0018, *gear_bounds("helm", L), colors=MAT_COLORS)
        o.location = V(0.4, 0, 0)
        hd = charkit.mesh_sculpt(S, "head2", 0.0016, HEAD_BOX[0], HEAD_BOX[1], colors=MAT_COLORS)
        hd.location = V(0.4, 0, 0)
        views = [dict(target=(0.2, -0.03, 1.69), ortho=0.75, yaw=y, dist=3, pitch=3) for y in (0, 30, 80)]
        preview.render_views(os.path.join(out, "skeleton_head.png"), views, res=(760, 560))
    else:
        base = [charkit.mesh_sculpt(S, "body", args.h or 0.003, colors=MAT_COLORS),
                charkit.mesh_sculpt(loincloth(info["kilt"]), "kilt", 0.0025, colors=MAT_COLORS),
                charkit.mesh_sculpt(glow_sculpt(info["eyes"]), "glow", 0.0015, colors=MAT_COLORS)]
        for s in ("L", "R"):
            w = L["wrist_" + s]
            base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.0014, w - 0.12, w + 0.12,
                                            colors=MAT_COLORS))
        for i, tier in enumerate(("white", "purple")):
            dx = V(i * 1.1, 0, 0)
            for g in TIERS[tier]:
                o = charkit.mesh_sculpt(GEAR[g][0](L, H, tier), g + tier, 0.0025, *gear_bounds(g, L),
                                        colors=MAT_COLORS)
                o.location = dx
            if i:
                for b in base:
                    o = meshutil.duplicate(b, b.name + "_2")
                    o.location = dx
        views = [dict(target=(0.55, 0, 0.95), ortho=2.6, yaw=y, dist=8, pitch=4) for y in (0, 35, 150)]
        preview.render_views(os.path.join(out, "skeleton_full.png"), views, res=(760, 820))
    print(f"[skeleton] preview {args.preview} done in {time.time()-t0:.1f}s")


# ============================================================================ build
def build(args):
    T0 = time.time()
    fast = args.fast
    res = 1024
    h_body, h_head, h_hand, h_kilt, h_gear = ((0.0034, 0.0014, 0.0011, 0.0026, 0.002) if fast else
                                              (0.0018, 0.0009, 0.0007, 0.0014, 0.0011))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(SKEL)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["purple"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}, "timings": {}}
    BM.HORNS.clear()

    t = time.time()
    S, info = body_sculpt(L)
    H = info["H"]
    KP = info["kilt"]
    Sk = loincloth(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    Sglow = glow_sculpt(info["eyes"])
    G = {}
    for tier in tiers:
        for g in TIERS[tier]:
            key = g
            if key not in G:
                G[key] = (GEAR[g][0](L, H, tier), g)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops) gear={list(G)}")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN)

    t = time.time()
    his = {}
    if args.stage != "skin":
        body_hi = pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX)
        charkit.drop_islands(body_hi, h_body)
        head_hi = pipeline.sculpt_mesh(S, "head_hi", h_head, HEAD_BOX[0] - 0.01, HEAD_BOX[1] + 0.01, keep_box=HEAD_BOX)
        his["body"] = [body_hi, head_hi]
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.12, w + 0.12)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        for nm, (Sg, g) in G.items():
            o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *gear_bounds(g, L))
            charkit.drop_islands(o, h_gear, min_verts=40)
            his[nm] = [o]
    report["timings"]["sdf_hi"] = time.time() - t
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    h_lo = 0.0028 if not fast else 0.0034
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0014, args.hand_tris, w - 0.12, w + 0.12,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.0024, args.kilt_tris)
    for nm, (Sg, g) in G.items():
        sym = g in ("helm", )
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0024, GEAR[g][2], *gear_bounds(g, L), symmetry=sym,
                                   clean=lambda o: charkit.drop_islands(o, 0.0024, min_verts=30))
    glow_lo = pipeline.lowpoly(Sglow, "glow_lo", 0.0015, 120, symmetry=False)
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    body_points = meshutil.get_verts(los["body"])
    skull_points = body_points[body_points[:, 2] >= HEAD_BOX[0][2]]
    report["measured_skull_width_m"] = float(np.ptp(skull_points[:, 0]))
    cloth_points = meshutil.get_verts(los["kilt"])
    report["measured_cloth_bounds_m"] = [cloth_points.min(0).tolist(), cloth_points.max(0).tolist()]
    report["ankle_stance_width_m"] = 2 * (SKEL["stance_x"] + 0.004)
    report["limb_radii_m"] = dict(upperarm=[0.040, 0.027, 0.024, 0.036],
                                  femur=[0.043, 0.030, 0.028, 0.040], tibia=[0.031, 0.024, 0.027],
                                  fibula=[0.018, 0.0135, 0.018],
                                  radius=[0.024, 0.0165, 0.021], ulna=[0.022, 0.014, 0.018])
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    report["timings"]["lo"] = time.time() - t
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = part_weights(S, los["body"], arm)
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s, reach=0.1), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN)
    for nm, (_, g) in G.items():
        charkit.rigid_bind(los[nm], arm, GEAR[g][1])
    charkit.rigid_bind(glow_lo, arm, "head")
    report["timings"]["weights"] = time.time() - t
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt"]

    def tier_parts(tier):
        return common + list(TIERS[tier])
    if args.stage == "skin":
        obs = [los[k] for k in tier_parts("purple")]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.log(f"tris purple {meshutil.tri_count(body)}")
        pipeline.export_glb(team.guard_out(os.path.join(OUT_MODELS, "skeleton_skin_test.glb")), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    order = common + list(G)
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k in order:
        fm, _ = pipeline.eval_attrs_mat_only(sculpt_of[k], pipeline.face_centers(los[k]))
        LOW_FACE_MATS[los[k].name] = (fm, sculpt_of[k].materials)
    report["uv_method"] = "semantic bone/material smart charts 72deg, teeth 5x, repair_smear, 5px nearest gutters"
    report["uv_islands"] = {k: bone_charts(los[k], arm) for k in order}
    # The CLOSEST_UDIM packer must receive all charts in the same source tile.
    uv_all = np.concatenate([pipeline.loop_arrays(los[k])[3] for k in order])
    uv_min = uv_all.min(0)
    uv_span = max(float(np.ptp(uv_all, axis=0).max()), 1e-9)
    for k in order:
        pipeline.set_loop_uv(los[k], 0.02 + 0.95 * (pipeline.loop_arrays(los[k])[3] - uv_min) / uv_span)
    report["uv_refolded"] = 0
    report["uv_repair"] = UV_REPAIR
    report["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=CONFIG["uv_margin"], res=res)
    report["timings"]["uv"] = time.time() - t
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    el, wr, b, Lf = BM.forearm_frame(L, "L")
    dors = norm(-L["hand_n_L"] - b * float(np.dot(-L["hand_n_L"], b)))
    extra_p = dict(eyes=[tuple(e) for e in info["eyes"]], wood_u=tuple(norm(np.cross(dors, b))))
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.008, 0.02), "hand_L": (0.004, 0.01), "hand_R": (0.004, 0.01), "kilt": (0.004, 0.01)}
    for tier in tiers:
        tt = time.time()
        pal = tier_pal(tier)
        report.setdefault("palette_snapshot", {})[tier] = pal
        parts = tier_parts(tier)
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, extra_p, painters=PAINTERS)
        for o in all_hi + list(los.values()) + [glow_lo]:
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.005, 0.014)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        bake_start = time.time()
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        report["timings"]["bake_" + tier] = time.time() - bake_start
        export_start = time.time()
        prefix = f"{ASSET}_{tier}"
        tex = composite_bone_maps(maps, OUT_TEX, prefix, pal)
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        gmat = glow_material("M_" + prefix + "_glow", pal["glow"], pal["glow_strength"])
        dups = []
        for k in parts:
            o = meshutil.duplicate(los[k], f"{k}_{tier}")
            o.data.materials.clear()
            o.data.materials.append(mat)
            pipeline.strip_for_export(o)
            report.setdefault("nonmanifold_split", {})[f"{k}_{tier}"] = split_nonmanifold(o)
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
        labels = semantic_atlas(parts, los, sculpt_of, res)
        pipeline.save_png(labels, out + ".labels.png", prefix + "_labels", "Non-Color")
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        rim = team.rim_scales("skeleton", tier)
        if tier == "purple":
            # r23 same-camera .5/.15/0 A/B: the tan skull/socket/rib halos are the warm pixel rim,
            # not baked pigment. Keep scene/key reflections; remove this additive outline on violet bone.
            for spec in rim.values(): spec["rim"] = CONFIG["purple_rim"]
        rim["M_" + prefix + "_glow"] = {"rim": 0.0}
        team.patch_extras(out, rim)
        rep["rim_extras"] = rim
        rep["contract"] = team.check_glb(out, "skeleton", tier)
        report["timings"]["export_" + tier] = time.time() - export_start
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "white":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(team.guard_out(os.path.join(OUT_MODELS, "skeleton_report.json")), report)
    report["form"] = dict(long_bones="tapered shafts, paired forearms/shins, lobed joint ends", toes_per_foot=5,
                          skull_width_m=2 * 0.098 * H.s * CONFIG["skull_width_scale"], rib_mm=2 * (CONFIG["rib_radius"] - 0.001) * 1000)
    report["seconds"] = time.time() - T0
    pipeline.write_json(team.guard_out(os.path.join(OUT_MODELS, "skeleton_report.json")), report)
    pipeline.log(f"DONE {ASSET} {tiers} in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=None)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--fast", action="store_true")
    mode.add_argument("--release", action="store_true", help="Sept full-resolution sculpt and bake samples, 1024 atlas")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--tiers", default=None)
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=8500)
    ap.add_argument("--head-tris", type=int, default=2600)
    ap.add_argument("--hand-tris", type=int, default=650)
    ap.add_argument("--kilt-tris", type=int, default=550)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    OUT_MODELS = os.path.abspath(team.guard_out(a.out or OUT_MODELS))
    OUT_TEX = team.guard_out(os.path.join(OUT_MODELS, "textures"))
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)
    np.random.seed(CONFIG["seed"])
    if a.preview:
        preview_main(a)
    else:
        build(a)
