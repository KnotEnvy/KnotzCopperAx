"""C2 r16: continuous bone palm, tapered asymmetric digits, cortical grain and foramina.

Select-screen giant skeletal hand, C2 r11: SCULPTED (SDF bones -> hi-poly -> decimated game mesh -> baked maps).

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

C2 r14 (board r13: "fingers = chains of separate bone sausages with dark GAPS, arcing into a closed RING behind the hero;
uniform matte grey"): CONTINUOUS digits (phalanx(): mild waist, each base overlaps the previous head -> hard-union crease +
a fine CreaseRing, tapering bone to bone into a small rounded tuft); the fingers FAN out to the sides and curl FORWARD
toward the camera (open cup, no hoop); a stout thumb leaves the heel low on the camera side and turns up/in toward the
hero; the earth web stays only under the feet (floor shows between the metacarpals toward the heel); warm aged-ivory
albedo with a per-bone tint/value, paler knuckle tops, darker deck + joints. The preview path paints with the same painter.

C2 r15 (board r14: "a fan of long uniform rods splayed ~150 deg; no palm mass, the heroes stand among the fingertips - the
hands do not CRADLE the heroes"): CRADLE layout. Four broad, rounded metacarpals packed side by side (dark earth seams ~5 cm
below their tops) form a PALM PLATFORM under the boots, from a bigger carpal heel in front of the hero (a step lower, the
forearm dropping from it into the heap) back to a ring of knuckles ~0.58 hu round the hero's feet. Each finger rises from
its knuckle leaning a little out, then the middle + distal phalanges hook IN toward the hero (tips 0.74-0.89 m above the
feet, ~0.34 m from the hero's axis: knee-to-hip, behind/beside the legs, never across the torso); the thumb leaves the heel
at the front radial corner, low on the camera side, and turns up + in. Rounded condyle heads ~1.4x the waisted shafts,
tapering bone to bone (still continuous: base overlaps head, crease ring).

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
OUT_TEX = os.path.join(ROOT, "progress", "tmp", "hands_r16", "tex")
REPORT = os.path.join(HERE, "out", "ui_hand_sculpt_report.json")

TOP = 1.216            # palm top surface under the hero's feet (select3d: PALM_Y / HAND_SCALE - HAND_DROP / HAND_SCALE)
HERO = (-0.035, 0.09)  # hero foot centre (x, z) in hand space (all three hands, within a few cm)
K_JOINT = 0.004        # bone-to-bone union: a tight crease, never a blob
TRIS = 34000

UP = V(0, 1, 0)
JOINTS = []            # (centre, radius) of every articulation: stains / grime in the painter
TIPS = []              # distal tips: soot
BIG = []               # (name, Bone) bones big enough for real cracks / chips
BONES = []             # C2 r14: (name, a, b, r) segment of every bone -> per-bone ivory tint in the painter
KNUCK = []             # C2 r14: (centre, radius, dorsal dir) of every knuckle top -> paler worn ivory


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
                 capA=1.0, capB=1.0, twist=0.0, taper=0.0):
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
        self.taper = float(taper)
        R = max(rA, rS, rB) * max(max(self.lat), 1.0) * max(capA, capB, 1.0) + abs(bow) * self.L + 0.01
        self.lo = np.minimum(self.a, self.b) - R
        self.hi = np.maximum(self.a, self.b) + R
        self.lip = min(min(self.lat), self.palm, capA, capB, 1.0)

    def frame_at(self, t):
        """centre, radius, lateral scale at parameter t (for placing cracks / chips / tubercles on the surface)."""
        wA, wB = 1 - sst(0, self.fa, t), sst(1 - self.fb, 1, t)
        shaft = self.rS * (1 + self.taper * (1 - 2 * t))
        r = shaft + (self.rA - shaft) * wA + (self.rB - shaft) * wB
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
        shaft = self.rS * (1 + self.taper * (1 - 2 * tc))
        r = shaft + (self.rA - shaft) * wA + (self.rB - shaft) * wB
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


class CreaseRing(Prim):
    """C2 r14: a fine articular crease ring around a bone (elliptic section like Bone: lateral `la`, palmar flattening
    `dv`), subtracted where a base meets the previous head -> a crisp joint LINE (no gap, nothing see-through)."""

    def __init__(self, c, e0, e1, e2, R, la, dv, r):
        self.c, self.e0, self.e1, self.e2 = V(c), V(e0), V(e1), V(e2)
        self.R, self.la, self.dv, self.r = float(R), float(la), float(dv), float(r)
        ext = R * max(la, 1.0) + r + 0.01
        self.lo, self.hi = self.c - ext, self.c + ext

    def d(self, X, Y, Z):
        dx, dy, dz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        ax = dx * self.e0[0] + dy * self.e0[1] + dz * self.e0[2]
        v = dx * self.e1[0] + dy * self.e1[1] + dz * self.e1[2]
        u = dx * self.e2[0] + dy * self.e2[1] + dz * self.e2[2]
        dv = np.where(v > 0, self.dv, 1.0)
        q = np.sqrt((u / self.la) ** 2 + (v / dv) ** 2) - self.R
        return np.sqrt(q * q + (ax * 1.6) ** 2) - self.r


J_TIGHT = 0.0           # C2 r14: knuckles are HARD-unioned (base overlaps the head) -> a crease, never a gap


def phalanx(name, J0, J1, rA, rS, rB, pref, prev_rB=None, kind="p", lat=(1.08, 1.03, 1.07), palm=0.88, seed=0,
            tip_r=None, bow=0.012, big=False):
    """C2 r14 (board r13: "chains of separate bone sausages / ball-jointed bamboo with dark GAPS between the phalanges and
    blunt widened ends"): one phalanx of a CONTINUOUS digit. Mild waist (shaft ~0.8 of the ends), the base flare starts
    INSIDE the previous bone's head (it overlaps it; hard union -> a tight crease ring where the concave base meets the
    convex head, no gap), the head a low condyle swell (bicondylar groove on the palmar face only), and the distal
    phalanx tapers into a small rounded tuft (no spade, no widened cap). Bones get thinner bone by bone toward the tip."""
    J0, J1 = V(J0), V(J1)
    e0, e1, e2 = bone_frame(J1 - J0, pref)
    M = frame_M(e0, e1, e2)
    L = float(np.linalg.norm(J1 - J0))
    a = J0 + e0 * (0.40 * prev_rB) if prev_rB else J0
    if kind == "tip":
        b = J1 - e0 * (0.55 * tip_r)
        rBe = tip_r
    else:
        b = J1
        rBe = rB * 0.90
    sh = Bone(a, b, rA, rS, rBe, pref=pref, lat=lat, palm=palm, bow=bow, fa=0.42, fb=0.19 if kind != "tip" else 0.28,
              capA=0.72, capB=0.75, taper=0.23)
    parts = [sh]
    head = None
    if kind == "p":
        hr = (rB * lat[2], rB * 0.88, rB * 0.80)
        hd = Ellipsoid(J1 + e2 * (0.17 * rB) - e1 * (0.08 * rB), hr, M)
        # shallow trochlear groove across the PALMAR face only (two condyles underneath; the dorsal knuckle stays smooth)
        groove = RoundCone(J1 + e0 * (0.70 * rB) + e1 * (0.55 * rB), J1 - e0 * (0.10 * rB) + e1 * (1.05 * rB),
                           0.11 * rB, 0.15 * rB)
        parts.append(Diff(hd, groove, k=0.004))
        head = rB
    else:
        # distal tuft: barely wider than the shaft just behind it, rounded, flattened palmar-dorsal; no hooked spike
        tc = J1 - e0 * (0.45 * tip_r)
        parts.append(Ellipsoid(tc, (1.16 * tip_r, 0.72 * tip_r, 0.95 * tip_r), M))
        parts.append(RoundCone(tc - e0 * (0.2 * tip_r), J1 + e1 * (0.18 * tip_r), 0.70 * tip_r, 0.34 * tip_r,
                               squash=(1.0, 0.8), ref=tuple(e1)))
    # low palmar tubercles either side of the base (they make the base read as the concave receiving end)
    for s in (-1, 1):
        parts.append(Ellipsoid(a + e0 * (0.10 * rA) + e2 * (s * 0.55 * rA * lat[0]) + e1 * (0.42 * rA),
                               ((0.27 if s < 0 else 0.19) * rA, 0.22 * rA, 0.39 * rA), M))
    pr = Union(*parts, k=0.010 * (rS / 0.06) ** 0.5)
    pr = Displace(pr, 0.0018, 8.0, octaves=3, seed=seed)
    if prev_rB:
        # fine crease where this base meets the previous head (reads as articulation at 2x, never as a gap at 1x)
        cr = CreaseRing(J0 + e0 * (0.40 * prev_rB - 0.30 * rA), e0, e1, e2, 0.90 * rA, lat[0], palm, 0.0055)
        pr = Diff(pr, Inter(cr, Ellipsoid(J0 + e1 * rA, (2*rA, rA, 2*rA))), k=0.002)
    pr.bone = sh
    BONES.append((name, a - e0 * (0.3 * rA), J1, 0.5 * (rA + rS)))
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
# C2 r15 layout (board r14: "a fan of long uniform rods splayed ~150 deg converging on a tiny carpal cluster; no palm mass,
# the heroes stand on the deck among the fingertips - the hands do not CRADLE the heroes"). Hand units, +Z toward the camera.
#  * PALM PLATFORM: four broad, flattened metacarpals packed side by side (a dark earth web just below their tops) run from
#    the heel IN FRONT of the hero (carpal block, a step lower) back under the boots to a ring of knuckles AROUND the hero.
#  * CRADLE: the knuckles stand on an arc ~0.58 hu round the hero's feet (index on the thumb side, middle + ring behind, the
#    little finger on the far side); each finger rises from its knuckle leaning a little OUT, then the middle and distal
#    phalanges hook IN toward the hero, so the tips stand at knee-to-hip height around the legs (never across torso/face).
#  * the thumb leaves the heel at the front radial corner, low on the camera side, and turns up and in.
YD = TOP - 0.046                 # metacarpal centre height along the deck (shaft top = TOP under the feet)
SLOPE_A = norm(V(0.0, 0.30, -0.954))   # carpal block "along" axis (wrist -> knuckles): the heel dips toward the camera
SLOPE_N = norm(V(0.0, 0.954, 0.30))    # its palmar normal (up + toward the camera)
EX = V(1.0, 0.0, 0.0)
M_BLOCK = np.stack([EX, SLOPE_N, SLOPE_A], axis=1)    # sdf frame: x lateral, y palmar, z along
CS = 1.18                        # carpal block scale vs r13/r14: a heel that reads as the palm's mass at 1x
CB = V(-0.010, 1.080, 0.680)     # carpal block centre (heel of the hand: in front of the hero, a step below the deck)


def blk(u, v, w):
    """carpal-block local (lateral, palmar, along) -> hand space"""
    return CB + EX * u + SLOPE_N * v + SLOPE_A * w


FINGERS = {
    # knuckle on an arc round the hero: phi (deg, 0 = +X thumb side, 90 = straight behind), radius, height offset;
    # base x on the carpal block; finger scale; per-phalanx LEAN from vertical toward the hero (deg; negative = outward);
    # azimuth twist of the curl plane (deg)
    #          phi    r      dy     base x  scale  P1 / P2 / P3 lean   twist
    "index":  (24.0, 0.58, 0.022, 0.160, 0.95, (-12, 30, 74), 6.0),
    "middle": (66.0, 0.58, 0.010, 0.052, 1.00, (-10, 28, 72), 0.0),
    "ring":   (108.0, 0.58, 0.012, -0.062, 0.96, (-10, 28, 70), 0.0),
    "pinky":  (148.0, 0.56, 0.026, -0.176, 0.84, (-14, 32, 70), -6.0),
}
LEN = (0.39, 0.32, 0.25)        # proximal / middle / distal phalanx (joint centre to joint centre), x finger scale
#        base   shaft  head        C2 r15: rounded condyle heads clearly wider than the waisted shafts, tapering bone to bone
R_PH = ((0.105, 0.062, 0.079),   # proximal phalanx
        (0.083, 0.051, 0.065),   # middle phalanx
        (0.065, 0.039, 0.028))   # distal phalanx (last = tuft radius)
THUMB = dict(knuckle=V(0.540, YD - 0.020, 0.470), lens=(0.36, 0.27), leans=(14, 58), twist=-10.0)


def knuckle(nm):
    phi, r, dy = FINGERS[nm][:3]
    a = math.radians(phi)
    return V(HERO[0] + r * math.cos(a), YD + dy, HERO[1] - r * math.sin(a))


def curl_dirs(J, leans, twist, jit):
    """phalanx directions + palmar refs in the vertical plane through the knuckle and the hero (twisted by `twist`)."""
    u = norm(V(HERO[0] - J[0], 0.0, HERO[1] - J[2]))
    u = rot_about(u, UP, math.radians(twist))
    D, P = [], []
    for k, ln in enumerate(leans):
        p = math.radians(ln + jit[k])
        D.append(norm(UP * math.cos(p) + u * math.sin(p)))
        P.append(norm(-UP * math.sin(p) + u * math.cos(p)))    # inside of the curl = the palmar face
    return D, P


def mc_curve(name, pts, rA, rS, rh, seed, lat=(1.22, 1.22, 1.10), palm=0.92):
    """Metacarpal along a curved centreline pts[0] (carpal base) -> pts[-1] (knuckle centre): broad flattened waisted shaft
    (C2 r15: packed side by side = the palm platform), a round knuckle head with two palmar condyles, a squarish base."""
    sh = CurveBone(pts, rA, rS, rh * 0.72, pref=(0, 1, 0), lat=lat, palm=palm, fa=0.20, fb=0.22, capA=0.6, capB=0.6)
    J1 = V(pts[-1])
    e0, e1, e2 = bone_frame(sh.tangent(True), (0, 1, 0))
    M = frame_M(e0, e1, e2)
    hr = (rh * lat[2], rh * 0.94, rh * 0.98)
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
    for j in range(len(sh.pts) - 1):
        BONES.append((name, sh.pts[j], sh.pts[j + 1], rS * 1.2))
    KNUCK.append((J1.copy(), rh, -e1))
    return pr, Head(J1, hr, M)


class PalmPlate(Prim):
    """Solid bone web, broad at the finger roots and narrowed toward the wrist."""
    def __init__(self):
        self.lo = V(-0.64, TOP - 0.28, -0.59)
        self.hi = V(0.60, TOP + 0.04, 0.74)

    def d(self, X, Y, Z):
        width = 0.56 - 0.29 * sst(0.17, 0.73, Z)
        rho = np.sqrt(((X - HERO[0]) / width)**2 + ((Z - 0.08) / 0.62)**2)
        top = TOP - 0.008 + 0.014 * sst(0.62, 1.0, rho) - 0.14 * sst(0.26, 0.70, Z)
        # Rounded rim, solid thickness. Surface never falls into the floor-coloured web.
        side = (rho - 0.96) * 0.48
        vertical = np.maximum(Y - top + 0.022, top - 0.075 - Y)
        return np.sqrt(np.maximum(side, 0)**2 + np.maximum(vertical, 0)**2) + np.minimum(np.maximum(side, vertical), 0) - 0.022


def build_sculpt():
    JOINTS.clear(); TIPS.clear(); BIG.clear(); BONES.clear(); KNUCK.clear()
    S = Sculpt(materials=("bone",), default_mat="bone")
    rng = np.random.default_rng(15)
    heads, curves = {}, {}

    # --- metacarpals: the PALM PLATFORM - broad flattened shafts from the heel (front) back under the boots to the knuckles
    for i, (nm, (phi, rk, dy, xb, s, _, _)) in enumerate(FINGERS.items()):
        sw = s ** 0.5
        K = knuckle(nm)
        base = blk(xb - CB[0], 0.0, 0.112 * CS)        # on the distal face of the carpal block
        pts = [base]
        for f, yy in ((0.24, YD - 0.020), (0.52, YD - 0.002), (0.78, YD + 0.45 * dy)):
            q = base + (K - base) * f
            pts.append(V(q[0], yy, q[2]))
        pts.append(K)
        pr, hd = mc_curve("mc_" + nm, pts, 0.072 * sw, 0.050 * sw, 0.098 * sw, seed=10 + i)
        S.add(pr, k=0.0)
        heads[nm] = hd
        curves[nm] = pr.bone
        JOINTS.append((base, 0.06 * sw))

    # C2 r16: a continuous ossified palmar plate, not recessed dark earth. The centre
    # supports boots at the existing TOP contract; the gently rising perimeter is a cupped lip.
    # Metacarpals remain visible as fanning relief where they emerge from this bone web.
    S.add(PalmPlate(), k=0.012)

    # Shallow fanning grooves articulate the fused metacarpals without reopening holes.
    names = list(FINGERS)
    for an, bn in zip(names[:-1], names[1:]):
        pts = []
        for t in np.linspace(0.12, 0.90, 18):
            q = (curves[an].frame_at(t)[0] + curves[bn].frame_at(t)[0]) * 0.5
            q[1] = TOP - 0.008 - 0.14 * sst(0.26, 0.70, q[2]) + 0.004
            pts.append(q)
        S.sub(Chain(pts, [0.012 * math.sin(math.pi * (j+1)/19)**0.5 for j in range(18)]), k=0.003)

    # --- fingers: CONTINUOUS digits (3 phalanges, each base overlapping the previous head: tight crease, no gap), rising
    #     from the knuckle ring and hooking IN toward the hero
    for i, (nm, (phi, rk, dy, xb, s, leans, tw)) in enumerate(FINGERS.items()):
        sw = s ** 0.6
        J = heads[nm].c.copy()
        prev_rB = float(heads[nm].r[0]) * 0.92
        JOINTS.append((J.copy(), 0.075 * sw))
        D, Pp = curl_dirs(J, leans, tw, rng.uniform(-2.0, 2.0, 3))
        for k in range(3):
            Jn = J + D[k] * (LEN[k] * s)
            rA, rS, rh = (x * sw for x in R_PH[k])
            kind = "tip" if k == 2 else "p"
            pr, hd = phalanx(f"{nm}_{k}", J, Jn, rA, rS, rh, tuple(Pp[k]), prev_rB=prev_rB, kind=kind,
                             seed=30 + i * 5 + k, tip_r=rh if kind == "tip" else None, big=(k == 0))
            S.add(pr, k=J_TIGHT)
            if k < 2:
                JOINTS.append((Jn.copy(), 0.055 * sw * (1 - 0.15 * k)))
                KNUCK.append((Jn.copy(), rh, -Pp[k]))
            else:
                TIPS.append(Jn.copy())
            J, prev_rB = Jn, hd

    # --- thumb: leaves the trapezium at the FRONT radial corner of the heel, runs out low on the camera side, then its two
    #     phalanges rise and turn IN toward the hero (lowest digit, pad facing the fingers)
    t0 = blk(0.215 * CS + 0.02, 0.006, 0.030)
    t1 = THUMB["knuckle"]
    D, Pp = curl_dirs(t1, THUMB["leans"], THUMB["twist"], (0.0, 0.0))
    t2 = t1 + D[0] * THUMB["lens"][0]
    t3 = t2 + D[1] * THUMB["lens"][1]
    opp = norm(V(HERO[0], t1[1], HERO[1]) - t1)
    pr, hd = seg_bone("mc_thumb", t0, t1, 0.078, 0.058, 0.094, "mc", pref=tuple(opp), lat=(1.16, 1.10, 1.04),
                      palm=0.86, bow=0.02, seed=60, big=True)
    S.add(pr, k=0.0)
    BONES.append(("mc_thumb", t0, t1, 0.06))
    KNUCK.append((t1.copy(), 0.084, -opp))
    JOINTS.append((t1.copy(), 0.075))
    pr, rb = phalanx("thumb_0", t1, t2, 0.098, 0.068, 0.088, tuple(Pp[0]), prev_rB=float(hd.r[0]) * 0.92, kind="p",
                     seed=61, big=True)
    S.add(pr, k=J_TIGHT)
    JOINTS.append((t2.copy(), 0.06))
    KNUCK.append((t2.copy(), 0.076, -Pp[0]))
    pr, _ = phalanx("thumb_1", t2, t3, 0.080, 0.054, 0.046, tuple(Pp[1]), prev_rB=rb, kind="tip", seed=62, tip_r=0.046)
    S.add(pr, k=J_TIGHT)
    TIPS.append(t3.copy())

    # --- carpals: 8 interlocking bones in two staggered rows at the heel (C2 r15: x1.18, the heel of the palm platform),
    #     tilted with the heel; flat contact planes -> straight crease lines, domed palmar faces
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
        c = blk(u * CS, v * CS, w * CS)
        hf = tuple(x * CS for x in hf)
        Mc = M_BLOCK @ sdf.rot(*ang)
        rb = RoundBox(c, V(hf), Mc, r=min(hf) * 0.42)
        dome = Ellipsoid(c, V(hf) * V(1.42, 1.34, 1.42), Mc)     # C2 r15: boxier, less pebble-like
        S.add(Displace(Inter(rb, dome, k=0.010), 0.0013, 11.0, octaves=2, seed=sd), k=0.0)
        JOINTS.append((c, 0.04 * CS))
        BONES.append((nm, c, c + 1e-4, max(hf)))
    S.add(RoundBox(blk(0.025 * CS, -0.004 * CS, 0.015 * CS), (0.165 * CS, 0.022 * CS, 0.095 * CS), M_BLOCK, r=0.015),
          k=0.0)
    S.add(Displace(Ellipsoid(blk(-0.096 * CS, 0.050 * CS, -0.050 * CS), (0.030 * CS, 0.024 * CS, 0.032 * CS), M_BLOCK),
                   0.0015, 12.0, seed=8), k=0.006)
    wrist_env = RoundBox(blk(0.0, -0.004 * CS, -0.060 * CS), (0.175 * CS, 0.052 * CS, 0.058 * CS), M_BLOCK, r=0.035)

    # --- forearm: radius + ulna close together, dropping steeply from the heel (in front of / below the palm) into the heap
    ra0, ra1 = blk(0.072 * CS, -0.010, -0.128 * CS), V(0.050, 0.020, 1.230)
    ul0, ul1 = blk(-0.088 * CS, -0.006, -0.124 * CS), V(-0.110, 0.020, 1.205)
    pr = Union(Bone(ra0, ra1, 0.080, 0.054, 0.058, pref=(0, 0.25, 1), lat=(1.42, 1.14, 1.08), palm=0.90, bow=-0.008,
                    fa=0.22, fb=0.25, capA=0.5, capB=0.8),
               RoundCone(ra0 + V(0.082, 0.000, 0.0), ra0 + V(0.106, -0.050, 0.010), 0.028, 0.015), k=0.010)  # radial styloid
    BIG.append(("radius", pr.prims[0]))
    S.add(Diff(Displace(pr, 0.003, 7.0, octaves=3, seed=70), Offset(wrist_env, G_JOINT), k=0.003), k=0.0)
    pr = Union(Bone(ul0, ul1, 0.058, 0.045, 0.054, pref=(0, 0.25, 1), lat=(1.08, 1.04, 1.06), palm=0.94, bow=0.008,
                    fa=0.20, fb=0.30, capA=0.8, capB=0.8),
               RoundCone(ul0 + V(-0.050, -0.004, 0.0), ul0 + V(-0.058, -0.040, 0.008), 0.021, 0.012), k=0.012)  # ulnar styloid
    BIG.append(("ulna", pr.prims[0]))
    S.add(Diff(Displace(pr, 0.003, 7.0, octaves=3, seed=73), Offset(wrist_env, G_JOINT), k=0.003), k=0.0)
    for u_ in (0.060 * CS, -0.075 * CS):
        S.add(RoundCone(blk(u_, -0.012, -0.090 * CS), blk(u_, -0.016, -0.150 * CS), 0.028, 0.030), k=0.0)
    JOINTS.append((ra0, 0.09)); JOINTS.append((ul0, 0.07))
    BONES.append(("radius", ra0, ra1, 0.06)); BONES.append(("ulna", ul0, ul1, 0.05))

    # --- real cracks + chips on the big bones (fine hairline cracks / pores are node-side in the normal bake)
    crng = np.random.default_rng(5)
    for nm, b in BIG:
        if nm.startswith("mc_"):  # buried cracks inside the solid plate create enclosed mesh islands
            continue
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
    # Sparse nutrient foramina and long shallow cortical furrows, readable at select scale.
    for bi, (nm, b) in enumerate(BIG):
        if nm.startswith("mc_"):
            continue
        for j, (tt, ang) in enumerate(((0.34, -0.65), (0.60, 1.6), (0.74, -2.3))):
            p, n = b.surface(tt, ang + 0.19 * bi)
            tangent = norm(np.cross(n, b.e0))
            M = np.stack([tangent, b.e0, n], axis=1)
            S.sub(Ellipsoid(p + n * 0.005, (0.011 + j*0.002, 0.025 + j*0.004, 0.012), M), k=0.003)
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
    # C2 r14: the REAL painter (p_handbone, stub maths) x the bake's occlusion tint -> linear vertex colour
    _, _, paints = S.eval_points(Vv)
    rgb, _ = p_handbone(PreviewCtx(Vv, N, ao, paints), palette())
    t_ = np.array(OCC_TINT)
    lin = np.clip(rgb * (t_ + (1 - t_) * ao[:, None] ** 1.2), 0, 1)
    write_glb_vc(out, v.astype(np.float32), N.astype(np.float32), lin.astype(np.float32), F.astype(np.uint32))
    print(f"[hand] preview {len(F)} tris -> {out} ({os.path.getsize(out)/1e6:.2f} MB) {time.time()-t0:.1f}s; bounds {Vv.min(0).round(3)} {Vv.max(0).round(3)}", flush=True)


# ----------------------------------------------------------------------------------------------------------- Blender path
class _SHStub:
    @staticmethod
    def smooth01(x, a, b):
        return sst(a, b, x)

    @staticmethod
    def mix(a, b, t):
        t = np.asarray(t, float)
        if t.ndim == 1:
            t = t[:, None]
        return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t

    @staticmethod
    def out(n, rgb, rough, metal=0.0, emit=0.0):
        return np.broadcast_to(np.asarray(rgb, float), (n, 3)).copy(), rough


def srgb_lin(r, g, b):
    c = np.array([r, g, b], float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def palette():
    # C2 r14: warm AGED IVORY (r12-r13 were grey-ivory 96/90/76; board: "no ivory warmth"), per-bone tints multiply it
    srgb = srgb_lin
    return dict(base=srgb(112, 98, 76), base2=srgb(98, 86, 66), hi=srgb(150, 136, 108), grime=srgb(30, 25, 19),
                stain=srgb(80, 63, 44), moss=srgb(52, 60, 34), moss2=srgb(72, 78, 44), lichen=srgb(118, 116, 92),
                soot=srgb(26, 23, 20), earth=srgb(36, 30, 24), earth2=srgb(54, 44, 32),
                tint_warm=np.array([1.04, 1.00, 0.88]), tint_grey=np.array([0.96, 0.98, 1.00]),
                tint_brown=np.array([1.02, 0.92, 0.80]))


OCC_TINT = (0.24, 0.20, 0.16)   # C2 r14: occlusion darkens toward warm brown (r13 neutral 0.20/0.19/0.17)


class PreviewCtx:
    """Painter context for the slot-free preview: cavity / ridge from the SDF AO (the bake uses mesh curvature)."""

    def __init__(self, P, N, ao, paints):
        self.P, self.N, self.n, self._p = P, N, len(P), paints
        self.cav = np.clip((0.86 - ao) * 2.2, 0, 1)
        self.ridge = np.clip((ao - 0.93) * 8.0, 0, 1)

    def paint(self, name):
        return self._p.get(name, np.zeros(self.n))

    def noise(self, freq, octaves=3, seed=0):
        return sdf.fbm(self.P[:, 0], self.P[:, 1], self.P[:, 2], octaves, freq, seed=seed)


def p_handbone(c, pal):
    """Aged ivory-brown bone, matte. P is in the JS frame (Y up). Value kept LOW: the heroes must out-shine the bones."""
    try:
        from lib import shaders as SH
    except ImportError:          # slot-free preview (no bpy): same maths
        SH = _SHStub
    P, N = c.P, c.N
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    n1 = c.noise(3.2, 3, 201)
    n2 = c.noise(9.0, 3, 202)
    n3 = c.noise(26.0, 2, 203)
    base, hi, grime = pal["base"], pal["hi"], pal["grime"]
    rgb = SH.mix(base, pal["base2"], SH.smooth01(n1, -0.35, 0.45))
    rgb = rgb * (0.88 + 0.28 * n2 + 0.16 * n3)[:, None]
    # C2 r14: per-BONE tint + value (board r13: "uniform matte grey, no tint variation"): every bone gets its own aged
    # ivory - warmer yellow, greyer, or browner - and a +-9 % value step, so the digits read as separate bones of one hand
    if BONES:
        best = np.full(c.n, 1e9); bid = np.zeros(c.n, np.int32)
        grainP = np.zeros_like(P)
        for k, (_, a, b, _r) in enumerate(BONES):
            a, b = V(a), V(b)
            ab = b - a
            tt = np.clip(((P - a[None]) @ ab) / max(float(ab @ ab), 1e-9), 0, 1)
            dd = np.linalg.norm(P - (a[None] + tt[:, None] * ab[None]), axis=1)
            m = dd < best
            best[m] = dd[m]; bid[m] = k
            axis = norm(ab) if np.linalg.norm(ab) > 0.001 else UP
            side = norm(np.cross(axis, V(0.31, 0.12, 0.94)))
            other = np.cross(axis, side)
            grainP[m] = np.stack([(P[m]-a) @ side * 68, (P[m]-a) @ other * 68,
                                   (P[m]-a) @ axis * 7], axis=1)
        brng = np.random.default_rng(1414)
        warm, grey, brown = pal["tint_warm"], pal["tint_grey"], pal["tint_brown"]
        tints = []
        for k in range(len(BONES)):
            w = brng.dirichlet((1.6, 1.0, 0.9))
            tints.append((warm * w[0] + grey * w[1] + brown * w[2]) * brng.uniform(0.91, 1.09))
        tints = np.array(tints)
        rgb = rgb * tints[bid]
        grain = sdf.fbm(grainP[:,0], grainP[:,1], grainP[:,2], 2, 1.0, seed=1616)
        streak = sst(-0.20, 0.42, grain)
        rgb *= (0.64 + 0.62 * streak)[:,None]
        pores = sst(0.20, 0.52, c.noise(46.0, 2, 1620))
        rgb = SH.mix(rgb, grime * 0.55, pores * 0.80)
    # porosity: fine dark pores + a soft mottle (aged bone is never a flat colour)
    por = SH.smooth01(c.noise(110.0, 1, 212), 0.58, 0.80)
    rgb = rgb * (1 - 0.22 * por)[:, None] * (0.95 + 0.08 * SH.smooth01(c.noise(40.0, 2, 213), -0.4, 0.4))[:, None]
    # joints: brown marrow / grave-dust staining soaking out of every articulation
    jd = np.full(c.n, 9.0)
    for (jc, jr) in JOINTS:
        jd = np.minimum(jd, np.linalg.norm(P - jc[None, :], axis=1) / jr)
    joint = 1 - SH.smooth01(jd, 0.75, 1.9)
    rgb = SH.mix(rgb, pal["stain"], np.clip(joint * (0.55 + 0.35 * SH.smooth01(n2, -0.3, 0.5)), 0, 0.85))
    # broad patina patches
    rgb = SH.mix(rgb, pal["stain"] * 1.15, 0.62 * SH.smooth01(c.noise(7.0, 3, 204), -0.08, 0.40))
    # cavities: packed grime; worn convex highs: paler ivory
    rgb = SH.mix(rgb, grime, np.clip(SH.smooth01(c.cav, 0.03, 0.45) * 0.95, 0, 0.95))
    rgb = SH.mix(rgb, hi, np.clip(0.55 * c.ridge * (0.6 + 0.4 * SH.smooth01(n2, -0.2, 0.4)), 0, 0.6))
    # C2 r14: worn, paler ivory on the knuckle TOPS (dorsal side of every head), darker deck under the hero's feet
    kn = np.zeros(c.n)
    for (kc, kr, kd) in KNUCK:
        dk = np.linalg.norm(P - kc[None, :], axis=1) / (1.35 * kr)
        kn = np.maximum(kn, (1 - SH.smooth01(dk, 0.55, 1.0)) * SH.smooth01(N @ V(kd), 0.0, 0.6))
    rgb = SH.mix(rgb, hi * 1.06, np.clip(0.55 * kn, 0, 0.55))
    deck = SH.smooth01(Y, TOP - 0.16, TOP - 0.04) * (1 - SH.smooth01(Z, 0.30, 0.42)) * SH.smooth01(Z, -0.42, -0.30)
    rgb = rgb * (1 - 0.10 * deck * (1 - kn))[:, None]    # C2 r15: lighter (the deck IS the palm platform now)
    # hairline crack network in patches (dark lines), fine pits
    cr = np.exp(-(c.noise(17.0, 2, 205) / 0.045) ** 2) * SH.smooth01(c.noise(2.5, 2, 206), 0.0, 0.35)
    rgb = SH.mix(rgb, grime * 0.7, np.clip(cr * 0.85, 0, 0.85))
    pit = SH.smooth01(c.noise(70.0, 1, 207), 0.55, 0.75)
    rgb = SH.mix(rgb, grime, 0.5 * pit)
    # moss: in hollows and on up-facing surfaces, low on the hand + clumps at the joints; lichen flecks on top faces
    up = np.clip(N[:, 1], 0, 1)
    mz = SH.smooth01(c.noise(6.5, 3, 208), 0.05, 0.42)
    # C2 r14: moss only in the deep hollows, the joints' up-faces and low on the hand (it was on every up-face: green bones
    #     once the grade keeps some chroma)
    moss = np.clip(mz * (0.55 * SH.smooth01(c.cav, 0.15, 0.5) + 0.35 * up ** 2 * joint + 0.35 * (Y < 0.70)), 0, 0.7)
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
    return SH.out(c.n, np.clip(rgb * 0.84, 0, 1), rough)  # r16: keep both-READY bone/hero value below 0.6


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
    pore = N.new("ShaderNodeTexNoise"); pore.inputs["Scale"].default_value = 78.0; pore.inputs["Detail"].default_value = 2.0
    nt.links.new(tc.outputs["Object"], pore.inputs["Vector"])
    grain = N.new("ShaderNodeTexNoise"); grain.inputs["Scale"].default_value = 38.0; grain.inputs["Detail"].default_value = 4.0
    stretch = N.new("ShaderNodeVectorMath"); stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (1.0, 0.13, 1.0)
    nt.links.new(tc.outputs["Object"], stretch.inputs[0])
    nt.links.new(stretch.outputs[0], grain.inputs["Vector"])
    hgt = N.new("ShaderNodeMath"); hgt.operation = "MULTIPLY_ADD"
    nt.links.new(pore.outputs["Fac"], hgt.inputs[0]); hgt.inputs[1].default_value = 0.35
    nt.links.new(grain.outputs["Fac"], hgt.inputs[2])
    h2 = N.new("ShaderNodeMath"); h2.operation = "MULTIPLY_ADD"
    nt.links.new(cm.outputs[0], h2.inputs[0]); h2.inputs[1].default_value = -1.2
    nt.links.new(hgt.outputs[0], h2.inputs[2])
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.9; bump.inputs["Distance"].default_value = 0.006
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
    pal = palette()
    shaders.paint_mesh(hi, S.materials, {}, pal, {}, painters={"bone": p_handbone})
    for o in (hi, lo):
        pipeline.set_ray_visibility(o, False)
    B = pipeline.Baker(res, [(lo, [hi], 0.02, 0.05)], shaders.set_pass, [lo], [hi])
    t = time.time()
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 64),
                         ("normal", "NORMAL", 4 if fast else 8)])
    pipeline.log(f"bakes {time.time()-t:.0f}s")
    tex = charkit.composite_maps(maps, OUT_TEX, "ui_skeletal_hand", tint=OCC_TINT)
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
