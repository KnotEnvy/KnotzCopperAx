"""Cinderwyrm (red riding dragon; the Wyrm Rider boss's mount) -> public/assets/models/mount_cinderwyrm.glb
(+ public/assets/textures/mount_cinderwyrm_{albedo,orm,normal,emissive}.png)

    node tools/blender-run.mjs --what cinderwyrm --owner bosses -- -b --factory-startup -P blender/build_mount_cinderwyrm.py -- [--fast] [--preview]
    (env MOUNT_FAST=1 / MOUNT_PREVIEW=1 work too)

C2 r12 (Enemy Art C). Board C2 r11: "a smooth red plastic toy dragon -- unbroken hide, flat solid wing planes, blunt
head with no jaw or teeth, narrow rod-like forelimbs, abrupt head-to-neck join". Until now the Cinderwyrm was the
Emberdrake build recoloured (build_mount_emberdrake.py DRAKE=cinderwyrm); this is its OWN build after
docs/refs/c2/bosses/cinderwyrm_sheet.png + wyrm_rider.png:
  * bipedal riding dragon: digitigrade hind legs with massive thighs, scuted metatarsals, big three-toed clawed feet;
    SHORT MUSCULAR articulated forelimbs (shoulder, bicep, elbow spur, forearm, wrist, four curled clawed fingers);
  * heavy head: domed cranium, deep snout with a hooked muzzle + nose horn, heavy horned brow, separate deep LOWER JAW
    hung slightly open (rest 8 deg) so the interlocking teeth and two big front fangs read at the game camera;
    big swept-back horns with volume, pleated swept-back cheek fins (rays + folded membrane, not flat planes);
    a THICK neck (r 0.25 -> 0.18) that blends into the skull through jowls and throat plates;
  * overlapping armour: a dorsal row of keeled scutes + paired side plates (geometry), big shingled hide scales on the
    flanks (baked normal + strong seam albedo, ~7 cm cells so they survive the game camera), fine scales on head /
    hands / feet, hex ventral plates with EMBER CRACKS (emissive map) along throat, chest and belly;
  * small folded wings on the upper flanks (behind the rider's legs): wrist claw, four finger bones, pleated membranes
    with veins and scalloped trailing edges -- rigid to wing_1_<side> so they can never tear;
  * thick tail ending in a spiked club (rigid spike crown on tail_6);
  * leather saddle + blanket with bronze trim/studs/medallions, girth, stirrups hung where the rider's feet are,
    breast collar with a bronze medallion, bridle (noseband, cheek strap, medallion, bit ring).
Mount contract kept: same 45-bone rig / names / hierarchy as the drake rig (src/mounts/drake.js animateDrake drives
it), socket_saddle on spine_2 at ~1.60 m, socket_mouth ahead of the muzzle (fireball muzzle point), ~2.1 m body,
feet on Y=0. Shared libs (build_mount_kit, build_mount_bake, lib/*) are used unmodified; the bake here adds an
emissive map and clamps back-facing baked normals in Blender (build_mount_fixnormals.py needs Pillow on the system
python, which this machine lacks). After the bake, blender/grade_cinderwyrm_albedo.mjs (Node + sharp) deepens the
orange-red hide hues toward crimson in the albedo PNG + the GLB's embedded image (stage 3's warm key read it coral).
"""
import os
import sys
import time
import math

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import numpy as np
import bpy
import build_mount_kit as K
import build_mount_bake as BK
from lib import shaders, pipeline, charkit, meshutil, skin
from lib.sdf import (Sculpt, Sphere, Ellipsoid, RoundCone, Chain, RoundBox, Inter, Shell, Offset, Snapshot, Slab,
                     Bounded, Diff, Torus, HalfSpace, basis, V, norm)

J, jv = K.J, K.jv
_ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FAST = os.environ.get("MOUNT_FAST") == "1" or "--fast" in _ARGS
PREVIEW = os.environ.get("MOUNT_PREVIEW") == "1" or "--preview" in _ARGS
ASSET = "mount_cinderwyrm"
SHOTS = os.path.join(K.ROOT, "progress", "shots", "bosses", "c2r12")
sr = shaders.srgb
JAW_OPEN = 8.0          # rest-pose jaw opening (deg): teeth + fangs read in profile
EMIT_STRENGTH = 1.25    # glTF emissive strength (KHR_materials_emissive_strength): hottest crack cores just bloom

PAL = dict(back=sr(54, 10, 10), flank=sr(140, 26, 20), flank2=sr(172, 50, 26), low=sr(190, 80, 38),
           belly=sr(186, 78, 28), belly2=sr(212, 112, 42), belly_dark=sr(96, 24, 12),
           ember=sr(255, 140, 34), ember_hot=sr(255, 214, 120), char=sr(40, 10, 6),
           plate=sr(96, 22, 16), plate_edge=sr(170, 70, 42),
           spine=sr(70, 38, 30), spine_tip=sr(214, 182, 132),
           horn=sr(204, 172, 122), horn_dark=sr(52, 30, 22), claw=sr(222, 196, 146), claw_dark=sr(58, 34, 24),
           mouth=sr(96, 18, 18), gum=sr(150, 46, 40), teeth=sr(238, 226, 196), iris=sr(255, 150, 20),
           iris2=sr(255, 226, 110), sclera=sr(70, 22, 6),
           membrane=sr(196, 64, 36), membrane2=sr(226, 110, 56), vein=sr(110, 24, 16), wingbone=sr(90, 26, 18),
           leather=sr(112, 66, 34), leather_dark=sr(48, 28, 14), blanket=sr(70, 34, 20), blanket2=sr(98, 52, 28),
           brass=sr(196, 136, 60))


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sc(a, k):
    return tuple(x * k for x in a)


def lerp3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---------------------------------------------------------------- joints (JS frame, absolute): same rig as the drake
P = {'root': (0, 0, 0), 'hips': (0, 1.06, -0.30), 'spine_1': (0, 1.10, -0.12), 'spine_2': (0, 1.16, 0.05),
     'spine_3': (0, 1.22, 0.20), 'chest': (0, 1.28, 0.34), 'neck_1': (0, 1.40, 0.48), 'neck_2': (0, 1.56, 0.58),
     'neck_3': (0, 1.72, 0.66), 'head': (0, 1.86, 0.74), 'jaw': (0, 1.80, 0.80),
     'tail_1': (0, 1.02, -0.58), 'tail_2': (0, 0.95, -0.86), 'tail_3': (0, 0.87, -1.12), 'tail_4': (0, 0.81, -1.38),
     'tail_5': (0, 0.80, -1.62), 'tail_6': (0, 0.86, -1.84)}
TAIL_TIP = (0, 0.96, -2.02)
for s, L in ((1, 'L'), (-1, 'R')):
    P[f'thigh_{L}'] = (0.24 * s, 1.00, -0.28); P[f'shin_{L}'] = (0.28 * s, 0.60, -0.06)
    P[f'metatarsal_{L}'] = (0.27 * s, 0.25, -0.34); P[f'foot_{L}'] = (0.26 * s, 0.07, -0.24); P[f'toe_{L}'] = (0.26 * s, 0.05, -0.12)
    # r12: muscular forelimbs hang lower (ref): shoulder -> elbow (back/down) -> wrist (forward/down) -> fingers
    P[f'clavicle_{L}'] = (0.15 * s, 1.20, 0.36); P[f'upperarm_{L}'] = (0.25 * s, 1.08, 0.42)
    P[f'forearm_{L}'] = (0.31 * s, 0.84, 0.33); P[f'hand_{L}'] = (0.29 * s, 0.66, 0.48); P[f'finger_{L}'] = (0.29 * s, 0.61, 0.55)
    # folded wing: root in the shoulder top, wrist up/forward, fingers trail back along the upper flank
    P[f'wing_1_{L}'] = (0.19 * s, 1.36, 0.24); P[f'wing_2_{L}'] = (0.33 * s, 1.48, 0.12); P[f'wing_3_{L}'] = (0.40 * s, 1.30, -0.40)

# centre line tail tip -> head with body radii (thicker than the drake everywhere: board "toy" read)
AX = [(TAIL_TIP, 0.05), (P['tail_6'], 0.075), (P['tail_5'], 0.098), (P['tail_4'], 0.125), (P['tail_3'], 0.155),
      (P['tail_2'], 0.19), (P['tail_1'], 0.236), ((0, 1.05, -0.44), 0.27), (P['hips'], 0.29), ((0, 1.07, -0.12), 0.31),
      ((0, 1.10, 0.05), 0.32), ((0, 1.17, 0.20), 0.315),   # saddle dip: back line sits lower than the bones (seat ~1.60) (P['chest'], 0.30), (P['neck_1'], 0.25), (P['neck_2'], 0.215),
      (P['neck_3'], 0.185), (P['head'], 0.155)]


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


HEAD = {"s": 1.0}
HSCALE = 1.15                   # r12 clay: the head read small vs the ref -> every head part scales about HPIV
HPIV = (0, 1.86, 0.80)


class head_scope:
    def __enter__(self):
        HEAD["s"] = HSCALE

    def __exit__(self, *a):
        HEAD["s"] = 1.0


def hp(p):
    k = HEAD["s"]
    return tuple(HPIV[i] + (p[i] - HPIV[i]) * k for i in range(3)) if k != 1.0 else tuple(p)


def hr(r):
    k = HEAD["s"]
    return tuple(x * k for x in r) if isinstance(r, (tuple, list)) else r * k


def jh(p):
    return jv(hp(p))


def E(c, r, M=None):
    return Ellipsoid(jh(c), hr(r), M)


def RC(a, b, ra, rb=None, **kw):
    return RoundCone(jh(a), jh(b), hr(ra), None if rb is None else hr(rb), **kw)


def CH(pts, radii, **kw):
    return Chain([jh(p) for p in pts], hr(radii), **kw)


def jaw_rot(p):
    """Rest-pose jaw opening: rotate a JS point about the jaw hinge (X axis) so the muzzle end drops."""
    a = math.radians(JAW_OPEN)
    h = P['jaw']
    y, z = p[1] - h[1], p[2] - h[2]
    return (p[0], h[1] + y * math.cos(a) - z * math.sin(a), h[2] + y * math.sin(a) + z * math.cos(a))


TOE_TIPS = {}
FINGER_TIPS = {}
EYES = {}
BELLY = []         # soft belly-blend regions (painters)
HEAD_C = (0, 1.92, 0.86)


# ---------------------------------------------------------------- body
def body_sculpt():
    S = Sculpt(materials=("scale", "scale_fine", "belly", "spine", "horn", "mouth", "plate"), default_mat="scale")
    S.add(Chain([jv(p) for p, _ in AX], [r for _, r in AX], k=0.07), 0.0)
    # torso: deep keeled chest, barrel belly, pectorals, shoulders, haunches
    S.add(E((0, 1.07, 0.27), (0.27, 0.26, 0.30)), 0.10)
    S.add(E((0, 0.99, -0.02), (0.29, 0.31, 0.27)), 0.10)
    for s in (1, -1):
        S.add(E((0.18 * s, 1.10, 0.36), (0.12, 0.13, 0.14)), 0.06)
        S.add(E((0.20 * s, 1.21, 0.37), (0.11, 0.12, 0.12)), 0.05)
        S.add(E((0.22 * s, 1.04, -0.33), (0.16, 0.23, 0.22)), 0.08)
    # neck: thick column + throat dewlap + nape muscle, blending into the skull (board: abrupt head-to-neck join)
    S.add(E((0, 1.60, 0.61), (0.19, 0.16, 0.17)), 0.08)
    S.add(E((0, 1.72, 0.70), (0.16, 0.13, 0.14)), 0.07)
    S.add(RC((0, 1.48, 0.58), (0, 1.74, 0.80), 0.15, 0.10), 0.07)                                  # throat line
    S.add(RC((0, 1.52, 0.44), (0, 1.84, 0.62), 0.15, 0.115), 0.08)                                 # nape
    hs_ = head_scope(); hs_.__enter__()
    # head: domed cranium, occiput, deep snout, hooked muzzle, brows, cheeks/jowls, eye mounds
    S.add(E((0, 1.925, 0.80), (0.152, 0.155, 0.145)), 0.06)
    S.add(E((0, 1.95, 0.70), (0.125, 0.115, 0.11)), 0.05)
    S.add(RC((0, 1.90, 0.88), (0, 1.865, 1.22), 0.118, 0.072, squash=(0.8, 1.0), ref=(0, 0, 1)), 0.05)
    S.add(E((0, 1.875, 1.215), (0.08, 0.077, 0.058)), 0.03)
    S.add(E((0, 1.842, 1.258), (0.05, 0.05, 0.036)), 0.025)                                         # hooked lip tip
    S.add(E((0, 1.875, 0.97), (0.10, 0.23, 0.10)), 0.04)                                            # snout fill
    for s in (1, -1):
        S.add(E((0.044 * s, 1.912, 1.235), (0.032, 0.038, 0.026)), 0.02)                           # nostril boss
        S.add(RC((0.058 * s, 2.012, 1.02), (0.112 * s, 2.03, 0.85), 0.024, 0.036), 0.022)         # heavy brow ridge
        S.add(E((0.128 * s, 1.865, 0.82), (0.068, 0.098, 0.085)), 0.035)                          # cheek / jaw muscle
        S.add(E((0.11 * s, 1.80, 0.74), (0.07, 0.08, 0.09)), 0.05)                                # jowl -> neck bridge
        c = (0.108 * s, 1.968, 0.912)
        n = norm(np.array([0.85 * s, 0.22, 0.45]))
        EYES[s] = (hp(c), n)
        S.add(Sphere(jh(add(c, sc(n, -0.012))), hr(0.043)), 0.03)                                     # eye mound
        S.add(E((0.032 * s, 1.945, 1.13), (0.036, 0.085, 0.022)), 0.02)                           # snout ridge
        for i in range(4):                                                                          # lip scale row
            z = 0.92 + 0.08 * i
            S.add(E((0.098 * s - 0.008 * i * s, 1.848, z), (0.022, 0.035, 0.016)), 0.006, mat="plate")
    # upper-jaw underside flattened (the separate lower jaw hangs under it); palate = mouth
    S.sub(RoundBox(jh((0, 1.79, 1.05)), hr((0.18, 0.27, 0.046)), None, 0.012), 0.012)
    S.paint_mat(RoundBox(jh((0, 1.836, 1.04)), hr((0.082, 0.19, 0.012)), None, 0.0), "mouth")
    for s in (1, -1):
        S.sub(E((0.048 * s, 1.918, 1.258), (0.013, 0.012, 0.01)), 0.004)                           # nostrils
        c, n = EYES[s]
        S.sub(Sphere(jv(c), hr(0.035)), 0.004)                                                         # socket
        lid_n = norm(np.array(jv((0, 1, 0))) + np.array(jv((0, 0, -0.25))))
        S.add(Diff(Shell(Sphere(jv(add(c, sc(n, hr(0.006)))), hr(0.037)), 0.005), Slab(jv(add(c, (0, -0.004, 0))), lid_n, 0.014)), 0.004)
    hs_.__exit__()
    # hind legs: haunch -> thigh (quad bulge) -> knee -> shin (calf) -> ankle (spur) -> scuted metatarsal -> foot + toes
    for s, L in ((1, 'L'), (-1, 'R')):
        S.add(RC(P[f'thigh_{L}'], P[f'shin_{L}'], 0.21, 0.115), 0.06)
        S.add(E((0.28 * s, 0.85, -0.14), (0.13, 0.16, 0.20)), 0.05)
        S.add(E((0.29 * s, 0.60, -0.05), (0.09, 0.09, 0.09)), 0.03)
        S.add(RC(P[f'shin_{L}'], P[f'metatarsal_{L}'], 0.10, 0.062), 0.03)
        S.add(E((0.28 * s, 0.50, -0.21), (0.075, 0.11, 0.13)), 0.035)
        S.add(E((0.27 * s, 0.25, -0.35), (0.066, 0.07, 0.07)), 0.02)
        S.add(RC((0.27 * s, 0.26, -0.38), (0.27 * s, 0.32, -0.49), 0.03, 0.006), 0.012, mat="horn")   # ankle spur
        S.add(RC(P[f'metatarsal_{L}'], P[f'foot_{L}'], 0.066, 0.056), 0.02)
        for i in range(4):                                                                          # front scutes
            t = (i + 0.5) / 4
            q = lerp3(P[f'metatarsal_{L}'], P[f'foot_{L}'], t)
            S.add(E(add(q, (0, 0.0, 0.05)), (0.05, 0.03, 0.022)), 0.006, mat="plate")
        S.add(E((0.26 * s, 0.058, -0.17), (0.095, 0.12, 0.05)), 0.03)
        tips = []
        for a in (-0.44, 0.0, 0.44):
            d = np.array([math.sin(a) * s, 0, math.cos(a)])
            b0 = (0.26 * s, 0.065, -0.13)
            k1 = add(b0, tuple(d * 0.11 + np.array([0, -0.004, 0])))
            tp = add(k1, tuple(d * 0.09 + np.array([0, -0.024, 0])))
            S.add(CH([b0, k1, tp], [0.048, 0.04, 0.03], k=0.01), 0.018)
            S.add(E(add(k1, (0, 0.024, 0)), (0.038, 0.032, 0.026)), 0.01, mat="plate")             # knuckle scute
            S.add(E(add(tp, tuple(d * -0.04 + np.array([0, 0.022, 0]))), (0.03, 0.026, 0.02)), 0.008, mat="plate")
            tips.append((tp, d))
        TOE_TIPS[L] = tips
        S.add(RC((0.26 * s, 0.10, -0.29), (0.29 * s, 0.05, -0.37), 0.028, 0.013), 0.015)             # dew claw toe
        S.add(RC((0.29 * s, 0.05, -0.37), (0.295 * s, 0.02, -0.41), 0.014, 0.003), 0.004, mat="horn")
        # forelimbs: SHORT + MUSCULAR + articulated (board: narrow rod-like)
        ua, fa, hd = P[f'upperarm_{L}'], P[f'forearm_{L}'], P[f'hand_{L}']
        S.add(E(ua, (0.115, 0.12, 0.12)), 0.05)                                                     # shoulder ball
        S.add(RC(ua, fa, 0.105, 0.075), 0.035)
        S.add(E(add(lerp3(ua, fa, 0.45), (0.025 * s, 0.0, 0.035)), (0.07, 0.095, 0.07)), 0.03)     # biceps
        S.add(E(add(lerp3(ua, fa, 0.5), (0.0, 0.0, -0.04)), (0.065, 0.09, 0.06)), 0.03)            # triceps
        S.add(E(fa, (0.07, 0.07, 0.072)), 0.025)                                                    # elbow
        S.add(RC(add(fa, (0.0, 0.0, -0.04)), add(fa, (0.03 * s, 0.03, -0.15)), 0.026, 0.004), 0.008, mat="horn")  # elbow spur
        S.add(RC(fa, hd, 0.08, 0.056), 0.025)
        S.add(E(add(lerp3(fa, hd, 0.35), (0.018 * s, 0.01, 0.0)), (0.062, 0.075, 0.07)), 0.025)    # forearm muscle
        S.add(E(hd, (0.06, 0.05, 0.068)), 0.02)                                                     # wrist / palm
        for i in range(3):                                                                          # forearm plates
            q = lerp3(fa, hd, 0.2 + 0.25 * i)
            S.add(E(add(q, (0.045 * s, 0.01, 0.01)), (0.026, 0.045, 0.04)), 0.006, mat="plate")
        ftips = []
        for a in (-0.55, -0.18, 0.18, 0.55):
            d = np.array([math.sin(a) * s, 0, math.cos(a)])
            b0 = add(hd, (0, -0.02, 0.045))
            k1 = add(b0, tuple(d * 0.055 + np.array([0, -0.012, 0])))
            tp = add(k1, tuple(d * 0.03 + np.array([0, -0.05, 0])))
            S.add(CH([b0, k1, tp], [0.025, 0.021, 0.016], k=0.006), 0.012)
            ftips.append((tp, d))
        FINGER_TIPS[L] = ftips
    # fine scales on head, hands, feet, lower legs
    S.paint_mat(E((0, 1.89, 0.97), (0.22, 0.44, 0.22)), "scale_fine")
    for s, L in ((1, 'L'), (-1, 'R')):
        S.paint_mat(E((0.26 * s, 0.14, -0.20), (0.2, 0.36, 0.22)), "scale_fine")
        S.paint_mat(E(P[f'hand_{L}'], (0.12, 0.12, 0.12)), "scale_fine")
    # ventral plates: throat -> chest -> belly -> tail underside
    belly_regions = []
    samples, cum = axis_samples(lambda r: 0.03 + 0.2 * r)
    for arc, p, tg, r in samples:
        if p[2] > 0.74 or p[2] < -1.70:
            continue
        dn = perp((0, -1, 0), tg)
        q = BK.ray_out(S, p, tuple(dn), r_max=0.75)
        step = 0.03 + 0.2 * r
        c = np.array(q) - dn * 0.012
        M = basis(np.array(jv((1, 0, 0))), np.array(jv(tuple(tg))))
        S.add(Ellipsoid(jv(tuple(c)), (0.74 * r + 0.02, 0.68 * step, 0.022), M), 0.026, mat="belly")
        belly_regions.append(Ellipsoid(jv(tuple(np.array(q))), (0.8 * r + 0.03, 1.1 * step, 0.06), M))
    BELLY[:] = belly_regions
    # dorsal armour: keeled scutes on the midline + paired side plates (neck, behind the saddle, tail)
    samples, _ = axis_samples(lambda r: 0.05 + 0.22 * r)
    for arc, p, tg, r in samples:
        if -0.44 < p[2] < 0.44 or p[2] > 0.72:
            continue
        up = perp((0, 1, 0), tg)
        q = np.array(BK.ray_out(S, p, tuple(up), r_max=0.75))
        step = 0.05 + 0.22 * r
        Mz = basis(np.array(jv(tuple(up))), np.array(jv(tuple(tg))))
        # scute: flattened, front edge sunk / rear edge proud (shingled)
        c = q + up * 0.004 - tg * step * 0.15
        S.add(Ellipsoid(jv(tuple(c)), (0.026, 0.32 * r + 0.035, 0.8 * step), Mz), 0.01, mat="spine")
        h = float(np.clip(0.05 + 0.32 * r, 0.05, 0.14))
        if p[2] < -1.15 or p[2] > 0.44:                                                              # neck + tail spikes
            base = q - up * 0.015
            tip = q + up * h - tg * h * 0.55
            S.add(RoundCone(jv(tuple(base)), jv(tuple(tip)), 0.014 + 0.3 * h, 0.003, squash=(1.0, 0.5)), 0.008, mat="spine")
        else:                                                                                        # low keel on the back
            S.add(RoundCone(jv(tuple(q - up * 0.01)), jv(tuple(q + up * h * 0.55 - tg * h * 0.3)), 0.012 + 0.22 * h, 0.004,
                            squash=(1.0, 0.45)), 0.008, mat="spine")
        for s in (1, -1):                                                                            # paired side plates
            sd = perp((s * 0.85, 0.55, 0), tg)
            qs = np.array(BK.ray_out(S, p, tuple(sd), r_max=0.75))
            Ms = basis(np.array(jv(tuple(sd))), np.array(jv(tuple(tg))))
            S.add(Ellipsoid(jv(tuple(qs - sd * 0.016 - tg * step * 0.15)), (0.018, 0.24 * r + 0.04, 0.95 * step), Ms), 0.012, mat="plate")
    # side plates also under the saddle edge -> rump (the blanket covers the middle)
    # tail club knob (spike crown is a rigid part on tail_6)
    tt = np.array(TAIL_TIP); t6 = np.array(P['tail_6'])
    tgt = (tt - t6) / np.linalg.norm(tt - t6)
    Mt = basis(np.array(jv((0, 1, 0))), np.array(jv(tuple(tgt))))
    S.add(Ellipsoid(jv(tuple(tt - tgt * 0.03)), (0.10, 0.11, 0.17), Mt), 0.05, mat="spine")
    return S


def club_sculpt():
    """Spiked tail club crown (rigid on tail_6): six radial spikes + a tip spike."""
    S = Sculpt(materials=("horn",), default_mat="horn")
    tt = np.array(TAIL_TIP); t6 = np.array(P['tail_6'])
    tg = (tt - t6) / np.linalg.norm(tt - t6)
    c = tt - tg * 0.03
    upv = perp((0, 1, 0), tg); side = np.cross(tg, upv)
    for i in range(6):
        a = math.radians(30 + 60 * i)
        d = norm(upv * math.cos(a) + side * math.sin(a) * 1.0 + tg * 0.25)
        r0 = 0.10 if abs(math.cos(a)) < 0.6 else 0.095
        base = c + d * (r0 - 0.03)
        tip = c + d * (r0 + 0.13) + tg * 0.02
        S.add(RoundCone(jv(tuple(base)), jv(tuple(tip)), 0.038, 0.003), 0.0)
    for i in range(4):                                                                                # rear ring
        a = math.radians(45 + 90 * i)
        d = norm(upv * math.cos(a) + side * math.sin(a) - tg * 0.1)
        S.add(RoundCone(jv(tuple(c - tg * 0.09 + d * 0.075)), jv(tuple(c - tg * 0.13 + d * 0.15)), 0.024, 0.003), 0.0)
    S.add(RoundCone(jv(tuple(c + tg * 0.13)), jv(tuple(c + tg * 0.30)), 0.04, 0.003), 0.0)
    return S


def crest_sculpt():
    """Horns, brow spikes, cheek spikes, nose horn, pleated swept-back fins (rigid on head)."""
    S = Sculpt(materials=("horn", "frill"), default_mat="horn")
    hs_ = head_scope(); hs_.__enter__()
    for s in (1, -1):
        # main horns: big, swept back, tips curling up (tips kept at z >= 0.4 m clear of the rider's hands)
        S.add(CH([(0.072 * s, 2.03, 0.80), (0.105 * s, 2.12, 0.67), (0.135 * s, 2.18, 0.55), (0.152 * s, 2.215, 0.46),
                  (0.16 * s, 2.27, 0.41)], [0.05, 0.039, 0.026, 0.014, 0.003], k=0.012), 0.0)
        for i in range(3):                                                                              # growth rings
            t = 0.18 + 0.2 * i
            q = lerp3((0.072 * s, 2.03, 0.80), (0.135 * s, 2.18, 0.55), t)
            S.add(Sphere(jh(q), hr(0.047 - 0.008 * i)), 0.012)
        S.add(CH([(0.118 * s, 1.975, 0.78), (0.165 * s, 2.0, 0.67), (0.195 * s, 2.015, 0.585)], [0.028, 0.017, 0.003], k=0.008), 0.0)
        S.add(RC((0.085 * s, 2.035, 0.93), (0.118 * s, 2.10, 0.875), 0.017, 0.003), 0.004)              # brow spike
        S.add(RC((0.142 * s, 1.85, 0.80), (0.225 * s, 1.82, 0.635), 0.028, 0.003), 0.0)                # cheek spikes
        S.add(RC((0.13 * s, 1.80, 0.84), (0.195 * s, 1.75, 0.70), 0.019, 0.002), 0.0)
        # pleated fin: rays (ridges) fanning back/out from behind the eye, folded membrane valleys between them
        o = (0.118 * s, 1.945, 0.75)
        tips = [add(o, (0.06 * s, 0.30, -0.10)), add(o, (0.15 * s, 0.22, -0.26)), add(o, (0.19 * s, 0.07, -0.31)),
                add(o, (0.15 * s, -0.09, -0.26))]
        for t in tips:
            mid = add(lerp3(o, t, 0.5), (0.016 * s, 0.0, 0.0))
            S.add(CH([o, mid, t], [0.021, 0.013, 0.003], k=0.005), 0.0)
        for i in range(len(tips) - 1):
            mvalley = add(lerp3(o, lerp3(tips[i], tips[i + 1], 0.5), 0.8), (-0.028 * s, 0.0, 0.0))
            for a, b in ((tips[i], mvalley), (mvalley, tips[i + 1])):
                S.add(K_tri(jh(o), jh(a), jh(b), 0.0065), 0.003, mat="frill")
        for i in range(len(tips) - 1):
            m = (np.array(jh(tips[i])) + np.array(jh(tips[i + 1]))) * 0.5
            S.sub(Sphere(m + (m - np.array(jh(o))) * 0.2, hr(0.085)), 0.006)
    S.add(RC((0, 1.95, 1.15), (0, 2.05, 1.185), 0.04, 0.004), 0.0)                                      # nose horn
    S.add(RC((0, 1.985, 1.06), (0, 2.03, 1.07), 0.022, 0.003), 0.0)
    hs_.__exit__()
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


GUM = [(0.104, 1.842, 0.84), (0.099, 1.844, 0.96), (0.083, 1.844, 1.09), (0.055, 1.842, 1.19), (0.0, 1.84, 1.245)]


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
    """Upper gums + interlocking teeth + two big front fangs (rigid on head)."""
    hs_ = head_scope(); hs_.__enter__()
    S = Sculpt(materials=("mouth", "teeth"), default_mat="mouth")
    for s in (1, -1):
        pts, tp = gum_path(s)
        S.add(CH(pts, [0.019, 0.018, 0.016, 0.014, 0.013], k=0.005), 0.0)
        for i, p in enumerate(tp):
            fang = i in (9,)
            L = 0.092 if fang else (0.04 + 0.014 * ((i * 7) % 3))
            r0 = 0.017 if fang else 0.011
            a = add(p, (0, -0.006, 0))
            b = add(p, (0.006 * s, -L, 0.016 if fang else 0.01))
            S.add(RC(a, b, r0, 0.0016), 0.002, mat="teeth")
    hs_.__exit__()
    return S


def jaw_sculpt():
    """Deep lower jaw, hung JAW_OPEN deg open at rest (rigid on jaw): chin plates, lower teeth + fangs, tongue."""
    hs_ = head_scope(); hs_.__enter__()
    S = Sculpt(materials=("scale_fine", "belly", "mouth", "teeth", "plate"), default_mat="scale_fine")
    R = jaw_rot
    S.add(RC(R((0, 1.79, 0.80)), R((0, 1.795, 1.20)), 0.104, 0.056, squash=(0.56, 1.0), ref=(0, 0, 1)), 0.0)
    for s in (1, -1):
        S.add(E(R((0.085 * s, 1.80, 0.83)), (0.046, 0.08, 0.05)), 0.02)                              # jaw hinge muscle
        S.add(E(R((0.07 * s, 1.765, 1.0)), (0.03, 0.14, 0.03)), 0.02)                                # jaw-line ridge
        for i in range(4):
            S.add(E(R((0.088 * s - 0.008 * i * s, 1.79, 0.92 + 0.07 * i)), (0.02, 0.032, 0.015)), 0.006, mat="plate")
    S.sub(RC(R((0, 1.845, 0.84)), R((0, 1.845, 1.17)), 0.074, 0.036, squash=(0.55, 1.0), ref=(0, 0, 1)), 0.008)
    S.add(RC(R((0, 1.808, 0.86)), R((0, 1.813, 1.10)), 0.05, 0.028, squash=(0.35, 1.0), ref=(0, 0, 1)), 0.006, mat="mouth")
    for i in range(7):                                                                               # chin plates
        z = 0.86 + i * 0.05
        S.add(E(R((0, 1.742 + 0.004 * i, z)), (0.056 - 0.003 * i, 0.024, 0.013)), 0.004, mat="belly")
    for s in (1, -1):
        for i in range(10):
            t = i / 9.0
            x = (0.084 * (1 - t) + 0.036 * t) * s
            z = 0.87 + t * 0.30
            fang = i == 8
            L = 0.06 if fang else (0.032 if i < 8 else 0.04)
            r0 = 0.014 if fang else 0.0095
            S.add(RC(R((x, 1.833, z)), R((x - 0.003 * s, 1.833 + L, z + 0.008)), r0, 0.0015), 0.002, mat="teeth")
    hs_.__exit__()
    return S


def eye_sculpt():
    S = Sculpt(materials=("eye",), default_mat="eye")
    for s in (1, -1):
        c, n = EYES[s]
        S.add(Sphere(jv(add(c, sc(n, 0.008 * HSCALE))), 0.033 * HSCALE), 0.0)
    return S


def claw_sculpt(tips, r0):
    S = Sculpt(materials=("claw",), default_mat="claw")
    for tp, d in tips:
        d = np.array(d)
        a = add(tp, tuple(d * -0.014 + np.array([0, 0.005, 0])))
        b = add(tp, tuple(d * r0 * 1.7 + np.array([0, r0 * 0.3, 0])))
        c = add(tp, tuple(d * r0 * 3.1 + np.array([0, -r0 * 1.5, 0])))
        S.add(CH([a, b, c], [r0, r0 * 0.66, 0.0018], squash=(1.0, 0.62), ref=(0, 0, 1), k=0.004), 0.0)
    return S


def wing_sculpt(s, body):
    """Folded wing on one side (rigid on wing_1_<side>): arm + wrist claw, four finger bones, pleated membranes."""
    S = Sculpt(materials=("wingbone", "membrane", "claw"), default_mat="wingbone")
    L = 'L' if s > 0 else 'R'
    R0, W = P[f'wing_1_{L}'], P[f'wing_2_{L}']
    W = (0.33 * s, 1.48, 0.12)
    # fixed tips hugging the flank (measured profile): top edge at back height, lower edge kept above the thigh
    tips = [(0.23 * s, 1.31, -0.74), (0.37 * s, 1.12, -0.62), (0.44 * s, 1.17, -0.36), (0.45 * s, 1.04, -0.05)]

    def clearance(q):
        """x clearance of point q over the flank (ray from the mid-plane along +-x); None if above the body."""
        try:
            h = BK.ray_out(body, (0, q[1], q[2]), (s, 0, 0), r_max=0.9)
        except Exception:
            return None
        return abs(q[0]) - abs(h[0])

    cl = []
    for i, t in enumerate(tips):
        pts = [lerp3(W, t, u) for u in np.linspace(0.3, 1.0, 8)]
        if i + 1 < len(tips):
            pts += [lerp3(W, lerp3(t, tips[i + 1], 0.5), u) for u in np.linspace(0.4, 0.86, 5)]
        v = [c_ for c_ in (clearance(q) for q in pts) if c_ is not None]
        cl.append(round(min(v), 3) if v else None)
    WING_INFO[L] = dict(tips=tips, clear=cl)
    S.add(CH([R0, add(lerp3(R0, W, 0.5), (0.02 * s, 0.0, 0.01)), W], [0.052, 0.04, 0.034], k=0.01), 0.0)
    S.add(Sphere(jv(W), 0.042), 0.01)
    S.add(RC(add(W, (0.01 * s, 0.01, 0.02)), add(W, (0.06 * s, -0.01, 0.10)), 0.02, 0.003), 0.004, mat="claw")   # wrist claw
    for t in tips:
        mid = add(lerp3(W, t, 0.5), (0.018 * s, 0.025, 0.0))
        S.add(CH([W, mid, t], [0.026, 0.016, 0.005], k=0.006), 0.006)
    for i in range(len(tips) - 1):
        a, b = tips[i], tips[i + 1]
        valley = add(lerp3(W, lerp3(a, b, 0.5), 0.86), (-0.022 * s, 0.0, 0.0))
        for p, q in ((a, valley), (valley, b)):
            S.add(K_tri(jv(W), jv(p), jv(q), 0.006), 0.004, mat="membrane")
    for i in range(len(tips) - 1):                                                             # scalloped trailing edge
        m = np.array(jv(lerp3(tips[i], tips[i + 1], 0.5)))
        S.sub(Sphere(m + (m - np.array(jv(W))) * 0.17, 0.09), 0.006)
    return S


WING_INFO = {}
SEAT = [1.6]


def tack_sculpts(body):
    """Saddle + blanket + stirrups (rigid spine_2), breast collar (rigid neck_1), bridle (rigid head)."""
    snap = Snapshot(body)
    S = Sculpt(materials=("blanket", "brass", "leather"), default_mat="blanket")
    region = E((0, 1.22, 0.02), (0.60, 0.33, 0.33))
    lo, hi = np.array(jv((-0.5, 0.82, 0.4))), np.array(jv((0.5, 1.7, -0.36)))
    blo, bhi = np.minimum(lo, hi), np.maximum(lo, hi)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.026), 0.011), region), blo, bhi), 0.0)
    rim = Shell(E((0, 1.22, 0.02), (0.60, 0.33, 0.33)), 0.02)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.032), 0.012), rim), blo - 0.05, bhi + 0.05), 0.0, mat="leather")
    # bronze studs along the blanket border + side medallions
    for s in (1, -1):
        for ang in np.linspace(-150, -30, 9):
            a = math.radians(ang)
            d = np.array([math.cos(a) * 0.60, 0.0, math.sin(a) * 0.33])
            q0 = (d[0] * s * 0.97, 1.22, 0.02 + d[2] * 0.97)
            qs = np.array(BK.ray_out(body, (0, q0[1], q0[2]), (s, -0.25, 0), r_max=0.8))
            if qs[1] < 0.9:
                continue
            S.add(Sphere(jv(tuple(qs + np.array([0.045 * s, 0.0, 0.0]))), 0.016), 0.004, mat="brass")
        med = np.array(BK.ray_out(body, (0, 1.12, -0.08), (s, 0.12, 0), r_max=0.8))
        Mm = basis(np.array(jv((s, 0.12, 0))), np.array(jv((0, 1, 0))))
        S.add(Ellipsoid(jv(tuple(med + np.array([0.04 * s, 0, 0]))), (0.06, 0.06, 0.012), Mm), 0.006, mat="brass")
        S.add(Torus(jv(tuple(med + np.array([0.05 * s, 0, 0]))), 0.05, 0.009, Mm, 1.0), 0.003, mat="brass")
    top = np.array(BK.ray_out(body, P['spine_2'], (0, 1, 0)))
    seat_c = add(tuple(top), (0, 0.06, -0.01))
    SEAT[0] = seat_c[1] + 0.055
    S.add(E(seat_c, (0.19, 0.22, 0.055)), 0.03, mat="leather")
    S.add(E(add(seat_c, (0, 0.06, -0.19)), (0.18, 0.06, 0.09)), 0.03, mat="leather")                 # cantle
    S.add(RC(add(seat_c, (0, 0.0, 0.19)), add(seat_c, (0, 0.14, 0.235)), 0.036, 0.028), 0.02, mat="leather")   # pommel
    S.add(Sphere(jv(add(seat_c, (0, 0.16, 0.24))), 0.04), 0.006, mat="brass")
    # girth strap around the barrel + side buckles
    g = np.array(jv((0, 1.0, 0.1)))
    slab = Slab(g, np.array(jv((0, 0.12, 1.0))) / np.linalg.norm(jv((0, 0.12, 1.0))), 0.034)
    S.add(Bounded(Inter(Shell(Offset(snap, 0.022), 0.009), slab), blo - 0.1, bhi + 0.1), 0.0, mat="leather")
    for s in (1, -1):
        side = np.array(BK.ray_out(body, (0, 1.06, 0.1), (s, -0.05, 0)))
        S.add(RoundBox(jv(tuple(side + np.array([0.025 * s, 0, 0]))), (0.018, 0.034, 0.04), None, 0.006), 0.004, mat="brass")
        # stirrup leather: out from under the seat, along the flank, then hanging where the rider's feet are (y ~1.0)
        pts = []
        for ang in (22, 48, 70, 86):
            a = math.radians(ang)
            q = np.array(BK.ray_out(body, (0, 1.18, 0.10), (s * math.sin(a), math.cos(a), 0.0)))
            pts.append(tuple(q + np.array([s * math.sin(a), math.cos(a), 0]) * 0.05))
        low = add(pts[-1], (0.04 * s, -0.16, 0.06))
        pts.append(low)
        S.add(CH(pts, 0.02, squash=(1.0, 0.33), k=0.004), 0.0, mat="leather")
        ring_c = add(low, (0.0, -0.06, 0))
        Mr = basis(np.array(jv((0, 0, 1))), np.array(jv((1, 0, 0))))
        S.add(Torus(jv(ring_c), 0.058, 0.012, Mr, 1.0), 0.0, mat="brass")
        S.add(RoundBox(jv(add(ring_c, (0, -0.055, 0))), (0.032, 0.05, 0.011), None, 0.006), 0.004, mat="brass")
    # breast collar: leather band round the neck base + a big bronze medallion on the chest + side rings
    C = Sculpt(materials=("leather", "brass"), default_mat="leather")
    n1 = np.array(P['neck_1']); ch = np.array(P['chest'])
    cc = ch * 0.30 + n1 * 0.70
    tg = (n1 - ch) / np.linalg.norm(n1 - ch)
    cb = np.array(jv(tuple(cc))); tb = np.array(jv(tuple(tg)))
    clo, chi = cb - 0.45, cb + 0.45
    C.add(Bounded(Inter(Shell(Offset(snap, 0.018), 0.009), Slab(cb, tb, 0.04)), clo, chi), 0.0)
    for k in (-1, 1):
        C.add(Bounded(Inter(Shell(Offset(snap, 0.028), 0.005), Slab(cb + tb * 0.036 * k, tb, 0.007)), clo, chi), 0.004, mat="brass")
    fr = np.array(BK.ray_out(body, tuple(cc), (0, -0.25, 1.0), r_max=0.8))
    nf = norm(np.array([0, -0.25, 1.0]))
    Mf = basis(np.array(jv(tuple(nf))), np.array(jv((0, 1, 0))))
    C.add(Ellipsoid(jv(tuple(fr + nf * 0.035)), (0.075, 0.075, 0.016), Mf), 0.006, mat="brass")
    C.add(Torus(jv(tuple(fr + nf * 0.048)), 0.06, 0.01, Mf, 1.0), 0.003, mat="brass")
    for i in range(6):                                                                                  # sun rays
        a = math.radians(30 * i)
        dd = np.array([math.cos(a), math.sin(a), 0.0]) * 0.04
        C.add(Sphere(jv(tuple(fr + nf * 0.052 + dd)), 0.009), 0.003, mat="brass")
    for s in (1, -1):
        sd = np.array(BK.ray_out(body, tuple(cc), (s, -0.1, 0.25), r_max=0.8))
        C.add(Torus(jv(tuple(sd + np.array([0.03 * s, -0.04, 0]))), 0.04, 0.009, basis(np.array(jv((s, 0, 0.3))), np.array(jv((0, 1, 0)))), 1.0), 0.0, mat="brass")
    # bridle (rigid head): noseband round the upper snout, cheek strap BELOW the eye to the gape, cheek medallion, bit ring
    B = Sculpt(materials=("leather", "brass"), default_mat="leather")
    hlo, hhi = np.array(jv((-0.35, 1.55, 1.5))), np.array(jv((0.35, 2.2, 0.5)))
    hlo, hhi = np.minimum(hlo, hhi), np.maximum(hlo, hhi)
    with head_scope():
        nb_c = np.array(jh((0, 1.88, 1.15))); nb_n = norm(np.array(jv((0, 0.35, 1.0))))
        B.add(Bounded(Inter(Shell(Offset(snap, 0.012), 0.007), Slab(nb_c, nb_n, 0.02), HalfSpace(np.array(jh((0, 1.84, 1.0))), np.array(jv((0, -1, 0)))), HalfSpace(np.array(jh((0, 1.96, 1.0))), np.array(jv((0, 1, 0))))), hlo, hhi), 0.0)
        for s in (1, -1):
            pts = []
            for zz, yy in ((1.14, 1.875), (1.06, 1.872), (0.98, 1.872), (0.90, 1.875), (0.82, 1.88), (0.74, 1.90)):
                q = np.array(BK.ray_out(body, hp((0, yy, zz)), (s, 0.05, 0.0), r_max=0.5))
                pts.append(tuple(q + np.array([0.007 * s, 0, 0])))
            m = pts[3]
            Mm = basis(np.array(jv((s, 0.0, 0.0))), np.array(jv((0, 1, 0))))
            B.add(Ellipsoid(jv(add(m, (0.012 * s, 0, 0))), (0.04, 0.04, 0.011), Mm), 0.004, mat="brass")
            B.add(Torus(jv(add(m, (0.019 * s, 0, 0))), 0.034, 0.008, Mm, 1.0), 0.002, mat="brass")
            rc = hp((0.118 * s, 1.835, 0.90))
            B.add(Torus(jv(rc), 0.036, 0.009, basis(np.array(jv((1, 0, 0))), np.array(jv((0, 1, 0)))), 1.0), 0.0, mat="brass")
    return S, C, B


# ---------------------------------------------------------------- painters (c.P Blender coords; linear colours)
def cn(c, freq, octaves=3, seed=0):
    """c.noise() is centred on 0 (~-0.7..0.35): remap to ~0..1 for the thresholds below."""
    return np.clip(0.5 + 0.7 * c.noise(freq, octaves, seed), 0.0, 1.0)


def _hash3(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / float(0xFFFFFF)


def vor_edge(Pm, cell, seed=0, jitter=0.9):
    """3D Voronoi (F2 - F1) / 2 in metres: ~distance to the nearest cell wall."""
    Q = Pm / cell
    I = np.floor(Q).astype(np.int64)
    b1 = np.full(len(Q), 1e9); b2 = np.full(len(Q), 1e9)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                C = I + np.array([dx, dy, dz])
                f = C + 0.5 + jitter * (np.stack([_hash3(C[:, 0], C[:, 1], C[:, 2], seed + k) for k in range(3)], 1) - 0.5)
                d = np.linalg.norm(Q - f, axis=1)
                lt1 = d < b1
                b2 = np.where(lt1, b1, np.minimum(b2, d))
                b1 = np.where(lt1, d, b1)
    return (b2 - b1) * 0.5 * cell


def belly_w(c):
    if not BELLY:
        return np.zeros(c.n)
    X, Y, Z = c.P[:, 0], c.P[:, 1], c.P[:, 2]
    d = np.full(c.n, 9.0)
    for rg in BELLY:
        d = np.minimum(d, rg.d(X, Y, Z))
    d = d + 0.02 * (cn(c, 14.0, 2, 57) - 0.5)
    return 1.0 - shaders.smooth01(d, -0.015, 0.05)


def heat(c, region):
    """Ember region weight (0..1) painted into c_prm.b; the crack LINES are drawn node-side (texel-sharp Voronoi
    edges, see _bake_material_wyrm). Hottest along throat/chest, cooling toward the tail."""
    fwd = shaders.smooth01(-c.P[:, 1], -1.6, 0.2)                     # Blender -Y = forward (JS +Z)
    return np.clip(region * (0.4 + 0.6 * fwd), 0, 1)


def _hide(c, pal):
    up = c.N[:, 2]
    t = shaders.smooth01(up, -0.4, 0.85)
    rgb = shaders.mix(pal["low"], pal["flank"], shaders.smooth01(up, -0.75, -0.1))
    rgb = shaders.mix(rgb, pal["back"], shaders.smooth01(up, 0.2, 0.95))
    n1 = cn(c, 3.0, 3, 11)
    rgb = shaders.mix(rgb, pal["flank2"], 0.35 * shaders.smooth01(n1, 0.5, 0.8) * (1 - t))
    rgb = rgb * (0.86 + 0.26 * cn(c, 18.0, 2, 12))[:, None]
    blot = shaders.smooth01(cn(c, 6.0, 3, 31), 0.55, 0.8)
    rgb = shaders.mix(rgb, pal["back"] * 0.85, 0.45 * blot)
    rgb = shaders.mix(rgb, pal["back"] * 0.35, shaders.smooth01(c.cav, 0.05, 0.5) * 0.8)
    rgb = shaders.mix(rgb, np.minimum(pal["flank2"] * 1.35, 1), 0.28 * c.ridge)
    return rgb


def p_scale(c, pal):
    rgb = _hide(c, pal)
    w = belly_w(c)
    bel = shaders.mix(pal["belly"], pal["belly2"], shaders.smooth01(cn(c, 5.0, 2, 14), 0.3, 0.8))
    bel = shaders.mix(bel, pal["belly_dark"], shaders.smooth01(c.cav, 0.03, 0.45) * 0.55)
    rgb = shaders.mix(rgb, bel, 0.85 * w)
    return shaders.out(c.n, rgb, 0.5 + 0.08 * cn(c, 9.0, 2, 13) - 0.08 * w, 0.0, heat(c, shaders.smooth01(w, 0.3, 0.9)))


def p_belly(c, pal):
    n1 = cn(c, 5.0, 3, 14)
    rgb = shaders.mix(pal["belly"], pal["belly2"], shaders.smooth01(n1, 0.3, 0.8))
    rgb = shaders.mix(rgb, pal["belly_dark"], shaders.smooth01(c.cav, 0.05, 0.5) * 0.45)
    rgb = shaders.mix(rgb, np.minimum(pal["belly2"] * 1.1, 1), 0.25 * c.ridge)
    return shaders.out(c.n, rgb, 0.44, 0.0, heat(c, np.ones(c.n)))


def p_plate(c, pal):
    rgb = shaders.mix(pal["plate"], pal["plate_edge"], 0.6 * c.ridge + 0.25 * cn(c, 12.0, 2, 41))
    rgb = shaders.mix(rgb, pal["back"] * 0.3, shaders.smooth01(c.cav, 0.03, 0.4) * 0.85)
    rgb = rgb * (0.88 + 0.22 * cn(c, 26.0, 2, 42))[:, None]
    return shaders.out(c.n, rgb, 0.42)


def p_spine(c, pal):
    rgb = shaders.mix(pal["spine"], pal["spine_tip"], shaders.smooth01(c.ridge, 0.1, 0.7))
    rgb = shaders.mix(rgb, pal["back"] * 0.6, shaders.smooth01(c.cav, 0.05, 0.4) * 0.85)
    rgb = rgb * (0.9 + 0.16 * cn(c, 30.0, 2, 15))[:, None]
    return shaders.out(c.n, rgb, 0.4)


def p_horn(c, pal):
    """Dark keratin at the root -> pale bone toward the tips (distance from the skull / club centre), growth bands."""
    hc = np.array(jv(HEAD_C)) * 1.0
    d = np.linalg.norm(c.P - hc[None], axis=1)
    tc = np.array(jv(TAIL_TIP))
    d = np.where(np.linalg.norm(c.P - tc[None], axis=1) < 0.5, np.linalg.norm(c.P - tc[None], axis=1) * 1.3, d)
    t = shaders.smooth01(d, 0.17, 0.42)
    band = 0.5 + 0.5 * np.sin(d * 140.0 + 6.0 * cn(c, 12.0, 2, 16))
    rgb = shaders.mix(pal["horn_dark"], pal["horn"], np.clip(t + 0.4 * c.ridge, 0, 1))
    rgb = rgb * (0.86 + 0.14 * band)[:, None]
    rgb = shaders.mix(rgb, pal["horn_dark"] * 0.6, 0.7 * shaders.smooth01(c.cav, 0.02, 0.45))
    return shaders.out(c.n, rgb, 0.36)


def p_claw(c, pal):
    rgb = shaders.mix(pal["claw"], pal["claw_dark"], 0.85 * shaders.smooth01(c.cav, 0.0, 0.35) + 0.15 * cn(c, 30.0, 2, 17))
    rgb = shaders.mix(rgb, np.minimum(pal["claw"] * 1.12, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, 0.3)


def p_mouth(c, pal):
    n1 = cn(c, 20.0, 2, 18)
    rgb = shaders.mix(pal["gum"], pal["mouth"], 0.5 * n1 + 0.6 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.28)


def p_teeth(c, pal):
    rgb = shaders.mix(pal["teeth"], pal["teeth"] * np.array([0.7, 0.58, 0.4]), shaders.smooth01(c.cav, 0.0, 0.4) * 0.8)
    return shaders.out(c.n, rgb, 0.26)


def p_eye(c, pal):
    """Reptile eye: amber iris brightening to gold around a vertical slit pupil, dark limbal ring."""
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
    glow = shaders.smooth01(cosang, 0.5, 0.9) * (~slit)
    return shaders.out(c.n, rgb, 0.1, 0.0, 0.55 * glow)


def p_frill(c, pal):
    n1 = cn(c, 5.0, 3, 19)
    vein = 1 - shaders.smooth01(np.abs(cn(c, 16.0, 2, 20) - 0.5), 0.0, 0.05)
    rgb = shaders.mix(pal["membrane2"], pal["vein"], 0.2 * n1 + 0.55 * vein)
    rgb = shaders.mix(rgb, pal["vein"] * 0.6, shaders.smooth01(c.cav, 0.05, 0.4) * 0.7)
    return shaders.out(c.n, rgb, 0.55)


def p_membrane(c, pal):
    """Wing membrane: lighter in the middle of each panel, darker toward the bones/edges, branching veins."""
    n1 = cn(c, 4.0, 3, 61)
    v1 = 1 - shaders.smooth01(np.abs(cn(c, 11.0, 2, 62) - 0.5), 0.0, 0.035)
    v2 = 1 - shaders.smooth01(np.abs(cn(c, 27.0, 2, 63) - 0.5), 0.0, 0.03)
    rgb = shaders.mix(pal["membrane"], pal["membrane2"], shaders.smooth01(n1, 0.35, 0.75))
    rgb = shaders.mix(rgb, pal["vein"], 0.65 * v1 + 0.3 * v2)
    rgb = shaders.mix(rgb, pal["vein"] * 0.55, shaders.smooth01(c.cav, 0.03, 0.4) * 0.75)
    return shaders.out(c.n, rgb, 0.62)


def p_wingbone(c, pal):
    rgb = shaders.mix(pal["wingbone"], pal["plate_edge"], 0.45 * c.ridge + 0.2 * cn(c, 20.0, 2, 64))
    rgb = shaders.mix(rgb, pal["back"] * 0.4, shaders.smooth01(c.cav, 0.03, 0.4) * 0.7)
    return shaders.out(c.n, rgb, 0.45)


def p_leather2(c, pal):
    n1 = cn(c, 12.0, 3, 21)
    rgb = shaders.mix(pal["leather"], pal["leather_dark"], 0.35 * n1 + 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["leather"] * 1.5, 1), 0.35 * c.ridge)
    return shaders.out(c.n, rgb, 0.62 - 0.15 * c.ridge)


def p_blanket(c, pal):
    """Tooled dark leather blanket: worn lighter on the ridges, tooled diamond lattice, dark in the folds."""
    n1 = cn(c, 6.0, 3, 22)
    u = c.P[:, 0] * 22.0; v = c.P[:, 1] * 22.0
    lat = np.minimum(np.abs(np.sin(u + v)), np.abs(np.sin(u - v)))
    rgb = shaders.mix(pal["blanket"], pal["blanket2"], 0.5 * n1 + 0.3 * c.ridge)
    rgb = rgb * (0.82 + 0.18 * shaders.smooth01(lat, 0.05, 0.25))[:, None]
    rgb = shaders.mix(rgb, pal["leather_dark"] * 0.6, 0.8 * shaders.smooth01(c.cav, 0.02, 0.4))
    return shaders.out(c.n, rgb, 0.7)


def p_brass(c, pal):
    n1 = cn(c, 20.0, 3, 23)
    verd = shaders.smooth01(cn(c, 9.0, 2, 24), 0.62, 0.8) * shaders.smooth01(c.cav, 0.02, 0.3)
    rgb = shaders.mix(pal["brass"], pal["brass"] * np.array([0.45, 0.32, 0.16]), 0.25 * n1 + 0.9 * shaders.smooth01(c.cav, 0.02, 0.4))
    rgb = shaders.mix(rgb, np.minimum(pal["brass"] * 1.25, 1), 0.4 * c.ridge)
    rgb = shaders.mix(rgb, sr(70, 96, 72), 0.5 * verd)
    return shaders.out(c.n, rgb, 0.32 + 0.2 * n1, 0.9 * (1 - 0.6 * verd))


PAINTERS = {"scale": p_scale, "scale_fine": p_scale, "belly": p_belly, "spine": p_spine, "horn": p_horn, "plate": p_plate,
            "claw": p_claw, "mouth": p_mouth, "teeth": p_teeth, "eye": p_eye, "frill": p_frill, "membrane": p_membrane,
            "wingbone": p_wingbone, "leather": p_leather2, "blanket": p_blanket, "brass": p_brass}


# ---------------------------------------------------------------- micro detail (node side, bake): big shingled scales
_PREV_MICRO = shaders._micro           # build_mount_bake's beast micro (scales / plate / feather ...)


def _micro_wyrm(nb, recipe, obj_co, uv):
    """wyrm_scales*: overlapping armour scales -- Voronoi cells stretched along the body (Blender Y), each a dome whose
    tail-ward edge rides proud (shingled), DEEP dark seams + per-cell value jitter in the albedo so the breakup survives
    the game camera (~7 cm cells on the flanks). wyrm_belly: flatter hex plates, light seams (the ember cracks are
    painted). membrane: soft wrinkles."""
    if recipe in ("wyrm_scales", "wyrm_scales_fine", "wyrm_belly"):
        sc_ = {"wyrm_scales": 14.0, "wyrm_scales_fine": 30.0, "wyrm_belly": 20.0}[recipe]
        stretch = (1.0, 0.72, 1.0) if recipe != "wyrm_belly" else (1.0, 0.9, 0.75)
        co = nb.vmath("MULTIPLY", obj_co, stretch)
        v1 = nb.n("ShaderNodeTexVoronoi", feature="F1")
        v1.inputs["Scale"].default_value = sc_
        v1.inputs["Randomness"].default_value = 0.8
        nb.link(co, v1.inputs["Vector"])
        v2 = nb.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        v2.inputs["Scale"].default_value = sc_
        v2.inputs["Randomness"].default_value = 0.8
        nb.link(co, v2.inputs["Vector"])
        edge = nb.math("MINIMUM", nb.math("MULTIPLY", v2.outputs["Distance"], 3.2), 1.0)
        dome = nb.math("POWER", edge, 0.5)
        sep_c = nb.n("ShaderNodeSeparateXYZ")
        nb.link(co, sep_c.inputs[0])
        sep_p = nb.n("ShaderNodeSeparateXYZ")
        nb.link(v1.outputs["Position"], sep_p.inputs[0])
        dy = nb.math("SUBTRACT", nb.math("MULTIPLY", sep_c.outputs["Y"], sc_), sep_p.outputs["Y"])
        shing = nb.math("ADD", nb.math("MULTIPLY", dy, 0.9), 0.5, clamp=True)
        belly = recipe == "wyrm_belly"
        h = nb.math("MULTIPLY", dome, nb.math("ADD", nb.math("MULTIPLY", shing, 0.2 if belly else 0.6), 0.8 if belly else 0.4))
        rnd = nb.n("ShaderNodeSeparateColor")
        nb.link(v1.outputs["Color"], rnd.inputs["Color"])
        seam = nb.math("POWER", nb.math("MINIMUM", nb.math("MULTIPLY", v2.outputs["Distance"], 7.0), 1.0), 0.7)
        base = (0.62, 0.38) if belly else (0.3, 0.7)
        a1 = nb.math("ADD", nb.math("MULTIPLY", seam, base[1]), base[0])
        a2 = nb.math("ADD", nb.math("MULTIPLY", rnd.outputs["Red"], 0.3 if not belly else 0.14), 0.84 if not belly else 0.93)
        a3 = nb.math("ADD", nb.math("MULTIPLY", shing, 0.0 if belly else 0.22), 0.0 if belly else 0.89)
        alb = nb.math("MULTIPLY", nb.math("MULTIPLY", a1, a2), a3) if not belly else nb.math("MULTIPLY", a1, a2)
        rough = nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, h), 0.2)
        return h, alb, rough, {"wyrm_scales": 0.007, "wyrm_scales_fine": 0.0028, "wyrm_belly": 0.0035}[recipe]
    if recipe == "membrane":
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 26.0
        noi.inputs["Detail"].default_value = 4.0
        nb.link(obj_co, noi.inputs["Vector"])
        wav = nb.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
        wav.inputs["Scale"].default_value = 40.0
        wav.inputs["Distortion"].default_value = 6.0
        nb.link(obj_co, wav.inputs["Vector"])
        h = nb.math("ADD", nb.math("MULTIPLY", noi.outputs["Fac"], 0.5), nb.math("MULTIPLY", wav.outputs["Fac"], 0.35))
        alb = nb.math("ADD", nb.math("MULTIPLY", wav.outputs["Fac"], 0.12), 0.9)
        return h, alb, None, 0.0014
    return _PREV_MICRO(nb, recipe, obj_co, uv)


shaders._micro = _micro_wyrm
_ORIG_BAKE_MAT = shaders.bake_material


def _bake_material_wyrm(name, kind, *a, **kw):
    """Ember cracks node-side: Voronoi plate walls (~7 cm cells, broken by noise; a finer 2.8 cm crazing where hottest)
    x the painted region weight (c_prm.b) -> emission mask (prm.b) + ember-orange line / charred halo in the albedo."""
    m = _ORIG_BAKE_MAT(name, kind, *a, **kw)
    if kind not in ("belly", "scale"):
        return m
    nt = m.node_tree
    nb = shaders.NB(m)
    cmb = nt.nodes["P_prm"].inputs["Color"].links[0].from_node
    region = cmb.inputs[2].links[0].from_socket
    pa = nt.nodes["P_albedo"]
    alb = pa.inputs["Color"].links[0].from_socket
    tc = nb.n("ShaderNodeTexCoord")

    def sstep(x, a, b):
        t = nb.math("MULTIPLY", nb.math("SUBTRACT", x, a), 1.0 / (b - a), clamp=True)
        return nb.math("MULTIPLY", nb.math("MULTIPLY", t, t), nb.math("SUBTRACT", 3.0, nb.math("MULTIPLY", t, 2.0)))

    def walls(cell, stretch):
        v = nb.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        v.inputs["Scale"].default_value = 1.0 / cell
        v.inputs["Randomness"].default_value = 0.9
        nb.link(nb.vmath("MULTIPLY", tc.outputs["Object"], stretch), v.inputs["Vector"])
        return v.outputs["Distance"]

    d1 = walls(0.07, (1.0, 0.8, 1.0))
    d2 = walls(0.028, (1.0, 1.0, 1.0))
    noi = nb.n("ShaderNodeTexNoise")
    noi.inputs["Scale"].default_value = 6.0
    noi.inputs["Detail"].default_value = 2.0
    nb.link(tc.outputs["Object"], noi.inputs["Vector"])
    brk = sstep(noi.outputs["Fac"], 0.47, 0.55)
    line1 = nb.math("SUBTRACT", 1.0, sstep(d1, 0.028, 0.075))
    line2 = nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, sstep(d2, 0.02, 0.05)), nb.math("MULTIPLY", sstep(region, 0.8, 1.0), 0.45))
    mask = nb.math("MULTIPLY", nb.math("MULTIPLY", nb.math("MAXIMUM", line1, line2), brk), region)
    halo = nb.math("MULTIPLY", nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, sstep(d1, 0.075, 0.2)), brk), region)
    nb.link(mask, cmb.inputs[2])
    dark = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    dark.inputs["Factor"].default_value = 1.0
    nb.link(alb, dark.inputs[6])
    dark.inputs[7].default_value = (0.3, 0.12, 0.08, 1.0)
    m1 = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    nb.link(nb.math("MULTIPLY", halo, 0.65), m1.inputs["Factor"])
    nb.link(alb, m1.inputs[6])
    nb.link(dark.outputs[2], m1.inputs[7])
    m2 = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    nb.link(mask, m2.inputs["Factor"])
    nb.link(m1.outputs[2], m2.inputs[6])
    m2.inputs[7].default_value = (*[float(x) for x in PAL["ember"]], 1.0)
    nb.link(m2.outputs[2], pa.inputs["Color"])
    return m


shaders.bake_material = _bake_material_wyrm
shaders.MICRO.update({"scale": "wyrm_scales", "scale_fine": "wyrm_scales_fine", "belly": "wyrm_belly", "plate": "grain",
                      "membrane": "membrane", "wingbone": "grain", "frill": "membrane", "blanket": "grain"})


# ---------------------------------------------------------------- rig
def HB(x, y, z):
    with head_scope():
        return hp((x, y, z))


def bones(seat):
    B = [('root', P['root'], (0, 0.3, 0), None, False), ('hips', P['hips'], P['spine_1'], 'root', True),
         ('spine_1', P['spine_1'], P['spine_2'], 'hips', True), ('spine_2', P['spine_2'], P['spine_3'], 'spine_1', True),
         ('spine_3', P['spine_3'], P['chest'], 'spine_2', True), ('chest', P['chest'], P['neck_1'], 'spine_3', True),
         ('neck_1', P['neck_1'], P['neck_2'], 'chest', True), ('neck_2', P['neck_2'], P['neck_3'], 'neck_1', True),
         ('neck_3', P['neck_3'], P['head'], 'neck_2', True), ('head', P['head'], HB(0, 1.84, 1.2), 'neck_3', True),
         ('jaw', HB(*P['jaw']), HB(0, 1.77, 1.16), 'head', True),
         ('socket_saddle', seat, add(seat, (0, 0, 0.2)), 'spine_2', False),
         ('socket_mouth', HB(0, 1.82, 1.29), HB(0, 1.82, 1.45), 'head', False)]
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
              (f'finger_{L}', P[f'finger_{L}'], add(P[f'finger_{L}'], (0, -0.05, 0.06)), f'hand_{L}', True),
              (f'wing_1_{L}', P[f'wing_1_{L}'], P[f'wing_2_{L}'], 'spine_3', True),
              (f'wing_2_{L}', P[f'wing_2_{L}'], P[f'wing_3_{L}'], f'wing_1_{L}', False),
              (f'wing_3_{L}', P[f'wing_3_{L}'], add(P[f'wing_3_{L}'], (0, 0, -0.08)), f'wing_2_{L}', False)]
    return B


# ---------------------------------------------------------------- bake (build_mount_bake.bake_build + emissive + normal clamp)
def fix_normals(n3):
    """Clamp back-facing baked tangent normals (Cycles cage hits on HI backs) toward flat (as build_mount_fixnormals)."""
    n = n3 * 2.0 - 1.0
    z = n[..., 2]
    zmin = 0.45
    w = np.clip((zmin - z) / zmin, 0.0, 1.0)[..., None]
    bad = int(np.sum(z < 0))
    n = n * (1.0 - w) + np.array([0.0, 0.0, 1.0]) * w
    n[..., 2] = np.maximum(n[..., 2], 0.05)
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    return (n + 1.0) * 0.5, bad


def bake_build(asset, arm, jobs, painters, pal, fast=False, extra=None, stretch_poses=(), report=None):
    T0 = time.time()
    res = 1024 if fast else 2048
    rep = report if report is not None else {}
    rep.update(asset=asset, res=res, fast=fast, parts={}, geom_qa={})
    rep["device"] = pipeline.setup_cycles("AUTO")
    his, los = {}, {}
    for j in jobs:
        k, S = j["key"], j["S"]
        t = time.time()
        o = pipeline.sculpt_mesh(S, k + "_hi", j["h_hi"], j.get("lo"), j.get("hi"))
        if j.get("islands", True):
            charkit.drop_islands(o, j["h_hi"], min_verts=40)
        his[k] = o
        lp = pipeline.lowpoly(S, k + "_lo", j["h_lo"], j["tris"], j.get("lo"), j.get("hi"), symmetry=j.get("sym", True),
                              smooth=j.get("smooth", 0))
        if j.get("islands", True):
            charkit.drop_islands(lp, j["h_lo"], min_verts=24)
        lp.data.validate()
        los[k] = lp
        rep["parts"][k] = meshutil.tri_count(lp)
        rep["geom_qa"][k] = charkit.geom_qa(lp)
        K.LOG(f"[{asset}] {k}: hi {len(o.data.vertices)} v, lo {rep['parts'][k]} tris ({time.time() - t:.1f}s)")
    for j in jobs:
        k, b = j["key"], j["bind"]
        if b[0] == "skin":
            skin.skin(los[k], arm, method="sdf", S=j["S"], allowed=b[1], overrides=b[2] if len(b) > 2 else (),
                      power=4.0, smooth=5, restrict=False)
        else:
            charkit.rigid_bind(los[k], arm, b[1])
    for j in jobs:
        a, dns = j.get("uv", (66.0, 1.0))
        charkit.smart_uv(los[j["key"]], a, dns)
    order = [j["key"] for j in jobs]
    rep["uv_fill"] = pipeline.pack_atlas_shape([los[k] for k in order], margin_px=4 if fast else 6, res=res)
    for j in jobs:
        k, S = j["key"], j["S"]
        shaders.assign_bake_materials(his[k], S.materials, prefix=f"bk_{asset}_{k}_")
        shaders.paint_mesh(his[k], S.materials, {}, pal, extra or {}, painters=painters)
    for o in list(his.values()) + list(los.values()):
        pipeline.set_ray_visibility(o, False)
    bj = [(los[j["key"]], [his[j["key"]]]) + tuple(j.get("ext", (0.01, 0.03))) for j in jobs]
    B = pipeline.Baker(res, bj, shaders.set_pass, [los[k] for k in order], [his[k] for k in order])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if fast else 48),
                         ("normal", "NORMAL", 4 if fast else 8)])
    cov = maps["albedo"][..., 3] > 0.5
    nfix, nbad = fix_normals(maps["normal"][..., :3])
    maps["normal"] = np.concatenate([nfix, maps["normal"][..., 3:]], axis=-1)
    rep["normal_backfacing_fixed"] = nbad
    tex = charkit.composite_maps(maps, BK.OUT_TEX, asset, tint=(0.36, 0.2, 0.2))
    e = np.clip(maps["prm"][..., 2], 0, 1)[..., None]
    glow = np.array(PAL["ember"]) * 0.62                   # deep orange lines (C2 r12 fast2: hot cores tonemapped to cream)
    hot = np.array(sr(255, 150, 40)) * 0.8
    em = glow * np.clip(e * 1.5, 0, 1) + (hot - glow) * np.clip((e - 0.6) / 0.4, 0, 1)
    em = pipeline.dilate(em * cov[..., None], cov, 16)
    rep["emissive_cover"] = float(np.mean(e[..., 0][cov] > 0.1))
    tex["emissive"] = pipeline.save_png(em, os.path.join(BK.OUT_TEX, asset + "_emissive.png"), asset + "_emissive", "sRGB",
                                        linear_to_srgb=True)
    mat = pipeline.final_material("M_" + asset, tex["albedo"], tex["normal"], tex["orm"], tex["emissive"], EMIT_STRENGTH)
    dups = []
    for k in order:
        o = meshutil.duplicate(los[k], k + "_x")
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
        dups.append(o)
    bpy.context.view_layer.update()
    body = meshutil.join(dups, asset + "_mesh")
    body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
    for m in list(body.modifiers):
        if m.type == 'ARMATURE' and m.object is not arm:
            body.modifiers.remove(m)
    if not any(m.type == 'ARMATURE' for m in body.modifiers):
        skin.bind(body, arm)
    rep["tris"] = meshutil.tri_count(body)
    if stretch_poses:
        rep["stretch_worst"] = K.stretch_check(body, arm, stretch_poses)
    out = os.path.join(K.ROOT, "public", "assets", "models", asset + ".glb")
    pipeline.export_glb(out, [arm, body], scene_name=asset)
    rep["glb"] = out
    rep["glb_mb"] = round(os.path.getsize(out) / 1e6, 2)
    rep["seconds"] = round(time.time() - T0)
    pipeline.write_json(os.path.join(K.HERE, "out", asset + "_report.json"), rep)
    K.LOG(f"[{asset}] DONE {rep['tris']} tris, {rep['glb_mb']} MB, {rep['seconds']}s")
    return out


def main():
    t0 = time.time()
    K.meshutil.clear_scene()
    S = body_sculpt()
    K.LOG(f"[{ASSET}] body sculpt {len(S.ops)} ops ({time.time() - t0:.1f}s)")
    Ssad, Scol, Sbri = tack_sculpts(S)
    seat = (0, SEAT[0] + 0.012, 0.03)       # top of the seat leather (+1 cm, as the drake build's probe landed: ~1.60)
    body_bones = [b[0] for b in bones(seat) if b[4] and b[0] != 'jaw' and not b[0].startswith('wing')]
    hq = 1.0 if not FAST else 1.8
    Sw = {s: wing_sculpt(s, S) for s in (1, -1)}
    K.LOG(f"[{ASSET}] wings: {WING_INFO}")
    def crotch(Pb):
        """Midline web between the (thick) thighs -> mostly hips, so the two thighs never pull one triangle apart
        (r12 fast2 ride check: 2 thigh_L<->thigh_R triangles stretched 8.6 -> 37 cm in the fireball rear-back)."""
        x, yj, zj = np.abs(Pb[:, 0]), Pb[:, 2], -Pb[:, 1]
        return 0.8 * (1 - shaders.smooth01(x, 0.05, 0.12)) * (1 - shaders.smooth01(yj, 0.9, 1.0)) * \
            shaders.smooth01(yj, 0.35, 0.5) * (1 - shaders.smooth01(np.abs(zj + 0.25), 0.3, 0.45))

    jobs = [dict(key="body", S=S, h_hi=0.0042 * hq, h_lo=0.011 * (1.2 if FAST else 1.0), tris=14600, bind=('skin', body_bones, [(crotch, 'hips')]),
                 uv=(66.0, 1.0), ext=(0.02, 0.05), h_prev=0.012),
            dict(key="crest", S=crest_sculpt(), h_hi=0.0016 * hq, h_lo=0.0035, tris=2000, bind=('rigid', 'head'), uv=(62.0, 1.2), ext=(0.006, 0.015), h_prev=0.004),
            dict(key="teeth", S=teeth_sculpt(), h_hi=0.0012 * hq, h_lo=0.0026, tris=1100, bind=('rigid', 'head'), uv=(62.0, 1.0), ext=(0.004, 0.01), islands=False, h_prev=0.003),
            dict(key="jaw", S=jaw_sculpt(), h_hi=0.0016 * hq, h_lo=0.004, tris=1700, bind=('rigid', 'jaw'), uv=(62.0, 1.3), ext=(0.006, 0.015), islands=False, h_prev=0.004),
            dict(key="eyes", S=eye_sculpt(), h_hi=0.001 * hq, h_lo=0.004, tris=360, bind=('rigid', 'head'), uv=(66.0, 3.0), ext=(0.004, 0.01), h_prev=0.003),
            dict(key="saddle", S=Ssad, h_hi=0.0022 * hq, h_lo=0.0045, tris=2700, bind=('rigid', 'spine_2'), uv=(62.0, 1.0), ext=(0.008, 0.02), h_prev=0.006),
            dict(key="collar", S=Scol, h_hi=0.002 * hq, h_lo=0.0045, tris=700, bind=('rigid', 'neck_1'), uv=(62.0, 1.0), ext=(0.006, 0.015), h_prev=0.006),
            dict(key="bridle", S=Sbri, h_hi=0.0016 * hq, h_lo=0.0035, tris=520, bind=('rigid', 'head'), uv=(62.0, 1.0), ext=(0.005, 0.012), islands=False, h_prev=0.004),
            dict(key="club", S=club_sculpt(), h_hi=0.0016 * hq, h_lo=0.0035, tris=480, bind=('rigid', 'tail_6'), uv=(62.0, 1.0), ext=(0.006, 0.015), h_prev=0.004)]
    for s, L in ((1, 'L'), (-1, 'R')):
        jobs.append(dict(key=f"wing_{L}", S=Sw[s], h_hi=0.0018 * hq, h_lo=0.0034, tris=950, bind=('rigid', f'wing_1_{L}'),
                         sym=False, uv=(62.0, 1.1), ext=(0.006, 0.015), h_prev=0.004))
    for L in ('L', 'R'):
        jobs.append(dict(key=f"claw_h_{L}", S=claw_sculpt(TOE_TIPS[L], 0.032), h_hi=0.0009 * hq, h_lo=0.0022, tris=380, bind=('rigid', f'toe_{L}'),
                         sym=False, uv=(62.0, 1.3), ext=(0.004, 0.01), islands=False, h_prev=0.003))
        jobs.append(dict(key=f"claw_f_{L}", S=claw_sculpt(FINGER_TIPS[L], 0.019), h_hi=0.0008 * hq, h_lo=0.0018, tris=320, bind=('rigid', f'finger_{L}'),
                         sym=False, uv=(62.0, 1.3), ext=(0.003, 0.008), islands=False, h_prev=0.0025))
    if PREVIEW:
        cols = {"scale": (0.55, 0.12, 0.08), "scale_fine": (0.62, 0.16, 0.1), "belly": (0.92, 0.6, 0.3), "spine": (0.32, 0.2, 0.16),
                "plate": (0.4, 0.1, 0.08), "horn": (0.8, 0.7, 0.5), "mouth": (0.5, 0.12, 0.12), "frill": (0.85, 0.42, 0.25),
                "membrane": (0.82, 0.32, 0.2), "wingbone": (0.36, 0.1, 0.08), "teeth": (0.95, 0.93, 0.85), "eye": (1.0, 0.6, 0.05),
                "claw": (0.88, 0.8, 0.6), "blanket": (0.3, 0.16, 0.1), "brass": (0.85, 0.6, 0.25), "leather": (0.42, 0.25, 0.12)}
        from lib import preview as pv
        pv.setup_workbench("MATERIAL")
        for j in jobs:
            charkit.mesh_sculpt(j["S"], j["key"], j.get("h_prev", j["h_lo"]), j.get("lo"), j.get("hi"), colors=cols)
        stamp = int(time.time())
        tgt = tuple(J(0, 1.1, -0.2))
        views = {"a": [dict(target=tgt, ortho=3.3, yaw=90, dist=8, pitch=4), dict(target=tgt, ortho=3.3, yaw=40, dist=8, pitch=14)],
                 "b": [dict(target=tuple(J(0, 1.15, 0.1)), ortho=2.9, yaw=325, dist=8, pitch=10),
                       dict(target=tuple(J(0, 1.9, 0.92)), ortho=0.95, yaw=62, dist=6, pitch=6)]}
        for k, v in views.items():
            out = os.path.join(SHOTS, "clay", f"cw_{stamp}_{k}.png")
            pv.render_views(out, v, res=(1200, 900))
            K.LOG(f"[{ASSET}] preview -> {out}")
        K.LOG(f"[{ASSET}] preview done ({time.time() - t0:.0f}s) wings={WING_INFO}")
        return
    arm = K.make_armature(ASSET, bones(seat))
    rep = {"seat": seat, "wings": {k: {"tips": [list(map(float, t)) for t in v["tips"]], "clear": v["clear"]} for k, v in WING_INFO.items()}}
    bake_build(ASSET, arm, jobs, PAINTERS, PAL, fast=FAST,
               extra={"eyes": [(tuple(jv(add(EYES[s][0], sc(EYES[s][1], 0.008)))), tuple(jv(tuple(EYES[s][1])))) for s in (1, -1)]},
               stretch_poses=[{'neck_1': (20, 0, 0), 'neck_2': (-15, 0, 0), 'head': (15, 0, 0), 'jaw': (25, 0, 0)},
                              {'thigh_L': (30, 0, 0), 'shin_L': (-30, 0, 0), 'metatarsal_L': (30, 0, 0), 'upperarm_R': (30, 0, 0), 'forearm_R': (-30, 0, 0)},
                              {'tail_1': (0, 0, 20), 'tail_2': (0, 0, 20), 'tail_3': (0, 0, 20), 'tail_4': (0, 0, 20)},
                              {'wing_1_L': (0, 20, 0), 'wing_1_R': (0, -20, 0), 'thigh_R': (-35, 0, 0)}],
               report=rep)
    # post-bake hide grade (Node + sharp): deepens the orange-red hide toward the ref crimson; patches PNG + GLB
    import shutil
    import subprocess
    node = shutil.which("node") or os.path.expanduser("~/.local/share/fnm/aliases/default/bin/node")
    try:
        r = subprocess.run([node, os.path.join(K.HERE, "grade_cinderwyrm_albedo.mjs"), "--force"], capture_output=True, text=True, timeout=300, cwd=K.ROOT)
        K.LOG(f"[{ASSET}] grade: {r.stdout.strip()} {r.stderr.strip()[-200:]}")
    except Exception as e:
        K.LOG(f"[{ASSET}] grade FAILED ({e}); run: node blender/grade_cinderwyrm_albedo.mjs --force")
    K.LOG(f"[{ASSET}] total {time.time() - t0:.0f}s seat={seat}")


if os.environ.get("CW_NOMAIN") != "1":
    main()
