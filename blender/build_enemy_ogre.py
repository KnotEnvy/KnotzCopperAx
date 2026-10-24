"""Build the Ogre Brute (Golden Axe 'Bad Brothers' DNA: the hammer giants) -- three hide tiers.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_enemy_ogre.py -- [options]
Options:
  --preview full            clay renders to progress/shots/enemies-art-3/dev/ (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --stage skin              LO + weights + stretch QA only (progress/tmp/ogre_skin_test.glb)
  --tiers green,red,silver  export only these tiers
Default: public/assets/models/enemy_ogre_<tier>.glb (+ copy green -> enemy_ogre.glb), textures
public/assets/textures/enemy_ogre_<tier>_*.png, report blender/out/ogre_report.json.

SCALE: the body is sculpted, weighted and QA'd at a knight-like REFERENCE scale (1.94 m) where the parametric anatomy
is proven, then the finished armature + mesh are scaled by K (applied, not a node transform) at export, so the GLB is
natively ~2.75 m tall and the engine needs no manifest scale.

Design: a hunched hill giant. The tiny tusked head sits LOW and FORWARD between a mountain of trapezius; huge
knuckle-heavy arms with forearms bigger than a man's thigh, a hard pot belly bound in a hide wrap with two riveted
iron hoops, a thick shaggy fur collar, a hide-and-iron pauldron on the left shoulder, a diagonal harness strap with an
iron ring, iron-hooped forearm wraps, wrapped hide boots, a four-panel hide war-skirt. Right fist grips the stone
hammer (weapon_ogre_hammer.glb), left hand open for the grab. Tiers (Brute Brothers = green + red):
  green  : moss-green hide, bone-white war-paint stripes, brown fur                        (pauldron L)
  red    : clay-red hide, black soot mask + chest bars, dark fur, iron skullcap with horns  (pauldron L + helm)
  silver : ash-grey hide, blue woad, grey fur, BOTH pauldrons                              (pauldron L + R)
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
from mathutils import Matrix

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
# r2 skin fix: the ogre's armpit (giant lats) sits BELOW the chest bone, so the lat/armpit skin is spine-dominant.
# restrict_adjacent (anatomical validity) zeroed every spine<->upperarm blend there -> hard weight step -> thousands
# of stretched edges in raised-arm clips (knockdown / launched / taunt / magic). Allow the blend (ogre only: the
# mutation lives in this Blender process).
skin.ADJ["spine"] = set(skin.ADJ["spine"]) | {"upperarm_L", "upperarm_R"}
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-3", "dev")
ASSET = "enemy_ogre"
K = 1.42                      # export scale (reference 1.94 m -> 2.75 m)

OGRE = dict(
    # C1 r3: head 0.212 -> 0.33 m (about 1/6.3 of the body, 1/5 with headgear) raised clear of the traps on a short
    # thick neck and pushed forward (aggressive head-first stance). Crown +0.13 m (reference) above the r2 build.
    height=2.15, head_h=0.33, head_dy=-0.085,
    shoulder_x=0.30, shoulder_z=1.585, clav_in_x=0.03,
    hip_x=0.135, hip_joint_z=0.88, pelvis_z=0.94,
    knee_z=0.47, ankle_z=0.095, foot_len=0.31, stance_x=0.175,
    spine_z=1.12, chest_z=1.34, neck_z=1.68, head_base_z=1.86,
    upperarm=0.39, forearm=0.34, hand=0.4,
    arm_down=47.0, arm_fwd=11.0, elbow_bend=16.0,
)
STYLE = dict(muscle=1.45, defin=0.35, fat=1.3, chest=1.35, lats=1.3, traps=1.45, waist=1.45, delts=1.55, arm=1.75,
             forearm=1.95, neck=1.75,
             brow=1.45, jaw=2.0, scowl=1.5, cheek=1.1, chin=1.5, nose_len=0.8, nose_w=1.5, nose_bump=1.3, lip=1.3,
             mouth_w=1.3, eye=1.7, squint=0.95, skull_w=1.0, skull_h=0.86, ear=1.55, fem=0.0)
MATERIALS = ["skin", "eye", "nail", "brow", "hide", "hide_dark", "fur", "leather", "leather_dark", "iron", "bronze",
             "bone", "rope"]
GEAR_MATS = ["hide", "hide_dark", "iron", "bone", "fur", "leather", "brow"]
KINDS = {"hide": "leather", "hide_dark": "leather", "rope": "cloth", "bone": "nail", "bronze": "iron"}
WRIST_CUT_T = 0.88
HAND_CUT_T = 0.8
GRIP_R = 0.036                # x K = 5.1 cm hammer haft
BELT_Z = 1.0
KILT_CHAIN = 2
LEG_GAP_TOP = 0.75
HEAD_BOX = (V(-0.21, -0.34, 1.74), V(0.21, 0.11, 2.17))
# C1 r3: tiers escalate by SILHOUETTE, not just hue: green bare-headed (tall bone-ringed topknot, fang-and-skull
# trophy necklace), red a big horned iron helm with cheek guards, silver a crested iron war-mask + heavy plate
# pauldrons on both shoulders.
TIERS = {
    "green": ["pauldron_L", "topknot", "necklace"],
    "red": ["pauldron_L", "helm_horned"],
    "silver": ["plate_L", "plate_R", "helm_crest"],
}
GEAR_BONE = {"pauldron": "upperarm_", "plate": "upperarm_", "topknot": "head", "helm": "head", "necklace": "chest"}


def ogre_landmarks():
    L = rig.landmarks(OGRE)
    dy = OGRE["head_dy"]
    for k, f in (("neck", 0.45), ("head", 1.0), ("head_top", 1.0), ("chin", 1.0)):
        L[k] = L[k] + V(0, dy * f, 0)
    return L


# ============================================================================ body
def forearm_frame(L, side):
    return BM.forearm_frame(L, side)


def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {"arms": {}, "legs": {}}
    T = anatomy.torso(S, L, STYLE)
    # giant masses: hard pot belly, trapezius mountain the head sinks into, heavy lats / love handles
    anatomy.E(S, T, (0, -0.05, 1.16), (0.16, 0.15, 0.16), k=0.08)                   # belly
    anatomy.E(S, T, (0, -0.03, 1.07), (0.15, 0.13, 0.1), k=0.07)                    # lower belly
    anatomy.E(S, T, (0, 0.06, 1.55), (0.15, 0.1, 0.1), k=0.07)                      # upper-back hump
    anatomy.E(S, T, (0.085, 0.025, 1.6), (0.075, 0.07, 0.085), k=0.06, sym=True)    # traps up the neck
    anatomy.E(S, T, (0.14, 0.03, 1.2), (0.07, 0.09, 0.1), k=0.07, sym=True)         # flanks
    anatomy.E(S, T, (0.1, -0.1, 1.42), (0.085, 0.06, 0.07), k=0.05, sym=True)       # slab pecs
    # C1 r4 (board r3: "smooth matte-plastic capsule"): readable big forms -- squared pec slabs with a shadowed
    # lower border, deltoid caps, a belly that hangs over a navel crease, a sternum groove
    anatomy.E(S, T, (0.105, -0.13, 1.45), (0.09, 0.045, 0.058), M=rot(0, 0, 8), k=0.03, sym=True)
    S.sub(SymX(Capsule(T(0.04, -0.17, 1.355), T(0.17, -0.12, 1.385), 0.014)), 0.03)     # under-pec shadow line
    S.sub(Capsule(T(0, -0.185, 1.38), T(0, -0.17, 1.5), 0.012), 0.025)                    # sternum groove
    anatomy.E(S, T, (0, -0.15, 1.12), (0.13, 0.08, 0.1), k=0.05)                          # belly front mass
    S.sub(Capsule(T(-0.12, -0.2, 1.0), T(0.12, -0.2, 1.0), 0.016), 0.04)                  # belly overhang crease
    S.sub(Ellipsoid(T(0, -0.225, 1.08), (0.011, 0.02, 0.016)), 0.012)                     # navel
    for s in ("L", "R"):
        info["arms"][s] = anatomy.arm(S, L, s, STYLE)
        info["legs"][s] = anatomy.leg(S, L, s, STYLE)
        anatomy.foot(S, L, s)
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        a = norm(el - sh)
        b = norm(wr - el)
        S.add(RoundCone(sh + a * 0.06, el - a * 0.03, 0.085, 0.07), 0.05)            # bulk upper arm
        sxs = 1 if s == "L" else -1
        S.add(Ellipsoid(sh + a * 0.07 + V(sxs * 0.035, -0.01, 0.01), V(0.075, 0.08, 0.085)), 0.035)   # deltoid cap
        S.add(Ellipsoid(sh + a * 0.2 + V(0, -0.045, 0), V(0.05, 0.05, 0.075)), 0.035)               # biceps
        S.add(RoundCone(el + b * 0.08, wr - b * 0.06, 0.088, 0.064), 0.05)           # popeye forearm
        hp, kn = L["hip_" + s], L["knee_" + s]
        S.add(RoundCone(hp + V(0, 0, -0.04), kn + V(0, 0, 0.05), 0.12, 0.085), 0.06)  # tree-trunk thigh
        an = L["ankle_" + s]
        S.add(RoundCone(kn + V(0, 0.01, -0.04), an + V(0, 0, 0.08), 0.078, 0.06), 0.05)
    info["head"] = anatomy.head(S, L, STYLE)
    H = info["head"]["H"]
    ogre_face(S, L, info["head"])
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    war_paint(S, L, H)
    # C1 r4: subtle warty hide relief (bakes into the normal map) on torso/limbs, never the face
    snap0 = S.snapshot()
    S.add(Bounded(Displace(Offset(snap0, -0.0016), 0.0028, 26.0, 3, seed=77), V(-0.9, -0.5, 0.05),
                  V(0.9, 0.5, float(L["neck"][2]) - 0.02)), 0.0025, mat="skin")
    snap = S.snapshot()
    for s in ("L", "R"):
        el, wr, b, Lf = forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.26)), wr - 0.26, wr + 0.26))
    costume(S, snap, L)
    snap2 = S.snapshot()
    fur_collar(S, snap2, L)
    gear.belt(S, snap2, L, z=BELT_Z, half=0.05, thick=0.03, buckle=True)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.02)
    info["kilt"] = kilt_params(S)
    return S, info


def ogre_face(S, L, hi):
    """C1 r3 brute face (Bad Brothers DNA), built to read from an elevated game camera at 50 % size:
    heavy brow shelf that still leaves the eyes visible from above, small bright deep-set eyes, flat broad nose,
    a big PROJECTING UNDERBITE jaw (lower lip + chin jut past the upper lip) with two thick upturned tusks and a row
    of lower teeth, jowls, and big pointed ogre ears that stand out from the skull."""
    H = hi["H"]
    s = H.s
    anatomy.eyebrows(S, H, scowl=1.5, thick=0.95)
    S.add(Ellipsoid(H(0, -0.07, 0.04), H.r(0.08, 0.022, 0.016)), 0.02)               # brow shelf (high: eyes show)
    # underbite: a jaw that juts forward and down past the upper lip
    S.add(Ellipsoid(H(0, -0.078, -0.126), H.r(0.084, 0.056, 0.04)), 0.03)            # mandible mass
    S.add(RoundBox(H(0, -0.103, -0.13), H.r(0.05, 0.024, 0.028), r=0.016 * s), 0.02)  # jutting chin / lower lip shelf
    S.add(Ellipsoid(H(0, -0.112, -0.112), H.r(0.04, 0.012, 0.009)), 0.008)           # everted lower lip
    S.add(SymX(Ellipsoid(H(0.066, -0.046, -0.104), H.r(0.036, 0.05, 0.044))), 0.03)  # jowls
    S.add(SymX(Ellipsoid(H(0.07, -0.01, -0.085), H.r(0.026, 0.04, 0.04))), 0.025)   # masseter bulk
    # mouth line between the upper lip and the jutting lower jaw, lower teeth standing on the lip shelf
    S.sub(Capsule(H(-0.04, -0.1, -0.1), H(0.04, -0.1, -0.1), 0.0055 * s), 0.004)
    S.sub(Ellipsoid(H(0, -0.11, -0.1), H.r(0.036, 0.014, 0.0075)), 0.004)
    # C1 r4: near-black mouth cavity paint behind the bone teeth/tusks (value contrast at 1x)
    S.paint(Ellipsoid(H(0, -0.105, -0.1), H.r(0.046, 0.03, 0.0095)), "tattoo", soft=0.004, value=1.0)
    for x in (-0.021, -0.007, 0.007, 0.021):
        S.add(RoundBox(H(x, -0.12, -0.099), H.r(0.0055, 0.0045, 0.0075), r=0.0028 * s), 0.0015, mat="nail")
    # thick upturned tusks from the jaw corners, flaring out (silhouette read)
    for sx in (1, -1):
        b0 = H(sx * 0.036, -0.112, -0.112)
        BM.horn(S, b0, [(sx * 0.007, -0.01, 0.024), (sx * 0.017, -0.014, 0.048), (sx * 0.031, -0.01, 0.07)],
                0.0162, s=s, mat="bone", rings=False)                     # C1 r4: +20 %
    # pointed ogre ears: thick lobe + a tip that sweeps up and back, sticking out from the skull
    for sx in (1, -1):
        ec = H(sx * 0.082, 0.012, -0.03)
        S.add(RoundCone(ec, ec + V(sx * 0.038, 0.034, 0.03) * s, 0.017 * s, 0.004 * s), 0.008)
        S.add(Ellipsoid(ec + V(sx * 0.008, 0.002, -0.018) * s, H.r(0.012, 0.016, 0.018)), 0.006)
        S.sub(Ellipsoid(ec + V(sx * 0.02, -0.004, 0.0) * s, H.r(0.006, 0.012, 0.014), rot(0, sx * -30, 0)), 0.004)
    # eyes that READ: open the lids wider than the anatomy default, re-seat the eyeball, then a heavy upper lid
    # slanted down toward the nose (angry) covering only the top of the ball
    er = hi["eye_r"]
    for sx, ec in zip((1, -1), hi["eyes"]):
        S.sub(Ellipsoid(ec + V(0, -er * 0.95, -0.0005 * s), H.r(0.0228, 0.0185, 0.015), rot(0, sx * -8, 0)), 0.0015)
        S.add(Sphere(ec, er), 0.0, mat="eye")
        nU = rot(-10, -sx * 16, 0) @ V(0, 0, 1)     # inner corner lower = scowl
        S.add(Inter(Sphere(ec, er + 0.0018 * s), HalfSpace(ec + V(0, 0, er * 0.32), -nU)), 0.0016, mat="skin")
        S.add(Inter(Sphere(ec, er + 0.0012 * s), HalfSpace(ec + V(0, 0, -er * 0.72), V(0, 0, 1))), 0.0012, mat="skin")
    # C1 r4: dark socket ring framing each bright iris (reads as two eye spots at ~40 px)
    for ec in hi["eyes"]:
        S.paint(Diff(Ellipsoid(ec, H.r(0.03, 0.03, 0.022)), Sphere(ec, er * 1.02)), "tattoo", soft=0.006, value=0.55)
    # stubbly scalp + chin
    S.paint(Ellipsoid(H(0, 0.02, 0.035), H.r(0.1, 0.125, 0.085)), "stubble", soft=0.02, value=0.4)
    S.paint(Ellipsoid(H(0, -0.11, -0.112), H.r(0.04, 0.02, 0.012)), "lips", soft=0.004)
    # warm thin-skin zones (ears, nose, lids) for a subsurface read
    S.paint(Union(SymX(Sphere(H(0.1, 0.02, -0.02), 0.035 * s)), Sphere(H(0, -0.1, -0.07), 0.025 * s), k=0.01),
            "warm", soft=0.02, value=0.8)


def war_paint(S, L, H):
    """Two paint layouts on the same body (the tier palette decides which one shows and in what colour):
    warA = bone-white stripes (3 chest bars, upper-arm rings, chin stripes);
    warB = soot mask across the eyes + a vertical chest bar + a big hand-print on the left pec."""
    nk = L["neck"]
    front = HalfSpace(V(0, -0.02, 0), V(0, 1, 0))
    for i, z in enumerate((1.5, 1.43, 1.36)):
        S.paint(Inter(Slab(V(0, 0, z), norm(V(0, 0.25, 1)), 0.014), front, Sphere(V(0, -0.1, z), 0.24)), "warA",
                soft=0.008, value=1.0)
    for s in ("L", "R"):
        sh, el = L["shoulder_" + s], L["elbow_" + s]
        a = norm(el - sh)
        for t in (0.45, 0.6):
            c = sh + (el - sh) * t
            S.paint(Inter(Slab(c, a, 0.013), Sphere(c, 0.16)), "warA", soft=0.006, value=1.0)
    for sx in (-0.02, 0.0, 0.02):
        S.paint(Inter(Slab(H(sx, 0, 0), V(1, 0, 0), 0.0055 * H.s), Ellipsoid(H(0, -0.09, -0.12), H.r(0.04, 0.05, 0.03))),
                "warA", soft=0.003, value=1.0)
    # warB
    S.paint(Ellipsoid(H(0, -0.09, -0.02), H.r(0.1, 0.06, 0.024)), "warB", soft=0.008, value=1.0)
    S.paint(Inter(Slab(V(0, 0, 0), V(1, 0, 0), 0.03), front, HalfSpace(V(0, 0, float(nk[2]) - 0.04), V(0, 0, 1)),
                  HalfSpace(V(0, 0, 1.3), V(0, 0, -1))), "warB", soft=0.01, value=1.0)
    hc = V(0.13, -0.2, 1.44)
    palm = Ellipsoid(hc, V(0.05, 0.2, 0.045))
    fingers = Union(*[Capsule(hc + V(dx, 0, 0.03), hc + V(dx * 1.5, 0, 0.1), 0.012) for dx in (-0.03, -0.01, 0.01, 0.03)])
    S.paint(Union(palm, fingers, k=0.01), "warB", soft=0.006, value=1.0)


def limb_region(snap, t, a, b, pad0=0.0, pad1=0.0, r=0.25):
    ax = norm(b - a)
    Ln = float(np.linalg.norm(b - a))
    c = a + ax * (Ln * 0.5 + (pad1 - pad0) * 0.5)
    return Inter(Offset(snap, t), Slab(c, ax, Ln * 0.5 + (pad0 + pad1) * 0.5), Sphere((a + b) / 2, Ln * 0.5 + r),
                 k=0.004)


def costume(S, snap, L):
    """Hide belly wrap + iron hoops, harness strap + ring, forearm wraps + iron hoops, dark hide breeches, wrapped
    boots with rope bindings."""
    # belly wrap (full hoop) + two riveted iron hoops
    z0, z1 = BELT_Z + 0.02, 1.27
    wrap = Inter(Offset(snap, 0.016), HalfSpace(V(0, 0, z1), V(0, 0, 1)), HalfSpace(V(0, 0, z0), V(0, 0, -1)), k=0.004)
    S.add(Bounded(Displace(wrap, 0.0025, 14.0, 2, seed=21), V(-0.6, -0.5, z0 - 0.05), V(0.6, 0.5, z1 + 0.05)), 0.0,
          mat="hide")
    S.add(Bounded(Inter(Offset(snap, 0.02), Slab(V(0, 0, z1 - 0.004), V(0, 0, 1), 0.008), k=0.002),
                  V(-0.6, -0.5, z1 - 0.05), V(0.6, 0.5, z1 + 0.05)), 0.002, mat="hide_dark")        # rolled top edge
    for z in (1.08, 1.2):
        S.add(Bounded(Inter(Offset(snap, 0.03), Slab(V(0, 0, z), V(0, 0, 1), 0.02), k=0.003),
                      V(-0.6, -0.5, z - 0.06), V(0.6, 0.5, z + 0.06)), 0.002, mat="iron")
        for i in range(16):
            a = (i + 0.5) / 16 * 2 * math.pi
            p = trace_in(S, V(0, 0, z), norm(V(math.sin(a), -math.cos(a), 0)), r=0.7)
            S.add(Sphere(p, 0.009), 0.002, mat="iron")
    # vertical lacing seam on the right side of the wrap
    for j in range(5):
        z = z0 + 0.03 + j * 0.045
        p = trace_in(S, V(0, 0, z), V(-1, 0, 0), r=0.7)
        S.add(Capsule(p + V(0, -0.02, -0.012), p + V(0, 0.02, 0.012), 0.005), 0.002, mat="rope")
    # diagonal harness strap: left shoulder -> right hip, front and back, iron ring on the sternum
    sL = L["shoulder_L"]
    for sy in (-1, 1):
        raw = [V(0.16, sy * 0.05, 1.66), V(0.08, sy * 0.3, 1.5), V(-0.04, sy * 0.35, 1.36), V(-0.2, sy * 0.3, 1.24),
               V(-0.3, sy * 0.2, 1.08)]
        gear.strap(S, snap, raw, width=0.075, thick=0.012, mat="leather")
    rc = S.project(np.array([V(0.03, -0.4, 1.43)]), offset=0.0)[0]
    S.add(Torus(rc + V(0, -0.02, 0), 0.042, 0.011, basis(V(0, -1, 0))[:, [1, 2, 0]]), 0.003, mat="iron")
    # arms: leather wraps + iron hoops on the forearms, rope cuff at the wrist
    for s in ("L", "R"):
        el, wr, b, Lf = forearm_frame(L, s)
        S.add(Bounded(Displace(limb_region(snap, 0.01, el, wr, pad0=-0.1, pad1=-0.02), 0.0015, 24.0, 2, seed=31),
                      el - 0.45, el + 0.45), 0.002, mat="leather")
        for t in (0.35, 0.58, 0.8):
            c = el + b * Lf * t
            S.add(Bounded(Inter(Offset(snap, 0.024), Slab(c, b, 0.016), Sphere(c, 0.2), k=0.003), c - 0.22, c + 0.22),
                  0.002, mat="iron")
        c = el + b * Lf * 0.94
        S.add(Bounded(Inter(Offset(snap, 0.02), Slab(c, b, 0.012), Sphere(c, 0.18), k=0.003), c - 0.2, c + 0.2),
              0.002, mat="rope")
    # dark hide breeches (hips -> mid thigh, under the skirt)
    br = Inter(Offset(snap, 0.008), HalfSpace(V(0, 0, BELT_Z + 0.02), V(0, 0, 1)), HalfSpace(V(0, 0, 0.62), V(0, 0, -1)),
               k=0.004)
    S.add(Bounded(Displace(br, 0.0015, 20.0, 2, seed=41), V(-0.6, -0.5, 0.58), V(0.6, 0.5, BELT_Z + 0.05)), 0.0,
          mat="leather_dark")
    # wrapped hide boots: foot + shin to below the knee, rope bindings, fur top
    for s in ("L", "R"):
        kn, an = L["knee_" + s], L["ankle_" + s]
        top = float(kn[2]) - 0.07
        boot = Inter(Offset(snap, 0.014), HalfSpace(V(0, 0, top), V(0, 0, 1)), Sphere((kn + an) / 2 + V(0, -0.06, -0.1), 0.42),
                     k=0.004)
        S.add(Bounded(Displace(boot, 0.0025, 16.0, 2, seed=51), an - 0.5, an + V(0.5, 0.5, 0.6)), 0.0, mat="hide")
        for j in range(4):
            z = float(an[2]) + 0.06 + j * 0.075
            n = norm(V(0, 0.35 * (1 if j % 2 else -1), 1))
            S.add(Bounded(Inter(Offset(snap, 0.02), Slab(V(an[0], an[1], z), n, 0.008), Sphere(V(an[0], an[1], z), 0.2),
                                k=0.002), an - 0.4, an + V(0.4, 0.4, 0.6)), 0.002, mat="rope")
        c = V(kn[0], kn[1], top + 0.005)
        ring = charkit.surface_ring(S, c, top + 0.005, 0.2, n=48, nz=0.3)
        gear.fur_band(S, ring, n=14, rows=1, length=(0.045, 0.06), width=(0.022, 0.028), droop=0.8, seed=60 + len(s),
                      mat="fur", k=0.008)
        # toe split on the wrapped foot (reads as a big two-lobed foot, not a boot)
        ball = L["ball_" + s]
        S.sub(Inter(Slab(ball + V(0, -0.06, 0), norm(V(1, 0, 0)), 0.004), Sphere(ball + V(0, -0.08, 0.0), 0.07), k=0.002),
              0.004)
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def fur_collar(S, snap, L):
    """Shaggy pelt collar around the neck base draped over the traps (two rows of heavy clumps)."""
    nk = L["neck"]
    z = float(L["P"]["shoulder_z"]) + 0.06          # C1 r3: a touch lower -> the neck shows above the pelt
    ring = charkit.surface_ring(S, V(0, float(nk[1]) + 0.01, 0), z, 0.3, n=64, nz=0.4)
    gear.fur_band(S, ring, n=30, rows=2, length=(0.13, 0.18), width=(0.036, 0.05), droop=0.86, seed=71, mat="fur",
                  k=0.01, row_dz=-0.035, row_out=0.014, roll=0.02, curl=0.5)


def kilt_params(S, z=BELT_Z - 0.02):
    c = V(0, 0.0, z)
    xs = ray_hit(S, c, V(1, 0, 0), r_max=0.8)[0]
    yf = ray_hit(S, c, V(0, -1, 0), r_max=0.8)[1]
    yb = ray_hit(S, c, V(0, 1, 0), r_max=0.8)[1]
    rx = float(xs) + 0.014
    ry = (float(yb) - float(yf)) / 2 + 0.014
    return dict(top_z=BELT_Z - 0.01, hem_z=0.5, r_top=rx, r_hem=rx * 1.14, squash=ry / rx, cy=float(yf + yb) / 2,
                yf=float(yf), yb=float(yb))


def war_skirt(kp):
    """Four overlapping hide panels (kilt chains F/B/L/R), ragged hems, dark stitched border, bone toggles."""
    S = Sculpt(materials=MATERIALS, default_mat="hide")
    top = kp["top_z"] + 0.03
    cone = RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"], kp["hem_z"] - 0.12), kp["r_top"], kp["r_hem"] + 0.03,
                     squash=(kp["squash"], 1.0))
    sh = Shell(cone, 0.007)
    # C1 r3: panels narrowed so the four flaps are SLIT apart at the hip corners (r2: F and L/R fused at the corner on
    # one shell -> the corner seam stretched/spiked when the chains swung apart). Front flap shorter + narrower so the
    # swinging fist passes in front of it on light_1.
    for side, ang, w, hz, seed in (("F", 0.0, 0.155, 0.53, 3), ("B", math.pi, 0.2, 0.48, 5),
                                   ("L", math.pi / 2, 0.15, 0.55, 7), ("R", -math.pi / 2, 0.15, 0.55, 9)):
        d = V(math.sin(ang), -math.cos(ang), 0)
        side_v = V(math.cos(ang), math.sin(ang), 0)
        wedge = Inter(HalfSpace(V(0, kp["cy"], 0) + d * 0.03, -d), Slab(V(0, kp["cy"], 0), side_v, w), k=0.004)
        rad = kp["r_hem"] * (kp["squash"] if side in ("F", "B") else 1.0)
        yc = V(0, kp["cy"], 0) + d * rad
        tongues = Union(*[Ellipsoid(yc + side_v * (w * f) + V(0, 0, hz + 0.22 + dz), V(0.07, 0.07, 0.24) + np.abs(d) * 0.3)
                          for f, dz in ((-0.72, 0.02), (-0.24, -0.04), (0.24, 0.0), (0.72, -0.05))], k=0.03)
        panel = Inter(sh, wedge, HalfSpace(V(0, 0, top), V(0, 0, 1)), tongues, k=0.004)
        lo, hi = V(-0.6, -0.6, hz - 0.12), V(0.6, 0.6, top + 0.04)
        S.add(Bounded(Displace(panel, 0.003, 12.0, 2, seed=seed), lo, hi), 0.0, mat="hide")
        border = Inter(Offset(sh, 0.002), wedge, tongues, HalfSpace(V(0, 0, top), V(0, 0, 1)),
                       Diff(Slab(V(0, kp["cy"], 0), side_v, w + 0.002), Slab(V(0, kp["cy"], 0), side_v, w - 0.022)),
                       k=0.002)
        S.add(Bounded(border, lo, hi), 0.001, mat="hide_dark")
        # bone toggle at the top of each panel
        p = V(0, kp["cy"], top - 0.05) + d * (kp["r_top"] * (kp["squash"] if side in ("F", "B") else 1.0) + 0.012)
        S.add(Capsule(p - side_v * 0.025, p + side_v * 0.025, 0.011), 0.003, mat="bone")
    return S


def hand_sculpt(L, side):
    """Huge thick-fingered hand (R grips the hammer haft, L open for the grab), wrapped knuckles."""
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    anatomy.arm(S, L, side, STYLE)
    sh, el, wr = L["shoulder_" + side], L["elbow_" + side], L["wrist_" + side]
    b = norm(wr - el)
    S.add(RoundCone(el + b * 0.08, wr - b * 0.06, 0.088, 0.064), 0.05)
    anatomy.hand(S, L, side, "grip" if side == "R" else "relaxed", STYLE, grip_r=GRIP_R)
    anatomy.hand_details(S, L, side)
    W = L["wrist_" + side]
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    sc = L["P"]["hand"] / 0.2
    snap = S.snapshot()
    # leather strip across the knuckles + wrist
    S.add(Bounded(Inter(Offset(snap, 0.005), Slab(W + h * 0.03 * sc, h, 0.03 * sc), k=0.003), W - 0.28, W + 0.28), 0.002,
          mat="leather")
    S.add(Bounded(Inter(Offset(snap, 0.004), Slab(W + h * 0.1 * sc, h, 0.012 * sc), Sphere(W + h * 0.1 * sc, 0.08),
                        k=0.002), W - 0.28, W + 0.28), 0.002, mat="leather")
    S.paint(Sphere(W + h * 0.1 * sc - n * 0.012, 0.045), "blush", soft=0.025, value=0.6)
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


# ============================================================================ rigid gear
def pauldron(snapA, L, side, heavy=False):
    """Crude hide-and-iron pauldron: thick hide dome, two riveted iron bands, iron boss with three spikes, fur trim.
    heavy (silver tier): bigger iron-clad dome raised higher, a second iron lame over the upper arm, a tall spike
    crown -- the silver brother's shoulders are visibly wider and spikier in silhouette."""
    S = Sculpt(materials=GEAR_MATS, default_mat="hide")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    cap = sh + a * 0.05 + up * (0.06 if heavy else 0.04)
    R = 0.25 if heavy else 0.21
    lo, hi = cap - 0.36, cap + 0.36
    plane = HalfSpace(sh - up * 0.06, -up)
    inner = HalfSpace(V(float(sh[0]) - sx * 0.13, 0, 0), V(-sx, 0, 0))
    t_out = 0.05 if heavy else 0.036
    body = Inter(BM.shell(snapA, t_out, 0.018), Sphere(cap, R), plane, inner, k=0.006)
    S.add(Bounded(Displace(body, 0.002, 16.0, 2, seed=81 + sx), lo, hi), 0.0, mat="iron" if heavy else "hide")
    if heavy:   # second riveted lame below the dome, over the upper arm
        lame = Inter(BM.shell(snapA, 0.04, 0.016), Slab(sh + a * 0.2, a, 0.045), Sphere(sh + a * 0.2, 0.2),
                     HalfSpace(sh + a * 0.2 - up * 0.02, -up), k=0.004)
        S.add(Bounded(lame, lo, hi), 0.003, mat="iron")
        S.add(Bounded(Inter(BM.shell(snapA, 0.044, 0.03), Slab(sh + a * 0.245, a, 0.008), Sphere(sh + a * 0.2, 0.21),
                            HalfSpace(sh + a * 0.2 - up * 0.02, -up), k=0.002), lo, hi), 0.002, mat="leather")
    S.add(Bounded(Inter(BM.shell(snapA, 0.04, 0.02), Diff(Sphere(cap, R + 0.003), Sphere(cap, R - 0.014)), plane, inner,
                        k=0.002), lo, hi), 0.002, mat="hide_dark")
    for t in (0.02, 0.1):
        c = sh + a * t
        band = Inter(BM.shell(snapA, 0.05, 0.03), Slab(c, a, 0.022), Sphere(cap, R + 0.02), plane, inner, k=0.003)
        S.add(Bounded(band, lo, hi), 0.002, mat="iron")
    side_v = norm(np.cross(a, up)) * sx
    for j in range(9):
        ang = -1.1 + j * (2.2 / 8)
        for t in (0.02, 0.1):
            d = norm(up * math.cos(ang) + side_v * math.sin(ang) + a * (t * 2.0 - 0.05))
            p = trace_in(S, sh + a * t, d, r=0.4)
            S.add(Sphere(p, 0.008), 0.002, mat="iron")
    # iron boss + spikes
    d0 = norm(up * 0.85 + V(sx * 0.45, 0, 0))
    p0 = trace_in(S, sh + a * 0.06, d0, r=0.4)
    S.add(Ellipsoid(p0, V(0.05, 0.05, 0.05)), 0.01, mat="iron")
    spikes = ((0.95, 0.2, 0.09), (0.6, 0.75, 0.075), (0.85, -0.2, 0.07))
    if heavy:
        spikes = ((1.0, 0.1, 0.17), (0.75, 0.6, 0.15), (0.9, -0.35, 0.13), (0.45, 0.95, 0.11), (0.95, 0.45, 0.14))
    for j, (du, dx, ln) in enumerate(spikes):
        d = norm(up * du + V(sx * dx, 0, 0) + a * (0.05 * j))
        p = trace_in(S, sh + a * 0.06, d, r=0.45)
        S.add(RoundCone(p - d * 0.01, p + d * ln, 0.026 if heavy else 0.02, 0.003), 0.006, mat="iron")
    # fur tufts under the lower edge
    rng = np.random.RandomState(90 + sx)
    for j in range(8):
        ang = -1.2 + j * (2.4 / 7) + rng.uniform(-0.1, 0.1)
        d = norm(up * math.cos(ang) * 0.6 + side_v * math.sin(ang) + a * 0.7)
        p = trace_in(S, sh + a * 0.14, d, r=0.4)
        q = p + a * 0.06 + d * 0.02
        S.add(Chain([p, (p + q) / 2 + a * 0.01, q], [0.02, 0.016, 0.005]), 0.008, mat="fur")
    return S


def helm_dome(S, snapH, H, front_z=0.036, back_drop=0.42, out=0.022, mat="iron", seed=95):
    """Iron skull dome over the scalp: rim just above the brows at the front, dropping toward the nape."""
    s = H.s
    nrm = norm(V(0, -back_drop, -1))
    keep = HalfSpace(H(0, -0.09, front_z), nrm)
    dome = Inter(BM.shell(snapH, out, 0.004), keep, k=0.004)
    S.add(Bounded(Displace(dome, 0.0015, 30.0, 2, seed=seed), H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4), 0.0, mat=mat)
    p0 = H(0, -0.09, front_z + 0.011)
    rim = Inter(BM.shell(snapH, out + 0.007, 0.006), Slab(p0, nrm, 0.012 * s), k=0.002)
    S.add(Bounded(rim, H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4), 0.002, mat=mat)
    hc = H(0, 0.016, 0)
    for i in range(16):
        ang = (i + 0.5) / 16 * 2 * math.pi
        d = norm(V(math.sin(ang), -math.cos(ang), 0.0))
        y = float(hc[1] + d[1] * 0.1 * s)
        z = float(p0[2] - back_drop * (y - float(p0[1])))       # rim plane height in this direction
        p = trace_in(S, V(0, float(hc[1]), z), d, r=0.35)
        S.add(Sphere(p, 0.0065 * s), 0.001, mat=mat)
    return keep


def helm_horned(snapH, H):
    """Red brother: big blackened iron helm (riveted brow band, central ridge, cheek guards) with two massive
    forward-hooking bull horns -- the widest head silhouette of the three."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    helm_dome(S, snapH, H, front_z=0.034, back_drop=0.5, out=0.024)
    # central ridge front -> back
    ridge = [H(0, -0.095, 0.05), H(0, -0.06, 0.1), H(0, 0.0, 0.122), H(0, 0.07, 0.1), H(0, 0.11, 0.05)]
    pts = [trace_in(S, H(0, 0, 0), norm(q - H(0, 0, 0)), r=0.4) for q in ridge]
    S.add(Chain(pts, [0.009 * s] * len(pts)), 0.006, mat="iron")
    # cheek guards hanging in front of the ears, beside the jowls
    for sx in (1, -1):
        g = Inter(BM.shell(snapH, 0.026, 0.008), RoundBox(H(sx * 0.085, -0.035, -0.045), H.r(0.04, 0.03, 0.06),
                                                         r=0.012 * s), HalfSpace(H(0, 0, 0.04), V(0, 0, 1)), k=0.004)
        S.add(Bounded(g, H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4), 0.004, mat="iron")
        for z in (0.0, -0.05):
            p = trace_in(S, H(0, -0.035, z), V(sx, 0, 0), r=0.3)
            S.add(Sphere(p, 0.007 * s), 0.001, mat="iron")
    # massive bull horns: out to the side, then hooking forward and up
    for sx in (1, -1):
        b0 = trace_in(S, H(0, -0.01, 0.05), norm(V(sx * 0.95, -0.05, 0.3)), r=0.35)
        # x0.86 keeps the tips < 0.75 m (engine) from the head joint (validate-glb far-joint contract)
        BM.horn(S, b0, [(sx * 0.05 * 0.86, 0.0, 0.004), (sx * 0.105 * 0.86, -0.02 * 0.86, 0.03 * 0.86),
                        (sx * 0.14 * 0.86, -0.06 * 0.86, 0.075 * 0.86), (sx * 0.14 * 0.86, -0.11 * 0.86, 0.12 * 0.86),
                        (sx * 0.12 * 0.86, -0.14 * 0.86, 0.155 * 0.86)], 0.029, s=s, mat="bone", collar="iron")
    return S


def helm_crest(snapH, H):
    """Silver brother: iron war-mask (forehead, brow, nose bridge, cheekbones; eye holes keep the eyes visible) under
    a riveted skullcap with a tall serrated iron crest fin and a trailing fur crest -- the tallest head silhouette."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    helm_dome(S, snapH, H, front_z=0.058, back_drop=0.3, out=0.02, seed=97)
    # C2 r1 (board C1 r4: "silver ogre's war-mask hides most of his face"): NO mask -- an open riveted skullcap with
    # a short nasal bar between the brows, so the eyes, nose, tusks and jaw read; the crest + plume carry the tier
    nasal = [H(0, -0.096, 0.052), H(0, -0.104, 0.028), H(0, -0.106, 0.008)]
    pts = [trace_in(S, V(q[0], H(0, 0, 0)[1], q[2]), V(0, -1, 0), r=0.4) for q in nasal]
    S.add(Chain([p_ + V(0, -0.004, 0) for p_ in pts], [0.008 * s, 0.0075 * s, 0.006 * s]), 0.004, mat="iron")
    for sx in (1, -1):
        p = trace_in(S, H(0, 0.0, 0.05), norm(V(sx, -0.55, 0.0)), r=0.4)
        S.add(Sphere(p, 0.006 * s), 0.001, mat="iron")
    # crest fin: thin iron blade over the crown, serrated top
    fin = Inter(Slab(H(0, 0, 0), V(1, 0, 0), 0.0075 * s), Ellipsoid(H(0, 0.03, 0.035), H.r(0.3, 0.155, 0.15)),
                k=0.003)
    fin = Diff(fin, Offset(snapH, 0.006), k=0.004)
    S.add(Bounded(fin, H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4), 0.003, mat="iron")
    for i in range(7):
        ang = math.radians(-60 + i * 20)
        d = norm(V(0, math.sin(ang), math.cos(ang)))
        p = H(0, 0.03, 0.035) + V(0, d[1] * 0.155 * s, d[2] * 0.15 * s)
        S.add(RoundCone(p - d * 0.01, p + d * (0.05 - 0.004 * abs(i - 3)) * s, 0.009 * s, 0.002), 0.004, mat="iron")
    # trailing fur crest down the nape (horse-tail plume)
    tail = [H(0, 0.1, 0.13), H(0, 0.16, 0.1), H(0, 0.2, 0.04), H(0, 0.22, -0.04), H(0, 0.21, -0.11)]
    S.add(Chain(tail, [0.022 * s, 0.026 * s, 0.024 * s, 0.018 * s, 0.006 * s], squash=(0.6, 1.0), ref=(1, 0, 0)),
          0.01, mat="fur")
    return S


def topknot(snapH, H):
    """Green brother (bare-headed): a tall topknot of coarse BLACK hair (reads as hair, not a horn, in profile) rising from the crown and arcing back, held by
    two bone rings, plus bone rings through both ears."""
    S = Sculpt(materials=GEAR_MATS, default_mat="brow")
    s = H.s
    pts = [H(0, 0.035, 0.07), H(0, 0.065, 0.118), H(0, 0.115, 0.14), H(0, 0.165, 0.128), H(0, 0.2, 0.08),
           H(0, 0.215, 0.01), H(0, 0.2, -0.07)]
    rad = [0.034 * s, 0.026 * s, 0.034 * s, 0.038 * s, 0.034 * s, 0.025 * s, 0.008 * s]
    S.add(Displace(Chain(pts, rad, squash=(0.75, 1.0), ref=(1, 0, 0)), 0.004, 30.0, 2, seed=101), 0.0, mat="brow")
    for sx, sd in ((1, 103), (-1, 105)):          # two looser side hanks: bushy plume, not a stick
        q = [p + V(sx * 0.012 * s, 0.006 * s, -0.004 * s) for p in pts[2:]]
        q[-1] = q[-1] + V(sx * 0.02 * s, 0.01 * s, 0.02 * s)
        S.add(Displace(Chain(q, [r * 0.62 for r in rad[2:]], squash=(0.7, 1.0), ref=(1, 0, 0)), 0.003, 36.0, 2,
                       seed=sd), 0.01, mat="brow")
    for j, rr in ((1, 0.028),):
        q = pts[j]
        tn = norm(pts[j + 1] - pts[j - 1])
        S.add(Torus(q, rr * s, 0.0065 * s, basis(tn)[:, [1, 2, 0]]), 0.003, mat="bone")
    # cropped scalp patch under the knot (blends into the stubble)
    S.add(Bounded(Inter(BM.shell(snapH, 0.006, 0.0), Sphere(H(0, 0.03, 0.09), 0.05 * s), k=0.003),
                  H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4), 0.004, mat="brow")
    for sx in (1, -1):
        e = H(sx * 0.093, 0.014, -0.06)
        S.add(Torus(e, 0.013 * s, 0.0035 * s, basis(V(0, 1, 0))[:, [1, 2, 0]]), 0.002, mat="bone")
    return S


def necklace(S_body, L, H):
    """Green brother's trophy necklace: a rope over the fur collar hung with big fangs and a small skull pendant."""
    S = Sculpt(materials=GEAR_MATS, default_mat="bone")
    nk = L["neck"]
    c = V(0, float(nk[1]) - 0.02, 1.6)
    pts = []
    for i in range(15):
        a = -1.25 + i * (2.5 / 14)
        d = norm(V(math.sin(a), -math.cos(a), -0.55 - 0.25 * (1 - abs(a) / 1.25)))
        pts.append(trace_in(S_body, c, d, r=0.6) + d * 0.008)
    S.add(Chain(pts, [0.008] * len(pts)), 0.004, mat="leather")
    rng = np.random.RandomState(111)
    for i in range(1, 14, 2):
        if i == 7:
            continue
        p = pts[i]
        out = norm(V(p[0], p[1] - float(c[1]), 0))
        ln = 0.075 + 0.025 * rng.rand() - 0.012 * abs(i - 7) / 7
        tip = p + V(0, 0, -ln) + out * 0.022
        S.add(Chain([p + V(0, 0, -0.004), (p + tip) / 2 + out * 0.012, tip], [0.017, 0.012, 0.003]), 0.004, mat="bone")
    # skull pendant (front centre)
    p = pts[7] + V(0, -0.01, -0.05)
    sk = Union(Ellipsoid(p + V(0, 0.0, 0.012), V(0.042, 0.036, 0.04)),
               RoundBox(p + V(0, -0.012, -0.03), V(0.026, 0.02, 0.016), r=0.01), k=0.012)
    S.add(sk, 0.0, mat="bone")
    for sx in (1, -1):
        S.sub(Sphere(p + V(sx * 0.016, -0.036, 0.004), 0.012), 0.004, mat="bone")
    S.sub(Ellipsoid(p + V(0, -0.04, -0.014), V(0.006, 0.01, 0.008)), 0.003, mat="bone")
    for x in (-0.012, 0.0, 0.012):
        S.sub(Slab(p + V(x, 0, -0.035), V(1, 0, 0), 0.0016), 0.001, mat="bone")
    S.add(Capsule(pts[7], p + V(0, 0, 0.05), 0.006), 0.003, mat="leather")
    return S


def gear_bounds(name, L):
    if name.startswith(("helm", "topknot")):
        return V(-0.5, -0.62, 1.62), V(0.5, 0.45, 2.62)
    if name == "necklace":
        return V(-0.5, -0.65, 1.2), V(0.5, 0.35, 1.85)
    sh = L["shoulder_" + name[-1]]
    return sh - 0.47, sh + 0.47


def gear_bone(name):
    k = name.split("_")[0]
    b = GEAR_BONE[k]
    return b + name[-1] if b.endswith("_") else b


def build_gear(S_body, L, H, names, h=0.004):
    t = time.time()
    snapA = charkit.GridSDF(S_body, h=h, lo=V(-0.95, -0.55, 1.2), hi=V(0.95, 0.5, 2.25))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    out = {}
    for nm in sorted(set(names)):
        k = nm.split("_")[0]
        if nm == "helm_horned":
            Sg = helm_horned(snapA, H)
        elif nm == "helm_crest":
            Sg = helm_crest(snapA, H)
        elif nm == "topknot":
            Sg = topknot(snapA, H)
        elif nm == "necklace":
            Sg = necklace(S_body, L, H)
        else:
            Sg = pauldron(snapA, L, nm[-1], heavy=(k == "plate"))
        out[nm] = (Sg, gear_bone(nm))
    return out


GEAR_TRIS = {"helm": 1500, "pauldron": 900, "plate": 1200, "topknot": 520, "necklace": 820}
SYM_GEAR = ("helm", "topknot", "necklace")


# ============================================================================ palette + painters
# Value ladder (albedo luma, sRGB; stage-1 preset lifts dark dielectrics, so the tiers separate by HUE first):
#   war paint A bone-white ~80% (green) / soot B ~8% (red) / woad B ~25% (silver)  >  hide skin: moss green ~44%,
#   clay red ~40%, ash grey ~50%  >  tan hide wrap / skirt ~30%  >  fur ~28% (tips 60%)  >  dark breeches / straps
#   ~13%. Iron = mid-tone rust-crusted (value holds ~42% in any env), bone tusks/horns ~80%.
PAL = dict(
    skin=shaders.srgb(104, 128, 60), skin_warm=shaders.srgb(128, 116, 52), skin_cool=shaders.srgb(62, 84, 58),
    lips=shaders.srgb(72, 70, 44), skin_rough=0.6, mottle=shaders.srgb(70, 96, 44), mottle_hi=shaders.srgb(140, 150, 86),
    iris=shaders.srgb(255, 200, 40), sclera=shaders.srgb(176, 156, 104), nail=shaders.srgb(222, 208, 172),
    tattoo=shaders.srgb(22, 10, 10),
    brow=shaders.srgb(26, 22, 18), brow_hi=shaders.srgb(70, 62, 52), brow_hi_amt=0.12, brow_rough=0.8,
    war_a=shaders.srgb(226, 218, 196), war_a_amt=0.9, war_b=shaders.srgb(20, 18, 16), war_b_amt=0.0,
    hide=shaders.srgb(88, 60, 36), hide_worn=shaders.srgb(134, 100, 66),
    hide_dark=shaders.srgb(48, 32, 22), hide_dark_worn=shaders.srgb(96, 70, 48),
    leather=shaders.srgb(66, 44, 28), leather_worn=shaders.srgb(120, 88, 60),
    leather_dark=shaders.srgb(40, 28, 20), leather_dark_worn=shaders.srgb(84, 62, 44),
    fur=shaders.srgb(96, 78, 56), fur_root=shaders.srgb(36, 28, 20), fur_tip=shaders.srgb(176, 156, 120),
    iron=shaders.srgb(112, 110, 108), iron_patina=shaders.srgb(118, 70, 40), iron_patina_amt=0.62,
    bronze=shaders.srgb(112, 110, 108), bronze_patina=shaders.srgb(118, 70, 40), bronze_patina_amt=0.6,
    bone=shaders.srgb(226, 212, 176), bone_dark=shaders.srgb(110, 88, 58),
    horn=shaders.srgb(62, 50, 40), horn_tip=shaders.srgb(212, 196, 160),
    rope=shaders.srgb(150, 126, 84), cloth=shaders.srgb(150, 126, 84),
)
# C1 r3 value ladder: the three brothers must separate in 50 % GREYSCALE, not only by hue.
#   red    = DARK : oxblood skin ~29 % luma, blackened iron helm, near-black hide, pale horns
#   green  = MID  : moss skin ~44 %, tan hide, bone-white stripes + bone trophies
#   silver = MID-LIGHT by PAINT: warm stone-grey skin ~38 % (C2 r1, was a 50 % ash that blew out chalk-white under
#            stage-1 fire), bright silver-white war stripes (the ref's silver-painted brother), open crested helm
TIER_PAL = {
    "green": {},
    "red": dict(skin=shaders.srgb(142, 50, 36), skin_warm=shaders.srgb(160, 50, 34), skin_cool=shaders.srgb(80, 40, 42),
                lips=shaders.srgb(70, 26, 24), mottle=shaders.srgb(104, 36, 26), mottle_hi=shaders.srgb(176, 82, 58),
                war_a_amt=0.0, war_b=shaders.srgb(16, 14, 14), war_b_amt=0.92,
                fur=shaders.srgb(48, 40, 36), fur_root=shaders.srgb(18, 15, 14), fur_tip=shaders.srgb(104, 94, 84),
                hide=shaders.srgb(50, 32, 26), hide_worn=shaders.srgb(92, 64, 48),
                hide_dark=shaders.srgb(28, 20, 16), hide_dark_worn=shaders.srgb(64, 46, 36),
                leather=shaders.srgb(44, 30, 22), leather_worn=shaders.srgb(86, 62, 44),
                iron=shaders.srgb(66, 62, 60), iron_patina=shaders.srgb(84, 44, 28), iron_patina_amt=0.4,
                iris=shaders.srgb(255, 150, 30)),
    # C1 r4 (board r3: silver albedo near-white blows out under fog): mid-grey ~50 % skin, the tier keeps its
    # read from the crested mask + plate pauldrons + near-black woad
    "silver": dict(skin=shaders.srgb(104, 94, 86), skin_warm=shaders.srgb(136, 94, 76),
                   skin_cool=shaders.srgb(74, 74, 78), lips=shaders.srgb(66, 50, 50),
                   mottle=shaders.srgb(78, 72, 68), mottle_hi=shaders.srgb(128, 122, 112),
                   war_a=shaders.srgb(206, 210, 214), war_a_amt=0.95, war_b_amt=0.0,
                   fur=shaders.srgb(112, 104, 94), fur_root=shaders.srgb(44, 40, 36), fur_tip=shaders.srgb(176, 168, 152),
                   hide=shaders.srgb(104, 86, 66), hide_worn=shaders.srgb(146, 126, 100),
                   hide_dark=shaders.srgb(52, 42, 34), hide_dark_worn=shaders.srgb(96, 82, 68),
                   iron=shaders.srgb(132, 132, 130), iron_patina=shaders.srgb(100, 66, 42), iron_patina_amt=0.42,
                   iris=shaders.srgb(255, 190, 60), sclera=shaders.srgb(170, 156, 120)),
}


def p_ogre_skin(c, pal):
    """Thick giant hide: broad mottled blotches (dark + pale), warty speckle, grime rising from the feet + on the
    hands, war paint (layout A or B in the tier colour)."""
    rgb, rough, metal, emit = shaders.p_skin(c, pal)
    n1 = c.noise(4.0, 3, 501)
    n2 = c.noise(22.0, 2, 502)
    n3 = c.noise(160.0, 1, 503)
    rgb = shaders.mix(rgb, pal["mottle"], 0.4 * shaders.smooth01(n1, 0.1, 0.7))
    rgb = shaders.mix(rgb, pal["mottle_hi"], 0.12 * shaders.smooth01(-n1, 0.25, 0.8) * (0.6 + 0.4 * c.ridge))
    rgb = shaders.mix(rgb, rgb * 0.72, 0.3 * shaders.smooth01(n2, 0.45, 0.8))                    # blotch spots
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.12 + 0.01, 1), 0.2 * shaders.smooth01(n3, 0.55, 0.85))  # wart speckle
    # C1 r3 anti-chalk: deep warm cavities (muscle seams, armpits, under the brow), painted form shadow on
    # down-facing planes (belly underside, under the jaw/pecs), warm subsurface tint on ridges / thin skin
    cav = c.cav
    rgb = shaders.mix(rgb, rgb * np.array([0.62, 0.4, 0.34]), 0.55 * cav)
    down = shaders.smooth01(-c.N[:, 2], 0.25, 0.9)
    rgb = shaders.mix(rgb, rgb * np.array([0.7, 0.58, 0.55]), 0.35 * down)
    up = shaders.smooth01(c.N[:, 2], 0.3, 0.95)
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.12, 1), 0.25 * up)
    rgb = shaders.mix(rgb, rgb * np.array([1.12, 0.9, 0.8]), 0.3 * c.ridge)
    z = c.P[:, 2]
    rgb = shaders.mix(rgb, shaders.srgb(40, 32, 24), 0.4 * shaders.smooth01(-z, -0.7, -0.2))
    for key, ch in (("war_a", "warA"), ("war_b", "warB")):
        amt = pal.get(key + "_amt", 0.0)
        w = c.paint(ch)
        if amt > 0 and w.any():
            worn = shaders.smooth01(c.noise(45.0, 2, 504), -0.4, 0.4)            # dry-brush breakup
            m = np.clip(w * (0.65 + 0.35 * worn), 0, 1) * amt
            rgb = shaders.mix(rgb, pal[key], m)
            rough = rough + 0.1 * m
    rough = rough - 0.08 * c.ridge
    return rgb, np.clip(rough, 0.3, 0.92), metal, emit


PAINTERS = {"skin": p_ogre_skin,
            "hide": lambda c, pal: shaders.p_leather(c, pal, "hide"),
            "hide_dark": lambda c, pal: shaders.p_leather(c, pal, "hide_dark"),
            "iron": BS.p_iron, "bronze": BS.p_iron, "bone": BM.p_bone,
            "rope": lambda c, pal: shaders.p_cloth(c, dict(pal, cloth=pal["rope"]))}


def tier_pal(tier):
    p = dict(PAL)
    p.update(TIER_PAL[tier])
    return p


# ============================================================================ previews
MAT_COLORS = {"skin": (0.3, 0.42, 0.18), "eye": (0.8, 0.7, 0.2), "nail": (0.5, 0.45, 0.4), "brow": (0.05, 0.04, 0.03),
              "hide": (0.36, 0.24, 0.13), "hide_dark": (0.12, 0.08, 0.05), "fur": (0.26, 0.2, 0.14),
              "leather": (0.18, 0.12, 0.08), "leather_dark": (0.08, 0.06, 0.045), "iron": (0.38, 0.37, 0.36),
              "bronze": (0.38, 0.37, 0.36), "bone": (0.85, 0.8, 0.68), "rope": (0.5, 0.42, 0.28)}


def preview_main(args):
    meshutil.clear_scene()
    L = ogre_landmarks()
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    BM.HORNS.clear()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    tiers = ("green", "red", "silver")
    G = build_gear(S, L, H, [g for t in tiers for g in TIERS[t]])
    base = [charkit.mesh_sculpt(S, "body", args.h or 0.005, colors=MAT_COLORS),
            charkit.mesh_sculpt(war_skirt(info["kilt"]), "kilt", 0.004, colors=MAT_COLORS)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.0025, w - 0.28, w + 0.28, colors=MAT_COLORS))
    for i, tier in enumerate(tiers):
        dx = V(i * 1.9, 0, 0)
        for g in TIERS[tier]:
            o = charkit.mesh_sculpt(G[g][0], g + f"_{i}", 0.004, *gear_bounds(g, L), colors=MAT_COLORS)
            o.location = dx
        if i:
            for b in base:
                o = meshutil.duplicate(b, b.name + f"_{i}")
                o.location = dx
    views = [dict(target=(1.9, 0, 1.0), ortho=5.2, yaw=y, dist=12, pitch=4) for y in (0, 35)]
    preview.render_views(os.path.join(out, "ogre_full.png"), views, res=(1100, 760))
    hz = float(H(0, 0, 0)[2])
    hv = [dict(target=(i * 1.9, -0.1, hz - 0.08), ortho=0.85, yaw=y, dist=12, pitch=p)
          for i in range(3) for (y, p) in ((25, 4), (25, 22))]
    hv.append(dict(target=(0, -0.2, hz - 0.03), ortho=0.36, yaw=12, dist=12, pitch=14))
    preview.render_views(os.path.join(out, "ogre_heads.png"), hv, res=(520, 600))
    print(f"[ogre] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.04) / 0.05, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.04)) / 0.12, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.35)


def ease_far_weights(ob, arm, r0=0.64 / K, r1=0.70 / K, margin=0.12):
    """GLB contract (validate-glb 'no far-away joints'): no vertex may be bound MAINLY to a joint > 0.75 m away
    (engine scale). The giant thigh is ~0.82 m long, so the inner-knee skin just below the knee and the kilt panel
    corners at the hem stayed thigh-dominant 0.75-0.79 m from the hip joint. Hand that dominance to the vertex's own
    next-strongest influence (shin / kilt_*_2, both close) with a smooth distance ramp r0 -> r1 (reference scale), so
    neighbours keep a continuous blend (no weight step -> no stretch). Returns how many verts changed."""
    names = [vg.name for vg in ob.vertex_groups]
    if not names:
        return 0
    W = skin.read_groups(ob, names)
    P = meshutil.get_verts(ob, world=True)
    Mw = arm.matrix_world
    head = {b.name: np.array(Mw @ b.head_local) for b in arm.data.bones}
    changed = 0
    dom = np.argmax(W, axis=1)
    for i in np.nonzero(W.max(axis=1) > 0)[0]:
        b = dom[i]
        hb = head.get(names[b])
        if hb is None:
            continue
        d = float(np.linalg.norm(P[i] - hb))
        if d <= r0:
            continue
        cand = [j for j in np.argsort(-W[i]) if j != b and W[i, j] > 0.02 and names[j] in head
                and np.linalg.norm(P[i] - head[names[j]]) < r0]
        if not cand:
            continue
        j = cand[0]
        f = float(np.clip((d - r0) / (r1 - r0), 0, 1))
        f = f * f * (3 - 2 * f)
        s = f * max(0.0, (W[i, b] - W[i, j] + margin) / 2)
        s = min(s, W[i, b])
        W[i, b] -= s
        W[i, j] += s
        changed += 1
    if changed:
        skin.write_groups(ob, names, W)
    return changed


def rescale(arm, obs, k):
    """Scale mesh data + armature rest bones by k in place (applied, so the GLB carries no node scale)."""
    for o in obs:
        o.data.transform(Matrix.Scale(k, 4))
        o.data.update()
    pipeline._object()
    meshutil.select_only([arm], arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    # read every head/tail FIRST: connected children share the parent tail, so scaling in place compounds
    ht = [(eb, eb.head.copy() * k, eb.tail.copy() * k) for eb in arm.data.edit_bones]
    for eb, hd, tl in ht:
        eb.head = hd
        eb.tail = tl
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


class ScopedBaker(pipeline.Baker):
    """Baker that only puts the meshes a bake call needs into the Cycles scene. EVERY bake call re-syncs the whole
    scene (millions of hi-res triangles = minutes per call, measured 2-5x on a synthetic 6.5 M tri probe), so:
      albedo / prm / normal (selected-to-active, no occlusion) -> only the job's own HI meshes are rendered
                                                              (hide_render on all others);
      ao                                                         -> every HI mesh of the tier stays in the scene
                                                              (neighbours occlude), other tiers' gear is dropped.
    """
    EVERY_HI = []

    def run(self, passes=(("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 48), ("normal", "NORMAL", 8))):
        for lo in self.all_lo:
            pipeline.set_ray_visibility(lo, False)
        for h in self.all_hi:
            pipeline.set_ray_visibility(h, True)
        tier_hi = {h.name for h in self.all_hi}
        for name, kind, spp in passes:
            im = pipeline.new_image("bake_" + name, self.res)
            im.colorspace_settings.name = "Non-Color"
            self.set_pass(self.all_hi, name)
            for (lo, his, ext, mr) in self.jobs:
                keep = tier_hi if name == "ao" else {h.name for h in his}
                for h in ScopedBaker.EVERY_HI:
                    h.hide_render = h.name not in keep
                pipeline.bake_pass(lo, his, im, kind, extrusion=ext, max_ray=mr, samples=spp)
            for h in ScopedBaker.EVERY_HI:
                h.hide_render = False
            self.maps[name] = pipeline.image_np(im)
            bpy.data.images.remove(im)
        for lo in self.all_lo:
            pipeline.set_ray_visibility(lo, True)
        return self.maps


def build(args):
    global OUT_MODELS, OUT_TEX
    T0 = time.time()
    if args.outdir:                       # staging build: models + textures + report go to <outdir> (promote by hand)
        od = os.path.abspath(args.outdir)
        OUT_MODELS = os.path.join(od, "models")
        OUT_TEX = os.path.join(od, "textures")
        os.makedirs(OUT_MODELS, exist_ok=True)
        os.makedirs(OUT_TEX, exist_ok=True)
    report_path = os.path.join(os.path.abspath(args.outdir), "ogre_report.json") if args.outdir         else os.path.join(HERE, "out", "ogre_report.json")
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_hand, h_kilt, h_gear = ((0.0045, 0.0016, 0.0035, 0.0024) if fast else (0.0024, 0.001, 0.0018, 0.0013))
    meshutil.clear_scene()
    BM.HORNS.clear()
    device = pipeline.setup_cycles(args.device)
    L = ogre_landmarks()
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["red"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "scale": K, "parts": {}, "tiers": {}}

    t = time.time()
    S, info = body_sculpt(L)
    hi_ = info["head"]
    H = hi_["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = war_skirt(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    G = build_gear(S, L, H, [g for t_ in tiers for g in TIERS[t_]])
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN)

    t = time.time()
    his = {}
    hb0, hb1 = HEAD_BOX
    if args.stage != "skin":
        his["body"] = [pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX),
                       pipeline.sculpt_mesh(S, "head_hi", h_body * 0.55, hb0, hb1, keep_box=HEAD_BOX)]
        for o in his["body"]:
            charkit.drop_islands(o, h_body)
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.28, w + 0.28)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        for nm, (Sg, _) in G.items():
            o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *gear_bounds(nm, L))
            charkit.drop_islands(o, h_gear, min_verts=40)
            his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.004 if not fast else 0.005

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0022, args.hand_tris, w - 0.28, w + 0.28,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.0035, args.kilt_tris)
    for nm, (Sg, _) in G.items():
        sym = nm.startswith(SYM_GEAR)
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.003, GEAR_TRIS[nm.split("_")[0]], *gear_bounds(nm, L),
                                   symmetry=sym, clean=lambda o: charkit.drop_islands(o, 0.003, min_verts=30))
    for o in los.values():
        charkit.drop_islands(o, 0.004, min_verts=24)
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
    report["far_eased"] = {k: ease_far_weights(los[k], arm) for k in ("body", "kilt")}
    pipeline.log(f"far-joint weights eased: {report['far_eased']}")
    for nm, (_, bone) in G.items():
        charkit.rigid_bind(los[nm], arm, bone)
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt"]
    if args.stage == "skin":
        obs = [los[k] for k in common + TIERS["red"]]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm, min_len=0.25 / K)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.log(f"tris red {meshutil.tri_count(body)}")
        rescale(arm, [body], K)
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "ogre_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=2.0, head_density=1.2)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.85)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.0)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    extra_p = dict(eyes=[tuple(e) for e in hi_["eyes"]], eye_r=hi_["eye_r"], eye_fwd=hi_["eye_fwd"], iris_deg=42.0, pupil_deg=9.0,
                   z_knee=float(OGRE["knee_z"]), z_chest=float(OGRE["chest_z"]))
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.014, 0.035), "hand_L": (0.007, 0.016), "hand_R": (0.007, 0.016), "kilt": (0.006, 0.014)}
    for tier in tiers:
        tt = time.time()
        pal = tier_pal(tier)
        parts = common + TIERS[tier]
        report["uv_fill_" + tier] = pipeline.pack_atlas_shape([los[k] for k in parts], margin_px=6 if not fast else 4,
                                                             res=res)
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, dict(extra_p, part=k), painters=PAINTERS)
        for o in all_hi + list(los.values()):
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.007, 0.018)) for k in parts]
        BakerCls = pipeline.Baker if args.no_scope else ScopedBaker
        ScopedBaker.EVERY_HI = all_hi
        B = BakerCls(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        tb = time.time()
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        pipeline.log(f"[{tier}] bake {time.time()-tb:.0f}s")
        prefix = f"{ASSET}_{tier}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix, tint=(0.46, 0.36, 0.28))
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
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
        rep = {"tris": meshutil.tri_count(body)}
        qa = skin.stretch_report(body, arm, min_len=0.25 / K)
        rep["stretch_qa"] = {k: dict(bad=q["bad"], soft=q["soft"], pairs=q["pairs"]) for k, q in qa.items()}
        pipeline.log(f"[{tier}] stretch QA: " + ", ".join(f"{k}: bad {q['bad']} soft {q['soft']}" for k, q in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        rescale(arm, [body], K)
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        rescale(arm, [], 1.0 / K)
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "green":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(report_path, report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(report_path, report)
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
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--no-scope", action="store_true")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=9400)
    ap.add_argument("--head-tris", type=int, default=1500)
    ap.add_argument("--hand-tris", type=int, default=720)
    ap.add_argument("--kilt-tris", type=int, default=1100)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
