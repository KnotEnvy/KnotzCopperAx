"""Select-screen giant skeletal hand, C2 r11: SCULPTED (SDF bones -> hi-poly -> decimated game mesh -> baked maps).

Every earlier hand was either fused clay (smooth-union SDF, C1 r5-r8) or loose numpy parts (C1 r9 - C2 r10: "a ring of
separate pale posts around a pile of loose pebbles", "polished grey marble"). This one is built like the enemy skeletons
(blender/lib sdf + pipeline): each bone is its own anatomical SDF primitive - a waisted, D-sectioned shaft with flared ends,
palmar tubercles at the base and a bicondylar head (metacarpals: one big rounded head) - and the bones are HARD-unioned
where they meet, so every joint is a tight crease (no gap, no smooth blob). Carpals = 8 rounded blocks pressed into one
compact block with a carpal-tunnel groove; radius + ulna run down at a low angle toward the camera into the barrow heap.
Real geometry for the big cracks and chips; fine pores/hairline cracks come from a node-side bump in the normal bake.

C2 r12 (board r11: "soft clay tubing - fused finger roots, swollen joints, pebble carpals; fingers straight posts; radius/ulna
splay like spider legs; terracotta"): ARTICULATED. Every bone = narrow waisted shaft + flared ends (seg_bone); each joint is a
convex head (Head) nested in a shallow cupped base with a uniform G_JOINT gap (dark joint line at any flexion) and a hidden
cartilage core on the joint axis (groove, never see-through). Fingers curl progressively from the MCP and converge on the
middle finger (cupped crown); opposed thumb swings forward-out and hooks in across the palm front; carpals = flat-sided,
dome-topped blocks in staggered rows (box n ellipsoid); radius + ulna run together, heavier, leaning into the heap.
Desaturated grey-ivory albedo, neutral occlusion tint.

C2 r13 (board r12: "every palm a heap of rounded cobbles; fingers evenly spaced straight posts"): the select camera looks
across the palm at ~10 deg, so a flat palm can never show its metacarpals. Now five slender CURVED metacarpals (CurveBone,
43-45 % of the hand length) form a short flat deck under the hero's feet right in front of the knuckles and then curve DOWN
toward the camera (~35-45 deg) into a SMALL 8-bone carpal block at the heel; they fan out fast from the carpals with a
recessed dark-earth web between them (paint channel 'dirt'). Slimmer tapered phalanges, uneven cupping curl (index/middle
most, little finger least), thumb set apart on the radial side, radius + ulna close together dropping almost straight down
into the heap. One watertight mesh (wrist cartilage cores, carpal core, metacarpal cracks kept above the web).

Frame = the JS/glTF frame select3d.js expects (hand units, Y up, +Z toward the camera, RIGHT hand, thumb on +X; the hero
stands on the palm at y = TOP around (0, 0.09)). The Blender meshes are built in that frame and exported with
export_yup=False, so no axis conversion happens anywhere.

  Slot-free shape preview (bundled python, no Blender slot):
    <blender>/5.2/python/bin/python3.13 blender/build_ui_hand_sculpt.py --preview [out.glb] [--h 0.01]
    -> vertex-coloured GLB (AO from the SDF) for ?handglb=<url> in the real select screen
  Release (Blender):
    node tools/blender-run.mjs --owner ui-flow --what "ui hand sculpt" -- -b --factory-startup -P blender/build_ui_hand_sculpt.py -- [--fast]
    -> public/assets/models/ui_skeletal_hand.glb (albedo / normal / ORM, <= 35k tris), report blender/out/ui_hand_sculpt_report.json
"""
import os
import sys
import math
import time
import json
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import numpy as np

try:
    import bpy  # noqa: F401
    HAVE_BPY = True
except ImportError:
    HAVE_BPY = False

from lib import sdf
from lib.sdf import V, norm, Sculpt, Ellipsoid, RoundBox, RoundCone, Chain, Displace, Prim, Union, Diff, Offset, Inter

OUT_GLB = os.path.join(ROOT, "public", "assets", "models", "ui_skeletal_hand.glb")
OUT_TEX = os.path.join(ROOT, "progress", "tmp", "hands_r13", "tex")
REPORT = os.path.join(HERE, "out", "ui_hand_sculpt_report.json")

TOP = 1.216            # palm top surface under the hero's feet (select3d: PALM_Y / HAND_SCALE - HAND_DROP / HAND_SCALE)
HERO = (-0.035, 0.09)  # hero foot centre (x, z) in hand space (all three hands, within a few cm)
K_JOINT = 0.004        # bone-to-bone union: a tight crease, never a blob
TRIS = 34000

UP = V(0, 1, 0)
JOINTS = []            # (centre, radius) of every articulation: stains / grime in the painter
TIPS = []              # distal tips: soot
BIG = []               # (name, Bone) bones big enough for real cracks / chips


def sst(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rot_about(v, axis, ang):
    axis = norm(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * float(np.dot(axis, v)) * (1 - math.cos(ang))


# ----------------------------------------------------------------------------------------------------------- bone prim
class Bone(Prim):
    """Long bone from a (proximal joint) to b (distal joint).
    Section: ellipse, lateral half-axis lat(t)*r(t), palmar/dorsal half-axis r(t) (palmar side squashed by `palm` -> D shape).
    r(t): rA at the base, waisted shaft rS, rB at the head, blended over the first fa / last fb of the length.
    capA / capB scale the rounded end caps along the axis (small = flat articular base). bow = dorsal bow (fraction of L).
    pref = palmar reference direction (orthogonalised to the axis)."""

    def __init__(self, a, b, rA, rS, rB, pref=(0, 1, 0), lat=(1.0, 1.0, 1.0), palm=1.0, bow=0.0, fa=0.32, fb=0.32,
                 capA=1.0, capB=1.0, twist=0.0):
        self.a, self.b = V(a), V(b)
        d = self.b - self.a
        self.L = float(np.linalg.norm(d))
        self.e0 = d / self.L
        r = V(pref) - self.e0 * float(np.dot(V(pref), self.e0))
        e1 = norm(r)
        e2 = np.cross(self.e0, e1)
        if twist:
            e1, e2 = rot_about(e1, self.e0, twist), rot_about(e2, self.e0, twist)
        self.e1, self.e2 = e1, e2
        self.rA, self.rS, self.rB = float(rA), float(rS), float(rB)
        self.lat = tuple(float(x) for x in lat)
        self.palm, self.bow, self.fa, self.fb = float(palm), float(bow), float(fa), float(fb)
        self.capA, self.capB = float(capA), float(capB)
        R = max(rA, rS, rB) * max(max(self.lat), 1.0) * max(capA, capB, 1.0) + abs(bow) * self.L + 0.01
        self.lo = np.minimum(self.a, self.b) - R
        self.hi = np.maximum(self.a, self.b) + R
        self.lip = min(min(self.lat), self.palm, capA, capB, 1.0)

    def frame_at(self, t):
        """centre, radius, lateral scale at parameter t (for placing cracks / chips / tubercles on the surface)."""
        wA, wB = 1 - sst(0, self.fa, t), sst(1 - self.fb, 1, t)
        r = self.rS + (self.rA - self.rS) * wA + (self.rB - self.rS) * wB
        la = self.lat[1] + (self.lat[0] - self.lat[1]) * wA + (self.lat[2] - self.lat[1]) * wB
        c = self.a + self.e0 * (t * self.L) - self.e1 * (self.bow * self.L * math.sin(math.pi * t))
        return c, r, la

    def surface(self, t, ang, out=0.0):
        """Point on the (undisplaced) surface at t, angle ang around the axis (0 = palmar, +pi/2 = +lateral)."""
        c, r, la = self.frame_at(t)
        dv = self.palm if math.cos(ang) > 0 else 1.0
        p = c + self.e1 * (math.cos(ang) * r * dv) + self.e2 * (math.sin(ang) * r * la)
        n = norm(self.e1 * (math.cos(ang) / dv) + self.e2 * (math.sin(ang) / la))
        return p + n * out, n

    def d(self, X, Y, Z):
        a, e0, e1, e2 = self.a, self.e0, self.e1, self.e2
        dx, dy, dz = X - a[0], Y - a[1], Z - a[2]
        t = (dx * e0[0] + dy * e0[1] + dz * e0[2]) / self.L
        v = dx * e1[0] + dy * e1[1] + dz * e1[2]
        u = dx * e2[0] + dy * e2[1] + dz * e2[2]
        tc = np.clip(t, 0.0, 1.0)
        wA = 1 - sst(0, self.fa, tc)
        wB = sst(1 - self.fb, 1, tc)
        r = self.rS + (self.rA - self.rS) * wA + (self.rB - self.rS) * wB
        la = self.lat[1] + (self.lat[0] - self.lat[1]) * wA + (self.lat[2] - self.lat[1]) * wB
        if self.bow:
            v = v + self.bow * self.L * np.sin(math.pi * tc)
        dv = np.where(v > 0, self.palm, 1.0)
        al = np.where(t < 0, t * self.L / self.capA, np.where(t > 1, (t - 1) * self.L / self.capB, 0.0))
        q = np.sqrt((u / la) ** 2 + (v / dv) ** 2 + al ** 2)
        return (q - r) * self.lip



def catmull(pts, n=400):
    """Uniform Catmull-Rom spline through pts (end tangents mirrored) sampled densely."""
    P = [V(p) for p in pts]
    P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        m = max(4, n // (len(P) - 3))
        for t in np.linspace(0, 1, m, endpoint=(i == len(P) - 3)):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.array(out)


class CurveBone(Prim):
    """C2 r13: a long bone along a smooth CURVED centreline (Catmull-Rom through `pts`, base -> head), same section model as
    Bone (waisted D-section, flared ends, lateral scale, palmar flattening). Used for the metacarpals: a flat distal deck the
    hero stands on, curving down toward the camera into the carpals (a flat palm is invisible from the 10 deg select camera).
    Evaluated as n short straight slabs along the arc-length-resampled curve (min over slabs = rounded joins, < 3 deg each)."""

    def __init__(self, pts, rA, rS, rB, pref=(0, 1, 0), lat=(1.0, 1.0, 1.0), palm=1.0, fa=0.3, fb=0.3, capA=1.0, capB=1.0,
                 n=14):
        C = catmull(pts)
        seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
        s = np.concatenate([[0.0], np.cumsum(seg)])
        self.L = float(s[-1])
        su = np.linspace(0, self.L, n + 1)
        self.pts = np.stack([np.interp(su, s, C[:, k]) for k in range(3)], 1)
        self.s = su / self.L
        self.rA, self.rS, self.rB = float(rA), float(rS), float(rB)
        self.lat = tuple(float(x) for x in lat)
        self.palm, self.fa, self.fb, self.capA, self.capB = float(palm), float(fa), float(fb), float(capA), float(capB)
        self.segs = []
        for i in range(n):
            a, b = self.pts[i], self.pts[i + 1]
            d = b - a
            Ls = float(np.linalg.norm(d))
            e0 = d / Ls
            r = V(pref) - e0 * float(np.dot(V(pref), e0))
            e1 = norm(r)
            self.segs.append((a, e0, e1, np.cross(e0, e1), Ls, self.s[i], self.s[i + 1]))
        self.a, self.b = self.pts[0], self.pts[-1]
        self.e0 = norm(self.b - self.a)
        self.e1 = self.segs[len(self.segs) // 2][2]
        R = max(rA, rS, rB) * max(max(self.lat), 1.0) * max(capA, capB, 1.0) + 0.01
        self.lo = self.pts.min(0) - R
        self.hi = self.pts.max(0) + R
        self.lip = min(min(self.lat), self.palm, capA, capB, 1.0)

    def prof(self, s):
        wA, wB = 1 - sst(0, self.fa, s), sst(1 - self.fb, 1, s)
        r = self.rS + (self.rA - self.rS) * wA + (self.rB - self.rS) * wB
        la = self.lat[1] + (self.lat[0] - self.lat[1]) * wA + (self.lat[2] - self.lat[1]) * wB
        return r, la

    def tangent(self, end):
        a, e0 = self.segs[-1 if end else 0][:2]
        return e0

    def _seg_at(self, t):
        i = int(min(len(self.segs) - 1, max(0, np.searchsorted(self.s, t, "right") - 1)))
        a, e0, e1, e2, Ls, s0, s1 = self.segs[i]
        f = (t - s0) / (s1 - s0)
        return a + e0 * (f * Ls), e0, e1, e2

    def frame_at(self, t):
        c = self._seg_at(t)[0]
        r, la = self.prof(t)
        return c, float(r), float(la)

    def surface(self, t, ang, out=0.0):
        c, e0, e1, e2 = self._seg_at(t)
        r, la = self.prof(t)
        dv = self.palm if math.cos(ang) > 0 else 1.0
        p = c + e1 * (math.cos(ang) * r * dv) + e2 * (math.sin(ang) * r * la)
        n = norm(e1 * (math.cos(ang) / dv) + e2 * (math.sin(ang) / la))
        return p + n * out, n

    def d(self, X, Y, Z):
        out = None
        last = len(self.segs) - 1
        for i, (a, e0, e1, e2, Ls, s0, s1) in enumerate(self.segs):
            dx, dy, dz = X - a[0], Y - a[1], Z - a[2]
            t = (dx * e0[0] + dy * e0[1] + dz * e0[2]) / Ls
            v = dx * e1[0] + dy * e1[1] + dz * e1[2]
            u = dx * e2[0] + dy * e2[1] + dz * e2[2]
            tc = np.clip(t, 0.0, 1.0)
            ax = (t - tc) * Ls
            if i == 0:
                ax = np.where(ax < 0, ax / self.capA, ax)
            if i == last:
                ax = np.where(ax > 0, ax / self.capB, ax)
            r, la = self.prof(s0 + tc * (s1 - s0))
            dv = np.where(v > 0, self.palm, 1.0)
            di = (np.sqrt((u / la) ** 2 + (v / dv) ** 2 + ax ** 2) - r) * self.lip
            out = di if out is None else np.minimum(out, di)
        return out


G_JOINT = 0.014        # articular gap (hand units): ~2.7 px dark joint line at the 1600x900 select camera


def frame_M(e0, e1, e2):
    """sdf.Ellipsoid frame: columns = local x, y, z axes in world (x lateral, y palmar, z along)."""
    return np.stack([e2, e1, e0], axis=1)


def bone_frame(d, pref):
    e0 = norm(d)
    r = V(pref) - e0 * float(np.dot(V(pref), e0))
    e1 = norm(r)
    return e0, e1, np.cross(e0, e1)


class Head:
    """Articular head of a bone: an ellipsoid envelope at the joint centre. The NEXT bone's base is cupped around it
    (envelope inflated by the joint gap), so the joint reads as a convex head nested in a concave base with a uniform dark
    line all round, at any flexion (the bones rotate about this centre)."""

    def __init__(self, c, radii, M):
        self.c, self.r, self.M = V(c), V(radii), M

    def cup(self, gap):
        return Ellipsoid(self.c, self.r + gap, self.M)


def seg_bone(name, J0, J1, rA, rS, rh, kind, pref, prev=None, lat=(1.18, 1.05, 1.15), palm=0.86, bow=0.02, seed=0,
             lump=0.0025, big=False, gap=G_JOINT, tip_len=0.0):
    """One articulated bone from joint centre J0 (centre of the previous head) to J1 (centre of its own head).
    Narrow waisted D-section shaft, flared base (cupped around `prev` with an articular gap), sculpted head at J1:
      kind 'mc'  : one big round knuckle head + palmar epicondyles + a squarish carpal base
      kind 'p'   : bicondylar head (trochlear groove), broad base with palmar tubercles
      kind 'tip' : tapering distal phalanx ending in a spade tuft with a short hooked point (no head)
    Returns (prim, head) - head = Head for the next bone's cup (None for tips)."""
    J0, J1 = V(J0), V(J1)
    e0, e1, e2 = bone_frame(J1 - J0, pref)
    M = frame_M(e0, e1, e2)
    L = float(np.linalg.norm(J1 - J0))
    pr_r = float(prev.r[2]) if prev is not None else 0.0
    # shaft from just behind the cup (the base cap is carved by the cup) to the head centre
    # shallow articular dish (no razor lip): the base cap only dips 0.14 rA into the inflated head envelope
    a = J0 + e0 * (pr_r + gap + 0.48 * rA) if prev is not None else J0
    b = J1 if kind != "tip" else J1 - e0 * (0.2 * rh)
    rB = rh * (0.70 if kind != "tip" else 1.0)
    sh = Bone(a, b, rA, rS, rB, pref=pref, lat=lat, palm=palm, bow=bow, fa=0.24, fb=0.26 if kind != "tip" else 0.40,
              capA=0.62, capB=0.6)
    parts = [sh]
    A = sh.a
    la, lh = lat[0], lat[2]
    head = None
    if kind == "mc":
        hr = (rh * lh, rh * 1.0, rh * 0.98)
        parts.append(Ellipsoid(J1, hr, M))
        for s in (-1, 1):   # palmar condyles under the knuckle head
            parts.append(Ellipsoid(J1 - e0 * (0.30 * rh) + e2 * (s * 0.42 * rh * lh) + e1 * (0.42 * rh),
                                   (0.40 * rh, 0.44 * rh, 0.56 * rh), M))
        # squarish carpal base: a flatter block, broad laterally
        parts.append(RoundBox(A + e0 * (0.05 * L), (0.95 * rA * la, 0.78 * rA, 0.62 * rA), M, r=0.32 * rA))
        head = Head(J1, hr, M)
    elif kind == "p":
        hr = (rh * lh, rh * 0.86, rh * 0.82)
        hd = Ellipsoid(J1, hr, M)
        # trochlear groove across the distal-palmar face -> two crisp condyles
        groove = RoundCone(J1 + e0 * (0.95 * rh) - e1 * (0.6 * rh), J1 + e0 * (0.55 * rh) + e1 * (1.0 * rh),
                           0.16 * rh, 0.20 * rh)
        parts.append(Diff(hd, groove, k=0.004))
        head = Head(J1, hr, M)
    elif kind == "tip":
        # spade tuft + a short hooked point (claw-like, curling palmar)
        tc = J1 - e0 * (0.2 * rh)
        parts.append(Ellipsoid(tc, (1.30 * rh, 0.70 * rh, 1.05 * rh), M))
        pt = tc + e0 * (rh * (0.9 + tip_len)) + e1 * (0.45 * rh)
        parts.append(RoundCone(tc + e0 * (0.3 * rh), pt, 0.62 * rh, 0.12 * rh, squash=(1.0, 1.0), ref=tuple(e1)))
    k_in = 0.007 * (rS / 0.06) ** 0.5
    pr = Union(*parts, k=k_in)
    if lump:
        pr = Displace(pr, lump, 7.5, octaves=3, seed=seed)
    if prev is not None:
        pr = Diff(pr, prev.cup(gap), k=0.003)
        # cartilage core bridging the joint on its axis: the gap is a deep shadowed groove all round, never see-through
        rc = 0.42 * min(float(prev.r[0]), float(prev.r[1]))
        pr = Union(pr, RoundCone(J0 + e0 * (0.5 * pr_r), J0 + e0 * (pr_r + gap + 0.6 * rA), rc, rc * 1.05), k=0.0)
    pr.bone = sh
    if big:
        BIG.append((name, sh))
    return pr, head


def carpal(c, half, ang=(0, 0, 0), seed=0, round_=0.30):
    """Carpal = a bevelled block with FLAT contact planes (pressed against its neighbours -> straight crease lines)."""
    M = sdf.rot(*ang)
    h = V(half)
    rb = RoundBox(c, h, M, r=min(half) * 0.42)
    dome = Ellipsoid(c, h * V(1.30, 1.22, 1.30), M)
    return Displace(Inter(rb, dome, k=0.012), 0.0022, 9.0, octaves=2, seed=seed)


# ----------------------------------------------------------------------------------------------------------- skeleton
# C2 r13 layout (hand units; +Z toward the camera). The select camera looks across the palm at only ~10 deg, so a FLAT palm
# collapses to a ~20 px strip of rounded tops ("cobbles"). Now the hero stands on a short flat DECK formed by the distal
# metacarpals right in front of the knuckles, and the shafts then curve DOWN toward the camera (~34 deg) into a small carpal
# block at the heel of the hand: from the camera the five shafts read as a long fan (~75 px) with dark gaps between them.
YD = TOP - 0.040                 # metacarpal centre height along the deck (shaft top = TOP under the feet)
SLOPE_A = norm(V(0.0, 0.50, -0.866))   # carpal block / proximal palm: "along" axis, pointing up the slope to the knuckles
SLOPE_N = norm(V(0.0, 0.866, 0.50))    # its palmar normal (up + toward the camera)
EX = V(1.0, 0.0, 0.0)
M_BLOCK = np.stack([EX, SLOPE_N, SLOPE_A], axis=1)    # sdf frame: x lateral, y palmar, z along
CB = V(-0.010, 0.808, 0.846)     # carpal block centre (heel of the hand)


def blk(u, v, w):
    """carpal-block local (lateral, palmar, along) -> hand space"""
    return CB + EX * u + SLOPE_N * v + SLOPE_A * w


FINGERS = {
    #           knuckle (x, z)   base (x, z)      deck dy  scale  curl-plane azimuth (x, z)  P1/P2/P3 deg from vertical (+ = out)
    "index":  ((0.385, -0.150), (0.135, 0.735), 0.014, 0.94, (1.00, -0.50), (27, -26, -80)),
    "middle": ((0.125, -0.275), (0.050, 0.742), 0.000, 1.00, (0.30, -1.00), (23, -21, -70)),
    "ring":   ((-0.140, -0.250), (-0.050, 0.736), 0.004, 0.95, (-0.45, -1.00), (27, -12, -56)),
    "pinky":  ((-0.385, -0.115), (-0.148, 0.722), 0.024, 0.80, (-1.00, -0.35), (32, 2, -38)),
}
LEN = (0.58, 0.37, 0.27)         # proximal / middle / distal phalanx (joint centre to joint centre), x finger scale
#        base   shaft  head            C2 r13: slimmer, tapering to the tip (r12: 0.112/0.076/0.090 -> swollen balls)
R_PH = ((0.095, 0.062, 0.070),   # proximal phalanx
        (0.077, 0.050, 0.056),   # middle phalanx
        (0.061, 0.038, 0.041))   # distal phalanx (head = tuft)


def mc_curve(name, pts, rA, rS, rh, seed, lat=(1.20, 1.12, 1.06), palm=0.84):
    """Metacarpal along a curved centreline pts[0] (carpal base) -> pts[-1] (knuckle centre): slender waisted shaft, a
    compact (not swollen) knuckle head with two palmar condyles, and a squarish base pressed onto the distal carpal row."""
    sh = CurveBone(pts, rA, rS, rh * 0.72, pref=(0, 1, 0), lat=lat, palm=palm, fa=0.20, fb=0.22, capA=0.6, capB=0.6)
    J1 = V(pts[-1])
    e0, e1, e2 = bone_frame(sh.tangent(True), (0, 1, 0))
    M = frame_M(e0, e1, e2)
    hr = (rh * lat[2], rh * 0.92, rh * 0.96)
    parts = [sh, Ellipsoid(J1, hr, M)]
    for s in (-1, 1):   # palmar condyles under the knuckle head
        parts.append(Ellipsoid(J1 - e0 * (0.32 * rh) + e2 * (s * 0.40 * rh * lat[2]) + e1 * (0.38 * rh),
                               (0.36 * rh, 0.40 * rh, 0.50 * rh), M))
    b0, b1, b2 = bone_frame(sh.tangent(False), tuple(SLOPE_N))
    parts.append(RoundBox(V(pts[0]) + b0 * (0.035 * sh.L), (0.92 * rA * lat[0], 0.74 * rA, 0.55 * rA),
                          frame_M(b0, b1, b2), r=0.34 * rA))
    pr = Union(*parts, k=0.007 * (rS / 0.06) ** 0.5)
    pr = Displace(pr, 0.0022, 7.5, octaves=3, seed=seed)
    pr.bone = sh
    BIG.append((name, sh))
    return pr, Head(J1, hr, M)


def build_sculpt():
    JOINTS.clear(); TIPS.clear(); BIG.clear()
    S = Sculpt(materials=("bone",), default_mat="bone")
    rng = np.random.default_rng(13)
    heads, curves = {}, {}

    # --- metacarpals: five long slender separate shafts fanning from the carpal block to the knuckles
    for i, (nm, (kxz, bxz, dy, s, _, _)) in enumerate(FINGERS.items()):
        sw = s ** 0.5
        xh, zh = kxz
        xb, zb = bxz
        yd = YD + dy
        keys = []
        for zz, yy in ((zh, yd), (0.020, yd), (0.235, yd - 0.006), (0.420, yd - 0.062), (0.590, yd - 0.165)):
            fb = (zb - zz) / (zb - zh)                     # 0 at the base .. 1 at the knuckle
            g = 1 - (1 - fb) ** 1.8                        # fan out FAST from the tight carpal base: gaps run the full length
            keys.append(V(xb + (xh - xb) * g, yy, zz))
        base = blk(xb - CB[0], 0.0, 0.112 + 0.4 * (zb - 0.735))   # on the distal face of the carpal block
        pts = [base] + keys[::-1]
        pr, hd = mc_curve("mc_" + nm, pts, 0.052 * sw, 0.033 * sw, 0.072 * sw, seed=10 + i)
        S.add(pr, k=0.0)
        heads[nm] = hd
        curves[nm] = pr.bone
        JOINTS.append((base, 0.06 * sw))

    # --- recessed dark web between neighbouring shafts (dried tissue + barrow dirt, ~5 cm below the shaft tops): the gaps
    #     read as dark grooves, never as holes onto the lit floor far below. Painted 'dirt'.
    names = list(FINGERS)
    for A_, B_ in zip(names[:-1], names[1:]):
        ca, cb = curves[A_], curves[B_]
        ell = []
        for t in np.linspace(0.07, 0.86, 11):
            pa, pb = ca.frame_at(t)[0], cb.frame_at(t)[0]
            tg = norm(ca._seg_at(t)[1] + cb._seg_at(t)[1])
            lt = norm((pb - pa) - tg * float(np.dot(pb - pa, tg)))
            nn = norm(np.cross(lt, tg))
            if nn[1] < 0:
                nn = -nn
            hw = 0.5 * float(np.linalg.norm(pb - pa))
            c = 0.5 * (pa + pb) - nn * 0.044
            # thin ellipsoid rims are buried inside the shafts (hw x 1.15): no paper-thin edge for the noise to break into islands
            ell.append(Ellipsoid(c, (hw * 1.15, 0.036, 0.065), frame_M(tg, nn, lt)))
        web = Displace(Union(*ell, k=0.035), 0.0035, 11.0, octaves=3, seed=40 + len(A_))
        S.add(web, k=0.016)                            # filleted into the shafts: no slivers / pockets
        S.paint(Offset(web, 0.004), "dirt", soft=0.01)

    # --- fingers: 3 tapering phalanges each, cupping UNEVENLY around the hero: P1 leans out/back from the knuckle, P2 and P3
    #     flex back in (index/middle curl hardest, little finger least), each finger in its own curl plane (azimuth) so the
    #     crown reads as a loosely cupped hand, not evenly spaced posts
    for i, (nm, (kxz, bxz, dy, s, az, ang)) in enumerate(FINGERS.items()):
        sw = s ** 0.6
        out = norm(V(az[0], 0.0, az[1]))
        J = heads[nm].c.copy()
        prev = heads[nm]
        JOINTS.append((J.copy(), 0.085 * sw))
        jit = rng.uniform(-3.0, 3.0, 3)
        for k in range(3):
            ph = math.radians(ang[k] + jit[k])
            dvec = UP * math.cos(ph) + out * math.sin(ph)
            Jn = J + dvec * (LEN[k] * s)
            rA, rS, rh = (x * sw for x in R_PH[k])
            # palmar side of a flexed phalanx faces the inside of the curl (toward the hero)
            pref = UP * math.cos(ph - math.pi / 2) + out * math.sin(ph - math.pi / 2)
            pref = -pref if float(np.dot(pref, out)) > 0 else pref
            kind = "tip" if k == 2 else "p"
            pr, hd = seg_bone(f"{nm}_{k}", J, Jn, rA, rS, rh, kind, pref=pref, prev=prev,
                              lat=(1.10, 1.04, 1.06), palm=0.86, bow=0.018 if k < 2 else 0.0, seed=30 + i * 5 + k,
                              big=(k == 0), tip_len=0.45)
            S.add(pr, k=0.0)
            if k < 2:
                JOINTS.append((Jn.copy(), 0.065 * sw * (1 - 0.18 * k)))
            else:
                TIPS.append(Jn.copy())
            J, prev = Jn, hd

    # --- thumb: set apart on the radial side. Its metacarpal leaves the trapezium out (+X) and up the slope, well clear of
    #     the index (wide first web space); the two phalanges rise and hook IN toward the hero (opposed, pad facing the fingers)
    t0 = blk(0.215, 0.006, 0.030)
    t1, t2, t3 = V(0.570, 1.060, 0.500), V(0.745, 1.370, 0.445), V(0.665, 1.625, 0.275)
    opp = V(-0.80, 0.05, -0.55)
    pr, hd = seg_bone("mc_thumb", t0, t1, 0.066, 0.048, 0.078, "mc", pref=tuple(opp), lat=(1.18, 1.14, 1.04),
                      palm=0.84, bow=0.02, seed=60, big=True)
    S.add(pr, k=0.0)
    JOINTS.append((t1.copy(), 0.08))
    pr, hd = seg_bone("thumb_0", t1, t2, 0.084, 0.058, 0.066, "p", pref=tuple(opp), prev=hd, lat=(1.10, 1.04, 1.06),
                      palm=0.86, bow=0.02, seed=61, big=True)
    S.add(pr, k=0.0)
    JOINTS.append((t2.copy(), 0.065))
    pr, _ = seg_bone("thumb_1", t2, t3, 0.066, 0.042, 0.044, "tip", pref=tuple(opp), prev=hd, lat=(1.08, 1.04, 1.1),
                     palm=0.86, bow=0.0, seed=62, tip_len=0.5)
    S.add(pr, k=0.0)
    TIPS.append(t3.copy())

    # --- carpals: 8 SMALL interlocking bones in two staggered rows at the heel (block ~0.38 x 0.24, r12 was 0.73 x 0.45),
    #     tilted with the proximal palm; flat contact planes -> straight crease lines, domed palmar faces
    C = [  # name, (u lateral, v palmar, w along), half extents (lat, palmar, along), euler deg, seed
        ("trapezium",  (0.172, 0.004, 0.040), (0.050, 0.044, 0.050), (0, -26, 8), 1),
        ("trapezoid",  (0.086, 0.010, 0.056), (0.036, 0.042, 0.044), (4, -6, 0), 2),
        ("capitate",   (0.002, 0.002, 0.044), (0.044, 0.048, 0.066), (-3, 4, 2), 3),
        ("hamate",     (-0.100, 0.008, 0.052), (0.050, 0.046, 0.050), (6, 14, -4), 4),
        ("scaphoid",   (0.092, 0.000, -0.058), (0.060, 0.040, 0.046), (2, -18, -6), 5),
        ("lunate",     (-0.002, -0.004, -0.064), (0.042, 0.044, 0.048), (-6, 4, 0), 6),
        ("triquetrum", (-0.086, 0.002, -0.054), (0.044, 0.040, 0.044), (8, 16, -4), 7),
    ]
    for nm, (u, v, w), hf, ang, sd in C:
        c = blk(u, v, w)
        Mc = M_BLOCK @ sdf.rot(*ang)
        rb = RoundBox(c, V(hf), Mc, r=min(hf) * 0.42)
        dome = Ellipsoid(c, V(hf) * V(1.30, 1.22, 1.30), Mc)
        S.add(Displace(Inter(rb, dome, k=0.010), 0.0018, 11.0, octaves=2, seed=sd), k=0.0)
        JOINTS.append((c, 0.04))
    # hidden core under the carpal seams (fills the enclosed air pockets where three blocks meet; the seams stay creases)
    S.add(RoundBox(blk(0.025, -0.004, 0.015), (0.165, 0.022, 0.095), M_BLOCK, r=0.015), k=0.0)
    # pisiform: the small pea bone sitting ON the triquetrum (palmar side)
    S.add(Displace(Ellipsoid(blk(-0.096, 0.050, -0.050), (0.030, 0.024, 0.032), M_BLOCK), 0.0015, 12.0, seed=8), k=0.006)
    # proximal-row envelope: the forearm bones' articular ends are cupped around it with a joint gap
    wrist_env = RoundBox(blk(0.0, -0.004, -0.060), (0.175, 0.052, 0.058), M_BLOCK, r=0.035)

    # --- forearm: radius (thumb side, broad distal end + styloid) and ulna (little-finger side, round head) CLOSE together,
    #     dropping almost straight down from the heel of the hand into the barrow heap (no splay)
    ra0, ra1 = blk(0.072, -0.010, -0.128), V(0.050, 0.020, 1.230)
    ul0, ul1 = blk(-0.088, -0.006, -0.124), V(-0.110, 0.020, 1.205)
    pr = Union(Bone(ra0, ra1, 0.074, 0.050, 0.056, pref=(0, 0.25, 1), lat=(1.42, 1.14, 1.08), palm=0.90, bow=-0.008,
                    fa=0.22, fb=0.25, capA=0.5, capB=0.8),
               RoundCone(ra0 + V(0.075, 0.000, 0.0), ra0 + V(0.098, -0.050, 0.010), 0.026, 0.014), k=0.010)  # radial styloid
    BIG.append(("radius", pr.prims[0]))
    S.add(Diff(Displace(pr, 0.003, 7.0, octaves=3, seed=70), Offset(wrist_env, G_JOINT), k=0.003), k=0.0)
    pr = Union(Bone(ul0, ul1, 0.054, 0.042, 0.052, pref=(0, 0.25, 1), lat=(1.08, 1.04, 1.06), palm=0.94, bow=0.008,
                    fa=0.20, fb=0.30, capA=0.8, capB=0.8),
               RoundCone(ul0 + V(-0.046, -0.004, 0.0), ul0 + V(-0.054, -0.040, 0.008), 0.020, 0.012), k=0.012)  # ulnar styloid
    BIG.append(("ulna", pr.prims[0]))
    S.add(Diff(Displace(pr, 0.003, 7.0, octaves=3, seed=73), Offset(wrist_env, G_JOINT), k=0.003), k=0.0)
    # cartilage / ligament cores across the wrist gap (as at the finger joints): a shadowed groove, one connected mesh
    for u_ in (0.060, -0.075):
        S.add(RoundCone(blk(u_, -0.012, -0.090), blk(u_, -0.016, -0.150), 0.026, 0.028), k=0.0)
    JOINTS.append((ra0, 0.09)); JOINTS.append((ul0, 0.07))

    # --- real cracks + chips on the big bones (fine hairline cracks / pores are node-side in the normal bake)
    crng = np.random.default_rng(5)
    for nm, b in BIG:
        n_cr = 2 if nm in ("radius", "ulna") else 1
        for _ in range(n_cr):
            t0_, t1_ = crng.uniform(0.28, 0.45), crng.uniform(0.55, 0.78)
            a0 = crng.uniform(-math.pi, math.pi)
            if isinstance(b, CurveBone):   # metacarpals: keep cracks on the exposed top (the web is fused below the sides)
                a0 = a0 * 0.30
            a1 = a0 + crng.uniform(-1.2, 1.2) * (0.5 if isinstance(b, CurveBone) else 1.0)
            pts = []
            for j in range(9):
                f = j / 8
                tt = t0_ + (t1_ - t0_) * f
                ang = a0 + (a1 - a0) * f + crng.uniform(-0.18, 0.18)
                pts.append(b.surface(tt, ang, out=0.002)[0])
            w = 0.0055 if nm in ("radius", "ulna") else 0.0045
            S.sub(Chain(pts, [w * (0.4 + 0.6 * math.sin(math.pi * (j / 8)) + 0.2) for j in range(9)]), k=0.002)
        if not nm.startswith(("mc_", "radius", "ulna")):
            continue
        for _ in range(2 if nm in ("radius", "ulna") else 1):
            tt = crng.uniform(0.30, 0.70)
            ang = crng.uniform(-math.pi, math.pi) * (0.35 if isinstance(b, CurveBone) else 1.0)
            p, n = b.surface(tt, ang)
            rc = b.frame_at(tt)[1] * crng.uniform(0.40, 0.55)
            tan = norm(np.cross(n, b.e0))
            M = np.stack([tan, np.cross(n, tan), n], axis=1)
            S.sub(Ellipsoid(p + n * (rc * 0.10), (rc, rc * 0.75, rc * 0.20), M), k=0.003)
    return S


# ----------------------------------------------------------------------------------------------------------- probes
def probe(S):
    """Palm-top height under the hero's feet + bounds sanity (the hero must stand ON the bone)."""
    out = {}
    pts = []
    for dx in (-0.16, -0.08, 0.0, 0.08, 0.16):
        for dz in (-0.14, -0.05, 0.05, 0.14):
            pts.append((HERO[0] + dx, HERO[1] + dz))
    ys = np.linspace(1.4, 0.95, 451)
    tops = []
    for (x, z) in pts:
        P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
        d = S.dist(P)
        hit = np.nonzero(d < 0)[0]
        tops.append(float(ys[hit[0]]) if len(hit) else None)
    good = [t for t in tops if t is not None]
    out["palm_top_under_feet"] = dict(min=min(good) if good else None, max=max(good) if good else None,
                                      mean=float(np.mean(good)) if good else None, holes=sum(t is None for t in tops),
                                      target=TOP)
    return out


# ----------------------------------------------------------------------------------------------------------- preview path
def sdf_ao(S, P, N):
    occ = np.zeros(len(P))
    wsum = 0.0
    for h, w in ((0.012, 1.0), (0.03, 0.8), (0.06, 0.6), (0.11, 0.45), (0.18, 0.3)):
        d = np.empty(len(P))
        for i in range(0, len(P), 150000):
            d[i:i + 150000] = S.dist(P[i:i + 150000] + N[i:i + 150000] * h)
        occ += w * np.clip(h - d, 0, None) / h
        wsum += w
    return np.clip(1 - 1.2 * occ / wsum, 0, 1)


def mesh_normals(V_, F):
    fn = np.cross(V_[F[:, 1]] - V_[F[:, 0]], V_[F[:, 2]] - V_[F[:, 0]])
    N = np.zeros_like(V_)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)


def write_glb_vc(path, G, GN, C, idx):
    def pad(b, ch=b"\0"):
        return b + ch * ((-len(b)) % 4)
    pos, nrm, col, ind = G.tobytes(), GN.tobytes(), C.tobytes(), idx.tobytes()
    binb = pad(pos) + pad(nrm) + pad(col) + pad(ind)
    o1 = len(pad(pos)); o2 = o1 + len(pad(nrm)); o3 = o2 + len(pad(col))
    js = {"asset": {"version": "2.0", "generator": "build_ui_hand_sculpt.py --preview"}, "scene": 0,
          "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "ui_skeletal_hand"}],
          "meshes": [{"name": "ui_skeletal_hand", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
          "materials": [{"name": "bone", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.88}}],
          "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(G), "type": "VEC3", "min": G.min(0).tolist(), "max": G.max(0).tolist()},
                        {"bufferView": 1, "componentType": 5126, "count": len(G), "type": "VEC3"},
                        {"bufferView": 2, "componentType": 5126, "count": len(G), "type": "VEC3"},
                        {"bufferView": 3, "componentType": 5125, "count": int(idx.size), "type": "SCALAR"}],
          "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
                          {"buffer": 0, "byteOffset": o1, "byteLength": len(nrm), "target": 34962},
                          {"buffer": 0, "byteOffset": o2, "byteLength": len(col), "target": 34962},
                          {"buffer": 0, "byteOffset": o3, "byteLength": len(ind), "target": 34963}],
          "buffers": [{"byteLength": len(binb)}]}
    jb = pad(json.dumps(js, separators=(",", ":")).encode(), b" ")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<I4s", len(jb), b"JSON")); f.write(jb)
        f.write(struct.pack("<I4s", len(binb), b"BIN\0")); f.write(binb)


def preview_main(out, h):
    t0 = time.time()
    S = build_sculpt()
    print(f"[hand] sculpt {len(S.ops)} ops", flush=True)
    print("[hand] probe", json.dumps(probe(S)), flush=True)
    v, q, t = sdf.polygonize(S, h, log=lambda m: print(m, flush=True))
    F = np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]], t], 0) if len(q) else t
    Vv = v.astype(np.float64)
    N = mesh_normals(Vv, F)
    ao = sdf_ao(S, Vv, N)
    # quick look-dev colour (the release bake replaces all of this): ivory-brown, AO-darkened
    base = np.array([0.50, 0.40, 0.27])
    n = sdf.fbm(Vv[:, 0], Vv[:, 1], Vv[:, 2], 3, 6.0, seed=4)
    c = base[None, :] * (0.25 + 0.75 * ao[:, None] ** 1.3) * (0.92 + 0.12 * n)[:, None]
    c = np.clip(c, 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    write_glb_vc(out, v.astype(np.float32), N.astype(np.float32), lin.astype(np.float32), F.astype(np.uint32))
    print(f"[hand] preview {len(F)} tris -> {out} ({os.path.getsize(out)/1e6:.2f} MB) {time.time()-t0:.1f}s; bounds {Vv.min(0).round(3)} {Vv.max(0).round(3)}", flush=True)


# ----------------------------------------------------------------------------------------------------------- Blender path
def p_handbone(c, pal):
    """Aged ivory-brown bone, matte. P is in the JS frame (Y up). Value kept LOW: the heroes must out-shine the bones."""
    from lib import shaders as SH
    P, N = c.P, c.N
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    n1 = c.noise(3.2, 3, 201)
    n2 = c.noise(9.0, 3, 202)
    n3 = c.noise(26.0, 2, 203)
    base, hi, grime = pal["base"], pal["hi"], pal["grime"]
    rgb = SH.mix(base, pal["base2"], SH.smooth01(n1, -0.35, 0.45))
    rgb = rgb * (0.90 + 0.10 * n2 + 0.05 * n3)[:, None]
    # joints: brown marrow / grave-dust staining soaking out of every articulation
    jd = np.full(c.n, 9.0)
    for (jc, jr) in JOINTS:
        jd = np.minimum(jd, np.linalg.norm(P - jc[None, :], axis=1) / jr)
    joint = 1 - SH.smooth01(jd, 0.75, 1.9)
    rgb = SH.mix(rgb, pal["stain"], np.clip(joint * (0.55 + 0.35 * SH.smooth01(n2, -0.3, 0.5)), 0, 0.85))
    # broad patina patches
    rgb = SH.mix(rgb, pal["stain"] * 1.15, 0.45 * SH.smooth01(c.noise(5.0, 3, 204), 0.15, 0.55))
    # cavities: packed grime; worn convex highs: paler ivory
    rgb = SH.mix(rgb, grime, np.clip(SH.smooth01(c.cav, 0.03, 0.45) * 0.95, 0, 0.95))
    rgb = SH.mix(rgb, hi, np.clip(0.55 * c.ridge * (0.6 + 0.4 * SH.smooth01(n2, -0.2, 0.4)), 0, 0.6))
    # hairline crack network in patches (dark lines), fine pits
    cr = np.exp(-(c.noise(17.0, 2, 205) / 0.045) ** 2) * SH.smooth01(c.noise(2.5, 2, 206), 0.0, 0.35)
    rgb = SH.mix(rgb, grime * 0.7, np.clip(cr * 0.85, 0, 0.85))
    pit = SH.smooth01(c.noise(70.0, 1, 207), 0.55, 0.75)
    rgb = SH.mix(rgb, grime, 0.5 * pit)
    # moss: in hollows and on up-facing surfaces, low on the hand + clumps at the joints; lichen flecks on top faces
    up = np.clip(N[:, 1], 0, 1)
    mz = SH.smooth01(c.noise(6.5, 3, 208), 0.05, 0.42)
    moss = np.clip(mz * (0.75 * SH.smooth01(c.cav, 0.0, 0.3) + 0.6 * up ** 2 * (0.4 + 0.6 * joint) + 0.35 * (Y < 0.70)), 0, 0.85)
    rgb = SH.mix(rgb, SH.mix(pal["moss"], pal["moss2"], SH.smooth01(n3, -0.3, 0.6)), moss)
    lich = SH.smooth01(c.noise(14.0, 2, 209), 0.52, 0.66) * up ** 1.5 * (1 - moss)
    rgb = SH.mix(rgb, pal["lichen"], 0.55 * lich)
    # soot: fingertips (the braziers stand between the hands), the lateral faces, ash + earth low on the forearm
    td = np.full(c.n, 9.0)
    for tp in TIPS:
        td = np.minimum(td, np.linalg.norm(P - tp[None, :], axis=1))
    soot = 0.65 * (1 - SH.smooth01(td, 0.05, 0.30)) + 0.30 * np.clip(np.abs(N[:, 0]) - 0.45, 0, 1) * SH.smooth01(n2, -0.1, 0.5)
    soot = soot + 0.55 * (1 - SH.smooth01(Y, 0.30, 0.85)) * (Z > 1.0)
    rgb = SH.mix(rgb, pal["soot"], np.clip(soot, 0, 0.8))
    # C2 r13: the recessed web between the metacarpal shafts = dried tissue packed with barrow dirt (dark, matte, crumbly)
    dirt = np.clip(c.paint("dirt"), 0, 1)
    earth = SH.mix(pal["earth"], pal["earth2"], SH.smooth01(c.noise(19.0, 3, 210), -0.3, 0.5))
    earth = SH.mix(earth, pal["moss"] * 0.8, 0.35 * SH.smooth01(c.noise(7.0, 2, 211), 0.2, 0.6))
    rgb = SH.mix(rgb, earth, 0.92 * dirt)
    rough = np.clip(0.84 - 0.16 * c.ridge + 0.08 * moss + 0.04 * n2 + 0.2 * dirt, 0.55, 0.97)
    return SH.out(c.n, np.clip(rgb, 0, 1), rough)


def add_micro(m):
    """Node-side micro detail on the HI bake material: pores + a sparse hairline crack network -> bump in the normal pass,
    matching darkening in the albedo pass (object coords, hand units)."""
    nt = m.node_tree
    N = nt.nodes
    tc = N.new("ShaderNodeTexCoord")
    vor = N.new("ShaderNodeTexVoronoi"); vor.feature = "DISTANCE_TO_EDGE"; vor.inputs["Scale"].default_value = 11.0
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    wn = N.new("ShaderNodeTexNoise"); wn.inputs["Scale"].default_value = 4.0; wn.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], wn.inputs["Vector"])
    # warp the voronoi lookup a little so cracks wander
    mix = N.new("ShaderNodeVectorMath"); mix.operation = "MULTIPLY_ADD"
    nt.links.new(wn.outputs["Color"], mix.inputs[0]); mix.inputs[1].default_value = (0.06, 0.06, 0.06)
    nt.links.new(tc.outputs["Object"], mix.inputs[2])
    nt.links.new(mix.outputs[0], vor.inputs["Vector"])
    crk = N.new("ShaderNodeMapRange"); crk.inputs["From Min"].default_value = 0.0; crk.inputs["From Max"].default_value = 0.018
    crk.inputs["To Min"].default_value = 0.0; crk.inputs["To Max"].default_value = 1.0
    nt.links.new(vor.outputs["Distance"], crk.inputs["Value"])          # 0 in the crack, 1 off it
    gate = N.new("ShaderNodeTexNoise"); gate.inputs["Scale"].default_value = 2.2
    nt.links.new(tc.outputs["Object"], gate.inputs["Vector"])
    gmr = N.new("ShaderNodeMapRange"); gmr.inputs["From Min"].default_value = 0.48; gmr.inputs["From Max"].default_value = 0.62
    nt.links.new(gate.outputs["Fac"], gmr.inputs["Value"])              # crack patches
    inv = N.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(crk.outputs["Result"], inv.inputs[1])
    cm = N.new("ShaderNodeMath"); cm.operation = "MULTIPLY"
    nt.links.new(inv.outputs[0], cm.inputs[0]); nt.links.new(gmr.outputs["Result"], cm.inputs[1])   # crack mask 0..1
    pore = N.new("ShaderNodeTexNoise"); pore.inputs["Scale"].default_value = 140.0; pore.inputs["Detail"].default_value = 2.0
    nt.links.new(tc.outputs["Object"], pore.inputs["Vector"])
    grain = N.new("ShaderNodeTexNoise"); grain.inputs["Scale"].default_value = 38.0; grain.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], grain.inputs["Vector"])
    hgt = N.new("ShaderNodeMath"); hgt.operation = "MULTIPLY_ADD"
    nt.links.new(pore.outputs["Fac"], hgt.inputs[0]); hgt.inputs[1].default_value = 0.35
    nt.links.new(grain.outputs["Fac"], hgt.inputs[2])
    h2 = N.new("ShaderNodeMath"); h2.operation = "MULTIPLY_ADD"
    nt.links.new(cm.outputs[0], h2.inputs[0]); h2.inputs[1].default_value = -1.2
    nt.links.new(hgt.outputs[0], h2.inputs[2])
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.9; bump.inputs["Distance"].default_value = 0.0035
    nt.links.new(h2.outputs[0], bump.inputs["Height"])
    for nm in ("P_normal", "P_look"):
        bs = N.get(nm)
        if bs is not None:
            nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    # albedo: darken in the cracks
    ea = N.get("P_albedo")
    src = ea.inputs["Color"].links[0].from_socket
    mm = N.new("ShaderNodeMix"); mm.data_type = "RGBA"; mm.blend_type = "MULTIPLY"
    nt.links.new(cm.outputs[0], mm.inputs["Factor"])
    nt.links.new(src, mm.inputs[6]); mm.inputs[7].default_value = (0.32, 0.26, 0.2, 1.0)
    nt.links.new(mm.outputs[2], ea.inputs["Color"])


def export_glb(path, ob):
    from lib import meshutil
    meshutil.select_only([ob], ob)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=False, export_apply=False,
              export_animations=False, export_texcoords=True, export_normals=True, export_tangents=False,
              export_materials="EXPORT", export_image_format="WEBP", export_image_quality=88, export_extras=False,
              export_vertex_color="NONE", export_skins=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        for k in ("export_vertex_color", "export_image_quality"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)


def blender_main(args):
    from lib import pipeline, meshutil, shaders, charkit
    import importlib
    for m_ in (sdf, pipeline, meshutil, shaders, charkit):
        importlib.reload(m_)
    T0 = time.time()
    fast = "--fast" in args
    out = OUT_GLB
    if "--out" in args:
        out = args[args.index("--out") + 1]
    res = 1024 if fast else 2048
    h_hi, h_lo = (0.007, 0.010) if fast else (0.0036, 0.0075)
    meshutil.clear_scene()
    dev = pipeline.setup_cycles("AUTO")
    S = build_sculpt()
    rep = {"device": dev, "fast": fast, "res": res, "ops": len(S.ops), "probe": probe(S)}
    pipeline.log("probe " + json.dumps(rep["probe"]))
    t = time.time()
    hi = pipeline.sculpt_mesh(S, "hand_hi", h_hi)
    charkit.drop_islands(hi, h_hi)
    rep["hi_tris"] = meshutil.tri_count(hi)
    pipeline.log(f"HI {rep['hi_tris']} tris {time.time()-t:.0f}s")
    t = time.time()
    lo = pipeline.lowpoly(S, "hand_lo", h_lo, TRIS, symmetry=False, clean=lambda o: charkit.drop_islands(o, h_lo))
    lo.data.validate()
    rep["lo_tris"] = meshutil.tri_count(lo)
    rep["geom_qa"] = charkit.geom_qa(lo)
    pipeline.log(f"LO {rep['lo_tris']} tris {time.time()-t:.0f}s")
    t = time.time()
    charkit.smart_uv(lo, 66.0, 1.0)
    rep["uv_fill"] = pipeline.pack_atlas_shape([lo], margin_px=6 if not fast else 4, res=res)
    pipeline.log(f"UV {time.time()-t:.0f}s")
    shaders.assign_bake_materials(hi, S.materials, prefix="bk_hand_", kinds={"bone": "nail"})
    for m in hi.data.materials:
        add_micro(m)
    srgb = shaders.srgb
    pal = dict(base=srgb(96, 90, 76), base2=srgb(82, 78, 66), hi=srgb(138, 133, 116), grime=srgb(26, 24, 21),
               stain=srgb(70, 60, 46), moss=srgb(50, 60, 34), moss2=srgb(70, 78, 44), lichen=srgb(116, 118, 98),
               soot=srgb(23, 22, 21), earth=srgb(34, 30, 25), earth2=srgb(50, 43, 33))
    shaders.paint_mesh(hi, S.materials, {}, pal, {}, painters={"bone": p_handbone})
    for o in (hi, lo):
        pipeline.set_ray_visibility(o, False)
    B = pipeline.Baker(res, [(lo, [hi], 0.02, 0.05)], shaders.set_pass, [lo], [hi])
    t = time.time()
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 64),
                         ("normal", "NORMAL", 4 if fast else 8)])
    pipeline.log(f"bakes {time.time()-t:.0f}s")
    tex = charkit.composite_maps(maps, OUT_TEX, "ui_skeletal_hand", tint=(0.20, 0.19, 0.17))
    mat = pipeline.final_material("M_ui_skeletal_hand", tex["albedo"], tex["normal"], tex["orm"])
    lo.data.materials.clear()
    lo.data.materials.append(mat)
    pipeline.strip_for_export(lo)
    lo.name = "ui_skeletal_hand"
    lo.data.name = "ui_skeletal_hand"
    for p_ in lo.data.polygons:
        p_.use_smooth = True
    bpy.data.objects.remove(hi, do_unlink=True)
    export_glb(out, lo)
    rep["glb"] = out
    rep["glb_mb"] = os.path.getsize(out) / 1e6
    rep["seconds"] = time.time() - T0
    pipeline.write_json(REPORT, rep)
    pipeline.log(f"DONE {out} {rep['glb_mb']:.2f} MB {rep['lo_tris']} tris {rep['seconds']:.0f}s")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if not HAVE_BPY or "--preview" in argv:
        pos = [a for a in argv if not a.startswith("--")]
        h = float(argv[argv.index("--h") + 1]) if "--h" in argv else 0.01
        pos = [a for a in pos if a != str(h) and not a.replace(".", "").isdigit()]
        preview_main(pos[0] if pos else os.path.join(ROOT, "progress", "tmp", "hands_r13", "wip.glb"), h)
    else:
        blender_main(argv)
