"""The Copper Ax - Gorrim Knotbeard's double-bit greataxe (original design), Wave C2 r1: ICONIC rebuild.

The game's title relic. Reference docs/refs/c2/heroes/hero_weapons.png (rightmost): a massive double-bit head of
polished warm copper with GLOWING TEAL rune knotwork on the cheeks, a bright forged edge band, a brass top spike,
brass knotwork bands down a thick dark haft, a faceted brass butt.

C2 proportions (light bright flats + dark bevels, ~2x thickness so the head reads as a slab at game distance):
bits 3.6 cm thick at the eye wedging to 6 mm behind a 3 cm bright hammered-steel edge band; taller crescent horns;
each cheek carries an engraved interlaced ring-knot plus a rune column, both verdigris-teal and SUBTLY emissive
(the only glowing hero weapon); the beard curves / rims are painted darker copper than the bright cheeks; brass
bands are wider and doubled; top spike and butt are faceted brass.

Weapon frame (docs/ART_PIPELINE.md 4.2, UNCHANGED): grip point (main / right hand) at the origin, haft along +Z
(Blender) = +Y (glTF). The bits point along Blender +-Y = glTF -+Z (the engine's `edge` goal = weapon-local +Z,
see src/anim/ik.js weaponQuatFromChar), the flats face +-X. Haft runs y -0.49 .. 0.64 (glTF), head centre y 0.56
(matches src/anim/profiles.js gorrim: off hand -0.34, blade R 0.72, pommel 0.46).
Nodes: grip_main (origin), grip_offhand (0,-0.34,0), head_tip (top spike), bit_edge (+Z bit edge centre).
C2 r2 (board r1 "not copper"): copper-orange is the dominant hue of each bit face — saturated copper, patina only in
the cavities, cheek metalness 0.92 -> 0.55 / roughness 0.42 (the mirror cheeks reflected the purple dusk sky and read
pale blue at the game camera), teal paint narrower, steel edge band 3 cm -> ~1.6 cm and warm-neutral.
C2 r4 (board r3 5.83: "in play too small for detail to matter; copper faces read flat salmon"): the HEAD is scaled up
(bit reach 0.285 -> 0.36 m = 72 cm across, beard span 1.2x; haft / grip / offhand / head_tip unchanged, hit volumes are
move-def boxes), bit_edge re-measured, and the copper gets real value range: darker burnished copper toward the eye,
polished bright copper toward the honed edge, darker patina in the cavities, hot ridge highlights.
C2 r5 (board r4 6.42: "copper only when the flat faces the key; turned / in shadow it goes grey-blue or a dark brown
slab"): the angle problem is fixed in the ENGINE (render/characterLook.js hue-locked metal, opted in by
anim/retarget.js for the hero weapons: the lit colour of metal texels keeps the albedo's chroma at every angle, with a
dark-copper shadow floor), so the bake can go back to HIGH metalness / low-mid roughness on the cheeks (real specular
response), the steel edge band is wider (~2.6 cm), brighter and glossier (the "bright pinkish-orange bit edge"), and
the haft wrap / wood are lifted two values so the haft separates from the ground (Muse: "haft lost").
C2 r6 (board r5 6.92: "uniform pale salmon head with a near-white edge band and pale teal runes: painted ceramic, no dark
body tones, no highlight in any of 12 frames"): VALUE RANGE. Darker, more saturated mid-copper body (the painted specular
band and most of the bright-copper lift are gone: real highlights come from the lights now), DARK OXIDISED RECESSES: an
'oxide' paint halo around every rune / knot groove + a stronger cavity darkening in the bake post, lower roughness on the
cheeks (0.20-0.30) so the key / braziers print a hot streak that travels as the head turns, the edge band narrowed from
2.6 cm to ~1.3 cm and made a glossy polished pale-copper bevel (not a wide warm-white border), the rune teal deeper and its
glow lower so it no longer washes the head pale. Engine side: anim/retarget.js gives this material a lower hue-lock floor,
a contrast term and a reduced sky reflection (characterLook.js kMetalTint.w / kMetalEnv).
Run: blender -b --factory-startup -P blender/build_weapon_copper_ax.py -- [--fast]
Outputs public/assets/models/weapon_copperax.glb (engine asset id 'weapon_copperax', src/assets/manifest.js) and
public/assets/textures/gorrim_copperax_*.png (albedo, orm, normal, emissive).
NOTE src/levels/stages/stage5/hall.js re-instances this GLB as the altar relic and overrides material.emissive to
orange x0.55: with the new emissive map that tints the teal runes (told Stages in docs/notes/_coord-C2.md).
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
ASSET = "weapon_copperax"

HEAD_Z = 0.56
HAFT_BOT, HAFT_TOP = -0.43, 0.64
GRIP_L_Z = -0.34
HAFT_R = 0.023
BIT_REACH = 0.36           # bit edge centre |y| (C2 r4: 0.285 -> 0.36; bit_edge node follows, trails measure the node)
HY, HZ = BIT_REACH / 0.285, 1.2    # C2 r4 head scale: across the bits (y) and along the haft (z: beard span)
T_EYE, T_EDGE = 0.036, 0.006
SLOPE = (T_EYE - T_EDGE) / (BIT_REACH - 0.04)
MATS = ["copper", "steel", "wood", "leather_dark", "brass"]


def t_face(a):
    """Half thickness of a bit at distance a (=|y|) from the haft axis: wedge 36 mm at the eye -> 6 mm at the edge."""
    return T_EYE - SLOPE * (a - 0.04)


def _frame(x, y, z):
    return np.stack([V(*x), V(*y), V(*z)], axis=1)


def bit_prim(sy):
    """One flared crescent bit (sy=+1 -> +Y, -1 -> -Y): a wedge-faced ellipsoid with concave beard curves."""
    c = V(0, sy * 0.06 * HY, HEAD_Z)
    body = Ellipsoid(c, V(0.07, 0.225 * HY, 0.325 * HZ))
    parts = [body, HalfSpace(V(0, sy * 0.012, 0), V(0, -sy, 0))]
    for sx in (1, -1):
        parts.append(HalfSpace(V(sx * T_EYE, sy * 0.04, HEAD_Z), norm(V(sx, sy * SLOPE, 0))))
    reg = Inter(*parts, k=0.003)
    # concave top / bottom 'beard' curves -> long horns (cylinders along X centred behind the haft)
    for sz in (1, -1):
        cyl = Capsule(V(-0.2, -sy * 0.07 * HY, HEAD_Z + sz * 0.415 * HZ), V(0.2, -sy * 0.07 * HY, HEAD_Z + sz * 0.415 * HZ), 0.372 * HZ)
        reg = Diff(reg, cyl, k=0.004)
    return reg, c


def face_frame(sx, sy):
    """Frame whose local Z is the cheek normal (so engraved rings lie flat on the sloped wedge face)."""
    n = norm(V(sx, sy * SLOPE, 0))
    y = V(0, 0, 1)
    x = norm(np.cross(y, n))
    return np.stack([x, y, n], axis=1), n


def head_sculpt():
    S = Sculpt(materials=MATS, default_mat="copper")
    lo_all, hi_all = V(-0.09, -0.34 * HY, HEAD_Z - 0.38 * HZ), V(0.09, 0.34 * HY, HEAD_Z + 0.38 * HZ)
    for sy in (1, -1):
        reg, c = bit_prim(sy)
        S.add(Bounded(reg, lo_all, hi_all), 0.004, mat="copper")
        # bright hammered steel edge band (forge-welded onto the copper), ~3 cm wide
        inner = Ellipsoid(c + V(0, -sy * 0.004, 0), V(0.09, 0.225 * HY - 0.013, 0.325 * HZ - 0.014))   # C2 r6: ~1.3 cm polished bevel (r5: 2.6 cm border)
        band = Diff(Offset(reg, 0.0005), inner, k=0.002)
        S.add(Bounded(band, lo_all, hi_all), 0.0006, mat="steel")
        for sx in (1, -1):
            M, n = face_frame(sx, sy)
            # ---- triquetra knot on the cheek: three interlocking rings on a triangle inside a bounding ring
            # (the classic Celtic trinity knot), engraved + rune-painted (paint only ~1 mm wider than the groove)
            kc = V(sx * (t_face(0.165 * HY) + 0.0004), sy * 0.165 * HY, HEAD_Z)
            for i in range(3):
                a = i * 2 * math.pi / 3 + math.pi / 2
                ey = M[:, 0] * sx                      # in-face axis along +-Y (follows the wedge slope)
                cc = kc + ey * (sy * math.cos(a) * 0.023) + V(0, 0, math.sin(a) * 0.023)     # C2 r4: knot 1.2x with the head
                S.sub(Torus(cc - n * 0.0004, 0.038, 0.0034, M), 0.0008)
                S.paint(Torus(cc, 0.038, 0.0042, M), "rune", soft=0.001)
                S.paint(Torus(cc, 0.038, 0.0095, M), "oxide", soft=0.005)     # C2 r6: dark oxidised halo round the groove
            S.sub(Torus(kc - n * 0.0004, 0.066, 0.0034, M), 0.0008)
            S.paint(Torus(kc, 0.066, 0.0042, M), "rune", soft=0.001)
            S.paint(Torus(kc, 0.066, 0.0095, M), "oxide", soft=0.005)
            # two short knot tails from the ring toward the beard tips
            for sz in (1, -1):
                pa = V(sx * (t_face(0.165 * HY) + 0.0004), sy * 0.165 * HY, HEAD_Z + sz * 0.070)
                pb = V(sx * (t_face(0.215 * HY) + 0.0004), sy * 0.215 * HY, HEAD_Z + sz * 0.162)
                S.sub(Capsule(pa, pb, 0.0030), 0.0007)
                S.paint(Capsule(pa, pb, 0.0042), "rune", soft=0.001)
                S.paint(Capsule(pa, pb, 0.0090), "oxide", soft=0.005)
            # ---- rune column near the edge band (angular glyphs), engraved + rune
            segs = weapon.rune_strokes(seed=21 if sy > 0 else 34, n=4, s0=0.1, s1=0.64, cell_u=0.2)
            for (s_a, u_a), (s_b, u_b) in segs:
                pa = []
                for (s_, u_) in ((s_a, u_a), (s_b, u_b)):
                    yy = sy * (0.245 * HY + u_ * 0.019)
                    zz = HEAD_Z + (s_ - 0.37) / 0.27 * 0.12
                    pa.append(V(sx * (t_face(abs(yy)) + 0.0004), yy, zz))
                S.sub(Capsule(pa[0], pa[1], 0.0030), 0.0007)
                S.paint(Capsule(pa[0], pa[1], 0.0042), "rune", soft=0.001)
                S.paint(Capsule(pa[0], pa[1], 0.0085), "oxide", soft=0.005)
            # ---- triquetra knot boss near the eye (raised brass rings on a copper dome)
            bc = V(sx * (t_face(0.078 * HY) - 0.001), sy * 0.078 * HY, HEAD_Z)
            Mb = _frame((0, 1, 0), (0, 0, 1), (sx, 0, 0))
            S.add(Ellipsoid(bc, V(0.032, 0.032, 0.0065), Mb), 0.004, mat="copper")
            for i in range(3):
                a = i * 2 * math.pi / 3 + math.pi / 2
                cc = bc + V(0, math.cos(a), math.sin(a)) * 0.0115 + V(sx * 0.005, 0, 0)
                S.add(Torus(cc, 0.0105, 0.0026, Mb), 0.0012, mat="brass")
            S.add(Sphere(bc + V(sx * 0.006, 0, 0), 0.006), 0.002, mat="brass")
    # eye socket block (copper) with brass collars top + bottom
    S.add(RoundBox(V(0, 0, HEAD_Z), V(0.040, 0.050, 0.110), r=0.014), 0.008, mat="copper")   # C2 r4: taller eye block
    for dz in (0.115, -0.115):
        S.add(Torus(V(0, 0, HEAD_Z + dz), 0.034, 0.0085, None, squash=1.0), 0.003, mat="brass")
        S.add(Torus(V(0, 0, HEAD_Z + dz), 0.040, 0.0045, None, squash=1.0), 0.002, mat="brass")
    # top spike: faceted brass pyramid on a collar
    S.add(RoundBox(V(0, 0, HEAD_Z + 0.125), V(0.028, 0.028, 0.018), M=rot(0, 0, 45), r=0.003), 0.004, mat="brass")
    S.add(RoundCone(V(0, 0, HEAD_Z + 0.135), V(0, 0, HEAD_Z + 0.235), 0.026, 0.003, squash=(1.0, 1.0)), 0.004, mat="brass")
    # brass langets riveted down the haft (both flats)
    for sx in (1, -1):
        S.add(RoundBox(V(sx * (HAFT_R + 0.001), 0, HEAD_Z - 0.185), V(0.0035, 0.013, 0.095), r=0.0025), 0.002,
              mat="brass")
        for z in (HEAD_Z - 0.125, HEAD_Z - 0.245):
            S.add(Sphere(V(sx * (HAFT_R + 0.005), 0, z), 0.0052), 0.001, mat="brass")
    return S


def haft_sculpt(S):
    # dark oak haft, slight swell toward the head
    S.add(RoundCone(V(0, 0, HAFT_BOT + 0.01), V(0, 0, HAFT_TOP), HAFT_R * 0.98, HAFT_R * 1.06), 0.0, mat="wood")
    # leather two-hand wrap: spiral over both grip zones
    z0, z1 = -0.40, 0.075
    n = 260
    pts = []
    for i in range(n + 1):
        t = i / n
        z = z0 + (z1 - z0) * t
        a = t * 2 * math.pi * 17
        pts.append(V(math.cos(a) * HAFT_R, math.sin(a) * HAFT_R, z))
    S.add(Capsule(V(0, 0, z0), V(0, 0, z1), HAFT_R + 0.0014), 0.001, mat="leather_dark")
    S.add(Chain(pts, 0.0042, margin=0.02), 0.002, mat="leather_dark")
    # brass knotwork bands (double rings with a raised zig-zag braid between): above the wrap, between the hands,
    # below the wrap, under the head
    for z in (z1 + 0.016, -0.17, z0 - 0.016, HEAD_Z - 0.30):
        for dz in (0.011, -0.011):
            S.add(Torus(V(0, 0, z + dz), HAFT_R + 0.002, 0.0048), 0.0015, mat="brass")
        pts = []
        for i in range(25):
            a = i / 24 * 2 * math.pi
            pts.append(V(math.cos(a) * (HAFT_R + 0.004), math.sin(a) * (HAFT_R + 0.004), z + (0.006 if i % 2 else -0.006)))
        S.add(Chain(pts, 0.0028, margin=0.02), 0.0012, mat="brass")
    # butt: faceted brass block (diamond in silhouette) with a ring and a stud
    bz = HAFT_BOT - 0.014
    S.add(Torus(V(0, 0, HAFT_BOT + 0.014), 0.027, 0.005), 0.002, mat="brass")
    S.add(RoundBox(V(0, 0, bz), V(0.026, 0.026, 0.024), M=rot(0, 0, 45), r=0.004), 0.005, mat="brass")
    S.add(RoundBox(V(0, 0, bz), V(0.021, 0.021, 0.030), M=rot(0, 0, 45), r=0.003), 0.003, mat="brass")
    S.add(RoundCone(V(0, 0, bz - 0.024), V(0, 0, bz - 0.044), 0.018, 0.006), 0.004, mat="brass")


# ---------------------------------------------------------------------------- painters
def p_copper(c, pal):
    """Polished forged copper: bright warm orange-copper on the cheeks (the flats), darker burnished copper on the
    beard curves and rims (surfaces not facing +-X), hammer mottle, verdigris only in the cavities; the engraved
    knotwork is teal and SUBTLY emissive. C2 r5: HIGH metalness / low-mid roughness again (the engine's hue-locked
    metal keeps the chroma at every angle, see the module docstring), a hotter painted specular band."""
    base = pal["copper"]
    n1 = c.noise(16.0, 3, 91)
    n2 = c.noise(70.0, 2, 92)
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.10 * n1 + 0.05 * n2)[:, None]
    # C2 r4 (board r3: "salmon faces flatter than polished copper"): a VALUE GRADIENT across each cheek -- darker burnished
    # copper near the eye (where the hands and the haft are), polished bright copper toward the honed edge band -- plus a
    # painted specular band at 2/3 of the reach, so the head reads as curved, polished metal instead of a flat orange card.
    ay = np.abs(c.P[:, 1])
    grad = shaders.smooth01(ay, 0.06, BIT_REACH * 0.9)
    rgb = shaders.mix(rgb, pal["copper_deep"], 0.70 * (1.0 - grad))
    rgb = shaders.mix(rgb, pal["copper_hi"], 0.22 * grad)
    # C2 r6: the r4/r5 PAINTED specular band (a fixed pale stripe at 2/3 reach) read as a uniform salmon wash in every frame
    # -> a faint trace only; the real streak comes from the lights on a glossier cheek (rough 0.20-0.30 below)
    spec = np.exp(-((ay - BIT_REACH * 0.66) / (BIT_REACH * 0.11)) ** 2)
    rgb = shaders.mix(rgb, pal["copper_spec"], 0.12 * spec)
    rune = np.clip(c.paint("rune") * 1.4, 0, 1)
    # C2 r6: DARK OXIDISED RECESSES -- an 'oxide' halo painted round every rune / knot groove (head_sculpt) plus the
    # cavity term: dark brown-red tarnish, rougher, slightly less metallic, so the knotwork reads as a dark pattern in
    # a polished field (ref hero_weapon_materials.png: darker recesses, strong value range) instead of pale lines
    oxide = np.clip(c.paint("oxide") * 1.2, 0, 1) * (1.0 - rune)
    oxide = np.clip(oxide + 0.6 * shaders.smooth01(c.cav, 0.1, 0.45), 0, 1) * (1.0 - rune)
    # light flats / dark bevels: the cheek faces +-X; beard curves, the eye block sides and rims face elsewhere
    nx = np.abs(c.N[:, 0])
    side = 1.0 - shaders.smooth01(nx, 0.55, 0.85)
    rgb = shaders.mix(rgb, pal["copper_dark"], 0.7 * side)
    # C2 r2 (board r1: "both bits read pale cyan/steel-blue at the game camera"): patina ONLY in the cavities (no
    # noise blotches), low amount; the cheeks stay saturated copper-orange
    pat = np.clip(0.9 * shaders.smooth01(c.cav, 0.12, 0.5) + 0.08 * shaders.smooth01(n1, 0.6, 0.9), 0, 1)
    pat *= pal.get("copper_patina_amt", 0.4)
    rgb = shaders.mix(rgb, pal["copper_patina"], pat)
    rgb = shaders.mix(rgb, pal["copper_oxide"], 0.8 * oxide)
    rgb = shaders.mix(rgb, pal["rune"], rune)
    rgb = shaders.mix(rgb, pal["copper_spec"], 0.6 * c.ridge * (1 - pat) * (1 - rune) * (1 - side) * (1 - oxide))
    # C2 r5: metal 0.78-0.9 on the cheeks (r2-r4 kept it at 0.5-0.7 because the mirror cheeks reflected the purple dusk
    # sky; the engine's hue lock now keeps those reflections copper), rough 0.30-0.42 so the key prints a real highlight
    # C2 r6: glossier cheeks (0.20-0.30; r5 0.30-0.42 blurred the key into a wash), tarnish rougher
    metal = (0.80 + 0.12 * grad) * (1 - 0.9 * pat) * (1 - 0.95 * rune) * (1 - 0.15 * oxide)
    rough = 0.30 - 0.10 * grad + 0.05 * n1 - 0.08 * c.ridge + 0.4 * pat + 0.12 * side + 0.3 * rune + 0.28 * oxide
    emit = rune
    return shaders.out(c.n, rgb, np.clip(rough, 0.14, 0.9), np.clip(metal, 0, 1), emit)


def p_steel(c, pal):
    # C2 r5: the forge-welded edge band is the "bright pinkish-orange bit edge" -- near-white warm albedo, glossy, metallic
    # C2 r6: a NARROW polished pale-copper bevel (metal 0.92, rough ~0.14): it mirrors the lights as a sharp hot line
    # instead of printing a wide warm-white border at every angle
    n1 = c.noise(40.0, 2, 93)
    rgb = np.tile(pal["steel"], (c.n, 1)) * (1.0 + 0.04 * n1)[:, None]
    rgb = shaders.mix(rgb, shaders.srgb(255, 236, 222), 0.5 * c.ridge)
    rgb = shaders.mix(rgb, rgb * 0.55, 0.6 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.14 + 0.05 * n1, 0.10, 0.4), 0.92)


def p_wood(c, pal):
    P = c.P
    grain = 0.5 + 0.5 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 7.0 + c.noise(3.0, 2, 94) * 9.0 + P[:, 2] * 3.0)
    n1 = c.noise(30.0, 3, 95)
    rgb = np.tile(pal["wood"], (c.n, 1)) * (0.8 + 0.25 * grain + 0.1 * n1)[:, None]
    rgb = shaders.mix(rgb, rgb * 0.5, 0.6 * c.cav)
    return shaders.out(c.n, rgb, np.clip(0.62 + 0.1 * n1, 0.3, 0.9), 0.0)


def p_brass(c, pal):
    rgb, rough, metal, emit = shaders.p_metal(c, pal, "brass")
    return rgb, np.clip(rough, 0.22, 0.9), metal, np.zeros(c.n)


PAINTERS = {"copper": p_copper, "steel": p_steel, "wood": p_wood, "brass": p_brass}
KINDS = {"copper": "bronze", "steel": "iron", "wood": "leather", "brass": "bronze"}
PAL = dict(copper=shaders.srgb(182, 74, 26), copper_hi=shaders.srgb(238, 132, 60), copper_spec=shaders.srgb(255, 206, 172),   # C2 r6: darker, more saturated mid copper
           copper_deep=shaders.srgb(98, 34, 14), copper_dark=shaders.srgb(80, 28, 14),           # C2 r4: value range (r6 a step darker)
           copper_oxide=shaders.srgb(54, 20, 11),                                                 # C2 r6: dark oxidised recesses
           copper_patina=shaders.srgb(40, 110, 92), copper_patina_amt=0.34, rune=shaders.srgb(22, 132, 112),   # C2 r6: deeper teal
           steel=shaders.srgb(246, 214, 192), wood=shaders.srgb(104, 66, 40),                     # C2 r6: polished pale-copper bevel; lighter haft
           brass=shaders.srgb(236, 190, 98), brass_patina=shaders.srgb(96, 130, 108), brass_patina_amt=0.22,
           leather_dark=shaders.srgb(112, 74, 50), leather_dark_worn=shaders.srgb(176, 128, 90))   # C2 r5: lifted wrap (Muse: haft lost against the ground)
GLOW = np.array([0.10, 0.52, 0.42])    # teal rune glow (emissive map); C2 r6: lower (the pale teal washed the head high-key)


def build(args):
    T0 = time.time()
    fast = getattr(args, "fast", False)
    res = 512 if fast else 1024
    meshutil.clear_scene()
    device = pipeline.setup_cycles(getattr(args, "device", "AUTO"))
    report = {"asset": ASSET, "device": device, "res": res}
    S = head_sculpt()
    haft_sculpt(S)
    lo_b, hi_b = V(-0.075, -0.335 * HY, HAFT_BOT - 0.075), V(0.075, 0.335 * HY, HEAD_Z + 0.42)   # C2 r4: bigger head
    hi = pipeline.sculpt_mesh(S, "ax_hi", 0.0011 if fast else 0.0006, lo_b, hi_b)
    lo = pipeline.lowpoly(S, "ax_lo", 0.0022, getattr(args, "weapon_tris", 2900), lo_b, hi_b)
    report["tris_lo"] = meshutil.tri_count(lo)
    allf = np.ones(len(lo.data.polygons), bool)
    pipeline.smart_project_faces(lo, allf, angle=60.0)
    pipeline.normalize_density(lo, allf, 1.0)
    report["uv_fill"] = pipeline.pack_atlas([lo], margin=0.006)
    shaders.assign_bake_materials(hi, S.materials, prefix="ax_", kinds=KINDS)
    shaders.paint_mesh(hi, S.materials, {}, PAL, {}, painters=PAINTERS)
    B = pipeline.Baker(res, [(lo, [hi], 0.005, 0.016)], shaders.set_pass, [lo], [hi])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 32 if fast else 64),
                         ("normal", "NORMAL", 8)])
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao_s, ao_l = np.clip(maps["ao"][..., 0], 0, 1), np.clip(maps["ao"][..., 1], 0, 1)
    occl = np.clip(1.0 - 0.7 * (1 - ao_s) - 0.35 * (1 - ao_l), 0, 1)[..., None]
    tint = np.array([0.30, 0.20, 0.16])   # C2 r6: deeper cavity darkening (r5 0.5/0.36/0.3) -- dark recesses round the knotwork
    rgb = alb[..., :3] * (tint + (1 - tint) * occl)
    prm = maps["prm"]
    orm = np.stack([np.clip(0.4 + 0.6 * ao_l * ao_s, 0, 1), np.clip(prm[..., 0], 0.05, 1), np.clip(prm[..., 1], 0, 1)], -1)
    emi = np.clip(prm[..., 2:3], 0, 1) * GLOW
    rgb, orm, nrm, emi = (pipeline.dilate(x, cov, 12) for x in (rgb, orm, maps["normal"][..., :3], emi))
    tex = dict(
        albedo=pipeline.save_png(rgb, os.path.join(OUT_TEX, "gorrim_copperax_albedo.png"), "cax_albedo", "sRGB", True),
        orm=pipeline.save_png(orm, os.path.join(OUT_TEX, "gorrim_copperax_orm.png"), "cax_orm", "Non-Color"),
        normal=pipeline.save_png(nrm, os.path.join(OUT_TEX, "gorrim_copperax_normal.png"), "cax_normal", "Non-Color"),
        emissive=pipeline.save_png(emi, os.path.join(OUT_TEX, "gorrim_copperax_emissive.png"), "cax_emissive", "sRGB", True))
    mat = pipeline.final_material("M_" + ASSET, tex["albedo"], tex["normal"], tex["orm"], tex["emissive"], 0.5)
    lo.data.materials.clear()
    lo.data.materials.append(mat)
    pipeline.strip_for_export(lo)
    bpy.data.objects.remove(hi, do_unlink=True)
    bpy.context.view_layer.update()
    ob = meshutil.join([lo], ASSET)
    report["tris"] = meshutil.tri_count(ob)
    # attachment empties (children of the mesh node, identity rotation = weapon frame); Blender (x, y, z) ->
    # glTF (x, z, -y): bit_edge at Blender -Y = glTF +Z (the engine's edge direction)
    empties = []
    for name, loc in (("grip_main", (0.0, 0.0, 0.0)), ("grip_offhand", (0.0, 0.0, GRIP_L_Z)),
                      ("head_tip", (0.0, 0.0, HEAD_Z + 0.235)), ("bit_edge", (0.0, -BIT_REACH, HEAD_Z))):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = loc
        e.parent = ob
        empties.append(e)
    report["nodes"] = {e.name: list(e.location) for e in empties}
    P = meshutil.get_verts(ob)
    report["bounds"] = {"min": P.min(axis=0).tolist(), "max": P.max(axis=0).tolist()}
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, ASSET + ".glb")
    pipeline.export_glb(out, [ob] + empties, scene_name=ASSET)
    report["glb"] = out
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "copperax_report.json"), report)
    pipeline.log(f"DONE {ASSET} in {report['seconds']:.0f}s ({report['tris']} tris)")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--weapon-tris", type=int, default=2900)
    build(ap.parse_args(argv))
