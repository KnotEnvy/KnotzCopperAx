"""Boss armour kit: Morvane Deathcoil (the Adder King) + Iron Chancellor Varkhul, built on the Hollow Knight kit.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_boss_armor.py -- [options]
Options:
  --preview full            clay renders to progress/shots/bosses/dev/boss_full.png (no export)
  --fast                    coarser hi-poly + 1024 atlas
  --tiers morvane,varkhul   export only these
Default: public/assets/models/boss_<tier>.glb, textures public/assets/textures/boss_<tier>_*.png,
report blender/out/boss/boss_report.json.

The knight kit (build_enemy_knight.py, owned by enemies-art-2) is imported and re-parameterised IN THIS PROCESS ONLY
(module globals patched after import; the knight file is never edited): a bulkier body (wider shoulders, heavier
chest/traps/delts), boss helms, oversized pauldrons, boss palettes and a serpent-scale painter. Rig = §2 humanoid
(2.0 m reference; the game scales Morvane ×1.5 → 3.0 m, Varkhul ×1.3 → 2.6 m).

Morvane: blackened green-steel plate with venom-jade enamel on the pauldrons/cuirass, tarnished gold trim, a great
helm crowned by a cobra hood with a striking serpent head over the brow, two more serpents coiling round the helm
and a pair of ram-curled black horns with gold caps; green eye glow; black-green tabard with gold hem; spiked
pauldrons (three extra war spikes each).
Varkhul: gunmetal plate with verdigris-teal enamel (copper-corrosion rank colour), brass trim, crimson tabard, a
crowned bascinet with a tall central spike and swept side fins, flanged pauldrons; cold amber eye glow.
"""
import os
import sys
import math
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np

import build_enemy_knight as KN
importlib.reload(KN)
from lib import rig, meshutil, preview, shaders, charkit, pipeline
from lib.sdf import (V, norm, Sculpt, Sphere, Ellipsoid, Chain, HalfSpace, Inter, Union, Diff, Offset, RoundCone,
                     Slab, Displace)
from lib.charkit import trace_in

ROOT = os.path.dirname(HERE)
DEV = os.path.join(ROOT, "progress", "shots", "bosses", "dev")
OUT_DIR = os.path.join(HERE, "out", "boss")

# ----------------------------------------------------------------------------------------------- re-parameterise
KN.ASSET = "boss"
KN.HERE = OUT_DIR                          # knight build() writes <HERE>/out/knight_report.json → blender/out/boss/out/
KN.KNIGHT.update(shoulder_x=0.25, hip_x=0.11, stance_x=0.14, upperarm=0.34, forearm=0.3)
KN.STYLE.update(muscle=1.35, chest=1.3, lats=1.25, traps=1.55, waist=1.2, delts=1.45, arm=1.3, forearm=1.38, neck=1.5)
KN.TIERS = {
    "morvane": ["helm_morvane", "pauldron_morvane_L", "pauldron_morvane_R"],
    "varkhul": ["helm_varkhul", "pauldron_varkhul_L", "pauldron_varkhul_R"],
}
KN.PAULDRON = {"morvane": (1.62, True, True), "varkhul": (1.5, True, False)}
KN.GEAR_TRIS = {"helm": 3600, "pauldron": 1100}
KN.TIER_PAL = {
    "morvane": dict(
        steel=shaders.srgb(84, 96, 90), steel_edge=shaders.srgb(190, 206, 196),
        skin=shaders.srgb(34, 40, 36),
        trim=shaders.srgb(178, 138, 60), trim_patina=shaders.srgb(70, 64, 36), trim_patina_amt=0.35,
        cloth=shaders.srgb(24, 40, 30), cloth_trim=shaders.srgb(186, 146, 64),
        leather=shaders.srgb(62, 54, 46), leather_worn=shaders.srgb(120, 104, 84),
        plume=shaders.srgb(58, 124, 62), void_glow=shaders.srgb(40, 190, 90),
        enamel=shaders.srgb(40, 118, 70), enamel_dark=shaders.srgb(8, 34, 20), enamel_metal=0.35, enamel_rough=0.28,
        enamel_helm=False, glow=(0.35, 1.0, 0.45), glow_strength=5.0,
        scale_belly=shaders.srgb(170, 160, 92)),
    "varkhul": dict(
        steel=shaders.srgb(96, 100, 108), steel_edge=shaders.srgb(206, 208, 214),
        trim=shaders.srgb(196, 150, 70), trim_patina=shaders.srgb(80, 70, 40),
        cloth=shaders.srgb(128, 20, 24), cloth_trim=shaders.srgb(208, 166, 74),
        plume=shaders.srgb(128, 20, 24), void_glow=shaders.srgb(200, 130, 40),
        enamel=shaders.srgb(58, 132, 118), enamel_dark=shaders.srgb(14, 44, 40), enamel_metal=0.55, enamel_rough=0.3,
        enamel_helm=True, glow=(1.0, 0.62, 0.25), glow_strength=4.0,
        scale_belly=shaders.srgb(200, 160, 90)),
}


def p_scales(c, pal):
    """Serpent hide: offset rows of rounded scales (dark gaps), a pale belly band on the underside, sheen on ridges."""
    P = c.P
    u = P[:, 0] * 260.0 + P[:, 1] * 130.0
    v = P[:, 2] * 300.0 + P[:, 1] * 150.0
    row = np.floor(v)
    cell = np.abs(np.sin((u + 0.5 * (row % 2)) * math.pi)) * np.abs(np.sin(v * math.pi))
    gap = shaders.smooth01(cell, 0.05, 0.35)
    n = c.noise(18.0, 2, 507)
    base = np.tile(pal["plume"], (c.n, 1)) * (0.75 + 0.3 * n)[:, None]
    under = shaders.smooth01(-c.N[:, 2] if hasattr(c, "N") else np.zeros(c.n), 0.2, 0.8)
    base = shaders.mix(base, pal["scale_belly"], 0.7 * under)
    rgb = shaders.mix(base * 0.3, base, gap)
    rgb = shaders.mix(rgb, np.minimum(pal["plume"] * 1.6 + 0.06, 1), 0.35 * c.ridge)
    rgb = shaders.mix(rgb, rgb * 0.35, np.clip(c.cav * 1.3, 0, 1))
    return shaders.out(c.n, rgb, np.clip(0.38 + 0.25 * (1 - gap) + 0.15 * c.cav, 0.2, 0.8), np.full(c.n, 0.05))


KN.PAINTERS = dict(KN.PAINTERS, plume=p_scales)


# ----------------------------------------------------------------------------------------------- helms
def serpent(S, pts, r0, r1, head_dir, mat="plume", s=1.0):
    """A serpent body along pts (radius r0 → r1) ending in a wedge head + fangs pointing along head_dir."""
    n = len(pts)
    radii = [(r0 + (r1 - r0) * i / (n - 1)) * s for i in range(n)]
    S.add(Displace(Chain(pts, radii), 0.0012, 90.0, 1, seed=11), 0.006, mat=mat)
    tip = pts[-1]
    d = norm(head_dir)
    hc = tip + d * r1 * 1.6 * s
    S.add(Ellipsoid(hc, V(r1 * 1.9, r1 * 1.9, r1 * 1.3) * s), 0.008, mat=mat)
    S.add(RoundCone(hc, hc + d * r1 * 2.6 * s, r1 * 1.3 * s, r1 * 0.5 * s), 0.008, mat=mat)
    return hc, d


def helm_core(L, H):
    """Great helm core shared by both bosses (from the knight kit): base, visor ridge, T slit, breath holes, bands."""
    S = Sculpt(materials=KN.GEAR_MATS, default_mat="steel")
    s = H.s
    base = KN.helm_shape(H)
    S.add(base, 0.0, mat="steel")
    ridge = [H(0, -0.125, 0.07), H(0, -0.14, 0.0), H(0, -0.142, -0.06), H(0, -0.13, -0.13), H(0, -0.1, -0.2)]
    S.add(Chain(ridge, [0.01 * s, 0.016 * s, 0.016 * s, 0.013 * s, 0.01 * s], squash=(0.5, 1.0), ref=(1, 0, 0)), 0.03,
          mat="steel")
    skin_ = Diff(Offset(base, 0.03), Offset(base, -0.024))
    front = HalfSpace(H(0, -0.055, 0), V(0, 1, 0))
    slit = Inter(Slab(H(0, 0, -0.012), V(0, 0.2, 1), 0.012 * s), skin_, front, Slab(V(0, 0, 0), V(1, 0, 0), 0.09 * s),
                 k=0.003)
    S.sub(slit, 0.004, mat="void")
    vert = Inter(Slab(V(0, 0, 0), V(1, 0, 0), 0.0085 * s), skin_, front, HalfSpace(H(0, 0, -0.1), V(0, 0, -1)),
                 HalfSpace(H(0, 0, -0.01), V(0, 0, 1)), k=0.003)
    S.sub(vert, 0.004, mat="void")
    for sx in (1, -1):
        for j in range(3):
            p = H(sx * (0.05 + 0.012 * j), -0.105 + 0.012 * j, -0.085 - 0.018 * j)
            S.sub(Inter(Sphere(p, 0.0068 * s), skin_), 0.002, mat="void")
    S.add(Inter(Offset(base, 0.005), Slab(H(0, 0, 0.055), V(0, 0.25, 1), 0.013 * s), k=0.002), 0.002, mat="trim")
    S.add(Inter(Offset(base, 0.005), Slab(H(0, 0, -0.225), V(0, 0, 1), 0.012 * s), k=0.002), 0.002, mat="trim")
    for i in range(18):
        a = (i + 0.5) / 18 * 2 * math.pi
        p = trace_in(S, H(0, 0.0, 0.06), norm(V(math.sin(a), -math.cos(a), 0.25)), r=0.3)
        S.add(Sphere(p, 0.0055), 0.001, mat="trim")
    S.inter(HalfSpace(H(0, 0, -0.235), V(0, 0, -1)))
    return S, base


def helm(L, H, tier):
    S, base = helm_core(L, H)
    s = H.s
    if tier == "morvane":
        # ram-curled black horns with gold caps and growth rings
        for sx in (1, -1):
            pts = [H(sx * 0.1, 0.0, 0.05), H(sx * 0.19, 0.02, 0.1), H(sx * 0.26, 0.02, 0.19), H(sx * 0.28, -0.03, 0.29),
                   H(sx * 0.25, -0.1, 0.36), H(sx * 0.2, -0.16, 0.37)]
            rr = [0.045, 0.04, 0.032, 0.024, 0.015, 0.006]
            S.add(Displace(Chain(pts, [r * s for r in rr]), 0.0018, 70.0, 2, seed=21 + sx), 0.01, mat="leather")
            for j in (1, 2, 3):
                c = (pts[j] + pts[j + 1]) * 0.5
                S.add(Inter(Offset(Chain(pts, [r * s for r in rr]), 0.003), Sphere(c, 0.012 * s)), 0.003, mat="leather")
            S.add(RoundCone(pts[-2] * 0.3 + pts[-1] * 0.7, pts[-1] + (pts[-1] - pts[-2]) * 0.5, 0.009 * s, 0.002),
                  0.004, mat="trim")
            S.add(Inter(Offset(Chain(pts, [r * s for r in rr]), 0.004), Sphere(pts[0] * 0.5 + pts[1] * 0.5, 0.03 * s)),
                  0.003, mat="trim")                                            # gold horn collar
        # cobra hood rising from the back of the helm (thick fan, scaled), serpent neck arching over the crown
        hood = Inter(Union(Ellipsoid(H(0, 0.11, 0.06), H.r(0.19, 0.045, 0.15)), Ellipsoid(H(0, 0.1, 0.17), H.r(0.1, 0.04, 0.12)), k=0.05), HalfSpace(H(0, 0, -0.08), V(0, 0, -1)), k=0.01)
        S.add(Displace(hood, 0.002, 40.0, 2, seed=31), 0.02, mat="plume")
        S.add(Inter(Offset(hood, 0.004), Diff(Ellipsoid(H(0, 0.11, 0.06), H.r(0.2, 0.07, 0.16)),
                                               Ellipsoid(H(0, 0.11, 0.06), H.r(0.18, 0.09, 0.14)))), 0.004,
              mat="trim")                                                        # gold rim on the hood
        neck = [H(0, 0.06, 0.2), H(0, 0.0, 0.27), H(0, -0.07, 0.28), H(0, -0.12, 0.24)]
        serpent(S, neck, 0.045, 0.028, V(0, -1, -0.55), s=s)
        # two serpents coiling round the helm, heads at the brow corners
        for k, sx in enumerate((1, -1)):
            pts = []
            for i in range(9):
                t = i / 8
                a = sx * (math.pi * 0.95 - t * math.pi * 1.55) + math.pi * 0.5
                pts.append(H(math.cos(a) * 0.152, math.sin(a) * 0.165 + 0.005, -0.1 + t * 0.2))
            serpent(S, pts, 0.014, 0.018, V(sx * 0.4, -1, 0.15), s=s)
        # fangs under the visor ridge (ivory = trim)
        for sx in (1, -1):
            p = H(sx * 0.03, -0.135, -0.07)
            S.add(RoundCone(p, p + V(0, -0.01, -0.05) * s, 0.008 * s, 0.0015), 0.003, mat="trim")
    else:
        # Varkhul: crowned bascinet, tall central spike, swept side fins
        S.add(Inter(Offset(base, 0.014), Slab(H(0, 0, 0.085), V(0, 0.2, 1), 0.016 * s), k=0.002), 0.003, mat="trim")
        for i in range(10):
            a = (i + 0.5) / 10 * 2 * math.pi
            d = norm(V(math.sin(a), -math.cos(a), 0.0))
            p = trace_in(S, H(0, 0.0, 0.09), d, r=0.3)
            S.add(RoundCone(p - V(0, 0, 0.005), p + V(0, 0, 0.065) * s + d * 0.006, 0.014 * s, 0.002), 0.004, mat="trim")
        S.add(RoundCone(H(0, 0.0, 0.1), H(0, 0.02, 0.34), 0.03 * s, 0.003), 0.012, mat="steel")
        S.add(Ellipsoid(H(0, 0.0, 0.14), H.r(0.04, 0.04, 0.03)), 0.008, mat="trim")
        for sx in (1, -1):
            c = H(sx * 0.13, 0.03, 0.02)
            fin = Inter(Slab(c, V(1, 0, 0.1), 0.007 * s), Ellipsoid(c + V(sx * 0.02, 0.06, 0.08) * s, V(0.1, 0.16, 0.12) * s),
                        HalfSpace(c - V(0, 0, 0.02), V(0, 0, -1)), k=0.004)
            S.add(fin, 0.006, mat="steel")
            S.add(Inter(Offset(fin, 0.003), Slab(c + V(0, 0.02, 0.1) * s, V(0, -0.4, 1), 0.012 * s)), 0.002, mat="trim")
    eyes = [H(sx * 0.036, -0.1, -0.014) for sx in (1, -1)]
    return S, eyes


_orig_pauldron = KN.pauldron


def pauldron(snapA, L, side, tier):
    S = _orig_pauldron(snapA, L, side, tier)
    if tier == "morvane":
        sx = 1 if side == "L" else -1
        sh, el = L["shoulder_" + side], L["elbow_" + side]
        a = norm(el - sh)
        up = norm(V(0, 0, 1) - a * float(np.dot(V(0, 0, 1), a)))
        for j, (da, du, sd, ln) in enumerate(((-0.1, 1.0, 0.2, 0.15), (0.12, 0.85, 0.45, 0.12), (0.3, 0.6, 0.7, 0.09))):
            d = norm(up * du + a * da + V(sx * sd, 0, 0))
            p = trace_in(S, sh + a * 0.05, d)
            S.add(RoundCone(p - d * 0.01, p + d * ln, 0.03 - 0.005 * j, 0.003), 0.006, mat="steel")
            S.add(Inter(Offset(RoundCone(p - d * 0.01, p + d * ln, 0.03 - 0.005 * j, 0.003), 0.003),
                        Sphere(p, 0.03)), 0.002, mat="trim")
    return S


KN.helm = helm
KN.pauldron = pauldron


# ----------------------------------------------------------------------------------------------- preview
def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(KN.KNIGHT)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = KN.body_sculpt(L)
    H = info["H"]
    tiers = list(KN.TIERS)
    G, eyes = KN.build_gear(S, L, H, [g for t in tiers for g in KN.TIERS[t]])
    MC = dict(KN.MAT_COLORS, steel=(0.3, 0.36, 0.33), plume=(0.2, 0.5, 0.22), leather=(0.08, 0.07, 0.06))
    base = [charkit.mesh_sculpt(S, "body", args.h or 0.004, colors=MC),
            charkit.mesh_sculpt(KN.tabard_skirt(info["kilt"]), "kilt", 0.003, colors=MC)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(KN.hand_sculpt(L, s), "hand_" + s, 0.002, w - 0.17, w + 0.17, colors=MC))
    for i, tier in enumerate(tiers):
        dx = V(i * 1.35, 0, 0)
        for g in KN.TIERS[tier]:
            o = charkit.mesh_sculpt(G[g][0], g, 0.0028, *KN.gear_bounds(g, L), colors=MC)
            o.location = dx
        if i:
            for b in base:
                o = meshutil.duplicate(b, b.name + f"_{i}")
                o.location = dx
    views = [dict(target=(0.67, 0, 1.1), ortho=3.3, yaw=y, dist=9, pitch=4) for y in (0, 35)]
    views.append(dict(target=(0.0, 0, 1.9), ortho=0.9, yaw=25, dist=6, pitch=6))
    preview.render_views(os.path.join(out, "boss_full.png"), views, res=(1000, 820))
    print(f"[boss] preview done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    os.makedirs(os.path.join(OUT_DIR, "out"), exist_ok=True)
    a = KN.parse()
    if a.tiers is None:
        a.tiers = ",".join(KN.TIERS)
    if a.preview:
        preview_main(a)
    else:
        KN.build(a)
