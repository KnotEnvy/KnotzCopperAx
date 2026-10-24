"""Build the Viper Maiden (Golden Axe amazon DNA, serpent cult) -- jade / crimson / dusk + the Wyrm Rider captain.

Usage (headless, from the project root, ONLY through the slot wrapper):
  node tools/blender-run.mjs --owner enemies-art-3 -- -b --factory-startup -P blender/build_enemy_viper.py -- [options]
Options:
  --preview full                     clay renders to progress/shots/enemies-art-3/dev/ (no export)
  --fast                             coarser hi-poly + 1024 atlas
  --stage skin                       LO + weights + stretch QA only (progress/tmp/viper_skin_test.glb)
  --tiers jade,crimson,dusk,captain  export only these tiers
  --outdir <dir>                     staging build (models/ + textures/ + viper_report.json; promote by hand)
Default: public/assets/models/enemy_viper_<tier>.glb (+ copy jade -> enemy_viper.glb), textures
public/assets/textures/enemy_viper_<tier>_*.png, report blender/out/viper_report.json.

Design (C2 r1 rebuild to docs/refs/c2/enemies/viper_maiden_v2.png; board C1 r4: "hooded jumpsuit", "doll face",
"tiers differ by hue only"): an armoured serpent-cult SKIRMISHER, not a hooded suit.
  head   : the heroic-female head (BH.sera_head) with heavier almond lids (upper lid over the iris top, cat-eye
           tilt), fierce painted brows, natural lips painted on the sculpted lip shapes, sharp kohl liner + wing;
           slicked-back hair into a HIGH PONYTAIL (3-bone hair_* spring chain) that arcs over the crest;
  crest  : a rigid flared cobra-hood CREST standing BEHIND the head (wider than the skull both sides, rising above
           the crown, pale belly-scale inner face) -- the silhouette hook from every camera, no cloth over the head;
  body   : jade scale cuirass with a stand collar (sleeveless: bare shoulders + arms), serpent armlets, leather
           bracers, one layered scale shoulder mantle, a wide belt with a bronze buckle, a row of bone fangs, long
           torn tabards (scale centre panels + light torn side layers) over dark leggings, wrapped shins, bronze
           knee cops, flat strap sandals on bare feet.
Value ladder (greyscale must separate the tiers, not only hue): jade LIGHT (light jade scale, pale tabards, bone
trims), crimson MID (crimson scale, rust tabards, bronze bracer plates), dusk DARK (plum-black scale, charcoal
tabards, dark half-cape), captain = black-jade + gold trims, spiked gold crest, both mantles, red short cape.
Weapon: weapon_whip_spear.glb.
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
import build_hero_seraphine as BH
importlib.reload(BH)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX)
from lib.charkit import ray_hit, trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "enemies-art-3", "dev")
ASSET = "enemy_viper"

VIPER = dict(
    # C1 r4: her own proportions -- narrow shoulders, short torso + long legs, smaller head, long neck
    height=1.78, head_h=0.214,
    shoulder_x=0.172, shoulder_z=1.462, clav_in_x=0.02,
    hip_x=0.088, hip_joint_z=0.965, pelvis_z=1.01,
    knee_z=0.53, ankle_z=0.08, foot_len=0.232, stance_x=0.094,
    spine_z=1.115, chest_z=1.27, neck_z=1.49, head_base_z=1.598,
    upperarm=0.29, forearm=0.255, hand=0.178,
    arm_down=40.0, arm_fwd=6.0, elbow_bend=10.0,
)
STYLE = dict(muscle=0.78, defin=0.55, fat=0.0, chest=0.8, lats=0.62, traps=0.46, waist=0.6, delts=0.86, arm=0.7,
             forearm=0.72, neck=0.55, fem=1.0)       # C2 r1: bare arms -> a touch more athletic arm definition
LEG_STYLE = dict(STYLE, muscle=0.2, defin=0.35)
MATERIALS = ["skin", "eye", "nail", "brow", "hair", "scale", "cloth", "wrap", "legging", "leather", "leather_dark",
             "sole", "bone", "trim", "bronze", "cape"]
GEAR_MATS = ["scale", "leather_dark", "leather", "bone", "trim", "bronze", "cape", "cloth"]
KINDS = {"scale": "leather", "legging": "leather", "wrap": "cloth", "cape": "cloth", "trim": "bronze", "bone": "nail",
         "hair": "mane_clean"}
WRIST_CUT_T = 0.9
HAND_CUT_T = 0.84
GRIP_R = 0.017
BELT_Z = 0.995          # wide leather belt at the top of the hips
CUIRASS_LO = 1.0        # cuirass hem tucked under the belt
KILT_CHAIN = 2
LEG_GAP_TOP = 0.86
HEAD_BOX = (V(-0.125, -0.14, 1.555), V(0.125, 0.14, 1.79))
TIERS = {
    "jade": ["crest", "mantle_L"],
    "crimson": ["crest", "mantle_L", "plate_L", "plate_R"],
    "dusk": ["crest", "cape_half"],
    "captain": ["crest_captain", "mantle_L", "mantle_R", "plate_L", "plate_R", "cape_captain"],
}


def forearm_frame(L, side):
    return BM.forearm_frame(L, side)


def arm_cutter(L, r_up=0.07, r_fore=0.062, ball=(0.085, -0.03, 0.092)):
    """Both arms (shoulder ball -> wrist): costume layers that wrap the torso/legs must never wrap the arms."""
    out = []
    for s_, sx in (("L", 1), ("R", -1)):
        sh_ = L["shoulder_" + s_]
        el, wr, b, Lf = forearm_frame(L, s_)
        c_ = sh_ + V(sx * ball[0], 0.0, ball[1])
        out.append(Union(Sphere(c_, ball[2]), Capsule(c_, el, r_up), Capsule(el, wr + b * 0.05, r_fore), k=0.01))
    return Union(*out)


# ============================================================================ body
def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {"arms": {}, "legs": {}}
    T = anatomy.torso(S, L, STYLE)
    anatomy.E(S, T, (0.12, 0.012, 0.99), (0.074, 0.084, 0.1), k=0.05, sym=True)     # hips (wide vs the waist)
    anatomy.E(S, T, (0.066, -0.078, 1.43), (0.068, 0.056, 0.062), M=rot(0, 0, 10), k=0.045, sym=True)   # bust
    for s in ("L", "R"):
        info["arms"][s] = anatomy.arm(S, L, s, STYLE)
        info["legs"][s] = anatomy.leg(S, L, s, LEG_STYLE)
        anatomy.foot(S, L, s)
        toes(S, L, s)
    info["head"] = viper_head(S, L)
    H = info["head"]["H"]
    anatomy.torso_details(S, L, STYLE)
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    viper_brows(S, H, info["head"])
    face_paint(S, H, info["head"])
    snap = S.snapshot()
    for s in ("L", "R"):
        el, wr, b, Lf = forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
    hair_cap(S, snap, H, info["head"])
    leggings(S, snap, L)
    for s in ("L", "R"):
        sandal(S, snap, L, s)
        shin_wrap(S, snap, L, s)
    cuirass(S, snap, L)
    snap2 = S.snapshot()
    for s in ("L", "R"):
        gear.bracer(S, snap2, L, s, info["arms"][s], t0=0.36, t1=0.86, thick=0.0055, plate=False, lacing=True)
        armlet(S, L, s)
    gear.belt(S, snap2, L, z=BELT_Z, half=0.026, thick=0.012, buckle=True)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.014)
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))                 # flat on the ground (sandal soles)
    info["kilt"] = kilt_params(S)
    return S, info


# ---------------------------------------------------------------------------- head + face
# C2 r6 (board r5: "face hard/masculine/assembled up close: angular cheeks, lumpy nose, hard brow, square jaw"):
# the head is now the Viper's OWN fit of the CC0 Blender Human Base Meshes female head (docs/ASSET_SOURCES.md) --
# the same fitting script as Seraphine's (blender/seraphine_basemesh.py fit, numpy + scipy venv) but with viper
# params: smaller cat-tilted almond eyes, higher cheekbones, a tapered (not square) jaw, a softer brow ridge. The
# grid is fitted in Seraphine's head frame (eye line of the old SDF head) and mapped into the viper's (XGrid).
VIPER_FIT = dict(eye_scale=1.16, canthus_lift=0.0035, cheek_out=0.006, jaw_in=0.0048, brow_soft=0.0016,
                 chin_fwd=0.0018, nose_w=0.9)
HEAD_MM = 0.8
_VHEAD = {}


def viper_grid():
    """(GridPrim in SERAPHINE's head frame, landmarks) of the viper fit; cached in blender/out (gitignored)."""
    if "g" in _VHEAD:
        return _VHEAD["g"]
    path = os.path.join(HERE, "out", f"viper_head_sdf_{HEAD_MM:.1f}.npz")
    if not os.path.exists(path):
        import subprocess
        tmp = os.path.join(HERE, "out", f"viper_head_{HEAD_MM:.1f}")
        cmd = [BH.VENV_PY, os.path.join(HERE, "seraphine_basemesh.py"), "fit", tmp, "--sdf", str(HEAD_MM), "--params"]
        cmd += [f"{k}={json.dumps(v)}" for k, v in VIPER_FIT.items()]
        subprocess.run(cmd, check=True)
        os.replace(os.path.join(tmp, "head_sdf.npz"), path)
    d = np.load(path)
    lm = json.loads(str(d["landmarks"]))
    for k, v in list(lm.items()):
        if isinstance(v, list) and len(v) == 3:
            lm[k] = V(*v)
    _VHEAD["g"] = (BH.GridPrim(d["G"], d["x0"], float(d["h"])), lm)
    return _VHEAD["g"]


class XGrid(sdf.Prim):
    """A world-frame grid prim fitted in frame Hs, re-placed (uniform scale + offset) into frame Hv."""

    def __init__(self, g, Hs, Hv):
        self.g, self.cs, self.cv, self.a = g, V(Hs.c), V(Hv.c), Hv.s / Hs.s
        self.lo, self.hi = self.fwd(g.lo), self.fwd(g.hi)

    def fwd(self, q):          # Seraphine frame -> viper frame
        return self.cv + (V(q) - self.cs) * self.a

    def d(self, X, Y, Z):
        cs, cv, a = self.cs, self.cv, self.a
        return self.g.d(cs[0] + (X - cv[0]) / a, cs[1] + (Y - cv[1]) / a, cs[2] + (Z - cv[2]) / a) * a


def viper_head(S, L):
    """The fitted base-mesh head (see VIPER_FIT) welded onto the SDF body like BH.sera_head (slim neck column,
    separate eyeballs, lash line), then the viper's lids: a heavier upper lid over the top of the iris with a
    cat-eye tilt -- an almond, narrowed, predatory eye. No lid-crease roll any more (board: 'hard creases')."""
    H = anatomy.HeadFrame(L)
    Hs = anatomy.HeadFrame(rig.landmarks(BH.SERA))
    g, lm_s = viper_grid()
    X = XGrid(g, Hs, H)
    lm = {k: (X.fwd(v) if isinstance(v, np.ndarray) and v.shape == (3,) else v) for k, v in lm_s.items()}
    for k in ("eye_r", "mouth_half_w"):
        lm[k] = float(lm_s[k]) * X.a
    neck_cut = float(X.fwd(V(0, 0, BH.NECK_CUT))[2])
    s = H.s
    S.sub(Bounded(Inter(Ellipsoid(H(0, 0.0, -0.02), H.r(0.15, 0.17, 0.165)), HalfSpace(H(0, 0, -0.19), V(0, 0.25, -1)),
                        k=0.01), H(0, 0, -0.02) - 0.2, H(0, 0, -0.02) + 0.2), 0.012)
    S.sub(Sphere(L["head"] + V(0, -0.044, -0.035), 0.0135), 0.012)
    top = X.fwd(V(0, 0.046, BH.NECK_CUT + 0.035))
    S.add(RoundCone(L["neck"] + V(0, 0.014, -0.03), top, 0.048, 0.034, squash=(1.05, 0.95)), 0.028)
    S.add(Ellipsoid(L["neck"] + V(0, -0.030, -0.052), V(0.029, 0.017, 0.025)), 0.03)
    head = Inter(X, HalfSpace(V(0, 0, neck_cut), V(0, 0, -1)), k=0.006)
    S.add(Bounded(head, X.lo, X.hi), 0.010)
    er = lm["eye_r"]
    eyes = []
    for key in ("eye_R", "eye_L"):
        ec = lm[key]
        S.add(Sphere(ec, er), 0.0, mat="eye")
        S.add(Sphere(ec + V(0, -0.49 * er, 0), 0.545 * er), 0.0012, mat="eye")
        eyes.append(ec)
    f = er / 0.0150
    for ec in eyes:
        sx = 1 if ec[0] > 0 else -1
        raw = np.array([ec + V(sx * x * f, -0.02, z * f) for x, z in ((-0.0125, 0.0034), (-0.0065, 0.0068), (0.0, 0.0080),
                                                                      (0.0075, 0.0074), (0.0140, 0.0056), (0.0180, 0.0046))])
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        S.paint(Chain(list(P), [0.0009, 0.0013, 0.0017, 0.0018, 0.0015, 0.0008]), "lash", soft=0.0012)
    # heavier upper lid: a thin skin cap over the top of the eyeball, its edge tilted (outer corner up)
    for sx, ec in zip((1, -1), eyes):
        nU = rot(-10, sx * -12, 0) @ V(0, 0, -1)
        S.add(Inter(Sphere(ec, er + 0.0012), HalfSpace(ec + V(0, -0.002, 0.0056 * f), nU), k=0.0008), 0.0014,
              mat="skin")
    return dict(H=H, eyes=eyes, eye_r=er, eye_fwd=(0.0, -1.0, 0.0), nose_dz=0.0, mouth_dz=0.0,
                zm=float(lm["lip_line"][2]), lip=1.0, mouth_w=1.0, lm=lm)


def ear_clear(hi):
    lm = hi["lm"]
    return [Sphere(lm[k] + V(sx * 0.004, 0.0, 0.004), 0.025) for k, sx in (("ear_R", 1), ("ear_L", -1))]


def viper_brows(S, H, hi):
    """Fierce brows on the fitted brow line: the inner ends low, a straight rise to a lifted tail (no doll arch,
    no heavy ridge -- just a thin sculpted lift under the paint)."""
    ez = float(hi["eyes"][0][2])
    f = hi["eye_r"] / 0.0138
    for sx in (1, -1):
        raw = np.array([V(sx * x * f, -0.2, ez + z * f) for x, z in ((0.010, 0.0128), (0.021, 0.0150), (0.034, 0.0184),
                                                                     (0.047, 0.0202), (0.057, 0.0170))])
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        P, _ = anatomy.resample(P, step=0.002)
        n = len(P)
        rr = np.interp(np.linspace(0, 1, n), [0, 0.2, 0.7, 1], [0.0022, 0.0025, 0.0019, 0.0007])
        S.paint(Chain(list(P), list(rr)), "browpaint", soft=0.0012)
        Nn = S.grad(P)
        rs = rr * 0.7
        S.add(Chain(list(P - Nn * (rs - 0.0003)[:, None]), list(rs)), 0.004)


def face_paint(S, H, hi):
    """C2 r6 make-up on the fitted face: natural lips painted from the fitted lip line (both lips, no box), a
    sharp kohl -- a thick upper liner on the lid edge with a long wing to the temple and a lower liner on the outer
    half, a little smoky lid -- and a soft warm contour under the cheekbones."""
    s = H.s
    lm = hi["lm"]
    lip = lm["lip_line"]
    mw = min(float(lm["mouth_half_w"]), 0.025)
    S.paint(Union(Ellipsoid(lip + V(0, 0.002, 0.0034), V(mw, 0.010, 0.0044)),
                  Ellipsoid(lip + V(0, 0.002, -0.0050), V(mw * 0.9, 0.010, 0.0056)), k=0.003), "lips", soft=0.0022)
    raw = np.array([lip + V(x * mw * 0.9, -0.02, -0.0004 * (abs(x) * 2) ** 2) for x in np.linspace(-1, 1, 9)])
    P = anatomy.surface_hit(S, raw, V(0, 1, 0))
    # fill the base mesh's lip slit along its own curve (the 2300-tri head LO kept the slit as a long 'grin'
    # crease that baked as lines out of the mouth corners) -- the parting line is painted instead
    S.add(Chain(list(P + V(0, 0.0024, 0)), [0.0012, 0.0016, 0.0019, 0.002, 0.002, 0.002, 0.0019, 0.0016, 0.0012]),
          0.0016)
    S.paint(Chain(list(P), [0.0003, 0.0005, 0.0006, 0.0007, 0.0007, 0.0007, 0.0006, 0.0005, 0.0003]), "tattoo",
            soft=0.0006, value=0.4)                                    # the lip parting line
    for sx, e in zip((1, -1), hi["eyes"]):
        # smoky lid (between the liner and the crease)
        S.paint(Inter(Ellipsoid(e + V(sx * 0.003, -0.012, 0.0075) * s, H.r(0.018, 0.02, 0.0062)),
                      HalfSpace(e + V(0, 0, 0.004) * s, V(0, 0, -1)), k=0.002), "tattoo", soft=0.0025, value=0.35)
        for uw, rr, val in (([(-0.0125, 0.0036), (-0.006, 0.0052), (0.0, 0.0058), (0.007, 0.0058), (0.0135, 0.0064),
                              (0.0195, 0.0086), (0.025, 0.0108), (0.0295, 0.0126)],
                             [0.0012, 0.0017, 0.0021, 0.0021, 0.0021, 0.0019, 0.0015, 0.0009], 0.95),
                            ([(0.0, -0.0062), (0.0075, -0.0058), (0.0135, -0.0042), (0.019, -0.0016)],
                             [0.0006, 0.0009, 0.0011, 0.0006], 0.85)):
            raw = np.array([e + V(sx * u, -0.02, w) * s for u, w in uw])
            P = anatomy.surface_hit(S, raw, V(0, 1, 0))
            P, _ = anatomy.resample(P, step=0.0015)
            r_ = np.interp(np.linspace(0, 1, len(P)), np.linspace(0, 1, len(rr)), rr) * s
            S.paint(Chain(list(P), list(r_)), "tattoo", soft=0.0007, value=val)
    # soft warm contour under the cheekbones (+ a touch on the nose tip / ears)
    ec = hi["eyes"][0]
    S.paint(Union(Sphere(V(0.046, ec[1] - 0.004, ec[2] - 0.030), 0.019), Sphere(V(-0.046, ec[1] - 0.004, ec[2] - 0.030), 0.019),
                  Sphere(lm["nose_tip"] + V(0, 0.004, 0), 0.008)), "blush", soft=0.02, value=0.45)


HAIR_FRONT_Z, HAIR_BACK_Z = 0.074, -0.125


def hair_cap(S, snap, H, hi):
    """Slicked-back hair over the skull, combed back to the tie (grooves converge there). C2 r6: the comb grooves
    are clipped to the cap (one ran onto the forehead in r1 and read as a scar)."""
    gear.scalp_cap(S, snap, H, thick=0.0068, front_z=HAIR_FRONT_Z, back_z=HAIR_BACK_Z, exclude=ear_clear(hi),
                   noise=0.0, k_edge=0.012, k_exclude=0.01)
    c1, c2 = H(0, -0.095, HAIR_FRONT_Z), H(0, 0.115, HAIR_BACK_Z)
    nrm = norm(np.cross(V(1, 0, 0), c2 - c1))
    tie = PONY_TIE(H)
    for j in range(11):
        a = -1.25 + 2.5 * j / 10
        start = H(math.sin(a) * 0.072, -math.cos(a) * 0.08 + 0.01, 0.06 - 0.05 * abs(math.sin(a)))
        raw = [start + (tie - start) * f for f in np.linspace(0, 0.92, 7)]
        P = gear.project_path(S, raw, step=0.004, offset=0.0)
        P = P[(P - c1) @ nrm > 0.012]
        if len(P) >= 3:
            S.sub(Chain(list(P), 0.0011 * H.s), 0.0009)


def PONY_TIE(H):
    return H(0, 0.1, -0.025)          # r1d: tie at the back of the head, threaded through the crest's ring


def toes(S, L, side):
    """Bare toes for the strap sandals (big toe on the inside)."""
    sx = 1 if side == "L" else -1
    ball, toe = L["ball_" + side], L["toe_" + side]
    f = norm(V(toe[0] - ball[0], toe[1] - ball[1], 0))
    lat = norm(np.cross(V(0, 0, 1), f))
    for u, r, back in ((-0.016, 0.0105, -0.004), (-0.002, 0.0078, 0.002), (0.008, 0.0072, 0.006),
                       (0.0165, 0.0066, 0.011), (0.0235, 0.006, 0.017)):
        c = toe + lat * (u * sx) - f * back + V(0, 0, -0.004)
        S.add(Sphere(c, r), 0.004)


def sandal(S, snap, L, side):
    """Flat sole + leather straps (toe bar, crossed instep straps, ankle strap) on the bare foot."""
    an, ball, toe = L["ankle_" + side], L["ball_" + side], L["toe_" + side]
    lo = np.minimum(np.minimum(an, toe), ball) - 0.09
    hi = np.maximum(np.maximum(an, toe), ball) + 0.09
    lo[2] = -0.02
    hi[2] = float(an[2]) + 0.05
    f = norm(V(toe[0] - an[0], toe[1] - an[1], 0))
    lat = norm(np.cross(V(0, 0, 1), f))
    S.add(Bounded(Inter(Offset(snap, 0.0065), HalfSpace(V(0, 0, 0.014), V(0, 0, 1)), k=0.002), lo, hi), 0.0015,
          mat="sole")
    mid = (an + ball) * 0.5
    straps = [Slab(ball + f * 0.012, f, 0.0065),
              Slab(mid, norm(f + lat * 0.75), 0.006), Slab(mid, norm(f - lat * 0.75), 0.006),
              Slab(an + V(0, 0, 0.004), norm(V(0, 0, 1) + f * 0.25), 0.0065)]
    for st in straps:
        S.add(Bounded(Inter(Offset(snap, 0.0032), st, HalfSpace(V(0, 0, 0.008), V(0, 0, -1)), k=0.0015), lo, hi),
              0.001, mat="leather")


def leggings(S, snap, L):
    """Dark fitted leggings from the waist to the ankle (thin: the leg anatomy reads through)."""
    reg = Inter(Offset(snap, 0.0028), HalfSpace(V(0, 0, 1.075), V(0, 0, 1)), HalfSpace(V(0, 0, 0.098), V(0, 0, -1)),
                k=0.004)
    reg = Diff(reg, arm_cutter(L), k=0.004)
    S.add(Bounded(Displace(reg, 0.0006, 30.0, 2, seed=5), V(-0.4, -0.3, 0.06), V(0.4, 0.3, 1.12)), 0.0,
          mat="legging")
    for s_, sx in (("L", 1), ("R", -1)):              # outer seam + inner seam (breaks the flat dark mass)
        hp, kn = L["hip_" + s_], L["knee_" + s_]
        raw = [hp + V(sx * 0.2, 0, 0.02), (hp + kn) / 2 + V(sx * 0.2, 0, 0), kn + V(sx * 0.2, 0, 0.04)]
        P = gear.project_path(S, raw, step=0.006, offset=0.0)
        S.add(Chain(list(P), 0.0018), 0.0012, mat="leather_dark")


def shin_wrap(S, snap, L, side):
    """Wrapped shins (light cloth wraps + crossing leather bands) from above the ankle to under the knee, and a
    bronze cobra-head knee cop: the light value break on the lower leg."""
    kn, an = L["knee_" + side], L["ankle_" + side]
    z0, z1 = float(an[2]) + 0.028, float(kn[2]) - 0.07
    zc, zh = (z0 + z1) / 2, (z1 - z0) / 2
    lo = np.minimum(kn, an) - 0.12
    hi = np.maximum(kn, an) + 0.12
    sx = 1 if side == "L" else -1
    base = Inter(Offset(snap, 0.0045), Slab(V(0, 0, zc), V(0, 0, 1), zh), k=0.003)
    S.add(Bounded(Displace(base, 0.0006, 45.0, 2, seed=11 + sx), lo, hi), 0.0, mat="wrap")
    n_b = 10
    for i in range(n_b):
        z = z0 + 0.012 + i * (2 * zh - 0.02) / (n_b - 1)
        t = 0.3 if i % 2 else -0.3
        nb = norm(V(t * sx, t * 0.45, 1))
        band = Inter(Offset(snap, 0.0068), Slab(V(an[0], an[1], z), nb, 0.0052), Slab(V(0, 0, zc), V(0, 0, 1), zh + 0.002),
                     k=0.0015)
        S.add(Bounded(band, lo, hi), 0.0012, mat="leather")
    pc = kn + V(0, -0.036, 0.004)
    cop = Inter(Offset(snap, 0.009), Ellipsoid(pc, V(0.044, 0.052, 0.056)), HalfSpace(kn + V(0, -0.008, 0), V(0, 1, 0)),
                k=0.005)
    S.add(Bounded(cop, kn - 0.14, kn + 0.14), 0.003, mat="trim")


def cuirass(S, snap, L):
    """Sleeveless jade scale cuirass from under the belt to a stand collar at the neck (bare shoulders and arms),
    rolled trim rims at the collar, the armholes and the hem, a small bronze serpent clasp at the collar."""
    t = 0.0068
    nk = L["neck"]
    z_hi = float(nk[2]) + 0.06
    # c2r1b: a big shoulder ball (bare deltoids like the v2 ref; r1a left puffy cap sleeves)
    C = arm_cutter(L, r_up=0.074, r_fore=0.064, ball=(0.062, -0.008, 0.112))
    keep = Inter(HalfSpace(V(0, 0, CUIRASS_LO), V(0, 0, -1)), HalfSpace(V(0, 0, z_hi), V(0, 0, 1)), k=0.003)
    lo, hi = V(-0.3, -0.3, CUIRASS_LO - 0.03), V(0.3, 0.3, z_hi + 0.03)
    reg = Diff(Inter(Offset(snap, t), keep, k=0.003), C, k=0.004)
    S.add(Bounded(BH.ScaleField(reg, amp=0.0022), lo, hi), 0.0, mat="scale")
    rim_arm = Inter(Offset(snap, t + 0.003), Diff(Offset(C, 0.008), C), keep, k=0.0015)
    S.add(Bounded(rim_arm, lo, hi), 0.0012, mat="trim")
    rim_col = Diff(Inter(Offset(snap, t + 0.0032), Slab(V(0, 0, z_hi - 0.005), V(0, 0, 1), 0.005), k=0.0015), C)
    S.add(Bounded(rim_col, lo, hi), 0.0012, mat="trim")
    gear.medallion(S, V(0, -0.3, z_hi - 0.022), r=0.016, mat="bronze")


def armlet(S, L, side):
    """Coiled bronze serpent armlet on the bare upper arm (2 turns + a small head)."""
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    Lu = float(np.linalg.norm(el - sh))
    u1 = norm(np.cross(a, V(0, -1, 0)))
    u2 = np.cross(a, u1)
    raw = []
    for th in np.linspace(0, 4 * math.pi, 44):
        raw.append(sh + a * (Lu * (0.5 + 0.11 * th / (4 * math.pi))) + (u1 * math.cos(th) + u2 * math.sin(th)) * 0.09)
    P = S.project(np.array(raw), offset=0.0036)
    S.add(Chain(list(P), 0.0038), 0.0015, mat="bronze")
    d = norm(P[-1] - P[-2])
    S.add(Ellipsoid(P[-1] + d * 0.006, V(0.009, 0.006, 0.0045), basis(d, V(0, 0, 1))), 0.002, mat="bronze")


def kilt_params(S, z=BELT_Z - 0.015):
    c = V(0, 0.01, z)
    xs = ray_hit(S, c, V(1, 0, 0), r_max=0.5)[0]
    yf = ray_hit(S, c, V(0, -1, 0), r_max=0.5)[1]
    yb = ray_hit(S, c, V(0, 1, 0), r_max=0.5)[1]
    rx = float(xs) + 0.006
    ry = (float(yb) - float(yf)) / 2 + 0.006
    return dict(top_z=BELT_Z - 0.012, hem_z=0.5, r_top=rx, r_hem=rx * 1.2, squash=ry / rx, cy=float(yf + yb) / 2,
                yf=float(yf), yb=float(yb))


# ---------------------------------------------------------------------------- tabards (kilt chain)
TABARDS = [  # angle (0 = front, +pi/2 = her left), half width, hem z, layer, kind, seed
    (0.62, 0.07, 0.58, 0, "cloth", 23), (-0.62, 0.07, 0.6, 0, "cloth", 24),
    (1.5, 0.072, 0.64, 0, "cloth", 25), (-1.5, 0.072, 0.62, 0, "cloth", 26),
    (2.45, 0.075, 0.57, 0, "cloth", 27), (-2.45, 0.075, 0.59, 0, "cloth", 28),
    (0.0, 0.066, 0.46, 1, "scale", 21), (math.pi, 0.078, 0.45, 1, "scale", 22),
]


def ring_pt(kp, a, out=0.0):
    r = kp["r_top"] + out
    return V(math.sin(a) * r, kp["cy"] - math.cos(a) * r * kp["squash"], 0.0)


def tabards(kp):
    """Long torn tabards: a scale-leather centre panel front + back (pointed, trimmed) over light torn side layers
    (ragged hems + slits); a row of bone fangs hanging off the belt in front."""
    S = Sculpt(materials=MATERIALS, default_mat="cloth")
    top = kp["top_z"] + 0.012

    def cone(off):
        return RoundCone(V(0, kp["cy"], top + 0.02), V(0, kp["cy"], 0.34), kp["r_top"] + off, kp["r_hem"] + 0.03 + off,
                         squash=(kp["squash"], 1.0))
    for ang, w, hz, layer, kind, seed in TABARDS:
        d = V(math.sin(ang), -math.cos(ang), 0)
        side_v = V(math.cos(ang), math.sin(ang), 0)
        c0 = V(0, kp["cy"], top)
        pc = V(0, kp["cy"], hz)
        off = 0.0055 * layer
        sh = Shell(cone(off), 0.0034 + 0.0006 * layer)
        edges = Inter(HalfSpace(V(0, kp["cy"], 0) + d * 0.02, -d),
                      HalfSpace(c0 + side_v * w, norm(side_v + V(0, 0, -0.08))),
                      HalfSpace(c0 - side_v * w, norm(-side_v + V(0, 0, -0.08))),
                      HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.003)
        lo, hi = V(-0.5, -0.5, hz - 0.1), V(0.5, 0.5, top + 0.04)
        if kind == "scale":
            outline = Inter(edges, HalfSpace(pc, norm(V(0, 0, -1) + side_v * 0.75)),
                            HalfSpace(pc, norm(V(0, 0, -1) - side_v * 0.75)), k=0.003)
            S.add(Bounded(BH.ScaleField(Inter(sh, outline, k=0.002), amp=0.0018), lo, hi), 0.0, mat="scale")
            border = Inter(Offset(sh, 0.0014), Diff(Offset(outline, 0.002), Offset(outline, -0.009)), k=0.002)
            S.add(Bounded(border, lo, hi), 0.001, mat="trim")
        else:
            hem = Displace(HalfSpace(pc, V(0, 0, -1)), 0.022, 24.0, 2, seed=seed)
            outline = Inter(edges, hem, k=0.002)
            panel = Inter(sh, outline, k=0.002)
            rng = np.random.RandomState(seed)
            for u in (-0.6, -0.05, 0.5):
                uu = (u + rng.uniform(-0.15, 0.15)) * w
                ln = rng.uniform(0.05, 0.11)
                M = np.stack([side_v, d, V(0, 0, 1)], axis=1)
                q = pc + side_v * uu + d * (kp["r_top"] + 0.03)
                q = V(q[0], q[1], hz + ln * 0.45)
                panel = Diff(panel, Ellipsoid(q, V(0.0045, 0.08, ln), M), k=0.002)
            S.add(Bounded(Displace(panel, 0.0008, 18.0, 2, seed=seed), lo, hi), 0.0, mat="cloth")
    return S


def fangs(kp):
    """Bone fangs on the belt's lower edge (front arc) -- own piece, rigid on the hips (in the tabard mesh they
    were split between kilt chains and stretched)."""
    S = Sculpt(materials=MATERIALS, default_mat="bone")
    roots = [ring_pt(kp, a, 0.016) + V(0, 0, BELT_Z - 0.02) for a in np.linspace(-1.2, 1.2, 15)]
    S.add(Chain(roots, 0.0038), 0.0, mat="leather_dark")
    for i in range(9):
        a = -1.05 + 2.1 * i / 8
        d = V(math.sin(a), -math.cos(a), 0)
        root = ring_pt(kp, a, 0.016) + V(0, 0, BELT_Z - 0.02)
        ln = 0.05 + 0.012 * (1 - abs(a) / 1.05)
        pts = [root, root + d * 0.006 + V(0, 0, -ln * 0.5), root + d * 0.014 + V(0, 0, -ln)]
        S.add(Chain(pts, [0.0072, 0.0058, 0.0012]), 0.002, mat="bone")
        S.add(Sphere(root + V(0, 0, 0.003), 0.0068), 0.002, mat="bronze")
    return S


def hand_sculpt(L, side):
    """Fingerless dark leather glove over the palm/back of the hand (fingers bare), gripping the whip-spear (R)."""
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip" if side == "R" else "relaxed", STYLE, grip_r=GRIP_R)
    W = L["wrist_" + side]
    snap = S.snapshot()
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    sc = L["P"]["hand"] / 0.2
    glove = Inter(Offset(snap, 0.0026), HalfSpace(W + h * (0.082 * sc), h), k=0.003)
    S.add(Bounded(glove, W - 0.17, W + 0.17), 0.0, mat="leather_dark")
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S


# ============================================================================ ponytail (hair_* spring chain)
HAIR_CHAIN = 3
FANG_BOX = (V(-0.3, -0.3, 0.85), V(0.3, 0.3, 1.02))


def pony_curve(S, H):
    """High ponytail: from the crown tie up and back THROUGH the crest's top notch, then falling behind the crest
    and down the back to the waist (flared off the back so it swings clear)."""
    hy = crest_back_y(-0.035)
    pts = [PONY_TIE(H) + V(0, -0.006, 0), H(0, hy, -0.035), H(0, hy + 0.035, -0.05), H(0, hy + 0.055, -0.1),
           H(0, hy + 0.062, -0.16)]
    for j, z in enumerate((1.48, 1.37, 1.26, 1.16, 1.07)):
        yb = float(trace_in(S, V(0, 0.0, z), V(0, 1, 0), r=0.4)[1])
        pts.append(V(0.028 * math.sin(j * 0.75), yb + 0.055 + 0.03 * (1.48 - z), z))      # a lazy S off the spine
    P, _ = anatomy.resample(np.array(pts), step=0.008)
    return P


PONY_CHAIN_START = 6        # index in the raw point list (behind the crest) where the spring chain starts


def chain_points(C, H, n=HAIR_CHAIN):
    """Spring bones only on the hanging part (behind the crest); the arc over the crest rides the head."""
    start = H(0, crest_back_y(-0.035) + 0.055, -0.1)
    i0 = int(np.argmin(np.linalg.norm(C - start, axis=1)))
    D = C[i0:]
    sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(D, axis=0), axis=1))])
    ts = np.linspace(0.0, 0.97, n + 1) * sl[-1]
    return [V(np.array([np.interp(t, sl, D[:, a]) for a in range(3)])) for t in ts]


def ponytail(C, H):
    """Five twisted clumps around the curve (clump read + strand grooves for the bake), swelling below the tie and
    tapering to a point; two cuff rings at the tie."""
    S = Sculpt(materials=MATERIALS, default_mat="hair")
    s = H.s
    n = len(C)
    f = np.linspace(0, 1, n)
    R = (0.012 + 0.024 * np.sin(np.clip(f * 2.6, 0, 1) * math.pi / 2) * (1 - 0.74 * f ** 1.2) + 0.002 * (1 - f)) * s
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = V(1, 0, 0)
    U1 = np.cross(T, ref)
    U1 /= np.maximum(np.linalg.norm(U1, axis=1, keepdims=True), 1e-9)
    U2 = np.cross(T, U1)
    for k in range(5):
        ph = k * 2 * math.pi / 5 + f * 2.6
        off = (U1 * np.cos(ph)[:, None] + U2 * np.sin(ph)[:, None]) * (R * 0.58)[:, None]
        S.add(Chain(list(C + off), list(R * 0.56)), 0.0018 * s, mat="hair")
    S.add(Chain(list(C), list(R * 0.72)), 0.0015 * s, mat="hair")
    for fi in (0.035, 0.07):
        i = int(fi * n)
        S.add(Torus(C[i], float(R[i]) * 0.95, 0.0036 * s, basis(T[i], V(0, 0, 1))[:, [1, 2, 0]]), 0.002, mat="trim")
    return S


def pony_bounds(C):
    return C.min(axis=0) - 0.08, C.max(axis=0) + 0.08


# ============================================================================ rigid gear
# C2 r6 HOOD (board r5: "the hood is invisible in profile -- a flat disc behind the head"): a CUPPED cobra-hood
# shell -- a slice of an ellipsoid shell tilted forward (top over the crown), cut to a spade outline in its own
# front plane. Where the outline reaches the ellipsoid's equator (the wide flares at temple height) the rim comes
# forward beside the head; at the top and the nape it stays back -- so from the side camera the hood shows as a
# deep curved shape behind/above the head with a bright rim, and from the front as a wide flared frame.
HOOD_C = (0.0, 0.01, 0.035)          # ellipsoid centre (H units)
HOOD_R = (0.21, 0.165, 0.215)         # radii: x / back (b) / up (u)
HOOD_TILT = 9.0                      # deg: the top leans forward over the crown
HOOD_T = 0.0072                      # shell half-thickness (H units)
HOOD_APEX = 0.19                     # u of the spade's apex (where the serpent leaves the hood)


def hood_axes():
    th = math.radians(HOOD_TILT)
    u = V(0, -math.sin(th), math.cos(th))
    b = V(0, math.cos(th), math.sin(th))
    return V(1, 0, 0), b, u


def hood_pt(x, zu, out=0.0):
    """H-frame point on the hood's mid surface at local (x, u); out = offset along the back axis (H units)."""
    X, b, u = hood_axes()
    rx, rb, ru = HOOD_R
    yb = rb * math.sqrt(max(1.0 - (x / rx) ** 2 - (zu / ru) ** 2, 0.0))
    return V(*HOOD_C) + X * x + b * (yb + out) + u * zu


def crest_back_y(z, x=0.0):
    """H-y of the hood's mid surface (back side) at H-height z (bisection along +y)."""
    X, b, u = hood_axes()
    c = V(*HOOD_C)
    rx, rb, ru = HOOD_R
    lo, hi = c[1], c[1] + 0.5
    for _ in range(40):
        m = (lo + hi) / 2
        q = V(x, m, z) - c
        f = (x / rx) ** 2 + (float(q @ b) / rb) ** 2 + (float(q @ u) / ru) ** 2
        lo, hi = (m, hi) if f < 1 else (lo, m)
    return (lo + hi) / 2


def serpent_path(H):
    """The crest serpent's spine (H frame -> world): up the hood's back from just above the ponytail ring, over the
    apex, rising free above the crown and arching forward into the head over the brow."""
    pts = [hood_pt(0, zu, 0.024) for zu in (0.0, 0.05, 0.1, 0.14)]
    ap = hood_pt(0, HOOD_APEX, 0.012)
    pts += [ap + V(0, 0.004, 0.02), ap + V(0, -0.006, 0.07), ap + V(0, -0.03, 0.11), ap + V(0, -0.062, 0.128)]
    P, _ = anatomy.resample(np.array([H(*p) for p in pts]), step=0.005)
    return P


def crest(H, captain=False):
    """The cobra crest (C2 r6). Both parts rigid on the head:
    1) the HOOD: cupped spade-shaped scale shell (see HOOD_*): DARK scaled outer face (paint 'outer'), pale belly
       inner face with dark cross bands (the cobra's hood markings), a bright rolled rim -- the value contrast that
       makes the shape read against sky and rock; the ponytail threads through a ringed hole low on its back;
    2) the SERPENT: a thick scaled cobra body up the hood's back and over the apex, rising free above the crown and
       arching forward: its own flared hood just behind the head, a big wedge head over the brow with an OPEN mouth
       (upper + lower jaw, red mouth, bone fangs), dark bead eyes under bright brow ridges, a pale belly stripe
       down its front. Captain: gold + a crown of spikes along the hood's upper rim."""
    S = Sculpt(materials=GEAR_MATS, default_mat="scale")
    s = H.s
    Xa, b, u = hood_axes()
    M = np.stack([Xa, b, u], axis=1)
    c = H(*HOOD_C)
    rx, rb, ru = HOOD_R
    E = Ellipsoid(c, H.r(rx, rb, ru), M)
    t = HOOD_T * s
    big = 3.0
    outline = Union(Ellipsoid(c + u * 0.012 * s, H.r(0.204, big, 0.185), M),
                    Ellipsoid(c - u * 0.11 * s, H.r(0.088, big, 0.1), M), k=0.05 * s)
    apex = c + u * HOOD_APEX * s
    for sx in (1, -1):
        outline = Inter(outline, HalfSpace(apex, norm(u + Xa * sx * 0.5)), k=0.03 * s)
    keep = Inter(outline, HalfSpace(c - u * 0.16 * s, -u), HalfSpace(c + b * 0.01 * s, -b), k=0.006 * s)
    hz = -0.035
    hole_c = H(0, crest_back_y(hz), hz)
    hole = Ellipsoid(hole_c, H.r(0.022, 0.06, 0.022))
    lo, hi = c - 0.32, c + 0.32
    sheet = Diff(Inter(Shell(E, t), keep, k=0.003), hole, k=0.002)
    S.add(Bounded(BH.ScaleField(sheet, amp=0.0018), lo, hi), 0.0, mat="scale")
    rim = Inter(Shell(E, t + 0.0026), Diff(outline, Offset(outline, -0.012 * s)), keep, k=0.002)
    S.add(Bounded(rim, lo, hi), 0.002, mat="trim")
    hb = norm(hole_c - c)
    S.add(Torus(hole_c, 0.023 * s, 0.0045 * s, basis(hb, V(0, 0, 1))[:, [1, 2, 0]]), 0.002, mat="trim")
    # value design: dark outer face, pale inner face with dark hood bands
    S.paint(Bounded(Diff(Offset(sheet, 0.004), E), lo, hi), "outer", soft=0.002, value=1.0)
    inner = Inter(Offset(sheet, 0.004), E)
    for j, zu in enumerate((-0.1, -0.045, 0.01, 0.065, 0.12)):    # dark hood bands on the scale-coloured inner face
        S.paint(Bounded(Inter(inner, Slab(c + u * zu * s, u, (0.011 - 0.0012 * j) * s)), lo, hi), "mark2", soft=0.004,
                value=0.6)
    S.paint(Bounded(Inter(inner, Diff(outline, Offset(outline, -0.03 * s))), lo, hi), "belly", soft=0.01, value=0.6)
    # ---- the serpent
    P = serpent_path(H)
    n = len(P)
    f = np.linspace(0, 1, n)
    Rb = np.interp(f, [0, 0.08, 0.5, 0.85, 1.0], [0.012, 0.029, 0.028, 0.022, 0.02]) * s
    T_ = np.gradient(P, axis=0)
    T_ /= np.linalg.norm(T_, axis=1, keepdims=True)
    body = Chain(list(P), list(Rb), squash=(0.92, 1.0), ref=(0, -1, 0))
    S.add(BH.ScaleField(body, amp=0.0014), 0.008 * s, mat="scale")
    Nf = np.cross(T_, V(1, 0, 0))                    # body 'front' normal (belly side), in the yz plane
    Nf /= np.linalg.norm(Nf, axis=1, keepdims=True)
    Nf *= np.where(Nf[:, 1] < 0, 1, -1)[:, None]     # face forward (-y) / down
    for i in range(1, n - 1):
        S.paint(Bounded(Inter(Sphere(P[i], float(Rb[i]) * 1.25), HalfSpace(P[i] + Nf[i] * float(Rb[i]) * 0.25, -Nf[i])),
                        P[i] - 0.05, P[i] + 0.05), "belly", soft=0.003, value=0.95)
        if f[i] < 0.86:
            S.paint(Bounded(Inter(Sphere(P[i], float(Rb[i]) * 1.3), HalfSpace(P[i] + Nf[i] * float(Rb[i]) * 0.1, Nf[i])),
                            P[i] - 0.05, P[i] + 0.05), "outer", soft=0.004, value=0.9)
    # the cobra's own flared hood just behind its head (cupped back -> a swelling of the neck in profile)
    i_n = int(n * 0.84)
    tn = T_[i_n]
    nb = -Nf[i_n]
    Mf = np.stack([V(1, 0, 0), nb, tn], axis=1)
    fl = Ellipsoid(P[i_n] + nb * 0.006 * s, H.r(0.084, 0.022, 0.06), Mf)
    S.add(BH.ScaleField(fl, amp=0.0012), 0.01 * s, mat="scale")
    S.paint(Bounded(Inter(Offset(fl, 0.004), HalfSpace(P[i_n], nb)), P[i_n] - 0.1, P[i_n] + 0.1), "belly", soft=0.004,
            value=0.9)
    S.paint(Bounded(Inter(Offset(fl, 0.004), HalfSpace(P[i_n] + nb * 0.004 * s, -nb)), P[i_n] - 0.1, P[i_n] + 0.1),
            "outer", soft=0.004, value=0.9)
    S.add(Inter(Shell(Offset(fl, 0.0), 0.0022 * s), Diff(Ellipsoid(P[i_n], H.r(0.088, 0.06, 0.064), Mf),
                                                       Ellipsoid(P[i_n], H.r(0.072, 0.06, 0.05), Mf))), 0.002,
          mat="trim")
    # head: a wedge over the brow, mouth OPEN (C2 r6: >= 12 px long at 1x in the stage-2 lineup)
    k_ = 1.3
    hd = norm(T_[-1] * 0.6 + V(0, -1, -0.32) * 0.4)
    up = norm(V(0, 0, 1) - hd * float(hd[2]))
    lat0 = norm(np.cross(hd, up))
    Mh = np.stack([lat0, hd, up], axis=1)                     # x lateral, y forward, z up
    hinge = P[-1] + hd * 0.004 * s
    hc = hinge + hd * 0.05 * k_ * s + up * 0.006 * s
    S.add(Ellipsoid(hc, H.r(0.034, 0.064, 0.021) * k_, Mh), 0.012 * s, mat="scale")              # upper head
    S.add(Ellipsoid(hc - hd * 0.03 * k_ * s + up * 0.004 * s, H.r(0.04, 0.03, 0.022) * k_, Mh), 0.01 * s,
          mat="scale")                                                                          # jowls
    ca, sa = math.cos(math.radians(30)), math.sin(math.radians(30))
    jd = norm(hd * ca - up * sa)
    Mj = np.stack([lat0, jd, norm(np.cross(lat0, jd))], axis=1)
    jc = hinge + jd * 0.04 * k_ * s - up * 0.012 * s
    S.add(Ellipsoid(jc, H.r(0.026, 0.046, 0.0085) * k_, Mj), 0.006 * s, mat="scale")             # lower jaw
    mouth = Union(Ellipsoid(hc - up * 0.02 * k_ * s + hd * 0.008 * s, H.r(0.022, 0.05, 0.012) * k_, Mh),
                  Ellipsoid(jc + Mj[:, 2] * 0.008 * s, H.r(0.018, 0.04, 0.007) * k_, Mj), k=0.006 * s)
    S.paint(mouth, "mouth", soft=0.004, value=1.0)
    S.paint(Bounded(Inter(Ellipsoid(hc, H.r(0.05, 0.09, 0.05) * k_, Mh), HalfSpace(hc - up * 0.004 * s, -up)),
                    hc - 0.12, hc + 0.12), "outer", soft=0.006, value=1.0)
    for sx in (1, -1):
        lat = lat0 * sx
        ec = hc + lat * 0.026 * k_ * s - hd * 0.014 * k_ * s + up * 0.008 * k_ * s
        S.add(Sphere(ec, 0.0085 * k_ * s), 0.002, mat="leather_dark")                        # dark bead eye
        S.add(Ellipsoid(ec + up * 0.0075 * k_ * s + lat * 0.002 * s, H.r(0.009, 0.016, 0.004) * k_, Mh), 0.003 * s,
              mat="trim")                                                                       # bright brow ridge
        tip = hc + hd * 0.05 * k_ * s + lat * 0.012 * k_ * s - up * 0.012 * k_ * s
        S.add(RoundCone(tip, tip - up * 0.036 * k_ * s + hd * 0.006 * s, 0.0048 * k_ * s, 0.0009), 0.002,
              mat="bone")                                                                       # fangs
    if captain:                              # spikes radiating along the hood's upper rim
        for j in range(9):
            a = math.radians(-80 + j * 20)
            if abs(j - 4) < 0.5:
                continue                     # the serpent rises there
            d2 = V(math.sin(a), 0, math.cos(a))
            lx, lz = d2[0] * 0.196, 0.03 + d2[2] * 0.15
            p = H(*hood_pt(lx, lz, 0.0))
            dw = norm(Xa * d2[0] + u * d2[2])
            ln = (0.058 - 0.014 * abs(j - 4) / 4) * s
            S.add(RoundCone(p - dw * 0.008, p + dw * ln, 0.0085 * s, 0.0016), 0.004, mat="trim")
    return S


def mantle(snapA, L, side, big=False):
    """Serpent-scale shoulder mantle: three overlapping scale lames stepping down the deltoid, dark rolled rims,
    one short bone fang at the top."""
    S = Sculpt(materials=GEAR_MATS, default_mat="scale")
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    cap = sh + a * 0.03 + up * 0.02
    R = 0.104 * (1.06 if big else 1.0)
    lo, hi = cap - 0.25, cap + 0.25
    plane = HalfSpace(sh - up * 0.035, -up)
    inner = HalfSpace(V(float(sh[0]) - sx * 0.06, 0, 0), V(-sx, 0, 0))
    rim_mat = "trim" if big else "leather_dark"
    for i, (t0, t) in enumerate(((0.0, 0.017), (0.045, 0.0132), (0.09, 0.0095))):
        rr = R - 0.016 * i
        body = Inter(BM.shell(snapA, t, t - 0.006), Sphere(cap + a * t0, rr), plane, inner, k=0.004)
        S.add(Bounded(BH.ScaleField(body, amp=0.0016), lo, hi), 0.0015, mat="scale")
        rim = Inter(BM.shell(snapA, t + 0.0015, t - 0.005), Diff(Sphere(cap + a * t0, rr + 0.001),
                                                               Sphere(cap + a * t0, rr - 0.0045)),
                    plane, inner, k=0.002)
        S.add(Bounded(rim, lo, hi), 0.0015, mat=rim_mat)
    d = norm(up + V(sx * 0.35, 0, 0))
    p = trace_in(S, sh + a * 0.02, d, r=0.3)
    S.add(RoundCone(p - d * 0.006, p + d * (0.05 if big else 0.034) + a * 0.012, 0.009, 0.0016), 0.004, mat="bone")
    return S


def bracer_plate(snapF, L, side):
    """Crimson / captain: a bronze plate over the outer forearm (on top of the leather bracer), ridged + riveted."""
    S = Sculpt(materials=GEAR_MATS, default_mat="trim")
    sx = 1 if side == "L" else -1
    el, wr, b, Lf = forearm_frame(L, side)
    c = el + b * Lf * 0.6
    outer = norm(V(sx, 0, 0) - b * float(np.dot(V(sx, 0, 0), b)))
    reg = Inter(BM.shell(snapF, 0.0115, 0.0055), Slab(c, b, Lf * 0.21), HalfSpace(c - outer * 0.012, -outer), k=0.003)
    lo, hi = c - 0.2, c + 0.2
    S.add(Bounded(reg, lo, hi), 0.0, mat="trim")
    rim = Inter(BM.shell(snapF, 0.0135, 0.0095), Diff(Slab(c, b, Lf * 0.21), Slab(c, b, Lf * 0.21 - 0.006)),
                HalfSpace(c - outer * 0.012, -outer), k=0.0015)
    S.add(Bounded(rim, lo, hi), 0.001, mat="trim")
    p0 = trace_in(S, c - b * Lf * 0.17, outer, r=0.2)
    p1 = trace_in(S, c + b * Lf * 0.17, outer, r=0.2)
    S.add(Chain([p0, (p0 + p1) / 2 + outer * 0.002, p1], 0.0034), 0.002, mat="trim")
    return S


def cape_fill(half):
    """(axis a, axis b, radius) of the capsule the cape drapes over (behind the back)."""
    return V(0.06 if half else 0.0, 0.035, 1.34), V(0.07 if half else 0.0, 0.065, 1.02), 0.14


def cape(snapT, L, half=False):
    """Dusk: a dark torn half-cape hanging from the LEFT shoulder down the back-left to the hips. Captain: a short
    red cape across both shoulders to the waist. C2 r6 (board r5: 'capes are rigid wedges'): cloth FOLDS -- fold
    ridges fanning out from the shoulders to a fuller wavy hem -- and the cape now hangs on cape_L/cape_R spring
    chains (src/anim/springs.js 'cape' family), so it swings with the walk, hits and turns."""
    S = Sculpt(materials=GEAR_MATS, default_mat="cape")
    fa, fb, fr = cape_fill(half)
    fill = Capsule(fa, fb, fr)
    hz = 1.0 if half else 1.06
    ridges = []
    xs = (0.015, 0.075, 0.135, 0.19) if half else (-0.15, -0.075, 0.0, 0.075, 0.15)
    for i, x in enumerate(xs):
        def yb(z):
            t = (fa[2] - z) / (fa[2] - fb[2])
            ay = fa[1] + (fb[1] - fa[1]) * t
            ax = fa[0] + (fb[0] - fa[0]) * t
            return ay + math.sqrt(max(fr * fr - (x - ax) ** 2, 0.0))
        z0, z1 = 1.36, hz - 0.03
        a = V(x, yb(z0) - 0.012, z0)
        b = V(x * 1.12 + (0.012 if i % 2 else -0.012), yb(z1) + 0.008, z1)
        ridges.append(RoundCone(a, b, 0.006, 0.027 + 0.006 * (i % 2)))
    drape = Union(Offset(snapT, 0.014), fill, k=0.05)
    drape = Union(drape, *ridges, k=0.022)
    sheet = Shell(drape, 0.0032)
    if half:
        keep = Inter(HalfSpace(V(-0.03, 0, 0), V(-1, 0, 0)), HalfSpace(V(0.235, 0, 0), V(1, 0, 0)),
                     HalfSpace(V(0, -0.02, 0), V(0, -1, 0)), k=0.01)
    else:
        keep = Inter(HalfSpace(V(-0.2, 0, 0), V(-1, 0, 0)), HalfSpace(V(0.2, 0, 0), V(1, 0, 0)),
                     HalfSpace(V(0, -0.015, 0), V(0, -1, 0)), k=0.01)
    shoulder = Union(*[Sphere(L["shoulder_" + s_] + V(-0.01 * (1 if s_ == "L" else -1), 0.0, 0.03), 0.075)
                       for s_ in (("L",) if half else ("L", "R"))])
    top = Union(HalfSpace(V(0, 0, 1.47), V(0, 0, 1)), shoulder)
    hem = Displace(HalfSpace(V(0, 0, hz), V(0, 0, -1)), 0.022, 18.0, 2, seed=41 if half else 43)
    reg = Inter(sheet, keep, top, hem, k=0.004)
    reg = Diff(reg, arm_cutter(L, r_up=0.064, r_fore=0.06), k=0.004)
    rng = np.random.RandomState(7 if half else 9)
    for x in (np.linspace(0.0, 0.2, 3) if half else np.linspace(-0.15, 0.15, 4)):
        ln = rng.uniform(0.05, 0.1)
        reg = Diff(reg, Ellipsoid(V(float(x) + rng.uniform(-0.02, 0.02), 0.15, hz + ln * 0.4), V(0.005, 0.15, ln)),
                   k=0.002)
    lo, hi = V(-0.32, -0.25, 0.9), V(0.32, 0.36, 1.62)
    S.add(Bounded(Displace(reg, 0.001, 16.0, 2, seed=5), lo, hi), 0.0, mat="cape")
    clasp = L["shoulder_L"] + V(-0.06, -0.06, 0.035)
    S.add(Bounded(Inter(Offset(snapT, 0.02), Sphere(clasp, 0.022)), clasp - 0.05, clasp + 0.05), 0.003, mat="trim")
    return S


# cape spring chains (rig: cape_L_1..2 + cape_R_1..2 under chest; jade/crimson carry them unweighted)
CAPE_CHAIN_Z = (1.40, 1.21, 1.0)
CAPE_CHAIN_X = 0.1


def cape_chain_bones():
    out = []
    for side, sx in (("L", 1), ("R", -1)):
        par, conn = "chest", False
        for i in range(len(CAPE_CHAIN_Z) - 1):
            za, zb = CAPE_CHAIN_Z[i], CAPE_CHAIN_Z[i + 1]
            ya, yb_ = 0.15 + 0.02 * i, 0.15 + 0.02 * (i + 1)
            nm = f"cape_{side}_{i+1}"
            out.append((nm, V(sx * CAPE_CHAIN_X, ya, za), V(sx * CAPE_CHAIN_X * 1.08, yb_, zb), par, conn))
            par, conn = nm, True
    return out


def cape_post(half):
    """skin.skin post hook: the cape's top stays on the sdf torso weights (chest / clavicles), below it the cape
    hangs on its chain(s) -- a smooth z blend chest -> cape_*_1 -> cape_*_2, and L/R by x for the captain."""
    z0, z1, z2 = CAPE_CHAIN_Z

    def post(P, names, W):
        z, x = P[:, 2], P[:, 0]
        chain = [i for i, n in enumerate(names) if n.startswith("cape_")]
        W = W.copy()
        W[:, chain] = 0.0
        W = W / np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
        w_top = shaders.smooth01(z, z0 - 0.07, z0 + 0.01)
        w2 = shaders.smooth01(-z, -(z1 + 0.02), -(z1 - 0.09))
        w1 = np.clip(1.0 - w_top - w2, 0, 1)
        sL = np.ones(len(P)) if half else np.clip(0.5 + x / 0.12, 0, 1)
        W = W * w_top[:, None]
        for side, ws in (("L", sL), ("R", 1 - sL)):
            for k, wk in ((1, w1), (2, w2)):
                nm = f"cape_{side}_{k}"
                if nm in names:
                    W[:, names.index(nm)] += wk * ws
        W, _ = skin.top_k(W, 4)
        return W / np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    return post


def gear_bounds(name, L):
    if name.startswith("crest"):
        return V(-0.3, -0.25, 1.4), V(0.3, 0.32, 2.0)
    if name.startswith("cape"):
        return V(-0.32, -0.25, 0.9), V(0.32, 0.36, 1.62)
    if name.startswith("plate"):
        el, wr, b, Lf = forearm_frame(L, name[-1])
        c = el + b * Lf * 0.6
        return c - 0.2, c + 0.2
    sh = L["shoulder_" + name[-1]]
    return sh - 0.25, sh + 0.25


CAPE_BONES = ["spine", "chest", "neck", "clavicle_L", "clavicle_R"]


def gear_bone(name):
    """Rigid parent bone; None = skinned (capes)."""
    if name.startswith("crest"):
        return "head"
    if name.startswith("cape"):
        return None
    if name.startswith("plate"):
        return "forearm_" + name[-1]
    return "upperarm_" + name[-1]


def build_gear(S_body, L, H, names, h=0.0028):
    t = time.time()
    names = sorted(set(names))
    need_sh = any(n.startswith("mantle") for n in names)
    snapA = charkit.GridSDF(S_body, h=h, lo=V(-0.55, -0.35, 1.2), hi=V(0.55, 0.35, 1.7)) if need_sh else None
    snapT = (charkit.GridSDF(S_body, h=0.004, lo=V(-0.4, -0.3, 0.85), hi=V(0.4, 0.35, 1.66))
             if any(n.startswith("cape") for n in names) else None)
    snapF = {}
    for nm in names:
        if nm.startswith("plate") and nm[-1] not in snapF:
            el, wr, b, Lf = forearm_frame(L, nm[-1])
            c = el + b * Lf * 0.6
            snapF[nm[-1]] = charkit.GridSDF(S_body, h=0.0022, lo=c - 0.16, hi=c + 0.16)
    pipeline.log(f"gear grid SDFs {time.time()-t:.1f}s")
    out = {}
    for nm in names:
        if nm.startswith("crest"):
            Sg = crest(H, captain=nm.endswith("captain"))
        elif nm.startswith("cape"):
            Sg = cape(snapT, L, half=nm.endswith("half"))
        elif nm.startswith("plate"):
            Sg = bracer_plate(snapF[nm[-1]], L, nm[-1])
        else:
            Sg = mantle(snapA, L, nm[-1], big=(nm[-1] == "R"))
        out[nm] = (Sg, gear_bone(nm))
    return out


GEAR_TRIS = {"crest": 1700, "crest_captain": 1900, "mantle": 540, "plate": 260, "cape_half": 760, "cape_captain": 860}
SYM_GEAR = ("crest", "cape_captain")


# ============================================================================ palette + painters
# C2 r1 VALUE LADDER (albedo luma, sRGB) -- the three base tiers must separate in GREYSCALE:
#   jade    LIGHT : light jade scale ~50 %, pale ochre torn tabards ~70 %, pale wraps, bone trims, mid-brown leggings ~28 %
#   crimson MID   : crimson scale ~28 %, rust tabards ~38 %, bronze trims + bronze bracer plates, dark leggings ~17 %
#   dusk    DARK  : plum-black scale ~13 %, charcoal tabards ~18 %, dark half-cape, pewter trims, near-black leggings
#   captain       : black-jade scale + GOLD trims, red tabards + red short cape, spiked gold crest, both mantles
# Skin (olive-bronze ~52 %) and the bare arms + belt + wraps are the constant value breaks in every tier.
PAL = dict(
    skin=shaders.srgb(176, 124, 92), skin_warm=shaders.srgb(190, 104, 82), skin_cool=shaders.srgb(118, 102, 96),
    lips=shaders.srgb(128, 52, 54), skin_rough=0.58, tattoo=shaders.srgb(14, 12, 12),
    iris=shaders.srgb(206, 172, 40), sclera=shaders.srgb(214, 204, 186),
    brow=shaders.srgb(20, 16, 14), brow_hi=shaders.srgb(50, 44, 40), brow_hi_amt=0.04, brow_rough=0.85,
    hair=shaders.srgb(20, 16, 15), hair_hi=shaders.srgb(72, 60, 54), hair_hi_amt=0.22, hair_rough=0.5,
    legging=shaders.srgb(92, 70, 54), legging_worn=shaders.srgb(136, 110, 88),
    leather=shaders.srgb(104, 72, 48), leather_worn=shaders.srgb(150, 114, 80),
    leather_dark=shaders.srgb(44, 32, 26), leather_dark_worn=shaders.srgb(88, 70, 56), sole=shaders.srgb(40, 30, 24),
    scale=shaders.srgb(86, 150, 104), scale_rim=shaders.srgb(206, 210, 168), scale_deep=shaders.srgb(18, 54, 34),
    cloth=shaders.srgb(204, 186, 140), wrap=shaders.srgb(156, 156, 108), cape=shaders.srgb(40, 32, 50),
    bone=shaders.srgb(230, 216, 182), bone_dark=shaders.srgb(120, 100, 70),
    trim=shaders.srgb(226, 212, 176), trim_bone=True, trim_patina=shaders.srgb(110, 90, 50), trim_patina_amt=0.25,
    bronze=shaders.srgb(186, 146, 72), bronze_patina=shaders.srgb(76, 66, 46), bronze_patina_amt=0.3,
    mark=shaders.srgb(206, 176, 90), mark2=shaders.srgb(16, 22, 16), belly=shaders.srgb(214, 220, 178),
)
TIER_PAL = {
    "jade": {},
    "crimson": dict(scale=shaders.srgb(170, 44, 38), scale_rim=shaders.srgb(222, 150, 96), scale_deep=shaders.srgb(52, 8, 10),
                    belly=shaders.srgb(220, 168, 126), cloth=shaders.srgb(150, 84, 52), wrap=shaders.srgb(112, 62, 44),
                    legging=shaders.srgb(56, 38, 32), legging_worn=shaders.srgb(96, 70, 58),
                    leather=shaders.srgb(72, 48, 34), leather_worn=shaders.srgb(120, 88, 62),
                    trim=shaders.srgb(186, 132, 62), trim_bone=False, trim_patina=shaders.srgb(80, 60, 40),
                    iris=shaders.srgb(232, 140, 30), lips=shaders.srgb(112, 38, 42), mark=shaders.srgb(214, 150, 70)),
    "dusk": dict(scale=shaders.srgb(48, 32, 68), scale_rim=shaders.srgb(122, 106, 152), scale_deep=shaders.srgb(12, 6, 20),
                 belly=shaders.srgb(104, 92, 126), cloth=shaders.srgb(54, 46, 62), wrap=shaders.srgb(46, 40, 52),
                 legging=shaders.srgb(28, 24, 30), legging_worn=shaders.srgb(62, 56, 66),
                 leather=shaders.srgb(40, 32, 34), leather_worn=shaders.srgb(80, 70, 72),
                 bone=shaders.srgb(168, 156, 132), cape=shaders.srgb(34, 26, 46),
                 trim=shaders.srgb(96, 92, 100), trim_bone=False, trim_patina=shaders.srgb(40, 36, 50),
                 iris=shaders.srgb(206, 120, 236), lips=shaders.srgb(88, 38, 58), mark=shaders.srgb(140, 110, 170)),
    "captain": dict(scale=shaders.srgb(28, 46, 38), scale_rim=shaders.srgb(214, 176, 80), scale_deep=shaders.srgb(6, 12, 10),
                    belly=shaders.srgb(214, 186, 110), cloth=shaders.srgb(152, 26, 30), wrap=shaders.srgb(70, 24, 26),
                    legging=shaders.srgb(26, 22, 22), leather=shaders.srgb(54, 36, 28), cape=shaders.srgb(146, 22, 28),
                    trim=shaders.srgb(224, 174, 72), trim_bone=False, mark=shaders.srgb(230, 190, 90),
                    iris=shaders.srgb(244, 200, 60)),
}


def p_viper_scale(c, pal):
    rgb, rough, metal, emit = BH.p_scale(c, pal)
    w = c.paint("belly")              # pale belly scales on the crest's inner face (keeps the scale shading)
    if w.any():
        rgb = shaders.mix(rgb, rgb / np.maximum(pal["scale"], 1e-3) * pal["belly"] * 0.8 + pal["belly"] * 0.2,
                          np.clip(w, 0, 1) * 0.85)
    w = c.paint("outer")              # C2 r6: the crest's DARK outer scales (value contrast vs sky / rock)
    if w.any():
        dk = np.asarray(pal["scale_deep"]) * 1.05 + np.asarray(pal["scale"]) * 0.06
        lum = rgb.mean(axis=1) / max(float(np.mean(pal["scale"])), 1e-3)   # keep only a faint scale pattern
        dark = dk[None, :] * np.clip(0.6 + 0.4 * lum, 0.65, 1.35)[:, None]
        wo = np.clip(w, 0, 1)
        rgb = shaders.mix(rgb, dark, wo * 0.94)
        metal = metal * (1.0 - 0.8 * wo)          # no bright metallic scale lips on the dark side
        rough = rough + 0.12 * wo
    for key in ("mark", "mark2"):
        w = c.paint(key)
        if w.any():
            rgb = shaders.mix(rgb, pal[key], np.clip(w, 0, 1) * 0.92)
    w = c.paint("mouth")              # the crest cobra's open mouth
    if w.any():
        rgb = shaders.mix(rgb, shaders.srgb(120, 26, 30), np.clip(w, 0, 1) * 0.9)
    return rgb, rough, metal, emit


def p_trim(c, pal):
    if pal.get("trim_bone"):
        return BM.p_bone(c, dict(pal, bone=pal["trim"]))
    return shaders.p_metal(c, pal, "trim")


def p_viper_skin(c, pal):
    """BH.p_skin (lash line, brow strokes) + natural matte lips (lip colour follows the sculpted lip shapes) and
    the small scale marks under the left eye."""
    face = shaders.smooth01(c.P[:, 2], 1.55, 1.6)
    c.cf = c.cf * (1.0 - 0.8 * face)         # C2 r6: much softer painted creases on the face (board: 'hard creases')
    c.cb = c.cb * (1.0 - 0.8 * face)
    rgb, rough, metal, emit = BH.p_skin(c, pal)
    lips = np.clip(c.paint("lips") * 1.1, 0, 1)
    if lips.any():
        rgb = shaders.mix(rgb, pal["lips"], 0.62 * lips)
        rough = rough + 0.2 * lips
    m = c.paint("mark")
    if m.any():
        rgb = shaders.mix(rgb, pal["mark"], 0.8 * np.clip(m, 0, 1))
    return rgb, np.clip(rough, 0.3, 0.9), metal, emit


def p_viper_eye(c, pal):
    """Lib eye + a vertical SLIT pupil and a stronger inward gaze convergence (board: 'slightly wall-eyed')."""
    rgb, rough, metal, emit = shaders.p_eye(c, pal)
    ex = c.x["eyes"]
    P = c.P
    idx = np.argmin(np.stack([np.linalg.norm(P - e, axis=1) for e in ex]), axis=0)
    C = np.array(ex)[idx]
    d = P - C
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    f = np.tile(V(0, -1, 0), (c.n, 1))
    f[:, 0] += np.where(C[:, 0] > 0, -0.1, 0.1)
    f /= np.linalg.norm(f, axis=1, keepdims=True)
    ir = c.x.get("iris_deg", 30.0)
    ang = np.degrees(np.arccos(np.clip(np.sum(d * f, axis=1), -1, 1)))
    # re-centre: repaint the iris disc around the converged axis over the lib's (sclera outside it)
    up = V(0, 0, 1)
    e1 = np.cross(f, up)
    e1 /= np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-9)
    e2 = np.cross(e1, f)
    lx = np.degrees(np.arcsin(np.clip(np.sum(d * e1, axis=1), -1, 1)))
    ly = np.degrees(np.arcsin(np.clip(np.sum(d * e2, axis=1), -1, 1)))
    iris = pal["iris"]
    t = np.clip(ang / ir, 0, 1)
    phi = np.arctan2(ly, lx)
    streak = 0.5 + 0.5 * np.sin(phi * 31.0)
    icol = iris * (0.78 + 0.36 * streak)[:, None]
    icol = shaders.mix(icol, np.minimum(iris * 1.5, 1), shaders.smooth01(t, 0.6, 0.25) * 0.45)
    icol = shaders.mix(icol, iris * 0.22, shaders.smooth01(t, 0.8, 1.0))
    sclera = np.tile(pal["sclera"], (c.n, 1))
    sclera = shaders.mix(sclera, shaders.srgb(190, 130, 118), shaders.smooth01(ang, 45, 80) * 0.6)
    sclera = shaders.mix(sclera, sclera * 0.6, 0.6 * shaders.smooth01(ang, ir, ir + 6) * (ang < ir + 8))
    rgb = np.where((ang < ir)[:, None], icol, sclera)
    slit = (np.abs(lx) / 2.6) ** 2 + (ly / (ir * 0.78)) ** 2 < 1.0
    rgb[slit] = shaders.srgb(6, 6, 8)
    return rgb, rough, metal, emit


def p_hair(c, pal):
    rgb, rough, metal, emit = shaders.p_hairmass(c, pal, "hair")
    return rgb, np.clip(rough, 0.4, 0.7), metal, emit


PAINTERS = {"skin": p_viper_skin, "eye": p_viper_eye, "scale": p_viper_scale, "bone": BM.p_bone, "trim": p_trim,
            "hair": p_hair,
            "legging": lambda c, pal: shaders.p_leather(c, pal, "legging"),
            "cloth": lambda c, pal: BM.p_rag(c, pal, "cloth"),
            "wrap": lambda c, pal: BM.p_rag(c, pal, "wrap"),
            "cape": lambda c, pal: BM.p_rag(c, pal, "cape")}


def tier_pal(tier):
    p = dict(PAL)
    p.update(TIER_PAL[tier])
    return p


# ============================================================================ previews
MAT_COLORS = {"skin": (0.6, 0.42, 0.32), "eye": (0.8, 0.8, 0.7), "nail": (0.5, 0.45, 0.4), "brow": (0.05, 0.04, 0.03),
              "hair": (0.03, 0.025, 0.02), "scale": (0.1, 0.42, 0.2), "cloth": (0.62, 0.52, 0.32),
              "wrap": (0.36, 0.36, 0.2), "legging": (0.1, 0.06, 0.04), "leather": (0.16, 0.09, 0.05),
              "leather_dark": (0.03, 0.025, 0.02), "sole": (0.02, 0.02, 0.02), "bone": (0.85, 0.8, 0.66),
              "trim": (0.85, 0.8, 0.66), "bronze": (0.6, 0.45, 0.2), "cape": (0.03, 0.02, 0.05)}


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(VIPER)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    BM.HORNS.clear()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    tiers = ("jade", "crimson", "dusk", "captain")
    G = build_gear(S, L, H, [g for t in tiers for g in TIERS[t]])
    PC = pony_curve(S, H)
    base = [charkit.mesh_sculpt(S, "body", args.h or 0.0035, colors=MAT_COLORS),
            charkit.mesh_sculpt(tabards(info["kilt"]), "kilt", 0.003, colors=MAT_COLORS),
            charkit.mesh_sculpt(fangs(info["kilt"]), "fangs", 0.002, *FANG_BOX, colors=MAT_COLORS),
            charkit.mesh_sculpt(ponytail(PC, H), "pony", 0.0025, *pony_bounds(PC), colors=MAT_COLORS)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(hand_sculpt(L, s), "hand_" + s, 0.002, w - 0.17, w + 0.17, colors=MAT_COLORS))
    for i, tier in enumerate(tiers):
        dx = V(i * 1.0, 0, 0)
        for g in TIERS[tier]:
            o = charkit.mesh_sculpt(G[g][0], g + f"_{i}", 0.0025, *gear_bounds(g, L), colors=MAT_COLORS)
            o.location = dx
        if i:
            for b in base:
                o = meshutil.duplicate(b, b.name + f"_{i}")
                o.location = dx
    views = [dict(target=(1.5, 0, 0.95), ortho=4.2, yaw=y, dist=12, pitch=6) for y in (0, 35, 160, 90)]
    preview.render_views(os.path.join(out, "viper_full.png"), views, res=(1100, 760))
    views = [dict(target=(0.0, 0, 1.6), ortho=0.6, yaw=y, dist=6, pitch=4) for y in (0, 30, 90, 180)]
    preview.render_views(os.path.join(out, "viper_head.png"), views, res=(700, 700))
    print(f"[viper] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.03)) / 0.1, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.25)


def build(args):
    global OUT_MODELS, OUT_TEX
    T0 = time.time()
    if args.outdir:                       # staging build (promote by hand)
        od = os.path.abspath(args.outdir)
        OUT_MODELS = os.path.join(od, "models")
        OUT_TEX = os.path.join(od, "textures")
        os.makedirs(OUT_MODELS, exist_ok=True)
        os.makedirs(OUT_TEX, exist_ok=True)
    report_path = (os.path.join(os.path.abspath(args.outdir), "viper_report.json") if args.outdir
                   else os.path.join(HERE, "out", "viper_report.json"))
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_hand, h_kilt, h_gear = ((0.004, 0.0014, 0.003, 0.0018) if fast else (0.0021, 0.0009, 0.0016, 0.001))
    meshutil.clear_scene()
    BM.HORNS.clear()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(VIPER)
    tiers = args.tiers.split(",") if args.tiers else list(TIERS)
    if args.stage == "skin":
        tiers = ["captain"]
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {}, "tiers": {}}

    t = time.time()
    S, info = body_sculpt(L)
    hi_ = info["head"]
    H = hi_["H"]
    KP = info["kilt"]
    report["kilt"] = KP
    Sk = tabards(KP)
    Sf = fangs(KP)
    Sh = {s: hand_sculpt(L, s) for s in ("L", "R")}
    G = build_gear(S, L, H, [g for t_ in tiers for g in TIERS[t_]])
    PC = pony_curve(S, H)
    St = ponytail(PC, H)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, KILT_CHAIN)
    L["hair_chain_pts"] = chain_points(PC, H)
    arm = rig.build_armature(L, ASSET, hair_chain=HAIR_CHAIN, kilt_chain=KILT_CHAIN, extra=cape_chain_bones())

    t = time.time()
    his = {}
    hb0, hb1 = HEAD_BOX
    if args.stage != "skin":
        his["body"] = [pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX),
                       pipeline.sculpt_mesh(S, "head_hi", h_body * 0.45, hb0, hb1, keep_box=HEAD_BOX)]
        for o in his["body"]:
            charkit.drop_islands(o, h_body)
        for s in ("L", "R"):
            w = L["wrist_" + s]
            his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)]
        his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
        his["fangs"] = [pipeline.sculpt_mesh(Sf, "fangs_hi", h_gear * 1.2, *FANG_BOX)]
        his["pony"] = [pipeline.sculpt_mesh(St, "pony_hi", h_kilt * 0.8, *pony_bounds(PC))]
        for nm, (Sg, _) in G.items():
            o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *gear_bounds(nm, L))
            charkit.drop_islands(o, h_gear, min_verts=40)
            his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.0034 if not fast else 0.0042

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, args.hand_tris, w - 0.17, w + 0.17,
                                            symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.003, args.kilt_tris)
    los["fangs"] = pipeline.lowpoly(Sf, "fangs_lo", 0.002, 420, *FANG_BOX, symmetry=True)
    los["pony"] = pipeline.lowpoly(St, "pony_lo", 0.0026, 900, *pony_bounds(PC), symmetry=False)
    for nm, (Sg, _) in G.items():
        sym = nm.startswith(SYM_GEAR)
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0024, GEAR_TRIS.get(nm, GEAR_TRIS.get(nm.split("_")[0])),
                                   *gear_bounds(nm, L), symmetry=sym,
                                   clean=lambda o: charkit.drop_islands(o, 0.0024, min_verts=30))
    for o in los.values():
        charkit.drop_islands(o, 0.0034, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_", "cape_"))]
    body_W = skin.skin(los["body"], arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, KILT_CHAIN)
    charkit.rigid_bind(los["fangs"], arm, "hips")
    root = np.array(arm.data.bones["hair_1"].head_local)

    def pony_root(P):                     # tie + the arc over the crest ride the head rigidly
        return np.clip((P[:, 2] - (root[2] - 0.012)) / 0.03, 0, 1)
    skin.skin(los["pony"], arm, method="sdf", allowed=["head"] + [f"hair_{i+1}" for i in range(HAIR_CHAIN)],
              power=3.0, overrides=[(pony_root, "head")])
    for nm, (_, bone) in G.items():
        if bone is None:                  # capes: top on the upper torso + clavicles, the rest on the cape chains
            chain = [b_[0] for b_ in cape_chain_bones() if nm.endswith("captain") or "_L_" in b_[0]]
            skin.skin(los[nm], arm, method="sdf", allowed=CAPE_BONES + chain, power=3.0, smooth=2,
                      post=cape_post(nm.endswith("half")), restrict=False)
        else:
            charkit.rigid_bind(los[nm], arm, bone)
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    common = ["body", "hand_L", "hand_R", "kilt", "fangs", "pony"]
    if args.stage == "skin":
        obs = [los[k] for k in common + TIERS["captain"]]
        for o in obs:
            pipeline.strip_for_export(o)
        body = meshutil.join(obs, ASSET + "_mesh")
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.log(f"tris captain {meshutil.tri_count(body)}")
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "viper_skin_test.glb"), [arm, body],
                            scene_name=ASSET)
        return

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=2.8, head_density=1.0,
                                                 face_box=(-0.012, -0.16, 0.5))   # C2 r6: no forehead seam
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.9)
    charkit.smart_uv(los["pony"], 70.0, 1.0)
    charkit.smart_uv(los["fangs"], 66.0, 1.0)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.3 if nm.startswith("crest") else 1.0)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    extra_p = dict(eyes=[tuple(e) for e in hi_["eyes"]], eye_r=hi_["eye_r"], eye_fwd=hi_["eye_fwd"],
                   z_knee=float(VIPER["knee_z"]), z_chest=float(VIPER["chest_z"]), iris_deg=28.0, pupil_deg=11.0)
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk, "fangs": Sf, "pony": St}
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
        for o in all_hi + list(los.values()):
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                             ("normal", "NORMAL", 4 if fast else 8)])
        prefix = f"{ASSET}_{tier}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix, tint=(0.4, 0.44, 0.4))
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
        rep["stretch_qa"] = {k: dict(bad=q["bad"], soft=q["soft"], pairs=q["pairs"]) for k, q in qa.items()}
        pipeline.log(f"[{tier}] stretch QA: " + ", ".join(f"{k}: bad {q['bad']} soft {q['soft']}" for k, q in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        rep["glb"] = out
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        if tier == "jade":
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
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--skin", default="sdf")
    ap.add_argument("--body-tris", type=int, default=7700)
    ap.add_argument("--head-tris", type=int, default=2300)
    ap.add_argument("--hand-tris", type=int, default=460)
    ap.add_argument("--kilt-tris", type=int, default=1700)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
