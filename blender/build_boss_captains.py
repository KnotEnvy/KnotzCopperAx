"""Boss art: THE HOLLOW KNIGHT CAPTAINS (stage 2 boss) -- COL. PATINA (crimson) and GEN. OXIDE (gilded).

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_boss_captains.py -- [options]
Options:
  --preview 1          workbench clay render of both captains -> progress/shots/bosses/dev/captains_clay.png (no export)
  --q fast|med         hi-poly density (default med; 2048 atlas)
  --only patina,oxide  export only these captains
Outputs public/assets/models/boss_captain_<patina|oxide>.glb + public/assets/textures/boss_captain_<id>_*.png,
report blender/out/boss/captains_report.json. Great-halberds: blender/build_boss_weapons.py --only halberd_patina,halberd_oxide.

Critic r3: "the Captains are stock 2.5 m knights (1.28x hero)". The body kit is the regular Hollow Knight
(blender/build_enemy_knight.py, IMPORTED, never edited: plate body, tabard, gauntlets, great helm). What makes them
BOSSES:
  * size: exported x1.40 / x1.44 (3.0 / 3.1 m native) -- >= 1.5x Brann's 1.97 m;
  * a CLOAK on both: a heavy mantle over the shoulders + upper back (skinned to chest / spine / neck) and a long
    torn back cape from the belt to mid-calf (skinned on the kilt chains, so it swings);
  * unique helms: PATINA "the Oathbound" -- the crimson great helm with a towering horsehair crest and three swept
    iron wing-fins each side; OXIDE "the Gilded" -- the crowned gold helm with forward-curving blackened horns in gold
    collars and a long trailing bone-white plume;
  * oversized pauldrons (x1.6 / x1.75, flanged + spiked) and the rank colour masses of the regular tiers.
"""
import os
import sys
import time
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import importlib
import numpy as np
import bpy

from lib import sdf, rig, meshutil, preview, pipeline, shaders, skin, charkit
import build_enemy_knight as BK
importlib.reload(BK)
import build_enemy_ogre as BO   # rescale() only
BM = BK.BM
BS = BK.BS
from lib.sdf import (V, norm, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff, Bounded, Offset,
                     RoundCone, RoundBox, Torus, Slab, Shell, Displace)
from lib.charkit import trace_in

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "bosses", "dev")

BK.PAULDRON["patina"] = (1.6, True, True)
BK.PAULDRON["oxide"] = (1.75, True, True)
CAPT = {
    "patina": dict(K=1.40, tier="red", gear=["helm_patina", "pauldron_patina_L", "pauldron_patina_R"]),
    "oxide": dict(K=1.44, tier="gold", gear=["helm_oxide", "pauldron_oxide_L", "pauldron_oxide_R"]),
}
HELM_BOUNDS = (V(-0.42, -0.5, 1.55), V(0.42, 0.62, 2.5))
MANTLE_BOUNDS = (V(-0.52, -0.3, 1.0), V(0.52, 0.42, 1.92))
CAPE_BOUNDS = (V(-0.48, -0.05, 0.12), V(0.48, 0.55, 1.22))
GEAR_TRIS = {"helm": 2600, "pauldron": 950, "mantle": 1600, "cape": 1500}


# ============================================================================ helms
def helm_patina(L, H):
    S, eyes = BK.helm(L, H, "red")
    s = H.s
    # towering horsehair crest, brow to nape (reads in profile across the screen)
    pts = [H(0, -0.14, 0.09), H(0, -0.08, 0.24), H(0, 0.02, 0.33), H(0, 0.14, 0.33), H(0, 0.25, 0.24), H(0, 0.31, 0.1),
           H(0, 0.3, -0.04)]
    S.add(Chain([H(0, -0.12, 0.08), H(0, 0.0, 0.15), H(0, 0.14, 0.12), H(0, 0.2, 0.05)], 0.014 * s), 0.01, mat="trim")
    S.add(Displace(Chain(pts, [0.02 * s, 0.06 * s, 0.08 * s, 0.08 * s, 0.065 * s, 0.04 * s, 0.014 * s],
                         squash=(0.36, 1.0), ref=(1, 0, 0)), 0.006, 50.0, 2, seed=16), 0.012, mat="plume")
    # three swept iron wing-fins each side
    for sx in (1, -1):
        for k in range(3):
            fp = [H(sx * 0.105, 0.02 + 0.03 * k, 0.05 - 0.035 * k), H(sx * 0.15, 0.13 + 0.05 * k, 0.17 - 0.07 * k),
                  H(sx * 0.18, 0.28 + 0.06 * k, 0.27 - 0.12 * k), H(sx * 0.19, 0.44 + 0.06 * k, 0.31 - 0.17 * k)]
            S.add(Chain(fp, [0.03 * s, 0.045 * s, 0.032 * s, 0.005 * s], squash=(0.26, 1.0), ref=(1, 0, 0)), 0.008,
                  mat="steel")
        S.add(Sphere(H(sx * 0.11, 0.04, 0.03), 0.02 * s), 0.006, mat="trim")                  # fin boss
    return S, eyes


def helm_oxide(L, H):
    S, eyes = BK.helm(L, H, "gold")
    s = H.s
    for sx in (1, -1):                                                                       # forward horns
        b0 = trace_in(S, H(0, 0, 0.03), norm(V(sx * 0.95, -0.1, 0.28)), r=0.35)
        BM.horn(S, b0, [(sx * 0.06, 0.0, 0.03), (sx * 0.13, -0.02, 0.09), (sx * 0.16, -0.07, 0.16),
                        (sx * 0.15, -0.13, 0.21), (sx * 0.11, -0.18, 0.23)], 0.036, s=s, mat="steel", collar="trim")
    # long trailing plume (over the crown's own) sweeping down the back
    pts = [H(0, 0.02, 0.2), H(0, 0.12, 0.27), H(0, 0.24, 0.24), H(0, 0.33, 0.12), H(0, 0.37, -0.04), H(0, 0.36, -0.18)]
    S.add(Displace(Chain(pts, [0.035 * s, 0.06 * s, 0.07 * s, 0.06 * s, 0.045 * s, 0.018 * s],
                         squash=(0.55, 1.0), ref=(1, 0, 0)), 0.006, 50.0, 2, seed=17), 0.014, mat="plume")
    return S, eyes


# ============================================================================ cloak
def mantle(snapA, L, S_body):
    """Heavy cloth mantle: a conforming shell over the shoulders + upper back down to the belt, a rolled collar
    round the back of the neck, trim border, and two gilt clasps + chain across the chest."""
    S = Sculpt(materials=BK.MATERIALS, default_mat="cloth")
    nk = L["neck"]
    lo, hi = MANTLE_BOUNDS
    back = HalfSpace(V(0, -0.03, 0), V(0, -1, 0))                       # y > -0.03 (the back is +Y)
    top = HalfSpace(V(0, 0, float(nk[2]) + 0.02), V(0, 0, 1))
    bot = HalfSpace(V(0, 0, BK.BELT_Z + 0.02), V(0, 0, -1))
    wide = Slab(V(0, 0, 0), V(1, 0, 0), 0.36)
    arms = Union(*[BM.arm_cutter(L, sd, t=0.05, pad=0.0)[0] for sd in ("L", "R")])
    body = Diff(Inter(BM.shell(snapA, 0.05, 0.03), back, top, bot, wide, k=0.006), arms, k=0.01)
    tongues = Union(*[Ellipsoid(V(x, 0.2, BK.BELT_Z + 0.18 + dz), V(0.07, 0.4, 0.2)) for x, dz in
                      ((-0.27, 0.05), (-0.13, -0.02), (0.0, 0.03), (0.13, -0.04), (0.27, 0.02))], k=0.03)
    body = Union(Inter(body, HalfSpace(V(0, 0, BK.BELT_Z + 0.2), V(0, 0, -1))), Inter(body, tongues, k=0.004), k=0.002)
    S.add(Bounded(Displace(body, 0.0025, 14.0, 2, seed=61), lo, hi), 0.0, mat="cloth")
    S.add(Bounded(Inter(BM.shell(snapA, 0.056, 0.046), back, top, wide, Diff(Slab(V(0, 0, 0), V(1, 0, 0), 0.37),
                                                                             Slab(V(0, 0, 0), V(1, 0, 0), 0.34)),
                        HalfSpace(V(0, 0, BK.BELT_Z + 0.2), V(0, 0, -1)), k=0.003), lo, hi), 0.002, mat="cloth_trim")
    # rolled collar behind the neck
    cz = float(nk[2]) - 0.02
    pts = [V(0.13 * math.sin(a), 0.03 + 0.09 * math.cos(a) * 0.9, cz + 0.015 * math.cos(a))
           for a in np.linspace(-1.9, 1.9, 9)]
    S.add(Displace(Chain(pts, 0.04), 0.002, 18.0, 2, seed=62), 0.02, mat="cloth")
    # clasps + chain
    cl = []
    for sx in (1, -1):
        p = trace_in(S_body, V(sx * 0.12, 0.0, cz - 0.07), V(0, -1, 0), r=0.5) + V(0, -0.012, 0)
        S.add(Ellipsoid(p, V(0.032, 0.014, 0.032)), 0.005, mat="trim")
        cl.append(p)
    for i in range(7):
        f = (i + 0.5) / 7
        p = cl[0] * (1 - f) + cl[1] * f + V(0, -0.012, -0.03 * math.sin(f * math.pi))
        S.add(Torus(p, 0.009, 0.0032, sdf.basis(V(0, 1, 0) if i % 2 else V(0, 0, 1))[:, [1, 2, 0]]), 0.002, mat="trim")
    return S


def cape(kp):
    """Long torn back cape from the belt to mid-calf (behind the tabard's back panel), trim down the sides."""
    S = Sculpt(materials=BK.MATERIALS, default_mat="cloth")
    top, hz, w = kp["top_z"] + 0.06, 0.3, 0.3
    y_s = kp["yb"] + 0.04
    cone = RoundCone(V(0, kp["cy"] + 0.02, top + 0.02), V(0, kp["cy"] + 0.06, hz - 0.1), kp["r_top"] + 0.035,
                     kp["r_hem"] + 0.13, squash=(kp["squash"] * 1.1, 1.0))
    panel = Inter(Shell(cone, 0.006), HalfSpace(V(0, kp["cy"] + 0.02, 0), V(0, -1, 0)), Slab(V(0, 0, 0), V(1, 0, 0), w),
                  HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
    tongues = Union(HalfSpace(V(0, 0, hz + 0.26), V(0, 0, -1)),
                    *[Ellipsoid(V(x, y_s + 0.05, hz + 0.2 + dz), V(0.075, 0.5, 0.26)) for x, dz in
                      ((-w * 0.8, 0.04), (-w * 0.42, -0.04), (-w * 0.05, 0.02), (w * 0.34, -0.06), (w * 0.76, 0.01))], k=0.03)
    reg = Inter(panel, tongues, k=0.004)
    lo, hi = CAPE_BOUNDS
    S.add(Bounded(Displace(reg, 0.0025, 12.0, 2, seed=71), lo, hi), 0.0, mat="cloth")
    border = Inter(Offset(panel, 0.0015), tongues, Diff(Slab(V(0, 0, 0), V(1, 0, 0), w + 0.002),
                                                        Slab(V(0, 0, 0), V(1, 0, 0), w - 0.022)), k=0.002)
    S.add(Bounded(border, lo, hi), 0.001, mat="cloth_trim")
    return S


def cape_params(kp):
    k = dict(kp)
    k.update(hem_z=0.3, r_hem=kp["r_hem"] + 0.12)
    return k


def build_gear(S_body, L, H, names, h=0.0035):
    t = time.time()
    snapA = charkit.GridSDF(S_body, h=h, lo=V(-0.8, -0.45, 1.0), hi=V(0.8, 0.5, 1.95))
    pipeline.log(f"body grid SDF {time.time()-t:.1f}s")
    out, eyes = {}, {}
    for nm in names:
        if nm == "helm_patina":
            Sg, eyes["patina"] = helm_patina(L, H)
            out[nm] = (Sg, "head", HELM_BOUNDS)
        elif nm == "helm_oxide":
            Sg, eyes["oxide"] = helm_oxide(L, H)
            out[nm] = (Sg, "head", HELM_BOUNDS)
        else:
            sh = L["shoulder_" + nm[-1]]
            out[nm] = (BK.pauldron(snapA, L, nm[-1], nm.split("_")[1]), "upperarm_" + nm[-1], (sh - 0.42, sh + 0.42))
    out["mantle"] = (mantle(snapA, L, S_body), None, MANTLE_BOUNDS)
    return out, eyes


# ============================================================================ palettes
PAL_X = {
    "patina": dict(cloth=shaders.srgb(120, 16, 22), cloth_trim=shaders.srgb(200, 150, 64), plume=shaders.srgb(170, 18, 24)),
    "oxide": dict(cloth=shaders.srgb(34, 20, 44), cloth_trim=shaders.srgb(214, 170, 72), plume=shaders.srgb(226, 216, 190),
                  steel=shaders.srgb(58, 58, 66)),
}


def capt_pal(c):
    p = BK.tier_pal(CAPT[c]["tier"])
    p.update(PAL_X[c])
    return p


# ============================================================================ preview
def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(BK.KNIGHT)
    t0 = time.time()
    os.makedirs(DEV, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    S, info = BK.body_sculpt(L)
    H = info["H"]
    G, _ = build_gear(S, L, H, [g for c in CAPT.values() for g in c["gear"]])
    col = BK.MAT_COLORS
    base = [charkit.mesh_sculpt(S, "body", 0.005, colors=col),
            charkit.mesh_sculpt(BK.tabard_skirt(info["kilt"]), "kilt", 0.004, colors=col),
            charkit.mesh_sculpt(cape(info["kilt"]), "cape", 0.004, *CAPE_BOUNDS, colors=col),
            charkit.mesh_sculpt(G["mantle"][0], "mantle", 0.004, *MANTLE_BOUNDS, colors=col)]
    for s in ("L", "R"):
        w = L["wrist_" + s]
        base.append(charkit.mesh_sculpt(BK.hand_sculpt(L, s), "hand_" + s, 0.0025, w - 0.17, w + 0.17, colors=col))
    for i, (c, cfg) in enumerate(CAPT.items()):
        dx = V(i * 1.4, 0, 0)
        for g in cfg["gear"]:
            o = charkit.mesh_sculpt(G[g][0], f"{g}_{i}", 0.003, *G[g][2], colors=col)
            o.location = dx
        if i:
            for o0 in base:
                o = meshutil.duplicate(o0, o0.name + f"_{i}")
                o.location = dx
    views = [dict(target=(0.7, 0, 1.15), ortho=3.6, yaw=y, dist=10, pitch=4) for y in (0, 90)]
    preview.render_views(os.path.join(DEV, "captains_clay.png"), views, res=(1000, 760))
    print(f"[captains] preview done in {time.time()-t0:.1f}s")


# ============================================================================ build
def build(args):
    T0 = time.time()
    q = args.q
    res = 1024 if q == "fast" else 2048
    h_body, h_hand, h_kilt, h_gear = {"fast": (0.0042, 0.0014, 0.003, 0.002), "med": (0.0028, 0.0011, 0.002, 0.0014)}[q]
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(BK.KNIGHT)
    capts = args.only.split(",")
    report = {"device": device, "q": q, "res": res, "parts": {}, "captains": {}}
    t = time.time()
    S, info = BK.body_sculpt(L)
    H = info["H"]
    KP = info["kilt"]
    Sk = BK.tabard_skirt(KP)
    Sc = cape(KP)
    Sh = {s: BK.hand_sculpt(L, s) for s in ("L", "R")}
    G, eyes = build_gear(S, L, H, [g for c in capts for g in CAPT[c]["gear"]])
    glow = {c: BS.glow_sculpt(eyes[c], 0.011) for c in capts}
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s")
    L["kilt_chain_pts"] = charkit.kilt_chain_points(KP, BK.KILT_CHAIN)
    arm = rig.build_armature(L, "boss_captain", hair_chain=0, kilt_chain=BK.KILT_CHAIN)

    t = time.time()
    his = {"body": [pipeline.sculpt_mesh(S, "body_hi", h_body)]}
    charkit.drop_islands(his["body"][0], h_body)
    for s in ("L", "R"):
        w = L["wrist_" + s]
        his["hand_" + s] = [pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)]
    his["kilt"] = [pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)]
    his["cape"] = [pipeline.sculpt_mesh(Sc, "cape_hi", h_kilt, *CAPE_BOUNDS)]
    for nm, (Sg, _, bnd) in G.items():
        o = pipeline.sculpt_mesh(Sg, nm + "_hi", h_gear, *bnd)
        charkit.drop_islands(o, h_gear, min_verts=40)
        his[nm] = [o]
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    t = time.time()
    h_lo = 0.0036 if q != "fast" else 0.0045
    hb0, hb1 = BK.HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    los = {"body": pipeline.lowpoly(S, "body_lo", h_lo, args.body_tris, regions=[(in_head, 300)],
                                    clean=lambda o: report.__setitem__("islands_dropped", charkit.drop_islands(o, h_lo)))}
    for s in ("L", "R"):
        w = L["wrist_" + s]
        los["hand_" + s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, 560, w - 0.17, w + 0.17, symmetry=False)
    los["kilt"] = pipeline.lowpoly(Sk, "kilt_lo", 0.003, 900)
    los["cape"] = pipeline.lowpoly(Sc, "cape_lo", 0.003, GEAR_TRIS["cape"], *CAPE_BOUNDS)
    for nm, (Sg, _, bnd) in G.items():
        kind = nm.split("_")[0]
        los[nm] = pipeline.lowpoly(Sg, nm + "_lo", 0.0026, GEAR_TRIS[kind], *bnd, symmetry=kind in ("helm", "mantle"),
                                   clean=lambda o: charkit.drop_islands(o, 0.0026, min_verts=30))
    glow_lo = {c: pipeline.lowpoly(glow[c], "glow_lo_" + c, 0.0015, 100, symmetry=False) for c in capts}
    for o in los.values():
        charkit.drop_islands(o, 0.0036, min_verts=24)
        o.data.validate()
    report["geom_qa"] = {k: charkit.geom_qa(o) for k, o in los.items()}
    for k, o in los.items():
        report["parts"][k] = meshutil.tri_count(o)
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']}")

    t = time.time()
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(los["body"], arm, method="sdf", S=S, allowed=body_bones,
                       overrides=[(charkit.head_mask(H), "head"), (BK.crotch_mask, "hips")] +
                                 [(charkit.wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")])
    for s in ("L", "R"):
        skin.skin(los["hand_" + s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(charkit.wrist_mask(L, s), "hand_" + s)], smooth=2)
    charkit.skin_kilt(los["kilt"], arm, KP, BK.KILT_CHAIN)
    charkit.skin_kilt(los["cape"], arm, cape_params(KP), BK.KILT_CHAIN)
    skin.skin(los["mantle"], arm, method="sdf", S=S, allowed=["hips", "spine", "chest", "neck"], smooth=4)
    for nm, (_, bone, _) in G.items():
        if bone:
            charkit.rigid_bind(los[nm], arm, bone)
    for c in capts:
        charkit.rigid_bind(glow_lo[c], arm, "head")
    pipeline.log(f"skinning {time.time()-t:.1f}s")

    t = time.time()
    report["uv_refolded"] = charkit.body_unwrap(los["body"], arm, body_W, H, face_density=1.0, head_density=0.6)
    for s in ("L", "R"):
        charkit.smart_uv(los["hand_" + s], 66.0, 1.2)
    charkit.smart_uv(los["kilt"], 70.0, 0.9)
    charkit.smart_uv(los["cape"], 70.0, 0.9)
    for nm in G:
        charkit.smart_uv(los[nm], 62.0, 1.25 if nm.startswith("helm") else 1.0)
    pipeline.log(f"UV charts {time.time()-t:.1f}s")

    sculpt_of = {"body": S, "hand_L": Sh["L"], "hand_R": Sh["R"], "kilt": Sk, "cape": Sc}
    sculpt_of.update({k: v[0] for k, v in G.items()})
    for k, lst in his.items():
        for o in lst:
            shaders.assign_bake_materials(o, sculpt_of[k].materials, prefix=f"bk_{k}_", kinds=BK.KINDS)
    all_hi = [o for lst in his.values() for o in lst]
    ext = {"body": (0.012, 0.03), "hand_L": (0.006, 0.014), "hand_R": (0.006, 0.014), "kilt": (0.005, 0.012),
           "cape": (0.006, 0.014), "mantle": (0.006, 0.016)}
    common = ["body", "hand_L", "hand_R", "kilt", "cape", "mantle"]
    for c in capts:
        tt = time.time()
        pal = capt_pal(c)
        K = CAPT[c]["K"]
        parts = common + CAPT[c]["gear"]
        extra_p = dict(eyes=[tuple(e) for e in eyes[c]])
        report["uv_fill_" + c] = pipeline.pack_atlas_shape([los[k] for k in parts], margin_px=6, res=res)
        for k in parts:
            pk = k if not k.startswith(("helm", "pauldron")) else k.replace("_" + c, "")
            for o in his[k]:
                shaders.paint_mesh(o, sculpt_of[k].materials, L, pal, dict(extra_p, part=pk), painters=BK.PAINTERS)
        for o in all_hi + list(los.values()) + list(glow_lo.values()):
            pipeline.set_ray_visibility(o, False)
        jobs = [(los[k], his[k]) + ext.get(k, (0.006, 0.016)) for k in parts]
        B = pipeline.Baker(res, jobs, shaders.set_pass, [los[k] for k in parts], [o for k in parts for o in his[k]])
        maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 24 if q == "fast" else 48),
                             ("normal", "NORMAL", 4 if q == "fast" else 8)])
        prefix = f"boss_captain_{c}"
        tex = charkit.composite_maps(maps, OUT_TEX, prefix, tint=(0.46, 0.44, 0.48))
        mat = pipeline.final_material("M_" + prefix, tex["albedo"], tex["normal"], tex["orm"])
        gmat = BS.glow_material("M_" + prefix + "_glow", pal["glow"], pal["glow_strength"])
        dups = []
        for k in parts:
            o = meshutil.duplicate(los[k], f"{k}_{c}")
            o.data.materials.clear()
            o.data.materials.append(mat)
            pipeline.strip_for_export(o)
            dups.append(o)
        bpy.context.view_layer.update()
        body = meshutil.join(dups, prefix + "_mesh")
        body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
        g = meshutil.duplicate(glow_lo[c], f"glow_{c}")
        g.data.materials.clear()
        g.data.materials.append(gmat)
        pipeline.strip_for_export(g)
        body = meshutil.join([body, g], prefix + "_mesh")
        rep = {"tris": meshutil.tri_count(body), "K": K}
        qa = skin.stretch_report(body, arm)
        rep["stretch_qa"] = {k: dict(bad=q_["bad"], soft=q_["soft"]) for k, q_ in qa.items()}
        pipeline.log(f"[{c}] stretch QA: " + ", ".join(f"{k}: bad {q_['bad']} soft {q_['soft']}" for k, q_ in qa.items()))
        out = os.path.join(OUT_MODELS, prefix + ".glb")
        BO.rescale(arm, [body], K)
        pipeline.export_glb(out, [arm, body], scene_name=prefix)
        BO.rescale(arm, [], 1.0 / K)
        rep["glb_mb"] = os.path.getsize(out) / 1e6
        rep["seconds"] = time.time() - tt
        bpy.data.objects.remove(body, do_unlink=True)
        report["captains"][c] = rep
        pipeline.log(f"[{c}] DONE {out} ({rep['glb_mb']:.1f} MB, {rep['tris']} tris) {rep['seconds']:.0f}s")
        pipeline.write_json(os.path.join(HERE, "out", "boss", "captains_report.json"), report)
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "boss", "captains_report.json"), report)
    pipeline.log(f"DONE captains {capts} in {report['seconds']:.0f}s")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--q", default="med")
    ap.add_argument("--only", default="patina,oxide")
    ap.add_argument("--device", default="AUTO")
    ap.add_argument("--body-tris", type=int, default=9600)
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
