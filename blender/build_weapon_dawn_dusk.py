"""Dawn & Dusk - Seraphine Vey's twin curved sabres (original designs), Wave C2 r1: STYLISED rebuild.

C1 boards: the 4.8-6.4 cm blades read as needles / blown-out bars at belt scale. Reference
docs/refs/c2/heroes/hero_weapons.png (middle pair): broad curved sabres with a flared yelman and a clipped
hook step near the tip, Dawn in warm gold-bronze with a radiant sun-disc guard, Dusk in violet-steel with a
crescent-moon guard; light bright flats, dark bevels.

C2 proportions (>= 1.6x width, ~2x thickness): blade 8.0 cm at the root flaring to 11.0 cm at the yelman
(70 %), 1.7 -> 1.2 cm thick, a 0.28-wide dark bevel plane under bright flats, a visible fuller, a real clip
notch on the back edge at the yelman (LO silhouette too), engraved (NOT emissive) runes; big sun disc / crescent
guards that read at the game camera; Dawn = gold-bronze blade (warm gold steel), Dusk = light violet steel
(the old dusk blade was too dark and read as a stick).

Both: ~0.95 m overall, blade 0.76 m, sagitta ~9.5 cm toward the back, one-hand grip 13 cm (unchanged contract:
grip point at the origin, blade along +Z (Blender) = +Y (glTF), flat facing +-Y, cutting edge +X (convex side);
tip at y 0.796 -> src/anim/profiles.js seraphine blade R 0.84). Nodes: grip_main (origin), blade_tip.
Outputs public/assets/models/weapon_dawn.glb, weapon_dusk.glb and public/assets/textures/seraphine_{dawn,dusk}_*.png.
C2 r2 (board r1 "Dawn = matte tan wood; the pair never reads"): Dawn = saturated gold steel at metal 0.80 / rough
0.38 (real highlight), Dusk = saturated mid-violet steel at metal 0.72 with a silver edge, wider crescent guard.
C2 r3 (board r2 "Dawn = flat orange/olive cut-out"): Dawn = painted gold (metal 0.45 flats, brighter, darker bevel) with a
painted warm-white highlight stripe + faint gold emissive on the stripe and the honed edge (seraphine_dawn_emissive.png).
Dusk unchanged (build with --only dawn).
C2 r4 (board r3 5.83: "in play the sabres are too small/thin; Dawn a thin brown-gold line, matte bronze/olive, cream on
select; needs a dark face, gold bevel and a narrow bright edge"): VISUAL scale-up (blade 1.5x wider = 12 -> 16.5 cm,
1.2x longer: tip 0.796 -> 0.936 m = 53 % of Seraphine's 1.76 m, 1.25x thicker, sagitta 11.2 cm, sun disc / crescent
guards ~1.3x; grip contract unchanged) and Dawn repainted: DARK burnished-gold face, BRIGHT gold bevel planes (0.34 of
the half width), a warm-white honed edge, the faint gold emissive now on the bevel + edge. Dusk: scale only.
C2 r5 (board r4 6.42: "Dawn = matte ochre wooden paddle, Dusk flat lavender, both read as thick straight blades"):
Dawn = METALLIC gold (metal 0.82 flats, rough 0.30-0.44: dark gold face, bright gold bevel, white-hot edge), Dusk =
violet steel (metal 0.8) with a LIGHTER lavender bevel highlight and a silver edge; sagitta 11.2 -> 16.5 cm = a visible
sabre curve (blade_tip node follows curve_x; the trail tip is measured from the GLB bbox + node). The engine's
hue-locked metal (render/characterLook.js, opted in by anim/retarget.js) keeps gold gold and violet violet at every
angle instead of mirroring the dusk sky, which is why the r2 "mirror" failure no longer applies.
C2 r6 (board r5 6.92: "Dusk = flat lavender plastic on select / saturated neon royal blue in game, no value step against
the mauve ground; Dawn = gold but broad colour bands"): VALUE RANGE on both blades. Dusk = violet STEEL: greyer, darker
violet face with a fuller-to-edge gradient (dark at the fuller, lighter toward the bevel), a bevel that ramps from mid
violet to a BRIGHT lavender line next to the silver edge, a deeper fuller; Dawn = darker burnished face with the same
gradient, bevel ramp from mid gold to bright gold at the edge; both glossier (rough 0.32-0.34 flats, 0.18-0.2 bevel/edge)
so the key prints a travelling streak; deeper cavity darkening in the bake post. Engine: anim/retarget.js per-weapon lock
floor / contrast / sky-reflection scale (characterLook.js kMetalTint.w, kMetalEnv).
Run:  blender -b --factory-startup -P blender/build_weapon_dawn_dusk.py -- [--fast] [--only dawn|dusk]
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

GUARD_Z = 0.03
BLADE_Z0 = 0.036
BLADE_LEN = 0.90           # C2 r4: 0.76 -> 0.90 (tip 0.936; src/anim/profiles.js seraphine blade R/L 1.0)
SAG = 0.165                # curvature (x offset of the tip toward -X, the back of the blade); C2 r5: 11.2 -> 16.5 cm = a visible sabre curve
VIS = 1.5                  # C2 r4 visual width scale (8-11 cm -> 12-16.5 cm)
GRIP_TOP, GRIP_BOT = 0.018, -0.112
POMMEL_Z = -0.130
GRIP_R = 0.0145
MATS = ["iron", "bronze", "leather_dark", "cloth"]
BEVEL_HI, BEVEL_LO = 0.28, 0.25
BEVEL_DAWN = 0.34          # C2 r4: Dawn's bright gold bevel planes are wider (the bevel is the gold, the face is dark)
# clip step on the back edge (-X) at the yelman + one battle nick on the cutting edge (+X)
NOTCHES = [(0.735, -1, 0.016 * VIS, 0.034), (0.36, 1, 0.006 * VIS, 0.021)]
DAWN_GLOW = np.array([1.0, 0.80, 0.46])    # C2 r3: Dawn's highlight stripe / honed edge emissive tint (warm gold)
DAWN_GLOW_STRENGTH = 0.45                  # under the stage bloom thresholds: luminous gold, not a light sabre


def width_fn(s):
    """Full blade width (x VIS): 8.0 cm at the root flaring to 11.0 cm at the yelman (70 %), then a broad clipped point."""
    if s < 0.70:
        w = 0.080 + 0.030 * (s / 0.70) ** 1.25
    else:
        w = 0.110 * max(0.0, 1.0 - (s - 0.70) / 0.30) ** 0.74
    return max(w * VIS, 0.0006)


def thick_fn(s):
    t = 0.021 - 0.006 * s          # C2 r4: 1.25x
    if s > 0.9:
        t *= max(0.2, 1.0 - (s - 0.9) / 0.1)
    return t


def half_w(s):
    return width_fn(s) * 0.5


def curve_x(z):
    s = np.clip((np.asarray(z) - BLADE_Z0) / BLADE_LEN, 0, 1)
    return -SAG * s ** 2


def _set_verts(ob, P):
    ob.data.vertices.foreach_set("co", P.astype(np.float32).ravel())
    ob.data.update()


def _frame(x, y, z):
    return np.stack([V(*x), V(*y), V(*z)], axis=1)


def hilt_sculpt(kind):
    S = Sculpt(materials=MATS, default_mat="bronze")
    gm = "bronze" if kind == "dawn" else "iron"
    wrap = "leather_dark" if kind == "dawn" else "cloth"
    # grip core + spiral wrap + ferrules
    S.add(Capsule(V(0, 0, GRIP_BOT), V(0, 0, GRIP_TOP), GRIP_R), 0.0, mat=wrap)
    n = 120
    pts = []
    for i in range(n + 1):
        t = i / n
        z = GRIP_BOT + 0.006 + (GRIP_TOP - GRIP_BOT - 0.012) * t
        a = t * 2 * math.pi * 8
        pts.append(V(math.cos(a) * GRIP_R, math.sin(a) * GRIP_R, z))
    S.add(Chain(pts, 0.0036, margin=0.02), 0.002, mat=wrap)
    for z in (GRIP_TOP - 0.002, GRIP_BOT + 0.002):
        S.add(Torus(V(0, 0, z), GRIP_R + 0.001, 0.0042), 0.0015, mat=gm)
    # langet collar sleeving the blade root (both kinds)
    S.add(RoundBox(V(0, 0, GUARD_Z + 0.006), V(0.045, 0.016, 0.018), r=0.005), 0.005, mat=gm)   # C2 r4: wider blade root
    if kind == "dawn":
        # S-guard: a thick quillon curling up toward the blade on the edge side, the other down toward the pommel
        # C2 r4: quillons 1.3x further out (the blade root is 12 cm wide now)
        S.add(Chain([V(0, 0, GUARD_Z), V(0.047, 0, GUARD_Z + 0.004), V(0.081, 0, GUARD_Z + 0.024),
                     V(0.088, 0, GUARD_Z + 0.054)], [0.0120, 0.0100, 0.0082, 0.0068], squash=(0.8, 1.0), ref=(0, 1, 0)),
              0.004, mat="bronze")
        S.add(Sphere(V(0.088, 0, GUARD_Z + 0.059), 0.0095), 0.003, mat="bronze")
        S.add(Chain([V(0, 0, GUARD_Z), V(-0.047, 0, GUARD_Z - 0.004), V(-0.078, 0, GUARD_Z - 0.028),
                     V(-0.081, 0, GUARD_Z - 0.058)], [0.0120, 0.0100, 0.0082, 0.0068], squash=(0.8, 1.0),
                    ref=(0, 1, 0)), 0.004, mat="bronze")
        S.add(Sphere(V(-0.081, 0, GUARD_Z - 0.063), 0.0095), 0.003, mat="bronze")
        # BIG sun disc on both faces with 12 rays (reads as a gold sunburst at the game camera)
        for sy in (1, -1):
            M = _frame((1, 0, 0), (0, 0, 1), (0, sy, 0))
            c = V(0, sy * 0.013, GUARD_Z + 0.002)          # C2 r4: sun disc 1.3x (R 3.1 -> 4.0 cm, rays to 6 cm)
            S.add(Ellipsoid(c, V(0.040, 0.040, 0.0070), M), 0.003, mat="bronze")
            S.add(Torus(c + V(0, sy * 0.005, 0), 0.031, 0.0032, M), 0.0012, mat="bronze")
            S.add(Ellipsoid(c + V(0, sy * 0.0055, 0), V(0.015, 0.015, 0.0045), M), 0.002, mat="bronze")
            S.sub(Torus(c + V(0, sy * 0.0095, 0), 0.0175, 0.0016, M), 0.0006)
            for i in range(12):
                a = i / 12 * 2 * math.pi
                d = V(math.cos(a), 0, math.sin(a))
                S.add(Chain([c + d * 0.036, c + d * 0.060], [0.0055, 0.0014], squash=(0.75, 1.0), ref=(0, 1, 0)),
                      0.0015, mat="bronze")
        # pommel: sun sphere with a ray crown
        pc = V(0, 0, POMMEL_Z)
        S.add(Capsule(V(0, 0, GRIP_BOT), pc, 0.011), 0.004, mat="bronze")
        S.add(Sphere(pc, 0.021), 0.004, mat="bronze")
        for i in range(8):
            a = i / 8 * 2 * math.pi
            d = norm(V(math.cos(a), math.sin(a), -0.55))
            S.add(Chain([pc + d * 0.016, pc + d * 0.031], [0.0055, 0.0012]), 0.002, mat="bronze")
        S.add(Sphere(pc + V(0, 0, -0.022), 0.0075), 0.003, mat="bronze")
    else:
        # crescent-moon guard (horns sweep toward the blade), blackened steel, bigger span
        pts, rr = [], []
        for i in range(17):
            u = -1 + 2 * i / 16
            a = u * math.radians(82)
            pts.append(V(math.sin(a) * 0.098, 0, 0))                      # C2 r4: crescent 7.8 -> 9.8 cm (blade 1.5x wider)
            rr.append(0.0135 * (1 - 0.66 * abs(u) ** 1.5))
        pts = [V(p[0], 0, GUARD_Z + 0.003 + (0.098 - math.sqrt(max(0, 0.098 ** 2 - p[0] ** 2))) * 0.95) for p in pts]
        S.add(Chain(pts, rr, squash=(0.75, 1.0), ref=(0, 1, 0)), 0.004, mat="iron")
        for sx in (1, -1):   # bright horn tips
            S.add(Sphere(V(sx * 0.0975, 0, GUARD_Z + 0.003 + 0.084), 0.007), 0.002, mat="bronze")
        S.add(RoundBox(V(0, 0, GUARD_Z + 0.003), V(0.024, 0.015, 0.016), r=0.005), 0.004, mat="iron")
        for sy in (1, -1):   # moon-disc boss: a bronze ring around a dark moon with a crescent cut
            c = V(0, sy * 0.015, GUARD_Z + 0.003)
            M = _frame((1, 0, 0), (0, 0, 1), (0, sy, 0))
            S.add(Ellipsoid(c, V(0.027, 0.027, 0.0055), M), 0.002, mat="iron")      # C2 r4: moon boss 1.25x
            S.add(Torus(c + V(0, sy * 0.0033, 0), 0.023, 0.0030, M), 0.001, mat="bronze")
            S.sub(Ellipsoid(c + V(0.0075, sy * 0.0075, 0.0025), V(0.0138, 0.0138, 0.0045), M), 0.001)
        # crescent pommel, bigger
        pc = V(0, 0, POMMEL_Z)
        S.add(Capsule(V(0, 0, GRIP_BOT), pc, 0.011), 0.004, mat="iron")
        cp = []
        for i in range(13):
            u = -1 + 2 * i / 12
            a = u * math.radians(100)
            cp.append(pc + V(math.sin(a) * 0.029, 0, -math.cos(a) * 0.029 + 0.008))
        S.add(Chain(cp, [0.0095 * (1 - 0.68 * abs(-1 + 2 * i / 12) ** 1.6) for i in range(13)], squash=(0.7, 1.0),
                    ref=(0, 1, 0)), 0.004, mat="iron")
        S.add(Sphere(pc, 0.013), 0.004, mat="iron")
    return S


def blade_painter(kind):
    if kind == "dawn":
        # C2 r2 (board r1: "Dawn's gold reads as flat matte tan, almost wooden"): saturated GOLD steel, high metalness,
        # low roughness -> a real specular highlight; dark burnished bevel, honed pale-gold edge line
        # C2 r3 (board r2, Sol: "Dawn still reads as a flat orange/olive cut-out close in value to the brown ground"):
        # the r2 metal 0.80 flats were a MIRROR of the dusk stage (dark purple sky / brown ground -> olive-orange), the
        # same failure as the r1 Copper Ax. Stylised painted gold instead: metal 0.45 flats (the colour is the albedo,
        # not the reflection), brighter flats, a DARKER bevel for value separation, a PAINTED warm-white highlight
        # stripe along the flat (reads from every angle, like a hand-painted sabre) that is also faintly emissive with
        # the honed edge line, so the gold stays luminous in the dark stages (strength 0.45, under the bloom threshold).
        # C2 r4 (board r3, Astra: "give face, bevel and cutting edge distinct values: dark face, gold bevel, narrow bright
        # edge"; Muse: "select-screen Dawn overexposed cream"): the r3 bright flat + dark bevel went cream in the select
        # torchlight and olive in play. Inverted: a DARK burnished-gold face (the big area, never blows out), BRIGHT
        # saturated-gold bevel planes (0.34 of the half width each side = the gold read), a warm-white honed edge, and a
        # softer mid-gold fuller stripe on the face so it is not a flat brown bar.
        # C2 r5: METALLIC gold -- dark gold face, bright saturated-gold bevel, white-hot honed edge, metal 0.82 / rough 0.44
        # flats (0.30 bevel, 0.2 edge); the engine's hue lock keeps the reflection gold, so high metalness is safe again
        # C2 r6: darker burnished face, bevel ramp (bev_in -> bev at the edge), glossier
        flat, bev, fuller, edge, temper = (112, 64, 12), (252, 196, 70), (196, 134, 52), (255, 248, 226), (190, 118, 40)
        bev_in, flat_lo, flat_hi = (184, 128, 36), (74, 42, 8), (168, 104, 28)
        metal0, rough0 = 0.84, 0.34
    else:
        # C2 r2: saturated mid-violet steel (the r1 lilac went grey-pink next to Dawn), deep violet bevel, honed silver
        # edge line, metallic sheen
        # C2 r5 (board r4: "Dusk flat lavender, no bevel highlight"): mid violet STEEL face, a LIGHTER lavender bevel
        # highlight (the bevel reads as the lit plane), deep violet fuller, silver-white honed edge, metal 0.80
        # fast1: (108, 80, 190) flats read as saturated lavender plastic at the game camera -> greyer violet STEEL
        # C2 r6 (board r5 "flat lavender plastic / neon royal blue, no value step against the ground"): violet STEEL --
        # greyer darker face, dark fuller side -> lighter bevel side gradient, bevel ramps to a BRIGHT lavender line
        # fast1: (92, 84, 128) printed dark NAVY under the stage-1 blue shadow grade -> more red in every violet
        flat, bev, fuller, edge, temper = (104, 86, 130), (218, 200, 246), (48, 32, 84), (248, 242, 255), (126, 104, 166)
        bev_in, flat_lo, flat_hi = (132, 112, 174), (62, 46, 90), (142, 120, 176)
        metal0, rough0 = 0.84, 0.32

    def p_blade(c, pal):
        u = c.attr("blade_u")
        au = np.abs(u)
        rune = c.paint("rune")
        n1 = c.noise(14.0, 3, 71)
        n2 = c.noise(160.0, 2, 72)
        rgb = np.tile(shaders.srgb(*flat), (c.n, 1)) * (1.0 + 0.07 * n1 + 0.03 * n2)[:, None]
        # C2 r6: fuller-to-edge VALUE GRADIENT on the flat (dark at the back / fuller side, lighter toward the cutting bevel)
        rgb = shaders.mix(rgb, shaders.srgb(*flat_lo), 0.7 * shaders.smooth01(-u, 0.05, 0.75))
        rgb = shaders.mix(rgb, shaders.srgb(*flat_hi), 0.55 * shaders.smooth01(u, 0.25, 0.70))
        bv = BEVEL_DAWN if kind == "dawn" else BEVEL_HI
        b = shaders.smooth01(au, 1.0 - bv - 0.03, 1.0 - bv + 0.03)
        # C2 r6: the bevel plane RAMPS from a mid tone at its inner line to the bright colour next to the edge (a bright
        # bevel line that holds the hue), instead of one flat pale band
        bt = shaders.smooth01(au, 1.0 - bv + 0.02, 0.965)
        bev_rgb = shaders.mix(np.tile(shaders.srgb(*bev_in), (c.n, 1)), shaders.srgb(*bev), bt)
        rgb = shaders.mix(rgb, bev_rgb, b * (0.96 if kind == "dawn" else 0.94))
        e = shaders.smooth01(u, 0.955, 0.99) + 0.6 * shaders.smooth01(-u, 0.96, 0.995)    # honed edge (+X) bright
        e = np.clip(e, 0, 1)
        rgb = shaders.mix(rgb, shaders.srgb(*edge), e)
        fu = shaders.smooth01(0.22 - np.abs(u + 0.22), 0.0, 0.05)
        rgb = shaders.mix(rgb, shaders.srgb(*fuller), fu * (0.6 if kind == "dawn" else 0.8))
        rgb = shaders.mix(rgb, shaders.srgb(*temper), 0.12 * shaders.smooth01(n1, 0.3, 0.8) * (1 - b))
        emit = np.zeros(c.n)
        if kind == "dawn":
            # C2 r3: painted highlight stripe on the cutting-edge half of the flat (between the fuller and the bevel),
            # 1.3-1.9 cm wide, warm-white, glossier; faintly emissive together with the honed edge line
            # C2 r4: the stripe is now a soft mid-gold band on the dark face (not warm-white: that was the cream); the
            # emissive moved to the bright bevel + honed edge, so the GOLD is what glows faintly in dark stages
            hl = shaders.smooth01(u, 0.14, 0.26) * (1.0 - shaders.smooth01(u, 0.46, 0.58)) * (1.0 - b)
            hl *= 0.75 + 0.25 * shaders.smooth01(n1, 0.2, 0.7)
            rgb = shaders.mix(rgb, shaders.srgb(222, 160, 70), 0.6 * hl)
            emit = np.clip(0.30 * b + 0.7 * e + 0.15 * hl, 0, 1) * (1.0 - rune)
        rgb = shaders.mix(rgb, shaders.srgb(50, 24, 18), rune)
        # C1 r2 lesson: flats must stay ~0.55+ rough under the showcase 3.0 key or they saturate to white bars;
        # the bevel is matte and only the honed edge line is glossy
        # C2 r2: the select key is 1.2 (not the showcase 3.0 the C1 r2 note feared) -> rough 0.38-0.42 flats are safe
        rough = rough0 + 0.05 * n1 - 0.14 * b - 0.16 * e + 0.06 * fu + 0.25 * rune      # C2 r6: glossier flats, bevel + edge
        metal = (metal0 + 0.10 * b + 0.12 * e) * (1.0 - 0.9 * rune)
        if kind == "dawn":
            rough = rough - 0.06 * hl - 0.04 * b          # glossy gold bevels, satin dark face
            metal = metal + 0.10 * hl + 0.08 * b
        return shaders.out(c.n, rgb, np.clip(rough, 0.18, 0.9), np.clip(metal, 0, 1), emit)
    return p_blade


def p_blued(c, pal):
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "iron")
    return rgb, rough, metal * 0.6, np.zeros(c.n)


def p_bronze(c, pal):
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "bronze")
    return rgb, np.clip(rough, 0.25, 0.9), metal, np.zeros(c.n)


def build_one(kind, args):
    T0 = time.time()
    fast = getattr(args, "fast", False)
    res = 512 if fast else 1024
    meshutil.clear_scene()
    device = pipeline.setup_cycles(getattr(args, "device", "AUTO"))
    name = "weapon_" + kind
    report = {"asset": name, "device": device, "res": res}
    st_hi = np.concatenate([np.linspace(0, 0.86, 260), np.linspace(0.86, 1.0, 60)[1:]])
    blade_hi, co_hi = weapon.blade_mesh("blade_hi", BLADE_Z0, BLADE_LEN, width_fn, thick_fn, n_half=30,
                                        stations=st_hi, fuller=(0.05, 0.68, 0.22, 0.45), bevel=BEVEL_DAWN if kind == "dawn" else BEVEL_HI)
    strokes = weapon.rune_strokes(seed=21 if kind == "dawn" else 33, n=6, s0=0.08, s1=0.46, cell_u=0.12)
    weapon.engrave(blade_hi, co_hi, strokes, BLADE_LEN, half_w, width=0.0022, depth=0.0006)
    weapon.notch_edges(blade_hi, co_hi, NOTCHES, BLADE_LEN)
    meshutil.add_float_attr(blade_hi, "blade_u", co_hi[:, 1])
    st_lo = weapon.notch_stations([0, 0.07, 0.16, 0.26, 0.38, 0.5, 0.6, 0.68, 0.76, 0.83, 0.9, 0.95, 0.98, 1.0],
                                  NOTCHES, BLADE_LEN)
    blade_lo, co_lo = weapon.blade_mesh("blade_lo", BLADE_Z0, BLADE_LEN, width_fn, thick_fn, n_half=5,
                                        stations=st_lo, fuller=(0.05, 0.68, 0.22, 0.0), bevel=(BEVEL_DAWN - 0.03) if kind == "dawn" else BEVEL_LO)
    weapon.notch_edges(blade_lo, co_lo, NOTCHES, BLADE_LEN)
    for o in (blade_hi, blade_lo):
        P = meshutil.get_verts(o)
        P[:, 0] += curve_x(P[:, 2])
        _set_verts(o, P)
    S = hilt_sculpt(kind)
    lo_b, hi_b = V(-0.115, -0.045, POMMEL_Z - 0.045), V(0.115, 0.045, GUARD_Z + 0.10)   # C2 r4: bigger guards
    hilt_hi = pipeline.sculpt_mesh(S, "hilt_hi", 0.0008 if fast else 0.0004, lo_b, hi_b)
    hilt_lo = pipeline.lowpoly(S, "hilt_lo", 0.0012, 1750, lo_b, hi_b)
    los, his = [blade_lo, hilt_lo], [blade_hi, hilt_hi]
    report["parts"] = {o.name: meshutil.tri_count(o) for o in los}
    for o, dens in ((blade_lo, 1.0), (hilt_lo, 1.6)):
        allf = np.ones(len(o.data.polygons), bool)
        pipeline.smart_project_faces(o, allf, angle=60.0)
        pipeline.normalize_density(o, allf, dens)
    report["uv_fill"] = pipeline.pack_atlas(los, margin=0.006)
    if kind == "dawn":
        pal = dict(bronze=shaders.srgb(240, 186, 90), bronze_patina=shaders.srgb(130, 96, 52), bronze_patina_amt=0.22,
                   leather_dark=shaders.srgb(70, 40, 28), leather_dark_worn=shaders.srgb(128, 88, 62),
                   iron=shaders.srgb(120, 122, 130), cloth=shaders.srgb(150, 16, 28))
    else:
        pal = dict(bronze=shaders.srgb(206, 160, 100), bronze_patina=shaders.srgb(80, 70, 60), bronze_patina_amt=0.25,
                   leather_dark=shaders.srgb(40, 26, 22), iron=shaders.srgb(96, 100, 126),
                   iron_patina=shaders.srgb(40, 38, 58), iron_patina_amt=0.35, cloth=shaders.srgb(150, 18, 34))
    shaders.assign_bake_materials(hilt_hi, S.materials, prefix="wk_" + kind + "_", kinds={"cloth": "cloth"})
    shaders.paint_mesh(hilt_hi, S.materials, {}, pal, {},
                       painters={"iron": p_blued, "bronze": p_bronze} if kind == "dusk" else {"bronze": p_bronze})
    blade_hi.data.materials.clear()
    blade_hi.data.materials.append(shaders.bake_material("wk_" + kind + "_blade", "iron"))
    shaders.paint_mesh(blade_hi, ["blade"], {}, pal, {}, painters={"blade": blade_painter(kind)})
    jobs = [(blade_lo, [blade_hi], 0.004, 0.014), (hilt_lo, [hilt_hi], 0.003, 0.01)]
    B = pipeline.Baker(res, jobs, shaders.set_pass, los, his)
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 32 if fast else 64),
                         ("normal", "NORMAL", 8)])
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao_s, ao_l = np.clip(maps["ao"][..., 0], 0, 1), np.clip(maps["ao"][..., 1], 0, 1)
    occl = np.clip(1.0 - 0.7 * (1 - ao_s) - 0.35 * (1 - ao_l), 0, 1)[..., None]
    tint = np.array([0.34, 0.26, 0.24])   # C2 r6: deeper cavity darkening (r5 0.5/0.36/0.3)
    rgb = alb[..., :3] * (tint + (1 - tint) * occl)
    prm = maps["prm"]
    orm = np.stack([np.clip(0.4 + 0.6 * ao_l * ao_s, 0, 1), np.clip(prm[..., 0], 0.05, 1), np.clip(prm[..., 1], 0, 1)], -1)
    rgb, orm, nrm = (pipeline.dilate(x, cov, 12) for x in (rgb, orm, maps["normal"][..., :3]))
    pre = "seraphine_" + kind
    tex = dict(
        albedo=pipeline.save_png(rgb, os.path.join(OUT_TEX, pre + "_albedo.png"), pre + "_albedo", "sRGB", True),
        orm=pipeline.save_png(orm, os.path.join(OUT_TEX, pre + "_orm.png"), pre + "_orm", "Non-Color"),
        normal=pipeline.save_png(nrm, os.path.join(OUT_TEX, pre + "_normal.png"), pre + "_normal", "Non-Color"))
    stale = os.path.join(OUT_TEX, pre + "_emissive.png")
    if kind == "dawn":
        # C2 r3: Dawn's painted highlight stripe + honed edge glow faintly warm gold (the sun blade; Dusk stays unlit)
        emi = pipeline.dilate(np.clip(prm[..., 2:3], 0, 1) * DAWN_GLOW, cov, 12)
        tex["emissive"] = pipeline.save_png(emi, stale, pre + "_emissive", "sRGB", True)
        mat = pipeline.final_material("M_" + name, tex["albedo"], tex["normal"], tex["orm"], tex["emissive"], DAWN_GLOW_STRENGTH)
    else:
        if os.path.exists(stale):                                  # C2: no emissive on Dusk
            os.remove(stale)
        mat = pipeline.final_material("M_" + name, tex["albedo"], tex["normal"], tex["orm"])
    for o in los:
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
    for o in his:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    ob = meshutil.join(los, name)
    report["tris"] = meshutil.tri_count(ob)
    tip_z = BLADE_Z0 + BLADE_LEN
    empties = []
    for nm, loc in (("grip_main", (0.0, 0.0, 0.0)), ("blade_tip", (float(curve_x(tip_z)), 0.0, tip_z))):
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = loc
        e.parent = ob
        empties.append(e)
    report["nodes"] = {e.name: list(e.location) for e in empties}
    P = meshutil.get_verts(ob)
    report["bounds"] = {"min": P.min(axis=0).tolist(), "max": P.max(axis=0).tolist()}
    report["blade_width_cm"] = {str(s): round(width_fn(s) * 100, 1) for s in (0.0, 0.35, 0.7, 0.85)}
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, name + ".glb")
    pipeline.export_glb(out, [ob] + empties, scene_name=name)
    report["glb"] = out
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", name + "_report.json"), report)
    pipeline.log(f"DONE {name} in {report['seconds']:.0f}s ({report['tris']} tris)")


def build(args):
    only = getattr(args, "only", None)
    for kind in ("dawn", "dusk"):
        if only and only != kind:
            continue
        build_one(kind, args)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--only", default=None)
    build(ap.parse_args(argv))
