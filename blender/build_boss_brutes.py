"""Boss art: THE BRUTE BROTHERS (stage 1 boss, Golden Axe 'Bad Brothers') -- two dedicated giants, GOR and MOG.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_boss_brutes.py -- [options]
Options:
  --preview 1          workbench clay render of both brothers -> progress/shots/bosses/dev/brutes_clay.png (no export)
  --q fast|med|rel     hi-poly density / atlas (default med: 2048 atlas, mid-density hi meshes)
  --only gor,mog       export only these brothers
Outputs public/assets/models/boss_brute_<gor|mog>.glb + public/assets/textures/boss_brute_<id>_*.png,
report blender/out/boss/brutes_report.json.

The body kit is the regular Ogre Brute sculpt (blender/build_enemy_ogre.py, IMPORTED, never edited): hunched hill
giant, tusked underbite, fur collar, hide belly-wrap, war skirt, wrapped boots. What makes them BOSSES (critic r1:
"pastel clay, tier tint floods the skin, nothing boss-specific"):
  * bigger: exported x1.60 (GOR, 3.1 m) and x1.55 (MOG, 3.0 m) vs the regular brutes' 2.75 m;
  * real, DARK, textured hides (albedo luma 25-35 %, not 45 %+): mottled, warty, scarred (pale scar tissue), grime;
  * the brother colour lives ONLY in accents: GOR jade-green war-paint stripes + eye band, MOG blood-red soot mask,
    chest bar and hand-print; no tint on skin / armour;
  * unique silhouettes + armour:
      GOR "the Anvil" -- grey-olive hide, HORNED iron great-helm (big sweeping bone horns, nasal, riveted band),
          TWO hide-and-iron pauldrons, a riveted iron PECTORAL PLATE with a rim, a boss and 18 rivets;
      MOG "the Butcher" -- umber hide, CRESTED iron half-helm (row of iron spikes, cheek guards, rivets),
          one huge RIGHT pauldron wearing a trophy SKULL, a heavy iron CHAIN wound round the left forearm.
  * dark forged iron (low rust) and old ivory (not bone-white) so metal reads under the stage-1 dusk grade.
Hammers: blender/build_boss_weapons.py --only hammer_gor,hammer_mog.
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

from lib import sdf, rig, anatomy, meshutil, preview, gear, pipeline, shaders, skin, charkit
import build_enemy_ogre as BO
importlib.reload(BO)
BM = BO.BM
from lib.sdf import (V, norm, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Displace)
from lib.charkit import trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "bosses", "dev")
GEAR_MATS = BO.GEAR_MATS

BROS = {
    "gor": dict(K=1.60, gear=["helm_horned", "pauldron_L", "pauldron_R", "chestplate"]),
    "mog": dict(K=1.55, gear=["helm_crest", "pauldron_L", "trophy_R", "chain_L"]),
}
GEAR_BONE = {"helm_horned": "head", "helm_crest": "head", "pauldron_L": "upperarm_L", "pauldron_R": "upperarm_R",
             "trophy_R": "upperarm_R", "chestplate": "chest", "chain_L": "forearm_L"}
GEAR_TRIS = {"helm_horned": 1500, "helm_crest": 1500, "pauldron_L": 900, "pauldron_R": 900, "trophy_R": 1500,
             "chestplate": 1000, "chain_L": 1100}
GEAR_SYM = {"helm_horned", "helm_crest", "chestplate"}


# ============================================================================ extra paint (scars, eye band)
def boss_paint(S, L, H):
    """Channels on the shared body: 'scar' (both: pale scar tissue) + 'band' (GOR: eye band) + 'scarG'/'scarM'
    (which brother shows which scars; the painter picks)."""
    s = H.s
    # GOR: diagonal cut over the left eye + three claw rakes on the right upper arm front
    S.paint(Inter(Slab(H(0.035, -0.1, 0.0), norm(V(1, 0, 0.9)), 0.0045 * s),
                  Ellipsoid(H(0.035, -0.1, 0.0), H.r(0.05, 0.05, 0.07))), "scarG", soft=0.003)
    sh, el = L["shoulder_R"], L["elbow_R"]
    a = norm(el - sh)
    for i in range(3):
        c = sh + (el - sh) * (0.42 + i * 0.1) + V(0, -0.07, 0)
        S.paint(Inter(Slab(c, norm(a + V(0.6, 0, 0)), 0.006), Sphere(c, 0.07)), "scarG", soft=0.004)
    # GOR: eye band (jade war paint across the eyes, temple to temple)
    S.paint(Inter(Ellipsoid(H(0, -0.06, 0.005), H.r(0.13, 0.12, 0.028)), HalfSpace(H(0, -0.02, 0), V(0, 1, 0))),
            "band", soft=0.006)
    # MOG: stitched cut across the nose + cheek, three claw scars over the right pec, a slash on the left shoulder
    S.paint(Inter(Slab(H(0, -0.12, -0.03), norm(V(1, 0, -0.55)), 0.004 * s),
                  Ellipsoid(H(0, -0.1, -0.03), H.r(0.09, 0.06, 0.05))), "scarM", soft=0.003)
    for i in range(3):
        c = V(-0.09 - i * 0.035, -0.22, 1.47 - i * 0.02)
        S.paint(Inter(Slab(c, norm(V(1, 0, 1.4)), 0.005), Sphere(c, 0.09)), "scarM", soft=0.004)
    c = L["shoulder_L"] + V(0.02, -0.1, -0.02)
    S.paint(Inter(Slab(c, norm(V(0.3, 0, 1)), 0.006), Sphere(c, 0.1)), "scarM", soft=0.004)


# ============================================================================ gear
def helm_horned(snapH, H):
    """GOR: deep iron great-helm dome (down to the brow), riveted band, raised crest ridge, nasal, and two huge
    bone horns that sweep out, up and forward (the silhouette you recognise from across the screen)."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    lo, hi = H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4
    cut = HalfSpace(H(0, 0, 0.02), norm(V(0, 0.3, -1)))
    dome = Inter(BM.shell(snapH, 0.018, 0.004), cut, k=0.004)
    S.add(Bounded(Displace(dome, 0.0012, 30.0, 2, seed=195), lo, hi), 0.0, mat="iron")
    S.add(Bounded(Inter(BM.shell(snapH, 0.024, 0.008), Slab(H(0, 0, 0.034), norm(V(0, 0.3, -1)), 0.013 * s), k=0.002),
                  lo, hi), 0.002, mat="iron")                                        # brow band
    S.add(Bounded(Inter(BM.shell(snapH, 0.026, 0.01), Slab(H(0, 0, 0), V(1, 0, 0), 0.008 * s), cut, k=0.003), lo, hi),
          0.004, mat="iron")                                                          # crest ridge
    for i in range(18):
        a = (i + 0.5) / 18 * 2 * math.pi
        p = trace_in(S, H(0, 0.0, 0.034), norm(V(math.sin(a), -math.cos(a), 0.3 * math.cos(a) * 0 + 0.1)), r=0.35)
        S.add(Sphere(p, 0.0065 * s), 0.001, mat="iron")
    nas = trace_in(S, H(0, 0, 0.02), V(0, -1, 0), r=0.35)
    S.add(RoundBox(nas + V(0, 0.002, -0.028 * s), V(0.011, 0.007, 0.04) * s, r=0.005), 0.004, mat="iron")
    for sx in (1, -1):
        b0 = trace_in(S, H(0, 0, 0.05), norm(V(sx * 0.95, -0.05, 0.3)), r=0.35)
        BM.horn(S, b0, [(sx * 0.07, -0.0, 0.02), (sx * 0.14, -0.015, 0.07), (sx * 0.18, -0.05, 0.14),
                        (sx * 0.18, -0.1, 0.2), (sx * 0.15, -0.14, 0.235)], 0.036, s=s, mat="bone", collar="iron")
    return S


def helm_crest(snapH, H):
    """MOG: low iron half-helm with cheek guards and a crest of seven iron spikes, front to back."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    s = H.s
    lo, hi = H(0, 0, 0) - 0.4, H(0, 0, 0) + 0.4
    cut = HalfSpace(H(0, 0, 0.035), norm(V(0, 0.45, -1)))
    S.add(Bounded(Displace(Inter(BM.shell(snapH, 0.016, 0.004), cut, k=0.004), 0.0014, 26.0, 2, seed=295), lo, hi),
          0.0, mat="iron")
    S.add(Bounded(Inter(BM.shell(snapH, 0.022, 0.007), Slab(H(0, 0, 0.045), norm(V(0, 0.45, -1)), 0.011 * s), k=0.002),
                  lo, hi), 0.002, mat="iron")
    for sx in (1, -1):                                                              # cheek guards
        cg = Inter(BM.shell(snapH, 0.02, 0.006), HalfSpace(H(sx * 0.07, 0, 0), V(-sx, 0, 0)),
                   Ellipsoid(H(sx * 0.1, -0.02, -0.035), H.r(0.06, 0.07, 0.075)), k=0.004)
        S.add(Bounded(cg, lo, hi), 0.004, mat="iron")
        for dz in (0.0, -0.05):
            p = trace_in(S, H(sx * 0.03, -0.02, dz - 0.01), norm(V(sx, -0.25, 0)), r=0.35)
            S.add(Sphere(p, 0.007 * s), 0.001, mat="iron")
    for i in range(16):
        a = (i + 0.5) / 16 * 2 * math.pi
        p = trace_in(S, H(0, 0.0, 0.045), norm(V(math.sin(a), -math.cos(a), 0.12)), r=0.35)
        S.add(Sphere(p, 0.006 * s), 0.001, mat="iron")
    for i in range(7):                                                              # spike crest
        t = -0.9 + i * (1.9 / 6)
        d = norm(V(0, -math.sin(t) * 0.9, math.cos(t)))
        p = trace_in(S, H(0, 0.01, 0.0), d, r=0.35)
        ln = (0.1 + 0.05 * math.cos(t * 1.2)) * s
        S.add(RoundCone(p - d * 0.005, p + norm(d + V(0, 0.25, 0)) * ln, 0.024 * s, 0.003), 0.006, mat="iron")
    return S


def skull(S, c, fwd, up, sz, mat="bone"):
    """Small crude trophy skull (cranium, brow, sockets, nasal hole, cheekbones, upper teeth; no jaw)."""
    fwd, up = norm(fwd), norm(up)
    rt = norm(np.cross(fwd, up))
    P = lambda x, y, z: c + rt * (x * sz) + fwd * (y * sz) + up * (z * sz)
    S.add(Ellipsoid(P(0, -0.1, 0.25), V(0.5, 0.5, 0.5) * sz * 1.0), 0.0, mat=mat)
    S.add(Ellipsoid(P(0, 0.3, -0.12), V(0.36, 0.3, 0.34) * sz), 0.12 * sz, mat=mat)
    S.add(Capsule(P(-0.3, 0.42, 0.05), P(0.3, 0.42, 0.05), 0.09 * sz), 0.06 * sz, mat=mat)       # brow
    for sx in (-1, 1):
        S.sub(Sphere(P(sx * 0.17, 0.52, -0.08), 0.13 * sz), 0.03 * sz)                            # sockets
        S.add(Sphere(P(sx * 0.3, 0.36, -0.24), 0.1 * sz), 0.06 * sz, mat=mat)                      # cheekbones
    S.sub(Ellipsoid(P(0, 0.6, -0.3), V(0.06, 0.08, 0.09) * sz), 0.02 * sz)                           # nasal hole
    for i in range(6):
        x = -0.15 + i * 0.06
        S.add(Capsule(P(x, 0.5, -0.46), P(x, 0.52, -0.56), 0.028 * sz), 0.01 * sz, mat=mat)


def trophy_pauldron(snapA, L):
    """MOG's right pauldron (the regular kit's hide-and-iron dome) wearing a trophy skull lashed on with a chain."""
    S = BO.pauldron(snapA, L, "R")
    sh, el = L["shoulder_R"], L["elbow_R"]
    a = norm(el - sh)
    up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
    d0 = norm(up * 0.8 + V(-0.45, -0.25, 0))
    p = trace_in(S, sh + a * 0.07, d0, r=0.45)
    c = p + d0 * 0.05
    c = p + d0 * 0.08
    skull(S, c, V(-0.25, -1, 0.25), d0, 0.14)
    # chain lashing: links from the skull down both sides of the dome
    for side in (-1, 1):
        for j in range(4):
            dj = norm(up * (0.7 - 0.2 * j) + V(-0.3, side * (0.35 + 0.18 * j), 0) + a * 0.05 * j)
            q = trace_in(S, sh + a * 0.06, dj, r=0.45)
            n = norm(np.cross(dj, a)) if j % 2 else dj
            S.add(Torus(q + dj * 0.004, 0.014, 0.0045, basis(n)[:, [1, 2, 0]]), 0.002, mat="iron")
    return S


def chestplate(snapA):
    """GOR: crude riveted iron pectoral plate hammered to the chest: rolled rim, centre boss with a stubby spike,
    18 rivets, two leather ties at the sides."""
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    lo, hi = V(-0.36, -0.55, 1.2), V(0.36, 0.1, 1.7)
    front = HalfSpace(V(0, -0.02, 0), V(0, 1, 0))
    reg = RoundBox(V(0, -0.35, 1.435), V(0.2, 0.4, 0.125), r=0.06)
    plate = Inter(BM.shell(snapA, 0.036, 0.016), front, reg, k=0.004)
    S.add(Bounded(Displace(plate, 0.0016, 22.0, 2, seed=331), lo, hi), 0.0, mat="iron")
    rim = Inter(BM.shell(snapA, 0.043, 0.02), front, reg, Diff(Slab(V(0, 0, 0), V(0, 0, 1), 9.0),
                                                               RoundBox(V(0, -0.35, 1.435), V(0.178, 0.5, 0.103), r=0.045)),
                k=0.003)
    S.add(Bounded(rim, lo, hi), 0.003, mat="iron")
    cen = trace_in(S, V(0, 0.0, 1.44), V(0, -1, 0), r=0.6)
    S.add(Ellipsoid(cen, V(0.05, 0.03, 0.05)), 0.012, mat="iron")
    S.add(RoundCone(cen, cen + V(0, -0.06, 0), 0.026, 0.004), 0.008, mat="iron")
    for i in range(18):
        a = (i + 0.5) / 18 * 2 * math.pi
        o = V(0.187 * math.sin(a), 0, 1.435 + 0.112 * math.cos(a))
        o = V(np.clip(o[0], -0.188, 0.188), 0, np.clip(o[2], 1.33, 1.54))
        p = trace_in(S, V(float(o[0]) * 0.6, 0.0, float(o[2])), norm(V(float(o[0]) * 1.2, -1, 0)), r=0.6)
        S.add(Sphere(p, 0.0085), 0.0015, mat="iron")
    for sx in (1, -1):                                                              # leather side ties
        p = trace_in(S, V(sx * 0.1, 0.0, 1.44), norm(V(sx * 1.2, -1, 0)), r=0.6)
        S.add(Capsule(p + V(0, 0, -0.03), p + V(sx * 0.05, 0.03, -0.035), 0.012), 0.006, mat="leather")
    return S


def chain_forearm(S_body, L, side="L"):
    """MOG: a heavy iron chain wound three times round the forearm (over the hide wrap), end links dangling."""
    el, wr, b, Lf = BO.forearm_frame(L, side)
    u = norm(np.cross(b, V(0, 1, 0)))
    v = norm(np.cross(b, u))
    lo_, hi_ = np.minimum(el, wr) - 0.22, np.maximum(el, wr) + 0.22
    G = charkit.GridSDF(S_body, h=0.004, lo=lo_, hi=hi_)
    S = Sculpt(materials=GEAR_MATS, default_mat="iron")
    n = 46
    pts = []
    for i in range(n):
        t = 0.18 + 0.6 * i / (n - 1)
        ang = 2 * math.pi * 1.7 * i / (n - 1)
        d = u * math.cos(ang) + v * math.sin(ang)
        c = el + b * Lf * t
        r = 0.2
        for _ in range(60):                                                         # march in to 2.2 cm standoff
            q = c + d * r
            dist = float(G.d(q[0:1], q[1:2], q[2:3])[0])
            if dist < 0.022:
                break
            r -= max(0.002, dist - 0.02)
        pts.append(c + d * (r + 0.004))
    for i, p in enumerate(pts):
        tan = norm((pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]))
        rad = norm(p - (el + b * float(np.dot(p - el, b))))
        nrm = rad if i % 2 else norm(np.cross(tan, rad))
        S.add(Torus(p, 0.022, 0.0075, basis(nrm)[:, [1, 2, 0]], squash=1.0), 0.002, mat="iron")
    p = pts[-1]
    for j in range(1, 4):                                                           # dangling tail
        q = p + V(0, 0, -0.034 * j) + V(0, -0.006 * j, 0)
        nrm = V(1, 0, 0) if j % 2 else V(0, 1, 0)
        S.add(Torus(q, 0.019, 0.006, basis(nrm)[:, [1, 2, 0]]), 0.002, mat="iron")
    return S, (lo_ - 0.05, hi_ + 0.05)


def build_gear(S_body, L, H, names, h=0.004):
    t = time.time()
    snapA = charkit.GridSDF(S_body, h=h, lo=V(-0.95, -0.5, 1.2), hi=V(0.95, 0.5, 2.05))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    out = {}
    for nm in sorted(set(names)):
        if nm == "helm_horned":
            out[nm] = (helm_horned(snapA, H), BO.gear_bounds("helm", L))
        elif nm == "helm_crest":
            out[nm] = (helm_crest(snapA, H), BO.gear_bounds("helm", L))
        elif nm == "trophy_R":
            sh = L["shoulder_R"]
            out[nm] = (trophy_pauldron(snapA, L), (sh - 0.45, sh + 0.45))
        elif nm == "chestplate":
            out[nm] = (chestplate(snapA), (V(-0.36, -0.55, 1.2), V(0.36, 0.1, 1.7)))
        elif nm == "chain_L":
            out[nm] = chain_forearm(S_body, L, "L")
        else:
            out[nm] = (BO.pauldron(snapA, L, nm[-1]), BO.gear_bounds(nm, L))
    return out


# ============================================================================ palettes
S_ = shaders.srgb
PAL = dict(BO.PAL)
PAL.update(
    hide=S_(70, 50, 34), hide_worn=S_(112, 84, 58), hide_dark=S_(36, 26, 18), hide_dark_worn=S_(76, 56, 40),
    leather=S_(54, 36, 24), leather_worn=S_(100, 74, 50), leather_dark=S_(30, 22, 16), leather_dark_worn=S_(66, 50, 36),
    iron=S_(84, 84, 86), iron_patina=S_(98, 56, 32), iron_patina_amt=0.42,
    bronze=S_(84, 84, 86), bronze_patina=S_(98, 56, 32), bronze_patina_amt=0.42,
    bone=S_(186, 168, 130), bone_dark=S_(82, 62, 40), horn=S_(54, 42, 32), horn_tip=S_(176, 160, 124),
    rope=S_(112, 92, 62), cloth=S_(112, 92, 62), scar=S_(168, 128, 112), brow=S_(20, 16, 12),
)
BRO_PAL = {
    "gor": dict(skin=S_(84, 88, 66), skin_warm=S_(104, 90, 62), skin_cool=S_(58, 68, 66), lips=S_(58, 52, 44),
                mottle=S_(58, 64, 46), mottle_hi=S_(122, 122, 96), scar=S_(150, 136, 118),
                war_a=S_(40, 132, 76), war_a_amt=0.82, war_b_amt=0.0, band=S_(34, 116, 66), band_amt=0.85,
                fur=S_(64, 50, 38), fur_root=S_(24, 18, 14), fur_tip=S_(138, 118, 90), iris=S_(230, 190, 60),
                scars="scarG"),
    "mog": dict(skin=S_(116, 74, 54), skin_warm=S_(134, 76, 52), skin_cool=S_(76, 56, 54), lips=S_(66, 38, 30),
                mottle=S_(86, 50, 36), mottle_hi=S_(150, 104, 80), scar=S_(176, 132, 110),
                war_a_amt=0.0, war_b=S_(150, 22, 18), war_b_amt=0.86, band_amt=0.0,
                fur=S_(40, 34, 30), fur_root=S_(16, 13, 12), fur_tip=S_(104, 94, 84), iris=S_(240, 120, 30),
                scars="scarM"),
}


def bro_pal(b):
    p = dict(PAL)
    p.update(BRO_PAL[b])
    return p


def p_brute_skin(c, pal):
    """BO's ogre hide painter (mottle, warts, grime, war paint A/B) + this brother's scars and eye band."""
    rgb, rough, metal, emit = BO.p_ogre_skin(c, pal)
    sc = c.paint(pal["scars"])
    if sc.any():
        core = shaders.smooth01(sc, 0.35, 0.9)
        rgb = shaders.mix(rgb, rgb * 0.55, 0.6 * np.clip(sc * 2.0, 0, 1) * (1 - core))     # dark bruised edge
        rgb = shaders.mix(rgb, pal["scar"], 0.8 * core)
        rough = rough - 0.18 * core
    if pal.get("band_amt", 0) > 0:
        w = c.paint("band")
        if w.any():
            worn = shaders.smooth01(c.noise(40.0, 2, 704), -0.4, 0.4)
            rgb = shaders.mix(rgb, pal["band"], np.clip(w * (0.7 + 0.3 * worn), 0, 1) * pal["band_amt"])
    return rgb, np.clip(rough, 0.3, 0.92), metal, emit


PAINTERS = dict(BO.PAINTERS, skin=p_brute_skin)


# ============================================================================ preview
def preview_main(args):
    meshutil.clear_scene()
    BM.HORNS.clear()
    L = BO.ogre_landmarks()
    t0 = time.time()
    os.makedirs(DEV, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = BO.body_sculpt(L)
    H = info["head"]["H"]
    G = build_gear(S, L, H, [g for b in BROS.values() for g in b["gear"]])
    col = BO.MAT_COLORS
    base = [charkit.mesh_sculpt(S, "body", 0.005, colors=col),
            charkit.mesh_sculpt(BO.war_skirt(info["kilt"]), "kilt", 0.004, colors=col)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(BO.hand_sculpt(L, s), "hand_" + s, 0.0025, w - 0.28, w + 0.28, colors=col))
    for i, (b, cfg) in enumerate(BROS.items()):
        dx = V(i * 1.9, 0, 0)
        for g in cfg["gear"]:
            o = charkit.mesh_sculpt(G[g][0], f"{g}_{i}", 0.003, *G[g][1], colors=col)
            o.location = dx
        if i:
            for o0 in base:
                o = meshutil.duplicate(o0, o0.name + f"_{i}")
                o.location = dx
    views = [dict(target=(0.95, 0, 1.1), ortho=4.6, yaw=y, dist=12, pitch=4) for y in (0, 40)]
    preview.render_views(os.path.join(DEV, "brutes_clay.png"), views, res=(1000, 760))
    print(f"[brutes] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def build(args):
    T0 = time.time()
    q = args.q
    res = 1024 if q == "fast" else 2048
    h_body, h_hand, h_kilt, h_gear = {"fast": (0.0045, 0.0016, 0.0035, 0.0024), "med": (0.0032, 0.0013, 0.0025, 0.0017),
                                      "rel": (0.0024, 0.001, 0.0018, 0.0013)}[q]
    meshutil.clear_scene()
    BM.HORNS.clear()
    device = pipeline.setup_cycles(args.device)
    L = BO.ogre_landmarks()
    bros = args.only.split(",")
    report = {"device": device, "q": q, "res": res, "parts": {}, "bros": {}}
    t = time.time()
    S, info = BO.body_sculpt(L)
    hi_ = info["head"]
    H = hi_["H"]
    boss_paint(S, L, H)
    KP = info["kilt"]
    Sk = BO.war_skirt(KP)
    Sh = {s: BO.hand_sculpt(L, s) for s in ("L", "R")}
    G = build_gear(S, L, H, [g for b in bros for g in BROS[b]["gear"]])
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, BO.KILT_CHAIN)
    arm = rig.build_armature(L, "boss_brute", hair_chain=0, kilt_chain=BO.KILT_CHAIN)

    t = time.time()
    his = {}
    hb0, hb1 = BO.HEAD_BOX
    his["body"] = [pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=BO.HEAD_BOX),
                   pipeline.sculpt_mesh(S, "head_hi", h_body * 0.55, hb0, hb1, keep_box=BO.HEAD_BOX)]
    for o in his["body"]:
        charkit.drop_islands(o, h_body)
    for s in ("L", "R"):
        w = L["wrist_" + s]
        his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.28, w + 0.28)]
    his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
    for nm, (Sg, bnd) in G.items():
        o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *bnd)
        charkit.drop_islands(o, h_gear, min_verts=40)
        his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.004 if q != "fast" else 0.005

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {}
    los["body"] = pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, args.head_tris)],
                                   clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0022, 720, w - 0.28, w + 0.28, symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.0035, 1100)
    for nm, (Sg, bnd) in G.items():
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.003 if nm != "chain_L" else 0.0022, GEAR_TRIS[nm], *bnd,
                                   symmetry=nm in GEAR_SYM, clean=lambda o: charkit.drop_islands(o, 0.003, min_verts=30))
    for k, o in los.items():
        if k != "chain_L":
            charkit.drop_islands(o, 0.004, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(los["body"], arm, method="sdf", S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (BO.crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, BO.KILT_CHAIN)
    for nm in G:
        charkit.rigid_bind(los[nm], arm, GEAR_BONE[nm])
    pipeline.log(f"skinning {time.time()-t:.1f}s")

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=2.2, head_density=1.3)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.85)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.1)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    extra_p = dict(eyes=[tuple(e) for e in hi_["eyes"]], eye_r=hi_["eye_r"], eye_fwd=hi_["eye_fwd"],
                   z_knee=float(BO.OGRE["knee_z"]), z_chest=float(BO.OGRE["chest_z"]))
    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=BO.KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.014, 0.035), "hand_L": (0.007, 0.016), "hand_R": (0.007, 0.016), "kilt": (0.006, 0.014)}
    common = ["body", "hand_L", "hand_R", "kilt"]
    for b in bros:
        tt = time.time()
        pal = bro_pal(b)
        K = BROS[b]["K"]
        parts = common + BROS[b]["gear"]
        report["uv_fill_" + b] = pipeline.pack_atlas_shape([los[k] for k in parts], margin_px=6, res=res)
        for k in parts:
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, dict(extra_p, part=k), painters=PAINTERS)
        for o in all_hi + list(los.values()):
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.007, 0.018)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if q == "fast" else 48),
                             ("normal", "NORMAL", 4 if q == "fast" else 8)])
        prefix = f"boss_brute_{b}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix, tint=(0.4, 0.3, 0.24))
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        dups = []
        for k in parts:
            o = meshutil.duplicate(los[k], f"{k}_{b}")
            o.data.materials.clear()
            o.data.materials.append(mat)
            pipeline.strip_for_export(o)
            dups.append(o)
        bpy.context.view_layer.update()
        body = meshutil.join(dups, prefix + "_mesh")
        body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
        rep = {"tris": meshutil.tri_count(body), "K": K}
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=q_["bad"], soft=q_["soft"]) for k, q_ in qa.items()}
        pipeline.log(f"[{b}] stretch QA: " + ", ".join(f"{k}: bad {q_['bad']} soft {q_['soft']}" for k, q_ in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        BO.rescale(arm, [body], K)
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        BO.rescale(arm, [], 1.0 / K)
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        bpy.data.objects.remove(body, do_unlink=True)
        report["bros"][b] = rep
        pipeline.log(f"[{b}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(os.path.join(HERE, "out", "boss", "brutes_report.json"), report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "boss", "brutes_report.json"), report)
    pipeline.log(f"DONE brutes {bros} in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--q", default="med")
    ap.add_argument("--only", default="gor,mog")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--body-tris", type=int, default=10400)
    ap.add_argument("--head-tris", type=int, default=1800)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
