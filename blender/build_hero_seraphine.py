"""Build Seraphine Vey (hero, 'The Ember Blade-Dancer') with the blender/lib pipeline.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_hero_seraphine.py -- [options]
Options:
  --preview body|full|face|hair   clay renders to progress/shots/hero-seraphine/dev/ (no export)
  --fast                          lower hi-poly resolution + 1024 bake (pipeline smoke test)
  --stage uv                      LO + skin + UV atlas, logs UV fold/overlap counts, no export
  --stage skin                    LO meshes + weights + stretch QA only (writes progress/tmp/seraphine_skin_test.glb)
  --no-weapon                     skip Dawn / Dusk (blender/build_weapon_dawn_dusk.py)
Default: full pipeline -> public/assets/models/hero_seraphine.glb, textures public/assets/textures/seraphine_*.png,
report blender/out/seraphine_report.json.

Design (docs/DESIGN.md 2): 1.76 m lithe blade-dancer. Overlapping scale-leather cuirass (real scale rows in the bake
source: ScaleField), leather neckline + armhole rims, a LEFT pauldron of three teal lames with bronze rims, a cross
strap, a crimson sash with a knot on the left hip and two long trailing tails (kilt_L spring chain), a slung belt,
split tassets, dark leather leggings, knee-high boots with teal greaves + knee cops, bracers, a gold circlet with one small
sun-disc, dry-brushed rust war paint across the cheekbones. Hair: swept back into a long thick auburn 3-strand braid (hair_1..5 spring
chain) with bronze cuffs, plus loose locks framing the face.
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
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Shell, Displace, SymX, Prim, Func)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "hero-seraphine", "dev")
ASSET = "hero_seraphine"

SERA = dict(
    height=1.76, head_h=0.222,
    shoulder_x=0.176, shoulder_z=1.438, clav_in_x=0.02,
    hip_x=0.088, hip_joint_z=0.905, pelvis_z=0.95,
    knee_z=0.49, ankle_z=0.080, foot_len=0.235, stance_x=0.096,
    spine_z=1.06, chest_z=1.225, neck_z=1.452, head_base_z=1.552,
    upperarm=0.292, forearm=0.255, hand=0.182,
    arm_down=40.0, arm_fwd=6.0, elbow_bend=10.0,
)
STYLE = dict(muscle=0.78, defin=0.5, fat=0.0, chest=0.85, lats=0.74, traps=0.58, waist=0.8, delts=0.67, arm=0.55,
             forearm=0.67, neck=0.6,
             brow=0.95, jaw=0.94, scowl=0.9, cheek=1.12, chin=1.0, nose_bump=0.4, squint=1.15, nose_len=0.84,
             nose_w=0.92, lip=1.12, mouth_w=1.02, eye=1.06, skull_w=0.97, skull_h=1.0, ear=0.92, fem=1.0)
MATERIALS = ["skin", "eye", "nail", "brow", "hair", "leather", "leather_dark", "scale", "armor", "bronze", "cloth",
             "sole", "gem"]
HAIR_MATS = ["mane", "bronze", "gem", "leather_dark"]
KINDS = {"scale": "leather", "armor": "bronze", "gem": "eye", "mane": "mane_clean", "hair": "mane_clean"}
# The hidden scalp cap needs the same smooth micro-normal recipe as the lock support;
# the default 'hair' recipe left a ribbed bright band behind the ear even with matte paint.
# r6: no node-side strand ribbing on the hair at all (the r5 8-strand sine set read as swim-cap ribbing + the
# per-vertex lock-u jumps between fused clumps printed dotted noise); the clump valleys are sculpted instead
WRIST_CUT_T = 0.90
HAND_CUT_T = 0.84
HEAD_BOX = (V(-0.135, -0.145, 1.525), V(0.135, 0.15, 1.775))
NECK_CUT = 1.525          # C2 r2: the base-mesh head/neck is cut here (inside the SDF neck column) and welded
HEAD_MM = 0.8             # base-mesh head grid resolution (mm) -- every build + the numpy previews use 0.8
VENV_PY = os.path.expanduser("~/kca-assets/venv/bin/python")   # numpy+scipy for seraphine_basemesh.py fit
HAIR_CHAIN = 5
FACE_DENSITY = 3.0
# r7 (board r13 "wide columnar neck, lumpy clavicles, throat shadow fusing jaw to chest"): slimmer front volume and
# column (88 mm wide under the jaw, was 94; base-mesh neck_slim .90 -> .86), clavicles 1.1 mm proud with a softer blend
NECK_FRONT = (-0.006, -0.005, 0.041, 0.036)   # r6: front neck volume (y base, y top, r base, r top); r6 = -6,-6,44,40 mm
NECK_FRONT_SQ = 0.88      # x squash of the front volume (r6 0.92)
NECK_COL = (0.046, 0.033, 0.96, 0.95)          # slim neck column (r base, r top, squash x, squash y); r6 50,35,1.05,.95
CLAV_PROUD, CLAV_K = 0.0011, 0.012              # clavicle ridge (proud m, blend k); r6 1.6 mm, 9 mm
CLAVICLE = ((0.017, 1.463), (0.040, 1.466), (0.066, 1.474), (0.092, 1.486), (0.115, 1.497))   # r6 (x, z) right side
SCM_R = 0.0085            # r6: lib sternocleidomastoid capsule radius 13.5 -> 8.5 mm (tubes on the upper chest)
FACE_RELIEF = (1.0, 0.25, 1.0)   # r6: face_normal_relief scale for nose / lips / cheeks+jaw (r12 = 1, 1, 1)
#   fast3: nose 0.5 printed a pale streak down the side of the nose -> back to 1.0; ears added (pale helix rim)
MOUTH_HALF_W = 0.0215     # r6: measured half-width of the fitted mouth crease (seraphine_basemesh mouth_w 0.95)
KILT_CHAIN = 3
KILT_P = dict(top_z=0.985, hem_z=0.72, r_top=0.158, r_hem=0.2, squash=0.8)
TAIL_Z = (0.50, 0.58)          # sash tail ends (left hip), kilt_L chain reaches the lower one
LEG_GAP_TOP = 0.84


# ============================================================================ scale armour field
SC = dict(row_h=0.021, n_around=46, tongue=0.5, cy=0.012, amp=0.0022)


def scale_pattern(X, Y, Z, sc=SC):
    """Overlapping downward-hanging scale rows around the vertical body axis. Returns (h 0..1 height, cell id,
    t 0 at the scale's bottom lip .. 1 under the row above, xs -1..1 across the scale)."""
    a = np.arctan2(X, -(Y - sc["cy"]))
    u = (a / (2 * math.pi) + 0.5) * sc["n_around"]
    rh = sc["row_h"]
    r0 = np.floor(Z / rh)
    h = np.zeros_like(Z)
    t_out = np.ones_like(Z)
    xs_out = np.zeros_like(Z)
    cid = np.zeros_like(Z)
    done = np.zeros(Z.shape, bool)
    for dr in (1, 0, -1):             # the row above overlaps the row below
        r = r0 + dr
        off = 0.5 * np.mod(r, 2)
        f = u - off
        col = np.floor(f)
        xs = (f - col) * 2 - 1
        zb = r * rh - sc["tongue"] * rh * np.sqrt(np.clip(1 - xs * xs, 0, 1))
        cov = (~done) & (Z >= zb)
        t = np.clip((Z - zb) / (rh * (1.0 + sc["tongue"])), 0, 1)
        hh = (1 - t) ** 0.7 * (0.72 + 0.28 * (1 - xs * xs))
        h = np.where(cov, hh, h)
        t_out = np.where(cov, t, t_out)
        xs_out = np.where(cov, xs, xs_out)
        cid = np.where(cov, r * 1000 + col, cid)
        done |= cov
    return h, cid, t_out, xs_out


class ScaleField(Prim):
    """Child field with the scale rows displaced outward (real overlapping lips for the normal/AO bake)."""

    def __init__(self, p, amp=SC["amp"]):
        self.p, self.amp = p, float(amp)
        self.lo, self.hi = p.lo - amp, p.hi + amp

    def d(self, X, Y, Z):
        base = self.p.d(X, Y, Z)
        X, Y, Z, base = np.broadcast_arrays(X, Y, Z, base)
        near = np.abs(base) < 0.02
        out = base.copy()
        if near.any():
            h, _, _, _ = scale_pattern(X[near], Y[near], Z[near])
            out[near] = base[near] - self.amp * h
        return out


# ============================================================================ sculpts
def forearm_frame(L, side):
    el, wr = L["elbow_" + side], L["wrist_" + side]
    b = norm(wr - el)
    return el, wr, b, float(np.linalg.norm(wr - el))


def arm_capsule(L, side, r=0.062, ext=0.02):
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    d = norm(el - sh)
    return Capsule(sh - d * ext, el, r)


def body_sculpt(L, gear_on=True, parts=("torso", "arms", "legs", "head")):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    T = anatomy.Frame(L)
    info = {"arms": {}, "legs": {}}
    if "torso" in parts:
        anatomy.torso(S, L, STYLE)
        # female masses: wider pelvis / hips, a modest bust (the cuirass moulds over it)
        anatomy.E(S, T, (0.128, 0.012, 0.99), (0.085, 0.092, 0.11), k=0.05, sym=True)
        anatomy.E(S, T, (0.068, -0.078, 1.43), (0.074, 0.062, 0.07), M=rot(0, 0, 10), k=0.045, sym=True)
    if "arms" in parts:
        for s in ("L", "R"):
            info["arms"][s] = anatomy.arm(S, L, s, STYLE)
    if "legs" in parts:
        for s in ("L", "R"):
            info["legs"][s] = anatomy.leg(S, L, s, STYLE)
            anatomy.foot(S, L, s)
    if "head" in parts:
        info["head"] = sera_head(S, L)
        global CROWN_Z
        CROWN_Z = float(L["head"][2])
    if "torso" in parts and "arms" in parts:
        anatomy.torso_details(S, L, STYLE)
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    if "head" in parts:
        H = info["head"]["H"]
        brows_paint(S, H, info["head"].get("lm"))
        face_paint(S, L, H, info["head"])
    if not gear_on:
        return S, info
    snap = S.snapshot()
    if "arms" in parts:
        for s in ("L", "R"):
            el, wr, b, Lf = forearm_frame(L, s)
            c = el + b * Lf * WRIST_CUT_T
            S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
            gear.bracer(S, snap, L, s, info["arms"][s], t0=0.38, thick=0.0065)
    if "legs" in parts:
        leggings(S, snap, L)
        thigh_wraps(S, L)
        for s in ("L", "R"):
            gear.boot(S, snap, L, s, info["legs"][s], top=0.445, thick=0.008)
    if "torso" in parts:
        cuirass(S, snap, L)
    snap2 = S.snapshot()
    if "legs" in parts:
        for s in ("L", "R"):
            greave(S, snap2, L, s)
    if "torso" in parts:
        pauldron(S, snap2, L, "L")
        armband(S, snap2, L, "R")
        sash_and_belt(S, snap2, L)
    if "head" in parts:
        H = info["head"]["H"]
        scalp_cap_for(S, snap, H)
    if "legs" in parts:
        anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.014)
    return S, info


# ============================================================================ head (Wave C2 r2: CC0 base mesh)
class GridPrim(Prim):
    """Trilinear signed-distance grid in the world frame as a primitive: the fitted base-mesh head
    (blender/seraphine_basemesh.py, docs/ASSET_SOURCES.md). Outside the grid the value grows with the distance to
    the grid box, so projection / collision never see a plateau."""

    def __init__(self, G, x0, h):
        self.G, self.x0, self.h = np.asarray(G, np.float32), np.asarray(x0, float), float(h)
        self.shape = np.array(self.G.shape)
        self.lo, self.hi = self.x0.copy(), self.x0 + self.h * (self.shape - 1)

    def d(self, X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        shp = X.shape
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        f = (P - self.x0) / self.h
        fc = np.clip(f, 0, self.shape - 1.000001)
        i = np.floor(fc).astype(np.int64)
        t = fc - i
        G = self.G
        out = np.zeros(len(P))
        for dx in (0, 1):
            wx = t[:, 0] if dx else 1 - t[:, 0]
            for dy in (0, 1):
                wy = t[:, 1] if dy else 1 - t[:, 1]
                for dz in (0, 1):
                    wz = t[:, 2] if dz else 1 - t[:, 2]
                    out += wx * wy * wz * G[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        out += np.linalg.norm((f - fc) * self.h, axis=1)
        return out.reshape(shp)


_HEAD = {}


def head_grid(mm=None):
    """Fitted head grid; rebuild the local cache when absent or its authored fit parameters changed."""
    mm = float(mm or HEAD_MM)
    if mm in _HEAD:
        return _HEAD[mm]
    path = os.path.join(HERE, "out", f"seraphine_head_sdf_{mm:.1f}.npz")
    import seraphine_basemesh
    stale = not os.path.exists(path)
    if not stale:
        with np.load(path) as cached:
            params = json.loads(str(cached["landmarks"])).get("params", {})
        stale = params != json.loads(json.dumps(seraphine_basemesh.PARAMS))
    if stale:
        import subprocess
        tmp = os.path.join(HERE, "out", f"seraphine_head_{mm:.1f}")
        subprocess.run([VENV_PY, os.path.join(HERE, "seraphine_basemesh.py"), "fit", tmp, "--sdf", str(mm)], check=True)
        os.replace(os.path.join(tmp, "head_sdf.npz"), path)
    d = np.load(path)
    lm = json.loads(str(d["landmarks"]))
    for k, v in list(lm.items()):
        if isinstance(v, list) and len(v) == 3:
            lm[k] = V(*v)
    _HEAD[mm] = (GridPrim(d["G"], d["x0"], float(d["h"])), lm)
    return _HEAD[mm]


def sera_head(S, L):
    """Seraphine's head, Wave C2 r2: the CC0 Blender Human Base Meshes female head (fitted + deformed toward
    docs/refs/c2/heroes/seraphine_head.png by seraphine_basemesh.py, as a signed-distance grid) welded onto the
    SDF body at a neck seam inside the slim neck column, with separate eyeball surfaces (sclera sphere + cornea
    bulge, material 'eye') in the sockets and the lash / brow / lip / war-paint channels placed from the fitted
    mesh's landmarks. Six rounds of SDF primitive faces hit their ceiling (board r6, orchestrator r8 review).
    Returns the same dict as anatomy.head (+ 'lm')."""
    H = anatomy.HeadFrame(L)
    grid, lm = head_grid()
    # ---- the lib torso's neck + cords are sized for Brann: carve them out of the head zone and rebuild slim
    S.sub(Bounded(Inter(Ellipsoid(H(0, 0.0, -0.02), H.r(0.15, 0.17, 0.165)), HalfSpace(H(0, 0, -0.19), V(0, 0.25, -1)),
                        k=0.01), H(0, 0, -0.02) - 0.2, H(0, 0, -0.02) + 0.2), 0.012)
    S.sub(Sphere(L["head"] + V(0, -0.044, -0.035), 0.0135), 0.012)          # lib larynx read as a throat knob
    # slim ONE-column neck: visible below the weld, hidden inside the base-mesh neck above it (no cords)
    S.add(RoundCone(L["neck"] + V(0, 0.014, -0.03), V(0, 0.046, NECK_CUT + 0.035), NECK_COL[0], NECK_COL[1],
                    squash=(NECK_COL[2], NECK_COL[3])), 0.028)
    S.add(Ellipsoid(L["neck"] + V(0, -0.030, -0.050), V(0.040, 0.022, 0.034)), 0.040)      # suprasternal fill (C2 r3: wider, softer)
    # r6 (iter 13, board r12 "pinched sternum crease, deep pits, faceted neck"): the slim column leans back, so the
    # throat sat ~70 mm behind the chest top. A front neck volume brings the throat forward (~-35 mm at the jaw,
    # ~-50 mm at the base) and rolls it into the chest; the lib's Brann-sized sternocleidomastoid tubes are slimmed.
    S.add(RoundCone(V(0, NECK_FRONT[0], 1.452), V(0, NECK_FRONT[1], 1.532), NECK_FRONT[2], NECK_FRONT[3],
                    squash=(NECK_FRONT_SQ, 1.0)), 0.030)
    for op in S.ops:
        pr = op.prim
        if op.kind == "add" and isinstance(pr, RoundCone) and abs(pr.ra - 0.0135) < 1e-9 and abs(pr.rb - 0.0135) < 1e-9:
            pr.ra = pr.rb = SCM_R
        if op.kind == "add" and isinstance(pr, Sphere) and abs(pr.r - 0.0095) < 1e-9:     # lib larynx: female, subtle
            pr.r = 0.0005
    # clavicles: a soft S-curved ridge from the sternal notch to the shoulder, ~1.5 mm proud (reference: defined
    # collarbones; board r12 "lumpy collarbones" came from the tube ends, not from bones)
    for sx in (1, -1):
        raw = np.array([V(sx * x, -0.3, z) for x, z in CLAVICLE])
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        Nn = S.grad(P)
        rr = np.array([0.0040, 0.0046, 0.0046, 0.0042, 0.0038])
        S.add(Chain(list(P - Nn * (rr - CLAV_PROUD)[:, None]), list(rr)), CLAV_K)
    # ---- the fitted base-mesh head + neck, cut at the weld plane (inside the column), soft weld
    head = Inter(grid, HalfSpace(V(0, 0, NECK_CUT), V(0, 0, -1)), k=0.006)     # keep z > NECK_CUT
    S.add(Bounded(head, grid.lo, grid.hi), 0.016)                              # C2 r3: softer weld (throat crease)
    # ---- eyeballs: separate surfaces in the sockets (white sclera, amber-brown iris, dark pupil in p_eye)
    eye_r = float(lm["eye_r"])
    eyes = []
    for key in ("eye_R", "eye_L"):
        ec = lm[key]
        S.add(Sphere(ec, eye_r), 0.0, mat="eye")
        S.add(Sphere(ec + V(0, -0.49 * eye_r, 0), 0.545 * eye_r), 0.0012, mat="eye")      # cornea bulge
        eyes.append(ec)
    # ---- lash line: thin dark paint along the upper lid margin (thinner than r1, no corner flick -> calm)
    f = eye_r / 0.0150
    for ec in eyes:
        sx = 1 if ec[0] > 0 else -1
        raw = np.array([ec + V(sx * x * f, -0.02, z * f) for x, z in ((-0.0125, 0.0034), (-0.0065, 0.0068), (0.0, 0.0080),
                                                                      (0.0075, 0.0074), (0.0140, 0.0056), (0.0180, 0.0046))])
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        S.paint(Chain(list(P), [0.0008, 0.0012, 0.0016, 0.0017, 0.0014, 0.0007]), "lash", soft=0.0012)
        raw = np.array([ec + V(sx * x * f, -0.02, z * f) for x, z in ((0.004, -0.0080), (0.010, -0.0074), (0.0150, -0.0056))])
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        S.paint(Chain(list(P), [0.0004, 0.0006, 0.0005]), "lash", soft=0.0012, value=0.25)
    return dict(H=H, eyes=eyes, eye_r=eye_r, eye_fwd=(0.0, -1.0, 0.0), nose_dz=0.0, mouth_dz=0.0,
                zm=float(lm["lip_line"][2]), lip=1.0, mouth_w=1.0, lm=lm)


def brows_paint(S, H, lm=None):
    """Soft natural auburn brows (reference: fairly straight, peaking at two thirds, tapering tail) painted over
    a low sculpted ridge; positions from the fitted base-mesh landmarks (C2 r2)."""
    ez = float(lm["eye_R"][2]) if lm else H(0, 0, -0.0225)[2]
    for sx in (1, -1):
        raw = np.array([V(sx * x, -0.2, ez + z) for x, z in ((0.011, 0.0150), (0.023, 0.0178), (0.037, 0.0198),
                                                             (0.049, 0.0194), (0.060, 0.0162))])   # v3: flatter
        P = anatomy.surface_hit(S, raw, V(0, 1, 0))
        P, _ = anatomy.resample(P, step=0.002)
        n = len(P)
        rr = np.interp(np.linspace(0, 1, n), [0, 0.2, 0.65, 1], [0.0015, 0.0019, 0.0017, 0.0005])
        S.paint(Chain(list(P), list(rr)), "browpaint", soft=0.0019)
        Nn = S.grad(P)
        rs = rr * 0.8
        S.add(Chain(list(P - Nn * (rs - 0.0004)[:, None]), list(rs)), 0.004)


def face_paint(S, L, H, hi):
    """Lips, blush and the war paint from the fitted landmarks. C2: ONE red-ochre stripe across both cheekbones and
    the bridge of the nose (reference seraphine_head.png), dry-brushed edges; natural lips with NO upper-lip
    shadow (the lip paint covers the whole vermilion, composite AO is light there)."""
    lm = hi["lm"]
    lip = lm["lip_line"]
    eyes = hi["eyes"]
    ec = eyes[0]
    s = H.s
    # r6 (iter 13): the paint is fitted to the SCULPTED mouth. The fitted crease ends at |x| ~ 21.5 mm (measured on
    # head_fit: crease depth > 0.6 mm up to x = 20-22 mm); the old 26.5 mm paint ran ~5 mm past each corner = the
    # board's "flat pale band pasted across the lower face" with flecks at its ends. Upper vermilion up to its
    # border ridge (+6 mm, cupid's-bow peaks +7 mm at |x| = 5 mm, the fit's upper_h), lower down to -8.5 mm, both
    # tapering into the corners.
    mw = MOUTH_HALF_W
    def vermilion(X,Y,Z):
        ax = np.abs(X)
        u = np.clip(ax / mw, 0, 1)
        corner = np.clip(1 - u * u, 0, 1) ** 0.6
        top = (.0056 + .0011*np.exp(-((ax-.005)/.0032)**2) - .0005*np.exp(-(ax/.0018)**2)) * corner
        bottom = -.0085 * corner ** 0.85
        z = Z - lip[2]
        return np.maximum.reduce(np.broadcast_arrays(z-top, bottom-z, ax-mw, Y-(lip[1]+.010)))
    S.paint(Func(vermilion, lip-.06,lip+.06), "lips",soft=.0009)
    # closed mouth line: a thin dark crease from corner to corner (skin-range dark, not black), slightly down-turned
    # at the corners only by the sculpt; radii taper so the corners do not end in dots
    xs = np.linspace(-mw * 0.97, mw * 0.97, 25)
    raw = np.array([V(x, lip[1] - 0.03, lip[2]) for x in xs])
    P = anatomy.surface_hit(S, raw, V(0, 1, 0))
    rr = 0.00035 + 0.00035 * np.clip(1 - (xs / mw) ** 2, 0, 1)
    S.paint(Chain(list(P), list(rr)), "mouthline", soft=0.0008)
    S.paint(Union(Sphere(V(0.046, ec[1] - 0.004, ec[2] - 0.030), 0.019), Sphere(V(-0.046, ec[1] - 0.004, ec[2] - 0.030), 0.019),
                  Sphere(lm["nose_tip"] + V(0, 0.004, 0), 0.009), Sphere(lm["ear_R"], 0.03), Sphere(lm["ear_L"], 0.03)),
            "blush", soft=0.025, value=0.18)
    ey = float(ec[1])
    zc = float(ec[2]) - 0.026           # stripe centre: just under the lower lids, over the cheekbones

    def stripe(X, Y, Z):
        u = X / s
        w = (Z - zc) / s
        n = sdf.fbm(X * 1.0, Y * 1.0, Z * 1.0, 2, 260.0, seed=9)
        n2 = sdf.fbm(X, Y, Z, 2, 90.0, seed=23)
        # r8: tapered brush ends and fibre-scale edge erosion, rather than a rectangular tape mask.
        taper = 1 - shaders.smooth01(np.abs(u), .043, .065)
        brush = np.sin(Z*3300 + X*520 + 2*n2)
        half_h = (0.0050 + 0.0014*n + 0.0009*brush) * taper
        d = np.maximum(np.abs(w) - half_h, np.abs(u) - (0.064 + 0.0015*n2))
        return np.maximum(d * s, Y - (ey + 0.040 * s))          # front of the face only (wraps onto the cheeks)
    c0 = V(0, ey, zc)
    S.paint(Func(stripe, c0 - 0.15, c0 + 0.15), "tattoo", soft=0.00075, value=0.88)


def leggings(S, snap, L):
    reg = Inter(Offset(snap, 0.0026), HalfSpace(V(0, 0, 1.005), V(0, 0, 1)), HalfSpace(V(0, 0, 0.30), V(0, 0, -1)),
                k=0.004)
    S.add(Bounded(reg, V(-0.3, -0.25, 0.28), V(0.3, 0.25, 1.03)), 0.0, mat="leather_dark")
    # stitched seams down the outer thighs
    for s, sx in (("L", 1), ("R", -1)):
        hp, kn = L["hip_" + s], L["knee_" + s]
        raw = [hp + V(sx * 0.2, 0, 0.02), (hp + kn) / 2 + V(sx * 0.2, 0, 0), kn + V(sx * 0.2, 0, 0.02)]
        P = gear.project_path(S, raw, step=0.006, offset=0.0)
        S.add(Chain(list(P), 0.0022), 0.0012, mat="leather")


def _ray_out(S, C, D, r_max=0.15, step=0.002):
    """Per-point outward rays from INSIDE a limb (axis points C, directions D) to its surface (first inside->outside
    crossing), so inner-thigh points never land on the other leg."""
    t = np.zeros(len(C))
    inside = S.dist(C) < 0
    hit = np.zeros(len(C), bool)
    lo = np.zeros(len(C))
    for k in range(int(r_max / step)):
        tt = (k + 1) * step
        out = S.dist(C + D * tt) >= 0
        new = out & ~hit & inside
        lo[new] = tt - step
        t[new] = tt
        hit |= new
        if hit.all():
            break
    for _ in range(10):
        mid = 0.5 * (lo + t)
        out = S.dist(C + D * mid[:, None]) >= 0
        t = np.where(out, mid, t)
        lo = np.where(out, lo, mid)
    return C + D * t[:, None]


def thigh_wraps(S, L):
    """r7 (board r13 "flat plain leggings; dark legs merge with the ground"): cross-gartered mid-brown leather straps
    spiralling up each thigh from the knee cop to mid-thigh (two opposite helices), on top of the dark leggings."""
    for s, sx in (("L", 1), ("R", -1)):
        hp, kn = L["hip_" + s], L["knee_" + s]
        for hand, a0 in ((1, 0.35), (-1, math.pi - 0.35)):
            ts = np.linspace(0.13, 0.66, 56)
            C = np.array([kn + (hp - kn) * t for t in ts])
            ang = a0 + hand * sx * 2 * math.pi * 1.5 * (ts - ts[0]) / (ts[-1] - ts[0])
            D = np.stack([np.cos(ang), np.sin(ang), np.zeros_like(ang)], 1)
            P = _ray_out(S, C, D)
            Nn = S.grad(P)
            # a flat strap: a fat cord sunk so ~3 mm stands proud over a ~10 mm wide band
            S.add(Chain(list(P - Nn * 0.0025), 0.0055), 0.0012, mat="leather")


def neck_cutter(L):
    """Region removed at the neckline: inside an upward-widening funnel round the neck AND above the tilted neck plane.
    r2 lesson (critic r1: torn shards at the collar): a single near-horizontal plane grazes the trapezius slope and a
    capsule coaxial with the arm grazes the deltoid -> feathered slivers that the LO decimation tore into islands.
    Here every cut surface meets the body at a steep angle: the funnel wall is near-vertical where it crosses the
    near-horizontal traps, the plane is near-horizontal where it crosses the near-vertical chest / upper back."""
    nk = L["neck"]
    cx, cy = 0.0, float(nk[1]) + 0.008
    z0 = float(nk[2]) - 0.045
    r0, s = 0.074, 0.35
    k = 1.0 / math.sqrt(1.0 + s * s)

    def fn(X, Y, Z):
        r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
        return (r - r0 - (Z - z0) * s) * k
    funnel = Func(fn, V(-0.3, cy - 0.3, z0 - 0.2), V(0.3, cy + 0.3, z0 + 0.3))
    neck_c = nk + V(0, 0.01, -0.045)
    neck_n = norm(V(0, 0.22, 1))
    return Inter(funnel, HalfSpace(neck_c, -neck_n))


def arm_cutter(L, side, r=0.074):
    """Armhole: a big ball centred well lateral of / below the shoulder joint + a capsule down the arm. A ball
    concentric with the deltoid dome grazes it (r1 coaxial capsule, r2 first try -> torn sleeve bits); centred
    lateral-low its surface crosses the shoulder top at ~75 deg and the chest / armpit wall at ~50 deg, and it
    swallows the whole deltoid. The capsule (26 mm clear of the thin lower upper-arm) takes the rest of the arm."""
    sx = 1 if side == "L" else -1
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    c = sh + V(sx * 0.08, 0.0, -0.06)
    return Union(Sphere(c, 0.165), Capsule(c, el, r))


def cuirass_cutter(L):
    return Union(neck_cutter(L), arm_cutter(L, "L"), arm_cutter(L, "R"))


def cuirass(S, snap, L):
    """Scale cuirass: Offset shell of the torso (sleeveless, high neckline), scale rows displaced outward.
    Sealed edges (r2): the shell is a solid round the body cut by steep-angle cutters, and every rolled rim is a
    one-sided band INSIDE the kept region (Diff(Offset(C, w), C)) sitting on the shell -- never a free-floating
    ring over bare skin (r1 rims were Shell(cut) bands whose outer half hovered 10 mm off the skin)."""
    t = 0.0075
    z_lo = 1.0
    C = cuirass_cutter(L)
    lo, hi = V(-0.3, -0.25, z_lo - 0.02), V(0.3, 0.25, L["neck"][2] + 0.05)
    below = HalfSpace(V(0, 0, z_lo), V(0, 0, -1))
    reg = Diff(Inter(Offset(snap, t), below, k=0.004), C, k=0.004)
    S.add(Bounded(ScaleField(reg), lo, hi), 0.0, mat="scale")
    # rolled leather neckline + armhole rims: one band on the kept side of the cut, flush with the cut face
    band = Diff(Offset(C, 0.0062), C)
    rim = Inter(Offset(snap, t + 0.0035), band, below, k=0.0015)
    S.add(Bounded(rim, lo, hi), 0.0015, mat="leather_dark")
    # bottom hem roll (hidden under the sash top edge, catches the transition)
    rim = Inter(Offset(snap, t + 0.003), Slab(V(0, 0, z_lo + 0.006), V(0, 0, 1), 0.006), k=0.002)
    S.add(Bounded(rim, lo, hi), 0.0015, mat="leather_dark")
    # buckled shoulder straps over the scale yoke (the left one carries the pauldron): leather band front-to-back
    # over the top of each shoulder, kept inside the yoke so it always sits on the shell, bronze buckle plate in front
    for side, sx in (("L", 1), ("R", -1)):
        sh = L["shoulder_" + side]
        xc = sx * 0.104
        n = norm(V(1, 0, sx * 0.25))
        c = V(xc, float(sh[1]), float(sh[2]))
        yoke = Diff(Bounded(Slab(c, n, 0.0125), c - 0.2, c + 0.2), Offset(C, 0.002))
        strap = Inter(Offset(snap, t + 0.0042), yoke, HalfSpace(V(0, 0, 1.33), V(0, 0, -1)), k=0.004)   # r6: softer edges
        S.add(Bounded(strap, c - 0.2, c + 0.2), 0.0015, mat="leather_dark")
        bc = V(xc, float(sh[1]) - 0.09, 1.395)
        plate = Inter(Offset(snap, t + 0.0062), Slab(c, n, 0.0105), Slab(bc, V(0, 0, 1), 0.0085),
                      HalfSpace(V(0, float(sh[1]), 0), V(0, 1, 0)), k=0.0012)
        S.add(Bounded(plate, bc - 0.06, bc + 0.06), 0.001, mat="bronze")


def _perp_up(a):
    u = V(0, 0, 1) - a * float(np.dot(a, V(0, 0, 1)))
    return norm(u)


def pauldron(S, snap, L, side):
    """Three overlapping teal lames over the shoulder cap, bronze rims + rivets (upper lame overlaps lower)."""
    sx = 1 if side == "L" else -1
    sh = L["shoulder_" + side]
    a = L["arm_up_" + side]
    u = _perp_up(a)
    lo, hi = sh - 0.2, sh + 0.2
    lames = [(-0.09, 0.045, 0.0165), (0.035, 0.08, 0.0125), (0.07, 0.112, 0.009)]
    for i, (s0, s1, off) in reversed(list(enumerate(lames))):
        keep_up = HalfSpace(sh - u * (0.012 + 0.008 * i), -u)
        # r6: rounder lame edges (k 0.004 -> 0.007) -- the showcase silhouette edge printed the hard top edges as
        # bright white rim lines (board r5)
        reg = Inter(Offset(snap, off), Sphere(sh + V(sx * 0.01, 0, 0.012), 0.125), HalfSpace(sh + a * s1, a),
                    HalfSpace(sh + a * s0, -a), keep_up, k=0.007)
        if i == 0:
            reg = Inter(reg, HalfSpace(sh - V(sx, 0, 0) * 0.085, V(-sx, 0, 0)), k=0.01)   # stop before the neck
        S.add(Bounded(reg, lo, hi), 0.0, mat="armor")
        rim = Inter(Offset(snap, off + 0.0022), Slab(sh + a * (s1 - 0.004), a, 0.0042), keep_up,
                    Sphere(sh + V(sx * 0.01, 0, 0.012), 0.125), k=0.002)
        S.add(Bounded(rim, lo, hi), 0.001, mat="bronze")
    ridge = gear.project_path(S, [sh - a * 0.06 + u * 0.12, sh + a * 0.02 + u * 0.12], step=0.005)
    S.add(Chain(list(ridge), 0.0034), 0.002, mat="bronze")


def armband(S, snap, L, side):
    sh, el = L["shoulder_" + side], L["elbow_" + side]
    a = norm(el - sh)
    c = sh + (el - sh) * 0.58
    S.add(Bounded(Inter(Offset(snap, 0.0045), Slab(c, a, 0.016), Sphere(c, 0.09), k=0.002), c - 0.1, c + 0.1), 0.0,
          mat="leather_dark")
    S.add(Bounded(Inter(Offset(snap, 0.0065), Slab(c, a, 0.0035), Sphere(c, 0.09), k=0.001), c - 0.1, c + 0.1),
          0.001, mat="bronze")


def cross_strap(S, snap, L):
    """Baldric from the pauldron (left shoulder) across the chest to under the right arm, and back."""
    T = anatomy.Frame(L)
    pts = [T(0.13, 0.3, 1.49), T(0.03, 0.3, 1.40), T(-0.07, 0.3, 1.30), T(-0.15, 0.1, 1.24), T(-0.15, -0.1, 1.24),
           T(-0.07, -0.3, 1.30), T(0.03, -0.3, 1.40), T(0.12, -0.3, 1.50), T(0.155, -0.1, 1.60)]
    gear.strap(S, snap, pts, width=0.036, thick=0.0055, mat="leather_dark")
    gear.medallion(S, T(0.035, -0.3, 1.40), r=0.024)
    gear.studs_on(S, [T(-0.07, -0.3, 1.30), T(0.1, -0.3, 1.48), T(-0.07, 0.3, 1.30)], 0.0042, lift=0.006)


def sash_and_belt(S, snap, L):
    """Crimson sash wound round the waist (folds), knot on the left hip; slung belt with a bronze ring buckle."""
    zc, half = 1.03, 0.032
    n = norm(V(0, 0.08, 1))
    lo, hi = V(-0.3, -0.3, zc - 0.1), V(0.3, 0.3, zc + 0.1)
    band = Inter(Offset(snap, 0.011), Slab(V(0, 0, zc), n, half), k=0.005)
    S.add(Bounded(Displace(band, 0.0018, 38.0, 2, seed=21), lo, hi), 0.002, mat="cloth")
    for dz in (-0.012, 0.011):            # wound folds
        S.add(Bounded(Inter(Offset(snap, 0.0145), Slab(V(0, 0, zc + dz), n, 0.0045), k=0.003), lo, hi), 0.003,
              mat="cloth")
    kn = S.project(np.array([V(0.16, -0.12, zc - 0.004)]), offset=0.0)[0]
    nrm = S.grad(kn[None])[0]
    S.add(Ellipsoid(kn + nrm * 0.008, V(0.021, 0.018, 0.019), basis(nrm, V(0, 0, 1))), 0.006, mat="cloth")
    for sgn in (1, -1):                   # the two loops of the knot
        c = kn + nrm * 0.006 + V(0, 0, sgn * 0.018) + V(-0.004 * sgn, 0, 0)
        S.add(Ellipsoid(c, V(0.026, 0.014, 0.011), basis(V(0.2 * sgn, -0.3, 1.0), nrm)), 0.005, mat="cloth")
    # slung belt, lower at the front-left
    zb = 0.975
    nb = norm(V(0.08, 0.14, 1))
    S.add(Bounded(Inter(Offset(snap, 0.0105), Slab(V(0, 0, zb), nb, 0.014), k=0.002), lo - V(0, 0, 0.1), hi), 0.0,
          mat="leather")
    bc = S.project(np.array([V(-0.05, -0.15, zb + 0.006)]), offset=0.0)[0]   # r2: from -0.3 the projection missed -> buckle floated 17 cm out
    bn = S.grad(bc[None])[0]
    M = np.stack([V(1, 0, 0), norm(np.cross(bn, V(1, 0, 0))), bn], axis=1)
    S.add(RoundBox(bc + bn * 0.012, V(0.016, 0.004, 0.013), M, r=0.003), 0.002, mat="bronze")


def greave(S, snap, L, side):
    kn, an = L["knee_" + side], L["ankle_" + side]
    b = norm(an - kn)
    lo, hi = V(an[0] - 0.12, an[1] - 0.14, 0.1), V(an[0] + 0.12, an[1] + 0.12, kn[2] + 0.12)
    front = HalfSpace(V(0, kn[1] + 0.004, 0), V(0, 1, 0))
    reg = Inter(Offset(snap, 0.0045), front, HalfSpace(V(0, 0, 0.44), V(0, 0, 1)), HalfSpace(V(0, 0, 0.17),
                V(0, 0, -1)), k=0.006)
    S.add(Bounded(reg, lo, hi), 0.001, mat="armor")
    ridge = gear.project_path(S, [V(kn[0], kn[1] - 0.2, 0.42), V(an[0], an[1] - 0.2, 0.2)], step=0.005)
    S.add(Chain(list(ridge), 0.0032), 0.0025, mat="armor")
    for z in (0.43, 0.18):
        S.add(Bounded(Inter(Offset(snap, 0.0068), front, Slab(V(0, 0, z), V(0, 0, 1), 0.0035), k=0.002), lo, hi),
              0.001, mat="bronze")
    # knee cop: domed plate with a bronze rim and a boss
    kc = S.project(np.array([kn + V(0, -0.2, 0.0)]), offset=0.0)[0]
    kcn = S.grad(kc[None])[0]
    cop = Inter(Offset(snap, 0.009), Sphere(kc + kcn * 0.0, 0.052), k=0.006)
    S.add(Bounded(cop, kc - 0.08, kc + 0.08), 0.002, mat="armor")
    S.add(Bounded(Inter(Offset(snap, 0.011), Shell(Sphere(kc, 0.049), 0.003), k=0.002), kc - 0.08, kc + 0.08), 0.001,
          mat="bronze")
    S.add(Sphere(kc + kcn * 0.012, 0.009), 0.004, mat="bronze")


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    ai = anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip", STYLE)
    anatomy.hand_details(S, L, side)
    sc = L["P"]["hand"] / 0.2
    W = L["wrist_" + side]
    h, n = L["hand_h_" + side], L["hand_n_" + side]
    S.paint(Sphere(W + h * 0.1 * sc - n * 0.012, 0.035), "blush", soft=0.025, value=0.18)
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S, ai


def kilt_parts(L):
    k = KILT_P
    S, info = gear.kilt_sculpt(L, MATERIALS, top_z=k["top_z"], hem_z=k["hem_z"], r_top=k["r_top"], r_hem=k["r_hem"],
                               squash=k["squash"], n_strips=10, thick=0.0034, front_flap=False,
                               strip_mats=("scale", "leather"))
    sash_tails(S)
    return S, info


def sash_tails(S):
    """Two long crimson sash tails from the knot on the left hip, hanging outside the tassets (curved shells on a
    wider cone), angled/notched ends, soft folds."""
    k = KILT_P
    top = 1.0
    for j, (a_c, z_end, w) in enumerate(((math.radians(62), TAIL_Z[0], 0.068), (math.radians(84), TAIL_Z[1], 0.058))):
        rt, rh = k["r_top"] + 0.018 + 0.004 * j, k["r_hem"] + 0.05 + 0.006 * j
        z_cone_hem = k["hem_z"] - 0.1
        cone = RoundCone(V(0, 0.012, top + 0.05), V(0, 0.022, z_cone_hem), rt, rh, squash=(k["squash"], 1.0))
        shell = Shell(cone, 0.0028)
        r_mid = (rt + rh) * 0.5
        a_half = (w * 0.5) / r_mid
        d0 = V(math.sin(a_c - a_half), -math.cos(a_c - a_half), 0)
        d1 = V(math.sin(a_c + a_half), -math.cos(a_c + a_half), 0)
        n0 = norm(np.cross(V(0, 0, 1), d0)) * -1.0
        n1 = norm(np.cross(V(0, 0, 1), d1))
        wc = V(0, 0.015, 0)
        mid = V(math.sin(a_c), -math.cos(a_c), 0)
        tang = norm(np.cross(V(0, 0, 1), mid))
        # angled end: lower toward the back
        end_n = norm(V(0, 0, -1) + tang * (0.5 if j == 0 else -0.5))
        pc = wc + mid * r_mid
        end_c = V(pc[0], pc[1], z_end)
        reg = Inter(shell, HalfSpace(wc, n0), HalfSpace(wc, n1), HalfSpace(end_c, end_n),
                    HalfSpace(V(0, 0, top - 0.005), V(0, 0, 1)), k=0.004)
        # sway: the lower part bends slightly outward and back
        lo, hi = V(-0.4, -0.4, z_end - 0.08), V(0.4, 0.4, top + 0.05)
        S.add(Bounded(Displace(reg, 0.0016, 22.0, 2, seed=40 + j), lo, hi), 0.001, mat="cloth")
        # fringe-like weighted hem: a bronze bead at the end
        S.add(Sphere(end_c + mid * 0.004 + V(0, 0, 0.012), 0.0055), 0.002, mat="bronze")


# ============================================================================ hair (Wave C2 r2: swept back + crown plait)
# r1's ~27 round clumps all converged from a root ring on one nape point = a "turban of sausage clumps". r2: ten big
# wide lock masses per side (44-52 x 18-22 mm, hard shingle valleys, strand grooves in the hi bake source) that SWEEP
# BACK from the hairline (front locks over the crown, side locks horizontally behind the ear, nape locks down) into
# a French plait running down the centre-back of the scalp (reference seraphine_hair_back.png), which continues as
# the thick free three-strand braid; three crown locks ride higher; two round temple tendrils per side frame the
# face. Reference: docs/refs/c2/heroes/seraphine_head.png, seraphine_hair_back.png.
SCALP = dict(thick=0.006, front_z=0.078, back_z=-0.055, noise=0.0, k_edge=0.014, k_exclude=0.012)
GATHER = dict(az=math.pi, el=math.radians(-24.0), off=0.004, r=0.022)
BRAID = dict(length=0.60, r0=0.030, r1=0.016, period=0.082, clear=0.03)
FRENCH = dict(el0=math.radians(55.0), r=0.026, period=0.075, clear=0.45)      # crown-to-nape plait on the scalp (v3: starts behind the crown; v4: wider = the dominant form on the back)
# (az deg, el_root deg, el_target deg (on the centre-back line), width, thick, bulge, bow, bulge peak t) per lock;
# az > 0 entries are mirrored (bow sign flipped)
# v3 (fast build #1 read as a mushroom helmet: 22 mm locks + 12 mm bulge + 9 mm cap = 45 mm of hair over the skull,
# and the side locks ran horizontally to the plait = pumpkin rings in profile): 14-17 mm locks, bulge halved, cap
# 6 mm, side / nape locks aim LOWER on the plait line so every lock behind the temple sweeps diagonally down-back
LOCKS = [(7, 35, 60, 0.044, 0.016, 0.006, 0.002, 0.35),
         (24, 35, 56, 0.048, 0.017, 0.007, -0.003, 0.40),
         (41, 33, 48, 0.046, 0.016, 0.007, 0.003, 0.45),
         (58, 29, 38, 0.050, 0.017, 0.006, -0.003, 0.50),
         (74, 16, 18, 0.048, 0.017, 0.005, 0.003, 0.50),      # v4: side / nape roots 5-6 deg lower so the lock
         (90, 3, 4, 0.050, 0.017, 0.004, -0.002, 0.55),       # masses cover the cap down to the ear line (fast
         (106, -5, -9, 0.046, 0.016, 0.004, 0.002, 0.55),     # build #2: a ribbed band of bare cap above the ear)
         (122, -12, -16, 0.044, 0.016, 0.003, -0.002, 0.55),
         (140, -17, -21, 0.042, 0.015, 0.003, 0.002, 0.55),
         (158, -22, -24, 0.038, 0.014, 0.002, 0.0, 0.50)]
LOCKS_UP = [(15, 50, 64, 0.042, 0.014, 0.004, 0.002, 0.40), (42, 48, 54, 0.042, 0.014, 0.004, -0.002, 0.45),
            (68, 42, 36, 0.040, 0.014, 0.003, 0.002, 0.50)]
UP_LIFT = 0.004
# C2 r3: the solid locks are the under-mass beneath alpha hair cards (seraphine_hair_cards.py)
UNDER = dict(thick=0.80, bulge=0.60, k_mass=0.0060)
CARD_CUTOFF = 0.4
CARD_SPECULAR = 0.06      # KHR_materials_specular on the card material (grazing Fresnel cap; fast build #2 = mirror flakes)
CARD_RIM_SCALE = 0.025     # r4: smooth scalp normals + restrained rim avoid pale isolated triangles at the temples
#                           grazing-angle cards pale tan at every silhouette; probe progress/tmp/c2r3/matvar3/panel_e.png)
# temple tendrils (head-frame points, right side; mirrored): width, thick
# v3: 25 mm further back (fast build #1: they hung across the eye in profile) -- beside the cheekbone / in front of the ear
# r7 (board r13 "stiff detached side-lock in front of the ear"): the root starts higher, under the hairline locks, and
# the strand group swings in a soft S (out over the cheekbone, in, out again at the tip) instead of a straight drop
TENDRILS = [([(0.063, -0.028, 0.034), (0.071, -0.036, 0.014), (0.079, -0.040, -0.006), (0.079, -0.037, -0.024),
              (0.083, -0.040, -0.044)], 0.010, 0.0062)]


def ear_clear(H):
    """Bare zones around the ears for the scalp cap (centred on the fitted base-mesh ears)."""
    _, lm = head_grid()
    return [Sphere(lm[k] + V(sx * 0.004, 0.0, 0.004), 0.026) for k, sx in (("ear_R", 1), ("ear_L", -1))]


def scalp_cap_for(S, snap, H, ears=None):
    gear.scalp_cap(S, snap, H, exclude=ears if ears is not None else ear_clear(H), **SCALP)


def _azel(d):
    return math.atan2(d[0], -d[1]), math.asin(max(-1.0, min(1.0, d[2])))


def _dir(az, el):
    return V(math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))


def _lock_path(S_body, hc, root_dir, g_dir, thick, bulge, bow, lift=0.0, n=20, peak=0.5):
    """One designed lock: arcs over the scalp from root_dir to g_dir (a point on the centre-back plait line),
    riding `lift` + a `bulge` above the cap that peaks at t=`peak` (volume at the crown/back), with a lateral S
    `bow`. Root buried in the cap, end tucked under the plait. Returns (path, normal hint)."""
    ts = np.linspace(0, 1, n)
    dirs = np.array([hair._slerp(root_dir, g_dir, t) for t in ts])
    rr = hair.scalp_radius(S_body, hc, dirs)
    pk = min(max(peak, 0.15), 0.85)
    bump = (ts / pk) ** (pk * 3.0) * ((1 - ts) / (1 - pk)) ** ((1 - pk) * 3.0)
    lf = thick * 0.30 + lift * (1 - ts ** 3) + bulge * bump
    P = hc + dirs * (rr + lf)[:, None]
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    Sd = np.cross(T, dirs)
    Sd /= np.maximum(np.linalg.norm(Sd, axis=1, keepdims=True), 1e-9)
    P = P + Sd * (bow * np.sin(math.pi * ts) + 0.7 * bow * np.sin(2 * math.pi * ts + 0.6))[:, None]
    P[0] = hc + dirs[0] * (rr[0] - thick * 0.10)
    P[-1] = hc + dirs[-1] * (rr[-1] + thick * 0.05)
    return P, V(dirs[1])


def _plait_strands(C, R, phase, Nb, Sd, tag):
    """Three strands twisted round centre line C (radius profile R, cumulative twist phase)."""
    out = []
    for i in range(3):
        ph = phase + 2 * math.pi * i / 3
        Q = C + Sd * (R * 0.60 * np.sin(ph))[:, None] + Nb * (R * 0.32 * np.sin(2 * ph))[:, None]
        out.append(dict(path=Q, width=float(np.mean(R) * 1.20), thick=float(np.mean(R) * 0.80), root_dir=V(0, 1, 0),
                        normal=V(np.mean(Nb, axis=0)), R=R, strands=True, tag=tag))
    return out


def hair_design(S_body, L, H, seed=17):
    """Returns (clumps_soft, clumps_braid, tie_points, braid_path_free, gather_centre). Soft = lock masses + temple
    tendrils + the braid-end tuft (one fused sculpt with tight blends); braid = the French plait on the scalp + the
    free plait (3 strands each)."""
    hc = H(0, 0.012, 0.0)
    s = H.s
    g_dir = _dir(GATHER["az"], GATHER["el"])
    tie_r = hair.scalp_radius(S_body, hc, g_dir[None])[0]
    tie = hc + g_dir * (tie_r + GATHER["off"])
    rng = np.random.RandomState(seed)
    locks = []
    card_locks, card_tendrils = [], []
    for layer, lift in ((LOCKS, 0.0),):
        for li, (az, el, elt, w, th, bulge, bow, pk) in enumerate(layer):
            sides = (1, -1) if az > 0 else (1,)
            for sx in sides:
                azr = math.radians(sx * az + rng.uniform(-2.0, 2.0))
                elr = math.radians(el + rng.uniform(-1.5, 1.5))
                # C2 r3: the solid locks are only the UNDER-MASS beneath the alpha hair cards -> thinner, lower
                wj, tj = w * rng.uniform(0.94, 1.06) * s, th * UNDER["thick"] * rng.uniform(0.94, 1.06) * s
                stag = 0.0004 * (li % 2)             # every other lock rides 1.5 mm higher = shingle steps
                g_dir_l = _dir(math.pi, math.radians(elt))
                P, nrm = _lock_path(S_body, hc, _dir(azr, elr), g_dir_l, tj, bulge * UNDER["bulge"] * s,
                                    sx * bow * s, lift=(lift + stag) * s, peak=pk)
                locks.append(dict(path=P, width=wj, thick=tj, root_dir=_dir(azr, elr), normal=nrm))
                card_locks.append(dict(root_dir=_dir(azr, elr), g_dir=g_dir_l, width=wj))
    # temple tendrils: loose round strands from the temple hairline down beside the cheek, hugging the skin
    for sx in (1, -1):
        for pts, w, th in TENDRILS:
            raw = np.array([H(sx * x, y, z) for x, y, z in pts])
            P, _ = anatomy.resample(raw, step=0.006)
            for _ in range(5):
                dd = S_body.dist(P) - th * 0.45
                bad = dd < 0
                if not bad.any():
                    break
                P[bad] -= S_body.grad(P[bad]) * dd[bad][:, None]
            P[0] = S_body.project(P[:1], offset=-0.003)[0]
            card_tendrils.append(P)          # C2 r3: tendrils are alpha cards resting on the cheek (not tubes)
    # ---- French plait centre line on the scalp: centre-back from the crown down to the gather
    els = np.linspace(FRENCH["el0"], GATHER["el"], 36)
    dirs = np.array([_dir(math.pi, e) for e in els])
    rr = hair.scalp_radius(S_body, hc, dirs)
    Cf = hc + dirs * (rr + FRENCH["r"] * FRENCH["clear"] * s + 0.003)[:, None]
    # ---- free braid centre line: from the tie back/down, then along the back with body collision
    P = [tie]
    v = norm(V(0, 0.55, -0.83))
    ds = 0.012
    n_steps = int(BRAID["length"] / ds)
    p = tie.copy()
    for k in range(n_steps):
        v = norm(v * 0.8 + V(0, 0, -1) * 0.2)
        p = p + v * ds
        f = k / n_steps
        cl = BRAID["clear"] * (1 - 0.4 * f) * min(1.0, 0.35 + k / 8.0)
        for _ in range(3):
            dd = S_body.dist(p[None])[0] - cl
            if dd >= 0:
                break
            g = S_body.grad(p[None])[0]
            p = p - g * dd
            v = norm(v - g * min(float(np.dot(v, g)), 0.0))
        P.append(p.copy())
    C_free = np.array(P)
    C, _ = anatomy.resample(np.concatenate([Cf, C_free[1:]]), step=0.004)
    Tn = np.gradient(C, axis=0)
    Tn /= np.linalg.norm(Tn, axis=1, keepdims=True)
    Nb = S_body.grad(C)
    Nb = Nb - Tn * np.sum(Nb * Tn, axis=1, keepdims=True)
    Nb /= np.maximum(np.linalg.norm(Nb, axis=1, keepdims=True), 1e-9)
    Sd = np.cross(Tn, Nb)
    sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    Lf = float(np.sum(np.linalg.norm(np.diff(Cf, axis=0), axis=1)))          # scalp part length
    j_tie = int(np.searchsorted(sl, Lf))
    free = sl >= Lf
    f = np.clip((sl - Lf) / (sl[-1] - Lf), 0, 1)
    R = np.where(free, BRAID["r0"] + (BRAID["r1"] - BRAID["r0"]) * f ** 0.8, FRENCH["r"] * s)
    R = R * (1 - 0.22 * np.exp(-((sl - Lf) / 0.025) ** 2))                     # pinched under the leather wrap
    period = np.where(free, BRAID["period"], FRENCH["period"])
    phase = np.concatenate([[0], np.cumsum(2 * math.pi * np.diff(sl) / period[1:])])
    end_f = 0.88
    m_end = f <= end_f
    braid = _plait_strands(C[~free], R[~free], phase[~free], Nb[~free], Sd[~free], "french")
    mf = free & m_end
    braid += _plait_strands(C[mf], R[mf], phase[mf], Nb[mf], Sd[mf], "free")
    j0 = int(np.nonzero(mf)[0][-1])
    base, tb, nb_, sb = C[j0], Tn[j0], Nb[j0], Sd[j0]
    rng = np.random.RandomState(seed + 3)
    tuft = []
    for i in range(7):
        a = i / 7 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        off = (sb * math.cos(a) + nb_ * math.sin(a)) * R[j0] * 0.5
        spread = (sb * math.cos(a) + nb_ * math.sin(a)) * rng.uniform(0.012, 0.024)
        L_t = rng.uniform(0.075, 0.11)
        pts = np.array([base + off + tb * L_t * u + spread * u ** 1.4 + V(0, 0, -0.01) * u ** 2
                        for u in np.linspace(0, 1, 8)])
        tuft.append(dict(path=pts, width=R[j0] * 0.9, thick=R[j0] * 0.55, root_dir=tb, normal=nb_, strands=False))
    jt = min(j_tie + 3, len(C) - 1)
    jt2 = min(j_tie + 8, len(C) - 1)
    ties = dict(top=(C[jt], Tn[jt], R[jt]), top2=(C[jt2], Tn[jt2], R[jt2] * 0.97), bottom=(C[j0], Tn[j0], R[j0]))
    cards_src = dict(locks=card_locks, tendrils=card_tendrils, g_dir=g_dir, hc=hc, s=s)
    return locks + tuft, braid, ties, C[free], tie + g_dir * 0.004, cards_src


class StrandChain(Prim):
    """A lock tube (Chain) with shallow strand grooves running ALONG it (amp 0.45 mm, period 5 mm across the width)
    for the hi bake source: the normal map carries strand-direction detail without the r1 sub-strand lumps."""

    def __init__(self, chain, P, Sd, width, amp=0.00045, period=0.005, seed=0):
        self.c, self.P, self.Sd, self.W = chain, np.asarray(P, float), np.asarray(Sd, float), np.asarray(width, float)
        self.amp, self.period = float(amp), float(period)
        self.lo, self.hi = chain.lo - amp, chain.hi + amp
        self.ph = np.random.RandomState(seed).uniform(0, 2 * math.pi)

    def d(self, X, Y, Z):
        d = self.c.d(X, Y, Z)
        X, Y, Z, d = np.broadcast_arrays(X, Y, Z, d)
        near = np.abs(d) < 0.005
        if not near.any():
            return d
        out = np.array(d, float, copy=True)
        Q = np.stack([X[near], Y[near], Z[near]], 1)
        add = np.empty(len(Q))
        for a in range(0, len(Q), 40000):
            q = Q[a:a + 40000]
            d2 = (q ** 2).sum(1)[:, None] - 2 * q @ self.P.T + (self.P ** 2).sum(1)[None, :]
            j = np.argmin(d2, axis=1)
            lat = np.einsum("ij,ij->i", q - self.P[j], self.Sd[j])
            u = lat / np.maximum(self.W[j] * 0.5, 1e-4)
            g = 0.5 - 0.5 * np.cos(2 * math.pi * lat / self.period + self.ph + 0.9 * np.sin(j * 0.37))
            add[a:a + 40000] = self.amp * g * np.clip(1.3 - np.abs(u), 0, 1)
        out[near] = d[near] + add
        return out


def lock_sculpt(clumps, detail="hi", nseg=56, k_mass=0.0010, root_thick=0.45, root_frac=0.10, tip_frac=0.30,
                tip_r=0.0012, grooves=True, seed=5):
    """Seraphine's lock masses as ONE SDF volume (same meta contract as lib clump_sculpt / path_attrs): every lock
    is a dense hard-min Chain (no joint rings), smooth single tube in 'lo'; in 'hi' a StrandChain adds strand
    grooves. clumps with strands=False (tendrils, tuft) stay plain tubes."""
    S = Sculpt(materials=list(HAIR_MATS), default_mat="mane")
    meta = []
    for ci, c in enumerate(clumps):
        P = hair.resample_path(c["path"], nseg)
        T, Sd = hair._side_vectors(P, c["normal"])
        w, t = float(c["width"]), float(c["thick"])
        thick = np.maximum(hair.taper_profile(nseg, t * root_thick, t, tip_frac=tip_frac, root_frac=root_frac), tip_r * 2)
        width = np.maximum(hair.taper_profile(nseg, w * 0.8, w, tip_frac=tip_frac * 0.9, root_frac=root_frac), tip_r * 2)
        ref = Sd[len(P) // 3]
        h = max(2, nseg // 2)
        sq = float(np.clip(np.mean(width[:h] / thick[:h]), 1.0, 4.0))
        r = np.maximum(thick * 0.5, tip_r)
        prim = Chain(list(P), list(r), squash=(sq, 1.0), ref=tuple(ref), k=0.0, margin=0.02)
        if detail == "hi" and grooves and c.get("strands", True):
            prim = StrandChain(prim, P, Sd, width, seed=seed + ci)
        S.add(prim, k_mass)
        meta.append(dict(path=P, side=Sd, tangent=T, width=w, thick=t, id=ci))
    return S, meta


def _torus_frame(t):
    b = basis(t)
    return np.stack([b[:, 1], b[:, 2], b[:, 0]], axis=1)


def hair_sculpts(S_body, L, H, seed=17):
    soft, braid, ties, C, gather_c, cards_src = hair_design(S_body, L, H, seed)
    out = {}
    ring_cache = {}
    for detail in ("lo", "hi"):
        # C2 r3: the lock masses are a SOFT under-mass (k_mass 4 mm, no strand grooves) under the alpha hair cards;
        # gaps between cards read as its shadow, never as a seam
        Ss, meta_s = lock_sculpt(soft, detail=detail, seed=seed, k_mass=UNDER["k_mass"], grooves=False)
        # r5: braid and wraps are explicit strand-UV geometry in the hair material.
        # Baking a decimated body-material plait caused pale seams and coarse lobes.
        meta_b = []
        circlet(Ss, S_body, H, ring_cache)
        out[detail] = (Ss, meta_s + meta_b)
    S_lo = out["lo"][0]
    cards_src["medallion"] = ring_cache.get("medallion")
    cards_src["braid"] = braid
    cards_src["ties"] = ties
    cards = design_hair_cards(S_body, S_lo, cards_src, seed)
    return out["hi"][0], S_lo, out["hi"][1], C, len(soft), cards


def design_hair_cards(S_body, S_under, src, seed=17):
    """Continuous swept scalp, sparse edge wisps and the existing explicit braid/circlet."""
    import seraphine_hair_cards as HCARDS
    importlib.reload(HCARDS)

    # r8: scalp geometry and fibre UVs share a continuous hairline-to-plait fan.
    # The previous tiered under-mass remains a hidden bake support for the tail only.
    from seraphine_scalp_flow import scalp_flow, edge_wisps, layered_locks, temple_locks, crown_sweep
    cards = scalp_flow(S_body.dist, src["hc"], s=src["s"])
    cards.extend(layered_locks(cards[:2], s=src["s"]))
    cards.extend(crown_sweep(S_body.dist, src['hc'], s=src['s']))
    cards.extend(temple_locks(S_body.dist, src["hc"], s=src["s"]))
    cards.extend(edge_wisps(cards[:2], src["tendrils"], S_body.dist, S_body.grad, s=src["s"]))
    cards.extend(HCARDS.braid_geometry(src["braid"], src["ties"]))
    band=HCARDS.band_geom(S_body.dist, src["medallion"], s=src["s"], groom=cards)
    cards.append(band)
    cards.append(HCARDS.medallion_geom(S_body.dist, S_body.grad, src["medallion"], s=src["s"], mount=band))
    return cards


def circlet(S, S_body, H, ring_cache):
    """Cache the circlet frame on the hair. Band and rayed disc are explicit geometry in the card mesh."""
    hc = H(0, 0.012, 0.0)
    n = 96
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    dirs = []
    for a in ang:
        el = math.radians(32 - 14 * (1 - math.cos(a)) / 2 - 4 * math.sin(a) ** 2)   # mid-forehead, temples dip, back low
        dirs.append(_dir(a, el))
    dirs = np.array(dirs)
    if ring_cache.get("ring") is None:
        def inside(t):
            Pq = hc + dirs * t[:, None]
            return np.minimum(S_body.dist(Pq), S.dist(Pq)) <= 0
        hi_t = np.full(n, 0.2)
        lo_t = np.full(n, 0.2)
        found = np.zeros(n, bool)
        for tt in np.arange(0.2, 0.03, -0.005):
            ins = inside(np.full(n, tt))
            newly = ins & ~found
            lo_t[newly] = tt
            hi_t[newly] = tt + 0.005
            found |= ins
            if found.all():
                break
        for _ in range(8):
            mid = (lo_t + hi_t) / 2
            ins = inside(mid)
            lo_t = np.where(ins, mid, lo_t)
            hi_t = np.where(ins, hi_t, mid)
        ring_cache["ring"] = hc + dirs * (lo_t + 0.0014)[:, None]
    ring = ring_cache["ring"]
    ring = np.concatenate([ring, ring[:1]])
    # r4: explicit band in the card mesh, rather than a decimated SDF wire.
    f = ring[0]
    fn = norm(f - hc)
    up = norm(V(0, 0, 1) - fn * fn[2])
    side = np.cross(fn, up)
    # C2 r3 (board r9: "a wire with a bead"): the rayed sun-disc medallion. r13 resume: the SDF disc / rays / dome
    # (0.6-3 mm proud) did not survive the 2.4 mm polygonisation + decimation of hair_lo (fast builds #2/#3 showed only
    # the dome = still "a bead"), so the medallion is now REAL GEOMETRY in the hair-card mesh (seraphine_hair_cards
    # .medallion_geom: flat hammered disc + 16 rays, metallic gold patch in the card atlas). Only its frame is kept here.
    ring_cache["medallion"] = dict(f=f, fn=fn, up=up, side=side, hc=hc, ring=ring[:-1])




def hair_attrs(ob, meta, uv=False):
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
#   fair warm skin ~52%  >  auburn/copper hair ~30%  >  teal scale armour ~24%  ~  crimson sash ~22% (hue split:
#   cyan-green vs red, and never neighbours except at the sash edge, where a near-black leather rim separates them)
#   >  near-black-brown leather leggings / straps / boots ~10-14%.  Bronze/gold = bright warm metal accents.
PAL = dict(
    skin=shaders.srgb(226, 152, 112), skin_warm=shaders.srgb(222, 112, 92), skin_cool=shaders.srgb(150, 110, 100),
    lips=shaders.srgb(150, 62, 60), scar=shaders.srgb(230, 170, 150), skin_rough=0.58,
    tattoo=shaders.srgb(156, 47, 27),
    iris=shaders.srgb(150, 94, 38), sclera=shaders.srgb(232, 226, 218),   # C2 r2: amber-brown iris (reference), not green
    hair=shaders.srgb(130, 40, 10), hair_tip=shaders.srgb(188, 86, 30), hair_hi=shaders.srgb(240, 160, 90),
    card=shaders.srgb(126, 40, 9), card_hi=shaders.srgb(232, 138, 66), card_dark=shaders.srgb(52, 14, 4),   # C2 r3 hair cards
    hair_sheen=0.22, hair_rough=0.7, hair_hi_amt=0.1,
    brow=shaders.srgb(86, 30, 16), brow_hi=shaders.srgb(120, 50, 30), brow_hi_amt=0.05, brow_rough=0.85,
    leather=shaders.srgb(62, 38, 24), leather_worn=shaders.srgb(104, 70, 48),
    leather_dark=shaders.srgb(26, 20, 18), leather_dark_worn=shaders.srgb(58, 46, 40),
    scale=shaders.srgb(36, 96, 88), scale_rim=shaders.srgb(196, 150, 80), scale_deep=shaders.srgb(12, 34, 34),
    armor=shaders.srgb(52, 120, 110), armor_patina=shaders.srgb(28, 70, 66), armor_patina_amt=0.35,
    bronze=shaders.srgb(232, 176, 82), bronze_patina=shaders.srgb(70, 136, 112), bronze_patina_amt=0.35,
    cloth=shaders.srgb(150, 16, 28), sole=shaders.srgb(30, 22, 18),
    gem=shaders.srgb(170, 16, 24),
)


def p_scale(c, pal):
    """Scale armour: per-scale value/hue jitter, bright bronze-edged lip, deep shade tucked under the row above."""
    P = c.P
    h, cid, t, xs = scale_pattern(P[:, 0], P[:, 1], P[:, 2])
    rnd = np.sin(cid * 12.9898 + 78.233) * 43758.5453
    rnd = rnd - np.floor(rnd)
    base = pal["scale"]
    rgb = np.tile(base, (c.n, 1)) * (0.82 + 0.34 * rnd)[:, None]
    n1 = c.noise(30.0, 2, 81)
    rgb *= (1.0 + 0.08 * n1)[:, None]
    lip = shaders.smooth01(0.16 - t, 0.0, 0.1)
    rgb = shaders.mix(rgb, pal["scale_rim"], 0.72 * lip)
    rgb = shaders.mix(rgb, pal["scale_deep"], 0.7 * shaders.smooth01(t, 0.55, 1.0))
    rgb = shaders.mix(rgb, np.minimum(base * 1.6, 1), 0.22 * shaders.smooth01(1 - np.abs(xs), 0.6, 1.0) * (1 - t))
    rgb = shaders.mix(rgb, rgb * 0.5, 0.6 * c.cav)
    metal = 0.55 * lip
    rough = 0.46 + 0.1 * rnd - 0.14 * lip + 0.2 * t
    return shaders.out(c.n, rgb, np.clip(rough, 0.2, 0.9), metal)


def p_armor(c, pal):
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "armor")
    metal = metal * 0.55             # enamelled / lacquered, not raw metal (reads teal, not black, in a dark arena)
    return rgb, np.clip(rough + 0.1, 0.2, 0.9), metal, emit


def p_gem(c, pal):
    rgb = np.tile(pal["gem"], (c.n, 1))
    rgb = shaders.mix(rgb, shaders.srgb(255, 120, 90), 0.5 * c.ridge)
    return shaders.out(c.n, rgb, 0.12, 0.0, 0.25)


CROWN_Z = None      # head-base z (L["head"]), set by body_sculpt (crown mask in p_hair)


def p_hair(c, pal):
    """C2 r1 lock-mass hair paint: per-lock value AND roughness variation, low-amplitude strand streaks that run
    along each lock (continuous across a lock, never per-vertex dots), a moderately narrow Kajiya-Kay sheen broken
    by the streaks, shaded roots / lock edges / valleys -- a matte-satin auburn mass, not a uniform gloss."""
    along, lid, lat = c.attr("along"), c.attr("lock_id"), c.attr("lateral")
    F = np.stack([c.attr("flow_x"), c.attr("flow_y"), c.attr("flow_z", 1.0)], axis=1)
    F /= np.maximum(np.linalg.norm(F, axis=1, keepdims=True), 1e-9)
    rnd = np.sin(lid * 12.9898 + 78.233) * 43758.5453
    rnd = rnd - np.floor(rnd)
    rnd2 = np.sin(lid * 7.131 + 11.7) * 2971.33
    rnd2 = rnd2 - np.floor(rnd2)
    rgb = shaders.mix(np.tile(pal["hair"], (c.n, 1)), pal["hair_tip"], shaders.smooth01(along, 0.35, 1.0) * 0.45)
    rgb *= (0.92 + 0.16 * rnd)[:, None]
    rgb *= (1.0 + 0.05 * c.noise(6.0, 2, 41))[:, None]           # slow value drift across the mass
    streak = 0.5 + 0.5 * np.sin(lat * 5.5 * math.pi + rnd * 6.0 + 2.5 * c.noise(40.0, 2, 43))
    rgb *= (0.93 + 0.10 * streak)[:, None]
    Ld = norm(V(0.30, -0.55, 0.78))
    Hh = norm(Ld + norm(V(0.0, -1.0, 0.25)))
    th = F @ Hh
    kk = np.sqrt(np.clip(1 - th * th, 0, 1)) ** 34
    lit = np.clip(c.N @ Ld + 0.25, 0, 1)
    rgb = shaders.mix(rgb, pal["hair_hi"], np.clip(0.40 * kk * lit * (0.6 + 0.4 * streak), 0, 1))
    rgb *= (1 - 0.18 * shaders.smooth01(np.abs(lat), 0.6, 1.0))[:, None]   # lock edges tuck into shade
    rgb *= (0.78 + 0.22 * shaders.smooth01(along, 0.0, 0.12))[:, None]     # roots shaded
    rgb = shaders.mix(rgb, rgb * 0.65, c.cav * 0.6)                          # valleys between locks
    rough = 0.62 + 0.10 * (rnd2 - 0.5) + 0.06 * (1 - streak) + 0.05 * along
    n_lock = float(c.x.get("n_lock", 0))
    if n_lock > 0:          # C2 r3: ids below n_lock = the solid under-mass beneath the hair cards -> dark, matte
        um = (lid < n_lock - 0.5).astype(float)
        rgb = shaders.mix(rgb, rgb * 0.42, um)          # r13: 0.52 -> 0.42
        rough = rough + (0.96 - rough) * um             # r13: +0.12 (-> ~0.74) left a broad cool grazing-angle Fresnel
        #                                                 sheen on the smooth dome at the crown silhouette (the pale
        #                                                 lavender "cards" of fast build #3 were the under-mass)
    return shaders.out(c.n, np.clip(rgb, 0, 1), np.clip(rough, 0.45, 0.97))




def p_eye(c, pal):
    """Amber iris with a compact painted catchlight that survives the stage mip."""
    rgb, rough, metal, emit = shaders.p_eye(c, pal)
    centres = np.asarray(c.x['eyes'])
    nearest = np.argmin(np.linalg.norm(c.P[:, None] - centres[None], axis=2), axis=1)
    D = c.P - centres[nearest]
    D /= np.maximum(np.linalg.norm(D, axis=1, keepdims=True), 1e-9)
    key = norm(V(-.24, -1, .30))
    sparkle = np.exp(-np.sum((D-key)**2, axis=1)/.012)
    rgb = shaders.mix(rgb, shaders.srgb(255, 246, 220), .94*sparkle)
    return rgb, rough, metal, emit


def p_skin(c, pal):
    """lib p_skin + a dark lash line (clear eyes at gameplay distance) and a dry-brushed war-paint stripe."""
    # Local face palette: broad cheek/jaw curvature must not paint a bruised patch.
    face = shaders.smooth01(c.P[:,2], 1.34, 1.49) * (1-shaders.smooth01(c.P[:,1], .005, .045))
    c = shaders.Ctx(c.P,c.N,c.cf*(1-.96*face),c.cb*(1-.97*face),c.paints,c.attrs,c.L,c.x)
    rgb, rough, metal, emit = shaders.p_skin(c, pal)
    # r7 (board r13 "harsh throat shadow fusing jaw to chest"): a warm albedo lift on the down-facing skin under the
    # jaw (stylized fill), so the key-light shadow there reads as a soft form shadow, not a dark band
    jaw = (shaders.smooth01(c.P[:, 2], 1.500, 1.515) * (1 - shaders.smooth01(c.P[:, 2], 1.545, 1.560)) *
           (1 - shaders.smooth01(np.abs(c.P[:, 0]), 0.045, 0.065)) * (1 - shaders.smooth01(c.P[:, 1], -0.01, 0.02)) *
           shaders.smooth01(-c.N[:, 2], 0.05, 0.45))
    if jaw.any():
        rgb = shaders.mix(rgb, np.minimum(rgb * np.array([1.22, 1.16, 1.10]), 1.0), jaw)
    tat = c.paint("tattoo")
    if tat.any():    # C2: the stripe is dry-brushed -- horizontal streaks of thinner paint, worn at the edges
        saved = c.paints.get("tattoo")
        c.paints["tattoo"] = np.zeros(c.n)
        rgb0, _, _, _ = shaders.p_skin(c, pal)
        c.paints["tattoo"] = saved
        streak = 0.5 + 0.5 * np.sin(c.P[:, 2] * 2600.0 + 3.0 * c.noise(180.0, 2, 31) + 500.0 * c.P[:, 0])
        worn = shaders.smooth01(c.noise(140.0, 2, 33), -0.35, 0.45)
        rgb = shaders.mix(rgb0, pal["tattoo"], np.clip(tat*(.84+.16*streak)*(.84+.16*worn),0,1))
        rough = rough + 0.12 * tat
    bp = c.paint("browpaint")
    if bp.any():     # r2: fine hair strokes over the lib's 7 mm zebra stripes
        fine = 0.5 + 0.5 * np.sin(c.P[:, 0] * 5200.0 + 900.0 * c.P[:, 2] + 2.0 * c.noise(400.0, 2, 21))
        rgb = shaders.mix(rgb, pal.get("brow", shaders.srgb(70, 30, 20)), np.clip(bp * (0.8 + 0.15 * fine), 0, 0.95))
    lash = c.paint("lash")
    if lash.any():
        rgb = shaders.mix(rgb, shaders.srgb(22, 12, 10), np.clip(lash * 1.2, 0, 0.95))
    lips = c.paint("lips")
    if lips.any():       # r6: satin, not glossy (the lib's -0.14 roughness lit the lips as a pale band); a clear
        rough = rough + 0.10 * lips     # muted-rose vermilion (fast2: the lib's 0.75 mix read as bare skin in-game)
        # r7: .55 -> .62 (the lower lip still read as bare pale skin next to the shaded upper lip in fast1)
        rgb = shaders.mix(rgb, pal["lips"], np.clip(0.62 * lips, 0, 0.62))
    ml = c.paint("mouthline")
    if ml.any():         # r6: closed mouth line, deep warm red-brown (stays in the skin/lip colour range)
        # r9: fade the last few millimetres into the lips; the old dense corner
        # mask read as a dark smudge under the showcase's side light.
        ml = ml * (1 - 0.75 * shaders.smooth01(np.abs(c.P[:, 0]), 0.012, 0.022))
        rgb = shaders.mix(rgb, shaders.srgb(96, 40, 36), np.clip(ml * 0.65, 0, 0.65))   # r7: .75 -> .65
    return rgb, rough, metal, emit


def p_leather_dark(c, pal):
    """lib leather_dark + r7 leggings (z 0.47-0.98 = thighs only; straps / cuffs elsewhere unchanged): a dark
    oxblood-brown quilted leather lifted off the ground value, diamond stitch lines (gambeson quilting)."""
    rgb, rough, metal, emit = shaders.p_leather(c, pal, "leather_dark")
    z = c.P[:, 2]
    leg = shaders.smooth01(z, 0.47, 0.51) * (1 - shaders.smooth01(z, 0.95, 0.99)) * (np.abs(c.P[:, 0]) > 0.012)
    if leg.any():
        sx = np.sign(c.P[:, 0])
        hx = np.where(sx > 0, c.L["hip_L"][0], c.L["hip_R"][0])
        kx = np.where(sx > 0, c.L["knee_L"][0], c.L["knee_R"][0])
        f = np.clip((z - c.L["knee_L"][2]) / max(c.L["hip_L"][2] - c.L["knee_L"][2], 1e-3), 0, 1)
        cx = kx + (hx - kx) * f
        cy = c.L["knee_L"][1] + (c.L["hip_L"][1] - c.L["knee_L"][1]) * f
        arc = np.arctan2(c.P[:, 1] - cy, (c.P[:, 0] - cx) * sx) * 0.068
        per = 0.036
        g1 = ((arc + z) / per) % 1.0
        g2 = ((arc - z) / per) % 1.0
        w1 = 1 - 2 * np.minimum(g1, 1 - g1)
        w2 = 1 - 2 * np.minimum(g2, 1 - g2)
        seam = np.maximum(shaders.smooth01(w1, 0.84, 0.96), shaders.smooth01(w2, 0.84, 0.96))
        puff = (1 - np.maximum(w1, w2)) ** 1.5           # quilted panel centres a touch lighter
        base = shaders.srgb(83, 63, 53) * (0.90 + 0.22 * puff)[:, None] * (1.0 + 0.08 * c.noise(40.0, 2, 41))[:, None]
        base = shaders.mix(base, shaders.srgb(43, 31, 24), 0.48 * seam)
        rgb = shaders.mix(rgb, base, leg)
        rough = rough + leg * (0.08 - 0.05 * puff)
    return rgb, rough, metal, emit


def p_scalp(c, pal):
    # The scalp cap is on the BODY ('hair'), not the lock mesh ('mane'). The old
    # under-mass treatment never reached it and its painted sheen read as bare skin.
    rgb = np.tile(shaders.srgb(104, 36, 12), (c.n, 1))    # r6: 64,23,10 -> hair-in-shadow (gaps read as black slits)
    #                                                       r7: 92,32,12 -> the cards' backing colour
    rgb *= (0.92 + 0.08 * c.noise(50.0, 2, 17))[:, None]
    return shaders.out(c.n, rgb, 1.0)


PAINTERS = {"skin": p_skin, "scale": p_scale, "armor": p_armor, "gem": p_gem, "mane": p_hair, "hair": p_scalp,
            "leather_dark": p_leather_dark, "eye": p_eye}


# ============================================================================ previews
MAT_COLORS = {"skin": (0.72, 0.5, 0.38), "eye": (0.9, 0.9, 0.88), "nail": (0.75, 0.55, 0.5), "brow": (0.3, 0.1, 0.05),
              "hair": (0.4, 0.12, 0.05), "mane": (0.4, 0.12, 0.05), "leather": (0.3, 0.18, 0.1),
              "leather_dark": (0.1, 0.08, 0.07), "scale": (0.12, 0.35, 0.32), "armor": (0.2, 0.45, 0.4),
              "bronze": (0.85, 0.62, 0.25), "cloth": (0.55, 0.05, 0.08), "sole": (0.1, 0.07, 0.05),
              "gem": (0.7, 0.05, 0.08)}


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
    L = rig.landmarks(SERA)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    if args.preview in ("body", "full"):
        S, info = body_sculpt(L, gear_on=(args.preview == "full"))
        mesh_sculpt(S, "body", args.h or 0.004)
        if args.preview == "full":
            for s in ("L", "R"):
                Sh, _ = hand_sculpt(L, s)
                w = L["wrist_" + s]
                mesh_sculpt(Sh, "hand_" + s, 0.0014, w - 0.16, w + 0.16)
            Sk, _ = kilt_parts(L)
            mesh_sculpt(Sk, "kilt", 0.003)
            _, S_lo, _, _, _, _ = hair_sculpts(S, L, info["head"]["H"])
            mesh_sculpt(S_lo, "hair", 0.0022)
        views = [dict(target=(0, 0, 0.9), ortho=2.0, yaw=y, dist=6) for y in (0, 35, 90, 180)]
        preview.render_views(os.path.join(out, args.preview + ".png"), views, res=(620, 1000))
        if args.preview == "full":
            views = [dict(target=(0, -0.02, 1.45), ortho=0.8, yaw=y, dist=4, pitch=4) for y in (0, 35, 150)]
            preview.render_views(os.path.join(out, "full_upper.png"), views, res=(800, 800))
    elif args.preview in ("face", "hair"):
        S, info = body_sculpt(L, gear_on=False, parts=("torso", "head"))
        H = info["head"]["H"]
        scalp_cap_for(S, S.snapshot(), H)
        if args.preview == "face":
            mesh_sculpt(S, "head", args.h or 0.0008, V(-0.13, -0.15, 1.50), V(0.13, 0.15, 1.78))
            views = [dict(target=(0, -0.02, 1.655), ordo=None, ortho=0.27, yaw=y, dist=3, pitch=2) for y in (0, 30, 90)]
            for v_ in views:
                v_.pop("ordo")
            preview.render_views(os.path.join(out, "face.png"), views, res=(800, 900))
        else:
            mesh_sculpt(S, "head", args.h or 0.0016, V(-0.25, -0.2, 1.0), V(0.25, 0.25, 1.8))
            _, S_lo, _, _, _, _ = hair_sculpts(S, L, H)
            mesh_sculpt(S_lo, "hair", args.h or 0.0016)
            views = [dict(target=(0, 0.0, 1.45), ortho=0.75, yaw=y, dist=4, pitch=4) for y in (0, 40, 110, 180)]
            preview.render_views(os.path.join(out, "hair.png"), views, res=(640, 800))
    print(f"[seraphine] preview {args.preview} done in {time.time()-t0:.1f}s")


# ============================================================================ rig helpers
def crotch_mask(P):
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.02)) / 0.09, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.2)


def kilt_angular_blend(P, names, W):
    """Share each level's chain weight between the two nearest kilt chains (cosine partition) so neighbouring
    spring chains cannot tear the tassets (Brann r2 lesson). The sash tails sit at ~60-85 deg = the L chain."""
    k = KILT_P
    theta = np.arctan2(P[:, 0], -(P[:, 1] - 0.016) / k["squash"])
    sides = (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2))
    part = np.stack([np.maximum(np.cos(theta - a), 0.0) ** 1.6 for _, a in sides], axis=1)
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
        hem = (k["hem_z"] + 0.02) if side != "L" else (TAIL_Z[0] + 0.03)
        pts = []
        for i in range(n + 1):
            f = i / n
            z = (k["top_z"] - 0.03) + (hem - (k["top_z"] - 0.03)) * f
            r = k["r_top"] + (k["r_hem"] - k["r_top"]) * min(f * 0.9, 1.0)
            if side == "L":
                r = k["r_top"] + 0.02 + 0.06 * f
            pts.append(V(math.sin(a) * r, 0.016 - math.cos(a) * r * k["squash"], z))
        out[side] = pts
    return out


# r8: groom edits must not move the existing spring-chain bind pose. These are
# the r14 design's six rest points, retained independently of the scalp envelope.
HAIR_REST_POINTS = [[1.0662391998977452e-17, 0.11809873521110864, 1.6115696990317792], [1.0706239885348336e-17, 0.14278626134254016, 1.5025905920432079], [1.0706239885348336e-17, 0.16465722022376905, 1.3926664138182874], [1.0706239885348336e-17, 0.17660953210789726, 1.2809658174116323], [1.0706239885348336e-17, 0.17808220941030647, 1.1684164657432896], [1.0706239885348336e-17, 0.17826397457505344, 1.0558543891000371]]


def hair_chain_points(C, n=HAIR_CHAIN):
    if n == HAIR_CHAIN:
        return [V(p) for p in HAIR_REST_POINTS]
    sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    ts = np.linspace(0.02, 0.97, n + 1) * sl[-1]
    return [V(np.array([np.interp(t, sl, C[:, a]) for a in range(3)])) for t in ts]


def head_mask(L, H):
    a = H(0, -0.09, -0.142)
    b = H(0, 0.10, -0.085)
    nrm = norm(np.cross(V(1, 0, 0), b - a))
    if nrm[2] < 0:
        nrm = -nrm
    c = (a + b) * 0.5

    def fn(P):
        s = (P - c) @ nrm
        return np.clip((s + 0.004) / 0.02, 0, 1) * (np.linalg.norm(P - H(0, 0, 0), axis=1) < 0.24 * H.s)
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
            axis, ref, dens, halves = (V(0, 0.01, h[2]), V(0, 0.01, t[2])), V(1, 0, 0), 1.9, True
        elif nm.startswith(("upperarm", "forearm")):
            a = math.radians(40)
            ref = V(-sx * math.sin(a), 0.15, -math.cos(a))
        elif nm.startswith(("thigh", "shin")):
            ref = V(-sx, 0.35, 0)
        elif nm.startswith(("foot", "toe")):
            ref = V(0, 0, -1)
        cfg[i] = dict(axis=axis, ref=ref, density=dens, halves=halves)
    return cfg


def skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, hair_lo, n_soft):
    Pb = meshutil.get_verts(body_lo)
    _, vm, _ = S.eval_points(Pb)
    metal_ids = [S.materials.index(m) for m in ("bronze",) if m in S.materials]
    rigid = skin.rigid_components(body_lo, np.isin(vm, metal_ids))
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(body_lo, arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(head_mask(L, H), "head"), (crotch_mask, "hips")] +
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
        return skin.skirt_weights(P, names, W, top, KILT_P["hem_z"], share=0.5, seam=0.12)
    skin.skin(kilt_lo, arm, method="sdf", allowed=kilt_bones, power=3.0, post=kilt_post,
              overrides=[(lambda P: np.clip((P[:, 2] - (top - 0.06)) / 0.05, 0, 1), "hips")])
    hair_bones = ["head"] + [b.name for b in arm.data.bones if b.name.startswith("hair_")]
    nv = len(hair_lo.data.vertices)
    lid = np.empty(nv, np.float32)
    hair_lo.data.attributes["lock_id"].data.foreach_get("value", lid)
    tie_z = arm.data.bones["hair_1"].head_local[2]
    hb = arm.data.bones["hair_1"]
    tie = np.array(hb.head_local)

    def rigid_head(P, lid=lid):
        soft_cap = (lid < n_soft - 7).astype(float)                 # cap + face locks (not the tuft)
        near_tie = np.clip(1.0 - np.linalg.norm(P - tie, axis=1) / 0.035, 0, 1)
        above = np.clip((P[:, 2] - (tie_z + 0.004)) / 0.02, 0, 1)          # r2: the French plait rides the scalp
        return np.clip(np.maximum(np.maximum(soft_cap, near_tie), above), 0, 1)

    def hair_post(P, names, W):
        # the braid follows the chain only: no stray head weight far down the braid
        return W
    skin.skin(hair_lo, arm, method="sdf", allowed=hair_bones, power=3.0, overrides=[(rigid_head, "head")],
              post=hair_post)
    return body_W


# ============================================================================ build
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
    tri, quad = lt == 3, lt == 4          # (HI meshes are quads: fan them)
    T = lv[np.concatenate([np.stack([ls, ls + 1, ls + 2], 1)[tri | quad],
                           np.stack([ls, ls + 2, ls + 3], 1)[quad]])]
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
    """Delete loose mesh islands smaller than min_verts (scaled to the polygonize step h vs 3.6 mm): single-cell
    specks / internal bubbles that smooth-max cut corners leave behind (r2 QA: 'no floating geometry')."""
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


def dancer_points(P):
    """r18 fitted silhouette, applied to the finished surface AND all rest joints.

    Keeping the sculpt/bake in its original frame preserves costume registration.
    The monotone height map lengthens legs 4 cm, shortens the torso slightly and
    enlarges the head 4%; boots stay flat and hand sockets move with the fists.
    """
    P = np.asarray(P, float)
    Q = P.copy(); z = P[:, 2]
    leg = (shaders.smooth01(z, .10, .23)*(1-shaders.smooth01(z, .86, 1.02)) *
           (1-shaders.smooth01(np.abs(P[:,0]), .25, .38)))
    axis = np.tanh(P[:, 0]/.025)*(.096 + (.088-.096)*np.clip((z-.49)/.415, 0, 1))
    Q[:, 0] = axis+(P[:, 0]-axis)*(1-.12*leg)
    Q[:, 1] *= 1-.10*leg
    shoulder = shaders.smooth01(z, 1.12, 1.40)*(1-shaders.smooth01(z, 1.50, 1.56))
    Q[:, 0] *= 1-.055*shoulder
    head = shaders.smooth01(z, 1.51, 1.57)
    Q[:, 0] *= 1+.04*head
    Q[:, 1] = .015+(Q[:, 1]-.015)*(1+.04*head)
    Q[:, 2] = np.interp(z, [0,.08,.49,.905,1.03,1.438,1.552,1.80],
                            [0,.08,.513,.945,1.067,1.458,1.572,1.830])
    return Q


def face_normal_wrap(ob, skin_mask):
    """Authored heroine normals: soften the side plane and downward nose base.

    GPU term isolation shows clean albedo and continuous welded normals. The
    broad dark cheek came from the sculpt's steep side plane. A local normal
    wrap retains its contour while giving a gentle transition into the key.
    """
    P = meshutil.get_verts(ob)
    N = np.empty((len(P),3));ob.data.vertices.foreach_get('normal',N.ravel())
    # Work in exported Y-up coordinates so the reviewed CPU-splice and release
    # evaluate exactly the same spatial mask.
    G = np.c_[P[:,0],P[:,2],-P[:,1]]
    GN = np.c_[N[:,0],N[:,2],-N[:,1]]
    sm = shaders.smooth01
    mask = (sm(G[:,1],1.54,1.58)*(1-sm(G[:,1],1.72,1.75))*sm(G[:,2],-.008,.028)*
            (1-sm(np.abs(G[:,0]),.070,.087)))
    w = .32*mask
    for x in (-.0316,.0316):
        w *= 1-.85*np.exp(-np.sum(((G-[x,1.668,.050])/[.022,.018,.025])**2,axis=1))
    nose = np.exp(-np.sum(((G-[0,1.638,.079])/[.024,.023,.029])**2,axis=1))*sm(-GN[:,1],0,.65)
    w = np.maximum(w,.56*nose)
    collar = (sm(G[:,1],1.39,1.44)*(1-sm(G[:,1],1.55,1.59))*sm(G[:,2],-.005,.025)*
              (1-sm(np.abs(G[:,0]),.10,.15)))
    w = np.maximum(w,.17*collar)*skin_mask
    GN = GN*(1-w[:,None])+np.array([0,0,1])*w[:,None]
    GN /= np.maximum(np.linalg.norm(GN,axis=1,keepdims=True),1e-12)
    NN = np.c_[GN[:,0],-GN[:,2],GN[:,1]]
    ob.data.normals_split_custom_set_from_vertices(NN.tolist())
    ob.data.update()
    pipeline.log(f'authored face/collar normal wrap: {int((w>.01).sum())} vertices')


def dancer_fit(arm, meshes, sculpt=None):
    import seraphine_hair_cards as HC
    for ob in meshes:
        P = meshutil.get_verts(ob)
        skin_mask = None
        if ob.name.endswith('_mesh') and sculpt is not None:
            _, materials, _ = sculpt.eval_points(P)
            skin_mask = (materials == sculpt.materials.index('skin')).astype(float)
        ob.data.vertices.foreach_set('co', dancer_points(P).astype(np.float32).ravel())
        if ob.name in HC._NORMALS:
            # Inverse-transpose of the local deformation Jacobian.
            eps = 1e-5
            J = np.stack([(dancer_points(P+np.eye(3)[i]*eps)-dancer_points(P-np.eye(3)[i]*eps))/(2*eps)
                          for i in range(3)], axis=2)
            N = np.linalg.solve(np.swapaxes(J,1,2), HC._NORMALS[ob.name][...,None])[...,0]
            N /= np.maximum(np.linalg.norm(N,axis=1,keepdims=True),1e-9)
            HC._NORMALS[ob.name] = N.astype(np.float32)
            HC.reapply_normals(ob)
        ob.data.update()
        if skin_mask is not None:
            face_normal_wrap(ob, skin_mask)
    meshutil.select_only([arm]); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in arm.data.edit_bones:
        roll = bone.roll
        points = dancer_points(np.array([bone.head[:], bone.tail[:]]))
        bone.head, bone.tail = points[0], points[1]
        bone.roll = roll
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def build(args):
    T0 = time.time()
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt = (0.004, 0.0016, 0.0012, 0.003) if fast else (0.0021, 0.0009, 0.0007, 0.0016)
    h_hair = 0.0018 if fast else 0.001
    global HEAD_MM
    HEAD_MM = 0.8               # v3: fast builds use the release grid too (the lip-slit fill only works at 0.8 mm)
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(SERA)
    report = {"asset": ASSET, "device": device, "fast": fast, "res": res, "parts": {},
              "head_source": "Blender Human Base Meshes v1.4.1 (CC0) female realistic head, fitted (seraphine_basemesh.py)",
              "head_grid_mm": HEAD_MM}

    t = time.time()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    Sk, kinfo = kilt_parts(L)
    Sh = {s: hand_sculpt(L, s)[0] for s in ("L", "R")}
    Sm_hi, Sm_lo, hair_meta, braid_C, n_soft, cards = hair_sculpts(S, L, H)
    n_lock = n_soft - 7                    # soft = locks + braid-end tuft (7); tendrils are cards now
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")

    L["hair_chain_pts"] = hair_chain_points(braid_C)
    L["kilt_chain_pts"] = kilt_chain_points()
    arm = rig.build_armature(L, ASSET, hair_chain=HAIR_CHAIN, kilt_chain=KILT_CHAIN)

    t = time.time()
    if args.stage in ("skin", "uv"):
        body_hi = head_hi = kilt_hi = hair_hi = None
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
        hair_hi = pipeline.sculpt_mesh(Sm_hi, "hair_hi", h_hair)
        hair_attrs(hair_hi, hair_meta, uv=True)
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    h_lo = 0.0022          # r5: 3.6 -> 3.0 mm; r6 (iter 13): fast builds too, so fast previews show the real face
    # r6 (iter 13): the old [(head, 9900)] region was followed by ONE whole-mesh decimate (759k -> 14.9k tris) that
    # cut the head back to ~650 tris (the face ~260: wedge jaw, pasted mouth band, skewed chin). Every region now
    # gets its own budget and the regions sum to the body target, so the closing decimate is a no-op.
    # The polygonize box is mirror-symmetric in x (lattice symmetric about x = 0) so the symmetric decimate can pair
    # the face's vertices.
    eye_z = float(info["head"]["lm"]["eye_R"][2])
    blo, bhi = S.bounds()
    xh = math.ceil(max(abs(blo[0]), abs(bhi[0])) / h_lo) * h_lo
    blo, bhi = V(-xh, blo[1], blo[2]), V(xh, bhi[1], bhi[2])

    def in_face(P):                 # face, ears, jaw, nape: everything of the head below the hair mass
        return in_head(P) & (P[:, 2] < eye_z + 0.060)

    def in_scalp(P):                # under the groom (hair underlays cover it)
        return in_head(P) & (P[:, 2] >= eye_z + 0.060)

    def in_neck(P):                 # neck column, clavicles, upper chest (board r12: faceted neck/clavicle)
        return ~in_head(P) & (np.abs(P[:, 0]) < 0.17) & (P[:, 2] > 1.36)

    def in_rest(P):
        return ~in_head(P) & ~in_neck(P)
    rest = args.body_tris - args.head_tris - args.scalp_tris - args.neck_tris
    body_lo = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, blo, bhi,
                               regions=[(in_rest, rest), (in_neck, args.neck_tris), (in_scalp, args.scalp_tris),
                                        # faces straddling two regions stay dense after the per-region passes
                                        # (fast1: 18.2k before the closing decimate cut the face 3000 -> 2260):
                                        # one more pass over everything but the face, then the face last
                                        (lambda P: ~in_face(P), rest + args.neck_tris + args.scalp_tris),
                                        (in_face, args.head_tris)],
                               clean=lambda o: report.__setitem__("islands_dropped", drop_islands(o, h_lo)))
    Pb = meshutil.get_verts(body_lo)
    Cb = Pb[np.array([p.vertices[:] for p in body_lo.data.polygons])].mean(1)
    report["region_tris"] = {k: int(fn(Cb).sum()) for k, fn in (("face", in_face), ("scalp", in_scalp),
                                                                 ("neck", in_neck), ("rest", in_rest))}
    pipeline.log(f"body_lo region tris: {report['region_tris']}")
    hands_lo = {}
    for s in ("L", "R"):
        w = L["wrist_" + s]
        hands_lo[s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0017, args.hand_tris, w - 0.17, w + 0.17,
                                       symmetry=False)
    kilt_lo = pipeline.lowpoly(Sk, "kilt_lo", 0.0026, args.kilt_tris, symmetry=False)
    hair_lo = pipeline.lowpoly(Sm_lo, "hair_lo", 0.0024, args.hair_tris)
    hair_attrs(hair_lo, hair_meta)
    los = [body_lo, hands_lo["L"], hands_lo["R"], kilt_lo, hair_lo]
    his = [body_hi, head_hi, hands_hi["L"], hands_hi["R"], kilt_hi, hair_hi]
    for o in los:
        drop_islands(o, 0.0036, min_verts=24)     # post-decimation specks (kilt/hair had 3-vert stray tris)
        o.data.validate(verbose=False)
        report["parts"][o.name] = meshutil.tri_count(o)
    report["geom_qa"] = {o.name: geom_qa(o) for o in los + ([body_hi] if body_hi is not None else [])}
    report["tris_total"] = int(sum(report["parts"].values()))
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']} total={report['tris_total']}")

    t = time.time()
    body_W = skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, hair_lo, n_soft)
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    if args.stage == "skin":
        for o in los:
            pipeline.strip_for_export(o)
        body = meshutil.join(los, ASSET + "_mesh")
        dancer_fit(arm, [body], S)
        skin.debug_dominant(body)
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "seraphine_skin_test.glb"), [arm, body],
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
    freg = np.where((freg == hid) & (Cf[:, 1] < H(0, -0.012, 0)[1]) & (Cf[:, 2] > H(0, 0, -0.16)[2]), face_id, freg)
    freg = pipeline.clean_labels(freg, pipeline.face_adjacency(body_lo), iters=2)
    cfg[face_id] = dict(axis=None, ref=None, density=FACE_DENSITY)
    cfg[hid].update(density=1.0, ref=V(0, 1, 0), halves=False)
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
    allf = np.ones(len(hair_lo.data.polygons), bool)
    pipeline.smart_project_faces(hair_lo, allf, angle=78.0)
    pipeline.normalize_density(hair_lo, allf, 0.85)
    fill = pipeline.pack_atlas_shape(los, margin_px=6 if not fast else 4, res=res)
    report["uv_fill"] = fill
    report["uv_overlap_after_pack"] = int(uv_overlap_faces(body_lo).sum())
    pipeline.log(f"UV overlap after pack (body_lo faces): {report['uv_overlap_after_pack']}")
    if report["uv_overlap_after_pack"]:
        bad = uv_overlap_faces(body_lo)
        cc = np.round(pipeline.face_centers(body_lo)[bad] / 0.05).astype(int)
        u, c = np.unique(cc, axis=0, return_counts=True)
        pipeline.log("  overlap clusters: " + ", ".join(f"{(u[i] * 0.05).round(2).tolist()}x{c[i]}"
                                                         for i in np.argsort(-c)[:10]))
    if args.stage == "uv":
        isl, _ = pipeline.uv_islands(body_lo)
        ls_ = np.empty(len(body_lo.data.polygons), np.int32)
        body_lo.data.polygons.foreach_get("loop_start", ls_)
        pipeline.log(f"  post-pack intra-island folds: {int(uv_overlap_faces(body_lo, isl[ls_]).sum())}; "
                     f"global @2048: {int(uv_overlap_faces(body_lo, res=2048).sum())}; "
                     f"@4096: {int(uv_overlap_faces(body_lo, res=4096).sum())}")
    if args.stage == "uv":          # r2 QA stage: LO + skin + UV atlas only (no HI / bake / export)
        return
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- paint
    t = time.time()
    extra = dict(eyes=info["head"]["eyes"], eye_r=info["head"]["eye_r"], z_knee=L["knee_L"][2],
                 z_chest=L["chest"][2], hair_band_z=H(0, 0, 0.07)[2], iris_deg=37.0, pupil_deg=12.0, lid_shadow=0.30,
                 n_lock=n_lock)
    for o, Sx in ((body_hi, S), (head_hi, S), (hands_hi["L"], Sh["L"]), (hands_hi["R"], Sh["R"]), (kilt_hi, Sk)):
        shaders.assign_bake_materials(o, Sx.materials, kinds=KINDS)
        shaders.paint_mesh(o, Sx.materials, L, PAL, extra, painters=PAINTERS)
    shaders.assign_bake_materials(hair_hi, HAIR_MATS, kinds=KINDS)
    shaders.paint_mesh(hair_hi, HAIR_MATS, L, PAL, extra, painters=PAINTERS)
    pipeline.log(f"painting {time.time()-t:.1f}s")

    t = time.time()
    jobs = [(body_lo, [body_hi, head_hi], 0.012, 0.03),
            (hands_lo["L"], [hands_hi["L"]], 0.006, 0.014),
            (hands_lo["R"], [hands_hi["R"]], 0.006, 0.014),
            (kilt_lo, [kilt_hi], 0.005, 0.012),
            (hair_lo, [hair_hi], 0.006, 0.016)]
    B = pipeline.Baker(res, jobs, shaders.set_pass, los, his)
    spp = dict(albedo=4, prm=2, ao=32 if fast else 64, normal=4 if fast else 8)
    maps = B.run(passes=[("albedo", "EMIT", spp["albedo"]), ("prm", "EMIT", spp["prm"]),
                         ("ao", "EMIT", spp["ao"]), ("normal", "NORMAL", spp["normal"])])
    pipeline.log(f"bake total {time.time()-t:.1f}s")
    face_normal_relief(maps["normal"], body_lo, info["head"]["lm"], maps["ao"], S)
    tex = composite_maps(maps, res)
    report["textures"] = {k: [res, res] for k in tex}
    # The strand-material foundation now supplies scalp coverage. Drop the hidden
    # solid support component after baking; keep the free braid's tapered tail.
    if not args.no_cards:
        import bmesh
        bm = bmesh.new(); bm.from_mesh(hair_lo.data)
        remove = [v for v in bm.verts if v.co.z > 1.45]
        bmesh.ops.delete(bm, geom=remove, context="VERTS")
        bm.to_mesh(hair_lo.data);bm.free();hair_lo.data.update()
        report["parts"]["hair_lo"] = meshutil.tri_count(hair_lo)
    # C2 r3: the hair cards are created AFTER the bake (fast build #1: the card mesh was visible to the bake rays and
    # the under-mass baked the cards' default material = a bald pink dome)
    cards_ob = None
    if not args.no_cards:
        import seraphine_hair_cards as HCARDS
        cards_ob, cinfo = HCARDS.build_card_object(ASSET + "_hair", cards, arm)
        report["parts"]["hair_cards"] = cinfo["tris"]
        report["hair_cards"] = cinfo
        pipeline.log(f"hair cards: {cinfo}")

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
    out = args.out or os.path.join(OUT_MODELS, ASSET + ".glb")
    objs = [arm, body]
    if cards_ob is not None:
        # C2 r3: the hair cards are a second skinned mesh with their own alpha-masked material + authored atlas
        tex_paths = HCARDS.make_atlas(OUT_TEX, pal=dict(hair=PAL["card"], hair_hi=PAL["card_hi"], hair_dark=PAL["card_dark"]))
        pipeline.strip_for_export(cards_ob)
        HCARDS.reapply_normals(cards_ob)
        cmat = HCARDS.card_material("M_" + ASSET + "_hair", tex_paths["albedo"], tex_paths["normal"], tex_paths["orm"],
                                    cutoff=CARD_CUTOFF)
        cards_ob.data.materials.clear()
        cards_ob.data.materials.append(cmat)
        report["tris_total"] += meshutil.tri_count(cards_ob)
        objs.append(cards_ob)
    dancer_fit(arm, [body] + ([cards_ob] if cards_ob is not None else []), S)
    report['proportions'] = 'r18: legs +40mm, shoulders -5.5%, thighs/greaves -12%, head +4%; fitted rest joints'
    report['stretch_qa'] = skin.stretch_report(body, arm)
    if report["tris_total"] > 75000:
        raise RuntimeError(f"Seraphine exceeds 75000 triangle budget: {report['tris_total']}")
    if cards_ob is not None:
        report["hair_stretch_qa"] = skin.stretch_report(cards_ob, arm)
    pipeline.export_glb(out, objs, scene_name=ASSET)
    if cards_ob is not None:
        info_m = HCARDS.patch_glb(out, "M_" + ASSET + "_hair", cutoff=CARD_CUTOFF, double_sided=True, specular=CARD_SPECULAR,
                                  extras={"kcaRimScale": CARD_RIM_SCALE,
                                          "kcaMetalTint": [0.8, 0.12, 0.12, 0.15], "kcaMetalEnv": 0.85})
        report["hair_card_material"] = info_m
        pipeline.log(f"hair card material: {info_m}")
    # The sculpt's open lip crease needs a dark oral backstop. Keep it in the
    # existing body primitive and bind it rigidly to head; no extra draw or map.
    import subprocess
    # r6: drop the symmetric decimate's mirror-plane fin triangles + the sealed ear-canal bubbles (index buffer only)
    clean_out = out + ".clean.glb"
    cleaned = json.loads(subprocess.check_output(
        [VENV_PY, os.path.join(HERE, "seraphine_mesh_clean.py"), out, clean_out], text=True))
    os.replace(clean_out, out)
    report["mesh_clean"] = cleaned
    if "totalTriangles" in cleaned:
        report["tris_total"] = cleaned["totalTriangles"]
    pipeline.log(f"mesh clean: {cleaned}")
    if not args.mouth_finish:       # r6: the dense face has a closed, sculpted mouth; the r12 patch is opt-in
        report["glb"] = out
        report["glb_mb"] = os.path.getsize(out) / 1e6
        report["seconds"] = time.time() - T0
        pipeline.write_json(os.path.join(HERE, "out", "seraphine_report.json"), report)
        pipeline.log(f"DONE {ASSET} in {report['seconds']:.0f}s -> {out} ({report['glb_mb']:.1f} MB, "
                     f"{report['tris_total']} tris)")
        if not args.no_weapon:
            import build_weapon_dawn_dusk
            importlib.reload(build_weapon_dawn_dusk)
            build_weapon_dawn_dusk.build(args)
        return
    mouth_out = out + ".mouth.glb"
    mouth = json.loads(subprocess.check_output(
        [VENV_PY, os.path.join(HERE, "seraphine_mouth_finish.py"), out, mouth_out, OUT_TEX], text=True))
    os.replace(mouth_out, out)
    report["mouth_finish"] = mouth
    report["parts"]["mouth_backstop"] = mouth["newCavityTriangles"]
    report["tris_total"] = mouth["totalTriangles"]
    report["glb"] = out
    report["glb_mb"] = os.path.getsize(out) / 1e6
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "seraphine_report.json"), report)
    pipeline.log(f"DONE {ASSET} in {report['seconds']:.0f}s -> {out} ({report['glb_mb']:.1f} MB, "
                 f"{report['tris_total']} tris)")
    if not args.no_weapon:
        import build_weapon_dawn_dusk
        importlib.reload(build_weapon_dawn_dusk)
        build_weapon_dawn_dusk.build(args)


def face_normal_relief(normal_map, body_lo, lm, ao_map=None, sculpt=None):
    """Local tangent-normal strength, rasterised from landmark masks through the actual UVs.

    A no-normal live probe isolates the 'nose ring' to the baked high/low normal
    difference. Retain the low mesh's real nose/lip form and the rest of the atlas.
    """
    me = body_lo.data
    P = meshutil.get_verts(body_lo)
    nose = np.asarray(lm["nose_tip"]) + V(0, .006, -.006)
    lip = np.asarray(lm["lip_line"]) + V(0, 0, -.003)
    def mask(c, r):
        d = np.linalg.norm((P - c) / np.array(r), axis=1)
        return 1 - shaders.smooth01(d, .65, 1.0)
    # r6 (iter 13): the face is ~3000 tris now (was ~260), so the baked high/low difference is small; keep a light
    # flattening only (the old .82/.48/.90 masks also erased the lip border and mouth crease)
    # fast2: cheeks/jaw still need the full correction (the 35-degree cheek blotch returned at 0.35); the lips and
    # nose keep most of their baked relief (lip border, mouth crease, alae)
    kn, kl, kc = FACE_RELIEF
    strength = np.maximum(.82 * kn * mask(nose, (.027, .025, .021)), .48 * kl * mask(lip, (.034, .020, .018)))
    chin = np.asarray(lm["chin"])
    strength = np.maximum(strength, .90 * kc * mask(chin + V(0,.005,.005), (.075,.085,.030)))
    for key,sx in (("eye_R",1),("eye_L",-1)):
        cheek = np.asarray(lm[key]) + V(sx*.017,.010,-.037)
        strength = np.maximum(strength, .90 * kc * mask(cheek, (.035,.048,.041)))
    for key in ("ear_R", "ear_L"):
        strength = np.maximum(strength, .70 * mask(np.asarray(lm[key]), (.022, .026, .034)))
    uv = np.empty((len(me.loops), 2), np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    H, W = normal_map.shape[:2]
    M = np.zeros((H, W), np.float32)
    AOM = np.zeros_like(M)
    ao_strength = np.zeros(len(P))
    if ao_map is not None and sculpt is not None:
        _, material, _ = sculpt.eval_points(P)
        ao_strength = .80*(material == sculpt.materials.index('skin'))*shaders.smooth01(P[:,2], 1.34, 1.50)
    for face in me.polygons:
        li = list(face.loop_indices)
        if len(li) != 3 or max(np.maximum(strength[lv[li]],ao_strength[lv[li]])) < .001:
            continue
        q = uv[li] * [W, H]
        lo = np.maximum(np.floor(q.min(0)).astype(int), 0)
        hi = np.minimum(np.ceil(q.max(0)).astype(int), [W-1, H-1])
        if np.any(hi < lo):
            continue
        xx, yy = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
        (ax, ay), (bx, by), (cx, cy) = q
        det = (bx-ax)*(cy-ay) - (cx-ax)*(by-ay)
        if abs(det) < 1e-8:
            continue
        u = ((bx-xx)*(cy-yy) - (cx-xx)*(by-yy)) / det
        v = ((cx-xx)*(ay-yy) - (ax-xx)*(cy-yy)) / det
        w = 1-u-v
        a, b, c = strength[lv[li]]
        value = np.where((u >= 0) & (v >= 0) & (w >= 0), a*u+b*v+c*w, 0)
        tile = M[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
        np.maximum(tile, value, out=tile)
        a,b,c = ao_strength[lv[li]]
        value = np.where((u>=0)&(v>=0)&(w>=0), a*u+b*v+c*w, 0)
        tile = AOM[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        np.maximum(tile,value,out=tile)
    N = normal_map[..., :3] * 2 - 1
    N[..., :2] *= (1 - M[..., None])
    N /= np.maximum(np.linalg.norm(N, axis=2, keepdims=True), 1e-9)
    normal_map[..., :3] = (N + 1) * .5
    if ao_map is not None:
        # Skin uses live form lighting. Deep nostril/mouth and collar cavities in
        # the selected-to-active bake used to add a second, fixed brown shadow.
        ao_map[..., :2] += (1-ao_map[..., :2])*AOM[...,None]
    pipeline.log(f"face normal relief: {np.count_nonzero(M > .01)} texels, max {M.max():.2f}")


def composite_maps(maps, res):
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao = maps["ao"]
    ao_s = np.clip(ao[..., 0], 0, 1)
    ao_l = np.clip(ao[..., 1], 0, 1)
    prm = maps["prm"]
    nrm = maps["normal"]
    rgb = alb[..., :3].copy()
    occl = np.clip(1.0 - 0.50 * (1 - ao_s) - 0.30 * (1 - ao_l), 0, 1)[..., None]   # C2: lighter (was 0.75/0.45)
    tint = np.array([0.52, 0.30, 0.26])
    rgb = rgb * (tint + (1 - tint) * occl)
    orm = np.stack([np.clip(0.35 + 0.65 * ao_l * (0.5 + 0.5 * ao_s), 0, 1), np.clip(prm[..., 0], 0.04, 1),
                    np.clip(prm[..., 1], 0, 1)], axis=-1)
    n3 = nrm[..., :3]
    rgb = pipeline.dilate(rgb, cov, 16)
    orm = pipeline.dilate(orm, cov, 16)
    n3 = pipeline.dilate(n3, cov, 16)
    tex = {}
    tex["albedo"] = pipeline.save_png(rgb, os.path.join(OUT_TEX, "seraphine_albedo.png"), "seraphine_albedo", "sRGB",
                                      linear_to_srgb=True)
    tex["orm"] = pipeline.save_png(orm, os.path.join(OUT_TEX, "seraphine_orm.png"), "seraphine_orm", "Non-Color")
    tex["normal"] = pipeline.save_png(n3, os.path.join(OUT_TEX, "seraphine_normal.png"), "seraphine_normal",
                                      "Non-Color")
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
    # r18 owner75k cap: spend extra density on face, hands and smooth deformed joints
    ap.add_argument("--body-tris", type=int, default=30000)
    ap.add_argument("--head-tris", type=int, default=9000)      # face + ears + jaw + nape (below the hair mass)
    ap.add_argument("--scalp-tris", type=int, default=900)      # under the groom
    ap.add_argument("--neck-tris", type=int, default=3600)      # neck, clavicles, upper chest
    ap.add_argument("--hand-tris", type=int, default=1600)
    ap.add_argument("--kilt-tris", type=int, default=3600)
    ap.add_argument("--hair-tris", type=int, default=700)      # bake support + tail; head support is dropped after baking
    ap.add_argument("--save-blend", action="store_true")
    ap.add_argument("--mouth-finish", action="store_true")     # r6: r12's oral backstop/normal patch (off)
    ap.add_argument("--no-cards", action="store_true")     # C2 r3: skip the alpha hair cards (A/B)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
