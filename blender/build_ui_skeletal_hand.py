"""Select-screen giant skeletal hand (ui-flow): anatomically sculpted RIGHT hand bones, palm up, fingers rising
behind the hero and curling forward over it (the same pose/skeleton the procedural JS hand used, so the select
set composition is unchanged). The JS side mirrors it for the left hand.

    blender -b --factory-startup --python blender/build_ui_skeletal_hand.py
      -> public/assets/models/ui_skeletal_hand.glb (one mesh 'ui_skeletal_hand', COLOR_0 = grime/age tint)

r8 NOTE: the shipped GLB is built slot-free by blender/ui_hand_offline.py (it imports this file's build() with a stubbed bpy, meshes it
with OpenVDB and shades from the SDF - see that file); the Blender main() below is the older mesh-colourize path kept for reference.
r8 hand = real skeletal-hand proportions (metacarpal 1.0 : proximal .55 : middle .35 : distal .25, lengthened ~1.2x): four metacarpals
fan out of a carpal block, each finger = 3 tapering phalanges (narrow waisted shaft, small flared articular head, open joint gap) that CURL
inward joint by joint, a thumb, radius + ulna sinking into a heap of barrow earth.

Anatomy per bone (r7 text, superseded where the above differs): phalanges = flared base (articular facet) + waisted, dorso-palmar flattened shaft + bicondylar
head (trochlea) ; distal phalanges end in a spade tuft ; metacarpals = squared base + long shaft + round head ;
8 carpals in two rows ; radius (broad distal end + styloid) and ulna (slender, round head + styloid). Joint
spaces are left open (skeleton, not a glove). Surface = fbm pitting. Colour = cavity-dark, ridge-ivory vertex tint.
Coordinates are authored in the JS frame (Y up, +Z toward camera) and converted to Blender (x, -z, y).
"""
import os
import sys
import math
import time
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np
import bpy

from lib import sdf, meshutil, pipeline
for _m in (sdf, meshutil, pipeline):
    importlib.reload(_m)
from lib.sdf import V, norm, basis, Sculpt, Sphere, Ellipsoid, RoundCone, RoundBox, Diff, Union, Displace

ROOT = os.path.dirname(HERE)
OUT = os.environ.get("HAND_OUT") or os.path.join(ROOT, "public", "assets", "models", "ui_skeletal_hand.glb")
H = float(os.environ.get("HAND_H", "0.011"))
TRIS = int(os.environ.get("HAND_TRIS", "36000"))
LOG = pipeline.LOG


def J(x, y, z):
    """JS frame (Y up, +Z toward camera) -> Blender (Z up, -Y toward camera)."""
    return V(x, -z, y)


def jv(p):
    return J(*p)


LAT = V(1.0, 0.0, 0.0)


def frame(d):
    return basis(d, LAT)  # col0 along bone, col1 lateral, col2 dorso-palmar


JOINTS = []  # (centre, radius) of every joint space: crevice grime in colorize()
TOP = 1.10   # y of the palm bone centre-line (the heroes stand on PALM_Y = 1.18 hand units)


def bone(a, b, wa, wb, shaft=0.80, lat=1.0, dors=0.84, gap=0.03, ends=(True, True), kind="phal", seed=0):
    """r8: one long bone from joint point a to joint point b (Blender coords). A NARROW waisted shaft (`shaft` x the joint half-width)
    flares into a small articular head at each end (ellipsoid wa / wb wide, 0.72 long); `gap` is the open joint space to the
    neighbour. Distal phalanges taper to a flat tuft. lat/dors = lateral / dorso-palmar section scale of the shaft."""
    a, b = V(a), V(b)
    d = norm(b - a)
    M = frame(d)
    JOINTS.append((a, wa * 1.6)); JOINTS.append((b, wb * 1.6))
    rng = np.random.default_rng(seed)
    wa, wb = wa * (1 + 0.05 * rng.uniform(-1, 1)), wb * (1 + 0.05 * rng.uniform(-1, 1))
    a2, b2 = a + d * (gap / 2), b - d * (gap / 2)
    ca, cb = a2 + d * (wa * 0.62), b2 - d * (wb * 0.62)
    # shaft waist: slightly bowed (dorsal) so no two bones are straight rods
    parts = [RoundCone(ca, cb, wa * shaft, wb * shaft, squash=(lat, dors), ref=tuple(LAT))]
    if ends[0]:
        parts.append(Ellipsoid(ca, (wa * 0.62, wa * max(lat, 1.0) * 1.04, wa * dors * 1.06), M))
    if ends[1] and kind != "dist":
        parts.append(Ellipsoid(cb, (wb * 0.62, wb * max(lat, 1.0) * 1.04, wb * dors * 1.06), M))
    if kind == "dist":   # distal phalanx: tapers to a flat curved tuft (the fingertip)
        tip = b2 + d * (wb * 1.1)
        parts.append(RoundCone(cb - d * wb * 1.2, tip, wb * 0.95, wb * 0.30, squash=(1.15, 0.5), ref=tuple(LAT)))
    return Union(*parts, k=wa * 0.28)


def carpal_mass():
    """Wrist: two rows of irregular fused carpal stones on a thin plate, a pisiform and a trapezium - the base the metacarpals
    and the forearm both visibly run into."""
    rows = [(0.57, [(-0.40, 0.11, 0.095, 0.105), (-0.14, 0.12, 0.10, 0.105), (0.13, 0.12, 0.10, 0.105), (0.39, 0.115, 0.095, 0.105)]),
            (0.79, [(-0.36, 0.115, 0.10, 0.10), (-0.12, 0.125, 0.105, 0.10), (0.13, 0.125, 0.105, 0.10), (0.36, 0.115, 0.10, 0.10)])]
    parts = []
    for ri, (z, items) in enumerate(rows):
        for ci, (x, rx, ry, rz) in enumerate(items):
            r = np.random.default_rng(40 + ri * 7 + ci)
            parts.append(Ellipsoid(jv((x + r.uniform(-.02, .02), TOP + 0.01 + 0.012 * ri + r.uniform(-.01, .02), z + r.uniform(-.02, .02))), (rx, rz, ry), None))
    parts.append(RoundBox(jv((0.0, TOP - 0.02, 0.68)), (0.46, 0.22, 0.05), None, r=0.045))   # the wrist plate the stones sit in
    parts.append(Ellipsoid(jv((-0.52, TOP - 0.02, 0.84)), (0.07, 0.085, 0.07), None))      # pisiform
    parts.append(Ellipsoid(jv((0.50, TOP - 0.02, 0.62)), (0.09, 0.09, 0.075), None))        # trapezium (thumb base)
    return Union(*parts, k=0.06)


def build():
    S = Sculpt(materials=("bone",), default_mat="bone")
    bones = [carpal_mass()]

    # --- forearm: radius + ulna descend out of the wrist toward the viewer (a hand held up from the barrow): broad distal ends,
    #     slim waisted shafts, an open interosseous gap
    wr0 = (0.20, TOP - 0.02, 0.98)
    bones.append(bone(jv((0.20, TOP - 0.03, 1.00)), jv((0.26, 0.15, 1.22)), 0.15, 0.125, shaft=0.80, dors=0.92, gap=0.0, ends=(False, False), kind="forearm", seed=1))
    bones.append(bone(jv((-0.22, TOP - 0.03, 1.00)), jv((-0.28, 0.13, 1.24)), 0.135, 0.11, shaft=0.80, dors=0.92, gap=0.0, ends=(False, False), kind="forearm", seed=2))

    # --- four fingers: metacarpal fanning out of the carpal block, then 3 tapering phalanges (real proportions 1.0 : .55 : .35 : .25,
    #     lengthened ~1.2x) that CURL inward - each joint flexes more than the one before, the outer fingers lean in toward the hero
    fx = [-0.56, -0.19, 0.19, 0.56]                       # pinky ... index (thumb side)
    FS = [0.78, 0.97, 1.0, 0.92]
    KZ = [-0.46, -0.64, -0.62, -0.50]                     # knuckle row is an arc: middle finger furthest back
    CURL = [(0.10, 0.46, 0.98), (0.12, 0.48, 1.0), (0.12, 0.50, 1.02), (0.10, 0.48, 1.0)]   # flexion (rad from vertical) at each phalanx
    for i, x in enumerate(fx):
        s, sw = FS[i], FS[i] ** 0.5
        base = (x * 0.55, TOP, 0.47)
        kn = (x * 1.04, TOP + 0.01, KZ[i])
        meta_w = (0.105 * sw, 0.128 * sw)
        bones.append(bone(jv(base), jv(kn), meta_w[0], meta_w[1], shaft=0.82, lat=1.65, dors=0.78, gap=0.034, kind="meta", seed=i * 7))
        L = (0.64 * s, 0.40 * s, 0.30 * s)
        W = (0.150 * sw, 0.114 * sw, 0.094 * sw, 0.078 * sw)
        side = math.copysign(1.0, x)
        psi = (side * (0.10 + abs(x) * 0.22), -side * (0.04 + abs(x) * 0.2), -side * (0.20 + abs(x) * 0.5))   # lateral lean: out, then in
        p = np.array(kn, float)
        for k in range(3):
            al, ps = CURL[i][k], psi[k]
            dv = np.array([math.sin(ps), math.cos(al) * math.cos(ps), math.sin(al) * math.cos(ps)])
            q = p + dv * (L[k] + (0.03 if k < 2 else 0.0))
            bones.append(bone(jv(p), jv(q), W[k], W[k + 1], shaft=0.80, kind="dist" if k == 2 else "phal", seed=i * 7 + 1 + k, gap=0.028))
            p = q

    # --- thumb: trapezium-anchored metacarpal lying out along the palm edge, then two phalanges rising and curling in
    t0, t1 = (0.50, TOP - 0.01, 0.42), (1.02, TOP + 0.03, 0.02)
    bones.append(bone(jv(t0), jv(t1), 0.12, 0.12, shaft=0.74, lat=1.3, dors=0.8, gap=0.034, kind="meta", seed=90))
    t2 = (1.20, 1.62, -0.10)
    bones.append(bone(jv(t1), jv(t2), 0.14, 0.115, shaft=0.74, seed=91, gap=0.03))
    t3 = (1.02, 1.98, 0.14)
    bones.append(bone(jv(t2), jv(t3), 0.115, 0.055, shaft=0.74, kind="dist", seed=92, gap=0.03))

    for b in bones:
        S.add(b, 0.0, "bone")  # hard union: creases at joints stay crisp
    return S


def bake_ao(ob, rays=14, dist=0.32, seed=5):
    """Real per-vertex ambient occlusion (BVH hemisphere rays) -> 0 (buried in a joint gap) .. 1 (open)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    P = meshutil.get_verts(ob)
    N = pipeline.vertex_normals(ob)
    me = ob.data
    bvh = BVHTree.FromPolygons([tuple(v) for v in P], [tuple(p.vertices) for p in me.polygons])
    rng = np.random.default_rng(seed)
    u = rng.random((rays, 2))
    ang, rad = u[:, 0] * 2 * math.pi, np.sqrt(u[:, 1])
    loc = np.stack([rad * np.cos(ang), rad * np.sin(ang), np.sqrt(np.maximum(0.0, 1 - rad * rad))], axis=1)  # cosine hemisphere (z up)
    ao = np.ones(len(P))
    for i in range(len(P)):
        n = N[i]
        t = np.cross(n, (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)); t /= max(np.linalg.norm(t), 1e-9)
        bt = np.cross(n, t)
        o = Vector(P[i] + n * 0.004)
        hit = 0.0
        for l in loc:
            dv = t * l[0] + bt * l[1] + n * l[2]
            h = bvh.ray_cast(o, Vector(dv), dist)
            if h[0] is not None:
                hit += 1.0 - (h[3] / dist) * 0.55
        ao[i] = 1.0 - hit / rays
    return np.clip(ao, 0.0, 1.0)


def colorize(ob):
    """Vertex tint (matte aged bone): baked AO in the joint gaps, cavity-dark pits, ridge-ivory edges, mottled staining
    and thin hairline cracks (a ridged-noise mask). Albedo stays in the bone range - no chalk-white caps."""
    c_small, c_big = pipeline.curvature(ob, smooth_iters=(2, 10), scale=(30.0, 18.0))
    P = meshutil.get_verts(ob)
    ao = bake_ao(ob)
    ao = ao * ao * (3 - 2 * ao)
    stain = sdf.fbm(P[:, 0] * 1.0, P[:, 1] * 1.0, P[:, 2] * 1.0, 4, 3.5, seed=11)
    cr = sdf.fbm(P[:, 0], P[:, 1], P[:, 2], 3, 9.0, seed=23)
    crack = 1.0 - np.clip(np.abs(cr - np.median(cr)) / 0.035, 0.0, 1.0)      # thin lines where the noise crosses its median
    crack = crack * crack
    jd = np.ones(len(P))
    for c, r in JOINTS:  # 0 at a joint space -> 1 away from it
        q = np.linalg.norm(P - c[None, :], axis=1) / r
        jd = np.minimum(jd, np.clip(q, 0.0, 1.0))
    jg = jd * jd * (3 - 2 * jd)
    t = np.clip(0.30 + 0.55 * c_small + 0.2 * c_big + 0.22 * stain + 0.10 * jg, 0.0, 1.0)
    fore = np.clip((-P[:, 1] - 0.95) / 0.9, 0.0, 1.0)                         # forearm roots sink into the barrow earth
    t = t * (0.42 + 0.58 * ao) - 0.20 * crack - 0.30 * fore
    t = np.clip(t, 0.0, 1.0)[:, None]
    dark = np.array([0.12, 0.085, 0.05]); mid = np.array([0.58, 0.49, 0.35]); hi = np.array([0.86, 0.79, 0.62])
    col = np.where(t < 0.5, dark + (mid - dark) * (t / 0.5), mid + (hi - mid) * ((t - 0.5) / 0.5))
    col = pipeline.srgb2lin(np.clip(col, 0, 1)).astype(np.float32)
    meshutil.add_color_attr(ob, "Col", col)


def main():
    t0 = time.time()
    meshutil.clear_scene()
    S = build()
    ob = pipeline.lowpoly(S, "ui_skeletal_hand", H, TRIS, symmetry=False, smooth=1)
    for p in ob.data.polygons:
        p.use_smooth = True
    colorize(ob)
    mat = bpy.data.materials.new("bone")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Roughness"].default_value = 0.62
    ob.data.materials.append(mat)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    meshutil.select_only([ob], ob)
    kw = dict(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
              export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False,
              export_vertex_color="ACTIVE", export_all_vertex_colors=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        LOG("gltf kw fallback:", e)
        for k in ("export_vertex_color", "export_all_vertex_colors"):
            kw.pop(k, None)
        kw["export_colors"] = True
        bpy.ops.export_scene.gltf(**kw)
    LOG(f"[hand] {meshutil.tri_count(ob)} tris -> {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB) in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
