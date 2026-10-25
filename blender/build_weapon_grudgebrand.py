"""Grudgebrand - Brann Stormhewn's two-handed greatsword (original design), Wave C2 r1: STYLISED rebuild.

C1 boards: the realistic 9 -> 7.4 cm blade read as an ~8 px "thin blue stick" at belt scale. Reference
docs/refs/c2/heroes/hero_weapons.png (leftmost): a very broad, chunky slab of a blade, a deep dark fuller, bold
bevel planes, a notched edge, a bronze ram-skull guard, a faceted pommel.

C2 proportions (>= 1.6x width, ~2x thickness, light bright flats + dark bevels so it reads at game distance):
~1.41 m overall, blade 15 cm at the root swelling to 15.8 cm then a broad clipped point, 2.6 -> 1.8 cm thick, a
0.28-wide bevel plane painted darker than the bright flats, a deep wide fuller, five real silhouette notches on
the LO mesh too, engraved (NOT emissive) grudge runes; a thick straight bronze crossguard (~37 cm) with block
terminals angled toward the grip, a ram skull with curled horns on both faces of the langet; our two-hand grip
length is KEPT (the reference grip is too short): 30 cm leather grip with bronze rings; faceted bronze pommel.

Weapon contract (unchanged): grip point (right hand, just under the guard) at the origin, blade along +Z
(Blender) = +Y (glTF), flat facing +-Y, edges +-X; the left hand goes 0.14 m below (GRIP_L_Z); tip at 1.065.
Nodes: grip_main (origin), grip_offhand (0,0,GRIP_L_Z), blade_tip.
C2 r2 (board r1 "illegible flat pale-grey bar at game camera"): darker/wider fuller + dark bevel + white edge line,
notches 2x deeper (break the outline), darker aged-bronze guard, and two BIG spiral ram horns rooted on the guard arms
that sweep out past the blade edges and curl up beside the blade root (the ram read, in silhouette).
C2 r3 (board r2 "the ram-horn guard is invisible at the game camera"): the horns are now DARK keratin (own 'horn'
material), 2x thicker, centred fully outside the blade edge, 13 x 16 cm per side with a bronze root collar.
C2 r4 (board r3 5.83, flat for three rounds: "in play the weapons are too small/thin for any detail to matter; horns tan
~10 px curls overlapping the wrist; diagonal barber-pole banding instead of fuller + bright edge"): the VISUAL mesh is
scaled up (blade 1.5x wider = 22.5-23.7 cm, 1.2x longer: tip 1.065 -> 1.265 m = 65 % of Brann's 1.95 m, 1.23x thicker,
guard 37 -> 43 cm; grip / offhand contract unchanged, hit volumes are move-def boxes), the ram horns are NEAR-BLACK
keratin, bigger (R 9.2 cm, tube 4.6 cm) and swept UP beside the blade root so they clear the fist, and the blade value
structure is simplified for 15-20 px: bright slab, ONE narrow dark fuller line, mid-dark bevel, white edge line.
C2 r5 (board r4 6.42: "saturated icy blue-white, plastic / lightsaber against the warm grade; stepped wavy edge"):
WORN STEEL -- warm-grey neutral flats with low-frequency value variation and fine scratches, a dark warm fuller, a
mid warm-grey satin bevel and a NARROW bright polished edge bevel (glossy, metal 0.95) that catches the key; the
engine's hue-locked metal (render/characterLook.js, opted in by anim/retarget.js) keeps the blade neutral-warm at every
angle instead of mirroring the violet sky, so the flats can be properly metallic again. The silhouette is SMOOTHED:
two gentle, wide edge bites instead of five deep notches (the stepped outline at the game camera).
Run standalone:  blender -b --factory-startup -P blender/build_weapon_grudgebrand.py -- [--fast]
(also called at the end of build_hero_brann.py).
Outputs public/assets/models/weapon_grudgebrand.glb + public/assets/textures/brann_grudgebrand_*.png.
"""
import os
import sys
import math
import time
import argparse
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import bpy

from lib import sdf, meshutil, pipeline, shaders, weapon
for _m in (sdf, meshutil, pipeline, shaders, weapon):
    importlib.reload(_m)
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, RoundCone, RoundBox, Torus, Chain,
                     HalfSpace, Inter, Union, Diff, Bounded, Offset, Slab)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")

# ---------------------------------------------------------------------------- dimensions (metres)
GUARD_Z = 0.058          # crossguard centre
BLADE_Z0 = 0.070         # blade base (inside the guard)
BLADE_LEN = 1.195        # C2 r4: tip at 1.265 (was 0.995 / 1.065; src/anim/profiles.js brann blade R 1.26, trails measure the bbox)
GRIP_TOP, GRIP_BOT = 0.044, -0.262
GRIP_L_Z = -0.14         # left-hand grip point (two-hand hold) -- KEPT
POMMEL_Z = -0.300        # pommel centre; faceted point bottom ~ -0.355 -> overall ~1.62 m
GUARD_HALF = 0.215       # crossguard half span (43 cm; C2 r4 was 37 cm for the 15 cm blade)
VIS = 1.5                # C2 r4 visual width scale of the blade (15 -> 22.5 cm) -- silhouette at the game camera
GRIP_R = 0.019
MATS = ["iron", "bronze", "leather_dark", "leather", "horn"]
BEVEL_HI, BEVEL_LO = 0.26, 0.24
FULLER_HW = 0.20         # C2 r4: fuller half-width as a fraction of the half width (was 0.30: too much of the slab was dark)
# silhouette notches: (s centre, side +1 = +X edge / -1 = -X edge, depth m, half-width m)
# C2 r2 (board r1: notches invisible at the game camera): deeper bites (up to 3.2 cm = 21 % of the width) that break
# the outline at 12-15 px blade width
# C2 r5 (board r4: "stepped / wavy edge outline"): two gentle, wide bites only (12 / 10 % of the width), so the edge reads
# as one clean line with a battle chip, not a saw
NOTCHES = [(0.33, 1, 0.012 * VIS, 0.085), (0.62, -1, 0.010 * VIS, 0.075)]


def width_fn(s):
    """Full blade width (x VIS): 15.0 cm at the root, swelling to 15.8 cm at 55 %, 15.0 at 80 %, then a broad clipped point."""
    if s < 0.55:
        w = 0.150 + 0.008 * (s / 0.55)
    elif s < 0.80:
        w = 0.158 - 0.008 * (s - 0.55) / 0.25
    else:
        w = 0.150 * max(0.0, 1.0 - (s - 0.80) / 0.20) ** 0.78
    return max(w * VIS, 0.0006)


def thick_fn(s):
    t = 0.032 - 0.010 * s          # C2 r4: 1.23x (a wider slab needs the thickness to keep its bevel planes)
    if s > 0.9:
        t *= max(0.15, 1.0 - (s - 0.9) / 0.1)
    return t


def half_w(s):
    return width_fn(s) * 0.5


def _frame(x, y, z):
    return np.stack([V(*x), V(*y), V(*z)], axis=1)


def hilt_sculpt():
    S = Sculpt(materials=MATS, default_mat="bronze")
    # ---- crossguard: a heavy straight bar flattened across the blade flat, ends angled toward the grip, block ends
    for sx in (1, -1):
        pts = [V(0, 0, GUARD_Z), V(sx * 0.07, 0, GUARD_Z - 0.001), V(sx * 0.13, 0, GUARD_Z - 0.006),
               V(sx * (GUARD_HALF - 0.02), 0, GUARD_Z - 0.016)]
        S.add(Chain(pts, [0.021, 0.019, 0.0175, 0.017], squash=(0.78, 1.0), ref=(0, 1, 0)), 0.006, mat="bronze")
        tc = V(sx * (GUARD_HALF - 0.012), 0, GUARD_Z - 0.018)
        S.add(RoundBox(tc, V(0.014, 0.019, 0.030), r=0.006), 0.005, mat="bronze")          # flared block end
        S.add(RoundBox(tc + V(sx * 0.010, 0, -0.004), V(0.008, 0.015, 0.022), r=0.004), 0.004, mat="bronze")
        S.sub(Torus(tc + V(sx * 0.0185, 0, -0.004), 0.0075, 0.0016,
                    _frame((0, 1, 0), (0, 0, 1), (sx, 0, 0))), 0.0008)                       # engraved ring
        # raised ridges along the top and bottom edges of each arm (read as a double bar at distance)
        for dz in (0.014, -0.014):
            S.add(Chain([V(sx * 0.05, 0, GUARD_Z + dz), V(sx * 0.13, 0, GUARD_Z + dz - 0.006),
                         V(sx * (GUARD_HALF - 0.028), 0, GUARD_Z + dz - 0.016)], 0.0045), 0.003, mat="bronze")
    # central langet block (sleeves the blade root), chunky
    S.add(RoundBox(V(0, 0, GUARD_Z + 0.014), V(0.088, 0.030, 0.044), r=0.010), 0.008, mat="bronze")   # C2 r4: wider blade root
    for sx in (1, -1):   # langet points running up onto the blade flats
        S.add(Chain([V(sx * 0.050, 0, GUARD_Z + 0.04), V(sx * 0.030, 0, GUARD_Z + 0.095)], [0.014, 0.005],
                    squash=(0.9, 1.0), ref=(0, 1, 0)), 0.006, mat="bronze")
    # ---- ram skull on both faces of the langet: tapered skull, brow ridge, eye sockets, nostrils, curled horns
    for sy in (1, -1):
        # C2 r2: skull 1.35x bigger (it was a bump under the langet) with deep eye sockets; the horns are the big guard ones
        skull_top = V(0, sy * 0.028, GUARD_Z + 0.046)
        muzzle = V(0, sy * 0.026, GUARD_Z - 0.030)
        S.add(RoundCone(skull_top, muzzle, 0.034, 0.016, squash=(0.62, 1.0), ref=(0, 1, 0)), 0.004, mat="bronze")
        S.add(Ellipsoid(V(0, sy * 0.034, GUARD_Z + 0.024), V(0.030, 0.010, 0.020)), 0.003, mat="bronze")  # brow dome
        for sx in (1, -1):
            S.sub(Sphere(V(sx * 0.016, sy * 0.046, GUARD_Z + 0.008), 0.0090), 0.0015)        # eye socket
            S.sub(Sphere(V(sx * 0.006, sy * 0.040, GUARD_Z - 0.024), 0.0036), 0.0008)        # nostril
    # ---- C2 r3 BIG DARK ram horns (board r2, Opus: "the ram-horn guard is invisible at the game camera — a generic
    # longsword; fixed = two dark-outlined curled horns, each clearly separate from blade and hand, >= ~8 px of
    # silhouette per side, contrasting in value with the gold/steel"). The r2 horns (bronze on bronze, tube 0.45-1.9 cm
    # = < 2 px, rooted INSIDE the blade width) merged with the guard. Now, stylised 2x: a thick KERATIN spiral per side
    # (dark 'horn' material, not bronze -> value contrast against the pale blade and the gold guard), centred fully
    # OUTSIDE the blade edge (4-5 cm gap: separate from the blade), rooted on the guard arm, curling out past the guard
    # end, up beside the blade root and back in; ~16 cm across x 20 cm tall (~14-18 px at the game camera), tube
    # 3.4 -> 1.2 cm, 268 deg sweep tightening to R 2.2 cm (an open curl: closed sweeps read as rings), deep growth ridges.
    # C2 r4 (board r3: "tan ~10 px curls only at 4x, overlapping the wrist"): centred 23.5 cm out (fully outside the 11 cm
    # blade half-width), 8.5 cm HIGHER (the curl now rises beside the blade root instead of sitting on the fist), R 9.2 cm,
    # tube 4.6 cm: ~24 x 28 cm of dark silhouette per side; the material is near-black horn (p_horn) with one warm rim.
    HORN_CX, HORN_CZ, HORN_R0, HORN_R1, HORN_T0, HORN_T1 = 0.245, GUARD_Z + 0.095, 0.102, 0.030, 0.056, 0.016   # fast2: thicker/bigger (fast1 curls were thin at the game camera)
    HORN_A0, HORN_SWEEP = -80, 268           # fast1 (r3): a 300 deg sweep with the thick tube closed into a RING; 268 leaves the curl open
    for sx in (1, -1):
        pts, rr = [], []
        n = 28
        for i in range(n + 1):
            t = i / n
            a = math.radians(HORN_A0 + HORN_SWEEP * t)   # from the guard arm (below) -> outward -> top -> tip pointing in/down
            R = HORN_R0 - (HORN_R0 - HORN_R1) * t
            pts.append(V(sx * (HORN_CX + R * math.cos(a)), 0.0, HORN_CZ + R * math.sin(a)))
            rr.append(HORN_T0 - (HORN_T0 - HORN_T1) * t ** 0.85)
        S.add(Chain(pts, rr, squash=(0.66, 1.0), ref=(0, 1, 0), k=0.004, margin=0.05), 0.004, mat="horn")
        for i in range(8):   # growth ridges along the sweep (tori around the horn tangent)
            t = 0.06 + 0.12 * i
            a = math.radians(HORN_A0 + HORN_SWEEP * t)
            R = HORN_R0 - (HORN_R0 - HORN_R1) * t
            c = V(sx * (HORN_CX + R * math.cos(a)), 0.0, HORN_CZ + R * math.sin(a))
            tang = norm(V(-math.sin(a) * sx, 0.0, math.cos(a)))        # torus axis (frame column 2) = horn tangent
            Mt = np.stack([norm(np.cross(V(0, 1, 0), tang)), V(0, 1, 0), tang], axis=1)
            S.add(Torus(c, (HORN_T0 - (HORN_T0 - HORN_T1) * t ** 0.85) * 0.9, 0.0052, Mt, squash=0.72), 0.0015, mat="horn")
        # a short bronze collar where the horn leaves the guard arm (the horn is SET in the guard, not glued on)
        rc = V(sx * (HORN_CX + HORN_R0 * math.cos(math.radians(HORN_A0))), 0.0, HORN_CZ + HORN_R0 * math.sin(math.radians(HORN_A0)))
        S.add(Torus(rc, HORN_T0 * 0.95, 0.006, _frame((1, 0, 0), (0, 1, 0), (0, 0, 1)), squash=0.72), 0.002, mat="bronze")
    # ---- grip: two-hand length, thick core + spiral leather wrap + bronze rings (top, between the hands, bottom)
    S.add(Capsule(V(0, 0, GRIP_BOT), V(0, 0, GRIP_TOP), GRIP_R), 0.0, mat="leather_dark")
    n = 220
    pts = []
    for i in range(n + 1):
        t = i / n
        z = GRIP_BOT + 0.012 + (GRIP_TOP - GRIP_BOT - 0.024) * t
        a = t * 2 * math.pi * 13
        pts.append(V(math.cos(a) * GRIP_R, math.sin(a) * GRIP_R, z))
    S.add(Chain(pts, 0.0046, margin=0.02), 0.0022, mat="leather_dark")
    for z in (GRIP_TOP - 0.004, (GRIP_TOP + GRIP_BOT) / 2 - 0.03, GRIP_BOT + 0.004):
        S.add(Torus(V(0, 0, z), GRIP_R + 0.0015, 0.0058), 0.0015, mat="bronze")
    # ---- pommel: heavy faceted bronze block (a diamond in silhouette) with a ring collar and a blunt point
    pc = V(0, 0, POMMEL_Z)
    S.add(Capsule(V(0, 0, GRIP_BOT - 0.004), pc + V(0, 0, 0.032), 0.016), 0.005, mat="bronze")
    S.add(Torus(pc + V(0, 0, 0.030), 0.024, 0.0065), 0.002, mat="bronze")
    Mf = rot(0, 0, 45)
    S.add(RoundBox(pc, V(0.0255, 0.0255, 0.024), M=Mf, r=0.004), 0.004, mat="bronze")
    S.add(RoundBox(pc, V(0.021, 0.021, 0.030), M=Mf, r=0.003), 0.003, mat="bronze")
    S.add(RoundCone(pc + V(0, 0, -0.024), pc + V(0, 0, -0.056), 0.020, 0.005, squash=(1.0, 1.0)), 0.004, mat="bronze")
    for sy in (1, -1):   # engraved knot ring on both pommel faces
        c = pc + V(0, sy * 0.0255, 0)
        S.sub(Torus(c, 0.0105, 0.0022, _frame((1, 0, 0), (0, 0, 1), (0, sy, 0))), 0.0008)
        S.add(Sphere(c + V(0, sy * 0.001, 0), 0.0045), 0.002, mat="bronze")
    return S


# ---------------------------------------------------------------------------- painters
def p_blade(c, pal):
    """C2 r5 WORN STEEL: warm-grey neutral flats (low-frequency value variation + fine lengthwise scratches), a dark warm
    fuller, a mid warm-grey satin bevel plane, a NARROW bright polished edge bevel (glossy, metallic), engraved
    (non-emissive) grudge runes as scorched grooves. No blue temper: the r4 icy blue-white read as plastic."""
    u = c.attr("blade_u")          # -1..1 across
    au = np.abs(u)
    rune = c.paint("rune")
    n1 = c.noise(14.0, 3, 71)
    n2 = c.noise(160.0, 2, 72)
    n0 = c.noise(2.6, 2, 73)                                                      # low-frequency value variation
    P = c.P
    # fine scratches along the blade (anisotropic: 60x across, 5x along), two seeds; brighten (fresh) and darken (old)
    sc1 = sdf.fbm(P[:, 0] * 70.0, P[:, 1] * 70.0, P[:, 2] * 5.0, 2, 1.0, seed=74)
    sc2 = sdf.fbm(P[:, 0] * 48.0, P[:, 1] * 48.0, P[:, 2] * 3.5, 2, 1.0, seed=75)
    scr_hi = shaders.smooth01(sc1, 0.70, 0.80)
    scr_lo = shaders.smooth01(sc2, 0.72, 0.82)
    flat = shaders.srgb(142, 138, 132)                                            # warm grey (r4: 230/233/238 icy)
    rgb = np.tile(flat, (c.n, 1)) * (1.0 + 0.05 * n1 + 0.03 * n2 + 0.16 * n0)[:, None]
    # C2 r8: distinct forged shadow half rising toward the honed bevel; retain the dark fuller.
    rgb *= (0.18 + 0.95 * shaders.smooth01(u, -0.35, 0.72))[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(226, 220, 206), 0.3 * scr_hi)
    rgb = shaders.mix(rgb, shaders.srgb(96, 90, 84), 0.45 * scr_lo)
    # ONE narrow dark fuller line (0.20 of the half width), a MID warm-grey satin bevel and a narrow bright polished edge
    bev = shaders.smooth01(au, 1.0 - BEVEL_HI - 0.03, 1.0 - BEVEL_HI + 0.03)      # bevel plane
    rgb = shaders.mix(rgb, shaders.srgb(200, 196, 186) * (0.55 + 0.45 * shaders.smooth01(au, 0.73, 0.98))[:, None], bev * 0.96)
    edge = shaders.smooth01(au, 0.935, 0.975)                                      # polished edge bevel (narrow, bright)
    rgb = shaders.mix(rgb, shaders.srgb(252, 248, 240), edge)
    fuller = shaders.smooth01(FULLER_HW - au, 0.0, 0.04)
    rgb = shaders.mix(rgb, shaders.srgb(48, 42, 40), fuller * 0.92)
    rgb = shaders.mix(rgb, shaders.srgb(52, 30, 20), rune)                          # scorched groove
    rough = 0.29 + 0.04 * n1 + 0.05 * n0 - 0.12 * bev - 0.30 * edge + 0.14 * fuller + 0.06 * scr_lo + 0.3 * rune
    # C2 r5: metallic again (0.62 flats / 0.85 bevel / 0.95 edge) -- the engine hue lock keeps the reflections neutral-warm
    metal = (0.62 + 0.23 * bev + 0.33 * edge - 0.1 * fuller) * (1.0 - 0.9 * rune)
    return shaders.out(c.n, rgb, np.clip(rough, 0.14, 0.9), np.clip(metal, 0, 1), 0.0)


def p_bronze(c, pal):
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "bronze")
    return rgb, np.clip(rough, 0.25, 0.9), metal, np.zeros(c.n)


def p_horn(c, pal):
    """C2 r3 ram horn: dark keratin, matte, dielectric — a DARK shape against the pale blade and the gold guard.
    C2 r4 (board r3: the r3 umber + 45 % pale ridges lit to TAN under the stage key): NEAR-BLACK horn (22/16/14), the ridges
    only a little paler (0.22 mix) and glossier, so the sole bright accent is one warm specular rim from the stage light."""
    n1 = c.noise(28.0, 3, 81)
    n2 = c.noise(150.0, 2, 82)
    rgb = np.tile(pal["horn"], (c.n, 1)) * (1.0 + 0.10 * n1 + 0.05 * n2)[:, None]
    rgb = shaders.mix(rgb, pal["horn_pale"], 0.22 * shaders.smooth01(c.ridge, 0.08, 0.6))
    rgb = shaders.mix(rgb, rgb * 0.5, 0.7 * c.cav)
    rough = 0.52 + 0.08 * n1 - 0.26 * c.ridge
    return shaders.out(c.n, rgb, np.clip(rough, 0.22, 0.9), 0.0, 0.0)


def build(args):
    T0 = time.time()
    fast = getattr(args, "fast", False)
    res = 512 if fast else 1024
    meshutil.clear_scene()
    device = pipeline.setup_cycles(getattr(args, "device", "AUTO"))
    report = {"asset": "weapon_grudgebrand", "device": device, "res": res}

    # ---------------------------------------------------------------- blade HI / LO (bmesh)
    st_hi = np.concatenate([np.linspace(0, 0.88, 300), np.linspace(0.88, 1.0, 60)[1:]])
    blade_hi, co_hi = weapon.blade_mesh("blade_hi", BLADE_Z0, BLADE_LEN, width_fn, thick_fn, n_half=36,
                                        stations=st_hi, fuller=(0.05, 0.78, FULLER_HW, 0.55), bevel=BEVEL_HI)
    strokes = weapon.rune_strokes(seed=11, n=7, s0=0.12, s1=0.64, cell_u=0.16)
    weapon.engrave(blade_hi, co_hi, strokes, BLADE_LEN, half_w, width=0.0034, depth=0.0009)
    weapon.notch_edges(blade_hi, co_hi, NOTCHES, BLADE_LEN)
    weapon.nick_edges(blade_hi, co_hi, seed=5, n=7, depth=0.003, width=0.009, length=BLADE_LEN)
    meshutil.add_float_attr(blade_hi, "blade_u", co_hi[:, 1])
    st_lo = weapon.notch_stations([0, 0.06, 0.16, 0.28, 0.44, 0.62, 0.76, 0.80, 0.86, 0.91, 0.95, 0.98, 1.0],
                                  NOTCHES, BLADE_LEN)
    blade_lo, co_lo = weapon.blade_mesh("blade_lo", BLADE_Z0, BLADE_LEN, width_fn, thick_fn, n_half=5,
                                        stations=st_lo, fuller=(0.05, 0.78, FULLER_HW, 0.0), bevel=BEVEL_LO)
    weapon.notch_edges(blade_lo, co_lo, NOTCHES, BLADE_LEN)
    # ---------------------------------------------------------------- hilt HI / LO (SDF)
    S = hilt_sculpt()
    lo_b, hi_b = V(-GUARD_HALF - 0.21, -0.07, POMMEL_Z - 0.08), V(GUARD_HALF + 0.21, 0.07, GUARD_Z + 0.27)   # C2 r4: bigger horns, higher
    hilt_hi = pipeline.sculpt_mesh(S, "hilt_hi", 0.0009 if fast else 0.00045, lo_b, hi_b)
    hilt_tris = getattr(args, "weapon_hilt_tris", 2000)
    hilt_lo = pipeline.lowpoly(S, "hilt_lo", 0.0016, hilt_tris, lo_b, hi_b)
    los, his = [blade_lo, hilt_lo], [blade_hi, hilt_hi]
    report["parts"] = {o.name: meshutil.tri_count(o) for o in los}

    # ---------------------------------------------------------------- UV
    for o, dens in ((blade_lo, 1.0), (hilt_lo, 1.5)):
        allf = np.ones(len(o.data.polygons), bool)
        pipeline.smart_project_faces(o, allf, angle=60.0)
        pipeline.normalize_density(o, allf, dens)
    report["uv_fill"] = pipeline.pack_atlas(los, margin=0.006)

    # ---------------------------------------------------------------- materials, bake
    # bright warm bronze with only a little verdigris in the recesses: reads as GOLD at the game camera
    # C2 r2: darker aged bronze (the r1 bright gold sat at the same value as the pale blade); bright ridges keep it metal
    pal = dict(bronze=shaders.srgb(198, 136, 60), bronze_patina=shaders.srgb(66, 96, 80), bronze_patina_amt=0.45,
               leather_dark=shaders.srgb(62, 38, 26), leather_dark_worn=shaders.srgb(128, 88, 60),
               iron=shaders.srgb(120, 122, 130),
               horn=shaders.srgb(22, 16, 14), horn_pale=shaders.srgb(118, 90, 62))         # C2 r4 near-black ram horns
    shaders.assign_bake_materials(hilt_hi, S.materials, prefix="wk_", kinds={"horn": "leather"})
    shaders.paint_mesh(hilt_hi, S.materials, {}, pal, {}, painters={"bronze": p_bronze, "horn": p_horn})
    blade_hi.data.materials.clear()
    blade_hi.data.materials.append(shaders.bake_material("wk_blade", "iron"))
    shaders.paint_mesh(blade_hi, ["blade"], {}, pal, {}, painters={"blade": p_blade})
    jobs = [(blade_lo, [blade_hi], 0.005, 0.016), (hilt_lo, [hilt_hi], 0.004, 0.012)]
    B = pipeline.Baker(res, jobs, shaders.set_pass, los, his)
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 32 if fast else 64),
                         ("normal", "NORMAL", 8)])
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao_s, ao_l = np.clip(maps["ao"][..., 0], 0, 1), np.clip(maps["ao"][..., 1], 0, 1)
    occl = np.clip(1.0 - 0.7 * (1 - ao_s) - 0.35 * (1 - ao_l), 0, 1)[..., None]
    rgb = alb[..., :3] * (np.array([0.5, 0.36, 0.3]) + (1 - np.array([0.5, 0.36, 0.3])) * occl)
    prm = maps["prm"]
    orm = np.stack([np.clip(0.4 + 0.6 * ao_l * ao_s, 0, 1), np.clip(prm[..., 0], 0.05, 1), np.clip(prm[..., 1], 0, 1)], -1)
    rgb, orm, nrm = (pipeline.dilate(x, cov, 12) for x in (rgb, orm, maps["normal"][..., :3]))
    tex = dict(
        albedo=pipeline.save_png(rgb, os.path.join(OUT_TEX, "brann_grudgebrand_albedo.png"), "grudge_albedo", "sRGB", True),
        orm=pipeline.save_png(orm, os.path.join(OUT_TEX, "brann_grudgebrand_orm.png"), "grudge_orm", "Non-Color"),
        normal=pipeline.save_png(nrm, os.path.join(OUT_TEX, "brann_grudgebrand_normal.png"), "grudge_normal", "Non-Color"))
    # C2: no emissive runes on the sword (only the Copper Ax glows); drop the stale emissive map
    stale = os.path.join(OUT_TEX, "brann_grudgebrand_emissive.png")
    if os.path.exists(stale):
        os.remove(stale)

    # ---------------------------------------------------------------- export
    mat = pipeline.final_material("M_weapon_grudgebrand", tex["albedo"], tex["normal"], tex["orm"])
    for o in los:
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
    for o in his:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    ob = meshutil.join(los, "weapon_grudgebrand")
    report["tris"] = meshutil.tri_count(ob)
    # attachment empties (glTF nodes, children of the mesh node, identity rotation = weapon frame):
    #   grip_main    right (main) hand grip point = origin (just under the guard)
    #   grip_offhand left (off) hand grip point, same axis, GRIP_L_Z below  -> two-hand IK target
    #   blade_tip    point of the blade (trail FX / reach)
    empties = []
    for name, z in (("grip_main", 0.0), ("grip_offhand", GRIP_L_Z), ("blade_tip", BLADE_Z0 + BLADE_LEN)):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = (0.0, 0.0, z)
        e.parent = ob
        empties.append(e)
    report["nodes"] = {e.name: list(e.location) for e in empties}
    P = meshutil.get_verts(ob)
    report["bounds"] = {"min": P.min(axis=0).tolist(), "max": P.max(axis=0).tolist()}
    report["blade_width_cm"] = {str(s): round(width_fn(s) * 100, 1) for s in (0.0, 0.3, 0.55, 0.8, 0.9)}
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, "weapon_grudgebrand.glb")
    pipeline.export_glb(out, [ob] + empties, scene_name="weapon_grudgebrand")
    report["glb"] = out
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "grudgebrand_report.json"), report)
    pipeline.log(f"DONE weapon_grudgebrand in {report['seconds']:.0f}s ({report['tris']} tris)")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--weapon-hilt-tris", type=int, default=2000)
    build(ap.parse_args(argv))
