"""Emberdrake (blue riding dragon) / Cinderwyrm (red) -> public/assets/models/mount_<kind>.glb (+ textures/mount_<kind>_*)

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P blender/build_mount_emberdrake.py
    env: DRAKE=emberdrake|cinderwyrm   MOUNT_FAST=1 (1K atlas, coarse voxels)   MOUNT_PREVIEW=1 (clay look-dev PNG only)

r2 design (critic r1: primitive soup) -- the Golden Axe blue dragon read (refs/golden-axe/ga-art_bizarrians-official.png):
a BIPED theropod: powerful digitigrade hind legs with muscled thighs/calves and three-toed clawed feet, small raised
clawed arms, deep keeled chest, S-curved neck, long head with a heavy brow, lidded slit-pupil eyes set in eye mounds,
nostril bosses, a separate lower jaw (gums, tongue, interlocking teeth), swept horns + webbed ear-frills with finger
rays, serrated blade spines neck->back->tail, pale ventral plates (throat to tail) and shingled scales everywhere else
(node-side Voronoi scales baked to the normal/albedo maps), an S-tail that tapers to a spade. Tack: brown felt blanket
with a gold border, leather seat with cantle + brass-knobbed pommel, girth strap with buckles, stirrups, gold collar.
Value plan: pale teal belly plates (light) / saturated blue flanks (mid) / navy dorsal line + cavities (dark); the red
eyes and gold tack are the accents. Every hard piece is rigid to one bone (no tearing); organic body = one SDF skin.
"""
import os
import sys
import time
import math

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import numpy as np
import build_mount_kit as K
import build_mount_bake as BK
from lib import shaders
from lib.sdf import (Sculpt, Sphere, Ellipsoid, RoundCone, Chain, RoundBox, Inter, Shell, Offset, Snapshot, Slab,
                     Bounded, Diff, Torus, HalfSpace, basis, V, norm)

J, jv = K.J, K.jv
KIND = os.environ.get("DRAKE", "emberdrake")
FAST = os.environ.get("MOUNT_FAST") == "1"
PREVIEW = os.environ.get("MOUNT_PREVIEW") == "1"
ASSET = f"mount_{KIND}"
sr = shaders.srgb

PAL = {
    'emberdrake': dict(back=sr(20, 44, 120), flank=sr(38, 96, 204), flank2=sr(30, 126, 178), belly=sr(214, 198, 146),
                       belly_dark=sr(104, 88, 62), spine=sr(92, 170, 214), spine_tip=sr(206, 232, 240),
                       horn=sr(222, 212, 182), horn_dark=sr(70, 66, 76), claw=sr(226, 224, 214), claw_dark=sr(44, 44, 54),
                       mouth=sr(128, 30, 44), gum=sr(176, 72, 84), teeth=sr(240, 230, 204), iris=sr(226, 52, 20),
                       iris2=sr(255, 184, 60), sclera=sr(70, 14, 10), frill=sr(96, 176, 236), frill_vein=sr(34, 84, 176),
                       leather=sr(96, 58, 32), leather_dark=sr(44, 26, 14), cloth=sr(112, 84, 46), cloth_dark=sr(60, 42, 22),
                       brass=sr(232, 180, 78)),
    'cinderwyrm': dict(back=sr(104, 16, 12), flank=sr(196, 44, 24), flank2=sr(214, 86, 34), belly=sr(236, 176, 112),
                       belly_dark=sr(130, 66, 38), spine=sr(222, 110, 64), spine_tip=sr(250, 214, 170),
                       horn=sr(70, 58, 54), horn_dark=sr(20, 16, 16), claw=sr(60, 54, 50), claw_dark=sr(16, 14, 14),
                       mouth=sr(110, 20, 20), gum=sr(160, 50, 50), teeth=sr(240, 228, 196), iris=sr(255, 200, 40),
                       iris2=sr(255, 246, 170), sclera=sr(90, 40, 10), frill=sr(240, 126, 84), frill_vein=sr(150, 36, 26),
                       leather=sr(80, 50, 30), leather_dark=sr(36, 22, 12), cloth=sr(52, 58, 92), cloth_dark=sr(24, 26, 46),
                       brass=sr(226, 172, 70)),
}[KIND]


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sc(a, k):
    return tuple(x * k for x in a)


# ---------------------------------------------------------------- joints (JS frame, absolute): biped theropod
P = {'root': (0, 0, 0), 'hips': (0, 1.06, -0.30), 'spine_1': (0, 1.10, -0.12), 'spine_2': (0, 1.16, 0.05),
     'spine_3': (0, 1.22, 0.20), 'chest': (0, 1.28, 0.34), 'neck_1': (0, 1.40, 0.48), 'neck_2': (0, 1.56, 0.58),
     'neck_3': (0, 1.72, 0.66), 'head': (0, 1.86, 0.74), 'jaw': (0, 1.80, 0.80),
     'tail_1': (0, 1.02, -0.58), 'tail_2': (0, 0.95, -0.86), 'tail_3': (0, 0.87, -1.12), 'tail_4': (0, 0.81, -1.38),
     'tail_5': (0, 0.80, -1.62), 'tail_6': (0, 0.86, -1.84)}
TAIL_TIP = (0, 0.98, -2.03)
for s, L in ((1, 'L'), (-1, 'R')):
    P[f'thigh_{L}'] = (0.24 * s, 1.00, -0.28); P[f'shin_{L}'] = (0.28 * s, 0.60, -0.06)
    P[f'metatarsal_{L}'] = (0.27 * s, 0.25, -0.34); P[f'foot_{L}'] = (0.26 * s, 0.07, -0.24); P[f'toe_{L}'] = (0.26 * s, 0.05, -0.12)
    P[f'clavicle_{L}'] = (0.16 * s, 1.20, 0.36); P[f'upperarm_{L}'] = (0.25 * s, 1.12, 0.40)
    P[f'forearm_{L}'] = (0.31 * s, 0.92, 0.34); P[f'hand_{L}'] = (0.25 * s, 0.88, 0.58); P[f'finger_{L}'] = (0.25 * s, 0.86, 0.64)
    P[f'wing_1_{L}'] = (0.14 * s, 1.34, 0.30); P[f'wing_2_{L}'] = (0.18 * s, 1.38, 0.24); P[f'wing_3_{L}'] = (0.20 * s, 1.38, 0.18)

# centre line tail tip -> head with body radii (sculpt core + plate/spine placement)
AX = [(TAIL_TIP, 0.022), (P['tail_6'], 0.05), (P['tail_5'], 0.075), (P['tail_4'], 0.10), (P['tail_3'], 0.13),
      (P['tail_2'], 0.165), (P['tail_1'], 0.215), ((0, 1.05, -0.44), 0.255), (P['hips'], 0.28), (P['spine_1'], 0.30),
      (P['spine_2'], 0.31), (P['spine_3'], 0.30), (P['chest'], 0.28), (P['neck_1'], 0.215), (P['neck_2'], 0.17),
      (P['neck_3'], 0.145), (P['head'], 0.125)]


def axis_samples(step_fn):
    """Walk the centre line; yields (arc, point, tangent(headward), radius) at spacing step_fn(r)."""
    pts = np.array([a[0] for a in AX], float)
    rad = np.array([a[1] for a in AX], float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    out, s = [], 0.02
    while s < cum[-1] - 0.02:
        i = min(np.searchsorted(cum, s, 'right') - 1, len(seg) - 1)
        t = (s - cum[i]) / seg[i]
        p = pts[i] * (1 - t) + pts[i + 1] * t
        r = rad[i] * (1 - t) + rad[i + 1] * t
        tg = (pts[i + 1] - pts[i]) / seg[i]
        out.append((s, tuple(p), tg, r))
        s += step_fn(r)
    return out, cum


def perp(v, tg):
    v = np.array(v, float)
    v = v - tg * float(np.dot(v, tg))
    return v / np.linalg.norm(v)


def E(c, r, M=None):
    return Ellipsoid(jv(c), r, M)


def RC(a, b, ra, rb=None, **kw):
    return RoundCone(jv(a), jv(b), ra, rb, **kw)


def CH(pts, radii, **kw):
    return Chain([jv(p) for p in pts], radii, **kw)


TOE_TIPS = {}      # side -> [(tip, dir)] for the claw parts
FINGER_TIPS = {}
EYES = {}
BELLY = []         # r3b: soft belly-blend regions (painters) -- replaces the jagged per-vertex paint_mat


def body_sculpt():
    S = Sculpt(materials=("scale", "scale_fine", "belly", "spine", "horn", "mouth"), default_mat="scale")
    S.add(Chain([jv(p) for p, _ in AX], [r for _, r in AX], k=0.05), 0.0)
    # torso masses: deep keeled chest, belly, pectorals, haunches
    S.add(E((0, 1.10, 0.26), (0.25, 0.22, 0.28)), 0.10)
    S.add(E((0, 1.00, -0.02), (0.27, 0.30, 0.25)), 0.10)
    for s in (1, -1):
        S.add(E((0.17 * s, 1.13, 0.34), (0.11, 0.12, 0.13)), 0.06)
        S.add(E((0.21 * s, 1.04, -0.33), (0.15, 0.22, 0.21)), 0.08)
    # head: skull, occiput, snout (wider than tall), muzzle bulb, brows, cheeks, eye mounds
    S.add(E((0, 1.90, 0.80), (0.135, 0.15, 0.125)), 0.05)
    S.add(E((0, 1.93, 0.71), (0.11, 0.10, 0.10)), 0.04)
    S.add(RC((0, 1.88, 0.88), (0, 1.848, 1.22), 0.105, 0.066, squash=(0.74, 1.0), ref=(0, 0, 1)), 0.05)
    S.add(E((0, 1.858, 1.215), (0.072, 0.07, 0.05)), 0.03)
    for s in (1, -1):
        S.add(E((0.042 * s, 1.888, 1.235), (0.03, 0.036, 0.024)), 0.02)                    # nostril boss
        S.add(RC((0.055 * s, 1.998, 1.02), (0.10 * s, 2.0, 0.875), 0.018, 0.024), 0.02)     # brow ridge
        S.add(E((0.112 * s, 1.852, 0.83), (0.058, 0.09, 0.07)), 0.03)                         # cheek / jaw muscle
        c = (0.103 * s, 1.953, 0.905)
        n = norm(np.array([0.85 * s, 0.25, 0.45]))
        EYES[s] = (c, n)
        S.add(Sphere(jv(add(c, sc(n, -0.012))), 0.042), 0.03)                                 # eye mound
        S.add(E((0.03 * s, 1.93, 1.13), (0.035, 0.08, 0.02)), 0.02)                            # snout ridge
    S.add(E((0, 1.86, 0.97), (0.09, 0.22, 0.09)), 0.04)                                        # snout fill
    # upper-jaw underside: flattened (the separate lower jaw closes against it); palate = mouth
    S.sub(RoundBox(jv((0, 1.785, 1.05)), (0.17, 0.27, 0.045), None, 0.012), 0.012)
    S.paint_mat(RoundBox(jv((0, 1.83, 1.04)), (0.078, 0.19, 0.012), None, 0.0), "mouth")
    for s in (1, -1):
        S.sub(E((0.046 * s, 1.894, 1.258), (0.012, 0.012, 0.009)), 0.004)                      # nostrils
        c, n = EYES[s]
        S.sub(Sphere(jv(c), 0.034), 0.004)                                                     # socket
        lid_n = norm(np.array(jv((0, 1, 0))) * 1.0 + np.array(jv((0, 0, -0.25))))
        S.add(Diff(Shell(Sphere(jv(add(c, sc(n, 0.006))), 0.036), 0.005), Slab(jv(add(c, (0, -0.002, 0))), lid_n, 0.016)), 0.004)  # lids
    # hind legs: haunch -> thigh (quad bulge) -> knee -> shin (calf) -> ankle (heel spur) -> metatarsal -> foot + toes
    for s, L in ((1, 'L'), (-1, 'R')):
        S.add(RC(P[f'thigh_{L}'], P[f'shin_{L}'], 0.19, 0.105), 0.06)
        S.add(E((0.27 * s, 0.84, -0.13), (0.12, 0.14, 0.19)), 0.05)
        S.add(E((0.285 * s, 0.60, -0.05), (0.085, 0.085, 0.085)), 0.03)
        S.add(RC(P[f'shin_{L}'], P[f'metatarsal_{L}'], 0.095, 0.058), 0.03)
        S.add(E((0.28 * s, 0.50, -0.20), (0.07, 0.10, 0.12)), 0.035)
        S.add(E((0.27 * s, 0.25, -0.35), (0.062, 0.066, 0.066)), 0.02)
        S.add(RC((0.27 * s, 0.26, -0.37), (0.27 * s, 0.31, -0.46), 0.028, 0.006), 0.012, mat="horn")
        S.add(RC(P[f'metatarsal_{L}'], P[f'foot_{L}'], 0.06, 0.052), 0.02)
        S.add(E((0.26 * s, 0.056, -0.17), (0.085, 0.11, 0.048)), 0.03)
        tips = []
        for a in (-0.42, 0.0, 0.42):
            d = np.array([math.sin(a) * s, 0, math.cos(a)])
            b0 = (0.26 * s, 0.06, -0.13)
            k1 = add(b0, tuple(d * 0.10 + np.array([0, -0.004, 0])))
            tp = add(k1, tuple(d * 0.085 + np.array([0, -0.022, 0])))
            S.add(CH([b0, k1, tp], [0.042, 0.035, 0.026], k=0.01), 0.018)
            S.add(E(add(k1, (0, 0.02, 0)), (0.034, 0.03, 0.022)), 0.01)                      # knuckle scute
            tips.append((tp, d))
        TOE_TIPS[L] = tips
        S.add(RC((0.26 * s, 0.10, -0.29), (0.285 * s, 0.05, -0.36), 0.026, 0.012), 0.015)     # dew claw toe
        S.add(RC((0.285 * s, 0.05, -0.36), (0.29 * s, 0.02, -0.40), 0.013, 0.003), 0.004, mat="horn")
        # arms: shoulder, upper arm (bicep), elbow, forearm, hand, three curled fingers
        S.add(E(P[f'upperarm_{L}'], (0.085, 0.09, 0.09)), 0.05)
        S.add(RC(P[f'upperarm_{L}'], P[f'forearm_{L}'], 0.078, 0.052), 0.03)
        S.add(E((0.285 * s, 1.03, 0.41), (0.055, 0.065, 0.085)), 0.02)
        S.add(RC(P[f'forearm_{L}'], P[f'hand_{L}'], 0.054, 0.04), 0.02)
        S.add(E((0.25 * s, 0.876, 0.615), (0.048, 0.058, 0.034)), 0.02)
        ftips = []
        for a in (-0.38, 0.0, 0.38):
            d = np.array([math.sin(a) * s, 0, math.cos(a)])
            b0 = (0.25 * s, 0.876, 0.63)
            k1 = add(b0, tuple(d * 0.05 + np.array([0, -0.006, 0])))
            tp = add(k1, tuple(d * 0.028 + np.array([0, -0.045, 0])))
            S.add(CH([b0, k1, tp], [0.021, 0.018, 0.014], k=0.006), 0.012)
            ftips.append((tp, d))
        FINGER_TIPS[L] = ftips
    # fine scales on head, hands, feet
    S.paint_mat(E((0, 1.88, 0.95), (0.2, 0.42, 0.2)), "scale_fine")
    for s, L in ((1, 'L'), (-1, 'R')):
        S.paint_mat(E((0.26 * s, 0.1, -0.14), (0.2, 0.3, 0.16)), "scale_fine")
        S.paint_mat(E((0.25 * s, 0.86, 0.62), (0.1, 0.1, 0.09)), "scale_fine")
    # ventral plates: throat -> chest -> belly -> tail underside (geometry grooves + belly material)
    belly_regions = []
    samples, cum = axis_samples(lambda r: 0.028 + 0.22 * r)
    for arc, p, tg, r in samples:
        if p[2] > 0.70 or p[2] < -1.62:
            continue
        dn = perp((0, -1, 0), tg)
        q = BK.ray_out(S, p, tuple(dn), r_max=0.7)
        step = 0.028 + 0.22 * r
        c = np.array(q) - dn * 0.012                               # r3b: plates sunk + thicker/rounder (thin slabs voxelised to torn edges)
        M = basis(np.array(jv((1, 0, 0))), np.array(jv(tuple(tg))))
        S.add(Ellipsoid(jv(tuple(c)), (0.6 * r + 0.02, 0.7 * step, 0.022), M), 0.026, mat="belly")
        belly_regions.append(Ellipsoid(jv(tuple(np.array(q))), (0.6 * r + 0.02, 1.1 * step, 0.06), M))
    BELLY[:] = belly_regions                                        # r3b: soft blend in _base (no hard paint_mat edge)
    # dorsal blade spines (skip the saddle/collar zone)
    samples, _ = axis_samples(lambda r: 0.05 + 0.25 * r)
    for arc, p, tg, r in samples:
        if -0.40 < p[2] < 0.46 or p[2] > 0.70:
            continue
        up = perp((0, 1, 0), tg)
        q = np.array(BK.ray_out(S, p, tuple(up), r_max=0.7))
        h = float(np.clip(0.035 + 0.30 * r, 0.035, 0.12))
        base = q - up * 0.02
        tip = q + up * h - tg * h * 0.5
        S.add(RoundCone(jv(tuple(base)), jv(tuple(tip)), 0.012 + 0.28 * h, 0.003, squash=(1.0, 0.45)), 0.008, mat="spine")
    # tail spade: two flared blades + keel at the tip
    tt = np.array(TAIL_TIP); t6 = np.array(P['tail_6'])
    tgt = (tt - t6) / np.linalg.norm(tt - t6)
    sc_ = tt + tgt * 0.07
    Mt = basis(np.array(jv((1, 0, 0))), np.array(jv(tuple(tgt))))
    spade = Diff(Ellipsoid(jv(tuple(sc_)), (0.12, 0.15, 0.022), Mt),
                 Sphere(jv(tuple(tt - tgt * 0.14)), 0.12), k=0.01)
    S.add(spade, 0.025, mat="spine")
    S.add(RC(tuple(tt - tgt * 0.02), tuple(tt + tgt * 0.24), 0.03, 0.003), 0.02, mat="spine")
    return S


def crest_sculpt():
    S = Sculpt(materials=("horn", "frill"), default_mat="horn")
    for s in (1, -1):
        if KIND == 'emberdrake':
            S.add(CH([(0.06 * s, 2.0, 0.86), (0.09 * s, 2.10, 0.72), (0.10 * s, 2.23, 0.58), (0.09 * s, 2.34, 0.50)],
                     [0.036, 0.027, 0.016, 0.003], k=0.01), 0.0)
            S.add(CH([(0.03 * s, 2.02, 0.80), (0.035 * s, 2.13, 0.70), (0.03 * s, 2.22, 0.63)], [0.022, 0.014, 0.003], k=0.01), 0.004)
        else:
            S.add(CH([(0.07 * s, 1.99, 0.90), (0.09 * s, 2.10, 0.92), (0.10 * s, 2.20, 0.97)], [0.036, 0.022, 0.003], k=0.01), 0.0)
        # cheek spikes back from the jaw hinge
        S.add(RC((0.135 * s, 1.85, 0.80), (0.20 * s, 1.83, 0.64), 0.022, 0.003), 0.0)
        S.add(RC((0.12 * s, 1.81, 0.84), (0.17 * s, 1.77, 0.72), 0.015, 0.002), 0.0)
        # webbed ear frill: rays fanning back/up/out from behind the eye, membrane between, scalloped edge
        o = (0.10 * s, 1.955, 0.73)
        tips = [add(o, (0.09 * s, 0.40, -0.10)), add(o, (0.20 * s, 0.32, -0.33)), add(o, (0.24 * s, 0.13, -0.44)),
                add(o, (0.18 * s, -0.07, -0.40))]
        for t in tips:
            mid = add(sc(o, 0.5), sc(t, 0.5))
            S.add(CH([o, add(mid, (0.012 * s, 0.0, 0.0)), t], [0.017, 0.011, 0.003], k=0.004), 0.0)
        fan = [o] + tips
        for i in range(len(tips) - 1):
            S.add(K_tri(jv(o), jv(tips[i]), jv(tips[i + 1]), 0.0055), 0.003, mat="frill")
        for i in range(len(tips) - 1):
            m = (np.array(jv(tips[i])) + np.array(jv(tips[i + 1]))) * 0.5
            S.sub(Sphere(m + (m - np.array(jv(o))) * 0.16, 0.10), 0.006)
    if KIND != 'emberdrake':
        S.add(RC((0, 1.90, 1.16), (0, 2.02, 1.22), 0.04, 0.004), 0.0)                        # nose horn
    return S


def K_tri(a, b, c, half):
    a, b, c = V(a), V(b), V(c)
    n = norm(np.cross(b - a, c - a))
    hs = []
    for p, q, r in ((a, b, c), (b, c, a), (c, a, b)):
        m = norm(np.cross(q - p, n))
        if float(np.dot(r - p, m)) > 0:
            m = -m
        hs.append(HalfSpace(p, m))
    lo = np.minimum(np.minimum(a, b), c) - 0.03
    hi = np.maximum(np.maximum(a, b), c) + 0.03
    return Bounded(Inter(Slab(a, n, half), *hs), lo, hi)


GUM = [(0.098, 1.836, 0.84), (0.093, 1.838, 0.96), (0.078, 1.838, 1.09), (0.052, 1.836, 1.19), (0.0, 1.836, 1.238)]


def gum_path(s, n=13):
    pts = [(g[0] * s, g[1], g[2]) for g in GUM]
    P_ = np.array(pts)
    seg = np.linalg.norm(np.diff(P_, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    out = []
    for u in np.linspace(0.04, 0.97, n):
        s_ = u * cum[-1]
        i = min(np.searchsorted(cum, s_, 'right') - 1, len(seg) - 1)
        t = (s_ - cum[i]) / seg[i]
        out.append(tuple(P_[i] * (1 - t) + P_[i + 1] * t))
    return pts, out


def teeth_sculpt():
    S = Sculpt(materials=("mouth", "teeth"), default_mat="mouth")
    for s in (1, -1):
        pts, tp = gum_path(s)
        S.add(CH(pts, [0.017, 0.016, 0.015, 0.013, 0.012], k=0.005), 0.0)
        for i, p in enumerate(tp):
            fang = i in (8, 9)
            L = 0.068 if fang else (0.036 + 0.012 * ((i * 7) % 3))
            r0 = 0.013 if fang else 0.0095
            a = add(p, (0, -0.006, 0))
            b = add(p, (0.004 * s, -L, 0.012))
            S.add(RC(a, b, r0, 0.0015), 0.002, mat="teeth")
    return S


def jaw_sculpt():
    S = Sculpt(materials=("scale_fine", "belly", "mouth", "teeth"), default_mat="scale_fine")
    S.add(RC((0, 1.786, 0.80), (0, 1.786, 1.17), 0.088, 0.05, squash=(0.5, 1.0), ref=(0, 0, 1)), 0.0)
    for s in (1, -1):
        S.add(E((0.075 * s, 1.795, 0.83), (0.04, 0.07, 0.04)), 0.02)                        # jaw hinge muscle
    S.sub(RC((0, 1.83, 0.84), (0, 1.83, 1.15), 0.066, 0.033, squash=(0.55, 1.0), ref=(0, 0, 1)), 0.008)
    S.add(RC((0, 1.797, 0.86), (0, 1.803, 1.09), 0.046, 0.026, squash=(0.35, 1.0), ref=(0, 0, 1)), 0.006, mat="mouth")
    S.paint_mat(RoundBox(jv((0, 1.83, 1.0)), (0.2, 0.3, 0.012), None, 0.0), "mouth")
    for i in range(7):                                                                       # chin plates
        z = 0.86 + i * 0.05
        S.add(E((0, 1.745 + 0.004 * i, z), (0.05 - 0.003 * i, 0.022, 0.012)), 0.004, mat="belly")
    for s in (1, -1):
        for i in range(9):
            t = i / 8.0
            x = (0.074 * (1 - t) + 0.036 * t) * s
            z = 0.87 + t * 0.29
            L = 0.03 if i < 7 else 0.042
            S.add(RC((x, 1.822, z), (x - 0.002 * s, 1.822 + L, z + 0.006), 0.009, 0.0015), 0.002, mat="teeth")
    return S


def eye_sculpt():
    S = Sculpt(materials=("eye",), default_mat="eye")
    for s in (1, -1):
        c, n = EYES[s]
        S.add(Sphere(jv(add(c, sc(n, 0.008))), 0.032), 0.0)
    return S


def claw_sculpt(tips, r0):
    S = Sculpt(materials=("claw",), default_mat="claw")
    for tp, d in tips:
        d = np.array(d)
        a = add(tp, tuple(d * -0.012 + np.array([0, 0.004, 0])))
        b = add(tp, tuple(d * r0 * 1.6 + np.array([0, r0 * 0.25, 0])))
        c = add(tp, tuple(d * r0 * 2.9 + np.array([0, -r0 * 1.3, 0])))
        S.add(CH([a, b, c], [r0, r0 * 0.66, 0.0018], squash=(1.0, 0.62), ref=(0, 0, 1), k=0.004), 0.0)
    return S


def tack_sculpts(body):
    """Saddle (rigid spine_2) + collar (rigid neck_1): conform to the body via a Snapshot offset."""
    snap = Snapshot(body)
    S = Sculpt(materials=("cloth", "brass", "leather"), default_mat="cloth")
    region = E((0, 1.22, 0.02), (0.62, 0.33, 0.34))
    lo, hi = np.array(jv((-0.5, 0.82, 0.4))), np.array(jv((0.5, 1.7, -0.36)))
    blo, bhi = np.minimum(lo, hi), np.maximum(lo, hi)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.024), 0.010), region), blo, bhi), 0.0)
    rim = Shell(E((0, 1.22, 0.02), (0.62, 0.33, 0.34)), 0.018)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.03), 0.011), rim), blo - 0.05, bhi + 0.05), 0.0, mat="brass")
    top = np.array(BK.ray_out(body, P['spine_2'], (0, 1, 0)))
    seat_c = add(tuple(top), (0, 0.055, -0.01))
    S.add(E(seat_c, (0.19, 0.22, 0.055)), 0.03, mat="leather")
    S.add(E(add(seat_c, (0, 0.05, -0.19)), (0.17, 0.05, 0.085)), 0.03, mat="leather")             # cantle
    S.add(RC(add(seat_c, (0, 0.0, 0.19)), add(seat_c, (0, 0.13, 0.23)), 0.034, 0.026), 0.02, mat="leather")  # pommel
    S.add(Sphere(jv(add(seat_c, (0, 0.15, 0.235))), 0.038), 0.006, mat="brass")
    # girth strap around the barrel + side buckles
    g = np.array(jv((0, 1.0, 0.1)))
    slab = Slab(g, np.array(jv((0, 0.12, 1.0))) / np.linalg.norm(jv((0, 0.12, 1.0))), 0.032)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.02), 0.008), slab), blo - 0.1, bhi + 0.1), 0.0, mat="leather")
    stir = {}
    for s in (1, -1):
        side = np.array(BK.ray_out(body, (0, 1.06, 0.1), (s, -0.05, 0)))
        S.add(RoundBox(jv(tuple(side + np.array([0.02 * s, 0, 0]))), (0.016, 0.03, 0.036), None, 0.006), 0.004, mat="brass")
        # stirrup leather: follows the flank out from under the seat, then hangs; brass stirrup at the bottom
        pts = []
        for ang in (25, 50, 72, 88):
            a = math.radians(ang)
            q = np.array(BK.ray_out(body, (0, 1.16, 0.02), (s * math.sin(a), math.cos(a), 0)))
            pts.append(tuple(q + np.array([s * math.sin(a), math.cos(a), 0]) * 0.045))
        low = add(pts[-1], (0.035 * s, -0.22, 0))
        pts.append(low)
        S.add(CH(pts, 0.019, squash=(1.0, 0.33), k=0.004), 0.0, mat="leather")
        ring_c = add(low, (0.0, -0.06, 0))
        Mr = basis(np.array(jv((0, 0, 1))), np.array(jv((1, 0, 0))))
        S.add(Torus(jv(ring_c), 0.058, 0.011, Mr, 1.0), 0.0, mat="brass")
        S.add(RoundBox(jv(add(ring_c, (0, -0.055, 0))), (0.03, 0.05, 0.01), None, 0.006), 0.004, mat="brass")
        stir[s] = ring_c
    C = Sculpt(materials=("brass", "leather"), default_mat="brass")
    n1 = np.array(P['neck_1']); ch = np.array(P['chest'])
    cc = ch * 0.35 + n1 * 0.65
    tg = (n1 - ch) / np.linalg.norm(n1 - ch)
    cb = np.array(jv(tuple(cc))); tb = np.array(jv(tuple(tg)))
    clo, chi = cb - 0.4, cb + 0.4
    C.add(Bounded(Inter(Shell(Offset(snap, 0.02), 0.010), Slab(cb, tb, 0.05)), clo, chi), 0.0)
    for k in (-1, 1):
        C.add(Bounded(Inter(Shell(Offset(snap, 0.031), 0.006), Slab(cb + tb * 0.045 * k, tb, 0.008)), clo, chi), 0.004)
    return S, C


# ---------------------------------------------------------------- painters (c.P Blender coords; linear colours)
def _base(c, pal):
    up = c.N[:, 2]
    t = shaders.smooth01(up, -0.35, 0.85)
    rgb = shaders.mix(pal["flank"], pal["back"], t)
    n1 = c.noise(3.0, 3, 11)
    rgb = shaders.mix(rgb, pal["flank2"], 0.45 * shaders.smooth01(n1, 0.45, 0.8))
    dors = shaders.smooth01(up, 0.55, 0.95) * (1 - shaders.smooth01(np.abs(c.P[:, 0]), 0.03, 0.12))
    rgb = shaders.mix(rgb, pal["back"] * 0.7, 0.5 * dors)
    rgb = rgb * (0.9 + 0.2 * c.noise(24.0, 2, 12))[:, None]
    blot = shaders.smooth01(c.noise(7.0, 3, 31), 0.55, 0.8)
    rgb = shaders.mix(rgb, pal["back"] * 0.8, 0.4 * blot)
    throat = shaders.smooth01(-c.N[:, 2], 0.1, 0.6)
    rgb = shaders.mix(rgb, pal["flank2"] * 1.2, 0.35 * throat)
    low = 1 - shaders.smooth01(c.P[:, 2], 0.08, 0.4)
    rgb = rgb * (1 - 0.22 * low)[:, None]
    rgb = shaders.mix(rgb, pal["back"] * 0.3, shaders.smooth01(c.cav, 0.05, 0.5) * 0.75)
    rgb = shaders.mix(rgb, np.minimum(pal["flank"] * 1.45 + 0.02, 1), 0.3 * c.ridge)
    return rgb


def belly_w(c):
    """0..1 soft ventral weight: 1 inside the belly regions, fading over ~5 cm with a noisy organic edge."""
    if not BELLY:
        return np.zeros(c.n)
    X, Y, Z = c.P[:, 0], c.P[:, 1], c.P[:, 2]
    d = np.full(c.n, 9.0)
    for rg in BELLY:
        d = np.minimum(d, rg.d(X, Y, Z))
    d = d + 0.02 * (c.noise(14.0, 2, 57) - 0.5)
    return 1.0 - shaders.smooth01(d, -0.015, 0.045)


def p_scale(c, pal):
    rgb = _base(c, pal)
    w = belly_w(c)
    bel = np.tile(pal["belly"], (c.n, 1)) * (0.9 + 0.12 * c.noise(8.0, 3, 14))[:, None]
    bel = shaders.mix(bel, pal["belly_dark"], shaders.smooth01(c.cav, 0.03, 0.45) * 0.5)
    rgb = shaders.mix(rgb, bel, 0.85 * w)
    return shaders.out(c.n, rgb, 0.5 + 0.08 * c.noise(9.0, 2, 13) - 0.04 * w)


def p_belly(c, pal):
    n1 = c.noise(8.0, 3, 14)
    rgb = np.tile(pal["belly"], (c.n, 1)) * (0.92 + 0.12 * n1)[:, None]
    rgb = shaders.mix(rgb, pal["belly_dark"], shaders.smooth01(c.cav, 0.05, 0.5) * 0.35)
    rgb = shaders.mix(rgb, np.minimum(pal["belly"] * 1.15, 1), 0.25 * c.ridge)
    return shaders.out(c.n, rgb, 0.46)


def p_spine(c, pal):
    rgb = shaders.mix(pal["spine"], pal["spine_tip"], shaders.smooth01(c.ridge, 0.05, 0.6))
    rgb = shaders.mix(rgb, pal["back"], shaders.smooth01(c.cav, 0.05, 0.4) * 0.85)
    rgb = rgb * (0.92 + 0.12 * c.noise(30.0, 2, 15))[:, None]
    return shaders.out(c.n, rgb, 0.42)


def p_horn(c, pal):
    n1 = c.noise(40.0, 2, 16)
    rgb = shaders.mix(pal["horn"], pal["horn_dark"], 0.25 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.45))
    rgb = shaders.mix(rgb, np.minimum(pal["horn"] * 1.12, 1), 0.4 * c.ridge)
    return shaders.out(c.n, rgb, 0.38)


def p_claw(c, pal):
    rgb = shaders.mix(pal["claw"], pal["claw_dark"], 0.85 * shaders.smooth01(c.cav, 0.0, 0.35) + 0.15 * c.noise(30.0, 2, 17))
    return shaders.out(c.n, rgb, 0.3)


def p_mouth(c, pal):
    n1 = c.noise(20.0, 2, 18)
    rgb = shaders.mix(pal["gum"], pal["mouth"], 0.5 * n1 + 0.6 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.28)


def p_teeth(c, pal):
    rgb = shaders.mix(pal["teeth"], pal["teeth"] * np.array([0.72, 0.62, 0.42]), shaders.smooth01(c.cav, 0.0, 0.4) * 0.8)
    return shaders.out(c.n, rgb, 0.26)


def p_eye(c, pal):
    """Reptile eye: dark rim, red iris brightening to gold around a vertical slit pupil."""
    (c0, n0), (c1, n1) = c.x["eyes"]
    left = (c.P[:, 0] > 0)[:, None]
    ce = np.where(left, np.array(c0)[None], np.array(c1)[None])
    ne = np.where(left, np.array(n0)[None], np.array(n1)[None])
    v = c.P - ce
    vn = v / np.maximum(np.linalg.norm(v, axis=1), 1e-6)[:, None]
    cosang = np.sum(vn * ne, axis=1)
    up_l = np.array([0, 0, 1.0])[None] - ne * ne[:, 2:3]
    up_l /= np.maximum(np.linalg.norm(up_l, axis=1), 1e-6)[:, None]
    sd = np.cross(ne, up_l)
    a = np.sum(vn * sd, axis=1)
    b = np.sum(vn * up_l, axis=1)
    rgb = shaders.mix(pal["sclera"], pal["iris"], shaders.smooth01(cosang, 0.35, 0.55))
    rgb = shaders.mix(rgb, pal["iris2"], shaders.smooth01(cosang, 0.8, 0.96) * 0.8)
    rgb = shaders.mix(rgb, pal["sclera"] * 0.4, 0.6 * np.exp(-((cosang - 0.5) / 0.06) ** 2))
    slit = (np.abs(a) < 0.085 * np.clip(1 - (b / 0.62) ** 2, 0, 1)) & (cosang > 0.6)
    rgb = shaders.mix(rgb, np.array([0.004, 0.003, 0.003]), slit.astype(float))
    return shaders.out(c.n, rgb, 0.1)


def p_frill(c, pal):
    n1 = c.noise(5.0, 3, 19)
    vein = 1 - shaders.smooth01(np.abs(c.noise(16.0, 2, 20) - 0.5), 0.0, 0.05)
    rgb = shaders.mix(pal["frill"], pal["frill_vein"], 0.25 * n1 + 0.55 * vein)
    rgb = shaders.mix(rgb, pal["frill_vein"] * 0.5, shaders.smooth01(c.cav, 0.05, 0.4) * 0.7)
    return shaders.out(c.n, rgb, 0.55)


def p_leather2(c, pal):
    n1 = c.noise(12.0, 3, 21)
    rgb = shaders.mix(pal["leather"], pal["leather_dark"], 0.35 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["leather"] * 1.5, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, 0.62 - 0.15 * c.ridge)


def p_cloth2(c, pal):
    n1 = c.noise(6.0, 3, 22)
    rgb = shaders.mix(pal["cloth"], pal["cloth_dark"], 0.4 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.85)


def p_brass(c, pal):
    n1 = c.noise(20.0, 3, 23)
    rgb = shaders.mix(pal["brass"], pal["brass"] * np.array([0.45, 0.32, 0.16]), 0.25 * n1 + 0.9 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["brass"] * 1.25, 1), 0.4 * c.ridge)
    return shaders.out(c.n, rgb, 0.3 + 0.2 * n1, 0.9)


PAINTERS = {"scale": p_scale, "scale_fine": p_scale, "belly": p_belly, "spine": p_spine, "horn": p_horn,
            "claw": p_claw, "mouth": p_mouth, "teeth": p_teeth, "eye": p_eye, "frill": p_frill,
            "leather": p_leather2, "cloth": p_cloth2, "brass": p_brass}


# ---------------------------------------------------------------- rig
def bones(seat):
    B = [('root', P['root'], (0, 0.3, 0), None, False), ('hips', P['hips'], P['spine_1'], 'root', True),
         ('spine_1', P['spine_1'], P['spine_2'], 'hips', True), ('spine_2', P['spine_2'], P['spine_3'], 'spine_1', True),
         ('spine_3', P['spine_3'], P['chest'], 'spine_2', True), ('chest', P['chest'], P['neck_1'], 'spine_3', True),
         ('neck_1', P['neck_1'], P['neck_2'], 'chest', True), ('neck_2', P['neck_2'], P['neck_3'], 'neck_1', True),
         ('neck_3', P['neck_3'], P['head'], 'neck_2', True), ('head', P['head'], (0, 1.84, 1.2), 'neck_3', True),
         ('jaw', P['jaw'], (0, 1.77, 1.16), 'head', True),
         ('socket_saddle', seat, add(seat, (0, 0, 0.2)), 'spine_2', False),
         ('socket_mouth', (0, 1.82, 1.26), (0, 1.82, 1.42), 'head', False)]
    prev = 'hips'
    for i in range(1, 7):
        nxt = P[f'tail_{i + 1}'] if i < 6 else TAIL_TIP
        B.append((f'tail_{i}', P[f'tail_{i}'], nxt, prev, True)); prev = f'tail_{i}'
    for L in ('L', 'R'):
        B += [(f'thigh_{L}', P[f'thigh_{L}'], P[f'shin_{L}'], 'hips', True),
              (f'shin_{L}', P[f'shin_{L}'], P[f'metatarsal_{L}'], f'thigh_{L}', True),
              (f'metatarsal_{L}', P[f'metatarsal_{L}'], P[f'foot_{L}'], f'shin_{L}', True),
              (f'foot_{L}', P[f'foot_{L}'], P[f'toe_{L}'], f'metatarsal_{L}', True),
              (f'toe_{L}', P[f'toe_{L}'], add(P[f'toe_{L}'], (0, -0.01, 0.16)), f'foot_{L}', True),
              (f'clavicle_{L}', P[f'clavicle_{L}'], P[f'upperarm_{L}'], 'chest', True),
              (f'upperarm_{L}', P[f'upperarm_{L}'], P[f'forearm_{L}'], f'clavicle_{L}', True),
              (f'forearm_{L}', P[f'forearm_{L}'], P[f'hand_{L}'], f'upperarm_{L}', True),
              (f'hand_{L}', P[f'hand_{L}'], P[f'finger_{L}'], f'forearm_{L}', True),
              (f'finger_{L}', P[f'finger_{L}'], add(P[f'finger_{L}'], (0, -0.04, 0.08)), f'hand_{L}', True),
              (f'wing_1_{L}', P[f'wing_1_{L}'], P[f'wing_2_{L}'], 'spine_3', False),
              (f'wing_2_{L}', P[f'wing_2_{L}'], P[f'wing_3_{L}'], f'wing_1_{L}', False),
              (f'wing_3_{L}', P[f'wing_3_{L}'], add(P[f'wing_3_{L}'], (0, 0, -0.08)), f'wing_2_{L}', False)]
    return B


def main():
    t0 = time.time()
    K.meshutil.clear_scene()
    S = body_sculpt()
    K.LOG(f"[{KIND}] body sculpt {len(S.ops)} ops ({time.time() - t0:.1f}s)")
    Ssad, Scol = tack_sculpts(S)
    seat_top = BK.ray_out(Ssad, add(P['spine_2'], (0, 0.34, 0.0)), (0, 1, 0), r_max=0.4)
    seat = (0, seat_top[1] - 0.01, 0.03)
    body_bones = [b[0] for b in bones(seat) if b[4] and b[0] != 'jaw']
    hq = 1.0 if not FAST else 1.8
    jobs = [dict(key="body", S=S, h_hi=0.0042 * hq, h_lo=0.011 * (1.2 if FAST else 1.0), tris=15200, bind=('skin', body_bones),
                 uv=(66.0, 1.0), ext=(0.02, 0.05), h_prev=0.012),
            dict(key="crest", S=crest_sculpt(), h_hi=0.0016 * hq, h_lo=0.0035, tris=1700, bind=('rigid', 'head'), uv=(62.0, 1.2), ext=(0.006, 0.015), h_prev=0.004),
            dict(key="teeth", S=teeth_sculpt(), h_hi=0.0012 * hq, h_lo=0.0026, tris=1000, bind=('rigid', 'head'), uv=(62.0, 1.0), ext=(0.004, 0.01), islands=False, h_prev=0.003),
            dict(key="jaw", S=jaw_sculpt(), h_hi=0.0016 * hq, h_lo=0.004, tris=1500, bind=('rigid', 'jaw'), uv=(62.0, 1.3), ext=(0.006, 0.015), islands=False, h_prev=0.004),
            dict(key="eyes", S=eye_sculpt(), h_hi=0.001 * hq, h_lo=0.004, tris=360, bind=('rigid', 'head'), uv=(66.0, 3.0), ext=(0.004, 0.01), h_prev=0.003),
            dict(key="saddle", S=Ssad, h_hi=0.0022 * hq, h_lo=0.0045, tris=2600, bind=('rigid', 'spine_2'), uv=(62.0, 1.0), ext=(0.008, 0.02), h_prev=0.006),
            dict(key="collar", S=Scol, h_hi=0.002 * hq, h_lo=0.0045, tris=600, bind=('rigid', 'neck_1'), uv=(62.0, 1.0), ext=(0.006, 0.015), h_prev=0.006)]
    for L in ('L', 'R'):
        jobs.append(dict(key=f"claw_h_{L}", S=claw_sculpt(TOE_TIPS[L], 0.026), h_hi=0.0009 * hq, h_lo=0.0022, tris=330, bind=('rigid', f'toe_{L}'),
                         sym=False, uv=(62.0, 1.3), ext=(0.004, 0.01), islands=False, h_prev=0.003))
        jobs.append(dict(key=f"claw_f_{L}", S=claw_sculpt(FINGER_TIPS[L], 0.016), h_hi=0.0008 * hq, h_lo=0.0018, tris=240, bind=('rigid', f'finger_{L}'),
                         sym=False, uv=(62.0, 1.3), ext=(0.003, 0.008), islands=False, h_prev=0.0025))
    if PREVIEW:
        cols = {"scale": (0.15, 0.35, 0.8), "scale_fine": (0.2, 0.42, 0.85), "belly": (0.55, 0.8, 0.75), "spine": (0.5, 0.75, 0.9),
                "horn": (0.9, 0.86, 0.72), "mouth": (0.6, 0.15, 0.2), "frill": (0.4, 0.7, 0.95), "teeth": (0.95, 0.93, 0.85),
                "eye": (0.9, 0.2, 0.05), "claw": (0.9, 0.9, 0.86), "cloth": (0.45, 0.33, 0.18), "brass": (0.9, 0.7, 0.3), "leather": (0.35, 0.2, 0.1)}
        out = os.path.join(K.ROOT, "progress", "shots", "mounts", "r2", f"{KIND}_clay.png")
        tgt = tuple(J(0, 1.1, -0.1))
        BK.preview(ASSET, jobs, out, [dict(target=tgt, ortho=3.6, yaw=90, dist=8, pitch=2), dict(target=tgt, ortho=3.6, yaw=35, dist=8, pitch=12),
                                      dict(target=tuple(J(0, 1.86, 0.95)), ortho=0.9, yaw=55, dist=6, pitch=8)], cols)
        K.LOG(f"[{KIND}] preview -> {out} ({time.time() - t0:.0f}s)")
        return
    arm = K.make_armature(ASSET, bones(seat))
    rep = {"seat": seat}
    BK.bake_build(ASSET, arm, jobs, PAINTERS, PAL, fast=FAST,
                  extra={"eyes": [(tuple(jv(add(EYES[s][0], sc(EYES[s][1], 0.008)))), tuple(jv(tuple(EYES[s][1])))) for s in (1, -1)]},
                  stretch_poses=[{'neck_1': (20, 0, 0), 'neck_2': (-15, 0, 0), 'head': (15, 0, 0), 'jaw': (25, 0, 0)},
                                 {'thigh_L': (30, 0, 0), 'shin_L': (-30, 0, 0), 'metatarsal_L': (30, 0, 0), 'upperarm_R': (30, 0, 0)},
                                 {'tail_1': (0, 0, 20), 'tail_2': (0, 0, 20), 'tail_3': (0, 0, 20), 'tail_4': (0, 0, 20)}],
                  report=rep)
    K.LOG(f"[{KIND}] total {time.time() - t0:.0f}s seat={seat}")


main()
