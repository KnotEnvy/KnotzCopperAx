"""Build the Pot Thief (loot enemy, Golden Axe thief DNA) with the blender/lib pipeline -- two sack variants.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_enemy_thief.py -- [options]
Options:
  --preview full|head       clay renders to progress/shots/enemies-art-1/dev/ (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --stage skin              LO + weights + stretch QA only (progress/tmp/thief_skin_test.glb)
  --variants blue,green     export only these sack variants
Default: public/assets/models/enemy_thief_blue.glb (+ copy enemy_thief.glb) and enemy_thief_green.glb,
textures public/assets/textures/enemy_thief_<variant>_*.png, report blender/out/thief_report.json.

Design: a 1.0 m gnome-imp, 4 heads tall. A dark hooded cowl whose floppy point droops to one side, huge pointed
ears poking out through the hood, a long pointy red-tipped nose over a lopsided sly grin, big squinting eyes under
arched brows and a pointy chin. Mustard tunic with a flared skirt (kilt spring chains), rope belt with a pouch,
striped hose on skinny legs, big bare feet in sandals. On his back a HUGE lumpy sack (taller than his torso,
rigid to the chest) roped over both shoulders, tied at the neck with a frilled opening:
  blue  : blue sack (magic pots) -- a glazed pot rim peeks out of the opening
  green : green sack (meat)      -- a roast drumstick bone pokes out
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

from lib.sdf import (V, norm, rot, basis, Sculpt, Warp, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX, Func)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-1", "dev")
ASSET = "enemy_thief"

THIEF = dict(
    height=1.0, head_h=0.26,
    shoulder_x=0.118, shoulder_z=0.655, clav_in_x=0.016,
    hip_x=0.058, hip_joint_z=0.385, pelvis_z=0.41,
    knee_z=0.21, ankle_z=0.05, foot_len=0.175, stance_x=0.078,
    spine_z=0.47, chest_z=0.565, neck_z=0.695, head_base_z=0.745,
    upperarm=0.165, forearm=0.15, hand=0.13,
    arm_down=40.0, arm_fwd=8.0, elbow_bend=14.0, back_socket=False,
)
STYLE = dict(brow=0.8, jaw=0.82, scowl=0.35, cheek=1.3, chin=1.35, nose_len=1.15, nose_w=1.1, nose_bump=0.6,
             lip=0.95, mouth_w=1.3, eye=1.3, squint=1.1, skull_w=1.12, skull_h=1.04, ear=1.0, fem=0.1)
MATERIALS = ["skin", "eye", "nail", "brow", "hood", "tunic", "hose", "leather", "leather_dark", "sole", "rope",
             "iron", "teeth"]
SACK_MATS = ["sack", "sack_patch", "rope", "pot", "meat", "bone"]
KINDS = {"hood": "homespun", "tunic": "burlap", "hose": "cloth", "rope": "cloth", "sack": "burlap",
         "sack_patch": "burlap", "pot": "iron", "meat": "leather", "bone": "nail",
         "brow": "mane_clean"}   # C2 r8: no node-side strand bands on the brows (board r7: 'brows striped noise')
HAND_CUT_T = 0.8
WRIST_CUT_T = 0.9
BELT_Z = 0.44
KILT_CHAIN = 2
LEG_GAP_TOP = 0.33
HEAD_BOX = (V(-0.23, -0.25, 0.735), V(0.23, 0.2, 1.25))
FACE_DENSITY = 3.0
VARIANTS = {"blue": ["sack_blue"], "green": ["sack_green"]}
CLOAK_HEM = 0.47        # C2 capelet hem (ragged) -- the cloak's lower half is the skirt (kilt chains)


# ============================================================================ body
def limb(S, a, b, r0, r1, k=0.02, mat=None):
    S.add(RoundCone(a, b, r0, r1), k, mat=mat)


def body_sculpt(L, gear_on=True):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {}
    # pear-shaped little body (hidden by tunic + cowl), pot belly
    S.add(Ellipsoid(V(0, 0.012, 0.59), V(0.1, 0.082, 0.1)), 0.0)
    S.add(Ellipsoid(V(0, -0.022, 0.5), V(0.112, 0.105, 0.1)), 0.05)
    S.add(Ellipsoid(V(0, 0.012, 0.425), V(0.098, 0.08, 0.07)), 0.05)
    S.add(RoundCone(V(0, 0.02, 0.64), V(0, 0.016, 0.78), 0.045, 0.036), 0.03)
    for s in ("L", "R"):
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        S.add(Sphere(sh, 0.036), 0.03)
        limb(S, sh, el, 0.029, 0.022)
        S.add(Sphere(el, 0.023), 0.012)
        limb(S, el, wr, 0.024, 0.019, k=0.012)
        hp, kn, an = L["hip_" + s], L["knee_" + s], L["ankle_" + s]
        limb(S, hp + V(0, 0, 0.02), kn, 0.05, 0.03, k=0.03)
        S.add(Sphere(kn + V(0, -0.006, 0), 0.032), 0.012)              # knobbly knee
        limb(S, kn, an, 0.029, 0.02, k=0.012)
        S.add(Ellipsoid(kn + (an - kn) * 0.3 + V(0, 0.012, 0), V(0.026, 0.026, 0.05)), 0.02)   # calf
        big_foot(S, L, s)
    info["head"] = anatomy.head(S, L, STYLE)
    imp_face(S, L, info["head"])
    if not gear_on:
        big_ears(S, info["head"]["H"])
        return S, info
    snap = S.snapshot()
    for s in ("L", "R"):
        el, wr, b, Lf = BM.forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.1)), wr - 0.1, wr + 0.1))
        cuff(S, snap, L, s)
        ankle_wrap(S, snap, L, s)
    hose(S, snap)
    tunic(S, snap, L)
    info["kilt"] = kilt_params(S)
    hood(S, L, info["head"]["H"])
    big_ears(S, info["head"]["H"])
    snap2 = S.snapshot()
    rope_belt(S, snap2)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.012)
    return S, info


TEETH = []      # C2 r8: tooth primitives (built as their own 'teeth' part, rigid to the head -- see build())


def imp_face(S, L, hi):
    H = hi["H"]
    s = H.s
    dzm = hi["mouth_dz"]
    TEETH.clear()
    # long pointy nose with a red bulb tip, hooked a touch downward
    S.add(RoundCone(H(0, -0.098, -0.028), H(0, -0.16, -0.07), 0.0165 * s, 0.0105 * s), 0.012)
    S.add(RoundCone(H(0, -0.16, -0.07), H(0, -0.182, -0.088), 0.0105 * s, 0.0085 * s), 0.006)
    S.add(Sphere(H(0, -0.181, -0.087), 0.0105 * s), 0.005)
    for sx in (1, -1):
        # C2 r8: shallow nostrils (the deep pits baked one big LO facet under the nose tip near-black)
        S.sub(Ellipsoid(H(sx * 0.007, -0.172, -0.0975), H.r(0.0032, 0.0045, 0.0018)), 0.002)
    S.paint(Union(Sphere(H(0, -0.178, -0.085), 0.024 * s), Sphere(H(0.052, -0.078, -0.052), 0.022 * s),
                  Sphere(H(-0.052, -0.078, -0.052), 0.022 * s)), "blush", soft=0.02, value=1.0)
    # pointy chin + round cheek apples pushed up by the grin. C2 (board r5: 'lumpy cheek transitions, sharply pinched
    # mouth'): broader, softer apples (wide blend), no corner-dimple spheres; an OPEN cackling grin with crooked teeth
    S.add(Sphere(H(0, -0.094, -0.142), 0.018 * s), 0.016)
    for sx in (1, -1):
        S.add(Ellipsoid(H(sx * 0.048, -0.079, -0.06), H.r(0.026, 0.017, 0.02)), 0.022)
        # soft smile fold from the nose wing down past the mouth corner (raised, wide blend)
        anatomy.surf_chain(S, [H(sx * 0.024, -0.112, -0.07), H(sx * 0.038, -0.1, -0.086 + 0.004 * (sx > 0)),
                               H(sx * 0.044, -0.088, -0.104)], [0.003 * s, 0.006 * s, 0.003 * s],
                           depth=0.004 * s, k=0.008)
    # grin: a crescent opening -- corners pulled up into the cheeks (right corner higher, lopsided), lower lip drops
    xs = np.linspace(-0.04, 0.042, 11)
    line = []
    for x in xs:
        u = x / 0.041
        z = -0.1045 + 0.019 * u * u + 0.004 * max(u, 0) ** 2 + dzm
        y = -0.1015 + 0.02 * u * u
        line.append(H(x, y, z))
    Pl = S.project(np.array(line), offset=0.0)
    Nl = S.grad(Pl)
    cres = []
    rr = []
    for i, x in enumerate(xs):
        u = x / 0.041
        cres.append(Pl[i] - Nl[i] * 0.003 * s + V(0, 0, -0.0045 * s * (1 - u * u)))
        rr.append((0.0022 + 0.0062 * (1 - u * u)) * s)
    S.sub(Chain(cres, rr), 0.003 * s)
    # C2 r8 (board r7: 'the grin is a fused grey gum-tooth mass / jagged shards'): two SEPARATE rows with a dark
    # mouth gap between them. Upper row hangs from the top of the opening (3 blunt incisors, one a long
    # snaggle tooth), lower row rises from the bottom (3 shorter teeth, between the uppers); 5-7 mm of
    # dark mouth shows between the rows. Tight blends (k 0.6 mm) so neighbours never web together.
    # Each row is anchored by marching from the centre of the carved opening straight up (roof) / down (floor) to the
    # real cavity surface, so the teeth are rooted 1 mm into the gum whatever the face curvature does at the corners
    # (only the middle of the grin: at the corners the opening is too shallow and teeth poked through the cheeks).
    def _march(p, d, t_max=0.03):
        t = 0.0
        while t < t_max:
            dist = float(S.dist((p + d * t)[None])[0])
            if dist < 2e-4:
                return p + d * t
            t += max(dist * 0.9, 2e-4)
        return None
    for j in (4, 5, 6):
        c0 = cres[j] - Nl[j] * 0.0012 * s           # tooth axis 4.2 mm behind the lip surface
        roof = _march(c0, V(0, 0, 1), 0.012 * s)    # off-centre starts can sit outside the carve -> skip them
        if roof is None or float(S.dist(c0[None])[0]) < 0:
            continue
        top = roof + V(0, 0, 0.001 * s)
        ln = (0.0068 if j == 4 else 0.0047 - 0.0006 * (j == 6)) * s + 0.001 * s
        r0 = (0.0035 - 0.0004 * abs(xs[j] / 0.041)) * s
        TEETH.append(RoundCone(top, top - V(0, 0, ln), r0, r0 * (0.6 if j == 4 else 0.84)))
    for j in (3, 4, 5):                    # lowers sit BETWEEN the uppers
        c0 = (cres[j] + cres[j + 1]) / 2 - norm(Nl[j] + Nl[j + 1]) * 0.0016 * s
        floor = _march(c0, V(0, 0, -1), 0.014 * s)
        if floor is None or float(S.dist(c0[None])[0]) < 0:
            continue
        bot = floor - V(0, 0, 0.001 * s)
        ln = (0.0036 + 0.0006 * (j == 4)) * s + 0.001 * s
        r0 = 0.003 * s
        TEETH.append(RoundCone(bot, bot + V(0, 0, ln), r0, r0 * 0.78))
    # The teeth are NOT added to the head sculpt: decimated into the 3.6k-tri head they only existed as albedo
    # projected onto the cavity (board r7: 'jagged shards'). build() makes them a separate small LO part.
    # dark mouth interior: paint only the carved cavity (the chain pushed 2 mm further in than the cut)
    inner = [p - Nl[i] * 0.0015 * s for i, p in enumerate(cres)]
    S.paint(Chain(inner, [r + 0.0008 * s for r in rr]), "mouth", soft=0.0015, value=1.0)
    S.paint(Chain(list(Pl), [0.006 * s] * len(Pl)), "lips", soft=0.004, value=0.7)
    anatomy.eyebrows(S, H, scowl=0.3, thick=1.25)


def big_ears(S, H):
    s = H.s
    for sx in (1, -1):
        pts = [H(sx * 0.088, 0.018, -0.03), H(sx * 0.125, 0.035, -0.008), H(sx * 0.165, 0.055, 0.026),
               H(sx * 0.198, 0.072, 0.062)]
        rr = [0.022 * s, 0.019 * s, 0.011 * s, 0.0032 * s]
        ref = tuple(norm(V(sx * 0.35, -1.0, 0.1)))
        S.add(Chain(pts, rr, squash=(0.32, 1.0), ref=ref), 0.006, mat="skin")
        inner = [p + V(*ref) * 0.006 * s for p in pts[:3]]
        S.sub(Chain(inner, [r * 0.55 for r in rr[:3]], squash=(0.3, 1.0), ref=ref), 0.004)
        S.paint(Chain(pts, [r * 1.3 for r in rr]), "blush", soft=0.01, value=0.7)


def big_foot(S, L, side):
    an, ball, toe = L["ankle_" + side], L["ball_" + side], L["toe_" + side]
    sx = 1 if side == "L" else -1
    S.add(RoundCone(an, an + V(0, 0.028, -0.03), 0.026, 0.026), 0.015)                  # heel
    S.add(RoundCone(an + V(0, 0.01, -0.02), ball + V(0, 0, 0.002), 0.026, 0.03, squash=(1.0, 1.5), ref=(0, 0, 1)),
          0.015)
    for i, (dx, ln, r) in enumerate(((-0.022, 0.046, 0.0135), (-0.004, 0.04, 0.0105), (0.012, 0.036, 0.0095),
                                     (0.026, 0.03, 0.0085))):
        b0 = ball + V(sx * dx, -0.004, -0.004)
        S.add(RoundCone(b0, b0 + V(sx * dx * 0.2, -ln, -0.008), r, r * 0.9), 0.006)
        S.add(Ellipsoid(b0 + V(sx * dx * 0.2, -ln + 0.004, -0.003), V(r * 0.7, r * 0.5, r * 0.3)), 0.002, mat="nail")


def sandal(S, snap, L, side):
    an, ball = L["ankle_" + side], L["ball_" + side]
    lo, hi = V(an[0] - 0.09, an[1] - 0.2, -0.05), V(an[0] + 0.09, an[1] + 0.1, 0.13)
    sole = Inter(RoundBox(V(an[0], (an[1] + ball[1]) / 2 - 0.02, 0.006), V(0.038, 0.1, 0.007), r=0.006),
                 Offset(snap, 0.02), k=0.002)
    S.add(Bounded(RoundBox(V(an[0], (an[1] + ball[1]) / 2 - 0.022, 0.007), V(0.042, 0.104, 0.007), r=0.006),
                  lo, hi), 0.002, mat="sole")
    for c, n, hw in ((ball + V(0, 0.012, 0.0), norm(V(0, 1, 0.25)), 0.008),
                     (an + V(0, -0.02, 0.0), norm(V(0, 1, -0.6)), 0.007),
                     (an + V(0, 0.0, 0.035), V(0, 0, 1), 0.007)):
        S.add(Bounded(Inter(Offset(snap, 0.004), Slab(c, n, hw), k=0.002), lo, hi), 0.0015, mat="leather")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def ankle_wrap(S, snap, L, side):
    """C2 (ref pot_thief.png: barefoot, wrapped shins): three loose rag wraps round the ankle / lower shin; the big
    bare foot stays skin."""
    an, kn = L["ankle_" + side], L["knee_" + side]
    ax = norm(kn - an)
    lo, hi = an - V(0.08, 0.08, 0.06), an + V(0.08, 0.08, 0.14)
    for i, (t, tilt) in enumerate(((0.035, 0.25), (0.06, -0.2), (0.085, 0.3))):
        c = an + ax * t
        n = norm(ax + V(tilt * (0.5 if side == "L" else -0.5), tilt * 0.6, 0))
        band = Inter(Offset(snap, 0.0055 + 0.001 * i), Slab(c, n, 0.0085), Sphere(c, 0.06), k=0.002)
        S.add(Bounded(Displace(band, 0.001, 30.0, 2, seed=70 + i), lo, hi), 0.002, mat="tunic")
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


def cuff(S, snap, L, side):
    el, wr, b, Lf = BM.forearm_frame(L, side)
    c = el + b * Lf * 0.86
    S.add(Bounded(Inter(Offset(snap, 0.007), Slab(c, b, 0.026), k=0.002), wr - 0.12, wr + 0.12), 0.002, mat="tunic")


def hose(S, snap):
    # C2: ragged trousers end mid-shin into the ankle wraps (bare ankles + feet below)
    reg = Inter(Offset(snap, 0.003), HalfSpace(V(0, 0, BELT_Z), V(0, 0, 1)), HalfSpace(V(0, 0, 0.115), V(0, 0, -1)),
                k=0.003)
    S.add(Bounded(reg, V(-0.25, -0.2, 0.03), V(0.25, 0.2, BELT_Z + 0.02)), 0.0, mat="hose")


def tunic(S, snap, L):
    t = 0.008
    nk = L["neck"]
    # sleeves to mid-upper-arm. r3: the arm-plane cutter (sphere r 0.42 round the elbow) also sliced the lower pot
    # belly on this tiny body -> a bare skin crescent between tunic and skirt. Keep the cut outboard of the torso.
    cuts = [Inter(BM.arm_cutter(L, s, t=0.55)[0], HalfSpace(V((1 if s == "L" else -1) * 0.125, 0, 0),
                                                            V(-1 if s == "L" else 1, 0, 0))) for s in ("L", "R")]
    reg = Diff(Inter(Offset(snap, t), HalfSpace(V(0, 0, float(nk[2]) + 0.03), V(0, 0, 1)),
                     HalfSpace(V(0, 0, BELT_Z - 0.03), V(0, 0, -1)), k=0.004), Union(*cuts), k=0.004)
    S.add(Bounded(Displace(reg, 0.0015, 18.0, 2, seed=3), V(-0.4, -0.3, BELT_Z - 0.06), V(0.4, 0.3, 0.82)), 0.0,
          mat="tunic")
    for s in ("L", "R"):
        C, c, a = BM.arm_cutter(L, s, t=0.55)
        band = Inter(Offset(snap, t + 0.003), Slab(c - a * 0.007, a, 0.006), Sphere(c, 0.1), k=0.0015)
        S.add(Bounded(band, c - 0.11, c + 0.11), 0.0015, mat="tunic")


def kilt_params(S, z=BELT_Z - 0.01):
    c = V(0, 0.0, z)
    xs = ray_hit(S, c, V(1, 0, 0))[0]
    yf = ray_hit(S, c, V(0, -1, 0))[1]
    yb = ray_hit(S, c, V(0, 1, 0))[1]
    rx = float(xs) + 0.01
    ry = (float(yb) - float(yf)) / 2 + 0.01
    # C2: the skirt is now the cloak's long tattered lower half -> down to the knee, wider flare
    return dict(top_z=BELT_Z + 0.012, hem_z=0.235, r_top=rx, r_hem=rx * 1.5, squash=ry / rx, cy=float(yf + yb) / 2)


def hood(S, L, H):
    """Cowl + pointed hood: conforming cloth over the head/shoulders, face opening cut with a steep ellipsoid and a
    rolled hem on the kept side, floppy point drooping to the left."""
    s = H.s
    snap = S.snapshot()
    nk = L["neck"]
    # C2 r7 (board r6: 'at the game camera the hood interior is a near-black blob, eyes and grin never read'): the
    # game camera sees the thief side-on, and the old narrow opening (x radius 8.4 cm) left the hood's side panels
    # forward of the eyes. Opening now ~as wide as the skull, its side edge cut back ~4 cm behind the eye, the brim at
    # the hairline -> eyes, nose and grin stand forward of the cloth in profile (ref pot_thief_face.png)
    face = Ellipsoid(H(0, -0.112, -0.04), H.r(0.12, 0.122, 0.12))
    cowl_keep = Inter(Sphere(V(0, 0.01, float(nk[2]) + 0.03), 0.2),
                      HalfSpace(V(0, 0, float(L["shoulder_L"][2]) - 0.075), V(0, 0.35, -1)), k=0.01)
    arms = Union(*[BM.arm_cutter(L, sd, t=0.32)[0] for sd in ("L", "R")])
    head_keep = Sphere(H(0, 0.01, 0.0), 0.2 * s)
    reg = Union(Inter(Offset(snap, 0.025), head_keep),   # C2: looser (a balaclava hugged the skull)
                Diff(Inter(Offset(snap, 0.02), cowl_keep), arms, k=0.004),
                k=0.02)
    tip = [H(0, 0.03, 0.07), H(0, 0.055, 0.15), H(0.025, 0.075, 0.215), H(0.07, 0.08, 0.25), H(0.115, 0.062,
                                                                                                 0.235)]
    reg = Union(reg, Chain(tip, [0.085 * s, 0.056 * s, 0.034 * s, 0.02 * s, 0.01 * s]), k=0.03)
    # r5: the opening's outline wanders (cloth edge, not a cut oval) and sags lower on the left
    face_cut = Displace(Union(face, Ellipsoid(H(0.025, -0.14, -0.075), H.r(0.08, 0.1, 0.09)), k=0.02), 0.0045 * s,
                        16.0, 2, seed=41)
    reg = Diff(reg, face_cut, k=0.006)
    lo, hi = V(-0.36, -0.3, 0.45), V(0.36, 0.3, 1.25)
    # r5 (board r4: 'the hood is a rigid tube framing the face'): broad cloth undulation on top of the weave noise,
    # a thinner, irregular rolled edge, and drape folds sculpted in below
    S.add(Bounded(Displace(Displace(reg, 0.002, 16.0, 3, seed=19), 0.0035, 5.0, 2, seed=23), lo, hi), 0.0, mat="hood")
    # rolled hem only across the TOP of the opening (folded back over the brow), fading out down the cheeks
    rim = Inter(Offset(snap, 0.028), Diff(Offset(face_cut, 0.013), face_cut), head_keep,
                HalfSpace(H(0, 0, -0.035), V(0, 0, -1)), k=0.012)
    S.add(Bounded(Displace(rim, 0.0018, 22.0, 2, seed=29), lo, hi), 0.003, mat="hood")
    hood_folds(S, L, H)
    # patch on the hood side (sewn square)
    p = ray_hit(S, H(0, 0.0, 0.03), V(-0.8, 0.4, 0.5))
    n = S.grad(p[None])[0]
    S.add(RoundBox(p, V(0.022, 0.018, 0.003), basis(n)[:, [1, 2, 0]], r=0.003), 0.002, mat="tunic")


def cloak(L, S_body):
    """C2 (board r5: 'no cloak -- the hood is a balaclava over a short-sleeve shirt'; ref pot_thief.png): a ragged
    hooded CLOAK = this capelet (a separate cloth shell from the cowl over the shoulders + upper arms, open in front
    in a V that shows the tunic + rope belt, tattered hem, drape flutes, sewn patches) + the long tattered cloak skirt
    (kilt chains). A separate mesh (sleeve-weighted), so arms moving under it never tear the body skin."""
    S = Sculpt(materials=MATERIALS, default_mat="hood")
    snap = S_body.snapshot()
    nk = L["neck"]
    zt = float(nk[2]) + 0.035
    cy = -0.028
    bell = RoundCone(V(0, cy + 0.01, zt - 0.02), V(0, cy, CLOAK_HEM - 0.03), 0.07, 0.205, squash=(0.56, 1.0))

    def flute(X, Y, Z):
        dy = Y - cy
        r = np.sqrt(X * X + dy * dy) + 1e-6
        ang = np.arctan2(X, -dy)
        f = np.clip((zt - Z) / (zt - CLOAK_HEM), 0.0, 1.0)
        w = 0.008 * f ** 1.4 * np.sin(11.0 * ang + 1.1 * np.sin(2.0 * ang + 0.7) + 0.5 * np.sin(5.0 * ang))
        return X / r * w, dy / r * w, 0.0 * Z
    # wide ragged SLEEVES over the upper arms, flaring past the elbow (ref: the cloak hangs off the arms)
    sleeves = []
    sleeve_cuts = []
    for sd in ("L", "R"):
        sh, el = L["shoulder_" + sd], L["elbow_" + sd]
        ax = norm(el - sh)
        Lu = float(np.linalg.norm(el - sh))
        sleeves.append(RoundCone(sh - ax * 0.01, sh + ax * (Lu * 1.12), 0.05, 0.07))
        cpt = sh + ax * (Lu * 1.1)
        sleeve_cuts.append(Inter(HalfSpace(cpt, -ax), Sphere(cpt, 0.14)))
    solid = Union(Warp(bell, flute, pad=0.012), *sleeves, k=0.03)
    shell = Diff(Shell(solid, 0.0042), Displace(Union(*sleeve_cuts), 0.008, 14.0, 2, seed=85), k=0.003)

    def hem(X, Y, Z):
        """Tattered hem: jagged rag points (sawtooth by angle) + noise, lower at the back and sides."""
        ang = np.arctan2(X, -(Y - cy))
        saw = np.abs(((ang * 13.0 / (2 * math.pi) + 0.3 * np.sin(3.0 * ang)) % 1.0) - 0.5) * 2.0   # 0..1 tri
        zh = CLOAK_HEM - 0.03 * (1 - saw) ** 1.6 - 0.012 * np.sin(5.0 * ang + 1.0) + 0.012 * np.cos(ang)
        return (zh - Z) * 0.45
    hemcut = Func(hem, V(-0.5, -0.5, -0.1), V(0.5, 0.5, 1.5))
    top = HalfSpace(V(0, 0, zt - 0.045), V(0, 0, 1))   # the top edge hides under the hood's cowl
    k = 0.9                                    # front V opening: apex under the chin, widening to the hem
    z0 = float(L["chest"][2]) + 0.05
    vcut = Inter(HalfSpace(V(0, 0, z0), norm(V(1, 0, k))), HalfSpace(V(0, 0, z0), norm(V(-1, 0, k))),
                 HalfSpace(V(0, -0.02, 0), V(0, 1, 0)))
    reg = Diff(Inter(shell, hemcut, top, k=0.003), Displace(vcut, 0.004, 18.0, 2, seed=81), k=0.004)
    lo, hi = V(-0.32, -0.3, CLOAK_HEM - 0.08), V(0.32, 0.3, zt + 0.02)
    S.add(Bounded(Displace(Displace(reg, 0.0014, 22.0, 2, seed=83), 0.003, 6.0, 2, seed=84), lo, hi), 0.0)
    # sewn patches (rag cloth) on the left shoulder + right back, a few torn holes near the hem
    for d, sz in ((V(0.75, -0.45, 0.55), V(0.026, 0.022, 0.003)), (V(-0.6, 0.6, 0.2), V(0.03, 0.026, 0.003)),
                  (V(0.3, -0.9, -0.25), V(0.02, 0.024, 0.003))):
        p = ray_hit(S, V(0, -0.01, 0.6), norm(d), r_max=0.4)
        n = S.grad(p[None])[0]
        S.add(RoundBox(p + n * 0.001, sz, basis(n, V(0, 0, 1))[:, [1, 2, 0]], r=0.003), 0.0015, mat="tunic")
    S.solid = Sculpt(materials=MATERIALS, default_mat="hood")     # projection target for the sack straps
    S.solid.add(Bounded(Inter(solid, top), lo - 0.05, hi + 0.05), 0.0)
    S.solid.add(snap, 0.0)
    return S


def _fold(S, pts, r, pro, mat, k=0.008):
    """Broad soft cloth fold: a wide tube sunk to show only `pro` of its crown; tapered ends sink away."""
    anatomy.surf_chain(S, pts, [r * 0.45, r, r * 0.55] if len(pts) == 3 else [r * 0.45, r, r * 0.9, r * 0.45],
                       depth=r - pro, k=k, mat=mat)


def hood_folds(S, L, H):
    """r5 hood drape: folds sweeping from the face opening back over the skull and down to the nape, a crease over
    the crown, and the cowl's folds radiating from the neck over the shoulders (back + sides, never the face)."""
    s = H.s
    for sx in (1, -1):
        _fold(S, [H(sx * 0.09, -0.075, 0.02), H(sx * 0.112, -0.01, -0.02), H(sx * 0.1, 0.055, -0.085)],
              0.014 * s, 0.0035 * s, "hood")
        _fold(S, [H(sx * 0.085, -0.085, -0.075), H(sx * 0.105, -0.03, -0.125), H(sx * 0.1, 0.025, -0.175)],
              0.013 * s, 0.0035 * s, "hood")
        _fold(S, [H(sx * 0.05, -0.07, 0.095), H(sx * 0.07, -0.0, 0.11), H(sx * 0.07, 0.07, 0.07)],
              0.012 * s, 0.003 * s, "hood")
    nk = L["neck"]
    for sx in (1, -1):        # V-folds under the chin, falling from the opening's lower corners into the cowl
        _fold(S, [H(sx * 0.06, -0.1, -0.13), H(sx * 0.045, -0.105, -0.17), nk + V(sx * 0.03, -0.1, -0.05)],
              0.012 * s, 0.0035 * s, "hood")
    for a in (-2.5, -1.75, -1.05, 1.0, 1.7, 2.45, 3.1):
        d = V(math.sin(a), -math.cos(a), 0)
        _fold(S, [nk + d * 0.065 + V(0, 0, 0.005), nk + d * 0.1 + V(0, 0, -0.035), nk + d * 0.135 + V(0, 0, -0.07)],
              0.014, 0.0038, "hood")


def rope_belt(S, snap):
    ring = []
    for i in range(49):
        a = i / 48 * 2 * math.pi
        # start INSIDE the waist: project() then walks out to the torso (a 0.3 m ring snapped onto the A-pose hands)
        ring.append(V(math.sin(a) * 0.06, -math.cos(a) * 0.05, BELT_Z + 0.004 * math.sin(3 * a)))
    P = S.project(np.array(ring), offset=0.004)
    S.add(Chain(list(P), 0.0085, margin=0.02), 0.002, mat="rope")
    # knot + pouch on the right hip
    kp = ray_hit(S, V(0, 0, BELT_Z), V(-0.4, -1, 0))
    S.add(Sphere(kp, 0.014), 0.003, mat="rope")
    pp = ray_hit(S, V(0, 0, BELT_Z - 0.04), V(-1, -0.3, 0))
    nrm = S.grad(pp[None])[0]
    S.add(Ellipsoid(pp + nrm * 0.02 + V(0, 0, -0.01), V(0.03, 0.028, 0.038)), 0.008, mat="leather")
    S.add(Ellipsoid(pp + nrm * 0.024 + V(0, 0, 0.022), V(0.026, 0.024, 0.01)), 0.004, mat="leather_dark")


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    el, wr = L["elbow_" + side], L["wrist_" + side]
    limb(S, el, wr, 0.024, 0.019, k=0.0)
    anatomy.hand(S, L, side, "relaxed", STYLE)
    anatomy.hand_details(S, L, side)
    el, wr, b, Lf = BM.forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


def skirt(kp):
    """Flared skirt in 6 overlapping panels (kilt chains). C2: the 4 side/back panels are the CLOAK's tattered lower
    half (cloak cloth, jagged rag hem to the knee); the 2 front panels are the shorter tunic skirt seen through the
    cloak's front opening."""
    S = Sculpt(materials=MATERIALS, default_mat="tunic")
    rng = np.random.RandomState(11)
    cy = kp["cy"]
    n = 6
    z_top, z_hem = kp["top_z"], kp["hem_z"]

    def flute(X, Y, Z):
        """r5 (board r4: 'burlap skirt reads as wood-plank grain'): radial pleats gathered at the belt, opening into
        soft flutes toward the hem (amplitude 0 -> 9 mm), slightly irregular -- cloth, not barrel staves."""
        dy = (Y - cy)
        r = np.sqrt(X * X + dy * dy) + 1e-6
        ang = np.arctan2(X, -dy)
        f = np.clip((z_top - Z) / (z_top - z_hem), 0.0, 1.0)
        amp = 0.009 * f ** 1.3
        w = amp * np.sin(17.0 * ang + 0.9 * np.sin(3.0 * ang + 1.3) + 0.6 * np.sin(5.0 * ang))
        return X / r * w, dy / r * w, 0.0 * Z
    for i in range(n):
        a_c = (i + 0.5) / n * 2 * math.pi
        layer = i % 2
        front = i in (0, n - 1)
        a_half = math.pi / n * (1.2 if layer else 1.1)      # r5: panels overlap (slits read as barrel staves)
        hz = (kp["hem_z"] + 0.06 if front else kp["hem_z"]) - 0.008 * layer
        cone = RoundCone(V(0, cy, kp["top_z"] + 0.04), V(0, cy + 0.008, hz - 0.05), kp["r_top"] - 0.01 + 0.004 * layer,
                         kp["r_hem"] + 0.02 + 0.006 * layer, squash=(kp["squash"], 1.0))
        sh = Shell(Warp(cone, flute, pad=0.012), 0.0045)
        d0 = V(math.sin(a_c - a_half), -math.cos(a_c - a_half), 0)
        d1 = V(math.sin(a_c + a_half), -math.cos(a_c + a_half), 0)
        n0 = norm(np.cross(V(0, 0, 1), d0)) * -1.0
        n1 = norm(np.cross(V(0, 0, 1), d1))
        wc = V(0, cy, 0)
        # scalloped hem: a big ellipsoid per panel instead of a flat cut
        scal = Ellipsoid(V(math.sin(a_c) * 0.2, cy - math.cos(a_c) * 0.2 * kp["squash"], hz + 0.1),
                         V(0.5, 0.5, 0.115))
        reg = Inter(sh, HalfSpace(wc, n0), HalfSpace(wc, n1), scal, HalfSpace(V(0, 0, kp["top_z"]), V(0, 0, 1)),
                    k=0.004)
        if not front:     # rag tatters: V notches cut up into the hem between ragged points
            notches = []
            for j in range(4):
                aj = a_c + (j - 1.5) / 4 * 2 * a_half + rng.uniform(-0.08, 0.08)
                rr_ = kp["r_hem"] + 0.015
                pc = V(math.sin(aj) * rr_, cy - math.cos(aj) * rr_ * kp["squash"], hz - 0.03)
                radial = V(math.sin(aj), -math.cos(aj) * kp["squash"], 0)
                notches.append(Ellipsoid(pc, V(0.022, rng.uniform(0.035, 0.06), rng.uniform(0.006, 0.01)),
                                         basis(radial, V(0, 0, 1))))
            reg = Diff(reg, Union(*notches), k=0.004)
        S.add(Bounded(Displace(reg, 0.0015, 20.0, 2, seed=60 + i), V(-0.34, -0.34, hz - 0.08),
                      V(0.34, 0.34, kp["top_z"] + 0.03)), 0.0, mat="tunic" if front else "hood")
    return S


def sack(variant, L, S_body=None, S_cloak=None):
    """HUGE lumpy sack (rigid to chest): pot bulges, sewn patch, gathered neck tied with rope, frilled opening,
    rope straps over both shoulders; blue = a glazed pot rim peeks out, green = a roast drumstick."""
    S = Sculpt(materials=SACK_MATS, default_mat="sack")
    rng = np.random.RandomState(5 if variant == "blue" else 6)
    c = V(0, 0.27, 0.64)
    # r4 (board: 'smooth rigid balloons'): a slumped, HEAVY pear -- narrow gathered top, the load settled into a wide
    # sagging bottom that bellies out behind, a flattened face where it presses on the thief's back, a squashed base;
    # contents push angular lumps through the cloth low down; creases radiate from the gathered neck, a sag crease
    # where the top slumps onto the load, a raised side seam.
    upper = Ellipsoid(c + V(0, -0.005, 0.13), V(0.16, 0.13, 0.17))
    lower = Ellipsoid(c + V(0.03, 0.04, -0.11), V(0.28, 0.21, 0.19))      # load slumped low + a little to one side
    # r5 (board r4: 'long straight recessed channels + a rigid horizontal ledge = moulded shell'): the top melts into
    # the load (wide blend, no shoulder), the cloth is pulled taut over the contents (bigger, tighter lumps) and sags
    # between them; folds are RAISED, curved, and run from the gathered neck toward each lump's crown.
    mass = Inter(Union(upper, lower, k=0.15), HalfSpace(V(0, 0, c[2] - 0.29), V(0, 0, -1)),
                 HalfSpace(V(0, 0.085, 0), V(0, -1, 0)), k=0.06)
    S.add(Displace(Displace(mass, 0.007, 6.0, 3, seed=2), 0.006, 2.5, 2, seed=4), 0.0, mat="sack")
    crowns = []
    for i in range(6):                                 # pots/meat pressing through the cloth (settled low, behind)
        a = rng.uniform(-2.2, 2.2)
        z = rng.uniform(0.42, 0.66)
        d = norm(V(math.sin(a), abs(math.cos(a)) * 0.6 + 0.5, (z - 0.55) * 0.8))
        p = c + V(d[0] * 0.21, 0.035 + d[1] * 0.14, z - 0.64)
        S.add(RoundBox(p, V(0.05, 0.05, 0.045) * rng.uniform(0.95, 1.3), rot(0, 0, math.degrees(a)), r=0.032), 0.032,
              mat="sack")
        crowns.append((p, d))
    # gathered neck + rope tie + frill
    top = V(0, 0.29, 0.93)
    S.add(RoundCone(top - V(0, 0, 0.04), top + V(0, 0.01, 0.06), 0.085, 0.05), 0.04, mat="sack")
    for j in range(10):                                # gathers (vertical folds, raised -- never carved holes)
        a = j / 10 * 2 * math.pi
        S.add(Capsule(top + V(math.cos(a) * 0.078, math.sin(a) * 0.078, -0.05),
                      top + V(math.cos(a) * 0.05, math.sin(a) * 0.05, 0.05), 0.009), 0.012, mat="sack")
    S.add(Torus(top + V(0, 0.004, 0.035), 0.056, 0.011), 0.004, mat="rope")
    S.add(Sphere(top + V(0.05, -0.03, 0.03), 0.017), 0.004, mat="rope")
    S.add(Chain([top + V(0.055, -0.04, 0.02), top + V(0.07, -0.06, -0.04), top + V(0.075, -0.065, -0.1)], 0.008),
          0.003, mat="rope")
    frill = Diff(Torus(top + V(0, 0.01, 0.1), 0.07, 0.03, squash=0.6), Sphere(top + V(0, 0.01, 0.14), 0.07), k=0.01)
    S.add(Displace(frill, 0.006, 30.0, 2, seed=9), 0.02, mat="sack")
    if variant == "blue":                              # glazed pot rim + neck in the opening
        pc = top + V(0, 0.01, 0.13)
        S.add(RoundCone(pc - V(0, 0, 0.03), pc + V(0, 0, 0.02), 0.045, 0.034), 0.006, mat="pot")
        S.add(Torus(pc + V(0, 0, 0.024), 0.04, 0.009), 0.004, mat="pot")
        S.sub(Sphere(pc + V(0, 0, 0.052), 0.033), 0.004)
    else:                                              # drumstick: meat mass + bone with knob
        mc = top + V(-0.01, 0.0, 0.12)
        S.add(Ellipsoid(mc, V(0.05, 0.045, 0.04)), 0.01, mat="meat")
        b0, b1 = mc + V(0.02, -0.01, 0.03), mc + V(0.07, -0.05, 0.12)
        S.add(Capsule(b0, b1, 0.012), 0.004, mat="bone")
        for sx in (1, -1):
            S.add(Sphere(b1 + V(sx * 0.012, 0.004, 0.006), 0.016), 0.004, mat="bone")
    # folds: from the gathered neck toward the crown of each content lump (the load pulls the cloth there), curving
    # over the slump; uneven lengths, all raised + tapered -- no carved channels, no horizontal crease
    for j, (p, d) in enumerate(crowns):
        nrm = norm(V(p[0] - top[0], p[1] - top[1], 0))
        start = top + nrm * 0.085 + V(0, 0, -0.06)
        mid = (start + p) * 0.5 + V(0, 0, 0.02) + nrm * 0.07
        end = p + nrm * 0.03 + V(0, 0, 0.01)
        anatomy.surf_chain(S, [start, mid, end], [0.007, 0.02, 0.009], depth=0.02 - 0.0075, k=0.012, mat="sack")
    for a in (-0.4, 0.9, 2.6):                         # a few short gather folds dying out on the upper slump
        dd = V(math.sin(a), math.cos(a) * 0.8, 0)
        raw = [top + dd * 0.08 + V(0, 0, -0.06), top + dd * 0.13 + V(0, 0, -0.12), top + dd * 0.17 + V(0, 0, -0.17)]
        anatomy.surf_chain(S, raw, [0.006, 0.012, 0.005], depth=0.012 - 0.004, k=0.01, mat="sack")
    for sx in (1, -1):
        raw = np.array([V(sx * 0.3, 0.3, z) for z in np.linspace(0.42, 0.84, 10)])
        P = S.project(raw, offset=0.001)
        S.add(Chain(list(P), 0.0035), 0.004, mat="sack")
    # sewn patch on the right side
    pp = ray_hit(S, c, V(-0.9, 0.2, 0.2), r_max=0.5)
    n = S.grad(pp[None])[0]
    S.add(RoundBox(pp, V(0.055, 0.05, 0.004), basis(n, V(0, 0, 1))[:, [1, 2, 0]], r=0.005), 0.004, mat="sack_patch")
    # rope straps over the shoulders (front), from the sack top round under the armpits back to the sack
    for sx in (1, -1):                   # backpack-style loops: sack top -> over the shoulder -> down the chest ->
        mid = [V(sx * 0.075, 0.03, 0.73), V(sx * 0.08, -0.07, 0.68), V(sx * 0.085, -0.1, 0.6),
               V(sx * 0.1, -0.075, 0.53), V(sx * 0.115, 0.0, 0.52)]           # under the armpit -> back into the sack
        Sp = S_cloak.solid if S_cloak is not None else S_body     # C2: the straps lie over the cloak
        if Sp is not None:
            mid = list(Sp.project(np.array(mid), offset=0.008))
        pts = [V(sx * 0.06, 0.16, 0.8)] + mid + [V(sx * 0.13, 0.14, 0.53)]
        P, _ = anatomy.resample(np.array(pts), step=0.01)
        if Sp is not None:
            P[1:-1] = Sp.project(P[1:-1], offset=0.008)
        S.add(Chain(list(P), 0.0095, margin=0.02), 0.004, mat="rope")
    return S, top


# ============================================================================ palette + painters
# Value ladder: face/ears/hands (warm pink-tan skin ~56%, red nose/ears) under a near-black umber hood (~11%) = the
# face pops out of the dark cowl; mustard tunic ~44%; sack = the big saturated shape: blue ~30% / green ~38% luma,
# brightest chroma on screen; striped hose cream/umber; sandals mid leather. Rope pale straw ~55%.
PAL = dict(
    skin=shaders.srgb(204, 140, 108), skin_warm=shaders.srgb(212, 86, 72), skin_cool=shaders.srgb(140, 102, 96),   # r3: less pale
    lips=shaders.srgb(150, 70, 66), skin_rough=0.6,
    iris=shaders.srgb(176, 196, 60), sclera=shaders.srgb(246, 242, 230),      # C2 r7: brighter (read in the hood)
    brow=shaders.srgb(40, 30, 26), brow_hi=shaders.srgb(90, 70, 60), brow_hi_amt=0.04, brow_rough=0.85,
    hair=shaders.srgb(40, 30, 26),
    hood=shaders.srgb(46, 36, 32), tunic=shaders.srgb(178, 132, 50), hose_a=shaders.srgb(206, 188, 150),
    hose_b=shaders.srgb(84, 58, 40), teeth=shaders.srgb(240, 230, 196),
    leather=shaders.srgb(116, 78, 48), leather_worn=shaders.srgb(170, 124, 84),
    leather_dark=shaders.srgb(52, 36, 26), leather_dark_worn=shaders.srgb(100, 72, 52),
    sole=shaders.srgb(70, 48, 32), rope=shaders.srgb(128, 100, 64),    # r3: darker (pale belt under the belly read as bare midriff)
    iron=shaders.srgb(90, 90, 96),
    iron_patina=shaders.srgb(96, 58, 40), iron_patina_amt=0.5,
    sack=shaders.srgb(50, 96, 206), sack_patch=shaders.srgb(160, 130, 80),
    pot=shaders.srgb(40, 140, 240), meat=shaders.srgb(150, 70, 36), bone=shaders.srgb(232, 220, 196),
    bone_dark=shaders.srgb(120, 100, 76),
)
# r4: blue and green read identical in greyscale -> blue = dark indigo burlap (~22% luma), green = sun-bleached
# olive-lime burlap (~52%); the patches swap value so each sack keeps a contrast accent.
# r5 (board r4: S1 torso band blue 15.6 vs green 18.5 -> need >= 8 pts): blue = deep indigo sack + dark umber-ochre
# tunic, green = bleached lime sack + pale straw tunic.
# C2 (ref pot_thief.png): the CLOAK carries the variant colour family -- blue = faded slate-indigo cloak over a dark
# indigo sack, green = mossy olive cloak over the bleached lime sack; tunics swapped to keep the greyscale step.
VAR_PAL = {"blue": dict(sack=shaders.srgb(26, 40, 104), sack_patch=shaders.srgb(176, 146, 96),
                        tunic=shaders.srgb(140, 98, 40), hood=shaders.srgb(50, 56, 92)),
           "green": dict(sack=shaders.srgb(156, 192, 78), sack_patch=shaders.srgb(92, 66, 40),
                         tunic=shaders.srgb(206, 172, 96), hood=shaders.srgb(98, 108, 50))}


def p_hose(c, pal):
    """C2: patched umber trousers (ref: baggy brown breeches, no stockings) -- faint vertical slub, dirty knees."""
    z = c.P[:, 2]
    slub = sdf.fbm(c.P[:, 0] * 1.0, c.P[:, 1] * 1.0, z * 0.12, 2, 120.0, seed=78)
    rgb = np.tile(pal["hose_b"], (c.n, 1)) * (0.92 + 0.12 * slub)[:, None]
    knee = np.exp(-((z - 0.21) / 0.04) ** 2) * shaders.smooth01(-c.N[:, 1], 0.2, 0.8)
    rgb = shaders.mix(rgb, rgb * np.array([0.7, 0.62, 0.55]), 0.5 * knee)
    n1 = c.noise(20.0, 2, 77)
    rgb *= (0.92 + 0.1 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.5, 0.7 * c.cav)
    return shaders.out(c.n, rgb, 0.85)


def p_sack(c, pal, key="sack"):
    """Coarse burlap: dyed, weave noise, darker folds/gathers, dusty light ridges, stitched seam lines."""
    n1 = c.noise(6.0, 3, 88)
    n2 = c.noise(140.0, 1, 89)
    n3 = c.noise(2.5, 2, 87)
    rgb = np.tile(pal[key], (c.n, 1)) * (0.86 + 0.22 * n1 + 0.08 * n2)[:, None]
    # r4: COARSE burlap weave (~7 mm threads, the sack is the biggest cloth on screen) + slubs + stitched side seams
    P = c.P
    ang = np.arctan2(P[:, 0], P[:, 1] - 0.27)
    # weave from anisotropic value noise (warp + weft threads, ~9 mm) -- a sin cross-hatch moired into rings
    weft = sdf.fbm(P[:, 0] * 0.1, P[:, 1] * 0.1, P[:, 2] * 1.0, 2, 110.0, seed=94)
    warp = sdf.fbm(P[:, 0] * 1.0, P[:, 1] * 1.0, P[:, 2] * 0.1, 2, 110.0, seed=95)
    rgb *= (0.9 + 0.11 * weft + 0.11 * warp)[:, None]
    if key == "sack":
        seam = 1 - shaders.smooth01(np.abs(np.abs(ang) - math.pi / 2) * 0.24, 0.002, 0.006)
        stitch = (1 - shaders.smooth01(np.abs(np.abs(np.abs(ang) - math.pi / 2) * 0.24 - 0.009), 0.001, 0.003)) * \
            shaders.smooth01(np.sin(P[:, 2] * 2 * math.pi / 0.014), -0.1, 0.2)
        rgb = shaders.mix(rgb, rgb * 0.4, 0.7 * seam)
        rgb = shaders.mix(rgb, shaders.srgb(150, 120, 80), 0.75 * stitch)
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.3 + 0.03, 1) * np.array([0.95, 0.92, 0.85]),
                      0.3 * shaders.smooth01(n3, 0.15, 0.6))
    low = 1 - shaders.smooth01(P[:, 2], 0.45, 0.85)
    rgb = shaders.mix(rgb, rgb * np.array([0.6, 0.52, 0.42]), 0.45 * low)
    rgb = shaders.mix(rgb, rgb * 0.36, np.clip(c.cav * 1.3, 0, 1))
    rgb = shaders.mix(rgb, np.minimum(pal[key] * 1.35 + 0.05, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, np.clip(0.86 + 0.06 * n1, 0.5, 0.95))


def p_pot(c, pal):
    rgb = np.tile(pal["pot"], (c.n, 1))
    rgb = shaders.mix(rgb, shaders.srgb(210, 240, 255), 0.5 * c.ridge)
    rgb = shaders.mix(rgb, rgb * 0.4, 0.6 * c.cav)
    return shaders.out(c.n, rgb, 0.18, 0.0)


def p_meat(c, pal):
    n1 = c.noise(30.0, 3, 90)
    rgb = np.tile(pal["meat"], (c.n, 1)) * (0.85 + 0.25 * n1)[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(70, 30, 16), 0.6 * c.cav)
    rgb = shaders.mix(rgb, shaders.srgb(200, 120, 60), 0.4 * c.ridge)
    return shaders.out(c.n, rgb, 0.45, 0.0)


def p_bone(c, pal):
    n1 = c.noise(20.0, 3, 81)
    rgb = np.tile(pal["bone"], (c.n, 1)) * (0.94 + 0.08 * n1)[:, None]
    rgb = shaders.mix(rgb, pal["bone_dark"], shaders.smooth01(c.cav, 0.05, 0.45) * 0.8)
    return shaders.out(c.n, rgb, 0.55, 0.0)


def p_rope(c, pal):
    P = c.P
    tw = 0.5 + 0.5 * np.sin((P[:, 0] + P[:, 1] + P[:, 2]) * 700.0)
    rgb = np.tile(pal["rope"], (c.n, 1)) * (0.75 + 0.3 * tw)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.5, 0.6 * c.cav)
    return shaders.out(c.n, rgb, 0.9)


def p_teeth(c, pal):
    """C2: crooked yellowed teeth, darker at the gums / gaps."""
    # C2 r8: clean ivory (the per-vertex noise read as grey grit), a soft yellow-brown only in the roots
    rgb = np.tile(pal["teeth"], (c.n, 1)) * (0.97 + 0.04 * c.noise(20.0, 1, 91))[:, None]
    rgb = shaders.mix(rgb, rgb * np.array([0.7, 0.58, 0.44]), np.clip(c.cav * 1.2, 0, 0.6))
    return shaders.out(c.n, rgb, 0.4)


def p_cloak(c, pal):
    """C2 hood + cloak rag: the variant-dyed cloth (p_rag), sun-faded tops, dirty ragged hems, darker deep inside the
    hood round the face (board r5: eyes should sit in the hood's shadow) and on the cloak's inner face."""
    rgb, rough, metal, emit = BM.p_rag(c, pal, "hood")
    P, N = c.P, c.N
    ex = c.x.get("eyes") if c.x else None
    if ex:
        fc = np.mean(np.array([V(*e) for e in ex]), axis=0) + V(0, 0.03, -0.01)
        to = fc - P
        dist = np.linalg.norm(to, axis=1)
        facing = np.sum(N * to, axis=1) / np.maximum(dist, 1e-6)
        inner = shaders.smooth01(facing, -0.2, 0.4) * (1 - shaders.smooth01(dist, 0.11, 0.18))
        # C2 r7: the inside of the hood round the face is a lighter warm lining (bounce from the face / torch
        # light), not a darkened pit -- the board couldn't find the face in the r6 near-black hood interior
        # C2 r8 (board r7: 'hood interior still a dark socket band at the game camera'): one more step lighter,
        # wider, and the lining joins the face in the EMIT mask (build() lifts the baked AO off it)
        rgb = shaders.mix(rgb, shaders.srgb(158, 122, 88), 0.66 * inner)
        emit = np.maximum(emit, 0.75 * inner)
    # patched + faded: broad lighter sun-bleached patches, darker grime toward hems (low z)
    n = c.noise(4.0, 2, 93)
    rgb = shaders.mix(rgb, np.minimum(rgb * 1.3 + 0.02, 1), 0.3 * shaders.smooth01(n, 0.2, 0.6))
    hem = 1 - shaders.smooth01(P[:, 2], 0.25, 0.5)
    rgb = shaders.mix(rgb, rgb * np.array([0.62, 0.56, 0.48]), 0.4 * hem * (P[:, 2] < 0.5))
    return rgb, rough, metal, emit


def _face_mask(c):
    """C2 r7: 1 on the face (eyes / nose / grin / cheeks), 0 past ~14 cm from it or behind the ears."""
    ex = c.x.get("eyes") if c.x else None
    if not ex:
        return np.zeros(c.n)
    fc = np.mean(np.array([V(*e) for e in ex]), axis=0) + V(0, 0.01, -0.035)
    d = np.linalg.norm(c.P - fc, axis=1)
    front = 1 - shaders.smooth01(c.P[:, 1] - float(fc[1]), 0.03, 0.07)
    return (1 - shaders.smooth01(d, 0.1, 0.14)) * front


def _face_lit(fn, lift=0.0):
    """Wrap a painter: brighten the face a little (warm bounce under the hood brim) and write the face mask into
    the spare EMIT channel of the prm pass (composite uses it to lift the hood's baked AO off the face)."""
    def p(c, pal):
        rgb, rough, metal, emit = fn(c, pal)
        m = _face_mask(c)
        if lift:
            low = shaders.smooth01(-c.N[:, 2], -0.3, 0.6)        # under-planes catch the warm bounce
            rgb = shaders.mix(rgb, np.minimum(rgb * (1 + lift), 1), m)
            rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.18, 1.04, 0.92]), 1), 0.5 * m * low)
        return rgb, rough, metal, np.maximum(emit, m)
    return p


def p_brow_clean(c, pal):
    """C2 r8 (board r7: 'brows striped noise'): one soft dark brow mass -- darker in the root cavities, a faint warm
    sheen on the ridge, no strand noise."""
    rgb = np.tile(pal["brow"], (c.n, 1)) * (1.0 + 0.05 * c.noise(25.0, 1, 211))[:, None]
    rgb = shaders.mix(rgb, rgb * 0.6, np.clip(c.cav, 0, 0.8))
    rgb = shaders.mix(rgb, pal.get("brow_hi", rgb), 0.18 * c.ridge)
    return shaders.out(c.n, rgb, 0.8)


def p_imp_skin(c, pal):
    """Shared skin painter + C2 r8: the painted brow under the sculpted brow is a flat soft brow tone (the shared
    painter's 900/m strand stripes read as striped noise), and the carved mouth interior is dark."""
    rgb, rough, metal, emit = shaders.PAINTERS["skin"](c, pal)
    bp = np.clip(c.paint("browpaint"), 0, 1)
    rgb = shaders.mix(rgb, pal["brow"] * 1.15, 0.8 * bp)
    mo = np.clip(c.paint("mouth"), 0, 1)
    rgb = shaders.mix(rgb, shaders.srgb(78, 30, 30), 0.88 * mo)
    rough = rough * (1 - mo) + 0.5 * mo
    return rgb, rough, metal, emit


PAINTERS = {"hood": p_cloak, "teeth": _face_lit(p_teeth),
            "skin": _face_lit(p_imp_skin, 0.18), "eye": _face_lit(shaders.PAINTERS["eye"]),
            "brow": _face_lit(p_brow_clean), "tunic": lambda c, pal: BM.p_rag(c, pal, "tunic"),
            "hose": p_hose, "rope": p_rope, "sack": p_sack, "sack_patch": lambda c, pal: p_sack(c, pal, "sack_patch"),
            "pot": p_pot, "meat": p_meat, "bone": p_bone, "iron": lambda c, pal: shaders.p_metal(c, pal, "iron")}


def var_pal(v):
    p = dict(PAL)
    p.update(VAR_PAL[v])
    return p


# ============================================================================ previews
MAT_COLORS = {"skin": (0.75, 0.5, 0.4), "eye": (0.9, 0.9, 0.88), "nail": (0.8, 0.6, 0.55), "brow": (0.1, 0.08, 0.07),
              "hood": (0.12, 0.09, 0.08), "tunic": (0.6, 0.42, 0.12), "hose": (0.6, 0.55, 0.45),
              "leather": (0.35, 0.22, 0.12), "leather_dark": (0.12, 0.08, 0.06), "sole": (0.2, 0.13, 0.08),
              "rope": (0.65, 0.55, 0.35), "iron": (0.3, 0.3, 0.32), "sack": (0.1, 0.25, 0.7),
              "sack_patch": (0.5, 0.4, 0.25), "pot": (0.1, 0.5, 0.95), "meat": (0.5, 0.2, 0.08),
              "bone": (0.9, 0.85, 0.75)}


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(THIEF)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = body_sculpt(L)
    if args.preview == "head":
        charkit.mesh_sculpt(S, "head", args.h or 0.0012, V(-0.25, -0.26, 0.6), V(0.25, 0.22, 1.26), colors=MAT_COLORS)
        views = [dict(target=(0, -0.03, 0.9), ortho=0.5, yaw=y, dist=3, pitch=3) for y in (0, 35, 90)]
        preview.render_views(os.path.join(out, "thief_head.png"), views, res=(700, 700))
    else:
        base = [charkit.mesh_sculpt(S, "body", args.h or 0.0025, colors=MAT_COLORS),
                charkit.mesh_sculpt(skirt(info["kilt"]), "skirt", 0.002, colors=MAT_COLORS)]
        for s in ("L", "R"):
            w = L["wrist_" + s]
            base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.0012, w - 0.1, w + 0.1,
                                            colors=MAT_COLORS))
        for i, v in enumerate(("blue", "green")):
            Ss, _ = sack(v, L, S)
            sm = charkit.mesh_sculpt(Ss, "sack_" + v, 0.0025, colors=MAT_COLORS)
            if v == "green":
                for m_i, m in enumerate(sm.data.materials):
                    if m.name.startswith("clay_sack") and "patch" not in m.name:
                        sm.data.materials[m_i] = preview.clay_material("clay_sack_g", (0.15, 0.5, 0.1))
            dx = V(i * 0.75, 0, 0)
            sm.location = dx
            if i:
                for b in base:
                    o = meshutil.duplicate(b, b.name + "_2")
                    o.location = dx
        views = [dict(target=(0.375, 0, 0.62), ortho=1.9, yaw=y, dist=6, pitch=4) for y in (0, 40, 120)]
        preview.render_views(os.path.join(out, "thief_full.png"), views, res=(760, 700))
    print(f"[thief] preview {args.preview} done in {time.time()-t0:.1f}s")


# ============================================================================ build
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.02) / 0.03, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.03)) / 0.06, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.15)


def build(args):
    global OUT_MODELS, OUT_TEX
    T0 = time.time()
    report_path = os.path.join(HERE, "out", "thief_report.json")
    if args.outdir:                       # r4 staging build: models + textures + report go to <outdir> (promote by hand)
        od = os.path.abspath(args.outdir)
        OUT_MODELS = os.path.join(od, "models")
        OUT_TEX = os.path.join(od, "textures")
        os.makedirs(OUT_MODELS, exist_ok=True)
        os.makedirs(OUT_TEX, exist_ok=True)
        report_path = os.path.join(od, "thief_report.json")
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt, h_sack = ((0.003, 0.0012, 0.0009, 0.002, 0.002) if fast else
                                              (0.0016, 0.0008, 0.0006, 0.0012, 0.0012))
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(THIEF)
    variants = args.variants.split(",") if args.variants else list(VARIANTS)
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "variants": {}}

    t = time.time()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = skirt(KP)
    Sc = cloak(L, S)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    G = {"sack_" + v: sack(v, L, S, Sc)[0] for v in variants}
    St = Sculpt(materials=MATERIALS, default_mat="teeth")         # C2 r8: real tooth geometry in the game mesh
    for tp in TEETH:
        St.add(tp, 0.0006, mat="teeth")
    tb = (np.min([tp.lo for tp in TEETH], axis=0) - 0.006, np.max([tp.hi for tp in TEETH], axis=0) + 0.006)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    arm = rig.build_armature(L, ASSET, hair_chain=0, kilt_chain=KILT_CHAIN)

    t = time.time()
    his = {}
    if args.stage != "skin":
        body_hi = pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX)
        charkit.drop_islands(body_hi, h_body)
        head_hi = pipeline.sculpt_mesh(S, "head_hi", h_head, HEAD_BOX[0] - 0.01, HEAD_BOX[1] + 0.01, keep_box=HEAD_BOX)
        his["body"] = [body_hi, head_hi]
        # C2 r9 (r8 known issue: a coarse LO triangle beside the green thief's nose tip baked HOOD texels -- olive
        # albedo + a wrong normal): the face's skin faces get their own bake job from a hood-free copy of the head HI
        head_nh = meshutil.duplicate(head_hi, "head_hi_nohood")
        me = head_nh.data
        fm = np.empty(len(me.polygons), np.int32)
        me.attributes["fmat"].data.foreach_get("value", fm)
        pipeline.delete_faces(head_nh, fm == MATERIALS.index("hood"))
        his["face"] = [head_nh]
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.1, w + 0.1)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        his["cloak"] = [pipeline.sculpt_mesh(Sc, "cloak_hi", h_kilt)]
        his["teeth"] = [pipeline.sculpt_mesh(St, "teeth_hi", 0.00035, tb[0], tb[1])]
        for nm, Sg in G.items():
            his[nm] = [pipeline.sculpt_mesh(Sg, nm + "_hi", h_sack)]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    h_lo = 0.0026 if not fast else 0.0032
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   symmetry=False,
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0013, args.hand_tris, w - 0.1, w + 0.1,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.0022, args.kilt_tris)
    los["cloak"] = pipeline.lowpoly(Sc, "cloak_lo", 0.0022, args.cloak_tris, symmetry=False)
    for nm, Sg in G.items():
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.003, args.sack_tris, symmetry=False,
                                   clean=lambda o: charkit.drop_islands(o, 0.003, min_verts=30))
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    # teeth after the island sweep (each tooth IS a small island)
    los["teeth"] = pipeline.lowpoly(St, "teeth_lo", 0.0005, 300, tb[0], tb[1], symmetry=False)
    los["teeth"].data.validate()
    report["parts"]["teeth"] = meshutil.tri_count(los["teeth"])
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_lo = los["body"]
    Pb = meshutil.get_verts(body_lo)
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(body_lo, arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H, reach=0.3), "head"), (crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.02, reach=0.1), "hand_" + s)
                                  for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s, reach=0.1), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN)
    # C2 capelet: chest / clavicles over the torso, upper arms under the sleeve flaps (blended, never the forearms)
    skin.skin(los["cloak"], arm, method="sdf", allowed=["spine", "chest", "neck", "clavicle_L", "clavicle_R",
                                                         "upperarm_L", "upperarm_R"], power=3.0, smooth=6)
    for nm in G:
        charkit.rigid_bind(los[nm], arm, "chest")
    charkit.rigid_bind(los["teeth"], arm, "head")
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt", "cloak", "teeth"]
    if args.stage == "skin":
        obs = [los[k] for k in common] + [los[list(G)[0]]]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "thief_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(body_lo, arm, body_W, H, face_density=FACE_DENSITY,
                                                face_box=(-0.03, -0.17, 0.05))
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.3)
    charkit.smart_uv(los["kilt"], 70.0, 0.9)
    charkit.smart_uv(los["cloak"], 66.0, 0.9)
    charkit.smart_uv(los["teeth"], 66.0, 1.6)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 0.8)
    order = common + list(G)
    report["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=6 if not fast else 4, res=res)
    # C2 r9: the green 'nose shard' = two nose-tip triangles whose UVs collapsed onto ONE texel (of the sack island)
    report["uv_degenerate_fixed"] = {k: charkit.fix_degenerate_uvs(los[k], res) for k in order}
    pipeline.log(f"degenerate UV faces fixed: {report['uv_degenerate_fixed']}")
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    extra_p = dict(eyes=info["head"]["eyes"], eye_r=info["head"]["eye_r"], z_knee=L["knee_L"][2],
                   z_chest=L["chest"][2])
    sculpt_of = {"body": S, "face": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk, "cloak": Sc, "teeth": St}
    # C2 r9: split the body LO (bake only; export keeps los['body']) -> skin / eye / brow / nail faces inside the
    # head box bake from the hood-free head HI, everything else (incl. the hood) as before
    Cf = pipeline.face_centers(body_lo)
    fmat, _ = pipeline.eval_attrs_mat_only(S, Cf)
    face_sel = in_head(Cf) & np.isin(fmat, [MATERIALS.index(m) for m in ("skin", "eye", "brow", "nail")])
    # nose zone: the coarse LO faces round the nose tip (the most forward face point) get long rays (see jobs)
    tip = Cf[face_sel][np.argmin(Cf[face_sel][:, 1])]
    nose_sel = face_sel & (np.linalg.norm(Cf - tip, axis=1) < 0.026) & (Cf[:, 2] > tip[2] - 0.012)   # not the grin below
    face_sel = face_sel & ~nose_sel
    body_face = meshutil.duplicate(body_lo, "body_lo_face")
    pipeline.delete_faces(body_face, ~face_sel)
    body_nose = meshutil.duplicate(body_lo, "body_lo_nose")
    pipeline.delete_faces(body_nose, ~nose_sel)
    body_rest = meshutil.duplicate(body_lo, "body_lo_rest")
    pipeline.delete_faces(body_rest, face_sel | nose_sel)
    report["face_bake_faces"] = [int(face_sel.sum()), int(nose_sel.sum())]
    pipeline.log(f"face bake split: {int(face_sel.sum())} face + {int(nose_sel.sum())} nose LO faces bake from the "
                 f"hood-free head (nose tip {tip.round(3).tolist()})")
    sculpt_of.update(G)
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.008, 0.02), "hand_L": (0.004, 0.01), "hand_R": (0.004, 0.01), "kilt": (0.004, 0.01),
           "cloak": (0.004, 0.01), "teeth": (0.0015, 0.004)}
    for v in variants:
        tt = time.time()
        pal = var_pal(v)
        parts = common + VARIANTS[v]
        for k in parts + ["face"]:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, extra_p, painters=PAINTERS)
        for o in all_hi + list(los.values()) + [body_face, body_nose, body_rest]:
            pipeline.set_ray_visibility(o, False)
        jobs = [((body_rest if k == "body" else los[k]), his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
        jobs.append((body_face, his["face"]) + ext["body"])
        # the nose job's source has no hood, so its rays can be long: the coarse LO triangle beside the nose tip sits
        # well off the thin HI nose and its 2 cm rays MISSED (the empty texels were then dilated from a neighbouring
        # hood island = the olive shard); a 1.4 cm cage + 5 cm rays reach the nose
        jobs.append((body_nose, his["face"], 0.014, 0.05))
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts if k != "body"] + [body_face, body_nose, body_rest],
                           [o for k in parts + ["face"] for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        prefix = f"{ASSET}_{v}"
        # C2 r7: lift the hood's baked occlusion off the face (mask = prm EMIT channel, written by _face_lit) so the
        # eyes + grin aren't buried under the AO-tinted albedo / ORM occlusion
        fm = np.clip(maps["prm"][..., 2], 0, 1)
        ao_f = maps["ao"].copy()
        for ch in (0, 1):
            ao_f[..., ch] = ao_f[..., ch] + (1 - ao_f[..., ch]) * fm * (0.6 if ch == 0 else 0.85)
        tex = charkit.composite_maps(dict(maps, ao=ao_f), OUT_TEX, prefix)
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        dups = []
        for k in parts:
            o = meshutil.duplicate(los[k], f"{k}_{v}")
            o.data.materials.clear()
            o.data.materials.append(mat)
            pipeline.strip_for_export(o)
            dups.append(o)
        bpy.context.view_layer.update()
        body = meshutil.join(dups, prefix + "_mesh")
        body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
        rep = {"tris": meshutil.tri_count(body)}
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=q["bad"], soft=q["soft"], pairs=q["pairs"]) for k, q in qa.items()}
        pipeline.log(f"[{v}] stretch QA: " + ", ".join(f"{k}: bad {q['bad']} soft {q['soft']}" for k, q in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if v == "blue":
            shutil.copyfile(out, os.path.join(OUT_MODELS, ASSET + ".glb"))
        bpy.data.objects.remove(body, do_unlink=True)
        report["variants"][v] = rep
        pipeline.log(f"[{v}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(report_path, report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(report_path, report)
    pipeline.log(f"DONE {ASSET} {variants} in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--variants", default=None)
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=7200)
    ap.add_argument("--head-tris", type=int, default=3600)
    ap.add_argument("--hand-tris", type=int, default=600)
    ap.add_argument("--kilt-tris", type=int, default=1100)
    ap.add_argument("--cloak-tris", type=int, default=1500)
    ap.add_argument("--sack-tris", type=int, default=2200)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
