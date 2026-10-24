"""Build Gorrim Knotbeard (hero, 'Keeper of the Copper Ax') with the blender/lib pipeline.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_hero_gorrim.py -- [options]
Options:
  --preview body|full|face|beard   clay renders to progress/shots/hero-gorrim/dev/ (no export)
  --fast                           lower hi-poly resolution + 1024 bake (pipeline smoke test)
  --stage skin                     LO meshes + weights + stretch QA only (writes progress/tmp/gorrim_skin_test.glb)
  --no-weapon                      skip the Copper Ax (blender/build_weapon_copper_ax.py)
Default: full pipeline -> public/assets/models/hero_gorrim.glb, textures public/assets/textures/gorrim_*.png,
report blender/out/gorrim_report.json.

Design (docs/DESIGN.md 2): a 1.38 m dwarf as wide as he is tall -- barrel chest and belly, huge capped shoulders,
massive bare forearms in riveted bracers, huge fists; short thick legs in heavy iron-capped boots. A horned iron
spangenhelm (copper brow band, riveted ribs, crest, dents, ivory horns in copper sockets). A chainmail hauberk
(short sleeves, split mail skirt on the kilt spring chains) over a quilted verdigris gambeson (sleeves to the
elbow), a dark bear-fur mantle over the shoulders and back, a broad leather belt with a big copper knotwork buckle.
Face: heavy brow, bushy copper brows, a big bulbous ruddy nose, round cheeks. A huge copper-red beard swept into
three braids (centre braid to the belt on the beard_1..3 spring chain) bound with brass knot rings, a drooping
moustache.
"""
import os
import sys
import time
import math
import json
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np
import bpy

from lib import sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin
for _m in (sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin):
    importlib.reload(_m)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX, Func)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "hero-gorrim", "dev")
ASSET = "hero_gorrim"

# Proportions (Blender, metres). Matches src/characters/heroes/gorrim.js (hip 0.62, chest 0.88, neck 1.09,
# head 1.13, shoulder 1.03, upper arm 0.26, forearm 0.23): the animator's clips were authored on that rig.
GORRIM = dict(
    height=1.345, head_h=0.235,
    shoulder_x=0.262, shoulder_z=1.05, clav_in_x=0.03,
    hip_x=0.104, hip_joint_z=0.615, pelvis_z=0.655,
    knee_z=0.345, ankle_z=0.078, foot_len=0.25, stance_x=0.128,
    spine_z=0.745, chest_z=0.885, neck_z=1.075, head_base_z=1.135,
    upperarm=0.262, forearm=0.235, hand=0.18,
    arm_down=40.0, arm_fwd=7.0, elbow_bend=12.0,
)
STYLE = dict(muscle=1.38, defin=0.55, fat=0.35, chest=1.32, lats=1.12, traps=1.3, waist=1.28, delts=1.3, arm=1.28,
             forearm=1.62, neck=1.35,
             # r4: brow 1.45->1.3, nose_bump 1.5->1.15 (brow bar + bridge bump fused into one lump at 3/4),
             # eye 1.02->1.12 / squint 1.25->1.08 (beady, near eye vanished at 3/4)
             brow=1.3, jaw=1.2, scowl=1.1, cheek=1.18, chin=1.1, nose_bump=1.15, squint=1.08, nose_len=1.12,
             nose_w=1.55, lip=1.1, mouth_w=1.08, eye=1.12, skull_w=1.06, skull_h=1.0, ear=1.05, fem=0.0)
MATERIALS = ["skin", "eye", "nail", "brow", "hair", "leather", "leather_dark", "bronze", "iron", "mail", "copper",
             "brass", "quilt", "fur", "horn", "cloth", "sole"]
BEARD_MATS = ["mane", "brass"]
KINDS = {"mail": "mail", "copper": "bronze", "brass": "bronze", "quilt": "cloth", "horn": "nail"}
WRIST_CUT_T = 0.90
HAND_CUT_T = 0.84
GRIP_R = 0.0215                      # Copper Ax haft radius over the leather wrap
HEAD_BOX = (V(-0.15, -0.16, 1.085), V(0.15, 0.155, 1.40))
FACE_DENSITY = 3.0
KILT_CHAIN = 3
KILT_P = dict(top_z=0.715, hem_z=0.385, r_top=0.25, r_hem=0.30, squash=0.70, cy=-0.02)
LEG_GAP_TOP = 0.53
BELT_Z = 0.705
BEARD_CHAIN = 3


# ============================================================================ helpers
def forearm_frame(L, side):
    el, wr = L["elbow_" + side], L["wrist_" + side]
    b = norm(wr - el)
    return el, wr, b, float(np.linalg.norm(wr - el))


def ray_hit(S, c, d, r_max=0.4):
    """First exit of the ray c + t d from an interior point c (surface point)."""
    d = norm(V(d))
    t = hair.scalp_radius(S, V(c), d[None], r_max=r_max)[0]
    return V(c) + d * t


def surface_ring(S, c, z, r, n=64):
    """ring_fn(a) sampling points projected onto sculpt S around a vertical axis at height z (a=0 front)."""
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    raw = np.array([V(c[0] + math.sin(a) * r, c[1] - math.cos(a) * r, z) for a in ang])
    P = S.project(raw, offset=0.0)
    P[:, 2] = z
    P = S.project(P, offset=0.0)
    N = S.grad(P)
    N[:, 2] *= 0.3
    N = N / np.linalg.norm(N, axis=1, keepdims=True)

    def fn(a):
        f = (a % (2 * math.pi)) / (2 * math.pi) * n
        i0 = int(f) % n
        i1 = (i0 + 1) % n
        t = f - int(f)
        return P[i0] * (1 - t) + P[i1] * t, norm(N[i0] * (1 - t) + N[i1] * t)
    return fn


def neck_cutter(L, r0=0.07, s=0.35):
    """Neckline: inside an upward-widening funnel AND above a tilted plane (Seraphine r2: steep cut angles only)."""
    nk = L["neck"]
    cx, cy = 0.0, float(nk[1]) - 0.004
    z0 = float(nk[2]) - 0.05
    k = 1.0 / math.sqrt(1.0 + s * s)

    def fn(X, Y, Z):
        r = np.sqrt((X - cx) ** 2 + ((Y - cy) * 1.1) ** 2)
        return (r - r0 - (Z - z0) * s) * k
    funnel = Func(fn, V(-0.35, cy - 0.35, z0 - 0.2), V(0.35, cy + 0.35, z0 + 0.4))
    return Inter(funnel, HalfSpace(nk + V(0, 0.01, -0.05), -norm(V(0, 0.2, 1))))


def sleeve_cutter(L, side, t=0.52):
    """Everything on the arm beyond a plane perpendicular to the upper arm at t (cut meets the limb at 90 deg)."""
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    c = sh + (el - sh) * t
    return Inter(HalfSpace(c, -a), Sphere(el, 0.34)), c, a


# ============================================================================ body
def dwarf_leg(S, L, side):
    """Short, massively thick legs (the lib leg's muscle masses are sized for a 1.9 m human)."""
    sx = 1 if side == "L" else -1
    hp, kn, an = L["hip_" + side], L["knee_" + side], L["ankle_" + side]
    a = norm(kn - hp)
    fwd = V(0, -1, 0)
    f = norm(fwd - a * np.dot(fwd, a))
    lat = norm(np.cross(a, f))
    if lat[0] * sx < 0:
        lat = -lat
    Lt = float(np.linalg.norm(kn - hp))
    at = lambda t, ff=0.0, ll=0.0: hp + a * (t * Lt) + f * ff + lat * ll
    M = np.stack([a, f, lat], axis=1)
    S.add(RoundCone(at(-0.1, 0.0, 0.012), kn - a * 0.01, 0.104, 0.07), 0.05)
    S.add(Ellipsoid(at(0.42, -0.018, 0.034), (0.15, 0.078, 0.082), M), 0.04)       # quads / outer thigh
    S.add(Ellipsoid(at(0.35, 0.03, -0.03), (0.14, 0.07, 0.07), M), 0.04)           # hamstrings / adductors
    S.add(Sphere(kn + f * 0.022, 0.066), 0.03)                                     # knee
    b = norm(an - kn)
    fb = norm(fwd - b * np.dot(fwd, b))
    Ls = float(np.linalg.norm(an - kn))
    S.add(RoundCone(kn, an, 0.066, 0.048), 0.03)
    S.add(Ellipsoid(kn + b * (0.32 * Ls) - fb * 0.03, V(0.056, 0.05, 0.09)), 0.035)  # calf
    return dict(b=b, fb=fb, Ls=Ls, at=at)


def body_sculpt(L, gear_on=True, parts=("torso", "arms", "legs", "head")):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    T = anatomy.Frame(L)
    info = {"arms": {}, "legs": {}}
    if "torso" in parts:
        anatomy.torso(S, L, STYLE)
        # barrel chest + belly (dwarf mass), heavy upper back
        anatomy.E(S, T, (0, -0.012, 1.34), (0.17, 0.162, 0.2), k=0.07)
        anatomy.E(S, T, (0, -0.045, 1.17), (0.148, 0.15, 0.15), k=0.07)
        anatomy.E(S, T, (0, 0.07, 1.46), (0.15, 0.1, 0.13), k=0.06)
    if "arms" in parts:
        for s in ("L", "R"):
            info["arms"][s] = anatomy.arm(S, L, s, STYLE)
    if "legs" in parts:
        for s in ("L", "R"):
            info["legs"][s] = dwarf_leg(S, L, s)
            anatomy.foot(S, L, s)
    if "head" in parts:
        info["head"] = anatomy.head(S, L, STYLE)
        dwarf_face(S, L, info["head"])
    # (no torso_details: the torso is under mail -- the ab / pec grooves printed through the hauberk)
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    if not gear_on:
        return S, info
    snap = S.snapshot()
    if "legs" in parts:
        trousers(S, snap, L)
        for s in ("L", "R"):
            dwarf_boot(S, snap, L, s, info["legs"][s])
    if "arms" in parts:
        for s in ("L", "R"):
            el, wr, b, Lf = forearm_frame(L, s)
            c = el + b * Lf * WRIST_CUT_T
            S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
            gear.bracer(S, snap, L, s, info["arms"][s], t0=0.3, t1=0.975, thick=0.011)
            gambeson_sleeve(S, snap, L, s)
    if "torso" in parts:
        hauberk(S, snap, L, info.get("head", {}).get("H"))
        belt_and_buckle(S, snap, L)
    if "head" in parts:
        helm(S, L, info["head"])
    if "torso" in parts:
        fur_mantle(S, L)
    if "legs" in parts:
        anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.014)
    return S, info


def dwarf_face(S, L, hi):
    """Dwarf features on the lib head: bulbous drinker's nose, round cheek apples, ruddy paint."""
    H = hi["H"]
    s = H.s
    dzn = hi["nose_dz"]
    tip = H(0, -0.1070 - 0.004 * (STYLE["nose_len"] - 1), -0.070 + dzn)
    S.add(Sphere(tip + V(0, 0.001, 0.001), 0.0128 * s), 0.008)                     # bulb
    # r4: a distinct nose volume -- a narrow dorsum ridge proud of the cheek planes from the nasion to the bulb
    S.add(RoundCone(H(0, -0.0945, -0.030), tip + V(0, 0.006, 0.010) * s, 0.0046 * s, 0.0068 * s), 0.004)
    for sx in (1, -1):
        S.add(Sphere(H(sx * 0.0215, -0.093, -0.0755 + dzn), 0.0086 * s), 0.006)      # big alae (r4: 9.5->8.6 mm)
        # r4: alar crease + nasofacial groove: the alae / bridge side separate from the cheek apple
        S.sub(Capsule(H(sx * 0.0305, -0.0895, -0.0655 + dzn), H(sx * 0.0290, -0.0925, -0.0835 + dzn), 0.0016 * s),
              0.0028 * s)
        S.sub(Capsule(H(sx * 0.0170, -0.0870, -0.0300), H(sx * 0.0215, -0.0880, -0.0560), 0.0017 * s), 0.0045 * s)
        # r4: medial canthus pocket between the bridge and the eye (well in front of the eyeball)
        S.sub(Ellipsoid(H(sx * 0.0165, -0.0865, -0.0255), H.r(0.0045, 0.0050, 0.0070)), 0.004)
        # r4: supraorbital groove -- a soft crease under the brow bar above the upper lid (outer 2/3 of the eye)
        S.sub(Capsule(H(sx * 0.0230, -0.0830, -0.0115), H(sx * 0.0470, -0.0760, -0.0085), 0.0021 * s), 0.004 * s)
        S.add(Ellipsoid(H(sx * 0.051, -0.069, -0.063), H.r(0.0145, 0.0105, 0.0115)), 0.011)  # cheek apples (r4: lower)
    # r4: blush split -- the nose is the reddest mass, cheeks a half-strength flush low on the apple, ears warm
    S.paint(Sphere(tip, 0.02 * s), "blush", soft=0.016, value=1.0)
    S.paint(Union(Sphere(H(0.050, -0.074, -0.060), 0.019 * s), Sphere(H(-0.050, -0.074, -0.060), 0.019 * s)),
            "blush", soft=0.02, value=0.55)
    S.paint(Union(Sphere(H(0.08, 0.012, -0.032), 0.03 * s), Sphere(H(-0.08, 0.012, -0.032), 0.03 * s)),
            "blush", soft=0.02, value=0.8)
    # r4: cool shadow zones (painter p_skin_gorrim): eye sockets, under-brow, bridge sides, temples, under the nose
    cool = [Sphere(e, hi["eye_r"] * 1.75) for e in hi["eyes"]]
    for sx in (1, -1):
        cool += [Capsule(H(sx * 0.0165, -0.086, -0.022), H(sx * 0.021, -0.089, -0.058), 0.006 * s),
                 Ellipsoid(H(sx * 0.075, -0.040, 0.004), H.r(0.012, 0.02, 0.02))]
    cool.append(Ellipsoid(H(0, -0.094, -0.087 + dzn), H.r(0.018, 0.008, 0.005)))
    S.paint(Union(*cool, k=0.004), "cool", soft=0.01, value=1.0)
    dzm = hi["mouth_dz"]
    # r2: a full, pouting lower lip pushed forward so it reads under the moustache's centre V (no mouth pit)
    pout = Ellipsoid(H(0, -0.1065, -0.1125 + dzm), H.r(0.0165, 0.0085, 0.0058))
    S.add(pout, 0.005)
    # r3: the upper-lip sliver between nose and moustache is warm blush skin (was dark 'lips' -> near-black band)
    S.paint(Ellipsoid(H(0, -0.099, -0.0915 + dzm), H.r(0.05, 0.02, 0.012)), "blush", soft=0.008, value=1.0)
    S.paint(Union(Ellipsoid(H(0, -0.097, -0.1078 + dzm), H.r(0.021, 0.009, 0.0055)),
                  Offset(pout, 0.002), k=0.003), "lips", soft=0.003)


def trousers(S, snap, L):
    reg = Inter(Offset(snap, 0.004), HalfSpace(V(0, 0, 0.74), V(0, 0, 1)), HalfSpace(V(0, 0, 0.22), V(0, 0, -1)),
                k=0.004)
    S.add(Bounded(reg, V(-0.36, -0.3, 0.2), V(0.36, 0.3, 0.76)), 0.0, mat="cloth")


def dwarf_boot(S, snap, L, side, li, top=0.275, thick=0.013):
    """Heavy boots: stiff shaft hull, thick folded cuff, two straps with copper buckles, iron toe cap, thick sole."""
    an = L["ankle_" + side]
    ball, toe = L["ball_" + side], L["toe_" + side]
    sx = 1 if side == "L" else -1
    lo, hi = V(an[0] - 0.16, an[1] - 0.3, -0.05), V(an[0] + 0.16, an[1] + 0.16, top + 0.08)
    b = li["b"]
    hull = RoundCone(an + V(0, 0.006, 0.0), an - b * ((top + 0.02 - an[2]) / max(1e-6, -b[2])) + V(0, 0.01, 0),
                     0.064, 0.082, squash=(1.1, 0.95))
    foot_hull = RoundCone(an + V(0, 0.01, -0.035), ball + V(0, 0, 0.004), 0.058, 0.05, squash=(1.0, 1.3),
                          ref=(0, 0, 1))
    body = Union(Offset(snap, thick), hull, foot_hull, k=0.03)
    S.add(Bounded(Inter(body, HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004), lo, hi), 0.0, mat="leather")
    # thick folded cuff at the top
    S.add(Bounded(Inter(Offset(body, 0.008), Slab(V(0, 0, top - 0.026), V(0, 0, 1), 0.026), k=0.005), lo, hi),
          0.003, mat="leather_dark")
    for z, tilt in ((0.13, 0.15), (0.2, -0.05)):
        n = norm(V(0, tilt, 1))
        S.add(Bounded(Inter(Offset(body, 0.004), Slab(V(0, 0, z), n, 0.011), k=0.002), lo, hi), 0.0015,
              mat="leather_dark")
        bp = ray_hit(S, V(an[0], an[1], z), V(sx, -0.25, 0))
        nrm = S.grad(bp[None])[0]
        S.add(RoundBox(bp + nrm * 0.003, V(0.005, 0.016, 0.014), basis(nrm, V(0, 0, 1)), r=0.003), 0.001,
              mat="copper")
    # iron toe cap
    tc = Inter(Offset(body, 0.004), HalfSpace(ball + V(0, 0.03, 0), V(0, 1, 0)), HalfSpace(V(0, 0, 0.022),
               V(0, 0, -1)), HalfSpace(V(0, 0, 0.085), V(0, 0, 1)), k=0.004)
    S.add(Bounded(tc, lo, hi), 0.002, mat="iron")
    # thick sole + heel
    sole = Inter(Offset(body, 0.006), HalfSpace(V(0, 0, 0.032), V(0, 0, 1)), k=0.003)
    S.add(Bounded(sole, lo, hi), 0.002, mat="sole")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def gambeson_sleeve(S, snap, L, side):
    """Quilted gambeson sleeve from under the mail sleeve to a rolled cuff at the elbow."""
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    Lu = float(np.linalg.norm(el - sh))
    c0 = sh + a * (Lu * 0.3)
    c1 = el + a * 0.018
    mid = (c0 + c1) / 2
    half = float(np.linalg.norm(c1 - c0)) / 2
    lo, hi = el - 0.22, el + 0.22
    lo = np.minimum(lo, sh - 0.12)
    hi = np.maximum(hi, sh + 0.12)
    reg = Inter(Offset(snap, 0.0085), Slab(mid, a, half), Sphere(mid, 0.22), k=0.004)
    S.add(Bounded(reg, lo, hi), 0.001, mat="quilt")
    S.add(Bounded(Inter(Offset(snap, 0.0125), Slab(c1 - a * 0.008, a, 0.009), Sphere(el, 0.14), k=0.003), lo, hi),
          0.003, mat="quilt")


def hauberk(S, snap, L, H=None):
    """Chainmail shirt: torso shell with short sleeves, cut steeply at the neckline and mid upper arm, a copper
    ring hem at each sleeve and round the neck; the skirt is a separate mesh (mail_skirt) on the kilt chains."""
    t = 0.012
    lo, hi = V(-0.6, -0.4, BELT_Z - 0.06), V(0.6, 0.4, L["neck"][2] + 0.12)
    NC = neck_cutter(L)
    cuts = [NC]
    rims = []
    for s in ("L", "R"):
        C, c, a = sleeve_cutter(L, s)
        cuts.append(C)
        rims.append((c, a))
    C = Union(*cuts)
    below = HalfSpace(V(0, 0, L["neck"][2] + 0.1), V(0, 0, 1))
    top = HalfSpace(V(0, 0, BELT_Z - 0.03), V(0, 0, -1))
    reg = Diff(Inter(Offset(snap, t), below, top, k=0.004), C, k=0.004)
    if H is not None:   # r3: the dwarf chin sits on the chest -> the mail shell was wrapping the mouth / chin
        reg = Diff(reg, Ellipsoid(H(0, -0.055, -0.12), H.r(0.075, 0.075, 0.085)), k=0.006)
        # r3b: the shell still poked out round the upper lip at |x| > 3 cm (grey mail band between nose and
        # moustache, baked onto the moustache tuck core too) -> cut the whole mouth / upper-lip / cheek zone
        reg = Diff(reg, Ellipsoid(H(0, -0.08, -0.095), H.r(0.095, 0.07, 0.05)), k=0.006)
    S.add(Bounded(reg, lo, hi), 0.0, mat="mail")
    for c, a in rims:                      # copper ring hem on the kept side of the sleeve cut
        band = Inter(Offset(snap, t + 0.003), Slab(c - a * 0.007, a, 0.0065), Sphere(c, 0.16), k=0.0015)
        S.add(Bounded(band, c - 0.17, c + 0.17), 0.0015, mat="copper")
    band = Diff(Offset(NC, 0.008), NC)
    S.add(Bounded(Inter(Offset(snap, t + 0.004), band, below, k=0.0015), lo, hi), 0.0015, mat="leather_dark")


def belt_and_buckle(S, snap, L):
    """Broad leather belt over the mail, big copper knotwork buckle plate with a raised brass triquetra + boss."""
    z = BELT_Z
    gear.belt(S, snap, L, z=z, half=0.042, thick=0.03, buckle=False)
    fc = ray_hit(S, V(0, 0.0, z + 0.005), V(0, -1, 0))
    nrm = S.grad(fc[None])[0]
    M = np.stack([V(1, 0, 0), norm(np.cross(nrm, V(1, 0, 0))), nrm], axis=1)
    S.add(RoundBox(fc + nrm * 0.005, V(0.064, 0.054, 0.009), M, r=0.009), 0.003, mat="copper")
    S.add(Torus(fc + nrm * 0.014, 0.047, 0.0045, M), 0.002, mat="copper")
    e0, e1 = M[:, 0], M[:, 1]
    for i in range(3):
        a = i * 2 * math.pi / 3 + math.pi / 2
        cc = fc + nrm * 0.016 + (e0 * math.cos(a) + e1 * math.sin(a)) * 0.017
        S.add(Torus(cc, 0.0165, 0.0036, M), 0.0015, mat="brass")
    S.add(Sphere(fc + nrm * 0.014, 0.011), 0.003, mat="brass")
    for sx in (1, -1):                      # rivets in the plate corners
        for sy in (1, -1):
            S.add(Sphere(fc + nrm * 0.013 + e0 * sx * 0.05 + e1 * sy * 0.04, 0.0045), 0.001, mat="brass")


def helm(S, L, hi):
    """Horned iron spangenhelm: dome over the skull above a tilted rim plane (ears kept bare), copper brow band
    with rivets, four riveted ribs + a crest, two dents; ivory horns in copper socket rings."""
    H = hi["H"]
    s = H.s
    snap = S.snapshot()
    c1, c2 = H(0, -0.102, 0.03), H(0, 0.112, -0.035)
    nrm = norm(np.cross(V(1, 0, 0), c2 - c1))
    if nrm[2] < 0:
        nrm = -nrm
    ears = [Sphere(H(sx * 0.081, 0.013, -0.036), 0.036 * s) for sx in (1, -1)]
    dome = Union(Offset(snap, 0.0095), Ellipsoid(H(0, 0.008, 0.016), H.r(0.1, 0.121, 0.108)), k=0.022)
    keep = Sphere(H(0, 0.01, 0.0), 0.16 * s)
    lo, hi_ = H(-0.2, -0.2, -0.12), H(0.2, 0.2, 0.2)
    reg = Inter(dome, HalfSpace(c1, -nrm), keep, k=0.004)
    for e in ears:
        reg = Diff(reg, e, k=0.006)
    S.add(Bounded(Displace(reg, 0.0008, 40.0, 2, seed=23), lo, hi_), 0.003, mat="iron")
    # copper brow band (on the kept side of the rim)
    band = Inter(Offset(dome, 0.0045), Slab(c1 + nrm * 0.011, nrm, 0.011), keep, k=0.002)
    for e in ears:
        band = Diff(band, e, k=0.004)
    S.add(Bounded(band, lo, hi_), 0.0015, mat="copper")
    hc = H(0, 0.01, 0.02)
    ring = []
    for i in range(22):
        a = (i + 0.5) / 22 * 2 * math.pi
        d = V(math.sin(a), -math.cos(a), 0)
        # point on the band plane
        p = hc + d * 0.2
        p = p - nrm * float(np.dot(p - (c1 + nrm * 0.011), nrm))
        ring.append(p)
    cb = c1 + nrm * 0.011
    hcp = hc - nrm * float(np.dot(hc - cb, nrm))
    for i in range(22):
        a = (i + 0.5) / 22 * 2 * math.pi
        if abs(math.sin(a)) > 0.93:        # skip the ear / horn zone
            continue
        d = ring[i] - hcp
        d = norm(d - nrm * float(np.dot(d, nrm)))
        p = ray_hit(S, hcp, d, r_max=0.25)   # r2: first exit in the band plane = ON the band (no floaters)
        S.add(Sphere(p, 0.0042), 0.001, mat="brass")
    # ribs (spangen) + crest, riveted
    top = H(0, 0.008, 0.125)
    for az in (45, 135, 225, 315):
        a = math.radians(az)
        d = V(math.sin(a), -math.cos(a), 0)
        raw = [c1 + nrm * 0.024 + d * 0.0, top]
        base = hc + d * 0.2
        base = base - nrm * float(np.dot(base - (c1 + nrm * 0.024), nrm))
        pts = np.array([base + (top - base) * f for f in np.linspace(0, 1, 9)])
        P = S.project(pts, offset=0.0)
        S.add(Chain(list(P[:-1]), 0.0052, squash=(1.8, 1.0), ref=tuple(V(0, 0, 1))), 0.002, mat="iron")
        for p in P[1:6:2]:
            S.add(Sphere(p + (p - hc) / np.linalg.norm(p - hc) * 0.004, 0.0035), 0.001, mat="brass")
    crest = S.project(np.array([H(0, -0.11 + 0.21 * f, 0.03 + 0.1 * math.sin(math.pi * (0.2 + 0.7 * f)))
                                for f in np.linspace(0, 1, 16)]), offset=0.0)
    S.add(Chain(list(crest), 0.0058, squash=(0.6, 1.0), ref=(1, 0, 0)), 0.003, mat="iron")
    # battle dents
    for (x, y, z, r) in ((0.05, -0.06, 0.09, 0.016), (-0.07, 0.05, 0.07, 0.013)):
        p = S.project(np.array([H(x, y, z)]), offset=0.0)[0]
        n = norm(p - hc)
        S.sub(Sphere(p + n * r * 0.85, r), 0.005)
    # horns: ivory, curving out -> up -> forward, ringed, in copper sockets
    info = []
    for sx in (1, -1):
        b0 = S.project(np.array([H(sx * 0.1, 0.0, 0.045)]), offset=-0.004)[0]
        pts = [b0, b0 + V(sx * 0.045, -0.004, 0.012) * s, b0 + V(sx * 0.085, -0.014, 0.045) * s,
               b0 + V(sx * 0.108, -0.034, 0.092) * s, b0 + V(sx * 0.106, -0.058, 0.128) * s,
               b0 + V(sx * 0.094, -0.078, 0.148) * s]
        P, _ = anatomy.resample(np.array(pts), step=0.006)
        f = np.linspace(0, 1, len(P))
        R = (0.027 * (1 - f) ** 0.8 + 0.0038) * s
        S.add(Chain(list(P), list(R)), 0.004, mat="horn")
        for j in range(3, int(len(P) * 0.7), 3):          # growth rings
            tn = norm(P[min(j + 1, len(P) - 1)] - P[j - 1])
            S.sub(Torus(P[j], R[j] + 0.0006, 0.0013, basis(tn)[:, [1, 2, 0]]), 0.0012)
        tn = norm(P[2] - P[0])
        S.add(Torus(P[1], R[1] + 0.001, 0.0048, basis(tn)[:, [1, 2, 0]]), 0.002, mat="copper")
        S.add(Torus(P[3], R[3] + 0.0005, 0.0036, basis(norm(P[4] - P[2]))[:, [1, 2, 0]]), 0.0015, mat="copper")
        info.append((P[0], P[-1]))
    hi["horns"] = info


def fur_mantle(S, L, seed=41):
    """Dark bear-fur shoulder mantle (r2): a thick lumpy fur shell draped over the traps, shoulder tops and upper
    back (hem low at the back, high at the front, open in front for the beard), a ragged ring of tapered tufts
    along the hem, copper disc brooches at the two front corners."""
    rng = np.random.RandomState(seed)
    snap = S.snapshot()
    nk = L["neck"]
    nz = float(nk[2])
    n_up = norm(V(0, 0.45, 1))
    cpl = V(0, 0, nz - 0.115)
    cell = V(0, 0.02, nz - 0.07)
    front = Inter(HalfSpace(V(0, -0.035, 0), V(0, 1, 0)), Slab(V(0, 0, 0), V(1, 0, 0), 0.115))
    reg = Inter(Offset(snap, 0.024), Ellipsoid(cell, V(0.43, 0.27, 0.22)), HalfSpace(cpl, -n_up),
                HalfSpace(V(0, 0, nz + 0.13), V(0, 0, 1)), k=0.012)
    # r3: the old z-cap at neck+3.5 cm sliced the fur off the tops of the (high) traps/delts; keep the head clear
    # with a neck capsule instead so the mantle sits ON the shoulders and rolls up round the back of the neck
    neck_hole = Capsule(V(0, float(nk[1]) - 0.005, nz - 0.04), V(0, float(nk[1]) + 0.01, nz + 0.4), 0.084)
    reg = Diff(Diff(reg, front, k=0.014), neck_hole, k=0.01)
    down = V(0, 0, -1)
    tufts = []
    for row in range(2):
        n = 34 - 6 * row
        for i in range(n):
            a = math.radians(38 + (322 - 38) * (i + 0.5 * row + rng.uniform(-0.3, 0.3)) / n)
            d = V(math.sin(a), -math.cos(a), 0)
            ze = cpl[2] - 0.45 * (-math.cos(a) * 0.2) + 0.012 + 0.02 * row
            hit = ray_hit(S, V(0, 0.02, ze), d, r_max=0.5)
            nrm = S.grad(hit[None])[0]
            nrm = norm(V(nrm[0], nrm[1], nrm[2] * 0.4))
            p = hit + nrm * (0.02 + 0.006 * row)
            Lc = rng.uniform(0.05, 0.08) * (1.0 - 0.3 * row)
            w = rng.uniform(0.028, 0.04)
            tang = norm(np.cross(V(0, 0, 1), nrm))
            v = norm(down * 0.8 + nrm * 0.35 + tang * rng.uniform(-0.25, 0.25))
            pts, rad = [p - nrm * 0.008], [w * 0.8]
            q = pts[0].copy()
            for ts in (0.95, 0.72, 0.45, 0.18):
                v = norm(v + down * 0.12 + nrm * 0.04)
                q = q + v * (Lc / 4)
                pts.append(q.copy())
                rad.append(w * ts)
            tufts.append((pts, rad, nrm))
    brooch = []
    for sx in (1, -1):                   # copper disc brooches pinning the front corners
        hit = ray_hit(S, V(sx * 0.15, 0.0, nz - 0.055), V(sx * 0.25, -1, 0.1))
        nrm = S.grad(hit[None])[0]
        brooch.append((hit + nrm * 0.03, nrm))
    lo, hi = V(-0.46, -0.3, nz - 0.33), V(0.46, 0.32, nz + 0.16)
    S.add(Bounded(Displace(reg, 0.0045, 26.0, 3, seed=seed), lo, hi), 0.012, mat="fur")
    for pts, rad, nrm in tufts:
        S.add(Chain(pts, rad, squash=(0.55, 1.0), ref=tuple(nrm)), 0.01, mat="fur")
    for c, nrm in brooch:
        M = basis(nrm)[:, [1, 2, 0]]
        S.add(Torus(c, 0.022, 0.0065, M), 0.003, mat="copper")
        S.add(Sphere(c + nrm * 0.002, 0.016), 0.004, mat="copper")
        S.add(Sphere(c + nrm * 0.011, 0.0075), 0.002, mat="brass")


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    ai = anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip", STYLE, grip_r=GRIP_R)
    anatomy.hand_details(S, L, side)
    sc = L["P"]["hand"] / 0.2
    W = L["wrist_" + side]
    h, n = L["hand_h_" + side], L["hand_n_" + side]
    S.paint(Sphere(W + h * 0.1 * sc - n * 0.012, 0.035), "blush", soft=0.02, value=0.6)
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S, ai


def mail_skirt(L):
    """Split chainmail skirt: 8 panels on an elliptic frustum (alternate layers), copper ring hem."""
    k = KILT_P
    S = Sculpt(materials=MATERIALS, default_mat="mail")
    rng = np.random.RandomState(9)
    n = 8
    cy = k["cy"]
    for i in range(n):
        a_c = (i + 0.5) / n * 2 * math.pi
        layer = i % 2
        rt = k["r_top"] + 0.006 * layer
        rh = k["r_hem"] + 0.01 * layer
        hz = k["hem_z"] + rng.uniform(-0.012, 0.01) - 0.012 * layer
        a_half = math.pi / n * (1.1 if layer else 0.97)
        cone = RoundCone(V(0, cy, k["top_z"] + 0.05), V(0, cy + 0.01, hz - 0.06), rt - 0.012, rh + 0.02,
                         squash=(k["squash"], 1.0))
        shell = Shell(cone, 0.0048)
        d0 = V(math.sin(a_c - a_half), -math.cos(a_c - a_half), 0)
        d1 = V(math.sin(a_c + a_half), -math.cos(a_c + a_half), 0)
        n0 = norm(np.cross(V(0, 0, 1), d0)) * -1.0
        n1 = norm(np.cross(V(0, 0, 1), d1))
        wc = V(0, cy, 0)
        reg = Inter(shell, HalfSpace(wc, n0), HalfSpace(wc, n1), HalfSpace(V(0, 0, hz), V(0, 0, -1)),
                    HalfSpace(V(0, 0, k["top_z"]), V(0, 0, 1)), k=0.005)
        lo, hi = V(-0.42, -0.42, hz - 0.04), V(0.42, 0.42, k["top_z"] + 0.04)
        S.add(Bounded(Displace(reg, 0.0012, 26.0, 2, seed=50 + i), lo, hi), 0.0, mat="mail")
        hem = Inter(Offset(Shell(cone, 0.0048), 0.0022), HalfSpace(wc, n0), HalfSpace(wc, n1),
                    Slab(V(0, 0, hz + 0.009), V(0, 0, 1), 0.0075), k=0.002)
        S.add(Bounded(hem, lo, hi), 0.001, mat="copper")
    return S


# ============================================================================ beard
BRAIDS = dict(C=dict(length=0.3, r0=0.025, r1=0.0135, period=0.062), L=dict(length=0.17, r0=0.019, r1=0.012,
              period=0.05), R=dict(length=0.17, r0=0.019, r1=0.012, period=0.05))


def _azel(d):
    return math.atan2(d[0], -d[1]), math.asin(max(-1.0, min(1.0, d[2])))


def _dir(az, el):
    return V(math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))


def _collide(S_body, P, clear, iters=4):
    P = P.copy()
    clear = np.broadcast_to(np.asarray(clear, float), (len(P),))
    for _ in range(iters):
        dd = S_body.dist(P) - clear
        bad = dd < 0
        if not bad.any():
            break
        P[bad] -= S_body.grad(P[bad]) * dd[bad][:, None]
    return P


def _bezier(R, C, G, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * R + 2 * (1 - t) * t * C + t ** 2 * G


def beard_design(S_body, L, H, seed=29):
    """Returns (soft clumps, braid strand clumps, ring list, braid centre lines). Every beard clump runs from its
    root on the cheek / jaw / chin (below the lower lip, never over the mouth) in a full forward-bulging arc to one
    of three gather points in front of the chest, where the braids start."""
    rng = np.random.RandomState(seed)
    s = H.s
    G = {}
    for key, x, z in (("C", 0.0, 1.0), ("L", 0.078, 1.035), ("R", -0.078, 1.035)):
        p = ray_hit(S_body, V(x, 0.0, z), V(x * 0.8, -1, 0))
        G[key] = p + S_body.grad(p[None])[0] * (0.028 if key == "C" else 0.024)
    hc = H(0, -0.01, -0.03)

    def el_line(azd):
        a = abs(azd)
        xs = [0, 12, 30, 50, 72, 96]
        ys = [-49, -47, -39, -30, -15, -6]   # r2: hairline off the eye sockets / no sideburn slabs at eye level
        return float(np.interp(a, xs, ys))
    golden = math.pi * (3 - math.sqrt(5))
    cand = []
    N = 2600
    for i in range(N):
        z = 1 - 2 * (i + 0.5) / N
        r = math.sqrt(max(0, 1 - z * z))
        a = i * golden
        d = V(math.cos(a) * r, math.sin(a) * r, z)
        az, el = _azel(d)
        azd, eld = math.degrees(az), math.degrees(el)
        if abs(azd) > 98 or eld > el_line(azd) or eld < (-74 if abs(azd) < 40 else -62):
            continue
        cand.append(d)
    cand = np.array(cand)
    n_beard = 128
    # r2: mirror-symmetric roots (the golden spiral is not: one cheek grew a taller lock wall over the left eye)
    cand = cand[cand[:, 0] >= 0.01]
    if len(cand) > n_beard // 2:
        cand = cand[np.linspace(0, len(cand) - 1, n_beard // 2).astype(int)]
    cand = np.concatenate([cand, cand * V(-1, 1, 1)])
    rr = hair.scalp_radius(S_body, hc, cand)
    clumps = []
    down = V(0, 0, -1)
    nh = len(cand) // 2
    rng_main = rng
    for ci, (d, r) in enumerate(zip(cand, rr)):
        if r > 0.16 * s:
            continue
        rng = np.random.RandomState(seed * 7919 + ci % nh)      # r2: mirrored pair = identical jitter
        mx = 1.0 if ci < nh else -1.0
        root = hc + d * r
        nrm = S_body.grad(root[None])[0]
        az, el = _azel(d)
        # r2: gather targets blend continuously C -> side so the locks form one closed fan (no V-gap under the chin)
        side = "L" if az > 0 else "R"
        tb = float(np.clip((abs(math.degrees(az)) - 10.0) / 42.0, 0, 1))
        tb = tb * tb * (3 - 2 * tb)
        g = G["C"] * (1 - tb) + G[side] * tb + V(mx * rng.uniform(-0.01, 0.01), 0, rng.uniform(-0.006, 0.01))
        g = g + S_body.grad(g[None])[0] * (0.012 * math.sin(math.pi * tb))
        bulk = 0.03 + 0.018 * math.cos(az) + rng.uniform(-0.004, 0.006)
        hi_f = float(np.clip((math.degrees(el) + 44.0) / 30.0, 0, 1))   # r2: upper-cheek roots lie flatter
        bulk *= 1.0 - 0.55 * hi_f
        ctl = root + nrm * bulk + down * (0.045 + 0.02 * hi_f) + V(0, -0.012, 0)
        th = rng.uniform(0.016, 0.024)
        P = _bezier(root, ctl, g, 18)
        f = np.linspace(0, 1, len(P))
        P[1:] = _collide(S_body, P[1:], th * 0.55 + 0.003 + 0.01 * np.sin(math.pi * f[1:]) ** 0.7)
        side_f = float(np.clip((abs(math.degrees(az)) - 55.0) / 30.0, 0, 1))    # r2: slimmer side locks
        clumps.append(dict(path=P, width=rng.uniform(0.032, 0.046) * (1 - 0.3 * side_f), thick=th * (1 - 0.25 * side_f),
                           root_dir=d, normal=nrm))
    rng = rng_main
    n_mass = len(clumps)
    # ---- moustache (r2): a full walrus mass tucked under the nose, out over the upper lip (well forward of the
    # beard front, so the mouth never reads as a pit) and sweeping down past the mouth corners into the beard.
    # Strand clumps on top of a solid core (core chains in meta 'mous').
    mous = []
    for sx in (1, -1):
        spine = [H(sx * 0.003, -0.1115, -0.0885), H(sx * 0.022, -0.1225, -0.0965), H(sx * 0.044, -0.1195, -0.1085),
                 H(sx * 0.060, -0.1100, -0.1330), H(sx * 0.066, -0.1040, -0.1650)]
        mous.append((spine, [0.0085, 0.0125, 0.0125, 0.0105, 0.0085]))
        for i, (dz, dy, w, th) in enumerate(((0.004, -0.004, 0.024, 0.012), (-0.002, -0.006, 0.026, 0.013),
                                             (-0.008, -0.004, 0.022, 0.011), (0.0, 0.002, 0.02, 0.01))):
            raw = np.array([p + V(0, dy * (0.3 + 0.7 * min(1.0, j / 2)), dz * (1 - j / 5)) for j, p in enumerate(spine)])
            raw[0] = raw[0] + V(sx * 0.004 * i, 0, 0)
            P, _ = anatomy.resample(raw, step=0.005)
            P = _collide(S_body, P, th * 0.45)
            clumps.append(dict(path=P, width=w, thick=th, root_dir=norm(P[0] - hc),
                               normal=norm(V(sx * 0.3, -1, 0.1))))
        # r3: centre drape strands (one continuous walrus mass over the mouth, subtle centre part only)
        for i, (x0, dy, w, th) in enumerate(((0.004, 0.0, 0.017, 0.0095), (0.011, 0.002, 0.016, 0.009))):
            raw = np.array([H(sx * x0, -0.1175 + dy, -0.0885), H(sx * (x0 + 0.002), -0.1285 + dy, -0.1035),
                            H(sx * (x0 + 0.003), -0.1285 + dy, -0.1215), H(sx * (x0 + 0.002), -0.1245 + dy, -0.1405)])
            P, _ = anatomy.resample(raw, step=0.005)
            P = _collide(S_body, P, th * 0.45)
            clumps.append(dict(path=P, width=w, thick=th, root_dir=norm(P[0] - hc), normal=V(0, -1, 0.05)))
    # r3: solid bridge / drape / nose-tuck cores: no negative-space cleft between the lobes, no skin pocket
    mous.append(([H(-0.024, -0.1235, -0.0975), H(0, -0.1275, -0.0985), H(0.024, -0.1235, -0.0975)],
                 [0.0115, 0.0125, 0.0115]))
    mous.append(([H(0, -0.1205, -0.0915), H(0, -0.1285, -0.1065), H(0, -0.1275, -0.1225), H(0, -0.1235, -0.1405)],
                 [0.009, 0.0125, 0.012, 0.0105]))
    mous.append(([H(-0.044, -0.0945, -0.0895), H(-0.022, -0.1035, -0.0875), H(0, -0.1095, -0.0880),
                  H(0.022, -0.1035, -0.0875), H(0.044, -0.0945, -0.0895)], [0.0065, 0.0068, 0.0068, 0.0068, 0.0065]))
    # ---- bushy brows: short clumps along the brow ridge sweeping up / outward
    for sx in (1, -1):
        # r4: two separate brows (bare glabella between them so the nose bridge reads up to the brow), tapering
        # tufts that sweep OUT + up instead of one flat shelf across the face
        for i, x0 in enumerate((0.0135, 0.0235, 0.0335, 0.0435, 0.053)):
            yb = -0.1005 + 0.0006 * i * i * 1.3
            raw = np.array([H(sx * x0, yb, -0.006 + 0.0015 * i), H(sx * (x0 + 0.011), yb - 0.004, 0.002 + 0.002 * i),
                            H(sx * (x0 + 0.021), yb + 0.001, 0.009 + 0.0025 * i)])
            P, _ = anatomy.resample(raw, step=0.004)
            P[0] = S_body.project(P[:1], offset=-0.0015)[0]
            P[1:] = _collide(S_body, P[1:], 0.0035)
            clumps.append(dict(path=P, width=0.0135 - 0.0008 * i, thick=0.0068, root_dir=norm(P[0] - hc),
                               normal=V(0, -1, 0.3)))
    n_face = len(clumps)
    # ---- braids: from each gather point down the chest / belly, 3 strands, tuft below the end ring
    braid = []
    rings = []
    lines = {}
    for key in ("C", "L", "R"):
        B = BRAIDS[key]
        p = G[key].copy()
        v = norm(V(0, -0.35, -1))
        ds = 0.008
        Pc = [p.copy()]
        steps = int(B["length"] / ds)
        for k in range(steps):
            v = norm(v * 0.8 + down * 0.2)
            p = p + v * ds
            p = _collide(S_body, p[None], B["r0"] * 1.05)[0]
            Pc.append(p.copy())
        C = np.array(Pc)
        C, _ = anatomy.resample(C, step=0.004)
        Tn = np.gradient(C, axis=0)
        Tn /= np.linalg.norm(Tn, axis=1, keepdims=True)
        Nb = S_body.grad(C)
        Nb = Nb - Tn * np.sum(Nb * Tn, axis=1, keepdims=True)
        Nb /= np.maximum(np.linalg.norm(Nb, axis=1, keepdims=True), 1e-9)
        Sd = np.cross(Tn, Nb)
        sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
        f = sl / sl[-1]
        R = B["r0"] + (B["r1"] - B["r0"]) * f ** 0.8
        end_f = 0.84
        m = f <= end_f
        for i in range(3):
            ph = 2 * math.pi * sl / B["period"] + 2 * math.pi * i / 3
            Q = C + Sd * (R * 0.56 * np.sin(ph))[:, None] + Nb * (R * 0.3 * np.sin(2 * ph))[:, None]
            braid.append(dict(path=Q[m], width=float(np.mean(R[m]) * 1.2), thick=float(np.mean(R[m]) * 0.8),
                              root_dir=V(0, 0, -1), normal=V(np.mean(Nb[m], axis=0)), R=R[m]))
        j0 = int(np.searchsorted(f, end_f - 0.02))
        base, tb, nb_, sb = C[j0], Tn[j0], Nb[j0], Sd[j0]
        for i in range(5):
            a = i / 5 * 2 * math.pi + rng.uniform(-0.2, 0.2)
            off = (sb * math.cos(a) + nb_ * math.sin(a)) * R[j0] * 0.35
            spread = (sb * math.cos(a) + nb_ * math.sin(a)) * rng.uniform(0.004, 0.008)
            L_t = rng.uniform(0.04, 0.055) * (1.2 if key == "C" else 1.0)
            pts = np.array([base + off + tb * L_t * u + spread * u ** 1.4 for u in np.linspace(0, 1, 7)])
            clumps.append(dict(path=pts, width=R[j0] * 1.2, thick=R[j0] * 0.8, root_dir=tb, normal=nb_))
        # knot rings: at the top of the braid, mid (centre braid), and the end cap
        rings.append(("top", C[3], Tn[3], R[3] * 1.02))
        if key == "C":
            jm = int(np.searchsorted(f, 0.45))
            rings.append(("mid", C[jm], Tn[jm], R[jm]))
        rings.append(("end", C[j0], Tn[j0], R[j0]))
        lines[key] = C
    # solid core volume under the clumps: no see-through gaps between locks (critic rule), bulges forward
    core = [([H(0, -0.068, -0.142), H(0, -0.098, -0.185), (H(0, -0.098, -0.185) + G["C"]) / 2, G["C"]],
             [0.024, 0.04, 0.034, 0.022]),
            ([H(0, -0.100, -0.1215), H(0, -0.112, -0.140), H(0, -0.118, -0.165)], [0.0075, 0.013, 0.02])]  # r2 chin
    for sx, key in ((1, "L"), (-1, "R")):        # r2: fill the fan between the centre and side gathers
        mid = (G["C"] + G[key]) / 2
        core.append(([H(sx * 0.03, -0.085, -0.15), H(sx * 0.036, -0.1, -0.19), (H(sx * 0.036, -0.1, -0.19) + mid) / 2,
                      mid], [0.026, 0.036, 0.032, 0.024]))
        core.append(([H(sx * 0.064, -0.02, -0.08), H(sx * 0.064, -0.06, -0.14), (H(sx * 0.06, -0.075, -0.17) + G[key]) / 2,
                      G[key]], [0.018, 0.028, 0.026, 0.019]))
    return clumps, braid, rings, lines, dict(n_mass=n_mass, n_face=n_face, G=G, core=core, mous=mous)


def _torus_frame(t):
    b = basis(t)
    return np.stack([b[:, 1], b[:, 2], b[:, 0]], axis=1)


def beard_sculpts(S_body, L, H, seed=29):
    soft, braid, rings, lines, meta_info = beard_design(S_body, L, H, seed)
    out = {}
    for detail in ("lo", "hi"):
        Ss, meta_s = hair.clump_sculpt(soft, mat="mane", materials=BEARD_MATS, detail=detail, grooves=3, seed=seed,
                                       root_thick=0.5, k_mass=0.0085)
        Sb, meta_b = hair.clump_sculpt(braid, mat="mane", materials=BEARD_MATS, detail=detail, grooves=3, seed=seed,
                                       split_tips=False, k_clump=0.002, k_mass=0.0022, tip_frac=0.12, root_frac=0.05,
                                       root_thick=0.85)
        for m in meta_b:
            m["id"] += len(meta_s)
        Ss.extend(Sb)
        for pts, rad in meta_info["core"]:
            Ss.add(Displace(Chain([V(p) for p in pts], rad), 0.003, 70.0, 2, seed=5), 0.012, mat="mane")
        for pts, rad in meta_info["mous"]:           # r2 moustache core (tight blend: keeps the two-lobed shape)
            Ss.add(Displace(Chain([V(p) for p in pts], rad), 0.0015, 90.0, 2, seed=7), 0.006, mat="mane")
        for kind, c, t, r in rings:
            M = _torus_frame(t)
            if kind == "top":            # wide brass knot ring: band + two beads
                Ss.add(Capsule(c - t * 0.009, c + t * 0.009, r * 0.98), 0.002, mat="brass")
                Ss.add(Torus(c - t * 0.009, r * 1.0, 0.0034, M), 0.001, mat="brass")
                Ss.add(Torus(c + t * 0.009, r * 1.0, 0.0034, M), 0.001, mat="brass")
            elif kind == "mid":
                Ss.add(Capsule(c - t * 0.006, c + t * 0.006, r * 0.95), 0.002, mat="brass")
                Ss.add(Torus(c, r * 1.0, 0.0032, M), 0.001, mat="brass")
            else:
                Ss.add(Capsule(c - t * 0.011, c + t * 0.011, r * 0.82), 0.002, mat="brass")
                Ss.add(Torus(c - t * 0.011, r * 0.86, 0.003, M), 0.001, mat="brass")
                Ss.add(Torus(c + t * 0.011, r * 0.84, 0.003, M), 0.001, mat="brass")
        out[detail] = (Ss, meta_s + meta_b)
    return out["hi"][0], out["lo"][0], out["hi"][1], lines, meta_info


def beard_attrs(ob, meta, uv=False):
    P = meshutil.get_verts(ob)
    A = hair.path_attrs(P, meta)
    for k in ("along", "lock_id", "lateral"):
        meshutil.add_float_attr(ob, k, A[k].astype(np.float32))
    for i, ax in enumerate("xyz"):
        meshutil.add_float_attr(ob, "flow_" + ax, A["flow"][:, i].astype(np.float32))
    if uv:
        me = ob.data
        lv = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", lv)
        u = (A["lateral"] + 1) * 0.5
        v = A["along"] * 4.0
        uvl = me.uv_layers.new(name="lockuv")
        uvl.data.foreach_set("uv", np.stack([u[lv], v[lv]], axis=1).astype(np.float32).ravel())
    return A


# ============================================================================ palette + painters
# Value / hue ladder (Brann r1 lesson: 4+ separated value groups in the greyscale game view; AgX lifts and
# desaturates, so albedos are pushed). Target albedo luma (sRGB Rec.709):
#   ruddy fair skin ~50%  >  bright steel chainmail ~40% (ring gaps darken it to ~34% at distance)  ~  ivory
#   horns / copper accents (bright, small)  >  copper-red beard ~24% (saturated hue: reads red against the neutral
#   mail, one value step below it)  ~  blackened iron helm ~24% (above the face, copper band between them)  >
#   verdigris gambeson ~18% / dark bear fur ~14%  >  near-black leather belt, bracers, boots, trousers ~8-11%.
PAL = dict(
    skin=shaders.srgb(214, 138, 100), skin_warm=shaders.srgb(210, 92, 76), skin_cool=shaders.srgb(140, 100, 90),
    skin_shadow=shaders.srgb(132, 86, 88),
    lips=shaders.srgb(150, 66, 58), scar=shaders.srgb(222, 160, 136), skin_rough=0.6,
    iris=shaders.srgb(70, 120, 150), sclera=shaders.srgb(224, 214, 200),
    hair=shaders.srgb(160, 50, 16), hair_tip=shaders.srgb(200, 86, 30), hair_hi=shaders.srgb(226, 128, 70),
    hair_sheen=0.16, hair_rough=0.74, hair_hi_amt=0.08,
    brow=shaders.srgb(120, 38, 14), brow_hi=shaders.srgb(170, 70, 34), brow_hi_amt=0.05, brow_rough=0.85,
    leather=shaders.srgb(40, 27, 20), leather_worn=shaders.srgb(82, 58, 42),
    leather_dark=shaders.srgb(24, 18, 15), leather_dark_worn=shaders.srgb(56, 44, 36),
    bronze=shaders.srgb(196, 112, 64), bronze_patina=shaders.srgb(64, 150, 122), bronze_patina_amt=0.45,
    iron=shaders.srgb(78, 80, 86), iron_patina=shaders.srgb(70, 46, 34),
    mail=shaders.srgb(104, 106, 114), mail_rust=shaders.srgb(96, 62, 42),
    copper=shaders.srgb(206, 104, 58), copper_hi=shaders.srgb(246, 170, 116),
    copper_patina=shaders.srgb(64, 158, 128), copper_patina_amt=0.45,
    brass=shaders.srgb(226, 176, 84), brass_patina=shaders.srgb(70, 136, 112), brass_patina_amt=0.25,
    quilt=shaders.srgb(34, 74, 66), fur=shaders.srgb(50, 40, 33), fur_root=shaders.srgb(22, 18, 16),
    fur_tip=shaders.srgb(94, 80, 66),
    horn=shaders.srgb(222, 206, 172), horn_tip=shaders.srgb(70, 58, 46),
    cloth=shaders.srgb(44, 32, 26), sole=shaders.srgb(28, 22, 18),
)


def p_mail(c, pal):
    """Steel chainmail (the ring lattice itself is node-side: shaders MICRO 'chainmail'): bright steel, rust in
    the folds / low on the skirt, darker in cavities."""
    n1 = c.noise(12.0, 3, 101)
    rgb = np.tile(pal["mail"], (c.n, 1)) * (1.0 + 0.08 * n1)[:, None]
    rust = np.clip(0.8 * shaders.smooth01(c.cav, 0.05, 0.5) + 0.3 * shaders.smooth01(n1, 0.35, 0.85), 0, 1)
    rgb = shaders.mix(rgb, pal["mail_rust"], 0.5 * rust)
    rgb = shaders.mix(rgb, rgb * 0.45, 0.55 * c.cav)
    metal = 0.6 * (1 - 0.6 * rust)
    return shaders.out(c.n, rgb, np.clip(0.42 + 0.1 * n1 + 0.25 * rust, 0.2, 0.9), metal)


def p_copper(c, pal):
    base = pal["copper"]
    n1 = c.noise(16.0, 3, 91)
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.12 * n1)[:, None]
    pat = np.clip(0.9 * shaders.smooth01(c.cav, 0.04, 0.4) + 0.4 * shaders.smooth01(n1, 0.35, 0.8), 0, 1)
    pat *= pal.get("copper_patina_amt", 0.6)
    rgb = shaders.mix(rgb, pal["copper_patina"], pat)
    rgb = shaders.mix(rgb, pal["copper_hi"], 0.5 * c.ridge * (1 - pat))
    return shaders.out(c.n, rgb, np.clip(0.32 + 0.1 * n1 - 0.12 * c.ridge + 0.4 * pat, 0.12, 0.9),
                       0.85 * (1 - 0.9 * pat))


def p_brass(c, pal):
    return shaders.p_metal(c, pal, "brass")


def p_iron(c, pal):
    """Blackened iron helm: dark with bright worn edges (ridges / rivets catch light), rust in the recesses."""
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "iron")
    rgb = shaders.mix(rgb, shaders.srgb(170, 172, 178), 0.45 * c.ridge)
    return rgb, np.clip(rough + 0.08, 0.2, 0.9), np.clip(metal * 0.75, 0, 1), emit


def p_quilt(c, pal):
    """Quilted gambeson: diamond stitch lattice (world-space, 4 cm) with puffed cells, dyed verdigris-teal."""
    P = c.P
    q = 0.04
    u = (P[:, 2] + P[:, 0] * 0.7 + P[:, 1] * 0.7) / q
    v = (P[:, 2] - P[:, 0] * 0.7 - P[:, 1] * 0.7) / q
    du = np.abs(u - np.round(u))
    dv = np.abs(v - np.round(v))
    seam = np.clip(1 - np.minimum(du, dv) / 0.07, 0, 1)
    puff = np.minimum(du, dv) * 2
    n1 = c.noise(20.0, 2, 102)
    rgb = np.tile(pal["quilt"], (c.n, 1)) * (0.82 + 0.3 * puff + 0.08 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.4, np.maximum(seam * 0.8, c.cav * 0.7))
    return shaders.out(c.n, rgb, 0.88, 0.0)


def p_horn(c, pal):
    """Ivory horn: pale at the base, darkening to a smoky tip, growth rings darker."""
    horns = c.x.get("horns") or []
    P = c.P
    along = np.zeros(c.n)
    for b0, tip in horns:
        d0 = np.linalg.norm(P - b0, axis=1)
        dt = np.linalg.norm(P - tip, axis=1)
        a = d0 / np.maximum(d0 + dt, 1e-6)
        along = np.where(np.linalg.norm(P - b0, axis=1) < 0.25, a, along)
    n1 = c.noise(60.0, 2, 103)
    rgb = shaders.mix(np.tile(pal["horn"], (c.n, 1)), pal["horn_tip"], shaders.smooth01(along, 0.55, 1.0) * 0.85)
    rgb *= (0.94 + 0.08 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.55, 0.7 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.42 + 0.1 * n1, 0.2, 0.8), 0.0)


def p_hair(c, pal):
    rgb, rough, metal, emit = shaders.p_mane(c, pal, "hair")
    lid = c.attr("lock_id")
    rnd = np.sin(lid * 7.123 + 11.7) * 24634.6345
    rnd = rnd - np.floor(rnd)
    return rgb, np.clip(rough + 0.12 * (rnd - 0.5), 0.35, 0.9), metal, emit


def p_fur(c, pal):
    """r2: bear fur as fine strand-direction streaks (critic: the lib's isotropic fbm blotches read as camo):
    world noise stretched ~8x along Z, tips lifted on the tuft ridges only, roots dark in the cavities."""
    P = c.P
    st = sdf.fbm(P[:, 0], P[:, 1], P[:, 2] * 0.12, 2, 260.0, seed=43)
    n1 = c.noise(22.0, 2, 41)
    rgb = np.tile(pal["fur"], (c.n, 1)) * (0.92 + 0.1 * n1)[:, None]
    tipw = np.clip(0.3 * shaders.smooth01(st, 0.0, 0.6) + 0.5 * shaders.smooth01(c.ridge, 0.15, 0.8), 0, 0.7)
    rgb = shaders.mix(rgb, pal["fur_tip"], tipw)
    rgb = shaders.mix(rgb, pal["fur_root"], 0.85 * shaders.smooth01(c.cav + 0.15 * st, 0.05, 0.5))
    return shaders.out(c.n, rgb, np.clip(0.82 + 0.08 * st, 0.6, 0.95), 0.0)


def p_skin_gorrim(c, pal):
    """r4: lib skin + value/hue structure so brow, nose and cheek never merge into one red mass: concavities
    and the painted 'cool' zones (sockets, bridge sides, under-brow, temples) go cooler + darker, ridges
    (nose dorsum, cheek tops, brow) take a warm light."""
    rgb, rough, metal, emit = shaders.p_skin(c, pal)
    cool = c.paint("cool")
    shade = pal["skin_shadow"]
    rgb = shaders.mix(rgb, shade, np.clip(0.55 * cool + 0.35 * c.cav, 0, 0.75))
    rgb = shaders.mix(rgb, rgb * np.array([1.07, 1.02, 0.9]), np.clip(0.5 * c.ridge, 0, 0.4) * (1 - cool))
    return rgb, rough, metal, emit


PAINTERS = {"skin": p_skin_gorrim, "mail": p_mail, "copper": p_copper, "brass": p_brass, "iron": p_iron, "quilt": p_quilt, "horn": p_horn,
            "mane": p_hair, "fur": p_fur}


# ============================================================================ previews
MAT_COLORS = {"skin": (0.7, 0.45, 0.33), "eye": (0.9, 0.9, 0.88), "nail": (0.75, 0.55, 0.5), "brow": (0.4, 0.1, 0.03),
              "hair": (0.4, 0.1, 0.03), "mane": (0.45, 0.12, 0.03), "leather": (0.12, 0.08, 0.06),
              "leather_dark": (0.07, 0.05, 0.04), "bronze": (0.7, 0.4, 0.22), "iron": (0.25, 0.25, 0.27),
              "mail": (0.6, 0.6, 0.62), "copper": (0.75, 0.38, 0.2), "brass": (0.85, 0.65, 0.3),
              "quilt": (0.1, 0.28, 0.24), "fur": (0.2, 0.15, 0.12), "horn": (0.85, 0.8, 0.66),
              "cloth": (0.15, 0.1, 0.08), "sole": (0.08, 0.06, 0.05)}


def assign_clay(ob, mat_of_vertex, materials):
    for mname in materials:
        ob.data.materials.append(preview.clay_material("clay_" + mname, MAT_COLORS.get(mname, (0.5, 0.5, 0.5))))
    me = ob.data
    pv = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", pv)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    me.polygons.foreach_set("material_index", mat_of_vertex[lv[pv]].astype(np.int32))


def mesh_sculpt(S, name, h, lo=None, hi=None, clay=True):
    v, q, t = sdf.polygonize(S, h, lo, hi)
    ob = meshutil.mesh_from_numpy(name, v, q, t)
    if clay:
        d, mat, paints = S.eval_points(v)
        assign_clay(ob, mat, S.materials)
    return ob


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(GORRIM)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    if args.preview in ("body", "full"):
        S, info = body_sculpt(L, gear_on=(args.preview == "full"))
        mesh_sculpt(S, "body", args.h or 0.0035)
        if args.preview == "full":
            for s in ("L", "R"):
                Sh, _ = hand_sculpt(L, s)
                w = L["wrist_" + s]
                mesh_sculpt(Sh, "hand_" + s, 0.0014, w - 0.16, w + 0.16)
            mesh_sculpt(mail_skirt(L), "skirt", 0.003)
            _, S_lo, _, _, _ = beard_sculpts(S, L, info["head"]["H"])
            mesh_sculpt(S_lo, "beard", 0.0022)
        views = [dict(target=(0, 0, 0.7), ortho=1.6, yaw=y, dist=6) for y in (0, 35, 90, 180)]
        preview.render_views(os.path.join(out, args.preview + ".png"), views, res=(760, 800))
        if args.preview == "full":
            views = [dict(target=(0, -0.02, 1.1), ortho=0.62, yaw=y, dist=4, pitch=4) for y in (0, 35, 150)]
            preview.render_views(os.path.join(out, "full_upper.png"), views, res=(800, 800))
    elif args.preview in ("face", "beard"):
        S, info = body_sculpt(L, gear_on=False, parts=("torso", "arms", "head"))
        H = info["head"]["H"]
        helm(S, L, info["head"])
        fur_mantle(S, L)
        mesh_sculpt(S, "head", args.h or (0.0009 if args.preview == "face" else 0.0018), V(-0.22, -0.2, 0.9),
                    V(0.22, 0.2, 1.42))
        if args.preview == "beard" or True:
            _, S_lo, _, _, _ = beard_sculpts(S, L, H)
            mesh_sculpt(S_lo, "beard", args.h or 0.0014)
        views = [dict(target=(0, -0.02, 1.2), ortho=0.36, yaw=y, dist=3, pitch=2) for y in (0, 30, 90)]
        preview.render_views(os.path.join(out, args.preview + ".png"), views, res=(800, 800))
    print(f"[gorrim] preview {args.preview} done in {time.time()-t0:.1f}s")


# ============================================================================ rig helpers
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.02)) / 0.08, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.22)


def kilt_angular_blend(P, names, W):
    """Share each level's chain weight between the two nearest kilt chains (cosine partition, Brann r2 lesson)."""
    k = KILT_P
    theta = np.arctan2(P[:, 0], -(P[:, 1] - k["cy"]) / k["squash"])
    sides = (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2))
    part = np.stack([np.maximum(np.cos(theta - a), 0.0) ** 1.0 for _, a in sides], axis=1)
    part /= np.maximum(part.sum(axis=1, keepdims=True), 1e-6)
    W = W.copy()
    for i in range(1, KILT_CHAIN + 1):
        cols = [names.index(f"kilt_{sd}_{i}") if f"kilt_{sd}_{i}" in names else -1 for sd, _ in sides]
        if min(cols) < 0:
            continue
        level = W[:, cols].sum(axis=1)
        W[:, cols] = level[:, None] * part
    return W


def kilt_chain_points(n=KILT_CHAIN):
    k = KILT_P
    out = {}
    for side, a in (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2)):
        pts = []
        for i in range(n + 1):
            f = i / n
            z = (k["top_z"] - 0.025) + ((k["hem_z"] + 0.02) - (k["top_z"] - 0.025)) * f
            r = k["r_top"] + (k["r_hem"] - k["r_top"]) * (f * 0.9) - 0.012
            pts.append(V(math.sin(a) * r, k["cy"] - math.cos(a) * r * k["squash"], z))
        out[side] = pts
    return out


def beard_chain_extra(lines, n=BEARD_CHAIN):
    C = lines["C"]
    sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    ts = np.linspace(0.0, 0.92, n + 1) * sl[-1]
    pts = [V(np.array([np.interp(t, sl, C[:, a]) for a in range(3)])) + V(0, 0.012, 0) for t in ts]
    ex = []
    par = "head"
    for i in range(n):
        nm = f"beard_{i+1}"
        ex.append((nm, pts[i], pts[i + 1], par, i > 0))
        par = nm
    return ex, pts


def head_mask(L, H):
    a = H(0, -0.09, -0.142)
    b = H(0, 0.10, -0.085)
    nrm = norm(np.cross(V(1, 0, 0), b - a))
    if nrm[2] < 0:
        nrm = -nrm
    c = (a + b) * 0.5

    def fn(P):
        s = (P - c) @ nrm
        return np.clip((s + 0.004) / 0.02, 0, 1) * (np.linalg.norm(P - H(0, 0, 0), axis=1) < 0.26 * H.s)
    return fn


def wrist_mask(L, side, beyond=0.012, soft=0.02):
    w = L["wrist_" + side]
    h = L["hand_h_" + side]

    def fn(P):
        near = np.linalg.norm(P - w, axis=1) < 0.16
        return np.clip(((P - w) @ h - beyond) / soft + 0.5, 0, 1) * near
    return fn


def uv_regions(arm, names):
    M = np.array(arm.matrix_world)
    cfg = {}
    for i, nm in enumerate(names):
        b = arm.data.bones[nm]
        h = M[:3, :3] @ np.array(b.head_local) + M[:3, 3]
        t = M[:3, :3] @ np.array(b.tail_local) + M[:3, 3]
        sx = 1.0 if nm.endswith("_L") else -1.0
        ref, dens, axis, halves = None, 1.0, (h, t), False
        if nm in ("hips", "spine", "chest", "neck"):
            axis, ref, halves = (V(0, 0, h[2]), V(0, 0, t[2])), V(1, 0, 0), True
        elif nm == "head":
            axis, ref, dens, halves = (V(0, 0.01, h[2]), V(0, 0.01, t[2])), V(1, 0, 0), 1.6, True
        elif nm.startswith(("upperarm", "forearm")):
            a = math.radians(40)
            ref = V(-sx * math.sin(a), 0.15, -math.cos(a))
        elif nm.startswith(("thigh", "shin")):
            ref = V(-sx, 0.35, 0)
        elif nm.startswith(("foot", "toe")):
            ref = V(0, 0, -1)
        cfg[i] = dict(axis=axis, ref=ref, density=dens, halves=halves)
    return cfg


def skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, beard_lo, g_c):
    Pb = meshutil.get_verts(body_lo)
    _, vm, _ = S.eval_points(Pb)
    metal_ids = [S.materials.index(m) for m in ("brass",) if m in S.materials]
    rigid = skin.rigid_components(body_lo, np.isin(vm, metal_ids))
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_",
                                                                                              "beard_"))]
    fur_v = (vm == S.materials.index("fur")).astype(float)
    hm = head_mask(L, H)

    def head_no_fur(P):                   # r3: the mantle's neck roll was forced to 'head' (clavicle<->head tears)
        return hm(P) * (1.0 - fur_v)

    def body_post(P, names, W):
        """r3 (engine skinCheck: thigh<->upperarm / spine<->upperarm tears on the barrel flanks): below the armpit
        the flank is equidistant to spine, thigh and upperarm bones -> strip arm weights from the torso volume
        and thigh weights above the belt; renormalise onto the spine chain."""
        W = W.copy()
        ax = np.abs(P[:, 0])
        flank = np.clip((0.95 - P[:, 2]) / 0.05, 0, 1) * np.clip((0.33 - ax) / 0.04, 0, 1)
        for nm in names:
            if nm.startswith(("upperarm_", "forearm_")):
                W[:, names.index(nm)] *= (1.0 - flank)
        above = np.clip((P[:, 2] - 0.70) / 0.06, 0, 1)
        for nm in ("thigh_L", "thigh_R"):
            if nm in names:
                W[:, names.index(nm)] *= (1.0 - above)
        tot = W.sum(1)
        fb = names.index("spine") if "spine" in names else names.index("hips")
        W[tot < 1e-6, fb] = 1.0
        return W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    body_W = skin.skin(body_lo, arm, method=args.skin, S=S, allowed=body_bones, post=body_post,
                       overrides=[(head_no_fur, "head"), (crotch_mask, "hips")] +
                                 [(wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")],
                       rigid=rigid)
    for s in ("L", "R"):
        skin.skin(hands_lo[s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(wrist_mask(L, s), "hand_" + s)], smooth=2)
    kilt_bones = ["hips", "thigh_L", "thigh_R"] + [b.name for b in arm.data.bones if b.name.startswith("kilt_")]
    top = KILT_P["top_z"]

    def kilt_post(P, names, W):
        for t in ("thigh_L", "thigh_R"):
            W[:, names.index(t)] = 0.0
        W = kilt_angular_blend(P, names, W)
        W, _ = skin.top_k(W, 4)
        return skin.skirt_weights(P, names, W, top, KILT_P["hem_z"], share=0.55, seam=0.12)
    skin.skin(kilt_lo, arm, method="sdf", allowed=kilt_bones, power=3.0, post=kilt_post,
              overrides=[(lambda P: np.clip((P[:, 2] - (top - 0.05)) / 0.04, 0, 1), "hips")])
    beard_bones = ["head"] + [b.name for b in arm.data.bones if b.name.startswith("beard_")]
    zg = float(g_c[2])

    def rigid_head(P):
        return np.clip((P[:, 2] - (zg - 0.005)) / 0.025, 0, 1)
    skin.skin(beard_lo, arm, method="sdf", allowed=beard_bones, power=3.0, overrides=[(rigid_head, "head")])
    return body_W


# ============================================================================ build
# ---- QA helpers ported from build_hero_seraphine.py r2 (UV fold repair + geometry QA)
def uv_overlap_faces(ob, freg=None, res=1024, min_dist=0.03):
    """Faces whose UVs land on the same texel as a face >= min_dist away in 3D (within the same region when freg is
    given -- regions are unpacked and overlap each other before packing). r2: the angle-based unwrap folded the
    shoulder-yoke / pauldron-top charts over the arm & neck skin -> the bake wrote skin into the yoke = the
    'torn shards' look (albedo confetti) the critic saw."""
    me = ob.data
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nf = len(ls)
    T = np.stack([ls, ls + 1, ls + 2], 1)
    U = uv[T]
    C = co[lv[T]].mean(1)
    bs = np.array([(a, b, 1 - a - b) for a in np.linspace(0.05, 0.9, 5) for b in np.linspace(0.05, 0.9 - a, 3)])
    groups = [np.arange(nf)] if freg is None else [np.nonzero(freg == r)[0] for r in np.unique(freg)]
    bad = np.zeros(nf, bool)
    for g in groups:
        if len(g) < 2:
            continue
        Ug = U[g]
        lo = Ug.reshape(-1, 2).min(0)
        span = max(float((Ug.reshape(-1, 2).max(0) - lo).max()), 1e-9)
        R = res if freg is None else 512
        px = np.einsum("sk,fkd->fsd", bs, (Ug - lo) / span)
        ij = np.clip((px * R).astype(np.int64), 0, R - 1)
        key = (ij[..., 1] * R + ij[..., 0]).reshape(-1)
        fid = np.repeat(g, len(bs))
        o = np.argsort(key, kind="stable")
        k2, f2 = key[o], fid[o]
        first = np.r_[True, k2[1:] != k2[:-1]]
        f0 = f2[first][np.cumsum(first) - 1]
        far = np.linalg.norm(C[f2] - C[f0], axis=1) > min_dist
        bad[f2[far]] = True
        bad[f0[far]] = True
    return bad


def fix_uv_overlaps(ob, freg, cfg):
    """Re-chart folded faces (+1 ring) of each region with smart project at that region's density."""
    isl, _ = pipeline.uv_islands(ob)
    ls = np.empty(len(ob.data.polygons), np.int32)
    ob.data.polygons.foreach_get("loop_start", ls)
    bad = uv_overlap_faces(ob, isl[ls])      # folds inside one chart (charts overlap each other before packing)
    if not bad.any():
        return 0
    me = ob.data
    ls, lt, lv, uv, lf = pipeline.loop_arrays(ob)
    T = lv[np.stack([ls, ls + 1, ls + 2], 1)]
    vb = np.zeros(len(me.vertices), bool)
    vb[T[bad].reshape(-1)] = True
    ring = vb[T].any(1)
    n = 0
    for r in np.unique(freg[ring]):
        m = ring & (freg == r)
        pipeline.smart_project_faces(ob, m, angle=60.0)
        pipeline.normalize_density(ob, m, cfg.get(int(r), {}).get("density", 1.0))
        n += int(m.sum())
    pipeline.log(f"{ob.name}: re-charted {n} folded faces ({int(bad.sum())} overlapping)")
    return n


def geom_qa(ob):
    """r2 geometry QA (critic r1: torn shards): loose components, boundary edges (holes), non-manifold edges,
    inconsistently wound edges (flipped normals), degenerate faces, signed volume (inverted = negative), and
    whether mesh.validate() had to repair anything."""
    me = ob.data
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    lf = np.repeat(np.arange(len(ls)), lt)
    nxt = np.arange(len(lv)) + 1
    last = np.zeros(len(lv), bool)
    last[ls + lt - 1] = True
    nxt[last] = ls[lf[last]]
    a, b = lv, lv[nxt]
    key = np.minimum(a, b).astype(np.int64) * (1 << 32) + np.maximum(a, b)
    u, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    fwd = np.bincount(inv, weights=(a < b).astype(float), minlength=len(u))
    manifold = cnt == 2
    flipped = int((manifold & ((fwd == 0) | (fwd == 2))).sum())
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tri = lt == 3
    T = lv[np.stack([ls, ls + 1, ls + 2], 1)[tri]]
    P0, P1, P2 = co[T[:, 0]], co[T[:, 1]], co[T[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(P1 - P0, P2 - P0), axis=1)
    vol = float(np.einsum("ij,ij->i", P0, np.cross(P1, P2)).sum() / 6.0)
    # components over shared vertices
    E = np.stack([a, b], 1)
    lab = np.arange(len(me.vertices))
    for _ in range(4000):
        m = np.minimum(lab[E[:, 0]], lab[E[:, 1]])
        new = lab.copy()
        np.minimum.at(new, E[:, 0], m)
        np.minimum.at(new, E[:, 1], m)
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    used = np.unique(lv)
    comps, ccnt = np.unique(lab[used], return_counts=True)
    me2 = me.copy()
    repaired = bool(me2.validate(verbose=False))
    bpy.data.meshes.remove(me2)
    r = dict(components=int(len(comps)), smallest_component_verts=int(ccnt.min()) if len(ccnt) else 0,
             boundary_edges=int((cnt == 1).sum()), nonmanifold_edges=int((cnt > 2).sum()), flipped_edges=flipped,
             degenerate_faces=int((area < 1e-10).sum()), signed_volume_m3=round(vol, 5), validate_repaired=repaired)
    pipeline.log(f"geom QA {ob.name}: " + json.dumps(r))
    return r


def drop_islands(ob, h, min_verts=64):
    """Delete loose mesh islands smaller than min_verts (scaled to the polygonize step h vs 3.6 mm)."""
    import bmesh
    me = ob.data
    nv = len(me.vertices)
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    E = e.reshape(-1, 2)
    lab = np.arange(nv)
    for _ in range(4000):
        m = np.minimum(lab[E[:, 0]], lab[E[:, 1]])
        new = lab.copy()
        np.minimum.at(new, E[:, 0], m)
        np.minimum.at(new, E[:, 1], m)
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    u, inv, cnt = np.unique(lab, return_inverse=True, return_counts=True)
    thr = max(8, int(min_verts * (0.0036 / h) ** 2))
    kill = cnt[inv] < thr
    n_isl = int((cnt < thr).sum())
    if n_isl:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(kill)[0]], context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
    pipeline.log(f"{ob.name}: dropped {n_isl} islands < {thr} verts ({int(kill.sum())} verts); "
                 f"{len(u) - n_isl} components kept")
    return n_isl


def build(args):
    T0 = time.time()
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt = (0.004, 0.0016, 0.0012, 0.003) if fast else (0.002, 0.0009, 0.0007, 0.0014)
    h_hair = 0.0018 if fast else 0.001
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(GORRIM)
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}}

    t = time.time()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    Sk = mail_skirt(L)
    Sh = {s: hand_sculpt(L, s)[0] for s in ("L", "R")}
    Sb_hi, Sb_lo, beard_meta, lines, binfo = beard_sculpts(S, L, H)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")

    L["kilt_chain_pts"] = kilt_chain_points()
    extra, _ = beard_chain_extra(lines)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN, extra=extra)

    t = time.time()
    if args.stage == "skin":
        body_hi = head_hi = kilt_hi = beard_hi = None
        hands_hi = {"L": None, "R": None}
    else:
        body_hi = pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX)
        drop_islands(body_hi, h_body)
        head_hi = pipeline.sculpt_mesh(S, "head_hi", h_head, HEAD_BOX[0] - 0.012, HEAD_BOX[1] + 0.012, keep_box=HEAD_BOX)
        hands_hi = {}
        for s in ("L", "R"):
            w = L["wrist_" + s]
            hands_hi[s] = pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)
        kilt_hi = pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)
        beard_hi = pipeline.sculpt_mesh(Sb_hi, "beard_hi", h_hair)
        beard_attrs(beard_hi, beard_meta, uv=True)
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    h_lo = 0.0034 if not fast else 0.0045
    body_lo = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                               clean=lambda o: report.__setitem__("islands_dropped", drop_islands(o, h_lo)))
    hands_lo = {}
    for s in ("L", "R"):
        w = L["wrist_" + s]
        hands_lo[s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0017, args.hand_tris, w - 0.17, w + 0.17,
                                       symmetry=False)
    kilt_lo = pipeline.lowpoly(Sk, "kilt_lo", 0.0028, args.kilt_tris)
    beard_lo = pipeline.lowpoly(Sb_lo, "beard_lo", 0.0024, args.beard_tris,
                                clean=lambda o: drop_islands(o, 0.0024, min_verts=40))
    beard_attrs(beard_lo, beard_meta)
    los = [body_lo, hands_lo["L"], hands_lo["R"], kilt_lo, beard_lo]
    for o in los:                         # post-decimation stray tris (Seraphine r2)
        drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {o.name: geom_qa(o) for o in los}
    pipeline.log("geom QA: " + json.dumps(report["geom_qa"]))
    his = [body_hi, head_hi, hands_hi["L"], hands_hi["R"], kilt_hi, beard_hi]
    for o in los:
        report["parts"][o.name] = meshutil.tri_count(o)
    report["tris_total"] = int(sum(report["parts"].values()))
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']} total={report['tris_total']}")

    t = time.time()
    body_W = skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, beard_lo, binfo["G"]["C"])
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    if args.stage == "skin":
        for o in los:
            pipeline.strip_for_export(o)
        body = meshutil.join(los, ASSET + "_mesh")
        skin.debug_dominant(body)
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "gorrim_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    # ---------------------------------------------------------------- UV atlas
    t = time.time()
    names, W = body_W
    vdom = np.argmax(W, axis=1)
    me = body_lo.data
    ls = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    fl = np.stack([vdom[lv[ls + k]] for k in range(3)], axis=1)
    freg = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
    freg = pipeline.clean_labels(freg, pipeline.face_adjacency(body_lo), iters=3)
    cfg = uv_regions(arm, names)
    hid = names.index("head")
    Cf = pipeline.face_centers(body_lo)
    face_id = len(names)
    freg = np.where((freg == hid) & (Cf[:, 1] < H(0, -0.012, 0)[1]) & (Cf[:, 2] > H(0, 0, -0.16)[2]) &
                    (Cf[:, 2] < H(0, 0, 0.035)[2]), face_id, freg)
    freg = pipeline.clean_labels(freg, pipeline.face_adjacency(body_lo), iters=2)
    cfg[face_id] = dict(axis=None, ref=None, density=FACE_DENSITY)
    cfg[hid].update(density=1.2, ref=V(0, 1, 0), halves=False)
    pipeline.region_unwrap(body_lo, freg, cfg)
    report["uv_refolded"] = sum(fix_uv_overlaps(body_lo, freg, cfg) for _ in range(3))
    for s in ("L", "R"):
        o = hands_lo[s]
        allf = np.ones(len(o.data.polygons), bool)
        pipeline.smart_project_faces(o, allf, angle=66.0)
        pipeline.normalize_density(o, allf, 1.3)
    allf = np.ones(len(kilt_lo.data.polygons), bool)
    pipeline.smart_project_faces(kilt_lo, allf, angle=70.0)
    pipeline.normalize_density(kilt_lo, allf, 0.9)
    allf = np.ones(len(beard_lo.data.polygons), bool)
    pipeline.smart_project_faces(beard_lo, allf, angle=78.0)
    pipeline.normalize_density(beard_lo, allf, 0.95)
    fill = pipeline.pack_atlas_shape(los, margin_px=6 if not fast else 4, res=res)
    report["uv_fill"] = fill
    report["uv_overlap_after_pack"] = int(uv_overlap_faces(body_lo).sum())
    pipeline.log(f"UV overlap after pack (body_lo faces): {report['uv_overlap_after_pack']}")
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- paint
    t = time.time()
    extra_p = dict(eyes=info["head"]["eyes"], eye_r=info["head"]["eye_r"], z_knee=L["knee_L"][2],
                   z_chest=L["chest"][2], hair_band_z=H(0, 0, 0.07)[2], horns=info["head"].get("horns"))
    for o, Sx in ((body_hi, S), (head_hi, S), (hands_hi["L"], Sh["L"]), (hands_hi["R"], Sh["R"]), (kilt_hi, Sk)):
        shaders.assign_bake_materials(o, Sx.materials, kinds=KINDS)
        shaders.paint_mesh(o, Sx.materials, L, PAL, extra_p, painters=PAINTERS)
    shaders.assign_bake_materials(beard_hi, BEARD_MATS, kinds=KINDS)
    shaders.paint_mesh(beard_hi, BEARD_MATS, L, PAL, extra_p, painters=PAINTERS)
    pipeline.log(f"painting {time.time()-t:.1f}s")

    t = time.time()
    jobs = [(body_lo, [body_hi, head_hi], 0.012, 0.03),
            (hands_lo["L"], [hands_hi["L"]], 0.006, 0.014),
            (hands_lo["R"], [hands_hi["R"]], 0.006, 0.014),
            (kilt_lo, [kilt_hi], 0.005, 0.012),
            (beard_lo, [beard_hi], 0.006, 0.016)]
    B = pipeline.Baker(res, jobs, shaders.set_pass, los, his)
    spp = dict(albedo=4, prm=2, ao=32 if fast else 64, normal=4 if fast else 8)
    maps = B.run(passes=[("albedo", "EMIT", spp["albedo"]), ("prm", "EMIT", spp["prm"]),
                         ("ao", "EMIT", spp["ao"]), ("normal", "NORMAL", spp["normal"])])
    pipeline.log(f"bake total {time.time()-t:.1f}s")
    tex = composite_maps(maps, res)
    report["textures"] = {k: [res, res] for k in tex}

    mat = pipeline.final_material("M_" + ASSET, tex["albedo"], tex["normal"], tex["orm"])
    for o in los:
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
    for o in his:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    body = meshutil.join(los, ASSET + "_mesh")
    body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
    meshutil.select_only([body])
    report["tris_total"] = meshutil.tri_count(body)
    qa = skin.stretch_report(body, arm)
    report["stretch_qa"] = qa
    pipeline.log("stretch QA: " + ", ".join(f"{k}: bad {v['bad']} soft {v['soft']}" for k, v in qa.items()))
    out = os.path.join(OUT_MODELS, ASSET + ".glb")
    pipeline.export_glb(out, [arm, body], scene_name=ASSET)
    report["glb"] = out
    report["glb_mb"] = os.path.getsize(out) / 1e6
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "gorrim_report.json"), report)
    pipeline.log(f"DONE {ASSET} in {report['seconds']:.0f}s -> {out} ({report['glb_mb']:.1f} MB, "
                 f"{report['tris_total']} tris)")
    if not args.no_weapon:
        import build_weapon_copper_ax
        importlib.reload(build_weapon_copper_ax)
        build_weapon_copper_ax.build(args)


def composite_maps(maps, res):
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao = maps["ao"]
    ao_s = np.clip(ao[..., 0], 0, 1)
    ao_l = np.clip(ao[..., 1], 0, 1)
    prm = maps["prm"]
    nrm = maps["normal"]
    rgb = alb[..., :3].copy()
    occl = np.clip(1.0 - 0.75 * (1 - ao_s) - 0.45 * (1 - ao_l), 0, 1)[..., None]
    tint = np.array([0.52, 0.30, 0.26])
    rgb = rgb * (tint + (1 - tint) * occl)
    orm = np.stack([np.clip(0.35 + 0.65 * ao_l * (0.5 + 0.5 * ao_s), 0, 1), np.clip(prm[..., 0], 0.04, 1),
                    np.clip(prm[..., 1], 0, 1)], axis=-1)
    n3 = nrm[..., :3]
    rgb = pipeline.dilate(rgb, cov, 16)
    orm = pipeline.dilate(orm, cov, 16)
    n3 = pipeline.dilate(n3, cov, 16)
    tex = {}
    tex["albedo"] = pipeline.save_png(rgb, os.path.join(OUT_TEX, "gorrim_albedo.png"), "gorrim_albedo", "sRGB",
                                      linear_to_srgb=True)
    tex["orm"] = pipeline.save_png(orm, os.path.join(OUT_TEX, "gorrim_orm.png"), "gorrim_orm", "Non-Color")
    tex["normal"] = pipeline.save_png(n3, os.path.join(OUT_TEX, "gorrim_normal.png"), "gorrim_normal", "Non-Color")
    return tex


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--no-weapon", action="store_true")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=14800)
    ap.add_argument("--head-tris", type=int, default=5600)
    ap.add_argument("--hand-tris", type=int, default=1150)
    ap.add_argument("--kilt-tris", type=int, default=2400)
    ap.add_argument("--beard-tris", type=int, default=7400)
    ap.add_argument("--weapon-tris", type=int, default=2900)
    ap.add_argument("--save-blend", action="store_true")
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
