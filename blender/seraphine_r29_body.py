"""Seraphine r29 "Amazon": BODY + FACE role module (Claude Fable 5.1). Owner: the body role (brief
docs/notes/c2-briefs/amazon_seraphine_body_face.txt). Imports the lead's interface (seraphine_r29_team) read-only.

Modes (numpy, no Blender slot; PY=~/kca-assets/venv/bin/python -I):
  fit      base body (CC0 Human Base Meshes female realistic cage) -> R.joints (per-bone affine warp with provisional
           weights) -> proportion sculpt (CONFIG targets) -> parts/body/body.npz (+ eyes) + tiles + body_ckpt.json
  measure  print the blueprint metrics for parts/body/body.npz (same slices as plan/measure_glb.py)
Modes (bpy, only through tools/blender-run.mjs):
  export-uv  append the base mesh data ONLY from the CC0 bundle (factory startup, no auto-run) and export its UV layer +
             seams -> ~/kca-assets/human-base-meshes/export/GEO-body_female_realistic.uv.npz
  bake       game mesh (head subdivided once) + hi-res muscle sculpt (subsurf 2 + displacement) -> baked normal/AO tiles
"""
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

EXPORT_DIR = os.path.expanduser("~/kca-assets/human-base-meshes/export")
SRC = os.path.join(EXPORT_DIR, "GEO-body_female_realistic.npz")
SRC_UV = os.path.join(EXPORT_DIR, "GEO-body_female_realistic.uv.npz")
BUNDLE = os.path.expanduser("~/kca-assets/human-base-meshes/extract/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend")
TEAM = os.path.join(ROOT, "progress", "tmp", "seraphine_r29")
PARTS = os.path.join(TEAM, "parts", "body")
WORK = os.path.join(TEAM, "body")


def log(*a):
    print("[r29-body]", *a, flush=True)


# ================================================================================ bpy: export the base mesh UVs
def export_uv_from_bundle():
    import bpy
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    name = "GEO-body_female_realistic"
    with bpy.data.libraries.load(BUNDLE, link=False) as (data_from, data_to):
        assert name in data_from.meshes, "bundle mesh not found"
        data_to.meshes = [name]
    me = bpy.data.meshes[name]
    out = {}
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co)
    out["co"] = co.reshape(-1, 3)
    ls = np.empty(len(me.polygons), np.int32); lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls); me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
    out.update(loop_start=ls, loop_total=lt, loop_vert=lv)
    out["uv_names"] = np.array([u.name for u in me.uv_layers])
    for u in me.uv_layers:
        uv = np.empty(len(me.loops) * 2); u.data.foreach_get("uv", uv)
        out["uv_" + u.name] = uv.reshape(-1, 2)
    ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ev)
    out["edges"] = ev.reshape(-1, 2)
    for attr in ("sharp_edge", "seam"):
        a = me.attributes.get(attr)
        if a is not None:
            v = np.empty(len(a.data), bool); a.data.foreach_get("value", v); out["edge_" + attr] = v
    seam = np.empty(len(me.edges), bool); me.edges.foreach_get("use_seam", seam); out["edge_use_seam"] = seam
    np.savez_compressed(SRC_UV, **out)
    log("exported", SRC_UV, "uv layers", list(out["uv_names"]), "seams", int(seam.sum()))


# ================================================================================ numpy: base mesh + helpers
def smooth01(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def load_base():
    """Cage (quads) of the CC0 female realistic body + face sets + the bundle's UV layer (UDIM layout)."""
    d = np.load(SRC)
    u = np.load(SRC_UV)
    co, ls, lt, lv = d["co"].astype(np.float64), d["loop_start"], d["loop_total"], d["loop_vert"]
    fs = d["attr_FACE__sculpt_face_set"]
    assert np.allclose(co, u["co"], atol=1e-6) and (ls == u["loop_start"]).all()
    uv = u["uv_UVMap"].astype(np.float64)
    vset = np.zeros(len(co), np.int32)
    for i, (s, t) in enumerate(zip(ls, lt)):
        vset[lv[s:s + t]] = fs[i]
    return dict(P=co, ls=ls, lt=lt, lv=lv, fs=fs, uv=uv, vset=vset)


FINGERS_L = [9] + list(range(64, 84)); FINGERS_R = [10] + list(range(84, 104))
TOES_L = [25] + list(range(46, 64)); TOES_R = [26] + list(range(27, 46))
HEAD_SETS = [2, 3, 4, 5, 7, 8, 22]

# base-mesh joints (base frame, 1.64 m, from the face-set boundaries; see the fit notes)
BASE_J = {
    "hips": (0, 0.0, 0.916), "spine": (0, 0.0, 1.063), "chest": (0, 0.0, 1.196), "neck": (0, 0.0, 1.372),
    "head": (0, 0.0, 1.455), "clavicle_L": (0.017, -0.03, 1.355), "clavicle_R": (-0.017, -0.03, 1.355),
    "upperarm_L": (0.148, 0.006, 1.312), "forearm_L": (0.237, 0.028, 1.064), "hand_L": (0.343, -0.025, 0.865),
    "upperarm_R": (-0.148, 0.006, 1.312), "forearm_R": (-0.237, 0.028, 1.064), "hand_R": (-0.343, -0.025, 0.865),
    "thigh_L": (0.090, 0.0, 0.870), "shin_L": (0.109, 0.007, 0.453), "foot_L": (0.120, 0.043, 0.076), "toe_L": (0.130, -0.090, 0.030),
    "thigh_R": (-0.090, 0.0, 0.870), "shin_R": (-0.109, 0.007, 0.453), "foot_R": (-0.120, 0.043, 0.076), "toe_R": (-0.130, -0.090, 0.030),
}
CHAIN = {"hips": "spine", "spine": "chest", "chest": "neck", "neck": "head", "head": None,
         "clavicle_L": "upperarm_L", "upperarm_L": "forearm_L", "forearm_L": "hand_L", "hand_L": None,
         "clavicle_R": "upperarm_R", "upperarm_R": "forearm_R", "forearm_R": "hand_R", "hand_R": None,
         "thigh_L": "shin_L", "shin_L": "foot_L", "foot_L": "toe_L", "toe_L": None,
         "thigh_R": "shin_R", "shin_R": "foot_R", "foot_R": "toe_R", "toe_R": None}
FIT_BONES = list(CHAIN)
LEAF_AXIS = {"head": (0, 0, 1.0), "hand_L": (0.26, -0.18, -0.55), "hand_R": (-0.26, -0.18, -0.55),
             "toe_L": (0, -1, 0), "toe_R": (0, -1, 0)}


def base_weights(B, iters=14):
    """Provisional dense weights over FIT_BONES from face sets + z splits, Laplacian-smoothed over the cage graph."""
    P, vset = B["P"], B["vset"]
    n = len(P)
    W = np.zeros((n, len(FIT_BONES)))
    col = {b: i for i, b in enumerate(FIT_BONES)}
    z = P[:, 2]
    def put(mask, bone, w=1.0):
        W[mask, col[bone]] += w
    torso = np.isin(vset, [1, 19, 18])
    put(torso & (z < BASE_J["spine"][2]), "hips")
    put(torso & (z >= BASE_J["spine"][2]) & (z < BASE_J["chest"][2]), "spine")
    hi = torso & (z >= BASE_J["chest"][2])
    sh = hi & (np.abs(P[:, 0]) > 0.075) & (z > 1.24)
    put(hi & ~sh, "chest")
    put(sh & (P[:, 0] > 0), "clavicle_L"); put(sh & (P[:, 0] < 0), "clavicle_R")
    hn = vset == 17
    th = smooth01((z - 1.355) / (1.455 - 1.355))
    W[hn, col["head"]] += th[hn]; W[hn, col["neck"]] += 1 - th[hn]
    put(np.isin(vset, HEAD_SETS), "head")
    put(vset == 21, "upperarm_L"); put(vset == 20, "upperarm_R")
    put(vset == 12, "forearm_L"); put(vset == 11, "forearm_R")
    put(np.isin(vset, FINGERS_L), "hand_L"); put(np.isin(vset, FINGERS_R), "hand_R")
    put(vset == 24, "thigh_L"); put(vset == 23, "thigh_R")
    put(vset == 15, "shin_L"); put(vset == 16, "shin_R")
    put(vset == 14, "foot_L"); put(vset == 13, "foot_R")
    put(np.isin(vset, TOES_L), "toe_L"); put(np.isin(vset, TOES_R), "toe_R")
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # smooth over the edge graph
    E = edges_of(B)
    for _ in range(iters):
        acc = np.zeros_like(W); cnt = np.zeros(n)
        np.add.at(acc, E[:, 0], W[E[:, 1]]); np.add.at(acc, E[:, 1], W[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
        W = 0.5 * W + 0.5 * acc / np.maximum(cnt, 1)[:, None]
    return W / W.sum(1, keepdims=True)


def edges_of(B):
    ls, lt, lv = B["ls"], B["lt"], B["lv"]
    E = []
    for s, t in zip(ls, lt):
        idx = lv[s:s + t]
        E.append(np.stack([idx, np.roll(idx, -1)], 1))
    E = np.concatenate(E)
    E = np.sort(E, 1)
    return np.unique(E, axis=0)


def rot_a_to_b(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def fit_maps(R, lat_scale, head_scale):
    """Per bone: x -> h1 + Rm (S (x - h0)); S scales along the base bone axis by len ratio and laterally by lat_scale."""
    maps = {}
    for b in FIT_BONES:
        h0 = np.array(BASE_J[b]); h1 = R.joints[b]
        c = CHAIN[b]
        if c is not None:
            a0 = np.array(BASE_J[c]) - h0; a1 = R.joints[c] - h1
            s_len = np.linalg.norm(a1) / np.linalg.norm(a0)
        else:
            a0 = np.array(LEAF_AXIS[b], float)
            par = next(k for k, v in CHAIN.items() if v == b)
            a1 = rot_a_to_b(np.array(BASE_J[CHAIN[par]]) - np.array(BASE_J[par]), R.joints[CHAIN[par]] - R.joints[par]) @ a0
            s_len = lat_scale
        if b == "head":
            s_len = head_scale
        s_lat = head_scale if b == "head" else lat_scale
        a0n = a0 / np.linalg.norm(a0)
        S = s_lat * np.eye(3) + (s_len - s_lat) * np.outer(a0n, a0n)
        Rm = rot_a_to_b(a0, a1)
        maps[b] = dict(h0=h0, h1=h1, M=Rm @ S)
    return maps


def warp(P, W, maps):
    out = np.zeros_like(P)
    for j, b in enumerate(FIT_BONES):
        w = W[:, j]; nz = w > 1e-6
        if nz.any():
            m = maps[b]
            out[nz] += w[nz, None] * ((P[nz] - m["h0"]) @ m["M"].T + m["h1"])
    return out


# ================================================================================ measuring (exact plane sections)
def section_pts(P, F, z, mask=None):
    """Points of the mesh/plane z intersection (segments' endpoints) for triangles F (mask on triangles)."""
    T3 = P[F] if mask is None else P[F[mask]]
    out = []
    for i in range(3):
        a, b = T3[:, i], T3[:, (i + 1) % 3]
        za, zb = a[:, 2] - z, b[:, 2] - z
        c = (za * zb) < 0
        t = za[c] / (za[c] - zb[c])
        out.append(a[c] + t[:, None] * (b[c] - a[c]))
    return np.concatenate(out) if out else np.zeros((0, 3))


def extent(pts, axis, xr=None):
    if xr is not None:
        pts = pts[(pts[:, 0] >= xr[0]) & (pts[:, 0] < xr[1])]
    return float(pts[:, axis].max() - pts[:, axis].min()) if len(pts) else float("nan")


def measure_mesh(P, F, J):
    """Blueprint metrics on a triangle mesh in the final frame (mm). J = joints."""
    def ext(z, axis, xr=None, zmask=None):
        return round(extent(section_pts(P, F, z), axis, xr) * 1000, 1)
    hipz, kneez, anklez = J["thigh_L"][2], J["shin_L"][2], J["foot_L"][2]
    top = float(P[:, 2].max())
    m = {"height": round(top * 1000, 1), "crown_minus_head_joint": round((top - J["head"][2]) * 1000, 1)}
    # torso (exclude the arms: |x| < 0.20 for the torso slices, deltoids = full width)
    tor = (-0.21, 0.21)
    m["shoulder_w"] = ext(J["upperarm_L"][2] + 0.01, 0)
    m["bust_w"] = ext(1.29, 0, tor); m["bust_d"] = ext(1.29, 1, (-0.12, 0.12))
    m["underbust_w"] = ext(1.20, 0, tor); m["underbust_d"] = ext(1.20, 1, (-0.12, 0.12))
    m["waist_w"] = ext(1.15, 0, tor); m["waist_d"] = ext(1.15, 1, (-0.12, 0.12))
    m["hip_w"] = ext(hipz, 0, tor); m["hip_d"] = ext(hipz, 1, (-0.12, 0.12))
    m["glute_d"] = ext(0.88, 1, (-0.14, 0.14)); m["hip_w_max"] = max(ext(z, 0, (-0.3, 0.3)) for z in (0.80, 0.82, 0.85))
    L = (0.0, 0.3)
    m["thigh_top_w"] = ext(0.78, 0, L); m["thigh_mid_w"] = ext(0.65, 0, L); m["thigh_mid_d"] = ext(0.65, 1, L)
    m["thigh_knee_w"] = ext(0.56, 0, L); m["knee_w"] = ext(kneez, 0, L)
    m["calf_w"] = max(ext(z, 0, L) for z in (0.37, 0.39, 0.41)); m["calf_d"] = max(ext(z, 1, L) for z in (0.37, 0.39, 0.41))
    m["ankle_w"] = ext(anklez + 0.05, 0, L)
    m["knee_z"] = round(kneez * 1000, 1); m["foot_z"] = round(anklez * 1000, 1)
    # neck at mid (between the neck joint and the chin)
    m["neck_w"] = ext(J["neck"][2] + 0.045, 0, (-0.1, 0.1)); m["neck_d"] = ext(J["neck"][2] + 0.045, 1, (-0.1, 0.1))
    # arms: diameters perpendicular to the bone (mid upper arm, mid forearm): project the section of a slab
    for nm, (a, b, t) in {"biceps": ("upperarm_L", "forearm_L", 0.45), "forearm": ("forearm_L", "hand_L", 0.35)}.items():
        A, Bj = J[a], J[b]; ax = (Bj - A) / np.linalg.norm(Bj - A); c = A + t * (Bj - A)
        d = (P - c) @ ax
        sl = P[(np.abs(d) < 0.006) & (np.linalg.norm(P - c, axis=1) < 0.09)]
        if len(sl):
            Q = sl - c; Q -= np.outer(Q @ ax, ax)
            u = np.cross(ax, [0, 1, 0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
            m[nm + "_diam"] = round(((Q @ u).max() - (Q @ u).min() + (Q @ v).max() - (Q @ v).min()) / 2 * 1000, 1)
    m["heads"] = None
    return m


TARGETS = {  # blueprint PROPORTION TARGETS (mm): (lo, hi)
    "height": (1760, 1780), "shoulder_w": (460, 480), "bust_w": (325, 335), "bust_d": (230, 245), "underbust_w": (260, 275),
    "underbust_d": (190, 205), "waist_w": (210, 222), "waist_d": (175, 195), "hip_w": (380, 395), "hip_w_max": (420, 440),
    "glute_d": (205, 220), "thigh_top_w": (200, 210), "thigh_mid_w": (165, 175), "thigh_mid_d": (150, 170),
    "thigh_knee_w": (130, 140), "knee_w": (125, 135), "calf_w": (150, 160), "calf_d": (160, 175), "ankle_w": (90, 100),
    "neck_w": (95, 105), "biceps_diam": (90, 100), "forearm_diam": (70, 80), "knee_z": (510, 530), "foot_z": (75, 85),
}


def print_measures(m):
    for k, v in m.items():
        t = TARGETS.get(k)
        flag = ""
        if t and v is not None and v == v:
            flag = "ok" if t[0] - 1e-6 <= v <= t[1] + 1e-6 else ("LOW %+.0f" % (v - t[0]) if v < t[0] else "HIGH %+.0f" % (v - t[1]))
        print(f"  {k:22s} {v!s:>8}  target {t if t else '-'}  {flag}")


# ================================================================================ sculpt: measured profiles
CONFIG = {
    "lat_scale": 1.073, "head_scale": 0.985, "muscle_lowres": 2.0, "muscle_hires": 1.0,
    # torso rows: z, width (x extent, arms excluded), depth (y extent) in mm; between rows linear; outside: ends
    "torso": [(0.80, 423, 206), (0.86, 429, 208), (0.90, 425, 212), (0.94, 414, 216), (0.98, 392, 214), (1.02, 352, 206),
              (1.06, 300, 196), (1.10, 250, 186), (1.15, 216, 184), (1.20, 268, 198), (1.25, 302, 218), (1.29, 332, 240), (1.31, 334, 244),
              (1.34, 326, 238), (1.37, 304, 196), (1.41, 280, 154), (1.44, 1.0, 1.0)],
    # leg rows: z, width, depth, x-centre (mm) of ONE leg (left; mirrored)
    "leg": [(0.90, 1.0, 1.0, None), (0.86, 210, 206, 111), (0.80, 211, 200, 111), (0.78, 209, 198, 110), (0.72, 194, 200, 106), (0.65, 170, 160, 100), (0.60, 150, 148, 97), (0.56, 136, 136, 95),
            (0.525, 130, 128, 94), (0.49, 128, 130, 95), (0.45, 142, 152, 97), (0.39, 160, 174, 99), (0.33, 142, 154, 100),
            (0.26, 108, 118, 100), (0.18, 84, 96, 100), (0.13, 76, 88, 100), (0.09, 1.0, 1.0, None)],
    # arm radial profile along the bone (t 0..1): diameter targets (mm)
    "upperarm": [(0.0, 106), (0.12, 109), (0.3, 101), (0.45, 98), (0.8, 88), (1.0, 78)],
    "forearm": [(0.0, 79), (0.35, 79), (0.7, 65), (1.0, 54)],
    "neck": [(1.43, 1.0), (1.47, 0.84), (1.50, 0.77), (1.53, 0.81), (1.56, 1.0)],   # radial factor about the neck axis by z
    "bust": {"c": (0.082, 1.302), "r": 0.078, "move": (0.0, -0.015, 0.006), "scale": 1.15},
    "glute": {"c": (0.088, 0.905), "r": 0.080, "move": (0.004, 0.004, 0.0), "scale": 1.03},
}


def _interp_rows(z, rows, cols):
    zs = np.array([r[0] for r in rows]); order = np.argsort(zs)
    return [np.interp(z, zs[order], np.array([r[c] for r in rows], float)[order]) for c in cols]


def sculpt_profiles(P, F, W, J, cfg=CONFIG):
    """Scale torso / legs / arms / neck to the measured row targets (mm). Transforms are blended per vertex by the
    provisional weights so the groin / shoulder / neck transitions stay smooth."""
    P = P.copy()
    col = {b: i for i, b in enumerate(FIT_BONES)}
    def wsum(names):
        return W[:, [col[n] for n in names]].sum(1)
    w_tor = wsum(["hips", "spine", "chest", "clavicle_L", "clavicle_R", "neck", "head"])
    w_legL = wsum(["thigh_L", "shin_L", "foot_L", "toe_L"]); w_legR = wsum(["thigh_R", "shin_R", "foot_R", "toe_R"])
    w_armL = wsum(["upperarm_L", "forearm_L", "hand_L"]); w_armR = wsum(["upperarm_R", "forearm_R", "hand_R"])
    z = P[:, 2]
    # ---- torso: per row current extents (arms excluded by |x| < 0.21, depth from |x| < 0.12)
    rows = []
    for (zr, wt, dt) in cfg["torso"]:
        s = section_pts(P, F, zr)
        cw = extent(s, 0, (-0.21, 0.21)); cd = extent(s, 1, (-0.12, 0.12))
        sm = s[(np.abs(s[:, 0]) < 0.12)]
        yc = float((sm[:, 1].max() + sm[:, 1].min()) / 2) if len(sm) else 0.0
        sx = (wt / 1000 / cw) if wt > 2 else wt
        sy = (dt / 1000 / cd) if dt > 2 else dt
        rows.append((zr, sx, sy, yc))
    sx, sy, yc = _interp_rows(z, rows, (1, 2, 3))
    Q = P.copy(); Q[:, 0] = P[:, 0] * sx; Q[:, 1] = yc + (P[:, 1] - yc) * sy
    T = (Q - P) * w_tor[:, None]
    # ---- legs
    for sgn, wl in ((1, w_legL), (-1, w_legR)):
        rows = []
        for (zr, wt, dt, xc_t) in cfg["leg"]:
            s = section_pts(P, F, zr); s = s[(s[:, 0] * sgn > 0.0) & (np.abs(s[:, 0]) < 0.3)]
            if not len(s):
                continue
            cw = extent(s, 0); cd = extent(s, 1)
            xc = float((s[:, 0].max() + s[:, 0].min()) / 2); ycc = float((s[:, 1].max() + s[:, 1].min()) / 2)
            fx = (wt / 1000 / cw) if wt > 2 else wt; fy = (dt / 1000 / cd) if dt > 2 else dt
            dx = (sgn * xc_t / 1000 - xc) if xc_t is not None else 0.0
            rows.append((zr, fx, fy, xc, ycc, dx))
        fx, fy, xc, ycc, dx = _interp_rows(z, rows, (1, 2, 3, 4, 5))
        Q = P.copy(); Q[:, 0] = xc + (P[:, 0] - xc) * fx + dx; Q[:, 1] = ycc + (P[:, 1] - ycc) * fy
        T += (Q - P) * wl[:, None]
    # ---- arms: radial scale about the bone axis, diameter profile along t
    for side, wa in (("L", w_armL), ("R", w_armR)):
        Q = P.copy()
        for bone, child, key in (("upperarm_" + side, "forearm_" + side, "upperarm"), ("forearm_" + side, "hand_" + side, "forearm")):
            A, Bj = J[bone], J[child]; ax = (Bj - A) / np.linalg.norm(Bj - A); L = np.linalg.norm(Bj - A)
            t = ((P - A) @ ax) / L
            # current diameter per profile t from thin slabs of arm-weighted vertices
            rows = []
            for (tt, dt) in cfg[key]:
                c = A + tt * (Bj - A); d = (P - c) @ ax
                sel = (np.abs(d) < 0.015) & (wa > 0.5) & (np.linalg.norm(P - c, axis=1) < 0.10)
                if sel.sum() < 4:
                    continue
                Qs = P[sel] - c; Qs -= np.outer(Qs @ ax, ax)
                u = np.cross(ax, [0, 1, 0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
                cur = ((Qs @ u).max() - (Qs @ u).min() + (Qs @ v).max() - (Qs @ v).min()) / 2
                rows.append((tt, (dt / 1000 / cur) if dt > 2 else dt))
            if not rows:
                continue
            f = np.interp(t, [r[0] for r in rows], [r[1] for r in rows])
            # bone membership: this bone's own weight (upperarm vs forearm) so the elbow blends
            wb = W[:, col[bone]] + (W[:, col[child]] if key == "forearm" else 0)
            rad = (P - A) - np.outer((P - A) @ ax, ax)
            Q += (rad * (f - 1)[:, None]) * wb[:, None]
        T += (Q - P) * np.minimum(wa * 1.5, 1)[:, None] * 0 + (Q - P)   # Q already weighted by bone weights
    # ---- neck: radial about the neck axis (x = 0, y = neck joint y)
    nz = _interp_rows(z, cfg["neck"], (1,))[0]
    axp = np.array([0.0, J["neck"][1] + 0.01])
    rad = P[:, :2] - axp
    T[:, :2] += rad * (nz - 1)[:, None]
    P = P + T
    # ---- local forms: bust (both sides), glutes
    for key, sgnlist in (("bust", (1, -1)), ("glute", (1, -1))):
        c = cfg[key]
        for sgn in sgnlist:
            s = section_pts(P, F, c["c"][1]); s = s[(np.abs(s[:, 0]) < 0.14)]
            yfront = s[:, 1].min() if key == "bust" else s[:, 1].max()
            cen = np.array([sgn * c["c"][0], yfront + (0.02 if key == "bust" else -0.02), c["c"][1]])
            d = np.linalg.norm((P - cen) * np.array([1, 0.8, 1]), axis=1)
            w = 1 - smooth01(d / c["r"])
            mv = np.array(c["move"]) * np.array([sgn, 1, 1])
            P = P + w[:, None] * (mv + (P - cen) * (c["scale"] - 1))
    return P


def flatten_soles(P):
    z = P[:, 2]
    zmin = z.min()
    f = smooth01((0.014 - z) / 0.014)
    P = P.copy(); P[:, 2] = z - zmin * f
    P[:, 2] = np.maximum(P[:, 2], 0.0)
    return P


# ================================================================================ topology: head CC + triangles + UV islands
def head_subdivide(B, P, sel):
    """Catmull-Clark (one level) on the quads whose vertices all lie above zcut (the head); neighbouring faces become
    fans from the split edge midpoints. Returns P2, polys (list of index arrays), corner UVs per poly, parent face ids."""
    ls, lt, lv, uv = B["ls"], B["lt"], B["lv"], B["uv"]
    n = len(P)
    polys = [lv[s:s + t] for s, t in zip(ls, lt)]
    puv = [uv[s:s + t] for s, t in zip(ls, lt)]
    sel = np.asarray(sel, bool) & np.array([len(f) == 4 for f in polys])
    # edge -> faces
    efaces = {}
    for i, f in enumerate(polys):
        for k in range(len(f)):
            e = tuple(sorted((int(f[k]), int(f[(k + 1) % len(f)]))))
            efaces.setdefault(e, []).append(i)
    newP = [P]; nid = n
    fpt = {}      # face point index per selected face
    ept = {}      # edge point index per edge touching a selected face
    fpos = {}
    for i in np.nonzero(sel)[0]:
        fpos[i] = P[polys[i]].mean(0); fpt[i] = nid; nid += 1; newP.append(fpos[i][None])
    for e, fl in efaces.items():
        if any(sel[j] for j in fl):
            mid = (P[e[0]] + P[e[1]]) / 2
            if all(sel[j] for j in fl) and len(fl) == 2:
                mid = (mid * 2 + fpos[fl[0]] + fpos[fl[1]]) / 4
            ept[e] = nid; nid += 1; newP.append(mid[None])
    P2 = np.concatenate(newP)
    # smoothed positions for interior region vertices (all adjacent faces selected)
    vfaces = {}
    for i, f in enumerate(polys):
        for v in f:
            vfaces.setdefault(int(v), []).append(i)
    vedges = {}
    for e in efaces:
        vedges.setdefault(e[0], []).append(e); vedges.setdefault(e[1], []).append(e)
    for v, fl in vfaces.items():
        if all(sel[j] for j in fl):
            k = len(fl)
            Fa = np.mean([fpos[j] for j in fl], 0)
            Ra = np.mean([(P[e[0]] + P[e[1]]) / 2 for e in vedges[v]], 0)
            P2[v] = (Fa + 2 * Ra + (k - 3) * P[v]) / k
    out_polys, out_uv, parent = [], [], []
    for i, f in enumerate(polys):
        u = puv[i]
        if sel[i]:
            fc = fpt[i]; uvc = u.mean(0)
            for k in range(4):
                a, b, d = int(f[k]), int(f[(k + 1) % 4]), int(f[(k - 1) % 4])
                eab = ept[tuple(sorted((a, b)))]; ead = ept[tuple(sorted((a, d)))]
                out_polys.append(np.array([a, eab, fc, ead]))
                out_uv.append(np.array([u[k], (u[k] + u[(k + 1) % 4]) / 2, uvc, (u[k] + u[(k - 1) % 4]) / 2]))
                parent.append(i)
        else:
            # insert split-edge midpoints where a neighbour was subdivided
            verts, uvs = [], []
            for k in range(len(f)):
                a, b = int(f[k]), int(f[(k + 1) % len(f)])
                verts.append(a); uvs.append(u[k])
                e = tuple(sorted((a, b)))
                if e in ept:
                    verts.append(ept[e]); uvs.append((u[k] + u[(k + 1) % len(f)]) / 2)
            if len(verts) > 4:      # rotate so the fan vertex (index 1 in triangulate) is an inserted midpoint
                mids = [j for j, v in enumerate(verts) if v >= n]
                r = (mids[0] - 1) % len(verts)
                verts = verts[r:] + verts[:r]; uvs = uvs[r:] + uvs[:r]
            out_polys.append(np.array(verts)); out_uv.append(np.array(uvs)); parent.append(i)
    return P2, out_polys, out_uv, np.array(parent), sel


def triangulate(P, polys, puv, parent):
    F, UV, par = [], [], []
    for f, u, p in zip(polys, puv, parent):
        k = len(f)
        if k == 3:
            F.append(f); UV.append(u); par.append(p)
        elif k == 4:
            d0 = np.linalg.norm(P[f[0]] - P[f[2]]); d1 = np.linalg.norm(P[f[1]] - P[f[3]])
            if d0 <= d1:
                F += [f[[0, 1, 2]], f[[0, 2, 3]]]; UV += [u[[0, 1, 2]], u[[0, 2, 3]]]
            else:
                F += [f[[0, 1, 3]], f[[1, 2, 3]]]; UV += [u[[0, 1, 3]], u[[1, 2, 3]]]
            par += [p, p]
        else:
            # fan from the first inserted midpoint (index 1 when the split edge is the first; use the vertex with the
            # most even angles: simply fan from vertex 1)
            c = 1
            for j in range(k - 2):
                a, b = (c + 1 + j) % k, (c + 2 + j) % k
                F.append(np.array([f[c], f[a], f[b]])); UV.append(np.array([u[c], u[a], u[b]])); par.append(p)
    return np.array(F), np.array(UV), np.array(par)


def face_front_selection(B):
    """Cage faces to subdivide: eyes, lips, jaw face sets + the front of the head set (nose, cheeks, brow), base frame."""
    P0, ls, lt, lv, fs = B["P"], B["ls"], B["lt"], B["lv"], B["fs"]
    sel = np.zeros(len(ls), bool)
    for i, (s, t) in enumerate(zip(ls, lt)):
        q = P0[lv[s:s + t]]
        if fs[i] in (2, 3, 7, 8):
            sel[i] = True
        elif fs[i] == 17 and (q[:, 1] < -0.128).all() and (q[:, 2] > 1.455).all() and (q[:, 2] < 1.545).all():
            sel[i] = True      # nose + the inner cheek next to it (the cage head is already 3.7k quads)
    return sel


def uv_islands(B):
    """Island id per cage face: faces connected through an edge whose UVs coincide on both sides."""
    ls, lt, lv, uv = B["ls"], B["lt"], B["lv"], B["uv"]
    nf = len(ls)
    par = np.arange(nf)
    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    key = {}
    for i, (s, t) in enumerate(zip(ls, lt)):
        for k in range(t):
            a, b = int(lv[s + k]), int(lv[s + (k + 1) % t])
            ua, ub = uv[s + k], uv[s + (k + 1) % t]
            kk = (min(a, b), max(a, b)) + tuple(np.round((ua + ub) * 2000).astype(int))
            if kk in key:
                ra, rb = find(key[kk]), find(i)
                if ra != rb:
                    par[ra] = rb
            else:
                key[kk] = i
    return np.array([find(i) for i in range(nf)])


def pack_islands(B, isl, dens, W_px=1280, H_px=2048, margin_px=12, v_min=0.045):
    """Per island: bbox in the base UV layout x density factor -> shelf pack into the tile. Returns per-island
    (scale, offset) in tile UV units and the achieved px/m density for the body."""
    ls, lt, uv = B["ls"], B["lt"], B["uv"]
    ids = np.unique(isl)
    box = {}
    for i in ids:
        fsel = np.nonzero(isl == i)[0]
        pts = np.concatenate([uv[ls[f]:ls[f] + lt[f]] for f in fsel])
        box[i] = (pts.min(0), pts.max(0))
    def try_scale(G):
        # px sizes
        items = []
        for i in ids:
            lo, hi = box[i]
            w, h = (hi - lo) * G * dens[i]
            items.append((h + 2 * margin_px, w + 2 * margin_px, i))
        items.sort(reverse=True)
        x = y = 0; shelf_h = 0; place = {}
        for h, w, i in items:
            if w > W_px:
                return None
            if x + w > W_px:
                x = 0; y += shelf_h; shelf_h = 0
            place[i] = (x + margin_px, y + margin_px); x += w; shelf_h = max(shelf_h, h)
        if y + shelf_h > H_px * (1 - v_min):
            return None
        return place
    lo_g, hi_g = 10.0, 5000.0
    for _ in range(40):
        mid = (lo_g + hi_g) / 2
        if try_scale(mid) is None:
            hi_g = mid
        else:
            lo_g = mid
    G = lo_g; place = try_scale(G)
    xf = {}
    for i in ids:
        lo, hi = box[i]
        s = G * dens[i]
        px, py = place[i]
        # tile uv = (uv - lo) * s / (W,H) + (px,py)/(W,H) ; v offset so islands sit above the eye strip
        xf[i] = (np.array([s / W_px, s / H_px]), np.array([px / W_px, (py + H_px * v_min) / H_px]) - lo * np.array([s / W_px, s / H_px]))
    return xf, G


def uv_sphere(center, r, nseg=16, nring=12, axis=(0, -1, 0)):
    """UV sphere with the pole on `axis` (the cornea at the front). Returns P, F, UV (lat-long, pole at v=1)."""
    ax = np.asarray(axis, float); ax /= np.linalg.norm(ax)
    u = np.cross(ax, [0, 0, 1.0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
    P, UVv = [], []
    for i in range(nring + 1):
        th = math.pi * i / nring
        for j in range(nseg + 1):
            ph = 2 * math.pi * j / nseg
            P.append(center + r * (math.cos(th) * ax + math.sin(th) * (math.cos(ph) * u + math.sin(ph) * v)))
            UVv.append((j / nseg, 1 - i / nring))
    P = np.array(P); UVv = np.array(UVv)
    F = []
    for i in range(nring):
        for j in range(nseg):
            a = i * (nseg + 1) + j; b = a + 1; c = a + nseg + 1; d = c + 1
            if i > 0:
                F.append([a, c, b])
            if i < nring - 1:
                F.append([b, c, d])
    F = np.array(F)
    return P, F, UVv[F]


# ================================================================================ weights (initial) from r28
SKEL = ["hips", "spine", "chest", "clavicle_L", "upperarm_L", "forearm_L", "hand_L", "clavicle_R", "upperarm_R",
        "forearm_R", "hand_R", "neck", "head", "thigh_L", "shin_L", "foot_L", "toe_L", "thigh_R", "shin_R", "foot_R", "toe_R"]


def make_weights(P, F, R, Wfit, iters=3):
    """Nearest-surface transfer from the r28 body moved into the final frame, restricted to the skeletal bones,
    cleaned (L/R legs separated, crotch -> hips, hands -> hand_X) and Laplacian-smoothed over the new mesh."""
    import seraphine_r29_team as T
    D = R.donor_mesh("body")
    Pd = T.T0.blend_points(D["P"], D["Wn"], R.bones, R.maps) if R.maps else D["P"]
    body = dict(P=Pd, W=D["Wn"], bones=R.bones)
    W, bones = T.transfer_weights(P, body, allow=SKEL, k=6)
    col = {b: i for i, b in enumerate(bones)}
    fcol = {b: i for i, b in enumerate(FIT_BONES)}
    for b in bones:                       # transfer_weights parks unweighted rows on bones[0] = root: clear
        if b not in SKEL:
            W[:, col[b]] = 0
    # cleanups from the fit regions
    legL = Wfit[:, [fcol[b] for b in ("thigh_L", "shin_L", "foot_L", "toe_L")]].sum(1)
    legR = Wfit[:, [fcol[b] for b in ("thigh_R", "shin_R", "foot_R", "toe_R")]].sum(1)
    for b in ("thigh_R", "shin_R", "foot_R", "toe_R"):
        W[legL > 0.6, col[b]] = 0
    for b in ("thigh_L", "shin_L", "foot_L", "toe_L"):
        W[legR > 0.6, col[b]] = 0
    for side in ("L", "R"):
        armbones = ["upperarm_" + side, "forearm_" + side, "hand_" + side]
        other = [b for b in SKEL if b not in armbones and not b.startswith("clavicle")]
        arm = Wfit[:, [fcol[b] for b in armbones]].sum(1)
        for b in other:
            W[arm > 0.8, col[b]] = 0
        hand = Wfit[:, fcol["hand_" + side]]
        for b in [x for x in SKEL if x != "hand_" + side and x != "forearm_" + side]:
            W[hand > 0.5, col[b]] = 0
        W[hand > 0.9, :] = 0; W[hand > 0.9, col["hand_" + side]] = 1
    # crotch: between the thighs near the groin -> hips
    crotch = (np.abs(P[:, 0]) < 0.03) & (P[:, 2] > 0.76) & (P[:, 2] < 0.86)
    W[crotch] = 0; W[crotch, col["hips"]] = 1
    # rows emptied by the cleanups fall back to the fit weights (same bone names)
    empty = W.sum(1) < 1e-6
    for b in FIT_BONES:
        W[empty, col[b]] = Wfit[empty, fcol[b]]
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # smooth over the mesh graph
    E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1), axis=0)
    for _ in range(iters):
        acc = np.zeros_like(W); cnt = np.zeros(len(P))
        np.add.at(acc, E[:, 0], W[E[:, 1]]); np.add.at(acc, E[:, 1], W[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
        W = 0.5 * W + 0.5 * acc / np.maximum(cnt, 1)[:, None]
    W = T.top_k(W, 4)
    return W, bones


# ================================================================================ tiles (B1 placeholders; B2 bake)
def write_tiles(tiles_dir, eye_boxes, size=(1280, 2048)):
    from PIL import Image
    os.makedirs(tiles_dir, exist_ok=True)
    Wp, Hp = size
    alb = np.zeros((Hp, Wp, 3), np.uint8); alb[:] = (196, 150, 118)      # warm tan ~ L* 62
    orm = np.zeros((Hp, Wp, 3), np.uint8); orm[:] = (255, 160, 0)
    nrm = np.zeros((Hp, Wp, 3), np.uint8); nrm[:] = (128, 128, 255)
    # eyes: lat-long islands, pole (cornea) at the top row: sclera, hazel iris, pupil
    for (x0, y0, x1, y1) in eye_boxes:
        h = y1 - y0; w = x1 - x0
        yy = np.arange(h)[:, None] * np.ones((1, w))
        lat = yy / h * 180.0                           # 0 = front pole
        sub = np.zeros((h, w, 3), np.uint8); sub[:] = (236, 230, 222)
        sub[lat < 24] = (120, 84, 40)                  # iris (amber/hazel)
        sub[(lat >= 20) & (lat < 24)] = (70, 48, 22)   # limbal ring
        sub[lat < 9] = (12, 8, 6)                      # pupil
        # image rows are top-down: v=1 (pole) at the top of the box
        alb[Hp - y1:Hp - y0, x0:x1] = sub
        o = orm[Hp - y1:Hp - y0, x0:x1]; o[:] = (255, 60, 0)
    Image.fromarray(alb).save(os.path.join(tiles_dir, "skin_albedo.png"))
    Image.fromarray(orm).save(os.path.join(tiles_dir, "skin_orm.png"))
    Image.fromarray(nrm).save(os.path.join(tiles_dir, "skin_normal.png"))


def fit_eyes(P, B):
    """Sphere fit to the lid-rim vertices of face sets 2 (+x = her left) and 3; returns centres + radius."""
    out = {}
    for side, s in (("L", 2), ("R", 3)):
        Q = P[B["vset"] == s]
        A = np.c_[2 * Q, np.ones(len(Q))]; b = (Q ** 2).sum(1)
        x, *_ = np.linalg.lstsq(A, b, rcond=None)
        c = x[:3]; r = math.sqrt(float(x[3] + (c ** 2).sum()))
        out[side] = (c, r, Q)
    return out


# ================================================================================ fit (the whole body pipeline)
def run_fit(ckpt=1, tag="fit"):
    import seraphine_r29_team as T
    t0 = time.time()
    R = T.Rig()
    B = load_base()
    Wfit = base_weights(B)
    maps = fit_maps(R, CONFIG["lat_scale"], CONFIG["head_scale"])
    P = warp(curl_fingers(B), Wfit, maps)
    # cage triangles (for the section measures during the sculpt)
    polys0 = [B["lv"][s:s + t] for s, t in zip(B["ls"], B["lt"])]
    F0, _, _ = triangulate(P, polys0, [B["uv"][s:s + t] for s, t in zip(B["ls"], B["lt"])], np.arange(len(polys0)))
    # the shoulder top: the chest/clavicle map split leaves a shelf -> smooth the blend zone (moves < 3 mm)
    cl = Wfit[:, FIT_BONES.index("clavicle_L")] + Wfit[:, FIT_BONES.index("clavicle_R")]
    P = smooth_region(P, F0, ((cl > 0.05) & (cl < 0.95)) * 1.0, iters=6, lam=0.5)
    # trapezius: the slope from the neck to the acromion (the base's shoulder top is flat after the chest shortening)
    for sx in (1, -1):
        P = move(P, np.array([sx * 0.080, 0.03, 1.455]), 0.075, (0, 0.0, 0.016), axes=(1.0, 0.9, 1.3))
        P = move(P, np.array([sx * 0.165, 0.02, 1.470]), 0.062, (sx * 0.004, 0.0, 0.012), axes=(1.0, 0.9, 1.2))   # squarer acromion/deltoid top
    P = sculpt_profiles(P, F0, Wfit, R.joints)
    P = flatten_soles(P)
    P = sculpt_face(P, B)
    # muscle definition as real low-res forms (60 % of the field; the hi-res bake adds the rest)
    Ncage = vert_normals_tris(P, F0)
    P = P + Ncage * muscle_field(P, Ncage, R.joints, amp=CONFIG["muscle_lowres"])[:, None]
    m_cage = measure_mesh(P, F0, R.joints)
    os.makedirs(os.path.join(WORK, "fit"), exist_ok=True)
    np.savez_compressed(os.path.join(WORK, "fit", "cage.npz"), P=P, ls=B["ls"], lt=B["lt"], lv=B["lv"], fs=B["fs"],
                        joints=np.array([R.joints[b] for b in R.bones]), bones=np.array(R.bones))
    # head subdivision (one CC level) + triangles
    sel = face_front_selection(B)
    P2, polys, puv, parent, sel = head_subdivide(B, P, sel)
    F, UVb, par = triangulate(P2, polys, puv, parent)
    # UV repack
    isl = uv_islands(B)
    fs = B["fs"]
    # the face front (the subdivided faces) becomes its own island per side (3x density); the rest of the head 1.5x
    side = (B["uv"][B["ls"]][:, 1] >= 2).astype(int)        # UDIM row 2/3 = +x side
    isl = np.where(sel, 10 ** 6 + side, isl)
    dens = {}
    for i in np.unique(isl):
        sets = set(fs[isl == i].tolist())
        if i >= 10 ** 6:
            dens[i] = 3.0
        elif sets & {17, 22, 2, 3, 7, 8}:
            dens[i] = 1.2
        elif sets & {9, 10}:
            dens[i] = 1.3
        else:
            dens[i] = 1.0
    xf, G = pack_islands(B, isl, dens)
    UV = np.empty_like(UVb)
    for k in range(len(F)):
        s, o = xf[isl[par[k]]]
        UV[k] = UVb[k] * s + o
    UV = shrink_eye_rim_uvs(UV, F, fs[par], factor=0.3)
    N = T.normals_smooth(P2, F)
    # weights
    Wfit2 = np.concatenate([Wfit, np.zeros((len(P2) - len(P), Wfit.shape[1]))])
    # new (subdivided) vertices inherit the mean fit weights of their parents through the mesh graph (few iterations)
    E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1), axis=0)
    for _ in range(3):
        acc = np.zeros_like(Wfit2); cnt = np.zeros(len(P2))
        np.add.at(acc, E[:, 0], Wfit2[E[:, 1]]); np.add.at(acc, E[:, 1], Wfit2[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
        new = acc / np.maximum(cnt, 1)[:, None]
        Wfit2[len(P):] = new[len(P):]
    Wfit2 /= np.maximum(Wfit2.sum(1, keepdims=True), 1e-9)
    W, bones = make_weights(P2, F, R, Wfit2)
    # eyes
    eyes = fit_eyes(P2[:len(P)], B)
    eye_boxes = {"L": (1280 - 136, 8, 1280 - 8, 72), "R": (1280 - 272, 8, 1280 - 144, 72)}
    os.makedirs(PARTS, exist_ok=True)
    eye_meta = {}
    for side, (c, r, Q) in eyes.items():
        cen = c + np.array([0, 0.0015, 0]) * 0          # sphere fit centre
        rad = r * 0.985
        Pe, Fe, UVe = uv_sphere(cen, rad, 16, 12, axis=(0, -1, 0))
        x0, y0, x1, y1 = eye_boxes[side]
        UVe = UVe * np.array([(x1 - x0) / 1280, (y1 - y0) / 2048]) + np.array([x0 / 1280, y0 / 2048])
        Ne = T.normals_smooth(Pe, Fe)
        We = np.zeros((len(Pe), len(bones))); We[:, bones.index("head")] = 1
        # seat check: the eyeball front vs the lid rim points (how far the cornea sits behind/in front of the rim)
        front = cen + rad * np.array([0, -1, 0])
        rim_y = Q[:, 1].min()
        eye_meta[side] = {"centre": [round(float(x), 4) for x in cen], "radius_mm": round(rad * 1000, 2),
                          "cornea_vs_lid_rim_mm": round(float((rim_y - front[1]) * 1000), 2)}
        if not os.environ.get("KCA_KEEP_EYES"):
            T.save_part(PARTS, "eyes_" + side, P=Pe, F=Fe, UV=UVe, N=Ne, W=We, bones=bones, tile="skin",
                        meta={"role": "body", "mesh": "body", "notes": f"eyeball {side} 16x12, {eye_meta[side]}"})
    write_tiles(os.path.join(PARTS, "tiles"), list(eye_boxes.values()))
    meta = T.save_part(PARTS, "body", P=P2, F=F, UV=UV, N=N, W=W, bones=bones, tile="skin",
                       meta={"role": "body", "mesh": "body", "notes": f"r29 {tag}: CC0 female base cage fitted to R.joints, "
                             f"profile sculpt (CONFIG), head CC x1 (zcut 1.50); UV islands repacked (face 3x, hands 1.3x, G={G:.0f} px/uv)",
                             "ckpt": ckpt})
    m = measure_mesh(P2, F, R.joints)
    jaw = P2[:len(P)][B["vset"] == 22]; jaw = jaw[jaw[:, 1] < jaw[:, 1].min() + 0.025]
    m["chin_z"] = round(1000 * float(jaw[:, 2].min()), 1)
    m["heads"] = round(m["height"] / (m["height"] - m["chin_z"]), 2)
    m["tris_body"] = int(len(F)); m["tris_head_region"] = int((P2[F].mean(1)[:, 2] > 1.50).sum())
    m["verts"] = int(len(P2))
    # texel density: px per metre on the body islands vs the face
    def dens_of(sel_faces):
        a3 = 0.0; a2 = 0.0
        for k in np.nonzero(sel_faces)[0]:
            p = P2[F[k]]; u = UV[k] * np.array([1280, 2048])
            a3 += 0.5 * np.linalg.norm(np.cross(p[1] - p[0], p[2] - p[0]))
            a2 += 0.5 * abs((u[1] - u[0])[0] * (u[2] - u[0])[1] - (u[1] - u[0])[1] * (u[2] - u[0])[0])
        return math.sqrt(a2 / a3)
    headf = np.array([dens[isl[par[k]]] == 3.0 for k in range(len(F))])
    m["face_quads_subdivided"] = int(sel.sum())
    m["px_per_m_face"] = round(dens_of(headf), 0); m["px_per_m_body"] = round(dens_of(~headf), 0)
    m["eyes"] = eye_meta
    sha = T.part_sha(PARTS, "body")
    ck = {"ckpt": ckpt, "body_sha": sha, "retarget_sha": T.T0.sha256(os.path.join(PARTS, "retarget.json")),
          "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "measures": m}
    json.dump(ck, open(os.path.join(PARTS, "body_ckpt.json"), "w"), indent=1)
    os.makedirs(WORK, exist_ok=True)
    json.dump({"cage": m_cage, "final": m, "seconds": round(time.time() - t0, 1)}, open(os.path.join(WORK, f"measures_{tag}.json"), "w"), indent=1)
    print_measures(m)
    log(f"body.npz {sha[:12]} tris {len(F)} verts {len(P2)} head-region tris {m['tris_head_region']} in {time.time()-t0:.1f}s")
    return m


# ================================================================================ face sculpt (cage, final frame)
FACE = dict(
    eye_scale=(1.17, 1.07, 1.0), canthus_lift=0.0046, lid_drop=0.0046, cheek_out=0.0050, face_w=1.045, jaw_in=0.0045,
    chin_fwd=0.0020, chin_down=0.0006, chin_w=1.0, nose_w=0.86, nose_tip_fwd=0.0032, bridge_fwd=0.0026,
    brow_soft=0.0012, lip_upper_fwd=0.0034, lip_lower_fwd=0.0052, mouth_w=0.97, bow=0.0014, sulcus_fill=0.0036,
    philtrum_soft=0.0006, temple_in=0.0,
)


def falloff(P, c, r, axes=(1, 1, 1)):
    d = np.linalg.norm((P - c) * np.asarray(axes, float), axis=1)
    return 1 - smooth01(d / r)


def move(P, c, r, vec, axes=(1, 1, 1)):
    return P + falloff(P, c, r, axes)[:, None] * np.asarray(vec, float)


def scale_about(P, c, r, f, axes=(1, 1, 1)):
    w = falloff(P, c, r, axes)
    return P + w[:, None] * ((P - c) * (np.asarray(f, float) - 1))


def face_landmarks(P, B):
    vs = B["vset"]
    L = {}
    eyes = fit_eyes(P, B)
    L["eye_L"], L["eye_R"], L["eye_r"] = eyes["L"][0], eyes["R"][0], eyes["L"][1]
    head = P[vs == 17]
    L["nose"] = head[np.argmin(head[:, 1])]
    jaw = P[vs == 22]; fr = jaw[jaw[:, 1] < jaw[:, 1].min() + 0.02]
    L["chin"] = fr[np.argmin(fr[:, 2])]
    up, lo = P[vs == 7], P[vs == 8]
    front = np.concatenate([up, lo]); front = front[front[:, 1] < front[:, 1].min() + 0.012]
    L["lip"] = np.array([0.0, front[:, 1].min(), (up[:, 2].min() + lo[:, 2].max()) / 2])
    L["mouth_half_w"] = float(max(up[:, 0].max(), lo[:, 0].max())) * 0.75
    return L


def sculpt_face(P, B, p=FACE):
    """Proportional edits (seraphine_basemesh.py style) on the cage head: almond eyes, cheekbones, feminine jaw, chin,
    refined nose, fuller lips. Only cage vertices (the CC face runs afterwards)."""
    P = P.copy()
    L = face_landmarks(P, B)
    lip, nose, chin = L["lip"], L["nose"], L["chin"]
    head_mask = P[:, 2] > 1.50
    Q = P[head_mask]
    for sx, ec in ((1, L["eye_L"]), (-1, L["eye_R"])):
        Q = scale_about(Q, ec, 0.034, p["eye_scale"])
        outer = ec + np.array([sx * 0.017, -0.010, 0.0])
        Q = move(Q, outer, 0.014, (0, 0, p["canthus_lift"]))
        if p["lid_drop"]:
            lidc = np.array([ec[0], ec[1] - 0.012, ec[2] + 0.0085])
            Q = move(Q, lidc, 0.015, (0, -0.6 * p["lid_drop"], -p["lid_drop"]), axes=(1.0, 0.6, 1.4))
        zyg = np.array([sx * 0.056, ec[1] - 0.004, ec[2] - 0.034])
        Q = move(Q, zyg, 0.036, (sx * p["cheek_out"] * 0.9, -p["cheek_out"] * 0.4, 0.0), axes=(1, 0.8, 1.1))
        gon = np.array([sx * 0.062, ec[1] + 0.030, chin[2] + 0.030])
        Q = move(Q, gon, 0.028, (-sx * p["jaw_in"], 0, 0))
        ala = np.array([sx * 0.012, nose[1] + 0.012, nose[2] - 0.004])
        Q = scale_about(Q, ala, 0.014, (p["nose_w"], 1, 1))
        brow = np.array([sx * 0.030, ec[1] - 0.019, ec[2] + 0.020])
        Q = move(Q, brow, 0.022, (0, p["brow_soft"], 0))
        Q = move(Q, lip + np.array([sx * L["mouth_half_w"] * 0.9, 0.001, 0]), 0.009, (0, 0.0008, 0.0006), axes=(1, .9, .7))
    Q = move(Q, nose + np.array([0, 0.004, 0]), 0.012, (0, -p["nose_tip_fwd"], 0), axes=(1, 0.8, 1))
    Q = move(Q, nose + np.array([0, 0.012, 0.025]), 0.014, (0, -p["bridge_fwd"], 0), axes=(1.2, 0.8, 0.8))
    Q = move(Q, chin + np.array([0, 0.0, 0.006]), 0.022, (0, -p["chin_fwd"], -p["chin_down"]))
    Q = scale_about(Q, lip + np.array([0, 0.008, -0.026]), 0.018, (p["chin_w"], 1, 1), axes=(0.7, 0.8, 1.0))
    Q = move(Q, lip + np.array([0, 0, -0.006]), 0.013, (0, -p["lip_lower_fwd"], -0.0012), axes=(0.7, 1, 1))
    Q = move(Q, lip + np.array([0, 0, 0.005]), 0.011, (0, -p["lip_upper_fwd"], 0.0003), axes=(0.7, 1, 1))
    Q = move(Q, lip + np.array([0, 0.002, 0.012]), 0.010, (0, -p["philtrum_soft"], 0), axes=(0.6, 1, 1))
    if p["sulcus_fill"]:
        Q = move(Q, lip + np.array([0, 0.004, -0.016]), 0.012, (0, -p["sulcus_fill"], 0), axes=(0.8, 1, 1))
    if p["bow"]:
        for sx in (1, -1):
            Q = move(Q, lip + np.array([sx * 0.0050, -0.0015, 0.0045]), 0.0036, (0, -0.55 * p["bow"], 0.65 * p["bow"]), axes=(1, .7, 1))
    if p["mouth_w"] != 1.0:
        Q = scale_about(Q, lip, 0.026, (p["mouth_w"], 1, 1), axes=(0.75, 1.4, 1.6))
    if p["face_w"] != 1.0:   # lower face / cheek width about the face axis, fading above the brows and behind the ears
        w = smooth01((1.655 - Q[:, 2]) / 0.03) * smooth01((Q[:, 2] - 1.52) / 0.03) * smooth01((-0.02 - Q[:, 1]) / 0.05)
        Q[:, 0] *= 1 + (p["face_w"] - 1) * w
    P[head_mask] = Q
    return P


def vert_normals_tris(P, F):
    n = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    VN = np.zeros_like(P)
    for k in range(3):
        np.add.at(VN, F[:, k], n)
    return VN / np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)


def shrink_eye_rim_uvs(UV, F, fs_tri, factor=0.5):
    """Pull the UVs of the vertices interior to the eye-rim face sets (2/3) toward each set's UV centroid: the base
    layout gives those tiny inner-lid faces > 4x the median texel density (qa 'stretched'). Boundary vertices keep
    their UVs (no seam)."""
    UV = UV.copy()
    for sset in (2, 3):
        tri = fs_tri == sset
        inner = set(np.unique(F[tri])) - set(np.unique(F[~tri]))
        if not inner:
            continue
        c = UV[tri].reshape(-1, 2).mean(0)
        for k in np.nonzero(tri)[0]:
            for i in range(3):
                if F[k, i] in inner:
                    UV[k, i] = c + (UV[k, i] - c) * factor
    return UV


def curl_fingers(B, bend_deg=75.0):
    """Loose sabre grip in the BASE frame (before the warp): each finger bends as an arc from its knuckle toward the
    palm (rotation about the base y axis = the thumb direction). Thumb untouched (lies along the grip)."""
    P = B["P"].copy(); vs = B["vset"]
    d = np.array([0.33, 0.0, -0.94]); d /= np.linalg.norm(d)           # base finger direction (arm axis)
    Th = math.radians(bend_deg)
    for side, sets, sx in (("L", [(64, 65, 66, 67), (68, 69, 70, 71), (72, 73, 74, 75), (76, 77, 78, 79)], 1),
                           ("R", [(100, 101, 102, 103), (96, 97, 98, 99), (92, 93, 94, 95), (88, 89, 90, 91)], -1)):
        dd = d * np.array([sx, 1, 1]); n = np.array([-0.94 * sx, 0.0, -0.33])     # palm normal (inward)
        for finger in sets:
            idx = np.nonzero(np.isin(vs, finger))[0]
            if not len(idx):
                continue
            Q = P[idx]
            s_ = (Q - Q.mean(0)) @ dd
            k = Q[np.argmin(s_)] - dd * 0.004                                  # knuckle just above the finger top
            s_ = (Q - k) @ dd; L = max(float(s_.max()), 0.02)
            th = Th * np.clip(s_ / L, 0, 1)
            q = (Q - k) - np.outer(s_, dd)
            arc = (L / Th) * (np.sin(th)[:, None] * dd + (1 - np.cos(th))[:, None] * n)
            # rotate the lateral offset in the (dd, n) plane
            qd = q @ dd; qn = q @ n; qy = q - np.outer(qd, dd) - np.outer(qn, n)
            rot = (np.outer(qd * np.cos(th) - qn * np.sin(th), dd) + np.outer(qd * np.sin(th) + qn * np.cos(th), n) + qy)
            P[idx] = k + arc + rot
    return P


def smooth_region(P, F, mask, iters=2, lam=0.5):
    """Laplacian smoothing of the vertices in `mask` (weighted by it) over the triangle graph."""
    E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1), axis=0)
    P = P.copy()
    for _ in range(iters):
        acc = np.zeros_like(P); cnt = np.zeros(len(P))
        np.add.at(acc, E[:, 0], P[E[:, 1]]); np.add.at(acc, E[:, 1], P[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
        lap = acc / np.maximum(cnt, 1)[:, None] - P
        P += lam * lap * np.asarray(mask, float)[:, None]
    return P



# ================================================================================ muscle definition (hi-res field)
def _bump(d, r):
    return 1 - smooth01(d / r)


def muscle_field(P, N, J, amp=1.0):
    """Displacement (m) along the normal for the hi-res surface: feminine athletic definition as drawn on the sheet
    (abs + linea alba, obliques / iliac furrow, deltoid caps, biceps-triceps split, quads teardrop + vastus lateralis,
    gastrocnemius heads, spinal furrow + scapulae). No striations, no veins: amplitudes 1-3 mm."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    front = smooth01((-N[:, 1] - 0.15) / 0.35)          # facing -y
    back = smooth01((N[:, 1] - 0.15) / 0.35)
    D = np.zeros(len(P))
    torso = smooth01((0.16 - np.abs(x)) / 0.04)
    # --- abdomen: linea alba groove + 3 rectus pairs with transverse grooves
    ab = front * torso * smooth01((z - 1.03) / 0.03) * smooth01((1.26 - z) / 0.03)
    D -= 0.0016 * ab * np.exp(-(x / 0.0045) ** 2) * smooth01((z - 1.095) / 0.02)
    for zc in (1.215, 1.165, 1.115):
        for sx in (1, -1):
            D += 0.0018 * ab * np.exp(-((x - sx * 0.027) / 0.020) ** 2) * np.exp(-((z - zc) / 0.020) ** 2)
    for zg in (1.19, 1.14):
        D -= 0.0013 * ab * np.exp(-((z - zg) / 0.0055) ** 2) * smooth01((0.05 - np.abs(x)) / 0.015)
    # --- obliques + iliac furrow (inguinal groove from the hip point to the pubis)
    for sx in (1, -1):
        t = np.clip((1.10 - z) / 0.09, 0, 1)                   # 0 at z 1.10 .. 1 at z 1.01
        xg = sx * (0.075 - 0.045 * t)
        groove = np.exp(-((x - xg) / 0.006) ** 2) * (z > 1.00) * (z < 1.11)
        D -= 0.0015 * front * groove
        D += 0.0012 * front * np.exp(-((x - sx * 0.078) / 0.022) ** 2) * np.exp(-((z - 1.13) / 0.03) ** 2)
    # --- back: spinal furrow + scapulae + erector bulges
    bk = back * torso * smooth01((z - 1.02) / 0.03) * smooth01((1.40 - z) / 0.04)
    D -= 0.0020 * bk * np.exp(-(x / 0.006) ** 2)
    for sx in (1, -1):
        D += 0.0010 * bk * np.exp(-((x - sx * 0.022) / 0.016) ** 2)
        D += 0.0014 * back * np.exp(-((x - sx * 0.072) / 0.035) ** 2) * np.exp(-((z - 1.33) / 0.045) ** 2)
    # --- limbs: bone frames
    def limb(bone, child):
        A, Bj = J[bone], J[child]; ax = (Bj - A) / np.linalg.norm(Bj - A)
        t = ((P - A) @ ax) / np.linalg.norm(Bj - A)
        u = np.cross(ax, [0, 1, 0]); u /= np.linalg.norm(u); v = np.cross(ax, u)   # u ~ lateral/x, v ~ front/back
        rad = (P - A) - np.outer((P - A) @ ax, ax)
        ang = np.arctan2(rad @ v, rad @ u)                     # azimuth about the bone
        near = np.linalg.norm(rad, axis=1) < 0.16
        return t, ang, near
    for side, sx in (("L", 1), ("R", -1)):
        # deltoid cap (top of the upper arm) + biceps/triceps split (lateral line)
        t, ang, near = limb("upperarm_" + side, "forearm_" + side)
        up = smooth01((N[:, 2] - 0.1) / 0.4)
        D += 0.0050 * near * up * np.exp(-((t - 0.10) / 0.16) ** 2) * (t > -0.15)
        lat = np.exp(-((np.cos(ang) * sx - 1.0) / 0.35) ** 2)   # outer side of the arm
        D -= 0.0010 * near * lat * np.exp(-((t - 0.55) / 0.22) ** 2) * (t > 0.3) * (t < 0.9)
        # quads: rectus femoris ridge, vastus medialis teardrop (inner, low), vastus lateralis sweep (outer), groove
        t, ang, near = limb("thigh_" + side, "shin_" + side)
        fr = smooth01((-N[:, 1] - 0.2) / 0.4)
        inner = np.exp(-((np.cos(ang) * sx + 1.0) / 0.5) ** 2)
        outer = np.exp(-((np.cos(ang) * sx - 1.0) / 0.5) ** 2)
        D += 0.0022 * near * fr * np.exp(-((t - 0.5) / 0.22) ** 2)
        D += 0.0040 * near * fr * inner * np.exp(-((t - 0.84) / 0.09) ** 2)
        D += 0.0022 * near * outer * np.exp(-((t - 0.52) / 0.22) ** 2) * smooth01((N[:, 2] + 0.9) / 0.5)
        D -= 0.0018 * near * outer * np.exp(-((t - 0.88) / 0.10) ** 2)                      # flatten the outer sweep above the knee
        D -= 0.0020 * near * fr * np.exp(-((np.cos(ang) * sx - 0.55) / 0.18) ** 2) * np.exp(-((t - 0.60) / 0.28) ** 2)
        # calves: two gastrocnemius heads on the back of the shin (upper half), groove between
        t, ang, near = limb("shin_" + side, "foot_" + side)
        bkc = smooth01((N[:, 1] - 0.2) / 0.4)
        for s2 in (1, -1):
            D += 0.0030 * near * bkc * np.exp(-((np.cos(ang) * sx - s2 * 0.5) / 0.35) ** 2) * np.exp(-((t - 0.30) / 0.14) ** 2)
        D -= 0.0010 * near * bkc * np.exp(-(np.cos(ang) / 0.12) ** 2) * np.exp(-((t - 0.32) / 0.14) ** 2)
    return D * amp


# ================================================================================ bpy: hi-res sculpt + bakes
def run_bake(out_dir, samples_ao=24):
    import bpy
    from lib import meshutil, pipeline
    t0 = time.time()
    os.makedirs(out_dir, exist_ok=True)
    meshutil.clear_scene()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU" if os.environ.get("KCA_CYCLES_DEVICE", "CPU").upper() == "GPU" else "CPU"
    z = np.load(os.path.join(PARTS, "body.npz"))
    P, F, UV = z["P"].astype(np.float64), z["F"], z["UV"]
    lo = meshutil.mesh_from_numpy("body_lo", P, tris=F)
    uv = lo.data.uv_layers.new(name="UVMap"); uv.data.foreach_set("uv", UV.reshape(-1).astype(np.float32))
    lo.data.shade_smooth()
    # hi-res: sculpted cage quads -> subsurf 2 -> muscle displacement along the normals
    c = np.load(os.path.join(WORK, "fit", "cage.npz"))
    J = {str(b): c["joints"][i] for i, b in enumerate(c["bones"])}
    ls, lt, lv = c["ls"], c["lt"], c["lv"]
    quads = np.array([lv[s:s + 4] for s, t in zip(ls, lt) if t == 4])
    tris = np.array([lv[s:s + 3] for s, t in zip(ls, lt) if t == 3])
    cage = meshutil.mesh_from_numpy("body_cage", c["P"], quads=quads, tris=tris if len(tris) else None)
    md = cage.modifiers.new("sub", "SUBSURF"); md.levels = 2; md.render_levels = 2
    dg = bpy.context.evaluated_depsgraph_get()
    me = cage.evaluated_get(dg).to_mesh()
    Ph = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", Ph); Ph = Ph.reshape(-1, 3)
    Nh = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("normal", Nh); Nh = Nh.reshape(-1, 3)
    lsh = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_start", lsh)
    lth = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("loop_total", lth)
    lvh = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lvh)
    D = muscle_field(Ph, Nh, J, amp=CONFIG["muscle_hires"])
    Ph2 = Ph + Nh * D[:, None]
    qh = np.array([lvh[s:s + 4] for s, t in zip(lsh, lth) if t == 4]); th = np.array([lvh[s:s + 3] for s, t in zip(lsh, lth) if t == 3])
    hi = meshutil.mesh_from_numpy("body_hi", Ph2, quads=qh, tris=th if len(th) else None)
    hi.data.shade_smooth()
    bpy.data.objects.remove(cage, do_unlink=True)
    log(f"hi-res {len(Ph2)} verts, displacement {D.min()*1000:.1f}..{D.max()*1000:.1f} mm, {time.time()-t0:.1f}s")
    # hi material: emission = world position (for the numpy paint), AO/normal bakes use geometry only
    mh = bpy.data.materials.new("hi_pos"); mh.use_nodes = True; nt = mh.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    outn = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission"); geo = nt.nodes.new("ShaderNodeNewGeometry")
    nt.links.new(geo.outputs["Position"], em.inputs["Color"]); nt.links.new(em.outputs[0], outn.inputs[0])
    hi.data.materials.append(mh)
    W_, H_ = 1280, 2048
    def img(name, flt):
        im = bpy.data.images.new(name, W_, H_, alpha=True, float_buffer=flt)
        im.colorspace_settings.name = "Non-Color"
        return im
    im_pos = img("bake_pos", True); im_nrm = img("bake_normal", False); im_ao = img("bake_ao", False)
    # world light for AO
    wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    pipeline.bake_pass(lo, [hi], im_pos, kind="EMIT", extrusion=0.012, max_ray=0.03, samples=1)
    pipeline.bake_pass(lo, [hi], im_nrm, kind="NORMAL", extrusion=0.012, max_ray=0.03, samples=1)
    sc.cycles.samples = samples_ao
    pipeline.bake_pass(lo, [hi], im_ao, kind="AO", extrusion=0.012, max_ray=0.03, samples=samples_ao)
    def grab(im):
        a = np.empty(W_ * H_ * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(H_, W_, 4)
    pos, nrm, ao = grab(im_pos), grab(im_nrm), grab(im_ao)
    cov = pos[..., 3] > 0.5
    np.savez_compressed(os.path.join(out_dir, "bake.npz"), pos=pos[..., :3], nrm=nrm[..., :3], ao=ao[..., 0], cov=cov)
    log(f"bakes done: coverage {cov.mean()*100:.1f} %, {time.time()-t0:.1f}s -> {out_dir}/bake.npz")


# ================================================================================ skin tiles from the bake (numpy)
def dilate_np(img, cov, px=12):
    out = img.copy(); c = cov.copy()
    for _ in range(px):
        if c.all():
            break
        acc = np.zeros_like(out); cnt = np.zeros(c.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            acc += np.roll(np.roll(out * c[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(c, dy, 0), dx, 1)
        grow = (~c) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        c = c | grow
    return out


def srgb_to_lin(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


PAINT = dict(
    skin=(186, 138, 106),            # warm tan, L* ~ 60
    brow=(62, 34, 20), lash=(24, 14, 11), lash_lo=(84, 52, 40), lip=(158, 66, 58), lip_line=(86, 38, 36),
    paint=(156, 58, 30),             # ochre-red war paint, L* ~ 45
    eye_L=(0.0323, -0.1149, 1.6502), eye_R=(-0.0323, -0.1149, 1.6502), lip_c=(0.0, -0.139, 1.5905), chin_z=1.550,
)


def _noise(p, f):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    return (np.sin(x * f * 7.1 + 1.3) * np.sin(y * f * 9.7 + 0.4) * np.sin(z * f * 5.3 + 2.1)
            + 0.5 * np.sin(x * f * 17.3 + 4.0) * np.sin(z * f * 13.1 + 1.0)) / 1.5


def paint_tiles(bake_dir=None, tiles_dir=None):
    from PIL import Image
    bake_dir = bake_dir or os.path.join(WORK, "bake"); tiles_dir = tiles_dir or os.path.join(PARTS, "tiles")
    z = np.load(os.path.join(bake_dir, "bake.npz"))
    pos, nrm, ao = z["pos"].astype(np.float64), z["nrm"].astype(np.float64), z["ao"].astype(np.float64)
    cov = np.abs(pos).sum(-1) > 0
    H, W = cov.shape
    c = PAINT
    x, y, zz = pos[..., 0], pos[..., 1], pos[..., 2]
    # per-texel soft masks from the cage face sets (nearest cage vertices, inverse-distance over k=4)
    from scipy.spatial import cKDTree
    Bm = load_base(); vs = Bm["vset"]; Pc = np.load(os.path.join(PARTS, "body.npz"))["P"][:len(Bm["P"])]
    tree = cKDTree(Pc)
    q = pos[cov]
    dist, idx = tree.query(q, k=4)
    wgt = 1.0 / np.maximum(dist, 1e-4); wgt /= wgt.sum(1, keepdims=True)
    def soft(sets):
        v = np.isin(vs, sets).astype(np.float64)
        m = np.zeros((H, W)); m[cov] = (wgt * v[idx]).sum(1); return m
    lipness, eyeness = soft([7, 8]), soft([2, 3])
    base = srgb_to_lin(c["skin"])
    tone = 1.0 + 0.045 * _noise(pos, 6.0) + 0.02 * _noise(pos, 23.0)
    tone *= 1 - 0.05 * smooth01((0.55 - zz) / 0.25)                       # shins a touch darker
    tone *= 1 - 0.04 * smooth01((np.abs(x) - 0.40) / 0.1)                 # forearms
    tone *= 1 - 0.03 * np.exp(-((zz - 1.14) / 0.08) ** 2) * (y < -0.05)   # abdomen shading (very soft)
    tone *= 1 + 0.035 * np.exp(-((zz - 1.30) / 0.06) ** 2) * (y < -0.06)  # chest lighter
    alb = base[None, None, :] * tone[..., None]
    rough = np.full((H, W), 0.62)
    front = y < -0.075
    # --- face
    for key in ("eye_L", "eye_R"):
        e = np.array(c[key]); sx = 1 if e[0] > 0 else -1
        dx, dz = x - e[0], zz - e[2]
        # brow: arched band above the eye
        bx = dx * sx                                                        # + = outer
        arch = 0.0185 + 0.0050 * np.exp(-((bx - 0.010) / 0.013) ** 2) - 0.0055 * smooth01((bx - 0.020) / 0.012)
        th = 0.0052 - 0.0038 * smooth01((bx - 0.008) / 0.024) - 0.0010 * smooth01((-bx - 0.008) / 0.012)
        brow = np.exp(-((dz - arch) / th) ** 4) * (bx > -0.020) * (bx < 0.036) * front * (y < -0.09)
        brow *= 1 - 0.45 * smooth01((bx - 0.028) / 0.008)
        brow *= 0.85 + 0.3 * _noise(pos, 140.0)
        alb = alb * (1 - brow[..., None]) + srgb_to_lin(c["brow"])[None, None, :] * brow[..., None]
        # upper lash line: band along the upper lid margin (an ellipse round the opening), 2 mm, outer third thicker
        near_eye = (np.abs(dx) < 0.030) & (np.abs(dz) < 0.022) & front
        ring = np.exp(-((eyeness - 0.18) / 0.12) ** 2) * near_eye * smooth01((eyeness - 0.03) / 0.05)
        up = smooth01((dz + 0.001) / 0.003)
        lash = ring * up * (1.0 + 0.5 * smooth01((bx - 0.002) / 0.008))
        a_ = np.clip(lash * 1.6, 0, 1)
        alb = alb * (1 - a_[..., None]) + srgb_to_lin(c["lash"])[None, None, :] * a_[..., None]
        lo = ring * (1 - up) * 0.8 * smooth01((bx + 0.004) / 0.012)
        alb = alb * (1 - lo[..., None]) + srgb_to_lin(c["lash_lo"])[None, None, :] * lo[..., None]
        # war paint: two feathered ochre swipes below the cheekbone, running from the nose side up and out
        for k, off in enumerate((0.0, 0.015)):
            t = (bx - 0.020) / 0.036                                        # 0..1 along the swipe (outer = +)
            zc = e[2] - 0.030 - off + 0.010 * t                              # rises outward, on the cheekbone
            band = np.exp(-((zz - zc) / 0.0055) ** 2) * (t > -0.05) * (t < 1.0) * front * (y < -0.06)
            band *= smooth01((1.0 - t) / 0.25) * smooth01((t + 0.05) / 0.12)
            edge = 0.75 + 0.45 * _noise(pos, 90.0)                           # broken edges
            band = np.clip(band * edge, 0, 1) * 0.97
            alb = alb * (1 - band[..., None]) + srgb_to_lin(c["paint"])[None, None, :] * band[..., None]
            rough = np.where(band > 0.3, 0.80, rough)
    # lips: ellipse around the lip centre on the front, with a darker closed line and a lit lower roll
    L = np.array(c["lip_c"])
    dx, dz = x - L[0], zz - L[2]
    lipm = smooth01((lipness - 0.22) / 0.3) * (y < -0.105) * (zz > 1.565) * (zz < 1.615) * (np.abs(dx) < 0.03)
    alb = alb * (1 - lipm[..., None]) + srgb_to_lin(c["lip"])[None, None, :] * lipm[..., None]
    border = np.exp(-((lipness - 0.30) / 0.07) ** 2) * (y < -0.105) * (zz > 1.565) * (zz < 1.615) * (np.abs(dx) < 0.03) * 0.5
    alb = alb * (1 - border[..., None]) + srgb_to_lin(c["lip_line"])[None, None, :] * border[..., None]
    line = np.exp(-(dz / 0.0012) ** 2) * (np.abs(dx) < 0.022) * np.maximum(lipm, 0.6 * (lipness > 0.15))
    alb = alb * (1 - line[..., None]) + srgb_to_lin(c["lip_line"])[None, None, :] * line[..., None]
    roll = np.exp(-((dz + 0.0045) / 0.0025) ** 2) * (np.abs(dx) < 0.012) * lipm * 0.12
    alb = alb * (1 + roll[..., None])
    rough = np.where(lipm > 0.5, 0.45, rough)
    # eye sockets (inner lid rims) slightly darker/warm
    for key in ("eye_L", "eye_R"):
        inner = smooth01((eyeness - 0.6) / 0.2) * (y < -0.09)
        alb *= (1 - 0.45 * inner)[..., None]
    # --- AO soften (missed rays bake to 0): floor, then half-strength
    aos = np.maximum(ao, 0.25); aos = 1 - 0.65 * (1 - aos)
    facez = smooth01((zz - 1.50) / 0.04) * (y < -0.04)                   # the face: AO at a third (no gaunt cheeks at the close cam)
    aos = aos * (1 - facez) + (1 - 0.22 * (1 - np.maximum(ao, 0.4))) * facez
    tone_f = 1 + 0.05 * np.exp(-((zz - 1.615) / 0.03) ** 2) * np.exp(-((np.abs(x) - 0.05) / 0.02) ** 2) * (y < -0.09)
    alb = alb * tone_f[..., None]                                          # cheekbone lift
    # --- assemble + dilate
    alb8 = lin_to_srgb(alb); alb8[~cov] = 0
    alb8 = dilate_np(alb8.astype(np.float32), cov, 14)
    nrm_d = dilate_np(nrm.astype(np.float32), cov, 14); nrm_d[~cov & (nrm_d.sum(-1) == 0)] = (0.5, 0.5, 1.0)
    orm = np.stack([aos, rough, np.zeros_like(rough)], -1).astype(np.float32); orm[~cov] = 0
    orm = dilate_np(orm, cov, 14)
    far = ~cov
    # untouched texels: flat defaults
    alb8[far & (alb8.sum(-1) == 0)] = lin_to_srgb(base)
    orm[far & (orm.sum(-1) == 0)] = (1.0, 0.62, 0.0)
    nrm_d[nrm_d.sum(-1) == 0] = (0.5, 0.5, 1.0)
    A = (np.clip(alb8, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]      # image rows top-down (v=1 at the top)
    O = (np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]
    Nn = (np.clip(nrm_d, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]
    # eyes: lat-long islands (bottom strip), repainted on top
    eye_boxes = [(1280 - 136, 8, 1280 - 8, 72), (1280 - 272, 8, 1280 - 144, 72)]
    for (x0, y0, x1, y1) in eye_boxes:
        h, w = y1 - y0, x1 - x0
        lat = (np.arange(h)[:, None] + 0.5) / h * 180.0 * np.ones((1, w)); lon = (np.arange(w)[None, :] + 0.5) / w * 360.0 * np.ones((h, 1))
        sub = np.zeros((h, w, 3), np.uint8); sub[:] = (232, 226, 218)
        iris = lat < 28
        rad = np.clip(lat / 28, 0, 1)
        col = np.stack([128 - 50 * rad, 92 - 40 * rad, 44 - 20 * rad], -1)   # amber -> darker hazel at the limbus
        sub[iris] = col[iris].astype(np.uint8)
        sub[(lat >= 25.5) & (lat < 28)] = (62, 42, 22)
        sub[lat < 10] = (10, 7, 6)
        spoke = (np.sin(np.radians(lon) * 18) > 0.6) & (lat > 9) & (lat < 20)
        sub[spoke] = (sub[spoke] * 0.85).astype(np.uint8)
        cl = (np.abs(lat - 9.0) < 3.4) & (np.abs(((lon - 300 + 180) % 360) - 180) < 22)      # catchlight (upper-left of the pupil)
        sub[cl] = (250, 248, 244)
        A[H - y1:H - y0, x0:x1] = sub
        O[H - y1:H - y0, x0:x1] = (255, 40, 0)
        Nn[H - y1:H - y0, x0:x1] = (128, 128, 255)
    os.makedirs(tiles_dir, exist_ok=True)
    Image.fromarray(A).save(os.path.join(tiles_dir, "skin_albedo.png"))
    Image.fromarray(O).save(os.path.join(tiles_dir, "skin_orm.png"))
    Image.fromarray(Nn).save(os.path.join(tiles_dir, "skin_normal.png"))
    log(f"tiles painted -> {tiles_dir} (coverage {cov.mean()*100:.1f} %)")


if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    a = a or [""]
    if a[0] == "fit":
        ck = int(a[a.index("--ckpt") + 1]) if "--ckpt" in a else 1
        tag = a[a.index("--tag") + 1] if "--tag" in a else "fit"
        run_fit(ck, tag)
    elif a[0] == "measure":
        import seraphine_r29_team as T
        R = T.Rig(); p = T.load_part(PARTS, "body")
        print_measures(measure_mesh(p["P"], p["F"], R.joints))
    elif a[0] == "paint":
        paint_tiles()
    elif a[0] == "export-uv":
        export_uv_from_bundle()
    elif a[0] == "bake":
        run_bake(a[1] if len(a) > 1 else os.path.join(WORK, "bake"))
    else:
        print(__doc__)
