"""Cluckhorn (bizarrian mount, GA 'chicken leg' analogue) -> public/assets/models/mount_cluckhorn.glb (+ textures)

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P blender/build_mount_cluckhorn.py
    env: MOUNT_FAST=1 (1K atlas, coarse voxels)   MOUNT_PREVIEW=1 (clay look-dev PNG only)

r2 (critic r1: primitive soup) -- full baked pipeline (blender/build_mount_bake.py). Plump barrel sheathed in LAYERED
feather clumps (hundreds of overlapping leaf-shaped feathers sculpted onto the body, rows shingling back/down, darker
barred tips; cream breast down), folded wing coverts + primaries, a sickle-feather rump plume; long digitigrade legs
with ring scutes, scaly toes, curved talons and spurs; big hooked horned beak (nose horn, keratin grain, nostril),
red comb + wattle, glossy amber eyes with lids; spiked brass collar; a tail ending in a bone club armoured with
overlapping plates and iron spikes; bridle (noseband + headstall + brass rings) and saddle (felt blanket, leather
seat/cantle/pommel, girth, stirrups). Rig/joints unchanged (match src/mounts/types/cluckhorn.js pose driver).
Value plan: cream breast (light) / tawny flanks (mid) / chestnut back + near-black barred tips (dark); yellow beak and
legs and red comb/blanket are the saturated accents.
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
from lib.sdf import (Sculpt, Sphere, Ellipsoid, RoundCone, Chain, Torus, RoundBox, Inter, Shell, Offset, Snapshot, Slab,
                     Bounded, Diff, basis, V, norm)

J, jv = K.J, K.jv
FAST = os.environ.get("MOUNT_FAST") == "1"
PREVIEW = os.environ.get("MOUNT_PREVIEW") == "1"
ASSET = "mount_cluckhorn"
sr = shaders.srgb
PAL = dict(back=sr(104, 52, 24), flank=sr(170, 106, 52), cream=sr(238, 214, 170), tip=sr(40, 22, 12),
           leg=sr(238, 170, 40), leg_dark=sr(120, 70, 14), beak=sr(240, 180, 50), beak_dark=sr(130, 80, 20),
           comb=sr(196, 40, 36), comb_dark=sr(90, 12, 14), horn=sr(236, 224, 196), horn_dark=sr(90, 76, 60),
           claw=sr(60, 52, 46), claw_dark=sr(20, 16, 14), iron=sr(70, 70, 78), iris=sr(236, 120, 20), iris2=sr(255, 210, 90),
           sclera=sr(40, 20, 8), mouth=sr(150, 50, 50), gum=sr(180, 80, 80), leather=sr(110, 44, 26), leather_dark=sr(46, 18, 10),
           cloth=sr(150, 38, 30), cloth_dark=sr(70, 16, 12), brass=sr(232, 180, 78), plume=sr(64, 46, 30))


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sc(a, k):
    return tuple(x * k for x in a)


P = {'root': (0, 0, 0), 'hips': (0, 1.05, -0.05), 'spine_1': (0, 1.10, 0.15), 'spine_2': (0, 1.13, 0.35), 'chest': (0, 1.13, 0.57),
     'neck_1': (0, 1.31, 0.77), 'neck_2': (0, 1.57, 0.85), 'neck_3': (0, 1.81, 0.87), 'head': (0, 1.97, 0.93), 'jaw': (0, 1.93, 1.03),
     'tail_1': (0, 1.17, -0.67), 'tail_2': (0, 1.20, -0.93), 'tail_3': (0, 1.20, -1.19), 'tail_4': (0, 1.18, -1.43),
     'tail_5': (0, 1.15, -1.65), 'tail_6': (0, 1.13, -1.85)}
for s, L in ((1, 'L'), (-1, 'R')):
    P[f'thigh_{L}'] = (0.30 * s, 1.03, 0.00); P[f'shin_{L}'] = (0.30 * s, 0.66, 0.17)
    P[f'metatarsal_{L}'] = (0.30 * s, 0.40, -0.11); P[f'foot_{L}'] = (0.30 * s, 0.07, -0.13); P[f'toe_{L}'] = (0.30 * s, 0.05, -0.09)
CLUB = (0, 1.12, -2.1)


def bones(seat):
    B = [('root', P['root'], (0, 0.3, 0), None, False), ('hips', P['hips'], P['spine_1'], 'root', True),
         ('spine_1', P['spine_1'], P['spine_2'], 'hips', True), ('spine_2', P['spine_2'], P['chest'], 'spine_1', True),
         ('chest', P['chest'], P['neck_1'], 'spine_2', True), ('neck_1', P['neck_1'], P['neck_2'], 'chest', True),
         ('neck_2', P['neck_2'], P['neck_3'], 'neck_1', True), ('neck_3', P['neck_3'], P['head'], 'neck_2', True),
         ('head', P['head'], (0, 2.02, 1.22), 'neck_3', True), ('jaw', P['jaw'], (0, 1.9, 1.22), 'head', True),
         ('socket_saddle', seat, add(seat, (0, 0, 0.2)), 'spine_2', False),
         ('socket_mouth', (0, 1.92, 1.3), (0, 1.92, 1.45), 'head', False)]
    prev = 'hips'
    for i in range(1, 7):
        nxt = P[f'tail_{i + 1}'] if i < 6 else (0, 1.12, -2.12)
        B.append((f'tail_{i}', P[f'tail_{i}'], nxt, prev, True)); prev = f'tail_{i}'
    for L in ('L', 'R'):
        B += [(f'thigh_{L}', P[f'thigh_{L}'], P[f'shin_{L}'], 'hips', True),
              (f'shin_{L}', P[f'shin_{L}'], P[f'metatarsal_{L}'], f'thigh_{L}', True),
              (f'metatarsal_{L}', P[f'metatarsal_{L}'], P[f'foot_{L}'], f'shin_{L}', True),
              (f'foot_{L}', P[f'foot_{L}'], P[f'toe_{L}'], f'metatarsal_{L}', True),
              (f'toe_{L}', P[f'toe_{L}'], add(P[f'toe_{L}'], (0, -0.02, 0.24)), f'foot_{L}', True)]
    return B


def E(c, r, M=None):
    return Ellipsoid(jv(c), r, M)


def RC(a, b, ra, rb=None, **kw):
    return RoundCone(jv(a), jv(b), ra, rb, **kw)


def CH(pts, radii, **kw):
    return Chain([jv(p) for p in pts], radii, **kw)


TOE_TIPS = {}
EYES = {}
BASE = [None]


def feather(S, c_js, n_js, flow_js, w, l, t=0.018, mat="feather", k=0.006):
    """Leaf-shaped feather lying on the surface at c (normal n), pointing along flow; slightly lifted tip."""
    n = norm(np.array(n_js, float)); f = np.array(flow_js, float)
    f = norm(f - n * float(np.dot(f, n)))
    c = np.array(c_js) + f * l * 0.45 + n * (t * 0.35)
    M = basis(np.array(jv(tuple(f))), np.array(jv(tuple(n))))       # col0 = flow, col1 = normal, col2 = across
    S.add(Ellipsoid(jv(tuple(c)), (l, t, w), M), k, mat=mat)


def body_sculpt():
    """r3 (critic r2: torn-cardboard plumage). LO = continuous feathered-skin base -- the smooth body plus THICK
    feather-group masses (neck mantle + shingled hackle lobes, rump coverts, folded-wing coverts) that survive
    decimation; HI (returned) = LO + hundreds of individual feathers lying on the LO surface, which only feed the
    normal/albedo bake. The only real feather geometry left are the closed hero cards (wing primaries, sickle plume)."""
    S = Sculpt(materials=("feather", "down", "leg", "claw", "horn", "comb"), default_mat="feather")
    S.add(E((0, 1.16, 0.06), (0.45, 0.62, 0.43)), 0.0)
    S.add(E((0, 1.08, 0.46), (0.36, 0.33, 0.40)), 0.14, mat="down")
    S.add(E((0, 0.95, 0.16), (0.37, 0.42, 0.28)), 0.12, mat="down")
    S.add(E((0, 1.24, -0.42), (0.35, 0.33, 0.32)), 0.14)
    S.add(Chain([jv(P['chest']), jv((0, 1.36, 0.72)), jv((0, 1.6, 0.83)), jv((0, 1.82, 0.87)), jv((0, 1.96, 0.93))],
                [0.27, 0.22, 0.18, 0.16, 0.15], k=0.05), 0.1)
    S.add(E((0, 1.42, 0.74), (0.28, 0.21, 0.19)), 0.08)
    S.add(E((0, 2.01, 0.96), (0.17, 0.21, 0.17)), 0.06)
    for s in (1, -1):
        S.add(E((0.12 * s, 1.93, 0.92), (0.07, 0.1, 0.09)), 0.04)
        S.add(RC((0.07 * s, 2.088, 1.06), (0.125 * s, 2.078, 0.93), 0.026, 0.032), 0.02)        # heavy brow
        c = (0.13 * s, 2.035, 1.02); n = norm(np.array([0.9 * s, 0.15, 0.4]))
        ec = add(c, sc(n, -0.004))                                    # eyeball centre
        EYES[s] = (ec, n)
        S.add(Sphere(jv(ec), 0.056), 0.02)                            # orbit bulge
    S.add(E((0, 1.94, 1.03), (0.12, 0.13, 0.09)), 0.05)
    lid_n = norm(np.array(jv((0, 1, 0))) + np.array(jv((0, 0, -0.2))))
    for s in (1, -1):
        ec, n = EYES[s]
        S.sub(Sphere(jv(ec), 0.049), 0.004)                           # socket
        S.sub(Inter(Sphere(jv(add(ec, sc(n, 0.05))), 0.062), Slab(jv(ec), lid_n, 0.026)), 0.006)   # open lid slit
        S.add(Diff(Shell(Sphere(jv(ec), 0.0535), 0.0055), Slab(jv(ec), lid_n, 0.025)), 0.004, mat="comb")  # lids
    tp = [P['tail_1'], P['tail_2'], P['tail_3'], P['tail_4'], P['tail_5'], P['tail_6'], (0, 1.12, -2.02)]
    S.add(Chain([jv((0, 1.2, -0.5))] + [jv(p) for p in tp], [0.24, 0.2, 0.17, 0.14, 0.12, 0.1, 0.085, 0.075], k=0.03), 0.1)
    for i in range(1, 6):                                            # dorsal horn scutes shingling down the tail
        for f_ in (0.0, 0.5):
            p = np.array(P[f'tail_{i}']) * (1 - f_) + np.array(P[f'tail_{i + 1}']) * f_
            q = BK.ray_out(S, tuple(p), (0, 1, 0), r_max=0.4)
            tg = norm(np.array(P[f'tail_{i + 1}']) - np.array(P[f'tail_{i}']))
            M = basis(np.array(jv(tuple(-tg))), np.array(jv((0, 1, 0))))
            S.add(Ellipsoid(jv(add(q, (0, -0.008, 0))), (0.075, 0.02, 0.07 - 0.006 * i), M), 0.006, mat="horn")
    for s, L in ((1, 'L'), (-1, 'R')):
        S.add(E((0.3 * s, 0.93, 0.07), (0.19, 0.24, 0.27)), 0.1)
        S.add(Chain([jv((0.3 * s, 0.8, 0.12)), jv(P[f'shin_{L}'])], [0.14, 0.095], k=0.02), 0.05)
        S.add(Chain([jv(P[f'shin_{L}']), jv(P[f'metatarsal_{L}']), jv(P[f'foot_{L}'])], [0.075, 0.055, 0.046], k=0.02), 0.03, mat="leg")
        S.add(Sphere(jv(P[f'metatarsal_{L}']), 0.064), 0.03, mat="leg")
        m0, f0 = np.array(P[f'metatarsal_{L}']), np.array(P[f'foot_{L}'])
        for i in range(8):
            t = 0.1 + i * 0.11
            c = m0 * (1 - t) + f0 * t
            S.add(E(tuple(c + np.array([0, 0, 0.034])), (0.05, 0.02, 0.022)), 0.006, mat="leg")
        f = P[f'foot_{L}']
        tips = []
        for a in (-0.55, 0.0, 0.55):
            d = np.array([math.sin(a), 0, math.cos(a)])
            b0 = (f[0], 0.05, f[2])
            pts = [b0] + [add(b0, tuple(d * (0.09 * j) + np.array([0, -0.006 * j, 0]))) for j in (1, 2, 3)]
            S.add(CH(pts, [0.042, 0.034, 0.03, 0.024], k=0.01), 0.02, mat="leg")
            for j in (1, 2, 3):
                S.add(E(add(pts[j], (0, 0.018, 0)), (0.03, 0.026, 0.016)), 0.006, mat="leg")
            tips.append((pts[-1], d))
        S.add(RC((f[0], 0.05, f[2]), (f[0], 0.03, f[2] - 0.13), 0.034, 0.022), 0.02, mat="leg")
        tips.append(((f[0], 0.03, f[2] - 0.13), np.array([0, 0, -1.0])))
        TOE_TIPS[L] = tips
        m = P[f'metatarsal_{L}']
        S.add(RC((m[0], 0.28, m[2] - 0.02), (m[0], 0.25, m[2] - 0.15), 0.02, 0.003), 0.01, mat="claw")   # spur
    BASE[0] = Snapshot(S)                                            # smooth body (tack conforms to this)

    def under_blanket(q):
        return (q[0] / 0.78) ** 2 + ((q[1] - 1.5) / 0.38) ** 2 + ((q[2] - 0.30) / 0.33) ** 2 < 1.0

    # ---- LO feather-group masses: thick (>= 5 lo voxels), generously blended -> one continuous skin
    S.add(E((0, 1.50, 0.76), (0.30, 0.22, 0.24)), 0.09)              # neck mantle (hackle mass over the collar)
    for i, y in enumerate((1.50, 1.63, 1.76, 1.88)):                  # shingled hackle lobes, 4 tiers
        nl = 15 - i
        for j in range(nl):
            a = math.radians(-150 + 300 * (j + 0.5 * (i % 2)) / (nl - 0.5))
            zc = 0.73 + (y - 1.42) * 0.3
            d = (math.sin(a), 0.0, math.cos(a))
            if d[2] > 0.55 and y < 1.7:
                continue                                              # throat/breast front stays cream down
            q = BK.ray_out(S, (0, y, zc), d, r_max=0.5)
            nrm = norm(np.array([d[0], 0.25, d[2]]))
            feather(S, q, nrm, (0, -1.0, -0.15), 0.05 - 0.004 * i, 0.105 - 0.008 * i, t=0.022, k=0.02)
    S.add(E((0, 1.36, -0.50), (0.30, 0.30, 0.19)), 0.10)              # rump / tail-covert mass
    ctr = (0, 1.16, 0.02)
    for r, el in enumerate((8, 30, 52)):                              # rump covert lobes shingling back over the tail root
        for j in range(7 - r):
            az = -62 + 124 * (j + 0.5) / (7 - r)
            e, a = math.radians(el), math.radians(az)
            d = (math.cos(e) * math.sin(a) * 0.9, math.sin(e), -math.cos(e) * math.cos(a))
            q = BK.ray_out(S, ctr, d, r_max=0.95)
            if under_blanket(q):
                continue
            nrm = norm(np.array(q) - np.array(ctr))
            feather(S, q, nrm, (0, -0.3, -1.0), 0.07, 0.12, t=0.024, k=0.03)
    for s in (1, -1):                                                 # folded wing mass + covert lobes
        S.add(E((0.43 * s, 1.26, -0.02), (0.40, 0.12, 0.21), basis(V(0, -1, -0.3), V(s * 1.0, 0, 0))), 0.06)
        for i in range(4):
            q = BK.ray_out(S, (0.3 * s, 1.34 - i * 0.03, 0.2 - i * 0.12), (s, 0.35, 0), r_max=0.5)
            feather(S, q, (s, 0.35, 0), (0, -0.15, -1.0), 0.07, 0.13, t=0.03, k=0.03)
    LO = Sculpt(materials=S.materials, default_mat="feather")
    LO.ops, LO.paint_channels = list(S.ops), list(S.paint_channels)
    LOW[0] = LO

    def in_down(q):                                                   # feathers over the cream down stay cream
        return ((q[0] / 0.40) ** 2 + ((q[2] - 0.46) / 0.37) ** 2 + ((q[1] - 1.08) / 0.44) ** 2 < 1.0 or
                (q[0] / 0.41) ** 2 + ((q[2] - 0.16) / 0.46) ** 2 + ((q[1] - 0.95) / 0.31) ** 2 < 1.0)

    # ---- HI-only detail: individual feathers lying ON the lo skin (baked to normal + albedo, never meshed)
    rows = 0
    for el in np.linspace(-15, 88, 10):
        n_az = int(9 + 13 * math.cos(math.radians(el)))
        for j in range(n_az * 2):
            az = -175 + 350 * (j + 0.5 * (rows % 2)) / (n_az * 2)
            if abs(az) > 150 and el < 30:
                continue
            e, a = math.radians(el), math.radians(az)
            d = (math.cos(e) * math.sin(a) * 0.9, math.sin(e), -math.cos(e) * math.cos(a))
            q = BK.ray_out(LO, ctr, d, r_max=0.95)
            if q[1] < 0.85 or q[2] > 0.62 or under_blanket(q) or (q[1] < 1.02 and q[2] > 0.15):
                continue
            nrm = norm(np.array(q) - np.array(ctr))
            w = 0.05 + 0.025 * math.cos(e)
            feather(S, q, nrm, (0, -0.35, -1.0), w * 0.75, (0.10 + 0.03 * math.cos(e)) * 1.2, t=0.011,
                    mat="down" if in_down(q) else "feather")
        rows += 1
    for i, y in enumerate(np.linspace(1.44, 1.94, 11)):               # fine hackles over the lobes
        for j in range(18):
            a = math.radians(-155 + 310 * (j + 0.5 * (i % 2)) / 18)
            zc = 0.73 + (y - 1.42) * 0.3
            d = (math.sin(a), 0.0, math.cos(a))
            if d[2] > 0.55 and y < 1.7:
                continue
            q = BK.ray_out(LO, (0, y, zc), d, r_max=0.5)
            nrm = norm(np.array([d[0], 0.2, d[2]]))
            feather(S, q, nrm, (0, -1.0, -0.2), 0.026, 0.07, t=0.009)
    return S


LOW = [None]


def hero_sculpts():
    """Hero feather cards: few, overlapping, genuinely thick CLOSED solids (never single-sided) -> rigid on hips.
    wings: 5 folded primaries per side over the wing mass, tips crossing the rump. plume: 3 sickle feathers."""
    lo = LOW[0]
    W = Sculpt(materials=("feather", "plume"), default_mat="feather")
    for s in (1, -1):
        for i in range(5):
            q = BK.ray_out(lo, (0.32 * s, 1.30 - i * 0.035, 0.02 - i * 0.07), (s, 0.2 - 0.05 * i, 0), r_max=0.5)
            n = norm(np.array([s, 0.2 - 0.05 * i, 0.0]))
            f = norm(np.array([0, -0.22 - 0.05 * i, -1.0]))
            f = norm(f - n * float(np.dot(f, n)))
            l, t, w = 0.19 + 0.02 * i, 0.012, 0.045
            c = np.array(q) + f * l * 0.55 + n * (0.004 + 0.009 * (4 - i))   # upper primaries stack over the lower
            M = basis(np.array(jv(tuple(f))), np.array(jv(tuple(n))))
            W.add(Ellipsoid(jv(tuple(c)), (l, t, w), M), 0.004)
            W.add(RC(tuple(c - f * l * 0.9 + n * 0.008), tuple(c + f * l * 0.85 + n * 0.008), 0.006, 0.002), 0.003, mat="plume")  # rachis
    P2 = Sculpt(materials=("plume",), default_mat="plume")
    for i in range(5):                                               # rooster sickles: long, broad, arching back + down
        a = (i - 2) * 0.22
        o = abs(i - 2)
        L_ = 1.0 - 0.14 * o
        base = (math.sin(a) * 0.08, 1.42, -0.48)
        mid = (math.sin(a) * 0.20, 1.70 - 0.05 * o, -0.52 - 0.30 * L_)
        tip = (math.sin(a) * 0.28, 1.62 - 0.08 * o, -0.52 - 0.66 * L_)
        end = (math.sin(a) * 0.30, 1.40 - 0.08 * o, -0.52 - 0.84 * L_)
        P2.add(CH([base, mid, tip, end], [0.045, 0.066, 0.05, 0.024], squash=(0.36, 1.0), ref=(1, 0, 0), k=0.02), 0.025)
    return W, P2


def beak_sculpt():
    S = Sculpt(materials=("beak", "horn", "comb", "mouth", "leather", "brass"), default_mat="beak")
    S.add(RC((0, 2.0, 1.08), (0, 1.96, 1.4), 0.1, 0.035, squash=(0.8, 1.0), ref=(0, 0, 1)), 0.0)
    S.add(RC((0, 1.96, 1.38), (0, 1.87, 1.46), 0.036, 0.01), 0.02)
    S.add(RC((0, 2.04, 1.16), (0, 2.17, 1.23), 0.04, 0.005), 0.02, mat="horn")                    # nose horn
    S.add(RC((0, 2.07, 1.08), (0, 2.12, 1.1), 0.032, 0.012), 0.015, mat="horn")
    for s in (1, -1):
        S.sub(E((0.05 * s, 2.03, 1.2), (0.012, 0.025, 0.01)), 0.004)                               # nostril
        S.add(RC((0.07 * s, 1.955, 1.08), (0.03 * s, 1.94, 1.36), 0.01, 0.004), 0.004, mat="beak")  # tomium edge
    S.paint_mat(RoundBox(jv((0, 1.93, 1.2)), (0.2, 0.3, 0.015), None, 0.0), "mouth")
    for i in range(5):
        S.add(Ellipsoid(jv((0, 2.16 - i * 0.015, 1.0 - i * 0.07)), (0.014, 0.045, 0.062 - i * 0.006)), 0.02, mat="comb")
    S.add(Ellipsoid(jv((0, 1.83, 1.08)), (0.03, 0.03, 0.05)), 0.02, mat="comb")
    # bridle: noseband behind the beak root, headstall over the crown, brass rings at the cheeks
    for (zc, yc, tilt) in ((1.07, 1.99, 0.35), (0.86, 2.02, -0.3)):
        ring = []
        for k in range(16):
            a = k / 16 * math.tau
            ring.append((math.sin(a) * 0.2, yc + math.cos(a) * 0.19, zc + math.cos(a) * 0.19 * tilt))
        pts = []
        for p in ring:
            d = norm(np.array(p) - np.array((0, yc, zc)))
            q = np.array(BK.ray_out(Snap_head, (0, yc, zc), tuple(d), r_max=0.35))
            pts.append(tuple(q + d * 0.008))
        pts.append(pts[0])
        S.add(CH(pts, 0.011, k=0.004), 0.0, mat="leather")
    for s in (1, -1):
        S.add(Torus(jv((0.155 * s, 1.95, 1.0)), 0.028, 0.007, basis(np.array(jv((0, 1, 0))), np.array(jv((0, 0, 1))))), 0.0, mat="brass")
    return S


Snap_head = None


def jaw_sculpt():
    S = Sculpt(materials=("beak", "mouth"), default_mat="beak")
    S.add(RC((0, 1.9, 1.07), (0, 1.88, 1.28), 0.06, 0.02, squash=(0.7, 1.0), ref=(0, 0, 1)), 0.0)
    S.sub(RC((0, 1.935, 1.1), (0, 1.925, 1.25), 0.04, 0.012, squash=(0.6, 1.0), ref=(0, 0, 1)), 0.006)
    S.paint_mat(RoundBox(jv((0, 1.92, 1.17)), (0.2, 0.2, 0.02), None, 0.0), "mouth")
    return S


def eye_sculpt():
    S = Sculpt(materials=("eye",), default_mat="eye")
    for s in (1, -1):
        c, n = EYES[s]
        S.add(Sphere(jv(c), 0.046), 0.0)                              # r3: big glossy eyeball in the lidded socket
    return S


def club_sculpt():
    S = Sculpt(materials=("horn", "iron"), default_mat="horn")
    S.add(E(CLUB, (0.19, 0.24, 0.17)), 0.0)
    # overlapping armour plates in rings around the club
    for ring in range(4):
        z = CLUB[2] + 0.14 - ring * 0.09
        n = 7
        for k in range(n):
            a = (k + 0.5 * (ring % 2)) / n * math.tau
            d = (math.cos(a), math.sin(a), 0)
            q = BK.ray_out(S, (0, CLUB[1], z), d, r_max=0.4)
            M = basis(np.array(jv((0, 0, -1))), np.array(jv(d)))
            S.add(Ellipsoid(jv(add(q, sc(d, -0.005))), (0.06, 0.022, 0.075), M), 0.006)
    for i in range(12):
        a = i / 12 * math.tau
        zz = CLUB[2] + (0.06 if i % 2 else -0.08)
        d = (math.cos(a), math.sin(a), 0)
        q = BK.ray_out(S, (0, CLUB[1], zz), d, r_max=0.4)
        S.add(RC(add(q, sc(d, -0.01)), add(q, sc(d, 0.15)), 0.034, 0.003), 0.01, mat="iron")
    S.add(RC((0, 1.12, -2.3), (0, 1.12, -2.48), 0.04, 0.003), 0.01, mat="iron")
    return S


def claw_sculpt(tips):
    S = Sculpt(materials=("claw",), default_mat="claw")
    for tp, d in tips:
        d = np.array(d, float)
        a = add(tp, tuple(d * -0.012 + np.array([0, 0.006, 0])))
        b = add(tp, tuple(d * 0.04 + np.array([0, 0.004, 0])))
        c = add(tp, tuple(d * 0.075 + np.array([0, -0.03, 0])))
        S.add(CH([a, b, c], [0.024, 0.016, 0.002], squash=(1.0, 0.65), ref=(0, 0, 1), k=0.004), 0.0)
    return S


def tack_sculpts(body):
    snap = BASE[0]
    S = Sculpt(materials=("cloth", "brass", "leather"), default_mat="cloth")
    region = E((0, 1.50, 0.30), (0.75, 0.30, 0.36))
    blo, bhi = np.array(jv((-0.6, 0.8, 0.7))), np.array(jv((0.6, 1.75, -0.1)))
    blo, bhi = np.minimum(blo, bhi), np.maximum(blo, bhi)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.03), 0.010), region), blo, bhi), 0.0)
    rim = Shell(E((0, 1.50, 0.30), (0.75, 0.30, 0.36)), 0.018)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.036), 0.011), rim), blo - 0.05, bhi + 0.05), 0.0, mat="brass")
    top = np.array(BK.ray_out(body, (0, 1.2, 0.33), (0, 1, 0)))
    seat_c = add(tuple(top), (0, 0.075, 0.0))
    S.add(E(seat_c, (0.22, 0.24, 0.06)), 0.03, mat="leather")
    S.add(E(add(seat_c, (0, 0.06, -0.21)), (0.2, 0.05, 0.09)), 0.03, mat="leather")
    S.add(RC(add(seat_c, (0, 0.0, 0.21)), add(seat_c, (0, 0.12, 0.25)), 0.034, 0.026), 0.02, mat="leather")
    S.add(Sphere(jv(add(seat_c, (0, 0.14, 0.255))), 0.038), 0.006, mat="brass")
    slab = Slab(np.array(jv((0, 1.0, 0.36))), np.array(jv((0, 0, 1.0))), 0.034)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.036), 0.008), slab), blo - 0.1, bhi + 0.1), 0.0, mat="leather")
    for s in (1, -1):
        pts = []
        for ang in (25, 50, 72, 88):
            a = math.radians(ang)
            q = np.array(BK.ray_out(body, (0, 1.2, 0.33), (s * math.sin(a), math.cos(a), 0)))
            pts.append(tuple(q + np.array([s * math.sin(a), math.cos(a), 0]) * 0.05))
        low = add(pts[-1], (0.03 * s, -0.2, 0))
        pts.append(low)
        S.add(CH(pts, 0.012, squash=(1.0, 0.35), k=0.004), 0.0, mat="leather")
        rc = add(low, (0.0, -0.06, 0))
        Mr = basis(np.array(jv((0, 0, 1))), np.array(jv((1, 0, 0))))
        S.add(Torus(jv(rc), 0.058, 0.011, Mr, 1.0), 0.0, mat="brass")
        S.add(RoundBox(jv(add(rc, (0, -0.055, 0))), (0.03, 0.05, 0.01), None, 0.006), 0.004, mat="brass")
    # spiked collar at the neck base (rigid neck_1)
    C = Sculpt(materials=("brass", "iron"), default_mat="brass")
    c = np.array(jv((0, 1.36, 0.76))); ax = norm(np.array(jv((0, 1.62, 0.85))) - c)
    lo_, hi_ = c - 0.45, c + 0.45
    C.add(Bounded(Inter(Shell(Offset(snap, 0.03), 0.02), Slab(c, ax, 0.045)), lo_, hi_), 0.0)
    for k in (-1, 1):
        C.add(Bounded(Inter(Shell(Offset(snap, 0.05), 0.006), Slab(c + ax * 0.04 * k, ax, 0.008)), lo_, hi_), 0.004)
    Mx = basis(ax, np.array([1.0, 0, 0]))
    for i in range(10):
        a = i / 10 * math.tau
        d = Mx[:, 1] * math.cos(a) + Mx[:, 2] * math.sin(a)
        q = np.array(jv(BK.ray_out(body, (0, 1.36, 0.76), (float(d[0]), float(d[2]), float(-d[1])), r_max=0.5)))
        C.add(RoundCone(q + d * 0.03, q + d * 0.15, 0.026, 0.003), 0.008, mat="iron")
    return S, C


# ---------------------------------------------------------------- painters
def p_feather(c, pal):
    up = c.N[:, 2]
    rgb = shaders.mix(pal["flank"], pal["back"], shaders.smooth01(up, -0.2, 0.8))
    n1 = c.noise(4.0, 3, 41)
    rgb = rgb * (0.88 + 0.22 * n1)[:, None]
    bar = shaders.smooth01(np.sin(c.P[:, 1] * 38.0 + 3 * c.noise(6.0, 2, 42)), 0.5, 0.9)
    rgb = shaders.mix(rgb, pal["tip"], 0.3 * bar)
    rgb = shaders.mix(rgb, pal["tip"], shaders.smooth01(c.cav, 0.04, 0.5) * 0.6)           # shade under each lifted edge
    rgb = shaders.mix(rgb, np.minimum(pal["flank"] * 1.5, 1), 0.45 * c.ridge)               # pale feather edges
    (e0, _), (e1, _) = c.x["eyes"]                                  # bare red face skin round the eyes (soft edge)
    de = np.minimum(np.linalg.norm(c.P - np.array(e0)[None], axis=1), np.linalg.norm(c.P - np.array(e1)[None], axis=1))
    rgb = shaders.mix(rgb, pal["comb"] * (0.9 + 0.2 * n1)[:, None], 1.0 - shaders.smooth01(de, 0.062, 0.088))
    bel = shaders.smooth01(-up, 0.2, 0.7)
    rgb = shaders.mix(rgb, pal["cream"], 0.6 * bel)
    return shaders.out(c.n, rgb, 0.8)


def p_down(c, pal):
    rgb = np.tile(pal["cream"], (c.n, 1)) * (0.9 + 0.14 * c.noise(10.0, 3, 43))[:, None]
    rgb = shaders.mix(rgb, pal["flank"], shaders.smooth01(c.cav, 0.05, 0.5) * 0.6)
    return shaders.out(c.n, rgb, 0.9)


def p_leg(c, pal):
    rgb = np.tile(pal["leg"], (c.n, 1)) * (0.9 + 0.15 * c.noise(20.0, 2, 44))[:, None]
    rgb = shaders.mix(rgb, pal["leg_dark"], shaders.smooth01(c.cav, 0.02, 0.35) * 0.9)
    rgb = shaders.mix(rgb, np.minimum(pal["leg"] * 1.2, 1), 0.3 * c.ridge)
    return shaders.out(c.n, rgb, 0.5)


def p_beak(c, pal):
    rgb = shaders.mix(pal["beak"], pal["beak_dark"], 0.25 * c.noise(30.0, 2, 45) + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["beak"] * 1.2, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, 0.35)


def p_comb(c, pal):
    rgb = shaders.mix(pal["comb"], pal["comb_dark"], 0.3 * c.noise(25.0, 2, 46) + 0.7 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.45)


def p_horn(c, pal):
    rgb = shaders.mix(pal["horn"], pal["horn_dark"], 0.3 * c.noise(30.0, 2, 47) + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.45)


def p_claw(c, pal):
    rgb = shaders.mix(pal["claw"], pal["claw_dark"], 0.8 * shaders.smooth01(c.cav, 0.0, 0.35))
    return shaders.out(c.n, rgb, 0.3)


def p_iron(c, pal):
    n1 = c.noise(20.0, 3, 48)
    rgb = shaders.mix(pal["iron"], pal["iron"] * 0.35, 0.3 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["iron"] * 2.0, 1), 0.5 * c.ridge)
    return shaders.out(c.n, rgb, 0.35 + 0.2 * n1, 0.85)


def p_mouth(c, pal):
    return shaders.out(c.n, shaders.mix(pal["gum"], pal["mouth"], 0.6 * shaders.smooth01(c.cav, 0.0, 0.4)), 0.3)


def p_eye(c, pal):
    """r3: readable bird eye -- dark limbal ring, amber iris with radial streaks + bright inner ring, small black
    pupil and a painted catchlight (up-front) so it reads under any stage light."""
    (c0, n0), (c1, n1) = c.x["eyes"]
    left = (c.P[:, 0] > 0)[:, None]
    ce = np.where(left, np.array(c0)[None], np.array(c1)[None])
    ne = np.where(left, np.array(n0)[None], np.array(n1)[None])
    v = c.P - ce
    vn = v / np.maximum(np.linalg.norm(v, axis=1), 1e-6)[:, None]
    cosang = np.sum(vn * ne, axis=1)
    streak = c.noise(90.0, 2, 52)
    rgb = shaders.mix(pal["sclera"], pal["iris"] * (0.8 + 0.35 * streak)[:, None], shaders.smooth01(cosang, 0.5, 0.62))
    rgb = shaders.mix(rgb, pal["iris2"], shaders.smooth01(cosang, 0.84, 0.93) * 0.8)
    rgb = shaders.mix(rgb, np.array([0.004, 0.003, 0.003]), shaders.smooth01(cosang, 0.945, 0.96))
    hl = ne + np.array([0.0, -0.35, 0.55])[None]                       # catchlight: toward camera-up (blender -Y fwd, +Z up)
    hl = hl / np.linalg.norm(hl, axis=1)[:, None]
    spot = shaders.smooth01(np.sum(vn * hl, axis=1), 0.975, 0.985)
    rgb = shaders.mix(rgb, np.array([1.0, 0.97, 0.9]), spot)
    return shaders.out(c.n, rgb, 0.06)


def p_plume(c, pal):
    """Sickle / primary feathers: near-black with a bronze-green sheen and chestnut root."""
    up = c.N[:, 2]
    rgb = shaders.mix(pal["tip"], pal["plume"], 0.5 + 0.5 * c.noise(5.0, 2, 53))
    rgb = shaders.mix(rgb, pal["back"], shaders.smooth01(-up, 0.3, 0.9) * 0.5)
    rgb = shaders.mix(rgb, np.minimum(pal["plume"] * 1.8, 1), 0.4 * c.ridge)
    return shaders.out(c.n, rgb, 0.42)


def p_leather2(c, pal):
    n1 = c.noise(12.0, 3, 49)
    rgb = shaders.mix(pal["leather"], pal["leather_dark"], 0.35 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["leather"] * 1.5, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, 0.6)


def p_cloth2(c, pal):
    rgb = shaders.mix(pal["cloth"], pal["cloth_dark"], 0.4 * c.noise(6.0, 3, 50) + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.85)


def p_brass(c, pal):
    n1 = c.noise(20.0, 3, 51)
    rgb = shaders.mix(pal["brass"], pal["brass"] * np.array([0.45, 0.32, 0.16]), 0.25 * n1 + 0.9 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["brass"] * 1.25, 1), 0.4 * c.ridge)
    return shaders.out(c.n, rgb, 0.3 + 0.2 * n1, 0.9)


PAINTERS = {"feather": p_feather, "down": p_down, "leg": p_leg, "beak": p_beak, "comb": p_comb, "horn": p_horn,
            "claw": p_claw, "iron": p_iron, "mouth": p_mouth, "eye": p_eye, "leather": p_leather2, "cloth": p_cloth2,
            "brass": p_brass, "plume": p_plume}
BK.shaders.MICRO.update({"leg": "scales_fine", "comb": "pores", "iron": "hammered", "plume": "feather"})


def main():
    global Snap_head
    t0 = time.time()
    K.meshutil.clear_scene()
    S = body_sculpt()
    K.LOG(f"[cluckhorn] body sculpt {len(S.ops)} ops ({time.time() - t0:.1f}s)")
    Snap_head = S
    Ssad, Scol = tack_sculpts(S)
    seat_top = BK.ray_out(Ssad, (0, 1.62, 0.33), (0, 1, 0), r_max=0.4)
    seat = (0, seat_top[1] - 0.01, 0.33)
    B = bones(seat)
    body_bones = [b[0] for b in B if b[4] and b[0] != 'jaw']
    rp = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)
    flank = lambda Pb: np.maximum(rp(Pb[:, 2], 1.17, 1.25) * rp(np.abs(Pb[:, 0]), 0.2, 0.28), rp(Pb[:, 2], 1.08, 1.16) * rp(np.abs(Pb[:, 0]), 0.36, 0.42)) * ((Pb[:, 1] > -0.35) & (Pb[:, 1] < 0.9))
    plume = lambda Pb: rp(Pb[:, 2], 1.36, 1.44) * ((Pb[:, 1] > 0.45) & (Pb[:, 1] < 0.95)) * (np.abs(Pb[:, 0]) < 0.36)
    rump = lambda Pb: rp(Pb[:, 1], 0.2, 0.35) * (1 - rp(Pb[:, 1], 0.62, 0.78)) * rp(Pb[:, 2], 0.9, 1.0) * (np.abs(Pb[:, 0]) < 0.5)
    hq = 1.0 if not FAST else 1.8
    Wg, Pl = hero_sculpts()
    jobs = [dict(key="body", S=S, S_lo=LOW[0], h_hi=0.0042 * hq, h_lo=0.011 * (1.2 if FAST else 1.0), tris=14300,
                 bind=('skin', body_bones, [(rump, 'hips'), (flank, 'hips'), (plume, 'hips')]), uv=(66.0, 1.0), ext=(0.045, 0.09), h_prev=0.012),
            dict(key="wings", S=Wg, h_hi=0.0016 * hq, h_lo=0.0036, tris=1300, bind=('rigid', 'hips'), uv=(62.0, 1.0), ext=(0.005, 0.012), islands=False, h_prev=0.004),
            dict(key="plume", S=Pl, h_hi=0.0018 * hq, h_lo=0.004, tris=700, bind=('rigid', 'hips'), uv=(62.0, 1.0), ext=(0.005, 0.012), islands=False, h_prev=0.004),
            dict(key="beak", S=beak_sculpt(), h_hi=0.0016 * hq, h_lo=0.004, tris=1900, bind=('rigid', 'head'), uv=(62.0, 1.3), ext=(0.006, 0.015), islands=False, h_prev=0.004),
            dict(key="jaw", S=jaw_sculpt(), h_hi=0.0016 * hq, h_lo=0.004, tris=500, bind=('rigid', 'jaw'), uv=(62.0, 1.2), ext=(0.006, 0.015), h_prev=0.004),
            dict(key="eyes", S=eye_sculpt(), h_hi=0.001 * hq, h_lo=0.004, tris=300, bind=('rigid', 'head'), uv=(66.0, 3.0), ext=(0.004, 0.01), h_prev=0.003),
            dict(key="club", S=club_sculpt(), h_hi=0.002 * hq, h_lo=0.0045, tris=2000, bind=('rigid', 'tail_6'), uv=(62.0, 1.0), ext=(0.008, 0.02), islands=False, h_prev=0.005),
            dict(key="saddle", S=Ssad, h_hi=0.0022 * hq, h_lo=0.0045, tris=2200, bind=('rigid', 'spine_2'), uv=(62.0, 1.0), ext=(0.008, 0.02), h_prev=0.006),
            dict(key="collar", S=Scol, h_hi=0.002 * hq, h_lo=0.0045, tris=1100, bind=('rigid', 'neck_1'), uv=(62.0, 1.0), ext=(0.006, 0.015), islands=False, h_prev=0.006)]
    for L in ('L', 'R'):
        jobs.append(dict(key=f"claw_{L}", S=claw_sculpt(TOE_TIPS[L]), h_hi=0.0009 * hq, h_lo=0.0022, tris=380, bind=('rigid', f'toe_{L}'),
                         sym=False, uv=(62.0, 1.3), ext=(0.004, 0.01), islands=False, h_prev=0.003))
    if PREVIEW:
        cols = {"feather": (0.5, 0.3, 0.15), "down": (0.9, 0.8, 0.6), "leg": (0.95, 0.65, 0.15), "claw": (0.2, 0.18, 0.16),
                "horn": (0.9, 0.86, 0.72), "beak": (0.95, 0.7, 0.2), "comb": (0.8, 0.15, 0.12), "mouth": (0.6, 0.2, 0.2),
                "eye": (0.9, 0.5, 0.05), "plume": (0.12, 0.2, 0.14), "iron": (0.25, 0.25, 0.28), "cloth": (0.6, 0.15, 0.1), "brass": (0.9, 0.7, 0.3), "leather": (0.35, 0.15, 0.08)}
        out = os.path.join(K.ROOT, "progress", "shots", "mounts", "r3", "cluckhorn_clay.png")
        tgt = tuple(J(0, 1.1, -0.2))
        BK.preview(ASSET, jobs, out, [dict(target=tgt, ortho=3.8, yaw=90, dist=8, pitch=2), dict(target=tgt, ortho=3.8, yaw=35, dist=8, pitch=12),
                                      dict(target=tuple(J(0, 1.95, 1.05)), ortho=0.9, yaw=55, dist=6, pitch=8)], cols)
        K.LOG(f"[cluckhorn] preview -> {out} ({time.time() - t0:.0f}s)")
        return
    arm = K.make_armature(ASSET, B)
    BK.bake_build(ASSET, arm, jobs, PAINTERS, PAL, fast=FAST,
                  extra={"eyes": [(tuple(jv(EYES[s][0])), tuple(jv(tuple(EYES[s][1])))) for s in (1, -1)]},
                  stretch_poses=[{'neck_1': (25, 0, 0), 'neck_2': (-20, 0, 0), 'head': (20, 0, 0)},
                                 {'thigh_L': (40, 0, 0), 'shin_L': (-50, 0, 0), 'metatarsal_L': (60, 0, 0), 'thigh_R': (-30, 0, 0)},
                                 {'tail_1': (0, 0, 30), 'tail_2': (0, 0, 30), 'tail_3': (0, 0, 30), 'tail_4': (0, 0, 25)}],
                  report={"seat": seat})
    K.LOG(f"[cluckhorn] total {time.time() - t0:.0f}s seat={seat}")


main()
