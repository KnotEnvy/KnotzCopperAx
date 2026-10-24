"""Build the Ashen Marauder (grunt enemy, Heninger/Longmoan analogue) in 4 colour/gear TIERS with the blender/lib
pipeline.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_enemy_marauder.py -- [options]
Options:
  --preview tiers|heads     clay renders to progress/shots/enemies-art-1/dev/ (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --stage skin              LO meshes + weights + stretch QA only (progress/tmp/marauder_skin_test.glb, iron gear)
  --tiers straw,rust        export only these tiers (default all four)
  --outdir <dir>            staging build: models/ textures/ report go to <dir> (promote by hand)
Default: public/assets/models/enemy_marauder_<tier>.glb (+ enemy_marauder.glb = straw, the untiered stage grunt),
textures public/assets/textures/enemy_marauder_<tier>_*.png, report blender/out/marauder_report.json.

Design: a burly 1.86 m raider, shaved ash-smeared head, soot war-paint mask across the eyes, heavy scowling brow and a
broken nose; bare heavy arms in leather wraps, a sleeveless ragged tunic, a studded belt, a loincloth (front/back
cloth panels + leather tassets on the kilt spring chains), dark leather trousers, fur-cuffed wrapped boots.
One shared body/UV layout; every tier adds rigid/conforming gear and re-bakes the albedo with its palette:
  straw  : pale straw rags, stitched leather cap with stub horns                        (+ weapon_club)
  rust   : rust-red rags, horned iron half-helm, studded leather jerkin, leather L pauldron   (+ weapon_mace)
  violet : violet-dyed cloth, beast-skull helm with long horns, crossed chains, iron R pauldron (+ weapon_mace_flanged)
  iron   : slate cloth, horned great-helm w/ cheek plates, steel cuirass, spiked steel pauldrons both
           sides, knee cops                                                                  (+ weapon_mace_spiked)
Read at game distance: straw = bright/yellow + small head; rust = orange-red + one shoulder; violet = dark purple +
bone-white skull and the widest horns; iron = silver plate + both shoulders (widest silhouette).
"""
import os
import sys
import time
import math
import json
import shutil
import argparse
import copy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np
import bpy

from lib import sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit
for _m in (sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin, charkit):
    importlib.reload(_m)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX, Func)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-1", "dev")
ASSET = "enemy_marauder"

# Proportions (Blender, metres); height matches src/enemies/types/marauder.js (1.86).
MARAUDER = dict(
    height=1.86, head_h=0.236,
    shoulder_x=0.218, shoulder_z=1.50, clav_in_x=0.025,
    hip_x=0.1, hip_joint_z=0.92, pelvis_z=0.97,
    knee_z=0.50, ankle_z=0.085, foot_len=0.27, stance_x=0.115,
    spine_z=1.08, chest_z=1.26, neck_z=1.515, head_base_z=1.625,
    upperarm=0.31, forearm=0.275, hand=0.195,
    arm_down=40.0, arm_fwd=7.0, elbow_bend=12.0,
)
STYLE = dict(muscle=1.22, defin=0.6, fat=0.55, chest=1.16, lats=1.1, traps=1.38, waist=1.16, delts=1.2, arm=1.16,
             forearm=1.32, neck=1.32,
             brow=1.35, jaw=1.34, scowl=1.35, cheek=1.12, chin=1.2, nose_len=1.0, nose_w=1.45, nose_bump=1.9,
             lip=1.02, mouth_w=1.12, eye=1.16, squint=0.92, skull_w=1.05, skull_h=0.97, ear=1.04, fem=0.0)
# C2 r9 (board r8, Fable: 'faces unreadable at the game camera on every tier'): brow 1.45 -> 1.35 (less overhang
# shadow), eye 1.0 -> 1.16 + squint 1.15 -> 0.92 (more sclera = a light dot per eye at ~12 px), mouth_w 1.06 -> 1.12
MATERIALS = ["skin", "eye", "nail", "brow", "cloth", "cloth_trim", "pants", "leather", "leather_dark", "fur",
             "bronze", "iron", "sole"]
GEAR_MATS = ["tleather", "leather_dark", "iron", "steel", "bone", "horn", "cloth", "fur", "bronze", "pelt"]   # r8: +pelt
# C2 r8: steel -> 'plate' (no MICRO entry = no node-side bump / roughness noise). The 'iron' kind's hammered voronoi
# bump (1 cm cells) on low-roughness metal was the board's 'crumpled chrome foil' sparkle.
KINDS = {"cloth": "homespun", "cloth_trim": "homespun", "pants": "cloth", "tleather": "leather", "steel": "plate", "bone": "nail",
         "horn": "nail", "pelt": "fur", "brow": "mane_clean"}   # C2 r9: brow = no node-side strand ribbing
WRIST_CUT_T = 0.90
HAND_CUT_T = 0.84
GRIP_R = 0.021
BELT_Z = 1.0
KILT_CHAIN = 2
LEG_GAP_TOP = 0.80
HEAD_BOX = (V(-0.15, -0.17, 1.585), V(0.15, 0.155, 1.9))
FACE_DENSITY = 2.6
ARM_CORE = 0.9       # r5: anatomy.arm "arm" scale for the core (STYLE arm 1.16 = the r4 tube)
DELT_CORE = 0.72     # C2: the core's 4 deltoid ellipsoids were a ball (radius ~9 cm on a 5 cm arm) -> raider_arm sheets

TIERS = {
    "straw": ["helm_straw", "baldric"],
    "rust": ["helm_rust", "jerkin", "pauldron_leather_L", "harness"],
    "violet": ["helm_skull", "chains", "pauldron_iron_R", "mantle"],
    "iron": ["helm_iron", "cuirass", "pauldron_steel_L", "pauldron_steel_R", "rerebrace_L", "rerebrace_R",
             "kneecop_L", "kneecop_R"],
}
HORNS = []          # (base, tip) of every horn (painter gradient)
# C2 r8 (board r7: 'square texel blocks on the helmet brim / cheek guards'): more texels on the iron rank's steel
UV_DENSITY = {"helm_iron": 1.75, "cuirass": 1.25, "pauldron_steel_L": 1.25, "pauldron_steel_R": 1.25,
              "rerebrace_L": 1.15, "rerebrace_R": 1.15}


# ============================================================================ helpers
def forearm_frame(L, side):
    el, wr = L["elbow_" + side], L["wrist_" + side]
    b = norm(wr - el)
    return el, wr, b, float(np.linalg.norm(wr - el))


def neck_cutter(L, r0=0.078, s=0.35):
    nk = L["neck"]
    c = V(0.0, float(nk[1]) - 0.004, float(nk[2]) - 0.05)
    return Inter(charkit.funnel_cutter(c, r0, s), HalfSpace(nk + V(0, 0.01, -0.06), -norm(V(0, 0.2, 1))))


def arm_cutter(L, side, t=0.02, pad=0.0):
    """Everything on the arm beyond a plane perpendicular to the upper arm near the shoulder joint (armhole)."""
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    c = sh + (el - sh) * t - a * pad
    return Inter(HalfSpace(c, -a), Sphere(el, 0.42)), c, a


def armhole_cutter(L, side, grow=0.0):
    """r3 vest armhole: an upright ellipse round the shoulder joint + everything outboard of the arm root. The old
    plane-perpendicular-to-the-arm cut sliced the whole flank away below the armpit, so every tier showed a bare
    side-on torso (the game camera's view). This keeps the garment over the flank / lats right up to the armpit."""
    sh = L["shoulder_" + side]
    sx = 1.0 if side == "L" else -1.0
    c = sh + V(sx * 0.018, 0.0, -0.005)
    hole = Ellipsoid(c, V(0.1 + grow, 0.13 + grow, ARMHOLE_RZ + grow))
    out = Inter(HalfSpace(V(sx * (0.248 + grow), 0, 0), V(-sx, 0, 0)), HalfSpace(V(0, 0, 0.9), V(0, 0, -1)))
    return Union(hole, out, k=0.03)


ARMHOLE_RZ = 0.12     # r4: 0.135 -> 0.12, the armhole reached so far down the ribs that a raised arm bared a flank slab


def shell(snap, t_out, t_in):
    """Thin conforming shell between two offsets of the body (gear plates: never a solid lump inside the body)."""
    return Diff(Offset(snap, t_out), Offset(snap, t_in))


def horn(S, b0, rel, r0, s=1.0, mat="horn", rings=True, collar=None):
    pts = [b0] + [b0 + V(*p) * s for p in rel]
    P, _ = anatomy.resample(np.array(pts), step=0.007)
    f = np.linspace(0, 1, len(P))
    R = (r0 * (1 - f) ** 0.85 + 0.003) * s
    S.add(Chain(list(P), list(R)), 0.005, mat=mat)
    if rings:
        for j in range(3, int(len(P) * 0.65), 3):
            tn = norm(P[min(j + 1, len(P) - 1)] - P[j - 1])
            S.sub(Torus(P[j], R[j] + 0.0008, 0.0016, basis(tn)[:, [1, 2, 0]]), 0.0014)
    if collar:
        tn = norm(P[2] - P[0])
        S.add(Torus(P[1], R[1] + 0.0015, 0.0055, basis(tn)[:, [1, 2, 0]]), 0.002, mat=collar)
    HORNS.append((P[0], P[-1]))
    return P


# ============================================================================ body
def body_sculpt(L, gear_on=True):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    T = anatomy.Frame(L)
    info = {"arms": {}, "legs": {}}
    anatomy.torso(S, L, STYLE)
    anatomy.E(S, T, (0, -0.035, 1.17), (0.148, 0.14, 0.14), k=0.07)       # raider's gut
    anatomy.E(S, T, (0, 0.06, 1.47), (0.16, 0.1, 0.12), k=0.06)           # heavy upper back / traps
    for s in ("L", "R"):
        # r5: slimmer arm CORE (joints, elbow) -- raider_arm sculpts the bellies on top, so the girth lives in the
        # muscles and the limb narrows at the elbow instead of reading as a constant-width tube
        info["arms"][s] = anatomy.arm(S, L, s, dict(STYLE, arm=ARM_CORE, delts=DELT_CORE))
        info["legs"][s] = anatomy.leg(S, L, s, STYLE)
        anatomy.foot(S, L, s)
    info["head"] = anatomy.head(S, L, STYLE)
    brute_face(S, L, info["head"])
    for s, ai in info["arms"].items():
        raider_arm(S, L, s, ai)
    if not gear_on:
        return S, info
    snap = S.snapshot()
    trousers(S, snap)
    info["kilt"] = kilt_params(S)
    for s in ("L", "R"):
        wrapped_boot(S, snap, L, s)
        el, wr, b, Lf = forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
        gear.bracer(S, snap, L, s, info["arms"][s], t0=0.34, t1=0.975, thick=0.010, plate=False)
    tunic(S, snap, L)
    snap2 = S.snapshot()
    # r4: the baldric is no longer part of the shared body: the rust jerkin and iron cuirass were draped over it (and
    # the belt), copying its ridge + buckle boss and letting its studs poke through the LO shell. It is straw-tier gear
    # now (GEAR['baldric']); torso gear is built over the tunic-level body recorded here (no baldric, no belt).
    info["n_ops_tunic"] = len(S.ops)
    tunic_folds(S, L)          # r5: AFTER the torso-gear snapshot -- jerkin/cuirass/baldric shells never copy them
    gear.belt(S, snap2, L, z=BELT_Z, half=0.046, thick=0.024, buckle=True)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.014)
    return S, info


def _bulge(S, p, dv, axis, along, cross, cross2, protrude, k, M2=None):
    """Muscle mass that protrudes `protrude` beyond the CURRENT surface along dv (ray from the limb axis point p)."""
    dv = norm(dv)
    s = ray_hit(S, p, dv, r_max=0.16)
    c = s - dv * (cross - protrude)
    w = norm(np.cross(axis, dv))
    S.add(Ellipsoid(c, (along, cross, cross2), np.stack([axis, dv, w], axis=1)), k)
    return s


def _sheet(S, at, t0, t1, d0, d1, axis, across, r0, r1, pro0, pro1, k, sq=0.55):
    """C2: flat tapered muscle sheet (squashed RoundCone) lying ON the current surface from at(t0) along d0 to at(t1)
    along d1 -- r0 wide at the origin, r1 at the insertion, protruding pro0 / pro1 beyond the surface."""
    d0, d1 = norm(d0), norm(d1)
    s0 = ray_hit(S, at(t0), d0, r_max=0.16)
    s1 = ray_hit(S, at(t1), d1, r_max=0.16)
    c0 = s0 - d0 * (r0 * sq - pro0)
    c1 = s1 - d1 * (r1 * sq - pro1)
    S.add(RoundCone(c0, c1, r0, r1, squash=(1.0, sq), ref=tuple(norm(across))), k)


def raider_arm(S, L, side, ai):
    """r5 sculpted arm anatomy (board r4: 'smooth bent tubes, painted rings'). Replaces anatomy.arm_details for the
    marauder: tight-blended (k ~1 cm) masses placed relative to the surface so the FORM reads under light alone --
    deltoid in three heads with a V insertion between biceps and triceps, a peaked biceps in front, triceps lateral +
    long heads behind, brachialis peeking out on the outer arm, an elbow point + epicondyle, brachioradialis /
    flexor masses on the forearm. Frame: f = the arm's front (-Y in A-pose), up = its lateral (outer) side.
    (anatomy.arm puts its soft 'biceps' ellipsoid at -f, i.e. behind; these masses are placed explicitly.)"""
    sx = 1.0 if side == "L" else -1.0
    sh, el, wr = L["shoulder_" + side], L["elbow_" + side], L["wrist_" + side]
    a, f, up = anatomy._limb_frame(sh, el, sx)
    Lu = float(np.linalg.norm(el - sh))
    at = lambda t: sh + a * (t * Lu)
    # C2 deltoid (board r5: 'a ball cap that pinches into the narrower arm'): the core's deltoid is shrunk
    # (DELT_CORE) and the muscle is three flat TEARDROP sheets -- broad over the shoulder, tapering down the outer arm
    # to one insertion V at ~45 % of the upper arm, between biceps and triceps -- so the shoulder flows into the arm
    ins = 0.47
    _sheet(S, at, 0.05, ins, up, up, a, f, 0.062, 0.018, 0.024, 0.004, 0.04, sq=0.7)                 # lateral head
    _sheet(S, at, 0.0, ins - 0.03, norm(f * 0.85 + up * 0.5), norm(f * 0.3 + up), a, up, 0.045, 0.014, 0.008,
           0.002, 0.032, sq=0.65)                                                                       # anterior head
    _sheet(S, at, 0.0, ins - 0.03, norm(-f * 0.85 + up * 0.5), norm(-f * 0.3 + up), a, up, 0.047, 0.014, 0.008,
           0.002, 0.032, sq=0.65)                                                                       # posterior head
    # biceps: peaked belly in front, slightly medial; brachialis edge on the outer arm below the deltoid V
    _bulge(S, at(0.6), f - up * 0.15, a, 0.12, 0.04, 0.038, 0.015, 0.014)
    _bulge(S, at(0.72), up + f * 0.55, a, 0.08, 0.03, 0.028, 0.006, 0.012)
    # triceps: lateral head (outer-back, the side the game camera sees) + long head (back-inner)
    _bulge(S, at(0.5), -f * 0.75 + up * 0.7, a, 0.12, 0.038, 0.034, 0.013, 0.014)
    _bulge(S, at(0.44), -f * 0.85 - up * 0.35, a, 0.13, 0.04, 0.036, 0.011, 0.014)
    # elbow: olecranon point behind, a soft crease in front
    _bulge(S, at(0.99), -f, a, 0.026, 0.018, 0.018, 0.006, 0.01)
    anatomy.groove(S, [at(1.0) + norm(f + up * 0.6) * 0.05, at(1.0) + f * 0.05, at(1.0) + norm(f - up * 0.6) * 0.05],
                   0.008, 0.002, k=0.008)
    # forearm (the part above the bracer): brachioradialis / extensor bulge on top, flexor mass underneath
    b, fb, ub = ai["forearm_axis"], ai["forearm_f"], ai["forearm_u"]
    Lf = float(np.linalg.norm(wr - el))
    atf = lambda t: el + b * (t * Lf)
    _bulge(S, atf(0.2), ub + fb * 0.45, b, 0.1, 0.032, 0.028, 0.006, 0.014)
    _bulge(S, atf(0.22), fb - ub * 0.7, b, 0.1, 0.032, 0.028, 0.004, 0.014)
    # veins (barely raised) -- as anatomy.arm_details, kept
    at2, atf2 = ai["at"], ai["atf"]
    anatomy.surf_chain(S, [atf2(0.98, -0.02, 0.02), atf2(0.8, -0.012, 0.03), atf2(0.62, -0.022, 0.04),
                           atf2(0.42, -0.018, 0.045), atf2(0.22, -0.034, 0.04)], 0.0022, depth=0.0013, k=0.0015)
    anatomy.surf_chain(S, [at2(0.95, -0.05, -0.01), at2(0.78, -0.07, -0.006), at2(0.6, -0.08, 0.0),
                           at2(0.42, -0.07, 0.01)], 0.002, depth=0.0012, k=0.0015)


# C2 r9 (board r8: eyes never read at the game camera; the r8 close-up showed sclera slits ~2 mm tall): open each
# eye with a wider almond cut through the lids in front of the eyeball, then re-add the ball (hard union, 'eye') so
# the sclera shows top and bottom of the iris. (w, h, depth) half-sizes in metres, tilt (deg, outer corner up), k.
EYE_OPEN = dict(w=0.0164, h=0.0071, d=0.011, tilt=7.0, k=0.0016, out=0.0028)   # out: shift toward the outer corner


def open_eyes(S, hi):
    H = hi["H"]
    eo = EYE_OPEN
    for ec in hi["eyes"]:
        sx = 1.0 if ec[0] > 0 else -1.0
        er = float(hi["eye_r"])
        c = ec + V(sx * eo["out"], -er * 0.92, 0.0004)      # wraps a little round the side (profile read)
        S.sub(Ellipsoid(c, H.r(eo["w"], eo["d"], eo["h"]), rot(0, sx * -eo["tilt"], 0)), eo["k"])
        S.add(Sphere(ec, er), 0.0, mat="eye")
        # the cut lid walls inside the almond are painted sclera ('eyewhite' on skin): the game mesh coarsens the
        # lids over the ball, and the white almond has to survive that bake at ~12 px heads
        S.paint(Ellipsoid(c, H.r(eo["w"] * 0.98, eo["d"] * 1.15, eo["h"] * 1.0), rot(0, sx * -eo["tilt"], 0)),
                "eyewhite", soft=0.0012, value=1.0)


def brute_face(S, L, hi):
    """Ashen raider face: heavy brows, shaved stubbled scalp + jaw, soot war-paint mask across the eyes."""
    H = hi["H"]
    s = H.s
    open_eyes(S, hi)
    # C2 r9: thick 1.2 -> 1.6 = one bold dark brow bar per eye (flat paint, no strands) above the lit lids
    anatomy.eyebrows(S, H, scowl=1.25, thick=1.8)
    S.paint(Union(Ellipsoid(H(0, -0.045, -0.105), H.r(0.074, 0.07, 0.045)),
                  Ellipsoid(H(0, -0.06, -0.075), H.r(0.06, 0.05, 0.02)), k=0.01), "stubble", soft=0.012, value=0.85)
    # C2: scalp stubble stays behind the hairline (the old ellipsoid reached the brow ridge + nose bridge = 'grime
    # over the eyes' on straw / iron)
    S.paint(Inter(Ellipsoid(H(0, 0.02, 0.035), H.r(0.1, 0.125, 0.085)),
                  HalfSpace(H(0, -0.06, 0.07), norm(V(0, -0.55, -1.0)))), "stubble", soft=0.02, value=0.55)
    # r4 war paint = readable STRIPES (board: the old soot band across eyes + nose turned every face into a dark blob):
    # two raked stripes down each cheek (below the eye, never over it) + one stripe up the forehead from the brow.
    # Eye sockets, brow ridge and nose stay skin so the face reads at game distance. Colour per tier (p_raider_skin).
    # C2: two thin swipes per cheek, raked back from under the eye toward the ear (pale ash on straw / iron read as
    # tusks when they were vertical ovals)
    # C2 r9 (board r8: rust / violet eyes = 'a single dark bar' at the game camera -- the stripes sat right under
    # the eyes and merged with the socket): one swipe per cheek, lower (cheekbone -> jaw corner) and further back
    stripes = []
    for sx in (1, -1):
        for z0, rz in ((-0.07, 0.0042),):
            stripes.append(Ellipsoid(H(sx * 0.084, -0.042, z0), H.r(0.02, 0.06, rz),
                                     basis(V(sx, 0.0, 0.3), V(0, -1, 0))))
    # C2: no forehead stripe (it ran down to the nose bridge); cheek stripes sit a touch lower, off the eye
    S.paint(Union(*stripes), "warpaint", soft=0.003, value=1.0)
    S.paint(Union(Sphere(H(0, -0.105, -0.07), 0.018 * s), Sphere(H(0.05, -0.075, -0.05), 0.02 * s),
                  Sphere(H(-0.05, -0.075, -0.05), 0.02 * s)), "blush", soft=0.02, value=0.5)
    dzm = hi["mouth_dz"]
    S.paint(Union(Ellipsoid(H(0, -0.099, -0.0995 + dzm), H.r(0.024, 0.009, 0.0045)),
                  Ellipsoid(H(0, -0.097, -0.1078 + dzm), H.r(0.021, 0.009, 0.0055)), k=0.003), "lips", soft=0.003)
    # C2 r9: a dark MOUTH LINE along the lip seam, wider than the lips and bowed down at the corners (a scowl) --
    # 'mouth' paint channel (near-black red in p_raider_skin); the stubble clears round it (mouth_c) so it sits on skin
    mw = hi.get("mouth_w", 1.0)
    S.paint(Chain([H(-0.036 * mw, -0.0855, -0.1095 + dzm), H(-0.03 * mw, -0.0905, -0.1075 + dzm), H(-0.017 * mw, -0.097, -0.1044 + dzm),
                   H(0, -0.1015, -0.1036 + dzm), H(0.017 * mw, -0.097, -0.1044 + dzm),
                   H(0.03 * mw, -0.0905, -0.1075 + dzm), H(0.036 * mw, -0.0855, -0.1095 + dzm)],
                  [0.003, 0.0039, 0.0049, 0.0052, 0.0049, 0.0039, 0.003]),
            "mouth", soft=0.0018, value=1.0)
    hi["mouth_c"] = H(0, -0.097, -0.104 + dzm)


def trousers(S, snap):
    reg = Inter(Offset(snap, 0.005), HalfSpace(V(0, 0, BELT_Z + 0.02), V(0, 0, 1)),
                HalfSpace(V(0, 0, 0.28), V(0, 0, -1)), k=0.004)
    S.add(Bounded(Displace(reg, 0.0012, 22.0, 2, seed=5), V(-0.4, -0.3, 0.25), V(0.4, 0.3, BELT_Z + 0.05)), 0.0,
          mat="pants")


def kilt_params(S, z=BELT_Z - 0.012):
    """Loincloth frustum fitted to the actual waist cross-section (under the belt)."""
    c = V(0, 0.01, z)
    xs = ray_hit(S, c, V(1, 0, 0))[0]
    yf = ray_hit(S, c, V(0, -1, 0))[1]
    yb = ray_hit(S, c, V(0, 1, 0))[1]
    cy = (yf + yb) / 2
    rx = float(xs) + 0.012
    ry = (float(yb) - float(yf)) / 2 + 0.012
    return dict(top_z=BELT_Z + 0.015, hem_z=0.58, r_top=rx, r_hem=rx * 1.18, squash=ry / rx, cy=float(cy))


def wrapped_boot(S, snap, L, side, top=0.36):
    """Leather-wrapped boot: shaft hull, 3 tilted wrap straps, thick sole; fur cuff round the calf."""
    an, ball = L["ankle_" + side], L["ball_" + side]
    lo, hi = V(an[0] - 0.17, an[1] - 0.3, -0.05), V(an[0] + 0.17, an[1] + 0.17, top + 0.12)
    hull = RoundCone(an + V(0, 0.004, -0.01), V(an[0], an[1] + 0.012, top + 0.02), 0.058, 0.066, squash=(1.1, 0.95))
    foot_hull = RoundCone(an + V(0, 0.01, -0.04), ball + V(0, 0, 0.004), 0.054, 0.046, squash=(1.0, 1.3),
                          ref=(0, 0, 1))
    body = Union(Offset(snap, 0.009), hull, foot_hull, k=0.03)
    S.add(Bounded(Inter(body, HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004), lo, hi), 0.0, mat="leather")
    for z, tilt in ((0.12, 0.25), (0.2, -0.2), (0.28, 0.22)):
        n = norm(V(0.1 if side == "L" else -0.1, tilt, 1))
        S.add(Bounded(Inter(Offset(body, 0.004), Slab(V(an[0], an[1], z), n, 0.013), k=0.002), lo, hi), 0.0015,
              mat="leather_dark")
    sole = Inter(Offset(body, 0.006), HalfSpace(V(0, 0, 0.03), V(0, 0, 1)), k=0.003)
    S.add(Bounded(sole, lo, hi), 0.002, mat="sole")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))
    ring = charkit.surface_ring(S, V(an[0], an[1] + 0.01, 0), top - 0.005, 0.1, n=48)
    gear.fur_band(S, ring, n=15, rows=2, length=(0.05, 0.075), width=(0.021, 0.028), droop=0.8,
                  seed=11 if side == "L" else 12, mat="fur", k=0.006, roll=0.018)


def tunic(S, snap, L):
    """Sleeveless ragged tunic from the neckline to under the belt; rolled trim on the kept side of every cut."""
    t = 0.008
    nk = L["neck"]
    lo, hi = V(-0.6, -0.4, BELT_Z - 0.12), V(0.6, 0.4, float(nk[2]) + 0.14)
    NC = neck_cutter(L)
    cuts = [NC]
    rims = []
    armcap = []
    for s in ("L", "R"):
        C = armhole_cutter(L, s)
        cuts.append(C)
        rims.append(C)
        # C2: the flatter deltoid sheets dip back inside the armhole ellipse -> keep stray cloth islands off the arm
        sh_, el_ = L["shoulder_" + s], L["elbow_" + s]
        armcap.append(Capsule(sh_ + (el_ - sh_) * 0.12, el_, 0.075))
    cuts += armcap
    C = Union(*cuts)
    below = HalfSpace(V(0, 0, float(nk[2]) + 0.1), V(0, 0, 1))
    bottom = HalfSpace(V(0, 0, BELT_Z - 0.09), V(0, 0, -1))
    reg = Diff(Inter(Offset(snap, t), below, bottom, k=0.004), C, k=0.004)
    S.add(Bounded(Displace(reg, 0.0022, 14.0, 3, seed=31), lo, hi), 0.0, mat="cloth")
    for C in rims:             # rolled hem round the armhole (band just inside the cut)
        band = Diff(Inter(Offset(snap, t + 0.003), Diff(Offset(C, 0.011), C), below, bottom, k=0.0015), Union(*armcap))
        S.add(Bounded(band, lo, hi), 0.0015, mat="cloth_trim")
    band = Diff(Offset(NC, 0.009), NC)
    # C2: keep the neck hem round the neck (its funnel also grazed the lowered shoulder tops -> a trim islet)
    band = Inter(band, Sphere(V(0.0, float(nk[1]), float(nk[2]) - 0.04), 0.17))
    S.add(Bounded(Inter(Offset(snap, t + 0.0035), band, below, k=0.0015), lo, hi), 0.0015, mat="cloth_trim")


def tunic_folds(S, L):
    """r5 sculpted cloth folds (board r4: 'fold-free shells, weave noise but no creases'): drape folds falling from
    the chest over the gut toward the belt, armpit wrinkles radiating from under each armhole, back folds, and short
    broken bunching rolls just above the belt (never a continuous ring). Raised soft tubes, ~3-4 mm proud; the torso
    gear shells (>= 4 mm standoff) are built on the pre-fold body and cover them on rust / iron."""
    B = BELT_Z
    folds = []     # (points, max radius, protrusion): broad soft ridges -- a wide tube sunk almost its radius, so
    #                only a shallow crown shows and both ends (smaller radius) sink away = tapered fold
    for sx in (1.0, -1.0):
        folds += [
            ([V(sx * 0.1, -0.2, 1.31), V(sx * 0.08, -0.22, 1.19), V(sx * 0.04, -0.2, B + 0.07)], 0.022, 0.0035),
            ([V(sx * 0.165, -0.15, 1.27), V(sx * 0.15, -0.19, 1.16), V(sx * 0.12, -0.2, B + 0.07)], 0.018, 0.003),
            ([V(sx * 0.2, -0.03, 1.33), V(sx * 0.19, -0.09, 1.25), V(sx * 0.17, -0.13, 1.17)], 0.012, 0.0025),   # armpit
            ([V(sx * 0.2, 0.04, 1.32), V(sx * 0.19, 0.1, 1.24), V(sx * 0.17, 0.14, 1.16)], 0.012, 0.0025),
            ([V(sx * 0.09, 0.2, 1.36), V(sx * 0.075, 0.215, 1.22), V(sx * 0.06, 0.205, B + 0.07)], 0.022, 0.0035),  # back
        ]
    folds.append(([V(0.0, -0.225, 1.2), V(0.005, -0.22, 1.12), V(-0.005, -0.21, B + 0.065)], 0.016, 0.003))
    for pts, r, pro in folds:
        anatomy.surf_chain(S, pts, [r * 0.45, r, r * 0.55], depth=r - pro, k=0.01, mat="cloth")
    # broken bunching rolls above the belt (belt top ~ BELT_Z + 0.046)
    rng = np.random.RandomState(11)
    for a0 in (-2.6, -1.7, -0.9, -0.15, 0.65, 1.45, 2.3, 3.0):
        a = a0 + rng.uniform(-0.12, 0.12)
        span = rng.uniform(0.32, 0.5)
        z0 = B + 0.06 + rng.uniform(0.0, 0.012)
        tilt = rng.uniform(-0.012, 0.012)
        pts = [V(math.sin(a + u) * 0.18, 0.01 - math.cos(a + u) * 0.16, z0 + tilt * (u / span))
               for u in np.linspace(-span / 2, span / 2, 3)]
        anatomy.surf_chain(S, pts, [0.006, 0.013, 0.006], depth=0.0095, k=0.008, mat="cloth")


def baldric_gear(snapT, L):
    """r4 straw-tier gear: diagonal studded leather baldric (left shoulder -> right hip, front + back) as a thin
    strap shell on the tunic-level body + iron studs (was baked into the shared body for every tier)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="tleather")
    pts_f = [V(0.13, -0.02, 1.52), V(0.07, -0.16, 1.4), V(-0.03, -0.18, 1.25), V(-0.12, -0.15, 1.1),
             V(-0.17, -0.08, 1.02)]
    pts_b = [V(0.13, 0.02, 1.52), V(0.07, 0.17, 1.4), V(-0.04, 0.18, 1.25), V(-0.13, 0.14, 1.1),
             V(-0.17, 0.08, 1.02)]
    lo, hi = V(-0.4, -0.35, BELT_Z - 0.06), V(0.4, 0.35, 1.7)
    for pts in (pts_f, pts_b):
        P, _ = anatomy.resample(grid_project(snapT, np.array(pts)), step=0.012)
        P = grid_project(snapT, P)
        S.add(Bounded(Inter(shell(snapT, 0.011, -0.004), Chain(list(P), 0.028), k=0.0025), lo, hi), 0.0,
              mat="tleather")
        for p in P[2:-2:3]:
            S.add(Sphere(grid_project(snapT, p[None], 0.012)[0], 0.0055), 0.001, mat="iron")
    return S


def grid_project(snap, P, offset=0.0, iters=12, e=0.002):
    """Move points onto snap's iso-surface d = offset along the (finite-difference) gradient -- works on a GridSDF
    (radial projection bends straps outward over the near-horizontal shoulder top)."""
    P = np.array(P, float)
    for _ in range(iters):
        X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
        d = snap.d(X, Y, Z).ravel() - offset
        g = np.stack([(snap.d(X + e, Y, Z) - snap.d(X - e, Y, Z)).ravel(), (snap.d(X, Y + e, Z) - snap.d(X, Y - e, Z)).ravel(),
                      (snap.d(X, Y, Z + e) - snap.d(X, Y, Z - e)).ravel()], 1)
        g /= np.maximum(np.linalg.norm(g, axis=1)[:, None], 1e-9)
        P -= g * np.clip(d, -0.05, 0.05)[:, None]
    return P


def baldric(S, snap, L):
    """Diagonal studded leather baldric: left shoulder -> right hip, front and back."""
    pts_f = [V(0.13, -0.02, 1.52), V(0.07, -0.16, 1.4), V(-0.03, -0.18, 1.25), V(-0.12, -0.15, 1.1),
             V(-0.17, -0.08, 1.02)]
    pts_b = [V(0.13, 0.02, 1.52), V(0.07, 0.17, 1.4), V(-0.04, 0.18, 1.25), V(-0.13, 0.14, 1.1),
             V(-0.17, 0.08, 1.02)]
    for pts in (pts_f, pts_b):
        P = gear.strap(S, snap, pts, width=0.056, thick=0.012, mat="leather")
        gear.studs_on(S, list(P[3:-3:5]), r=0.0055, mat="iron", lift=0.012)


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip" if side == "R" else "relaxed", STYLE, grip_r=GRIP_R)
    anatomy.hand_details(S, L, side)
    sc = L["P"]["hand"] / 0.2
    W = L["wrist_" + side]
    h, n = L["hand_h_" + side], L["hand_n_" + side]
    S.paint(Sphere(W + h * 0.1 * sc - n * 0.012, 0.035), "blush", soft=0.02, value=0.6)
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


def loincloth(kp):
    """Front + back cloth panels (ragged torn hems) and 4 leather tassets on an elliptic frustum."""
    S = Sculpt(materials=MATERIALS, default_mat="cloth")
    rng = np.random.RandomState(7)
    cy = kp["cy"]
    panels = [(0.0, 0.5, "cloth", kp["hem_z"], 0), (math.pi, 0.6, "cloth", kp["hem_z"] + 0.03, 0),
              (1.15, 0.27, "leather", 0.74, 1), (-1.15, 0.27, "leather", 0.74, 1),
              (1.95, 0.27, "leather", 0.75, 1), (-1.95, 0.27, "leather", 0.75, 1)]
    for a_c, a_half, mat, hz, layer in panels:
        rt = kp["r_top"] + 0.004 * layer
        rh = kp["r_hem"] + 0.008 * layer
        cone = RoundCone(V(0, cy, kp["top_z"] + 0.05), V(0, cy + 0.012, hz - 0.08), rt - 0.012, rh + 0.03,
                         squash=(kp["squash"], 1.0))
        th = 0.0055 if mat == "cloth" else 0.0065
        sh = Shell(cone, th)
        d0 = V(math.sin(a_c - a_half), -math.cos(a_c - a_half), 0)
        d1 = V(math.sin(a_c + a_half), -math.cos(a_c + a_half), 0)
        n0 = norm(np.cross(V(0, 0, 1), d0)) * -1.0
        n1 = norm(np.cross(V(0, 0, 1), d1))
        wc = V(0, cy, 0)
        reg = Inter(sh, HalfSpace(wc, n0), HalfSpace(wc, n1), HalfSpace(V(0, 0, hz), V(0, 0, -1)),
                    HalfSpace(V(0, 0, kp["top_z"]), V(0, 0, 1)), k=0.005)
        lo, hi = V(-0.45, -0.45, hz - 0.06), V(0.45, 0.45, kp["top_z"] + 0.04)
        amp = 0.0035 if mat == "cloth" else 0.0012
        S.add(Bounded(Displace(reg, amp, 16.0, 3, seed=40 + int(a_c * 10)), lo, hi), 0.0, mat=mat)
        if mat == "cloth":         # torn hem notches (wide, soft: no sub-voxel slivers)
            for i in range(5):
                a = a_c + (i - 2) / 2.2 * a_half * 0.9 + rng.uniform(-0.08, 0.08)
                r = rh + 0.03
                p = V(math.sin(a) * r, cy - math.cos(a) * r * kp["squash"], hz + rng.uniform(-0.01, 0.005))
                S.sub(Ellipsoid(p, V(0.024, 0.024, rng.uniform(0.03, 0.055)), rot(0, 0, math.degrees(-a))), 0.006)
        else:                      # iron studs down the tasset
            for zz in np.linspace(kp["top_z"] - 0.05, hz + 0.03, 4):
                f = (kp["top_z"] - zz) / (kp["top_z"] - hz)
                r = rt + (rh - rt) * f + th + 0.001
                S.add(Sphere(V(math.sin(a_c) * r, cy - math.cos(a_c) * r * kp["squash"], zz), 0.0065), 0.001,
                      mat="iron")
    return S


# ============================================================================ tier gear
def head_dome(S, snapH, H, t, c1, c2, mat, exclude_ears=True, disp=0.0):
    nrm = norm(np.cross(V(1, 0, 0), c2 - c1))
    if nrm[2] < 0:
        nrm = -nrm
    ears = [Sphere(H(sx * 0.081, 0.013, -0.036), 0.038 * H.s) for sx in (1, -1)]
    dome = Union(Offset(snapH, t), Ellipsoid(H(0, 0.008, 0.016), H.r(0.1 + t, 0.121 + t, 0.108 + t)), k=0.02)
    keep = Sphere(H(0, 0.01, 0.0), 0.17 * H.s)
    reg = Inter(dome, HalfSpace(c1, -nrm), keep, k=0.004)
    if exclude_ears:
        for e in ears:
            reg = Diff(reg, e, k=0.006)
    if disp:
        reg = Displace(reg, disp, 40.0, 2, seed=23)
    lo, hi_ = H(-0.22, -0.22, -0.14), H(0.22, 0.22, 0.2)
    S.add(Bounded(reg, lo, hi_), 0.0, mat=mat)
    return dome, nrm, keep, ears, (lo, hi_)


def rivet_ring(S, H, dome, c1, nrm, n=20, off=0.011, r=0.0045, mat="iron", skip=0.93):
    hc = H(0, 0.01, 0.02)
    cb = c1 + nrm * off
    hcp = hc - nrm * float(np.dot(hc - cb, nrm))
    for i in range(n):
        a = (i + 0.5) / n * 2 * math.pi
        if abs(math.sin(a)) > skip:
            continue
        d = V(math.sin(a), -math.cos(a), 0)
        d = norm(d - nrm * float(np.dot(d, nrm)))
        p = ray_hit(S, hcp, d, r_max=0.3)
        S.add(Sphere(p, r), 0.001, mat=mat)


def helm_straw(snapH, H):
    """Stitched leather skull-cap, rolled brim, two stubby cow horns."""
    S = Sculpt(materials=GEAR_MATS, default_mat="tleather")
    s = H.s
    c1, c2 = H(0, -0.1, 0.048), H(0, 0.112, -0.03)
    dome, nrm, keep, ears, (lo, hi_) = head_dome(S, snapH, H, 0.007, c1, c2, "tleather", disp=0.0008)
    band = Inter(Offset(dome, 0.004), Slab(c1 + nrm * 0.009, nrm, 0.009), keep, k=0.002)
    for e in ears:
        band = Diff(band, e, k=0.004)
    S.add(Bounded(band, lo, hi_), 0.0015, mat="leather_dark")
    top = H(0, 0.008, 0.125)
    for az in (0, 90, 180, 270):             # stitched seams (soft grooves)
        a = math.radians(az)
        d = V(math.sin(a), -math.cos(a), 0)
        pts = np.array([H(0, 0.008, 0.02) + d * 0.13 * s + (top - H(0, 0.008, 0.02) - d * 0.13 * s) * f
                        for f in np.linspace(0.05, 0.95, 10)])
        P = S.project(pts, offset=0.0)
        S.sub(Chain(list(P), 0.0028), 0.004)
    for sx in (1, -1):
        b0 = S.project(np.array([H(sx * 0.075, -0.035, 0.07)]), offset=-0.004)[0]
        horn(S, b0, [(sx * 0.03, -0.004, 0.008), (sx * 0.055, -0.014, 0.03), (sx * 0.064, -0.028, 0.058)], 0.019,
             s=s, collar="leather_dark")
    return S


def helm_rust(snapH, H):
    """Horned iron half-helm: dome, riveted brow band, 2 ribs, forward-curving bull horns in iron collars."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    c1, c2 = H(0, -0.103, 0.03), H(0, 0.112, -0.035)
    dome, nrm, keep, ears, (lo, hi_) = head_dome(S, snapH, H, 0.009, c1, c2, "iron", disp=0.0009)
    band = Inter(Offset(dome, 0.0045), Slab(c1 + nrm * 0.012, nrm, 0.012), keep, k=0.002)
    for e in ears:
        band = Diff(band, e, k=0.004)
    S.add(Bounded(band, lo, hi_), 0.0015, mat="iron")
    rivet_ring(S, H, dome, c1, nrm, n=20, off=0.012)
    hc = H(0, 0.01, 0.02)
    top = H(0, 0.008, 0.125)
    for az in (0, 180):
        a = math.radians(az)
        d = V(math.sin(a), -math.cos(a), 0)
        base = hc + d * 0.2
        base = base - nrm * float(np.dot(base - (c1 + nrm * 0.024), nrm))
        P = S.project(np.array([base + (top - base) * f for f in np.linspace(0, 1, 9)]), offset=0.0)
        S.add(Chain(list(P[:-1]), 0.0065, squash=(1.8, 1.0), ref=(0, 0, 1)), 0.002, mat="iron")
    for (x, y, z, r) in ((0.05, -0.06, 0.09, 0.017), (-0.07, 0.05, 0.07, 0.014)):   # dents
        p = S.project(np.array([H(x, y, z)]), offset=0.0)[0]
        S.sub(Sphere(p + norm(p - hc) * r * 0.85, r), 0.005)
    for sx in (1, -1):
        b0 = S.project(np.array([H(sx * 0.098, -0.01, 0.05)]), offset=-0.004)[0]
        horn(S, b0, [(sx * 0.04, -0.01, 0.006), (sx * 0.085, -0.035, 0.018), (sx * 0.112, -0.07, 0.045),
                     (sx * 0.114, -0.105, 0.085), (sx * 0.1, -0.125, 0.112)], 0.026, s=s, collar="iron")
    return S


def helm_skull(snapH, H):
    """Beast-skull helm: a bleached bull cranium worn over the scalp (frontal plate with brow ridges and dark eye
    sockets above the wearer's brows, a broken snout stub), long horns sweeping out and up; violet cloth wrap at
    the back."""
    S = Sculpt(materials=GEAR_MATS, default_mat="bone")
    s = H.s
    c1, c2 = H(0, -0.1, 0.042), H(0, 0.11, -0.05)
    dome, nrm, keep, ears, (lo, hi_) = head_dome(S, snapH, H, 0.012, c1, c2, "bone", disp=0.0012)
    S.add(Ellipsoid(H(0, -0.098, 0.072), H.r(0.074, 0.034, 0.05)), 0.02, mat="bone")         # frontal plate
    S.add(RoundCone(H(0, -0.112, 0.07), H(0, -0.168, 0.048), 0.03 * s, 0.021 * s, squash=(1.35, 1.0),
                    ref=(0, 0, 1)), 0.014, mat="bone")                                        # snout stub
    S.sub(Inter(HalfSpace(H(0, -0.166, 0.0), -norm(V(0, -1, -0.25))), Sphere(H(0, -0.175, 0.045), 0.05 * s)),
          0.004)                                                                              # broken-off end
    for sx in (1, -1):
        S.add(Chain([H(sx * 0.02, -0.126, 0.083), H(sx * 0.045, -0.122, 0.09), H(sx * 0.068, -0.108, 0.082)],
                    0.011 * s), 0.008, mat="bone")                                             # brow ridges
        S.sub(Ellipsoid(H(sx * 0.044, -0.132, 0.071), H.r(0.017, 0.02, 0.014)), 0.006)       # eye sockets
        S.sub(Ellipsoid(H(sx * 0.011, -0.176, 0.046), H.r(0.006, 0.01, 0.007)), 0.003)       # nostril pits
        b0 = S.project(np.array([H(sx * 0.085, -0.05, 0.075)]), offset=-0.006)[0]
        horn(S, b0, [(sx * 0.05, -0.004, 0.004), (sx * 0.12, -0.02, 0.028), (sx * 0.185, -0.05, 0.085),
                     (sx * 0.205, -0.085, 0.155), (sx * 0.19, -0.115, 0.205), (sx * 0.165, -0.13, 0.235)],
             0.034, s=s, mat="bone")
    # cracks
    for (a, b) in ((H(0.03, -0.12, 0.1), H(0.05, -0.08, 0.12)), (H(-0.05, -0.02, 0.12), H(-0.02, 0.03, 0.125))):
        P = S.project(np.array([a, (a + b) / 2, b]), offset=0.0)
        S.sub(Chain(list(P), 0.0022), 0.002)
    # violet cloth wrap knotted at the back of the skull
    back = Inter(Offset(dome, 0.004), Slab(c2 + nrm * 0.018, nrm, 0.017), HalfSpace(H(0, 0.02, 0), V(0, -1, 0)),
                 keep, k=0.004)
    for e in ears:
        back = Diff(back, e, k=0.004)
    S.add(Bounded(Displace(back, 0.0015, 30.0, 2, seed=8), lo, hi_), 0.003, mat="cloth")
    kn = ray_hit(S, H(0, 0.0, -0.01), V(0, 1, -0.2))
    S.add(Ellipsoid(kn + V(0, 0.008, 0), H.r(0.022, 0.016, 0.018)), 0.005, mat="cloth")
    for sx in (1, -1):
        S.add(Chain([kn + V(sx * 0.008, 0.01, -0.01), kn + V(sx * 0.02, 0.03, -0.06), kn + V(sx * 0.024, 0.036,
                                                                                            -0.1)],
                    [0.012, 0.01, 0.007], squash=(0.45, 1.0), ref=(0, 1, 0)), 0.004, mat="cloth")
    return S


def helm_iron(snapH, H):
    """Horned great half-helm in bright steel: dome with a raised crest, riveted brow band, hinged cheek plates,
    huge dark horns in steel collars."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    s = H.s
    # C2 r8 (board r7: faces = dark smudges under the brow): brim raised 1.2 cm, band 1 mm thinner
    c1, c2 = H(0, -0.104, 0.03), H(0, 0.112, -0.05)
    dome, nrm, keep, ears, (lo, hi_) = head_dome(S, snapH, H, 0.011, c1, c2, "steel", disp=0.0)   # r8: smooth plate
    band = Inter(Offset(dome, 0.004), Slab(c1 + nrm * 0.012, nrm, 0.012), keep, k=0.002)
    for e in ears:
        band = Diff(band, e, k=0.004)
    S.add(Bounded(band, lo, hi_), 0.0015, mat="steel")
    rivet_ring(S, H, dome, c1, nrm, n=22, off=0.013, r=0.0048, mat="iron")
    crest = S.project(np.array([H(0, -0.1 + 0.21 * f, 0.03 + 0.1 * math.sin(math.pi * (0.2 + 0.7 * f)))
                                for f in np.linspace(0, 1, 16)]), offset=0.0)
    S.add(Chain(list(crest), 0.008, squash=(0.55, 1.0), ref=(1, 0, 0)), 0.004, mat="steel")
    for sx in (1, -1):
        # C2 r9 (board r8: iron face = a near-black blob under the brim): cheek plates 1.4 cm further back and 1 cm
        # shorter, so the 3/4 game camera sees the cheek, eye and mouth instead of a steel plate edge
        c = H(sx * 0.094, -0.036, -0.047)
        S.add(RoundBox(c, H.r(0.0055, 0.026, 0.042), rot(0, sx * 7, sx * -10), r=0.004 * s), 0.008, mat="steel")
        for dz in (0.03, -0.035):
            S.add(Sphere(c + V(sx * 0.006, -0.012, dz) * s, 0.0045), 0.001, mat="iron")
        b0 = S.project(np.array([H(sx * 0.1, 0.0, 0.05)]), offset=-0.004)[0]
        horn(S, b0, [(sx * 0.05, 0.0, 0.01), (sx * 0.13, -0.01, 0.05), (sx * 0.18, -0.02, 0.13),
                     (sx * 0.19, -0.04, 0.22), (sx * 0.17, -0.07, 0.285)], 0.036, s=s, collar="steel")
    return S


def pauldron(snapF, L, side, kind):
    """Shoulder plate on the deltoid (rigid to upperarm): a thin shell at a standoff, cut by a sphere round the cap
    and a plane through the arm (no armpit lump); lames below; studs / spikes ray-cast onto the piece."""
    mats = GEAR_MATS
    S = Sculpt(materials=mats, default_mat="iron")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    cap = sh + a * 0.05 + up * 0.02
    if kind == "leather":
        mat, t, R = "tleather", 0.018, 0.13
    elif kind == "iron":
        mat, t, R = "iron", 0.02, 0.135
    else:       # C2 r7: iron rank = the bulkiest shoulders (ref: stacked blackened pauldrons) -- bigger, thicker
        mat, t, R = "steel", 0.03, 0.188
        cap = cap + up * 0.012
    lo, hi = cap - 0.26, cap + 0.26
    plane = HalfSpace(sh - up * 0.035, -up)         # keep above a plane through the arm, below the cap
    inner = HalfSpace(V(float(sh[0]) - sx * 0.07, 0, 0), V(-sx, 0, 0))   # clear of the neck
    body = Inter(shell(snapF, t, t - 0.009), Sphere(cap, R), plane, inner, k=0.004)
    if kind != "steel":                 # C2 r8: the steel plate stays smooth (one broad specular per lame)
        body = Displace(body, 0.0008, 30.0, 2, seed=3)
    S.add(Bounded(body, lo, hi), 0.0, mat=mat)
    n_lames = {"leather": 3, "iron": 2}.get(kind, 3)
    for i in range(n_lames):                         # overlapping lames down the upper arm
        c = sh + a * (0.1 + (0.05 if kind == "steel" else 0.045) * i)
        lame = Inter(shell(snapF, t + 0.004 + 0.002 * i, t - 0.004 + 0.002 * i), Slab(c, a, 0.024),
                     Sphere(cap, R + 0.03), plane, k=0.003)
        S.add(Bounded(lame, lo, hi), 0.0015, mat=mat)
    # rim roll along the lower lame + studs / spikes on the crown
    hitc = sh - a * 0.02 + up * 0.0
    if kind == "steel":
        # C2 r7: rolled crest over the crown (front -> back) = a crisp specular edge line on the dark plate
        side_v = norm(np.cross(a, up)) * sx
        crest = []
        for f in np.linspace(-1.0, 1.0, 11):
            d = norm(up * 0.95 + side_v * f * 0.9 + a * 0.05 + V(sx * 0.25, 0, 0))
            crest.append(trace_in(S, sh + a * 0.04, d) + d * 0.004)
        S.add(Chain(crest, 0.0085, squash=(0.6, 1.0), ref=tuple(norm(a))), 0.005, mat="steel")
        for j, (da, du) in enumerate(((0.03, 0.9), (0.09, 0.7), (-0.03, 0.75))):
            d = norm(up * du + a * da + V(sx * 0.35, 0, 0))
            p = trace_in(S, sh + a * 0.04, d)
            S.add(RoundCone(p - d * 0.006, p + d * (0.075 - 0.015 * j), 0.017, 0.0022), 0.004, mat="steel")
    else:
        for j in range(7):
            ang = -1.0 + j * (2.0 / 6)
            side_v = norm(np.cross(a, up)) * sx
            d = norm(up * math.cos(ang) * 0.9 + side_v * math.sin(ang) * 0.9 + a * 0.15)
            p = trace_in(S, sh + a * 0.05, d)
            S.add(Sphere(p, 0.0068), 0.001, mat="iron" if kind == "leather" else "bronze")
    if kind == "iron":           # chain hanging off the pauldron edge
        for j in range(3):                       # riveted edge
            d = norm(up * 0.3 + V(sx * 0.9, 0, 0) + V(0, (j - 1) * 0.6, 0))
            S.add(Sphere(trace_in(S, sh + a * 0.12, d), 0.007), 0.001, mat="bronze")
    return S


def links(S, pts, link_len=0.04, wire=0.0072, mat="iron"):
    """Chunky interlocking chain: alternating torus links along a polyline (HI bake source; the LO is a tube)."""
    P, _ = anatomy.resample(np.array(pts), step=0.004)
    seg = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    sp = link_len * 0.55
    n = max(2, int(seg[-1] / sp))
    for i in range(n):
        t = (i + 0.5) / n * seg[-1]
        c = V(*[np.interp(t, seg, P[:, k]) for k in range(3)])
        j = min(int(np.searchsorted(seg, t)), len(P) - 1)
        tn = norm(P[min(j + 1, len(P) - 1)] - P[max(j - 1, 0)])
        M0 = basis(tn)
        M = M0 if i % 2 == 0 else np.stack([M0[:, 0], M0[:, 2], -M0[:, 1]], axis=1)
        S.add(Torus(c, link_len * 0.36, wire, M), 0.0015, mat=mat)
    return link_len * 0.36 + wire


def chains(snapF, L):
    """Two heavy chains crossed over the chest (front + back) through a big iron ring on the sternum. Returns
    (HI sculpt with real links, LO sculpt = smooth tubes on the same paths; the bake carries the links)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    Slo = Sculpt(materials=GEAR_MATS, default_mat="iron")
    ring_c = S_proj(snapF, V(0, -0.1, 1.32), V(0, -1, 0)) + V(0, -0.024, 0)
    ring = Torus(ring_c, 0.036, 0.0085, basis(V(0, -1, 0))[:, [1, 2, 0]])
    S.add(ring, 0.0, mat="iron")
    Slo.add(ring, 0.0, mat="iron")
    for sx in (1, -1):
        raw_f = [V(sx * 0.14, -0.03, 1.53), V(sx * 0.1, -0.15, 1.44), V(sx * 0.03, -0.2, 1.345),
                 V(-sx * 0.1, -0.16, 1.18), V(-sx * 0.16, -0.1, 1.07)]
        raw_b = [V(sx * 0.14, 0.03, 1.53), V(sx * 0.07, 0.17, 1.38), V(-sx * 0.07, 0.17, 1.2),
                 V(-sx * 0.16, 0.1, 1.07)]
        for raw in (raw_f, raw_b):
            P = snap_path(snapF, raw, 0.02)
            R = links(S, list(P), 0.04, 0.0072)
            Slo.add(Chain(list(P), R * 0.92), 0.004, mat="iron")
    return S, Slo


def S_proj(snap, c, d):
    """Surface point of a snapshot along direction d from an interior point c (bisection on the sign)."""
    d = norm(V(d))
    a, b = 0.0, 0.5
    for _ in range(40):
        m = (a + b) / 2
        if snap.d(*(c + d * m)[:, None]) [0] < 0:
            a = m
        else:
            b = m
    return c + d * a


def snap_path(snap, raw, lift):
    """Project raw points radially (from the body axis at their height) onto the snapshot surface + lift."""
    out = []
    for p in raw:
        c = V(0, 0.01, p[2])
        d = norm(V(p[0], p[1] - 0.01, 0))
        out.append(S_proj(snap, c, d) + d * lift)
    P, _ = anatomy.resample(np.array(out), step=0.02)
    res = []
    for p in P:
        c = V(0, 0.01, p[2])
        d = norm(V(p[0], p[1] - 0.01, 0))
        res.append(S_proj(snap, c, d) + d * lift)
    return np.array(res)


def jerkin(snapF, L):
    """Studded leather jerkin (rust): thin shell from the belt to the neck, armholes, studs in rows, lacing."""
    S = Sculpt(materials=GEAR_MATS, default_mat="tleather")
    nk = L["neck"]
    NC = neck_cutter(L, r0=0.086)
    cuts = [NC] + [armhole_cutter(L, s, grow=0.006) for s in ("L", "R")]
    # r4: on the tunic-level body (no baldric / belt in the field) -> a smooth shell; bottom edge tucks under the belt
    # (belt surface ~0.024 out, jerkin 0.019) instead of draping over it
    reg = Diff(Inter(shell(snapF, 0.019, 0.008), HalfSpace(V(0, 0, float(nk[2]) + 0.1), V(0, 0, 1)),
                     HalfSpace(V(0, 0, BELT_Z), V(0, 0, -1)), k=0.004), Union(*cuts), k=0.004)
    lo, hi = V(-0.6, -0.4, BELT_Z - 0.03), V(0.6, 0.4, float(nk[2]) + 0.14)
    S.add(Bounded(Displace(reg, 0.0012, 18.0, 2, seed=17), lo, hi), 0.0, mat="tleather")
    band = Diff(Offset(NC, 0.012), NC)
    S.add(Bounded(Inter(Offset(snapF, 0.024), band, HalfSpace(V(0, 0, float(nk[2]) + 0.1), V(0, 0, 1)), k=0.002),
                  lo, hi), 0.002, mat="leather_dark")
    # studs: rows on the chest and back (ray-cast onto the jerkin surface)
    c0 = V(0, 0.01, 0)
    for z in np.arange(BELT_Z + 0.08, float(nk[2]) - 0.06, 0.055):
        for az in np.linspace(-1.0, 1.0, 7):
            for back in (0, 1):
                a = az + (math.pi if back else 0.0)
                d = V(math.sin(a), -math.cos(a), 0)
                p = trace_in(S, V(c0[0], c0[1], z), d)
                if np.linalg.norm(p - V(0, 0.01, z)) > 0.36 or np.linalg.norm(p - V(0, 0.01, z)) < 0.05:
                    continue
                S.add(Sphere(p, 0.0062), 0.001, mat="iron")
    return S


def harness(snapF, L):
    """C2 r8 rust rank value accent (board r7: straw and rust merge in greyscale -- same bare arms + pose): a crossed
    near-black leather harness over the orange jerkin, front and back (two 5 cm straps shoulder -> opposite hip), a
    rusted iron ring where they cross on the chest, studs along the straps. Body weights transferred."""
    S = Sculpt(materials=GEAR_MATS, default_mat="leather_dark")
    lo, hi = V(-0.4, -0.35, BELT_Z - 0.06), V(0.4, 0.35, 1.7)
    for sy in (-1, 1):                 # front / back
        for sx in (1, -1):
            pts = [V(sx * 0.13, sy * 0.02, 1.53), V(sx * 0.08, sy * 0.16, 1.41), V(sx * 0.0, sy * 0.19, 1.27),
                   V(-sx * 0.1, sy * 0.16, 1.12), V(-sx * 0.165, sy * 0.09, 1.02)]
            P, _ = anatomy.resample(grid_project(snapF, np.array(pts), 0.02), step=0.012)
            P = grid_project(snapF, P, 0.02)
            S.add(Bounded(Inter(shell(snapF, 0.029, 0.012), Chain(list(P), 0.025), k=0.0025), lo, hi), 0.0,
                  mat="leather_dark")
            for p in P[3:-2:4]:
                if abs(p[2] - 1.27) < 0.05:
                    continue
                S.add(Sphere(grid_project(snapF, p[None], 0.029)[0], 0.0052), 0.001, mat="iron")
        c = grid_project(snapF, np.array([V(0, sy * 0.2, 1.27)]), 0.031)[0]
        n = S.grad(c[None])[0]
        S.add(Torus(c + n * 0.002, 0.024, 0.0068, basis(n)[:, [1, 2, 0]]), 0.002, mat="iron")
    return S


# C2 r9 (board r8, Sol + Muse: 'two smooth hemispherical chest domes with a centre cleavage seam -- a moulded bodice /
# bra-like cuirass'): the shell used to follow the sculpted pecs. Now it follows a FACETED FORM = the body unioned
# with a front wedge of flat planes (metres, body frame, front = -Y): a vertical medial keel (KEEL_A = how fast each
# half falls back from the centre line -> a shallow V in plan), an upper pectoral plane tilted to face the sky, a
# lower belly plane tilted down (they meet at the forward-most crease CREASE_Z), a steep collar plane up to the
# throat and a side bevel turning into the flanks. One plate per facet -> broad flat specular shapes + value steps.
CUIRASS_FORM = dict(yk=-0.203, zc=1.30, a=0.24, tu=0.12, tl=0.12, cy=-0.165, cz=1.44, ct=1.2, sx=0.12, sy=-0.172,
                    st=1.1, k_ul=0.012, k_side=0.01, k_co=0.015)


def cuirass_planes(X, Y, Z):
    """Signed distances (< 0 = behind / inside) to the r9 cuirass front facets: (upper, lower, collar, side)."""
    f = CUIRASS_FORM
    ax = np.abs(X)
    up = (f["yk"] + f["a"] * ax + f["tu"] * (Z - f["zc"]) - Y) / math.sqrt(1 + f["a"] ** 2 + f["tu"] ** 2)
    lw = (f["yk"] + f["a"] * ax + f["tl"] * (f["zc"] - Z) - Y) / math.sqrt(1 + f["a"] ** 2 + f["tl"] ** 2)
    co = (f["cy"] + f["a"] * ax + f["ct"] * (Z - f["cz"]) - Y) / math.sqrt(1 + f["a"] ** 2 + f["ct"] ** 2)
    sd = (f["sy"] + f["st"] * (ax - f["sx"]) - Y) / math.sqrt(1 + f["st"] ** 2)
    return up, lw, co, sd


def cuirass_form(snapF, L):
    """Body + the faceted front wedge (smooth union): the surface the r9 cuirass shell is offset from."""
    nk = L["neck"]

    def wedge(X, Y, Z):
        f = CUIRASS_FORM
        up, lw, co, sd = cuirass_planes(X, Y, Z)
        # the keel V stays crisp (|x| inside each plane); the pec / belly crease and the bevels are rounded
        d = sdf.smax(sdf.smax(sdf.smax(up, lw, f["k_ul"]), co, f["k_co"]), sd, f["k_side"])
        # front half only, and never wider than the waist (the bevel plane would run out past the flanks as a sliver)
        d = sdf.smax(d, np.maximum(Y + 0.06, np.abs(X) - 0.165), 0.02)
        d = np.maximum(d, np.maximum(BELT_Z - 0.04 - Z, Z - (float(nk[2]) + 0.02)))
        return d
    W = Func(wedge, V(-0.3, -0.3, BELT_Z - 0.06), V(0.3, 0.06, float(nk[2]) + 0.04))
    lo, hi = snapF.lo, snapF.hi
    return Bounded(Union(snapF, W, k=0.02), lo, hi)


def cuirass(snapF, L):
    """Steel cuirass (iron tier): front + back plates at a standoff, raised medial ridge, riveted edges; faulds.
    C2 r9: offset from the faceted cuirass_form (flat pectoral / belly / collar planes + keel), not the sculpted pecs."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    nk = L["neck"]
    CF = cuirass_form(snapF, L)
    NC = neck_cutter(L, r0=0.09)
    cuts = [NC] + [armhole_cutter(L, s, grow=0.012) for s in ("L", "R")]
    top = HalfSpace(V(0, 0, float(nk[2]) + 0.06), V(0, 0, 1))
    reg = Diff(Inter(shell(CF, 0.03, 0.017), top, HalfSpace(V(0, 0, BELT_Z + 0.06), V(0, 0, -1)), k=0.004),
               Union(*cuts), k=0.004)
    lo, hi = V(-0.6, -0.45, BELT_Z - 0.05), V(0.6, 0.45, float(nk[2]) + 0.14)
    S.add(Bounded(reg, lo, hi), 0.0, mat="steel")
    # r4: lame seams across the lower plate + a seam round the chest plate: 4 mm deep grooves in the OUTER skin only
    # (never cut through the 13 mm shell) so the cavity/ridge bake gives dark seams with bright worn bevels
    outer = Diff(Offset(CF, 0.04), Offset(CF, 0.026))
    for z in CUIRASS_SEAMS:
        S.sub(Bounded(Inter(outer, Slab(V(0, 0, z), V(0, 0, 1), 0.0028)), lo, hi), 0.0015)
    # medial keel: a raised sternum ridge down the centre line, from the collar plane to the lower lame
    ridge = [V(0, -0.2, z) for z in np.linspace(CUIRASS_SEAMS[1] + 0.02, float(nk[2]) - 0.06, 10)]
    P = np.array([S_proj(CF, V(0, 0.0, p[2]), V(0, -1, 0)) + V(0, -0.029, 0) for p in ridge])
    S.add(Chain(list(P), 0.0085, squash=(0.55, 1.0), ref=(1, 0, 0)), 0.008, mat="steel")
    band = Diff(Offset(NC, 0.012), NC)
    S.add(Bounded(Inter(shell(CF, 0.034, 0.02), band, top, k=0.002), lo, hi), 0.002, mat="steel")
    S.add(gorget_ring(snapF, L), 0.01, mat="steel")                         # C2 r7 raised collar
    for z in (BELT_Z + 0.075,):
        for az in np.linspace(-2.6, 2.6, 13):
            d = V(math.sin(az), -math.cos(az), 0)
            p = trace_in(S, V(0, 0.01, z), d)
            S.add(Sphere(p, 0.0055), 0.001, mat="iron")
    # r5 battle dents (board r4: 'clean chrome, a white blob at stage-1 distance'): shallow (2-3.5 mm, never through
    # the 13 mm plate) soft hollows 3.5-6 cm across, scattered over chest, flanks and back -- the bake turns them into
    # light/shadow breaks across the plate
    # C2 r8 (board r7: 'crumpled chrome foil'): the 11 dents broke every plate's specular into blotches -> only
    # three broad, very shallow ones (back + flanks), the chest plate stays one clean curved specular shape
    dents(S, [(2.5, BELT_Z + 0.24), (-1.7, BELT_Z + 0.2), (1.9, BELT_Z + 0.3)], depth_scale=0.6)
    return S


def dents(S, at_list, c0=V(0, 0.01, 0), depth_scale=1.0):
    rng = np.random.RandomState(len(at_list) * 7 + 3)
    for az, z in at_list:
        d = V(math.sin(az), -math.cos(az), 0)
        p = trace_in(S, V(c0[0], c0[1], z), d)
        if np.linalg.norm(p - V(c0[0], c0[1], z)) < 0.05:
            continue
        n = S.grad(p[None])[0]
        r = rng.uniform(0.035, 0.06)
        depth = rng.uniform(0.002, 0.0035) * depth_scale
        S.sub(Sphere(p + n * (r - depth), r), 0.012)


CUIRASS_SEAMS = (BELT_Z + 0.115, BELT_Z + 0.17)


def kneecop(snapF, L, side):
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    kn = L["knee_" + side]
    c = kn + V(0, -0.06, -0.02)
    reg = Inter(shell(snapF, 0.02, 0.011), Sphere(c, 0.075), HalfSpace(V(0, float(kn[1]) - 0.01, 0), V(0, 1, 0)),
                HalfSpace(V(0, 0, float(kn[2]) + 0.045), V(0, 0, 1)), k=0.004)
    S.add(Bounded(reg, c - 0.12, c + 0.12), 0.0, mat="steel")
    p = trace_in(S, kn + V(0, 0, -0.01), V(0, -1, 0), r=0.2)
    S.add(RoundCone(p - V(0, -0.006, 0), p + V(0, -0.04, 0.01), 0.013, 0.002), 0.003, mat="steel")
    return S


def rerebrace(snapF, L, side):
    """C2 r7 (iron rank bulk + dark arms): steel upper-arm plate from under the pauldron to above the elbow, two
    raised rims, rivets; rigid to the upper arm."""
    S = Sculpt(materials=GEAR_MATS, default_mat="steel")
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    ln = float(np.linalg.norm(el - sh))
    c = sh + a * ln * 0.7             # t 0.5-0.9: the lower half shows as a steel band under the big pauldron
    arm = Capsule(sh + a * ln * 0.3, el + a * 0.01, 0.1)
    reg = Inter(shell(snapF, 0.016, 0.006), Slab(c, a, ln * 0.2), arm, k=0.003)
    lo, hi = c - 0.2, c + 0.2
    S.add(Bounded(reg, lo, hi), 0.0, mat="steel")         # C2 r8: smooth (no displacement speckle)
    for f in (-0.18, 0.18):          # rolled rims top + bottom
        rim = Inter(shell(snapF, 0.021, 0.012), Slab(c + a * ln * f, a, 0.0055), arm, k=0.002)
        S.add(Bounded(rim, lo, hi), 0.002, mat="steel")
    sx = 1 if side == "L" else -1
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    side_v = norm(np.cross(a, up)) * sx
    for f in (-0.1, 0.12):
        for ang in (-0.9, 0.0, 0.9):
            d = norm(up * math.cos(ang) * 0.4 + side_v * math.sin(ang) + V(sx * 0.6, 0, 0))
            p = trace_in(S, c + a * ln * f, d, r=0.15)
            S.add(Sphere(p, 0.0042), 0.001, mat="iron")
    return S


def gorget_ring(snapF, L):
    """C2 r7 iron rank gorget: a standing steel collar round the neck base (ref marauder_iron_dusk.png) -- a 14 mm
    conical wall on the neck funnel (flares slightly outward going up), standing GH = 4.5 cm proud of the body all
    the way round (so it follows the collarbones in front and the traps behind), a rolled rim on its top edge; the
    buried part is trimmed off inside the body. Part of the cuirass (body weights)."""
    nk = L["neck"]
    r0, s_fl, cz = 0.104, 0.3, float(nk[2]) - 0.05
    cy = float(nk[1]) - 0.004
    GH = 0.045
    NG = charkit.funnel_cutter(V(0.0, cy, cz), r0, s_fl, sy=1.0)
    wall = Inter(Diff(Offset(NG, 0.014), NG), Offset(snapF, GH), HalfSpace(V(0, 0, float(nk[2]) - 0.12), V(0, 0, -1)),
                 k=0.003)
    wall = Diff(wall, Offset(snapF, -0.012), k=0.004)
    # rim: first height (marching up the wall's mid-surface) where the wall leaves the GH offset
    pts = []
    zs = np.linspace(float(nk[2]) - 0.1, float(nk[2]) + 0.2, 121)
    for ang in np.linspace(0, 2 * math.pi, 37)[:-1]:
        d = V(math.sin(ang), -math.cos(ang), 0)
        r = r0 + 0.007 + (zs - cz) * s_fl
        X, Y = r * d[0], cy + r * d[1]
        f = snapF.d(X, Y, zs) - GH
        k = int(np.argmax(f > 0)) if np.any(f > 0) else len(zs) - 1
        pts.append(V(float(X[k]), float(Y[k]), float(zs[k]) - 0.004))
    P = np.array(pts)
    for _ in range(2):        # smooth the rim height so it reads as one rolled edge, not a wobble
        P[:, 2] = (np.roll(P[:, 2], 1) + 2 * P[:, 2] + np.roll(P[:, 2], -1)) / 4
    pts = list(P) + [P[0]]
    rim = Chain(pts, 0.0105, squash=(0.75, 1.0), ref=(0, 0, 1))
    lo, hi = V(-0.3, cy - 0.3, float(nk[2]) - 0.15), V(0.3, cy + 0.3, float(nk[2]) + 0.25)
    return Bounded(Union(wall, rim, k=0.006), lo, hi)


def mantle(snapF, L):
    """Violet rank fur collar-mantle: one ring of fur round the neck base (over the collarbones in front, the traps
    and the left shoulder top, a hump behind the neck), stopping short of the right shoulder (iron pauldron).
    C2 r8 (board r7: 'flat grey noise slab with a jagged cut edge'): the base is a smooth padded roll and the fur is
    real geometry -- three shingled rows of tapering fur clumps (RoundCones) growing out and down from the roll, the
    lowest row longest so the lower edge is a TUFTED silhouette; a 'furtip' paint channel on every clump's outer
    half drives the root -> tip value ramp (p_pelt). Body weights transferred."""
    S = Sculpt(materials=GEAR_MATS, default_mat="pelt")
    zc = float(L["shoulder_L"][2])
    keep = Ellipsoid(V(0, 0.05, zc + 0.01), V(0.25, 0.21, 0.16))       # narrows toward the front: a rounded collar
    NC = neck_cutter(L, r0=0.084)
    shR = L["shoulder_R"]
    cuts = Union(NC, *[arm_cutter(L, sd, t=0.12)[0] for sd in ("L", "R")], Sphere(shR + V(0.02, 0, 0.0), 0.1), k=0.01)
    low = HalfSpace(V(0, 0, zc - 0.06), norm(V(0, -0.6, -1)))       # lower edge: at the collarbones in front, low behind
    reg = Diff(Inter(shell(snapF, 0.034, 0.006), keep, low, k=0.03), cuts, k=0.012)
    hump = Inter(shell(snapF, 0.066, 0.006), Ellipsoid(V(0, 0.1, zc + 0.0), V(0.17, 0.12, 0.12)), k=0.02)
    reg = Union(reg, Diff(hump, cuts, k=0.01), k=0.025)
    lo, hi = V(-0.42, -0.32, zc - 0.3), V(0.42, 0.36, zc + 0.3)
    base = Bounded(Displace(reg, 0.004, 9.0, 2, seed=61), lo, hi)
    S.add(base, 0.0, mat="pelt")
    Sb = Sculpt(materials=GEAR_MATS, default_mat="pelt")     # rays find the roll, never an earlier clump
    Sb.add(base, 0.0, mat="pelt")
    nk = L["neck"]
    o = V(0.0, float(nk[1]) + 0.02, zc + 0.02)
    rng = np.random.RandomState(61)
    down = V(0, 0, -1)
    # rows of clumps, top to bottom: (height above the shoulder line, clump length, root radius, count). Points are
    # found with HORIZONTAL rays at each height (the roll's outer face); clumps lie DOWN along the surface (shingled
    # like a pelt), each row overlapping the one below; the bottom row is longest and hangs past the edge.
    # r8 fast: ~200 thin clumps decimated into pale faceted shards ('a row of fangs') -> fewer, fatter clumps that
    # merge into a tufted mass (wide blend), each clump its own tip value
    for dz, ln, r0, cnt in ((0.07, 0.032, 0.02, 16), (0.035, 0.04, 0.021, 20), (0.0, 0.046, 0.021, 22),
                            (-0.035, 0.054, 0.02, 22), (-0.07, 0.062, 0.019, 20)):
        for i in range(cnt):
            th = -math.pi + (i + 0.5 + 0.4 * rng.uniform(-1, 1)) / cnt * 2 * math.pi
            org = o + V(0, 0, dz)
            d = V(math.sin(th), -math.cos(th), 0.0)
            p = trace_in(Sb, org, d, r=0.45)
            if np.linalg.norm(p - org) < 0.06 or np.linalg.norm(p - shR) < 0.11:
                continue
            n = Sb.grad(p[None])[0]
            tdown = down - n * float(np.dot(down, n))
            if np.linalg.norm(tdown) < 0.2:          # on top of the roll: fall outward instead
                tdown = d
            tdown = norm(tdown)
            tang = norm(np.cross(n, tdown))
            dirv = norm(tdown * 0.85 + n * 0.32 + tang * rng.uniform(-0.25, 0.25))
            L_ = ln * rng.uniform(0.6, 1.3)                 # uneven hem, never a row of equal points
            ra = r0 * rng.uniform(0.85, 1.15)
            a, b = p - n * 0.006, p + dirv * L_
            S.add(RoundCone(a, b, ra, 0.0095), 0.012, mat="pelt")          # blunt clump tips, not fangs
            S.paint(RoundCone(p + dirv * L_ * 0.6, b, ra * 0.9, 0.0085), "furtip", soft=0.012,
                    value=float(rng.uniform(0.35, 1.0)))
    return S


GEAR = {  # name -> (builder(snapF, snapH, L, H), bone or None = transfer body weights, tris)
    "helm_straw": (lambda F, Hs, L, H: helm_straw(Hs, H), "head", 700),
    "helm_rust": (lambda F, Hs, L, H: helm_rust(Hs, H), "head", 1100),
    "helm_skull": (lambda F, Hs, L, H: helm_skull(Hs, H), "head", 1400),
    "helm_iron": (lambda F, Hs, L, H: helm_iron(Hs, H), "head", 1300),
    "jerkin": (lambda F, Hs, L, H: jerkin(F, L), None, 1600),
    "baldric": (lambda F, Hs, L, H: baldric_gear(F, L), None, 560),
    "cuirass": (lambda F, Hs, L, H: cuirass(F, L), None, 1200),
    "chains": (lambda F, Hs, L, H: chains(F, L), None, 1100),
    "pauldron_leather_L": (lambda F, Hs, L, H: pauldron(F, L, "L", "leather"), "upperarm_L", 520),
    "pauldron_iron_R": (lambda F, Hs, L, H: pauldron(F, L, "R", "iron"), "upperarm_R", 620),
    "pauldron_steel_L": (lambda F, Hs, L, H: pauldron(F, L, "L", "steel"), "upperarm_L", 760),
    "pauldron_steel_R": (lambda F, Hs, L, H: pauldron(F, L, "R", "steel"), "upperarm_R", 760),
    "rerebrace_L": (lambda F, Hs, L, H: rerebrace(F, L, "L"), "upperarm_L", 360),
    "rerebrace_R": (lambda F, Hs, L, H: rerebrace(F, L, "R"), "upperarm_R", 360),
    "mantle": (lambda F, Hs, L, H: mantle(F, L), None, 2600),
    "harness": (lambda F, Hs, L, H: harness(F, L), None, 900),
    "kneecop_L": (lambda F, Hs, L, H: kneecop(F, L, "L"), "shin_L", 180),
    "kneecop_R": (lambda F, Hs, L, H: kneecop(F, L, "R"), "shin_R", 180),
}


def gear_bounds(name, L):
    if name.startswith("helm"):
        return V(-0.36, -0.4, 1.5), V(0.36, 0.3, 2.2)
    if name.startswith("pauldron"):
        sh = L["shoulder_" + name[-1]]
        return sh - 0.25, sh + 0.25
    if name.startswith("rerebrace"):
        sh, el = L["shoulder_" + name[-1]], L["elbow_" + name[-1]]
        c = (sh + el) / 2
        return c - 0.22, c + 0.22
    if name == "mantle":
        return V(-0.42, -0.32, 1.2), V(0.42, 0.36, 1.8)
    if name.startswith("kneecop"):
        kn = L["knee_" + name[-1]]
        return kn - 0.14, kn + 0.14
    return V(-0.55, -0.45, BELT_Z - 0.1), V(0.55, 0.45, 1.75)


def build_gear(S_body, L, H, names, h=0.0035, n_ops=None):
    t = time.time()
    S_grid = S_body
    if n_ops:          # r4: torso gear sits on the tunic-level body (see body_sculpt), not on the belt / baldric
        S_grid = copy.copy(S_body)
        S_grid.ops = S_body.ops[:n_ops]
    snapF = charkit.GridSDF(S_grid, h=h, lo=V(-0.7, -0.45, 0.2), hi=V(0.7, 0.45, 1.95))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    out = {}
    for nm in names:
        fn, bone, tris = GEAR[nm]
        t = time.time()
        r = fn(snapF, snapF, L, H)
        out[nm] = r if isinstance(r, tuple) else (r, r)
        pipeline.log(f"gear {nm}: {len(out[nm][0].ops)} ops {time.time()-t:.1f}s")
    return out


# ============================================================================ palette + painters
# r3 ladder: every tier wears a FULL torso garment (vest armholes); torso mass luma straw ~69% > iron blued steel ~54%
# > rust leather ~35% > violet ~19%, skin ~43% ruddy tan, stubble/soot ~14%, trousers ~10%.
# (r1/r2) Value / hue ladder (albedo luma, sRGB) -- 4+ groups at game distance, tiers separated by the BIG shapes:
#   ashen skin ~46% (cool pale tan, soot mask ~12% across the eyes)  >  tier cloth: straw ~62% / rust ~30% /
#   violet ~18% (saturated) / slate ~24%  >  fur cuffs ~22%  >  dark trousers ~10%, leather wraps/belt ~12-16%.
#   Gear: bone skull ~72% (violet: brightest shape on the darkest tier), steel plate ~62% (iron tier), dark rusty
#   iron ~22% (rust tier helm), tier leather (straw tan ~34%, rust red-brown ~20%).
PAL = dict(
    # r3 skin: weathered ruddy tan (~43% luma, was a pale 62% peach), olive / ruddy / sun-burn temperature shifts,
    # ash grime; >= 25% below every tier's gear highlight
    skin=shaders.srgb(142, 92, 68), skin_warm=shaders.srgb(162, 74, 54), skin_cool=shaders.srgb(104, 96, 92),
    skin_olive=shaders.srgb(118, 104, 74), skin_burn=shaders.srgb(160, 82, 60), ash=shaders.srgb(92, 88, 84),
    stubble=shaders.srgb(40, 34, 32), scar=shaders.srgb(178, 122, 104),
    lips=shaders.srgb(110, 62, 54), skin_rough=0.7, tattoo=shaders.srgb(24, 20, 22),
    iris=shaders.srgb(176, 136, 64), sclera=shaders.srgb(248, 244, 234),     # C2 r9: brighter (light eye dots)
    mouth=shaders.srgb(44, 18, 16),
    brow=shaders.srgb(26, 22, 20), brow_hi=shaders.srgb(70, 60, 54), brow_hi_amt=0.04, brow_rough=0.85,
    hair=shaders.srgb(26, 22, 20),
    leather=shaders.srgb(70, 46, 30), leather_worn=shaders.srgb(128, 94, 66),
    leather_dark=shaders.srgb(34, 24, 18), leather_dark_worn=shaders.srgb(80, 60, 44),
    pants=shaders.srgb(40, 34, 30), sole=shaders.srgb(26, 20, 16),
    fur=shaders.srgb(74, 64, 54), fur_root=shaders.srgb(30, 24, 20), fur_tip=shaders.srgb(150, 136, 118),
    bronze=shaders.srgb(170, 128, 66), bronze_patina=shaders.srgb(70, 60, 44), bronze_patina_amt=0.5,
    iron=shaders.srgb(70, 70, 74), iron_patina=shaders.srgb(104, 56, 32), iron_patina_amt=0.55,
    steel=shaders.srgb(196, 200, 208),
    bone=shaders.srgb(226, 214, 186), bone_dark=shaders.srgb(96, 80, 60),
    horn=shaders.srgb(62, 50, 40), horn_tip=shaders.srgb(212, 196, 160),
    cloth=shaders.srgb(200, 170, 92), cloth_trim=shaders.srgb(128, 100, 54),
    tleather=shaders.srgb(128, 90, 56), tleather_worn=shaders.srgb(176, 136, 92),
)
TIER_PAL = {
    # r5 tier ladder (S1 torso band >= 10 pts apart): straw = ash-whitened body + bleached tunic (brightest),
    # iron = worn steel (natural skin), rust = natural skin + red cloth/leather, violet = woad-dark body (darkest)
    # C2 r9 ladder (board r8: rust / violet the same midtone, steps >= 12 wanted; iron can't go much below ~9 % in game
    # because the actor key floors dark-metal reflectance) -> straw and rust step UP, violet's mantle goes dark, and
    # every rank gets its own trouser colour (board: 'identical dark trousers on all four tiers')
    "straw": dict(cloth=shaders.srgb(246, 228, 162), cloth_trim=shaders.srgb(140, 112, 62),
                  pants=shaders.srgb(98, 76, 50),
                  skin=shaders.srgb(188, 140, 112), skin_warm=shaders.srgb(196, 122, 96), skin_burn=shaders.srgb(194, 126, 100),
                  skin_olive=shaders.srgb(150, 132, 100),
                  wash=shaders.srgb(194, 186, 172), wash_amt=0.0,    # C2: no wash -- streaked paint (PAINT)
                  tleather=shaders.srgb(132, 92, 56), tleather_worn=shaders.srgb(180, 140, 96),
                  horn=shaders.srgb(206, 190, 150), horn_tip=shaders.srgb(80, 64, 48)),
    # C2 r7 re-ladder (board r6: iron must be the DARKEST torso): straw lightest > rust > violet > iron. Rust + violet
    # step UP (warmer orange jerkin, lighter violet dye + woad) so dark gunmetal iron can sit at the bottom.
    "rust": dict(cloth=shaders.srgb(236, 128, 64), cloth_trim=shaders.srgb(124, 54, 26),
                 leather_dark=shaders.srgb(58, 40, 30), leather_dark_worn=shaders.srgb(112, 84, 62),   # r9 harness
                 wash=shaders.srgb(104, 44, 30), wash_amt=0.0,
                 tleather=shaders.srgb(230, 132, 74), tleather_worn=shaders.srgb(240, 178, 124),
                 pants=shaders.srgb(86, 34, 22),
                 iron_patina_amt=0.8),
    "violet": dict(cloth=shaders.srgb(104, 64, 142), cloth_trim=shaders.srgb(56, 32, 78),
                   wash=shaders.srgb(110, 98, 156), wash_amt=0.85, wash_mott=0.14,   # fast: a touch less neon, +value
                   pants=shaders.srgb(46, 30, 60),
                   tleather=shaders.srgb(72, 46, 82), tleather_worn=shaders.srgb(120, 90, 126),
                   iron=shaders.srgb(58, 56, 64), iron_patina=shaders.srgb(60, 40, 70), iron_patina_amt=0.35,
                   bronze=shaders.srgb(120, 118, 128),
                   wash_form=0.32,   # C2 r8: woad shaded by the body forms (board r7: 'violet torso cloth flat')
                   # C2 r9 (board r8: the mantle read light grey-tan and inverted against the cloth): dark pelt
                   fur=shaders.srgb(40, 33, 30), fur_root=shaders.srgb(11, 9, 9), fur_tip=shaders.srgb(108, 94, 82)),
    "iron": dict(cloth=shaders.srgb(36, 40, 52), cloth_trim=shaders.srgb(20, 22, 30),
                 pants=shaders.srgb(30, 33, 42),
                 # C2 r9: soot-blackened bare skin (shoulders, arms above the bracers) -> the darkest rank by value
                 wash=shaders.srgb(44, 39, 38), wash_amt=0.72, wash_mott=0.2, wash_end=0.8,
                 # C2 r7: DARK GUNMETAL (board r6: 'chalky white-painted cloth'; ref marauder_iron_dusk.png): blackened
                 # steel albedo, high metalness + low roughness -> crisp bright specular on edges / dome, value from
                 # the reflections, not from a pale base colour
                 # C2 r8: smooth gunmetal (board r7: 'crumpled chrome foil') -- base a touch up (rougher plate reflects
                 # less), rim / scratch wear a mid steel, never near-white
                 steel=shaders.srgb(40, 42, 50), steel_edge=shaders.srgb(150, 154, 164),
                 tleather=shaders.srgb(34, 27, 24), iron=shaders.srgb(46, 47, 52), iron_patina_amt=0.25,
                 leather=shaders.srgb(40, 30, 24), leather_worn=shaders.srgb(84, 66, 50),
                 bronze=shaders.srgb(120, 104, 70), bronze_patina_amt=0.35,
                 horn=shaders.srgb(36, 28, 24), horn_tip=shaders.srgb(170, 160, 140)),
}


def keyed(fn, key, src):
    return lambda c, pal: fn(c, dict(pal, **{src: pal[key], src + "_worn": pal.get(key + "_worn",
                                                                                   pal.get(src + "_worn"))}))


def p_rag(c, pal, key="cloth"):
    """Rough-spun rag cloth: tier dye, darker dirty hems and folds, faded patches."""
    rgb, rough, metal, emit = shaders.p_cloth(c, dict(pal, cloth=pal[key]))
    n1 = c.noise(5.0, 3, 71)
    n2 = c.noise(26.0, 2, 72)
    fade = shaders.smooth01(n1, 0.2, 0.7) * 0.22
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.25 + 0.03, 1), fade)
    grime = shaders.smooth01(-c.P[:, 2], -1.25, -0.6) * 0.35 + 0.15 * shaders.smooth01(n2, 0.4, 0.9)
    rgb = shaders.mix(rgb, rgb * np.array([0.55, 0.5, 0.45]), np.clip(grime, 0, 0.5))
    return rgb, rough, metal, emit


def _arc(P):
    """Angle round the vertical body axis (0 = front, +pi/2 = the character's left (+X), +-pi = back)."""
    return np.arctan2(P[:, 0], -(P[:, 1] - 0.01))


def _aniso(P, sx, sy, sz, freq, octaves, seed):
    return sdf.fbm(P[:, 0] * sx, P[:, 1] * sy, P[:, 2] * sz, octaves, freq, seed=seed)


def _dashes(t, period, duty=0.5):
    """0/1-ish stitch dashes along a coordinate t (metres)."""
    return shaders.smooth01(np.sin(t * 2 * math.pi / period), 1 - 2 * duty - 0.15, 1 - 2 * duty + 0.15)


def _armhole_e(P, L, grow=0.0):
    """Normalised distance to each tunic armhole ellipsoid (1 = on the cut edge), min over both sides."""
    e = np.full(len(P), 9.0)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        c = L["shoulder_" + side] + V(sx * 0.018, 0.0, -0.005)
        r = V(0.1 + grow, 0.13 + grow, ARMHOLE_RZ + grow)
        e = np.minimum(e, np.linalg.norm((P - c) / r, axis=1))
    return e


PATCH = {"straw": (shaders.srgb(122, 92, 56), shaders.srgb(70, 52, 34)),
         "rust": (shaders.srgb(92, 40, 22), shaders.srgb(200, 170, 120)),
         "violet": (shaders.srgb(30, 18, 34), shaders.srgb(170, 150, 120)),
         "iron": (shaders.srgb(30, 34, 44), shaders.srgb(150, 140, 120))}


def p_tunic(c, pal, key="cloth"):
    """r4 marauder rag cloth (board: 'single-tone shells, no weave, stitching, fold darkening or wear'):
    homespun slub weave (anisotropic warp/weft streaks), drape folds + belt bunching darkened in the valleys,
    dirt-caked hems round the armholes / neck / loincloth hem, sweat-dark armpits, dark side + shoulder seams with
    pale stitch dashes, a stitched patch on the left flank (the side the game camera sees), sun-faded tops."""
    P = c.P
    L = c.L
    tier = pal.get("tier", "straw")
    base = pal[key]
    n1 = c.noise(5.0, 3, 171)
    n2 = c.noise(30.0, 2, 172)
    # slub weave: horizontal weft + vertical warp streaks (~8 mm), plus a fine cross-hatch (~5 mm)
    weft = _aniso(P, 0.1, 0.1, 1.0, 120.0, 2, 173)
    warp = _aniso(P, 1.0, 1.0, 0.1, 120.0, 2, 174)
    ang = _arc(P)
    u = ang * 0.17
    hatch = np.sin(u * 2 * math.pi / 0.005) * np.sin(P[:, 2] * 2 * math.pi / 0.005)
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.1 * n1 + 0.12 * weft + 0.09 * warp + 0.015 * hatch + 0.03 * n2)[:, None]
    # sun-faded on the up-facing shoulders / chest top (a broad lift, never a blotch)
    up = shaders.smooth01(c.N[:, 2], 0.3, 0.9)
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.18 + 0.01, 1), 0.35 * up)
    torso = (np.abs(P[:, 0]) < 0.3) & (P[:, 2] > BELT_Z - 0.1) & (P[:, 2] < 1.62)
    # drape folds: soft vertical valleys from the chest to the belt; bunching rolls just above the belt
    f = np.sin(u * 2 * math.pi / 0.07 + 2.4 * c.noise(3.0, 2, 175))
    drape = shaders.smooth01(-f, 0.35, 0.95) * shaders.smooth01(P[:, 2], BELT_Z + 0.04, 1.12) * \
        (1 - shaders.smooth01(P[:, 2], 1.28, 1.4))
    g = np.sin((P[:, 2] - BELT_Z) * 2 * math.pi / 0.024 + 2.0 * c.noise(6.0, 2, 176) + ang * 0.8)
    bunch = shaders.smooth01(P[:, 2], BELT_Z + 0.03, BELT_Z + 0.05) * (1 - shaders.smooth01(P[:, 2], BELT_Z + 0.1, BELT_Z + 0.14))
    rgb *= (1.0 - (0.2 * drape + 0.3 * bunch * shaders.smooth01(-g, 0.0, 0.9)) * torso
            + 0.08 * bunch * shaders.smooth01(g, 0.3, 1.0) * torso)[:, None]
    if tier == "straw" and key != "cloth_trim":
        # C2 r9 (board r8: 'the straw vest is a flat untextured yellow slab' -- the weave is 5-8 mm, invisible at the
        # game camera): value shapes 5-25 cm across -- deeper drape valleys, two broad ragged soot / sweat stains,
        # a darker dirty band toward the hem, sun-bleached shoulders
        rgb *= (1.0 - 0.18 * drape * torso)[:, None]
        st1 = shaders.smooth01(c.noise(3.2, 3, 178) + 0.25 * c.noise(14.0, 2, 179), 0.18, 0.42)
        rgb = shaders.mix(rgb, rgb * np.array([0.58, 0.5, 0.4]), 0.46 * st1 * torso)
        band = 1 - shaders.smooth01(P[:, 2] + 0.03 * c.noise(9.0, 2, 180), BELT_Z + 0.06, BELT_Z + 0.16)
        rgb = shaders.mix(rgb, rgb * np.array([0.66, 0.58, 0.48]), 0.45 * band * torso)
        rgb = shaders.mix(rgb, np.minimum(rgb * 1.1 + 0.03, 1), 0.4 * up)
    # fold cavities (geometry): strong
    rgb = shaders.mix(rgb, rgb * np.array([0.38, 0.34, 0.32]), np.clip(1.4 * c.cav, 0, 0.9))
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.2 + 0.02, 1), 0.25 * c.ridge)
    dirt = rgb * np.array([0.46, 0.4, 0.34])
    grime = np.zeros(c.n)
    # dirty hems: armholes + neckline (tunic), the loincloth hem, the rolled trim
    if key != "cloth_trim":
        e = _armhole_e(P, L)
        grime = np.maximum(grime, (1 - shaders.smooth01(e, 1.0, 1.4)) * torso * 0.75)
        nk = L["neck"]
        en = np.linalg.norm((P - V(0, float(nk[1]), float(nk[2]) - 0.05)) / V(0.11, 0.11, 0.09), axis=1)
        grime = np.maximum(grime, (1 - shaders.smooth01(en, 1.0, 1.35)) * 0.6)
        # armpits: sweat-dark below the armhole
        for side, sx in (("L", 1.0), ("R", -1.0)):
            sh = L["shoulder_" + side]
            pit = np.linalg.norm((P - (sh + V(-sx * 0.04, 0.0, -0.13))) / V(0.07, 0.09, 0.09), axis=1)
            grime = np.maximum(grime, (1 - shaders.smooth01(pit, 0.5, 1.2)) * torso * 0.6)
    else:
        grime += 0.45
    hem = 1 - shaders.smooth01(P[:, 2], 0.6, 0.74)                 # loincloth hem: caked mud + fraying
    grime = np.maximum(grime, hem * 0.85)
    grime = np.maximum(grime, (1 - shaders.smooth01(P[:, 2], 0.85, 1.3)) * 0.42)
    grime *= 0.75 + 0.45 * shaders.smooth01(n2, -0.4, 0.5)
    rgb = shaders.mix(rgb, dirt, np.clip(grime, 0, 0.85))
    if key != "cloth_trim":
        # side seams + shoulder seams: dark line, pale stitch dashes either side
        thread = shaders.srgb(196, 178, 140) if tier != "straw" else shaders.srgb(96, 70, 44)
        d_side = np.abs(np.abs(ang) - math.pi / 2) * 0.17
        seam = (1 - shaders.smooth01(d_side, 0.0012, 0.0035)) * torso
        st = (1 - shaders.smooth01(np.abs(d_side - 0.0065), 0.0008, 0.0022)) * _dashes(P[:, 2], 0.011) * torso
        top = (P[:, 2] > float(L["neck"][2]) - 0.1) & (np.abs(P[:, 0]) > 0.07)
        d_sh = np.abs(P[:, 1] - 0.008)
        seam = np.maximum(seam, (1 - shaders.smooth01(d_sh, 0.0012, 0.0035)) * top)
        st = np.maximum(st, (1 - shaders.smooth01(np.abs(d_sh - 0.0065), 0.0008, 0.0022)) * _dashes(P[:, 0], 0.011) * top)
        rgb = shaders.mix(rgb, rgb * 0.35, 0.85 * seam)
        rgb = shaders.mix(rgb, thread, 0.7 * st)
        # stitched patch on the left flank (+X, faces the camera when the marauder faces left)
        pc, pz, hu, hz = 1.05, 1.16, 0.05, 0.045
        du = np.abs(ang - pc) * 0.17
        dz = np.abs(P[:, 2] - pz)
        inside = (1 - shaders.smooth01(du, hu - 0.002, hu + 0.002)) * (1 - shaders.smooth01(dz, hz - 0.002, hz + 0.002))
        inside *= torso * (P[:, 0] > 0.05)
        pcol, pthread = PATCH.get(tier, PATCH["straw"])
        prgb = np.tile(pcol, (c.n, 1)) * (1.0 + 0.12 * weft + 0.1 * n1)[:, None]
        prgb = shaders.mix(prgb, prgb * 0.5, np.clip(1.4 * c.cav, 0, 0.9))
        rgb = shaders.mix(rgb, prgb, 0.92 * inside)
        border = inside * (1 - shaders.smooth01(np.minimum(hu - du, hz - dz), 0.003, 0.006))
        rgb = shaders.mix(rgb, rgb * 0.45, 0.6 * border)
        ring = inside * (1 - shaders.smooth01(np.abs(np.minimum(hu - du, hz - dz) - 0.0075), 0.0008, 0.002))
        rgb = shaders.mix(rgb, pthread, 0.8 * ring * np.maximum(_dashes(u, 0.01), _dashes(P[:, 2], 0.01)))
    rough = np.clip(0.93 + 0.03 * n1 + 0.04 * grime, 0.88, 0.98)     # r5: 0.86 -> 0.93 (residual vinyl sheen)
    return shaders.out(c.n, rgb, rough)


def p_tleather(c, pal, key="tleather"):
    """r4 tier leather (rust jerkin, leather pauldron, straw cap + baldric): pebble grain, mottled tanning, panel
    seams with pale saddle stitching (jerkin), scuffed bright edges + scratches, near-black cavities, dirt low."""
    P = c.P
    L = c.L
    tier = pal.get("tier", "straw")
    base = pal[key]
    worn = pal.get(key + "_worn", base * np.array([1.6, 1.5, 1.4]))
    n1 = c.noise(5.0, 3, 181)
    n2 = c.noise(70.0, 2, 182)
    pebble = shaders.smooth01(c.noise(150.0, 1, 183), 0.1, 0.6)
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.16 * n1 + 0.06 * n2 - 0.08 * pebble)[:, None]
    # scuffs: worn edges and ridges lighter; random scratches
    wear = np.clip(shaders.smooth01(c.ridge, 0.03, 0.4) + 0.3 * shaders.smooth01(n2, 0.45, 0.9), 0, 1)
    sc = (1.0 - shaders.smooth01(np.abs(c.noise(16.0, 2, 184)), 0.0, 0.03)) * shaders.smooth01(c.noise(3.0, 2, 185), 0.1, 0.5)
    rgb = shaders.mix(rgb, worn, np.clip(0.5 * wear + 0.35 * sc, 0, 0.6))
    torso = (np.abs(P[:, 0]) < 0.22) & (P[:, 2] > BELT_Z - 0.05) & (P[:, 2] < 1.6)
    if tier == "rust":
        # jerkin panels: front panel edges, side seams, a yoke seam across the chest + back; scuffed armhole / neck edges
        ang = _arc(P)
        seam = np.zeros(c.n)
        st = np.zeros(c.n)
        for a0 in (0.62, -0.62, 1.7, -1.7, 2.6, -2.6):
            d = np.abs(ang - a0) * 0.17
            seam = np.maximum(seam, 1 - shaders.smooth01(d, 0.0012, 0.0035))
            st = np.maximum(st, (1 - shaders.smooth01(np.abs(d - 0.006), 0.0008, 0.0022)) * _dashes(P[:, 2], 0.009))
        dy = np.abs(P[:, 2] - 1.39)
        seam = np.maximum(seam, 1 - shaders.smooth01(dy, 0.0012, 0.0035))
        st = np.maximum(st, (1 - shaders.smooth01(np.abs(dy - 0.006), 0.0008, 0.0022)) * _dashes(ang * 0.17, 0.009))
        rgb = shaders.mix(rgb, rgb * 0.3, 0.85 * seam * torso)
        rgb = shaders.mix(rgb, shaders.srgb(206, 176, 128), 0.75 * st * torso)
        e = _armhole_e(P, L, grow=0.006)
        rgb = shaders.mix(rgb, worn, 0.5 * (1 - shaders.smooth01(e, 1.0, 1.18)) * torso)
    cav = np.clip(1.3 * c.cav, 0, 0.9)
    rgb = shaders.mix(rgb, rgb * np.array([0.32, 0.28, 0.26]), cav)
    low = 1.0 - shaders.smooth01(P[:, 2], BELT_Z, BELT_Z + 0.12)
    rgb = shaders.mix(rgb, rgb * np.array([0.55, 0.5, 0.46]), 0.4 * low)
    rough = np.clip(0.74 + 0.08 * n1 - 0.12 * wear + 0.1 * low, 0.5, 0.93)      # r5: matte (was 0.6 base)
    return shaders.out(c.n, rgb, rough)


def p_pelt(c, pal):
    """C2 r8 violet fur mantle: dark roots in the cavities between clumps, the clump body mid, lighter tips on the
    outer half of every clump (sculpt paint 'furtip'), a broad low-frequency colour drift (no high-frequency noise ->
    no grey speckle); node side adds world-space strands (kind 'fur')."""
    root = pal.get("fur_root", shaders.srgb(30, 24, 20))
    mid = pal.get("fur", shaders.srgb(74, 64, 54))
    tip = pal.get("fur_tip", shaders.srgb(150, 136, 118))
    tipm = np.clip(c.paint("furtip"), 0, 1)
    drift = c.noise(5.0, 2, 141)
    rgb = np.tile(mid, (c.n, 1)) * (1.0 + 0.08 * drift)[:, None]
    rgb = shaders.mix(rgb, tip, 0.5 * tipm ** 1.5)          # C2 r9: pale only right at the tips
    rgb = shaders.mix(rgb, root, np.clip(1.6 * c.cav, 0, 0.9))
    rgb = shaders.mix(rgb, root, 0.35 * shaders.smooth01(-c.N[:, 2], 0.2, 0.9) * (1 - tipm))   # under-planes
    rough = np.clip(0.86 - 0.06 * tipm, 0.6, 0.95)
    return shaders.out(c.n, rgb, rough)


def _scratch_segments():
    """C2 r8: 2-3 deliberate scratches per steel panel, as 2D segments in a projection plane (dims), gated by which
    way the surface faces (fdim, fsign) -- deterministic, so every tier bake / rebuild gets the same marks."""
    rng = np.random.RandomState(808)
    s0, s1 = CUIRASS_SEAMS
    out = []

    def add(n, dims, fdim, fsign, box, ln=(0.035, 0.075)):
        for _ in range(n):
            c = np.array([rng.uniform(*box[0]), rng.uniform(*box[1])])
            a = rng.uniform(0.25, 1.25) * rng.choice([-1, 1])         # never horizontal / vertical
            d = np.array([math.cos(a), math.sin(a)]) * rng.uniform(*ln) * 0.5
            out.append((dims, fdim, fsign, c - d, c + d, rng.uniform(0.0007, 0.0011)))
    add(3, (0, 2), 1, -1, ((-0.13, 0.13), (s1 + 0.05, 1.36)))           # chest plate
    add(1, (0, 2), 1, -1, ((-0.12, 0.12), (s0 + 0.012, s1 - 0.012)), (0.03, 0.05))   # upper lame
    add(1, (0, 2), 1, -1, ((-0.12, 0.12), (BELT_Z + 0.07, s0 - 0.01)), (0.03, 0.05))  # lower lame
    add(3, (0, 2), 1, 1, ((-0.14, 0.14), (BELT_Z + 0.1, 1.36)))           # back plate
    for sx in (1, -1):                                                      # pauldrons (side projection)
        add(3, (1, 2), 0, sx, ((-0.08, 0.07), (1.44, 1.58)), (0.03, 0.06))
    add(2, (0, 2), 1, -1, ((-0.07, 0.07), (1.76, 1.86)), (0.025, 0.045))   # helm brow / dome
    return out


SCRATCHES = _scratch_segments()


def p_steel(c, pal):
    """C2 r8 SMOOTH GUNMETAL plate (iron tier). Board r7: the r7 plate read as 'crumpled chrome foil' -- dense black /
    white mottling, near-continuous bright seam outlines, sparkle on a black blob at the game camera. Causes: the
    'iron' kind's hammered voronoi bump (now kind 'plate' = no micro bump), sculpt displacement + 11 dents (gone /
    3 broad shallow ones), and an edge-wear mask from the BROAD curvature that covered every small curved piece
    (helmet, pauldrons) with value-noise blocks. Now: a smooth dark base (metal ~1, roughness ~0.45 -> one or two
    broad specular shapes per plate), 4-6 flat value-stepped panels, bright wear ONLY on the panel rims (fine
    curvature of the now-smooth plate = rims / ridges / rivets) broken into chipped lengths, 2-3 placed scratches
    per panel, dark cavity AO in the seams between panels."""
    P, N, L = c.P, c.N, c.L
    z = P[:, 2]
    soft = c.noise(2.2, 2, 97)                          # very broad, gentle (no thresholds -> no blocks)
    base = np.tile(pal["steel"], (c.n, 1)) * (1.0 + 0.05 * soft)[:, None]
    # ---- flat value-stepped panels
    panel = np.ones(c.n)
    on = (np.abs(P[:, 0]) < 0.3) & (z < 1.3)
    s0, s1 = CUIRASS_SEAMS
    half = shaders.smooth01(P[:, 0], -0.012, 0.012)     # breastplate halves (split on the medial ridge)
    front = P[:, 1] < 0.0
    chest = np.where(front, 0.84 + 0.16 * half, 0.86)     # C2 r9: the two keel planes a clear value step apart
    panel = np.where(on & (z >= s1), chest, panel)
    panel = np.where(on & (z < s1), 0.74, panel)        # upper lame: the darkest band
    panel = np.where(on & (z < s0), 0.88, panel)
    nk = L["neck"]
    rn = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - float(nk[1])) ** 2)
    collar = (rn < 0.15) & (z > float(nk[2]) - 0.06) & (z < float(nk[2]) + 0.1)
    panel = np.where(collar, 1.16, panel)                # gorget: the lightest band (frames the face)
    for sd in ("L", "R"):
        t, d, _ = _limb(P, L["shoulder_" + sd], L["elbow_" + sd])
        arm = (d < 0.2) & (np.abs(P[:, 0]) > 0.16) & (z < 1.62)
        lame = np.floor(np.clip((t - 0.2) / 0.16, 0, 3))
        panel = np.where(arm & (t > 0.2), np.where(lame % 2 == 0, 0.78, 0.96), panel)
        panel = np.where(arm & (t <= 0.2), 1.12, panel)  # pauldron crown
        panel = np.where(arm & (t > 0.45), 0.86, panel)   # rerebrace band
    rgb = base * panel[:, None]
    # soft top-light gradient inside each piece: upper faces a touch lighter, under-planes darker
    up = shaders.smooth01(N[:, 2], -0.6, 0.8)
    rgb = rgb * (0.86 + 0.2 * up)[:, None]
    # C2 r9 (board r8, Fable: 'iron has no rim separation against dark crates / barrels'): the game camera sees the
    # ranks side-on, so the plate faces turning AWAY from it (front of the chest, back, shoulder tops: small |N.x|)
    # form the silhouette -> a cool lighter steel there, the faces toward the camera stay dark gunmetal
    sil = 1 - shaders.smooth01(np.abs(N[:, 0]), 0.1, 0.32)
    rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.3, 1.38, 1.55]) + np.array([0.01, 0.013, 0.02]), 1), 0.35 * sil)
    # ---- quiet surface wear (broad, low contrast): cool oxide, faint brown runs down the plate
    ox = shaders.smooth01(c.noise(3.0, 2, 91), 0.05, 0.6)
    rgb = shaders.mix(rgb, rgb * np.array([0.82, 0.84, 0.9]), 0.3 * ox)
    runs = shaders.smooth01(sdf.fbm(P[:, 0] * 1.0, P[:, 1] * 1.0, P[:, 2] * 0.12, 2, 30.0, seed=92), 0.2, 0.6)
    runs = runs * shaders.smooth01(c.noise(2.0, 2, 90), -0.1, 0.4)
    rgb = shaders.mix(rgb, rgb * np.array([0.8, 0.68, 0.58]), 0.22 * runs)
    # ---- painted lame seams: a near-black groove line (the bright bevel is only a faint lip now)
    seam = np.zeros(c.n)
    if pal.get("tier") == "iron":
        for zz in CUIRASS_SEAMS:
            dz = z - zz
            seam = np.maximum(seam, (1.0 - shaders.smooth01(np.abs(dz), 0.0025, 0.005)) * on)
            lip = 1.0 - shaders.smooth01(np.abs(dz - 0.007), 0.0012, 0.0035)
            rgb = shaders.mix(rgb, pal.get("steel_edge", shaders.srgb(150, 154, 162)), 0.2 * lip * on)
        rgb = shaders.mix(rgb, shaders.srgb(8, 8, 10), 0.9 * seam)
    # ---- cavity AO between panels: collar, armholes, under the pauldron lames, seams / rivet holes
    pit = 1 - shaders.smooth01(_armhole_e(P, L, grow=0.012), 0.95, 1.3)
    neck_ao = (1 - shaders.smooth01(rn, 0.1, 0.14)) * shaders.smooth01(z, float(nk[2]) - 0.1, float(nk[2]) - 0.02) * \
        (1 - collar)
    rgb = shaders.mix(rgb, rgb * 0.35, np.clip(0.6 * pit * (z < 1.5) + 0.55 * neck_ao, 0, 0.75))
    cav = shaders.smooth01(c.cav, 0.08, 0.4)
    rgb = shaders.mix(rgb, rgb * 0.18, 0.88 * cav)
    rust = shaders.smooth01(c.cav, 0.3, 0.65) * shaders.smooth01(c.noise(6.0, 2, 98), -0.1, 0.4)
    rgb = shaders.mix(rgb, shaders.srgb(86, 40, 20), 0.4 * rust)
    # ---- bright wear ONLY on panel rims (fine convex curvature), broken into chipped lengths
    rim = shaders.smooth01(c.cf, 0.3, 0.75)
    chip = shaders.smooth01(c.noise(9.0, 2, 86), -0.45, 0.2)
    edge = rim * (0.35 + 0.65 * chip)
    rgb = shaders.mix(rgb, pal.get("steel_edge", shaders.srgb(150, 154, 162)), 0.6 * edge)
    # ---- 2-3 placed scratches per panel (thin, bright, a dark hairline beside each)
    scr = np.zeros(c.n)
    for dims, fdim, fsign, a2, b2, w in SCRATCHES:
        Q = P[:, dims]
        ab = b2 - a2
        tt = np.clip(((Q - a2) @ ab) / float(ab @ ab), 0, 1)
        d = np.linalg.norm(Q - (a2 + tt[:, None] * ab), axis=1)
        taper = np.minimum(tt, 1 - tt) * 2.0
        face = shaders.smooth01(N[:, fdim] * fsign, 0.25, 0.55)
        scr = np.maximum(scr, (1 - shaders.smooth01(d, w * 0.35, w * (0.6 + 0.4 * taper))) * face * (taper > 0.02))
    rgb = shaders.mix(rgb, pal.get("steel_edge", shaders.srgb(150, 154, 162)) * 0.95, 0.75 * scr)
    # dirt toward the lower edge of each piece
    low = 1.0 - shaders.smooth01(z, 1.02, 1.2)
    rgb = shaders.mix(rgb, rgb * np.array([0.72, 0.64, 0.56]), 0.3 * low)
    metal = np.clip(0.97 - 0.12 * ox - 0.5 * rust - 0.35 * cav - 0.15 * runs - 0.4 * seam, 0.1, 1.0)
    rough = np.clip(0.45 + 0.04 * soft + 0.07 * ox + 0.06 * runs - 0.1 * edge - 0.12 * scr + 0.3 * rust +
                    0.06 * low + 0.15 * cav, 0.3, 0.85)
    return shaders.out(c.n, rgb, rough, metal)


def p_bone(c, pal):
    n1 = c.noise(12.0, 3, 81)
    n2 = c.noise(60.0, 2, 82)
    rgb = np.tile(pal["bone"], (c.n, 1)) * (0.94 + 0.08 * n1 + 0.04 * n2)[:, None]
    rgb = shaders.mix(rgb, pal["bone_dark"], np.clip(shaders.smooth01(c.cav, 0.05, 0.45) * 0.9, 0, 0.9))
    rgb = shaders.mix(rgb, shaders.srgb(170, 150, 110), 0.25 * shaders.smooth01(n1, 0.3, 0.8))
    along = _horn_along(c)
    rgb = shaders.mix(rgb, pal["bone_dark"] * 0.8, shaders.smooth01(along, 0.75, 1.0) * 0.6)
    return shaders.out(c.n, rgb, np.clip(0.55 + 0.1 * n1, 0.3, 0.85), 0.0)


def _horn_along(c):
    P = c.P
    along = np.zeros(c.n)
    for b0, tip in HORNS:
        d0 = np.linalg.norm(P - b0, axis=1)
        dt = np.linalg.norm(P - tip, axis=1)
        a = d0 / np.maximum(d0 + dt, 1e-6)
        near = d0 < np.linalg.norm(tip - b0) * 1.15
        along = np.where(near & (a > along), a, along)
    return along


def p_horn(c, pal):
    along = _horn_along(c)
    n1 = c.noise(60.0, 2, 103)
    rgb = shaders.mix(np.tile(pal["horn"], (c.n, 1)), pal["horn_tip"], shaders.smooth01(along, 0.45, 1.0) * 0.9)
    rgb *= (0.94 + 0.08 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.55, 0.7 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.42 + 0.1 * n1, 0.2, 0.8), 0.0)


def _limb(P, a, b):
    """(t along a->b, distance to the segment, angle round it measured from the outward +-X side) per point."""
    ax = b - a
    ln = float(np.linalg.norm(ax))
    u = ax / ln
    t = ((P - a) @ u) / ln
    rad = (P - a) - np.outer(np.clip(t, 0, 1) * ln, u)
    d = np.linalg.norm(rad, axis=1)
    sx = 1.0 if a[0] > 0 else -1.0
    e1 = V(sx, 0, 0) - u * u[0] * sx
    e1 = e1 / np.linalg.norm(e1)
    e2 = np.cross(u, e1)
    ang = np.arctan2(rad @ e2, rad @ e1)
    return t, d, ang


def _stroke(x, w, soft, rough):
    """Soft painted stroke profile across x (0 = centre), ragged by `rough` (noise in -1..1)."""
    return 1.0 - shaders.smooth01(np.abs(x) + 0.35 * w * rough, w - soft, w + soft)


WARPAINT = {"straw": shaders.srgb(178, 176, 172), "rust": shaders.srgb(120, 28, 16),
            "violet": shaders.srgb(36, 26, 70), "iron": shaders.srgb(30, 30, 36)}
# C2 r7: face stripe strength per tier -- straw's pale ash swipes read as a grey smudge on the cheek / temple beside
# the eye (board r6), so the straw face is clean skin (its paint lives on the arms); iron's are soot-dark
WARPAINT_AMT = {"straw": 0.0, "rust": 0.85, "violet": 0.85, "iron": 0.3}    # C2 r8: iron 0.7 -> 0.45, r9 -> 0.3


def war_paint(c, pal):
    """Per-tier body marks on the bare upper arms / shoulders (the skin the game camera sees side-on):
    straw = grey ash hand-smears, rust = red-ochre claw raked down the arm, violet = black-violet woad bands +
    spiral on the deltoid, iron = pale crossing scars. Returns (mask 0..1, rgb, rough delta)."""
    tier = pal.get("tier", "straw")
    P = c.P
    L = c.L
    m = np.zeros(c.n)
    rn = c.noise(55.0, 2, 301)
    for s in ("L", "R"):
        t, d, ang = _limb(P, L["shoulder_" + s], L["elbow_" + s])
        on = (d < 0.11) & (t > -0.15) & (t < 1.05)
        side = np.abs(ang) < 2.3                      # everything but the inner arm (faces the body)
        if tier == "straw":       # r4: three dark soot finger-smears dragged diagonally across the deltoid / upper arm
            sl = t - 0.05 * ang
            for t0 in (0.22, 0.3, 0.38):
                k = _stroke(sl - t0, 0.018, 0.008, rn) * shaders.smooth01(-np.abs(ang), -2.0, -1.2)
                k *= 0.55 + 0.45 * shaders.smooth01(c.noise(20.0, 2, 307), -0.3, 0.3)
                m = np.maximum(m, k * on)
        elif tier == "rust":      # three red-ochre claw slashes wrapping diagonally round the arm
            sl = t + 0.06 * ang
            for t0 in (0.3, 0.42, 0.54):
                k = _stroke(sl - t0, 0.026, 0.01, rn) * shaders.smooth01(-np.abs(ang), -2.3, -1.6)
                m = np.maximum(m, k * on)
        elif tier == "violet":    # two woad armbands + a spiral arm on the deltoid
            for t0 in (0.62, 0.74):
                m = np.maximum(m, _stroke(t - t0, 0.03, 0.012, rn) * on)
            spiral = _stroke(np.sin(ang * 1.0 + t * 9.0), 0.22, 0.08, rn) * shaders.smooth01(t, -0.1, 0.05) * \
                (1 - shaders.smooth01(t, 0.4, 0.5)) * (np.cos(ang) > -0.2)
            m = np.maximum(m, spiral * on)
        else:                     # iron: r4 two dark knotwork-style tattoo bands round the upper arm
            for t0 in (0.56, 0.64):
                m = np.maximum(m, _stroke(t - t0, 0.014, 0.005, rn * 0.3) * on)
    # r4: every mark is DARKER than the skin (board: pale grime read as paint spills)
    col = WARPAINT[tier]
    return np.clip(m, 0, 1), col, 0.12


PAINT = {   # C2 body war paint per tier: (colour, strength); straw = the Ashen marauder's pale ash (brightest tier)
    "straw": (shaders.srgb(190, 184, 172), 0.9), "rust": (shaders.srgb(176, 70, 40), 0.6),   # C2 r9: lighter
    # a little greyer + thinner so the left-deltoid handprint stops reading as a white patch at game distance
    "violet": (shaders.srgb(132, 128, 150), 0.0), "iron": (shaders.srgb(34, 32, 36), 0.8)}


def _arm_coords(P, L, side):
    """(T along shoulder->wrist 0..1, s = signed arc length round the arm, + = FRONT, d = radius) per point."""
    t, d, ang = _limb(P, L["shoulder_" + side], L["wrist_" + side])
    a, b = L["shoulder_" + side], L["wrist_" + side]
    u = norm(b - a)
    sx = 1.0 if side == "L" else -1.0
    e1 = V(sx, 0, 0) - u * u[0] * sx
    e1 = e1 / np.linalg.norm(e1)
    fs = 1.0 if float(np.cross(u, e1) @ V(0, -1, 0)) > 0 else -1.0
    return t, ang * np.minimum(d, 0.07) * fs, d


def _brush(core, c, seed, edge=0.3):
    """Dry-brush a soft stroke field (1 inside .. 0 outside): broken edge + skin pinholes inside."""
    hf = c.noise(70.0, 2, seed) + 0.5 * c.noise(150.0, 1, seed + 1)
    return np.clip(shaders.smooth01(core + edge * hf, 0.35, 0.7), 0, 1)


def body_paint(c, pal):
    """C2: per-tier war paint on the bare body (mask 0..1 incl. strength, colour) or (None, None)."""
    tier = pal.get("tier", "straw")
    col, amt = PAINT.get(tier, (None, 0.0))
    if not amt:
        return None, None
    P, L = c.P, c.L
    m = np.zeros(c.n)
    Larm = float(np.linalg.norm(L["wrist_L"] - L["shoulder_L"]))
    wob = 0.008 * c.noise(6.0, 2, 371)
    # streaks: (s0 at the top, drift per T, T start, T end, half width) -- outer face of each arm, dragged DOWN it.
    # C2 r7 (board r6, Sol: 'the ash marks merge into a broad white cover across upper arm and forearm'): three
    # NARROW finger drags on the UPPER arm only, wide skin gaps between them, each one breaking up as it runs dry;
    # nothing past T 0.42 -> continuous bare skin round the elbow (T ~0.53) and the forearm
    streaks = {"L": [(-0.046, 0.025, 0.27, 0.44, 0.0125), (0.0, 0.02, 0.29, 0.45, 0.0135),
                     (0.046, 0.03, 0.28, 0.43, 0.011)],
               "R": [(-0.046, 0.025, 0.05, 0.41, 0.0125), (0.0, 0.02, 0.03, 0.42, 0.0135),
                     (0.046, 0.03, 0.07, 0.4, 0.011)]}
    if tier == "iron":    # iron: pauldrons + plate hide the shoulder -> two soot drags down the forearm side
        streaks = {sd: [(-0.014, 0.0, 0.42, 0.68, 0.014), (0.016, 0.0, 0.44, 0.64, 0.012)] for sd in ("L", "R")}
    for sd in ("L", "R"):
        T, sarc, d = _arm_coords(P, L, sd)
        on = (d < 0.13) & (np.abs(P[:, 0]) > 0.15) & (T > -0.12) & (T < (0.75 if tier != "straw" else 0.46))
        # bristle texture: fine lines ALONG the stroke (fast across, slow along) + dry skips
        bristle = sdf.fbm(sarc / 0.0035, T * Larm / 0.09, np.full(c.n, 0.37 * (sd == "L")), 2, 1.0, seed=373)
        for i, (s0, dr, t0, t1, w) in enumerate(streaks[sd]):
            sc = s0 + dr * (T - t0) + wob
            prog = np.clip((T - t0) / (t1 - t0), 0, 1)
            ww = w * (1.0 - 0.35 * prog)
            along = shaders.smooth01(T, t0 - 0.02, t0 + 0.015) * (1 - shaders.smooth01(T, t1 - 0.1, t1 + 0.02))
            core = (1 - shaders.smooth01(np.abs(sarc - sc), ww * 0.55, ww * 1.2)) * along
            core = core * (0.85 + 0.35 * bristle) - 0.35 * prog * shaders.smooth01(bristle, -0.2, 0.4)
            if tier == "straw":     # C2 r7: dry skips -- the drag breaks into dashes as the paint runs out
                skip = shaders.smooth01(c.noise(26.0, 2, 386 + i) + 0.6 * prog, 0.25, 0.55)
                core = core * (1 - 0.85 * skip)
            m = np.maximum(m, _brush(core, c, 380 + i, edge=0.22) * on)
        # C2 r9 (board r8: 'the pale hand-print reads as a texture smear at game distance'): handprint off
        if False and sd == "L" and tier != "iron":   # handprint gripping the left deltoid, fingers up over the shoulder
            tl = T * Larm
            pc_t, pc_s = 0.205 * Larm, -0.004
            palm = np.sqrt(((tl - pc_t) / 0.044) ** 2 + ((sarc - pc_s) / 0.04) ** 2)
            hand = 1 - shaders.smooth01(palm, 0.72, 1.08)
            hand *= 1 - 0.4 * (1 - shaders.smooth01(palm, 0.1, 0.6))            # hollow of the palm lighter
            for j, (fs_, fl, fw) in enumerate(((-0.028, 0.06, 0.0068), (-0.0095, 0.073, 0.0074),
                                               (0.0095, 0.068, 0.0072), (0.027, 0.052, 0.0062))):
                top = pc_t - 0.03 - fl
                fx = pc_s + fs_ + 0.14 * fs_ * (pc_t - 0.03 - tl) / 0.07          # fingers splay a little
                seg = np.clip((tl - top) / (pc_t - 0.03 - top), 0, 1)
                dd = np.sqrt((tl - (top + seg * (pc_t - 0.03 - top))) ** 2 + (sarc - fx) ** 2)
                hand = np.maximum(hand, (1 - shaders.smooth01(dd, fw * 0.8, fw * 1.35)) * (0.75 + 0.25 * (seg < 0.25)))
            th0, th1 = np.array([pc_t - 0.005, pc_s + 0.034]), np.array([pc_t + 0.032, pc_s + 0.072])  # thumb
            q = np.stack([tl, sarc], 1)
            hh = np.clip(((q - th0) @ (th1 - th0)) / float((th1 - th0) @ (th1 - th0)), 0, 1)
            dth = np.linalg.norm(q - (th0 + hh[:, None] * (th1 - th0)), axis=1)
            hand = np.maximum(hand, 1 - shaders.smooth01(dth, 0.007, 0.012))
            # the hand slid: a short smeared drag below the heel of the palm
            drag = (1 - shaders.smooth01(np.abs(sarc - pc_s - 0.006 * c.noise(9.0, 1, 377)), 0.022, 0.04)) * \
                shaders.smooth01(tl, pc_t + 0.02, pc_t + 0.04) * (1 - shaders.smooth01(tl, pc_t + 0.05, pc_t + 0.11))
            hand = np.maximum(hand, drag * (0.55 + 0.45 * bristle))
            hand *= 0.8 + 0.25 * shaders.smooth01(c.noise(30.0, 2, 378), -0.4, 0.3)    # uneven pressure
            m = np.maximum(m, (0.78 if tier == "straw" else 1.0) * _brush(hand, c, 390, edge=0.25) * (d < 0.15) *
                           (T > -0.3) * (T < 0.45) * (np.abs(P[:, 0]) > 0.1))
    if tier == "straw":                   # dry ash dusting on the forearms / hands + up the neck sides (feathered)
        dust = np.zeros(c.n)
        for sd in ("L", "R"):
            T, sarc, d = _arm_coords(P, L, sd)
            dust = np.maximum(dust, shaders.smooth01(T, 0.66, 0.78) * (d < 0.12) * (np.abs(P[:, 0]) > 0.15))
        nk = L["neck"]
        rn = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - float(nk[1])) ** 2)
        dust = np.maximum(dust, (rn < 0.11) * shaders.smooth01(P[:, 2], float(nk[2]) - 0.08, float(nk[2]) - 0.04) *
                          (1 - shaders.smooth01(P[:, 2], float(nk[2]) + 0.0, float(nk[2]) + 0.05)))
        m = np.maximum(m, 0.25 * dust * shaders.smooth01(c.noise(24.0, 3, 398), -0.15, 0.45))
    return np.clip(m * amt, 0, 1), col


def p_raider_skin(c, pal):
    """Weathered raider skin with real value + hue structure (r3, critic: 'flat pale peach-clay mannequin'):
    ruddy sun-tan base (~43% luma) with olive / ruddy temperature patches, sun-burnt tops (shoulders, nose, scalp
    crown), darker + browner forearms and hands, strong cavity darkening (muscle form survives the stage key), ash
    grime toward the waist and on the arms, dark shaved-scalp + jaw stubble, soot eye-mask, per-tier war paint."""
    P, N = c.P, c.N
    L = c.L
    n1 = c.noise(7.0, 3, 211)
    n2 = c.noise(34.0, 2, 212)
    n3 = c.noise(2.6, 2, 213)
    n4 = c.noise(4.5, 3, 214)
    rgb = np.tile(pal["skin"], (c.n, 1)) * (1.0 + 0.08 * n1 + 0.04 * n2)[:, None]
    # temperature patches: olive in the broad noise lows, ruddy on the highs + blush masks (nose, cheeks, knuckles)
    rgb = shaders.mix(rgb, pal["skin_olive"], 0.4 * shaders.smooth01(n3, -0.05, 0.6))
    rgb = shaders.mix(rgb, pal["skin_warm"], 0.22 * shaders.smooth01(-n3, 0.0, 0.6))
    blush = np.clip(c.paint("blush") + 0.5 * c.paint("warm"), 0, 1)
    rgb = shaders.mix(rgb, pal["skin_warm"], 0.6 * blush)
    # sun-burnt tops: up-facing skin redder (shoulders, traps, scalp crown, nose bridge)
    up = shaders.smooth01(N[:, 2], 0.25, 0.9)
    rgb = shaders.mix(rgb, pal["skin_burn"], 0.32 * up)
    # extremities: forearms / hands darker and browner (weathered, dirt), elbows ruddy
    ext = np.zeros(c.n)
    for s in ("L", "R"):
        t, d, _ = _limb(P, L["shoulder_" + s], L["knuckle_" + s])
        arm = (d < 0.14) & (np.abs(P[:, 0]) > 0.14)
        ext = np.maximum(ext, shaders.smooth01(t, 0.35, 0.95) * arm)
    rgb = shaders.mix(rgb, rgb * np.array([0.74, 0.66, 0.6]), 0.75 * ext)
    # painterly value gradient (lit from above): brighter head/shoulders, darker belly / waist
    z = P[:, 2]
    top = shaders.smooth01(z, c.x.get("z_knee", 0.5), c.x.get("z_chest", 1.3) + 0.15)
    rgb *= (0.8 + 0.22 * top)[:, None]
    # ash / grime: broad patchy smears lower on the torso and on the arms -- r4: always DARKER than the skin (soot /
    # dirt multiply), never a pale grey wash
    # r5: never on the head (board r4: grime blotch over the straw marauder's eye / smear on the iron cheek)
    head = shaders.smooth01(P[:, 2], float(L["neck"][2]) - 0.02, float(L["neck"][2]) + 0.03)
    ash = shaders.smooth01(n4, 0.2, 0.62) * (0.45 + 0.55 * (1 - top)) * 0.45 * (1 - head)
    rgb = shaders.mix(rgb, rgb * np.array([0.62, 0.56, 0.52]), ash)
    # C2 'not vinyl' (board r5: flat matte vinyl albedo on every tier): thin-skin warmth where blood shows through
    # (ears, nose, knuckles, elbows, the ridges of every crease = a red SSS fringe round the cavities), cool
    # blue-green under thin skin (temples, inner forearm veins, jaw shadow), blotchy mid-scale hue mottling and fine
    # sun spots / freckles -- so skin carries colour noise the cloth and paint don't
    fringe = np.clip(c.cav * 3.0, 0, 1) * (1 - np.clip(c.cav * 1.6 - 0.35, 0, 1))
    rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.22, 0.86, 0.78]), 1), 0.55 * fringe)
    mot = c.noise(16.0, 2, 341)
    rgb = shaders.mix(rgb, rgb * np.array([1.1, 0.9, 0.84]), 0.35 * shaders.smooth01(mot, 0.1, 0.6))     # ruddy blotches
    rgb = shaders.mix(rgb, rgb * np.array([0.92, 1.0, 1.06]), 0.25 * shaders.smooth01(-mot, 0.15, 0.65))  # cool patches
    spots = shaders.smooth01(c.noise(160.0, 1, 342), 0.42, 0.62) * shaders.smooth01(n3, -0.3, 0.4)
    rgb = shaders.mix(rgb, rgb * np.array([0.8, 0.68, 0.6]), 0.4 * spots)                                # sun spots
    veins = np.zeros(c.n)
    for s_ in ("L", "R"):
        t_, d_, ang_ = _limb(P, L["elbow_" + s_], L["wrist_" + s_])
        on_ = (d_ < 0.07) & (t_ > -0.05) & (t_ < 0.6)
        vv = 1 - shaders.smooth01(np.abs(np.sin(ang_ * 2.0 + 6.0 * t_ + 1.5 * c.noise(22.0, 2, 343))), 0.0, 0.35)
        veins = np.maximum(veins, vv * on_ * shaders.smooth01(-np.cos(ang_), -0.2, 0.6))
    rgb = shaders.mix(rgb, rgb * np.array([0.82, 0.9, 1.05]), 0.3 * veins)
    rgb_clean = rgb.copy()
    # r5 per-tier BODY WASH (tier value ladder, board r4: S1 straw 34 vs iron 32, rust 22 vs violet 18 -- one shared
    # skin can't span >= 10-pt steps): straw = ash-whitened body (the 'Ashen' marauder), violet = dark woad. Arms,
    # shoulders and chest only; fades out up the neck (faces stay natural skin) and before the hands; ragged mottled
    # edge, so it reads as daubed paint, never a sleeve or a ring.
    wash_col, wash_amt = pal.get("wash"), pal.get("wash_amt", 0.0)
    if wash_col is not None and wash_amt > 0:
        nk = L["neck"]
        zn = P[:, 2] + 0.025 * c.noise(11.0, 2, 333)            # ragged, daubed edge up the neck (never a ring)
        # fade up the NECK only (radial zone round the neck axis) -- the shoulders / deltoids keep the full wash
        rn = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - float(nk[1])) ** 2)
        neckzone = 1 - shaders.smooth01(rn, 0.1, 0.15)
        wm = 1 - neckzone * shaders.smooth01(zn, float(nk[2]) - 0.06, float(nk[2]) + 0.01)
        headcol = 1 - shaders.smooth01(rn, 0.11, 0.14)          # the head/neck column only (shoulder tops keep it)
        wm *= 1 - headcol * shaders.smooth01(P[:, 2], float(nk[2]) + 0.04, float(nk[2]) + 0.07)   # never on the head
        for sd in ("L", "R"):
            t, d, _ = _limb(P, L["shoulder_" + sd], L["knuckle_" + sd])
            arm = (d < 0.14) & (np.abs(P[:, 0]) > 0.14)
            # C2: dry-brushed, ragged end above the bracer (board r5: a hard 'cuff' line read as a sleeve)
            tend = t + 0.09 * c.noise(9.0, 2, 331) + 0.05 * c.noise(45.0, 2, 335)
            we = pal.get("wash_end", 0.5)          # C2 r9: iron's soot runs down to the bracers (0.84)
            wm = np.where(arm, wm * (1 - shaders.smooth01(tend, we, we + 0.16)), wm)
        wm *= shaders.smooth01(P[:, 2], BELT_Z + 0.02, BELT_Z + 0.12)
        md = pal.get("wash_mott", 0.18)          # straw: deeper mottling = daubed ash, skin shows through (not a sleeve)
        mott = (1 - md) + md * shaders.smooth01(c.noise(14.0, 3, 332) + 0.5 * c.noise(40.0, 2, 334), -0.4, 0.5)
        wcol = np.tile(wash_col, (c.n, 1)) * (1.0 + 0.1 * n1 + 0.05 * n2)[:, None]
        wf = pal.get("wash_form", 0.0)
        if wf:          # C2 r8: lit tops / shadowed under-planes + darker toward the belt, so the paint keeps the form
            upf = shaders.smooth01(c.N[:, 2], -0.6, 0.8)
            hz = shaders.smooth01(P[:, 2], BELT_Z + 0.05, 1.45)
            wcol = wcol * (1.0 - wf * 0.55 + wf * (0.75 * upf + 0.35 * hz))[:, None]
        rgb = shaders.mix(rgb, wcol, np.clip(wash_amt * wm * mott, 0, 1))
    # C2 tier war paint ON bare skin (ref docs/refs/c2/enemies/marauder.png): finger-dragged streaks running DOWN the
    # arms (never round them -> no rings), a handprint clamped over the left deltoid, swipes over the traps, a dry
    # dusting on the forearms; broken dry-brush edges with skin showing through, chalky (rough) -- paint, not a sleeve
    pm, pcol = body_paint(c, pal)
    if pm is not None:
        pcol_v = np.tile(pcol, (c.n, 1)) * (1.0 + 0.08 * n1 + 0.06 * c.noise(60.0, 2, 351))[:, None]
        rgb = shaders.mix(rgb, pcol_v, pm)
    else:
        pm = np.zeros(c.n)
    # r4 arm anatomy planes (board: 'arms read as smooth cylinders'): painted top-light on the arm masses (delt cap /
    # biceps top bright, undersides dark), dark separations (delt insertion V, lateral biceps/triceps line, elbow
    # crease) and a ruddy elbow knob -- value planes that survive the flat stage key at native size
    Ld = norm(V(0.0, -0.35, 0.94))
    plane = np.zeros(c.n)
    sep = np.zeros(c.n)
    armm = np.zeros(c.n)
    for s in ("L", "R"):
        t, d, ang = _limb(P, L["shoulder_" + s], L["elbow_" + s])
        on = ((d < 0.12) & (t > -0.2) & (t < 1.12)).astype(float)
        armm = np.maximum(armm, on)
        # r5: the painted delt-insertion / biceps-line / elbow-crease strokes are gone (board r4: they read as 2-3 dark
        # rings round every bicep); the form is sculpted now (raider_arm) and shaded by the bake + cavity below
        a0, b0 = L["shoulder_" + s], L["elbow_" + s]
        ry = (P[:, 1] - (a0[1] + np.clip(t, 0, 1) * (b0[1] - a0[1]))) / np.maximum(d, 1e-4)   # +1 = back of the arm
        knob = np.exp(-((t - 1.0) / 0.06) ** 2) * shaders.smooth01(ry, 0.2, 0.8) * on                     # elbow point
        rgb = shaders.mix(rgb, pal["skin_warm"] * 0.9, 0.35 * knob)
    sh = shaders.smooth01(c.N @ Ld, -0.45, 0.85)
    shoulders = np.maximum(armm, shaders.smooth01(P[:, 2], 1.38, 1.5) * (np.abs(P[:, 0]) > 0.08))
    rgb *= (1.0 + (0.4 * sh - 0.26) * shoulders)[:, None]
    rgb = shaders.mix(rgb, rgb * np.array([0.45, 0.36, 0.32]), 0.7 * sep)
    # r4 flank shadow: ribs under the armpit (bared by the vest armhole when the arm lifts) -> dark sweaty shadow,
    # not a pale flesh slab
    for s, sx in (("L", 1.0), ("R", -1.0)):
        shp = L["shoulder_" + s]
        fl = np.linalg.norm((P - (shp + V(-sx * 0.05, 0.0, -0.16))) / V(0.08, 0.11, 0.14), axis=1)
        k = (1 - shaders.smooth01(fl, 0.6, 1.15)) * shaders.smooth01(np.abs(c.N[:, 0]), 0.2, 0.6) * (1 - armm)
        rgb = shaders.mix(rgb, rgb * np.array([0.5, 0.42, 0.38]), 0.7 * k)
    # cavity: deep red-brown occlusion in every fold (pec / delt / bicep separations, knuckles, neck); r4: capped on the
    # face so the eye sockets stay legible (dark socket, not a black hole)
    cav = c.cav
    face = shaders.smooth01(P[:, 2], float(L["neck"][2]) + 0.05, float(L["neck"][2]) + 0.09)
    cav_k = np.clip(1.25 * cav, 0, 0.88) * (1 - 0.4 * face) + 0.5 * np.clip(cav, 0, 1) * armm
    rgb = shaders.mix(rgb, rgb * np.array([0.58, 0.40, 0.34]), np.clip(cav_k, 0, 0.9))
    rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.12, 1.06, 0.98]), 1), (0.32 + 0.2 * face) * c.ridge)
    # r5 eyes stay clear: within ~2.5 eye radii, pull back toward the clean skin (soft socket shadow kept)
    ex = c.x.get("eyes") if c.x else None
    if ex:
        er = float(c.x.get("eye_r", 0.012))
        de = np.min(np.stack([np.linalg.norm(P - V(*e), axis=1) for e in ex], 1), 1)
        clear = 1 - shaders.smooth01(de, 1.7 * er, 2.8 * er)
        rgb = shaders.mix(rgb, rgb_clean * 0.84, 0.75 * clear)
    # stubble: dark, speckled shaved scalp + jaw (the head's darkest value after the soot mask)
    st = c.paint("stubble") * ((1 - 0.85 * clear) if ex else 1.0)
    mc = c.x.get("mouth") if c.x else None
    mzone = np.zeros(c.n)
    if mc is not None:      # C2 r9: lips + a ring round them stay skin, so the dark mouth line has a light frame
        dm = np.linalg.norm((P - V(*mc)) / V(0.036, 0.03, 0.019), axis=1)
        mzone = 1 - shaders.smooth01(dm, 0.75, 1.25)
        st = st * (1 - 0.8 * mzone)
    speck = shaders.smooth01(c.noise(700.0, 1, 13), -0.1, 0.5)
    rgb = shaders.mix(rgb, pal["stubble"], np.clip(st * (0.6 + 0.3 * speck), 0, 0.92))
    rgb = shaders.mix(rgb, pal["lips"], 0.75 * c.paint("lips"))
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.12 + 0.02, 1), 0.5 * mzone * (1 - c.paint("lips")))
    scar = c.paint("scar")
    rgb = shaders.mix(rgb, pal.get("scar", shaders.srgb(176, 120, 104)), 0.7 * np.clip(scar * 1.2, 0, 1))
    bp = c.paint("browpaint")
    if bp.any():          # C2 r9: one flat dark bar (the 900/m strand stripes broke it into grey at the game camera)
        rgb = shaders.mix(rgb, pal["brow"], np.clip(bp * 0.95, 0, 0.95))
    ew = np.clip(c.paint("eyewhite"), 0, 1)      # C2 r9: sclera on the cut lid walls of the almond opening
    rgb = shaders.mix(rgb, pal["sclera"] * 0.94, 0.92 * ew)
    mo = np.clip(c.paint("mouth"), 0, 1)
    rgb = shaders.mix(rgb, pal.get("mouth", shaders.srgb(44, 18, 16)), 0.95 * mo)
    tat = c.paint("tattoo")
    rgb = shaders.mix(rgb, pal["tattoo"], 0.9 * tat)
    wp = c.paint("warpaint") * (0.55 + 0.45 * shaders.smooth01(c.noise(90.0, 2, 379), -0.35, 0.3))   # C2 dry-brushed
    rgb = shaders.mix(rgb, WARPAINT[pal.get("tier", "straw")], WARPAINT_AMT[pal.get("tier", "straw")] * wp)
    # r5: no arm war-paint marks (every tier's bands / slashes / smears read as rings round the biceps); the tier
    # identity on the body is the wash above + the face stripes
    wm, wr = 0.0, 0.0
    # C2 roughness map (vinyl = one uniform sheen): oily T-zone + cheekbones, sweat sheen in patches on the shoulders
    # / chest / traps, dry elbows + forearms, fine pore-scale breakup; chalky paint and ash are matte
    tz = shaders.smooth01(P[:, 2], float(L["neck"][2]) + 0.1, float(L["neck"][2]) + 0.14) * \
        shaders.smooth01(-N[:, 1], 0.3, 0.8) * (np.abs(P[:, 0]) < 0.045)
    sweat = shaders.smooth01(c.noise(6.0, 2, 361), 0.0, 0.5) * shaders.smooth01(P[:, 2], 1.2, 1.4) * (1 - face)
    dry = ext
    rough = pal["skin_rough"] + 0.06 * st - 0.14 * c.paint("lips") + 0.06 * n2 + 0.2 * bp + 0.1 * ash + wr * wm + \
        0.1 * wp - 0.16 * tz - 0.14 * sweat + 0.1 * dry + 0.06 * c.noise(90.0, 1, 362) + 0.22 * pm
    rough = rough + 0.12 * c.cav + 0.3 * mo      # C2 r9: no lip sheen over the dark mouth line
    return shaders.out(c.n, rgb, np.clip(rough, 0.3, 0.92))


def _face_mask(c):
    """C2 r8: 1 on the face (brow -> chin, cheek to cheek), 0 past ~12 cm from it or behind the cheekbones."""
    ex = c.x.get("eyes") if c.x else None
    if not ex:
        return np.zeros(c.n)
    E = np.array([V(*e) for e in ex])
    fc = np.mean(E, axis=0) + V(0, 0.0, -0.03)
    d = np.linalg.norm(c.P - fc, axis=1)
    front = 1 - shaders.smooth01(c.P[:, 1] - float(fc[1]), 0.035, 0.075)
    return (1 - shaders.smooth01(d, 0.085, 0.12)) * front


def _eye_zone(c):
    ex = c.x.get("eyes") if c.x else None
    if not ex:
        return np.zeros(c.n)
    er = float(c.x.get("eye_r", 0.012))
    de = np.min(np.stack([np.linalg.norm(c.P - V(*e), axis=1) for e in ex]), axis=0)
    return 1 - shaders.smooth01(de, 1.6 * er, 3.4 * er)


def _face_lit(fn, lift=0.0, socket=0.0):
    """C2 r8 (board r7: all four marauder faces are dark smudges under the helmet brow at the game camera): brighten
    the face (warm bounce on the under-planes, an extra lift in the eye sockets = the 'eye fill') and write the
    face mask into the spare EMIT channel of the prm pass; build() lifts the baked AO off the face with it."""
    def p(c, pal):
        rgb, rough, metal, emit = fn(c, pal)
        m = _face_mask(c)
        if lift or socket:
            low = shaders.smooth01(-c.N[:, 2], -0.3, 0.6)
            rgb = shaders.mix(rgb, np.minimum(rgb * (1 + lift), 1), m)
            rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.16, 1.04, 0.94]), 1), 0.5 * m * low)
            rgb = shaders.mix(rgb, np.minimum(rgb * (1 + socket), 1), _eye_zone(c) * m)
        return rgb, rough, metal, np.maximum(emit, m)
    return p


def p_brow_flat(c, pal):
    """C2 r9 (thief r8 pattern): one flat near-black brow bar with a faint broad drift -- strands broke the bar into
    grey at the game camera."""
    rgb = np.tile(pal["brow"], (c.n, 1)) * (1.0 + 0.08 * c.noise(40.0, 2, 15))[:, None]
    return shaders.out(c.n, rgb, np.full(c.n, pal.get("brow_rough", 0.85)))


PAINTERS = {"skin": _face_lit(p_raider_skin, 0.28, 0.6), "eye": _face_lit(shaders.PAINTERS["eye"]),
            "brow": _face_lit(p_brow_flat), "cloth": p_tunic, "cloth_trim": lambda c, pal: p_tunic(c, pal, "cloth_trim"),
            "pants": keyed(shaders.p_cloth, "pants", "cloth"),
            "tleather": p_tleather,
            "steel": p_steel, "bone": p_bone, "horn": p_horn, "pelt": p_pelt,
            "iron": lambda c, pal: _matte(shaders.p_metal(c, pal, "iron"), 0.18, 0.45),   # r5: no glossy black chains
            "leather": lambda c, pal: _matte(shaders.p_leather(c, pal), 0.2, 0.82),
            "leather_dark": lambda c, pal: _matte(shaders.p_leather_dark(c, pal), 0.15, 0.8)}


def _matte(res, add, lo):
    """r5: roughen a painter result (rgb, rough, metal, emit) -- add, then floor at lo."""
    rgb, rough, metal, emit = res
    return rgb, np.clip(np.maximum(rough + add, lo), 0, 0.97), metal, emit


def tier_pal(tier):
    p = dict(PAL)
    p.update(TIER_PAL[tier])
    p["tier"] = tier
    return p


# ============================================================================ previews
MAT_COLORS = {"skin": (0.55, 0.45, 0.4), "eye": (0.9, 0.9, 0.88), "nail": (0.6, 0.5, 0.45), "brow": (0.05, 0.04, 0.04),
              "cloth": (0.6, 0.5, 0.25), "cloth_trim": (0.35, 0.27, 0.12), "pants": (0.08, 0.07, 0.06),
              "leather": (0.2, 0.13, 0.08), "leather_dark": (0.07, 0.05, 0.04), "fur": (0.25, 0.21, 0.17),
              "bronze": (0.6, 0.45, 0.2), "iron": (0.2, 0.2, 0.22), "sole": (0.05, 0.04, 0.03),
              "tleather": (0.35, 0.22, 0.12), "steel": (0.75, 0.76, 0.8), "bone": (0.9, 0.85, 0.72),
              "horn": (0.35, 0.28, 0.22)}
TIER_CLOTH = {"straw": (0.66, 0.55, 0.26), "rust": (0.5, 0.15, 0.05), "violet": (0.25, 0.08, 0.4),
              "iron": (0.15, 0.2, 0.3)}


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(MARAUDER)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    names = sorted({g for t in tiers for g in TIERS[t]})
    G = build_gear(S, L, H, names, n_ops=info.get("n_ops_tunic"))
    hb = args.h or 0.0045
    if args.preview == "heads":
        lo, hi = V(-0.3, -0.32, 1.35), V(0.3, 0.3, 2.2)
    else:
        lo, hi = None, None
    base = [charkit.mesh_sculpt(S, "body", hb, lo, hi, colors=MAT_COLORS)]
    if args.preview != "heads":
        base.append(charkit.mesh_sculpt(loincloth(info["kilt"]), "kilt", 0.003, colors=MAT_COLORS))
        for s in ("L", "R"):
            w = L["wrist_" + s]
            base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.002, w - 0.16, w + 0.16,
                                            colors=MAT_COLORS))
    gmesh = {}
    for nm, (Sg, _) in G.items():
        lo_g, hi_g = gear_bounds(nm, L)
        gmesh[nm] = charkit.mesh_sculpt(Sg, nm, 0.0022, lo_g, hi_g, colors=MAT_COLORS)
    step = 1.0 if args.preview != "heads" else 0.55
    for i, t in enumerate(tiers):
        dx = V(i * step, 0, 0)
        for b in base:
            o = b if i == 0 else meshutil.duplicate(b, f"{b.name}_{t}")
            o.location = dx
            _tint_cloth(o, t)
        for nm in TIERS[t]:
            o = gmesh[nm] if gmesh[nm].get("used") is None else meshutil.duplicate(gmesh[nm], f"{nm}_{t}")
            gmesh[nm]["used"] = 1
            o.location = dx
    n = len(tiers)
    if args.preview == "heads":
        views = [dict(target=(step * (n - 1) / 2, -0.02, 1.8), ortho=step * n + 0.1, yaw=y, dist=6, pitch=4)
                 for y in (0, 30)]
        preview.render_views(os.path.join(out, "marauder_heads.png"), views, res=(1500, 420))
    else:
        views = [dict(target=(step * (n - 1) / 2, 0, 1.02), ortho=step * n + 0.5, yaw=y, dist=8, pitch=3)
                 for y in (0, 30)]
        preview.render_views(os.path.join(out, "marauder_tiers.png"), views, res=(1400, 760))
        views = [dict(target=(step * (n - 1) / 2, 0, 1.02), ortho=step * n + 0.5, yaw=180, dist=8, pitch=3)]
        preview.render_views(os.path.join(out, "marauder_tiers_back.png"), views, res=(1400, 760))
    print(f"[marauder] preview {args.preview} done in {time.time()-t0:.1f}s")


def _tint_cloth(ob, tier):
    """Clay preview: per-tier cloth colour (own material copies)."""
    for i, m in enumerate(ob.data.materials):
        if m is None:
            continue
        if m.name.startswith("clay_cloth") and not m.name.startswith("clay_cloth_trim"):
            m2 = preview.clay_material(f"clay_cloth_{tier}", TIER_CLOTH[tier])
            ob.data.materials[i] = m2


# ============================================================================ rig helpers
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.03)) / 0.1, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.25)


def skin_body(args, arm, L, H, S, body_lo, hands_lo):
    Pb = meshutil.get_verts(body_lo)
    _, vm, _ = S.eval_points(Pb)
    metal_ids = [S.materials.index(m) for m in ("bronze", "iron") if m in S.materials]
    rigid = skin.rigid_components(body_lo, np.isin(vm, metal_ids))
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(body_lo, arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")],
                       rigid=rigid)
    for s in ("L", "R"):
        skin.skin(hands_lo[s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    return body_W


def kilt_pieces_one_chain(kilt_lo, arm, kp, n):
    """C2 r9 (two agents' stage lineups: 2-6 stretched tris on kilt_B_1<->kilt_L_1 / kilt_F_1<->kilt_R_1 in walk):
    charkit.skin_kilt shares every vertex between the two nearest kilt chains (cosine partition) -- right for a
    continuous skirt, wrong for the marauder's loincloth, which is SEPARATE pieces (front / back panel, 4 tassets):
    a tasset between the L and B chains was sheared when the two springs swung apart. Each connected piece now
    follows ONE chain (the side nearest its centroid): the per-level chain weight is summed onto that chain; the
    hips / thigh blend down the height (skirt_weights) is kept. Returns {piece: side}."""
    names = [b.name for b in arm.data.bones if b.use_deform]
    W = skin.read_groups(kilt_lo, names)
    P = meshutil.get_verts(kilt_lo)
    out = {}
    for g in skin.rigid_components(kilt_lo, np.ones(len(P), bool)):
        c = P[g].mean(0)
        th = math.atan2(float(c[0]), -(float(c[1]) - kp["cy"]) / kp["squash"])
        side = min((("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2)),
                   key=lambda sa: abs(math.atan2(math.sin(th - sa[1]), math.cos(th - sa[1]))))[0]
        for i in range(1, n + 1):
            tgt = names.index(f"kilt_{side}_{i}")
            for sd in "FLBR":
                nm = f"kilt_{sd}_{i}"
                if sd == side or nm not in names:
                    continue
                j = names.index(nm)
                W[g, tgt] += W[g, j]
                W[g, j] = 0.0
        out[len(out)] = (side, len(g))
    W, _ = skin.top_k(W, 4)
    skin.write_groups(kilt_lo, names, W)
    skin.bind(kilt_lo, arm)
    return out


def transfer_weights(dst, src, body_W, arm, k=8, smooth=True):
    """Conforming torso gear takes the body's own weights (nearest body verts, inverse-distance) so it deforms
    exactly like the skin under it (no poke-through at the spine/shoulders)."""
    from mathutils import kdtree
    names, W = body_W
    Ps = meshutil.get_verts(src, world=True)
    kd = kdtree.KDTree(len(Ps))
    for i, p in enumerate(Ps):
        kd.insert(p, i)
    kd.balance()
    P = meshutil.get_verts(dst, world=True)
    out = np.zeros((len(P), W.shape[1]))
    for i, p in enumerate(P):
        res = kd.find_n(p, k)
        ws = np.array([1.0 / (d + 0.004) ** 2 for (_, _, d) in res])
        idx = [j for (_, j, _) in res]
        out[i] = (W[idx] * ws[:, None]).sum(0) / ws.sum()
    out, _ = skin.top_k(out, 4)
    skin.write_groups(dst, names, out)
    skin.bind(dst, arm)


# C2 r9 (board r8, Fable: 'iron has no rim separation against dark crates / barrels'): per-tier glTF material extras
# -> GLTFLoader material.userData -> src/render/characterLook.js (kcaRimScale = per-material scale of the actor rim,
# a uniform: no shader / program change, no GPU cost)
TIER_EXTRAS = {"iron": {"kcaRimScale": 1.35}}


def patch_glb_extras(path, extras):
    """Write `extras` into every material of a GLB in place (JSON chunk only)."""
    import struct
    buf = open(path, "rb").read()
    total = struct.unpack("<I", buf[8:12])[0]
    off, chunks = 12, []
    while off < total:
        ln, ty = struct.unpack("<II", buf[off:off + 8])
        chunks.append([ty, buf[off + 8:off + 8 + ln]])
        off += 8 + ln
    js = json.loads(chunks[0][1].decode("utf-8"))
    for m in js.get("materials", []):
        m.setdefault("extras", {}).update(extras)
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    chunks[0][1] = jb
    body = b"".join(struct.pack("<II", len(c[1]), c[0]) + c[1] for c in chunks)
    with open(path, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)


# ============================================================================ build
def build(args):
    global OUT_MODELS, OUT_TEX
    T0 = time.time()
    report_path = os.path.join(HERE, "out", "marauder_report.json")
    if args.outdir:                       # staging build: models + textures + report go to <outdir> (promote by hand)
        od = os.path.abspath(args.outdir)
        OUT_MODELS = os.path.join(od, "models")
        OUT_TEX = os.path.join(od, "textures")
        os.makedirs(OUT_MODELS, exist_ok=True)
        os.makedirs(OUT_TEX, exist_ok=True)
        report_path = os.path.join(od, "marauder_report.json")
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt, h_gear = ((0.004, 0.0016, 0.0013, 0.003, 0.0018) if fast else
                                              (0.0022, 0.001, 0.0008, 0.0016, 0.0011))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(MARAUDER)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["iron"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}}
    HORNS.clear()

    t = time.time()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = loincloth(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    gnames = [g for g in GEAR if any(g in TIERS[tt] for tt in tiers)]
    G = build_gear(S, L, H, gnames, n_ops=info.get("n_ops_tunic"))
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")

    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN)

    t = time.time()
    his = {}
    if args.stage != "skin":
        body_hi = pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX)
        charkit.drop_islands(body_hi, h_body)
        head_hi = pipeline.sculpt_mesh(S, "head_hi", h_head, HEAD_BOX[0] - 0.012, HEAD_BOX[1] + 0.012,
                                       keep_box=HEAD_BOX)
        his["body"] = [body_hi, head_hi]
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        for nm, (Sg, _) in G.items():
            lo_g, hi_g = gear_bounds(nm, L)
            o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, lo_g, hi_g)
            charkit.drop_islands(o, h_gear, min_verts=40)
            his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    h_lo = 0.0036 if not fast else 0.0045
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, args.hand_tris, w - 0.17, w + 0.17,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.003, args.kilt_tris)
    for nm, (_, Sg) in G.items():
        lo_g, hi_g = gear_bounds(nm, L)
        sym = not nm.endswith(("_L", "_R"))
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0026, GEAR[nm][2], lo_g, hi_g, symmetry=sym,
                                   clean=lambda o: charkit.drop_islands(o, 0.0026, min_verts=30))
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_W = skin_body(args, arm, L, H, S, los["body"], {"L": los["hand_L"], "R": los["hand_R"]})
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN)
    report["kilt_pieces"] = kilt_pieces_one_chain(los["kilt"], arm, KP, KILT_CHAIN)
    pipeline.log(f"kilt pieces -> one chain each: {report['kilt_pieces']}")
    for nm in G:
        bone = GEAR[nm][1]
        if bone:
            charkit.rigid_bind(los[nm], arm, bone)
        else:
            transfer_weights(los[nm], los["body"], body_W, arm)
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt"]
    if args.stage == "skin":
        obs = [los[k] for k in common] + [los[g] for g in TIERS["iron"]]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "marauder_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    # ---------------------------------------------------------------- UV atlas (shared by every tier)
    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=FACE_DENSITY)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.25)
    charkit.smart_uv(los["kilt"], 70.0, 0.9)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, UV_DENSITY.get(nm, 1.3 if nm.startswith("helm") else 1.0))
    order = common + list(G)
    fill = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=6 if not fast else 4, res=res)
    report["uv_fill"] = fill
    # C2 r9: faces whose UVs collapsed to a point sample ONE texel of another island (thief nose shard) -> remap
    report["uv_degenerate_fixed"] = {k: charkit.fix_degenerate_uvs(los[k], res) for k in order}
    pipeline.log(f"degenerate UV faces fixed: {report['uv_degenerate_fixed']}")
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- per-tier paint + bake + export
    extra_p = dict(eyes=info["head"]["eyes"], eye_r=info["head"]["eye_r"], z_knee=L["knee_L"][2],
                   z_chest=L["chest"][2], mouth=info["head"].get("mouth_c"))
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
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, extra_p, painters=PAINTERS)
        for o in all_hi + list(los.values()):
            pipeline.set_ray_visibility(o, False)
        tier_hi = [o for k in parts for o in his[k]]
        jobs = [(los[k], his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], tier_hi)
        spp = dict(albedo=4, prm=2, ao=24 if fast else 48, normal=4 if fast else 8)
        maps = B.run(passes=[("albedo", "EMIT", spp["albedo"]), ("prm", "EMIT", spp["prm"]),
                             ("ao", "EMIT", spp["ao"]), ("normal", "NORMAL", spp["normal"])])
        prefix = f"{ASSET}_{tier}"
        # C2 r8: lift the baked occlusion off the face (mask = prm EMIT channel, written by _face_lit) so the eyes
        # aren't buried under the brow / helmet AO (thief r7 pattern)
        fm = np.clip(maps["prm"][..., 2], 0, 1)
        ao_f = maps["ao"].copy()
        for ch in (0, 1):
            ao_f[..., ch] = ao_f[..., ch] + (1 - ao_f[..., ch]) * fm * (0.5 if ch == 0 else 0.8)
        tex = charkit.composite_maps(dict(maps, ao=ao_f), OUT_TEX, prefix, tint=(0.42, 0.27, 0.23))   # r3: deeper AO
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
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=v["bad"], soft=v["soft"], pairs=v["pairs"]) for k, v in qa.items()}
        pipeline.log(f"[{tier}] stretch QA: " + ", ".join(f"{k}: bad {v['bad']} soft {v['soft']}"
                                                          for k, v in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        if tier in TIER_EXTRAS:
            patch_glb_extras(out, TIER_EXTRAS[tier])
            rep["extras"] = TIER_EXTRAS[tier]
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "straw":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["tiers"][tier] = rep
        pipeline.log(f"[{tier}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(report_path, report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(report_path, report)
    pipeline.log(f"DONE {ASSET} tiers {tiers} in {report['seconds']:.0f}s")


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
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=7600)
    ap.add_argument("--head-tris", type=int, default=2800)
    ap.add_argument("--hand-tris", type=int, default=760)
    ap.add_argument("--kilt-tris", type=int, default=1000)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
