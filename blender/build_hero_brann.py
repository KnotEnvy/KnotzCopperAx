"""Build Brann Stormhewn (hero) + Grudgebrand (greatsword) with the blender/lib pipeline.

Usage (headless, from the project root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P blender/build_hero_brann.py -- [options]
Options:
  --preview body|head|hands|full   quick clay renders to progress/shots/art-pipeline-brann/dev/ (no export)
  --h <m>                          override preview voxel size
  --fast                           lower hi-poly resolution + 1024 bake (pipeline smoke test)
  --no-weapon / --weapon-only
Default: full pipeline -> public/assets/models/hero_brann.glb (+ weapon_grudgebrand.glb), textures in
public/assets/textures/brann_*.png, report in blender/out/brann_report.json
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

from lib import sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin
for _m in (sdf, rig, anatomy, meshutil, preview, gear, hair, pipeline, shaders, skin):
    importlib.reload(_m)

from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union,
                     Bounded, Offset, RoundCone)

ROOT = os.path.dirname(HERE)
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_TEX = os.path.join(ROOT, "public", "assets", "textures")
DEV = os.path.join(ROOT, "progress", "shots", "art-pipeline-brann", "dev")

BRANN = dict(
    height=1.95, head_h=0.245,
    shoulder_x=0.228, shoulder_z=1.585, clav_in_x=0.026,
    hip_x=0.098, hip_joint_z=0.99, pelvis_z=1.03,
    knee_z=0.535, ankle_z=0.092, foot_len=0.28, stance_x=0.118,
    spine_z=1.14, chest_z=1.33, neck_z=1.60, head_base_z=1.715,
    upperarm=0.335, forearm=0.29, hand=0.215,
    arm_down=40.0, arm_fwd=6.0, elbow_bend=10.0,
)
STYLE = dict(muscle=1.30, defin=1.0, fat=0.0, chest=1.06, lats=1.2, traps=1.12, waist=0.93, delts=1.22, arm=1.12,
             forearm=1.14, neck=1.2,
             brow=1.2, jaw=1.04, scowl=1.05, cheek=1.05, chin=1.1, nose_bump=1.0, squint=1.6, nose_len=0.72,
             nose_w=1.12, lip=1.3, mouth_w=1.18, eye=1.0)
MATERIALS = ["skin", "eye", "nail", "brow", "hair", "leather", "leather_dark", "fur", "bronze", "iron", "cloth", "sole"]
WRIST_CUT_T = 0.90     # body forearm is cut here (inside the bracer); hands start at HAND_CUT_T
HAND_CUT_T = 0.84


# ============================================================================ sculpts
def forearm_frame(L, side):
    el, wr = L["elbow_" + side], L["wrist_" + side]
    b = norm(wr - el)
    return el, wr, b, float(np.linalg.norm(wr - el))


def body_sculpt(L, gear_on=True, parts=("torso", "arms", "legs", "head")):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {"arms": {}, "legs": {}}
    if "torso" in parts:
        anatomy.torso(S, L, STYLE)
    if "arms" in parts:
        for s in ("L", "R"):
            info["arms"][s] = anatomy.arm(S, L, s, STYLE)
    if "legs" in parts:
        for s in ("L", "R"):
            info["legs"][s] = anatomy.leg(S, L, s, STYLE)
            anatomy.foot(S, L, s)
    if "head" in parts:
        hi = anatomy.head(S, L, STYLE)
        info["head"] = hi
    if "torso" in parts and "arms" in parts:
        anatomy.torso_details(S, L, STYLE)
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    if "head" in parts:
        H = info["head"]["H"]
        anatomy.eyebrows(S, H, scowl=STYLE["scowl"], thick=1.2)
        scars_and_paint(S, L, H, info["head"])
    if not gear_on:
        return S, info
    snap = S.snapshot()
    if "arms" in parts:
        for s in ("L", "R"):
            el, wr, b, Lf = forearm_frame(L, s)
            c = el + b * Lf * WRIST_CUT_T
            S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.17)), wr - 0.17, wr + 0.17))
            gear.bracer(S, snap, L, s, info["arms"][s])
    if "legs" in parts:
        for s in ("L", "R"):
            gear.boot(S, snap, L, s, info["legs"][s])
            boot_fur(S, L, s)
    if "torso" in parts:
        info["belt"] = gear.belt(S, snap, L)
        harness(S, snap, L)
        gear.torc(S, L)
    if "head" in parts:
        H = info["head"]["H"]
        ears = [Sphere(H(sx * 0.079, 0.012, -0.03), 0.034 * H.s) for sx in (1, -1)]
        gear.scalp_cap(S, snap, H, exclude=ears)
    if "legs" in parts:
        anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.016)
    return S, info


def scars_and_paint(S, L, H, hi=None):
    # --- paint zones used by the skin shader (soft masks at hi-poly vertices)
    S.paint(Union(Ellipsoid(H(0, -0.07, -0.118), H.r(0.05, 0.05, 0.032)),
                  Ellipsoid(H(0.047, -0.045, -0.095), H.r(0.02, 0.05, 0.04)),
                  Ellipsoid(H(-0.047, -0.045, -0.095), H.r(0.02, 0.05, 0.04)),
                  Ellipsoid(H(0, -0.095, -0.09), H.r(0.028, 0.02, 0.01)), k=0.01), "stubble", soft=0.012)
    hi = hi or {}
    dzm, lp, mw = hi.get("mouth_dz", 0.0), hi.get("lip", 1.0), hi.get("mouth_w", 1.0)
    S.paint(Union(Ellipsoid(H(0, -0.099, -0.0995 + dzm), H.r(0.022 * mw, 0.009, 0.0042 * lp)),
                  Ellipsoid(H(0, -0.097, -0.1078 + dzm), H.r(0.019 * mw, 0.009, 0.0052 * lp)), k=0.003), "lips",
            soft=0.0028)
    S.paint(Union(Sphere(H(0, -0.11, -0.07), 0.016 * H.s), Sphere(H(0.048, -0.07, -0.045), 0.02 * H.s),
                  Sphere(H(-0.048, -0.07, -0.045), 0.02 * H.s), Sphere(H(0.082, 0.012, -0.032), 0.03 * H.s),
                  Sphere(H(-0.082, 0.012, -0.032), 0.03 * H.s)), "blush", soft=0.02, value=0.8)
    # --- battle scars: a healed cut splitting the left brow, a slash across the right cheekbone
    fwd = V(0, 1, 0)
    scar_cut(S, [H(0.029, -0.2, 0.042), H(0.032, -0.2, 0.022), H(0.035, -0.2, 0.003)], fwd, r=0.0017)
    scar_cut(S, [H(-0.043, -0.2, -0.036), H(-0.050, -0.2, -0.058), H(-0.056, -0.2, -0.080)], fwd, r=0.0015)
    T = anatomy.Frame(L)
    for i in range(3):
        o = i * 0.024
        pts = [T(-0.035 - o * 0.4, -0.2, 1.505 - o), T(-0.09 - o * 0.4, -0.2, 1.455 - o), T(-0.15 - o * 0.3, -0.2, 1.40 - o)]
        P = anatomy.surf_chain(S, pts, [0.0016, 0.0024, 0.0014], depth=0.0016, k=0.0014)
        S.paint(Chain(list(P), 0.0048), "scar", soft=0.0035)
    arm_scar = [L["shoulder_L"] + V(0.1, -0.06, -0.05), L["shoulder_L"] + V(0.13, -0.07, -0.1)]
    P = anatomy.surf_chain(S, arm_scar, 0.0014, depth=0.0008, k=0.001)
    S.paint(Chain(list(P), 0.003), "scar", soft=0.003)


def scar_cut(S, raw, d, r=0.0016, depth=0.00035, paint_r=0.0022):
    """Healed cut: ray-traced onto the surface (robust in the brow/cheek folds), a shallow groove + pale paint."""
    P = anatomy.surface_hit(S, raw, d)
    P, _ = anatomy.resample(P, step=0.003)
    P = anatomy.surface_hit(S, P - np.asarray(d) * 0.03, d)
    N = S.grad(P)
    S.sub(Chain(list(P + N * (r - depth)), r), 0.0008)
    S.paint(Chain(list(P), paint_r), "scar", soft=0.0025)


def harness(S, snap, L):
    """X-harness: two straps crossing on sternum and between the shoulder blades, bronze medallion."""
    T = anatomy.Frame(L)
    for sx in (1, -1):
        pts = [T(sx * 0.125, -0.3, 1.075), T(sx * 0.07, -0.3, 1.23), T(0, -0.3, 1.365), T(-sx * 0.075, -0.3, 1.47),
               T(-sx * 0.125, -0.12, 1.585), T(-sx * 0.14, 0.0, 1.66), T(-sx * 0.13, 0.1, 1.6),
               T(-sx * 0.075, 0.3, 1.47), T(0, 0.3, 1.37), T(sx * 0.07, 0.3, 1.23), T(sx * 0.125, 0.3, 1.075)]
        gear.strap(S, snap, pts, width=0.054, thick=0.0085, mat="leather_dark")
    gear.medallion(S, T(0, -0.3, 1.368), r=0.044)
    gear.medallion(S, T(0, 0.3, 1.37), r=0.034)
    for sx in (1, -1):
        gear.studs_on(S, [T(sx * 0.1, -0.3, 1.18), T(-sx * 0.11, -0.3, 1.51), T(-sx * 0.1, 0.3, 1.52)], 0.0052, lift=0.007)


def hand_sculpt(L, side):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    ai = anatomy.arm(S, L, side, STYLE)
    anatomy.hand(S, L, side, "grip", STYLE)          # r2: both fists close on the two-hand grip
    anatomy.hand_details(S, L, side)
    sc = L["P"]["hand"] / 0.2
    W = L["wrist_" + side]
    h, n = L["hand_h_" + side], L["hand_n_" + side]
    S.paint(Sphere(W + h * 0.1 * sc - n * 0.012, 0.035), "blush", soft=0.02, value=0.6)
    el, wr, b, Lf = forearm_frame(L, side)
    S.inter(HalfSpace(el + b * Lf * HAND_CUT_T, -b))
    return S, ai


def kilt_parts(L):
    S, info = gear.kilt_sculpt(L, MATERIALS, flap_mat="leather_dark", strip_mats=("cloth",),
                               **{k: KILT_P[k] for k in ("top_z", "hem_z", "r_top",
                                                                                          "r_hem", "squash")})
    # wolf-pelt band over the kilt top, hanging from under the belt
    ring = surface_ring(S, V(0, 0.016, 0), 0.996, 0.24, n=72)
    gear.fur_band(S, ring, n=46, rows=3, length=(0.05, 0.075), width=(0.024, 0.032), droop=0.58, seed=7,
                  k=0.008, row_dz=-0.017, row_out=0.008, curl=0.3, roll=0.022)
    return S, info


def surface_ring(S, c, z, r, n=64):
    """ring_fn(a) sampling points projected onto sculpt S around a vertical axis at height z (a=0 front)."""
    ang = np.linspace(0, 2 * math.pi, n, endpoint=False)
    raw = np.array([V(c[0] + math.sin(a) * r, c[1] - math.cos(a) * r, z) for a in ang])
    P = S.project(raw, offset=0.0)
    P[:, 2] = z
    P = S.project(P, offset=0.0)
    N = S.grad(P)
    N[:, 2] *= 0.3
    N = N / np.linalg.norm(N, axis=1, keepdims=True)

    def fn(a):
        f = (a % (2 * math.pi)) / (2 * math.pi) * n
        i0 = int(f) % n
        i1 = (i0 + 1) % n
        t = f - int(f)
        return P[i0] * (1 - t) + P[i1] * t, norm(N[i0] * (1 - t) + N[i1] * t)
    return fn


def boot_fur(S, L, side, top=0.45):
    an = L["ankle_" + side]
    # start the ring just outside this boot: a wide ring projects tufts onto the OTHER leg (fused shins)
    ring = surface_ring(S, V(an[0], an[1] + 0.004, 0), top + 0.004, 0.075, n=48)
    gear.fur_band(S, ring, n=24, rows=2, length=(0.038, 0.055), width=(0.02, 0.026), droop=0.5,
                  seed=31 if side == "L" else 32, k=0.007, row_dz=-0.013, row_out=0.006, curl=0.3, roll=0.016)


# ============================================================================ hair
# r2: flatter, more numerous clumps hugging the scalp (r1's thick tubes floated off the crown = "rubber tubes")
MANE = dict(n=78, width=(0.056, 0.086), thick=(0.016, 0.024), clearance=0.40, clear_add=0.008, arc_steps=10,
            fall_steps=22, fall_bend=0.3, wave=0.011, wave_len=0.22)


def mane_clumps(S_body, L, H, seed=11):
    """Heavy black mane, swept back: every clump arcs over the skull to the nape / behind the ears, then falls to
    the shoulder blades; temple locks fall behind the ears onto the traps and frame the face. Deterministic."""
    hc = H(0, 0.012, -0.006)

    def azel(d):
        return math.atan2(d[0], -d[1]), math.asin(max(-1.0, min(1.0, d[2])))

    def region(d):
        az, el = azel(d)
        el, azd = math.degrees(el), abs(math.degrees(az))
        el_min = -30.0 + 62.0 * ((1 + math.cos(az)) / 2) ** 1.4     # hairline: high at the brow, low at the nape
        if abs(azd - 90) < 24 and el < 18:                          # ears stay free
            return False
        return el > el_min

    def exit_fn(d):
        az, el = azel(d)
        sgn = 1.0 if d[0] >= 0 else -1.0
        azd = abs(az)
        if math.radians(40) < azd < math.radians(100) and el < math.radians(26):
            az1, el1 = sgn * math.radians(108), math.radians(-34)          # temple locks: behind the ear
        else:
            az1 = sgn * (azd + (math.pi - azd) * 0.72)
            el1 = min(el - math.radians(12), math.radians(-30))
        return V(math.sin(az1) * math.cos(el1), -math.cos(az1) * math.cos(el1), math.sin(el1))

    def length_fn(d):
        az, el = azel(d)
        front = (1 + math.cos(az)) / 2
        return 0.36 + 0.24 * front ** 0.8 + 0.06 * max(0.0, d[2])

    return hair.groom_swept(S_body, hc, region, exit_fn, length_fn, seed=seed, **MANE)


def mane_sculpts(S_body, L, H, seed=11):
    clumps = mane_clumps(S_body, L, H, seed)
    S_hi, meta = hair.clump_sculpt(clumps, mat="mane", materials=["mane"], detail="hi", grooves=3, seed=seed,
                                   root_thick=0.4)
    S_lo, _ = hair.clump_sculpt(clumps, mat="mane", materials=["mane"], detail="lo", seed=seed, root_thick=0.4)
    paths = [c["path"] for c in clumps]
    return S_hi, S_lo, meta, paths, ["mane"] * len(paths)


def mane_attrs(ob, meta, uv=False):
    """along / lock_id / lateral / flow_* point attributes (+ 'lockuv' strand UVs on the HI mesh)."""
    P = meshutil.get_verts(ob)
    A = hair.path_attrs(P, meta)
    for k in ("along", "lock_id", "lateral"):
        meshutil.add_float_attr(ob, k, A[k].astype(np.float32))
    for i, ax in enumerate("xyz"):
        meshutil.add_float_attr(ob, "flow_" + ax, A["flow"][:, i].astype(np.float32))
    if uv:
        me = ob.data
        lv = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", lv)
        u = (A["lateral"] + 1) * 0.5
        v = A["along"] * 4.0
        uvl = me.uv_layers.new(name="lockuv")
        uvl.data.foreach_set("uv", np.stack([u[lv], v[lv]], axis=1).astype(np.float32).ravel())
    return A


# ============================================================================ previews
MAT_COLORS = {"skin": (0.62, 0.42, 0.30), "eye": (0.9, 0.9, 0.88), "nail": (0.75, 0.55, 0.5), "brow": (0.05, 0.04, 0.035),
              "hair": (0.06, 0.05, 0.045), "leather": (0.35, 0.2, 0.1), "leather_dark": (0.16, 0.09, 0.05),
              "fur": (0.35, 0.28, 0.2), "bronze": (0.75, 0.5, 0.22), "iron": (0.3, 0.3, 0.32), "cloth": (0.4, 0.1, 0.08),
              "sole": (0.1, 0.07, 0.05)}


def assign_clay(ob, mat_of_vertex, materials):
    for mname in materials:
        ob.data.materials.append(preview.clay_material("clay_" + mname, MAT_COLORS.get(mname, (0.5, 0.5, 0.5))))
    me = ob.data
    pv = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", pv)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    me.polygons.foreach_set("material_index", mat_of_vertex[lv[pv]].astype(np.int32))


def mesh_sculpt(S, name, h, lo=None, hi=None, clay=True):
    v, q, t = sdf.polygonize(S, h, lo, hi)
    ob = meshutil.mesh_from_numpy(name, v, q, t)
    if clay:
        d, mat, paints = S.eval_points(v)
        assign_clay(ob, mat, S.materials)
    return ob


def clay_single(ob, mname):
    ob.data.materials.append(preview.clay_material("clay_" + mname, MAT_COLORS[mname]))


def preview_main(args):
    meshutil.clear_scene()
    L = rig.landmarks(BRANN)
    t0 = time.time()
    out = args.out or DEV
    os.makedirs(out, exist_ok=True)
    preview.setup_workbench("MATERIAL")
    if args.preview in ("body", "full"):
        S, info = body_sculpt(L, gear_on=(args.preview == "full"))
        mesh_sculpt(S, "body", args.h or 0.004)
        if args.preview == "full":
            for s in ("L", "R"):
                Sh, _ = hand_sculpt(L, s)
                w = L["wrist_" + s]
                mesh_sculpt(Sh, "hand_" + s, 0.0012, w - 0.16, w + 0.16)
            Sk, kinfo = kilt_parts(L)
            mesh_sculpt(Sk, "kilt", 0.003)
            _, S_lo, _, _, _ = mane_sculpts(S, L, info["head"]["H"])
            clay_single(mesh_sculpt(S_lo, "mane", 0.003, clay=False), "hair")
        views = [dict(target=(0, 0, 1.0), ortho=2.25, yaw=y, dist=6) for y in (0, 35, 90, 180)]
        preview.render_views(os.path.join(out, args.preview + ".png"), views, res=(620, 1000))
        if args.preview == "full":
            views = [dict(target=(0, -0.02, 1.62), ortho=0.75, yaw=y, dist=4, pitch=4) for y in (0, 35, 150)]
            preview.render_views(os.path.join(out, "full_upper.png"), views, res=(800, 800))
    elif args.preview in ("head", "face"):
        S, info = body_sculpt(L, gear_on=False, parts=("torso", "head"))
        if args.preview == "face":     # with scalp cap, closer and sharper
            gear.scalp_cap(S, S.snapshot(), info["head"]["H"],
                           exclude=[Sphere(info["head"]["H"](sx * 0.079, 0.012, -0.03), 0.034) for sx in (1, -1)])
        mesh_sculpt(S, "head", args.h or (0.0008 if args.preview == "face" else 0.0012), V(-0.14, -0.16, 1.60),
                    V(0.14, 0.16, 2.01))
        views = [dict(target=(0, -0.02, 1.82), ortho=0.30, yaw=y, dist=3, pitch=2) for y in (0, 30, 90)]
        preview.render_views(os.path.join(out, args.preview + ".png"), views, res=(800, 900))
    elif args.preview == "hands":
        for s in ("L", "R"):
            Sh, _ = hand_sculpt(L, s)
            w = L["wrist_" + s]
            mesh_sculpt(Sh, "hand_" + s, args.h or 0.0007, w - 0.16, w + 0.16)
        views = []
        for s in ("R", "L"):
            c = L["knuckle_" + s]
            for (yaw, pitch) in ((0, 10), (0, 70), (90 if s == "L" else -90, 5), (180, 10)):
                views.append(dict(target=tuple(c), ortho=0.26, yaw=yaw, dist=2, pitch=pitch))
        preview.render_views(os.path.join(out, "hands.png"), views, res=(420, 420))
    print(f"[brann] preview {args.preview} done in {time.time()-t0:.1f}s")


# ============================================================================ full build
# Value / hue hierarchy (round 2): the r1 palette was one tan value head to toe (tan skin, tan leather kilt, the
# mane greyed under its sheen). AgX desaturates and lifts, so albedos are pushed. Target albedo luma (sRGB,
# Rec.709): skin ~43% > crimson tartan kilt ~27% > near-black leather ~16% > blue-black mane ~6%; bronze + steel
# are the bright metal accents, wolf fur a neutral grey-brown.
PAL = dict(
    skin=shaders.srgb(178, 96, 54), skin_warm=shaders.srgb(188, 78, 50), skin_cool=shaders.srgb(112, 70, 54),
    lips=shaders.srgb(128, 58, 48), scar=shaders.srgb(188, 118, 96), skin_rough=0.62,
    iris=shaders.srgb(92, 132, 150), sclera=shaders.srgb(226, 216, 204),
    hair=shaders.srgb(13, 15, 22), hair_tip=shaders.srgb(24, 24, 32), hair_hi=shaders.srgb(58, 70, 96),
    hair_sheen=0.15, hair_rough=0.8, hair_hi_amt=0.08,        # engine rim light turned a glossier mane into a white cap
    brow=shaders.srgb(20, 16, 16), brow_hi=shaders.srgb(40, 36, 36), brow_hi_amt=0.05, brow_rough=0.86,
    leather=shaders.srgb(38, 26, 20), leather_worn=shaders.srgb(72, 52, 40),
    leather_dark=shaders.srgb(22, 17, 15), leather_dark_worn=shaders.srgb(50, 40, 34),
    fur=shaders.srgb(84, 76, 66), fur_root=shaders.srgb(30, 26, 24), fur_tip=shaders.srgb(140, 130, 114),
    bronze=shaders.srgb(214, 150, 70), bronze_patina=shaders.srgb(70, 136, 112), bronze_patina_amt=0.6,
    iron=shaders.srgb(112, 112, 118), iron_patina=shaders.srgb(96, 60, 40),
    cloth=shaders.srgb(112, 14, 22), sole=shaders.srgb(30, 22, 18),
    # crimson tartan sett (period, stripes (offset, width, rgb)) in metres
    # (r2 build 1 rendered the kilt at the SAME value as the skin under AgX -> kilt pushed ~0.6x in linear)
    tartan=(0.092, [(0.0, 0.024, shaders.srgb(60, 8, 14)), (0.0, 0.0065, shaders.srgb(14, 12, 16)),
                    (0.046, 0.0055, shaders.srgb(18, 40, 30)), (0.07, 0.0036, shaders.srgb(150, 112, 52))]),
)
HEAD_BOX = (V(-0.145, -0.155, 1.672), V(0.145, 0.16, 2.01))
HAIR_CHAIN = 3
FACE_DENSITY = 3.0          # texel density of the face chart relative to the body
KILT_CHAIN = 3
KILT_P = dict(top_z=1.055, hem_z=0.64, r_top=0.178, r_hem=0.272, squash=0.84)
LEG_GAP_TOP = 0.89          # legs are cut apart below this (hidden by the kilt); the crotch above goes to hips


def crotch_mask(P):
    """Crotch bridge between the legs -> hips (never thigh_L <-> thigh_R across the seam)."""
    ax = np.clip(1.0 - (np.abs(P[:, 0]) - 0.03) / 0.04, 0, 1)
    az = np.clip(1.0 - np.abs(P[:, 2] - (LEG_GAP_TOP + 0.02)) / 0.09, 0, 1)
    return ax * az * (np.abs(P[:, 1]) < 0.2)


def kilt_angular_blend(P, names, W):
    """The engine drives kilt_F/L/B/R_* as independent spring chains (src/anim/springs.js, limit 58 deg), so
    hard per-chain weights tear the skirt between neighbouring chains (build r2#1 heavy: 12 stretched tris
    kilt_B_1 <-> kilt_R_1). Keep each vertex's per-LEVEL chain weight, but share it between the two nearest
    chains with a cosine partition around the kilt axis (1 on a chain, 0.5/0.5 half-way between two)."""
    k = KILT_P
    theta = np.arctan2(P[:, 0], -(P[:, 1] - 0.016) / k["squash"])
    sides = (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2))
    part = np.stack([np.maximum(np.cos(theta - a), 0.0) ** 1.6 for _, a in sides], axis=1)
    part /= np.maximum(part.sum(axis=1, keepdims=True), 1e-6)
    W = W.copy()
    for i in range(1, KILT_CHAIN + 1):
        cols = [names.index(f"kilt_{sd}_{i}") if f"kilt_{sd}_{i}" in names else -1 for sd, _ in sides]
        if min(cols) < 0:
            continue
        level = W[:, cols].sum(axis=1)
        W[:, cols] = level[:, None] * part
    return W


def kilt_chain_points(n=KILT_CHAIN):
    k = KILT_P
    out = {}
    for side, a in (("F", 0.0), ("L", math.pi / 2), ("B", math.pi), ("R", -math.pi / 2)):
        pts = []
        for i in range(n + 1):
            f = i / n
            z = (k["top_z"] - 0.03) + ((k["hem_z"] + 0.02) - (k["top_z"] - 0.03)) * f
            r = k["r_top"] + (k["r_hem"] - k["r_top"]) * (f * 0.9)
            pts.append(V(math.sin(a) * r, 0.016 - math.cos(a) * r * k["squash"], z))
        out[side] = pts
    return out


def hair_chain_points(paths, kinds, H, n=HAIR_CHAIN):
    back = [hair.resample_path(p, n + 1) for p, k in zip(paths, kinds)
            if k == "mane" and abs(p[0][0]) < 0.045 and p[0][1] > H(0, 0.02, 0)[1]]
    if len(back) >= 2:
        pts = np.mean(np.array(back), axis=0)
        pts[:, 0] = 0.0
        pts[0] = H(0, 0.075, -0.02)
        pts[1:] = pts[1:] - np.array([0, 0.02, 0])       # sit just inside the mane volume
        return [V(p) for p in pts]
    return [H(0, 0.075, -0.02), H(0, 0.12, -0.16), H(0, 0.14, -0.28), H(0, 0.14, -0.40)][:n + 1]


def head_mask(L, H):
    """1 above the jaw/occiput line (rigid head), soft 2 cm transition into the neck."""
    a = H(0, -0.09, -0.142)     # under the chin
    b = H(0, 0.10, -0.085)      # base of the occiput
    nrm = norm(np.cross(V(1, 0, 0), b - a))
    if nrm[2] < 0:
        nrm = -nrm
    c = (a + b) * 0.5

    def fn(P):
        s = (P - c) @ nrm
        return np.clip((s + 0.004) / 0.02, 0, 1) * (np.linalg.norm(P - H(0, 0, 0), axis=1) < 0.24 * H.s)
    return fn


def wrist_mask(L, side, beyond=0.012, soft=0.02):
    w = L["wrist_" + side]
    h = L["hand_h_" + side]

    def fn(P):
        near = np.linalg.norm(P - w, axis=1) < 0.16          # a half-space alone would grab the legs too
        return np.clip(((P - w) @ h - beyond) / soft + 0.5, 0, 1) * near
    return fn


def uv_regions(arm, names):
    """Chart config per dominant bone: tube regions get a meridian cut on their hidden side."""
    M = np.array(arm.matrix_world)
    cfg = {}
    for i, nm in enumerate(names):
        b = arm.data.bones[nm]
        h = M[:3, :3] @ np.array(b.head_local) + M[:3, 3]
        t = M[:3, :3] @ np.array(b.tail_local) + M[:3, 3]
        sx = 1.0 if nm.endswith("_L") else -1.0
        ref, dens, axis, halves = None, 1.0, (h, t), False
        if nm in ("hips", "spine", "chest", "neck"):
            axis, ref, halves = (V(0, 0, h[2]), V(0, 0, t[2])), V(1, 0, 0), True     # front/back, seams at flanks
        elif nm == "head":
            axis, ref, dens, halves = (V(0, 0.01, h[2]), V(0, 0.01, t[2])), V(1, 0, 0), 1.9, True   # seams behind ears
        elif nm.startswith(("upperarm", "forearm")):
            a = math.radians(40)
            ref = V(-sx * math.sin(a), 0.15, -math.cos(a))
        elif nm.startswith(("thigh", "shin")):
            ref = V(-sx, 0.35, 0)
        elif nm.startswith(("foot", "toe")):
            ref = V(0, 0, -1)
        cfg[i] = dict(axis=axis, ref=ref, density=dens, halves=halves)
    return cfg


def skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, mane_lo):
    Pb = meshutil.get_verts(body_lo)
    _, vm, _ = S.eval_points(Pb)
    metal_ids = [S.materials.index(m) for m in ("bronze", "iron") if m in S.materials]
    rigid = skin.rigid_components(body_lo, np.isin(vm, metal_ids))
    body_bones = [b.name for b in arm.data.bones if b.use_deform and not b.name.startswith(("kilt_", "hair_"))]
    body_W = skin.skin(body_lo, arm, method=args.skin, S=S, allowed=body_bones,
                       overrides=[(head_mask(L, H), "head"), (crotch_mask, "hips")] +
                                 [(wrist_mask(L, s, beyond=0.03), "hand_" + s) for s in ("L", "R")],
                       rigid=rigid)
    for s in ("L", "R"):
        skin.skin(hands_lo[s], arm, method="sdf", allowed=["forearm_" + s, "hand_" + s],
                  overrides=[(wrist_mask(L, s), "hand_" + s)], smooth=2)
    kilt_bones = ["hips", "thigh_L", "thigh_R"] + [b.name for b in arm.data.bones if b.name.startswith("kilt_")]
    top = KILT_P["top_z"]

    def kilt_post(P, names, W):
        # chain weights only from hips + kilt_* (no distance-based thigh grab), then blend the hem to the thighs
        for t in ("thigh_L", "thigh_R"):
            W[:, names.index(t)] = 0.0
        W = kilt_angular_blend(P, names, W)
        W, _ = skin.top_k(W, 4)
        return skin.skirt_weights(P, names, W, top, KILT_P["hem_z"], share=0.55, seam=0.12)
    skin.skin(kilt_lo, arm, method="sdf", allowed=kilt_bones, power=3.0, post=kilt_post,
              overrides=[(lambda P: np.clip((P[:, 2] - (top - 0.07)) / 0.05, 0, 1), "hips")])
    hair_bones = ["head", "neck", "chest"] + [b.name for b in arm.data.bones if b.name.startswith("hair_")]
    along = np.empty(len(mane_lo.data.vertices), np.float32)
    mane_lo.data.attributes["along"].data.foreach_get("value", along)
    skin.skin(mane_lo, arm, method="sdf", allowed=hair_bones, power=3.0,
              overrides=[(lambda P, a=along: np.clip((0.16 - a) / 0.08, 0, 1), "head")])
    return body_W


def build(args):
    T0 = time.time()
    fast = args.fast
    res = 1024 if fast else 2048
    h_body, h_head, h_hand, h_kilt = (0.004, 0.0016, 0.0012, 0.003) if fast else (0.0021, 0.0009, 0.0007, 0.0016)
    h_mane = 0.0018 if fast else 0.0011
    meshutil.clear_scene()
    device = pipeline.setup_cycles(args.device)
    L = rig.landmarks(BRANN)
    report = {"asset": "hero_brann", "device": device, "fast": fast, "res": res, "parts": {}}

    # ---------------------------------------------------------------- sculpts
    t = time.time()
    S, info = body_sculpt(L)
    H = info["head"]["H"]
    Sk, kinfo = kilt_parts(L)
    Sh = {s: hand_sculpt(L, s)[0] for s in ("L", "R")}
    Sm_hi, Sm_lo, mane_meta, paths, kinds = mane_sculpts(S, L, H)
    pipeline.log(f"sculpts ready {time.time()-t:.1f}s ({len(S.ops)} body ops)")

    # ---------------------------------------------------------------- rig
    L["hair_chain_pts"] = hair_chain_points(paths, kinds, H)
    L["kilt_chain_pts"] = kilt_chain_points()
    arm = rig.build_armature(L, "hero_brann", hair_chain=HAIR_CHAIN, kilt_chain=KILT_CHAIN)

    # ---------------------------------------------------------------- HI bake sources
    t = time.time()
    if args.stage == "skin":
        body_hi = head_hi = kilt_hi = mane_hi = None
        hands_hi = {"L": None, "R": None}
    else:
        body_hi = pipeline.sculpt_mesh(S, "body_hi", h_body, drop_box=HEAD_BOX)
        head_hi = pipeline.sculpt_mesh(S, "head_hi", h_head, HEAD_BOX[0] - 0.012, HEAD_BOX[1] + 0.012, keep_box=HEAD_BOX)
        hands_hi = {}
        for s in ("L", "R"):
            w = L["wrist_" + s]
            hands_hi[s] = pipeline.sculpt_mesh(Sh[s], "hand_hi_" + s, h_hand, w - 0.17, w + 0.17)
        kilt_hi = pipeline.sculpt_mesh(Sk, "kilt_hi", h_kilt)
        mane_hi = pipeline.sculpt_mesh(Sm_hi, "mane_hi", h_mane)
        mane_attrs(mane_hi, mane_meta, uv=True)
    pipeline.log(f"HI meshes {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- LO game meshes
    t = time.time()
    hb0, hb1 = HEAD_BOX

    def in_head(P):
        return np.all((P >= hb0) & (P <= hb1), axis=1)
    body_lo = pipeline.lowpoly(S, "body_lo", 0.0048 if not fast else 0.006, args.body_tris,
                               regions=[(in_head, args.head_tris)])
    hands_lo = {}
    for s in ("L", "R"):
        w = L["wrist_" + s]
        hands_lo[s] = pipeline.lowpoly(Sh[s], "hand_lo_" + s, 0.0018, args.hand_tris, w - 0.17, w + 0.17,
                                       symmetry=False)
    kilt_lo = pipeline.lowpoly(Sk, "kilt_lo", 0.0028, args.kilt_tris)
    mane_lo = pipeline.lowpoly(Sm_lo, "mane_lo", 0.003, args.mane_tris)
    mane_attrs(mane_lo, mane_meta)
    los = [body_lo, hands_lo["L"], hands_lo["R"], kilt_lo, mane_lo]
    his = [body_hi, head_hi, hands_hi["L"], hands_hi["R"], kilt_hi, mane_hi]
    for o in los:
        report["parts"][o.name] = meshutil.tri_count(o)
    report["tris_total"] = int(sum(report["parts"].values()))
    pipeline.log(f"LO meshes {time.time()-t:.1f}s tris={report['parts']} total={report['tris_total']}")

    # ---------------------------------------------------------------- skin (before UV: charts follow bones)
    t = time.time()
    body_W = skin_all(args, arm, L, H, S, body_lo, hands_lo, kilt_lo, mane_lo)
    pipeline.log(f"skinning {time.time()-t:.1f}s")
    if args.stage == "skin":
        for o in los:
            skin.debug_dominant(o)
            Pq = meshutil.get_verts(o, world=True)
            Eq = pipeline.edges_of(o)
            cr = (Pq[Eq[:, 0], 0] * Pq[Eq[:, 1], 0] < 0) & (Pq[Eq[:, 0], 2] < LEG_GAP_TOP)
            if cr.any():
                zz = Pq[Eq[cr, 0], 2]
                pipeline.log(f"[midline] {o.name}: {int(cr.sum())} edges cross x=0 below the gap top; z "
                             f"{np.percentile(zz, [0, 25, 50, 75, 100]).round(3).tolist()}")
        for o in los:
            pipeline.strip_for_export(o)
        body = meshutil.join(los, "hero_brann_mesh")
        skin.debug_dominant(body)
        qa = skin.stretch_report(body, arm)
        pipeline.log("stretch QA: " + json.dumps(qa))
        pipeline.export_glb(args.out or os.path.join(ROOT, "progress", "tmp", "brann_skin_test.glb"), [arm, body],
                            scene_name="hero_brann")
        return

    # ---------------------------------------------------------------- UV atlas
    t = time.time()
    names, W = body_W
    vdom = np.argmax(W, axis=1)
    me = body_lo.data
    ls = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", lt)
    # face region = most common dominant bone among its corners
    fl = np.stack([vdom[lv[ls + k]] for k in range(3)], axis=1)
    freg = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
    freg = pipeline.clean_labels(freg, pipeline.face_adjacency(body_lo), iters=3)
    cfg = uv_regions(arm, names)
    # the FACE gets its own chart at ~3x body texel density (close-ups, cut-ins); the scalp half under the mane
    # gets less
    hid = names.index("head")
    Cf = pipeline.face_centers(body_lo)
    face_id = len(names)
    freg = np.where((freg == hid) & (Cf[:, 1] < H(0, -0.012, 0)[1]) & (Cf[:, 2] > H(0, 0, -0.16)[2]), face_id, freg)
    freg = pipeline.clean_labels(freg, pipeline.face_adjacency(body_lo), iters=2)
    cfg[face_id] = dict(axis=None, ref=None, density=FACE_DENSITY)
    cfg[hid].update(density=1.1, ref=V(0, 1, 0), halves=False)
    pipeline.region_unwrap(body_lo, freg, cfg)
    for s in ("L", "R"):
        o = hands_lo[s]
        allf = np.ones(len(o.data.polygons), bool)
        pipeline.smart_project_faces(o, allf, angle=66.0)
        pipeline.normalize_density(o, allf, 1.3)
    allf = np.ones(len(kilt_lo.data.polygons), bool)
    pipeline.smart_project_faces(kilt_lo, allf, angle=70.0)
    pipeline.normalize_density(kilt_lo, allf, 0.85)
    allf = np.ones(len(mane_lo.data.polygons), bool)
    pipeline.smart_project_faces(mane_lo, allf, angle=78.0)
    pipeline.normalize_density(mane_lo, allf, 0.72)
    fill = pipeline.pack_atlas_shape(los, margin_px=6 if not fast else 4, res=res)
    report["uv_fill"] = fill
    pipeline.log(f"UV atlas {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- bake materials + painting
    t = time.time()
    extra = dict(eyes=info["head"]["eyes"], eye_r=info["head"]["eye_r"], z_knee=L["knee_L"][2],
                 z_chest=L["chest"][2], hair_band_z=H(0, 0, 0.07)[2])
    for o, Sx in ((body_hi, S), (head_hi, S), (hands_hi["L"], Sh["L"]), (hands_hi["R"], Sh["R"]), (kilt_hi, Sk)):
        shaders.assign_bake_materials(o, Sx.materials)
        shaders.paint_mesh(o, Sx.materials, L, PAL, extra)
    shaders.assign_bake_materials(mane_hi, ["mane"])
    shaders.paint_mesh(mane_hi, ["mane"], L, PAL, extra)
    pipeline.log(f"painting {time.time()-t:.1f}s")

    # ---------------------------------------------------------------- bake
    t = time.time()
    jobs = [(body_lo, [body_hi, head_hi], 0.012, 0.03),
            (hands_lo["L"], [hands_hi["L"]], 0.006, 0.014),
            (hands_lo["R"], [hands_hi["R"]], 0.006, 0.014),
            (kilt_lo, [kilt_hi], 0.005, 0.012),
            (mane_lo, [mane_hi], 0.006, 0.016)]
    B = pipeline.Baker(res, jobs, shaders.set_pass, los, his)
    spp = dict(albedo=4, prm=2, ao=32 if fast else 64, normal=4 if fast else 8)
    maps = B.run(passes=[("albedo", "EMIT", spp["albedo"]), ("prm", "EMIT", spp["prm"]),
                         ("ao", "EMIT", spp["ao"]), ("normal", "NORMAL", spp["normal"])])
    pipeline.log(f"bake total {time.time()-t:.1f}s")
    tex = composite_maps(maps, res)
    report["textures"] = {k: [res, res] for k in tex}

    # ---------------------------------------------------------------- final material, join, export
    mat = pipeline.final_material("M_hero_brann", tex["albedo"], tex["normal"], tex["orm"])
    for o in los:
        o.data.materials.clear()
        o.data.materials.append(mat)
        pipeline.strip_for_export(o)
    for o in his:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    body = meshutil.join(los, "hero_brann_mesh")
    body.data.polygons.foreach_set("material_index", np.zeros(len(body.data.polygons), np.int32))
    meshutil.select_only([body])
    report["tris_total"] = meshutil.tri_count(body)
    qa = skin.stretch_report(body, arm)
    report["stretch_qa"] = qa
    pipeline.log("stretch QA: " + ", ".join(f"{k}: bad {v['bad']} soft {v['soft']}" for k, v in qa.items()))
    out = os.path.join(OUT_MODELS, "hero_brann.glb")
    pipeline.export_glb(out, [arm, body], scene_name="hero_brann")
    report["glb"] = out
    report["glb_mb"] = os.path.getsize(out) / 1e6
    report["seconds"] = time.time() - T0
    pipeline.write_json(os.path.join(HERE, "out", "brann_report.json"), report)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "progress", "tmp", "brann_build.blend"))
    pipeline.log(f"DONE hero_brann in {report['seconds']:.0f}s -> {out} ({report['glb_mb']:.1f} MB, "
                 f"{report['tris_total']} tris)")
    if not args.no_weapon:
        import build_weapon_grudgebrand
        importlib.reload(build_weapon_grudgebrand)
        build_weapon_grudgebrand.build(args)


def composite_maps(maps, res):
    """Baked passes -> final atlas images (albedo sRGB with tinted AO/cavity, ORM, normal); dilated seams."""
    alb = maps["albedo"]
    cov = alb[..., 3] > 0.5
    ao = maps["ao"]
    ao_s = np.clip(ao[..., 0], 0, 1)
    ao_l = np.clip(ao[..., 1], 0, 1)
    prm = maps["prm"]
    nrm = maps["normal"]
    rgb = alb[..., :3].copy()
    occl = np.clip(1.0 - 0.75 * (1 - ao_s) - 0.45 * (1 - ao_l), 0, 1)[..., None]
    tint = np.array([0.52, 0.30, 0.24])
    rgb = rgb * (tint + (1 - tint) * occl)
    orm = np.stack([np.clip(0.35 + 0.65 * ao_l * (0.5 + 0.5 * ao_s), 0, 1), np.clip(prm[..., 0], 0.04, 1),
                    np.clip(prm[..., 1], 0, 1)], axis=-1)
    n3 = nrm[..., :3]
    rgb = pipeline.dilate(rgb, cov, 16)
    orm = pipeline.dilate(orm, cov, 16)
    n3 = pipeline.dilate(n3, cov, 16)
    # Blender images are bottom-up; keep as-is (UVs match Blender convention and the exporter flips nothing)
    tex = {}
    tex["albedo"] = pipeline.save_png(rgb, os.path.join(OUT_TEX, "brann_albedo.png"), "brann_albedo", "sRGB",
                                      linear_to_srgb=True)
    tex["orm"] = pipeline.save_png(orm, os.path.join(OUT_TEX, "brann_orm.png"), "brann_orm", "Non-Color")
    tex["normal"] = pipeline.save_png(n3, os.path.join(OUT_TEX, "brann_normal.png"), "brann_normal", "Non-Color")
    return tex


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=None)
    ap.add_argument("--h", type=float, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--no-weapon", action="store_true")
    ap.add_argument("--weapon-only", action="store_true")
    ap.add_argument("--stage", default="all")
    ap.add_argument("--device", default="AUTO", help="AUTO|OPTIX|CUDA|CPU (bake)")
    ap.add_argument("--skin", default="sdf", help="sdf|heat (body weights; heat falls back to sdf)")
    ap.add_argument("--body-tris", type=int, default=16400)
    ap.add_argument("--head-tris", type=int, default=6600)
    ap.add_argument("--hand-tris", type=int, default=1150)
    ap.add_argument("--kilt-tris", type=int, default=3000)
    ap.add_argument("--mane-tris", type=int, default=5600)
    ap.add_argument("--save-blend", action="store_true")
    return ap.parse_args(argv)


if __name__ == "__main__":
    a = parse()
    if a.preview:
        preview_main(a)
    else:
        build(a)
