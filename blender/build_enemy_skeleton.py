"""Build the Grave Skeleton (horde undead, Golden Axe skeleton DNA) with the blender/lib pipeline -- two tiers.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_enemy_skeleton.py -- [options]
Options:
  --preview full|head       clay renders to progress/shots/enemies-art-2/dev/ (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --stage skin              LO + weights + stretch QA only (progress/tmp/skeleton_skin_test.glb)
  --tiers white,purple      export only these tiers
Default: public/assets/models/enemy_skeleton_white.glb (+ copy enemy_skeleton.glb) and enemy_skeleton_purple.glb,
textures public/assets/textures/enemy_skeleton_<tier>_*.png, report blender/out/skeleton_report.json.

Design: a 1.8 m stylised skeleton warrior with THICK bones (read at ~180 px): a big chunky skull with a heavy
scowling brow bar, deep sockets holding glowing ember pinpoints (separate emissive mesh / 2nd material, so the
body's hit-flash still works), a toothy grin over a dark mouth void; a barrel ribcage of 5 fat ribs over a dark
'void' core (ribs read as bright bars on black), lumbar vertebrae waist, butterfly pelvis with a leather belt and
tattered rag loincloth (kilt chains F/B), two-bone forearms / shins with a real gap, knobbly joints, bony feet.
Gear: rusted iron pauldron on the left shoulder over a leather pad, round wooden shield with an iron rim + boss
strapped to the left forearm (rigid forearm_L), notched sword = weapon_sword_bone.glb (separate build).
  white  : warm ochre-ivory grave-dirty bone, ember-orange eyes, warm wood shield, dusty red rags
  purple : (elite) dusky mauve bone, violet eyes, horned blackened half-helm, second pauldron, broken
           breastplate, black-violet shield + rags.
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

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-2", "dev")
ASSET = "enemy_skeleton"

# Proportions (Blender, metres); height matches src/enemies/types/skeleton.js (1.8). Big skull (1/6.7 of height).
SKEL = dict(
    height=1.8, head_h=0.27,
    shoulder_x=0.205, shoulder_z=1.42, clav_in_x=0.024,
    hip_x=0.095, hip_joint_z=0.89, pelvis_z=0.93,
    knee_z=0.48, ankle_z=0.085, foot_len=0.24, stance_x=0.115,
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
    "white": ["shield", "pauldron_L"],
    "purple": ["shield", "pauldron_L", "pauldron_R", "helm", "breastplate"],
}


# ============================================================================ helpers
def forearm_bones(S, L, side, mat="bone"):
    """Radius + ulna: two bowed bones with a real gap, joined at the elbow / wrist knobs."""
    el, wr, b, Lf = BM.forearm_frame(L, side)
    t = L["hand_t_" + side]
    t = norm(t - b * float(np.dot(t, b)))
    for sg, r0, r1 in ((1, 0.021, 0.019), (-1, 0.019, 0.016)):
        pts = [el + t * sg * 0.01, el + b * Lf * 0.5 + t * sg * 0.026, wr + t * sg * 0.013]
        S.add(Chain(pts, [r0, (r0 + r1) / 2, r1]), 0.006, mat=mat)
    S.add(Ellipsoid(wr - b * 0.008, V(0.028, 0.028, 0.026)), 0.008, mat=mat)


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


def head_frame(L):
    return anatomy.HeadFrame(L)


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
    for row, z, hh, n in ((0, -0.108, 0.013, 8), (1, -0.134, 0.011, 8)):
        for i in range(n):
            if row == 0 and i == 5:
                continue                                   # missing tooth (character)
            a = (i + 0.5) / n * 1.9 - 0.95
            c = H(math.sin(a) * 0.048, -0.066 - math.cos(a) * 0.04, z)
            yaw = math.degrees(a)
            S.add(RoundBox(c, H.r(0.0068, 0.0055, hh), rot(0, 0, yaw), r=0.004 * s), 0.002, mat="teeth")
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
    S.add(Ellipsoid(V(0, 0.012, 1.245), V(0.112, 0.082, 0.13)), 0.0, mat="void")
    S.add(Capsule(V(0, 0.07, 1.14), V(0, 0.064, 1.4), 0.02), 0.01, mat="bone")               # thoracic spine
    for z in np.linspace(1.16, 1.38, 6):
        S.add(RoundCone(V(0, 0.08, z), V(0, 0.112, z - 0.014), 0.012, 0.008), 0.004, mat="bone")
    for i, z in enumerate(RIB_ZS):
        f = i / (len(RIB_ZS) - 1)
        rx = 0.132 + 0.026 * math.sin(math.pi * (0.25 + 0.75 * f))
        ry = 0.1 + 0.012 * math.sin(math.pi * f)
        r = 0.0135 - 0.0015 * f
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
        S.add(Sphere(L["hip_" + sx_side(sx)] + V(sx * 0.006, 0, 0.004), 0.036), 0.012, mat="bone")   # acetabulum
        S.add(Chain([V(sx * 0.1, 0.0, 0.95), V(sx * 0.07, -0.04, 0.9), V(sx * 0.02, -0.052, 0.885)], 0.017), 0.01,
              mat="bone")                                                                          # pubic arch
    S.add(Ellipsoid(V(0, 0.052, 0.95), V(0.048, 0.026, 0.062), rot(-18, 0, 0)), 0.014, mat="bone")    # sacrum
    S.add(Ellipsoid(V(0, -0.052, 0.885), V(0.034, 0.016, 0.022)), 0.01, mat="bone")                   # symphysis


def arm(S, L, side, T):
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    S.add(Sphere(sh, 0.047), 0.01, mat="bone")
    a = norm(el - sh)
    S.add(RoundCone(sh + a * 0.03, el - a * 0.03, 0.033, 0.027), 0.012, mat="bone")
    S.add(Ellipsoid(el - a * 0.012, V(0.043, 0.036, 0.036), basis(a)[:, [1, 2, 0]]), 0.01, mat="bone")   # epicondyles
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
    S.add(RoundCone(tro + V(-sx * 0.01, 0, -0.03), kn + V(0, 0, 0.04), 0.039, 0.032), 0.014, mat="bone")  # femur
    S.add(Ellipsoid(kn + V(0, 0.006, 0.018), V(0.05, 0.04, 0.034)), 0.012, mat="bone")                 # condyles
    S.add(Ellipsoid(kn + V(0, -0.04, 0.008), V(0.027, 0.013, 0.03)), 0.008, mat="bone")               # patella
    T("thigh_" + side)
    S.add(Ellipsoid(kn + V(0, 0.0, -0.022), V(0.047, 0.038, 0.027)), 0.01, mat="bone")                   # tibial head
    S.add(RoundCone(kn + V(0, -0.006, -0.03), an + V(0, -0.004, 0.035), 0.032, 0.024), 0.01, mat="bone")  # tibia
    fib = [kn + V(sx * 0.034, 0.016, -0.03), (kn + an) / 2 + V(sx * 0.046, 0.024, 0), an + V(sx * 0.034, 0.014, 0.03)]
    S.add(Chain(fib, [0.015, 0.014, 0.014]), 0.006, mat="bone")                                         # fibula
    for dx in (0.028, -0.024):
        S.add(Sphere(an + V(sx * dx, 0.004, 0.008), 0.018), 0.008, mat="bone")                          # malleoli
    T("shin_" + side)
    # bony foot
    ball, toe = L["ball_" + side], L["toe_" + side]
    S.add(Ellipsoid(an + V(0, 0.03, -0.045), V(0.026, 0.038, 0.03)), 0.012, mat="bone")                 # heel
    S.add(RoundCone(an + V(0, 0.0, -0.02), ball + V(0, 0.02, 0.012), 0.028, 0.022, squash=(1.0, 1.6),
                    ref=(0, 0, 1)), 0.012, mat="bone")                                                  # tarsals
    T("foot_" + side)
    for i, dx in enumerate((-0.024, -0.004, 0.016, 0.032)):
        b0 = ball + V(sx * dx, 0.02, 0.006)
        b1 = ball + V(sx * dx * 1.1, -0.012, -0.006)
        tp = b1 + V(sx * dx * 0.15, -0.045 + 0.006 * i, -0.004)
        r = 0.012 - 0.0015 * i
        S.add(Capsule(b0, b1, r * 0.9), 0.004, mat="bone")
        T("foot_" + side)
        S.add(Sphere(b1, r * 1.05), 0.003, mat="bone")
        S.add(RoundCone(b1, tp, r * 0.95, r * 0.8), 0.004, mat="bone")
        T("toe_" + side)


def belt(S):
    """Leather belt slung between the ilium wings, sagging in front, knotted at the right hip."""
    ring = []
    for i in range(49):
        a = i / 48 * 2 * math.pi
        front = 0.5 + 0.5 * math.cos(a)
        ring.append(V(math.sin(a) * (0.15 + 0.008 * front), 0.012 - math.cos(a) * (0.098 if front > 0.5 else 0.07),
                      BELT_Z - 0.05 * front ** 2.5))
    S.add(Chain(ring, 0.013, squash=(0.55, 1.0), ref=(0, 0, 1), margin=0.02), 0.004, mat="leather")
    S.add(RoundBox(V(-0.14, -0.06, BELT_Z - 0.03), V(0.022, 0.012, 0.02), rot(0, 0, -40), r=0.005), 0.004,
          mat="iron")


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
    anatomy.hand(S, L, side, "grip" if side == "R" else "relaxed", {}, grip_r=GRIP_R)
    # knuckle knobs (bony read) along the metacarpal heads
    W = L["wrist_" + side]
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    sc = L["P"]["hand"] / 0.2
    for i in range(4):
        p = W + h * (0.09 * sc) + t * ((0.026 - 0.017 * i) * sc) - n * 0.008
        S.add(Sphere(p, 0.0105), 0.004, mat="bone")
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
    for side, yc, w, hz, seed in (("F", -0.108, 0.1, 0.63, 3), ("B", 0.085, 0.12, 0.6, 5)):
        sg = -1 if side == "F" else 1
        top = BELT_Z - (0.05 if side == "F" else 0.0) + 0.012
        cyl = Ellipsoid(V(0, 0.0, 0.8), V(0.2, abs(yc) + 0.002, 0.6))
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
        S.sub(Inter(Slab(c + u * (i * 0.084 + 0.042), u, 0.0028), Sphere(c, R - 0.02), Shell(dome_s, 0.0035)), 0.004)
    MT = basis(dors)[:, [1, 2, 0]]
    S.add(Torus(c + dors * 0.003, R - 0.004, 0.016, MT, squash=0.7), 0.004, mat="iron")                  # rim
    for sb in (-0.1, 0.1):                                                                                # bands
        S.add(Inter(Slab(c + b * sb, b, 0.017), Sphere(c, R - 0.005), Offset(disc, 0.004), k=0.002), 0.003,
              mat="iron")
    boss = Inter(Sphere(c + dors * 0.0, 0.07), HalfSpace(c + dors * 0.024, -dors), k=0.004)
    S.add(boss, 0.01, mat="iron")
    S.add(Torus(c + dors * 0.026, 0.066, 0.009, MT), 0.004, mat="iron")
    if tier == "purple":                                     # spiked boss + more studs
        S.add(RoundCone(c + dors * 0.06, c + dors * 0.13, 0.024, 0.003), 0.006, mat="iron")
    for j in range(16):
        a = j / 16 * 2 * math.pi
        d = u * math.cos(a) + b * math.sin(a)
        S.add(Sphere(c + d * (R - 0.004) + dors * 0.012, 0.0085), 0.002, mat="iron")
    for sb in (-0.1, 0.1):
        for sgn in (-1, 1):
            S.add(Sphere(c + b * sb + u * sgn * 0.15 + dors * 0.022, 0.008), 0.002, mat="iron")
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
    S.add(Sphere(c, 0.05), 0.0, mat="leather")                                       # pad (touches the ball)
    dome = Inter(Shell(Ellipsoid(c + up * 0.004, V(0.07, 0.114, 0.114) * big, basis(up)), 0.0065), HalfSpace(c - up * 0.02, -up),
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
        S.add(RoundCone(p - d * 0.01, p + d * 0.07, 0.016, 0.002), 0.004, mat="iron")
    return S


def helm(L, H):
    """(purple) Blackened iron half-helm on the cranium with swept-forward horns, riveted brow band."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    base = Ellipsoid(H(0, 0.018, 0.028), H.r(0.098, 0.113, 0.1))
    c1 = H(0, -0.095, 0.035)
    nrm = norm(V(0, -0.35, 1))
    dome = Inter(Shell(Offset(base, 0.012), 0.007), HalfSpace(c1 - nrm * 0.0, -nrm), k=0.004)
    S.add(Displace(dome, 0.0007, 34.0, 2, seed=31), 0.0, mat="iron")
    band = Inter(Shell(Offset(base, 0.016), 0.006), Slab(c1 + nrm * 0.012, nrm, 0.012), k=0.003)
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
    env = Ellipsoid(V(0, 0.008, 1.245), V(0.165, 0.118, 0.16))
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
    strap = [V(0.0, -0.14, 1.33), V(-0.08, -0.12, 1.4), V(-0.14, -0.04, 1.455), V(-0.14, 0.06, 1.44),
             V(-0.09, 0.13, 1.35)]
    S.add(Chain(strap, 0.009, squash=(0.5, 1.0), ref=(0, 0, 1)), 0.004, mat="leather")
    return S


GEAR = {  # name -> (builder(L, H, tier), bone, tris)
    "shield": (lambda L, H, t: shield(L, t), "forearm_L", 1100),
    "pauldron_L": (lambda L, H, t: pauldron(L, "L", t), "upperarm_L", 420),
    "pauldron_R": (lambda L, H, t: pauldron(L, "R", t), "upperarm_R", 420),
    "helm": (lambda L, H, t: helm(L, H), "head", 900),
    "breastplate": (lambda L, H, t: breastplate(L), "chest", 600),
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
    rgb = shaders.mix(rgb, pal["bone_dark"], shaders.smooth01(c.cav, 0.02, 0.4) * 0.92)
    rgb = shaders.mix(rgb, np.minimum(pal[key] * 1.1 + 0.03, 1), 0.4 * c.ridge)
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
    p = dict(PAL)
    p.update(TIER_PAL[tier])
    return p


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
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt, h_gear = ((0.0034, 0.0014, 0.0011, 0.0026, 0.002) if fast else
                                              (0.0018, 0.0009, 0.0007, 0.0014, 0.0011))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(SKEL)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["purple"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}}
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
            key = g if g not in ("shield", "pauldron_L") else f"{g}_{tier}"
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
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
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
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt"]

    def tier_parts(tier):
        return common + [g if g not in ("shield", "pauldron_L") else f"{g}_{tier}" for g in TIERS[tier]]
    if args.stage == "skin":
        obs = [los[k] for k in tier_parts("purple")]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.log(f"tris purple {meshutil.tri_count(body)}")
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "skeleton_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=FACE_DENSITY,
                                                face_box=(-0.06, -0.17, 0.045))
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.85)
    for nm, (_, g) in G.items():
        charkit.smart_uv(los[nm], 62.0, 1.1 if g != "shield" else 0.9)
    order = common + list(G)
    report["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=6 if not fast else 4, res=res)
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
        parts = tier_parts(tier)
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, extra_p, painters=PAINTERS)
        for o in all_hi + list(los.values()) + [glow_lo]:
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.005, 0.014)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        prefix = f"{ASSET}_{tier}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix)
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        gmat = glow_material("M_" + prefix + "_glow", pal["glow"], pal["glow_strength"])
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
        if tier == "white":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(os.path.join(HERE, "out", "skeleton_report.json"), report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "skeleton_report.json"), report)
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
    ap.add_argument("--body-tris", type=int, default=8000)
    ap.add_argument("--head-tris", type=int, default=2300)
    ap.add_argument("--hand-tris", type=int, default=560)
    ap.add_argument("--kilt-tris", type=int, default=700)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
