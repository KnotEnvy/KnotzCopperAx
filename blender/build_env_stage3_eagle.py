"""Stage 3 hero asset: the colossal eagle's NECK + HEAD (+ separate lower beak) for Eaglespine Skies.

Authored at GAME scale (1 Blender unit = 1 m). Blender coords: Z up, the eagle faces +X (glTF +X), Blender -Y = the
camera side (glTF +Z). The neck leaves the shoulders at the origin and rises forward to a fierce raptor head: a heavy
supraorbital brow shelf shading a huge amber eye, a yellow cere and a deep hooked slate beak. The whole surface is
shingled with lanceolate feathers (displaced geometry, tips pointing back/down toward the body): golden hackles on
the nape and crown, dark umber on the throat and neck base.

Objects (each with its own origin so the stage can animate them):
  eagle_neck  origin = neck base (shoulders)            static
  eagle_head  origin = head pivot (top of the neck)      yaw/pitch for looks + screeches
  eagle_jaw   origin = gape hinge (child in the stage)  opens on a screech
Vertex colour COLOR_0 (linear): rgb = painted albedo (AO baked), a = mask: 0 feather, 0.25 beak/cere (gloss),
0.5 iris (glow), 1.0 catchlight.
Run:  blender -b --factory-startup -P blender/build_env_stage3_eagle.py [-- --fast] [--preview]
Out:  public/assets/models/env_stage3_eagle.glb
"""
import os
import sys
import importlib
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
import numpy as np
from lib import sdf, meshutil, pipeline
for _m in (sdf, meshutil, pipeline):
    importlib.reload(_m)
from lib.sdf import V, Sculpt, Sphere, Ellipsoid, RoundCone, Capsule, Union, Chain, Func, Bounded

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "models", "env_stage3_eagle.glb")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FAST = "--fast" in ARGV


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    t = np.asarray(t)
    if t.ndim == 1:
        t = t[:, None]
    return a * (1 - t) + b * t


# ----------------------------------------------------------------------------- layout (metres)
NECK = [V(-0.9, 0, -0.9), V(0.0, 0, 0.0), V(0.75, 0, 1.0), V(1.3, 0, 2.0), V(1.65, 0, 2.85)]
NECK_R = [1.85, 1.6, 1.32, 1.12, 1.0]
PIVOT = V(1.6, 0, 2.7)                    # head pivot (inside the top of the neck)
HC = V(2.55, 0, 3.25)                     # cranium centre
EYE = (2.95, 0.66, 3.42)                  # x, |y|, z of the eyeball centre
EYE_R = 0.27
HINGE = V(3.05, 0, 2.86)                  # lower-beak hinge
SPINE = NECK + [V(2.0, 0, 3.15), V(2.8, 0, 3.3), V(3.5, 0, 3.2)]   # feather-flow axis (neck → crown → forehead)


def spine_param(X, Y, Z, pts=SPINE):
    P = np.stack([X, Y, Z], -1)
    best = np.full(X.shape, 1e9)
    s = np.zeros(X.shape)
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L = float(np.linalg.norm(ab))
        t = np.clip(((P - a) @ ab) / (L * L), 0, 1)
        q = a + t[..., None] * ab
        d = np.linalg.norm(P - q, axis=-1)
        m = d < best
        best = np.where(m, d, best)
        s = np.where(m, acc + t * L, s)
        acc += L
    return s


def feather_cells(x, y, z, s, fs, fw, seed=0):
    """Overlapping lanceolate feather cells along the flow axis. Returns (h 0 base..1 tip, side 1 centre..0 split,
    cell hash 0..1). Tips point toward low arc length (toward the body)."""
    ang = np.arctan2(y, z - 0.35 * x)
    u = s / fs
    iu = np.floor(u)
    v = ang * 1.25 / fw + 0.5 * np.mod(iu, 2.0) + 0.1 * sdf.vnoise(x * 3, y * 3, z * 3, seed)
    iv = np.floor(v)
    fv = v - iv - 0.5
    fu = u - iu
    fu2 = fu - 2.6 * fv * fv                          # pointed tip edge
    h = np.clip(1.0 - fu2, 0.0, 1.0) ** 1.3
    side = 1.0 - smooth01(0.3, 0.5, np.abs(fv))
    cid = sdf._hash(iu.astype(np.int64), iv.astype(np.int64), np.zeros(iu.shape, np.int64), seed)
    return h, side, cid


def shingles(base, size_fn, amp, seed=0, band=0.09):
    """Wrap `base` with overlapping lanceolate feathers: each feather's exposed tip rises toward its edge and steps
    down onto the next one (tips point toward low arc length = toward the body)."""
    def fn(X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        d = base.d(X, Y, Z)
        near = np.abs(d) < band
        if not np.any(near):
            return d
        x, y, z = X[near], Y[near], Z[near]
        s = spine_param(x, y, z)
        fs, fw, a = size_fn(x, y, z, s)
        h, side, cid = feather_cells(x, y, z, s, fs, fw, seed)
        rel = h * (0.35 + 0.65 * side) - 0.5 + 0.15 * (cid - 0.5)
        out = d.copy()
        out[near] = d[near] - a * rel
        return out
    return Bounded(Func(fn, base.lo - 0.12, base.hi + 0.12), base.lo - 0.12, base.hi + 0.12)


def neck_size(x, y, z, s):
    head = smooth01(4.6, 5.4, s)
    fs = 0.42 - 0.2 * head               # feather length (m) along the flow
    fw = 0.34 - 0.16 * head
    a = 0.07 - 0.035 * head
    return fs, fw, a


def build_neck():
    S = Sculpt(materials=("feather",), default_mat="feather")
    body = Chain(NECK, NECK_R, squash=(0.86, 1.0), ref=(0, 0, 1), k=0.25)
    # ruff: a thick collar of hackles where the neck meets the shoulders + throat bulge
    ruff = Union(body, Ellipsoid(V(0.2, 0, 0.35), V(1.55, 1.55, 1.25)), Ellipsoid(V(0.9, 0, 0.3), V(1.0, 1.05, 1.0)), k=0.35)
    S.add(shingles(ruff, neck_size, 1.0, seed=3), 0.0, "feather")
    return S


def head_size(x, y, z, s):
    face = smooth01(2.4, 3.1, x)
    fs = 0.24 - 0.1 * face
    fw = 0.2 - 0.08 * face
    a = 0.045 - 0.025 * face
    return fs, fw, a


def build_head():
    S = Sculpt(materials=("feather", "beak", "eye"), default_mat="feather")
    parts = [
        Sphere(PIVOT + V(0.05, 0, 0.0), 1.02),                                  # collar hides the pivot joint
        Capsule(PIVOT, HC + V(-0.35, 0, -0.05), 0.95),
        Ellipsoid(HC, V(1.08, 0.8, 0.78)),                                      # cranium
        Ellipsoid(HC + V(0.35, 0, -0.35), V(0.8, 0.66, 0.55)),                   # cheeks / face
        Ellipsoid(HC + V(-0.3, 0, -0.6), V(0.9, 0.72, 0.6)),                     # throat
        Ellipsoid(HC + V(0.1, 0, 0.42), V(0.85, 0.58, 0.34)),                    # flat crown
    ]
    body = Union(*parts, k=0.28)
    S.add(shingles(body, head_size, 1.0, seed=7, band=0.07), 0.0, "feather")
    for sy in (-1, 1):
        E = V(EYE[0], sy * EYE[1], EYE[2])
        S.sub(Sphere(E + V(0.02, sy * 0.1, 0.0), EYE_R + 0.03), 0.04)                   # socket
        S.add(Sphere(E, EYE_R), 0.0, "eye")
        # the raptor's supraorbital shelf: a hard brow overhanging the top of the eye (the "fierce" read) + lower lid
        S.add(Capsule(E + V(-0.5, -sy * 0.1, 0.16), E + V(0.34, sy * 0.1, 0.13), 0.15), 0.1, "feather")
        S.add(Capsule(E + V(0.1, sy * 0.08, 0.17), E + V(0.5, -sy * 0.12, 0.02), 0.11), 0.08, "feather")
        S.add(Capsule(E + V(-0.22, sy * 0.03, -0.23), E + V(0.2, sy * 0.03, -0.21), 0.07), 0.04, "feather")
    # cere (fleshy yellow base) + a DEEP upper mandible whose culmen curves down from the cere to a sharp hook
    cere = Ellipsoid(V(3.5, 0, 3.1), V(0.4, 0.43, 0.44))
    S.add(cere, 0.12, "beak")
    upper = Union(Ellipsoid(V(3.88, 0, 2.98), V(0.62, 0.36, 0.44)),
                  RoundCone(V(4.12, 0, 2.98), V(4.5, 0, 2.66), 0.3, 0.14, squash=(0.74, 1.0), ref=(0, 0, 1)),
                  RoundCone(V(4.5, 0, 2.68), V(4.47, 0, 2.3), 0.13, 0.03, squash=(0.7, 1.0), ref=(0, 0, 1)), k=0.18)
    S.add(upper, 0.08, "beak")
    S.sub(Ellipsoid(V(3.75, 0, 2.5), V(0.75, 0.6, 0.12)), 0.04)                   # flat tomium / gape underside
    for sy in (-1, 1):
        S.sub(Ellipsoid(V(3.62, sy * 0.32, 3.2), V(0.1, 0.07, 0.05)), 0.02)       # nostrils in the cere
    S.paint_mat(Union(Ellipsoid(V(3.5, 0, 3.1), V(0.44, 0.47, 0.48)), Ellipsoid(V(3.88, 0, 2.98), V(0.65, 0.39, 0.47)),
                      RoundCone(V(4.12, 0, 2.98), V(4.5, 0, 2.66), 0.33, 0.17, squash=(0.74, 1.0), ref=(0, 0, 1)),
                      RoundCone(V(4.5, 0, 2.68), V(4.47, 0, 2.3), 0.16, 0.06, squash=(0.7, 1.0), ref=(0, 0, 1)), k=0.05), "beak")
    return S


def build_jaw():
    S = Sculpt(materials=("beak",), default_mat="beak")
    low = Union(RoundCone(V(3.1, 0, 2.6), V(4.05, 0, 2.58), 0.26, 0.1, squash=(0.8, 0.7), ref=(0, 0, 1)),
                RoundCone(V(4.0, 0, 2.58), V(4.2, 0, 2.52), 0.1, 0.04, squash=(0.8, 0.7), ref=(0, 0, 1)), k=0.1)
    S.add(low, 0.0, "beak")
    return S


# ----------------------------------------------------------------------------- paint
FEATHER_DARK = srgb("#3a2414")
FEATHER_MID = srgb("#6a4222")
GOLD = srgb("#c8903c")
GOLD_HI = srgb("#f0c870")
CERE = srgb("#e8b020")
HORN = srgb("#7a8288")
SLATE = srgb("#23262c")
IRIS = srgb("#f0a818")
IRIS_RIM = srgb("#8a3a08")


def paint(ob, prim, kind, sdf_fn):
    me = ob.data
    P = meshutil.get_verts(ob)
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    n = len(P)
    Nn = pipeline.vertex_normals(ob)
    # AO: how open the surface is (sdf sampled out along the normal)
    occ = np.zeros(n)
    for dist in (0.12, 0.3, 0.6):
        q = P + Nn * dist
        dd = sdf_fn(q[:, 0], q[:, 1], q[:, 2])
        occ += np.clip((dist - dd) / dist, 0, 1) / 3.0
    ao = np.clip(1.0 - occ * 1.3, 0.2, 1.0)
    mid = np.zeros(n, np.float32)
    if "mat_id" in me.attributes:
        me.attributes["mat_id"].data.foreach_get("value", mid)
    fine = sdf.fbm(X, Y, Z, 3, 5.0, seed=11)
    s = spine_param(X, Y, Z)
    # feathers: umber body → gold hackles up the nape/crown, darker throat; pale feather tips (recess dark)
    up = smooth01(-0.2, 0.7, Nn[:, 2])
    gold = smooth01(2.2, 4.8, s) * (0.35 + 0.65 * up) + smooth01(4.6, 5.6, s) * 0.5
    gold = np.clip(gold, 0, 1)
    col = mix(FEATHER_DARK, FEATHER_MID, smooth01(0.5, 2.5, s))
    col = mix(col, GOLD, gold * 0.85)
    col = mix(col, GOLD_HI, np.clip(gold - 0.6, 0, 1) * up * 0.9)
    face = smooth01(2.5, 3.2, X) * (1 - smooth01(3.3, 3.5, X))
    col = mix(col, srgb("#4a3020"), face * 0.35)
    throat = smooth01(0.2, -0.6, Nn[:, 2]) * smooth01(1.5, 3.5, s)
    col = mix(col, srgb("#2a1a10"), throat * 0.5)
    col = col * (0.85 + 0.3 * fine)[:, None]
    # per-feather value: dark overlapped base → lit, paler tip edge; each feather its own shade
    size_fn = neck_size if kind == "neck" else head_size
    fs, fw, _a = size_fn(X, Y, Z, s)
    fh, fside, fcid = feather_cells(X, Y, Z, s, fs, fw, 3 if kind == "neck" else 7)
    tipc = mix(col * 1.45, GOLD_HI, 0.25 * gold[:, None] if gold.ndim == 1 else 0.25)
    col = mix(col * 0.55, tipc, (fh ** 1.6)[:, None])
    col = col * (0.8 + 0.4 * fcid)[:, None] * (0.7 + 0.3 * fside)[:, None]
    col = col * ao[:, None]
    glow = np.zeros(n)
    if kind in ("head", "jaw"):
        beak = np.abs(mid - 1) < 0.5
        eye = np.abs(mid - 2) < 0.5
        # beak: yellow cere → pale horn → slate hooked tip; dark gape edge
        tb = smooth01(3.7, 4.7, X)
        bc = mix(CERE, HORN, smooth01(3.62, 3.9, X))
        bc = mix(bc, SLATE, tb ** 1.2)
        bc = bc * (0.8 + 0.2 * smooth01(-0.3, 0.6, Nn[:, 2]))[:, None]
        col[beak] = bc[beak] * np.clip(ao[beak] * 1.15, 0, 1)[:, None]
        glow[beak] = 0.25
        if np.any(eye):
            ay = np.abs(Y)
            # distance from the eye's lateral axis (pupil faces outward, slightly forward)
            E = np.stack([np.full(n, EYE[0]), np.sign(Y) * EYE[1], np.full(n, EYE[2])], -1)
            dv = P - E
            ax = np.stack([np.full(n, 0.22), np.sign(Y) * 0.97, np.full(n, 0.05)], -1)
            ax /= np.linalg.norm(ax, axis=1, keepdims=True)
            along = (dv * ax).sum(1)
            rad = np.linalg.norm(dv - along[:, None] * ax, axis=1) / EYE_R
            ic = mix(IRIS, IRIS_RIM, smooth01(0.45, 0.8, rad))
            ic = mix(ic, np.array([0.004, 0.003, 0.002]), 1 - smooth01(0.36, 0.42, rad))
            cat = (np.linalg.norm(dv - (ax * EYE_R * 0.93 + np.array([0.1, 0, 0.12])), axis=1) < 0.05)
            ec = ic
            g = np.where(rad < 0.4, 0.0, 0.5)
            g = np.where(cat, 1.0, g)
            ec = np.where(cat[:, None], np.array([1.0, 0.97, 0.9]), ec)
            col[eye] = ec[eye]
            glow[eye] = g[eye]
            _ = ay
    meshutil.add_color_attr(ob, "Col", np.concatenate([col, glow[:, None]], axis=1).astype(np.float32))


def sdf_of(S):
    prims = [op.prim for op in S.ops if op.kind == "add"]
    u = Union(*prims, k=0.0)
    return lambda X, Y, Z: u.d(X, Y, Z)


def mesh_from(S, name, target, h):
    t0 = time.time()
    ob = pipeline.sculpt_mesh(S, name, h, attrs=True, face_mats=False)
    meshutil.decimate(ob, target, symmetry=True)
    meshutil.triangulate(ob)
    print(name, "tris", meshutil.tri_count(ob), f"{time.time() - t0:.1f}s", flush=True)
    return ob


def set_origin(ob, p):
    """Move the mesh so `p` becomes its local origin, and place the object at p."""
    P = meshutil.get_verts(ob)
    meshutil.set_verts(ob, P - np.asarray(p)[None, :])
    ob.location = tuple(p)


def preview(out):
    from lib import preview as pv
    importlib.reload(pv)
    pv.setup_workbench("VERTEX")
    views = [dict(target=(3.0, 0, 3.0), dist=7.0, yaw=0, pitch=4, lens=60),
             dict(target=(2.0, 0, 1.8), dist=11.0, yaw=-35, pitch=10, lens=50),
             dict(target=(3.6, -0.6, 3.1), dist=3.2, yaw=-15, pitch=5, lens=60)]
    pv.render_views(out, views, res=(640, 640))


def main():
    meshutil.clear_scene()
    Sn = build_neck()
    neck = mesh_from(Sn, "eagle_neck", 12000 if FAST else 26000, 0.07 if FAST else 0.045)
    paint(neck, Sn, "neck", sdf_of(Sn))
    Sh = build_head()
    head = mesh_from(Sh, "eagle_head", 14000 if FAST else 30000, 0.045 if FAST else 0.028)
    paint(head, Sh, "head", sdf_of(Sh))
    Sj = build_jaw()
    jaw = mesh_from(Sj, "eagle_jaw", 1500 if FAST else 3000, 0.04 if FAST else 0.025)
    paint(jaw, Sj, "jaw", sdf_of(Sj))
    for ob in (neck, head, jaw):
        me = ob.data
        for a in list(me.attributes):
            if a.name.startswith("p_") or a.name == "mat_id":
                me.attributes.remove(a)
        for p in me.polygons:
            p.use_smooth = True
    if "--preview" in ARGV:
        preview(os.path.join(ROOT, "progress", "tmp", "stage3_eagle_preview.png"))
    set_origin(head, PIVOT)
    set_origin(jaw, HINGE)
    jaw.parent = head
    jaw.location = tuple(HINGE - PIVOT)
    meshutil.select_only([neck, head, jaw], neck)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    kw = dict(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_texcoords=False, export_normals=True, export_materials="NONE", export_animations=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print("WROTE", OUT, os.path.getsize(OUT), flush=True)


main()
